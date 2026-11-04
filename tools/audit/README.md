# tools/audit: the audit engine over a built folder or a live-site snapshot

Judges a folder of built static HTML, or a snapshot of a live site (slice 2), against shipgate checklist rules, one check per rule id, each
check admitted only with its source text in `rules/<ID>.md`. Node built-ins only (ES modules), no network, nothing written to the audited folder. Owner: the SEO and audits
department (`docs/departments/seo-and-audits.md`). The CLI department wraps it as `omnikom audit`; the call below is all a wrapper needs.

## The library call
```js
import { audit, listRules } from "./tools/audit/index.mjs";

const r = audit("path/to/built/site", { target: "production", rules: ["MET-003", "MET-001"], config: { titleLength: { hardMax: 65 } } });
// r = { dir, pages: ["/", "/about/"], rules: [{ id, severity, source }], findings: [...], lines: [...], pass: boolean, exit: 0 | 1 }
// r.findings[i] = { rule, page, line, what, status: "FAIL" | "WARN" | "SKIP" }
console.log(r.lines.join("\n"));
process.exit(r.exit);
```
- `audit(dir, options)` is synchronous. `options.rules` (array of ids, any case) limits the run; `options.config` overrides the length and
  speed numbers; `options.psi` is the path of a PageSpeed Insights file (see PRF-001). `options.target` is `"preview"` or `"production"` (slice 4c, see ENV-001; no default). **A built folder needs it** (slice 4c flip, `REQUIRE_TARGET_FOR_FOLDER = true`): a folder call with no `target` throws an `AuditError` (exit 2); a snapshot never needs one. `options.promptCoverage` is the path of the plan's coverage file (slice 5c, see PMP-001; no default, never searched for). `r.mode` is `"static"` or `"snapshot"`, `r.target` the target judged (`null` only for a snapshot run with none).
- It throws an `AuditError` with `.exit === 2` for a usage or configuration error: a missing folder, an unknown rule id, an empty `rules` list or an empty-string id (`no such rule: ""`; `rules` omitted or `null` runs every rule), a length config that
  breaks WCF-004 (`warnMin < warnMax <= hardMax`), a built folder with no `target`, a `target` that is not `"preview"` or `"production"` (an empty string included), a `promptCoverage` file that is missing, not JSON or the wrong shape. A wrapper prints `error.message` and exits 2.
- `import` itself throws (also `.exit === 2`) when a check file has no `rules/<ID>.md` or is malformed: `checks admitted only with a source`.
- `listRules()` returns `[{ id, severity, source, notCovered }]`.
- Config defaults (shipgate spec 8.0.0 web-delivery): `titleLength { warnMin 30, warnMax 60, hardMax 70 }`,
  `descriptionLength { warnMin 70, warnMax 160, hardMax 180 }`, `sitemap { maxUrlsPerFile 50000, maxBytesPerFile 52428800 }`.
  `speed { lcpMs 2500, cls 0.1, tbtMs 200, ttfbMs 600 }` (shipgate spec 8.0.0 `packs/performance.md` defaults block, read 2026-10-30; the first
  three are also Google's Core Web Vitals "good" thresholds, web.dev/articles/vitals, read 2026-10-30). Each speed number must be above zero.
  An `audit.config.json` in the audited folder overrides them, `options.config` overrides that.

## The runner
```
node tools/audit/run.mjs <folder> [--json | --summary] [--only MET-003,MET-001] [--psi FILE] [--target preview|production] [--prompt-coverage FILE] [--list]
```
- `--summary` prints the small summary object ("The summary" below) as one line and nothing else (stdout and stderr), with the same exit codes; `--summary` with `--json` exits 2.
- `--target preview|production` says which kind of build is judged (slice 4c; see "The build target" below). A built folder needs it: with none the run exits 2 naming `--target` and prints no line (slice 4c flip); a snapshot (`live.mjs`) does not. Anything else, or no value, exits 2.
- `--prompt-coverage FILE` names the plan's `plan/prompt-coverage.json` (slice 5c; see "The prompt map" below). A missing file, bad JSON or the wrong shape exits 2; no value exits 2.
- `--psi FILE` names a `psi/<date>.json` written by the skill's `psi.mjs` (only a snapshot uses it; a missing or malformed file exits 2).
- Prints the `lines`; `--json` prints the `audit()` object and nothing else; `--only` limits the rules; `--list` prints every rule with
  its severity and source and exits 0.
- A one-line summary goes to stderr, never stdout.
- Exit codes: 0 no FAIL (WARN and SKIP do not fail), 1 at least one FAIL, 2 usage error, missing folder, unknown rule id or bad config.

## The summary (stored per site)
`summary.mjs` turns the `audit()` object into one small, versioned object that a publish job can store, so a site's audit can be shown
later (`docs/product/9-blocks.md`: "audit results stored per site for the dashboard"). Node built-ins only, nothing written.
```
import { audit } from "./tools/audit/index.mjs"; import { summarize } from "./tools/audit/summary.mjs";
const s = summarize(audit("dist", { target: "preview" }), { commit: "bb60318" });   // commit is optional
```
```
{ v: 1, target, mode, pass, exit, pages, rules,                         // pages and rules are counts; target is null for a snapshot run without one
  counts: { PASS, FAIL, SKIP, ...},                                     // PASS = the PASS lines (one per rule and page)
  byFamily: { MET: { PASS, FAIL, SKIP, ...}, ... },                     // the family is the rule id up to the first "-"
  byTopic: { headings: { PASS, FAIL, SKIP, ...}, ... },                 // the plain topic of names.json (work order 06), every topic present
  fails: [{ rule, page, line, what, source }], truncated, commit? }
```
- A status that is not PASS, FAIL or SKIP (WARN today) is counted under its own key in `counts` and in its family, never dropped.
- Limits: `fails` keeps the FAILs in rule order, at most 200 (`MAX_FAILS`); every `what` is cut to 300 characters (the cut ends in `...`);
  `truncated` is the number of FAILs left out (0 when none). The JSON stays under 60 KiB (`MAX_BYTES`) for any input, because the callback
  refuses a gate report over 64 KiB (`supabase/functions/job-callback/index.ts` `MAX_REPORT`): when 200 long fails would pass that, fewer are kept and
  `truncated` says so (measured: with texts up to 200 characters all 200 fit, 60,188 bytes; with texts cut to 300 characters 153 fit, 61,341 bytes). Rule ids, pages, sources, family and status names are
  cut too, and more than 40 distinct families or unusual statuses are counted under `OTHER`.
- The runner's line: `node tools/audit/run.mjs <dist> --target <preview|production> --summary` (exit 0 no FAIL, 1 a FAIL, 2 usage error; stdout is the JSON).
  It carries no commit; a caller that knows it adds `commit` to the parsed object, or calls `summarize` with it.
- Storing it per publish job (`gateReport.audit`) and reading it per site are the platform build's files, not this tool's.

## Plain names (for the dashboard and the report)
`names.json` is the one place that says, in words a business owner understands, what each topic is called and what is wrong when a rule
fails. The dashboard's "Search health" card and the six-question report read this file; the screen never carries its own copy of the words.
`names.mjs` is the Node call (`topicOf(ruleId)`, `problemOf(ruleId)`, `TOPICS`; built-ins only).
```
{ "v": 1,
  "topics": [ { "id": "titles", "name": "Page titles and descriptions" }, ... ],         // in the order the screen shows them
  "rules": { "MET-003": { "topic": "headings", "problem": "A page has no main heading, more than one, or headings that skip a level." }, ... } }
```
- Topics, in order: `titles` Page titles and descriptions; `headings` Headings and structure; `indexing` Indexing; `addresses` Addresses;
  `links` Links; `accessibility` Accessibility; `speed` Speed; `structured-data` Structured data; `ai-questions` AI question coverage;
  `design` Design; `setting` Preview or live setting. `topicOf` of an id not in the table is `"other"`, `problemOf` of it is `null`.
- `problem` says what is wrong when the rule FAILS or WARNs, true to the rule file's "Judged here": one sentence, at most 120 characters,
  a final period, no rule id, file name, digit, em dash or jargon (canonical, h1, LCP, noindex, sitemap and the like).
- **A new rule ships with its entry.** `test/run.mjs` fails when a rule that `run.mjs --list` prints has no entry, an unknown topic or a sentence
  outside those limits, and when the table names a rule the engine lacks or a topic no rule uses.
- The summary carries `byTopic` next to `byFamily`: the same lines counted per topic, every topic present (zeros when none), a rule id outside
  the table under `other`. `v` stays 1 (the field was added, nothing renamed).

## Snapshot mode (slice 2)
A folder that holds `_site.json` and `pages/<slug>/raw.html.gz` is a snapshot made by the skill's polite `snapshot-site.mjs`, and the same
rules judge it. What differs from a built folder:
- Pages are keyed by their FINAL url (`response.json.finalUrl`) and carry `response.json.status`. Only pages the crawl saw answer 200 are
  judged by the page rules (a 404 or redirect record is evidence for LNK-002 and IDX-001, not a page). A record whose crawled url redirected
  to another path is also kept as a redirect source (first hop 3xx).
- robots.txt is `site/robots.txt` with `site/robots.json`; sitemaps are `site/sitemap-N.xml` or `.xml.gz` with `site/sitemaps.json`. The lines
  name those files (`site/robots.txt`, `site/sitemap-1.xml`). The HTTP parts of IDX-004 and all of SE-001 are judged from them.
- The HTTP origin is known: the home page's final url, else `_site.json.url`. URL-009 and IDX-002 check origins exactly; `hosts` carries the
  snapshot's hosts and the `www`/apex counterpart of a host counts as internal.
- A snapshot is a sample of the site unless `_site.json` says `complete: true` (the skill never sets it). On a sample IDX-001 "extra" and
  "missing" are one SKIP each (`incomplete-crawl`), and a LNK-002 target the crawl did not visit is SKIP `not-crawled`, never PASS, never FAIL.
- PRF-001 and PRF-016 exist only here: a built folder prints no line for them.
- `psi/<date>.json` in the audited folder (the newest by name) or `--psi FILE` supplies PageSpeed Insights numbers; psi.mjs itself writes
  under `site-checks/<host>/.pewp/psi/`, so pass it with `--psi` or copy it in.
- Fixtures: `fixtures/snapshot-good` and `fixtures/snapshot-bad-<RULE-ID>[-part]`, all made by `fixtures/build-fixtures.mjs` from `fixtures/good`
  (`snapshotGood()`), committed as files; a `.gz` file is compared on its unpacked bytes. A snapshot fixture entry may say `status`
  (`FAIL` default, `WARN`, `SKIP`, `PASS`) and `also` (rule ids whose findings are expected too, because one fact breaks two rules, e.g. a
  robots.txt answering 500 breaks SE-001 and IDX-004); anything else on a snapshot fixture fails the test.

## The live driver (slice 2)
```
node tools/audit/live.mjs <url> [--fresh] [--cwd DIR] [--max-age-days N] [--json] [--only MET-003,...] [--psi FILE] [--target preview|production] [--prompt-coverage FILE] [-- <snapshot-site options>]
```
Runs the skill's `scripts/live-target.mjs` as a child process with the same arguments (it reuses a complete snapshot younger than 7 days or
takes one politely: GET only, a 4 s gap, robots.txt obeyed, one 429 allowance then stop), reads its `REUSE <dir>` / `NEW <dir>` / `FAILED ...`
line, runs `audit()` on that folder and prints the lines on stdout (progress and the summary go to stderr). It crawls nothing itself and never
fetches. Exit: `audit()`'s (0 or 1), 2 usage, 3 the snapshot failed or stopped (a 429, the time cap, a crash): nothing is judged then.
Never pass `--ignore-robots` after `--` except for a URL the head names as ours. `OMNIKOM_AUDIT_LIVE_TARGET` points at another script (the
tests use `fixtures/live-target-standin.mjs`, which prints a REUSE line for `fixtures/snapshot-good`; no request is ever made by a test).
Process tree: when the 4 h 1 min limit fires (`OMNIKOM_AUDIT_LIVE_TIMEOUT_MS` overrides it, for tests), on SIGINT or SIGTERM (exit 130 or 143), and on exit
while the child is alive, the driver stops the child's whole tree, so the browser the skill starts goes too (Windows `taskkill /PID <pid> /T /F`; POSIX the
child is its own process group and the group is killed). Limits, not judged here: a hard kill of the driver itself (SIGKILL, Task Manager, power loss) runs
no code and leaves the browser; the skill's browser launcher carries its own watchdog for that (another builder). The SIGINT/SIGTERM handlers are not
tested (Node on Windows ends a process on those signals without running handlers); only the time-limit path is, by `test/run.mjs`.

## The line format (one per rule per page; site-wide rules use the file they judge: `robots.txt`, `sitemap.xml`)
```
PASS <rule id> <page>
WARN <rule id> <page>:<line> <what> (source: <checklist file> <rule id>)
FAIL <rule id> <page>:<line> <what> (source: <checklist file> <rule id>)
SKIP <rule id> <page> <why>
```
`<page>` is the page path (`/`, `/about/`) or the file (`robots.txt`). `<line>` is the 1-based line of the tag or text that is wrong.
`what` starts with the failure class of the spec (`missing-element`, `duplicate-element`, `value-mismatch`, `forbidden-value`,
`status-mismatch`). SKIP means the rule cannot judge (no sitemap to read); it is never a PASS. The parts of a rule that need HTTP or a
browser are not printed as SKIP on every run; they are listed in the check's `notCovered` and in its `rules/<ID>.md`.

## Rules in this slice
| Id | Severity | Check | Source |
|---|---|---|---|
| MET-001 | P0 | title: one, non-empty, <= hardMax, unique per locale | checklist/web-delivery.md MET-001 |
| MET-002 | P1 | meta description: present, non-empty, <= hardMax, unique | checklist/web-delivery.md MET-002 |
| MET-003 | P0 | one `<main>`, one `<h1>`, no skipped heading level | checklist/web-delivery.md MET-003 |
| MET-004 | W | title or description outside warnMin..warnMax | checklist/web-delivery.md MET-004 |
| SE-202 | P1 | Bing minimum lengths (lower for zh, ja, ko) | checklist/search-engines.md SE-202 |
| URL-009 | P0 | canonical, og:url, hreflang, WebPage.url agree | checklist/web-delivery.md URL-009 |
| IDX-004 | P0 | robots.txt present, names the sitemap, blocks nothing | checklist/web-delivery.md IDX-004 |
| IDX-001 | P0 | sitemap URL set equals the indexable pages | checklist/web-delivery.md IDX-001 |
| IDX-002 | P0 | sitemap limits, index, valid XML, one origin, unique | checklist/web-delivery.md IDX-002 |
| IDX-003 | W | sitemap lastmod is the build clock | checklist/web-delivery.md IDX-003 |
| SE-004 | P1 | sitemap lastmod is a W3C datetime, not in the future | checklist/search-engines.md SE-004 |
| A11-007 | P1 | alt text on images, image buttons, image map areas | checklist/accessibility.md A11-007 |
| LNK-002 | P0 | internal links land, canonical form, no nofollow | checklist/web-delivery.md LNK-002 |
| SCH-001 | P0 | one JSON-LD `@graph` with WebPage, WebSite, Organization | checklist/web-delivery.md SCH-001 |
| SE-001 | P0 | robots.txt health: 200 (404 WARN), no 5xx or 429, text/plain, <= 512,000 bytes, valid UTF-8 (snapshot; a folder: size and UTF-8) | checklist/search-engines.md SE-001 |
| PRF-001 | P2 | snapshot only: LCP <= 2500 ms, CLS <= 0.1, TBT <= 200 ms per page; UNTRUSTED lab number is SKIP; PSI mobile preferred | checklist/performance.md PRF-001 |
| PRF-016 | P2 | snapshot only: TTFB <= 600 ms per page, printed as a WARN (one cold request, not the spec's median of 5 warm) | checklist/performance.md PRF-016 |

IDX-004 (status 200, text/plain) and LNK-002 (the status the crawl saw at the target) also gained their HTTP parts in snapshot mode. In folder
mode they stay `notCovered`. The PRF-001 seo part (Lighthouse category) is `notCovered` everywhere.

The full rule text of each is in `rules/<ID>.md` with the spec path (`shipgate/spec/packs/<pack>.md`, shipgate spec 8.0.0, read
2026-10-30). The skill's checklist copy (`skills/programmatic-enterprise-web-performance/checklist/`) has the same ids with the text cut
short; the FAIL line cites that file.

## The build target (slice 4c): ENV-001 and the X-Robots-Tag header
A preview is kept out of the index on purpose by the response header `X-Robots-Tag: noindex, nofollow` (the factory writes it into `_headers`), so the audit must
know which kind of build it judges. The target is given, never guessed: `audit(dir, { target })`, `run.mjs --target`, `live.mjs --target`.
- Where the header comes from: a snapshot's `response.json` headers (`x-robots-tag`, any case; a value with no bot name or after `googlebot:` counts, a value for another
  named bot does not; `none` means noindex), or a folder's `_headers` file (Cloudflare Pages format: `*` splat, `:name` placeholder, `! Name` detach; a pattern that
  cannot be matched exactly, such as a host pattern, is not judged). `lib/headers.mjs` reads the file.
- `target: "production"`: a header noindex feeds `page.noindex`, so IDX-001 and every rule that skips non-indexable pages judge what Google will see.
- `target: "preview"`: the header noindex is expected and does NOT feed `page.noindex` (the other rules judge the site as it will be in production); a meta robots noindex still does.
- no target: a snapshot feeds the header into `page.noindex` (it is what the live site says). **A built folder with no target is a usage error (exit 2) since the slice 4c flip; a snapshot run with no target prints one `SKIP ENV-001 / no --target ...`
  line and judges no indexing** (head of operations, 2026-11-01, final: a check that did not run is never silent; the subject is the site-wide `/`, in folder mode and in
  snapshot mode). A snapshot of a preview with no noindex, or of a production site with the preview's header, therefore passes the other rules. The factory runner and the CLI pass a target, so the head set the ONE line `export const REQUIRE_TARGET_FOR_FOLDER = true;` in `index.mjs` (slice 4c flip; a snapshot is never refused). A test runs the engine with no target on a folder (exit 2) and a mutant sets the line back to `false`.
- ENV-001 (P0, `rules/ENV-001.md`): preview, every HTML page carries noindex (header or meta); production, no HTML page carries a header noindex. Each finding names the page,
  the source of the noindex (`_headers` line and pattern, or the response header) and the target. A folder's root `404.html` is out of scope.
- Fixtures: `bad-ENV-001-preview`, `bad-ENV-001-production` (also an IDX-001 FAIL, so it lists both with `multi`), `snapshot-bad-IDX-001-header`, and `good-preview`
  (good plus a `/*` noindex `_headers`; passes with `--target preview`). A fixture entry may carry `target`, passed to the audit for that fixture only.
- Not a checklist rule: its source line is the factory's (`factory/lib/launch.mjs headersText`), so `--list` shows that text instead of `checklist/<file>.md <ID>`.

## The prompt map (slice 5c): PMP-001
A prompt is a whole situation a buyer types into an AI engine. The skill's research stage maps the prompts, its plan stage answers every row and writes
`plan/prompt-coverage.json` = `{ map, rows: [{ id, coveredBy: "<page path>"|null, kind, reason }] }`; PMP-001 refuses a build that leaves a row unanswered
(DECISIONS 35, `rules/PMP-001.md`). The file is given, never searched for: `audit(dir, { promptCoverage: FILE })`, `run.mjs --prompt-coverage FILE`, `live.mjs --prompt-coverage FILE`.
- no file: a run prints one `SKIP PMP-001 / no --prompt-coverage ...` line (site-wide subject `/`, folder and snapshot) and judges nothing; a check that did not run is never silent.
- with a file: one line per row (the subject is the row id). FAIL when `coveredBy` is null and `reason` is empty (or only white space); FAIL when `coveredBy` is not a built page
  (`site.pageList`, the path normalised like every page path), naming the row id and the path; PASS otherwise. A written reason does not excuse a page that is promised and not built.
- a coverage file that is not JSON or has the wrong shape (no `rows[]`, a row with no string `id`, a repeated `id`, a `coveredBy` that is neither a path nor null, a `kind` or `reason` of the wrong type)
  is a usage error (exit 2), not a finding.
- Fixtures: `good-coverage` (good plus `plan/prompt-coverage.json`, every row answered), `bad-PMP-001-uncovered`, `bad-PMP-001-missing-page`. A fixture entry may carry `coverage`
  (the file's path inside the fixture), passed to the audit for that fixture only.
- Not a checklist rule: its source line is DECISIONS 35, so `--list` shows that text. The factory and the CLI pass no coverage file today and so get the one SKIP line.

## Design tells (slice 4b): the DSN rules
30 rules now (29 before slice 5c, 28 before slice 4c): the 17 checklist rules above, ENV-001, PMP-001 and DSN-001 to DSN-011, the machine-checkable tells of generic AI-made design (DECISIONS 37; origin: the open skill
unslop by Damir Sokolovsky, CC BY 4.0, copied to `skills/unslop/`, rewritten here in our own words). The source line of each DSN rule names the line(s) of
that copy and the decision, e.g. DSN-005: `skills/unslop/references/signs.md:47 and skills/unslop/SKILL.md:110; planning/DECISIONS.md 37 (owner, 2026-10-31); unslop by Damir Sokolovsky, CC BY 4.0`.
All P1; DSN-010 and DSN-011 print WARN (the exit stays 0), the other nine print FAIL. A built site that trips one does not publish.

| Id | Tell | Reads |
|---|---|---|
| DSN-001 | looping or bouncy motion | class `animate-pulse`/`ping`/`bounce`, `transition-all`, `hover:scale-*`, `shimmer` in a class or `@keyframes` name |
| DSN-002 | gradient text; hue gradients | `bg-clip-text`+`text-transparent`, `background-clip: text`+gradient; `from-/via-/to-` or a CSS gradient across two hue families |
| DSN-003 | emoji in labels and headings | `\p{Extended_Pictographic}` in h1-h6, button, a, label, legend, summary, th, option (not (c), (r), TM) |
| DSN-004 | uppercase tracked labels | `uppercase` with a positive tracking, on one element |
| DSN-005 | hype words, "AI-powered" copy | visible text: `AI-powered`, `powered by AI`, supercharge, seamless, unlock, magic, revolutionize/-ary, game-changing |
| DSN-006 | exclamation mark in a headline | `!` in h1-h6 |
| DSN-007 | greeting headline | h1-h3 starting with Hello, Hi, Hey, Welcome, Greetings, Howdy |
| DSN-008 | PRO or Beta badge | span, small, sup, div, strong, em, mark, b whose whole text is PRO or Beta |
| DSN-009 | unverifiable claim | `loved by 10,000+ teams`, `trusted by 5k teams`, `10x faster` |
| DSN-010 | heavy weight on small text (WARN) | weight 700+ under 14 px on one element |
| DSN-011 | negative letter spacing on small text (WARN) | tracking-tight or a negative letter-spacing under 14 px |

- Code: `lib/design.mjs` (re-reads each page element by element, parses `<style>` blocks and, in a built folder, the local stylesheets a page links;
  matches only plain class or element selectors), `lib/typography.mjs` (declared size, weight, tracking, text transform), `lib/colour.mjs` (the
  hue-family table, printed in `rules/DSN-002.md` and kept equal by a test), `checks/dsn-0NN.mjs`.
- A finding names the rule, the page, the line, the exact class or text and the source. Styles are declared, not computed (no inheritance, no
  specificity, no media queries); a snapshot judges what its HTML carries, since its stylesheets are not in the snapshot. Text inside `svg`,
  `template`, `noscript`, `script`, `style` and comments is never judged. Each rule file lists what it does not judge.
- Fixtures: one `bad-DSN-0NN[-part]` per rule, `bad-DSN` (every tell on one page, listed by `multi` in the generator, exit 1 naming all eleven),
  `snapshot-bad-DSN-003`. Every DSN fixture is held to "its own rule and no other, of any status".
- The design stage of the skill (`stages/design.md`) requires the five-line direction and the nine passes, and runs this family after them.

## Layout
- `index.mjs` the engine, `run.mjs` the runner, `live.mjs` the live driver, `summary.mjs` the small summary of an audit (work order 05), `names.json` and `names.mjs` the plain words (work order 06).
- `lib/site.mjs` the site reader: a copy of the skill's `scripts/lib-site.mjs` (header says which changes). `lib/context.mjs` folder
  facts, sitemap reading, `resolveLink`, the build target. `lib/headers.mjs` the `_headers` file (slice 4c). `lib/lines.mjs` line numbers. `lib/schema.mjs`, `lib/xml.mjs`, `lib/check.mjs` helpers.
  `lib/sitemap-lastmod.mjs` a copy of the skill's built-in SE-004/IDX-003 check with its logic lifted into functions.
  `lib/design.mjs`, `lib/typography.mjs`, `lib/colour.mjs` the readers of the DSN rules (slice 4b).
- `checks/<rule-id>.mjs` one file per rule (`id`, `severity`, `source`, `run(site) -> findings[]`, optional `subjects(site)` and `notCovered`).
- `rules/<RULE-ID>.md` the rule text and its source. `fixtures/good` and `fixtures/bad-<RULE-ID>[-part]`.
- `test/run.mjs` the tests, `test/mutate.mjs` the watched-fail.

## How to add a rule (all five, or it is not admitted)
1. `checks/<id>.mjs` exporting `id`, `severity`, `source`, `run(site)`.
2. `rules/<ID>.md` with `Source: <checklist file> <ID>` (a DSN rule: the DECISIONS 37 line above), the spec path (a DSN rule: the unslop
   credit), a `## Rule text` section and what is and is not judged. The engine refuses to import a check whose rules file is missing
   (`checks admitted only with a source`) or that exports no non-empty `source` string (`no source string`).
3. At least one `bad-<ID>` fixture: an entry in `fixtures/build-fixtures.mjs` (`expect` text of the FAIL, optional `at` text that must be on
   the FAIL line, optional `count`, one `edit(d)` of `rep`/`repAll`/`add`/`del` calls), then `node tools/audit/fixtures/build-fixtures.mjs`
   and commit the files. It must break that rule only; the good site must still pass.
4. The test runs it automatically (`test/run.mjs` reads the fixture table); add an `adhoc` case for any part a clean fixture cannot isolate.
5. A mutant in `test/mutate.mjs` that removes the rule's comparison, then `node tools/audit/test/mutate.mjs` until `0 survived`.

## Gates
```
node tools/audit/test/run.mjs      ends "OK: N of N checks passed", exit 0
node tools/audit/test/mutate.mjs   ends "N mutants, N caught, 0 survived, 0 not run, 0 target text missing", exit 0  (not run = the child was killed, exit null; exit 1)
(`MUTATE_JOBS` mutants run at once, default 4; `MUTATE_TIMEOUT_S` raises the 180 s limit on a loaded machine; `MUTATE_ONLY=<regex>` runs only the mutants whose name matches; `MUTATE_FIRST=<regex>` starts those first. Temp folders: each run keeps all of them under one `omnikom-audit-run-*` root (in `OMNIKOM_AUDIT_TMP` if set, else the system temp folder) and removes it at the end, on a red check under FAILFAST, and on SIGINT/SIGTERM; `test/mutate.mjs` does the same with `omnikom-audit-mutate-*` and runs each child inside its own copy; a test in `test/run.mjs` fails if a killed mutant run leaves a folder.)
node tools/audit/run.mjs tools/audit/fixtures/good              exit 2, stderr names `--target`, nothing on stdout (a built folder needs its target)
node tools/audit/run.mjs tools/audit/fixtures/good --target production            every line PASS but the one `SKIP PMP-001` line, exit 0
node tools/audit/run.mjs tools/audit/fixtures/good-coverage --prompt-coverage tools/audit/fixtures/good-coverage/plan/prompt-coverage.json --target production   0 FAIL, four PASS PMP-001 lines, exit 0
node tools/audit/run.mjs tools/audit/fixtures/bad-PMP-001-uncovered --prompt-coverage tools/audit/fixtures/bad-PMP-001-uncovered/plan/prompt-coverage.json --target production   a FAIL PMP-001 line naming the row id, exit 1
node tools/audit/run.mjs tools/audit/fixtures/good-preview --target preview       every line PASS but the one `SKIP PMP-001` line, exit 0
node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target production       a FAIL MET-003 line with file:line and source, exit 1
node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target preview --summary   one JSON object, "pass":false, exit 1
node tools/audit/run.mjs tools/audit/fixtures/snapshot-good     every line PASS but one `SKIP ENV-001 / no --target` and one `SKIP PMP-001 / no --prompt-coverage` line, exit 0
node tools/audit/run.mjs tools/audit/fixtures/snapshot-bad-PRF-001   a FAIL PRF-001 line (LCP 3100 ms > 2500 ms) with source, exit 1
node tools/audit/run.mjs tools/audit/fixtures/bad-DSN --target production           a FAIL or WARN line for each of DSN-001 to DSN-011, exit 1
```
No file in this folder may contain the em dash character. Fixtures are synthetic (an invented tea shop); no client folder is a test vehicle.
