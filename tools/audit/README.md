# tools/audit: the audit engine over a built folder

Judges a folder of built static HTML against shipgate checklist rules, one check per rule id, each check admitted only with its source
text in `rules/<ID>.md`. Node built-ins only (ES modules), no network, nothing written to the audited folder. Owner: the SEO and audits
department (`docs/departments/seo-and-audits.md`). The CLI department wraps it as `omnikom audit`; the call below is all a wrapper needs.

## The library call
```js
import { audit, listRules } from "./tools/audit/index.mjs";

const r = audit("path/to/built/site", { rules: ["MET-003", "MET-001"], config: { titleLength: { hardMax: 65 } } });
// r = { dir, pages: ["/", "/about/"], rules: [{ id, severity, source }], findings: [...], lines: [...], pass: boolean, exit: 0 | 1 }
// r.findings[i] = { rule, page, line, what, status: "FAIL" | "WARN" | "SKIP" }
console.log(r.lines.join("\n"));
process.exit(r.exit);
```
- `audit(dir, options)` is synchronous. `options.rules` (array of ids, any case) limits the run; `options.config` overrides the length numbers.
- It throws an `AuditError` with `.exit === 2` for a usage or configuration error: a missing folder, an unknown rule id, a length config that
  breaks WCF-004 (`warnMin < warnMax <= hardMax`). A wrapper prints `error.message` and exits 2.
- `import` itself throws (also `.exit === 2`) when a check file has no `rules/<ID>.md` or is malformed: `checks admitted only with a source`.
- `listRules()` returns `[{ id, severity, source, notCovered }]`.
- Config defaults (shipgate spec 8.0.0 web-delivery): `titleLength { warnMin 30, warnMax 60, hardMax 70 }`,
  `descriptionLength { warnMin 70, warnMax 160, hardMax 180 }`, `sitemap { maxUrlsPerFile 50000, maxBytesPerFile 52428800 }`.
  An `audit.config.json` in the audited folder overrides them, `options.config` overrides that.

## The runner
```
node tools/audit/run.mjs <folder> [--json] [--only MET-003,MET-001] [--list]
```
- Prints the `lines`; `--json` prints the `audit()` object and nothing else; `--only` limits the rules; `--list` prints every rule with
  its severity and source and exits 0.
- A one-line summary goes to stderr, never stdout.
- Exit codes: 0 no FAIL (WARN and SKIP do not fail), 1 at least one FAIL, 2 usage error, missing folder, unknown rule id or bad config.

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

The full rule text of each is in `rules/<ID>.md` with the spec path (`shipgate/spec/packs/<pack>.md`, shipgate spec 8.0.0, read
2026-10-30). The skill's checklist copy (`skills/programmatic-enterprise-web-performance/checklist/`) has the same ids with the text cut
short; the FAIL line cites that file.

## Layout
- `index.mjs` the engine, `run.mjs` the runner.
- `lib/site.mjs` the site reader: a copy of the skill's `scripts/lib-site.mjs` (header says which changes). `lib/context.mjs` folder
  facts, sitemap reading, `resolveLink`. `lib/lines.mjs` line numbers. `lib/schema.mjs`, `lib/xml.mjs`, `lib/check.mjs` helpers.
  `lib/sitemap-lastmod.mjs` a copy of the skill's built-in SE-004/IDX-003 check with its logic lifted into functions.
- `checks/<rule-id>.mjs` one file per rule (`id`, `severity`, `source`, `run(site) -> findings[]`, optional `subjects(site)` and `notCovered`).
- `rules/<RULE-ID>.md` the rule text and its source. `fixtures/good` and `fixtures/bad-<RULE-ID>[-part]`.
- `test/run.mjs` the tests, `test/mutate.mjs` the watched-fail.

## How to add a rule (all five, or it is not admitted)
1. `checks/<id>.mjs` exporting `id`, `severity`, `source`, `run(site)`.
2. `rules/<ID>.md` with `Source: <checklist file> <ID>`, the spec path, a `## Rule text` section and what is and is not judged.
   The engine refuses to import a check whose rules file is missing (`checks admitted only with a source`).
3. At least one `bad-<ID>` fixture: an entry in `fixtures/build-fixtures.mjs` (`expect` text of the FAIL, optional `at` text that must be on
   the FAIL line, optional `count`, one `edit(d)` of `rep`/`repAll`/`add`/`del` calls), then `node tools/audit/fixtures/build-fixtures.mjs`
   and commit the files. It must break that rule only; the good site must still pass.
4. The test runs it automatically (`test/run.mjs` reads the fixture table); add an `adhoc` case for any part a clean fixture cannot isolate.
5. A mutant in `test/mutate.mjs` that removes the rule's comparison, then `node tools/audit/test/mutate.mjs` until `0 survived`.

## Gates
```
node tools/audit/test/run.mjs      ends "OK: N of N checks passed", exit 0
node tools/audit/test/mutate.mjs   ends "N mutants, N caught, 0 survived, 0 target text missing", exit 0
node tools/audit/run.mjs tools/audit/fixtures/good              every line PASS, exit 0
node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003       a FAIL MET-003 line with file:line and source, exit 1
```
No file in this folder may contain the em dash character. Fixtures are synthetic (an invented tea shop); no client folder is a test vehicle.
