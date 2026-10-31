# omnikom: the platform CLI (slice 1)

Spec: `docs/blueprint/26-PLATFORM-CLI.md`. One Node 20+ program, no dependencies, `psql` on the path.
`node tools/omnikom-cli/omnikom.mjs <command> [--target local|staging|production] [--as <identity>] [--expect <code>] [--json]`
Every command prints ONE JSON object `{ ok, command, target, code, expect?, matched?, exit, data }`. Exit: 0 matched, 1 not, 2 usage, 3 BLOCKED.
`--expect` takes the HTTP status (`202`) or the platform code (`S-NOT-FOUND`, `S-OWN-ONLY`, `I-UNKNOWN`...); `ok` is the success code of SQL commands.
Targets read variables by NAME: `STAGING_DB_URL STAGING_SUPABASE_REF ..._SECRET_KEY ..._PUBLISHABLE_KEY`, the `PROD_` set, `LOCAL_DB_URL` (this machine only), `LOCAL_FUNCTIONS_BASE`. Default target: local.
Secrets never leave the program: stdout and stderr pass `lib/redact.mjs`; psql gets its connection through `PG*` variables, never argv.

| Command | What it does |
|---|---|
| `status` | reachable, migrations applied/pending/changed (ledger vs files), functions deployed, key variables present (names, booleans) |
| `apply [--dry-run]` | `supabase/apply-staging.mjs` on the target (`--i-mean-production` on production) |
| `test walls` | `supabase/tests/run-staging.mjs` (tenancy tests, rolled back); refuses a database that holds the seeded fixtures |
| `seed test [--alert-to email] [--clean]` | workspaces A and B, sites, contracts, 5 test logins (the `tenancy.test.sql` fixtures); twice changes nothing |
| `seed workspace --slug --name --industry --deploy-target --preview-host --contract f` (or `--plan dir --entities f`) | a real client from a `contracts/from-plan.mjs` contract: workspace, site, contract, pages, places (SQL path) |
| `key mint --site s` / `key list` / `key revoke --id` | site signing key into Vault + registry + the env file named by `OMNIKOM_ENV_FILE`; never a value in output |
| `contract validate --file f` / `contract place --file f --rows r` | `contracts/validate.mjs`, `place.mjs` |
| `lead send --site s [--form f] [--fixture f] [--retry] [--key uuid]` | a signed lead to `capture-lead`; `--retry` resends the same key and counts rows |
| `lead list/get/update/add/delete --as person` | reads as `authenticated` with the person's claims (RLS), writes through `service.*` |
| `content save/get/history --as person` | contract_for + validator + `service.save_as`; reads through RLS |
| `publish --as person --site s --rows ids`, `job get/wait/set` | `service.start_publish`; `job set` stands in for the runner on the SQL path |
| `verify --only lead` | 10 checks of `capture-lead` over HTTP, one PASS/FAIL line each on stderr, exit 1 on any FAIL |
| `verify --only walls` | 5 checks of the Data API as anon (service functions refused, leads / key registry / sites give nothing); needs only the publishable key. Person checks are listed under `waiting` |
| `verify --only people` | 15 checks of what each seeded login sees through the Data API with its own session (owner B reads A's leads: 0, member A1 only their own, nobody none, keys hidden, staff only at aal2; an owner cannot update a lead directly); makes two leads and removes them |
| `audit --dir <folder> [--json] [--only ids]` | `tools/audit` over a built folder: the engine's lines unchanged (`PASS`/`WARN`/`FAIL`/`SKIP <rule> <page>...`), then `audit: <pages> pages, <rules> rules, <n> FAIL, <n> WARN, <n> SKIP`. Exit 0 no FAIL, 1 a FAIL, 2 usage (no `--dir`, missing folder, unknown rule id, `--target`, `--expect`) or a crash (`ERROR audit crashed: ...`). No target, no network, writes nothing. `--json` prints the usual object (`data` is the engine's result) |
| `gate --dir <folder> [--json]` | the publish gate: every rule, no `--only`. Prints `GATE PASS <pages> pages, <rules> rules` or `GATE FAIL <n> finding(s)` and the FAIL lines. Same exits as `audit`; a deploy runs after exit 0 only. `--json` data is `{ pass, exit, fails, pages, rules }` |
| `mfa enroll-staff` | once: a TOTP factor for the staff test login, its secret to the env file as `TEST_STAFF_TOTP_SECRET` (never printed) |

Identities: `owner-a owner-b member-a1 member-a2 staff nobody` (claims on the SQL path), `site:<slug>` (`SITE_SIGNING_KEY_<SLUG>`), `runner` (`RUNNER_KEY`), `cron` (`CRON_SECRET`).
Production runs only `status` (read-only connection) and `apply --i-mean-production`; every other command is refused (exit 3) before anything is spawned.
Fixtures live in `fixtures/` and are synthetic (example.com, 555); anything else needs `--real` and prints a warning.

## Live parts: proven, waiting, blocked
- **Person sessions over HTTP**: PROVEN on staging 2026-10-30 (`lib/identity.mjs personToken`: Auth admin `generate_link` for the login's email, then `/verify` with the token hash; in memory only, masked in all output). `seed test` writes the six logins the way GoTrue reads them (aud, role, instance, confirmed, empty token columns; earlier rows are repaired by one run). Before that, two approaches failed on `(id, email)`-only rows. `staff` is brought to aal2 with a TOTP factor: `omnikom mfa enroll-staff` (once) puts `TEST_STAFF_TOTP_SECRET` in the env file; without it the staff checks are listed as waiting.
- **Waiting, not faked** (they need functions slice 2 builds): member A1 updates A2's lead (S-NOT-FOUND), member A1 publishes A2's listing (S-OWN-ONLY), a member adds a lead for someone else.
- **`lead send` / `verify --only lead` against the deployed function**: the model of `capture-lead` (`test/harness.mjs`) reads keys the way the function does (`service.active_key` joined to the Vault view), but the deployed run belongs to the step 2 session. `key mint` and `seed test` were observed working on staging (the `(id, email)` insert and `vault.create_secret` through the pooler).
- Slice 2 (function paths for save, publish, export, job callback, lead update, add lead) and slice 3 (`onboard`) are not built.

## Tests
`node tools/omnikom-cli/test/run.mjs [--unit|--db]` (units + a throwaway cluster; the cluster takes minutes to start on this machine) and `node tools/omnikom-cli/test/mutate.mjs` (one rule removed per mutant, all must go red).
