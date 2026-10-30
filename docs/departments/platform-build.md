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
- `tools/design-engine/`
- `tools/site-backup/`
- `.github/`
- `tools/deploy-functions.mjs`
- `tools/github-secrets.mjs`

## Does not touch
Every path not listed above. In particular `tools/omnikom-cli/` (the testing department's): a step session that needs a new CLI
command sends the need up as a finding; the CLI department builds it. A bug or a need in another department's files is a finding
sent to the head of operations with options, never a fix made here.

## Head session
- Model: fable. A standing head from step 4 (DECISIONS 34; steps 2 and 3 ran as one session per step under DECISIONS 32),
  started by the head of operations with a brief that names this file; long-lived across steps; hands over through this
  charter's position log when its context is full. It plans each step of `25-BUILD-SEQUENCE.md` as slices, runs sonnet
  builders and haiku runners inside itself, and asks the head of operations for a separate step session only when a slice
  is too large for its own context.
- Reads first, in order: `CLAUDE.md`, this charter (whole file, the position log last), `.claude/POSITION.md` (last blocks),
  `planning/DECISIONS.md` (newest items), `docs/blueprint/25-BUILD-SEQUENCE.md` (its step), `docs/blueprint/23-GROUND-RULES.md`,
  then the files its step names.
- Does: the step's numbered items in order as slices with a written brief each; sonnet builders for well-specified pieces (a
  migration against a written spec, a port of a script, a workflow file), haiku agents for every mechanical run; re-runs each
  builder's proof (through a haiku runner, reading the verdict lines); pastes real output into `docs/blueprint/PROGRESS.md`;
  ticks the sequence; appends to the position log below and to `.claude/POSITION.md`; commits and pushes after a clean
  gitleaks; reports to the head of operations in two lines per finished slice and at the step's "done when" or at BLOCKED.

## Builders
- Model: sonnet for a mechanical, well-specified piece; fable when the piece is design or an unknown root cause.
- Mechanical runs (tests, mutants, gates, grep, fixture rebuilds, deploy and status commands) go to a haiku agent with the
  exact command; the head or builder reads the verdict lines back (DECISIONS 34).
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
- Step 4 gates, one line each, pasted in PROGRESS.md "Step 4" (the standing head, 2026-10-30 23:50): `node factory/test/run.mjs`
  and `node factory/test/mutate.mjs` (the factory: export in, pages out, every gate red for the right reason); `node factory/build.mjs
  --export <fixture> --out <dir>` then `node tools/audit/run.mjs <dir>` exit 0 on the test site and exit 1 on the forced heading
  violation; `deno task check` covering every function; `omnikom status --target staging` listing save, publish, export-published,
  job-callback, upload-start, upload-finish, lead-update, add-lead as deployed; the GitHub Actions run ids of one green `publish`
  run and one `failed` run (gate) on the test site, with the preview URL showing the saved change.

## Decisions that shape this department
- DECISIONS 15 (staging and production projects, no Docker), 21 (backend first, fewest screens), 22 (free tiers baseline),
  25 (proof on staging before the dashboard), 26 to 29 (domains, GitHub, hosting, setup decisions), 30 (the CLI tests the
  platform), 31 (branding and exit), 32 (one session per step), 33 (departments).

## Open items
- **Step 4 slice plan** (the standing head, session `local_cade0add-3389-4314-b7b5-83333d26a97a` of 2026-10-30 23:46; builders are in-session Sonnet agents,
  one brief each under `factory/briefs/4-<n>-<slice>.md`; every mechanical run goes to a Haiku agent; the head
  re-runs each proof through a Haiku runner before the slice is called PROVEN). Adjustments to the head of operations' shape, and
  why: the seeded test contract (`omnikom seed test`) has collections but no pages, so the factory proof needs a test-site contract
  with pages under `sites/test-demo-a/` activated as contract version 2 for workspace A on staging (a finding goes to the CLI head so
  `seed test` seeds it too); the `publish` function's GitHub dispatch token is a fine-grained token only the owner can create (asked
  through the head of operations in the first turn, so it is not on the critical path later); `.github/` and the two new tools
  (`tools/deploy-functions.mjs`, `tools/github-secrets.mjs`) are in no charter's Owns list: asked to be added here.
  - **4.1 Factory core, local proof** (Sonnet): `factory/build.mjs` (export JSON in: contract, rows, media, site; `dist/` out),
    `factory/lib/render.mjs` (the ELEV8 logic-less template renderer ported from `E:\Alex Sevilla\draft-site\site\lib\render.mjs`,
    read-only there, no dependency), `factory/lib/launch.mjs` (`_headers`, `robots.txt` noindex on preview, `sitemap.xml`, `404.html`),
    the look-folder convention of `03-FRONTEND.md` A2 under `sites/<slug>/design/` and the minimal `sites/test-demo-a/design/`,
    `sites/test-demo-a/contract.json` (from `contracts/from-plan.mjs` on a synthetic plan: home, contact, one bound page type; keeps the
    seeded collections team, listings, settings, leads unchanged) and `sites/test-demo-a/rows.json` (synthetic), `factory/test/run.mjs`
    + `mutate.mjs`. Gate: tests and mutants green; `node factory/build.mjs --export factory/test/fixtures/export-test-demo-a.json --out
    <tmp>` then `node tools/audit/run.mjs <tmp>` exit 0; `--force-fail heading` makes the audit exit 1 (the heading rule MET-003).
    Done when: those four lines are pasted in PROGRESS.md "Step 4" and the ELEV8 folder has no new file.
  - **4.2 Edge Functions, the dashboard's calls** (Sonnet): `_shared/db.ts` (connect, `set role omnikom_fn`, one place), `_shared/jwt.ts`
    (verify the user JWT against the project's JWKS with Web Crypto; `exp`, `aud`), `save`, `publish` (contract_for first, validateItem,
    `service.start_publish` pinned versions, `repository_dispatch` with `GITHUB_DISPATCH_TOKEN`; 202 with the job id even when the token is
    unset, the job then waits for the runner: NOT a silent success, the body says `dispatched: false`), `lead-update`, `add-lead`,
    `upload-start`, `upload-finish` (a new migration 9 only if a `service.*` media function is missing; wall test red first + mutant).
    Gate: `deno task check` every function; `node supabase/functions/test/run.mjs` (a function test harness over the throwaway cluster,
    fake fetch) green; deployed to staging with `tools/deploy-functions.mjs`; `omnikom status --target staging` lists them.
    Done when: the status line is pasted and the CLI head is told (slice 2 of the CLI waits on this).
  - **4.3 Edge Functions, the runner's calls** (Sonnet): `export-published` (X-Runner-Signature with `RUNNER_KEY`, `freeze_snapshot`,
    `published_rows`, contract, media list, the site's deploy target), `job-callback` (`set_job_state`, 409 on an illegal move),
    `media-process-callback`; `RUNNER_KEY` minted by `tools/mint-site-key.mjs --runner` into the env file by name and set as a function
    secret. Gate: function tests + deno check; on staging `omnikom export --job <id> --as runner` once the CLI has it, until then
    `supabase/tests/e2e-export.mjs` (signed call, two workspaces, 0 ids of B in A's export, a bad signature 401, a rerun = same snapshot).
  - **4.4 The runner** (Sonnet): `factory/runner/publish.mjs` (fetch the export, refuse a site or target mismatch, build, gates:
    factory gates + `node tools/audit/run.mjs dist`, `wrangler pages deploy` with the account token by name, smoke, callback; `--force-fail`
    for the test), `.github/workflows/publish.yml` (repository_dispatch `publish`, concurrency `site-<site_id>` queue max), `ci.yml` (every
    gate of `run-all-gates.mjs` + factory + audit + omnikom-cli units + gitleaks, Postgres binaries on the runner), `media.yml`
    (sharp pinned per the supply-chain rule, EXIF off, three WebP sizes, callback), `backup.yml` (nightly dump to R2: BLOCKED until R2
    exists, the file ships with the step disabled and says so), `keepalive.yml` (weekly `omnikom status`). Gate: `node factory/runner/test/run.mjs`
    (the deploy step replaced by writing dist; `--force-fail` leaves nothing deployed and the job `failed`); `actionlint` or `node --check`
    on every script; one green `ci.yml` run on the org repo.
  - **4.5 Done-when on the test site** (the head, Haiku runners): Pages project `test-site-demo-a` created with the Pages token (not a
    client site), GitHub secrets set by name (`CLOUDFLARE_PAGES_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `RUNNER_KEY`, `PLATFORM_FUNCTIONS_BASE`),
    contract version 2 + page rows on staging for workspace A, then: `omnikom content save` changes the contact heading, `publish`
    dispatches, the run deploys, `preview.test-site-demo-a.pages.dev` shows the heading, job `done` with its five events; a second
    publish with the heading violation: the audit gate fails, nothing deploys, job `failed`, the preview still shows the first heading.
    Both pasted in PROGRESS.md "Step 4"; the sequence file ticked; two lines to the head of operations.
- Step 3 DONE 2026-10-30 (migrations 7 and 8, PROGRESS.md "Step 3"); still open from it: `supabase/auth-settings.md` checked against
  staging: DONE 2026-10-31 (full-access token banked by the owner; 24 settings read, 0 differ after the stale `rate_limit_email_sent`
  expectation was corrected from 2 to 30, the custom-SMTP value; re-run line in PROGRESS.md "Step 4"); the step-down to `omnikom_fn` inside the deployed function is UNPROVEN beyond "set role
  succeeds" (a transaction pooler would reset it silently); `diagrams/08-deployment.png` and `09-tenancy.png` still draw Workers.
- `capture-lead` paused site: DONE 2026-10-30, 409 `S-SITE-PAUSED` proven by `verify --only lead` on staging.
- `tools/deploy-capture-lead.mjs` project ref: DONE 2026-10-30, scrubbed.
- `supabase/tests/test-apply.mjs` hang: NOT REPRODUCED 2026-10-30 21:58 (10 of 10, exit 0 inside a 600 s bound); watch, not a bug.
- Follow-ups that need a decision or another department: the global kill switch (`platform_limits` keys `sends_enabled`,
  `deploys_enabled`), `usage_daily` (24-GAP-HUNT E2 item 1, not in step 3's list), the per-person privacy export (step 5), the
  CLI reading `security_events` and `consent_ledger` in `verify` (finding sent up).
- (CLOSED 2026-10-30 21:58: the owner picked "a workspace per site" for the ELEV8 split, so no site moves between
  workspaces; each split site is a new workspace seeded from its own plan.)

## Position log (append-only, newest last; one line per finished slice or blocked item: date, slice, PROVEN / BLOCKED, where the proof is)
- 2026-10-30: department created. Steps 1 and 2 DONE (PROGRESS.md "Step 1.1 + step 2.1", "Step 2"); migration 6 applied on
  staging (active_key by site).
- 2026-10-30 22:20, step 3 session (`local_a3c114b5-9826-4504-9ab9-3363e05151d2`): step 3 DONE and PROVEN (PROGRESS.md "Step 3"):
  migrations 7 and 8 on staging (8 applied), `test walls` PASS on staging, 161 database mutants caught locally, `capture-lead`
  redeployed (409 for a paused site), the three verify suites 12 / 5 / 15 PASS on the restored fixtures. BLOCKED: the auth-settings
  API check (token scope). Reported to the head of operations.
- 2026-10-30 23:50, standing head (session `local_cade0add-3389-4314-b7b5-83333d26a97a`, Fable, this checkout): step 4 planned as five slices
  (Open items above): 4.1 factory core on the test site, 4.2 dashboard-facing functions, 4.3 runner-facing functions, 4.4 the runner and
  the five workflows, 4.5 the done-when on the test site's own Pages project. Asked up: the owner's fine-grained GitHub dispatch token
  (`GITHUB_DISPATCH_TOKEN`), `.github/` and two tool paths for this charter's Owns. Nothing built yet.
