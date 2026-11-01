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
- `tools/hooks/` (Claude Code hooks this department builds; DECISIONS 41)

## Does not touch
Every path not listed above. In particular `supabase/` (migrations, functions, the SQL wall tests) and `factory/`: a bug the CLI
finds there is a finding sent to the head of operations with options and the evidence (the command, the real output, the
read-only query), never a fix made here; the fix comes back as a migration or a function change by the platform department, and
this department then proves it over HTTP.

## Head session
- Model: opus (DECISIONS 40). Started by the head of operations with a brief that names this file; long-lived across slices; hands over
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
- Slice 2 (brief `briefs/slice-2-functions.md`, to be rewritten before a builder starts): RELEASED 2026-10-31 06:40 by the head of
  operations after platform slice 4.2 (commit ab2ed36): save, publish, lead-update, add-lead, upload-start, upload-finish are deployed
  on staging, migrations 9 and 10 applied; paths and bodies are `docs/blueprint/specs/openapi.json`; the platform head's e2e is in
  PROGRESS.md "4.2 dashboard functions: head's verification". `verify` grows one check per wall (the three `waiting` checks of the
  `people` suite move here). Runs after the key-numbering slice and the model switch, before or alongside seed test. Findings to
  put in the brief: (1) the save path sends the claims as an object; (2) `status` must skip a function folder that `config.toml`
  disables (`supabase/functions/test` shows `not deployed` until 4.3 sets `[functions.test] enabled = false`); (3) a missing token
  on staging answers 401 `UNAUTHORIZED_NO_AUTH_HEADER` from the gateway, not the in-code `S-AUTH`: assert the status, not the code.
  Export-published and job-callback (runner-facing) come with 4.3.
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
- Tools and local CI (brief `briefs/tools-and-ci.md`; DECISIONS 42, released 2026-10-31 08:00): `tools.json`, `omnikom tools ensure`
  into `.tools/`, `omnikom ci` running every ci.yml job locally with those binaries. Next after key numbering, before seed test. The
  real downloads and the live `omnikom ci` run wait for the owner's yes in chat.
- Seed test site and status (brief `briefs/seed-test-site-and-status.md`; released 2026-10-31 03:10 after slice 4.1): `seed test`
  seeds contract version 2 and every row of `sites/test-demo-a/rows.json` for workspace A (team rows with slug and role: the
  platform head's finding), `status` shows the `omnikom_fn` role and the migration counts. After the key slice.
- Backlog, after the seed-test slice (recorded 2026-10-31 06:20 from the head of operations; DECISIONS 41; do not start before):
  `tools/hooks/big-output.mjs`, a Claude Code PostToolUse hook for the Bash tool. It reads the hook JSON on stdin; when the tool
  output exceeds 12 KB it writes the full text to `<session scratchpad>/big-output/<timestamp>-<short hash>.txt` and replaces what
  the model sees with the first 40 and last 40 lines plus one line `FULL OUTPUT: <path> (<bytes> bytes, <lines> lines)`, nothing
  else; under the limit the output passes through unchanged; it never touches stdin files and never runs anything. Measured standard
  for scripts (windows-scripting.md, fresh review, watched-fail), test file `tools/hooks/test/big-output.test.mjs` with a mutant run,
  CRLF-safe, no dependencies. Done when: the test is green after a watched red, and a by-hand run piping a sample hook JSON through
  it shows the saved file and the trimmed output. Registering it in the owner's `~/.claude/settings.json` is the owner's click.
- Findings sent up 2026-10-31 (for the SEO head): `audit(dir, { rules: [''] })` ran zero rules and passed (fixed in the SEO session's
  open edits the same night); `gate` obeys an `audit.config.json` inside the audited folder (engine design, for the owner to know).
  CLOSED 2026-10-31 05:45 (head of operations): the "flaky privacy-requests wall" seen in one CLI suite run and one `run-all-gates`
  run was the gates runner killing the walls gate at 30 minutes under load and printing the last caught-mutant line as the failure;
  the platform head fixed the runner (honest TIMEOUT line, 60-minute limit, watched red). Nothing to change in the CLI.

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
- 2026-10-31 06:20: backlog slice recorded, not started: the big-output PostToolUse hook (`tools/hooks/big-output.mjs`, DECISIONS 41),
  after the seed-test slice; `tools/hooks/` added to Owns. Model switch pending (DECISIONS 40): this head finishes the key-numbering
  slice on Fable, commits, says "boundary", and continues on Opus 5.5 with the seed-test slice.
- 2026-10-31 07:45: seed-test brief gained item 5a (head of operations): `seed test` runs on top of the platform head's own staging seed
  of contract v2 and the test-demo-a rows (content compare, more-than-one match fails, legacy team rows found by name, media key aligned
  with the platform script); that script's PROGRESS.md entry is read into the brief before the builder starts. Slice 2 brief rewritten
  (`briefs/slice-2-functions.md`, `--via function|sql`, `verify --only functions`, the three waiting walls moved in). Order: key
  numbering, seed test, slice 2.
- 2026-10-31 08:05: DECISIONS 42 slice briefed (`briefs/tools-and-ci.md`: `tools.json`, `omnikom tools ensure`, `omnikom ci`), next after
  key numbering and before seed test; `.tools/` added to `.gitignore` (head of operations' grant). Hashes come from the GitHub API's asset
  digests (actionlint's linux digest equals ci.yml's pin). The real binary downloads and the live `omnikom ci` wait for the owner's yes
  in chat (downloads need his explicit approval); the builder proves everything else offline.
- 2026-10-31 12:40: key numbering and lead ledgers PROVEN (Sonnet builder on `briefs/key-numbering-and-lead-ledgers.md`; the head's own
  Haiku re-run: `test/run.mjs` 238 of 238, the 14 new mutants and 6 older ones of the same names caught, run-all-gates passed, staging `status` ok; the builder's full mutant
  run 124 of 124 and staging `verify --only lead` 16 of 16). Proof in PROGRESS.md "CLI: key numbering and lead ledgers"; spec section 7
  updated. Seed-test brief gained: platform script facts (5a), preview host (item 8), the `status` function-folder rule (Part 2), an
  isolated `test walls` that leaves test-demo-a unchanged (Part 3). Next: tools and CI (offline proof), then seed test.
- 2026-10-31 18:30: tools and local CI PROVEN offline (Sonnet builder on `briefs/tools-and-ci.md`; the head's Haiku re-run on a clean
  copy: 303 of 303, the "tools" (21) and "ci:" (30) mutants all caught, run-all-gates passed); `publish` I-NOT-READY check added; the eeb8431 chain miss and its
  one-line follow-on in `supabase/functions/test/publish.test.ts:115` (landed by platform build as 98c9930). Proof in PROGRESS.md "CLI: tools and local CI".
  NOT DONE: the real downloads and `omnikom ci` (head of operations). Next: `omnikom impact`, gate stamp, pre-push hook (DECISIONS 43,
  builder running on `briefs/impact-stamp-hooks.md`), then seed test.
- 2026-10-31 20:00: `tools ensure` fix (cause of a failed fetch printed, one retry, a `.ok` without the executable hash no longer trusted);
  unit 186 of 186 and its 4 mutants caught on the unit suite; full suite and mutants held for the laptop's load (UNPROVEN). Open: a
  suite-wide guard that fails when a test run changes the repository's `.tools/` (a real download landed there at 15:43 from an
  unidentified run). Proof in PROGRESS.md "CLI: tools ensure, the cause of a failed download".
- 2026-11-01 07:05: DECISIONS 45 slice LANDED as e2b0339 (master), via `omnikom land check/cli-and-testing/impact-hooks-4` itself: lock
  taken, "ci green: e2b0339 run 41270989800, 9 of 9 jobs success", fast-forward a0c544d..e2b0339, lock released. Contents: ghrun verdict,
  pre-push hook (check/** and land-lock allowed, master only with a green run), `omnikom land` with the land lock, gates and stamp removed,
  impact laptop lines, short department names, test cluster sweep, `test/ci-heavy.mjs`, ci.yml (push branches-ignore land-lock; cli job
  runs the full suite and mutants when the change reaches them; platform head OK'd). Clean copy: unit 356 of 356, watched red on the
  branches-ignore line, the heavy step name, the old vault shim and the tar mutant. GitHub: full suite 476 of 476, mutants run on
  41270989800 green; watch-red PROVEN (41267322475: planted db-part failure, cli job red, unit step green).
  The tarPath survivor of 41267322498 (103a502's tar mutant, equivalent on linux) is fixed in e2b0339 (tarPath takes the platform).

## HANDOVER 2026-11-01 07:10 (old head `local_b9f4c687...` to HEAD_CLI-and-testing_2026-11-01; report to HEAD-OF-OPERATIONS_Omnikom_2026-11-01)
- In flight: nothing. No builder running, no open check branch of this department (impact-hooks-2/-3/-4 and watch-red/-2 all deleted).
  Local master = e2b0339; this department has
  nothing staged (the old DECISIONS 43 staging was replaced by the landed slice).
- Uncommitted in the working tree, yours: `tools/omnikom-cli/briefs/seed-test-site-and-status.md` gained an "Update 2026-11-01" section
  (base, the four parts, what a builder may run under the heavy lock, staging commands). Commit it with the seed-test slice.
- Queue, in order (head of operations 2026-11-01 06:25):
  1. `node tools/omnikom-cli/omnikom.mjs hooks install` only when the head of operations says the heads were told.
  2. Seed-test slice: one builder on `briefs/seed-test-site-and-status.md` (closes "staging walls UNPROVEN").
  3. Rewrite `briefs/slice-2-functions.md` against the 5.x functions, then build it.
  4. The big-output hook (DECISIONS 41).
- Rules added 2026-11-01: heavy proof on GitHub (check branch, `omnikom land`); heavy laptop runs only via
  `node ~/.claude/scripts/heavy.mjs -- <cmd>`; the head plans, reviews, lands and reports in two lines; every hands-on task (diagnosing
  a red run, reading CI logs, proof runs) goes to a builder or a Haiku runner. Scope frozen per slice: anything new is a new slice.
- Open findings and items:
  - The real kill test failed once on Linux (41263232641: ping false before the kill) and passed on the next two runs: cause UNPROVEN;
    its detail now records each ping's error if it recurs.
  - heavy.mjs crashed once with EPERM removing its own `.ready` file (routed by the head of operations to its builder).
  - The head of operations' reaper matches `%TEMP%\omnikom-pg-*`; the CLI's clusters are `omnikom-cli-pg-*` (markers in
    `%TEMP%\omnikom-cli-clusters`). Told; not confirmed fixed.
  - SEO's uncommitted `tools/audit` edits make two CLI audit unit checks fail in the shared working tree; clean copies pass.
  - `.claude/POSITION.md` still mentions the stamp; PROGRESS.md, spec 26 section 7 and a POSITION block for 103a502 onward are NOT DONE.
  - `%TEMP%` holds about 225 old `omnikom-cli-mut-*` copies from earlier runs (not swept).
  - Still open from before: a suite-wide guard against a test run changing `.tools/`.
- 2026-11-01 08:35 (HEAD_CLI-and-testing_2026-11-01, session 26cb85, took over from the HANDOVER above): the handover commit rebuilt on
  a0266ca and LANDED as da0e72d (`omnikom land check/cli-and-testing/handover-r2`, run 41278664765, 9 of 9 jobs; lock released; local
  master fast-forwarded by hand). `omnikom hooks install` done in this repository; checked live: a dry-run push of `refs/heads/hook-probe`
  REFUSED. Seed-test builder BUILDER_cli-and-testing_seed-test started (launcher `E:\omk-launch\start-b-cli-seedtest.cmd`). New finding
  (head of operations): `land` leaves this checkout's local master behind; it should fast-forward the local ref when none of the changed
  paths are staged or dirty (a small slice after seed test).
- 2026-11-01 10:06: real-kill test retry LANDED as c2811ee (`land check/cli-and-testing/kill-test-retry`, run 41284870648, 9 of 9 jobs, the
  cli job's db part included): the first ping retries for about 10 s, the detail leads with the last three pings. One green run does not
  prove the flake gone: UNPROVEN until several db-part runs stay green. Local master fast-forwarded by hand; the same change is in the
  shared tree's `test/run.mjs` under the seed-test builder's edits.
- 2026-11-01 10:18: BLOCKED (owner click, head of operations): the org's GitHub Free plan used November's 2,000 Actions minutes and the
  spending limit stops new jobs. Land nothing until the head of operations says billing is fixed; then `gh run rerun <id>` the red runs
  instead of rebuilding. No local full gates as a substitute (DECISIONS 45). One push per finished slice, no pushes just to test.
  Findings queued for a small `land` slice: (a) fast-forward the local master ref when no changed path is staged or dirty; (b) print the
  billing annotation when every job failed without a step, not only "ci is red".
- 2026-11-01 10:40: slice 2 brief REWRITTEN against master c2811ee (`briefs/slice-2-functions.md`): split into 2a (save with `base` and
  S-STALE, publish, lead-update with `read`, add-lead, upload-start/finish, the three waiting walls; publish/upload-finish dispatch costs
  Actions minutes, so once per run) and 2b (drafts, settings-save, crm-test refusals only on staging, lead-export, invite-member with one
  fixed synthetic login). Starts after seed test. Openapi gaps sent up as a finding for the platform head.

## HANDOVER 2026-11-01 13:10 (HEAD_CLI-and-testing_2026-11-01, session 26cb85, at ~250k context, to the next CLI head; report to HEAD-OF-OPERATIONS_Omnikom_2026-11-01b)
- Landing: nothing can land until the DECISIONS 46 slice lands (private org repo out of Actions minutes). Master = c2811ee.
- In flight 1, DECISIONS 46 public code-only copy: builder BUILDER_cli-and-testing_public-copy (ref 4caa27, local; a stale Remote
  Control row of the same name, ffdf68, is the killed first launch: ignore it), launcher `E:\omk-launch\start-b-cli-publiccopy.cmd`
  (starts in E:\ because a new folder shows a trust prompt that blocks startup), works ONLY in worktree `D:\omk-gates\cli-public-copy`
  (detached at c2811ee). Brief: `tools/omnikom-cli/briefs/public-copy.md` IN THAT WORKTREE (commit it with the slice). Two stop points
  wait for your "go": (1) the Part C survey table + dry run: review it as a publication (deny business and client text even with no
  client named; check `docs/blueprint`, `docs/departments`, `skills/`, `brand/`, `contracts/industry-run/RESULTS.md`, `sites/`); (2) Part D
  creates `AbdulrahmanAmer/omnikom-checks` (public; owner-authorised 12:51 per DECISIONS 46). Tell the builder you are its head first.
  When the first copy run is green, tell the head of operations; then land this slice (bootstraps with its own new `land`).
- In flight 2, seed-test slice: BUILT and reviewed, NOT committed. Clean worktree `D:\omk-gates\cli-seedtest` (detached at c2811ee) holds
  the slice: 9 files copied from the shared tree plus `lib/walls.mjs`, with the SEO department's two uncommitted `SKIP ENV-001` lines in
  `test/run.mjs` restored to master text (script `strip-seo-lines.mjs` in this session's scratchpad; those lines need SEO's untracked
  ENV-001 rule). Clean-tree proof: unit "OK: 373 of 373", heavy db "OK: 177 of 177". Functions (Deno) job re-run in progress at handover
  (`omnikom ci --job functions --root D:/omk-gates/cli-seedtest` from E:\ through heavy.mjs; the worktree has no `.tools/`): read its
  verdict, then re-copy this charter (it gained lines after the copy) into the worktree, gitleaks the staged diff, commit there, push to
  `check/cli-and-testing/seed-test`, and land after DECISIONS 46 (rebase onto it if needed; `test/run.mjs` and `test/mutate.mjs` will
  conflict mechanically). Builder BUILDER_cli-and-testing_seed-test is done (archive it). Staging facts in its report: seed test changed
  true then false twice; Agent One v3 and Agent Two v2 with slug and role (closes the sheet-publish block); contract v2; preview host set;
  people 15/15, walls 5/5. `test walls` on staging BLOCKED at `supabase/tests/tenancy.test.sql:264` (N2, global `reap_stale_jobs`, 5 stale
  queued jobs from 2026-10-31): finding sent up, option 1 (the walls file counts only its own jobs) recommended. Not run: factory job
  (needs npm install), full mutate.mjs (GitHub).
- Next after those: slice 2a then 2b (brief rewritten, `briefs/slice-2-functions.md`); a small `land` slice (fast-forward the local
  master ref when no changed path is staged or dirty; print the billing annotation when every job failed without a step); big-output
  hook (DECISIONS 41).
- Findings sent up today: openapi gaps vs 5.2 source (SaveRequest lacks `base`, LeadUpdateRequest lacks `read`, five functions without
  paths, config.toml names three functions without folders, `/unpublish` without a function); staging A has a third bare listing;
  `tenancy.test.sql:886/888` partial-id literals.
- Shared-tree notes: the charter and both briefs in `tools/omnikom-cli/briefs/` are uncommitted edits of this department; the kill-test
  change is already in master (c2811ee); SEO's two `test/run.mjs` lines are theirs, never commit them.
- 2026-11-01 13:10 (HEAD_CLI-and-testing_2026-11-01b, session af5d60, Opus 5.5, took over from the HANDOVER above; reports to
  HEAD-OF-OPERATIONS_Omnikom_2026-11-01b): block read; the public-copy builder (4caa27) told; seed-test worktree checked against the
  shared tree (only this charter and SEO's two `test/run.mjs` lines differ).
