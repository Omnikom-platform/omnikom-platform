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
create function test.lead_update(p_lead uuid, p_status lead_status default null, p_owner uuid default null, p_note text default null, p_unassign boolean default false)
returns void language sql security definer as $$ select service.lead_update(test.claims(), p_lead, p_status, p_owner, p_note, p_unassign) $$;
create function test.add_lead(p_site uuid, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text, p_owner uuid default null)
returns uuid language sql security definer as $$ select service.add_lead(test.claims(), p_site, p_name, p_email, p_phone, p_answers, p_consent, 'manual', p_owner) $$;
-- step C expansion blocks (migration 3): what the add-on, booking and template Edge Functions do after verifying the user's JWT
create function test.book(p_lead uuid, p_with uuid, p_starts timestamptz, p_ends timestamptz, p_where text default null, p_source booking_source default 'manual')
returns uuid language sql security definer as $$ select service.book(test.claims(), p_lead, p_with, p_starts, p_ends, p_where, p_source) $$;
create function test.set_booking_state(p_booking uuid, p_state booking_state) returns void language sql security definer as $$ select service.set_booking_state(test.claims(), p_booking, p_state) $$;
create function test.activate_addon(p_ws uuid, p_kind addon_kind) returns void language sql security definer as $$ select service.activate_addon(test.claims(), p_ws, p_kind) $$;
create function test.set_addon_state(p_ws uuid, p_kind addon_kind, p_state addon_state) returns void language sql security definer as $$ select service.set_addon_state(test.claims(), p_ws, p_kind, p_state) $$;
create function test.save_crm_template(p_ws uuid, p_id uuid, p_name text, p_columns jsonb) returns uuid language sql security definer as $$ select service.save_crm_template(test.claims(), p_ws, p_id, p_name, 'custom', 'export', p_columns) $$;
-- hardening (migration 4): members through functions, lead deletion
create function test.set_member(p_ws uuid, p_user uuid, p_role member_role, p_team uuid default null) returns void language sql security definer as $$ select service.set_member(test.claims(), p_ws, p_user, p_role, p_team) $$;
create function test.remove_member(p_ws uuid, p_user uuid) returns void language sql security definer as $$ select service.remove_member(test.claims(), p_ws, p_user) $$;
create function test.delete_lead(p_lead uuid) returns void language sql security definer as $$ select service.delete_lead(test.claims(), p_lead) $$;
create function test.unpublish(p_row uuid) returns void language sql security definer as $$ select service.unpublish(test.claims(), p_row, true) $$;
-- step 3 (migration 7): the workspace lifecycle and privacy requests, as the staff admin and dashboard functions will call them
create function test.set_workspace_state(p_ws uuid, p_state workspace_state, p_reason text default null) returns void language sql security definer as $$ select service.set_workspace_state(test.claims(), p_ws, p_state, p_reason) $$;
create function test.open_privacy_request(p_ws uuid, p_kind privacy_request_kind, p_subject text) returns uuid language sql security definer as $$ select service.open_privacy_request(test.claims(), p_ws, p_kind, p_subject) $$;
create function test.set_privacy_request_state(p_req uuid, p_state privacy_request_state) returns void language sql security definer as $$ select service.set_privacy_request_state(test.claims(), p_req, p_state) $$;
grant usage on schema test to anon, authenticated, service_role, omnikom_fn;
grant execute on all functions in schema test to anon, authenticated, service_role, omnikom_fn;

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
grant all on test.ids to anon, authenticated, service_role, omnikom_fn;
create function test.id(k text) returns uuid language sql as $$ select v from test.ids where test.ids.k = id.k $$;
grant execute on function test.id(text) to anon, authenticated, service_role, omnikom_fn;

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
-- N10b: no extension is installed into public (migration 5 revokes anon execute wholesale, so the first assert alone would no
-- longer notice an extension landing in public; staging 2026-10-29 had pg_net there until it was moved to `extensions`)
do $$ begin assert (select count(*) from pg_extension x join pg_namespace n on n.oid = x.extnamespace
  where n.nspname = 'public' and x.extname <> 'plpgsql') = 0, 'no extension installed in public'; end $$;

-- ===== owner A creates a team row and links the agents' logins =====
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
insert into test.ids select 'team2', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'team', null, '{"name":"Agent Two"}');
-- members change only through set_member (review 4): the owner links the agents' logins to their team rows
select test.expect_error($q$update members set team_row_id = null where user_id = '00000000-0000-0000-0000-0000000000a1'$q$, 'permission denied');
select test.set_member('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'member', test.id('team1'));
select test.set_member('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'member', test.id('team2'));
select test.expect_error($q$select test.set_member('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'member', 'bbbbbbbb-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');   -- a team row must be of this workspace
select test.expect_error($q$select test.set_member('aaaaaaaa-0000-0000-0000-000000000000', '99999999-0000-0000-0000-000000000000', 'member')$q$, 'S-NOT-FOUND');   -- an unknown login gets the same answer, no probing
select test.expect_error($q$select test.remove_member('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a')$q$, 'S-LAST-OWNER');
select test.expect_error($q$select test.set_member('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'member')$q$, 'S-LAST-OWNER');
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
-- written the way the production tools write a site key (omnikom key mint, tools/mint-site-key.mjs): site AND its workspace set
-- (found 2026-10-30 on staging: this fixture had no workspace, so a green test hid that the deployed lookup found no real key)
insert into api_keys (site_id, workspace_id, kind, label, key_hash, vault_ref) values ('aaaaaaaa-0000-0000-0000-00000000517e', 'aaaaaaaa-0000-0000-0000-000000000000', 'site-signing', 'Demo A live key', repeat('a', 64), 'site-demo-a-key-1');
insert into api_keys (site_id, workspace_id, kind, label, key_hash, vault_ref, revoked_at) values ('aaaaaaaa-0000-0000-0000-00000000517e', 'aaaaaaaa-0000-0000-0000-000000000000', 'site-signing', 'Demo A old key', repeat('b', 64), 'site-demo-a-key-0', now());
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from api_keys) = 0, 'owners never see api keys'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select count(*) from api_keys) = 2, 'staff with MFA see the registry'; end $$;
reset role;
insert into api_keys (site_id, workspace_id, kind, label, key_hash, vault_ref) values ('bbbbbbbb-0000-0000-0000-00000000517e', 'bbbbbbbb-0000-0000-0000-000000000000', 'site-signing', 'Demo B live key', repeat('c', 64), 'site-demo-b-key-1');
insert into api_keys (site_id, kind, label, key_hash, vault_ref) values ('bbbbbbbb-0000-0000-0000-00000000517e', 'site-signing', 'Demo B key without a workspace', repeat('d', 64), 'site-demo-b-key-0');   -- the shape of a key stored before workspaces were written: still found by its site
do $$ begin
  assert (select count(*) from service.active_key('site-signing', 'aaaaaaaa-0000-0000-0000-00000000517e')) = 1, 'a revoked key is dead; a site key stored with its workspace is found by the site alone (what capture-lead asks)';
  assert (select vault_ref from service.active_key('site-signing', 'aaaaaaaa-0000-0000-0000-00000000517e')) = 'site-demo-a-key-1', 'the live key is the one handed out';
  assert (select array_agg(vault_ref order by vault_ref) from service.active_key('site-signing', 'bbbbbbbb-0000-0000-0000-00000000517e')) = array['site-demo-b-key-0', 'site-demo-b-key-1'], 'another site''s keys are handed out for that site only, with or without a workspace';
  assert (select count(*) from service.active_key('site-signing', 'aaaaaaaa-0000-0000-0000-00000000517e') where vault_ref = 'site-demo-b-key-1') = 0, 'another site''s key never comes back';
  assert (select count(*) from service.active_key('site-signing', 'aaaaaaaa-0000-0000-0000-00000000517e', 'aaaaaaaa-0000-0000-0000-000000000000')) = 1, 'a workspace given narrows the lookup, it does not widen it';
  assert (select count(*) from service.active_key('site-signing', 'aaaaaaaa-0000-0000-0000-00000000517e', 'bbbbbbbb-0000-0000-0000-000000000000')) = 0, 'a site key is not handed out under another workspace';
  assert (select count(*) from service.active_key('site-signing', null)) = 0, 'no site given: platform-wide keys only, never a site key (even one stored without a workspace)';
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
select test.expect_error($q$select test.set_addon_state('aaaaaaaa-0000-0000-0000-000000000000', 'concierge', 'setting-up')$q$, 'S-ROLE');   -- an owner never moves the billing state (review 7)
reset role;
select test.expect_error($q$select service.set_addon_state(null, 'aaaaaaaa-0000-0000-0000-000000000000', 'concierge', 'active')$q$, 'S-ADDON-STATE');   -- paying -> active skips setting-up, even for the payment webhook
select service.set_addon_state(null, 'aaaaaaaa-0000-0000-0000-000000000000', 'concierge', 'setting-up');
select service.set_addon_state(null, 'aaaaaaaa-0000-0000-0000-000000000000', 'concierge', 'active');
do $$ begin assert (select state from add_ons where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'concierge') = 'active', 'add-on reached active through the legal path'; end $$;
set role authenticated;
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
-- texting consent is an explicit flag recorded at capture (review 6: a wording test fails open), never read out of the sentence
insert into test.ids select 'leadS', service.capture_lead(p_site => 'aaaaaaaa-0000-0000-0000-00000000517e', p_form => 'contact', p_page => '/', p_name => 'Lead S', p_email => 's@test', p_phone => '+15555550101', p_answers => '{}', p_consent => 'I agree to be contacted by email, phone or text', p_sms_consent => true);
select test.expect_error(format($q$select * from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', %L, null, 'sms', 'x', '+15555550199')$q$,
  service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Lead N', 'n@test', null, '{}', 'I do NOT agree to text messages, call me')), 'M-CONSENT');
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
insert into test.ids select 'tpl1', test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'My CRM', '[{"header":"First Name","field":"name","transform":"first"},{"header":"Phone","field":"phone"}]');
select test.expect_error($q$select test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'Bad', '[{"header":"Phone"},{"header":"Email","field":"email"}]')$q$, 'T-COLUMNS');
select test.expect_error($q$select test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'Dup', '[{"header":"Phone","field":"phone"},{"header":"Phone","field":"email"}]')$q$, 'T-COLUMNS');
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$select test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'Mine', '[{"header":"Phone","field":"phone"}]')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from crm_templates) = 0, 'B''s owner sees no template of A'; end $$;
select test.expect_error(format($q$select test.save_crm_template('bbbbbbbb-0000-0000-0000-000000000000', %L, 'Stolen', '[{"header":"Phone","field":"phone"}]')$q$, test.id('tpl1')), 'S-NOT-FOUND');
reset role;

-- ===== T15 hardening (migration 4, REVIEW-2026-10-29) =====
-- review 1: unpublish by a non-member is refused; by a member of the workspace too; the owner may
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error(format($q$select test.unpublish(%L)$q$, test.id('listing2')), 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-0000000000a2');
select test.expect_error(format($q$select test.unpublish(%L)$q$, test.id('listing2')), 'S-NOT-FOUND');
reset role;
do $$ begin assert (select deleted_at from content_rows where id = test.id('listing2')) is null, 'nobody but the owner or staff unpublished listing2'; end $$;
-- review 3: a member cannot forge media facts (column-limited insert)
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$insert into media (workspace_id, path, uploaded_by, processed, exif_stripped, width) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000/forged.jpg', '00000000-0000-0000-0000-0000000000a1', true, true,4000)$q$, 'permission denied');
insert into media (workspace_id, path, uploaded_by, rights_confirmed) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000/honest.jpg', '00000000-0000-0000-0000-0000000000a1', true);
do $$ begin assert (select processed from media where path like '%/honest.jpg') = false, 'a client upload starts unprocessed'; end $$;
reset role;
-- review 5: no overlapping builds of one site; a late reconcile never moves a version backwards; a deleted row stays off
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('listing1'), jsonb_build_object('street', '1 Demo Road v3', 'agent', test.id('team1')));
insert into test.ids select 'jobX', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('listing1')]);
insert into test.ids select 'jobY', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('listing1')]);
reset role;
set role service_role;
select service.freeze_snapshot(test.id('jobX'));
select test.expect_error(format($q$select service.freeze_snapshot(%L)$q$, test.id('jobY')), 'S-JOB-BUSY');
select service.set_job_state(test.id('jobX'), 'gating'); select service.set_job_state(test.id('jobX'), 'deploying'); select service.set_job_state(test.id('jobX'), 'done');
select service.freeze_snapshot(test.id('jobY'));   -- now the site is free
do $$ declare live int; begin
  select published_version into live from content_rows where id = test.id('listing1');
  -- jobY carries the same (latest) version; a reconcile of an older snapshot must never lower it
  update publish_jobs set snapshot = jsonb_build_object(test.id('listing1')::text, 1) where id = test.id('jobY');
  perform service.set_job_state(test.id('jobY'), 'gating'); perform service.set_job_state(test.id('jobY'), 'deploying'); perform service.set_job_state(test.id('jobY'), 'done');
  assert (select published_version from content_rows where id = test.id('listing1')) = live, 'published_version never moves backwards';
end $$;
reset role;
-- review 6: messages: STOP, per-workspace cap, idempotent record, legal transitions, no duplicate event
do $$ declare r record; r2 record; begin
  select * into r from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', test.id('leadS'), null, 'sms', 'booking-reminder', '+15555550101', null, '2026-11-02 18:00+00', 'rem-1');
  select * into r2 from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', test.id('leadS'), null, 'sms', 'booking-reminder', '+15555550101', null, '2026-11-02 18:00+00', 'rem-1');
  assert r.id = r2.id, 'the same idempotency key records one message';
  perform service.set_message_state(r.id, 'sent', 'p-1'); perform service.set_message_state(r.id, 'sent', 'p-1');
  assert (select count(*) from lead_events where lead_id = test.id('leadS') and kind = 'message-sent') = 1, 'a repeated sent callback writes one event';
  perform service.set_message_state(r.id, 'delivered');
end $$;
select test.expect_error($q$select service.set_message_state((select id from messages where idem_key = 'rem-1'), 'queued')$q$, 'M-STATE');
select service.lead_sms_stop(test.id('leadS'), '{"reply":"STOP"}');
select test.expect_error(format($q$select * from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', %L, null, 'sms', 'booking-reminder', '+15555550101', null, '2026-11-02 18:00+00', 'rem-2')$q$, test.id('leadS')), 'M-STOP');
update platform_limits set value = 1 where key = 'email_per_day_workspace';
do $$ declare r record; begin
  select * into r from service.record_message('bbbbbbbb-0000-0000-0000-000000000000', null, '00000000-0000-0000-0000-00000000000b', 'email', 'new-lead', 'owner-b@test', null, '2026-11-02 19:30+00');
  assert r.state = 'queued', 'B is not blocked by A''s messages (per-workspace cap)';
  select * into r from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', null, '00000000-0000-0000-0000-00000000000a', 'email', 'new-lead', 'owner-a@test', null, '2026-11-02 19:30+00');
  assert r.state = 'blocked' and r.reason = 'daily cap (workspace)', 'A hit its own daily cap';
end $$;
update platform_limits set value = 40 where key = 'email_per_day_workspace';
-- review 7: an owner cannot move the billing state; the payment webhook (service, null claims) can
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.activate_addon('aaaaaaaa-0000-0000-0000-000000000000', 'messaging');
select test.expect_error($q$select test.set_addon_state('aaaaaaaa-0000-0000-0000-000000000000', 'messaging', 'setting-up')$q$, 'S-ROLE');
reset role;
select service.set_addon_state(null, 'aaaaaaaa-0000-0000-0000-000000000000', 'messaging', 'setting-up');
select service.set_addon_state(null, 'aaaaaaaa-0000-0000-0000-000000000000', 'messaging', 'active', '2026-12-31');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.set_addon_state('aaaaaaaa-0000-0000-0000-000000000000', 'messaging', 'cancelled');
select test.activate_addon('aaaaaaaa-0000-0000-0000-000000000000', 'messaging');
do $$ begin assert (select paid_until from add_ons where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'messaging') is null, 're-activation does not keep the old paid_until'; end $$;
reset role;
-- review 12: a paused site refuses leads; bounded inputs; the member a meeting is with may change its state; null claims only for the concierge
update sites set state = 'paused' where id = 'bbbbbbbb-0000-0000-0000-00000000517e';
select test.expect_error($q$select service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'x', 'x@test', null, '{}', 'I agree')$q$, 'S-SITE-PAUSED');
update sites set state = 'preview' where id = 'bbbbbbbb-0000-0000-0000-00000000517e';
select test.expect_error(format($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', %L, 'x@test', null, '{}', 'I agree')$q$, repeat('x', 121)), 'leads_bounded');
select test.expect_error(format($q$select service.set_booking_state(null, %L, 'cancelled')$q$, test.id('bk3')), 'S-AUTH');
select test.expect_error(format($q$select service.book(null, %L, %L, '2026-11-09 10:00+00', '2026-11-09 11:00+00', null, 'manual')$q$, test.id('leadA'), test.id('team1')), 'S-AUTH');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.lead_update(test.id('leadA'), null, test.id('team2'));      -- leadA now belongs to agent two; bk3 is WITH agent one
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.set_booking_state(test.id('bk3'), 'confirmed');              -- the member the meeting is with may confirm it
do $$ begin assert (select state from bookings where id = test.id('bk3')) = 'confirmed', 'the team member the meeting is with confirmed it'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.lead_update(test.id('leadA'), null, null, null, true);
do $$ begin assert (select owner_team_row from leads where id = test.id('leadA')) is null, 'the owner can unassign a lead'; end $$;
reset role;
-- review 9: lead deletion on request: owner only, audit survives
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error(format($q$select test.delete_lead(%L)$q$, test.id('leadM')), 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.delete_lead(test.id('leadM'));
reset role;
do $$ begin
  assert (select count(*) from leads where id = test.id('leadM')) = 0, 'the lead is gone';
  assert (select count(*) from audit_log where action = 'lead-delete' and target = test.id('leadM')::text) = 1, 'the deletion is in the audit log';
end $$;
-- review 10: template fields are checked; secrets anywhere in a connector config are refused
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.expect_error($q$select test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'Bad2', '[{"header":"X","field":"__proto__"}]')$q$, 'T-COLUMNS');
select test.expect_error($q$select test.save_crm_template('aaaaaaaa-0000-0000-0000-000000000000', null, 'Bad3', '[{"header":"X","field":"workspace_id"}]')$q$, 'T-COLUMNS');
select test.expect_error($q$select service.save_crm_template(test.claims(), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'Bad4', 'custom', 'export', '[{"header":"X","field":"phone"}]', '[]')$q$, 'permission denied');   -- the service schema stays closed to logins
reset role;
select test.expect_error($q$select service.save_crm_template('{"sub":"00000000-0000-0000-0000-00000000000a"}', 'aaaaaaaa-0000-0000-0000-000000000000', null, 'Bad4', 'custom', 'export', '[{"header":"X","field":"phone"}]', '[]')$q$, 'T-VALUE-MAPS');
select test.expect_error($q$insert into connectors (workspace_id, kind, label, config) values ('aaaaaaaa-0000-0000-0000-000000000000', 'sms', 'nested', '{"auth":{"token":"abc"}}')$q$, 'connectors_no_secret_in_config');
select test.expect_error($q$insert into connectors (workspace_id, kind, label, config) values ('aaaaaaaa-0000-0000-0000-000000000000', 'sms', 'url', '{"endpoint":"https://u:p@sms.test/x"}')$q$, 'connectors_no_secret_in_config');
-- review 12: an "own" collection without an ownerField is refused for members
update site_contracts set resolved = jsonb_set(resolved, '{collections,posts}', '{"kind":"collection","access":{"member":"own"},"fields":{"title":{"type":"text"}}}') where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'posts', null, '{"title":"x"}')$q$, 'S-CONTRACT');
reset role;

-- ===== T16 step 3 leftovers (migration 7): append-only audit, security events, consent ledger, suppressions, lifecycle, quotas, privacy requests =====
-- the audit trail is append-only for every role: service_role has no grant, and the trigger refuses the owner too
set role service_role;
select test.expect_error($q$update audit_log set action = 'rewritten' where action = 'lead-delete'$q$, 'permission denied');
select test.expect_error($q$delete from audit_log where action = 'lead-delete'$q$, 'permission denied');
reset role;
select test.expect_error($q$update audit_log set action = 'rewritten' where action = 'lead-delete'$q$, 'A-APPEND-ONLY');
select test.expect_error($q$delete from audit_log where action = 'lead-delete'$q$, 'A-APPEND-ONLY');
select test.expect_error($q$truncate audit_log$q$, 'A-APPEND-ONLY');
-- the trail outlives the tenant: deleting a workspace leaves its audit rows (no cascade)
insert into workspaces (id, slug, name, industry) values ('dddddddd-0000-0000-0000-000000000000', 'test-demo-d', 'Demo D', 'real-estate-agent');
insert into audit_log (workspace_id, action, target) values ('dddddddd-0000-0000-0000-000000000000', 'test-row', 'd');
delete from workspaces where id = 'dddddddd-0000-0000-0000-000000000000';
do $$ begin assert (select count(*) from audit_log where workspace_id = 'dddddddd-0000-0000-0000-000000000000' and action = 'test-row') = 1, 'the audit trail outlives the deleted workspace'; end $$;
-- security events: written by the functions (service role), read by staff only, never rewritten
set role service_role;
do $$ begin assert service.record_security_event('bad-signature', 'SIGNATURE', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', null, repeat('e', 64), '{"path":"/capture-lead"}') > 0, 'a security event is recorded'; end $$;
select test.expect_error($q$update security_events set kind = 'refused'$q$, 'permission denied');
reset role;
select test.expect_error($q$update security_events set kind = 'refused'$q$, 'A-APPEND-ONLY');
select test.expect_error($q$delete from security_events$q$, 'A-APPEND-ONLY');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from security_events) = 0, 'owners never read security events'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select count(*) from security_events where kind = 'bad-signature' and site_id = 'aaaaaaaa-0000-0000-0000-00000000517e') = 1, 'staff with MFA read the security events'; end $$;
reset role;
-- consent ledger: one row per captured lead, with the hash of the wording; a manual lead too; it survives the lead's deletion
insert into test.ids select 'leadC', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/consent/', 'Lead C', 'c@test', '+15555550102', '{}', 'I agree to be contacted by email, phone or text', null, null, '{"given":true,"text":"news too"}', '22222222-2222-2222-2222-222222222222', null, repeat('f', 64), 'UA', true);
do $$ declare c consent_ledger; begin
  select * into c from consent_ledger where lead_id = test.id('leadC');
  assert found, 'capture writes the consent ledger row';
  assert c.consent_hash = encode(sha256(convert_to('I agree to be contacted by email, phone or text', 'utf8')), 'hex'), 'the ledger holds the hash of the exact wording';
  assert c.sms_consent and c.marketing ->> 'given' = 'true' and c.ip_hash = repeat('f', 64) and c.page_path = '/consent/', 'the ledger holds the consent facts (sms, marketing, hashed address, page)';
  assert (select count(*) from consent_ledger where lead_id = test.id('leadM')) = 1, 'a manual lead has its consent row too (added by a member, then deleted: the row stays)';
  assert (select by from consent_ledger where lead_id = test.id('leadM')) = '00000000-0000-0000-0000-0000000000a1', 'the manual consent row names who entered it';
end $$;
select test.expect_error($q$update consent_ledger set consent_text = 'changed'$q$, 'A-APPEND-ONLY');
select test.expect_error($q$delete from consent_ledger$q$, 'A-APPEND-ONLY');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from consent_ledger where lead_id = test.id('leadC')) = 1, 'the owner reads the consent proof of their own leads'; end $$;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin assert (select count(*) from consent_ledger) = 0, 'members do not read the consent ledger'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.delete_lead(test.id('leadC'));
reset role;
do $$ begin assert (select count(*) from consent_ledger where lead_id = test.id('leadC')) = 1, 'the consent record survives the lead''s deletion'; end $$;
-- suppressions: the STOP of leadS (T15) became a suppression by hashed number; it survives the lead and blocks a new lead with the same number
do $$ begin assert (select count(*) from suppressions where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and channel = 'sms' and reason = 'stop' and lead_id = test.id('leadS')) = 1, 'STOP wrote a suppression'; end $$;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.delete_lead(test.id('leadS'));
reset role;
insert into test.ids select 'leadS2', service.capture_lead(p_site => 'aaaaaaaa-0000-0000-0000-00000000517e', p_form => 'contact', p_page => '/', p_name => 'Lead S again', p_email => 's2@test', p_phone => '(555) 555-0101', p_answers => '{}', p_consent => 'I agree to be contacted by email, phone or text', p_sms_consent => true);
select test.expect_error(format($q$select * from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', %L, null, 'sms', 'booking-reminder', '(555) 555-0101', null, '2026-11-02 18:00+00')$q$, test.id('leadS2')), 'M-SUPPRESSED');
-- an email suppression by hand (a complaint), matched however the address is typed; it is the workspace's, so B is not affected; a platform-wide one is
select service.suppress('aaaaaaaa-0000-0000-0000-000000000000', 'email', ' Owner-A@test ', 'complaint', 'dashboard');
select service.suppress('aaaaaaaa-0000-0000-0000-000000000000', 'email', 'owner-a@test', 'complaint', 'dashboard');   -- twice changes nothing
do $$ begin assert (select count(*) from suppressions where channel = 'email' and workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 1, 'the same address twice is one suppression'; end $$;
select test.expect_error($q$select * from service.record_message('aaaaaaaa-0000-0000-0000-000000000000', null, '00000000-0000-0000-0000-00000000000a', 'email', 'new-lead', 'owner-a@test', null, '2026-11-02 19:30+00')$q$, 'M-SUPPRESSED');
do $$ declare r record; begin
  select * into r from service.record_message('bbbbbbbb-0000-0000-0000-000000000000', null, '00000000-0000-0000-0000-00000000000b', 'email', 'new-lead', 'owner-a@test', null, '2026-11-02 19:31+00');
  assert r.state = 'queued', 'a workspace''s suppression does not reach another workspace';
end $$;
select service.suppress(null, 'email', 'blocked-everywhere@test', 'dnc', 'registry');
select test.expect_error($q$select * from service.record_message('bbbbbbbb-0000-0000-0000-000000000000', null, '00000000-0000-0000-0000-00000000000b', 'email', 'new-lead', 'blocked-everywhere@test', null, '2026-11-02 19:32+00')$q$, 'M-SUPPRESSED');
select test.expect_error($q$select service.suppress('aaaaaaaa-0000-0000-0000-000000000000', 'sms', '   ', 'request')$q$, 'M-ADDRESS');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from suppressions where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'B''s owner reads no suppression of A'; end $$;
reset role;
-- workspace lifecycle: staff only (aal2), legal moves only; a suspended workspace takes no leads, publishes nothing, sends nothing
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error($q$select test.set_workspace_state('bbbbbbbb-0000-0000-0000-000000000000', 'suspended')$q$, 'S-NOT-FOUND');   -- an owner never changes the lifecycle
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal1');
select test.expect_error($q$select test.set_workspace_state('bbbbbbbb-0000-0000-0000-000000000000', 'suspended')$q$, 'S-NOT-FOUND');   -- staff without MFA neither
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.expect_error($q$select test.set_workspace_state('bbbbbbbb-0000-0000-0000-000000000000', 'deleted')$q$, 'S-WORKSPACE-STATE');   -- active -> deleted skips offboarding
select test.set_workspace_state('bbbbbbbb-0000-0000-0000-000000000000', 'suspended', 'unpaid invoice (test)');
reset role;
do $$ begin
  assert (select state from workspaces where id = 'bbbbbbbb-0000-0000-0000-000000000000') = 'suspended', 'staff suspended B';
  assert (select count(*) from audit_log where action = 'workspace-suspended' and target = 'bbbbbbbb-0000-0000-0000-000000000000') = 1, 'the suspension is audited';
end $$;
select test.expect_error($q$select service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'x', 'x@test', null, '{}', 'I agree')$q$, 'S-WORKSPACE-SUSPENDED');
do $$ declare r record; begin
  select * into r from service.record_message('bbbbbbbb-0000-0000-0000-000000000000', null, '00000000-0000-0000-0000-00000000000b', 'email', 'new-lead', 'owner-b@test', null, '2026-11-02 19:33+00');
  assert r.state = 'blocked' and r.reason = 'workspace suspended', 'a suspended workspace sends nothing';
end $$;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000b');
insert into test.ids select 'teamB2', row_id from test.save('bbbbbbbb-0000-0000-0000-000000000000', 'team', null, '{"name":"Agent B Two"}');
select test.expect_error(format($q$select test.publish('bbbbbbbb-0000-0000-0000-00000000517e', array[%L::uuid])$q$, test.id('teamB2')), 'S-WORKSPACE-STATE');
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.set_workspace_state('bbbbbbbb-0000-0000-0000-000000000000', 'active', 'paid');
select test.act_as('00000000-0000-0000-0000-00000000000b');
insert into test.ids select 'jobB2', test.publish('bbbbbbbb-0000-0000-0000-00000000517e', array[test.id('teamB2')]);
reset role;
-- per-workspace quotas: a value in workspace_limits overrides the platform-wide one; A's lead quota never touches B
do $$ declare n int; begin
  select count(*) into n from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and created_at > now() - interval '1 hour';
  insert into workspace_limits (workspace_id, key, value, note) values ('aaaaaaaa-0000-0000-0000-000000000000', 'leads_per_hour_workspace', n, 'test: the quota is exactly what A already sent this hour');
  assert private.limit_for('aaaaaaaa-0000-0000-0000-000000000000', 'leads_per_hour_workspace') = n, 'the workspace value overrides the platform value';
  assert private.limit_for('bbbbbbbb-0000-0000-0000-000000000000', 'leads_per_hour_workspace') = 60, 'B keeps the platform value';
end $$;
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'one too many', 'q@test', null, '{}', 'I agree')$q$, 'S-QUOTA');
do $$ begin assert service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/sell/', 'Lead I again', 'i@test', null, '{}', 'I agree', null, null, null, '11111111-1111-1111-1111-111111111111', null) = test.id('leadI'), 'a retry of an earlier submission is answered even at the quota (nothing new is stored)'; end $$;
insert into test.ids select 'leadBq', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'B still fine', 'bq@test', null, '{}', 'I agree');
delete from workspace_limits where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and key = 'leads_per_hour_workspace';
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from workspace_limits) = 0, 'owners do not see workspace limits'; end $$;
reset role;
insert into workspace_limits (workspace_id, key, value, note) values ('aaaaaaaa-0000-0000-0000-000000000000', 'email_per_day_workspace', 500, 'fixture for the isolation loop');
-- privacy requests: owner or staff opens one; it lists the person's leads and carries the 45-day clock; legal moves only
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$select test.open_privacy_request('aaaaaaaa-0000-0000-0000-000000000000', 'access', 'i@test')$q$, 'S-NOT-FOUND');   -- members do not handle privacy requests
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error($q$select test.open_privacy_request('aaaaaaaa-0000-0000-0000-000000000000', 'access', 'i@test')$q$, 'S-NOT-FOUND');   -- B's owner is nobody in A
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.expect_error($q$select test.open_privacy_request('aaaaaaaa-0000-0000-0000-000000000000', 'access', '  ')$q$, 'P-SUBJECT');
insert into test.ids select 'pr1', test.open_privacy_request('aaaaaaaa-0000-0000-0000-000000000000', 'delete', 'I@test');
do $$ declare r privacy_requests; begin
  select * into r from privacy_requests where id = test.id('pr1');
  assert r.state = 'received' and test.id('leadI') = any(r.lead_ids), 'the request lists the person''s leads (matched by email, any case)';
  assert r.due_at between now() + interval '44 days' and now() + interval '46 days', 'the 45-day clock is set';
  assert (select count(*) from privacy_requests) = 1, 'the owner reads the workspace''s requests';
end $$;
select test.expect_error(format($q$select test.set_privacy_request_state(%L, 'done')$q$, test.id('pr1')), 'P-STATE');   -- received -> done skips the work
select test.set_privacy_request_state(test.id('pr1'), 'in-progress');
select test.set_privacy_request_state(test.id('pr1'), 'done');
select test.expect_error(format($q$select test.set_privacy_request_state(%L, 'in-progress')$q$, test.id('pr1')), 'P-STATE');   -- nothing leaves done
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error(format($q$select test.set_privacy_request_state(%L, 'refused')$q$, test.id('pr1')), 'S-NOT-FOUND');
do $$ begin assert (select count(*) from privacy_requests) = 0, 'B''s owner reads no request of A'; end $$;
reset role;
do $$ begin assert (select done_at from privacy_requests where id = test.id('pr1')) is not null and (select count(*) from audit_log where action = 'privacy-request-done' and target = test.id('pr1')::text) = 1, 'closing the request is dated and audited'; end $$;

-- ===== T17 migration 8: default privileges on private and service, the function role; search_path = '' is asserted in T14 =====
create function service.zz_probe() returns int language sql as $$ select 1 $$;
create function private.zz_probe() returns int language sql as $$ select 1 $$;
do $$ begin
  assert not has_function_privilege('anon', 'service.zz_probe()', 'execute') and not has_function_privilege('authenticated', 'service.zz_probe()', 'execute'), 'a new service function is closed to anon and authenticated by default';
  assert not has_function_privilege('anon', 'private.zz_probe()', 'execute') and not has_function_privilege('authenticated', 'private.zz_probe()', 'execute'), 'a new private function is closed to anon and authenticated by default';
  assert has_function_privilege('omnikom_fn', 'service.zz_probe()', 'execute') and has_function_privilege('service_role', 'service.zz_probe()', 'execute'), 'a new service function is open to the function role and service_role by default';
  assert (select count(*) from information_schema.role_table_grants where grantee = 'omnikom_fn' and table_schema <> 'test') = 0, 'the function role has no table grant anywhere (the test schema aside)';
  assert not has_schema_privilege('omnikom_fn', 'private', 'usage'), 'the function role cannot reach the private helpers';
  assert pg_has_role('postgres', 'omnikom_fn', 'member'), 'postgres may step down to the function role';
end $$;
set role omnikom_fn;
select test.expect_error($q$select count(*) from leads$q$, 'permission denied');
select test.expect_error($q$select count(*) from audit_log$q$, 'permission denied');
select test.expect_error($q$select count(*) from api_keys$q$, 'permission denied');
select test.expect_error($q$insert into leads (workspace_id, form, page_path, consent_text) values ('aaaaaaaa-0000-0000-0000-000000000000', 'f', '/', 'c')$q$, 'permission denied');
select test.expect_error($q$select private.is_staff()$q$, 'permission denied');
do $$ begin
  assert (select count(*) from service.active_key('site-signing', 'aaaaaaaa-0000-0000-0000-00000000517e')) = 1, 'the function role reads keys through the service function';
  assert (select count(*) from service.alert_recipients('aaaaaaaa-0000-0000-0000-00000000517e')) = 1, 'the function role reads the alert recipients through the service function';
  assert service.lead_alerted(test.id('leadI')) = false, 'the function role asks whether a lead was alerted through the service function';
  assert service.record_security_event('refused', 'S-NOT-FOUND', 'aaaaaaaa-0000-0000-0000-000000000000') > 0, 'the function role records security events';
end $$;
reset role;

-- ===== T14 structural gates (23-GROUND-RULES section 3): read from the catalogues, so a new table or function cannot skip them =====
do $$ declare t record; n int; begin
  -- every public table has RLS and a select policy naming authenticated
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || quote_ident(t.relname))::regclass), 'RLS off on ' || t.relname;
    assert exists (select 1 from pg_policy p where p.polrelid = ('public.' || quote_ident(t.relname))::regclass and p.polcmd in ('r', '*') and 'authenticated' = any(select rolname from pg_roles where oid = any(p.polroles))),
      'no select policy for authenticated on ' || t.relname;
  end loop;
  -- every table with workspace_id (and more than one row per workspace) has an index starting with workspace_id
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
           where s.nspname = 'public' and c.relkind = 'r' and c.relname not in ('workspaces') loop
    assert exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                   where i.indrelid = ('public.' || quote_ident(t.relname))::regclass and a.attname = 'workspace_id'), 'no workspace_id-first index on ' || t.relname;
  end loop;
  -- every SECURITY DEFINER function sets search_path; no definer function has an un-guarded "if not (" authorisation test
  for t in select n.nspname, p.proname, p.prosrc, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('private', 'service') and p.prosecdef loop
    assert t.proconfig is not null and array_to_string(t.proconfig, ',') = 'search_path=""', 'search_path is not pinned to the empty path on ' || t.nspname || '.' || t.proname || ' (migration 8: set search_path = '''' and schema-qualified names)';
    assert t.prosrc !~ 'if not \((staff|private\.is_staff\(\)|role)', 'un-guarded "if not (" authorisation in ' || t.nspname || '.' || t.proname || ' (use coalesce or is_owner_or_staff)';
  end loop;
  -- anon has no table privilege; authenticated writes nothing except the allowlist
  select count(*) into n from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public';
  assert n = 0, 'anon has table grants: ' || n;
  select count(*) into n from information_schema.role_table_grants g where g.grantee = 'authenticated' and g.table_schema = 'public' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    and not (g.table_name = 'media' and g.privilege_type = 'INSERT');
  assert n = 0, 'authenticated has write grants beyond the allowlist: ' || n;
  -- every service function that takes claims is covered by an outsider test (the list below is the contract; a new function must be added here with its test)
  for t in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'service' and p.proargnames[1] = 'p_claims' loop
    assert t.proname = any(array['use_claims', 'contract_for', 'save_as', 'start_publish', 'unpublish', 'lead_update', 'add_lead', 'activate_addon', 'set_addon_state', 'book', 'set_booking_state', 'save_crm_template', 'set_member', 'remove_member', 'delete_lead',
      'set_workspace_state', 'open_privacy_request', 'set_privacy_request_state']),
      'service.' || t.proname || ' takes claims but has no outsider test listed in T14';
  end loop;
end $$;
-- read isolation per table, generated: B's owner and a no-membership login read 0 rows of A from every table that has workspace_id
-- (every such table holds at least one row of A first, so a policy opened to "true" is seen)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'nobody@test');
insert into integrations (workspace_id, kind, config) values ('aaaaaaaa-0000-0000-0000-000000000000', 'idx-link', '{"url":"https://idx.test"}');
insert into metrics_snapshots (workspace_id, source, day, data) values ('aaaaaaaa-0000-0000-0000-000000000000', 'uptime', '2026-11-01', '{"up":true}');
do $$ declare t record; n int; begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
           where s.nspname = 'public' and c.relkind = 'r' loop
    execute format('select count(*) from public.%I where workspace_id = %L', t.relname, 'aaaaaaaa-0000-0000-0000-000000000000') into n;
    assert n > 0, 'the isolation loop needs a row of A in ' || t.relname || ' (add a fixture)';
  end loop;
end $$;
set role authenticated;
do $$ declare t record; n int; who text; begin
  foreach who in array array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000e'] loop
    perform test.act_as(who);
    for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
             where s.nspname = 'public' and c.relkind = 'r' loop
      execute format('select count(*) from public.%I where workspace_id = %L', t.relname, 'aaaaaaaa-0000-0000-0000-000000000000') into n;
      assert n = 0, who || ' reads ' || n || ' row(s) of A from ' || t.relname;
    end loop;
    execute 'select count(*) from publish_job_events' into n; assert n = 0 or who = '00000000-0000-0000-0000-00000000000b', 'nobody reads job events';
    execute 'select count(*) from platform_limits' into n; assert n = 0, who || ' reads platform limits';
    execute 'select count(*) from staff' into n; assert n = 0, who || ' reads the staff table';
  end loop;
end $$;
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
select test.expect_error($q$select service.record_security_event('refused', 'S-NOT-FOUND')$q$, 'permission denied');
select test.expect_error($q$select count(*) from security_events$q$, 'permission denied');
select test.expect_error($q$select count(*) from consent_ledger$q$, 'permission denied');
select test.expect_error($q$select service.suppress(null, 'email', 'x@test', 'dnc')$q$, 'permission denied');
select test.expect_error($q$select * from service.site_signing_secrets('aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'permission denied');
reset role;

select 'ALL TENANCY TESTS PASSED' as result;
rollback;
