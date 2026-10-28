# ADR 0010: Omnikom staff as a platform table, not a client role

Status: Accepted (TENANCY 2). Date: 2026-10-28.

## Context
Staff see every workspace and sign off locked text; mixing that into per-workspace roles makes RLS harder to review.

## Decision
A staff table checked by is_staff(); every staff action audited; MFA required.

## Considered Options
A staff role per workspace (must be added to every workspace; easy to miss); the service role in the dashboard (bypasses RLS: never in a browser).

## Consequences
Policies read is_staff() or can_see(); staff impersonation is read-only "view as".
