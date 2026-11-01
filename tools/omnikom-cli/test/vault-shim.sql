-- Test-only stand-in for Supabase Vault (the local cluster has none): enough for `key mint` (vault.create_secret), for a check that the
-- secret landed, and for migration 13's CRM secret functions (vault.update_secret, updated_at). The real thing is Supabase's vault
-- extension; this is a MODEL, UNVERIFIED against a project. It must stay a superset of the stand-in in supabase/tests/tenancy.test.sql
-- (T21): that file builds its own only when no vault schema exists, so on this cluster T21 runs against THIS one.
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text not null default '', secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
returns uuid language sql as $$ insert into vault.secrets (name, description, secret) values (new_name, coalesce(new_description, ''), new_secret) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description), updated_at = now() where id = secret_id $$;
-- what capture-lead reads (supabase/functions/capture-lead/index.ts joins vault.decrypted_secrets on the registry's vault_ref)
create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
