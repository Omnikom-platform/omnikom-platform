// Tests for tools/icm/book-check.mjs (hardening step H0-6): a small valid book is written into a temp folder, broken in ONE way,
// and checked; the output must be exactly the one BOOK line that names the problem. A few cases go through the CLI
// (index.mjs --check on a copy of test/fixture). The last two checks run the real book of this repository.
//   node tools/icm/test/book.mjs      exit 0 = every check passed. Lines start with "ok  " or "FAIL ".
// OMNIKOM_ICM_TOOLS points at a copy of tools/icm (test/mutate.mjs runs one broken copy at a time);
// OMNIKOM_ICM_ROOT is the repository whose real book is checked (mutate.mjs passes it, the copy has no repository around it).
import { mkdtempSync, cpSync, rmSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.OMNIKOM_ICM_TOOLS ? resolve(process.env.OMNIKOM_ICM_TOOLS) : resolve(HERE, '..');
const REPO = process.env.OMNIKOM_ICM_ROOT ? resolve(process.env.OMNIKOM_ICM_ROOT) : resolve(TOOLS, '..', '..');
const FIXTURE = join(TOOLS, 'test', 'fixture');
const { checkBook } = await import(pathToFileURL(join(TOOLS, 'book-check.mjs')).href);
const { checkTruth } = await import(pathToFileURL(join(TOOLS, 'truth-check.mjs')).href);
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 400)}`); };
const index = (dir, ...args) => { const r = spawnSync(process.execPath, [join(TOOLS, 'index.mjs'), '--root', dir, ...args], { encoding: 'utf8', timeout: 60000 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const put = (dir, rel, text) => { const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, 'utf8'); };
const dirs = [];
const bare = () => { const d = mkdtempSync(join(tmpdir(), 'omnikom-icm-book-')); dirs.push(d); return d; };
const fixtureCopy = () => { const d = bare(); cpSync(FIXTURE, d, { recursive: true }); return d; };

const BOOK = [
  '# The product', '',
  'Short forms: `D:` = `apps/dashboard/src/`, `F:x` = `supabase/functions/x/`, `M1`-`M13` = migrations.', '',
  '### A. The first part', '| Feature | State | Missing half, or where it lives |', '|---|---|---|',
  '| A1 One | WORKS | `src/real.mjs`, `D:pages/Home.tsx`, `F:cap`, M12, route `/w/site`, `lead_update`, `9-blocks.md` |',
  '| A2 Two | PARTLY, to be removed | `src/not-checked.mjs` is named by a row that is not WORKS |',
  '| A3 Three | MISSING | |', '',
  '### E. Hardening', '| Feature | State | Missing half, or where it lives |', '|---|---|---|',
  '| E1 Backups | MISSING | |', '| E2 Monitoring | PARTLY | |', '',
  '### Counts', '| Part | WORKS | PARTLY | MISSING | Rows |', '|---|---|---|---|---|',
  '| A First | 1 | 1 | 1 | 3 |', '| E Hardening | 0 | 1 | 1 | 2 |', '| Total | 1 | 2 | 2 | 5 |', '',
].join('\n');
const BLOCKS = [
  '# Blocks', '', '## Hardening steps (found 2026-11-05)', '', '| Step | Stage | The gap, in short | Owner | Row |', '|---|---|---|---|---|',
  '| H0-1 | H0 | a gap | platform build | E1 |', '| H0-2 | H0 | another gap | head of operations | E2 |', '| H3 | H3 | the rest | each owner | as found |', '',
  '## What each department builds next', '', '| Not | a | step | table | row |', '',
].join('\n');
const swap = (from, to) => s => { if (!s.includes(from)) throw new Error('test setup: text not found: ' + from); return s.replace(from, to); };
// a tree holding the book and the files its WORKS rows name; withSources false leaves out the ones no fixture charter owns
const bookDir = (editBook = s => s, editBlocks = s => s, base = bare) => {
  const b = base();
  put(b, 'docs/product/1-product.md', editBook(BOOK));
  put(b, 'docs/product/9-blocks.md', editBlocks(BLOCKS));
  put(b, 'src/real.mjs', 'export const REAL = 1;\n');
  if (base === bare) { put(b, 'apps/dashboard/src/pages/Home.tsx', 'export const Home = 1;\n'); put(b, 'supabase/functions/cap/index.ts', 'export default 1;\n'); }
  return b;
};
const run = b => { let lines; try { lines = checkBook(b); } catch (e) { lines = ['THREW: ' + e.message]; } return { status: lines.length ? 1 : 0, lines, out: lines.join('\n') }; };
const oneLine = (name, b, re) => { const x = run(b); check(name, x.lines.length === 1 && re.test(x.lines[0]), x.out); };
const someLine = (name, b, re) => { const x = run(b); check(name, x.lines.some(l => re.test(l)), x.out); };

// ---- the truth checks (truth-check.mjs): proof.tsv, callers, config, STATE ----
const TAB = '\t';
const tsv = (...ls) => ls.map(l => (Array.isArray(l) ? l.join(TAB) : l)).join('\n') + '\n';
const PH = ['row', 'kind', 'path', 'token'], AH = ['function', 'row', 'reason'];
const REAL_TEST = 'tools/fx/test/real.test.mjs';
const A1 = ['A1', 'test', REAL_TEST, 'real title'];
const SRC = 'tools/fx/src.mjs', SRC_TOK = 'export const X = 1'; // a token is at least 8 characters
const P14MSG = 'a test line must name a test file (with a code extension; a folder test or tests, or .test. or .spec. in its name, or a name starting test- or e2e-)';
const GATES_FILE = 'docs/blueprint/specs/run-all-gates.mjs';
const gatesText = (...g) => `const GATES = [\n${g.map(x => `  ['a gate', '${x}'],   // 'not/a-gate.mjs' in a comment`).join('\n')}\n];\n`;
const MIG = 'supabase/migrations/20261101000001_one.sql';
const MIG_TEXT = [
  'create function service.used_by_code() returns int language sql as $$ select 1 $$;',
  'create function service.used_by_sql() returns int language sql as $$ select 2 $$;',
  'create function service.top() returns int language sql as $$ select service.used_by_sql() $$;', '',
].join('\n');
const LONELY = 'create function service.lonely() returns int language sql as $$ select 9 $$;\n';
const STATE = [
  '# State', '', '## Now',
  '- Product: 1 of 5 rows WORK, 2 PARTLY, 2 MISSING (checked by CI). First 1, 1, 1 of 3; hardening 0, 1, 1 of 2.', '',
  '## Migrations', '- In the tree: through 1.', '',
].join('\n');
const stateLines = n => STATE + Array.from({ length: n - 7 }, (_, i) => `- filler ${i}`).join('\n') + '\n';
const truthDir = (edit = () => {}) => {
  const d = bare();
  put(d, 'docs/product/1-product.md', BOOK); put(d, 'docs/product/9-blocks.md', BLOCKS);
  put(d, 'docs/product/proof.tsv', tsv(PH, A1));
  put(d, REAL_TEST, "test('real title', () => {});\n"); put(d, 'tools/fx/src.mjs', 'export const X = 1;\n');
  put(d, MIG, MIG_TEXT);
  put(d, 'supabase/functions/f/index.ts', 'await sql`select service.used_by_code(), service.top()`\n// service.lonely() is only a comment\n');
  put(d, 'supabase/config.toml', '[functions.f]\nverify_jwt = true\n');
  put(d, 'docs/product/callers-allow.tsv', tsv(AH));
  put(d, 'work/STATE.md', STATE);
  edit(d);
  return d;
};
const rm = (d, rel) => rmSync(join(d, rel), { recursive: true, force: true });
const truthLines = d => { try { return checkTruth(d); } catch (e) { return ['THREW: ' + e.message]; } };
const exact = (name, d, ...want) => { const l = truthLines(d); check(name, l.length === want.length && want.every((w, i) => l[i] === w), l.join(' / ')); };
const proofWith = (...ls) => truthDir(d => put(d, 'docs/product/proof.tsv', tsv(PH, A1, ...ls)));
const lonelyDir = (edit = () => {}) => truthDir(d => { put(d, MIG, MIG_TEXT + LONELY); edit(d); });
const addToMig = text => d => put(d, MIG, MIG_TEXT + LONELY + text);
const allowWith = (...ls) => lonelyDir(d => put(d, 'docs/product/callers-allow.tsv', tsv(AH, ...ls)));
const configWith = text => truthDir(d => put(d, 'supabase/config.toml', '[functions.f]\nverify_jwt = true\n' + text));
const stateWith = edit => truthDir(d => put(d, 'work/STATE.md', edit(STATE)));
const secondMigration = (d, name, text, through) => { put(d, `supabase/migrations/${name}`, text); put(d, 'work/STATE.md', STATE.replace('through 1', 'through ' + through)); };
const NOCALL = n => `CALLERS: service.${n} has no caller outside tests and comments; call it, drop it, or list it in docs/product/callers-allow.tsv`;
const ALLOW = 'CALLERS: docs/product/callers-allow.tsv';
const P3 = n => `PROOF line 3: ${n}`;
const fixTruth = d => { // the valid proof and STATE for a fixture copy (its charters own work/, not tools/)
  put(d, 'docs/product/proof.tsv', tsv(PH, ['A1', 'test', 'work/test/real.test.mjs', 'real title']));
  put(d, 'work/test/real.test.mjs', "test('real title', () => {});\n"); put(d, 'work/STATE.md', STATE);
};

try {
  let x = run(bookDir());
  check('pass: a consistent book (route, M-number, plain words skipped; short forms and a bare book file resolved)', x.status === 0, x.out);
  check('pass: a tree with neither book file is not checked', checkBook(bare()).length === 0);
  oneLine('book files: only one of the two present is named', (() => { const b = bookDir(); rmSync(join(b, 'docs/product/9-blocks.md')); return b; })(), /^BOOK: docs\/product\/9-blocks\.md is missing/);

  // (a) counts
  oneLine('counts: a wrong WORKS count in a part is named', bookDir(swap('| A First | 1 | 1 | 1 | 3 |', '| A First | 2 | 1 | 1 | 3 |')), /^BOOK COUNTS: part A says 2 works, 1 partly, 1 missing, 3 rows.*its rows give 1 works, 1 partly, 1 missing, 3 rows/);
  oneLine('counts: a wrong Rows count is named', bookDir(swap('| E Hardening | 0 | 1 | 1 | 2 |', '| E Hardening | 0 | 1 | 1 | 3 |')), /^BOOK COUNTS: part E says 0 works, 1 partly, 1 missing, 3 rows/);
  oneLine('counts: a wrong Total is named', bookDir(swap('| Total | 1 | 2 | 2 | 5 |', '| Total | 1 | 2 | 2 | 6 |')), /^BOOK COUNTS: Total says .*6 rows, the parts' rows give 1 works, 2 partly, 2 missing, 5 rows/);
  someLine('counts: a row whose state changed while the table did not is named (part and Total)', bookDir(swap('| A1 One | WORKS |', '| A1 One | MISSING |')), /^BOOK COUNTS: part A says 1 works/);
  oneLine('counts: a part with no Counts row is named', bookDir(swap('| E Hardening | 0 | 1 | 1 | 2 |\n', '')), /^BOOK COUNTS: part E has 2 rows but no row in the Counts table/);
  oneLine('counts: a Counts row for a part with no section is named', bookDir(swap('| Total |', '| F Ghost | 0 | 0 | 0 | 0 |\n| Total |')), /^BOOK COUNTS: the Counts table has a row for part F, which has no "### F\." section/);
  oneLine('counts: no Total row is named', bookDir(swap('| Total | 1 | 2 | 2 | 5 |\n', '')), /^BOOK COUNTS: the Counts table has no Total row/);
  someLine('counts: a state that is not WORKS, PARTLY or MISSING is named', bookDir(swap('| A3 Three | MISSING |', '| A3 Three | WORK |')), /^BOOK ROWS: A3 has the state "WORK"/);
  someLine('counts: a row of another part under this part is named', bookDir(swap('| A3 Three |', '| B3 Three |')), /^BOOK ROWS: B3 sits under part A/);
  // a new part letter is counted with no change to the tool
  const withF = s => s.replace('### Counts', '### F. A new part\n| Feature | State | Missing half, or where it lives |\n|---|---|---|\n| F1 New | WORKS | |\n\n### Counts').replace('| Total | 1 | 2 | 2 | 5 |', '| F New | 1 | 0 | 0 | 1 |\n| Total | 2 | 2 | 2 | 6 |');
  x = run(bookDir(withF));
  check('counts: a new part F with its Counts row and the new Total passes', x.status === 0, x.out);
  oneLine('counts: a new part F typed wrong in Counts is named', bookDir(s => withF(s).replace('| F New | 1 | 0 | 0 | 1 |', '| F New | 0 | 0 | 1 | 1 |')), /^BOOK COUNTS: part F says 0 works, 0 partly, 1 missing, 1 rows/);

  // (b) WORKS paths
  oneLine('paths: a WORKS row naming a file that does not exist is named', bookDir(swap('`src/real.mjs`', '`src/gone.mjs`')), /^BOOK PATHS: A1 is WORKS and names `src\/gone\.mjs`, which does not exist/);
  oneLine('paths: a book file named bare that does not exist is named', bookDir(swap('`9-blocks.md`', '`9-nothing.md`')), /^BOOK PATHS: A1 .*`9-nothing\.md`/);
  oneLine('paths: a D: short form is resolved, a missing one named', bookDir(swap('`D:pages/Home.tsx`', '`D:pages/Gone.tsx`')), /^BOOK PATHS: A1 .*`D:pages\/Gone\.tsx`/);
  oneLine('paths: an F: short form names a folder, a missing one named', bookDir(swap('`F:cap`', '`F:nocap`')), /^BOOK PATHS: A1 .*`F:nocap`/);
  x = run(bookDir(swap('`/w/site`', '`/w/gone`')));
  check('paths: a route (leading slash) is not a path', x.status === 0, x.out);
  x = run(bookDir(swap('`src/not-checked.mjs`', '`src/not-checked.mjs`, `src/gone3.mjs`')));
  check('paths: a PARTLY row naming a missing path is not checked', x.status === 0, x.out);

  // (c) hardening steps
  oneLine('steps: a step with an empty owner is named', bookDir(undefined, swap('| platform build | E1 |', '|  | E1 |')), /^BOOK STEPS: step H0-1 has no owner/);
  oneLine('steps: a step naming a row that does not exist is named', bookDir(undefined, swap('| head of operations | E2 |', '| head of operations | E2 E9 |')), /^BOOK STEPS: step H0-2 names row E9, which is not in docs\/product\/1-product\.md/);
  oneLine('steps: a part E row named by no step is named', bookDir(undefined, swap('| head of operations | E2 |', '| head of operations | E1 |')), /^BOOK STEPS: part E row E2 is named by no hardening step/);
  someLine('steps: a step with an empty Row cell is named', bookDir(undefined, swap('| head of operations | E2 |', '| head of operations |  |')), /^BOOK STEPS: step H0-2 names no row of the book/);
  someLine('steps: no hardening-steps table is named', bookDir(undefined, swap('## Hardening steps', '## Other steps')), /^BOOK STEPS: docs\/product\/9-blocks\.md has no "Hardening steps" table/);

  // the CLI: --check inside index.mjs
  const good = bookDir(swap('`D:pages/Home.tsx`, `F:cap`, ', ''), undefined, fixtureCopy); fixTruth(good); index(good);
  let r = index(good, '--check');
  check('cli: --check on a tree with a consistent book exits 0', r.status === 0 && /^OK: icm index is fresh/.test(r.out), r.out);
  const bad = bookDir(s => swap('| Total | 1 | 2 | 2 | 5 |', '| Total | 1 | 2 | 2 | 6 |')(swap('`D:pages/Home.tsx`, `F:cap`, ', '')(s)), undefined, fixtureCopy); fixTruth(bad);
  // no index written first: --check also prints its STALE lines, the BOOK lines are the ones under test
  r = index(bad, '--check');
  const badBook = r.out.split('\n').filter(l => /^BOOK/.test(l));
  check('cli: --check exits 1 and prints exactly the one BOOK line for a wrong Total', r.status === 1 && badBook.length === 1 && /^BOOK COUNTS: Total says/.test(badBook[0]), r.out);
  r = index(fixtureCopy(), '--check');
  check('cli: the fixture (no book files) prints no BOOK line', !/BOOK/.test(r.out), r.out);
  const noProof = bookDir(swap('`D:pages/Home.tsx`, `F:cap`, ', ''), undefined, fixtureCopy); fixTruth(noProof); rm(noProof, 'docs/product/proof.tsv'); index(noProof);
  r = index(noProof, '--check');
  const proofLines = r.out.split('\n').filter(l => /^PROOF/.test(l));
  check('cli: --check exits 1 and prints exactly one PROOF line when proof.tsv is deleted', r.status === 1 && proofLines.length === 1 && /^PROOF: docs\/product\/proof\.tsv is missing/.test(proofLines[0]), r.out);

  // ---- PROOF ----
  exact('P0 truth: the valid tree gives no line', truthDir());
  exact('P1 truth: a tree with neither book file gives no line', bare());
  exact('P2 proof: proof.tsv missing', truthDir(d => rm(d, 'docs/product/proof.tsv')), 'PROOF: docs/product/proof.tsv is missing');
  exact('P3 proof: proof.tsv is a folder', truthDir(d => { rm(d, 'docs/product/proof.tsv'); mkdirSync(join(d, 'docs/product/proof.tsv')); }), 'PROOF: docs/product/proof.tsv is not a file');
  exact('P4 proof: a changed header', truthDir(d => put(d, 'docs/product/proof.tsv', tsv(['row', 'kind', 'path'], A1))), 'PROOF line 1: the first line must be exactly: row | kind | path | token');
  exact('P5 proof: a carriage return', truthDir(d => put(d, 'docs/product/proof.tsv', tsv(PH, A1).replace(/\n/g, '\r\n'))), 'PROOF: docs/product/proof.tsv has a carriage return');
  exact('P6 proof: a blank line in the middle', proofWith('', ['A2', 'code', SRC, SRC_TOK]), P3('the line is empty'));
  exact('P7 proof: a WORKS row with no test line', truthDir(d => put(d, 'docs/product/proof.tsv', tsv(PH))), 'PROOF: A1 is WORKS and has no test line in docs/product/proof.tsv');
  exact('P8 proof: a code line is not proof of WORKS', truthDir(d => put(d, 'docs/product/proof.tsv', tsv(PH, ['A1', 'code', REAL_TEST, 'real title']))), 'PROOF: A1 is WORKS and has no test line in docs/product/proof.tsv');
  exact('P9 proof: 3 columns', proofWith(['A2', 'code', 'tools/fx/src.mjs']), P3('has 3 columns, not 4'));
  exact('P9 proof: 5 columns', proofWith(['A2', 'code', 'tools/fx/src.mjs', 'X', 'more']), P3('has 5 columns, not 4'));
  exact('P10 proof: the kind unit', proofWith(['A2', 'unit', 'tools/fx/src.mjs', 'X']), P3('the kind "unit" is not test or code'));
  exact('P11 proof: an empty token', proofWith(['A2', 'test', REAL_TEST, '']), P3('the token is empty'));
  exact('P11 proof: a token of one space', proofWith(['A2', 'test', REAL_TEST, ' ']), P3('the token is empty'));
  exact('P11 proof: a space at the start of the token', proofWith(['A2', 'test', REAL_TEST, ' real title']), P3('the token has a space at its start or end'));
  exact('P11 proof: a space at the end of the token', proofWith(['A2', 'test', REAL_TEST, 'real title ']), P3('the token has a space at its start or end'));
  exact('P12 proof: a token that is not in the file', proofWith(['A2', 'test', REAL_TEST, 'no such title']), P3(`the token is not in ${REAL_TEST}`));
  const link = d => { const out = bare(); put(out, 'x.mjs', 'export const X = 1;\n'); mkdirSync(join(d, 'tools/fx'), { recursive: true }); symlinkSync(out, join(d, 'tools/fx/link'), 'junction'); };
  for (const p of ['../x/y.mjs', '/abs/x.mjs', 'C:/x/y.mjs', 'tools\\fx\\src.mjs', 'tools/fx/./src.mjs', 'tools/fx//src.mjs', 'tools/fx/src.mjs.', 'tools/FX/src.mjs', 'tools/fx/none.mjs', 'tools/fx', 'tools/fx/../fx/src.mjs',
    'film/x.mjs', 'creds and accounts login/omnikom.env', 'clients/x/private/y.mjs', 'tools/fx/.env', 'tools/fx/link/x.mjs']) {
    // a path that is refused only by its own rule must exist, or "absent" would refuse it first
    const d = truthDir(dd => { if (p.endsWith('link/x.mjs')) link(dd); else if (['film/x.mjs', 'creds and accounts login/omnikom.env', 'clients/x/private/y.mjs', 'tools/fx/.env'].includes(p)) put(dd, p, 'export const X = 1;\n'); put(dd, 'docs/product/proof.tsv', tsv(PH, A1, ['A2', 'code', p, SRC_TOK])); });
    exact(`P13 proof: the path ${p} is refused`, d, P3(`the path ${p} is not a file of this repository under that exact spelling`));
  }
  exact('P14 proof: a test line must name a test file', proofWith(['A2', 'test', SRC, SRC_TOK]), P3(P14MSG));
  exact('P15 proof: a duplicate line', truthDir(d => put(d, 'docs/product/proof.tsv', tsv(PH, A1, A1))), P3('duplicates line 2'));
  exact('P16 proof: a row that is not in the book', proofWith(['Z9', 'test', REAL_TEST, 'real title']), P3('row Z9 is not in docs/product/1-product.md'));
  exact('P17 proof: a good code line for a PARTLY row', proofWith(['A2', 'code', SRC, SRC_TOK]));
  exact('P17 proof: a wrong token on a PARTLY row', proofWith(['A2', 'code', SRC, 'no such token']), P3('the token is not in tools/fx/src.mjs'));

  // round 2 (T1-R2): PROOF holes 7 to 9
  const withFiles = (files, ...ls) => truthDir(d => { for (const [p, t] of Object.entries(files)) put(d, p, t); put(d, 'docs/product/proof.tsv', tsv(PH, A1, ...ls)); });
  exact('P19 hole 7 proof: a test line may not name a .md file with a test-like name', withFiles({ 'docs/x.test.md': 'a real title here\n' }, ['A2', 'test', 'docs/x.test.md', 'a real title']), P3(P14MSG));
  exact('P19 hole 7 proof: a test line may not name a .json file in a tests folder', withFiles({ 'tools/fx/tests/data.json': '{"a":"a real title"}\n' }, ['A2', 'test', 'tools/fx/tests/data.json', 'a real title']), P3(P14MSG));
  for (const ext of ['ts', 'tsx', 'js', 'mjs', 'cjs', 'sql']) exact(`P19 hole 7 proof: a test line may name a .${ext} test file`, withFiles({ [`tools/fx/test/y.${ext}`]: 'a real title here\n' }, ['A2', 'test', `tools/fx/test/y.${ext}`, 'a real title']));
  const GATE = 'tools/fx/gate.mjs', gateLine = ['A2', 'test', GATE, 'the gate passes'];
  exact('P20 hole 8 proof: a test line may name a gate listed in run-all-gates.mjs', withFiles({ [GATES_FILE]: gatesText(GATE), [GATE]: 'console.log("the gate passes");\n' }, gateLine));
  exact('P20 hole 8 proof: a gate the gates file does not list is not a test file', withFiles({ [GATES_FILE]: gatesText('tools/fx/other.mjs'), [GATE]: 'console.log("the gate passes");\n' }, gateLine), P3(P14MSG));
  exact('P20 hole 8 proof: a path only in a comment of the gates file is not a gate', withFiles({ [GATES_FILE]: gatesText('tools/fx/other.mjs').replace('not/a-gate.mjs', GATE), [GATE]: 'console.log("the gate passes");\n' }, gateLine), P3(P14MSG));
  exact('P20 hole 8 proof: with no gates file the rule adds nothing', withFiles({ [GATE]: 'console.log("the gate passes");\n' }, gateLine), P3(P14MSG));
  exact('P21 hole 9 proof: a token of 7 characters is too short', proofWith(['A2', 'code', SRC, 'const X']), P3('the token is shorter than 8 characters'));
  exact('P21 hole 9 proof: a token of 8 characters is long enough', proofWith(['A2', 'code', SRC, 'rt const']));
  for (const mark of ['//', '--', '#', '*'])
    exact(`P22 hole 9 proof: a token only in a ${mark} comment line`, withFiles({ 'tools/fx/c.mjs': `export const Y = 1;\n  ${mark} only in a comment here\n` }, ['A2', 'code', 'tools/fx/c.mjs', 'only in a comment here']), P3('the token stands only in a comment of tools/fx/c.mjs'));
  exact('P22 hole 9 proof: a token in a comment and in code counts', withFiles({ 'tools/fx/c.mjs': "// shared token text\nconst s = 'shared token text';\n" }, ['A2', 'code', 'tools/fx/c.mjs', 'shared token text']));

  // ---- CALLERS ----
  exact('C0 callers: the valid tree gives no line', truthDir());
  exact('C1 callers: a function nothing calls (its only mention is a comment)', lonelyDir(), NOCALL('lonely'));
  exact('C2 callers: a mention in a test path does not count', lonelyDir(d => put(d, 'supabase/functions/f/test/x.test.ts', 'await sql`select service.lonely()`\n')), NOCALL('lonely'));
  exact('C2 callers: a mention in a .md under tools does not count', lonelyDir(d => put(d, 'tools/doc.md', 'select service.lonely()\n')), NOCALL('lonely'));
  exact('C2 callers: a grant does not count', lonelyDir(addToMig('grant execute on function service.lonely() to x;\n')), NOCALL('lonely'));
  exact('C2 callers: a revoke does not count', lonelyDir(addToMig('revoke all on function service.lonely() from public;\n')), NOCALL('lonely'));
  exact('C2 callers: a comment on function does not count', lonelyDir(addToMig("comment on function service.lonely() is 'x';\n")), NOCALL('lonely'));
  exact('C2 callers: an alter function does not count', lonelyDir(addToMig('alter function service.lonely() owner to x;\n')), NOCALL('lonely'));
  exact('C2 callers: a mention in an SQL comment does not count', lonelyDir(addToMig('-- select service.lonely();\n/* select service.lonely(); */\n')), NOCALL('lonely'));
  exact('C2 callers: a // comment after code does not count', lonelyDir(d => put(d, 'tools/g/run.mjs', 'const a = 1; // select service.lonely()\n/* select service.lonely() */\n')), NOCALL('lonely'));
  exact('C3 callers: a function called only from another body gives no line', truthDir());
  exact('C4 callers: the old body of a replaced function does not count', truthDir(d => secondMigration(d, '20261101000002_two.sql', 'create or replace function service.top() returns int language sql as $$ select 3 $$;\n', 2)), NOCALL('used_by_sql'));
  exact('C5 callers: create then create or replace is one function', truthDir(d => { secondMigration(d, '20261101000002_two.sql', 'create or replace function service.top() returns int language sql as $$ select service.used_by_sql() $$;\n', 2); put(d, 'supabase/functions/f/index.ts', 'await sql`select service.used_by_code()`\n'); }), NOCALL('top'), NOCALL('used_by_sql')); // top once; its callee is dead with it
  exact('C5 callers: a function in any case and spacing is read', truthDir(d => put(d, MIG, MIG_TEXT + 'CREATE   OR  REPLACE FUNCTION  Service.Lonely ( ) returns int language sql as $$ select 9 $$;\n')), NOCALL('lonely'));
  exact('C6 callers: a cron statement counts as a caller', lonelyDir(addToMig("select cron.schedule('j', '* * * * *', 'select service.lonely()');\n")));
  exact('C6 callers: a semicolon inside a dollar quote does not split a statement', truthDir(d => put(d, MIG, MIG_TEXT + 'create function service.lonely() returns int language sql as $a$ select 1; select service.lonely() $a$;\n')), NOCALL('lonely'));
  for (const [what, rel, text] of [['tools', 'tools/g/run.mjs', 'const q = "select service.lonely()";\n'], ['apps', 'apps/dashboard/src/x.ts', 'const q = "select service.lonely()";\n'],
    ['.github', '.github/workflows/w.yml', 'run: select service.lonely()\n'], ['supabase/ops', 'supabase/ops/o.mjs', 'const q = "select service.lonely()";\n'], ['factory', 'factory/z.mjs', 'const q = "select service.lonely()";\n']])
    exact(`C7 callers: a caller in ${what} counts`, lonelyDir(d => put(d, rel, text)));
  exact('C7 callers: a caller in node_modules does not count', lonelyDir(d => put(d, 'tools/node_modules/p/i.mjs', 'const q = "select service.lonely()";\n')), NOCALL('lonely'));
  exact('C8 callers: an allow line with a row', allowWith(['lonely', 'A2', 'called by the sync job']));
  exact('C8 callers: an allow line with a dash', allowWith(['lonely', '-', 'parked in 10-expansion.md']));
  exact('C9 callers: an allow line for a function that has a caller', truthDir(d => put(d, 'docs/product/callers-allow.tsv', tsv(AH, ['used_by_code', '-', 'parked']))), 'CALLERS: service.used_by_code is in docs/product/callers-allow.tsv but has a caller; remove the line');
  exact('C10 callers: an allow line for an unknown function', truthDir(d => put(d, 'docs/product/callers-allow.tsv', tsv(AH, ['ghost', '-', 'parked']))), `${ALLOW} line 2: service.ghost is created by no migration`);
  exact('C11 callers: an allow line with an unknown row', allowWith(['lonely', 'Z9', 'x']), `${ALLOW} line 2: row Z9 is not in docs/product/1-product.md`);
  exact('C12 callers: an empty reason', allowWith(['lonely', 'A2', '']), `${ALLOW} line 2: the reason is empty`);
  exact('C13 callers: two lines for one function', allowWith(['lonely', 'A2', 'x'], ['lonely', 'A2', 'y']), `${ALLOW} line 3: duplicates line 2`);
  exact('C14 callers: a changed header', truthDir(d => put(d, 'docs/product/callers-allow.tsv', tsv(['function', 'row']))), 'CALLERS line 1: the first line must be exactly: function | row | reason');
  exact('C14 callers: a carriage return', truthDir(d => put(d, 'docs/product/callers-allow.tsv', tsv(AH).replace(/\n/g, '\r\n'))), 'CALLERS: docs/product/callers-allow.tsv has a carriage return');
  exact('C14 callers: a wrong column count', truthDir(d => put(d, 'docs/product/callers-allow.tsv', tsv(AH, ['x', 'y']))), 'CALLERS line 2: has 2 columns, not 3');
  exact('C15 callers: a tree with no supabase/migrations gives no line', truthDir(d => rm(d, 'supabase/migrations')));

  // round 2 (T1-R2): CALLERS holes 1 to 6
  const lonelyCode = (rel, text) => lonelyDir(d => put(d, rel, text));
  exact('C16 hole 1 callers: a mention that is not a call does not count', lonelyCode('tools/g/run.mjs', "console.log('service.lonely is dead')\n"), NOCALL('lonely'));
  exact('C16 hole 1 callers: a call with a space before the bracket counts', lonelyCode('tools/g/run.mjs', 'const q = "select service.lonely ()";\n'));
  exact('C17 hole 2 callers: a YAML comment line does not count', lonelyCode('.github/workflows/w.yml', '# service.lonely()\n'), NOCALL('lonely'));
  exact('C17 hole 2 callers: a YAML comment after a space does not count', lonelyCode('.github/workflows/w.yml', 'run: echo hi # service.lonely()\n'), NOCALL('lonely'));
  exact('C17 hole 2 callers: a real run line in YAML counts', lonelyCode('.github/workflows/w.yml', 'run: psql -c "select service.lonely()"\n'));
  exact('C18 hole 3 callers: /* inside strings does not remove real code', lonelyCode('tools/g/run.mjs', "'a/*/b'; sql`select service.lonely()`; 'c/*/d'\n"));
  exact('C18 hole 3 callers: a call inside a real block comment and after a real // does not count', lonelyCode('tools/g/run.mjs', "const a = 'it'; /* service.lonely() */ // service.lonely()\n"), NOCALL('lonely'));
  exact('C19 hole 4 callers: a semicolon inside a SQL string does not split a statement', lonelyDir(addToMig("comment on function service.lonely() is 'a; select service.lonely()';\n")), NOCALL('lonely'));
  exact('C19 hole 4 callers: an escaped quote does not end the SQL string', lonelyDir(addToMig("comment on function service.lonely() is 'it''s; select service.lonely()';\n")), NOCALL('lonely'));
  exact('C20 hole 5 callers: a dropped function is gone', lonelyDir(addToMig('drop function service.lonely();\n')));
  exact('C20 hole 5 callers: drop function if exists also drops it', lonelyDir(addToMig('drop function if exists service.lonely();\n')));
  exact('C20 hole 5 callers: an allow line for a dropped function is created by no migration', lonelyDir(d => { addToMig('drop function service.lonely();\n')(d); put(d, 'docs/product/callers-allow.tsv', tsv(AH, ['lonely', '-', 'parked'])); }), `${ALLOW} line 2: service.lonely is created by no migration`);
  exact('C20 hole 5 callers: a drop followed by a later create keeps the function', lonelyDir(d => { addToMig('drop function service.lonely();\n')(d); secondMigration(d, '20261101000002_two.sql', LONELY, 2); }), NOCALL('lonely'));
  const AB = 'create function service.a() returns int language sql as $$ select service.b() $$;\ncreate function service.b() returns int language sql as $$ select service.a() $$;\n';
  exact('C21 hole 6 callers: two functions that only call each other are both dead', truthDir(d => put(d, MIG, MIG_TEXT + AB)), NOCALL('a'), NOCALL('b'));
  exact('C21 hole 6 callers: a function called only by a dead public function is dead', lonelyDir(addToMig('create function public.p() returns int language sql as $$ select service.lonely() $$;\n')), NOCALL('lonely'));
  exact('C21 hole 6 callers: a public function called by code is live, and so is what it calls', lonelyDir(d => { addToMig('create function p() returns int language sql as $$ select service.lonely() $$;\n')(d); put(d, 'tools/g/run.mjs', 'const q = "select public.p()";\n'); }));
  exact('C21 hole 6 callers: a function called only by a trigger statement is live', lonelyDir(addToMig('create trigger t after insert on x for each row execute function service.lonely();\n')));

  // ---- CONFIG ----
  exact('G0 config: the valid tree gives no line', truthDir());
  exact('G1 config: a table with no folder', configWith('[functions.ghost]\nverify_jwt = true\n'), 'CONFIG: supabase/config.toml names [functions.ghost], which has no supabase/functions/ghost/index.ts');
  exact('G2 config: a folder with an index.ts and no table', truthDir(d => put(d, 'supabase/functions/g/index.ts', 'export default 1;\n')), 'CONFIG: supabase/functions/g has an index.ts and no [functions.g] in supabase/config.toml');
  const testFn = d => mkdirSync(join(d, 'supabase/functions/test'), { recursive: true });
  exact('G3 config: enabled = false excuses a table with no index.ts', truthDir(d => { testFn(d); put(d, 'supabase/config.toml', '[functions.f]\nverify_jwt = true\n[functions.test]\nenabled = false # off\n'); }));
  exact('G3 config: the same table without enabled = false is named', truthDir(d => { testFn(d); put(d, 'supabase/config.toml', '[functions.f]\nverify_jwt = true\n[functions.test]\nverify_jwt = true\n'); }), 'CONFIG: supabase/config.toml names [functions.test], which has no supabase/functions/test/index.ts');
  exact('G4 config: a _shared folder needs no table', truthDir(d => put(d, 'supabase/functions/_shared/x.ts', 'export default 1;\n')));
  exact('G5 config: a table listed twice', configWith('[functions.f]\nverify_jwt = true\n'), 'CONFIG: [functions.f] is listed twice in supabase/config.toml');
  exact('G6 config: a tree with no config.toml gives no line', truthDir(d => rm(d, 'supabase/config.toml')));

  // ---- STATE ----
  exact('S0 state: the valid tree gives no line', truthDir());
  exact('S1 state: 59 lines give no line', truthDir(d => put(d, 'work/STATE.md', stateLines(59))));
  exact('S1 state: 60 lines are over the limit', truthDir(d => put(d, 'work/STATE.md', stateLines(60))), 'STATE: work/STATE.md has 60 lines, the limit is 59');
  exact('S2 state: a changed Product total', stateWith(swap('1 of 5 rows WORK', '2 of 5 rows WORK')), 'STATE: the Product line says 2 of 5 rows WORK, 2 PARTLY, 2 MISSING; the Counts table gives 1 of 5 rows WORK, 2 PARTLY, 2 MISSING');
  exact('S3 state: a changed part group', stateWith(swap('First 1, 1, 1 of 3', 'First 2, 1, 1 of 3')), 'STATE: the Product line says 2, 1, 1 of 3 for part A; the Counts table gives 1, 1, 1 of 3');
  exact('S4 state: a missing part group', stateWith(swap('; hardening 0, 1, 1 of 2', '')), 'STATE: the Product line gives 1 part groups; the Counts table has 2 parts');
  exact('S5 state: no Product line', stateWith(swap('- Product:', '- Count:')), 'STATE: work/STATE.md has no Product line with its counts');
  exact('S6 state: a Product line wrapped over two lines', stateWith(swap('First 1, 1, 1 of 3; hardening', 'First 1, 1, 1 of 3;\n  hardening')));
  exact('S7 state: a wrong migration number', stateWith(swap('through 1', 'through 5')), 'STATE: work/STATE.md says migrations run through 5, supabase/migrations holds 1');
  exact('S8 state: no number after through', stateWith(swap('through 1', 'up to 1')), 'STATE: the "## Migrations" section of work/STATE.md names no number after "through"');
  exact('S9 state: 12 is above 9 (the number is read as a number)', truthDir(d => { put(d, 'supabase/migrations/20261101000009_n.sql', '-- nine\n'); secondMigration(d, '20261101000012_x.sql', '-- twelve\n', 12); }));
  exact('S9 state: the highest number is not the last file name', truthDir(d => { put(d, 'supabase/migrations/20261102000003_late.sql', '-- three\n'); put(d, 'supabase/migrations/20261101000012_x.sql', '-- twelve\n'); put(d, 'work/STATE.md', STATE.replace('through 1', 'through 12')); }));
  exact('S10 state: a tree with no work/STATE.md gives no line', truthDir(d => rm(d, 'work/STATE.md')));
  exact('S11 state: work/STATE.md is a folder', truthDir(d => { rm(d, 'work/STATE.md'); mkdirSync(join(d, 'work/STATE.md')); }), 'STATE: work/STATE.md is not a file');

  // the real book on master
  if (existsSync(join(REPO, 'docs/product/1-product.md'))) {
    const tt = Date.now();
    const realTruth = checkTruth(REPO);
    const tms = Date.now() - tt;
    check('P18 C16 real truth: this repository passes the proof, callers, config and state checks', realTruth.length === 0, realTruth.join(' / '));
    check('P18 real truth: the check takes under 5 seconds', tms < 5000, `${tms} ms`);
    const t0 = Date.now();
    const real = checkBook(REPO);
    const ms = Date.now() - t0;
    check('real book: this repository\'s book passes', real.length === 0, real.join(' / '));
    check('real book: the check takes under 1 second', ms < 1000, `${ms} ms`);
  } else check('real book: found at OMNIKOM_ICM_ROOT or two folders above tools/icm', false, REPO);
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log(`\nicm book tests: ${total - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
