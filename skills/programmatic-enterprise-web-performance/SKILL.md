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
| a link: "audit this", "why am I not ranking", "not on Google / ChatGPT" | `audit-live <url>` | BUILT (Q2, Q3, Q5 answered from research / measure / gate files when they exist, else BLOCKED) |
| a codebase: "check this repo", "make it enterprise grade" | `audit-repo <path>` | BUILT |
| "compare our site with theirs / old vs new" | `compare <a> <b>` | BUILT: `stages/compare.md` (`node scripts/compare.mjs <a> <b> [--launch-state-b preview]`; reads snapshots, never crawls) |
| "research our market / keywords / competitors" | `research <business\|url>` | BUILT: `stages/intake.md`, `stages/research.md` |
| "plan a site that ranks" / "does the built site match the plan" | `plan` -> `gate` | BUILT: `stages/plan.md`, `stages/gate.md` (GT-013: two builds give the same dates when a build command is known) |
| "fix it" / "refactor for SEO" | `refactor <path>` | BUILT: `stages/refactor.md` (worktree per cause, rebuild, check FAIL->PASS, owner approves the merge; every merge is rebuilt twice and a date that moves = build clock = rejected, `--no-stability` skips it: IDX-003/SE-004/AEO-012, `scripts/check-stability.mjs`) |
| "track our rankings / AI citations" | `measure <url>` | BUILT: `stages/measure.md` |
| "we're replacing the old site" | `migrate <old> <new>` | BUILT: `stages/migrate.md` |
| "Business Profile / map pack / local" | `local` | BUILT: `stages/local.md` |
| "who links to them / how do we earn links, mentions, citations" | `authority` | BUILT: `stages/authority.md` (the off-site playbook for any industry: authority.mjs -> authority-classify.mjs -> authority-vet.mjs -> authority-outreach.mjs) |
| "approve the plan" / "sign off the targets" | `approve <target> targets\|plan --by NAME` | BUILT: scripts/approve.mjs (signed copies + lock; the launch gate needs them) |
| "what should we change next" / after a measure run | `iterate <target>` | BUILT: `stages/iterate.md` (proposals only; they need approve again) |
| "build a new site from a business brief" | `build <brief>` | BUILT (driver): `stages/build.md` |
| "launch it" / "go live" / "make the preview production" (a built, gated preview) | `launch <target>` | BUILT: `stages/launch.md` (`node scripts/launch.mjs --init <pewp>` writes the 22-item ledger `launch.json`; `--access` the owner access questions; `--task` the one-shot agent brief; `--check` exits 0 only when every item is PASS with its proof line or BLOCKED with an allowed reason, 3 while items are open). Not in `start.mjs` yet |
| "fix our existing live site end to end" / "make the site rank, then regenerate the sitemap properly" (a live URL AND its code repo) | `overhaul <live url> <repo>` | BUILT: `stages/overhaul.md` (14 steps in order: audit-live -> definition (OWNER) -> competitors of every kind (OWNER) -> seeds (OWNER) -> research -> authority on approved domains -> page plan as a picture (OWNER) -> audit-repo -> fix run with the live findings mapped in (OWNER) -> build pages -> gate -> deploy (OWNER) -> sitemap file checked then submitted -> measure) |
| (inside `build`, new or redesigned site, between plan and builder) the design stage | run by the main session with agents and the owner | BUILT (SOP, not a script): `stages/design.md` -> `DESIGN.md`; tools `scripts/wf-shots.mjs`, `scripts/section-shots.mjs` |
Read the stage file before running a mode: each lists its inputs, steps, outputs and stop rules. A mode whose stage
file does not exist is NOT BUILT: say so plainly; never improvise it from memory.

## audit-live <url>
1. `node "<skill>/scripts/doctor.mjs" <url>`: which free sources are connected (writes `site-checks/<host>/.pewp/doctor.json`).
2. `node "<skill>/scripts/live-target.mjs" <url> [-- <snapshot options>]`: reuses a snapshot younger than 7 days, else
   takes one (`--fresh` forces). Run it from PowerShell. For a client site pass its off-limits paths
   (`--exclude "^/home-search"`) and never submit forms or log in. For your own preview add `--ignore-robots`.
3. Show the user the worker count (`node "<skill>/scripts/plan.mjs" <snapshot dir> --dry`), then run the checker on the
   snapshot folder: the coordinator agent below, repo root = the snapshot folder.
4. Optional, free, 15 to 30 minutes of disk reading: `node "<skill>/scripts/authority.mjs" site-checks/<host>/.pewp/authority.json --target <domain> --competitor <domain>...`
5. `node "<skill>/scripts/report-live.mjs" <url> [--launch-state preview]`: writes `.pewp/report.md` (plain words, the
   six questions in order) and `report.json` (every number with its source, date and file).
6. Save the proof: `runs/<date>-audit-live.md` (command, exit code, first 40 lines, doctor result).

## The checker (audit-repo, and step 3 above)
The main session never reads the code. Start ONE agent: `subagent_type: "general-purpose"`, `model: "sonnet"`,
`effort: "high"`, prompt:
> Read `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance\coordinator.md` and follow it exactly. Repo root: `<path>`. Focus: `<focus>`. Max parallel workers: `<n, default 4>`. Return only the short summary it specifies.
For a repo, run `node "<skill>/scripts/guard-readonly.mjs" <repo> --before` first and `--after` when it returns (fails if
any source file changed). Output in `<root>/.checks/`:
- `REPORT.md`: root causes first (where to fix, pages affected), then every finding, then NOT CHECKED and warnings.
  Pages from one template are a family: 2 representatives are checked, a template defect is one cause.
- `causes.json` (data for reports and PDFs) · `run-all.mjs` (re-runs every check, no usage) · `scripts/check-*.mjs`
  (exit 0 fixed, 1 still there, 2 cannot judge) · `scripts/know-*.mjs` (facts about the code, so nobody opens it).
After fixes: `node .checks/run-all.mjs`. After big changes, run the skill again (the previous run moves to `.checks/prev/`).

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
  `test-phase1.mjs`, `test-compare.mjs` (+ `--mutants`), `test-authority.mjs` (+ `--mutants`), `test-start.mjs`, `test-ref.mjs`, `test-research.mjs` (+ `mutants-research.mjs`), `test-plan-gate.mjs`, `test-measure.mjs`
  (+ `--mutants`), `test-refactor.mjs`, `test-freshness.mjs` (no fake freshness: check-stability, GT-013, built-in sitemap check; mutants built in),
  `test-launch.mjs` (the launch ledger on a local fixture site, a fixture PSI file and the real strict gate; mutants built in),
  `test-writing-gate.mjs` (the writing gate on a good fixture site and one mutant per rule, each watched red for the right reason; needs the render-gate Chromium),
  `test-browser-leftovers.mjs [cdp-measure.mjs]` (`launchBrowser()` leaves no browser process and no pewp-chrome-* folder after close, process.exit and an uncaught error; run it through `node ~/.claude/scripts/heavy.mjs --`; BLOCKED, exit 1, with no Chrome or Edge).
- Refresh the checklist after shipgate spec changes: `node "<skill>/scripts/build-checklist.mjs"` (reads the shipgate
  path from `~/.claude/machine.local.json` "shipgate", or pass it).
