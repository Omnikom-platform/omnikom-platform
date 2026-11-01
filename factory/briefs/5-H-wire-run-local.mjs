// Slice 5-H wire script: the head of operations / platform head runs it AT LANDING, after builder 5.2 is done with these two files.
// It puts the process guard (tools/proc-guard) into the two files the 5-H builder was not allowed to edit:
//   supabase/tests/run-local.mjs          the throwaway cluster of the wall gate
//   supabase/functions/test/harness.mjs   the throwaway cluster of the Edge Function tests
// In both: a sweep at start, the cluster folder from guardedTemp('omnikom-pg-', 'cluster') instead of a bare mkdtemp, and release()
// (pg_ctl stop -m immediate, every process naming the folder, then the folder) in place of the pg_ctl stop + rmSync pair.
//
//   node factory/briefs/5-H-wire-run-local.mjs --dry-run     prints how many times each target text occurs in each file; writes nothing
//   node factory/briefs/5-H-wire-run-local.mjs               makes the change (all or nothing: if any target does not occur exactly once, nothing is written)
//
// Every target text must occur exactly once. The replacement is made with split/join (never a replacement string). Run it once: a file that
// already holds the guard import is reported as "already wired" and left alone.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArg = process.argv.indexOf('--root');   // a copy of the two files (a test of this script); default: this repository
const ROOT = rootArg > 0 ? resolve(process.argv[rootArg + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry-run');

// [file, [[name, target text, replacement text], ...]]
const PLAN = [
  ['supabase/tests/run-local.mjs', [
    ['import the guard', "import { qualify } from './qualify.mjs';\n",
      "import { qualify } from './qualify.mjs';\n// 5-H: the cluster folder is guarded (stopped and removed on every exit path; swept at start when an earlier run was killed)\nimport { guardedTemp, sweep } from '../../tools/proc-guard/index.mjs';\n"],
    ['guarded cluster folder', "const dir = mkdtempSync(join(tmpdir(), 'omnikom-pg-'));",
      "sweep();\nconst guard = guardedTemp('omnikom-pg-', 'cluster', { label: 'run-local' });\nconst dir = guard.dir;"],
    ['release in the finally', "  run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);   // always: a crash must not leave a server running\n  if (!process.argv.includes('--keep')) rmSync(dir, { recursive: true, force: true });",
      "  guard.release({ keep: process.argv.includes('--keep') });   // always: a crash must not leave a server running (pg_ctl stop -m immediate, every process naming the folder, then the folder)"],
  ]],
  ['supabase/functions/test/harness.mjs', [
    ['import the guard', "import { fileURLToPath, pathToFileURL } from 'node:url';\n",
      "import { fileURLToPath, pathToFileURL } from 'node:url';\n// 5-H: the cluster folder is guarded (stopped and removed on every exit path; swept at start when an earlier run was killed)\nimport { guardedTemp, sweep } from '../../../tools/proc-guard/index.mjs';\n"],
    ['guarded cluster folder', "  const dir = mkdtempSync(join(tmpdir(), 'omnikom-fn-'));",
      "  sweep();\n  const guard = guardedTemp('omnikom-pg-', 'cluster', { label: 'functions-harness' });\n  const dir = guard.dir;"],
    ['release when initdb fails', "  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.error));",
      "  if (r.status !== 0) { guard.release(); throw new Error('initdb failed: ' + (r.stderr || r.error)); }"],
    ['release when pg_ctl start fails', "  if (r.status !== 0) throw new Error('pg_ctl start failed: ' + r.stderr + readFileSync(join(dir, 'pg.log'), 'utf8'));",
      "  if (r.status !== 0) { const why = 'pg_ctl start failed: ' + r.stderr + readFileSync(join(dir, 'pg.log'), 'utf8'); guard.release(); throw new Error(why); }"],
    ['stopDb is release', "  const stopDb = () => { run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']); rmSync(dir, { recursive: true, force: true }); };",
      "  const stopDb = () => guard.release();   // pg_ctl stop -m immediate, every process naming the folder, then the folder"],
  ]],
];

const count = (text, find) => text.split(find).length - 1;
let bad = 0;
const out = [];
for (const [file, edits] of PLAN) {
  const path = join(ROOT, file);
  let text = readFileSync(path, 'utf8');
  if (text.includes('tools/proc-guard/index.mjs')) { console.log(`${file}: already wired, left alone`); continue; }
  for (const [name, find, replace] of edits) {
    const n = count(text, find);
    console.log(`${file}: ${name}: target occurs ${n} time(s)${n === 1 ? '' : '  <-- NEEDS EXACTLY 1'}`);
    if (n !== 1) { bad++; continue; }
    text = text.split(find).join(replace);
  }
  out.push([path, file, text]);
}
if (bad) { console.error(`\n${bad} target(s) do not occur exactly once: NOTHING written`); process.exit(1); }
if (DRY) { console.log('\ndry run: nothing written'); process.exit(0); }
for (const [path, file, text] of out) { writeFileSync(path, text); console.log(`wrote ${file}`); }
console.log(out.length ? '\nchanged: the guard import, sweep() + guardedTemp in place of mkdtemp, release() in place of pg_ctl stop + rmSync' : '\nnothing to change');
