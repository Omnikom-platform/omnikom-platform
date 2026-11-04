# BUILD GUIDE: Omnikom Platform (read this first)

You are a new team (or a new Claude account) building the Omnikom Platform from this repo, without the conversations that
produced it. This folder is the whole map. Status 2026-10-28: **design complete, core schema and content contract tested; no
application code yet.**

## What you are building, in five lines
A platform that replaces services like Luxury Presence for any local business: it researches a business's online presence,
builds it a search-correct website from an approved SEO plan and an approved design, hosts it on Omnikom's Cloudflare account,
and gives the client a dashboard to edit content, add listings/products/articles, see leads and search numbers, and publish.
One procedure for every industry; the client's collections come from its own plan. First client on it: Example A Realty Group.

## Read in this order
| # | File | What you get |
|---|---|---|
| 0 | `docs/blueprint/STANDARDS.md` | every published standard the blueprint follows (version, source URL checked 2026-10-28, where applied, how checked, deviations, UNVERIFIED items) |
| 1 | `planning/DECISIONS.md` | what the owner settled (do not re-open) |
| 2 | `docs/blueprint/06-PRD.md` | problem, users, goals/non-goals, FR-1..24, NFR-1..13, **traceability FR/NFR -> work order -> test** |
| 3 | `docs/blueprint/01-ARCHITECTURE.md` | C4 context / containers / components, publish sequence, data flow, environments, security and tenancy |
| 4 | `docs/blueprint/adr/` | 12 architecture decision records (accepted + proposed) |
| 5 | `contracts/README.md` | the content contract both the site build and the dashboard use (already built and tested) |
| 6 | `docs/blueprint/02-BACKEND.md` | Supabase schema, RLS, functions, storage, runner, secrets, CI |
| 7 | `docs/blueprint/07-SPECS.md` + `specs/openapi.json` | ERD, API (OpenAPI 3.1), jobs and events, error codes |
| 8 | `docs/blueprint/08-SECURITY.md` | STRIDE threat model, secrets management, RLS review checklist |
| 9 | `docs/blueprint/03-FRONTEND.md` | website factory (templates, renderer, gates) and the dashboard app (stack, routes, widgets) |
| 10 | `docs/blueprint/04-DASHBOARD.md` | every dashboard screen and flow, with wireframes |
| 11 | `docs/blueprint/09-TEST-STRATEGY.md` | test pyramid, required gates (mutants), e2e flows, load targets, definition of done |
| 12 | `docs/blueprint/10-DELIVERY.md` | monorepo, branching + reviews, CI stages, environments, migrations, releases, rollback, flags |
| 13 | `docs/blueprint/11-OPERATIONS.md` | observability, alerts, runbooks R1-R5, backup/restore drill, on-call |
| 13b | `docs/blueprint/12-LAUNCH.md` | launch pipeline: preview to production through one ledger (`launch.json`), its checks and its stop condition (SOP `sops/clients/launch.md`) |
| 13c | `docs/blueprint/13-DATA-MODEL.md`, `14-LEAD-PATH.md`, `15-CRM.md` | step C in plain words: every table and who writes it; the lead path form -> site Worker -> signed capture -> database -> alert, push, CRM screen; the four-screen client CRM, entries by hand, publish with the gates (DECISIONS 21) |
| 13d | `docs/blueprint/16-DESIGN-PARTS.md` | every part to design (each screen, button, click, state, failure), the preview design (instant in-editor, preview site, compare), the invariants and the failure table |
| 13e | `docs/blueprint/17-EXPANSION-MAP.md`, `18-BUDGET-ARCHITECTURE.md` | how the platform grows (AI concierge, booking, SMS and email, CRM export and import with a mapping wizard, setup wizard; white label withdrawn by DECISIONS 31) and the free-tier limits with sources, what the design does to stay inside, the measured upgrade triggers (DECISIONS 22, 23) |
| 13f | `docs/blueprint/19-CODE-MANIFEST.md` | every artifact to produce in code (migrations, 20 Edge Functions, Workers, workflows, factory, dashboard modules, tools): in and out, how it compiles and deploys, how it is proven, BUILT / SPEC / BLOCKED |
| 13g | `docs/blueprint/20-SHAPE.md` | the shape: one GitHub repo as the build runner and how promotion works; one Cloudflare account with a Pages project per site and a zone per client domain; every crossing between the parts with its credential; environments |
| 13h | `docs/blueprint/21-PROTOCOLS.md`, `22-SEARCH-AND-ANALYTICS.md`, `REVIEW-2026-10-29.md` | the vendor-sourced protocols between platform, GitHub and Cloudflare with what the first real project must prove; Search Console, analytics and speed data wired into the launch and the dashboard; the fresh-eyes review findings and their fix status |
| 13i | `docs/blueprint/25-BUILD-SEQUENCE.md` | the hand-in-hand sequence: step 1 the accounts with every setting (owner), step 2 the lead-path proof on staging, then hardening leftovers, the build machine, the dashboard, production, the Example A launch, add-ons when sold; each with its "done when" |
| 13j | `docs/blueprint/26-PLATFORM-CLI.md` | the `omnikom` command-line client: the harness sessions test with (every endpoint with expectations, the wall suite over HTTP), the staff tool (seed, keys, onboarding), built in three slices |
| 14 | `docs/blueprint/05-BUILD-PLAN.md` | milestones M0-M5, work orders with acceptance tests, estimates, critical path, RACI, risks, open decisions |
| 15 | `planning/CONTEXT.md` | lessons from three real client sites (Cloudflare, forms, speed, design rules) |
Background only: `planning/ANALYSIS.md`, `planning/REQUIREMENTS.md`, `planning/TENANCY-AND-PUBLISHING.md`, `planning/CONTRACT.md`.

## What already exists and is proven (run these first; all must pass on your machine)
```
node contracts/test/run.mjs              # content contract: 138 checks
node contracts/test/mutate.mjs           # 82 broken copies of the contract code, all must be caught
node contracts/industry-run/run.mjs      # the same procedure on 15 industries
node supabase/tests/run-local.mjs        # core schema + RLS walls on a throwaway local Postgres 15+, plus 47 wall-removal mutants
node docs/blueprint/specs/check-specs.mjs  # OpenAPI refs resolve + every work order traced to a requirement
node docs/blueprint/diagrams/render.mjs  # re-render the diagrams (Edge or Chrome, internet for the pinned Mermaid CDN)
```
Expected output lines are in `docs/blueprint/PROGRESS.md` (latest run) and `contracts/README.md`.

**Environments (DECISIONS 15):** no Docker. Local checks run on plain Postgres with Supabase's defaults modelled; one Supabase
account with two projects: **staging** (every cloud acceptance) and **production** (only migrations proven on staging, owner-approved).

## What is NOT built (your job)
Supabase projects and Edge Functions, the factory renderer and design packages, the build runner workflow, the dashboard app,
lead push and metrics pulls, the Presence Report engine, AI operators, self-serve signup. Order and acceptance tests:
`05-BUILD-PLAN.md`. Before M0 the owner answers decisions D1-D4 there (Supabase org, Cloudflare token + Workers vs Pages,
domains, GitHub org for the build).

## Non-negotiables (from the owner; each traced to something that went wrong)
1. **Done means observed.** A command ran and its pasted output says so, or the page rendered and someone looked. Write NOT DONE,
   UNPROVEN, BLOCKED plainly. Every new test is watched failing once.
2. **The tenancy wall is in the database.** RLS on every table; content writes only through the functions; a workspace in a
   request is only a claim, checked against membership; a build reads one job's frozen snapshot only.
3. **Facts carry their source.** No invented reviews, numbers, licences or results on client sites; unsourced facts cannot publish.
4. **Locked text** (licences, disclosures, consent) changes only by Omnikom staff with a recorded sign-off.
5. **Public data only, politely.** No logins on other sites, no paid data APIs, never bypass a CAPTCHA, one HTTP 429 = stop that
   host; never submit forms on a client's live site.
6. **Outward actions need the owner's click**: sending email, DNS changes, publishing live, payments, account settings.
7. **Design is never swapped silently**; animate transform/opacity only; whitespace first; phone layouts left-aligned except hero,
   section headers, closing panels and footer (`planning/CONTEXT.md` design rules).
8. **Never name another client on a client site;** client content never crosses projects.
9. **Supply chain:** read `~/.claude/reference/supply-chain-2026-10.md` before adding any dependency (that path is on the
   original machine; the new team keeps an equivalent rule: pinned versions, lockfile, no package younger than 7 days).

## Who decides what
Abdo (CTO, the owner of this repo): technical decisions and sign-offs. Dave (CEO): business decisions and the client
relationship; client emails go through him. Questions to the owner as pickable options with a recommendation first.

## Where things are
| Thing | Path |
|---|---|
| Content contract + tests | `contracts/` |
| Core schema + tenancy tests | `supabase/migrations/`, `supabase/tests/` |
| Diagrams (source + PNG/SVG) | `docs/blueprint/diagrams/` |
| Dashboard wireframes | `docs/blueprint/wireframes/` |
| SEO / build skill (plan, gates, snapshot, research) | `skills/programmatic-enterprise-web-performance/` |
| Design method | `skills/design-tournament/` |
| SOPs (backup, audit team, credentials, listings feed, launch) | `sops/` |
| Example A approved plan + design (outside this repo, read only) | `E:\Agent A\site-checks\example-a.example\.pewp\approved`, `E:\Agent A\draft-site\design\variants\v4.html` |
| Example C / Example D sources (outside, read only) | `E:\Example C\site-src`, `E:\Agent D & Example B\proposals\example-d` |
The `E:\` client folders live on the owner's machine; a team on another machine gets copies from the owner (never mix them).
