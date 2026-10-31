# Department: CLI and testing tooling (`cli-and-testing`)

Created 2026-10-30 by the lead session (DECISIONS 33). Rules for every department: `docs/departments/README.md`.

## Mission
Own the `omnikom` CLI: the platform's client stand-in and test harness (DECISIONS 30) and the staff tool. It mimics every real
caller (a website sending a signed lead, a signed-in person, the build runner, cron) against staging, proves every wall over
HTTP, seeds test workspaces, mints keys, pushes content and publishes, so the platform is tested end to end without a dashboard
or a client. Every check a department learns to make becomes a CLI command or gate here, with tests and mutants, so no session
has to relearn it (README rule 5). Spec: `docs/blueprint/26-PLATFORM-CLI.md`.

## Owns
- `tools/omnikom-cli/`
- `docs/blueprint/26-PLATFORM-CLI.md`
- `tools/crm-map/`
- `tools/test/`
- `tools/with-env.mjs`

## Does not touch
Every path not listed above. In particular `supabase/` (migrations, functions, the SQL wall tests) and `factory/`: a bug the CLI
finds there is a finding sent to the head of operations with options and the evidence (the command, the real output, the
read-only query), never a fix made here; the fix comes back as a migration or a function change by the platform department, and
this department then proves it over HTTP.

## Head session
- Model: fable. Started by the head of operations with a brief that names this file; long-lived across slices; hands over
  through this charter's position log when its context is full.
- Reads first, in order: `CLAUDE.md`, this charter (whole file, the position log last), `.claude/POSITION.md` (last blocks),
  `planning/DECISIONS.md` items 30, 32, 33, `docs/blueprint/26-PLATFORM-CLI.md` (whole), `tools/omnikom-cli/README.md`.
- Does: keeps `26-PLATFORM-CLI.md` as the spec (sections 6 and 7: slices planned and slices as built); splits each slice into
  builder briefs; starts one sonnet builder per slice; re-runs each builder's proof itself (the test suite, the mutants, and the
  staging run through `with-env`); appends one line per finished slice to the position log below; reports to the head of
  operations in two lines (what is PROVEN on staging, what is open or BLOCKED).

## Builders
- Model: sonnet per slice (a slice is one section of the spec: a command group, a verify suite, a client stand-in flow).
- Mechanical runs (tests, mutants, gates, grep, fixture rebuilds, deploy and status commands) go to a haiku agent with the
  exact command; the head or builder reads the verdict lines back (DECISIONS 34).
- One slice, one brief, discarded when done. The brief carries: the spec section, the files, the gate commands
  (`node tools/omnikom-cli/test/run.mjs`, `node tools/omnikom-cli/test/mutate.mjs`, the staging command through
  `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- ...`), the five rules of the spec's section 5, and
  "anything outside this brief is a finding you send back, not a fix".

## Rules that bind this department
- The spec's section 5: secrets by name only and never in output (a test asserts it); production refused for everything but
  `status` and `apply --i-mean-production`; fixtures synthetic, `--real` for anything else; every command idempotent where a
  retry is possible; no dependencies, Web Crypto, psql, fetch; tests and mutants, hygiene and production guard watched red first.
- A model of a platform function in the test harness reads the same tables and functions the real function reads (keys through
  `service.active_key` and the Vault view, never from memory): the `active_key` bug of 2026-10-30 hid behind a model that did not.
- Staging commands that write (`seed test`, `key mint`, `lead send`, `verify`) run only inside a slice the head of operations
  released; `lead send` sends a real alert email and is never looped.
- Keys by variable name only (CLAUDE.md rule 9); live things need the owner's click (rules 6 and 12); nothing against a client
  project or site; no em dashes in any file.

## Proof
- `node tools/omnikom-cli/test/run.mjs`: "OK: N of N checks passed"; `node tools/omnikom-cli/test/mutate.mjs`: "N mutants, N caught,
  0 survived, 0 target text missing".
- On staging: `omnikom status --target staging` green; every `verify --only <suite>` line PASS, pasted into
  `docs/blueprint/PROGRESS.md` under the slice's heading; the README's BLOCKED list shrinks and never grows silently.

## Decisions that shape this department
- DECISIONS 30 (the platform tests itself through its own CLI; a client's preview is never a test vehicle), 32 (findings go
  up, fixes are routed), 33 (departments; README rule 5: a learned check becomes a command).

## Open items
Builder briefs live in `tools/omnikom-cli/briefs/` (one file per slice; `README.md` there is the index). A brief is started only
when the head of operations has released its slice.
- Slice 2 (brief `briefs/slice-2-functions.md`; waits for build step 4): save, publish, export, job-callback, lead-update, add-lead
  paths; `verify` grows one check per wall (the three `waiting` checks of the `people` suite move here).
- Client stand-in flows beyond leads (brief `briefs/stand-in-flows.md`; waits for slice 2 and `push-lead`): a content edit and
  publish as a member, a CRM webhook push through `tools/crm-map`, `lead day`; a booking when the add-on exists.
- Slice 3 (placeholder `briefs/slice-3-onboard.md`; build steps 6 and 7): `onboard`, `offboard` (DECISIONS 31), `drift`, the
  Cloudflare API calls.
- UNPROVEN on staging: `mfa enroll-staff` removing a stale TOTP factor (model only). Known: a paused site answers 500 over HTTP
  (the function's catch-all; S-SITE-PAUSED not visible), a finding for the platform department, recorded 2026-10-30.
- DONE 2026-10-31: `omnikom audit --dir` and `omnikom gate --dir` (brief `briefs/audit-gate-commands.md`; the SEO department's
  engine supplies the rules, this department holds the command shape). Re-run the CLI gates once the SEO department commits its
  open `tools/audit/` edits (17 rules, `live.mjs`, snapshot fixtures): the tests take the counts from the engine, so they should hold.
- Key numbering and lead ledgers (brief `briefs/key-numbering-and-lead-ledgers.md`; released 2026-10-30 22:40): `key mint` numbers
  from the highest existing name and rewrites the env file; `verify --only lead` asserts `security_events` and `consent_ledger` rows
  and the 409 of a paused site. Runs next (shared test files).
- Seed test site and status (brief `briefs/seed-test-site-and-status.md`; released 2026-10-31 03:10 after slice 4.1): `seed test`
  seeds contract version 2 and every row of `sites/test-demo-a/rows.json` for workspace A (team rows with slug and role: the
  platform head's finding), `status` shows the `omnikom_fn` role and the migration counts. After the key slice.
- Findings sent up 2026-10-31 (for the SEO head): `audit(dir, { rules: [''] })` ran zero rules and passed (fixed in the SEO session's
  open edits the same night); `gate` obeys an `audit.config.json` inside the audited folder (engine design, for the owner to know).
  For the platform head: the privacy-requests read wall of `tenancy.test.sql` failed under load in one CLI suite run and in one
  `run-all-gates` run ("B's owner reads no request of A"), and passed alone; the head of operations has it on record (01:40).

## Position log (append-only, newest last; one line per finished slice or blocked item: date, slice, PROVEN / BLOCKED, where the proof is)
- 2026-10-30: department created. Slice 1 PROVEN locally (145 of 145, 67 of 67 mutants) and on staging through step 2
  (`verify --only lead` 12 of 12, `verify --only walls` 5 of 5); person tokens BLOCKED on GoTrue-shaped logins, decision taken
  (POSITION.md 19:00 block), builder cli-slice-1 on it.
- 2026-10-30 20:30: slice 1 CLOSED (parts 1 and 2), PROVEN by the head's own re-run of commit 82bc2f8: staging `status` green,
  `verify` lead 12 / walls 5 / people 15 all PASS, 0 leads left; local run 168 of 168, mutants 83 of 83 caught. Proof lines in
  PROGRESS.md "Migration 6 and CLI part 2", "Head's re-run". Builder cli-slice-1 discarded. Charter finding sent up: the builder
  edited `supabase/tests/local-shim.sql` before `supabase/` was reserved (committed, green, not reverted). Next: slice 2 on release.
- 2026-10-30 20:47: report line corrected by the head of operations: its session is `local_f58886f2-26f1-4f9f-bc47-913ce5b0c4d1`
  (the id `local_a1b5596a...` in the first brief was the previous head). This head's own id: `local_c8848ce4...`; the builder
  cli-slice-1 is `local_480469e1...` (idle). Slice 1 close accepted by the head of operations; slice 2 waits for step 4.
- 2026-10-31 04:40: audit and gate commands PROVEN (Sonnet builder on `briefs/audit-gate-commands.md`, in-session agent; the head's own
  Haiku re-run: `test/run.mjs` 213 of 213, `test/mutate.mjs` 110 of 110 caught, the six command runs on the fixtures at 17 rules).
  Proof lines in PROGRESS.md "CLI: audit and gate commands"; spec section 7 updated. One surviving mutant after the engine started
  refusing an empty rules list itself was closed by asserting the CLI's own message. Next: the key-numbering slice, then the seed-test
  slice (both released).
