# Brief: audit engine slice 2, the live-site snapshot as input and the speed budgets (Sonnet builder; one slice, one brief, discarded when done)

Department: SEO and audits (`docs/departments/seo-and-audits.md`). You report to the head of this department (the session that
started you), never to anyone else. Anything outside this brief is a finding you send back, not a fix. Slice 1 is PROVEN and committed
(cdda922): read `tools/audit/README.md` and `tools/audit/briefs/slice-1-engine.md` first; this slice extends that engine and breaks none
of its gates (`test/run.mjs` 195 checks, `test/mutate.mjs` 106 mutants stay green and grow).

## What this slice adds
The same 14 rule ids judge a LIVE site the same way they judge a built folder, through the skill's polite snapshot (never a crawler of
your own), plus the HTTP parts slice 1 listed as not covered, plus the speed budgets with sourced thresholds. No network in tests; the
live crawl itself is run by the head on a site the platform owns, never by a test.

### 1. Snapshot input (`lib/site.mjs` already reads it)
`loadSite(dir)` returns `mode: "snapshot"` when the folder holds `_site.json` and `pages/<slug>/raw.html.gz` (made by the skill's
`skills/programmatic-enterprise-web-performance/scripts/snapshot-site.mjs`; read its header comment, lines 1 to 35, for every file it writes).
Make every slice 1 check work on that mode:
- Page paths come from `response.json.finalUrl` (`normPath`), `status` from it; a page with `status` other than 200 is not indexable.
- `robots.txt` is `site/robots.txt` with `site/robots.json` `{ status, headers, bytes, ... }`; the sitemap files are `site/sitemap-*.xml`
  (or `.xml.gz`) with `site/sitemaps.json` `{ fetched: [{ url, status, ... }], urls: [...] }`. The slice 1 checks IDX-001, IDX-002, IDX-004,
  SE-004 and IDX-003 read these in snapshot mode; in a snapshot the sitemap URL set is compared with the crawled pages only for the classes
  that do not need a complete crawl (IDX-001 "missing" is SKIP with `incomplete-crawl` unless `_site.json` says the crawl was complete).
- The HTTP origin is known (`_site.json.url`), so URL-009 and IDX-002 can check the origin of absolute URLs exactly.
- `hosts` carries the snapshot's hostname; `resolveLink` treats an `www`/apex counterpart as internal.

### 2. The HTTP parts, judged from the snapshot (rule texts in `rules/<ID>.md`, sources below)
- **IDX-004 http part** (web-delivery, P0): `site/robots.json.status` is 200 and the `content-type` header starts with `text/plain`.
  In folder mode this part stays `notCovered`.
- **SE-001** (search-engines, P0): robots.txt health: status 200 (404 is part `missing`, WARN), never 5xx or 429, `text/plain`,
  <= 512,000 bytes, valid UTF-8 (the snapshot keeps the body; a decode with `fatal: true` that throws is a FAIL). New check, new rules file,
  new fixture, new mutant.
- **LNK-002 status part**: for an internal link whose target page is in the snapshot, `response.json.status` must be 200; a target that
  the crawl saw as 3xx is `redirect-target`, 404/410/5xx `status-mismatch`; a target not in the snapshot is SKIP for that link (the crawl
  is a sample), never a PASS and never a FAIL.
- **PRF-016** (performance, P2): warm TTFB <= `ttfbMs` per page from `response.json.ttfbMs`. The spec's TTFB is the median of 5 warm
  requests; the snapshot has one cold request, so this check is a WARN (`budget-exceeded`, with the note "single cold request") and says so
  in its rules file. Default `ttfbMs`: 600 (shipgate spec 8.0.0 `packs/performance.md` defaults block, read 2026-10-30: "warm server
  response, non-programmatic routes (PRF-016)"; the same block gives `pageBytes 1638400`, `htmlBytes 102400` for PRF-019, out of scope here).

### 3. The speed budgets (new check **PRF-001**, performance, P2)
Source: shipgate spec 8.0.0 `packs/performance.md` line 11 defaults: `lcpMs 2500, cls 0.1, tbtMs 200, inpMs 200, scriptBytes 170000,
cssBytes 60000, renderBlockingMs 300, thirdPartyBlockingMs 250, seoScore 1.0`; the same numbers are Google's Core Web Vitals "good"
thresholds (web.dev/articles/vitals, read 2026-10-30: LCP 2.5 s, INP 200 ms, CLS 0.1). Rule text (PRF-001): per route group, parts `lcp`
(LCP <= lcpMs), `cls` (CLS <= cls), `tbt` (TBT <= tbtMs); finding `budget-exceeded` showing the metric and value. Here: per page, from
`pages/<slug>/browser-mobile.json` `{ lcpMs, cls, tbtMs, fcpMs, ... }` (written by the skill's `cdp-measure.mjs`; read its return shape at
`scripts/cdp-measure.mjs` around line 207). Trust: `_site.json.pages[].speedTrust` is `"trusted"` or starts with `UNTRUSTED`; an UNTRUSTED
lab number is NOT a finding: the check emits `SKIP PRF-001 <page> speed UNTRUSTED (machine busy); take the PageSpeed Insights number`
unless a PSI file is present. PSI: when the audited folder (or `--psi <file>`) holds a `psi/<date>.json` in the shape the skill's
`scripts/psi.mjs` writes (`{ generatedAt, pages: [{ url, strategy, performance, lcpMs, cls, tbtMs, ... }] }`, header lines 1 to 20), the
`mobile` strategy numbers for that URL are judged instead and the line says `(source: PSI <date>)`. The seo part of PRF-001 is `notCovered`
(Lighthouse categories are not in the snapshot). A page with no browser file is SKIP `not measured`. Thresholds live in the config with
the other numbers (`audit.config.json` overrides, `options.config` overrides that; WCF-004 style validation: positive numbers).

### 4. The live driver `tools/audit/live.mjs`
```
node tools/audit/live.mjs <url> [--fresh] [--cwd DIR] [--json] [--only ...] [-- <snapshot-site options>]
```
Calls the skill's `scripts/live-target.mjs` (repo copy: `skills/programmatic-enterprise-web-performance/scripts/live-target.mjs`) as a
child process with the same arguments (it reuses a snapshot younger than 7 days or takes one politely: GET only, 4 s gap, robots obeyed,
one 429 allowance then stop; never pass `--ignore-robots` except for a URL the head names as ours), reads the `REUSE <dir>` / `NEW <dir>`
line, then runs `audit(dir, ...)` on that folder and prints its lines; exit as `audit()` says, 3 when the snapshot failed or stopped at a
429 (`FAILED` line; nothing judged), 2 on usage. It adds no crawling of its own and never fetches anything itself. The driver is tested
with a stand-in for `live-target.mjs` (`OMNIKOM_AUDIT_LIVE_TARGET` points at a fixture script that prints `REUSE <fixture snapshot dir>`),
so tests make no request.

### 5. Fixtures and tests
- `fixtures/snapshot-good/`: the good site of slice 1 in snapshot form (`_site.json` with `url: "https://example-tea.invalid"`, `pages[]`
  with slug, url, status, speedTrust "trusted"; `pages/<slug>/response.json`, `raw.html.gz`, `browser-mobile.json` with numbers under the
  budgets; `site/robots.txt`, `site/robots.json` status 200 text/plain, `site/sitemap-1.xml`, `site/sitemaps.json`). Generated by
  `fixtures/build-fixtures.mjs` from `fixtures/good` (one function; `.gz` files are deterministic: gzip with a fixed mtime or compare on
  the gunzipped bytes in the `--check`), committed as files.
- `fixtures/snapshot-bad-<RULE-ID>[-part]/`: one per new or extended rule and part: SE-001 (status 500; 404 as WARN; `text/html`; 600,000
  bytes), IDX-004 http (content-type `text/html`), LNK-002 (a crawled target with status 404; one with 301), PRF-001 (LCP 3100; CLS 0.25;
  TBT 350; an UNTRUSTED page that gives SKIP; the same UNTRUSTED page with a `psi/` file over budget that gives FAIL with the PSI source;
  a PSI file under budget that gives PASS), PRF-016 (ttfbMs 1900 gives WARN), IDX-001 missing class SKIP on an incomplete crawl, and the
  slice 1 rules on snapshot mode: at least `snapshot-bad-MET-003` to prove the mode shares the checks.
- `test/run.mjs` grows: every snapshot fixture gives exactly its rule's finding and nothing else; folder mode results of slice 1 are
  unchanged (the 195 checks still pass); the driver with the stand-in prints the same lines as `run.mjs` on the fixture folder and exits
  the same; the driver exits 3 on a `FAILED` line from the stand-in and prints nothing judged; `--list` shows the new rules with sources.
- `test/mutate.mjs` grows: one mutant per new comparison (each threshold, the trust rule, the PSI preference, the 429 exit, the
  content-type test, the UTF-8 test, the SKIP-not-PASS rule for uncrawled targets).

## How to work
1. Read first: this brief; `tools/audit/README.md`; `tools/audit/lib/site.mjs` (`loadSite` snapshot branch) and `lib/context.mjs`;
   the header comments (not the bodies) of the skill's `scripts/snapshot-site.mjs`, `scripts/live-target.mjs`, `scripts/psi.mjs`,
   `scripts/cdp-measure.mjs` (the return at ~line 207), `scripts/lib-polite.mjs`. Do not open any client folder or any `site-checks/`
   folder; do not run `snapshot-site.mjs` against any host.
2. Build in this order, tests after each: snapshot fixture + slice 1 checks on snapshot mode; SE-001 and the IDX-004 http part; LNK-002
   status part; PRF-001 with trust and PSI; PRF-016; the driver with the stand-in. Watched-fail every new comparison.
3. Scripts in files, never inline `node -e`. No em dash character (U+2014) in any file. Edit nothing outside `tools/audit/` except the
   PROGRESS.md block the brief names. A need in the skill's scripts is a finding (the head carries it back through sync).
4. Every new check has its `rules/<ID>.md` with the source line (spec pack and version, or vendor URL with the date read) or it is not admitted.
5. The done report to the head is two lines plus the pasted outputs; never claim green without the output in front of you.

## Done when (the head re-runs all of it before accepting)
```bash
node tools/audit/test/run.mjs
```
ends `OK: N of N checks passed` with N > 195, exit 0.
```bash
node tools/audit/test/mutate.mjs
```
ends `N mutants, N caught, 0 survived, 0 target text missing` with N > 106, exit 0.
```bash
node tools/audit/run.mjs tools/audit/fixtures/snapshot-good
```
every line PASS, exit 0; `node tools/audit/run.mjs tools/audit/fixtures/snapshot-bad-PRF-001` prints `FAIL PRF-001 <page> budget-exceeded
LCP 3100 ms > 2500 ms (source: checklist/performance.md PRF-001)` (wording may differ, the parts may not) and exits 1;
`node tools/audit/live.mjs https://example-tea.invalid/` with `OMNIKOM_AUDIT_LIVE_TARGET` pointing at the stand-in prints the snapshot-good
lines and exits 0. Then write the outputs into `docs/blueprint/PROGRESS.md` at the top under
`## SEO and audits, slice 2: live snapshot input and speed budgets (<date and time>, builder)`, update `tools/audit/README.md`
(the snapshot mode, the driver, the new rules and thresholds with sources), and send the head two lines: PROVEN with counts; open or
UNPROVEN or BLOCKED. Do not commit.

## Added 2026-10-31 01:37 (finding from the CLI head, via the head of operations)
`audit(dir, { rules: [''] })` runs zero rules and reports PASS, so any caller other than the CLI fails open. An empty rule list,
an empty string, or an unknown rule id is a usage error: throw `AuditError` (exit 2) naming the id, e.g. `no such rule: ""`. Test
watched red (good fixture with `rules: ['']` and with `rules: ['NOPE-999']` both exit 2 and judge nothing; `rules` omitted still
runs all), plus one mutant that removes the guard. The report to the head says the rule set changed (14 to 17) so dependants know.
