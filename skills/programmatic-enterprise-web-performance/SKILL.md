---
name: programmatic-enterprise-web-performance
description: Enterprise search agency in a skill. Audits a live site by its URL (no code needed; polite snapshot with real Chrome phone speed) or a codebase against the shipgate checklist (rule count in checklist/INDEX.md), groups problems into root causes, measures authority from the free Common Crawl link graph, and answers in plain words "why am I not showing up, and what do we fix first". Use when the user asks to check, audit or review a site, link or codebase; "why am I not ranking" / "not showing up on Google or ChatGPT"; "audit this link"; "compare our site with theirs"; "plan a site that ranks"; "refactor for SEO"; "track our rankings or AI citations"; or make a site enterprise grade for SEO, AEO and GEO (generative engine optimization). Also researches demand, competitors and AI citations from free sources, plans pages that target real searches, gates a built site against the plan, tracks rankings and AI citations over time, and maps redirects for a site migration. Free data sources only; a part whose source is not connected reports BLOCKED with what unblocks it.
---

# Programmatic Enterprise Web Performance

Answers two questions: **is the site built right** (the shipgate checklist, `checklist/`, rule ids like `SE-004`) and
**will it get found, rank and be cited, and what do we do about it** (the six-question report). Free sources only
(owner decision 2026-10-22). Build status of each part: `PHASES.md`. Modes, stages and cost stops: `modes.md`.

## Router: the situation -> the mode
One entry for any mode: `node "<skill>/scripts/start.mjs" <mode> <target>` prints the plan and cost; `--go` runs the stages in
order, stops at approvals, missing inputs and main-session tasks, and re-runs stages whose inputs changed (`stages/start.md`).

| The user says / has | Mode | Status |
|---|---|---|
| a link: "audit this", "why am I not ranking", "not on Google / ChatGPT" | `audit-live <url>` | BUILT: its steps are `pipeline.json` (below); Q2, Q3, Q5 answered from research / measure / gate files when they exist, else BLOCKED |
| a codebase: "check this repo", "make it enterprise grade" | `audit-repo <path>` | BUILT |
| "compare our site with theirs / old vs new" | `compare <a> <b>` | BUILT: `stages/compare.md` (`node scripts/compare.mjs <a> <b> [--launch-state-b preview]`; reads snapshots, never crawls) |
| "research our market / keywords / competitors" | `research <business\|url>` | BUILT: `stages/intake.md`, `stages/research.md` |
| "plan a site that ranks" / "does the built site match the plan" | `plan` -> `gate` | BUILT: `stages/plan.md`, `stages/gate.md` (GT-013: two builds give the same dates when a build command is known) |
| "fix it" / "refactor for SEO" | `refactor <path>` | BUILT: `stages/refactor.md` (worktree per cause, rebuild, check FAIL->PASS, owner approves the merge; every merge is rebuilt twice and a date that moves = build clock = rejected, `--no-stability` skips it: IDX-003/SE-004/AEO-012, `scripts/check-stability.mjs`) |
| "track our rankings / AI citations" | `measure <url>` | BUILT: `stages/measure.md` |
| "we're replacing the old site" | `migrate <old> <new>` | BUILT: `stages/migrate.md` |
| "Business Profile / map pack / local" | `local` | BUILT: `stages/local.md` |
| "who links to them / how do we earn links, mentions, citations" | `authority` | BUILT: `stages/authority.md` (the off-site playbook for any industry: authority.mjs -> authority-classify.mjs -> authority-vet.mjs -> authority-outreach.mjs) |
| "approve the plan" / "sign off the targets" / "approve the business, competitors, seeds or prompt map" | `approve <target> targets\|plan\|business\|competitors\|seeds\|prompt-map --by NAME` | BUILT: scripts/approve.mjs (six kinds; signed copies + lock; the launch gate needs them) |
| "what should we change next" / after a measure run | `iterate <target>` | BUILT: `stages/iterate.md` (proposals only; they need approve again) |
| "build a new site from a business brief" | `build <brief>` | BUILT (driver): `stages/build.md` |
| "launch it" / "go live" / "make the preview production" (a built, gated preview) | `launch <target>` | BUILT: `stages/launch.md` (`node scripts/launch.mjs --init <pewp>` writes the 22-item ledger `launch.json`; `--access` the owner access questions; `--task` the one-shot agent brief; `--check` exits 0 only when every item is PASS with its proof line or BLOCKED with an allowed reason, 3 while items are open). Not in `start.mjs` yet |
| "fix our existing live site end to end" / "make the site rank, then regenerate the sitemap properly" (a live URL AND its code repo) | `overhaul <live url> <repo>` | BUILT: `stages/overhaul.md` (14 steps in order: audit-live -> definition (OWNER) -> competitors of every kind (OWNER) -> seeds (OWNER) -> research -> authority on approved domains -> page plan as a picture (OWNER) -> audit-repo -> fix run with the live findings mapped in (OWNER) -> build pages -> gate -> deploy (OWNER) -> sitemap file checked then submitted -> measure) |
| (inside `build`, new or redesigned site, between plan and builder) the design stage | run by the main session with agents and the owner | BUILT (SOP, not a script): `stages/design.md` -> `DESIGN.md`; tools `scripts/wf-shots.mjs`, `scripts/section-shots.mjs` |
Read the stage file before running a mode: each lists its inputs, steps, outputs and stop rules. A mode whose stage
file does not exist is NOT BUILT: say so plainly; never improvise it from memory.

## audit-live <url>
The step list is **`pipeline.json`** (skill root): ONE list, read by `node "<skill>/scripts/start.mjs" audit-live <url> [--client <slug>] [--go]` and by `omnikom seo run`.
Both use `scripts/lib-pipeline.mjs` (load, validity rules, run order, placeholders, evidence, step outcome); `start.mjs` keeps no list of its own, and
`scripts/test-pipeline.mjs` fails if the two ever differ (ids, order, dependsOn) or if the manifest breaks a rule. To add or change a step edit `pipeline.json`
and run that test; never add a step in `start.mjs`.
**A run resumes, never starts from scratch** (the owner's rule): a step whose evidence exists (not empty), is not only BLOCKED records, is within its `maxAgeDays` (null: no limit; 0: nothing from before this run) and whose inputs are all older (for a person approval an input with the approved copy's own bytes is not newer) is ADOPTED: recorded done, exit 0, "adopted", with
`evidenceDate` = the evidence's own mtime (not now), not run again; a newer input re-runs that step and, through its outputs, its dependents. `--adopt <id>[,<id>]` is the explicit form (a step that cannot
be adopted refuses with exit 3 and the input or file named, nothing starts); `--fresh` discards (alone: every step again; `--fresh <id>[,<id>]`: those steps and their dependents). `adoptStep`
and `adoptDefault` in `lib-pipeline.mjs` are the same rule for `omnikom seo run`.
- Each step: id, module, what, script (or null), args, inputs, outputs, dependsOn, needsBrowser (none | headless | owner), needsAi, needsPerson, needsKeys, heavy, hits
  (none | client | third-party:<host>), pace, timeoutMinutes, evidence, and for a waiting step a brief. Optional: `exit` (what a script's exit 4 means) and `engines` (names known to
  `scripts/lib-stops.mjs`: while a stop is in force for one of them (a robot check, a 429, a sign-in wall) the step is BLOCKED with the stop's until and reason and never started; a
  person's desktop lift frees only a person-paced capture in the owner's browser). The file is in run order (a step after the steps it depends on).
- A step with a script runs: exit 0 = done once its evidence is there (exists, not empty, written after the step started; of a pattern the newest match counts),
  3 = BLOCKED (the last line is `BLOCKED: <what> | unblocks: <what would>`; the steps that do not depend on it go on), 4 = SKIPPED (`SKIPPED: <reason>`) or, where the
  step's own `exit` says so, partial (run again to continue), 2 = usage. A step that calls a site other than the owner's needs the owner's plan ack first (`--ack plan-ok`).
- A step with `script: null` is WAITING and never run by a script: needsPerson prints NEEDS-APPROVAL (an approval: `approve.mjs`), needsBrowser "owner" and needsAi print
  WAITING-FOR with the brief. The main session (or an agent) does it and writes the evidence; the next `--go` picks it up. Every waiting step is listed at once.
- The modules, in the order a client audit needs them: setup (doctor, intake, business approval), technical (snapshot, psi with three runs and the median, crux for real
  visitors, the checker agent), keywords and demand (seeds and their approval, Bing estimates and the client's own site stats which stay BLOCKED until the client adds us,
  autocomplete, Trends), visibility (research plan, the vantage check, the Google and Bing captures, index coverage, research), competitors, authority (Common Crawl links,
  anchors, classify, vet), local (city centres from Wikipedia, the Maps grid, directories), reputation, social, ads (each a capture in the owner's browser followed by an
  importer that writes ONE normalized JSON under `research/`), forums, report (`report-live`), verify (a fresh agent re-checks every number).
- Options of `start.mjs` that shape the run (remembered for the run): `--exclude`, `--max-pages`, `--research-args`, `--seed-args`, `--no-authority`, `--fresh`, `--client`,
  `--env-file`; `--stage <id>` runs one step (after its dependencies); `--pipeline <file>` uses another manifest (tests). `{work}` for the checker's headless workers is
  `<run>/work`, or `<os temp>/pewp-work/<host>` when the run lives under `~/.claude` (those workers cannot write there).
- The captures a script never makes: Google, Bing, ChatGPT, Perplexity, Copilot, Maps, Trends, directories, review sites, social and ad libraries are read in the owner's
  browser at human pace and saved in the format at the top of each importer (`scripts/import-*.mjs`, `research-autocomplete.mjs`, `local-nap.mjs`).
- Run state and proof: `site-checks/<host>/.pewp/state.json`; every start writes `runs/<date>-audit-live.md` (command, exit code, first 40 lines, doctor result).

## The checker (audit-repo, and the `checker` step of audit-live)
The main session never reads the code. Start ONE agent: `subagent_type: "general-purpose"`, `model: "sonnet"`,
`effort: "high"`, prompt:
> Read `<skill>/coordinator.md` and follow it exactly. Repo root: `<path>`. Focus: `<focus>`. Max parallel workers: `<n, default 4>`. Return only the short summary it specifies.
For a repo, run `node "<skill>/scripts/guard-readonly.mjs" <repo> --before` first and `--after` when it returns (fails if
any source file changed). Output in `<root>/.checks/`:
- `REPORT.md`: root causes first (where to fix, pages affected), then every finding, then NOT CHECKED and warnings.
  Pages from one template are a family: 2 representatives are checked, a template defect is one cause.
- `causes.json` (data for reports and PDFs) · `run-all.mjs` (re-runs every check, no usage) · `scripts/check-*.mjs`
  (exit 0 fixed, 1 still there, 2 cannot judge) · `scripts/know-*.mjs` (facts about the code, so nobody opens it).
After fixes: `node .checks/run-all.mjs`. After big changes, run the skill again (the previous run moves to `.checks/prev/`).
In audit-live the checker step's root is `{work}/checker` (a copy of the newest snapshot) and the `report-live` step reads its `.checks/` (`report-live.mjs --checks {work}/checker/.checks`): no readable list of causes there is BLOCKED, and a newer `causes.json` makes the report stale. Without `--checks` (the overhaul chain, a hand run) it reads `<snapshot>/.checks/`.

## Rules
- Audit modes never edit the target: workers write only under `.checks/` (scratch in `.checks/tmp/`), the guard proves it.
- A finding without a working check script is `unchecked`, never dropped; a stage without its source is BLOCKED,
  never filled from memory.
- The live crawler (`snapshot-site.mjs`): GET only, honest user agent, one request every 4 s, robots.txt obeyed, a 429
  waits 90 s and retries once, a second 429 stops (exit 3); every Chrome command has a time limit, one page is capped
  at 180 s (Chrome restarted), a run at 90 min (exit 4). Speed = median of 3 phone runs; measure on an idle machine.
- Snapshots, `.pewp/` of URL targets and `.checks/` hold client content: keep them out of git.
- Switch-over safeguards (shipgate refactor pack): REF-009 visual equivalence `refactor.mjs --visual` (`ref-visual.mjs`),
  REF-013 old service workers retired `ref-sw.mjs`, REF-014 image URLs kept `ref-images.mjs` / `migrate.mjs --images`.
- In reports "GEO" means generative engine optimization (AI engines); map coordinates are "geo-coordinates".
- Scripts never fetch Google, Bing, ChatGPT or Perplexity result pages: the main session captures them in the owner's
  browser at human pace (one page at a time, at least 45 s apart, stop at the first robot check) and the scripts import
  the saved captures. `--exclude` covers every request the crawler makes (pages, sitemaps, probes) and, in `migrate.mjs`, every
  gate and `--probe-old` request; a client's off-limits paths are passed to both.
- Questions for the owner (intake, decisions) are asked by the main session as pickable options; scripts never prompt.
- Writing gate: `node "<skill>/scripts/writing-gate.mjs" <built site dir> [--url <live base>] [--psi-dir <dir>]` checks a BUILT site against the 7 rules every
  V2 build must obey (critical CSS inline, wasted CSS under 8 KiB gzip, image sizes, no forced reflow, ARIA roles, `/llms.txt`, HSTS + COOP); rules and numbers in `stages/build.md`; launch runs it as the `writing` check of L-B9.
- Every test blocks non-local network requests; fixtures only.
- Proof of the tooling (counts come from the output): `node scripts/test-snapshot.mjs`, `test-plan-merge.mjs`,
  `test-phase1.mjs`, `test-compare.mjs` (+ `--mutants`), `test-authority.mjs` (+ `--mutants`), `test-start.mjs`, `test-ref.mjs`, `test-research.mjs` (+ `mutants-research.mjs`), `test-plan-gate.mjs`, `test-prompt-plan.mjs` (the prompt map in the plan and gate GT-014, with its own mutants), `test-measure-prompts.mjs` (the monthly prompt-map re-run and its diff, with its own mutants), `test-measure.mjs`
  (+ `--mutants`), `test-refactor.mjs`, `test-freshness.mjs` (no fake freshness: check-stability, GT-013, built-in sitemap check; mutants built in),
  `test-pipeline.mjs` (pipeline.json: validity rules, run order, evidence, the sameness with `start.mjs audit-live`, every script step's args; mutants built in), `test-bing-refusal.mjs`, `test-crux.mjs`, `test-importers.mjs` (the six capture importers), `test-city-centres.mjs`, `test-step-contracts.mjs` (live-target's pointer, local-grid and intake exits, the grid plan's remembered cities and the plan-to-import contract; each with its own mutants; `--json` prints one JSON result line last),
  `test-launch.mjs` (the launch ledger on a local fixture site, a fixture PSI file and the real strict gate; mutants built in),
  `test-writing-gate.mjs` (the writing gate on a good fixture site and one mutant per rule, each watched red for the right reason; needs the render-gate Chromium),
  `test-browser-leftovers.mjs [cdp-measure.mjs]` (`launchBrowser()` leaves no browser process and no pewp-chrome-* folder after close, process.exit and an uncaught error; run it through `node ~/.claude/scripts/heavy.mjs --`; BLOCKED, exit 1, with no Chrome or Edge).
- Refresh the checklist after shipgate spec changes: `node "<skill>/scripts/build-checklist.mjs"` (reads the shipgate
  path from `~/.claude/machine.local.json` "shipgate", or pass it).
