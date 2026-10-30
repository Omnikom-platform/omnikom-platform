-- Migration 6: service.active_key finds a per-site key by the SITE alone.
-- Found 2026-10-30 on staging: `omnikom key mint` and tools/mint-site-key.mjs store a site key WITH its workspace_id, while
-- capture-lead asks active_key('site-signing', site) with no workspace; migration 2 matched workspace_id with "is not distinct
-- from" the (null) argument, so the stored key was never found and every signed lead answered 401 before a signature was compared.
-- Meaning now: a site given -> match that site, and narrow by the workspace only when one is given; no site -> platform-wide keys
-- (site null, workspace equal to the argument, as before). Revoked and expired keys stay dead. Same signature, same grants.
create or replace function service.active_key(p_kind api_key_kind, p_site uuid default null, p_workspace uuid default null)
returns table (id uuid, key_hash text, vault_ref text) language sql stable security definer set search_path = public as $$
  select k.id, k.key_hash, k.vault_ref from api_keys k
  where k.kind = p_kind
    and case when p_site is null then k.site_id is null and k.workspace_id is not distinct from p_workspace
             else k.site_id = p_site and (p_workspace is null or k.workspace_id = p_workspace) end
    and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
  order by k.created_at desc $$;

revoke all on all functions in schema service from public, anon, authenticated;
grant execute on all functions in schema service to service_role;
