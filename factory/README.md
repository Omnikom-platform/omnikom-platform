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
  "media":     [ { "id", "path", "original_path", "width", "height", "processed", "exif_stripped", "rights_confirmed", "url", "error"? } ] }
```
- A row's image, gallery or file value is `{ "asset": "<media.id>", "alt": ... }`; a reference field holds a row id.
- The media facts (width, processed, EXIF stripped, rights ticked) come from `media[]`, never from the row: `validateItem` is given
  `media(asset)` that looks the asset up there. An id that is not in `media[]` is `I-MEDIA-UNKNOWN`, an unprocessed one is refused.
- `media[].path` is the storage path. The runner puts the file at `<--media dir>/<path>` before the build; the build copies it to
  `/media/<path>` and only for media a built row references. A path with `..`, an empty segment or a backslash stops the build.
- **Which media, which path (slice 4.3, decision of the head 2026-10-31; ground rule 11).** `media[]` lists the workspace's PROCESSED media
  only (an unprocessed upload is not exported; a row that references one fails `I-MEDIA-UNKNOWN`). `path` is the WebP derivative the
  runner's media job uploaded: `<upload path without extension>-<slot>.webp`, inside `<workspace id>/`. The derivatives are "slots" 2400,
  1600 and 800 px wide; a slot exists when the original is at least that wide (never upscaled) and the 800 slot ALWAYS exists (for an original
  narrower than 800 it holds the image at its own width). The export serves the widest slot that exists: `slot = 2400` if `width >= 2400`,
  else `1600` if `width >= 1600`, else `800` (`derivativeSlot` in `supabase/functions/_shared/storage.ts`; tested at 2399, 2400, 1599, 1600,
  799, 400, 200). It is NEVER the original upload, which still carries its GPS data. `original_path` is the upload's storage path, information only: the platform never signs or serves it.
  `url` is a signed download URL for `path` (made with the Storage secret key; signed URLs expire after 1 hour, so download at once, never
  store the URL). A file Storage would not sign has `url: null` and `error: "sign failed"`: the build fails if a built row references it.
  `width` and `height` are those of the original after its orientation is applied (the facts `validateItem` checks); the served
  derivative is narrower when the original is.
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
subset (`lib/template.mjs`, ported from the ELEV8 build); the module decides; `{{{x}}}` is refused in a design (E18).

What a module is given:
- `html` tag (`lib/html.mjs`): every interpolated value is HTML-escaped unless wrapped by `raw()` or produced by another `html`
  call; an array is joined; null, undefined and false print nothing. Rich text goes through `rich(value)`: unchanged when
  `contracts/richtext.mjs` allows it, else the build stops; JSON-LD through `jsonScript(object)`. `lib/design.mjs` stops a design
  that passes a value to `raw()` or renames it (E18).
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

## 5. Runner (slice 4.4): `factory/runner/`, `.github/workflows/`, `tools/github-secrets.mjs`
Owner: the platform build department. The runner is the GitHub Actions side of a publish: it fetches the export, builds, judges the
build with the audit engine, deploys to Cloudflare Pages, smoke-tests the deployment by content hash, rolls a live deploy that fails back, and tells the platform. Design: `docs/blueprint/02-BACKEND.md`
sections 5, 7, 8 and `21-PROTOCOLS.md` sections 1 to 3. It is proven against a FAKE platform and a FAKE wrangler; against the real Edge
Functions and the real Cloudflare account it is UNPROVEN until slice 4.5.

```
node factory/runner/publish.mjs [--force-fail heading] [--no-deploy <dir>] [--work <dir>]      JOB_ID SITE_ID PLATFORM_FUNCTIONS_BASE RUNNER_KEY CLOUDFLARE_PAGES_TOKEN CLOUDFLARE_ACCOUNT_ID
node factory/runner/media.mjs                                                                   MEDIA_ID WORKSPACE_ID PLATFORM_FUNCTIONS_BASE RUNNER_KEY      (needs: npm ci --prefix factory/runner --ignore-scripts)
```
- **Signature.** `lib/sign.mjs` is a port of `supabase/functions/_shared/signature.ts`: header `X-Runner-Signature: t=<unix>,v1=<hex>`,
  HMAC-SHA256 over `t\nMETHOD\npath?query\nbody`, 300 s window. The path is what FOLLOWS `PLATFORM_FUNCTIONS_BASE` (the `/functions/v1`
  prefix is never signed): `/export-published?job=<id>`, `/job-callback`, `/media-export?media=<id>`, `/media-process-callback`. A GET signs an
  empty body. The tests have the platform's own `verify` judge every header.
- **publish.mjs steps**, each printed `STEP <name>: <result>`: `export` (GET, refuses a different site or job, a missing `sites/<slug>/design/`)
  -> `media` (downloads every signed URL of `media[]`; one that fails is only reported, the factory stops if a built row needs it) -> `build`
  (`factory/build.mjs`) -> `gating` (callback, then `tools/audit/run.mjs`; exit 1 = failed with the FAIL lines in `gateReport.audit.fails`)
  -> `deploying` (callback, then `wrangler pages deploy`, branch `preview` unless the site is live, then `main`) -> `smoke` (both addresses, 6 tries
  10 s apart: the site's fixed address answers 200, `x-robots-tag: noindex` on a preview and NOT on a live site, the built home page `<title>` in
  the body; the deployment's own address `https://<hash>.<project>.pages.dev` serves bytes whose sha256 is that of the built `index.html`) -> `done`
  (callback with the deploy id and `{ factory: 'pass', audit: { exit: 0, fails: [] } }`). The export call already moved the job to `building`
  (`freeze_snapshot`), so there is no `building` callback. Every failure sends ONE `failed` callback (`error` = the short reason,
  `gateReport.reason` the same) and exits 1; a 409 from any callback is printed and the run stops without sending more. A live site (branch
  `main`) that fails the smoke is first rolled back, before that `failed` callback: Pages makes a production deployment live the moment it
  exists, so the runner POSTs the Pages rollback to the deployment that was live before (read from the project's settings before the deploy, one
  try, the runner's own token) and the `error` says `deployed but smoke failed; rolled back to deployment <id>` (or that there was none, or that
  Cloudflare refused). A preview is never rolled back. The field and the call are UNPROVEN against the real API (`liveDeploymentOf`, `rollbackUrl`).
- **Deploy.** `npx --yes wrangler@4.152.0 pages deploy <work>/dist --project-name <site.deploy_target> --branch <preview|main> --commit-dirty=true`
  run from `<work>/pages-root/`, which holds `functions/api/lead.js` and `lead-endpoint.mjs` (copied from `factory/worker/`) so the site's
  `/api/lead` travels with the deploy. wrangler gets `CLOUDFLARE_API_TOKEN` (= `CLOUDFLARE_PAGES_TOKEN`) and `CLOUDFLARE_ACCOUNT_ID` and
  nothing of the runner key or the platform address. The deploy id sent to the platform is the deployment hash from the printed address
  (`https://<hash>.<project>.pages.dev`).
- **Bounds.** Every fetch has a timeout (30 s, media 60 s), a call is tried 3 times on a network error or 502/503/504, every child process has a
  timeout (build 3 min, audit 3 min, wrangler 7 min), the media step 4 min in all. Everything printed passes the scrubber: secret values, the
  project ref, `?token=` of a signed URL, JWT-shaped strings.
- **media.mjs.** GET `media-export` -> refuses a `workspace_id` that is not the dispatch's -> downloads -> sharp: orientation applied, WebP at
  2400 / 1600 / 800 wide (a size wider than the original is skipped and listed in `skipped`), no `withMetadata()` so EXIF, GPS, XMP and ICC are
  gone -> PUT each size to its signed upload URL (`x-upsert: true`) -> `media-process-callback` `{ media, width, height, exifStripped: true, bytes,
  sizes, skipped }` (width and height are the oriented size). A PDF sends `{ media, kind: 'document' }`. An original narrower than 800 px is
  refused (nothing sent; publish refuses an unprocessed photo).
- **Test hooks** (not for production): `OMNIKOM_REPO_ROOT`, `RUNNER_WRANGLER_SCRIPT`, `RUNNER_FETCH_TIMEOUT_MS`, `RUNNER_RETRY_BACKOFF_MS`,
  `RUNNER_SMOKE_DEPLOY_URL` (stands in for the deployment's own address, which a `--no-deploy` run has none of),
  `--smoke-url`, `--smoke-tries`, `--smoke-interval-ms`; `--no-deploy <dir>` copies `dist/` there and invents the deploy id `local-<sha>`.
- **Workflows** (`.github/workflows/`, every action pinned by SHA, `permissions: contents: read`, a timeout on every job, `.github/actionlint.yaml`
  ignores only actionlint 1.7.12's ignorance of `concurrency.queue`): `publish.yml` (repository_dispatch `publish` + a manual
  `workflow_dispatch` with `job_id`, `site_id`, `force_fail`), `media.yml` (repository_dispatch `media`), `ci.yml` (eight jobs), `keepalive.yml`
  (Mondays 06:00 UTC), `backup.yml` (complete but off until `vars.BACKUP_ENABLED == 'true'`: BLOCKED on R2).
- **Secrets for the repository**: `tools/github-secrets.mjs` (values from the env by name onto `gh secret set` stdin; `--dry-run` prints names only).
- **Proof**: `node factory/runner/test/run.mjs` (OK: N of N checks passed; the media checks print `SKIP media test: run npm ci --prefix factory/runner`
  when sharp is missing) and `node factory/runner/test/mutate.mjs` (N mutants, N caught, 0 survived, 0 target text missing).

## 6. The platform side of the runner (slice 4.3): `supabase/functions/{export-published,job-callback,media-export,media-process-callback}/`
Every call carries `X-Runner-Signature: t=<unix>,v1=<hex>` (section 5), verified with the function secret `RUNNER_KEY` before anything else; a bad,
missing or stale (older or newer than 300 s) signature is `401 { code: 'SIGNATURE' }` and one security event (kind bad-signature, detail kind
runner). Every answer is JSON (or 204) and `cache-control: no-store`; an error body is `{ code, message }`. A refusal of the state machine
(409, 404) is not a security event. The shared frame is `supabase/functions/_shared/runner.ts`, the Storage signing `_shared/storage.ts`.

| call | answer |
|---|---|
| `GET /export-published?job=<uuid>` (signs an empty body) | `200` the export of section 1. The FIRST call freezes the snapshot and moves the job `queued -> building` (so the runner sends no `building` callback); a rerun answers the same snapshot and rows and moves nothing. `404 S-NOT-FOUND` (malformed id or no such job), `409 S-JOB-BUSY` (another build of this site runs: retry later), `500 CONFIG` |
| `POST /job-callback` `{ job, state, gateReport?, deployId?, error? }` | `204`. `state` is `building`, `gating`, `deploying`, `done` or `failed` (`queued` or any other value is `400`); `gateReport` an object of at most 64 KiB (`413` beyond); `deployId` at most 200 and `error` at most 2000 characters. `409 S-JOB-STATE` when the database refuses the change (`done` straight from `queued`, anything after `done` or `failed`), `404 S-NOT-FOUND`. `done` moves `published_version` of the job's rows to their snapshot versions; `failed` moves nothing. Nothing else happens (no requester notice, no sitemap submit yet) |
| `GET /media-export?media=<uuid>` | `200 { id, workspace_id, path, processed, url, uploads: { "2400": <url>, "1600": <url>, "800": <url> } }`: `url` is a signed download URL of the ORIGINAL upload (1 hour); each `uploads` URL is a signed upload URL (upsert allowed, so a rerun may write again) for `<path without extension>-<width>.webp` in the same `<workspace id>/` folder (always the three slots; the export serves the widest one that exists, section 1). `404`, `502 STORAGE` (a file could not be signed: retry, then fail the media job) |
| `POST /media-process-callback` `{ media, width, height, exifStripped: true, bytes, sizes: [..], skipped?: [..] }` | `204`. `exifStripped` must be the boolean `true`, else `422 I-EXIF` and the file stays unprocessed; `width` and `height` are whole numbers of at least 1 (`422 I-MEDIA-SIZE` below that); `sizes` and `skipped` are accepted and ignored (an original narrower than 800 px is accepted with `sizes: [800]`). `{ media, kind: 'document' }` (a PDF) is `422 I-MEDIA-SIZE`: a document cannot be marked processed (no document flag in the data model). `404` unknown file, `400` a body of the wrong shape |

The runner key lives in the function secrets and the GitHub secret `RUNNER_KEY`; its registry row (`api_keys`, kind `runner`, the sha256 only) shows
`last_used_at`. `node tools/mint-site-key.mjs --runner` mints it (value to the env file by name, never printed).
