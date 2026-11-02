# Brief: audit slice 4b.1, no leaked temp folders (Sonnet builder; one slice, discarded when done)

Department: SEO and audits (`docs/departments/seo-and-audits.md`). Report to the head that started you. Anything outside this brief
is a finding, not a fix.

## Why
On 2026-10-31 about 4,100 `omnikom-audit-*` folders were left in the Windows temp folder. `test/run.mjs` makes its temp folders with
`mkdtempSync(join(tmpdir(), ...))` and removes them in a `finally`, but a run that is killed (the mutant timeout in `test/mutate.mjs`,
a laptop sleep, Ctrl+C) never reaches the `finally`. `test/mutate.mjs` removes each mutant's copy folder, but not the temp folders its
killed child made in the system temp folder. The head of operations asked: the audit tests remove their temp folders, and a test fails
if a run leaves one behind.

## What to build (in `tools/audit/test/` only)
1. Every temp folder a test run makes lives under one root per run. `run.mjs` reads its temp base from `OMNIKOM_AUDIT_TMP` when set,
   else `tmpdir()`, makes one root `omnikom-audit-run-*` under it, and makes every other temp folder inside that root. The root is removed
   in the `finally`, in the fail-fast exit, and on `SIGINT`/`SIGTERM` (then exit with the usual code). Children it spawns (the CLI, the
   engine) get `TMPDIR`, `TEMP` and `TMP` pointed inside the root, so their temp files are inside it too.
2. `mutate.mjs` makes one root `omnikom-audit-mutate-*` and each mutant's copy inside it, and gives each child
   `OMNIKOM_AUDIT_TMP=<that mutant's copy>/.tmp` plus `TMPDIR`/`TEMP`/`TMP` the same, so a killed child's folders go when the copy goes.
   The root is removed at the end and on `SIGINT`/`SIGTERM`.
3. The test: in `run.mjs`, one check that runs `mutate.mjs` as a child with `MUTATE_ONLY` set to one cheap mutant, `MUTATE_JOBS=1`,
   `MUTATE_TIMEOUT_S=2` (so the child is killed and prints `NOT RUN`), and `TMPDIR`/`TEMP`/`TMP` plus `OMNIKOM_AUDIT_TMP` pointed at a
   fresh empty folder. It passes only if the child printed a `NOT RUN` line and the folder is empty afterwards (name every leftover in the
   FAIL detail). Guard against recursion: the check sets `OMNIKOM_AUDIT_NESTED=1` for that child, and `run.mjs` skips this one check when
   `OMNIKOM_AUDIT_NESTED=1` (not counted, no line). It must still run inside the real mutant children, so do not
   skip it on `OMNIKOM_AUDIT_FAILFAST`.
   Watched red: run the check against the current (unfixed) harness, see it FAIL naming a leftover `omnikom-audit-*` folder, then fix.
4. Mutants in `mutate.mjs` (the full run catches each): the child env no longer points the temp base inside the copy; `run.mjs` no longer
   makes its folders under the root; the `SIGTERM` handler removed (if a test can see it; if not, say so plainly, do not fake one).
5. Cost: this check adds seconds to every suite run, and the CI audit job has a 40-minute limit with about 344 mutants. Measure the
   check's time and say it in your report.

## Done when (paste the real last lines)
```
node tools/audit/test/run.mjs                      OK: N of N checks passed, exit 0 (N > 483)
MUTATE_ONLY='<your new mutants regex>' MUTATE_JOBS=1 node tools/audit/test/mutate.mjs   all caught, 0 survived, 0 not run
```
plus the watched-red FAIL line. Do NOT run the full mutant run or run-all-gates (they run on GitHub, DECISIONS 45). After your run,
list the system temp folder for `omnikom-audit-*` entries newer than your start and paste the count (expected 0).

## Rules
- Edit only `tools/audit/test/run.mjs`, `tools/audit/test/mutate.mjs`, and a line in `tools/audit/README.md`. Node built-ins only.
  Scripts in files, never inline `node -e`. No em dashes.
- Stop only processes you started, by their PID, never by name or pattern. Delete only folders your own runs made.
- Do not commit, push, stash, reset or switch branches. The head commits.
- Add a block "## SEO and audits, slice 4b.1: temp folders (<date time>, builder)" above the slice 4b block in `docs/blueprint/PROGRESS.md`.
