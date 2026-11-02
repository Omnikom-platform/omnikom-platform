# 20 The shape: how GitHub is used, how every client site lives on one Cloudflare account, and how the parts talk

Written 2026-10-29 for the owner ("let's decide the shape first"). Facts read from the vendors' pages on 2026-10-29 are marked
with the page; everything else is design. Diagram: `diagrams/14-shape.png`. Decisions this needs from the owner: section 6.

## 1. One sentence
One private GitHub repo holds the platform and builds every site; one Supabase project per environment holds every client's
data behind the database wall; one Cloudflare account hosts every client site as its own Pages project under its own domain
(zone) in that account; the only things that ever talk across those three are signed machine calls and one dispatch.

## 2. GitHub: one repository, the runner, nothing of the client's
- **One private repository** (`omnikom-platform`, this repo) in an Omnikom organisation. It holds: the migrations, the Edge
  Functions, the website factory and gates, the dashboard app, the tools, the docs, and one folder per site with its design
  package (`sites/<slug>/design/`: tokens, partials, shell). Client CONTENT is never in git: it lives in the database as
  versions. So a client's words are never in a commit, and one repo serves a hundred clients.
- **Why not a repo per client:** every site would need its own secrets, its own CI, its own copy of the gates, and a fix to the
  factory would have to land a hundred times. The thing that differs per client (content, design package) is data or one folder.
- **GitHub Actions is the build runner** (ADR 0004): it is the only place with a headless Chrome for the gates and a Node
  toolchain, it is free for 2,000 minutes a month on private repos (GitHub plans page, read earlier; re-read before W0.2), and
  every build is a logged job. Workflows: `ci.yml` (every PR: contract + wall tests with mutants, spec check, deno check,
  dashboard build, gitleaks), `publish.yml` (one site build per job, dispatched by the platform), `media.yml` (photo sizes),
  `backup.yml` (nightly dump to R2), `keepalive.yml` (weekly staging tests), `usage.yml` (weekly budget pull).
- **Branches and promotion:** `master` is protected (PR + green CI + one review). Merge deploys to STAGING automatically
  (migrations through `apply-staging.mjs`, functions, dashboard). PRODUCTION gets exactly the same commit only when the owner
  runs the `promote` workflow by hand (a `workflow_dispatch` with the commit id; branch protection means nobody else can).
  On the GitHub Free plan, private repos have no "environments with required reviewers", so the owner-only manual run is the
  gate; secrets are repository secrets with `STAGING_` and `PROD_` prefixes (UNVERIFIED which plan features apply to this org:
  re-read the plans page at W0.2; Team is $4 per user per month if environments are wanted).
- **Secrets in GitHub:** the runner key (signs runner -> platform calls), the Supabase secret key per environment (migrations),
  the Cloudflare deploy token (section 3), the R2 backup credentials. Never a client key, never the site signing keys (those
  live in Vault and on the site's Pages project).
- **Minutes budget:** a site build is minutes (ELEV8: UNPROVEN until W1.5, estimate 3 to 5). 2,000 free minutes is roughly 400
  builds a month across all clients; the trigger to a paid plan is 1,500 minutes used in a month (`usage.yml`).

## 3. Cloudflare: one account, one Pages project per site, one zone per client domain
- **The account** is Omnikom's (DECISIONS 7, 9, 11). It holds: one **Pages project per client site** (`<slug>-omnikom-website`,
  what the ELEV8 and Rainmaker previews use today), the **dashboard** as one more Pages project (`app`), the **media host**
  (R2 bucket with a custom domain, D9), and one **zone per client domain** that we serve.
- **Why Pages per site, not a Worker per site (this reverses ADR 0002):** ADR 0002 chose Workers because Pages project
  creation failed on this account on 2026-10-23; it works now (`deploy-pages.mjs` created `elev8-omnikom-website`). Pages gives
  what the platform needs for free: a project-named address (`<name>.pages.dev`, no personal account name, the owner's rule),
  **preview deployments per branch** (the "preview site" of `16-DESIGN-PARTS.md` 2.3 is `wrangler pages deploy --branch preview`:
  a fixed `preview.<name>.pages.dev` address, no second project, no extra Worker slot), Pages Functions for `/api/lead` (the
  endpoint is built and tested, `factory/worker/`), custom domains from an external DNS for `www`, and 100 custom domains per
  project. Workers would give per-Worker deploy tokens (finer than Pages' account-level "Pages: Edit" permission, UNVERIFIED
  whether Pages tokens can be narrowed per project) and 100,000 files per site instead of 20,000; neither matters before a
  hundred sites. Limits that bind (https://developers.cloudflare.com/pages/platform/limits/, read 2026-10-29): 100 Pages
  projects per account (so about 95 client sites per account; the next account is the horizontal step), 20,000 files per site
  on Free (ELEV8 is 259), 500 builds a month (git-triggered builds only; our direct uploads from the runner are not documented
  as counting: UNVERIFIED), 25 MiB per file, requests to Pages Functions count toward the Workers quota (100,000 a day on Free,
  `18-BUDGET-ARCHITECTURE.md` 2.5), static files do not.
- **The deploy token:** one Cloudflare API token with "Cloudflare Pages: Edit" on the account (plus "Zone: DNS: Edit" for
  domain onboarding), held only by the runner as a GitHub secret. The job's target project comes from the site row in the
  export, never from the request; the runner refuses a mismatch. The tradeoff against per-site tokens is accepted and written
  here: the runner is trusted (ADR 0011) and is the only holder.
- **Client domains (DECISIONS 9: the client keeps the domain):** the client keeps the registrar account and ownership; they
  point the **nameservers** to our Cloudflare account, which makes the domain a zone there (free plan). Then `elev8ca.com` and
  `www.elev8ca.com` both serve the Pages project, Cloudflare manages the DNS (we add their mail records exactly as they were,
  checked by the launch ledger L-B), and leaving means pointing the nameservers back. Facts (custom domains page, read
  2026-10-29): an external-DNS CNAME works for a subdomain such as `www`, "To deploy your Pages project to a custom apex
  domain, that custom domain must be a zone on the Cloudflare account". So the fallback for a client who will not move
  nameservers: `www` by CNAME from their DNS, and the bare domain redirected to `www` at their registrar (most registrars do
  this; it is the client's step, OWNER-PROOF in the ledger).
- **Previews:** every site has `<name>.pages.dev` (noindex until launch) and `preview.<name>.pages.dev` for the dashboard's
  preview job. The live domain is attached last (DECISIONS 2, 19).

## 4. How the parts talk (the only crossings there are)
| From | To | How | Credential | Built? |
|---|---|---|---|---|
| Visitor's browser | the site (Pages) | static files | none | yes (ELEV8, Rainmaker previews) |
| Form on the site | the site's `/api/lead` (Pages Function) | same-origin POST | none (honeypot, size cap) | yes, tested |
| `/api/lead` | platform `capture-lead` (Supabase Edge Function) | HTTPS POST, body signed | the site's key (Vault + registry) | yes, tested; UNPROVEN on a project |
| `capture-lead` | Postgres | direct connection, `service.*` functions | the function's own DB URL | yes |
| `capture-lead` | Resend | HTTPS | Resend key (function secret) | yes, UNPROVEN |
| Dashboard (Pages `app`) | Supabase Auth, Data API (RLS), Edge Functions `save`, `publish`, `lead-update`, `add-lead` | supabase-js over HTTPS | the person's JWT | functions SPEC; dashboard SPEC |
| `publish` function | GitHub | `repository_dispatch` (`publish.yml`) | GitHub token (function secret, this repo only) | SPEC |
| Runner (Actions) | platform `export-published`, `job-callback`, `media-process-callback` | HTTPS, signed | the runner key | SPEC |
| Runner | Cloudflare Pages | `wrangler pages deploy` to the job's project | the account deploy token | SPEC (the preview deploy script is the precedent) |
| Runner | R2 | media sizes, backups | R2 token (GitHub secret) | SPEC |
| Postgres cron (pg_cron) | `push-lead`, `metrics-pull`, `send-alert` consumers | pg_net HTTPS | the internal cron secret (Vault) | SPEC |
| Providers (OmniSuite, SMS, payments) | `webhook-inbox` | HTTPS, signed per provider | per connector key | SPEC (table built) |
| Staff or CI | Postgres (migrations) | `apply-staging.mjs` over the DB URL | the DB URL by name | yes, tested locally |
Nothing else crosses. Two clients never share a path except through RLS-filtered rows. The site never talks to the database.
The dashboard never holds a server secret. The runner never reads anything but one job's frozen snapshot.

## 5. Environments, in one table
| | Staging | Production |
|---|---|---|
| Supabase | project 1 (Free): every migration first, every cloud test, the e2e lead proof | project 2 (Free): only commits promoted by the owner |
| Cloudflare | the same account; each site's `preview` branch and `<name>.pages.dev` | the same account; the site's `production` branch and its custom domain |
| GitHub | merge to `master` | the owner's manual `promote` run |
| Dashboard | `app-staging` Pages project | `app` Pages project on `app.<omnikom domain>` (D3) |
| Email | Resend Free, same key, `LEAD_ALERT_FROM` on the verified Omnikom domain | same |

## 6. What the owner decides (asked as options)
S1 Pages per site (recommended, section 3) or a Worker per site (ADR 0002). S2 Client domains: nameservers to our account
(recommended) or CNAME `www` plus a registrar redirect. S3 GitHub: one repo in an Omnikom org on the Free plan with the
owner-only promote run (recommended) or Team with environments and required reviewers. These become DECISIONS entries and
the ADR 0002 revision the same day.
