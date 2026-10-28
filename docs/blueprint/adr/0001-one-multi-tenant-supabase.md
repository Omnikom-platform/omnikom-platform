# ADR 0001: One multi-tenant Supabase database

Status: Accepted (owner, DECISIONS 11, 2026-10-26). Date: 2026-10-28.

## Context
Every client needs auth, content, leads and files; we want one place to run, back up and secure. Earlier option: a spike of Supabase vs Cloudflare D1 (DECISIONS 5).

## Decision
One Supabase account with two projects (DECISIONS 15, 2026-10-28): **staging** (testing; every cloud acceptance) and **production**; each holds every workspace of its environment; no Docker, local checks run on plain Postgres with Supabase's defaults modelled; isolation by row-level security on workspace_id; Auth, Storage, Edge Functions, pg_cron from the same project.

## Considered Options
Cloudflare D1 (next to the sites, but no auth, no RLS, smaller SQL); one database per client (strong isolation, heavy to run and migrate); Firebase (no SQL, weaker relational model).

## Consequences
One schema and one migration path for all clients; the tenancy wall must be proven by tests (supabase/tests, 47 mutants) and reviewed on every migration (RLS checklist, 08-SECURITY.md); a single project is a blast radius: backups with PITR and a restore drill (11-OPERATIONS.md).
