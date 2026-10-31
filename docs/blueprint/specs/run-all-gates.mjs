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
  ['function tests (Deno)', 'supabase/functions/test/run.mjs'],   // slice 4.2 harness: a local cluster + the Edge Functions under Deno, about 2 to 5 minutes; its mutants (mutate.mjs) are the slice gate, too long for here
  ['specs + traceability', 'docs/blueprint/specs/check-specs.mjs'],
  ['machine-call signature', 'supabase/functions/_shared/signature.test.mjs'],
];
// Per-gate time limit. The wall gate ran 161 mutants in about 12 minutes on a quiet machine (2026-10-30); with 214 mutants (slice 4.2) and
// other sessions loading the machine it passed 30 minutes twice on 2026-10-31, and this runner then printed the LAST STDOUT LINE (a "caught"
// mutant line) as if it were the failure, which read as a flaky wall. It was not: the wall passed alone every time. So: 60 minutes, and a
// timeout is reported as TIMEOUT with the seconds, never as the last line. GATE_TIMEOUT_MS overrides the limit (used to watch this red).
const TIMEOUT_MS = Number(process.env.GATE_TIMEOUT_MS) || 3600000;
const ONLY = process.env.GATE_ONLY || '';   // run the one gate whose name contains this (and skip the deno check): for watching one gate red
let bad = 0;
for (const [name, script] of GATES) {
  if (ONLY && !name.includes(ONLY)) continue;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [resolve(ROOT, script)], { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT_MS });
  const secs = Math.round((Date.now() - t0) / 1000);
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || (r.stderr || '').trim().split('\n').pop();
  const timedOut = r.status === null && (r.signal === 'SIGTERM' || (r.error && r.error.code === 'ETIMEDOUT'));
  if (r.status !== 0) bad++;
  if (timedOut) console.log(`FAIL ${name.padEnd(26)} TIMEOUT after ${secs} s (limit ${Math.round(TIMEOUT_MS / 1000)} s; not a test failure, the gate was killed; last line: ${last})`);
  else console.log(`${r.status === 0 ? 'PASS' : 'FAIL'} ${name.padEnd(26)} ${last}${r.status === 0 ? '' : `   (exit ${r.status}, ${secs} s)`}`);
}
// Deno type check of the shared function code (needs deno on PATH; reported, not hidden, when missing)
const dn = ONLY ? null : spawnSync('deno', ['task', 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 300000, shell: process.platform === 'win32' });
if (!dn) console.log('SKIP deno check               GATE_ONLY set');
else if (dn.error) console.log('SKIP deno check               deno not found on PATH (UNPROVEN on this machine)');
else { if (dn.status !== 0) bad++; console.log(`${dn.status === 0 ? 'PASS' : 'FAIL'} deno check                 ${(dn.stderr + dn.stdout).trim().split('\n').filter(l => /Check|error/i.test(l)).slice(-2).join(' | ')}`); }
console.log(bad ? `${bad} gate(s) failed` : 'all gates passed');
process.exit(bad ? 1 : 0);
