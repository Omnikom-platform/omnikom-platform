-- Omnikom Platform: book row B12 part b (hand-over B12-b.md), migration 45: take an item off the site without deleting it; a delete or a take-off is a waiting change.
-- Additive to every earlier migration; five functions replaced, each its latest text plus B12-b.md's changes. off_site_at: set by a take-off, cleared by put_back or a publish of the row;
-- published_version moves only when a job finishes (migration 1): a job carries the waiting removals, its build leaves them out, its done follows its frozen snapshot. Tests: T41, "offsite45: ...".
set lock_timeout = '5s';
alter table public.content_rows add column off_site_at timestamptz;
create function service.put_back(p_claims jsonb, p_row uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; c public.content_rows;
begin
  me := service.use_claims(p_claims); select * into c from public.content_rows where id = p_row;
  if not found or c.deleted_at is not null or not private.is_owner_or_staff(c.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  update public.content_rows set off_site_at = null where id = p_row;
  insert into public.audit_log (workspace_id, actor, action, target) values (c.workspace_id, me, 'put-back', p_row::text); end $$;
revoke all on function service.put_back(jsonb, uuid) from public, anon, authenticated; grant execute on function service.put_back(jsonb, uuid) to service_role, omnikom_fn;

-- service.unpublish (migration 8)
create or replace function service.unpublish(p_claims jsonb, p_row uuid, p_delete boolean default false) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; c public.content_rows;
begin
  me := service.use_claims(p_claims);
  select * into c from public.content_rows where id = p_row;
  if not found or not private.is_owner_or_staff(c.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  update public.content_rows set deleted_at = case when p_delete then now() else deleted_at end, off_site_at = case when p_delete then off_site_at else now() end where id = p_row;
  insert into public.audit_log (workspace_id, actor, action, target) values (c.workspace_id, me, case when p_delete then 'delete' else 'unpublish' end, p_row::text);
end $$;

-- service.drafts_waiting (migration 12)
create or replace function service.drafts_waiting(p_claims jsonb, p_site uuid)
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
    and c.off_site_at is null
    and coalesce(contract -> 'collections' -> c.collection ->> 'kind', '') <> 'inbox'
    and (staff or role = 'owner'
         or (role = 'member' and contract -> 'collections' -> c.collection -> 'access' ->> 'member' = 'own' and mine is not null
             and ((contract -> 'collections' -> c.collection ->> 'ownerField' = 'self' and c.id = mine)
               or (contract -> 'collections' -> c.collection ->> 'ownerField' <> 'self' and c.owner_team_row = mine))))
  union all
  select r.id, r.collection, null::int, r.published_version, null::uuid, coalesce(r.deleted_at, r.off_site_at) from public.content_rows r
  where r.workspace_id = ws and r.published_version is not null and (r.deleted_at is not null or r.off_site_at is not null) and (staff or role = 'owner')
  order by 6 desc, 1;
end $$;

-- service.start_publish (migration 8)
create or replace function service.start_publish(p_claims jsonb, p_site uuid, p_rows uuid[], p_versions int[]) returns uuid language plpgsql security definer set search_path = '' as $$
declare ws uuid; wst public.workspace_state; me uuid; req jsonb; job uuid; bad int; r record; def jsonb; role public.member_role; staff boolean; leaving uuid[];
begin
  me := service.use_claims(p_claims);
  select s.workspace_id, w.state into ws, wst from public.sites s join public.workspaces w on w.id = s.workspace_id where s.id = p_site;
  if ws is null then raise exception 'S-NOT-FOUND: unknown site'; end if;
  leaving := array(select g.id from public.content_rows g where g.workspace_id = ws and g.published_version is not null and (g.deleted_at is not null or g.off_site_at is not null) and g.id <> all(coalesce(p_rows, '{}')));
  staff := private.is_staff(); role := private.my_role(ws);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if coalesce(array_length(p_rows, 1), 0) = 0 and not (cardinality(leaving) > 0 and coalesce(staff or role = 'owner', false)) then raise exception 'S-NOT-FOUND: no rows'; end if;
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
  req := coalesce(req, '{}');
  update public.content_rows set off_site_at = null where id = any(p_rows) and off_site_at is not null;
  insert into public.publish_jobs (workspace_id, site_id, requested_by, rows, requested) values (ws, p_site, me, p_rows || leaving, req) returning id into job;
  insert into public.publish_job_events (job_id, state) values (job, 'queued');
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (ws, me, 'publish-start', job::text, jsonb_build_object('rows', p_rows));
  return job;
end $$;

-- service.set_job_state (migration 8)
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
    -- book row B12-b: done follows the frozen snapshot: the job's rows its build shipped get their version (a version only ever rises), the rows it left out are
    -- blanked; a late reconcile (reaped, then done) changes nothing once another job of the site was done after the reap: that build is the newer one
    if not (j.state = 'failed' and exists (select 1 from public.publish_jobs n where n.site_id = j.site_id and n.state = 'done' and n.finished_at > j.finished_at)) then
    update public.content_rows c set published_version = greatest(coalesce(c.published_version, 0), (j.snapshot ->> c.id::text)::int)
      where c.id = any(j.rows) and j.snapshot ? c.id::text;
    update public.content_rows c set published_version = null where c.id = any(j.rows) and not (j.snapshot ? c.id::text);
    end if;
  end if;
  update public.publish_jobs set state = p_state, gate_report = coalesce(p_report, gate_report), deploy_id = coalesce(p_deploy, deploy_id), error = coalesce(p_error, error),
    finished_at = case when p_state in ('done', 'failed') then now() end where id = p_job;
  insert into public.publish_job_events (job_id, state) values (p_job, p_state);
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (j.workspace_id, j.requested_by, 'publish-' || p_state, p_job::text, p_report);
end $$;

-- service.freeze_snapshot (migration 8)
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
  snap := snap - array(select x.id::text from public.content_rows x where x.workspace_id = j.workspace_id and (x.off_site_at is not null or x.deleted_at is not null));
  update public.publish_jobs set snapshot = snap where id = p_job;
  perform service.set_job_state(p_job, 'building');
  return snap;
end $$;
