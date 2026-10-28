-- Local stand-in for the parts of Supabase the migration uses, so it runs on plain Postgres for tests.
-- It is a MODEL of Supabase, not Supabase: the authority is the same tenancy.test.sql run on a real project (W0.3).
-- What it reproduces, and the source:
--  * auth.uid() / auth.jwt() from the request's JWT claims setting (the RLS guide tests policies by setting
--    request.jwt.claim.sub; https://supabase.com/docs/guides/database/postgres/row-level-security)
--  * Supabase's DEFAULT privileges: EXECUTE on new functions and ALL on new tables in schema public for anon, authenticated and
--    service_role (https://supabase.com/docs/guides/database/functions "any role can call it by default, including anon";
--    https://supabase.com/docs/guides/troubleshooting/custom-role-inherits-privileges-that-were-not-explicitly-granted-ddaa1c).
--    Without these defaults the local tests would pass walls that leak on Supabase (fact-check S1, 2026-10-28).
--  * storage.buckets / storage.objects / storage.foldername() as used by Storage access-control policies
--    (https://supabase.com/docs/guides/storage/security/access-control).
do $$ begin   -- roles are cluster-wide: create once, reuse for every test database
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Supabase's default grants in public (the thing the migration must override explicitly)
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Storage (minimal model)
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Realtime publication (Supabase creates it in every project)
create publication supabase_realtime;
