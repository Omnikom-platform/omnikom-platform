# Blueprint progress (for the lead session)

Task: build-ready product engineering package (owner, 2026-10-28), raised to engineering practice, tied to published standards,
then corrected by an independent fact-check (72 claims) and an independent M1 dry run (31 issues), and by DECISIONS 15
(no Docker; one Supabase account, staging + production). **Status: complete for owner review. Nothing committed.**

## Final gate run (2026-10-28, after dry run 2, `node docs/blueprint/specs/run-all-gates.mjs`)
```
PASS contract tests             138 passed, 0 failed
PASS contract mutants           82 mutants, 82 caught, 0 survived; 0 codes untested
PASS industry run               15/15 PASS; wrote industry-run/RESULTS.md, contracts/, screens/
PASS database walls + mutants   OK: real migration passes; 47 mutants
PASS specs + traceability       OK: 10 operations, 10 operationIds; 38 FR/NFR rows, 30 work orders, 0 problem(s)
PASS machine-call signature     OK: 0 failed
PASS deno check                 deno check supabase/functions/_shared/signature.ts supabase/functions/_shared/contracts.ts
all gates passed
```

## Dry run 2 (17 new issues + 1 left over): disposition
Each fixed item got a test that went red first, then green; database walls also got a mutant.
- N1 outsider learns field names: `service.contract_for` (404 before any validation), save/publish order fixed in docs + diagram (T12).
- N2 reaper failed live deploys: counts from the last state change (running 30 min, queued 24 h); a reaped job whose deploy lands
  reconciles to done; a NULL in the transition check let an illegal jump through (found by the test, fixed).
- N3 pages outside the plan seeded without title/SEO: contract `pageSeeds` + `seedGaps()`; ELEV8 seeds all 43 pages within the limits
  (12 from the live backup, shortened; 4 drafted pages listed in `clientWording` for the client).
- N4 publish shipped an unvalidated version: `start_publish` takes and pins the validated versions (T13).
- N5 `deno check` broke with a root package.json: reproduced the exact `npm:@types/node` error, fixed with `deno.json`
  `"nodeModulesDir": "none"`; `deno task check` is now a gate.
- N6 signature had no canonical form or replay window: `signature.ts` (t + method + path?query + body, 300 s), tests watched failing
  on a wider window and on unsigned paths.
- N7 token Worker: Vault JSON `{token, worker}`, `Export.deployTokenWorker`. N8 publish body `{site, rows, versions}`.
- N9 seed reference recorded as the version's sign-off. N10 no extension functions in `public` (pgcrypto removed; built-in UUIDs).
- N11 stale names swept. N12 unprocessed photos block publish. N13 job error recorded. N14 W1.6 setup spelled out. N15 unpublish in
  W3.5. N16 local Postgres, staff login, DB driver specified in W0.5. N17 `resolved` shape defined.
- Left over from dry run 1: the industry run now writes only changed files (watched: rewritten before, untouched after).

## The wall leak, proven (fact-check S1 / dry run 8.1)
The test stand-in now models Supabase's default grants (`supabase/tests/local-shim.sql`). The same three grant-wall mutants:
- old stand-in (no defaults): `SURVIVED append-only versions`, `SURVIVED anon has no table rights`, `SURVIVED anon cannot call
  save_version` (the old tests could not see the leak);
- realistic stand-in: all three `caught`. Every wall that is double (defaults off + explicit revoke) is mutated on both layers.

## New leaks found and fixed (each now has a test that went red, and a mutant)
1. A failed publish shipped on the next publish (dry run 5.1): publish is now a job; nothing goes live until it is done; a failed
   job's versions are never shipped (T6).
2. My own snapshot design had a race (a queued second publish froze stale content): the snapshot now freezes at build start (T11).
3. The save validator could be skipped through a public RPC (dry run 3.2): the save body is private; only the `save` function can
   reach it (T4).
4. Members could publish others' items (dry run 3.1): publish uses the same own-only rules (T2b).
5. Photo facts were trusted from the client's row JSON (dry run 3.3): they now come from the media record (`I-MEDIA-UNKNOWN`).
6. `collection_def()` exposed other workspaces' contracts (standards check): guarded (T3).
Plus: staff need MFA (aal2), storage bucket + policies as code, per-job events, legal state transitions, a stale-job reaper,
unpublish, Realtime publication, rolled-back staging-safe tests (`run-staging.mjs`), seeding with an explicit staff actor.

## Fact-check (8 WRONG, 27 PARTLY): all addressed
S1-S4, S6-S10, S15, S17-S20 (Supabase), C1 (marked UNVERIFIED + W0.4 step), C4/C5 (Cloudflare caps in risks), C7/C8, G2, G5,
I1-I11, Q2, ST4, ST8, ST11, ST12, ST15: fixed in the migration/tests or the docs. UNVERIFIABLE items stay marked (O1, ST2, ST4).

## Dry run (31 issues): disposition
Fixed in code + tests: 3.1, 3.2, 3.3, 3.6, 5.1, 5.5, 5.6, 6.1, 6.2, 6.3, 8.1, 8.2, 2.5/4.1 (resolved contract; mergeCore
idempotent). Fixed in the blueprint: 1.2 (CI installs Postgres binaries), 1.5-1.7 (W0.5 local dev kit, no Docker), 2.1-2.4,
2.6, 2.7 (W1.1 seed spec), 3.4, 3.5, 3.7, 4.2 (ADR 0011 revised: runner key; the job token added nothing), 4.3, 4.4, 5.2, 5.3,
5.4 (M1 publishes the contact page; photos in M3), 6.3, 7.1, 7.2 (runner compares the target with the Worker recorded with the
site's token), 8.3. Moved to a later work order: 5.7 (sitemap only lists published pages: W2.2 acceptance). Still BLOCKED by
accounts (owner decisions D1-D4): 1.1, 1.3, 1.4, 2.8, 4.5, 5.8, 7.3. UNPROVEN until W1.2: 3.8 (bundling `contracts/` into Edge
Functions; `core.json` is now a JSON module import instead of a runtime file read).
Every M0-M1 work order now has a local acceptance next to its cloud acceptance (05-BUILD-PLAN).

## UNPROVEN / UNVERIFIED
Anything on real Supabase/Cloudflare/GitHub (no projects yet; `run-staging.mjs` is written, not run); Supabase's real `auth.users`
accepting the named-column fixture insert; the default function secret name for the DB URL; ISO 29148 / 42010 clause content;
ASVS per-requirement sheet (W0.2); OpenAPI official-schema validation; estimates (~99 engineer-days) are estimates.
