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
create function test.lead_update(p_lead uuid, p_status text default null, p_owner uuid default null, p_note text default null, p_unassign boolean default false)
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
  "crm":{"lead_types":[{"key":"enquiry","label":"Enquiry"},{"key":"buy","label":"Buy a home"},{"key":"sell","label":"Sell a home"},{"key":"listing-question","label":"Question about a listing"}],
    "statuses":[{"key":"not-contacted","label":"Not contacted yet","stage":"new","needsDate":false,"needsWho":false,"needsText":false},
      {"key":"contacted","label":"Contacted","stage":"working","needsDate":false,"needsWho":true,"needsText":false},
      {"key":"qualified","label":"Qualified","stage":"working","needsDate":false,"needsWho":false,"needsText":false},
      {"key":"call-back","label":"Call back","stage":"working","needsDate":true,"needsWho":false,"needsText":false},
      {"key":"interested","label":"Interested in something specific","stage":"working","needsDate":false,"needsWho":false,"needsText":true},
      {"key":"appointment-set","label":"Appointment set","stage":"working","needsDate":true,"needsWho":true,"needsText":false},
      {"key":"closed","label":"Closed","stage":"outcome","needsDate":false,"needsWho":false,"needsText":false},
      {"key":"lost","label":"Lost","stage":"outcome","needsDate":false,"needsWho":false,"needsText":true},
      {"key":"answering-machine","label":"Answering machine","stage":"working","needsDate":false,"needsWho":true,"needsText":false}]},
  "forms":{"contact":{"fields":{"name":{"type":"text"},"email":{"type":"email"},"phone":{"type":"phone"},"topic":{"type":"text"},"message":{"type":"text","max":2000}},
      "leadTypeFrom":{"field":"topic","map":{"buy":"buy","sell":"sell","ask-about-this-home":"listing-question"}}},
    "seller":{"fields":{"name":{"type":"text"},"email":{"type":"email"}},"leadType":"sell"}},
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

-- ===== T10 storage objects: nobody signed in writes an object directly, not even into their own workspace's folder (migration 21 drops
-- media_objects_insert; uploads go through upload-start's signed URL, which Storage writes as the service role); reading is still limited to
-- the folders of workspaces you can see, and a non-uuid folder is denied, not an error =====
select test.expect_error($q$insert into storage.objects (bucket_id, name) values ('media', 'aaaaaaaa-0000-0000-0000-000000000000/x.jpg')$q$, 'row-level security');
select test.expect_error($q$insert into storage.objects (bucket_id, name) values ('media', 'not-a-uuid/x.jpg')$q$, 'row-level security');
select test.expect_error($q$insert into storage.objects (bucket_id, name) values ('media', 'bbbbbbbb-0000-0000-0000-000000000000/ok.jpg')$q$, 'row-level security');
reset role;
insert into storage.objects (bucket_id, name) values ('media', 'bbbbbbbb-0000-0000-0000-000000000000/ok.jpg'), ('media', 'aaaaaaaa-0000-0000-0000-000000000000/other.jpg');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from storage.objects) = 1 and (select count(*) from storage.objects where name like 'bbbbbbbb-%') = 1, 'B reads only its own folder''s object'; end $$;

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
-- only the fixture jobs (every id this file registered) are counted, as the change in how many of them are failed: on a database
-- that holds other jobs (staging) the reaper may fail those too, and a fixture job may be failed already (jobPin)
do $$ declare before int; begin
  select count(*) into before from publish_jobs where id in (select v from test.ids) and state = 'failed';
  perform service.reap_stale_jobs();                  -- run first, then look (one expression has no guaranteed order)
  assert (select count(*) from publish_jobs where id in (select v from test.ids) and state = 'failed') = before, 'a job that changed state recently is not reaped (N2)';
end $$;
-- now its last state change is 31 minutes old: reaped
update publish_job_events set at = now() - interval '31 minutes' where job_id = test.id('jobB');
do $$ declare before int; begin
  select count(*) into before from publish_jobs where id in (select v from test.ids) and state = 'failed';
  perform service.reap_stale_jobs();
  assert (select count(*) from publish_jobs where id in (select v from test.ids) and state = 'failed') = before + 1, 'the reaper failed exactly one stale job';
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
  assert (select count(*) from lead_events where lead_id = test.id('leadA') and kind = 'status' and detail ->> 'from' = 'not-contacted' and detail ->> 'to' = 'contacted') = 1, 'the status change wrote its event';
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
do $$ begin assert (select count(*) from api_keys where vault_ref in ('site-demo-a-key-1', 'site-demo-a-key-0')) = 2, 'staff with MFA see the registry'; end $$;
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
do $$ begin assert (select count(*) from webhook_events) = 0, 'owners never read the webhook inbox'; assert (select count(*) from connectors where id in ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002')) = 1, 'the owner sees only their connectors'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select count(*) from webhook_events where provider_event_id = 'evt-1' and connector_id = 'cccccccc-0000-0000-0000-000000000001') = 1, 'staff read the webhook inbox'; end $$;

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
  -- since migration 26 a deleted lead's consent row keeps hashes and the time (lead_id emptied): it is found by the email's hash
  assert (select count(*) from consent_ledger where lead_id is null and email_hash = encode(sha256(convert_to('w@test', 'utf8')), 'hex')) = 1, 'a manual lead has its consent row too (added by a member, then deleted: the row stays)';
  assert (select by from consent_ledger where lead_id is null and email_hash = encode(sha256(convert_to('w@test', 'utf8')), 'hex')) = '00000000-0000-0000-0000-0000000000a1', 'the manual consent row names who entered it';
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
do $$ begin assert (select count(*) from consent_ledger where lead_id is null and email_hash = encode(sha256(convert_to('c@test', 'utf8')), 'hex') and ip_hash = repeat('f', 64)) = 1, 'the consent record survives the lead''s deletion (as hashes and the time, migration 26)'; end $$;
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
  assert (select count(*) from audit_log where action = 'media-start' and workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and detail ->> 'filename' in ('front.jpg', 'a1.png', 'staff.pdf', 'edge.jpg')) = 4, 'every recorded upload is audited (media-start)';
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
  assert (select count(*) from audit_log where action = 'media-finish' and target in (select v::text from test.ids where k like 'media%')) = 4, 'every finish is audited (media-finish)';
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
      'crm_secret_put', 'crm_secret_drop', 'crm_target', 'crm_tested', 'find_login',
      'lead_set_fields', 'lead_list', 'leads_bulk',   -- work order 01: owner B on each in T22
      'crm_fields', 'import_leads',                    -- work order 02: owner B on each in T23
      'view_save', 'view_delete', 'lead_follow_up', 'task_add', 'task_done',   -- work order 18: owner B, a login of nothing and a member on each in T29
      'list_members', 'invite_context',                -- work order 08: owner B and a member in T24
      'site_audit',                                    -- work order 10: member and owner B in T24
      'start_preview',                                 -- book row B15 (migration 42): a member and owner B in T-B15
      'offboarding_storage']),                         -- work order 37b (migration 26): owner B and staff without MFA in T32e
      'service.' || t.proname || ' takes claims but has no outsider test listed in T14';
  end loop;
end $$;
-- read isolation per table, generated: B's owner and a no-membership login read 0 rows of A from every table that has workspace_id
-- (every such table holds at least one row of A first, so a policy opened to "true" is seen)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'nobody@test');
insert into integrations (workspace_id, kind, config) values ('aaaaaaaa-0000-0000-0000-000000000000', 'idx-link', '{"url":"https://idx.test"}');
insert into metrics_snapshots (workspace_id, source, day, data) values ('aaaaaaaa-0000-0000-0000-000000000000', 'uptime', '2026-11-01', '{"up":true}');
-- work order 18 (migration 22): a shared view and a task of A, so the loop below sees a policy opened to "true" on crm_views and lead_tasks (walls in T29)
insert into crm_views (workspace_id, user_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', null, 'T14 fixture view');
insert into lead_tasks (lead_id, workspace_id, text) select id, workspace_id, 'T14 fixture task' from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' order by created_at, id limit 1;
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

-- ===== T22 work order 01 (migration 14): typed capture, the one edit call, the server list, bulk =====
-- Workspace A's contract gains a real-estate form (synthetic) and its ordered leadColumns; agent one's team row is read from members.
reset role;
select test.act_as(null);
create function test.c(s text) returns jsonb language sql as $$ select json_build_object('sub', s, 'aal', 'aal1')::jsonb $$;
grant execute on function test.c(text) to anon, authenticated, service_role, omnikom_fn;
create table test.r (k text primary key, v jsonb);
grant all on test.r to anon, authenticated, service_role, omnikom_fn;
update site_contracts set resolved = jsonb_set(resolved, '{collections,areas}',
    '{"kind":"collection","access":{"member":"none"},"fields":{"name":{"type":"text","required":true},"slug":{"type":"slug","required":true}}}')
  || jsonb_build_object('forms', '{
    "contact":{"fields":{"name":{"type":"text"},"email":{"type":"email"},"phone":{"type":"phone"},"topic":{"type":"text"},"message":{"type":"text","max":2000},
      "side":{"type":"choice","options":["Buying","Selling"]},"budget":{"type":"number","min":10000,"max":50000000,"label":"Budget"},
      "timing":{"type":"enum","options":["0-3 months","3-6 months","6-12 months","just looking"]},"beds":{"type":"number","min":0,"max":10},
      "area":{"type":"reference","to":"areas"},"wants":{"type":"choice","options":["Pool","Garden"],"multi":true},
      "moveBy":{"type":"date","editable":false},"preApproved":{"type":"boolean"},"note":{"type":"text","column":false}}},
    "valuation":{"fields":{"name":{"type":"text"},"address":{"type":"text","required":true,"max":200},"timing":{"type":"enum","options":["now"]}}}}'::jsonb,
    'leadColumns', '[{"key":"topic"},{"key":"message"},{"key":"side"},{"key":"budget"},{"key":"timing"},{"key":"beds"},{"key":"area"},{"key":"wants"},
      {"key":"moveBy"},{"key":"preApproved"},{"key":"note"},{"key":"address"}]'::jsonb)
  where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and active;
insert into test.ids select 'crm_t1', team_row_id from members where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and user_id = '00000000-0000-0000-0000-0000000000a1';
do $$ begin assert test.id('crm_t1') is not null, 'T22 fixture: agent one has a team row'; end $$;
set role service_role;
insert into test.ids select 'crm_alpha', service.seed_version('aaaaaaaa-0000-0000-0000-000000000000', 'areas', '{"name":"Alpha","slug":"alpha"}', '00000000-0000-0000-0000-00000000005f', 'work order 01');
reset role;

-- (a) capture types every answer against the active contract's form; unknown keys are dropped; a bad value is refused naming the field
set role omnikom_fn;
insert into test.ids select 'c1', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Typed One', 't1@test', null,
  '{"budget":"750000","timing":"0-3 months","side":"Buying","beds":3,"area":"alpha","wants":"Pool","preApproved":"yes","moveBy":"2027-01-15","note":"call after six","junk":"dropped"}', 'I agree');
insert into test.ids select 'c2', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Typed Two', 't2@test', null, '{"budget":120000,"beds":"2"}', 'I agree');
insert into test.ids select 'cB', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'B lead', 'b9@test', null, '{}', 'I agree');
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T22 refused', 'x@test', null, '{"budget":"lots"}', 'I agree')$q$, 'I-ANSWER budget: Budget must be a number');
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T22 refused', 'x@test', null, '{"budget":5}', 'I agree')$q$, 'I-ANSWER budget: Budget must be a number from 10000 to 50000000');
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T22 refused', 'x@test', null, '{"timing":"tomorrow"}', 'I agree')$q$, 'I-ANSWER timing');
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T22 refused', 'x@test', null, '{"side":["Buying","Selling"]}', 'I agree')$q$, 'I-ANSWER side: side must be a single value');
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T22 refused', 'x@test', null, '{"wants":["Pool","Sauna"]}', 'I agree')$q$, 'I-ANSWER wants');
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T22 refused', 'x@test', null, '{"area":"gamma"}', 'I agree')$q$, 'I-ANSWER area');
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T22 refused', 'x@test', null, '{"moveBy":"2026-13-40"}', 'I agree')$q$, 'I-ANSWER moveBy');
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T22 refused', 'x@test', null, '{"preApproved":"maybe"}', 'I agree')$q$, 'I-ANSWER preApproved');
select test.expect_error($q$select service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'valuation', '/', 'T22 refused', 'x@test', null, '{"timing":"now"}', 'I agree')$q$, 'I-ANSWER address: address is needed');
insert into test.ids select 'cNope', service.capture_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'nope', '/', 'Undeclared form', 'u@test', null, '{"budget":"lots","x":"y"}', 'I agree');
reset role;
do $$ declare a jsonb := (select answers from leads where id = test.id('c1')); b jsonb := (select answers from leads where id = test.id('c2')); begin
  assert jsonb_typeof(a -> 'budget') = 'number' and (a ->> 'budget')::numeric = 750000, 'T22a a number answer is stored as a JSON number: ' || a::text;
  assert jsonb_typeof(a -> 'beds') = 'number' and jsonb_typeof(b -> 'beds') = 'number' and (b ->> 'beds')::numeric = 2, 'T22a "2" becomes the number 2';
  assert a -> 'wants' = '["Pool"]' and a -> 'preApproved' = 'true' and a ->> 'side' = 'Buying' and a ->> 'area' = 'alpha' and a ->> 'moveBy' = '2027-01-15', 'T22a choices, tick and date typed: ' || a::text;
  assert not (a ? 'junk'), 'T22a a key the form does not declare is dropped, never stored';
  assert (select answers from leads where id = test.id('cNope')) = '{}', 'T22a a form the contract does not declare: the lead is kept, every answer dropped';
  assert (select count(*) from leads where name = 'T22 refused' and workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'T22a a refused capture stores nothing';
end $$;

-- (b) the one edit call: core and industry fields, one edited event per changed field, one audit row per call, all or nothing
set role omnikom_fn;
select service.lead_update(test.c('00000000-0000-0000-0000-00000000000a'), test.id('c2'), null, test.id('crm_t1'));   -- c2 is agent one's
insert into test.r select 'e1', to_jsonb(service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('c1'), '{"name":"Typed Renamed","budget":800000,"timing":"3-6 months"}'));
insert into test.r select 'e2', to_jsonb(service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('c1'), '{"name":"Typed Renamed","budget":"800000","timing":"3-6 months"}'));
insert into test.r select 'e3', to_jsonb(service.lead_set_fields(test.c('00000000-0000-0000-0000-0000000000a1'), test.id('c2'), '{"beds":4,"status":"contacted"}'));
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-0000000000a1'), %L, '{"budget":900000}')$q$, test.id('c1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-0000000000a1'), %L, '{"owner":null}')$q$, test.id('c2')), 'S-OWN-ONLY');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000b'), %L, '{"name":"B was here"}')$q$, test.id('c1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"consent_text":"I agree to everything"}')$q$, test.id('c1')), 'S-CONSENT');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"smsConsent":true}')$q$, test.id('c1')), 'S-CONSENT');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"moveBy":"2027-02-01"}')$q$, test.id('c1')), 'S-LOCKED');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"name":"Should Not Stick","budget":"lots"}')$q$, test.id('c1')), 'I-ANSWER budget');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"beds":11}')$q$, test.id('c1')), 'I-ANSWER beds');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"area":"gamma"}')$q$, test.id('c1')), 'I-ANSWER area');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"status":"bogus"}')$q$, test.id('c1')), 'I-ANSWER status');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"junk":1}')$q$, test.id('c1')), 'I-UNKNOWN');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"form":"other"}')$q$, test.id('c1')), 'I-UNKNOWN');
insert into test.r select 'e4', to_jsonb(service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('c1'), '{"note":null}'));
reset role;
do $$ declare ev jsonb; l leads; begin
  select * into l from leads where id = test.id('c1');
  assert (select v from test.r where k = 'e1') = '3' and (select v from test.r where k = 'e2') = '0', 'T22b three changed fields, then none';
  assert (select count(*) from lead_events where lead_id = l.id and kind = 'edited') = 4, 'T22b one edited event per changed field (3 + the cleared note), none for an unchanged value';
  select detail into ev from lead_events where lead_id = l.id and kind = 'edited' and detail ->> 'field' = 'budget';
  assert ev = '{"field":"budget","old":750000,"new":800000}', 'T22b the event says field, old and new: ' || coalesce(ev::text, 'none');
  assert (select count(*) from audit_log where action = 'lead-edit' and target = l.id::text) = 3, 'T22b one audit row per call (refused calls write none)';
  assert l.name = 'Typed Renamed' and l.answers -> 'budget' = '800000' and l.answers ->> 'timing' = '3-6 months' and not (l.answers ? 'note'), 'T22b the lead holds the edits, typed; a refused call changed nothing: ' || l.answers::text;
  assert l.consent_text = 'I agree' and l.answers ->> 'moveBy' = '2027-01-15', 'T22b consent and a non-editable field are unchanged';
  assert (select v from test.r where k = 'e3') = '2' and (select status from leads where id = test.id('c2')) = 'contacted'
    and (select answers -> 'beds' from leads where id = test.id('c2')) = '4', 'T22b a member edits its own lead (an industry field and the status)';
end $$;

-- (c) the server list: a 200-lead seed (budgets whose text order differs from their number order), the caller's leads only
insert into leads (workspace_id, site_id, form, page_path, name, email, answers, consent_text, owner_team_row, created_at)
select 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Seed ' || i, 'seed' || i || '@test',
  jsonb_build_object('budget', 10000 + ((i * 7919) % 997) * 1000, 'timing', (array['0-3 months','3-6 months','6-12 months','just looking'])[1 + i % 4])
    || case when i % 2 = 0 then '{"area":"alpha"}'::jsonb else '{}'::jsonb end,
  'seeded', case when i % 5 = 0 then test.id('crm_t1') end, now() - make_interval(secs => i)
from generate_series(1, 200) i;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
insert into test.r select 'rls_a1', coalesce(jsonb_agg(to_jsonb(id::text) order by id::text), '[]') from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000';
select test.act_as('00000000-0000-0000-0000-00000000000a');
insert into test.r select 'rls_owner', to_jsonb(count(*)) from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000';
select test.act_as('00000000-0000-0000-0000-00000000000b');
insert into test.r select 'rls_b', to_jsonb(count(*)) from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000';
select test.act_as(null);
reset role;
set role omnikom_fn;
insert into test.r select 'l_asc', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"sort":{"field":"budget","dir":"asc"},"size":200}');
insert into test.r select 'l_desc2', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"sort":{"field":"budget","dir":"desc"},"size":50,"page":2}');
insert into test.r select 'l_a1', service.lead_list(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"size":200}');
insert into test.r select 'l_b', service.lead_list(test.c('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"size":200}');
insert into test.r select 'f_timing', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"timing","op":"eq","value":"0-3 MONTHS"}]}');
insert into test.r select 'f_range', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"budget","op":"range","from":100000,"to":300000}],"size":200}');
insert into test.r select 'f_empty', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"area","op":"empty"}],"size":1}');
insert into test.r select 'f_in', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"side","op":"in","values":["Buying"]},{"field":"moveBy","op":"range","from":"2027-01-01","to":"2027-12-31"}]}');
insert into test.r select 's_name', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"seed 17"}');
insert into test.r select 's_answer', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"3-6 MONTHS","filters":[{"field":"owner","op":"not_empty"}],"size":200}');
select test.expect_error($q$select service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"sort":{"field":"junk"}}')$q$, 'S-QUERY');
select test.expect_error($q$select service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"sort":{"field":"budget); drop table leads; --"}}')$q$, 'S-QUERY');
select test.expect_error($q$select service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"note","op":"eq","value":"x"}]}')$q$, 'S-QUERY');
select test.expect_error($q$select service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"timing","op":"range","from":1}]}')$q$, 'S-QUERY');
select test.expect_error($q$select service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"name","op":"like","value":"%"}]}')$q$, 'S-QUERY');
select test.expect_error($q$select service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"size":201}')$q$, 'S-QUERY');
reset role;
do $$ declare r jsonb := (select v from test.r where k = 'l_asc'); want jsonb; got jsonb; prev numeric; cur numeric; nulls boolean := false; i int; cnt int;
begin
  -- lead by lead: the page equals the leads of A in number order (empty last, then newest first), and each budget is >= the one before
  select jsonb_agg(to_jsonb(x.id) order by x.o) into want from (select id, row_number() over (order by
      case when jsonb_typeof(answers -> 'budget') = 'number' then (answers ->> 'budget')::numeric end asc nulls last, created_at desc, id desc) o
    from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') x where x.o <= 200;
  select jsonb_agg(e -> 'id' order by n) into got from jsonb_array_elements(r -> 'rows') with ordinality t(e, n);
  assert got = want, 'T22c the budget sort is the number order, lead by lead';
  assert jsonb_array_length(r -> 'rows') = 200 and (r ->> 'total')::int = (select v from test.r where k = 'rls_owner')::text::int, 'T22c a page of 200; total = what the owner reads under RLS';
  for i in 0 .. jsonb_array_length(r -> 'rows') - 1 loop
    cur := case when jsonb_typeof(r -> 'rows' -> i -> 'budget') = 'number' then (r -> 'rows' -> i ->> 'budget')::numeric end;
    if cur is null then nulls := true; else
      assert not nulls, 'T22c an empty budget sorts last';
      assert prev is null or cur >= prev, format('T22c lead %s: budget %s after %s is out of number order', i, cur, prev);
      prev := cur;
    end if;
  end loop;
  assert (select string_agg(e ->> 'key', ',' order by n) from jsonb_array_elements(r -> 'columns') with ordinality t(e, n))
    = 'topic,message,side,budget,timing,beds,area,wants,moveBy,preApproved,address', 'T22c the columns are an array in contract form order (note is not a column): ' || (r -> 'columns')::text;
  assert (select string_agg(e ->> 'key', ',' order by n) from jsonb_array_elements(r -> 'fields') with ordinality t(e, n))
    = 'topic,message,side,budget,timing,beds,area,wants,moveBy,preApproved,note,address', 'T22c fields (for the export) lists every industry field in form order: ' || (r -> 'fields')::text;
  assert (select e ->> 'type' from jsonb_array_elements(r -> 'columns') e where e ->> 'key' = 'budget') = 'number'
    and (select e -> 'options' from jsonb_array_elements(r -> 'columns') e where e ->> 'key' = 'timing') = '["0-3 months","3-6 months","6-12 months","just looking","now"]', 'T22c a column carries its type and every form''s options';
  assert (select jsonb_typeof(e -> 'budget') from jsonb_array_elements(r -> 'rows') e where e ->> 'id' = test.id('c1')::text) = 'number'
    and not exists (select 1 from jsonb_array_elements(r -> 'rows') e where e ? 'note' or e ? 'answers'), 'T22c a row has each column under its own key, typed; no answers blob, no non-column field';
  r := (select v from test.r where k = 'l_desc2');
  select jsonb_agg(to_jsonb(x.id) order by x.o) into want from (select id, row_number() over (order by
      case when jsonb_typeof(answers -> 'budget') = 'number' then (answers ->> 'budget')::numeric end desc nulls last, created_at desc, id desc) o
    from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') x where x.o between 51 and 100;
  assert (select jsonb_agg(e -> 'id' order by n) from jsonb_array_elements(r -> 'rows') with ordinality t(e, n)) = want, 'T22c page 2 of the descending sort';
  -- RLS proof: the member's list is exactly what RLS shows that member; another workspace's owner gets nothing, as RLS does
  r := (select v from test.r where k = 'l_a1');
  assert (select coalesce(jsonb_agg(e -> 'id' order by e ->> 'id'), '[]') from jsonb_array_elements(r -> 'rows') e) = (select v from test.r where k = 'rls_a1')
    and (r ->> 'total')::int = jsonb_array_length((select v from test.r where k = 'rls_a1')) and (r ->> 'total')::int >= 41, 'T22c a member lists exactly its own leads (RLS set)';
  r := (select v from test.r where k = 'l_b');
  assert (r ->> 'total')::int = 0 and r -> 'rows' = '[]' and r -> 'columns' = '[]' and (select v from test.r where k = 'rls_b') = '0', 'T22c another workspace''s list is empty, field names included';
  select count(*) into cnt from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and lower(answers ->> 'timing') = '0-3 months';
  assert ((select v from test.r where k = 'f_timing') ->> 'total')::int = cnt and cnt > 40, 'T22c filter eq on a select (case-insensitive)';
  select count(*) into cnt from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and jsonb_typeof(answers -> 'budget') = 'number' and (answers ->> 'budget')::numeric between 100000 and 300000;
  assert ((select v from test.r where k = 'f_range') ->> 'total')::int = cnt and cnt > 10, 'T22c filter range on a number';
  select count(*) into cnt from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and coalesce(answers ->> 'area', '') = '';
  assert ((select v from test.r where k = 'f_empty') ->> 'total')::int = cnt and jsonb_array_length((select v from test.r where k = 'f_empty') -> 'rows') = 1, 'T22c filter empty, page size 1';
  assert ((select v from test.r where k = 'f_in') ->> 'total')::int = 1 and (select v from test.r where k = 'f_in') -> 'rows' -> 0 ->> 'id' = test.id('c1')::text, 'T22c filter in on a choice and a date range';
  assert ((select v from test.r where k = 's_name') ->> 'total')::int = 11, 'T22c search finds Seed 17 and Seed 170-179';
  select count(*) into cnt from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and owner_team_row is not null and answers ->> 'timing' = '3-6 months';
  assert ((select v from test.r where k = 's_answer') ->> 'total')::int = cnt and cnt > 5, 'T22c search reads industry values, combined with a filter on the owner';
end $$;
-- timing on the seed (the written reason for no per-key index is the 20k run in crm-scale.sql)
do $$ declare t0 timestamptz := clock_timestamp(); begin
  perform service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"sort":{"field":"budget","dir":"asc"},"size":200}');
  raise warning 'T22 timing: lead_list sort budget over % leads: % ms', (select count(*) from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000'),
    round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
end $$;

-- (d) bulk: all or nothing, owner-only owner and delete, delete needs the confirm flag and writes one audit row per lead
set role omnikom_fn;
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L, %L]::uuid[], 'status', 'qualified')$q$, test.id('c2'), test.id('c1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L, %L, %L]::uuid[], 'status', 'qualified')$q$, test.id('c1'), test.id('c2'), test.id('cB')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L]::uuid[], 'status', 'qualified')$q$, test.id('c1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L]::uuid[], 'owner', null)$q$, test.id('c2')), 'S-OWN-ONLY');
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L]::uuid[], 'delete', null, true)$q$, test.id('c2')), 'S-OWN-ONLY');
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L]::uuid[], 'status', 'bogus')$q$, test.id('c1')), 'I-ANSWER status');
select test.expect_error($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select array_agg(gen_random_uuid()) from generate_series(1, 501)), 'status', 'new')$q$, 'S-QUERY');
insert into test.r select 'b1', to_jsonb(service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[test.id('c1'), test.id('c2')], 'status', 'qualified'));
insert into test.r select 'b2', to_jsonb(service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[test.id('c1')], 'owner', test.id('crm_t1')::text));
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L, %L]::uuid[], 'delete')$q$, test.id('c1'), test.id('c2')), 'S-CONFIRM');
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L, %L]::uuid[], 'delete', null, false)$q$, test.id('c1'), test.id('c2')), 'S-CONFIRM');
reset role;
do $$ begin
  assert (select status from leads where id = test.id('cB')) = 'not-contacted', 'T22d a refused bulk call wrote nothing to the foreign lead (a partial write to c1 or c2 would make b1 below count less than 2)';
  assert (select v from test.r where k = 'b1') = '2' and (select count(*) from leads where id in (test.id('c1'), test.id('c2')) and status = 'qualified') = 2, 'T22d bulk status';
  assert (select count(*) from lead_events where lead_id in (test.id('c1'), test.id('c2')) and kind = 'status' and detail ->> 'to' = 'qualified') = 2, 'T22d one status event per lead';
  assert (select count(*) from audit_log where action = 'leads-bulk') = 2, 'T22d one audit row per bulk call';
  assert (select v from test.r where k = 'b2') = '1' and (select owner_team_row from leads where id = test.id('c1')) = test.id('crm_t1'), 'T22d bulk owner by the owner';
  assert (select count(*) from leads where id in (test.id('c1'), test.id('c2'))) = 2, 'T22d a delete without the confirm flag deletes nothing';
end $$;
set role omnikom_fn;
insert into test.r select 'b3', to_jsonb(service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[test.id('c1'), test.id('c2')], 'delete', null, true));
reset role;
do $$ begin
  assert (select v from test.r where k = 'b3') = '2' and (select count(*) from leads where id in (test.id('c1'), test.id('c2'))) = 0, 'T22d confirmed bulk delete is a hard delete';
  assert (select count(*) from audit_log where action = 'lead-delete' and target in (test.id('c1')::text, test.id('c2')::text)) = 2, 'T22d one audit row per deleted lead';
  -- since migration 26 the delete (through service.delete_lead since work order 20) keeps each consent row as hashes and the time
  assert (select count(*) from consent_ledger where lead_id is null and email_hash in (encode(sha256(convert_to('t1@test', 'utf8')), 'hex'), encode(sha256(convert_to('t2@test', 'utf8')), 'hex'))) = 2, 'T22d the consent ledger keeps its rows (as hashes, migration 26)';
end $$;

-- (e) the new functions: closed to anon, authenticated and PUBLIC, open to the function role, definer with an empty search_path
do $$ declare f text; begin
  foreach f in array array['service.lead_set_fields(jsonb,uuid,jsonb)', 'service.lead_list(jsonb,uuid,jsonb)', 'service.leads_bulk(jsonb,uuid,uuid[],text,text,boolean)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not exists (select 1 from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) a where a.grantee = 0), f || ' is closed to anon, authenticated and PUBLIC';
    assert has_function_privilege('omnikom_fn', f, 'execute'), f || ' is open to the function role';
    assert (select prosecdef from pg_proc where oid = f::regprocedure) and (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' is a definer function with an empty search_path';
  end loop;
end $$;

-- ===== T23 work order 02 (migration 15): the map's fields, the map, the import, add_lead typed =====
-- Workspace A keeps T22's real-estate forms (budget a number from 10000 to 50000000, timing a select) and its 200 seed leads (seed<i>@test).
-- Synthetic rows only. Agent one (team1, crm_t1) is "Agent One".
reset role;
insert into test.r select 't1name', to_jsonb(v.data ->> 'name') from content_versions v where v.row_id = test.id('crm_t1') order by v.n desc limit 1;
do $$ begin assert (select v #>> '{}' from test.r where k = 't1name') = 'Agent One', 'T23 fixture: agent one is named Agent One'; end $$;
set role omnikom_fn;
-- (a) crm_fields: the owner gets the industry fields in form order; a member is refused; another workspace's owner is not found
insert into test.r select 'cf', service.crm_fields(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000');
select test.expect_error($q$select service.crm_fields(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-OWN-ONLY');
select test.expect_error($q$select service.crm_fields(test.c('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
-- (b) the map: owner is a field; every industry field must be on the forms; a re-save of a name is the same row; a member and B are refused
insert into test.r select 'tplA', to_jsonb(service.save_crm_template(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'HubSpot T23', 'hubspot', 'both',
  '[{"header":"First Name","field":"name","transform":"first"},{"header":"Last Name","field":"name","transform":"last"},{"header":"Email","field":"email"},
    {"header":"Phone Number","field":"phone","transform":"e164"},{"header":"Budget","field":"answers.budget"},{"header":"Timing","field":"answers.timing"},{"header":"Contact owner","field":"owner"}]', '{}'));
insert into test.r select 'tplA2', to_jsonb(service.save_crm_template(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'HubSpot T23', 'hubspot', 'both',
  '[{"header":"Email","field":"email"},{"header":"Budget","field":"answers.budget"}]', '{}'));
insert into test.r select 'tplTopic', to_jsonb(service.save_crm_template(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'Topic T23', 'custom', 'import',
  '[{"header":"Email","field":"email"},{"header":"Topic","field":"answers.topic"}]', '{}'));
select test.expect_error($q$select service.save_crm_template(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'Pool T23', 'custom', 'both', '[{"header":"Email","field":"email"},{"header":"Pool size","field":"answers.poolSize"}]', '{}')$q$, 'T-FIELD poolSize');
select test.expect_error($q$select service.save_crm_template(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'Member T23', 'custom', 'both', '[{"header":"Email","field":"email"}]', '{}')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.save_crm_template(test.c('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'B T23', 'custom', 'both', '[{"header":"Email","field":"email"}]', '{}')$q$, 'S-NOT-FOUND');
insert into test.r select 'tplB', to_jsonb(service.save_crm_template(test.c('00000000-0000-0000-0000-00000000000b'), 'bbbbbbbb-0000-0000-0000-000000000000', null, 'B own T23', 'custom', 'both', '[{"header":"Email","field":"email"}]', '{}'));
reset role;
do $$ declare cf jsonb := (select v from test.r where k = 'cf'); begin
  assert (select string_agg(e ->> 'key', ',' order by n) from jsonb_array_elements(cf) with ordinality t(e, n))
    = 'topic,message,side,budget,timing,beds,area,wants,moveBy,preApproved,note,address', 'T23a crm_fields lists every industry field in form order: ' || cf::text;
  assert (select e ->> 'label' from jsonb_array_elements(cf) e where e ->> 'key' = 'budget') = 'Budget' and (select e ->> 'type' from jsonb_array_elements(cf) e where e ->> 'key' = 'budget') = 'number', 'T23a a field carries its label and type';
  assert (select v from test.r where k = 'tplA') = (select v from test.r where k = 'tplA2'), 'T23b a re-save of the same name is the same row';
  assert (select jsonb_array_length(columns) from crm_templates where id = (select v #>> '{}' from test.r where k = 'tplA')::uuid) = 2
    and (select count(*) from crm_templates where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = 'HubSpot T23') = 1, 'T23b the re-save updated the one row';
  assert (select count(*) from crm_templates where name in ('Pool T23', 'Member T23', 'B T23')) = 0, 'T23b refused maps are not stored';
end $$;
set role omnikom_fn;
select service.save_crm_template(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'HubSpot T23', 'hubspot', 'both',
  '[{"header":"First Name","field":"name","transform":"first"},{"header":"Last Name","field":"name","transform":"last"},{"header":"Email","field":"email"},
    {"header":"Phone Number","field":"phone","transform":"e164"},{"header":"Budget","field":"answers.budget"},{"header":"Timing","field":"answers.timing"},{"header":"Contact owner","field":"owner"}]', '{}');

-- (c) the import. Seven rows as importRows makes them: line 2 has a seed lead's email (any case), line 4 repeats line 3's email, line 6 line 3's phone in
-- another form, line 5 a bad budget, line 7 a key the forms do not have, line 8 an owner who is not on the team.
reset role;
insert into leads (workspace_id, site_id, form, page_path, name, email, consent_text) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'Have T23', 'have.t23@t23.test', 'I agree');
set role omnikom_fn;
insert into test.r select 'rows', jsonb_build_array(
  jsonb_build_object('line', 2, 'name', 'Imp One', 'email', 'HAVE.T23@t23.test'),
  jsonb_build_object('line', 3, 'name', 'Imp Two', 'email', 'imp2@t23.test', 'phone', '(510) 555-0102', 'answers', jsonb_build_object('budget', '250000', 'timing', '0-3 months'),
    'owner', (select upper(v #>> '{}') from test.r where k = 't1name'), 'status', 'Qualified'),
  jsonb_build_object('line', 4, 'name', 'Imp Three', 'email', 'IMP2@t23.test'),
  jsonb_build_object('line', 5, 'name', 'Imp Bad', 'answers', jsonb_build_object('budget', 'lots')),
  jsonb_build_object('line', 6, 'name', 'Imp Four', 'phone', '+1 510 555 0102'),
  jsonb_build_object('line', 7, 'name', 'Imp Five', 'answers', jsonb_build_object('junk', 'x')),
  jsonb_build_object('line', 8, 'email', 'imp6@t23.test', 'owner', 'Nobody Here'));
insert into test.r select 'dry', service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select v #>> '{}' from test.r where k = 'tplA')::uuid,
  (select v from test.r where k = 'rows'), '{}');
insert into test.r select 'dry2', service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select v #>> '{}' from test.r where k = 'tplA')::uuid,
  (select v from test.r where k = 'rows'), '{"dry_run":"no","duplicates":"add","consent":true,"file_name":"t23.csv","file_sha256":"0000000000000000000000000000000000000000000000000000000000000000"}');
insert into test.r select 'dryS', service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select v #>> '{}' from test.r where k = 'tplA')::uuid,
  '[{"line":2,"name":"Imp Hot","status":"Hot"},{"line":3,"answers":{"budget":20000}}]', '{}');
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, '[{"name":"x"}]', '{"dry_run":false,"duplicates":"skip","file_name":"t23.csv","file_sha256":"%s"}')$q$,
  (select v #>> '{}' from test.r where k = 'tplA'), repeat('a', 64)), 'I-CONSENT');
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, '[{"name":"x"}]', '{"dry_run":false,"consent":"yes","duplicates":"skip","file_name":"t23.csv","file_sha256":"%s"}')$q$,
  (select v #>> '{}' from test.r where k = 'tplA'), repeat('a', 64)), 'I-CONSENT');
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, '[{"name":"x"}]', '{"dry_run":false,"consent":true,"file_name":"t23.csv","file_sha256":"%s"}')$q$,
  (select v #>> '{}' from test.r where k = 'tplA'), repeat('a', 64)), 'I-DUPLICATES');
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, %L, '{"dry_run":false,"consent":true,"duplicates":"skip","file_name":"t23.csv","file_sha256":"%s"}')$q$,
  (select v #>> '{}' from test.r where k = 'tplA'), (select v from test.r where k = 'rows'), repeat('a', 64)), 'I-IMPORT line 5 budget: Budget must be a number');
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, '[{"name":"x"}]', '{}')$q$, (select v #>> '{}' from test.r where k = 'tplA')), 'S-OWN-ONLY');
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, '[{"name":"x"}]', '{}')$q$, (select v #>> '{}' from test.r where k = 'tplA')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'bbbbbbbb-0000-0000-0000-000000000000', %L, '[{"name":"x"}]', '{}')$q$, (select v #>> '{}' from test.r where k = 'tplB')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, '[{"name":"x"}]', '{}')$q$, (select v #>> '{}' from test.r where k = 'tplB')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, (select jsonb_agg(jsonb_build_object('name', 'x')) from generate_series(1, 5001)), '{}')$q$, (select v #>> '{}' from test.r where k = 'tplA')), 'I-ROWS');
reset role;
do $$ declare d jsonb := (select v from test.r where k = 'dry'); s jsonb; begin
  assert d ->> 'dry_run' = 'true' and (d ->> 'rows')::int = 7 and (d ->> 'valid')::int = 5 and (d ->> 'refused_count')::int = 2 and (d ->> 'new')::int = 2, 'T23c the dry run counts: ' || d::text;
  assert d -> 'refused' = '[{"line":5,"field":"budget","reason":"Budget must be a number"},{"line":7,"field":"junk","reason":"this business has no such field"}]', 'T23c refused rows name the line, the field and the reason: ' || (d -> 'refused')::text;
  assert d -> 'duplicates' = '[{"by":"email","line":2,"with":"a lead you already have"},{"by":"email","line":4,"with":"line 3"},{"by":"phone","line":6,"with":"line 3"}]',
    'T23c duplicates: email against the workspace (any case), email and E.164 phone within the file: ' || (d -> 'duplicates')::text;
  assert d -> 'warnings' = '[{"line":8,"field":"owner","reason":"not a team member of this business; the lead goes to you"}]', 'T23c an owner not on the team is a warning: ' || (d -> 'warnings')::text;
  select e into s from jsonb_array_elements(d -> 'sample') e where (e ->> 'line')::int = 3;
  assert jsonb_array_length(d -> 'sample') = 5 and jsonb_typeof(s -> 'answers' -> 'budget') = 'number' and (s -> 'answers' ->> 'budget')::numeric = 250000
    and s ->> 'owner' = test.id('crm_t1')::text and s ->> 'status' = 'qualified' and s ->> 'duplicate' = 'false', 'T23c the sample is the rows as stored: typed, owner by name (any case), status read: ' || s::text;
  assert (select v ->> 'dry_run' from test.r where k = 'dry2') = 'true', 'T23c only dry_run false is a real run';
  assert (select v -> 'refused' from test.r where k = 'dryS') = '[{"line":2,"field":"status","reason":"Status must be one of this business''s statuses"},{"line":3,"field":"name","reason":"a lead needs a name, an email or a phone"}]',
    'T23c a status that is not ours and a lead with no name, email or phone are refused: ' || (select v -> 'refused' from test.r where k = 'dryS')::text;
  assert (select count(*) from leads where form = 'import') = 0 and (select count(*) from audit_log where action = 'lead-import') = 0
    and (select count(*) from consent_ledger where form = 'import') = 0, 'T23c a dry run and every refused real run write nothing';
end $$;
-- an import goes on the workspace's oldest site (work order 02 F4). Both sites of A were made in this transaction (the same created_at), so the
-- second is made older: the choice is then the created_at alone, also when `omnikom test walls` gives the ids new random values
update sites set created_at = created_at - interval '1 day' where id = 'aaaaaaaa-0000-0000-0000-0000000052e2';
set role omnikom_fn;
insert into test.r select 'real', service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select v #>> '{}' from test.r where k = 'tplA')::uuid,
  (select jsonb_agg(e) from jsonb_array_elements((select v from test.r where k = 'rows')) e where (e ->> 'line')::int not in (5, 7)),
  ('{"dry_run":false,"duplicates":"skip","consent":true,"file_name":"t23 \"leads\".csv","file_sha256":"' || repeat('b', 64) || '"}')::jsonb);
insert into test.r select 'add', service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select v #>> '{}' from test.r where k = 'tplA')::uuid,
  '[{"line":2,"name":"Have Again","email":"have.t23@t23.test"}]', ('{"dry_run":false,"duplicates":"add","consent":true,"file_name":"t23-add.csv","file_sha256":"' || repeat('c', 64) || '"}')::jsonb);
reset role;
do $$ declare r jsonb := (select v from test.r where k = 'real'); l leads; begin
  assert r = '{"dry_run":false,"rows":5,"created":2,"skipped":3}', 'T23c the real run: two created, three duplicates skipped: ' || r::text;
  select * into l from leads where email = 'imp2@t23.test';
  assert l.form = 'import' and l.page_path = 'import' and l.status = 'qualified' and l.owner_team_row = test.id('crm_t1')
    and jsonb_typeof(l.answers -> 'budget') = 'number' and l.answers ->> 'timing' = '0-3 months', 'T23c an imported lead: form import, typed, owned by the named member';
  assert l.site_id = 'aaaaaaaa-0000-0000-0000-0000000052e2', 'T23c an imported lead goes on the oldest site of the workspace: ' || l.site_id::text;
  assert l.consent_text = format('These people agreed to be contacted by my business. Ticked by the owner on %s for the import of the file "t23 leads.csv".', to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
    and l.sms_consent = false and l.marketing_consent = '{"given":false}', 'T23c the consent sentence, the date and the file''s name; marketing and SMS consent false: ' || l.consent_text;
  assert (select owner_team_row from leads where email = 'imp6@t23.test') is not distinct from (select team_row_id from members where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and user_id = '00000000-0000-0000-0000-00000000000a'),
    'T23c an unknown owner name: the lead goes to the importing owner';
  assert (select count(*) from leads where name in ('Imp One', 'Imp Three', 'Imp Four')) = 0, 'T23c skip: no duplicate was created';
  assert (select count(*) from lead_events e join leads x on x.id = e.lead_id where x.form = 'import' and e.kind = 'received' and e.detail ->> 'import' = 'true') = 3, 'T23c one received event per imported lead';
  assert (select count(*) from consent_ledger c join leads x on x.id = c.lead_id where x.form = 'import' and c.consent_text = x.consent_text) = 3, 'T23c one consent ledger row per imported lead';
  assert (select count(*) from audit_log where action = 'lead-import') = 2 and (select detail from audit_log where action = 'lead-import' and detail ->> 'file_sha256' = repeat('b', 64))
    = jsonb_build_object('file_sha256', repeat('b', 64), 'rows', 5, 'created', 2, 'skipped', 3, 'duplicates', 3), 'T23c one audit row per call, with the file''s sha256 and the counts';
  assert (select v from test.r where k = 'add') ->> 'created' = '1' and (select count(*) from leads where lower(email) = 'have.t23@t23.test') = 2, 'T23c add: a duplicate is created when asked';
end $$;
-- the map names a field the forms no longer have (the contract changed after the map was saved): the import is refused whole
update site_contracts set resolved = jsonb_set(resolved, '{forms,contact,fields}', (resolved -> 'forms' -> 'contact' -> 'fields') - 'topic')
  where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and active;
set role omnikom_fn;
select test.expect_error(format($q$select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', %L, '[{"email":"t@t23.test"}]', '{}')$q$, (select v #>> '{}' from test.r where k = 'tplTopic')), 'T-FIELD topic');

-- (d) add_lead types its answers against every industry field (work order 01 finding F3): typed, an unknown key dropped, a bad value refused
insert into test.ids select 'mT', service.add_lead(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e', 'Manual Typed', 'mt@test', null, '{"budget":"300000","beds":"2","junk":"x"}', 'Agreed on the phone');
select test.expect_error($q$select service.add_lead(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e', 'Manual Bad', 'mb@test', null, '{"budget":"lots"}', 'Agreed on the phone')$q$, 'I-ANSWER budget: Budget must be a number');
select test.expect_error($q$select service.add_lead(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e', 'Manual Bad', 'mb@test', null, '{"area":"gamma"}', 'Agreed on the phone')$q$, 'I-ANSWER area');
reset role;
do $$ begin
  assert (select answers from leads where id = test.id('mT')) = '{"beds":2,"budget":300000}', 'T23d a manual lead''s answers are typed, an unknown key dropped: ' || (select answers from leads where id = test.id('mT'))::text;
  assert (select count(*) from leads where name = 'Manual Bad') = 0, 'T23d a refused manual lead stores nothing';
end $$;

-- (e) the new and replaced functions: closed to anon, authenticated and PUBLIC, open to the function role, definer with an empty search_path
do $$ declare f text; begin
  foreach f in array array['service.crm_fields(jsonb,uuid)', 'service.import_leads(jsonb,uuid,uuid,jsonb,jsonb)', 'service.add_lead(jsonb,uuid,text,text,text,jsonb,text,text,uuid)',
      'service.save_crm_template(jsonb,uuid,uuid,text,text,text,jsonb,jsonb)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not exists (select 1 from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) a where a.grantee = 0), f || ' is closed to anon, authenticated and PUBLIC';
    assert has_function_privilege('omnikom_fn', f, 'execute'), f || ' is open to the function role';
    assert (select prosecdef from pg_proc where oid = f::regprocedure) and (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' is a definer function with an empty search_path';
  end loop;
end $$;

-- ===== T24 work order 07 (migration 18): the site switcher is a lead_list filter =====
-- (a) a site filter returns only that site's leads; (b) a site of another workspace returns none
-- (the leads are inserted directly: capture_lead is refused by the workspace's hourly lead limit after the scale tests above)
with n as (insert into leads (workspace_id, site_id, form, page_path, name, email, consent_text) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T24 on A', 't24a@test', 'I agree') returning id) insert into test.ids select 'sA', id from n;
with n as (insert into leads (workspace_id, site_id, form, page_path, name, email, consent_text) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000052e2', 'contact', '/', 'T24 on A2', 't24a2@test', 'I agree') returning id) insert into test.ids select 'sA2', id from n;
with n as (insert into leads (workspace_id, site_id, form, page_path, name, email, consent_text) values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'T24 on B', 't24b@test', 'I agree') returning id) insert into test.ids select 'sB', id from n;
insert into test.r select 'st_a2', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"site","op":"eq","value":"aaaaaaaa-0000-0000-0000-0000000052e2"}],"size":200}');
insert into test.r select 'st_a', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"site","op":"eq","value":"aaaaaaaa-0000-0000-0000-00000000517e"}],"size":200}');
insert into test.r select 'st_in', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"site","op":"in","values":["aaaaaaaa-0000-0000-0000-0000000052e2","bbbbbbbb-0000-0000-0000-00000000517e"]}],"size":200}');
insert into test.r select 'st_other', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"site","op":"eq","value":"bbbbbbbb-0000-0000-0000-00000000517e"}],"size":200}');
insert into test.r select 'st_b', service.lead_list(test.c('00000000-0000-0000-0000-00000000000b'), 'bbbbbbbb-0000-0000-0000-000000000000', '{"filters":[{"field":"site","op":"eq","value":"bbbbbbbb-0000-0000-0000-00000000517e"}],"size":200}');
insert into test.r select 'st_b_a', service.lead_list(test.c('00000000-0000-0000-0000-00000000000b'), 'bbbbbbbb-0000-0000-0000-000000000000', '{"filters":[{"field":"site","op":"eq","value":"aaaaaaaa-0000-0000-0000-0000000052e2"}],"size":200}');
insert into test.r select 'st_sort', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"sort":{"field":"site","dir":"asc"},"size":200}');
do $$
declare a2 jsonb := (select v from test.r where k = 'st_a2'); a jsonb := (select v from test.r where k = 'st_a' limit 1); i jsonb := (select v from test.r where k = 'st_in');
  o jsonb := (select v from test.r where k = 'st_other'); b jsonb := (select v from test.r where k = 'st_b'); ba jsonb := (select v from test.r where k = 'st_b_a'); s jsonb := (select v from test.r where k = 'st_sort');
begin
  assert (a2 ->> 'total')::int >= 2 and (a2 ->> 'total')::int = (select count(*) from leads where site_id = 'aaaaaaaa-0000-0000-0000-0000000052e2'),
    'T24a the second site''s filter counts exactly its leads: ' || (a2 ->> 'total');
  assert jsonb_array_length(a2 -> 'rows') = (a2 ->> 'total')::int and not exists (select 1 from jsonb_array_elements(a2 -> 'rows') x where x ->> 'site' is distinct from 'aaaaaaaa-0000-0000-0000-0000000052e2'),
    'T24a every row of a site filter is of that site';
  assert (a ->> 'total')::int = (select count(*) from leads where site_id = 'aaaaaaaa-0000-0000-0000-00000000517e') and (a ->> 'total')::int > (a2 ->> 'total')::int
    and not exists (select 1 from jsonb_array_elements(a -> 'rows') x where x ->> 'site' is distinct from 'aaaaaaaa-0000-0000-0000-00000000517e'),
    'T24a the first site''s filter counts its leads and none of the second''s: ' || (a ->> 'total');
  assert (i ->> 'total') = (a2 ->> 'total'), 'T24a "in" takes a list of sites (the other workspace''s site adds nothing): ' || (i ->> 'total');
  assert (o ->> 'total') = '0' and jsonb_array_length(o -> 'rows') = 0, 'T24b a site of another workspace returns none: ' || (o ->> 'total');
  assert (b ->> 'total')::int >= 1 and not exists (select 1 from jsonb_array_elements(b -> 'rows') x where x ->> 'site' is distinct from 'bbbbbbbb-0000-0000-0000-00000000517e'),
    'T24b the other workspace''s own owner lists its own site (the wall is not an empty answer): ' || (b ->> 'total');
  assert (ba ->> 'total') = '0', 'T24b and A''s site is none of B''s: ' || (ba ->> 'total');
  assert (s -> 'rows' -> 0 ->> 'site') <= (s -> 'rows' -> (jsonb_array_length(s -> 'rows') - 1) ->> 'site'), 'T24c sorting by site works';
end $$;

-- (d) a stored answer named like a core key never replaces the row's own value
update leads set answers = '{"site":"zzz"}' where id = test.id('sA2');
insert into test.r select 'st_ans', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"site","op":"eq","value":"aaaaaaaa-0000-0000-0000-0000000052e2"}],"size":200}');
do $$ begin
  assert (select x ->> 'site' from jsonb_array_elements((select v -> 'rows' from test.r where k = 'st_ans')) x where x ->> 'id' = test.id('sA2')::text) = 'aaaaaaaa-0000-0000-0000-0000000052e2',
    'T24d an answer named site does not overwrite the row''s site';
end $$;

-- T25 (work order 13, migration 19): the reaper is scheduled. run-local.mjs gives the database a cron stand-in (cron.stub_jobs) before the
-- migrations run; where there is none (the CLI's cluster, staging, which has the real pg_cron) this reads the real thing in step 5 of the order.
do $$ begin
  if to_regclass('cron.stub_jobs') is null then raise notice 'T25 skipped: no cron stand-in here'; return; end if;
  assert (select count(*) from cron.stub_jobs where jobname = 'reap-stale-jobs') = 1, 'T25 exactly one job named reap-stale-jobs is scheduled';
  assert (select count(*) from cron.stub_jobs) = 4, 'T25 the migrations schedule four jobs: the reaper, the daily metrics pull (T34), the retention purge (migration 28) and mail-outbox (T35)';
  assert (select count(*) from cron.stub_jobs where jobname = 'metrics-pull-daily') = 1 and (select schedule from cron.stub_jobs where jobname = 'metrics-pull-daily') = '30 3 * * *'
    and (select command from cron.stub_jobs where jobname = 'metrics-pull-daily') ~ 'service\.metrics_pull_all\(\)', 'T34 the daily metrics pull is scheduled at 03:30 UTC and calls service.metrics_pull_all()';
  assert (select count(*) from cron.stub_jobs) = 4 and (select count(*) from cron.stub_jobs where jobname = 'purge-expired') = 1, 'T25 the migrations schedule no other job than the reaper, the daily metrics pull, the retention purge (migration 28) and mail-outbox (migration 29)';
  assert (select schedule from cron.stub_jobs where jobname = 'reap-stale-jobs') = '*/5 * * * *', 'T25 the reaper runs every 5 minutes';
  assert (select command from cron.stub_jobs where jobname = 'reap-stale-jobs') ~ 'service\.reap_stale_jobs\(\)', 'T25 the job calls service.reap_stale_jobs()';
end $$;

-- ===== T28 work order 10 (migration 16): a site's stored audit summaries =====
-- A site of workspace A of its own (the jobs of the other tests must not count), with finished jobs made directly (finished_at set by hand: one
-- transaction gives every now() the same value). Newest first:
--   J5 done 2026-10-05 audit WITHOUT v but with target, pass and counts (a job from before work order 10, or a bad write)   J4 done 2026-10-04 audit v 2
--   J3 done 2026-10-03 preview v1 pass, no fails        J2 failed 2026-10-02 preview v1 fail, one fail        J1 done 2026-10-01 production v1 pass, one fail kept
--   12 done jobs 2026-09-02 .. 2026-09-13 (preview v1, one fail each), and one job still building (not finished: never listed).
--   The site's neighbour (site A, same workspace) has v1 jobs of both targets finished 2026-10-20, newer than all of these: they must never show here.
reset role;
insert into sites (id, workspace_id, deploy_target, preview_host) values ('aaaaaaaa-0000-0000-0000-0000000a0d17', 'aaaaaaaa-0000-0000-0000-000000000000', 'test-site-audit-a', 'audit-a.preview.test');
create function test.audit_sum(p_target text, p_pass boolean, p_fails jsonb) returns jsonb language sql as $$
  select jsonb_build_object('v', 1, 'target', p_target, 'mode', 'test', 'pass', p_pass, 'exit', case when p_pass then 0 else 1 end, 'pages', 3, 'rules', 7,
    'counts', jsonb_build_object('PASS', 20, 'FAIL', jsonb_array_length(p_fails), 'SKIP', 1), 'byFamily', '{}'::jsonb, 'fails', p_fails, 'truncated', 0) $$;
create function test.audit_job(p_site uuid, p_state job_state, p_finished timestamptz, p_report jsonb) returns uuid language sql as $$
  insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested, state, gate_report, finished_at)
  values ('aaaaaaaa-0000-0000-0000-000000000000', p_site, '00000000-0000-0000-0000-00000000000a', '{}', '{}', p_state, p_report, p_finished) returning id $$;
insert into test.ids select 'auJ1', test.audit_job('aaaaaaaa-0000-0000-0000-0000000a0d17', 'done', '2026-10-01 10:00+00', jsonb_build_object('factory', 'pass', 'audit', test.audit_sum('production', true, '[{"rule":"MET-003","page":"/x/","line":4,"what":"w","source":"s"}]')));
insert into test.ids select 'auJ2', test.audit_job('aaaaaaaa-0000-0000-0000-0000000a0d17', 'failed', '2026-10-02 10:00+00', jsonb_build_object('reason', 'audit failed', 'factory', 'pass', 'audit', test.audit_sum('preview', false, '[{"rule":"MET-003","page":"/y/","line":9,"what":"w2","source":"s2"}]')));
insert into test.ids select 'auJ3', test.audit_job('aaaaaaaa-0000-0000-0000-0000000a0d17', 'done', '2026-10-03 10:00+00', jsonb_build_object('factory', 'pass', 'audit', test.audit_sum('preview', true, '[]')));
insert into test.ids select 'auJ4', test.audit_job('aaaaaaaa-0000-0000-0000-0000000a0d17', 'done', '2026-10-04 10:00+00', jsonb_build_object('factory', 'pass', 'audit', test.audit_sum('production', true, '[]') || '{"v":2}'));
insert into test.ids select 'auJ5', test.audit_job('aaaaaaaa-0000-0000-0000-0000000a0d17', 'done', '2026-10-05 10:00+00', '{"factory":"pass","audit":{"target":"preview","pass":true,"exit":0,"counts":{"PASS":1,"FAIL":0,"SKIP":0},"fails":[]}}');
insert into test.ids select 'auJ6', test.audit_job('aaaaaaaa-0000-0000-0000-0000000a0d17', 'building', null, null);
insert into test.ids select 'auOtherP', test.audit_job('aaaaaaaa-0000-0000-0000-00000000517e', 'done', '2026-10-20 10:00+00', jsonb_build_object('factory', 'pass', 'audit', test.audit_sum('preview', true, '[]')));
insert into test.ids select 'auOtherQ', test.audit_job('aaaaaaaa-0000-0000-0000-00000000517e', 'done', '2026-10-20 11:00+00', jsonb_build_object('factory', 'pass', 'audit', test.audit_sum('production', true, '[]')));
insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested, state, gate_report, finished_at)
  select 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000a0d17', '00000000-0000-0000-0000-00000000000a', '{}', '{}', 'done',
    jsonb_build_object('factory', 'pass', 'audit', test.audit_sum('preview', true, '[{"rule":"MET-003","page":"/z/","line":1,"what":"w3","source":"s3"}]')), '2026-09-01 10:00+00'::timestamptz + g * interval '1 day'
  from generate_series(1, 12) g;
set role omnikom_fn;
insert into test.r select 'au', service.site_audit(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-0000000a0d17');
insert into test.r select 'auStaff', service.site_audit(test.cl('00000000-0000-0000-0000-00000000005f', 'aal2'), 'aaaaaaaa-0000-0000-0000-0000000a0d17');
-- the walls: a member, another workspace's owner, staff without MFA, a site that does not exist, a site of another workspace: all not found
select test.expect_error($q$select service.site_audit(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-0000000a0d17')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.site_audit(test.c('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-0000000a0d17')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.site_audit(test.cl('00000000-0000-0000-0000-00000000005f', 'aal1'), 'aaaaaaaa-0000-0000-0000-0000000a0d17')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.site_audit(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-0000000a0d18')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.site_audit(test.c('00000000-0000-0000-0000-00000000000a'), 'bbbbbbbb-0000-0000-0000-00000000517e')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.site_audit(test.cl('00000000-0000-0000-0000-00000000005f', 'aal2'), 'aaaaaaaa-0000-0000-0000-0000000a0d18')$q$, 'S-NOT-FOUND');   -- staff with MFA: a site that does not exist is still not found
select test.expect_error($q$select service.site_audit(null, 'aaaaaaaa-0000-0000-0000-0000000a0d17')$q$, 'S-AUTH');
reset role;
do $$ declare a jsonb := (select v from test.r where k = 'au'); begin
  assert (select v from test.r where k = 'au') = (select v from test.r where k = 'auStaff'), 'T28 staff with MFA reads the same answer as the owner';
  assert (select array_agg(k order by k) from jsonb_object_keys(a) k) = array['history', 'latest'] and (select array_agg(k order by k) from jsonb_object_keys(a -> 'latest') k) = array['preview', 'production'], 'T28 the answer is { latest: { preview, production }, history }';
  -- latest: the newest job of each target that has v 1; the newer J5 (no v, target preview), J4 (v 2, target production) and the other site's jobs are skipped
  assert (a #>> '{latest,preview,job}')::uuid = test.id('auJ3'), 'T28 latest.preview is J3 (the newest of this site with v 1), not J5 (no v) or the neighbour site''s job: ' || (a #>> '{latest,preview,job}');
  assert (a #>> '{latest,production,job}')::uuid = test.id('auJ1'), 'T28 latest.production is J1 (not J4 with v 2, not the neighbour site''s job): ' || (a #>> '{latest,production,job}');
  assert a #>> '{latest,preview,summary,v}' = '1' and a #>> '{latest,preview,target}' = 'preview' and (a #>> '{latest,preview,pass}')::boolean and a #>> '{latest,preview,state}' = 'done' and a #>> '{latest,preview,finished_at}' is not null, 'T28 latest.preview row is { job, finished_at, state, target, pass, counts, summary } of J3';
  assert a #>> '{latest,preview,counts,PASS}' = '20' and jsonb_array_length(a #> '{latest,preview,summary,fails}') = 0, 'T28 latest.preview carries counts and its (empty) fails';
  assert jsonb_array_length(a #> '{latest,production,summary,fails}') = 1 and a #>> '{latest,production,summary,fails,0,rule}' = 'MET-003', 'T28 latest keeps fails (the summary whole)';
  -- history: at most 10 finished jobs, newest first, no fails, a job without v has nulls, a failed job says it, a building job is never listed
  assert jsonb_array_length(a -> 'history') = 10, 'T28 history holds at most 10 jobs (17 finished): ' || jsonb_array_length(a -> 'history');
  assert a::text !~ '"building"', 'T28 a job still building is not in the answer';
  assert not exists (select 1 from jsonb_array_elements(a -> 'history') h where h ? 'fails' or h -> 'summary' <> 'null'::jsonb or (h::text ~ '"fails"')), 'T28 history carries no fails and no summary';
  assert (a #>> '{history,0,job}')::uuid = test.id('auJ5') and a #>> '{history,0,state}' = 'done' and a #> '{history,0,pass}' = 'null'::jsonb and a #> '{history,0,target}' = 'null'::jsonb, 'T28 history[0] is J5, no v: pass and target null even though its audit names them';
  assert a #> '{history,0,counts}' = 'null'::jsonb and a #> '{history,1,counts}' = 'null'::jsonb, 'T28 history[0] (no v) and history[1] (v 2) have counts null';
  assert (a #>> '{history,1,job}')::uuid = test.id('auJ4') and a #> '{history,1,pass}' = 'null'::jsonb and a #> '{history,1,target}' = 'null'::jsonb, 'T28 history[1] is J4, v 2: nothing of its audit is trusted';
  assert (a #>> '{history,2,job}')::uuid = test.id('auJ3') and (a #>> '{history,2,pass}')::boolean and a #>> '{history,2,counts,FAIL}' = '0' and a #>> '{history,2,target}' = 'preview', 'T28 history[2] is J3 with its pass, target and counts';
  assert (a #>> '{history,3,job}')::uuid = test.id('auJ2') and a #>> '{history,3,state}' = 'failed' and not (a #>> '{history,3,pass}')::boolean and a #>> '{history,3,counts,FAIL}' = '1', 'T28 history[3] is the failed J2: state failed, pass false';
  assert (a #>> '{history,4,job}')::uuid = test.id('auJ1') and a #>> '{history,4,target}' = 'production', 'T28 history[4] is J1';
  assert (select array_agg((h ->> 'finished_at')::timestamptz order by o) = array_agg((h ->> 'finished_at')::timestamptz order by (h ->> 'finished_at')::timestamptz desc) from jsonb_array_elements(a -> 'history') with ordinality x(h, o)), 'T28 history is newest first';
  assert not exists (select 1 from jsonb_array_elements(a -> 'history') h join publish_jobs p on p.id = (h ->> 'job')::uuid where p.site_id <> 'aaaaaaaa-0000-0000-0000-0000000a0d17'), 'T28 history holds only this site''s jobs';
  assert (a #>> '{history,9,job}')::uuid = (select id from publish_jobs where site_id = 'aaaaaaaa-0000-0000-0000-0000000a0d17' and state = 'done' and finished_at = '2026-09-09 10:00+00'), 'T28 history[9] is the job of 2026-09-09 (the 10 newest of 17 are J5, J4, J3, J2, J1 and September 13 down to 9)';
end $$;
-- a site that has never finished a publish (one job is still building): both targets null, history empty
insert into sites (id, workspace_id, deploy_target, preview_host) values ('aaaaaaaa-0000-0000-0000-0000000a0d19', 'aaaaaaaa-0000-0000-0000-000000000000', 'test-site-audit-empty', 'audit-e.preview.test');
select test.audit_job('aaaaaaaa-0000-0000-0000-0000000a0d19', 'building', null, null);
set role omnikom_fn;
insert into test.r select 'auEmpty', service.site_audit(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-0000000a0d19');
reset role;
do $$ begin assert (select v from test.r where k = 'auEmpty') = '{"latest":{"preview":null,"production":null},"history":[]}'::jsonb, 'T28 a site with no finished publish answers null, null, []: ' || (select v from test.r where k = 'auEmpty')::text; end $$;
-- the function: closed to anon, authenticated and PUBLIC, open to the function role, definer with an empty search_path; its helper is closed too
do $$ declare f text; begin
  foreach f in array array['service.site_audit(jsonb,uuid)', 'private.audit_row(uuid,timestamptz,public.job_state,jsonb,boolean)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not exists (select 1 from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) a where a.grantee = 0), f || ' is closed to anon, authenticated and PUBLIC';
    assert (select prosecdef from pg_proc where oid = f::regprocedure) and (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' is a definer function with an empty search_path';
  end loop;
  assert has_function_privilege('omnikom_fn', 'service.site_audit(jsonb,uuid)', 'execute'), 'service.site_audit is open to the function role';
end $$;

-- ===== T27 work order 08 (migration 17): the team list, and the removal that counts the other workspaces =====
-- Synthetic logins f1 (member of A, team profile "Agent One"), f2 (member of A and of B) and f3 (a second owner of A). Workspace B has one owner.
reset role;
select test.act_as(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'mt1@t24.test'), ('00000000-0000-0000-0000-0000000000f2', 'mt2@t24.test');
insert into members (workspace_id, user_id, role, team_row_id) values
 ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f1', 'member', test.id('team1')),
 ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f2', 'member', null),
 ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f2', 'member', null);
set role omnikom_fn;
-- (a) the owner lists: owners first, email from auth.users, the team profile's name, the joined date
insert into test.r select 'lmA', jsonb_agg(to_jsonb(m)) from service.list_members(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000') m;
insert into test.r select 'lmStaff', jsonb_agg(to_jsonb(m)) from service.list_members(test.cl('00000000-0000-0000-0000-00000000005f', 'aal2'), 'aaaaaaaa-0000-0000-0000-000000000000') m;
insert into test.r select 'lmB', jsonb_agg(to_jsonb(m)) from service.list_members(test.c('00000000-0000-0000-0000-00000000000b'), 'bbbbbbbb-0000-0000-0000-000000000000') m;
-- (b) walls: a member, another workspace's owner, a login with no membership, a workspace that does not exist, and staff without the second factor
select test.expect_error($q$select * from service.list_members(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.list_members(test.c('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.list_members(test.c('00000000-0000-0000-0000-00000000000e'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.list_members(test.c('00000000-0000-0000-0000-00000000000a'), '99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.list_members(test.cl('00000000-0000-0000-0000-00000000005f', 'aal1'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.list_members(test.cl('00000000-0000-0000-0000-00000000005f', 'aal2'), '99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');   -- staff passes the owner-or-staff check anywhere: only the exists check tells a workspace that is not there
reset role;
do $$ declare a jsonb := (select v from test.r where k = 'lmA'); b jsonb := (select v from test.r where k = 'lmB'); begin
  assert jsonb_array_length(a) = 5, 'T27a the owner lists the five members of A: ' || jsonb_array_length(a);
  assert a -> 0 ->> 'role' = 'owner' and a -> 0 ->> 'email' = 'owner-a@test', 'T27a owners come first, with the login''s email: ' || (a -> 0)::text;
  assert (select e ->> 'team_name' from jsonb_array_elements(a) e where e ->> 'email' = 'mt1@t24.test') = 'Agent One'
    and (select e ->> 'team_row_id' from jsonb_array_elements(a) e where e ->> 'email' = 'mt1@t24.test') = test.id('team1')::text, 'T27a a member carries the name of their team profile';
  assert (select e ->> 'team_name' from jsonb_array_elements(a) e where e ->> 'email' = 'mt2@t24.test') is null, 'T27a a member with no team profile has no name';
  assert (select count(*) from jsonb_array_elements(a) e where (e ->> 'joined_at') is not null) = 5, 'T27a every row has a joined date';
  assert jsonb_array_length(b) = 2 and not exists (select 1 from jsonb_array_elements(b) e where e ->> 'email' in ('owner-a@test', 'mt1@t24.test', 'agent1-a@test')), 'T27c another workspace''s owner lists only their own people: ' || b::text;
  assert jsonb_array_length((select v from test.r where k = 'lmStaff')) = 5, 'T27b staff with the second factor lists';
end $$;
-- (c2) invite_context: the business's name and the inviter's (a team profile's name, else the login's email); the same wall as list_members
set role omnikom_fn;
insert into test.r select 'ctxA', to_jsonb(c) from service.invite_context(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000') c;
insert into test.r select 'ctxStaff', to_jsonb(c) from service.invite_context(test.cl('00000000-0000-0000-0000-00000000005f', 'aal2'), 'aaaaaaaa-0000-0000-0000-000000000000') c;
select test.expect_error($q$select * from service.invite_context(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.invite_context(test.c('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.invite_context(test.c('00000000-0000-0000-0000-00000000000e'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.invite_context(test.c('00000000-0000-0000-0000-00000000000a'), '99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.invite_context(test.cl('00000000-0000-0000-0000-00000000005f', 'aal1'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.invite_context(test.cl('00000000-0000-0000-0000-00000000005f', 'aal2'), '99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
reset role;
-- an owner with a team profile is named by it (owner A gets agent one's profile for this check)
update members set team_row_id = test.id('team1') where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and user_id = '00000000-0000-0000-0000-00000000000a';
set role omnikom_fn;
insert into test.r select 'ctxA2', to_jsonb(c) from service.invite_context(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000') c;
reset role;
update members set team_row_id = null where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and user_id = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select v from test.r where k = 'ctxA') = '{"business":"Demo A","inviter":"owner-a@test"}'::jsonb, 'T27c2 no team profile: the inviter is the login''s email: ' || (select v from test.r where k = 'ctxA')::text;
  assert (select v from test.r where k = 'ctxA2') = '{"business":"Demo A","inviter":"Agent One"}'::jsonb, 'T27c2 a team profile names the inviter: ' || (select v from test.r where k = 'ctxA2')::text;
  assert (select v ->> 'business' from test.r where k = 'ctxStaff') = 'Demo A' and (select v ->> 'inviter' from test.r where k = 'ctxStaff') = 'staff@omnikom', 'T27c2 staff with the second factor: the staff login''s email';
end $$;
-- (d) removal needs nothing new (service.remove_member): a second owner (f3) works in A, owner A removes f1, f2 and f3, and with the claims they had
-- every read and write of f3 in A is refused. Open sessions are not ended (Supabase Auth has no admin logout by user id): the wall is the proof.
reset role;
select test.act_as(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f3', 'mt3@t24.test');
insert into members (workspace_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f3', 'owner');
insert into test.ids select 'lead24', id from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' order by created_at, id limit 1;
set role omnikom_fn;
do $$ begin
  assert (service.lead_list(test.c('00000000-0000-0000-0000-0000000000f3'), 'aaaaaaaa-0000-0000-0000-000000000000', '{}') ->> 'total')::int > 0, 'T27d before the removal the second owner reads leads';
  perform service.lead_update(test.c('00000000-0000-0000-0000-0000000000f3'), test.id('lead24'), p_note => 'T27 before');
  perform * from service.save_as(test.c('00000000-0000-0000-0000-0000000000f3'), 'aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"24 Wall Rd","status":"for-sale"}');
end $$;
select test.expect_error($q$select service.remove_member(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.remove_member(test.c('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f1')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.remove_member(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.remove_member(test.c('00000000-0000-0000-0000-00000000000a'), 'bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f2')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.remove_member(test.c('00000000-0000-0000-0000-00000000000b'), 'bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b')$q$, 'S-LAST-OWNER');
select service.remove_member(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f1');
select service.remove_member(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f2');
select service.remove_member(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f3');
-- the removed owner, with the claims they had: a lead read finds nothing, a lead update, a save and the team list are refused
do $$ begin
  assert (service.lead_list(test.c('00000000-0000-0000-0000-0000000000f3'), 'aaaaaaaa-0000-0000-0000-000000000000', '{}') ->> 'total')::int = 0, 'T27d after the removal a lead read finds nothing';
end $$;
select test.expect_error($q$select service.lead_update(test.c('00000000-0000-0000-0000-0000000000f3'), test.id('lead24'), p_note => 'T27 after')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.save_as(test.c('00000000-0000-0000-0000-0000000000f3'), 'aaaaaaaa-0000-0000-0000-000000000000', 'listings', null, '{"street":"24 After Rd","status":"for-sale"}')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select * from service.list_members(test.c('00000000-0000-0000-0000-0000000000f3'), 'aaaaaaaa-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
reset role;
do $$ begin
  assert exists (select 1 from members where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000' and user_id = '00000000-0000-0000-0000-00000000000b'), 'T27d the refused last-owner removal changed nothing';
  assert exists (select 1 from members where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and user_id = '00000000-0000-0000-0000-0000000000a2'), 'T27d a refused removal by a member changed nothing';
  assert (select count(*) from members where user_id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3')) = 0
    and (select count(*) from members where user_id = '00000000-0000-0000-0000-0000000000f2') = 1, 'T27d f1 and f3 belong to no workspace now; f2 still belongs to B';
  assert (select count(*) from audit_log where action = 'member-remove' and target in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3')) = 3, 'T27d each removal is audited (member-remove)';
  assert (select count(*) from leads where id = test.id('lead24')) = 1 and exists (select 1 from content_rows where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and collection = 'listings'), 'T27d the removed person''s rows stay';
end $$;
-- row-level security reads membership on every request, so the removed login's token (valid for its life) reads nothing of A; f2 still reads B
select test.act_as('00000000-0000-0000-0000-0000000000f3');
set role authenticated;
do $$ begin
  assert (select count(*) from workspaces where id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'T27d after the removal the same login reads nothing of the workspace';
  assert (select count(*) from content_rows where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'T27d and no content rows of it';
  assert (select count(*) from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'T27d and no leads of it';
end $$;
reset role;
select test.act_as('00000000-0000-0000-0000-0000000000f2');
set role authenticated;
do $$ begin
  assert (select count(*) from workspaces where id = 'bbbbbbbb-0000-0000-0000-000000000000') = 1 and (select count(*) from workspaces where id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'T27d a login removed from A still reads B and nothing of A';
end $$;
reset role;
select test.act_as(null);
-- (e) the function: closed to anon, authenticated and PUBLIC, open to the function role, definer with an empty search_path
do $$ declare f text; begin
  foreach f in array array['service.list_members(jsonb,uuid)', 'service.invite_context(jsonb,uuid)'] loop
  assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not exists (select 1 from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) a where a.grantee = 0), f || ' is closed to anon, authenticated and PUBLIC';
  assert has_function_privilege('omnikom_fn', f, 'execute'), f || ' is open to the function role';
  assert (select prosecdef from pg_proc where oid = f::regprocedure) and (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' is a definer function with an empty search_path';
  end loop;
end $$;

-- ===================================================================================================================================
-- ===== T29 work order 18 (migration 22): saved views, follow-up, tasks, duplicates (own block; mutants "crm22: ..." in run-local.mjs) =====
-- ===================================================================================================================================
-- Fixture rows for crm_views and lead_tasks of workspace A are inserted before T14's isolation loop (look for "work order 18" there).
-- Directly inserted leads fire the duplicate trigger too: capture_lead is refused here by the hourly lead limit of A, and the trigger is on the table, so the
-- paths capture, add-lead and import are each also run below (capture on B, whose limit is not used up).
reset role;
select test.act_as(null);
create function test.t29_save(p_sub text, p_ws uuid, p_view jsonb) returns uuid language sql as $$ select service.view_save(test.c(p_sub), p_ws, p_view) $$;
create function test.t29_vdel(p_sub text, p_view uuid) returns void language sql as $$ select service.view_delete(test.c(p_sub), p_view) $$;
create function test.t29_fu(p_sub text, p_lead uuid, p_at timestamptz) returns boolean language sql as $$ select service.lead_follow_up(test.c(p_sub), p_lead, p_at) $$;
create function test.t29_task(p_sub text, p_lead uuid, p_text text, p_due timestamptz default null) returns uuid language sql as $$ select service.task_add(test.c(p_sub), p_lead, p_text, p_due) $$;
create function test.t29_done(p_sub text, p_task uuid, p_done boolean) returns void language sql as $$ select service.task_done(test.c(p_sub), p_task, p_done) $$;
create function test.t29_lead(p_name text, p_email text, p_phone text default null, p_team uuid default null, p_ws uuid default 'aaaaaaaa-0000-0000-0000-000000000000', p_at timestamptz default now(), p_id uuid default gen_random_uuid())
returns uuid language sql as $$
  insert into leads (id, workspace_id, site_id, form, page_path, name, email, phone, consent_text, owner_team_row, created_at)
  values (p_id, p_ws, case when p_ws = 'aaaaaaaa-0000-0000-0000-000000000000' then 'aaaaaaaa-0000-0000-0000-00000000517e'::uuid else 'bbbbbbbb-0000-0000-0000-00000000517e'::uuid end,
    'contact', '/', p_name, p_email, p_phone, 'I agree', p_team, p_at) returning id $$;
grant execute on function test.t29_save(text, uuid, jsonb), test.t29_vdel(text, uuid), test.t29_fu(text, uuid, timestamptz), test.t29_task(text, uuid, text, timestamptz),
  test.t29_done(text, uuid, boolean), test.t29_lead(text, text, text, uuid, uuid, timestamptz, uuid) to anon, authenticated, service_role, omnikom_fn;

-- (a) saved views: write walls
set role omnikom_fn;
insert into test.ids select 'v_mine', test.t29_save('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000',
  '{"name":"T29 mine","query":{"filters":[{"field":"status","op":"eq","value":"new"}],"sort":{"field":"name","dir":"asc"},"search":"t29"},"columns":["name","email","budget","follow_up","duplicate"]}');
insert into test.ids select 'v_shared', test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000',
  '{"name":"T29 shared","shared":true,"query":{"sort":{"field":"created_at","dir":"desc"}},"columns":["name","status","owner"]}');
insert into test.ids select 'v_ownerpriv', test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 owner private","columns":["email"]}');
insert into test.ids select 'v_staff', service.view_save(test.cl('00000000-0000-0000-0000-00000000005f', 'aal2'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 staff shared","shared":true}');
insert into test.ids select 'v_a2', test.t29_save('00000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 mine"}');   -- the same name as a1's: names are unique per person
insert into test.ids select 'v_b', test.t29_save('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', '{"name":"T29 shared","shared":true}');   -- and per workspace
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 try shared","shared":true}')$q$, 'S-OWN-ONLY');
select test.expect_error(format($q$select test.t29_save('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('id', %L, 'name', 'T29 hijack', 'shared', false))$q$, test.id('v_shared')), 'S-OWN-ONLY');
select test.expect_error(format($q$select test.t29_save('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('id', %L, 'name', 'T29 hijack'))$q$, test.id('v_ownerpriv')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('id', %L, 'name', 'T29 hijack'))$q$, test.id('v_mine')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t29_save('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', jsonb_build_object('id', %L, 'name', 'T29 cross', 'shared', true))$q$, test.id('v_shared')), 'S-NOT-FOUND');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 B into A"}')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000e', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 nobody"}')$q$, 'S-NOT-FOUND');
select test.expect_error($q$select service.view_save(test.cl('00000000-0000-0000-0000-00000000005f', 'aal1'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 staff no mfa","shared":true}')$q$, 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t29_vdel('00000000-0000-0000-0000-0000000000a1', %L)$q$, test.id('v_shared')), 'S-OWN-ONLY');
select test.expect_error(format($q$select test.t29_vdel('00000000-0000-0000-0000-0000000000a1', %L)$q$, test.id('v_ownerpriv')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t29_vdel('00000000-0000-0000-0000-00000000000b', %L)$q$, test.id('v_shared')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t29_vdel('00000000-0000-0000-0000-00000000000e', %L)$q$, test.id('v_shared')), 'S-NOT-FOUND');
select test.expect_error($q$select test.t29_vdel('00000000-0000-0000-0000-00000000000a', '99999999-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');
-- what is refused is refused with the words of the problem; a name is 1 to 60 characters and unique per person (and per workspace for the shared ones)
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 bad col","columns":["name","zzz_nope"]}')$q$, 'I-ANSWER columns: zzz_nope is not a column');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 bad col","columns":["note"]}')$q$, 'I-ANSWER columns: note is not a column');   -- a field the contract keeps out of the list
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 bad col","columns":["name","name"]}')$q$, 'I-ANSWER columns: name is listed twice');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 bad col","columns":["na me"]}')$q$, 'I-ANSWER columns: A key is not a column');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 bad col","columns":[5]}')$q$, 'I-ANSWER columns: A column is a key');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 bad col","columns":"name"}')$q$, 'I-ANSWER columns: Columns are a list');
select test.expect_error(format($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('name', 'T29 many', 'columns', %L::jsonb))$q$,
  (select jsonb_agg('k' || i) from generate_series(1, 61) i)::text), 'I-ANSWER columns: At most 60 columns');
select test.expect_error(format($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('name', 'T29 big', 'query', %L::jsonb))$q$,
  (select jsonb_build_object('filters', jsonb_build_array(jsonb_build_object('field', 'name', 'op', 'in', 'values', jsonb_agg(repeat('v', 200) || i))))::text from generate_series(1, 100) i)), 'I-ANSWER query: The query is too large');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"   "}')$q$, 'I-ANSWER name: A view name is 1 to 60 characters');
select test.expect_error(format($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('name', %L))$q$, repeat('n', 61)), 'I-ANSWER name: A view name is 1 to 60 characters');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"columns":["name"]}')$q$, 'I-ANSWER name: A view needs a name');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":5}')$q$, 'I-ANSWER name: A view needs a name');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 shared flag","shared":"yes"}')$q$, 'I-ANSWER shared');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 mine"}')$q$, 'I-ANSWER name: A view with that name already exists');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 shared","shared":true}')$q$, 'I-ANSWER name: A view with that name already exists');
select test.expect_error(format($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('id', %L, 'name', 'T29 shared', 'shared', true))$q$, test.id('v_staff')), 'I-ANSWER name: A view with that name already exists');   -- renaming onto another shared view
-- one function checks the query: whatever lead_list refuses, a view refuses (S-QUERY), and a query lead_list accepts is saved and listed
do $$ declare qs jsonb[] := array[
    '{"sort":{"field":"nope"}}', '{"sort":{"field":"name","dir":"sideways"}}', '{"filters":[{"field":"nope","op":"eq","value":1}]}', '{"filters":[{"field":"name","op":"like","value":"a"}]}',
    '{"filters":[{"field":"name","op":"range","from":1}]}', '{"filters":{"field":"name"}}', '{"search":"' || repeat('x', 201) || '"}', '{"size":201}', '{"size":0}', '{"page":0}', '[]', '"text"',
    '{"due":"maybe"}', '{"duplicates":1}', '{"filters":[{"field":"name","op":"in","values":"a"}]}']::jsonb[];
  ok jsonb[] := array['{}', '{"search":"x"}', '{"due":true,"duplicates":false}', '{"filters":[{"field":"budget","op":"range","from":1,"to":9}],"sort":{"field":"budget","dir":"desc"}}']::jsonb[];
  q jsonb; a text; b text; i int := 0; begin
  foreach q in array qs loop
    i := i + 1;
    begin perform service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', q); a := 'accepted'; exception when others then a := left(sqlerrm, 7); end;
    begin perform service.view_save(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('name', 'T29 q' || i, 'query', q)); b := 'accepted'; exception when others then b := left(sqlerrm, 7); end;
    assert a = 'S-QUERY' and b = 'S-QUERY', format('T29a a query lead_list refuses is refused by view_save too: %s lead_list %s, view_save %s', q, a, b);
  end loop;
  foreach q in array ok loop
    i := i + 1;
    perform service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', q);
    perform service.view_save(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('name', 'T29 ok' || i, 'query', q));
  end loop;
end $$;
reset role;
do $$ begin
  assert (select count(*) from crm_views where name like 'T29 q%') = 0, 'T29a a refused view stored nothing';
  assert (select count(*) from crm_views where name like 'T29 ok%') = 4, 'T29a the accepted queries were saved';
end $$;
set role omnikom_fn;
-- an owner changes the shared view in place: the same row, the new name, the columns in the order sent
select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('id', test.id('v_shared'), 'name', 'T29 shared 2', 'shared', true, 'columns', '["status","name"]'::jsonb));
reset role;
do $$ declare v public.crm_views; begin
  select * into v from crm_views where id = test.id('v_shared');
  assert v.name = 'T29 shared 2' and v.user_id is null and v.columns = array['status', 'name'] and v.updated_at >= v.created_at, 'T29a the shared view changed in place, still shared, the columns in the order sent: ' || v::text;
  assert (select count(*) from crm_views where name in ('T29 shared', 'T29 shared 2') and workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 1, 'T29a a change is not a copy';
  select * into v from crm_views where id = test.id('v_mine');
  assert v.user_id = '00000000-0000-0000-0000-0000000000a1' and v.columns = array['name', 'email', 'budget', 'follow_up', 'duplicate'] and v.query -> 'sort' ->> 'field' = 'name', 'T29a a member''s view is theirs, with the columns and the query as saved: ' || v::text;
  assert (select user_id from crm_views where id = test.id('v_staff')) is null and (select user_id from crm_views where id = test.id('v_ownerpriv')) = '00000000-0000-0000-0000-00000000000a', 'T29a staff with MFA shares; an owner''s default is private';
  assert (select count(*) from audit_log where action = 'view-save' and target in (select id::text from crm_views where name like 'T29%')) >= 5, 'T29a every save is audited';
end $$;
-- reads: row level security. a1 sees their own and the shared ones, never the owner's private view; the owner of B and a login of nothing see none of A's
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  assert (select array_agg(name order by name) from crm_views where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name like 'T29%') = array['T29 mine', 'T29 shared 2', 'T29 staff shared'], 'T29b a1 reads their own view and the shared ones: ' || (select array_agg(name order by name)::text from crm_views where name like 'T29%');
  assert not exists (select 1 from crm_views where id = test.id('v_ownerpriv') or id = test.id('v_a2')), 'T29b a1 does not read the owner''s or a2''s private view';
end $$;
select test.expect_error($q$insert into crm_views (workspace_id, user_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'T29 direct')$q$, 'permission denied');
select test.expect_error($q$update crm_views set name = 'T29 direct' where user_id is null$q$, 'permission denied');
select test.expect_error($q$delete from crm_views$q$, 'permission denied');
select test.act_as('00000000-0000-0000-0000-0000000000a2');
do $$ begin
  assert (select count(*) from crm_views where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name like 'T29%') = 3 and (select count(*) from crm_views where user_id = '00000000-0000-0000-0000-0000000000a2') = 1
    and not exists (select 1 from crm_views where id in (test.id('v_mine'), test.id('v_ownerpriv'))), 'T29b a2 reads their own view and the two shared ones, none of a1''s or the owner''s';
end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select array_agg(name order by name) from crm_views where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name like 'T29 %' and name not like 'T29 ok%') = array['T29 owner private', 'T29 shared 2', 'T29 staff shared'], 'T29b the owner reads theirs and the shared ones, not the members'' private views: ' || (select array_agg(name order by name)::text from crm_views where name like 'T29%');
end $$;
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from crm_views where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0 and (select count(*) from crm_views where name like 'T29%') = 1, 'T29b owner B reads nothing of A''s views, only their own';
end $$;
select test.act_as('00000000-0000-0000-0000-00000000000e');
do $$ begin assert (select count(*) from crm_views) = 0, 'T29b a login of nothing reads no view'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select array_agg(name order by name) from crm_views where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name like 'T29 %' and name not like 'T29 ok%') = array['T29 shared 2', 'T29 staff shared'], 'T29b staff with MFA reads the shared views and their own, not the private ones of the business''s people'; end $$;
reset role;
select test.act_as(null);
-- the 100-view limit, then deletes: own, an owner's for a shared view
insert into crm_views (workspace_id, user_id, name) select 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'T29 cap ' || i from generate_series(1, 99) i;
set role omnikom_fn;
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T29 cap one too many"}')$q$, 'I-ANSWER views: At most 100 views');
select test.t29_vdel('00000000-0000-0000-0000-0000000000a1', test.id('v_mine'));
select test.t29_vdel('00000000-0000-0000-0000-00000000000a', test.id('v_shared'));
select test.t29_vdel('00000000-0000-0000-0000-00000000000a', test.id('v_staff'));
reset role;
delete from crm_views where name like 'T29 cap%';
do $$ begin
  assert not exists (select 1 from crm_views where id in (test.id('v_mine'), test.id('v_shared'), test.id('v_staff'))) and exists (select 1 from crm_views where id = test.id('v_ownerpriv')), 'T29b own and shared deletes took effect and nothing else';
  assert (select count(*) from audit_log where action = 'view-delete' and target in (test.id('v_mine')::text, test.id('v_shared')::text, test.id('v_staff')::text)) = 3, 'T29b each delete is audited';
  assert exists (select 1 from crm_views where id = test.id('v_b')), 'T29b A''s deletes touched nothing of B''s';
end $$;

-- (c) duplicates: the oldest earlier match, by email (any case) or phone (any format), in the same workspace
-- (c1) the oldest by created_at, not the first inserted: y_old is made second but is older; z follows with the email in capitals
select test.t29_lead('T29 Y young', 'old.t29@t29.test', null, null, 'aaaaaaaa-0000-0000-0000-000000000000', now() - interval '1 day') is not null as y1;
insert into test.ids select 'y_young', id from leads where name = 'T29 Y young';
insert into test.ids select 'y_old', test.t29_lead('T29 Y old', 'old.t29@t29.test', null, null, 'aaaaaaaa-0000-0000-0000-000000000000', now() - interval '10 days');
insert into test.ids select 'y_z', test.t29_lead('T29 Z', 'OLD.T29@T29.TEST');
-- (c2) leads of one moment (an import is one transaction): a flagged lead never stands in for its root, whatever the ids say (the root has the LARGEST id)
insert into test.ids select 'tie_r', test.t29_lead('T29 tie root', 'tie.t29@t29.test', null, null, 'aaaaaaaa-0000-0000-0000-000000000000', '2026-01-01 10:00+00', 'ffffffff-0000-4000-8000-000000000001');
insert into test.ids select 'tie_b', test.t29_lead('T29 tie b', 'tie.t29@t29.test', null, null, 'aaaaaaaa-0000-0000-0000-000000000000', '2026-01-01 10:00+00', '00000000-0000-4000-8000-0000000000b1');
insert into test.ids select 'tie_c', test.t29_lead('T29 tie c', 'tie.t29@t29.test', null, null, 'aaaaaaaa-0000-0000-0000-000000000000', '2026-01-01 10:00+00', '00000000-0000-4000-8000-0000000000c1');
-- (c3) phones in any format; empty emails and no phones never match; another workspace never matches; the flag cannot be sent in
insert into test.ids select 'p1', test.t29_lead('T29 P1', 'p1.t29@t29.test', '(555) 010-0199');
insert into test.ids select 'p2', test.t29_lead('T29 P2', 'p2.t29@t29.test', '+1 555 010 0199');
insert into test.ids select 'p3', test.t29_lead('T29 P3', 'p3.t29@t29.test', '555.010.0199');
insert into test.ids select 'p4', test.t29_lead('T29 P4', 'p4.t29@t29.test', '555 010 0198');
insert into test.ids select 'e1', test.t29_lead('T29 E1', '', null);
insert into test.ids select 'e2', test.t29_lead('T29 E2', '', null);
insert into test.ids select 'e3', test.t29_lead('T29 E3', null, null);
insert into test.ids select 'e4', test.t29_lead('T29 E4', null, null);
insert into test.ids select 'xb', test.t29_lead('T29 X in B', 'old.t29@t29.test', null, null, 'bbbbbbbb-0000-0000-0000-000000000000');
insert into leads (workspace_id, site_id, form, page_path, name, email, consent_text, duplicate_of)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T29 sent in', 'unique.t29@t29.test', 'I agree', (select v from test.ids where k = 'y_young'));
do $$ begin
  assert (select duplicate_of from leads where id = test.id('y_young')) is null, 'T29c the first lead is nobody''s duplicate';
  assert (select duplicate_of from leads where id = test.id('y_old')) = test.id('y_young'), 'T29c a lead made older than the one before it points at it (only it existed)';
  assert (select duplicate_of from leads where id = test.id('y_z')) = test.id('y_old'), 'T29c the email in capitals matches, and the pointer is the OLDEST earlier lead by created_at, not the first inserted or the newest';
  assert (select duplicate_of from leads where id = test.id('tie_b')) = test.id('tie_r') and (select duplicate_of from leads where id = test.id('tie_c')) = test.id('tie_r'), 'T29c leads of one moment: the third points at the root, not at the flagged second';
  assert (select duplicate_of from leads where id = test.id('p2')) = test.id('p1') and (select duplicate_of from leads where id = test.id('p3')) = test.id('p1'), 'T29c a phone matches in any format (E.164)';
  assert (select duplicate_of from leads where id = test.id('p4')) is null, 'T29c another number does not match';
  assert (select count(*) from leads where id in (test.id('e1'), test.id('e2'), test.id('e3'), test.id('e4')) and duplicate_of is not null) = 0, 'T29c empty emails and missing phones never match';
  assert (select duplicate_of from leads where id = test.id('xb')) is null, 'T29c the same email in another workspace is not a duplicate';
  assert (select duplicate_of from leads where name = 'T29 sent in') is null, 'T29c a flag sent with the insert is ignored: the rule decides';
end $$;
-- (c3b) a direct write by the service role works with the phone index (the index expression runs as the writing role) and is flagged the same
set role service_role;
insert into test.ids select 'sr1', test.t29_lead('T29 SR 1', 'sr.t29@t29.test', '555 010 0150');
insert into test.ids select 'sr2', test.t29_lead('T29 SR 2', 'SR.t29@t29.test', null);
insert into test.ids select 'sr3', test.t29_lead('T29 SR 3', 'sr3.t29@t29.test', '+1 (555) 010-0150');
update leads set name = 'T29 SR 3 renamed', phone = '555-010-0150' where id = test.id('sr3');
reset role;
do $$ begin assert (select duplicate_of from leads where id = test.id('sr2')) = test.id('sr1') and (select duplicate_of from leads where id = test.id('sr3')) = test.id('sr1') and (select name from leads where id = test.id('sr3')) = 'T29 SR 3 renamed', 'T29c the service role writes and updates leads (the phone index), and the rule flags them'; end $$;
-- (c4) the three paths: add-lead, capture (workspace B), import (add)
set role omnikom_fn;
insert into test.ids select 'ad1', service.add_lead(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e', 'T29 Add One', 'add.t29@t29.test', null, '{}', 'Said yes', 'manual', null);
insert into test.ids select 'ad2', service.add_lead(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e', 'T29 Add Two', 'ADD.t29@T29.test', null, '{}', 'Said yes', 'manual', null);
insert into test.ids select 'cp1', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'T29 Cap One', 'cap.t29@t29.test', '(555) 010-0177', '{}', 'I agree');
insert into test.ids select 'cp2', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'T29 Cap Two', 'CAP.T29@t29.test', null, '{}', 'I agree');
insert into test.ids select 'cp3', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'T29 Cap Three', 'other.t29@t29.test', '+1 555 010 0177', '{}', 'I agree');
insert into test.r select 'imp_dry', service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select v #>> '{}' from test.r where k = 'tplA')::uuid,
  '[{"line":2,"name":"T29 Imp One","email":"imp.t29@t29.test"},{"line":3,"name":"T29 Imp Two","email":"IMP.t29@T29.test"},{"line":4,"name":"T29 Imp Three","email":"imp.t29@t29.test"},{"line":5,"name":"T29 Imp Known","email":"ADD.T29@t29.test"}]',
  '{"dry_run":true}');
insert into test.r select 'imp', service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select v #>> '{}' from test.r where k = 'tplA')::uuid,
  '[{"line":2,"name":"T29 Imp One","email":"imp.t29@t29.test"},{"line":3,"name":"T29 Imp Two","email":"IMP.t29@T29.test"},{"line":4,"name":"T29 Imp Three","email":"imp.t29@t29.test"},{"line":5,"name":"T29 Imp Known","email":"ADD.T29@t29.test"}]',
  ('{"dry_run":false,"duplicates":"add","consent":true,"file_name":"t29.csv","file_sha256":"' || repeat('d', 64) || '"}')::jsonb);
reset role;
do $$ declare i1 uuid := (select id from leads where name = 'T29 Imp One'); begin
  assert (select duplicate_of from leads where id = test.id('ad1')) is null and (select duplicate_of from leads where id = test.id('ad2')) = test.id('ad1'), 'T29c add-lead flags a second lead with the email in capitals';
  assert (select duplicate_of from leads where id = test.id('cp1')) is null and (select duplicate_of from leads where id = test.id('cp2')) = test.id('cp1') and (select duplicate_of from leads where id = test.id('cp3')) = test.id('cp1'),
    'T29c capture flags by email in capitals and by phone in another format, in the same transaction';
  assert (select duplicate_of from leads where id = test.id('cp1')) is null and not exists (select 1 from leads where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000' and duplicate_of in (select id from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000')), 'T29c a flag never crosses workspaces';
  assert (select v ->> 'duplicates_count' from test.r where k = 'imp_dry') = '3' and (select count(*) from leads where name like 'T29 Imp%' and duplicate_of is not null) = 3, 'T29c the import''s dry run counts the same duplicates the real run flags: ' || (select v::text from test.r where k = 'imp_dry');
  assert (select duplicate_of from leads where name = 'T29 Imp Two') = i1 and (select duplicate_of from leads where name = 'T29 Imp Three') = i1 and (select duplicate_of from leads where id = i1) is null, 'T29c the import (add) points the later rows at the first row of the file';
  assert (select duplicate_of from leads where name = 'T29 Imp Known') = test.id('ad1'), 'T29c an imported row points at the lead the workspace already had';
end $$;
-- deleting the lead a flag points at clears the flag (nothing dangles, nothing is refused)
delete from leads where id = test.id('y_young');
do $$ begin assert (select duplicate_of from leads where id = test.id('y_old')) is null and (select duplicate_of from leads where id = test.id('y_z')) = test.id('y_old'), 'T29c deleting the lead a flag points at clears that flag only'; end $$;

-- (d) the filters `due` and `duplicates`, as owner and as member; the duplicate pointer is shown only to who can read both leads
insert into test.ids select 'f_a1_past', test.t29_lead('T29 F a1 past', 'f1.t29@t29.test', null, test.id('crm_t1'));
insert into test.ids select 'f_a1_next', test.t29_lead('T29 F a1 next', 'f2.t29@t29.test', null, test.id('crm_t1'));
insert into test.ids select 'f_a2_past', test.t29_lead('T29 F a2 past', 'f3.t29@t29.test', null, test.id('team2'));
insert into test.ids select 'f_none_past', test.t29_lead('T29 F none past', 'f4.t29@t29.test');
insert into test.ids select 't_a1_open', test.t29_lead('T29 T a1 open', 't1.t29@t29.test', null, test.id('crm_t1'));
insert into test.ids select 't_a1_done', test.t29_lead('T29 T a1 done', 't2.t29@t29.test', null, test.id('crm_t1'));
insert into test.ids select 't_a1_future', test.t29_lead('T29 T a1 future', 't3.t29@t29.test', null, test.id('crm_t1'));
insert into test.ids select 't_a2_open', test.t29_lead('T29 T a2 open', 't4.t29@t29.test', null, test.id('team2'));
insert into test.ids select 'n_a1', test.t29_lead('T29 N a1', 'n1.t29@t29.test', null, test.id('crm_t1'));
update leads set follow_up_at = now() - interval '1 day' where id in (test.id('f_a1_past'), test.id('f_a2_past'), test.id('f_none_past'));
update leads set follow_up_at = now() + interval '1 day' where id = test.id('f_a1_next');
insert into lead_tasks (lead_id, workspace_id, text, due_at, done_at) values
  (test.id('t_a1_open'), 'aaaaaaaa-0000-0000-0000-000000000000', 'T29 open and due', now() - interval '1 hour', null),
  (test.id('t_a1_done'), 'aaaaaaaa-0000-0000-0000-000000000000', 'T29 done and due', now() - interval '1 hour', now()),
  (test.id('t_a1_future'), 'aaaaaaaa-0000-0000-0000-000000000000', 'T29 open, due later', now() + interval '1 hour', null),
  (test.id('t_a2_open'), 'aaaaaaaa-0000-0000-0000-000000000000', 'T29 a2 open and due', now() - interval '1 hour', null),
  (test.id('n_a1'), 'aaaaaaaa-0000-0000-0000-000000000000', 'T29 open, no due time', null, null);
insert into test.ids select 'vis1', test.t29_lead('T29 Vis 1', 'vis.t29@t29.test', null, test.id('crm_t1'));
insert into test.ids select 'vis2', test.t29_lead('T29 Vis 2', 'vis.t29@t29.test', null, test.id('team2'));
insert into test.ids select 'vis3', test.t29_lead('T29 Vis 3', 'VIS.t29@t29.test', null, test.id('crm_t1'));
set role omnikom_fn;
insert into test.r select 'due_o', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"due":true,"size":200}');
insert into test.r select 'due_1', service.lead_list(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"due":true,"size":200}');
insert into test.r select 'due_2', service.lead_list(test.c('00000000-0000-0000-0000-0000000000a2'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"due":true,"size":200}');
insert into test.r select 'due_b', service.lead_list(test.c('00000000-0000-0000-0000-00000000000b'), 'bbbbbbbb-0000-0000-0000-000000000000', '{"due":true,"size":200}');
insert into test.r select 'due_off', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"due":false,"size":1}');
insert into test.r select 'dup_o', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"duplicates":true,"size":200}');
insert into test.r select 'dup_1', service.lead_list(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"duplicates":true,"size":200}');
insert into test.r select 'dup_2', service.lead_list(test.c('00000000-0000-0000-0000-0000000000a2'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"duplicates":true,"size":200}');
insert into test.r select 'dup_b', service.lead_list(test.c('00000000-0000-0000-0000-00000000000b'), 'bbbbbbbb-0000-0000-0000-000000000000', '{"duplicates":true,"size":200}');
insert into test.r select 'all_o', service.lead_list(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"T29 Vis","size":200}');
insert into test.r select 'all_2', service.lead_list(test.c('00000000-0000-0000-0000-0000000000a2'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"T29 Vis","size":200}');
reset role;
do $$ declare ids uuid[]; want uuid[]; rows jsonb; begin
  ids := array(select (x ->> 'id')::uuid from jsonb_array_elements((select v -> 'rows' from test.r where k = 'due_o')) x order by 1);
  want := array(select v from test.ids where k in ('f_a1_past', 'f_a2_past', 'f_none_past', 't_a1_open', 't_a2_open') order by 1);
  assert ids = want and (select v ->> 'total' from test.r where k = 'due_o') = '5', 'T29d due, as the owner: a follow-up date that has come or an open task whose time has come, nothing else (a future date, a finished task, a task with no time, a task due later): ' || cardinality(ids);
  ids := array(select (x ->> 'id')::uuid from jsonb_array_elements((select v -> 'rows' from test.r where k = 'due_1')) x order by 1);
  want := array(select v from test.ids where k in ('f_a1_past', 't_a1_open') order by 1);
  assert ids = want, 'T29d due, as a1: only the due leads assigned to a1';
  ids := array(select (x ->> 'id')::uuid from jsonb_array_elements((select v -> 'rows' from test.r where k = 'due_2')) x order by 1);
  want := array(select v from test.ids where k in ('f_a2_past', 't_a2_open') order by 1);
  assert ids = want, 'T29d due, as a2: only the due leads assigned to a2';
  assert (select v ->> 'total' from test.r where k = 'due_b') = '0' and jsonb_array_length((select v -> 'rows' from test.r where k = 'due_b')) = 0, 'T29d due, as owner B: nothing of A, and B has nothing due';
  assert (select v ->> 'total' from test.r where k = 'due_off')::int > 5, 'T29d due: false filters nothing';
  rows := (select v -> 'rows' from test.r where k = 'due_o');
  assert (select (x ->> 'follow_up')::timestamptz from jsonb_array_elements(rows) x where x ->> 'id' = test.id('f_a1_past')::text) = (select follow_up_at from leads where id = test.id('f_a1_past')), 'T29d a row carries its follow_up';
  -- duplicates: exactly the flagged leads the caller reads
  ids := array(select (x ->> 'id')::uuid from jsonb_array_elements((select v -> 'rows' from test.r where k = 'dup_o')) x order by 1);
  want := array(select id from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and duplicate_of is not null order by id);
  assert ids = want and cardinality(want) >= 11 and (select v ->> 'total' from test.r where k = 'dup_o')::int = cardinality(want), 'T29d duplicates, as the owner: exactly the flagged leads (' || cardinality(want) || ')';
  ids := array(select (x ->> 'id')::uuid from jsonb_array_elements((select v -> 'rows' from test.r where k = 'dup_1')) x order by 1);
  want := array(select id from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and duplicate_of is not null and owner_team_row = test.id('crm_t1') order by id);
  assert ids = want and test.id('vis3') = any (ids) and not (test.id('vis2') = any (ids)), 'T29d duplicates, as a1: the flagged leads assigned to a1 (vis3), not a2''s (vis2)';
  ids := array(select (x ->> 'id')::uuid from jsonb_array_elements((select v -> 'rows' from test.r where k = 'dup_2')) x order by 1);
  want := array(select id from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and duplicate_of is not null and owner_team_row = test.id('team2') order by id);
  assert ids = want and test.id('vis2') = any (ids), 'T29d duplicates, as a2: the flagged leads assigned to a2';
  ids := array(select (x ->> 'id')::uuid from jsonb_array_elements((select v -> 'rows' from test.r where k = 'dup_b')) x order by 1);
  want := array(select id from leads where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000' and duplicate_of is not null order by id);
  assert ids = want and test.id('cp2') = any (ids) and test.id('cp3') = any (ids) and not (test.id('xb') = any (ids)), 'T29d duplicates, as owner B: only B''s own flagged leads (cp2, cp3; the lead with an email of A''s is none)';
  -- the pointer: the owner sees every other lead; a member sees it only when the other lead is theirs too
  rows := (select v -> 'rows' from test.r where k = 'all_o');
  assert (select x ->> 'duplicate_of' from jsonb_array_elements(rows) x where x ->> 'id' = test.id('vis2')::text) = test.id('vis1')::text
     and (select x ->> 'duplicate_of' from jsonb_array_elements(rows) x where x ->> 'id' = test.id('vis3')::text) = test.id('vis1')::text
     and (select x ->> 'duplicate' from jsonb_array_elements(rows) x where x ->> 'id' = test.id('vis1')::text) = 'false', 'T29d the owner sees the pointer of every duplicate, and a lead nobody duplicates is not flagged';
  rows := (select v -> 'rows' from test.r where k = 'all_2');
  assert jsonb_array_length(rows) = 1 and (rows -> 0 ->> 'id') = test.id('vis2')::text and (rows -> 0 ->> 'duplicate') = 'true' and (rows -> 0 -> 'duplicate_of') = 'null'::jsonb,
    'T29d a member of another lead sees "a duplicate" and nothing of the lead it duplicates: ' || rows::text;
  rows := (select v -> 'rows' from test.r where k = 'dup_1');
  assert (select x ->> 'duplicate_of' from jsonb_array_elements(rows) x where x ->> 'id' = test.id('vis3')::text) = test.id('vis1')::text, 'T29d a member sees the pointer when both leads are theirs';
end $$;
set role omnikom_fn;
select test.expect_error($q$select service.lead_list(test.c('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-000000000000', '{"due":"maybe"}')$q$, 'S-QUERY');
reset role;

-- (e) follow-up and tasks: the walls and the timeline
insert into test.ids select 'fx', test.t29_lead('T29 FX', 'fx.t29@t29.test', null, test.id('crm_t1'));
insert into test.ids select 'fy', test.t29_lead('T29 FY', 'fy.t29@t29.test');
insert into test.ids select 'fz', test.t29_lead('T29 FZ', 'fz.t29@t29.test', null, test.id('team2'));
set role omnikom_fn;
do $$ begin
  assert test.t29_fu('00000000-0000-0000-0000-0000000000a1', test.id('fx'), '2026-12-01 10:00+00') = true, 'T29e a1 sets the follow-up of their lead';
  assert test.t29_fu('00000000-0000-0000-0000-0000000000a1', test.id('fx'), '2026-12-01 10:00+00') = false, 'T29e the same time again changes nothing';
  assert test.t29_fu('00000000-0000-0000-0000-0000000000a1', test.id('fx'), '2026-12-02 09:30+00') = true, 'T29e a new time changes it';
  assert test.t29_fu('00000000-0000-0000-0000-0000000000a1', test.id('fx'), null) = true and test.t29_fu('00000000-0000-0000-0000-0000000000a1', test.id('fx'), null) = false, 'T29e null clears it, once';
  assert test.t29_fu('00000000-0000-0000-0000-00000000000a', test.id('fy'), '2026-12-03 08:00+00') = true, 'T29e the owner sets the follow-up of an unassigned lead';
end $$;
select test.expect_error(format($q$select test.t29_fu('00000000-0000-0000-0000-0000000000a1', %L, now())$q$, test.id('fz')), 'S-NOT-FOUND');   -- a lead assigned to a2
select test.expect_error(format($q$select test.t29_fu('00000000-0000-0000-0000-0000000000a1', %L, now())$q$, test.id('fy')), 'S-NOT-FOUND');   -- an unassigned lead
select test.expect_error(format($q$select test.t29_fu('00000000-0000-0000-0000-00000000000b', %L, now())$q$, test.id('fx')), 'S-NOT-FOUND');   -- owner B
select test.expect_error(format($q$select test.t29_fu('00000000-0000-0000-0000-00000000000e', %L, now())$q$, test.id('fx')), 'S-NOT-FOUND');   -- a login of nothing
select test.expect_error($q$select test.t29_fu('00000000-0000-0000-0000-00000000000a', '99999999-0000-0000-0000-000000000000', now())$q$, 'S-NOT-FOUND');
reset role;
do $$ declare ev jsonb[]; begin
  ev := array(select detail from lead_events where lead_id = test.id('fx') and kind = 'follow-up' order by id);
  assert cardinality(ev) = 3, 'T29e one follow-up event per change, none for an unchanged value: ' || cardinality(ev);
  assert ev[1] -> 'old' = 'null'::jsonb and (ev[1] ->> 'new')::timestamptz = '2026-12-01 10:00+00' and (ev[2] ->> 'old')::timestamptz = '2026-12-01 10:00+00' and (ev[2] ->> 'new')::timestamptz = '2026-12-02 09:30+00'
    and ev[3] -> 'new' = 'null'::jsonb and (ev[3] ->> 'old')::timestamptz = '2026-12-02 09:30+00', 'T29e the event says old and new: ' || ev::text;
  assert (select follow_up_at from leads where id = test.id('fx')) is null and (select follow_up_at from leads where id = test.id('fy')) = '2026-12-03 08:00+00', 'T29e the lead holds the last value';
  assert (select follow_up_at from leads where id = test.id('fz')) is null and not exists (select 1 from lead_events where lead_id = test.id('fz') and kind = 'follow-up'), 'T29e a refused call changed nothing and wrote no event';
end $$;
set role omnikom_fn;
insert into test.ids select 'tk1', test.t29_task('00000000-0000-0000-0000-0000000000a1', test.id('fx'), '  Call back about the survey  ', now() + interval '3 days');
insert into test.ids select 'tk2', test.t29_task('00000000-0000-0000-0000-00000000000a', test.id('fx'), 'Owner task, no time');
select test.expect_error(format($q$select test.t29_task('00000000-0000-0000-0000-0000000000a1', %L, 'Not mine')$q$, test.id('fz')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t29_task('00000000-0000-0000-0000-00000000000b', %L, 'Not B''s')$q$, test.id('fx')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t29_task('00000000-0000-0000-0000-00000000000e', %L, 'Nobody''s')$q$, test.id('fx')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t29_task('00000000-0000-0000-0000-0000000000a1', %L, '   ')$q$, test.id('fx')), 'I-ANSWER text: A task is 1 to 500 characters');
select test.expect_error(format($q$select test.t29_task('00000000-0000-0000-0000-0000000000a1', %L, %L)$q$, test.id('fx'), repeat('t', 501)), 'I-ANSWER text: A task is 1 to 500 characters');
select test.expect_error(format($q$select test.t29_done('00000000-0000-0000-0000-0000000000a2', %L, true)$q$, test.id('tk1')), 'S-NOT-FOUND');   -- a2 on a1's lead's task
select test.expect_error(format($q$select test.t29_done('00000000-0000-0000-0000-00000000000b', %L, true)$q$, test.id('tk1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t29_done('00000000-0000-0000-0000-0000000000a1', %L, null)$q$, test.id('tk1')), 'I-ANSWER done');
select test.expect_error($q$select test.t29_done('00000000-0000-0000-0000-00000000000a', '99999999-0000-0000-0000-000000000000', true)$q$, 'S-NOT-FOUND');
select test.t29_done('00000000-0000-0000-0000-0000000000a1', test.id('tk1'), true);
select test.t29_done('00000000-0000-0000-0000-0000000000a1', test.id('tk1'), true);    -- already done: nothing
select test.t29_done('00000000-0000-0000-0000-00000000000a', test.id('tk2'), false);   -- already open: nothing
reset role;
do $$ declare t public.lead_tasks; begin
  select * into t from lead_tasks where id = test.id('tk1');
  assert t.text = 'Call back about the survey' and t.done_at is not null and t.due_at > now() + interval '2 days' and t.created_by = '00000000-0000-0000-0000-0000000000a1' and t.workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000', 'T29e the task is trimmed, done, with its time and its author: ' || t::text;
  assert (select array_agg(detail ->> 'action' order by id) from lead_events where lead_id = test.id('fx') and kind = 'task') = array['added', 'added', 'done'], 'T29e the timeline: added, added, done once (asking for the state it is in writes nothing): ' || (select array_agg(detail ->> 'action' order by id)::text from lead_events where lead_id = test.id('fx') and kind = 'task');
  assert (select detail ->> 'text' from lead_events where lead_id = test.id('fx') and detail ->> 'action' = 'done') = 'Call back about the survey' and (select detail ->> 'task' from lead_events where lead_id = test.id('fx') and detail ->> 'action' = 'done') = test.id('tk1')::text, 'T29e the event names the task';
end $$;
set role omnikom_fn;
select test.t29_done('00000000-0000-0000-0000-0000000000a1', test.id('tk1'), false);
reset role;
do $$ begin
  assert (select done_at from lead_tasks where id = test.id('tk1')) is null and (select array_agg(detail ->> 'action' order by id) from lead_events where lead_id = test.id('fx') and kind = 'task') = array['added', 'added', 'done', 'reopened'], 'T29e reopening writes one reopened event';
end $$;
-- who reads a lead's tasks: the leads_read rule
set role authenticated;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin assert (select count(*) from lead_tasks where lead_id = test.id('fx')) = 2 and (select count(*) from lead_tasks) >= 2, 'T29f a1 reads the tasks of their own lead'; end $$;
select test.act_as('00000000-0000-0000-0000-0000000000a2');
do $$ begin assert (select count(*) from lead_tasks where lead_id = test.id('fx')) = 0 and (select count(*) from lead_tasks where lead_id = test.id('t_a2_open')) = 1 and (select count(*) from lead_tasks where lead_id = test.id('t_a1_open')) = 0, 'T29f a2 reads the tasks of leads assigned to a2 and none of a1''s'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from lead_tasks where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = (select count(*) from lead_tasks), 'T29f the owner reads every task of the workspace'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from lead_tasks where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0, 'T29f owner B reads no task of A'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000e');
do $$ begin assert (select count(*) from lead_tasks) = 0, 'T29f a login of nothing reads no task'; end $$;
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$insert into lead_tasks (lead_id, workspace_id, text) select id, workspace_id, 'T29 direct' from leads limit 1$q$, 'permission denied');
select test.expect_error($q$update lead_tasks set done_at = now()$q$, 'permission denied');
select test.expect_error($q$delete from lead_tasks$q$, 'permission denied');
reset role;
select test.act_as(null);
-- a lead keeps at most 100 tasks
insert into lead_tasks (lead_id, workspace_id, text) select test.id('fy'), 'aaaaaaaa-0000-0000-0000-000000000000', 'T29 filler ' || i from generate_series(1, 100) i;
set role omnikom_fn;
select test.expect_error(format($q$select test.t29_task('00000000-0000-0000-0000-00000000000a', %L, 'one too many')$q$, test.id('fy')), 'I-ANSWER tasks: A lead keeps at most 100 tasks');
reset role;
-- deleting a lead takes its tasks with it; deleting a workspace's people is not needed here
delete from leads where id = test.id('fy');
do $$ begin assert (select count(*) from lead_tasks where text like 'T29 filler%') = 0, 'T29f deleting a lead deletes its tasks'; end $$;

-- (g) the new tables and functions are closed as the rest: no client write, nothing for anon, the function role has no table, definer with an empty search_path
do $$ declare f text; t text; begin
  foreach f in array array['service.view_save(jsonb,uuid,jsonb)', 'service.view_delete(jsonb,uuid)', 'service.lead_follow_up(jsonb,uuid,timestamptz)', 'service.task_add(jsonb,uuid,text,timestamptz)', 'service.task_done(jsonb,uuid,boolean)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not exists (select 1 from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) a where a.grantee = 0), f || ' is closed to anon, authenticated and PUBLIC';
    assert has_function_privilege('omnikom_fn', f, 'execute'), f || ' is open to the function role';
    assert (select prosecdef from pg_proc where oid = f::regprocedure) and (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' is a definer function with an empty search_path';
  end loop;
  foreach f in array array['service.lead_list(jsonb,uuid,jsonb)', 'private.lead_duplicate_of(uuid,text,text)', 'private.lead_set_duplicate()', 'private.lead_query_check(uuid,jsonb)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not exists (select 1 from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) a where a.grantee = 0), f || ' is closed to anon, authenticated and PUBLIC';
    assert (select prosecdef from pg_proc where oid = f::regprocedure) and (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' is a definer function with an empty search_path';
  end loop;
  foreach t in array array['public.crm_views', 'public.lead_tasks'] loop
    assert (select relrowsecurity from pg_class where oid = t::regclass), t || ' has row level security';
    assert not has_table_privilege('anon', t, 'select') and has_table_privilege('authenticated', t, 'select') and not has_table_privilege('authenticated', t, 'insert') and not has_table_privilege('authenticated', t, 'update')
      and not has_table_privilege('authenticated', t, 'delete') and not has_table_privilege('omnikom_fn', t, 'select'), t || ' is read-only for logins, closed to anon and to the function role';
  end loop;
end $$;

-- ===== T26 work order 15 (migration 20): security events are bucketed per source and minute =====
-- Fresh uuids per run and deltas, never totals: security_events is append-only, so staging already holds events. The whole file is one transaction, so now() (and
-- the bucket minute) is the same throughout. Each part uses its own kind and code, so the walls do not depend on the events of T1 to T25.
set role service_role;
-- T26a: 50 calls from one source in one minute write one security_events row and one bucket with n = 50, and every call returns the same id
select set_config('test.t26_site', gen_random_uuid()::text, false) is not null as site;
do $$ declare i int; ids bigint[] := '{}'; begin
  for i in 1..50 loop ids := ids || service.record_security_event('suspended', 'T26A', null, current_setting('test.t26_site')::uuid, null, repeat('a', 64), '{"path":"/capture-lead"}'); end loop;
  perform set_config('test.t26_first', ids[1]::text, false);
  assert (select count(distinct x) from unnest(ids) x) = 1, 'T26a every call of one bucket returned the same id: ' || (select string_agg(distinct x::text, ',') from unnest(ids) x);
end $$;
-- T26b: 30 anonymous calls from 30 fresh sites: at most 10 plain buckets plus one overflow bucket write a row; the counts still add up to 30
select set_config('test.t26b_before', (select count(*) from security_events where kind = 'bad-request' and code = 'T26B')::text, false) is not null as before;
do $$ declare i int; begin
  for i in 1..30 loop perform service.record_security_event('bad-request', 'T26B', null, gen_random_uuid(), null, repeat('b', 64)); end loop;
end $$;
-- T26c: the ceiling of one kind is full of anonymous buckets (10 fresh sites), then 15 signed-in refusals from 15 fresh sites: 15 rows, never folded
select set_config('test.t26_actor', gen_random_uuid()::text, false) is not null as actor;
do $$ declare i int; begin
  for i in 1..10 loop perform service.record_security_event('auth-refused', 'T26C', null, gen_random_uuid(), null, repeat('c', 64)); end loop;
  for i in 1..15 loop perform service.record_security_event('auth-refused', 'T26C', null, gen_random_uuid(), current_setting('test.t26_actor')::uuid, repeat('c', 64)); end loop;
end $$;
reset role;
do $$ begin
  assert (select count(*) from security_events where site_id = current_setting('test.t26_site')::uuid) = 1, 'T26a 50 calls from one source wrote exactly one security_events row';
  assert (select count(*) from security_event_counts where site_id = current_setting('test.t26_site')::uuid) = 1, 'T26a one bucket';
  assert (select n from security_event_counts where site_id = current_setting('test.t26_site')::uuid and kind = 'suspended') = 50, 'T26a the bucket counts all 50 calls';
  assert (select event_id from security_event_counts where site_id = current_setting('test.t26_site')::uuid) = current_setting('test.t26_first')::bigint, 'T26a the bucket points at the row of its first event';
  assert (select detail ->> 'path' from security_events where id = current_setting('test.t26_first')::bigint) = '/capture-lead', 'T26a the row keeps the first event''s detail';
end $$;
do $$ declare grown int; plain int; folded int; begin
  select count(*) - current_setting('test.t26b_before')::int into grown from security_events where kind = 'bad-request' and code = 'T26B';
  assert grown between 1 and 11, 'T26b 30 anonymous sources wrote at most 11 rows (10 buckets and the overflow one), not 30: ' || grown;
  select coalesce(sum(n), 0) into plain from security_event_counts where kind = 'bad-request' and code = 'T26B' and not overflow;
  select coalesce(sum(n), 0) into folded from security_event_counts where kind = 'bad-request' and code = 'T26B' and overflow;
  assert plain + folded = 30, 'T26b the plain buckets and the overflow bucket count all 30 events: ' || plain || ' + ' || folded;
  assert plain <= 10 and folded >= 20, 'T26b at most 10 plain buckets, the rest folded: ' || plain || ' plain, ' || folded || ' folded';
  assert (select count(*) from security_events where kind = 'bad-request' and code = 'T26B' and detail = '{"overflow": true}') = 1, 'T26b the overflow bucket has one row marked overflow';
end $$;
do $$ begin
  assert (select count(*) from security_events where kind = 'auth-refused' and code = 'T26C' and actor = current_setting('test.t26_actor')::uuid) = 15, 'T26c 15 signed-in refusals from 15 sites wrote 15 rows';
  assert (select count(*) from security_event_counts where kind = 'auth-refused' and code = 'T26C' and actor = current_setting('test.t26_actor')::uuid and not overflow) = 15, 'T26c 15 buckets, none folded into the overflow bucket';
end $$;
-- T26e: two calls from one source in one minute with a different detail->>'fn' are two buckets and two rows (fn is part of the key); the same fn twice is one
set role service_role;
select set_config('test.t26e_site', gen_random_uuid()::text, false) is not null as site;
do $$ declare s uuid := current_setting('test.t26e_site')::uuid; begin
  perform service.record_security_event('bad-signature', 'T26E', null, s, null, repeat('e', 64), '{"fn":"alpha"}');
  perform service.record_security_event('bad-signature', 'T26E', null, s, null, repeat('e', 64), '{"fn":"beta"}');
  perform service.record_security_event('bad-signature', 'T26E', null, s, null, repeat('e', 64), '{"fn":"beta"}');
end $$;
reset role;   -- service_role cannot read the counts: the superuser reads them
do $$ declare s uuid := current_setting('test.t26e_site')::uuid; begin
  assert (select count(*) from security_event_counts where site_id = s and kind = 'bad-signature') = 2, 'T26e two functions in one minute are two buckets';
  assert (select count(*) from security_events where site_id = s and kind = 'bad-signature') = 2, 'T26e two buckets wrote two rows';
  assert (select n from security_event_counts where site_id = s and fn = 'alpha') = 1 and (select n from security_event_counts where site_id = s and fn = 'beta') = 2, 'T26e each bucket counts its own function''s calls';
end $$;
-- T26d: only the definer function writes the buckets; an owner reads none; staff with MFA read them
set role service_role;
select test.expect_error($q$insert into security_event_counts (kind, minute, event_id) values ('refused', now(), 1)$q$, 'permission denied');
select test.expect_error($q$update security_event_counts set n = 0$q$, 'permission denied');
select test.expect_error($q$delete from security_event_counts$q$, 'permission denied');
select test.expect_error($q$select count(*) from security_event_counts$q$, 'permission denied');
reset role;
set role omnikom_fn;
select test.expect_error($q$insert into security_event_counts (kind, minute, event_id) values ('refused', now(), 1)$q$, 'permission denied');
select test.expect_error($q$update security_event_counts set n = 0$q$, 'permission denied');
select test.expect_error($q$delete from security_event_counts$q$, 'permission denied');
reset role;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from security_event_counts) = 0, 'T26d owners never read the security event counts'; end $$;
select test.expect_error($q$update security_event_counts set n = 0$q$, 'permission denied');
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select n from security_event_counts where site_id = current_setting('test.t26_site')::uuid and kind = 'suspended') = 50, 'T26d staff with MFA read the buckets'; end $$;
reset role;

-- ===== T30 the media bucket limits (work order 16, migration 21): the bucket itself refuses a body over 25 MB or of another type, signed upload URLs
-- included; no signed-in user, member or owner, writes an object directly. The two limits equal upload-start's MAX_BYTES and MIMES (run-local.mjs reads them) =====
do $$ begin
  assert (select file_size_limit from storage.buckets where id = 'media') = 26214400, 'T30a the media bucket caps a file at 26214400 bytes';
  assert (select count(*) from storage.buckets where id = 'media' and allowed_mime_types @> array['image/jpeg','image/png','image/webp','image/heic','application/pdf'] and allowed_mime_types <@ array['image/jpeg','image/png','image/webp','image/heic','application/pdf']) = 1,
    'T30a the media bucket allows exactly the five types: ' || coalesce((select allowed_mime_types::text from storage.buckets where id = 'media'), 'null');
  assert (select cardinality(allowed_mime_types) from storage.buckets where id = 'media') = 5, 'T30a no type is listed twice';
end $$;
-- T30b: an owner and a member each get a refusal for a direct insert into their own workspace's folder (the policy is gone, so no policy admits it)
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.expect_error($q$insert into storage.objects (bucket_id, name) values ('media', 'aaaaaaaa-0000-0000-0000-000000000000/owner.png')$q$, 'row-level security');
select test.act_as('00000000-0000-0000-0000-0000000000a1');
select test.expect_error($q$insert into storage.objects (bucket_id, name) values ('media', 'aaaaaaaa-0000-0000-0000-000000000000/member.png')$q$, 'row-level security');
do $$ begin assert (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'ALL')) = 0, 'T30b no policy on storage.objects admits an insert'; end $$;
-- T30b: reading survives: the member sees A's folder (the object the superuser inserted in T10)
do $$ begin assert (select count(*) from storage.objects where name like 'aaaaaaaa-%') = 1, 'T30b a member still reads their workspace''s folder'; end $$;
reset role;

-- ===== T31 work order 20 (migration 23): lead type and status as per-industry lists held as data; note authors; one domain, one site (own block; mutants "crm23: ..." in run-local.mjs) =====
-- ===================================================================================================================================
-- The fixture contract of both workspaces carries a crm block (lead types enquiry, buy, sell, listing-question; statuses with each of the three flags) and a contact
-- form whose `topic` answer picks the type. Leads are inserted directly (the guard is a trigger on the table, so it sees every writer), through lead_update,
-- lead_set_fields, leads_bulk, capture_lead, add_lead and import_leads. The enum conversion and the note backfill are run against a database that has migrations
-- 1 to 22 and real rows first: run-local.mjs "upgrade" (it cannot be asserted from here, the migration has already run).
reset role;
select test.act_as(null);
create function test.t31_lead(p_name text, p_team uuid default null, p_ws uuid default 'aaaaaaaa-0000-0000-0000-000000000000', p_status text default 'not-contacted', p_type text default 'enquiry',
  p_date date default null, p_form text default 'zz-t31') returns uuid language sql as $$
  insert into leads (workspace_id, site_id, form, page_path, name, consent_text, owner_team_row, status, lead_type, status_date)
  values (p_ws, case when p_ws = 'aaaaaaaa-0000-0000-0000-000000000000' then 'aaaaaaaa-0000-0000-0000-00000000517e'::uuid else 'bbbbbbbb-0000-0000-0000-00000000517e'::uuid end,
    p_form, '/', p_name, 'I agree', p_team, p_status, p_type, p_date) returning id $$;
create function test.t31_upd(p_sub text, p_lead uuid, p_status text default null, p_date date default null, p_who uuid default null, p_text text default null, p_note text default null)
returns void language sql as $$ select service.lead_update(test.c(p_sub), p_lead, p_status, null, p_note, false, p_date, p_who, p_text) $$;
create function test.t31_list(p_sub text, p_ws uuid, p_q jsonb default '{}') returns jsonb language sql as $$ select service.lead_list(test.c(p_sub), p_ws, p_q) $$;
create function test.t31_names(p_list jsonb) returns text language sql as $$
  select coalesce(string_agg(r.v ->> 'name', ',' order by r.ord), '') from jsonb_array_elements(p_list -> 'rows') with ordinality r(v, ord) $$;
grant execute on function test.t31_lead(text, uuid, uuid, text, text, date, text), test.t31_upd(text, uuid, text, date, uuid, text, text), test.t31_list(text, uuid, jsonb),
  test.t31_names(jsonb) to anon, authenticated, service_role, omnikom_fn;

insert into test.ids select 'l31_a1', test.t31_lead('T31 a1 lead', test.id('crm_t1'));       -- assigned to agent one
insert into test.ids select 'l31_free', test.t31_lead('T31 free lead');                     -- assigned to nobody
insert into test.ids select 'l31_b', test.t31_lead('T31 B lead', null, 'bbbbbbbb-0000-0000-0000-000000000000');

-- (a) the guard sees every writer: a table insert and a table update are refused too, in the words the screens show
select test.expect_error($q$insert into leads (workspace_id, site_id, form, page_path, name, consent_text, status) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', 'zz-t31', '/', 'T31 bad', 'I agree', 'bogus')$q$, 'I-ANSWER status: Status must be one of this business''s statuses');
select test.expect_error(format($q$update leads set status = 'bogus' where id = %L$q$, test.id('l31_a1')), 'I-ANSWER status: Status must be one of this business''s statuses');
select test.expect_error($q$insert into leads (workspace_id, site_id, form, page_path, name, consent_text, lead_type) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', 'zz-t31', '/', 'T31 bad', 'I agree', 'bogus')$q$, 'I-ANSWER lead_type: Lead type must be one of this business''s lead types');
select test.expect_error(format($q$update leads set lead_type = 'bogus' where id = %L$q$, test.id('l31_a1')), 'I-ANSWER lead_type');
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-00000000000a', %L, 'bogus')$q$, test.id('l31_a1')), 'I-ANSWER status');
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-00000000000a', %L, 'Contacted')$q$, test.id('l31_a1')), 'I-ANSWER status');   -- a key, not its label
do $$ begin
  assert (select status from leads where id = test.id('l31_a1')) = 'not-contacted' and (select lead_type from leads where id = test.id('l31_a1')) = 'enquiry', 'T31a refused writes changed nothing';
  assert (select count(*) from leads where name = 'T31 bad') = 0, 'T31a refused inserts stored nothing';
end $$;
-- a status the list dropped since stays as it is while only other columns change (older rows stay editable), and is never set again
alter table leads disable trigger leads_guard;
update leads set status = 'legacy-x' where id = test.id('l31_free');
alter table leads enable trigger leads_guard;
update leads set name = 'T31 free lead renamed' where id = test.id('l31_free');
select test.expect_error(format($q$update leads set status = 'legacy-y' where id = %L$q$, test.id('l31_free')), 'I-ANSWER status');
update leads set name = 'T31 free lead', status = 'not-contacted' where id = test.id('l31_free');
do $$ begin assert (select status from leads where id = test.id('l31_free')) = 'not-contacted', 'T31a an older row with a dropped status is editable and can be moved to a listed one'; end $$;

-- (b) the list is the site's own: B's list has no "qualified"; A's has it; nobody reaches the other's lead
update site_contracts set resolved = jsonb_set(resolved, '{crm,statuses}', '[{"key":"not-contacted","label":"Not contacted yet"},{"key":"contacted","label":"Contacted","needsWho":true}]')
  where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000';
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-00000000000b', %L, 'qualified')$q$, test.id('l31_b')), 'I-ANSWER status');
select test.expect_error(format($q$update leads set status = 'qualified' where id = %L$q$, test.id('l31_b')), 'I-ANSWER status');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), 'qualified');
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-00000000000b', %L, 'qualified')$q$, test.id('l31_a1')), 'S-NOT-FOUND');
do $$ begin
  assert (select status from leads where id = test.id('l31_a1')) = 'qualified' and (select status from leads where id = test.id('l31_b')) = 'not-contacted', 'T31b A has its own list, B its own';
  assert exists (select 1 from lead_events where lead_id = test.id('l31_a1') and kind = 'status' and detail ->> 'from' = 'not-contacted' and detail ->> 'to' = 'qualified'), 'T31b the change wrote its event';
  assert private.status_def('bbbbbbbb-0000-0000-0000-000000000000', 'spam') ->> 'system' = 'true' and private.status_def('aaaaaaaa-0000-0000-0000-000000000000', 'spam') ->> 'system' = 'true', 'T31b spam is a system status in every business, outside the list';
end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), 'spam');
do $$ begin assert (select status from leads where id = test.id('l31_a1')) = 'spam', 'T31b spam is accepted although it is not in the list'; end $$;

-- (c) a status that needs a date
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-00000000000a', %L, 'call-back')$q$, test.id('l31_a1')), 'I-ANSWER status_date: Call back needs a date');
select test.expect_error(format($q$update leads set status = 'call-back' where id = %L$q$, test.id('l31_a1')), 'I-ANSWER status_date');
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-00000000000a', %L, 'appointment-set', null, '00000000-0000-0000-0000-0000000000a1')$q$, test.id('l31_a1')), 'I-ANSWER status_date');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), 'call-back', date '2026-12-24');
do $$ declare e jsonb; begin
  assert (select status from leads where id = test.id('l31_a1')) = 'call-back' and (select status_date from leads where id = test.id('l31_a1')) = date '2026-12-24' and (select status_who from leads where id = test.id('l31_a1')) is null, 'T31c a call back with its date';
  select detail into e from lead_events where lead_id = test.id('l31_a1') and kind = 'status' and detail ->> 'to' = 'call-back';
  assert e ->> 'date' = '2026-12-24' and e ->> 'from' = 'spam', 'T31c the event says the date: ' || e::text;
end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), null, date '2026-12-31');   -- the same status, a new day
do $$ begin
  assert (select status_date from leads where id = test.id('l31_a1')) = date '2026-12-31', 'T31c the date moves on the same status';
  assert (select count(*) from lead_events where lead_id = test.id('l31_a1') and kind = 'status' and detail ->> 'to' = 'call-back') = 2, 'T31c and says so';
end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), 'qualified');
do $$ begin assert (select status_date from leads where id = test.id('l31_a1')) is null, 'T31c a status that does not take a date clears it'; end $$;

-- (d) a status that records who: the caller by default, a member by name, never an outsider
select test.t31_upd('00000000-0000-0000-0000-0000000000a1', test.id('l31_a1'), 'contacted');
do $$ begin assert (select status_who from leads where id = test.id('l31_a1')) = '00000000-0000-0000-0000-0000000000a1', 'T31d "contacted" by agent one is by agent one'; end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), 'contacted', null, '00000000-0000-0000-0000-0000000000a2');   -- the owner names the member who spoke to the lead
do $$ declare e jsonb; begin
  assert (select status_who from leads where id = test.id('l31_a1')) = '00000000-0000-0000-0000-0000000000a2', 'T31d a member named by the owner';
  select detail into e from lead_events where lead_id = test.id('l31_a1') and kind = 'status' and detail ->> 'who' = '00000000-0000-0000-0000-0000000000a2';
  assert e ->> 'who_name' is not null and e -> 'author' ->> 'kind' = 'user', 'T31d the event carries the person''s name and its author: ' || coalesce(e::text, 'none');
end $$;
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-00000000000a', %L, 'contacted', null, '00000000-0000-0000-0000-00000000000b')$q$, test.id('l31_a1')), 'I-ANSWER status_who: Pick a member of this business');
select test.expect_error(format($q$update leads set status_who = '00000000-0000-0000-0000-00000000000b' where id = %L$q$, test.id('l31_a1')), 'I-ANSWER status_who');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), 'qualified');
do $$ begin assert (select status_who from leads where id = test.id('l31_a1')) is null, 'T31d a status that does not record who clears it'; end $$;

-- (e) a status that asks for one line
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), 'interested', null, null, '  Pool homes in Napa  ');
do $$ begin assert (select status_text from leads where id = test.id('l31_a1')) = 'Pool homes in Napa', 'T31e the line is kept, trimmed'; end $$;
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, jsonb_build_object('status_text', repeat('x', 201)))$q$, test.id('l31_a1')), 'I-ANSWER status_text');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), 'qualified', null, null, 'ignored');
do $$ begin assert (select status_text from leads where id = test.id('l31_a1')) is null, 'T31e a status that does not ask for a line clears it'; end $$;

-- (f) a member sets a status only on a lead assigned to them
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-0000000000a2', %L, 'contacted')$q$, test.id('l31_a1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-0000000000a1', %L, 'contacted')$q$, test.id('l31_free')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-0000000000a2'), %L, '{"status":"contacted"}')$q$, test.id('l31_a1')), 'S-NOT-FOUND');
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-0000000000a2'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L]::uuid[], 'status', 'contacted')$q$, test.id('l31_a1')), 'S-NOT-FOUND');
select test.t31_upd('00000000-0000-0000-0000-0000000000a1', test.id('l31_a1'), 'contacted');   -- their own: fine
do $$ begin assert (select status from leads where id = test.id('l31_a1')) = 'contacted' and (select status from leads where id = test.id('l31_free')) = 'not-contacted', 'T31f refused member writes changed nothing'; end $$;

-- (g) the edit call: status with its companions, and the lead type
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"status":"call-back"}')$q$, test.id('l31_a1')), 'I-ANSWER status_date');
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('l31_a1'), '{"status":"call-back","status_date":"2026-12-25"}');
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('l31_a1'), '{"lead_type":"buy"}');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"lead_type":"zzz"}')$q$, test.id('l31_a1')), 'I-ANSWER lead_type');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"status":"contacted","status_who":"00000000-0000-0000-0000-00000000000b"}')$q$, test.id('l31_a1')), 'I-ANSWER status_who');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"status_date":"next week"}')$q$, test.id('l31_a1')), 'I-ANSWER status_date');
do $$ begin
  assert (select status from leads where id = test.id('l31_a1')) = 'call-back' and (select status_date from leads where id = test.id('l31_a1')) = date '2026-12-25' and (select lead_type from leads where id = test.id('l31_a1')) = 'buy', 'T31g status with its date and a lead type, by the edit call';
  assert exists (select 1 from lead_events where lead_id = test.id('l31_a1') and kind = 'edited' and detail ->> 'field' = 'lead_type' and detail ->> 'old' = 'enquiry' and detail ->> 'new' = 'buy'), 'T31g the lead type change is an event';
end $$;

-- (h) bulk: a status that needs a date is one lead at a time; the others default the caller as "who"
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L]::uuid[], 'status', 'call-back')$q$, test.id('l31_a1')), 'I-ANSWER status: Call back needs a date');
select test.expect_error(format($q$select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[%L]::uuid[], 'status', 'bogus')$q$, test.id('l31_a1')), 'I-ANSWER status');
select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[test.id('l31_a1'), test.id('l31_free')], 'status', 'contacted');
do $$ begin
  assert (select count(*) from leads where id in (test.id('l31_a1'), test.id('l31_free')) and status = 'contacted' and status_who = '00000000-0000-0000-0000-00000000000a' and status_date is null) = 2, 'T31h bulk contacted: by the caller, no date left over';
end $$;

-- (i) capture sets the type from the form: a mapped answer, an unmapped one, none, a fixed type; a type the list dropped is "enquiry" (the lead is kept)
insert into test.ids select 'cap_buy', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'T31 Cap Buy', 'capbuy@t31.test', null, '{"topic":"buy"}', 'I agree');
insert into test.ids select 'cap_ask', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'T31 Cap Ask', 'capask@t31.test', null, '{"topic":"ask-about-this-home"}', 'I agree');
insert into test.ids select 'cap_odd', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'T31 Cap Odd', 'capodd@t31.test', null, '{"topic":"something else"}', 'I agree');
insert into test.ids select 'cap_none', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'contact', '/', 'T31 Cap None', 'capnone@t31.test', null, '{}', 'I agree');
insert into test.ids select 'cap_sell', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'seller', '/', 'T31 Cap Sell', 'capsell@t31.test', null, '{}', 'I agree');
do $$ begin
  assert (select lead_type from leads where id = test.id('cap_buy')) = 'buy', 'T31i a submission whose topic is buy is stored as buy';
  assert (select lead_type from leads where id = test.id('cap_ask')) = 'listing-question', 'T31i an "Ask about this home" submission is stored as listing-question (the ELEV8 form, work order 20 finding)';
  assert (select lead_type from leads where id = test.id('cap_odd')) = 'enquiry' and (select lead_type from leads where id = test.id('cap_none')) = 'enquiry', 'T31i an unmapped or missing answer is enquiry';
  assert (select lead_type from leads where id = test.id('cap_sell')) = 'sell', 'T31i a form with a fixed leadType gives that type';
  assert (select status from leads where id = test.id('cap_buy')) = 'not-contacted', 'T31i a new lead starts at not-contacted';
end $$;
update site_contracts set resolved = jsonb_set(resolved, '{crm,lead_types}', '[{"key":"enquiry","label":"Enquiry"},{"key":"buy","label":"Buy a home"}]') where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000';
insert into test.ids select 'cap_gone', service.capture_lead('bbbbbbbb-0000-0000-0000-00000000517e', 'seller', '/', 'T31 Cap Gone', 'capgone@t31.test', null, '{}', 'I agree');
do $$ begin assert (select lead_type from leads where id = test.id('cap_gone')) = 'enquiry', 'T31i a type the list dropped falls back to enquiry and the lead is stored'; end $$;
insert into test.ids select 'man_1', service.add_lead(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e', 'T31 Manual', 'man@t31.test', null, '{}', 'Said yes', 'manual', null);
do $$ begin assert (select lead_type from leads where id = test.id('man_1')) = 'enquiry' and (select status from leads where id = test.id('man_1')) = 'not-contacted', 'T31i a hand-entered lead is an enquiry, not contacted yet'; end $$;

-- (j) import reads the business's list: a key or a label in any case, a status that needs a date cannot come from a file
create function test.t31_imp(p_rows jsonb) returns jsonb language sql as $$
  select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select v #>> '{}' from test.r where k = 'tplA')::uuid, p_rows, '{}') $$;
grant execute on function test.t31_imp(jsonb) to anon, authenticated, service_role, omnikom_fn;
do $$ declare d jsonb; begin
  d := test.t31_imp('[{"line":2,"name":"T31 Imp One","status":"Qualified"},{"line":3,"name":"T31 Imp Two","status":"contacted"},{"line":4,"name":"T31 Imp Three","status":"Call back"},{"line":5,"name":"T31 Imp Four","status":"Hot"},{"line":6,"name":"T31 Imp Five"}]');
  assert (d ->> 'valid')::int = 3 and (d ->> 'refused_count')::int = 2, 'T31j the dry run: two of five refused: ' || d::text;
  assert (select string_agg(x ->> 'line' || ':' || (x ->> 'reason'), ' | ' order by x ->> 'line') from jsonb_array_elements(d -> 'refused') x)
    = '4:Call back needs a date, so a file cannot set it; import the lead as Not contacted yet and set it in the CRM | 5:Status must be one of this business''s statuses', 'T31j the refusals say why: ' || (d -> 'refused')::text;
  assert (select string_agg(s ->> 'status', ',' order by (s ->> 'line')::int) from jsonb_array_elements(d -> 'sample') s) = 'qualified,contacted,not-contacted', 'T31j the sample: a label becomes its key, empty is not-contacted: ' || (d -> 'sample')::text;
end $$;

-- (j2) the import template may name the lead type, and a file may carry it (head's ruling E): a key or a label of the business's list, empty is enquiry, a stranger is refused
select service.save_crm_template(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'T31 type map', 'custom', 'import', '[{"header":"Name","field":"name"},{"header":"Type","field":"lead_type"}]');
select test.expect_error($q$select service.save_crm_template(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', null, 'T31 bad map', 'custom', 'import', '[{"header":"Type","field":"lead_typo"}]')$q$, 'T-COLUMNS');
do $$ declare d jsonb; begin
  d := test.t31_imp('[{"line":2,"name":"T31 Typed One","lead_type":"Buy a home"},{"line":3,"name":"T31 Typed Two","lead_type":"sell"},{"line":4,"name":"T31 Typed Three","lead_type":"nonsense"},{"line":5,"name":"T31 Typed Four"}]');
  assert (d ->> 'valid')::int = 3 and (d ->> 'refused_count')::int = 1 and d -> 'refused' -> 0 ->> 'field' = 'lead_type', 'T31j2 one of four refused for its lead type: ' || d::text;
  assert (select string_agg(s ->> 'lead_type', ',' order by (s ->> 'line')::int) from jsonb_array_elements(d -> 'sample') s) = 'buy,sell,enquiry', 'T31j2 a label becomes its key, empty is enquiry: ' || (d -> 'sample')::text;
end $$;
select service.import_leads(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', (select v #>> '{}' from test.r where k = 'tplA')::uuid,
  '[{"line":2,"name":"T31 Typed Real","lead_type":"Sell a home"}]', ('{"dry_run":false,"consent":true,"duplicates":"add","file_name":"t31.csv","file_sha256":"' || repeat('a', 64) || '"}')::jsonb);
do $$ begin assert (select lead_type from leads where name = 'T31 Typed Real') = 'sell', 'T31j2 a real import stores the lead type'; end $$;

-- (k) lists, filters and sort through lead_list
insert into test.ids select 'f_nc', test.t31_lead('T31 sort nc');
insert into test.ids select 'f_ct', test.t31_lead('T31 sort ct', null, 'aaaaaaaa-0000-0000-0000-000000000000', 'contacted', 'buy');
insert into test.ids select 'f_ql', test.t31_lead('T31 sort ql', null, 'aaaaaaaa-0000-0000-0000-000000000000', 'qualified', 'sell');
insert into test.ids select 'f_cb', test.t31_lead('T31 sort cb', null, 'aaaaaaaa-0000-0000-0000-000000000000', 'call-back', 'buy', date '2027-01-05');
insert into test.ids select 'f_cb2', test.t31_lead('T31 sort cb2', null, 'aaaaaaaa-0000-0000-0000-000000000000', 'call-back', 'enquiry', date '2027-02-05');
-- one transaction gives every row the same created_at; the tie between equal statuses breaks newest first, so make cb2 the newer
update leads set created_at = created_at + interval '1 minute' where id = test.id('f_cb2');
do $$ declare x jsonb; begin
  x := test.t31_list('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"T31 sort","sort":{"field":"status","dir":"asc"}}');
  assert test.t31_names(x) = 'T31 sort nc,T31 sort ct,T31 sort ql,T31 sort cb2,T31 sort cb', 'T31k status sorts by its place in the business''s list, not by its letters: ' || test.t31_names(x);
  x := test.t31_list('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"T31 sort","sort":{"field":"status","dir":"desc"},"size":2}');
  assert test.t31_names(x) = 'T31 sort cb2,T31 sort cb' or test.t31_names(x) = 'T31 sort cb,T31 sort cb2', 'T31k and descending: ' || test.t31_names(x);
  x := test.t31_list('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"T31 sort","filters":[{"field":"lead_type","op":"eq","value":"buy"}],"sort":{"field":"name","dir":"asc"}}');
  assert test.t31_names(x) = 'T31 sort cb,T31 sort ct', 'T31k filter by lead type: ' || test.t31_names(x);
  x := test.t31_list('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"T31 sort","filters":[{"field":"status","op":"in","values":["qualified","call-back"]}],"sort":{"field":"name","dir":"asc"}}');
  assert test.t31_names(x) = 'T31 sort cb,T31 sort cb2,T31 sort ql', 'T31k filter by status: ' || test.t31_names(x);
  x := test.t31_list('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"T31 sort","filters":[{"field":"status_date","op":"range","from":"2027-01-01","to":"2027-01-31"}]}');
  assert test.t31_names(x) = 'T31 sort cb', 'T31k filter by status date (a range): ' || test.t31_names(x);
  x := test.t31_list('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"search":"T31 sort","sort":{"field":"status_date","dir":"asc"}}');
  assert (test.t31_names(x) like 'T31 sort cb,T31 sort cb2,%'), 'T31k sort by status date: ' || test.t31_names(x);
  assert (x -> 'rows' -> 0 ->> 'lead_type') = 'buy' and (x -> 'rows' -> 0 ->> 'status') = 'call-back' and (x -> 'rows' -> 0 ->> 'status_date') = '2027-01-05' and x -> 'rows' -> 0 ? 'status_who' and x -> 'rows' -> 0 ? 'status_text', 'T31k every row carries the five columns: ' || (x -> 'rows' -> 0)::text;
  assert jsonb_array_length(x -> 'lead_types') = 4 and (x -> 'statuses' -> 1 ->> 'key') = 'contacted' and (x -> 'statuses' -> 1 ->> 'needsWho')::boolean, 'T31k the answer carries the business''s two lists, in order, with the flags';
  assert (select jsonb_array_length(test.t31_list('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', '{}') -> 'lead_types')) = 2, 'T31k B reads B''s own lists';
end $$;
select test.expect_error($q$select test.t31_list('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"filters":[{"field":"lead_kind","op":"eq","value":"x"}]}')$q$, 'S-QUERY');
-- a saved view takes the new keys as columns, filters and sort, and still refuses an unknown one
select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000',
  '{"name":"T31 view","query":{"filters":[{"field":"lead_type","op":"eq","value":"buy"},{"field":"status_date","op":"not_empty"}],"sort":{"field":"status","dir":"asc"}},"columns":["name","lead_type","status","status_date","status_who","status_text"]}');
select test.expect_error($q$select test.t29_save('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '{"name":"T31 view bad","columns":["lead_kind"]}')$q$, 'I-ANSWER columns: lead_kind is not a column');
do $$ begin assert (select count(*) from crm_views where name = 'T31 view') = 1, 'T31k the view with the new keys was saved'; end $$;

-- (l) notes carry their author: a user by name, an AI operator as "agent"
select test.t31_upd('00000000-0000-0000-0000-0000000000a1', test.id('l31_a1'), null, null, null, null, 'T31 note from a member');
select service.lead_update(jsonb_build_object('sub', '00000000-0000-0000-0000-00000000000a', 'aal', 'aal1', 'app_metadata', jsonb_build_object('actor', 'agent')), test.id('l31_a1'), null, null, 'T31 note from the agent');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('l31_a1'), null, null, null, null, 'T31 note from the owner');
do $$ declare m jsonb; g jsonb; o jsonb; begin
  select detail into m from lead_events where lead_id = test.id('l31_a1') and kind = 'note' and detail ->> 'text' = 'T31 note from a member';
  select detail into g from lead_events where lead_id = test.id('l31_a1') and kind = 'note' and detail ->> 'text' = 'T31 note from the agent';
  select detail into o from lead_events where lead_id = test.id('l31_a1') and kind = 'note' and detail ->> 'text' = 'T31 note from the owner';
  assert m -> 'author' ->> 'kind' = 'user' and m -> 'author' ->> 'name' = (select v.data ->> 'name' from public.content_versions v where v.row_id = test.id('crm_t1') order by v.n desc limit 1), 'T31l a member''s note carries their team profile name: ' || m::text;
  assert g -> 'author' ->> 'kind' = 'agent' and g -> 'author' ->> 'name' = 'Agent', 'T31l a note from an AI operator is "agent": ' || g::text;
  assert o -> 'author' ->> 'kind' = 'user' and coalesce(o -> 'author' ->> 'name', '') <> '', 'T31l the owner''s note has a name: ' || o::text;
  assert (select count(*) from lead_events where lead_id = test.id('l31_a1') and kind = 'note' and by is not null and (detail -> 'author') is not null) = 3, 'T31l every note has its author block and the user id (by)';
  assert private.actor_kind('{"app_metadata":{"actor":"agent"}}') = 'agent' and private.actor_kind('{"actor":"agent"}') = 'user' and private.actor_kind('{"sub":"x"}') = 'user', 'T31l only the verified app_metadata names an agent';
end $$;

-- (m) one domain, one site, in any letter case; sites without a domain are many
update sites set domain = 'Demo-A.Example.com' where id = 'aaaaaaaa-0000-0000-0000-00000000517e';
select test.expect_error($q$update sites set domain = 'demo-a.EXAMPLE.com' where id = 'bbbbbbbb-0000-0000-0000-00000000517e'$q$, 'sites_domain_unique');
do $$ begin assert (select count(*) from sites where id in ('aaaaaaaa-0000-0000-0000-00000000517e', 'bbbbbbbb-0000-0000-0000-00000000517e') and domain is null) = 1, 'T31m one site has a domain, the other none'; end $$;
update sites set domain = null where id = 'aaaaaaaa-0000-0000-0000-00000000517e';
do $$ begin assert (select count(*) from sites where id in ('aaaaaaaa-0000-0000-0000-00000000517e', 'bbbbbbbb-0000-0000-0000-00000000517e') and domain is null) = 2, 'T31m two sites without a domain are fine'; end $$;

-- (n) structure: the enum is gone, status is text, the guard is on the table, the new functions are closed to logins and built as every service function is
do $$ declare f text; begin
  assert to_regtype('public.lead_status') is null, 'T31n the lead_status enum is gone';
  assert (select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.leads'::regclass and attname = 'status') = 'text', 'T31n leads.status is text';
  assert (select count(*) from pg_trigger where tgrelid = 'public.leads'::regclass and tgname = 'leads_guard' and not tgisinternal) = 1, 'T31n the guard is a trigger on leads';
  foreach f in array array['private.crm_lists(uuid)', 'private.status_def(uuid,text)', 'private.status_pick(jsonb,text)', 'private.lead_type_def(uuid,text)', 'private.person_label(uuid,uuid)', 'private.actor_kind(jsonb)',
    'private.lead_guard()', 'service.lead_update(jsonb,uuid,text,uuid,text,boolean,date,uuid,text)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not exists (select 1 from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) a where a.grantee = 0), f || ' is closed to anon, authenticated and PUBLIC';
    assert (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' has an empty search_path';
  end loop;
  assert has_function_privilege('omnikom_fn', 'service.lead_update(jsonb,uuid,text,uuid,text,boolean,date,uuid,text)', 'execute'), 'T31n lead_update is open to the function role';
  assert (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'sites' and indexname = 'sites_domain_unique') = 1, 'T31n the unique domain index exists';
end $$;

-- (o) a contract without a crm block has the platform floor: the four statuses the product had before (head's ruling A), spam, enquiry; an existing business keeps working
update site_contracts set resolved = resolved - 'crm' where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000';
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-00000000000b', %L, 'call-back', date '2027-01-01')$q$, test.id('l31_b')), 'I-ANSWER status');
select test.t31_upd('00000000-0000-0000-0000-00000000000b', test.id('l31_b'), 'spam');
select test.t31_upd('00000000-0000-0000-0000-00000000000b', test.id('l31_b'), 'not-contacted');
select test.t31_upd('00000000-0000-0000-0000-00000000000b', test.id('l31_b'), 'contacted');
do $$ begin assert (select status from leads where id = test.id('l31_b')) = 'contacted', 'T31o a floor business can set contacted (an old row stays settable)'; end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000b', test.id('l31_b'), 'qualified');
select test.t31_upd('00000000-0000-0000-0000-00000000000b', test.id('l31_b'), 'closed');
do $$ declare x jsonb; begin
  assert (select status from leads where id = test.id('l31_b')) = 'closed', 'T31o a floor business can set qualified and closed';
  x := test.t31_list('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', '{}');
  assert x -> 'lead_types' = '[{"key":"enquiry","label":"Enquiry"}]'::jsonb and (select string_agg(s ->> 'key', ',') from jsonb_array_elements(x -> 'statuses') s) = 'not-contacted,contacted,qualified,closed', 'T31o the floor: ' || x::text;
end $$;

-- (p) a status change clears the date, person and line the old status carried (head's ruling G): the caller sends fresh ones
insert into test.ids select 'f_carry', test.t31_lead('T31 carry');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_carry'), 'call-back', date '2027-03-01');
select test.expect_error(format($q$select test.t31_upd('00000000-0000-0000-0000-00000000000a', %L, 'appointment-set')$q$, test.id('f_carry')), 'I-ANSWER status_date: Appointment set needs a date');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_carry'), 'appointment-set', date '2027-03-02');   -- a fresh date: kept
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_carry'), 'contacted', null, '00000000-0000-0000-0000-0000000000a2');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_carry'), 'appointment-set', date '2027-03-03');   -- the old person (agent two) is not carried; the caller is the default
do $$ begin assert (select status_who from leads where id = test.id('f_carry')) = '00000000-0000-0000-0000-00000000000a', 'T31p the person of the old status is not carried to the new one (the caller is the default)'; end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_carry'), 'interested', null, null, 'Pool homes');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_carry'), 'lost');
do $$ declare r leads; begin
  select * into r from leads where id = test.id('f_carry');
  assert r.status = 'lost' and r.status_text is null, 'T31p the line of the old status is not carried to the new one: ' || coalesce(r.status_text, 'none');
end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_carry'), 'appointment-set', date '2027-03-04');
do $$ declare r leads; begin
  select * into r from leads where id = test.id('f_carry');
  assert r.status_date = date '2027-03-04' and r.status_who = '00000000-0000-0000-0000-00000000000a', 'T31p a fresh date is kept and the person is the caller, not the one the earlier status named: ' || r.status_who::text;
end $$;

-- (p2) what the caller sends counts even when it equals the old value (ruling G, round 2): the same date on another status, the same person, the same line
insert into test.ids select 'f_same', test.t31_lead('T31 same');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_same'), 'call-back', date '2027-04-01');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_same'), 'appointment-set', date '2027-04-01');   -- call back on Friday, appointment on the same Friday: the date is sent, so it stays
do $$ begin assert (select status_date from leads where id = test.id('f_same')) = date '2027-04-01' and (select status from leads where id = test.id('f_same')) = 'appointment-set', 'T31p2 a date sent again with the new status is kept'; end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_same'), 'contacted', null, '00000000-0000-0000-0000-0000000000a2');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_same'), 'appointment-set', date '2027-04-02', '00000000-0000-0000-0000-0000000000a2');   -- the person is sent again
do $$ begin assert (select status_who from leads where id = test.id('f_same')) = '00000000-0000-0000-0000-0000000000a2', 'T31p2 a person sent again with the new status is kept'; end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_same'), 'interested', null, null, 'Pool homes');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_same'), 'lost', null, null, 'Pool homes');
do $$ begin assert (select status_text from leads where id = test.id('f_same')) = 'Pool homes', 'T31p2 a line sent again with the new status is kept'; end $$;

-- (p3) the same rules in the edit call (lead_set_fields): sent is kept, not sent is cleared
insert into test.ids select 'f_sf', test.t31_lead('T31 set fields');
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"call-back","status_date":"2027-05-01"}');
select test.expect_error(format($q$select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), %L, '{"status":"appointment-set"}')$q$, test.id('f_sf')), 'I-ANSWER status_date');
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"appointment-set","status_date":"2027-05-01"}');
do $$ begin assert (select status_date from leads where id = test.id('f_sf')) = date '2027-05-01', 'T31p3 a date sent again with the new status is kept by the edit call'; end $$;
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"contacted","status_who":"00000000-0000-0000-0000-0000000000a2"}');
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"answering-machine"}');
do $$ begin assert (select status_who from leads where id = test.id('f_sf')) = '00000000-0000-0000-0000-00000000000a', 'T31p3 a person not sent is not carried by the edit call (the caller is the default)'; end $$;
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"contacted","status_who":"00000000-0000-0000-0000-0000000000a2"}');
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"answering-machine","status_who":"00000000-0000-0000-0000-0000000000a2"}');
do $$ begin assert (select status_who from leads where id = test.id('f_sf')) = '00000000-0000-0000-0000-0000000000a2', 'T31p3 a person sent again with the new status is kept by the edit call'; end $$;
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"interested","status_text":"Pool"}');
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"lost"}');
do $$ begin assert (select status_text from leads where id = test.id('f_sf')) is null, 'T31p3 a line not sent is not carried by the edit call'; end $$;
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"interested","status_text":"Pool"}');
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_sf'), '{"status":"lost","status_text":"Pool"}');
do $$ begin assert (select status_text from leads where id = test.id('f_sf')) = 'Pool', 'T31p3 a line sent again with the new status is kept by the edit call'; end $$;

-- (p4) a bulk status change sends nothing, so no person or line is carried to the new status
insert into test.ids select 'f_bk', test.t31_lead('T31 bulk carry');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_bk'), 'contacted', null, '00000000-0000-0000-0000-0000000000a2');
select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[test.id('f_bk')], 'status', 'answering-machine');
do $$ begin assert (select status_who from leads where id = test.id('f_bk')) = '00000000-0000-0000-0000-00000000000a', 'T31p4 bulk: the person of the old status is not carried (the caller is the default)'; end $$;
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_bk'), 'interested', null, null, 'Pool');
select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[test.id('f_bk')], 'status', 'lost');
do $$ begin assert (select status_text from leads where id = test.id('f_bk')) is null, 'T31p4 bulk: the line of the old status is not carried'; end $$;

-- (p5) a person sent with a status that does not record one is dropped (the guard), by lead_update and by the edit call
insert into test.ids select 'f_np', test.t31_lead('T31 no person');
select test.t31_upd('00000000-0000-0000-0000-00000000000a', test.id('f_np'), 'qualified', null, '00000000-0000-0000-0000-0000000000a2');
do $$ begin assert (select status_who from leads where id = test.id('f_np')) is null, 'T31p5 a person sent with a status that does not record one is dropped (lead_update)'; end $$;
select service.lead_set_fields(test.c('00000000-0000-0000-0000-00000000000a'), test.id('f_np'), '{"status":"closed","status_who":"00000000-0000-0000-0000-0000000000a2"}');
do $$ begin assert (select status_who from leads where id = test.id('f_np')) is null, 'T31p5 a person sent with a status that does not record one is dropped (the edit call)'; end $$;

-- (q) a bulk delete is service.delete_lead once per lead, so every delete path erases the same way (head's ruling J): one audit row per lead, and the delete runs inside delete_lead
create table test.delctx (ctx text);
create function test.t31_delctx() returns trigger language plpgsql as $f$ declare c text; begin get diagnostics c = pg_context; insert into test.delctx values (c); return old; end $f$;
insert into test.ids select 'bd1', test.t31_lead('T31 bulk delete one');
insert into test.ids select 'bd2', test.t31_lead('T31 bulk delete two');
create trigger t31_delctx before delete on public.leads for each row execute function test.t31_delctx();
select service.leads_bulk(test.c('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', array[test.id('bd1'), test.id('bd2')], 'delete', null, true);
drop trigger t31_delctx on public.leads;
do $$ begin
  assert (select count(*) from leads where id in (test.id('bd1'), test.id('bd2'))) = 0, 'T31q the bulk delete deleted both leads';
  assert (select count(*) from audit_log where action = 'lead-delete' and target in (test.id('bd1')::text, test.id('bd2')::text) and detail ->> 'reason' = 'bulk' and detail ->> 'email_hash' is not null) = 2,
    'T31q a bulk delete leaves one audit row per lead, with the reason and the email hash';
  assert (select count(*) from test.delctx where ctx like '%service.delete_lead(%') = 2, 'T31q each lead was deleted inside service.delete_lead: ' || coalesce((select string_agg(left(ctx, 120), ' | ') from test.delctx), 'no delete seen');
end $$;

-- ===== T32 erasure scrubs every copy of the person; Storage and keys gate the deleted state (work order 37b, migration 26, the Clients
-- department's file) =====
create function test.offboarding_storage(p_ws uuid) returns setof text language sql security definer as $$ select path from service.offboarding_storage(test.claims(), p_ws) $$;
grant execute on function test.offboarding_storage(uuid) to authenticated;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
insert into test.ids select 't32lead', test.add_lead('aaaaaaaa-0000-0000-0000-00000000517e', 'T32 Person', 'T32.Erase@Example.com', '+1 (555) 555-0199', '{}', 'I agree (T32)');
reset role;
-- the copies an erasure must reach: a message to the email (its error quotes it), one to the number in another layout, one to someone else;
-- webhook payloads with the email, with the number, and with someone else; a second ledger row with a user agent and marketing choices
insert into messages (workspace_id, lead_id, channel, template, to_text, error) values
 ('aaaaaaaa-0000-0000-0000-000000000000', test.id('t32lead'), 'email', 'follow-up', 't32.erase@example.com', 'bounced: T32.Erase@Example.com'),
 ('aaaaaaaa-0000-0000-0000-000000000000', null, 'sms', 'follow-up', '555.555.0199', null),
 ('aaaaaaaa-0000-0000-0000-000000000000', null, 'email', 'new-lead', 't32-agent@test', null),
 ('aaaaaaaa-0000-0000-0000-000000000000', null, 'sms', 'follow-up', '25555550199', null),
 ('aaaaaaaa-0000-0000-0000-000000000000', null, 'sms', 'follow-up', '(555) 555-01990', null),
 ('aaaaaaaa-0000-0000-0000-000000000000', null, 'email', 'follow-up', 'x.t32.erase@example.com', null);
insert into webhook_events (workspace_id, kind, payload) values
 ('aaaaaaaa-0000-0000-0000-000000000000', 't32-bounce', '{"to": "T32.ERASE@example.com"}'),
 ('aaaaaaaa-0000-0000-0000-000000000000', 't32-sms', '{"from": "+15555550199"}'),
 ('aaaaaaaa-0000-0000-0000-000000000000', 't32-other', '{"to": "someone@else.test"}'),
 ('aaaaaaaa-0000-0000-0000-000000000000', 't32-longer-address', '{"to": "my.t32.erase@example.com"}'),
 ('aaaaaaaa-0000-0000-0000-000000000000', 't32-longer-number', '{"from": "+44 25555550199"}');
insert into consent_ledger (workspace_id, site_id, lead_id, form, page_path, consent_text, consent_hash, sms_consent, marketing, ip_hash, user_agent)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', test.id('t32lead'), 'contact', '/contact', 'I agree (T32)',
          encode(sha256(convert_to('I agree (T32)', 'utf8')), 'hex'), true, '{"email": true}', repeat('a', 64), 'Mozilla/5.0 (T32)');
do $$ begin assert (select count(*) from consent_ledger where lead_id = test.id('t32lead')) = 2, 'T32 setup: the lead has two ledger rows'; end $$;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.delete_lead(test.id('t32lead'));
reset role;
do $$ begin
  assert (select count(*) from leads where id = test.id('t32lead')) = 0, 'T32 the lead is gone';
  assert (select count(*) from messages where lower(to_text) = 't32.erase@example.com' or strpos(lower(coalesce(error, '')), 't32.erase@example.com') > 0) = 0, 'T32a no message holds the email, in to_text or error';
  assert (select count(*) from messages where to_text ~ '(^|[^0-9])(1[-. ()+]{0,3})?5[-. ()+]{0,3}5[-. ()+]{0,3}5[-. ()+]{0,3}5[-. ()+]{0,3}5[-. ()+]{0,3}5[-. ()+]{0,3}0[-. ()+]{0,3}1[-. ()+]{0,3}9[-. ()+]{0,3}9($|[^0-9])') = 0, 'T32a no message holds the number';
  assert (select count(*) from messages where to_text in ('erased:' || encode(sha256(convert_to('t32.erase@example.com', 'utf8')), 'hex'), 'erased:' || encode(sha256(convert_to('555.555.0199', 'utf8')), 'hex'))) = 2, 'T32a both copies are erased:<sha256>';
  assert (select count(*) from messages where to_text = 't32-agent@test') = 1, 'T32a another person''s message is untouched';
  assert (select count(*) from messages where to_text in ('25555550199', '(555) 555-01990')) = 2, 'T32a another person''s longer number that holds the digits is untouched';
  assert (select count(*) from messages where to_text = 'x.t32.erase@example.com') = 1, 'T32a another person''s longer address is untouched';
  assert (select payload from webhook_events where kind = 't32-bounce') = '{"erased": true}'::jsonb, 'T32b the payload with the email is erased';
  assert (select payload from webhook_events where kind = 't32-sms') = '{"erased": true}'::jsonb, 'T32b the payload with the number is erased';
  assert (select payload from webhook_events where kind = 't32-other') = '{"to": "someone@else.test"}'::jsonb, 'T32b another person''s payload is kept';
  assert (select payload from webhook_events where kind = 't32-longer-address') = '{"to": "my.t32.erase@example.com"}'::jsonb, 'T32b a longer address that holds the person''s is kept';
  assert (select payload from webhook_events where kind = 't32-longer-number') = '{"from": "+44 25555550199"}'::jsonb, 'T32b a longer number that holds the person''s digits is kept';
  assert (select count(*) from consent_ledger where consent_text = 'I agree (T32)' and lead_id is null and user_agent is null and marketing is null
          and email_hash = encode(sha256(convert_to('t32.erase@example.com', 'utf8')), 'hex') and phone_hash = encode(sha256(convert_to('5555550199', 'utf8')), 'hex')) = 2,
    'T32c both ledger rows keep only hashes and the time: ' || coalesce((select json_agg(json_build_object('lead', lead_id, 'ua', user_agent, 'mk', marketing, 'e', email_hash, 'p', phone_hash))::text from consent_ledger where consent_text = 'I agree (T32)'), 'none');
  assert (select count(*) from consent_ledger where consent_text = 'I agree (T32)' and ip_hash = repeat('a', 64) and sms_consent and page_path = '/contact') = 1, 'T32c the proof itself is kept';
  assert coalesce(current_setting('omnikom.erasure', true), '') <> 'on', 'T32c delete_lead turns the erasure setting off again';
end $$;
-- T32d the ledger stays append-only: no setting, a change outside the erasure shape, a role that is not the table's owner, a delete
select test.expect_error($q$update consent_ledger set user_agent = null where consent_text = 'I agree (T32)'$q$, 'A-APPEND-ONLY');
select set_config('omnikom.erasure', 'on', false);
select test.expect_error($q$update consent_ledger set consent_text = 'changed (T32)' where consent_text = 'I agree (T32)'$q$, 'A-APPEND-ONLY');
select test.expect_error($q$update consent_ledger set email_hash = repeat('b', 64) where consent_text = 'I agree (T32)'$q$, 'A-APPEND-ONLY');
select test.expect_error($q$delete from consent_ledger where consent_text = 'I agree (T32)'$q$, 'A-APPEND-ONLY');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select set_config('omnikom.erasure', 'on', false);
select test.expect_error($q$update consent_ledger set user_agent = null where consent_text = 'I agree (T32)'$q$, 'permission denied');
reset role;
-- a grant and a policy made by mistake (test only, rolled back): the rows are then reachable, and the trigger alone still refuses a
-- signed-in user, and any role that is not the table's owner (without the policy, row-level security would hide the rows and the
-- update would change nothing, which tests nothing). Granting and creating a role need a superuser: run-local.mjs (where the
-- mutants run) is one; the CLI's walls run on a namespaced copy is not (CI a8011c4: "permission denied"), so there they are skipped.
do $$
begin
  if not coalesce((select rolsuper from pg_roles where rolname = current_user), false) then
    raise notice 'T32d: the grant and role checks need a superuser (run-local.mjs runs them); skipped here';
    return;
  end if;
  execute 'grant update on consent_ledger to authenticated';
  execute 'create policy t32_update_any on consent_ledger for all to public using (true) with check (true)';
  assert (select count(*) from consent_ledger where consent_text = 'I agree (T32)') = 2, 'T32d setup: the two rows are there to update';
  perform set_config('omnikom.erasure', 'on', true);
  execute 'set local role authenticated';
  perform test.act_as('00000000-0000-0000-0000-00000000000a');
  perform test.expect_error($q$update consent_ledger set user_agent = null where consent_text = 'I agree (T32)'$q$, 'A-APPEND-ONLY');
  execute 'reset role';
  execute 'revoke update on consent_ledger from authenticated';
  execute 'create role t32_writer';
  execute 'grant select, update on consent_ledger to t32_writer';
  execute 'grant usage on schema test to t32_writer';
  execute 'grant execute on function test.expect_error(text, text) to t32_writer';
  execute 'set local role t32_writer';
  perform test.expect_error($q$update consent_ledger set user_agent = null where consent_text = 'I agree (T32)'$q$, 'A-APPEND-ONLY');
  execute 'reset role';
  raise notice 'T32d: the grant and role checks ran';
end $$;
select set_config('omnikom.erasure', 'off', false);
-- T32e Storage: staff with MFA list an offboarding workspace's files, nobody else, and no other state; deleted waits for empty Storage and revoked keys
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.expect_error($q$select test.offboarding_storage('bbbbbbbb-0000-0000-0000-000000000000')$q$, 'S-WORKSPACE-STATE');   -- B is active
select test.set_workspace_state('bbbbbbbb-0000-0000-0000-000000000000', 'offboarding', 'T32');
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.expect_error($q$select test.offboarding_storage('bbbbbbbb-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');   -- B's owner
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal1');
select test.expect_error($q$select test.offboarding_storage('bbbbbbbb-0000-0000-0000-000000000000')$q$, 'S-NOT-FOUND');   -- staff without MFA
reset role;
insert into storage.objects (bucket_id, name) values ('media', 'bbbbbbbb-0000-0000-0000-000000000000/t32.png');
insert into api_keys (workspace_id, site_id, kind, label, key_hash) values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000517e', 'site-signing', 'T32 key', repeat('c', 64));
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin
  assert (select count(*) from test.offboarding_storage('bbbbbbbb-0000-0000-0000-000000000000') p where p = 'bbbbbbbb-0000-0000-0000-000000000000/t32.png') = 1, 'T32e staff list the offboarding workspace''s file';
  assert (select count(*) from test.offboarding_storage('bbbbbbbb-0000-0000-0000-000000000000') p where p not like 'bbbbbbbb-0000-0000-0000-000000000000/%') = 0, 'T32e only that workspace''s folder';
end $$;
select test.expect_error($q$select test.set_workspace_state('bbbbbbbb-0000-0000-0000-000000000000', 'deleted')$q$, 'S-WORKSPACE-STORAGE');
reset role;
delete from storage.objects where bucket_id = 'media' and name like 'bbbbbbbb-0000-0000-0000-000000000000/%';
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.expect_error($q$select test.set_workspace_state('bbbbbbbb-0000-0000-0000-000000000000', 'deleted')$q$, 'S-WORKSPACE-KEYS');
reset role;
update api_keys set revoked_at = now() where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000' and revoked_at is null;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.set_workspace_state('bbbbbbbb-0000-0000-0000-000000000000', 'deleted', 'T32 offboarded');
reset role;
do $$ begin assert (select state from workspaces where id = 'bbbbbbbb-0000-0000-0000-000000000000') = 'deleted', 'T32e B is deleted once its Storage is empty and its keys revoked'; end $$;
-- ===== T34 work order 44 (migration 27): the metrics sources, the function role's way in and out of metrics_snapshots, the daily job (own block; mutants "metrics27: ..." in run-local.mjs) =====
reset role;
-- (0) the state this block asserts on is set here, not assumed: an earlier block may have left a workspace or a site in another state (CI 42969064328: Clients'
-- T32e moves B to deleted, so "B has a target while active" failed). A and B become active and every site of A and B a preview site; the end of the block puts
-- back what was there (workspace state, site state and domain).
create table test.t34_ws as select id, state from public.workspaces where id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000');
create table test.t34_sites as select id, state, domain from public.sites where workspace_id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000');
update public.workspaces set state = 'active' where id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000');
update public.sites set state = 'preview' where workspace_id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000');
do $$ begin
  assert (select count(*) from test.t34_ws) = 2 and (select count(*) from public.workspaces where state = 'active' and id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000')) = 2, 'T34 setup: A and B are active';
  assert (select count(*) from public.sites where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000' and state = 'preview') >= 1, 'T34 setup: B has a preview site';
end $$;
-- (a) the source check: bing is allowed, the old check is gone, the new one is validated, anything else is still refused
do $$ begin
  assert not exists (select 1 from pg_constraint where conrelid = 'public.metrics_snapshots'::regclass and conname = 'metrics_snapshots_source_check'), 'T34a the old source check is gone';
  assert (select convalidated from pg_constraint where conrelid = 'public.metrics_snapshots'::regclass and conname = 'metrics_snapshots_source_ok'), 'T34a the new source check is validated';
  insert into public.metrics_snapshots (workspace_id, source, day, data) values ('aaaaaaaa-0000-0000-0000-000000000000', 'bing', '2026-11-02', '{"t32":true}');
  assert exists (select 1 from public.metrics_snapshots where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and source = 'bing'), 'T34a bing is accepted';
end $$;
select test.expect_error($q$insert into public.metrics_snapshots (workspace_id, source, day, data) values ('aaaaaaaa-0000-0000-0000-000000000000', 'crux', '2026-11-02', '{}')$q$, 'metrics_snapshots_source_ok');
-- (b) the writer: an upsert by (workspace, source, day); only the collectors' sources; an object of at most 256 KiB; a workspace that exists
select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'pagespeed', '2026-11-02', '{"v":1}');
select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'pagespeed', '2026-11-02', '{"v":2}');
do $$ begin
  assert (select count(*) from public.metrics_snapshots where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and source = 'pagespeed' and day = '2026-11-02') = 1, 'T34b a rerun leaves one row';
  assert service.metrics_get('aaaaaaaa-0000-0000-0000-000000000000', 'pagespeed', '2026-11-02') = '{"v": 2}'::jsonb, 'T34b the row holds the newer data';
  assert service.metrics_get('aaaaaaaa-0000-0000-0000-000000000000', 'pagespeed', '2026-11-03') is null, 'T34b a day with no row answers null';
  assert service.metrics_get('bbbbbbbb-0000-0000-0000-000000000000', 'pagespeed', '2026-11-02') is null, 'T34b another workspace has no such row';
  assert service.metrics_last_day('aaaaaaaa-0000-0000-0000-000000000000', 'pagespeed') = '2026-11-02', 'T34b the newest day of a source';
  assert service.metrics_last_day('bbbbbbbb-0000-0000-0000-000000000000', 'pagespeed') is null, 'T34b no day for a workspace with no row';
end $$;
select test.expect_error($q$select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'uptime', '2026-11-02', '{}')$q$, 'S-SOURCE');
select test.expect_error($q$select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'crux', '2026-11-02', '{}')$q$, 'S-SOURCE');
select test.expect_error($q$select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', null, '2026-11-02', '{}')$q$, 'S-SOURCE');
select test.expect_error($q$select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'bing', '2026-11-02', '[]')$q$, 'S-BODY');
select test.expect_error($q$select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'bing', '2026-11-02', null)$q$, 'S-BODY');
select test.expect_error($q$select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'bing', null, '{}')$q$, 'S-BODY');
select test.expect_error($q$select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'bing', '2026-11-02', jsonb_build_object('x', repeat('a', 262200)))$q$, 'S-SIZE');
select test.expect_error($q$select service.metrics_put('99999999-9999-4999-8999-999999999999', 'bing', '2026-11-02', '{}')$q$, 'S-NOT-FOUND');
-- (c) the targets: one site per workspace, a live one before a preview one, a workspace that is not trial or active is left out
do $$ begin
  assert (select count(*) from service.metrics_targets() where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 1, 'T34c one target for a workspace with several sites';
  assert (select site_state from service.metrics_targets() where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 'preview', 'T34c a workspace with only preview sites is measured on a preview one';
  update public.sites set state = 'live', domain = 't32-live.example.test' where id = 'aaaaaaaa-0000-0000-0000-0000000052e2';
  assert (select site_id from service.metrics_targets() where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 'aaaaaaaa-0000-0000-0000-0000000052e2'
    and (select domain from service.metrics_targets() where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 't32-live.example.test', 'T34c a live site is measured before an older preview one';
  update public.sites set state = 'paused' where id = 'aaaaaaaa-0000-0000-0000-0000000052e2';
  assert (select site_state from service.metrics_targets() where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = 'preview', 'T34c a paused site is never measured';
  update public.sites set state = 'live' where id = 'aaaaaaaa-0000-0000-0000-0000000052e2';
  assert (select count(*) from service.metrics_targets() where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000') = 1, 'T34c B has a target while active';
  update public.workspaces set state = 'suspended' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
  assert (select count(*) from service.metrics_targets() where workspace_id = 'bbbbbbbb-0000-0000-0000-000000000000') = 0, 'T34c a suspended workspace is not measured';
  update public.workspaces set state = 'active' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
  insert into public.workspaces (id, slug, name, industry) values ('cccccccc-0000-0000-0000-000000000032', 't32-paused-only', 'T34 paused only', 'real-estate');
  insert into public.sites (workspace_id, deploy_target, preview_host, state) values ('cccccccc-0000-0000-0000-000000000032', 't32-paused-only', 't32-paused.preview.test', 'paused');
  assert (select count(*) from service.metrics_targets() where workspace_id = 'cccccccc-0000-0000-0000-000000000032') = 0, 'T34c a workspace whose only site is paused is not measured';
end $$;
-- (d) the facts of the site of a publish job (for the sitemap step): a live site says so with its domain; a missing job and an unmeasured workspace answer null
with j as (insert into public.publish_jobs (workspace_id, site_id, requested_by, rows, requested, state)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000052e2', '00000000-0000-0000-0000-00000000000a', '{}', '{}', 'deploying') returning id)
  insert into test.ids select 'm32job', id from j;
do $$ begin
  assert service.metrics_target_for_job(test.id('m32job')) ->> 'site_state' = 'live' and service.metrics_target_for_job(test.id('m32job')) ->> 'domain' = 't32-live.example.test'
    and service.metrics_target_for_job(test.id('m32job')) ->> 'workspace_id' = 'aaaaaaaa-0000-0000-0000-000000000000', 'T34d the job''s site, its state and its domain';
  assert service.metrics_target_for_job('99999999-9999-4999-8999-999999999999') is null, 'T34d no job, no answer';
  update public.workspaces set state = 'offboarding' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
  assert service.metrics_target_for_job(test.id('m32job')) is null, 'T34d a workspace that is offboarding is not measured';
  update public.workspaces set state = 'active' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
end $$;
-- (e) the daily job: two calls per measured workspace (the quick one and the slow PageSpeed one); with no pg_net, Vault entry or pgcrypto it sends nothing
do $$ begin
  assert (select array_agg(path order by path) from service.metrics_calls() where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000')
    = array['/metrics-pull?workspace=aaaaaaaa-0000-0000-0000-000000000000', '/metrics-pull?workspace=aaaaaaaa-0000-0000-0000-000000000000&source=pagespeed'], 'T34e two calls for a workspace, by path';
  assert (select count(*) from service.metrics_calls()) = 2 * (select count(*) from service.metrics_targets()), 'T34e two calls for each target';
  assert service.metrics_pull_all() = 0, 'T34e without pg_net the daily job sends nothing';
end $$;
-- (f) the walls: the owner and a member of A read A's rows, B's owner and a login of nothing read none; nobody who is signed in writes
set role authenticated;
do $$ declare n int; begin
  perform test.act_as('00000000-0000-0000-0000-00000000000a');
  select count(*) into n from public.metrics_snapshots where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and source = 'bing'; assert n = 1, 'T34f the owner of A reads A''s bing row';
  perform test.act_as('00000000-0000-0000-0000-0000000000a1');
  select count(*) into n from public.metrics_snapshots where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and source = 'bing'; assert n = 1, 'T34f a member of A reads it too';
  perform test.act_as('00000000-0000-0000-0000-00000000000b');
  select count(*) into n from public.metrics_snapshots where source in ('bing', 'pagespeed'); assert n = 0, 'T34f the owner of B reads none of A''s rows';
  perform test.act_as('00000000-0000-0000-0000-00000000000e');
  select count(*) into n from public.metrics_snapshots; assert n = 0, 'T34f a login of nothing reads none';
end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.expect_error($q$insert into public.metrics_snapshots (workspace_id, source, day, data) values ('aaaaaaaa-0000-0000-0000-000000000000', 'bing', '2026-11-09', '{}')$q$, 'permission denied');
select test.expect_error($q$update public.metrics_snapshots set data = '{"x":1}' where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000'$q$, 'permission denied');
select test.expect_error($q$select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'bing', '2026-11-09', '{}')$q$, 'permission denied');
select test.expect_error($q$select * from service.metrics_targets()$q$, 'permission denied');
select test.expect_error($q$select service.metrics_pull_all()$q$, 'permission denied');
reset role;
do $$ declare n int; begin
  select count(*) into n from public.metrics_snapshots where day = '2026-11-09'; assert n = 0, 'T34f a signed-in owner wrote nothing';
end $$;
set role anon;
select test.act_as(null);
select test.expect_error($q$select service.metrics_put('aaaaaaaa-0000-0000-0000-000000000000', 'bing', '2026-11-09', '{}')$q$, 'permission denied');
select test.expect_error($q$select * from service.metrics_calls()$q$, 'permission denied');
reset role;
-- (g) the seven functions: closed to anon, authenticated and PUBLIC; definers with an empty search_path; the function role has the five it needs and neither cron function
do $$ declare f text; begin
  foreach f in array array['service.metrics_targets()', 'service.metrics_target_for_job(uuid)', 'service.metrics_put(uuid,text,date,jsonb)', 'service.metrics_get(uuid,text,date)', 'service.metrics_last_day(uuid,text)', 'service.metrics_calls()', 'service.metrics_pull_all()'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not exists (select 1 from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) a where a.grantee = 0), f || ' is closed to anon, authenticated and PUBLIC';
    assert (select prosecdef from pg_proc where oid = f::regprocedure) and (select proconfig from pg_proc where oid = f::regprocedure) = array['search_path=""'], f || ' is a definer function with an empty search_path';
  end loop;
  foreach f in array array['service.metrics_targets()', 'service.metrics_target_for_job(uuid)', 'service.metrics_put(uuid,text,date,jsonb)', 'service.metrics_get(uuid,text,date)', 'service.metrics_last_day(uuid,text)'] loop
    assert has_function_privilege('omnikom_fn', f, 'execute'), f || ' is open to the function role';
  end loop;
  assert not has_function_privilege('omnikom_fn', 'service.metrics_pull_all()', 'execute') and not has_function_privilege('omnikom_fn', 'service.metrics_calls()', 'execute'), 'the function role cannot run the daily job';
  assert not has_function_privilege('service_role', 'service.metrics_pull_all()', 'execute') and not has_function_privilege('service_role', 'service.metrics_calls()', 'execute'), 'nor can service_role';
end $$;
-- (0) back: what the earlier blocks left is what the later ones find
update public.workspaces w set state = s.state from test.t34_ws s where w.id = s.id;
update public.sites x set state = s.state, domain = s.domain from test.t34_sites s where x.id = s.id;
do $$ begin
  assert not exists (select 1 from test.t34_ws s join public.workspaces w on w.id = s.id where w.state is distinct from s.state), 'T34 the workspace states are back';
  assert not exists (select 1 from test.t34_sites s join public.sites x on x.id = s.id where x.state is distinct from s.state or x.domain is distinct from s.domain), 'T34 the site states and domains are back';
end $$;

-- ===== T33 retention (work order 46, migration 28, the Clients department's file): periods as data with floors; a daily purge that
-- deletes only rows older than their period; audit_log and security_events stay append-only except for that purge =====
do $$ begin
  assert (select count(*) from retention_rules) = 7, 'T33 seven retention rules';
  assert (select keep_days from retention_rules where table_name = 'consent_ledger') is null, 'T33 the consent ledger is never purged';
  assert (select keep_days from retention_rules where table_name = 'audit_log') = 730 and (select keep_days from retention_rules where table_name = 'security_events') = 365
     and (select keep_days from retention_rules where table_name = 'messages') = 1461 and (select keep_days from retention_rules where table_name = 'webhook_events') = 30, 'T33 the periods set on 2026-11-11';
  if to_regclass('cron.stub_jobs') is not null then
    assert (select schedule from cron.stub_jobs where jobname = 'purge-expired') = '17 3 * * *', 'T33 the purge runs daily at 03:17';
    assert (select command from cron.stub_jobs where jobname = 'purge-expired') = 'select service.purge_expired()', 'T33 the job calls the purge';
  end if;
end $$;
-- the floors: an audit trail cannot be cut short by mistake, the consent ledger cannot get a period
select test.expect_error($q$update retention_rules set keep_days = 30 where table_name = 'audit_log'$q$, 'retention_rules_floor');
select test.expect_error($q$update retention_rules set keep_days = 10 where table_name = 'consent_ledger'$q$, 'retention_rules_floor');
select test.expect_error($q$update retention_rules set keep_days = 3 where table_name = 'webhook_events'$q$, 'retention_rules_floor');
-- who runs it: not a signed-in user, staff included; a batch out of range is refused
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
select test.expect_error($q$select service.purge_expired()$q$, 'permission denied');
do $$ begin assert (select count(*) from retention_rules) = 7, 'T33 staff with MFA read the rules'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from retention_rules) = 0, 'T33 an owner reads no rule'; end $$;
reset role;
set role omnikom_fn;   -- the Edge Functions' role reaches service functions; no function calls the purge, so it may not run it
select test.expect_error($q$select service.purge_expired()$q$, 'permission denied');
reset role;
select test.expect_error($q$select service.purge_expired(0)$q$, 'R-BATCH');
-- rows on both sides of each period (and an old consent row that must stay)
insert into security_events (kind, code, at) values ('refused', 't33-old', now() - interval '400 days'), ('refused', 't33-old', now() - interval '500 days'), ('refused', 't33-new', now() - interval '10 days');
insert into audit_log (action, at) values ('t33-old', now() - interval '800 days'), ('t33-old', now() - interval '900 days'), ('t33-new', now() - interval '100 days');
insert into messages (workspace_id, channel, template, to_text, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'email', 't33-old', 't33@test', now() - interval '1500 days'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'email', 't33-new', 't33@test', now() - interval '400 days');
insert into webhook_events (workspace_id, kind, received_at, processed_at, error) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 't33-done-old', now() - interval '40 days', now() - interval '40 days', null),
  ('aaaaaaaa-0000-0000-0000-000000000000', 't33-done-new', now() - interval '10 days', now() - interval '10 days', null),
  ('aaaaaaaa-0000-0000-0000-000000000000', 't33-failed-mid', now() - interval '40 days', now() - interval '40 days', 'provider said no'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 't33-open-mid', now() - interval '40 days', null, null),
  ('aaaaaaaa-0000-0000-0000-000000000000', 't33-open-old', now() - interval '100 days', null, null);
insert into security_event_counts (kind, minute, event_id, last_at) values ('t33-old', now() - interval '40 days', 0, now() - interval '40 days'), ('t33-new', now() - interval '1 day', 0, now() - interval '1 day');
insert into consent_ledger (workspace_id, form, page_path, consent_text, consent_hash, at) values ('aaaaaaaa-0000-0000-0000-000000000000', 't33', '/', 'T33 old consent', repeat('a', 64), now() - interval '5000 days');
-- the append-only walls hold outside the purge: no setting; a row younger than its period; an update; another role (superuser runs only)
select test.expect_error($q$delete from audit_log where action = 't33-old'$q$, 'A-APPEND-ONLY');
select set_config('omnikom.purge', 'on', false);
select test.expect_error($q$delete from audit_log where action = 't33-new'$q$, 'A-APPEND-ONLY');
select test.expect_error($q$delete from security_events where code = 't33-new'$q$, 'A-APPEND-ONLY');
select test.expect_error($q$update audit_log set action = 'changed' where action = 't33-old'$q$, 'A-APPEND-ONLY');
do $$
begin
  if not coalesce((select rolsuper from pg_roles where rolname = current_user), false) then
    raise notice 'T33: the other-role check needs a superuser (run-local.mjs runs it); skipped here';
    return;
  end if;
  execute 'create role t33_purger';
  execute 'grant select, delete on audit_log to t33_purger';
  execute 'create policy t33_any on audit_log for all to public using (true) with check (true)';
  execute 'grant usage on schema test to t33_purger';
  execute 'grant execute on function test.expect_error(text, text) to t33_purger';
  perform set_config('omnikom.purge', 'on', true);
  execute 'set local role t33_purger';
  perform test.expect_error($q$delete from audit_log where action = 't33-old'$q$, 'A-APPEND-ONLY');
  execute 'reset role';
  raise notice 'T33: the other-role check ran';
end $$;
select set_config('omnikom.purge', 'off', false);
-- the purge, as the service role
set role service_role;
select service.purge_expired();
reset role;
do $$ begin
  assert (select count(*) from security_events where code = 't33-old') = 0 and (select count(*) from security_events where code = 't33-new') = 1, 'T33a security events: the old ones go, the new one stays';
  assert (select count(*) from audit_log where action = 't33-old') = 0 and (select count(*) from audit_log where action = 't33-new') = 1, 'T33a audit log: the old one goes, the new one stays';
  assert (select count(*) from messages where template = 't33-old') = 0 and (select count(*) from messages where template = 't33-new') = 1, 'T33a messages: the old one goes, the new one stays';
  assert (select count(*) from webhook_events where kind in ('t33-done-old', 't33-open-old')) = 0, 'T33a webhook events: a processed one past 30 days and an open one past 90 days go';
  assert (select count(*) from webhook_events where kind in ('t33-done-new', 't33-failed-mid', 't33-open-mid')) = 3, 'T33a webhook events: a new one, and failed or open ones under 90 days, stay';
  assert (select count(*) from security_event_counts where kind = 't33-old') = 0 and (select count(*) from security_event_counts where kind = 't33-new') = 1, 'T33a rate buckets: the old one goes, the new one stays';
  assert (select count(*) from consent_ledger where consent_text = 'T33 old consent') = 1, 'T33a the consent ledger is never purged';
  assert (select count(*) from audit_log where action = 'retention-purge' and workspace_id is null and actor is null) = 1, 'T33b the purge writes one audit row, a system job (no workspace, no actor)';
  assert (select (detail -> 'deleted' ->> 'audit_log')::int from audit_log where action = 'retention-purge') = 2
     and (select (detail -> 'deleted' ->> 'security_events')::int from audit_log where action = 'retention-purge') = 2
     and (select (detail -> 'deleted' ->> 'messages')::int from audit_log where action = 'retention-purge') = 1,
    'T33b the audit row carries the true counts (2 audit rows, 2 security events, 1 message past their periods): ' || coalesce((select (detail -> 'deleted')::text from audit_log where action = 'retention-purge'), 'no row');
  assert coalesce(current_setting('omnikom.purge', true), '') <> 'on', 'T33b the purge turns its setting off again';
end $$;
-- a second run deletes nothing more of the rows above
set role service_role;
select service.purge_expired();
reset role;
do $$ begin assert (select count(*) from audit_log where action = 't33-new') = 1 and (select count(*) from webhook_events where kind = 't33-open-mid') = 1, 'T33c a second run keeps what is under its period'; end $$;

-- ===== T35 E4 (migration 29): the mail outbox =====
-- The new-lead alert waits in mail_outbox (service.queue_lead_alert, which capture-lead calls) and the mail-outbox function sends it: service.outbox_claim leases
-- the due rows and records each message, service.outbox_done records Resend's answer, service.mail_outbox_tick is what pg_cron runs every minute. The whole
-- file is one transaction, so now() is one instant here. Superuser unless said; the end of the block puts back site A's alert list and A's email limit.
-- Mutants "outbox29: ..." in run-local.mjs.
reset role;
create table test.t35_site as select lead_alert_to from public.sites where id = 'aaaaaaaa-0000-0000-0000-00000000517e';
create table test.t35_limit as select * from public.workspace_limits where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and key = 'email_per_day_workspace';
update public.sites set lead_alert_to = array['t35-a@example.test', 't35-b@example.test'] where id = 'aaaaaaaa-0000-0000-0000-00000000517e';
with n as (insert into public.leads (workspace_id, site_id, form, page_path, name, email, consent_text) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T35 Lead One', 't35-1@test', 'I agree') returning id) insert into test.ids select 't35_1', id from n;
with n as (insert into public.leads (workspace_id, site_id, form, page_path, name, email, consent_text) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T35 Lead Two', 't35-2@test', 'I agree') returning id) insert into test.ids select 't35_2', id from n;
with n as (insert into public.leads (workspace_id, site_id, form, page_path, name, email, consent_text) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', 'contact', '/', 'T35 Lead Three', 't35-3@test', 'I agree') returning id) insert into test.ids select 't35_3', id from n;
-- (a) queue lead 1 twice: a row per address, once
do $$ declare n1 int; n2 int; begin
  n1 := service.queue_lead_alert('aaaaaaaa-0000-0000-0000-00000000517e', test.id('t35_1'));
  n2 := service.queue_lead_alert('aaaaaaaa-0000-0000-0000-00000000517e', test.id('t35_1'));
  assert n1 = 2 and n2 = 0, 'T35a the first queue adds two rows, the second none: ' || n1 || ', ' || n2;
  assert (select count(*) from public.mail_outbox where lead_id = test.id('t35_1')) = 2, 'T35a two rows';
  assert (select count(*) from public.mail_outbox where lead_id = test.id('t35_1') and attempts = 0 and message_id is null) = 2, 'T35a attempts 0 and no message yet';
end $$;
-- (b) claim twice: the first leases both rows and records a queued message for each, the second finds nothing due
create table test.t35_b as select * from service.outbox_claim(10);
do $$ begin
  assert (select count(*) from test.t35_b) = 2, 'T35b the first claim returns the two rows';
  assert (select count(*) from test.t35_b where workspace_slug = 'test-demo-a' and name = 'T35 Lead One' and lead_id = test.id('t35_1')) = 2, 'T35b each row carries the workspace slug and the lead';
  assert (select count(*) from public.mail_outbox o join public.messages m on m.id = o.message_id join test.t35_b b on b.message_id = o.message_id
          where o.lead_id = test.id('t35_1') and m.state = 'queued' and o.attempts = 1 and o.next_at = now() + interval '5 minutes') = 2, 'T35b each row has a queued message, attempts 1, its next try in 5 minutes';
  assert (select count(*) from service.outbox_claim(10)) = 0, 'T35b a second claim returns none';
end $$;
insert into test.ids select 't35_ma', message_id from test.t35_b where to_text = 't35-a@example.test';
insert into test.ids select 't35_mb', message_id from test.t35_b where to_text = 't35-b@example.test';
-- (c) a sent alert: the message is sent with Resend's id, its row is gone, and the lead is not queued again
select service.outbox_done(test.id('t35_ma'), true, 're_t35', null);
do $$ begin
  assert (select state from public.messages where id = test.id('t35_ma')) = 'sent' and (select provider_id from public.messages where id = test.id('t35_ma')) = 're_t35', 'T35c the message is sent with Resend''s id';
  assert not exists (select 1 from public.mail_outbox where message_id = test.id('t35_ma')), 'T35c its row is gone';
  assert service.queue_lead_alert('aaaaaaaa-0000-0000-0000-00000000517e', test.id('t35_1')) = 0, 'T35c an alerted lead is not queued again';
end $$;
-- (d) a failed try below six keeps the row and the queued message; the sixth fails the message and removes the row
select service.outbox_done(test.id('t35_mb'), false, null, 'x');
do $$ begin
  assert (select count(*) from public.mail_outbox where message_id = test.id('t35_mb')) = 1, 'T35d a failed first try keeps the row';
  assert (select state from public.messages where id = test.id('t35_mb')) = 'queued', 'T35d and the message stays queued';
end $$;
update public.mail_outbox set attempts = 5, next_at = now() where message_id = test.id('t35_mb');
do $$ begin
  perform service.outbox_claim(10);
  perform service.outbox_done(test.id('t35_mb'), false, null, 'x');
  assert (select state from public.messages where id = test.id('t35_mb')) = 'failed', 'T35d the sixth failed try fails the message';
  assert not exists (select 1 from public.mail_outbox where message_id = test.id('t35_mb')), 'T35d and removes its row';
end $$;
-- (e) the daily cap: a capped alert keeps its row for the next day (the blocked message stays as that day's record) and gets a new message when it goes
insert into public.workspace_limits (workspace_id, key, value, note) values ('aaaaaaaa-0000-0000-0000-000000000000', 'email_per_day_workspace', 0, 'T35e')
  on conflict (workspace_id, key) do update set value = excluded.value;
do $$ begin
  assert service.queue_lead_alert('aaaaaaaa-0000-0000-0000-00000000517e', test.id('t35_2')) = 2, 'T35e lead two is queued';
  assert (select count(*) from service.outbox_claim(10)) = 0, 'T35e a capped claim returns no row';
  assert (select count(*) from public.messages where lead_id = test.id('t35_2') and template = 'new-lead' and state = 'blocked' and error = 'daily cap (workspace)') = 2, 'T35e both messages are blocked by the workspace''s daily cap';
  assert (select count(*) from public.mail_outbox where lead_id = test.id('t35_2') and message_id is not null and next_at = date_trunc('day', now()) + interval '1 day') = 2, 'T35e both rows wait for the next day';
end $$;
delete from public.workspace_limits where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and key = 'email_per_day_workspace';
do $$ begin
  assert (select count(*) from service.outbox_claim(10, now())) = 0, 'T35e the same day nothing is due';
  assert (select count(*) from service.outbox_claim(10, now() + interval '1 day')) = 2, 'T35e a day later both rows are claimed';
  assert (select count(*) from public.mail_outbox o join public.messages m on m.id = o.message_id where o.lead_id = test.id('t35_2') and m.state = 'queued') = 2, 'T35e each with a new queued message';
  assert (select count(*) from public.messages where lead_id = test.id('t35_2') and template = 'new-lead' and state = 'blocked') = 2, 'T35e the blocked messages stay';
  assert (select count(*) from service.outbox_claim(10, now() + interval '1 day')) = 0, 'T35e then nothing is due';
end $$;
-- (f) a suppressed address: its row is dropped at the claim, no message is recorded
update public.sites set lead_alert_to = array['t35-c@example.test'] where id = 'aaaaaaaa-0000-0000-0000-00000000517e';
do $$ begin
  assert service.queue_lead_alert('aaaaaaaa-0000-0000-0000-00000000517e', test.id('t35_3')) = 1, 'T35f lead three is queued to its one address';
  perform service.suppress('aaaaaaaa-0000-0000-0000-000000000000', 'email', 't35-c@example.test', 'complaint');
  assert (select count(*) from service.outbox_claim(10)) = 0, 'T35f a suppressed address is never claimed';
  assert not exists (select 1 from public.mail_outbox where lead_id = test.id('t35_3')), 'T35f its row is gone';
  assert not exists (select 1 from public.messages where lead_id = test.id('t35_3')), 'T35f no message was recorded';
end $$;
-- (g) the tick: nothing due calls nothing; a due row without pg_net says so (where pg_net exists, the call is proven on staging)
do $$ begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then raise notice 'T35g skipped: pg_net is installed here'; return; end if;
  assert service.mail_outbox_tick() = 'idle', 'T35g with no due row the tick is idle';
  update public.mail_outbox set next_at = now() where lead_id = test.id('t35_2') and to_text = 't35-a@example.test';
  assert service.mail_outbox_tick() = 'not installed', 'T35g with a due row and no pg_net the tick says not installed';
end $$;
-- (h) the schedule (the cron stand-in of run-local.mjs; T25 counts it among the jobs)
do $$ begin
  if to_regclass('cron.stub_jobs') is null then raise notice 'T35h skipped: no cron stand-in here'; return; end if;
  assert (select count(*) from cron.stub_jobs where jobname = 'mail-outbox') = 1 and (select schedule from cron.stub_jobs where jobname = 'mail-outbox') = '* * * * *'
    and (select command from cron.stub_jobs where jobname = 'mail-outbox') ~ 'service\.mail_outbox_tick\(\)', 'T35h mail-outbox runs every minute and calls service.mail_outbox_tick()';
end $$;
-- (i) the walls, as T26d: only the definer functions write the outbox; an owner reads none; staff with MFA read it; the four functions are closed to anon and
-- authenticated; the function role runs queue, claim and done, never the tick
set role service_role;
select test.expect_error($q$insert into public.mail_outbox (lead_id, template, to_text) values ('00000000-0000-0000-0000-000000000000', 'new-lead', 'x@test')$q$, 'permission denied');
select test.expect_error($q$update public.mail_outbox set attempts = 0$q$, 'permission denied');
select test.expect_error($q$delete from public.mail_outbox$q$, 'permission denied');
select test.expect_error($q$select count(*) from public.mail_outbox$q$, 'permission denied');
reset role;
set role omnikom_fn;
select test.expect_error($q$insert into public.mail_outbox (lead_id, template, to_text) values ('00000000-0000-0000-0000-000000000000', 'new-lead', 'x@test')$q$, 'permission denied');
select test.expect_error($q$update public.mail_outbox set attempts = 0$q$, 'permission denied');
select test.expect_error($q$delete from public.mail_outbox$q$, 'permission denied');
select test.expect_error($q$select count(*) from public.mail_outbox$q$, 'permission denied');
reset role;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from public.mail_outbox) = 0, 'T35i an owner reads no outbox row'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select count(*) from public.mail_outbox) > 0, 'T35i staff with MFA read the outbox'; end $$;
reset role;
do $$ declare f text; begin
  foreach f in array array['service.queue_lead_alert(uuid,uuid)', 'service.outbox_claim(integer,timestamp with time zone)', 'service.outbox_done(uuid,boolean,text,text)', 'service.mail_outbox_tick()'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'), 'T35i ' || f || ' is closed to anon and authenticated';
  end loop;
  foreach f in array array['service.queue_lead_alert(uuid,uuid)', 'service.outbox_claim(integer,timestamp with time zone)', 'service.outbox_done(uuid,boolean,text,text)'] loop
    assert has_function_privilege('omnikom_fn', f, 'execute'), 'T35i the function role runs ' || f;
  end loop;
  assert not has_function_privilege('omnikom_fn', 'service.mail_outbox_tick()', 'execute'), 'T35i the function role cannot run the tick';
end $$;
-- back: site A's alert list and A's email limit as the earlier blocks left them
update public.sites set lead_alert_to = (select lead_alert_to from test.t35_site) where id = 'aaaaaaaa-0000-0000-0000-00000000517e';
insert into public.workspace_limits select * from test.t35_limit on conflict (workspace_id, key) do update set value = excluded.value, note = excluded.note;

-- ===== T36 E5 (migration 30): visitor counts =====
-- capture-lead calls service.count_visitor(site, hash) for a signed post that carries a visitor (the site endpoint's sha256 of "<site id>:<address>"): it counts
-- that visitor of that site in the clock hour and refuses the call past leads_per_hour_visitor, the refusal undoing its own count. The table keeps one hour per
-- site: the call deletes that site's older hours. The whole file is one transaction, so now() is one instant here. Superuser unless said; site A is ...517e.
-- Mutants "visitor30: ..." in run-local.mjs.
reset role;
-- (a) one visitor: 1 to 5, the sixth refused, the count stays 5
do $$ declare c int; begin
  for i in 1..5 loop
    c := service.count_visitor('aaaaaaaa-0000-0000-0000-00000000517e', repeat('1', 64));
    assert c = i, 'T36a the count of one visitor goes 1 to 5: ' || c || ' at ' || i;
  end loop;
end $$;
select test.expect_error($q$select service.count_visitor('aaaaaaaa-0000-0000-0000-00000000517e', repeat('1', 64))$q$, 'S-QUOTA-VISITOR');
do $$ begin
  assert (select n from public.visitor_counts where site_id = 'aaaaaaaa-0000-0000-0000-00000000517e' and ip_hash = repeat('1', 64)) = 5, 'T36a a refused call leaves the count at 5';
end $$;
-- (b) another visitor of the site, and the same visitor at another site of workspace A, each start at 1
insert into public.sites (id, workspace_id, deploy_target, preview_host) values ('aaaaaaaa-0000-0000-0000-0000000a0e36', 'aaaaaaaa-0000-0000-0000-000000000000', 'test-site-t36', 't36.preview.test');
do $$ begin
  assert service.count_visitor('aaaaaaaa-0000-0000-0000-00000000517e', repeat('2', 64)) = 1, 'T36b another visitor of the site starts at 1';
  assert service.count_visitor('aaaaaaaa-0000-0000-0000-0000000a0e36', repeat('1', 64)) = 1, 'T36b the same visitor at another site starts at 1';
end $$;
-- (c) the workspace's own limit wins over the platform's: with 1, the second call of a visitor is refused
insert into public.workspace_limits (workspace_id, key, value, note) values ('aaaaaaaa-0000-0000-0000-000000000000', 'leads_per_hour_visitor', 1, 'T36c');
do $$ begin assert service.count_visitor('aaaaaaaa-0000-0000-0000-00000000517e', repeat('3', 64)) = 1, 'T36c the first call of a visitor passes'; end $$;
select test.expect_error($q$select service.count_visitor('aaaaaaaa-0000-0000-0000-00000000517e', repeat('3', 64))$q$, 'S-QUOTA-VISITOR');
delete from public.workspace_limits where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and key = 'leads_per_hour_visitor';
-- (d) a call deletes the older hours of its own site only
insert into public.visitor_counts (site_id, ip_hash, hour, n) values ('aaaaaaaa-0000-0000-0000-00000000517e', repeat('4', 64), date_trunc('hour', now()) - interval '2 hours', 9);
insert into public.visitor_counts (site_id, ip_hash, hour, n) values ('aaaaaaaa-0000-0000-0000-0000000a0e36', repeat('4', 64), date_trunc('hour', now()) - interval '2 hours', 9);
do $$ begin
  assert service.count_visitor('aaaaaaaa-0000-0000-0000-00000000517e', repeat('5', 64)) = 1, 'T36d a visitor of a new hour starts at 1';
  assert not exists (select 1 from public.visitor_counts where site_id = 'aaaaaaaa-0000-0000-0000-00000000517e' and hour < date_trunc('hour', now())), 'T36d the older hours of the site are gone';
  assert (select count(*) from public.visitor_counts where site_id = 'aaaaaaaa-0000-0000-0000-0000000a0e36') = 2, 'T36d the older hour of another site stays, and so does its row of this hour';
end $$;
-- (e) an unknown site
select test.expect_error($q$select service.count_visitor(gen_random_uuid(), repeat('1', 64))$q$, 'unknown site');
-- (f) the platform limit
do $$ begin assert (select value from public.platform_limits where key = 'leads_per_hour_visitor') = 5, 'T36f the platform limit of one visitor is 5 an hour'; end $$;
-- (g) the walls, as T26d: only the definer function writes the counts; an owner reads none; staff with MFA read them; the function is closed to anon and
-- authenticated and open to the function role
set role service_role;
select test.expect_error($q$insert into public.visitor_counts (site_id, ip_hash, hour) values ('aaaaaaaa-0000-0000-0000-00000000517e', 'x', now())$q$, 'permission denied');
select test.expect_error($q$update public.visitor_counts set n = 0$q$, 'permission denied');
select test.expect_error($q$delete from public.visitor_counts$q$, 'permission denied');
select test.expect_error($q$select count(*) from public.visitor_counts$q$, 'permission denied');
reset role;
set role omnikom_fn;
select test.expect_error($q$insert into public.visitor_counts (site_id, ip_hash, hour) values ('aaaaaaaa-0000-0000-0000-00000000517e', 'x', now())$q$, 'permission denied');
select test.expect_error($q$update public.visitor_counts set n = 0$q$, 'permission denied');
select test.expect_error($q$delete from public.visitor_counts$q$, 'permission denied');
select test.expect_error($q$select count(*) from public.visitor_counts$q$, 'permission denied');
reset role;
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from public.visitor_counts) = 0, 'T36g an owner reads no visitor count'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select count(*) from public.visitor_counts) > 0, 'T36g staff with MFA read the visitor counts'; end $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon', 'service.count_visitor(uuid,text)', 'execute') and not has_function_privilege('authenticated', 'service.count_visitor(uuid,text)', 'execute'), 'T36g count_visitor is closed to anon and authenticated';
  assert has_function_privilege('omnikom_fn', 'service.count_visitor(uuid,text)', 'execute'), 'T36g the function role runs count_visitor';
end $$;
-- back: the block's site goes, with its counts (the foreign key cascades)
delete from public.sites where id = 'aaaaaaaa-0000-0000-0000-0000000a0e36';

-- ===== T37 E21 (migration 31): bounces and complaints =====
-- The mail-events function (Resend's signed webhook) calls service.mail_event(email id, kind) for a permanent bounce ('bounce') or a spam complaint ('complaint'):
-- the address is read from our own message that Resend's email id names (never from the payload) and suppressed through service.suppress, a bounce for the whole
-- platform and a complaint for the message's workspace; an email id that is none of our messages does nothing. Superuser; two messages of workspace A, state sent.
-- Mutants "events31: ..." in run-local.mjs.
reset role;
insert into public.messages (workspace_id, lead_id, channel, template, to_text, state, provider_id) values
  ('aaaaaaaa-0000-0000-0000-000000000000', null, 'email', 'new-lead', 't37-b@example.test', 'sent', 're_t37_1'),
  ('aaaaaaaa-0000-0000-0000-000000000000', null, 'email', 'new-lead', 't37-c@example.test', 'sent', 're_t37_2');
-- (a) a bounce: one suppression for the whole platform (no workspace), reason bounce; a workspace that never sent to the address is refused it too
do $$ begin
  assert service.mail_event('re_t37_1', 'bounce') = 1, 'T37a a bounce of one of our messages answers 1';
  assert (select count(*) from public.suppressions where channel = 'email' and address_hash = private.address_hash('email', 't37-b@example.test')) = 1, 'T37a one suppression of the bounced address';
  assert (select count(*) from public.suppressions where channel = 'email' and address_hash = private.address_hash('email', 't37-b@example.test')
          and workspace_id is null and reason = 'bounce' and source = 'resend webhook') = 1, 'T37a it is for the whole platform, reason bounce, source resend webhook';
  assert private.is_suppressed('bbbbbbbb-0000-0000-0000-000000000000', 'email', 't37-b@example.test'), 'T37a the bounced address is suppressed for workspace B too';
end $$;
-- (b) a complaint: one suppression of workspace A, reason complaint; workspace B is not refused that address
do $$ begin
  assert service.mail_event('re_t37_2', 'complaint') = 1, 'T37b a complaint of one of our messages answers 1';
  assert (select count(*) from public.suppressions where channel = 'email' and address_hash = private.address_hash('email', 't37-c@example.test')
          and workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and reason = 'complaint' and source = 'resend webhook') = 1, 'T37b one suppression, of workspace A, reason complaint';
  assert private.is_suppressed('aaaaaaaa-0000-0000-0000-000000000000', 'email', 't37-c@example.test'), 'T37b the address is suppressed for workspace A';
  assert not private.is_suppressed('bbbbbbbb-0000-0000-0000-000000000000', 'email', 't37-c@example.test'), 'T37b and not for workspace B';
end $$;
-- (c) the same event again writes nothing more; an email id that is none of our messages answers 0 and writes nothing
do $$ declare n0 int; begin
  assert service.mail_event('re_t37_1', 'bounce') = 1, 'T37c the same bounce again answers 1';
  assert (select count(*) from public.suppressions where channel = 'email' and address_hash = private.address_hash('email', 't37-b@example.test')) = 1, 'T37c and there is still one suppression';
  n0 := (select count(*) from public.suppressions);
  assert service.mail_event('re_none', 'bounce') = 0, 'T37c an email id that is none of our messages answers 0';
  assert (select count(*) from public.suppressions) = n0, 'T37c and writes no suppression';
end $$;
-- (d) the grants: closed to anon and authenticated, open to the function role
do $$ begin
  assert not has_function_privilege('anon', 'service.mail_event(text,text)', 'execute') and not has_function_privilege('authenticated', 'service.mail_event(text,text)', 'execute'), 'T37d mail_event is closed to anon and authenticated';
  assert has_function_privilege('omnikom_fn', 'service.mail_event(text,text)', 'execute'), 'T37d the function role runs mail_event';
end $$;
-- (e) a message whose address was erased (migration 26 leaves to_text as 'erased:' and the sha256 of the old address, and keeps provider_id) is no message of ours:
-- a bounce and then a complaint for it answer 0 and write no suppression, neither of the erased text nor of the address it was made from
do $$ declare e text := 'erased:' || encode(sha256(convert_to('t37-e@example.test', 'utf8')), 'hex'); n0 int; begin
  insert into public.messages (workspace_id, lead_id, channel, template, to_text, state, provider_id)
    values ('aaaaaaaa-0000-0000-0000-000000000000', null, 'email', 'new-lead', e, 'sent', 're_t37_3');
  n0 := (select count(*) from public.suppressions);
  assert service.mail_event('re_t37_3', 'bounce') = 0, 'T37e a bounce for an erased address answers 0';
  assert service.mail_event('re_t37_3', 'complaint') = 0, 'T37e a complaint for an erased address answers 0';
  assert (select count(*) from public.suppressions) = n0, 'T37e and neither writes a suppression';
  assert not exists (select 1 from public.suppressions where address_hash in (private.address_hash('email', e), private.address_hash('email', 't37-e@example.test'))), 'T37e no suppression of the erased text or of its old address';
end $$;

-- ===== T38 E3 (migration 32): the function error sink =====
-- Every function serves through withRequestId (_shared/http.ts): an answer of 500 to 599 calls service.record_function_error(function, status, request id),
-- which first deletes the rows older than 30 days, then counts the error in function_errors, one row per function, status and minute, with the newest
-- request id. Nothing stores a cause or a value. The whole file is one transaction, so now() (and the minute) is one instant here; the counts read this
-- block's functions in that minute only. Superuser unless said. Mutants "errors32: ..." in run-local.mjs; the function side: request-id.test.ts [E3].
reset role;
-- (a) two errors of one function, status and minute: one row, n 2, the newest request id
do $$ begin
  perform service.record_function_error('capture-lead', 500, '00000000-0000-4000-8000-0000000038a1');
  perform service.record_function_error('capture-lead', 500, '00000000-0000-4000-8000-0000000038a2');
  assert (select count(*) from public.function_errors where fn = 'capture-lead' and minute = date_trunc('minute', now())) = 1, 'T38a two errors of one function, status and minute are one row';
  assert (select n from public.function_errors where fn = 'capture-lead' and status = 500 and minute = date_trunc('minute', now())) = 2, 'T38a the row counts both';
  assert (select last_request from public.function_errors where fn = 'capture-lead' and status = 500 and minute = date_trunc('minute', now())) = '00000000-0000-4000-8000-0000000038a2', 'T38a the row keeps the newest request id';
end $$;
-- (b) another status of the function and another function are two more rows
do $$ begin
  perform service.record_function_error('capture-lead', 503, '00000000-0000-4000-8000-0000000038b1');
  perform service.record_function_error('lead-list', 500, '00000000-0000-4000-8000-0000000038b2');
  assert (select count(*) from public.function_errors where fn in ('capture-lead', 'lead-list') and minute = date_trunc('minute', now())) = 3, 'T38b another status and another function are two more rows';
end $$;
-- (c) a name that is not a function folder's and a status below 500 are refused
select test.expect_error($q$select service.record_function_error('Bad Name', 500, gen_random_uuid())$q$, 'function_errors_fn_check');
select test.expect_error($q$select service.record_function_error('capture-lead', 404, gen_random_uuid())$q$, 'function_errors_status_check');
-- (d) the walls, as T26d and T36g: an owner reads none; staff with MFA read them; only the definer function writes the table; the function is closed to anon
-- and authenticated and open to the function role
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from public.function_errors) = 0, 'T38d an owner reads no function error'; end $$;
select test.act_as('00000000-0000-0000-0000-00000000005f', 'aal2');
do $$ begin assert (select count(*) from public.function_errors where fn in ('capture-lead', 'lead-list') and minute = date_trunc('minute', now())) = 3, 'T38d staff with MFA read the three rows'; end $$;
select test.expect_error($q$insert into public.function_errors (fn, status, minute, last_request) values ('x', 500, now(), gen_random_uuid())$q$, 'permission denied');
select test.expect_error($q$update public.function_errors set n = 0$q$, 'permission denied');
select test.expect_error($q$delete from public.function_errors$q$, 'permission denied');
reset role;
set role service_role;
select test.expect_error($q$insert into public.function_errors (fn, status, minute, last_request) values ('x', 500, now(), gen_random_uuid())$q$, 'permission denied');
select test.expect_error($q$update public.function_errors set n = 0$q$, 'permission denied');
select test.expect_error($q$delete from public.function_errors$q$, 'permission denied');
reset role;
set role omnikom_fn;
select test.expect_error($q$insert into public.function_errors (fn, status, minute, last_request) values ('x', 500, now(), gen_random_uuid())$q$, 'permission denied');
select test.expect_error($q$update public.function_errors set n = 0$q$, 'permission denied');
select test.expect_error($q$delete from public.function_errors$q$, 'permission denied');
reset role;
do $$ begin
  assert not has_function_privilege('anon', 'service.record_function_error(text,int,uuid)', 'execute') and not has_function_privilege('authenticated', 'service.record_function_error(text,int,uuid)', 'execute'), 'T38d record_function_error is closed to anon and authenticated';
  assert has_function_privilege('omnikom_fn', 'service.record_function_error(text,int,uuid)', 'execute'), 'T38d the function role runs record_function_error';
end $$;
-- (e) 50 errors of one function, status and minute are one row with n 50
do $$ begin
  for i in 1..50 loop perform service.record_function_error('lead-export', 502, gen_random_uuid()); end loop;
  assert (select count(*) from public.function_errors where fn = 'lead-export' and minute = date_trunc('minute', now())) = 1, 'T38e 50 errors are one row';
  assert (select n from public.function_errors where fn = 'lead-export' and status = 502 and minute = date_trunc('minute', now())) = 50, 'T38e the row counts all 50';
end $$;
-- (f) the table keeps 30 days and is cleaned as it is written: a call deletes the rows older than 30 days, the younger ones stay
insert into public.function_errors (fn, status, minute, last_request) values
  ('save', 500, date_trunc('minute', now()) - interval '31 days', '00000000-0000-4000-8000-0000000038f1'),
  ('save', 500, date_trunc('minute', now()) - interval '29 days', '00000000-0000-4000-8000-0000000038f2');
do $$ begin
  perform service.record_function_error('save', 502, '00000000-0000-4000-8000-0000000038f3');
  assert not exists (select 1 from public.function_errors where fn = 'save' and minute = date_trunc('minute', now()) - interval '31 days'), 'T38f the row of 31 days ago is gone';
  assert exists (select 1 from public.function_errors where fn = 'save' and minute = date_trunc('minute', now()) - interval '29 days'), 'T38f the row of 29 days ago stays';
  assert (select n from public.function_errors where fn = 'save' and status = 502 and minute = date_trunc('minute', now())) = 1, 'T38f the new error is counted';
end $$;

-- ===== T47 E16 (migration 41): plan limits for sites, photos and files, publishes =====
-- Each cap is a platform_limits row (the head's choice) that a workspace_limits row replaces (private.limit_for), checked by a BEFORE INSERT trigger.
-- Each refusal is caught and compared whole, so the words are the test. Mutants "limits41: ..." in run-local.mjs (--only "limits41").
do $$ begin
  assert coalesce((select value from platform_limits where key = 'sites_workspace'), -1) = 25, 'T47.0 the platform cap on sites per workspace is 25';
  assert coalesce((select value from platform_limits where key = 'media_mb_workspace'), -1) = 200, 'T47.0 the platform cap on photos and files per workspace is 200 MB';
  assert coalesce((select value from platform_limits where key = 'publishes_per_day_workspace'), -1) = 100, 'T47.0 the platform cap on publishes per workspace and day is 100';
end $$;
-- a: sites. A's cap is exactly what A already has; one more site of A is refused, B is untouched
do $$ declare n int; msg text; begin
  select count(*) into n from sites where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  insert into workspace_limits (workspace_id, key, value, note) values ('aaaaaaaa-0000-0000-0000-000000000000', 'sites_workspace', n, 'test: the cap is exactly what A already has');
  begin
    insert into sites (workspace_id, deploy_target, preview_host) values ('aaaaaaaa-0000-0000-0000-000000000000', 't47-sites-a', 't47-sites-a.preview.test');
    msg := 'accepted';
  exception when others then msg := sqlerrm; end;
  assert msg = 'S-LIMIT: this workspace has reached its limit of ' || n || ' sites', 'T47a a workspace at its site limit adds no site, in these words: ' || msg;
  insert into sites (workspace_id, deploy_target, preview_host) values ('bbbbbbbb-0000-0000-0000-000000000000', 't47-sites-b', 't47-sites-b.preview.test');
  assert (select count(*) from sites where deploy_target = 't47-sites-b') = 1, 'T47a a site of B is accepted while A is at its limit';
  delete from workspace_limits where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and key = 'sites_workspace';
end $$;
-- b: photos and files. A's cap is 2 MB over what A holds; a file of exactly the room left is accepted, then 1 byte more is refused
do $$ declare s bigint; cap int; room bigint; msg text; begin
  select coalesce(sum(bytes), 0) into s from media where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  cap := (s / 1048576)::int + 2;
  insert into workspace_limits (workspace_id, key, value, note) values ('aaaaaaaa-0000-0000-0000-000000000000', 'media_mb_workspace', cap, 'test: 2 MB over what A holds');
  room := cap::bigint * 1048576 - s;
  perform * from service.record_media(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 't47-fits.jpg', room::int, 'image/jpeg');
  assert (select coalesce(sum(bytes), 0) from media where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000') = cap::bigint * 1048576, 'T47b a file that fills the cap exactly is accepted';
  begin
    perform * from service.record_media(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-000000000000', 't47-over.jpg', 1, 'image/jpeg');
    msg := 'accepted';
  exception when others then msg := sqlerrm; end;
  assert msg = 'S-LIMIT: this workspace has reached its limit of ' || cap || ' MB of photos and files', 'T47b 1 byte over the cap is refused, in these words: ' || msg;
  delete from workspace_limits where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and key = 'media_mb_workspace';
end $$;
-- c: publishes. A job of A two days old does not count; A's cap is today's jobs plus one; one more is accepted, the next refused; B is untouched
do $$ declare n int; msg text; begin
  insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested, created_at)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', '00000000-0000-0000-0000-00000000000a', '{}', '{}', now() - interval '2 days');
  select count(*) into n from publish_jobs where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and created_at >= date_trunc('day', now());
  insert into workspace_limits (workspace_id, key, value, note) values ('aaaaaaaa-0000-0000-0000-000000000000', 'publishes_per_day_workspace', n + 1, 'test: one more than A published today');
  insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', '00000000-0000-0000-0000-00000000000a', '{}', '{}');
  begin
    insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested)
      values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000517e', '00000000-0000-0000-0000-00000000000a', '{}', '{}');
    msg := 'accepted';
  exception when others then msg := sqlerrm; end;
  assert msg = 'S-LIMIT: this workspace has reached its limit of ' || (n + 1) || ' publishes today', 'T47c a workspace at its publish limit publishes no more today, in these words: ' || msg;
  insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested)
    values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000517e', '00000000-0000-0000-0000-00000000000b', '{}', '{}');
  delete from workspace_limits where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and key = 'publishes_per_day_workspace';
end $$;
-- d: the overrides stay staff-only (the wall of the per-workspace quota block above)
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from workspace_limits) = 0, 'T47d an owner still reads no workspace limit'; end $$;
reset role;

-- ===== T-B15 (book row B15, migration 42): the preview job =====
-- set here, not assumed: A active, no build of site A running (earlier blocks may leave one); A's state is put back at the end
create table test.tb15_ws as select id, state from public.workspaces where id = 'aaaaaaaa-0000-0000-0000-000000000000'; update public.workspaces set state = 'active' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select service.set_job_state(id, 'failed') from public.publish_jobs where site_id = 'aaaaaaaa-0000-0000-0000-00000000517e' and state in ('queued', 'building', 'gating', 'deploying');
set role authenticated; select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.save('aaaaaaaa-0000-0000-0000-000000000000', 'listings', test.id('listing1'), jsonb_build_object('street', '1 Demo Road preview', 'status', 'for-sale', 'agent', test.id('team1')));
select test.expect_error($q$select service.start_preview(test.claims(), 'aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'permission denied'); reset role;
insert into test.ids select 'jobP', (service.start_preview(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e') ->> 'job')::uuid;
do $$ begin
  assert (select preview and rows = '{}' from publish_jobs where id = test.id('jobP')), 'TB15a a preview job with no rows to publish';
  assert (select (requested ->> test.id('listing1')::text)::int from publish_jobs where id = test.id('jobP')) = (select max(n) from content_versions where row_id = test.id('listing1')), 'TB15a the ready draft at its newest version';
  assert (select not (requested ? test.id('dwPage')::text) and coalesce((select e ->> 'path' from jsonb_array_elements(left_out) e where e ->> 'row' = test.id('dwPage')::text), '') <> '' from publish_jobs where id = test.id('jobP')), 'TB15a the not-ready draft (T20''s page) is left out and named with its field';
  assert not exists (select 1 from jsonb_object_keys((select requested from publish_jobs where id = test.id('jobP'))) k join content_rows c on c.id = k::uuid where c.workspace_id <> 'aaaaaaaa-0000-0000-0000-000000000000'), 'TB15a nothing of another workspace';
  assert not (select preview from publish_jobs where id = test.id('jobX')) and exists (select 1 from audit_log where action = 'preview-start' and target = test.id('jobP')::text), 'TB15a a publish is not a preview; the start is in the audit log';
end $$;
do $$ declare a jsonb; begin   -- only not-ready drafts: the other rows of A are hidden for this one call, and put back by the raise
  update public.content_rows set deleted_at = now() where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and deleted_at is null and id <> test.id('dwPage');
  a := service.start_preview(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e');
  assert a -> 'job' = 'null'::jsonb and a -> 'left_out' @> jsonb_build_array(jsonb_build_object('row', test.id('dwPage'))), 'TB15b only not-ready drafts: no job, each one named';
  raise exception 'TB15b-undo';
exception when others then if sqlerrm <> 'TB15b-undo' then raise; end if;
end $$;
select test.expect_error($q$select service.start_preview(test.cl('00000000-0000-0000-0000-0000000000a1'), 'aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'S-ROLE');
select test.expect_error($q$select service.start_preview(test.cl('00000000-0000-0000-0000-00000000000b'), 'aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'S-NOT-FOUND');
update public.workspaces set state = 'suspended' where id = 'aaaaaaaa-0000-0000-0000-000000000000'; select test.expect_error($q$select service.start_preview(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'S-WORKSPACE-STATE'); update public.workspaces set state = 'active' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
-- a preview counts toward the day's publishes (migration 41's cap): A at its cap today starts no preview; the cap row is removed again
insert into public.workspace_limits (workspace_id, key, value, note) select 'aaaaaaaa-0000-0000-0000-000000000000', 'publishes_per_day_workspace', count(*), 'T-B15: A at its publish limit today' from public.publish_jobs where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and created_at >= date_trunc('day', now());
select test.expect_error($q$select service.start_preview(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e')$q$, 'S-LIMIT'); delete from public.workspace_limits where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' and key = 'publishes_per_day_workspace';
select service.freeze_snapshot(test.id('jobP'));
do $$ declare b jsonb; live int; sa jsonb; begin
  b := service.export_bundle(test.id('jobP'));
  assert (b -> 'job' ->> 'preview')::boolean and not (service.export_bundle(test.id('jobX')) -> 'job' ->> 'preview')::boolean, 'TB15c the export says preview, a publish export not';
  assert (select (r ->> 'version')::int from jsonb_array_elements(b -> 'rows') r where r ->> 'id' = test.id('listing1')::text) = (select max(n) from content_versions where row_id = test.id('listing1')), 'TB15c the export ships the newest version';
  select published_version into live from content_rows where id = test.id('listing1');
  perform service.set_job_state(test.id('jobP'), 'gating'); perform service.set_job_state(test.id('jobP'), 'deploying');
  perform service.set_job_state(test.id('jobP'), 'done', jsonb_build_object('factory', 'pass', 'audit', jsonb_build_object('v', 1, 'target', 'preview', 'pass', true, 'counts', jsonb_build_object('PASS', 1))));
  assert (select published_version from content_rows where id = test.id('listing1')) is not distinct from live, 'TB15c a finished preview publishes nothing';
  sa := service.site_audit(test.cl('00000000-0000-0000-0000-00000000000a'), 'aaaaaaaa-0000-0000-0000-00000000517e');
  assert (sa #>> '{latest,preview,job}') is distinct from test.id('jobP')::text and not (sa -> 'history') @> jsonb_build_array(jsonb_build_object('job', test.id('jobP'))), 'TB15c site_audit skips the preview build (the Overview''s site check)';
end $$;
update public.workspaces w set state = t.state from test.tb15_ws t where w.id = t.id;

select 'ALL TENANCY TESTS PASSED' as result;
rollback;
