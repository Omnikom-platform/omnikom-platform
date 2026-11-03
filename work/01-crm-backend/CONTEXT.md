# 01 CRM backend

Owner: platform-build. Model: Opus 5.5, effort high. Branch: check/platform/crm-1 (worktree
`C:\Users\DELL\AppData\Local\Temp\omk-wt-crm1`, base master bb1dbe1). Status: DONE 41ab89a, CI run 41589140733; staging e2e-crm 16/16 PASS 2026-11-03.
Head: `HEAD_Platform-build_2026-11-03a`. Builder: `BUILDER_platform-build_crm-1`.

## Why
Block 1 of 5 of the platform department: the CRM's backend. Moves `docs/product/1-product.md` rows A3 (every field editable),
A7 (edit events in the timeline), A9 (delete, through a function), A10 (search), A11 (filter), A12 (sort), A15 (bulk edit),
A24 (industry fields as columns, backend half), D2 (contract flags), D5 (choice and number fields render), D7 (test site has an
industry form), D10 (contract fields flow into the CRM). Owner's words, in the book (`5-crm.md`): "a full CRM, not an inbox:
every lead field is visible and editable, the columns follow the business's industry". Backend only; the screens are block 3.

## Inputs (load these, nothing else unless a step needs it)
- `CLAUDE.md`; `docs/product/5-crm.md` (whole), `3-database.md` (Leads, the wall, Database functions), `4-backend.md`
  (How a call is checked, the Edge Functions), `7-sites.md` (The contract, Forms, The test site), `11-rules.md`.
- `supabase/migrations/` (M2 crm, M4 hardening `lead_update` and `delete_lead`, M7 `capture_lead`, M8, M12, M13),
  `supabase/functions/{_shared,capture-lead,lead-update,lead-export,add-lead}/`, `supabase/functions/test/`,
  `supabase/tests/run-local.mjs`, `tenancy.test.sql`, `e2e-lead.mjs`, `e2e-functions.mjs`.
- `contracts/` (`README.md`, `validate.mjs`, the generator, `test/run.mjs`, `mutate.mjs`), `contracts/industry-run/`.
- `sites/test-demo-a/` (`make-contract.mjs`, `contract.json`, `design/sections/form.mjs`, `publish.mjs`), `factory/build.mjs`
  and its form rendering, `factory/worker/lead-endpoint.mjs`.

## Settled by the head (do not re-open; a reason to change one is a finding)
1. **Industry fields stay in `leads.answers`** (jsonb, keyed as in the contract). No column per industry and no migration per
   client: "a column" means the server list, the export and the record expose it as one. Nothing per industry in code.
2. **The contract declares, per form field:** `type` (text, email, tel, number, select, choice/multi, date, tick at least),
   `options` for select/choice, `min`/`max` for number, `required`, and two new flags `column` (shown as a CRM list column,
   default true) and `editable` (default true). `contracts/validate.mjs` validates them (new `C-*` codes, tests, mutants).
3. **Capture validates typed.** A submitted industry answer is checked against the site's active resolved contract form:
   a number is stored as a JSON number, a select value must be one of its options, unknown keys are dropped (not stored),
   a bad value is refused with a plain-word 400 problem naming the field. The check that stores must be in the database
   (`service.capture_lead`) so no caller can skip it; the function may pre-check with `validate.mjs` for the message.
4. **One edit call:** `service.lead_set_fields(p_claims, p_lead, p_fields jsonb)` edits any core field (name, email, phone,
   status, owner; not the consent record: `consent_text`, `marketing_consent`, `sms_consent`, never) and any industry field the
   contract marks `editable`, with the same typing as capture. One `lead_events` row of a new kind `edited` per changed field,
   detail `{field, old, new}`; unchanged values write nothing; one `audit_log` row per call. A member edits only leads it can
   act on (`private.can_act_on_lead`); only an owner changes the owner (as A5 today). Exposed through the existing
   `lead-update` function (a `fields` body), not a new function. `edited` is added by a new migration (M14); applied migrations
   are never edited.
5. **Server list:** `service.lead_list(p_claims, p_workspace, p_query jsonb)`: search over every core and industry text value,
   filter on any column (equals, in, range for numbers and dates, empty/not empty), sort on any column with the contract's type
   (a number field sorts as a number), stable tie-break on `created_at, id`, page size at most 200, total count. It returns
   exactly what RLS would let the caller read (a member: own leads only): prove it with a member and a non-member, not by
   reading the code. Edge function `lead-list` (user JWT, the same frame as the others). Sort and filter keys are checked
   against the contract and the core list; no caller text is ever spliced into SQL.
6. **Bulk:** `service.leads_bulk(p_claims, p_workspace, p_ids uuid[], p_action, p_value, p_confirm boolean default false)` for
   status, owner (owner only) and delete (owner only). Delete stays a hard delete (head of operations' ruling 2026-11-03, as
   privacy requires; not an owner question): it is refused unless `p_confirm` is true, writes one `audit_log` row per lead
   (as `delete_lead` does), keeps the consent ledger; the screen's confirm step is block 3. At most 500 ids; status and owner
   write one event per lead and one audit row for the call; all or nothing (an id the caller may not act on refuses the whole call with
   "not found", no partial write). Edge function `leads-bulk`. A9 single delete goes through the same path (bulk of one) so a
   screen has a function to call.
7. **The test site gets a real-estate form**, generated by `sites/test-demo-a/make-contract.mjs` (contract.json stays equal to
   its output): budget (number, min/max), timing (select: 0-3 months, 3-6 months, 6-12 months, just looking), beds (number
   0-10), area (select of the site's areas), buying or selling (choice). Synthetic only. The factory renders select, choice and
   number fields with no script (D5), the factory gates and render gate stay green.
8. **Port map and process rules hold** (`11-rules.md` 20-23): any new local cluster uses an existing harness's block.

## Done when (head of operations' condition, 2026-11-03)
Storing industry fields in `answers` is accepted only if every user-visible behaviour is a real column:
- each industry field with `column` true is returned by `lead_list` as its own named, typed column, editable through
  `lead_set_fields`, and searchable, filterable and sortable on the server;
- where a sort or filter needs it, an expression index on `answers` (per workspace, built from the contract, not per industry
  in code; if a generic index cannot serve it, that is a finding with options before building), and the sort on an industry
  number field is proven on a 200-lead seed (order checked lead by lead, plus `explain` showing the index is used or a written
  reason it is not needed at that size);
- `lead-export` writes every core field and every industry column as its own CSV column (no answers-in-one-cell), formula
  guard kept;
- bulk delete refused without the confirm flag (wall + mutant), one audit row per deleted lead (test counts them).

## Steps
1. Contract: the field flags and types in `contracts/` with their `C-*` checks, tests watched red then green, mutants; the 15
   industries still pass (`contracts/industry-run`); the test site's form as in 7.
2. Factory: select, choice and number fields render and post with no script; the gates and the test site build green.
3. Database M14: `edited` kind, typed capture (3), `lead_set_fields` (4), `lead_list` (5), `leads_bulk` (6), each definer with
   `search_path = ''`, closed to PUBLIC, granted to `omnikom_fn` only. Every new wall gets a test in
   `supabase/tests/run-local.mjs` (or the SQL it runs) watched failing for the right reason, and a mutant that removes that wall
   and turns it red. Walls at least: member edits a lead not theirs (refused), member changes owner (refused), consent field
   edit (refused), non-editable industry field (refused), bad type (refused), member's list shows only own leads, other
   workspace's list is empty, bulk with one foreign id writes nothing, sort/filter key not in the contract refused.
4. Functions: `lead-update` fields, `lead-list`, `leads-bulk` (confirm flag passed through), `lead-export` with every column,
   capture's plain-word problems; tests in `supabase/functions/test/`.
5. A staging proof script `supabase/tests/e2e-crm.mjs` (staging only, synthetic data, marks its leads so
   `e2e-cleanup.mjs` style cleanup can remove them, and removes them in a finally): post a lead through the test site's
   published form with industry fields, read it back typed, edit a core and an industry field as owner-a and see two `edited`
   events, a member's edit of a foreign lead refused, list with search, filter and sort on an industry number field, bulk status
   on two leads, bulk delete of the test leads. It prints one PASS/FAIL line per check.
6. The book, in place (no appended paragraphs): `docs/product/1-product.md` rows and the counts table, `5-crm.md` (the lead
   record, what the CRM does, the test that proves the CRM; the Delete row and the "hard delete ... open owner question"
   paragraph rewritten in place to the ruling: hard delete as privacy requires, explicit confirm, one audit row per lead,
   consent ledger kept; and the Delete question removed from `work/STATE.md` open owner questions), `3-database.md` (functions, `edited`, what the tables do not hold),
   `4-backend.md` (functions table), `7-sites.md` (forms, the test site). A row moves to WORKS only when the staging proof
   printed it. These are the head of operations' files, changed in the same commit by its instruction; name them in the report.

## What the builder does not do
Never commits, pushes, applies a migration to staging, deploys a function or publishes the test site: it proves everything
locally and hands the head the exact staging steps (apply M14, deploy the three functions, publish the test site, run
`e2e-crm.mjs`). No dashboard screens, no design work, nothing in `tools/omnikom-cli/` (a journey step is a finding for CLI and
testing), nothing against a client site or production. Keys by variable name only. Scripts in files. Long runs in the
background with bounded waits; mechanical runs to Haiku agents with the exact command. Anything outside this order is a
finding sent to the head, not a fix.

## Outputs
- `contracts/` (flags, checks, tests, mutants), `sites/test-demo-a/` (form), `factory/` (field rendering),
  `supabase/migrations/2026110300000014_crm_fields.sql` (name may differ, after M13), `supabase/functions/{lead-update,lead-list,
  leads-bulk,capture-lead}/`, `supabase/tests/` (walls, mutants, `e2e-crm.mjs`), `supabase/config.toml` if functions need it,
  the book lines in step 6, this order's status line.

## Proof (pasted lines, on the combined tree)
- `node supabase/tests/run-local.mjs` -> every wall held, the mutant count with 0 escaped (each new mutant named).
- `node contracts/test/run.mjs` and `node contracts/test/mutate.mjs` green; `contracts/industry-run` 15 of 15.
- `supabase/functions/test/` green; factory tests green; test site build green.
- `node docs/blueprint/specs/run-all-gates.mjs` -> "all gates passed", T14 green.
- Each new test watched red first: the output line before the fix, and with its mutant.
- Staging (head runs after the commit): `node supabase/tests/e2e-crm.mjs` -> every line PASS.

## Findings
(builder writes here, one line each, and sends them to the head)
- F1 index (ruled: option a): no per-key index; list cut by workspace, sorted in memory; measured in `supabase/tests/crm-scale.sql`; revisit at ~50k leads a workspace.
- F1b ready design if needed: side table `lead_values(workspace_id, lead_id, key, num numeric, txt text)` kept by an answers trigger, indexes `(workspace_id, key, num)` and `(workspace_id, key, txt)`; answers stays the source.
- F2 (ruled): jsonb keeps no key order, so the resolved contract carries `leadColumns` (an array, `contracts/validate.mjs`); `stage.mjs` writes it; the DB uses it for order only.
- F2b for CLI and testing: `tools/omnikom-cli/commands/seed.mjs` TEST_CONTRACT has no `forms` and no `leadColumns`: a seeded workspace stores no answers (undeclared form) and lists columns in jsonb order. Not fixed here (not this department's file).
- F3 (recorded): `service.add_lead` (manual leads) stores answers untyped; leave for a later slice.
- F4: a form the active contract does not declare is accepted with every answer dropped (a lead is never lost), not refused (reverses report 1's I-FORM).
- F5: type names kept as the contract had them: select = `enum`, tel = `phone`, tick = `boolean`; new `choice` (+ `multi`); `reference` = a select of a collection's rows (value = slug, checked to exist on capture and edit).
- F6: `lead-export` writes every industry field (columns and non-columns, `lead_list.fields`) so nothing is lost from the old answers cell; `e2e-screens.mjs`'s header check now reads the test site's contract.
