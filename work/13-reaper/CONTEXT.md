# 13 reaper

Owner: platform build. Model: Sonnet (high). Branch: check/platform/reaper. Status: BUILT, not committed (steps 1 to 4 and 6; local proof only). Step 5 (staging read-back) is NOT DONE: the head runs it.

## Why
Hardening H0-1, `docs/product/1-product.md` part E row E4. The stale-job reaper `service.reap_stale_jobs()` exists
(`supabase/migrations/20261030000008_search_path_and_roles.sql:255`) but nothing schedules it. A job stuck in building,
gating or deploying (runner killed at the 30-minute timeout, `.github/workflows/publish.yml:42`) makes every later publish of
that site fail S-JOB-BUSY (`freeze_snapshot`, same file :233-234, answered 409 by `supabase/functions/export-published/index.ts`);
the runner turns that 409 into a permanent `failed` (`factory/runner/publish.mjs:86`; `makePlatform` retries only 502-504,
`factory/runner/lib/common.mjs:41`). Evidence: `work/11-enterprise-audit/CONTEXT.md` H0-1.

## Inputs (load these, nothing else)
- `work/11-enterprise-audit/CONTEXT.md` H0-1; `docs/product/11-rules.md` 30-36; `docs/departments/README.md` rule 8
- `supabase/migrations/20261030000008_search_path_and_roles.sql` (reap_stale_jobs, freeze_snapshot, set_job_state)
- `supabase/tests/run-local.mjs` (MUTANTS at :74, how a migration mutant is written), `supabase/tests/tenancy.test.sql:264-280`
- `tools/staging-extensions.mjs` (pg_cron on staging lives in its own schema `cron`)
- `factory/runner/publish.mjs`, `factory/runner/lib/common.mjs`, `factory/runner/test/run.mjs`, `factory/runner/test/mutate.mjs`,
  `factory/runner/test/lib/fake-platform.mjs`

## Steps
1. New migration `supabase/migrations/20261109000019_reaper_schedule.sql` (number 19 is reserved for this order; 16 and 17
   are on other branches, 20 and 21 are reserved for H0-2 and H0-4). It schedules `select service.reap_stale_jobs()` every
   5 minutes under the job name `reap-stale-jobs` with `cron.schedule(name, schedule, command)`, idempotent (the named form
   replaces a job of the same name). Local and CI Postgres has NO pg_cron: guard the call with
   `to_regprocedure('cron.schedule(text,text,text)') is not null`; when it is absent, `raise notice` one plain line and go on
   (never fail). Never `create extension` in this migration.
2. Local proof of step 1: the test harness (never a migration, never staging) creates a stub schema `cron` with
   `cron.schedule(text,text,text)` that records its arguments in a table, before the migrations run. A wall asserts exactly
   one recorded job named `reap-stale-jobs`, schedule `*/5 * * * *`, a command calling `service.reap_stale_jobs()`. A mutant
   in MUTANTS removes the schedule call; it must be caught.
3. Runner: when `GET /export-published` answers 409 and the body says S-JOB-BUSY, wait and try again with backoff
   (30 s, 60 s, then 120 s per try; tests shrink the times through an env number, like RUNNER_RETRY_BACKOFF_MS), up to a total
   wait of `RUNNER_BUSY_WAIT_MS` (default 20 minutes, inside the 30-minute workflow limit). One STEP line per wait
   (`STEP export: site busy (S-JOB-BUSY), waiting N s, try k`). When the time is up: Stop with the reason
   `site busy: another build of this site is still running after N min (the reaper clears a stuck one within 35 min)`.
   Any other 409, and every other status, behave exactly as today.
4. Runner tests (fake platform): busy twice then 200 -> the run goes on and ends done; busy past the limit -> failed with the
   reason above and the waits printed; a 409 that is not S-JOB-BUSY -> failed at once, no wait. Each watched red first (say
   how in the report). Two mutants in `test/mutate.mjs`: the retry removed; the S-JOB-BUSY check widened to every 409.
5. Staging (the head runs it, after CI is 9/9 on the tip): apply-staging applies migration 19; then
   `select jobname, schedule, command, active from cron.job where jobname = 'reap-stale-jobs'` shows one active row, and after
   at least 5 minutes `cron.job_run_details` for it shows `succeeded`. Stale jobs already on staging are reaped by the
   schedule, never by hand. The read-back lines go in the report.
6. Book: E4 stays MISSING until H1-4 (outbox) lands; its evidence column becomes "the reaper runs every 5 minutes on staging
   (H0-1, work order 13); no outbox (H1-4)". Check `docs/product/3-database.md:103` and `4-backend.md:96` match the code.

## Outputs
- `supabase/migrations/20261109000019_reaper_schedule.sql`; `supabase/tests/run-local.mjs` (stub, wall, mutant) and, if
  needed, `supabase/tests/tenancy.test.sql`; `factory/runner/publish.mjs`; `factory/runner/test/run.mjs`, `test/mutate.mjs`,
  `test/lib/fake-platform.mjs`; this file's status line; `docs/product/1-product.md` row E4 (the head recomputes the counts
  from the rows).
- Nothing else. A change any other file needs is a finding.

## Proof
- `node supabase/tests/run-local.mjs` scoped to the new mutant: caught; the real migration passes (paste the line).
- `node factory/runner/test/run.mjs` -> "OK: N of N checks passed"; `test/mutate.mjs` scoped to the two new mutants: both caught.
- No full mutant run and no run-all-gates locally (rule 8): CI runs those.
- The staging read-back of step 5.

## Findings
Send to the head; never fix here.
