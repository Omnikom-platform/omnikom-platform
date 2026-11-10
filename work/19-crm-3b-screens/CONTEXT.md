# 19 CRM block 3b screens: columns, saved views, follow-up and tasks, duplicates

Owner: platform build. Model: Sonnet (high). Branch: check/platform/crm-3b-screens (a worktree on master once work order 18 has
landed). No migration. Status: SCREENS BUILT 2026-11-10 (builder), NOT PROVEN on staging; plan rows DP-1.3-51 to -74 OK'd by the head 2026-11-10; the head runs the flows after CI is 9 of 9.

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
Send to the head; never fix here. (Builder, 2026-11-10.)
1. **`follow_up` and `duplicate` cannot be sorted or filtered by a column filter**: `private.lead_query_check` types only the core keys and the industry `column: true` keys, so lead-list answers S-QUERY for them. They are display-only columns (plan row DP-1.3-54: plain headings, no sort button); the Due and Duplicates ticks are how the list finds them. Head ruled: accepted for now; a later backend order may add them to `lead_query_check`.
2. **No "Stop sharing"** on a shared view (head ruled 2026-11-10): an owner who shares by mistake deletes the view and saves it again. The owner may ask for a control later (`view-save` with `shared: false` already makes the view the caller's own).
3. **The list's "Possible duplicate" cell is plain words, not a link** (plan row DP-1.3-58 amended): `tests/flows.spec.ts:291` opens a lead with `rowOf(page, name).getByRole('link').click()`, which is strict, and its three synthetic leads share one phone number, so all three are now flagged; a second link in the row would break that flow, which must pass unchanged. The link to the older lead is in the record (DP-1.3-73).
4. **Export ignores Due and Duplicates**: `lead-export` takes `search`, `filters` and `sort` only, so with the Due or Duplicates tick on, Export (and the delete sheet's "Export the list first") writes the leads without that tick. The screen sends only what the function takes. A backend order could add the two keys to `lead-export`.
5. **The new flows mark their leads by name** (`crm-3b <RUN> ...`), as block 3a's do, not by `{"test": "crm-3b"}` in the answers: `add-lead` types an answer against the contract and a name needs no contract field. The teardown removes the leads (leads-bulk with confirm) and the views by that marker.
6. **A saved view that the controls cannot say**: a stored filter with `in` of several values on a column is counted (`fromSaved().dropped`) and not shown; a view made by the screen never has one. A stored query with no status filter reads as All. Neither has wording in the plan.
7. **The view is in the route's search params and every change replaces the history entry** (no back-button step per keystroke or tick). Links to the panel, Add a lead, Import, Back to leads, See the leads, the panel's Close, the delete sheet's close and the rail's Leads carry the address along (`search: prev => prev`), which is how block 3a's list stayed as it was.
8. **`node apps/dashboard/scripts/ci.mjs` runs `npm ci`, which deletes `node_modules`**: this worktree's `node_modules` is a Windows junction to `code/main/apps/dashboard/node_modules` (same package-lock.json, SHA-1 107566f9...), made because the machine lock queued `npm ci` behind a video render. The junction must be removed (`cmd /c rmdir`, never a recursive delete) before anything runs `npm ci` in this worktree. It is removed now; this worktree has no `node_modules`.
9. **BLOCKED: `node apps/dashboard/scripts/ci.mjs` was not run.** `heavy.mjs` waited 30 minutes behind a video render (`heavy: gave up after 30 min ... Nothing was run`, exit 75). Unblock: run it when the lock is free (`node ~/.claude/scripts/heavy.mjs --label "dashboard ci" -- node apps/dashboard/scripts/ci.mjs`); it does the locked `npm ci` itself. What did run: `tsc --noEmit` exit 0 and `vitest run` 10 files, 193 tests, exit 0 (all of that step's unit tests and the plan gate), on the finished tree. NOT RUN: the two Auth email checks of ci.mjs, `vite build`, any Playwright flow, any render of the screens (the flows need staging sign-in).

## Staging proof (platform head, 2026-11-10)

- flows.spec.ts, first run on dfc1a6c: 8 passed, 3 failed, 1 skipped. Causes:
  - :137: `/leads/new` now keeps the list's view in the address (`?f=all`), so the old check was too strict.
  - :548: the task tick moved only after the answer ("Clicking the checkbox did not change its state").
  - :622: the headers were read before the new view's rows arrived.
- Fixed in 2491738 (LeadTasks: the tick shows at once and is disabled until the read-back agrees; the tests wait).
- Second run: 9 passed, 2 failed, 1 skipped. The 3b owner test read the database under the first save's toast, and
  member-a1 had no leads, so no table. Fixed in 77ff128.
- The two 3b describes then passed (2 of 2).
- plan-gate.spec.ts: 6 of 6.
- CI 42850062911 green on 2491738.
- Book: A13, A14, A17 and A18 are WORKS. A20 notes finding 4 (the export ignores the Due and Duplicates ticks).
- Finding 9 (`ci.mjs`): GitHub's dashboard job ran it (CI above), not run locally (rule 8).
- The 390 px look (head of operations: part of acceptance), run after the land was stopped. styles.spec.ts with SHOTS found four faults: the picker's Move buttons wrapped under each label, Columns and Views each took a row, the Due and Duplicates ticks had no gap (`css.ticks` was undefined; the class is in Crm.module.css), and the phone bar's Sign out sat on Settings (since 08). Fixed in a2ba2c4, with checks for the bar overlap (red on the old build: "Settings / Sign out") and for the picker lines (red with its CSS removed: 17 columns flagged). Full styles.spec.ts: 26 passed.
