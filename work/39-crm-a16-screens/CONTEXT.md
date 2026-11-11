# 39 CRM A16 screens: the owner's status board (dashboard)

Owner: platform build. Model: Sonnet (high). Worktree: `departments/platform-build/builders/crm-a16-screens`, on master 9b0bb8a (work order 20's backend landed,
migration 23 on staging). Goal: book row A16 PARTLY -> WORKS. Status: BUILT 2026-11-11, NOT COMMITTED; lib tests and the plan gate seen green, the staging flows and the 390 px / laptop shots NOT RUN (they wait for the head's go and the heavy lock). The builder never commits or pushes.

## Why
Owner ruling 2026-11-09 (`docs/product/5-crm.md` "The lead record"): a lead has two columns, **lead type** and **status**, both per-industry lists held as data in
the contract (`crm.lead_types`, `crm.statuses`); a status may need a date, a person or a line; notes carry time and author. Work order 20 built and proved the
backend. The dashboard still shows the platform floor (`lib/leads.ts` `STATUSES`, `statusLabel`), so the owner sees none of it.

## What exists (read, with the line)
- `lead-list` answers `lead_types: [{key,label}]` and `statuses: [{key,label,stage,needsDate,needsWho,needsText}]` in order, and each row carries `lead_type`,
  `status_date`, `status_who`, `status_text` (`supabase/functions/lead-list/index.ts:8-10`). A contract with no `crm` block gets the floor from the server
  (`private.crm_lists`, migration 23 line 53-56: not-contacted "Not contacted yet", contacted, qualified, closed), so the server list is never empty.
- `lead-update` takes `status`, `status_date`, `status_who`, `status_text`; the database refuses what the list does not allow (400 I-ANSWER, with the person's
  sentence in `message`). `lib/problems.ts` already turns that into `e.problem.message` with `plain: true`.
- `leads-bulk` status: a status that `needsDate` is refused 400 "<label> needs a date; set it on one lead at a time" (migration 23 line 334-336); needsWho takes the
  caller, needsText stores none (ruling G, lines 349+). So "a bulk status that needs a date" is the server's 400 shown inline, never a bulk date picker.
- Dashboard today: `lib/leads.ts:7` `STATUSES` floor + `statusLabel`; `lib/crm.ts:29,45,50-53,187` (column options, New filter, All, cell); `lib/views.ts:160`
  (`ALL_BUT_SPAM`); `pages/LeadPanel.tsx:206-211,285-291`; `pages/BulkBar.tsx:46-50`; `pages/ColumnFilters.tsx:12-14` (`choicesOf` shows `col.options` raw: the known
  finding); `data.ts` `useLeadColumns` (calls `lead-list` size 1, keeps columns and fields only), `LEAD_COLUMNS` (no `lead_type`, `status_*`), `api.ts` `listLeads`
  (drops the two lists), `LeadChange.status` typed to the floor union.
- The plan gate: static (`tests/plan-gate.mjs`: a string literal in code must be in its plan row, PLAN-4/5; `{expr}` values are not scanned) and DOM
  (`tests/plan-gate.dom.ts`: every element and text inside a `data-plan`, every id in the plan and in a built slice; it never compares words). In work order 20 the
  words "Not contacted yet" were a literal in `leads.ts`, so PLAN-4/5 refused them (DP-1.3-12 says "new, contacted, qualified, closed, spam").

## Decisions (mine, small; say if one is wrong)
1. **Where the lists live in the app.** `listLeads` passes `lead_types` and `statuses` through; `useLeadColumns` returns `{ columns, fields, lists }`; the list page,
   panel and bulk bar read `lists` from it. One `Lists` type in `lib/leads.ts`: `{ statuses: StatusDef[]; leadTypes: TypeDef[] }`.
2. **The floor in code** is used only when the answer carries no list (an old server, a malformed answer): the four floor keys plus `enquiry`, labels spelled from the
   key (not-contacted -> "Not contacted"). It carries no copy of the owner's words. While the answer is loading the status picker and the lead type column render
   nothing rather than the floor, so no wrong label flashes.
3. **Labels are data, never literals.** Every label on screen is `def.label` from the list (a JSX expression or a variable): no string literal for a status or lead
   type exists in `src/`. That is the distinction, in the code and not in the gate: PLAN-4/5 scan literals, a data label is not one. The gate is not loosened. Proof:
   (a) a new case in `tests/plan-gate.test.mjs` that a source rendering `{s.label}` passes and a source holding the literal `'Not contacted yet'` still fails PLAN-4/5,
   watched red against a gate that skips literals; (b) a vitest that the label shown is exactly the list's, for a list whose labels are words the plan never saw.
   The plan row DP-1.3-12/-32/-22/-02/-06 text is edited to say the status words are the business's own list (docs/blueprint is ours to edit; no word the code
   shows is added by this).
4. **New fixed words** (the panel's three asks and the lead type control) need plan rows: "Date", "Who", "Details", "Lead type", Save and Cancel. Added, head agreed 2026-11-11: DP-1.3-80 (lead type pick) and DP-1.3-81 (the asks); rows -02, -06, -12, -22, -32 reworded to say the status words are the business's list.
   I add them as rows of slice 5.3 / 5.3c in `16-DESIGN-PARTS.md` (one new row per control, ids DP-1.3-80 and up after checking the last id), and reuse
   existing ones where a word is already there (Save, Cancel from DP-1.3-37). This is a design-doc edit the head may want to look at: listed under questions.
5. **Filters from the list.** New = the keys of the statuses whose `stage` is `new`; All = every list key but `spam`; Spam = `spam`; `statusFilters`, `countQuery`,
   `viewFilters` and `views.ts` (`toSaved`, `fromSaved`) take the keys from `lists`. Counts and the first list call wait for the lists (they come from the same
   `lead-list` call `useLeadColumns` makes). A lead whose stored status the list later dropped is outside All (finding, same as work order 20's finding 7).
6. **Lead type column** (`lead_type`, enum, options = the list's keys, cells and the filter show the label), after Form in `coreColumns(lists)`. Status gets the same
   labelled options, which fixes the raw-keys dropdown (`choicesOf` reads `{value,label}` pairs for `status` and `lead_type`, from the lists). `status_date` is not a
   column in this order (its date shows with the status, below).
7. **Status in the list and timeline** shows the label, then what the status carries as plain values: the date (received-words style date), the person's name
   (`byUser`, else `team`), the line: "Call back, 20 Nov". Timeline: `Status: <old> to <new>` as DP-1.3-22 words it, followed by the carried values in brackets;
   brackets and values are data, no new words.
8. **Panel.** The status control is a labelled select (head accepted 2026-11-11: a list has 15 to 19 words, a row of radios does not fit at 390 px; the styles tests take its shots), built from `lists.statuses` plus `spam`. Choosing a status that needs something does NOT send at once: it opens
   the asks under the select (Date if `needsDate`, Who, a pick of `byUser` starting on the signed-in person, if `needsWho`, Details, a line of 200, if
   `needsText`) with Save and Cancel; a status that needs nothing sends at once as today (optimistic, Undo in the toast). On Save the panel sends `status`,
   `status_date`, `status_who`, `status_text` (only what is filled), and the server's 400 shows under the control (`e.problem.message`, not the generic "Could not
   save"). The current status's carried values show and can be changed by choosing the status again. Lead type: a labelled select in the panel (`lead-update`
   `fields.lead_type`, as `fields` already takes status/lead_type per migration 23 `lead_set_fields`), Undo as any field.
9. **Bulk** (head confirmed 2026-11-11: stays offered, 400 shown). The bar's picker lists `lists.statuses` (+ spam). A status that needs a date is offered and, when picked, the 400 shows inline in the bar
   ("<label> needs a date; set it on one lead at a time"): I do not hide it, because hiding would lose the owner's words, and the flow asked for is that 400. A status
   that needs a person or a line is sent as picked (the server takes the caller; a line is not carried) with no extra asks in bulk.

## Plan (order; each step has its own check)
1. `lib/leads.ts`: `Lists`, `StatusDef`, `TypeDef`, `FLOOR_LISTS`, `listsFrom`, `statusDef`, `statusLabel(lists,key)`, `typeLabel`, `newKeys`, `allKeys`, `statusDetail`;
   `Lead` gains `lead_type`, `status_date`, `status_who`, `status_text`, status becomes `string`. `filterLeads`/`filterCounts` (the client-side ones the old inbox used)
   take `lists`. vitest first, watched red.
2. `lib/crm.ts` and `lib/views.ts`: `coreColumns(lists)`, `statusFilters`, `countQuery`, `viewFilters`, `listQuery` callers, `choicesFor` labelled, `cellText`, `fromSaved`
   / `toSaved`. vitest (`crm.test.ts`, `views.test.ts`, `leads.test.ts`), watched red per new check.
3. `api.ts` (`LeadChange` status string + the three status_* + `fields`; `listLeads` keeps `lead_types`, `statuses`), `data.ts` (`useLeadColumns`, `LEAD_COLUMNS`, counts wait).
4. `LeadPanel.tsx`, `BulkBar.tsx`, `ColumnFilters.tsx`, `Leads.tsx` (columns, lists to the bar and the filter), plus a small `StatusAsk` component for the asks.
5. `16-DESIGN-PARTS.md` rows, `Panel.module.css` / `Crm.module.css` for the asks and the select, `tests/flows.spec.ts`, `tests/styles.spec.ts`, `tests/plan-gate.spec.ts`
   (required ids for the new rows) and `plan-gate.test.mjs` (the data-label case).
6. Book: `1-product.md` A16 to WORKS with the proof and the counts, `5-crm.md` (screens built; the "Not yet" line), `STATE.md` line, `icm` index regenerated.

## Proofs (what each acceptance line needs, and how it is run)
| Acceptance | Command | Where | Watched red |
|---|---|---|---|
| vitest on the changed lib files | `npx vitest run src/lib/leads.test.ts src/lib/crm.test.ts src/lib/views.test.ts` in `apps/dashboard` | local, no lock | each new `it` fails against the old code or a broken copy for the stated reason |
| tsc | `npx tsc --noEmit` in `apps/dashboard` | local | n/a (a type gate) |
| the plan gate | `plan-gate.test.mjs` (node:test, no browser) + the static scan on `src/` (the gate's own test run) + the DOM half inside `plan-gate.spec.ts` | local for the first two; DOM half needs staging | the data-label case against a gate that skips literals |
| staging flows | `flows.spec.ts` new tests: owner dated status (call-back), status with a person (contacted by), status with a line (interested in something specific), agent (member-a1) dated status on own lead, bulk status needing a date (400 inline, nothing written), filter by lead type | heavy lock, the head says when | break the status_date send, see the dated flow red |
| 390 px and laptop | `styles.spec.ts`: panel with the asks open, status picker, at both sizes (new tests `the status asks are styled at ...`) | heavy lock, the head says when | the existing `no-styles` mutant must fail them |
| the book | `node tools/icm/index.mjs --check` (counts from the rows) | local | n/a |
Local rule from the head: only the tests of the files I change, plus gitleaks; no full suite, no run-local. Staging flows and the 390 px look wait for the head's go.

## Questions for the head: ANSWERED 2026-11-11 (1 yes, 2 yes, 3 go for npm ci only; staging flows and 390 px still wait)
1. New plan rows (decision 4): is adding rows to `16-DESIGN-PARTS.md` for "Date", "Who", "Line" and "Lead type" yours to approve, or the owner's design call? I proceed with the minimal set and list them in the report.
2. Bulk (decision 9): confirm the date-needing status stays offered in bulk with the server's 400, not hidden or disabled.
3. Heavy lock: ask me when the staging flows and 390 px run are wanted; I will not take it myself.

## UNPROVEN / NOT RUN (as of this plan)
Everything: nothing is built, no test has run in this order.

## Report (builder, 2026-11-11; nothing committed, pushed, applied or deployed)

### Built
`lib/leads.ts` (Lists, floor, `listsFrom`, labels, `newKeys`/`allKeys`, `statusWords`, `dayWords`, timeline status line with its values and lead type labels), `lib/crm.ts`
(lead type column, filters from the lists, `cellText`), `lib/views.ts`, `api.ts` (status_date/who/text, `listLeads` keeps the lists), `data.ts` (`useLeadColumns` carries
the lists; counts and list wait for them; the lead select reads `lead_type`, `status_*`), `pages/LeadPanel.tsx` (Status select, Lead type select, server sentence under the
asks), new `pages/StatusAsk.tsx`, `BulkBar.tsx`, `ColumnFilters.tsx` (labelled Status and Lead type values: the known finding), `Leads.tsx`, `ViewsPanel.tsx`,
`leads-view.ts`, `Panel.module.css`. Plan rows DP-1.3-80, -81 added and -02, -06, -12, -22, -32 reworded in `docs/blueprint/16-DESIGN-PARTS.md`. Book: `1-product.md` A16 cell
(state still PARTLY), `5-crm.md`.

### Proof seen (pasted)
- `npx tsc --noEmit` (apps/dashboard): no output, exit 0.
- `npx vitest run src/lib/leads.test.ts src/lib/crm.test.ts src/lib/views.test.ts src/pages/labels.test.ts tests/plan-gate.test.mjs`:
  `Test Files  5 passed (5)` / `Tests  144 passed (144)`. This includes the plan gate on the real source (PLAN-1 to 9) and the new data-label case.
- Watched red, first run: `FAIL ... the timeline says a status change in the list's words ...  Expected: "Changed lead_type: Enquiry to Looking to buy"  Received: "Changed lead_type: enquiry to buy"`
  (the one new check written before its code; fixed, green).
- Watched red, 13 breaks of the real code, one at a time, file restored each time (`scratchpad/mutants.mjs`): all 13 `CAUGHT`, 0 survived, 0 target missing, each by its own check
  (newKeys ignores stage; allKeys; no floor; line before date; day year; timeline drops values; lead type edit shows keys; lead type cell raw; status cell label alone; New fixed key;
  All floor keys; lead type column gone; saved view reads New from the fixed key).
- Plan gate, distinction not loosening: new test plants `const label = 'Not contacted yet';` in `LeadPanel.tsx` and the gate answers PLAN-5; `{s.label}` in markup passes.
- `node tools/icm/index.mjs --check`: `OK: icm index is fresh (340 docs, 747 source files)`. `gitleaks detect --no-git --source apps/dashboard`: `no leaks found`.
- `npm ci --ignore-scripts` through heavy.mjs (head's go): `added 82 packages in 2m`, exit 0 (the worktree had no node_modules).

### NOT RUN / UNPROVEN
- Staging flows (the new `A16 status board` tests in `flows.spec.ts`, and `plan-gate.spec.ts` DOM half with DP-1.3-80/-81): written, never run; they need the heavy lock and the head's go. The exact wording of the server's refusal (`/needs a date/i`) and the dated event line `(4 Dec 2026)` are my reading of migration 23, UNPROVEN until they run.
- `styles.spec.ts` new test `the status picker and what a status asks for are styled at <phone|laptop>` (shots status-picker, status-picker-longest, status-asks at 390x844 and 1536x730): written, NOT RUN, so the owner has no 390 px look yet. The existing panel test now looks for the Status select instead of the radiogroup.
- The panel, StatusAsk, bulk bar and column filter components have no unit test (as before for the panel); they are covered only by the flows above.
- The book: A16 stays PARTLY. It becomes WORKS when the flows and the shots are seen passing; the counts then move CRM 18, 3, 5 to 19, 2, 5 and the total 52 to 53 of 95 (recompute with `node tools/icm/index.mjs --check`).
- `work/STATE.md` not edited (head's file).

### Round 2 (builder, 2026-11-11, after the head's review; nothing committed)
- Fix 1: `statusChoices` offered Spam twice for a list that already holds `spam` (the real-estate list does). New check `a list that already holds spam ... offers it once` watched red first:
  `Expected [... "closed", "spam"]  Received [... "closed", "spam", "spam"]` (leads.test.ts:204); fixed (spam added only when the list lacks it); the bulk bar, the column filter and the panel all use `statusChoices`, so all three are fixed; `allKeys` already left spam out (the new check asserts it). The `filterLeads` doc comment now says the stage-new keys. The flow's picker expectation follows the list.
- After the fix: `tsc --noEmit` clean; vitest on leads, crm, views, labels and plan-gate.test.mjs: `Test Files  5 passed (5)` / `Tests  145 passed (145)`.
- Counts (read from `docs/product/1-product.md` "Counts" in this worktree): A CRM 22/4/0, Total 59/25/11. On green, A16 to WORKS makes A 23/3/0 and Total 60/24/11. NOT applied: A16 stays PARTLY until the flows are seen passing.
- `node scripts/build-staging.mjs` through heavy.mjs: `built in 1.68s`, `bundle-secret check: ok, 6 files scanned ... no value found`, exit 0 (dist/ is built against staging).
- BLOCKED: the staging flows (`flows.spec.ts` + `plan-gate.spec.ts`) and `styles.spec.ts` with SHOTS: the heavy lock was held by other sessions' jobs both times, `heavy: gave up after 30 min: order44-metrics-fn-tests (PID 41016) still holds C:\Users\DELL\.claude\state\heavy.lock. Nothing was run.` (07:14) and `heavy: gave up after 30 min: order44-run-local-metrics27-r3 (PID 7792) still holds ... Nothing was run.` (07:43). What would unblock it: the lock free for about 15 minutes (the head sequences it), then both runs go in one slot. Nothing from the A16 flows or the 390 px look has been seen.
