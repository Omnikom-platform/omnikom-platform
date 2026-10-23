Upgrade the skill `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance\` end to end.
First read every file in it (SKILL.md, coordinator.md, worker-prompt.md, scripts/*, checklist/*) and build on
its current state: families, root causes, causes.json, live-site snapshot, check scripts. Regress none of it;
`scripts/test-snapshot.mjs` and `scripts/test-plan-merge.mjs` must still pass.

## Why
Today the skill only answers "is this site built right?" (crawlable, fast, safe, valid). It never answers
"will this site get found, rank, reach the right people and get cited by AI engines, and what do we do about
it?" That second question is the purpose. A real enterprise agency does discovery, plans the site from search
demand, builds, QA-gates, then measures and iterates. The skill must do all of that, from any entry point.

## Modes (entry points): one skill, one router
The user's words pick the mode; `/programmatic-enterprise-web-performance <mode> <target>` also works.
1. `audit-repo <path>`: a codebase.
2. `audit-live <url>`: a live site, no code. Must answer in plain words: "you're not showing up because A, B,
   C; here's how to fix each; here's how we'll know it worked."
3. `refactor <path>`: audit, then fix. Fix workers on a git branch/worktree, one root cause per fix. Each fix is
   proven by its check script going FAIL→PASS with no other check going PASS→FAIL. Never touch the main branch
   without the user's OK.
4. `build <business brief>`: from business details to a site that ranks from day one:
   intake → research → plan → build (builder) → gate → measure.
5. `compare <a> <b>`: old vs new site, or us vs named competitors, same options, side by side.
6. `research <business or url>`: discovery only.
7. `measure <url>`: post-launch tracking; re-runnable, diffed against the last run.
Each mode is a fixed sequence of stages. Write `modes.md` with each mode's stage sequence, inputs, outputs and
cost estimate.

## Stages: one file each under `stages/`, loaded only when that stage runs (2,000–8,000 tokens each)
State lives in `<target>/.pewp/state.json`: mode, stages done, output paths, dates. Every stage reads its
inputs from files and writes its outputs to files, so a run resumes after a compaction or crash, and any stage
can be re-run alone.

S1 Intake → `.pewp/business.json`: name, what it sells, to whom, where (locations, service areas), languages
and markets, goals (leads, sales, calls, bookings), known competitors, brand constraints, what exists already
(site, Search Console, Business Profile, socials). Find what you can on the site and the web; ask the user only
the rest, in one batch.

S2 Research → `.pewp/research/` + `targets.json`. Every number has a source and a date. Never invent volumes
or rankings; label estimates as estimates.
- Demand: seeds from the business, expanded through Ahrefs (matching terms, related terms, questions), Google
  autocomplete, People Also Ask, Reddit/forum questions, and Search Console queries if the site exists. For each
  keyword: volume, difficulty, intent (informational / commercial / transactional / local / navigational), CPC
  as the value signal.
- Clusters: keywords one page should rank for together (shared top-10 results). Each cluster gets a primary
  query, intent and value.
- SERP reality per priority cluster: who's in the top 10, which page type and format wins, depth and sections,
  SERP features (snippet, AI overview, local pack, video, shopping, PAA).
- Competitors: top competitors per cluster and overall; their top pages; the content gap (what they rank for
  and we don't); the entities and subtopics the winning pages cover.
- Adjacent demand: what the same audience searches outside the niche (neighbouring problems, local life, tools,
  guides); ideas for linkable assets.
- Authority: our referring domains and the competitors'; the link gap (sites linking to 2+ competitors but not
  us); local citation sources; digital PR angles.
- AI answers: ask ChatGPT, Perplexity, Gemini and Google AI Overviews the target questions. Record who is
  cited, which sources, whether we are, and what kind of source gets cited.
`targets.json` = clusters [{ id, primaryQuery, queries[], intent, volume, difficulty, value, serpFeatures,
winningFormat, competitorsTop3, requiredEntities[], questions[], targetPage: url | "new" }], plus
`research/report.md`.

S3 Plan → `.pewp/plan/`:
- `sitemap.json`: architecture from the clusters (one cluster = one page), hubs and spokes, slugs, and the
  internal-link plan (which page links to which, with what anchor).
- `briefs/<page>.md`, per page: primary query, intent, title, H1, meta description, outline, entities to cover,
  questions to answer, proof and statistics to include, schema type, internal links in and out, CTA, and a word
  range taken from the SERP.
- Programmatic pages (locations, listings): data source, the quality gate that stops thin pages, and what makes
  each page unique.
- Off-site: a link and digital-PR plan from the link gap; a local plan (Business Profile categories, citations,
  name/address/phone consistency, reviews); an AI-visibility plan (entity consistency, sameAs,
  Wikidata/Wikipedia eligibility, citable stats, llms.txt, getting into the sources the engines cite).
- Priorities by impact × effort, quick wins first.

S4 Build / Fix: in `build` mode the briefs go to the builder (another session or agent) as its spec; in
`refactor` mode, the fix workers above do the work.

S5 Gate: the existing checker, plus new target checks, deterministic against `targets.json` and `plan/`:
- every cluster has exactly one page, and no two pages target one primary query (cannibalisation);
- each page's title, H1 and first paragraph carry its primary query or a close variant;
- the brief's sections, entities and questions are on the page;
- the planned internal links exist with sensible anchors, and there are no orphan pages;
- the planned schema type is on the page;
- programmatic pages pass their quality gate.
Same style as the existing check scripts: test the output, not the code's shape.

S6 Measure → `.pewp/measure/<date>/` plus a diff against the last run:
- Search Console API (clicks, impressions, CTR, position per query and page) and Bing Webmaster;
- rankings for every target query (Ahrefs / SERP data);
- AI citations: re-ask the target questions and record cited yes/no, position, and who got it instead;
- backlinks gained and lost; Core Web Vitals field data (CrUX API, free) next to the lab numbers;
- conversions, if analytics access is given.
`measure/run.mjs` re-runs it with no model needed except to write the summary.

S7 Iterate: measure results → which clusters underperform and why → updated briefs and next actions.

## The audit-live report must answer, in this order
1. Can search engines and AI crawlers reach and read the site? (the existing checklist)
2. Is there a page for what people actually search? (research vs pages: missing pages, wrong intent,
   cannibalisation)
3. Is each page better than what ranks now? (vs the SERP winners: depth, entities, format, proof, speed)
4. Does the site have the authority to rank? (links, mentions and local citations vs competitors)
5. Is it cited by AI engines? If not, who is, and why?
6. What to fix, in order, with expected impact, effort, and the check or metric that proves each fix.
Root causes first (existing grouping), then the plan. Plain words; every term of art gets a one-line explanation.

## Data sources: find, connect, never fake
- On this machine: Ahrefs and Similarweb MCP plugins (they need `authenticate`), and the claude-in-chrome
  browser. Search Console and Bing need the owner's OAuth. CrUX and PageSpeed Insights need free API keys.
  OpenAI, Perplexity and Gemini need API keys (or the browser).
- Before any research or measure stage, run a `doctor` script that lists each source as connected, needs auth
  (with the exact step for the user), or not available. A missing source makes that part BLOCKED, with what
  unblocks it, said in plain words. Never fill it from memory.
- Respect site terms and rate limits: use APIs, and don't scrape Google results in ways its terms forbid.
- Cache every external response, with its date, under `.pewp/cache/`, so re-runs don't pay twice.

## Naming fix
In our reports "GEO" means Generative Engine Optimization (AI engines); map coordinates are "geo-coordinates".
Fix every place that mixes them, in the skill and in its checklist labels.

## shipgate spec is growing
The shipgate spec is getting new packs for intake, research, plan, targets and measure. When they land,
`scripts/build-checklist.mjs` must pick them up, so keep its parser tolerant of new pack files and rule prefixes.

## Cost
- Before any run, print the plan: mode, stages, worker count, external API calls and rough usage. Ask before
  large runs.
- Research is mostly API calls, not model tokens: scripts do the fetching, and workers get compact tables, not
  raw dumps.

## Done means it ran
- The existing self-tests still pass, plus new self-tests per stage on fixtures (a targets.json validator,
  cannibalisation and missing-page checks, the measure diff).
- One real end-to-end run per mode on a site of ours, with the outputs pasted. Any mode that couldn't run
  because a source isn't connected is reported BLOCKED, with what unblocks it.
- Update SKILL.md (a router table: situation → mode), coordinator.md, worker-prompt.md and the skill
  description, so the skill also triggers on "why am I not ranking", "audit this link", "plan a site that
  ranks", "refactor for SEO" and "track our rankings / AI citations".
Report back: what was built, what each self-test printed, which modes ran end to end, and what is BLOCKED and why.

## Added in review (Lead, 2026-10-22): gaps the prompt above missed
1. **Migration mode** (`migrate <old url> <new repo|url>`): replacing an existing site is where rankings are lost.
   Inventory every old URL (sitemap + crawl + Search Console pages + Ahrefs top pages and pages with backlinks),
   map each to its new URL (one-hop 301, no chains, nothing to the homepage by default), carry over titles and
   content that rank, take a ranking/traffic baseline BEFORE cutover, and monitor daily for 4 weeks after.
   Gate check: every old URL with traffic or links resolves to a 200 on the new site in one hop.
2. **Local search is its own channel**, not one SERP feature: Business Profile audit (primary/secondary
   categories, services, photos, posts, review count/rating/recency vs competitors, owner replies), local-pack
   rank tracking per city/neighbourhood (grid or per-service-area location, mobile), citation consistency
   across directories, and service-area pages that are not doorway pages.
3. **Rankings are location- and device-specific**: every tracked query records the location (city/ZIP),
   device and language it was measured for; never compare numbers measured from different places.
4. **AI answers vary run to run**: ask each target question N times (default 3) per engine, record the
   share of runs that cite us, and diff shares, not single answers. Record the exact prompt, engine, model,
   date and location.
5. **Trust (E-E-A-T) and regulated industries**: for YMYL niches (real estate, finance, health, legal) check
   visible credentials (licence numbers, brokerage, author bios), reviews and testimonials with sources,
   about/contact completeness, and industry claim rules (e.g. fair housing, lending, advertising rules) as a
   per-industry rules file the business brief selects. Missing trust signals are findings with fixes.
6. **Reuse research that already exists**: S1/S2 first look for existing keyword maps, competitor audits and
   SERP captures (in the target repo or a path the user gives), import them with their sources and dates, and
   buy only what is missing or stale (older than a set age, default 30 days).
7. **Where state lives for a URL target**: `audit-live`, `compare`, `research` and `measure` on a URL write to
   `<cwd>/site-checks/<host>/.pewp/` (gitignored, client content). The live crawler's rules stay: polite,
   honest user agent, robots, 429 stop, `--exclude` for off-limits paths, no form submits, no logins, run from
   PowerShell.
8. **Client-ready output**: each mode ends with `report.md` written for a non-technical owner (one-line answer
   first, plain words, every term explained once) plus `report.json` with every number and its source, so a
   PDF or dashboard can be built from data, never retyped.
9. **Proof standard for the self-tests**: every new check and stage test gets a watched-fail (break the thing
   it guards, see it go red for the right reason, restore). End-to-end runs for this upgrade use our own
   targets: `audit-repo` and `refactor` on `E:\Francine & Eli\proposals\vtv` (refactor on a branch, never
   main), `audit-live` / `compare` / `research` on https://valleytovalleyrealty.com vs
   https://francine-omnikom-website.pages.dev (her site excludes `^/home-search`), `build` on a small fixture
   brief, `measure` BLOCKED until Search Console access exists (say so).

## Fable 5.1 review (2026-10-22): verdict NOT READY as one run; these fixes are part of the prompt
Verified by the Lead: no OpenAI/Perplexity/Gemini/CrUX/PSI/Ahrefs/SERP keys in the environment; Ahrefs and Similarweb
plugins expose only `authenticate`; workers have unrestricted Write/Edit (`launch-workers.mjs:48`); stray `tmp-*.mjs`
files sit in `proposals/vtv/.checks/` outside `scripts/`.
1. Data access is decided per source BEFORE S2 is built: MCP tools only work inside a Claude session (not from Node,
   not in headless workers). Either the coordinator calls the MCP and caches every response under `.pewp/cache/` for
   scripts, or a REST API with a key and a hard per-run unit budget enforced in the fetch script. Confirm the Ahrefs
   plan includes API/MCP access first.
2. `doctor` = a Node part (env keys, cache age, Chrome, token files) + a coordinator step that calls each MCP once;
   result in `.pewp/doctor.json` with connected / needs auth (exact user action) / not available.
3. No direct Google fetching in code. Top-10 and SERP features: Ahrefs SERP overview. AI Overviews, People Also Ask,
   autocomplete: a paid SERP API (DataForSEO or SerpApi) or BLOCKED with its price.
4. AI engines by API only (OpenAI Responses with web search, Perplexity Sonar, Gemini with Google Search grounding);
   never the consumer UIs through a browser. No key = BLOCKED.
5. Build in gated phases, each in a fresh session from a plan file, each ending with pasted proof:
   P1 router + state.json + doctor + cache + report.json schema + `audit-live` answering Q1 with BLOCKED cards for Q2-5;
   P2 S2 research + targets.json validator + S5 target gate; P3 refactor; P4 measure + migrate; P5 build + local/GBP.
6. Audit modes never edit source, enforced: `git status --porcelain` after the run fails on any path outside
   `.checks/`/`.pewp/`. Refactor workers get a worktree the coordinator made, `Bash(node:*)`, never push, never deploy.
7. Refactor on generated sites fixes the generator, rebuilds, then runs the check (a pass without a rebuild proves nothing).
8. Local grid ranks, Business Profile audit and citations need a provider (GBP API with owner OAuth, Local Falcon or
   BrightLocal) or are written as BLOCKED; a public Maps listing may be read once by hand and recorded with a date.
9. `rankings[]` names its source (Ahrefs Rank Tracker project id in business.json, or Ahrefs organic keywords labelled
   "estimate, country-level"); the validator rejects rows missing location, device, language, source, date.
10. Numeric cost stops in `modes.md`, enforced in scripts: max Ahrefs units, max API dollars, max worker-minutes,
    max questions x engines x runs. Post-launch monitoring = re-running `measure` (owner or /schedule), cost per run stated.
11. S5 checks defined deterministically: query match = >=80% token overlap after stemming and stop words; an anchor shares
    >=1 content token with the target's primary query and is never "click here"/"read more"; programmatic gate numbers
    live in `plan/programmatic.json`.
12. Fixture test for `audit-live`: report.md has the six questions in order; each finding links a rule id or metric;
    every number in report.json is `{value, source, fetchedAt, cacheFile}`; each glossary term is explained once.
13. `business.json.launchState`: a preview that is noindex by design is reported "not indexable by design", not a P0.
14. Intake questions are asked by the main session (pickable options); the coordinator receives a complete
    business.json or returns the question list and stops.
15. State layout: `site-checks/<host>/snapshots/<date>/` + `site-checks/<host>/.pewp/`; for repo targets research,
    plan and targets are committed, cache is not; `.checks/` stays the gate output.
16. Reuse a snapshot younger than 7 days by default (`--fresh` forces a new one): the client site rate-limits.
17. Proof of each mode: `<skill>/runs/<date>-<mode>.md` with the exact command, exit code, first 40 lines of output and
    the doctor result; no file = NOT DONE.
18. `rules/industries/<slug>.json` with checkable items (licence-number pattern per state, brokerage name on every page,
    fair-housing forbidden words, required disclosure pages) + a fixture that fails on a missing licence number.
19. Wording fixes go in the generator (`build-checklist.mjs` rebuilds `checklist/`); today's grep found no GEO mix-up
    in the checklist (only PCF-002, DAT-011, correctly coordinates), so the fix is in the report writer and labels.
20. Shipgate repo path goes in `machine.local.json`; build-checklist reads it; a self-test with a fake new pack file.
21. `fixtures/`: a targets.json, a 6-page static site with one cannibalisation, one missing cluster page, one orphan,
    one wrong schema type, and a two-date measure pair.
22. CrUX "no field data" is a recorded result, not a failure; PageSpeed Insights is optional (real-Chrome lab exists).
23. E2E plan output on `proposals/vtv` is a skill test artefact under `site-checks/` or scratch, not a project blueprint
    (Phase 1 sign-off rule).
24. SKILL.md test counts come from the test output (now 21 and 14); `merge.mjs` warns on unexpected files under `.checks/`.
25. `business.json.market = {country, language}` required, and on every keyword row (volumes are per country).

## Owner decision (2026-10-22): FREE sources only; we build our own alternatives (supersedes every paid source above)
No paid tools or APIs (no Ahrefs, Similarweb, DataForSEO, SerpApi, paid OpenAI/Perplexity). Each need maps to a free source:
- Backlinks and authority: Common Crawl's free web graph, already cached at `D:\seo-kit-cache` (release
  cc-main-2026-jul-aug-sep: domain vertices, edges, ranks; 12 GB). Port `E:\Francine & Eli\tools\seo-kit\backlinks.mjs`
  into the skill (referring domains, strongest linkers, harmonic-centrality/PageRank position, link gap vs competitors).
  Domain level only; label it so; refresh when a new quarterly release appears. Cache path in `machine.local.json`.
- Competitor and SERP-winner page audits: port `tools/seo-kit/audit.mjs` (polite crawler, robots first, stop at 403/429).
- Real search demand and rankings: Google Search Console API (free, owner OAuth: queries, clicks, impressions, average
  position per page/country/device) and Bing Webmaster Tools API (free key, includes keyword volumes).
- Keyword expansion: Google Ads Keyword Planner export (free account; imported as a file, volumes are ranges),
  Wikipedia pageviews API (free) for entity demand, Reddit/forum questions via public endpoints at their rate limits.
- Google results, People Also Ask, autocomplete, AI Overviews, local pack: owner-supervised browser capture at human
  pace (the project's 2026-10-17 precedent: one page at a time, at least 45 s apart, stop at the first robot check),
  recorded with date, location and "captured in browser". Never automated scraping at scale.
- AI citations: Gemini API free tier with Google Search grounding (free AI Studio key); Claude's own web search;
  ChatGPT and Perplexity by owner-supervised browser capture at human pace, or BLOCKED. Repeat-and-share rule (item 4) applies.
- Speed field data: CrUX API and PageSpeed Insights (free keys).
- Local: Business Profile via the owner's free API access (OAuth, needs approval) or a dated manual capture.
`doctor` lists each of these as connected / needs a free key or login (exact step) / not available.
