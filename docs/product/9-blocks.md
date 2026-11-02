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

## What each department builds next

CRM first; inside each block the backend first. A block is done when the code on master does it on the test site.
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
- **Clients:** nothing until the product works on the test site.
