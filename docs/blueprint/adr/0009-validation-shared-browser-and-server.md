# ADR 0009: One validation library in the browser and the Edge Functions

Status: Accepted (this blueprint). Date: 2026-10-28.

## Context
Rules must be identical where the user types and where the server decides; contracts/validate.mjs is already tested with 82 mutants.

## Decision
Import contracts/*.mjs unchanged in the dashboard and in the Deno functions; the database enforces the walls (workspace, role, own-only, locks).

## Considered Options
Separate Zod schemas per side (drift); validation only in the database (no per-collection typing in jsonb).

## Consequences
contracts/ must stay dependency-free ES modules runnable in Node, Deno and browsers.
