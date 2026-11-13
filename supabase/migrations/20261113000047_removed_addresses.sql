-- Omnikom Platform: book row B12-E (hand-over B12-E.md, part E1), migration 47: the build learns which items left the site, so the deployment can answer 404 at their old addresses.
-- Cloudflare's edge goes on serving an old deployment's page at its address for up to a week after a newer deployment ("Serving Pages": assets have a time-to-live of one week, per data center);
-- the site's own function answers 404 there instead (hand-over part E2). service.gone_rows(job): the rows that were in a finished deployment of the job's site in the last 7 days and are not in
-- this job's snapshot, each as the version that deployment held, with the time it left. export_bundle (migration 42's text) gains the key "removed". Additive; one new function, one replaced.
-- Nothing is stored: the jobs' own snapshots (migration 1) say what each deployment held. Tests: tenancy.test.sql T43, mutants "gone47: ...".
create function service.gone_rows(p_job uuid) returns table (id uuid, collection text, version int, data jsonb, left_at timestamptz) language plpgsql stable security definer set search_path = '' as $$
declare j public.publish_jobs; edge timestamptz;
begin
  select * into j from public.publish_jobs where public.publish_jobs.id = p_job;
  if not found then raise exception 'S-NOT-FOUND: no job'; end if;
  if j.snapshot is null then raise exception 'S-JOB-STATE: snapshot not frozen'; end if;
  if j.preview then return; end if;
  select max(f.finished_at) into edge from public.publish_jobs f where f.site_id = j.site_id and f.id <> j.id and f.state = 'done' and not f.preview and f.finished_at <= now() - interval '7 days';
  return query
  with d as (select x.finished_at as at, x.snapshot as snap from public.publish_jobs x
             where x.site_id = j.site_id and x.id <> j.id and x.state = 'done' and not x.preview and x.snapshot is not null and x.finished_at >= coalesce(edge, '-infinity')),
  seen as (select e.key as k, max(d.at) as at, (array_agg((e.value #>> '{}')::int order by d.at desc))[1] as n
           from d cross join lateral jsonb_each(d.snap) e where not (j.snapshot ? e.key) group by e.key)
  select c.id, c.collection, s.n, v.data, coalesce((select min(nx.at) from d nx where nx.at > s.at), now())
  from seen s
  join public.content_rows c on c.id = s.k::uuid and c.workspace_id = j.workspace_id
  join public.content_versions v on v.row_id = c.id and v.n = s.n
  join public.site_contracts sc on sc.workspace_id = c.workspace_id and sc.active
  where coalesce(sc.resolved -> 'collections' -> c.collection ->> 'route', '') <> '';
end $$;
revoke all on function service.gone_rows(uuid) from public, anon, authenticated;
grant execute on function service.gone_rows(uuid) to service_role, omnikom_fn;

-- service.export_bundle (migration 42)
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
                      from public.media m where m.workspace_id = j.workspace_id), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'collection', g.collection, 'version', g.version, 'data', g.data, 'left_at', g.left_at) order by g.collection, g.id)
                      from service.gone_rows(p_job) g), '[]'::jsonb));
end $$;
