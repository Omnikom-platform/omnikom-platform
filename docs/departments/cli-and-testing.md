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
- `tools/bank-json-key.mjs`
- `tools/check-api-keys.mjs`
- `tools/compose-db-url.mjs`
- `tools/lib/bank.mjs`
- `tools/resend-test-email.mjs`
- `tools/secret-receiver.mjs`
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

- A test cluster takes its port from its block in the port map (DECISIONS 50; below every ephemeral range) and pins
  listen_addresses to 127.0.0.1; a harness that can half-bind (pg_ctl ok, 127.0.0.1 refused) is a defect. Probe:
  tools/omnikom-cli/test/port-bind-probe.mjs (2026-11-01 real-kill reds, runs 41350867780 and 41353911357).
- Every SendMessage from the head to a builder sets `notify_when_idle: true`, so a builder going idle reaches the head
  (HoO-02b, 2026-11-02 14:38, after a builder sat 3 h with uncommitted work and no report).

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
- 2026-11-01 13:45: seed-test slice committed 1183f59 in `D:\omk-gates\cli-seedtest`, pushed to `check/cli-and-testing/seed-test` (first
  push HTTP 408, one retry ok); gitleaks staged clean; head's clean-worktree re-run 550 of 550. UNPROVEN: functions job (laptop run timed
  out, not an assertion), factory job, mutants: the D46 copy run decides before it lands. Seed-test builder stopped (pid 27044, nothing left).
- 2026-11-01 14:20: D46 stop point 1 BLOCKED (no "go"): dry run on c2811ee COPY-REFUSED, 135 files name a client; 107 still after 9 extra
  non-code denies (5 departments, 20 read by a job; `contracts/examples/` is one folder per client, read by gates). Survey:
  builder scratchpad `public-copy-survey.md`. Refused: relaxing gate item 2 to skip slug-only hits (a slug is a client name). Accepted:
  force-with-lease on the PUBLIC master only; the `secrets` job in jobsNotOnCopy if the gate's own gitleaks has a watched red. Options sent
  to the head of operations (1 recommended: deny all client-named files, broken jobs in jobsNotOnCopy and run on the laptop for that sha
  until each department anonymises; 2: all anonymise first; 3: as 1 without the laptop run). Builder measuring every job on the deny-all copy.
- 2026-11-01 14:15: option 1 decided as DECISIONS 47. Builder told (scope inside the D46 slice): deny every client-named file (rules file
  names no client: parent prefixes); jobsNotOnCopy carries the files that keep each job there; land runs those jobs on the laptop through
  heavy.mjs for the exact sha, refuses unless green, prints "laptop, not GitHub"; watched red and a mutant. 47(e): a job over 15 minutes
  locally (gates, db walls) is reported to the head of operations before it goes on the list. Part D waits for my go after the per-job
  verdicts and the per-department file list (the list goes to the head of operations for anonymising notices).
- 2026-11-01 14:40: per-department list sent up (107 files; head of operations holds the private `planning/anonymise-map.md`). Added to the
  D46 slice: clientNames reads "Also known as: <term>, ..." in `clients/<slug>/profile.md` (watched red, mutant). CONDITION for Part D: the
  first copy push is built only from a private commit holding the head of operations' Also-known-as profile lines (rebase the slice onto it).
- 2026-11-01 14:55: new base for the D46 slice = e534e5c (backup-gh `check/head-of-operations/d47-anon`: c2811ee > dc293fe > 3838cd1 (Also
  known as lines, DECISIONS 46/47, private map) > e534e5c (7 head-of-ops files anonymised)); zero overlap with `tools/omnikom-cli/`; builder
  told to move its worktree there and re-run unit and the dry run. Landing D46 lands those three commits too (intended). Seed-test 1183f59
  (on c2811ee) rebases onto the landed D46 after.
- 2026-11-01 14:58: base corrected to c839935 (`check/head-of-operations/d47-platform-charter`, e534e5c + platform-build.md anonymised;
  zero overlap). SEO head is now HEAD_SEO-and-audits_2026-11-01b; its 4c commit carries two SEO literals in `test/run.mjs` (~349, ~354) as a
  light follow-on (accepted); 4c rebases onto the landed D46 (mechanical conflict in `test/run.mjs` expected); I read those two hunks.
- 2026-11-01 15:15: QUEUE (in order): D46 slice; seed-test land (1183f59 rebased); "small CLI fixes" slice, one builder = (a) `land`
  fast-forwards the local master ref when no changed path is staged or dirty, (b) billing annotation when every job failed without a step,
  (c) `omnikom audit --target <preview|production>` passed to the engine's `{ target }` (SEO notice; removes the SKIP ENV-001 line, so the
  two 83a410b literals in `test/run.mjs` change back with it, but SEO 5c's "SKIP PMP-001 / no --prompt-coverage" literals stay until the
  prompt-coverage slice; whichever of 5c and this slice lands second rebases its literals on the other); slice 2a;
  slice 2b; `audit --prompt-coverage FILE` once SEO 5c is on master; big-output hook.
- 2026-11-01 15:32: public-copy builder SWAP (499k): handover note `D:\omk-gates\cli-public-copy\tools\omnikom-cli\briefs\public-copy-handover.md`;
  stopped (pid 5656, its in-flight unit run and queued (A) jobs killed with it, nothing left); fresh BUILDER_cli-and-testing_public-copy-2
  (pid 25088, sonnet) briefed on the note. Dry run on c839935 (old builder): 2057 files, 233 dropped, gate PASS, 3 files hit only by
  Also-known-as terms (now denied). UNPROVEN: unit and copy/hook/land tests after the D47 edits, every new mutant, (A). This head is WATCH
  (180k): HANDOVER block at the end of the D46 slice.
- 2026-11-01 15:49: head of operations is now HEAD-OF-OPERATIONS_Omnikom_2026-11-01c (01b handed over); report there. Queue unchanged.
- 2026-11-01 16:00: added to D46 (light): `land` laptop run, heavy.mjs exit 75 ("cannot read this process's creation time (pwsh)") retried up
  to 2 times, then BLOCKED (never LAND-REFUSED, nothing pushed); exit 1 refused with no retry; tests, watched red, mutant. Builder told.
- 2026-11-01 16:25: NEW SLICE DECISIONS 48, `omnikom test journey --target staging` (read item 48). QUEUE now: D46, seed-test land, small
  CLI fixes, JOURNEY, 2a, 2b, --prompt-coverage, big-output hook. The journey reuses the dashboard Playwright files (`apps/dashboard/tests/
  site.spec.ts`, `flows.spec.ts`, `plan-gate.spec.ts`) for accounts, edit, publish, inbox; `lead send` or the site form for the lead; render
  gate with phone and desktop screenshots; connectors to a sink we own; NOT BUILT YET lines. The next CLI head writes its plan (DECISIONS 44
  style) and sends it to the head of operations BEFORE a builder starts. Finding sent up: publish dispatches a private-repo workflow (no
  Actions minutes, needs secrets), so the publish step is BLOCKED until the org has minutes or the owner picks another runner.
- 2026-11-01 16:40: DECISIONS 49: the real repo is PUBLIC (16:31); D45 stands as first written; the D46 copy and D47 laptop runs are PARKED
  in `D:\omk-gates\cli-public-copy` (uncommitted, kept; notes in `tools/omnikom-cli/briefs/public-copy-handover.md` there, PARKED section).
  The journey's publish step is no longer blocked. `gh run rerun 41303233429` (seed-test 1183f59, attempt 2) running; master still c2811ee.
  Carve-out reading: likely empty (master's land already reads the real repo's run; the exit-75 retry only guards parked D47 runs).
  QUEUE: seed-test land, small CLI fixes, JOURNEY (plan to the head of operations first), 2a, 2b, --prompt-coverage, big-output hook.
  HANDOVER after the seed-test lands (or after the carve-out, if one is needed).
- 2026-11-01 16:48: carve-out EMPTY (builder's per-file list: all 15 changed files copy/laptop only; head of operations agreed). Builder
  public-copy-2 stopped (pid 25088, nothing left). Parked: copy tests 62/62 ok; UNPROVEN: unit, hook/land, exit-75 checks, every mutant, (A).
  To revive: read the PARKED section of the handover note in the worktree. Land order with the head of operations' c839935 chain: whichever
  is green first lands, the other rebases.
- 2026-11-01 17:10: seed-test rerun 41303233429 GREEN 9/9 on 1183f59; land LAND-LOCKED twice (platform 5-h-r5, which landed 713b008; then
  SEO 4c). Rebased to ad2c090 on 713b008 and pushed; a script (`land-after-lock.sh` in this session's scratchpad) waits for the lock, rebases
  onto the new master, pushes and lands. Finding for the small CLI fixes slice: (d) `land` should queue for the lock (bounded wait)
  instead of refusing, since each refusal costs a rebase and a fresh CI run.
- 2026-11-01 17:50: seed-test slice LANDED as daa01d1 (`land check/cli-and-testing/seed-test`, run 41320962343, 9 of 9 jobs; rebased onto
  SEO 4c f75cc64 with no conflict; lock released). The first background land hit a github.com:443 blip (land failed closed, exit 3); the
  retry got through. Spec 26 section 7 and PROGRESS.md for the seed-test slice: NOT DONE (next head).

## HANDOVER 2026-11-01 17:55 (HEAD_CLI-and-testing_2026-11-01b, session af5d60, Opus 5.5, WATCH ~230k, to the next CLI head; report to HEAD-OF-OPERATIONS_Omnikom_2026-11-01c)
- Master = daa01d1 (seed-test landed). In flight: nothing. No builder running (public-copy, public-copy-2 and seed-test builders all
  stopped, "left":[]). This department's open check branch: `check/cli-and-testing/seed-test` (landed; delete it at leisure).
- Repo is PUBLIC (DECISIONS 49): the gate is the real repo's green run for the exact commit (DECISIONS 45 as first written). No client
  personal data goes into the repo from now on.
- PARKED (DECISIONS 49, not deleted): the D46 public copy and D47 laptop runs, uncommitted in worktree `D:\omk-gates\cli-public-copy`
  (detached at c839935). To revive: read `tools/omnikom-cli/briefs/public-copy-handover.md` there, both sections (the PARKED one last).
  Proven there: copy tests 62/62. UNPROVEN: unit, hook/land, exit-75 checks, every new mutant, per-job verdicts. Do not delete the worktree.
- Worktree `D:\omk-gates\cli-seedtest` is done (detached at daa01d1, clean): remove it with `git worktree remove` when convenient.
- QUEUE (in order):
  1. Small CLI fixes, one builder: (a) `land` fast-forwards this checkout's local master ref when no changed path is staged or dirty (today
     it prints "the local master of this checkout does not contain ..."); (b) print the billing annotation when every job failed without a
     step; (c) `omnikom audit --target <preview|production>` passed to the engine's `{ target }` (SEO notice): this removes the SKIP ENV-001
     line, so the two ENV-001 literals in `test/run.mjs` (from SEO 4c) change back; SEO 5c's "SKIP PMP-001 / no --prompt-coverage" literals
     stay; whichever of 5c and this slice lands second rebases its literals; tell the SEO head when it lands; (d) `land` waits in line for a
     held land lock (bounded) instead of refusing: today each refusal costs a rebase and a fresh CI run (seen twice at 17:00).
  2. JOURNEY (DECISIONS 48, read it): `omnikom test journey --target staging` on test-demo-a. Write the plan first (DECISIONS 44 style:
     reuse `apps/dashboard/tests/site.spec.ts`, `flows.spec.ts`, `plan-gate.spec.ts`; `lead send` or the site form; render gate with phone
     and desktop screenshots; connectors to a sink we own; NOT BUILT YET lines; a mutant where a broken publish step goes red) and send it
     to the head of operations BEFORE a builder starts. The publish step is no longer blocked (the repo has Actions minutes again).
  3. Slice 2a, then 2b (`briefs/slice-2-functions.md`, rewritten 10:40 against c2811ee; check it against master first).
  4. `audit --prompt-coverage FILE` once SEO 5c is on master. 5. The big-output hook (DECISIONS 41).
- Open findings: spec 26 section 7 and PROGRESS.md entries for the seed-test slice and the 103a502 onward slices are NOT DONE; `test walls`
  on staging BLOCKED at `supabase/tests/tenancy.test.sql:264` (finding with the platform department); the real-kill flake UNPROVEN gone;
  ~225 old `%TEMP%\omnikom-cli-mut-*` copies unswept; a suite guard against a test run changing `.tools/` still open; the openapi gaps
  sent up (10:40 entry); heavy.mjs exit 75 under load (only matters when laptop runs come back).
- Rules: plan and land, builders build (`tools/departments/start-builder.mjs`), Haiku runners for mechanical checks; unit runs are free in
  a worktree, only db parts and mutants go through heavy.mjs; commit only this department's files; never commit another department's
  in-flight lines; run `node tools/departments/context-load.mjs` at each slice boundary.
- 2026-11-01 18:05 (HEAD_CLI-and-testing_2026-11-01c, Opus 5.5, took over from the HANDOVER above; reports to
  HEAD-OF-OPERATIONS_Omnikom_2026-11-01c): block read, confirmed to the head of operations; 01b can be archived. Starting queue item 1
  (small CLI fixes: brief, then one builder).
- 2026-11-01 18:20: small CLI fixes briefed (`briefs/small-cli-fixes.md`: (a) land moves the local master when no diff path is dirty,
  (b) "no job ran a step" line with GitHub's annotation, (c) audit/gate `--target preview|production` = the BUILD target, production guard
  exempts exactly audit and gate (decided: same word as tools/audit and factory), (d) `--lock-wait-minutes` (default 30) plus an early
  not-a-fast-forward refusal before the ci wait). Builder BUILDER_cli-and-testing_small-fixes (pid 23288, sonnet) in worktree
  `D:\omk-gates\cli-small-fixes` at daa01d1. Next while it builds: the DECISIONS 48 JOURNEY plan to the head of operations.
- 2026-11-01 18:08: in flight from 01b: its HANDOVER commit 5425d31 (charter only, +91 lines) on `check/cli-and-testing/handover-b`,
  background land by 01b; remote master still daa01d1, land-lock 209b263 held. If 01b is gone before it lands, landing it is mine
  (head of operations, 18:07). My uncommitted charter lines sit on top of it in the shared checkout.
- 2026-11-01 18:23: head of operations is now HEAD-OF-OPERATIONS_Omnikom_2026-11-01d (01c stopped 18:22); report there. 5425d31: CLI-b's
  land holds the lock since 17:56 (209b263), CLI-b alive; I tell 01d when master moves so CLI-b is stopped.
- 2026-11-01 18:31: 5425d31 land REFUSED (run 41323687561: gates job red, "publish-ready parity (SQL vs JS) ... psql: connection to
  127.0.0.1:55566 refused", the SQL side never ran; the other 8 jobs green). CLI-b handed the land to me and stops; it ran `gh run rerun
  41323687561 --failed`. My `omnikom land check/cli-and-testing/handover-b --wait-minutes 60` waits on the rerun (background). If the
  rerun is red the same way: finding to the platform head (CLI-b's guess: 713b008's proc-guard stopping the cluster early).
- 2026-11-01 18:40: master moved to 4fde43a (platform 5.2b, run 41323887634); CLI-b stopped by 01d. My waiting land stopped (it held the
  lock e3a8d6b; released by lease, "[deleted] land-lock"). 5425d31 cherry-picked onto 4fde43a in `D:\omk-gates\cli-seedtest` (charter
  only, no overlap with 4fde43a's 11 files), gitleaks staged "no leaks found", committed 3d7c0c3, force-with-lease pushed to
  `check/cli-and-testing/handover-b`; land running in the background on the fresh run. JOURNEY plan written: `briefs/journey.md`.
- 2026-11-01 18:45: JOURNEY plan ACCEPTED by 01d (J8/J9 NOT BUILT YET, sink with webhook out; journey before 2a/2b); staging released
  (one full run plus --only repairs, alerts to our --alert-to only). Builder BUILDER_cli-and-testing_journey (pid 21208, sonnet) in
  `D:\omk-gates\cli-journey` at 4fde43a; tests in a new `test/journey.mjs` to keep the rebase on small-fixes mechanical. 01d's
  acceptance needs: unit + mutant lines, PROGRESS lines, PNG paths (it opens them); every product-bug FAIL goes to 01d as a finding.
- 2026-11-01 18:50: journey builder found site.spec.ts and the editor/publish screens are not on master (platform's uncommitted work in the
  shared checkout; my survey read the shared checkout, a lesson: survey a clean worktree at master). J3 = NOT BUILT YET on a tree without
  the file, FAIL if the file lacks the title; told the builder and 01d (asked which platform slice carries the editor).
  01d: the editor is platform slice 5.4 (24 paths under apps/dashboard/), landing after 5-W round 2; 01d tells me when it lands; then
  rebase the journey onto it (or re-run J3 on master if the journey landed first).
- 2026-11-01 18:59: FINDING from 01d (low priority, after the journey): run 41323582926 cli job: run.mjs "OK: 549 of 549", then
  mutate.mjs "BASELINE FAILS ... FAIL cluster guard (real kill): ... psql: connection to server at 127.0.0.1, port 57130 failed:
  Connection refused ... FAILED: 548 of 549"; rerun green. Same family as the gates psql reds (platform has the proc-guard finding).
  Question to answer: does the real-kill check share a cluster with anything the proc-guard may stop. Until known: `gh run rerun
  --failed` is the rule, never a retry inside the test. Queued after the journey. The 18:51 handover land hit "TLS handshake timeout"
  (failed closed); bounded retry running (`land-retry.sh`, 3 tries, scratchpad).
- 2026-11-01 19:17: CLI-b's HANDOVER LANDED as 3d7c0c3 ("ci green: 3d7c0c3 run 41327517190, 9 of 9 jobs success", 4fde43a..3d7c0c3;
  gates green, no 55566 recurrence). The lock release then failed on github.com:443; released by lease by hand ("[deleted] land-lock").
  Worktree `D:\omk-gates\cli-seedtest` removed. Small-fixes slice gained (e): `releaseLock` retries a network failure (bounded, never a
  lease refusal). My retry script mis-read the release WARNING as a land failure (fixed: "land: master is" ends it).
- 2026-11-01 20:01: small-fixes interim: a-e coded, `run.mjs --unit` "OK: 422 of 422"; told to run only its 31 tagged mutants on the
  laptop (D45 (d); --db and run-all-gates only if a db part reads a changed file), GitHub decides the rest. Platform 5.4 LANDED as
  9800616 (run 41331537425, 9/9, per 01d): journey builder told to move its worktree onto 9800616 (stash, checkout, pop) so J3 runs for
  real; the staging full run counts only after the rebase.
- 2026-11-01 20:26: DEPENDENCY (01d): SEO's REQUIRE_TARGET_FOR_FOLDER flip waits on small-fixes (c) `audit --target` (today audit.mjs:26
  refuses it). Tell 01d the master sha when small-fixes lands; if anything else holds it, carve (c) out and land it alone first.
- 2026-11-01 20:48: RULE (01d, owner): start every builder with `--effort high` (`start-builder.mjs --effort high`; the machine default is
  low). Running builders keep theirs (small-fixes and journey were started without it); replace one at a slice boundary only if struggling.
- 2026-11-01 20:56: small-fixes: db "OK: 177 of 177" (lib/target.mjs is read by the db suite), unit "OK: 422 of 422". The 31-mutant laptop
  run's baseline failed twice (real-kill pg_ctl flake; then mutate.mjs's 10-min LIMIT_MS, the suite ~25 min under load): stopped by me,
  mutants go to GitHub's cli job on the check branch (D45). Watch: does LIMIT_MS bite on GitHub too.
- 2026-11-01 21:10: small-fixes FINAL from the builder (a-e; only ONE new check watched red on the laptop, the empty --lock-wait-minutes;
  the 31 [small-fixes] mutants are the watched reds and run on GitHub; known gap in (e): a delete that succeeded server-side but timed out
  client-side reads "stale info" on retry and warns falsely). Rebased onto f4923df (no overlap), node --check clean on 9 files, impact
  chain read (cli, departments, gates, factory, functions, workflows jobs; all 9 run on GitHub), gitleaks "no leaks found". Commit
  8679ed6 pushed to `check/cli-and-testing/small-fixes`; land running (bounded retry). Builder pid 23288 to stop after the land.
- 2026-11-01 21:16: land LAND-LOCKED by platform 5-E, which landed e92684e (no overlap). Rebased: 3ba2ef8 on e92684e, gitleaks "no leaks
  found", force-with-lease pushed; land running on the fresh run.
- 2026-11-01 21:18: land refused again (platform 5-W took the lock seconds before me; the "could not take the land lock: remote:" line was
  that race). 01d GRANTED the order after 5-W: CLI small-fixes, then SEO 5c, then 01d's effort commit. Send 01d the master sha when
  small-fixes lands (sha 2 for SEO's REQUIRE_TARGET flip). Watcher on master; then `rebase-push-land.sh` (scratchpad).
- 2026-11-01 21:40: JOURNEY built (builder report): unit "OK: 437 of 437", `mutate.mjs --only journey` "23 mutants, 23 caught, 0 survived,
  0 target text missing" (baseline 614 of 614). Full staging run on 9800616: "journey (staging): 3 PASS, 2 NOT BUILT YET, 2 FAIL, 2
  SKIPPED" (J1-J3 PASS; J4 FAIL favicon 404; J5 FAIL form 400 "Send the form as JSON."; J6/J7 SKIPPED; J8/J9 NOT BUILT YET); 0 alert
  emails. I opened j4-phone-contact.png and j5-form-answer.png: they match. Findings to 01d: J5 form (platform, HIGH), favicon (low),
  proc-guard lacks `omnikom-jb-` (low), J3 leaves test text. Accepted out-of-plan: the "tests start no browser" guard check now names the
  journey's 4 files. Follow-ups sent: drop the email address from spec 26 (public repo), harness.mjs:19 comment, J6/J7 fallback lead via
  `lead send` plus one `--only J6,J7` repair run. Journey lands after small-fixes (rebase onto it; mechanical overlaps).
- 2026-11-01 21:42: 5-W landed be64510 but left its lock ac4e729 held (since 19:16:46Z). small-fixes rebased to 4f2b602 on be64510
  (gitleaks clean, pushed); land LAND-LOCKED behind the orphaned lock; asked 01d for a release or an OK to lease-delete it.
  01d OK'd (master be64510 holds 5-W): lock ac4e729 lease-deleted; land of 4f2b602 running (bounded retry).

## HANDOVER 2026-11-01 22:15 (HEAD_CLI-and-testing_2026-11-01c, session 356fee90, Opus 5.5, CTX SWAP 295,709 tokens, to the next CLI head; report to HEAD-OF-OPERATIONS_Omnikom_2026-11-01d)
- Master = be64510 at 22:14. IN FLIGHT (finish these first):
  1. small-fixes LAND: commit 4f2b602 on `check/cli-and-testing/small-fixes` (rebased on be64510, gitleaks clean); `land` running in this
     session's background via the scratchpad `land-retry.sh`, holding lock 6c92c8a while it waits on GitHub. If this session is gone
     before it lands: check `git ls-remote backup-gh refs/heads/master refs/heads/land-lock`; if master is not 4f2b602 and the lock is
     still 6c92c8a, delete it by lease (`git push --force-with-lease=refs/heads/land-lock:6c92c8a0e860cb2b54be6a059195d9d446c26f5e
     backup-gh :refs/heads/land-lock`) and run `node tools/omnikom-cli/omnikom.mjs land check/cli-and-testing/small-fixes` (if master
     moved: rebase in worktree `D:\omk-gates\cli-small-fixes` with cherry-pick -n, gitleaks protect --staged, commit -C, force-with-lease
     push). On land: send 01d the master sha (SEO's REQUIRE_TARGET flip waits on it: land order small-fixes, then SEO 5c, then 01d's
     effort commit), tell the SEO head `omnikom audit --target` exists, stop BUILDER_cli-and-testing_small-fixes (pid 23288,
     `node tools/departments/stop-builder.mjs --pid 23288`), remove the worktree. Its 31 [small-fixes] mutants are first proven by that
     GitHub run (only one new check was watched red on the laptop).
  2. JOURNEY builder BUILDER_cli-and-testing_journey (pid 21208, sonnet, low effort) in `D:\omk-gates\cli-journey` on 9800616,
     uncommitted. Done: unit 437/437, 23/23 journey mutants, full staging run (3 PASS, 2 NOT BUILT YET, 2 FAIL product bugs, 2 SKIPPED).
     Asked of it (21:38), report pending: drop the staff email address from spec 26 section 7 (public repo), fix harness.mjs:19 comment,
     J6/J7 fallback lead via `lead send` when J5 stored none (+2 mutants), one `--only J6,J7` staging repair run with its lines and the
     inbox PNG. Then: look at the inbox PNG yourself, send 01d the acceptance package (unit + mutant lines, PROGRESS lines, PNG paths:
     full run's PNGs in `C:\Users\DELL\AppData\Local\Temp\claude\D--omk-gates-cli-journey\ee3fbc88-cc39-4b5b-9e1c-2c394dcf1236\scratchpad\shots\journey-20261101180857\`),
     paste the staging lines into docs/blueprint/PROGRESS.md "CLI: test journey", rebase onto the landed small-fixes (overlaps in
     omnikom.mjs, README.md, test/run.mjs, test/mutate.mjs are mechanical), commit with briefs/journey.md, check branch, land.
- QUEUE after those: (1) REAL-KILL FLAKE slice, plan APPROVED by 01d 22:13 (my plan line in the 22:11 entry's message; read the 22:13
  message summary here): the test at tools/omnikom-cli/test/run.mjs:1501-1528 deliberately orphans a live cluster (child SIGKILLed,
  postmaster reparented to pid 1) then pings it; hypothesis: since 713b008 a concurrent proc-guard sweep (mutate.mjs runs 3 suite copies
  at once) treats a pid-1-parented holder as no live owner and kills it before the "outlived" ping. Seen: run 41323582926 (mutate
  baseline) and SEO run 41344229818 on a111b86 ("FAILED: 548 of 549", pings "2 psql: error: connection to server at 127.0.0.1 ...").
  Steps: failure detail names which ping failed and whether the postmaster pid existed; prove/refute deterministically (a proc-guard
  sweep between kill and ping, Linux on a check branch and Windows); fix by the proven cause, watched red + mutant, NO retry in the test.
  This slice owns the diagnosis for BOTH families (CLI real-kill and the gates "psql ... 127.0.0.1 refused" reds, run 41323687561);
  any proc-guard change goes to platform (5-G waits) as a brief with evidence; CLI changes only the test side. Builder `--effort high`.
  (2) slice 2a, then 2b (`briefs/slice-2-functions.md`; check against master first). (3) `audit --prompt-coverage FILE` once SEO 5c lands.
  (4) big-output hook (DECISIONS 41).
- Findings routed to 01d (platform owns them): J5 form 400 "Send the form as JSON." (HIGH; platform's next slice; its done-when includes
  our `--only J5,J6` re-run), favicon 404 (low), proc-guard PREFIXES lacks `omnikom-jb-` (low), proc-guard CIM listing 10+ s under load.
- Rules learned today: start builders with `--effort high`; survey facts in a clean worktree at master, never the shared checkout (it holds
  other departments' uncommitted work); a land whose master moved needs a rebase and a fresh run (small-fixes (d) narrows the window once
  landed); GitHub :443 drops from this laptop: retry with a bound, and a lock release can fail after a successful land (check the lock).
- Worktrees: `D:\omk-gates\cli-small-fixes` (small-fixes, remove after land), `D:\omk-gates\cli-journey` (journey, uncommitted),
  `D:\omk-gates\cli-public-copy` (PARKED D46/D47, keep). Scratchpad scripts of this session (watch-master.sh, land-retry.sh,
  rebase-push-land.sh): `C:\Users\DELL\AppData\Local\Temp\claude\E--Omnikom-Platform\356fee90-2b7b-4f5f-a2bf-0230880de8d0\scratchpad\`.
- Uncommitted in the shared checkout (mine, commit with the journey or alone): this charter's lines from 18:05 on, briefs/journey.md,
  briefs/README.md row. small-cli-fixes.md is in the small-fixes commit.
- 2026-11-01 22:28 (after the block): small-fixes land REFUSED on run 41342972596 (cli job red only): mutate.mjs "300 mutants, 299 caught,
  0 survived, 1 target text missing": `MISSING ghrun: a red run beside a green one is ignored (target text found 0 times in
  lib/ghrun.mjs)` (an existing mutant whose line part (b) rewrote). All 31 [small-fixes] mutants caught on GitHub. Builder 23288 asked to
  fix that mutant's target text; then amend-free new commit on 4f2b602, push, land.
  01d rule: ONE more try. If the fresh run is red on the cluster-loss family (real kill, or mutate BASELINE "create database failed ...
  Connection refused"), no retry: small-fixes waits for CLI-d's cluster-loss fix and lands after it. Send 01d the run id either way.
- 2026-11-01 23:23: CLI-d: land order changed by 01d: real-kill fix FIRST (cause PROVEN: cluster ports in the Linux ephemeral range, run
  41350867780), then small-fixes. No small-fixes land until CLI-d says real-kill landed; then rebase (harness.mjs, test/run.mjs,
  test/mutate.mjs may overlap).
- 2026-11-01 23:36: the MISSING mutant fixed by the builder (mutate.mjs:237, target "if (badRuns.size > 0) {", found once; "1 mutants, 1
  caught, 0 survived, 0 target text missing", baseline 599 of 599); committed locally as 86db32f on 4f2b602 in
  `D:\omk-gates\cli-small-fixes` (gitleaks clean), NOT pushed. To land: after real-kill lands, cherry-pick 4f2b602 and 86db32f onto
  the new master (or squash), gitleaks, force-with-lease push to `check/cli-and-testing/small-fixes` (lease 4f2b602), land; one try.
- 2026-11-01 22:32 (HEAD_CLI-and-testing_2026-11-01d, session 5452c08c, Opus 5.5, took over from the HANDOVER 22:15; reports to HEAD-OF-OPERATIONS_Omnikom_2026-11-01d): CLI-c still live and finishing small-fixes land + journey package. REAL-KILL slice STARTED: BUILDER_cli-and-testing_real-kill (pid 26412, sonnet, high), worktree D:\omk-gates\cli-real-kill at be64510, brief briefs/real-kill-flake.md (adds 01d's evidence: 5-L run 41345442144 mutate baseline lost its cluster, port 57652 refused). Head's doubt on the 713b008 hypothesis: CLI prefix omnikom-cli-pg- is not in proc-guard PREFIXES; job green 15:51-21:27. UNPROVEN.
- 2026-11-01 23:20 (CLI-d): real-kill cause PROVEN on Linux, head re-read run 41350867780 (062d382, check/cli-and-testing/real-kill-probe): cluster ports 57000-57899 sit in the Linux ephemeral range (32768-60999); a psql TIME_WAIT socket on P makes the postmaster skip 127.0.0.1 and bind ::1 only, pg_ctl -w says ok, 127.0.0.1 refused ("could not bind IPv4 address"). proc-guard REFUTED (CLI prefix not in PREFIXES, no call). Port map from 01d (one block per harness below 32768; CLI 21000-21899) + listen 127.0.0.1 + 5-try bind fallback. Brief to platform: briefs/to-platform-port-map.md (sent to HEAD_Platform-build_2026-11-01d). Fix NOT DONE: builder building; each past CI red UNPROVEN as exactly this.
- 2026-11-02 00:19 (CLI-d): REAL-KILL fix LANDED as ce587bc (be64510..ce587bc; run 41353911357, 9 of 9 jobs success; CLI job baseline "OK: 556 of 556", "285 mutants, 285 caught, 0 survived"). Commits 4dc735a (harness ports 21000-21899 per DECISIONS 50, listen 127.0.0.1, 5-try in-block walk, failure detail, test/port-bind-probe.mjs + port-hold.py) and ce587bc (a start naming its port never gets the mutate copy's shared cluster; first run 41352480525 red on that, fixed by cause). Brief to platform sent, taken as 5-PORT. PENDING: builder's Windows mutant/full/probe lines; follow-up branch check/cli-and-testing/sweep-eperm (Windows sweep EPERM aborts next startCluster), not pushed until the land queue clears. Small-fixes released to CLI-c for rebase + land.
- 2026-11-02 00:23 (CLI-c): real-kill LANDED as ce587bc (CLI-d, run 41353911357). small-fixes rebased onto ce587bc with no conflict:
  fe23f56 (the slice) + 41f6866 (the mutant text); both sides' mutants present (11 cluster-port lines, 31 [small-fixes]); node --check
  clean on 6 files; gitleaks detect ce587bc..HEAD "no leaks found"; force-with-lease pushed (lease 4f2b602); the one allowed land running.
- 2026-11-02 01:10 (CLI-d): small-fixes LANDED by CLI-c as 41f6866 (ce587bc..41f6866, run 41356964984, 9 of 9). JOURNEY handed to CLI-d by CLI-c at SWAP: BUILDER_cli-and-testing_journey (pid 21208, sonnet, low), D:\omk-gates\cli-journey on 9800616, uncommitted; 21:38 asks (staff email out of spec 26 s7, harness.mjs:19 comment, J6/J7 fallback lead + 2 mutants, --only J6,J7 staging repair run + inbox PNG) status asked. Then: read the PNG, acceptance package to 01d, rebase onto master, commit with briefs/journey.md + this charter's uncommitted lines (18:05 on) + briefs/README.md row, land in 01d's order.
- 2026-11-02 01:10 (CLI-c): small-fixes LANDED as 41f6866 ("ci green: 41f6866 run 41356964984, 9 of 9 jobs success", ce587bc..41f6866,
  lock released). Told 01d (sha 2 for SEO's flip), CLI-d and the SEO head (queued, its machine offline). Builder small-fixes stopped
  ("left":[]); worktree `D:\omk-gates\cli-small-fixes` removed. JOURNEY handed to CLI-d with its builder (pid 21208; 21:38 follow-ups
  still unreported); the builder told to report to CLI-d. CLI-c done.
- 2026-11-02 01:16 (CLI-d): JOURNEY acceptance package sent; ACCEPTED by 01d with one condition (J7 'fallback without checking the alert list' mutant must be assertion-caught, not timeout; re-run queued). Head read j6-inbox-owner-a.png: row 'Journey 8c12816a lead send | Contact | /journey | new' present; page unstyled (platform finding), 36 leftover 5.3 flow leads (platform finding). Land slot: SEO 5c+5d -> 5-L -> JOURNEY -> 5-PORT -> 01d. After 5-L lands: --only J4,J5,J6 on staging, J5 must PASS on its own lead (closes UNPROVEN). CLI-c stopped by 01d. Builder told to rebase on 41f6866 and commit locally, no push yet. Shared-checkout tools/omnikom-cli/test/run.mjs edit (PMP-001 SKIP count) is SEO 5c's, not ours.
- 2026-11-02 02:02 (CLI-d): land order from 01d: SEO 5c+5d (landing) -> platform 5-L -> platform 5-G -> JOURNEY -> 5-PORT -> 5-DS -> 01d. --only J4,J5,J6 staging re-run right after 5-L lands. Journey builder told: after 5-G its harness.mjs:19 comment on omnikom-jb- must match proc-guard PREFIXES.
- 2026-11-02 02:17 (CLI-d): sweep-eperm built (4883e3c on 41f6866, Windows "baseline: OK: 609 of 609", "5 mutants, 5 caught, 0 survived"); Linux run pending on check/cli-and-testing/sweep-eperm. 01d: stack sweep-eperm on the journey commit, one check branch, one run. Order: SEO -> 5-L+5-G -> CLI journey+sweep-eperm -> 5-PORT -> 5-DS -> 01d.
- 2026-11-02 03:07 (CLI-d): journey commit 32af9df on 41f6866 (local), J7 condition MET (assertion-caught; --only journey "27 mutants, 27 caught, 0 survived, 0 target text missing", baseline 674 of 674; --unit 495 of 495). sweep-eperm: 4883e3c red on stale mutant target (run 41366231860), cb3b3d4 fixes (run 41370103496), third commit = --unit check that every mutant target is found. Order (01d 03:06): 5-L+5-G (run 41370578157) -> 5-PORT -> CLI journey+sweep-eperm -> 5-DS -> 01d. After 5-L+5-G: --only J4,J5,J6 on staging (J5 own lead closes UNPROVEN).
- 2026-11-02 03:20 (CLI-d): order (01d 03:19): 5-L alone -> 5-PORT -> CLI journey+sweep-eperm -> 5-G (its new Linux test went red) -> 5-DS -> 01d. J4,J5,J6 staging re-run after 5-L's sha. Journey harness.mjs:19 comment stays (omnikom-jb- not in PREFIXES until 5-G).
## HANDOVER (PROVISIONAL, written early at SWAP 244k; final block follows when the stack lands) 2026-11-02 03:55 (HEAD_CLI-and-testing_2026-11-01d, session 5452c08c, Opus 5.5; report to HEAD-OF-OPERATIONS_Omnikom_2026-11-02)
- Master 41f6866 at 03:55. Land order (01d 03:19, unchanged 03:54): platform 5-L -> 5-PORT -> CLI journey+sweep-eperm stack -> 5-G -> 5-DS -> HoO.
- IN FLIGHT: (1) BUILDER_cli-and-testing_journey (pid 21208), worktree D:\omk-gates\cli-journey, local branch `journey-builder` = 32af9df on 41f6866
  (journey, ACCEPTED by 01d incl. J7 condition; carries PROGRESS "CLI: test journey" + "CLI: real-kill and cluster ports", this charter, 4 briefs).
  Steps it waits for: (A) after 5-L's sha: `omnikom test journey --target staging --only J4,J5,J6` (our --alert-to only); J5 must PASS on its own
  lead (closes UNPROVEN), send the lines to HoO. (B) after 5-PORT's sha: rebase, keep harness.mjs:19 comment unless PREFIXES has omnikom-jb-,
  re-copy this charter, `git cherry-pick 41f6866..sweep-eperm` (3 commits 4883e3c, cb3b3d4, 0aeb495), run --unit, mutate --only journey,
  --only "cluster sweep", --only "mutate targets", gitleaks; push to check/cli-and-testing/journey on the head's word; land after a 9-of-9 run.
  (2) BUILDER_cli-and-testing_real-kill (pid 26412), worktree D:\omk-gates\cli-real-kill: sweep-eperm 0aeb495 run 41374458556 pending
  (cb3b3d4 run 41370103496 GREEN 9 of 9); owes the 4 "mutate targets" mutant lines on Windows. Stop it after that report (stop-builder --pid 26412),
  then remove its worktree.
- Done today: real-kill fix landed ce587bc (DECISIONS 50 port map); brief to platform briefs/to-platform-port-map.md (slice 5-PORT); small-fixes 41f6866.
- QUEUE after the stack: slice 2a then 2b (briefs/slice-2-functions.md, check against master first); `audit --prompt-coverage FILE` (SEO 5c);
  big-output hook (DECISIONS 41). Findings routed to platform: staging dashboard unstyled; 36 leftover 5.3 flow leads in Demo A; J5 form 400; favicon 404.
- 2026-11-02 04:20 (CLI-d): step (A) on staging after 5-L (a2570e2, test site republished, deploy ce3eb1fa): J4 PASS (favicon closed), J5 FAIL HTTP 503 "We could not send this" 0 rows, J6 PASS on the lead-send fallback. Head read j5-form-answer.png and factory/worker/lead-endpoint.mjs:88 (only 503 = 'lead endpoint not configured': siteId/signingKey/platformBase missing), UNPROVEN until platform reads the Function log. Routed to platform + HoO-02. Re-run --only J5,J6,J7 after their fix. J5 own-lead UNPROVEN stays.
- 2026-11-02 04:28 (CLI-d): QUEUED (LOW, from HoO-02; for the final HANDOVER queue): `omnikom land` retries a github.com:443 network failure BEFORE it takes the lock, bounded (3 tries, backoff), one printed line per try, never retries once the lock is held; test watched red + mutant (5-L took 5 tries, 5-PORT failed once; api.github.com fine). J5 fix with platform: BUILDER_platform-build_5-L-r2 (pid 21380) sets SITE_ID, SITE_SIGNING_KEY, PLATFORM_BASE on the test preview + a publish refusal; platform sends the go for --only J5,J6,J7.
- 2026-11-02 04:35 (CLI-d): sweep-eperm final 0aeb495 (3 commits on 41f6866), run 41374458556 9 of 9 success, "321 mutants, 321 caught, 0 survived, 0 target text missing". BUILDER_cli-and-testing_real-kill stopped (stop-builder 26412: "left":[]), worktree D:\omk-gates\cli-real-kill removed, branch sweep-eperm kept. NOT DONE: Windows copy of the 4 'mutate targets' mutants (cut by the stop; the stacked journey run re-proves on Linux).
- 2026-11-02 07:48 (CLI-d): J5,J6,J7 PASS on staging 07:44 on J5's own lead ("1 lead row \"Journey 96804450\" stored"; "3 PASS, 0 NOT BUILT YET, 0 FAIL"); head + HoO-02 read j6-inbox-owner-a.png; 5-L CLOSED. Stack a5a33c6 (journey + sweep-eperm on c010c65) run 41391587176: 8 of 9 green, CLI job running. Follow-up bd8280f on a5a33c6 (J5 accepts sent text + exactly 1 row; J6 port 4173 check), 3 new mutants UNPROVEN (local run going). SEO 4c flip: CLI yes given (run.mjs + commands/audit.mjs:5-6 + README.md:26 comment fixes + 1 CLI mutant entry, SEO's commit). QUEUE (LOW): journey removes the leads it made at the end of a run (5-CL pattern, by marker) after the screenshot; land network retry before the lock.
## HANDOVER FINAL 2026-11-02 09:12 (HEAD_CLI-and-testing_2026-11-01d, session 5452c08c, Opus 5.5, SWAP ~330k, to HEAD_CLI-and-testing_2026-11-02; report to HEAD-OF-OPERATIONS_Omnikom_2026-11-02b). Supersedes the PROVISIONAL block of 03:55.
- Master 34c3ceb at 09:12. IN FLIGHT (finish first): stack c3927c2 on check/cli-and-testing/journey (6 commits on 34c3ceb: a54794e journey,
  79eb111 + b22bc69 + 4538531 sweep-eperm and the --unit "mutate targets" check, 49c1878 J5 Thank-you + exactly 1 row / J6 port-4173 check,
  c3927c2 this charter to 07:48). Run 41404410237 (pushed 09:09). On 9 of 9: `node tools/omnikom-cli/omnikom.mjs land check/cli-and-testing/journey`
  (bounded retry on a github.com:443 drop; check `git ls-remote backup-gh refs/heads/master refs/heads/land-lock` after), send the master sha to
  HoO-02b. If master moved: rebase in worktree D:\omk-gates\cli-stack (cherry-pick 34c3ceb..c3927c2 onto new master), gitleaks, push with
  --force-with-lease=...:c3927c2dbbd8f2b65d24b8693f1cbe2fcabf3f0d, fresh run. If the CLI job TIMES OUT (limit 120, ci.yml:134; last run 101 min):
  that is a red: split or shard the CLI mutate step in this stack before landing (test + mutant), never a plain re-run (HoO rule).
  UNPROVEN until that run: the follow-up's 3 new journey mutants (port check removed, IPv4-only port check, Thank-you not accepted).
- Builder still live: BUILDER_cli-and-testing_journey (pid 21208, sonnet), worktree D:\omk-gates\cli-journey (branches journey-builder,
  journey-followup; possibly a local `mutate.mjs --only journey` under the heavy lock). Stop it after the land (stop-builder --pid 21208), then
  remove worktrees D:\omk-gates\cli-journey and D:\omk-gates\cli-stack; delete local branches sweep-eperm, journey-builder, journey-followup
  once master holds them. Keep D:\omk-gates\cli-public-copy (PARKED D46/D47).
- Proven today: real-kill reds = cluster ports inside the ephemeral range (run 41350867780), fix landed ce587bc, DECISIONS 50 port map (CLI
  21000-21899; dashboard Playwright 27000-27899 = 50 (e), platform 5-PW); small-fixes 41f6866; journey J5,J6,J7 PASS on J5's own lead on staging
  07:44 ("3 PASS, 0 NOT BUILT YET, 0 FAIL"), 5-L closed by HoO.
- QUEUE, in order: (1) CLI mutate step near the 120-min CI limit: split or shard it (test + mutant). (2) slice 2a then 2b
  (briefs/slice-2-functions.md; check against master first). (3) `audit --prompt-coverage FILE` (SEO 5c). (4) `omnikom land` retries a
  github.com:443 failure BEFORE taking the lock, 3 tries with backoff, one line per try, never after the lock (test + mutant). (5) the journey
  removes the leads it made at the end of a run, by marker, after the screenshot (5-CL pattern). (6) big-output hook (DECISIONS 41).
- Consents given: SEO 4c flip edits tools/omnikom-cli/test/run.mjs (:346-:484), commands/audit.mjs:5-6 and README.md:26 comments, and adds one
  CLI mutant "audit and gate: a built folder with no --target is given a default target [4c-flip]"; whoever lands second rebases (our run.mjs
  hunks are ~12 and ~1572; both append to test/mutate.mjs).
- Findings with platform: dashboard unstyled (5-DS); fixed 4173 Playwright port (5-PW); proc-guard PREFIXES lacks omnikom-jb- (5-G;
  harness.mjs:19 comment says so, reword when 5-G lands).
- Rules learned: poll a builder that goes quiet after a GO (the stack sat built but unpushed 84 min); check the WHOLE mutant list's target texts
  before a push (now a --unit check); a green run is void once master moves: rebase, fresh run.
- 2026-11-02 09:30 (CLI-d): stack c3927c2 run 41404410237 RED 7 of 9 (no timeout): gates "FAIL process guard mutants ... 20 caught, 1 escaped" (not our files; master 34c3ceb run 41400901148 green; the unnamed escape is platform 5-G's), CLI --unit "FAIL journey browser: ... did not report its DevTools address in 15 s" (ours: lib/browser.mjs:183 fixed 15 s deadline; a5a33c6 passed it). ONE bounded `gh run rerun --failed` for evidence. If green: land, and QUEUE (top, with the CI split): browser start deadline robust under load, watched red. If red again: BLOCKED, hand over.
## HANDOVER FINAL, AMENDED 2026-11-02 09:34 (CLI-d; HoO-02b ruling 09:32). Replaces the IN FLIGHT and QUEUE parts of the 09:12 block.
- DO NOT LAND c3927c2 (check/cli-and-testing/journey, on 34c3ceb), even on a green rerun. Run 41404410237 attempt 1 RED 7 of 9:
  gates "FAIL process guard mutants      mutants: 20 caught, 1 escaped ..." (pre-existing: tools/proc-guard not in the diff, master 34c3ceb run
  41400901148 success; routed by HoO to platform 5-G r2; a green gates job on a rerun is accepted for it) and CLI --unit "FAIL journey browser:
  the browser tests ran to the end: the browser did not report its DevTools address in 15 s" / "FAILED: 485 of 486 checks passed, 1 FAILED".
  Attempt 2 (`gh run rerun --failed`, requested 09:29) is EVIDENCE only; its result is the next line if this session saw it.
- QUEUE, in order:
  (1) In this stack, as its own commit on top of c3927c2: tools/omnikom-cli/lib/browser.mjs (new in this stack, :183) waits for the DevTools
      address by polling the port file up to a longer bound picked from measurement (e.g. 60 s, the bound printed in the failure line); a test
      watched red with a stub browser that reports late; a mutant (deadline back to 15 s, or the poll removed). Then push (lease c3927c2), fresh
      run, land on 9 of 9 (bounded retry on :443), send the master sha to HoO.
  (2) CLI mutate step near the 120-min CI limit (last full run 101 min, ci.yml:134): split or shard it (test + mutant).
  (3) `omnikom land` retries a github.com:443 failure BEFORE taking the lock: 3 tries with backoff, one line per try, never after the lock.
  (4) the journey removes the leads it made at the end of a run, by marker, after the screenshot (5-CL pattern).
  (5) port map line 27000-27899 (dashboard Playwright, DECISIONS 50 (e)) is in briefs/real-kill-flake.md in commit 49c1878 of this stack:
      confirm it lands with the stack.
  then slice 2a/2b, `audit --prompt-coverage FILE`, big-output hook.
- Live: BUILDER_cli-and-testing_journey (pid 21208, sonnet; worktree D:\omk-gates\cli-journey) is idle-able; reuse it or stop it
  (stop-builder --pid 21208). Worktree D:\omk-gates\cli-stack holds c3927c2 checked out: build item (1) there or on a fresh worktree.
- 2026-11-02 09:45 (HEAD_CLI-and-testing_2026-11-02, Opus 5.5, from HoO-02b): read the charter, the 09:12 and 09:34 blocks, DECISIONS 45-51; CLI-d stopped (stop-builder --pid 25196: "left":[]). Run 41404410237 attempt 2 still in progress at 09:40 (evidence only). Item (1) briefed to BUILDER_cli-and-testing_journey (pid 21208): tools/omnikom-cli/briefs/browser-start-deadline.md (wall-clock deadline from measurement, fail fast on browser exit, elapsed in the failure line, late-stub test watched red, 3 mutants); branch browser-deadline over c3927c2 in D:\omk-gates\cli-stack.
- 09:41 builder: its local `mutate.mjs --only journey` on bd8280f was STOPPED for this slice: baseline "OK: 688 of 688", 15 of 30 run, 15 caught; the other 15 (incl. the 3 new journey mutants) UNPROVEN locally, to be proven by the stack's CI CLI job. Port map line 27000-27899 confirmed in c3927c2:tools/omnikom-cli/briefs/real-kill-flake.md (queue item 5 done). Weekly usage 89% at 09:41.
- 11:40 (head): f23e418 (browser-deadline over c3927c2) reviewed and accepted: wall clock, DEVTOOLS_WAIT_MS 180000 from 22 measured Edge launches (worst 74.5 s under 4 at once + 8 CPU burners), exit/spawn error at once, EBUSY read retried; builder's lines: 6 tests watched red on c3927c2's browser.mjs ("did not report its DevTools address in 15 s" at 15.1 s), --unit "OK: 516 of 516", "4 mutants, 4 caught, 0 survived, 0 target text missing", gitleaks "no leaks found". NOT pushed: master moved to 39fb39d (platform 5-PW: dashboard preview off localhost:4173 onto 127.0.0.1:27000-27899), and on it J6's inboxShot (commands/journey.mjs:312) would poll localhost:4173 forever (laptop-only step, CI would not see it). Part 2 of the brief: journey-r2 = 39fb39d + the 7 stack commits + a J6 port fix, all journey mutants, one staging run J4-J7.
- 14:37 (head): HoO asked for status (no report since 11:33). Found: journey-r2 = 39fb39d + 7 stack commits (782a74d) rebased; Part 2 edits uncommitted in 5 files; no test/mutate process running; builder 21208 alive. Polled it with an idle notice. Miss: no poll between 11:40 and 14:35 (rule from the 09:12 handover: poll a builder that goes quiet). Nothing pushed; check/cli-and-testing/journey still c3927c2.
- 14:40 builder: Part 2 coded, uncommitted; 3 new J6-inbox tests watched red on f23e418 (e.g. "the dashboard preview did not come up on localhost:4173 in 60 s"), --unit "OK: 517 of 517"; `mutate.mjs --only journey` running since 11:52 under heavy.mjs (baseline "OK: 696 of 696", 24 caught, 0 survived so far). My 14:37 process check missed that run (it filtered node command lines; heavy.mjs hides it). Next: mutant line, gitleaks, commit, one staging run J4-J7.
- 14:58 (head): reporting to HEAD-OF-OPERATIONS_Omnikom_2026-11-02c (02b stopped 14:55). Its list: land journey-r2 (lease c3927c2, 9/9), then the CLI mutate-step split (should also cut local journey mutant time). CTX OK ctx=149781 turns=38.
- 15:10 (head): queue item (2) briefed, not started: tools/omnikom-cli/briefs/mutate-parallel.md (mutate.mjs --workers N, private tree copy and port sub-block per worker, inside tools/omnikom-cli/ only because .github/ is platform-build's; measure first). Starts after journey-r2 lands. Builder 15:02: journey mutants 27 caught, 0 survived, ~7 left.
- 15:10 (head) DECIDED: local `mutate.mjs --only journey` on journey-r2 stopped at 27/34 caught, 0 survived (ETA to finish was ~15:55, holding heavy.lock since 11:52 with SEO, 5-G, 5-DS queued). The 7 unrun are proven by the stack's CI CLI job (ci-heavy runs all mutants when tools/omnikom-cli/ changes; DECISIONS 45 d: GitHub is the gate). Lesson: a local full mutant run of a group duplicates the CI gate; run locally only the new mutants (--only <tag>).
- 15:14 builder: journey mutants stopped at 29 caught, 0 survived, 0 missing (baseline 696/696); heavy.lock released (pid 7964 gone; 5-DS pid 40356 took it). 5 unrun (J6/J7 fallback second alert; 4 browser-start ones already caught on f23e418) go to CI. Finding: 303 omnikom-cli-mut-* copies in %TEMP% from killed runs; added to briefs/mutate-parallel.md, nothing deleted (live owners possible).
- 15:20 (head): 5481776 (J6 port via apps/dashboard/scripts/preview-port.mjs choosePort/baseUrl/PORT_ENV, 4173 precheck and portFree removed, seams for tests) reviewed, accepted; builder gitleaks "no leaks found". journey-r2 = 39fb39d + 7 cherry-picks + 5481776. Follow-up (queue, small): inboxShot's "preview up" wait is a count (120 x 500 ms + 2 s fetch timeouts), not a clock; same class as the browser fix: wall clock, fail fast if the preview process exits.
## HANDOVER 2026-11-02 21:52 (HEAD_CLI-and-testing_2026-11-02b, session c566f7ac, Opus 5.5, CTX WATCH 198,259; written before the CI wait; to the next CLI head; report to HEAD-OF-OPERATIONS_Omnikom_2026-11-02e)
- Master 8de00a2 at push time. IN FLIGHT: check/cli-and-testing/journey = 0937c6767ff57f12ae979b5cd7e8de38f57fd5be (pushed 21:48 with lease 62315d5), run 41513353882
  (created 19:48:28Z). = 8de00a2 + c55f9f1, 14870ce, 7741a82, 2049e6b, afb2e37, 233f961 (journey stack), 0d2e25f (DevTools wait), 8b0e2b2 (J6 on the
  5-PW port), c005c33 (charter), 0937c67 (this slice: run.mjs --bail via test/mutate-run.mjs makeCheck/classify, mutate.mjs runs mutants with --bail,
  classify = caught iff exit != 0 OR a FAIL line, repeatable --only, lib/browser.mjs clock seam (DevTools-wait check 20.1 s -> 0.1 s), copies via
  guardedTemp('omnikom-cli-mut-') + sweepCopies of dead owners, J6 "4173" check narrowed + regression check, 20 [mw] mutants). Local worktree
  D:\omk-gates\cli-stack, branch mutate-workers.
- Proof held: staging J4-J7 from 0937c67 "4 PASS, 0 NOT BUILT YET, 0 FAIL" (lead "Journey b8675550"; PNGs in builder scratchpad
  f9fd1a61-.../journey-png/journey-20261102194355/, HoO-02e opened j4/j5/j6); local "7 mutants, 7 caught, 0 survived, 0 target text missing"
  (baseline 708/708); gitleaks "10 commits scanned ... no leaks found".
- NEXT if the run is 9/9: `node tools/omnikom-cli/omnikom.mjs land check/cli-and-testing/journey` (bounded retry on github.com:443), send HoO-02e
  the land line, master sha, CLI job duration (compare: job 125304089822 cancelled at 2h0m) and the mutant summary line. If the CLI job is red or
  slow: read the step log / annotation (gh api repos/<repo>/check-runs/<job id>/annotations), fix on a FRESH builder (mutate-workers is at SWAP).
- After the land: stop BUILDER_cli-and-testing_mutate-workers (pid 21268); remove worktrees D:\omk-gates\cli-journey and D:\omk-gates\cli-stack
  (rmdir the junction apps/dashboard/node_modules first, never delete through it); delete local branches sweep-eperm, journey-builder,
  journey-followup, browser-deadline, journey-r2, mutate-workers once master holds them. Keep D:\omk-gates\cli-public-copy (PARKED D46/D47).
- QUEUE (next slice first): (1) the journey removes its own lead after J7, by marker (5-CL pattern); the inbox holds 7 journey leads (2026-11-01
  21:42 to 2026-11-02 21:44): clean them too. (2) inboxShot's "preview up" wait (commands/journey.mjs, 120 x 500 ms) to a wall clock, fail fast if
  the preview exits. (3) `omnikom land` retries a github.com:443 failure before taking the lock. (4) slice 2a/2b, `audit --prompt-coverage`,
  big-output hook. (5) If CI is still near the limit: run only the covering checks per mutant (deferred lever).
- Findings out: proc-guard PREFIXES lacks 'omnikom-cli-mut-' (routed to platform by HoO-02d; our copies already use the plain name). J6 "4173"
  flake: mechanism proven by the regression check, occurrence in the 17:53 run not recorded.
- Rules learned: mutate.mjs already ran 3 mutants concurrently (mutate.mjs:452): read the runner before planning parallelism; local mutant runs
  need OMNIKOM_MUTANT_TIMEOUT_MS (the 600 s default cuts a 26 min Windows baseline: "BASELINE FAILS" with no FAIL line is that, not a red); local
  timings are dominated by real-git checks, so measure CI time from CI logs; a re-subscribe to an already-idle builder fires at once (do not loop).
- 22:19 LANDED (supersedes the IN FLIGHT and "After the land" parts above): run 41513353882 "9 of 9 jobs success"; "git: 8de00a2..0937c67 ... -> master",
  "land: master is 0937c6767ff57f12ae979b5cd7e8de38f57fd5be". CLI job 125510527737 28 min 19 s (19:48:41Z-20:17:00Z; before: cancelled at 2h0m),
  mutant step 23 min 40 s, "baseline: OK: 707 of 707 checks passed", "371 mutants, 371 caught, 0 survived, 0 target text missing". PROVEN.
  Done after the land: stop-builder --pid 21268 ("left":[]); junctions rmdir'd (E: node_modules intact), worktrees D:\omk-gates\cli-stack and
  cli-journey removed; branches sweep-eperm, journey-builder, journey-followup, browser-deadline, journey-r2, mutate-workers deleted. No builder live.
  NOT DONE: this charter's lines from 17:48 on (and the HANDOVER block) are uncommitted in the E: checkout (land left its local master at 4f91b52,
  12 paths differ); the next head commits them on a check branch over 0937c67. NEXT slice: queue item (1).
- 2026-11-04 07:50 (HEAD_CLI-and-testing_2026-11-04, session 5b01fc1c, Opus 5.5; reports to HEAD-OF-OPERATIONS_Omnikom_2026-11-02e): took over from
  the 21:52 HANDOVER (its 22:19 land PROVEN). The "NOT DONE: uncommitted" note is settled by HoO: that work is on GitHub branch
  check/archive-2026-11-04/shared-tree (284f2f5), take only what master lacks, never merge it. Jobs from HoO: (1) a journey step per CRM
  block-1 feature (field edit, server list filter and sort, bulk, export columns) and J8/J9 removed (leads are never pushed); (2) a ci.yml
  step `node tools/icm/index.mjs --check`; (3) review platform's seed.mjs edit.
- 07:55 job 3 ACCEPTED: 41ab89a's TEST_CONTRACT forms.contact equals tenancy.test.sql:74 by test/run.mjs:137's compare ("equal: true");
  the compare without forms is "false" (watched fail).
- 07:58 job 2: HoO ruling (a), one-time carve-out: one step in the `gates` job of .github/workflows/ci.yml (platform-build owns .github/,
  HoO owns tools/icm/). Builder BUILDER_cli-and-testing_icm-ci pushed 9a2892b; head re-ran a clean clone: --check exit 0, a stale doc exit 1
  ("STALE icm/index.json: changed: docs/product/README.md (lines)"), restored exit 0. Land REFUSED: run 41783980555 cli job "527 of 529
  checks passed, 2 FAILED", "step not mapped: ICM index is fresh". RULE LEARNED: every new ci.yml step needs its row in
  tools/omnikom-cli/commands/ci.mjs (NODE_STEPS / ROWS), or `omnikom ci`'s real-ci.yml checks go red. Fix sent to the same builder.
- 07:55 job 1: builder BUILDER_cli-and-testing_crm-journey (pid 23004) briefed: J7 export checks one column per form field; new steps
  field edit, server list, bulk (bulk delete with confirm is last, so the journey removes its own lead); J8/J9 removed, ids renumbered.
  The 7 old journey leads on staging are NOT cleaned by it (a separate write, unreleased).
- 09:01 STANDING ORDER (owner via HoO): for every block platform lands (crm-2 export/import next, then block 3 CRM screens, then the
  rest) add its journey step on staging the same day, so every book row that turns WORKS has a step showing it. Block order asked of
  HEAD_Platform-build_2026-11-04. Stop all work at 95% weekly usage and tell HoO.
- 09:04 Platform's block order (HEAD_Platform-build_2026-11-04; it sends each land commit the day it lands): 1 crm-2 (backend only:
  A21, A22 "backend proven", C11 import consent, F3; step drives crm-map-propose, crm-template-save owner only, lead-export with
  `template`, lead-import dry_run true then false, duplicates "skip", consent tick required, a member refused, add-lead refusing a bad
  typed answer; reference supabase/tests/e2e-crm-io.mjs); 2 seo-read (F1, F2); 3a CRM screens (A2, A21, A22, list/bulk/export screens
  WORKS); 4 settings (B3, B16-B19, C13, D8); 3b (A13, A14, A17, A18); 5 site content (B8, B11-B15); 6 overview (B20, B21, C16);
  7 onboarding (C14, C11).
- 10:50 job 2 LANDED, PROVEN: master 293e7fb ("ci green: 293e7fb run 41799105889, 9 of 9 jobs success"): the gates job runs
  `node tools/icm/index.mjs --check` (stale doc watched red: "STALE icm/index.json", exit 1), mapped in commands/ci.mjs NODE_STEPS.
  Every commit that edits a doc now regenerates icm/ (`node tools/icm/index.mjs`) or goes red. Land needed 3 tries ("gh run list failed
  ... TLS handshake timeout"); builder icm-ci stopped, worktree removed.
- 15:16 job 1 LANDED, PROVEN: master 5809e85 (run 41832234978, 9 of 9; cli "OK: 783 of 783 checks passed", "439 mutants, 439 caught,
  0 survived, 0 target text missing"). Staging journey from fac6390: "10 PASS, 0 NOT BUILT YET, 0 FAIL", cleanup "0 journey lead(s)
  removed, 0 left", 2 alerts to amer@omnikom.io. J7 export = the contract's leadColumns in form order, J8 field edit (2 edited events),
  J9 server list (search 1, filter eq and range, typed sort 9 before 10 over a second `lead send` lead), J10 bulk status, owner,
  delete refused without confirm (409 S-CONFIRM) and done with it; push steps removed (leads are never pushed). Rounds: r1 staging red
  found OUR bug, `seed test` wrote resolved without leadColumns (seed.mjs:78 vs stage.mjs:55; migration 14 reads order from it) and
  per-call magic links raced J6's own sign-in (a new link voids the last: 403); r2 one verified session per person per run and a
  clean-up that always runs; r3 the stale DB check run.mjs:1077 (CI "778 of 781"); r4 two cleanup survivors killed (re-look before
  "0 left"; never delete a lead without the run id, head watched it red). Builder crm-journey kept for the follow-up.
- RULES LEARNED today: a `--unit` local run misses the DB part, CI catches it (HoO ruling: local = touched suites only, CI is the gate;
  one heavy job at a time on the laptop); journey checks alone run in ~1 min via a scratch runner of journeyTests (no lock);
  tools/with-env.mjs caps a child at 10 min (with-env.mjs:18), too short for the journey.
- QUEUE (in order): (1) seed workspace leadColumns (seed.mjs:301, a real client loses column order) + session-cache-drop test, builder
  crm-journey on check/cli-and-testing/seed-leadcolumns; (2) crm-map F1 (contract label as synonym in proposeMap) and F2 (HubSpot exact
  case headers), each watched red; (3) land: bounded retry of GitHub network errors, lock release retried with backoff, a rerun takes
  over a lock naming its own branch and sha (SEO finding: 37 min stale lock); (4) with-env cap; (5) browser-close flake ("after close the
  browser process and its profile folder are gone", local only, lib/browser.mjs); (6) the 7 old journey leads on staging (delete needs
  HoO's release); (7) a journey step per platform block the day it lands (crm-2 first; platform asks my go before its staging e2e).
## HANDOVER 2026-11-04 15:58 (HEAD_CLI-and-testing_2026-11-04, session 5b01fc1c, Opus 5.5, CTX SWAP 220,616; to the next CLI head; report to HEAD-OF-OPERATIONS_Omnikom_Platform)
- Master 5809e85 (job 1), 293e7fb (job 2); job 3 accepted. All three HoO jobs of the morning are DONE and PROVEN (lines above).
- LAND ORDER (HoO, binding): platform's crm-2 (0d4f588, CI running at 15:30) lands next, then SEO's audit-results; NO CLI land until SEO
  says audit-results is in. Then, in order: (a) this charter branch check/cli-and-testing/head-log-2 (d2767bb + this HANDOVER; worktree
  departments\cli-and-testing\builders\head-log): rebase on master, `node tools/icm/index.mjs`, --check OK, push, land, then remove the
  worktree and branch; (b) check/cli-and-testing/seed-leadcolumns a8e9852 (builder BUILDER_cli-and-testing_crm-journey, worktree
  builders\crm-journey): seed.mjs resolveContract shared by seed test and seed workspace (leadColumns in form order), session-drop
  checks J3/J6, 4 mutants; head re-ran journey checks {"total":161,"failed":0}; builder watched each of 4 mutants red by hand. Tell the
  builder to rebase, then land on CI (the seed workspace DB checks run only on CI).
- STAGING: platform holds owner-a on staging from its crm-2 land for ~30 min (M15, 5 functions, e2e-crm-io, e2e-crm, e2e-screens) and
  messages "clear". After clear: delete the 7 old journey leads of workspace A (HoO released 15:3x: only test workspace A, names
  "Journey <8 hex>" from journey runs; paste ids and 0 left), then the crm-2 journey step (platform's block order line 09:04 above).
- Platform waits for our go before each staging e2e; HoO adds the journey evidence to 1-product.md rows A3, A9-A12, A15, A20, A24
  after crm-2 (text sent 15:30).
- Head tools: scratch runner of journeyTests (journey checks alone, ~1 min, no lock): import harness.mjs CLI_ROOT/REPO_ROOT/cli, journey.mjs
  journeyTests, mutate-run.mjs makeCheck; call journeyTests({check, cli, CLI_ROOT, REPO_ROOT}); print counts(). Rebuild it in the new
  session's scratchpad (12 lines).
- QUEUE after (a) and (b): the QUEUE line above, items 2-7 (crm-map F1/F2; land retry + lock release backoff + own-lock takeover; with-env
  10-min cap; browser-close flake; journey step per platform block). Weekly usage 78% at 15:55; stop at 95% and tell HoO.
- 16:21 (HEAD_CLI-and-testing_2026-11-04b, Opus 5.5; reports to HEAD-OF-OPERATIONS_Omnikom_Platform): took over from the 15:58 HANDOVER.
  Scratch journey runner rebuilt; on master 5809e85 {"total":159,"failed":0} (161 on a8e9852: J3/J6 session-drop checks). Platform
  "clear" 16:21: crm-2 landed, master 0d4f588 (CI 41838590596, 9 of 9); its e2e-crm-io.mjs readback bug (column alias `t` inside
  sql.rows) is fixed on check/platform/crm-2b, lands after SEO's slot.
- 16:23 the 7 old journey leads of staging workspace A removed (service.delete_lead as owner-a, each read back gone; dry run listed the
  same 7 first): "removed 7, failed 0; journey leads left in workspace A: 0". Ids sent to HoO. Builder crm-journey told: rebase a8e9852
  on 0d4f588 and push (no land), then J11 "CRM export and import" (crm-2 step) on the same branch; it sends the staging command, head
  gives the go. Still held: every CLI land until SEO says audit-results is in.
- 16:26 HoO: platform head is now HEAD_Platform-build_2026-11-04b. LAND ORDER (binding): SEO's audit-results, then platform's crm-2b,
  then ours (this charter branch, then seed-leadcolumns with J11).
- 16:58 SEO: audit-results landed, master d6076e8, lock released (adds `run.mjs --summary`; --summary with --json exits 2). Owed line
  for "cli mutant 4c-flip": "caught audit and gate: a built folder with no --target is given a default target [4c-flip]" / "1 mutants,
  1 caught, 0 survived"; CI's CLI job green on ae8741d. Next land: platform's crm-2b, then ours.
- 21:20 LANDED (HEAD_CLI-and-testing_2026-11-04b): (a) charter branch head-log-2 at 768dc65 (CI 41861737490, 9 of 9; worktree and branch
  removed); (b) seed-leadcolumns with J11 at 4bfaac7 (CI 41888371894, 9 of 9). Between them HoO's book-rows (2d0f909) landed. First
  try of (b) REFUSED on CI 41872270463: "455 mutants, 453 caught, 2 survived" (J11: add-lead need not refuse a bad typed answer; the
  consent sentence is not checked). Cause: each planted fault also tripped the NEXT clause, so the mutated clause was never the one that
  caught it. RULE LEARNED: one planted fault per clause; a fault must fail only the clause its mutant removes. Fixed in 4bfaac7 (457
  mutants). Second try BLOCKED before CI (api.github.com connection timed out, no lock taken); the retry landed.
  J11 on staging 17:46: J1 and J11 PASS, exit 0, "cleanup: 0 journey lead(s) removed, 0 left". Head re-ran the journey checks on
  c110817 {"total":176,"failed":0} and 4bfaac7 {"total":179,"failed":0}; head watched the mutant "member may save a map" red on c110817
  ({"total":176,"failed":1}). Platform: add-lead keeps 400 I-ANSWER (WO 02 Settled 8), J11 accepts 400 or 422.
  NEXT (QUEUE items 2-7): crm-map F1/F2; land retry + lock release backoff + own-lock takeover (today's blip is its case); with-env
  10-min cap; browser-close flake; journey step per platform block (next: seo-read). Usage 84% at 21:20; stop at 95% and tell HoO.
- 22:19 HoO HELD SLOT (binding): platform's 07 (CRM screens) lands next (refused twice tonight). NO CLI land, head-log-3 included, until
  platform says 07 is in. Builder BUILDER_cli-and-testing_crm-map-f1f2 (Sonnet, pid 25384) started 21:28 on crm-map F1/F2, option (a)
  for both (head's decision): F1 the contract label as one more exact synonym in proposeMap; F2 hubspot.json headers in HubSpot's case.
  It pushes, never lands; platform-owned files (supabase/functions/) come to the head as a request. Empty folder
  departments\cli-and-testing\builders\crm-journey left "busy" (worktree and branches removed); delete when its process is gone.
- 22:55 crm-map F1/F2 ACCEPTED at 639c5a4 (check/cli-and-testing/crm-map-f1f2; head re-ran tools/crm-map/test/run.mjs "160 passed,
  0 failed"; 10 new mutants caught by the builder on temp copies; full local mutate.mjs BLOCKED on heavy.mjs, CI is its proof). Builder's
  deviation accepted: importRows takes the exact header, else the one case variant (F2 is unsafe without it). Platform (22:55): no change
  needed, land after 07; it wires F1 labels into crm-map-propose in its next order, fixes templates.test.ts:13's comment, redeploys
  crm-map-propose and lead-import after our land and asks us for an owner-a window before its e2e-crm-io. LAND QUEUE after platform's
  07: head-log-3 (this branch), then crm-map-f1f2 (rebase first), then remove both worktrees.
