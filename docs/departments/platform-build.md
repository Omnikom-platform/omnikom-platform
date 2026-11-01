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
- `tools/tick-sequence.mjs`
- `tools/pages-project.mjs`
- `tools/proc-guard/`
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
  One exception, DECISIONS 47 (f), closes when production exists: the client-name comment on line 7 of
  `20261029000002_crm.sql` becomes the neutral name, and staging's sha256 row for that file is rewritten only by
  `supabase/ops/migration-comment-rehash.mjs` (refuses unless the change is comment lines only; test and mutant), run by the head.
- Staging only ever runs committed, gated code (DECISIONS 43, head of operations 2026-10-31 18:23, after migration 12 reached
  staging before its tree was gated): a builder never applies a migration or deploys a function to staging; the head does it after
  the combined tree passed the full gates and is committed. A builder proves its work locally and names the staging steps for the
  head. If a gate changes something already on staging, roll staging forward to the fixed version and say so in PROGRESS.
- Keys by variable name only (CLAUDE.md rule 9); live things need the owner's click (rules 6 and 12); nothing against a client
  project or site (DECISIONS 30: Example A is touched only in step 7); no em dashes in any file.

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
Closed work (steps 1 to 4, 5.1 to 5.3, 6A, 6B, the Auth emails) is in the position log below and in `docs/blueprint/PROGRESS.md`;
`.claude/POSITION.md` holds the minute-by-minute record. This list is only what is open (pruned 2026-11-01 06:30).
- **Queue (head of operations, 2026-11-01 06:25), in order:** (1) land 5-H (`tools/proc-guard`; Linux leak found by the diagnostic run:
  an orphaned stand-in with ppid 1 counted as a live owner; fix with the builder); (2) the ENV-001 follow-on after SEO 4c is on master:
  `factory/runner/publish.mjs:143` passes `--target preview|production` to `tools/audit/run.mjs`, `factory/test/run.mjs` lines 231, 316,
  318, 322 pass `{ target }`; then tell the head of operations; (3) 5.4 Site (editor, publish sheet, instant preview), 5.5, 5.6 Settings,
  5.7 the four flows on staging (step 5 done); (4) step 6 no-click items only between slices. Delete each check branch when it lands.
- **Slices planned 2026-11-01 13:17 (head of operations: sequence as slices, not in 5.2b), after 5.4 lands, between 5.4 and 5.5:**
  **5-S1 spec fields:** check-specs ties each openapi request schema's fields to what the function's source reads (the
  `read` field of lead-update was missed because only paths are checked), and fails on a deployed function with no
  config.toml table; watched red, tests in `check-specs.test.mjs`. **5-S2 work orders for M6:** write W work orders for
  `metrics-pull` and `sitemap-submit` in `05-BUILD-PLAN.md` (today only milestone M6 and `02-BACKEND.md` section 6 name
  them), then point their planned marks in openapi.json and config.toml at the new W numbers. Sonnet, one brief each.
- **Slice 5-A anonymise (DECISIONS 47, notice 2026-11-01 14:19), after 5-W:** 66 platform files name a client (list
  `planning/anonymise-list.md` section platform-build; names `planning/anonymise-map.md`, private); brief
  `factory/briefs/5-A-anonymise-platform.md`: one re-runnable script with `--check`, built in a temp worktree of master,
  re-applied on master after 5-H, 5.2b, 5.4 land; the 14 job-read files first. The crm migration comment is handled under
  DECISIONS 47 (f) (rule above). Done when `node tools/omnikom-cli/omnikom.mjs copy build <sha> --dry-run` shows zero
  client-named platform files (until D46 lands the head of operations has the CLI head run it on our commit).
- **Owner's clicks (morning batch, sent 2026-11-01 03:05):** the `app-staging.omnikom.io` DNS record
  (`sites/dns/app-staging.omnikom.io-pages.json`, dry run clean); the backup key pair made on his machine (supabase/ops/README.md);
  the `omnikom-platform-prod` repository; R2 (payment method), a second backup provider, the production Supabase project, the Example A
  preview Pages project.
- **Open from built slices:** 5.2: DNS rebinding between resolve and fetch in crm-test is not stopped; `docs/blueprint/specs/openapi.json`
  lacks `SaveRequest.base` and the five new operations. 5.3 GAP lines (owner-unassign wording; page titles of the panel, Add a lead and
  Not found; the test contract has no forms; the tab count uses status New until 5.3b). The magic-link page `/auth/confirm` verifies on
  load, so a mail scanner that runs scripts can spend the link (24-GAP-HUNT: an intermediate confirmation page). The status page data
  is a 2026-10-31 snapshot that nothing refreshes. 6A/6B workflows have never run on GitHub (UNPROVEN). Storage `media` has no backup.
  Five stale queued test jobs on staging fire `job-over-30-min`.
- **Open from step 4:** a PDF can never become processed (no document flag); runner key revocation (`runner.ts` should refuse a key
  that is not `service.active_key('runner')`); job-callback does not notify the requester or submit the sitemap; a row published on the
  SQL path skips publish validation; the staging sites row's `preview_host` is the seed's placeholder (CLI head); staging walls after a
  non-wiping CLI run; the step-down to `omnikom_fn` inside a deployed function is UNPROVEN beyond "set role succeeds";
  `diagrams/08-deployment.png` and `09-tenancy.png` still draw Workers.
- **Step 5 and later backlog (decided, not planned):** DECISIONS 35 prompt map (page types `situation` and honest `comparison`; a
  read-only lead-inbox export for SEO research; the uncovered-prompt publish gate; named/cited dashboard rows); the "preferred source"
  footer partial on production builds and a factory gate that production `_headers` never carry `nosnippet`; DECISIONS 37 look-folder
  `DESIGN.md` five-line direction and nine passes; a `23-GROUND-RULES.md` line on optimisations that rely on an invariant; the global
  kill switch (`platform_limits` `sends_enabled`, `deploys_enabled`), `usage_daily`, the per-person privacy export; running the wall
  mutants in parallel.
- **Notices sent, waiting on others:** CLI: `commands/ci.mjs:174`, `commands/apply.mjs:20`/`:33`, `test/ci-heavy.mjs:63` kill only the
  top process on a time limit (`tools/proc-guard` is there); the CLI reading `security_events` and `consent_ledger` in `verify`.
  Head of operations: `film/engine/src/render.mjs` has no try/finally and a fixed port (film/ is never committed).

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
- 2026-10-31 11:50, standing head: slice 4.5, step 4 DONE on the test site: a save reached preview.test-site-demo-a.pages.dev through GitHub (job 3f0a94e5, deploy 1321b598, the new heading served with noindex), a forced heading failure deployed nothing (job c8b1ca8d failed at the gate, MET-003), the workflows job green on GitHub; logo through media.yml, contract v2 and 12 rows by sites/test-demo-a/stage.mjs. PROGRESS.md "4.5". The Example A preview waits on the owner.
- 2026-10-31 14:20, standing head: `apps/dashboard/` added to Owns on the head of operations' routing (markup plain and semantic; the styling layer goes to the Design department, DECISIONS 39, when the owner's references arrive). Step 5 and step 6 prep planned in factory/briefs/5-0-step-5-and-6-plan.md; 6A and 6B builders running; 5.1 after 4.6; 5.3 waits for the OK on E: space.
- **HANDOVER 2026-11-01 07:05 (head `local_cade0add`, context full after 4 compactions; to the fresh head `HEAD_Platform-build_2026-11-01`, who reports to `HEAD-OF-OPERATIONS_Omnikom_2026-11-01`).**
  Master at handover: a0c544d (this block lands on top of it). Read `## Open items` above first; it was pruned to what is open.
  - **Landed since 5.3:** 5.3 bfb89da (dashboard shell, sign-in, Leads; the ninth ci.yml job `dashboard`); 5.2 9ceef8b (the screens'
    functions; GitHub 9/9: walls 379 mutants, Deno 137/137, 182 function mutants; on staging: migration 13 applied, 16 functions deployed,
    `DASHBOARD_ORIGINS=http://localhost:5173,http://localhost:4173,https://app-staging.omnikom.io,https://omnikom-app-staging.pages.dev`,
    `e2e-screens.mjs` PASS 0 problems); Auth emails and Pages 8b2faaf (staging Auth: 600 s link, sender "Omnikom Dashboard"
    <login@notify.omnikom.io>, both templates from `supabase/auth-emails/`, read back 7/7; link-life proof PASS: 200 at 571 s, 403
    otp_expired at 631 s; `omnikom-status.pages.dev` and `omnikom-app-staging.pages.dev` deployed by `tools/pages-project.mjs`).
    Details: PROGRESS.md "5.3", "5.2 screens functions: landed and on staging", "Auth emails and the sign-in link", "The dashboard and
    the status page on Pages".
  - **In flight, NOT landed: 5-H (process guard, `tools/proc-guard/`, brief `factory/briefs/5-H-process-hygiene.md`).** Check branch
    `check/platform/5-h-r2` at 7e6ac78 is RED on GitHub (run 41269080649, gates job: `proc-guard tests: 45 passed, 6 failed`; every other
    job green). Cause found by the diagnostic commit: one orphaned test stand-in (`standin.mjs` under a `playwright_c...` folder, ppid 1)
    is never killed on Linux, because the Playwright-profile rule counts parent pid 1 (alive) as a live owner; it then pollutes every
    later leaks() check. Fix sent to the builder (parent 1 or a non-node parent = no live owner, a unit test with a fake process list
    watched red, the test stops its own stand-in in a finally, a mutant); the builder was cut off by an API error, so the shared tree's
    `tools/proc-guard/` may hold a HALF-APPLIED fix: diff it against 7e6ac78 before trusting it. The wired files (render scripts,
    site-backup, design-engine, `apps/dashboard/tests/global-setup.ts`, the cluster scripts, run-local, harness, run-all-gates' three new
    gates) are uncommitted in the shared tree and in commits ae07971/7e6ac78. Delete `check/platform/5-h` (27daab9, superseded; the
    delete failed on the network) and 5-h-r2 once 5-H lands.
  - **Next slice: 5.4** (Site, editor, publish sheet), brief `factory/briefs/5-4-site-editor-publish.md` (in this commit). Its builder
    was cut off at the start by the same API error and changed nothing. Then 5.5 (instant preview), 5.6 (Settings), 5.7 (the four flows
    on staging, step 5 done); 5.3b (Export CSV, unread bold) is still unbuilt.
  - **ENV-001 notice (SEO, DECISIONS 43), do after SEO 4c is on master:** `factory/runner/publish.mjs:143` passes `--target preview`
    for a preview build (its `_headers` carry `X-Robots-Tag: noindex`) or `--target production` for the live build to
    `tools/audit/run.mjs`; `factory/test/run.mjs` lines 231, 316, 318, 322 `AUDIT.audit(dir)` get `{ target: 'preview' | 'production' }`
    (the live build is production). Until then a missing target is one SKIP. When landed, tell the head of operations.
  - **Waiting on the owner (exact commands):**
    1. DNS: `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/dns-upsert.mjs --zone omnikom.io --records
       sites/dns/app-staging.omnikom.io-pages.json --token-env CLOUDFLARE_DNS_TOKEN_LEGACY` (CNAME app-staging.omnikom.io ->
       omnikom-app-staging.pages.dev, proxied; dry run clean 02:58). Sign-in emails land on that address (`site_url`).
    2. Backup key pair, on his machine, outside the repository, with his own passphrase: `openssl req -x509 -newkey rsa:4096 -sha256
       -days 3650 -subj "/CN=omnikom-backup" -keyout backup-private.pem -out backup-recipient.pem`; he keeps the private key and passphrase
       offline and hands over only `backup-recipient.pem` (commit it as `supabase/ops/backup-recipient.pem`).
    3. The `omnikom-platform-prod` repository in the org (then the promote workflow's secrets).
    4. R2 (Cloudflare needs a payment method), a second backup provider (a new account), the production Supabase project (billing),
       the Example A preview Pages project (CLAUDE.md rule 12).
  - **Rules that came in tonight (binding):** DECISIONS 45 (heavy proof on GitHub check branches; master fast-forwards only to a green
    tree; delete the branch after landing); the machine-wide heavy-job lock (`node ~/.claude/scripts/heavy.mjs -- <cmd>`; note it
    wrongly refused a parse-only `node --check supabase/tests/run-local.mjs`, reported); no restore drill on the laptop until the head of
    operations says the reaper reads the proc-guard `owner.json` markers (keep that marker exactly: `{ pid, started, kind, argv }`);
    the head plans, briefs, reviews, lands and reports in two lines, all hands-on work goes to builders or Haiku runners.
  - **Landing method that worked:** build the commit in a temp worktree of master from exactly the slice's files (PROGRESS and
    POSITION rebuilt from master plus your own section, since other departments leave uncommitted lines in them), push
    `check/platform/<slug>`, wait for every ci.yml job, then `git push backup-gh <sha>:master`, `git update-ref refs/heads/master <sha>
    <old>`, and `git restore --staged` of exactly the landed paths (never reset; other departments keep staged work in the shared index).
- 2026-11-01 07:40, head `HEAD_Platform-build_2026-11-01` (Opus 5.5): took over from `local_cade0add`; 5-H round 3 (brief `factory/briefs/5-H-r3-linux-orphan.md`, builder `BUILDER_platform_5-H-r3`) and 5.4 (builder `BUILDER_platform_5-4`) started as separate sessions on files that do not overlap. Open (found by 5.4 at 08:10): the staging e2e runs leave never-published drafts in workspace A (11 rows), and the sheet publishes every waiting draft, so one invalid leftover blocks every publish; 5.4 resets them in its own flow setup (staging only, dry run read by the head first); `supabase/tests/e2e-*.mjs` should remove what they create.
- 2026-11-01 10:15, head `HEAD_Platform-build_2026-11-01`: handover LANDED 70e0cb0 (omnikom land, run 41281380968, 9 of 9). 5-H round 3 (the Linux orphan: a holder whose parent is pid 1, absent, dead or not node has no live owner) PROVEN on Windows (60 passed, 21 mutants caught) and on Linux gates (runs 41280479804 and 41284384866, gates green); NOT LANDED: ready at 713b008 on `check/platform/5-h-r5`. BLOCKED: GitHub Actions starts no job ("recent account payments have failed or your spending limit needs to be increased", run 41287879634), the owner's click in Billing and plans; then re-run 41287879634 and `omnikom land check/platform/5-h-r5`. 5.4 builder `BUILDER_platform_5-4` working on staging (10 leftover e2e drafts soft-deleted with the head's OK, audit rows; Agent Two completed through save).
- **HANDOVER 2026-11-01 11:00 (head `HEAD_Platform-build_2026-11-01`, session da7d3802, context 241k of the 250k swap line; to the next head, who reports to `HEAD-OF-OPERATIONS_Omnikom_2026-11-01`).** Master: c2811ee. Proof lines for everything below: PROGRESS.md "5.4", "5.2b", "5-H round 3".
  - **BLOCKED for every department:** GitHub Actions minutes for November are used up (Free plan, 2000 of 2000; the spending limit stops new jobs). Owner's click. Until the head of operations says billing is fixed: land nothing, one check push per finished slice, no local full gates as a substitute (DECISIONS 45).
  - **Landing order once billing is fixed (three slices, all in the shared working tree, NOT committed except 5-H):**
    1. 5-H: `gh run rerun 41287879634` (713b008 on `check/platform/5-h-r5`, built on c2811ee), then `omnikom land check/platform/5-h-r5`. If master moved, rebuild with the script pattern: a temp worktree of master, the 17 wired files from 7e6ac78 (refuse if master changed one since 73803db), `tools/proc-guard/` and this charter from the shared tree. After landing: delete branches `check/platform/5-h`, `5-h-r2`, `5-h-r3`, `5-h-r4`, `5-h-r5`, `handover`, `handover-r2`, `handover-r3`.
    2. 5.2b (`supabase/tests/e2e-cleanup*.mjs`, `e2e-{screens,functions,export}.mjs`, `docs/blueprint/specs/{openapi.json,check-specs.mjs,check-specs.test.mjs,run-all-gates.mjs}`): its `run-all-gates.mjs` sits on top of 5-H's lines, so land it after 5-H. After landing, on staging: the three e2e scripts, then `apps/dashboard/tests/support/reset-staging-drafts.mjs` (dry run) must list 0 e2e rows.
    3. 5.4 (25 paths under `apps/dashboard/`, list in PROGRESS "5.4"): the head's independent re-run of `node apps/dashboard/scripts/ci.mjs` is still OWED (the first try never started: the heavy lock was held 30 min by the CLI's seed mutants); BLOCKED after two tries: the second (10:56) also gave up after 30 min, the lock held by "5b gates (prompt-plan, plan-gate, launch)" (exit 75, nothing run). Unblock: run `node ~/.claude/scripts/heavy.mjs -- node apps/dashboard/scripts/ci.mjs` when the lock is free, or let the GitHub dashboard job of the landing commit be the re-run. The builder's line was "OK"; the preview read back by the head's runner.
    PROGRESS.md (this department's three sections) and this charter go in with the first landing; other departments keep uncommitted lines in PROGRESS and POSITION, so rebuild those from master plus our own sections.
  - **Builders:** `BUILDER_platform_5-4` stands by (follow-ups on its GAP lines; discard after 5.4 lands). `BUILDER_platform_5-H-r3` stands by (discard after 5-H lands). `BUILDER_platform_5-2b` is done. Launchers: `E:\omk-launch\start-b-platform-*.cmd`.
  - **Next after the three land:** the 12 GAP lines of 5.4 into `16-DESIGN-PARTS.md` or to the owner (Ask-us address, end-toast words, per-check sentences); a migration adding `publish_job_events` to the Realtime publication; 5.5 instant preview, 5.6 Settings, 5.7 the four flows (step 5 done); 5.3b (Export CSV, unread bold). ENV-001 after SEO 4c is on master (`factory/runner/publish.mjs:143`, `factory/test/run.mjs` 231, 316, 318, 322).
  - **Findings sent up (CLI's):** the seed writes team row "Agent Two" without role and slug (now fixed on staging only, version 2); staging `sites.preview_host` is the seed placeholder. The real-kill flake is fixed (c2811ee).
  - **Laptop network:** github.com:443 drops on most first tries; `factory/briefs/push-and-land.sh <sha> <branch>` retries push and land three times on network errors only; `factory/briefs/5-H-rebuild-on-master.ps1` rebuilds 5-H on the current master (set the branch name inside it first).
- 2026-11-01 12:58, head `HEAD_Platform-build_2026-11-01b` (Opus 5.5): took over from `HEAD_Platform-build_2026-11-01`; read the 11:00 HANDOVER block. Holding: land nothing until the head of operations says the DECISIONS 46 public copy works. Routed to this head (head of operations, 12:56): (1) `supabase/tests/tenancy.test.sql:264` asserts `service.reap_stale_jobs() = 0` globally, so `omnikom test walls` on staging stops on 5 stale publish jobs from 2026-10-31 00:22; fix: assert only on the file's own fixture jobs, never hand-reap staging; (2) `openapi.json` drift (SaveRequest.base and 409 S-STALE, LeadUpdateRequest.read, no paths for drafts, settings-save, crm-test, lead-export, invite-member; config.toml names push-lead, metrics-pull, sitemap-submit with no folder; /unpublish with no function); (3) staging workspace A has a bare third listing with no slug; tenancy.test.sql:886/888 partial-id literals. 5.4 ci.mjs re-run still OWED. 12:59: reports now go to `HEAD-OF-OPERATIONS_Omnikom_2026-11-01b` (head of operations swapped).
- 2026-11-01 13:05, head `HEAD_Platform-build_2026-11-01b`: started `BUILDER_platform-build_5-W` (pid 28428, brief `factory/briefs/5-W-walls-reaper-scope.md`, finding 1, local proof only, no `run-local.mjs` edit). Finding 2: the uncommitted 5.2b `openapi.json` already adds SaveRequest.base, S-STALE and the five paths; the rest (LeadUpdateRequest.read; `/unpublish` and config.toml push-lead, metrics-pull, sitemap-submit with no folder, to be marked planned behind a check-specs gate) sent to `BUILDER_platform_5-2b` as a follow-on in its own files, so 5.2b lands with them. Both NOT DONE.
- 2026-11-01 13:15, head `HEAD_Platform-build_2026-11-01b`: 5.2b spec-drift follow-on PROVEN locally, head's re-run equal to the builder: `check-specs.mjs` "OK: 18 operations, 18 operationIds, 16 deployed functions covered, 5 planned marks; 47 FR/NFR rows, 40 work orders, 0 problem(s)", `check-specs.test.mjs` "PASS: check-specs drift rules, 33 checks, 0 problem(s)" (planted reds in the builder's report). Files added to 5.2b: `docs/blueprint/specs/{openapi.json,check-specs.mjs,check-specs.test.mjs}`, `supabase/config.toml` (3 `# planned:` lines). Findings, open: metrics-pull and sitemap-submit have no W work order (marked M6); nothing ties request fields to function source; a deployed function with no config.toml table is not checked.
