# Compare: old vs new, or us vs a competitor, side by side

Loaded only when the `compare <a> <b>` mode runs. Free sources only. Two sides, one table, plain words: which of the two
is faster, lighter, better labelled for search, easier for AI crawlers and better linked, which of A's problems B fixes, and what B
still lacks. **A number that was not measured is "n/a" with its reason, never zero; a problem that was not checked is "NOT CHECKED",
never "no problems".** Reading is the default: `compare.mjs` reads files that earlier stages saved and never crawls by itself.

## When to use it
| The user says | A | B |
|---|---|---|
| "is the new site better than the old one?" | the old live URL | the new site's preview URL, or its repo |
| "how do we compare with <competitor>?" | our URL | the competitor's URL (a polite snapshot of a public site) |
| "did the rebuild fix what was wrong?" | the old site's snapshot | the rebuilt site (preview URL) |
| "are we ready to launch?" | the live site | the preview, with `--launch-state-b preview` |

A and B are each a **live URL** or a **repo folder**. A URL needs a complete snapshot; a repo needs `.checks/` (the checker has run on it).
A repo has no running site, so its speed and weight are "n/a": audit its preview URL for those.

## Inputs (nothing else is loaded)
| Input | Where | Made by | When missing |
|---|---|---|---|
| Snapshot of each URL side | `<cwd>/site-checks/<host>/snapshots/<date>/` (newest COMPLETE one) | `live-target.mjs` | exit 1: "no complete snapshot for <host>: run live-target.mjs <url> first" |
| Checker results | `<snapshot>/.checks/causes.json` (repo: `<repo>/.checks/causes.json`) | the checker (`coordinator.md`) | root causes are NOT CHECKED; "what B fixes" cannot be judged (said plainly) |
| Authority | `<cwd>/site-checks/<host>/.pewp/authority.json`, or the other side's file when it holds this domain | `authority.mjs` | referring domains "n/a: run authority.mjs --target <host>" |
| Launch state | `--launch-state-a/-b`, else `.pewp/business.json` `launchState`, else `live` | intake or the user | `live` |
| Research (optional) | `.pewp/targets.json` of A, else of B; each side's `research/ai-citations.json`, `measure/<date>/citations.json` | `research.mjs`, `measure` | the two extra rows are left out |

## Steps
1. **Doctor, once per site** (`node "<skill>/scripts/doctor.mjs" <url>`) only if a side has no snapshot yet.
2. **Both sides need a snapshot taken with the same options.** For a client site pass its off-limits paths
   (`--exclude "^/home-search"`), never submit forms or log in. For your own preview add `--ignore-robots`. Use the same `--runs`
   (default 3) and similar `--max-pages` on both:
   `node "<skill>/scripts/live-target.mjs" <url> [-- --runs 3 --max-pages 16]` (run from PowerShell; it reuses a snapshot younger than
   7 days, `--fresh` forces a new one; the client site rate-limits, so reuse when you can).
3. **Run the checker on each snapshot** (the coordinator, repo root = the snapshot folder) so each side has a `causes.json`. Without it the
   comparison still runs but the root-cause rows say NOT CHECKED. Show the owner the worker count first (`plan.mjs <snapshot dir> --dry`).
4. **Authority, optional, free (15 to 30 minutes of disk reading):**
   `node "<skill>/scripts/authority.mjs" site-checks/<hostA>/.pewp/authority.json --target <hostA> --competitor <hostB>`: one run
   covers both domains, and compare finds a side's domain in the other side's file. A preview is not in the web graph (0 links, by design).
5. **Compare:** `node "<skill>/scripts/compare.mjs" <a> <b> [--cwd DIR] [--launch-state-b preview] [--strict]`.
   `--refresh` runs `live-target.mjs` for each URL first (REUSE or a new snapshot; options after `--` go to the crawler).
   `--strict` exits 1 when any warning (below) fired, for a gate that must compare like with like.
6. **Read `compare.md` to the owner**: the short answer, then the "Read this first" warnings if any, then the table, then
   "What B fixes from A" and "What B still lacks". Do not add a number that is not in `compare.json`.
7. **Save the proof** `runs/<date>-compare.md`: the exact command, exit code, the first 40 lines of output, the warnings, the doctor
   result. No file = NOT DONE.

## What the table compares (the six measures)
| # | Measure | Taken from | Better is |
|---|---|---|---|
| 1 | Speed: typical LCP (median over pages), slowest page, typical TBT, worst CLS | the snapshot's real-Chrome phone runs (median of `runs` each) | lower; within 10% counts as "same" (lab noise) |
| 2 | Page weight: typical and heaviest page (KB), requests per page | the same runs' downloaded bytes | lower; within 5% is "same" |
| 3 | Structured data: share of rendered pages with JSON-LD, and the kinds found | the rendered pages (repo: the built HTML) | higher |
| 4 | Root causes by severity (critical, high, medium, low, total) | `.checks/causes.json` | lower |
| 5 | AI crawler access: which of 11 named crawlers (GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Claude-SearchBot, Google-Extended, CCBot, Applebot-Extended, Bingbot, Googlebot) `robots.txt` refuses at the site root | the saved robots.txt | fewer refused |
| 6 | Referring domains and strength rank | Common Crawl graph (domain level, free) | more domains; lower rank number |
| extra | Pages asking to be left out of search (noindex) | the rendered pages | fewer |
| extra, when research exists | Researched searches that have a page; AI answers that cite the site | `targets.json` matched to each side's pages; `ai-citations.json` / `citations.json` | higher |

Below the table: **the same pages on both sites** (pages with the same path, load time and weight side by side), because medians over
different page sets can mislead. Every cell is `{value, source, fetchedAt, cacheFile}` in `compare.json`.

## What B fixes, what B still lacks
- **Fixed from A**: A's root causes none of whose checklist rule ids appear in B's causes. **Still in B**: A's causes that share a rule id with
  one of B's. **New in B**: B's causes that share no rule id with any of A's. Matching is by rule id (for example `SCH-001`), because cause
  ids (`C01`...) are renumbered in every run. A rule id fixed in one place but still broken in another counts as "still in B".
- **B still lacks**: B's critical and high root causes (each with its fix, marked when A has it too), plus every measure where A beats B and
  the difference is not by design. If B was never checked, the list says so and stops: that is UNPROVEN, not "nothing lacking".

## By design (a preview is not a defect)
When a side's launch state is `preview` (flag or `business.json`), these are listed under "By design, not counted" and never under
"what B still lacks": its noindex tags, a `robots.txt` that refuses every crawler, zero or few referring domains (it is not in the web graph),
and no AI citations. They come back as real defects the day the site launches: after launch, re-run compare with `--launch-state-b live`
(or set `launchState: "live"`) and the same cells count again. Say this to the owner in one sentence.

## Same options or the numbers lie
Compare reads `_site.json` and the saved phone runs of both snapshots and warns (section "Read this first") when:
| Warning | Why it matters |
|---|---|
| `runs` differ | a median of 1 run swings far more than a median of 3 |
| `max-pages` differ (when the snapshot recorded it) | different page samples |
| page counts differ by more than 25% | the medians cover different pages; use the "same pages" table |
| Chrome version differs | small speed gaps may be the browser |
| phone and network conditions differ | speed is not comparable at all |
| a snapshot is older than 7 days, or the two are more than 7 days apart | the site may have changed; re-take with `live-target.mjs --fresh` |
| a side has no checker results | its root-cause rows are NOT CHECKED |
Notes (not warnings): one side ignored robots.txt (a preview you own), different `--include` lists, a repo side with no speed, the research list
coming from one side's `targets.json`. Fix a warning by re-taking the snapshot with the same options, not by explaining it away. Lab numbers
swing from run to run: measure on an idle machine.

## Plain words for the owner
- One line first: "A is the old site, B the new one: B loads in 2.1 s against 5.0 s on a phone, has 3 root causes against 5, structured data on 100% of
  pages against 20%, and 0 websites link to it yet (it is a preview)." The generated `Short answer` has this shape; keep the numbers.
- Explain each term of art once (the generated "Words used" does): LCP, TBT, CLS, structured data, AI crawler, referring domain, root cause,
  noindex, robots.txt. Say "GEO" only as generative engine optimization; map coordinates are "geo-coordinates".
- Never write "B is better" when the cells say "same" or "n/a". Say what was not measured and what unblocks it.
- Competitors: the numbers describe a public snapshot taken politely; say so, and do not claim anything about their internals.

## Stop rules
- Never crawl inside `compare.mjs`. A missing snapshot is an instruction to run `live-target.mjs`, with the site's `--exclude` and rate limits.
- The live crawler's rules stay: honest user agent, robots.txt obeyed, one request every 4 s, a 429 waits 90 s and retries once, a second 429 stops
  (exit 3), no forms, no logins. A competitor's 403/429/503 ends that site's snapshot: record `BLOCKED - <site> refused the crawl - compare to a
  different competitor or ask the owner for a manual capture`.
- Two failed attempts at the same obstacle end it (global rule): write the BLOCKED line and go on.
- Outputs hold client content: `site-checks/` stays out of git. `compare-<hostA>-vs-<hostB>/` is created under `<cwd>/site-checks/`.

## Files written
`<cwd>/site-checks/compare-<hostA>-vs-<hostB>/compare.md` (plain words) and `compare.json`:
`a`, `b` (target, kind, launch state, snapshot, pages measured, runs, checker file), `shortAnswer`, `warnings[]` (`code`, `level` warn/info,
`text`), `rows[]` (`group`, `measure`, `key`, `a`, `b` as sourced numbers, `better` a/b/same/null, `lowerIsBetter`, `byDesign`, `note`),
`sameParts` (matched pages with both load times and weights), `fixedFromA[]`, `stillInB[]`, `newInB[]` (cause id, severity, rules, problem, fix,
pages), `stillLacking[]`, `byDesign[]`, `glossary`. A PDF or dashboard is built from this file, never retyped.

## Proof of the tooling
`node scripts/test-compare.mjs` (fixtures only: two fake snapshots, an old live site and a new preview, plus a repo side, a side without checker
results, differing options, and the research / gate / measure files for the `report-live.mjs` wiring; a network guard fails the run if anything
leaves the machine) and `node scripts/test-compare.mjs --mutants` (breaks one thing per check in a copy of the skill and requires the named
check to go red). Counts come from the output; the stage is not trusted on a green run alone.

## Related: what `audit-live` now takes from research and measure
`report-live.mjs` answers the six questions with whatever the earlier stages saved, and keeps a BLOCKED card (with what unblocks it) only for a
question whose data is missing: Q2 from `targets.json` against the snapshot's pages (searches with a page, searches that need a new one, pages
whose title and heading do not carry their search or the place, cannibalisation from `gate/report.json`); Q3 from `research/competitors.json`
and the SERP captures against the home page and each matched page (depth, schema, FAQ, AI crawler access, missing entities and questions; the
winners' speed is not measured); Q5 from `research/ai-citations.json` and `measure/<date>/citations.json` (run-weighted share, who is cited
instead, why). A previous `report.json` is kept as `report.prev.json` and the new report opens with what changed since it.
