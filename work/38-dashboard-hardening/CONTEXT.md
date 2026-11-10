# 38 dashboard hardening: security headers, cache rules, error screen (E7, SEO's parts)

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/dashboard-hardening. Status: OPEN (head of operations
2026-11-10 20:14).

## Why
`docs/product/1-product.md:139` row E7 "Dashboard hardening: CSP and security headers, error boundary, cache rules, realtime only
where shown" is MISSING ("no `public/_headers`, no error component", blocks H1-5 and KNOWN-5 in `docs/product/9-blocks.md:92,97`).
Done means E7 goes to WORKS for SEO's parts, with "realtime only where shown" named as open (platform's).

## Ruling (head of operations, 2026-11-10 20:14)
- SEO's for this order: `apps/dashboard/public/_headers` (CSP, HSTS, frame, referrer and permissions policies, cache rules per path)
  and a NEW error-screen component under `apps/dashboard/src/` (one new file; name it `src/ErrorScreen.tsx`).
- NOT SEO's: the one-line wiring in the router root (`apps/dashboard/src/router.tsx:17`, `createRootRoute({ component, errorComponent })`).
  Write it as a patch file `work/38-dashboard-hardening/router-wiring.patch`; the head sends it to platform through the head of
  operations (platform's 19 and 20 are editing `apps/dashboard`). Do not edit any existing file under `apps/dashboard/`.
- "Realtime only where shown" stays platform's: leave it out.

## What exists (read, do not rebuild)
- The dashboard: `apps/dashboard/README.md` (Vite + React 18 + TanStack Router, supabase-js v2; plain semantic HTML, no CSS yet).
  Staging: `https://omnikom-app-staging.pages.dev` (Cloudflare Pages), built with `scripts/build-staging.mjs --direct-functions`
  (the functions are called on `https://<ref>.supabase.co/functions/v1`, not on the page's origin) and deployed with
  `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/pages-project.mjs --name omnikom-app-staging --deploy <dist>`.
  Vite copies `public/` into `dist/`, so `public/_headers` reaches every later build. Cloudflare's `_headers` rules:
  https://developers.cloudflare.com/pages/configuration/headers/ (read it; cite it in the proof).
- What the browser talks to: the page's origin; `https://<ref>.supabase.co` (REST, Auth, functions, Storage) and
  `wss://<ref>.supabase.co` (Realtime: leads, publish jobs); the photo upload's signed address (`upload-start` returns it: find its
  host in `supabase/functions/upload-start/`); images shown from Storage. Find every one in `src/` before writing the CSP; list them
  with file:line in the proof. The ref differs per environment and `_headers` is static: use `https://*.supabase.co wss://*.supabase.co`
  and record that width as a finding (exact per-environment origins would need a build step, which is platform's).
- No inline script expected (check `index.html` and `dist/index.html` after a build: Vite may add a module preload). A `style`
  attribute in React needs `style-src 'unsafe-inline'` or `style-src-attr`; check whether `src/` sets any.
- The plan gate (DECISIONS 44, `apps/dashboard/tests/plan-gate.mjs`): every element and every fixed string in `src/` carries a
  `data-plan` id of a row in `docs/blueprint/16-DESIGN-PARTS.md`. There is no error-screen row. Draft two rows in the shell section
  (`DP-1.2s-12` the error screen's sentence, `DP-1.2s-13` its "Reload" button; slice `5.3`, so they show today) and send them to
  the head BEFORE writing the component; the head clears them with platform. Words: plain, no blame, nothing invented.
- The audit engine `tools/audit/` (yours): it judges a built folder or a live snapshot (`live.mjs`); the snapshot does not keep
  response headers today, and there is no SEC-010 or SEC-075 check. The checklist: `skills/programmatic-enterprise-web-performance/checklist/security.md:15,16`
  (find the full rule text in the skill; each check is admitted only with its source in `tools/audit/rules/<ID>.md`).
- The staging flows (sign-in, the CRM screens, the publish sheet): `apps/dashboard/tests/flows.spec.ts`, `site.spec.ts`, run by
  `playwright.config.ts` against a LOCAL preview (`scripts/preview-staging.mjs`). A local preview does not apply `_headers`, so a
  green local run proves nothing about the CSP. The CLI's `test journey --target staging` runs the same specs locally too.

## Steps
1. Read the inputs above. Write the proof skeleton `tools/audit/proof/dashboard-hardening.md`.
2. Audit check: add SEC-010 (the security headers on every 2xx text/html response) and SEC-075 (CSP strength) to `tools/audit/`,
   each with `rules/<ID>.md`, tests on recorded fixtures in `tools/audit/test/`, and a mutant per new assertion in
   `tools/audit/test/mutate.mjs` (or a list file it spreads in, as 33 did). Make the live snapshot keep the response headers it
   already receives (pages, and the first script and asset it fetches, for the cache rule). No new dependency.
3. `apps/dashboard/public/_headers`: on `/*` CSP (`default-src 'self'`; `script-src 'self'`; `connect-src 'self'` + the Supabase
   origins; `img-src 'self' data: blob:` + Storage; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `object-src 'none'`),
   `Strict-Transport-Security: max-age=31536000; includeSubDomains` (no preload: that is the owner's domain call), `X-Frame-Options: DENY`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone,
   geolocation, payment off; keep what the photo slot needs). Cache: `/assets/*` (hashed names) `public, max-age=31536000, immutable`;
   everything else (index.html and the routes) `no-cache`. Ship the CSP first as `Content-Security-Policy-Report-Only` on staging,
   read the violations, then switch to the enforced header (both runs in the proof).
4. `src/ErrorScreen.tsx` after the head's OK on the plan rows: the sentence, Reload (`location.reload()`), no stack trace or error text
   on screen (SEC-007), `data-plan` ids. `node scripts/ci.mjs` in `apps/dashboard` (type check, unit tests, plan gate) must be green.
   Prove the component works: a unit test that renders it, plus the router patch applied in a scratch copy and a thrown error in a
   route showing it (paste the output). The patch file is what platform applies.
5. Staging proof. Ask the head before every staging deploy (platform 19 and 20 may be testing there): build with
   `build-staging.mjs --direct-functions`, deploy with `pages-project.mjs`, then:
   - `curl -sI` of `/`, a deep route (`/w/x/leads`), and one `/assets/*.js` file: paste the headers.
   - Your audit (SEC-010, SEC-075) on a live snapshot of the staging dashboard: paste the lines.
   - CSP does not break sign-in, the CRM screens or the publish sheet: run the existing specs against the DEPLOYED origin with a
     Playwright config of your own (`tools/audit/dashboard-csp/playwright.config.ts`, baseURL the staging URL, no webServer,
     reusing `apps/dashboard/tests/*.spec.ts` and its global setup), and fail on any `securitypolicyviolation` event or a console
     line about the Content Security Policy. If that route fails twice for a reason that is not the CSP, stop and tell the head (it
     will ask CLI to run the flows); record it BLOCKED with what would unblock it.
6. Write the proof: commands and pasted output, the CSP sources with file:line, what is UNPROVEN.

## Hard rules
- Keys by variable name only; never print, copy or store a value (`tools/with-env.mjs`). No logins of your own; the specs' test logins
  are the platform's staging fixtures.
- Memory is tight (a video job spikes to 7 to 9 GB): one Playwright run at a time, through `node ~/.claude/scripts/heavy.mjs --wait-min 60
  --label "SEO 38: <what>" -- <cmd>` with a true label; never the full audit mutant run (only `MUTATE_ONLY=<your new mutants>`). If the
  machine drops below 4 GB free, stop and tell the head.
- Do not touch `supabase/`, the router or any existing `apps/dashboard` file, the skill, or another department's files. No DNS, no
  custom domain, no production project. Do not commit or push; the head does.
- Nothing under `tools/audit/` calls a model (DECISIONS 38): run `node docs/blueprint/specs/check-no-model.mjs` before you report.
- No em dashes anywhere you write. Scripts in files, never `node -e`.

## Done means
`node tools/audit/test/run.mjs` ends "OK: N of N checks passed"; the new mutants all caught; `apps/dashboard` `node scripts/ci.mjs` green;
the staging headers pasted; the audit lines pasted; the flows on the deployed origin green with 0 CSP violations (or BLOCKED as above);
the router patch written. Then message HEAD_SEO-and-audits_2026-11-09: what was built, the counts, what is BLOCKED or UNPROVEN.
