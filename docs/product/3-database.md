# Database

One multi-tenant Postgres database on Supabase: a staging project now, a production project made from it once staging proves
the product (`2-architecture.md`). The schema is the 16 migrations in `supabase/migrations/` (M1 to M16 below, in file order).
An applied migration is never edited; a change is a new migration (`11-rules.md`).

M1 platform, M2 crm, M3 addons, M4 hardening, M5 vendor_defaults, M6 active_key_by_site, M7 hardening_leftovers,
M8 search_path_and_roles, M9 media_and_export, M10 export_schema_key, M11 publish_ready_wall, M12 screens, M13 screens_functions, M14 crm_fields, M15 crm_export_import, M16 site_audit.

## The five words

- **Workspace**: one client business. Everything the client owns belongs to exactly one workspace.
- **Site**: one website of a workspace, one Cloudflare Pages project. A workspace can have several.
- **Row**: one piece of content (a page, a listing, an article, the business details). Its text lives in versions.
- **Lead**: one form submission or hand-entered contact, with the exact consent wording the person saw.
- **Login**: a person's Supabase Auth account, signed in by magic link. It belongs to one or more workspaces as owner or member.

## The wall between workspaces

Every table carries `workspace_id` and has row-level security. The database refuses a row to anyone who is not a member of that
workspace. The workspace in a request is a claim, checked against membership, never trusted alone. Clients never write content
or lead tables directly: the only ways in are the service functions, reached through the Edge Functions, which check the
contract rules and write an audit row. Visitors reach the database only through lead capture, which takes the workspace from
the site, never from the form. A guessed id from another workspace answers "not found".

How the wall is built (each part has a test and a mutant in `supabase/tests/run-local.mjs`):
- Supabase's default grants to `anon` and `authenticated` are revoked first; `anon` has no table or function rights;
  `authenticated` has SELECT (filtered by RLS) and nothing else on content and leads (direct UPDATE on `leads` is revoked).
- Schemas: `public` (tables, exposed read-only through RLS), `private` (helpers the policies use: `is_member`, `my_role`,
  `my_team_row`, `can_see`, `is_staff`, `can_act_on_lead`, `is_owner_or_staff`, `limit_for`), `service` (the write functions,
  never exposed to clients).
- The Edge Functions connect through the transaction pooler (`DB_POOLER_URL`) and step down to the role `omnikom_fn` inside
  each statement's own transaction; `omnikom_fn` may only execute `service` functions and reads no table. Every definer
  function pins `search_path = ''` with schema-qualified names. A new function is closed to PUBLIC by default privileges.
- Every "may this login act" check goes through `coalesce(..., false)`, so a login that is not a member at all is refused.
- `audit_log`, `security_events` and `consent_ledger` are append-only for every role (a trigger refuses update and delete). `security_event_counts` is not: one row per source and minute holds how many times an event repeated (only `service.record_security_event` writes it).

## Tables by area

### Tenancy
| Table | Holds |
|---|---|
| `workspaces` | one client business: `slug`, `name`, `industry`, `timezone`, `state` (trial, active, suspended, offboarding, deleted) |
| `members` | a login in a workspace with role `owner` or `member`; `team_row_id` links the login to its row in the team collection, which drives "own items" |
| `staff` | Omnikom's own access, with a second factor (`aal2`) and only inside an open window of its own (`staff_access`, M43); every staff action is audited. Not a user feature and has no screen |
| `staff_access` | a staff login's windows: `reason` (10 to 200 characters), `opened_at`, `until` (at most 4 hours later); opened only by `service.staff_open`, one `audit_log` row each; a login reads only its own. Windows are kept 365 days, cleaned as `staff_open` writes, not by `service.purge_expired` (the head's choice, no source) |
| `workspace_limits` | per-workspace override of a platform limit: leads per hour, mail and SMS per day, sites, MB of photos and files, publishes a day |
| `platform_limits` | the caps and their sources (email and SMS per day, quiet hours; sites, MB of photos and files and publishes a day, the three new ones, are the head's choice) |

### Sites and content
| Table | Holds |
|---|---|
| `sites` | one row per website: `deploy_target` (its Pages project), `preview_host`, `domain` (M23: unique in any letter case, `sites_domain_unique`), `state` (preview, live, paused), `lead_alert_to`, `alert_assignee` |
| `site_contracts` | the content contract per workspace, versioned; `contract` as generated, `resolved` with the shared core merged; one `active` |
| `content_rows` | one item: `collection`, `owner_team_row`, `published_version` (moves only when a publish job finishes), `deleted_at`, `off_site_at` (taken off the site, M45) |
| `content_versions` | every save as a new version, never updated or deleted: `data` in the contract's shape, `by`, `at`, `sign_off` for a locked field |
| `media` | an uploaded file under `media/<workspace_id>/`: `width`, `height`, `bytes`, `processed`, `exif_stripped`, `rights_confirmed`, alt text. The Storage bucket `media` is private, caps a file at 26214400 bytes and allows only jpeg, png, webp, heic and pdf (the same constants as `upload-start`, compared by `run-local.mjs`); a signed-in user may read their workspace's folder but has no insert policy (migration 21), so uploads go only through the signed URL |

Content is one generic table pair because the contract, not the schema, defines the collections: a new client or industry
needs no migration. Version history and rollback come from the append-only versions.

### Leads (the CRM)
| Table | Holds |
|---|---|
| `leads` | `site_id`, `form`, `page_path`, `name`, `email`, `phone`, `answers` (every other form field as JSON, keyed as in the contract, typed by M14: a number is a JSON number; a key the form does not declare is never stored), `consent_text`, `marketing_consent`, `sms_consent`, `sms_stopped_at`, `status` (M23: text, one of the business's own list or spam; default `not-contacted`), `lead_type` (M23: text, default `enquiry`, one of the business's own list), `status_date`, `status_who` (a member), `status_text` (up to 200; M23: each kept only when the status's list entry asks for it; `private.lead_guard` checks every write), `owner_team_row`, `flow`, `cta`, `idempotency_key`, `follow_up_at` (M22: set through `lead_follow_up`), `duplicate_of` (M22: the oldest earlier lead of the workspace with the same email, lower-cased, or phone, E.164; set by a trigger on every insert, never by a caller; nothing is merged), `created_at` |
| `lead_events` | the lead's timeline, one row per thing that happened: `kind`, `by`, `detail`, `at`. Kinds in the enum: received, alert-sent, alert-failed (M50: a lead alert dropped because its address is suppressed; the detail holds to and reason), status, assigned, note, resent, exported, deleted, sms-stop, edited (M14: one per changed field, detail `{field, old, new}`), follow-up (M22: detail `{old, new}`), task (M22: detail `{action: added / done / reopened, task, text}`), plus kinds left from dropped plans (pushed, push-failed, booked, booking-changed, message-sent, message-failed) |
| `lead_reads` | which login has opened which lead (the unread mark) |
| `consent_ledger` | the proof of consent per lead: wording and its sha256, sms and marketing consent, hashed address; outlives a deleted lead |
| `suppressions` | do-not-contact entries by channel and hashed address |
| `mail_outbox` | M29, a new-lead alert waiting to go: one row per lead, template and address (unique), `message_id` (its current try; each try is a `messages` row written through `record_message`, which keeps the daily caps), `attempts`, `next_at`; written only by `queue_lead_alert`, `outbox_claim` and `outbox_done`, read by staff with MFA; a lead's delete removes its rows |
| `visitor_counts` | M30, the leads one visitor of a site sent in the current clock hour: `site_id`, `ip_hash` (sha256 of the site id and the visitor's address, never the address), `hour`, `n`; written only by `count_visitor` (which deletes the site's older hours), read by staff with MFA; a site's delete removes its rows |
| `privacy_requests` | a person's request to know, delete, correct or opt out, with its 45-day clock |
| (`publish_jobs` read per site) | `service.site_audit` (M16) reads one site's finished jobs: the existing `publish_jobs_site_state (site_id, state)` finds them and the few hundred a site makes in a year are sorted in memory, so M16 adds no index (checked 2026-11-04). Revisit when one site passes about 10,000 jobs; the index then is `(site_id, finished_at desc)`. Preview jobs are skipped (M42). |
| (`leads` at scale) | every list query is cut by workspace first (`leads_ws_created`), then filtered and sorted in memory: no index per industry key (head's ruling 2026-11-03). Measured in `supabase/tests/crm-scale.sql` (20,000 leads in a workspace). Revisit when one workspace passes about 50,000 leads; the ready design is a side table `lead_values (workspace_id, lead_id, key, num, txt)` kept by a trigger, indexed `(workspace_id, key, num)` and `(workspace_id, key, txt)` |
| `crm_templates` | a client's CRM column layout: ordered columns `[{header, field, transform}]` and value maps, used by export and import (`5-crm.md`) |
| `crm_views` | M22, saved views: `workspace_id`, `user_id` (null = shared with the workspace), `name` (1 to 60, unique per person and, for the shared ones, per workspace), `query` (the shape `lead_list` takes, checked by the same function), `columns` (text[], at most 60, in order). A member reads their own and the shared ones; every write is `view_save` / `view_delete` |
| `lead_tasks` | M22, a lead's tasks: `lead_id`, `text` (1 to 500), `due_at`, `done_at`, `created_by`; read exactly where the lead is read (an owner all, a member the leads assigned to them); written by `task_add` / `task_done` |

Industry fields stay in `answers` by design (one key per contract field); the columns are made by `lead_list` and the export from the contract.
A view's `columns` is the choice of columns (A13); the screen keeps an unsaved view in the page address.

### Publishing
| Table | Holds |
|---|---|
| `publish_jobs` | one per Publish: `rows` and `requested` versions, `snapshot` frozen when the build starts, `state` (queued, building, gating, deploying, done, failed), `gate_report` (for a finished job: `factory`, and `audit`, the runner's audit summary version 1 of `tools/audit/summary.mjs`, at most 60 KiB, for a pass and a fail; M16 reads it back), `deploy_id`, `error`, `preview` and `left_out` (B15: a preview job of the ready drafts, `rows` empty so `done` moves no `published_version`; the drafts the wall would refuse, each with its field) |
| `publish_job_events` | one row per state change |

Two database triggers refuse a job or a version that is not ready to publish (required fields, sources, placeholders):
`check_job_ready` and `check_version_ready` (M11).

### Keys, audit, metrics
| Table | Holds |
|---|---|
| `api_keys` | every machine credential: a sha256 hash (keys we verify) or a Vault name (keys we present), never the value; `kind`, `site_id`, `last_used_at`, `expires_at`, `revoked_at`; one active site-signing key per site |
| `audit_log` | who did what, when: every save, publish, lead change, delete, sign-off; written by the service functions only |
| `security_events` | every refused call, failed signature and quota hit (the first of each source and minute); staff only |
| `security_event_counts` | how often each security event repeated, per kind, site, source and minute; anonymous sources past 10 a minute per kind share one overflow row; staff only |
| `function_errors` | M32, one row per function, status and minute with the count of 5xx answers and the newest request id; staff only; kept 30 days, cleaned as it is written by `service.record_function_error`, not by `service.purge_expired` |
| `metrics_snapshots` | observed numbers per workspace, source and day: `search-console`, `pagespeed`, `bing`, `ai-answers` (and `uptime`, which nothing writes); written only by `service.metrics_put` (M27, from `metrics-pull` and `sitemap-submit`), read by any member through RLS. A BLOCKED row (`data.blocked = { reason, unblock }`) says a source is not connected. Shapes: `tools/audit/metrics/README.md` |
| `retention_rules` | how long each growing table keeps a row, as data (M28; a change needs no migration; staff with MFA read it): processed `webhook_events` 30 days (providers retry for days: Stripe up to 3, docs.stripe.com/webhooks "Retry behavior"), open or failed ones 90; `security_event_counts` 30; `security_events` 365 (PCI DSS v4.0 10.5.1: 12 months); `audit_log` 730 (a two-year proposal, no sourced rule); `messages` 1461 (TCPA claims have a four-year limit, 28 U.S.C. 1658(a)); `consent_ledger` never. Set by the head of operations on 2026-11-11 from the Clients department's proposal; the owner may revise any period. Floors refuse a period that would wipe a trail by mistake (audit log 365, security events 90, messages 365, others 7); the consent ledger cannot get one. `purge_expired` applies them daily (pg_cron, 03:17 UTC). M46 (E12): every other growing table has its row with no period and the reason it keeps its rows (a period is refused where the purge has no branch, `retention_rules_purged`), and every row that names a table a `budget_mb` (35 MB each, 2026-11-12, the owner may revise) |

### Built and parked (no caller until the owner unparks them)
`add_ons`, `connectors`, `bookings`, `webhook_events`, and the `integrations` table with its CRM webhook settings
(`set_crm_webhook`, `crm_secret_put`, `crm_target`). The webhook settings belong to the dropped automatic push; nothing in the dashboard or the
functions calls them any more (work order 08), and the table, its rows and these functions stay until a migration removes them (`5-crm.md`). The parked add-ons are described in `10-expansion.md`.

## Database functions by job

| Job | Functions |
|---|---|
| Content | `save_as` (the only way to save; calls `private.save_version`: role, own items, locked fields, stale base `S-STALE`), `seed_version`, `contract_for`, `unpublish` (delete or take off, M45), `put_back` (M45) |
| Publish | `start_publish` (pins versions, one atomic job), `freeze_snapshot`, `published_rows`, `gone_rows` (what left the site in the last 7 days, for the export's `removed`), `export_bundle`, `set_job_state` (legal moves only), `reap_stale_jobs` (pg_cron every 5 minutes), `drafts_waiting` |
| Metrics | `metrics_targets` (one site per workspace that is trial or active), `metrics_target_for_job`, `metrics_put` (upsert by workspace, source, day; refuses a source the collectors do not write, data that is not an object, over 256 KiB), `metrics_get`, `metrics_last_day` (the function role's five); `metrics_calls`, `metrics_pull_all` (pg_cron `metrics-pull-daily` at 03:30 UTC; signs two calls per workspace and posts them through pg_net with `metrics_cron_key` and `project_url` from Vault; sends nothing where pg_net, Vault or the entries are missing; no grant to any role) |
| Media | `record_media`, `finish_media`, `media_processed`, `media_for_runner`, `media_facts`, `replace_media`, `delete_media`, `deleted_media_path` (M49) |
| Leads | `capture_lead` (workspace from the site, consent required, idempotent, quota, paused site refused; M14: answers typed against the active contract's form, `I-ANSWER <field>` refused in plain words), `add_lead` (M15: answers typed against every industry field, an unknown key dropped), `import_leads` (M15, owner: a dry run by default; a real run needs the consent tick and skip or add for duplicates, all or nothing, form `import`, one `received` event and one consent ledger row per lead, one audit row with the file's sha256), `lead_update` (status, owner, unassign, note), `lead_set_fields` (M14: any core field and any editable industry field, typed; never the consent record; one `edited` event per changed field, one audit row per call), `lead_list` (M14: search, filter, sort and page on the server under the leads_read rule; keys checked against the contract by `private.lead_query_check` (M22: the one function `view_save` uses too); columns in form order; M22: filters `due` and `duplicates`, rows carry `follow_up`, `duplicate`, `duplicate_of` (the other lead's id only when the caller may read it)), `lead_follow_up` (M22: set or clear a lead's follow-up time, one `follow-up` event with old and new), `task_add` / `task_done` (M22: a lead's tasks, one `task` event per change), `leads_bulk` (M14: status, owner or delete for up to 500, all or nothing; delete needs `p_confirm`, one audit row per lead), `mark_lead_read`, `leads_exported`, `delete_lead` (hard delete plus an audit row), `lead_event`, `lead_sms_stop` |
| Team and settings | `set_member`, `remove_member`, `find_login`, `list_members` (M17: owner or staff, email from `auth.users`, the team profile's name), `invite_context` (M17: the business's and the inviter's name for the invite mail), `set_alerts`, `alert_recipients`, `lead_alerted`, `queue_lead_alert` (M29: capture-lead's call, a `mail_outbox` row per alert address, none for a lead already alerted), `outbox_claim` (M29: the due rows, oldest first and locked; a suppressed address is dropped and its lead gets an alert-failed event (M50), a capped one waits for the next day, the rest are leased, one try more and the next 5 minutes times the tries later), `outbox_done` (M29: sent with Resend's id as `provider_id`, or failed on the sixth try), `mail_outbox_tick` (M29: pg_cron `mail-outbox` every minute; signs a call to `mail-outbox` and posts it through pg_net with `mail_outbox_key` and `project_url` from Vault, only when a row is due; no grant to any role), `staff_open` (M43: staff with MFA only; opens the login's window of 1 to 240 minutes with a reason of 10 to 200 characters and writes one `audit_log` row `staff-access-open`; staff tools call it through the database, no Edge Function does) |
| Site check | `site_audit` (M16: the owner of the site's workspace, or staff with MFA, else `S-NOT-FOUND`, so a member, another workspace's owner and a missing site all get not found; answers `{ latest: { preview, production }, history }`: `latest` is the newest finished job per target whose `gate_report.audit` is version 1, its summary whole with fails; `history` the last 10 finished jobs, newest first, each without fails, a job from before version 1 with `pass` and `counts` null). No new table. |
| Saved views | `view_save` (M22: a member saves their own, only an owner or staff with MFA a shared one; the query checked by `lead_query_check`, every column key checked, 100 per person), `view_delete` (own, or an owner's for a shared one) |
| CRM layout | `save_crm_template` (owner; shape checked; M15: a field may be `owner`, every industry field must be on the forms (`T-FIELD`), one map per workspace and name), `crm_fields` (M15, owner: the industry fields in form order, for the map) |
| Keys and safety | `active_key`, `touch_key`, `site_signing_secrets`, `record_security_event`, `record_function_error` (M32: every function's call for an answer of 500 to 599, from `withRequestId` in `_shared/http.ts`; deletes the rows older than 30 days, then counts the error in `function_errors` per function, status and minute with the newest request id; no cause, no value), `count_visitor` (M30: capture-lead's call; counts one visitor of a site in the hour in `visitor_counts` and refuses `S-QUOTA-VISITOR` past `leads_per_hour_visitor`, 5 by default, a workspace's own value in `workspace_limits` first; the refusal undoes its count), `suppress`, `mail_event` (M31: the mail-events function's call for a permanent bounce or a complaint; reads the address from our own `messages` row that Resend's email id names, never from the payload, and suppresses it through `suppress`: a bounce for the whole platform, a complaint for the message's workspace; an email id that is none of ours, or one whose message's address was erased (M26), does nothing), `set_workspace_state`, `open_privacy_request`, `set_privacy_request_state`, `offboarding_storage` (M26: staff with MFA, an offboarding workspace's Storage paths), `purge_expired` (M28: deletes each growing table's rows older than its period, at most a batch per table per call, one audit row with the counts; the service role only (pg_cron runs it as the owner; no function calls it, so the function role may not); `audit_log` and `security_events` stay append-only except for this purge, inside it, as the table owner, for a row past its period), `over_budget` (M46: the tables over their `budget_mb`, measured with `pg_total_relation_size`; reads only; the service role; the hourly alert `table-over-budget` asks it) |

## Roles

| Can | Visitor | Member (agent) | Owner |
|---|---|---|---|
| Send a lead | yes, signed by the site | | |
| See leads | | assigned to them | all of the workspace |
| Change a lead | | own leads | all |
| Edit content | | `own` collections, own items | every collection not locked |
| Publish | | own items | all |
| Upload media | | yes | yes |
| Manage logins | | | invite and remove members |

Locked fields (licence numbers, legal notices) change only through Omnikom with a recorded sign-off.

## Realtime

The `supabase_realtime` publication carries `leads`, `lead_events`, `lead_reads` and `publish_jobs` (and the parked
`bookings`). `publish_job_events` is not in it, so the publish screen refetches.

## Tests

`node supabase/tests/run-local.mjs` makes a throwaway local Postgres cluster, applies a model of Supabase's defaults
(`local-shim.sql`) and the migrations, runs `tenancy.test.sql` and the other wall tests, then the mutants, each removing one
wall; every mutant must turn the tests red. The same tests run against the staging project. Structural gate T14 checks every
definer function's `search_path`.
