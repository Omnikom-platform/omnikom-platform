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

Identities: `owner-a owner-b member-a1 member-a2 staff nobody` (claims on the SQL path), `site:<slug>` (`SITE_SIGNING_KEY_<SLUG>`), `runner` (`RUNNER_KEY`), `cron` (`CRON_SECRET`).
Production runs only `status` (read-only connection) and `apply --i-mean-production`; every other command is refused (exit 3) before anything is spawned.
Fixtures live in `fixtures/` and are synthetic (example.com, 555); anything else needs `--real` and prints a warning.

## BLOCKED until a staging project exists
- **Person identities over HTTP** (a session token for `owner-a` ...): which Auth admin call returns a usable token without email is UNVERIFIED (`generateLink` + `verifyOtp`, or a password on the test users). `lib/identity.mjs personToken` says BLOCKED.
- **`lead send` / `verify` / `status` functions column against a real project**: proven only against a MODEL of `capture-lead` over a fake fetch on a throwaway cluster (`test/harness.mjs`), not the deployed function. `seed test` on Supabase inserts into `auth.users` by `(id, email)`: UNVERIFIED there. `key mint` needs the real `vault.create_secret` (a model is used locally).
- Slice 2 (function paths for save, publish, export, job callback, lead update, add lead) and slice 3 (`onboard`) are not built.

## Tests
`node tools/omnikom-cli/test/run.mjs [--unit|--db]` (units + a throwaway cluster; the cluster takes minutes to start on this machine) and `node tools/omnikom-cli/test/mutate.mjs` (one rule removed per mutant, all must go red).
