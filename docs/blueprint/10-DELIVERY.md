# 10 Delivery: repo, branches, CI/CD, environments, migrations, releases

## 1. Repo layout (one monorepo, npm workspaces)
```
contracts/            dependency-free ES modules (Node, Deno, browser) + tests        [exists]
supabase/             migrations/, functions/<name>/index.ts, tests/                   [schema + tests exist]
factory/              build.mjs, render/, launch/, gates/
sites/<slug>/         entities.json, design/, worker/
apps/dashboard/       React + Vite + TypeScript
docs/blueprint/       this package (diagrams, wireframes, ADRs, specs)
skills/  sops/  planning/  tools/                                                       [exist]
.github/workflows/    ci.yml, publish.yml, deploy-dashboard.yml, nightly.yml
```
Node 20 LTS for tools and the factory; Deno (Supabase runtime) for functions; one lockfile at the root.

## 2. Branching and reviews
- Trunk-based: `master` is always deployable to staging (DECISIONS 24, 27: the repo's only branch name is `master`); short-lived branches `feat/<wo-id>-<slug>`, `fix/...`, one work order per PR.
- PR template: work order id, FR/NFR rows touched, acceptance output pasted, watched-fail evidence, screenshots for UI.
- Reviews: 1 approval; **2 for migrations, RLS, functions holding the service role, the runner, and anything in `08-SECURITY.md`**.
- Squash merge; commit titles follow Conventional Commits 1.0.0 (`feat`, `fix`, `docs`, `chore`...; `!` or `BREAKING CHANGE:` for
  breaking changes), checked by commit-lint in CI; commits end with the attribution line the repo uses.
- Hosting is one free GitHub organisation account with one private repository (DECISIONS 27). On Free there is no branch protection
  for a private repository, no environments and no required reviewers, so nothing enforces "no direct push": the CI gates below run
  on every push and PR, and the production gate is our own code (section 5: the owner-run `promote` workflow, DECISIONS 29 D21).

## 3. CI pipeline (`ci.yml`, on every PR)
| Stage | Runs | Fails the PR when |
|---|---|---|
| 1 lint + format | ESLint, Prettier check, `deno lint` | any error |
| 2 typecheck | `tsc --noEmit` (dashboard), `deno check` (functions) | any error |
| 3 unit | Vitest, Deno test | any failure |
| 4 contract | `contracts/test/run.mjs`, `mutate.mjs`, `industry-run/run.mjs` | any failure or surviving mutant |
| 5 database | Postgres binaries on the runner (the script starts its own cluster): `supabase/tests/run-local.mjs` | any failure or surviving mutant |
| 6 specs | `docs/blueprint/specs/check-specs.mjs` | unresolved ref or untraced work order |
| 7 secrets + deps | gitleaks; `npm audit --omit=dev` (high/critical) | a finding |
| 8 build | dashboard `vite build`; factory build of the fixture site | build error |
| 9 gates | factory gates on the fixture site | any gate red |
| 10 preview | deploy dashboard preview (Pages preview deployment, `preview.<name>.pages.dev`) | deploy error |
On merge to `master`: migrate staging (`supabase db push`), `run-staging.mjs` (tenancy tests on staging, rolled back), deploy functions
and dashboard to staging, Playwright E2E on staging. Production: the owner runs the `promote` workflow, which lives in a separate
private production repository whose only workflow is promote (DECISIONS 29 D21; the working repository never holds a production
key). Two more parts of the gate: `supabase/apply-staging.mjs` refuses production unless given `--i-mean-production`, and production
receives only migrations already proven on staging (DECISIONS 27). Nothing relies on GitHub environments or required reviewers
(not available on Free private repositories).

## 4. Environments (DECISIONS 15: no Docker; one Supabase account, two projects)
| Environment | Database | Used for | Who changes it |
|---|---|---|---|
| local | plain Postgres 15+ with `supabase/tests/local-shim.sql` (Supabase's default grants, auth, storage, Realtime publication modelled) | every developer check and every PR gate; nothing needs an account | the developer |
| staging (Supabase project "testing") | real Supabase | every cloud acceptance in the build plan; E2E; tenancy tests via `run-staging.mjs` (rolled back, no fixtures left) | CI on merge to `master` |
| production (Supabase project "production") | real Supabase, Free plan, no PITR (own nightly dumps, section 5 and `18-BUDGET-ARCHITECTURE.md` 2.4) | clients | the owner-run `promote` workflow only |
Rules: no Docker anywhere (no `supabase start`); prod data never copied to staging or local; staging uses synthetic workspaces plus
an Example A copy seeded from the contract (no client leads); every environment has its own keys; preview hosts always noindex.

## 5. Migrations policy and promotion
- Supabase CLI migrations in `supabase/migrations/`, timestamped, forward-only; no editing a merged migration.
- Expand -> migrate -> contract: add new columns/tables first, backfill, switch code, remove old in a later release.
- Destructive changes (drop, type change) need an ADR, a backup point taken just before, and two reviewers.
- Every migration runs the RLS checklist (`08-SECURITY.md` 4) and the wall tests locally before merge.
- **Promotion to production** (only migrations already proven on staging):
  1. merge to `master` -> CI: `supabase db push` to **staging** -> `run-staging.mjs` (tenancy tests, rolled back) -> function deploy
     to staging -> E2E on staging. All green, or nothing moves.
  2. CI records the migration list proven on staging (the `supabase_migrations` history of staging) as the release candidate.
  3. **Owner approves** by running `promote` himself in the production repository with the exact commit id as the input (Abdo;
     DECISIONS 27, 29 D21).
  4. `promote` checks production's pending migrations equal the proven list (same files, same order), takes a dump as the backup
     point, runs `supabase db push` to **production** (the production database URL is used by nothing else), deploys the same
     function versions, runs read-only smoke checks.
  5. **Rollback:** a forward fix promoted the same way; data loss -> restore the last dump into a new project, verify with the
     tenancy tests, switch (runbook R3). Supabase Free has no PITR: backups are our own nightly `pg_dump` of production to R2 plus a
     second copy at another provider, kept 30 days, with a monthly restore drill into a throwaway local Postgres; recovery
     objectives (D17): at most 24 hours of data lost, back within 4 hours (DECISIONS 29, `18-BUDGET-ARCHITECTURE.md` 2.4).
     Never restore over production without the owner.
- Contract versions are data, not migrations: a new `site_contracts` version is activated by staff; activation is refused if
  existing published rows fail it (dry-run report first).

## 6. Releases and rollback
| Thing | Release | Rollback |
|---|---|---|
| Dashboard | CI deploy to the `app` Pages project (a new Pages deployment) | redeploy the previous Pages deployment (Cloudflare dashboard, or `wrangler pages deployment` tooling) |
| Edge Functions | `supabase functions deploy` from CI | redeploy the previous tag |
| Database | migration via CI | forward fix; restore the last dump into a new project only for data loss (runbook R3) |
| Client site | publish job deploys a new deployment to the site's Pages project | redeploy the previous Pages deployment (runbook R3), or restore content versions and publish |
| Contract | staff activates version n+1 | activate version n |
Versioning: Semantic Versioning 2.0.0 (`vMAJOR.MINOR.PATCH`), bumped from the Conventional Commits since the last tag (`feat` ->
MINOR, `fix` -> PATCH, breaking -> MAJOR); release notes list work orders and FR rows delivered.

## 7. Feature flags
A `feature_flags(workspace_id null = global, key, enabled)` table read by the dashboard and functions; used for: AI operators,
OmniSuite adapter (off until its API exists), visibility panels, any new section kind. Flags are removed within two releases
after a feature is on everywhere.

## 8. Secure development practices (NIST SP 800-218 SSDF 1.1; Rev. 1 = SSDF 1.2 is an initial public draft of 2025-12-17, recheck when final)
| SSDF practice | In this project |
|---|---|
| PO.1 security requirements; PO.2 roles | `08-SECURITY.md` (ASVS L2), RACI in `05-BUILD-PLAN.md` |
| PO.3 toolchains; PO.4 criteria for security checks | CI stages 1-10 (section 3), required gates (`09-TEST-STRATEGY.md` 2) |
| PO.5 secure environments | separate staging/prod projects and tokens; no prod data outside prod |
| PS.1 protect code; PS.2 release integrity; PS.3 archive releases | the promote gate (section 3; no branch protection on Free private repositories), two-person review where a second engineer exists; signed tags; Pages deployments kept (rollback by redeploying a previous one) |
| PW.1 design to requirements; PW.2 design review | ADRs, threat model, security review on trust-boundary changes |
| PW.4 reuse well-secured software | dependency policy (lockfile, pins, 7-day rule, audit) |
| PW.5 secure coding; PW.6 build config; PW.7 code review; PW.8 test | lint/typecheck, reproducible builds (`npm ci`), reviews, test pyramid with mutants |
| PW.9 secure defaults | RLS on, bucket private, previews noindex, forms fail closed |
| RV.1-RV.3 respond to vulnerabilities | runbook R2, postmortems with a test added for the root cause |

## 9. Delivery metrics (DORA, https://dora.dev/guides/dora-metrics/)
Measured monthly from GitHub and `publish_jobs`: change lead time, deployment frequency, failed deployment recovery time, change
fail rate, deployment rework rate. Reported with the SLO report (`11-OPERATIONS.md`).

## 10. The Twelve-Factor App (https://12factor.net/)
I one codebase (this monorepo); II dependencies declared (lockfile); III config in the environment (secrets in GitHub repository
secrets / Vault, never in code); IV backing services attached by URL (Supabase, Cloudflare, OmniSuite); V build, release, run separated (CI
build -> Pages deployment -> run); VI stateless processes (functions, runner); VII port binding: n/a for static sites and
serverless (deviation by platform design); VIII concurrency by job queues; IX disposability (idempotent jobs); X dev/prod parity
(local Postgres + same migration; staging mirrors prod); XI logs as event streams (JSON logs); XII admin processes as one-off
scripts in the repo (seed-workspace, restore drill).
