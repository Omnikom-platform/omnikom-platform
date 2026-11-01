# Builder brief: make the head-of-operations landing commit green on GitHub (head of operations, 2026-11-01 18:15)

You are `BUILDER_head-of-operations_d49-ci-fix`. You report to the head of operations (the name in the last TAKEOVER line of
`.claude/POSITION.md`) by SendMessage. Anything outside this brief is a finding you send back, not a fix you make. You never
commit or push (DECISIONS 43 (4)); you hand back a working-tree change and a report.

## Where
Work in the worktree `D:\omk-gates\hoo-land` (detached HEAD 782b707, on master daa01d1). Never edit `E:\Omnikom Platform`: other
heads' files are dirty there. Only files the head of operations owns may change (`docs/departments/head-of-operations.md`, Owns).

## The red run
GitHub run 41323582926 on 782b707 (check/head-of-operations/d49-landing): 6 of 9 jobs green. Red:
1. "departments and client files": `tools/departments/test/run.mjs` -> `start-all.test.mjs: FAILED: 3 of 16`, all three of them
   the stale-pid checks added today ("a registry entry whose process is gone does not block", "a pid now held by another program
   (svchost) is listed as stale ...", "a pid now held by a later claude.exe ... is stale"). They pass on this laptop (20 of 20).
   So on Linux the code or the test reaches the real process table (or a Windows-only path) instead of the
   OMNIKOM_PROCESSES_FILE fixture. Find out which, and fix it so the same checks run and pass on both. A check may be skipped on
   Linux only if it cannot mean anything there, and it must print a named SKIP; the three above can mean something on Linux,
   so they must run.
2. "gates": `FAIL process guard mutants: 20 caught, 1 escaped ... (non-Windows: the taskkill half of a two-part mutant ...)`,
   with a leftover process ("left: [pid 10077 ppid 1 name MainThread ...").
3. "platform CLI": not read yet.
For 2 and 3: find out whether this commit causes them. Compare with master daa01d1's green run 41320962343 and with the
files 782b707 changes (`git diff --stat daa01d1 782b707`). If this commit does not touch what fails, it is a finding for the
owning department (name the file and the owner from the charters), not a fix. Rerun the failed jobs once (`gh run rerun
<id> --failed`) to tell flaky from real, and say which.

## Done when
- `node tools/departments/test/run.mjs` and `node tools/departments/check.mjs` green in the worktree, pasted.
- The three stale-pid checks pass on Linux too. Prove it without GitHub minutes if you can (WSL, or a Linux container if one
  exists here); if nothing Linux exists on this laptop, say so plainly. The GitHub run then decides.
- start-all mutants still all caught (`node tools/departments/test/start-all.mutants.mjs`), pasted.
- A report naming the cause of each of the three red jobs, with its evidence lines.
- No em dashes; scripts in files; no secret values.
