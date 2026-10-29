# 19 Code manifest: every artifact to produce, what it takes in and gives out, how it compiles, how it is proven

Written 2026-10-29 (owner: "complete and clear on everything that needs to be outputted in code, how it compiles"). One row per
artifact. Status: BUILT (exists, tested), SPEC (designed in the named file, not written), BLOCKED (waits on something named).
Work orders (W-numbers) are in `05-BUILD-PLAN.md`; the new ones for the add-ons are in its section M6. Languages: SQL (Postgres
15+), TypeScript on Deno (Edge Functions, Workers), JavaScript ES modules on Node 20+ (tools, factory, runner scripts),
TypeScript React (dashboard). No other runtime.

## 1. Database (Supabase Postgres): `supabase/migrations/*.sql`
| Artifact | In -> out | Compiles / deploys by | Proven by | Status |
|---|---|---|---|---|
| `20261028000001_platform.sql` | tenancy, content, versions, media, leads, jobs, metrics, audit, integrations; RLS; `save_version`, publish functions, `capture_lead` | `supabase db push` to staging, then production (10-DELIVERY 5); locally `run-local.mjs` | `tenancy.test.sql` T0-T11; 47 mutants | BUILT |
| `20261029000002_crm.sql` | lead fields, `lead_events`, `lead_update`, `add_lead`, extended `capture_lead`, `api_keys`, `active_key` | same | T12; 14 mutants | BUILT |
| `20261029000003_addons.sql` | add_ons, connectors, bookings, messages, platform_limits, crm_templates, webhook_events; `book`, `record_message`, `webhook_received`, `save_crm_template`; null guards | same | T13; 23 mutants (83 total, 83 caught) | BUILT |
| `20261029000004_preview.sql` (SPEC, 16-DESIGN-PARTS 2.3) | `sites.preview_target`, `sites.preview_token_ref`, `publish_jobs.kind` (`live` / `preview`); `set_job_state` moves `published_version` only for `live` | same | a preview job that reaches `done` leaves `published_version` unchanged (test + mutant) | SPEC |
| `20261029000005_stale.sql` (SPEC, 16-DESIGN-PARTS 3.2) | `save_version(..., p_base_version)`: refuses a save whose base is not the latest version (`S-STALE`) | same | two saves from the same base: the second is refused (test + mutant) | SPEC |
| `20261029000006_compaction.sql` (SPEC, 18-BUDGET 2.2) | `service.compact_versions()` (pg_cron daily): collapses autosave runs older than 90 days; never a published or pinned version | same | a pinned version survives compaction (test + mutant) | SPEC |
| cron + queues (SPEC, 02-BACKEND 6) | pg_cron jobs: reaper 5 min, push retries 15 min, metrics daily, compaction daily; pgmq queues `lead_push`, `lead_alert`, `metrics`, `message_send`, `webhook_process` | in the migration (`cron.schedule`, `pgmq.create`) | `select * from cron.job` on staging lists them; a queued message is consumed within one cron tick (staging test) | SPEC; UNPROVEN that pg_cron and pgmq are enabled on Free (W0.3) |

## 2. Edge Functions (Deno + TypeScript): `supabase/functions/<name>/index.ts`
Shared: `_shared/signature.ts` (BUILT, tested), `_shared/contracts.ts` (BUILT; bundling of `../../../contracts` UNPROVEN until W1.2),
`_shared/db.ts` (SPEC: one `postgres.js` connection per invocation to the `service` schema, the DB URL from the environment),
`_shared/auth.ts` (SPEC: verify the user JWT, return claims), `_shared/problem.ts` (SPEC: the `Problem` body from a code table).
Compiled and checked by `deno task check` (`deno.json`, `nodeModulesDir: none`); deployed by `supabase functions deploy <name>`
to staging in CI, to production on the owner's approval; `verify_jwt` per function in `supabase/config.toml`.
| Function | Caller, credential | In -> out | Proven by | Status |
|---|---|---|---|---|
| `save` | dashboard, JWT | `{workspace, collection, row?, data, signOff?}` -> `{row, version}`; `contract_for` first, `validateItem(draft)`, `save_as` | W1.2 acceptance; function tests against `serve-local.ts` | SPEC |
| `publish` | dashboard, JWT | `{site, rows[], versions[], kind?}` -> `{job, state}`; `validateItem(publish)`, `start_publish`, GitHub dispatch | W1.2 | SPEC |
| `unpublish` | dashboard, JWT (owner/staff) | `{row, delete?}` -> 204 | W3.5 | SPEC |
| `upload-start`, `upload-finish` | dashboard, JWT | presigned PUT (R2 if D9, else Storage) -> `{url, key}`; then `{key, alt, rights}` -> media row, queue `media` | W3.2 | SPEC; D9 |
| `export-published` | runner, `X-Runner-Signature` | `?job=` -> `Export` (frozen snapshot, contract, media list, deploy target, token) | W1.3 | SPEC |
| `job-callback` | runner, `X-Runner-Signature` | `{job, state, gateReport?, deployId?, error?}` -> 204; `set_job_state`; notify; sitemap submit on live done | W1.5 | SPEC |
| `media-process-callback` | runner, `X-Runner-Signature` | `{media, width, height, exifStripped}` -> 204 | W3.2 | SPEC |
| `capture-lead` | site Worker, `X-Site-Signature` | `?site=` + `LeadRequest` -> 202 `{ok}`; `active_key` lookup, body check against the contract's form, `capture_lead`, queue alert + push | W2.4; 14-LEAD-PATH 8 | SPEC |
| `lead-update` | dashboard, JWT | `{lead, status?, owner?, note?}` -> 204; `lead_update` | T12 covers the SQL; function test W3.6 | SPEC |
| `add-lead` | dashboard, JWT | `{site, name, email, phone, answers, consent, owner?}` -> `{lead}`; `add_lead` | T12; W3.6 | SPEC |
| `push-lead` | pgmq consumer, `X-Internal-Secret` | one `lead_push` message -> adapter call (OmniSuite BLOCKED / CRM webhook signed) -> `lead_event` pushed or push-failed; retry schedule | M6 W6.3 | SPEC; OmniSuite BLOCKED |
| `send-alert` | pgmq consumer, cron secret | one `lead_alert` message -> `record_message` (email) -> Resend -> `set_message_state` | M6 W6.1 | SPEC; D5 named Resend |
| `send-message` | pgmq consumer, cron secret | one `message_send` message -> render template -> provider (SMS D11 / Resend) -> `set_message_state` | M6 W6.4 | SPEC; D11 |
| `webhook-inbox` | providers, provider signature per connector kind | raw body -> verify (OmniSuite: our HMAC scheme; SMS provider: its scheme; payment: its scheme) -> `webhook_received` -> queue `webhook_process` | M6 W6.2 | SPEC |
| `process-webhook` | pgmq consumer | one event -> by kind: call result -> `book` (concierge); delivery receipt -> `set_message_state`; payment -> `set_addon_state`; marks `processed_at` or `error` | M6 W6.2 | SPEC |
| `addon-activate` | dashboard, JWT (owner) | `{kind, settings}` -> `activate_addon`; creates the payment session (D10) | M6 W6.5 | SPEC; D10 |
| `book`, `booking-state` | dashboard, JWT | `{lead, with, starts, ends, where}` / `{booking, state}` -> `book` / `set_booking_state`; queues confirmations | M6 W6.6 | SPEC |
| `crm-template`, `crm-export`, `crm-import` | dashboard, JWT (owner) | save a template / stream a CSV in the template's layout (what RLS returns) / batch `add_lead` from a mapped CSV with duplicate rules | M6 W6.7 | SPEC |
| `metrics-pull`, `sitemap-submit` | cron | one workspace per call | M6 (later track) | SPEC |
Every function: a `Problem` body with plain words and a code, never a stack; a test file next to it (Deno test) run in CI; the
request body size cap; all machine-called ones verify their credential before reading the body.

## 3. Site Worker (per client site): `factory/worker/worker.ts` (one source, deployed per site)
In: a request. Out: static assets (free, uncounted) or `/api/lead` (section 2 of 14-LEAD-PATH): honeypot, size cap, rate limit
(KV-free: a sliding counter in the Worker's memory per isolate plus the Edge Function's own limit), sign with the site key, forward,
pass the answer back in plain words. Config: `SITE_ID`, `SITE_SIGNING_KEY` (secret), `PLATFORM_BASE`. Compiles with
`wrangler deploy --dry-run` (W0.4); deployed by the publish runner with the site's token. Proven by W2.4 (a test lead on the
preview lands in staging with its consent text; an empty consent is refused; a bad key gets 401 and the visitor sees the phone-us
text). Status: SPEC; the preview stub (`{preview: true}`) is BUILT in the ELEV8 project.

## 4. Build runner (GitHub Actions): `.github/workflows/`
| Workflow | Trigger | Steps | Proven by | Status |
|---|---|---|---|---|
| `ci.yml` | PR, merge | contract tests + mutants, `run-local.mjs`, `check-specs`, `deno task check`, dashboard typecheck + unit + build, gitleaks; on merge `db push` to staging + `run-staging.mjs` | W0.2 (a broken rule goes red) | SPEC |
| `publish.yml` | `repository_dispatch` `publish` `{job_id, site_id}`; concurrency per site | export -> `factory/build.mjs` -> launch layer -> gates -> `wrangler deploy` (live target or preview target by `kind`) -> smoke -> screenshots (preview) -> `job-callback` | W1.4, W1.6, W2.3 | SPEC |
| `media.yml` | `repository_dispatch` `media` | download original, strip EXIF, 3 WebP sizes, upload, `media-process-callback` | W3.2 (GPS gone) | SPEC |
| `backup.yml` | nightly | `pg_dump` production -> R2 `backups/`; weekly kept a year; monthly restore drill into a throwaway cluster + tenancy tests | 18-BUDGET 2.4 | SPEC |
| `keepalive.yml` | weekly | `run-staging.mjs` on staging (keeps the Free project awake, re-proves the walls) | 18-BUDGET 2.1 | SPEC |
| `usage.yml` | weekly | reads Supabase, Cloudflare, R2, Resend usage -> `metrics_snapshots` source `uptime` -> the budget triggers | 18-BUDGET 3 | SPEC |

## 5. Website factory (Node): `factory/`
| Artifact | In -> out | Proven by | Status |
|---|---|---|---|
| `factory/build.mjs` | export JSON -> `dist/` (every page, item pages, sitemap, robots, llms.txt, `_headers`, `_redirects`, 404) | render gate, SEO gate 13/13, writing gate WG-1..7 | SPEC; the ELEV8 `build.mjs` is the working precedent (BUILT in the client project) |
| `factory/render.mjs`, `factory/place` (uses `contracts/place.mjs`) | rows + partials -> HTML; dependency-free so the dashboard preview (16-DESIGN-PARTS 2.2) runs the same code in a Worker thread | a test imports it in a browser-like environment and fails on any Node built-in | SPEC |
| `sites/<slug>/design/` (per site) | tokens.css, base.css, `sections/*.mjs`, `item/*.mjs`, `shell.mjs`, `motion.js` | visual-equivalence diff against the approved design (A6) | SPEC; ELEV8's V4 partials exist in the client project |
| `factory/gates/*.mjs` | `dist/` -> pass or a plain-words report | each gate has a `--force-fail` or a mutant fixture | SPEC; the skill's `gate.mjs`, `writing-gate.mjs`, `launch.mjs` are BUILT |
| `factory/launch-layer.mjs` | images, fonts, hashing, headers | the ELEV8 writing gate (BUILT there) | SPEC |

## 6. Dashboard (React + Vite + TypeScript): `apps/dashboard/`
Compiles with `tsc --noEmit` and `vite build` to one static bundle; deployed as the Worker `app` (static assets) by CI to
staging, to production on approval. Screens: `15-CRM.md` (four), parts: `16-DESIGN-PARTS.md`. Proven by Vitest units (widgets,
hooks, the preview renderer bridge) and Playwright flows on staging (`09-TEST-STRATEGY.md` 3). Status: SPEC; the design pass
comes after the engineering (DECISIONS 21, 22). Modules: `auth/` (sign in, picker), `leads/` (list, panel, add by hand,
export), `site/` (list, editors from the contract, publish sheet, instant preview frame, compare), `settings/`, `admin/`
(staff), `lib/validate` (imports `contracts/validate.mjs`), `lib/preview` (Web Worker running `factory/render.mjs`),
`lib/crm-map` (imports `tools/crm-map/map.mjs` for the export/import wizards).

## 7. Tools (Node, dependency-free unless stated)
| Tool | In -> out | Proven by | Status |
|---|---|---|---|
| `contracts/` (`from-plan`, `validate`, `store`, `place`, `screens`) | plan -> contract; rows -> validation, placement, screens | 138 tests, 82 mutants, 15 industries | BUILT |
| `tools/crm-map/` (`map.mjs`, `dictionary.mjs`, templates) | headers + sample rows -> a proposed map; template + leads -> rows in their layout; their rows -> our leads | `test/run.mjs`, `test/mutate.mjs` | this loop, tick 3 (Sonnet build, lead verification) |
| `supabase/tests/run-local.mjs`, `run-staging.mjs` | migrations -> a throwaway cluster, the tests, the mutants | themselves | BUILT (local); staging UNPROVEN |
| `supabase/seed-workspace.mjs` | plan + entities -> contract version, page rows, places, site row | W1.1 counts | SPEC |
| `tools/design-engine/` | references -> gated design assets | 46 checks | BUILT |
| `docs/blueprint/diagrams/render.mjs`, `specs/check-specs.mjs`, `specs/run-all-gates.mjs` | docs -> pictures and gate runs | themselves | BUILT |
| `tools/check-api-keys.mjs`, `tools/save-secret-from-clipboard.ps1` | key presence checks | 4 x HTTP 200 | BUILT |

## 8. How a change travels (the compile path, end to end)
1. A developer edits a migration or a function -> `node docs/blueprint/specs/run-all-gates.mjs` locally (contract, walls,
   mutants, specs, deno check) -> PR -> `ci.yml` green -> merge -> staging gets `db push` + functions deploy + `run-staging.mjs`
   -> owner approves -> production gets the same artifacts (never a different build).
2. A client edits content -> `save` (version) -> Publish -> `publish` (job) -> `publish.yml` -> `export-published` -> factory
   -> gates -> `wrangler deploy` to that site's Worker -> smoke -> `job-callback` -> `done` moves `published_version`.
3. A visitor sends a form -> site Worker -> `capture-lead` -> `leads` + `lead_events` -> queues -> `send-alert`, `push-lead`
   -> the Leads screen (Realtime).
4. A provider calls back -> `webhook-inbox` -> `webhook_events` -> `process-webhook` -> `book` / `set_message_state` /
   `set_addon_state` -> the lead's timeline.

## 9. Counts (what "complete" means in code)
Migrations 3 BUILT + 3 SPEC; Edge Functions 0 BUILT + 20 SPEC (2 shared modules BUILT); Workers 2 kinds SPEC (site, app) + 1
(`media` host, D9); workflows 6 SPEC; factory 5 modules SPEC (precedents BUILT in client projects); dashboard 6 modules SPEC;
tools 7 BUILT + 1 in progress + 1 SPEC. Nothing is on a real Supabase or Cloudflare project yet (D1-D4).
