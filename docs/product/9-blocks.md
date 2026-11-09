# Building blocks

Each block: its job, what goes in, what comes out, and the department that owns its files (charters in `docs/departments/`;
`node tools/departments/check.mjs` fails when a path has two owners). The code map in `icm/` links every source file to a
feature row in `1-product.md`.

## Product blocks

| Block | Job | In | Out | Owner |
|---|---|---|---|---|
| `supabase/migrations/` | the schema, the walls, the service functions (`3-database.md`) | SQL | the database | platform build |
| `supabase/functions/` | the Edge Functions (`4-backend.md`) | a signed or JWT call | a database change, a dispatch, a CSV | platform build |
| `supabase/tests/` | wall tests and mutants, the port map | migrations | PASS or the wall that leaked | platform build |
| `supabase/auth-emails/` | the sign-in mail templates and their plan check | plan rows | HTML mail | platform build |
| `supabase/ops/` | alerts, backup, restore drill | the staging database | alerts, encrypted dumps | platform build |
| `apps/dashboard/` | the user dashboard: CRM and dashboard screens (`5-crm.md`, `6-dashboard.md`) | the user's clicks | function calls, RLS reads | platform build |
| `contracts/` | generate, validate, store and place the content contract (`7-sites.md`) | an approved plan and entities | a contract; validation codes | platform build |
| `factory/` | build a site, the lead endpoint, the publish and media runners | an export and a look folder | a folder of static files; a deploy | platform build |
| `sites/<slug>/` | a site's look folder and plan; `sites/test-demo-a/` is the test site | design work | partials and tokens | platform build |
| `tools/crm-map/` | propose, export and import in a client's CRM layout (`5-crm.md`) | their headers, our leads, their file | a template, CSV rows, leads | CLI and testing |
| `tools/audit/` | the audit engine: one check per measurable rule, run on a built folder or a polite snapshot | a built site | PASS or FAIL per rule | SEO and audits |
| `skills/programmatic-enterprise-web-performance/` | the SEO skill: research, prompt map, plan, launch ledger | public data | a plan, a ledger | SEO and audits |
| `tools/design-engine/` | references to measured design, craft-lint, the writing rules | references | look folder parts, gate results | platform build |
| `tools/proc-guard/` | nothing a run starts outlives the run: guarded temp folders, process sweep | a test run | cleaned processes and folders | platform build |
| `tools/mint-site-key.mjs`, `pages-project.mjs`, `dns-upsert.mjs`, `deploy-functions.mjs`, `apply-staging.mjs` | onboarding and deploy scripts | variable names from the `.env` | a key, a project, a record, a deploy | platform build |
| `tools/client-questions/`, `clients/`, `templates/` | the client question sheet and client records | facts from the client | a PDF of at most 12 questions | clients |
| `tools/departments/` | charters check, builder start, new department | charters | PASS or the clash | head of operations |
| `tools/icm/`, `icm/` | the routing index and the code map (generated) | every file | `icm/index.json`, `icm/code-map.json` and their pages | head of operations |
| `docs/product/`, `work/` | this book and the work orders and state | owner rulings, the code | current text | head of operations |

Rules every block keeps are in `11-rules.md`. Runtime blocks (supabase, factory, tools/audit, the CLI, the workflows, the
dashboard, sites) never import a model SDK or call a model API.

## The omnikom CLI (`tools/omnikom-cli/`, CLI and testing)

The platform tests itself through its own CLI on its own test workspaces, calling the database and the same endpoints the
websites use. A client's preview is never a test vehicle. One Node program with no dependencies beyond `psql`; every command
prints one JSON object (`ok`, `command`, `target`, `code`, `exit`, `data`); exit 0 matched, 1 mismatch, 2 usage, 3 BLOCKED.
Output is redacted; keys are read by variable name only. Default target `local`; production allows only read-only `status`
and `apply --i-mean-production`. Identities: `owner-a`, `owner-b`, `member-a1`, `member-a2`, `staff`, `nobody`, `site:<slug>`,
`runner`, `cron`.

| Command | Does |
|---|---|
| `status` | reachability, migrations applied or pending, key names present |
| `apply [--dry-run]` | applies migrations through `apply-staging.mjs` |
| `seed test [--clean]`, `seed workspace` | the two test workspaces, six test logins and the test site; a real client from a plan |
| `test walls` | the wall tests in their own namespace, rolled back |
| `test journey --target staging` | the end-to-end journey below |
| `verify --only lead|walls|people` | HTTP checks, one PASS or FAIL line each |
| `key mint|list|revoke` | a site's signing key into Vault and the registry |
| `contract validate|place`, `content save|get|history`, `publish`, `job get|wait|set` | contract, content and publish by hand |
| `lead send|list|get|update|add|delete` | leads; `send --retry` sends one idempotency key twice and counts rows |
| `audit --dir`, `gate --dir` | the audit and the publish gate over a built folder |
| `tools ensure|list` | pinned binaries (actionlint, shellcheck, gitleaks, deno) from `tools.json` into the git-ignored `.tools/`, sha256 checked |
| `ci [--job]` | every `ci.yml` job locally with the pinned tools, to reproduce a GitHub failure |
| `impact <files>|--staged` | who imports, reads or copies the changed files, their owner, and the jobs that cover them |
| `land check/<dept>/<slug>` | moves master to that commit only after every `ci.yml` job passed on it, fast-forward only, under a land lock |
| `hooks install|status` | the pre-push hook that enforces the landing rule |
| `mfa enroll-staff` | the second factor for the staff test login |

The CLI carries every tool a check needs: "not installed" is never a reason a check did not run.

## The journey: how a user-facing feature is proven

`omnikom test journey --target staging` makes the test accounts, signs in, edits content, publishes, opens the published test
site in a real browser (no console errors; phone and desktop screenshots), sends a lead through the site's form, finds it in
the CRM and exports it. Each step prints PASS, FAIL, BLOCKED, NOT BUILT YET or SKIPPED; a step for a feature not built prints
NOT BUILT YET, never a pass. Steps today: J1 accounts, J2 sign-in, J3 publish, J4 the site renders, J5 lead through the form,
J6 lead in the CRM, J7 export. Every slice that adds a user-facing feature adds its journey step in the same slice, and the
journey removes its own test leads. The old push steps (a CRM test sink, a lead pushed to a CRM) are dropped.

## Hardening steps (enterprise gaps, found 2026-11-05)

Each step brings today's code up to `11-rules.md` 30-36 and closes a row of `1-product.md` part E. Evidence (path:line) and
the full reasoning: `work/11-enterprise-audit/CONTEXT.md`. Stage: **H0** now, cheap and dangerous; **H1** before the first
real client's traffic or data; **H2** before about 50 tenants or 50,000 leads in one tenant; **H3** later. A department
starts its next slice from its lowest open stage. A step lands with its test and mutant, and moves its part E row.

| Step | Stage | The gap, in short | Owner | Row |
|---|---|---|---|---|
| H0-1 | H0 | done, e056cc5: the stale-job reaper is never scheduled; a stuck job blocks every later publish of that site | platform build | E4 |
| H0-2 | H0 | done, 22c8b23: bad-signature posts add undeletable security_events rows; a flood fills the Free plan's size cap | platform build | E5 |
| H0-3 | H0 | done, 7b71b50: build and audit run with RUNNER_KEY and the account-wide Pages token in their environment | platform build | E9 |
| H0-4 | H0 | the media bucket has no size or type limit; direct inserts skip upload-start's caps | platform build | E10 |
| H0-5 | H0 | the dispatch token can write the repo whose workflows hold the Cloudflare token; master unprotected (UNVERIFIED) | platform build | E9 |
| H0-6 | H0 | done, f5e7af8: the book's counts are typed by hand; a check in `tools/icm` recomputes them, checks WORKS paths and step owners | head of operations | E20 |
| H1-1 | H1 | no backup of any kind: database, media, Vault; Free plan (the plan is the owner's call) | platform build | E1 |
| H1-2 | H1 | production does not exist; no scripted bring-up of dashboard, secrets, Auth settings, runner | platform build | E2 |
| H1-3 | H1 | alerts go nowhere; no error reporting, no request id | platform build | E3 |
| H1-4 | H1 | lead alerts can be lost: no outbox worker, Resend has no timeout; KNOWN-4 the form waits for mail, quota is `count(*)` | platform build | E4 |
| H1-5 | H1 | dashboard: no CSP or security headers, no error boundary | platform build | E7 |
| H1-6 | H1 | a live publish goes live before its smoke; no rollback; the smoke reads only the title | platform build | E8 |
| H1-7 | H1 | staff reads are not audited; session and refresh settings unread | platform build | E11 |
| KNOWN-1 | H1 | the public form has no per-visitor limit or bot check; the site endpoint signs anything and forwards no visitor IP | platform build | E5 |
| KNOWN-2 | H1 | a direct Postgres connection per function call | platform build | E6 |
| KNOWN-5 | H1 | dashboard: no cache rules, 3 realtime channels per tab | platform build | E7 |
| KNOWN-3 | H2 | lead_list scans the whole workspace, offset paging, industry fields in jsonb | platform build | E13 |
| H2-1 | H2 | no retention or partitioning on append-only tables | platform build | E12 |
| H2-2 | H2 | every publish ships the whole media library; one Actions run per photo | platform build | E13 |
| H2-3 | H2 | RLS helpers run once per row | platform build | E13 |
| H2-4 | H2 | publish validation is a round trip per row; export holds 5,001 rows in memory | platform build | E13 |
| H2-5 | H2 | one global RUNNER_KEY and an account-wide Pages token (ADR 0011): OIDC and per-project tokens | platform build | E9 |
| H2-6 | H2 | no offboarding: data export, Pages project, Storage, Vault keys, domain | platform build | E14 |
| H2-7 | H2 | client Pages projects, domains and keys made by hand; `sites.domain` not unique | platform build | E15 |
| H2-8 | H2 | erasure blocked by NO ACTION foreign keys to auth.users; privacy requests are only tickets | platform build | E14 |
| H2-9 | H2 | no limits on sites, media bytes or publishes; no billing | platform build | E16 |
| H2-10 | H2 | no dependency scan; CI installs with `--no-audit` | CLI and testing | E17 |
| H2-11 | H2 | key rotation only reported, and RUNNER_KEY is one value: accept two keys | platform build | E9 |
| H2-12 | H2 | restore drill manual; runbooks R1-R5 only in the archive | platform build | E1 |
| H2-13 | H2 | richtext accepted as any string; no sanitiser; no gate on `raw()` for tenant fields | platform build | E18 |
| H2-14 | H2 | migrations: no lock lint, no expand-contract, no CONCURRENTLY possible | platform build | E19 |
| H2-15 | H2 | mail: no bounce or complaint handling, no erasure executor | platform build | E21 |
| H3 | H3 | the audit's remaining items (C3, U0, U3, U4, U6-U10, U12, U13, U15, U16, U20, U24, U30-U34) | each area's owner | as found |

## What each department builds next

Hardening first: each department starts from its lowest open stage above (H0, then H1), then its feature blocks. CRM
first; inside each block the backend first. A block is done when the code on master does it on the test site.
- **Head of operations:** this book; the work-order layout in `work/` and `work/STATE.md`; the indexer and code map run on
  every edit, session start, commit and in CI; the librarian reading the index; cleanup of the old logs, charters and
  leftover worktrees.
- **Platform build:** CRM backend (industry lead fields declared in each contract, stored and validated; every field
  editable; server-side search, filter, sort; bulk edits; full history); export and import in the client's layout; the CRM
  screens; site forms built from the contract's lead fields, so the test site sends industry fields; the dashboard features
  (Settings, publish history and restore, photos, take a page down).
- **CLI and testing:** CLI commands for the CRM (send a lead with industry fields, edit any field, export in a saved layout,
  import a file); one journey step per new feature, failing at that step when it breaks; tooling fixes only when a check blocks
  a landing.
- **SEO and audits:** audit results stored per site for the dashboard; the six-question site report; AI-prompt coverage.
- **omnikom.ai, the platform's own website (owner, 2026-11-05):** planned and built through the same procedure as a client
  site: the SEO skill's research and prompt map, an approved plan and design, the factory build, every audit gate green
  (programmatic SEO, AEO and GEO correctness, speed, accessibility), static on Cloudflare under the rules in `11-rules.md`
  "Built to scale". Contact and mail addresses on omnikom.ai. Planning starts with the domain setup; DNS and the Resend
  domain need the owner's click.
- **Clients:** nothing until the product works on the test site.
