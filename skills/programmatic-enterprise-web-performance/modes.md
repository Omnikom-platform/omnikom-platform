# Modes: one skill, one router

`<cwd>` is where the skill is run. A URL target keeps everything in `<cwd>/site-checks/<host>/` (gitignored, client
content): `snapshots/<date>/` + `.pewp/` (state.json, doctor.json, cache/, authority.json, report.md, report.json).
A repo target keeps `.pewp/` in the repo and the checker's output in `.checks/`. Free sources only (owner decision
2026-10-22). Every mode ends with `<pewp>/runs/<date>-<mode>.md` (command, exit code, first 40 lines, doctor result) as its proof:
`start.mjs` writes it itself at every end or stop, plus one file per stage it ran (G14). Keys come from a `.env` file given once as
`--env-file` (G1; names only are ever printed). A stage with external calls or agent workers runs only after the owner saw the plan
(`--ack plan-ok --by NAME`, or `--yes` when the owner said yes in words; the run file records which) (G13). In everything the owner reads,
`plan/sitemap.json` is "the page plan" and `sitemap.xml` is "the sitemap file search engines read" (G10).

## Cost stops (enforced; a run above one asks the owner first)
| Stop | Default | Where it is enforced |
|---|---|---|
| Check workers per run (one Sonnet worker, high effort, per slice) | 12 | coordinator.md step 1 (more = stop and ask) |
| Live pages per snapshot | 20 | snapshot-site.mjs `--max-pages` |
| Snapshot run time | 90 min | snapshot-site.mjs `--max-minutes` (exit 4) |
| One page measurement | 180 s | snapshot-site.mjs `--page-cap-s` (Chrome restarted, run continues) |
| Snapshot reuse | younger than 7 days is reused | live-target.mjs `--max-age-days`, `--fresh` forces |
| Owner-supervised browser captures | 1 page at a time, at least 45 s apart, stop at the first robot check | phase 2 capture script |
| Research external calls | Bing 60, competitor sites 12, Reddit 12, Gemini 30, captures 60 per run; a plan above 150 external calls needs `--yes` | research.mjs |
| Measure external calls | API calls 80, AI answers 60, URL inspections 20 per run | measure-sources.mjs (Budget) |
| Fix workers per refactor run | 12 (3 at once, 30 min each) | refactor.mjs --parallel / --timeout-min; --dry prints the count |
| Authority vetting | 12 s a site, --limit 25, --max-minutes 20, --max-requests 150 | authority-vet.mjs |
| Paid APIs | none allowed | doctor.mjs lists free sources only |

## Modes
| Mode | Status | Stage sequence | Inputs | Outputs |
|---|---|---|---|---|
| `audit-live <url>` | **BUILT (P1)**; Q2, Q3, Q5 answered from research / measure / gate files when they exist, else BLOCKED | the steps of `pipeline.json` (doctor, snapshot, psi, crux, checker, intake, keywords, demand, captures and their importers, competitors, authority, local, reputation, social, ads, report-live, verify), run by `start.mjs` in the manifest's order | URL; optional `.pewp/business.json` (launchState, competitors) | `.pewp/report.md`, `report.json`, `work/checker/.checks/` (the checker step's copy of the snapshot) |
| `audit-repo <path>` | **BUILT** (the checker) | doctor -> guard --before -> checker (plan, workers, merge) -> guard --after | repo path, focus | `.checks/REPORT.md`, `causes.json`, `run-all.mjs` |
| `compare <a> <b>` | **BUILT** | live-target a and b (same --runs/--exclude) -> checker on both -> authority (optional) -> compare.mjs | two URLs or URL + repo | site-checks/compare-<hostA>-vs-<hostB>/compare.md + compare.json |
| `research <business or url>` | **BUILT (P2)** | doctor -> intake.mjs (main session asks the missing questions as options) -> research.mjs --dry (plan + capture requests) -> main session captures result pages -> research.mjs: existing research -> seeds -> Search Console / Bing / Keyword Planner / Wikipedia / forums -> SERP import -> clusters -> competitors (+authority) -> AI citations -> targets | business.json, captures, keys | research/*.json, research/report.md, targets.json (validated), unmeasured.json |
| `refactor <path>` | **BUILT (P3)** | doctor -> audit-repo -> refactor.mjs --dry (owner OK) -> refactor.mjs: one worktree + fix worker per root cause (fix the generator, rebuild, the coordinator re-runs every check: FAIL->PASS, no PASS->FAIL and no cannot-judge->FAIL), fixes combined and re-proved one by one, each merge rebuilt twice (a date that moves between two builds of one commit is the build clock: rejected, IDX-003/AEO-012; `--no-stability` skips it and says NOT CHECKED) -> owner approves the merge | repo path, .checks/causes.json | integration branch, .pewp/refactor/<run>.md/.json (FIXED / NOT FIXED / REGRESSED / SKIPPED-*) |
| `measure <url>` | **BUILT (P4)**; first real run needs Search Console access | doctor -> measure.mjs --init (once) -> measure/run.mjs --plan -> run.mjs -> report | targets.json, keys/tokens, captures | .pewp/measure/<date>/ (rankings.json, citations.json, gsc, bing, crux, index, ai, authority, findings, diff, report.md/json) |
| `migrate <old> <new>` | **BUILT (P4)** | inventory -> redirect map (owner reviews suggestions) -> baseline -> gate (every old URL with traffic or links resolves in one hop to a 200) -> cutover -> monitor 28 days | old snapshot, Search Console + links exports, new folder or URL | migrate/ (redirect-map.csv, _redirects, carryover, baseline, gate, monitor) |
| `local` | **BUILT (P4)** | local-run.mjs: Business Profile import -> map-pack captures per city/device -> NAP check -> review gap | business.json (phone), Business Profile export or capture, map-pack captures | local/*.json, feeds research, build and measure (MSR-010) |
| plan -> gate | **BUILT (P2)** | targets-validate.mjs -> plan-site.mjs -> builder -> gate.mjs (--strict at launch; GT-013 rebuild-stable with --build) | targets.json, business.json, a built site folder or snapshot | plan/{sitemap,programmatic,offsite,priorities}.json, plan/briefs/, gate/report.{md,json} |
| approve | **BUILT** | approve.mjs: diff against the signed copy -> sign with --by -> approved/ + lock.json | proposals or working targets/plan | approved/targets.json, approved/plan/, lock.json |
| `iterate <target>` | **BUILT** | iterate.mjs: last two measure runs + research + approved files -> significance (06 §9.8) -> proposals | measure history, approved targets/plan | proposals/targets.json, proposals/plan/ deltas, iterate/report.md |
| `authority <target>` | **BUILT** | authority.mjs (Common Crawl) -> authority-classify.mjs (taxonomy + industry pack, link gap and AI-cited sources first) -> authority-vet.mjs (polite read-only visit: what it is, how to get listed, free/paid, followed/nofollow, spam signals; PURSUE / CHECK BY HAND / AVOID) -> authority-outreach.mjs (tracker; a row is listed only with an evidence URL) | authority.json, research/citations.json, research/ai-citations.json, business.json, rules/link-sources/<industry>.json | authority/opportunities.json, vetting.json, outreach.json, howto.md |
| `start <mode> <target>` | **BUILT** | one entry over every sequence in this table (plan + cost without --go; stops at approvals, missing inputs, agent tasks; stale stages re-run by input hash) | target(s) | state.json start.sequence, the stages' outputs |
| `overhaul <live url> <repo>` | **BUILT (2026-10-25)** | the chain for fixing an existing live site, 14 steps in order (`stages/overhaul.md`): doctor -> audit-live (snapshot, PSI alongside, checker, report) -> intake -> classify (one-screen definition) -> OWNER approves the definition -> competitor discovery of every kind -> OWNER approves the list -> seeds proposed -> OWNER approves the seeds -> research end to end -> authority on the approved domains only -> page plan + picture -> OWNER signs targets and the page plan -> audit-repo -> live findings mapped onto repo causes -> fix run (OWNER approves cost and merge) -> build the planned pages -> gate --strict -> OWNER deploys and records the release -> sitemap file checked, then submitted -> measure baseline -> iterate | live URL, repo path, `--env-file`, the four project inputs (build, setup, max-parallel, who merges) | `<host>/.pewp/`: business-definition.md, approved/{business,competitors,seeds,targets}.json + plan/, research/, plan/page-plan.{png,svg,md}, sitemap/check-*.json + submit-*.json, runs/<date>-overhaul*.md |
| `launch <target>` | **BUILT (2026-10-29)**; not in `start.mjs` yet; live PSI and the real Detailed SEO CLI UNPROVEN | launch.mjs --init (ledger, 22 items OPEN) -> --access (owner access questions; main session asks, --access-set records) -> --task (one-shot agent brief) -> agent loop: --check / --record / --block -> --status exit 0 = stop condition (`stages/launch.md`) | `<pewp>` of a built, gated preview; the launch build folder; the 301 map; `PSI_API_KEY` | `<pewp>/launch.json`, `launch/access-questions.json`, `launch/gate/`, `runs/<date>-launch.md` |
| `build <brief>` | **BUILT (driver, P5)** | build-site.mjs: intake -> research -> plan -> handoff to a builder session -> gate -> measure; stops at each missing input with the question list | business brief | plan/, briefs, handoff file, gate report |

## The six questions an audit-live report answers, in this order
1 reach and read (checker + snapshot) · 2 a page for each real search (P2) · 3 better than what ranks (P2) ·
4 authority (Common Crawl, free) · 5 AI citations (P2/P4) · 6 what to fix, in order (root causes by severity x pages).
