// The schema and the planted rows of the alerts tests, shared by alerts.test.mjs and 6b-mutate.mjs (which plants once and runs every
// mutant of alerts.mjs against the same database, because starting a cluster and applying the migrations is the slow part).
// The schema is the repository's own: supabase/tests/local-shim.sql, then every migration in file order (the way run-local.mjs does).
import { readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SCHEMA_FILES = [join(REPO, 'supabase', 'tests', 'local-shim.sql'),
  ...readdirSync(join(REPO, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort().map(f => join(REPO, 'supabase', 'migrations', f))];

// returns { ok, err }
export function applySchema(cluster, db) {
  for (const f of SCHEMA_FILES) { const r = cluster.psql(db, ['-q', '-f', f]); if (r.status !== 0) return { ok: false, err: `${f}: ${(r.stderr || '').split('\n')[0]}` }; }
  return { ok: true, err: '' };
}

export const PLANT_SQL = `
alter table publish_jobs disable trigger publish_jobs_ready;      -- the wall of migration 11 needs real rows; these tests plant job states only
insert into auth.users (id, email) values ('a1000000-0000-0000-0000-0000000000a1', 'owner@test'), ('f1000000-0000-0000-0000-0000000000f1', 'staff1@test'),
  ('f2000000-0000-0000-0000-0000000000f2', 'staff2@test'), ('f3000000-0000-0000-0000-0000000000f3', 'staff3@test'), ('f4000000-0000-0000-0000-0000000000f4', 'staff4@test'),
  ('f5000000-0000-0000-0000-0000000000f5', 'staff5@test'), ('f6000000-0000-0000-0000-0000000000f6', 'staff6@test'), ('f7000000-0000-0000-0000-0000000000f7', 'staff7@test'),
  ('f8000000-0000-0000-0000-0000000000f8', 'staff8@test'), ('f9000000-0000-0000-0000-0000000000f9', 'staff9@test');
insert into staff select id from auth.users where email like 'staff%@test' and email <> 'staff9@test';     -- staff9 is a plain login
insert into workspaces (id, slug, name, industry) values ('aaaaaaaa-0000-0000-0000-000000000000', 'ws-alerts', 'Name That Must Not Print', 'real-estate-agent');
create function pg_temp.mk_site(p_target text, p_state site_state, p_days int) returns uuid language sql as $$
  insert into sites (workspace_id, deploy_target, preview_host, state, created_at) values ('aaaaaaaa-0000-0000-0000-000000000000', p_target, p_target || '.preview.test', p_state, now() - make_interval(days => p_days)) returning id $$;
create function pg_temp.mk_job(p_site uuid, p_state job_state, p_min_ago int, p_err text default null) returns uuid language sql as $$
  insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested, state, error, created_at, finished_at)
  values ('aaaaaaaa-0000-0000-0000-000000000000', p_site, 'a1000000-0000-0000-0000-0000000000a1', '{}', '{}', p_state, p_err, now() - make_interval(mins => p_min_ago),
          case when p_state in ('done', 'failed') then now() - make_interval(mins => p_min_ago - 1) end) returning id $$;
create function pg_temp.mk_lead(p_site uuid, p_days_ago int) returns uuid language sql as $$
  insert into leads (workspace_id, site_id, form, page_path, name, email, consent_text, created_at)
  values ('aaaaaaaa-0000-0000-0000-000000000000', p_site, 'contact', '/', 'Jane Secret', 'jane.secret@example.com', 'I agree', now() - make_interval(days => p_days_ago)) returning id $$;
create function pg_temp.ev(p_lead uuid, p_kind lead_event_kind, p_min_ago int, p_code text default null) returns void language sql as $$
  insert into lead_events (lead_id, workspace_id, kind, detail, at) values (p_lead, 'aaaaaaaa-0000-0000-0000-000000000000', p_kind, case when p_code is null then '{}'::jsonb else jsonb_build_object('code', p_code) end, now() - make_interval(mins => p_min_ago)) $$;

-- publish-failed-twice
select pg_temp.mk_job(pg_temp.mk_site('pf-fire', 'preview', 1), 'failed', 180, 'export 401'), 1;
select pg_temp.mk_job((select id from sites where deploy_target = 'pf-fire'), 'failed', 60, 'build error: heading missing');
select pg_temp.mk_job(pg_temp.mk_site('pf-one', 'preview', 1), 'failed', 60);
select pg_temp.mk_job(pg_temp.mk_site('pf-mixed', 'preview', 1), 'failed', 180);
select pg_temp.mk_job((select id from sites where deploy_target = 'pf-mixed'), 'done', 120);
select pg_temp.mk_job((select id from sites where deploy_target = 'pf-mixed'), 'failed', 60);
select pg_temp.mk_job(pg_temp.mk_site('pf-recovered', 'preview', 1), 'failed', 240);
select pg_temp.mk_job((select id from sites where deploy_target = 'pf-recovered'), 'failed', 180);
select pg_temp.mk_job((select id from sites where deploy_target = 'pf-recovered'), 'done', 60);
select pg_temp.mk_job(pg_temp.mk_site('pf-retrying', 'preview', 1), 'failed', 240);
select pg_temp.mk_job((select id from sites where deploy_target = 'pf-retrying'), 'failed', 180);
select pg_temp.mk_job((select id from sites where deploy_target = 'pf-retrying'), 'queued', 1);

-- job-over-30-min (the ages are minutes since the job was made)
select pg_temp.mk_job(pg_temp.mk_site('jo-building-45', 'preview', 1), 'building', 45);
select pg_temp.mk_job(pg_temp.mk_site('jo-queued-35', 'preview', 1), 'queued', 35);
select pg_temp.mk_job(pg_temp.mk_site('jo-deploying-25', 'preview', 1), 'deploying', 25);
select pg_temp.mk_job(pg_temp.mk_site('jo-building-10', 'preview', 1), 'building', 10);
select pg_temp.mk_job(pg_temp.mk_site('jo-done-old', 'preview', 1), 'done', 600);

-- lead-push-failed
select pg_temp.mk_site('lp-site', 'preview', 1);
select pg_temp.mk_lead((select id from sites where deploy_target = 'lp-site'), 1) as l \\gset lf_
select pg_temp.ev(:'lf_l', 'push-failed', m, '401') from generate_series(400, 100, -100) m;
select pg_temp.mk_lead((select id from sites where deploy_target = 'lp-site'), 1) as l \\gset l3_
select pg_temp.ev(:'l3_l', 'push-failed', m, '503') from generate_series(300, 100, -100) m;
select pg_temp.mk_lead((select id from sites where deploy_target = 'lp-site'), 1) as l \\gset lp_
select pg_temp.ev(:'lp_l', 'push-failed', m, '503') from generate_series(400, 100, -100) m;
select pg_temp.ev(:'lp_l', 'pushed', 50);
select pg_temp.mk_lead((select id from sites where deploy_target = 'lp-site'), 1) as l \\gset lr_
select pg_temp.ev(:'lr_l', 'pushed', 500);
select pg_temp.ev(:'lr_l', 'push-failed', m, '500') from generate_series(400, 100, -100) m;
select pg_temp.mk_lead((select id from sites where deploy_target = 'lp-site'), 1) as l \\gset lo_
select pg_temp.ev(:'lo_l', 'alert-failed', m) from generate_series(400, 100, -100) m;      -- another kind four times: not a push

-- no-leads-7-days
select pg_temp.mk_lead(pg_temp.mk_site('nl-silent-8', 'live', 30), 8);
select pg_temp.mk_site('nl-never', 'live', 30);
select pg_temp.mk_lead(pg_temp.mk_site('nl-recent-2', 'live', 30), 2);
select pg_temp.mk_lead(pg_temp.mk_site('nl-edge-6', 'live', 30), 6);
select pg_temp.mk_site('nl-preview', 'preview', 30);
select pg_temp.mk_site('nl-paused', 'paused', 30);
select pg_temp.mk_site('nl-new-3', 'live', 3);

-- security-not-found-burst
create function pg_temp.sec(p_actor uuid, p_code text, p_n int, p_min_ago int) returns void language sql as $$
  insert into security_events (kind, code, workspace_id, actor, at) select 'refused', p_code, 'aaaaaaaa-0000-0000-0000-000000000000', p_actor, now() - make_interval(mins => p_min_ago) from generate_series(1, p_n) $$;
select pg_temp.sec('f1000000-0000-0000-0000-0000000000f1', 'S-NOT-FOUND', 10, 30);
select pg_temp.sec('f2000000-0000-0000-0000-0000000000f2', 'S-NOT-FOUND', 9, 30);
select pg_temp.sec('f3000000-0000-0000-0000-0000000000f3', 'S-NOT-FOUND', 10, 75);
select pg_temp.sec('f4000000-0000-0000-0000-0000000000f4', 'S-OWN-ONLY', 10, 30);
select pg_temp.sec(null, 'S-NOT-FOUND', 10, 30);
select pg_temp.sec('f5000000-0000-0000-0000-0000000000f5', 'S-NOT-FOUND', 6, 20);
select pg_temp.sec('f5000000-0000-0000-0000-0000000000f5', 'S-NOT-FOUND', 6, 90);

-- security-staff-after-hours: the most recent such day in US Pacific time, at a given clock time (never today, so the time is in the past)
create function pg_temp.pt(p_isodow int, p_time time) returns timestamptz language sql as $$
  select (((now() at time zone 'America/Los_Angeles')::date - (((extract(isodow from (now() at time zone 'America/Los_Angeles')::date)::int - p_isodow + 6) % 7) + 1)) + p_time) at time zone 'America/Los_Angeles' $$;
create function pg_temp.act(p_actor uuid, p_at timestamptz) returns void language sql as $$
  insert into audit_log (workspace_id, actor, action, target, at) values ('aaaaaaaa-0000-0000-0000-000000000000', p_actor, 'lead-delete', 'x', p_at) $$;
select pg_temp.act('f1000000-0000-0000-0000-0000000000f1', pg_temp.pt(6, '12:00'));      -- staff on a Saturday
select pg_temp.act('f2000000-0000-0000-0000-0000000000f2', pg_temp.pt(3, '10:00'));      -- staff on a Wednesday morning: in hours
select pg_temp.act('f3000000-0000-0000-0000-0000000000f3', pg_temp.pt(3, '03:00'));      -- staff at 03:00
select pg_temp.act('f4000000-0000-0000-0000-0000000000f4', pg_temp.pt(3, '19:00'));      -- 19:00 sharp: out (the end is exclusive)
select pg_temp.act('f5000000-0000-0000-0000-0000000000f5', pg_temp.pt(3, '18:59'));      -- 18:59: in
select pg_temp.act('f6000000-0000-0000-0000-0000000000f6', pg_temp.pt(3, '07:00'));      -- 07:00 sharp: in
select pg_temp.act('f7000000-0000-0000-0000-0000000000f7', pg_temp.pt(3, '06:59'));      -- 06:59: out
select pg_temp.act('f8000000-0000-0000-0000-0000000000f8', pg_temp.pt(7, '12:00') - interval '30 days');   -- a Sunday a month ago: outside the window
select pg_temp.act('f9000000-0000-0000-0000-0000000000f9', pg_temp.pt(6, '12:00'));      -- a plain login (not staff) on a Saturday

-- function-errors (migration 32): the 5xx answers of a function and status in the last 60 minutes, 5 or more fire
create function pg_temp.fe(p_fn text, p_status int, p_n int, p_min_ago int, p_req uuid) returns void language sql as $$
  insert into function_errors (fn, status, minute, n, last_request, last_at)
  values (p_fn, p_status, date_trunc('minute', now() - make_interval(mins => p_min_ago)), p_n, p_req, now() - make_interval(mins => p_min_ago)) $$;
select pg_temp.fe('capture-lead', 500, 3, 10, 'e3100000-0000-0000-0000-000000000001');   -- 3 + 2 in the hour: fires, newest request e3100000
select pg_temp.fe('capture-lead', 500, 2, 30, 'e3300000-0000-0000-0000-000000000002');
select pg_temp.fe('lead-list', 500, 4, 10, 'e3400000-0000-0000-0000-000000000003');      -- 4: one under 5
select pg_temp.fe('publish', 502, 5, 70, 'e3700000-0000-0000-0000-000000000004');        -- 5, but 70 minutes ago: outside the hour
select pg_temp.fe('save', 500, 3, 50, 'e3500000-0000-0000-0000-000000000005');           -- 3 in the hour and 2 at 65 minutes: quiet
select pg_temp.fe('save', 500, 2, 65, 'e3650000-0000-0000-0000-000000000006');

-- for the read only test: a function that writes (a query that calls it inside a read only transaction must be refused)
create or replace function public.zz_evil() returns jsonb language plpgsql as $$ begin insert into workspaces (slug, name, industry) values ('evil', 'x', 'y'); return '[]'::jsonb; end $$;
`;

export const plant = (cluster, db) => { const r = cluster.sql(db, PLANT_SQL); if (!r.ok) throw new Error(`planting failed: ${r.err.split('\n')[0]}`); };
