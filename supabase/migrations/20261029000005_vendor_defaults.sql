-- Migration 5a: vendor defaults overridden (first staging run, 2026-10-29).
-- Finding on the real project: Supabase ships public.rls_auto_enable() (an event-trigger function, owner postgres, default ACL),
-- so `anon` had EXECUTE on one function in `public` and the N10 gate failed on staging while passing on plain Postgres. An
-- event-trigger function cannot be called by a client, so nothing leaked; the gate is kept strict and the grant removed.
-- Migration 1 revoked the default privileges for functions created AFTER it; this covers what the vendor created BEFORE it.
-- Rule: ground rule 1 (every wall explicit) and 23-GROUND-RULES 3 "Definer hygiene": no function in public is executable by anon.
-- Test: tenancy.test.sql N10 (failed on staging 2026-10-29 23:50, output in PROGRESS.md); mutant "vendor defaults kept" in run-local.mjs.
revoke execute on all functions in schema public from public, anon;
