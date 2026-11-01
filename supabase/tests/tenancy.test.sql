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
  "team":{"kind":"collection","access":{"member":"own"},"ownerField":"self","fields":{"name":{"type":"text","required":true},"licence":{"type":"group","locked":{"reason":"fact"}}}},
  "listings":{"kind":"collection","access":{"member":"own"},"ownerField":"agent","fields":{"street":{"type":"text","required":true},"status":{"type":"enum","options":["for-sale","sold"],"required":true},"agent":{"type":"reference","to":"team"}}},
  "pages":{"kind":"collection","access":{"member":"none"},"fields":{"type":{"type":"text","required":true},"title":{"type":"text","required":true},"seo":{"type":"seo","required":true},
    "contact":{"type":"group","of":{"phone":{"type":"text","required":true},"hours":{"type":"text"}}},"rooms":{"type":"list","of":{"name":{"type":"text","required":true}}},
    "free":{"type":"group","open":true,"of":{"x":{"type":"text","required":true}}},"fact":{"type":"group","sourced":true,"of":{"n":{"type":"text","required":true}}},"sections":{"type":"sections"}}},
  "settings":{"kind":"singleton","access":{"member":"none"},"fields":{"businessName":{"type":"text"},"licences":{"type":"list","locked":{"reason":"fact"}}}},
  "leads":{"kind":"inbox","access":{"member":"own"},"ownerField":"owner","fields":{"status":{"type":"enum"}}}},
  "pageTypes":{"home":{"sections":[{"id":"hero","kind":"fields","fields":{"headline":{"type":"text","required":true}}},{"id":"extras","kind":"fields","fields":{"note":{"type":"text"}}},{"id":"feed","kind":"feed","accepts":"listings"}]}}}'::jsonb, true
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
insert into test.ids select 'listing1', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"1 Demo Rd","status":"for-sale"}');
do $$ begin assert (select owner_team_row from content_rows where id = test.id('listing1')) = test.id('team1'), 'owner field set from the login'; end $$;
select test.expect_error($q$select test.save('aaaaaaaa-0000-0000-0000-000000000000','settings',null,'{"businessName":"X"}')$q$, 'S-ROLE');
select test.act_as('00000000-0000-0000-0000-0000000000a2');
insert into test.ids select 'listing2', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"2 Demo Rd","status":"for-sale"}');
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
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('listing2'), jsonb_build_object('street', '2 Demo Rd unvalidated', 'status', 'for-sale', 'agent', test.id('team2')));
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
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('listing2'), jsonb_build_object('street', '2 Demo Rd v2', 'status', 'for-sale', 'agent', test.id('team2')));
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
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('listing1'), jsonb_build_object('street', '1 Demo Road v2', 'status', 'for-sale', 'agent', test.id('team1')));
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
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('listing1'), jsonb_build_object('street', '1 Demo Road v3', 'status', 'for-sale', 'agent', test.id('team1')));
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
-- an earlier run's event for the same site (security_events is append-only, so staging always holds some)
do $$ begin assert service.record_security_event('bad-signature', 'SIGNATURE', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', null, repeat('d', 64), '{"path":"/capture-lead","earlier":true}') > 0, 'an earlier event is recorded'; end $$;
-- this run's event: its id is kept, and the staff read below is scoped to it (a count of the site's events grows on staging)
select set_config('test.sec_event', service.record_security_event('bad-signature', 'SIGNATURE', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', null, repeat('e', 64), '{"path":"/capture-lead"}')::text, false) is not null as recorded;
do $$ begin assert coalesce(current_setting('test.sec_event', true), '') ~ '^[1-9][0-9]*$', 'a security event is recorded'; end $$;
select test.expect_error($q$update security_events set kind = 'refused'$q$, 'permission denied');
reset role;
select test.expect_error($q$update security_events set kind = 'refused'$q$, 'A-APPEND-ONLY');
select test.expect_error($q$delete from security_events$q$, 'A-APPEND-ONLY');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from security_events) = 0, 'owners never read security events'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select count(*) from security_events where id = current_setting('test.sec_event')::bigint and kind = 'bad-signature' and site_id = 'aaaaaaaa-0000-0000-0000-00000000517e') = 1, 'staff with MFA read the security events'; end $$;
do $$ begin assert (select count(*) from security_events where kind = 'bad-signature' and site_id = 'aaaaaaaa-0000-0000-0000-00000000517e') >= 2, 'staff read the earlier events too'; end $$;
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

-- ===== T18 migration 9: media and export (slice 4.2): the service functions the dashboard and runner Edge Functions call =====
-- (placed before T17 on purpose: a grant mutant of migration 9 must be seen here, on its own function, before T17 trips on the default privileges)
-- Written before the migration (watched red: every call below failed with "function service.record_media ... does not exist"), then
-- the migration made it pass. The Edge Functions call these as the role omnikom_fn, so the block runs as that role.
create function test.cl(p_sub text, p_aal text default 'aal1') returns jsonb language sql as $$ select jsonb_build_object('sub', p_sub, 'aal', p_aal, 'role', 'authenticated') $$;
grant execute on function test.cl(text, text) to anon, authenticated, service_role, omnikom_fn;
create table test.counts (k text primary key, v int);
grant all on test.counts to anon, authenticated, service_role, omnikom_fn;
insert into media (workspace_id, path, uploaded_by) values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000/b-only.jpg', '00000000-0000-0000-0000-00000000000b');
insert into test.ids select 'mediaB', id from media where path = 'bbbbbbbb-0000-0000-0000-000000000000/b-only.jpg';
set role omnikom_fn;
-- record_media: a member or staff of the workspace, an allowed type, a size in range; the path is under the workspace
insert into test.ids select 'mediaOwner', id from service.record_media(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'front.jpg', 2000000, 'image/jpeg');
insert into test.ids select 'mediaA1', id from service.record_media(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', 'a1.png', 1000, 'image/png');
insert into test.ids select 'mediaStaff', id from service.record_media(test.cl('00000000-0000-0000-0000-00000000005f', 'aal2'), 'aaaaaaaa-0000-0000-0000-000000000000', 'staff.pdf', 5000, 'application/pdf');
select test.expect_error($q$select * from service.record_media(test.cl('00000000-0000-0000-0000-00000000000e'), 'aaaaaaaa-0000-0000-0000-000000000000', 'x.jpg', 1000, 'image/jpeg')$q$, 'S-NOT-FOUND');   -- a login of nothing
select test.expect_error($q$select * from service.record_media(test.cl('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000', 'x.jpg', 1000, 'image/jpeg')$q$, 'S-NOT-FOUND');   -- B's owner into A
select test.expect_error($q$select * from service.record_media(test.cl('00000000-0000-0000-0000-00000000005f'), 'aaaaaaaa-0000-0000-0000-000000000000', 'x.jpg', 1000, 'image/jpeg')$q$, 'S-NOT-FOUND');   -- staff without MFA
select test.expect_error($q$select * from service.record_media(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'x.gif', 1000, 'image/gif')$q$, 'I-MEDIA-TYPE');
select test.expect_error($q$select * from service.record_media(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'x.jpg', 0, 'image/jpeg')$q$, 'I-MEDIA-SIZE');
select test.expect_error($q$select * from service.record_media(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'x.jpg', 26214401, 'image/jpeg')$q$, 'I-MEDIA-SIZE');
select * from service.record_media(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'edge.jpg', 26214400, 'image/webp');   -- the cap itself is allowed
select test.expect_error($q$select * from service.record_media(null, 'aaaaaaaa-0000-0000-0000-000000000000', 'x.jpg', 1000, 'image/jpeg')$q$, 'S-AUTH');
reset role;
do $$ begin
  assert (select path from media where id = test.id('mediaOwner')) ~ '^aaaaaaaa-0000-0000-0000-000000000000/[0-9a-f-]{36}\.jpg$', 'the path is <workspace>/<uuid>.<ext> (jpeg -> jpg)';
  assert (select path from media where id = test.id('mediaA1')) like '%.png' and (select path from media where id = test.id('mediaStaff')) like '%.pdf', 'the extension follows the type';
  assert (select uploaded_by from media where id = test.id('mediaOwner')) = '00000000-0000-0000-0000-00000000000a', 'uploaded_by is the login from the claims';
  assert (select not processed and not exif_stripped and not rights_confirmed and width is null from media where id = test.id('mediaOwner')), 'a new record is unprocessed, unstripped, rights not confirmed, width unknown';
  assert (select count(*) from audit_log where action = 'media-start' and workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 4, 'every recorded upload is audited (media-start)';
  assert (select count(*) from media where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and path like '%/x.%') = 0, 'a refused upload left no row';
end $$;
-- finish_media: the uploader, an owner or staff of the workspace; the rights tick only; never the processor's facts
set role omnikom_fn;
select service.finish_media(test.cl('00000000-0000-0000-0000-0000000000a1'), test.id('mediaA1'), true);                 -- the uploader (a member)
select service.finish_media(test.cl('00000000-0000-0000-0000-00000000000a'), test.id('mediaOwner'), true);             -- the owner, the uploader
select test.expect_error(format($q$select service.finish_media(test.cl('00000000-0000-0000-0000-0000000000a2'), %L, true)$q$, test.id('mediaA1')), 'S-NOT-FOUND');   -- another member of A is not the uploader
select test.expect_error(format($q$select service.finish_media(test.cl('00000000-0000-0000-0000-00000000000b'), %L, true)$q$, test.id('mediaA1')), 'S-NOT-FOUND');   -- B's owner
select test.expect_error(format($q$select service.finish_media(test.cl('00000000-0000-0000-0000-00000000000e'), %L, true)$q$, test.id('mediaA1')), 'S-NOT-FOUND');   -- nobody
select test.expect_error($q$select service.finish_media(test.cl('00000000-0000-0000-0000-00000000000a'), '99999999-0000-0000-0000-000000000000', true)$q$, 'S-NOT-FOUND');   -- unknown id
select test.expect_error($q$select service.finish_media(test.cl('00000000-0000-0000-0000-00000000005f', 'aal2'), '99999999-0000-0000-0000-000000000000', true)$q$, 'S-NOT-FOUND');   -- staff on an unknown id (staff pass the role test, so this needs its own wall)
select service.finish_media(test.cl('00000000-0000-0000-0000-00000000000a'), test.id('mediaA1'), false);              -- the owner may take the tick back
reset role;
do $$ begin assert not (select rights_confirmed from media where id = test.id('mediaA1')), 'the owner took the rights tick back'; end $$;
set role omnikom_fn;
select service.finish_media(test.cl('00000000-0000-0000-0000-00000000000a'), test.id('mediaA1'), true);
reset role;
do $$ begin
  assert (select rights_confirmed from media where id = test.id('mediaOwner')) and (select rights_confirmed from media where id = test.id('mediaA1')), 'finish sets the rights tick';
  assert not (select rights_confirmed from media where id = test.id('mediaStaff')), 'a media nobody finished stays unticked';
  assert (select not processed and not exif_stripped and width is null from media where id = test.id('mediaOwner')), 'finish never touches width, processed or exif_stripped (ground rule 11)';
  assert (select count(*) from audit_log where action = 'media-finish') = 4, 'every finish is audited (media-finish)';
end $$;
-- an uploader who has left the workspace can no longer finish their upload
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'ex-member@test');
insert into members (workspace_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1', 'member');
set role omnikom_fn;
insert into test.ids select 'mediaEx', id from service.record_media(test.cl('00000000-0000-0000-0000-0000000000e1'), 'aaaaaaaa-0000-0000-0000-000000000000', 'ex.jpg', 1000, 'image/jpeg');
reset role;
delete from members where user_id = '00000000-0000-0000-0000-0000000000e1';
set role omnikom_fn;
select test.expect_error(format($q$select service.finish_media(test.cl('00000000-0000-0000-0000-0000000000e1'), %L, true)$q$, test.id('mediaEx')), 'S-NOT-FOUND');
reset role;
-- media_processed and media_for_runner: the runner's calls (no claims)
set role omnikom_fn;
select test.expect_error($q$select service.media_processed('99999999-0000-0000-0000-000000000000', 2400, 1600, true, 1000)$q$, 'S-NOT-FOUND');
select test.expect_error(format($q$select service.media_processed(%L, 0, 1600, true, 1000)$q$, test.id('mediaOwner')), 'I-MEDIA-SIZE');
select test.expect_error($q$select * from service.media_for_runner('99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
do $$ begin
  assert (select count(*) from service.media_for_runner(test.id('mediaOwner'))) = 1 and (select not processed from service.media_for_runner(test.id('mediaOwner'))), 'the runner reads a media record: id, workspace, path, processed';
  assert (select workspace_id from service.media_for_runner(test.id('mediaOwner'))) = 'aaaaaaaa-0000-0000-0000-000000000000' and (select path from service.media_for_runner(test.id('mediaOwner'))) like 'aaaaaaaa-0000-0000-0000-000000000000/%', 'the runner record names its workspace and path';
end $$;
select service.media_processed(test.id('mediaOwner'), 2400, 1600, true, 1500000);
reset role;
do $$ begin
  assert (select processed and exif_stripped and width = 2400 and height = 1600 and bytes = 1500000 from media where id = test.id('mediaOwner')), 'the processor sets the facts and processed';
end $$;
-- media_facts: what validateItem reads about a photo, only for members and staff, only inside the named workspace
set role omnikom_fn;
do $$ declare f jsonb; begin
  f := service.media_facts(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', test.id('mediaOwner'));
  assert (f ->> 'width')::int = 2400 and (f ->> 'exifStripped')::boolean and (f ->> 'rightsConfirmed')::boolean and (f ->> 'processed')::boolean, 'media_facts answers width, exifStripped, rightsConfirmed, processed';
  assert service.media_facts(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', test.id('mediaB')) is null, 'a media of B asked inside A is unknown';
  assert service.media_facts(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', '99999999-0000-0000-0000-000000000000') is null, 'an unknown media is null';
end $$;
select test.expect_error(format($q$select service.media_facts(test.cl('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000', %L)$q$, test.id('mediaOwner')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.media_facts(test.cl('00000000-0000-0000-0000-00000000000e'), 'aaaaaaaa-0000-0000-0000-000000000000', %L)$q$, test.id('mediaOwner')), 'S-NOT-FOUND');
-- row_exists: a live row of that collection in the workspace (a draft reference may point at any row of the workspace)
do $$ begin
  assert service.row_exists(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', 'team', test.id('team1')), 'a team row of A exists for a member of A';
  assert not service.row_exists(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('team1')), 'the collection must match';
  assert not service.row_exists(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', 'team', test.id('teamB2')), 'a row of B does not exist inside A';
  assert not service.row_exists(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', 'team', '99999999-0000-0000-0000-000000000000'), 'an unknown row does not exist';
end $$;
select test.expect_error(format($q$select service.row_exists(test.cl('00000000-0000-0000-0000-00000000000e'), 'aaaaaaaa-0000-0000-0000-000000000000', 'team', %L)$q$, test.id('team1')), 'S-NOT-FOUND');
-- site_for and row_version: how publish finds the workspace and reads the version it validates
do $$ begin
  assert service.site_for(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-00000000517e') = 'aaaaaaaa-0000-0000-0000-000000000000', 'site_for answers the workspace of the site to its members';
  assert (select collection from service.row_version(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', test.id('team1'), 1)) = 'team'
     and (select data ->> 'name' from service.row_version(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', test.id('team1'), 1)) = 'Agent One', 'row_version answers the collection and the data of that version';
end $$;
select test.expect_error($q$select service.site_for(test.cl('00000000-0000-0000-0000-00000000000e'), 'aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.site_for(test.cl('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.site_for(test.cl('00000000-0000-0000-0000-00000000000a'), '99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error(format($q$select * from service.row_version(test.cl('00000000-0000-0000-0000-00000000000e'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, 1)$q$, test.id('team1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select * from service.row_version(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, 99)$q$, test.id('team1')), 'S-NOT-FOUND');   -- a version that does not exist
select test.expect_error(format($q$select * from service.row_version(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, 1)$q$, test.id('teamB2')), 'S-NOT-FOUND');   -- B's row asked inside A
reset role;
-- export_bundle and job_site: the runner's calls; nothing of another workspace can appear
insert into test.counts select 'mediaA', count(*) from media where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
insert into test.ids select 'jobE', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('team1')]);
reset role;
set role omnikom_fn;
select test.expect_error(format($q$select service.export_bundle(%L)$q$, test.id('jobE')), 'S-JOB-STATE');           -- snapshot not frozen
select test.expect_error($q$select service.export_bundle('99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.job_site('99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select service.freeze_snapshot(test.id('jobE'));
do $$ declare b jsonb; begin
  b := service.export_bundle(test.id('jobE'));
  assert b ->> 'schema' = 'omnikom-export/1', 'the bundle carries the export schema key the factory checks first (migration 10)';
  assert b #>> '{job,id}' = test.id('jobE')::text and b #>> '{job,site_id}' = 'aaaaaaaa-0000-0000-0000-00000000517e' and b #>> '{job,workspace_id}' = 'aaaaaaaa-0000-0000-0000-000000000000' and (b #> '{job,snapshot}') ? test.id('team1')::text, 'the bundle names the job, its site, workspace and snapshot';
  assert b #>> '{site,deploy_target}' = 'test-site-demo-a' and b #>> '{site,preview_host}' = 'demo-a.preview.test' and b #>> '{site,state}' = 'preview', 'the bundle carries the site''s deploy target, preview host and state';
  assert b #>> '{workspace,slug}' = 'test-demo-a' and b #>> '{workspace,industry}' = 'real-estate-agent', 'the bundle carries the workspace';
  assert (b #> '{contract,collections}') ? 'team', 'the bundle carries the active resolved contract';
  assert (select count(*) from jsonb_array_elements(b -> 'rows') r where r ->> 'id' = test.id('team1')::text and r ->> 'collection' = 'team' and (r ->> 'version')::int = 1 and r #>> '{data,name}' = 'Agent One' and r ->> 'at' is not null) = 1, 'the bundle rows are the frozen snapshot, with data and the version''s time';
  assert (select count(*) from jsonb_array_elements(b -> 'rows')) = (select count(*) from service.published_rows(test.id('jobE'))), 'the bundle rows are exactly published_rows';
  assert exists (select 1 from jsonb_array_elements(b -> 'media') m where m ->> 'id' = test.id('mediaOwner')::text and (m ->> 'width')::int = 2400 and (m ->> 'processed')::boolean and (m ->> 'exif_stripped')::boolean and (m ->> 'rights_confirmed')::boolean and m ->> 'path' like 'aaaaaaaa-%'), 'the bundle lists the workspace''s media with the processor''s facts';
  assert (select count(*) from jsonb_array_elements(b -> 'media')) = (select v from test.counts where k = 'mediaA'), 'the bundle lists every media row of A';
  assert position('bbbbbbbb-0000-0000-0000-' in b::text) = 0 and position(test.id('mediaB')::text in b::text) = 0 and position(test.id('teamB2')::text in b::text) = 0, 'nothing of workspace B appears in the bundle of A';
  assert (select deploy_target from service.job_site(test.id('jobE'))) = 'test-site-demo-a' and (select site_id from service.job_site(test.id('jobE'))) = 'aaaaaaaa-0000-0000-0000-00000000517e', 'job_site answers the site and its deploy target';
end $$;
reset role;
-- the ten new functions are closed to anon and authenticated and open to the function role
do $$ declare f text; begin
  foreach f in array array['record_media(jsonb,uuid,text,integer,text)', 'finish_media(jsonb,uuid,boolean)', 'media_processed(uuid,integer,integer,boolean,integer)', 'export_bundle(uuid)', 'job_site(uuid)', 'media_for_runner(uuid)',
    'row_exists(jsonb,uuid,text,uuid)', 'media_facts(jsonb,uuid,uuid)', 'site_for(jsonb,uuid)', 'row_version(jsonb,uuid,uuid,integer)'] loop
    assert has_function_privilege('omnikom_fn', 'service.' || f, 'execute'), f || ' is open to the function role';
    assert not has_function_privilege('anon', 'service.' || f, 'execute') and not has_function_privilege('authenticated', 'service.' || f, 'execute'), f || ' is closed to anon and authenticated';
    assert (select prosecdef from pg_proc where oid = ('service.' || f)::regprocedure), f || ' is security definer';
  end loop;
end $$;
set role authenticated;
select test.expect_error($q$select service.media_processed('00000000-0000-0000-0000-000000000000', 1, 1, true, 1)$q$, 'permission denied');
select test.expect_error($q$select service.export_bundle('00000000-0000-0000-0000-000000000000')$q$, 'permission denied');
select test.expect_error($q$select * from service.record_media('{"sub":"00000000-0000-0000-0000-00000000000a"}'::jsonb, 'aaaaaaaa-0000-0000-0000-000000000000', 'x.jpg', 1, 'image/jpeg')$q$, 'permission denied');
reset role;

-- ===== T19 migration 11: the publish-ready wall (slice 4.6): a row that fails publish validation can never be published, on any path =====
-- Written before the migration (watched red: private.publish_problems did not exist, and a bare listing was published on the SQL path).
-- (a) the rules, on the function itself: the REQUIRED rules of contracts/validate.mjs (publish mode), ported to SQL. Everything else
-- in the JS validator (types, max, slug, enum, references, media, placeholder text, consent wording, sample items) is not tested here.
create function test.pp(p_coll text, p_data jsonb) returns text language sql stable as $$
  select coalesce(string_agg(x, '; ' order by x), '') from unnest(private.publish_problems(
    (select resolved from site_contracts where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and active), p_coll, p_data)) x $$;
do $$ declare ok jsonb := '{"type":"home","title":"Home","seo":{"title":"T","description":"D"},"contact":{"phone":"1"},"rooms":[{"name":"a"}],"sections":{"hero":{"headline":"H"}}}'; begin
  assert test.pp('pages', ok) = '', 'a complete page has no problem';
  assert test.pp('pages', ok - 'title') = 'title required', 'a missing required value is a problem';
  assert test.pp('pages', ok || '{"title":""}') = 'title required', 'the empty string is empty';
  assert test.pp('pages', ok || '{"title":null}') = 'title required', 'JSON null is empty';
  assert test.pp('pages', ok || '{"title":"   "}') = '', 'a whitespace-only string is NOT empty (as in JS)';
  assert test.pp('pages', ok - 'seo') = 'seo required', 'a missing required seo field';
  assert test.pp('pages', ok || '{"seo":{"title":"T"}}') = 'seo.description required', 'seo needs a description';
  assert test.pp('pages', ok || '{"seo":{"title":"  ","description":"D"}}') = 'seo.title required', 'seo needs a title that is not blank after trim';
  assert test.pp('pages', ok || '{"seo":{"title":"T","description":"D"}}') = '', 'seo with both is complete';
  assert test.pp('pages', ok || '{"seo":{}}') = 'seo.description required; seo.title required', 'an empty seo group names both';
  assert test.pp('pages', ok || '{"contact":{}}') = 'contact.phone required', 'a group is entered: its required field is checked';
  assert test.pp('pages', ok - 'contact') = '', 'a missing group is a problem only when the field itself is required';
  assert test.pp('pages', ok || '{"rooms":[{"name":"a"},{}]}') = 'rooms[1].name required', 'a list is entered row by row, the path carries the index';
  assert test.pp('pages', ok || '{"rooms":[]}') = '', 'an empty list is a problem only when the field itself is required';
  assert test.pp('pages', ok || '{"free":{}}') = '', 'an open group is not entered';
  assert test.pp('pages', ok || '{"sections":{}}') = 'sections.hero required', 'a section with a required field must be present';
  assert test.pp('pages', ok || '{"sections":{"hero":{}}}') = 'sections.hero.headline required', 'a present section is entered';
  assert test.pp('pages', ok - 'sections') = '', 'missing sections: a problem only when the field itself is required';
  assert test.pp('pages', ok || '{"type":"nonesuch"}') = '', 'an unknown page type is the JS validator''s I-TYPE, not a required path';
  assert test.pp('pages', ok || '{"fact":{"value":{},"source":"https://x.test","date":"2026-01-01"}}') = 'fact.n required', 'a sourced value is unwrapped, then entered';
  assert test.pp('pages', ok || '{"fact":{"value":{"n":"x"},"source":"https://x.test","date":"2026-01-01"}}') = '', 'a sourced value that is complete inside its wrapper has no problem';
  assert test.pp('pages', ok || '{"fact":{"value":{},"source":"","date":"2026-01-01"}}') = '', 'a sourced value without a source is the JS validator''s I-SOURCE, not a required path';
  assert test.pp('pages', '{"type":"home"}') = 'seo required; title required', 'every problem is listed';
  assert test.pp('pages', '[]') = '', 'data that is not an object is the JS validator''s I-TYPE';
  assert test.pp('nonesuch', '{}') = 'nonesuch unknown collection', 'an unknown collection';
  assert test.pp('listings', '{"street":"x"}') = 'status required', 'the listing needs its status';
  assert test.pp('listings', '{"street":"x","status":"for-sale"}') = '', 'a complete listing';
end $$;
-- (b) the SQL path (omnikom publish, test scripts, anything with a database connection): a bare row is refused, the same row made complete is accepted
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
insert into test.ids select 'bare1', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"3 Bare Rd"}');   -- saving a draft is fine
select test.expect_error(format($q$select test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[%L::uuid])$q$, test.id('bare1')), 'I-NOT-READY: ' || test.id('bare1') || ' status required');
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('bare1'), '{"street":"3 Bare Rd","status":"for-sale"}');
select test.expect_error(format($q$select test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[%L::uuid], array[1])$q$, test.id('bare1')), 'I-NOT-READY');   -- the pinned version is the one checked, not the latest
insert into test.ids select 'jobReady', test.publish('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('bare1')]);
reset role;
do $$ begin assert (select requested ->> test.id('bare1')::text from publish_jobs where id = test.id('jobReady')) = '2', 'the complete version was accepted'; end $$;
-- a job straight into the table (a superuser): a version that does not exist, and a row of another workspace, are refused too
select test.expect_error(format($q$insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', '00000000-0000-0000-0000-00000000000a', array[%L::uuid], jsonb_build_object(%L::text, 99))$q$, test.id('bare1'), test.id('bare1')), 'version 99 not found in this workspace');
select test.expect_error(format($q$insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', '00000000-0000-0000-0000-00000000000a', array[%L::uuid], jsonb_build_object(%L::text, 1))$q$, test.id('teamB2'), test.id('teamB2')), 'not found in this workspace');
-- (c) layer two: published_version moved by hand (a superuser; triggers fire for superusers) to a bare version is refused
select test.expect_error(format($q$update content_rows set published_version = 1 where id = %L$q$, test.id('bare1')), 'I-NOT-READY');
select test.expect_error(format($q$update content_rows set published_version = 99 where id = %L$q$, test.id('bare1')), 'version 99 not found');
update content_rows set published_version = 2 where id = test.id('bare1');
do $$ begin assert (select published_version from content_rows where id = test.id('bare1')) = 2, 'the complete version can go live'; end $$;
update content_rows set published_version = null where id = test.id('bare1');
do $$ begin assert (select published_version from content_rows where id = test.id('bare1')) is null, 'taking a row off the site is never refused'; end $$;
-- a legacy row (published at a bare version before the wall existed) is left alone when its version does not change
alter table content_rows disable trigger content_rows_ready;
update content_rows set published_version = 1 where id = test.id('bare1');
alter table content_rows enable trigger content_rows_ready;
update content_rows set published_version = 1 where id = test.id('bare1');
do $$ begin assert (select published_version from content_rows where id = test.id('bare1')) = 1, 'the wall looks at a change of version, not at every update'; end $$;
update content_rows set published_version = null where id = test.id('bare1');
-- ... and a faked "done" callback for a job whose snapshot holds a bare version publishes nothing
set role service_role;
select service.set_job_state(test.id('jobE'), 'failed', '{"reason":"test"}');   -- T18's job was frozen (building) and never finished: one build per site at a time
select service.freeze_snapshot(test.id('jobReady'));
update publish_jobs set snapshot = snapshot || jsonb_build_object(test.id('bare1')::text, 1) where id = test.id('jobReady');
select service.set_job_state(test.id('jobReady'), 'gating'); select service.set_job_state(test.id('jobReady'), 'deploying');
select test.expect_error(format($q$select service.set_job_state(%L, 'done')$q$, test.id('jobReady')), 'I-NOT-READY');
select service.set_job_state(test.id('jobReady'), 'failed', '{"reason":"test"}');
reset role;
do $$ begin assert (select published_version from content_rows where id = test.id('bare1')) is null, 'a faked done callback published nothing'; end $$;
-- (d) no active contract = refused
update site_contracts set active = false where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000';
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error(format($q$select test.publish('bbbbbbbb-0000-0000-0000-00000000517e', array[%L::uuid])$q$, test.id('teamB2')), 'no active contract');
reset role;
select test.expect_error(format($q$update content_rows set published_version = 1 where id = %L$q$, test.id('teamB2')), 'no active contract');   -- layer two says it too
update site_contracts set active = true where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000';
-- (e) the new functions are closed to anon, authenticated and the function role; the triggers are definer functions with an empty search_path
do $$ declare f text; begin
  foreach f in array array['private.js_truthy(jsonb)', 'private.publish_empty(jsonb)', 'private.publish_has_text(jsonb)', 'private.publish_problems_object(jsonb,text,text,jsonb,jsonb)',
    'private.publish_problems_value(jsonb,text,text,jsonb,jsonb)', 'private.publish_problems(jsonb,text,jsonb)', 'private.check_job_ready()', 'private.check_version_ready()'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('omnikom_fn', f, 'execute'), f || ' is closed to anon, authenticated and the function role';
    assert (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' pins an empty search_path';
  end loop;
  assert (select prosecdef from pg_proc where oid = 'private.check_job_ready()'::regprocedure) and (select prosecdef from pg_proc where oid = 'private.check_version_ready()'::regprocedure), 'both trigger functions are security definer';
end $$;

-- ===== T20 migration 12 (slice 5.1): the database for the four screens: S-STALE, unread leads, export events, lead alerts, the CRM webhook, drafts waiting =====
-- Written before the migration (watched red: every helper below failed with "function service.mark_lead_read ... does not exist", see PROGRESS 5.1).
-- The Edge Functions of slice 5.2 call these as omnikom_fn after verifying the JWT; the helpers stand in for them (security definer, claims from
-- test.act_as), and (a) and (g) also call as omnikom_fn. (placed before T17 on purpose, like T18 and T19: a grant mutant must be seen here, on its own function.)
create function test.save_b(p_ws uuid, p_coll text, p_row uuid, p_data jsonb, p_base int) returns table (row_id uuid, version int) language sql security definer as $$
  select * from service.save_as(test.claims(), p_ws, p_coll, p_row, p_data, null, p_base) $$;
create function test.mark_read(p_lead uuid) returns void language sql security definer as $$ select service.mark_lead_read(test.claims(), p_lead) $$;
create function test.exported(p_site uuid, p_ids uuid[]) returns int language sql security definer as $$ select service.leads_exported(test.claims(), p_site, p_ids) $$;
create function test.set_alerts(p_site uuid, p_to text[], p_assignee boolean default null) returns void language sql security definer as $$
  select service.set_alerts(test.claims(), p_site, p_to, p_assignee) $$;
create function test.set_crm(p_ws uuid, p_url text, p_ref text default null) returns void language sql security definer as $$ select service.set_crm_webhook(test.claims(), p_ws, p_url, p_ref) $$;
create function test.drafts(p_site uuid) returns table (row_id uuid, collection text, newest_version int, published_version int, edited_by uuid, edited_at timestamptz) language sql security definer as $$
  select * from service.drafts_waiting(test.claims(), p_site) $$;
grant execute on all functions in schema test to anon, authenticated, service_role, omnikom_fn;

-- ---------- (a) S-STALE: a save names the version it started from (16-DESIGN-PARTS 3.2) ----------
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
insert into test.ids select 'st1', row_id from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"4 Stale Rd","status":"for-sale"}', null);   -- no base on a new row: today's behaviour
insert into test.ids select 'st2', row_id from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"5 Stale Rd","status":"for-sale"}', 0);      -- base 0 on a new row: nothing before it
select test.expect_error($q$select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"6 Stale Rd","status":"for-sale"}', 1)$q$, 'S-STALE');   -- a new row cannot start from a version
select test.expect_error($q$select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"6 Stale Rd","status":"for-sale"}', 7)$q$, 'S-STALE');
do $$ begin assert (select count(*) from content_versions where data ->> 'street' = '6 Stale Rd') = 0, 'a refused new row wrote nothing'; end $$;
select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('st1'), '{"street":"4 Stale Rd","status":"sold"}', 1);        -- started from version 1, the newest: accepted (version 2)
select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('st1'), '{"street":"4 Stale Rd","status":"for-sale"}', 2);     -- version 3
do $$ begin assert (select max(n) from content_versions where row_id = test.id('st1')) = 3, 'two current saves made versions 2 and 3'; end $$;
select test.expect_error(format($q$select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', %L, '{"street":"stale one"}', 1)$q$, test.id('st1')),
  'S-STALE: ' || test.id('st1') || ' was saved at version 3 by someone else');
select test.expect_error(format($q$select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', %L, '{"street":"stale two"}', 2)$q$, test.id('st1')),
  'S-STALE: ' || test.id('st1') || ' was saved at version 3 by someone else');
do $$ declare m text; begin
  begin perform test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('st1'), '{"street":"stale three"}', 0);
  exception when others then m := sqlerrm; end;
  assert m = 'S-STALE: ' || test.id('st1') || ' was saved at version 3 by someone else', 'the message is exactly the row id and the newest version: ' || coalesce(m, '(no error)');
  assert (select max(n) from content_versions where row_id = test.id('st1')) = 3 and (select count(*) from content_versions where data ->> 'street' like 'stale %') = 0, 'a stale save wrote nothing';
end $$;
select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('st1'), '{"street":"4 Stale Rd","status":"sold"}', null);        -- no base: today's behaviour, version 4
do $$ begin assert (select max(n) from content_versions where row_id = test.id('st1')) = 4, 'a save without a base is still accepted'; end $$;
-- the stale check comes after the access checks: a person who may not save the row learns nothing about its versions
select test.act_as('00000000-0000-0000-0000-0000000000a2');
select test.expect_error(format($q$select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', %L, '{"street":"hijack"}', 0)$q$, test.id('listing1')), 'S-OWN-ONLY');
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error(format($q$select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', %L, '{"street":"outsider"}', 0)$q$, test.id('st1')), 'S-NOT-FOUND');
reset role;
-- the old signature is gone (an overload would leave the old, base-less function callable) and every grant it had is kept
do $$ begin
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'service' and p.proname = 'save_as') = 1, 'one service.save_as only: the old signature was dropped';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'save_version') = 1, 'one private.save_version only: the old signature was dropped';
  assert has_function_privilege('service_role', 'service.save_as(jsonb,uuid,text,uuid,jsonb,jsonb,int)', 'execute') and has_function_privilege('omnikom_fn', 'service.save_as(jsonb,uuid,text,uuid,jsonb,jsonb,int)', 'execute'), 'service_role and the function role may execute save_as';
  assert not has_function_privilege('anon', 'service.save_as(jsonb,uuid,text,uuid,jsonb,jsonb,int)', 'execute') and not has_function_privilege('authenticated', 'service.save_as(jsonb,uuid,text,uuid,jsonb,jsonb,int)', 'execute'), 'anon and authenticated may not execute save_as';
  assert not has_function_privilege('anon', 'private.save_version(uuid,text,uuid,jsonb,jsonb,int)', 'execute') and not has_function_privilege('authenticated', 'private.save_version(uuid,text,uuid,jsonb,jsonb,int)', 'execute')
    and not has_function_privilege('omnikom_fn', 'private.save_version(uuid,text,uuid,jsonb,jsonb,int)', 'execute'), 'save_version stays closed to everyone but its owner';
end $$;
-- the function role calls it, with and without a base (the CLI and stage.mjs still call it with six arguments)
set role omnikom_fn;
select row_id from service.save_as(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('st1'), '{"street":"4 Stale Rd","status":"for-sale"}', null);   -- six arguments: version 5
select row_id from service.save_as(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('st1'), '{"street":"4 Stale Rd","status":"sold"}', null, 5);    -- seven, current: version 6
select test.expect_error(format($q$select row_id from service.save_as(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'listings', %L, '{"street":"late"}', null, 5)$q$, test.id('st1')),
  'S-STALE: ' || test.id('st1') || ' was saved at version 6 by someone else');
reset role;

-- ---------- (b) unread leads: lead_reads, one row per login and lead ----------
insert into test.ids select 'rdA1', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Read A1', 'ra1@test', null, '{}', 'I agree');
insert into test.ids select 'rdA2', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Read A2', 'ra2@test', null, '{}', 'I agree');
insert into test.ids select 'rdNone', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Read nobody', 'rn@test', null, '{}', 'I agree');
insert into test.ids select 'rdTmp', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Read temp', 'rt@test', null, '{}', 'I agree');
update leads set owner_team_row = test.id('team1') where id = test.id('rdA1');
update leads set owner_team_row = test.id('team2') where id = test.id('rdA2');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.mark_read(test.id('rdA1'));
select test.mark_read(test.id('rdA1'));      -- a second time changes nothing but the time
do $$ begin assert (select count(*) from lead_reads where lead_id = test.id('rdA1')) = 1 and (select user_id from lead_reads where lead_id = test.id('rdA1')) = '00000000-0000-0000-0000-0000000000a1', 'agent one marked their own lead read, once'; end $$;
select test.expect_error(format($q$select test.mark_read(%L)$q$, test.id('rdA2')), 'S-NOT-FOUND');       -- another agent's lead
select test.expect_error(format($q$select test.mark_read(%L)$q$, test.id('rdNone')), 'S-NOT-FOUND');     -- not assigned to anyone: an agent sees only their own
select test.expect_error(format($q$select test.mark_read(%L)$q$, test.id('leadB')), 'S-NOT-FOUND');      -- another workspace
select test.expect_error($q$select test.mark_read('99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');   -- unknown
do $$ begin assert (select count(*) from lead_reads) = 1, 'agent one sees exactly their own mark'; end $$;
select test.expect_error(format($q$insert into lead_reads (lead_id, user_id) values (%L, '00000000-0000-0000-0000-0000000000a1')$q$, test.id('rdNone')), 'permission denied');
select test.expect_error($q$update lead_reads set read_at = now()$q$, 'permission denied');
select test.expect_error($q$delete from lead_reads$q$, 'permission denied');
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.mark_read(test.id('rdA1')); select test.mark_read(test.id('rdA2')); select test.mark_read(test.id('rdNone')); select test.mark_read(test.id('rdTmp'));
do $$ begin
  assert (select count(*) from lead_reads) = 4, 'the owner sees their own four marks';
  assert (select count(*) from lead_reads where user_id = '00000000-0000-0000-0000-0000000000a1') = 0, 'the owner cannot read another login''s marks';
end $$;
select test.act_as('00000000-0000-0000-0000-0000000000a2');
do $$ begin assert (select count(*) from lead_reads) = 0, 'agent two reads no mark of anyone else'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error(format($q$select test.mark_read(%L)$q$, test.id('rdA1')), 'S-NOT-FOUND');       -- B's owner into A
do $$ begin assert (select count(*) from lead_reads) = 0, 'B''s owner reads none of A''s marks'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f');                                                 -- staff without MFA is nobody
select test.expect_error(format($q$select test.mark_read(%L)$q$, test.id('rdNone')), 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.mark_read(test.id('rdNone'));
do $$ begin assert (select count(*) from lead_reads) = 1, 'staff with MFA marks any lead and sees only their own mark'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.delete_lead(test.id('rdTmp'));
reset role;
do $$ begin
  assert (select count(*) from lead_reads where lead_id = test.id('rdTmp')) = 0, 'deleting a lead deletes its marks';
  assert (select count(*) from lead_reads) = 5, 'five marks remain: agent one 1, the owner 3, staff 1 (the deleted lead''s is gone)';
  assert not exists (select 1 from pg_publication where pubname = 'supabase_realtime') or exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_reads'), 'lead_reads is in the Realtime publication';
  assert not has_table_privilege('anon', 'public.lead_reads', 'select') and has_table_privilege('authenticated', 'public.lead_reads', 'select'), 'anon reads nothing, authenticated reads through the policy';
  assert not has_table_privilege('authenticated', 'public.lead_reads', 'insert') and not has_table_privilege('authenticated', 'public.lead_reads', 'update') and not has_table_privilege('authenticated', 'public.lead_reads', 'delete'), 'authenticated has no write grant on lead_reads';
end $$;
set role anon;
select test.act_as(null);
select test.expect_error($q$select count(*) from lead_reads$q$, 'permission denied');
reset role;

-- ---------- (c) the CSV export leaves one event per readable lead ----------
insert into sites (id, workspace_id, deploy_target, preview_host) values ('aaaaaaaa-0000-0000-0000-0000000052e2', 'aaaaaaaa-0000-0000-0000-000000000000', 'test-site-demo-a2', 'demo-a2.preview.test');
insert into test.ids select 'rdS2', service.capture_lead('aaaaaaaa-0000-0000-0000-0000000052e2', 'contact', '/', 'Second site', 'rs2@test', null, '{}', 'I agree');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin assert test.exported('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('rdA1'), test.id('rdA2'), test.id('rdNone'), test.id('leadB'), '99999999-0000-0000-0000-000000000000', test.id('rdA1')]) = 1, 'an agent exports one lead of the six ids: their own, once'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert test.exported('aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('rdA1'), test.id('rdA2'), test.id('rdNone'), test.id('leadB'), test.id('rdS2')]) = 3, 'the owner exports the three leads of this site; another workspace''s and another site''s are skipped';
  assert test.exported('aaaaaaaa-0000-0000-0000-00000000517e', '{}') = 0 and test.exported('aaaaaaaa-0000-0000-0000-00000000517e', null) = 0, 'nothing to export records nothing';
  assert test.exported('aaaaaaaa-0000-0000-0000-0000000052e2', array[test.id('rdS2')]) = 1, 'the lead of the second site exports under the second site';
end $$;
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error(format($q$select test.exported('aaaaaaaa-0000-0000-0000-00000000517e', array[%L::uuid])$q$, test.id('rdA1')), 'S-NOT-FOUND');   -- B's owner into A's site
do $$ begin assert test.exported('bbbbbbbb-0000-0000-0000-00000000517e', array[test.id('rdA1')]) = 0, 'B''s owner exports nothing of A under their own site'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f');
select test.expect_error(format($q$select test.exported('aaaaaaaa-0000-0000-0000-00000000517e', array[%L::uuid])$q$, test.id('rdA1')), 'S-NOT-FOUND');   -- staff without MFA
select test.expect_error($q$select test.exported('99999999-0000-0000-0000-000000000000', '{}')$q$, 'S-NOT-FOUND');                                         -- unknown site
reset role;
do $$ begin
  assert (select count(*) from lead_events where lead_id = test.id('rdA1') and kind = 'exported') = 2, 'rdA1: one event from agent one, one from the owner';
  assert (select count(*) from lead_events where lead_id = test.id('rdA1') and kind = 'exported' and by = '00000000-0000-0000-0000-0000000000a1' and detail = jsonb_build_object('by', '00000000-0000-0000-0000-0000000000a1'::uuid)) = 1, 'the event says who exported';
  assert (select count(*) from lead_events where lead_id = test.id('rdA2') and kind = 'exported') = 1, 'rdA2: the owner''s event only (agent one could not read it)';
  assert (select count(*) from lead_events where lead_id = test.id('rdNone') and kind = 'exported') = 1, 'rdNone: the owner''s event only';
  assert (select count(*) from lead_events where lead_id = test.id('leadB') and kind = 'exported') = 0, 'a lead of another workspace is never recorded';
  assert (select count(*) from lead_events where lead_id = test.id('rdS2') and kind = 'exported') = 1, 'the second site''s lead: recorded once, under its own site';
  assert (select detail from audit_log where action = 'leads-export' and target = 'aaaaaaaa-0000-0000-0000-00000000517e' and actor = '00000000-0000-0000-0000-00000000000a' order by id limit 1) = '{"recorded": 3, "skipped": 2}', 'the audit row counts what was recorded and what was skipped';
end $$;

-- ---------- (d) lead alerts: who gets every new lead, and the agent too ----------
do $$ begin assert (select alert_assignee from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e') and (select lead_alert_to from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e') = '{}', 'a site starts with nobody listed and the agent included'; end $$;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['Boss@Test.com', ' boss@test.com', 'second@test.com', 'SECOND@test.com'], false);
do $$ begin
  assert (select lead_alert_to from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e') = array['boss@test.com', 'second@test.com'], 'the list is lower-cased and de-duplicated, in the order given';
  assert not (select alert_assignee from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e'), 'the assignee tick is stored';
  assert (select count(*) from audit_log where action = 'alerts-set' and target = 'aaaaaaaa-0000-0000-0000-00000000517e') = 1, 'the change is audited';
  assert (select detail::text from audit_log where action = 'alerts-set' limit 1) not like '%boss@test.com%', 'the audit row holds no address';
end $$;
select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['boss@test.com'], null);
do $$ begin assert not (select alert_assignee from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e') and (select lead_alert_to from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e') = array['boss@test.com'], 'a null tick keeps the tick; the list is replaced'; end $$;
select test.expect_error($q$select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['boss@test.com', 'nope'])$q$, 'I-EMAIL: nope');
select test.expect_error($q$select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['a@b'])$q$, 'I-EMAIL: a@b');
select test.expect_error($q$select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['a b@c.com'])$q$, 'I-EMAIL: a b@c.com');
select test.expect_error($q$select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['two@@c.com'])$q$, 'I-EMAIL: two@@c.com');
select test.expect_error($q$select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['x@y.com', null])$q$, 'I-EMAIL');
select test.expect_error($q$select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['a1@t.com','a2@t.com','a3@t.com','a4@t.com','a5@t.com','a6@t.com','a7@t.com','a8@t.com','a9@t.com','a10@t.com','a11@t.com'])$q$, 'I-EMAIL');
do $$ begin assert (select lead_alert_to from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e') = array['boss@test.com'], 'a refused list changed nothing'; end $$;
select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['a1@t.com','a2@t.com','a3@t.com','a4@t.com','a5@t.com','a6@t.com','a7@t.com','a8@t.com','a9@t.com','a10@t.com','A10@t.com'], true);   -- ten after de-duplication
do $$ begin assert (select cardinality(lead_alert_to) from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e') = 10 and (select alert_assignee from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e'), 'ten addresses are allowed'; end $$;
select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', null, true);
do $$ begin assert (select lead_alert_to from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e') = '{}', 'no list clears it'; end $$;
select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['boss@test.com'], true);
select test.act_as('00000000-0000-0000-0000-0000000000a1');                       -- an agent
select test.expect_error($q$select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['agent@test.com'])$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');                       -- another workspace's owner
select test.expect_error($q$select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['b@test.com'])$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f');                       -- staff without MFA
select test.expect_error($q$select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['s@test.com'])$q$, 'S-NOT-FOUND');
select test.expect_error($q$select test.set_alerts('99999999-0000-0000-0000-000000000000', array['s@test.com'])$q$, 'S-NOT-FOUND');   -- unknown site
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.set_alerts('aaaaaaaa-0000-0000-0000-00000000517e', array['staff-set@test.com'], true);
reset role;
do $$ begin assert (select lead_alert_to from sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e') = array['staff-set@test.com'], 'staff with MFA may set it; every refusal above changed nothing'; end $$;

-- ---------- (e) the CRM connection: a webhook URL that is public, and the NAME of its secret ----------
-- the rules on the helper itself (the service function calls it)
do $$ begin
  assert private.crm_url_problem('https://hooks.example.com/crm/abc?x=1#top') is null, 'a good address';
  assert private.crm_url_problem('https://hooks.example.com:8443/x') is null, 'a port is fine';
  assert private.crm_url_problem('https://8.8.8.8/hook') is null and private.crm_url_problem('https://172.32.0.1/') is null and private.crm_url_problem('https://172.15.255.255/') is null and private.crm_url_problem('https://11.0.0.1/') is null and private.crm_url_problem('https://192.169.0.1/') is null and private.crm_url_problem('https://192.0.1.1/') is null and private.crm_url_problem('https://198.17.255.255/') is null and private.crm_url_problem('https://198.20.0.1/') is null and private.crm_url_problem('https://100.63.255.255/') is null and private.crm_url_problem('https://100.128.0.1/') is null, 'public numbers just outside the private ranges are fine';
  assert private.crm_url_problem('http://hooks.example.com/x') is not null, 'plain http is refused';
  assert private.crm_url_problem('HTTP://hooks.example.com/x') is not null and private.crm_url_problem('ftp://hooks.example.com/x') is not null and private.crm_url_problem('//hooks.example.com/x') is not null and private.crm_url_problem('hooks.example.com') is not null, 'only https:// is accepted';
  assert private.crm_url_problem(null) is not null and private.crm_url_problem('') is not null, 'nothing is not an address';
  assert private.crm_url_problem('https://' || repeat('a', 1985) || '.example.com/') is not null, 'at most 2000 characters';
  assert private.crm_url_problem('https://hooks.example.com/' || repeat('a', 1974)) is null and private.crm_url_problem('https://hooks.example.com/' || repeat('a', 1975)) is not null, '2000 characters is the edge';
  assert private.crm_url_problem('https://127.0.0.1/') is not null and private.crm_url_problem('https://127.255.255.254/') is not null, 'loopback';
  assert private.crm_url_problem('https://10.0.0.5/') is not null and private.crm_url_problem('https://10.255.255.255/') is not null, '10/8';
  assert private.crm_url_problem('https://172.16.0.1/') is not null and private.crm_url_problem('https://172.31.255.255/') is not null, '172.16/12';
  assert private.crm_url_problem('https://192.168.1.1/') is not null, '192.168/16';
  assert private.crm_url_problem('https://169.254.169.254/latest/meta-data') is not null, 'link-local (the cloud metadata address)';
  assert private.crm_url_problem('https://0.0.0.0/') is not null and private.crm_url_problem('https://100.64.0.1/') is not null and private.crm_url_problem('https://100.127.255.255/') is not null and private.crm_url_problem('https://192.0.0.1/') is not null and private.crm_url_problem('https://198.18.0.1/') is not null and private.crm_url_problem('https://198.19.255.255/') is not null and private.crm_url_problem('https://224.0.0.1/') is not null and private.crm_url_problem('https://255.255.255.255/') is not null, 'this-network, shared address space, multicast and broadcast';
  assert private.crm_url_problem('https://127.0.0.1:8080/x') is not null and private.crm_url_problem('https://127.0.0.1./') is not null and private.crm_url_problem('https://127.0.0.1?x=1') is not null, 'a port, a trailing dot or a query does not hide it';
  assert private.crm_url_problem('https://localhost/') is not null and private.crm_url_problem('https://LOCALHOST:8443/') is not null and private.crm_url_problem('https://localhost./') is not null and private.crm_url_problem('https://app.localhost/') is not null, 'localhost, any case, port or subdomain';
  assert private.crm_url_problem('https://printer.local/') is not null and private.crm_url_problem('https://db.internal/') is not null and private.crm_url_problem('https://intranet/') is not null, 'private names and one-word hosts';
  assert private.crm_url_problem('https://[::1]/') is not null and private.crm_url_problem('https://[2001:db8::1]/') is not null, 'IPv6 addresses are refused: use a host name';
  assert private.crm_url_problem('https://2130706433/') is not null and private.crm_url_problem('https://0x7f.1/') is not null and private.crm_url_problem('https://0x7f000001/') is not null and private.crm_url_problem('https://0177.0.0.1/') is not null and private.crm_url_problem('https://127.1/') is not null and private.crm_url_problem('https://1.2.3/') is not null and private.crm_url_problem('https://1.2.3.4.5/') is not null and private.crm_url_problem('https://256.1.1.1/') is not null, 'other ways to write an address are refused';
  assert private.crm_url_problem('https://user:pw@hooks.example.com/') is not null and private.crm_url_problem('https://hooks.example.com@127.0.0.1/') is not null and private.crm_url_problem('https://a@hooks.example.com/') is not null, 'no login in the address';
  assert private.crm_url_problem('https://user:pw@hooks.example.com/') like '%user name or password%' and private.crm_url_problem('https://hooks.example.com@127.0.0.1/') like '%user name or password%', 'a login is named as the reason (the host rules would refuse it too, for a worse reason)';
  assert private.crm_url_problem('https://hooks.example.com/a b') is not null and private.crm_url_problem('https://hooks.example.com/a' || chr(10) || 'b') is not null and private.crm_url_problem('https://hooks.example.com\@127.0.0.1/') is not null, 'no space, control character or backslash';
  assert private.crm_url_problem('https://hooks_x.example.com/') is not null and private.crm_url_problem('https://-bad.example.com/') is not null and private.crm_url_problem('https://example..com/') is not null and private.crm_url_problem('https://example.com:99999/') is not null and private.crm_url_problem('https://example.com:0/') is not null and private.crm_url_problem('https://example.com:/') is not null, 'a host name and a port that cannot be real are refused';
  assert private.crm_url_problem('https://example.123/') is not null, 'a last label made of digits looks like an address';
  assert private.crm_url_problem('https://xn--bcher-kva.example/') is null and private.crm_url_problem('https://a.b.c.d.example.com/') is null and private.crm_url_problem('https://1.2.3.4.example.com/') is null, 'punycode and digits inside a name are fine';
end $$;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/crm/abc', 'crm-webhook-signing-a');
do $$ begin
  assert (select count(*) from integrations where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'crm-webhook') = 1, 'the owner sees the row they made';
  assert (select config from integrations where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'crm-webhook') = '{"url": "https://hooks.example.com/crm/abc"}'::jsonb, 'the config holds the url and nothing else';
  assert (select secret_ref from integrations where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'crm-webhook') = 'crm-webhook-signing-a', 'the secret is held as a name';
  assert (select count(*) from audit_log where action = 'crm-set' and target = 'aaaaaaaa-0000-0000-0000-000000000000') = 1, 'the change is audited';
  assert (select detail::text from audit_log where action = 'crm-set' and target = 'aaaaaaaa-0000-0000-0000-000000000000') not like '%crm-webhook-signing-a%', 'the audit row does not carry the ref';
end $$;
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/crm/def', null);
do $$ begin assert (select config ->> 'url' from integrations where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'crm-webhook') = 'https://hooks.example.com/crm/def' and (select secret_ref from integrations where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'crm-webhook') = 'crm-webhook-signing-a', 'a new address without a ref keeps the ref'; end $$;
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'http://hooks.example.com/x')$q$, 'I-URL');
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://127.0.0.1/')$q$, 'I-URL');
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://10.0.0.5/')$q$, 'I-URL');
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://localhost/')$q$, 'I-URL');
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/x', 'a b')$q$, 'I-SECRET-REF');
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/x', 'https://hooks.example.com/secret')$q$, 'I-SECRET-REF');
select test.expect_error(format($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/x', %L)$q$, repeat('r', 101)), 'I-SECRET-REF');
do $$ begin assert (select config ->> 'url' from integrations where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'crm-webhook') = 'https://hooks.example.com/crm/def', 'every refusal above changed nothing'; end $$;
select test.act_as('00000000-0000-0000-0000-0000000000a1');                       -- an agent
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/agent', 'x')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', null)$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');                       -- another workspace's owner
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/b', 'x')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', null)$q$, 'S-NOT-FOUND');
do $$ begin assert (select count(*) from integrations where kind = 'crm-webhook') = 0, 'B''s owner sees no connection of A'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f');                       -- staff without MFA
select test.expect_error($q$select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/s', 'x')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.set_crm('bbbbbbbb-0000-0000-0000-000000000000', 'https://hooks.example.com/staff-b', 'crm-webhook-signing-b');
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', null);              -- no url removes the connection
do $$ begin
  assert (select count(*) from integrations where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'crm-webhook') = 0, 'no address removes the row';
  assert (select count(*) from audit_log where action = 'crm-set' and target = 'aaaaaaaa-0000-0000-0000-000000000000') = 3, 'two sets and the removal are audited';
end $$;
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', null);              -- removing nothing is fine
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/again', null);
do $$ begin assert (select secret_ref from integrations where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'crm-webhook') is null, 'after a removal the old ref is gone'; end $$;
reset role;

-- ---------- (f) drafts waiting ("Publish 3 changes") ----------
-- The question was whether two plain RLS reads (content_rows for published_version, content_versions for the newest) answer it. They do not,
-- for an agent: rows_read is workspace-wide, so an agent can READ a page the owner edited, but start_publish refuses them that page (S-ROLE /
-- S-OWN-ONLY). The count on their button must only hold what they can publish, so the scope lives in a function, in the database.
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
insert into test.ids select 'dwPage', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'pages', null, '{"type":"home","title":"Draft page"}');
insert into test.ids select 'dwInbox', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'leads', null, '{"status":"new"}');
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select * from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'team', test.id('team1'), '{"name":"Agent One","bio":"draft"}');   -- their own profile: a new version, so it is waiting whatever was published before
insert into test.ids select 'dwL1', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"7 Draft Rd","status":"for-sale"}');
select test.act_as('00000000-0000-0000-0000-0000000000a2');
select * from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'team', test.id('team2'), '{"name":"Agent Two","bio":"draft"}');
insert into test.ids select 'dwL2', row_id from test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"8 Draft Rd","status":"for-sale"}');
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ declare ids uuid[]; begin
  select array_agg(d.row_id) into ids from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') d;
  assert test.id('dwPage') = any(ids) and test.id('dwL1') = any(ids) and test.id('dwL2') = any(ids) and test.id('st1') = any(ids), 'the owner sees every draft of the workspace';
  assert not (test.id('dwInbox') = any(ids)), 'an inbox row is never published, so it is never waiting';
  assert (select newest_version from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwPage')) = 1
    and (select published_version from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwPage')) is null
    and (select collection from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwPage')) = 'pages'
    and (select edited_by from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwPage')) = '00000000-0000-0000-0000-00000000000a'
    and (select edited_at from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwPage')) > now() - interval '1 hour', 'the columns: collection, newest version, published version (none yet), who and when';
  assert (select newest_version from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('st1')) = 6, 'the newest version of a row edited six times is 6';
  assert (select edited_by from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwL1')) = '00000000-0000-0000-0000-0000000000a1', 'edited by the agent who saved it';
end $$;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ declare ids uuid[]; begin
  select array_agg(d.row_id) into ids from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') d;
  assert (select count(*) from content_rows where id = test.id('dwPage')) = 1, 'plain RLS shows an agent the owner''s page (this is why a function is needed)';
  assert test.id('dwL1') = any(ids), 'agent one sees their own draft listing';
  assert test.id('team1') = any(ids), 'agent one sees their own team profile (an own collection, ownerField self)';
  assert not (test.id('dwPage') = any(ids)), 'agent one does not see the page, they cannot publish it';
  assert not (test.id('dwL2') = any(ids)) and not (test.id('st1') = any(ids)) and not (test.id('team2') = any(ids)), 'agent one does not see another agent''s draft or one that is nobody''s';
  assert not (test.id('dwInbox') = any(ids)), 'nor the inbox row';
end $$;
select test.act_as('00000000-0000-0000-0000-0000000000a2');
do $$ declare ids uuid[]; begin
  select array_agg(d.row_id) into ids from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') d;
  assert test.id('dwL2') = any(ids) and not (test.id('dwL1') = any(ids)) and not (test.id('dwPage') = any(ids)), 'agent two sees only their own';
end $$;
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error($q$select * from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from test.drafts('99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
do $$ begin assert (select count(*) from test.drafts('bbbbbbbb-0000-0000-0000-00000000517e')) = (select count(*) from test.drafts('bbbbbbbb-0000-0000-0000-00000000517e') d join content_rows c on c.id = d.row_id), 'B''s list holds only rows B''s owner can read: none of A''s'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f');
select test.expect_error($q$select * from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'S-NOT-FOUND');   -- staff without MFA
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ declare ids uuid[]; begin
  select array_agg(d.row_id) into ids from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') d;
  assert test.id('dwPage') = any(ids) and test.id('dwL1') = any(ids) and test.id('dwL2') = any(ids), 'staff with MFA sees all';
end $$;
reset role;
-- a row that goes live at its newest version is no longer waiting; a new version brings it back; a deleted row leaves the list
update content_rows set published_version = 1 where id = test.id('dwL1');
update content_rows set published_version = 1 where id = test.id('dwL2');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin assert not exists (select 1 from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwL1')), 'published at its newest version: not waiting'; end $$;
select * from test.save_b('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('dwL1'), '{"street":"7 Draft Rd","status":"sold"}', 1);
do $$ begin assert (select newest_version from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwL1')) = 2 and (select published_version from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwL1')) = 1, 'a newer draft is waiting, with both numbers'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.unpublish(test.id('dwL2'));                                           -- the test helper deletes
do $$ begin assert not exists (select 1 from test.drafts('aaaaaaaa-0000-0000-0000-00000000517e') where row_id = test.id('dwL2')), 'a deleted row is not waiting'; end $$;
reset role;

-- ---------- (g) the new functions are closed to anon, authenticated and PUBLIC, open to service_role and the function role, definer with an empty search_path ----------
do $$ declare f text; begin
  foreach f in array array['service.mark_lead_read(jsonb,uuid)', 'service.leads_exported(jsonb,uuid,uuid[])', 'service.set_alerts(jsonb,uuid,text[],boolean)', 'service.set_crm_webhook(jsonb,uuid,text,text)', 'service.drafts_waiting(jsonb,uuid)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'), f || ' is closed to anon and authenticated';
    assert has_function_privilege('service_role', f, 'execute') and has_function_privilege('omnikom_fn', f, 'execute'), f || ' is open to service_role and the function role';
    assert (select prosecdef from pg_proc where oid = f::regprocedure) and (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' is a definer function with an empty search_path';
    assert (select proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0) from pg_proc where oid = f::regprocedure), f || ' is not executable by PUBLIC';
  end loop;
  f := 'private.crm_url_problem(text)';
  assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('omnikom_fn', f, 'execute'), f || ' is closed to anon, authenticated and the function role';
  assert (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' pins an empty search_path';
end $$;
-- the function role really calls them
set role omnikom_fn;
do $$ begin
  perform service.mark_lead_read(test.cl('00000000-0000-0000-0000-00000000000a'), test.id('rdA1'));
  assert service.leads_exported(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e', array[test.id('rdA1')]) = 1, 'the function role exports';
  perform service.set_alerts(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e', array['fn@test.com'], true);
  perform service.set_crm_webhook(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/fn', 'crm-webhook-signing-a');
  assert (select count(*) from service.drafts_waiting(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e')) > 0, 'the function role lists the drafts';
end $$;
select test.expect_error($q$select count(*) from lead_reads$q$, 'permission denied');
reset role;

-- ===== T21 migration 13 (slice 5.2): what the Edge Functions of the four screens need and SQL alone could not give them =====
-- Written before the migration (watched red, see PROGRESS 5.2). The CRM webhook's signing secret lives in Supabase Vault, so the function
-- role needs a way to put it there and to read it for ONE signed test request, without any grant on the vault schema: five definer
-- functions, each owner-or-staff, each with the Vault name derived inside (a caller can never name a secret). Plus the lookup the invite needs.
-- The vault below is a stand-in that exists only on the local cluster (staging has the real one: the guard skips it there).
do $v$ begin
  if to_regnamespace('vault') is null then
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text not null default '', secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret, created_at, updated_at from vault.secrets;
    create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null) returns uuid language sql as
      $f$ insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id $f$;
    create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null) returns void language sql as
      $f$ update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description), updated_at = now() where id = secret_id $f$;
  end if;
end $v$;
select vault.create_secret('keep-this-value-0000000000000000000', 'zz-t21-other-secret');            -- another secret: no call below may touch it
select vault.create_secret('some-other-secret-0000000000000000000', 'crm-webhook-signing-a');          -- the name T20 stored as A's ref: it is not the derived name
create function test.crm_put(p_ws uuid, p_secret text) returns text language sql security definer as $$ select service.crm_secret_put(test.claims(), p_ws, p_secret) $$;
create function test.crm_drop(p_ws uuid) returns void language sql security definer as $$ select service.crm_secret_drop(test.claims(), p_ws) $$;
create function test.crm_target(p_ws uuid) returns table (url text, secret text) language sql security definer as $$ select * from service.crm_target(test.claims(), p_ws) $$;
create function test.crm_tested(p_ws uuid, p_outcome text, p_status int, p_host text) returns void language sql security definer as $$ select service.crm_tested(test.claims(), p_ws, p_outcome, p_status, p_host) $$;
create function test.find_login(p_ws uuid, p_email text, p_team uuid default null) returns uuid language sql security definer as $$ select service.find_login(test.claims(), p_ws, p_email, p_team) $$;
grant execute on all functions in schema test to anon, authenticated, service_role, omnikom_fn;

-- ---------- (a) the signing secret: put (create or replace) under a derived name ----------
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert test.crm_put('aaaaaaaa-0000-0000-0000-000000000000', repeat('s', 40)) = 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000', 'the name is derived from the workspace and handed back'; end $$;
reset role;
do $$ begin
  assert (select count(*) from vault.secrets where name = 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000') = 1, 'one secret under the derived name';
  assert (select decrypted_secret from vault.decrypted_secrets where name = 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000') = repeat('s', 40), 'it holds the value';
  assert (select decrypted_secret from vault.decrypted_secrets where name = 'zz-t21-other-secret') = 'keep-this-value-0000000000000000000', 'another secret is untouched';
end $$;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.crm_put('aaaaaaaa-0000-0000-0000-000000000000', repeat('t', 40));                       -- a second put replaces
select test.expect_error($q$select test.crm_put('aaaaaaaa-0000-0000-0000-000000000000', 'short')$q$, 'I-SECRET-REF');
select test.expect_error($q$select test.crm_put('aaaaaaaa-0000-0000-0000-000000000000', null)$q$, 'I-SECRET-REF');
select test.expect_error(format($q$select test.crm_put('aaaaaaaa-0000-0000-0000-000000000000', %L)$q$, repeat('x', 201)), 'I-SECRET-REF');
select test.act_as('00000000-0000-0000-0000-0000000000a1');                                         -- an agent
select test.expect_error($q$select test.crm_put('aaaaaaaa-0000-0000-0000-000000000000', repeat('a', 40))$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');                                         -- another workspace's owner
select test.expect_error($q$select test.crm_put('aaaaaaaa-0000-0000-0000-000000000000', repeat('b', 40))$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f');                                         -- staff without MFA
select test.expect_error($q$select test.crm_put('aaaaaaaa-0000-0000-0000-000000000000', repeat('c', 40))$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.expect_error($q$select test.crm_put('99999999-0000-0000-0000-000000000000', repeat('d', 40))$q$, 'S-NOT-FOUND');   -- staff may not make a secret for a workspace that does not exist
select test.crm_put('bbbbbbbb-0000-0000-0000-000000000000', repeat('u', 40));                       -- staff with MFA may, for a real one
select test.set_crm('bbbbbbbb-0000-0000-0000-000000000000', 'https://hooks.example.com/staff-b-t21', 'crm-webhook-bbbbbbbb-0000-0000-0000-000000000000');   -- B's own connection, with B's own secret
reset role;
do $$ begin
  assert (select count(*) from vault.secrets where name = 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000') = 1 and (select decrypted_secret from vault.decrypted_secrets where name = 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000') = repeat('t', 40), 'the second put replaced the value and made no second secret; every refusal above changed nothing';
  assert (select count(*) from vault.secrets where name = 'crm-webhook-99999999-0000-0000-0000-000000000000') = 0, 'no secret for a workspace that does not exist';
  assert (select decrypted_secret from vault.decrypted_secrets where name = 'crm-webhook-bbbbbbbb-0000-0000-0000-000000000000') = repeat('u', 40), 'staff with MFA made B''s secret';
  assert (select decrypted_secret from vault.decrypted_secrets where name = 'crm-webhook-signing-a') = 'some-other-secret-0000000000000000000', 'a secret that is not the derived name is untouched';
end $$;

-- ---------- (b) the target of a test request: url and secret, owner or staff, the secret pinned to the derived name ----------
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/t21', 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000');
do $$ begin
  assert (select url from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')) = 'https://hooks.example.com/t21', 'the owner gets the address';
  assert (select secret from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')) = repeat('t', 40), 'and the secret';
  assert (select count(*) from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')) = 1, 'one row: B has a connection of its own with its own secret, and none of it comes back for A';
end $$;
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/t21', 'crm-webhook-signing-a');                  -- a ref that names another Vault secret
do $$ begin assert (select count(*) from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')) = 0, 'a connection whose ref is not the derived name hands out no secret, though that secret exists'; end $$;
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/t21', 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000');
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$select * from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error($q$select * from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f');
select test.expect_error($q$select * from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select secret from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')) = repeat('t', 40), 'staff with MFA gets it too'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from test.crm_target('bbbbbbbb-0000-0000-0000-000000000000')) = 1 and (select secret from test.crm_target('bbbbbbbb-0000-0000-0000-000000000000')) = repeat('u', 40), 'B''s owner gets B''s own address and secret, and none of A''s'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', null);
do $$ begin assert (select count(*) from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')) = 0, 'no connection, no target'; end $$;
reset role;

-- ---------- (c) drop: only the derived secret, only for an owner or staff ----------
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$select test.crm_drop('aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error($q$select test.crm_drop('aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f');
select test.expect_error($q$select test.crm_drop('aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.expect_error($q$select test.crm_drop('99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
reset role;
do $$ begin assert (select count(*) from vault.secrets where name = 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000') = 1, 'every refusal left A''s secret where it was'; end $$;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.crm_drop('aaaaaaaa-0000-0000-0000-000000000000');
select test.crm_drop('aaaaaaaa-0000-0000-0000-000000000000');                                      -- dropping nothing is fine
reset role;
do $$ begin
  assert (select count(*) from vault.secrets where name = 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000') = 0, 'the owner dropped the derived secret';
  assert (select count(*) from vault.secrets where name in ('zz-t21-other-secret', 'crm-webhook-signing-a', 'crm-webhook-bbbbbbbb-0000-0000-0000-000000000000')) = 3, 'no other secret was dropped, B''s included';
end $$;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/t21b', 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000');
do $$ begin assert (select count(*) from test.crm_target('aaaaaaaa-0000-0000-0000-000000000000')) = 0, 'a connection whose secret is gone sends nothing'; end $$;
select test.set_crm('aaaaaaaa-0000-0000-0000-000000000000', null);
reset role;

-- ---------- (d) the audit row of a test request: what happened, never the address' path or query, never the secret ----------
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.crm_tested('aaaaaaaa-0000-0000-0000-000000000000', 'sent', 204, 'hooks.example.com');
select test.crm_tested('aaaaaaaa-0000-0000-0000-000000000000', 'refused', null, 'hooks.example.com/path?token=abc');
select test.crm_tested('aaaaaaaa-0000-0000-0000-000000000000', 'failed', null, repeat('h', 300));
select test.expect_error($q$select test.crm_tested('aaaaaaaa-0000-0000-0000-000000000000', 'bogus', 200, 'hooks.example.com')$q$, 'I-OUTCOME');
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$select test.crm_tested('aaaaaaaa-0000-0000-0000-000000000000', 'sent', 200, 'hooks.example.com')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error($q$select test.crm_tested('aaaaaaaa-0000-0000-0000-000000000000', 'sent', 200, 'hooks.example.com')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f');
select test.expect_error($q$select test.crm_tested('aaaaaaaa-0000-0000-0000-000000000000', 'sent', 200, 'hooks.example.com')$q$, 'S-NOT-FOUND');
reset role;
do $$ begin
  assert (select count(*) from audit_log where action = 'crm-test' and target = 'aaaaaaaa-0000-0000-0000-000000000000') = 3, 'three test requests are audited; the refused callers left nothing';
  assert (select detail from audit_log where action = 'crm-test' and detail ->> 'outcome' = 'sent') = '{"host": "hooks.example.com", "status": 204, "outcome": "sent"}'::jsonb, 'the row says what happened and to which host, nothing else';
  assert (select detail ->> 'host' from audit_log where action = 'crm-test' and detail ->> 'outcome' = 'refused') is null, 'a host that carries a path or a query is not stored';
  assert (select detail ->> 'host' from audit_log where action = 'crm-test' and detail ->> 'outcome' = 'failed') is null, 'a host longer than a host can be is not stored';
  assert (select actor from audit_log where action = 'crm-test' and detail ->> 'outcome' = 'sent') = '00000000-0000-0000-0000-00000000000a', 'and who';
end $$;

-- ---------- (e) find_login: does this email already have a login (the invite creates one only when not) ----------
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'owner-b@test') = '00000000-0000-0000-0000-00000000000b', 'an existing login is found by its email';
  assert test.find_login('aaaaaaaa-0000-0000-0000-000000000000', '  OWNER-B@Test ') = '00000000-0000-0000-0000-00000000000b', 'case and spaces do not matter';
  assert test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'nobody-here@test') is null, 'no login: null';
  assert test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'agent2-a@test', test.id('team2')) = '00000000-0000-0000-0000-0000000000a2', 'a team row of this workspace is accepted';
end $$;
select test.expect_error(format($q$select test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'x@test', %L)$q$, test.id('teamB1')), 'S-NOT-FOUND');                  -- a team row of another workspace
select test.expect_error($q$select test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'x@test', '99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error(format($q$select test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'x@test', %L)$q$, test.id('dwPage')), 'S-NOT-FOUND');                    -- a row of this workspace that is not a team row
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$select test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'owner-b@test')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error($q$select test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'owner-b@test')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f');
select test.expect_error($q$select test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'owner-b@test')$q$, 'S-NOT-FOUND');
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.expect_error($q$select test.find_login('99999999-0000-0000-0000-000000000000', 'owner-b@test')$q$, 'S-NOT-FOUND');
do $$ begin assert test.find_login('aaaaaaaa-0000-0000-0000-000000000000', 'owner-b@test') = '00000000-0000-0000-0000-00000000000b', 'staff with MFA may ask'; end $$;
reset role;

-- ---------- (f) the new functions are closed to anon, authenticated and PUBLIC, open to service_role and the function role, definer with an empty search_path ----------
do $$ declare f text; begin
  foreach f in array array['service.crm_secret_put(jsonb,uuid,text)', 'service.crm_secret_drop(jsonb,uuid)', 'service.crm_target(jsonb,uuid)', 'service.crm_tested(jsonb,uuid,text,int,text)', 'service.find_login(jsonb,uuid,text,uuid)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'), f || ' is closed to anon and authenticated';
    assert has_function_privilege('service_role', f, 'execute') and has_function_privilege('omnikom_fn', f, 'execute'), f || ' is open to service_role and the function role';
    assert (select prosecdef from pg_proc where oid = f::regprocedure) and (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' is a definer function with an empty search_path';
    assert (select proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0) from pg_proc where oid = f::regprocedure), f || ' is not executable by PUBLIC';
  end loop;
end $$;
-- the function role really calls them, and still has no grant on the vault
set role omnikom_fn;
do $$ begin
  assert service.crm_secret_put(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', repeat('f', 40)) = 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000', 'the function role puts a secret';
  perform service.set_crm_webhook(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'https://hooks.example.com/fn2', 'crm-webhook-aaaaaaaa-0000-0000-0000-000000000000');
  assert (select secret from service.crm_target(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000')) = repeat('f', 40), 'and reads it back for a test request';
  perform service.crm_tested(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'sent', 200, 'hooks.example.com');
  assert service.find_login(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 'owner-b@test') is not null, 'and looks a login up';
  perform service.crm_secret_drop(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000');
end $$;
select test.expect_error($q$select count(*) from vault.secrets$q$, 'permission denied');
select test.expect_error($q$select decrypted_secret from vault.decrypted_secrets$q$, 'permission denied');
reset role;
set role authenticated;
select test.expect_error($q$select count(*) from vault.secrets$q$, 'permission denied');
reset role;

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
      'set_workspace_state', 'open_privacy_request', 'set_privacy_request_state',
      'record_media', 'finish_media', 'row_exists', 'media_facts', 'site_for', 'row_version',
      'mark_lead_read', 'leads_exported', 'set_alerts', 'set_crm_webhook', 'drafts_waiting',
      'crm_secret_put', 'crm_secret_drop', 'crm_target', 'crm_tested', 'find_login']),
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
