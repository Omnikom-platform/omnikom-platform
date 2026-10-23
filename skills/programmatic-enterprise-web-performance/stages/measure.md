# Stage: measure (mode `measure <url>`, also the last stage of `build`)

Load this file only when the `measure` stage runs. It tells you how to collect real search data for a live site, diff it
against the last run, and write the plain-words summary. Almost everything is done by scripts with no model; the model
writes the summary and decides what to ask the owner. Free sources only (owner decision 2026-10-22).

The one rule above the others: **a source that is not connected makes that part BLOCKED with the exact step that unblocks
it. A number is never filled in from memory, from an older run, or from a guess.** BLOCKED is a result, not a failure.

## Inputs
| Input | Where | Who writes it | If missing |
|---|---|---|---|
| Target URL | the user | the user | ask |
| `targets.json` (clusters, queries, questions, target pages) | `<pewp>/targets.json` | the research stage | rankings, MSR-001/003/004/008 and AI questions are BLOCKED ("run research") |
| `business.json` (domain, market, competitors, phone/address for local) | `<pewp>/business.json` | intake | competitors are taken from `targets.json` instead |
| Search Console OAuth token | `~/.config/pewp/gsc-token.json` or `GSC_TOKEN_FILE` | the owner adds our Google account to the property, then we save a token | Search Console part BLOCKED |
| Bing key | `BING_WEBMASTER_KEY` | the owner (Bing Webmaster Tools, Settings, API access) | Bing part BLOCKED |
| CrUX key | `CRUX_API_KEY` | free Google Cloud key, "Chrome UX Report API" enabled | field-speed part BLOCKED |
| Gemini key | `GEMINI_API_KEY` | free key from aistudio.google.com | the API half of AI citations BLOCKED (owner captures still count) |
| Browser captures (rankings) | `<pewp>/captures/serp/*.json` (the folder `research-serp-import.mjs` reads; both capture formats are accepted) | the owner or a supervised session, by hand, at human pace | no city/device ranks, only Search Console's country-level average |
| Browser captures (AI answers) | `<pewp>/captures/ai/*.json` | same | only the Gemini API answers |
| Conversions | `<pewp>/captures/conversions.json` | the owner exports from analytics | MSR-009 BLOCKED |
| Authority | `<pewp>/authority.json` | `authority.mjs` (Common Crawl, domain level) | MSR-007 and referring-domain diff BLOCKED |
| Local NAP run | `<pewp>/local/<date>/nap.json` | `local-run.mjs` (see `stages/local.md`) | MSR-010 BLOCKED |

State lives where `state.mjs` puts it: a URL target keeps everything in `<cwd>/site-checks/<host>/.pewp/` (gitignored, client
content); a repo target in `<repo>/.pewp/`. Run from PowerShell.

## Steps
1. **Doctor.** `node "<skill>/scripts/doctor.mjs" <url>`. Read which sources are connected. Do not start asking the owner for
   five things at once: ask for what matters most first (Search Console access), as pickable options with the recommended one
   first (project rule: questions go as options, never as a prose list).
2. **Init (once per site).** `node "<skill>/scripts/measure.mjs" <url> --init --property sc-domain:example.com`. It writes
   `<pewp>/measure/config.json` and copies `run.mjs` next to it. Edit `config.json` for: the Search Console property (a
   domain property is `sc-domain:example.com`, a URL-prefix property is `https://example.com/`), `market` (country and
   language; volumes and positions are per country), `ai.questions` / `ai.runs` / `ai.gapMs`, `thresholds`, `budgets`,
   `competitors`, `authority.competitors`.
3. **Plan.** `node <pewp>/measure/run.mjs --plan`. It prints the windows, the number of API calls, the number of AI answers
   and the minutes they take, and which keys are set. It makes no call and writes nothing. The cost stops are in
   `budgets` (API calls 80, AI answers 60, URL inspections 20 by default); a plan over a stop is refused for that part.
   Show the plan to the user when the AI part is more than a few minutes.
4. **Run.** `node <pewp>/measure/run.mjs` (add `--fresh` to ignore the one-day cache; `--refresh-authority` to re-read the
   Common Crawl graph, 15 to 30 minutes of disk reading, only when a new quarterly release exists or the first time).
   `--today YYYY-MM-DD` exists for tests and for back-filling. Exit 0 means it ran; BLOCKED parts are in `summary.json`.
5. **Read** `<pewp>/measure/<date>/report.md` (deterministic, plain words) and `findings.json`. If you rewrite the summary,
   keep the one-line answer first, keep every number from `report.json`, explain each term of art once, and keep the BLOCKED
   list with its unblock steps. Never add a number that is not in `report.json`.
6. **Hand over.** Tell the owner: what changed, what to look at (the findings, by rule id), what is not measured yet and
   what unblocks it. Offer the schedule (below). Save the proof file `runs/<date>-measure.md` (command, exit code, first 40
   lines, doctor result).

## What each part collects
**Search Console** (`searchAnalytics.query`): two 28-day windows, the current one ending 3 days before today (the data is
final about 3 days late) and the 28 days before it. Per window six tables: by query, page, country, device, query x page,
query x device (the last one filtered to the market's country so the rank is a country-level position, not a world average).
Limits to remember: 1,200 queries per minute per site, 50,000 rows per day, 16 months of history, rows with rare queries are
anonymised so the query table never sums to the total (totals come from the device table). The position is an average over
impressions, an **estimate**, and it is country-level: it says nothing about a city.
**URL Inspection** (MSR-001): the planned pages, highest priority first, up to `budgets.inspect` (Google's quota is 2,000 a day
per property). It reports the index verdict and the coverage state the engine gives.
**Bing Webmaster** (JSON API only; the SOAP/POX endpoints were retired on 2026-08-31): daily query and page rows, aggregated
inside each window, position weighted by impressions. Bing's free quota is not stated on its pages (UNVERIFIED); stop on any 429.
**CrUX**: field data (real visitors, 75th percentile) for the origin and up to `crux.maxUrls` planned pages on phones.
"No field data" for a small site is **a recorded result**, not a failure: say so in plain words ("too few visitors for Google
to publish real-visitor speed yet") and rely on the lab run for speed.
**Rankings** of every target query: Search Console's average position (country-level, labelled estimate) plus imported browser
captures with city and device. See the rules below.
**AI citations**: Gemini free tier with Google Search grounding, plus imported owner captures. See the protocol below.
**Authority**: `authority.mjs` result, **domain level only** (Common Crawl sees distinct linking domains in one quarterly
release, not every link; compare sites with each other and runs with each other, never read it as an absolute count).
**Conversions**: imported only; without analytics access MSR-009 is BLOCKED.

## Rankings: where and on what
A ranking is only comparable with another measured at the same query, engine, source, **place, device and language**. The scripts
enforce it: a row missing location, device, language, source or date is rejected (listed in `rankings.json` under `rejected`),
and the diff compares only rows with an identical key (`rankingsNotComparable` counts the rest). Never average or compare across
places in your summary either.
Browser capture file (one result page per file, or an array):
```
{ "query": "we buy houses Tracy CA", "engine": "google|bing", "location": "Tracy, CA", "locationShown": "<what the page footer says>",
  "device": "mobile|desktop", "language": "en", "capturedAt": "2026-10-20T18:00:00Z", "capturedIn": "owner Chrome, signed out",
  "organic": [{ "position": 1, "url": "https://..." }], "localPack": [{ "position": 1, "name": "..." }], "ourBusinessName": "..." }
```
**locationShown is required in practice.** In the project's own 2026-10-17 run the location parameter was asked for a California
city and Google ignored it (the footer showed the browser's place). A capture whose `locationShown` does not contain the
requested city is kept under the place it really showed and marked `localized: false`; it never counts for the requested
city. To capture a city honestly the searcher must really be in it, or the page footer must confirm the place.
How to capture (the project precedent, the only automated-looking thing allowed): a person or a supervised session reads one
result page at a time at human pace, **at least 45 seconds apart, stops at the first robot check**, records date, place,
device and whether signed in. Never script Google at any scale, never rotate or disguise a client to get past a limit, never
fetch Google HTML from code. The project's older captures (`icm/work/p0.2/fresh/*.google.md`) can be converted:
`node scripts/measure.mjs <url> --import-md <dir> --device desktop [--queries ids.json]` (it uses research-serp-import's parser and
rejection rules and writes into `captures/serp/`); their `uule` location was not honoured,
so the converter marks them `localized: false` from their footer line and you must say that, not hide it.
A target query with no Search Console row has `position: null` with the note "no impressions in the window": it is not
ranked or too rare to measure. It is never replaced by a guess.

## AI citations (06 section 9.6 protocol; owner items 4 and "free sources")
Each question is sent as the user message alone (no system prompt), in the market's language, with grounding on, `ai.runs`
times (default 3), at least 60 seconds apart (`ai.gapMs`, default 60000). A citation is a source the engine returns or a URL in
the answer. We are cited when a cited host is our domain or an alias. The recorded unit is the **share of answers that cite us**
(`citedShare`, with `runs`), never a single answer; the diff compares shares, and a change counts when the cited count differs by
2 or more of the samples. Each row records question, engine, model, prompt, date, location ("not settable in the API" for Gemini),
cited sources with counts, competitors cited, answer hashes.
**Gemini terms**: the project's research (TRACKER-PROPOSAL T1b, 2026-10-18) found that the Gemini API terms forbid caching,
storing or monitoring grounded results and building a database from them; the owner decision of 2026-10-22 says to use the free
tier. The script therefore stores only cited domains, counts and a hash, never the answer text, never caches the raw response,
and **stays BLOCKED until `ai.geminiTermsAcknowledged` is set to true** after the owner has confirmed (the research stage reads the same
confirmation as `PEWP_GEMINI_TERMS_ACK=1`; `doctor.mjs` lists it as source `gemini-terms`). Tell the owner this once.
ChatGPT, Perplexity and Copilot are captured by the owner at human pace into `captures/ai/`: either JSON
`{ "question", "engine", "model", "capturedAt", "capturedIn", "location", "citedDomains": [..] }` (research-ai's `sources` field works
too) or the project's `AI-<ID>.<engine>.md` files (read with research-ai's parser); an answer without a date is rejected; one file per answer;
files of the same question and engine are grouped into one row, and fewer than 3 answers is flagged `lowSample`.
The free API does not report Google AI Overviews: those are only visible in owner captures, and the project's owner decision
(2026-10-18) is that AI Overviews are not tracked automatically. Say so instead of implying coverage.

## Outputs (`<pewp>/measure/<date>/`; re-running the same day overwrites it)
`gsc.json` `index.json` `bing.json` `crux.json` `rank-detail.json` `ai.json` `authority.json` `conversions.json` and the contract pair
`rankings.json` + `citations.json` (each has `status`
and, when not ok, `blocked: {source, reason, unblock}`), `findings.json` (findings by rule and the BLOCKED rules),
`diff.json` + `diff.md`, `summary.json` (status of each part, API calls used), `report.md`, `report.json` (headline,
numbers as `{value, source, fetchedAt, cacheFile}`, findings, BLOCKED sources). Raw API responses are in `<pewp>/cache/`
(keys are redacted; an error status is never cached).

## The diff and what counts as a real change (06 section 9.8)
| Thing | Counts as changed when |
|---|---|
| A position (Search Console) | moved 3 or more places, for a query with 50 or more impressions in both windows |
| A position (browser capture) | moved 3 or more places between captures with the identical key |
| Clicks | the new count is outside the 95% Poisson interval of the old one |
| AI citations | the cited count differs by 2 or more of the samples |
| Core Web Vitals | the 75th-percentile status (good / needs improvement / poor) changed |
| Referring domains | the new count is below the 95% Poisson interval of the old one (and only when the Common Crawl release differs) |
Anything smaller is noise and is not turned into a finding. The diff lists gains and losses, new and lost queries and pages, new
and lost citations, new and lost referring domains (if the linking-domain list was truncated the diff says so).

## Rules (checklist pack `measure`, all warnings, signals for the next research and iterate)
MSR-001 not indexed (planned page) · MSR-002 ranking worse or outside `topPositions` (with domains above us when a capture shows
them) · MSR-003 unplanned demand (query with at least `minImpressions` matching no cluster query, whole words after NFKC and
lowercasing) · MSR-004 low click-through at position 5 or better vs the expected curve · MSR-005 AI visibility (share fell, or
0 while a competitor is cited) · MSR-006 field speed not good or worse by status · MSR-007 authority (significant loss of
referring domains; link-intersect prospects still not linking) · MSR-008 two of our URLs compete for one target query and the
planned page is not first · MSR-009 traffic without conversions · MSR-010 local consistency (from `local-run.mjs`).
The expected-CTR curve is a **placeholder labelled UNVERIFIED** until the ruleset `ctr-curve.json` exists (the report prints
which curve was used). Every finding carries its significance rule and sourced evidence.

## Scheduling and cost
A run makes about 12 Search Console calls, up to 20 inspections, 2 Bing calls, a few CrUX calls and questions x runs Gemini
answers; no model tokens. Post-launch monitoring is this same run repeated: weekly is normal, **daily for the first 4 weeks
after a migration** (`stages/migrate.md`). Schedule `node <pewp>/measure/run.mjs` with `/schedule` or a CI cron; the cost per run
is the plan line. Do not run more often than the data changes (Search Console updates daily; Common Crawl quarterly).

## Pitfalls
- Comparing a Tracy phone capture with a San Jose desktop capture. The scripts refuse; so must you.
- Reading Search Console's average position as "we rank 6th in Tracy". It is a country average over impressions.
- A zero is not a failure when there is no data: say "not enough visitors yet".
- The domain property and the URL-prefix property are different data; a 403 means our account is not a user of that property.
- Authority from Common Crawl lags by a quarter and is domain level; do not promise link counts.
- Do not put a key in a file you commit; keys come from environment variables and the scripts redact them from the cache.
- Do not "fix" a BLOCKED part by running the stage on a different property or by quoting an old run.

## Proof
**UNPROVEN against the live services.** Every API client (Search Console, URL Inspection, Bing, CrUX, Gemini) follows the
documented request and response shapes and is tested on a local fixture server only; the first real run with the owner's
credentials is the first proof, and the first thing to read in its `summary.json` is any part that came back BLOCKED with an
unexpected reason. Do not describe a part as working until a real run has produced it.
The folder `rankings.json` + `citations.json` follows the contract of `targets-validate.mjs --measure <dir>` (the plan stage reads
it); `rank-detail.json` and `ai.json` hold the richer rows (tablet, local pack, per-answer hashes).
`node scripts/test-measure.mjs` (fixtures only: a local server for the APIs, a fake Common Crawl graph, two measure dates,
BLOCKED paths) and `node scripts/test-measure.mjs --mutants` (watched-fail). Real runs are BLOCKED until the owner connects
Search Console; say so in `runs/<date>-measure.md`.
