// The public, code-only copy of a private commit (DECISIONS 46). Pure git plumbing: nothing here reads or writes a working tree.
//   copyTree(git, commit)        -> { sha, privateTree, tree, rules, rulesSha, dropped, transformed, files }
//   copyCommit(git, built)       -> the sha of the copy commit: a ROOT commit (no history reaches the public repo), the author, the committer
//                                   and both dates taken from the private commit, so the same input gives the same commit
//   checkCopy(ctx, git, ...)     -> { ok, problems: [line] }: the gate; it reads the built tree back, so it does not trust how it was built
//   buildCopy(ctx, git, commit)  -> copyTree + gate + commit
//   pushCopy(ctx, git, ...)      -> pushes one copy commit to the public repo through a temporary bare repository
//   mapToPublic / expectedCopyCommit -> what `land` and the pre-push hook ask: which public commit stands for this private commit
// The rules live in ONE file of the private commit being copied (tools/omnikom-cli/public-copy.json); the file goes into the copy too, so it
// must never name a client. Client names are read at run time from the private commit's clients/ folder and never printed, stored or copied:
// a hit prints the client's index in the sorted slug list.
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Blocked } from './errors.mjs';
import { parseJobs } from './graph.mjs';
import { parseWorkflow } from '../commands/ci.mjs';
import { makeGit } from './git.mjs';
import { ensureTools, toolsDir, binDirOf } from './tools.mjs';
import { REPO } from './repo.mjs';

export const RULES_PATH = 'tools/omnikom-cli/public-copy.json';
export const CI_PATH = '.github/workflows/ci.yml';
export const WORKFLOWS_DIR = '.github/workflows/';
const NOT_CLIENT_FOLDERS = new Set(['TEMPLATE', 'test']);
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const firstLine = s => String(s || '').split('\n')[0].slice(0, 200);
const IDENT_FMT = ['%an', '%ae', '%aI', '%cn', '%ce', '%cI'].join('%x00');

// ------------------------------------------------------------------------------------------------ the rules
export function parseRules(text) {
  let r;
  try { r = JSON.parse(text); } catch (e) { throw new Blocked(`${RULES_PATH} is not JSON: ${firstLine(e.message)}`, 'fix the rules file'); }
  const bad = why => { throw new Blocked(`${RULES_PATH}: ${why}`, 'fix the rules file'); };
  if (!r || typeof r !== 'object' || Array.isArray(r)) bad('must be an object');
  const prefixOk = p => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.split('/').includes('..');
  if (!Array.isArray(r.deny) || r.deny.length === 0 || !r.deny.every(prefixOk)) bad('"deny" must be a non-empty list of repository-relative path prefixes');
  if (r.denyNamed !== undefined && (!Array.isArray(r.denyNamed) || !r.denyNamed.every(prefixOk))) bad('"denyNamed" must be a list of repository-relative paths (files denied because they name a client, DECISIONS 47)');
  if (!Array.isArray(r.workflowsKept) || !r.workflowsKept.every(f => typeof f === 'string' && f !== '' && !f.includes('/'))) bad('"workflowsKept" must be a list of workflow file names');
  if (!r.jobsNotOnCopy || typeof r.jobsNotOnCopy !== 'object' || Array.isArray(r.jobsNotOnCopy) || !Object.entries(r.jobsNotOnCopy).every(([k, v]) => k && v && typeof v === 'object' && typeof v.reason === 'string' && v.reason && Array.isArray(v.files) && v.files.every(prefixOk))) bad('"jobsNotOnCopy" must map a job id to { "reason": text, "files": [the denied paths that keep it off the copy] } (DECISIONS 47)');
  if (r.repo !== undefined && !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(r.repo))) bad('"repo" must be owner/name');
  return r;
}

// the rules as the private commit holds them: { rules, sha256 } (sha256 of the file's bytes, as git stores them)
// `rulesFile` (a dry run only, `copy build --dry-run --rules <file>`) tries rules that are not committed yet; every other path reads the commit.
export function loadRules(git, commit, rulesFile) {
  if (rulesFile) { const bytes = readFileSync(rulesFile); return { rules: parseRules(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') }; }
  const r = git.run(['show', `${commit}:${RULES_PATH}`], { buffer: true });
  if (!r.ok) throw new Blocked(`${commit} has no ${RULES_PATH}, so no public copy of it can be built`, 'commit the rules file');
  return { rules: parseRules(r.out.toString('utf8')), sha256: createHash('sha256').update(r.out).digest('hex') };
}

// why a path may not reach the copy ('' when it may): a denylisted prefix, or a workflow file the rules do not keep
export function deniedReason(path, rules) {
  const p = path.toLowerCase();
  for (const prefix of [...rules.deny, ...(rules.denyNamed || [])]) if (p.startsWith(prefix.toLowerCase())) return `denylisted ${prefix}`;
  if (p.startsWith(WORKFLOWS_DIR)) {
    const rest = p.slice(WORKFLOWS_DIR.length);
    if (!rules.workflowsKept.some(f => f.toLowerCase() === rest)) return 'a workflow file the copy does not keep';
  }
  return '';
}

// ------------------------------------------------------------------------------------------------ git helpers
function must(r, what) {
  if (!r.ok) throw new Blocked(`${what}: ${firstLine(r.err || `exit ${r.status}`)}`, 'check the repository');
  return r;
}

// every file of a tree-ish: [{ mode, type, sha, path }]
export function entriesOf(git, treeish) {
  const r = must(git.run(['ls-tree', '-r', '-z', '--full-tree', treeish], { buffer: true, timeout: 180000 }), `git ls-tree ${treeish}`);
  const items = [];
  for (const rec of r.out.toString('utf8').split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [mode, type, sha] = rec.slice(0, tab).split(' ');
    items.push({ mode, type, sha, path: rec.slice(tab + 1) });
  }
  return items;
}

// the bytes of blobs, one cat-file process: Map sha -> Buffer
export function readBlobs(git, shas) {
  const uniq = [...new Set(shas)];
  const out = new Map();
  if (uniq.length === 0) return out;
  const r = must(git.run(['cat-file', '--batch'], { input: `${uniq.join('\n')}\n`, buffer: true, timeout: 600000 }), 'git cat-file --batch');
  const buf = r.out;
  let pos = 0;
  for (const sha of uniq) {
    const nl = buf.indexOf(10, pos);
    const head = nl < 0 ? [] : buf.toString('latin1', pos, nl).split(' ');
    if (head[1] === 'missing' || head.length < 3) throw new Blocked(`object ${sha} is missing`, 'fetch the commit first');
    const size = Number(head[2]);
    out.set(sha, buf.subarray(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1;
  }
  return out;
}

const isBinary = buf => buf.subarray(0, 8192).includes(0);

// a nested tree object from flat entries: git mktree per directory, bottom up (--missing: a submodule commit is not an object here)
function treeFromEntries(git, entries) {
  const root = { files: [], dirs: new Map() };
  for (const e of entries) {
    const parts = e.path.split('/');
    let node = root;
    for (const d of parts.slice(0, -1)) {
      if (!node.dirs.has(d)) node.dirs.set(d, { files: [], dirs: new Map() });
      node = node.dirs.get(d);
    }
    node.files.push({ ...e, name: parts[parts.length - 1] });
  }
  const make = node => {
    const lines = node.files.map(f => `${f.mode} ${f.type} ${f.sha}\t${f.name}`);
    for (const [name, child] of node.dirs) lines.push(`040000 tree ${make(child)}\t${name}`);
    const r = must(git.run(['mktree', '-z', '--missing'], { input: lines.length ? `${lines.join('\0')}\0` : '' }), 'git mktree');
    return r.out;
  };
  return make(root);
}

// ------------------------------------------------------------------------------------------------ ci.yml without the jobs the copy does not run
// Removes the job blocks `ids` from the text of ci.yml: a block runs from its `  <id>:` line to the next line of indent 2 or less (a comment
// at indent 2 above the next job stays with that job). An id the file does not hold is an Error (never a silent no-op).
export function dropJobs(text, ids) {
  if (ids.length === 0) return text;
  const out = [];
  const found = new Set();
  let inJobs = false, skipping = false;
  for (const l of text.split('\n')) {
    if (/^jobs:\s*(?:#.*)?\r?$/.test(l)) { inJobs = true; skipping = false; out.push(l); continue; }
    if (inJobs && /^\S/.test(l)) { inJobs = false; skipping = false; }
    if (inJobs) {
      const jm = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?\r?$/.exec(l);
      if (jm) { skipping = ids.includes(jm[1]); if (skipping) found.add(jm[1]); }
      else if (skipping && l.trim() !== '' && !/^ {3,}/.test(l)) skipping = false;
    }
    if (!skipping) out.push(l);
  }
  const missing = ids.filter(i => !found.has(i));
  if (missing.length) throw new Error(`ci.yml has no job ${missing.join(', ')}`);
  return out.join('\n');
}

// ------------------------------------------------------------------------------------------------ the copy
export function copyTree(git, commit, rulesFile) {
  const sha = must(git.run(['rev-parse', '--verify', `${commit}^{commit}`]), `${commit} is not a commit`).out;
  const privateTree = must(git.run(['rev-parse', `${sha}^{tree}`]), 'git rev-parse').out;
  const { rules, sha256 } = loadRules(git, sha, rulesFile);
  const kept = [], dropped = [], transformed = [];
  for (const e of entriesOf(git, sha)) {
    if (deniedReason(e.path, rules)) dropped.push(e.path); else kept.push(e);
  }
  const jobIds = Object.keys(rules.jobsNotOnCopy);
  if (jobIds.length) {
    const ci = kept.find(e => e.path === CI_PATH);
    if (!ci) throw new Blocked(`${sha} has no ${CI_PATH} but the rules remove jobs from it`, 'fix the rules file');
    let text;
    try { text = dropJobs(readBlobs(git, [ci.sha]).get(ci.sha).toString('utf8'), jobIds); } catch (e) { throw new Blocked(`${CI_PATH}: ${firstLine(e.message)}`, 'fix jobsNotOnCopy'); }
    ci.sha = must(git.run(['hash-object', '-w', '--stdin'], { input: text }), 'git hash-object').out;
    transformed.push(CI_PATH);
  }
  kept.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { sha, privateTree, tree: treeFromEntries(git, kept), rules, rulesSha: sha256, dropped: dropped.sort(), transformed, files: kept.length };
}

export const copyMessage = (sha, privateTree, rulesSha) => `copy of ${sha}\n\nPrivate-Commit: ${sha}\nPrivate-Tree: ${privateTree}\nCopy-Rules: ${rulesSha}\n`;

// the root commit of a built copy (written to this repository's object store; nothing is pushed)
export function copyCommit(git, built) {
  const who = must(git.run(['log', '-1', `--format=${IDENT_FMT}`, built.sha]), 'git log').out.split('\0');
  const env = { GIT_AUTHOR_NAME: who[0], GIT_AUTHOR_EMAIL: who[1], GIT_AUTHOR_DATE: who[2], GIT_COMMITTER_NAME: who[3], GIT_COMMITTER_EMAIL: who[4], GIT_COMMITTER_DATE: who[5] };
  return must(git.run(['commit-tree', built.tree, '-F', '-'], { input: copyMessage(built.sha, built.privateTree, built.rulesSha), extraEnv: env }), 'git commit-tree').out;
}

// ------------------------------------------------------------------------------------------------ the gate
// The client names of a private commit, from its clients/ folder: every folder slug except TEMPLATE and test, sorted; plus the names in the
// H1 of that folder's profile.md ("# <business> (<person>, <person>): profile") and the terms of any "Also known as: <term>, <term>" line in it. -> [{ n, terms: [string] }]; n is the slug's index.
export function clientNames(git, commit) {
  const r = git.run(['ls-tree', '-z', `${commit}:clients`], { buffer: true });
  if (!r.ok) return [];
  const slugs = [];
  for (const rec of r.out.toString('utf8').split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const type = rec.slice(0, tab).split(' ')[1], name = rec.slice(tab + 1);
    if (type === 'tree' && !NOT_CLIENT_FOLDERS.has(name)) slugs.push(name);
  }
  slugs.sort();
  return slugs.map((slug, n) => {
    const terms = new Set([slug]);
    const p = git.run(['show', `${commit}:clients/${slug}/profile.md`]);
    const h1 = p.ok ? /^#\s+(.+?)\s*$/m.exec(p.out) : null;
    if (h1) {
      const title = h1[1].replace(/:\s*profile\s*$/i, '');
      const m = /^(.*?)\s*\((.*)\)\s*$/.exec(title);
      const business = m ? m[1] : title;
      const people = m ? m[2].split(/,|&|\band\b/i) : [];
      for (const t of [business, ...people]) if (t.trim().length >= 3) terms.add(t.trim());
    }
    // "Also known as: <term>, <term>" anywhere in the profile: other names the client goes by (trimmed, comma-separated, empty terms ignored)
    if (p.ok) for (const m of p.out.matchAll(/Also known as:[ \t]*([^\n]*)/gi)) for (const a of m[1].split(',')) if (a.trim() !== '') terms.add(a.trim());
    return { n, terms: [...terms] };
  });
}

// a name matches only as a whole word: not inside a longer run of letters or digits ("delivery" does not name a client called "eli")
const BEFORE = '(?<![A-Za-z0-9])', AFTER = '(?![A-Za-z0-9])';
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const nameRegex = terms => new RegExp(`${BEFORE}(?:${terms.map(t => esc(t).replace(/\s+/g, '\\s+')).join('|')})${AFTER}`, 'i');

// a path with every segment that holds a client name replaced by [client <n>]: the output never carries a name, not even inside a path
export function pathMasker(clients) {
  const regexes = clients.map(c => ({ n: c.n, re: nameRegex(c.terms) }));
  return path => path.split('/').map(seg => { const hit = regexes.find(x => x.re.test(seg)); return hit ? `[client ${hit.n}]` : seg; }).join('/');
}

// The gitleaks binary: a test's (ctx.gitleaks), else the tools folder's bin (omnikom tools ensure), else .tools/bin of this checkout or of the
// main checkout this one is a worktree of (the git common dir's parent), else the pinned download (lib/tools.mjs: version and sha256 from
// tools.json). Never an environment variable and never PATH: either could point the gate at a binary that passes.
export async function findGitleaks(ctx) {
  if (ctx.gitleaks) return ctx.gitleaks;
  // the checkout being copied, and the one this CLI runs from: each itself and, when it is a worktree, its main checkout (git common dir's parent)
  const roots = [];
  for (const dir of [ctx.repo, REPO]) {
    roots.push(dir);
    const common = makeGit(dir).run(['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (common.ok) roots.push(dirname(common.out));
  }
  const bins = [binDirOf(toolsDir(ctx)), ...roots.map(b => join(b, '.tools', 'bin'))];
  const look = () => { for (const dir of bins) for (const f of ['gitleaks.exe', 'gitleaks']) { const p = join(dir, f); if (existsSync(p)) return p; } return ''; };
  let found = look();
  if (!found) {
    const [r] = await ensureTools(ctx, ['gitleaks']);
    found = look();
    if (!found) throw new Blocked(`gitleaks is not installed and could not be downloaded (${r && r.status}): the copy cannot be shown clean`, 'run: node tools/omnikom-cli/omnikom.mjs tools ensure --only gitleaks');
  }
  return found;
}

// gitleaks over the files of the copy tree, in a temp folder that is removed on every path -> [line]
async function leakLines(ctx, git, files, blobs) {
  const bin = await findGitleaks(ctx);
  const root = mkdtempSync(join(tmpdir(), 'omnikom-copy-'));
  try {
    const src = join(root, 'src'), report = join(root, 'report.json');
    mkdirSync(src);
    for (const f of files) {
      const dest = resolve(src, f.path);
      if (!dest.startsWith(src + sep)) throw new Blocked(`the path ${f.path} leaves the scan folder`, 'fix the tree');
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, blobs.get(f.sha));
    }
    const ignore = files.find(f => f.path === '.gitleaksignore');
    if (ignore) {
      const stripped = blobs.get(ignore.sha).toString('utf8').split('\n').map(l => l.replace(/^[0-9a-f]{40}:/, '')).join('\n');
      writeFileSync(join(src, '.gitleaksignore'), stripped);
    }
    // run INSIDE the scan folder with --source . : a fingerprint (.gitleaksignore) then holds a repository-relative path, not this temp folder's
    const r = spawnSync(bin, ['detect', '--no-git', '--source', '.', '--no-banner', '--redact', '--exit-code', '1', '--report-format', 'json', '--report-path', report], { cwd: src, encoding: 'utf8', timeout: 600000, windowsHide: true, maxBuffer: 1 << 26 });
    if (r.error) throw new Blocked(`gitleaks could not run (${firstLine(r.error.message)}): the copy cannot be shown clean`, 'run omnikom tools ensure (the binary goes to .tools/bin)');
    if (r.status !== 0 && r.status !== 1) throw new Blocked(`gitleaks exited ${r.status}: ${firstLine(r.stderr)}`, 'check the gitleaks binary and config');
    if (r.status === 0) return [];
    let found = [];
    try { found = JSON.parse(readFileOrEmpty(report)); } catch { /* reported below */ }
    if (!Array.isArray(found) || found.length === 0) return ['gitleaks found something but wrote no readable report'];
    return found.map(x => `${String(x.File || '').replace(/\\/g, '/').replace(src.replace(/\\/g, '/') + '/', '')}:${x.StartLine} gitleaks ${x.RuleID}`);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
const readFileOrEmpty = p => { try { return readFileSync(p, 'utf8'); } catch { return '[]'; } };

// the ci.yml of the copy must still be a workflow `omnikom ci` can read, and the rules must agree with the private one
function ciProblems(git, privateCommit, tree, rules) {
  const out = [];
  const copy = git.run(['show', `${tree}:${CI_PATH}`]);
  if (!copy.ok) return [`${CI_PATH}: the copy has no ci.yml`];
  const priv = git.run(['show', `${privateCommit}:${CI_PATH}`]);
  const privIds = priv.ok ? parseJobs(priv.out).map(j => j.id) : [];
  let copyIds = [];
  try { copyIds = parseJobs(copy.out).map(j => j.id); if (copyIds.length === 0) out.push(`${CI_PATH}: the copy's ci.yml has no jobs`); parseWorkflow(copy.out); } catch (e) { out.push(`${CI_PATH}: does not parse: ${firstLine(e.message)}`); }
  for (const id of Object.keys(rules.jobsNotOnCopy)) {
    if (!privIds.includes(id)) out.push(`${CI_PATH}: jobsNotOnCopy names ${id}, which the private ci.yml does not have`);
    if (copyIds.includes(id)) out.push(`${CI_PATH}: the copy still has the job ${id} that jobsNotOnCopy removes`);
    for (const file of rules.jobsNotOnCopy[id].files) if (!deniedReason(file, rules)) out.push(`${RULES_PATH}: jobsNotOnCopy ${id} lists ${file} as a file that keeps it off the copy, but the copy does not deny it`);
    const lines = copy.out.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const nm = /^\s*needs:\s*(.*)$/.exec(lines[i]);
      if (!nm) continue;
      let refs = nm[1];
      for (let j = i + 1; j < lines.length && /^\s*-\s/.test(lines[j]); j++) refs += ` ${lines[j]}`;
      if (new RegExp(`(?<![A-Za-z0-9_-])${esc(id)}(?![A-Za-z0-9_-])`).test(refs)) out.push(`${CI_PATH}:${i + 1} a job needs ${id}, which is not on the copy`);
    }
  }
  return out;
}

// The gate: -> { ok, problems: [line], clients: <count> }. Reads the BUILT tree back; every offending path is listed; no client name is printed.
export async function checkCopy(ctx, git, { commit, tree, rules }) {
  const problems = [];
  const files = entriesOf(git, tree);
  // 1. a denylisted path
  for (const f of files) { const why = deniedReason(f.path, rules); if (why) problems.push(`${f.path} is on the copy but is ${why}`); }
  // 2. a file (or a path) naming a client
  const clients = clientNames(git, commit);
  const regexes = clients.map(c => ({ n: c.n, re: nameRegex(c.terms) }));
  const blobFiles = files.filter(f => f.type === 'blob' && f.mode !== '120000');
  const blobs = readBlobs(git, files.filter(f => f.type === 'blob').map(f => f.sha));
  const shown = pathMasker(clients);
  for (const f of files) {
    for (const { n, re } of regexes) if (re.test(f.path)) problems.push(`${shown(f.path)}: the path names client ${n}`);
  }
  for (const f of blobFiles) {
    const buf = blobs.get(f.sha);
    if (isBinary(buf)) continue;
    const text = buf.toString('utf8');
    for (const { n, re } of regexes) {
      if (!re.test(text)) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) problems.push(`${shown(f.path)}:${i + 1} names client ${n}`);
    }
  }
  // 3. gitleaks
  problems.push(...(await leakLines(ctx, git, files.filter(f => f.type === 'blob'), blobs)).map(l => shown(l)));
  // 4. ci.yml
  problems.push(...ciProblems(git, commit, tree, rules));
  return { ok: problems.length === 0, problems, clients: clients.length };
}

// copy + gate + commit -> { built, commit, gate }. The commit exists in this repository's object store either way; nothing is pushed.
export async function buildCopy(ctx, git, commit, rulesFile) {
  const built = copyTree(git, commit, rulesFile);
  const gate = await checkCopy(ctx, git, { commit: built.sha, tree: built.tree, rules: built.rules });
  return { built, commit: copyCommit(git, built), gate };
}

// ------------------------------------------------------------------------------------------------ the public side
export function publicRepoOf(ctx, rules) {
  const repo = ctx.copyRepo || rules.repo;
  if (!repo) throw new Blocked(`${RULES_PATH} names no public "repo"`, 'create the public repository and put owner/name in the rules file (DECISIONS 46)');
  return repo;
}
export const publicUrlOf = (ctx, rules) => ctx.copyUrl || `https://github.com/${publicRepoOf(ctx, rules)}.git`;

const trailer = (message, key) => { const m = new RegExp(`^${key}: (\\S+)\\s*$`, 'm').exec(message); return m ? m[1] : ''; };

// `land`: the public branch of the same name must stand for exactly this private commit: its tip's TREE equals the expected copy tree and its
// message names the private sha. -> { copySha, repo, url, expected } or Blocked (never a mapping from a branch name or a message alone)
export function mapToPublic(ctx, git, { sha, branch }) {
  const built = copyTree(git, sha);
  const repo = publicRepoOf(ctx, built.rules), url = publicUrlOf(ctx, built.rules);
  const ref = `refs/heads/${branch}`;
  const fix = `run: node tools/omnikom-cli/omnikom.mjs copy push ${branch}`;
  const ls = git.run(['ls-remote', url, ref], { timeout: 180000 });
  if (!ls.ok) throw new Blocked(`could not read the public copy ${repo}: ${firstLine(ls.err || `exit ${ls.status}`)}`, 'check the network and the public repository');
  const tip = (ls.out.split('\n').map(l => l.trim().split(/\s+/)).find(p => p[1] === ref) || [])[0] || '';
  if (!SHA.test(tip)) throw new Blocked(`the public copy ${repo} has no branch ${branch}`, fix);
  if (!git.run(['cat-file', '-e', `${tip}^{commit}`]).ok) {
    const fe = git.run(['fetch', '--quiet', url, ref], { timeout: 600000 });
    if (!fe.ok || !git.run(['cat-file', '-e', `${tip}^{commit}`]).ok) throw new Blocked(`could not fetch ${branch} from the public copy: ${firstLine(fe.err || 'the commit is still missing')}`, 'check the network and the public repository');
  }
  const info = must(git.run(['log', '-1', '--format=%T%n%B', tip]), 'git log').out;
  const [tree, ...msg] = info.split('\n');
  if (tree !== built.tree) throw new Blocked(`the public ${branch} (${tip}) holds a different tree from the copy of ${sha}`, fix);
  if (trailer(msg.join('\n'), 'Private-Commit') !== sha) throw new Blocked(`the public ${branch} (${tip}) does not name ${sha} as its Private-Commit`, fix);
  return { copySha: tip, repo, url, expected: built };
}

// the hook: the copy commit is a function of the private commit, so the public commit that stands for it is computed, not looked up
export function expectedCopyCommit(git, sha) {
  const built = copyTree(git, sha);
  return { copySha: copyCommit(git, built), built };
}

// Pushes `commit` to refs/heads/<branch> of the public repository. The push runs from a TEMPORARY BARE repository that borrows this
// clone's objects (objects/info/alternates) and has hooks switched off: the clone's own pre-push hook (which is for the private repo and
// would read a push to a master as a push of the private master) never sees it, and no ref of this clone changes.
// The copy is a root commit, so it is never a fast-forward of the branch it replaces: a check/** branch is force-replaced, and master is
// replaced only with a lease on the tip that was just read. -> { pushed: bool, line }
export function pushCopy(ctx, git, { commit, branch, rules }) {
  const url = publicUrlOf(ctx, rules);
  const ref = `refs/heads/${branch}`;
  if (!/^check\/.+/.test(branch) && branch !== 'master') throw new Blocked(`the public copy takes only check/** and master, not ${branch}`, 'push a check branch');
  const ls = git.run(['ls-remote', url, ref], { timeout: 180000 });
  if (!ls.ok) throw new Blocked(`could not read the public copy: ${firstLine(ls.err || `exit ${ls.status}`)}`, 'check the network and the public repository');
  const tip = (ls.out.split('\n').map(l => l.trim().split(/\s+/)).find(p => p[1] === ref) || [])[0] || '';
  if (tip === commit) return { pushed: false, line: `copy: ${ref} already is ${commit}; nothing pushed` };
  const objects = must(git.run(['rev-parse', '--path-format=absolute', '--git-path', 'objects']), 'git rev-parse').out;
  const root = mkdtempSync(join(tmpdir(), 'omnikom-copy-push-'));
  try {
    const bare = join(root, 'bare.git');
    const noHooks = join(root, 'no-hooks');
    mkdirSync(noHooks);
    const tgit = makeGit(root, ctx.copyPushSpy);
    must(tgit.run(['init', '--bare', '-q', bare]), 'git init');
    writeFileSync(join(bare, 'objects', 'info', 'alternates'), `${objects.replace(/\\/g, '/')}\n`);
    const bgit = makeGit(bare, ctx.copyPushSpy);
    must(bgit.run(['update-ref', 'refs/heads/copy', commit]), 'git update-ref');
    const lease = branch === 'master' ? (tip ? [`--force-with-lease=${ref}:${tip}`] : []) : ['--force'];
    const push = bgit.run(['-c', `core.hooksPath=${noHooks.replace(/\\/g, '/')}`, 'push', '--quiet', ...lease, url, `${commit}:${ref}`], { timeout: 900000 });
    if (!push.ok) throw new Blocked(`the push of the copy to ${ref} failed: ${firstLine(push.err || `exit ${push.status}`)}`, 'check the network, the public repository and its credentials');
    return { pushed: true, line: `copy: pushed ${commit} to ${ref}` };
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

// build + gate + push of the copy of one private commit to one public branch -> { ok, code, lines, data }. A refused gate pushes nothing.
export async function publishCopy(ctx, git, { sha, branch }) {
  const { built, commit, gate } = await buildCopy(ctx, git, sha);
  const data = { privateSha: built.sha, copySha: commit, branch, files: built.files, dropped: built.dropped.length, clients: gate.clients, pushed: false };
  if (!gate.ok) {
    return { ok: false, code: 'COPY-REFUSED', data: { ...data, problems: gate.problems }, lines: [`copy: REFUSED ${built.sha}: ${gate.problems.length} problem(s); nothing was pushed`, ...gate.problems.map(p => `copy: ${p}`)] };
  }
  const pushed = pushCopy(ctx, git, { commit, branch, rules: built.rules });
  data.pushed = pushed.pushed;
  return { ok: true, code: 'ok', data, lines: [pushed.line, `copy: ${built.sha} -> ${commit} (${built.files} files, ${built.dropped.length} dropped)`] };
}
