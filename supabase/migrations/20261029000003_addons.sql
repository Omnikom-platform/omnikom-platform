-- Omnikom Platform: the expansion blocks (DECISIONS 23, docs/blueprint/17-EXPANSION-MAP.md section 2): add-ons, connectors,
-- bookings, messages, CRM templates, the webhook inbox. Additive to migrations 1 and 2. Same rules: RLS on every table, every
-- policy names its role, clients never write directly, every write is a SECURITY DEFINER function that checks membership itself,
-- service functions closed to anon/authenticated. Tested by supabase/tests/run-local.mjs (T13 + mutants).

alter table workspaces add column timezone text not null default 'America/Los_Angeles';   -- quiet hours for SMS, local times in mail

-- The lead's timeline learns the new events (parsed at call time by plpgsql, so adding values here is safe inside the migration).
alter type lead_event_kind add value 'booked';
alter type lead_event_kind add value 'booking-changed';
alter type lead_event_kind add value 'message-sent';
alter type lead_event_kind add value 'message-failed';

-- ---------- add-ons: what a workspace activated, in which state ----------
create type addon_kind as enum ('concierge', 'messaging', 'crm-sync', 'ads');
create type addon_state as enum ('paying', 'setting-up', 'active', 'paused', 'cancelled');
create table add_ons (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind addon_kind not null,
  state addon_state not null default 'paying',
  settings jsonb not null default '{}',          -- hours, assignee, where meetings happen, quiet hours; never a secret
  activated_by uuid references auth.users(id),
  activated_at timestamptz not null default now(),
  paid_until date,
  cancelled_at timestamptz,
  primary key (workspace_id, kind)
);
alter table add_ons enable row level security;
create policy add_ons_read on add_ons for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');

-- ---------- connectors: one row per outside system a workspace is wired to; the secret is in api_keys / Vault ----------
create type connector_kind as enum ('omnisuite', 'crm-webhook', 'calendar', 'sms', 'payment', 'search-console');
create type connector_state as enum ('pending', 'ok', 'failing', 'revoked');
create table connectors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind connector_kind not null,
  label text not null check (length(label) <= 120),
  config jsonb not null default '{}',            -- URLs, ids, calendar id; never a secret (check below)
  api_key_id uuid references api_keys(id),       -- the credential, by registry id
  state connector_state not null default 'pending',
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, label),
  constraint connectors_no_secret_in_config check (not (config ? 'secret' or config ? 'token' or config ? 'password' or config ? 'apiKey' or config ? 'api_key'))
);
create index on connectors (workspace_id, kind);
alter table connectors enable row level security;
create policy connectors_read on connectors for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');

-- ---------- bookings: a meeting agreed with a lead ----------
create type booking_state as enum ('proposed', 'confirmed', 'held', 'no-show', 'cancelled');
create type booking_source as enum ('concierge', 'manual', 'import');
create table bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  with_team_row uuid not null,                   -- the team member who meets the lead (content_rows id in the team collection)
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  where_text text check (length(where_text) <= 300),
  source booking_source not null,
  state booking_state not null default 'proposed',
  external_ref text,                             -- the calendar event id, when a calendar connector exists
  created_by uuid references auth.users(id),     -- empty when the concierge booked it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_time_order check (ends_at > starts_at),
  constraint bookings_length check (ends_at - starts_at <= interval '8 hours')
);
create index on bookings (workspace_id, starts_at);
create index on bookings (with_team_row, starts_at) where state in ('proposed', 'confirmed');
alter table bookings enable row level security;
-- the same rule as leads: staff, the owner, or the member the meeting is with
create policy bookings_read on bookings for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner'
  or (private.my_role(workspace_id) = 'member' and with_team_row = private.my_team_row(workspace_id)));

-- ---------- messages: every SMS and email the platform sends, and the counters that keep the providers inside their limits ----------
create type message_channel as enum ('sms', 'email');
create type message_state as enum ('queued', 'sent', 'delivered', 'failed', 'blocked');
create table messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,   -- a team member as the recipient (alerts, confirmations)
  channel message_channel not null,
  template text not null check (template ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  to_text text not null check (length(to_text) <= 320),        -- the address or the number; the body is rendered at send time from the template, never stored
  about_booking uuid references bookings(id) on delete set null,
  state message_state not null default 'queued',
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on messages (workspace_id, created_at);
create index on messages (channel, created_at);                -- the daily counters
alter table messages enable row level security;
create policy messages_read on messages for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner'
  or user_id = (select auth.uid()) or (lead_id is not null and exists (select 1 from leads l where l.id = lead_id)));

-- platform-wide limits the functions read (the free tiers, 18-BUDGET-ARCHITECTURE.md); staff change them, nobody else
create table platform_limits (key text primary key, value int not null, note text);
insert into platform_limits (key, value, note) values
  ('email_per_day', 95, 'Resend Free: 100 a day (read 2026-10-29); 5 kept for staff alerts'),
  ('sms_per_day', 200, 'ESTIMATE until the SMS provider is chosen (D11)'),
  ('quiet_hours_start', 21, 'no SMS from this local hour'),
  ('quiet_hours_end', 8, 'until this local hour');
alter table platform_limits enable row level security;
create policy platform_limits_staff_read on platform_limits for select to authenticated using (private.is_staff());

-- ---------- CRM templates: a client's own sheet layout, learned once ----------
create table crm_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (length(name) <= 120),
  crm text not null check (crm ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),           -- hubspot, follow-up-boss, custom
  direction text not null check (direction in ('export', 'import', 'both')),
  columns jsonb not null,                                                 -- ordered [{ header, field, transform? }]
  value_maps jsonb not null default '{}',                                 -- { field: { ours: theirs } }
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name),
  constraint crm_templates_columns_shape check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) between 1 and 200)
);
alter table crm_templates enable row level security;
create policy crm_templates_read on crm_templates for select to authenticated using (private.can_see(workspace_id));

-- ---------- webhook inbox: signed callbacks from providers land here first, then a queue processes them ----------
create table webhook_events (
  id bigint generated always as identity primary key,
  connector_id uuid references connectors(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete cascade,
  kind text not null check (length(kind) <= 60),
  provider_event_id text check (length(provider_event_id) <= 200),
  payload jsonb not null default '{}',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
create unique index webhook_events_once on webhook_events (connector_id, provider_event_id) where provider_event_id is not null;
create index on webhook_events (processed_at) where processed_at is null;
alter table webhook_events enable row level security;
create policy webhook_events_staff_read on webhook_events for select to authenticated using (private.is_staff());

-- Grants: anon nothing; authenticated reads through the policies; service_role everything; no client writes anywhere.
revoke all on add_ons, connectors, bookings, messages, platform_limits, crm_templates, webhook_events from anon;
revoke insert, update, delete, truncate, references, trigger on add_ons, connectors, bookings, messages, platform_limits, crm_templates, webhook_events from authenticated;
grant select on add_ons, connectors, bookings, messages, platform_limits, crm_templates, webhook_events to authenticated;
grant all on add_ons, connectors, bookings, messages, platform_limits, crm_templates, webhook_events to service_role;

-- ---------- functions ----------
-- Can this login act on this lead? (staff, the owner, or the member it is assigned to): the one rule, reused.
-- coalesce: a non-member has a NULL role, and "not NULL" would let them through (unknown never counts as allowed).
create function private.can_act_on_lead(l leads) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(private.is_staff() or private.my_role(l.workspace_id) = 'owner'
      or (private.my_role(l.workspace_id) = 'member' and l.owner_team_row = private.my_team_row(l.workspace_id)), false) $$;

-- Owner or staff of this workspace? (the same null guard)
create function private.is_owner_or_staff(ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(private.is_staff() or private.my_role(ws) = 'owner', false) $$;

-- Activate an add-on (the setup wizard, step 2). Owner or staff. Re-activating a cancelled add-on starts again at 'paying'.
create function service.activate_addon(p_claims jsonb, p_workspace uuid, p_kind addon_kind, p_settings jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into add_ons (workspace_id, kind, state, settings, activated_by) values (p_workspace, p_kind, 'paying', coalesce(p_settings, '{}'), me)
    on conflict (workspace_id, kind) do update set state = 'paying', settings = excluded.settings, activated_by = me, activated_at = now(), cancelled_at = null
    where add_ons.state = 'cancelled';
  if not found then raise exception 'S-ADDON: % is already activated', p_kind; end if;
  insert into audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'addon-activate', p_kind::text);
end $$;

-- Legal add-on state changes only: paying -> setting-up -> active; active <-> paused; anything not cancelled -> cancelled.
create function service.set_addon_state(p_claims jsonb, p_workspace uuid, p_kind addon_kind, p_state addon_state, p_paid_until date default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid; a add_ons; ok boolean;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  select * into a from add_ons where workspace_id = p_workspace and kind = p_kind for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (a.state, p_state) in (('paying', 'setting-up'), ('setting-up', 'active'), ('active', 'paused'), ('paused', 'active'))
        or (p_state = 'cancelled' and a.state <> 'cancelled');
  ok := coalesce(ok, false);
  if not ok then raise exception 'S-ADDON-STATE: % -> % is not allowed', a.state, p_state; end if;
  update add_ons set state = p_state, paid_until = coalesce(p_paid_until, paid_until), cancelled_at = case when p_state = 'cancelled' then now() end
    where workspace_id = p_workspace and kind = p_kind;
  insert into audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'addon-' || p_state, p_kind::text, jsonb_build_object('from', a.state));
end $$;

-- Book a meeting with a lead. The caller must be able to act on the lead; the team member must be of the same workspace;
-- a member books only for themselves; two live bookings of one team member never overlap (advisory lock + check, no extension).
create function service.book(p_claims jsonb, p_lead uuid, p_with uuid, p_starts timestamptz, p_ends timestamptz, p_where text, p_source booking_source default 'manual')
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid; l leads; bid uuid; role member_role;
begin
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

-- Legal booking changes: proposed -> confirmed | cancelled; confirmed -> held | no-show | cancelled.
create function service.set_booking_state(p_claims jsonb, p_booking uuid, p_state booking_state) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid; b bookings; l leads; ok boolean;
begin
  me := case when p_claims is null then null else service.use_claims(p_claims) end;
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  select * into l from leads where id = b.lead_id;
  if me is not null and not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (b.state, p_state) in (('proposed', 'confirmed'), ('proposed', 'cancelled'), ('confirmed', 'held'), ('confirmed', 'no-show'), ('confirmed', 'cancelled'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'B-STATE: % -> % is not allowed', b.state, p_state; end if;
  update bookings set state = p_state, updated_at = now() where id = p_booking;
  insert into lead_events (lead_id, workspace_id, kind, by, detail) values (b.lead_id, b.workspace_id, 'booking-changed', me, jsonb_build_object('booking', p_booking, 'from', b.state, 'to', p_state));
end $$;

-- Record an outbound message before it is sent (the send-message function calls this, then the provider). Refuses: SMS without
-- consent that covers texting (M-CONSENT); SMS in the workspace's quiet hours (blocked, retried by the queue later); anything
-- over the day's cap (blocked). p_now is a parameter so the rule is testable.
create function service.record_message(p_workspace uuid, p_lead uuid, p_user uuid, p_channel message_channel, p_template text, p_to text, p_about_booking uuid default null, p_now timestamptz default now())
returns table (id uuid, state message_state, reason text) language plpgsql security definer set search_path = public as $$
declare l leads; cap int; sent_today int; tz text; h int; st message_state := 'queued'; why text; mid uuid;
begin
  if p_lead is not null then
    select * into l from leads where leads.id = p_lead;
    if not found or l.workspace_id <> p_workspace then raise exception 'S-NOT-FOUND: not found'; end if;
    if p_channel = 'sms' and not (l.consent_text ~* '(text|sms)') then raise exception 'M-CONSENT: this person did not agree to text messages'; end if;
  end if;
  select value into cap from platform_limits where key = p_channel::text || '_per_day';
  select count(*) into sent_today from messages m where m.channel = p_channel and m.state <> 'blocked' and m.created_at >= date_trunc('day', p_now) and m.created_at < date_trunc('day', p_now) + interval '1 day';
  if cap is not null and sent_today >= cap then st := 'blocked'; why := 'daily cap'; end if;
  if p_channel = 'sms' and st = 'queued' then
    select timezone into tz from workspaces where workspaces.id = p_workspace;
    h := extract(hour from (p_now at time zone tz));
    if h >= (select value from platform_limits where key = 'quiet_hours_start') or h < (select value from platform_limits where key = 'quiet_hours_end') then
      st := 'blocked'; why := 'quiet hours'; end if;
  end if;
  insert into messages (workspace_id, lead_id, user_id, channel, template, to_text, about_booking, state, error, created_at)
    values (p_workspace, p_lead, p_user, p_channel, p_template, p_to, p_about_booking, st, why, p_now) returning messages.id into mid;
  return query select mid, st, why;
end $$;

-- The provider's answer (sent / delivered / failed) with its id; the lead's timeline gets one line.
create function service.set_message_state(p_message uuid, p_state message_state, p_provider_id text default null, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m messages;
begin
  select * into m from messages where id = p_message for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  update messages set state = p_state, provider_id = coalesce(p_provider_id, provider_id), error = coalesce(p_error, error), sent_at = case when p_state = 'sent' then now() else sent_at end where id = p_message;
  if m.lead_id is not null and p_state in ('sent', 'failed') then
    insert into lead_events (lead_id, workspace_id, kind, detail) values (m.lead_id, m.workspace_id, case when p_state = 'sent' then 'message-sent' else 'message-failed' end::lead_event_kind,
      jsonb_build_object('message', p_message, 'channel', m.channel, 'template', m.template, 'error', p_error));
  end if;
end $$;

-- A provider callback lands here (after the webhook function verified its signature). The same provider event twice stores
-- nothing and answers the first row's id. The workspace comes from the connector, never from the payload.
create function service.webhook_received(p_connector uuid, p_kind text, p_provider_event_id text, p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare ws uuid; eid bigint;
begin
  select workspace_id into ws from connectors where connectors.id = p_connector and state <> 'revoked';
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_provider_event_id is not null then
    select webhook_events.id into eid from webhook_events where connector_id = p_connector and provider_event_id = p_provider_event_id;
    if eid is not null then return eid; end if;
  end if;
  insert into webhook_events (connector_id, workspace_id, kind, provider_event_id, payload) values (p_connector, ws, p_kind, p_provider_event_id, coalesce(p_payload, '{}')) returning webhook_events.id into eid;
  update connectors set last_ok_at = now(), state = case when state = 'pending' then 'ok' else state end where connectors.id = p_connector;
  return eid;
end $$;

-- Save a client's CRM sheet layout (the export/import wizard). Owner or staff. Columns must be [{header, field}] with no duplicate header.
create function service.save_crm_template(p_claims jsonb, p_workspace uuid, p_id uuid, p_name text, p_crm text, p_direction text, p_columns jsonb, p_value_maps jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid; tid uuid; bad int;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if jsonb_typeof(p_columns) <> 'array' then raise exception 'T-COLUMNS: columns must be a list'; end if;
  select count(*) into bad from jsonb_array_elements(p_columns) c where c ->> 'header' is null or c ->> 'field' is null;
  if bad > 0 then raise exception 'T-COLUMNS: every column needs a header and a field'; end if;
  if (select count(distinct c ->> 'header') from jsonb_array_elements(p_columns) c) <> jsonb_array_length(p_columns) then raise exception 'T-COLUMNS: two columns have the same header'; end if;
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

revoke all on all functions in schema service from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_staff(), private.my_role(uuid), private.is_member(uuid), private.my_team_row(uuid), private.can_see(uuid), private.collection_def(uuid, text), private.try_uuid(text) to authenticated, service_role;
grant execute on function private.can_act_on_lead(leads), private.is_owner_or_staff(uuid) to service_role;
grant execute on all functions in schema service to service_role;

do $$ begin
  if exists (select from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table bookings;
  end if;
end $$;
