-- Omnikom Platform: book row B14 (slice S11), the media library's replace and delete. Additive to the migrations before it.
-- service.replace_media: the owner (or Omnikom staff) of a file's workspace, never a member, puts another file of the SAME workspace in its place in
--   every item whose newest version uses it: one new version per item through private.save_version (a save's walls hold: locked fields, S-STALE).
--   Returns each changed item with its new data: the Edge Function runs a save's own checks on it and rolls the whole replace back on a problem.
-- service.delete_media: the same caller deletes a file nothing uses: no live item's newest version, no item's live version and no running publish
--   holds it (S-MEDIA-IN-USE otherwise; a deleted item does not count). Returns the Storage paths to remove, the original and its three sizes (the Edge
--   Function removes them with the secret key: a SQL delete of Storage objects is refused). Older versions in an item's history may still name it.
-- A use is found in a version's JSON text: jsonb prints a key and its value as "asset": "<id>", and an id is a whole uuid.
-- Both: security definer, search_path '', claims first, S-NOT-FOUND for anyone else, an audit row. Tests: tenancy.test.sql T40; mutants "media44:".

create function service.replace_media(p_claims jsonb, p_from uuid, p_to uuid)
returns table (item_workspace uuid, item_row uuid, item_collection text, item_data jsonb) language plpgsql security definer set search_path = '' as $$
declare me uuid; mws uuid; r record; n int := 0;
begin
  me := service.use_claims(p_claims);
  select m.workspace_id into mws from public.media m where m.id = p_from;
  if mws is null or not private.is_owner_or_staff(mws) then raise exception 'S-NOT-FOUND: not found'; end if;
  if not exists (select 1 from public.media m where m.id = p_to and m.workspace_id = mws) then raise exception 'S-NOT-FOUND: not found'; end if;
  for r in select c.id, c.collection, v.n, v.data from public.content_rows c
      join public.content_versions v on v.row_id = c.id and v.n = (select max(x.n) from public.content_versions x where x.row_id = c.id)
      where c.workspace_id = mws and c.deleted_at is null and strpos(v.data::text, '"asset": "' || p_from::text || '"') > 0 loop
    item_workspace := mws; item_row := r.id; item_collection := r.collection;
    item_data := replace(r.data::text, '"asset": "' || p_from::text || '"', '"asset": "' || p_to::text || '"')::jsonb;
    perform private.save_version(mws, r.collection, r.id, item_data, null, r.n);
    n := n + 1;
    return next;
  end loop;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (mws, me, 'media-replace', p_from::text, jsonb_build_object('to', p_to, 'items', n));
end $$;

create function service.delete_media(p_claims jsonb, p_media uuid) returns setof text language plpgsql security definer set search_path = '' as $$
declare me uuid; dm public.media; n int; stem text;
begin
  me := service.use_claims(p_claims);
  select * into dm from public.media where public.media.id = p_media for update;
  if not found or not private.is_owner_or_staff(dm.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  select count(distinct c.id) into n from public.content_rows c join public.content_versions v on v.row_id = c.id
    where c.workspace_id = dm.workspace_id and c.deleted_at is null and strpos(v.data::text, '"asset": "' || p_media::text || '"') > 0
      and (v.n = (select max(x.n) from public.content_versions x where x.row_id = c.id)   -- its newest version
        or v.n = c.published_version   -- its live version
        or exists (select 1 from public.publish_jobs j where j.workspace_id = c.workspace_id and j.state not in ('done', 'failed')
                   and (coalesce(j.snapshot, j.requested) ->> c.id::text)::int = v.n));   -- a version a running publish pinned
  if n > 0 then raise exception 'S-MEDIA-IN-USE: % item(s) use this file', n; end if;
  delete from public.media where public.media.id = p_media;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (dm.workspace_id, me, 'media-delete', p_media::text, jsonb_build_object('path', dm.path));
  stem := regexp_replace(dm.path, '\.[^./]+$', '');
  return query select unnest(array[dm.path, stem || '-2400.webp', stem || '-1600.webp', stem || '-800.webp']);
end $$;

revoke all on function service.replace_media(jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function service.delete_media(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.replace_media(jsonb, uuid, uuid) to omnikom_fn;
grant execute on function service.delete_media(jsonb, uuid) to omnikom_fn;
