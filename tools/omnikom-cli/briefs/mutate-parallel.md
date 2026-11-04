# Brief: CLI mutants run in parallel workers, well inside the CI job's 120 minutes

Head: HEAD_CLI-and-testing_2026-11-02. Written 2026-11-02 15:10. Starts after journey-r2 lands (HoO-02c's order).
CHANGED 17:35: now BLOCKS the land. Run 41453440713 (62315d5, check/cli-and-testing/journey) was 8 of 9 green; the CLI job was cancelled in
"CLI full suite and mutants" with "The job has exceeded the maximum execution time of 2h0m0s" (13:29:51Z to 15:30:28Z). HoO rule: a timeout is
a red, never a plain re-run. So: build in `D:\omk-gates\cli-stack` on a new local branch `mutate-workers` over 62315d5 (journey-r2), commits on
top; do not push (the head pushes); done when the stack's next CI run is 9 of 9 with the CLI job well under 120 min.

## Why
The `cli` job (`.github/workflows/ci.yml:131-158`, `timeout-minutes: 120`) runs `test/ci-heavy.mjs`: `run.mjs` (full), then `mutate.mjs`, one
mutant after another, each re-running the suite. The last full run took 101 min; every new mutant pushes it toward a timeout red. On the laptop
`mutate.mjs --only journey` took over 3 h on 2026-11-02 (11:52 to 15:00+) and held the heavy lock the whole time, serialising every department.

## Decided (head, 15:10)
Stay inside `tools/omnikom-cli/` (`.github/` is platform-build's: no ci.yml change, no new job, so `omnikom land`'s job count is untouched).
`mutate.mjs` gets `--workers N` (default: `OMNIKOM_MUTANT_WORKERS`, else min(4, cpus - 1), at least 1). Each worker owns a private copy of the
tree it mutates (a temp folder under the proc-guard, never the live tree) and a private slice of the CLI port block 21000-21899 (DECISIONS 50:
never leave the block; worker k takes its own sub-block, written next to the port map in `briefs/real-kill-flake.md`). The baseline runs once,
before the workers. Mutants are handed out from one queue; output is one line per mutant, as now, and the summary line keeps its exact words
("N mutants, N caught, 0 survived, 0 target text missing"), so nothing that reads it changes. A mutant's file is never edited in the live tree.

## Do
1. Measure first: from the last green CLI job log on GitHub (`gh run view <id> --log --job <cli job>`), per-mutant seconds, unit vs db; the same
   for one local `--only "[small-fixes]"` run. Paste the totals. Pick N and the sub-block size from that and say why in a comment.
2. Build `--workers` as above. A worker that crashes is a FAIL of the run naming the worker and its mutant, never a silent "caught".
3. Tests (`test/mutate-workers.test.mjs` or the existing harness, your pick), watched red first:
   a. two workers never touch the same file copy or port (a fake runner records them);
   b. the live tree is byte-for-byte unchanged after a run with a mutant that edits a file (hash before and after);
   c. a mutant that survives in worker 2 makes the run exit non-zero with the survivor's name;
   d. `--workers 1` gives the same caught/survived set as today on a small `--only` filter.
4. Mutants of the runner itself (in `test/mutate.mjs` or the new test's own list): workers share one port sub-block; the mutant is applied to the
   live tree; a worker crash counts as caught.
5. Proof: `run.mjs --unit` OK; a SMALL local mutant run with `--workers` (`--only "[small-fixes]"` or similar, under the heavy lock, background),
   its wall time against `--workers 1` on the same filter; gitleaks staged clean. Never the full local mutant run (it held the laptop 3 h on
   2026-11-02): the full number comes from the stack's own CI run.

## Done when
Commits on a check branch the head pushes; CLI job green with the mutants step well under 60 min, and the pasted lines above. Anything outside
`tools/omnikom-cli/` (ci.yml, proc-guard, heavy.mjs) is a finding sent to the head, not a fix.

## Also in this slice (head, 15:15): the mutant tree copies leak
2026-11-02 15:14 the builder counted 303 `omnikom-cli-mut-*` folders in %TEMP%, left by mutate runs that were killed or stopped (every
session's). Each copy (the workers' and today's single one) is made through `tools/proc-guard` `guardedTemp` (removed on every exit path), and
a run starts with a sweep that removes only copies whose owner pid is dead (the pattern of the cluster sweep, `test/harness.mjs`). Test watched
red: a run killed mid-mutant leaves no copy after the next run's sweep; a copy whose owner is alive is never touched. A mutant: the sweep removes
a live owner's copy.
