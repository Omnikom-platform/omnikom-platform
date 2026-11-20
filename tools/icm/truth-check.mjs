// Truth checks (rule 36 in docs/product/11-rules.md): four more things the repository says about itself, checked by CI through
// check() in index.mjs. Node 20, no dependencies, no network, reads only. One plain line per problem, each starting with its label:
//   PROOF    every WORKS row of docs/product/1-product.md has a test line in docs/product/proof.tsv; every line names a path and a
//            token that exist in the repository
//   CALLERS  every function in schema service has a caller outside tests and comments, or a line in docs/product/callers-allow.tsv
//   CONFIG   supabase/config.toml and supabase/functions name the same functions
//   STATE    work/STATE.md is short, agrees with the Counts table of the book, and names the migration number the tree holds
// A family runs only when its input exists; a family never stops another.
import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseProduct } from './book-check.mjs';

const PRODUCT = 'docs/product/1-product.md';
const PROOF = 'docs/product/proof.tsv';
const ALLOW = 'docs/product/callers-allow.tsv';
const STATE_FILE = 'work/STATE.md';
const STATE_MAX = 59;
const TAB = '\t';
const PROOF_HEADER = ['row', 'kind', 'path', 'token'];
const ALLOW_HEADER = ['function', 'row', 'reason'];
const FIRST_FOLDERS = ['apps', 'clients', 'contracts', 'docs', 'factory', 'icm', 'sites', 'skills', 'sops', 'supabase', 'templates', 'tools', 'work', '.github'];
const CODE_ROOTS = ['supabase/functions', 'supabase/ops', 'tools', 'factory', 'apps', '.github'];
const CODE_EXT = /\.(?:ts|tsx|js|mjs|cjs|sql|ya?ml)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
const PATH_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const FN_RE = /^create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/i;
const NOT_A_CALL = /^(?:grant|revoke|comment|alter|drop)\b/i;
const DROP_RE = /^drop\s+function\s+(?:if\s+exists\s+)?([\w."]+)/i;
const CALL_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*) *\(/g;
const TEST_EXT = /\.(?:ts|tsx|js|mjs|cjs|sql)$/;
const COMMENT_LINE = /^(?:\/\/|--|#|\*)/;
const GATES_FILE = 'docs/blueprint/specs/run-all-gates.mjs';

const isTestPath = p => {
  const parts = p.split('/'), name = parts[parts.length - 1];
  return parts.slice(0, -1).some(x => x === 'test' || x === 'tests' || x === '__tests__')
    || name.includes('.test.') || name.includes('.spec.') || name.startsWith('test-') || name.startsWith('e2e-');
};
const fileState = (root, rel) => (existsSync(join(root, rel)) ? (statSync(join(root, rel)).isFile() ? 'file' : 'dir') : 'missing');
const text = (root, rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// A tab-separated file with a fixed header -> { rows: [{ n, cells }], problems, cr }. n is the file's line number (header = 1).
export function readTsv(body, header, label, file) {
  const rows = [], problems = [];
  if (body.includes('\r')) return { rows, problems: [`${label}: ${file} has a carriage return`], cr: true };
  const lines = body.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines[0] !== header.join(TAB)) problems.push(`${label} line 1: the first line must be exactly: ${header.join(' | ')}`);
  for (let i = 1; i < lines.length; i++) {
    const n = i + 1;
    if (lines[i] === '') { problems.push(`${label} line ${n}: the line is empty`); continue; }
    const cells = lines[i].split(TAB);
    if (cells.length !== header.length) { problems.push(`${label} line ${n}: has ${cells.length} columns, not ${header.length}`); continue; }
    rows.push({ n, cells });
  }
  return { rows, problems, cr: false };
}

const badPart = (s, i) => s === '' || s === '.' || s === '..' || s.endsWith('.') || (s.startsWith('.') && !(i === 0 && s === '.github')) || s === 'private';
// the one spelling a path may have: plain parts, a first folder of the list, the real path equal to the written one, a regular file
function spellingOk(root, p) {
  const parts = p.split('/');
  if (!PATH_RE.test(p) || parts.some(badPart)) return false;
  if (!FIRST_FOLDERS.includes(parts[0])) return false;
  let real;
  try { real = realpathSync.native(join(root, p)); } catch { return false; }
  if (real !== join(realpathSync.native(root), ...parts)) return false;
  return statSync(real).isFile();
}

const testFile = (p, gates) => (isTestPath(p) && TEST_EXT.test(p)) || gates.has(p);
// the scripts the CI gate list names: a quoted path ending .mjs on a line of its GATES list (comments cut)
function gateSet(root) {
  const out = new Set();
  if (fileState(root, GATES_FILE) !== 'file') return out;
  const m = /GATES\s*=\s*\[([\s\S]*?)\n\]/.exec(text(root, GATES_FILE));
  if (m) for (const l of m[1].split('\n')) for (const g of l.replace(/\/\/.*/, '').matchAll(/['"]([^'"\s]+\.mjs)['"]/g)) out.add(g[1]);
  return out;
}

function rowProblem(root, states, gates, first, id, kind, path, token) {
  if (first) return `duplicates line ${first}`;
  if (!states.has(id)) return `row ${id} is not in ${PRODUCT}`;
  if (kind !== 'test' && kind !== 'code') return `the kind "${kind}" is not test or code`;
  if (!spellingOk(root, path)) return `the path ${path} is not a file of this repository under that exact spelling`;
  if (!token.trim()) return 'the token is empty';
  if (token !== token.trim()) return 'the token has a space at its start or end';
  if (token.length < 8) return 'the token is shorter than 8 characters';
  if (!text(root, path).includes(token)) return `the token is not in ${path}`;
  if (!text(root, path).split('\n').some(l => l.includes(token) && !COMMENT_LINE.test(l.trim()))) return `the token stands only in a comment of ${path}`;
  if (kind === 'test' && !testFile(path, gates)) return 'a test line must name a test file (with a code extension; a folder test or tests, or .test. or .spec. in its name, or a name starting test- or e2e-)';
  return '';
}

function proofLines(root) {
  if (fileState(root, PRODUCT) !== 'file') return [];
  const states = new Map();
  for (const p of parseProduct(text(root, PRODUCT)).parts.values()) for (const r of p.rows) states.set(r.id, r.state);
  const st = fileState(root, PROOF);
  if (st === 'missing') return [`PROOF: ${PROOF} is missing`];
  if (st !== 'file') return [`PROOF: ${PROOF} is not a file`];
  const tsv = readTsv(readFileSync(join(root, PROOF), 'utf8'), PROOF_HEADER, 'PROOF', PROOF);
  const out = [...tsv.problems];
  if (tsv.cr) return out;
  const seen = new Map(), proved = new Set(), gates = gateSet(root);
  for (const { n, cells } of tsv.rows) {
    const [id, kind, path, token] = cells;
    const bad = rowProblem(root, states, gates, seen.get(cells.join(TAB)), id, kind, path, token);
    if (!seen.has(cells.join(TAB))) seen.set(cells.join(TAB), n);
    if (bad) { out.push(`PROOF line ${n}: ${bad}`); continue; }
    if (kind === 'test') proved.add(id);
  }
  for (const [id, state] of states) if (state === 'WORKS' && !proved.has(id)) out.push(`PROOF: ${id} is WORKS and has no test line in ${PROOF}`);
  return out;
}

// ---- CALLERS ----
const stripSqlComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
// statements split on ; outside dollar quotes ($$ and $tag$)
function statements(sql) {
  const body = stripSqlComments(sql), out = [], DQ = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
  let cur = '', tag = null;
  for (let i = 0; i < body.length;) {
    if (tag) {
      if (body.startsWith(tag, i)) { cur += tag; i += tag.length; tag = null; } else cur += body[i++];
    } else if (body[i] === '$' && (DQ.lastIndex = i, DQ.test(body))) {
      tag = body.slice(i, DQ.lastIndex); cur += tag; i = DQ.lastIndex;
    } else if (body[i] === "'") {
      let j = i + 1; // a '...' string, '' inside it is a quote
      while (j < body.length && !(body[j] === "'" && body[j + 1] !== "'")) j += body[j] === "'" ? 2 : 1;
      cur += body.slice(i, j + 1); i = j + 1;
    } else if (body[i] === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; }
    else cur += body[i++];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// one walk over a code file: a comment starts only outside a '...', "..." or `...` string (backslash escapes; ' and " end at a line end)
function stripJs(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && !(c !== '`' && src[j] === '\n')) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? src.length : e + 2; out += ' ';
    } else out += src[i++];
  }
  return out;
}
function stripCode(src, name) {
  if (/\.sql$/i.test(name)) return stripSqlComments(src);
  if (/\.ya?ml$/i.test(name)) return src.replace(/(^|[ \t])#.*$/gm, '$1');
  return stripJs(src);
}
function codeTexts(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel + '/' + e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(r); continue; }
      if (!e.isFile() || !CODE_EXT.test(e.name)) continue;
      if (isTestPath(r)) continue;
      out.push(stripCode(readFileSync(join(root, r), 'utf8'), e.name));
    }
  };
  for (const r of CODE_ROOTS) if (existsSync(join(root, r))) walk(r);
  return out;
}

const fnKey = raw => { const k = raw.toLowerCase().replace(/"/g, ''); return k.includes('.') ? k : 'public.' + k; };
const callsIn = t => new Set([...t.matchAll(CALL_RE)].map(m => (m[1] + '.' + m[2]).toLowerCase()));

function callerLines(root) {
  const migDir = join(root, 'supabase/migrations');
  if (!existsSync(migDir)) return [];
  const defs = new Map(), others = [];
  for (const f of readdirSync(migDir).filter(x => x.endsWith('.sql')).sort()) {
    for (const stmt of statements(readFileSync(join(migDir, f), 'utf8'))) {
      const m = FN_RE.exec(stmt), d = DROP_RE.exec(stmt);
      if (m) defs.set(fnKey(m[1]), stmt);
      else if (d) defs.delete(fnKey(d[1]));
      else if (!NOT_A_CALL.test(stmt)) others.push(stmt);
    }
  }
  const names = [...defs.keys()].filter(k => k.startsWith('service.')).map(k => k.slice(8)).sort();
  // live = called by a root (a code file, a statement that is no function definition) or by the body of a live function
  const live = new Set(), queue = [];
  const mark = k => { if (defs.has(k) && !live.has(k)) { live.add(k); queue.push(k); } };
  for (const t of [...others, ...codeTexts(root)]) for (const c of callsIn(t)) mark(c);
  while (queue.length) { const k = queue.pop(); for (const c of callsIn(defs.get(k))) if (c !== k) mark(c); }
  const called = n => live.has('service.' + n);
  const out = [], allowed = new Map();
  const book = fileState(root, PRODUCT) === 'file' ? parseProduct(text(root, PRODUCT)) : null;
  const known = new Set();
  if (book) for (const p of book.parts.values()) for (const r of p.rows) known.add(r.id);
  if (fileState(root, ALLOW) === 'file') {
    const tsv = readTsv(readFileSync(join(root, ALLOW), 'utf8'), ALLOW_HEADER, 'CALLERS', ALLOW);
    out.push(...tsv.problems);
    for (const { n, cells: [fn, row, reason] } of tsv.rows) {
      const at = `CALLERS: ${ALLOW} line ${n}:`;
      if (allowed.has(fn)) { out.push(`${at} duplicates line ${allowed.get(fn)}`); continue; }
      allowed.set(fn, n);
      if (!names.includes(fn)) out.push(`${at} service.${fn} is created by no migration`);
      else if (called(fn)) out.push(`CALLERS: service.${fn} is in ${ALLOW} but has a caller; remove the line`);
      if (book && row !== '-' && !known.has(row)) out.push(`${at} row ${row} is not in ${PRODUCT}`);
      if (!reason.trim()) out.push(`${at} the reason is empty`);
    }
  }
  for (const n of names) if (!allowed.has(n) && !called(n)) out.push(`CALLERS: service.${n} has no caller outside tests and comments; call it, drop it, or list it in ${ALLOW}`);
  return out;
}

// ---- CONFIG ----
function configLines(root) {
  if (fileState(root, 'supabase/config.toml') !== 'file') return [];
  const tables = new Map(), out = [];
  let cur = null;
  for (const raw of text(root, 'supabase/config.toml').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^\[functions\.("?)([A-Za-z0-9_-]+)\1\]/.exec(line);
    if (m) {
      if (tables.has(m[2])) out.push(`CONFIG: [functions.${m[2]}] is listed twice in supabase/config.toml`);
      else tables.set(m[2], false);
      cur = m[2];
    } else if (line.startsWith('[')) cur = null;
    else if (cur && /^enabled\s*=\s*false$/.test(line)) tables.set(cur, true);
  }
  const dir = join(root, 'supabase/functions');
  const hasIndex = n => existsSync(join(dir, n, 'index.ts'));
  for (const [name, off] of tables) if (!hasIndex(name) && !off) out.push(`CONFIG: supabase/config.toml names [functions.${name}], which has no supabase/functions/${name}/index.ts`);
  const folders = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() : [];
  for (const d of folders) if (hasIndex(d) && !d.startsWith('_') && !tables.has(d)) out.push(`CONFIG: supabase/functions/${d} has an index.ts and no [functions.${d}] in supabase/config.toml`);
  return out;
}

// ---- STATE ----
const totalText = n => `${n[0]} of ${n[3]} rows WORK, ${n[1]} PARTLY, ${n[2]} MISSING`;
function productLine(lines) {
  const i = lines.findIndex(l => l.startsWith('- Product:'));
  if (i < 0) return '';
  const rest = [];
  for (let j = i + 1; j < lines.length && lines[j].startsWith(' '); j++) rest.push(lines[j].trim());
  return [lines[i], ...rest].join(' ');
}
function stateLines(root) {
  const st = fileState(root, STATE_FILE);
  if (st === 'missing') return [];
  if (st === 'dir') return [`STATE: ${STATE_FILE} is not a file`];
  const lines = text(root, STATE_FILE).split('\n'), out = [];
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length > STATE_MAX) out.push(`STATE: ${STATE_FILE} has ${lines.length} lines, the limit is ${STATE_MAX}`);
  const book = fileState(root, PRODUCT) === 'file' ? parseProduct(text(root, PRODUCT)) : null;
  const total = book && book.counts.find(c => /^Total$/i.test(c.label));
  if (total) {
    const pl = productLine(lines);
    const tm = /(\d+) of (\d+) rows WORK, (\d+) PARTLY, (\d+) MISSING/.exec(pl);
    if (!tm) out.push(`STATE: ${STATE_FILE} has no Product line with its counts`);
    else {
      const got = [Number(tm[1]), Number(tm[3]), Number(tm[4]), Number(tm[2])];
      if (got.join() !== total.nums.join()) out.push(`STATE: the Product line says ${totalText(got)}; the Counts table gives ${totalText(total.nums)}`);
      const groups = [...pl.matchAll(/(\d+), (\d+), (\d+) of (\d+)/g)].map(g => g.slice(1).map(Number));
      const parts = book.counts.filter(c => !/^Total$/i.test(c.label));
      if (groups.length !== parts.length) out.push(`STATE: the Product line gives ${groups.length} part groups; the Counts table has ${parts.length} parts`);
      else groups.forEach((g, i) => {
        if (g.join() !== parts[i].nums.join()) out.push(`STATE: the Product line says ${g[0]}, ${g[1]}, ${g[2]} of ${g[3]} for part ${parts[i].label[0]}; the Counts table gives ${parts[i].nums[0]}, ${parts[i].nums[1]}, ${parts[i].nums[2]} of ${parts[i].nums[3]}`);
      });
    }
  }
  const migDir = join(root, 'supabase/migrations');
  if (existsSync(migDir)) {
    const at = lines.findIndex(l => l.trim() === '## Migrations');
    const end = at < 0 ? -1 : lines.findIndex((l, i) => i > at && /^## /.test(l));
    const section = at < 0 ? '' : lines.slice(at + 1, end < 0 ? lines.length : end).join('\n');
    const mm = /through (\d+)/.exec(section);
    const nums = readdirSync(migDir).sort().map(f => /^\d{8}(\d{6})_/.exec(f)).filter(Boolean).map(m => Number(m[1]));
    if (!mm) out.push(`STATE: the "## Migrations" section of ${STATE_FILE} names no number after "through"`);
    else if (nums.length) {
      const top = Math.max(...nums);
      if (Number(mm[1]) !== top) out.push(`STATE: ${STATE_FILE} says migrations run through ${Number(mm[1])}, supabase/migrations holds ${top}`);
    }
  }
  return out;
}

export function checkTruth(root) {
  return [...proofLines(root), ...callerLines(root), ...configLines(root), ...stateLines(root)];
}
