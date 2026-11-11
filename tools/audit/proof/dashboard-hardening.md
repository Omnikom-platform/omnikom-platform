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
| Deployed-origin flows | `tools/audit/dashboard-csp/` | written and RUN on the deployed origin (report-only and enforced, below): 43 of 44 passed, 1 skipped, 0 CSP violations |

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

## Staging deploy log (`omnikom-app-staging`, SHARED with platform: its flows ran on it about 04:30 on 2026-11-11)
Rule from the head of operations (via the head, 2026-11-11 05:16): after the enforced deploy and its checks, deploy master's build back (`build-staging` from master's tree) and confirm by `curl -sI`
that the CSP headers match master's, unless the head passes platform's OK to leave ours. Each deploy's time and build are recorded here.
| # | Time (local) | Build | Deploy address | State |
|---|---|---|---|---|
| 1 | 2026-11-10 (evening; exact clock not kept, the deploy tool's output is in the session scratchpad `deploy1.out`) | this branch, `_headers` with the CSP as `Content-Security-Policy-Report-Only` | `https://655f206e.omnikom-app-staging.pages.dev` | live as of 2026-11-11 05:16 (head curled it) |
| 1b | 2026-11-11 06:14 to 06:16 | this branch rebased onto master `9b0bb8a` (tip `8806ccf`), `_headers` with the CSP as `Content-Security-Policy-Report-Only`; built with `build-staging.mjs --direct-functions` (exit 0, bundle-secret check ok), 0 inline `<script>`, 0 `style=` in `dist/index.html` | `https://df148eb1.omnikom-app-staging.pages.dev` | live; `curl -sI` of `/` and `/assets/App-Cr4lzVM-*.js` shows report-only CSP, HSTS, nosniff, DENY, referrer, permissions, COOP; asset `Cache-Control: public, max-age=31536000, immutable`, page `no-cache` (the build of deploy 1 was on the older base 2486091, and its Leads list drew 0 rows against the migrated staging database: version drift, see the finding below) |
| 2 | 2026-11-11 06:43:45 to 06:44:27 | the same build (`App-Cr4lzVM-*.js`), `dist/_headers` restored byte-equal to `public/_headers` (`cmp`), CSP enforced | `https://a6744f9e.omnikom-app-staging.pages.dev` | live; `curl -sI` of `/`, `/w/x/leads` and the asset shows `content-security-policy:` (no Report-Only) and every other header of `public/_headers`; audit and flows below |
| 3 | not yet | master's tree (`build-staging`), back | | NOT DONE. Platform's OK (via the head, 2026-11-11 05:17): our report-only build may stay until deploy 2; master's build goes back when WO38 is done. Platform's own flows run LOCALLY, so nothing of theirs has exercised our headers: our runs are the only evidence about our build. |

### SEC-010 and SEC-075 on a live snapshot of the enforced staging dashboard (PROVEN, 2026-11-11 about 07:00, after deploy 2)
Command (under the heavy lock): `node tools/audit/live.mjs https://omnikom-app-staging.pages.dev --fresh --only SEC-010,SEC-075`. A new snapshot (1 page, 6 requests, 0 rate-limit responses, robots.txt read); output:
```
SNAPSHOT DONE: 1 pages, 6 HTTP requests, 0 rate-limit responses -> site-checks/omnikom-app-staging.pages.dev/snapshots/2026-11-11
PASS SEC-010 /
PASS SEC-075 /
OK: 1 page(s), 2 rule(s), 0 FAIL, 0 WARN, 0 SKIP
```
(The snapshot's speed numbers were marked UNTRUSTED by the tool because the machine was busy; they are not used here.)

### The flows against the deployed origin with the CSP guard
- Report-only build at tip `8806ccf` (deploy 1b), the 12 earlier reds by `--grep` (17 tests with the same styles tests at the other viewport): 16 passed, 1 red, **0 CSP violations**; the red (`flows.spec.ts:292`, `tbody tr` expected 1, received 2) passed alone on clean data (2.1 min, CSV export header row `received,name,email,phone,form,page,status,owner,side,budget,timing,beds,area,message`): stale rows from the earlier killed runs on shared staging data. Reports: `work/38-dashboard-hardening/csp-flows-reds-reportonly.json`, `csp-flows-crm-owner-reportonly.json`.
- First run, deploy 1 (older base `2486091`), killed at test 30 of 44 by the wrapper's own limit: 12 reds, all the Leads list drawing 0 rows because the staging database was on migration 23 (status `not-contacted`) and that build still filtered on `new`: version drift, not CSP. The guard was proven on the origin by one deliberate inline style (`report style-src-elem: blocked inline`, exactly one event); `work/38-dashboard-hardening/leads-probe.mjs`.
- **Enforced build (deploy 2), the full run, PROVEN 2026-11-11 07:05 to 07:38** (heavy, `run.mjs --base https://omnikom-app-staging.pages.dev --out csp-flows-full-enforced --limit-min 90`, report `work/38-dashboard-hardening/csp-flows-full-enforced.json`): `Running 44 tests using 1 worker`, then `1 skipped`, `43 passed (9.7m)`, exit 0. The one skip is the invite test (`flows.spec.ts:724`, it needs `SETTINGS_INVITE_EMAIL`: a real mail goes out). The guard fails any test on a CSP violation or CSP console line, so 43 passes are **0 violations** (the guard itself proven on this origin above). The live lead appeared 0.0 s after the send; the CSV export header row came out as `received,name,email,phone,form,page,status,owner,side,budget,timing,beds,area,message` (the `blob:` download works under the enforced CSP, which has no `blob:` in `img-src`). Cleanup counts: crm-screens 3 leads, crm-3b 3, flows cleanup "5 removed, 0 failed, 8 lead(s) of the test site left", styles 12.
- Honest note: the staging test site still carries leftover test leads after these runs ("8 lead(s) of the test site left" in the flows cleanup line); the red of `flows.spec.ts:292` earlier was such leftover rows.

### CI on the rebased tip
Run 42957448139 on `8806ccf` (the exact tip pushed by the head): conclusion **success** (read with `gh run list`, 2026-11-11 about 07:40). The local `scripts/ci.mjs` was NOT RUN after the rebase (the first attempt was killed by the machine's memory pressure; the head told me to let CI judge it).

### Deploy 3: master's build back on staging (2026-11-11 07:45:51 to 07:46:29)
Built from master `613bae0` in a detached sparse worktree (`apps/dashboard`, `docs/blueprint`; `node_modules` a junction to ours, same package files), `build-staging.mjs --direct-functions` exit 0, bundle-secret check ok; `dist/` has no `_headers`; deployed to `https://10f3278a.omnikom-app-staging.pages.dev`. `curl -sI https://omnikom-app-staging.pages.dev/` afterwards:
```
HTTP/1.1 200 OK
Cache-Control: public, max-age=0, must-revalidate
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
```
No Content-Security-Policy, HSTS, X-Frame-Options, Permissions-Policy or COOP: master's `apps/dashboard/public/` is empty, so master ships no `_headers`; these two remaining lines are the host's own defaults. Note: master's `App-Cr4lzVM-*.js` and `Poppins-*.woff2` have the same hashes as ours, because the only differences between master and this branch in `apps/dashboard` are `ErrorScreen.tsx` (not wired, so not bundled) and `public/_headers`; the headers, not the bundle names, tell the two deploys apart.

## NOT DONE yet
- the router wiring is not applied (`work/38-dashboard-hardening/router-wiring.patch` goes to platform through the head; so the error screen is not on staging or in master's build)
- the enforced CSP is not on staging now (master's build is back; it goes live when this branch lands and a staging deploy is made from master)
- the full `tools/audit/test/run.mjs`, the factory tests and the CLI tests were not run locally (CI ran them on the pushed tip: success)
- flows tests with the invite mail (`flows.spec.ts:724`): skipped by the spec without `SETTINGS_INVITE_EMAIL`
- HSTS `preload` and exact per-environment Supabase origins in `connect-src`: owner and platform calls, see findings 5 above
