# 5-CL: remove the leftover "5.3 flows" test leads from staging, and make the flows test clean up after itself

Head: `HEAD_Platform-build_2026-11-02` (report by SendMessage). Builder: Sonnet, effort high. Written 2026-11-02 05:15.
Why: Demo A's staging inbox holds about 36 leads named "5.3 flows ..." (journey finding 2026-11-01 01:13, LOW). The head of operations
made removing them a precondition (05:09) before the owner sees the dashboard screenshots (slice 5-DS). `apps/dashboard/tests/flows.spec.ts`
creates leads marked `{"test": "5.3 flows"}` in their answers (lines 3, 87-92, 131, 164) and never removes them.
Precedent to copy: `supabase/tests/e2e-cleanup.mjs` (`stagingDbUrl` refuses anything but staging; removal through the platform's own
service function with owner-a's claims, then a read back) and `apps/dashboard/tests/support/reset-staging-drafts.mjs`.

## Done when
1. **A cleanup script** (`apps/dashboard/tests/support/clean-flow-leads.mjs`, or a function added to `supabase/tests/e2e-cleanup.mjs`;
   your call, say which): selects only leads of workspace A's test site whose answers carry `test = "5.3 flows"` (never by name alone;
   never a lead without that marker, so the CLI's "Journey ..." leads stay). Default is a DRY RUN that prints the count and the ids, plus
   the count of leads it would leave. `--apply` removes each one through `service.delete_lead(claims, id, 'test data: 5.3 flows')` as owner-a
   (the platform's own deletion path: consent and audit records stay as designed), then reads back that each is gone. Refuses anything
   but staging (reuse `stagingDbUrl`).
2. **The flows test cleans its own leads from now on:** `flows.spec.ts` removes every lead it created in an `afterAll` (or `finally`),
   through the same function, by the ids it got back.
3. **A test watched red, and a mutant:** a unit test with a fake sql (as `e2e-cleanup.test.mjs` does) proves that a lead without the
   marker is never selected, that dry run removes nothing, and that `--apply` calls delete_lead once per id and reads back. Watch it red
   on a planted bug (the marker filter dropped: an unmarked lead selected), and add a mutant (the marker filter removed) to the mutant
   list the e2e-cleanup tests already use. Name the test as a `run-all-gates.mjs` line if it runs without staging (it should).
4. **The dry run on staging:** run it once against staging (read only) and paste the count and how many leads it leaves. You do NOT run
   `--apply`. The head runs it after the code is committed (staging only ever runs committed, gated code).

## Rules
Keys by variable name only: load with `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- <command>`; never print, copy,
store or list a value or that folder's contents. Code changes in a worktree of `backup-gh/master` (81d8076 or newer), never the shared
tree; never commit or push. No `--apply` on staging, no other staging write. Scripts in files, not `node -e`. Heavy runs through
`node "$HOME/.claude/scripts/heavy.mjs" --label "<name>" -- <command>` (5-L r2 goes first on that queue). No em dashes.
Anything outside this brief is a finding you send back, not a fix.
