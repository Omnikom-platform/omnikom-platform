-- Omnikom Platform: book row B15 part b1 (slice S10), migration 42: the preview job. The site's saved drafts that pass the publish-ready wall
-- (private.publish_problems, migration 11), each at its NEWEST version, in one job that publishes nothing (rows is empty); a draft that does not pass is
-- left out and named (left_out). site_audit skips preview jobs. Owners and staff only. Tests: tenancy.test.sql T-B15; mutants: run-local.mjs "preview42".
set lock_timeout = '5s';
alter table public.publish_jobs add column preview boolean not null default false, add column left_out jsonb;

create function service.start_preview(p_claims jsonb, p_site uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare ws uuid; wst public.workspace_state; me uuid; res jsonb; req jsonb := '{}'; skipped jsonb := '[]'; r record; probs text[]; job uuid;
begin
  me := service.use_claims(p_claims);
  select s.workspace_id, w.state into ws, wst from public.sites s join public.workspaces w on w.id = s.workspace_id where s.id = p_site;
  if ws is null or not (private.is_staff() or private.my_role(ws) is not null) then raise exception 'S-NOT-FOUND: not found'; end if;
  if not private.is_staff() and private.my_role(ws) = 'member' then raise exception 'S-ROLE: members do not build a preview of the whole site'; end if;
  if wst not in ('trial', 'active') then raise exception 'S-WORKSPACE-STATE: a % workspace builds nothing', wst; end if;
  select sc.resolved into res from public.site_contracts sc where sc.workspace_id = ws and sc.active;
  if res is null then raise exception 'I-NOT-READY: % no active contract', ws; end if;
  for r in select c.id, c.collection, v.n, v.data from public.content_rows c
      join lateral (select x.n, x.data from public.content_versions x where x.row_id = c.id order by x.n desc limit 1) v on true
      where c.workspace_id = ws and c.deleted_at is null and v.n is distinct from c.published_version
        and coalesce(private.collection_def(ws, c.collection) ->> 'kind', '') <> 'inbox' order by c.collection, c.id loop
    probs := private.publish_problems(res, r.collection, r.data);   -- the wall's own check: what it would refuse is left out and named
    if cardinality(probs) = 0 then req := req || jsonb_build_object(r.id::text, r.n);
    else skipped := skipped || jsonb_build_array(jsonb_build_object('row', r.id, 'collection', r.collection, 'path', regexp_replace(probs[1], ' required$', ''))); end if;
  end loop;
  if req = '{}'::jsonb then return jsonb_build_object('job', null, 'left_out', skipped); end if;
  insert into public.publish_jobs (workspace_id, site_id, requested_by, rows, requested, preview, left_out) values (ws, p_site, me, '{}', req, true, skipped) returning id into job;
  insert into public.publish_job_events (job_id, state) values (job, 'queued');
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (ws, me, 'preview-start', job::text, jsonb_build_object('rows', (select count(*) from jsonb_object_keys(req)), 'left_out', jsonb_array_length(skipped)));
  return jsonb_build_object('job', job, 'left_out', skipped);
end $$;
revoke all on function service.start_preview(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.start_preview(jsonb, uuid) to service_role, omnikom_fn;

create or replace function service.export_bundle(p_job uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare j public.publish_jobs; s public.sites; w public.workspaces;
begin
  select * into j from public.publish_jobs where public.publish_jobs.id = p_job;
  if not found then raise exception 'S-NOT-FOUND: no job'; end if;
  if j.snapshot is null then raise exception 'S-JOB-STATE: snapshot not frozen'; end if;
  select * into s from public.sites where public.sites.id = j.site_id;
  select * into w from public.workspaces where public.workspaces.id = j.workspace_id;
  return jsonb_build_object(
    'schema', 'omnikom-export/1',
    'job', jsonb_build_object('id', j.id, 'site_id', j.site_id, 'workspace_id', j.workspace_id, 'snapshot', j.snapshot, 'created_at', j.created_at, 'preview', j.preview),
    'site', jsonb_build_object('id', s.id, 'deploy_target', s.deploy_target, 'preview_host', s.preview_host, 'domain', s.domain, 'state', s.state),
    'workspace', jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name, 'industry', w.industry),
    'contract', (select sc.resolved from public.site_contracts sc where sc.workspace_id = j.workspace_id and sc.active),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'collection', r.collection, 'version', r.version, 'data', r.data, 'at', v.at) order by r.collection, r.id)
                      from service.published_rows(p_job) r join public.content_versions v on v.row_id = r.id and v.n = r.version), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'path', m.path, 'width', m.width, 'height', m.height, 'processed', m.processed,
                      'exif_stripped', m.exif_stripped, 'rights_confirmed', m.rights_confirmed) order by m.created_at, m.id)
                      from public.media m where m.workspace_id = j.workspace_id), '[]'::jsonb));
end $$;

drop function service.site_audit(jsonb, uuid);
create function service.site_audit(p_claims jsonb, p_site uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid; ws uuid; prev jsonb; prod jsonb; hist jsonb;
begin
  me := service.use_claims(p_claims);
  select s.workspace_id into ws from public.sites s where s.id = p_site;
  if ws is null or not private.is_owner_or_staff(ws) then raise exception 'S-NOT-FOUND: not found'; end if;
  select private.audit_row(j.id, j.finished_at, j.state, j.gate_report, true) into prev from (select * from public.publish_jobs p where not p.preview) j
    where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'preview'
    order by j.finished_at desc nulls last, j.id desc limit 1;
  select private.audit_row(j.id, j.finished_at, j.state, j.gate_report, true) into prod from (select * from public.publish_jobs p where not p.preview) j
    where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'production'
    order by j.finished_at desc nulls last, j.id desc limit 1;
  select coalesce(jsonb_agg(h.r order by h.finished_at desc nulls last, h.id desc), '[]'::jsonb) into hist
    from (select j.id, j.finished_at, private.audit_row(j.id, j.finished_at, j.state, j.gate_report, false) as r from (select * from public.publish_jobs p where not p.preview) j
          where j.site_id = p_site and j.state in ('done', 'failed') order by j.finished_at desc nulls last, j.id desc limit 10) h;
  return jsonb_build_object('latest', jsonb_build_object('preview', prev, 'production', prod), 'history', hist);
end $$;
revoke all on function service.site_audit(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.site_audit(jsonb, uuid) to service_role, omnikom_fn;
