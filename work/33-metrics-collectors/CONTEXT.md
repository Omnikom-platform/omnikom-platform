# 33 metrics collectors and the monthly report (B21, C16)

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/metrics-collectors. Status: OPEN (head of operations
2026-11-10 12:15).

## Why
`docs/product/1-product.md` rows B21 "Search and AI visibility numbers" and C16 "Metrics pull and sitemap submit" are MISSING.
`docs/product/7-sites.md:118-124` names the sources: Search Console daily, PageSpeed weekly on five pages and at every launch,
CrUX weekly, Bing and IndexNow on every publish, AI answers monthly; all land in `metrics_snapshots` with source and day; a
monthly plain-words report is generated from the rows. Platform builds the scheduled function and the overview screen later
(its block 6: B20, B21, C16) and will load these collectors from a Deno edge function. This order builds the collectors, the
row shapes, the report and their tests. It does not touch `supabase/`.

## What exists (read, do not rebuild)
- The table, `supabase/migrations/20261028000001_platform.sql:156-161`: PK `(workspace_id, source, day)`, `data jsonb`,
  `source in ('search-console', 'pagespeed', 'ai-answers', 'uptime')`. One row per workspace per source per day.
- Platform ruling 5-P4, `docs/departments/platform-build.md:127-138`: for `ai-answers`, one row per workspace per run day, the
  per-prompt, per-engine rows inside `data.rows`; each inner row has prompt id, engine, named bool, cited bool, asked_at and
  evidence (answer URL or a stored excerpt with a date).
- The skill already has collectors for its `measure` stage (`skills/programmatic-enterprise-web-performance/scripts/`):
  `psi.mjs` (`readAnswer`, PageSpeed), `measure-sources.mjs` (`gscQuery`, `gscInspect`, `bingCall`, `bingAggregate`,
  `cruxQuery`, `geminiAsk`, `aiRowsFromCaptures`), `measure.mjs` (`validateAiAnswerRow`, `aiAnswersSnapshot`: the 5d
  inner-row contract, `tools/audit/proof/5d.md:54`). Read them for the API calls and the response parsing. Do not edit the
  skill (its outside SOURCE copy must be synced on purpose; not in this order).
- Key names (`tools/check-api-keys.mjs`): `PSI_API_KEY`, `CRUX_API_KEY`, `BING_WEBMASTER_KEY`, `GEMINI_API_KEY`. Search
  Console uses OAuth (`lib-google-auth.mjs` in the skill); the owner has not verified any property, so it is fixtures only.
- The audit tests: `tools/audit/test/run.mjs` (lines "ok"/"FAIL", last line "OK: N of N checks passed") and
  `tools/audit/test/mutate.mjs` (`MUTANTS`: `[name, file, from, to]`, `MUTATE_ONLY=<regex>`). CI runs both
  (`.github/workflows/ci.yml:130,132`).

## Decisions already made (head)
1. Code goes in `tools/audit/metrics/` (repo only). One module per source plus `shapes.mjs` (the validators) and
   `report-monthly.mjs`. A CLI wrapper `tools/audit/metrics/cli.mjs` is the only file that may touch Node (`node:fs`,
   `process.env`).
2. Deno-loadable: every collector module imports nothing from `node:` and reads no file and no env. It takes
   `{ fetch, keys, workspaceId, day, ... }` and returns `{ row, calls }` where `row = { workspace_id, source, day, data }`, or a
   BLOCKED row: `data.blocked = { reason, unblock }` (for example no key, no verified property). A number is never filled in
   from a guess or an older run. A test asserts no collector file contains `from "node:` or `process.`.
3. Sources and rows (fit the table as it is, except one):
   - `search-console`: totals for the window (clicks, impressions, ctr, position), top queries and pages (capped), the
     sitemap list with its last submit and errors. `submitSitemap({ fetch, token, property, sitemapUrl })` is the C16 submit
     (Search Console `sitemaps.submit`). Fixtures only; live UNPROVEN until the owner verifies a property.
   - `pagespeed`: five pages, mobile; per page the lab numbers (performance score, LCP, CLS, TBT, FCP, Speed Index) and the
     page's field data if PSI returns it; plus `data.crux`: the origin's CrUX p75 for LCP, INP, CLS (PHONE) with its
     collection period, or `crux.none` when CrUX has no record for the origin (HTTP 404 from CrUX is "no data", not an error).
     CrUX goes inside this row: both are speed, both weekly, and the table has no `crux` source.
   - `bing`: Bing Webmaster query and page stats for the window, crawl errors if the API gives them; plus `data.indexnow`: the
     day's IndexNow pings (`[{ at, urls, status, endpoint }]`; a second publish the same day appends to the same day's list).
     `indexNowPing({ fetch, host, key, keyLocation, urls })` posts to `https://api.indexnow.org/indexnow` (the protocol at
     indexnow.org). The site must host the key file; who publishes it is platform's factory, so live is UNPROVEN.
     **The table does not allow `source = 'bing'` today.** Build it anyway, and say so in the proof; the head sends platform the
     finding (one more allowed value).
   - `ai-answers`: exactly the 5-P4 / 5d shape. Reuse the meaning of `validateAiAnswerRow` (a test runs the skill's validator
     and ours over the same fixtures and expects the same verdicts). The live collector asks Gemini (`GEMINI_API_KEY`, free
     tier) and marks named/cited by the site's domain and name; captures from other engines are accepted as input rows.
4. `shapes.mjs`: one `validate<Source>Row(row)` per source, returning a list of problems. Every collector's output is validated
   before it is returned; an invalid row is a thrown error, never a written row.
5. `report-monthly.mjs`: `monthlyReport({ rows, month, site })` -> markdown in plain words for a business owner (no jargon:
   "people who saw you in Google", "how fast your pages open on a phone", "AI assistants that named you"). It compares with
   the previous month's rows when they exist, and says "not connected yet: <what unblocks it>" for a BLOCKED or missing source.
   Every number in the text comes from a row (a test checks each number in the output appears in the input rows). No em
   dashes.
6. Shapes are written up in `tools/audit/metrics/README.md` (doc 22 is archived; the head will ask for a pointer from
   `7-sites.md`).

## Hard rules
- Free sources only, keys by variable name only: the CLI loads `.secrets/api-keys.env` into the environment (see how
  `tools/check-api-keys.mjs` reads it, or run through `tools/with-env.mjs`), never prints, stores or copies a value. Fixtures
  hold no key and no real token; scrub any recorded response (gitleaks must pass).
- No new dependency. Scripts in files, never `node -e`.
- Every fetch has a time limit (`AbortSignal.timeout`).
- Machine memory is tight (a video job spikes to 7 to 9 GB): run only `node tools/audit/test/run.mjs` and the new mutants
  (`MUTATE_ONLY`), one at a time; never the full mutant run, never Chrome.
- Live calls are small and polite: PageSpeed on the five pages of our test site `https://preview.test-site-demo-a.pages.dev`
  (pick five real paths from its sitemap), one CrUX call for that origin (expect "no data") and one for a large origin to
  prove the parsing, Bing `GetUserSites` only (to see whether any site is verified; if none, the Bing row is BLOCKED with that
  reason), Gemini with at most 3 prompts. No IndexNow ping live (the key file is not hosted). Any 429 or 403: stop that source,
  record it BLOCKED.
- Do not commit or push; the head does. Do not touch `supabase/`, the skill, or another department's files.
- No em dashes anywhere you write.

## Steps
1. Read the inputs above. Write `tools/audit/metrics/` modules per decisions 1 to 5.
2. Fixtures in `tools/audit/metrics/fixtures/`: recorded or hand-built API responses for each source (good, empty, error,
   404/no-data, malformed), each with a line in the README saying where it came from (live run on date X, scrubbed; or written
   by hand from the API docs, with the doc URL).
3. Tests: add them to `tools/audit/test/run.mjs` (same "ok"/"FAIL" lines) or a file it runs: each collector against its
   fixtures (rows valid, BLOCKED rows when the key or verification is missing, 404 CrUX is `crux.none`, IndexNow appends on the
   same day), the validators refuse each missing field, the report (numbers trace to rows, month-on-month, BLOCKED wording, no
   em dash), the no-`node:` rule, the ai-answers agreement with the skill's validator.
4. Watched red: for every new assertion, a mutant in `tools/audit/test/mutate.mjs` (`[name, file, from, to]`, the `from`
   text must exist), run with `MUTATE_ONLY=<a regex matching your mutants> node tools/audit/test/mutate.mjs`; paste the line
   showing all caught, 0 survived, 0 target text missing.
5. Live run through the CLI (rules above): write `tools/audit/proof/metrics-collectors.md` with the commands, the pasted
   output, the rows produced (scrubbed of keys), and what is BLOCKED or UNPROVEN (Search Console, the IndexNow ping, Bing if no
   site is verified, `bing` not allowed by the table).
6. Also write `work/33-metrics-collectors/` notes only if needed; the brief is there already.

## Done means
`node tools/audit/test/run.mjs` ends "OK: N of N checks passed" with the new checks counted; the new mutants all caught; the
live proof pasted; the README states each row shape. Then message HEAD_SEO-and-audits_2026-11-09: what was built, the counts,
what is BLOCKED or UNPROVEN, and whether any shape differs from 5-P4 beyond the `bing` source.
