# Backend

Everything server-side: the Supabase Edge Functions, the database functions they call (`3-database.md`), the publish and media
runners on GitHub Actions, and the secrets. Heavy work never runs in an Edge Function (2 s CPU, 256 MB, 150 s idle limit); it
runs in the GitHub runner.

## How a call is checked

Every function is wrapped in one frame (`supabase/functions/_shared/dashboard.ts`, `_shared/http.ts`):
- **User calls** carry the Supabase JWT; the frame verifies it and passes the claims to the database, which checks the
  workspace against membership.
- **Machine calls** (runner, site, cron) run with `verify_jwt = false` and verify their own signature first: header
  `t=<unix>,v1=<hex>`, HMAC-SHA256 over `t \n METHOD \n path?query \n body`, accepted for 300 s
  (`_shared/signature.ts`). Method, path and query are signed, so a signature for one job is useless for another.
- CORS answers only a fixed list of dashboard origins. Every refusal writes a `security_events` row. Errors come back as a
  code plus plain words (`_shared/problems`); the dashboard shows the words.
- Shared validation imports `contracts/validate.mjs`, so the browser, the functions and the build run the same rules.

## The Edge Functions (30 in `supabase/functions/`)

| Function | Caller | Does |
|---|---|---|
| `save` | dashboard, user JWT | `contract_for` first (404 for non-members before any field name can leak), validate the draft, `save_as` |
| `drafts` | dashboard | lists the changes waiting to publish |
| `publish` | dashboard | validate exactly the given versions, `start_publish` pins them, GitHub dispatch to `publish.yml` (`workflow_dispatch`; `repository_dispatch` while only the old token is set) |
| `upload-start` | dashboard | a signed upload URL under `media/<workspace_id>/` (jpg, png, webp; 25 MB) |
| `upload-finish` | dashboard | records the media row, the rights tick and alt text, dispatches `media.yml` |
| `media-export` | runner, signed | hands the runner one original to process |
| `media-process-callback` | runner, signed | sets width, height, `exif_stripped`, `processed` |
| `export-published` | runner, signed | `freeze_snapshot` then the frozen rows, the contract, the media list and the site's Pages project |
| `job-callback` | runner, signed | `set_job_state` (409 on an illegal move); the gate report (at most 64 KiB) carries `audit`, the audit summary version 1, for a pass and a fail |
| `capture-lead` | the site's `/api/lead`, signed with that site's key (the signed path carries the visitor's hash) | stores the lead (`5-crm.md`), counts the visitor and refuses one past 5 leads an hour (M30 `count_visitor`, 429), queues the new-lead alert (M29 `queue_lead_alert`: one `mail_outbox` row per alert address, none for a lead already alerted) |
| `mail-outbox` | pg_cron every minute through pg_net (`service.mail_outbox_tick`), signed `X-Cron-Signature` (`MAIL_OUTBOX_KEY`) | E4 (M29): sends the queued new-lead alerts by Resend, at most 10 a run, one at a time, each with a 10 s timeout and the message id as Resend's idempotency key (`outbox_claim`, `outbox_done`); a failed try is tried again 5, 10 ... 25 minutes later and the sixth fails the message; a capped alert goes the next day; a suppressed address is dropped; 200 `{ claimed, sent, failed }` |
| `mail-events` | Resend's webhook, signed the Svix way (`svix-id`, `svix-timestamp`, `svix-signature`; `RESEND_WEBHOOK_SECRET`; a timestamp more than 300 s off is refused) | E21 (M31): a permanent `email.bounced` suppresses the address the email went to for the whole platform, an `email.complained` for the message's workspace (`mail_event`: the address comes from our own `messages` row that `data.email_id` names, never from the payload); any other signed event is 200 `{ handled: false }`; 200 `{ handled: true, suppressed }`; a bad signature is 401 and a security event; no secret, or one that is not base64, is 500 `CONFIG` |
| `add-lead` | dashboard | a lead entered by hand, consent tick required |
| `lead-update` | dashboard | status, owner, unassign, note, mark read; `fields` edits any core or editable industry field (M14 `lead_set_fields`), 200 `{changed}`; `follow_up` (work order 18: an ISO date-time with an offset, or null to clear) sets the follow-up date (M22 `lead_follow_up`), 204; work order 20 (M23): `status` is a key of the business's own list (400 `I-ANSWER status` otherwise), with `status_date` (a day; needed when the list says `needsDate`), `status_who` (a member; defaults to the caller) and `status_text` (up to 200); a note carries its author (`detail.author` kind and name; kind is `agent` only when the verified claims carry `app_metadata.actor = "agent"`, never a body field); a status change clears the date, person and line the old status carried |
| `lead-export` | dashboard | CSV of the leads the caller may see, one column per core and industry field in form order; one `exported` event per lead. With `template` (work order 02): the caller's CRM view (`lead_list`: search, filters, sort, and from work order 20 the view's `due` and `duplicates` ticks, each true or false, 400 otherwise) in the saved map's columns and order, at most 5000 |
| `crm-map-propose` | dashboard (owner) | proposes how the client's CRM file maps to our core and industry fields (`tools/crm-map` proposeMap; headers and 20 sample rows, or a file of at most 1 MB); stores nothing |
| `crm-template-save` | dashboard (owner) | confirms the map (`validateTemplate`, every industry field on the forms) and saves it (M15 `save_crm_template`, one per name) |
| `lead-import` | dashboard (owner) | the client's file (CSV, at most 1 MB and 5000 rows, measured below) through a saved map (M15 `import_leads`): a dry run first; a real run needs the consent tick, all or nothing |
| `site-audit` | dashboard (owner) | a site's stored search check (M16 `site_audit`): `{ latest: { preview, production }, history }`, the newest audit summary per target and the last 10 publishes (date, state, pass, counts); 404 for a member, another workspace and a missing site; read by the dashboard's Overview (the site check headline) and, later, its Search health page (`6-dashboard.md`) |
| `lead-list` | dashboard | the CRM list on the server (M14 `lead_list`): search, filter, sort, page of at most 200, typed columns in form order; 422 `S-QUERY` for a key that is not a column; work order 18: `due: true` (follow-up date or an open task's time has come) and `duplicates: true` (flagged leads), rows carry `follow_up`, `duplicate`, `duplicate_of`; work order 20: rows carry `lead_type`, `status_date`, `status_who`, `status_text`, the answer carries the business's `lead_types` and `statuses` (from the contract's `crm` block), the filters and sort take `lead_type`, `status`, `status_date`, a status sorts by its place in the list |
| `view-save` | dashboard | saves a CRM view, a `lead_list` query plus an ordered column list (M22 `view_save`): a member their own, shared only for an owner (403 `S-OWN-ONLY`); the query is refused by the code `lead_list` uses (422 `S-QUERY`), a column that is not a column is 400 naming it; 200 `{view}`. Views are listed by a plain select (RLS) |
| `view-delete` | dashboard | deletes a saved view (M22 `view_delete`): the caller's own, or an owner's for a shared one; 204 |
| `lead-task` | dashboard | `{lead, text, due?}` adds a task (201 `{task}`), `{task, done}` finishes or reopens it (200); each change is a `task` event on the lead (M22 `task_add`, `task_done`) |
| `leads-bulk` | dashboard | status, owner or delete for up to 500 leads, all or nothing (M14 `leads_bulk`); delete needs `confirm: true` (409 `S-CONFIRM`); a single delete is a bulk of one; work order 20: a status value is a key of the business's own list, and one that needs a date is 400 (one lead at a time); a bulk delete is `service.delete_lead` once per lead (one audit row each, the same erasure as a single delete) |
| `invite-member` | dashboard (owner) | finds the login or creates it (Auth admin `generate_link`, which sends nothing), adds the member (`set_member`), then asks Auth to send the mail: a new login gets the invite mail with the inviter's name and the business as user data (`POST /auth/v1/invite`, DP-email-08 to 12), an existing confirmed login the sign-in mail (`POST /auth/v1/otp`, `create_user` false; it cannot name either), one that never opened its invite the invite again, its user data set first (`PUT /auth/v1/admin/users/<id>`). `email_sent` is Auth's own answer; a mail that did not go does not undo the membership. The facts come from M17 `invite_context` |
| `team-list` | dashboard (owner) | the members of the workspace, owners first: user, email, role, team profile and name, joined date (M17 `list_members`); 404 for anyone else |
| `member-remove` | dashboard (owner) | takes a person out (`remove_member`): never the last owner (409 `S-LAST-OWNER`), audited, their rows stay. Open sessions are not ended: Supabase Auth has no admin logout by user id (`api.go`, `GoTrueAdminApi.ts`, read 2026-11-04); every request is checked against `members`, so their next request in the workspace is refused (T27 proves it with the claims the person had) |
| `unpublish` | dashboard (owner) | Delete on an item (B12): `service.unpublish` with delete; soft-deleted, off the site with the next publish, versions kept, one audit row `delete`; 404 for anyone but an owner or staff of the row's workspace; 204 |
| `settings-save` | dashboard (owner) | one site's lead alert addresses (up to 10) and "also email the assigned agent"; no CRM part (a `crm` key alone is 400) |
| `metrics-pull` | pg_cron, signed `X-Cron-Signature` (`CRON_KEY`) | work order 44 (M27): the daily pull of one workspace's search numbers into `metrics_snapshots` by (workspace, source, day), one site per workspace (the live one, else the oldest preview one). `?workspace=<id>`: `search-console` (a BLOCKED row until the owner verifies a property; fixtures only, live UNPROVEN) and `bing`; `?workspace=<id>&source=pagespeed`: five pages from the site's sitemap on a phone plus CrUX, weekly. SEO's collectors (`tools/audit/metrics`) loaded through `_shared/metrics.ts`; keys by name `PSI_API_KEY`, `CRUX_API_KEY`, `BING_WEBMASTER_KEY`; a source with no key is a BLOCKED row and sends no request, a 429 or 403 stops that source; a source that throws writes no row. `ai-answers` has no writer (no model call in runtime code, DECISIONS 38): NOT DONE |
| `sitemap-submit` | head, signed `X-Cron-Signature`; the same code runs inside `job-callback` on `done` of a production job (best effort, never changes the 204) | work order 44: Search Console submit (BLOCKED until a property is verified) and an IndexNow ping of the sitemap's addresses appended to the day's `bing` row; the ping is sent only when the site hosts a key file, and none does (the factory slice, work order 45): NOT DONE |

**The import's caps are measured** (work order 02, F6): parse + map in Deno, the functions' runtime (`supabase/functions/test/import-cpu.ts`,
2026-11-04, idle laptop, 3 runs of 5 each; the worst CPU of the 3 runs):

| Rows | File | Worst CPU |
|---|---|---|
| 1000 | 0.19 MB | 234 ms |
| 2000 | 0.39 MB | 109 ms |
| 5000 | 0.99 MB | 374 ms |
| 5000 | 5.00 MB | 3704 ms |

CPU follows file size, about 0.75 s per MB worst; cap 1 MB / 5000 rows, under 1 s of the 2 s CPU limit. A bigger file is refused whole
with plain words before it is parsed (413 `I-FILE` over 1 MB, 413 `I-ROWS` over 5000 rows), never cut short.

Functions the book needs that do not exist (states in `1-product.md`): field edit and bulk edit for leads, saved views, delete a lead,
media library, metrics pull. There is no push function and none is to be built.

## Publishing a change

```mermaid
sequenceDiagram
  participant U as Business user
  participant DS as Dashboard
  participant E as save and publish functions
  participant D as Database
  participant R as Publish runner (publish.yml)
  participant S as Website (Pages project)
  U->>DS: edits a page
  DS->>E: save
  E->>D: new version, live site unchanged
  U->>DS: publish
  DS->>E: publish
  E->>D: start_publish pins the versions (ready wall checks fields, sources, placeholders)
  E->>R: workflow_dispatch {job_id, site_id}
  R->>E: export-published (signed)
  E->>D: freeze_snapshot, published_rows
  R->>R: build the site, run the gates
  alt every gate passes
    R->>S: wrangler pages deploy to the site's own project
    R->>R: smoke test (the deployment by content hash, then the site: 200, noindex on a preview, the home title), a live site that fails is rolled back
  else a gate fails
    R-->>E: failed, with the reason in plain words; nothing deployed
  end
  R->>E: job-callback (signed)
  E->>D: set_job_state; on done the rows go live at their snapshot versions
```

Rules of the pipeline:
- One build per site at a time (`concurrency: site-<site_id>`, queue max); different sites build in parallel.
- The snapshot is frozen when the build starts, so a rerun ships exactly the same content.
- The runner refuses when the export's site or Pages project differs from the job's.
- A failed job changes nothing live: a build that fails a gate is never deployed, and a live deploy that fails its smoke is rolled back to the deployment before it (a first live deploy has none); its versions are never shipped by a later job.
- `reap_stale_jobs` fails a job idle 30 minutes in building, gating or deploying, or 24 hours queued.
- Before deploying a site that has a lead form, the runner reads the site's Pages project settings and stops if `SITE_ID`,
  `SITE_SIGNING_KEY` or `PLATFORM_BASE` is missing.

## Photos

`upload-start` gives a signed URL; `upload-finish` records the row and dispatches `media.yml`. The runner downloads the
original, strips EXIF and GPS, writes WebP at 2400, 1600 and 800 px with `sharp`, and calls `media-process-callback`. Publish
refuses a photo with no alt text, below the slot's minimum width, without the rights tick, or not processed. The bucket is
private; a build copies only the media a snapshot row uses.

## GitHub Actions workflows

| Workflow | Runs | Does |
|---|---|---|
| `ci.yml` | every push and pull request | the checks (`11-rules.md`): gates, factory, functions, audit, cli, dashboard, departments, secrets, workflows |
| `publish.yml` | `workflow_dispatch` from `publish` (`repository_dispatch` publish while only the old token is set), or by hand | export, build, audit gate, Pages deploy, smoke, rollback of a failed live deploy, callback |
| `media.yml` | `workflow_dispatch` from `upload-finish` (`repository_dispatch` media while only the old token is set) | photo processing |
| `keepalive.yml` | Mondays 06:00 UTC | one read-only CLI `status` so the free staging project is not paused |
| `alerts.yml` | hourly | read-only alert queries on staging; sending is off until a sender exists |
| `backup.yml` | nightly | encrypted dump of staging to two buckets; skipped until the owner sets up the buckets and key |
| `key-rotation.yml` | monthly | red when an active key is over 90 days old or expires within 14 days |

`.github/production/` holds `promote.yml` and the production backup, which run only in the separate production repository.

## Secrets

Values live only in Supabase Vault, a function's environment, a GitHub secret or a Pages project secret. Tables hold a hash or
a Vault name. A script reads a key by its variable name from the git-ignored `.env` files and never prints it.

| Secret | Lives in | Used by |
|---|---|---|
| Supabase secret key, per environment | function environment, GitHub secret (production's only in the production repository) | functions, CI |
| Database address through the transaction pooler (port 6543), per environment | function environment, as `DB_POOLER_URL` (set by the head from the env file's `STAGING_DB_URL`) | every function (`_shared/db.ts` `connect()`) |
| Supabase publishable key | dashboard build (public by design; RLS applies) | dashboard |
| Cloudflare deploy token, one for the account (Pages edit, DNS edit) | GitHub secret, held only by the runner | `publish.yml` |
| GitHub dispatch token (`GITHUB_DISPATCH_TOKEN_V2`, this repository, Actions: write; the old Contents token until retired) | function environment | `publish`, `upload-finish` |
| Runner key | function environment and GitHub secret | runner calls |
| Cron key | function environment (`CRON_KEY`) and Vault (`metrics_cron_key`, with `project_url`) | the signature of `metrics-pull` and `sitemap-submit`; Vault is where pg_cron reads it |
| PageSpeed, CrUX and Bing Webmaster keys | function environment | `metrics-pull` (a missing one is a BLOCKED row) |
| Site signing key, one per site | the site's Pages project and Vault; hash in `api_keys` | `/api/lead` to `capture-lead` |
| Resend key, alert sender | function environment | lead alert, sign-in mail through Supabase Auth SMTP |
| Mail outbox key | function environment and Vault `mail_outbox_key` | pg_cron to `mail-outbox` |
| Resend webhook signing secret | function environment | `mail-events` |

Variable names a script expects: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` (suffix `_STAGING` or
`_PROD`), `STAGING_DB_URL`, `PROD_DB_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `RUNNER_KEY`,
`GITHUB_DISPATCH_TOKEN_V2`, `GITHUB_DISPATCH_TOKEN`, `CRON_KEY`, `PSI_API_KEY`, `CRUX_API_KEY`, `BING_WEBMASTER_KEY`, `RESEND_API_KEY`, `LEAD_ALERT_FROM`, `DASHBOARD_URL`, `MAIL_OUTBOX_KEY`, `RESEND_WEBHOOK_SECRET`, `SITE_SIGNING_KEY_<SLUG>` (minted by
`tools/mint-site-key.mjs`), `PLATFORM_FUNCTIONS_BASE`, `CLOUDFLARE_PAGES_TOKEN`. Production keys are used only with
`--i-mean-production`.

## Deploying the backend

`tools/apply-staging.mjs` applies migrations to staging and keeps a ledger with each file's sha256; it refuses a migration whose
content changed after it was applied. `tools/deploy-functions.mjs` deploys the Edge Functions. Production receives only what
staging proved, through the owner-run `promote` workflow (`2-architecture.md`).
