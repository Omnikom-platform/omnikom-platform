# SOP: getting a client found, ranked and cited (search agency workflow)

Plain-words standard operating procedure for Omnikom's in-house search work, from the first look at a client's site to
monthly reporting. It is what the Francine & Eli project did by hand (P0.2 market, P0.3 keywords, captures, competitor
audit, backlinks, AI answers, tracker design), made repeatable with this skill and aligned with shipgate's growth spec
(`shipgate/spec/06-growth.md`: stage model, TR-2xx requirements, the §9 algorithms; packs targeting, measure, refactor).

Rules that hold at every step:
- **Free sources only; we build our own tools** (owner decision 2026-10-22). No paid SEO tools or APIs.
- **Every number has a source and a date** (`{value, source, fetchedAt, cacheFile}`; shipgate G1). An estimate says so.
  Nothing is filled from memory; a missing source makes that part BLOCKED with its unblock step.
- **Never touch a client's live site beyond reading it**: GET only, honest user agent, robots.txt, one request every
  4 s, stop at the second rate limit, never submit a form, never log in, skip off-limits paths (`--exclude`, which
  covers every request). Google, Bing, ChatGPT and Perplexity result pages are captured by a person in the browser at
  human pace (one page at a time, at least 45 s apart, stop at the first robot check); scripts only import the captures.
- **Questions to the owner are pickable options**, asked by the main session. The client never sees internal notes.
- **Done means observed**: each step ends with its proof (command, exit code, output) in the run folder.

| # | Step | Who | Skill command (stage file) | Output | Proof / stop rule | shipgate |
|---|---|---|---|---|---|---|
| 0 | Check the toolbox | Lead | `scripts/doctor.mjs <target>` | `.pewp/doctor.json` | every source connected / needs (exact step) / not available | TR-210 |
| 1 | Intake: who the client is | Lead + owner | `scripts/intake.mjs <url>` (`stages/intake.md`) | `.pewp/business.json` | exit 0 = complete; exit 3 = ask the listed questions as options, re-run | TR-201, TR-202 |
| 2 | Snapshot the current site | Lead | `scripts/live-target.mjs <url> -- --exclude ...` | `site-checks/<host>/snapshots/<date>/` | reused if under 7 days; exit 3/4 = stopped politely, report it | TR-005 remote read |
| 3 | Audit it (is it built right) | checker agent | coordinator.md on the snapshot (or the repo) | `.checks/REPORT.md`, `causes.json` | owner sees the worker count first; spot-check the top 3 root causes | gate, TR-260 §1 |
| 4 | Authority (links) | Lead | `scripts/authority.mjs ... --competitor ...` | `.pewp/authority.json` | Common Crawl, domain level, compare sites not absolutes | TR-218 |
| 4b | Earn links, mentions and citations (off-site) | Lead -> client | `authority-classify.mjs`, `authority-vet.mjs`, `authority-outreach.mjs` (`stages/authority.md`) | `authority/*.json`, `howto.md` for the client | vet is polite (robots, 429 stop, --exclude); a target is "listed" only with an evidence URL | TR-218, TR-233 |
| 5 | Research demand, results, competitors, AI answers | Lead + owner captures | `scripts/research.mjs <url> --dry`, captures, `research.mjs` (`stages/research.md`) | `research/*`, `targets.json` | targets-validate passes; tier estimates and unmeasured queries named | TR-211..220 |
| 6 | Diagnosis report (six questions) | Lead | `scripts/report-live.mjs <url>` | `.pewp/report.md/.json` | the six questions in order, every number sourced, terms explained once | TR-260 |
| 7 | Plan pages from demand | Lead | `scripts/plan-site.mjs` (`stages/plan.md`) | `plan/` sitemap, briefs, priorities, off-site | one cluster = one page; briefs pass their checks | TR-230..234 |
| 8 | Owner approves targets and plan | owner | `scripts/approve.mjs <target> targets|plan` | `approved/` + lock | a changed approved file fails the lock | TR-235 |
| 9 | Build or fix the site | builder / fix workers | `build-site.mjs` (`stages/build.md`) or `refactor.mjs` (`stages/refactor.md`) | branch with fixes (and no fake freshness: each merge rebuilt twice, a moving date is rejected) | each fix: generator fixed, rebuilt, its checks FAIL->PASS, no other check regresses; owner approves the merge | TR-240, refactor pack |
| 10 | Gate the built site against the plan | Lead | `scripts/gate.mjs` (`stages/gate.md`) + the checker | `gate/report.*` | `--strict` at launch; GT-013 builds twice with `--build` | targeting pack |
| 11 | Deploy a preview and compare with the old site | Lead | project deploy tool, then `live-target --fresh`, `compare.mjs` | `compare.md/.json` | same snapshot options on both sides | TR-261 |
| 12 | Switch over without losing rankings | Lead + owner | `scripts/migrate.mjs` (`stages/migrate.md`) | redirect map, `_redirects`, baseline | owner approves each suggested redirect; gate: every old URL with traffic or links resolves in one hop | refactor pack |
| 13 | Measure every month | Lead (or schedule) | `measure.mjs --init` once, then `.pewp/measure/run.mjs` (`stages/measure.md`) | `measure/<date>/`, diff | changes count only under the significance rules | TR-250..252, measure pack |
| 14 | Local search (map pack, Business Profile) | Lead + owner captures | `local-run.mjs`, `local-grid.mjs` (`stages/local.md`) | local tables, grid heat map | grid captures are Google Maps viewport captures (method, viewport read back); a footer is read only for a mobile search capture | TR-218 local |
| 15 | Iterate | Lead -> owner | `scripts/iterate.mjs` (`stages/iterate.md`) | proposals (targets, plan deltas) | proposals need step 8 again | iterate stage |
| 16 | Client report | Lead | report.md -> the project's PDF tool | client PDF | plain words; no internal notes | TR-260 |

## What the owner gives us (once per client)
Search Console access for our Google account (the biggest single unlock: real searches, clicks, positions, index status);
free keys (Gemini, CrUX, Bing Webmaster after verifying the site); a Keyword Planner CSV export when available; the
Business Profile export; presence for the human-paced browser captures.

## Precedent (Francine & Eli, 2026-10-17 to 10-22)
Steps 0-6 and 12-13 were run on valleytovalleyrealty.com: 98 root causes (15 serious), 1 linking domain vs 7-9 for four
competitors, 46 search clusters on free estimates, 0% of 109 AI answers citing her, 86 old URLs mapped (74 same path,
8 approved redirects, 2 junk pages gone). Proof files: `runs/2026-10-22-*.md`.
