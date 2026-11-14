# supabase/ops: backups, the restore drill, alerts

Step 6 prep (brief `factory/briefs/6-0-production-prep.md`). Specs: `docs/blueprint/11-OPERATIONS.md` sections 1 to 3, `10-DELIVERY.md`
section 5, `18-BUDGET-ARCHITECTURE.md` 2.4. Node built-ins only; the tools it calls are `pg_dump`, `pg_restore`, `psql`, `initdb`, `pg_ctl`
and `openssl`. Keys and database URLs are read from the environment BY NAME (`node tools/with-env.mjs "creds and accounts login/omnikom.env"
-- <command>`) and never printed.

| File | What it does |
|---|---|
| `backup.mjs` | `pg_dump` of the database named by `--db <VARIABLE>`, encrypted to the public certificate `backup-recipient.pem` (`openssl cms -encrypt`, AES-256), uploaded to every `--to` target, each copy verified by size. Targets: `s3://<bucket>/<prefix> --env <PREFIX>` (S3-compatible, signed in the file itself, no `aws` tool) or `file://<dir>`. Two more modes: `--what vault` (the decrypted Vault values as JSON, read in a read-only session straight to a file and encrypted at once: `<label>-vault-<stamp>.json.cms`) and `--what media --api <PREFIX>` (every object of the bucket `media`, each signed and downloaded with `<PREFIX>SUPABASE_REF` and `<PREFIX>SUPABASE_SECRET_KEY`, checked against its size, in one tar: `<label>-media-<stamp>.tar.cms`). No object name, value, ref or key is printed. |
| `restore-drill.mjs` | The monthly drill: dump (or `--dump file --key file`), restore into a throwaway local cluster, row counts, wall tests on the restored schema, the factory builds the test site from the restored rows, every phase timed, total against the 2 hour target. With `--media <copy>` the site is built from the real media, with `--vault <copy>` every Vault name the restored rows reference must have a value in the copy (names compared, never printed). |
| `alerts.mjs` | Nine alert queries (below), one per rule of 11-OPERATIONS section 1 that our tables can answer. Prints each firing alert with its runbook name and first step. With `--send --to-env <VARIABLE>` it mails each firing alert through Resend (`RESEND_API_KEY`, `LEAD_ALERT_FROM`) to the address in that variable, once per alert and UTC day. Writes the status page's data file with `--json`. |
| `bring-up.mjs`, `environments.json` | Row E2: `--env staging\|production [--apply] [--i-mean-production]` reads a project and its dashboard and changes only what differs: extensions, every Auth setting, the function secrets the code reads, the Pages project, domain and build, and (production) the production repository's secrets. A dry run unless `--apply`; a second run changes nothing; prints names and short states, never a value. `environments.json` holds the wanted values that are not secrets (Pages project, domain, dashboard address, allowed origins). Test: `test/bring-up.test.mjs --mutants` (local fakes, no network). |
| `inbox-state.mjs` | Read only, staging only: for one address given on the command line, whether a login exists, whether it is confirmed, its number of memberships, and whether each test site's alert list is exactly that address. Prints no address. Test: `test/inbox-state.test.mjs --mutants`. |
| `test/backup.test.mjs`, `test/alerts.test.mjs`, `test/6b-drill.test.mjs` | The tests. `test/6b-mutate.mjs` runs each of them against broken copies of the script and requires red. `test/6b-cluster.mjs`, `test/6b-fake-s3.mjs`: helpers. |
| `../../.github/workflows/backup.yml` | Nightly the dump and the Vault copy, weekly (Sundays) the media copy, staging only, skipped until `BACKUP_ENABLED` is `true`. |
| `../../.github/workflows/restore-drill.yml` | Monthly and by hand, staging: the three copies made to a key pair made in the job, restored by `restore-drill.mjs --media --vault`, then the copies and the key deleted. Last line `DRILL PASS: 9 phases, <time>`. |
| `../../.github/production/backup.yml` | The same for production; goes into the production repository (it never runs here). |
| `../../.github/workflows/alerts.yml` | Hourly, staging, skipped while `STAGING_DB_URL` is absent. |
| `../../sites/omnikom-status/` | The status page draft (`index.html` reads `status.json`). No host is chosen. |

## The recipient certificate (owner batch, nothing here can decrypt)
`backup-recipient.pem` is the PUBLIC half of a key pair the owner makes on his own machine. The private key never enters the repository, a
workflow or a session. We commit only the certificate; `backup.mjs` refuses a file that contains `PRIVATE KEY`.
```
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -subj "/CN=omnikom-backup" -keyout backup-private.pem -out backup-recipient.pem
```
(no `-nodes`: it asks for a passphrase that protects the private key file). Keep `backup-private.pem` and its passphrase offline, in two
places. A backup can only be opened with the key that belongs to the certificate in force on the night it was made, so keep old private
keys after a rotation. Open one: `openssl cms -decrypt -binary -inform DER -in <file>.dump.cms -inkey backup-private.pem -out restored.dump`,
then `pg_restore --list restored.dump`. The drill does the same with `--dump <file> --key backup-private.pem`.

## Why the dump keeps privileges (`--privileges`, the workflows pass it)
The brief said "no owners, no privileges". Measured on the first drill (2026-10-31): a staging dump made WITHOUT privileges, restored with
the same method, fails `tenancy.test.sql` at its first service call (`permission denied for schema service`) because the walls are partly
grants and revokes; the same dump WITH privileges passes ("ALL TENANCY TESTS PASSED"). Owners are still left out. The default of
`backup.mjs` is the brief's (no privileges); the workflows pass `--privileges`. Removing the flag from them is a one line change if the
head decides otherwise.

## Restoring into a new Supabase project (R3 of 11-OPERATIONS)
1. Decrypt (above). 2. The new project has Supabase's own roles; also create `omnikom_fn` (`create role omnikom_fn nologin`, migration 8
makes it) before `pg_restore`, or its grants fail. 3. `pg_restore --no-owner -d <new database URL> restored.dump`. Expect errors about
objects Supabase already owns (extensions, `auth` and `storage` internals): the drill lists the same class of errors locally. 4. Vault
secrets are not usable after a restore into a different project (the key that encrypts them is per project), so the Vault has its own
copy (`<label>-vault-<stamp>.json.cms`, nightly): decrypt it like the dump, then in the new project's SQL editor type one
`select vault.create_secret('<value>', '<name>', '<description>');` per entry of the decrypted copy, there and nowhere else (R3 says
re-enter them by hand). 5. Storage files are NOT in a `pg_dump`: the media have their own copy (`<label>-media-<stamp>.tar.cms`,
weekly): decrypt it, extract the tar (`tar -xf`), and upload its folders to the bucket `media` of the new project keeping their paths.
6. Run `tenancy.test.sql` against a schema-only restore of the same dump (what the drill does) before switching.

## The alerts (`alerts.mjs`)
| Name | Runbook | Fires when |
|---|---|---|
| `publish-failed-twice` | R1 | a site's last two finished publish jobs both failed |
| `job-over-30-min` | R1 | a publish job is not done or failed 30 minutes after it was made |
| `lead-push-failed` | R5 | a lead's CRM push failed 4 times (the retries of 14-LEAD-PATH) and was not pushed after |
| `no-leads-7-days` | R4 | a live site older than 7 days has had no lead for 7 days (the "with traffic" half cannot be checked: no analytics table exists, so quiet sites over-alert) |
| `security-not-found-burst` | R2 | one login got 10 or more `S-NOT-FOUND` refusals in the last hour |
| `security-staff-after-hours` | R2 | a staff login acted outside Mon to Fri 07:00 to 19:00 US Pacific in the last `--since-minutes` (default 70). The clock hours are an assumption: 11-OPERATIONS says "business hours (US Pacific)" only |
| `function-errors` | R6 | a function answered the same 5xx status 5 or more times in the last 60 minutes (`function_errors`, migration 32). The numbers are a choice: the old spec's "2% for 10 min" needs a call count we do not keep |
| `table-over-budget` | R7 | a growing table is larger than its `budget_mb` in `public.retention_rules` (migration 46, book row E12) |
| `login-has-password` | R2 | a login holds a password (`auth.users.encrypted_password` is not empty): the book says there are none. R2's steps 1 to 3 (publishing, evidence of a cross-tenant leak) do not apply; its step 5 (tell the owner the same day) does, and the alert's own "first step" line is what to do |

Not answerable from our tables, so not faked: uptime of sites / dashboard / form endpoint, site quality gates, PSI speed, database CPU
and slow queries. They need an external checker or the Supabase dashboard (owner batch / later step). With `--send --to-env ALERTS_TO`
each firing alert is one mail through Resend; its idempotency key is the environment, the alert and the UTC day, so a condition that holds
(a site with two failed jobs) fires on every hourly run but mails once a day, and a new item later that day waits for the next day's mail
(the hourly job summary still shows it). A failed send exits 1; no retry; no address is printed.

## Runbooks
The runbook names the alerts print (from 11-OPERATIONS section 2, `archive/2026-11-02-blueprint/blueprint/11-OPERATIONS.md`).

**R1 Publish failed.** 1) Open the job's gate report (dashboard Publish centre / `publish_jobs.gate_report`). 2) If a content rule
failed, the client sees the plain-word reason; help them fix it. 3) If the runner failed (export 401, build error, deploy error),
open the GitHub run, re-run once; if it fails again, check token expiry/secrets, then the factory change that last merged. 4) The
previous deploy stays live; nothing to roll back. 5) Note it in the job and close.

**R2 Suspected cross-tenant leak (severity 1).** 1) Stop publishing: `gh workflow disable publish.yml`, and take the affected
site(s) to the previous deploy. 2) Preserve evidence: audit_log, function logs, job exports. 3) Run `tenancy.test.sql` against prod
read-only replica/staging copy; identify the wall that failed. 4) Fix with a test + mutant that reproduce it; two reviewers; deploy.
5) Tell the owner the same day; the owner decides client notification (privacy duty). 6) Write a post-incident note.

**R3 Roll back a deploy.** Site: Cloudflare -> Workers & Pages -> the site's Pages project -> deployments -> redeploy the previous
deployment (or `wrangler pages deployment` tooling; the exact command for rolling back is UNVERIFIED until the first rollback is
done); then fix content (restore versions) and publish again. Dashboard: same for the `app` Pages project. Database data loss:
restore the last dump into a new Supabase project (the steps above), verify with the tenancy tests, switch (Free has no PITR); never
restore over prod without the owner; re-enter Vault secrets by hand after a dump/restore into a new project, from the Vault copy
(step 4 above; Vault secrets are not in a dump; restoring to the same project, cloning or branching keeps them readable; Supabase
Vault docs).

**R4 Form outage (leads not arriving).** 1) Synthetic POST to the site's `/api/lead` on a test form. 2) If the Pages Function fails:
redeploy the last good Pages deployment. 3) If `capture-lead` fails: function logs; Supabase status. 4) Leads that hit an error were not
stored: the form must show the "please call us" fallback with the phone number (built into every form). 5) Tell the client how
long it was down.

**R5 Lead push failing.** Check the `push-failed` events' codes in `lead_events`; 401 = CRM secret rotated (ask the client); 5xx = their CRM down (retries
continue); after the last retry the owner sees the lead in the inbox anyway (nothing is lost).

**R6 Function errors.** The alert names the function, the status, its count in the last hour and the first 8 characters of the
newest request id; search the function's logs (Supabase dashboard, Edge Functions, Logs) for that request id (the first word of each
log line of the call); a 500 CONFIG is a missing function secret; a database cause: Supabase status, then R3; our code: fix forward
with a test; tell the owner when it lasted over an hour.

**R7 A table over its budget** (alert `table-over-budget`). 1) Read its rule in `public.retention_rules`. 2) With a period: today's
`retention-purge` audit row must exist. 3) Without: the head of operations chooses a period (a purge branch and the name in
`retention_rules_purged`, one migration), partitioning, or a higher budget with the reason in `source`.

## Owner batch (nothing below is created by a session)
- Make the key pair and commit `supabase/ops/backup-recipient.pem` (above).
- R2 enabled, a private bucket, a key for that bucket only (the size check reads each copy back); a second provider's bucket and a
  key for that bucket only (Backblaze B2, Wasabi, ...).
- Repository secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `BACKUP2_ENDPOINT`, `BACKUP2_BUCKET`,
  `BACKUP2_ACCESS_KEY_ID`, `BACKUP2_SECRET_ACCESS_KEY`; the same set plus `PROD_DB_URL`, `PROD_SUPABASE_REF` and
  `PROD_SUPABASE_SECRET_KEY` (the media copy; `bring-up.mjs` sets every name of `.github/production/`) in the production repository. Variable
  `BACKUP_ENABLED = true` when ready; `ALERTS_RED = true` to make a firing alert also turn the alerts job red. The alert mail needs the
  secrets `RESEND_API_KEY`, `LEAD_ALERT_FROM` and `ALERTS_TO` (the on-call address) in each repository.
- Bucket lifecycle rule: keep 30 days (not a workflow step).
- A status page host (11-OPERATIONS D5): not chosen. Alerts send through the Resend sender that exists (`supabase/auth-settings.md`);
  production's on-call address is the owner's.
