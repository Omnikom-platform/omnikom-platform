# 22 journey crm screens

Owner: cli-and-testing. Model: sonnet, effort high. Branch: check/cli/journey-crm-screens. Status: OPEN (built; staging J1,J12 PASS 2026-11-09 10:50; lands after platform's 14).

## Why
Block 3a, the CRM screens (work order 07, landed `59e947e` and `33d59c2`), has no step in `omnikom test journey`, so the one
command that walks the test site's life on staging does not notice when the screens break. `9-blocks.md` "What each department
builds next", CLI: "one journey step per new feature, failing at that step when it breaks".

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/cli-and-testing.md` (Rules, Proof; not the position log)
- `tools/omnikom-cli/commands/journey.mjs` (whole: the header comment, `TESTS`, `playwrightVerdict`, steps J6 and J11, the
  `impl` object with `playwright` and `inboxShot`), `tools/omnikom-cli/test/journey.mjs`, the journey rows of
  `tools/omnikom-cli/test/mutate.mjs`
- `apps/dashboard/tests/flows.spec.ts` lines 280 to 440 (read only: the two block 3a tests and their setup)
- `work/07-crm-screens/CONTEXT.md` "Settled" items 3 to 7 (what the screens do)

## Steps
1. `TESTS.J12a` = flows.spec.ts, the title starting "search, a filter on an industry column, sort by budget, edit a field, bulk
   status, delete through the sheet, export the view, and a dry-run import" (copy the full title from the file, exactly);
   `TESTS.J12b` = flows.spec.ts "member-a1 sees no Import, no Delete and no Set owner, and Not found on the import address".
2. Step `{ id: 'J12', name: 'CRM screens', needs: ['J1'] }`: runs J12a then J12b through `c.impl.playwright` and
   `playwrightVerdict`; then a screenshot of owner-a's Leads list at 390 px and at desktop width into `c.out`
   (`j12-crm-owner-a-phone.png`, `j12-crm-owner-a-desktop.png`), through an `impl` function in the pattern of `inboxShot`
   (it says whether the list rendered rows; no rows on screen is a FAIL naming it, the 2026-11-04 red "the list shows no rows
   for owner-a"). PASS evidence names both test titles and both PNGs. A FAIL names which of the three parts failed and its first
   line. It sends no lead and no email, so it needs no `--alert-to`.
3. The header comment's step list and `briefs/journey.md`'s line, if that file exists in this tree, say J12; if it does not
   exist, only the header comment.
4. Unit checks in `test/journey.mjs` with a fake `impl` (no browser, no staging): PASS when both tests pass and the shot shows
   rows; FAIL for each of J12a red, J12b red, a shot with no rows, a shot not written; J12 is SKIPPED after a J1 FAIL; the
   TESTS titles appear exactly once in flows.spec.ts (read the file: a renamed test must turn this red, not make J12 pass on
   "no tests found"; check how `playwrightVerdict` reads a summary with 0 tests and test it).
5. Mutants tagged `[journey-crm]` in mutate.mjs, one per clause of step 4.

## Outputs
- `tools/omnikom-cli/commands/journey.mjs`, `tools/omnikom-cli/test/journey.mjs`, `tools/omnikom-cli/test/mutate.mjs`

## Proof
- `node tools/omnikom-cli/test/run.mjs --unit` -> "OK: N of N checks passed".
- Each new check watched red by hand once if the machine's heavy lock is free; otherwise say UNPROVEN and CI's cli job runs the
  mutants. No full local mutant run.
- The staging run is the head's, once the head of operations releases a staging window:
  `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs test journey --target staging --only J1,J12`
  -> the J12 line PASS. Builders never run it, never commit or push.

## Findings
A red in the dashboard tests themselves, or anything outside these files, is a finding sent to the CLI head, never fixed here.
- Builder, 2026-11-09: inboxShot's preview start-up moved into one helper `withPreview` in `makeImpl` (crmShots shares it; three
  existing mutants need their target text once); the sessions.clear mutant text re-indented, UNPROVEN until CI's cli job. The
  "J5, J6 and J7 BLOCKED, nothing sent" check now asserts exactly 2 playwright calls (J12's). UNPROVEN: the real crmShots against
  a browser and staging (only stubbed seams ran); it reads rows as `tbody tr` after ticking the All radio, at both widths.
- Head, 2026-11-09: CI on 85569a5 9 of 9 (CLI 856 of 856, "508 mutants, 508 caught, 0 survived, 0 target text missing", so the
  re-indented sessions.clear mutant is proven). First staging run 08:52: both dashboard tests PASS, shots red "the list shows no
  rows for owner-a": owner-a holds no lead on staging, so "rows > 0" tested the data. Fixed: J12 adds one marked lead as owner-a
  (add-lead, no email), the shots must find it at both widths, it is removed with the confirm flag (also when the shots throw);
  unit run 688 of 688, 7 more mutants watched red. Staging run 10:50, pasted:
  "J12 PASS CRM screens: the owner test passed: ... (87.8 s); the agent test passed: ... (9.7 s); the lead "Screens check 5a96ce51"
  made for owner-a was on the Leads list at both widths (phone (390 px) 1 row(s) ..., desktop 1 row(s) ...) and was removed again",
  "cleanup: 0 journey lead(s) removed, 0 left", "journey (staging): 2 PASS, 0 NOT BUILT YET, 0 FAIL". The phone PNG was looked at:
  the lead's row is on the list. Still UNPROVEN: the J12 "0 tests ran" check has no mutant of its own (the zero-tests-guard mutant
  covers the same text).
