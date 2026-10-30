-- Test-only stand-in for Supabase Vault (the local cluster has none): enough for `key mint` (vault.create_secret) and for a
-- check that the secret landed. The real thing is Supabase's vault extension; this is a MODEL, UNVERIFIED against a project.
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text not null, created_at timestamptz default now());
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
returns uuid language sql as $$ insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id $$;
-- what capture-lead reads (supabase/functions/capture-lead/index.ts joins vault.decrypted_secrets on the registry's vault_ref)
create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at from vault.secrets;
