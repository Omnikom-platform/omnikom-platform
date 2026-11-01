-- Omnikom Platform: step 5, slice 5.2 (brief factory/briefs/5-2-screens-functions.md). Additive to migrations 1 to 12.
-- What the Edge Functions of the four screens need and SQL alone could not give them. Tests: tenancy.test.sql T21 (written first).
--  1. The CRM webhook's signing secret lives in Supabase Vault (16-DESIGN-PARTS 3.1 item 10). The function role may not touch the vault schema
--     (migration 8: it reaches service.* functions only, no table, no schema), so five definer functions do it, each owner-or-staff:
--       service.crm_secret_put   create or replace the secret of ONE workspace; the Vault name is derived inside ('crm-webhook-<workspace id>'),
--                                a caller can never name a secret (an owner must not be able to overwrite a site's signing key)
--       service.crm_secret_drop  delete that same secret
--       service.crm_target       the stored address and secret, for ONE signed test request (the function signs; the value goes nowhere else)
--       service.crm_tested       the audit row of a test request (outcome, status, host name: never a path, a query or the secret)
--       service.find_login       does this email have a login already (the invite creates one only when it does not); also checks the team row
--  2. Every function: security definer, set search_path = '', fully schema-qualified, starts with service.use_claims, refuses with
--     'S-NOT-FOUND: not found' to anyone who is not an owner of the workspace or staff with MFA (T14 checks the shape). The Vault is reached by
--     dynamic SQL (as service.site_signing_secrets does), so this migration applies on a plain Postgres without a vault schema; the calls are
--     proven locally against a stand-in (T21) and on staging by e2e-screens.mjs.

create function service.crm_secret_put(p_claims jsonb, p_workspace uuid, p_secret text) returns text language plpgsql security definer set search_path = '' as $$
declare me uuid; nm text; sid uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_secret is null or length(p_secret) < 32 or length(p_secret) > 200 then raise exception 'I-SECRET-REF: a secret of 32 to 200 characters'; end if;
  nm := 'crm-webhook-' || p_workspace::text;
  execute 'select id from vault.secrets where name = $1' into sid using nm;
  if sid is null then
    execute 'select vault.create_secret($1, $2, $3)' using p_secret, nm, 'CRM webhook signing secret, workspace ' || p_workspace::text;
  else
    execute 'select vault.update_secret($1, $2, $3, $4)' using sid, p_secret, nm, 'CRM webhook signing secret, workspace ' || p_workspace::text;
  end if;
  return nm;
end $$;

create function service.crm_secret_drop(p_claims jsonb, p_workspace uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; nm text;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  nm := 'crm-webhook-' || p_workspace::text;
  execute 'delete from vault.secrets where name = $1' using nm;
end $$;

create function service.crm_target(p_claims jsonb, p_workspace uuid) returns table (url text, secret text) language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  -- the secret is pinned to the derived name: a connection whose ref names any other Vault secret hands out nothing
  return query execute 'select i.config ->> ''url'', s.decrypted_secret from public.integrations i join vault.decrypted_secrets s on s.name = i.secret_ref'
    || ' where i.workspace_id = $1 and i.kind = ''crm-webhook'' and i.secret_ref = $2' using p_workspace, 'crm-webhook-' || p_workspace::text;
end $$;

create function service.crm_tested(p_claims jsonb, p_workspace uuid, p_outcome text, p_status int, p_host text) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_outcome is null or p_outcome not in ('sent', 'refused', 'failed') then raise exception 'I-OUTCOME: sent, refused or failed'; end if;
  -- a host name and nothing else: a path or a query (a token can sit there) never reaches the audit row
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'crm-test', p_workspace::text,
    jsonb_build_object('outcome', p_outcome, 'status', p_status, 'host', case when p_host ~ '^[A-Za-z0-9.-]{1,253}$' then p_host end));
end $$;

create function service.find_login(p_claims jsonb, p_workspace uuid, p_email text, p_team_row uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_team_row is not null and not exists (select 1 from public.content_rows c where c.id = p_team_row and c.workspace_id = p_workspace and c.collection = 'team' and c.deleted_at is null)
    then raise exception 'S-NOT-FOUND: not found'; end if;
  return (select u.id from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, ''))) limit 1);
end $$;

-- ---------- grants: closed to PUBLIC, anon and authenticated (the default privileges of migration 8 do it; these statements are the second layer) ----------
revoke all on function service.crm_secret_put(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function service.crm_secret_put(jsonb, uuid, text) to service_role, omnikom_fn;
revoke all on function service.crm_secret_drop(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.crm_secret_drop(jsonb, uuid) to service_role, omnikom_fn;
revoke all on function service.crm_target(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.crm_target(jsonb, uuid) to service_role, omnikom_fn;
revoke all on function service.crm_tested(jsonb, uuid, text, int, text) from public, anon, authenticated;
grant execute on function service.crm_tested(jsonb, uuid, text, int, text) to service_role, omnikom_fn;
revoke all on function service.find_login(jsonb, uuid, text, uuid) from public, anon, authenticated;
grant execute on function service.find_login(jsonb, uuid, text, uuid) to service_role, omnikom_fn;
