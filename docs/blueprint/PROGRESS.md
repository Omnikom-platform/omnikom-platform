# Blueprint progress (for the lead session)

Task: build-ready product engineering package (owner, 2026-10-28), raised to engineering practice, tied to published standards,
then corrected by an independent fact-check (72 claims) and an independent M1 dry run (31 issues), and by DECISIONS 15
(no Docker; one Supabase account, staging + production). **Status: complete for owner review. Nothing committed.**

## CLI: audit and gate commands (2026-10-30 22:11 to 2026-10-31 04:40, CLI department head `local_c8848ce4...`, Sonnet builder as in-session agent, Haiku runner for every mechanical run)
Brief `tools/omnikom-cli/briefs/audit-gate-commands.md` (from the SEO department's `tools/audit/briefs/slice-3-cli-command.md`). What was
built: `tools/omnikom-cli/commands/audit.mjs` (new), `omnikom.mjs` (registration, text path in `finish()`, `AuditCrash` exit 2), README
rows, 45 new checks, 27 new mutants. Decisions taken on review: `--expect` refused on both commands; `gate --json` carries `pages` and
`rules` counts; a malformed or self-contradicting library result is a crash (exit 2), never a pass; the library is injectable through
`deps.auditLib`. The engine grew from 14 to 17 rules while the builder worked (SEO session, uncommitted), so the tests now take the
page and rule counts from the engine. After the engine started refusing an empty rules list itself, the mutant "an empty --only is
accepted" survived (both guards gave exit 2); closed by asserting the CLI's own message `--only needs at least one rule id`.

**Head's own re-run (Haiku runner, verbatim last lines; engine at 17 rules, uncommitted SEO edits present):**
```
node tools/omnikom-cli/test/run.mjs 2>&1 | grep -E "^FAIL|^OK|^FAILED|^BASELINE"; echo "exit ${PIPESTATUS[0]}"
OK: 213 of 213 checks passed
exit 0
node tools/omnikom-cli/test/mutate.mjs 2>&1 | grep -v "^caught" | tail -12; echo "exit ${PIPESTATUS[0]}"
baseline: OK: 213 of 213 checks passed

110 mutants, 110 caught, 0 survived, 0 target text missing
exit 0
grep -rl $'\xe2\x80\x94' tools/omnikom-cli/ docs/blueprint/26-PLATFORM-CLI.md docs/departments/cli-and-testing.md; echo "em-dash grep exit $?"
em-dash grep exit 1
```
Commands (same runner, earlier the same night): `audit --dir tools/audit/fixtures/good` ends `audit: 4 pages, 17 rules, 0 FAIL, 0 WARN, 0 SKIP`
exit 0 (42 PASS lines); `audit --dir tools/audit/fixtures/bad-MET-003` prints `FAIL MET-003 /tasting-room/:48 value-mismatch: <h4> "Small
print" follows <h2> "Before you come" (line 46) and skips a level (source: checklist/web-delivery.md MET-003)` then `audit: 4 pages, 17 rules,
1 FAIL, 0 WARN, 0 SKIP` exit 1 (the FAIL line identical to `tools/audit/run.mjs`'s); `gate --dir ...bad-MET-003` prints `GATE FAIL 1
finding(s)` and that line, exit 1; `gate --dir ...good` prints `GATE PASS 4 pages, 17 rules` exit 0; `gate` alone `ERROR --dir is required`
exit 2; a missing folder `ERROR --dir is not a folder: tools/audit/fixtures/no-such-folder` exit 2; `gate --json` on good
`{"ok":true,"command":"gate","code":"ok","exit":0,"data":{"pass":true,"exit":0,"fails":[],"pages":4,"rules":17}}` exit 0.

**Red results seen, pasted, and where they belong:** one suite run under load (other sessions' mutant and gate runs active) ended
`FAIL test walls: passes again after the clean: {` / `FAILED: 212 of 213 checks passed, 1 FAILED`; that check runs
`supabase/tests/tenancy.test.sql` on the CLI's throwaway cluster, and the same suite passed 213 of 213 as the mutants' baseline minutes
later: the flaky privacy-requests wall the head of operations recorded at 01:40, not a CLI check. `run-all-gates.mjs` once ended
`FAIL database walls + mutants   caught   privacy requests read wall                   ERROR:  B's owner reads no request of A` / `1 gate(s)
failed` / `exit 1` (every other gate PASS; the builder's rerun passed): same wall. Findings for the SEO head: `audit(dir, { rules: [''] })`
ran zero rules and passed (already fixed in the SEO session's open edits); `gate` obeys an `audit.config.json` in the audited folder.
UNPROVEN: nothing in this slice touches staging; the CLI gates must be re-run when the SEO department commits `tools/audit/`.

## Step 4: sites build themselves (2026-10-31, the standing Platform build head, session `local_cade0add-3389-4314-b7b5-83333d26a97a`)
Five slices (charter `docs/departments/platform-build.md` Open items; briefs in `factory/briefs/`). Builders are in-session Sonnet agents; every
mechanical run is a Haiku agent whose verbatim output is what is pasted here.

**Step 3 leftover closed (head of operations' request 2026-10-31 00:18).** The owner banked a full-access `SUPABASE_ACCESS_TOKEN`; the stale
expectation `rate_limit_email_sent` 2 (the built-in mailer cap) was corrected to 30 (Supabase's value with custom SMTP, on since 2026-10-30 01:41)
in `supabase/auth-settings.md` and `check-auth-settings.mjs`. Haiku re-run of
`node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/check-auth-settings.mjs` (00:21 local), exit 0, last lines:
```
PASS     rate_limit_email_sent                    observed 30  expected 30  (emails per hour through Auth mail (custom SMTP through Resend since 2026-10-30 01:41); ...)
PASS     mailer_secure_email_change_enabled       observed true  expected true  (secure email change (both addresses confirm); Supabase default)
OK: 24 settings read, 0 differ from auth-settings.md (checked 2026-10-30)
```
(15 PASS, 9 RECORDED, 0 FAIL; the "checked" date is the script's UTC day.) The step 3 line in `25-BUILD-SEQUENCE.md` is ticked.

### 4.1 factory core: head's verification (2026-10-31 03:05 local)
Builder: in-session Sonnet agent, brief `factory/briefs/4-1-factory-core.md`, 155 tool uses, 2 h 52 min. Its paragraph is below. Every gate line
re-run by a Haiku agent on the same tree (02:55 to 03:05), verbatim:
```
node factory/test/run.mjs                                   OK: 88 of 88 checks passed                                          exit 0
node factory/test/mutate.mjs                                85 mutants, 85 caught, 0 survived, 0 target text missing            exit 0  (past 300 s, finished in the background)
node factory/build.mjs --export factory/test/fixtures/export-test-demo-a.json --out <scratch>/dist --design sites/test-demo-a/design --media sites/test-demo-a/media
                                                            BUILT 6 pages (4 contract pages + 2 item pages) -> <scratch>/dist
                                                            preview: true                                                       exit 0
node tools/audit/run.mjs <scratch>/dist                     OK: 7 page(s), 17 rule(s), 0 FAIL, 1 WARN, 0 SKIP                   exit 0
node factory/build.mjs ... --out <scratch>/dist-bad --force-fail heading
                                                            FORCED FAILURE: heading
                                                            BUILT 6 pages (4 contract pages + 2 item pages) -> <scratch>/dist-bad   exit 0
node tools/audit/run.mjs <scratch>/dist-bad                 FAIL MET-003 /contact/:70 value-mismatch: <h4> "Forced skipped heading level" follows <h2> "Send a message" (line 70) and skips a level (source: checklist/web-delivery.md MET-003)
                                                            FAILED: 7 page(s), 17 rule(s), 1 FAIL, 1 WARN, 0 SKIP               exit 1
```
`ls <scratch>/dist`: `404.html _headers assets contact homes-in-alpha homes-in-beta index.html listings llms.txt media robots.txt sitemap.xml`.
`robots.txt`: `User-agent: *` / `Allow: /` / `Sitemap: https://preview.test-site-demo-a.pages.dev/sitemap.xml`. `_headers` carries the ELEV8 security
block plus `X-Robots-Tag: noindex, nofollow` (preview) and the immutable cache line for `/assets/*`. The head's design decision (preview stays out of the
index by header only, robots.txt always Allow + Sitemap so IDX-004 judges the files that deploy) is written in `factory/lib/launch.mjs` and the README.

**Verdict: slice 4.1 PROVEN locally** (the two done-when halves of the factory: a clean build the audit engine passes, a forced heading violation it
catches). UNPROVEN, carried to later slices: a staging export (4.3), a browser render of the built site (render gate, step 5 dashboard work), the
launch layer's image work (WebP, phone sizes, woff2, `_redirects`), richtext sanitising. The builder's `run-all-gates.mjs` red on "database walls"
is the flaky-wall finding already in the charter's Open items (it passed alone, 213 mutants); the cause is NOT determined.

**Findings from the builder, decided by the head.** (1) every build gets IDX-003 WARN (sitemap lastmod = build clock): accepted for now, open item
"honest lastmod from the newest row `at` behind each page" for a later factory slice. (2) `service.export_bundle` lacks the top-level `schema`
key: sent to builder 4.2 (migration 9 is still unapplied and its file). (3) the seeded team row `{"name":"Agent One"}` has no `slug` or `role`
and fails publish validation under this contract: finding to the CLI head for the queued `seed test` slice (write both). (4) `ctx.media()`,
`ctx.nav`, `ctx.notices`, `ctx.assets`, feed `_id`/`_path`: approved, they are in the README. (5) no richtext sanitiser: designs print richtext
escaped until the dashboard editor defines its tags (open item). (6) a page row whose `type` differs from its contract page is not checked, and
(7) a bound page whose place row is unpublished builds with `bound = null`: both become one small factory check in a later slice (6: refuse;
7: SKIP like a missing page row). Nothing of (1), (5), (6), (7) blocks step 4's done-when.

### 4.1 factory core (builder)  (2026-10-31, builder session `BUILDER (platform build): slice 4.1`, brief `factory/briefs/4-1-factory-core.md`; gates run 01:25 to 02:10 local)
Files: `factory/README.md` (the export shape and the look-folder convention, written for slice 4.3 and the designs), `factory/build.mjs`,
`factory/lib/{html,template,export,plan,design,launch,gates,site}.mjs`, `factory/test/{run,mutate,make-export}.mjs` +
`fixtures/export-test-demo-a.json`, `sites/test-demo-a/` (plan, make-contract, contract, rows, media/logo.png, design). No dependency.
Local only: nothing deployed, no network, `E:\Alex Sevilla` read only.

**Watched red before any code existed (run.mjs written first; the one line seen).**
```
node factory/test/run.mjs      FAIL import: Cannot find module 'E:\Omnikom Platform\factory\lib\html.mjs' imported from E:\Omnikom Platform\factory\test\run.mjs   (exit 1)
node factory/build.mjs ...     Error: Cannot find module 'E:\Omnikom Platform\factory\build.mjs'   (exit 1)
node tools/audit/run.mjs <dist> site folder not found: /nonexistent/dist   (exit 2: no build, no audit)
```
Then the code, the test site and `mutate.mjs` (written after the code; its own red is the 85 mutants below: the first full run said `84 mutants, 83 caught,
0 survived, 1 target text missing`, the missing one was a wrong target text in the mutant table, fixed, run again).

**Gates (run by the builder; the mutant run took about 20 minutes with 4 in parallel).**
```
node factory/test/run.mjs                                    OK: 88 of 88 checks passed                                  exit 0
node factory/test/mutate.mjs                                 85 mutants, 85 caught, 0 survived, 0 target text missing    exit 0
node factory/build.mjs --export factory/test/fixtures/export-test-demo-a.json --out <scratch>/dist --media sites/test-demo-a/media
                                                             BUILT 6 pages (4 contract pages + 2 item pages) -> <scratch>/dist / preview: true   exit 0
node tools/audit/run.mjs <scratch>/dist                      OK: 7 page(s), 17 rule(s), 0 FAIL, 1 WARN, 0 SKIP           exit 0
   the one WARN: WARN IDX-003 sitemap.xml:4 all 6 URLs share one lastmod (...) within 10 minutes of the time this file was written: the build clock, not content dates
node factory/build.mjs ... --out <scratch>/dist-bad --force-fail heading
                                                             FORCED FAILURE: heading / BUILT 6 pages (4 contract pages + 2 item pages) -> <scratch>/dist-bad   exit 0
node tools/audit/run.mjs <scratch>/dist-bad                  FAILED: 7 page(s), 17 rule(s), 1 FAIL, 1 WARN, 0 SKIP       exit 1
   FAIL MET-003 /contact/:70 value-mismatch: <h4> "Forced skipped heading level" follows <h2> "Send a message" (line 70) and skips a level (source: checklist/web-delivery.md MET-003)
node docs/blueprint/specs/run-all-gates.mjs                  1 gate(s) failed   exit 1   (not mine: see below)
   PASS contract tests 147 passed, 0 failed / PASS contract mutants 88 mutants, 88 caught, 0 survived; 0 codes untested / PASS industry run 15/15 PASS
   FAIL database walls + mutants   caught   privacy request: the 45-day clock            ERROR:  the 45-day clock is set
   PASS specs + traceability OK: 12 operations, 12 operationIds; 47 FR/NFR rows, 40 work orders, 0 problem(s) / PASS machine-call signature OK: 0 failed / PASS deno check
```
The red database-walls line is in files this builder did not touch (`supabase/tests/run-local.mjs`, `tenancy.test.sql`, the new migration
`20261031000009_media_and_export.sql` are another session's uncommitted work in the same checkout); the runner prints only the last stdout line, so the
cause of that red is NOT determined. Re-run alone afterwards (`node supabase/tests/run-local.mjs`, full output kept): `PASS real migration: ALL TENANCY
TESTS PASSED` ... `OK: real migration passes; 213 mutants`, exit 0, no SURVIVED, FAIL, MISSING or SETUP line. So the first red was transient (a concurrent run
on the shared local database or the other session's files changing mid-run; UNPROVEN which). Sent up as a finding.

**What the 88 checks cover.** Template tags (value, raw, `.`, `#`, `^`, `?`, `>`) and the throw on a missing value or partial; `html` escaping, `raw()`,
arrays, nesting; the export loads, wrong schema refused, publish-mode validation (required, media unknown, unprocessed, width from the media list,
reference, bad contract); the feed carries public data only; the build writes exactly the four pages, two item pages, 404, sitemap, robots, `_headers`,
llms.txt, the logo and two hashed stylesheets (an unreferenced media row and file stay out); sitemap = built pages, lastmod = build clock; preview vs live
(header, origin, robots, `preview:` line); an unpublished page row = SKIP, not in the sitemap, not linked, audit 0 FAIL; `seo.noindex`; stop on invalid rows
with an empty out dir; media path traversal (slash and backslash), missing media file, no media folder, no settings row, missing design, usage errors, a
non-empty out dir never emptied; byte-identical rebuilds; markup escaped in a page; each factory gate red on a mutated page (h1 x2, main x2, title x3,
description x2, canonical x2, `{{`, `[client to`, form method, form action, img alt, skipped heading); the audit engine 0 FAIL on the good dist and the live
dist; `--force-fail heading` gives a MET-003 FAIL on `/contact/` and changes only that page; the four seeded collections keep the keys of `TEST_CONTRACT`;
both generator-equals-file tests.

**UNPROVEN / NOT DONE (this slice).** Nothing was opened in a browser (no render gate, no axe, no screenshots, A5 lines 2 and 3 of the gate table); the launch
layer's image work (WebP, phone sizes, woff2, `_redirects`) is not built (the test site has one PNG and no redirects row); `export-published` is slice 4.3 and
the real `site_contracts.resolved` shape was read from the migration text only; richtext is not sanitised (designs print it escaped); the form posts with
`method="post"` but no script handles the answer, so "a preview never fakes success" is not exercised; `motion.js` is supported and tested with a stub, the
test design has none.

### 4.2 dashboard functions: head's verification (2026-10-31 05:55 local)
Builder: in-session Sonnet agent, brief `factory/briefs/4-2-dashboard-functions.md`, 205 tool uses, 4 h 44 min. Its paragraph is below. Every gate
re-run by a Haiku agent on the same tree, one command at a time (04:55 to 05:52), verbatim last lines:
```
deno task check                                              (15 files listed, no error)                                   exit 0
node docs/blueprint/specs/check-specs.mjs                    OK: 12 operations, 12 operationIds; 47 FR/NFR rows, 40 work orders, 0 problem(s)   exit 0
node supabase/functions/test/run.mjs                         OK: 58 of 58 checks passed (the Deno tests), exit 0            exit 0
node supabase/functions/test/mutate.mjs                      31 mutants, 31 caught, 0 survived, 0 target text missing       exit 0
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs status --target staging
                                                             applied 10 (…000009_media_and_export, …000010_export_schema_key), pending [], mismatched []
                                                             functions: add-lead, capture-lead, lead-update, publish, save, upload-finish, upload-start "deployed"; test "not deployed"   exit 0
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/tests/e2e-functions.mjs
                                                             PASS save by owner-a is 200 with a version: 200 version 1
                                                             PASS save by nobody is 404 and names no field: 404 S-NOT-FOUND
                                                             PASS publish by owner-a is 202 and the job is queued: 202 job ce15cf70-328a-4600-bd43-b9d3fa685129
                                                             INFO publish dispatched: true   [no workflow listens yet, so it stays queued]
                                                             PASS add-lead by owner-a is 201: 201
                                                             PASS lead-update by member-a1 on a lead that is not theirs is 404: 404 S-NOT-FOUND
                                                             PASS the e2e lead was deleted through the CLI (lead delete): exit 0
                                                             PASS 0 leads remain on staging (lead list as owner-a): count 0
                                                             PASS upload-start by owner-a is 200 with a path under workspace A and a signed upload URL: 200
                                                             PASS upload-finish by owner-a is 200 and processed stays false: 200
                                                             INFO upload-finish dispatched: true
                                                             PASS a call with no token is 401: 401 UNAUTHORIZED_NO_AUTH_HEADER
                                                             PASS: staging end to end for the dashboard functions, 0 problem(s)   exit 0
node supabase/tests/run-local.mjs                            OK: real migration passes; 214 mutants   (214 "caught" lines, 0 SURVIVED, 0 FAIL, 0 MISSING; 17 min 0 s alone)   exit 0
```
**Verdict: slice 4.2 PROVEN** (six dashboard functions deployed on staging and exercised end to end by the head's own run; migrations 9 and 10
applied; T18 and 53 new database mutants; 58 Deno checks, 31 Deno mutants). Left on staging by the two e2e runs (builder's and head's), on purpose:
two queued publish jobs for site A (one is `ce15cf70-...`), two saved listing versions, two unprocessed media rows with rights ticked, 0 leads;
two `repository_dispatch` events reached the real repo (204) with no workflow to receive them. UNPROVEN: the in-code 401 `S-AUTH` on staging
(the gateway refuses a missing token first, `UNAUTHORIZED_NO_AUTH_HEADER`; proven locally); the 404 on a wrong token is local only.

**The "flaky wall" the builder's `run-all-gates` hit twice (04:04, 04:46) is DIAGNOSED by the head: not a test.** The runner killed the walls
gate at 30 minutes (214 mutants under four sessions) and printed the gate's last stdout line, a "caught" mutant line, as the failure. Fixed in
`docs/blueprint/specs/run-all-gates.mjs` (the head's file): a killed gate prints `TIMEOUT after N s (limit, not a test failure, last line)`,
limit 60 minutes, `GATE_TIMEOUT_MS` overrides, `GATE_ONLY=<name>` runs one gate, the Deno function tests are a gate. Watched red:
`GATE_ONLY="contract mutants" GATE_TIMEOUT_MS=1500` printed `FAIL contract mutants  TIMEOUT after 2 s (limit 2 s; not a test failure, the gate
was killed; last line: caught   rule C-CORE off ...)`, exit 1; with the limit restored `PASS contract tests  147 passed, 0 failed`, exit 0.

**Findings from the builder, decided by the head.** (1) `capture-lead` passes `JSON.stringify(...)::jsonb` for answers, marketing and event
detail (lines 135 and 156); postgres.js double-encodes a string given to a jsonb parameter (measured by the builder: `jsonb_typeof = 'string'`),
so a captured lead's answers are very likely stored as a JSON string: a real bug in a deployed function, fixed in slice 4.3 with a test
(`jsonb_typeof(answers) = 'object'` after a capture) and a mutant. (2) `supabase/functions/test/` shows as a function (`test: not deployed`)
and a bare `supabase functions deploy` would try it: slice 4.3 adds `[functions.test] enabled = false` to `config.toml`; the status line is
the CLI head's. (3) walls-gate timeout: done above. (4) Deno tests in the gates: done above. (5) publish checks that a referenced row exists,
not that it is live or in the same job (02-BACKEND 4), and `I-SAMPLE-LIVE` cannot fire: the factory's publish-mode re-validation catches a
reference to a row outside the export at build time (defence in depth), so step 4's done-when holds; open item for a later migration
(`row_exists` with the job, or a `row_live_or_in_job`). (6) `S-AUTH` on staging: noted as UNPROVEN above; the `SUPABASE_JWKS` secret as a
JWKS-fetch replacement is an option for later. (7) one shared `refusal` for `capture-lead`: follow-up with (1) in 4.3. (8) the CLI's slice 2
save path sends the claims as an object and the `{ workspace, collection, row, data, signOff }` bodies match the openapi schemas: finding to the
CLI head. Deviations accepted: `service.site_for` and `service.row_version`; `auth-refused` as the event kind (detail `bad-jwt`); T18 before T17;
migration 10 instead of an edit of the applied migration 9.

### 4.2 dashboard functions (builder)  (2026-10-31, builder session `BUILDER (platform build): slice 4.2`, brief `factory/briefs/4-2-dashboard-functions.md`)
Six Edge Functions the dashboard calls (`save`, `publish`, `lead-update`, `add-lead`, `upload-start`, `upload-finish`), the shared pieces
(`_shared/db.ts` step-down and refusals, `_shared/auth.ts` second JWT wall, `_shared/dashboard.ts` frame, `_shared/validate.ts`
validateItem with database lookups, `_shared/dispatch.ts` GitHub dispatch, `_shared/http.ts`), migration 9 (ten service functions) and migration 10
(one `create or replace`, see below), tests T18, 31 Deno-test mutants, `tools/deploy-functions.mjs`, `supabase/tests/e2e-functions.mjs`, two
operations in `openapi.json`. Deviations from the brief, each also in the report: (1) `service.site_for` and `service.row_version` are new
(publish gets a site, not a workspace, and the function role cannot read a table, so it needs both to validate the pinned versions); T14's list of
claims-taking functions got six names (`record_media finish_media row_exists media_facts site_for row_version`), the one edit outside the T18
block; (2) a bad token is the security-event kind `auth-refused` (code `S-AUTH`, detail reason `bad-jwt`), because `security_events.kind` has a
check constraint (migration 7) that does not list `bad-jwt` and a widening would have been an extra migration; (3) the coordinator's `schema`
key for `export_bundle` arrived after migration 9 was applied to staging, so it is migration 10 (`20261031000010_export_schema_key.sql`,
`create or replace` of the one function), not an edit of 9; (4) T18 sits before T17 on purpose, so a grant mutant is seen on its own function.

Watched-fail evidence (one line per new wall; the walls are the 53 database mutants below, the Deno checks are the 31 mutants):
- T18 written first, run with no migration 9: `ERROR:  function service.record_media(jsonb, unknown, unknown, integer, unknown) does not exist` (psql, tests.sql line 785), `FAILED: real migration fails; 0 mutants`; then green: `PASS real migration: ALL TENANCY TESTS PASSED`.
- 53 new database mutants (migration 9 and 10): one per raise exception line and boundary of record_media, finish_media, media_processed, media_for_runner, media_facts, row_exists, site_for, row_version, export_bundle (also the `schema` key), job_site, and 20 grant mutants (each function closed and open, both layers: the default privilege of migration 8 and the explicit statement). Every one `caught`, for example `caught   record_media: the 25 MB cap   ERROR:  EXPECTED I-MEDIA-SIZE BUT IT SUCCEEDED`, `caught   migration 9 opens service.job_site to the function role (both layers)   ERROR:  permission denied for function job_site`, `caught   export_bundle: the schema key the factory checks first (migration 10)   ERROR:  the bundle carries the export schema key the factory checks first (migration 10)`.
- First Deno run, red for the right reasons and each fixed: every handler test 401 (claims went to SQL as a JSON string: postgres.js double-encodes a string given to `::jsonb`; measured `jsonb_typeof = string`; objects are passed now); `security_events_kind_check` violation (see deviation 2); a synchronous spawn froze the fake JWKS server (the harness spawns asynchronously now); `SUPABASE_SERVICE_ROLE_KEY` set in the shell won over the test key (the harness sets it).

Gates, last lines as run:
```
node supabase/tests/run-local.mjs                   (after migration 10)   OK: real migration passes; 214 mutants   (214 caught, 0 SURVIVED, 0 MISSING)
node supabase/functions/test/run.mjs                 ok | 58 passed | 0 failed (1m43s)
                                                    OK: 58 of 58 checks passed (the Deno tests), exit 0
node supabase/functions/test/mutate.mjs              31 mutants, 31 caught, 0 survived, 0 target text missing
deno task check                                      exit 0 (15 files, no error)
node docs/blueprint/specs/check-specs.mjs            OK: 12 operations, 12 operationIds; 47 FR/NFR rows, 40 work orders, 0 problem(s)
node docs/blueprint/specs/run-all-gates.mjs          NOT PASSED (twice, 04:04 and 04:46 local): 6 of 7 gates PASS (contract tests 147, contract mutants 88/88, industry run 15/15, specs 0 problems, signature, deno check);
                                                    FAIL database walls + mutants   caught   audit trail append-only for every role (trigger)  ERROR:  EXPECTED A-APPEND-ONLY BUT IT SUCCEEDED ...
                                                    The last line printed is a "caught" mutant line, not the summary: the runner killed the walls gate at its 30 minute spawn timeout (docs/blueprint/specs/run-all-gates.mjs line 18)
                                                    with the machine loaded by other sessions (38 postgres.exe, 35 node/deno processes at 04:10). 214 mutants did not fit in 30 minutes either time. UNPROVEN as one run;
                                                    the same gate run directly, alone, finished: OK: real migration passes; 214 mutants (above). Unblock: raise that timeout to 60 min or run mutants in parallel (not my file).
```
Staging (project ref and tokens never printed):
```
apply --dry-run   "summary": "DRY RUN: 1 pending of 9"  wouldApply: 20261031000009_media_and_export.sql
apply             "summary": "OK: applied 1 of 9 (8 were already applied)"
deploy-functions  OK: save|publish|lead-update|add-lead|upload-start|upload-finish deployed; OK: secrets set by name: GITHUB_DISPATCH_TOKEN, GITHUB_REPO (GITHUB_REPO=Omnikom-platform/omnikom-platform via --set)
status            applied 9, pending [], mismatched []; functions: add-lead deployed, capture-lead deployed, lead-update deployed, publish deployed, save deployed, upload-finish deployed, upload-start deployed   ("test": "not deployed" is the folder supabase/functions/test, see findings)
e2e-functions.mjs PASS save by owner-a is 200 with a version: 200 version 1
                  PASS save by nobody is 404 and names no field: 404 S-NOT-FOUND
                  PASS publish by owner-a is 202 and the job is queued: 202 job 9ced0936-22dc-4b2f-ad54-78e867bdddb4
                  INFO publish dispatched: true   [the job is left dispatched to GitHub; no workflow listens yet, so it stays queued]
                  PASS add-lead by owner-a is 201: 201
                  PASS lead-update by member-a1 on a lead that is not theirs is 404: 404 S-NOT-FOUND
                  PASS the e2e lead was deleted through the CLI (lead delete): exit 0
                  PASS 0 leads remain on staging (lead list as owner-a): count 0
                  PASS upload-start by owner-a is 200 with a path under workspace A and a signed upload URL: 200
                  PASS upload-finish by owner-a is 200 and processed stays false: 200
                  INFO upload-finish dispatched: true
                  PASS a call with no token is 401: 401 UNAUTHORIZED_NO_AUTH_HEADER
                  PASS: staging end to end for the dashboard functions, 0 problem(s)
apply (migration 10)  "summary": "DRY RUN: 1 pending of 10" then "OK: applied 1 of 10 (9 were already applied)"; status afterwards: pending [], mismatched []
```
Left on staging on purpose: one saved listing version in workspace A, one publish job (queued; dispatched to GitHub, where no workflow listens
yet), one media row (unprocessed, rights ticked), two repository_dispatch events (`publish`, `media`) sent to the real repository. The staging
call with no token was refused by the gateway (`UNAUTHORIZED_NO_AUTH_HEADER`), so the in-code wall's 401 `S-AUTH` is proven locally (auth.test.ts,
save.test.ts) and not separately on staging; a 200 on staging proves that Supabase's real ES256 session tokens pass `verifyUserJwt`.

### 4.4 runner and workflows (builder)  (2026-10-31, builder session `BUILDER (platform build): slice 4.4`, brief `factory/briefs/4-4-runner-and-workflows.md`; gates run 03:15 to 06:00 local)
Made: `factory/runner/` (`publish.mjs`, `media.mjs`, `lib/sign.mjs`, `lib/common.mjs`, `package.json` + `package-lock.json` with sharp 0.35.5, `test/`),
`.github/workflows/` (`publish`, `media`, `ci`, `keepalive`, `backup`), `.github/actionlint.yaml`, `tools/github-secrets.mjs`, a "Runner" section in
`factory/README.md`. Proven against a FAKE platform, a FAKE wrangler and a FAKE gh on this machine; the platform's own `verify`
(`supabase/functions/_shared/signature.ts`, Node type stripping) judges every signature. NOT proven against the real functions, Cloudflare or GitHub (slice 4.5).
```
node factory/runner/test/run.mjs                 OK: 87 of 87 checks passed                                           exit 0   (sharp installed: media checks ran)
node factory/runner/test/mutate.mjs              67 mutants, 67 caught, 0 survived, 0 target text missing             exit 0
node --check factory/runner/publish.mjs factory/runner/media.mjs factory/runner/lib/*.mjs tools/github-secrets.mjs      ok
actionlint 1.7.12 .github/workflows/*.yml        (no output)                                                          exit 0   (binary in the scratchpad, sha256 6e7241b5... checked against the release's checksums file)
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/github-secrets.mjs --repo Omnikom-platform/omnikom-platform --names CLOUDFLARE_PAGES_TOKEN,CLOUDFLARE_ACCOUNT_ID,RUNNER_KEY,PLATFORM_FUNCTIONS_BASE,STAGING_DB_URL,STAGING_SUPABASE_REF,STAGING_SUPABASE_SECRET_KEY,STAGING_SUPABASE_PUBLISHABLE_KEY --dry-run
                                                 DERIVED: PLATFORM_FUNCTIONS_BASE from STAGING_SUPABASE_REF
                                                 WOULD SET: CLOUDFLARE_PAGES_TOKEN / CLOUDFLARE_ACCOUNT_ID / PLATFORM_FUNCTIONS_BASE / STAGING_DB_URL / STAGING_SUPABASE_REF / STAGING_SUPABASE_SECRET_KEY / STAGING_SUPABASE_PUBLISHABLE_KEY
                                                 NOT SET (missing in the env): RUNNER_KEY      <- slice 4.3 mints it (tools/mint-site-key.mjs --runner); not minted yet
                                                 secrets on Omnikom-platform/omnikom-platform (names only): none                                             exit 0
node docs/blueprint/specs/run-all-gates.mjs      all gates passed   (contract 147, contract mutants 88, industry 15/15, walls 214 mutants, Deno 58 of 58, specs 0 problems, signature, deno check)
```
Watched-fail evidence: the first mutant run of the runner left 4 survivors (`no gating callback`, `no deploying callback`, `metadata kept`, `upload url on another
host`). Cause: my `same()` helper returned a message STRING on mismatch, truthy inside `&&` chains and inside `.every()`. Fixed (boolean), a message check added for the
upload host, re-run: 59 of 59, then 67 of 67 after the workflow-file rules got their own checks and mutants. Workflow files: a copy of publish.yml with an undefined
`secret.` context and an undefined `inputs.nope` made actionlint print three errors (exit 1); without `.github/actionlint.yaml` the real files print
`unexpected key "queue" for "concurrency" section` (actionlint 1.7.12 does not know the key GitHub documents).
Decisions made in this slice (flagged to the head in the report): wrangler pinned 4.152.0 (the brief's 4.156.0 was 2 days old; supply-chain rule 1), Node 24.22.1 in every
workflow (the brief said Node 20; supply-chain rule 4 minimum is 24.22.1 / 22.23.4), the site's `/api/lead` Pages Function is staged next to the deploy, the smoke compares
the built `index.html` `<title>`, a live site must NOT answer noindex.
UNPROVEN: the runner against the real `export-published` / `job-callback` / `media-export` / `media-process-callback` (slices 4.2 and 4.3 not deployed when this ran);
`npx wrangler pages deploy` for real (no Pages project exists; fake wrangler only); `concurrency: queue: max` on GitHub (actionlint rejects the key, GitHub's docs name it);
GitHub Actions itself (no workflow has run); the `ci.yml` jobs on a Linux runner; Supabase signed-upload PUT semantics (`x-upsert`) for media.

## SEO and audits, slice 2: live snapshot input and speed budgets (2026-10-31 05:40, builder)
`tools/audit` now judges a live-site snapshot (made by the skill's `snapshot-site.mjs`) with the same rules as a built folder. Rule set 14 to 17:
SE-001 (robots.txt health), PRF-001 (LCP/CLS/TBT budgets, speed trust, PSI preference) and PRF-016 (TTFB, a WARN) are new; IDX-004 gained its
HTTP part, LNK-002 its status part. New: `tools/audit/live.mjs` (driver over the skill's `live-target.mjs`), `--psi FILE`, snapshot fixtures
(`snapshot-good`, 27 `snapshot-bad-*`), `fixtures/live-target-standin.mjs`. No network anywhere; the driver was only run through the stand-in.
Also done (head's addition 2026-10-31 01:37): `audit(dir, { rules })` with `[]`, `''` or an unknown id throws `AuditError` exit 2 (`no such rule: ""`).
Real outputs (Haiku agents ran the commands; the mutant run was started from this session because a background process started by an agent died with it):
```
node tools/audit/test/run.mjs                 ... ok   audit() returns the documented shape
                                              OK: 332 of 332 checks passed            (exit 0)
node tools/audit/test/mutate.mjs              (full run, 4 at a time, 2026-10-31)
                                              185 mutants, 185 caught, 0 survived, 0 target text missing   (EXIT=0)
node tools/audit/run.mjs tools/audit/fixtures/snapshot-good
                                              ... PASS URL-009 /tasting-room/ ; OK: 4 page(s), 17 rule(s), 0 FAIL, 0 WARN, 0 SKIP   (exit 0; grep -vc "^PASS" = 0)
node tools/audit/run.mjs tools/audit/fixtures/snapshot-bad-PRF-001
                                              FAIL PRF-001 /:1 budget-exceeded: LCP 3100 ms > 2500 ms (source: checklist/performance.md PRF-001)   (exit 1)
OMNIKOM_AUDIT_LIVE_TARGET=<stand-in> node tools/audit/live.mjs https://example-tea.invalid/
                                              ... PASS URL-009 /tasting-room/ ; OK: 4 page(s), 17 rule(s), 0 FAIL, 0 WARN, 0 SKIP   (exit 0)
node tools/audit/fixtures/build-fixtures.mjs --check
                                              OK: 92 fixture(s) equal the generator output   (exit 0)
```
Runner class added at the coordinator's request: a mutant whose process is killed (exit null) is `NOT RUN`, the summary reads
`N mutants, N caught, N survived, N not run, N target text missing`, exit 1 when any is not run. Watched fail, same mutant twice:
```
MUTATE_TIMEOUT_S=1 : NOT RUN  PRF-016: a slow response passes   (killed, exit null)
                     1 mutants, 0 caught, 0 survived, 1 not run, 0 target text missing        EXIT=1
MUTATE_TIMEOUT_S=600: caught   PRF-016: a slow response passes   (3 red: snapshot-bad-PRF-016: WARN PRF-016 naming "TTFB 1900 ms > 600 ms ...)
                     1 mutants, 1 caught, 0 survived, 0 not run, 0 target text missing        EXIT=0
```
**Honest limits.** The 185-mutant run above ran with the harness before the NOT RUN class was added (only the close handler differs; no mutant was killed
in it). A first full run on a machine loaded by other sessions had 34 `exit null` lines (killed by the timeout or by sleep); they were re-run and
caught, one real survivor ("child progress lines go to stdout") was fixed by making the stand-in log on stdout like `snapshot-site.mjs` does. UNPROVEN:
the real `live-target.mjs` and a real snapshot were never run (the head does that on a platform-owned site); the real PSI file shape is the one `psi.mjs`
documents, tested here only with a hand-made file. Interpretations the head should confirm: (1) IDX-001 on a sample crawl makes BOTH "extra" and
"missing" a SKIP `incomplete-crawl` (the brief names "missing"; "extra" cannot be judged on a sample either); (2) only pages the crawl saw answer 200 are
judged by the page rules; (3) links to files/assets are not judged in a snapshot (the crawl fetches pages only); (4) `_site.json` `complete: true`
is the only way a snapshot counts as a complete crawl (the skill never writes it).
Findings for the skill (not fixed here): `browser-mobile.json` keeps the numbers under `vitals` (the brief said flat; both are read);
`snapshot-site.mjs` writes robots.txt with `toString("utf8")`, so a bad byte becomes U+FFFD (SE-001 treats U+FFFD as invalid UTF-8 for that reason);
`psi.mjs` writes under `site-checks/<host>/.pewp/psi/`, not inside the snapshot folder (pass it with `--psi`); `sitemaps.json` fetched[].status is not
judged (a declared sitemap that 404s is only visible as "no sitemap file"); `_site.json.url` is written without a trailing slash in the fixture but
`start.href` has one in the real script (both work).

## Step 3: the database is finished, the hardening leftovers (2026-10-30 20:22-22:20, step 3 session, platform build; commits 0e60178 and the one after it)
Every command through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs <command> --target staging`
(the CLI redacts secrets; the lines below are its real output, trimmed to the lines that matter). Local gates ran on this machine.

**What landed.** Two migrations (never an edit to an applied one): `20261030000007_hardening_leftovers.sql` (security events, consent
ledger, suppressions, privacy requests, workspace lifecycle, per-workspace quotas, append-only audit for every role) and
`20261030000008_search_path_and_roles.sql` (every SECURITY DEFINER function pinned to `search_path = ''` with schema-qualified names,
written by `supabase/tests/qualify.mjs` from the bodies of migrations 1 to 7; global default privileges so a new function is closed to
PUBLIC; the Edge Functions' role `omnikom_fn`; `service.site_signing_secrets`, `alert_recipients`, `lead_alerted`). Plain words:
`13-DATA-MODEL.md` 8c; the gates: `23-GROUND-RULES.md` 3 (five new rows). `capture-lead` redeployed: it steps down to `omnikom_fn`
after connecting, answers a paused site or suspended workspace with 409 and a quota with 429 (named codes instead of 500), and records
every refusal in `security_events`. The consent wording lint `I-CONSENT-CHANNEL / -TCPA / -STOP / -RATES` on `notices` rows at publish
(`contracts/validate.mjs`). The doc drift of `24-GAP-HUNT.md` F (16 items ticked, where each was fixed). `supabase/auth-settings.md`
written. The site endpoint maps 409 to the call-us message.

**Watched red, then green (local, `node supabase/tests/run-local.mjs`).**
- Without migration 7 (file moved aside): `FAIL real migration: psql ... tests.sql:47: ERROR:  type workspace_state does not exist`.
- Without migration 8: `FAIL real migration: psql ... tests.sql:50: ERROR:  role "omnikom_fn" does not exist`.
- With both: `PASS real migration: ALL TENANCY TESTS PASSED` and `OK: real migration passes; 161 mutants` (129 before; 30 for migration 7,
  3 for migration 8; one re-pointed). Every mutant line reads `caught`; 0 SURVIVED, 0 SETUP-FAIL, 0 MUTANT TARGET MISSING. Two findings
  on the way: a per-schema `alter default privileges ... revoke` cannot remove the global PUBLIC EXECUTE default (T17's probe function stayed
  executable by anon; the global form is used); Supabase gives `service_role` ALL on a new table by default, so the append-only tables revoke
  update, delete and truncate from it explicitly.
- Contracts: `node contracts/test/run.mjs` = `147 passed, 0 failed`; `node contracts/test/mutate.mjs` = `88 mutants, 88 caught, 0 survived;
  0 codes untested` (the four `I-CONSENT-*` rules plus two behaviour mutants, each `caught`).
- Site endpoint: `node factory/worker/test/run.mjs` = `18 passed, 0 failed`; `node factory/worker/test/mutate.mjs` = `16 mutants, 16 caught`.
- `deno task check`: `Check supabase/functions/capture-lead/index.ts` (no error). `node docs/blueprint/specs/check-specs.mjs` =
  `OK: 10 operations, 10 operationIds; 47 FR/NFR rows, 40 work orders, 0 problem(s)`.
- CLI department's own units, read-only cross-check after my test-file edits: `node tools/omnikom-cli/test/run.mjs --unit` = `OK: 69 of 69 checks passed`.
- `node docs/blueprint/specs/run-all-gates.mjs`: `all gates passed` (contract tests 147, contract mutants 88 of 88, industry run 15/15, database walls + mutants `OK: real migration passes; 161 mutants`, specs OK, signature OK, deno check OK), 2026-10-30 22:50; the first run was killed by the runner`s 15-minute per-gate limit while the machine was busy, so the limit is now 30 minutes.

**On staging, in order.**
```
### apply --dry-run        "summary": "DRY RUN: 2 pending of 8"   wouldApply: 20261030000007_hardening_leftovers.sql, 20261030000008_search_path_and_roles.sql
### apply                  "summary": "OK: applied 2 of 8 (6 were already applied)"
### status                 applied: 8 (…0001 to …0008), pending: [], mismatched: [], "capture-lead": "deployed", 4 key names present, exit 0
### seed test --clean      removed: workspaces test-demo-a, test-demo-b; their sites, contracts, members, content; Vault secrets site-test-demo-*; the test logins; keptLogins: []
### test walls             "PASS tenancy tests on staging"  "OK: no fixtures left on staging (rolled back)"   exit 0
### deploy capture-lead    node tools/deploy-capture-lead.mjs --deploy-only: "Deployed Functions on project <project ref>: capture-lead" ... "OK: capture-lead deployed" (the ref is scrubbed now)
### seed test --alert-to amer@omnikom.io    workspaces a/b, logins owner-a owner-b member-a1 member-a2 staff nobody, "changed": true
### key mint --site test-demo-a             vaultSecret site-test-demo-a-key-1, envVariable SITE_SIGNING_KEY_TEST_DEMO_A, hashPrefix 98c55c9adff5
### key mint --site test-demo-b             vaultSecret site-test-demo-b-key-1, envVariable SITE_SIGNING_KEY_TEST_DEMO_B, hashPrefix f9926b9a24b2
### verify --only people (before)           exit 3, "error": "the staff test login has no verified TOTP factor", "unblock": "run: omnikom mfa enroll-staff --target staging"
### mfa enroll-staff                        "changed": true, exit 0
### verify --only lead                      "passed": 12, "failed": 0, exit 0; every line PASS, among them
   PASS a signed lead is accepted (expected 202, got 202)
   PASS a retry sends no second alert (expected at most 1 alert row, got 202, alerts=1)
   PASS a lead to a paused site is not stored (expected not 202, 0 rows, got 409)      <- was 500 before this step
### verify --only walls                     "passed": 5, "failed": 0, exit 0 (anon: service functions 406, leads / key registry / sites 401)
### verify --only people                    "passed": 15, "failed": 0, exit 0 (owner B 0 rows of A, member A1 own lead only, nobody none, keys hidden, staff only at aal2, status PATCH 403, service function 406)
```
Read-only after the runs (`staging-readonly.mjs`, counts only): security_events last 2 h = `bad-signature SIGNATURE` 5, `suspended S-SITE-PAUSED` 1,
all 6 with an ip hash (the deployed function records refusals); consent_ledger 3 rows (the suites' leads; the leads themselves 0, removed by
the suites); api_keys active site keys 2; workspaces state active 2; `pg_has_role('postgres', 'omnikom_fn', 'member')` true; definer functions
not pinned to the empty path: 0.

**Fixtures for the CLI department (please read).** The clean removed the Vault secrets and the `api_keys` rows with the workspaces, so
`key mint` numbered the new keys **1 again** (`site-test-demo-a-key-1`, `site-test-demo-b-key-1`), not 2: same names, NEW values (hash
prefixes 98c55c9adff5 and f9926b9a24b2; the old ones were ba00ce1aae9e and 2266f6832967). The env file now holds the older
`SITE_SIGNING_KEY_TEST_DEMO_A/B` lines and the new ones below them; `with-env` takes the last line, so everything works, but the stale
lines could be removed by the owner. The staff TOTP factor was re-enrolled (`TEST_STAFF_TOTP_SECRET` rewritten by the CLI). State left:
A and B seeded (alerts to amer@omnikom.io), 2 active site keys, staff factor present, 0 leads, 3 consent_ledger rows, 6 security_events,
6 audit_log rows. One alert email went to amer@omnikom.io from `verify --only lead`.

**Leftovers from the charter.**
- `capture-lead` paused site: DONE, 409 `S-SITE-PAUSED` (PROVEN above); also 409 `S-WORKSPACE-SUSPENDED`, 429 `S-QUOTA`, 404 unknown site,
  400 consent (the function maps the database's codes; the 409 and 429 are in `openapi.json`).
- `tools/deploy-capture-lead.mjs` project ref: DONE, scrubbed (`<project ref>` in the output above).
- `supabase/tests/test-apply.mjs` hang: NOT REPRODUCED. `timeout 600 node supabase/tests/test-apply.mjs` on 2026-10-30 21:58 printed 10 `ok`
  lines (`run 1 applies every file (8)`, `tenancy tests pass on the applied database`, `an edited applied migration is refused`, ...) and
  `OK: apply-staging 0 problem(s)`, exit 0, well inside the bound. The earlier `exit 124` was a timeout wrapper on a slow cluster start, not a
  hang in the script; nothing was changed in it. Kept on the open list as "watch", not as a bug.

**BLOCKED.** `supabase/auth-settings.md` checked against staging through the Management API: `node supabase/check-auth-settings.mjs` answered
`Management API answered 403 Forbidden (the token needs read access to the project's auth config); nothing checked`. The personal access token
in the env file is scoped to functions, function secrets and project settings read; the Auth configuration endpoint needs the Auth read
scope. Second approach (reading the dashboard back in the owner's signed-in Edge) needs the owner present. Unblock: the owner adds the Auth
read scope (or a second read-only token under a new variable name) and re-runs the command; its lines then fill the "checked" column. The
file holds the values set and read back in the dashboard on 2026-10-29 as the expectation.

**UNPROVEN.** The step-down to `omnikom_fn` inside the deployed function: a 202 proves the `set role` statement succeeded (a failure answers
500 CONFIG), and `pg_has_role` is true on staging; whether the connection string Supabase hands the function keeps the role for the whole
session (direct connection) or resets it per transaction (a transaction pooler) is not observable from outside. `mfa enroll-staff` over a
stale factor: still only the model (the clean removed the login, so the factor was simply absent). The consent lint has no notices row on
staging yet (no client content); proven by the contract tests only.

**Findings for other departments (not fixed here).** (1) CLI: `seed test --clean` resets key numbering (above) and leaves stale env lines; a
`key mint` that reads the env file's existing lines, or a `--clean` that says so, would help. (2) CLI: `verify --only lead` could assert the
`security_events` rows the function now writes (one per refused request) and the `consent_ledger` row per stored lead. (3) Head of
operations: `sops/site-endpoints.md` 2.3 should list the 409 answer (the site shows the call-us message; `factory/worker/lead-endpoint.mjs`
does); `sops/` has no owning department in the charters.

## SEO and audits, slice 1: the audit engine over a built folder (2026-10-30 21:30, builder session)
`tools/audit/` built to `tools/audit/briefs/slice-1-engine.md`: 14 checks (MET-001, MET-002, MET-003, MET-004, SE-202, URL-009, IDX-004,
IDX-001, IDX-002, IDX-003 as WARN, SE-004, A11-007, LNK-002, SCH-001), each with `rules/<ID>.md`; 64 generated fixtures plus `fixtures/good`.
Nothing committed. Outputs below are the real ones from the final run.
- `node tools/audit/test/run.mjs` (last lines): `ok   audit() returns the documented shape` / `OK: 195 of 195 checks passed`, exit 0.
- `node tools/audit/test/mutate.mjs` (last lines, final run): `106 mutants, 106 caught, 0 survived, 0 target text missing`, exit 0.
  (An earlier run was `106 mutants, 105 caught, 1 survived`: the svg-title mutant, because the test put the svg in the body, where the
  head filter hid it. The test now puts one in `<head>`; the rerun is the line above.)
- `node tools/audit/run.mjs tools/audit/fixtures/good`: 40 lines, every one `PASS`, then `OK: 4 page(s), 14 rule(s), 0 FAIL, 0 WARN, 0 SKIP`
  on stderr, exit 0.
- `node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003`: exit 1 and
  `FAIL MET-003 /tasting-room/:48 value-mismatch: <h4> "Small print" follows <h2> "Before you come" (line 46) and skips a level (source: checklist/web-delivery.md MET-003)`.
- `node tools/audit/fixtures/build-fixtures.mjs --check`: `OK: 64 fixture(s) equal the generator output`.
- Not covered by the engine (listed, not printed as SKIP so a clean site is all PASS): the HTTP parts of IDX-004 and the browser parts of
  A11-007. UNPROVEN: the rule texts were pasted from the brief, not re-read from `shipgate/spec/packs/`; IDX-003 has only the checklist's
  cut-short text.
- HEAD RE-RUN (Rule 2, 2026-10-30 21:30-21:55, the SEO and audits head, this checkout, the builder's files untouched):
  `node tools/audit/test/run.mjs` -> `OK: 195 of 195 checks passed`, exit 0, 0 FAIL lines;
  `node tools/audit/test/mutate.mjs` -> `106 mutants, 106 caught, 0 survived, 0 target text missing`, exit 0 (106 `caught` lines, 0 SURVIVED or MISSING);
  `node tools/audit/run.mjs tools/audit/fixtures/good` -> 41 lines, 0 non-PASS, `OK: 4 page(s), 14 rule(s), 0 FAIL, 0 WARN, 0 SKIP`, exit 0;
  `node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003` -> `FAIL MET-003 /tasting-room/:48 value-mismatch: <h4> "Small print" follows
  <h2> "Before you come" (line 46) and skips a level (source: checklist/web-delivery.md MET-003)`, `FAILED: ... 1 FAIL`, exit 1;
  `--list` -> 14 rules each with a severity and a checklist source; `build-fixtures.mjs --check` -> `OK: 64 fixture(s) equal the generator output`.
  SLICE 1 PROVEN. The brief's rule texts came from the shipgate spec 8.0.0 pack files read by the head on 2026-10-30 (the builder's
  UNPROVEN point above is closed by that reading, except IDX-003, which stays on the checklist's cut text as a WARN).
  The builder ran as an in-session Sonnet agent, not a sidebar session (the app refused `start_session` from a session-given task).

## Migration 6 and CLI part 2 (2026-10-30 17:45-19:00, cli-slice-1 session; the lead's brief after the step 2 finding)
- **Part 1, PROVEN.** `20261030000006_active_key_by_site.sql`: `service.active_key` matches a given site by `site_id` and narrows by the
  workspace only when one is given; no site keeps the platform-wide behaviour. Tenancy test now writes site keys the way `key mint` does
  (site AND workspace) plus another site's key, a revoked key and a key without a workspace. Watched red without the migration:
  `ERROR:  a revoked key is dead; a site key stored with its workspace is found by the site alone (what capture-lead asks)`; with it
  `PASS real migration: ALL TENANCY TESTS PASSED`, `OK: real migration passes; 129 mutants` (3 new, all caught: the old filter back,
  the workspace not narrowing, a site key handed out for no site). The CLI's `capture-lead` model now reads keys from the database
  (`service.active_key` joined to `vault.decrypted_secrets`, shimmed locally): `test/run.mjs` red without migration 6 (`lead send` 401,
  `test walls` fails), green with it. `run-all-gates.mjs`: `all gates passed`. Staging: `apply` = `applied 1 of 6`, `status` 6 applied /
  0 pending, read-only `active_key('site-signing', site A)` = 1 (was 0), with workspace 1, site B 1, no site 0.
- **Part 2, partly PROVEN, partly BLOCKED.** `verify --only walls` on staging: 5 of 5 PASS (anon calling `service.capture_lead` and
  `service.lead_update` through the Data API: 406; anon reading `leads`, `api_keys`, `sites`: 401). 406 means the service schema is not
  exposed (a refusal, but not the execute grant being tested). BLOCKED: person tokens. Approach 1 `generate_link` (magiclink) for
  `owner-a@test`: 500 `duplicate key ... users_email_partial_key` (GoTrue did not find the seeded user and tried to create it).
  Approach 2 admin `PUT /auth/v1/admin/users/<seeded id>` then password grant: 404 `user_not_found`. Read-only cause: the seeded
  `auth.users` rows have `aud`, `role`, `instance_id` and the token columns null. Staff would also need a TOTP factor for aal2, and
  `nobody` (sub ...f0) has no `auth.users` row. Nothing changed on staging by these probes. Unblock: a decision on GoTrue-shaped seed rows.
- Tests: `test/run.mjs` 145 of 145; `test/mutate.mjs` 67 mutants, 67 caught (66 in the full run, the 67th re-run after making its target
  unique).
- **Part 2, resolved (19:00-19:40, after the lead's decision: GoTrue-shaped seed rows).** `seed test` writes six logins (adds `nobody`
  `nobody@test`, id ...f0) with `aud`/`role` authenticated, zero `instance_id`, `email_confirmed_at`, empty-string token columns, app
  metadata; an update statement repairs rows from the earlier seed. On staging: `seed test` -> `changed: true`, again -> `changed: false`.
  `generate_link` (magiclink) + `/verify`: 200, 200, `GET /user` 200, sub = the seeded id, aal1 (probe output: `generate_link 200`,
  `verify(token_hash) 200`, `user(token) 200`). `omnikom mfa enroll-staff --target staging`: `changed: true` (a TOTP factor for the staff
  test login; `TEST_STAFF_TOTP_SECRET` appended to the master env file, nothing printed). `verify --only people --target staging`:
  15 of 15 PASS, exit 0 (owner A reads both test leads; owner B 0; member A1 only the lead handed to them; member A2 0; nobody 0 leads and
  0 workspaces; owner B sees only workspace B; owner and member read 0 api_keys; staff at aal2 read both leads and the key registry;
  staff at aal1 read none; owner PATCH of a lead status 403; service function via Data API 406), no token in the output (grep `eyJ` = 0),
  leads afterwards 0. Local: `test/run.mjs` 167 of 167 (a model of GoTrue and PostgREST over the throwaway database: row-level security
  decides; a leaky Data API makes `people` FAIL; blind Auth is BLOCKED exit 3; `mfa enroll-staff` once and twice); mutants and gates below.
  Final local state: `test/run.mjs` 168 of 168; `test/mutate.mjs` 83 mutants, 83 caught (81 in the full run; the two survivors were test-design
  gaps, fixed: the seed repair hid the null-token insert, so that mutant is layered; the aal1-key check had no broken-wall model, so the model
  got `noMfa`; both re-run and caught); `run-all-gates.mjs`: `all gates passed` (the auth.users shim gained the GoTrue columns).
  NOT DONE / UNPROVEN: `mfa enroll-staff` removing a stale factor (the path with `removedFactors > 0`) ran only against the model, not on staging;
  the slice 2 checks (lead-update, publish, add-lead) wait for those functions.
- **Head's re-run (2026-10-30 20:18-20:30, CLI department head, Rule 2; commit 82bc2f8 as pushed, this checkout).** Through
  `with-env` + `omnikom ... --target staging`: `status` = reachable, 6 applied / 0 pending / 0 mismatched, `capture-lead` deployed, 4 key
  names present, exit 0; `verify --only walls` = `passed 5 failed 0 exit 0` (406, 406, 401, 401, 401); `verify --only people` = `passed 15
  failed 0 exit 0`, every line PASS as listed above (owner PATCH 403, service function 406); `verify --only lead` = `passed 12 failed 0
  exit 0` (202; retry 1 row and 1 alert; 400; 401 x5; 404; 405; paused site 500 and 0 rows); `lead list --as owner-a` after = 0 rows.
  No token or key in any output. Local: `test/run.mjs` = `OK: 168 of 168 checks passed`, exit 0; `test/mutate.mjs` = `83 mutants, 83 caught, 0 survived, 0 target text missing`, exit 0.
  ACCEPTED: slice 1 (parts 1 and 2) is closed. Charter finding passed up: the builder edited `supabase/tests/local-shim.sql` (GoTrue
  columns on the auth.users shim) before the charter reserved `supabase/`; committed and green, recorded, not reverted.

## Step 2: the first lead, through the CLI on test workspaces A and B, to staging, to the owner's inbox (2026-10-30 17:15-18:20, step-2-lead-proof session)
Every command ran as `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs <command> --target staging`;
the CLI redacts, no key or URL value appears below. Ids are the seeded fixture ids (`aaaaaaaa-...` = A, `bbbbbbbb-...` = B).
1. `status`: `reachable: true`, ledger present, applied `20261028000001_platform` .. `20261029000005_vendor_defaults` (5), pending `[]`,
   mismatched `[]`, `capture-lead: deployed`, 4 `STAGING_*` key names `true`, exit 0. `apply --dry-run`: `DRY RUN: 0 pending of 5`, exit 0.
   `test walls`: `PASS tenancy tests on staging`, `OK: no fixtures left on staging (rolled back)`, exit 0.
2. `seed test --alert-to amer@omnikom.io`: workspaces `test-demo-a` (id `aaaaaaaa-0000-0000-0000-000000000000`, site
   `aaaaaaaa-0000-0000-0000-00000000517e`) and `test-demo-b` (`bbbbbbbb-...-000000000000`, site `bbbbbbbb-...-00000000517e`), logins
   owner-a, owner-b, member-a1, member-a2, staff, `changed: true`, exit 0. Second run: same ids, `changed: false`, exit 0.
   PROVEN for the first time: the `auth.users` insert by `(id, email)` on real Supabase.
   `key mint --site test-demo-a`: `vaultSecret: site-test-demo-a-key-1`, `envVariable: SITE_SIGNING_KEY_TEST_DEMO_A`, `hashPrefix: ba00ce1aae9e`.
   `key mint --site test-demo-b`: `site-test-demo-b-key-1`, `SITE_SIGNING_KEY_TEST_DEMO_B`, `hashPrefix: 2266f6832967`. `key list`: 2 rows
   (ids `5764d644-ffa2-4aa6-9931-60e1745a8235`, `056cda42-8b69-415b-89c5-93ab51f9b7fb`, kind site-signing, hash prefixes only).
   PROVEN for the first time: `vault.create_secret` through the transaction pooler.
3. `capture-lead` deployed with `RESEND_API_KEY` and `LEAD_ALERT_FROM` (step 1 session, re-verified by the lead; `status` shows `deployed`).
4. FIRST ATTEMPT (18:0x, before migration 6): `lead send --site test-demo-a --fixture lead-contact.json --expect 202` = **401**
   `{"code":"SIGNATURE","msg":"Not accepted."}`, `stored: null`, exit 1. Read-only diagnosis: `service.active_key('site-signing', <site A>)`
   = 0 rows, with A's workspace added = 1 row; db epoch = local epoch; Vault secret readable; site state preview. Cause: migration 2's
   `active_key` matched `workspace_id is not distinct from p_workspace` (null from the function) while both mint tools store the site's
   workspace on the key. Routed by the owner to the CLI builder (POSITION 17:40); fixed by migration `20261030000006_active_key_by_site.sql`
   (builder), applied to staging by the lead. `status` after: 6 applied, 0 pending, exit 0.
   SECOND ATTEMPT (18:07): `lead send --site test-demo-a --fixture lead-contact.json --expect 202` = `code: 202`, `matched: true`,
   submission id (the idempotency uuid) `4551e604-eb65-402a-b4fe-7bc93706c6a2`, attempts `[202 {"ok":true}]`, `stored: 1`, exit 0.
   PROVEN for the first time: the signed path string the deployed function sees equals what the endpoint signs.
   `lead send ... --retry --expect 202` (18:08): submission id `f190271c-6d8c-42b1-ba30-9aa2062953af`, attempts `[202, 202]`, `stored: 1`, exit 0.
   `verify --only lead` (18:09; the lead suite as in commit d4ad6d8, 12 checks; the builder's uncommitted `walls` suite was not run), exit 0:
   ```
   PASS a signed lead is accepted (expected 202, got 202)
   PASS the same idempotency key twice stores one row (expected 202 and 1 row, got 202, rows=1)
   PASS a retry sends no second alert (expected at most 1 alert row, got 202, alerts=1)
   PASS an empty consent is refused (expected 400, got 400)
   PASS B's key on A's site is refused (expected 401, got 401)
   PASS a signature older than 301 s is refused (replay) (expected 401, got 401)
   PASS a request without a signature is refused (expected 401, got 401)
   PASS a garbled signature is refused (expected 401, got 401)
   PASS an unknown site id is refused (expected 401, got 401)
   PASS a malformed site id is not found (expected 404, got 404)
   PASS GET is refused (expected 405, got 405)
   PASS a lead to a paused site is not stored (expected not 202, 0 rows, got 500)
   ```
   stdout: `"passed": 12, "failed": 0`. The paused site still answers 500 (known finding, not S-SITE-PAUSED). Site A state after: `preview`.
5. `lead list --as owner-a`: `count: 2` (ids `4ba2f8aa-58d5-4f54-96d2-6118f83f8064` 16:07:34Z and `5a27460a-561b-4c4b-bc7e-0b548f5cec79`
   16:08:29Z, status new, page `/omnikom-cli-test`). `lead list --as owner-b`: `count: 0`. Alerts (read-only query of `messages`, template
   `new-lead`): 3 rows, all `state: sent`, `error: null`, one per lead (16:07:35Z, 16:08:30Z, 16:09:16Z for verify's own lead), none for the
   two retries. OWNER 18:15: "Yes, 3 emails arrived" at amer@omnikom.io. `lead delete --as owner-a --lead 4ba2f8aa...` and `--lead 5a27460a...`:
   `ok`, `deleted`, exit 0 each; `lead list --as owner-a` after: `count: 0`.
Staging state at the end: A and B seeded (alerts to amer@omnikom.io), 2 active site keys, 0 leads, 3 `messages` rows (sent; the deleted leads'
rows keep `lead_id: null`, so messages are set null, not cascaded, on a lead delete). Observation: `verify.mjs` says "events and messages cascade";
messages survive with a null lead (harmless; the row is the proof an alert went out). UNPROVEN still: the person checks of 26 section 4 over HTTP
(builder's part 2), `S-SITE-PAUSED` over HTTP (500 today).

## Step 1.1 + step 2.1 on the real staging project (2026-10-29 23:10-00:10, setup session beside the owner)
Project: Supabase org "Omnikom" (Free), project "Omnikom V2 Platform" used as staging (owner's pick), ref in the .env as
`STAGING_SUPABASE_REF`, region us-west-2 (DECISIONS 29), Postgres 17.11. Banked by name only (`creds and accounts login/omnikom.env`,
git-ignored, `OMNIKOM_ENV_FILE`): `STAGING_DB_PASSWORD`, `STAGING_DB_URL` (transaction pooler 6543), `STAGING_DB_URL_DIRECT`
(session pooler 5432: the direct host is IPv6-only on Free, so the session pooler is the IPv4 path for migrations),
`STAGING_SUPABASE_PUBLISHABLE_KEY`, `STAGING_SUPABASE_SECRET_KEY`.
```
node tools/check-platform-keys.mjs "<env>"
STAGING_SUPABASE_REF: present / STAGING_DB_PASSWORD: present / STAGING_DB_URL: present / STAGING_DB_URL_DIRECT: present
STAGING_DB_URL connect: OK
Supabase publishable key: HTTP 200 OK
Supabase secret key: HTTP 200 OK
(Cloudflare, R2, Resend, LEAD_ALERT_FROM, Google: MISSING, steps 1.3-1.5 not started)

node tools/test/probe-db.mjs STAGING_DB_URL_DIRECT
STAGING_DB_URL_DIRECT: HTTP-like OK: pg 17.11 ssl=true user=postgres
STAGING_DB_URL_DIRECT: SSL enforced (a non-SSL connection was refused: ... FATAL: ...)

node tools/staging-extensions.mjs
ok pg_cron 1.6.4 schema=pg_catalog / ok pg_net 0.20.4 schema=extensions / ok pgmq 1.5.1 schema=pgmq / ok pg_stat_statements 1.11 schema=extensions
all installed: pg_cron 1.6.4, pg_net 0.20.4, pg_stat_statements 1.11, pgcrypto 1.3, pgmq 1.5.1, plpgsql 1.0, supabase_vault 0.3.1, uuid-ossp 1.1
PASS extensions on staging: 4 of 4

node supabase/apply-staging.mjs --url-env STAGING_DB_URL_DIRECT
apply 20261028000001_platform.sql / apply 20261029000002_crm.sql / apply 20261029000003_addons.sql / apply 20261029000004_hardening.sql
OK: applied 4 of 4 (0 were already applied)

node supabase/tests/run-staging.mjs   (first run on real Supabase)
FAIL tenancy tests on staging:
psql:.../tenancy.test.sql:89: ERROR:  no public function executable by anon
OK: no fixtures left on staging (rolled back)
```
After migration 5 (vendor defaults) and the ledger moved to `ops.platform_migrations` (second T14 catch on staging: the
ledger table that apply-staging created in `public`, now in its own schema; `test-apply.mjs` updated):
```
node supabase/apply-staging.mjs --url-env STAGING_DB_URL_DIRECT
apply 20261029000005_vendor_defaults.sql
OK: applied 1 of 5 (4 were already applied)

node supabase/tests/run-local.mjs --only "vendor function defaults"
PASS real migration: ALL TENANCY TESTS PASSED
caught   vendor function defaults overridden (N10 on real Supabase, migration 5) ERROR:  no public function executable by anon

node supabase/tests/run-staging.mjs   (2026-10-30 00:03)
PASS tenancy tests on staging
OK: no fixtures left on staging (rolled back)
```
Closes REVIEW 15 and the "run-staging.mjs written, not run" line below: the walls hold on real Supabase.
Settings observed in the dashboard (browser pane, each read back after saving): Enforce SSL on (confirmed by the probe above);
sign-ups off, anonymous off, confirm email on, OTP expiry 3600 s, OTP length 8; Site URL `https://app-staging.omnikom.io`,
redirect `https://app-staging.omnikom.io/**`; rate limits left at the defaults (sign-in 30 / 5 min, OTP and magic-link
verifications 30 / 5 min, token refresh 150 / 5 min, built-in mail 2 / hour until custom SMTP); Data API: auto-expose already
off, schemas public + extensions exposed, pg_graphql not installed (no graphql_public).
FINDINGS (vendor differs from the docs):
1. The Email provider has no "passwords off" switch; magic-link-only (DECISIONS 29 D18) is enforced by the app never offering
   a password form, and by the staff second factor. Recorded on the sequence line.
2. `public.rls_auto_enable()` (Supabase's own event-trigger function, owner postgres, default ACL) gave `anon` EXECUTE on one
   function in `public`, so N10 failed on staging while passing locally. An event-trigger function cannot be called by a
   client (nothing leaked). Fix: `20261029000005_vendor_defaults.sql` (revoke execute on all functions in public from public,
   anon), the same vendor function added to `local-shim.sql`, and the mutant "vendor function defaults overridden" in
   `run-local.mjs`. Proof lines below once run.
3. The built-in browser pane cannot copy to the Windows clipboard (page scripts: "Write permission denied"; the owner's own
   click: "unable to copy") and Supabase's CSP blocks the page from posting to localhost, so `tools/secret-receiver.mjs`
   (built and tested: 14 checks, 6 of 6 mutants) could not be used from that page. Working path: the Copy button clicked in
   the owner's Edge through the Claude extension, then `save-secret-from-clipboard.ps1` by name. The pane still drives
   every settings page.
NOT DONE (owner clicks): MFA on the Supabase account, a second owner.

### Steps 1.2, 1.3, 1.4 (2026-10-30 00:30-01:45, owner creating accounts, the session clicking through them in Edge)
```
gh api orgs/Omnikom-platform --jq '{two_factor_requirement_enabled}'     -> {"two_factor_requirement_enabled":true}
gh api -X POST repos/AbdulrahmanAmer/backup-Omnikom-Platform/transfer -f new_owner=Omnikom-platform -f new_name=omnikom-platform
gh repo view Omnikom-platform/omnikom-platform -> {"branch":"master" (after PATCH default_branch), "isPrivate":true}
gh repo create Omnikom-platform/omnikom-platform-prod --private -> https://github.com/Omnikom-platform/omnikom-platform-prod
PUT vulnerability-alerts 204, PUT automated-security-fixes 204; actions/permissions {"allowed_actions":"all","enabled":true}
git push backup-gh master -> 86edf13..7b09d21, 8414fcb..52bf824 (remote re-pointed to the org repo)

node tools/check-platform-keys.mjs "<env>"   (01:27)
Cloudflare Pages token: HTTP 200 OK  /  Cloudflare DNS token: HTTP 200 OK   (account endpoint /accounts/<id>/tokens/verify;
the user endpoint answers 401 "Invalid API Token" for account-owned tokens: checker fixed)
Resend: HTTP 401 "This API key is restricted to only send emails" = a valid sending-only key (checker reads it as OK)

node tools/dns-upsert.mjs --zone omnikom.io --records sops/dns/notify.omnikom.io-resend.json --token-env CLOUDFLARE_DNS_TOKEN_LEGACY
zone omnikom.io (a7c8acea...) in account "Abdoamer683@gmail.com's Account"
create TXT resend._domainkey.notify.omnikom.io / create CNAME rsend.notify... / create CNAME send.notify... / create MX notify.omnikom.io
done: 4 created, 0 skipped, 0 failed
Resend domain page 01:30: STATUS Verified (region eu-west-1)
node tools/resend-test-email.mjs --to amer@omnikom.io -> Resend send: HTTP 200 id=01a18a00-13fe-7dae-8593-2b9415fb85dc
owner 01:35: "email arrived"
node tools/deploy-capture-lead.mjs --secrets-only -> OK: secrets set by name: RESEND_API_KEY, LEAD_ALERT_FROM
Supabase Auth > SMTP (pane, 01:41): Enable custom SMTP on, smtp.resend.com:465, user resend, sender login@notify.omnikom.io,
password pasted by the owner from the clipboard (tools/clipboard-from-env.ps1) -> "Successfully updated settings"
```
Accounts: GitHub org `Omnikom-platform` (logo set); Cloudflare NEW account amer@omnikom.io (id in the .env as
CLOUDFLARE_ACCOUNT_ID), tokens `omnikom-pages-deploy` + `omnikom-dns-onboarding` (account API tokens, 90 d, each rolled once:
the first Pages value was echoed by the browser "find" tool, the first DNS copy missed), Dave invited as Super Administrator
(Pending); Resend team "omnikom", domain `notify.omnikom.io` (owner's choice of a subdomain), sending-only key. R2 DEFERRED
(owner; a card on file is the price). Legacy token `omnikom-dns-legacy` (old account, DNS edit on omnikom.io only) for the
zone that still lives there. UNPROVEN: a magic-link send through the custom SMTP (no login exists yet); `test-apply.mjs`
hangs locally (exit 124, no output) and needs a debug pass; the member invite until Dave accepts.
Later the same night: Supabase org invite dave@omnikom.io as Owner ("Successfully sent invitation", 01:55; the first attempt
missed a second confirmation dialog "Invite as Owner?").

### Step 1.5 Google (2026-10-30 01:50-02:15): PARTLY DONE, then BLOCKED by an organisation policy
Done in project `omnikom-seo` (signed in as amer@omnikom.io in Edge): Search Console API and Site Verification API enabled
(both listed on the APIs dashboard next to PageSpeed Insights); service account `omnikom-platform-search@omnikom-seo.iam.gserviceaccount.com`
created (unique id 101514631929447392231, no project role: Search Console access is granted per property later).
BLOCKED: "Service account key creation is disabled": the organisation omnikom.io (id 29312388971) enforces
`iam.disableServiceAccountKeyCreation` ("Secure by Default"). The owner chose to lift it for the project, but amer@omnikom.io
has neither `orgpolicy.policies.*` on the project nor `resourcemanager.organizations.getIamPolicy` on the organisation: the
console names the role to add, "Organization Policy Administrator" on omnikom.io, and only an Organization Administrator (or
the Google Workspace super admin of omnikom.io) can grant it. UNBLOCK (either): (a) the Workspace super admin opens the Cloud
console > IAM at organisation omnikom.io > Grant access > amer@omnikom.io > roles Organization Administrator + Organization
Policy Administrator; then the policy page for Omnikom SEO > Manage policy > Override parent's policy > rule Enforcement
Off > Set policy; then `Add key > Create new key > JSON` and `node tools/bank-json-key.mjs --file <download> --env <env>`
banks it as GOOGLE_SERVICE_ACCOUNT_JSON and deletes the download; or (b) keep the policy and use Workload Identity
Federation from GitHub Actions in step 7 (keyless; Google's recommendation on that very dialog). Nothing before step 7 needs it.
02:10: the Workspace super admin is dave@omnikom.io (the owner signed in as Dave in Edge); Google Cloud answers "access
blocked: 2-step verification required (enforced since 2026-10-20)" plus the first-time Cloud terms dialog for that account, so
the grant needs Dave himself (phone for 2SV, terms acceptance). Path (a) therefore waits for Dave; path (b) needs nobody.
02:20-02:35 UNBLOCKED through Workspace instead: Dave (super admin, admin.google.com works without the Cloud 2SV wall) made
amer@omnikom.io a Workspace super admin; amer@ then granted itself Organization Administrator + Organization Policy
Administrator on omnikom.io and overrode the constraint for Omnikom SEO (legacy and managed versions both "Not enforced").
Key created and banked (the session's tools refused the policy and role clicks themselves; the owner clicked):
```
node tools/bank-json-key.mjs --file <download> --name GOOGLE_SERVICE_ACCOUNT_JSON --env <env>
saved GOOGLE_SERVICE_ACCOUNT_JSON (3164 chars, base64 of the JSON) for omnikom-platform-search@omnikom-seo.iam.gserviceaccount.com in project omnikom-seo; downloaded file deleted
node tools/check-platform-keys.mjs "<env>"
Google service account (omnikom-platform-search@omnikom-seo.iam.gserviceaccount.com): HTTP 200 OK, 0 Search Console site(s)
```
Note for later: amer@omnikom.io is now a Workspace super admin and the key-creation policy is lifted on Omnikom SEO only; both
are owner decisions of 2026-10-30, reversible in the Admin console and the policy page.
New tools: `tools/with-env.mjs` (run a command with the .env loaded by name), `tools/compose-db-url.mjs` (connection strings
from the password in the note, never shown), `tools/check-platform-keys.mjs`, `tools/staging-extensions.mjs`,
`tools/secret-receiver.mjs` + tests, `tools/tick-sequence.mjs`, `tools/test/probe-*.mjs`.

## Hardening run (2026-10-29 22:50, four migrations in order, `node supabase/tests/run-local.mjs`)
```
PASS real migration: ALL TENANCY TESTS PASSED
125 mutants: 124 caught on the full run; the one survivor ("a retry stores nothing") had become a double wall (early return
plus on-conflict insert) and is now a two-layer mutant, caught on re-run
```
New this run: migration 4 (REVIEW-2026-10-29 fixes: unpublish null guard, column-limited media insert, members through
`set_member`/`remove_member`, one build per site, monotonic `published_version`, `own` needs an `ownerField`, paused sites
refuse leads, bounded inputs, explicit `sms_consent` and STOP, per-workspace message caps, message idempotency and legal
transitions, owners cannot move billing state, null claims only for the concierge, the member a meeting is with may change it,
template field allowlist, recursive secret scan on connector configs, workspace indexes, `delete_lead`); T15 behaviour tests;
T14 structural gates read from the catalogues (RLS and a select policy on every table, a `workspace_id`-first index on every
tenant table, `search_path` and a null-guard lint on every definer function, grants audit, every claims-taking service function
in the outsider list, the generated read-isolation loop over every tenant table for a foreign owner and a no-membership login).
`tools/crm-map`: 152 tests, 109 mutants after the review fixes. Deno check PASS on capture-lead.

## Expansion blocks run (2026-10-29 21:05, `node supabase/tests/run-local.mjs`, three migrations in order; DECISIONS 23)
```
PASS real migration: ALL TENANCY TESTS PASSED
83 mutants: 82 caught + 1 target missing on the first pass (a mutant still aimed at the pre-fix line), re-pointed and caught -> 83 caught, 0 survived
```
Leak found by T13 and fixed (watched red): a non-member's NULL role passed `not (false or NULL)` in `lead_update` and the
add-on and template owner checks (B's owner could act on A). Null guards added (`can_act_on_lead`, `is_owner_or_staff`,
`lead_update`), 3 tests and 3 mutants for them. One plain bug fixed on the way (a CASE that yielded text for `booking_state`).

## Step C run (2026-10-29 19:45, `node supabase/tests/run-local.mjs`, both migrations applied in order; DECISIONS 21)
```
PASS real migration: ALL TENANCY TESTS PASSED
OK: real migration passes; 60 mutants        (60 caught, 0 survived; 14 new for 20261029000002_crm.sql, T12)
```
Also this run: `check-specs.mjs` 0 problems; `contracts/test/run.mjs` 138 passed, 0 failed. Watched-red on the way: the two
"service functions closed to clients" mutants SURVIVED once the second migration re-closed the schema (a single wall had become
double); both now remove both layers and are caught. NOT RUN this time: the industry run, deno check (unchanged files).
Diagrams: `render.mjs` failed for every diagram (Edge headless `--dump-dom` prints nothing since an update); fixed 20:05 by probing
each browser and using the first that prints a DOM (Chrome). `node docs/blueprint/diagrams/render.mjs` -> 13 of 13 ok.

## Final gate run (2026-10-28, after dry run 2, `node docs/blueprint/specs/run-all-gates.mjs`)
```
PASS contract tests             138 passed, 0 failed
PASS contract mutants           82 mutants, 82 caught, 0 survived; 0 codes untested
PASS industry run               15/15 PASS; wrote industry-run/RESULTS.md, contracts/, screens/
PASS database walls + mutants   OK: real migration passes; 47 mutants
PASS specs + traceability       OK: 10 operations, 10 operationIds; 38 FR/NFR rows, 30 work orders, 0 problem(s)
PASS machine-call signature     OK: 0 failed
PASS deno check                 deno check supabase/functions/_shared/signature.ts supabase/functions/_shared/contracts.ts
all gates passed
```

## Dry run 2 (17 new issues + 1 left over): disposition
Each fixed item got a test that went red first, then green; database walls also got a mutant.
- N1 outsider learns field names: `service.contract_for` (404 before any validation), save/publish order fixed in docs + diagram (T12).
- N2 reaper failed live deploys: counts from the last state change (running 30 min, queued 24 h); a reaped job whose deploy lands
  reconciles to done; a NULL in the transition check let an illegal jump through (found by the test, fixed).
- N3 pages outside the plan seeded without title/SEO: contract `pageSeeds` + `seedGaps()`; ELEV8 seeds all 43 pages within the limits
  (12 from the live backup, shortened; 4 drafted pages listed in `clientWording` for the client).
- N4 publish shipped an unvalidated version: `start_publish` takes and pins the validated versions (T13).
- N5 `deno check` broke with a root package.json: reproduced the exact `npm:@types/node` error, fixed with `deno.json`
  `"nodeModulesDir": "none"`; `deno task check` is now a gate.
- N6 signature had no canonical form or replay window: `signature.ts` (t + method + path?query + body, 300 s), tests watched failing
  on a wider window and on unsigned paths.
- N7 token Worker: Vault JSON `{token, worker}`, `Export.deployTokenWorker`. N8 publish body `{site, rows, versions}`.
- N9 seed reference recorded as the version's sign-off. N10 no extension functions in `public` (pgcrypto removed; built-in UUIDs).
- N11 stale names swept. N12 unprocessed photos block publish. N13 job error recorded. N14 W1.6 setup spelled out. N15 unpublish in
  W3.5. N16 local Postgres, staff login, DB driver specified in W0.5. N17 `resolved` shape defined.
- Left over from dry run 1: the industry run now writes only changed files (watched: rewritten before, untouched after).

## The wall leak, proven (fact-check S1 / dry run 8.1)
The test stand-in now models Supabase's default grants (`supabase/tests/local-shim.sql`). The same three grant-wall mutants:
- old stand-in (no defaults): `SURVIVED append-only versions`, `SURVIVED anon has no table rights`, `SURVIVED anon cannot call
  save_version` (the old tests could not see the leak);
- realistic stand-in: all three `caught`. Every wall that is double (defaults off + explicit revoke) is mutated on both layers.

## New leaks found and fixed (each now has a test that went red, and a mutant)
1. A failed publish shipped on the next publish (dry run 5.1): publish is now a job; nothing goes live until it is done; a failed
   job's versions are never shipped (T6).
2. My own snapshot design had a race (a queued second publish froze stale content): the snapshot now freezes at build start (T11).
3. The save validator could be skipped through a public RPC (dry run 3.2): the save body is private; only the `save` function can
   reach it (T4).
4. Members could publish others' items (dry run 3.1): publish uses the same own-only rules (T2b).
5. Photo facts were trusted from the client's row JSON (dry run 3.3): they now come from the media record (`I-MEDIA-UNKNOWN`).
6. `collection_def()` exposed other workspaces' contracts (standards check): guarded (T3).
Plus: staff need MFA (aal2), storage bucket + policies as code, per-job events, legal state transitions, a stale-job reaper,
unpublish, Realtime publication, rolled-back staging-safe tests (`run-staging.mjs`), seeding with an explicit staff actor.

## Fact-check (8 WRONG, 27 PARTLY): all addressed
S1-S4, S6-S10, S15, S17-S20 (Supabase), C1 (marked UNVERIFIED + W0.4 step), C4/C5 (Cloudflare caps in risks), C7/C8, G2, G5,
I1-I11, Q2, ST4, ST8, ST11, ST12, ST15: fixed in the migration/tests or the docs. UNVERIFIABLE items stay marked (O1, ST2, ST4).

## Dry run (31 issues): disposition
Fixed in code + tests: 3.1, 3.2, 3.3, 3.6, 5.1, 5.5, 5.6, 6.1, 6.2, 6.3, 8.1, 8.2, 2.5/4.1 (resolved contract; mergeCore
idempotent). Fixed in the blueprint: 1.2 (CI installs Postgres binaries), 1.5-1.7 (W0.5 local dev kit, no Docker), 2.1-2.4,
2.6, 2.7 (W1.1 seed spec), 3.4, 3.5, 3.7, 4.2 (ADR 0011 revised: runner key; the job token added nothing), 4.3, 4.4, 5.2, 5.3,
5.4 (M1 publishes the contact page; photos in M3), 6.3, 7.1, 7.2 (runner compares the target with the Worker recorded with the
site's token), 8.3. Moved to a later work order: 5.7 (sitemap only lists published pages: W2.2 acceptance). Still BLOCKED by
accounts (owner decisions D1-D4): 1.1, 1.3, 1.4, 2.8, 4.5, 5.8, 7.3. UNPROVEN until W1.2: 3.8 (bundling `contracts/` into Edge
Functions; `core.json` is now a JSON module import instead of a runtime file read).
Every M0-M1 work order now has a local acceptance next to its cloud acceptance (05-BUILD-PLAN).

## UNPROVEN / UNVERIFIED
Anything on real Supabase/Cloudflare/GitHub (no projects yet; `run-staging.mjs` is written, not run); Supabase's real `auth.users`
accepting the named-column fixture insert; the default function secret name for the DB URL; ISO 29148 / 42010 clause content;
ASVS per-requirement sheet (W0.2); OpenAPI official-schema validation; estimates (~99 engineer-days) are estimates.
