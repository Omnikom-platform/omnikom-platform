# 02 CRM export and import in the client's own format

Owner: platform-build. Model: Opus 5.5, effort high. Branch: check/platform/crm-2 (fresh worktree on master). Status: OPEN, not
started (written 2026-11-03 by `HEAD_Platform-build_2026-11-03a` at a usage stop; the next platform head starts the builder).

## Why
Block 2 of 5 of the platform department (head of operations, 2026-11-03). Moves `docs/product/1-product.md` A20 (CSV export),
A21 (export in the client's CRM layout), A22 (import the client's file), C11's import consent half, and F3 of work order 01
(`service.add_lead` stores answers untyped). The book (`5-crm.md`): "A lead reaches the client's own CRM as an export in that
CRM's layout, which they upload, and their file comes back through the same map. There is no automatic push." Backend only;
the screens are block 3.

## Inputs (load these, nothing else unless a step needs it)
- `CLAUDE.md`; `docs/product/5-crm.md` ("Export in the client's layout, and import", the lead record), `3-database.md` (Leads,
  the wall), `4-backend.md` (How a call is checked, the Edge Functions), `11-rules.md`; `work/01-crm-backend/CONTEXT.md`
  (Settled items and Findings: what block 1 built).
- `tools/crm-map/` (`README.md`, `map.mjs`: proposeMap, validateTemplate, exportRows, importRows, toCsv, parseCsv; `dictionary.mjs`;
  `templates/`; `test/`). This is cli-and-testing's library: import it, do not change it (see Rules).
- `supabase/migrations/` (M3 `crm_templates`, `save_crm_template` as last replaced in M8; M8 `add_lead`; M14 `lead_columns`,
  `typed_answers`, `lead_list`), `supabase/functions/{_shared,lead-export,add-lead,lead-list}/`, `supabase/functions/test/`,
  `supabase/tests/run-local.mjs`, `tenancy.test.sql` (T22), `e2e-crm.mjs`, `e2e-screens.mjs`.

## Settled by the head (do not re-open; a reason to change one is a finding)
1. **Our fields for the map** are the core lead fields plus the workspace's industry fields from `private.lead_columns` (label,
   type, options), in form order. `proposeMap` receives that list; nothing per industry in code.
2. **Propose:** Edge Function `crm-map-propose` (owner only): body = the client's header row and at most 20 sample rows (or a CSV
   of at most 1 MB, parsed with `parseCsv`); answer = the proposed template, the score per pair, unmapped headers and the library's
   warnings. It stores nothing. A pair below 0.5 is never assigned (the library's rule).
3. **Confirm and save:** Edge Function `crm-template-save` (owner only) runs `validateTemplate`, then `service.save_crm_template`;
   one template per workspace and CRM name, a re-save is a new version of the same row (the function's existing shape). Every
   industry field the template names must exist in `lead_columns` (refused otherwise, plain words naming the field).
4. **Export in their layout:** `lead-export` takes an optional `template` id: with it, `exportRows` writes the leads of the caller's
   view (the same `lead_list` query: search, filters, sort; at most 5000 rows) in the template's column order, phones and dates in
   the client's form, value maps applied, the formula guard on every cell, industry columns included; without it, block 1's
   one-column-per-field CSV. One `exported` event per lead either way. Members export only what RLS shows them (as today).
5. **Import, dry run first:** Edge Function `lead-import` (owner only): body = the file (CSV, at most 5 MB) and a template id;
   `dry_run` defaults to true. A dry run parses (`parseCsv`), maps (`importRows`) and returns the first 20 rows as they would be
   stored, the row count, duplicates (same email, lower-cased, or same phone in E.164, against the workspace's leads and within
   the file), rows refused with the field and reason (typing as capture: `private.typed_answers` against `lead_columns`), and the
   library's warnings. It writes nothing. A real run (`dry_run: false`) takes `duplicates: "skip" | "add"` and `consent: true` and
   creates the leads through a new `service.import_leads` (M15): all or nothing, form `import`, answers typed, owner = the owner
   unless a mapped column names a team member of the workspace, one `received` event per lead (detail `{import: true}`), one
   consent ledger row per lead, one audit row for the call with the file's sha256 and the counts.
6. **Consent of imported leads** (the book's open question, settled the way A8 settled hand-entered leads): the import is refused
   unless the owner ticks "These people agreed to be contacted by my business"; that sentence plus the date and the file's name is
   stored as each lead's `consent_text`; marketing and SMS consent are false. No new owner question.
7. **Size is measured, not guessed:** the Edge Function limit is 2 s CPU. Measure parse + map of 1000, 2000 and 5000 rows in the
   function harness and set the import row cap to the largest that stays under 1 s CPU (at most 5000); write the measured numbers
   in `4-backend.md`. If 5000 does not fit, the cap is lower and that is said, never a silent truncation (a file over the cap is
   refused with plain words).
8. **F3:** `service.add_lead` types its answers with `private.typed_answers` against `lead_columns` (a bad value is a 400 naming
   the field, as capture), in the same migration.
9. **The two shipped templates** (HubSpot, Google Contacts) are checked against the header lists in those vendors' public import
   docs (URL and the date read in the test); a real client export is never copied into the repository (`11-rules.md` 26).

## Steps
1. M15: `service.import_leads`, `add_lead` typed, any helper; definer, `search_path = ''`, closed to PUBLIC, granted to
   `omnikom_fn`; `save_crm_template` gains the industry-field check if it lives in SQL. Walls with a test watched red and a mutant
   each, at least: a member saves a template / imports (refused), an import into another workspace (not found), a refused row
   stores nothing (all or nothing), import without the consent tick (refused), duplicates skipped when "skip", `add_lead` with a
   bad typed answer (refused).
2. Functions `crm-map-propose`, `crm-template-save`, `lead-import` (new), `lead-export` with `template`; importing
   `tools/crm-map/map.mjs` the way `_shared/contracts.ts` imports `contracts/validate.mjs`; `config.toml`, `deno.json`,
   `local-serve`, the CORS test and `openapi.json` updated as block 1 did. Tests in `supabase/functions/test/`, mutants in
   `supabase/functions/test/mutate.mjs`.
3. The CPU measurement (7) and the cap.
4. Staging proof script `supabase/tests/e2e-crm-io.mjs` (staging only, synthetic data, run marker in names and emails, cleans up in
   a `finally` through `leads-bulk` with confirm): as owner-a, propose a map from a synthetic file with HubSpot-style headers that
   include budget and timing; save it; export the two marked leads in that layout (header order equals the template, budget and
   timing columns present, phone in the template's form); import that export back as a dry run (2 rows, 2 duplicates, nothing
   written); import a fresh synthetic file of 3 rows (1 duplicate, 1 with a bad budget) with "skip": refused as a whole for the bad
   row, then fixed and re-run: 2 leads created, typed, form `import`, the consent sentence stored; member-a1's save and import
   refused. One PASS/FAIL line per check.
5. The book in place (head of operations' files, by its instruction): `1-product.md` A20, A21, A22, C11, the counts; `5-crm.md`
   (export and import, the consent of imported leads now settled, "what exists / what is missing"); `3-database.md` (functions);
   `4-backend.md` (functions table, the measured cap); `work/STATE.md` (the import consent question removed). A row moves to
   WORKS only when its screen exists; the backend half is written as "backend proven on staging (e2e-crm-io <date>)".

## Rules for this order
- `tools/crm-map/` belongs to cli-and-testing. Import it; if the library needs a change (for example it cannot take industry
  fields), that is a finding with options to the head, who routes it; a fixture value is the only light follow-on allowed.
- The builder never commits, pushes, applies to staging, deploys or publishes; it hands the head the staging steps.
- Before reporting done, run locally everything CI runs on what changed, not only `run-all-gates.mjs` (block 1's lesson: CI went
  red on `supabase/functions/test/mutate.mjs` and on the CLI unit tests `tools/omnikom-cli/test/run.mjs`, which the builder had
  not run): both of those, plus factory tests if touched.
- No screens, no design work, nothing against a client site or production; keys by variable name only; scripts in files; long runs
  in the background through `~/.claude/scripts/heavy.mjs`; anything outside this order is a finding.

## Done when
- The walls above are tests watched red, each with a mutant caught: `node supabase/tests/run-local.mjs` "0 escaped" with the new
  mutants named; `node supabase/functions/test/mutate.mjs` "N mutants, N caught, 0 survived, 0 target text missing";
  `node tools/omnikom-cli/test/run.mjs` all passed; `node docs/blueprint/specs/run-all-gates.mjs` "all gates passed".
- CI 9 of 9 on the check branch, landed by `omnikom land`.
- On staging after the land (head runs: apply M15, deploy the 4 functions and `add-lead`, `e2e-crm-io.mjs`): every line PASS; then
  `e2e-crm.mjs` and `e2e-screens.mjs` still 0 problems.
- The book rows changed in place in the commit that lands the staging lines.

## Proof
(filled by the head with pasted lines)

## Findings
(the builder writes here, one line each, and sends them to the head)
