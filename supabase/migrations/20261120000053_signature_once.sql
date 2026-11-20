-- Omnikom Platform: SEC-REPLAY (method 6 of the twenty methods), migration 53. Additive to migrations 1 to 52: one table, one function.
-- A signed machine call (_shared/signature.ts) was accepted for 300 s either side of its time, as often as it was sent. The first copy now claims its signature here; a later copy finds the claim.
-- The key is sha256 of the 64-hex v1 value (never the header text: verify reads t as a number, so t with leading zeros verifies too). A header is accepted from t - 300 s to t + 300 s: a claim lives 11
-- minutes, the last 60 s are for two clocks. Each claim first deletes at most 100 claims past their time (index signature_seen_expires; rows another call holds locked are skipped, so no claim waits).
-- Schema private: row level security ON, no policy, no grant to any role; only this definer function reaches it (T14 reads schema public only). Tests: tenancy.test.sql T51; mutants "sig51".
set lock_timeout = '5s';
create table private.signature_seen (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);
create index signature_seen_expires on private.signature_seen (expires_at);
alter table private.signature_seen enable row level security;
revoke all on private.signature_seen from public, anon, authenticated, service_role, omnikom_fn;
create function service.claim_signature(p_hash text) returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with old as materialized (select s.hash from private.signature_seen s where s.expires_at < now() order by s.expires_at limit 100 for update skip locked) delete from private.signature_seen d using old where d.hash = old.hash;
  insert into private.signature_seen (hash, expires_at) values (p_hash, now() + interval '11 minutes') on conflict (hash) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function service.claim_signature(text) from public, anon, authenticated;
grant execute on function service.claim_signature(text) to service_role, omnikom_fn;
