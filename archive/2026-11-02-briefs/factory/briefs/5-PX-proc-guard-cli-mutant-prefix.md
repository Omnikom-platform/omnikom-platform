# 5-PX: proc-guard knows the CLI mutant runner's temp prefix

Head: `HEAD_Platform-build_2026-11-02d`. Builder: `BUILDER_platform-build_5-PX`. Base: master 4f91b52.

## Why
The CLI's mutant runner copies the CLI into `%TEMP%\omnikom-cli-mut-XXXXXX` (`tools/omnikom-cli/test/mutate.mjs:374`).
`tools/proc-guard/index.mjs:23` PREFIXES does not list `omnikom-cli-mut-`, so `sweep()` (the machine reaper) never sees those
folders. The CLI department counted 303 of them in %TEMP% with no owner (finding via the head of operations, 2026-11-02 18:50).

## What to change (your files only)
1. `tools/proc-guard/index.mjs`: add `'omnikom-cli-mut-'` to PREFIXES. One line, nothing else in index.mjs.
2. `tools/proc-guard/test/run.mjs`: a group next to the `omnikom-jb-` group (run.mjs:224-247) for `omnikom-cli-mut-` folders
   with no owner.json and no process (the real shape of these copies), under the test's own `root`, never the real %TEMP%:
   - a copy older than 6 hours (set its times) is listed and `sweep()` removes it, with one log line naming it;
   - a copy younger than 6 hours is kept (a live CLI mutate run must never lose its tree);
   - a `.keep` copy is kept.
   Check names start `omnikom-cli-mut- (the CLI mutant copies):`.
   Addendum 19:15: two shapes exist. The 303 left in %TEMP% have no owner.json (head counted: 303 folders, "with owner.json: 0").
   The CLI's unlanded change (D:\omk-gates\cli-stack, tools/omnikom-cli/test/mutate.mjs:437) makes new copies with
   `guard.guardedTemp(copyPrefix(process.pid), 'cli-mutant')`, which writes owner.json with the pid. Read copyPrefix there (read
   only) so the test uses the real name shape, and add: a copy made the guardedTemp way whose owner pid is gone is removed; one
   whose owner is alive (this test process) is kept, whatever its age.
3. `tools/proc-guard/test/mutate.mjs`: a mutant "the CLI mutant prefix omnikom-cli-mut- is not in PREFIXES" in the shape of
   the `omnikom-jb-` one (mutate.mjs:38-39), caught by the new group.
4. Append a 5-PX section to `docs/blueprint/PROGRESS.md` (append-only) with the pasted lines below.

Do not touch `tools/omnikom-cli/` (CLI department's files) or anything else. Anything outside this brief is a finding you send
back, not a fix. Do not run the sweep against the real %TEMP%.

## Done when (paste each line)
- Watched red: the new group on 4f91b52's index.mjs (prefix not added) fails for the right reason (the old copy is not listed /
  not removed), then green with the prefix.
- `node tools/proc-guard/test/run.mjs` under heavy: "proc-guard tests: N passed, 0 failed".
- `node tools/proc-guard/test/mutate.mjs` under heavy: "mutants: N caught, 0 escaped", the new mutant's "caught" line pasted.
- No em dash added; `git diff --numstat` of index.mjs is 1 1.
- Nothing committed or pushed: stage exactly the changed paths in your worktree and report the list. The head lands it.

Rules: run every heavy command through `~/.claude/scripts/heavy.mjs` (wait, never bypass); scripts go in files; work in your own
worktree on 4f91b52 (`git worktree add --detach`), never in the shared tree; report to `HEAD_Platform-build_2026-11-02d` by
SendMessage with pasted output; write UNPROVEN / BLOCKED plainly.
