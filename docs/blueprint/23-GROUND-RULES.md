# 23 Ground rules: the certified protocols this platform builds to, each turned into a gate that runs by itself

Written 2026-10-29 (owner: "we need to follow certified building protocols in the architecture; there are ground rules for how
to build such platform and make it perform and secure; let's finalize all that"). The review the same evening
(`REVIEW-2026-10-29.md`) showed why prose rules are not enough: the one function without a null guard was the one nobody
re-read. So every rule below names its source, its one-line statement, and the mechanical check that enforces it; a rule with
no check yet says NOT BUILT and has a work order. `STANDARDS.md` keeps the full list of standards with versions and URLs.

## 1. The sources (what "certified" means here)
| Source | Used for | Where it applies |
|---|---|---|
| OWASP ASVS 5.0.0, Level 2 | the security requirement catalogue for a multi-tenant web app holding personal data | `08-SECURITY.md` 2b, every rule in section 3 |
| OWASP Top 10:2025 | the failure classes to test against | `08-SECURITY.md` 2c |
| OWASP Secrets Management Cheat Sheet | where secrets live, rotation, detection | `02-BACKEND.md` 8, gitleaks gates |
| NIST SP 800-218 (SSDF 1.1) | the build and release pipeline practices | `10-DELIVERY.md`, CI |
| PostgreSQL documentation: Row Security Policies, SECURITY DEFINER functions | the tenancy wall | migrations, T3, the structural gates below |
| Supabase guides: RLS, database functions, MFA, Storage access control, "Going into production" checklist | platform-specific hardening | migrations, W0.3 (the checklist is walked item by item on the first real project) |
| Cloudflare: API token best practices, Pages Functions, custom domains | hosting and deploy credentials | `20-SHAPE.md`, `21-PROTOCOLS.md` |
| GitHub: Actions security hardening (secrets, OIDC, least-privilege tokens) | the runner | `21-PROTOCOLS.md` 1 |
| WCAG 2.2 AA | dashboard and sites | `09-TEST-STRATEGY.md` 5b, axe in CI |
| Google web vitals thresholds, PageSpeed | performance | the writing gate WG-1..7, the launch ledger |
| TCPA and CAN-SPAM (US) for SMS and email, GDPR/CCPA principles for lead data | consent, STOP, retention, deletion | messaging rules, `leads.sms_consent`, retention D6 |
| ISO/IEC/IEEE 42010 and the C4 model | how the architecture is documented | `01-ARCHITECTURE.md`, diagrams |
Nothing here is a certification of the platform; these are the published rule sets the design follows and the gates prove.

## 2. The ten ground rules (one line each)
1. The tenancy wall is in the database: RLS on every table, every policy names its role, writes only through checked functions.
2. Unknown never counts as allowed: every authorisation expression is null-guarded (`coalesce(..., false)`).
3. Every machine call is signed (method, path, body, time window); every user call carries a JWT the function verifies.
4. Every write is idempotent where a retry is possible (lead key, job id, webhook event id, message key).
5. State machines move only along listed transitions; a crash between two steps leaves a state the reaper or a retry repairs.
6. No secret value in a tracked file, a log, a reply or a table; names and hashes only; the scanner runs on every commit.
7. Fail closed: any gate, validation or signature failure deploys nothing, sends nothing, stores nothing beyond the record of the failure.
8. Consent before contact: SMS only with recorded SMS consent and no STOP; email alerts only to the client's own addresses; the exact consent text is stored.
9. Growth is bounded: every growing table has a `(workspace_id, ...)` index, a retention rule and a measured budget trigger.
10. A rule without a test that was watched failing, and a mutant that removes the rule, is not a rule.
11. Every upload is processed before it can be published (owner, 2026-10-29: "anything that the user uploads, a video, a
    picture, gets processed for perfect website performance on its own"): photos get EXIF and GPS stripped and the three WebP
    sizes; videos get web renditions and a poster (ffmpeg in the runner, R2 storage; NOT BUILT, work order in M3 W3.2b);
    publish refuses any media row that is not `processed` (BUILT for photos: `I-EXIF`, `I-MEDIA-SIZE`).
12. Encryption, named precisely: in transit everywhere (TLS, HSTS on every site); at rest by the vendors (Supabase, R2);
    secrets only in Vault or the vendors' secret stores; application-level encryption of lead names, phones and emails is an
    owner decision (D16: it costs search and the lead list; the pattern is hashed lookup columns plus encrypted values).
13. A fixture in a wall test is written the way the production tool writes it, or the test calls the tool; a model of a
    function reads its inputs from the database the way the function does, never from values handed to it. (Found on staging
    2026-10-30: the test inserted site keys without a workspace and the CLI's model of `capture-lead` held keys in memory, so
    126 mutants and 138 checks stayed green while the deployed lookup found no key and answered 401.)
14. The running platform needs no model (DECISIONS 38): runtime code (supabase/, factory/, tools/audit/, tools/omnikom-cli/,
    the workflows, the dashboard, sites/) imports no model SDK, names no model API host and reads no model key. Checked by
    `docs/blueprint/specs/check-no-model.mjs` in run-all-gates (planted tells, 10 mutants, the real tree). The allowlist is by
    path and outside the runtime folders (the SEO skill's research scripts, the step D operators); adding to it is a decision.

## 3. The gates (what runs, where, what it proves)
| Gate | Rule(s) | What it checks | Where | Status |
|---|---|---|---|---|
| RLS everywhere | 1 | every table in `public` has RLS enabled and at least one SELECT policy; policies name `to authenticated` | T14 structural (reads `pg_class`, `pg_policy`) | this tick |
| Read isolation per table | 1 | for every table with `workspace_id`: B's owner and a no-membership login read 0 rows of A; staff with `aal2` reads them | T14 generated loop | this tick |
| Every service function refuses outsiders | 1, 2 | every `service.*` function that takes `p_claims` is listed in the covered set with a non-member and a cross-workspace call that fails | T14 (catalogue vs covered list) + the explicit calls | this tick |
| Null guards | 2 | no `if not (` authorisation test in a definer function without `coalesce` (a lint over `pg_proc` source) | T14 | this tick |
| Definer hygiene | 1 | every SECURITY DEFINER function pins `search_path = ''` with schema-qualified names (migration 8); no function in `public` is executable by `anon`; `authenticated` can execute only the allowlisted `private` helpers; a new function in `private` or `service` is closed to PUBLIC by default privileges; the Edge Functions' role `omnikom_fn` reaches `service.*` only | T14 (`pg_proc`, `has_function_privilege`), T17 (probe function, the role) | BUILT 2026-10-30 (step 3) |
| Append-only trail | 7, 8 | `audit_log`, `security_events` and `consent_ledger` refuse update, delete and truncate for every role (trigger), `service_role` holds no write beyond insert; the trail outlives a deleted workspace; a lead's consent record outlives the lead | T16 | BUILT 2026-10-30 (step 3) |
| Refusals recorded | ASVS 16.3 | every refused call, failed signature and quota hit lands in `security_events` through `service.record_security_event` (the Edge Function records it after the refused transaction rolled back) | T16, `capture-lead` on 401, 404, 409, 429 | BUILT 2026-10-30; the function path PROVEN on staging only when `verify --only lead` runs after the deploy |
| Suppression | 8 | a STOP becomes a suppression by hashed address outside the delete cascade; `record_message` refuses a suppressed address (`M-SUPPRESSED`), workspace-wide or platform-wide | T16 | BUILT 2026-10-30 (step 3) |
| Tenant switch and quotas | 7, 9 | `workspaces.state` moves only along the listed transitions, staff only; suspended refuses leads and sends, anything but trial or active publishes nothing; `workspace_limits` overrides `platform_limits` per workspace; `capture_lead` refuses over `leads_per_hour_workspace` (`S-QUOTA`) | T16 | BUILT 2026-10-30 (step 3) |
| Grants audit | 1, 7 | `anon` has no table privilege; `authenticated` has INSERT/UPDATE/DELETE on no table except the allowlist (column-limited media insert) | T14 (`information_schema.role_table_grants`) | this tick |
| Mutant per wall | 10 | every policy and every `raise exception 'S-` / `'B-` / `'M-` line has a mutant entry; the runner fails on an unmutated wall | `run-local.mjs` coverage check (NOT BUILT: list policies from the migration text and compare with the mutant targets) | W0.2 |
| Signature | 3 | canonical form, 300 s window, path and body bound; the endpoint's `sign` verified by the platform's `verify` | `signature.test.mjs`, `factory/worker/test` | BUILT |
| Idempotency | 4 | lead key, webhook event id, job rerun ship the same snapshot, message key | T11, T12, T13, this tick (messages) | partly BUILT |
| State machines | 5 | jobs, add-ons, bookings, messages: illegal jumps refused, same-state no-op | T6, T13, this tick (messages) | partly BUILT |
| Secrets | 6 | gitleaks on the staged set before every commit and on the pushed range (hook); `.gitleaks.toml` allowlist only for plainly fake test keys | hooks + `.gitleaksignore` | BUILT |
| Fail closed | 7 | a failed job never moves `published_version`; a failed gate deploys nothing; a bad signature stores nothing | T6, endpoint tests, capture-lead | BUILT (SQL), function UNPROVEN |
| Consent | 8 | SMS refused without `sms_consent` or after STOP; alerts only to `sites.lead_alert_to` | this tick | this tick |
| Indexes | 9 | every table with `workspace_id` and more than one row per workspace has an index starting with `workspace_id`; `publish_job_events (job_id)` | T14 (`pg_indexes`) | this tick |
| Retention and budget | 9 | growth table rows for every growing table; `usage.yml` triggers | `18-BUDGET-ARCHITECTURE.md` 2.2, 3 | docs; cron NOT BUILT |
| Performance of the site | perf | writing gate WG-1..7, SEO gate 13/13, render gate, axe | skill scripts, launch ledger | BUILT (skill), runner NOT BUILT |
| Accessibility | WCAG | axe 0 violations, the 2.2 manual list | `09-TEST-STRATEGY.md` | NOT BUILT (dashboard) |
| Supply chain | SSDF | pinned versions, lockfiles (`deno.lock`, npm lockfile), the 7-day rule, audit in CI | W0.2 | partly (lockfiles) |
| Production promotion | SSDF | the same commit as staging; owner-only run; `--i-mean-production` | `apply-staging.mjs`, `promote` workflow | script BUILT, workflow NOT BUILT |

## 3b. The not-skippable list (owner, 2026-10-29: "what else is an engineering mandatory thing that is not skippable")
| Mandatory | Why engineers refuse to skip it | Here |
|---|---|---|
| Backups with a rehearsed restore | a backup never restored is a hope | nightly dump to R2 + monthly restore drill designed (`18-BUDGET` 2.4); NOT BUILT |
| Observability and on-call | you cannot fix what you cannot see | runbooks R1-R5 and alerts on paper (`11-OPERATIONS.md`); nothing wired |
| CI that blocks merges; no direct pushes to the main branch | a human forgets, a gate does not | tests exist; `ci.yml` NOT BUILT; GitHub Free cannot protect a private branch (DECISIONS 27), our promote gate stands in |
| Staging identical to production; forward-only migrations never edited | the only way "it worked on staging" means anything | `apply-staging.mjs` refuses an edited applied migration (tested) |
| Tests at every layer, end-to-end included, plus mutation testing | a green suite with no mutants proves the suite runs, not that it tests | database layer done (this file's gates); functions, runner, dashboard NOT BUILT |
| Threat model, least privilege, dated secret rotation, automated dependency updates | the breaches that happen are the boring ones | threat model and rotation table written; Dependabot or equivalent NOT SET UP |
| Timeouts, retries with backoff, idempotency on every network call | partial failure is the normal case | designed; the hook refuses a script call without a timeout |
| Rate limiting and abuse controls on every public endpoint | one bot decides your bill otherwise | specified; numbers NOT SET; NOT BUILT |
| Data lifecycle: retention, deletion on request, export | the law and the client both ask | deletion BUILT (`delete_lead`); the request log with its 45-day clock BUILT (`privacy_requests`, step 3); the consent record outlives the lead (`consent_ledger`, step 3); retention cron and the per-person export NOT BUILT |
| Health checks, uptime monitoring, a kill switch | a way to stop the bleeding in one move | `platform_limits` holds caps; the per-tenant switch BUILT (`workspaces.state = suspended`: no leads, no sends, no publish, step 3); a global kill switch (stop all sends and deploys) NOT BUILT (add `platform_limits` keys `sends_enabled`, `deploys_enabled` read by every consumer) |
| Recovery objectives written down (RPO, RTO) | the backup schedule follows from them, not the other way round | NOT WRITTEN: owner decision D17 (proposed: 24 hours of data at most, back within 4 hours) |
| A second reader on every change, in a fresh context | the author cannot see their own blind spot (proven tonight) | the `unit-reviewer` run is the model; make it a step in section 4 |
| Legal surface: privacy policy, terms, data processing agreement, consent records | clients and their visitors are owed it | consent records BUILT; the documents NOT DRAFTED (`LAWYER-PACKET` precedent in the Agent D project) |

## 4. How a new piece of code is admitted (the procedure)
1. Name the rule it touches (section 2) and the gate (section 3).
2. Write the test first and watch it fail for the right reason; write the mutant that removes the wall.
3. Run `node docs/blueprint/specs/run-all-gates.mjs` (contract, walls with mutants, specs, deno check); paste the output.
4. The structural gate T14 must stay green: a new table without RLS, a new function without a null guard or `search_path`, a
   new `workspace_id` table without its index, or a new `service.*` function without its outsider test fails the suite.
5. Review by a second reader with a fresh context (the `unit-reviewer` run this evening is the model); findings go to a dated
   REVIEW file and stay listed until fixed.
6. Commit gated on the secret scan; push; the position file names what is UNPROVEN.
