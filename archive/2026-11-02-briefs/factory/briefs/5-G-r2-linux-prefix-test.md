# 5-G round 2: the omnikom-jb- prefix test fails on Linux (the stand-in survives the sweep)

Head: `HEAD_Platform-build_2026-11-01d` (report by SendMessage). Builder: Sonnet, effort high. Written 2026-11-02 03:19.
First read `factory/briefs/5-G-proc-guard-prefix-and-mutant-name.md` (the slice) and the 5-G section of `docs/blueprint/PROGRESS.md`
on commit 0a21991.

## What happened
5-G (commit 0a21991, on `check/platform/5-l-5-g`; the code is the same as 07b5365) is green on Windows ("63 passed, 0 failed",
"22 caught, 0 escaped"). On GitHub's Ubuntu runner, run 41370578157, gates job, it is red:
```
FAIL omnikom-jb- (the journey): after the sweep the folder is gone, the stand-in is dead and leaks() is empty: folder false alive true |
proc-guard tests: 62 passed, 1 failed
FAIL process guard mutants      FAILED: the unmutated copy does not pass; nothing to measure
```
The other groups with stand-ins (cluster, real browser, and the rest) pass on Linux in the same run. So the new `prefix` group does
something they do not: find the difference.

## Find the cause (read, then prove)
Compare the new `prefix` group in `tools/proc-guard/test/run.mjs` with an existing Linux-green group that plants a folder plus a
stand-in and sweeps it. Candidates: how the stand-in is started (detached, its parent, so on Linux it may be reparented to pid 1
and treated differently, see `tools/proc-guard/index.mjs` since 713b008: a pid-1-parented holder is not a live owner); how the
folder path appears in its command line (leaks() matching on Linux /proc cmdline vs Windows); a check made before the kill lands
(no wait for exit). Write down which one, with the line numbers.

## Fix
Fix the TEST so the prefix group plants its stand-in the way the passing groups do. Do NOT change index.mjs behaviour (how
proc-guard decides owners, kills or sweeps): if the only fix is in index.mjs, stop and report it with the evidence; that goes to
the head of operations first. The one-line PREFIXES change stays.

## Proof
Windows: full `node tools/proc-guard/test/run.mjs` and `node tools/proc-guard/test/mutate.mjs` green, through
`node "$HOME/.claude/scripts/heavy.mjs" --label "<name>" -- <command>`. Linux: you cannot run it; say what the GitHub run must show,
and the head pushes it. Work in a worktree of commit 0a21991 (`git worktree add --detach <dir> 0a21991`), never the shared tree;
never commit, push or deploy. Scripts in files, no `node -e`, no em dashes. Anything outside this brief is a finding, not a fix.
