-- Omnikom Platform: step 4, slice 4.2 (brief factory/briefs/4-2-dashboard-functions.md). Additive to migrations 1 to 8.
-- The service functions the dashboard Edge Functions (upload-start, upload-finish, save, publish) and the runner's functions
-- (export-published, media-process-callback, job-callback, media-export) call. Every one is SECURITY DEFINER with
-- set search_path = '' and schema-qualified names (migration 8 style; T14 asserts it), closed to PUBLIC, anon and authenticated, and
-- open to the function role omnikom_fn only (the default privileges of migration 8 do it; the explicit statements below are the
-- second layer, and the mutants in run-local.mjs remove both). Tests: tenancy.test.sql T18, written before this file.
--  Dashboard side (verified claims, member or staff of the workspace, else S-NOT-FOUND):
--    record_media, finish_media, media_facts, row_exists, site_for, row_version
--  Runner side (no claims: the Edge Function verified the runner's signature before calling):
--    media_processed, media_for_runner, export_bundle, job_site
-- site_for and row_version are not in the brief's list: the publish function gets a site (not a workspace) in its body and must read
-- the pinned version of each row to validate it, and the function role has no table read, so both need a service function.

-- ---------- record_media: the first half of an upload (a row, a path under the workspace, nothing the processor owns) ----------
create function service.record_media(p_claims jsonb, p_workspace uuid, p_filename text, p_bytes int, p_mime text)
returns table (id uuid, path text) language plpgsql security definer set search_path = '' as $$
declare me uuid; ext text; mid uuid := gen_random_uuid(); mpath text;
begin
  me := service.use_claims(p_claims);
  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  ext := case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/heic' then 'heic' when 'application/pdf' then 'pdf' end;
  if ext is null then raise exception 'I-MEDIA-TYPE: jpg, png, webp, heic or pdf only'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 26214400 then raise exception 'I-MEDIA-SIZE: a file is between 1 byte and 25 MB'; end if;
  mpath := p_workspace::text || '/' || mid::text || '.' || ext;
  insert into public.media (id, workspace_id, path, bytes, uploaded_by) values (mid, p_workspace, mpath, p_bytes, me);
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'media-start', mid::text, jsonb_build_object('filename', left(p_filename, 200), 'mime', p_mime, 'bytes', p_bytes));
  return query select mid, mpath;
end $$;

-- ---------- finish_media: the rights tick, and only that (width, height, processed and exif_stripped are the processor's: ground rule 11) ----------
create function service.finish_media(p_claims jsonb, p_media uuid, p_rights boolean) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; m public.media;
begin
  me := service.use_claims(p_claims);
  select * into m from public.media where public.media.id = p_media for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  if not coalesce(private.is_staff() or private.my_role(m.workspace_id) = 'owner' or (m.uploaded_by = me and private.is_member(m.workspace_id)), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  update public.media set rights_confirmed = coalesce(p_rights, false) where public.media.id = p_media;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (m.workspace_id, me, 'media-finish', p_media::text, jsonb_build_object('rights', coalesce(p_rights, false)));
end $$;

-- ---------- media_processed: the runner's facts (called by media-process-callback after it verified the runner's signature) ----------
create function service.media_processed(p_media uuid, p_width int, p_height int, p_exif_stripped boolean, p_bytes int) returns void language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  if p_width is null or p_width < 1 then raise exception 'I-MEDIA-SIZE: the processor must report a width of at least 1'; end if;
  update public.media set width = p_width, height = p_height, exif_stripped = coalesce(p_exif_stripped, false), bytes = coalesce(p_bytes, bytes), processed = true
    where public.media.id = p_media returning public.media.workspace_id into ws;
  if not found then raise exception 'S-NOT-FOUND: no such media'; end if;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (ws, null, 'media-processed', p_media::text, jsonb_build_object('width', p_width, 'height', p_height, 'exif_stripped', coalesce(p_exif_stripped, false)));
end $$;

-- ---------- media_for_runner: what the runner's media-export needs to find a file to process ----------
create function service.media_for_runner(p_media uuid) returns table (id uuid, workspace_id uuid, path text, processed boolean) language plpgsql security definer set search_path = '' as $$
begin
  return query select m.id, m.workspace_id, m.path, m.processed from public.media m where m.id = p_media;
  if not found then raise exception 'S-NOT-FOUND: no such media'; end if;
end $$;

-- ---------- media_facts: what validateItem needs about a photo (the record, never the row's own JSON); null when it is not this workspace's ----------
create function service.media_facts(p_claims jsonb, p_workspace uuid, p_media uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform service.use_claims(p_claims);
  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  return (select jsonb_build_object('width', m.width, 'exifStripped', m.exif_stripped, 'rightsConfirmed', m.rights_confirmed, 'processed', m.processed)
          from public.media m where m.id = p_media and m.workspace_id = p_workspace);
end $$;

-- ---------- row_exists: a live row of that collection in the workspace (validateItem's reference lookup) ----------
create function service.row_exists(p_claims jsonb, p_workspace uuid, p_collection text, p_row uuid) returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  perform service.use_claims(p_claims);
  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  return exists (select 1 from public.content_rows c where c.id = p_row and c.workspace_id = p_workspace and c.collection = p_collection and c.deleted_at is null);
end $$;

-- ---------- site_for: the workspace of a site, to its members and staff (the publish body names a site, not a workspace) ----------
create function service.site_for(p_claims jsonb, p_site uuid) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare ws uuid;
begin
  perform service.use_claims(p_claims);
  select s.workspace_id into ws from public.sites s where s.id = p_site;
  if ws is null or not coalesce(private.is_staff() or private.is_member(ws), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  return ws;
end $$;

-- ---------- row_version: the collection and the data of one pinned version, to validate it before a publish ----------
create function service.row_version(p_claims jsonb, p_workspace uuid, p_row uuid, p_n int) returns table (collection text, data jsonb) language plpgsql stable security definer set search_path = '' as $$
begin
  perform service.use_claims(p_claims);
  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  return query select c.collection, v.data from public.content_rows c join public.content_versions v on v.row_id = c.id
    where c.id = p_row and c.workspace_id = p_workspace and c.deleted_at is null and v.n = p_n;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
end $$;

-- ---------- export_bundle: everything the build needs for one job, as one document (the shape factory/README.md names) ----------
create function service.export_bundle(p_job uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare j public.publish_jobs; s public.sites; w public.workspaces;
begin
  select * into j from public.publish_jobs where public.publish_jobs.id = p_job;
  if not found then raise exception 'S-NOT-FOUND: no job'; end if;
  if j.snapshot is null then raise exception 'S-JOB-STATE: snapshot not frozen'; end if;
  select * into s from public.sites where public.sites.id = j.site_id;
  select * into w from public.workspaces where public.workspaces.id = j.workspace_id;
  return jsonb_build_object(
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

-- ---------- job_site: the site and deploy target of a job (job-callback needs them without a table read) ----------
create function service.job_site(p_job uuid) returns table (site_id uuid, deploy_target text) language plpgsql stable security definer set search_path = '' as $$
begin
  return query select j.site_id, s.deploy_target from public.publish_jobs j join public.sites s on s.id = j.site_id where j.id = p_job;
  if not found then raise exception 'S-NOT-FOUND: no job'; end if;
end $$;

-- ---------- grants: closed to everyone, open to the function role (second layer beside migration 8's default privileges) ----------
revoke all on function service.record_media(jsonb, uuid, text, int, text) from public, anon, authenticated;
revoke all on function service.finish_media(jsonb, uuid, boolean) from public, anon, authenticated;
revoke all on function service.media_processed(uuid, int, int, boolean, int) from public, anon, authenticated;
revoke all on function service.media_for_runner(uuid) from public, anon, authenticated;
revoke all on function service.media_facts(jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function service.row_exists(jsonb, uuid, text, uuid) from public, anon, authenticated;
revoke all on function service.site_for(jsonb, uuid) from public, anon, authenticated;
revoke all on function service.row_version(jsonb, uuid, uuid, int) from public, anon, authenticated;
revoke all on function service.export_bundle(uuid) from public, anon, authenticated;
revoke all on function service.job_site(uuid) from public, anon, authenticated;
grant execute on function service.record_media(jsonb, uuid, text, int, text) to omnikom_fn;
grant execute on function service.finish_media(jsonb, uuid, boolean) to omnikom_fn;
grant execute on function service.media_processed(uuid, int, int, boolean, int) to omnikom_fn;
grant execute on function service.media_for_runner(uuid) to omnikom_fn;
grant execute on function service.media_facts(jsonb, uuid, uuid) to omnikom_fn;
grant execute on function service.row_exists(jsonb, uuid, text, uuid) to omnikom_fn;
grant execute on function service.site_for(jsonb, uuid) to omnikom_fn;
grant execute on function service.row_version(jsonb, uuid, uuid, int) to omnikom_fn;
grant execute on function service.export_bundle(uuid) to omnikom_fn;
grant execute on function service.job_site(uuid) to omnikom_fn;
