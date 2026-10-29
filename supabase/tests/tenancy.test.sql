-- Tenancy tests (TENANCY-AND-PUBLISHING 4 + the contract's write rules). Run by run-local.mjs on the Supabase model in
-- local-shim.sql (default grants included); any failed ASSERT stops psql with a non-zero exit.
-- Safe to run on staging (W0.3): everything happens in one transaction that is rolled back at the end; auth.users is filled
-- by named columns (on Supabase use the Auth admin API instead if direct inserts are not allowed).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

create schema test;
create function test.expect_error(stmt text, code text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'EXPECTED % BUT IT SUCCEEDED: %', code, stmt;
exception when others then
  if sqlerrm like 'EXPECTED %' then raise; end if;
  if position(code in sqlerrm) = 0 then raise exception 'EXPECTED % GOT: %', code, sqlerrm; end if;
end $$;
-- act_as(sub, aal): the JWT claims Supabase would put on the request
create function test.act_as(sub text, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', case when sub is null then '' else json_build_object('sub', sub, 'aal', aal)::text end, false),
         set_config('request.jwt.claim.sub', coalesce(sub, ''), false) $$;
create function test.claims() returns jsonb language sql as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
-- what the save / publish Edge Functions do after verifying the user's JWT (these helpers stand in for the functions)
create function test.save(p_ws uuid, p_coll text, p_row uuid, p_data jsonb, p_sign_off jsonb default null)
returns table (row_id uuid, version int) language sql security definer as $$ select * from service.save_as(test.claims(), p_ws, p_coll, p_row, p_data, p_sign_off) $$;
create function test.publish(p_site uuid, p_rows uuid[], p_versions int[] default null) returns uuid language sql security definer as $$
  select service.start_publish(test.claims(), p_site, p_rows,
    coalesce(p_versions, (select array_agg((select max(n) from content_versions v where v.row_id = r) order by i) from unnest(p_rows) with ordinality x(r, i)))) $$;
-- step C: what the lead-update and add-lead Edge Functions do after verifying the user's JWT
create function test.lead_update(p_lead uuid, p_status lead_status default null, p_owner uuid default null, p_note text default null)
returns void language sql security definer as $$ select service.lead_update(test.claims(), p_lead, p_status, p_owner, p_note) $$;
create function test.add_lead(p_site uuid, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text, p_owner uuid default null)
returns uuid language sql security definer as $$ select service.add_lead(test.claims(), p_site, p_name, p_email, p_phone, p_answers, p_consent, 'manual', p_owner) $$;
-- step C expansion blocks (migration 3): what the add-on, booking and template Edge Functions do after verifying the user's JWT
create function test.book(p_lead uuid, p_with uuid, p_starts timestamptz, p_ends timestamptz, p_where text default null, p_source booking_source default 'manual')
returns uuid language sql security definer as $$ select service.book(test.claims(), p_lead, p_with, p_starts, p_ends, p_where, p_source) $$;
create function test.set_booking_state(p_booking uuid, p_state booking_state) returns void language sql security definer as $$ select service.set_booking_state(test.claims(), p_booking, p_state) $$;
create function test.activate_addon(p_ws uuid, p_kind addon_kind) returns void language sql security definer as $$ select service.activate_addon(test.claims(), p_ws, p_kind) $$;
create function test.set_addon_state(p_ws uuid, p_kind addon_kind, p_state addon_state) returns void language sql security definer as $$ select service.set_addon_state(test.claims(), p_ws, p_kind, p_state) $$;
create function test.save_crm_template(p_ws uuid, p_id uuid, p_name text, p_columns jsonb) returns uuid language sql security definer as $$ select service.save_crm_template(test.claims(), p_ws, p_id, p_name, 'custom', 'export', p_columns) $$;
grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- fixtures (as the superuser)
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a', 'owner-a@test'), ('00000000-0000-0000-0000-00000000000b', 'owner-b@test'),
 ('00000000-0000-0000-0000-0000000000a1', 'agent1-a@test'), ('00000000-0000-0000-0000-0000000000a2', 'agent2-a@test'),
 ('00000000-0000-0000-0000-00000000005f', 'staff@omnikom');
insert into staff values ('00000000-0000-0000-0000-00000000005f');
insert into workspaces (id, slug, name, industry) values
 ('aaaaaaaa-0000-0000-0000-000000000000', 'test-demo-a', 'Demo A', 'real-estate-agent'),
 ('bbbbbbbb-0000-0000-0000-000000000000', 'test-demo-b', 'Demo B', 'real-estate-agent');
insert into sites (id, workspace_id, deploy_target, preview_host) values
 ('aaaaaaaa-0000-0000-0000-00000000517e', 'aaaaaaaa-0000-0000-0000-000000000000', 'test-site-demo-a', 'demo-a.preview.test'),
 ('bbbbbbbb-0000-0000-0000-00000000517e', 'bbbbbbbb-0000-0000-0000-000000000000', 'test-site-demo-b', 'demo-b.preview.test');
insert into site_contracts (workspace_id, version, contract, resolved, active)
select ws, 1, '{}'::jsonb, '{"collections":{
  "team":{"kind":"collection","access":{"member":"own"},"ownerField":"self","fields":{"name":{"type":"text"},"licence":{"type":"group","locked":{"reason":"fact"}}}},
  "listings":{"kind":"collection","access":{"member":"own"},"ownerField":"agent","fields":{"street":{"type":"text"},"agent":{"type":"reference","to":"team"}}},
  "settings":{"kind":"singleton","access":{"member":"none"},"fields":{"businessName":{"type":"text"},"licences":{"type":"list","locked":{"reason":"fact"}}}},
  "leads":{"kind":"inbox","access":{"member":"own"},"ownerField":"owner","fields":{"status":{"type":"enum"}}}}}'::jsonb, true
from (values ('aaaaaaaa-0000-0000-0000-000000000000'::uuid), ('bbbbbbbb-0000-0000-0000-000000000000'::uuid)) v(ws);
insert into members (workspace_id, user_id, role) values
 ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'owner'),
 ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'owner'),
 ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'member'),
 ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'member');
create table test.ids (k text primary key, v uuid);
grant all on test.ids to anon, authenticated, service_role;
create function test.id(k text) returns uuid language sql as $$ select v from test.ids where test.ids.k = id.k $$;
grant execute on function test.id(text) to anon, authenticated, service_role;

-- ===== T0 seeding without a user session: explicit actor, must be staff =====
set role service_role;
insert into test.ids select 'team1', service.seed_version('aaaaaaaa-0000-0000-0000-000000000000', 'team', '{"name":"Agent One"}', '00000000-0000-0000-0000-00000000005f', 'plan sitemap sha256 abc123');
select test.expect_error($q$select service.seed_version('aaaaaaaa-0000-0000-0000-000000000000', 'team', '{"name":"X"}', '00000000-0000-0000-0000-00000000000a', 'ref')$q$, 'S-SEED-ACTOR');
reset role;
do $$ begin
  assert (select by from content_versions where row_id = test.id('team1')) = '00000000-0000-0000-0000-00000000005f', 'seed records the staff actor';
  assert (select sign_off ->> 'ref' from content_versions where row_id = test.id('team1')) = 'plan sitemap sha256 abc123', 'seed records its reference';
end $$;
-- N10: no function in public is executable by anon (extensions live elsewhere)
do $$ begin assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')) = 0, 'no public function executable by anon'; end $$;

-- ===== owner A creates a team row and links the agents' logins =====
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
insert into test.ids select 'team2', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'team', null, '{"name":"Agent Two"}');
update members set team_row_id = test.id('team1') where user_id = '00000000-0000-0000-0000-0000000000a1';
update members set team_row_id = test.id('team2') where user_id = '00000000-0000-0000-0000-0000000000a2';
insert into test.ids select 'settingsA', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'settings', null, '{"businessName":"Demo A"}');
do $$ begin assert (select count(*) from content_versions) = 3, 'owner A sees the 3 versions'; end $$;

-- ===== T1 locked field and singleton =====
select test.expect_error(format($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','settings',%L,'{"businessName":"Demo A","licences":[{"n":"1"}]}')$q$, test.id('settingsA')), 'S-LOCKED');
select test.expect_error($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','settings',null,'{"businessName":"Again"}')$q$, 'S-SINGLETON');

-- ===== T2 member: own items only; owner field from the login =====
select test.act_as('00000000-0000-0000-0000-0000000000a1');
insert into test.ids select 'listing1', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"1 Demo Rd"}');
do $$ begin assert (select owner_team_row from content_rows where id = test.id('listing1')) = test.id('team1'), 'owner field set from the login'; end $$;
select test.expect_error($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','settings',null,'{"businessName":"X"}')$q$, 'S-ROLE');
select test.act_as('00000000-0000-0000-0000-0000000000a2');
insert into test.ids select 'listing2', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"2 Demo Rd"}');
select test.expect_error(format($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','listings',%L,'{"street":"hijack"}')$q$, test.id('listing1')), 'S-OWN-ONLY');
select test.expect_error(format($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','listings',null,'{"street":"for someone else","agent":"%s"}')$q$, test.id('team1')), 'S-OWN-ONLY');
-- T2b publish follows the same rules: agent two cannot publish agent one's listing
select test.expect_error(format($q$select test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[%L::uuid])$q$, test.id('listing1')), 'S-OWN-ONLY');

-- ===== T3 cross-client: B cannot read, edit, write, upload or publish into A =====
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from content_rows where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'B reads no A rows';
  assert (select count(*) from content_versions where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'B reads no A versions';
  assert (select count(*) from workspaces) = 1, 'B sees only its own workspace';
  assert (select count(*) from members where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'B sees no A members';
  assert private.collection_def('aaaaaaaa-0000-0000-0000-000000000000', 'listings') is null, 'B cannot read A contract through collection_def';
end $$;
select test.expect_error(format($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','listings',%L,'{"street":"x"}')$q$, test.id('listing1')), 'S-NOT-FOUND');
select test.expect_error($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','listings',null,'{"street":"x"}')$q$, 'S-NOT-FOUND');
select test.expect_error(format($q$select test.save('bbbbbbbb-0000-0000-0000-000000000000','listings',%L,'{"street":"x"}')$q$, test.id('listing1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.publish('bbbbbbbb-0000-0000-0000-00000000517e', array[%L::uuid])$q$, test.id('listing1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[%L::uuid])$q$, test.id('listing1')), 'S-NOT-FOUND');
select test.expect_error($q$insert into media (workspace_id, path, uploaded_by) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000/x.jpg', '00000000-0000-0000-0000-00000000000b')$q$, 'row-level security');
select test.expect_error($q$insert into media (workspace_id, path, uploaded_by) values ('bbbbbbbb-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000/x.jpg', '00000000-0000-0000-0000-00000000000b')$q$, 'media_path_in_workspace');

-- ===== T12 the save/publish functions load the contract only after membership (no field names leak to outsiders) =====
reset role;
set role service_role;
select test.expect_error($q$select service.contract_for('{"sub":"00000000-0000-0000-0000-00000000000b","aal":"aal1"}', 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
do $$ begin assert service.contract_for('{"sub":"00000000-0000-0000-0000-0000000000a1","aal":"aal1"}', 'aaaaaaaa-0000-0000-0000-000000000000') -> 'collections' ? 'listings', 'a member gets the contract'; end $$;
reset role;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000b');

-- ===== T10 storage objects: the first folder must be a workspace you can see; a non-uuid folder is denied, not an error =====
select test.expect_error($q$insert into storage.objects (bucket_id, name) values ('media', 'aaaaaaaa-0000-0000-0000-000000000000/x.jpg')$q$, 'row-level security');
select test.expect_error($q$insert into storage.objects (bucket_id, name) values ('media', 'not-a-uuid/x.jpg')$q$, 'row-level security');
insert into storage.objects (bucket_id, name) values ('media', 'bbbbbbbb-0000-0000-0000-000000000000/ok.jpg');
do $$ begin assert (select count(*) from storage.objects) = 1, 'B sees only its own object'; end $$;

-- ===== T4 versions append-only; no client can write content except through the save function =====
select test.expect_error($q$update content_versions set data = '{}'$q$, 'permission denied');
select test.expect_error($q$delete from content_versions$q$, 'permission denied');
select test.expect_error($q$insert into content_rows (workspace_id, collection) values ('bbbbbbbb-0000-0000-0000-000000000000','listings')$q$, 'permission denied');
select test.expect_error($q$select * from private.save_version('bbbbbbbb-0000-0000-0000-000000000000','listings',null,'{"street":"skip the validator"}')$q$, 'permission denied');
select test.expect_error($q$select * from service.save_as('{"sub":"00000000-0000-0000-0000-00000000000b"}','bbbbbbbb-0000-0000-0000-000000000000','listings',null,'{}')$q$, 'permission denied');
select test.expect_error($q$select * from service.published_rows('00000000-0000-0000-0000-000000000000')$q$, 'permission denied');
select test.expect_error($q$select service.seed_version('bbbbbbbb-0000-0000-0000-000000000000', 'team', '{}', '00000000-0000-0000-0000-00000000005f', 'ref')$q$, 'permission denied');
select test.expect_error($q$select service.set_job_state('00000000-0000-0000-0000-000000000000', 'done')$q$, 'permission denied');

-- ===== T5 staff: only with MFA (aal2); a locked change needs a sign-off, which is recorded =====
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal1');
select test.expect_error(format($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','settings',%L,'{"businessName":"Demo A"}')$q$, test.id('settingsA')), 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.expect_error(format($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','settings',%L,'{"businessName":"Demo A","licences":[{"n":"1"}]}')$q$, test.id('settingsA')), 'S-SIGNOFF');
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'settings', test.id('settingsA'), '{"businessName":"Demo A","licences":[{"n":"1"}]}', '{"by":"abdo","ref":"sign-off test"}');
do $$ begin assert (select sign_off ->> 'ref' from content_versions where row_id = test.id('settingsA') order by n desc limit 1) = 'sign-off test', 'sign-off recorded'; end $$;

-- ===== T6 publish: job + frozen snapshot; nothing goes live until done; a failed job never ships later =====
select test.act_as('00000000-0000-0000-0000-0000000000a1');
insert into test.ids select 'job1', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('listing1')]);
reset role;
set role service_role;
select service.freeze_snapshot(test.id('job1'));
do $$ begin
  assert (select count(*) from service.published_rows(test.id('job1'))) = 1, 'job 1 ships the listing';
  assert (select published_version from content_rows where id = test.id('listing1')) is null, 'nothing live before the job is done';
end $$;
select service.set_job_state(test.id('job1'), 'failed', '{"gate":"alt"}');
do $$ begin assert (select published_version from content_rows where id = test.id('listing1')) is null, 'a failed job publishes nothing'; end $$;
-- the dry-run leak: after a FAILED publish of listing1, an unrelated publish (listing2) must not ship listing1
reset role;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a2');
insert into test.ids select 'jobOther', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('listing2')]);
reset role;
set role service_role;
select service.freeze_snapshot(test.id('jobOther'));
do $$ begin assert not exists (select 1 from service.published_rows(test.id('jobOther')) where id = test.id('listing1')), 'failed content is not shipped by the next publish'; end $$;
select service.set_job_state(test.id('jobOther'), 'gating'); select service.set_job_state(test.id('jobOther'), 'deploying'); select service.set_job_state(test.id('jobOther'), 'done');
do $$ begin assert (select published_version from content_rows where id = test.id('listing1')) is null, 'listing1 still not live after the other publish'; end $$;
-- illegal state jumps are refused; every state is an event
select test.expect_error(format($q$select service.set_job_state(%L, 'done')$q$, test.id('job1')), 'S-JOB-STATE');
do $$ begin assert (select count(*) from publish_job_events where job_id = test.id('jobOther')) = 5, 'queued, building, gating, deploying, done recorded'; end $$;
reset role;

-- ===== T13 publish pins the validated version =====
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a2');
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('listing2'), jsonb_build_object('street', '2 Demo Rd unvalidated', 'agent', test.id('team2')));
insert into test.ids select 'jobPin', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('listing2')], array[1]);
select test.expect_error(format($q$select test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[%L::uuid], array[99])$q$, test.id('listing2')), 'S-NOT-FOUND');
reset role;
do $$ begin assert (select requested ->> test.id('listing2')::text from publish_jobs where id = test.id('jobPin')) = '1', 'job records the validated version, not the latest'; end $$;
set role service_role;
select service.set_job_state(test.id('jobPin'), 'failed', '{"reason":"test"}', null, 'gate failed: test');
do $$ begin assert (select error from publish_jobs where id = test.id('jobPin')) = 'gate failed: test', 'job error recorded (N13)'; end $$;
reset role;

-- ===== T11 two publishes queued for one site: the second build must include what the first made live =====
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
insert into test.ids select 'jobA', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('listing1')]);
select test.act_as('00000000-0000-0000-0000-0000000000a2');
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('listing2'), jsonb_build_object('street', '2 Demo Rd v2', 'agent', test.id('team2')));
insert into test.ids select 'jobB', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('listing2')]);
reset role;
set role service_role;
select service.freeze_snapshot(test.id('jobA'));
select service.set_job_state(test.id('jobA'), 'gating'); select service.set_job_state(test.id('jobA'), 'deploying'); select service.set_job_state(test.id('jobA'), 'done');
select service.freeze_snapshot(test.id('jobB'));
do $$ begin
  assert exists (select 1 from service.published_rows(test.id('jobB')) where id = test.id('listing1') and version = 1), 'second build keeps what the first made live';
  assert (select data ->> 'street' from service.published_rows(test.id('jobB')) where id = test.id('listing2')) = '2 Demo Rd v2', 'second build ships its own row';
end $$;
reset role;
-- a rerun of job A after more edits still ships job A's frozen snapshot
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('listing1'), jsonb_build_object('street', '1 Demo Road v2', 'agent', test.id('team1')));
reset role;
set role service_role;
select service.freeze_snapshot(test.id('jobA'));   -- what a rerun of export-published does
do $$ begin
  assert (select data ->> 'street' from service.published_rows(test.id('jobA')) where id = test.id('listing1')) = '1 Demo Rd', 'rerun ships the frozen snapshot';
  assert (select count(*) from service.published_rows(test.id('jobA')) p join content_rows r on r.id = p.id where r.workspace_id <> 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'export holds only A rows';
end $$;
-- stale jobs are reaped after 30 minutes
-- a queued job waiting 2 hours behind others is not stale (queued jobs get 24 hours)
reset role;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
insert into test.ids select 'jobQ', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('listing1')]);
reset role;
set role service_role;
update publish_job_events set at = now() - interval '2 hours' where job_id = test.id('jobQ');
-- jobB has been waiting long since creation but changed state recently: not stale
update publish_jobs set created_at = now() - interval '3 hours' where id = test.id('jobB');
do $$ begin assert service.reap_stale_jobs() = 0, 'a job that changed state recently is not reaped (N2)'; end $$;
-- now its last state change is 31 minutes old: reaped
update publish_job_events set at = now() - interval '31 minutes' where job_id = test.id('jobB');
do $$ declare n int; begin
  n := service.reap_stale_jobs();                     -- run first, then look (one expression has no guaranteed order)
  assert n = 1, 'the reaper failed exactly one stale job';
  assert (select state from publish_jobs where id = test.id('jobB')) = 'failed', 'stale job failed by the reaper';
end $$;
-- its deploy lands after all: done reconciles a reaped job, and the rows go live
select service.set_job_state(test.id('jobB'), 'done', '{}', 'dep-late');
do $$ begin assert (select published_version from content_rows where id = test.id('listing2'))
  = (select (requested ->> test.id('listing2')::text)::int from publish_jobs where id = test.id('jobB')), 'done after reap reconciles (N2)'; end $$;
-- but a job that failed for a real reason cannot be turned into done
select test.expect_error(format($q$select service.set_job_state(%L, 'done')$q$, test.id('jobPin')), 'S-JOB-STATE');
-- leads arrive through the site's capture function; the workspace comes from the site
insert into test.ids select 'leadB', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'Lead', 'l@test', null, '{}', 'I agree');
insert into test.ids select 'leadA', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Lead A', 'a@test', null, '{}', 'I agree');
update leads set owner_team_row = test.id('team1') where id = test.id('leadA');
select test.expect_error($q$select service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'Lead', 'l@test', null, '{}', '')$q$, 'consent text required');
-- unpublish: only owners and staff
select test.expect_error(format($q$select service.unpublish('{"sub":"00000000-0000-0000-0000-0000000000a2","aal":"aal1"}', %L)$q$, test.id('listing1')), 'S-NOT-FOUND');
select service.unpublish('{"sub":"00000000-0000-0000-0000-00000000000a","aal":"aal1"}', test.id('listing1'));
do $$ begin assert (select published_version from content_rows where id = test.id('listing1')) is null, 'owner unpublished the listing'; end $$;
reset role;
do $$ begin assert (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('publish_jobs', 'leads')) = 2, 'jobs and leads stream through Realtime'; end $$;

-- ===== T7 leads: per workspace; a member sees and updates only their own, and cannot hand a lead to someone else =====
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from leads) = 1, 'B owner sees only its lead'; end $$;
select test.act_as('00000000-0000-0000-0000-0000000000a2');
do $$ begin assert (select count(*) from leads) = 0, 'agent two sees no lead assigned to agent one'; end $$;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin assert (select count(*) from leads) = 1, 'agent one sees the lead assigned to them'; end $$;
select test.expect_error(format($q$update leads set owner_team_row = %L where id = %L$q$, test.id('team2'), test.id('leadA')), 'permission denied');
reset role;

-- ===== T12 CRM (step C): idempotent capture, assignee by slug, one timeline, lead_update walls, manual leads, api_keys =====
-- a team row with a slug in A, and the SAME slug in B: the lookup must stay inside the lead's workspace
insert into test.ids select 'teamA3', service.seed_version('aaaaaaaa-0000-0000-0000-000000000000', 'team', '{"name":"Agent Three","slug":"agent-three"}', '00000000-0000-0000-0000-00000000005f', 'plan sitemap sha256 abc123');
insert into test.ids select 'teamB1', service.seed_version('bbbbbbbb-0000-0000-0000-000000000000', 'team', '{"name":"Someone B","slug":"agent-three"}', '00000000-0000-0000-0000-00000000005f', 'plan sitemap sha256 abc123');
insert into test.ids select 'leadI', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/sell/', 'Lead I', 'i@test', null, '{"topic":"sell"}', 'I agree',
  'cash-offer', 'Talk to an agent', '{"given":false,"text":"marketing wording"}', '11111111-1111-1111-1111-111111111111', 'agent-three');
do $$ begin
  assert service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/sell/', 'Lead I again', 'i@test', null, '{}', 'I agree',
    null, null, null, '11111111-1111-1111-1111-111111111111', null) = test.id('leadI'), 'a retry with the same key answers the same lead';
  assert (select count(*) from leads where idempotency_key = '11111111-1111-1111-1111-111111111111') = 1, 'a retry stores nothing';
  assert (select owner_team_row from leads where id = test.id('leadI')) = test.id('teamA3'), 'assignee slug resolves to the team row of the same workspace';
  assert (select flow from leads where id = test.id('leadI')) = 'cash-offer', 'flow stored';
  assert (select marketing_consent ->> 'given' from leads where id = test.id('leadI')) = 'false', 'marketing consent stored apart from consent_text';
  assert (select count(*) from lead_events where lead_id = test.id('leadI') and kind = 'received') = 1, 'received event written on capture';
end $$;
insert into test.ids select 'leadBs', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'Lead Bs', 'b@test', null, '{}', 'I agree', null, null, null, null, 'agent-three');
do $$ begin
  assert (select owner_team_row from leads where id = test.id('leadBs')) = test.id('teamB1'), 'the same slug in B resolves to B''s row, never A''s';
  assert (select owner_team_row from leads where id = service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'x', 'x@test', null, '{}', 'I agree', null, null, null, null, 'nobody')) is null, 'an unknown slug is ignored';
end $$;
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'x', 'x@test', null, '{}', 'I agree', 'Bad Flow!')$q$, 'violates check constraint');

set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');     -- agent one: leadA is theirs
select test.lead_update(test.id('leadA'), 'contacted');
do $$ begin
  assert (select status from leads where id = test.id('leadA')) = 'contacted', 'agent one changed the status of their lead';
  assert (select count(*) from lead_events where lead_id = test.id('leadA') and kind = 'status' and detail ->> 'from' = 'new' and detail ->> 'to' = 'contacted') = 1, 'the status change wrote its event';
end $$;
select test.expect_error(format($q$select test.lead_update(%L, null, %L)$q$, test.id('leadA'), test.id('team2')), 'S-OWN-ONLY');
select test.expect_error(format($q$update leads set status = 'spam' where id = %L$q$, test.id('leadA')), 'permission denied');
select test.act_as('00000000-0000-0000-0000-0000000000a2');     -- agent two: not their lead
select test.expect_error(format($q$select test.lead_update(%L, 'closed')$q$, test.id('leadA')), 'S-NOT-FOUND');
do $$ begin assert (select count(*) from lead_events where lead_id = test.id('leadA')) = 0, 'agent two sees no timeline of a lead they cannot see'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000b');     -- B's owner: not a member of A at all (NULL role must count as refused)
do $$ begin assert (select count(*) from lead_events where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'B''s owner sees no timeline of A'; end $$;
select test.expect_error(format($q$select test.lead_update(%L, 'spam')$q$, test.id('leadA')), 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000a');     -- A's owner
select test.lead_update(test.id('leadA'), null, test.id('team2'), 'Called, will visit on Monday');
do $$ begin
  assert (select owner_team_row from leads where id = test.id('leadA')) = test.id('team2'), 'the owner reassigned the lead';
  assert (select count(*) from lead_events where lead_id = test.id('leadA') and kind = 'assigned') = 1, 'the reassignment wrote its event';
  assert (select count(*) from lead_events where lead_id = test.id('leadA') and kind = 'note' and detail ->> 'text' = 'Called, will visit on Monday') = 1, 'the note is in the timeline';
end $$;
select test.expect_error(format($q$select test.lead_update(%L, null, %L)$q$, test.id('leadA'), test.id('teamB1')), 'S-NOT-FOUND');   -- a team row of another workspace
-- a lead entered by hand: a member gives it only to themselves; a non-member of B cannot add one there
select test.act_as('00000000-0000-0000-0000-0000000000a1');
insert into test.ids select 'leadM', test.add_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'Walk-in', 'w@test', null, '{"about":"sell"}', 'The person agreed on the phone to be contacted', test.id('team2'));
do $$ begin
  assert (select owner_team_row from leads where id = test.id('leadM')) = test.id('team1'), 'a member''s manual lead is their own, whatever owner they typed';
  assert (select form from leads where id = test.id('leadM')) = 'manual', 'manual lead form';
  assert (select by from lead_events where lead_id = test.id('leadM') and kind = 'received') = '00000000-0000-0000-0000-0000000000a1', 'received by the member';
end $$;
select test.expect_error($q$select test.add_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'x', 'x@test', null, '{}', 'agreed')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select test.add_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'x', 'x@test', null, '{}', '')$q$, 'consent text required');
reset role;
-- api_keys: owners never see them, staff (aal2) do; a revoked key is dead
insert into api_keys (site_id, kind, label, vault_ref) values ('aaaaaaaa-0000-0000-0000-00000000517e', 'site-signing', 'Demo A live key', 'site-demo-a-key-1');
insert into api_keys (site_id, kind, label, vault_ref, revoked_at) values ('aaaaaaaa-0000-0000-0000-00000000517e', 'site-signing', 'Demo A old key', 'site-demo-a-key-0', now());
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from api_keys) = 0, 'owners never see api keys'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select count(*) from api_keys) = 2, 'staff with MFA see the registry'; end $$;
reset role;
do $$ begin
  assert (select count(*) from service.active_key('site-signing', 'aaaaaaaa-0000-0000-0000-00000000517e')) = 1, 'a revoked key is dead';
  assert (select vault_ref from service.active_key('site-signing', 'aaaaaaaa-0000-0000-0000-00000000517e')) = 'site-demo-a-key-1', 'the live key is the one handed out';
end $$;

-- ===== T13 expansion blocks: add-ons, bookings, messages, webhook inbox, CRM templates =====
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');     -- agent one, member of A
select test.expect_error($q$select test.activate_addon('aaaaaaaa-0000-0000-0000-000000000000', 'concierge')$q$, 'S-NOT-FOUND');   -- members never activate add-ons
select test.act_as('00000000-0000-0000-0000-00000000000b');     -- B's owner cannot touch A
select test.expect_error($q$select test.activate_addon('aaaaaaaa-0000-0000-0000-000000000000', 'concierge')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000a');     -- A's owner
select test.activate_addon('aaaaaaaa-0000-0000-0000-000000000000', 'concierge');
select test.expect_error($q$select test.activate_addon('aaaaaaaa-0000-0000-0000-000000000000', 'concierge')$q$, 'S-ADDON');            -- twice is refused
select test.expect_error($q$select test.set_addon_state('aaaaaaaa-0000-0000-0000-000000000000', 'concierge', 'active')$q$, 'S-ADDON-STATE');   -- paying -> active skips setting-up
select test.set_addon_state('aaaaaaaa-0000-0000-0000-000000000000', 'concierge', 'setting-up');
select test.set_addon_state('aaaaaaaa-0000-0000-0000-000000000000', 'concierge', 'active');
do $$ begin assert (select state from add_ons where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'concierge') = 'active', 'add-on reached active through the legal path'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from add_ons) = 0, 'B''s owner sees no add-on of A'; end $$;

-- bookings: agent one books for themselves with their lead; cannot book for agent two; no double booking; legal state changes
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.lead_update(test.id('leadA'), null, test.id('team1'));             -- give leadA back to agent one for this block
select test.act_as('00000000-0000-0000-0000-0000000000a1');
insert into test.ids select 'bk1', test.book(test.id('leadA'), test.id('team1'), '2026-11-03 10:00+00', '2026-11-03 11:00+00', 'Office');
do $$ begin
  assert (select state from bookings where id = test.id('bk1')) = 'confirmed', 'a manual booking is confirmed at once';
  assert (select count(*) from lead_events where lead_id = test.id('leadA') and kind = 'booked') = 1, 'the booking is on the timeline';
end $$;
select test.expect_error(format($q$select test.book(%L, %L, '2026-11-03 10:30+00', '2026-11-03 11:30+00')$q$, test.id('leadA'), test.id('team1')), 'B-OVERLAP');
select test.expect_error(format($q$select test.book(%L, %L, '2026-11-04 10:00+00', '2026-11-04 11:00+00')$q$, test.id('leadA'), test.id('team2')), 'S-OWN-ONLY');
select test.expect_error(format($q$select test.book(%L, %L, '2026-11-04 11:00+00', '2026-11-04 10:00+00')$q$, test.id('leadA'), test.id('team1')), 'B-TIME');
select test.act_as('00000000-0000-0000-0000-00000000000a');     -- the owner may pick anyone of the workspace, but not a team row of another workspace
select test.expect_error(format($q$select test.book(%L, %L, '2026-11-04 10:00+00', '2026-11-04 11:00+00')$q$, test.id('leadA'), test.id('teamB1')), 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');     -- B's owner is nobody in A
select test.expect_error(format($q$select test.book(%L, %L, '2026-11-06 10:00+00', '2026-11-06 11:00+00')$q$, test.id('leadA'), test.id('team1')), 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-0000000000a2');
do $$ begin assert (select count(*) from bookings) = 0, 'agent two sees no meeting of agent one'; end $$;
select test.expect_error(format($q$select test.set_booking_state(%L, 'held')$q$, test.id('bk1')), 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error(format($q$select test.set_booking_state(%L, 'proposed')$q$, test.id('bk1')), 'B-STATE');
select test.set_booking_state(test.id('bk1'), 'held');
do $$ begin assert (select count(*) from lead_events where lead_id = test.id('leadA') and kind = 'booking-changed' and detail ->> 'to' = 'held') = 1, 'the booking change is on the timeline'; end $$;
-- after 'held' the slot is free again
insert into test.ids select 'bk2', test.book(test.id('leadA'), test.id('team1'), '2026-11-03 10:30+00', '2026-11-03 11:30+00');
reset role;
-- the concierge books without a login (service caller): proposed, then confirmed by the owner
insert into test.ids select 'bk3', service.book(null, test.id('leadA'), test.id('team1'), '2026-11-05 10:00+00', '2026-11-05 10:30+00', 'Phone', 'concierge');
do $$ begin assert (select state from bookings where id = test.id('bk3')) = 'proposed', 'a concierge booking waits for confirmation'; end $$;

-- messages: SMS needs consent that covers texting; quiet hours block; the daily cap blocks; the provider's answer lands on the timeline
do $$ declare r record; begin
  select * into r from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', test.id('leadA'), null, 'email', 'booking-confirmed', 'a@test', test.id('bk1'), '2026-11-02 18:00+00');
  assert r.state = 'queued', 'an email in the day is queued';
end $$;
-- leadI's consent text is "I agree": it does not cover texting
select test.expect_error(format($q$select * from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', %L, null, 'sms', 'booking-reminder', '+15555550100', null, '2026-11-02 18:00+00')$q$, test.id('leadI')), 'M-CONSENT');
insert into test.ids select 'leadS', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Lead S', 's@test', '+15555550101', '{}', 'I agree to be contacted by email, phone or text');
do $$ declare r record; begin
  select * into r from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', test.id('leadS'), null, 'sms', 'booking-reminder', '+15555550101', null, '2026-11-02 18:00+00');   -- 10:00 Los Angeles
  assert r.state = 'queued', 'an SMS in the day with texting consent is queued';
  select * into r from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', test.id('leadS'), null, 'sms', 'booking-reminder', '+15555550101', null, '2026-11-03 06:00+00');   -- 22:00 Los Angeles
  assert r.state = 'blocked' and r.reason = 'quiet hours', 'an SMS at 22:00 local is blocked by quiet hours';
end $$;
update platform_limits set value = 1 where key = 'email_per_day';     -- one is already queued today
do $$ declare r record; begin
  select * into r from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', null, '00000000-0000-0000-0000-00000000000a', 'email', 'new-lead', 'owner-a@test', null, '2026-11-02 19:00+00');
  assert r.state = 'blocked' and r.reason = 'daily cap', 'the daily email cap blocks the next email';
end $$;
update platform_limits set value = 95 where key = 'email_per_day';
do $$ declare mid uuid; begin
  select id into mid from messages where template = 'booking-confirmed' limit 1;
  perform service.set_message_state(mid, 'sent', 'provider-1');
  assert (select count(*) from lead_events where lead_id = test.id('leadA') and kind = 'message-sent') = 1, 'a sent message is on the timeline';
end $$;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a2');
do $$ begin assert (select count(*) from messages) = 0, 'agent two sees no message about leads that are not theirs'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from messages) >= 3, 'the owner sees the workspace''s messages'; assert (select count(*) from platform_limits) = 0, 'owners do not see platform limits'; end $$;
select test.expect_error($q$update messages set state = 'sent'$q$, 'permission denied');
reset role;

-- webhook inbox: the workspace comes from the connector; the same provider event twice stores one row; a revoked connector is refused
insert into api_keys (workspace_id, kind, label, vault_ref) values ('aaaaaaaa-0000-0000-0000-000000000000', 'omnisuite', 'Demo A OmniSuite', 'demo-a-omnisuite');
insert into connectors (id, workspace_id, kind, label, api_key_id) select 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'omnisuite', 'OmniSuite', id from api_keys where label = 'Demo A OmniSuite';
insert into connectors (id, workspace_id, kind, label, state) values ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000000', 'sms', 'Old number', 'revoked');
select test.expect_error($q$insert into connectors (workspace_id, kind, label, config) values ('aaaaaaaa-0000-0000-0000-000000000000', 'sms', 'x', '{"token":"abc"}')$q$, 'connectors_no_secret_in_config');
do $$ declare e1 bigint; e2 bigint; begin
  e1 := service.webhook_received('cccccccc-0000-0000-0000-000000000001', 'call.result', 'evt-1', '{"workspace_id":"bbbbbbbb-0000-0000-0000-000000000000","outcome":"booked"}');
  e2 := service.webhook_received('cccccccc-0000-0000-0000-000000000001', 'call.result', 'evt-1', '{}');
  assert e1 = e2, 'the same provider event twice answers the same row';
  assert (select count(*) from webhook_events where provider_event_id = 'evt-1') = 1, 'the same provider event twice stores one row';
  assert (select workspace_id from webhook_events where id = e1) = 'aaaaaaaa-0000-0000-0000-000000000000', 'the workspace comes from the connector, not the payload';
  assert (select state from connectors where id = 'cccccccc-0000-0000-0000-000000000001') = 'ok', 'a first callback marks the connector ok';
end $$;
select test.expect_error($q$select service.webhook_received('cccccccc-0000-0000-0000-000000000002', 'x', 'evt-9', '{}')$q$, 'S-NOT-FOUND');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from webhook_events) = 0, 'owners never read the webhook inbox'; assert (select count(*) from connectors) = 1, 'the owner sees only their connectors'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select count(*) from webhook_events) = 1, 'staff read the webhook inbox'; end $$;

-- CRM templates: owner saves, member cannot, shape is checked, B cannot read A's
select test.act_as('00000000-0000-0000-0000-00000000000a');
insert into test.ids select 'tpl1', test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'My CRM', '[{"header":"First Name","field":"name.first"},{"header":"Phone","field":"phone"}]');
select test.expect_error($q$select test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'Bad', '[{"header":"Phone"},{"header":"Email","field":"email"}]')$q$, 'T-COLUMNS');
select test.expect_error($q$select test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'Dup', '[{"header":"Phone","field":"phone"},{"header":"Phone","field":"email"}]')$q$, 'T-COLUMNS');
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$select test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'Mine', '[{"header":"Phone","field":"phone"}]')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from crm_templates) = 0, 'B''s owner sees no template of A'; end $$;
select test.expect_error(format($q$select test.save_crm_template('bbbbbbbb-0000-0000-0000-000000000000', %L, 'Stolen', '[{"header":"Phone","field":"phone"}]')$q$, test.id('tpl1')), 'S-NOT-FOUND');
reset role;

-- ===== T9 anonymous callers (Supabase grants EXECUTE and table rights to anon by default): everything is closed =====
set role anon;
select test.act_as(null);
select test.expect_error($q$select * from private.save_version('aaaaaaaa-0000-0000-0000-000000000000','listings',null,'{"street":"x"}')$q$, 'permission denied');
select test.expect_error($q$select * from service.published_rows('00000000-0000-0000-0000-000000000000')$q$, 'permission denied');
select test.expect_error($q$select service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'x', 'x@test', null, '{}', 'I agree')$q$, 'permission denied');
select test.expect_error($q$insert into leads (workspace_id, form, page_path, consent_text) values ('aaaaaaaa-0000-0000-0000-000000000000','f','/','c')$q$, 'permission denied');
select test.expect_error($q$select service.lead_update('{"sub":"00000000-0000-0000-0000-00000000000a"}'::jsonb, '00000000-0000-0000-0000-000000000000', 'spam')$q$, 'permission denied');
select test.expect_error($q$select service.add_lead('{"sub":"00000000-0000-0000-0000-00000000000a"}'::jsonb, 'aaaaaaaa-0000-0000-0000-00000000517e', 'x', 'x@test', null, '{}', 'c')$q$, 'permission denied');
select test.expect_error($q$insert into lead_events (lead_id, workspace_id, kind) values ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'note')$q$, 'permission denied');
select test.expect_error($q$select count(*) from api_keys$q$, 'permission denied');
select test.expect_error($q$select service.book(null, '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', now(), now() + interval '1 hour', null)$q$, 'permission denied');
select test.expect_error($q$select * from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', null, null, 'email', 'x', 'x@test')$q$, 'permission denied');
select test.expect_error($q$select count(*) from bookings$q$, 'permission denied');
select test.expect_error($q$select count(*) from webhook_events$q$, 'permission denied');
select test.expect_error($q$select count(*) from content_rows$q$, 'permission denied');
reset role;

select 'ALL TENANCY TESTS PASSED' as result;
rollback;
