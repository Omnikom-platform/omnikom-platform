# Brief: ICM index, code map and librarian (head of operations, builder)

Owner ruling 2026-11-02 23:25 (Abdo): the one product book goes in an ICM structure "with a librarian on top of it" and "a full
code map with an auto indexer so nothing falls off track again". Proposed structure the owner approved:
https://claude.ai/artifact/XdUtE6L1Tpsj8p7Twk5AKZ (section "ICM layout, librarian and code map").
Background on ICM: `~/.claude/reference/icm-and-van-clief.md` (read it; do not re-derive).

You report to HEAD-OF-OPERATIONS_Omnikom_2026-11-02e by SendMessage. Anything outside this brief is a finding you send back,
not a fix you make.

## Read first, in order
1. `CLAUDE.md` (repo rules 1 to 12; rule 7 scripts in files, rule 10 commit through a check branch, rule 11 test + mutant).
2. `docs/departments/README.md` and `docs/departments/head-of-operations.md` (you edit only what this department owns; this
   brief adds `icm/` and `tools/icm/` to it, the head adds the charter lines).
3. `~/.claude/reference/icm-and-van-clief.md`.
4. `skills/icm-librarian.agent.md` (a copy from another project; its `tools/icm-index.mjs` does not exist here).

## Build
1. `tools/icm/index.mjs` (Node 20, ES module, no dependencies). It walks the repo (skip `node_modules`, `.git`, `film/`,
   `creds and accounts login/`, `.secrets/`, `archive/`, git-ignored paths; read `.gitignore`) and writes:
   - `icm/index.json` + `icm/INDEX.md`: every doc (`*.md` outside skipped paths): path, title (first heading), one-line
     summary (first paragraph, cut to 160 chars), owner department (from the "Owns" lists in `docs/departments/*.md`, longest
     prefix wins), layer (0 `CLAUDE.md`; 1 `icm/`; 2 `work/`; 3 `docs/product/` and `skills/`; 4 `work/STATE.md`,
     `.claude/POSITION.md`, `docs/blueprint/PROGRESS.md`; else "unplaced"), line count, and `loadFor` tags taken from a
     `load-for:` line in the file's first 10 lines when present.
   - `icm/code-map.json` + `icm/CODE-MAP.md`: every source file (`.mjs .js .ts .tsx .sql`, plus `supabase/functions/*/index.ts`):
     path, owner, exports (regex scan of `export function|const|class|default`; SQL: `create (or replace )?function` names
     and `create table` names), the test files that import or name it (grep by basename), and a `feature` field from a
     `feature:` comment in the first 10 lines when present (empty until the book lands; the book builder adds the tags).
   - Deterministic output (sorted, no timestamps inside the files) so a re-run on an unchanged tree changes nothing.
   - `--check`: exit 1 with one line per difference when the written index is stale versus the tree, or when a doc is over 300
     lines in `docs/product/`, or a source file has no owner.
2. Freshness, three triggers: (a) a Claude Code PostToolUse hook entry for Write/Edit that runs `node tools/icm/index.mjs
   --quiet` (write the hook script under `tools/icm/hook.mjs`; adding it to the owner's settings file is NOT yours: print the
   exact settings JSON line in your report for the owner's click); (b) a SessionStart line in the same report; (c) a CI step in
   the `departments and client files` job of `.github/workflows/ci.yml` running `node tools/icm/index.mjs --check` (that file
   is owned by CLI and testing: send the exact 3-line diff to the head as a finding, do not edit it).
3. `skills/icm-librarian.agent.md`: rewrite for Omnikom Platform: read-only (Read, Glob, Grep), Haiku, reads `icm/index.json`
   and `icm/code-map.json` by grep, answers "where is X" / "what do I load for Y" / "which file serves feature F" with exact
   paths, reports INDEX GAP lines; never answers from memory.
4. Tests: `tools/icm/test/run.mjs` on a small fixture tree under `tools/icm/test/fixture/` (owner lookup, layer, summary cut,
   exports for js/ts/sql, stale detection, 300-line cap, unowned file). Watched red then green; `tools/icm/test/mutate.mjs`
   with at least 6 mutants, all caught. Add the run line to `node docs/blueprint/specs/run-all-gates.mjs` only if that file
   is yours (it is platform's: send it as a finding).

## Done when
- `node tools/icm/test/run.mjs` prints all passed; `node tools/icm/test/mutate.mjs` prints every mutant caught (paste both).
- `node tools/icm/index.mjs` on master writes the four files; a second run changes nothing (`git status --short icm/` empty
  after commit); `--check` exits 0, then exits 1 after you add a stray unowned file (watched), restored.
- Report: the counts (docs, source files, unowned, unplaced, over 300 lines), the settings JSON lines for the owner, the ci.yml
  diff for CLI, the check branch sha and its CI run id. gitleaks clean. No em dashes.
