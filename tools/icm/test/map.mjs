// Tests for tools/icm/map-check.mjs, progress.mjs and map-page.mjs (T3): the parts table, the clusters, the owner list and the progress file
// under work/map/, the line that appends to the progress file, and the one self-contained HTML page. A small valid tree is written into a
// temp folder, broken in ONE way, and checked; the output must be exactly the one line that names the problem.
//   node --max-old-space-size=512 tools/icm/test/map.mjs      exit 0 = every check passed. Lines start with "ok  " or "FAIL ".
// OMNIKOM_ICM_TOOLS points at a copy of tools/icm (test/mutate.mjs runs one broken copy at a time);
// OMNIKOM_ICM_ROOT is the repository whose real tables are checked (mutate.mjs passes it).
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, cpSync, symlinkSync, linkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.OMNIKOM_ICM_TOOLS ? resolve(process.env.OMNIKOM_ICM_TOOLS) : resolve(HERE, '..');
const REPO = process.env.OMNIKOM_ICM_ROOT ? resolve(process.env.OMNIKOM_ICM_ROOT) : resolve(TOOLS, '..', '..');
const FIXTURE = join(TOOLS, 'test', 'fixture');
const { checkMap } = await import(pathToFileURL(join(TOOLS, 'map-check.mjs')).href);
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 400)}`); };
const put = (dir, rel, text) => { const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, 'utf8'); };
const cpSyncFixture = d => cpSync(FIXTURE, d, { recursive: true });
const dirs = [];
const bare = () => { const d = mkdtempSync(join(tmpdir(), 'omnikom-icm-map-')); dirs.push(d); return d; };
const rm = (d, rel) => rmSync(join(d, rel), { recursive: true, force: true });
const rd = (d, rel) => readFileSync(join(d, rel), 'utf8');

const TAB = '\t';
const tsv = (...ls) => ls.map(l => (Array.isArray(l) ? l.join(TAB) : l)).join('\n') + '\n';
const BOOK = [
  '# The product', '',
  '### A. The first part', '| Feature | State | Missing half, or where it lives |', '|---|---|---|',
  '| A1 One | WORKS | `src/real.mjs` |', '| A2 Two | PARTLY, to be removed | the second half |', '| A3 Three | MISSING | |', '',
  '### E. Hardening', '| Feature | State | Missing half, or where it lives |', '|---|---|---|',
  '| E1 Backups | MISSING | |', '| E2 Monitoring | PARTLY | |', '',
  '### Counts', '| Part | WORKS | PARTLY | MISSING | Rows |', '|---|---|---|---|---|',
  '| A First | 1 | 1 | 1 | 3 |', '| E Hardening | 0 | 1 | 1 | 2 |', '| Total | 1 | 2 | 2 | 5 |', '',
].join('\n');
const BLOCKS = '# Blocks\n';
const PH = ['id', 'part', 'what', 'verdict', 'owner', 'cluster', 'rows'];
const CH = ['n', 'cluster', 'closes', 'needs', 'size'];
const OH = ['n', 'kind', 'he does', 'then the head', 'opens', 'state', 'answer'];
const GH = ['date', 'commit', 'works', 'partly', 'built', 'total'];
const PARTS = [
  ['GL.E1a', 'Backups copy', 'none', 'BUILT', '', '1', 'E1'],
  ['GL.G1', 'Two buckets', 'R2 and a second provider', 'NOT BUILT', '1 2', '2', ''],
  ['SS.B-1', 'Sign-up form', 'not built', 'NOT BUILT', '', '2', 'A2 E2'],
];
const CLUSTERS = [['1', 'The book tells the truth', 'A1 A3', '1', 'small'], ['2', 'Backups for real', 'E1', '1 2', 'medium']];
const OWNER = [['1', 'sitting', 'Signs in to GitHub', 'Makes the token', 'E1', 'open', ''], ['2', 'decision', 'Picks the plan', 'Moves it', 'E2', 'answered', 'Free for now']];
const P1 = ['2026-11-10', 'aaaaaaaa', '1', '2', '1', '3'], P2 = ['2026-11-20', 'bbbbbbbb', '2', '1', '2', '3'];
const FILES = {
  parts: ['work/map/parts.tsv', PH, PARTS, 'PARTS'], clusters: ['work/map/clusters.tsv', CH, CLUSTERS, 'CLUSTERS'],
  owner: ['work/map/owner.tsv', OH, OWNER, 'OWNER'], progress: ['work/map/progress.tsv', GH, [P1, P2], 'PROGRESS'],
};
const DATA = Object.values(FILES).map(f => f[0]);
// a valid tree; over.<key> replaces that file's data lines (arrays of cell arrays), edit(d) then changes the folder
const mapDir = (over = {}, edit = () => {}, book = BOOK) => {
  const d = bare();
  put(d, 'docs/product/1-product.md', book); put(d, 'docs/product/9-blocks.md', BLOCKS);
  put(d, 'docs/product/proof.tsv', tsv(['row', 'kind', 'path', 'token'], ['A1', 'test', 'tools/fx/test/real.test.mjs', 'real title'], ['A2', 'code', 'tools/fx/src.mjs', 'export const X = 1']));
  put(d, 'tools/fx/test/real.test.mjs', "test('real title', () => {});\n");
  for (const [k, [rel, h, rows]] of Object.entries(FILES)) put(d, rel, tsv(h, ...(over[k] || rows)));
  edit(d);
  return d;
};
const lines = d => { try { return checkMap(d); } catch (e) { return ['THREW: ' + e.message]; } };
const exact = (name, d, ...want) => { const l = lines(d); check(name, l.length === want.length && want.every((w, i) => l[i] === w), l.join(' / ')); };
// a copy of a table with one cell changed: cell(PARTS, 1, 3, 'DONE')
const cell = (rows, i, j, v) => rows.map((r, a) => (a === i ? r.map((c, b) => (b === j ? v : c)) : r));
const pOver = (i, j, v) => mapDir({ parts: cell(PARTS, i, j, v) });

// ---- checkMap ----
exact('K0 valid tree: no line', mapDir());
exact('K1 a tree with no work/map folder: no line', mapDir({}, d => rm(d, 'work/map')));
for (const [key, [rel, h, rows, label]] of Object.entries(FILES)) {
  exact(`K2 ${key}: the file is missing`, mapDir({}, d => rm(d, rel)), `${label}: ${rel} is missing`);
  exact(`K2 ${key}: the file is a folder`, mapDir({}, d => { rm(d, rel); mkdirSync(join(d, rel)); }), `${label}: ${rel} is not a file`);
  exact(`K3 ${key}: a changed header`, mapDir({}, d => put(d, rel, tsv([...h.slice(0, -1), h[h.length - 1] + 'x'], ...rows))), `${label} line 1: the first line must be exactly: ${h.join(' | ')}`);
  exact(`K3 ${key}: a CR`, mapDir({}, d => put(d, rel, tsv(h, ...rows).replace(/\n/g, '\r\n'))), `${label}: ${rel} has a carriage return`);
  exact(`K3 ${key}: an empty line`, mapDir({}, d => put(d, rel, tsv(h, ...rows) + '\n')), `${label} line ${rows.length + 2}: the line is empty`);
  exact(`K3 ${key}: a wrong column count`, mapDir({}, d => put(d, rel, tsv(h, ...rows) + 'x\ty\n')), `${label} line ${rows.length + 2}: has 2 columns, not ${h.length}`);
}
// PARTS
for (const id of ['gl.x', 'GL.', 'GLX.a', 'GL.a b', 'G1']) exact(`K4 parts: the id ${id}`, pOver(1, 0, id), `PARTS line 3: the id ${id} is not two capital letters, a dot, then letters, digits or hyphens`);
exact('K5 parts: a second GL.G1', pOver(2, 0, 'GL.G1'), 'PARTS line 4: the id GL.G1 is already on line 3');
exact('K6 parts: an empty part', pOver(1, 1, ''), 'PARTS line 3: the part is empty');
exact('K6 parts: an empty what', pOver(1, 2, ''), 'PARTS line 3: the what is empty');
for (const v of ['built', 'DONE', 'BUILT (as a gate)', '']) exact(`K7 parts: the verdict "${v}"`, pOver(1, 3, v), `PARTS line 3: the verdict "${v}" is not BUILT, BUILT-UNPROVEN, HALF, NOT BUILT or CANNOT TELL`);
for (const v of ['BUILT', 'BUILT-UNPROVEN', 'HALF', 'NOT BUILT', 'CANNOT TELL']) exact(`K7 parts: the verdict ${v} passes`, pOver(1, 3, v));
exact('K8 parts: owner 1 x', pOver(1, 4, '1 x'), 'PARTS line 3: the owner column holds "1 x", not owner item numbers');
exact('K8 parts: owner 9', pOver(1, 4, '9'), 'PARTS line 3: the owner item 9 is not in work/map/owner.tsv');
exact('K9 parts: cluster 1 2', pOver(1, 5, '1 2'), 'PARTS line 3: the cluster column holds "1 2", not one cluster number');
exact('K9 parts: cluster 9', pOver(1, 5, '9'), 'PARTS line 3: the cluster 9 is not in work/map/clusters.tsv');
exact('K10 parts: rows a1', pOver(1, 6, 'a1'), 'PARTS line 3: the rows column holds "a1", not book row ids');
exact('K10 parts: rows Z9', pOver(1, 6, 'Z9'), 'PARTS line 3: the row Z9 is not in docs/product/1-product.md');
exact('K10 parts: rows A2 A2', pOver(1, 6, 'A2 A2'), 'PARTS line 3: the row A2 is named twice');
exact('K10 parts: a tree with no book skips the row check', mapDir({}, d => { rm(d, 'docs/product'); put(d, 'work/map/parts.tsv', tsv(PH, ...cell(PARTS, 1, 6, 'Z9'))); }));
// CLUSTERS
const cOver = (i, j, v) => mapDir({ clusters: cell(CLUSTERS, i, j, v) });
exact('K11 clusters: numbers 1, 3', cOver(1, 0, '3'), 'CLUSTERS line 3: the number is 3, expected 2');
exact('K11 clusters: a number that is not whole', cOver(1, 0, 'x'), 'CLUSTERS line 3: the number "x" is not a whole number');
exact('K12 clusters: an empty cluster', cOver(1, 1, ''), 'CLUSTERS line 3: the cluster is empty');
exact('K12 clusters: an empty closes', cOver(1, 2, ''), 'CLUSTERS line 3: the closes is empty');
exact('K13 clusters: needs 9', cOver(1, 3, '9'), 'CLUSTERS line 3: the owner item 9 is not in work/map/owner.tsv');
exact('K13 clusters: needs x', cOver(1, 3, 'x'), 'CLUSTERS line 3: the needs column holds "x", not owner item numbers');
exact('K14 clusters: size huge', cOver(1, 4, 'huge'), 'CLUSTERS line 3: the size "huge" is not small, medium, large or largest');
for (const s of ['small', 'medium', 'large', 'largest']) exact(`K14 clusters: size ${s} passes`, cOver(1, 4, s));
// OWNER
const oOver = (i, j, v) => mapDir({ owner: cell(OWNER, i, j, v) });
exact('K15 owner: numbers 1, 3', oOver(1, 0, '3'), 'OWNER line 3: the number is 3, expected 2');
exact('K15 owner: a number that is not whole', oOver(1, 0, 'x'), 'OWNER line 3: the number "x" is not a whole number');
exact('K16 owner: kind maybe', oOver(1, 1, 'maybe'), 'OWNER line 3: the kind "maybe" is not sitting, words, decision or go');
for (const k of ['sitting', 'words', 'decision', 'go']) exact(`K16 owner: kind ${k} passes`, oOver(1, 1, k));
exact('K17 owner: state done', oOver(1, 5, 'done'), 'OWNER line 3: the state "done" is not open or answered');
exact('K18 owner: answered with no answer', oOver(1, 6, ''), 'OWNER line 3: an answered item has no answer');
exact('K18 owner: open with an answer', oOver(0, 6, 'x'), 'OWNER line 2: an open item has an answer');
exact('K19 owner: an empty he does', oOver(1, 2, ''), 'OWNER line 3: the he does is empty');
// PROGRESS
const gOver = (j, v) => mapDir({ progress: cell([P1, P2], 1, j, v) });
for (const dt of ['2026-13-01', '2026-02-30', '20261120', '']) exact(`K20 progress: the date "${dt}"`, gOver(0, dt), `PROGRESS line 3: the date "${dt}" is not a calendar date YYYY-MM-DD`);
for (const c of ['ABCDEF12', 'abc', 'zzzzzzzz', 'a'.repeat(41)]) exact(`K21 progress: the commit "${c}"`, gOver(1, c), `PROGRESS line 3: the commit "${c}" is not 8 to 40 lowercase hex characters`);
for (const [j, name] of [[2, 'works'], [3, 'partly'], [4, 'built'], [5, 'total']]) for (const v of ['x', '-1', '1.5']) if (!(j === 5 && 0)) exact(`K22 progress: ${name} ${v}`, gOver(j, v), `PROGRESS line 3: the ${name} "${v}" is not a whole number`);
exact('K23 progress: built above total', gOver(4, '4'), 'PROGRESS line 3: built is above total');
exact('K24 progress: a date before the line above', gOver(0, '2026-11-01'), 'PROGRESS line 3: the date 2026-11-01 is before the line above (2026-11-10)');
exact('K24 progress: the same day twice is allowed', gOver(0, '2026-11-10'));
exact('K25 progress: the same commit twice', gOver(1, 'aaaaaaaa'), 'PROGRESS line 3: the commit aaaaaaaa is already on line 2');
// round 2: a number is written one way, a commit at any length, a table that did not parse, spaces, rows that exist, named twice
for (const v of ['01', '+1', ' 1', '1 ']) {
  exact(`K27 parts: the cluster "${v}"`, pOver(1, 5, v), `PARTS line 3: the cluster column holds "${v}", not one cluster number`);
  exact(`K27 parts: the owner "${v}"`, pOver(1, 4, v), `PARTS line 3: the owner column holds "${v}", not owner item numbers`);
  exact(`K27 clusters: the number "${v}"`, cOver(1, 0, v), `CLUSTERS line 3: the number "${v}" is not a whole number`);
  exact(`K27 clusters: the needs "${v}"`, cOver(1, 3, v), `CLUSTERS line 3: the needs column holds "${v}", not owner item numbers`);
  exact(`K27 owner: the number "${v}"`, oOver(1, 0, v), `OWNER line 3: the number "${v}" is not a whole number`);
  exact(`K27 progress: works "${v}"`, gOver(2, v), `PROGRESS line 3: the works "${v}" is not a whole number`);
}
const B8 = 'bbbbbbbb', B40 = 'b'.repeat(40);
const twoCommits = (c1, c2) => mapDir({ progress: [['2026-11-10', c1, '1', '2', '1', '3'], ['2026-11-20', c2, '2', '1', '2', '3']] });
exact('K28 progress: a commit of 8 characters, then the same of 40', twoCommits(B8, B40), `PROGRESS line 3: the commit ${B40} is already on line 2`);
exact('K28 progress: a commit of 40 characters, then the same of 8', twoCommits(B40, B8), `PROGRESS line 3: the commit ${B8} is already on line 2`);
exact('K28 progress: two different commits of 8 and 40 characters pass', twoCommits(B8, 'c'.repeat(40)));
exact('K29 a table with a wrong column count is not a reference: one line only', mapDir({ clusters: cell(CLUSTERS, 1, 3, '1 2 3') }, d => put(d, 'work/map/owner.tsv', tsv(OH, ...OWNER) + '3\tgo\tx\n')), 'OWNER line 4: has 3 columns, not 7');
exact('K29 a table with a bad number is not a reference: one line only', mapDir({ parts: cell(PARTS, 1, 4, '9') }, d => put(d, 'work/map/owner.tsv', tsv(OH, ...cell(OWNER, 1, 0, '5')))), 'OWNER line 3: the number is 5, expected 2');
exact('K30 parts: a part of one space is empty', pOver(1, 1, ' '), 'PARTS line 3: the part is empty');
exact('K30 parts: a what of one space is empty', pOver(1, 2, ' '), 'PARTS line 3: the what is empty');
exact('K30 clusters: a cluster of one space is empty', cOver(1, 1, ' '), 'CLUSTERS line 3: the cluster is empty');
exact('K30 clusters: a closes of one space is empty', cOver(1, 2, ' '), 'CLUSTERS line 3: the closes is empty');
exact('K30 owner: a he does of one space is empty', oOver(1, 2, ' '), 'OWNER line 3: the he does is empty');
exact('K31 clusters: closes names a row that does not exist', cOver(1, 2, 'A99'), 'CLUSTERS line 3: the row A99 is not in docs/product/1-product.md');
exact('K31 owner: opens names a row that does not exist', oOver(1, 4, 'E99'), 'OWNER line 3: the row E99 is not in docs/product/1-product.md');
exact('K31 owner: opens in words with real rows passes', oOver(1, 4, 'E1, the path to E2.'));
exact('K31 a tree with no book skips closes and opens', mapDir({}, d => { rm(d, 'docs/product'); put(d, 'work/map/clusters.tsv', tsv(CH, ...cell(CLUSTERS, 1, 2, 'A99'))); }));
exact('K32 parts: an owner item named twice', pOver(1, 4, '1 1'), 'PARTS line 3: the owner item 1 is named twice');
exact('K32 clusters: an owner item named twice', cOver(1, 3, '1 1'), 'CLUSTERS line 3: the owner item 1 is named twice');
exact('K33 work/map is a file', mapDir({}, d => { rm(d, 'work/map'); put(d, 'work/map', 'x'); }), 'PARTS: work/map is not a folder');
// the real repository
if (existsSync(join(REPO, 'docs/product/1-product.md'))) {
  const t0 = Date.now(), real = checkMap(REPO), ms = Date.now() - t0;
  check('K26 real tables: this repository passes', real.length === 0, real.join(' / '));
  check('K26 real tables: the check takes under 2 seconds', ms < 2000, `${ms} ms`);
} else check('K26 real tables: the repository is found at OMNIKOM_ICM_ROOT or two folders above tools/icm', false, REPO);

// ---- progress.mjs ----
const node = (script, args, env = {}, cwd) => {
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', script, ...args], { encoding: 'utf8', timeout: 60000, cwd, env: { ...process.env, ...env } });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
};
const NOGIT = d => ({ GIT_CEILING_DIRECTORIES: dirname(d) });
const prog = (d, ...a) => node(join(TOOLS, 'progress.mjs'), ['--root', d, ...a], NOGIT(d));
const snap = d => DATA.map(r => rd(d, r)).join('\u0000');
const empty = (edit = () => {}, book) => mapDir({ progress: [] }, edit, book);
{
  const d = empty(), before = snap(d), others = DATA.slice(0, 3).map(r => rd(d, r));
  const r = prog(d, '--commit', 'cccccccc', '--date', '2026-11-21');
  const line = ['2026-11-21', 'cccccccc', '1', '2', '1', '3'].join(TAB);
  check('R1 progress: the counts, the line and nothing else changed', r.status === 0 && r.out === line + '\n' && rd(d, 'work/map/progress.tsv') === tsv(GH, line) && DATA.slice(0, 3).every((f, i) => rd(d, f) === others[i]), `${r.status} ${JSON.stringify(r.out)} ${r.err}`);
  const after = snap(d); // the snapshot is taken BEFORE the second run and compared after it
  const r3 = prog(d, '--commit', 'cccccccc', '--date', '2026-11-21');
  check('R3 progress: the same commit twice is refused, the file is unchanged', r3.status === 1 && r3.out === 'PROGRESS: the commit cccccccc is already on line 2\n' && snap(d) === after && after !== before, `${r3.status} ${JSON.stringify(r3.out)}`);
}
for (const [first, second] of [['bbbbbbbb', 'b'.repeat(40)], ['b'.repeat(40), 'bbbbbbbb']]) { // one commit at any length
  const d = empty(), a = prog(d, '--commit', first, '--date', '2026-11-21'), before = snap(d);
  const r = prog(d, '--commit', second, '--date', '2026-11-21');
  check(`R3 progress: the commit given with ${first.length} characters, then with ${second.length}, is refused and the file is unchanged`, a.status === 0 && r.status === 1 && r.out === `PROGRESS: the commit ${second} is already on line 2\n` && snap(d) === before, `${r.status} ${JSON.stringify(r.out)}`);
}
{
  const d = empty(dd => put(dd, 'docs/product/1-product.md', BOOK.replace('| A2 Two | PARTLY', '| A2 Two | WORKS')));
  const r = prog(d, '--commit', 'cccccccc', '--date', '2026-11-21');
  check('R2 progress: the counts come from the rows, not the Counts table', r.status === 0 && r.out === ['2026-11-21', 'cccccccc', '2', '1', '1', '3'].join(TAB) + '\n', `${r.status} ${JSON.stringify(r.out)}`);
}
{
  const d = mapDir({ progress: [], parts: cell(PARTS, 1, 3, 'BUILT-UNPROVEN') });
  const r = prog(d, '--commit', 'cccccccc', '--date', '2026-11-21');
  check('R2 progress: built counts BUILT only, not BUILT-UNPROVEN', r.status === 0 && r.out === ['2026-11-21', 'cccccccc', '1', '2', '1', '3'].join(TAB) + '\n', `${r.status} ${JSON.stringify(r.out)}`);
}
{
  const d = mapDir(), before = snap(d);
  const r = prog(d, '--commit', 'dddddddd', '--date', '2026-11-01');
  check('R4 progress: a date before the last line is refused, the file is unchanged', r.status === 1 && r.out === "PROGRESS: the date 2026-11-01 is before the last line's date 2026-11-20\n" && snap(d) === before, `${r.status} ${JSON.stringify(r.out)}`);
  const ok = prog(d, '--commit', 'dddddddd', '--date', '2026-11-20');
  check('R4 progress: the same day as the last line is allowed', ok.status === 0 && rd(d, 'work/map/progress.tsv').endsWith(['2026-11-20', 'dddddddd', '1', '2', '1', '3'].join(TAB) + '\n'), `${ok.status} ${ok.out}`);
}
{
  const d = mapDir({ parts: cell(PARTS, 1, 3, 'DONE'), progress: [] }), before = snap(d);
  const r = prog(d, '--commit', 'cccccccc', '--date', '2026-11-21');
  check('R5 progress: a data problem exits 1, names the line, the file is unchanged', r.status === 1 && r.out.startsWith('PARTS line 3: the verdict "DONE"') && snap(d) === before, `${r.status} ${JSON.stringify(r.out)}`);
}
{
  const d = empty();
  const r = prog(d);
  check('R6 progress: no flags and no git exits 1 and says so', r.status === 1 && r.out === 'PROGRESS: no commit: give --commit <sha>\n', `${r.status} ${JSON.stringify(r.out)} ${r.err}`);
  for (const [name, a] of [['a short commit', ['--commit', 'abc']], ['a bad date', ['--commit', 'cccccccc', '--date', '2026-02-30']], ['an unknown flag', ['--x']], ['a positional', ['cccccccc']], ['--commit with no value', ['--commit']]]) {
    const x = prog(d, ...a);
    check(`R6 progress: ${name} exits 2 with a usage line`, x.status === 2 && /^usage: /i.test(x.out + x.err), `${x.status} ${x.out}${x.err}`);
  }
}
{
  const d = empty(), g = a => spawnSync('git', a, { cwd: d, encoding: 'utf8', timeout: 30000, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
  g(['init', '-q']); g(['commit', '-q', '--allow-empty', '-m', 'one']);
  const head = (g(['rev-parse', 'HEAD']).stdout || '').trim().slice(0, 8);
  const r = prog(d, '--date', '2026-11-21');
  check('R7 progress: with no --commit the first 8 characters of HEAD are appended', head.length === 8 && r.status === 0 && r.out.split(TAB)[1] === head, `${r.status} ${JSON.stringify(r.out)} head ${head}`);
}
{
  const d = empty(), a = new Date().toISOString().slice(0, 10);
  const r = prog(d, '--commit', 'cccccccc'), b = new Date().toISOString().slice(0, 10), got = r.out.split(TAB)[0];
  check('R8 progress: with no --date the date is today (UTC)', r.status === 0 && /^\d{4}-\d{2}-\d{2}$/.test(got) && (got === a || got === b), `${r.status} ${JSON.stringify(r.out)}`);
}
{
  const d = mapDir({}, dd => rm(dd, 'work/map/progress.tsv'));
  const r = prog(d, '--commit', 'cccccccc');
  check('R9 progress: no progress.tsv exits 1', r.status === 1 && r.out === 'PROGRESS: work/map/progress.tsv is missing\n', `${r.status} ${JSON.stringify(r.out)}`);
  const f = mapDir({}, dd => { rm(dd, 'work/map/progress.tsv'); mkdirSync(join(dd, 'work/map/progress.tsv')); });
  const x = prog(f, '--commit', 'cccccccc');
  check('R9 progress: a progress.tsv that is a folder exits 1 and nothing is written', x.status === 1 && x.out === 'PROGRESS: work/map/progress.tsv is not a file\n', `${x.status} ${JSON.stringify(x.out)}`);
  const n = empty(dd => writeFileSync(join(dd, 'work/map/progress.tsv'), GH.join(TAB)));
  const y = prog(n, '--commit', 'cccccccc', '--date', '2026-11-21');
  check('R9 progress: a file with no line end at its end is refused and unchanged', y.status === 1 && y.out === 'PROGRESS: work/map/progress.tsv does not end with a line end\n' && rd(n, 'work/map/progress.tsv') === GH.join(TAB), `${y.status} ${JSON.stringify(y.out)}`);
}

// ---- map-page.mjs ----
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const sec = (h, id) => { const m = new RegExp(`<section id="${id}"[\\s\\S]*?</section>`).exec(h); return m ? m[0] : ''; };
const lis = h => [...h.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m => m[1]);
const liOf = (h, id) => lis(h).find(x => x.includes(`<b>${id}</b>`)) || '';
const pageRun = (d, args = [], base = ['--out', null, '--date', '2026-11-21']) => {
  const out = join(bare(), 'map.html');
  const a = [...base.map(x => (x === null ? out : x)), ...args];
  const r = node(join(TOOLS, 'map-page.mjs'), ['--root', d, ...a], NOGIT(d));
  return { ...r, file: out, html: existsSync(out) ? readFileSync(out, 'utf8') : null };
};
const page = (d, args) => pageRun(d, args);
const truthFile = body => { const f = join(bare(), 'truth.json'); writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)); return f; };
{
  const g = page(mapDir()), h = g.html || '', t = text(h);
  check('G1 page: exit 0, the file is written, the wrote line has the size', g.status === 0 && h !== '' && g.out === `wrote ${g.file} (${Buffer.byteLength(h)} bytes)
`, `${g.status} ${g.out} ${g.err}`);
  check('G1 page: the head of the document', h.startsWith('<!doctype html>') && h.includes('<html lang="en">') && h.includes('<meta name="viewport" content="width=device-width, initial-scale=1">') && h.includes('<title>Omnikom Progress Map</title>'), h.slice(0, 200));
  check('G1 page: the counts are recounted from the rows', t.includes('1 of 5 rows work, 2 partly, 2 missing') && t.includes('A: 1 work, 1 partly, 1 missing of 3') && t.includes('E: 0 work, 1 partly, 1 missing of 2'), t.slice(0, 600));
  check('G1 page: the parts count and the date', t.includes('Parts: 1 of 3 built') && t.includes('2026-11-21'), t.slice(0, 600));
  const order = ['counts', 'pace', 'rows', 'parts', 'clusters', 'owner'].map(s => h.indexOf(`<section id="${s}"`));
  check('G1 page: the sections come in order and each has an h2', order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])) && ['counts', 'pace', 'rows', 'parts', 'clusters', 'owner'].every(s => /<h2>/.test(sec(h, s))), order.join());
  const a1 = text(liOf(sec(h, 'rows'), 'A1')), a2 = text(liOf(sec(h, 'rows'), 'A2'));
  check('G2 rows: A1 is listed with its name, state and 1 test line', a1.includes('One') && a1.includes('WORKS') && a1.includes('1 test line') && !a1.includes('1 test lines'), a1);
  check('G2 rows: A2 shows no test line and its state word', a2.includes('Two') && a2.includes('PARTLY') && a2.includes('no test line') && a2.includes('the second half'), a2);
  check('G2 rows: a WORKS row does not show its third cell', !a1.includes('src/real.mjs'), a1);
  const gl = text(liOf(sec(h, 'parts'), 'GL.G1'));
  check('G3 parts: GL.G1 is listed with part, what, cluster and owner items', gl.includes('Two buckets') && gl.includes('R2 and a second provider') && gl.includes('owner items 1 2') && gl.includes('cluster 2'), gl);
  check('G3 parts: SS.B-1 is listed, the BUILT part is counted and not listed', liOf(sec(h, 'parts'), 'SS.B-1') !== '' && !h.includes('<b>GL.E1a</b>') && text(sec(h, 'parts')).includes('NOT BUILT 2') && text(sec(h, 'parts')).includes('BUILT 1'), text(sec(h, 'parts')));
  const c2 = text(liOf(sec(h, 'clusters'), '2')), c1 = text(liOf(sec(h, 'clusters'), '1'));
  check('G4 clusters: name, size, parts by verdict and owner items', c2.includes('Backups for real') && c2.includes('medium') && c2.includes('2 NOT BUILT') && c2.includes('owner items 1 2') && c1.includes('The book tells the truth') && c1.includes('small') && c1.includes('1 BUILT') && c1.includes('owner items 1'), `${c1} / ${c2}`);
  const ow = sec(h, 'owner');
  check('G5 owner: the open item comes before the answered one, which shows its answer', ow.indexOf('Signs in to GitHub') > 0 && ow.indexOf('Signs in to GitHub') < ow.indexOf('Picks the plan') && text(ow).includes('Free for now'), text(ow));
  check('G7 truth: without --truth the page has no truth section', !h.includes('id="truth"'));
}
{ // G2: the 240 character cut
  const long = 'z'.repeat(300);
  const h = page(mapDir({}, () => {}, BOOK.replace('the second half', long))).html || '';
  check('G2 rows: the third cell of a row that does not work is cut at 240 characters', h.includes('z'.repeat(240)) && !h.includes('z'.repeat(241)), h.length);
  const o = mapDir({ owner: [OWNER[1], OWNER[0]].map((r, i) => [String(i + 1), ...r.slice(1)]) });
  const w = page(o).html || '';
  check('G5 owner: open before answered also when the answered item is first', w.indexOf('Signs in to GitHub') > 0 && w.indexOf('Picks the plan') > 0 && w.indexOf('Signs in to GitHub') < w.indexOf('Picks the plan'), '');
}
{ // G6 pace
  const pace = rows => text(sec(page(mapDir({ progress: rows })).html || '', 'pace'));
  check('G6 pace: no data line', pace([]).includes('No landing is recorded yet.'), pace([]));
  check('G6 pace: one line', pace([P1]).includes('One landing is recorded (2026-11-10); the pace needs two.'), pace([P1]));
  const two = pace([P1, P2]);
  check('G6 pace: two lines and the list of landings', two.includes('From 2026-11-10 to 2026-11-20 (10 days): WORKS 1 to 2 (0.7 a week), parts built 1 to 2 (0.7 a week).') && two.includes('2026-11-20 bbbbbbbb') && two.includes('2026-11-10 aaaaaaaa'), two);
  check('G6 pace: two lines on the same day', pace([P1, ['2026-11-10', 'bbbbbbbb', '2', '1', '2', '3']]).includes('The pace needs two different days.'));
  const three = pace([['2026-11-01', 'a1111111', '1', '2', '0', '3'], ['2026-11-05', 'a2222222', '5', '0', '1', '3'], ['2026-11-15', 'a3333333', '8', '0', '2', '3']]);
  check('G6 pace: the pace runs from the first line to the last, per week', three.includes('From 2026-11-01 to 2026-11-15 (14 days): WORKS 1 to 8 (3.5 a week), parts built 0 to 2 (1.0 a week).'), three);
  const many = Array.from({ length: 14 }, (_, i) => [`2026-11-${String(i + 1).padStart(2, '0')}`, String(i).padStart(8, 'e'), '1', '1', '1', '3']);
  const m = pace(many);
  check('G6 pace: only the last 12 landings are listed', m.includes('2026-11-14') && m.includes('2026-11-03 ') && !m.includes('2026-11-02 ') && !m.includes('2026-11-01 e'), m);
}
{ // G7 truth
  const T = { ok: false, data: { indicators: [{ id: 'book', state: 'OK', summary: 'no drift', items: [] }, { id: 'proof', state: 'DRIFT', summary: '1 problem', items: [{ what: 'PROOF line 3: x', where: '' }] }] } };
  const g = page(mapDir(), ['--truth', truthFile(T)]), s = text(sec(g.html || '', 'truth'));
  check('G7 truth: the section shows each indicator and its items', g.status === 0 && (g.html || '').includes('id="truth"') && s.includes('OK book: no drift') && s.includes('DRIFT proof: 1 problem') && s.includes('PROOF line 3: x'), `${g.status} ${s}`);
  const bad = (name, body, why) => {
    const f = truthFile(body), r = page(mapDir(), ['--truth', f]);
    check(`G7 truth: ${name} is refused`, r.status === 1 && r.html === null && new RegExp(`^TRUTH: .* is not an omnikom truth --json output: ${why}`).test(r.out), `${r.status} ${r.out}`);
  };
  bad('a file that is not JSON', '{nope', '.+');
  bad('a file with no data.indicators', { ok: true, data: {} }, '.+');
  bad('a state outside OK, DRIFT, BLOCKED', { data: { indicators: [{ id: 'a', state: 'FINE', summary: 's', items: [] }] } }, '.+');
  bad('an indicator with no summary', { data: { indicators: [{ id: 'a', state: 'OK', items: [] }] } }, '.+');
  bad('an item that is not { what, where }', { data: { indicators: [{ id: 'a', state: 'DRIFT', summary: 's', items: [{ what: 1, where: '' }] }] } }, '.+');
  bad('an item that is a string', { data: { indicators: [{ id: 'a', state: 'DRIFT', summary: 's', items: ['x'] }] } }, '.+');
  const nf = page(mapDir(), ['--truth', join(bare(), 'nothing.json')]);
  check('G7 truth: a path that is not a file', nf.status === 1 && /^TRUTH: .*nothing\.json is not a readable file\n$/.test(nf.out || '') && nf.html === null, `${nf.status} ${nf.out}`);
  const bigf = join(bare(), 'big.json'); writeFileSync(bigf, ' '.repeat(5 * 1024 * 1024 + 1));
  const big = page(mapDir(), ['--truth', bigf]);
  check('G7 truth: a file over 5 MB', big.status === 1 && /^TRUTH: .*big\.json is over 5 MB\n$/.test(big.out || '') && big.html === null, `${big.status} ${big.out}`);
}
{ // G8 self-contained and phone
  const h = page(mapDir(), ['--truth', truthFile({ data: { indicators: [] } })]).html || '';
  const css = (/<style>([\s\S]*?)<\/style>/.exec(h) || [, ''])[1];
  const hrefs = [...h.matchAll(/href=("[^"]*"|'[^']*')/g)].map(m => m[1].slice(1, -1));
  const widths = [...css.matchAll(/(?<![-\w])width:\s*(\d+)px/g)].map(m => Number(m[1])), mins = [...css.matchAll(/min-width:\s*(\d+)px/g)].map(m => Number(m[1]));
  check('G8 page: no script, no link, no import, no src, no table, no inline handler', !/<script|<link|@import|\bsrc=|<table|\son[a-z]+=/i.test(h), '');
  check('G8 page: every href starts with #', hrefs.length > 0 && hrefs.every(x => x.startsWith('#')), hrefs.join());
  check('G8 page: the dark theme is guarded and can be forced', css.includes('prefers-color-scheme: dark') && css.includes(':root:not([data-theme="light"])') && css.includes(':root[data-theme="dark"]'), css.slice(0, 200));
  check('G8 page: an explicit background on body, wrapping text', /body\s*\{[^}]*background:/.test(css) && css.includes('overflow-wrap:anywhere'), css.slice(0, 200));
  check('G8 page: no min-width above 320px and no fixed width of 400px or more', mins.every(x => x <= 320) && widths.every(x => x < 400), `${mins} ${widths}`);
  check('G8 page: lists are ul and dl', h.includes('<ul>') && h.includes('<dl>'), '');
}
{ // G9 escaping, G10 same twice
  const d = mapDir({ parts: cell(PARTS, 1, 1, '<b>&"x"') });
  const g = page(d), h = g.html || '';
  check('G9 escaping: a part text is escaped everywhere', h.includes('&lt;b&gt;&amp;&quot;x&quot;') && !h.includes('<b>&'), '');
  const a = page(mapDir()).html, b = page(mapDir()).html;
  check('G10 page: the same inputs and --date give the same bytes twice', a !== null && a === b, '');
}
{ // G11 a data problem, G12 usage, out is a data file
  const d = mapDir({ parts: cell(PARTS, 1, 3, 'DONE') }), g = page(d);
  check('G11 page: a data problem exits 1, prints the line, writes no file', g.status === 1 && g.out.startsWith('PARTS line 3: the verdict "DONE"') && g.html === null, `${g.status} ${g.out}`);
  const ok = mapDir(), u = join(bare(), 'u.html');
  const run = (...a) => node(join(TOOLS, 'map-page.mjs'), ['--root', ok, ...a], NOGIT(ok));
  const no = run('--date', '2026-11-21');
  check('G12 page: no --out exits 2 with a usage line', no.status === 2 && /^usage: /i.test(no.out + no.err), `${no.status} ${no.out}${no.err}`);
  for (const [name, a] of [['an unknown flag', ['--out', u, '--x']], ['a positional', ['--out', u, 'x']], ['a bad --date', ['--out', u, '--date', '2026-02-30']], ['--out with no value', ['--out']]]) {
    const x = run(...a);
    check(`G12 page: ${name} exits 2`, x.status === 2 && !existsSync(u), `${x.status} ${x.out}${x.err}`);
  }
  const nof = join(bare(), 'nodir', 'x.html'), nx = run('--out', nof);
  check('G12 page: --out in a folder that does not exist exits 1 and makes no folder', nx.status === 1 && nx.out === `MAP: cannot write ${nof}\n` && !existsSync(dirname(nof)), `${nx.status} ${nx.out}`);
  const fo = bare(), fx = run('--out', fo);
  check('G12 page: --out an existing folder exits 1', fx.status === 1 && fx.out === `MAP: ${fo} is a folder\n`, `${fx.status} ${fx.out}`);
  // the page is never written inside the repository: a data file, its upper-case spelling, another file, a new file
  const bytes = rel => readFileSync(join(ok, rel));
  for (const [name, out, rel] of [['a data file', join(ok, 'work/map/parts.tsv'), 'work/map/parts.tsv'], ['the upper-case spelling of a data file', join(ok, 'work/MAP/Parts.TSV'), 'work/map/parts.tsv'], ['docs/product/proof.tsv', join(ok, 'docs/product/proof.tsv'), 'docs/product/proof.tsv'], ['a new file name', join(ok, 'new-page.html'), null]]) {
    // where the file system tells letter case apart (the runner), the upper-case spelling is a new path, not the data file
    const there = existsSync(out), before = rel && bytes(rel), dx = run('--out', out);
    // an existing file is refused first as "exists already"; only a new path inside the repository reaches the "inside" refusal
    const msg = there ? `MAP: ${out} exists already (the page is written only to a new path)\n` : `MAP: ${out} is inside the repository\n`;
    check(`G12 page: --out ${name} inside the repository exits 1, writes nothing`, dx.status === 1 && dx.out === msg && (!rel || bytes(rel).equals(before)) && (there || !existsSync(out)), `${dx.status} ${dx.out}`);
  }
  { // X nothing is ever overwritten: a plain file, a dangling link into the root, a hard link to a file in the root
    const exMsg = f => `MAP: ${f} exists already (the page is written only to a new path)\n`;
    const pf = join(bare(), 'old.html'); writeFileSync(pf, 'OLD');
    const x1 = run('--out', pf);
    check('X1 page: --out an existing plain file outside the root exits 1 and the file is byte-equal', x1.status === 1 && x1.out === exMsg(pf) && readFileSync(pf, 'utf8') === 'OLD', `${x1.status} ${x1.out}`);
    const tgt = join(ok, 'via-link.html'), lk = join(bare(), 'link.html');
    let kind = 'file symbolic link';
    try { symlinkSync(tgt, lk, 'file'); } catch { kind = 'junction'; mkdirSync(join(ok, 'jtarget')); symlinkSync(join(ok, 'jtarget'), lk, 'junction'); }
    const x2 = run('--out', lk);
    check(`X2 page: --out a dangling ${kind} outside the root exits 1 and nothing is created inside the root`, x2.status === 1 && x2.out === exMsg(lk) && !existsSync(tgt) && (kind !== 'junction' || readdirSync(join(ok, 'jtarget')).length === 0), `${x2.status} ${x2.out}`);
    const inside = join(ok, 'work/map/parts.tsv'), hl = join(bare(), 'hard.html'), inb = readFileSync(inside);
    linkSync(inside, hl);
    const x3 = run('--out', hl);
    check('X3 page: --out a hard link outside the root to a data file exits 1 and the inside file is byte-equal', x3.status === 1 && x3.out === exMsg(hl) && readFileSync(inside).equals(inb), `${x3.status} ${x3.out}`);
  }
  const w = run('--out', u, '--date', '2026-11-21');
  check('G1 page: the wrote line names the file and its size', w.status === 0 && w.out === `wrote ${u} (${readFileSync(u).length} bytes)\n`, `${w.status} ${w.out}`);
}
// W1 wiring: --check runs the map check
{
  const mk = rows => { const d = bare(); cpSyncFixture(d); put(d, 'work/map/parts.tsv', tsv(PH, ...rows.map(r => r.map((c, j) => (j === 6 ? '' : c))))); put(d, 'work/map/clusters.tsv', tsv(CH, ...CLUSTERS)); put(d, 'work/map/owner.tsv', tsv(OH, ...OWNER)); put(d, 'work/map/progress.tsv', tsv(GH)); return d; };
  const idx = (d, ...a) => { const r = spawnSync(process.execPath, [join(TOOLS, 'index.mjs'), '--root', d, ...a], { encoding: 'utf8', timeout: 60000 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const good = mk(PARTS); idx(good);
  const g = idx(good, '--check');
  check('W1 wiring: --check passes on a valid map and prints no PARTS line', g.status === 0 && /^OK/.test(g.out) && !/^PARTS/m.test(g.out), g.out);
  const bad = mk(cell(PARTS, 1, 3, 'DONE')); idx(bad);
  const b = idx(bad, '--check'), pl = b.out.split('\n').filter(l => l.startsWith('PARTS'));
  check('W1 wiring: --check exits 1 and prints exactly one PARTS line for a bad verdict', b.status === 1 && pl.length === 1 && pl[0].startsWith('PARTS line 3: the verdict "DONE"'), b.out);
}

for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(`\nicm map tests: ${total - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
