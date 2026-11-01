# Brief 5-W: the reaper assertions in the walls file count only their own fixture jobs

Head: `HEAD_Platform-build_2026-11-01b` (report by SendMessage to that name). Builder: `BUILDER_platform_5-W` (Sonnet).
Anything outside this brief is a finding you send back, not a fix.

## Why
`supabase/tests/tenancy.test.sql:264` runs `assert service.reap_stale_jobs() = 0` and, a few lines on, `assert n = 1`.
Both count every job in the database. On a fresh local cluster that is only the fixture, so the test passes; on staging
(`omnikom test walls --target staging`) five publish jobs queued on 2026-10-31 00:22 are past the 24 hour limit, the reaper
fails them, and the file stops with "a job that changed state recently is not reaped (N2)". Decision (head of operations,
2026-11-01): the walls file asserts only on its own fixture jobs. Do NOT reap or edit staging rows by hand.

## Do
1. In `supabase/tests/tenancy.test.sql` (lines about 253 to 272, the "stale jobs are reaped" block), keep calling
   `service.reap_stale_jobs()` but assert on the fixture jobs only: e.g. take the jobs reaped as "fixture jobs whose state
   moved to failed by that call" (`test.id('jobB')`, `test.id('jobQ')` and any other fixture job the block creates), so
   N2 reads "jobB and jobQ are still not failed" and the next check reads "exactly jobB was failed, jobQ was not". Keep
   every assertion message string exactly as it is: the mutants in `supabase/tests/run-local.mjs` lines 201 to 204 name them.
   Search the rest of the file for any other global count of jobs, events or rows that a non-empty database would break
   (grep `count(*)` without a workspace or fixture-id filter, and `reap_stale_jobs`); fix the ones of the same kind, list
   the others as findings.
2. Do not edit `supabase/tests/run-local.mjs` (5-H holds uncommitted lines there). If a new mutant is needed, send it back
   as a finding with the exact line.

## Done when (local only, paste real output lines into your report)
- Watched red, old shape: on a local cluster (`node supabase/tests/run-local.mjs --keep`, or the file alone against the
  kept cluster), plant one extra publish job outside the fixture that is past the 24 hour limit before the block runs:
  with the ORIGINAL assertions the file fails with the N2 message; with yours it passes. Put the planting in a scratch
  file, not in the repo.
- The four mutants still caught: `node supabase/tests/run-local.mjs --only "stale jobs are reaped"`, `--only "reaper counts"`,
  `--only "done after reap"` (or one `--only reap` / N2 run that covers 201 to 204): every one KILLED.
- The whole file passes on a clean local cluster.
- Run heavy commands through `node ~/.claude/scripts/heavy.mjs -- <cmd>` (machine-wide lock; if it waits, keep it waiting,
  bounded 30 min, then report BLOCKED with the holder).
- No staging command, no commit, no push (the head lands it). No em dashes in any file.

## Report (two lines to the head, details in the report body)
PROVEN / NOT DONE / BLOCKED; the files changed; the watched-red line and the mutant lines pasted.
