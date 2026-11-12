# supabase/ops: backups, the restore drill, alerts

Step 6 prep (brief `factory/briefs/6-0-production-prep.md`). Specs: `docs/blueprint/11-OPERATIONS.md` sections 1 to 3, `10-DELIVERY.md`
section 5, `18-BUDGET-ARCHITECTURE.md` 2.4. Node built-ins only; the tools it calls are `pg_dump`, `pg_restore`, `psql`, `initdb`, `pg_ctl`
and `openssl`. Keys and database URLs are read from the environment BY NAME (`node tools/with-env.mjs "creds and accounts login/omnikom.env"
-- <command>`) and never printed.

| File | What it does |
|---|---|
| `backup.mjs` | `pg_dump` of the database named by `--db <VARIABLE>`, encrypted to the public certificate `backup-recipient.pem` (`openssl cms -encrypt`, AES-256), uploaded to every `--to` target, each copy verified by size. Targets: `s3://<bucket>/<prefix> --env <PREFIX>` (S3-compatible, signed in the file itself, no `aws` tool) or `file://<dir>`. |
| `restore-drill.mjs` | The monthly drill: dump (or `--dump file --key file`), restore into a throwaway local cluster, row counts, wall tests on the restored schema, the factory builds the test site from the restored rows, every phase timed, total against the 2 hour target. |
| `alerts.mjs` | Six alert queries (below), one per rule of 11-OPERATIONS section 1 that our tables can answer. Prints what it would send with the runbook name. Sending is off. Writes the status page's data file with `--json`. |
| `inbox-state.mjs` | Read only, staging only: for one address given on the command line, whether a login exists, whether it is confirmed, its number of memberships, and whether each test site's alert list is exactly that address. Prints no address. Test: `test/inbox-state.test.mjs --mutants`. |
| `test/backup.test.mjs`, `test/alerts.test.mjs`, `test/6b-drill.test.mjs` | The tests. `test/6b-mutate.mjs` runs each of them against broken copies of the script and requires red. `test/6b-cluster.mjs`, `test/6b-fake-s3.mjs`: helpers. |
| `../../.github/workflows/backup.yml` | Nightly, staging only, skipped until `BACKUP_ENABLED` is `true`. |
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
secrets are not usable after a restore into a different project (the key that encrypts them is per project): re-enter them by hand
(R3 says so). 5. Storage files are NOT in a `pg_dump`: `media` objects need their own copy (not built; see Findings in the 6B report).
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

Not answerable from our tables, so not faked: function error rate, uptime of sites / dashboard / form endpoint, site quality gates, PSI
speed, database CPU and slow queries. They need an external checker or the Supabase dashboard (owner batch / later step). `--send`
refuses ("sending is off"). A condition that holds (a site with two failed jobs) fires on every hourly run until fixed; de-duplicating is
the sender's job when one exists.

## Owner batch (nothing below is created by a session)
- Make the key pair and commit `supabase/ops/backup-recipient.pem` (above).
- R2 enabled, a private bucket, a write-only key; a second provider's bucket and write-only key (Backblaze B2, Wasabi, ...).
- Repository secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `BACKUP2_ENDPOINT`, `BACKUP2_BUCKET`,
  `BACKUP2_ACCESS_KEY_ID`, `BACKUP2_SECRET_ACCESS_KEY`; the same set plus `PROD_DB_URL` in the production repository. Variable
  `BACKUP_ENABLED = true` when ready; `ALERTS_RED = true` to make a firing alert turn the alerts job red (the only channel until a sender exists).
- Bucket lifecycle rule: keep 30 days (not a workflow step).
- A status page host and a sender for alerts (11-OPERATIONS D5): not chosen.
