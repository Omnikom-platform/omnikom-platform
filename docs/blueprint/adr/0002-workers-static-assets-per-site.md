# ADR 0002: One Cloudflare Worker with static assets per client site (not a Pages project)

Status: Proposed (owner to confirm, decision D2). Date: 2026-10-28.

## Context
DECISIONS 7/11 and TENANCY say "one Cloudflare Pages project per site". Since 2026-10-23 the Omnikom account cannot create new Pages projects (API "unknown error", planning/CONTEXT.md; UNVERIFIED: no raw error or token permission list was kept, and an Editor-scoped token cannot create resources, so the cause may be the token; W0.4 reproduces it once and records both); Rainmaker production runs as a Worker with static assets with _headers, _redirects and 404 proven (tools/worker-smoke.mjs).

## Decision
Each site deploys to its own Worker (static assets + a small script for /api/lead); preview on a noindex host; the client domain is attached last.

## Considered Options
Pages projects (blocked on this account); one Worker serving every site by hostname (one deploy affects all clients); another host (Netlify/Vercel: a second vendor, against DECISIONS 7).

## Consequences
Same per-site isolation and rollback (Workers versions, rollback to any of the last 100); a per-site deploy token with the Editor role on that one Worker is supported (https://developers.cloudflare.com/workers/authorization/); creating Workers needs Admin at the Workers product scope (staff onboarding only); W1.6 tests that A's job cannot deploy to B; wording in TENANCY changes from "Pages project" to "Worker". Sources checked 2026-10-28: Cloudflare Pages docs advise new projects to start on Workers (https://developers.cloudflare.com/pages/), Pages is not marked deprecated.
