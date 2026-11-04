-- Omnikom Platform: step C, the CRM (additive to 20261028000001_platform.sql). DECISIONS 21; the plain-word model is
-- docs/blueprint/13-DATA-MODEL.md, the lead path docs/blueprint/14-LEAD-PATH.md, the screens docs/blueprint/15-CRM.md.
-- Tested by supabase/tests/run-local.mjs (T12 + mutants). Nothing here has run on a real Supabase project yet (D1 open).
-- Rules kept from the first migration: RLS on every table, every policy names its role, no client write path except a
-- SECURITY DEFINER function that checks membership itself, service functions closed to anon/authenticated.

-- ---------- leads: what the first real site's form already sends (Example A wizard.js) ----------
alter table leads
  add column flow text check (flow ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(flow) <= 60),   -- the journey (home-value, cash-offer); a slug, not a closed list
  add column cta text check (length(cta) <= 120),                                            -- the button label the visitor used
  add column marketing_consent jsonb,                                                        -- { given, text }, separate from consent_text
  add column idempotency_key uuid,                                                           -- one per submission; a retry stores nothing
  add column source_ip_hash text,                                                            -- spam forensics; a hash, never the address
  add column user_agent text check (length(user_agent) <= 400);
create unique index leads_one_per_submission on leads (site_id, idempotency_key) where idempotency_key is not null;

alter table sites
  add column signing_key_ref text,                        -- NAME of the Vault secret holding this site's lead signing key (never the key)
  add column lead_alert_to text[] not null default '{}';  -- who gets the new-lead email (client question "lead-alert recipients")

-- ---------- one timeline per lead (DECISIONS 21: notes and CRM pushes fold into lead_events; no real lead exists yet) ----------
drop table lead_notes;
drop table lead_pushes;
create type lead_event_kind as enum ('received', 'alert-sent', 'alert-failed', 'pushed', 'push-failed', 'status', 'assigned', 'note', 'resent', 'exported', 'deleted');
create table lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind lead_event_kind not null,
  by uuid references auth.users(id),      -- empty for the system (received from the site, pushed by the cron)
  detail jsonb not null default '{}',     -- status: {from, to}; assigned: {from, to}; note: {text}; pushed: {target, code}
  at timestamptz not null default now()
);
create index on lead_events (lead_id, at);
alter table lead_events enable row level security;
-- a person sees a lead's timeline exactly when they see the lead: the leads policy decides (RLS applies inside the subquery)
create policy lead_events_read on lead_events for select to authenticated using (exists (select 1 from leads l where l.id = lead_id));
revoke all on lead_events from anon;
revoke insert, update, delete, truncate, references, trigger on lead_events from authenticated;
grant select on lead_events to authenticated;
grant all on lead_events to service_role;

-- status and owner change only through service.lead_update, which writes the event in the same transaction, so the timeline
-- can never disagree with the row. The direct column grant and its policy go away.
revoke update on leads from authenticated;
drop policy leads_update on leads;

create function service.lead_update(p_claims jsonb, p_lead uuid, p_status lead_status default null, p_owner uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid; l leads; role member_role; staff boolean; mine uuid;
begin
  me := service.use_claims(p_claims);
  select * into l from leads where id = p_lead for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  staff := private.is_staff(); role := private.my_role(l.workspace_id); mine := private.my_team_row(l.workspace_id);
  -- the same rule as the leads read policy: staff, the owner, or the member the lead is assigned to. A non-member has a NULL
  -- role, and NOT NULL is NULL, which PL/pgSQL reads as "do not raise": the coalesce makes unknown count as refused.
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
  if coalesce(p_note, '') <> '' then
    if length(p_note) > 2000 then raise exception 'S-NOTE: a note is at most 2000 characters'; end if;
    insert into lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'note', me, jsonb_build_object('text', p_note));
  end if;
  insert into audit_log (workspace_id, actor, action, target) values (l.workspace_id, me, 'lead-update', p_lead::text);
end $$;

-- A lead entered by hand in the dashboard (a call, a walk-in, a referral). Same row, same timeline; form 'manual' by default;
-- a member can only give it to themselves.
create function service.add_lead(p_claims jsonb, p_site uuid, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text,
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
  return lid;
end $$;

-- Public lead capture, extended: idempotency, the journey fields, the assignee by team slug (unknown slug ignored), the event.
-- The old 8-argument form keeps working (defaults), so the first migration's callers and tests are unchanged.
drop function service.capture_lead(uuid, text, text, text, text, text, jsonb, text);
create function service.capture_lead(p_site uuid, p_form text, p_page text, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text,
  p_flow text default null, p_cta text default null, p_marketing jsonb default null, p_idempotency uuid default null, p_assignee text default null,
  p_ip_hash text default null, p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; lid uuid; who uuid;
begin
  select workspace_id into ws from sites where sites.id = p_site;
  if ws is null then raise exception 'unknown site'; end if;
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
  insert into leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text, flow, cta, marketing_consent, idempotency_key, source_ip_hash, user_agent, owner_team_row)
    values (ws, p_site, p_form, p_page, p_name, p_email, p_phone, coalesce(p_answers, '{}'), p_consent, p_flow, p_cta, p_marketing, p_idempotency, p_ip_hash, p_user_agent, who)
    returning leads.id into lid;
  insert into lead_events (lead_id, workspace_id, kind, detail) values (lid, ws, 'received', jsonb_build_object('form', p_form, 'page', p_page, 'flow', p_flow));
  return lid;
end $$;

-- Every push attempt and alert is an event too (written by push-lead and capture-lead with the service role).
create function service.lead_event(p_lead uuid, p_kind lead_event_kind, p_detail jsonb default '{}') returns void language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select workspace_id into ws from leads where leads.id = p_lead;
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into lead_events (lead_id, workspace_id, kind, detail) values (p_lead, ws, p_kind, coalesce(p_detail, '{}'));
end $$;

-- ---------- api_keys: a registry of every machine credential; the VALUE is never here (a hash, or a Vault name) ----------
create type api_key_kind as enum ('site-signing', 'deploy-token', 'runner', 'cron', 'crm-webhook', 'omnisuite', 'client-api');
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,   -- empty for platform-wide keys (runner, cron)
  site_id uuid references sites(id) on delete cascade,             -- set for per-site keys (site-signing, deploy-token)
  kind api_key_kind not null,
  label text not null check (length(label) <= 120),
  key_hash text check (key_hash ~ '^[0-9a-f]{64}$'),               -- SHA-256, for kinds the platform verifies itself
  vault_ref text,                                                  -- Vault secret NAME, for kinds the platform presents to others
  scope jsonb not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint api_keys_hash_or_ref check (key_hash is not null or vault_ref is not null)
);
create index on api_keys (kind, site_id) where revoked_at is null;
alter table api_keys enable row level security;
create policy api_keys_staff_read on api_keys for select to authenticated using (private.is_staff());   -- no client role ever reads keys
revoke all on api_keys from anon;
revoke insert, update, delete, truncate, references, trigger on api_keys from authenticated;
grant select on api_keys to authenticated;
grant all on api_keys to service_role;

-- The key(s) a function may verify against or hand out: never revoked, never expired. A revoked key fails even if Vault still has it.
create function service.active_key(p_kind api_key_kind, p_site uuid default null, p_workspace uuid default null)
returns table (id uuid, key_hash text, vault_ref text) language sql stable security definer set search_path = public as $$
  select k.id, k.key_hash, k.vault_ref from api_keys k
  where k.kind = p_kind and k.site_id is not distinct from p_site and k.workspace_id is not distinct from p_workspace
    and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
  order by k.created_at desc $$;
create function service.touch_key(p_id uuid) returns void language sql security definer set search_path = public as $$
  update api_keys set last_used_at = now() where id = p_id and (last_used_at is null or last_used_at < now() - interval '1 minute') $$;

-- Service functions created here are closed to clients exactly like the first migration's.
revoke all on all functions in schema service from public, anon, authenticated;
grant execute on all functions in schema service to service_role;

do $$ begin
  if exists (select from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table lead_events;   -- the timeline updates live in the open lead
  end if;
end $$;
