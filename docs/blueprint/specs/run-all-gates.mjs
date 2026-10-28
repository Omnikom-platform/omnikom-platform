// Run every gate this repo has today, in order, and print one line each (the line a new team should see on their machine).
//   node docs/blueprint/specs/run-all-gates.mjs     exit 0 only if every gate passes
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GATES = [
  ['contract tests', 'contracts/test/run.mjs'],
  ['contract mutants', 'contracts/test/mutate.mjs'],
  ['industry run', 'contracts/industry-run/run.mjs'],
  ['database walls + mutants', 'supabase/tests/run-local.mjs'],
  ['specs + traceability', 'docs/blueprint/specs/check-specs.mjs'],
  ['machine-call signature', 'supabase/functions/_shared/signature.test.mjs'],
];
let bad = 0;
for (const [name, script] of GATES) {
  const r = spawnSync(process.execPath, [resolve(ROOT, script)], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || (r.stderr || '').trim().split('\n').pop();
  if (r.status !== 0) bad++;
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'} ${name.padEnd(26)} ${last}`);
}
// Deno type check of the shared function code (needs deno on PATH; reported, not hidden, when missing)
const dn = spawnSync('deno', ['task', 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 300000, shell: process.platform === 'win32' });
if (dn.error) console.log('SKIP deno check               deno not found on PATH (UNPROVEN on this machine)');
else { if (dn.status !== 0) bad++; console.log(`${dn.status === 0 ? 'PASS' : 'FAIL'} deno check                 ${(dn.stderr + dn.stdout).trim().split('\n').filter(l => /Check|error/i.test(l)).slice(-2).join(' | ')}`); }
console.log(bad ? `${bad} gate(s) failed` : 'all gates passed');
process.exit(bad ? 1 : 0);
