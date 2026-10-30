-- Omnikom Platform: step 3, part 2 of the hardening leftovers (docs/blueprint/24-GAP-HUNT.md A 13.2.x, C "search_path" and
-- "default privileges"; STANDARDS.md deviation closed). Additive to migrations 1 to 7:
--  1. default privileges on the private and service schemas: a function created later in them is closed to anon, authenticated
--     and PUBLIC without a per-migration revoke (the revokes stay as the second layer);
--  2. a narrower database role for the Edge Functions: omnikom_fn can execute the service functions and nothing else (no table,
--     no private helper); a function connects as postgres and runs `set role omnikom_fn` first, so a bug in function code cannot
--     read or write a table directly (ASVS 13.2.2);
--  3. every SECURITY DEFINER function redefined with `set search_path = ''` and every table and type named with its schema
--     (the Supabase RLS guide; nothing a caller creates in pg_temp or a schema can shadow a table or a type). The bodies are the
--     ones of migrations 1 to 7, passed through supabase/tests/qualify.mjs; the mutants in run-local.mjs remove each wall from
--     both copies. Tests: tenancy.test.sql T14 (search_path = '' on every definer function) and T17.
--  4. the three reads capture-lead made on tables directly (the site's signing secrets from Vault, the alert recipients, "was
--     this lead alerted") become service functions, so the function needs no table grant at all.

-- ---------- 1. default privileges: a new function is closed to PUBLIC wherever postgres creates it ----------
-- Postgres gives EXECUTE to PUBLIC on every new function; a per-schema "alter default privileges in schema x revoke" cannot take
-- that away ("you cannot revoke privileges per-schema if they are granted globally", ALTER DEFAULT PRIVILEGES docs; found by T17
-- 2026-10-30: the per-schema form left a probe function executable by anon). The global form does. anon and authenticated only
-- ever get EXECUTE through a grant, so this closes private and service (and public, as migration 5 did for the vendor's function).
alter default privileges revoke execute on functions from public;

-- ---------- 2. the function role: service functions only ----------
do $$ begin
  if not exists (select from pg_roles where rolname = 'omnikom_fn') then create role omnikom_fn nologin; end if;   -- roles are cluster-wide
end $$;
grant omnikom_fn to postgres;                      -- the functions connect as postgres and step down with `set role omnikom_fn`
grant usage on schema service to omnikom_fn;
grant execute on all functions in schema service to omnikom_fn;
alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;

-- ---------- 4. what capture-lead read from tables directly ----------
-- The site's live signing secrets, read out of Vault by the registry's name (plpgsql: the body is not parsed at creation, so the
-- migration applies on a plain Postgres without a vault schema; the call is proven on staging by `omnikom verify --only lead`).
create function service.site_signing_secrets(p_site uuid) returns table (id uuid, secret text) language plpgsql stable security definer set search_path = '' as $$
begin
  return query execute 'select k.id, s.decrypted_secret from service.active_key($1, $2) k join vault.decrypted_secrets s on s.name = k.vault_ref'
    using 'site-signing'::public.api_key_kind, p_site;
end $$;
-- Who gets the new-lead alert for a site, and the business name for the subject line.
create function service.alert_recipients(p_site uuid) returns table (workspace_id uuid, lead_alert_to text[], name text) language sql stable security definer set search_path = '' as $$
  select s.workspace_id, s.lead_alert_to, w.name from public.sites s join public.workspaces w on w.id = s.workspace_id where s.id = p_site $$;
-- Was this lead already alerted (a retry of the same submission alerts nobody again)?
create function service.lead_alerted(p_lead uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.messages m where m.lead_id = p_lead and m.template = 'new-lead') $$;

-- ---------- 3. every SECURITY DEFINER function, schema-qualified, search_path = '' (generated from migrations 1 to 7) ----------
-- private.is_staff
create or replace function private.is_staff() returns boolean language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from public.staff where user_id = (select auth.uid())) and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' $$;

-- private.my_role
create or replace function private.my_role(ws uuid) returns public.member_role language sql stable security definer set search_path = '' as
  $$ select role from public.members where workspace_id = ws and user_id = (select auth.uid()) $$;

-- private.is_member
create or replace function private.is_member(ws uuid) returns boolean language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from public.members where workspace_id = ws and user_id = (select auth.uid())) $$;

-- private.my_team_row
create or replace function private.my_team_row(ws uuid) returns uuid language sql stable security definer set search_path = '' as
  $$ select team_row_id from public.members where workspace_id = ws and user_id = (select auth.uid()) $$;

-- private.collection_def
create or replace function private.collection_def(ws uuid, coll text) returns jsonb language sql stable security definer set search_path = '' as
  $$ select resolved -> 'collections' -> coll from public.site_contracts where workspace_id = ws and active and private.can_see(ws) $$;

-- private.save_version
create or replace function private.save_version(p_workspace uuid, p_collection text, p_row uuid, p_data jsonb, p_sign_off jsonb default null)
returns table (row_id uuid, version int) language plpgsql security definer set search_path = '' as $$
declare
  def jsonb := private.collection_def(p_workspace, p_collection);
  r public.content_rows;
  prev jsonb;
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
    select data into prev from public.content_versions where public.content_versions.row_id = r.id order by n desc limit 1;
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

-- service.contract_for
create or replace function service.contract_for(p_claims jsonb, p_workspace uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform service.use_claims(p_claims);
  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  return (select resolved from public.site_contracts where workspace_id = p_workspace and active);
end $$;

-- service.save_as
create or replace function service.save_as(p_claims jsonb, p_workspace uuid, p_collection text, p_row uuid, p_data jsonb, p_sign_off jsonb default null)
returns table (row_id uuid, version int) language plpgsql security definer set search_path = '' as $$
begin
  perform service.use_claims(p_claims);
  return query select * from private.save_version(p_workspace, p_collection, p_row, p_data, p_sign_off);
end $$;

-- service.seed_version
create or replace function service.seed_version(p_workspace uuid, p_collection text, p_data jsonb, p_actor uuid, p_ref text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare def jsonb; rid uuid; owner_field text;
begin
  if not exists (select 1 from public.staff where user_id = p_actor) then raise exception 'S-SEED-ACTOR: seeding actor must be Omnikom staff'; end if;
  if coalesce(p_ref, '') = '' then raise exception 'S-SEED-REF: seeding needs a reference (the plan''s sitemap sha256)'; end if;
  select resolved -> 'collections' -> p_collection into def from public.site_contracts where workspace_id = p_workspace and active;
  if def is null then raise exception 'S-COLLECTION: no collection % in the active contract', p_collection; end if;
  if def ->> 'kind' = 'singleton' and exists (select 1 from public.content_rows where workspace_id = p_workspace and collection = p_collection and deleted_at is null)
    then raise exception 'S-SINGLETON: % has one row; edit it', p_collection; end if;
  owner_field := def ->> 'ownerField';
  insert into public.content_rows (workspace_id, collection, owner_team_row)
    values (p_workspace, p_collection, case when owner_field is not null and owner_field <> 'self' then nullif(p_data ->> owner_field, '')::uuid end)
    returning id into rid;
  insert into public.content_versions (row_id, n, workspace_id, data, by, sign_off) values (rid, 1, p_workspace, p_data, p_actor, jsonb_build_object('by', p_actor, 'ref', p_ref));
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, p_actor, 'seed', p_collection || ':' || rid, jsonb_build_object('ref', p_ref));
  return rid;
end $$;

-- service.start_publish
create or replace function service.start_publish(p_claims jsonb, p_site uuid, p_rows uuid[], p_versions int[]) returns uuid language plpgsql security definer set search_path = '' as $$
declare ws uuid; wst public.workspace_state; me uuid; req jsonb; job uuid; bad int; r record; def jsonb; role public.member_role; staff boolean;
begin
  me := service.use_claims(p_claims);
  select s.workspace_id, w.state into ws, wst from public.sites s join public.workspaces w on w.id = s.workspace_id where s.id = p_site;
  if ws is null then raise exception 'S-NOT-FOUND: unknown site'; end if;
  staff := private.is_staff(); role := private.my_role(ws);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if coalesce(array_length(p_rows, 1), 0) = 0 then raise exception 'S-NOT-FOUND: no rows'; end if;
  if wst not in ('trial', 'active') then raise exception 'S-WORKSPACE-STATE: a % workspace publishes nothing', wst; end if;
  select count(*) into bad from unnest(p_rows) x(id) where not exists (select 1 from public.content_rows c where c.id = x.id and c.workspace_id = ws and c.deleted_at is null);
  if bad > 0 then raise exception 'S-NOT-FOUND: % row(s) not in this site''s workspace', bad; end if;
  for r in select c.* from public.content_rows c where c.id = any(p_rows) loop
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
  if exists (select 1 from unnest(p_rows, p_versions) x(id, n) where not exists (select 1 from public.content_versions v where v.row_id = x.id and v.n = x.n))
    then raise exception 'S-NOT-FOUND: a pinned version does not exist'; end if;
  select jsonb_object_agg(x.id, x.n) into req from unnest(p_rows, p_versions) x(id, n);
  insert into public.publish_jobs (workspace_id, site_id, requested_by, rows, requested) values (ws, p_site, me, p_rows, req) returning id into job;
  insert into public.publish_job_events (job_id, state) values (job, 'queued');
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (ws, me, 'publish-start', job::text, jsonb_build_object('rows', p_rows));
  return job;
end $$;

-- service.set_job_state
create or replace function service.set_job_state(p_job uuid, p_state public.job_state, p_report jsonb default null, p_deploy text default null, p_error text default null) returns void language plpgsql security definer set search_path = '' as $$
declare j public.publish_jobs; ok boolean;
begin
  select * into j from public.publish_jobs where id = p_job for update;
  if not found then raise exception 'S-NOT-FOUND: no job'; end if;
  ok := (j.state, p_state) in (('queued','building'), ('building','gating'), ('gating','deploying'), ('deploying','done'))
        or (p_state = 'failed' and j.state not in ('done', 'failed'))
        or (p_state = 'done' and j.state = 'failed' and coalesce(j.gate_report ->> 'reason', '') = 'timeout');   -- reaped, then the deploy landed: reconcile
  ok := coalesce(ok, false);   -- NULL (unknown) must never count as allowed
  if not ok then raise exception 'S-JOB-STATE: % -> % is not allowed', j.state, p_state; end if;
  if p_state = 'done' then
    if j.snapshot is null then raise exception 'S-JOB-STATE: no frozen snapshot'; end if;
    -- a version number only ever rises (a late reconcile never undoes a newer publish); a row deleted meanwhile stays off the site
    update public.content_rows c set published_version = greatest(coalesce(c.published_version, 0), (j.snapshot ->> c.id::text)::int)
      where c.id = any(j.rows) and c.deleted_at is null;
  end if;
  update public.publish_jobs set state = p_state, gate_report = coalesce(p_report, gate_report), deploy_id = coalesce(p_deploy, deploy_id), error = coalesce(p_error, error),
    finished_at = case when p_state in ('done', 'failed') then now() end where id = p_job;
  insert into public.publish_job_events (job_id, state) values (p_job, p_state);
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (j.workspace_id, j.requested_by, 'publish-' || p_state, p_job::text, p_report);
end $$;

-- service.freeze_snapshot
create or replace function service.freeze_snapshot(p_job uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.publish_jobs; snap jsonb;
begin
  select * into j from public.publish_jobs where id = p_job for update;
  if not found then raise exception 'S-NOT-FOUND: no job'; end if;
  if j.snapshot is not null then return j.snapshot; end if;          -- a rerun ships exactly the same snapshot
  -- one build per site at a time: another job of this site that is still running makes this one wait (the runner's queue retries)
  if exists (select 1 from public.publish_jobs o where o.site_id = j.site_id and o.id <> j.id and o.state in ('building', 'gating', 'deploying'))
    then raise exception 'S-JOB-BUSY: another build of this site is running'; end if;
  select coalesce(jsonb_object_agg(c.id, c.published_version), '{}') into snap from public.content_rows c
    where c.workspace_id = j.workspace_id and c.deleted_at is null and c.published_version is not null;
  snap := snap || j.requested;
  update public.publish_jobs set snapshot = snap where id = p_job;
  perform service.set_job_state(p_job, 'building');
  return snap;
end $$;

-- service.published_rows
create or replace function service.published_rows(p_job uuid) returns table (id uuid, collection text, version int, data jsonb) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select snapshot from public.publish_jobs where public.publish_jobs.id = p_job) is null then raise exception 'S-JOB-STATE: snapshot not frozen'; end if;
  return query
  select c.id, c.collection, (j.snapshot ->> c.id::text)::int, v.data
  from public.publish_jobs j join public.content_rows c on c.workspace_id = j.workspace_id and j.snapshot ? c.id::text
  join public.content_versions v on v.row_id = c.id and v.n = (j.snapshot ->> c.id::text)::int
  where j.id = p_job;
end $$;

-- service.reap_stale_jobs
create or replace function service.reap_stale_jobs() returns int language plpgsql security definer set search_path = '' as $$
declare j record; n int := 0;
begin
  for j in select pj.id from public.publish_jobs pj
           where pj.state not in ('done', 'failed')
             and (select max(e.at) from public.publish_job_events e where e.job_id = pj.id)
                 < now() - case when pj.state = 'queued' then interval '24 hours' else interval '30 minutes' end loop
    perform service.set_job_state(j.id, 'failed', '{"reason":"timeout"}');
    n := n + 1;
  end loop;
  return n;
end $$;

-- service.unpublish
create or replace function service.unpublish(p_claims jsonb, p_row uuid, p_delete boolean default false) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; c public.content_rows;
begin
  me := service.use_claims(p_claims);
  select * into c from public.content_rows where id = p_row;
  if not found or not private.is_owner_or_staff(c.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  update public.content_rows set published_version = null, deleted_at = case when p_delete then now() else deleted_at end where id = p_row;
  insert into public.audit_log (workspace_id, actor, action, target) values (c.workspace_id, me, case when p_delete then 'delete' else 'unpublish' end, p_row::text);
end $$;

-- service.capture_lead
create or replace function service.capture_lead(p_site uuid, p_form text, p_page text, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text,
  p_flow text default null, p_cta text default null, p_marketing jsonb default null, p_idempotency uuid default null, p_assignee text default null,
  p_ip_hash text default null, p_user_agent text default null, p_sms_consent boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare ws uuid; st public.site_state; wst public.workspace_state; lid uuid; who uuid; cap int;
begin
  select s.workspace_id, s.state, w.state into ws, st, wst from public.sites s join public.workspaces w on w.id = s.workspace_id where s.id = p_site;
  if ws is null then raise exception 'unknown site'; end if;
  if st = 'paused' then raise exception 'S-SITE-PAUSED: this site is paused'; end if;
  if wst in ('suspended', 'deleted') then raise exception 'S-WORKSPACE-SUSPENDED: this workspace is suspended'; end if;
  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;
  if p_idempotency is not null then
    select public.leads.id into lid from public.leads where site_id = p_site and idempotency_key = p_idempotency;
    if lid is not null then return lid; end if;    -- a retry of the same submission stores nothing and answers the same id
  end if;
  cap := private.limit_for(ws, 'leads_per_hour_workspace');
  if cap is not null and (select count(*) from public.leads l where l.workspace_id = ws and l.created_at > now() - interval '1 hour') >= cap then
    raise exception 'S-QUOTA: this workspace reached its hourly lead limit'; end if;
  if p_assignee is not null then
    -- the team row of THIS workspace whose latest version has that slug; another workspace's slug never matches
    select c.id into who from public.content_rows c
      join public.content_versions v on v.row_id = c.id and v.n = (select max(n) from public.content_versions x where x.row_id = c.id)
      where c.workspace_id = ws and c.collection = 'team' and c.deleted_at is null and v.data ->> 'slug' = p_assignee limit 1;
  end if;
  -- two concurrent retries: the unique index decides, the loser reads the winner's row
  insert into public.leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text, flow, cta, marketing_consent, idempotency_key, source_ip_hash, user_agent, owner_team_row, sms_consent)
    values (ws, p_site, p_form, p_page, p_name, p_email, p_phone, coalesce(p_answers, '{}'), p_consent, p_flow, p_cta, p_marketing, p_idempotency, p_ip_hash, p_user_agent, who, coalesce(p_sms_consent, false))
    on conflict (site_id, idempotency_key) where idempotency_key is not null do nothing
    returning public.leads.id into lid;
  if lid is null then select public.leads.id into lid from public.leads where site_id = p_site and idempotency_key = p_idempotency; return lid; end if;
  insert into public.lead_events (lead_id, workspace_id, kind, detail) values (lid, ws, 'received', jsonb_build_object('form', p_form, 'page', p_page, 'flow', p_flow));
  perform private.record_consent(ws, p_site, lid, p_form, p_page, p_consent, p_sms_consent, p_marketing, p_ip_hash, p_user_agent, null);
  return lid;
end $$;

-- service.lead_update
create or replace function service.lead_update(p_claims jsonb, p_lead uuid, p_status public.lead_status default null, p_owner uuid default null, p_note text default null, p_unassign boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads; role public.member_role; staff boolean; mine uuid;
begin
  me := service.use_claims(p_claims);
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  staff := private.is_staff(); role := private.my_role(l.workspace_id); mine := private.my_team_row(l.workspace_id);
  if not coalesce(staff or role = 'owner' or (role = 'member' and l.owner_team_row = mine), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_status is not null and p_status is distinct from l.status then
    update public.leads set status = p_status where id = p_lead;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'status', me, jsonb_build_object('from', l.status, 'to', p_status));
  end if;
  if p_owner is not null and p_owner is distinct from l.owner_team_row then
    if not staff and role = 'member' then raise exception 'S-OWN-ONLY: members cannot hand a lead to someone else'; end if;
    if not exists (select 1 from public.content_rows c where c.id = p_owner and c.workspace_id = l.workspace_id and c.collection = 'team' and c.deleted_at is null)
      then raise exception 'S-NOT-FOUND: no such team member'; end if;
    update public.leads set owner_team_row = p_owner where id = p_lead;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'assigned', me, jsonb_build_object('from', l.owner_team_row, 'to', p_owner));
  end if;
  if p_unassign and l.owner_team_row is not null then
    if not staff and role = 'member' then raise exception 'S-OWN-ONLY: members cannot hand a lead to someone else'; end if;
    update public.leads set owner_team_row = null where id = p_lead;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'assigned', me, jsonb_build_object('from', l.owner_team_row, 'to', null));
  end if;
  if coalesce(p_note, '') <> '' then
    if length(p_note) > 2000 then raise exception 'S-NOTE: a note is at most 2000 characters'; end if;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'note', me, jsonb_build_object('text', p_note));
  end if;
  insert into public.audit_log (workspace_id, actor, action, target) values (l.workspace_id, me, 'lead-update', p_lead::text);
end $$;

-- service.add_lead
create or replace function service.add_lead(p_claims jsonb, p_site uuid, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text,
  p_form text default 'manual', p_owner uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid; ws uuid; role public.member_role; staff boolean; who uuid; lid uuid;
begin
  me := service.use_claims(p_claims);
  select workspace_id into ws from public.sites where public.sites.id = p_site;
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  staff := private.is_staff(); role := private.my_role(ws);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;
  who := case when role = 'member' and not staff then private.my_team_row(ws) else p_owner end;
  if who is not null and not exists (select 1 from public.content_rows c where c.id = who and c.workspace_id = ws and c.collection = 'team' and c.deleted_at is null)
    then raise exception 'S-NOT-FOUND: no such team member'; end if;
  insert into public.leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text, owner_team_row)
    values (ws, p_site, coalesce(p_form, 'manual'), 'dashboard', p_name, p_email, p_phone, coalesce(p_answers, '{}'), p_consent, who) returning public.leads.id into lid;
  insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (lid, ws, 'received', me, jsonb_build_object('manual', true, 'form', coalesce(p_form, 'manual')));
  insert into public.audit_log (workspace_id, actor, action, target) values (ws, me, 'lead-add', lid::text);
  perform private.record_consent(ws, p_site, lid, coalesce(p_form, 'manual'), 'dashboard', p_consent, false, null, null, null, me);
  return lid;
end $$;

-- service.lead_event
create or replace function service.lead_event(p_lead uuid, p_kind public.lead_event_kind, p_detail jsonb default '{}') returns void language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  select workspace_id into ws from public.leads where public.leads.id = p_lead;
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into public.lead_events (lead_id, workspace_id, kind, detail) values (p_lead, ws, p_kind, coalesce(p_detail, '{}'));
end $$;

-- service.active_key
create or replace function service.active_key(p_kind public.api_key_kind, p_site uuid default null, p_workspace uuid default null)
returns table (id uuid, key_hash text, vault_ref text) language sql stable security definer set search_path = '' as $$
  select k.id, k.key_hash, k.vault_ref from public.api_keys k
  where k.kind = p_kind
    and case when p_site is null then k.site_id is null and k.workspace_id is not distinct from p_workspace
             else k.site_id = p_site and (p_workspace is null or k.workspace_id = p_workspace) end
    and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
  order by k.created_at desc $$;

-- service.touch_key
create or replace function service.touch_key(p_id uuid) returns void language sql security definer set search_path = '' as $$
  update public.api_keys set last_used_at = now() where id = p_id and (last_used_at is null or last_used_at < now() - interval '1 minute') $$;

-- private.can_act_on_lead
create or replace function private.can_act_on_lead(l public.leads) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff() or private.my_role(l.workspace_id) = 'owner'
      or (private.my_role(l.workspace_id) = 'member' and l.owner_team_row = private.my_team_row(l.workspace_id)), false) $$;

-- private.is_owner_or_staff
create or replace function private.is_owner_or_staff(ws uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff() or private.my_role(ws) = 'owner', false) $$;

-- service.activate_addon
create or replace function service.activate_addon(p_claims jsonb, p_workspace uuid, p_kind public.addon_kind, p_settings jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into public.add_ons (workspace_id, kind, state, settings, activated_by) values (p_workspace, p_kind, 'paying', coalesce(p_settings, '{}'), me)
    on conflict (workspace_id, kind) do update set state = 'paying', settings = excluded.settings, activated_by = me, activated_at = now(), cancelled_at = null, paid_until = null
    where public.add_ons.state = 'cancelled';
  if not found then raise exception 'S-ADDON: % is already activated', p_kind; end if;
  insert into public.audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'addon-activate', p_kind::text);
end $$;

-- service.set_addon_state
create or replace function service.set_addon_state(p_claims jsonb, p_workspace uuid, p_kind public.addon_kind, p_state public.addon_state, p_paid_until date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid; a public.add_ons; ok boolean; system boolean := p_claims is null;   -- null claims = the payment webhook (service role), never a login
begin
  if not system then
    me := service.use_claims(p_claims);
    if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
    -- an owner may only cancel; setting-up, active, paused and paid_until come from public.staff or the payment webhook
    if not private.is_staff() and p_state <> 'cancelled' then raise exception 'S-ROLE: only Omnikom or a payment can change this'; end if;
  end if;
  select * into a from public.add_ons where workspace_id = p_workspace and kind = p_kind for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (a.state, p_state) in (('paying', 'setting-up'), ('setting-up', 'active'), ('active', 'paused'), ('paused', 'active'))
        or (p_state = 'cancelled' and a.state <> 'cancelled');
  ok := coalesce(ok, false);
  if not ok then raise exception 'S-ADDON-STATE: % -> % is not allowed', a.state, p_state; end if;
  update public.add_ons set state = p_state, paid_until = coalesce(p_paid_until, paid_until), cancelled_at = case when p_state = 'cancelled' then now() end
    where workspace_id = p_workspace and kind = p_kind;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'addon-' || p_state, p_kind::text, jsonb_build_object('from', a.state, 'system', system));
end $$;

-- service.book
create or replace function service.book(p_claims jsonb, p_lead uuid, p_with uuid, p_starts timestamptz, p_ends timestamptz, p_where text, p_source public.booking_source default 'manual')
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads; bid uuid; role public.member_role;
begin
  if p_claims is null and p_source <> 'concierge' then raise exception 'S-AUTH: a login is needed for a % booking', p_source; end if;
  me := case when p_claims is null then null else service.use_claims(p_claims) end;   -- the concierge books without a login (service caller)
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  if me is not null and not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;
  role := case when me is null then null else private.my_role(l.workspace_id) end;
  if role = 'member' and not private.is_staff() and p_with is distinct from private.my_team_row(l.workspace_id) then
    raise exception 'S-OWN-ONLY: members book meetings for themselves'; end if;
  if not exists (select 1 from public.content_rows c where c.id = p_with and c.workspace_id = l.workspace_id and c.collection = 'team' and c.deleted_at is null)
    then raise exception 'S-NOT-FOUND: no such team member'; end if;
  if p_ends is null or p_starts is null or p_ends <= p_starts then raise exception 'B-TIME: the meeting must end after it starts'; end if;
  perform pg_advisory_xact_lock(hashtext(p_with::text));
  if exists (select 1 from public.bookings b where b.with_team_row = p_with and b.state in ('proposed', 'confirmed') and b.starts_at < p_ends and b.ends_at > p_starts)
    then raise exception 'B-OVERLAP: that team member already has a meeting then'; end if;
  insert into public.bookings (workspace_id, lead_id, with_team_row, starts_at, ends_at, where_text, source, state, created_by)
    values (l.workspace_id, p_lead, p_with, p_starts, p_ends, p_where, p_source, (case when p_source = 'concierge' then 'proposed' else 'confirmed' end)::public.booking_state, me)
    returning id into bid;
  insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'booked', me, jsonb_build_object('booking', bid, 'starts', p_starts, 'with', p_with, 'source', p_source));
  insert into public.audit_log (workspace_id, actor, action, target) values (l.workspace_id, me, 'book', bid::text);
  return bid;
end $$;

-- service.set_booking_state
create or replace function service.set_booking_state(p_claims jsonb, p_booking uuid, p_state public.booking_state) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid; b public.bookings; l public.leads; ok boolean;
begin
  if p_claims is null then raise exception 'S-AUTH: a login is needed'; end if;
  me := service.use_claims(p_claims);
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  select * into l from public.leads where id = b.lead_id;
  -- the lead's people, or the team member the meeting is with
  if not coalesce(private.can_act_on_lead(l) or (private.my_role(b.workspace_id) = 'member' and b.with_team_row = private.my_team_row(b.workspace_id)), false)
    then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (b.state, p_state) in (('proposed', 'confirmed'), ('proposed', 'cancelled'), ('confirmed', 'held'), ('confirmed', 'no-show'), ('confirmed', 'cancelled'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'B-STATE: % -> % is not allowed', b.state, p_state; end if;
  update public.bookings set state = p_state, updated_at = now() where id = p_booking;
  insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (b.lead_id, b.workspace_id, 'booking-changed', me, jsonb_build_object('booking', p_booking, 'from', b.state, 'to', p_state));
end $$;

-- service.record_message
create or replace function service.record_message(p_workspace uuid, p_lead uuid, p_user uuid, p_channel public.message_channel, p_template text, p_to text, p_about_booking uuid default null, p_now timestamptz default now(), p_idem_key text default null)
returns table (id uuid, state public.message_state, reason text) language plpgsql security definer set search_path = '' as $$
declare l public.leads; cap int; cap_ws int; sent_today int; sent_ws int; tz text; h int; st public.message_state := 'queued'; why text; mid uuid; ex record; wst public.workspace_state;
begin
  if p_idem_key is not null then
    select m.id, m.state, m.error into ex from public.messages m where m.workspace_id = p_workspace and m.idem_key = p_idem_key;
    if ex.id is not null then return query select ex.id, ex.state, ex.error; return; end if;   -- a retry records nothing twice
  end if;
  if p_lead is not null then
    select * into l from public.leads where public.leads.id = p_lead;
    if not found or l.workspace_id <> p_workspace then raise exception 'S-NOT-FOUND: not found'; end if;
    if p_channel = 'sms' and not l.sms_consent then raise exception 'M-CONSENT: this person did not agree to text messages'; end if;
    if p_channel = 'sms' and l.sms_stopped_at is not null then raise exception 'M-STOP: this person asked for no more texts'; end if;
  elsif p_channel = 'sms' and p_user is null then
    raise exception 'M-CONSENT: an SMS needs a lead with consent or a team member';
  end if;
  if private.is_suppressed(p_workspace, p_channel::text::public.suppression_channel, p_to) then raise exception 'M-SUPPRESSED: this address asked for no more messages'; end if;
  select value into cap from public.platform_limits where key = p_channel::text || '_per_day';
  cap_ws := private.limit_for(p_workspace, p_channel::text || '_per_day_workspace');
  select count(*), count(*) filter (where m.workspace_id = p_workspace) into sent_today, sent_ws from public.messages m
    where m.channel = p_channel and m.state <> 'blocked' and m.created_at >= date_trunc('day', p_now) and m.created_at < date_trunc('day', p_now) + interval '1 day';
  if cap_ws is not null and sent_ws >= cap_ws then st := 'blocked'; why := 'daily cap (workspace)'; end if;
  if cap is not null and sent_today >= cap then st := 'blocked'; why := 'daily cap'; end if;
  select w.state into wst from public.workspaces w where w.id = p_workspace;
  if wst in ('suspended', 'deleted') then st := 'blocked'; why := 'workspace suspended'; end if;
  if p_channel = 'sms' and st = 'queued' then
    select timezone into tz from public.workspaces where public.workspaces.id = p_workspace;
    h := extract(hour from (p_now at time zone tz));
    if h >= (select value from public.platform_limits where key = 'quiet_hours_start') or h < (select value from public.platform_limits where key = 'quiet_hours_end') then
      st := 'blocked'; why := 'quiet hours'; end if;
  end if;
  insert into public.messages (workspace_id, lead_id, user_id, channel, template, to_text, about_booking, state, error, created_at, idem_key)
    values (p_workspace, p_lead, p_user, p_channel, p_template, p_to, p_about_booking, st, why, p_now, p_idem_key) returning public.messages.id into mid;
  return query select mid, st, why;
end $$;

-- service.set_message_state
create or replace function service.set_message_state(p_message uuid, p_state public.message_state, p_provider_id text default null, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages; ok boolean;
begin
  select * into m from public.messages where id = p_message for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  if m.state = p_state then return; end if;                           -- a repeated provider callback changes nothing and writes no second event
  ok := (m.state, p_state) in (('queued', 'sent'), ('sent', 'delivered'), ('queued', 'failed'), ('sent', 'failed'), ('blocked', 'queued'), ('queued', 'blocked'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'M-STATE: % -> % is not allowed', m.state, p_state; end if;
  update public.messages set state = p_state, provider_id = coalesce(p_provider_id, provider_id), error = coalesce(p_error, error), sent_at = case when p_state = 'sent' then now() else sent_at end where id = p_message;
  if m.lead_id is not null and p_state in ('sent', 'failed') then
    insert into public.lead_events (lead_id, workspace_id, kind, detail) values (m.lead_id, m.workspace_id, case when p_state = 'sent' then 'message-sent' else 'message-failed' end::public.lead_event_kind,
      jsonb_build_object('message', p_message, 'channel', m.channel, 'template', m.template, 'error', p_error));
  end if;
end $$;

-- service.webhook_received
create or replace function service.webhook_received(p_connector uuid, p_kind text, p_provider_event_id text, p_payload jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare ws uuid; eid bigint;
begin
  select workspace_id into ws from public.connectors where public.connectors.id = p_connector and state <> 'revoked';
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_provider_event_id is not null then
    select public.webhook_events.id into eid from public.webhook_events where connector_id = p_connector and provider_event_id = p_provider_event_id;
    if eid is not null then return eid; end if;
  end if;
  insert into public.webhook_events (connector_id, workspace_id, kind, provider_event_id, payload) values (p_connector, ws, p_kind, p_provider_event_id, coalesce(p_payload, '{}')) returning public.webhook_events.id into eid;
  update public.connectors set last_ok_at = now(), state = case when state = 'pending' then 'ok' else state end where public.connectors.id = p_connector;
  return eid;
end $$;

-- service.save_crm_template
create or replace function service.save_crm_template(p_claims jsonb, p_workspace uuid, p_id uuid, p_name text, p_crm text, p_direction text, p_columns jsonb, p_value_maps jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
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
    insert into public.crm_templates (workspace_id, name, crm, direction, columns, value_maps, created_by) values (p_workspace, p_name, p_crm, p_direction, p_columns, coalesce(p_value_maps, '{}'), me) returning id into tid;
  else
    update public.crm_templates set name = p_name, crm = p_crm, direction = p_direction, columns = p_columns, value_maps = coalesce(p_value_maps, '{}'), updated_at = now()
      where id = p_id and workspace_id = p_workspace returning id into tid;
    if tid is null then raise exception 'S-NOT-FOUND: not found'; end if;
  end if;
  insert into public.audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'crm-template', tid::text);
  return tid;
end $$;

-- service.set_member
create or replace function service.set_member(p_claims jsonb, p_workspace uuid, p_user uuid, p_role public.member_role, p_team_row uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_team_row is not null and not exists (select 1 from public.content_rows c where c.id = p_team_row and c.workspace_id = p_workspace and c.collection = 'team' and c.deleted_at is null)
    then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_role = 'member' and p_user = me and private.my_role(p_workspace) = 'owner' and not private.is_staff()
     and (select count(*) from public.members m where m.workspace_id = p_workspace and m.role = 'owner') = 1
    then raise exception 'S-LAST-OWNER: a workspace keeps at least one owner'; end if;
  insert into public.members (workspace_id, user_id, role, team_row_id) values (p_workspace, p_user, p_role, p_team_row)
    on conflict (workspace_id, user_id) do update set role = excluded.role, team_row_id = excluded.team_row_id;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'member-set', p_user::text, jsonb_build_object('role', p_role, 'team_row', p_team_row));
end $$;

-- service.remove_member
create or replace function service.remove_member(p_claims jsonb, p_workspace uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid; r public.member_role;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  select role into r from public.members m where m.workspace_id = p_workspace and m.user_id = p_user;
  if r is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if r = 'owner' and (select count(*) from public.members m where m.workspace_id = p_workspace and m.role = 'owner') = 1
    then raise exception 'S-LAST-OWNER: a workspace keeps at least one owner'; end if;
  delete from public.members m where m.workspace_id = p_workspace and m.user_id = p_user;
  insert into public.audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'member-remove', p_user::text);
end $$;

-- service.lead_sms_stop
create or replace function service.lead_sms_stop(p_lead uuid, p_detail jsonb default '{}') returns void language plpgsql security definer set search_path = '' as $$
declare ws uuid; ph text;
begin
  select workspace_id, phone into ws, ph from public.leads where public.leads.id = p_lead;
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  update public.leads set sms_stopped_at = coalesce(sms_stopped_at, now()) where id = p_lead;
  insert into public.lead_events (lead_id, workspace_id, kind, detail) values (p_lead, ws, 'sms-stop', coalesce(p_detail, '{}'));
  if private.address_hash('sms', ph) is not null then perform service.suppress(ws, 'sms', ph, 'stop', 'sms reply', p_lead); end if;
end $$;

-- service.delete_lead
create or replace function service.delete_lead(p_claims jsonb, p_lead uuid, p_reason text default null) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads;
begin
  me := service.use_claims(p_claims);
  select * into l from public.leads where id = p_lead;
  if not found or not private.is_owner_or_staff(l.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-delete', p_lead::text, jsonb_build_object('reason', p_reason, 'email_hash', encode(sha256(convert_to(coalesce(l.email, ''), 'utf8')), 'hex')));
  delete from public.leads where id = p_lead;
end $$;

-- service.record_security_event
create or replace function service.record_security_event(p_kind text, p_code text default null, p_workspace uuid default null, p_site uuid default null,
  p_actor uuid default null, p_ip_hash text default null, p_detail jsonb default '{}') returns bigint language plpgsql security definer set search_path = '' as $$
declare eid bigint;
begin
  insert into public.security_events (kind, code, workspace_id, site_id, actor, ip_hash, detail)
    values (p_kind, left(p_code, 60), p_workspace, p_site, p_actor, left(p_ip_hash, 64), coalesce(p_detail, '{}')) returning id into eid;
  return eid;
end $$;

-- private.record_consent
create or replace function private.record_consent(p_ws uuid, p_site uuid, p_lead uuid, p_form text, p_page text, p_consent text, p_sms boolean, p_marketing jsonb, p_ip_hash text, p_ua text, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.consent_ledger (workspace_id, site_id, lead_id, form, page_path, consent_text, consent_hash, sms_consent, marketing, ip_hash, user_agent, by)
    values (p_ws, p_site, p_lead, p_form, p_page, p_consent, encode(sha256(convert_to(p_consent, 'utf8')), 'hex'), coalesce(p_sms, false), p_marketing, p_ip_hash, p_ua, p_by);
end $$;

-- private.is_suppressed
create or replace function private.is_suppressed(p_workspace uuid, p_channel public.suppression_channel, p_address text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(exists (select 1 from public.suppressions s where s.channel = p_channel and s.address_hash = private.address_hash(p_channel, p_address)
    and (s.workspace_id is null or s.workspace_id = p_workspace)), false) $$;

-- service.suppress
create or replace function service.suppress(p_workspace uuid, p_channel public.suppression_channel, p_address text, p_reason text, p_source text default null, p_lead uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare h text := private.address_hash(p_channel, p_address);
begin
  if h is null then raise exception 'M-ADDRESS: an address is needed'; end if;
  insert into public.suppressions (workspace_id, channel, address_hash, reason, source, lead_id) values (p_workspace, p_channel, h, p_reason, p_source, p_lead)
    on conflict (workspace_id, channel, address_hash) do nothing;
end $$;

-- service.set_workspace_state
create or replace function service.set_workspace_state(p_claims jsonb, p_workspace uuid, p_state public.workspace_state, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid; w public.workspaces; ok boolean;
begin
  me := service.use_claims(p_claims);
  if not private.is_staff() then raise exception 'S-NOT-FOUND: not found'; end if;
  select * into w from public.workspaces where id = p_workspace for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (w.state, p_state) in (('trial', 'active'), ('trial', 'suspended'), ('active', 'suspended'), ('suspended', 'active'), ('active', 'offboarding'), ('suspended', 'offboarding'), ('offboarding', 'deleted'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'S-WORKSPACE-STATE: % -> % is not allowed', w.state, p_state; end if;
  update public.workspaces set state = p_state, state_changed_at = now(), state_reason = p_reason where id = p_workspace;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'workspace-' || p_state, p_workspace::text, jsonb_build_object('from', w.state, 'reason', p_reason));
end $$;

-- private.limit_for
create or replace function private.limit_for(p_workspace uuid, p_key text) returns int language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.workspace_limits where workspace_id = p_workspace and key = p_key), (select value from public.platform_limits where key = p_key)) $$;

-- service.open_privacy_request
create or replace function service.open_privacy_request(p_claims jsonb, p_workspace uuid, p_kind public.privacy_request_kind, p_subject text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid; rid uuid; h text; ids uuid[];
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if coalesce(btrim(p_subject), '') = '' then raise exception 'P-SUBJECT: the request needs the person''s email or number'; end if;
  h := encode(sha256(convert_to(lower(btrim(p_subject)), 'utf8')), 'hex');
  select coalesce(array_agg(l.id), '{}') into ids from public.leads l where l.workspace_id = p_workspace
    and (lower(btrim(coalesce(l.email, ''))) = lower(btrim(p_subject)) or regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') = regexp_replace(p_subject, '[^0-9]', '', 'g') and regexp_replace(p_subject, '[^0-9]', '', 'g') <> '');
  insert into public.privacy_requests (workspace_id, kind, subject, subject_hash, due_at, opened_by, notes, lead_ids)
    values (p_workspace, p_kind, btrim(p_subject), h, now() + interval '45 days', me, p_notes, ids) returning id into rid;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'privacy-request-open', rid::text, jsonb_build_object('kind', p_kind, 'leads', coalesce(array_length(ids, 1), 0)));
  return rid;
end $$;

-- service.set_privacy_request_state
create or replace function service.set_privacy_request_state(p_claims jsonb, p_request uuid, p_state public.privacy_request_state, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; r public.privacy_requests; ok boolean;
begin
  me := service.use_claims(p_claims);
  select * into r from public.privacy_requests where id = p_request for update;
  if not found or not private.is_owner_or_staff(r.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (r.state, p_state) in (('received', 'verifying'), ('received', 'in-progress'), ('received', 'refused'), ('verifying', 'in-progress'), ('verifying', 'refused'), ('in-progress', 'done'), ('in-progress', 'refused'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'P-STATE: % -> % is not allowed', r.state, p_state; end if;
  update public.privacy_requests set state = p_state, handled_by = me, notes = coalesce(p_notes, notes), done_at = case when p_state in ('done', 'refused') then now() end where id = p_request;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (r.workspace_id, me, 'privacy-request-' || p_state, p_request::text, jsonb_build_object('from', r.state));
end $$;

-- ---------- grants: the service and private schemas closed again; the function role and service_role may execute service.* ----------
revoke all on all functions in schema service from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_staff(), private.my_role(uuid), private.is_member(uuid), private.my_team_row(uuid), private.can_see(uuid), private.collection_def(uuid, text), private.try_uuid(text) to authenticated, service_role;
grant execute on function private.can_act_on_lead(leads), private.is_owner_or_staff(uuid), private.has_secret_like(jsonb), private.limit_for(uuid, text), private.is_suppressed(uuid, suppression_channel, text), private.address_hash(suppression_channel, text) to service_role;
grant execute on all functions in schema service to service_role, omnikom_fn;
