# 18 Budget architecture: the free tiers, what they force, and the measured trigger for each upgrade

Written 2026-10-29 (DECISIONS 22). Every number below was read from the vendor's own page on 2026-10-29; the page is named next
to it. A number without a page is marked ESTIMATE. When a vendor changes a number, this file is wrong until it is re-read.

## 1. The limits that shape the design
### Supabase Free (https://supabase.com/pricing, read 2026-10-29)
| Limit | Free | Pro ($25/month) | What it means for us |
|---|---|---|---|
| Active projects | 2 | | exactly staging + production (DECISIONS 15); no third project (no per-client projects, ever: one multi-tenant database, ADR 0001) |
| Pausing | paused after 1 week of inactivity | | staging must be touched weekly or it pauses (section 2.1) |
| Database size | 500 MB | 8 GB disk | content versions are the only thing that grows (section 2.2) |
| Egress | 5 GB / month | 250 GB | builds must not download every photo on every publish (section 2.3) |
| File storage | 1 GB, 50 MB per file | 100 GB | originals and derivatives do not fit for long: media goes to R2 (section 2.3) |
| Monthly active users | 50,000 | 100,000 | not a constraint for years (clients' staff only; visitors never log in) |
| Edge Function invocations | 500,000 / month | 2 million | a lead costs about 3 (capture, alert, push); a publish about 4; fine until thousands of leads a day |
| Realtime | 2 million messages / month, 200 concurrent connections | 5 million, 500 | 200 dashboards open at once is the ceiling; the dashboard opens one channel per workspace, not per screen |
| Log retention | 1 day | 7 days | our own tables are the log (`audit_log`, `lead_events`, `publish_job_events`); nothing relies on vendor logs |
| Backups | none | daily, 7 days | we take our own (section 2.4) |
| Support | community | email | |
Edge Function runtime (https://supabase.com/docs/guides/functions/limits, read 2026-10-29): 2 s CPU time per request, 256 MB
memory, 150 s request idle timeout, 150 s wall clock on Free (400 s on paid), 100 functions per project on Free. So: nothing
heavy in a function (image processing is in the GitHub runner, `02-BACKEND.md` 5); every function answers in well under a second
and hands long work to a queue.

### Cloudflare Workers Free (https://developers.cloudflare.com/workers/platform/limits/, read 2026-10-29)
| Limit | Free | Paid | What it means for us |
|---|---|---|---|
| Requests / day (Worker script invocations) | 100,000 per account | unlimited | ALL client sites share it; only `/api/lead` and the dashboard app's shell invoke a script (section 2.5) |
| Static asset requests | free and unlimited (https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) | | pages, images, CSS, JS of every site cost nothing and do not count |
| CPU time / invocation | 10 ms | 30 s default | the lead Worker signs one HMAC and forwards: well under 10 ms (UNPROVEN until measured in W2.4) |
| Workers per account | 100 | 500 | one Worker per site plus the dashboard: about 95 sites on Free if staging sites are not separate Workers (section 2.5) |
| Static assets | 20,000 files per Worker version, 25 MiB per file | 100,000 files | ELEV8 preview is 259 files; a 1,000-page site with 5 image sizes is about 6,000 files: fits |
| Cron Triggers | 5 per account | 250 | we use none on Cloudflare; schedules live in pg_cron |
| Environment variables | 64 per Worker, 5 KB each | 128 | a site Worker holds 3 (site id, signing key, platform base URL) |
Queues (https://developers.cloudflare.com/queues/platform/pricing/, read 2026-10-29): 10,000 operations / day on Free. We do not
use Cloudflare Queues (pgmq in Postgres instead); it stays a fallback.
R2 (https://developers.cloudflare.com/r2/pricing/, read 2026-10-29): 10 GB-month storage, 1 million Class A and 10 million
Class B operations per month, egress to the Internet free. This is where media goes (section 2.3).

### Resend Free (https://resend.com/pricing, read 2026-10-29)
3,000 emails / month, 100 / day, 3 domains, 30 days retention; Pro $20 / month: 50,000 / month, no daily limit, 10 domains.
100 a day covers sign-in links, invites and lead alerts for the first clients; the trigger to Pro is 80 sent in one day
(section 3). Each client's alerts go out from Omnikom's domain with the client's name in the From name, so "3 domains" never
binds.

## 2. What the design does to stay inside
### 2.1 Staging never pauses
A GitHub Actions schedule runs `supabase/tests/run-staging.mjs` on staging every Monday (the tenancy tests, rolled back). That is
real activity; staging stays awake and the walls are re-proven weekly for free. If a run finds staging paused, it resumes it
through the management API and the run fails loudly (alert R1).

### 2.2 The database stays small
What grows: `content_versions` (every save, append-only, DECISIONS 6), `lead_events`, `audit_log`, `metrics_snapshots`.
| Table | ESTIMATE per row | ESTIMATE growth | Rule |
|---|---|---|---|
| `content_versions` | 2 to 20 KB (a page with sections) | a busy client: 300 saves / month = 3 MB / month; 20 clients = 60 MB / month | autosave versions older than 90 days by the same person within 10 minutes of each other collapse to the last one (a `service.compact_versions` cron, PROPOSED); every published version is kept forever; a version a job pinned is never removed. Result: under 1 MB per client per month after compaction |
| `lead_events` | under 1 KB | 10 per lead; 1,000 leads / month = 10 MB / year | kept 24 months with the lead (D6) |
| `audit_log` | under 1 KB | 1 per save, publish, sign-off | 24 months, then rows older than that are exported to R2 as JSON lines and deleted (PROPOSED cron) |
| `metrics_snapshots` | 5 to 50 KB (top queries, pages) | 4 sources x 365 days x 50 KB = 70 MB / client / year worst case | keep 90 days of daily rows, then one row per week (PROPOSED), under 10 MB per client per year |
| everything else | | hundreds of rows per client | negligible |
So 500 MB holds about 100 clients for 2 years with the compaction rules; the measured trigger to Pro is 350 MB (section 3).
Postgres practice that keeps queries cheap at that size (`supabase-postgres-best-practices`): every tenant table is indexed on
`(workspace_id, ...)` first; jsonb expression indexes only when a collection grows past 1,000 rows; no `select *` in functions;
`explain analyze` pasted in the PR for any query over a growing table.

### 2.3 Media lives in R2, the database holds the record
Why: Supabase Free gives 1 GB of files and 5 GB egress; one real-estate client with 300 photos at 2 MB is 600 MB before any
derivative; every publish copies the referenced media into the build (`03-FRONTEND.md` A3), and 50 publishes of a 100 MB site
is the whole monthly egress. R2 gives 10 GB and free egress.
Design (changes `02-BACKEND.md` section 5; owner decision D9 below):
- `media.path` stays the key; the object lives in an R2 bucket `media` under `<workspace_id>/<media_id>/original.<ext>` and
  `<media_id>/{2400,1600,800}.webp`. `upload-start` returns an R2 presigned PUT URL (the Edge Function signs it with the R2
  credentials from Vault; the browser uploads straight to R2, no bytes through the function). The folder rule and the RLS on
  `media` stay exactly as tested (the wall is the `media` row, which the build and the dashboard consult before touching a key).
- The GitHub runner (`media.yml`) reads the original from R2, writes the WebP sizes back to R2, calls `media-process-callback`.
- The build does not copy media into the Worker's static assets at all: the site's `<img>` points at the media host
  (`media.<omnikom domain>` in front of R2, Cloudflare cache in front, free egress). Fewer static files per site, builds are
  faster, a photo changed in the dashboard is live on the next publish without re-uploading bytes.
- The 25 MB per-file cap and the EXIF strip stay. Storage policies on `storage.objects` are dropped in favour of the R2 path
  rule (the `media` row is the authority; a key not in `media` is never linked).
- Cost on Free: 10 GB = about 15 clients with 300 photos each and 3 sizes; the trigger is 8 GB (R2 is $0.015 per GB-month after).

### 2.4 Backups we own (Free has none)
Nightly GitHub Action: `pg_dump` of production (schema + data, excluding `auth` and `storage` schemas) to R2 under
`backups/<date>.sql.gz` (ESTIMATE under 100 MB compressed for 100 clients), kept 30 days, plus a weekly copy kept a year. A
monthly restore drill into a throwaway local Postgres (`run-local.mjs` pattern) proves the dump loads and the tenancy tests
pass on it; the run's output is pasted in `PROGRESS.md`. Vault secrets are not in a dump (`08-SECURITY.md` 3): the `api_keys`
registry lists what must be re-entered after a restore.

### 2.5 Worker requests stay far under 100,000 a day
Only two things invoke a Worker script: `/api/lead` on each site (one request per lead, plus bot noise) and the dashboard app's
shell (one request per page load; the app is a static bundle, so the data requests go to Supabase, not to a Worker). Every page,
image, stylesheet and script of every client site is a static asset: free and uncounted. So 100,000 a day is about 100,000
form submissions plus dashboard loads a day across all clients: not a ceiling for years. Bot floods on `/api/lead` are the one
risk: the rate limit (`sops/site-endpoints.md` 2.4) answers 429 cheaply, and a WAF rule on `/api/*` blocks known bots before the
Worker runs. Workers per account: one per site plus `app` plus `media`; staging sites are not separate Workers on Free (a
staging build of a site deploys to the same Worker's preview URL, `wrangler versions upload`, which costs no Worker slot);
the trigger to Paid ($5 / month) is 90 Workers or any 429 from the daily limit.

### 2.6 Schedules and queues in Postgres, not in the vendors
pg_cron (every 5 min: reaper; every 15 min: push retries; daily: metrics pull, version compaction; weekly: staging keep-alive is
GitHub) and pgmq for the lead push, alert and metrics queues. Both are extensions inside the one database: no Cloudflare cron, no
Cloudflare Queues, no third service. Every queue consumer is an Edge Function called by pg_net with the cron secret, handling
one message per call, finishing in seconds (the 150 s wall clock).

### 2.7 Email on Free
Sign-in links, invites and lead alerts through Resend. A daily counter in `messages` (migration 3) stops at 95 a day and queues
the rest for the next day with an alert to staff; lead alerts go first, invites second, digests last.

## 3. The upgrade triggers (measured, not guessed)
| Trigger (measured by) | Action | Cost |
|---|---|---|
| production database over 350 MB (`metrics-pull` writes `pg_database_size` daily to `metrics_snapshots` source `uptime`) | Supabase Pro for production only | $25 / month |
| any day with more than 80 emails sent (`messages` count) | Resend Pro | $20 / month |
| R2 over 8 GB (R2 usage API, weekly) | nothing to do: R2 bills per GB beyond | about $0.015 per GB-month |
| 90 Workers, or any 429 from the 100,000 / day limit (Cloudflare analytics, weekly) | Workers Paid | $5 / month |
| Edge Function invocations over 400,000 / month (Supabase usage, weekly) | Supabase Pro | included above |
| Realtime over 150 concurrent (Supabase usage) | Supabase Pro | included above |
Each trigger is one line in the staff admin's "Budget" card (PROPOSED), read from the weekly usage pull; nothing is upgraded
without the owner's click (CLAUDE.md 6).

## 4. Decision for the owner
D9 (recommended): media in Cloudflare R2 instead of Supabase Storage (section 2.3). Reason: 10 GB and free egress against 1 GB
and 5 GB egress; the tenancy wall is unchanged because the `media` row stays the authority. Alternative: keep Supabase Storage
and go Pro ($25 / month) at the first client with more than 300 photos. Needs: an R2 bucket, an R2 API token in Vault, the
`media` host, and `02-BACKEND.md` section 5 rewritten; the migration keeps the `media` table as is.

## 5. What is UNPROVEN here
The per-row size estimates (measure on ELEV8's rows once seeded); the lead Worker's CPU time (measure in W2.4); that
`wrangler versions upload` preview URLs serve static assets without a Worker slot (read the docs again before W0.4); whether
pg_cron and pgmq are enabled on a Free project without a support ticket (check at W0.3); the R2 presigned PUT from an Edge
Function (W3.2).
