# Slice 5.4: the Site screen, the editor and the publish sheet

Owner: Platform build head. Builder: one in-session Sonnet agent. Written 2026-11-01 06:35. Plan line: `factory/briefs/5-0-step-5-and-6-plan.md`
row 5.4. Depends on 5.2 (functions, landed 9ceef8b) and 5.3 (shell, landed bfb89da).

## Read first, in order
1. `CLAUDE.md`, `docs/departments/platform-build.md` (what you may edit), `planning/DECISIONS.md` items 39, 43, 44, 45.
2. `docs/blueprint/16-DESIGN-PARTS.md` section 1.4 and 1.4c: every row whose slice is `5.4` is in scope (DP-1.2s-04, DP-1.4-01, -02,
   -04 to -17, -19, -20, -22, DP-1.4c-01 to -05). Rows marked `later` or `5.5` are NOT built (no dead controls: PLAN-9).
3. `docs/blueprint/03-FRONTEND.md` B4 (one widget per contract field type), `docs/blueprint/15-CRM.md` (the Site screen words).
4. `factory/briefs/5-3-shell-and-leads.md` and `apps/dashboard/` as built: the `t('<id>','words')` copy helper, `data-plan`, the plan
   gate (`tests/plan-gate.mjs`, PLAN-1..9), `built-slices.json`, the sign-in for tests through `/auth/confirm`.
5. The functions you call (`supabase/functions/`): `drafts`, `save` (`base` is REQUIRED for an existing row; 409 `S-STALE`),
   `publish`, `upload-start`, `upload-finish`; the reads through RLS (`content_rows`, `content_versions`, the contract, `publish_jobs`
   and its events in realtime). `supabase/tests/e2e-screens.mjs` shows each call's body and answer.

## What to build (plain semantic markup; the look is the Design department's, DECISIONS 39)
- The Site nav item and screen: the site switcher, the state line with Open, "Publish N changes" from `drafts`.
- The generated list: Pages (changed mark from `drafts`), the contract's own collections with Add (an agent sees Add only on `own`
  collections), Business details with locked fields greyed and the plan's reason.
- The editor: section cards (one open at a time), one widget per contract field type (B4), counters ("17 of 70"), errors under the
  field in plain words with the rule code under them, the photo slot through `upload-start` / `upload-finish` with the plan's two
  error sentences, lists (add, remove, up, down), fills-itself and locked sections with the plan's words, the search-result card.
- Save with the base version (and autosave after 10 s idle), the S-STALE sentence of DP-1.4-17, History with Restore (a new version,
  nothing deleted; the plan's toast), empty states.
- The publish sheet: the change list, "Publish these N changes to <site>?", the progress list live from `publish_jobs` and its
  events, a failed check that stops the list with Fix and the one sentence, the Publish button while a job runs, the toast at the end.
- `built-slices.json` becomes `["5.3", "5.4"]`; the plan gate must then pass with every 5.4 row carried by an element.

## Rules
- DECISIONS 44: every element and fixed text carries its plan id; no sample data; no dead control. Where the plan is silent, STOP and
  write the gap into your report (the head adds it to the plan or takes it to the owner). Never invent words.
- Edit only `apps/dashboard/` (and, if a test helper must, `apps/dashboard/tests/support/`). Do NOT edit `apps/dashboard/tests/global-setup.ts`
  (slice 5-H holds it until it lands) or any function, migration or CLI file: a backend gap goes into the report.
- Heavy commands only through the machine-wide lock: `node ~/.claude/scripts/heavy.mjs -- <cmd>` (npm ci, Playwright, the full Vitest
  if the hook asks). One heavy run at a time. Never commit, push, stash, reset or switch branches.
- Keys by name through `tools/with-env.mjs` only; never print a value or list the credentials folder.
- Every new check watched red (break it, see it fail for the right reason, restore). Mutants for the plan gate's new rows ride the
  existing plan-gate mutants; flow mutants as in 5.3 (`tests/mutants.ts`).
- No em dashes. Scripts in files. Two failed approaches to the same obstacle: BLOCKED with what would unblock it.

## Done when
1. `node apps/dashboard/scripts/ci.mjs` passes (install, tsc, Vitest with the plan gate, the Auth email checks).
2. Playwright on staging (through the lock), on the test site of workspace A: owner-a opens Site, edits the contact page's heading,
   saves (a new version; the site unchanged), publishes from the sheet, the progress lines come in live, the job ends `done`, and the
   preview `https://preview.test-site-demo-a.pages.dev/contact/` shows the new heading. A stale save shows the S-STALE sentence. An agent
   sees Add only on own collections. The DOM plan gate passes on every new screen. Each flow test has a mutant that turns it red.
3. Your report: files changed, the pasted outputs, every GAP line, anything UNPROVEN. The head then gates it on GitHub and lands it.
