-- Omnikom Platform: work order 08 (Settings and account, block 4), migration 17. Additive to migrations 1 to 15 (16 is reserved for seo-read).
-- The Team card of the Settings screen (DP-1.6-01):
--  service.list_members(claims, ws)   who is in the workspace: user id, email (auth.users), role, team profile id and name, joined date.
--                                     Owner of the workspace or staff with the second factor only; anyone else, and a workspace that does not
--                                     exist, gets S-NOT-FOUND (the wall never says which).
--  service.invite_context(claims, ws)  the two facts of the invite mail (DP-email-10): the business's name and the inviter's name (their team profile's, else
--                                     their login's email); same wall as list_members. invite-member (the function role has no table grants) asks here.
-- Removing a person (DP-1.6-03) needs nothing new: service.remove_member (migration 8) is owner or staff only, never the last owner
-- (S-LAST-OWNER), audited as `member-remove`; the person's leads, edits and uploads stay. Their open sessions are not ended (Supabase Auth has
-- no admin logout by user id); every request is checked against `members`, so their next request in the workspace is refused (T24).
-- Security definer, set search_path = '', fully schema-qualified, closed to PUBLIC, granted to the function role only.
-- Tests: tenancy.test.sql T24 (walls) and run-local.mjs mutants "team17: ...".

create function service.list_members(p_claims jsonb, p_workspace uuid)
returns table (user_id uuid, email text, role public.member_role, team_row_id uuid, team_name text, joined_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  return query
    select m.user_id, u.email::text, m.role, m.team_row_id,
           (select v.data ->> 'name' from public.content_versions v join public.content_rows c on c.id = v.row_id
             where v.row_id = m.team_row_id and c.deleted_at is null order by v.n desc limit 1),
           m.created_at
      from public.members m join auth.users u on u.id = m.user_id
     where m.workspace_id = p_workspace
     order by (m.role = 'owner') desc, m.created_at, u.email;
end $$;

revoke all on function service.list_members(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.list_members(jsonb, uuid) to service_role, omnikom_fn;

-- ---------- the invite mail's two facts (DP-email-10: who invited you, to which business) ----------
-- service.invite_context(claims, ws): the business's name and the inviter's: their team profile's name, else their login's email. Owner of the
-- workspace or staff with the second factor only (S-NOT-FOUND otherwise). The function role has no table grants, so invite-member asks here.
create function service.invite_context(p_claims jsonb, p_workspace uuid) returns table (business text, inviter text)
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  return query
    select w.name::text,
           coalesce(nullif(btrim((select v.data ->> 'name' from public.members m join public.content_rows c on c.id = m.team_row_id and c.deleted_at is null
                                    join public.content_versions v on v.row_id = c.id where m.workspace_id = p_workspace and m.user_id = me order by v.n desc limit 1)), ''),
                    (select u.email::text from auth.users u where u.id = me))
      from public.workspaces w where w.id = p_workspace;
end $$;
revoke all on function service.invite_context(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.invite_context(jsonb, uuid) to service_role, omnikom_fn;
