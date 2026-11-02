// Watched-fail for tools/icm: a broken COPY of tools/icm with ONE rule removed, test/run.mjs against it (OMNIKOM_ICM_TOOLS), the
// suite must go red on a named check. Pattern of tools/departments/test/mutate.mjs: [name, file, exactText, replacement], applied
// with split/join, the target text must occur exactly once, one child process per mutant with a timeout.
//   node tools/icm/test/mutate.mjs      exit 0 = every mutant caught
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
];
let survived = 0, missing = 0;
for (const [name, file, find, repl] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-icm-mut-'));
  try {
    cpSync(TOOLS, dir, { recursive: true });
    const p = join(dir, file);
    const t = readFileSync(p, 'utf8');
    const n = t.split(find).length - 1;
    if (n !== 1) { missing++; console.log(`MISSING  ${name} (target text found ${n} times in ${file})`); continue; }
    writeFileSync(p, t.split(find).join(repl), 'utf8');
    const r = spawnSync(process.execPath, [join(dir, 'test', 'run.mjs')], { encoding: 'utf8', timeout: 180000, env: { ...process.env, OMNIKOM_ICM_TOOLS: dir } });
    const red = ((r.stdout || '').match(/^FAIL .*$/gm) || []).map(l => l.slice(5, 75));
    // caught = the suite went red on a named check; a crash or a timeout with no FAIL line is NOT a catch (it would hide a broken test)
    const caught = r.status !== 0 && red.length > 0;
    if (!caught) survived++;
    console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(54)} ${caught ? `(${red.length} red: ${red[0]})` : `(exit ${r.status}, ${red.length} red${r.status !== 0 ? ': ' + String(r.stderr || r.stdout || '').trim().split(/\r?\n/).pop().slice(0, 80) : ''})`}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\nicm mutants: ${MUTANTS.length - survived - missing} caught, ${survived} survived, ${missing} target text missing (of ${MUTANTS.length})`);
process.exit(survived || missing ? 1 : 0);
