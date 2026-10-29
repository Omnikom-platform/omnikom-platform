-- Omnikom Platform: hardening after the fresh-eyes review of 2026-10-29 (docs/blueprint/REVIEW-2026-10-29.md; ground rules
-- docs/blueprint/23-GROUND-RULES.md). Additive to migrations 1 to 3: functions are redefined with their bodies kept line for
-- line where the rule did not change, so the existing mutants keep hitting both copies. Every change here has a test (T14 and
-- the extended T6/T12/T13) and a mutant in supabase/tests/run-local.mjs.

-- ---------- review 1: unpublish let any login unpublish any row (NULL role) ----------
create or replace function service.unpublish(p_claims jsonb, p_row uuid, p_delete boolean default false) returns void language plpgsql security definer set search_path = public as $$
declare me uuid; c content_rows;
begin
  me := service.use_claims(p_claims);
  select * into c from content_rows where id = p_row;
  if not found or not private.is_owner_or_staff(c.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  update content_rows set published_version = null, deleted_at = case when p_delete then now() else deleted_at end where id = p_row;
  insert into audit_log (workspace_id, actor, action, target) values (c.workspace_id, me, case when p_delete then 'delete' else 'unpublish' end, p_row::text);
end $$;

-- contract_for: the same null guard everywhere (the structural gate T14 refuses any un-guarded "if not (" test)
create or replace function service.contract_for(p_claims jsonb, p_workspace uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform service.use_claims(p_claims);
  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  return (select resolved from site_contracts where workspace_id = p_workspace and active);
end $$;

-- ---------- review 3: members could forge media facts through the direct insert ----------
revoke insert on media from authenticated;
grant insert (workspace_id, path, uploaded_by, rights_confirmed) on media to authenticated;   -- facts (width, processed, exif) only from the processor callback

-- ---------- review 4: members were written directly by owners ----------
drop policy members_owner_write on members;
revoke insert, update, delete on members from authenticated;
-- Add or change a member. Owner or staff of the workspace. The team row must belong to the workspace. An unknown user id gets
-- the same answer as any other refusal (no probing whether a login exists). The invite itself goes through Auth (SPEC);
-- this records the membership once the person exists.
create function service.set_member(p_claims jsonb, p_workspace uuid, p_user uuid, p_role member_role, p_team_row uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_team_row is not null and not exists (select 1 from content_rows c where c.id = p_team_row and c.workspace_id = p_workspace and c.collection = 'team' and c.deleted_at is null)
    then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_role = 'member' and p_user = me and private.my_role(p_workspace) = 'owner' and not private.is_staff()
     and (select count(*) from members m where m.workspace_id = p_workspace and m.role = 'owner') = 1
    then raise exception 'S-LAST-OWNER: a workspace keeps at least one owner'; end if;
  insert into members (workspace_id, user_id, role, team_row_id) values (p_workspace, p_user, p_role, p_team_row)
    on conflict (workspace_id, user_id) do update set role = excluded.role, team_row_id = excluded.team_row_id;
  insert into audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'member-set', p_user::text, jsonb_build_object('role', p_role, 'team_row', p_team_row));
end $$;
create function service.remove_member(p_claims jsonb, p_workspace uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid; r member_role;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  select role into r from members m where m.workspace_id = p_workspace and m.user_id = p_user;
  if r is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if r = 'owner' and (select count(*) from members m where m.workspace_id = p_workspace and m.role = 'owner') = 1
    then raise exception 'S-LAST-OWNER: a workspace keeps at least one owner'; end if;
  delete from members m where m.workspace_id = p_workspace and m.user_id = p_user;
  insert into audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'member-remove', p_user::text);
end $$;

-- ---------- review 5: two builds of one site could overlap; published_version could move backwards ----------
create or replace function service.freeze_snapshot(p_job uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare j publish_jobs; snap jsonb;
begin
  select * into j from publish_jobs where id = p_job for update;
  if not found then raise exception 'S-NOT-FOUND: no job'; end if;
  if j.snapshot is not null then return j.snapshot; end if;          -- a rerun ships exactly the same snapshot
  -- one build per site at a time: another job of this site that is still running makes this one wait (the runner's queue retries)
  if exists (select 1 from publish_jobs o where o.site_id = j.site_id and o.id <> j.id and o.state in ('building', 'gating', 'deploying'))
    then raise exception 'S-JOB-BUSY: another build of this site is running'; end if;
  select coalesce(jsonb_object_agg(c.id, c.published_version), '{}') into snap from content_rows c
    where c.workspace_id = j.workspace_id and c.deleted_at is null and c.published_version is not null;
  snap := snap || j.requested;
  update publish_jobs set snapshot = snap where id = p_job;
  perform service.set_job_state(p_job, 'building');
  return snap;
end $$;

create or replace function service.set_job_state(p_job uuid, p_state job_state, p_report jsonb default null, p_deploy text default null, p_error text default null) returns void language plpgsql security definer set search_path = public as $$
declare j publish_jobs; ok boolean;
begin
  select * into j from publish_jobs where id = p_job for update;
  if not found then raise exception 'S-NOT-FOUND: no job'; end if;
  ok := (j.state, p_state) in (('queued','building'), ('building','gating'), ('gating','deploying'), ('deploying','done'))
        or (p_state = 'failed' and j.state not in ('done', 'failed'))
        or (p_state = 'done' and j.state = 'failed' and coalesce(j.gate_report ->> 'reason', '') = 'timeout');   -- reaped, then the deploy landed: reconcile
  ok := coalesce(ok, false);   -- NULL (unknown) must never count as allowed
  if not ok then raise exception 'S-JOB-STATE: % -> % is not allowed', j.state, p_state; end if;
  if p_state = 'done' then
    if j.snapshot is null then raise exception 'S-JOB-STATE: no frozen snapshot'; end if;
    -- a version number only ever rises (a late reconcile never undoes a newer publish); a row deleted meanwhile stays off the site
    update content_rows c set published_version = greatest(coalesce(c.published_version, 0), (j.snapshot ->> c.id::text)::int)
      where c.id = any(j.rows) and c.deleted_at is null;
  end if;
  update publish_jobs set state = p_state, gate_report = coalesce(p_report, gate_report), deploy_id = coalesce(p_deploy, deploy_id), error = coalesce(p_error, error),
    finished_at = case when p_state in ('done', 'failed') then now() end where id = p_job;
  insert into publish_job_events (job_id, state) values (p_job, p_state);
  insert into audit_log (workspace_id, actor, action, target, detail) values (j.workspace_id, j.requested_by, 'publish-' || p_state, p_job::text, p_report);
end $$;

-- ---------- review 12: save_version: a lock per row (no raw primary-key error on a concurrent save); "own" needs an ownerField ----------
create or replace function private.save_version(p_workspace uuid, p_collection text, p_row uuid, p_data jsonb, p_sign_off jsonb default null)
returns table (row_id uuid, version int) language plpgsql security definer set search_path = public as $$
declare
  def jsonb := private.collection_def(p_workspace, p_collection);
  r content_rows;
  prev jsonb;
  role member_role := private.my_role(p_workspace);
  staff boolean := private.is_staff();
  member_access text := def -> 'access' ->> 'member';
  owner_field text := def ->> 'ownerField';
  owner_val uuid;
  changed text;
  next_n int;
  me uuid := (select auth.uid());
begin
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;   -- outsiders learn nothing
  if def is null then raise exception 'S-COLLECTION: no collection % in the active contract', p_collection; end if;
  if member_access = 'own' and owner_field is null then raise exception 'S-CONTRACT: collection % says own but names no ownerField', p_collection; end if;
  if p_row is not null then
    perform pg_advisory_xact_lock(hashtext(p_row::text));   -- two saves of one row queue instead of colliding on the version number
    select * into r from content_rows where id = p_row and workspace_id = p_workspace and collection = p_collection and deleted_at is null;
    if not found then raise exception 'S-NOT-FOUND: not found'; end if;
    select data into prev from content_versions where content_versions.row_id = r.id order by n desc limit 1;
  end if;
  if owner_field = 'self' then owner_val := coalesce(r.id, null);
  elsif owner_field is not null then
    if role = 'member' and (p_data ->> owner_field) is null then
      p_data := jsonb_set(p_data, array[owner_field], to_jsonb(private.my_team_row(p_workspace)::text));
    end if;
    owner_val := nullif(p_data ->> owner_field, '')::uuid;
  end if;
  if not staff and role = 'member' then
    if member_access = 'none' or member_access is null then raise exception 'S-ROLE: members cannot edit %', p_collection; end if;
    if member_access = 'own' then
      if owner_field = 'self' and (p_row is null or p_row <> private.my_team_row(p_workspace)) then raise exception 'S-OWN-ONLY: own items only'; end if;
      if owner_field <> 'self' and (owner_val is distinct from private.my_team_row(p_workspace)
          or (p_row is not null and r.owner_team_row is distinct from private.my_team_row(p_workspace))) then
        raise exception 'S-OWN-ONLY: own items only';
      end if;
    end if;
  end if;
  select f.key into changed from jsonb_each(def -> 'fields') f
    where f.value ? 'locked' and (coalesce(prev, '{}'::jsonb) -> f.key) is distinct from (p_data -> f.key) limit 1;
  if changed is not null then
    if not staff then raise exception 'S-LOCKED: "%" is locked; Omnikom changes it after sign-off', changed; end if;
    if p_sign_off is null or p_sign_off ->> 'by' is null or p_sign_off ->> 'ref' is null then
      raise exception 'S-SIGNOFF: changing locked "%" needs a sign-off { by, ref }', changed; end if;
  end if;
  if p_row is null and def ->> 'kind' = 'singleton'
    and exists (select 1 from content_rows where workspace_id = p_workspace and collection = p_collection and deleted_at is null)
    then raise exception 'S-SINGLETON: % has one row; edit it', p_collection; end if;
  if p_row is null then
    insert into content_rows (workspace_id, collection, owner_team_row) values (p_workspace, p_collection, owner_val) returning * into r;
  elsif owner_field is not null and owner_field <> 'self' then
    update content_rows set owner_team_row = owner_val where id = r.id;
  end if;
  select coalesce(max(n), 0) + 1 into next_n from content_versions where content_versions.row_id = r.id;
  insert into content_versions (row_id, n, workspace_id, data, by, sign_off) values (r.id, next_n, p_workspace, p_data, me, case when changed is not null then p_sign_off end);
  insert into audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'save', p_collection || ':' || r.id, jsonb_build_object('version', next_n, 'locked_change', changed));
  return query select r.id, next_n;
end $$;

-- ---------- review 6, 8, 12: leads: SMS consent and STOP recorded explicitly; paused sites refuse; bounded inputs; idempotent insert ----------
alter table leads add column sms_consent boolean not null default false, add column sms_stopped_at timestamptz;
alter table leads add constraint leads_bounded check (length(coalesce(name, '')) <= 120 and length(coalesce(email, '')) <= 320 and length(coalesce(phone, '')) <= 40
  and length(page_path) <= 300 and length(form) <= 60 and length(consent_text) <= 2000 and pg_column_size(answers) <= 16384);
alter type lead_event_kind add value 'sms-stop';

drop function service.capture_lead(uuid, text, text, text, text, text, jsonb, text, text, text, jsonb, uuid, text, text, text);
create function service.capture_lead(p_site uuid, p_form text, p_page text, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text,
  p_flow text default null, p_cta text default null, p_marketing jsonb default null, p_idempotency uuid default null, p_assignee text default null,
  p_ip_hash text default null, p_user_agent text default null, p_sms_consent boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; st site_state; lid uuid; who uuid;
begin
  select workspace_id, state into ws, st from sites where sites.id = p_site;
  if ws is null then raise exception 'unknown site'; end if;
  if st = 'paused' then raise exception 'S-SITE-PAUSED: this site is paused'; end if;
  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;
  if p_idempotency is not null then
    select leads.id into lid from leads where site_id = p_site and idempotency_key = p_idempotency;
    if lid is not null then return lid; end if;    -- a retry of the same submission stores nothing and answers the same id
  end if;
  if p_assignee is not null then
    -- the team row of THIS workspace whose latest version has that slug; another workspace's slug never matches
    select c.id into who from content_rows c
      join content_versions v on v.row_id = c.id and v.n = (select max(n) from content_versions x where x.row_id = c.id)
      where c.workspace_id = ws and c.collection = 'team' and c.deleted_at is null and v.data ->> 'slug' = p_assignee limit 1;
  end if;
  -- two concurrent retries: the unique index decides, the loser reads the winner's row
  insert into leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text, flow, cta, marketing_consent, idempotency_key, source_ip_hash, user_agent, owner_team_row, sms_consent)
    values (ws, p_site, p_form, p_page, p_name, p_email, p_phone, coalesce(p_answers, '{}'), p_consent, p_flow, p_cta, p_marketing, p_idempotency, p_ip_hash, p_user_agent, who, coalesce(p_sms_consent, false))
    on conflict (site_id, idempotency_key) where idempotency_key is not null do nothing
    returning leads.id into lid;
  if lid is null then select leads.id into lid from leads where site_id = p_site and idempotency_key = p_idempotency; return lid; end if;
  insert into lead_events (lead_id, workspace_id, kind, detail) values (lid, ws, 'received', jsonb_build_object('form', p_form, 'page', p_page, 'flow', p_flow));
  return lid;
end $$;

-- A STOP reply (or a request): no more SMS to this lead, ever, recorded on the timeline.
create function service.lead_sms_stop(p_lead uuid, p_detail jsonb default '{}') returns void language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select workspace_id into ws from leads where leads.id = p_lead;
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  update leads set sms_stopped_at = coalesce(sms_stopped_at, now()) where id = p_lead;
  insert into lead_events (lead_id, workspace_id, kind, detail) values (p_lead, ws, 'sms-stop', coalesce(p_detail, '{}'));
end $$;

-- Delete a lead on request (privacy): owner or staff; the audit row survives the cascade, the timeline goes with the lead.
create function service.delete_lead(p_claims jsonb, p_lead uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare me uuid; l leads;
begin
  me := service.use_claims(p_claims);
  select * into l from leads where id = p_lead;
  if not found or not private.is_owner_or_staff(l.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-delete', p_lead::text, jsonb_build_object('reason', p_reason, 'email_hash', encode(sha256(convert_to(coalesce(l.email, ''), 'utf8')), 'hex')));
  delete from leads where id = p_lead;
end $$;

-- lead_update: an owner can also unassign (p_unassign); otherwise unchanged (the lines the mutants hit are kept verbatim).
drop function service.lead_update(jsonb, uuid, lead_status, uuid, text);
create function service.lead_update(p_claims jsonb, p_lead uuid, p_status lead_status default null, p_owner uuid default null, p_note text default null, p_unassign boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid; l leads; role member_role; staff boolean; mine uuid;
begin
  me := service.use_claims(p_claims);
  select * into l from leads where id = p_lead for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  staff := private.is_staff(); role := private.my_role(l.workspace_id); mine := private.my_team_row(l.workspace_id);
  if not coalesce(staff or role = 'owner' or (role = 'member' and l.owner_team_row = mine), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_status is not null and p_status is distinct from l.status then
    update leads set status = p_status where id = p_lead;
    insert into lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'status', me, jsonb_build_object('from', l.status, 'to', p_status));
  end if;
  if p_owner is not null and p_owner is distinct from l.owner_team_row then
    if not staff and role = 'member' then raise exception 'S-OWN-ONLY: members cannot hand a lead to someone else'; end if;
    if not exists (select 1 from content_rows c where c.id = p_owner and c.workspace_id = l.workspace_id and c.collection = 'team' and c.deleted_at is null)
      then raise exception 'S-NOT-FOUND: no such team member'; end if;
    update leads set owner_team_row = p_owner where id = p_lead;
    insert into lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'assigned', me, jsonb_build_object('from', l.owner_team_row, 'to', p_owner));
  end if;
  if p_unassign and l.owner_team_row is not null then
    if not staff and role = 'member' then raise exception 'S-OWN-ONLY: members cannot hand a lead to someone else'; end if;
    update leads set owner_team_row = null where id = p_lead;
    insert into lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'assigned', me, jsonb_build_object('from', l.owner_team_row, 'to', null));
  end if;
  if coalesce(p_note, '') <> '' then
    if length(p_note) > 2000 then raise exception 'S-NOTE: a note is at most 2000 characters'; end if;
    insert into lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'note', me, jsonb_build_object('text', p_note));
  end if;
  insert into audit_log (workspace_id, actor, action, target) values (l.workspace_id, me, 'lead-update', p_lead::text);
end $$;

-- ---------- review 6: messages: explicit SMS consent, STOP, per-workspace and platform caps, idempotency, legal transitions ----------
alter table messages add column idem_key text check (length(idem_key) <= 120);
create unique index messages_once on messages (workspace_id, idem_key) where idem_key is not null;
insert into platform_limits (key, value, note) values
  ('email_per_day_workspace', 40, 'one noisy client never blocks the others (review 6)'),
  ('sms_per_day_workspace', 100, 'ESTIMATE until the SMS provider is chosen (D11)');

drop function service.record_message(uuid, uuid, uuid, message_channel, text, text, uuid, timestamptz);
create function service.record_message(p_workspace uuid, p_lead uuid, p_user uuid, p_channel message_channel, p_template text, p_to text, p_about_booking uuid default null, p_now timestamptz default now(), p_idem_key text default null)
returns table (id uuid, state message_state, reason text) language plpgsql security definer set search_path = public as $$
declare l leads; cap int; cap_ws int; sent_today int; sent_ws int; tz text; h int; st message_state := 'queued'; why text; mid uuid; ex record;
begin
  if p_idem_key is not null then
    select m.id, m.state, m.error into ex from messages m where m.workspace_id = p_workspace and m.idem_key = p_idem_key;
    if ex.id is not null then return query select ex.id, ex.state, ex.error; return; end if;   -- a retry records nothing twice
  end if;
  if p_lead is not null then
    select * into l from leads where leads.id = p_lead;
    if not found or l.workspace_id <> p_workspace then raise exception 'S-NOT-FOUND: not found'; end if;
    if p_channel = 'sms' and not l.sms_consent then raise exception 'M-CONSENT: this person did not agree to text messages'; end if;
    if p_channel = 'sms' and l.sms_stopped_at is not null then raise exception 'M-STOP: this person asked for no more texts'; end if;
  elsif p_channel = 'sms' and p_user is null then
    raise exception 'M-CONSENT: an SMS needs a lead with consent or a team member';
  end if;
  select value into cap from platform_limits where key = p_channel::text || '_per_day';
  select value into cap_ws from platform_limits where key = p_channel::text || '_per_day_workspace';
  select count(*), count(*) filter (where m.workspace_id = p_workspace) into sent_today, sent_ws from messages m
    where m.channel = p_channel and m.state <> 'blocked' and m.created_at >= date_trunc('day', p_now) and m.created_at < date_trunc('day', p_now) + interval '1 day';
  if cap_ws is not null and sent_ws >= cap_ws then st := 'blocked'; why := 'daily cap (workspace)'; end if;
  if cap is not null and sent_today >= cap then st := 'blocked'; why := 'daily cap'; end if;
  if p_channel = 'sms' and st = 'queued' then
    select timezone into tz from workspaces where workspaces.id = p_workspace;
    h := extract(hour from (p_now at time zone tz));
    if h >= (select value from platform_limits where key = 'quiet_hours_start') or h < (select value from platform_limits where key = 'quiet_hours_end') then
      st := 'blocked'; why := 'quiet hours'; end if;
  end if;
  insert into messages (workspace_id, lead_id, user_id, channel, template, to_text, about_booking, state, error, created_at, idem_key)
    values (p_workspace, p_lead, p_user, p_channel, p_template, p_to, p_about_booking, st, why, p_now, p_idem_key) returning messages.id into mid;
  return query select mid, st, why;
end $$;

create or replace function service.set_message_state(p_message uuid, p_state message_state, p_provider_id text default null, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m messages; ok boolean;
begin
  select * into m from messages where id = p_message for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  if m.state = p_state then return; end if;                           -- a repeated provider callback changes nothing and writes no second event
  ok := (m.state, p_state) in (('queued', 'sent'), ('sent', 'delivered'), ('queued', 'failed'), ('sent', 'failed'), ('blocked', 'queued'), ('queued', 'blocked'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'M-STATE: % -> % is not allowed', m.state, p_state; end if;
  update messages set state = p_state, provider_id = coalesce(p_provider_id, provider_id), error = coalesce(p_error, error), sent_at = case when p_state = 'sent' then now() else sent_at end where id = p_message;
  if m.lead_id is not null and p_state in ('sent', 'failed') then
    insert into lead_events (lead_id, workspace_id, kind, detail) values (m.lead_id, m.workspace_id, case when p_state = 'sent' then 'message-sent' else 'message-failed' end::lead_event_kind,
      jsonb_build_object('message', p_message, 'channel', m.channel, 'template', m.template, 'error', p_error));
  end if;
end $$;

-- ---------- review 7: owners controlled their own billing state ----------
create or replace function service.set_addon_state(p_claims jsonb, p_workspace uuid, p_kind addon_kind, p_state addon_state, p_paid_until date default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid; a add_ons; ok boolean; system boolean := p_claims is null;   -- null claims = the payment webhook (service role), never a login
begin
  if not system then
    me := service.use_claims(p_claims);
    if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
    -- an owner may only cancel; setting-up, active, paused and paid_until come from staff or the payment webhook
    if not private.is_staff() and p_state <> 'cancelled' then raise exception 'S-ROLE: only Omnikom or a payment can change this'; end if;
  end if;
  select * into a from add_ons where workspace_id = p_workspace and kind = p_kind for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (a.state, p_state) in (('paying', 'setting-up'), ('setting-up', 'active'), ('active', 'paused'), ('paused', 'active'))
        or (p_state = 'cancelled' and a.state <> 'cancelled');
  ok := coalesce(ok, false);
  if not ok then raise exception 'S-ADDON-STATE: % -> % is not allowed', a.state, p_state; end if;
  update add_ons set state = p_state, paid_until = coalesce(p_paid_until, paid_until), cancelled_at = case when p_state = 'cancelled' then now() end
    where workspace_id = p_workspace and kind = p_kind;
  insert into audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'addon-' || p_state, p_kind::text, jsonb_build_object('from', a.state, 'system', system));
end $$;
-- re-activating a cancelled add-on starts at paying again but must not keep an old paid_until
create or replace function service.activate_addon(p_claims jsonb, p_workspace uuid, p_kind addon_kind, p_settings jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into add_ons (workspace_id, kind, state, settings, activated_by) values (p_workspace, p_kind, 'paying', coalesce(p_settings, '{}'), me)
    on conflict (workspace_id, kind) do update set state = 'paying', settings = excluded.settings, activated_by = me, activated_at = now(), cancelled_at = null, paid_until = null
    where add_ons.state = 'cancelled';
  if not found then raise exception 'S-ADDON: % is already activated', p_kind; end if;
  insert into audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'addon-activate', p_kind::text);
end $$;

-- ---------- review 12: bookings: null claims only for the concierge; the member the meeting is with may change its state ----------
create or replace function service.book(p_claims jsonb, p_lead uuid, p_with uuid, p_starts timestamptz, p_ends timestamptz, p_where text, p_source booking_source default 'manual')
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid; l leads; bid uuid; role member_role;
begin
  if p_claims is null and p_source <> 'concierge' then raise exception 'S-AUTH: a login is needed for a % booking', p_source; end if;
  me := case when p_claims is null then null else service.use_claims(p_claims) end;   -- the concierge books without a login (service caller)
  select * into l from leads where id = p_lead for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  if me is not null and not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;
  role := case when me is null then null else private.my_role(l.workspace_id) end;
  if role = 'member' and not private.is_staff() and p_with is distinct from private.my_team_row(l.workspace_id) then
    raise exception 'S-OWN-ONLY: members book meetings for themselves'; end if;
  if not exists (select 1 from content_rows c where c.id = p_with and c.workspace_id = l.workspace_id and c.collection = 'team' and c.deleted_at is null)
    then raise exception 'S-NOT-FOUND: no such team member'; end if;
  if p_ends is null or p_starts is null or p_ends <= p_starts then raise exception 'B-TIME: the meeting must end after it starts'; end if;
  perform pg_advisory_xact_lock(hashtext(p_with::text));
  if exists (select 1 from bookings b where b.with_team_row = p_with and b.state in ('proposed', 'confirmed') and b.starts_at < p_ends and b.ends_at > p_starts)
    then raise exception 'B-OVERLAP: that team member already has a meeting then'; end if;
  insert into bookings (workspace_id, lead_id, with_team_row, starts_at, ends_at, where_text, source, state, created_by)
    values (l.workspace_id, p_lead, p_with, p_starts, p_ends, p_where, p_source, (case when p_source = 'concierge' then 'proposed' else 'confirmed' end)::booking_state, me)
    returning id into bid;
  insert into lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'booked', me, jsonb_build_object('booking', bid, 'starts', p_starts, 'with', p_with, 'source', p_source));
  insert into audit_log (workspace_id, actor, action, target) values (l.workspace_id, me, 'book', bid::text);
  return bid;
end $$;

create or replace function service.set_booking_state(p_claims jsonb, p_booking uuid, p_state booking_state) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid; b bookings; l leads; ok boolean;
begin
  if p_claims is null then raise exception 'S-AUTH: a login is needed'; end if;
  me := service.use_claims(p_claims);
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  select * into l from leads where id = b.lead_id;
  -- the lead's people, or the team member the meeting is with
  if not coalesce(private.can_act_on_lead(l) or (private.my_role(b.workspace_id) = 'member' and b.with_team_row = private.my_team_row(b.workspace_id)), false)
    then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (b.state, p_state) in (('proposed', 'confirmed'), ('proposed', 'cancelled'), ('confirmed', 'held'), ('confirmed', 'no-show'), ('confirmed', 'cancelled'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'B-STATE: % -> % is not allowed', b.state, p_state; end if;
  update bookings set state = p_state, updated_at = now() where id = p_booking;
  insert into lead_events (lead_id, workspace_id, kind, by, detail) values (b.lead_id, b.workspace_id, 'booking-changed', me, jsonb_build_object('booking', p_booking, 'from', b.state, 'to', p_state));
end $$;

-- ---------- review 10: CRM template shape; connector secrets anywhere in the config ----------
create or replace function service.save_crm_template(p_claims jsonb, p_workspace uuid, p_id uuid, p_name text, p_crm text, p_direction text, p_columns jsonb, p_value_maps jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid; tid uuid; bad int;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if jsonb_typeof(p_columns) <> 'array' then raise exception 'T-COLUMNS: columns must be a list'; end if;
  select count(*) into bad from jsonb_array_elements(p_columns) c where c ->> 'header' is null or c ->> 'field' is null;
  if bad > 0 then raise exception 'T-COLUMNS: every column needs a header and a field'; end if;
  if (select count(distinct c ->> 'header') from jsonb_array_elements(p_columns) c) <> jsonb_array_length(p_columns) then raise exception 'T-COLUMNS: two columns have the same header'; end if;
  -- a field is one of the lead's own fields or answers.<key>; headers are non-empty text; value maps are an object of objects, bounded
  select count(*) into bad from jsonb_array_elements(p_columns) c
    where jsonb_typeof(c -> 'header') <> 'string' or length(c ->> 'header') not between 1 and 120
       or jsonb_typeof(c -> 'field') <> 'string'
       or (c ->> 'field') !~ '^(name|email|phone|form|page_path|flow|cta|status|created_at|answers\.[a-z][a-zA-Z0-9_]{0,60})$'
       or (c ? 'transform' and (jsonb_typeof(c -> 'transform') <> 'string' or (c ->> 'transform') !~ '^[a-z][a-z0-9-]{0,30}$'));
  if bad > 0 then raise exception 'T-COLUMNS: a column has a bad header, field or transform'; end if;
  if jsonb_typeof(coalesce(p_value_maps, '{}')) <> 'object' or pg_column_size(coalesce(p_value_maps, '{}')) > 65536
     or exists (select 1 from jsonb_each(coalesce(p_value_maps, '{}')) v where jsonb_typeof(v.value) <> 'object')
    then raise exception 'T-VALUE-MAPS: value maps must be an object of objects under 64 KB'; end if;
  if p_id is null then
    insert into crm_templates (workspace_id, name, crm, direction, columns, value_maps, created_by) values (p_workspace, p_name, p_crm, p_direction, p_columns, coalesce(p_value_maps, '{}'), me) returning id into tid;
  else
    update crm_templates set name = p_name, crm = p_crm, direction = p_direction, columns = p_columns, value_maps = coalesce(p_value_maps, '{}'), updated_at = now()
      where id = p_id and workspace_id = p_workspace returning id into tid;
    if tid is null then raise exception 'S-NOT-FOUND: not found'; end if;
  end if;
  insert into audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'crm-template', tid::text);
  return tid;
end $$;

-- a recursive look for secret-looking keys or values anywhere in a JSON document (used by the connectors check constraint)
create function private.has_secret_like(j jsonb) returns boolean language plpgsql immutable as $$
declare k text; v jsonb;
begin
  if j is null then return false; end if;
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      if k ~* '(token|secret|passw|api_?key|private_?key|credential|auth)' then return true; end if;
      if private.has_secret_like(v) then return true; end if;
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      if private.has_secret_like(v) then return true; end if;
    end loop;
  elsif jsonb_typeof(j) = 'string' then
    if (j #>> '{}') ~* '://[^/@\s]+:[^@\s]+@' or (j #>> '{}') ~* '[?&](key|token|secret|api_?key)=' then return true; end if;
  end if;
  return false;
end $$;
alter table connectors drop constraint connectors_no_secret_in_config;
alter table connectors add constraint connectors_no_secret_in_config check (not private.has_secret_like(config));

-- ---------- review 8: the workspace index on every growing table; the job events index ----------
create index if not exists leads_ws_created on leads (workspace_id, created_at desc);
create index if not exists leads_ws_owner on leads (workspace_id, owner_team_row, created_at desc);
create index if not exists lead_events_ws on lead_events (workspace_id, at desc);
create index if not exists audit_log_ws on audit_log (workspace_id, at desc);
create index if not exists content_versions_ws on content_versions (workspace_id, row_id, n desc);
create index if not exists media_ws on media (workspace_id, created_at desc);
create index if not exists publish_jobs_ws on publish_jobs (workspace_id, created_at desc);
create index if not exists publish_jobs_site_state on publish_jobs (site_id, state);
create index if not exists publish_job_events_job on publish_job_events (job_id, at desc);
create index if not exists sites_ws on sites (workspace_id);
create index if not exists api_keys_ws on api_keys (workspace_id);
create index if not exists webhook_events_ws on webhook_events (workspace_id, received_at desc);
create index if not exists messages_ws_state on messages (workspace_id, state, created_at desc);

-- ---------- review 14: bounded payloads ----------
alter table webhook_events add constraint webhook_payload_bounded check (pg_column_size(payload) <= 65536);
alter table lead_events add constraint lead_event_detail_bounded check (pg_column_size(detail) <= 16384);

-- ---------- grants for everything new; service closed again; helpers for policies ----------
revoke all on all functions in schema service from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_staff(), private.my_role(uuid), private.is_member(uuid), private.my_team_row(uuid), private.can_see(uuid), private.collection_def(uuid, text), private.try_uuid(text) to authenticated, service_role;
grant execute on function private.can_act_on_lead(leads), private.is_owner_or_staff(uuid), private.has_secret_like(jsonb) to service_role;
grant execute on all functions in schema service to service_role;
