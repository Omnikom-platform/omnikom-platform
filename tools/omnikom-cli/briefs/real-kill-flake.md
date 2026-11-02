# Brief: the Linux "cluster guard (real kill)" red and the lost mutate-baseline cluster

Department `cli-and-testing`, head HEAD_CLI-and-testing_2026-11-01d. Written 2026-11-01 22:30 against master be64510. Plan approved
by HEAD-OF-OPERATIONS_Omnikom_2026-11-01d at 22:13. Builder: one session, `--effort high`, in worktree `D:\omk-gates\cli-real-kill`
(detached at be64510). Never work in `E:\Omnikom Platform` (shared checkout, other departments' unfinished files). You never push
to master and never land; you may push the check branch named below to `backup-gh` for a Linux run.

## Why
The CLI job of ci.yml was green on every run from 15:51 to 21:27 local, then went red on two check branches, blocking landings:
1. SEO stack a111b86, run 41344229818 (attempts 1 and 2): "FAILED: 548 of 549", the one red check is "cluster guard (real kill)",
   its detail shows pings "psql: error: connection to server at 127.0.0.1 ... refused". Earlier also run 41323582926 (mutate baseline).
2. Platform 5-L 26e6963, run 41345442144, job 124964153828: mutate.mjs "BASELINE FAILS: the unbroken copy does not pass ... Error:
   create database failed: psql: error: connection to server at "127.0.0.1", port 57652 failed: Connection refused".
   So a cluster that should be running is gone in more than the real-kill check. Same family as the gates job's "psql ...
   127.0.0.1 refused" reds (run 41323687561): include it if the evidence ties it in; say so either way.

## The facts so far (head's reading of be64510; verify each, they are leads, not proof)
- The test: `tools/omnikom-cli/test/run.mjs` ~1450-1480. It starts `test/cluster-child.mjs` (own marker folder via
  `OMNIKOM_TEST_MARKER_DIR`), SIGKILLs the child, then `outlived = !!info && ping(info.port)`, then sweeps and expects the cluster
  stopped. The red is `outlived` false (or `up` false): the cluster was already dead before the sweep.
- `test/harness.mjs`: `CLUSTER_MARKER_DIR = <tmp>/omnikom-cli-clusters` (shared by every suite copy on the machine),
  `CLUSTER_PREFIX = 'omnikom-cli-pg-'`, `sweepClusters()` (stops a cluster whose owner pid is not alive), `startCluster()`.
- `mutate.mjs` runs 3 suite copies at once (baseline and mutants), so 3 sets of clusters and sweeps run concurrently on one runner.
- The approved hypothesis was: since 713b008 `tools/proc-guard/index.mjs` treats a pid-1-parented holder as not a live owner, so a
  concurrent proc-guard sweep kills the orphaned cluster before the ping. Head's doubt: `ownerAlive()` is used only for
  `PARENT_CHECKED` (`playwright_chromiumdev_profile-`), and `PREFIXES` has `omnikom-pg-`, not `omnikom-cli-pg-`; and 713b008 landed at
  10:11. (Correction 22:30: the job was not green until 21:27; run 41323582926 attempt 1, commit 782b707, about 18:10, failed the
  same way on port 57130 and passed on attempt 2: intermittent since at least 18:10.) Prove or refute it; do not assume it.
- Other candidates to rule in or out with evidence: (a) the shared `CLUSTER_MARKER_DIR` lets one copy's `sweepClusters()` stop
  another copy's cluster (pid reuse, owner pid read wrong, a marker written before the owner pid is right); (b) the postmaster dies
  with the killed child (same process group, a pipe it writes to closing: SIGPIPE, `pg_ctl` without `-l`); (c) port picking races
  between concurrent copies (two clusters on one port; note port 57652); (d) memory or shared-memory limits with 3+ clusters on the
  runner (look for "could not create shared memory" / OOM in the server log); (e) something new on the red branches or the runner:
  compare the red runs' branches with master be64510 (`git diff be64510 a111b86 -- tools/ supabase/ .github/`) and the runner image
  line of a green 21:27 run against a red one.

## What to build (CLI test side only)
1. Failure detail that names the cause: when the real-kill check fails, its detail says which ping failed (up / outlived), whether
   the postmaster pid from `postmaster.pid` existed at that moment, and the last 20 lines of that cluster's server log. Same for a
   baseline `create database failed`: name the cluster's data folder, whether its postmaster pid lived, its log tail. Keep under
   check()'s 300-character cut by putting the long part in a printed block, not the check detail.
2. Prove the cause deterministically, on Linux (push `check/cli-and-testing/real-kill-probe` to `backup-gh`; the CLI job runs on
   push) and on Windows (this laptop). Deterministic means: a probe or test that forces the suspected interleaving (for example a
   second suite copy's sweep run between the kill and the ping, or two copies picking the same port) and shows the cluster gone for
   that reason, and the same probe without the interleaving shows it alive. A probe that only reproduces sometimes is not proof.
   Bound: two failed approaches to the same question, then record BLOCKED with what would unblock it and report.
3. Fix by the proven cause, CLI files only (`tools/omnikom-cli/**`). NO retry inside the test, no longer sleeps as the fix.
   If the cause is in `tools/proc-guard/` or anything else outside `tools/omnikom-cli/`, do not edit it: send me the evidence and a
   proposed change; I brief the platform head.
4. New wall = a test watched failing for the right reason (paste the red line, then the green) and a mutant in `test/mutate.mjs`
   that the suite catches.

## Port map (head of operations' rule, 22:37): below 32768, one block per harness, no overlap
Below both ephemeral ranges (Linux 32768-60999, Windows 49152-65535). Each harness owns one block and never leaves it:
| Harness | Block |
|---|---|
| tools/omnikom-cli/test/harness.mjs (this slice) | 21000-21899 |
| supabase/tests/run-local.mjs | 22000-22899 |
| supabase/tests/publish-parity.mjs | 23000-23899 |
| supabase/functions/test/harness.mjs | 24000-24899 |
| supabase/tests/test-apply.mjs | 25000-25899 |
| supabase/tests/e2e-screens.mjs | 26000-26899 |
| supabase/ops/restore-drill.mjs | 29000-29899 |
| supabase/ops/test/6b-cluster.mjs | 30000-30899 |
| supabase/ops/test/cluster.mjs (needs about 1900) | 31000-32699 |
Bind fallback (22:39): a fixed-port service can sit in a low block (22000 is Syncthing's default), so on a failed bind the harness
tries the next port in its block, at most 5 tries, printing one line per try (`cluster: port P in use (could not bind), trying P+1`),
and only for a bind failure named in the server log; any other start failure stops at once. Never silent, never outside the block.
This is the harness picking a port, not a retry of the test: the test itself still never retries. The probe shows this path once
(hold P, harness lands on P+1 with the line printed), and a mutant (fallback removed) goes red on that probe.
Only the CLI row is this slice's; the supabase rows go to the platform head as a brief. Before relying on 21000-21899, paste
`netsh int ipv4 show excludedportrange protocol=tcp` (Windows reserves blocks for Hyper-V) and the runner's
`/proc/sys/net/ipv4/ip_local_port_range`; if a block collides, say so and I move it.

## Done when (paste every line, never paraphrase)
- The cause stated in one sentence with the deterministic proof's output on Linux (run id) and on Windows.
- The fix's watched-red and green lines; the new mutant caught: `node tools/omnikom-cli/test/mutate.mjs` summary line.
- Full suite on Windows: `node tools/omnikom-cli/test/run.mjs` final line.
- The fix commit pushed to `check/cli-and-testing/real-kill` (based on master at that time, `gitleaks protect --staged` clean) and
  its ci.yml run: every job green, the CLI job's mutate baseline included. Commit message plain, no em dashes.
- A 5-line entry for `docs/blueprint/PROGRESS.md` and for the charter, sent to me as text (I write them; you do not edit them).
Report by SendMessage to HEAD_CLI-and-testing_2026-11-01d: PROVEN / UNPROVEN / BLOCKED, with pasted output. Anything outside this
brief is a finding you send back, not a fix.
