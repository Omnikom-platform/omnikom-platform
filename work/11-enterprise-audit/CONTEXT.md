# Work order 11: enterprise gap audit (head of operations, 2026-11-05)

Owner 2026-11-05 05:00: nothing in the platform may sit below enterprise practice; every gap found goes into its stage, its
block and its book row so it gets built. This folder is the evidence; the plan lives in `docs/product/9-blocks.md`
"Hardening steps", the capabilities in `docs/product/1-product.md` part E, the rules in `docs/product/11-rules.md` 30-36.

## How it was found (read only, master `032c017`)

1. A Sonnet scan (2026-11-05 04:53) named five gaps (KNOWN-1 to KNOWN-5 below).
2. Workflow `enterprise-gap-audit` (run `wf_b8e77b52-553`): 8 Sonnet finders (database, api, frontend, security, factory,
   operations, architecture, performance), one Sonnet skeptic per critical or high finding, one completeness critic.
   Result `audit-result.json` here: 17 confirmed (C0 to C16, in array order), 40 medium or low unverified (U0 to U39), 1
   refuted, 8 areas not covered.
3. An Opus 5.5 critic at high effort re-read the code for every before-first-client claim, merged duplicates, re-graded,
   checked the 8 uncovered areas and added what all auditors missed. Its plan below is the one adopted.

## The plan (Opus critic; ids are the steps in `9-blocks.md`)

**H0, now (cheap and dangerous)**
- H0-1 The stale-job reaper is never scheduled: a job stuck in building or gating (runner killed at the 30-minute timeout,
  `publish.yml:41`) makes every later publish of that site fail S-JOB-BUSY (migration 8:233-234); the runner turns that 409
  into a permanent failed (`publish.mjs:86-87`; it retries only 502-504, `runner/lib/common.mjs:41`). Fix: a migration that
  schedules `service.reap_stale_jobs()` every 5 minutes with pg_cron (`staging-extensions.mjs:8` installs it); retry
  S-JOB-BUSY with backoff. (Merges C9, C15, the reaper half of C0, U22, U39.)
- H0-2 Any request with a well-formed `?site=` and a bad signature adds an undeletable `security_events` row
  (`capture-lead/index.ts:152`; `hardening_leftovers.sql:43-45`); on the Free plan (`keepalive.yml:1`) a flood fills the
  database size cap. Fix: count events per kind, site, ip_hash and minute with an upsert. (C7, raised to high.)
- H0-3 Build and audit run with RUNNER_KEY and the account-wide Pages token in their environment (`publish.mjs:61-62, 137,
  147`); only wrangler gets a cleaned environment (`:190-191`) though the build runs repo design code (`:96`). Fix: a
  minimal environment per step. (U23, raised.)
- H0-4 The media bucket has no size or type limit (`platform.sql:505`) and direct inserts (`:508-509`) skip upload-start's
  25 MB and MIME checks. Fix: `file_size_limit` and `allowed_mime_types` on the bucket. (C14)
- H0-5 `repository_dispatch` uses GITHUB_DISPATCH_TOKEN, a function secret (`dispatch.ts:4`), which needs Contents: write; a
  leaked function secret could push to the repo whose workflows hold the account-wide Cloudflare token. Token scope and
  master branch protection UNVERIFIED. Fix: the workflow_dispatch API (Actions: write only) and protected master.
- H0-6 (head of operations, owner 2026-11-05 05:13) The book's counts are typed by hand: a check in `tools/icm/index.mjs
  --check` (run by CI) recomputes every count table in `1-product.md` from its rows, fails when a WORKS row cites a path that
  does not exist, and fails when a hardening step has no owner or no part E row. Test and mutant with it.

**H1, before the first real client's traffic or data**
- H1-1 (critical) No backup of any kind: `backup.yml:28` off, `production/backup.yml` not installed (C13); the Free plan has
  no vendor backups; media are in no dump (`supabase/ops/README.md:42`); Vault secrets do not survive a restore into a new
  project (`:40-41`); deleting a workspace cascades to all its rows (`platform.sql:47, 95`). Fix: Pro plan with
  point-in-time restore or the nightly dump on, plus a Storage copy job. The plan choice is the owner's (money).
- H1-2 Production does not exist (`STATE.md`); the promote path covers only migrations and functions
  (`promote.yml:159-170`): missing the dashboard deploy, function secrets, DASHBOARD_ORIGINS and VITE_FUNCTIONS_BASE
  (`config.ts:10`), production Auth settings (`check-auth-settings.mjs:21-22` hard-code staging), a runner aimed at
  production. Fix: a scripted production bring-up. (Takes in C5, U17, U26.)
- H1-3 Alerts go nowhere and read staging only (`alerts.yml:3-5, 27`; `alerts.mjs:116`); no error reporting and no request
  id in functions (`capture-lead:142, 174`) or the dashboard. Fix: alerts to an ops inbox for production; a request id in
  every log line and problem. (C11, C12, U11)
- H1-4 Lead alerts can be lost silently: capped messages are marked blocked and `capture-lead:113` says "the queue retries
  tomorrow" but no worker exists (push-lead only planned, `config.toml:27-29`); the Resend call has no timeout (`:115`).
  Fix: an outbox worker on pg_cron, a timeout. (U5; with KNOWN-4.)
- H1-5 The dashboard has no CSP or security headers while tokens sit in browser storage (`supabase.ts:7`; no `public/`)
  (C6), and no error boundary (`router.tsx:104`) (C4). Fix: `_headers` with CSP and frame-ancestors; a
  defaultErrorComponent and a reload when a chunk fails to load.
- H1-6 A live publish goes to main before the smoke (`publish.mjs:145, 186`); a failed smoke leaves the bad deploy live
  (`:223`); the smoke checks only the title at a fixed address (`:204, 217`). Fix: roll back through the Pages API; smoke the
  deployment URL (`:197`) against a content hash. (C10, U21)
- H1-7 Staff reads are not audited: staff with MFA read every tenant through RLS (migration 8:48-49) and audit rows come only
  from service functions; jwt_exp, refresh rotation and session limits are "not read" (`supabase/auth-settings.md`). Fix:
  audited staff read functions; set those Auth values.
- KNOWN-1 No per-IP rate limit or Turnstile on the public form. New fact: the site endpoint signs any body from anyone and
  forwards no visitor IP (`lead-endpoint.mjs:88-93`), so the IP capture-lead sees (`:138`) is Cloudflare's; a limit there
  would throttle a whole site, and the 60-per-hour lead quota lets spam lock out real leads. Fix in the Pages Function.
- KNOWN-4 The form post waits for Resend and its quota is a `count(*)`.

**H2, before about 50 tenants or 50,000 leads in one tenant**
- H2-1 No retention or partitioning on any append-only table (C0).
- H2-2 Every publish ships the whole workspace media library (C16; migration 10:23-25); one Actions run per photo (U37,
  UNVERIFIED).
- H2-3 RLS helpers run once per row (`platform.sql:226-232`) (U1).
- H2-4 Publish validation is one round trip per row (`publish/index.ts:27-30`) (U36); lead export holds 5,001 rows in
  memory (`lead-export:45-46`) (U38).
- H2-5 One global RUNNER_KEY and an account-wide Pages token (C8, U29); ADR 0011 accepts it and plans OIDC: do OIDC and
  per-project tokens.
- H2-6 Offboarding: the offboarding and deleted states exist (`hardening_leftovers.sql:147`) but nothing exports the data or
  removes the Pages project, Storage, Vault keys or domain; old deployment URLs probably stay public (UNVERIFIED).
- H2-7 Client Pages projects, domains and keys are made by hand (`pages-project.mjs:16` refuses client sites,
  `publish.mjs:164` stops when the project is missing, keys go to the owner's .env, `mint-site-key.mjs:4-5`);
  `sites.domain` is not unique (`platform.sql:52`); no clean-up of dangling domains. Cloudflare's project limit UNVERIFIED.
- H2-8 Erasure is blocked by NO ACTION foreign keys to auth.users (C1; `platform.sql:87`); removing a member still works
  through the members cascade; `privacy_requests` is only a ticket (`hardening_leftovers.sql:347-364`).
- H2-9 Limits exist only for leads per hour and mail or SMS per day: none for sites, media bytes or publishes; no billing.
- H2-10 No dependabot or OSV scan; CI installs with `--no-audit` (`ci.yml:74`); actions are SHA-pinned.
- H2-11 `key-rotation.yml` only reports key ages on staging; RUNNER_KEY is one value (`runner.ts:44-47`), so a rotation
  means downtime: accept two keys at once.
- H2-12 The restore drill is manual (U25); runbooks R1-R5 that the alerts point to (`alerts.mjs:55-94`) live only in
  `archive/2026-11-02-blueprint/blueprint/11-OPERATIONS.md`: bring them back into the book.
- H2-13 Richtext is accepted as any string (`contracts/validate.mjs:296`); the sanitiser `html.mjs:10` mentions does not
  exist. A gate that forbids `raw()` on tenant fields.
- H2-14 Migrations have no lock linting and no expand-contract rule; each file runs in one transaction
  (`apply-staging.mjs:7`), so CREATE INDEX CONCURRENTLY is impossible.
- H2-15 Mail deliverability: no bounce or complaint handling and no erasure executor (suppressions and the consent ledger
  exist, `hardening_leftovers.sql:58-75`).
- KNOWN-2 A direct Postgres connection per request. KNOWN-3 lead_list full scan, offset paging, jsonb industry fields.
  KNOWN-5 No dashboard cache headers; 3 realtime channels per tab.

**H3, later:** C3, U30, U31, U32, U33, U34, U12, U13, U16, U6, U7 (only add-lead double-submits; publish is serialized),
U4, U15, U10, U8, U9, U3, U20, U24, U0 (UNVERIFIED). Each is in `audit-result.json` by its index.

## Refuted or overstated (do not build)
U2 refuted (migration 8:48-64 and 395-400 set `search_path = ''` on all seven helpers). U14 refuted (`data.ts:241, 257`
remove the channel on cleanup). U17 overstated (Auth settings are versioned in `supabase/auth-settings.md`; staging values
only, H1-2). U18 moot (the endpoint signs anything). U19 overstated (the Auth admin API needs the secret key). U28
overstated (runbooks exist, archived: H2-12). C2 overstated (dashboard functions sit behind verify_jwt, `config.toml:6-86`).
C5 overstated (CORS exists, `dashboard.ts:30-37`; the production wiring is H1-2). C10 overstated (Pages keeps deployments
for a manual rollback; automation is missing). C8 is an accepted design (ADR 0011): H2. U22 partly true (the per-site
concurrency group serializes runs; the race comes through stuck jobs, H0-1).

## Areas the finders missed, checked by the critic
Content escaping in client sites mostly safe (html`` escapes, JSON-LD escapes, URL fields https): richtext is H2-13.
Custom domains and TLS: manual, H2-7. Offboarding: H2-6. Compliance partly built: H2-15. Billing and entitlements: H2-9.
Staff: MFA enforced, writes audited, reads not (H1-7); no break-glass procedure found (UNVERIFIED). Cross-origin on capture
is not the issue (server to server, signed); the open signing endpoint is (KNOWN-1). Schema governance better than claimed:
CI replays every migration with walls and mutants, the ledger refuses an edited migration; lock linting missing (H2-14).
Tenant isolation in Storage holds (`media_path_in_workspace`, `platform.sql:97`; the runner checks site and job,
`publish.mjs:91-92`; every table has RLS).
