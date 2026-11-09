# Work order 12: the book checks itself (hardening step H0-6, row E20; builder BUILDER_head-of-operations_book-check, 2026-11-09)

Rule 36 (`docs/product/11-rules.md`): the book's numbers are computed, never typed. Built on master `d6353e9`.

## What

`tools/icm/book-check.mjs` (about 160 lines, no dependencies, no network, 16 ms on the real book) exports `checkBook(root)`;
`check()` in `tools/icm/index.mjs` adds its lines to the existing ones, so CI's step `node tools/icm/index.mjs --check`
(gates job, `.github/workflows/ci.yml:36`) runs it with no workflow change. One plain line per problem, each starting `BOOK`:

- **Counts** (`BOOK COUNTS`): every `### X. ...` section of `1-product.md` (any capital letter) is counted by the state word of
  its rows (WORKS, PARTLY, MISSING; `PARTLY, to be removed` counts as PARTLY) and compared with its row of `### Counts`, the Rows
  column too; the Total row is compared with the sum of the parts. A part with no Counts row, a Counts row with no section, no Total
  row, a state that is none of the three, a row of part B under part A (`BOOK ROWS`) are problems too.
- **Paths** (`BOOK PATHS`): in a WORKS row, a backticked span with a slash or a known extension must exist, relative to the repository
  root, `docs/product/` or `supabase/functions/`. The `Short forms:` line is parsed (`D:` and `F:x`). Skipped: routes (leading
  `/`), spans with spaces or `$`, M-numbers, plain words. Rows that are not WORKS are not checked.
- **Steps** (`BOOK STEPS`): in the "Hardening steps" table of `9-blocks.md` (columns found by the headers Owner and Row) a step has
  an owner, has a Row cell, and names only rows that exist in `1-product.md`; every part E row is named by some step. A tree with neither
  book file (the test fixture) is not checked; with only one of the two, `BOOK:` names the missing one.

Row E20 moved to WORKS and the counts table recomputed: E is 1, 12, 8 of 21; Total 48 works, 27 partly, 21 missing, 96 rows.

## Proof (all run in this worktree)

- `node tools/icm/test/book.mjs`: 30 passed, 0 failed (each check watched red on a broken copy: a wrong part count, a wrong Total,
  a missing path, an empty owner, an unknown row, an orphan E row, a new part F; three cases go through the CLI exit code).
- `node tools/icm/test/mutate.mjs --book`: 18 caught of 19, 1 survived (the missing-book-file guard: the check threw, the suite crashed
  without a FAIL line, which the harness does not count as a catch). The test now turns a throw into a FAIL line; re-run with
  `--match "missing book file"`: `icm mutants: 1 caught, 0 survived, 0 target text missing (of 1)`. So 19 of 19 caught.
- `test/run.mjs` now runs `test/book.mjs` at its end (`book: test/book.mjs passes`; mutants of the other files set
  `OMNIKOM_ICM_NO_BOOK`). Watched red through it: a copy with the Total comparison removed, `run.mjs` gives "icm tests: 66 passed,
  1 failed", the failure being `book: test/book.mjs passes: counts: a wrong Total is named | cli: ...`.
- The real tree: see the final report for the `--check` line after `icm/` was regenerated.

## Limits (honest)

- CI runs only `--check`, not `test/run.mjs`, `book.mjs` or the mutants (CLI's ci-coverage slice lists such suites). The check
  itself runs in CI; its tests do not yet.
- A path is looked up on disk, so a WORKS row naming a git-ignored file passes locally and fails in CI; none does today.
- Evidence prose (a "5 of 5" in a row) is not checked, only counts, paths and step ownership.
- `work/STATE.md` still says "Total 47 works of 96" (head's file): now 48.
