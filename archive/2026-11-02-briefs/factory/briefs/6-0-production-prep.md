# Brief 6.0: step 6 prep that needs no account click (two builders: 6A and 6B)

Builders: Sonnet, in-session agents of the Platform build head (session `local_cade0add-3389-4314-b7b5-83333d26a97a`).
Plan: `factory/briefs/5-0-step-5-and-6-plan.md`. Specs: `docs/blueprint/10-DELIVERY.md` sections 4 to 6 (environments, promotion,
rollback), `docs/blueprint/11-OPERATIONS.md` sections 1 to 3 (signals and alerts, runbooks R1 to R5, backup and restore),
`docs/blueprint/18-BUDGET-ARCHITECTURE.md` 2.4, `docs/blueprint/13-DATA-MODEL.md` section 8 (key names), DECISIONS 27 and 29
(workflows here never hold a production secret; the owner runs `promote` himself in the production repository).

## Why
Step 6 is "production exists": a second Supabase project, the production repository with the promote workflow, backups to R2 plus
a second copy, the monthly restore drill, alerts and a status page, the key-rotation reminder. The accounts and projects need the
owner's click; everything else is built and proven now, so his clicks are the only thing left. Anything that needs a new account,
project, bucket, key or secret is NOT created: write it in your report as one line for the owner batch.

## Where files go
New scripts in `supabase/ops/` (new folder), workflows in `.github/`. The production repository's workflow lives here at
`.github/production/promote.yml`: NOT under `.github/workflows/`, so it never runs in this repository. A status page is a small
static site: `sites/omnikom-status/`. Edit nothing else. Do NOT edit `docs/blueprint/PROGRESS.md` (other builders are writing it):
end your report with the paragraph for it, titled `### 6A ...` or `### 6B ...`, and the head pastes it.

## Builder 6A: promote and the key-rotation reminder
1. `supabase/ops/promote-check.mjs`: given two database URLs by variable NAME (`--proven STAGING_DB_URL --target PROD_DB_URL`)
   and the repository's `supabase/migrations/`, it reads each database's applied migration list
   (`supabase_migrations.schema_migrations`; read how `tools/omnikom-cli` reads it, do not edit it), and prints the target's
   pending list. It refuses (exit 1, one line each) when: a pending file is not applied on the proven database; the order
   differs; an applied migration on the target is missing from the repository or from the proven database; a file's content
   differs from what the proven database recorded (if the history keeps statements; say which). `--dry-run` only reads. Tests
   in `supabase/ops/test/` against two throwaway local clusters (start them the way `supabase/tests/run-local.mjs` does): equal
   lists pass; each refusal case planted and caught; watched red once (break one check, see the test fail for that reason,
   restore).
2. `.github/production/promote.yml`: `workflow_dispatch` with input `commit` (a full sha); `permissions: contents: read`;
   concurrency one; steps: check out that exact commit; Node pinned like `ci.yml`; Supabase CLI pinned by version and sha256
   (download pattern of `ci.yml`'s gitleaks step; find the real release asset and its sha256, never guess one); run
   `promote-check.mjs` against the production database and the staging database (secrets `PROD_DB_URL`, `STAGING_DB_URL` in the
   production repository: names only here); take a dump of production as the backup point and upload it the 6B way; `supabase
   db push` to production; deploy the same functions (`tools/deploy-functions.mjs`, read it, production flag as it defines);
   read-only smoke checks (each function answers its OPTIONS or 405 shape; `omnikom status`-style migration count). Every
   third-party action pinned by commit sha. A header comment says where this file goes and that it holds no secret value.
3. `.github/workflows/key-rotation.yml`: monthly (`cron`) and `workflow_dispatch`; runs `supabase/ops/key-ages.mjs` against
   staging (`STAGING_DB_URL` secret by name): lists `api_keys` rows as kind, label, site, age in days, last used, expires,
   revoked: never a hash or a ref; writes them to the job summary; exits 1 (red, which GitHub emails to the repository's
   watchers) when an active key is older than 90 days or expires within 14. If the secret is absent the job says so and is
   skipped, not red. Tests for `key-ages.mjs` with planted rows on a local cluster.
4. actionlint on both workflow files with the pinned actionlint and shellcheck (read how `ci.yml` and the CLI run them; the CLI
   carries the tools, DECISIONS 42) and paste "clean".
5. A dry run of `promote-check.mjs --dry-run` with staging as both sides: paste its output (0 pending).

## Builder 6B: backups, the restore drill, alerts, the status page
1. `supabase/ops/backup.mjs`: dump (custom format, no owners, no privileges) of the database named by `--db <VARIABLE>` ->
   encrypt with the PUBLIC certificate at `supabase/ops/backup-recipient.pem` using `openssl cms -encrypt` (AES-256; the private
   key stays offline with the owner, so the workflow needs no decryption secret) -> upload to every target given (`--to
   s3://<bucket>/<prefix>` with endpoint and keys from variables by name; `--to file://<dir>` for tests) -> verify each upload
   by size. Never prints a URL with credentials or a row. For tests, generate a throwaway key pair in the system temp folder (C:,
   never E:, which is nearly full) and a test certificate; the real `backup-recipient.pem` is an owner-batch item (he makes the
   pair; we commit only the public half), so commit a README line saying so, not a key.
2. `.github/workflows/backup.yml`: rewrite its steps to call `backup.mjs` with two targets (R2 and the second provider, both
   S3-compatible; variable names `R2_*` as today and `BACKUP2_ENDPOINT`, `BACKUP2_BUCKET`, `BACKUP2_ACCESS_KEY_ID`,
   `BACKUP2_SECRET_ACCESS_KEY`), still skipped until `BACKUP_ENABLED` is true; staging only (the production dump is the
   production repository's job: add the same job to `.github/production/` as `backup.yml`). actionlint clean.
3. `supabase/ops/restore-drill.mjs` (11-OPERATIONS 3): take a dump of staging (or `--dump <file>`, decrypted with `--key
   <file>`), restore it into a throwaway local cluster in the system temp folder, run the wall tests that make sense on a
   restored copy (read `tenancy.test.sql`: it may refuse when fixtures are present; find the honest subset or a way to run it,
   and say which), build the test site from the restored rows with the factory (read `factory/README.md` and how
   `export-published` shapes rows), and print the time of each phase and the total (target under 2 hours). Run it against
   staging and paste the whole output: it is the first monthly drill record.
4. `supabase/ops/alerts.mjs`: one query per alert in `11-OPERATIONS.md` section 1 that our tables can answer (publish failed
   twice in a row for a site, a job over 30 minutes, a push failed after all retries, no leads for 7 days on a live site, the
   security-event anomalies); each prints what it would send, with the runbook name. Sending is off (no sender exists): a flag
   that refuses to send with a plain line. Tests with planted rows on a local cluster, each alert watched firing and watched
   quiet. A scheduled `.github/workflows/alerts.yml` (every 15 minutes is too many for the free minutes; hourly) that runs it
   against staging, skipped when its secret is absent. actionlint clean.
5. `sites/omnikom-status/index.html`: a plain static status page draft (dashboard, client sites' forms, publishing), each line
   with its last check time; data from a JSON file the alerts job would write; rendered once with the design bench or a
   headless browser, screenshot path in your report. No provider chosen: that is an owner-batch line.

## Rules (both builders)
- Edit only the files named above. `tools/omnikom-cli/` and `tools/audit/` belong to other departments: read them, never edit;
  a need there is a finding in your report.
- Keys by variable name only through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- <command>`; never print,
  copy or list a value, never list the `creds and accounts login/` folder. Scripts in files, never `node -e`. No em dashes.
  Large temporary files (dumps, clusters) in the system temp folder on C:, deleted at the end. Long runs in the background with
  bounded waits. Do not commit; the head verifies and commits.
- Read-only against staging, except what a restore drill needs to read. Nothing touches production or any account setting.
- Two failed approaches to the same obstacle = stop and report BLOCKED with what would unblock it.

## Done when (paste every line in your report and in its PROGRESS paragraph)
- 6A: the promote-check tests (watched red line, then OK); the key-ages tests; actionlint clean on `promote.yml` and
  `key-rotation.yml`; the dry-run output against staging.
- 6B: the backup tests (encrypt, file target, decrypt with the test key, `pg_restore --list` reads it); actionlint clean on
  `backup.yml`, `alerts.yml` and the production `backup.yml`; the restore drill's full output against staging; the alerts tests
  (each firing and quiet); the status page screenshot path.
- Owner-batch lines and findings for other departments, each in one line.
