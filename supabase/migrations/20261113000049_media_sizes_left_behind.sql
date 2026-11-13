-- Omnikom Platform: book row B25 (slice S11). Additive. The callback of a media job whose file the library deleted
-- meanwhile asks this for the ORIGINAL's path (the delete's audit row), else null. Tests: T49; mutants "sizes49:".
create function service.deleted_media_path(p_media uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select a.detail ->> 'path' from public.audit_log a
   where a.action = 'media-delete' and a.target = p_media::text
     and not exists (select 1 from public.media k where k.id = p_media)
   limit 1
$$;
revoke all on function service.deleted_media_path(uuid) from public, anon, authenticated;
grant execute on function service.deleted_media_path(uuid) to omnikom_fn;
