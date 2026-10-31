# factory: the website build, one export in, one folder of static files out

Slice 4.1 (the factory core). Owner: the platform build department (`docs/departments/platform-build.md`). The shape follows
`docs/blueprint/03-FRONTEND.md` section A. Node 20+ built-ins only, no dependency. `factory/worker/` (the site's lead endpoint) is
a different slice and is not described here.

```
node factory/build.mjs --export <export.json> --out <dir> [--design <dir>] [--media <dir>] [--built-at <ISO>] [--force-fail heading]
```
Exit 0 built. Exit 1 the build stopped (rows do not validate for publish, a design or media problem, a factory gate) and NOTHING
was written to `--out`. Exit 2 usage (also: `--out` already holds files; the factory never empties a folder it was not given empty).

## 1. The export (the one JSON the runner fetches from `export-published`)
Slice 4.3 builds `export-published` from THIS section, so the names are exact. `schema` is checked first; any other value stops
the build.
```
{ "schema": "omnikom-export/1",
  "job":       { "id", "site_id", "workspace_id", "snapshot": { "<row id>": <version> }, "created_at" },
  "site":      { "id", "deploy_target", "preview_host", "domain", "state" },        state: preview | live | paused; domain may be null
  "workspace": { "id", "slug", "name", "industry" },
  "contract":  <the resolved contract: the active site_contracts.resolved (the whole contract with the core merged in)>,
  "rows":      [ { "id", "collection", "version", "data", "at" } ],                  exactly the frozen snapshot
  "media":     [ { "id", "path", "width", "height", "processed", "exif_stripped", "rights_confirmed" } ] }
```
- A row's image, gallery or file value is `{ "asset": "<media.id>", "alt": ... }`; a reference field holds a row id.
- The media facts (width, processed, EXIF stripped, rights ticked) come from `media[]`, never from the row: `validateItem` is given
  `media(asset)` that looks the asset up there. An id that is not in `media[]` is `I-MEDIA-UNKNOWN`, an unprocessed one is refused.
- `media[].path` is the storage path. The runner puts the file at `<--media dir>/<path>` before the build; the build copies it to
  `/media/<path>` and only for media a built row references. A path with `..`, an empty segment or a backslash stops the build.
- Fixture: `factory/test/fixtures/export-test-demo-a.json`, written by `factory/test/make-export.mjs` from
  `sites/test-demo-a/contract.json` + `rows.json` (the seeded site A and workspace A of `tools/omnikom-cli/commands/seed.mjs`).

## 2. The look-folder: `sites/<workspace.slug>/design/` (03-FRONTEND A2)
Every file is a plain ES module or CSS, no dependency. A module imports the `html` tag by a relative path
(`../../../factory/lib/html.mjs`, one more `../` from `sections/` and `item/`).
```
tokens.css            colours, type scale, spacing, radii (the approved design; no value invented)
base.css              layout, header, footer, utilities
shell.mjs             default export render({ page, main, ctx }) -> html
sections/<id>.mjs     default export render({ section, data, feed, form, ctx }) -> html       one per section id of the contract
item/<collection>.mjs default export render({ row, ctx }) -> html                              one per routed collection
motion.js             optional; transform and opacity only, respects prefers-reduced-motion
```
`shell.mjs` writes the whole document: `<head>` with `<title>`, meta description, canonical, `og:url`, `hreflang`, ONE JSON-LD
`@graph` holding Organization, WebSite and WebPage (the WebPage `@id` is `<canonical>#webpage`); the header; `<main>` around
`main`; the footer with the "powered by Omnikom" line (DECISIONS 31). A partial may use a `.html` template with the ported Mustache
subset (`lib/template.mjs`, ported from the ELEV8 build); the module decides.

What a module is given:
- `html` tag (`lib/html.mjs`): every interpolated value is HTML-escaped unless wrapped by `raw()` or produced by another `html`
  call; an array is joined; null, undefined and false print nothing. Rich text is NOT sanitised by the factory yet: a design prints
  richtext fields escaped (as the test design does) until the sanitiser of 03-FRONTEND A2 exists.
- `section` = the contract's section object (`{ id, kind, ... }`; a form section has `.form`, the form id).
- `data` = the page row's `sections[<id>]` (a notice section gets the notice row's public data).
- `feed` = the row ids that `place()` put in this section, each resolved to `publicData(contract, collection, data)` (internal
  fields and fields whose `visibleWhen` is not met never reach a template) plus `_id` and, for a routed collection, `_path`.
- `form` = `contract.forms[section.form]`. `row` (item pages) = the same shape as a feed entry.
- `ctx` = `{ site, workspace, settings, origin, page, path, built_at, preview }` where `settings` is the settings row's public
  data, `origin` has no trailing slash, `preview` is true unless the site is live. Additions the first designs needed:
  `ctx.media(assetId) -> { url, width, height }`, `ctx.nav` (`[{ path, type, title }]`, the built contract pages in contract
  order: link only to these, a page nobody published is not in it), `ctx.notices` (notice slug -> public data; the consent text
  of a form), `ctx.assets` (`{ css: [href], js: [href] }`, the hashed files to link).
- `page` = `{ kind: "page" | "item" | "404", path, type, bind, title, seo, description, noindex, bound }`; `bound` is the entry of
  the row a bound page presents (a place guide), or null.

## 3. What the build does (`lib/site.mjs`, each step a function in `lib/*.mjs`)
1. Load the export, check `schema`, re-validate the contract and every row with `validateItem(..., { mode: 'publish', exists,
   media })`. Any problem prints `<row id> <code> <path> <msg>`, then `BUILD STOPPED: content does not validate for publish`.
2. `place(contract, rows)`. Only a contract page that HAS a row in `pages` is built and listed in the sitemap; the others print
   `SKIP page <path>: no published row`. A page row with `seo.noindex` is built with a robots noindex meta and left out of the sitemap.
3. Origin: `https://<site.domain>` when `state = live` and a domain is set, else `https://preview.<site.deploy_target>.pages.dev`
   (21-PROTOCOLS section 3). `preview = state !== 'live'`.
4. Render the contract pages (sections in contract order), the item pages, and `404.html` (root-absolute paths, noindex, no canonical,
   not in the sitemap). Output is the same for the same export and `--built-at` (byte for byte).
5. Launch layer (`lib/launch.mjs`): `_headers` (HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options DENY, COOP
   same-origin, CSP, immutable cache for `/assets/*`, and on a preview only `X-Robots-Tag: noindex, nofollow`); `robots.txt`;
   `sitemap.xml` (`<lastmod>` = `--built-at`, default the time of the build); `llms.txt` from the sitemap pages; `/media/<path>`;
   `/assets/<name>.<sha>.css` (and `motion.<sha>.js`) with the first 10 hex characters of the sha256 of the file in the name.
6. Gates (`lib/gates.mjs`), every page: one `<h1>`, one `<main>`, a `<title>` of 1 to 60 characters, a meta description,
   canonical = origin + path (not on the 404), no `[client to` and no `{{` in the HTML, every `<form>` `method="post"`
   `action="/api/lead"`, every `<img>` has `alt`, heading levels never skip. One failure prints `BUILD STOPPED: gate <gate> <path>:
   <why>` and writes nothing. The output goes to a sibling temp folder and is moved to `--out` in one rename.
7. Prints `BUILT <n> pages (<c> contract pages + <i> item pages) -> <out>` (the 404 is not counted) and `preview: <true|false>`.

**robots.txt is always `User-agent: *` / `Allow: /` / `Sitemap: <origin>/sitemap.xml`, preview or live** (decision of the head,
2026-10-31): the audit engine's IDX-004 judges `robots.txt` and must judge the same files that deploy, so a preview is kept out
of the index by the `X-Robots-Tag` header, not by `robots.txt`.

`--force-fail heading` is the proof that the audit gate is independent: the factory skips its own heading check and writes an
`<h4>` right after the first `<h2>` of the contact page (a skipped level, MET-003 of `tools/audit`). It prints
`FORCED FAILURE: heading`. `node tools/audit/run.mjs <out>` must then print a `FAIL MET-003 /contact/:<line>` line.

## 4. Proof
```
node factory/test/run.mjs      OK: N of N checks passed                       (template tags, html escaping, export, build, gates, audit, site)
node factory/test/mutate.mjs   N mutants, N caught, 0 survived, 0 target text missing
node factory/build.mjs --export factory/test/fixtures/export-test-demo-a.json --out <scratch>/dist --media sites/test-demo-a/media
node tools/audit/run.mjs <scratch>/dist                                       every line PASS or WARN, exit 0
```
Rule 10 of `docs/blueprint/23-GROUND-RULES.md`: every gate and every launch rule above has a check watched failing and a mutant.
The test site `sites/test-demo-a/` is synthetic ("Demo A"): `plan/` (sitemap.json, entities.json), `make-contract.mjs` (runs
`contracts/from-plan.mjs`; a test asserts the committed `contract.json` equals its output), `rows.json`, `media/logo.png`,
`design/` (the minimal look). Its team, listings, settings and leads keep the keys of the seed command's `TEST_CONTRACT`.
