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
- Slice 1 part 2 in progress (2026-10-30): person tokens over HTTP (GoTrue-shaped seeded logins, generateLink + verify),
  the person checks of spec section 4, staff at aal2 if the MFA API makes it cheap.
- Slice 2 (as the functions land in build step 4): save, publish, export, job-callback, lead-update, add-lead paths; `verify`
  grows one check per wall.
- Slice 3 (build steps 6 and 7): `onboard`, `offboard` (DECISIONS 31), `drift`, the Cloudflare API calls.
- Client stand-in flows beyond leads: a content edit and publish as a member, a CRM push, a booking (when the add-on exists).
- `omnikom audit` gates from the PEWP skill (the future SEO and audits department supplies the rules; this department holds the
  command shape and the test pattern).

## Position log (append-only, newest last; one line per finished slice or blocked item: date, slice, PROVEN / BLOCKED, where the proof is)
- 2026-10-30: department created. Slice 1 PROVEN locally (145 of 145, 67 of 67 mutants) and on staging through step 2
  (`verify --only lead` 12 of 12, `verify --only walls` 5 of 5); person tokens BLOCKED on GoTrue-shaped logins, decision taken
  (POSITION.md 19:00 block), builder cli-slice-1 on it.
