-- Omnikom Platform: step 3 of the build sequence, the database hardening leftovers (docs/blueprint/24-GAP-HUNT.md E2 item 1;
-- the ground rules in docs/blueprint/23-GROUND-RULES.md). Additive to migrations 1 to 6. Every wall here has a test in
-- supabase/tests/tenancy.test.sql (T16, watched red first) and a mutant in supabase/tests/run-local.mjs. Functions that already
-- existed are redefined with their bodies kept line for line where the rule did not change, so the existing mutants hit both copies.
-- Contents: security events (ASVS 16.3), the consent ledger and suppressions outside the delete cascade (TCPA, CCPA record
-- keeping), privacy requests (CCPA rights), the workspace lifecycle (the per-tenant kill switch), per-workspace quotas, and an
-- append-only audit trail for every role (ASVS 16.4). The function role, search_path = '' and the default privileges on the
-- private schemas are migration 8 (20261030000008_search_path_and_roles.sql).

-- ---------- append-only: a trigger refuses every update, delete and truncate, whatever the role (the owner included) ----------
create function private.refuse_change() returns trigger language plpgsql as $$
begin
  raise exception 'A-APPEND-ONLY: % is append-only', tg_table_name;
end $$;

-- The audit trail outlives the tenant: no cascade from workspaces (a deleted workspace keeps its history; the uuid stays as data).
alter table audit_log drop constraint audit_log_workspace_id_fkey;
revoke update, delete, truncate on audit_log from service_role;
create trigger audit_log_append_only before update or delete on audit_log for each row execute function private.refuse_change();
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function private.refuse_change();

-- ---------- security events: every refused call, failed signature, quota hit and refused login, written by the functions ----------
create table security_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('bad-signature', 'refused', 'quota', 'rate-limited', 'auth-refused', 'bad-request', 'suspended')),
  code text check (length(code) <= 60),                    -- the platform code when there is one (S-NOT-FOUND, S-QUOTA, SIGNATURE)
  workspace_id uuid,                                        -- no foreign key: the record outlives the tenant
  site_id uuid,
  actor uuid,                                               -- the login when there was one
  ip_hash text check (length(ip_hash) <= 64),               -- a hash with the site id, never the address (capture-lead)
  detail jsonb not null default '{}',
  constraint security_event_detail_bounded check (pg_column_size(detail) <= 4096)
);
create index security_events_ws on security_events (workspace_id, at desc);
create index security_events_site on security_events (site_id, at desc) where site_id is not null;
alter table security_events enable row level security;
create policy security_events_staff_read on security_events for select to authenticated using (private.is_staff());
revoke all on security_events from anon;
revoke insert, update, delete, truncate, references, trigger on security_events from authenticated;
grant select on security_events to authenticated;
grant select, insert on security_events to service_role;
revoke update, delete, truncate on security_events from service_role;   -- Supabase gives service_role ALL on a new table by default
create trigger security_events_append_only before update or delete on security_events for each row execute function private.refuse_change();
create trigger security_events_no_truncate before truncate on security_events for each statement execute function private.refuse_change();

-- A refusal rolls its own transaction back, so the caller (the Edge Function) records the event in a call of its own.
create function service.record_security_event(p_kind text, p_code text default null, p_workspace uuid default null, p_site uuid default null,
  p_actor uuid default null, p_ip_hash text default null, p_detail jsonb default '{}') returns bigint language plpgsql security definer set search_path = public as $$
declare eid bigint;
begin
  insert into security_events (kind, code, workspace_id, site_id, actor, ip_hash, detail)
    values (p_kind, left(p_code, 60), p_workspace, p_site, p_actor, left(p_ip_hash, 64), coalesce(p_detail, '{}')) returning id into eid;
  return eid;
end $$;

-- ---------- consent ledger: the proof of consent, kept apart from the lead (a deleted lead keeps its consent record) ----------
create table consent_ledger (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  workspace_id uuid not null,                               -- no foreign keys: the ledger outlives the lead and the tenant
  site_id uuid,
  lead_id uuid,
  form text not null,
  page_path text not null,
  consent_text text not null,
  consent_hash text not null check (consent_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the wording: two leads with the same text share it
  sms_consent boolean not null default false,
  marketing jsonb,
  ip_hash text,
  user_agent text,
  by uuid                                                   -- the login that entered a manual lead; empty for a site form
);
create index consent_ledger_ws on consent_ledger (workspace_id, at desc);
create index consent_ledger_lead on consent_ledger (lead_id) where lead_id is not null;
alter table consent_ledger enable row level security;
create policy consent_ledger_read on consent_ledger for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');
revoke all on consent_ledger from anon;
revoke insert, update, delete, truncate, references, trigger on consent_ledger from authenticated;
grant select on consent_ledger to authenticated;
grant select, insert on consent_ledger to service_role;
revoke update, delete, truncate on consent_ledger from service_role;
create trigger consent_ledger_append_only before update or delete on consent_ledger for each row execute function private.refuse_change();
create trigger consent_ledger_no_truncate before truncate on consent_ledger for each statement execute function private.refuse_change();

create function private.record_consent(p_ws uuid, p_site uuid, p_lead uuid, p_form text, p_page text, p_consent text, p_sms boolean, p_marketing jsonb, p_ip_hash text, p_ua text, p_by uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into consent_ledger (workspace_id, site_id, lead_id, form, page_path, consent_text, consent_hash, sms_consent, marketing, ip_hash, user_agent, by)
    values (p_ws, p_site, p_lead, p_form, p_page, p_consent, encode(sha256(convert_to(p_consent, 'utf8')), 'hex'), coalesce(p_sms, false), p_marketing, p_ip_hash, p_ua, p_by);
end $$;

-- ---------- suppressions: STOP, complaints, bounces and do-not-call entries by hashed address, outside the delete cascade ----------
create type suppression_channel as enum ('sms', 'email', 'call');
create table suppressions (
  id bigint generated always as identity primary key,
  workspace_id uuid,                                        -- empty = the whole platform (a registry scrub, a complaint to us)
  channel suppression_channel not null,
  address_hash text not null check (address_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('stop', 'complaint', 'request', 'dnc', 'bounce')),
  source text check (length(source) <= 120),                -- 'sms reply', 'dashboard', 'import', the webhook kind
  lead_id uuid,                                             -- the lead it came from, if any (no foreign key: it may be deleted later)
  at timestamptz not null default now(),
  constraint suppressions_once unique nulls not distinct (workspace_id, channel, address_hash)
);
create index suppressions_ws on suppressions (workspace_id, channel);
create index suppressions_lookup on suppressions (channel, address_hash);
alter table suppressions enable row level security;
create policy suppressions_read on suppressions for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');
revoke all on suppressions from anon;
revoke insert, update, delete, truncate, references, trigger on suppressions from authenticated;
grant select on suppressions to authenticated;
grant all on suppressions to service_role;

-- One way to hash an address: digits only for a number (a US country code 1 in front of ten digits is dropped), lower-case trimmed
-- for an email, so the same person is found however the address was typed.
create function private.address_hash(p_channel suppression_channel, p_address text) returns text language sql immutable as $$
  select case when p_address is null or btrim(p_address) = '' then null
    else encode(sha256(convert_to(case when p_channel = 'email' then lower(btrim(p_address)) else regexp_replace(regexp_replace(p_address, '[^0-9]', '', 'g'), '^1(?=[0-9]{10}$)', '') end, 'utf8')), 'hex') end $$;

create function private.is_suppressed(p_workspace uuid, p_channel suppression_channel, p_address text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists (select 1 from suppressions s where s.channel = p_channel and s.address_hash = private.address_hash(p_channel, p_address)
    and (s.workspace_id is null or s.workspace_id = p_workspace)), false) $$;

-- Add a suppression (a complaint, a request, a bounce, a do-not-call entry); the same address twice changes nothing.
create function service.suppress(p_workspace uuid, p_channel suppression_channel, p_address text, p_reason text, p_source text default null, p_lead uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare h text := private.address_hash(p_channel, p_address);
begin
  if h is null then raise exception 'M-ADDRESS: an address is needed'; end if;
  insert into suppressions (workspace_id, channel, address_hash, reason, source, lead_id) values (p_workspace, p_channel, h, p_reason, p_source, p_lead)
    on conflict (workspace_id, channel, address_hash) do nothing;
end $$;

-- A STOP reply: as before (the flag on the lead and the timeline line), plus the suppression that survives the lead's deletion.
create or replace function service.lead_sms_stop(p_lead uuid, p_detail jsonb default '{}') returns void language plpgsql security definer set search_path = public as $$
declare ws uuid; ph text;
begin
  select workspace_id, phone into ws, ph from leads where leads.id = p_lead;
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  update leads set sms_stopped_at = coalesce(sms_stopped_at, now()) where id = p_lead;
  insert into lead_events (lead_id, workspace_id, kind, detail) values (p_lead, ws, 'sms-stop', coalesce(p_detail, '{}'));
  if private.address_hash('sms', ph) is not null then perform service.suppress(ws, 'sms', ph, 'stop', 'sms reply', p_lead); end if;
end $$;

-- ---------- workspace lifecycle: the per-tenant switch (24-GAP-HUNT B: onboarding, suspension, offboarding) ----------
create type workspace_state as enum ('trial', 'active', 'suspended', 'offboarding', 'deleted');
alter table workspaces add column state workspace_state not null default 'active', add column state_changed_at timestamptz, add column state_reason text check (length(state_reason) <= 300);

-- Staff only: a workspace's state is Omnikom's call. Legal moves: trial -> active; active <-> suspended; trial -> suspended;
-- active or suspended -> offboarding; offboarding -> deleted (the offboarding job's last step); nothing leaves deleted.
create function service.set_workspace_state(p_claims jsonb, p_workspace uuid, p_state workspace_state, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid; w workspaces; ok boolean;
begin
  me := service.use_claims(p_claims);
  if not private.is_staff() then raise exception 'S-NOT-FOUND: not found'; end if;
  select * into w from workspaces where id = p_workspace for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (w.state, p_state) in (('trial', 'active'), ('trial', 'suspended'), ('active', 'suspended'), ('suspended', 'active'), ('active', 'offboarding'), ('suspended', 'offboarding'), ('offboarding', 'deleted'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'S-WORKSPACE-STATE: % -> % is not allowed', w.state, p_state; end if;
  update workspaces set state = p_state, state_changed_at = now(), state_reason = p_reason where id = p_workspace;
  insert into audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'workspace-' || p_state, p_workspace::text, jsonb_build_object('from', w.state, 'reason', p_reason));
end $$;

-- ---------- per-workspace quotas: a value here overrides the platform-wide one in platform_limits ----------
create table workspace_limits (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key text not null check (length(key) <= 60),
  value int not null,
  note text,
  primary key (workspace_id, key)
);
alter table workspace_limits enable row level security;
create policy workspace_limits_staff_read on workspace_limits for select to authenticated using (private.is_staff());
revoke all on workspace_limits from anon;
revoke insert, update, delete, truncate, references, trigger on workspace_limits from authenticated;
grant select on workspace_limits to authenticated;
grant all on workspace_limits to service_role;
insert into platform_limits (key, value, note) values ('leads_per_hour_workspace', 60, 'one site''s bot flood never spends the shared alert and push budget (24-GAP-HUNT B); staff raise it per workspace in workspace_limits');

create function private.limit_for(p_workspace uuid, p_key text) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select value from workspace_limits where workspace_id = p_workspace and key = p_key), (select value from platform_limits where key = p_key)) $$;

-- ---------- capture_lead: the consent ledger row, the suspended switch and the lead quota; every earlier line kept verbatim ----------
create or replace function service.capture_lead(p_site uuid, p_form text, p_page text, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text,
  p_flow text default null, p_cta text default null, p_marketing jsonb default null, p_idempotency uuid default null, p_assignee text default null,
  p_ip_hash text default null, p_user_agent text default null, p_sms_consent boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; st site_state; wst workspace_state; lid uuid; who uuid; cap int;
begin
  select s.workspace_id, s.state, w.state into ws, st, wst from sites s join workspaces w on w.id = s.workspace_id where s.id = p_site;
  if ws is null then raise exception 'unknown site'; end if;
  if st = 'paused' then raise exception 'S-SITE-PAUSED: this site is paused'; end if;
  if wst in ('suspended', 'deleted') then raise exception 'S-WORKSPACE-SUSPENDED: this workspace is suspended'; end if;
  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;
  if p_idempotency is not null then
    select leads.id into lid from leads where site_id = p_site and idempotency_key = p_idempotency;
    if lid is not null then return lid; end if;    -- a retry of the same submission stores nothing and answers the same id
  end if;
  cap := private.limit_for(ws, 'leads_per_hour_workspace');
  if cap is not null and (select count(*) from leads l where l.workspace_id = ws and l.created_at > now() - interval '1 hour') >= cap then
    raise exception 'S-QUOTA: this workspace reached its hourly lead limit'; end if;
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
  perform private.record_consent(ws, p_site, lid, p_form, p_page, p_consent, p_sms_consent, p_marketing, p_ip_hash, p_user_agent, null);
  return lid;
end $$;

-- add_lead: the consent ledger row for a lead entered by hand; every earlier line kept verbatim
create or replace function service.add_lead(p_claims jsonb, p_site uuid, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text,
  p_form text default 'manual', p_owner uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid; ws uuid; role member_role; staff boolean; who uuid; lid uuid;
begin
  me := service.use_claims(p_claims);
  select workspace_id into ws from sites where sites.id = p_site;
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  staff := private.is_staff(); role := private.my_role(ws);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;
  who := case when role = 'member' and not staff then private.my_team_row(ws) else p_owner end;
  if who is not null and not exists (select 1 from content_rows c where c.id = who and c.workspace_id = ws and c.collection = 'team' and c.deleted_at is null)
    then raise exception 'S-NOT-FOUND: no such team member'; end if;
  insert into leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text, owner_team_row)
    values (ws, p_site, coalesce(p_form, 'manual'), 'dashboard', p_name, p_email, p_phone, coalesce(p_answers, '{}'), p_consent, who) returning leads.id into lid;
  insert into lead_events (lead_id, workspace_id, kind, by, detail) values (lid, ws, 'received', me, jsonb_build_object('manual', true, 'form', coalesce(p_form, 'manual')));
  insert into audit_log (workspace_id, actor, action, target) values (ws, me, 'lead-add', lid::text);
  perform private.record_consent(ws, p_site, lid, coalesce(p_form, 'manual'), 'dashboard', p_consent, false, null, null, null, me);
  return lid;
end $$;

-- start_publish: a suspended, offboarding or deleted workspace publishes nothing; every earlier line kept verbatim
create or replace function service.start_publish(p_claims jsonb, p_site uuid, p_rows uuid[], p_versions int[]) returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; wst workspace_state; me uuid; req jsonb; job uuid; bad int; r record; def jsonb; role member_role; staff boolean;
begin
  me := service.use_claims(p_claims);
  select s.workspace_id, w.state into ws, wst from sites s join workspaces w on w.id = s.workspace_id where s.id = p_site;
  if ws is null then raise exception 'S-NOT-FOUND: unknown site'; end if;
  staff := private.is_staff(); role := private.my_role(ws);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if coalesce(array_length(p_rows, 1), 0) = 0 then raise exception 'S-NOT-FOUND: no rows'; end if;
  if wst not in ('trial', 'active') then raise exception 'S-WORKSPACE-STATE: a % workspace publishes nothing', wst; end if;
  select count(*) into bad from unnest(p_rows) x(id) where not exists (select 1 from content_rows c where c.id = x.id and c.workspace_id = ws and c.deleted_at is null);
  if bad > 0 then raise exception 'S-NOT-FOUND: % row(s) not in this site''s workspace', bad; end if;
  for r in select c.* from content_rows c where c.id = any(p_rows) loop
    def := private.collection_def(ws, r.collection);
    if def ->> 'kind' = 'inbox' then raise exception 'S-KIND: inbox rows are not published'; end if;
    if not staff and role = 'member' then
      if coalesce(def -> 'access' ->> 'member', 'none') = 'none' then raise exception 'S-ROLE: members cannot publish %', r.collection; end if;
      if def -> 'access' ->> 'member' = 'own' and not (
           (def ->> 'ownerField' = 'self' and r.id = private.my_team_row(ws))
        or (def ->> 'ownerField' <> 'self' and r.owner_team_row = private.my_team_row(ws))) then
        raise exception 'S-OWN-ONLY: members publish only their own items';
      end if;
    end if;
  end loop;
  -- the versions the publish function validated, one per row (dry run 2, N4): never "whatever is latest now"
  if coalesce(array_length(p_versions, 1), 0) <> array_length(p_rows, 1) then raise exception 'S-NOT-FOUND: one validated version per row'; end if;
  if exists (select 1 from unnest(p_rows, p_versions) x(id, n) where not exists (select 1 from content_versions v where v.row_id = x.id and v.n = x.n))
    then raise exception 'S-NOT-FOUND: a pinned version does not exist'; end if;
  select jsonb_object_agg(x.id, x.n) into req from unnest(p_rows, p_versions) x(id, n);
  insert into publish_jobs (workspace_id, site_id, requested_by, rows, requested) values (ws, p_site, me, p_rows, req) returning id into job;
  insert into publish_job_events (job_id, state) values (job, 'queued');
  insert into audit_log (workspace_id, actor, action, target, detail) values (ws, me, 'publish-start', job::text, jsonb_build_object('rows', p_rows));
  return job;
end $$;

-- record_message: a suppressed address is refused (M-SUPPRESSED); a suspended workspace sends nothing (blocked, the queue
-- retries when it is active again); the per-workspace cap can be overridden per workspace; every earlier line kept verbatim
create or replace function service.record_message(p_workspace uuid, p_lead uuid, p_user uuid, p_channel message_channel, p_template text, p_to text, p_about_booking uuid default null, p_now timestamptz default now(), p_idem_key text default null)
returns table (id uuid, state message_state, reason text) language plpgsql security definer set search_path = public as $$
declare l leads; cap int; cap_ws int; sent_today int; sent_ws int; tz text; h int; st message_state := 'queued'; why text; mid uuid; ex record; wst workspace_state;
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
  if private.is_suppressed(p_workspace, p_channel::text::suppression_channel, p_to) then raise exception 'M-SUPPRESSED: this address asked for no more messages'; end if;
  select value into cap from platform_limits where key = p_channel::text || '_per_day';
  cap_ws := private.limit_for(p_workspace, p_channel::text || '_per_day_workspace');
  select count(*), count(*) filter (where m.workspace_id = p_workspace) into sent_today, sent_ws from messages m
    where m.channel = p_channel and m.state <> 'blocked' and m.created_at >= date_trunc('day', p_now) and m.created_at < date_trunc('day', p_now) + interval '1 day';
  if cap_ws is not null and sent_ws >= cap_ws then st := 'blocked'; why := 'daily cap (workspace)'; end if;
  if cap is not null and sent_today >= cap then st := 'blocked'; why := 'daily cap'; end if;
  select w.state into wst from workspaces w where w.id = p_workspace;
  if wst in ('suspended', 'deleted') then st := 'blocked'; why := 'workspace suspended'; end if;
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

-- ---------- privacy requests: a person's request to know, delete, correct or opt out (CCPA), with its deadline clock ----------
create type privacy_request_kind as enum ('access', 'delete', 'correct', 'opt-out');
create type privacy_request_state as enum ('received', 'verifying', 'in-progress', 'done', 'refused');
create table privacy_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind privacy_request_kind not null,
  subject text not null check (length(subject) <= 320),            -- the contact the person gave (an email or a number), needed to answer them
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  state privacy_request_state not null default 'received',
  received_at timestamptz not null default now(),
  due_at timestamptz not null,                                       -- 45 days (CCPA 1798.130(a)(2)); staff may extend once by 45 more
  done_at timestamptz,
  opened_by uuid references auth.users(id),
  handled_by uuid references auth.users(id),
  notes text check (length(notes) <= 4000),
  lead_ids uuid[] not null default '{}'
);
create index privacy_requests_ws on privacy_requests (workspace_id, received_at desc);
create index privacy_requests_open on privacy_requests (due_at) where state not in ('done', 'refused');
alter table privacy_requests enable row level security;
create policy privacy_requests_read on privacy_requests for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');
revoke all on privacy_requests from anon;
revoke insert, update, delete, truncate, references, trigger on privacy_requests from authenticated;
grant select on privacy_requests to authenticated;
grant all on privacy_requests to service_role;

-- Owner or staff opens a request for the workspace; the lead rows matching the subject are listed on it (by email or by number).
create function service.open_privacy_request(p_claims jsonb, p_workspace uuid, p_kind privacy_request_kind, p_subject text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid; rid uuid; h text; ids uuid[];
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if coalesce(btrim(p_subject), '') = '' then raise exception 'P-SUBJECT: the request needs the person''s email or number'; end if;
  h := encode(sha256(convert_to(lower(btrim(p_subject)), 'utf8')), 'hex');
  select coalesce(array_agg(l.id), '{}') into ids from leads l where l.workspace_id = p_workspace
    and (lower(btrim(coalesce(l.email, ''))) = lower(btrim(p_subject)) or regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') = regexp_replace(p_subject, '[^0-9]', '', 'g') and regexp_replace(p_subject, '[^0-9]', '', 'g') <> '');
  insert into privacy_requests (workspace_id, kind, subject, subject_hash, due_at, opened_by, notes, lead_ids)
    values (p_workspace, p_kind, btrim(p_subject), h, now() + interval '45 days', me, p_notes, ids) returning id into rid;
  insert into audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'privacy-request-open', rid::text, jsonb_build_object('kind', p_kind, 'leads', coalesce(array_length(ids, 1), 0)));
  return rid;
end $$;

-- Legal moves only: received -> verifying | in-progress | refused; verifying -> in-progress | refused; in-progress -> done | refused.
create function service.set_privacy_request_state(p_claims jsonb, p_request uuid, p_state privacy_request_state, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid; r privacy_requests; ok boolean;
begin
  me := service.use_claims(p_claims);
  select * into r from privacy_requests where id = p_request for update;
  if not found or not private.is_owner_or_staff(r.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (r.state, p_state) in (('received', 'verifying'), ('received', 'in-progress'), ('received', 'refused'), ('verifying', 'in-progress'), ('verifying', 'refused'), ('in-progress', 'done'), ('in-progress', 'refused'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'P-STATE: % -> % is not allowed', r.state, p_state; end if;
  update privacy_requests set state = p_state, handled_by = me, notes = coalesce(p_notes, notes), done_at = case when p_state in ('done', 'refused') then now() end where id = p_request;
  insert into audit_log (workspace_id, actor, action, target, detail) values (r.workspace_id, me, 'privacy-request-' || p_state, p_request::text, jsonb_build_object('from', r.state));
end $$;

-- ---------- grants for everything new; the service and private schemas closed again ----------
revoke all on all functions in schema service from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_staff(), private.my_role(uuid), private.is_member(uuid), private.my_team_row(uuid), private.can_see(uuid), private.collection_def(uuid, text), private.try_uuid(text) to authenticated, service_role;
grant execute on function private.can_act_on_lead(leads), private.is_owner_or_staff(uuid), private.has_secret_like(jsonb), private.limit_for(uuid, text), private.is_suppressed(uuid, suppression_channel, text), private.address_hash(suppression_channel, text) to service_role;
grant execute on all functions in schema service to service_role;
