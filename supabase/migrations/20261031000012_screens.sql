-- Omnikom Platform: step 5, slice 5.1 (brief factory/briefs/5-1-screens-database.md). Additive to migrations 1 to 11.
-- The database for the four screens (docs/blueprint/15-CRM.md sections 3 to 5 and 7; 16-DESIGN-PARTS.md 3.1 and 3.2). The dashboard is a thin
-- client over this: every rule lives here, behind RLS and service.* functions. Most of what the screens need already exists (leads, lead_events
-- with Realtime, lead_update, add_lead, save_as, start_publish, set_member, remove_member with S-LAST-OWNER, sites.lead_alert_to, integrations).
-- This migration adds what was missing and nothing else:
--  1. S-STALE: service.save_as (and private.save_version under it) takes p_base, the version the editor started from; a save on top of a
--     newer version is refused. A new row with a base other than null or 0 is refused too. Null keeps today's behaviour (the CLI and
--     sites/test-demo-a/stage.mjs call save_as without it). Adding a parameter = drop and re-create (an overload would leave the old
--     function callable).
--  2. Unread leads: public.lead_reads, one row per login and lead, RLS "own rows", written only by service.mark_lead_read.
--  3. service.leads_exported: the CSV export leaves one 'exported' event per lead the caller can read.
--  4. Lead alerts: sites.alert_assignee ("also email the assigned agent") and service.set_alerts (owner or staff).
--  5. The CRM connection: service.set_crm_webhook (owner or staff): an https address that is not private, and the NAME of the signing secret
--     (the value is in Vault and never reaches a table, 16-DESIGN-PARTS 3.1 item 10). The address rules are private.crm_url_problem.
--  6. service.drafts_waiting ("Publish 3 changes"). Two plain RLS reads cannot answer it for an agent: rows_read is workspace-wide, so an agent
--     can read a page the owner edited, while start_publish refuses them that page. The count on their button must hold only what they can publish.
-- Every definer function: security definer, set search_path = '', fully schema-qualified, starts with service.use_claims, refuses with
-- 'S-NOT-FOUND: not found' when the caller may not see the thing, writes audit_log for owner actions (T14 checks the shape).
-- Tests: tenancy.test.sql T20, written before this file. Mutants: run-local.mjs, names starting "screens:".

-- ---------- 1. S-STALE ----------
drop function service.save_as(jsonb, uuid, text, uuid, jsonb, jsonb);
drop function private.save_version(uuid, text, uuid, jsonb, jsonb);

-- The body of migration 8's private.save_version, plus: the newest version is read with the row (under the row's advisory lock), and the
-- stale check sits after the access checks (a person who may not save the row learns nothing about its versions) and before the locked-field
-- check (a stale editor's old copy of a locked field must not turn into a confusing S-LOCKED).
create function private.save_version(p_workspace uuid, p_collection text, p_row uuid, p_data jsonb, p_sign_off jsonb default null, p_base int default null)
returns table (row_id uuid, version int) language plpgsql security definer set search_path = '' as $$
declare
  def jsonb := private.collection_def(p_workspace, p_collection);
  r public.content_rows;
  prev jsonb;
  newest int;
  role public.member_role := private.my_role(p_workspace);
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
    select * into r from public.content_rows where id = p_row and workspace_id = p_workspace and collection = p_collection and deleted_at is null;
    if not found then raise exception 'S-NOT-FOUND: not found'; end if;
    select n, data into newest, prev from public.content_versions where public.content_versions.row_id = r.id order by n desc limit 1;
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
  if p_base is not null then
    if p_row is null then
      if p_base <> 0 then raise exception 'S-STALE: a new item has no earlier version (started from %)', p_base; end if;
    elsif newest > p_base then
      raise exception 'S-STALE: % was saved at version % by someone else', r.id, newest;
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
    and exists (select 1 from public.content_rows where workspace_id = p_workspace and collection = p_collection and deleted_at is null)
    then raise exception 'S-SINGLETON: % has one row; edit it', p_collection; end if;
  if p_row is null then
    insert into public.content_rows (workspace_id, collection, owner_team_row) values (p_workspace, p_collection, owner_val) returning * into r;
  elsif owner_field is not null and owner_field <> 'self' then
    update public.content_rows set owner_team_row = owner_val where id = r.id;
  end if;
  select coalesce(max(n), 0) + 1 into next_n from public.content_versions where public.content_versions.row_id = r.id;
  insert into public.content_versions (row_id, n, workspace_id, data, by, sign_off) values (r.id, next_n, p_workspace, p_data, me, case when changed is not null then p_sign_off end);
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'save', p_collection || ':' || r.id, jsonb_build_object('version', next_n, 'locked_change', changed));
  return query select r.id, next_n;
end $$;

create function service.save_as(p_claims jsonb, p_workspace uuid, p_collection text, p_row uuid, p_data jsonb, p_sign_off jsonb default null, p_base int default null)
returns table (row_id uuid, version int) language plpgsql security definer set search_path = '' as $$
begin
  perform service.use_claims(p_claims);
  return query select * from private.save_version(p_workspace, p_collection, p_row, p_data, p_sign_off, p_base);
end $$;

-- ---------- 2. unread leads ----------
create table public.lead_reads (
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (lead_id, user_id)
);
create index lead_reads_user on public.lead_reads (user_id);
alter table public.lead_reads enable row level security;
-- a login reads its own marks and nobody else's; staff included (the unread count is a personal thing)
create policy lead_reads_own on public.lead_reads for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.lead_reads from anon;
revoke insert, update, delete, truncate, references, trigger on public.lead_reads from authenticated;
grant select on public.lead_reads to authenticated;
grant all on public.lead_reads to service_role;

create function service.mark_lead_read(p_claims jsonb, p_lead uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads;
begin
  me := service.use_claims(p_claims);
  select * into l from public.leads where public.leads.id = p_lead;
  -- the same rule as the leads_read policy: staff, the owner, or the agent the lead is assigned to
  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into public.lead_reads (lead_id, user_id) values (p_lead, me)
    on conflict (lead_id, user_id) do update set read_at = now();
end $$;

do $$ begin
  if exists (select from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.lead_reads;   -- the unread mark follows a login across its open tabs
  end if;
end $$;

-- ---------- 3. the CSV export event ----------
create function service.leads_exported(p_claims jsonb, p_site uuid, p_lead_ids uuid[]) returns int language plpgsql security definer set search_path = '' as $$
declare me uuid; ws uuid; l public.leads; lid uuid; recorded int := 0; skipped int := 0;
begin
  me := service.use_claims(p_claims);
  select s.workspace_id into ws from public.sites s where s.id = p_site;
  if ws is null or not coalesce(private.is_staff() or private.is_member(ws), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  -- a lead of another site or workspace, or one the caller cannot read, is skipped and counted (the audit row says how many)
  for lid in select distinct x from unnest(coalesce(p_lead_ids, '{}'::uuid[])) x loop
    select * into l from public.leads where public.leads.id = lid and public.leads.site_id = p_site;
    if not found or not private.can_act_on_lead(l) then skipped := skipped + 1; continue; end if;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (l.id, l.workspace_id, 'exported', me, jsonb_build_object('by', me));
    recorded := recorded + 1;
  end loop;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (ws, me, 'leads-export', p_site::text, jsonb_build_object('recorded', recorded, 'skipped', skipped));
  return recorded;
end $$;

-- ---------- 4. lead alerts ----------
alter table public.sites add column alert_assignee boolean not null default true;   -- "also email the assigned agent"

create function service.set_alerts(p_claims jsonb, p_site uuid, p_to text[], p_assignee boolean) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; ws uuid; a text; v text; clean text[] := '{}';
begin
  me := service.use_claims(p_claims);
  select s.workspace_id into ws from public.sites s where s.id = p_site;
  if ws is null or not private.is_owner_or_staff(ws) then raise exception 'S-NOT-FOUND: not found'; end if;
  if cardinality(coalesce(p_to, '{}'::text[])) > 100 then raise exception 'I-EMAIL: at most 10 addresses'; end if;   -- bounds the work; the real limit is below
  foreach a in array coalesce(p_to, '{}'::text[]) loop
    v := lower(btrim(coalesce(a, '')));
    if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v) > 254 then raise exception 'I-EMAIL: %', coalesce(left(a, 100), '(empty)'); end if;
    if not (v = any(clean)) then clean := clean || v; end if;
  end loop;
  if cardinality(clean) > 10 then raise exception 'I-EMAIL: at most 10 addresses'; end if;
  update public.sites set lead_alert_to = clean, alert_assignee = coalesce(p_assignee, alert_assignee) where public.sites.id = p_site;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (ws, me, 'alerts-set', p_site::text, jsonb_build_object('count', cardinality(clean), 'assignee', coalesce(p_assignee, (select s.alert_assignee from public.sites s where s.id = p_site))));
end $$;

-- ---------- 5. the CRM connection ----------
-- Why an address is refused (null = fine). The function that sends the test and the real pushes (slice 5.2) must also check the address a name
-- RESOLVES to before it connects: a public name can point at a private address, and SQL cannot see that.
create function private.crm_url_problem(p_url text) returns text language plpgsql immutable set search_path = '' as $$
declare auth text; m text[]; host text; port int; o int[];
begin
  if p_url is null or p_url = '' then return 'an address is needed'; end if;
  if length(p_url) > 2000 then return 'the address is at most 2000 characters'; end if;
  if p_url ~ '[[:space:][:cntrl:]\\]' then return 'the address has a space, a control character or a backslash'; end if;
  if lower(left(p_url, 8)) <> 'https://' then return 'the address must start with https://'; end if;
  auth := split_part(split_part(split_part(substr(p_url, 9), '/', 1), '?', 1), '#', 1);
  if position('@' in auth) > 0 then return 'the address must not hold a user name or password'; end if;
  if left(auth, 1) = '[' then return 'use a host name, not an IPv6 address'; end if;
  m := regexp_match(auth, '^([^:]+)(?::([0-9]{1,5}))?$');
  if m is null then return 'the host or the port is not valid'; end if;
  host := rtrim(lower(m[1]), '.');
  if m[2] is not null then
    port := m[2]::int;
    if port < 1 or port > 65535 then return 'the port is not valid'; end if;
  end if;
  if host = 'localhost' or host like '%.localhost' or host like '%.local' or host like '%.internal' then return 'the address must be public, not localhost or a private name'; end if;
  if host ~ '^[0-9.]+$' then
    if host !~ '^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$' then return 'write an address as four plain numbers, or use a host name'; end if;
    o := string_to_array(host, '.')::int[];
    if o[1] > 255 or o[2] > 255 or o[3] > 255 or o[4] > 255 then return 'write an address as four plain numbers, or use a host name'; end if;
    if o[1] in (0, 10, 127) or o[1] >= 224
       or (o[1] = 100 and o[2] between 64 and 127) or (o[1] = 169 and o[2] = 254) or (o[1] = 172 and o[2] between 16 and 31)
       or (o[1] = 192 and o[2] = 168) or (o[1] = 192 and o[2] = 0 and o[3] = 0) or (o[1] = 198 and o[2] in (18, 19))
      then return 'the address must be public, not a private, loopback or link-local number'; end if;
    return null;
  end if;
  if host ~ '(^|\.)0x' or host ~ '\.[0-9]+$' then return 'write an address as four plain numbers, or use a host name'; end if;
  if position('.' in host) = 0 then return 'the host name needs a dot'; end if;
  if length(host) > 253 or host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' then return 'the host name is not valid'; end if;
  return null;
end $$;

create function service.set_crm_webhook(p_claims jsonb, p_workspace uuid, p_url text, p_secret_ref text) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; why text;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_url is null then
    delete from public.integrations i where i.workspace_id = p_workspace and i.kind = 'crm-webhook';
    if found then
      insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'crm-set', p_workspace::text, jsonb_build_object('removed', true));
    end if;
    return;
  end if;
  why := private.crm_url_problem(p_url);
  if why is not null then raise exception 'I-URL: %', why; end if;
  if p_secret_ref is not null and p_secret_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' then raise exception 'I-SECRET-REF: a name of the secret, not the secret itself'; end if;
  insert into public.integrations (workspace_id, kind, config, secret_ref) values (p_workspace, 'crm-webhook', jsonb_build_object('url', p_url), p_secret_ref)
    on conflict (workspace_id, kind) do update set config = excluded.config, secret_ref = coalesce(excluded.secret_ref, public.integrations.secret_ref);
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'crm-set', p_workspace::text, jsonb_build_object('removed', false));
end $$;

-- ---------- 6. drafts waiting ----------
-- The live rows of the site's workspace whose newest version is past the published one (a row never published counts as published at 0),
-- as far as the caller may publish them: owner and staff all, an agent only what start_publish would let them publish. Inbox rows are never
-- published, so they are never waiting.
create function service.drafts_waiting(p_claims jsonb, p_site uuid)
returns table (row_id uuid, collection text, newest_version int, published_version int, edited_by uuid, edited_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare me uuid; ws uuid; role public.member_role; staff boolean; mine uuid; contract jsonb;
begin
  me := service.use_claims(p_claims);
  select s.workspace_id into ws from public.sites s where s.id = p_site;
  staff := private.is_staff(); role := private.my_role(ws); mine := private.my_team_row(ws);
  if ws is null or not coalesce(staff or role is not null, false) then raise exception 'S-NOT-FOUND: not found'; end if;
  select sc.resolved into contract from public.site_contracts sc where sc.workspace_id = ws and sc.active;
  return query
  select c.id, c.collection, v.n, c.published_version, v.by, v.at
  from public.content_rows c
  join lateral (select x.n, x.by, x.at from public.content_versions x where x.row_id = c.id order by x.n desc limit 1) v on true
  where c.workspace_id = ws and c.deleted_at is null
    and v.n > coalesce(c.published_version, 0)
    and coalesce(contract -> 'collections' -> c.collection ->> 'kind', '') <> 'inbox'
    and (staff or role = 'owner'
         or (role = 'member' and contract -> 'collections' -> c.collection -> 'access' ->> 'member' = 'own' and mine is not null
             and ((contract -> 'collections' -> c.collection ->> 'ownerField' = 'self' and c.id = mine)
               or (contract -> 'collections' -> c.collection ->> 'ownerField' <> 'self' and c.owner_team_row = mine))))
  order by v.at desc, c.id;
end $$;

-- ---------- grants: closed to PUBLIC, anon and authenticated (the default privileges of migration 8 do it; these statements are the second layer) ----------
revoke all on function service.save_as(jsonb, uuid, text, uuid, jsonb, jsonb, int) from public, anon, authenticated;
grant execute on function service.save_as(jsonb, uuid, text, uuid, jsonb, jsonb, int) to service_role, omnikom_fn;
revoke all on function private.save_version(uuid, text, uuid, jsonb, jsonb, int) from public, anon, authenticated;
revoke all on function service.mark_lead_read(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.mark_lead_read(jsonb, uuid) to service_role, omnikom_fn;
revoke all on function service.leads_exported(jsonb, uuid, uuid[]) from public, anon, authenticated;
grant execute on function service.leads_exported(jsonb, uuid, uuid[]) to service_role, omnikom_fn;
revoke all on function service.set_alerts(jsonb, uuid, text[], boolean) from public, anon, authenticated;
grant execute on function service.set_alerts(jsonb, uuid, text[], boolean) to service_role, omnikom_fn;
revoke all on function private.crm_url_problem(text) from public, anon, authenticated;
revoke all on function service.set_crm_webhook(jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function service.set_crm_webhook(jsonb, uuid, text, text) to service_role, omnikom_fn;
revoke all on function service.drafts_waiting(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.drafts_waiting(jsonb, uuid) to service_role, omnikom_fn;
