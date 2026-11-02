# 09 Test strategy

## 1. The pyramid
| Layer | What | Tool | Where it runs | Gate |
|---|---|---|---|---|
| Contract | contract + row rules, placement, generator | `contracts/test/run.mjs` (138 checks) | every PR | required |
| Mutation (contract) | every rule switched off must turn the suite red | `contracts/test/mutate.mjs` (82 mutants) | every PR | **required** |
| Database walls | RLS + functions on real Postgres | `supabase/tests/run-local.mjs` (tenancy T1-T7) | every PR (Postgres service container) + staging after migrate | required |
| Mutation (walls) | each wall removed must turn the tests red | same script (47 mutants) | every PR | **required** |
| Unit (app) | widgets, hooks, renderer partials, sanitiser | Vitest | every PR | required |
| Function | Edge Functions against the local plain-Postgres database (no Docker) | Deno test + `serve-local.ts` | every PR touching `supabase/functions` | required |
| Staging | the same tenancy tests and function tests on the staging Supabase project (rolled back) | `run-staging.mjs`, deployed functions | merge to main, before any production promotion | required |
| Site gates | SEO 13/13, render gate, axe, media, forms, live guard | factory gates | every publish job + nightly on all sites | required to deploy |
| Visual regression | sites vs approved design / previous build | screenshot diff at 3 sizes | design changes, migrations (W4.x), nightly on staging sites | required for M4 |
| E2E (dashboard) | the flows in `04-DASHBOARD.md` | Playwright against staging | merge to main | required before prod |
| Load | form endpoint and publish | k6 (or autocannon) | before launch, then monthly | targets below |
| Industry run | the contract procedure on 15 industries | `contracts/industry-run/run.mjs` | every PR touching contracts | required |
| Spec | OpenAPI refs + FR/NFR traceability | `docs/blueprint/specs/check-specs.mjs` | every PR touching docs/specs | required |

## 2. Required gates (merge is blocked if any is red)
contract tests + mutants, wall tests + mutants, typecheck, lint, unit, gitleaks, build, spec check. Publish is blocked by any site
gate. **A new rule or wall without its mutant is not mergeable** (the mutation scripts also fail when a rule code has no test).

## 3. E2E flows (Playwright, two seeded workspaces on staging)
login/invite; member cannot open another workspace (URL tamper); agent creates a listing -> publish -> preview shows it on the
home feed and its city guide; sold listing moves to Recently sold, price hidden until ticked; locked field read-only for the
owner, staff change with sign-off; restore an old version; upload a photo with GPS -> stored without GPS; lead from the preview
form appears in the inbox with consent text; member sees only assigned leads; failed gate shows a plain-word reason and nothing
deploys.

## 4. Load targets
Form endpoint: 50 requests/s per site for 5 min, p95 < 500 ms, 0 lost leads (every 202 has a row). Publish: 10 sites publishing at
once complete within NFR-4 (5 min p95). Dashboard: 100 concurrent users on staging, p95 API < 300 ms for list screens.

## 5. Test data
Synthetic only (`contracts/test/run.mjs` "Demo Homes", `tenancy.test.sql` workspaces A and B, industry paper plans). Client data
is never copied into tests; adapters that read client projects print counts only (`contracts/examples/*/RUN.txt`).

## 5b. Accessibility (WCAG 2.2 AA, https://www.w3.org/TR/WCAG22/)
axe-core covers many success criteria automatically but not all. Each release gets a manual check of the criteria new in 2.2 at
A/AA: 2.4.11 Focus Not Obscured (Minimum), 2.5.7 Dragging Movements (the gallery and page-section ordering need a non-drag
alternative), 2.5.8 Target Size (Minimum), 3.2.6 Consistent Help, 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication
(Minimum) (magic link satisfies it; no cognitive tests at login).

## 6. Definition of done (per work order)
1. Acceptance test in the build plan passes; output pasted in the PR.
2. Each new test was watched failing (break, see red for the right reason, restore); new rules/walls have a mutant.
3. Required gates green in CI; spec check green; traceability row updated (FR/NFR -> WO -> test).
4. Docs updated where behaviour changed (blueprint, contract README, runbook if an incident path changed).
5. Reviewed by a second person; migrations by two.
6. Deployed to staging and looked at (UI: render checked at 3 sizes); `PROGRESS` note updated with what is NOT DONE or UNPROVEN.
