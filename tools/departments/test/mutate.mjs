// Watched-fail for the department tools: a broken COPY of tools/departments with ONE rule removed, test/run.mjs against it
// (OMNIKOM_DEPT_TOOLS), the suite must go red. Pattern of tools/omnikom-cli/test/mutate.mjs: [name, file, exactText, replacement],
// applied with split/join, one child process per mutant with a timeout.
//   node tools/departments/test/mutate.mjs      exit 0 = every mutant caught
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = [
  ['a required section is not required', 'check.mjs', 'for (const s of REQUIRED_SECTIONS) if (!c.sections.has(s)) problems.push(', 'for (const s of []) if (!c.sections.has(s)) problems.push('],
  ['two charters may own one path', 'check.mjs', 'if (ownersByPath.has(n) && ownersByPath.get(n) !== c.slug) problems.push(', 'if (false) problems.push('],
  ['a child path under another department is fine', 'check.mjs', "if (a !== b && ownerA !== ownerB && b.startsWith(a + '/')", "if (false"],
  ['the README table is not checked', 'check.mjs', 'for (const c of charters) if (!rows.includes(c.slug)) problems.push(', 'for (const c of []) if (!rows.includes(c.slug)) problems.push('],
  ['an unknown model passes', 'check.mjs', 'else if (!MODELS.includes(c.headModel)) problems.push(', 'else if (false) problems.push('],
  ['an em dash passes', 'check.mjs', 'if (c.text.includes(String.fromCharCode(0x2014))) problems.push(', 'if (false) problems.push('],
  ['new-department does not refuse a path owned elsewhere', 'new-department.mjs', 'if (owner) { console.error(`refusing: ${p} is owned by ${owner.slug}`); process.exit(1); }', ''],
  ['new-department keeps a charter the check refused', 'new-department.mjs', '  unlinkSync(file);\n  writeFileSync(readmePath, readme, \'utf8\');\n', ''],
  ['new-department writes on --dry-run', 'new-department.mjs', "if (flags['dry-run']) { console.log(", "if (false) { console.log("],
];
let survived = 0, missing = 0;
for (const [name, file, find, repl] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-dept-mut-'));
  try {
    cpSync(TOOLS, dir, { recursive: true });
    const p = join(dir, file);
    const t = readFileSync(p, 'utf8');
    const n = t.split(find).length - 1;
    if (n !== 1) { missing++; console.log(`MISSING  ${name} (target text found ${n} times in ${file})`); continue; }
    writeFileSync(p, t.split(find).join(repl), 'utf8');
    const r = spawnSync(process.execPath, [join(dir, 'test', 'run.mjs')], { encoding: 'utf8', timeout: 180000, env: { ...process.env, OMNIKOM_DEPT_TOOLS: dir, OMNIKOM_REPO_ROOT: resolve(TOOLS, '..', '..') } });
    const red = ((r.stdout || '').match(/^FAIL .*$/gm) || []).map(l => l.slice(5, 70));
    // caught = the suite went red on a named check; a crash or a timeout with no FAIL line is NOT a catch (it would hide a broken test)
    const caught = r.status !== 0 && red.length > 0;
    if (!caught) survived++;
    console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(58)} ${caught ? `(${red.length} red: ${red[0]})` : `(exit ${r.status}, ${red.length} red${r.status !== 0 ? ': ' + String(r.stderr || r.stdout || '').trim().split(/\r?\n/).pop().slice(0, 80) : ''})`}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\n${MUTANTS.length} mutants, ${MUTANTS.length - survived - missing} caught, ${survived} survived, ${missing} target text missing`);
process.exit(survived || missing ? 1 : 0);
