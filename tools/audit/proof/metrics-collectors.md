# Work order 33: metrics collectors and the monthly report (B21, C16): proof

Branch `check/seo/metrics-collectors` on master d7572f2, not committed. Date 2026-11-10. Built by the SEO builder session (Sonnet 5.5).
Product rows B21 (search and AI visibility numbers) and C16 (metrics pull and sitemap submit): the collectors, row shapes, report
and tests exist; the scheduled function and the overview screen are platform's (block 6). Nothing under `supabase/`, the skill,
or another department's files was touched.

## What was built (all under `tools/audit/`)
- `metrics/util.mjs`, `shapes.mjs` (the four validators + inner ai-answer validator), `search-console.mjs` (`collectSearchConsole`,
  `submitSitemap`), `pagespeed.mjs` (`collectPageSpeed`, `queryCrux`, `readAnswer`), `bing.mjs` (`collectBing`, `listBingSites`,
  `indexNowPing`, `appendIndexNow`), `ai-answers.mjs` (`collectAiAnswers`), `report-monthly.mjs` (`monthlyReport`), `cli.mjs` (the
  only file that touches Node), `README.md` (every row shape), `fixtures/` (6 files, each described in the README).
- `test/metrics.mjs` (the checks, called first by `test/run.mjs`), `test/mutants-metrics.mjs` (the mutants, spread into the list of
  `test/mutate.mjs`). `test/run.mjs` and `test/mutate.mjs` each gained two lines.

## Tests
`node tools/audit/test/run.mjs` (2026-11-10 16:14, through `heavy.mjs`, exit 0):
```
OK: 812 of 812 checks passed
```
134 of the 812 are the new `metrics` checks (`test/metrics.mjs`; run alone: `OK 134`). Every one is watched-fail through a mutant
(`test/mutants-metrics.mjs`, 218 entries, run only as `MUTATE_ONLY="^metrics"`, never the full list). The folder-holds-eight-modules check cannot be
broken by a text replacement; it was watched red by hand (an extra `extra.mjs` added, then `cli.mjs` renamed away: `FAILED 1 of 134` both times) and restored.

Mutant history, in the order it ran (the three-mutant and one-mutant reruns came after check fixes, so no single run covers all 218 against the final checks):
- Run 2, all 218: `213 caught, 2 survived, 3 not run, 0 target text missing`. The 2 survivors were crashes that carried no FAIL line (not a catch); the calls were wrapped so a throw is a red check.
- Rerun of those 2 after the fix: both caught ("bing: a ping drops the rest of the row", "a ping with no row makes a row of another source").
- 3 not run (queue timeout): `3 mutants, 2 caught, 1 survived, 0 not run, 0 target text missing`. The survivor ("no key and no captures is not named as the reason") passed because the fallback text also contains `GEMINI_API_KEY`; the check now requires the exact reason.
- Rerun of that one: `1 mutants, 1 caught, 0 survived, 0 not run, 0 target text missing`.
- Net: 218 of 218 caught, 0 survived, 0 not run, 0 target text missing. The checks behind the 5 reruns were edited after run 2, and the other 213 were not rerun against those edits (the edits only strengthen the checks; the full suite is green).
- Secrets and style: `gitleaks` on the new files found no leaks; no em dash in any written file.

## Live run (through `tools/with-env.mjs`, keys by variable name, none printed; `CLI` = `node tools/audit/metrics/cli.mjs`)
Test site `https://preview.test-site-demo-a.pages.dev`; five real paths from its sitemap. Workspace id is a made-up uuid.

### PageSpeed on five pages and CrUX on the origin
```
$ node tools/with-env.mjs ".secrets/api-keys.env" -- CLI pagespeed --workspace 00000000-0000-4000-8000-0000000000a1 --day 2026-11-10 --urls <the five> --out live-pagespeed.json
pagespeed 2026-11-10: row ok; 6 request(s): psi https://preview.test-site-demo-a.pages.dev/ 200, psi https://preview.test-site-demo-a.pages.dev/contact/ 200, psi https://preview.test-site-demo-a.pages.dev/homes-in-alpha/ 200, psi https://preview.test-site-demo-a.pages.dev/homes-in-beta/ 200, psi https://preview.test-site-demo-a.pages.dev/listings/12-alpha-lane/ 200, crux 404
```
The row (no key in it; the CLI refuses to write one): `strategy: "mobile"`, five pages, each `performance 100`, `cls 0`, `tbtMs 0`,
`field: null` (PageSpeed returned no field data for these addresses), lab numbers:

| page | lcpMs | fcpMs | speedIndexMs |
|---|---|---|---|
| `/` | 761 | 761 | 998 |
| `/contact/` | 771 | 771 | 810 |
| `/homes-in-alpha/` | 762 | 762 | 859 |
| `/homes-in-beta/` | 757 | 757 | 904 |
| `/listings/12-alpha-lane/` | 761 | 761 | 982 |

and `crux`: `{ "origin": "https://preview.test-site-demo-a.pages.dev", "none": true, "reason": "CrUX has no record for this origin (too few real visitors on phones yet)" }`.
The 404 from CrUX is `crux.none`, not an error, as the brief says. PROVEN live: PageSpeed parsing and the CrUX 404 path.

One CrUX call for a large origin, to prove the parsing:
```
$ ... CLI crux --origin https://www.google.com
crux https://www.google.com: 200
{ "origin": "https://www.google.com", "formFactor": "PHONE", "lcpMs": 1151, "inpMs": 233, "cls": 0, "collectionPeriod": { "first": "2026-10-12", "last": "2026-11-08" } }
```
PROVEN live: the CrUX answer is read into the `crux` numbers form (p75 LCP, INP, CLS, collection period as days).

### Bing: GetUserSites only
```
$ ... CLI bing --workspace ... --day 2026-11-10 --sites-only true
GetUserSites: 1 site(s), 1 verified
```
One site is verified for this key (its address was not printed or used). The brief limits the live Bing call to `GetUserSites`, so the
three statistics calls (`GetQueryStats`, `GetPageStats`, `GetCrawlStats`) were NOT run: **the `bing` row from a live answer is UNPROVEN**
(parsing is proven on hand-written fixtures only; the field names `Query`/`Clicks`/`Impressions`/`AvgImpressionPosition`/`/Date(ms)/`
are those of the Bing Webmaster interface docs, the `d` wrapper is how the endpoint answers). If the head wants it proven, one
`CLI bing --workspace ... --day ...` run makes three more read-only requests on that site.
`GetUserSites` itself answered and was parsed (1 site, verified flag read): PROVEN live.

### Search Console: BLOCKED, fixtures only
```
$ ... CLI search-console --workspace ... --day 2026-11-10
search-console 2026-11-10: BLOCKED; 0 request(s): none
BLOCKED: no Search Console access: no verified property and token | unblock: the site's owner verifies the site in Google Search Console (a DNS record) and connects their Google account
```
No property is verified (owner action), so the live Search Console path, and `submitSitemap` (C16) against Google, are **UNPROVEN**; both
are tested against fake fetches built from the API documentation (request method, address, header, 204, 403, 429, malformed).

### Gemini (AI answers): BLOCKED by the free tier
```
$ ... CLI ai-answers --workspace ... --day 2026-11-10 --domain preview.test-site-demo-a.pages.dev --name "Demo A" --prompts "<3 prompts>"
ai-answers 2026-11-10: BLOCKED; 1 request(s): gemini 404
BLOCKED: no answer was collected (Gemini answered 404: stopped at prompt p1; the prompts after it were not asked) | unblock: Run again later, or add captured answers.
```
Cause (one diagnostic request, key and body not printed): `404 NOT_FOUND: This model models/gemini-2.5-flash is no longer available to new users.
Please update your code to use models/gemini-3.8-flash`. The skill's default model (`gemini-2.5-flash`) is dead for this key (finding below). Second try with
Google's named model:
```
$ ... CLI ai-answers ... --model gemini-3.8-flash --prompts "<3 prompts>"
ai-answers 2026-11-10: BLOCKED; 1 request(s): gemini 429
BLOCKED: no answer was collected (Gemini free-tier rate limit (429): stopped, not retried at prompt p1; the prompts after it were not asked) | unblock: Run again later, or add captured answers.
```
Two approaches failed on the same obstacle, and the brief says any 429 stops the source: **BLOCKED, ai-answers live is UNPROVEN**; what would unblock it: the free tier's quota for
`gemini-3.8-flash` (it answered 429 on the very first request, so it may be zero for a free key), a Gemini key with quota, or another engine's captures. The pasted unblock text
is the wording before a later edit ("Gemini's free tier has room again (run again later), or answers captured from ChatGPT or Perplexity are added."); the logic is unchanged and a test covers the new text. The collector's default model is now
`gemini-3.8-flash`, which is itself UNPROVEN (only a 429 was seen). No Gemini answer was received, so no `named`/`cited` was judged live. (Counting the requests to the Gemini API: one model list, three generateContent; none returned an answer.)

### IndexNow
No ping was sent live (the key file is not hosted on the site; platform's factory publishes it). **IndexNow live is UNPROVEN**; the ping is tested against a fake fetch (body fields, endpoint, 200/202/422, off-host addresses refused, key and key-file address never in the output).

### The monthly report from the live rows
The three live rows (pagespeed row, Search Console BLOCKED, ai-answers BLOCKED) fed to `CLI report --month 2026-11` give (Bing has no row, so it says so):
```
# How Demo A did in November 2026

Website: preview.test-site-demo-a.pages.dev

## People who saw you in Google

This part is not connected yet: the site's owner verifies the site in Google Search Console (a DNS record) and connects their Google account.

## How fast your pages open on a phone

We tested 5 pages the way a phone sees them. The average speed score is 100 (higher is faster; a perfect page gets the top mark).
The slowest page is https://preview.test-site-demo-a.pages.dev/ with a score of 100; its main content appears after about 0.8 seconds.
Google has no data from real visitors on phones yet: too few people have visited the site.

## People who found you on Bing

This part is not connected yet: the site is verified in Bing Webmaster Tools and the Bing key is set.

## AI assistants that named you

This part is not connected yet: run again later, or add captured answers.
```

## BLOCKED, UNPROVEN, and what differs
- PROVEN live: PageSpeed on five pages (parsing, five rows), CrUX 404 as `crux.none`, CrUX on a large origin (numbers form), Bing `GetUserSites` (verified flag).
- UNPROVEN live: Search Console collector and `submitSitemap` (no verified property); IndexNow ping (key file not hosted); Bing statistics (a verified site exists, the brief limits
  the live call to `GetUserSites`); Gemini answers (404 on the default model, then 429 on `gemini-3.8-flash`).
- The `metrics_snapshots` table accepts `source = 'bing'` only after platform's block 6 migration lands (head of operations' ruling 2026-11-10, passed on by the head); until then a `bing` row cannot be inserted. The collector, validator and row are built as the brief says.
- Shapes against 5-P4: `ai-answers` is exactly the 5-P4 / 5d shape (`data = { date, rows }`, inner rows as in the skill's validator; a test runs both validators over the same 8 rows and they agree). The skill's optional `mapSha256` is not carried. No other source differs from the table beyond `bing`.
- Search Console rows are one day by default (window two days back); the report sums one-day windows over the month, and uses a multi-day row alone only when the month has no one-day row. A 28-day baseline row is therefore shown on its own with its dates, and never added to daily rows.

## Findings for the head (not mine to fix)
1. The skill's default Gemini model `gemini-2.5-flash` (`scripts/measure.mjs` config line 35, `measure.ai.model`) is "no longer available to new users" (404, 2026-11-10); the skill's `measure` stage will fail the same way on this key until its default changes (a skill sync, not in this order).
2. A verified Bing site exists for `BING_WEBMASTER_KEY`: the statistics pull can be proven with one more small run if wanted.
3. A repo hook regenerated `icm/CODE-MAP.md`, `icm/INDEX.md`, `icm/code-map.json`, `icm/index.json` in this worktree (counts +2 docs); they are generated files and show as modified.
4. `bing` needs one more allowed value in the CHECK (already ruled; block 6).
