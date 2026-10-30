# Brief 4.1: the factory core, proven locally on the test site (Sonnet builder; one slice, one brief, discarded when done)

Written 2026-10-31 00:05 by the head of the Platform build department (session `local_cade0add-3389-4314-b7b5-83333d26a97a`).
You report to that head only (your final message is your report). Anything outside this brief is a finding you send back with
options, never a fix. You edit only: `factory/**` (except `factory/worker/**` and `factory/briefs/**`), `sites/test-demo-a/**`,
and your own paragraph under "## Step 4" in `docs/blueprint/PROGRESS.md`. Nothing in `E:\Alex Sevilla` is ever written (read-only).
No em dash character anywhere. No dependency (Node 20 built-ins only). Scripts go in files, never inline `node -e`.

## Read first, in order (file:line matters; do not skim)
1. `CLAUDE.md` (non-negotiables 2, 3, 7, 11), `docs/departments/README.md` rules 1 to 7.
2. `docs/blueprint/03-FRONTEND.md` section A (A1 inputs, A2 the design package, A3 build steps, A5 gates): the shape you build.
3. `docs/blueprint/23-GROUND-RULES.md` section 2 rule 10 and section 4 (how code is admitted: test first, watched red, a mutant).
4. `contracts/README.md`, `contracts/place.mjs` (the `place()` output: pages with sections of row ids, itemPages, sitemap, schema),
   `contracts/validate.mjs` exports (`validateItem`, `validateContract`, `mergeCore`), `contracts/from-plan.mjs` (`generate`),
   `contracts/core.json` (the core collections every site has: settings, pages, posts, team, testimonials, faqs, notices, media,
   redirects, leads), `contracts/test/run.mjs` lines 23 to 61 (how a synthetic plan becomes a contract: copy that way of working).
5. `tools/omnikom-cli/commands/seed.mjs` lines 1 to 40: `TEST_CONTRACT`, the collections the test workspace A already has on
   staging (team, listings, settings, leads). Read-only for you.
6. `tools/audit/README.md` (the publish gate your output must pass: 14 rules), `tools/audit/fixtures/good/` (a site that passes:
   copy its head shape, its JSON-LD `@graph` with Organization, WebSite, WebPage, its robots.txt and sitemap). Read-only for you.
7. The ELEV8 build you port from, read-only: `E:\Alex Sevilla\draft-site\site\build.mjs` (609 lines: how pages are emitted, the
   `_headers`, robots, sitemap, llms.txt, the writing-gate checks), `E:\Alex Sevilla\draft-site\site\lib\render.mjs` (71 lines, the
   logic-less template renderer you port verbatim), `lib\content.mjs` (how rows are validated: draft and publish), `lib\wg.mjs`.

## What exists and what you make
Exists: the contract library, the audit engine, the site lead endpoint (`factory/worker/`, not yours). Nothing of the factory exists.
You make, in this order (each with its test watched red before the code):

### 1. `factory/README.md`: the export shape and the look-folder convention (write it first, the head reviews it)
The export is the one JSON the runner fetches from `export-published` (slice 4.3 builds that function from THIS file, so be exact):
```
{ "schema": "omnikom-export/1",
  "job": { "id", "site_id", "workspace_id", "snapshot": { "<row id>": <version> }, "created_at" },
  "site": { "id", "deploy_target", "preview_host", "domain", "state" },          state: preview | live | paused
  "workspace": { "id", "slug", "name", "industry" },
  "contract": <the resolved contract: the active site_contracts.resolved>,
  "rows": [ { "id", "collection", "version", "data", "at" } ],                    exactly the frozen snapshot
  "media": [ { "id", "path", "width", "height", "processed", "exif_stripped", "rights_confirmed" } ] }
```
Look-folder `sites/<workspace.slug>/design/` (03-FRONTEND A2), every file a plain ES module or CSS, no dependency:
`tokens.css`, `base.css`, `shell.mjs` (default export `render({ page, main, ctx }) -> html`: `<head>` with title, description,
canonical, `og:url`, `hreflang`, one JSON-LD `@graph` with Organization, WebSite, WebPage; header; footer; "powered by Omnikom"
line per DECISIONS 31), `sections/<section-id>.mjs` (default export `render({ section, data, feed, form, ctx }) -> html`),
`item/<collection>.mjs` (default export `render({ row, ctx }) -> html`), optional `motion.js` (transform and opacity only).
`ctx` = `{ site, workspace, settings (the settings row's public data), origin, page, path, built_at, preview }`.
Templates as `.html` partials (the ported Mustache-subset renderer) are allowed inside a partial module; the module decides.

### 2. `factory/lib/html.mjs`, `factory/lib/template.mjs`
`html` tagged template: every interpolated value is escaped unless wrapped by `raw()`; arrays join. `template.mjs` = the ELEV8
`lib/render.mjs` ported with its header comment kept and the source path named ("ported from E:\Alex Sevilla\draft-site\site\lib\render.mjs
2026-10-31; the same partials move into the platform unchanged"): `{{a.b}}` `{{{a.b}}}` `{{.}}` `{{#a}}` `{{^a}}` `{{?a}}` `{{>name}}`,
a missing value throws. Tests for each tag and for the throw.

### 3. `factory/build.mjs`
`node factory/build.mjs --export <export.json> --out <dir> [--design <dir>] [--media <dir>] [--built-at <ISO>] [--force-fail heading]`
Steps (03-FRONTEND A3), each one a function in `factory/lib/*.mjs` so the tests can call it:
1. Load the export; check `schema`. Re-validate every row with `validateItem(contract, collection, data, { mode: 'publish', exists,
   media })` where `media(asset)` looks the asset up in `export.media` (an unknown file is `I-MEDIA-UNKNOWN`, an unprocessed one is
   refused as the contract says). Any problem: print each as `<row id> <code> <path> <msg>` and exit 1 with `BUILD STOPPED: content
   does not validate for publish`. Nothing is written.
2. `place(contract, rows)`. Only contract pages that HAVE a row in the `pages` collection are built and enter the sitemap (W2.2 rule);
   a missing page row is printed as `SKIP page <path>: no published row`.
3. Origin: `https://<site.domain>` when `site.state = live` and `domain` is set, else `https://preview.<site.deploy_target>.pages.dev`
   (the fixed preview branch address of 21-PROTOCOLS section 3). `preview = site.state !== 'live'`.
4. Render every built page: the page type's sections in contract order, each through `sections/<id>.mjs` with `data` = the page row's
   `sections[id]`, `feed` = the placed row ids resolved to `publicData(contract, collection, data)` (internal fields never reach a template),
   `form` = `contract.forms[section.form]`; then `shell.mjs`. Item pages through `item/<collection>.mjs`. `404.html` at the root with
   root-absolute paths.
5. Launch layer (`factory/lib/launch.mjs`): `_headers` with the security lines of the ELEV8 build (HSTS, nosniff, Referrer-Policy,
   Permissions-Policy, X-Frame-Options DENY, COOP same-origin, CSP, `/assets/*` immutable cache) and, on a preview build only,
   `X-Robots-Tag: noindex, nofollow`; `robots.txt` ALWAYS `User-agent: *` / `Allow: /` / `Sitemap: <origin>/sitemap.xml` (decision of the
   head, 2026-10-31: the audit engine's IDX-004 judges robots.txt and must judge the same files that deploy, so the preview is kept out
   of the index by the header, not by robots.txt; write this in the README); `sitemap.xml` with `<lastmod>` = `built_at` (IDX-003, the
   build clock); `llms.txt` from the built pages; `/media/<path>` copied from `--media <dir>` for every media row a built row references,
   and only those (A3 step 5 of 02-BACKEND: the build ships only referenced media); CSS from the look-folder as `/assets/<name>.<sha>.css`
   with the hash in the link.
6. Factory gates (`factory/lib/gates.mjs`), every page, any failure = exit 1 and NOTHING written to `--out` (write to a temp dir, move on
   success): exactly one `<h1>`, exactly one `<main>`, a `<title>` 1 to 60 chars, a description, canonical = origin + path, no
   `[client to` or `{{` left in the HTML, every `<form>` has `method="post"` and `action="/api/lead"`, every `<img>` has `alt`.
   `--force-fail heading` SKIPS the factory's own heading check and writes an `<h4>` right after the first `<h2>` of the contact page
   (a skipped heading level, MET-003 in `tools/audit/`): the audit gate must catch what the factory let through. Print
   `FORCED FAILURE: heading` so a log never mistakes it.
7. Print `BUILT <n> pages (<c> contract pages + <i> item pages) -> <out>` and `preview: <true|false>`; exit 0.

### 4. The test site: `sites/test-demo-a/`
`plan/` (a synthetic plan: sitemap.json and entities.json the way `contracts/test/run.mjs` lines 23 to 61 do it: `/`, `/contact/`,
`/homes-in-alpha/`, `/homes-in-beta/` bound to places alpha and beta; forms contact), `make-contract.mjs` (runs `generate()` and
writes `contract.json`; a test asserts the committed file equals the generator output, like `tools/audit/fixtures/build-fixtures.mjs --check`),
`contract.json`, `rows.json` (synthetic rows: settings "Demo A" with logo, phone 555, email example.com, the four page rows with
every required section field, two places, one team row "Agent One" (the seeded row's name, so the seed and this file agree),
two listings, the `form-consent` and `marketing-consent` notices with wording that passes the I-CONSENT lint of `contracts/validate.mjs`),
`media/` (one small PNG logo; its media row in the fixture export says processed, 400 wide, rights confirmed, exif stripped),
`design/` (the minimal look-folder: plain, readable, no invented brand; tokens, base, shell, sections hero / intro / feed / form /
contact, item/listings, item/team). The contract MUST keep the four seeded collections compatible with `tools/omnikom-cli/commands/seed.mjs`
`TEST_CONTRACT`: team `kind collection, access member own, ownerField self`; listings `member own, ownerField agent`; settings `singleton,
member none`; leads `inbox, member own, ownerField owner`. A unit test asserts exactly those keys for those four collections of the
RESOLVED contract (`mergeCore`). Where core and TEST_CONTRACT differ in other fields, core wins and the difference is listed in your report.

### 5. `factory/test/fixtures/export-test-demo-a.json`
Written by `factory/test/make-export.mjs` from `sites/test-demo-a/contract.json` + `rows.json` (ids as uuids, versions 1, `at` fixed,
site = the seeded site A of `seed.mjs`: id `aaaaaaaa-0000-0000-0000-00000000517e`, deploy_target `test-site-demo-a`, preview_host
`demo-a.preview.test`, state preview; workspace id `aaaaaaaa-0000-0000-0000-000000000000`, slug `test-demo-a`); the test asserts the
committed file equals the generator output.

### 6. `factory/test/run.mjs` and `factory/test/mutate.mjs`
`run.mjs` ends `OK: N of N checks passed` (exit 0) and covers: the template tags and throw; `html` escaping; the export loads and the
build writes the four pages + two item pages + 404 + sitemap + robots + `_headers` + llms.txt + the copied logo and nothing else of
`media/`; the sitemap equals the built indexable pages; the preview `_headers` has the noindex line and a live build (fixture copy with
state live + domain) has not and its canonical uses the domain; an unpublished page row = SKIP, not in the sitemap; publish-mode
validation failure (a required field removed) = exit 1 and an empty out dir; each factory gate red on a mutated page (second h1, no
main, title 61 chars, a `{{` left, a form without action, an img without alt); `--force-fail heading` builds and the audit engine
(`import { audit } from '../../tools/audit/index.mjs'`, read-only use) reports a MET-003 FAIL on `/contact/`; without it the audit
reports 0 FAIL on the whole dist; the four seeded collections compatibility test; the two generator-equals-file tests.
`mutate.mjs` removes one rule at a time from the factory source text (each gate, the referenced-media filter, the page-row rule, the
noindex header, the robots Sitemap line, the canonical, the escaping in `html`) and requires `run.mjs` to go red for each; ends
`N mutants, N caught, 0 survived, 0 target text missing`, exit 0. Pattern: `tools/audit/test/mutate.mjs` (read-only).

## Gates (run them yourself; paste the real last lines into PROGRESS.md under "## Step 4", a sub-heading "4.1 factory core (builder)")
```
node factory/test/run.mjs                                   -> OK: N of N checks passed, exit 0
node factory/test/mutate.mjs                                -> N mutants, N caught, 0 survived, 0 target text missing, exit 0
node factory/build.mjs --export factory/test/fixtures/export-test-demo-a.json --out <scratch>/dist --media sites/test-demo-a/media
node tools/audit/run.mjs <scratch>/dist                     -> every line PASS or WARN, exit 0 (paste the stderr summary line)
node factory/build.mjs ... --out <scratch>/dist-bad --force-fail heading
node tools/audit/run.mjs <scratch>/dist-bad                 -> a FAIL MET-003 /contact/:<line> ... line, exit 1
node docs/blueprint/specs/run-all-gates.mjs                 -> all gates passed (you touch nothing it covers; a red is a finding)
```
Scratch output goes to your scratchpad directory, never into the repo. `git status` at the end must show only your files.
Watched-fail evidence: for each gate, the one-line red output you saw before the code existed (keep them short in PROGRESS.md).

## Report (your last message, two parts)
1. PROVEN / UNPROVEN / NOT DONE per numbered item above, with the gate line for each (no prose claims without a pasted line).
2. Findings outside this brief (other departments' files, decisions the head must take), each with options. Known already, do not
   repeat: `seed test` seeds no pages (sent up), the dispatch token (sent up).
