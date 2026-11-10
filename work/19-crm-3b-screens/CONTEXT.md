# 19 CRM block 3b screens: columns, saved views, follow-up and tasks, duplicates

Owner: platform build. Model: Sonnet (high). Branch: check/platform/crm-3b-screens (a worktree on master once work order 18 has
landed). No migration. Status: OPEN 2026-11-10 (head wrote it); starts after 18 lands.

## Why
The screens on work order 18's backend, so rows A13 (choose the columns), A14 (saved views), A17 (follow-up date and tasks) and
A18 (duplicate flag) of `docs/product/1-product.md` can move to WORKS when the staging flows pass. Same shape as block 3a
(`work/07-crm-screens/CONTEXT.md`).

## Inputs (load these, nothing else unless a step needs it)
- `CLAUDE.md`, `work/STATE.md`, this file; `work/18-crm-3b-backend/CONTEXT.md` (Settled, Findings, the head's rulings, the
  function shapes); `work/07-crm-screens/CONTEXT.md` (how block 3a was built and proven).
- `docs/product/5-crm.md` ("What the CRM does"), `6-dashboard.md` ("Look", "Rules every screen follows", "Roles on screen");
  `docs/blueprint/16-DESIGN-PARTS.md` 1.3 (the plan rows); `docs/blueprint/specs/openapi.json` (`lead-list`, `view-save`,
  `view-delete`, `lead-task`, `lead-update` `follow_up`).
- `apps/dashboard/` (`src/pages/Leads.tsx`, `LeadPanel.tsx`, `src/lib/leads.ts` and its test, `src/data.ts`, `src/api.ts`,
  `built-slices.json`, `tests/plan-gate.*`, `tests/flows.spec.ts`, `scripts/ci.mjs`).

## Settled by the head (a reason to change one is a finding)
1. **No visual design** (DECISIONS 52): plain semantic markup in the interim tokens and module CSS patterns of block 3a. Each
   screen renders clean (no console errors, nothing wider than the screen at 390 px).
2. **The plan first.** Every new control and line of text needs a plan row (`data-plan`, the plan gate). Step 1 writes the new
   rows in `16-DESIGN-PARTS.md` 1.3 (ids continuing from the last DP-1.3 id, slice `5.3d`), plain short words in the voice of
   the existing rows. **Send the rows to the head and wait for the OK before writing screen code.** `built-slices.json` gains
   `5.3d` when its rows are built.
3. **Columns (A13):** a Columns control on the list picks and orders the columns among the keys `lead-list` answers plus
   `follow_up` and `duplicate`. The unsaved choice lives in the page address (so a copied link keeps it); no new storage.
4. **Saved views (A14):** a Views control lists the caller's own views and the shared ones (a plain RLS read of `crm_views`),
   applies one (its query and columns into the page address), saves the current view under a name (Save as / Save), shares
   it (owner only: the control is not shown to a member), and deletes one (the caller's own; an owner's for shared). The
   function's problems show inline in plain words (a taken name on the name field).
5. **Follow-up and tasks (A17):** the record shows the follow-up date and time with a way to set, change and clear it
   (`lead-update` `follow_up`, an instant with the browser's offset); a Tasks block lists the lead's tasks (open first, due
   date, done tick) with Add (text up to 500, an optional due) and Done or Reopen (`lead-task`). The list gets a Due filter
   (`due: true`) and the follow-up column.
6. **Duplicates (A18):** a flagged lead shows a plain "Possible duplicate" mark in the list and in the record; when the caller
   can see the other lead, the mark links to it; otherwise it says only that another lead matches. The list gets a Duplicates
   filter (`duplicates: true`). Nothing merges.
7. **Data:** through the existing TanStack Query patterns of `data.ts` and `api.ts`, plain-word problems from
   `lib/problems.ts`; pure logic (the column list, the address encoding of a view, task ordering) in `src/lib/` with Vitest
   units, each watched red.

## Steps
1. The plan rows; send them; wait for the OK.
2. Columns and saved views (3, 4); follow-up and tasks (5); duplicates (6).
3. Playwright in `tests/flows.spec.ts` (staging, workspace A, synthetic leads marked `{"test": "crm-3b"}`, cleaned in the
   teardown): pick and reorder columns and see the address keep them; save a private view and a shared one as owner-a, see the
   shared one as member-a1 and no Share control there; set a follow-up and see the Due filter find it; add and finish a task;
   a second lead with the first one's email shows the duplicate mark and the Duplicates filter finds it. The plan gate covers
   every new control.
4. `node apps/dashboard/scripts/ci.mjs` green; the head runs the flows on staging after CI is 9 of 9.
5. Book: A13, A14, A17, A18 evidence cells name the screens; the states move only after the staging flows (the head).

## Rules for this order
The builder never commits, pushes, applies to staging, deploys or publishes. Heavy runs (Playwright) only through
`~/.claude/scripts/heavy.mjs`, one spec file per run. Keys by variable name only; scripts in files. Check free space on E: first.

## Proof
(filled by the head with pasted lines)

## Findings
Send to the head; never fix here.
