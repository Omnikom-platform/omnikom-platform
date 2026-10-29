# Blueprint progress (for the lead session)

Task: build-ready product engineering package (owner, 2026-10-28), raised to engineering practice, tied to published standards,
then corrected by an independent fact-check (72 claims) and an independent M1 dry run (31 issues), and by DECISIONS 15
(no Docker; one Supabase account, staging + production). **Status: complete for owner review. Nothing committed.**

## Step 1.1 + step 2.1 on the real staging project (2026-10-29 23:10-00:10, setup session beside the owner)
Project: Supabase org "Omnikom" (Free), project "Omnikom V2 Platform" used as staging (owner's pick), ref in the .env as
`STAGING_SUPABASE_REF`, region us-west-2 (DECISIONS 29), Postgres 17.11. Banked by name only (`creds and accounts login/omnikom.env`,
git-ignored, `OMNIKOM_ENV_FILE`): `STAGING_DB_PASSWORD`, `STAGING_DB_URL` (transaction pooler 6543), `STAGING_DB_URL_DIRECT`
(session pooler 5432: the direct host is IPv6-only on Free, so the session pooler is the IPv4 path for migrations),
`STAGING_SUPABASE_PUBLISHABLE_KEY`, `STAGING_SUPABASE_SECRET_KEY`.
```
node tools/check-platform-keys.mjs "<env>"
STAGING_SUPABASE_REF: present / STAGING_DB_PASSWORD: present / STAGING_DB_URL: present / STAGING_DB_URL_DIRECT: present
STAGING_DB_URL connect: OK
Supabase publishable key: HTTP 200 OK
Supabase secret key: HTTP 200 OK
(Cloudflare, R2, Resend, LEAD_ALERT_FROM, Google: MISSING, steps 1.3-1.5 not started)

node tools/test/probe-db.mjs STAGING_DB_URL_DIRECT
STAGING_DB_URL_DIRECT: HTTP-like OK: pg 17.11 ssl=true user=postgres
STAGING_DB_URL_DIRECT: SSL enforced (a non-SSL connection was refused: ... FATAL: ...)

node tools/staging-extensions.mjs
ok pg_cron 1.6.4 schema=pg_catalog / ok pg_net 0.20.4 schema=extensions / ok pgmq 1.5.1 schema=pgmq / ok pg_stat_statements 1.11 schema=extensions
all installed: pg_cron 1.6.4, pg_net 0.20.4, pg_stat_statements 1.11, pgcrypto 1.3, pgmq 1.5.1, plpgsql 1.0, supabase_vault 0.3.1, uuid-ossp 1.1
PASS extensions on staging: 4 of 4

node supabase/apply-staging.mjs --url-env STAGING_DB_URL_DIRECT
apply 20261028000001_platform.sql / apply 20261029000002_crm.sql / apply 20261029000003_addons.sql / apply 20261029000004_hardening.sql
OK: applied 4 of 4 (0 were already applied)

node supabase/tests/run-staging.mjs   (first run on real Supabase)
FAIL tenancy tests on staging:
psql:.../tenancy.test.sql:89: ERROR:  no public function executable by anon
OK: no fixtures left on staging (rolled back)
```
After migration 5 (vendor defaults) and the ledger moved to `ops.platform_migrations` (second T14 catch on staging: the
ledger table that apply-staging created in `public`, now in its own schema; `test-apply.mjs` updated):
```
node supabase/apply-staging.mjs --url-env STAGING_DB_URL_DIRECT
apply 20261029000005_vendor_defaults.sql
OK: applied 1 of 5 (4 were already applied)

node supabase/tests/run-local.mjs --only "vendor function defaults"
PASS real migration: ALL TENANCY TESTS PASSED
caught   vendor function defaults overridden (N10 on real Supabase, migration 5) ERROR:  no public function executable by anon

node supabase/tests/run-staging.mjs   (2026-10-30 00:03)
PASS tenancy tests on staging
OK: no fixtures left on staging (rolled back)
```
Closes REVIEW 15 and the "run-staging.mjs written, not run" line below: the walls hold on real Supabase.
Settings observed in the dashboard (browser pane, each read back after saving): Enforce SSL on (confirmed by the probe above);
sign-ups off, anonymous off, confirm email on, OTP expiry 3600 s, OTP length 8; Site URL `https://app-staging.omnikom.io`,
redirect `https://app-staging.omnikom.io/**`; rate limits left at the defaults (sign-in 30 / 5 min, OTP and magic-link
verifications 30 / 5 min, token refresh 150 / 5 min, built-in mail 2 / hour until custom SMTP); Data API: auto-expose already
off, schemas public + extensions exposed, pg_graphql not installed (no graphql_public).
FINDINGS (vendor differs from the docs):
1. The Email provider has no "passwords off" switch; magic-link-only (DECISIONS 29 D18) is enforced by the app never offering
   a password form, and by the staff second factor. Recorded on the sequence line.
2. `public.rls_auto_enable()` (Supabase's own event-trigger function, owner postgres, default ACL) gave `anon` EXECUTE on one
   function in `public`, so N10 failed on staging while passing locally. An event-trigger function cannot be called by a
   client (nothing leaked). Fix: `20261029000005_vendor_defaults.sql` (revoke execute on all functions in public from public,
   anon), the same vendor function added to `local-shim.sql`, and the mutant "vendor function defaults overridden" in
   `run-local.mjs`. Proof lines below once run.
3. The built-in browser pane cannot copy to the Windows clipboard (page scripts: "Write permission denied"; the owner's own
   click: "unable to copy") and Supabase's CSP blocks the page from posting to localhost, so `tools/secret-receiver.mjs`
   (built and tested: 14 checks, 6 of 6 mutants) could not be used from that page. Working path: the Copy button clicked in
   the owner's Edge through the Claude extension, then `save-secret-from-clipboard.ps1` by name. The pane still drives
   every settings page.
NOT DONE (owner clicks): MFA on the Supabase account, a second owner; custom SMTP waits for 1.4.
New tools: `tools/with-env.mjs` (run a command with the .env loaded by name), `tools/compose-db-url.mjs` (connection strings
from the password in the note, never shown), `tools/check-platform-keys.mjs`, `tools/staging-extensions.mjs`,
`tools/secret-receiver.mjs` + tests, `tools/tick-sequence.mjs`, `tools/test/probe-*.mjs`.

## Hardening run (2026-10-29 22:50, four migrations in order, `node supabase/tests/run-local.mjs`)
```
PASS real migration: ALL TENANCY TESTS PASSED
125 mutants: 124 caught on the full run; the one survivor ("a retry stores nothing") had become a double wall (early return
plus on-conflict insert) and is now a two-layer mutant, caught on re-run
```
New this run: migration 4 (REVIEW-2026-10-29 fixes: unpublish null guard, column-limited media insert, members through
`set_member`/`remove_member`, one build per site, monotonic `published_version`, `own` needs an `ownerField`, paused sites
refuse leads, bounded inputs, explicit `sms_consent` and STOP, per-workspace message caps, message idempotency and legal
transitions, owners cannot move billing state, null claims only for the concierge, the member a meeting is with may change it,
template field allowlist, recursive secret scan on connector configs, workspace indexes, `delete_lead`); T15 behaviour tests;
T14 structural gates read from the catalogues (RLS and a select policy on every table, a `workspace_id`-first index on every
tenant table, `search_path` and a null-guard lint on every definer function, grants audit, every claims-taking service function
in the outsider list, the generated read-isolation loop over every tenant table for a foreign owner and a no-membership login).
`tools/crm-map`: 152 tests, 109 mutants after the review fixes. Deno check PASS on capture-lead.

## Expansion blocks run (2026-10-29 21:05, `node supabase/tests/run-local.mjs`, three migrations in order; DECISIONS 23)
```
PASS real migration: ALL TENANCY TESTS PASSED
83 mutants: 82 caught + 1 target missing on the first pass (a mutant still aimed at the pre-fix line), re-pointed and caught -> 83 caught, 0 survived
```
Leak found by T13 and fixed (watched red): a non-member's NULL role passed `not (false or NULL)` in `lead_update` and the
add-on and template owner checks (B's owner could act on A). Null guards added (`can_act_on_lead`, `is_owner_or_staff`,
`lead_update`), 3 tests and 3 mutants for them. One plain bug fixed on the way (a CASE that yielded text for `booking_state`).

## Step C run (2026-10-29 19:45, `node supabase/tests/run-local.mjs`, both migrations applied in order; DECISIONS 21)
```
PASS real migration: ALL TENANCY TESTS PASSED
OK: real migration passes; 60 mutants        (60 caught, 0 survived; 14 new for 20261029000002_crm.sql, T12)
```
Also this run: `check-specs.mjs` 0 problems; `contracts/test/run.mjs` 138 passed, 0 failed. Watched-red on the way: the two
"service functions closed to clients" mutants SURVIVED once the second migration re-closed the schema (a single wall had become
double); both now remove both layers and are caught. NOT RUN this time: the industry run, deno check (unchanged files).
Diagrams: `render.mjs` failed for every diagram (Edge headless `--dump-dom` prints nothing since an update); fixed 20:05 by probing
each browser and using the first that prints a DOM (Chrome). `node docs/blueprint/diagrams/render.mjs` -> 13 of 13 ok.

## Final gate run (2026-10-28, after dry run 2, `node docs/blueprint/specs/run-all-gates.mjs`)
```
PASS contract tests             138 passed, 0 failed
PASS contract mutants           82 mutants, 82 caught, 0 survived; 0 codes untested
PASS industry run               15/15 PASS; wrote industry-run/RESULTS.md, contracts/, screens/
PASS database walls + mutants   OK: real migration passes; 47 mutants
PASS specs + traceability       OK: 10 operations, 10 operationIds; 38 FR/NFR rows, 30 work orders, 0 problem(s)
PASS machine-call signature     OK: 0 failed
PASS deno check                 deno check supabase/functions/_shared/signature.ts supabase/functions/_shared/contracts.ts
all gates passed
```

## Dry run 2 (17 new issues + 1 left over): disposition
Each fixed item got a test that went red first, then green; database walls also got a mutant.
- N1 outsider learns field names: `service.contract_for` (404 before any validation), save/publish order fixed in docs + diagram (T12).
- N2 reaper failed live deploys: counts from the last state change (running 30 min, queued 24 h); a reaped job whose deploy lands
  reconciles to done; a NULL in the transition check let an illegal jump through (found by the test, fixed).
- N3 pages outside the plan seeded without title/SEO: contract `pageSeeds` + `seedGaps()`; ELEV8 seeds all 43 pages within the limits
  (12 from the live backup, shortened; 4 drafted pages listed in `clientWording` for the client).
- N4 publish shipped an unvalidated version: `start_publish` takes and pins the validated versions (T13).
- N5 `deno check` broke with a root package.json: reproduced the exact `npm:@types/node` error, fixed with `deno.json`
  `"nodeModulesDir": "none"`; `deno task check` is now a gate.
- N6 signature had no canonical form or replay window: `signature.ts` (t + method + path?query + body, 300 s), tests watched failing
  on a wider window and on unsigned paths.
- N7 token Worker: Vault JSON `{token, worker}`, `Export.deployTokenWorker`. N8 publish body `{site, rows, versions}`.
- N9 seed reference recorded as the version's sign-off. N10 no extension functions in `public` (pgcrypto removed; built-in UUIDs).
- N11 stale names swept. N12 unprocessed photos block publish. N13 job error recorded. N14 W1.6 setup spelled out. N15 unpublish in
  W3.5. N16 local Postgres, staff login, DB driver specified in W0.5. N17 `resolved` shape defined.
- Left over from dry run 1: the industry run now writes only changed files (watched: rewritten before, untouched after).

## The wall leak, proven (fact-check S1 / dry run 8.1)
The test stand-in now models Supabase's default grants (`supabase/tests/local-shim.sql`). The same three grant-wall mutants:
- old stand-in (no defaults): `SURVIVED append-only versions`, `SURVIVED anon has no table rights`, `SURVIVED anon cannot call
  save_version` (the old tests could not see the leak);
- realistic stand-in: all three `caught`. Every wall that is double (defaults off + explicit revoke) is mutated on both layers.

## New leaks found and fixed (each now has a test that went red, and a mutant)
1. A failed publish shipped on the next publish (dry run 5.1): publish is now a job; nothing goes live until it is done; a failed
   job's versions are never shipped (T6).
2. My own snapshot design had a race (a queued second publish froze stale content): the snapshot now freezes at build start (T11).
3. The save validator could be skipped through a public RPC (dry run 3.2): the save body is private; only the `save` function can
   reach it (T4).
4. Members could publish others' items (dry run 3.1): publish uses the same own-only rules (T2b).
5. Photo facts were trusted from the client's row JSON (dry run 3.3): they now come from the media record (`I-MEDIA-UNKNOWN`).
6. `collection_def()` exposed other workspaces' contracts (standards check): guarded (T3).
Plus: staff need MFA (aal2), storage bucket + policies as code, per-job events, legal state transitions, a stale-job reaper,
unpublish, Realtime publication, rolled-back staging-safe tests (`run-staging.mjs`), seeding with an explicit staff actor.

## Fact-check (8 WRONG, 27 PARTLY): all addressed
S1-S4, S6-S10, S15, S17-S20 (Supabase), C1 (marked UNVERIFIED + W0.4 step), C4/C5 (Cloudflare caps in risks), C7/C8, G2, G5,
I1-I11, Q2, ST4, ST8, ST11, ST12, ST15: fixed in the migration/tests or the docs. UNVERIFIABLE items stay marked (O1, ST2, ST4).

## Dry run (31 issues): disposition
Fixed in code + tests: 3.1, 3.2, 3.3, 3.6, 5.1, 5.5, 5.6, 6.1, 6.2, 6.3, 8.1, 8.2, 2.5/4.1 (resolved contract; mergeCore
idempotent). Fixed in the blueprint: 1.2 (CI installs Postgres binaries), 1.5-1.7 (W0.5 local dev kit, no Docker), 2.1-2.4,
2.6, 2.7 (W1.1 seed spec), 3.4, 3.5, 3.7, 4.2 (ADR 0011 revised: runner key; the job token added nothing), 4.3, 4.4, 5.2, 5.3,
5.4 (M1 publishes the contact page; photos in M3), 6.3, 7.1, 7.2 (runner compares the target with the Worker recorded with the
site's token), 8.3. Moved to a later work order: 5.7 (sitemap only lists published pages: W2.2 acceptance). Still BLOCKED by
accounts (owner decisions D1-D4): 1.1, 1.3, 1.4, 2.8, 4.5, 5.8, 7.3. UNPROVEN until W1.2: 3.8 (bundling `contracts/` into Edge
Functions; `core.json` is now a JSON module import instead of a runtime file read).
Every M0-M1 work order now has a local acceptance next to its cloud acceptance (05-BUILD-PLAN).

## UNPROVEN / UNVERIFIED
Anything on real Supabase/Cloudflare/GitHub (no projects yet; `run-staging.mjs` is written, not run); Supabase's real `auth.users`
accepting the named-column fixture insert; the default function secret name for the DB URL; ISO 29148 / 42010 clause content;
ASVS per-requirement sheet (W0.2); OpenAPI official-schema validation; estimates (~99 engineer-days) are estimates.
