# Stage chain: overhaul (fix an existing live site end to end)

Load this file when a live site exists, its code is in a repo, and the job is to make it rank, be found and be cited: not a new
site (that is `build`), not one audit (that is `audit-live`). `overhaul` chains the existing modes in the one order that works and
puts the owner's decisions where they belong. It was written after the Matter of Place run of 2026-10-25, where steps ran out of
order (authority on guessed competitors, seeds nobody approved, a sitemap submitted before the site was fixed) and findings were
handed around as to-do lists instead of going through the fix run.

The owner's words that define it: "Research done end to end, backlinks pulled, site fix runs, the new skeleton is built, the new
website compiled with the real programmatic SEO code, then the sitemap is written professionally." And: "before we submit any
other sitemaps we need to fix the sitemap."

## Run it
```
node "<skill>/scripts/start.mjs" overhaul <live url> <repo path> [--env-file <.env>] [options]        # the plan, the 14 steps, the costs, the OWNER stops; nothing runs
node "<skill>/scripts/start.mjs" overhaul <live url> <repo path> --ack plan-ok --by "<owner name>"      # the owner saw the plan (or pass --yes with --go when the owner said yes in words)
node "<skill>/scripts/start.mjs" overhaul <live url> <repo path> --go [options]                        # runs to the next OWNER stop or missing input; run the same command again after each
```
The run lives with the live site: `<cwd>/site-checks/<host>/.pewp/` (state.json, approved/, research/, plan/, runs/). The code stages
(the repo checker, the fix run) work in the repo: `<repo>/.checks/`, `<repo>/.pewp/refactor/`. Options that shape a stage (`--exclude`,
`--build`, `--env-file`, `--max-parallel`, ...) are remembered in state.json after the first start. Every start writes
`<pewp>/runs/<date>-overhaul.md` and one `runs/<date>-overhaul-<stage>.md` per stage it ran (command, exit code, first 40 lines, doctor result).

## The 14 steps, in this order (a stage never starts while an earlier stage it depends on is not done or not approved)
| # | Step | Stages (script) | Stops |
|---|---|---|---|
| 1 | which sources are connected | `doctor` (`doctor.mjs --dotenv <env file>`: says which env file it loaded, names only) | |
| 2 | audit the live site | `snapshot` (`live-target.mjs`; speed marked UNTRUSTED when the machine was busy) -> `psi` (`psi.mjs`, optional, needs PSI_API_KEY: Google's own numbers next to the lab ones) -> `checker-live` [agent] -> `report-live` (says the date of the doctor result it used) | the checker agent (main session) |
| 3 | the business definition | `intake` (`intake.mjs`; records who answered each field) -> `classify` (`classify-business.mjs`: one screen, `business-definition.md`: kind of business, industry pack, what it is and is not, who pays, who reads, markets, vocabulary) -> `approve-business` (`approve.mjs <url> business --by NAME`) | the owner's answers; **OWNER approves the definition**; approve refuses a field not answered by the owner |
| 4 | competitors of every kind | `competitors-discover` (`competitors-discover.mjs`: the main session's discovery agents write candidates across websites, Instagram / TikTok / YouTube / Substack accounts, paid media, agencies, brokerage programs; the script checks and lists them with an evidence URL and a closeness each) -> `approve-competitors` (`approve.mjs <url> competitors`) -> `authority-prepare` (`authority.mjs --download-only`, optional: the Common Crawl release can download early; nothing is compared) | discovery (main session); **OWNER approves the list** |
| 5 | research end to end | `seeds-propose` (`research-seeds.mjs`: from the definition's vocabulary and places, each seed says where it came from) -> `approve-seeds` (`approve.mjs <url> seeds`) -> `research-plan` (`research.mjs --dry`) -> `research` (`research.mjs`: Search Console, Bing with the relevance filter, Keyword Planner CSV, SERP and AI captures through the receiver, clusters, competitor audit of the approved list only, winner pages, AI citations, targets.json validated) | **OWNER approves the seeds**; captures (main session or the capture helper agent, `stages/research.md`); a plan above 150 calls |
| 6 | authority | `authority` (`authority.mjs --approved-competitors approved/competitors.json --require-approved`: refuses an unapproved list) -> `authority-classify` -> `authority-vet` -> `authority-outreach seed` (all optional: skipped when authority is BLOCKED) | |
| 7 | the page plan | `plan` (`plan-site.mjs --require-approved-business`) -> `plan-picture` (`plan-picture.mjs`: `plan/page-plan.png` + `.svg`, every page as a box under its parent with its target search, volume, new or existing, + `page-plan.md`) -> `approve-targets` -> `approve-plan` | **OWNER signs targets and the page plan** (from the picture and the table) |
| 8 | audit the code | `guard-before` -> `checker-repo` [agent] -> `guard-after` | the checker agent |
| 9 | the fix run | `causes-map` (`causes-map.mjs <repo> --live <snapshot>/.checks/causes.json`: live findings mapped onto repo causes by rule id; an unmatched live finding becomes its own cause) -> `refactor-dry` (asks ONCE: `--build`, `--setup` or `--no-setup`, `--max-parallel`, `--project-merges` or `--owner-merges`) -> `refactor-ok` [ack] -> `refactor` (`refactor.mjs`: one worktree and fix worker per cause, rebuild, FAIL->PASS re-proven, REF-009 pictures, nothing merged) -> `refactor-merge` [ack] | the four project inputs; **OWNER approves the cost**; **OWNER decides the merge** (through the project's own gate when `--project-merges`) |
| 10 | build the planned pages | `handoff` (`build-site.mjs <repo> --go --pewp <pewp>`: HANDOFF.md + builder-prompt.md from the approved page plan) -> `builder` [ack `--site <built folder>`] | the builder session |
| 11 | gate | `gate` (`gate.mjs <pewp> <built folder> --strict [--build ... --build-cwd <repo>]`) | a FAIL stops here |
| 12 | deploy | `deploy` [ack `--release <commit or release id>`]: the project deploys through its own path; the skill records what went live | **OWNER deploys and records the release** |
| 13 | the sitemap file | `sitemap-check` (`sitemap-check.mjs <url> --plan approved/plan/sitemap.json`: every URL in the file is in the approved page plan, answers 200, is indexable and canonical to itself; every indexable planned page is in it; lastmod is real, not the build clock; a page that already exists and is not planned for a search cluster, such as about, legal or form pages, may be in the file only if it is listed with a reason in `plan/existing-pages.json` (`{ "note", "pages": [{ "path", "why" }] }`), which is signed with the plan and read from `approved/plan/existing-pages.json` or `--existing FILE`: an unapproved list is ignored with a NOTE, and those pages still have to pass the 200, noindex, canonical and lastmod rules) -> `sitemap-submit` (`sitemap-submit.mjs`: Search Console and Bing APIs, responses recorded; refused without a same-day PASS) | a failing check FAILS the run: **nothing is submitted before the file passes** |
| 14 | measure and iterate | `measure-init` -> `measure-plan` -> `measure-run` (the baseline) -> `iterate` (optional; BLOCKED until two runs) | |

## Words (G10)
`plan/sitemap.json` is **the page plan**: which pages exist, which search each targets, parent and child links. `sitemap.xml` is **the sitemap
file search engines read**, generated by the site's own code from the pages that exist after steps 9 to 12. They are never called by one name
in anything the owner reads.

## What the main session does, and never does
- Shows the plan (no `--go`) and its costs, asks the owner as a pickable option, records the answer (`--ack plan-ok --by`), then `--go`.
- Asks every NEEDS-INPUT question as pickable options and records the owner's picks as `{"value": ..., "answeredBy": "owner"}` in
  `intake-answers.json`. It never answers for the owner; `classify` and `approve business` refuse a field it answered itself.
- Runs the discovery agents for step 4 and the capture helper agent for step 5 (one agent, one tab, 45 s pace, stop at the first robot check,
  results only through `capture-server.mjs`); the capture list is `research/capture-requests.json`, never its own.
- Starts the checker agent (steps 2 and 8) and the builder session (step 10) with the exact briefs start prints.
- Never signs an approval, merges, pushes, deploys or submits anything; every `--ack ... --by` carries the owner's name.

## Project inputs (G21), asked once and remembered
`--build "<cmd>"` (run from the repo root; Matter of Place: `cd app && bun run build`, and a route change regenerates `app/src/routeTree.gen.ts`),
`--setup "<cmd>"` or `--no-setup`, `--max-parallel N` (1 on a laptop that runs other work), `--project-merges` (merges go through the project's
own gate, CI green, never a direct merge) or `--owner-merges`. A public repo never gets a secret committed: keys stay in the `--env-file`.

## Exit codes and stops
As `stages/start.md`: 0 done or natural pause, 3 STOPPED for a person (`NEEDS-INPUT`, `NEEDS-APPROVAL`, `WAITING-FOR`), 4 BLOCKED, 1 FAILED, 2 usage.
A forced `--stage <name>` still refuses to start before the approval or acknowledgement it depends on exists.

## Proof
`node scripts/test-start.mjs` scenario G (stand-in stage scripts: the order, every OWNER stop, a forced later stage refused before its approval,
stale re-approval when seeds change, the plan ack, the run files, the four project inputs, nothing submitted before the sitemap check passes) with
watched-fail mutants for each. The real scripts have their own tests: `test-approve.mjs`, `test-capture.mjs`, `test-env` (in test-phase1), `test-google-auth.mjs`,
`test-sitemap.mjs`, `test-research.mjs`, `test-refactor.mjs`, `test-plan-gate.mjs`, `test-snapshot.mjs`, `test-rules.mjs`.
