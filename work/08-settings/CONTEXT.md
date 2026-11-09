# 08 Settings and account (block 4)

Owner: platform-build. Model: Sonnet 5.5, effort high. Branch: check/platform/settings (worktree on master). Migration: M17
(`20261105000017_team.sql`; if seo-read's M16 has not landed when this lands, the number still holds: M16 is reserved).
Status: OPEN (written 2026-11-04 by `HEAD_Platform-build_2026-11-04b`).

## Why
Block 4 of the platform queue (owner's order 2026-11-04). Moves `docs/product/1-product.md` B3 (sign out everywhere; account
name and email), B16 (lead alert addresses), B17 (team list, invite, remove), B18 (websites), B19 (the CRM webhook card,
removed), C13 (the invite mail), D8 (alert recipients set from the screen, not only the CLI). `6-dashboard.md` "Settings": one
screen of cards.

## Inputs (load these, nothing else unless a step needs it)
- `CLAUDE.md`, `work/STATE.md`, this file; `docs/product/6-dashboard.md` ("Look", "Rules every screen follows", "Sign-in",
  "Settings", "Roles on screen"), `5-crm.md` (no automatic push), `3-database.md` (members, sites, the wall), `4-backend.md`
  (functions, "Secrets", email), `11-rules.md`; `docs/blueprint/16-DESIGN-PARTS.md` 1.2s, 1.2e and 1.6.
- `supabase/functions/{_shared,invite-member,settings-save,crm-test}/`, `supabase/functions/test/` (`settings.test.ts`,
  `crm-test.test.ts`, `cors.test.ts`, `local-serve.ts`, `mutate.mjs`), `supabase/migrations/` (M4 and M8 `remove_member`, M12
  `set_alerts`, `set_member`, `integrations`), `supabase/auth-emails/`, `supabase/set-auth-settings.mjs`, `supabase/tests/`
  (`run-local.mjs`, `tenancy.test.sql`, `e2e-screens.mjs`), `supabase/ops/test/promote-check.test.mjs`.
- `apps/dashboard/` (`README.md`, `src/pages/Shell.tsx`, `SignOutButton.tsx`, `src/data.ts`, `src/api.ts`, `src/router.tsx`,
  `built-slices.json`, `tests/`, `scripts/ci.mjs`).

## Settled by the head (do not re-open; a reason to change one is a finding)
1. **No visual design** (DECISIONS 52): plain semantic markup in the existing tokens and module CSS patterns. Renders clean at
   390 px and on a laptop. Route `/w/$ws/settings`; the rail's Settings link (DP-1.2s-05) appears.
2. **Who sees what:** the owner sees every card. A member sees only Your account and Sign out everywhere (site settings and the
   team are hidden from members, `6-dashboard.md` "Roles on screen").
3. **The plan rows** in `16-DESIGN-PARTS.md` 1.6 are rewritten first: DP-1.6-05 and DP-1.6-06 (the CRM connection) are removed;
   DP-1.6-02 now sends the invite mail; DP-1.6-08 is "Your account: name (from your team profile when you have one) and email
   (the login's)"; any new control (the remove confirm sheet's text, an empty team list, the alert field's error) gets a row with
   the next id. Business details (DP-1.4-07) stays on the Site screen and is not part of this order. **Send the rows to the head
   and wait for the OK before writing screen code.** `built-slices.json` gains `5.6`.
4. **Team list (B17):** M17 adds `service.list_members(p_claims jsonb, p_workspace uuid)` (definer, `search_path = ''`, closed to
   PUBLIC, granted to `omnikom_fn`; owner or staff with MFA, else S-NOT-FOUND) answering each member's user id, email (from
   `auth.users`), role, team profile id and name, joined date. Edge Function `team-list` calls it.
5. **Remove (B17):** Edge Function `member-remove` (owner only) calls the existing `service.remove_member` (never the last owner:
   409 S-LAST-OWNER, plain words); the removed person's rows stay (`16-DESIGN-PARTS.md` 3.2). Their next request in this workspace is refused by the wall; open
   sessions are not ended (Supabase Auth has no admin logout by user id: api.go and GoTrueAdminApi.ts, read 2026-11-04). The
   head ruled this 2026-11-04: no write to `auth.sessions`. T27 proves it with the claims the removed owner had: a lead read, a
   lead update and a save in that workspace are all refused. No new function: `remove_member` is called as it is.
6. **Invite mail (C13):** `invite-member` sends the mail after `set_member`: a new login gets Supabase Auth's invite mail
   (`POST /auth/v1/invite`, template DP-email-08 to 12, which now also say who invited them and to which business through the
   invite's user data); an existing login gets the normal sign-in link mail (`/auth/v1/otp`). The answer becomes `email_sent:
   true | false` from Auth's real answer, never assumed. Sending mail is an outward action: the unit tests stub Auth; on staging
   the head sends an invite only to the head of operations' named test address.
7. **Alerts (B16, D8):** the card edits each site's alert addresses (up to 10, one per line, checked as emails) and "also email
   the assigned agent" through the existing `settings-save` alerts.
8. **Websites (B18):** each site's preview address, domain and state, read as today, with an "Ask Omnikom" mailto link; no edit.
9. **Remove the CRM push leftovers (B19):** the `crm` part of `settings-save`, the `crm-test` function and their tests,
   mutants, CORS and `local-serve` entries, `config.toml` and `docs/blueprint/specs/openapi.json` paths go; `e2e-screens.mjs` and
   `promote-check.test.mjs` lose their crm checks. The `integrations` table and its rows stay (a later cleanup; write it as a
   finding). If anything else calls them, that is a finding before removing.
10. **Account (B3):** name and email as in 3; Sign out everywhere calls `supabase.auth.signOut({ scope: 'global' })` and lands on
   `/login?ended=true`.
11. **Save:** one Save per card that changes something (alerts only, today), on only when the card changed; leaving the screen
   with unsaved changes asks once (an in-page sheet, no browser `confirm()`).

## Steps
1. The plan rows (3); send them to the head; wait for the OK.
2. M17 and `team-list`, `member-remove`; walls with a test watched red and a mutant each in `supabase/tests/run-local.mjs`, at
   least: a member lists (not found), another workspace's owner lists or removes (not found), the last owner removed (409),
   a removed member's next read in that workspace is refused.
3. `invite-member` mail (6) and the B19 removal (9); function tests and mutants in `supabase/functions/test/`.
4. The Settings screen (1, 2, 7, 8, 10, 11) with Vitest units for its pure logic.
5. Playwright: extend `tests/flows.spec.ts` (staging, workspace A): the owner sees the five cards, edits alert addresses and
   reads them back; a bad address shows the inline error; invite a synthetic address on the test domain the head names, see it
   in the list, remove it through the sheet; member-a1 sees only the account card and sign out everywhere. The DOM plan gate runs
   on the new screen. Write the steps for the head; the builder runs nothing on staging.
6. Staging proof script `supabase/tests/e2e-settings.mjs` (staging only, synthetic data, run marker, cleans up in a `finally`):
   `team-list` as owner-a and member-a1, `member-remove` of the last owner refused, invite then remove a marked member,
   `crm-test` answers 404 after its removal. One PASS/FAIL line per check. **No mail unless `SETTINGS_INVITE_EMAIL` is set**
   (the head, 2026-11-04: the invite inbox is "not yet", C13 stays UNPROVEN): without it the script prints "SKIP: invite mail
   (C13) UNPROVEN: SETTINGS_INVITE_EMAIL not set" (not a FAIL) and keeps going with a marked member made without mail: an Auth
   admin create of a synthetic login (`email_confirm` true, sends nothing), `service.set_member` over `STAGING_DB_URL_DIRECT`; it
   proves team-list, the last-owner refusal, `member-remove` of that member and that their next read is refused, and its finally
   deletes the synthetic login through the Auth admin API (this run made it). With the variable set it runs the real invite path.
7. The book in place, in the land commit: `1-product.md` B3, B16, B17, B18, B19 (removed), C13 (the invite mail; the own sender
   domain stays an owner item), D8, the counts; `6-dashboard.md` "Settings" (what exists now); `3-database.md`, `4-backend.md`
   (the functions); `work/STATE.md` (block 4).

## Outputs
- `supabase/migrations/20261105000017_team.sql`; `supabase/functions/{team-list,member-remove,invite-member,settings-save}/`,
  `crm-test/` removed; `supabase/functions/test/`, `supabase/tests/`, `supabase/auth-emails/`, `supabase/config.toml`,
  `docs/blueprint/specs/openapi.json`, `supabase/ops/test/promote-check.test.mjs`.
- `apps/dashboard/src/pages/Settings*` (new), `Shell.tsx`, `SignOutButton.tsx` if shared, `src/data.ts`, `src/api.ts`,
  `src/router.tsx` (only the settings route), `built-slices.json`, `tests/flows.spec.ts`, `tests/plan-gate.spec.ts`,
  `tests/plan-gate.test.mjs` (the head OK'd it 2026-11-04: slice 5.6 is now built, so its "built" list and its dead-link and
  unbuilt-row mutants changed); `docs/blueprint/16-DESIGN-PARTS.md`
  1.2s, 1.2e and 1.6 only. This file as `work/08-settings/CONTEXT.md`.
- Work order 07 (CRM screens) runs in parallel on the leads pages and plan sections 1.3 and 1.3b: do not touch those; the router,
  `data.ts`, `api.ts`, `flows.spec.ts` and `built-slices.json` are shared (keep your hunks separate; the second to land rebases).

## Rules for this order
- The builder never commits, pushes, applies to staging, deploys, publishes or sends mail; it hands the head the staging steps.
- Before reporting done, run locally every suite CI runs on what changed: `node apps/dashboard/scripts/ci.mjs`,
  `supabase/tests/run-local.mjs`, `supabase/functions/test/mutate.mjs`, `tools/omnikom-cli/test/run.mjs`, `supabase/ops/test/`.
  The full `run-all-gates.mjs` is CI's (rule 8). Long runs through `~/.claude/scripts/heavy.mjs`.
- A missing plan row, a backend answer that does not fit, a copy question: stop and send it to the head. Keys by variable name
  only; scripts in files; nothing against a client site or production.

## Done when
- The new walls watched red, each mutant caught; `ci.mjs` OK; CI 9 of 9 on the check branch; landed by `omnikom land`.
- On staging after the land (the head runs: apply M17, deploy `team-list`, `member-remove`, `invite-member`, `settings-save`,
  delete the `crm-test` function, apply the auth email templates, `e2e-settings.mjs`, then the Playwright flows in an owner-a
  window from the CLI head): every line PASS, DOM plan gate 0 problems; `e2e-screens.mjs` still 0 problems.

## Proof
The head, staging 2026-11-09 from `check/platform/settings` (CI 42606049501, 9 of 9 on c83ef4c; the backend is unchanged since):
- `apply-staging.mjs`: "apply 20261105000017_team.sql" / "OK: applied 1 of 18 (17 were already applied)"; `deploy-functions.mjs`:
  "OK: invite-member deployed", "OK: settings-save deployed" (with team-list and member-remove); `crm-test` deleted ("Deleted
  Function crm-test from project"); `set-auth-settings.mjs`: "OK: 7 Auth settings set and read back on STAGING_SUPABASE_REF, 0 differ".
- `e2e-settings.mjs` (no mail): first run "FAIL crm-test answers 404 ... 409 NO-CRM" (the delete came after it); after the delete
  "PASS crm-test answers 404: the function is no longer deployed", "PASS: Settings backend on staging, 0 problem(s)", with
  "SKIP: invite mail (C13) UNPROVEN: SETTINGS_INVITE_EMAIL not set".
- `e2e-screens.mjs`: "PASS: staging end to end for the functions of the four screens, 0 problem(s)".
- `flows.spec.ts`: 8 passed, 1 skipped (the invite: a real mail), 1 failed: sign out everywhere ("Received string:
  .../login", expected `/login?ended=true`). Cause: Login went on to /w on a stale session, the guard sent it to a bare /login.
  Fixed in Login.tsx; the two settings-agent flows "2 passed"; with the old Login "1 failed" (same URL); fix restored.
- `plan-gate.spec.ts`: "6 passed" (the Settings cards, the remove and leave sheets, the agent's Settings; the gate's own watched red).
- UNPROVEN: the invite mail and the invite and remove flow on screen (C13, B17): they wait for the inbox the owner names.

## Findings
(the builder writes here, one line each, and sends them to the head)
1. Supabase Auth has no admin logout by user id (`internal/api/api.go` admin routes; `GoTrueAdminApi.signOut(jwt, scope)` takes the user's own JWT; read 2026-11-04). Ruled B by the head: open sessions are not ended, the wall refuses the removed person's next request; T27 proves it.
2. "Ask Omnikom" has no address anywhere in the repo (only `VITE_ASK_EMAIL`, `config.ts:13`, unset): the link shows only when it is set. The head asks the head of operations for the address.
3. An existing login's invite mail is the plain sign-in mail: it cannot name the inviter or the business (Auth applies user data only when it creates the login, `invite.go`). Later: our own sender for both (the head accepted).
4. M17 also holds `service.invite_context` (the business's and the inviter's name for DP-email-10), beyond the order's list: the function role has no table grants, so `invite-member` cannot read them itself. `remove_member_left` was dropped with ruling B; `remove_member` is called as it is.
5. `invite-member` makes the login with `generate_link` (unconfirmed, sends nothing) and then calls `POST /auth/v1/invite`, which resends to an unconfirmed user (`invite.go`) and answers 422 `email_exists` for a confirmed one (never called: only a new login gets it). The first REAL staging send is the proof; the unit tests use a fake Auth. UNPROVEN until the head sends one to the named address.
6. `e2e-screens.mjs` no longer runs the 200 path of `invite-member` on staging (it would now send a real mail); `--local` runs it with the fake Auth, and `e2e-settings.mjs` runs it on staging with `SETTINGS_INVITE_EMAIL`.
7. `_shared/netguard.ts` and `netguard.test.ts` are now used by no function (`settings-save` and `crm-test` were the only callers): a cleanup candidate, kept.
8. The `integrations` table, `set_crm_webhook`, `crm_secret_put/drop`, `crm_target`, `crm_tested` and their SQL walls and mutants (T-series, `fn52`, `screens:` mutants) stay, called by nothing: a later cleanup migration (the order said so).
9. The login a REAL invite creates stays in Auth after the member is removed (no tool here deletes it); `e2e-settings.mjs` prints it as INFO. The synthetic login of the no-mail path is deleted in the script's finally. `e2e-settings.mjs` itself is UNPROVEN: I ran only `node --check` and its BLOCKED path (no `STAGING_SUPABASE_REF`: "BLOCKED: STAGING_SUPABASE_REF is not set (read by name)", exit 3); the staging run is the head's. The Auth admin create (`POST /auth/v1/admin/users`) and delete (`DELETE /auth/v1/admin/users/{id}`) are in `api.go`'s admin routes (read 2026-11-04).
10. The product book states are set to the lower state where the staging proof is not run (B3, B16, B17, B18, C13, D8 are PARTLY with "NOT run"); the head moves them to WORKS after the proof. Counts as written: B 8/8/5 of 21 (B19 row removed), total 38/25/11 of 74.
11. In `16-DESIGN-PARTS.md`, DP-1.2s-10 gained the word "Removing" (the remove button's pressed state) after the head's OK; DP-1.6-05 and -06 are removed and their ids are not reused.
12. No role-change control exists: inviting an existing member as owner sets the role through `set_member` (written in `6-dashboard.md`).
