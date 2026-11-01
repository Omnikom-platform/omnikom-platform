# Slice 5-H round 3: the Linux orphan, finish and prove

Owner: Platform build head `HEAD_Platform-build_2026-11-01`. Builder: `BUILDER_platform_5-H-r3` (Sonnet). Written 2026-11-01 07:40.
You report to the head only (SendMessage to `HEAD_Platform-build_2026-11-01`), never to the head of operations.

## Read first
1. `CLAUDE.md`; `docs/departments/platform-build.md` (rules section only); `factory/briefs/5-H-process-hygiene.md` (the slice).
2. `docs/blueprint/PROGRESS.md` section "5-H no browser or database outlives its run" (what is already proven).

## The state you start from
- Check branch `check/platform/5-h-r2` at 7e6ac78 is RED on GitHub (run 41269080649, gates job: `proc-guard tests: 45 passed, 6 failed`;
  every other job green). Read the failing lines yourself: `gh run view 41269080649 --log-failed` (pipe through a filter for `FAIL` and
  `leaks`; never paste the whole log).
- Cause (diagnosed by the previous head): an orphaned test stand-in (`test/standin.mjs` under a `playwright_c...` folder, parent pid 1)
  is never killed on Linux, because the Playwright-profile rule in `tools/proc-guard/index.mjs` counts parent pid 1 (alive) as a live
  owner; it then pollutes every later `leaks()` check.
- A previous builder started the fix and was cut off by an API error. Compared with 7e6ac78, these files in the working tree are CHANGED
  and may be HALF-APPLIED: `tools/proc-guard/index.mjs`, `index.d.mts`, `test/run.mjs`, `test/mutate.mjs` (the other four are equal).
  Read `git diff --no-index` of each against `git show 7e6ac78:<path>` (write the old copy to your scratchpad) and decide: complete it or
  redo it. Say which in your report.

## The fix (as decided)
1. A process whose parent is pid 1, or whose parent is not a node process, is NOT a live owner of a Playwright-profile folder.
2. A unit test with a FAKE process list (no real processes) that proves rule 1: watched red against the 7e6ac78 rule, green with the fix.
3. The test that starts the stand-in stops its own stand-in in a `finally`, so a failing assertion never leaves it behind.
4. A mutant in `test/mutate.mjs` that restores the old rule (ppid 1 counts as alive) and is caught.
5. Keep the `owner.json` marker exactly `{ pid, started, kind, argv }` (the machine reaper reads it; a test pins it).

## Rules
- Edit only `tools/proc-guard/`. Anything else you find is a finding in your report, not a fix.
- Heavy commands only through the lock: `node ~/.claude/scripts/heavy.mjs -- <cmd>` (the mutants). One heavy run at a time.
- Never commit, push, stash, reset, switch branches or touch the git index. Other departments keep staged work in the shared index.
- No restore drill, no staging, no keys. No em dashes. Scripts in files, never inline `node -e`.
- Two failed approaches to the same obstacle: BLOCKED with what would unblock it.

## Done when (paste the real last lines)
1. `node tools/proc-guard/test/run.mjs`: 0 failed (on Windows).
2. `node ~/.claude/scripts/heavy.mjs -- node tools/proc-guard/test/mutate.mjs`: all caught, 0 escaped, the new mutant among them.
3. The watched-red line of the new unit test against the old rule.
4. `node tools/proc-guard/check-leaks.mjs`: no process runs from a temp folder of ours.
5. Your report to the head, under 25 lines: complete-or-redo, files changed, the pasted lines above, anything UNPROVEN (Linux is proven
   only by the head's GitHub check branch run, not by you).
