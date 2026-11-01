# Brief: builders start on high effort by default (head of operations, 2026-11-01 20:50)

You are BUILDER_head-of-operations_effort-default. You report to HEAD-OF-OPERATIONS_Omnikom_2026-11-01d by SendMessage.
Anything outside this brief is a finding you send back, not a fix you make.

## Why
The owner noticed the Sonnet builders run on low effort (2026-11-01 20:47). Cause: `~/.claude/settings.json` has
`"effortLevel": "low"` machine-wide, and `tools/departments/start-builder.mjs` writes no `--effort` into the launcher unless the
head passes one, so every builder inherits low. Decided by the head of operations: a builder starts on `high` unless the head
passes another level.

## Read first
1. `CLAUDE.md`
2. `docs/departments/head-of-operations.md` (you edit only what it owns)
3. `docs/departments/README.md`, section "Starting and stopping a builder session"
4. `tools/departments/start-builder.mjs`, `tools/departments/builder-lib.mjs`
5. `tools/departments/test/start-builder.test.mjs`, `tools/departments/test/start-builder.mutants.mjs`

## Task
1. `start-builder.mjs`: when `--effort` is not given, the launcher's claude line carries `--effort high`. An explicit
   `--effort <level>` still wins. The dry-run JSON shows the effort used.
2. Tests: update the launcher-shape checks that expect no `--effort` (for example start-builder.test.mjs:60); add a check
   "no --effort given -> --effort high on the claude line" and keep "--effort low reaches the line" passing. Watched red: break
   the default, see the new check fail for that reason, restore.
3. One mutant in `start-builder.mutants.mjs`: the default effort removed must be caught.
4. README "Starting and stopping a builder session": one sentence: builders start on high effort unless the head passes
   `--effort`; the machine default is low.
5. Do NOT change `start-all.mjs` (heads), `~/.claude/settings.json`, or any other department's files.

## Rules
Scripts in files, never inline `node -e`. No em dashes. Keys by variable name only. Do not commit; the head commits.

## Done when (paste each line in your report)
- `node tools/departments/test/start-builder.test.mjs` OK line (with the guard)
- `node tools/departments/test/run.mjs` OK line
- `node tools/departments/test/start-builder.mutants.mjs` summary line (0 survived)
- `node tools/departments/check.mjs` OK line
- the watched-red line
- `git diff --stat` of your change
