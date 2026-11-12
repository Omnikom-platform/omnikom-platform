-- Omnikom Platform: row E11 (audit H1-7), migration 43. Additive to migrations 1 to 41; adds one table and one function and replaces one function.
-- Staff with MFA read every tenant through RLS (private.is_staff(), migration 8) and audit rows came only from service functions, so no staff read was
-- recorded. Now a staff login acts as staff only inside a window of its own: private.is_staff() also asks for a staff_access row of the login whose
-- until has not passed. A window is opened only by service.staff_open(claims, reason, minutes): staff with MFA, a reason of 10 to 200 characters,
-- 1 to 240 minutes (the table allows at most 4 hours), and one audit_log row (staff-access-open) with the reason each. One function changes and no
-- policy changes: every staff path (the select policies, private.can_see, the service functions) asks private.is_staff().
-- Windows are kept 365 days (the period of security_events) and cleaned as staff_open writes, not by service.purge_expired (the head's choice, no source).
-- No Edge Function calls staff_open (no staff screens, docs/product/8-routing.md): staff tools call it through the database.
-- Tests: tenancy.test.sql T39 and the mutants "staff43: ..." in supabase/tests/run-local.mjs (--only "staff43").
set lock_timeout = '5s';
create table public.staff_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff(user_id) on delete cascade,
  reason text not null check (length(reason) between 10 and 200),
  opened_at timestamptz not null default now(),
  until timestamptz not null,
  constraint staff_access_box check (until > opened_at and until <= opened_at + interval '4 hours')
);
create index staff_access_user_until on public.staff_access (user_id, until desc);
alter table public.staff_access enable row level security;
create policy staff_access_own on public.staff_access for select to authenticated using (user_id = (select auth.uid()));
-- Supabase gives service_role ALL on a new table by default: only the definer function below writes this table
revoke all on public.staff_access from public, anon, authenticated, service_role, omnikom_fn;
grant select on public.staff_access to authenticated;

-- W: staff only inside an open window of their own (the signature and settings of migration 8)
create or replace function private.is_staff() returns boolean language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from public.staff where user_id = (select auth.uid())) and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' and exists (select 1 from public.staff_access a where a.user_id = (select auth.uid()) and a.until > now()) $$;

-- O: open a window, with a reason, and audit it
create function service.staff_open(p_claims jsonb, p_reason text, p_minutes int default 60) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare me uuid; v_until timestamptz;
begin
  me := service.use_claims(p_claims);
  if not coalesce(exists (select 1 from public.staff s where s.user_id = me) and (select auth.jwt() ->> 'aal') = 'aal2', false) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 200 then raise exception 'I-ANSWER reason: Give a reason of 10 to 200 characters.'; end if;
  if p_minutes is null or p_minutes not between 1 and 240 then raise exception 'I-ANSWER minutes: From 1 to 240 minutes.'; end if;
  delete from public.staff_access a where a.until < now() - interval '365 days';
  v_until := now() + make_interval(mins => p_minutes);
  insert into public.staff_access (user_id, reason, until) values (me, btrim(p_reason), v_until);
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (null, me, 'staff-access-open', me::text, jsonb_build_object('reason', btrim(p_reason), 'minutes', p_minutes));
  return v_until;
end $$;
revoke all on function service.staff_open(jsonb, text, int) from public, anon, authenticated;
grant execute on function service.staff_open(jsonb, text, int) to service_role, omnikom_fn;
