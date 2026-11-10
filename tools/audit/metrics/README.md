# Metrics collectors (work order 33; product rows B21 and C16)

One module per source, the validators, the monthly report and a command line. They fill `metrics_snapshots`
(`supabase/migrations/20261028000001_platform.sql:156-161`: primary key `(workspace_id, source, day)`, `data jsonb`) and the
report reads those rows back. Platform loads these modules from a Deno edge function (its block 6: B20, B21, C16).

## The rules every module follows

- **Deno-loadable.** No module except `cli.mjs` imports `node:` or touches `process`; nothing reads a file or the environment.
  A collector takes `{ fetch, keys, workspaceId, day, ... }` (keys are passed in by variable name: `PSI_API_KEY`,
  `CRUX_API_KEY`, `BING_WEBMASTER_KEY`; Search Console takes an OAuth `token`; no model key, DECISIONS 38). A test enforces it.
- **Returns `{ row, calls, notes }`.** `row = { workspace_id, source, day, data }` (the table's shape), `calls = [{ what, status }]`
  (one per request, no key in it), `notes` = plain sentences about what was skipped or refused.
- **A source that cannot be read is a BLOCKED row**: `data.blocked = { reason, unblock }` (no key, no verified property, a 403 or
  429). A number is never filled in from a guess or an older run. Any 429 or 403 stops that source.
- **Validated before it is returned.** `shapes.mjs` has one `validate<Source>Row(row)` per source, returning a list of problems;
  an invalid row is a thrown error, never a written row.
- **Every request has a time limit** (`AbortSignal.timeout`, 30 s; 60 s for PageSpeed). A network error is scrubbed of
  every key before it reaches a row or a note.

## Row shapes (`data`)

### search-console
`{ property, window: { start, end }, totals: { clicks, impressions, ctr, position }, queries: [...], pages: [...], sitemaps: [...] }`.
`queries` and `pages` hold up to 25 items `{ key, clicks, impressions, ctr, position }`. `sitemaps` is the list the API returns:
`{ path, lastSubmitted, isPending, errors, warnings }`. The window is one day, two days before `day` (Search Console data lags);
a 28-day baseline passes `start` and `end`. No rows for the window means zero clicks and impressions and `position: null`.
`submitSitemap({ fetch, token, property, sitemapUrl })` is C16 (Search Console `sitemaps.submit`, a PUT); it returns
`{ ok, status, calls }` or `{ ok: false, blocked }` and writes no row. **Live: UNPROVEN** until the owner verifies a property.

### pagespeed
`{ strategy: "mobile", pages: [...], crux, failures? }`. `pages` holds one to five items
`{ url, performance (0 to 100), lcpMs, cls, tbtMs, fcpMs, speedIndexMs, field }`; `field` is the page's own field data
`{ lcpMs, inpMs, cls }` when PageSpeed returns it for that address, else `null`. `crux` is the origin's CrUX p75 on phones, in
one of three forms: numbers `{ origin, formFactor: "PHONE", lcpMs, inpMs, cls, collectionPeriod: { first, last } }`;
`crux.none` = `{ origin, none: true, reason }` when CrUX answers HTTP 404 (no record for the origin: a result, not an error);
or `{ origin, blocked: { reason, unblock } }` (no key, 403, 429, an answer that is not the documented shape). CrUX lives inside
this row because both are speed and weekly, and the table has no `crux` source. A page whose answer has no score is listed under
`failures` and left out of `pages`. Gap between pages: 2 s.

### bing
`{ site, window, totals: { clicks, impressions }, queries: [...], pages: [...], crawl, indexnow }`. Query and page items are
per-key sums over the window, position weighted by impressions. `crawl` is the newest GetCrawlStats row on or before the window's
end `{ date, crawledPages, crawlErrors, code4xx, code5xx, inIndex }` or `null`. `data.indexnow` is the day's IndexNow pings
`[{ at, urls, status, endpoint }]` (the key and the key file's address are never stored); a second publish the same day
appends (`appendIndexNow`), and `collectBing({ indexnow })` carries the list into a rebuilt row, a BLOCKED row included.
`indexNowPing({ fetch, host, key, keyLocation, urls })` posts to `https://api.indexnow.org/indexnow`; 200 and 202 are taken, a
422 or 429 is recorded with its real status. The site must host the key file (platform's factory): **live ping UNPROVEN**.
`listBingSites` (GetUserSites) says which sites the key can read and whether each is verified.
**The table's CHECK does not allow `source = 'bing'` today**; platform's block 6 migration adds it, and until it lands a `bing`
row cannot be inserted.

### ai-answers
Exactly platform ruling 5-P4 and the skill's 5d shape: one row per workspace per run day, `data = { date, rows }`, each inner row
`{ promptId, prompt, engine, named, cited, pageCited, asked_at, evidence_url, evidence_excerpt }` (`data.rows`). `engine` is one of
`chatgpt`, `perplexity`, `gemini`; `named` and `cited` are `true`, `false` or `null` (not both null); `asked_at` is a day;
evidence is a URL or a dated excerpt. **No model is called here**: DECISIONS 38 keeps every model API out of runtime code, and
`tools/audit/` is runtime (`docs/blueprint/specs/check-no-model.mjs`, a CI gate). The answers come in as `captures`, already in the
inner shape: the skill's measure stage (its own Gemini check, which that decision allows) or an owner's ChatGPT or Perplexity
capture. An invalid one is refused with a note, never written; no captures is a BLOCKED row. A test runs the skill's
`validateAiAnswerRow` and ours over the same rows.

## The monthly report
`monthlyReport({ rows, month: "2026-10", site: { name, domain } })` returns markdown in plain words for a business owner. Search
Console and Bing one-day windows are summed over the month (a row that covers several days is used only when the month has no
one-day row); PageSpeed and AI answers use the newest row of the month. Each part compares with the previous month when rows exist
and says "not connected yet: <what unblocks it>" for a BLOCKED or missing source. Every number in the text is a value of a row or a
sum, average, percentage or seconds figure worked out from rows (a test traces each one). No em dash leaves it.

## Command line
`node tools/with-env.mjs ".secrets/api-keys.env" -- node tools/audit/metrics/cli.mjs <command>`; commands `pagespeed`, `crux`,
`bing`, `ai-answers`, `search-console`, `report` (options in the file's header). Live runs are small: at most 5 pages.
Anything about to be printed or written is checked against every key value first and refused if one is in it.

## Fixtures (`fixtures/`)
No fixture holds a key or a token; a test scans for one. All were written by hand from the API documentation (no live recording
yet), with invented hosts (`example-property.test`, `example-shop.test`).
- `search-console.json`: searchAnalytics.query answers (totals, queries, pages, an empty one), a sitemaps.list answer and a 403
  error body. From https://developers.google.com/webmaster-tools/v1/searchanalytics/query and .../v1/sitemaps/list.
- `pagespeed.json`: PageSpeed v5 answers (good with field data, slow with the origin fallback, no score, a 429 error) and CrUX
  queryRecord answers (good, 404, no metrics). From https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed
  and https://developers.google.com/web/tools/chrome-user-experience-report/api/reference.
- `bing.json`: GetUserSites, GetQueryStats, GetPageStats, GetCrawlStats answers (`{ d: [...] }`, dates as `/Date(ms)/`), an answer
  without the array, an error body. From https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi
  (the response field names are the interface's; the JSON wrapper `d` is how the endpoint answers).
- `ai-answers.json`: captured inner rows, two valid and six invalid, one per rule (written by hand from the 5d shape,
  `tools/audit/proof/5d.md`).
- `report-rows.json`: twelve metrics_snapshots rows for September and October 2026 (made by hand; the numbers are the ones the
  report test checks the text against).
- `malformed.txt`: an HTML error page where JSON was expected.
