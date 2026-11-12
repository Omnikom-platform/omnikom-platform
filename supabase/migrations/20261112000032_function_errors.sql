-- Omnikom Platform: product row E3, part a, migration 32. Additive to migrations 1 to 31; adds one table and one function.
-- No function reported its errors and no log line named its call: a 500 was a console line in Supabase's log and nothing else, so "how often does a
-- function fail" was not answerable from our tables (supabase/ops/README.md). Every function now serves through withRequestId (_shared/http.ts): each call
-- gets a request id (the header x-request-id, request_id in a problem body, the first word of every log line of the call), and an answer of 500 to 599
-- calls service.record_function_error(function, status, request id):
--  1. function_errors: one row per function folder name, status and minute with the count of 5xx answers and the newest request id. Nothing stores a cause
--     or a value: the request id finds the call's log lines. Written only by the definer function below; staff with MFA read it.
--  2. The table keeps 30 days and is cleaned as it is written (as visitor_counts, migration 30): each call first deletes the rows older than 30 days. It is
--     not a retention rule of service.purge_expired (migration 28 keeps its seven rules).
-- The alert on these rows and its mail are row E3's part b. Staging is UNPROVEN until the head's run sheet.
-- Tests: tenancy.test.sql T38 and the run-local.mjs mutants "errors32: ..."; the functions: supabase/functions/test/request-id.test.ts [E3].

set lock_timeout = '5s';

create table public.function_errors (
  fn text not null check (fn ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(fn) <= 60),   -- the function's folder name
  status int not null check (status between 500 and 599),
  minute timestamptz not null,                              -- date_trunc('minute', now()) of the count
  n int not null default 1,
  last_request uuid not null,                               -- the request id of the newest error counted here
  last_at timestamptz not null default now(),
  primary key (fn, status, minute)
);
create index function_errors_minute on public.function_errors (minute);   -- the 30-day delete and a read by time
alter table public.function_errors enable row level security;
create policy function_errors_staff_read on public.function_errors for select to authenticated using (private.is_staff());
-- Supabase gives service_role ALL on a new table by default: only the definer function below writes this table (it is not append-only: n is updated)
revoke all on public.function_errors from public, anon, authenticated, service_role, omnikom_fn;
grant select on public.function_errors to authenticated;

create function service.record_function_error(p_fn text, p_status int, p_request uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.function_errors e where e.minute < now() - interval '30 days';
  insert into public.function_errors (fn, status, minute, last_request) values (p_fn, p_status, date_trunc('minute', now()), p_request)
    on conflict (fn, status, minute) do update set n = public.function_errors.n + 1, last_request = excluded.last_request, last_at = now();
end $$;
revoke all on function service.record_function_error(text, int, uuid) from public, anon, authenticated;
grant execute on function service.record_function_error(text, int, uuid) to service_role, omnikom_fn;
