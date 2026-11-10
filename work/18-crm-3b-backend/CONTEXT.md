# 18 CRM block 3b backend: columns, saved views, follow-up and tasks, duplicates

Owner: platform build. Model: Sonnet (high). Branch: check/platform/crm-3b-backend. Migration: 22
(`supabase/migrations/20261109000022_crm_views_followup.sql`, reserved for this order). Status: OPEN 2026-11-09 (head wrote it).

## Why
Block 3b of the platform queue (`work/STATE.md` "Next, in order" 1; `docs/product/9-blocks.md` "What each department builds
next": inside each block the backend first). The CRM rows still MISSING in `docs/product/1-product.md` part A that need no owner
answer: A13 choose the columns of a view, A14 saved views, A17 follow-up date and tasks, A18 duplicate flag
(`docs/product/5-crm.md` "What the CRM does"). A16 (status board) waits on the owner's question and is not here. The screens are
work order 19, written after this order's answers are settled; this order builds and proves only the backend.

## Inputs (load these, nothing else unless a step needs it)
- `CLAUDE.md`, `work/STATE.md`, this file; `work/01-crm-backend/CONTEXT.md` and `work/02-crm-export-import/CONTEXT.md` (Settled
  and Findings: how lead_list, lead-update, leads-bulk and the import were built and proven).
- `docs/product/5-crm.md` (the lead record, "What the CRM does"), `3-database.md`, `4-backend.md`, `11-rules.md` 30-36.
- `supabase/migrations/20261105000018_lead_list_site.sql` (the newest `service.lead_list`: its `p_query` filter, sort and
  search), `20261103000014_crm_fields.sql` (lead_set_fields, the typed answers), `20261104000015_crm_export_import.sql`
  (`private.phone_key`, the import's duplicate rule), `20261029000002_crm.sql` (leads, lead_events, `service.lead_event`,
  `lead_event_kind`), `20261109000020_security_event_buckets.sql` (the newest migration's shape).
- `supabase/functions/lead-list/`, `lead-update/`, `_shared/dashboard.ts`; `supabase/functions/test/` (how a function test and
  a functions mutant are written); `supabase/tests/tenancy.test.sql` (T14's list of claim-taking service functions, the newest
  T-number) and `run-local.mjs` MUTANTS; `docs/blueprint/specs/openapi.json` and the contracts gate it feeds.

## Settled by the head (build exactly this; a reason to change one is a finding)
1. **Saved views (A13, A14).** Table `crm_views`: id, workspace_id, user_id (null = shared with the workspace), name (1-60
   chars, unique per workspace and user_id), query jsonb (the same shape `lead_list` takes as `p_query`: filter, sort,
   search), columns text[] (core and industry keys, in order; at most 60; unknown keys refused with the key named), created_at,
   updated_at. A view is a stored `p_query` plus a column list: choosing columns (A13) is a view's `columns`, and the screen keeps
   an unsaved view in the page address, so A13 needs nothing more here. RLS: a member reads their own views and the shared ones;
   writes go only through functions. `service.view_save(claims, workspace, {id?, name, query, columns, shared})`: any member
   saves their own; only an owner (or staff with MFA) saves or changes a shared one. `service.view_delete(claims, view)`: own
   view, or an owner for a shared one. The query is validated by the same code `lead_list` uses (one function, not a copy),
   so a saved view can never hold a query `lead_list` refuses. Functions `view-save`, `view-delete` (JWT, `_shared/dashboard.ts`);
   listing is a plain RLS select from the dashboard (no function).
2. **Follow-up and tasks (A17).** `leads.follow_up_at timestamptz null`, set or cleared through `lead-update` (a new key
   `follow_up`, ISO date-time or null), one `follow-up` event with old and new. Table `lead_tasks`: id, lead_id, workspace_id,
   text (1-500), due_at null, done_at null, created_by, created_at; visible exactly where its lead is (the same RLS rule as
   the lead: an owner all, a member only tasks of leads assigned to them). `service.task_add(claims, lead, text, due)`,
   `service.task_done(claims, task, done boolean)`; each writes a `task` event (added, done, reopened) in the lead's timeline.
   Function `lead-task` (JWT): `{lead, text, due}` adds, `{task, done}` marks. `lead_list` gains a filter `due`: leads whose
   follow_up_at or any open task's due_at is at or before now (the caller's RLS still applies).
3. **Duplicates (A18).** `leads.duplicate_of uuid null`: when a lead is created (capture, add-lead, import with `duplicates:
   add`), it points at the oldest earlier lead of the same workspace with the same email (lower-cased) or the same phone
   (`private.phone_key`, E.164), set inside the same transaction; nothing is merged and nothing is refused. The rule is the
   import's own rule (one function both use). `lead_list` returns `duplicate_of` and accepts a filter `duplicates` (only
   flagged leads). A member sees the flag only when they can see both leads (the pointer is shown as "a duplicate" without the
   other lead's data when they cannot).
4. **New event kinds** `follow-up` and `task` (`alter type lead_event_kind add value`, outside a transaction block if the
   migration runner needs it: read how 20261029000003_addons.sql did it).
5. Every new service function takes claims, is a definer function with an empty search_path, is closed to anon,
   authenticated and PUBLIC and open to the function role, and joins T14's list with its outsider test. Contracts: the three
   new functions in `openapi.json` with their request and answer shapes; the contracts gate stays green.

## Steps
1. Migration 22 of the design. Then `docs/product/3-database.md` and `4-backend.md` in place (one line per table and function).
2. Walls in `tenancy.test.sql` (a new T-number after the last one): a member cannot read another member's private view or write
   a shared one; owner B reads nothing of A's views or tasks; a member sees tasks only of leads assigned to them; `due` and
   `duplicates` filters return exactly the expected leads as owner and as member; a duplicate created by capture, add-lead and
   import points at the oldest earlier match; a saved view with an unknown column or a query lead_list refuses is refused.
3. Function tests in `supabase/functions/test/` for `view-save`, `view-delete`, `lead-task`, and `lead-update` `follow_up`:
   the 200 shapes, 400 on a bad body, 404 for another workspace, and the CORS list (`cors.test.ts`).
4. Mutants, each caught: in `run-local.mjs` (the shared-view owner check removed; the task RLS opened to the workspace; the
   duplicate match without lower-casing; the `due` filter ignoring tasks) and in the functions mutants (one per new function).
5. Watch every new wall and test red first; paste the failing lines.
6. Staging proof script `supabase/tests/e2e-crm-3b.mjs` (staging only, synthetic data in workspace A, cleans what it made in a
   finally): save a private and a shared view and list them as owner-a and member-a1; add and finish a task; set a follow-up;
   the `due` and `duplicates` filters; a capture with an existing lead's email is flagged. One PASS/FAIL line per check. The head
   runs it after CI is 9 of 9 on the tip.
7. Book: A13, A14, A17, A18 evidence cells say "backend built (work order 18), screens in work order 19"; states stay MISSING
   until the screens (the head moves them).

## Outputs
- The migration, the three functions, `lead-update` and `lead-list` changes, the tests, mutants and e2e script; `openapi.json`;
  `3-database.md`, `4-backend.md`, `5-crm.md` (one line each where the feature is described), `1-product.md` evidence cells only;
  this file's status line.

## Rules for this order
- The builder never commits, pushes, applies to staging, deploys or publishes; it hands the head the staging steps.
- Heavy runs only through `~/.claude/scripts/heavy.mjs`; scoped mutants only; no full mutant run and no run-all-gates locally
  (rule 8). Keys by variable name only; scripts in files. Check free space on E: before big writes (stop and tell the head under 5 GB).
- No screens, no plan rows (work order 19).

## Proof
- run-local real migrations "ALL TENANCY TESTS PASSED"; the scoped mutants caught; the functions tests and their scoped mutants;
  the watched-red lines. The staging lines (the head).

## Findings
Send to the head; never fix here.

## Addendum (head, 2026-11-09 22:00): the state at the handover
State: BUILT by the builder, NOT PROVEN, NOT reviewed by the head; committed as WIP on this branch. PASSED: `deno task check` exit 0;
check-specs "OK: 27 operations, 27 operationIds, 25 deployed functions covered ... 0 problem(s)"; `icm --check` OK. Real tenancy run:
run 1 "permission denied for function phone_key" (fixed: migration 22 grants EXECUTE on private.phone_key to service_role, the
phone index runs as the writing role; T29 test and mutant added); run 3 "tests.sql:2252: ERROR: permission denied for table
crm_views" (the builder's own T29a read as omnikom_fn; test fixed, NOT re-run). NOT RUN: the real tenancy run after the fix, the 74
`crm22` SQL mutants, the 30 `crm3b` function mutants, the Deno function tests (the run was stopped for low memory), the re-run of
the `crm14`, `crm18` and lead_list-grant mutant groups (lead_list's checks moved into private.lead_query_check), and
`e2e-crm-3b.mjs`. No mutant has been watched caught yet.
Next head: run, in order, through heavy.mjs: the real tenancy run; `--only crm22`; `--only crm14`; `--only crm18`; the functions
tests; `mutate.mjs --only crm3b`; then review, CI, staging (migration 22, the three functions, `e2e-crm-3b.mjs`). Walls are T29
(work order 16 renumbers to T30). Then write work order 19 (the screens).
Builder's findings, for the head to rule: (1) the duplicate rule is one function, private.lead_duplicate_of, run by a BEFORE INSERT
trigger on leads (capture, add-lead, import), but import_leads' dry-run preview still uses its inline maps from migration 15 (same
rule; T29c asserts the dry-run count equals what a real run flags); (2) existing leads are not flagged (no backfill); (3) a member
sees duplicate true/false, and duplicate_of only when they can read the other lead; (4) `due` and `duplicates` are top-level
booleans of the lead_list query (a non-boolean is 422 S-QUERY, 400 at the edge); (5) a view's column keys = lead_list's filterable
keys plus `follow_up` and `duplicate` (not in Settled); (6) added limits: 100 views per person, 100 tasks per lead, 16 KiB stored
query; (7) edge codes: view-save 200 {view}, view-delete 204, lead-task add 201 {task}, mark 200 {task, done}, lead-update
follow_up 204 and needs an ISO date-time with an offset; a name already used is 400 I-ANSWER on `name`; (8) service_role needs
EXECUTE on private.phone_key (any new role writing leads would too); (9) staff with MFA can save a private view in a workspace
they are not a member of; (10) T29 captures on workspace B (A's hourly lead limit is used up by earlier tests).

Proof (head, 2026-11-09 22:58 to 2026-11-10 01:08, through heavy.mjs, one run at a time):
- `run-local.mjs --only crm22`: "PASS real migration: ALL TENANCY TESTS PASSED", "OK: real migration passes; 79 mutants" (79 caught).
- `--only crm14`: "OK: real migration passes; 49 mutants"; `--only crm18`: "OK: real migration passes; 6 mutants" (lead_list's checks
  moved into private.lead_query_check: the old groups still catch).
- Deno function tests, scoped with FN_TEST_FILTER to the 3b, lead-update, lead-list and CORS tests (the full run on this machine
  passes the 10-minute harness limit: the 5000-row export test alone took 7m27s; CI's functions job runs everything):
  "ok | 28 passed | 0 failed | 138 filtered out (46s)", "OK: 28 of 28 checks passed (the Deno tests), exit 0".
- `functions/test/mutate.mjs --only crm3b` (same filter): "28 mutants, 28 caught, 0 survived, 0 target text missing" (the
  builder's count of 30 was off; 28 exist).
- NOT RUN yet: CI; staging (migration 22, view-save, view-delete, lead-task, lead-update, lead-list deployed; `e2e-crm-3b.mjs`);
  the head's ruling on the builder's findings 1-10 above; work order 19 (the screens).
Git Bash turns an environment value starting with "/" into a Windows path: set FN_TEST_FILTER from PowerShell.

## The head's rulings on the builder's findings (2026-11-10)
1 accepted: the dry-run preview keeps migration 15's inline rule, and T29c holds the two equal (a later cleanup may route the
preview through private.lead_duplicate_of). 2 accepted: no backfill; the flag starts with leads created after migration 22
(said in 5-crm.md "Duplicates" when the screens land). 3, 4, 5, 6, 7, 8, 10 accepted as built. 9 accepted: staff with MFA act
as an owner everywhere else, so a staff view in any workspace is consistent.

Staging (head, 2026-11-10): migration 22 applied ("OK: applied 1 of 22"); view-save, view-delete, lead-task, lead-update,
lead-list deployed. First run 12:30: 31 of 32, "FAIL a column that is not one is refused naming it (400) 400 {...,"path":""...}"
(an I-ANSWER naming a key with an underscore lost its words; fixed in _shared/db.ts, watched red and green, mutant caught).
After the fix (CI 42825402673, 19 of 19 on 94528a4) the five functions redeployed and `e2e-crm-3b.mjs` again: "PASS a column
that is not one is refused naming it (400)", "PASS the second lead is flagged as a duplicate of the first (owner-a is told
which)", "PASS: CRM block 3b backend on staging, 0 problem(s)" (32 checks). CI on the way: 42718958766 red (the workspace-index
mutant survived: migration 22's indexes also lead with workspace_id; run-local now names uncaught mutants), 42775482582 and
the next run hit the functions job's time limit (crm3b.test.ts made every whole-folder mutant slower; fixed by CLI's 75-minute
limit, then its 4 functions mutant shards, and the isInstant mutants moved to instant.test.ts).
Status: DONE at the land. A13, A14, A17, A18 stay MISSING until work order 19's screens pass their staging flows.
