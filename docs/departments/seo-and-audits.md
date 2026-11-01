# Department: SEO and audits (`seo-and-audits`)

Created 2026-10-30 by `tools/departments/new-department.mjs`. Rules for every department: `docs/departments/README.md`.

## Mission
Turn the programmatic-enterprise-web-performance skill (the shipgate checklist, the audit, the six-question report) into code that runs the same way every time: an audit engine with tests and mutants that every built site must pass before publish, exposed as omnikom audit through the CLI department, so the enterprise SEO, AEO and GEO service is enforced in the build and never relearned by a session.

## Owns
- `skills/programmatic-enterprise-web-performance/`
- `tools/audit/`
- `docs/blueprint/22-SEARCH-AND-ANALYTICS.md`
- `skills/unslop/` (until step 5, then the Design department; DECISIONS 37, 39)

## Does not touch
Every path not listed above. A bug or a need in another department's files is a finding sent to the head of operations with
options, never a fix made here.

## Head session
- Model: opus (DECISIONS 40). Started by the head of operations with a brief that names this file.
- Reads first, in order: `CLAUDE.md`, this charter (whole file, the position log last), `.claude/POSITION.md` (last blocks),
  `planning/DECISIONS.md` (the items this charter lists under Decisions), then the files the current slice names.
- Does: splits the work into slices with a written brief each, starts one builder per slice, re-runs every builder's proof
  itself before accepting it, appends one dated line per finished slice to the position log below, reports to the head of
  operations in two lines.

## Builders
- Model: sonnet unless a slice is design-heavy (then the head does it, or an opus builder).
- Mechanical runs (tests, mutants, gates, grep, fixture rebuilds, deploy and status commands) go to a haiku agent with the
  exact command; the head or builder reads the verdict lines back (DECISIONS 34).
- One slice, one brief, one set of files; discarded when the slice is done. The brief carries: the files, the spec, what done
  looks like with the gate command, the rules below, and "anything outside this brief is a finding you send back, not a fix".

## Rules that bind this department
- `docs/blueprint/23-GROUND-RULES.md` (a rule is a test with a mutant; done means observed; the not-skippable list).
- Keys by variable name only (CLAUDE.md rule 9); live things need the owner's click (rules 6 and 12); nothing against a client
  project or site; no em dashes in any file.
- The skill copy here is synced with the outside copy on purpose (CLAUDE.md non-negotiable 1): a change to the skill goes through node skills/sync-skill.mjs and a new row in skills/SOURCE.md; never let the two diverge.
- Public data only, politely (CLAUDE.md rule 4): no logins, no paid data APIs, one HTTP 429 from a host means stop that host, never bypass a CAPTCHA or bot wall; never submit a form on any live site.
- Measurable rules become code in tools/audit/ (one check = one rule id from the checklist, a test with a fixture that fails it and a mutant that removes it); judgement (what to fix first, the plain-word report) stays in the skill. A check without a cited source (checklist rule id, or vendor page URL with the date read) is not admitted.
- The CLI command shape (omnikom audit, omnikom gate) belongs to the CLI and testing department: this department ships tools/audit/ as a library with a documented call and sends the command brief to the head of operations, who routes it to the CLI head.
- No client project folder is a test vehicle (DECISIONS 30): fixtures are synthetic sites under tools/audit/fixtures/ and the skill's own fixtures; a live public URL may be read politely for a measurement, never changed.
- Shared laptop: a head or builder stops only processes it started, by their PID, never by a name or pattern (2026-10-31: a pattern kill in
  slice 4b may have ended another session's mutant run). The audit tests must remove every temp folder they make, killed runs included (slice 4b.1: one root per run; the live driver stops its child's whole tree).
- Head's context is for planning, briefs, reviewing the chain, landing and two-line reports (owner, 2026-11-01 06:28): every hands-on
  task (live runs, diagnosis, log reading, skill syncs, brief research) goes to a fresh builder or a Haiku runner. Builders keep their
  report short and write the detail into the slice's proof file `tools/audit/proof/<slice>.md`.

## Proof
- Gate 1, the tests: `node tools/audit/test/run.mjs` prints `ok  ` or `FAIL` per check and ends `OK: N of N checks passed`, exit 0.
  Each bad fixture under `tools/audit/fixtures/bad-<rule id>/` fails exactly its rule and no other; `fixtures/good/` passes every rule.
- Gate 2, the mutants: `node tools/audit/test/mutate.mjs` removes one rule per mutant from a COPY of `tools/audit/` and re-runs gate 1
  against it; ends `N mutants, N caught, 0 survived, 0 target text missing`, exit 0. Only a `FAIL` line counts as a catch; a crash or a
  timeout is not a catch (the department tools learned this on 2026-10-30: 8 false catches on the first run).
- Gate 3, the runner on a folder: `node tools/audit/run.mjs tools/audit/fixtures/good` prints one `PASS <rule id> <page>` line per rule per
  page, exit 0; on `tools/audit/fixtures/bad-MET-003` it prints `FAIL MET-003 <page>:<line> <what> (source: <checklist file>)` and exits 1;
  `--json` prints one JSON object (`{ pages, rules, findings[], pass, exit }`) and nothing else.
- Every check cites its source in `tools/audit/rules/<rule id>.md` (the checklist rule id and file, or a vendor page URL with the date
  read); `node tools/audit/run.mjs --list` prints every rule with its source, and gate 1 fails on a rule whose source file is missing.
- The head re-runs gates 1 to 3 itself before a slice is accepted (Rule 2); outputs go to `docs/blueprint/PROGRESS.md` under
  "SEO and audits, slice N", never into a message.
- When build step 4 exists: a forced heading failure on the platform's test site deploys nothing (the gate blocks the publish job), observed in the job events.

## Decisions that shape this department
- DECISIONS 11 (one Omnikom Search Console account), 22 (free tiers; free data sources), 25 (proof before paper), 33 (departments; README rule 5: a learned check becomes a tool).
- Owner 2026-10-30 19:30: turn the whole PEWP skill and process into a CLI expansion so every website we output has actual enforcement for the heading and code structure that makes the service enterprise.

## Open items
- Slice 1 (brief `tools/audit/briefs/slice-1-engine.md`, Sonnet builder): `tools/audit/` as a dependency-free Node library plus
  runner over a built site folder of static HTML; one check per checklist rule id: MET-003 (one h1, one main, no skipped heading
  levels in document order), MET-001 and MET-002 (title and description present, one each, within hardMax), SE-202 (Bing minimums),
  MET-004 (warn range, WARN not FAIL), URL-009 (canonical present, absolute, self or agreeing with og:url and WebPage.url), IDX-004
  (robots.txt present, names the sitemap, disallows no page), IDX-001 and IDX-002 (sitemap.xml present, valid XML, absolute unique
  URLs, equals the set of indexable pages), SE-004 (lastmod format, wrapping the skill's built-in check), A11-007 (img alt), LNK-002
  (internal links resolve inside the folder, no nofollow on internal), SCH-001 (one ld+json block with @graph, parses, WebPage and
  WebSite nodes, Organization on the home page). Reuses the skill's `scripts/lib-site.mjs` reader (copied, with its origin noted)
  and `checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs`. Proves: a built site cannot pass the audit with a wrong
  heading structure, a missing title, description, canonical, robots, sitemap, alt or structured data, or a dead internal link; every
  verdict names the rule, the file and line, and the source; the tests prove each rule fires alone and the mutants prove each rule is
  load-bearing.
- Slice 2 (after slice 1): the live-URL mode (the skill's `snapshot-site.mjs` snapshot folder as a second input of the same reader;
  politeness rules of SKILL.md) and the speed budgets (PSI and CrUX by key name, thresholds with their vendor sources and dates).
  Proves: the same rule ids judge a live site and a built folder the same way; a slow page fails with a sourced threshold.
- Slice 3 (as soon as slice 1's call is documented; a brief, no code here): the command brief for `omnikom audit --dir <folder>`
  and `omnikom gate --dir <folder>` as thin calls into `tools/audit/` (sent through the head of operations to the CLI head). Proves:
  the CLI prints the library's lines unchanged and exits with its code; the publish gate wiring itself is build step 4 (platform
  build), which this department supplies with the gate call and its expected output.
- Slice 4: the six-question report as a generated document from the audit JSON (the skill's `report-live.mjs` wording), plain words.
  Proves: a report never states a number without its source line in the JSON.
- Slice 4b, design tells (DECISIONS 37; after slice 2 is committed, before the prompt map; not started, one builder brief):
  (1) copy the open skill unslop (github.com/heydamir/unslop, folder skills/unslop, CC BY 4.0, by Damir Sokolovsky) into
  `skills/unslop/` with its credit and licence kept, a row in `skills/SOURCE.md`, and `skills/unslop/` added to this charter's Owns;
  its scripts folder (story video, snapshot) is not copied (design-bench and the render gate exist). (2) A DSN rule family in
  `tools/audit` from its machine-checkable tells, same shape as the 17 rules (rules/<DSN-nnn>.md, checks/, a bad fixture, a test
  watched red, a mutant): looping or bouncy motion classes (animate-pulse, animate-ping, transition-all, hover:scale, shimmer);
  gradient text and hue-gradient backgrounds; emoji in labels or headings; uppercase tracked labels; hype words and "AI-powered"
  copy; exclamation marks in headlines; greeting headlines; PRO or Beta badges; unverifiable-claim patterns ("loved by N+ teams",
  "Nx faster"); font weight 700 or more under 14 px; negative letter spacing on small text. FAIL on the first six and the claim
  patterns; WARN where the engine cannot see computed styles, said so in the rule file. (3) The design stage (`stages/design.md`)
  requires the five-line direction (product, character, world, moments, signature; clean, modern, sleek, minimal and premium banned
  as character words) as the header of every look-folder's DESIGN.md and lists the nine passes (spacing, colour, icons, copy, type,
  layout, details, visuals, motion) as the builder's order of work; carried back through `node skills/sync-skill.mjs`. Done when:
  `node tools/audit/run.mjs tools/audit/fixtures/good` still exit 0; a new `fixtures/bad-DSN` folder exits 1 naming each rule; the
  mutant run catches every DSN mutant; the design stage text states the direction header as required. Proves: a built site that
  carries a design-slop tell does not publish, and every look-folder starts from a written direction.
- Slice 5, the prompt map (DECISIONS 35; backlog, first slice after build step 4 is proven; not started, no builder briefed): (1) the
  research stage of the skill writes a prompt map, one row per prompt with its scenario, comparison and constraint; whether the business
  is named in ChatGPT, Perplexity and Gemini (owner captures plus the Gemini check the skill already has, public and polite); the page
  cited; and ONE fix (new page, improve a page, earn a mention). Sources for the buyer's words: the client's own lead inbox messages (that
  workspace only, through a platform export the platform head provides, never a direct database read), reviews, and the forum questions
  already mined; a row without a source is not a row; no volume target. (2) The plan stage covers every row with a brief or a written
  reason; briefs may name two new page types, `situation` and honest `comparison` (public sourced facts about the other option only,
  Non-negotiable 3); the page types themselves are the platform head's in step 5. (3) The measure stage re-runs the map monthly.
  (4) Gate rule for `omnikom audit`: a build that leaves a prompt-map row uncovered without a reason fails, active only once the plan
  artifact exists. Proves: every built page traces to a prompt someone actually asks, and every prompt is covered or declined in writing.
- Findings from the slice 1 builder, for the skill copy (own files, through `node skills/sync-skill.mjs` after the fix lands in the outside
  source): (a) `scripts/lib-site.mjs` holds literal em dash characters (the `ENT.mdash` entry and comments); the audit's copy uses
  `String.fromCharCode(0x2014)`; (b) `parseHtml` keeps the LAST `<meta name=description>` and the LAST canonical while MET-002 and URL-009
  judge the FIRST (the audit's copy adds `descriptions[]` and `canonicals[]`); (c) `resolveInternal` drops PDF and image targets, which
  LNK-002 needs (the audit adds `resolveLink` in `lib/context.mjs`). Decision for slice 2: carry (b) and (c) back into the skill source
  first, then re-copy, so the two readers do not drift.
- Not covered by slice 1, by design (each check's `notCovered` list and rules file say so): the HTTP parts of IDX-004 (200, text/plain)
  and the browser parts of A11-007 (role=img names, axe button-name and link-name); both are slice 2 (live mode). IDX-003 runs as a
  WARN (checklist says P1) because its build-clock signature needs the sitemap's write time, which a folder copy does not keep reliably.
- Finding for the skill copy (own files, through sync): `checklist/*.md` lines are cut at about 260 characters by `build-checklist.mjs`,
  so the rule text with the numbers (`titleLength` 30/60/70, `descriptionLength` 70/160/180) lives only in the shipgate spec on D:.
  The audit's `rules/<id>.md` files carry the full text with the spec path and version (8.0.0) so no session needs D: again.

## Position log (append-only, newest last; one line per finished slice or blocked item: date, slice, PROVEN / BLOCKED, where the proof is)
- 2026-10-30: department created.
- 2026-10-30 20:25: head session `local_d0e65fa9-4a2d-4c74-a612-5d33cd189efe` (fable) oriented; charter Proof and Open items filled;
  slice 1 brief written (`tools/audit/briefs/slice-1-engine.md`). The app refused `start_session` for a builder from a session-given
  task ("start sessions only on the user's own words"), so the slice 1 builder runs as an in-session Sonnet agent (Agent tool, same
  brief; CLAUDE.md rule 4 default). It is not a sidebar session; the head re-runs its proof the same way. Nothing PROVEN yet.
- 2026-10-30 21:55: SLICE 1 PROVEN by the head's own re-run: tests 195 of 195, mutants 106 of 106 caught, good fixture all PASS exit 0,
  bad-MET-003 FAIL with line and source exit 1, 14 rules each sourced, 64 fixtures equal their generator. Proof lines:
  `docs/blueprint/PROGRESS.md` "SEO and audits, slice 1". Library call: `tools/audit/README.md`. Slice 3 command brief written:
  `tools/audit/briefs/slice-3-cli-command.md` (sent to the head of operations for the CLI head).
- 2026-10-30 23:30: skill reader fixes carried back through the source (`~/.claude/skills/...` commit 7d94c41: `lib-site.mjs` with line
  numbers and the new fields, `lib-lines.mjs`; `launch.mjs` path `sops/clients/launch.md`), source tests green (test-plan-gate 64 of 64
  mutants, test-rules 92 of 92, test-compare 37 of 37, test-phase1 52 of 52), synced with `node skills/sync-skill.mjs`, SOURCE.md row
  7d94c41. Blueprint 22 line 20 points at `sops/clients/launch.md`. Slice 2 brief `tools/audit/briefs/slice-2-live-and-speed.md`,
  Sonnet builder running (in-session agent). The audit's `lib/site.mjs` will diverge again in slice 2 (snapshot branch); carry back after.
- 2026-10-31 01:40: DECISIONS 35 (prompt map reaching the built pages) recorded as slice 5 in Open items, backlog after build step 4;
  not started. Slice 2 (builder running, mutant run settling) and the fail-open fix (empty or unknown rule id, folded into slice 2's
  brief from the CLI head's finding) stay first.
- 2026-10-31 05:25: DECISIONS 37 (unslop skill copy, DSN rule family, five-line direction in the design stage) recorded as slice 4b
  in Open items: after slice 2's commit, before slice 5; not started, no builder briefed. Slice 2 builder still running (mutant run
  182 lines, 34 survivors under rework after the laptop sleep).
- 2026-10-31 10:25: SLICE 2 PROVEN (head re-run by Haiku runners, outputs in `docs/blueprint/PROGRESS.md` under "slice 2: live snapshot"):
  332 of 332 checks; 185 mutants, 185 caught, 0 survived, 0 not run (harness now counts a killed child as NOT RUN, exit 1); rule set 14
  to 17 (SE-001, PRF-001, PRF-016 new; IDX-004 HTTP part, LNK-002 status part; CLI head told, the CLI reads the count from the engine);
  empty or unknown rule id is exit 2. Reader carried back to the skill (9e99708). Interpretations accepted: IDX-001 extra and missing
  both SKIP on a sample crawl; only status-200 pages go through page rules; file links not judged in a snapshot; only `complete: true`
  is a complete crawl. Skill findings carried (not fixed): `vitals` nesting in browser-mobile.json, robots saved via utf8 (U+FFFD),
  psi.mjs output outside the snapshot, sitemaps fetched[].status unjudged, test-snapshot gap timing fails under load. UNPROVEN: the
  real live-target.mjs on a real site; a real PSI file. Next: slice 4b (unslop).
- 2026-10-31 10:45: slice 4b started: brief `tools/audit/briefs/slice-4b-design-tells.md` (DSN-001 to DSN-011, rule set 17 to 28 when
  proven; five-line direction and nine passes in the skill's stages/design.md), Sonnet builder running (in-session agent). The unslop copy
  into `skills/unslop/` is a download and waits for the owner's yes in this session; the hype word list (DSN-005) grows from it.
- 2026-10-31 17:30: DECISIONS 43 binding from 4b on: before a commit the head reads the chain, a Haiku agent runs the gates on the
  combined tree, then the head commits and pushes (builders never do). The chain of `tools/audit` (grep, 2026-10-31): `factory/lib/gates.mjs`
  (the publish gate runs the audit on every built site: a new rule that fires on `sites/test-demo-a` or a factory fixture breaks the
  factory tests), `factory/test/run.mjs`, `factory/test/mutate.mjs`, `factory/runner/test/run.mjs`, `tools/omnikom-cli/commands/audit.mjs` and
  its tests (counts read from the engine), `docs/blueprint/specs/check-no-model.mjs`, `sites/test-demo-a/make-contract.mjs`, the skill copy's
  `lib-site.mjs`, `.github/workflows/ci.yml`. The pre-commit run is every node command of ci.yml: run-all-gates; factory test and mutate;
  factory runner test and mutate; tools/audit test and mutate; omnikom-cli `--unit`; departments check and tests; `clients/check.mjs`
  (Deno function tests only when supabase/functions changed).
- 2026-11-01 00:05: DECISIONS 45 binding: the full checks run on GitHub. The head builds the commit (`omnikom impact --commit` names the
  tests run on the laptop, on that commit's tree), pushes it to `check/seo/<slug>`, and fast-forwards master only when every ci.yml job
  is green on it. Slice 2 confirmed by GitHub's audit job on 3cd4bf0: 332 of 332, 185 mutants 185 caught 0 survived 0 not run.
- 2026-11-01 02:40: slice 4b.1 built (temp folders under one root per run and per mutant copy, a leak test; live.mjs stops the child's
  whole process tree on its time limit, SIGINT, SIGTERM and exit, with a test watched red: "grandchild pid 1684 still alive 5 s after
  live.mjs ended"). Laptop: test/run.mjs 486 of 486. Mutants and the POSIX tree kill run on GitHub (check branch). A hard kill of a
  driver runs no code: the skill's browser launcher gets a parent-death watchdog (outside copy, another builder; synced when done).
- 2026-11-01 04:05: skill 83c1fe6 synced: cdp-measure.mjs stops the browser tree and removes its profile on close, give-up and an exit
  guard (fix by the head of operations' builder); test-browser-leftovers.mjs (this department's builder) watched red on the old file
  ("FAIL b: exit profile folder still exists", "FAIL c: uncaught ..."), head re-run through heavy.mjs: OK: 4 of 4; test-main 10 of 10.
- 2026-11-01 05:00: PROVEN, the first real live run (live.mjs on https://preview.test-site-demo-a.pages.dev/, master 73803db): 6 pages,
  11 requests, 0 rate-limit responses, 28 rules, 0 FAIL, 0 WARN, 4 SKIP (speed UNTRUSTED, machine busy); PROGRESS "the first real live
  run". Closes the live-target UNPROVEN of slice 2; a trusted lab speed and a real PSI file stay UNPROVEN. FINDING for slice 4c: the
  `x-robots-tag` header is never read (meta robots only), so a header-noindexed site passes IDX-001.
- 2026-11-01 07:05 HANDOVER (owner's order via head of operations; outgoing head `local_d0e65fa9...`, Opus 5.5, context 350k with 3
  compactions; incoming head HEAD_SEO-and-audits_2026-11-01; report to HEAD-OF-OPERATIONS_Omnikom_2026-11-01).
  - Master: a0c544d (the first real live run). Landed this session, each CI-green on a check branch (DECISIONS 45): 4d16ec1 slice 4b,
    056d0d6 slice 4b.1, 73803db skill sync 83c1fe6, a0c544d live-run record. No check branch of this department is open.
  - IN FLIGHT, NOT DONE: slice 4c (brief `tools/audit/briefs/slice-4c-noindex-header.md`). Its Sonnet builder died on an API
    connection error at 06:3x, mid-fix; nothing is committed. Uncommitted in this checkout: `tools/audit/` README.md, index.mjs,
    lib/context.mjs, lib/site.mjs, live.mjs, run.mjs, test/run.mjs, test/mutate.mjs, fixtures/build-fixtures.mjs and new fixtures;
    new checks/env-001.mjs, rules/ENV-001.md, lib/headers.mjs; the skill SOURCE `scripts/lib-site.mjs` (x-robots-tag read, same text
    as tools/audit/lib/site.mjs), uncommitted in the skill repo. Last builder outputs before the fix: test/run.mjs 545 of 545,
    build-fixtures 127, 45 new mutants 45 caught, 29 rules, good --target production and good-preview --target preview 0 FAIL;
    `node factory/test/run.mjs` FAILED 1 of 88 because a no-target run printed "SKIP ENV-001 (no target)".
  - Head's decision for that red (sent to the builder, partly applied): with no target ENV-001 prints NOTHING (`checks/env-001.mjs:18`
    now `if (!site.target) return [];` is in place); still to do: revert the builder's edits to existing tests that allowed one
    no-target SKIP, flip the isNT expectations to zero, a test and mutant that a no-target run of bad-ENV-001-preview prints no
    ENV-001 line, a mutant "no target judged as production", README "a run with no target does not judge indexing", and the proof
    file `tools/audit/proof/4c.md` (not written). Then re-run test/run.mjs, build-fixtures --check, factory/test/run.mjs (must be 88
    of 88), tools/omnikom-cli/test/run.mjs --unit (lines 268/273/285 expect 0 SKIP), MUTATE_ONLY through heavy.mjs; commit the
    skill repo, sync by a Haiku runner, commit in a private index (the shared index holds other heads' staged files), push
    check/seo-and-audits/4c, land on green.
  - NOTICE sent (via head of operations) to the platform head: after 4c lands, the runner calls `node tools/audit/run.mjs <work>/dist
    --target <preview|production>` and factory/test/run.mjs calls `AUDIT.audit(dir, { target })`. When their change lands: flip
    `REQUIRE_TARGET_FOR_FOLDER` in `tools/audit/index.mjs` to true (a no-target folder run becomes exit 2), on its own check branch.
    The CLI's `omnikom audit` also needs `--target` (CLI head; notice not yet sent).
  - QUEUE after 4c: the --target flip above; then slice 5, the prompt map (DECISIONS 35; head of operations: reach prompt-map rows
    with scenario/comparison/constraint, named and cited checks with one fix each, the `situation` and `comparison` page types, a
    gate over the rows, the monthly measure stage); its brief is NOT WRITTEN and its research agent died on the same API error (start
    a fresh read-only research agent); then slice 4, the six-question report.
  - OPEN FINDINGS: a trusted lab speed and a real PSI file UNPROVEN; skill carried: vitals nesting in browser-mobile.json, robots
    saved as utf8 (U+FFFD), psi.mjs output outside the snapshot, sitemaps fetched[].status unjudged, test-snapshot gap timing under
    load; clean-launch-guard refuses read-only commands that name the session scratchpad path (`\Temp\claude\...`), reported;
    `skills/SOURCE.md` and `skills/sync-skill.mjs` were flagged unowned by omnikom impact (now head-of-operations per impact).
- 2026-11-01 07:50: head HEAD_SEO-and-audits_2026-11-01 (opus) took over; handover a0266ca landed (run 41276813381, 9 of 9 green).
  RULING (head of operations, 07:30, overrides the outgoing head's "print nothing"): a run with no target prints exactly ONE
  `SKIP ENV-001 ... no --target` line (a check that did not run is never silent); the factory and CLI test literals that expected no
  SKIP change in the 4c commit as a DECISIONS 43(2) light follow-on, owners named. 4c finish: brief `tools/audit/briefs/slice-4c-finish.md`,
  Sonnet builder running. Standing order: builders start as their own sessions through a clean launcher (start-builder.mjs once landed);
  `node tools/departments/context-load.mjs` at each slice boundary; start nothing new at 90% weekly usage.
- 2026-11-01 09:50: SLICE 5a PROVEN in the skill SOURCE (commit e3cfb65; brief `tools/audit/briefs/slice-5-prompt-map.md`, facts
  `slice-5-facts.md`, proof `tools/audit/proof/5a.md`); head re-run: test-prompt-map 72/72, mutants 62/62 red for the right reason,
  test-main 10 of 10, 0 em dashes. Head's rulings: a lead source carries no quote; candidates in `<pewp>/private/` (.gitignore `*`);
  --check refuses 8+ consecutive words of a lead quote. UNPROVEN: paraphrase not caught; a real lead export; a live Gemini run.
  NOT YET IN THE REPO: sync waits for 4c's skill change (`scripts/lib-site.mjs`, uncommitted in the source; sync-skill copies the
  working tree), then ONE sync and SOURCE.md row for both. Builder BUILDER_seo_5a-prompt-map done (archive).
- 2026-11-01 10:18: BLOCKED (owner click): GitHub Actions minutes for 2026-11 used up (Free plan, 2000 min), spending limit stops
  new jobs. Until the head of operations says billing is fixed: land nothing, no local full gates as a substitute (DECISIONS 45),
  one push per finished slice at most, re-run red runs with `gh run rerun <id>`. 5b builder BUILDER_seo_5b-plan-coverage running.
- 2026-11-01 12:25: SLICE 5b PROVEN in the skill SOURCE (commit 120204c; proof `tools/audit/proof/5b.md`); head re-run through a Haiku
  runner: test-prompt-plan 66/66 + 39/39 mutants, test-plan-gate 313/313 + 64/64, test-launch exit 0, test-prompt-map 72/72 + 62/62,
  test-main 10 of 10, 0 em dashes. Coverage file `plan/prompt-coverage.json` { map, rows[{id, coveredBy, kind, reason}] } is what 5c
  reads. Builder's out-of-list edits accepted (isIsoDate fix, GT count 13 to 14, approve kind prompt-map, docs). UNPROVEN: a real
  map; platform page types situation and comparison (step 5); prompt pages linked from home only. Repo sync still waits for 4c.
  Next: 5d (measure + blueprint 22; independent of tools/audit) while 4c finishes; 5c after the 4c builder is done.
- 2026-11-01 13:00: report line changed: the head of operations is now HEAD-OF-OPERATIONS_Omnikom_2026-11-01b. 5d builder
  BUILDER_seo_5d-measure running; 4c finish builder (in-session agent of this head) running.
- 2026-11-01 14:20: QUEUED (DECISIONS 47, low priority, after 4c and the --target flip): 32 SEO files name a client (mostly the skill
  and two audit briefs) and stay off the public check copy. List: `planning/anonymise-list.md` section seo-and-audits; neutral names:
  `planning/anonymise-map.md` (private). Skill files change in the SOURCE, then sync and a SOURCE.md row. Done when the next copy dry
  run shows zero client-named SEO files; report that line. One builder brief. Map rules added 14:37: clients/<slug>/ folders are
  never renamed; a public file never points at a clients/<slug>/ path or an outside client folder path; read the map's "Extra terms".
- 2026-11-01 14:50: HANDOVER (outgoing head HEAD_SEO-and-audits_2026-11-01, context about 245k; incoming head reports to
  HEAD-OF-OPERATIONS_Omnikom_2026-11-01b).
  - 4c BUILT AND RE-RUN, NOT COMMITTED (brief `tools/audit/briefs/slice-4c-finish.md`, proof `tools/audit/proof/4c.md`). Head re-run by
    a Haiku runner on the working tree at 14:45: test/run.mjs `OK: 546 of 546`; --list 29 rules; build-fixtures `OK: 127 fixture(s)`;
    good no target exit 0 with exactly `SKIP ENV-001 / no --target, so indexing is not judged`; good --target production 0 FAIL; good-preview
    --target preview 0 FAIL; snapshot-bad-IDX-001-header exit 1 FAIL IDX-001; --target staging exit 2; factory/test/run.mjs `OK: 88 of 88`.
    `node tools/omnikom-cli/test/run.mjs --unit` `OK: 373 of 373 checks passed` (head re-run, 14:53). MUTATE_ONLY by the builder: 4 of 4
    caught. Full mutate.mjs and run-all-gates: on GitHub only.
  - THE 4c COMMIT (head builds it in a PRIVATE index; the shared index holds other heads' staged files): tools/audit/** (includes the briefs
    slice-4c-finish, slice-5-prompt-map, slice-5-facts and proofs 4c, 5a, 5b); this charter; ONLY the SEO blocks of
    docs/blueprint/PROGRESS.md (4c, 5a, 5b; the file has 118 new lines, other departments' blocks too); the light follow-ons
    `factory/test/run.mjs:317` (platform; the working copy has CRLF line endings: commit it LF) and `tools/omnikom-cli/test/run.mjs`
    lines ~349 and ~354 ONLY (CLI; the file carries 281 lines of the CLI head's own in-flight edits: take HEAD's blob plus those two
    literals, never the rest). Owners named in the message; the head of operations notifies platform and CLI when it is on its check
    branch. Push once to `check/seo/4c-noindex-header`. Landing is BLOCKED on GitHub Actions minutes (entry 10:18); when billing is fixed:
    `node tools/omnikom-cli/omnikom.mjs land check/seo/4c-noindex-header` (rebase on master first if master moved; master was c2811ee).
  - THEN the skill: commit `scripts/lib-site.mjs` (4c's x-robots-tag read, uncommitted in the SOURCE; same text as tools/audit/lib/site.mjs)
    in the skill SOURCE repo, then ONE `node skills/sync-skill.mjs programmatic-enterprise-web-performance` (Haiku runner) covering 5a
    e3cfb65, 5b 120204c and that commit, a `skills/SOURCE.md` row, its own check branch. The sync copies the working tree: it must be clean.
  - THEN: tell the head of operations 4c is on master; after the platform runner passes --target, flip `REQUIRE_TARGET_FOR_FOLDER` to true
    in `tools/audit/index.mjs` on its own branch. The CLI's `omnikom audit --target` needs a notice to the CLI head (not sent).
  - SLICE 5: 5a and 5b PROVEN in the skill source (entries above). 5d builder `BUILDER_seo_5d-measure` running (brief section 5d; reports
    to this head's name: the incoming head re-tells it its head by SendMessage). 5c (tools/audit PMP-001, `--prompt-coverage`) NOT STARTED:
    start it after the 4c commit, from the brief's 5c section; its SKIP needs the same follow-on literals as ENV-001's.
  - NOTICES NOT YET SENT (slice 5, to the head of operations for the platform head): a read-only one-workspace text-only lead export for
    research; page types situation and comparison (entities.json, partials, step 5); the runner passes --prompt-coverage; the ai-answers
    writer and named/cited dashboard rows. Owner clicks for the list: PEWP_GEMINI_TERMS_ACK, the monthly schedule, AI answer captures,
    GitHub Actions billing.
  - FINDINGS: the skill's `stages/compare.md:38` has an em dash (older than slice 5); a `grep -c` with printf for the em dash returned 0 on a
    file that had two (use a node counter: String.fromCharCode(0x2014)); the 4c builder ran from 07:30 to 14:30, mostly waiting on the heavy
    lock (`--wait-min 120` needed). Queue after slice 5: anonymising (entry 14:20), then slice 4 (the six-question report).
- 2026-11-01 15:00: head HEAD_SEO-and-audits_2026-11-01b (opus) took over from the 14:50 block; reports to HEAD-OF-OPERATIONS_Omnikom_2026-11-01b.
  Corrections from the head of operations: landing waits on the DECISIONS 46 public code-only copy (CLI department), no longer on
  billing; land with `omnikom land` once that copy runs green, rebased on master. Anonymising (DECISIONS 47) stays low priority, after
  4c, --target and slice 5. BUILDER_seo_5d-measure re-told its head.
