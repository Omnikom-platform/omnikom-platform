# Blueprint progress (for the lead session)

Task: build-ready product engineering package (owner, 2026-10-28), raised to engineering practice, tied to published standards,
then corrected by an independent fact-check (72 claims) and an independent M1 dry run (31 issues), and by DECISIONS 15
(no Docker; one Supabase account, staging + production). **Status: complete for owner review. Nothing committed.**

## SEO and audits, slice 1: the audit engine over a built folder (2026-10-30 21:30, builder session)
`tools/audit/` built to `tools/audit/briefs/slice-1-engine.md`: 14 checks (MET-001, MET-002, MET-003, MET-004, SE-202, URL-009, IDX-004,
IDX-001, IDX-002, IDX-003 as WARN, SE-004, A11-007, LNK-002, SCH-001), each with `rules/<ID>.md`; 64 generated fixtures plus `fixtures/good`.
Nothing committed. Outputs below are the real ones from the final run.
- `node tools/audit/test/run.mjs` (last lines): `ok   audit() returns the documented shape` / `OK: 195 of 195 checks passed`, exit 0.
- `node tools/audit/test/mutate.mjs` (last lines, final run): `106 mutants, 106 caught, 0 survived, 0 target text missing`, exit 0.
  (An earlier run was `106 mutants, 105 caught, 1 survived`: the svg-title mutant, because the test put the svg in the body, where the
  head filter hid it. The test now puts one in `<head>`; the rerun is the line above.)
- `node tools/audit/run.mjs tools/audit/fixtures/good`: 40 lines, every one `PASS`, then `OK: 4 page(s), 14 rule(s), 0 FAIL, 0 WARN, 0 SKIP`
  on stderr, exit 0.
- `node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003`: exit 1 and
  `FAIL MET-003 /tasting-room/:48 value-mismatch: <h4> "Small print" follows <h2> "Before you come" (line 46) and skips a level (source: checklist/web-delivery.md MET-003)`.
- `node tools/audit/fixtures/build-fixtures.mjs --check`: `OK: 64 fixture(s) equal the generator output`.
- Not covered by the engine (listed, not printed as SKIP so a clean site is all PASS): the HTTP parts of IDX-004 and the browser parts of
  A11-007. UNPROVEN: the rule texts were pasted from the brief, not re-read from `shipgate/spec/packs/`; IDX-003 has only the checklist's
  cut-short text.
- HEAD RE-RUN (Rule 2, 2026-10-30 21:30-21:55, the SEO and audits head, this checkout, the builder's files untouched):
  `node tools/audit/test/run.mjs` -> `OK: 195 of 195 checks passed`, exit 0, 0 FAIL lines;
  `node tools/audit/test/mutate.mjs` -> `106 mutants, 106 caught, 0 survived, 0 target text missing`, exit 0 (106 `caught` lines, 0 SURVIVED or MISSING);
  `node tools/audit/run.mjs tools/audit/fixtures/good` -> 41 lines, 0 non-PASS, `OK: 4 page(s), 14 rule(s), 0 FAIL, 0 WARN, 0 SKIP`, exit 0;
  `node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003` -> `FAIL MET-003 /tasting-room/:48 value-mismatch: <h4> "Small print" follows
  <h2> "Before you come" (line 46) and skips a level (source: checklist/web-delivery.md MET-003)`, `FAILED: ... 1 FAIL`, exit 1;
  `--list` -> 14 rules each with a severity and a checklist source; `build-fixtures.mjs --check` -> `OK: 64 fixture(s) equal the generator output`.
  SLICE 1 PROVEN. The brief's rule texts came from the shipgate spec 8.0.0 pack files read by the head on 2026-10-30 (the builder's
  UNPROVEN point above is closed by that reading, except IDX-003, which stays on the checklist's cut text as a WARN).
  The builder ran as an in-session Sonnet agent, not a sidebar session (the app refused `start_session` from a session-given task).

## Migration 6 and CLI part 2 (2026-10-30 17:45-19:00, cli-slice-1 session; the lead's brief after the step 2 finding)
- **Part 1, PROVEN.** `20261030000006_active_key_by_site.sql`: `service.active_key` matches a given site by `site_id` and narrows by the
  workspace only when one is given; no site keeps the platform-wide behaviour. Tenancy test now writes site keys the way `key mint` does
  (site AND workspace) plus another site's key, a revoked key and a key without a workspace. Watched red without the migration:
  `ERROR:  a revoked key is dead; a site key stored with its workspace is found by the site alone (what capture-lead asks)`; with it
  `PASS real migration: ALL TENANCY TESTS PASSED`, `OK: real migration passes; 129 mutants` (3 new, all caught: the old filter back,
  the workspace not narrowing, a site key handed out for no site). The CLI's `capture-lead` model now reads keys from the database
  (`service.active_key` joined to `vault.decrypted_secrets`, shimmed locally): `test/run.mjs` red without migration 6 (`lead send` 401,
  `test walls` fails), green with it. `run-all-gates.mjs`: `all gates passed`. Staging: `apply` = `applied 1 of 6`, `status` 6 applied /
  0 pending, read-only `active_key('site-signing', site A)` = 1 (was 0), with workspace 1, site B 1, no site 0.
- **Part 2, partly PROVEN, partly BLOCKED.** `verify --only walls` on staging: 5 of 5 PASS (anon calling `service.capture_lead` and
  `service.lead_update` through the Data API: 406; anon reading `leads`, `api_keys`, `sites`: 401). 406 means the service schema is not
  exposed (a refusal, but not the execute grant being tested). BLOCKED: person tokens. Approach 1 `generate_link` (magiclink) for
  `owner-a@test`: 500 `duplicate key ... users_email_partial_key` (GoTrue did not find the seeded user and tried to create it).
  Approach 2 admin `PUT /auth/v1/admin/users/<seeded id>` then password grant: 404 `user_not_found`. Read-only cause: the seeded
  `auth.users` rows have `aud`, `role`, `instance_id` and the token columns null. Staff would also need a TOTP factor for aal2, and
  `nobody` (sub ...f0) has no `auth.users` row. Nothing changed on staging by these probes. Unblock: a decision on GoTrue-shaped seed rows.
- Tests: `test/run.mjs` 145 of 145; `test/mutate.mjs` 67 mutants, 67 caught (66 in the full run, the 67th re-run after making its target
  unique).
- **Part 2, resolved (19:00-19:40, after the lead's decision: GoTrue-shaped seed rows).** `seed test` writes six logins (adds `nobody`
  `nobody@test`, id ...f0) with `aud`/`role` authenticated, zero `instance_id`, `email_confirmed_at`, empty-string token columns, app
  metadata; an update statement repairs rows from the earlier seed. On staging: `seed test` -> `changed: true`, again -> `changed: false`.
  `generate_link` (magiclink) + `/verify`: 200, 200, `GET /user` 200, sub = the seeded id, aal1 (probe output: `generate_link 200`,
  `verify(token_hash) 200`, `user(token) 200`). `omnikom mfa enroll-staff --target staging`: `changed: true` (a TOTP factor for the staff
  test login; `TEST_STAFF_TOTP_SECRET` appended to the master env file, nothing printed). `verify --only people --target staging`:
  15 of 15 PASS, exit 0 (owner A reads both test leads; owner B 0; member A1 only the lead handed to them; member A2 0; nobody 0 leads and
  0 workspaces; owner B sees only workspace B; owner and member read 0 api_keys; staff at aal2 read both leads and the key registry;
  staff at aal1 read none; owner PATCH of a lead status 403; service function via Data API 406), no token in the output (grep `eyJ` = 0),
  leads afterwards 0. Local: `test/run.mjs` 167 of 167 (a model of GoTrue and PostgREST over the throwaway database: row-level security
  decides; a leaky Data API makes `people` FAIL; blind Auth is BLOCKED exit 3; `mfa enroll-staff` once and twice); mutants and gates below.
  Final local state: `test/run.mjs` 168 of 168; `test/mutate.mjs` 83 mutants, 83 caught (81 in the full run; the two survivors were test-design
  gaps, fixed: the seed repair hid the null-token insert, so that mutant is layered; the aal1-key check had no broken-wall model, so the model
  got `noMfa`; both re-run and caught); `run-all-gates.mjs`: `all gates passed` (the auth.users shim gained the GoTrue columns).
  NOT DONE / UNPROVEN: `mfa enroll-staff` removing a stale factor (the path with `removedFactors > 0`) ran only against the model, not on staging;
  the slice 2 checks (lead-update, publish, add-lead) wait for those functions.
- **Head's re-run (2026-10-30 20:18-20:30, CLI department head, Rule 2; commit 82bc2f8 as pushed, this checkout).** Through
  `with-env` + `omnikom ... --target staging`: `status` = reachable, 6 applied / 0 pending / 0 mismatched, `capture-lead` deployed, 4 key
  names present, exit 0; `verify --only walls` = `passed 5 failed 0 exit 0` (406, 406, 401, 401, 401); `verify --only people` = `passed 15
  failed 0 exit 0`, every line PASS as listed above (owner PATCH 403, service function 406); `verify --only lead` = `passed 12 failed 0
  exit 0` (202; retry 1 row and 1 alert; 400; 401 x5; 404; 405; paused site 500 and 0 rows); `lead list --as owner-a` after = 0 rows.
  No token or key in any output. Local: `test/run.mjs` = `OK: 168 of 168 checks passed`, exit 0; `test/mutate.mjs` = `83 mutants, 83 caught, 0 survived, 0 target text missing`, exit 0.
  ACCEPTED: slice 1 (parts 1 and 2) is closed. Charter finding passed up: the builder edited `supabase/tests/local-shim.sql` (GoTrue
  columns on the auth.users shim) before the charter reserved `supabase/`; committed and green, recorded, not reverted.

## Step 2: the first lead, through the CLI on test workspaces A and B, to staging, to the owner's inbox (2026-10-30 17:15-18:20, step-2-lead-proof session)
Every command ran as `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs <command> --target staging`;
the CLI redacts, no key or URL value appears below. Ids are the seeded fixture ids (`aaaaaaaa-...` = A, `bbbbbbbb-...` = B).
1. `status`: `reachable: true`, ledger present, applied `20261028000001_platform` .. `20261029000005_vendor_defaults` (5), pending `[]`,
   mismatched `[]`, `capture-lead: deployed`, 4 `STAGING_*` key names `true`, exit 0. `apply --dry-run`: `DRY RUN: 0 pending of 5`, exit 0.
   `test walls`: `PASS tenancy tests on staging`, `OK: no fixtures left on staging (rolled back)`, exit 0.
2. `seed test --alert-to amer@omnikom.io`: workspaces `test-demo-a` (id `aaaaaaaa-0000-0000-0000-000000000000`, site
   `aaaaaaaa-0000-0000-0000-00000000517e`) and `test-demo-b` (`bbbbbbbb-...-000000000000`, site `bbbbbbbb-...-00000000517e`), logins
   owner-a, owner-b, member-a1, member-a2, staff, `changed: true`, exit 0. Second run: same ids, `changed: false`, exit 0.
   PROVEN for the first time: the `auth.users` insert by `(id, email)` on real Supabase.
   `key mint --site test-demo-a`: `vaultSecret: site-test-demo-a-key-1`, `envVariable: SITE_SIGNING_KEY_TEST_DEMO_A`, `hashPrefix: ba00ce1aae9e`.
   `key mint --site test-demo-b`: `site-test-demo-b-key-1`, `SITE_SIGNING_KEY_TEST_DEMO_B`, `hashPrefix: 2266f6832967`. `key list`: 2 rows
   (ids `5764d644-ffa2-4aa6-9931-60e1745a8235`, `056cda42-8b69-415b-89c5-93ab51f9b7fb`, kind site-signing, hash prefixes only).
   PROVEN for the first time: `vault.create_secret` through the transaction pooler.
3. `capture-lead` deployed with `RESEND_API_KEY` and `LEAD_ALERT_FROM` (step 1 session, re-verified by the lead; `status` shows `deployed`).
4. FIRST ATTEMPT (18:0x, before migration 6): `lead send --site test-demo-a --fixture lead-contact.json --expect 202` = **401**
   `{"code":"SIGNATURE","msg":"Not accepted."}`, `stored: null`, exit 1. Read-only diagnosis: `service.active_key('site-signing', <site A>)`
   = 0 rows, with A's workspace added = 1 row; db epoch = local epoch; Vault secret readable; site state preview. Cause: migration 2's
   `active_key` matched `workspace_id is not distinct from p_workspace` (null from the function) while both mint tools store the site's
   workspace on the key. Routed by the owner to the CLI builder (POSITION 17:40); fixed by migration `20261030000006_active_key_by_site.sql`
   (builder), applied to staging by the lead. `status` after: 6 applied, 0 pending, exit 0.
   SECOND ATTEMPT (18:07): `lead send --site test-demo-a --fixture lead-contact.json --expect 202` = `code: 202`, `matched: true`,
   submission id (the idempotency uuid) `4551e604-eb65-402a-b4fe-7bc93706c6a2`, attempts `[202 {"ok":true}]`, `stored: 1`, exit 0.
   PROVEN for the first time: the signed path string the deployed function sees equals what the endpoint signs.
   `lead send ... --retry --expect 202` (18:08): submission id `f190271c-6d8c-42b1-ba30-9aa2062953af`, attempts `[202, 202]`, `stored: 1`, exit 0.
   `verify --only lead` (18:09; the lead suite as in commit d4ad6d8, 12 checks; the builder's uncommitted `walls` suite was not run), exit 0:
   ```
   PASS a signed lead is accepted (expected 202, got 202)
   PASS the same idempotency key twice stores one row (expected 202 and 1 row, got 202, rows=1)
   PASS a retry sends no second alert (expected at most 1 alert row, got 202, alerts=1)
   PASS an empty consent is refused (expected 400, got 400)
   PASS B's key on A's site is refused (expected 401, got 401)
   PASS a signature older than 301 s is refused (replay) (expected 401, got 401)
   PASS a request without a signature is refused (expected 401, got 401)
   PASS a garbled signature is refused (expected 401, got 401)
   PASS an unknown site id is refused (expected 401, got 401)
   PASS a malformed site id is not found (expected 404, got 404)
   PASS GET is refused (expected 405, got 405)
   PASS a lead to a paused site is not stored (expected not 202, 0 rows, got 500)
   ```
   stdout: `"passed": 12, "failed": 0`. The paused site still answers 500 (known finding, not S-SITE-PAUSED). Site A state after: `preview`.
5. `lead list --as owner-a`: `count: 2` (ids `4ba2f8aa-58d5-4f54-96d2-6118f83f8064` 16:07:34Z and `5a27460a-561b-4c4b-bc7e-0b548f5cec79`
   16:08:29Z, status new, page `/omnikom-cli-test`). `lead list --as owner-b`: `count: 0`. Alerts (read-only query of `messages`, template
   `new-lead`): 3 rows, all `state: sent`, `error: null`, one per lead (16:07:35Z, 16:08:30Z, 16:09:16Z for verify's own lead), none for the
   two retries. OWNER 18:15: "Yes, 3 emails arrived" at amer@omnikom.io. `lead delete --as owner-a --lead 4ba2f8aa...` and `--lead 5a27460a...`:
   `ok`, `deleted`, exit 0 each; `lead list --as owner-a` after: `count: 0`.
Staging state at the end: A and B seeded (alerts to amer@omnikom.io), 2 active site keys, 0 leads, 3 `messages` rows (sent; the deleted leads'
rows keep `lead_id: null`, so messages are set null, not cascaded, on a lead delete). Observation: `verify.mjs` says "events and messages cascade";
messages survive with a null lead (harmless; the row is the proof an alert went out). UNPROVEN still: the person checks of 26 section 4 over HTTP
(builder's part 2), `S-SITE-PAUSED` over HTTP (500 today).

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
NOT DONE (owner clicks): MFA on the Supabase account, a second owner.

### Steps 1.2, 1.3, 1.4 (2026-10-30 00:30-01:45, owner creating accounts, the session clicking through them in Edge)
```
gh api orgs/Omnikom-platform --jq '{two_factor_requirement_enabled}'     -> {"two_factor_requirement_enabled":true}
gh api -X POST repos/AbdulrahmanAmer/backup-Omnikom-Platform/transfer -f new_owner=Omnikom-platform -f new_name=omnikom-platform
gh repo view Omnikom-platform/omnikom-platform -> {"branch":"master" (after PATCH default_branch), "isPrivate":true}
gh repo create Omnikom-platform/omnikom-platform-prod --private -> https://github.com/Omnikom-platform/omnikom-platform-prod
PUT vulnerability-alerts 204, PUT automated-security-fixes 204; actions/permissions {"allowed_actions":"all","enabled":true}
git push backup-gh master -> 86edf13..7b09d21, 8414fcb..52bf824 (remote re-pointed to the org repo)

node tools/check-platform-keys.mjs "<env>"   (01:27)
Cloudflare Pages token: HTTP 200 OK  /  Cloudflare DNS token: HTTP 200 OK   (account endpoint /accounts/<id>/tokens/verify;
the user endpoint answers 401 "Invalid API Token" for account-owned tokens: checker fixed)
Resend: HTTP 401 "This API key is restricted to only send emails" = a valid sending-only key (checker reads it as OK)

node tools/dns-upsert.mjs --zone omnikom.io --records sops/dns/notify.omnikom.io-resend.json --token-env CLOUDFLARE_DNS_TOKEN_LEGACY
zone omnikom.io (a7c8acea...) in account "Abdoamer683@gmail.com's Account"
create TXT resend._domainkey.notify.omnikom.io / create CNAME rsend.notify... / create CNAME send.notify... / create MX notify.omnikom.io
done: 4 created, 0 skipped, 0 failed
Resend domain page 01:30: STATUS Verified (region eu-west-1)
node tools/resend-test-email.mjs --to amer@omnikom.io -> Resend send: HTTP 200 id=01a18a00-13fe-7dae-8593-2b9415fb85dc
owner 01:35: "email arrived"
node tools/deploy-capture-lead.mjs --secrets-only -> OK: secrets set by name: RESEND_API_KEY, LEAD_ALERT_FROM
Supabase Auth > SMTP (pane, 01:41): Enable custom SMTP on, smtp.resend.com:465, user resend, sender login@notify.omnikom.io,
password pasted by the owner from the clipboard (tools/clipboard-from-env.ps1) -> "Successfully updated settings"
```
Accounts: GitHub org `Omnikom-platform` (logo set); Cloudflare NEW account amer@omnikom.io (id in the .env as
CLOUDFLARE_ACCOUNT_ID), tokens `omnikom-pages-deploy` + `omnikom-dns-onboarding` (account API tokens, 90 d, each rolled once:
the first Pages value was echoed by the browser "find" tool, the first DNS copy missed), Dave invited as Super Administrator
(Pending); Resend team "omnikom", domain `notify.omnikom.io` (owner's choice of a subdomain), sending-only key. R2 DEFERRED
(owner; a card on file is the price). Legacy token `omnikom-dns-legacy` (old account, DNS edit on omnikom.io only) for the
zone that still lives there. UNPROVEN: a magic-link send through the custom SMTP (no login exists yet); `test-apply.mjs`
hangs locally (exit 124, no output) and needs a debug pass; the member invite until Dave accepts.
Later the same night: Supabase org invite dave@omnikom.io as Owner ("Successfully sent invitation", 01:55; the first attempt
missed a second confirmation dialog "Invite as Owner?").

### Step 1.5 Google (2026-10-30 01:50-02:15): PARTLY DONE, then BLOCKED by an organisation policy
Done in project `omnikom-seo` (signed in as amer@omnikom.io in Edge): Search Console API and Site Verification API enabled
(both listed on the APIs dashboard next to PageSpeed Insights); service account `omnikom-platform-search@omnikom-seo.iam.gserviceaccount.com`
created (unique id 101514631929447392231, no project role: Search Console access is granted per property later).
BLOCKED: "Service account key creation is disabled": the organisation omnikom.io (id 29312388971) enforces
`iam.disableServiceAccountKeyCreation` ("Secure by Default"). The owner chose to lift it for the project, but amer@omnikom.io
has neither `orgpolicy.policies.*` on the project nor `resourcemanager.organizations.getIamPolicy` on the organisation: the
console names the role to add, "Organization Policy Administrator" on omnikom.io, and only an Organization Administrator (or
the Google Workspace super admin of omnikom.io) can grant it. UNBLOCK (either): (a) the Workspace super admin opens the Cloud
console > IAM at organisation omnikom.io > Grant access > amer@omnikom.io > roles Organization Administrator + Organization
Policy Administrator; then the policy page for Omnikom SEO > Manage policy > Override parent's policy > rule Enforcement
Off > Set policy; then `Add key > Create new key > JSON` and `node tools/bank-json-key.mjs --file <download> --env <env>`
banks it as GOOGLE_SERVICE_ACCOUNT_JSON and deletes the download; or (b) keep the policy and use Workload Identity
Federation from GitHub Actions in step 7 (keyless; Google's recommendation on that very dialog). Nothing before step 7 needs it.
02:10: the Workspace super admin is dave@omnikom.io (the owner signed in as Dave in Edge); Google Cloud answers "access
blocked: 2-step verification required (enforced since 2026-10-20)" plus the first-time Cloud terms dialog for that account, so
the grant needs Dave himself (phone for 2SV, terms acceptance). Path (a) therefore waits for Dave; path (b) needs nobody.
02:20-02:35 UNBLOCKED through Workspace instead: Dave (super admin, admin.google.com works without the Cloud 2SV wall) made
amer@omnikom.io a Workspace super admin; amer@ then granted itself Organization Administrator + Organization Policy
Administrator on omnikom.io and overrode the constraint for Omnikom SEO (legacy and managed versions both "Not enforced").
Key created and banked (the session's tools refused the policy and role clicks themselves; the owner clicked):
```
node tools/bank-json-key.mjs --file <download> --name GOOGLE_SERVICE_ACCOUNT_JSON --env <env>
saved GOOGLE_SERVICE_ACCOUNT_JSON (3164 chars, base64 of the JSON) for omnikom-platform-search@omnikom-seo.iam.gserviceaccount.com in project omnikom-seo; downloaded file deleted
node tools/check-platform-keys.mjs "<env>"
Google service account (omnikom-platform-search@omnikom-seo.iam.gserviceaccount.com): HTTP 200 OK, 0 Search Console site(s)
```
Note for later: amer@omnikom.io is now a Workspace super admin and the key-creation policy is lifted on Omnikom SEO only; both
are owner decisions of 2026-10-30, reversible in the Admin console and the policy page.
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
