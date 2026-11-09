-- Omnikom Platform: work order 10 (seo-read), migration 16. Additive to migrations 1 to 15. No new table.
-- Every publish job stores its audit summary (tools/audit/summary.mjs, version 1) in publish_jobs.gate_report -> 'audit' (the runner does this
-- since work order 10); this migration reads it back for one site.
--  1. private.audit_row(job, finished_at, state, report, full)   one job as { job, finished_at, state, target, pass, counts, summary }. Only a
--     report whose audit has v = 1 gives target, pass, counts (and summary when `full`); an older report (no v) gives nulls, never an error.
--  2. service.site_audit(claims, site)   owner of the site's workspace, or staff with MFA, else S-NOT-FOUND (a member gets not found, as site
--     settings are hidden from members; so does a site that does not exist). Answers
--       { latest: { preview: <row>|null, production: <row>|null }, history: [<row>, ...] }
--     latest = the newest finished job per target whose audit has v = 1 (its summary, fails included); history = the last 10 finished jobs
--     (done or failed) of the site, newest first, each WITHOUT fails (summary null), a job from before v 1 with pass and counts null.
--  Index: none added. publish_jobs_site_state (site_id, state) from migration 4 serves the read (the site's finished jobs are found by it; the
--  few hundred a site makes in a year are sorted in memory); revisit when one site passes about 10,000 jobs (docs/product/3-database.md).
-- Tests: tenancy.test.sql T24 and run-local.mjs mutants "audit16: ...".

create function private.audit_row(p_job uuid, p_finished timestamptz, p_state public.job_state, p_report jsonb, p_full boolean) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('job', p_job, 'finished_at', p_finished, 'state', p_state,
    'target', case when x.v then x.a ->> 'target' end,
    'pass', case when x.v and jsonb_typeof(x.a -> 'pass') = 'boolean' then x.a -> 'pass' end,
    'counts', case when x.v and jsonb_typeof(x.a -> 'counts') = 'object' then x.a -> 'counts' end,
    'summary', case when x.v and p_full then x.a end)
  from (select p_report -> 'audit' as a, coalesce(p_report #>> '{audit,v}' = '1', false) as v) x $$;

create function service.site_audit(p_claims jsonb, p_site uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid; ws uuid; prev jsonb; prod jsonb; hist jsonb;
begin
  me := service.use_claims(p_claims);
  select s.workspace_id into ws from public.sites s where s.id = p_site;
  if ws is null or not private.is_owner_or_staff(ws) then raise exception 'S-NOT-FOUND: not found'; end if;
  select private.audit_row(j.id, j.finished_at, j.state, j.gate_report, true) into prev from public.publish_jobs j
    where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'preview'
    order by j.finished_at desc nulls last, j.id desc limit 1;
  select private.audit_row(j.id, j.finished_at, j.state, j.gate_report, true) into prod from public.publish_jobs j
    where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'production'
    order by j.finished_at desc nulls last, j.id desc limit 1;
  select coalesce(jsonb_agg(h.r order by h.finished_at desc nulls last, h.id desc), '[]'::jsonb) into hist
    from (select j.id, j.finished_at, private.audit_row(j.id, j.finished_at, j.state, j.gate_report, false) as r from public.publish_jobs j
          where j.site_id = p_site and j.state in ('done', 'failed') order by j.finished_at desc nulls last, j.id desc limit 10) h;
  return jsonb_build_object('latest', jsonb_build_object('preview', prev, 'production', prod), 'history', hist);
end $$;

-- ---------- grants: closed to PUBLIC, anon and authenticated; the function role (and service_role) only ----------
revoke all on function private.audit_row(uuid, timestamptz, public.job_state, jsonb, boolean) from public, anon, authenticated;
revoke all on function service.site_audit(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.site_audit(jsonb, uuid) to service_role, omnikom_fn;
