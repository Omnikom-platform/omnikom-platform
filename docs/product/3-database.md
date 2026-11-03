# Database

One multi-tenant Postgres database on Supabase: a staging project now, a production project made from it once staging proves
the product (`2-architecture.md`). The schema is the 14 migrations in `supabase/migrations/` (M1 to M14 below, in file order).
An applied migration is never edited; a change is a new migration (`11-rules.md`).

M1 platform, M2 crm, M3 addons, M4 hardening, M5 vendor_defaults, M6 active_key_by_site, M7 hardening_leftovers,
M8 search_path_and_roles, M9 media_and_export, M10 export_schema_key, M11 publish_ready_wall, M12 screens, M13 screens_functions, M14 crm_fields.

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
- The Edge Functions connect and step down to the role `omnikom_fn`, which may only execute `service` functions and reads no
  table. Every definer function pins `search_path = ''` with schema-qualified names. A new function is closed to PUBLIC by
  default privileges.
- Every "may this login act" check goes through `coalesce(..., false)`, so a login that is not a member at all is refused.
- `audit_log`, `security_events` and `consent_ledger` are append-only for every role (a trigger refuses update and delete).

## Tables by area

### Tenancy
| Table | Holds |
|---|---|
| `workspaces` | one client business: `slug`, `name`, `industry`, `timezone`, `state` (trial, active, suspended, offboarding, deleted) |
| `members` | a login in a workspace with role `owner` or `member`; `team_row_id` links the login to its row in the team collection, which drives "own items" |
| `staff` | Omnikom's own access, with a second factor (`aal2`); every staff action is audited. Not a user feature and has no screen |
| `workspace_limits` | per-workspace override of a platform limit (leads per hour 60 by default) |
| `platform_limits` | the caps and their sources (email and SMS per day, quiet hours) |

### Sites and content
| Table | Holds |
|---|---|
| `sites` | one row per website: `deploy_target` (its Pages project), `preview_host`, `domain`, `state` (preview, live, paused), `lead_alert_to`, `alert_assignee` |
| `site_contracts` | the content contract per workspace, versioned; `contract` as generated, `resolved` with the shared core merged; one `active` |
| `content_rows` | one item: `collection`, `owner_team_row`, `published_version` (moves only when a publish job finishes), `deleted_at` |
| `content_versions` | every save as a new version, never updated or deleted: `data` in the contract's shape, `by`, `at`, `sign_off` for a locked field |
| `media` | an uploaded file under `media/<workspace_id>/`: `width`, `height`, `bytes`, `processed`, `exif_stripped`, `rights_confirmed`, alt text |

Content is one generic table pair because the contract, not the schema, defines the collections: a new client or industry
needs no migration. Version history and rollback come from the append-only versions.

### Leads (the CRM)
| Table | Holds |
|---|---|
| `leads` | `site_id`, `form`, `page_path`, `name`, `email`, `phone`, `answers` (every other form field as JSON, keyed as in the contract, typed by M14: a number is a JSON number; a key the form does not declare is never stored), `consent_text`, `marketing_consent`, `sms_consent`, `sms_stopped_at`, `status` (new, contacted, qualified, closed, spam), `owner_team_row`, `flow`, `cta`, `idempotency_key`, `created_at` |
| `lead_events` | the lead's timeline, one row per thing that happened: `kind`, `by`, `detail`, `at`. Kinds in the enum: received, alert-sent, alert-failed, status, assigned, note, resent, exported, deleted, sms-stop, edited (M14: one per changed field, detail `{field, old, new}`), plus kinds left from dropped plans (pushed, push-failed, booked, booking-changed, message-sent, message-failed) |
| `lead_reads` | which login has opened which lead (the unread mark) |
| `consent_ledger` | the proof of consent per lead: wording and its sha256, sms and marketing consent, hashed address; outlives a deleted lead |
| `suppressions` | do-not-contact entries by channel and hashed address |
| `privacy_requests` | a person's request to know, delete, correct or opt out, with its 45-day clock |
| (`leads` at scale) | every list query is cut by workspace first (`leads_ws_created`), then filtered and sorted in memory: no index per industry key (head's ruling 2026-11-03). Measured in `supabase/tests/crm-scale.sql` (20,000 leads in a workspace). Revisit when one workspace passes about 50,000 leads; the ready design is a side table `lead_values (workspace_id, lead_id, key, num, txt)` kept by a trigger, indexed `(workspace_id, key, num)` and `(workspace_id, key, txt)` |
| `crm_templates` | a client's CRM column layout: ordered columns `[{header, field, transform}]` and value maps, used by export and import (`5-crm.md`) |

What `5-crm.md` needs that the tables do not hold yet: saved views, follow-up dates and tasks. Industry fields stay in
`answers` by design (one key per contract field); the columns are made by `lead_list` and the export from the contract.

### Publishing
| Table | Holds |
|---|---|
| `publish_jobs` | one per Publish: `rows` and `requested` versions, `snapshot` frozen when the build starts, `state` (queued, building, gating, deploying, done, failed), `gate_report`, `deploy_id`, `error` |
| `publish_job_events` | one row per state change |

Two database triggers refuse a job or a version that is not ready to publish (required fields, sources, placeholders):
`check_job_ready` and `check_version_ready` (M11).

### Keys, audit, metrics
| Table | Holds |
|---|---|
| `api_keys` | every machine credential: a sha256 hash (keys we verify) or a Vault name (keys we present), never the value; `kind`, `site_id`, `last_used_at`, `expires_at`, `revoked_at`; one active site-signing key per site |
| `audit_log` | who did what, when: every save, publish, lead change, delete, sign-off; written by the service functions only |
| `security_events` | every refused call, failed signature and quota hit; staff only |
| `metrics_snapshots` | observed numbers per workspace, source and day (search, speed, AI answers); empty until the metrics pull exists |

### Built and parked (no caller until the owner unparks them)
`add_ons`, `connectors`, `bookings`, `messages`, `webhook_events`, and the `integrations` table with its CRM webhook settings
(`set_crm_webhook`, `crm_secret_put`, `crm_target`). The webhook settings belong to the dropped automatic push and are to be
removed from the dashboard path (`5-crm.md`). The parked add-ons are described in `10-expansion.md`.

## Database functions by job

| Job | Functions |
|---|---|
| Content | `save_as` (the only way to save; calls `private.save_version`: role, own items, locked fields, stale base `S-STALE`), `seed_version`, `contract_for`, `unpublish` |
| Publish | `start_publish` (pins versions, one atomic job), `freeze_snapshot`, `published_rows`, `export_bundle`, `set_job_state` (legal moves only), `reap_stale_jobs` (pg_cron every 5 minutes), `drafts_waiting` |
| Media | `record_media`, `finish_media`, `media_processed`, `media_for_runner`, `media_facts` |
| Leads | `capture_lead` (workspace from the site, consent required, idempotent, quota, paused site refused; M14: answers typed against the active contract's form, `I-ANSWER <field>` refused in plain words), `add_lead`, `lead_update` (status, owner, unassign, note), `lead_set_fields` (M14: any core field and any editable industry field, typed; never the consent record; one `edited` event per changed field, one audit row per call), `lead_list` (M14: search, filter, sort and page on the server under the leads_read rule; keys checked against the contract; columns in form order), `leads_bulk` (M14: status, owner or delete for up to 500, all or nothing; delete needs `p_confirm`, one audit row per lead), `mark_lead_read`, `leads_exported`, `delete_lead` (hard delete plus an audit row), `lead_event`, `lead_sms_stop` |
| Team and settings | `set_member`, `remove_member`, `find_login`, `set_alerts`, `alert_recipients`, `lead_alerted` |
| CRM layout | `save_crm_template` (owner; shape checked) |
| Keys and safety | `active_key`, `touch_key`, `site_signing_secrets`, `record_security_event`, `suppress`, `set_workspace_state`, `open_privacy_request`, `set_privacy_request_state` |

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
