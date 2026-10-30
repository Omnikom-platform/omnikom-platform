# 26 The platform CLI (`omnikom`): the harness sessions test with, the tool staff operate with, the kit sites embed

Written 2026-10-29 with the owner ("a CLI tool that sessions use, calling the database and the same endpoints the websites use,
as the tester for contracts, lead funnels and content pushing"). Scope picked: test harness AND staff tool, never
client-facing. Design here, build by a Sonnet builder session in two slices (section 6).

## 1. What it is in one paragraph
One Node program, `node tools/omnikom-cli/omnikom.mjs <command>`, with no dependencies beyond Node 20+ and `psql` on the path.
It speaks to the platform exactly as the three real callers do: as a website (signed with a site key), as a build runner (signed
with the runner key), and as a signed-in person (a Supabase session token). Every command prints one JSON object, takes an
`--expect` so a mismatch is a non-zero exit, and never prints a secret. A file of commands is therefore a test, and a session
reads results as data, not prose.

## 2. Targets and identities
- `--target staging | local | production`. Reads the connection and keys by variable name from the environment
  (`STAGING_DB_URL`, `STAGING_SUPABASE_REF`, `STAGING_SUPABASE_SECRET_KEY`, `STAGING_SUPABASE_PUBLISHABLE_KEY`, the `PROD_` set,
  or a local URL). Production is refused for every identity, seed and verify command; only `apply --i-mean-production` and
  read-only `status` are allowed there.
- **Person identities (staging and local only):** `--as owner-a | member-a1 | member-a2 | owner-b | staff | nobody`. These are the
  seeded test logins of workspaces A and B (the same fixtures as `tenancy.test.sql`, created once by `omnikom seed test`). The
  CLI mints a session token for them through the Auth admin API with the secret key (UNVERIFIED which admin call gives a usable
  access token without email; candidates: `generateLink` + `verifyOtp`, or a password set on the test users only). The token is
  held in memory for the run, never written.
- **Machine identities:** `--as site:<slug>` signs with `SITE_SIGNING_KEY_<SLUG>` (the same canonical form as
  `factory/worker/lead-endpoint.mjs`); `--as runner` signs with `RUNNER_KEY`; `--as cron` sends `X-Internal-Secret`.

## 3. Commands (what exists behind each, and when it works)
| Command | Does | Behind it | Works |
|---|---|---|---|
| `status` | project reachable, migrations applied (ledger), functions deployed, keys present by name | `platform_migrations`, `check-api-keys` | slice 1 |
| `apply` | applies pending migrations (`apply-staging.mjs` as a library) | exists | slice 1 |
| `test walls` | runs `tenancy.test.sql` on the target (rolled back) | `run-staging.mjs` | slice 1 |
| `seed test` | creates workspaces A and B, their sites, contracts, test logins (staging/local only) | `tenancy.test.sql` fixtures as a script | slice 1 |
| `seed workspace --plan <dir>` | a real client from an approved plan: workspace, site, contract, pages, places (W1.1) | `contracts/from-plan.mjs`, `service.seed_version` | slice 1 (SQL path) |
| `key mint --site <slug>` | site signing key into Vault + registry + the .env by name | `mint-site-key.mjs` | slice 1 |
| `key list / revoke` | the `api_keys` registry, never values | table | slice 1 |
| `lead send --site <slug> --form contact --fixture <file>` | a lead exactly as a website sends it: signed, with idempotency key; `--retry` resends the same key | `capture-lead` function | slice 1 (needs the function deployed) |
| `lead list --as owner-a`, `lead get`, `lead update --status`, `lead add` | what the dashboard will do | `lead-update`, `add-lead` functions (SPEC); until then the SQL service functions over the direct connection with claims (`service.lead_update(claims, ...)`) | slice 1 via SQL, slice 2 via functions |
| `content save --as member-a1 --collection listings --file row.json`, `content get`, `content history` | the content path | `save` function (SPEC); slice 1 via `service.save_as` over SQL | slice 1 via SQL, slice 2 via functions |
| `publish --site <slug> --rows ...`, `job get`, `job wait` | a publish job and its states | `publish`, `job-callback` (SPEC); slice 1 via `service.start_publish` and `set_job_state` | slice 1 via SQL, slice 2 via functions |
| `export --job <id> --as runner` | what the build reads | `export-published` (SPEC) | slice 2 |
| `contract validate --file`, `contract place --rows` | the contract library | `contracts/validate.mjs`, `place.mjs` | slice 1 |
| `verify` | the wall suite over HTTP (section 4) | the functions | slice 1 for the lead function; grows with slice 2 |
| `onboard --slug --domain --pages-project` | the tenant onboarding job (staff): zone, Pages project, variables, key, seed, drift check | Cloudflare API, Supabase | slice 3 (after step 4 of the build sequence) |
Every command: `--expect <http status or S-/B-/M- code>`, `--json` output always, exit 0 on match, 1 on mismatch, 2 on usage,
3 on BLOCKED (missing key by name, target refused). A `--fixture` is a JSON file under `tools/omnikom-cli/fixtures/` (fake
people, example.com addresses, 555 numbers; never client data).

## 4. `verify`: the walls over HTTP (the proof the SQL tests cannot give)
A fixed script of commands with expectations, run against a target where the functions are deployed:
owner B reads A's leads (expect 0 rows), member A1 updates A2's lead (expect S-NOT-FOUND), member A1 publishes A2's listing
(expect S-OWN-ONLY), a lead with an empty consent (expect 400), a lead signed with B's key to A's site id (expect 401), the same
signature replayed after 301 s (expect 401), the same idempotency key twice (expect one row), a lead to a paused site (expect
S-SITE-PAUSED), nobody calls every function (expect 401 or S-NOT-FOUND each), anon calls a service function (expect refused).
Output: one line per check with PASS or FAIL and the real status; exit 1 on any FAIL. This is the acceptance of step 2 and of
every function that lands later; `e2e-lead.mjs` becomes `omnikom verify --only lead` plus `omnikom lead send --site elev8`.

## 5. Rules that bind the tool
1. Secrets by variable name only; the CLI never prints, logs or echoes a value, and `--json` output redacts anything that looks
   like a key (a test asserts it).
2. Production is read-only except `apply --i-mean-production`; identity, seed and verify commands refuse a production target
   (a test asserts it with a fake `PROD_DB_URL`).
3. Fixtures are synthetic; a command that would store client data needs an explicit `--real` flag and prints a warning.
4. Every command is idempotent where a retry is possible (`seed test` twice changes nothing; `lead send --retry` stores nothing).
5. No dependencies; Web Crypto for signatures (the same `sign` as the endpoint); `psql` for SQL paths; `fetch` for functions.
6. Tests: `tools/omnikom-cli/test/run.mjs` (units with a fake fetch and a throwaway local cluster) and `mutate.mjs`; the hygiene
   test (no secret in output) and the production guard are watched red first.

## 6. Build slices
- **Slice 1 (now, Sonnet builder):** the program skeleton, targets, machine identities, `status`, `apply`, `test walls`,
  `seed test`, `key`, `contract`, `lead send` (against the deployed `capture-lead` when staging exists; the fake-fetch tests
  before), the SQL-path `lead`, `content`, `publish`, `job` commands, `verify --only lead`, tests and mutants.
  Done when: tests and mutants green locally; `omnikom status --target local` and `omnikom seed test --target local` work on a
  throwaway cluster; `omnikom lead send --site elev8 --target staging` prints PASS once step 1.1 and step 2 exist.
- **Slice 2 (as the functions land, step 4 of the build sequence):** the function paths for save, publish, export, job
  callback, lead update, add lead; `verify` grows one check per wall.
- **Slice 3 (step 6 and 7):** `onboard`, `offboard`, `drift`, the Cloudflare API calls.
Person identities (section 2) need the staging Auth admin API: UNVERIFIED until step 1.1 exists; slice 1 ships them with a
clear BLOCKED message until then.

## 7. Slice 1 as built (2026-10-30, `tools/omnikom-cli/`, README there)
**Built and proven locally** (`test/run.mjs`: units plus a throwaway-cluster run with a fake fetch; `test/mutate.mjs`: one rule
removed per mutant, all caught): the entry and exit codes, targets and the production guard, machine identities and person
claims, `status`, `apply`, `test walls`, `seed test` (twice changes nothing, `--clean`), `seed workspace` (SQL path, from a
`contracts/from-plan.mjs` contract), `key mint|list|revoke`, `contract validate|place`, `lead send|list|get|update|add|delete`,
`content save|get|history`, `publish`, `job get|wait|set`, `verify --only lead`. The five rules of section 5 each have a test
watched red and a mutant.
**BLOCKED / UNPROVEN until the staging project exists:** (1) person TOKENS for the HTTP path (`lib/identity.mjs personToken`;
which Auth admin call returns one is UNVERIFIED); (2) everything that talks to the DEPLOYED `capture-lead` (`lead send`,
`verify`, the functions column of `status`): proven only against a MODEL of the function over a fake fetch, not the function;
(3) `seed test` inserts `auth.users` by `(id, email)`: UNVERIFIED on Supabase; (4) `key mint` against the real
`vault.create_secret` (a model is used locally); (5) slices 2 and 3.
**Decided where the spec was silent:** default target is `local`; production runs only `status` (connection opened read-only) and
`apply --i-mean-production`, everything else is refused with exit 3 before anything is spawned (stricter than "identity, seed
and verify"); `--expect` compares the result `code` (HTTP status, platform code such as `S-NOT-FOUND`, or `ok`); output is always
JSON (`--json` only makes it one line); on the SQL path a person is the JWT claims given to `service.*` (reads run as
`authenticated`, so RLS decides); `cron` signs nothing and sends `CRON_SECRET` as `X-Internal-Secret`; `--site` is a uuid, a
`SITE_ID_<SLUG>` variable, or a workspace slug / deploy target looked up in the database, and the key variable is
`SITE_SIGNING_KEY_<WORKSPACE SLUG>`; `lead send --retry` sends the same key twice and counts rows (must be 1); added
`seed test --clean` (the walls test and the seeded fixtures cannot share a database), `lead delete`, `job set` (the runner's
stand-in on the SQL path), and `key mint` numbers its keys itself (rotation); `status` "keys present" lists the TARGET's
variable names as booleans (not the research-key check); a fixture outside `fixtures/` or with a real-looking email or phone
needs `--real`. `apply` and `test walls` run the existing scripts as child processes (they are scripts, not libraries).
**Finding for the function (not changed here):** `capture-lead` answers a paused site with a generic 500 (the catch-all), so the
S-SITE-PAUSED code of section 4 is not visible over HTTP; `verify` checks "not 202 and nothing stored" and prints the real status.
**Verified by the lead session 2026-10-30** (`test/run.mjs` 138 of 138, `test/mutate.mjs` 61 of 61 caught, `status --target
staging` against the real project: 5 migrations applied, `capture-lead` deployed, keys present by name). Second finding, FIXED
the same day: a retried submission made the function alert the client twice (`sendAlert` ran after `service.capture_lead`
returned the existing lead id; `service.record_message` has no per-lead dedupe). The function now skips the alert when a
`messages` row (that lead, template `new-lead`) exists; `verify` gained check "a retry sends no second alert" (11 checks), the
test model records alerts like the function (`doubleAlert` = the bug, caught by the suite), and a mutant removes the check.
