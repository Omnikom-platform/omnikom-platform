# Omnikom Platform: the product map

**What this file is.** The single map of the product: every feature, with its database, backend, screen, route and real build
state. Written 2026-11-02 (DECISIONS 55). Checked against the code on master commit `4a5da4d` (read with `git show 4a5da4d:<path>`;
the working tree is older). It outranks every blueprint file for "what the product is and what exists"; a blueprint file that
disagrees is corrected by its owning department, not followed. Binding decisions: DECISIONS 52 (no design work), 53 (export in the
client's format, industry lead columns), 54 (the platform itself, staging only, magic link, no staff screens), 55 (this map).

**States.** WORKS = code on master does it and a proof line or test shows it (cited). PARTLY = one half exists, the missing half is
named. MISSING = no code. When unsure the lower state is used and the reason is given. "Not specified yet" = no spec row exists.
Nothing here was run for this map: proof lines are read from `PROGRESS.md`, not re-run (UNPROVEN until a gate is re-run).

**Citation short forms.** `PG:n` = `docs/blueprint/PROGRESS.md:n` at 4a5da4d. `D:` = `apps/dashboard/src/`. `F:x` =
`supabase/functions/x/index.ts`. `M1` to `M13` = the migrations in `supabase/migrations/` in order: M1 platform (20261028000001),
M2 crm, M3 addons, M4 hardening, M5 vendor_defaults, M6 active_key_by_site, M7 hardening_leftovers, M8 search_path_and_roles,
M9 media_and_export, M10 export_schema_key, M11 publish_ready_wall, M12 screens, M13 screens_functions. Blueprint files are cited
as `04:n` (04-DASHBOARD.md), `15:n` (15-CRM.md), `16:n` (16-DESIGN-PARTS.md), `03:n`, `06:n` at 4a5da4d.

**What a user is.** One magic-link sign-in. Two products behind it: A, the Omnikom CRM; B, the dashboard for everything else.
Behind both: C, database and backend. Feeding A: D, the site factory and its forms. Staff are Omnikom's own access (the `staff`
table), not a user feature and not a screen (DECISIONS 54 c).

---

## Part A. The Omnikom CRM

What the database really holds for a lead (M1:107-119, M2:9-11, M4:169): `id, workspace_id, site_id, form, page_path, name, email,
phone, answers (jsonb), consent_text, status (new|contacted|qualified|closed|spam), owner_team_row, created_at, flow, cta,
marketing_consent (jsonb), idempotency_key, sms_consent, sms_stopped_at`. A timeline table `lead_events` (M2:24-35) with kinds
received, alert-sent, alert-failed, pushed, push-failed, status, assigned, note, resent, exported, deleted.
What the lead functions can change: `service.lead_update` (M8:316) takes only status, owner, unassign, note (and `read` in F:lead-update);
direct UPDATE on `leads` is revoked (M2:45-46). So name, email, phone, answers, flow, cta cannot be edited by anyone today.

| Feature | Database | Backend | Screen and route | State | Evidence |
|---|---|---|---|---|---|
| A1 Lead list, newest first, 6 columns (received, name, what they asked, page, status, owner), live new rows | `leads`, RLS `leads_read`; Realtime | none (reads through RLS) | Leads, `/w/$ws/leads` | WORKS | D:pages/Leads.tsx:85-110; D:data.ts:166; M1:227; PG:296 (Playwright 7 of 7), PG:28 (J6 PASS) |
| A2 Lead record: every field visible | `leads`, `lead_events` | none | lead panel, `/w/$ws/leads/$id` | PARTLY: panel shows name, phone, email, labelled answers, consent, timeline; not form, page, flow, cta, site, created, sms consent as fields | D:pages/LeadPanel.tsx:155-210 |
| A3 Lead record: every field editable (core + industry fields) | none: UPDATE revoked | none: `lead_update` has no field arguments | none | MISSING (not specified yet) | M2:45-46; M8:316-347; F:lead-update:14 |
| A4 Status change (5 fixed values), with Undo | `leads.status`, event `status` | `lead-update` | lead panel | WORKS | F:lead-update:14-20; D:LeadPanel.tsx:94-99,163-171; PG:296 |
| A5 Owner assign / unassign (owner only; member cannot hand on) | `leads.owner_team_row`, event `assigned` | `lead-update` | lead panel | WORKS | M8:316-347 (S-OWN-ONLY); D:LeadPanel.tsx:101-107,174-181 |
| A6 Notes (2000 chars, append-only, no edit or delete of a note) | `lead_events` kind `note` | `lead-update` | lead panel | WORKS | D:LeadPanel.tsx:109-130,188-196; M8:341-343 |
| A7 Activity timeline (who, what, when) | `lead_events` | none (RLS read, live) | lead panel | WORKS (events for field edits do not exist because A3 does not) | D:lib/leads.ts:148; M2:24-35 |
| A8 Add a lead by hand (consent tick required) | `service.add_lead`, `consent_ledger` | `add-lead` | `/w/$ws/leads/new` | WORKS | M8:349; D:api.ts:37-44; D:router.tsx:74; PG:296 |
| A9 Delete a lead | `service.delete_lead` (hard delete + audit row; M8:634) | none; only the CLI calls it | none | PARTLY: function exists, no Edge Function, no screen; deletes the row so the `deleted` event kind can never be stored | M8:634-642; tools/omnikom-cli/commands/lead.mjs:96; 16:105 says soft delete |
| A10 Search | none (client side) | none | Leads search box | PARTLY: name, email, phone only, after 2 characters, over the loaded list; not any column, not industry answers | D:lib/leads.ts:69; D:Leads.tsx:63 |
| A11 Filter | none (client side) | none | Leads | PARTLY: New / All / Mine / Spam only; filter on any column or value missing | D:Leads.tsx:64-71 |
| A12 Sort on any column | none | none | none | MISSING (not specified yet; list is newest first only) | D:lib/leads.ts:43 |
| A13 Choose the columns shown per view (core + industry) | none | none | none | MISSING (not specified yet; the 6 columns are fixed) | D:Leads.tsx:87-94 |
| A14 Saved views (filter + sort + columns, per user or shared) | none | none | none | MISSING (not specified yet) | no table, no function |
| A15 Bulk edit: select many, set status, set owner, delete | none | none | none | MISSING (not specified yet) | no bulk function; `lead_update` takes one lead |
| A16 Pipeline / status board | `leads.status` exists | none | none | MISSING (not specified yet; the status is a fixed 5-value enum, custom stages not specified) | M1:23 |
| A17 Tasks or follow-up date on a lead | none (`bookings` is the parked add-on, M3:55) | none | none | MISSING (not specified yet) | no column on `leads` |
| A18 Duplicate detection / merge | only `idempotency_key` (same submission, not same person) | none | none | MISSING (not specified yet) | M8:291-293 |
| A19 Unread leads in bold; opening marks read | `lead_reads`, `service.mark_lead_read` | `lead-update` with `read: true` | none | PARTLY: backend proven, no screen sends `read`, no row is bold | M12:106-130; F:lead-update:15,21; D:api.ts:30 has no `read` |
| A20 CSV export of the list, default layout | `service.leads_exported` (event per lead) | `lead-export` | none | PARTLY: function proven on staging (J7); no Export button; fixed 9 columns, industry answers in one JSON cell, no flow, cta, consent | F:lead-export:16-48; M12:139; PG:36 (J7 PASS), PG:242; no caller in D: |
| A21 Export in the client's CRM format (map from their headers, confirm once) | `crm_templates`, `service.save_crm_template` | none; library `tools/crm-map` (proposeMap, exportRows) | none | PARTLY: library and table proven; no Edge Function, no screen; `lead-export` does not use a template | tools/crm-map/map.mjs; M3:114; M8:558; PG:1511 (152 tests, 109 mutants) |
| A22 Import leads from the client's file (same map) | `crm_templates`, `add_lead` | none; library `importRows` | none | PARTLY: parse and map exist; nothing creates leads from the rows (consent rule undecided) | tools/crm-map/map.mjs |
| A23 Per-member visibility: an agent sees only leads assigned to them | policy `leads_read`, `private.can_act_on_lead` | RLS (and `asCaller` in export) | all lead screens | WORKS at lead level; per-column or per-view visibility MISSING (not specified yet) | M1:227; M8:395; PG:296 (member sees own only); PG:1196 |
| A24 Industry lead fields as real columns (list, panel, CSV, crm-map) | `answers` jsonb holds them; no columns | `capture-lead` stores `answers` | panel shows them read-only with labels | PARTLY: every contract declares form fields; they are stored and labelled in the panel; not columns, not editable, not in export or crm-map dictionary | contracts/README.md:37; contracts/industry-run/contracts/dental.json (forms.lead.fields); D:lib/leads.ts:129 |
| A25 Consent record shown with the lead | `leads.consent_text`, `marketing_consent`, `consent_ledger` | written by capture | lead panel | WORKS | D:LeadPanel.tsx:206-210; M7:58; PG:1191 |
| A26 Site switcher for a workspace with several sites | `sites` | none | Leads | WORKS (shown only with 2+ sites; untested with two) | D:Leads.tsx:53-62 |

Gap that blocks the owner's test: no feature above can be shown on staging with industry columns yet, because the test site declares
one form with four fields (name, email, phone, message): `sites/test-demo-a/contract.json` (forms.contact). See D7.

Part A count (26 rows): WORKS 9, PARTLY 9, MISSING 8.

---

## Part B. The user dashboard (every other feature)

| Feature | Database | Backend | Screen and route | State | Evidence |
|---|---|---|---|---|---|
| B1 Sign in by magic link (10 minute, single use link) | Supabase Auth, `members` | Auth; mail template `supabase/auth-emails/` via Resend | `/login`, `/auth/confirm` | PARTLY: screens, template, 600 s setting proven; a real link from an inbox to the staging app is UNPROVEN (waits for the DNS record); tests mint sessions | D:pages/Login.tsx:43; D:AuthConfirm.tsx; PG:246-260, PG:279 (DNS), PG:16 (J2 minted) |
| B2 Sign out | Auth | Auth | Sign out in the shell | WORKS | D:pages/SignOutButton.tsx; D:Shell.tsx:44 |
| B3 Sign out everywhere; account name and email | Auth | none | none | MISSING (DP-1.6-08, -09) | 16 Part 1.6 |
| B4 Pick a business / switch business | `members`, `workspaces` | none | `/w`, rail switcher | WORKS | D:router.tsx:63; D:Shell.tsx:35-39; PG:296 (A cannot open B) |
| B5 Site screen: pages and the client's own collections, from the contract | `site_contracts`, `content_rows` | none (RLS read) | `/w/$ws/site` | WORKS | D:router.tsx:77-78; D:SiteLayout.tsx:69-130; PG:1615-1620 |
| B6 Item editor: all field types, limits, locked fields, owner rule | `content_rows`, `content_versions`, `private.save_version` | `save` | `/w/$ws/site/$collection/$row` | WORKS (autosave after 10 s and the offline retry are UNPROVEN beyond unit tests) | D:router.tsx:79-84; D:Editor.tsx:21,163; PG:1618, PG:1635 |
| B7 Save as a version with stale-edit protection | `save_version` with `base` (S-STALE) | `save` | editor | WORKS | M12:28; PG:1618 (over-limit and S-STALE) |
| B8 Version history, compare, restore | `content_versions` (append-only) | none (RLS read) + `save` | editor | PARTLY: history and restore proven; Compare and Restore-Undo shown by no proof | PG:1618, PG:1635 |
| B9 Search-result card (title, description, Google-style preview) | none | none | editor | WORKS | D:pages/Widgets.tsx:428 |
| B10 Publish sheet: changes waiting, publish, live progress, failed-check message | `publish_jobs`, `publish_job_events` | `drafts`, `publish` | publish sheet on `/w/$ws/site` | WORKS (Fix opens the first row only; job events are not in Realtime so the screen refetches) | F:drafts; F:publish; D:PublishSheet.tsx; PG:17 (J3 PASS), PG:1618 (job ced0868f done) |
| B11 Publish history (past jobs, gate reports) and roll back / restore the site | `publish_jobs` | none | none | MISSING (specified 04:70-72; DECISIONS 53 c lists it) | D:data.ts:246 reads only the running job |
| B12 Take an item off the site / delete an item | `service.unpublish` | none; CLI only | none | PARTLY: function exists (M8:269), no Edge Function, no screen | 16 DP-1.4-21 "later" |
| B13 Photo upload in the editor (rights tick, alt text, sizes, EXIF stripped) | `media`, `record_media`, `finish_media`, bucket | `upload-start`, `upload-finish`, `media-process-callback`, runner `media.mjs` | photo slot in editor | PARTLY: upload functions proven on staging; end-to-end photo to site UNPROVEN; runner media checks SKIP on this laptop (sharp missing) | D:Widgets.tsx:386-400; PG:517, PG:1636, PG:1695 |
| B14 Media library (grid, flags: no alt / too small / no rights, where used, replace, delete if unused) | `media` | none | none, `/w/:ws/media` not in router | MISSING (04:56) | D:router.tsx |
| B15 Preview of a change before publishing (instant frame; preview site; before and after pictures) | none | none | none | MISSING (16 Part 1.5 and 2.2-2.4 say NOT BUILT) | no preview code in D: |
| B16 Settings: lead alert addresses, "also email the assigned agent" | `sites.lead_alert_to`, `alert_assignee`, `service.set_alerts` | `settings-save` | none; no Settings link in the shell | PARTLY: function proven on staging, no screen | F:settings-save:61-71; M12:157-176; PG:242; D:Shell.tsx:12-13,40-43 |
| B17 Settings: team (list, invite, remove) | `members`, `service.set_member`, `remove_member`, `find_login` | `invite-member` (creates the login, sends NO email); no remove function | none | PARTLY: invite proven, no list, no remove function, no mail, no screen | F:invite-member:10,35-54; M8:590,608; M13:62; PG:242 |
| B18 Settings: websites (preview address, domain, state, "ask Omnikom") | `sites` | none | none | MISSING (screen; the data is already read by the Site screen) | 16 DP-1.6-07; D:data.ts:110 |
| B19 Settings: CRM connection (webhook URL, secret in Vault, "send a test") | `integrations`/`set_crm_webhook`, `crm_secret_put` | `settings-save` crm, `crm-test` | none | PARTLY and OFF-DECISION: DECISIONS 53 (a) says v1 has no automatic push; the code configures one | F:settings-save:36-71; F:crm-test:1-18; M12:213; M13:16-51 |
| B20 Overview (site state, leads this week, to-do, drafts) | `metrics_snapshots` (empty) | none | none; `/w/$ws` redirects to leads | MISSING (04:30; 15 drops it) | D:router.tsx:66-70 |
| B21 Search and AI visibility (clicks, impressions, PageSpeed, AI answer samples with source and date) | `metrics_snapshots` table only | none: no `metrics-pull` | none | MISSING: only an empty table exists (lower state chosen: no function fills it, no screen) | M1:156; 02-BACKEND.md:112 names the missing function |
| B23 Page and error states: Not found, service unreachable banner, loading | none | none | all screens | WORKS | D:pages/NotFound.tsx; D:lib/problems.ts; PG:296 |

Part B count (22 rows): WORKS 8, PARTLY 7, MISSING 7.

---

## Part C. Backend and database every part uses

| Feature | Database | Backend | Screen | State | Evidence |
|---|---|---|---|---|---|
| C1 Tenancy wall: a workspace in a request is a claim checked against membership; no cross-workspace read or write | `workspaces`, `members`, RLS on every table, `private.is_member/my_role/can_see` | all functions via `dashboard()` frame | none | WORKS | M1:182-194; PG:1195-1196 (walls 5, people 15 passed); PG:235 (379 mutants) |
| C2 Roles: owner, member (agent); staff with MFA as Omnikom's own access | `members`, `staff`, `private.is_staff` (aal2) | none | none (no staff screens, DECISIONS 54 c) | WORKS | M1:33; PG:1196 |
| C3 Function frame: JWT check, claims to the database, CORS from a fixed origin list, security events, plain-word problems | `security_events`, `service.use_claims` | `_shared/dashboard.ts`, `_shared/http.ts` | none | WORKS | M7:23; PG:242 (40 PASS on staging) |
| C4 Content store: contract per workspace, rows, append-only versions, locked fields with sign-off | `site_contracts`, `content_rows`, `content_versions` | `save` | editor | WORKS | M1:58-90; PG:1618; contracts/test/run.mjs |
| C5 Contract validation (draft and publish rules, 54 codes) | n/a | `_shared/validate.ts` imports `contracts/validate.mjs` | editor errors | WORKS | contracts/test/run.mjs; 06:34-36 (FR-1..3); contracts/industry-run/RESULTS.md |
| C6 Publish pipeline: start_publish pins versions, dispatch, export-published, runner builds + gates + deploys, job-callback, reaper | `publish_jobs`, `publish_job_events`, `start_publish`, `freeze_snapshot`, `set_job_state`, `reap_stale_jobs` | `publish`, `export-published`, `job-callback`, `factory/runner/publish.mjs`, `.github/workflows/publish.yml` | publish sheet (B10) | WORKS | PG:17 (J3 PASS), PG:956 (4.5 done), PG:1697-1716 |
| C7 Publish-ready wall (a job or a version that is not ready is refused by the database) | triggers `check_job_ready`, `check_version_ready` | none | sheet shows the problems | WORKS | M11:120,137; PG:1089 |
| C8 Media: storage, rights, processing | `media`, bucket `media`, M9 functions | `upload-start`, `upload-finish`, `media-process-callback`, `media-export` | B13 | PARTLY (see B13) | M9:15-61; PG:1695 |
| C9 Audit log (every save, publish, lead change) | `audit_log` | written in every service function | none | WORKS | M1:163 |
| C10 API key registry (site-signing, runner, cron...), hashes and Vault names only | `api_keys`, `active_key` | `tools/mint-site-key.mjs`, CLI `key` | none | WORKS | M2:139-165; PG:1187 |
| C11 Consent ledger, suppressions, rate limits, workspace state and limits, privacy requests | `consent_ledger`, `suppressions`, `workspace_limits`, `workspace_state`, `privacy_requests` | `capture-lead` uses them; none for the rest | none | PARTLY: consent and limits are in the lead path; suppressions, workspace state change and privacy requests have functions but no caller | M7:58,95,147,168,322; M8:678-715 |
| C12 Realtime: leads, lead events, lead reads, publish jobs | publication `supabase_realtime` | none | A1, B10 | WORKS (`publish_job_events` is not in the publication) | D:data.ts:166-200; PG:1635 |
| C13 Email: Auth mails (sign-in) through Resend; new-lead alert through Resend | `messages` | Auth SMTP; `capture-lead` | none | PARTLY: sign-in and lead alert proven; no invite mail, no own sender | PG:246-260; PG:1192; F:invite-member:10 |
| C14 Onboard a client: workspace + site + contract + seeded rows + logins | `seed_version`, `from-plan` | CLI `omnikom seed`, `contracts/from-plan.mjs` | none (CLI only, by decision) | PARTLY: proven for the two test workspaces; a real client run is not shown | PG:1186; tools/omnikom-cli/commands/seed.mjs |
| C15 Migrations and function deploy to staging | `supabase/migrations` (13) | `tools/apply-staging.mjs`, `tools/deploy-functions.mjs` | none | WORKS | PG:242 (13 applied, 16 functions deployed) |
| C16 Metrics pull (Search Console, PageSpeed) and sitemap submit | `metrics_snapshots` | none | B21 | MISSING | 02-BACKEND.md:112-113 names functions that are not in `supabase/functions` |
| C18 Staging-only proof tooling: CLI journey J1-J9, wall tests, mutants, run-all-gates | n/a | `omnikom test journey`, `supabase/tests/run-local.mjs` | none | WORKS | PG:15-36; PG:235 |

Part C count (17 rows): WORKS 12, PARTLY 4, MISSING 1.

---

## Part D. The site factory and the forms that feed the CRM

| Feature | Database | Backend | Screen | State | Evidence |
|---|---|---|---|---|---|
| D1 Contract from an approved plan + entities, validated | n/a | `contracts/from-plan.mjs`, `validate.mjs` | none | WORKS | 06:34 (FR-1); contracts/industry-run/RESULTS.md (15 industries) |
| D2 Industry contracts declare their lead form fields (`forms.<id>.fields`, consent, `crm` map to OmniSuite names) | `site_contracts` | `contracts/industry-run/contracts/*.json` (15) | none | PARTLY: forms and fields are declared and validated; no declaration of which fields are list columns, no editable/visible flags (DECISIONS 53 b) | contracts/README.md:37; contracts/industry-run/contracts/dental.json |
| D3 Site build: pages, item pages, sitemap, JSON-LD, gates | `export_bundle` | `factory/build.mjs`, `factory/lib/*` | the built site | WORKS | PG:956; factory/test/run.mjs ("OK: 89 of 89", PG:1691) |
| D4 Form on the site posts with no script; site Pages Function signs and forwards | n/a | `factory/worker/lead-endpoint.mjs`, `pages-function-lead.js` | form section of the site | WORKS | PG:1672-1696 (5-L); PG:34 (J5 PASS); PG:1731 (5-L DONE) |
| D5 Form field rendering: text, textarea, email, phone, consent and marketing tick, honeypot | n/a | `sites/test-demo-a/design/sections/form.mjs:15-25` | the built site | PARTLY: text-like inputs and ticks are rendered; select, enum and reference fields are UNPROVEN (needed for industry fields) | form.mjs:15-25 |
| D6 Capture: signature check, store, consent required, idempotent retry, workspace from the site, quotas, paused site refused | `service.capture_lead` | `capture-lead` | none | WORKS | F:capture-lead:1-22; M8:280; PG:1191-1193 |
| D7 The test site proves contracts and forms (sites/test-demo-a on staging Pages) | workspace `test-demo-a` | `sites/test-demo-a/*`, runner | `preview.test-site-demo-a.pages.dev` | PARTLY: proves contract -> site -> form -> lead -> inbox (J1-J7 PASS); has 1 form with 4 fields, 2 collections, 3 page types; no industry lead fields, no second form, no select fields | sites/test-demo-a/contract.json; PG:15-36 |
| D8 New-lead email alert to the business and the assigned agent | `sites.lead_alert_to`, `alert_assignee`, `messages` | `capture-lead` + Resend | recipients set only by CLI (B16 has no screen) | PARTLY: alert proven (once per lead); the owner cannot set recipients | PG:1192; M8:40-47; M12:157 |
| D9 Site endpoint config is checked before a deploy (SITE_ID, key, PLATFORM_BASE) | n/a | `factory/runner/publish.mjs` | none | WORKS | PG:1697-1716 (84 of 84, mutants) |
| D10 Contract lead fields flow into the CRM (columns, panel, CSV, crm-map dictionary) | `answers` only | none | none | MISSING (DECISIONS 53 b; see A24) | tools/crm-map/dictionary.mjs has fixed synonyms, no contract fields |
| D11 Journey steps not built: CRM "send a test" sink, lead pushed to a CRM | n/a | n/a | n/a | MISSING (J8, J9 "NOT BUILT YET"; J9 is a push, now off-decision) | PG:22-23 |

Part D count (11 rows): WORKS 5, PARTLY 4, MISSING 2.

---

## Routing

Routes in `D:router.tsx` today (4a5da4d) beside the routes the specs name.

| Route in code now | Line | Route the specs name | Spec | Status |
|---|---|---|---|---|
| `/` redirects to `/w` or `/login` | router.tsx:17-24 | `/` | 03:85 | present |
| `/login` (`?expired`, `?ended`) | :26-37 | `/login` | 03:85 | present |
| `/auth/confirm` | :39-51 | link target of the sign-in mail | 16 DP-1.2-06 | present |
| none | | `/invite/:token` | 03:85 | MISSING, and dropped: an invite is a sign-in link (PG:257) |
| none | | `/reset` | 03:85 | MISSING, not needed with the magic link (decision needed on the password path) |
| `/w` (picker) | :63 | picker after sign-in | 15:8-30 | present |
| `/w/$ws` redirects to `/w/$ws/leads` | :65-70 | `/w/:ws` overview | 04:30 | MISSING (overview; 15 drops it) |
| `/w/$ws/leads` | :72-73 | `/w/:ws/leads` | 03:94 | present |
| `/w/$ws/leads/new` | :74 | add a lead (panel) | 16 1.3b | present |
| `/w/$ws/leads/$id` | :75 | `/w/:ws/leads/:id` | 03:94 | present |
| none | | leads views, board, import, export-format (a full CRM needs them) | none | MISSING (not specified yet) |
| `/w/$ws/site` | :77-78 | `/w/:ws/pages`, `/w/:ws/c/:collection` | 03:87-91 | present under a different shape (one Site screen, 15:8) |
| `/w/$ws/site/$collection/$row` (`?field`) | :79-84 | `/pages/:pageId`, `/c/:collection/new|:id` | 03:89-91 | present under a different shape |
| none | | `/w/:ws/c/:collection/:id/history` | 03:92 | MISSING as a route (history is inside the editor) |
| none | | `/w/:ws/media` | 03:93 | MISSING |
| none | | `/w/:ws/visibility` | 03:95 | MISSING |
| none (publish sheet only) | | `/w/:ws/publish` (drafts, jobs, rollback) | 03:96 | PARTLY (sheet exists; history and rollback MISSING) |
| none | | `/w/:ws/settings/{business,team,logins,integrations,site}` | 03:97 | MISSING (15:8 says one Settings screen; either way no code) |
| none | | `/admin`, `/admin/workspaces/:ws`, `/admin/signoffs`, `/admin/jobs`, `/admin/audit` | 03:98 | MISSING, and withdrawn by DECISIONS 54 c |
| default not-found | :103 | not found | 16 DP-1.2s-06 | present |

Routing rows: 20. Present 10 (two of them in a different shape than 03:85-98), PARTLY 1 (publish), MISSING 9 (of which `/admin` is
withdrawn by DECISIONS 54 c, `/invite` is dropped, and the CRM views row is "not specified yet").

---

## Contradictions found (not fixed)

1. **Four screens or eleven, and the routes differ.** `15:8` "Four screens, nothing else" and `15:4` "replaces the eleven screens" vs
   `04:9-81` eleven screens and `03:85-98` routes `/pages`, `/c/:collection`, `/media`, `/visibility`, `/publish`, `/settings/*`, vs the
   code (one `/site` screen, no Settings, no media). DECISIONS 54 (b) also says the CRM is "not the four-screen inbox of 15-CRM.md".
2. **Push or export.** `04:62-63`, `06:48` (FR-15), `06:60` (FR-27), `15:38,48` (sent to CRM, Resend) and `16` DP-1.3-07, -18 describe a push
   with retries; DECISIONS 53 (a) says v1 has no automatic push and export + import (FR-31) is core. The code still ships the push
   settings (`F:settings-save:36-71`, `F:crm-test`, M12:213) and no `push-lead` function. DECISIONS 1 still reads "push to any CRM".
3. **Staff screens.** `04:79` (screen 11), `06:50` (FR-17), `16:197` (Part 1.7), `03:98` (`/admin`) vs DECISIONS 54 (c) "no staff screens";
   DECISIONS 53 (c) still lists "staff admin" among step 5 work, 54 (c) removes it.
4. **Industry lead columns "never written down" (DECISIONS 53) vs contracts that already declare them.** `contracts/README.md:37` and
   `contracts/industry-run/contracts/dental.json` declare form fields per industry and `15:...` shows them as labelled answers; what is
   missing is the column declaration and the editing, not the fields.
5. **Stale status text.** `15:120` and `15:133` say export and the Edge Functions are NOT BUILT; `lead-export` and the others are deployed
   (PG:242). `16:91` gives export the slice "5.3b", which no built slice carries. `19-CODE-MANIFEST.md:4` Status column is stale.
6. **Functions named but absent.** `02-BACKEND.md:108,111-113` lists `unpublish`, `push-lead`, `metrics-pull`, `sitemap-submit`; none is in
   `supabase/functions` (16 functions exist).
7. **Delete is soft in the spec, hard in the code.** `16:105` "soft delete + `deleted` event"; `M8:634-642` deletes the row and records an
   audit row only, so the `deleted` event kind (M2:24) can never be stored.
8. **Core columns differ.** DECISIONS 53 (b) lists name, email, phone, form, page, flow, cta, status, owner, consent, date; the list shows
   six (D:Leads.tsx:87-94) and the CSV nine without flow, cta, consent (F:lead-export:46). `contracts/core.json:162` names the page field
   `pagePath`, the lead request names it `page` (PG:1695 gap).

---

## Parked (DECISIONS 25; nothing here is built or planned until the owner unparks it)

SMS and email to leads about meetings (`messages`, M3:82; FR-28), bookings and calendar (`bookings`, M3:55; FR-30), payments and the
connector kinds sms/payment/calendar (M3:34), the concierge and ads add-ons and the add-on wizard (`add_ons`, M3:17; FR-29), automatic
push to a CRM and OmniSuite push (DECISIONS 53 a). Production database, production Pages projects and DNS (DECISIONS 54 d) wait until staging proves A to D.

---

## Counts (checked by counting the State column of each table above)

| Part | WORKS | PARTLY | MISSING | Rows |
|---|---|---|---|---|
| A CRM | 9 | 9 | 8 | 26 |
| B Dashboard | 8 | 7 | 7 | 22 |
| C Backend and database | 12 | 4 | 1 | 17 |
| D Factory and forms | 5 | 4 | 2 | 11 |
| Total | 34 | 24 | 18 | 76 |

---

## Build order (proposal; CRM first, backend first inside each feature, one slice each)

CRM (owner's priority):
1. **Lead field edit, backend.** New `service.lead_set_fields` (name, email, phone, status, owner, and keys of `answers` allowed by the
   contract's form) with an `edited` event kind {field, from, to}; extend `lead-update` or add `lead-edit`; wall test + mutant. Needs a
   decision: which core fields are editable (consent text must not be).
2. **Lead record screen.** Every field visible and editable from the contract's labels and types; timeline shows the edit events.
3. **Test site gets a real industry form** (a realtor or dental contract with select, enum and number fields), republished; fix D5
   (render enum and reference fields) so the staging proof can show industry columns end to end.
4. **Views, backend.** `lead_views` table (workspace, owner, name, columns, filter, sort, shared) + save/list function.
5. **List columns, filter, sort, search on any column (core + industry)**, server side with RLS, plus saved views UI.
6. **Bulk edit, backend then UI.** `service.leads_bulk` (status, owner, delete) with one event per lead and one audit row.
7. **Delete a lead, function + confirm screen** (decide soft or hard; align `lead_events` `deleted`).
8. **Export button + CSV with every core and industry column** (change `lead-export` columns; test column set).
9. **CRM format export, backend.** Edge Function for `crm_templates` (propose map from the client's headers with `tools/crm-map`, confirm,
   save), `lead-export` with a template; then the screen.
10. **Import from the client's file.** Function using the saved map: parse, map, create leads (decide consent text and duplicates rule), screen.
11. **Follow-up date and tasks** (column + filter "due") and **status board** (UI on `lead-update`; decide custom stages).
12. **Duplicates**: flag on capture by email/phone; merge is a later decision.
13. **Unread bold + mark read** (UI only; backend exists).

Dashboard:
14. **Settings screen** over the existing functions: alerts, team (add the missing list and remove functions), websites, account, sign out
    everywhere; remove or hide the CRM webhook card per DECISIONS 53 (a).
15. **Publish history and restore** (function listing jobs, site rollback decision, then screen).
16. **Unpublish / delete an item** (function over `service.unpublish`, then screen).
17. **Media library** (list, replace, delete-if-unused functions; screen) and one end-to-end photo proof on staging.
18. **Preview of a change** (instant frame first).
19. **Magic link from a real inbox** (needs the owner's DNS click for app-staging); prove once, record in PG.
20. **Overview and visibility** (`metrics-pull`, screen) last; both are optional until the owner says otherwise.

Then, and only then, production (DECISIONS 54 d).
