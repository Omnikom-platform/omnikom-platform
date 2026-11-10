# Work order 38: dashboard hardening (row E7, SEO's parts): proof

Branch `check/seo/dashboard-hardening` on master `30f0dcb`. Brief: `work/38-dashboard-hardening/CONTEXT.md`. Written by the builder (Sonnet); the head re-runs it.
Status words as in CLAUDE.md rule 2: PROVEN (a command ran, its output is pasted), UNPROVEN, NOT DONE, BLOCKED.

## What was built
| Piece | File | State |
|---|---|---|
| Headers and cache rules | `apps/dashboard/public/_headers` | written; reaches `dist/` through Vite's `public/` copy |
| Error screen | `apps/dashboard/src/ErrorScreen.tsx`, `ErrorScreen.test.tsx` | written, unit tests and plan gate green |
| Plan rows | `docs/blueprint/16-DESIGN-PARTS.md` DP-1.2s-12, DP-1.2s-13 | added after platform's OK (head's message 2026-11-10 20:50) |
| Router wiring (platform's file) | `work/38-dashboard-hardening/router-wiring.patch` | written; `git apply --check` OK on this tree; not applied |
| Audit rules | `tools/audit/checks/sec-010.mjs`, `sec-075.mjs`, `lib/secheaders.mjs`, `lib/csp-bypass-hosts.json`, `rules/SEC-010.md`, `rules/SEC-075.md` | written; the engine now has 32 rules |
| Audit tests and mutants | `tools/audit/test/sec.mjs`, `mutants-sec.mjs` (72), `check-mutant-targets.mjs`; 5 fixtures, snapshot fixtures carry the headers | tests run alone; mutants NOT RUN here (rule of 2026-11-10: they run on CI) |
| Deployed-origin flows | `tools/audit/dashboard-csp/` | written; NOT RUN (needs the staging deploy) |

## Findings, for the head
1. The brief said the live snapshot does not keep response headers. It does: `skills/.../scripts/snapshot-site.mjs:128` reads every header and `:338` writes them into each page's
   `response.json` (`headers`); `site/robots.json` has them too (`:255`). The audit just never read them. `lib/context.mjs` now does (no skill change, so no sync). What the snapshot does NOT keep is the
   headers of an asset: `browser-<profile>.json` keeps only `cacheControl` per request (`cdp-measure.mjs:187-191`). So the cache rule (`/assets/*` immutable) is checked by `curl -sI` in the staging proof,
   not by an audit rule; a SEC rule for it would need the skill's snapshot to keep asset headers (skill change, outside this order).
2. **A built folder with no `_headers` file is NOT JUDGED by SEC-010 or SEC-075** (its host may add the headers, so the folder says nothing) and prints no SEC line; a snapshot of a live site
   and a folder with a `_headers` file are always judged. A SKIP line instead would change every folder run and break the "0 SKIP" and `1 SKIP` literals in the CLI's tests
   (`tools/omnikom-cli/test/run.mjs`, CLI's file). Ruled fine by the head, 2026-11-10 21:28; also stated in `tools/audit/README.md` and both rule files ("Not judged here").
3. The new rules fire on every factory build: `factory/lib/launch.mjs` `headersText` writes the same seven headers, and the generator now uses the same values, so the factory's builds pass (the
   fixtures prove the factory's header text passes). UNPROVEN on a real factory build: `factory/test/run.mjs` was not run here (rule of 2026-11-10); CI runs it.
4. `names.json` (plain names) must name every rule, and its topics are the dashboard spec's eleven. SEC-010 and SEC-075 are under the topic `setting` ("Preview or live setting"), the nearest fit.
   A "Security" topic needs `docs/product/6-dashboard.md` and `names.json` and its test changed together (platform's spec).
5. The CSP's Supabase hosts are the wildcard `https://*.supabase.co wss://*.supabase.co` as the brief says (`_headers` is static; the ref differs per environment). It lets the page talk to any
   Supabase project, not only ours. Exact per-environment origins need a build step (platform's). SEC-075 does not judge `connect-src` (the spec judges script sources only), so the audit is silent about it.
6. `img-src` has no `blob:` (the brief listed it): no `src/` code puts a blob in an image. The one blob, `src/leads-view.ts:15`, is the CSV download link (a navigation, not an image or a fetch).
   The staging run will say if this is wrong.

## CSP sources, with file:line
| Directive | Value | Why (where the page needs it) |
|---|---|---|
| `script-src 'self'` | | the one module script `index.html:12`, built to `<script type="module" src="/assets/index-*.js">`; the build has no inline script (`dist/index.html` read after a build with dummy public values: one script tag with `src`, one stylesheet link, nothing else); the app chunk loads by dynamic `import()` (`src/main.tsx:13`) from `/assets/` |
| `style-src 'self'` | | the built stylesheet links only; no `style=` attribute and no `style={` in `src/` (Grep, 0 matches outside tests) |
| `font-src 'self'` | | `src/styles/base.css:5` `url('./fonts/Poppins-SemiBold.woff2')`, built to `/assets/Poppins-SemiBold-*.woff2` (51 KB, so not inlined) |
| `img-src 'self' data: https://*.supabase.co` | | `index.html:7` `<link rel="icon" href="data:,">`; `src/pages/Widgets.tsx:406` `<img src={url.data}>` from `src/data.ts:350` `createSignedUrl` (Storage, `https://<ref>.supabase.co/storage/v1/object/sign/...`) |
| `connect-src 'self' https://*.supabase.co wss://*.supabase.co` | | `src/supabase.ts:7` supabase-js (REST, Auth, Storage); `src/api.ts:17` functions at `config.functionsBase` (`https://<ref>.supabase.co/functions/v1` in a `--direct-functions` build, `scripts/build-staging.mjs:15`; `/functions/v1` on the page's own origin otherwise); `src/api.ts:142` the photo upload PUT to the signed address from `upload-start` (`supabase/functions/upload-start/index.ts:34`, `${base}/storage/v1${signed.url}`, the same host); Realtime `src/data.ts:231, 253, 312` over `wss://<ref>.supabase.co` |
| `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'` | | no frame, no `<base>`, no object in `src/` |
| `form-action 'self'` | | the forms (`Login.tsx:95, 102`, `LeadPanel.tsx:297`, `AddLead.tsx:90`, `SettingsAlerts.tsx:56`, `SettingsPeople.tsx:91`) are handled by `onSubmit`; none has an `action` |

Header sources: Cloudflare Pages `_headers` rules, https://developers.cloudflare.com/pages/configuration/headers/ (read 2026-11-10): every matching rule adds its headers, and a header set twice
is joined with a comma (so `/assets/*` detaches the `/*` Cache-Control with `! Cache-Control`); `!` removes a header; one splat per pattern; at most 100 rules and 2,000 characters per line
(our CSP line is about 330); `_headers` does not apply to Pages Functions responses (the dashboard has none: its functions are Supabase's). HSTS has no `preload` (the owner's domain call).

## Proven so far
(commands and their pasted output are added below as each part runs)

### The router patch shows the error screen (PROVEN, 2026-11-10 21:33, local build, installed Edge, no network, dummy public values)
Command: `node ~/.claude/scripts/heavy.mjs --wait-min 60 --label "SEO 38: router patch scratch test ..." -- node work/38-dashboard-hardening/router-scratch.mjs <scratch folder>`. The script copies
`apps/dashboard` twice, adds a route `/boom` that throws an error carrying a marker, applies `router-wiring.patch` to one copy (the other is the control), builds both, and opens `/boom` at
390x844 and 1536x730. Output (the `ok` lines; exit 0):
```
ok   control 390x844: without the patch the router's own screen shows (no plan sentence, no DP-1.2s-12 or DP-1.2s-13, no Reload button; ...)
ok   control 390x844: without the patch one click on "Show Error" puts the thrown error's text on the page (what ErrorScreen never does)
(the same two for 1536x730)
ok   patched 390x844: the page shows the plan sentence in exactly one h1
ok   patched 390x844: one Reload button, and the elements carry DP-1.2s-12 and DP-1.2s-13
ok   patched 390x844: no error text, marker, path or stack on the page (SEC-007)
ok   patched 390x844: no visible text under 14 px (smallest 16 px)
ok   patched 390x844: the h1 is Poppins, weight 600, and the Poppins 600 face is loaded
ok   patched 390x844: Reload reloads the page (a window marker set before the click is gone after it)
ok   patched 390x844: nothing else logged an error to the console but the thrown route error itself
(the same seven for 1536x730)
OK: the patched router shows the error screen, the unpatched one shows the router's own error text
```
The 14 px, h1 and Poppins checks are those of `apps/dashboard/tests/styles.spec.ts` (platform's ask). Honest note: the first three runs of this script were red on my own control assertion (the router's
screen hides its text behind "Show Error", and the control page carries the toast container `DP-1.2s-08`); the patched checks were green in all four runs, and only the control checks changed.

## NOT DONE yet
- the staging deploys, the `curl -sI` lines, the audit on a live snapshot, the flows on the deployed origin (each deploy waits for the head's yes)
