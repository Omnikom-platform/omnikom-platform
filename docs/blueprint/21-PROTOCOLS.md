# 21 Protocols: how the platform, Cloudflare and GitHub talk, with the vendor's own page behind every fact

Written 2026-10-29 from three fact packets read off docs.github.com, developers.cloudflare.com and supabase.com/docs the same
day (Haiku readers; quotes kept short; every row names its page). "UNVERIFIED" means the page did not say it: it is tested
on the first real project before anything depends on it (section 7). Shape: `20-SHAPE.md`. Decisions: DECISIONS 26, 27, 28.

## 1. Platform -> GitHub: starting a build
| Fact | Value | Source (read 2026-10-29) |
|---|---|---|
| Trigger | `POST /repos/{owner}/{repo}/dispatches` with `event_type` (100 chars max) and `client_payload` (at most 10 top-level keys, under 64 KB) | docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event |
| Which workflow runs | only a workflow file on the DEFAULT branch | docs.github.com/.../events-that-trigger-workflows |
| Token | classic PAT needs `repo`; fine-grained PAT and GitHub App permission names UNVERIFIED (test at W0.2; expected: Contents read and write) | same page |
| Rate limit | 5,000 requests per hour per PAT or App installation; 100 concurrent; 900 points per minute | docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
| Concurrency | `concurrency: { group, cancel-in-progress }`; by default at most ONE pending run per group and a new one replaces it; `queue: max` keeps up to 100 pending | docs.github.com/en/actions/using-jobs/using-concurrency |
| Job limits | 6 hours per job; 35 days per workflow run | docs.github.com/en/actions/reference/limits |
Protocol: the `publish` Edge Function sends `{ event_type: "publish", client_payload: { job_id, site_id } }` and nothing else;
the runner reads everything from the export. `publish.yml` sets `concurrency: { group: site-<site_id>, queue: max }` so no
publish is dropped; the group name is unique across workflows. The dispatch token is a fine-grained token for this one repo
(permission to be confirmed at W0.2), stored as a function secret, rotated every 90 days.

## 2. Runner -> platform: the export and the callbacks
Signed with the runner key (`signature.ts`: `t\nMETHOD\npath?query\nbody`, 300 s), `verify_jwt = false` on those functions,
each verifies the header in code before reading the body (Supabase: "with a secret key on the apikey header rather than a user
JWT" is the documented service-call case; we use our own HMAC header instead and ignore `apikey`). The runner's last step posts
`job-callback` with `{ job, state, gateReport, deployId, error }`; a `workflow_run` completed event is the only native signal,
so the callback is our own step (a job that dies before it is reaped by `reap_stale_jobs` after 30 minutes idle).

## 3. Runner -> Cloudflare: deploying one site
| Fact | Value | Source |
|---|---|---|
| Deploy | `npx wrangler pages deploy <dir> --project-name <name> [--branch <name>]`; or `POST /accounts/{account_id}/pages/projects/{project}/deployments` with a Direct Upload `manifest` | developers.cloudflare.com/pages/get-started/direct-upload/ and the Pages API reference |
| Addresses | production: `<project>.pages.dev` (the `main` example); every deployment also `<hash>.<project>.pages.dev`; a branch deploy `<branch>.<project>.pages.dev` | .../pages/configuration/preview-deployments/ |
| Limits | 100 projects per account; 20,000 files per site on Free; 25 MiB per file; 500 builds a month (documented for git-triggered builds; direct uploads UNVERIFIED) | .../pages/platform/limits/ |
| Token | account-level permission for Pages (name and per-project scoping UNVERIFIED); 500 account tokens; API 1,200 requests per 5 minutes per user, then 429 for 5 minutes | .../fundamentals/api/reference/limits/, .../create-token/ |
| Functions | `/api/lead` requests count toward the Workers Free quota (100,000 a day, reset midnight UTC); static files do not; variables and encrypted secrets per environment (production, preview) | .../pages/functions/pricing/, .../pages/functions/bindings/ |
Protocol: the job's `kind` picks the branch: `live` -> no `--branch` (production), `preview` -> `--branch preview` (a fixed
`preview.<project>.pages.dev`). The project name comes from `sites.deploy_target`, read from the export; the runner refuses a
mismatch with `client_payload.site_id`. Deploys are spaced so the account stays under 1,200 API calls per 5 minutes (a deploy is
a handful of calls; 100 sites publishing at once would still fit). The site's `SITE_ID`, `PLATFORM_BASE` (variables) and
`SITE_SIGNING_KEY` (encrypted secret) are set on the project once at onboarding, per environment.

## 4. Client domains: zones in the account
| Fact | Value | Source |
|---|---|---|
| Create a zone | `POST /zones` with `name` and `account`; `type` `full` ("DNS is hosted with Cloudflare"); the response carries `name_servers` | developers.cloudflare.com/api/resources/zones/methods/create/ |
| Attach to Pages | `POST /accounts/{account_id}/pages/projects/{project}/domains` with `name` | Pages API, domains create |
| Apex vs www | apex needs the zone in the account; a subdomain can be a CNAME to `<project>.pages.dev` from any DNS; add the domain in Pages BEFORE the CNAME or the site answers 522 | .../pages/configuration/custom-domains/ |
Protocol (onboarding, staff): create the zone -> show the two nameservers to the client (question sheet) -> when the zone is
active, copy the mail records (the ledger checks them) -> add `<domain>` and `www.<domain>` to the Pages project -> launch
attaches the domain last (DECISIONS 2, 19). Pending-nameserver state handling: UNVERIFIED (read the zone status field at W0.4).

## 5. Site -> platform -> database -> mail: the lead
| Fact | Value | Source |
|---|---|---|
| Function URL | `https://<ref>.supabase.co/functions/v1/<name>`; the path a function sees in `req.url` UNVERIFIED (`pathForSignature` accepts both forms) | supabase.com/docs/guides/functions/quickstart |
| No user JWT | `verify_jwt = false` per function in `config.toml` ("will allow anyone to invoke" so the function must check its own credential) | .../functions/function-configuration |
| Secrets | `supabase secrets set NAME=value`; defaults inside a function: `SUPABASE_URL`, `SUPABASE_DB_URL`, the keys | .../functions/secrets |
| Database from a function | transaction-mode pooler on port 6543, prepared statements off; direct connections are IPv6 | .../database/connecting-to-postgres |
| Limits | 2 s CPU, 256 MB, 150 s wall clock on Free, 100 functions | .../functions/limits |
| Vault | `vault.create_secret`, `vault.decrypted_secrets`; secrets do not survive a manual dump into another project | .../database/vault |
| Auth mail | default sender 2 messages an hour; custom SMTP required ("we urge all customers"); after custom SMTP a 30 per hour limit is quoted | .../auth/auth-smtp, .../auth/rate-limits |
| Keys | publishable and secret keys; legacy `anon` and `service_role` deprecated by end of 2026 | .../api/api-keys |
| Realtime | authorises every change per subscriber; Free: 200 concurrent, 100 messages a second | .../realtime/postgres-changes, .../realtime/limits |
| Queues and cron | `pgmq` behind Supabase Queues (needs Postgres 15.6.1.143+); `pg_net` for HTTP from SQL; pg_cron precision "up to a minute" on one page, "every second" on another; Free availability UNVERIFIED | .../queues, .../database/extensions/pg_net, .../guides/cron |
| Pausing | low activity in a 7-day period may pause a Free project; paused projects do not count toward the two-project limit | .../platform/going-into-prod, .../platform/billing-on-supabase |
Protocol: `capture-lead` connects with `SUPABASE_DB_URL` through the pooler (`prepare: false` is already set in the code),
verifies `X-Site-Signature` against the site's keys from `api_keys` + Vault, stores through `service.capture_lead`, and sends
the alert through Resend (section 6). The dashboard uses the publishable key and the person's JWT; staff MFA is the `aal2`
claim. The weekly `keepalive.yml` keeps staging un-paused.

## 6. Mail: Resend
Free: 3,000 a month, 100 a day, 3 domains (resend.com/pricing, read 2026-10-29). Protocol: one verified Omnikom sending domain;
alerts from `LEAD_ALERT_FROM` with the client's name as the display name; `platform_limits.email_per_day` = 95; Supabase Auth
mail goes through the same account as custom SMTP (D5). Delivery receipts by Resend webhook into `webhook-inbox` (SPEC).

## 7. What the first real project must prove (in this order, each a pasted output)
1. `apply-staging.mjs` applies the three migrations and `run-staging.mjs` passes on staging (walls on real Supabase defaults,
   Storage policies, `alter publication` on the real publication).
2. `capture-lead` deployed: the signed path string matches (`req.url` form), the pooler connection works from Deno with
   `npm:postgres`, Vault reads work with the function's role.
3. The Pages project with the two endpoint files and its secrets answers the e2e test; the alert arrives; the test lead is removed.
4. `pg_cron` and `pgmq` enable on Free; a one-minute job runs; `pg_net` reaches a function with the cron secret.
5. One direct-upload deploy from Actions: the dispatch token's permission, the Pages token's permission, and whether the deploy
   counted as a build (dashboard usage).
6. Zone creation by API, the nameserver list, and attaching apex + www to a Pages project (on a test domain the owner owns).
7. Budget pull: the Supabase usage and Cloudflare analytics endpoints for `usage.yml` (UNVERIFIED endpoints).

## 8. Engineering rules that follow from the facts
- Every machine call carries our HMAC header; vendor "apikey" style checks are never relied on for authorisation.
- Every dispatch and callback is idempotent by job id; every lead by idempotency key; every webhook by provider event id.
- No long work in an Edge Function (2 s CPU): build, images, dumps run in Actions; functions only check, store, enqueue, answer.
- Budgets are counted in our tables (`messages`, `metrics_snapshots`), never read back from vendor logs (1-day retention).
- Secrets: function secrets (Supabase), encrypted variables (Pages), repository secrets (GitHub), Vault (per-site and per-client);
  never in a tracked file; the scanner runs on every commit and on the pushed range.
