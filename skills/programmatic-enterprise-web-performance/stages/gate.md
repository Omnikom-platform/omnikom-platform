# S5 Gate: does the built site match the plan

Loaded only when stage S5 runs. It sits next to the existing checker (shipgate rules, `.checks/`); this part tests the site against
`targets.json` and `plan/`. Deterministic scripts only: they read the OUTPUT (the built HTML), never the code that made it.

## Run it
`node scripts/gate.mjs <pewp> <site dir> [--strict] [--waive ID,ID] [--only GT-003,GT-004] [--no-report] [--priority-pages N] [--build "<cmd>" [--build-cwd DIR] [--setup "<cmd>"]]`
- `--build`: the command that regenerates the site (run in `--build-cwd`, default the site folder). GT-013 builds twice with it; the build lane
  always passes one (build-site.mjs: `--site-build`, or `.pewp/builder/build-command.txt`).
- `<site dir>`: a build output folder (index.html per directory) or a live snapshot made by `snapshot-site.mjs`. A snapshot is a sample of pages, so
  a page missing from it is "cannot judge" (exit 2) for GT-002 / GT-007, never a failure; re-snapshot with `--include <path>`.
- Prints `PASS|FAIL|ERROR <id> <summary>` per check with indented details, then writes `<pewp>/gate/report.md` (plain words, check by check) and
  `report.json`. Exit 0 all PASS, 1 any FAIL, 2 none failed but one could not judge.
- Each check also runs alone: `node scripts/gate-orphans.mjs <pewp> <site dir>` (same output style as `.checks/scripts/check-*.mjs`).
- `--strict` turns WARN items (launch blockers such as the privacy and accessibility pages) into FAIL: use it for the launch gate.
- `--waive RE-DEF05-001` skips an item a sign-off has lifted (the project's "Lifts when" column). Say which sign-off in the run's proof file.

## The checks
| Id | Script | Passes when |
|---|---|---|
| GT-001 | gate-targets | targets.json and business.json are valid (`targets-validate.mjs`); every cluster has exactly one planned page, one brief repeating its query, entities and questions; planned title, H1, description carry the query; planned links have descriptive anchors; no orphan inside the plan |
| GT-002 | gate-clusters | every planned page exists, answers 200, is indexable (a not-yet-live site may be noindex) and is its own canonical |
| GT-003 | gate-cannibalisation | = TGT-003 with 06 9.7: no indexable page other than a cluster's planned page has the head term of its primary query in the `<title>` or `<h1>` with a page type that fits the intent; `alsoServes` pages are exempt; a page for another place is not a rival; no two pages share a title (extra) |
| GT-004 | gate-query-match | = TGT-004: title, H1, meta description and first paragraph each contain the primary query's head term or one of the cluster's queries (whole words). Extras that are not in TGT-004: exactly one H1; a local cluster's place named in title and H1 |
| GT-005 | gate-brief | every outline heading, required entity (as a phrase) and question of the brief is on the page; the word count reaches the brief's minimum. WARN (TGT-005, W; FAIL under `--strict`): fewer than `targeting.minTermCoverage` (0.6) of the brief's `## Required terms` (06 9.5) are in the main content |
| GT-006 | gate-links | each planned link is on the page; no anchor is "click here" / "read more"; body anchors share >=1 content token with the target's primary query; no broken internal link (complete sites) |
| GT-007 | gate-orphans | every indexable page has an inbound link and is reachable from `/` (complete sites only) |
| GT-008 | gate-schema | the planned schema types are in valid JSON-LD (subtypes count), required fields are filled, FAQ questions are shown on the page |
| GT-009 | gate-programmatic | template pages pass `plan/programmatic.json`: words, unique words, sourced local facts, similarity to siblings |
| GT-010 | gate-industry | the items of `rules/industries/<industry>.json`: licence number, brokerage, forbidden wording, placeholders, disclosure pages |
| GT-011 | gate-coverage | = TGT-011 (W): the top `targeting.priorityPages` (20; `--priority-pages N`, or `business.json` `targeting.priorityPages`) clusters by `priority` each have a built planned page (exists, answers 200). Unbuilt ones are listed with their value as WARN lines and the check still PASSES; under `--strict` it FAILS. A snapshot sample that lacks the page cannot judge (exit 2) |
| GT-012 | gate-intent-fit | = TGT-012 (P1): each planned page's type (06 9.3 on the built page: JSON-LD types, path, main entity) fits its cluster's intent (03 22.2): informational -> article, page, video, comparison; commercial -> comparison, article, category, page; transactional -> product, category, local, or a page whose brief has a CTA; local -> local, page, category; navigational -> page, home. The failure names the intent and the page type found |
| GT-013 | gate-freshness | = IDX-003 / SE-004 / AEO-012 (no fake freshness): with `--build "<cmd>" [--build-cwd DIR] [--setup "<cmd>"]` the site is built twice from the same source (`lib-freshness.mjs`, the same test as `check-stability.mjs`) and every date in the output must be equal: sitemap `<lastmod>` (indexes followed), JSON-LD `dateModified`/`datePublished` (in `@graph` too), `article:modified_time` / `og:updated_time`, `_headers` Last-Modified; every sitemap lastmod has seconds and a timezone and is not in the future. FAIL lists URL + field + both values. Without a build command it reads the one build: SE-004 plus the build-clock signature (>= 5 URLs sharing one lastmod, all within a minute of each other, within 10 min of the sitemap file's time) and notes the two-build test as NOT CHECKED. A clean git checkout is restored after the builds; other differing files are WARN |

Query match (GT-003, GT-004, P-006 of GT-001) = shipgate's: the **head term** of the primary query (web-delivery section 12: UAX #29 words, stop words of `rules/stop-words.json` and place names of `rules/gazetteer/us.json` removed, Snowball-stemmed;
`lib-text.mjs headTerm`) is contained in the text, or one of the cluster's queries is, as whole words. The older 80% token overlap (`lib-text.mjs overlap`) remains for GT-005 headings and GT-006 anchors. The effective gazetteer drops
code-like entries and ordinary words (`rules/README.md`, `PEWP_GAZETTEER_LITERAL=1` for the spec-literal one). A locale with no entry in a ruleset, or a language whose Snowball stemmer is not built (only English is), ends ERROR, never a silent guess.

## Reading a result (for the owner, in plain words)
Lead with one line: "the built site matches the plan" or "N checks fail". Then each failure as: what is wrong, on which page, what to change.
Explain "cannibalisation", "orphan page", "schema" and "programmatic page" once (the generated `report.md` has a Words used section).
FAIL on a planted fault is the point of the gate; a WARN is a launch blocker that is not yet a plan failure.

## Industry rules (`rules/industries/<slug>.json`)
Each item: `id`, `type` (`licence-on-every-page`, `business-text-on-every-page`, `forbidden-phrases`, `required-pages`, `required-when-present`, `forbidden-schema`), `severity` (`fail` | `warn`), `description`,
`source` (the requirement row it comes from). `business.json credentials` supply the values (state, licence number, brokerage, `licensed`). To add a state: add its
pattern under `licencePatterns`. To add an industry: add `<slug>.json` with checkable items; every item must trace to a source. The rules in this folder were written
from the Francine & Eli compliance notes, which are a draft consolidation and not legal advice. `insurance-agency` was written from recalled NAIC, FTC, TCPA and Google guidance (not re-fetched): every rule names its basis and the NAIC model-rule numbers and sections are marked UNVERIFIED until compliance confirms them for the states in use.

`required-when-present`: `require` is a list of `{label, pattern}` statements (all must appear, `caseSensitive: true` turns off the case-insensitive match); the item applies to a page when its `trigger` regex matches the page text, when `pageHasForm` is true and the page has a `<form>`, when its path matches `pathPattern`, or to every page when none of the three is given. `nearChars` (needs a `trigger`) makes the statement count only within that many characters of a trigger match (a disclosure next to the claim; one nearby occurrence is enough). `forbidden-schema`: `types` are JSON-LD `@type` names that must not appear (exact names, `@graph` and nested nodes walked). An optional `pageTypes` list (`id`, `plannerKind`, `schema`) feeds plan-site.mjs; `seeds.queries` feeds `research-seeds.mjs --industry`.

## After the gate
FAIL items go back to the builder (build mode) or to a fix worker (refactor mode) with the check's output as the acceptance test: the item must go FAIL to PASS and
no other check may go PASS to FAIL. Save the run: `runs/<date>-<mode>.md` (command, exit code, first 40 lines).

## Proof
`node scripts/test-plan-gate.mjs` (and `node scripts/test-rules.mjs` for the rulesets and the 9.x algorithms; `node scripts/test-freshness.mjs` for GT-013 and check-stability, with mutants): every check on the fixtures (each planted fault caught, a clean variant passes), per-check mutations of the site, and mutants of
the scripts themselves that must turn the test red.
