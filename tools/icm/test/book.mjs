// Tests for tools/icm/book-check.mjs (hardening step H0-6): a small valid book is written into a temp folder, broken in ONE way,
// and checked; the output must be exactly the one BOOK line that names the problem. A few cases go through the CLI
// (index.mjs --check on a copy of test/fixture). The last two checks run the real book of this repository.
//   node tools/icm/test/book.mjs      exit 0 = every check passed. Lines start with "ok  " or "FAIL ".
// OMNIKOM_ICM_TOOLS points at a copy of tools/icm (test/mutate.mjs runs one broken copy at a time);
// OMNIKOM_ICM_ROOT is the repository whose real book is checked (mutate.mjs passes it, the copy has no repository around it).
import { mkdtempSync, cpSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.OMNIKOM_ICM_TOOLS ? resolve(process.env.OMNIKOM_ICM_TOOLS) : resolve(HERE, '..');
const REPO = process.env.OMNIKOM_ICM_ROOT ? resolve(process.env.OMNIKOM_ICM_ROOT) : resolve(TOOLS, '..', '..');
const FIXTURE = join(TOOLS, 'test', 'fixture');
const { checkBook } = await import(pathToFileURL(join(TOOLS, 'book-check.mjs')).href);
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
  const good = bookDir(swap('`D:pages/Home.tsx`, `F:cap`, ', ''), undefined, fixtureCopy); index(good);
  let r = index(good, '--check');
  check('cli: --check on a tree with a consistent book exits 0', r.status === 0 && /^OK: icm index is fresh/.test(r.out), r.out);
  const bad = bookDir(s => swap('| Total | 1 | 2 | 2 | 5 |', '| Total | 1 | 2 | 2 | 6 |')(swap('`D:pages/Home.tsx`, `F:cap`, ', '')(s)), undefined, fixtureCopy);
  // no index written first: --check also prints its STALE lines, the BOOK lines are the ones under test
  r = index(bad, '--check');
  const badBook = r.out.split('\n').filter(l => /^BOOK/.test(l));
  check('cli: --check exits 1 and prints exactly the one BOOK line for a wrong Total', r.status === 1 && badBook.length === 1 && /^BOOK COUNTS: Total says/.test(badBook[0]), r.out);
  r = index(fixtureCopy(), '--check');
  check('cli: the fixture (no book files) prints no BOOK line', !/BOOK/.test(r.out), r.out);

  // the real book on master
  if (existsSync(join(REPO, 'docs/product/1-product.md'))) {
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
