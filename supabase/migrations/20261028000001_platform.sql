-- Omnikom Platform: core schema (DRAFT for step 1 of the build plan; tested locally by supabase/tests/run-local.mjs against a
-- model of Supabase's defaults, supabase/tests/local-shim.sql; the authority is the same tests on a real project, W0.3).
-- One multi-tenant database (DECISIONS 11, ADR 0001). The wall is row-level security plus explicit grants (TENANCY 2).
-- Content rows are versioned append-only (DECISIONS 6). Behaviour mirrors contracts/store.mjs.
-- Sources followed (checked 2026-10-28): Supabase RLS guide (policies "to authenticated", (select auth.uid()), security-definer
-- functions outside exposed schemas), Supabase database functions guide (EXECUTE is granted to anon/authenticated by default:
-- revoke explicitly), Supabase MFA guide (aal2 claim), Supabase Storage access control (policies on storage.objects).
-- Schemas: public (exposed through the Data API; tables only, no client-callable functions), private (helpers used by policies, and
-- the save body, which clients cannot call),
-- service (service-only functions, called by Edge Functions over a direct database connection; never exposed).

-- gen_random_uuid() is built into Postgres 13+: no extension needed (an extension in public would expose its functions).

-- Supabase grants new tables and functions in public to anon/authenticated by default. Turn that off before creating anything.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------- tenancy ----------
create type member_role as enum ('owner', 'member');
create type site_state as enum ('preview', 'live', 'paused');
create type job_state as enum ('queued', 'building', 'gating', 'deploying', 'done', 'failed');
create type lead_status as enum ('new', 'contacted', 'qualified', 'closed', 'spam');

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  industry text not null,
  created_at timestamptz not null default now()
);

create table staff (                      -- Omnikom staff: see every workspace (only with MFA, aal2); every action audited
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null,
  team_row_id uuid,                       -- the content_rows id of this person in the team collection (for "own" access)
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table sites (                      -- site registry (TENANCY 3)
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  deploy_target text unique not null,     -- Cloudflare Worker (static assets) name, one per site
  preview_host text not null,
  domain text,
  deploy_token_ref text,                  -- name of the Vault secret holding this site's per-Worker deploy token
  state site_state not null default 'preview',
  created_at timestamptz not null default now()
);

create table site_contracts (             -- the generated contract, core merged in ("resolved"), versioned
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null,
  contract jsonb not null,
  resolved jsonb not null,
  active boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (workspace_id, version)
);
create unique index one_active_contract on site_contracts (workspace_id) where active;

-- ---------- content ----------
create table content_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  collection text not null,
  owner_team_row uuid,
  published_version int,                  -- moved only when a publish job finishes "done" (service.set_job_state)
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on content_rows (workspace_id, collection);

create table content_versions (           -- append-only: no update or delete is ever granted
  row_id uuid not null references content_rows(id) on delete cascade,
  n int not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  data jsonb not null,
  by uuid not null references auth.users(id),
  at timestamptz not null default now(),
  sign_off jsonb,
  primary key (row_id, n)
);

create table media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  path text not null,
  constraint media_path_in_workspace check (path like workspace_id::text || '/%'),
  width int, height int, bytes int,
  processed boolean not null default false,   -- set by the media processor (build runner), not by an Edge Function
  exif_stripped boolean not null default false,
  rights_confirmed boolean not null default false,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------- leads ----------
create table leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  site_id uuid references sites(id),
  form text not null,
  page_path text not null,
  name text, email text, phone text,
  answers jsonb not null default '{}',
  consent_text text not null,
  status lead_status not null default 'new',
  owner_team_row uuid,
  created_at timestamptz not null default now()
);
create table lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  by uuid not null references auth.users(id),
  text text not null check (length(text) <= 2000),
  at timestamptz not null default now()
);
create table lead_pushes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  target text not null, ok boolean not null, response_code int, at timestamptz not null default now()
);

-- ---------- publish, metrics, audit ----------
create table publish_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  site_id uuid not null references sites(id),
  requested_by uuid not null references auth.users(id),
  rows uuid[] not null,                   -- the rows this publish was for (one atomic job)
  requested jsonb not null,               -- { row_id: version } requested at publish time
  snapshot jsonb,                         -- { row_id: version } frozen when the build starts; reruns ship exactly this
  state job_state not null default 'queued',
  gate_report jsonb,
  deploy_id text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table publish_job_events (        -- every state change with its time (NFR-4, W1.5)
  job_id uuid not null references publish_jobs(id) on delete cascade,
  state job_state not null,
  at timestamptz not null default now()
);
create table metrics_snapshots (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null check (source in ('search-console', 'pagespeed', 'ai-answers', 'uptime')),
  day date not null,
  data jsonb not null,
  primary key (workspace_id, source, day)
);
create table audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  actor uuid,
  action text not null,
  target text,
  detail jsonb,
  at timestamptz not null default now()
);
create table integrations (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('omnisuite', 'crm-webhook', 'search-console', 'idx-link')),
  config jsonb not null default '{}',
  secret_ref text,
  primary key (workspace_id, kind)
);

-- ---------- helpers (schema private: not exposed through the Data API) ----------
create schema if not exists private;
create function private.is_staff() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from staff where user_id = (select auth.uid())) and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' $$;
create function private.my_role(ws uuid) returns member_role language sql stable security definer set search_path = public as
  $$ select role from members where workspace_id = ws and user_id = (select auth.uid()) $$;
create function private.is_member(ws uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from members where workspace_id = ws and user_id = (select auth.uid())) $$;
create function private.my_team_row(ws uuid) returns uuid language sql stable security definer set search_path = public as
  $$ select team_row_id from members where workspace_id = ws and user_id = (select auth.uid()) $$;
create function private.can_see(ws uuid) returns boolean language sql stable as
  $$ select ws is not null and (private.is_staff() or private.is_member(ws)) $$;
create function private.collection_def(ws uuid, coll text) returns jsonb language sql stable security definer set search_path = public as
  $$ select resolved -> 'collections' -> coll from site_contracts where workspace_id = ws and active and private.can_see(ws) $$;
create function private.try_uuid(t text) returns uuid language sql immutable as
  $$ select case when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid end $$;
grant usage on schema private to authenticated, service_role;

-- ---------- row-level security (every policy names its role) ----------
alter table workspaces enable row level security;
alter table staff enable row level security;
alter table members enable row level security;
alter table sites enable row level security;
alter table site_contracts enable row level security;
alter table content_rows enable row level security;
alter table content_versions enable row level security;
alter table media enable row level security;
alter table leads enable row level security;
alter table lead_notes enable row level security;
alter table lead_pushes enable row level security;
alter table publish_jobs enable row level security;
alter table publish_job_events enable row level security;
alter table metrics_snapshots enable row level security;
alter table audit_log enable row level security;
alter table integrations enable row level security;

create policy ws_read on workspaces for select to authenticated using (private.can_see(id));
create policy staff_read on staff for select to authenticated using (user_id = (select auth.uid()) or private.is_staff());
create policy members_read on members for select to authenticated using (private.can_see(workspace_id));
create policy members_owner_write on members for all to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner')
  with check (private.is_staff() or private.my_role(workspace_id) = 'owner');
create policy sites_read on sites for select to authenticated using (private.can_see(workspace_id));
create policy contracts_read on site_contracts for select to authenticated using (private.can_see(workspace_id));
create policy rows_read on content_rows for select to authenticated using (private.can_see(workspace_id));
create policy versions_read on content_versions for select to authenticated using (private.can_see(workspace_id));
create policy media_read on media for select to authenticated using (private.can_see(workspace_id));
create policy media_insert on media for insert to authenticated with check (private.can_see(workspace_id) and uploaded_by = (select auth.uid()));
create policy leads_read on leads for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner'
  or (private.my_role(workspace_id) = 'member' and owner_team_row = private.my_team_row(workspace_id)));
create policy leads_update on leads for update to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner'
  or (private.my_role(workspace_id) = 'member' and owner_team_row = private.my_team_row(workspace_id)))
  with check (private.is_staff() or private.my_role(workspace_id) = 'owner'
  or (private.my_role(workspace_id) = 'member' and owner_team_row = private.my_team_row(workspace_id)));
create policy notes_read on lead_notes for select to authenticated using (private.can_see(workspace_id));
create policy notes_insert on lead_notes for insert to authenticated with check (private.can_see(workspace_id) and by = (select auth.uid()));
create policy pushes_read on lead_pushes for select to authenticated using (private.can_see(workspace_id));
create policy jobs_read on publish_jobs for select to authenticated using (private.can_see(workspace_id));
create policy job_events_read on publish_job_events for select to authenticated using (exists (select 1 from publish_jobs j where j.id = job_id and private.can_see(j.workspace_id)));
create policy metrics_read on metrics_snapshots for select to authenticated using (private.can_see(workspace_id));
create policy audit_read on audit_log for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');
create policy integrations_read on integrations for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');

-- Table grants: anon gets nothing; authenticated reads (RLS filters) and writes only where a policy exists.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on members to authenticated;
grant insert on media, lead_notes to authenticated;
grant update (status, owner_team_row) on leads to authenticated;
grant all on all tables in schema public to service_role;

-- ---------- writes: save a version (contracts/store.mjs save) ----------
-- The body lives in schema private and is NOT callable by clients: the only way in is the save Edge Function, which verifies
-- the user's JWT, runs contracts/validate.mjs, then calls service.save_as with the verified claims (dry run 3.2: a public RPC let
-- clients skip validation). The workspace argument is a claim, checked against membership; for an existing row it must equal
-- the row's workspace.
create function private.save_version(p_workspace uuid, p_collection text, p_row uuid, p_data jsonb, p_sign_off jsonb default null)
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
  if p_row is not null then
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

-- ---------- service-only functions (schema service; Edge Functions call them over a direct connection) ----------
create schema if not exists service;

-- Act with a user's verified JWT claims for the rest of this transaction (what PostgREST does for an RPC).
create function service.use_claims(p_claims jsonb) returns uuid language plpgsql as $$
begin
  if p_claims is null or p_claims ->> 'sub' is null then raise exception 'S-AUTH: verified claims with sub required'; end if;
  perform set_config('request.jwt.claims', p_claims::text, true);
  perform set_config('request.jwt.claim.sub', p_claims ->> 'sub', true);
  return (p_claims ->> 'sub')::uuid;
end $$;

-- The save and publish functions load the contract here FIRST: an outsider gets S-NOT-FOUND (404) before any validation could
-- reveal field names or limits (dry run 2, N1). Returns the resolved contract: the whole contract with core-merged collections.
create function service.contract_for(p_claims jsonb, p_workspace uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform service.use_claims(p_claims);
  if not (private.is_staff() or private.is_member(p_workspace)) then raise exception 'S-NOT-FOUND: not found'; end if;
  return (select resolved from site_contracts where workspace_id = p_workspace and active);
end $$;

-- The save Edge Function's database call (after contract_for and validateItem in code).
create function service.save_as(p_claims jsonb, p_workspace uuid, p_collection text, p_row uuid, p_data jsonb, p_sign_off jsonb default null)
returns table (row_id uuid, version int) language plpgsql security definer set search_path = public as $$
begin
  perform service.use_claims(p_claims);
  return query select * from private.save_version(p_workspace, p_collection, p_row, p_data, p_sign_off);
end $$;

-- Seeding and other staff-initiated writes without a user session: the actor is explicit and must be staff. Seeding sets the
-- locked page fields (path, type) from the approved plan; the sign-off reference is the plan's sitemap hash.
create function service.seed_version(p_workspace uuid, p_collection text, p_data jsonb, p_actor uuid, p_ref text)
returns uuid language plpgsql security definer set search_path = public as $$
declare def jsonb; rid uuid; owner_field text;
begin
  if not exists (select 1 from staff where user_id = p_actor) then raise exception 'S-SEED-ACTOR: seeding actor must be Omnikom staff'; end if;
  if coalesce(p_ref, '') = '' then raise exception 'S-SEED-REF: seeding needs a reference (the plan''s sitemap sha256)'; end if;
  select resolved -> 'collections' -> p_collection into def from site_contracts where workspace_id = p_workspace and active;
  if def is null then raise exception 'S-COLLECTION: no collection % in the active contract', p_collection; end if;
  if def ->> 'kind' = 'singleton' and exists (select 1 from content_rows where workspace_id = p_workspace and collection = p_collection and deleted_at is null)
    then raise exception 'S-SINGLETON: % has one row; edit it', p_collection; end if;
  owner_field := def ->> 'ownerField';
  insert into content_rows (workspace_id, collection, owner_team_row)
    values (p_workspace, p_collection, case when owner_field is not null and owner_field <> 'self' then nullif(p_data ->> owner_field, '')::uuid end)
    returning id into rid;
  insert into content_versions (row_id, n, workspace_id, data, by, sign_off) values (rid, 1, p_workspace, p_data, p_actor, jsonb_build_object('by', p_actor, 'ref', p_ref));
  insert into audit_log (workspace_id, actor, action, target, detail) values (p_workspace, p_actor, 'seed', p_collection || ':' || rid, jsonb_build_object('ref', p_ref));
  return rid;
end $$;

-- Publish = one job for all requested rows (atomic). The caller must be allowed to touch every row (same rules as saving).
-- The job records the requested versions; the full snapshot is frozen only when the build starts (service.freeze_snapshot),
-- because builds of one site run one at a time and an earlier job may still go live first. Nothing changes on the live site
-- until the job finishes "done".
create function service.start_publish(p_claims jsonb, p_site uuid, p_rows uuid[], p_versions int[]) returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; me uuid; req jsonb; job uuid; bad int; r record; def jsonb; role member_role; staff boolean;
begin
  me := service.use_claims(p_claims);
  select workspace_id into ws from sites where id = p_site;
  if ws is null then raise exception 'S-NOT-FOUND: unknown site'; end if;
  staff := private.is_staff(); role := private.my_role(ws);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if coalesce(array_length(p_rows, 1), 0) = 0 then raise exception 'S-NOT-FOUND: no rows'; end if;
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

-- Legal state changes only (diagrams/12-job-states); every change is an event with a timestamp (NFR-4 is measured from these).
create function service.set_job_state(p_job uuid, p_state job_state, p_report jsonb default null, p_deploy text default null, p_error text default null) returns void language plpgsql security definer set search_path = public as $$
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
    update content_rows c set published_version = (j.snapshot ->> c.id::text)::int where c.id = any(j.rows);
  end if;
  update publish_jobs set state = p_state, gate_report = coalesce(p_report, gate_report), deploy_id = coalesce(p_deploy, deploy_id), error = coalesce(p_error, error),
    finished_at = case when p_state in ('done', 'failed') then now() end where id = p_job;
  insert into publish_job_events (job_id, state) values (p_job, p_state);
  insert into audit_log (workspace_id, actor, action, target, detail) values (j.workspace_id, j.requested_by, 'publish-' || p_state, p_job::text, p_report);
end $$;

-- Build start: freeze the snapshot = what is live now + this job's requested versions; queued -> building.
create function service.freeze_snapshot(p_job uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare j publish_jobs; snap jsonb;
begin
  select * into j from publish_jobs where id = p_job for update;
  if not found then raise exception 'S-NOT-FOUND: no job'; end if;
  if j.snapshot is not null then return j.snapshot; end if;          -- a rerun ships exactly the same snapshot
  select coalesce(jsonb_object_agg(c.id, c.published_version), '{}') into snap from content_rows c
    where c.workspace_id = j.workspace_id and c.deleted_at is null and c.published_version is not null;
  snap := snap || j.requested;
  update publish_jobs set snapshot = snap where id = p_job;
  perform service.set_job_state(p_job, 'building');
  return snap;
end $$;

-- What a build reads: exactly the job's frozen snapshot.
create function service.published_rows(p_job uuid) returns table (id uuid, collection text, version int, data jsonb) language plpgsql stable security definer set search_path = public as $$
begin
  if (select snapshot from publish_jobs where publish_jobs.id = p_job) is null then raise exception 'S-JOB-STATE: snapshot not frozen'; end if;
  return query
  select c.id, c.collection, (j.snapshot ->> c.id::text)::int, v.data
  from publish_jobs j join content_rows c on c.workspace_id = j.workspace_id and j.snapshot ? c.id::text
  join content_versions v on v.row_id = c.id and v.n = (j.snapshot ->> c.id::text)::int
  where j.id = p_job;
end $$;

-- pg_cron every 5 minutes: a running job (building/gating/deploying) with no state change for 30 minutes fails; a queued job
-- may wait behind others (queue: max), so it fails only after 24 hours without a change (dry run 2, N2).
create function service.reap_stale_jobs() returns int language plpgsql security definer set search_path = public as $$
declare j record; n int := 0;
begin
  for j in select pj.id from publish_jobs pj
           where pj.state not in ('done', 'failed')
             and (select max(e.at) from publish_job_events e where e.job_id = pj.id)
                 < now() - case when pj.state = 'queued' then interval '24 hours' else interval '30 minutes' end loop
    perform service.set_job_state(j.id, 'failed', '{"reason":"timeout"}');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Take a row off the site (and optionally delete it); goes live with the next publish of the site.
create function service.unpublish(p_claims jsonb, p_row uuid, p_delete boolean default false) returns void language plpgsql security definer set search_path = public as $$
declare me uuid; c content_rows;
begin
  me := service.use_claims(p_claims);
  select * into c from content_rows where id = p_row;
  if not found or not (private.is_staff() or private.my_role(c.workspace_id) = 'owner') then raise exception 'S-NOT-FOUND: not found'; end if;
  update content_rows set published_version = null, deleted_at = case when p_delete then now() else deleted_at end where id = p_row;
  insert into audit_log (workspace_id, actor, action, target) values (c.workspace_id, me, case when p_delete then 'delete' else 'unpublish' end, p_row::text);
end $$;

-- Public lead capture: the site's Worker calls the capture-lead function (signed), which calls this with the site id.
create function service.capture_lead(p_site uuid, p_form text, p_page text, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; lid uuid;
begin
  select workspace_id into ws from sites where sites.id = p_site;
  if ws is null then raise exception 'unknown site'; end if;
  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;
  insert into leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text)
    values (ws, p_site, p_form, p_page, p_name, p_email, p_phone, coalesce(p_answers, '{}'), p_consent) returning leads.id into lid;
  return lid;
end $$;

revoke all on all functions in schema service from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_staff(), private.my_role(uuid), private.is_member(uuid), private.my_team_row(uuid), private.can_see(uuid), private.collection_def(uuid, text), private.try_uuid(text) to authenticated, service_role;
grant usage on schema service to service_role;
grant execute on all functions in schema service to service_role;

-- Realtime: the dashboard streams job states and new leads (RLS still applies to what each user receives).
do $$ begin
  if exists (select from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table publish_jobs, leads;
  end if;
end $$;

-- ---------- storage: private bucket "media", one folder per workspace ----------
insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict (id) do nothing;
create policy media_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and private.try_uuid((storage.foldername(name))[1]) is not null and private.can_see(private.try_uuid((storage.foldername(name))[1])));
create policy media_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and private.try_uuid((storage.foldername(name))[1]) is not null and private.can_see(private.try_uuid((storage.foldername(name))[1])));
