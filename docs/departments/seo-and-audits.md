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
