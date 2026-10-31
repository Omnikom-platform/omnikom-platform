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
- `apps/dashboard/`

## Does not touch
Every path not listed above. In particular `tools/omnikom-cli/` (the testing department's): a step session that needs a new CLI
command sends the need up as a finding; the CLI department builds it. A bug or a need in another department's files is a finding
sent to the head of operations with options, never a fix made here.

## Head session
- Model: opus (DECISIONS 40). A standing head from step 4 (DECISIONS 34; steps 2 and 3 ran as one session per step under DECISIONS 32),
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
- Model: sonnet for a mechanical, well-specified piece; opus when the piece is design or an unknown root cause.
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
  - **4.1 Factory core, local proof** (Sonnet) PROVEN 2026-10-31 03:05 (PROGRESS.md "4.1 factory core: head's verification"; 88 checks,
    85 mutants, audit exit 0 on the build and exit 1 on the forced heading; open from it: honest sitemap lastmod, richtext sanitiser,
    page-type and unpublished-bound checks): `factory/build.mjs` (export JSON in: contract, rows, media, site; `dist/` out),
    `factory/lib/render.mjs` (the ELEV8 logic-less template renderer ported from `E:\Alex Sevilla\draft-site\site\lib\render.mjs`,
    read-only there, no dependency), `factory/lib/launch.mjs` (`_headers`, `robots.txt` noindex on preview, `sitemap.xml`, `404.html`),
    the look-folder convention of `03-FRONTEND.md` A2 under `sites/<slug>/design/` and the minimal `sites/test-demo-a/design/`,
    `sites/test-demo-a/contract.json` (from `contracts/from-plan.mjs` on a synthetic plan: home, contact, one bound page type; keeps the
    seeded collections team, listings, settings, leads unchanged) and `sites/test-demo-a/rows.json` (synthetic), `factory/test/run.mjs`
    + `mutate.mjs`. Gate: tests and mutants green; `node factory/build.mjs --export factory/test/fixtures/export-test-demo-a.json --out
    <tmp>` then `node tools/audit/run.mjs <tmp>` exit 0; `--force-fail heading` makes the audit exit 1 (the heading rule MET-003).
    Done when: those four lines are pasted in PROGRESS.md "Step 4" and the ELEV8 folder has no new file.
  - **4.2 Edge Functions, the dashboard's calls** (Sonnet) PROVEN 2026-10-31 05:55 (PROGRESS.md "4.2 dashboard functions: head's
    verification"; six functions deployed on staging and run end to end by the head, migrations 9 and 10, 214 database mutants, 58 Deno
    checks, 31 Deno mutants; open from it: capture-lead jsonb double-encoding fix in 4.3, publish live-or-in-job check, `[functions.test]
    enabled = false`): `_shared/db.ts` (connect, `set role omnikom_fn`, one place), `_shared/jwt.ts`
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
  - **4.4 The runner** (Sonnet) PROVEN against fakes 2026-10-31 06:40, UNPROVEN against the real functions, Pages and GitHub until 4.5
    (PROGRESS.md "4.4 runner and workflows: head's verification"; 87 checks, 67 mutants, actionlint clean, five workflows, every action
    pinned by SHA; open from it: full deployment id, deploy-target in the dispatch payload, document flag): `factory/runner/publish.mjs` (fetch the export, refuse a site or target mismatch, build, gates:
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
    Both pasted in PROGRESS.md "Step 4"; also pasted: a `ci.yml` run on GitHub whose `workflows` job (actionlint) passes (head of operations,
    2026-10-31: actionlint is not on this machine's PATH, so GitHub is the place it is proven); the sequence file ticked; two lines to the head
    of operations.
- Step 3 DONE 2026-10-30 (migrations 7 and 8, PROGRESS.md "Step 3"); still open from it: `supabase/auth-settings.md` checked against
  staging: DONE 2026-10-31 (full-access token banked by the owner; 24 settings read, 0 differ after the stale `rate_limit_email_sent`
  expectation was corrected from 2 to 30, the custom-SMTP value; re-run line in PROGRESS.md "Step 4"); the step-down to `omnikom_fn` inside the deployed function is UNPROVEN beyond "set role
  succeeds" (a transaction pooler would reset it silently); `diagrams/08-deployment.png` and `09-tenancy.png` still draw Workers.
- `capture-lead` paused site: DONE 2026-10-30, 409 `S-SITE-PAUSED` proven by `verify --only lead` on staging.
- `tools/deploy-capture-lead.mjs` project ref: DONE 2026-10-30, scrubbed.
- `supabase/tests/test-apply.mjs` hang: NOT REPRODUCED 2026-10-30 21:58 (10 of 10, exit 0 inside a 600 s bound); watch, not a bug.
- **"Flaky wall" DIAGNOSED 2026-10-31 05:00: not a flaky test, a masked timeout.** `docs/blueprint/specs/run-all-gates.mjs` killed the
  database-walls gate after 30 minutes (161 mutants took about 12 minutes on a quiet machine; 214 mutants after slice 4.2 under four sessions
  did not fit) and printed the gate's LAST STDOUT LINE as the failure: a "caught" mutant line ("privacy requests read wall", "the 45-day
  clock"), which read as that wall failing. The wall passed alone every time (161 of 161, 213, 214). Fix in the runner (my file): a killed
  gate prints `TIMEOUT after N s (limit, not a test failure, last line)`, the limit is 60 minutes, `GATE_TIMEOUT_MS` overrides it,
  `GATE_ONLY=<name>` runs one gate; watched red with `GATE_ONLY="contract mutants" GATE_TIMEOUT_MS=1500` (the TIMEOUT line, last line a
  "caught" line), green again with the limit restored. The Deno function tests are now a gate too. Still worth doing later: run the mutants
  in parallel so the gate fits a loaded machine (the walls runner is `supabase/tests/run-local.mjs`, mine).
- **Prompt map reaches what is built (DECISIONS 35, owner 2026-10-31 03:40; backlog for step 5 and later, NOT step 4; no slices
  planned yet, 4.2 and 4.4 stay first).** This department's four parts: (1) step 5: two new contract page types the factory renders,
  `situation` (a page shaped like a buyer's whole situation: scenario + comparison + constraint) and honest `comparison` (public,
  sourced facts about the other option only, never an invented claim: Non-negotiable 3), each with its design partial in the look-folder
  convention (`sections/<id>.mjs`, `contracts/core.json` page types, `place()` and the factory's contract-page build); (2) a read-only
  export of one workspace's lead inbox messages for the SEO research stage (that workspace only, consent-ledger aware, through an Edge
  Function or the CLI; the skill never reads the database directly); (3) where the gates land: a publish gate that fails a build leaving
  a prompt-map row uncovered without a written reason, driven by the plan artifact the SEO department defines (the shape is theirs; the
  gate's place is the factory gates or the runner's gating step); (4) step 6 or 7: dashboard rows for named/cited per prompt from the
  measure stage (data model addition; the measure stage's output shape is the SEO department's).
- **Step 5 small items (head of operations, 2026-10-31 05:04, owner-read reels assessed by him; nothing for step 4):** (1) a factory footer
  partial "Add us as a preferred source on Google" linking to `https://www.google.com/preferences/source?q=<production domain>` (Google's
  documented deeplink, developers.google.com/search/docs/appearance/preferred-sources, read 2026-10-31), production builds only, never a
  preview; and the production `_headers` must never carry `nosnippet` (it excludes the site from Google's generative features; add a factory
  gate line). (2) when `23-GROUND-RULES.md` is next edited, one line: an optimisation that bypasses a view, caches a count or relies on row
  order writes the invariant it depends on as one comment next to the test that checks it.
- **DECISIONS 37 for step 5 look-folders (head of operations, 2026-10-31 05:19; nothing to build in step 4):** every look-folder's
  `DESIGN.md` opens with a five-line direction (product, character, world, moments, signature; clean, modern, sleek, minimal and premium are
  banned as character words); design partials are built in nine passes in order (spacing, colour, icons, copy, type, layout, details,
  visuals, motion); the SEO department's DSN rule family in `tools/audit` (after its slice 2) fails a build on AI-looking tells (looping
  motion classes, gradient text, emoji labels, hype words, badges, unverifiable claims), and the factory's publish gate picks it up for free
  through `tools/audit/run.mjs`. The look-folder convention in `factory/README.md` section 2 gets the `DESIGN.md` line when step 5 starts.
- **No model in the runtime (DECISIONS 38 part 1, owner 2026-10-31 05:45; after 4.2 and 4.4 are proven, before step 5):** a structural
  check (in `docs/blueprint/specs/run-all-gates.mjs` or `supabase/tests/run-local.mjs`, this head's call; the gates runner is the likelier
  home, it already scans files) that fails when runtime code imports a model SDK or calls a model API. Scope: `supabase/functions`,
  `factory/`, `tools/audit/`, `tools/omnikom-cli/`, the dashboard source, `.github/workflows`. Tells: `@anthropic-ai`, `anthropic`,
  `openai`, `@google/generative-ai`, `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, and `ANTHROPIC_API_KEY`
  read anywhere outside an allowlisted operators folder (does not exist yet). Allowlist by path, written in the rule: the SEO skill's
  research scripts (Gemini citations, owner-acknowledged) and the future step D operators. Ships with a test watched red (a planted
  import in a scratch copy) and a mutant (the tell list emptied); add the rule line to `23-GROUND-RULES.md` in the same commit.
- Follow-ups that need a decision or another department: the global kill switch (`platform_limits` keys `sends_enabled`,
  `deploys_enabled`), `usage_daily` (24-GAP-HUNT E2 item 1, not in step 3's list), the per-person privacy export (step 5), the
  CLI reading `security_events` and `consent_ledger` in `verify` (finding sent up).
- **From 4.3 (2026-10-31 10:55):** (1) a PDF can never become processed (`media_processed` refuses a width under 1, no document
  flag): a migration with a document flag, or `media_processed` accepting a null width for documents; until then a PDF is never exported.
  (2) The runner key: revoking its registry row does not stop it, because the functions trust the function secret; `runner.ts` should
  refuse when the key's hash is not `service.active_key('runner')` (test watched red with a revoked row, mutant). (3) job-callback does
  not notify the requester or submit the sitemap (02-BACKEND): step 5. (4) `omnikom status` lists the `test` folder as a function:
  finding for the CLI head.
- **Staging walls after 4.5:** `omnikom test walls --target staging` refuses while the test fixtures are seeded (FIXTURES-PRESENT, 9
  rows), and 4.5 needs them; run it after 4.5 (`seed test --clean`, walls, re-seed) to prove the security-event fix on staging.
- **From 4.5 (2026-10-31 11:50):** (1) FLAKY CI gates job: on 8504771 attempt 1 the walls run died mid-way (no summary line,
  exit 1, 42 s) and the function-test harness then crashed at start; attempt 2 green. First make run-all-gates print a crashed gate's
  stderr tail (test watched red with a gate that throws), then find the cause. (2) A row published on the SQL path (`omnikom publish`,
  e2e scripts) skips publish validation and breaks every later build of the site (the factory stops it, nothing deploys; job
  e29fb962): start_publish, or the export, should validate the whole snapshot, or the SQL path should validate; decide and test.
  (3) The staging sites row's `preview_host` is the seed's placeholder (`demo-a.preview.test`, the runner deploys to
  `preview.test-site-demo-a.pages.dev`): finding for the CLI head's `seed test`, with `stage.mjs` / `upload-logo.mjs` / `publish.mjs`
  for it to take over.
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
- 2026-10-31 03:05, standing head: slice 4.1 (factory core) PROVEN locally, Haiku re-run equal to the builder line for line (88 checks, 85 mutants, audit 0 FAIL on the build, MET-003 FAIL on the forced heading); proof in PROGRESS.md "4.1 factory core: head's verification". Findings decided there; two go up (seed writes slug and role; flaky database wall). 4.2 builder still running; 4.4 launched next.
- 2026-10-31 03:45, standing head: DECISIONS 35 (prompt map reaches the build) recorded in Open items as backlog for step 5 and later: situation and comparison page types with their design partials (step 5), a read-only per-workspace lead-inbox export for the research stage, a publish gate on uncovered prompt-map rows, dashboard rows for named/cited per prompt (step 6 or 7). No slices planned; 4.2 and 4.4 first. Still due from this head: the flaky privacy-requests wall diagnosis.
- 2026-10-31 05:47, standing head: DECISIONS 38 part 1 recorded in Open items: a structural "no model SDK or model API in runtime code" check with a path allowlist (SEO research scripts, future step D operators), test watched red and a mutant, after 4.2 and 4.4, before step 5. Also recorded this hour: DECISIONS 35 backlog, DECISIONS 37 look-folder rules, the preferred-source footer and nosnippet gate, the invariant-comment ground rule; the "flaky wall" diagnosed as the gates runner masking a 30-minute timeout (fixed in run-all-gates.mjs).
- 2026-10-31 05:55, standing head: slice 4.2 (dashboard functions) PROVEN, Haiku re-run equal to the builder line for line (deno check, specs, 58 Deno checks, 31 Deno mutants, staging status with 10 migrations and 7 functions deployed, e2e-functions 0 problems, walls 214 mutants alone in 17 min); proof in PROGRESS.md "4.2 dashboard functions: head's verification". Committing with the gates-runner fix. Next: 4.3 builder launched, 4.4 re-run.
- 2026-10-31 06:40, standing head: slice 4.4 (runner and five workflows) PROVEN against fakes, Haiku re-run equal to the builder (87 checks, 67 mutants, actionlint clean, actions pinned by SHA, secrets dry-run names only); UNPROVEN against the real functions, Pages and GitHub until 4.5; ci.yml caps raised (gates 75, factory 60). Proof in PROGRESS.md "4.4 runner and workflows: head's verification". Builder 4.3 running; then the model switch (DECISIONS 40).
- 2026-10-31 10:55, standing head: slice 4.3 (runner functions) PROVEN, Haiku re-run (deno check, specs, staging status with the four functions deployed, staging e2e-export 31 PASS, 0 problems) and the walls by the head (215 mutants); the security-event wall scoped to its own event (finding from the CLI head), watched red with an earlier event planted, new mutant caught. PROGRESS.md "4.3 runner functions: head's verification" and "4.5".
- 2026-10-31 11:50, standing head: slice 4.5, step 4 DONE on the test site: a save reached preview.test-site-demo-a.pages.dev through GitHub (job 3f0a94e5, deploy 1321b598, the new heading served with noindex), a forced heading failure deployed nothing (job c8b1ca8d failed at the gate, MET-003), the workflows job green on GitHub; logo through media.yml, contract v2 and 12 rows by sites/test-demo-a/stage.mjs. PROGRESS.md "4.5". The ELEV8 preview waits on the owner.
- 2026-10-31 14:20, standing head: `apps/dashboard/` added to Owns on the head of operations' routing (markup plain and semantic; the styling layer goes to the Design department, DECISIONS 39, when the owner's references arrive). Step 5 and step 6 prep planned in factory/briefs/5-0-step-5-and-6-plan.md; 6A and 6B builders running; 5.1 after 4.6; 5.3 waits for the OK on E: space.
