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

Identities: `owner-a owner-b member-a1 member-a2 staff nobody` (claims on the SQL path), `site:<slug>` (`SITE_SIGNING_KEY_<SLUG>`), `runner` (`RUNNER_KEY`), `cron` (`CRON_SECRET`).
Production runs only `status` (read-only connection) and `apply --i-mean-production`; every other command is refused (exit 3) before anything is spawned.
Fixtures live in `fixtures/` and are synthetic (example.com, 555); anything else needs `--real` and prints a warning.

## BLOCKED
- **Person identities over HTTP** (a session token for `owner-a` ...): BLOCKED, measured on staging 2026-10-30. `seed test` inserts `auth.users` by `(id, email)`; aud, role, instance_id and the token columns stay null and GoTrue filters on them: `generate_link` answered 500 `users_email_partial_key`, admin `PUT /users/<id>` answered 404 `user_not_found`. Unblocked by a decision on GoTrue-shaped seed rows (the lead); `staff` also needs a TOTP factor for aal2. Waiting, not faked: owner B reads A's leads, member A1 sees own leads only, nobody sees nothing (need a token); lead-update, publish, add-lead checks (need the slice 2 functions).
- **`lead send` / `verify --only lead` against the deployed function**: the model of `capture-lead` (`test/harness.mjs`) reads keys the way the function does (`service.active_key` joined to the Vault view), but the deployed run belongs to the step 2 session. `key mint` and `seed test` were observed working on staging (the `(id, email)` insert and `vault.create_secret` through the pooler).
- Slice 2 (function paths for save, publish, export, job callback, lead update, add lead) and slice 3 (`onboard`) are not built.

## Tests
`node tools/omnikom-cli/test/run.mjs [--unit|--db]` (units + a throwaway cluster; the cluster takes minutes to start on this machine) and `node tools/omnikom-cli/test/mutate.mjs` (one rule removed per mutant, all must go red).
