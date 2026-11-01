// impact <files...> | --staged | --commit <sha> [--json]   (DECISIONS 43 and 45, docs/departments/README.md rule 8)
// Lists every tracked file that imports, reads or copies a changed file, each with its owning department (the charters' "Owns" lists)
// and the CI jobs and gates that reach it, so the chain of a change is found BEFORE the commit, by a tool. It informs and does not judge:
// exit 0 always (a wrong command line is exit 2). Text by default (one line per file), --json for the same rows.
//   <owner>  <file>  <imports X, which imports C | reads X | copy NAME of C>  <job a, b; gate c | no gate reads it>
//   changed  <file>  <owner>  <gates or "no gate reads it">
//   impact: N files outside <owners of the changed files>; gates to run: <list>      (or: impact: prose only, no gate reads these files)
// The graph is lib/graph.mjs (read it for what it can and cannot see). The named literal copies are impact-copies.json.
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, isAbsolute, relative, resolve, basename } from 'node:path';
import { Usage } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { makeGit } from '../lib/git.mjs';
import { redact } from '../lib/redact.mjs';
import { workingTreeSource, treeSource, buildGraph, entryPoints, normalizeRel, parseJobs } from '../lib/graph.mjs';
import { parseWorkflow } from './ci.mjs';

export const COPIES_FILE = 'tools/omnikom-cli/impact-copies.json';

// ------------------------------------------------------------------------------------------------ owners (the charters)
export function parseOwners(files, read) {
  const owners = [];
  for (const f of files) {
    if (!/^docs\/departments\/[^/]+\.md$/.test(f) || ['README.md', 'TEMPLATE.md'].includes(basename(f))) continue;
    const text = read(f);
    if (!text) continue;
    const slug = basename(f, '.md');
    let inOwns = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^## /.test(line)) { inOwns = /^## Owns\s*$/.test(line); continue; }
      if (!inOwns) continue;
      const m = /^\s*[-*]\s+`([^`]+)`(.*)$/.exec(line);
      if (!m) continue;
      const at = m[2].search(/\bexcept\b/);
      const except = at < 0 ? [] : [...m[2].slice(at).matchAll(/`([^`]+)`/g)].map(x => x[1]);
      owners.push({ slug, path: m[1], except });
    }
  }
  return owners;
}
const under = (p, base) => (base.endsWith('/') ? p.startsWith(base) : p === base || p.startsWith(base + '/'));
// the department whose Owns list holds the file: the longest matching path wins; a bullet's "except" paths are not its own
export function ownerOf(path, owners) {
  let best = null;
  for (const o of owners) {
    if (!under(path, o.path)) continue;
    if (o.except.some(e => under(path, e))) continue;
    if (!best || o.path.length > best.path.length) best = o;
  }
  return best ? best.slug : null;
}

export function parseCopies(text) {
  if (!text) return [];
  let list;
  try { list = JSON.parse(text); } catch { return []; }
  return Array.isArray(list) ? list.filter(e => e && typeof e.name === 'string' && Array.isArray(e.files)) : [];
}

// ------------------------------------------------------------------------------------------------ the computation
const jobsAndGates = labels => {
  const jobs = labels.filter(l => l.startsWith('job ')).map(l => l.slice(4));
  const gates = labels.filter(l => l.startsWith('gate ')).map(l => l.slice(5));
  return [jobs.length ? `job ${jobs.join(', ')}` : '', gates.length ? `gate ${gates.join(', ')}` : ''].filter(Boolean).join('; ');
};

export function computeImpact({ graph, entries, owners, copies, changed }) {
  const changedSet = new Set(changed);
  const cover = p => entries.filter(e => e.reach.has(p)).map(e => e.label);
  const why = new Map();                        // affected path -> [{ text, hops }]
  const byChanged = new Map(changed.map(c => [c, new Set()]));
  const note = (c, p, text, hops) => { if (changedSet.has(p)) return; byChanged.get(c).add(p); const l = why.get(p) || why.set(p, []).get(p); if (!l.some(x => x.text === text)) l.push({ text, hops }); };

  for (const c of changed) {
    const parent = new Map([[c, null]]);        // breadth first over the files that import, so each reason is a shortest chain
    const queue = [c];
    while (queue.length) {
      const f = queue.shift();
      for (const a of graph.importedBy.get(f) || []) if (!parent.has(a)) { parent.set(a, f); queue.push(a); }
    }
    const chain = s => { const out = [s]; for (let x = parent.get(s); x; x = parent.get(x)) out.push(x); return out; };
    const tail = ch => ch.slice(1).map((x, i) => (i === 0 ? x : `, which imports ${x}`)).join('');
    for (const s of parent.keys()) {
      const ch = chain(s);
      if (s !== c) note(c, s, `imports ${tail(ch)}`, ch.length - 1);
      for (const r of graph.readBy.get(s) || []) note(c, r, s === c ? `reads ${c}` : `reads ${s}${ch.slice(1).map(x => `, which imports ${x}`).join('')}`, ch.length);
    }
    for (const e of copies) {
      if (!e.files.includes(c)) continue;
      for (const other of e.files) if (other !== c && graph.fileSet.has(other)) note(c, other, `copy ${e.name} of ${c}`, 1);
    }
  }

  const label = p => ownerOf(p, owners) || 'unowned';
  // one reason per file: the shortest chain (the rest are counted, and kept in the JSON)
  const best = p => why.get(p).reduce((a, b) => (b.hops < a.hops ? b : a));
  const rows = [...why.keys()].map(p => ({ owner: label(p), path: p, why: best(p).text, more: why.get(p).length - 1, allWhy: why.get(p).map(x => x.text), gates: cover(p) }))
    .sort((a, b) => (a.owner === b.owner ? (a.path < b.path ? -1 : 1) : a.owner < b.owner ? -1 : 1));
  const changedRows = changed.map(c => {
    const labels = new Set(cover(c));
    for (const p of byChanged.get(c)) for (const l of cover(p)) labels.add(l);
    return { path: c, owner: label(c), gates: [...labels] };
  });
  const changedOwners = [...new Set(changedRows.map(r => r.owner))].sort();
  const outside = rows.filter(r => !changedOwners.includes(r.owner)).length;
  const gatesToRun = [...new Set([...changedRows.flatMap(r => r.gates), ...rows.flatMap(r => r.gates)])];
  const unowned = [...new Set([...changedRows, ...rows].filter(r => r.owner === 'unowned').map(r => r.path))].sort();
  return { changed: changedRows, rows, changedOwners, outside, gatesToRun, unowned, proseOnly: changedRows.every(r => r.gates.length === 0) };
}

// everything `impact` needs, from one source of files
export function analyse({ git, source, changed, extraPaths = [] }) {
  const graph = buildGraph(source, { extraPaths, noScan: [COPIES_FILE] });
  const owners = parseOwners(graph.files, p => source.read(p));
  // the registry of the commit being looked at; when that commit predates it (or it is not tracked yet), the one in the working tree
  const copies = parseCopies(source.read(COPIES_FILE) ?? (() => { try { return readFileSync(join(git.cwd, COPIES_FILE), 'utf8'); } catch { return null; } })());
  const entries = entryPoints(graph, source);
  return computeImpact({ graph, entries, owners, copies, changed });
}

// ------------------------------------------------------------------------------------------------ the command
const splitZ = s => String(s || '').split('\0').filter(Boolean);
const relPath = (repo, p) => {
  let q = String(p).replace(/\\/g, '/');
  if (isAbsolute(p)) q = relative(repo, resolve(p)).replace(/\\/g, '/');
  return normalizeRel(q);
};

// the files a commit changed against its first parent (a root commit: all its files); deleted files are included
export function changedByCommit(git, sha) {
  const hasParent = git.run(['rev-parse', '--verify', '--quiet', `${sha}^1`]).ok;
  return hasParent ? splitZ(git.out(['diff', '--name-only', '-z', '--no-renames', `${sha}^1`, sha])) : splitZ(git.out(['diff-tree', '--root', '-r', '--name-only', '-z', '--no-commit-id', sha]));
}

export async function impact(ctx) {
  const f = ctx.flags;
  const repo = ctx.repo;
  const git = makeGit(repo);
  const paths = ctx.positionals.slice(1);
  const modes = [paths.length > 0, f.staged === true, f.commit !== undefined].filter(Boolean).length;
  if (modes !== 1) throw new Usage('impact takes exactly one of: <files...> | --staged | --commit <sha>');
  if (f.target !== undefined || f.expect !== undefined) throw new Usage('impact takes no --target and no --expect: it informs and does not judge');
  if (!git.run(['rev-parse', '--git-dir']).ok) throw new Usage(`${repo} is not a git repository`);
  let source, changed, extra = [];
  if (f.commit !== undefined) {
    const sha = git.run(['rev-parse', '--verify', '--quiet', `${f.commit}^{commit}`]);
    if (!sha.ok) throw new Usage(`--commit ${f.commit}: no such commit`);
    changed = changedByCommit(git, sha.out);
    source = treeSource(git, sha.out);
    extra = changed;
  } else if (f.staged === true) {
    changed = splitZ(git.out(['diff', '--cached', '--name-only', '-z', '--no-renames']));
    source = workingTreeSource(git, repo);
    extra = changed;
  } else {
    source = workingTreeSource(git, repo);
    const have = new Set(source.files);
    changed = [];
    for (const p of paths) {
      const q = relPath(repo, p);
      if (q === null || q === '') throw new Usage(`'${p}' is outside the repository`);
      if (have.has(q)) { changed.push(q); continue; }
      const under1 = source.files.filter(x => x.startsWith(q + '/'));
      if (under1.length) { changed.push(...under1); continue; }
      if (!existsSync(join(repo, q))) throw new Usage(`'${p}' is not a tracked file and does not exist`);
      if (statSync(join(repo, q)).isDirectory()) throw new Usage(`'${p}' is a folder with no tracked file in it`);
      changed.push(q);                          // exists on disk, not tracked yet: a new file
      extra.push(q);
    }
  }
  changed = [...new Set(changed)].sort();
  if (changed.length === 0) return result(true, 'ok', { empty: true, changed: [], rows: [], changedOwners: [], outside: 0, gatesToRun: [], unowned: [], proseOnly: true, laptop: [] });
  const data = analyse({ git, source, changed, extraPaths: extra });
  data.laptop = laptopFor(data, source, f.commit !== undefined ? `--commit ${f.commit}` : '--staged');
  return result(true, 'ok', data);
}

// The laptop tests the impact names (DECISIONS 45 (d)): for every ci.yml job in `gates to run`, the command that reproduces that job on this
// tree and the job's own `run:` commands (steps are read by commands/ci.mjs's own reader). Fast feedback only: the gate is the GitHub run.
export function laptopFor(d, source, treeFlag) {
  const ids = d.gatesToRun.filter(l => l.startsWith('job ')).map(l => l.slice(4));
  if (ids.length === 0) return [];
  const text = source.read('.github/workflows/ci.yml') || '';
  let steps = id => [];
  try {
    const parsed = parseWorkflow(text);
    steps = id => { const j = parsed.jobs.find(x => x.id === id); return j ? j.steps.filter(s => s.run).flatMap(s => s.run.split('\n')).map(l => l.trim()).filter(Boolean) : []; };
  } catch {
    const loose = parseJobs(text);                // a ci.yml shape the strict reader does not model: the lenient job reader of the graph
    steps = id => { const j = loose.find(x => x.id === id); return j ? j.run.split('\n').map(l => l.trim()).filter(Boolean) : []; };
  }
  return ids.map(job => ({ job, command: `node tools/omnikom-cli/omnikom.mjs ci --job ${job} ${treeFlag}`, steps: steps(job) }));
}

// the lines of one result, then the laptop tests it names; `only` limits the changed files shown
export function impactLines(d, { only = null } = {}) {
  const out = [];
  if (!d.changed.length) return ['impact: no changed files'];
  const rows = only ? d.rows.filter(r => only.has(r.path)) : d.rows;
  for (const r of rows) out.push(`${r.owner}  ${r.path}  ${r.why}${r.more > 0 ? ` (+${r.more} more)` : ''}  ${jobsAndGates(r.gates) || 'no gate reads it'}`);
  for (const c of d.changed) out.push(`changed  ${c.path}  ${c.owner}  ${jobsAndGates(c.gates) || 'no gate reads it'}`);
  for (const p of d.unowned) out.push(`finding: ${p} is unowned (no charter's Owns list holds it)`);
  out.push(d.proseOnly && d.gatesToRun.length === 0
    ? 'impact: prose only, no gate reads these files'
    : `impact: ${d.outside} files outside ${d.changedOwners.join(', ')}; gates to run: ${jobsAndGates(d.gatesToRun) || 'none'}`);
  for (const l of d.laptop || []) { out.push(`laptop: ${l.command}`); for (const s of l.steps) out.push(`  ${s}`); }
  return out;
}

export function impactText(obj, env) {
  const d = obj.data;
  if (obj.error || !d) return redact(`ERROR ${obj.error || obj.code}`, env) + '\n';
  return impactLines(d).map(l => redact(l, env)).join('\n') + '\n';
}
