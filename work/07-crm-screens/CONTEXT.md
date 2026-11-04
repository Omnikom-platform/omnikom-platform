# 07 CRM screens on the block 1 and 2 backend (block 3a)

Owner: platform-build. Model: Sonnet 5.5, effort high. Branch: check/platform/crm-screens (worktree on master). Migration: M18 (`supabase/migrations/20261105000018_lead_list_site.sql`, Settled 10). Status: OPEN (written 2026-11-04 by `HEAD_Platform-build_2026-11-04b`).

## Why
Block 3a of the platform queue (owner's order 2026-11-04: finish every block of `docs/product/1-product.md`). Puts screens on
the backend proven on staging by work orders 01 and 02, so these rows can move to WORKS: A2 every field visible, A3 every field
editable, A9 delete, A10 search, A11 filter, A12 sort, A15 bulk edit, A19 unread bold, A20 CSV export, A21 export in the client's
layout, A22 import, A24 industry fields as columns. Not here: A13 columns, A14 saved views, A17, A18 (block 3b), A16 (owner).

## Inputs (load these, nothing else unless a step needs it)
- `CLAUDE.md`, `work/STATE.md`, this file; `work/01-crm-backend/CONTEXT.md` and `work/02-crm-export-import/CONTEXT.md`
  (Settled and Findings: what the functions take and answer).
- `docs/product/5-crm.md` ("What the CRM does", "Export in the client's layout, and import", the lead record), `6-dashboard.md`
  ("Look", "Rules every screen follows", "Roles on screen"); `docs/blueprint/16-DESIGN-PARTS.md` 1.3 and 1.3b (the plan rows);
  `docs/blueprint/specs/openapi.json` for the request and answer shapes of `lead-list`,
  `lead-update`, `leads-bulk`, `lead-export`, `crm-map-propose`, `crm-template-save`, `lead-import`.
- `apps/dashboard/` (`README.md`; `src/pages/Leads.tsx`, `LeadPanel.tsx`, `AddLead.tsx`, `src/lib/leads.ts` and its test,
  `src/data.ts`, `src/api.ts`, `src/router.tsx`, `built-slices.json`, `tests/plan-gate.*`, `tests/flows.spec.ts`,
  `scripts/ci.mjs`).

## Settled by the head (do not re-open; a reason to change one is a finding)
1. **No visual design** (DECISIONS 52, `6-dashboard.md` "Look"): plain semantic markup in the existing interim tokens and
   module CSS patterns; no new look. Each screen renders clean (no console errors, nothing wider than the screen at 390 px).
2. **The plan first.** Every new control and line of text needs a plan row (`data-plan`, plan gate). Step 1 writes the new and
   changed rows in `16-DESIGN-PARTS.md` 1.3 (ids continuing from DP-1.3-26, slice `5.3c`; rows DP-1.3-05 and DP-1.3-08 keep
   their ids and slice 5.3b; DP-1.3-19 is rewritten: a hard delete through `leads-bulk` with the confirm flag, a confirm sheet,
   no Undo, the export offered first, as `5-crm.md` "Delete" says; the dropped push rows DP-1.3-07 and DP-1.3-18 and the push
   words in DP-1.3-22 are removed). Copy is plain words, short, in the voice of the existing rows. **Send the rows to the head
   and wait for the OK before writing screen code.** `built-slices.json` gains `5.3b` and `5.3c` when their rows are built.
3. **The list** reads `lead-list` (server search, filter on any column, sort on any column, typed) instead of the client-side
   filter; columns are the core fields plus the workspace's industry fields in form order (what `lead-list` answers); the
   existing New / All / Mine / Spam filter and the site switcher stay and become `lead-list` filters; realtime new rows stay
   (a new row is shown on top only when it matches the current filter, otherwise the count says so). Unread rows bold; opening a
   lead sends `lead-update` `read` (A19). Paging: what `lead-list` offers; no infinite invention.
4. **The record** (A2, A3): every field of the lead record (`5-crm.md` "The lead record") is shown with its plain label, core
   and industry, including form, page, flow, cta, site, received date and SMS consent; every editable field edits in place and
   saves through `lead-update` `fields` (one field per save, the toast with Undo where `lead-update` allows it); the consent
   record is read only. A refused value shows the function's plain-word problem inline.
5. **Bulk** (A15, A9): row checkboxes and select-all-on-page; a bar with Set status, Set owner (owner only) and Delete (owner
   only); `leads-bulk`, at most 500, all or nothing. Delete opens a confirm sheet naming the count and offering the export first;
   only the sheet's button sends `confirm: true`. A single delete in the record is a bulk of one.
6. **Export** (A20, A21): the Export button exports the current view (search, filters, sort) through `lead-export`; a choice next
   to it lists the workspace's saved templates ("Omnikom CSV" first = no template). Members export what RLS shows them.
7. **Map and import** (A21, A22; owner only, route `/w/$ws/leads/import`): upload the client's file (at most 1 MB, said before
   upload) -> `crm-map-propose` shows each of their headers with our proposed field and score, unmapped headers, warnings;
   the owner changes any pair and names the CRM -> `crm-template-save`. Then the import: a dry run first (`lead-import`
   `dry_run: true`) shows the row count, the first 20 rows as they would be stored, duplicates, refused rows with field and
   reason; then Skip or Add duplicates, the required tick "These people agreed to be contacted by my business" (the exact
   sentence the backend stores), and Import (`dry_run: false`). A refused import says why and writes nothing (the backend's
   all-or-nothing). A member never sees the route or its button.
8. **Data and cache**: through the existing TanStack Query patterns in `data.ts` and `api.ts`; plain-word problems from
   `lib/problems.ts`. Pure logic (column order, value formatting, the bulk selection, the map pairs) goes in `src/lib/` with
   Vitest units.

9. **lead-export takes the view without a template** (head's ruling 2026-11-04, option b; the book says the export is "CSV of
   the current view"): in `supabase/functions/lead-export/index.ts` a body with `workspace` takes the new shape { workspace,
   search, filters, sort } whether or not it has `template`. With no template it writes block 1's plain CSV from that view:
   the same columns, same order, the 5000 cap and `X-Omnikom-Export-Capped`, one `exported` event per lead, all as the caller
   under RLS. The old { site, filter, q } shape stays unchanged (the CLI and the e2e files use it). Tests in
   `supabase/functions/test/`: no template + a column filter, no template + a sort, the old shape unchanged, each watched red,
   with a mutant in `mutate.mjs` (e.g. drop the filters on the no-template path); `docs/blueprint/specs/openapi.json` and the
   function's header comment updated. "Export the list first" in the delete sheet stays the whole view (`lead-list` has no `id` key).
10. **`site` is a filterable key of `lead-list`** (head's ruling 2026-11-04, option a; the site switcher is a `lead-list`
   filter): M18 `create or replace`s what has to change (`private.lead_value` `when 'site'`, the `types` of
   `service.lead_list` `site: "text"`, a uuid compare), keeping definer, `search_path = ''` and the grants exactly as M14 has
   them. Walls in `supabase/tests/run-local.mjs` (`tenancy.test.sql`), each watched red with a mutant: a site filter returns only
   that site's leads; a site of another workspace returns none. M17 is the settings order's; the head renumbers at the land
   if a tool refuses the order.

## Steps
1. The plan rows (2); send them to the head; wait for the OK.
2. The list (3) and the record (4).
3. Bulk and delete (5).
4. Export and the template choice (6).
5. The map and import screens (7).
6. Playwright: extend `tests/flows.spec.ts` (staging, workspace A, leads marked `{"test": "crm-screens"}` in answers, cleaned up
   in the spec's teardown through `leads-bulk` with confirm): search narrows; a filter on an industry column; sort by budget; edit
   one industry field and see the `edited` line in the timeline; bulk set status on 2 marked leads; delete 1 through the sheet;
   export the view and read the file's header row; propose, save and dry-run import a synthetic 3-row file (nothing written);
   member-a1 sees no import route and no Delete. The DOM plan gate runs on every new screen. Write the steps for the head; the
   builder runs nothing on staging.
7. The book in place, in the land commit (head of operations' files, by its instruction): `1-product.md` rows A2, A3, A9, A10,
   A11, A12, A15, A19, A20, A21, A22, A24 to WORKS where the screen and the flow prove them, the counts; `5-crm.md` "The CRM
   features named MISSING / PARTLY" paragraph; `work/STATE.md` (block 3a).

## Outputs
- `apps/dashboard/src/pages/` (Leads, LeadPanel, new Bulk / Import pages and their module CSS), `src/lib/` (+ tests),
  `src/data.ts`, `src/api.ts`, `src/router.tsx` (only the leads routes), `built-slices.json`, `tests/flows.spec.ts`;
  `docs/blueprint/16-DESIGN-PARTS.md` 1.3 and 1.3b only. This file as `work/07-crm-screens/CONTEXT.md`.
- `supabase/functions/lead-export/index.ts` and its tests in `supabase/functions/test/`, `supabase/functions/test/mutate.mjs`,
  `docs/blueprint/specs/openapi.json` (Settled 9); `supabase/migrations/20261105000018_lead_list_site.sql`, `supabase/tests/run-local.mjs`,
  `tenancy.test.sql` (Settled 10). Nothing else in `supabase/`. Work order 08 (settings) runs in parallel on `src/pages/Settings*`, `Shell.tsx` and plan section 1.6:
  do not touch those; the router and `built-slices.json` are shared (one hunk each; the second to land rebases).

## Rules for this order
- The builder never commits, pushes, applies to staging, deploys or publishes; it hands the head the staging steps.
- Before reporting done, run locally every suite CI runs on what changed: `node apps/dashboard/scripts/ci.mjs` (type check,
  units, plan gate) and the dashboard mutants it names; `tools/omnikom-cli/test/run.mjs` if the CLI reads anything changed. The
  full `run-all-gates.mjs` is CI's (rule 8). Long runs through `~/.claude/scripts/heavy.mjs`.
- A plan row that is missing, a backend answer that does not fit the screen, a copy question: stop and send it to the head, do
  not invent. No sample data in the app source.

## Done when
- `node apps/dashboard/scripts/ci.mjs` OK (pasted), each new unit watched red; CI 9 of 9 on the check branch; landed.
- On staging after the land (the head runs `build-staging.mjs`, `preview-staging.mjs` and the Playwright flows, after asking
  the CLI head for an owner-a window): every new flow passes, the DOM plan gate 0 problems, no console errors; then
  `e2e-crm.mjs`, `e2e-crm-io.mjs` and `e2e-screens.mjs` still 0 problems; M18 applied first (`e2e-crm` still 0 problems), and
  `lead-export` redeployed.

## Proof
(filled by the head with pasted lines)

## Findings
(the builder writes here, one line each, and sends them to the head)
- F1 (ruled 2026-11-04, option a): `lead-list` had no `site` key, so the site switcher could not be a filter; M18 adds it (Settled 10).
- F2 (ruled, option b): `lead-export` without a template read only { site, filter, q } and ignored column filters and sort; it now takes the view shape with `workspace` (Settled 9).
- F3 (ruled): `lead-list` has no `id` key (its `types` are the core columns and the industry columns), so an export of exactly the selection is not possible; the delete sheet's "Export the list first" exports the whole current view, a superset of the selection.
- F4 (ruled): `lead_reads` has no backfill, so every lead without a row of this login shows in bold, old ones included, until opened (DP-1.3-08).
- F5 (ruled): `lead-import`'s `date` (us | eu) is left at its default and has no plan row; it only matters for industry date fields, because the import does not read the file's received date.
- F6: the owner column sorts by the team row's id, not by the person's name (`lead-list` sorts the stored key); the form column sorts by the form's slug, not its label; a filter "is" on the form column needs the slug. Sorting by name needs a backend join.
- F7: the three flow leads cannot carry `{"test": "crm-screens"}` in their answers: capture drops any answer key the contract does not declare (work order 01 F4). They are marked by name ("crm-screens <RUN> ...") and the spec removes them through `leads-bulk` with confirm, by the ids found for this run.
- F8: `crm-map-propose` does not answer the file's header order: the map shows the mapped headers first (as proposed, with their score), then the unmapped ones.
- F9: the import has no "use a saved layout" shortcut (not in Settled 7): each import goes through the map step, and saving the same CRM name again updates that layout.
- F10: the dry run's `sample` rows are read as { line, name, email, phone, status, owner, answers } (`lead-import/index.ts` line 54) and flattened for the table; how the database returns them after typing is UNPROVEN until the flow runs on staging.
- F11: the old flow mutant `member-sees-all` served the leads table as the service role; the list is now `lead-list`, so it answers that call with owner-a's list (tests/mutants.ts). UNPROVEN until it is run.
- F12: `node apps/dashboard/scripts/ci.mjs` was not run as one command: its first step is `npm ci`, which with the node_modules junction (the head's instruction) would empty the main checkout's install. Its other steps were run one by one (see the report).
- F13 (accepted by the head): the T24b wall of M18 (a site of another workspace returns none) has two layers (the workspace cut and the row-level rules), so no single-layer mutant turns T24b red by itself; the both-layers mutant "crm18: a site filter reaches across workspaces" is caught by T22c, and `run-local.mjs --only crm18` ends "OK: real migration passes; 6 mutants".
