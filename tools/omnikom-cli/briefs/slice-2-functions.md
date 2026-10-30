# Brief: omnikom CLI slice 2, the function paths (Sonnet builder; one slice, one brief, discarded when done)

Status: WAITING for release by the head of operations. It is released when build step 4 (`docs/blueprint/25-BUILD-SEQUENCE.md`)
has deployed `save`, `publish`, `export-published`, `job-callback`, `lead-update` and `add-lead` to staging and
`omnikom status --target staging` lists them as deployed. Do not start before the head of the CLI department says go.

## Read first, in order
1. `CLAUDE.md` (the non-negotiables), `docs/departments/README.md` (the six rules), `docs/departments/cli-and-testing.md`
   (your department; you edit only what it owns).
2. `docs/blueprint/26-PLATFORM-CLI.md` whole: section 3 (the commands table, column "Behind it"), section 4 (`verify`),
   section 5 (the five rules), section 6 (slice 2), section 7 (slice 1 as built: what exists and what was decided).
3. `tools/omnikom-cli/README.md`, then the code: `omnikom.mjs`, `lib/fn.mjs` (how a function is called and signed),
   `lib/identity.mjs` (person tokens, machine keys), `commands/lead.mjs`, `commands/content.mjs`, `commands/publish.mjs`,
   `commands/verify.mjs`, `test/harness.mjs` (the model of a function over a fake fetch), `test/run.mjs`, `test/mutate.mjs`.
4. The function contracts you call: `docs/blueprint/02-BACKEND.md` section 6 (the table), `docs/blueprint/07-SPECS.md` section 2
   (`specs/openapi.json`) and section 5 (error codes), the functions' own source under `supabase/functions/<name>/` as deployed.

## The slice
Today `lead update|add`, `content save`, `publish`, `job set` and `export` go over SQL (`service.*` with claims) or do not exist.
Slice 2 makes each one go the way the real caller goes, and keeps the SQL path behind a flag for comparison.
1. `content save --as member-a1 --collection <c> --file row.json` calls the `save` function with the person's session token
   (`lib/identity.mjs personToken`), expecting the function's codes (`I-*` 422, `S-NOT-FOUND` 404 for a non-member, `S-SINGLETON` 409).
   `--via sql` keeps the slice 1 path.
2. `publish --as <person> --site <s> --rows <ids> [--versions ...]` calls the `publish` function (202 queued, `job_id` in data);
   `--via sql` keeps `service.start_publish`.
3. `export --job <id> --as runner` calls `export-published` signed with `RUNNER_KEY` (`X-Runner-Signature`, the same canonical
   form as `lib/sign.mjs`); prints the export with the deploy token REDACTED (`lib/redact.mjs` must catch it; add a test that
   it does, watched red first). `job set --via function` becomes `job callback --job <id> --state <s> [--report f] --as runner`
   calling `job-callback` (409 `S-JOB-STATE` on an illegal transition).
4. `lead update --as member-a1 --id <lead> --status <s>` calls `lead-update`; `lead add --as member-a1 --site <s> --fixture f`
   calls `add-lead`. The SQL path stays under `--via sql`.
5. `verify` grows one check per wall, in the suite the wall belongs to (`lead`, `walls`, `people`, and a new `publish` suite):
   member A1 updates A2's lead (expect `S-NOT-FOUND`); member A1 publishes A2's listing (expect `S-OWN-ONLY`); a member adds a
   lead for someone else (forced to themselves); a non-member saves into A (expect 404 before any validation detail); a publish of
   a row version that is not the latest (expect 422 or the code the spec names); `job-callback` with a bad runner signature (401),
   with an illegal transition (409), a replayed signature after 301 s (401); `export-published` unsigned (401). Each check moves
   out of the `waiting` list of `verify.mjs` the moment it runs; the list never grows silently.
6. `test/harness.mjs` gets a model of each new function that reads the same tables and functions the real function reads
   (the slice 1 lesson: the model of `capture-lead` checked signatures against keys in memory and hid the `active_key` bug for a
   day). Every new rule has a test watched red and a mutant in `test/mutate.mjs`.
7. `status` lists the six new functions in its "functions deployed" line; `README.md` and `26-PLATFORM-CLI.md` section 7 get a
   "Slice 2 as built" paragraph (what is proven on staging, what was decided where the spec was silent, what is waiting).

## Files you may edit
`tools/omnikom-cli/**` (code, tests, fixtures, README), `docs/blueprint/26-PLATFORM-CLI.md` section 7 only, your slice heading in
`docs/blueprint/PROGRESS.md`. Nothing else. A bug in `supabase/` or `factory/` or in a deployed function is a finding you send
to your head with the command, the real output and a read-only query, never a fix.

## The five rules of spec section 5 (verbatim, they bind every line you write)
1. Secrets by variable name only; the CLI never prints, logs or echoes a value, and `--json` output redacts anything that looks
   like a key (a test asserts it).
2. Production is read-only except `apply --i-mean-production`; identity, seed and verify commands refuse a production target
   (a test asserts it with a fake `PROD_DB_URL`).
3. Fixtures are synthetic; a command that would store client data needs an explicit `--real` flag and prints a warning.
4. Every command is idempotent where a retry is possible (`seed test` twice changes nothing; `lead send --retry` stores nothing).
5. No dependencies; Web Crypto for signatures (the same `sign` as the endpoint); `psql` for SQL paths; `fetch` for functions.

## Gates (run them yourself; paste the real output into PROGRESS.md under your heading)
- `node tools/omnikom-cli/test/run.mjs` must end `OK: N of N checks passed` (the throwaway cluster takes minutes; run in the background).
- `node tools/omnikom-cli/test/mutate.mjs` must end `N mutants, N caught, 0 survived, 0 target text missing`.
- On staging, every command through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs <cmd> --target staging`:
  `status` green with the six functions deployed; `verify --only lead`, `--only walls`, `--only people`, `--only publish`: every
  line PASS, exit 0. `lead send` sends a real alert email and is never looped (the `verify --only lead` suite sends what it needs, once).
- `node docs/blueprint/specs/run-all-gates.mjs` stays green (you touch nothing it covers, so a red there is a finding, not your fix).
- Commit only after a clean `gitleaks protect --staged`; push `master` to `backup-gh`. Never `film/`.

## Report
Two lines to the head of the CLI department when done or BLOCKED: what is PROVEN on staging (suite and count), what is open.
Outputs go into PROGRESS.md, never into the message. Two failed approaches to one obstacle = BLOCKED with what unblocks it.
Anything outside this brief is a finding you send back, not a fix.
