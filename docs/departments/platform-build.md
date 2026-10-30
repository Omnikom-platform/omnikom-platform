# Department: Platform build (`platform-build`)

Created 2026-10-30 by the lead session (DECISIONS 33). Rules for every department: `docs/departments/README.md`.

## Mission
Build the platform in the order of `docs/blueprint/25-BUILD-SEQUENCE.md`: the database and its walls, the Edge Functions, the
factory and the deploy pipeline, the dashboard, production, the first live client. One session per step (DECISIONS 32), each
proven on staging through the CLI the testing department provides.

## Owns
- `supabase/`
- `factory/`
- `contracts/`
- `docs/blueprint/` except `docs/blueprint/26-PLATFORM-CLI.md` and except `docs/blueprint/22-SEARCH-AND-ANALYTICS.md`
- `sites/`
- `tools/deploy-capture-lead.mjs`
- `tools/mint-site-key.mjs`
- `tools/dns-upsert.mjs`
- `tools/staging-extensions.mjs`
- `tools/check-platform-keys.mjs`

## Does not touch
Every path not listed above. In particular `tools/omnikom-cli/` (the testing department's): a step session that needs a new CLI
command sends the need up as a finding; the CLI department builds it. A bug or a need in another department's files is a finding
sent to the head of operations with options, never a fix made here.

## Head session
- Model: fable. There is no standing head: each step of the build sequence is its own fable session started by the head of
  operations with the step's brief (DECISIONS 32); that session acts as this department's head for the step.
- Reads first, in order: `CLAUDE.md`, this charter (whole file, the position log last), `.claude/POSITION.md` (last blocks),
  `planning/DECISIONS.md` (newest items), `docs/blueprint/25-BUILD-SEQUENCE.md` (its step), `docs/blueprint/23-GROUND-RULES.md`,
  then the files its step names.
- Does: the step's numbered items in order; may start sonnet builders for mechanical pieces (a migration against a written
  spec, a port of a script) and re-runs their proof; pastes real output into `docs/blueprint/PROGRESS.md`; ticks the sequence;
  appends to the position log below and to `.claude/POSITION.md`; commits and pushes after a clean gitleaks; reports to the head
  of operations in two lines; stops at the step's "done when" or at BLOCKED.

## Builders
- Model: sonnet for a mechanical, well-specified piece; fable when the piece is design or an unknown root cause.
- One piece, one brief, discarded when done. The brief carries the spec file and line, the gate command, the rules below, and
  "anything outside this brief is a finding you send back, not a fix".

## Rules that bind this department
- `docs/blueprint/23-GROUND-RULES.md`: a new wall ships with a test watched red and a mutant in `supabase/tests/run-local.mjs`;
  T14 stays green; `node docs/blueprint/specs/run-all-gates.mjs` before saying done.
- A fixture in a wall test is written the way the production tool writes it, or the test calls the tool (ground rule 13, from the
  `active_key` bug of 2026-10-30).
- Never edit an applied migration; write a new one. Production receives only migrations proven on staging (DECISIONS 15, 27).
- Keys by variable name only (CLAUDE.md rule 9); live things need the owner's click (rules 6 and 12); nothing against a client
  project or site (DECISIONS 30: ELEV8 is touched only in step 7); no em dashes in any file.

## Proof
- `node docs/blueprint/specs/run-all-gates.mjs`: every line PASS, "all gates passed".
- On staging, through the CLI: `omnikom status --target staging` (migrations applied, functions deployed), `omnikom test walls`,
  `omnikom verify --only lead` (and the suites that land with each function), every line PASS, pasted in PROGRESS.md.
- The step's own "done when" line in `25-BUILD-SEQUENCE.md`, observed.

## Decisions that shape this department
- DECISIONS 15 (staging and production projects, no Docker), 21 (backend first, fewest screens), 22 (free tiers baseline),
  25 (proof on staging before the dashboard), 26 to 29 (domains, GitHub, hosting, setup decisions), 30 (the CLI tests the
  platform), 31 (branding and exit), 32 (one session per step), 33 (departments).

## Open items
- Step 3 (database leftovers: migration for security events, consent ledger, privacy requests, workspace lifecycle, quotas,
  narrower function role, append-only audit; doc drift list 24-GAP-HUNT F; `supabase/auth-settings.md` against staging).
- `capture-lead` answers a paused site with 500, not S-SITE-PAUSED (finding from the CLI department, 2026-10-30).
- `tools/deploy-capture-lead.mjs` prints the project ref inside the Supabase CLI's dashboard line (scrub when next touched).
- `supabase/tests/test-apply.mjs` hangs locally (exit 124, no output; UNPROVEN since 2026-10-30 01:30).

## Position log (append-only, newest last; one line per finished slice or blocked item: date, slice, PROVEN / BLOCKED, where the proof is)
- 2026-10-30: department created. Steps 1 and 2 DONE (PROGRESS.md "Step 1.1 + step 2.1", "Step 2"); migration 6 applied on
  staging (active_key by site).
