// The environment names of `omnikom truth`: which names the code reads, where each name is set, and the comparison PER SURFACE (never a union).
//   readNamesByCode(repo, git)   the names read by the tracked code, with their surface and first path:line, and how many reads have a computed name
//   compareEnv({ reads, stores, provided })   the drift items
// A name is a NAME only: nothing in this file keeps, returns or prints a value. The master env file is read for the names at the start of its
// lines; the staging secrets and the Actions lists are read for their `name` field only. The comment cutter is the repository's one cutter
// (tools/icm/truth-check.mjs stripCode), reached through importRepo so a mutant copy of the CLI finds it too.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Blocked } from './errors.mjs';
import { importRepo } from './repo.mjs';
import { repoFromUrl } from './ghrun.mjs';

const CODE_EXT = /\.(?:ts|tsx|js|mjs|cjs|yml|yaml)$/i;
const YAML_EXT = /\.ya?ml$/i;
const SKIPPED_TOP = ['archive/', 'icm/', 'docs/'];
export const isTestPath = p => {
  const parts = p.split('/'), name = parts[parts.length - 1];
  return parts.slice(0, -1).some(x => x === 'test' || x === 'tests' || x === '__tests__')
    || name.includes('.test.') || name.includes('.spec.') || name.startsWith('test-') || name.startsWith('e2e-');
};

const NAME = '[A-Z][A-Z0-9_]*';
const Q = '[\'"`]';
// the forms that name the variable, exactly (JavaScript and TypeScript files); each on its own line
const JS_FORMS = [
  new RegExp(`Deno\\.env\\.get\\(\\s*${Q}(${NAME})${Q}\\s*\\)`, 'g'),
  new RegExp(`process\\.env\\.(${NAME})(?![A-Za-z0-9_])`, 'g'),   // not followed by a name character: process.env.SystemRoot and .ComSpec are not the names S and C
  new RegExp(`process\\.env\\[\\s*${Q}(${NAME})${Q}\\s*\\]`, 'g'),
  new RegExp(`import\\.meta\\.env\\.(${NAME})(?![A-Za-z0-9_])`, 'g'),
  new RegExp('(?<![.\\w])env\\.([A-Z][A-Z0-9_]{3,})\\b', 'g'),
];
// workflow files: the two forms of an Actions expression
const YAML_FORMS = [['secrets', new RegExp(`\\bsecrets\\.(${NAME})`, 'g')], ['vars', new RegExp(`\\bvars\\.(${NAME})`, 'g')]];
// a read whose name is computed is counted, never named
const COMPUTED = [new RegExp(`Deno\\.env\\.get\\(\\s*[^'"\`\\s)]`, 'g'), new RegExp(`process\\.env\\[\\s*[^'"\`\\s\\]]`, 'g')];

const TOKEN = /[A-Za-z0-9_]+/g;   // a whole word: \bNAME\b is the same as the token NAME
const BACKTICKED = /`([A-Z][A-Z0-9_]*)`/g;
const count = (s, ch = '\n') => { let n = 0; for (let i = s.indexOf(ch); i >= 0; i = s.indexOf(ch, i + 1)) n++; return n; };

// The line (1-based) of the original source that holds the match at `index` of the cut text. A block comment is cut to one space, which loses its newlines;
// then the original line is found by cutting prefixes of the source: the largest k with (newlines of the cut first k lines) <= the cut line.
function lineAt(src, text, rel, strip, index) {
  const s = count(text.slice(0, index));
  if (count(text) === count(src)) return s + 1;
  const starts = [0];
  for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (count(strip(src.slice(0, starts[mid]), rel)) <= s) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// -> { reads: [{ name, surface: 'functions' | 'workflows' | 'scripts', kind: 'env' | 'secrets' | 'vars', where: 'path:line' }], computed: <number> }
// The files are `git ls-files -z`: tracked files only, so a git-ignored key folder is never even listed.
export async function readNamesByCode(repo, git) {
  const { stripCode } = await importRepo('tools/icm/truth-check.mjs');
  const listed = git.out(['ls-files', '-z']);
  const files = listed.split('\0').filter(f => f && CODE_EXT.test(f) && !SKIPPED_TOP.some(d => f.startsWith(d)) && !isTestPath(f)).sort();
  const first = new Map();
  const mentioned = new Set();
  let computed = 0;
  for (const rel of files) {
    let src;
    try { src = readFileSync(join(repo, rel), 'utf8'); } catch { continue; }   // tracked, gone from the disk: nothing to read
    const text = stripCode(src, rel);
    for (const t of text.matchAll(TOKEN)) mentioned.add(t[0]);
    const yaml = YAML_EXT.test(rel);
    const surface = rel.startsWith('.github/production/') ? 'production' : rel.startsWith('supabase/functions/') ? 'functions' : (yaml && rel.startsWith('.github/') ? 'workflows' : 'scripts');
    const found = [];
    if (yaml) {
      for (const [kind, re] of YAML_FORMS) for (const m of text.matchAll(re)) found.push({ name: m[1], kind, index: m.index });
    } else {
      for (const re of JS_FORMS) for (const m of text.matchAll(re)) found.push({ name: m[1], kind: 'env', index: m.index });
      computed += COMPUTED.reduce((n, re) => n + [...text.matchAll(re)].length, 0);
    }
    found.sort((a, b) => a.index - b.index);
    for (const f of found) {
      const key = `${surface}|${f.kind}|${f.name}`;
      if (!first.has(key)) first.set(key, { name: f.name, surface, kind: f.kind, where: `${rel}:${lineAt(src, text, rel, stripCode, f.index)}` });
    }
  }
  return { reads: [...first.values()], computed, mentioned };
}

// the names of the section "Secrets" of the book: backticked tokens from its heading to the next heading of the same or a higher level
// -> Map name -> first line (1-based) of the book
export const BOOK_FILE = 'docs/product/4-backend.md';
export function readBookSecrets(repo) {
  let text;
  try { text = readFileSync(join(repo, BOOK_FILE), 'utf8'); } catch { throw new Blocked(`${BOOK_FILE} is not readable`, `restore ${BOOK_FILE} from git`); }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /^#{1,6}\s+Secrets\s*$/.test(l));
  if (start < 0) throw new Blocked(`${BOOK_FILE} has no Secrets section`, `restore the section "Secrets" of ${BOOK_FILE}`);
  const level = /^#+/.exec(lines[start])[0].length;
  const names = new Map();
  for (let i = start + 1; i < lines.length; i++) {
    const h = /^(#{1,6})\s/.exec(lines[i]);
    if (h && h[1].length <= level) break;
    for (const m of lines[i].matchAll(BACKTICKED)) if (!names.has(m[1])) names.set(m[1], i + 1);
  }
  return names;
}

// ---- where a name is set

// the names at the start of the lines of the master env file (NAME=...): the rest of a line is never kept
export function readEnvFileNames(file) {
  if (!file) throw new Blocked('OMNIKOM_ENV_FILE is not set', 'run it through tools/with-env.mjs with the master env file');
  let st = null;
  try { st = statSync(file); } catch { st = null; }
  if (!st || !st.isFile()) throw new Blocked('the file OMNIKOM_ENV_FILE names is not a readable file', 'run it through tools/with-env.mjs with the master env file');
  return namesAtLineStarts(file);
}

// the one reader of a NAME=value file: the names only, the rest of a line is never kept
function namesAtLineStarts(file) {
  const names = new Set();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

// the API keys file of the main checkout: its names are a store for the scripts. An absent file is an empty store, not BLOCKED.
// -> { names: Set, present: boolean }
export function readApiKeyNames(main) {
  const file = join(main, '.secrets', 'api-keys.env');
  let st = null;
  try { st = statSync(file); } catch { st = null; }
  if (!st) return { names: new Set(), present: false };
  if (!st.isFile()) throw new Blocked('.secrets/api-keys.env is not a readable file', 'make .secrets/api-keys.env a file of NAME=value lines');
  return { names: namesAtLineStarts(file), present: true };
}

// a JSON list of { name } -> the set of names; anything else is Blocked (never "no names")
function namesOf(list, what) {
  if (!Array.isArray(list) || list.some(x => !x || typeof x.name !== 'string')) throw new Blocked(`${what} is not a list of names`, 'check the answer of the service and run it again');
  return new Set(list.map(x => x.name));
}

// staging's function secrets, by name (the Supabase management API; only `name` is kept, the answer also carries a digest of each value)
export async function readStagingSecrets(ctx) {
  const token = ctx.env.SUPABASE_ACCESS_TOKEN, ref = ctx.env.STAGING_SUPABASE_REF;
  if (!token) throw new Blocked('SUPABASE_ACCESS_TOKEN is not set, so the staging function secrets cannot be listed', 'run it through tools/with-env.mjs with the master env file');
  if (!ref) throw new Blocked('STAGING_SUPABASE_REF is not set, so the staging function secrets cannot be listed', 'run it through tools/with-env.mjs with the master env file');
  if (!/^[A-Za-z0-9_-]+$/.test(ref)) throw new Blocked('STAGING_SUPABASE_REF is not a project ref', 'set STAGING_SUPABASE_REF to the staging project ref');
  let res;
  try {
    res = await ctx.fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  } catch (e) { throw new Blocked(`the staging secrets request failed: ${String((e && e.message) || e).split('\n')[0].slice(0, 120)}`, 'check the network and SUPABASE_ACCESS_TOKEN, then run it again'); }
  if (!res.ok) throw new Blocked(`the staging secrets request answered ${res.status}`, 'check SUPABASE_ACCESS_TOKEN and STAGING_SUPABASE_REF');
  let list = null;
  try { list = await res.json(); } catch { list = null; }
  return namesOf(list, 'the staging secrets answer');
}

// owner/name of the GitHub repository, from the backup-gh remote
export function actionsRepoOf(git) {
  const r = git.run(['remote', 'get-url', 'backup-gh']);
  if (!r.ok) throw new Blocked('no backup-gh remote names the GitHub repository', 'add the remote backup-gh (a github.com url)');
  return repoFromUrl(r.out);
}

// the Actions secrets or variables of the repository, by name (kind: 'secret' | 'variable'); only `name` is kept
export async function readActionsNames(ctx, repoName, kind) {
  let r;
  try { r = await ctx.gh([kind, 'list', '--json', 'name', '-R', repoName]); } catch (e) { r = { ok: false, err: String((e && e.message) || e) }; }
  if (!r || !r.ok) throw new Blocked(`gh ${kind} list failed: ${String((r && (r.err || r.out)) || 'no answer').split('\n')[0].slice(0, 160)}`, 'install gh and run gh auth login, then run it again');
  let list = null;
  try { list = JSON.parse(r.out); } catch { list = null; }
  return namesOf(list, `the gh ${kind} list`);
}

// ---- the comparison

// reads: from readNamesByCode; stores: { env, staging, secrets, vars } (Sets of names); provided: { functions, workflows, scripts } (Sets: set by the platform itself)
// -> { items: [{ what, where }], unset: <reads with no home>, unread: <names set and read nowhere> }
// book: Map name -> line of the book's Secrets section; mentioned: Set of every word of the tracked code (comments cut)
// -> { items, unset, unread, optional: <script names set nowhere, not in the book>, production: <names of .github/production>, bookOnly: <book names no code mentions> }
export function compareEnv({ reads, stores, provided, book, mentioned }) {
  const items = [];
  let unset = 0, unread = 0, optional = 0, bookOnly = 0;
  const fnSet = stores.staging;      // a name read in supabase/functions must be a staging function secret
  const wfSecrets = stores.secrets;  // secrets.X in a workflow must be an Actions secret
  const wfVars = stores.vars;        // vars.X in a workflow must be an Actions variable
  const problem = r => {
    if (r.surface === 'production') return '';   // a template of a repository that does not exist yet: counted, never an item
    if (r.surface === 'functions') return fnSet.has(r.name) || provided.functions.has(r.name) || provided.optionalFunctions.has(r.name) ? '' : `${r.name} read in supabase/functions, not a staging function secret`;
    if (r.surface === 'workflows') {
      if (r.kind === 'vars') return wfVars.has(r.name) || provided.workflows.has(r.name) ? '' : `${r.name} read as vars.${r.name}, not an Actions variable`;
      return wfSecrets.has(r.name) || r.name === 'GITHUB_TOKEN' || provided.workflows.has(r.name) ? '' : `${r.name} read as secrets.${r.name}, not an Actions secret`;
    }
    const anywhere = stores.env.has(r.name) || stores.secrets.has(r.name) || stores.vars.has(r.name) || stores.apiKeys.has(r.name) || provided.scripts.has(r.name);
    if (anywhere) return '';
    if (book.has(r.name)) return `${r.name} read by code, set nowhere`;   // the book says it is required
    optional++;
    return '';
  };
  const order = { functions: 0, workflows: 1, scripts: 2, production: 3 };
  for (const r of [...reads].sort((a, b) => order[a.surface] - order[b.surface] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const what = problem(r);
    if (what) { items.push({ what, where: r.where }); unset++; }
  }
  for (const [n, line] of book) {
    if (!mentioned.has(n)) {
      items.push({ what: `${n} is in ${BOOK_FILE} Secrets, mentioned by no code`, where: `${BOOK_FILE}:${line}` });
      bookOnly++;
    }
  }
  const excused = n => provided.functions.has(n) || provided.workflows.has(n) || provided.scripts.has(n);
  const homes = [
    [stores.env, 'in the master env file', 'OMNIKOM_ENV_FILE'],
    [stores.staging, 'as a staging function secret', 'staging function secrets'],
    [stores.secrets, 'as an Actions secret', 'Actions secrets'],
    [stores.vars, 'as an Actions variable', 'Actions variables'],
    [stores.apiKeys, 'in the API keys file', '.secrets/api-keys.env'],
  ];
  for (const [store, text, where] of homes) {
    for (const n of [...store].sort()) {
      if (!mentioned.has(n) && !excused(n)) {
        items.push({ what: `${n} set ${text}, read nowhere`, where });
        unread++;
      }
    }
  }
  const production = new Set(reads.filter(r => r.surface === 'production').map(r => r.name)).size;
  return { items, unset, unread, optional, production, bookOnly };
}
