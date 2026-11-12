// Run every gate this repo has today, in order, and print one line each (the line a new team should see on their machine).
//   node docs/blueprint/specs/run-all-gates.mjs     exit 0 only if every gate passes
import { spawnSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { tmpdir, freemem, totalmem } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GATES = [
  ['contract tests', 'contracts/test/run.mjs'],
  ['contract mutants', 'contracts/test/mutate.mjs'],
  ['industry run', 'contracts/industry-run/run.mjs'],
  ['database walls + mutants', 'supabase/tests/run-local.mjs'],
  ['publish-ready parity (SQL vs JS)', 'supabase/tests/publish-parity.mjs'],   // slice 4.6: the SQL port of the REQUIRED rules agrees with contracts/validate.mjs on every item
  ['test cluster ports', 'supabase/tests/cluster-port.test.mjs'],   // slice 5-PORT: every test cluster listens on a port of its block below 32768, pinned to 127.0.0.1, with the bind fallback; a fake pg_ctl, no Postgres, about 1 s (its mutants run inside the walls gate above)
  ['mutant lists', 'supabase/tests/mutant-lists.test.mjs'],
  ['real migration failure named', 'supabase/tests/real-failure.test.mjs'],   // a failing real migration is named by file, line and its whole database error on the gate's last lines (Clients' 37b, 2026-11-11); no Postgres, under 1 s   // run-local's lists: a missing comma, a mutant in the wrong list, a repeated name, and a run of none are FAILs (Clients' 37b, 2026-11-11); no Postgres, under 1 s
  ['test cluster port probe', 'supabase/tests/port-probe.mjs'],   // slice 5-PORT: the Linux (and Windows) watched red/green of the port rules: a plain client socket holds 127.0.0.1:P, the old start is half-up, the pinned start fails loudly, the new start walks to P+1; picks --hold tw on Linux, est on Windows; has its own time limit (480 s), a few seconds on Linux
  ['head land-script gate (gate-lib)', 'factory/briefs/gate-lib.test.mjs'],   // the head's land script stops at the first red step and never pushes after one (factory/briefs/gate-lib.sh)
  ['promote-check tests','supabase/ops/test/promote-check.test.mjs'],   // slice 5-PORT: the promote script's own tests on a local cluster (ledger, dry run, read-only, function list, smoke judgement); no staging; it was run by no job before
  ['inbox-state tests + mutants', 'supabase/ops/test/inbox-state.test.mjs', '--mutants'],   // slice S1 (S1-B): the read-only state of one address on a local cluster; no staging
  ['alerts tests', 'supabase/ops/test/alerts.test.mjs'],   // slice S5 (E3): the alert queries, the function-errors alert and the sender (a fake Resend) on a local cluster; no network
  ['e2e cleanup + mutants', 'supabase/tests/e2e-cleanup.test.mjs'],   // slice 5.2b: the staging e2e scripts remove the content rows they create (a thrown assertion included); no staging, about 2 s
  ['dashboard preview port', 'apps/dashboard/tests/preview-port.test.mjs'],   // slice 5-PW (DECISIONS 50 (e)): the dashboard's Playwright web server takes a free port of 27000-27899 on 127.0.0.1, walks on a taken port (5 tries, a line each), 4173 is gone; plain node, no browser, no staging, 21 mutants (its own pass), about 20 s
  ['function tests (Deno)', 'supabase/functions/test/run.mjs'],   // slice 4.2 harness: a local cluster + the Edge Functions under Deno, about 2 to 5 minutes; its mutants (mutate.mjs) are the slice gate, too long for here
  ['specs + traceability', 'docs/blueprint/specs/check-specs.mjs'],
  ['specs: deployed-function rule', 'docs/blueprint/specs/check-specs.test.mjs'],   // slice 5.2b: every deployed function has an operation; planted faults in a temp copy
  ['machine-call signature', 'supabase/functions/_shared/signature.test.mjs'],
  ['no model in runtime (D38)', 'docs/blueprint/specs/check-no-model.test.mjs'],   // DECISIONS 38 (1): planted tells, 10 mutants, then the real tree
  // the site signing tools (tools/site-sign/README.md): a --mutants run first runs every case, then its seeded faults; no network, about 1 to 4 minutes
  ['site sign tests + mutants', 'tools/site-sign/sign-site.test.mjs', '--mutants'],
  ['site seal tests + mutants', 'tools/site-sign/seal-site.test.mjs', '--mutants'],
  ['site deploy tests', 'tools/site-sign/deploy-signed.test.mjs'],
  // slice 5-H (after the 2026-11-01 restart: 1021 orphaned Edge processes, 40 Postgres): the guard's tests and mutants, then, LAST, no
  // process may still run from a temp folder of ours after every gate above has ended
  ['process guard tests', 'tools/proc-guard/test/run.mjs'],
  ['process guard mutants', 'tools/proc-guard/test/mutate.mjs'],
  ['no leaked browser or cluster', 'tools/proc-guard/check-leaks.mjs'],
];
// Per-gate time limit. The wall gate ran 161 mutants in about 12 minutes on a quiet machine (2026-10-30); with 214 mutants (slice 4.2) and
// other sessions loading the machine it passed 30 minutes twice on 2026-10-31, and this runner then printed the LAST STDOUT LINE (a "caught"
// mutant line) as if it were the failure, which read as a flaky wall. It was not: the wall passed alone every time. So: 60 minutes, and a
// timeout is reported as TIMEOUT with the seconds, never as the last line. GATE_TIMEOUT_MS overrides the limit (used to watch this red).
const TIMEOUT_MS = Number(process.env.GATE_TIMEOUT_MS) || 3600000;
const ONLY = process.env.GATE_ONLY || '';   // run the one gate whose name contains this (and skip the deno check): for watching one gate red
let bad = 0;
for (const [name, script, ...args] of GATES) {
  if (ONLY && !name.includes(ONLY)) continue;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [resolve(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT_MS });
  const secs = Math.round((Date.now() - t0) / 1000);
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || (r.stderr || '').trim().split('\n').pop();
  const timedOut = r.status === null && (r.signal === 'SIGTERM' || (r.error && r.error.code === 'ETIMEDOUT'));
  if (r.status !== 0) bad++;
  if (timedOut) console.log(`FAIL ${name.padEnd(26)} TIMEOUT after ${secs} s (limit ${Math.round(TIMEOUT_MS / 1000)} s; not a test failure, the gate was killed; last line: ${last})`);
  else console.log(`${r.status === 0 ? 'PASS' : 'FAIL'} ${name.padEnd(26)} ${last}${r.status === 0 ? '' : `   (exit ${r.status}, ${secs} s)`}`);
  // A failed gate shows its own evidence: the tails of its stdout and stderr, and the free disk. On 2026-10-31 (CI run 41187071384,
  // attempt 1) two gates crashed and this runner had kept one stdout line of each, so the crash itself was never written anywhere.
  if (r.status !== 0) {
    const tail = (s, n) => (s || '').trim().split(/\r?\n/).filter(Boolean).slice(-n).map(l => `      ${l.slice(0, 300)}`).join('\n');
    if ((r.stdout || '').trim()) console.log(`    stdout (last 8 lines):\n${tail(r.stdout, 8)}`);
    if ((r.stderr || '').trim()) console.log(`    stderr (last 12 lines):\n${tail(r.stderr, 12)}`);
    if (r.error) console.log(`    spawn error: ${r.error.code || r.error.message}`);
    try { const f = statfsSync(tmpdir()); console.log(`    free disk in ${tmpdir()}: ${Math.round(f.bavail * f.bsize / 1048576)} MB`); } catch { /* not every platform reports it */ }
    console.log(`    free memory: ${Math.round(freemem() / 1048576)} of ${Math.round(totalmem() / 1048576)} MB`);
  }
}
// Deno type check of the shared function code (needs deno on PATH; reported, not hidden, when missing)
const dn = ONLY ? null : spawnSync('deno', ['task', 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 300000, shell: process.platform === 'win32' });
if (!dn) console.log('SKIP deno check               GATE_ONLY set');
else if (dn.error) console.log('SKIP deno check               deno not found on PATH (UNPROVEN on this machine)');
else { if (dn.status !== 0) bad++; console.log(`${dn.status === 0 ? 'PASS' : 'FAIL'} deno check                 ${(dn.stderr + dn.stdout).trim().split('\n').filter(l => /Check|error/i.test(l)).slice(-2).join(' | ')}`); }
console.log(bad ? `${bad} gate(s) failed` : 'all gates passed');
process.exit(bad ? 1 : 0);
