-- Omnikom Platform: work order 13 (hardening H0-1, the reaper), migration 19. Additive to migrations 1 to 18; changes no table or function.
-- service.reap_stale_jobs() (migration 8) fails a job stuck in building, gating or deploying for 30 minutes (queued: 24 hours), but nothing
-- ran it: a runner killed at the workflow's 30-minute limit left its job running and every later publish of that site failed S-JOB-BUSY
-- (freeze_snapshot). pg_cron now runs it every 5 minutes under the name reap-stale-jobs. The named form of cron.schedule replaces a job of the
-- same name, so applying this file again changes nothing.
-- pg_cron is installed on staging and production in its own schema `cron` (tools/staging-extensions.mjs); local and CI Postgres has none, so the
-- call is guarded: without cron.schedule(text, text, text) one notice is printed and the migration still succeeds. This file never creates the
-- extension. Tests: tenancy.test.sql T25 (the harness stands in for cron, supabase/tests/run-local.mjs) and the mutant "reaper: ...".
do $$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('reap-stale-jobs', '*/5 * * * *', 'select service.reap_stale_jobs()');
  else
    raise notice 'pg_cron is not installed here: the stale-job reaper (service.reap_stale_jobs) is not scheduled';
  end if;
end $$;
