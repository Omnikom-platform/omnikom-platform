# Slice 5.2b: the staging e2e scripts clean up after themselves; openapi.json catches up with 5.2

Owner: Platform build head `HEAD_Platform-build_2026-11-01`. Builder: `BUILDER_platform_5-2b` (Sonnet). Written 2026-11-01 10:20.
You report to the head only (SendMessage to `HEAD_Platform-build_2026-11-01`).

## Why
1. On 2026-11-01 the staging e2e runs had left 10 never-published listing drafts in workspace A ("4.2 e2e ...", "4.3 e2e ...", "5.2 e2e
   ..."). The dashboard's publish sheet publishes every waiting draft (DP-1.4c-02), so one invalid leftover stopped every publish. They
   were soft-deleted by 5.4's reset (`apps/dashboard/tests/support/reset-staging-drafts.mjs`, through `service.unpublish`, audit rows).
   The cause stays: `supabase/tests/e2e-*.mjs` create rows and never remove them.
2. `docs/blueprint/specs/openapi.json` lacks `SaveRequest.base` and the five operations 5.2 added (drafts, settings-save, crm-test,
   lead-export, invite-member); `check-specs` does not require them.

## Read first
`CLAUDE.md`; `docs/departments/platform-build.md` (rules); `supabase/tests/e2e-export.mjs`, `e2e-screens.mjs`, `e2e-functions.mjs` (or
whichever `e2e-*.mjs` exist); 5.4's `reset-staging-drafts.mjs` (read only, the removal path already proven on staging); the five functions
under `supabase/functions/` and the spec check that reads openapi.json (find it with grep under `docs/blueprint/specs/`).

## What to build
1. Each e2e script removes, in a `finally`, every content row it created (soft delete through the same `service.unpublish` path,
   the platform's own function, audited), even when an assertion fails. A row the script only edited gets no removal.
2. A check that would have caught it: a unit test (no staging) proving the cleanup runs on a thrown assertion, watched red with the
   cleanup removed. If the scripts have no unit seam, add the smallest one.
3. openapi.json: `SaveRequest.base` and the five operations with their request and answer shapes and error codes as the functions
   actually return them (read the code; never invent). Then make the spec check REQUIRE every deployed function to have an operation,
   watched red by deleting one.

## Rules
- Edit only `supabase/tests/` and `docs/blueprint/specs/`. NOT `apps/dashboard/` (another builder is there), not functions, not
  migrations, not the CLI. Anything else is a finding.
- Do NOT run the e2e scripts against staging. They are proven later by the head, after landing (DECISIONS 43). Local and unit only.
- Never commit, push, stash, reset or touch the git index. Heavy runs only through `node ~/.claude/scripts/heavy.mjs -- <cmd>`.
- No em dashes. Scripts in files. Two failed approaches to one obstacle: BLOCKED with what would unblock it.

## Done when (paste the real last lines)
1. The new unit test: green, and its watched-red line.
2. The spec check: green, and its watched-red line (one operation removed).
3. `node --check` on every changed `.mjs`.
4. Report under 25 lines: files changed, the lines above, the staging run the head must do after landing, anything UNPROVEN.
