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
- Model: sonnet unless a slice is design-heavy (then the head does it, or an opus builder). Start every builder with
  `start-builder.mjs ... --effort high` (head of operations, 2026-11-01 20:48: the machine default effort is low); a running builder
  keeps its effort and is replaced at a slice boundary only if it struggles.
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
- Finding (LOW, head of operations 2026-11-02 05:01; after the 4c flip): `tools/audit/test/mutate.mjs` prints nothing until its final
  summary, so a slow run cannot be told from a hung one and no ETA can be given (pid 28520 held heavy.mjs 1h50 on the whole list and
  was stopped 04:58). Wanted: one line every 25 mutants, "mutants: N of M, caught C, elapsed S s"; a test watched red and a mutant.
  Rule from the same event: a builder runs only its new mutants locally (MUTATE_ONLY); the whole list runs on CI.

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
- 2026-11-01 15:09: 4c COMMITTED AND PUSHED, NOT LANDED: 83a410b (parent c2811ee, built in a private index; tree 71fbeba) on
  `check/seo/4c-noindex-header` (backup-gh). gitleaks protect --staged on that index: no leaks; 67 files, 0 CR, 0 em dashes. Haiku
  runner on a detached worktree of 83a410b: tools/audit test/run.mjs OK: 546 of 546; --list 29; build-fixtures OK: 127; good no
  target 1 SKIP ENV-001 exit 0; good-preview --target preview 0 FAIL; bad-ENV-001-preview 4 FAIL ENV-001; factory/test/run.mjs OK:
  88 of 88; omnikom-cli --unit OK: 356 of 356 (HEAD's blob plus the two literals). Mutants, factory runner, ci-heavy, actionlint and
  run-all-gates: on the D46 copy run (UNPROVEN until then). Landing: `omnikom land` after the D46 copy runs green, rebased on master.
- 2026-11-01 15:15: builders started with start-builder.mjs: BUILDER_seo-and-audits_skill-sync (pid 1428) and
  BUILDER_seo-and-audits_5c-publish-rule (pid 27296, brief sent; builds on the 4c working tree, commit on top of 83a410b). Sync HELD:
  the SOURCE also holds 5d's uncommitted files (SKILL.md, scripts/measure.mjs, stages/measure.md, scripts/test-measure-prompts.mjs);
  sync-skill copies the working tree, so ONE sync runs after 5d is committed in the SOURCE (covers 4c lib-site.mjs, 5a, 5b, 5d and the
  compare.md:38 em dash fix). The head commits lib-site.mjs and compare.md alone in the SOURCE first.
- 2026-11-01 15:17: notices slotted by the head of operations. CLI: `audit --target` in its "small CLI fixes" slice after seed-test
  lands (reverts 83a410b's two CLI literals; the CLI head tells this head); `--prompt-coverage` after its 2b, once 5c is on master.
  Platform: 5-E runner `--target` after 5-W and 5-A (head of operations says when it is on a check branch; then the
  REQUIRE_TARGET_FOR_FOLDER flip); 5-P1 `--prompt-coverage` once 5c's format is on master; page types, lead export, ai-answers
  writer after step 5's done-when (5-P2 to 5-P4; the last needs 5d's shape in blueprint 22 on master).
- 2026-11-01 15:24: stopped with stop-builder.mjs, nothing left: BUILDER_seo_5a-prompt-map (pid 18152), BUILDER_seo_5b-plan-coverage
  (pid 26696). BUILDER_seo_5d-measure (pid 17048) is SWAP at 302k (context-load 15:20): asked for a handover note at the end of
  tools/audit/proof/5d.md at its next boundary; then stop it and, if 5d is not done, start a fresh builder on the note.
- 2026-11-01 15:33: skill-sync builder: compare.md:38 em dash fixed in the SOURCE; SOURCE tests test-main 10/10, test-plan-gate 313/313,
  test-rules 121/121, test-compare 37/37, test-phase1 52/52. Head authorised the builder to commit ONLY scripts/lib-site.mjs and
  stages/compare.md in the SOURCE (outside repo, no push). FINDING, QUEUED as its own slice (after anonymising): 50 older em dash lines
  in the SOURCE (checklist/*.md 21, runs/2026-10-25-overhaul.md 6, scripts 19, fixtures/serp-html 2, coordinator.md 1,
  rules/industries/editorial-media.json 1); the checklist copies come from build-checklist.mjs and the shipgate spec, fix there. Sync
  done-condition: the folder's em dash count does not rise.
- 2026-11-01 15:35: 5d BUILT, NOT FULLY VERIFIED (builder's lines: test-measure-prompts 45/45, its mutants 24/24, test-measure 140/140;
  test-measure --mutants, test-main, test-prompt-plan in flight; an earlier killed batch showed measure mutants 40/41, survivor unnamed).
  Handover note: tools/audit/proof/5d.md. The builder finishes only its in-flight runs, reports, and is stopped; a fresh builder takes the
  note for whatever is left. Finding routed to platform via the head of operations: metrics_snapshots PK (workspace_id, source, day)
  cannot hold one row per prompt per engine per month; blueprint 22 section 7 proposes one row per run day.
- 2026-11-01 15:36: SOURCE d7997a3 (head checked: 2 files, scripts/lib-site.mjs +28 and stages/compare.md 1 line; status shows only
  the 5d files). Sync still held for 5d.
- 2026-11-01 15:42: platform RULING on the 5d finding (5-P4, via head of operations): one metrics_snapshots row per workspace per run
  day, source 'ai-answers' (already in its CHECK), the per-prompt per-engine rows inside `data` jsonb; no new table, no PK change; 5-P4's
  migration adds a CHECK refusing an ai-answers row without prompt id, engine, named, cited, asked_at and an evidence URL or dated
  excerpt. TODO for the fresh 5d builder: blueprint 22 section 7 says exactly this (and the skill's measure writer emits that shape).
- 2026-11-01 15:49: report line changed: head of operations is now HEAD-OF-OPERATIONS_Omnikom_2026-11-01c. Context-load 15:47: this
  head 164k = WATCH (plan the handover at the end of the current slice: 5d plus the sync); BUILDER_seo_5d-measure 316k SWAP.
- 2026-11-01 15:56: 5d-measure's last runs: test-measure 140/140; test-measure --mutants 40/41, the non-red one `main-check-exact-path`
  "PATCH DID NOT APPLY" (test-measure.mjs:59, stale target in measure-sources.mjs, older than 5d: a mutant that measures nothing);
  test-main and test-prompt-plan NOT RUN (heavy.mjs exit 75 "cannot read this process's creation time (pwsh)"). Stopped (pid 17048,
  left []). Fresh BUILDER_seo-and-audits_5d-finish (pid 12096) briefed: blueprint 22 section 7 + writer to the 15:42 ruling, fix the stale
  mutant to 41/41, re-run the neighbours; no commit until the head authorises exact paths.
- 2026-11-01 16:35: CHANGE OF COURSE (DECISIONS 49, owner): the real repo is PUBLIC since 16:31 (gh: visibility PUBLIC) and GitHub runs
  jobs again; the D46 copy is parked. 4c run 41309893821 (83a410b) was `failure` (no minutes); `gh run rerun` sent 16:35; land under the
  land lock when green, no D46 wait. Anonymising (DECISIONS 47 list) PARKED. Rule 49 (d): no new client personal data (phone, email, home
  address) goes into the repo.
- 2026-11-01 17:05: run 41309893821 rerun on 83a410b: success, 9 of 9 jobs. Master had moved to 713b008 (platform 5-H), so 4c was
  cherry-picked clean onto it as f75cc64 (same 67 files), pushed to check/seo/4c-noindex-header (lease on 83a410b), and
  `omnikom land check/seo/4c-noindex-header` started (waits for f75cc64's run, then fast-forwards master).
- 2026-11-01 17:20: SLICE 4c LANDED: master f75cc64 (backup-gh), run 41319446394 9 of 9 jobs success, land lock taken and released.
  The shared checkout's local master still points at c2811ee (land does not touch it; other heads' uncommitted work is in it): build the
  next SEO commit in a private index on `backup-gh/master`, not on HEAD. Next for 4c: the REQUIRE_TARGET_FOR_FOLDER flip after platform
  5-E is on a check branch (head of operations says when).
  Correction 17:26 (head of operations): the flip goes when platform 5-E is on MASTER (the head of operations or the platform head sends
  the sha); the shared checkout's local master is the head of operations' to move, never this head's.
- 2026-11-01 18:13: owner's order (via head of operations): stop each builder as soon as its report is accepted; never leave one idle.
  Stopped BUILDER_seo-and-audits_skill-sync (pid 1428, left []): its part is done (SOURCE d7997a3, compare.md fixed, SOURCE tests green);
  the sync itself restarts as a fresh builder (or Haiku runner) when 5d is committed in the SOURCE, done-condition from 15:33.
- 2026-11-01 18:22: report line changed: head of operations is now HEAD-OF-OPERATIONS_Omnikom_2026-11-01d. Context-load 18:18: this
  head 186k WATCH; HANDOVER block planned at the end of the current slice (after 5d, the sync and 5c are accepted).
- 2026-11-01 19:10: platform FINDING (via head of operations 01d): the shared tree's factory/test/run.mjs ~317 holds 5c's uncommitted
  PMP-001 SKIP allowance (CRLF); "SEO does not edit factory/". Answered: SEO needs it (without it 5c's factory job is red); options sent:
  (a) in the 5c commit as a DECISIONS 43(2) light follow-on, LF, on master's blob (recommended, as 4c); (b) platform lands it first in
  its own slice. WAITING for the head of operations' pick before building the 5c commit.
  RULED 19:10 (head of operations 01d): (a). The allowance rides in the 5c commit as a DECISIONS 43(2) light follow-on, LF, on
  master's blob; the report names factory/test/run.mjs with platform as owner (platform-c told by the head of operations). If platform
  5-E lands first and touches that region: rebase 5c and keep both lines.
- 2026-11-01 19:20: SLICE 5c BUILT (builder's lines; proof tools/audit/proof/5c.md): audit tests 574 of 574; 30 rules; build-fixtures
  OK 130; good-coverage 0 FAIL; good with no file one SKIP PMP-001 and one SKIP ENV-001, exit 0; bad-PMP-001-uncovered and
  bad-PMP-001-missing-page exit 1 naming the row id and path; bad coverage file exit 2; factory 88 of 88; CLI --unit 373 of 373; 28 new
  mutants caught (MUTATE_TIMEOUT_S=900 under load). Light follow-ons (DECISIONS 43(2), ruled 19:10): factory/test/run.mjs:317 (platform),
  tools/omnikom-cli/test/run.mjs:349 and 354 (CLI). The head builds the commit on backup-gh/master in a private index and re-runs on it.
- 2026-11-01 20:00: 5c ACCEPTED. Commit 90e9c6f on 3d7c0c3 (private index; 42 files, 0 CR, 0 em dashes, gitleaks no leaks; 5d excluded;
  PROGRESS gets the 5c block only). Haiku runner on a detached worktree of 90e9c6f: audit 574 of 574; 30 rules; fixtures OK 130; good
  no file 2 SKIP (ENV-001, PMP-001) exit 0; good-coverage 0 FAIL; bad-PMP-001-uncovered FAIL pm-5e6f7a8b exit 1; bad-PMP-001-missing-page
  FAIL pm-1c2d3e4f /tasting-room/best-chai/ exit 1; README as coverage file exit 2; factory 88 of 88; CLI --unit 373 of 373. Builder
  stopped (pid 27296, left []). Master had moved to 9800616 (platform 5.4): cherry-picked clean as fef13c5, pushed to
  check/seo/5c-publish-rule, `omnikom land` started.
- 2026-11-01 20:28: platform 5-E (ENV-001 --target) is on check/platform/5-e (18be0f4 on 9800616). Whichever of 5c and 5-E lands second
  rebases: 5-E's good-build check allows no SKIP ENV-001; 5c's PMP-001 allowance goes next to /^(PASS|WARN) / in factory/test/run.mjs.
  Flip brief written: tools/audit/briefs/slice-4c-flip.md. It needs BOTH 5-E on master AND the CLI's `omnikom audit --target`
  (tools/omnikom-cli/commands/audit.mjs:26 refuses --target today, so the flip alone would make every `omnikom audit --dir` exit 2).
  Builder starts when both shas arrive.
- 2026-11-01 20:30: 5c LAND REFUSED (master untouched): run 41334355649 on fef13c5, audit job red: "425 mutants, 421 caught, 0 survived,
  0 not run, 4 target text missing" (index.mjs psi, run.mjs --psi, live.mjs --psi, index.mjs target: 5c rewrote the pass-through lines).
  Lesson: a slice that edits a line older mutants patch must run the whole list's target-text check, not only MUTATE_ONLY for its new
  mutants. Fix builder BUILDER_seo-and-audits_5c-mutant-targets (pid 13232): repoint the four in test/mutate.mjs, run them, prove 0
  target text missing over the whole list. Then rebuild 5c on master with it and land.
- 2026-11-01 20:47: 5d ACCEPTED (builder's lines, all through heavy.mjs): test-measure-prompts 55/55 + mutants 34/34; test-measure 140/140,
  --mutants 41/41 (main-check-exact-path retargeted to lib-main.mjs, red for the right reason); test-prompt-map 72/72 + 62/62;
  test-prompt-plan --no-mutants 66/66; test-main 10 of 10; 0 em dashes in touched files. Blueprint 22 section 7 and the writer follow the
  15:42 ruling (measure/<date>/ai-answers.json, data.rows with promptId, engine, named, cited, asked_at, evidence; a row missing any is
  refused, watched red). SOURCE commit authorised for SKILL.md, scripts/measure.mjs, stages/measure.md, scripts/test-measure-prompts.mjs,
  scripts/test-measure.mjs. Finding routed to platform 5-P4: evidence is a dated file pointer and named/cited may be null; the CHECK must
  accept both. Next: one sync (fresh builder) with the head's re-run on the repo copy, then the 5d commit (blueprint 22, skill copy,
  SOURCE.md row, proof 5d, PROGRESS 5d block, charter).
- 2026-11-01 20:50: SOURCE 77aee20 (head checked: 5 files, 561+/20-; status clean). BUILDER_seo-and-audits_5d-finish stopped (pid 12096,
  left []). Sync builder BUILDER_seo-and-audits_skill-sync-2 (pid 18040) briefed: one sync to 77aee20 (covers 4c d7997a3, 5a, 5b, 5d),
  SOURCE.md row only, em dash count must not rise, five skill tests re-run from the repo copy.
- 2026-11-01 21:18: mutant fix ACCEPTED (head read the diff: the same behaviour removed, anchors extended for promptCoverage):
  MUTATE_ONLY 4 of 4 caught; whole list 425 mutants, 0 target text missing; run.mjs 574 of 574; builder stopped (pid 13232, left []).
  Skill sync ACCEPTED: repo copy = SOURCE 77aee20 (22 copied, 0 removed), SOURCE.md diff only this skill's row, em dashes 79 to 74,
  repo-copy tests main 10/10, measure-prompts mutants 34/34, measure 140/140, prompt-map mutants 62/62, prompt-plan 66/66; builder stopped
  (pid 18040, left []). 22 paths uncommitted: committed with blueprint 22 as the 5d commit after 5c lands.
  Platform 5-E LANDED (master e92684e, run 41338148094). 5c rebuild on e92684e: worktree E:\omk-wt-seo-5c, cherry-pick --no-commit of
  fef13c5, one conflict (factory/test/run.mjs); builder BUILDER_seo-and-audits_5c-rebase (pid 20748, effort high) resolves it (5-E lines
  kept, PMP-001 allowance next to /^(PASS|WARN) /), adds the mutant fix, re-runs. Flip builder starts on master after 5c lands (same
  files); the flip lands after sha 2 (CLI `omnikom audit --target`).
- 2026-11-01 21:19: LAND ORDER (head of operations): platform 5-W, then CLI small-fixes (sha 2, carries `omnikom audit --target`), then
  SEO 5c, then the head of operations. Do not start a 5c land before the CLI's master sha is relayed. Expect a second rebase of 5c on
  that sha: small-fixes edits tools/omnikom-cli/test/run.mjs where 5c's two literals (349, 354) sit; keep the CLI's lines and add only
  the PMP-001 SKIP allowance.
- 2026-11-01 21:28: 5c REBASE ACCEPTED: dd22555 on e92684e (worktree E:\omk-wt-seo-5c, kept for the next rebase), pushed to
  check/seo/5c-publish-rule (lease on fef13c5); 42 files, 0 CR, 0 em dashes, gitleaks no leaks. Builder's worktree lines: audit 574 of
  574, 30 rules, fixtures 130, factory 88 of 88 (PMP-001 allowance watched red 1 of 88 when removed), runner 75 of 75 (media checks
  skipped: sharp not installed, UNPROVEN as for 5-E), CLI --unit 373 of 373, 425 mutants 0 target text missing, the four retargeted
  caught. Head read the factory diff (one check line). Builder stopped (pid 20748). GitHub run on dd22555 watched as an early signal;
  NO LAND until the CLI small-fixes sha is relayed (then rebase on it and land).
- 2026-11-01 21:54: run 41341833182 on dd22555: success, 9 of 9 jobs (audit engine tests and mutants included). Held for the CLI sha.
- 2026-11-01 21:56: LAND ORDER (head of operations): CLI small-fixes, then SEO 5c+5d stacked on one check branch and landed with one
  run, then the head of operations' effort commit, then platform 5-L. 5d commit (blueprint 22, the skill copy at SOURCE 77aee20, proofs 5d
  and skill-sync, the flip brief, PROGRESS 5d block, this charter; the skills/SOURCE.md row is a light follow-on in the head of
  operations' file) built on dd22555 in E:\omk-wt-seo-5c.
- 2026-11-02 02:45: PROVEN 5c+5d on master 7690b59 (head HEAD_SEO-and-audits_2026-11-02): rebuilt on 41f6866 as 37b70f1 + 7690b59
  (no conflicts; CLI test lines 350/355 the PMP-001 allowance only); head's re-run audit 574/574, fixtures 130, factory 88/88, CLI
  --unit 427/427, gitleaks clean; run 41364432148 attempt 1 red on the D50 port flake (functions harness 55402), attempt 2 9 of 9.
- 2026-11-02 05:01: 4c flip IN PROGRESS: BUILDER_seo-and-audits_4c-flip (pid 32908) on check/seo/4c-flip at 7690b59 in
  E:\omk-wt-seo-5c. Land: the CLI lines it touches go to CLI-d for a yes (head of operations copied); queued behind platform 5-L and
  5-PORT, rebased on master at push. Whole-list mutant run stopped at 04:58 (see Open items); only the new mutant re-runs locally.
- 2026-11-02 20:08: HANDOVER (head HEAD_SEO-and-audits_2026-11-02b, Opus 5.5, context about 190k WATCH; reports to
  HEAD-OF-OPERATIONS_Omnikom_2026-11-02e).
  - IN FLIGHT: nothing. No builders running. Master ae8741d holds the flip (f4a3996 flip, dc00546 skill stage design.md
    `--target preview`, 38f176b audit test helper fix, ae8741d CLI refusal tests). Worktree E:\omk-wt-seo-5c is at ae8741d, clean;
    remove it or reuse it for slice 4.
  - LESSON (keep): a switch that makes an option required can make refusal tests pass for the wrong reason (exit 2 from the
    new requirement). Both survivors this time were that: audit `cli()` appended `--target` at the end so a bare
    `--prompt-coverage` swallowed it; CLI refusal tests ran with no target. The local suites were green both times; only the
    full mutant runs in CI saw it. For a flip, refusal tests assert their own message, and the mutant set runs before the push.
  - NOT SENT: the CLI head asked for the caught line of "cli mutant 4c-flip"; it is "caught audit and gate: a built folder with
    no --target is given a default target [4c-flip]" / "1 mutants, 1 caught, 0 survived" (head read 16:09), plus CI's CLI job
    green on ae8741d. Send it to the current CLI head.
  - NEXT: slice 4 (the six-question report). Then the LOW finding: mutate.mjs progress line every 25 mutants (Open items).
    Weekly usage 92% (cap 95%): the head of operations decides whether slice 4 starts before the reset (Wed 18:00).
  - NOTE: this shared-tree charter is not master's; master's copy carries the flip commit's charter lines only. Reconcile on the
    next charter commit (master's text plus the blocks from 2026-11-01 14:50 onward here).
- 2026-11-04 17:06: HANDOVER (head HEAD_SEO-and-audits_2026-11-04, Opus 5.5, context 188k WATCH, swap at 209k; reports to
  HEAD-OF-OPERATIONS_Omnikom_Platform).
  - LANDED: work order 05 audit results, master d6076e8 (CI run 41845803027, 9 of 9): skill paths moved to code\main (outside copy
    3cbe331, synced, SOURCE.md row), `tools/audit/summary.mjs` + `run.mjs --summary` (v1, under 60 KiB, byte budget besides the
    200 fails / 300 characters caps), 13 new checks (589 of 589), 11 new mutants caught. Head re-ran: test/run.mjs 589 of 589 exit 0;
    `--summary` on bad-MET-003 one object pass false exit 1; `--summary --json` exit 2. Worktree and branch removed, builder stopped.
  - ROUTED: the Search health spec is in `docs/product/6-dashboard.md` (0d4f588, platform). F1 (runner stores the summary in
    gate_report.audit) and F2 (per-site read + function) are platform-build's, after crm-2 (landed). Lesson sent for the CLI head:
    `omnikom land` keeps its lock on a GitHub 500 and a rerun then waits on its own lock.
  - RULE (head of operations, 2026-11-04 12:35, docs/departments/README.md rule 8 on master): locally run only the suites a change
    touches; full run-all-gates and mutant lists run on CI; a land needs that green CI run. Every branch regenerates icm/ in its own
    commit before its CI run (CI checks it since 293e7fb). Heads never build, small fixes included.
  - NEXT 1: work order 06, plain-word names: one table in tools/audit/ (family prefix -> plain name; each rule id -> one plain
    sentence of what is wrong), read by the Search health page and by the six-question report; a test that every rule in
    `run.mjs --list` has a name, with a mutant. Card 1 of the spec names the families.
  - NEXT 2: slice 4, the six-question report as a generated document from the audit JSON (the skill's `report-live.mjs` wording).
  - THEN: the LOW finding, mutate.mjs progress line every 25 mutants.
  - CHARTER: this block goes into docs/departments/seo-and-audits.md (position log, last) in the first commit of work order 06.
- 2026-11-04 19:40: head HEAD_SEO-and-audits_2026-11-04b (opus) took over from the 17:06 block; reports to HEAD-OF-OPERATIONS_Omnikom_Platform.
  Work order 06 (`work/06-plain-names/CONTEXT.md`): `tools/audit/names.json` (11 topics, one plain sentence per rule), `names.mjs`, the
  summary's `byTopic`; builder BUILDER_seo-and-audits_plain-names (pid 35820, sonnet, effort high). Head re-run: test/run.mjs "OK: 599 of
  599 checks passed"; bad-MET-003 `--summary` pass false, byTopic.headings.FAIL 1, titles.FAIL 0. Factory, CLI and full mutants on CI.
- 2026-11-04 22:10: WORK ORDER 06 LANDED: master c17af7b (run 41896948937, 9 of 9), after two rebases (2d0f909, 4bfaac7); branch, worktree
  and builder removed. RULE (head of operations, 22:16): take the next free work order number from `work/` (all branches' folders)
  before writing one; 06-plain-names keeps its number. Slice 4 first part started as work order 09 (`work/09-six-question-report`):
  BUILDER_seo-and-audits_six-question-report (pid 15836, sonnet high). Stop all work at 95% weekly usage.
- 2026-11-04 22:19: LAND HOLD (head of operations): platform's work order 07 (CRM screens) lands next; no SEO land until platform
  says 07 is on master. Work order 09 may be built, pushed and run on CI meanwhile, then rebased on master after 07.
- 2026-11-05 01:12: work order 09 (slice 4 first part) ACCEPTED: `tools/audit/report.mjs` (the six-question report from the stored
  summary; Q2 to Q5 "not measured yet" cards in report-live.mjs's words; every number a fact with its summary path). Head re-run:
  test/run.mjs "OK: 653 of 653 checks passed" exit 0; bad-MET-003 production report read (one heading problem on `/tasting-room/`,
  first in the fix order; a bad --checked-at exit 2). Builder's 4 new mutants caught; builder stopped (pid 15836). Next part (slice
  4b): questions 2 to 5 from the skill's research and measure files. Waits on the land hold (platform 07 first).
- 2026-11-05 01:20: HANDOVER (head HEAD_SEO-and-audits_2026-11-04b, Opus 5.5; reports to HEAD-OF-OPERATIONS_Omnikom_Platform; idle at
  the head of operations' order, weekly usage 89%, stop at 95%).
  - LANDED this session: work order 06 plain names (c17af7b, run 41896948937, 9 of 9); work order 09 lands with this block (its commit
    message and run carry the sha). No builder runs; no SEO worktree but `departments\seo-and-audits\builders\six-question-report`
    (remove it after this land).
  - NEXT 1: slice 4b, questions 2 to 5 of `tools/audit/report.mjs` from the skill's research and measure files (report-live.mjs's
    report.json facts: targets.json, competitor audits, authority.json, ai-citations and measure citations), each number a fact with
    its source; NOT STARTED (head of operations, 01:13: not before the weekly reset). Take the next free work order number from
    `work/` on every branch.
  - NEXT 2: the LOW finding, mutate.mjs progress line every 25 mutants (Open items).
  - OPEN for others: the book's `docs/product/6-dashboard.md:113` names names.json and byTopic (head of operations' next book
    commit); dashboard card 5 reads `report.mjs` once reports are stored (platform). Heavy lock: other sessions held it 1h+ on
    2026-11-04, so builders ran `tools/audit/test/run.mjs` directly (it does not need the lock) and only mutants through heavy.mjs.
  - LESSONS: a land after another head's land needs a rebase; build the commit on the fresh master with a cherry-pick, take master's
    icm/ and regenerate it, and compare the non-icm diff with the old commit before pushing. A topic with no checks reads "not
    checked this time", never "0 pass, 0 problems".
- 2026-11-09 04:20: head HEAD_SEO-and-audits_2026-11-09 (opus) took over from the 2026-11-05 01:20 block; reports to
  HEAD-OF-OPERATIONS_Omnikom_Platform. This week's SEO work order numbers: 25 to 29. Work order 25 (`work/25-report-questions-2-5`,
  slice 4b of the report: `report.mjs` renders questions 2 to 5 from the skill's report.json, every number a fact):
  BUILDER_seo-and-audits_report-questions-2-5 (pid 1688, sonnet high). Work order 26 part 1 (`work/26-omnikom-ai-plan`, the
  omnikom.ai intake pack: pickable options for the owner's seven intake answers, each sourced; research waits on those answers,
  since `approve.mjs business` needs them answered by the owner): BUILDER_seo-and-audits_omnikom-ai-intake (pid 26060, sonnet high).
- 2026-11-09 10:20: work order 25 landed as `03464ae` (CI run 42577278854, 9 of 9); its worktree and branch removed. Work order
  26 part 1 done, part 2 waits on the owner's four answers and his `approve.mjs business`. Work order 27
  (`work/27-authority-not-in-graph`, a site not in the link graph reads "not found in the link data", never 0; skill SOURCE then
  `report.mjs`): BUILDER_seo-and-audits_authority-not-in-graph (pid 43940, sonnet high). Week at 31%.
- 2026-11-09 21:20: HANDOVER (head HEAD_SEO-and-audits_2026-11-09, Opus 5.5; week at 87%, stop at 95%; reports to
  HEAD-OF-OPERATIONS_Omnikom_Platform). No builder is running.
  - Landed: 25 `03464ae` (report questions 2 to 5), 27 `5cef4f1` (Q4 "not found in the link data", skill SOURCE `c41d767`).
  - Pushed, NOT landed (GitHub Actions outage from 20:29; head of operations lands them after platform 10 and CLI J13):
    28 `check/seo/authority-rest` `c3052c6` (the rest of "not found in the link data", `test-reports.mjs --group`, SOURCE
    `78d8b3d`; this block rides on it) and 29 `check/seo/lead-types` `1bbfe00` (lead types: real estate 15, insurance and
    financial 15; statuses 19; every one sourced; handed to platform, whose work order 20 builds A16 on them). Before a land:
    fetch, rebase, take master's icm/INDEX.md and icm/index.json on conflict, `node tools/icm/index.mjs`, push with lease, land.
  - Open, in order: work order 31 (head of operations' number): `tools/audit/report.mjs:206` still says "but not to this site"
    when `inGraph` is false (28 finding 1); the `test-compare.mjs` mutant `main-check-exact-path` never applies, target text
    missing in `measure-sources.mjs` since before `c41d767` (28 finding 4). Then 26 part 2 (omnikom.ai research and prompt map)
    after the owner's four answers and his `approve.mjs business`; doctor with `--env-file`; the 9 bot-wall hosts stay BLOCKED.
  - 29 open choices (mine): the policy-review source is a recruiting article whose URL now redirects (store the final URL or
    find a better source); 59 of 91 quotes are UNPROVEN beyond the first reader.
  - Leftover worktrees: `builders/authority-rest` and `builders/lead-types` (remove after their land),
    `builders/omnikom-ai-intake` (26, on `check/seo/omnikom-ai-plan` `67f2bb5`, clean; keep for part 2).
  - Machine hook skill-stage-guard blocks a `cmp` naming a skill script: the head of operations owns it; do not work around it.
- 2026-11-10 02:40: HANDOVER (head HEAD_SEO-and-audits_2026-11-09, Opus 5.5; week at 92%; PARKED by the owner 02:34, the
  account switches in the morning). This block replaces the "Pushed, NOT landed" and "Open" lines of the 2026-11-09 21:20 block.
  No builder is running.
  - Master `cbffa6e` (CI run 42726087866 success). SEO landed this week: 25 `03464ae` (run 42577278854), 27 `5cef4f1`
    (run 42609772456, skill SOURCE `c41d767`), 28 `6972b1e` plus HANDOVER `0d382f5` and icm `8e00339` (branch run 42693457902,
    skill SOURCE `78d8b3d`), 29 `478a129` (branch run 42705233177); 28 and 29 landed in the head of operations' chain.
  - Pushed, NOT landed: 31 `check/seo/gap-line-and-mutant` (`work/31-gap-line-and-mutant`: the Q4 gap line when the site is
    not found in the link data; `main-check-exact-path` patches `lib-main.mjs`; skill SOURCE `a15be7a`). This block rides on
    it. Head re-ran: audit run.mjs 678 of 678, new mutant caught, compare 38 of 38, authority 137/137. Its CI run 42726462724 on
    9b8cefd was in progress at 02:35; this commit starts a new one. Land order: after CLI's J13; fetch, rebase onto master, take
    master's icm on conflict, `node tools/icm/index.mjs`, push with lease, `omnikom land check/seo/gap-line-and-mutant`.
  - Open, in order: land 31; then tell HEAD_Platform-build that its 16 is next (head of operations' order; not sent tonight).
    26 part 2 (omnikom.ai research and prompt map) after the owner's four answers and his `approve.mjs business`; worktree
    `builders/omnikom-ai-intake` (`check/seo/omnikom-ai-plan` `67f2bb5`, clean). 29 choices: the policy-review source (a
    recruiting article, its URL redirects) and 59 of 91 quotes UNPROVEN beyond the first reader. `scripts/authority.mjs:22` has
    an empty import (look only).
  - Worktrees: `builders/gap-line-and-mutant` (31; remove after its land) and `builders/omnikom-ai-intake` (26).
- 2026-11-10 10:30: HANDOVER (head HEAD_SEO-and-audits_2026-11-09, Opus 5.5; new account, week at 31%). This block replaces
  the 02:40 block's "Pushed, NOT landed", "Open" and "Worktrees" lines. No builder is running.
  - 31 landed: master `8640f12` (CI run 42779756735, 15 of 15 jobs). Before the push the head re-ran on the rebased tree:
    audit run.mjs "OK: 678 of 678 checks passed", gitleaks "no leaks found". The first land try timed out waiting 60 minutes
    on the slow platform CLI job (run 42772098293); the rebase onto CLI's 6-way split `12e9111` then passed in about 20 minutes.
    A first test run at 08:54 was stopped by Claude Code for low machine memory (video session); re-run under heavy.mjs.
  - HEAD_Platform-build told at 10:27 that its 16 is next.
  - Cleanup: worktree and branch `gap-line-and-mutant` removed; remote branches deleted after checking each is in master:
    4c-flip, 4c-noindex-header, 5c-publish-rule, authority-not-in-graph, authority-rest, lead-types, report-questions-2-5.
  - `scripts/authority.mjs:22` `import {  } from "./measure-sources.mjs"`: dead. It only loads the module, and
    `measure-sources.mjs` has no top-level side effects (its top level is imports, constants and function/class definitions).
    It came in with the skill copy `653c81b`. Remove it the next time a work order touches that file; not worth its own.
  - Open, in order: 29 follow-up (a second reader for the 59 of 91 lead-type and status quotes still UNPROVEN, and a better
    source than the redirecting agencybloc recruiting article for insurance `policy-review`; public sources only, the 7
    BLOCKED hosts stay blocked); needs a work order number from the head of operations. 26 part 2 (omnikom.ai research and
    prompt map) waits on the owner's four answers and his `approve.mjs business`.
  - Worktrees: `builders/omnikom-ai-intake` (26, `check/seo/omnikom-ai-plan` `67f2bb5`, clean; keep) and
    `builders/handover-1110` (this block; remove after its land).
