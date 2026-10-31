-- Omnikom Platform: step 4, slice 4.2 follow-up (the coordinator's addition, 2026-10-31, after the 4.1 verification).
-- service.export_bundle (migration 9) must return the top-level key "schema": "omnikom-export/1": the factory refuses an export without it
-- (factory/lib/export.mjs, factory/README.md section 1). Migration 9 was already applied to staging when this was found, and an applied
-- migration is never edited, so this file replaces the one function with `create or replace` (same signature, same definer, same
-- search_path = '', privileges kept by CREATE OR REPLACE). The body is migration 9's, plus the first key. Tests: tenancy.test.sql T18
-- (the key is asserted) and a mutant in run-local.mjs that drops it.
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
    'job', jsonb_build_object('id', j.id, 'site_id', j.site_id, 'workspace_id', j.workspace_id, 'snapshot', j.snapshot, 'created_at', j.created_at),
    'site', jsonb_build_object('id', s.id, 'deploy_target', s.deploy_target, 'preview_host', s.preview_host, 'domain', s.domain, 'state', s.state),
    'workspace', jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name, 'industry', w.industry),
    'contract', (select sc.resolved from public.site_contracts sc where sc.workspace_id = j.workspace_id and sc.active),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'collection', r.collection, 'version', r.version, 'data', r.data, 'at', v.at) order by r.collection, r.id)
                      from service.published_rows(p_job) r join public.content_versions v on v.row_id = r.id and v.n = r.version), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'path', m.path, 'width', m.width, 'height', m.height, 'processed', m.processed,
                      'exif_stripped', m.exif_stripped, 'rights_confirmed', m.rights_confirmed) order by m.created_at, m.id)
                      from public.media m where m.workspace_id = j.workspace_id), '[]'::jsonb));
end $$;
