// Watched-fail for tools/icm: a broken COPY of tools/icm with ONE rule removed, test/run.mjs against it (OMNIKOM_ICM_TOOLS), the
// suite must go red on a named check. Pattern of tools/departments/test/mutate.mjs: [name, file, exactText, replacement], applied
// with split/join, the target text must occur exactly once, one child process per mutant with a timeout. A mutant
// of book-check.mjs (or of the call to it) runs test/book.mjs; every other mutant runs test/run.mjs (optional fifth field).
//   node tools/icm/test/mutate.mjs      exit 0 = every mutant caught (--book: only the book-check mutants; --map: only the map mutants; --match <text>: only mutants whose name has it)
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOOK = 'book.mjs';
const MAP = 'map.mjs';
const MUTANTS = [
  ['the shortest prefix wins, not the longest', 'index.mjs', 'o.path.length > best.path.length', 'o.path.length < best.path.length'],
  ['an except clause is ignored', 'index.mjs', 'o.except.some(x => under(path, x))', 'false'],
  ['the departments README is read as a charter', 'index.mjs', "f === 'README.md' || f === 'TEMPLATE.md'", 'false'],
  ['a long summary is cut to 160 plus the dots', 'index.mjs', "summary.slice(0, SUMMARY_MAX - 3) + '...'", 'summary.slice(0, SUMMARY_MAX)'],
  ['a summary of exactly 160 is cut too', 'index.mjs', 'summary.length > SUMMARY_MAX', 'summary.length >= SUMMARY_MAX'],
  ['.gitignore is not read', 'index.mjs', 'if (SKIP_DIRS.has(e.name) || isIgnored(stack, r, true)) continue;', 'if (SKIP_DIRS.has(e.name)) continue;'],
  ['archive/ is walked', 'index.mjs', "'.secrets', 'archive']", "'.secrets']"],
  ['the 300 line cap is 301', 'index.mjs', 'const PRODUCT_DOC_MAX = 300;', 'const PRODUCT_DOC_MAX = 301;'],
  ['work/STATE.md is layer 2, not 4', 'index.mjs', "p === 'work/STATE.md' ||", 'false ||'],
  ['class exports are not found', 'index.mjs', 'const|let|var|class|type|interface|enum', 'const|let|var|type|interface|enum'],
  ['sql tables are not found', 'index.mjs', "out.add('table:' + m[1]", "out.add('tbl:' + m[1]"],
  ['sql comments are read', 'index.mjs', "text.replace(/--[^\\n]*/g, '')", 'text'],
  ['a generic name matches every test that names it', 'index.mjs', 'if (GENERIC_BASE.test(base)) {', 'if (false) {'],
  ['load-for is not read', 'index.mjs', "loadFor: lf ? lf.split(',').map(s => s.trim()).filter(Boolean) : [],", 'loadFor: [],'],
  ['load-for is read past line 10', 'index.mjs', 'for (const l of lines.slice(0, 10))', 'for (const l of lines.slice(0, 40))'],
  ['feature is not read', 'index.mjs', "feature: feat || ''", "feature: ''"],
  ['a random mark in INDEX.md', 'index.mjs', "const L = ['# ICM index', '',", "const L = ['# ICM index ' + Math.random(), '',"],
  ['unchanged files are rewritten', 'index.mjs', "if (existsSync(abs) && readFileSync(abs, 'utf8') === text) continue;", ''],
  ['--quiet still prints', 'index.mjs', "if (!flag('--quiet')) {\n", 'if (true) {\n'],
  ['an unowned source file passes the check', 'index.mjs', 'for (const f of files) if (!f.owner) problems.push(', 'for (const f of []) if (!f.owner) problems.push('],
  ['a doc gone from the tree is not stale', 'index.mjs', 'for (const p of was.keys()) if (!now.has(p)) out.push(', 'for (const p of []) if (!now.has(p)) out.push('],
  ['a hand edit of the markdown is not stale', 'index.mjs', "else lines.push(`STALE ${rel}: differs from what the tree generates`);", ''],
  ['a missing icm/ file passes', 'index.mjs', 'if (!existsSync(abs)) { lines.push(`MISSING ${rel}: run node tools/icm/index.mjs`); continue; }', 'if (!existsSync(abs)) continue;'],
  // the book check (H0-6); test/book.mjs
  ['the book check is not called by --check', 'index.mjs', '[...b.problems, ...checkBook(root), ...checkTruth(root), ...checkMap(root)]', '[...b.problems, ...checkTruth(root), ...checkMap(root)]', BOOK],
  ['a part count is not compared with its rows', 'book-check.mjs', 'if (c.nums.join() !== got.join()) out.push(', 'if (false) out.push(', BOOK],
  ['the Total row is not compared with the parts', 'book-check.mjs', 'else if (total.nums.join() !== sum.join())', 'else if (false)', BOOK],
  ['a part with no Counts row passes', 'book-check.mjs', 'if (!c) { out.push(', 'if (!c) { [].push(', BOOK],
  ['a Counts row for a part with no section passes', 'book-check.mjs', 'if (!book.parts.has(letter)) out.push(', 'if (false) out.push(', BOOK],
  ['a missing Total row passes', 'book-check.mjs', "if (!total) out.push('BOOK COUNTS: the Counts table has no Total row');", 'if (!total) {}', BOOK],
  ['only parts A to E are counted', 'book-check.mjs', '/^([A-Z])\\. (.*)$/.exec(h[1])', '/^([A-E])\\. (.*)$/.exec(h[1])', BOOK],
  ['a state outside WORKS, PARTLY, MISSING passes', 'book-check.mjs', 'if (!STATES.includes(state)) problems.push(', 'if (false) problems.push(', BOOK],
  ['a row under the wrong part passes', 'book-check.mjs', 'if (m[1] !== part) problems.push(', 'if (false) problems.push(', BOOK],
  ['a missing WORKS path passes', 'book-check.mjs', 'if (!exists(root, path)) out.push(', 'if (false) out.push(', BOOK],
  ['rows that are not WORKS have their paths checked', 'book-check.mjs', "if (r.state !== 'WORKS') continue;", '', BOOK],
  ['short forms are not resolved', 'book-check.mjs', 'if (!forms[short[1]]) continue;', 'continue;', BOOK],
  ['a route is read as a path', 'book-check.mjs', "|| s.startsWith('/')) continue;", ') continue;', BOOK],
  ['a step with no owner passes', 'book-check.mjs', "if (!(c[col.owner] || '').trim()) out.push(", 'if (false) out.push(', BOOK],
  ['a step naming a row that does not exist passes', 'book-check.mjs', 'if (!known.has(id)) out.push(', 'if (false) out.push(', BOOK],
  ['a step with an empty Row cell passes', 'book-check.mjs', 'if (!rowCell.trim()) out.push(', 'if (false) out.push(', BOOK],
  ['a part E row named by no step passes', 'book-check.mjs', 'if (!named.has(r.id)) out.push(', 'if (false) out.push(', BOOK],
  ['a missing steps table passes', 'book-check.mjs', 'if (!found) out.push(', 'if (false) out.push(', BOOK],
  ['one missing book file passes', 'book-check.mjs', 'if (!hasB) return [', 'if (false) return [', BOOK],
  // the truth checks (truth-check.mjs: proof.tsv, callers, config, STATE); test/book.mjs
  ['the truth check is not called by --check', 'index.mjs', '[...b.problems, ...checkBook(root), ...checkTruth(root), ...checkMap(root)]', '[...b.problems, ...checkBook(root), ...checkMap(root)]', BOOK],
  ['a WORKS row with no test line passes', 'truth-check.mjs', "state === 'WORKS' && !proved.has(id)", 'false', BOOK],
  ['a code line counts as proof of WORKS', 'truth-check.mjs', "if (kind === 'test') proved.add(id);", 'proved.add(id);', BOOK],
  ['a token that is not in the file passes', 'truth-check.mjs', 'if (!text(root, path).includes(token)) return', 'if (false) return', BOOK],
  ['an empty token passes', 'truth-check.mjs', "if (!token.trim()) return 'the token is empty';", '', BOOK],
  ['a token with a space at its end passes', 'truth-check.mjs', 'if (token !== token.trim()) return', 'if (false) return', BOOK],
  ['the other spellings of a path pass (the real-path comparison is dropped)', 'truth-check.mjs', 'if (real !== join(realpathSync.native(root), ...parts)) return false;', '', BOOK],
  ['an absolute or .. path passes (the allowed-spelling rule is dropped)', 'truth-check.mjs', 'if (!PATH_RE.test(p) || parts.some(badPart)) return false;', '', BOOK],
  ['a path under a folder not in the allowed list passes', 'truth-check.mjs', 'if (!FIRST_FOLDERS.includes(parts[0])) return false;', '', BOOK],
  ['a test line may name any file', 'truth-check.mjs', "if (kind === 'test' && !testFile(path, gates)) return", 'if (false) return', BOOK],
  ['a duplicate line passes', 'truth-check.mjs', 'if (first) return', 'if (false) return', BOOK],
  ['a row that is not in the book passes', 'truth-check.mjs', 'if (!states.has(id)) return', 'if (false) return', BOOK],
  ["a PARTLY row's lines are not checked", 'truth-check.mjs', 'for (const { n, cells } of tsv.rows) {', "for (const { n, cells } of tsv.rows) { if (states.get(cells[0]) === 'PARTLY') continue;", BOOK],
  ['a CR in a tsv passes', 'truth-check.mjs', "if (body.includes('\\r')) return", 'if (false) return', BOOK],
  ['a wrong header passes', 'truth-check.mjs', 'if (lines[0] !== header.join(TAB)) problems.push(', 'if (false) problems.push(', BOOK],
  ['a function with no caller passes', 'truth-check.mjs', '!allowed.has(n) && !called(n)', 'false', BOOK],
  ['a caller in a test file counts', 'truth-check.mjs', 'if (isTestPath(r)) continue;', '', BOOK],
  ['a caller in a comment counts', 'truth-check.mjs', "} else if (c === '/' && src[i + 1] === '/') {", '} else if (false) {', BOOK],
  ['a grant statement counts as a caller', 'truth-check.mjs', '(?:grant|revoke|comment|alter|drop)', '(?:revoke|comment|alter|drop)', BOOK],
  ['a caller in a replaced definition counts', 'truth-check.mjs', 'if (m) defs.set(fnKey(m[1]), stmt);', 'if (m) { if (defs.has(fnKey(m[1]))) others.push(defs.get(fnKey(m[1]))); defs.set(fnKey(m[1]), stmt); }', BOOK],
  ['plain `create function` is not read (only `create or replace`)', 'truth-check.mjs', '(?:or\\s+replace\\s+)?function', '(?:or\\s+replace\\s+)function', BOOK],
  ['an allow line for a function that has a caller passes', 'truth-check.mjs', 'else if (called(fn)) out.push(', 'else if (false) out.push(', BOOK],
  ['an allow line for an unknown function passes', 'truth-check.mjs', 'if (!names.includes(fn)) out.push(', 'if (false) out.push(', BOOK],
  ['an allow line with an unknown row passes', 'truth-check.mjs', "book && row !== '-' && !known.has(row)", 'false', BOOK],
  ['an empty reason passes', 'truth-check.mjs', 'if (!reason.trim()) out.push(', 'if (false) out.push(', BOOK],
  ['a config table with no folder passes', 'truth-check.mjs', '!hasIndex(name) && !off', 'false', BOOK],
  ['a function folder with no table passes', 'truth-check.mjs', '&& !tables.has(d)', '&& false', BOOK],
  ['enabled = false does not excuse a folder with no index.ts', 'truth-check.mjs', '!hasIndex(name) && !off', '!hasIndex(name)', BOOK],
  ['a listed-twice table passes', 'truth-check.mjs', 'if (tables.has(m[2])) out.push(', 'if (false) out.push(', BOOK],
  ['the state file may have any length', 'truth-check.mjs', 'if (lines.length > STATE_MAX) out.push(', 'if (false) out.push(', BOOK],
  ['the Product total is not compared', 'truth-check.mjs', 'if (got.join() !== total.nums.join()) out.push(', 'if (false) out.push(', BOOK],
  ['the part groups are not compared', 'truth-check.mjs', 'if (g.join() !== parts[i].nums.join()) out.push(', 'if (false) out.push(', BOOK],
  ['the migration number is compared as text', 'truth-check.mjs', 'const top = Math.max(...nums);', 'const top = Number(nums.map(String).sort().pop());', BOOK],
  ['the highest migration number is the last file name, not the largest number', 'truth-check.mjs', 'const top = Math.max(...nums);', 'const top = nums[nums.length - 1];', BOOK],
  // round 2 (T1-R2): one seeded fault per rule
  ['a mention that is not a call counts as a caller', 'truth-check.mjs', ') *\\(/g;', ')/g;', BOOK],
  ['a YAML comment counts as a caller', 'truth-check.mjs', "src.replace(/(^|[ \\t])#.*$/gm, '$1')", 'src', BOOK],
  ['a comment marker inside a string removes real code', 'truth-check.mjs', "if (c === \"'\" || c === '\"' || c === '`') {", 'if (false) {', BOOK],
  ['a quote in SQL does not protect a semicolon', 'truth-check.mjs', '} else if (body[i] === "\'") {', '} else if (false) {', BOOK],
  ['a dropped function stays in the tree', 'truth-check.mjs', 'else if (d) defs.delete(fnKey(d[1]));', 'else if (d) {}', BOOK],
  ["a dead function's body counts as a caller", 'truth-check.mjs', 'for (const t of [...others, ...codeTexts(root)])', 'for (const t of [...others, ...codeTexts(root), ...defs.values()])', BOOK],
  ["a live function's callee is not live", 'truth-check.mjs', 'while (queue.length) { const k = queue.pop(); for (const c of callsIn(defs.get(k))) if (c !== k) mark(c); }', '', BOOK],
  ['a function with no schema is not public', 'truth-check.mjs', "return k.includes('.') ? k : 'public.' + k;", 'return k;', BOOK],
  ['a test line may name a file with any extension', 'truth-check.mjs', '(isTestPath(p) && TEST_EXT.test(p))', 'isTestPath(p)', BOOK],
  ['a gate script is not a test file (the gates list is not read)', 'truth-check.mjs', '|| gates.has(p)', '|| false', BOOK],
  ['a path in a comment of the gates file is a gate', 'truth-check.mjs', "l.replace(/\\/\\/.*/, '')", 'l', BOOK],
  ['a token under 8 characters passes', 'truth-check.mjs', "if (token.length < 8) return", 'if (false) return', BOOK],
  ['a token only in a comment passes', 'truth-check.mjs', '!COMMENT_LINE.test(l.trim())', 'true', BOOK],
  // the map and the progress (map-check.mjs, progress.mjs, map-page.mjs); test/map.mjs
  ['the map check is not called by --check', 'index.mjs', '[...b.problems, ...checkBook(root), ...checkTruth(root), ...checkMap(root)]', '[...b.problems, ...checkBook(root), ...checkTruth(root)]', MAP],
  ['a missing parts file passes', 'map-check.mjs', 'if (!existsSync(p)) return { rows: [], problems: [`${label}: ${file} is missing`], ok: false };', 'if (!existsSync(p)) return { rows: [], problems: [], ok: false };', MAP],
  ['a changed header passes (map tables)', 'truth-check.mjs', 'if (lines[0] !== header.join(TAB)) problems.push(', 'if (false) problems.push(', MAP],
  ['a bad id spelling passes', 'map-check.mjs', 'if (!ID_RE.test(id)) out.PARTS.push(', 'if (false) out.PARTS.push(', MAP],
  ['a duplicate part id passes', 'map-check.mjs', 'else if (seen.has(id)) out.PARTS.push(', 'else if (false) out.PARTS.push(', MAP],
  ['an unknown verdict passes', 'map-check.mjs', 'if (!VERDICTS.includes(verdict)) out.PARTS.push(', 'if (false) out.PARTS.push(', MAP],
  ['an owner item that does not exist passes', 'map-check.mjs', 'if (ownerSet && !ownerSet.has(Number(o))) out.push(', 'if (false) out.push(', MAP],
  ['a cluster that does not exist passes', 'map-check.mjs', 'else if (clusterSet && !clusterSet.has(Number(cluster))) out.PARTS.push(', 'else if (false) out.PARTS.push(', MAP],
  ['a row that does not exist passes', 'map-check.mjs', 'else if (bookRows && !bookRows.has(r)) out.PARTS.push(', 'else if (false) out.PARTS.push(', MAP],
  ['two clusters in one cell pass', 'map-check.mjs', 'if (!WHOLE.test(cluster)) out.PARTS.push(', 'if (false) out.PARTS.push(', MAP],
  ['cluster numbers may skip', 'map-check.mjs', 'else if (Number(c) !== n - 1) out.push(', 'else if (false) out.push(', MAP],
  ['an unknown size passes', 'map-check.mjs', 'if (!SIZES.includes(size)) out.CLUSTERS.push(', 'if (false) out.CLUSTERS.push(', MAP],
  ['an unknown kind passes', 'map-check.mjs', 'if (!KINDS.includes(kind)) out.OWNER.push(', 'if (false) out.OWNER.push(', MAP],
  ['an answered item with no answer passes', 'map-check.mjs', "else if (state === 'answered' && answer === '') out.OWNER.push(", 'else if (false) out.OWNER.push(', MAP],
  ['a calendar-invalid date passes', 'map-check.mjs', '.slice(0, 10) === s;', ".slice(0, 10) !== '';", MAP],
  ['an uppercase commit passes', 'map-check.mjs', 'export const COMMIT_RE = /^[0-9a-f]{8,40}$/;', 'export const COMMIT_RE = /^[0-9a-fA-F]{8,40}$/;', MAP],
  ['built above total passes', 'map-check.mjs', 'Number(built) > Number(total)', 'false', MAP],
  ['a date going backwards passes', 'map-check.mjs', 'if (above && isDate(date) && date < above) out.PROGRESS.push(', 'if (false) out.PROGRESS.push(', MAP],
  ['a duplicate commit passes', 'map-check.mjs', 'if (same) out.PROGRESS.push(', 'if (false) out.PROGRESS.push(', MAP],
  ['the progress line counts the Counts table, not the rows', 'progress.mjs', "rows.filter(r => r.state === 'WORKS').length", "parseProduct(readFileSync(join(root, 'docs/product/1-product.md'), 'utf8')).counts.find(c => c.label === 'Total').nums[0]", MAP],
  ['built counts BUILT-UNPROVEN too', 'progress.mjs', "map.parts.filter(p => p.verdict === 'BUILT').length", "map.parts.filter(p => p.verdict.startsWith('BUILT')).length", MAP],
  ['the progress line is written despite a data problem', 'progress.mjs', 'if (map.problems.length) refuse(...map.problems);', "if (map.problems.length) say(map.problems.join('\\n'));", MAP],
  ['an existing commit is appended again', 'progress.mjs', 'if (same) refuse(', 'if (false) refuse(', MAP],
  ['a date before the last line is appended', 'progress.mjs', 'if (last && date < last.date) refuse(', 'if (false) refuse(', MAP],
  ['the pace takes the last two lines, not the first and the last', 'map-page.mjs', 'const a = rows[0], b = rows[rows.length - 1],', 'const a = rows[rows.length - 2], b = rows[rows.length - 1],', MAP],
  ['the pace per week uses days, not weeks', 'map-page.mjs', '/ days * 7', '/ days', MAP],
  ['an unescaped part text is written', 'map-page.mjs', ".replace(/</g, '&lt;')", ".replace(/</g, '<')", MAP],
  ['the dark theme guard is dropped', 'map-page.mjs', '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){', '@media (prefers-color-scheme: dark){:root{', MAP],
  ['a script tag is written', 'map-page.mjs', '</head>', '<script>1</script></head>', MAP],
  ['a truth file with a wrong state passes', 'map-page.mjs', '!SHOWN.includes(o.state)', 'false', MAP],
  ['a bad out folder is created', 'map-page.mjs', "try { writeFileSync(opt.out, html, { flag: 'wx' }); }", "try { (await import('node:fs')).mkdirSync(dirname(opt.out), { recursive: true }); writeFileSync(opt.out, html, { flag: 'wx' }); }", MAP],
  ['the page is not written to the --out path', 'map-page.mjs', "writeFileSync(opt.out, html, { flag: 'wx' })", "writeFileSync(opt.out + '.x', html, { flag: 'wx' })", MAP],
  ['an existing out path is overwritten', 'map-page.mjs', 'if (there) refuse(', 'if (false) refuse(', MAP],
  ['a failed data check still writes the page', 'map-page.mjs', 'if (map.problems.length) refuse(...map.problems);', "if (map.problems.length) say(map.problems.join('\\n'));", MAP],
  ['the rows count test lines of every kind', 'map-page.mjs', "if (r.cells[1] === 'test') tests.set(", 'if (true) tests.set(', MAP],
  ['an out path inside the repository is written', 'map-page.mjs', "if (rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) refuse(", 'if (false) refuse(', MAP],
  ['a number with a leading zero passes', 'map-check.mjs', 'const WHOLE = /^(0|[1-9][0-9]*)$/;', 'const WHOLE = /^\\d+$/;', MAP],
  ['a commit given longer is appended again', 'map-check.mjs', '(a.startsWith(b) || b.startsWith(a))', '(a === b)', MAP],
  ['a refused progress run still appends', 'progress.mjs', "const refuse = (...ls) => { say(ls.join('\\n')); process.exit(1); };", "const refuse = (...ls) => { appendFileSync(join(root, 'work/map/progress.tsv'), 'x\\n'); say(ls.join('\\n')); process.exit(1); };", MAP],
  ['a reference to a table that did not parse is checked', 'map-check.mjs', '(t.problems.length === 0 ? new Set(t.rows.map((_, i) => i + 1)) : null)', 'new Set(t.rows.map((_, i) => i + 1))', MAP],
  ['a cell of spaces is not empty', 'map-check.mjs', "if (part.trim() === '') out.PARTS.push(", "if (part === '') out.PARTS.push(", MAP],
  ['a row that does not exist in closes passes', 'map-check.mjs', 'bookRefs(closes, bookRows, out.CLUSTERS, at);', 'void 0;', MAP],
  ['an owner item named twice passes', 'map-check.mjs', 'if (named.has(o)) out.push(', 'if (false) out.push(', MAP],
];
let survived = 0, missing = 0;
const onlyBook = process.argv.includes('--book'); // only the mutants that run test/book.mjs
const onlyMap = process.argv.includes('--map'); // only the mutants that run test/map.mjs
const mi = process.argv.indexOf('--match'); // only the mutants whose name contains this text
const RUN = MUTANTS.filter(m => (!onlyBook || m[4] === BOOK) && (!onlyMap || m[4] === MAP) && (mi < 0 || m[0].includes(process.argv[mi + 1])));
for (const [name, file, find, repl, testFile = 'run.mjs'] of RUN) {
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-icm-mut-'));
  try {
    cpSync(TOOLS, dir, { recursive: true });
    const p = join(dir, file);
    const t = readFileSync(p, 'utf8');
    const n = t.split(find).length - 1;
    if (n !== 1) { missing++; console.log(`MISSING  ${name} (target text found ${n} times in ${file})`); continue; }
    writeFileSync(p, t.split(find).join(repl), 'utf8');
    const r = spawnSync(process.execPath, [join(dir, 'test', testFile)], { encoding: 'utf8', timeout: 180000, env: { ...process.env, OMNIKOM_ICM_TOOLS: dir, OMNIKOM_ICM_ROOT: resolve(TOOLS, '..', '..'), ...(testFile === 'run.mjs' ? { OMNIKOM_ICM_NO_BOOK: '1' } : {}) } });
    const red = ((r.stdout || '').match(/^FAIL .*$/gm) || []).map(l => l.slice(5, 75));
    // caught = the suite went red on a named check; a crash or a timeout with no FAIL line is NOT a catch (it would hide a broken test)
    const caught = r.status !== 0 && red.length > 0;
    if (!caught) survived++;
    console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(54)} ${caught ? `(${red.length} red: ${red[0]})` : `(exit ${r.status}, ${red.length} red${r.status !== 0 ? ': ' + String(r.stderr || r.stdout || '').trim().split(/\r?\n/).pop().slice(0, 80) : ''})`}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\nicm mutants: ${RUN.length - survived - missing} caught, ${survived} survived, ${missing} target text missing (of ${RUN.length})`);
process.exit(survived || missing ? 1 : 0);
