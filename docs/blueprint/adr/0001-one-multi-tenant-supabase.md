# ADR 0001: One multi-tenant Supabase database

Status: Accepted (owner, DECISIONS 11, 2026-10-26). Date: 2026-10-28.

## Context
Every client needs auth, content, leads and files; we want one place to run, back up and secure. Earlier option: a spike of Supabase vs Cloudflare D1 (DECISIONS 5).

## Decision
One Supabase account with two projects (DECISIONS 15, 2026-10-28): **staging** (testing; every cloud acceptance) and **production**; each holds every workspace of its environment; no Docker, local checks run on plain Postgres with Supabase's defaults modelled; isolation by row-level security on workspace_id; Auth, Storage, Edge Functions, pg_cron from the same project.

## Considered Options
Cloudflare D1 (next to the sites, but no auth, no RLS, smaller SQL); one database per client (strong isolation, heavy to run and migrate); Firebase (no SQL, weaker relational model).

## Consequences
One schema and one migration path for all clients; the tenancy wall must be proven by tests (supabase/tests, 47 mutants) and reviewed on every migration (RLS checklist, 08-SECURITY.md); a single project is a blast radius: backups are our own, because the Free plan has no PITR: a nightly `pg_dump` of production to R2 plus a second copy at another provider, kept 30 days, a monthly restore drill into a throwaway local Postgres, recovery objectives D17 (at most 24 hours of data lost, back within 4 hours) (DECISIONS 29, 18-BUDGET-ARCHITECTURE.md 2.4, 11-OPERATIONS.md 3). Data-loss rollback: restore the last dump into a new project, verify with the tenancy tests, switch.
