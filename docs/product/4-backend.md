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

## The Edge Functions (16 in `supabase/functions/`)

| Function | Caller | Does |
|---|---|---|
| `save` | dashboard, user JWT | `contract_for` first (404 for non-members before any field name can leak), validate the draft, `save_as` |
| `drafts` | dashboard | lists the changes waiting to publish |
| `publish` | dashboard | validate exactly the given versions, `start_publish` pins them, `repository_dispatch` to `publish.yml` |
| `upload-start` | dashboard | a signed upload URL under `media/<workspace_id>/` (jpg, png, webp; 25 MB) |
| `upload-finish` | dashboard | records the media row, the rights tick and alt text, dispatches `media.yml` |
| `media-export` | runner, signed | hands the runner one original to process |
| `media-process-callback` | runner, signed | sets width, height, `exif_stripped`, `processed` |
| `export-published` | runner, signed | `freeze_snapshot` then the frozen rows, the contract, the media list and the site's Pages project |
| `job-callback` | runner, signed | `set_job_state` (409 on an illegal move) |
| `capture-lead` | the site's `/api/lead`, signed with that site's key | stores the lead (`5-crm.md`), sends the new-lead alert by Resend |
| `add-lead` | dashboard | a lead entered by hand, consent tick required |
| `lead-update` | dashboard | status, owner, unassign, note, mark read; `fields` edits any core or editable industry field (M14 `lead_set_fields`), 200 `{changed}` |
| `lead-export` | dashboard | CSV of the leads the caller may see, one column per core and industry field in form order; one `exported` event per lead |
| `lead-list` | dashboard | the CRM list on the server (M14 `lead_list`): search, filter, sort, page of at most 200, typed columns in form order; 422 `S-QUERY` for a key that is not a column |
| `leads-bulk` | dashboard | status, owner or delete for up to 500 leads, all or nothing (M14 `leads_bulk`); delete needs `confirm: true` (409 `S-CONFIRM`); a single delete is a bulk of one |
| `invite-member` | dashboard (owner) | creates or finds the login and adds the member; sends no mail yet |
| `settings-save` | dashboard (owner) | lead alert addresses and "also email the assigned agent"; also still carries the CRM webhook card, which is removed (`5-crm.md`) |
| `crm-test` | dashboard (owner) | sends a test to a CRM webhook; belongs to the dropped push and is removed |

Functions the book needs that do not exist (states in `1-product.md`): field edit and bulk edit for leads, saved views, CRM
layout save and export in a layout, import, delete a lead, unpublish, publish history and restore, team list and remove,
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
  E->>R: repository_dispatch {job_id, site_id}
  R->>E: export-published (signed)
  E->>D: freeze_snapshot, published_rows
  R->>R: build the site, run the gates
  alt every gate passes
    R->>S: wrangler pages deploy to the site's own project
    R->>R: smoke test (200, noindex on a preview, the home title)
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
- A failed job changes nothing live, and its versions are never shipped by a later job.
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
| `publish.yml` | `repository_dispatch` publish, or by hand | export, build, audit gate, Pages deploy, smoke, callback |
| `media.yml` | `repository_dispatch` media | photo processing |
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
| Supabase publishable key | dashboard build (public by design; RLS applies) | dashboard |
| Cloudflare deploy token, one for the account (Pages edit, DNS edit) | GitHub secret, held only by the runner | `publish.yml` |
| GitHub dispatch token (this repository only) | function environment | `publish`, `upload-finish` |
| Runner key | function environment and GitHub secret | runner calls |
| Site signing key, one per site | the site's Pages project and Vault; hash in `api_keys` | `/api/lead` to `capture-lead` |
| Resend key, alert sender | function environment | lead alert, sign-in mail through Supabase Auth SMTP |

Variable names a script expects: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` (suffix `_STAGING` or
`_PROD`), `STAGING_DB_URL`, `PROD_DB_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `RUNNER_KEY`,
`GITHUB_DISPATCH_TOKEN`, `RESEND_API_KEY`, `LEAD_ALERT_FROM`, `DASHBOARD_URL`, `SITE_SIGNING_KEY_<SLUG>` (minted by
`tools/mint-site-key.mjs`), `PLATFORM_FUNCTIONS_BASE`, `CLOUDFLARE_PAGES_TOKEN`. Production keys are used only with
`--i-mean-production`.

## Deploying the backend

`tools/apply-staging.mjs` applies migrations to staging and keeps a ledger with each file's sha256; it refuses a migration whose
content changed after it was applied. `tools/deploy-functions.mjs` deploys the Edge Functions. Production receives only what
staging proved, through the owner-run `promote` workflow (`2-architecture.md`).
