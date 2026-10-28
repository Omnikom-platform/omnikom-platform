# ADR 0005: Content master copy in database rows with append-only versions

Status: Accepted (owner, DECISIONS 6). Date: 2026-10-28.

## Context
Today content lives inside HTML, so clients cannot edit it. Clients need history and rollback; staff need sign-offs on locked text.

## Decision
Generic content_rows + content_versions (jsonb data checked by the contract); save = new version; publish = pointer to a version; rollback = new version copying an old one.

## Considered Options
Git files as the source of truth (rejected by the owner); one table per collection (migration per client/industry); a headless CMS product (another vendor, per-seat cost, weaker tenancy fit).

## Consequences
No migration for new collections; validation must run in code (contracts/validate.mjs) because the DB cannot type-check jsonb per collection; jsonb indexes added per heavy query.
