-- Omnikom Platform: book row C19 (map row L4), migration 52. Additive: one function. Until now only tests wrote sites.state.
-- service.set_site_state: staff with MFA inside an open window (migration 43) move a site along four moves, with a reason of 10 to 200 characters; a business
-- that is suspended, offboarding or deleted cannot have a site go live; one audit_log row each. Tests: tenancy.test.sql T52; mutants "sitelive52:".
create function service.set_site_state(p_claims jsonb, p_site uuid, p_state public.site_state, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid; s public.sites; w public.workspaces; ok boolean;
begin
  me := service.use_claims(p_claims);
  if not coalesce(private.is_staff(), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  if length(btrim(coalesce(p_reason, ''))) not between 10 and 200 then raise exception 'I-ANSWER reason: Give a reason of 10 to 200 characters.'; end if;
  select * into s from public.sites where public.sites.id = p_site for update;
  if s.id is null then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := coalesce((s.state, p_state) in (('preview', 'live'), ('live', 'paused'), ('paused', 'live'), ('paused', 'preview')), false);
  if not ok then raise exception 'S-SITE-STATE: % -> % is not allowed', s.state, p_state; end if;
  select * into w from public.workspaces where public.workspaces.id = s.workspace_id;
  if p_state = 'live' and not (w.state in ('trial', 'active')) then raise exception 'S-WORKSPACE-STATE: % is %: its site does not go live', w.slug, w.state; end if;
  update public.sites set state = p_state where public.sites.id = p_site;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (s.workspace_id, me, 'site-' || p_state, p_site::text, jsonb_build_object('from', s.state, 'reason', btrim(p_reason)));
end $$;
revoke all on function service.set_site_state(jsonb, uuid, public.site_state, text) from public, anon, authenticated;
grant execute on function service.set_site_state(jsonb, uuid, public.site_state, text) to service_role, omnikom_fn;
