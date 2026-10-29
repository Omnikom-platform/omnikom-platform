# 13 Data model in plain words: every table, its columns, and who writes it

Written 2026-10-29 for the owner's approval before any application code. Source of truth for what is BUILT: the migration
`supabase/migrations/20261028000001_platform.sql` (509 lines, tested locally by `node supabase/tests/run-local.mjs`: tenancy
tests T0-T11 and 47 wall-removal mutants, all caught; latest run in `PROGRESS.md`). This file explains that migration in plain
words and adds what the CRM still needs. Every table below is marked **BUILT** (in a migration) or **PROPOSED**. UPDATE the same
day (DECISIONS 21, owner: focus on the database): every PROPOSED item below is now in the second migration
`supabase/migrations/20261029000002_crm.sql` with tests T12 and mutants in `supabase/tests/` (`lead_notes` and `lead_pushes`
folded into `lead_events`; `api_keys`; the lead and site columns; `service.lead_update`, `service.add_lead`, the extended
`service.capture_lead`, `service.active_key`). The PROPOSED labels are kept so the reader sees what changed. Nothing is deployed
to a real Supabase project yet (owner decision D1 in `05-BUILD-PLAN.md`), so every BUILT item is proven on a local Postgres
model of Supabase only.

## 0. The five words
- **Workspace**: one client business (ELEV8 Real Estate Group is the first). Everything the client owns belongs to exactly one.
- **Site**: one website of a workspace, one deploy target on Omnikom's Cloudflare account. A workspace can have several sites.
- **Row**: one piece of content (a page, a listing, an article, the business details). Its text lives in versions.
- **Lead**: one form submission from a site, with the exact consent wording the visitor saw.
- **Login**: a person's account (Supabase Auth). A login belongs to one or more workspaces as owner or member, or is Omnikom
  staff. The platform never stores passwords itself: Supabase Auth does.

## 1. The wall, in one paragraph
Every table carries `workspace_id`. The database refuses a row to anyone who is not a member of that workspace or Omnikom staff
(row-level security on every table). Clients never write content tables directly: the only way in is the `save` function, which
checks the contract rules (role, own items only, locked fields) and appends a version. Visitors reach the database only through
the lead capture function, which takes the workspace from the site, never from the request. A guessed id from another client
returns "not found". Proof: `supabase/tests/tenancy.test.sql` T3 (cross-client read, edit, write, upload, publish all refused).

## 2. Who writes what (summary)
| Who | Writes | Through |
|---|---|---|
| Visitor (no login) | one lead | the site's `/api/lead` -> `capture-lead` (signed by the site) |
| Client owner | content versions, media, team logins, lead status and owner, lead notes, integrations settings | dashboard -> Edge Functions -> database functions |
| Client member (for example an agent) | own items only (own listings, own posts, own profile), own leads' status and notes, own uploads | same path; the contract says which collections are `own` |
| Omnikom staff | everything above for any workspace, plus locked fields (with a recorded sign-off), contracts, sites, seeding, onboarding | dashboard staff admin; every action in `audit_log` |
| Build runner (GitHub Actions) | job states, media facts (width, EXIF stripped) | `job-callback`, `media-process-callback` (signed with the runner key) |
| Cron | lead push attempts, metrics, stale job clean-up | `push-lead`, `metrics-pull`, `reap_stale_jobs` |
| Nobody | updates or deletes of a content version | append-only: no grant exists, mutant "append-only versions" proves it |

## 3. Tenancy tables
### `workspaces` (BUILT)
One row per client business.
| Column | Meaning | Written by |
|---|---|---|
| `id` | the workspace id used everywhere | database |
| `slug` | short name for URLs (`elev8`); lower-case letters, digits, hyphens | staff at onboarding |
| `name` | the business name as shown in the dashboard | staff |
| `industry` | the industry word from the plan (`real-estate`) | staff |
| `created_at` | when | database |

### `staff` (BUILT)
Omnikom staff logins. Not a client role (ADR 0010): staff see every workspace, only with a second factor (MFA, `aal2`), and every
action is audited.
| Column | Meaning | Written by |
|---|---|---|
| `user_id` | the Supabase Auth user | the owner (Abdo), by migration or staff admin |
| `created_at` | when | database |

### `members` (BUILT)
A login inside a workspace with a role. One person can be in several workspaces.
| Column | Meaning | Written by |
|---|---|---|
| `workspace_id`, `user_id` | which person in which workspace | the workspace owner (invite) or staff |
| `role` | `owner` (all of the workspace) or `member` (own items only) | owner or staff |
| `team_row_id` | the person's row in the `team` collection; drives "own items" (an agent's own listings and leads) | owner or staff |
| `created_at` | when | database |

### Logins (Supabase `auth.users`, managed by Supabase Auth)
Not our table. Email magic link by default, password optional, invites by the owner (members) or staff (owners). Staff must have
MFA. We store no password. Open: D5 in `05-BUILD-PLAN.md` (an email sender is needed for invites and magic links).

## 4. Site tables
### `sites` (BUILT)
The site registry: where a workspace's website is deployed.
| Column | Meaning | Written by |
|---|---|---|
| `id` | the site id; the site's Worker holds it as configuration and sends it with every lead | database |
| `workspace_id` | the owner workspace | staff at onboarding |
| `deploy_target` | the Cloudflare Worker name, unique | staff |
| `preview_host` | the preview address (`elev8-omnikom-website.pages.dev` today for ELEV8) | staff |
| `domain` | the client's own domain once attached (launch, last step) | staff |
| `deploy_token_ref` | the NAME of the Vault secret holding this site's deploy token. Never the token | staff |
| `state` | `preview`, `live`, `paused` | staff; `live` only through the launch ledger (DECISIONS 19) |
| `created_at` | when | database |
PROPOSED additions (needed by the lead path, `14-LEAD-PATH.md`): `signing_key_ref` (the NAME of the Vault secret holding this
site's lead signing key, section 8) and `lead_alert_to` (the email addresses that get a new-lead alert, from client question
"lead-alert recipients" in `sops/client-questions.md`).

### `site_contracts` (BUILT)
The generated content contract per workspace (which collections, which fields, which rules), versioned. One is `active`.
| Column | Meaning | Written by |
|---|---|---|
| `workspace_id`, `version` | which workspace, which version | staff (onboarding, a new plan) |
| `contract` | the contract as generated from the plan | staff |
| `resolved` | the same with the shared core merged in; this is what the database rules read | staff |
| `active` | exactly one active per workspace (unique index) | staff |
| `created_by`, `created_at` | who, when | database |

## 5. Content tables (what the client edits in the CRM)
### `content_rows` (BUILT)
One row per item: a page, a listing, an article, the business details, a team profile. The text is NOT here: it is in versions.
| Column | Meaning | Written by |
|---|---|---|
| `id` | the row id | database |
| `workspace_id` | owner workspace | `save` function |
| `collection` | which collection of the contract (`pages`, `listings`, `team`, `posts`, `settings`...) | `save` |
| `owner_team_row` | the team member who owns the item (own-only access); filled from the login for members | `save` |
| `published_version` | the version number the live site shows; moves only when a publish job finishes `done` | `set_job_state` (runner callback) |
| `deleted_at` | soft delete | `unpublish` (owner or staff) |
| `created_at` | when | database |

### `content_versions` (BUILT)
Every save is a new version. Nothing is ever updated or deleted here: history and rollback come free (DECISIONS 6).
| Column | Meaning | Written by |
|---|---|---|
| `row_id`, `n` | which row, version number 1, 2, 3... | `save` |
| `workspace_id` | owner workspace (repeated so the wall can filter without a join) | `save` |
| `data` | the content as JSON in the contract's shape: for a page its title, SEO text and sections with their text and photos; for a listing its address, price, photos | `save`, after `contracts/validate.mjs` accepted it |
| `by`, `at` | who saved, when | `save` |
| `sign_off` | for a change to a locked field (licence numbers, legal notices): `{ by, ref }` of the Omnikom sign-off; otherwise empty | `save` (staff only) |
How "the client changes title, text, photos" works: the dashboard shows the page's sections from the contract; the client edits a
field; Save sends the whole item to `save`, which validates it against the contract and appends version n+1. The site does not
change. Publish creates a job (section 7) that rebuilds the site with the chosen versions and runs the same gates the site runs
today (the 13 launch gates, craft-lint, the 7 writing-gate rules); a failed gate deploys nothing and the client sees why.

### `media` (BUILT)
Uploaded files. Stored in the private bucket `media`, under `<workspace_id>/...` (the storage policy enforces the folder).
| Column | Meaning | Written by |
|---|---|---|
| `id` | the file id (what a row's photo field references) | database |
| `workspace_id` | owner workspace | `upload-finish` |
| `path` | storage path; must start with the workspace id (check constraint) | `upload-finish` |
| `width`, `height`, `bytes` | measured facts | media processor (runner) |
| `processed` | sizes made, ready for publish | media processor |
| `exif_stripped` | location and camera data removed | media processor |
| `rights_confirmed` | the client ticked "we have the right to publish this" | `upload-finish` (the client's tick) |
| `uploaded_by`, `created_at` | who, when | `upload-finish` |
Publish refuses a photo without alt text, below the slot's minimum width, without the rights tick, or not processed.

## 6. Lead tables (the CRM)
### `leads` (BUILT, with PROPOSED columns)
One row per form submission.
| Column | Meaning | Written by | Status |
|---|---|---|---|
| `id` | the lead id; also the idempotency key sent to the client's CRM | database | BUILT |
| `workspace_id` | taken from the site, never from the form | `capture_lead` | BUILT |
| `site_id` | which website sent it | `capture_lead` | BUILT |
| `form` | the contract form id (`home-value`, `home-finder`, `sell`, `contact` on ELEV8) | `capture_lead` | BUILT |
| `page_path` | the page the visitor was on (`/sell/oakland/`) | `capture_lead` | BUILT |
| `name`, `email`, `phone` | the person | `capture_lead` | BUILT |
| `answers` | every other field of the form as JSON, keyed as in the contract (address, budget, beds, timing...) | `capture_lead` | BUILT |
| `consent_text` | the exact consent wording shown when sent; required, a lead without it is refused | `capture_lead` | BUILT |
| `status` | `new`, `contacted`, `qualified`, `closed`, `spam` | owner, assigned member, staff (dashboard) | BUILT |
| `owner_team_row` | the team member it is assigned to; members see only leads assigned to them | owner or staff; set from `assignee` at capture when the visitor asked for a named agent | BUILT |
| `created_at` | received at | database | BUILT |
| `flow` | the journey that produced it (`cash-offer`, `home-value`); a slug, not a closed list, so a new industry needs no schema change | `capture_lead` | PROPOSED |
| `cta` | the button or link label the visitor used | `capture_lead` | PROPOSED |
| `marketing_consent` | `{ given, text }`, separate from `consent_text` | `capture_lead` | PROPOSED |
| `idempotency_key` | the uuid the form made for this submission; unique per site; a retry with the same key stores nothing and answers 202 again | `capture_lead` | PROPOSED (sops/site-endpoints.md 2.5 marks it NOT BUILT) |
| `source_ip_hash`, `user_agent` | spam forensics (hashed IP, not the IP) | `capture-lead` function | PROPOSED, needs the retention decision D6 |
The ELEV8 wizard already sends `flow`, `cta`, `assignee`, `marketingConsent` and `idempotencyKey` (`draft-site/site/src/pages/wizard.js`,
the `lead` object), so the PROPOSED columns are what the first real site needs on day one.

### `lead_events` (PROPOSED)
The lead's timeline in the CRM: one row per thing that happened. Today the migration has `lead_notes` (free text) and
`lead_pushes` (CRM attempts) but no record of status changes, assignments or alerts; the wireframe's detail panel needs one list.
| Column | Meaning | Written by |
|---|---|---|
| `id` | event id | database |
| `lead_id`, `workspace_id` | which lead, which workspace | the writer below |
| `kind` | `received`, `alert-sent`, `pushed`, `push-failed`, `status`, `assigned`, `note`, `resent`, `exported`, `deleted` | |
| `by` | the login that did it; empty for the system (received, pushed) | |
| `detail` | JSON: for `status` the old and new value; for `pushed` the target and response code; for `note` the text (max 2000) | |
| `at` | when | database |
Writers: `capture_lead` (received), `capture-lead` function (alert-sent), `push-lead` (pushed, push-failed), the dashboard through
a small `lead_update` function (status, assigned, note, resent), export (exported). Rule: `leads.status` and `owner_team_row`
change only through `lead_update`, which writes the event in the same transaction, so the timeline can never disagree with the
row. Decision for the owner: keep `lead_notes` and `lead_pushes` as they are and ADD `lead_events` (two more tables, simplest
migration), or FOLD notes and pushes into `lead_events` (one table, one timeline, the two existing tables dropped before any real
data exists). Recommended: fold, because no real lead exists yet and one timeline is what the screen shows.

### `lead_notes` (BUILT; folds into `lead_events` if the owner picks "fold")
| Column | Meaning | Written by |
|---|---|---|
| `id`, `lead_id`, `workspace_id` | which lead | dashboard (insert granted to members who can see the lead) |
| `by`, `text` (max 2000), `at` | who wrote what, when | dashboard |

### `lead_pushes` (BUILT; folds into `lead_events` if the owner picks "fold")
Every attempt to hand the lead to OmniSuite or the client's CRM webhook.
| Column | Meaning | Written by |
|---|---|---|
| `id`, `lead_id`, `workspace_id` | which lead | `push-lead` |
| `target` | `omnisuite` or `crm-webhook` | `push-lead` |
| `ok`, `response_code`, `at` | result | `push-lead` |
PROPOSED columns if kept: `attempt` (1-4), `error` (plain text), `next_at` (retry schedule 1 min, 5 min, 30 min, 2 h).

## 7. Publishing, metrics, audit, integrations
### `publish_jobs` and `publish_job_events` (BUILT)
One job per Publish click. `rows` and `requested` (row: version) say what was asked; `snapshot` is frozen when the build starts
and is exactly what the build ships; `state` moves queued -> building -> gating -> deploying -> done or failed; `gate_report`
holds the gate result in plain words; `deploy_id` the Cloudflare deploy; `error` the failure. Written by `start_publish`
(dashboard) and `set_job_state` (runner callback). Events: one row per state change with its time.

### `metrics_snapshots` (BUILT)
Observed numbers per workspace, source (`search-console`, `pagespeed`, `ai-answers`, `uptime`) and day, as JSON. Written by
`metrics-pull` (cron). Never invented: a day without a pull has no row.

### `audit_log` (BUILT)
Who did what, when: every save, seed, publish state, unpublish, delete, sign-off, staff action. Columns `workspace_id`, `actor`,
`action`, `target`, `detail`, `at`. Written by the database functions themselves (never by the dashboard directly). Readable by
owners (their workspace) and staff.

### `integrations` (BUILT)
Per workspace and kind (`omnisuite`, `crm-webhook`, `search-console`, `idx-link`): `config` JSON (the webhook URL, the IDX link)
and `secret_ref`, the NAME of the Vault secret (the webhook signing secret, the OmniSuite key). Written by staff (and the owner
for the CRM webhook URL, read-only otherwise per `04-DASHBOARD.md`).

## 8. API keys and machine credentials
Today every machine secret lives in Supabase Vault (or a GitHub environment secret) and the tables hold only a NAME
(`sites.deploy_token_ref`, `integrations.secret_ref`). The full list, owner and rotation: `02-BACKEND.md` section 8.

**Where keys live on the owner's machine (2026-10-29).** Two git-ignored files, never printed, copied or listed:
`.secrets/api-keys.env` (research keys: PageSpeed, CrUX, Gemini, Bing) and the owner's master `.env` in
`creds and accounts login/` (the platform's build and go-live keys). A script reads a key from the environment by its variable
name only; the docs name the variable so the owner can add it. Variables the platform scripts will expect, by name:
| Variable | Used by | Environment |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` | migrations, Edge Functions, dashboard build | one set per project: staging and production (DECISIONS 15); suffix `_STAGING` / `_PROD` in the master .env |
| `SUPABASE_DB_URL` | `run-staging.mjs`, the service functions | per project |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | site onboarding (Workers Admin), dashboard deploy | account |
| `RUNNER_KEY` | signs runner -> function calls (`export-published`, `job-callback`, `media-process-callback`) | per environment |
| `CRON_SECRET` | `push-lead`, `metrics-pull`, `sitemap-submit` | per environment |
| `GITHUB_DISPATCH_TOKEN` | `publish` -> `repository_dispatch` | this repo |
| `RESEND_API_KEY` | lead alerts and Supabase Auth email (invites, magic links); the owner named Resend for the master .env on 2026-10-29, which answers D5 once recorded in DECISIONS.md | platform |
| `SITE_SIGNING_KEY_<SLUG>` | minted by `tools/mint-site-key.mjs` (Vault + `api_keys`; the value is appended to the master .env, named by `OMNIKOM_ENV_FILE`, and shown nowhere); set on the site's Pages project as `SITE_SIGNING_KEY` | one per site |
| `LEAD_ALERT_FROM`, `DASHBOARD_URL` | `capture-lead` (function secrets): the alert sender on a verified Resend domain, the dashboard link in the alert | platform |
| `STAGING_DB_URL`, `PROD_DB_URL` | `apply-staging.mjs`, `run-staging.mjs`, `e2e-lead.mjs`, `mint-site-key.mjs` (read by name; production needs `--i-mean-production`) | per project |
Never in a client folder, a log, a reply or this repo.

### `api_keys` (PROPOSED)
One registry row per machine credential the platform issues or holds, so staff can see what exists, when it was last used, and
rotate it without reading Vault. The VALUE is never in this table: only a hash (for keys we verify, like site signing keys) or a
Vault name (for keys we present to others, like deploy tokens).
| Column | Meaning | Written by |
|---|---|---|
| `id` | key id | database |
| `workspace_id` | empty for platform-wide keys (runner key, cron secret) | staff |
| `site_id` | set for per-site keys (lead signing key, deploy token) | staff |
| `kind` | `site-signing`, `deploy-token`, `runner`, `cron`, `crm-webhook`, `omnisuite`, `client-api` (a client's own key to read its leads by API, later) | staff |
| `label` | plain name shown to staff ("ELEV8 production lead key") | staff |
| `key_hash` | SHA-256 of the key, for kinds we verify ourselves; empty otherwise | the issuing function |
| `vault_ref` | the Vault secret name, for kinds we present to a third party; empty otherwise | the issuing function |
| `scope` | what it may do, as JSON (`{ "worker": "elev8-prod" }` for a deploy token) | staff |
| `created_by`, `created_at` | who issued it, when | database |
| `last_used_at` | updated by the verifying function at most once a minute | `capture-lead`, `export-published`... |
| `expires_at`, `revoked_at` | rotation and revocation; a revoked key fails verification even if Vault still has it | staff |
Rules: one active `site-signing` key per site at a time, plus one "next" key during rotation (both verify for 24 hours); the
table is readable by staff only (RLS); no client role reads it. The site signing key is minted at onboarding, handed to the site's
Worker as a secret, and never appears in the dashboard, a log or a file.

## 8b. The expansion tables (migration 3, `20261029000003_addons.sql`, DECISIONS 23; tests T13 + mutants)
| Table | Holds | Who writes it | Who reads it |
|---|---|---|---|
| `add_ons` | per workspace and kind (`concierge`, `messaging`, `crm-sync`, `ads`): state `paying` -> `setting-up` -> `active` <-> `paused`, any -> `cancelled`; settings JSON; paid until | `service.activate_addon`, `service.set_addon_state` (owner or staff; legal transitions only) | owner, staff |
| `connectors` | one row per outside system (`omnisuite`, `crm-webhook`, `calendar`, `sms`, `payment`, `search-console`): label, config JSON (a check constraint refuses any `token`, `secret`, `password`, `apiKey` key), the credential by `api_keys` id, state, last ok, last error | staff and the setup wizard (service role); `webhook_received` marks ok | owner, staff |
| `bookings` | a meeting with a lead: with which team member, start, end (at most 8 h), where, source (`concierge`, `manual`, `import`), state `proposed` -> `confirmed` -> `held` / `no-show` / `cancelled`, calendar ref | `service.book` (the lead's rule: staff, owner, assigned member; members only for themselves; no overlap for one team member, advisory lock), `service.set_booking_state` | owner, staff, the team member it is with |
| `messages` | every outbound SMS and email: recipient (a lead or a login), channel, template id, provider id, state `queued` / `sent` / `delivered` / `failed` / `blocked` with the reason; the body is rendered at send time, never stored | `service.record_message` (SMS needs consent that covers texting; quiet hours and the daily cap block), `service.set_message_state` | owner, staff, the recipient, the assigned member of the lead |
| `platform_limits` | the counters' caps (`email_per_day` 95, `sms_per_day` 200, quiet hours 21 to 8) with the source of each | staff | staff |
| `crm_templates` | a client's sheet layout: ordered columns `[{ header, field, transform }]` and value maps | `service.save_crm_template` (owner or staff; shape checked) | members of the workspace |
| `webhook_events` | provider callbacks after signature check: connector, kind, provider event id (unique per connector: the same event twice stores one row), payload, processed at, error; the workspace comes from the connector, never the payload | `service.webhook_received` (service role) | staff |
`workspaces.timezone` (default America/Los_Angeles) drives quiet hours; `lead_event_kind` gained `booked`, `booking-changed`,
`message-sent`, `message-failed`.
**Leak found and fixed the same day (T12/T13, watched red):** for a login that is not a member at all, `my_role` is NULL and
`not (false or NULL)` is NULL, which PL/pgSQL reads as "do not raise": B's owner could have updated A's leads and activated
A's add-ons. Every such check now goes through `coalesce(..., false)` (`private.can_act_on_lead`, `private.is_owner_or_staff`,
`lead_update`), with a test per path and a mutant per guard.

## 9. Roles in one table
| Can | Visitor | Member | Owner | Staff |
|---|---|---|---|---|
| Send a lead | yes (signed by the site) | | | |
| See leads | | assigned to them | all of the workspace | all workspaces |
| Change lead status, assign, note | | own leads | all | all |
| Edit content | | `own` collections, own items | all collections not marked staff-only | all, plus locked fields with sign-off |
| Publish | | own items | all | all |
| Upload media | | yes | yes | yes |
| Manage logins | | | invite and remove members | invite owners, add staff |
| See integrations, site, API keys | | | integrations and site: read | all |
| Switch workspace | | if member of several | if owner of several | any, read-only "view as" |

## 10. What must be true before the CRM is built on this
1. The PROPOSED columns and tables (section 6 `flow`, `cta`, `marketing_consent`, `idempotency_key`; `lead_events`; section 8
   `api_keys`; section 4 `signing_key_ref`, `lead_alert_to`) go into ONE additive migration with a test that fails first and a
   mutant for each new wall (`08-SECURITY.md` section 4, the RLS checklist).
2. The owner's picks (asked this turn): fold notes and pushes into `lead_events` or add alongside; `api_keys` registry now or
   Vault names only until a second client; where lead alerts go (section 4 `lead_alert_to`).
3. Nothing here is proven on a real Supabase project (D1 open). The first real proof is `node supabase/tests/run-staging.mjs`
   on the staging project (W0.3).
