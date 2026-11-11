# 44 overview and metrics wiring (B20, B21, C16)

Owner: platform-build (head `HEAD_Platform-build_2026-11-09`). Builder session: `overview-metrics` worktree on master 9b0bb8a.
Status 2026-11-11 07:55: CHECKPOINT 1 COMMITTED by the head (migration 27 + C16, CI pending); the screen, B20 and B21, is NOT STARTED and is held (new work is
frozen, week at 78%). The HANDOVER section at the end of this file says what to do next.
Head's answers: 1a (the Overview carries the numbers; Search health page becomes a named follow-up row), 2a (pg_cron + pg_net + Vault; the Vault
entries `metrics_cron_key` and `project_url` are a head step on staging), 3a (factory key file is work order 45), 4 and 5 yes. Shared files Shell.tsx and
router.tsx are mine for this order.

## Checkpoint 1: what ran and what did not (pasted output is in the report to the head)
RAN here: deno check of every function and the test file (exit 0); migration lint (0 findings, 0 new waivers); check-specs (0 problems) and its test
(42 checks); the metrics function tests 19 of 19 (before two later edits, see below); icm index and book check; gitleaks protect --staged (no leaks).
NOT RUN, UNPROVEN: `supabase/tests/run-local.mjs` on the final migration (the run before the last edit found that the cron pair stayed open to the
function role through default privileges; fixed by an explicit revoke, the rerun was stopped by the head); the 31 `metrics27` mutants of run-local and the
23 function mutants (never finished here; CI's); the function tests after the last two edits (fake key values renamed so the scanner stays quiet);
everything on staging.

## Why
Book rows B20 Overview, B21 Search and AI visibility numbers, C16 Metrics pull and sitemap submit are MISSING
(`docs/product/1-product.md:91,92,113`). SEO's collectors are on master in `tools/audit/metrics/` (work order 33). The table
`metrics_snapshots` is empty and nothing writes it; `/w/$ws` redirects to leads (`apps/dashboard/src/router.tsx:72`).

## What I read (so the plan stands on files, not memory)
- Table: `supabase/migrations/20261028000001_platform.sql:156-161` (PK workspace, source, day; CHECK `source in ('search-console',
  'pagespeed', 'ai-answers', 'uptime')`); read wall `metrics_read` (`:238`, `private.can_see`), already in the T14 loop and has a mutant
  (`supabase/tests/run-local.mjs:167`). No write grant for the function role: a writer must be a `service.*` function.
- Collectors: `tools/audit/metrics/` `SOURCES = search-console, pagespeed, bing, ai-answers` (`util.mjs:4`). **The only value the CHECK
  lacks is `bing`** (`uptime` stays, nothing writes it). Collector contract: `{ fetch, keys, workspaceId, day, ... }` returns
  `{ row, calls, notes }`, no `node:`, no env; BLOCKED rows carry `data.blocked = { reason, unblock }`; `appendIndexNow` appends a ping
  to the day's bing row.
- Functions load repo code by a relative import that the Supabase bundler follows: `supabase/functions/_shared/crm-map.ts:4` re-exports
  `tools/crm-map/map.mjs` and `crm-map-propose` is deployed on staging that way. I use the same shape (`_shared/metrics.ts` re-exports
  the collectors). `deno task check` must cover it.
- Machine calls verify `X-Runner-Signature`-style HMAC (`_shared/signature.ts`, `docs/product/4-backend.md:12`), not an
  `X-Internal-Secret` header (`sops/site-endpoints.md:154` is older; the book wins). `config.toml:32-37` already has `metrics-pull` and
  `sitemap-submit` as planned, `verify_jwt = false`.
- Cron: the reaper shows the pattern (`20261109000019_reaper_schedule.sql`): `cron.schedule` named, guarded by
  `to_regprocedure('cron.schedule(text,text,text)')`, a notice when pg_cron is absent (local and CI have none).
- Dashboard: Shell tabs `apps/dashboard/src/pages/Shell.tsx:40-44`, routes in `router.tsx`, plan gate `apps/dashboard/tests/plan-gate.mjs`
  (every fixed word is in a `16-DESIGN-PARTS.md` row; `built-slices.json` lists built slices), `styles.spec.ts` has the 390 and laptop
  sizes. `16-DESIGN-PARTS.md` has **no Overview rows**; DP-1.4-03 is the Search card, slice "later".
- Book: `docs/product/6-dashboard.md:105-139` describes TWO screens: Overview at `/w/$ws` (site state, last publish and by whom, leads this
  week, changes waiting, a to-do list from real checks, optionally the Search health headline) and Search health at
  `/w/$ws/sites/$site/search` for the owner (site check, check history, AI questions, visibility, monthly report).

## Decisions I need (head answers; my default is the first option)
1. **One screen or two.** The work order puts B21's numbers on the overview; the book has a separate owner-only Search health page.
   (a) Overview only: it carries the site-check headline and a Visibility block, and I edit 6-dashboard.md in place to say so (smaller).
   (b) Build both (the page adds a route, a layout and about a third more work).
2. **Cron secret.** pg_cron reaches a function through pg_net and must sign the call; the secret has to be in Supabase Vault and the
   function secrets. (a) pg_cron + pg_net + Vault, guarded like the reaper (matches `2-architecture.md:118`); UNPROVEN until staging has
   the Vault entry (an owner-side step, named below). (b) A scheduled GitHub Actions workflow signs the call with the runner key
   (no Vault; Actions had an outage on 2026-11-09).
3. **IndexNow key file.** A ping needs the site to host `/<key>.txt`; the factory writes no such file and the key has no home.
   (a) 44 builds and tests the ping with a key passed in, and the publish records "IndexNow not sent: the site hosts no key file";
   the key file is a separate factory slice (proposed work order 45). (b) 44 also adds the derived key and the factory file (touches
   `factory/`, adds a gate and mutants, roughly 2 to 3 more points).
4. **Rows are per workspace, not per site** (PK has no site). I measure the workspace's live site, else its preview site, and write
   `data.site` so a row says which; a workspace with two sites shows the first. Stated on screen. Say if you want it otherwise.
5. **Who sees what.** `metrics_snapshots` is readable by any member; `site-audit` is owner (and staff with MFA) only. Members see the
   state, last publish and leads blocks; the Search blocks show only to the owner. Default as stated.

## Scope (what 44 builds)
1. **Migration 27** `supabase/migrations/20261111000027_metrics_sources.sql`: replace the source CHECK with one that adds `bing`
   (`lock_timeout`, `ADD CONSTRAINT ... NOT VALID`, `VALIDATE CONSTRAINT`, old check dropped after; lint L2 green, no waiver). Same file
   (new functions on an existing table are not lint findings): `service.metrics_targets()` (live or preview sites with host, domain,
   workspace), `service.metrics_put(workspace, source, day, data)` (upsert by the PK, refuses a source not in the list, `security
   definer`, `search_path = ''`, grant to `omnikom_fn` only), `service.metrics_day_row(workspace, source, day)` (read back, for the
   IndexNow append), and the guarded cron schedule `metrics-pull-daily` at 03:30 UTC (decision 2a). No new index (the PK covers every
   read), so no `-- no-transaction` file.
2. **C16** `supabase/functions/metrics-pull/` and `supabase/functions/sitemap-submit/`, `_shared/metrics.ts`, `config.toml` marks turned
   from "planned" to real, `openapi.json` and the check-specs counts updated, `docs/product/4-backend.md` rows.
   - `metrics-pull` (signed, one workspace per call): loads the target, writes `search-console` (BLOCKED row, "no verified property",
     fixtures only, its line says so), `pagespeed` (weekly: Monday, or no row in 7 days; five pages from the site's sitemap, home first,
     then a paced pick; CrUX inside it) and `bing` (daily stats, or BLOCKED without `BING_WEBMASTER_KEY` or a verified site). Keys by
     name from the function environment: `PSI_API_KEY`, `CRUX_API_KEY`, `BING_WEBMASTER_KEY`. 429 or 403 from a host stops that source.
   - `sitemap-submit` (signed, called by `job-callback` after `done` of a production job, best effort, never fails the callback): Search
     Console submit is BLOCKED (no property); Bing sitemap/IndexNow per decision 3; appends the ping to the day's `bing` row.
   - `ai-answers`: no writer in 44. The collector takes captures and DECISIONS 38 forbids a model call in runtime, so there is no
     source for captures yet. The Visibility block shows an AI card only when a row exists. NOT DONE, named in the report.
3. **B20 and B21 screens** `apps/dashboard/src/pages/Overview.tsx` (+ module css), `lib/overview.ts` (pure: numbers, dates, plain
   wording, tested), a data hook file of its own (not `data.ts`, to stay clear of order 39). Reads `metrics_snapshots` through RLS and
   `site-audit` through the function. Shows: site state and last publish and by whom, leads this week, changes waiting, the site-check
   headline ("Checked <date>: <n> of <m> checks pass"), problems in the words of `byTopic`, the Visibility block (Search Console,
   Bing, PageSpeed phone, CrUX) each with source and date; "not connected yet: <what unblocks it>" for a BLOCKED source; a card with no
   input is not shown (book rule). New plan rows in `16-DESIGN-PARTS.md` (new section for the overview, ids not yet used), added to
   `built-slices.json` with the build.
4. **Shared files I must touch, which you asked to hear about:** `apps/dashboard/src/pages/Shell.tsx` (an Overview tab, and the
   workspace switcher's target), `apps/dashboard/src/router.tsx` (the index route stops redirecting; decision 1b adds a route). I do not
   touch `Lead*`, `BulkBar`, `lib/leads.ts`. Say if order 39 is also in `router.tsx` or `Shell.tsx`.

## Proofs (each new assertion is watched red first)
- Migration: `node tools/migration-lint/lint.mjs` exit 0 with no new waiver; local apply through `supabase/tests/run-local.mjs` is CI's.
- Tenancy test (`supabase/tests/tenancy.test.sql`, next T number): member of A reads A's rows only, not B's; `bing` accepted, `x` refused;
  `metrics_put` and `metrics_targets` not callable by `anon` or `authenticated`; an upsert on the same (workspace, source, day) leaves one
  row. Mutants in `run-local.mjs` for: the CHECK without `bing`, `metrics_put` dropping the source guard, grants widened, search_path unset.
  T14 stays green (structural).
- Function tests `supabase/functions/test/metrics.test.ts` (Deno, fake `fetch`): unsigned or stale signature 401; no key gives BLOCKED
  rows and no request; 429 stops that source; a rerun the same day overwrites; the weekly rule (Tuesday with a row 2 days old: no
  PageSpeed call); IndexNow appends and never stores the key; no key value in any row, call or note. Mutants in
  `supabase/functions/test/mutate.mjs` for each.
- vitest on `lib/overview.ts` and the data hook's pure parts.
- Plan gate: `apps/dashboard/tests/plan-gate.test.mjs` for the gate itself is unchanged; the gate run over the new screen is the proof.
- `styles.spec.ts`: Overview at 390 px and laptop (a "styled" assertion and a no-horizontal-scroll check, watched red). The 390 px
  look is shown to you, with the heavy lock, only when you say; the owner judges the phone view.
- `gitleaks protect --staged` before you commit. I do not commit or push.
- Not run locally (CI's): run-local, full mutate, all flows, `run-all-gates.mjs`.

## Staging steps (yours; I never touch staging)
1. Apply migration 27 (it needs migrations 25 and 26 in order; 26 is Clients').
2. Deploy `metrics-pull`, `sitemap-submit`, and **`job-callback`** (it now calls the second) with `tools/deploy-functions.mjs`;
   secrets by name: `PSI_API_KEY`, `CRUX_API_KEY`, `BING_WEBMASTER_KEY`, plus the signing key the cron uses.
3. Redeploy the staging dashboard in the same step (charter rule): the overview reads the table and `site-audit`.
4. Owner side, decision 2a: the Vault entry for the cron signing key. Until it exists the schedule file notices and does nothing.
5. Proof on staging: e2e and flows, then one signed `metrics-pull` for the test workspace; the rows it writes, pasted; the overview at 390 px.

## UNPROVEN or NOT DONE from the start (stated now, not at the end)
- Search Console: fixtures only, no verified property. IndexNow live ping: no key file on any site. Bing: live only if a verified site
  exists for the key (SEO found none). AI answers: no writer. Cron on staging: needs the Vault entry. Monthly report on screen: not 44.
- 5-P4's ai-answers validator CHECK (`platform-build.md:127-132`) is not in migration 27 and not in the work order; I leave it out.

## Usage estimate
No order of this size has points measured in the repo (`pace.mjs --dir` on `work/18` and `work/20` reports only file times, 1 file each).
Proxy: order 20 (migration, functions, screens, e2e) ran from the first to the last commit 2026-11-10 22:34 to 2026-11-11 04:36, about 6 h
of wall time, and I cannot turn that into weekly points. My range, not a measurement: **8 to 14 points** for decisions 1a, 2a, 3a; **+3 to 5**
for 1b; **+2 to 3** for 3b. The upper end is above your 10-point line, so I stop here and ask. Week now 67%; 95% is the stop.
Cheapest honest cut if you want it under 10: build C16 plus migration 27 first (function tests, tenancy, mutants), the screen as a
second order.

## HANDOVER (2026-11-11 07:55; new work is frozen by the head of operations, week at 78%, clean pause near 93%)

### Done and committed by the head (branch `check/platform/overview-metrics`, CI pending)
Migration 27 and C16, as in the checkpoint report. Files: `supabase/migrations/20261111000027_metrics_sources.sql`;
`supabase/functions/metrics-pull/`, `sitemap-submit/`, `_shared/metrics.ts`, `_shared/sitemap.ts`; `job-callback` (sitemap step) and `_shared/runner.ts`
(options `keyEnv`, `header`); tests `supabase/functions/test/metrics.test.ts`, tenancy T34 and T25, 31 `metrics27` mutants in `supabase/tests/run-local.mjs`,
23 `metrics` mutants in `supabase/functions/test/mutate.mjs`; `openapi.json`, `check-specs.test.mjs`, `config.toml`, `deno.json`; book `3-database.md`,
`4-backend.md`, `7-sites.md`, row C16 PARTLY (counts C 13/4/0, total 59/26/10 of 95). Decisions fixed by the head: 1a, 2a, 3a, 4 yes, 5 yes (top of this file).

### UNPROVEN (named, nothing hidden)
- CI must prove: the tenancy run on the FINAL migration (T34 and the grant fix), the 31 `metrics27` mutants, the 23 function mutants. None finished here; the
  `caught` lines of the stopped run were printed on a failing baseline and do not count.
- The 19 function tests passed before two later edits (the fake key values renamed so gitleaks stays quiet; the grant revokes in the migration). Not re-run.
- Staging, all of it: apply 27 (25 and 26 are already there), deploy `metrics-pull`, `sitemap-submit`, `job-callback`; pg_net sending the body text that is signed
  (`'{}'`); the two Vault entries; PageSpeed on five pages (about 20 s each, 150 s limit) as one call. If a PageSpeed call times out, cut the pages to three in
  `pickPages(..., 3)` or split the call per page; do not raise the limit.
- NOT DONE by design: live Search Console (no verified property: the row is BLOCKED), the IndexNow ping (no site hosts a key file: work order 45), the
  `ai-answers` writer (DECISIONS 38). Search health page: a named follow-up row (decision 1a).

### Staging steps (the head; only migration 27 is new)
1. Apply migration 27. 2. Deploy `metrics-pull`, `sitemap-submit`, `job-callback` (`tools/deploy-functions.mjs`). 3. Function secrets by name: `CRON_KEY`,
`PSI_API_KEY`, `CRUX_API_KEY`, `BING_WEBMASTER_KEY`. 4. Vault entries `metrics_cron_key` (same value as `CRON_KEY`) and `project_url` (the project address,
without a path), through the service connection. 5. One signed `metrics-pull?workspace=<test workspace>`, then `&source=pagespeed`; paste the rows
(`select source, day, data from metrics_snapshots`). 6. Check the cron: `select jobname, schedule from cron.job` shows `metrics-pull-daily` at `30 3 * * *`; after
03:30 UTC, rows for the day exist. Until the Vault entries exist the job prints a notice and sends nothing (by design).
7. When the screen lands: redeploy the staging dashboard in the same step as any migration it reads (charter rule).

### The screen is the next slice (B20 Overview, B21 numbers; not started; I own `Shell.tsx` and `router.tsx` for this order, order 39 is told to stay out)
Read first: this file's Scope item 3, `docs/product/6-dashboard.md:105-139` (edit the Overview and Search health text IN PLACE: the Overview carries the numbers,
the Search health page becomes a follow-up row), `apps/dashboard/src/pages/Shell.tsx:40-44` (tabs), `router.tsx:68-73` (the index route redirects to leads and must
stop), `apps/dashboard/tests/plan-gate.mjs` (every fixed word is in a `docs/blueprint/16-DESIGN-PARTS.md` row; there are no Overview rows yet, so add a section
with new ids and the slice mark, then `built-slices.json`; `t(id, words)` from `src/plan.ts` for copy in code), `tests/styles.spec.ts` (390 px and laptop).
Build: `pages/Overview.tsx` + module css, `lib/overview.ts` (pure: numbers, dates, plain words; vitest), a data hook file of its own (not `data.ts`).
Data: `metrics_snapshots` by RLS (any member reads; a BLOCKED row has `data.blocked = { reason, unblock }` and shows as "not connected yet: <unblock>"; a card
with no input is not shown); `site-audit` by function (owner and staff only: members see state, last publish and leads only, decision 5). Rows are per
workspace and carry `data.site` or `data.property` (decision 4): say on screen which site. Words for the site check come from `byTopic` of the audit summary,
never written in the screen. Also: site state, last publish and by whom, leads this week, changes waiting (`drafts`). Proofs: vitest on `lib/overview.ts`, the
plan gate over the new screen, `styles.spec.ts` at 390 px and laptop (a "styled" assertion and a no-horizontal-scroll check, each watched red), then the
owner judges the phone view; the 390 px look and staging flows use the heavy lock only when the head says. Book rows B20 and B21 move in the same commit with
their counts (`tools/icm/index.mjs --check` must stay green). Usage estimate 3 to 5 points (not measured). If CI is red in my files the head sends the lines.
