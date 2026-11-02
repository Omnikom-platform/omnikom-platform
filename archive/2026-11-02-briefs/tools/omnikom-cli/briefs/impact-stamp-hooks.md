# Builder brief: `omnikom impact`, the gate stamp and the pre-push hook (CLI department, released 2026-10-31 17:40, DECISIONS 43)

Builder: one sonnet session, this slice only, discarded when done. Head: the CLI and testing department head. Source: DECISIONS 43
(`planning/DECISIONS.md`, read item 43 whole) and `docs/departments/README.md` rule 8. What went wrong: platform 4.6 (f831f10) added
required fields to the test contract in `supabase/tests/tenancy.test.sql`, and the CLI's seed check went red on GitHub. The CLI fix
(eeb8431) changed `tools/omnikom-cli/commands/seed.mjs`. `supabase/functions/test/harness.mjs` imports that file
(`pathToFileURL(join(REPO, 'tools', 'omnikom-cli', 'commands', 'seed.mjs'))`), so the functions and gates jobs went red. Each push
ran only its own department's tests. This slice makes the chain visible before a commit and refuses a push of an untested tree.

Read first: DECISIONS 43, every charter's `## Owns` list in `docs/departments/*.md`, `docs/blueprint/specs/run-all-gates.mjs` (the
`GATES` table), `.github/workflows/ci.yml` (every job's `run:` lines), then the CLI's `omnikom.mjs`, `lib/repo.mjs`, `lib/args.mjs`,
`lib/ctx.mjs`, `commands/ci.mjs`, `test/run.mjs`, `test/mutate.mjs`, and `~/.claude/reference/windows-scripting.md`.

## Files you may edit (nothing else; a bug anywhere else is a finding you send back, not a fix)
`tools/omnikom-cli/**`: new `commands/impact.mjs`, `commands/gates.mjs`, `commands/hooks.mjs`, `lib/graph.mjs`, `lib/stamp.mjs`,
`impact-copies.json`; plus `omnikom.mjs` registration, `commands/ci.mjs` (it writes a stamp too), `README.md`, `test/run.mjs`,
`test/mutate.mjs`. `docs/blueprint/specs/run-all-gates.mjs` is the platform department's: do NOT edit it. The stamp is written by
the CLI command that runs it (Part 2). Never `.github/`, never `.gitignore`. Install the hook only in throwaway test repositories;
the head installs it in this repository after the proof.
**You never commit and never push (DECISIONS 43 (4)), and you never run `git add`.** The head has staged the previous slice; your
work stays unstaged in the working tree. Never `git stash`, `reset`, `checkout`, or switch branches.

## Part 1: `omnikom impact <files...> | --staged | --commit <sha> [--json]`
Lists every tracked file that imports, reads or copies a changed file, each with its owner and the gates that cover it.
1. **Inputs.** Repo-relative paths, or `--staged` (`git diff --cached --name-only`), or `--commit <sha>` (that commit against its
   first parent). A path that is not tracked and does not exist is a Usage error (exit 2).
2. **The graph** (`lib/graph.mjs`, built from `git ls-files`; only code and data files: `.mjs .js .cjs .ts .sql .yml .yaml .json .sh
   .ps1 .toml`; every other file is a leaf that can be read but reads nothing):
   - **imports**: static `import ... from '<p>'`, `export ... from '<p>'`, `import('<p>')`, `require('<p>')`, resolved against the
     importing file's folder (and `.ts` imports in Deno files);
   - **path reads**: a path built from string literals in one call: `join(...)`, `resolve(...)`, `path.join(...)`, `new URL('<p>',
     import.meta.url)`, `repoPath(...)` and `importRepo('<p>')` of `lib/repo.mjs`, and a bare string literal with at least one `/`.
     Joined pieces count from the repo root when the first piece is a root variable (`REPO`, `REPO_ROOT`, `ROOT`, `root`) and from
     the file's folder otherwise. Read `harness.mjs` line 43 and make sure this form is found. A literal that names a FOLDER counts
     as reading every file under it only when it has at least two path segments (so `'supabase'` alone reads nothing);
   - **CI and gates**: each `ci.yml` job's `run:` lines and each `GATES` row of run-all-gates are entry points (read the
     `GATES` table as data: parse the array literal, do not import the file).
   An import edge is followed transitively (A imports B imports changed C: A is affected, why `imports B, which imports C`); a read
   edge is one step only.
3. **Named literal copies**: `tools/omnikom-cli/impact-copies.json`, a list of `{ "name", "files": [a, b], "why" }`. First entry:
   `TEST_CONTRACT`, files `tools/omnikom-cli/commands/seed.mjs` and `supabase/tests/tenancy.test.sql`, why "the test contract and
   fixture ids, copied". Add any other copy you find while reading (the fixture ids are part of the same entry). A changed file
   that is in an entry names the other files of that entry. A unit test fails when a listed file no longer exists.
4. **Owner**: the department whose charter `## Owns` list holds the file (longest matching prefix wins; honour "except" in a bullet,
   e.g. platform-build owns `docs/blueprint/` except two files). No owner is printed `unowned` and is a finding line at the end.
5. **Gate**: every `GATES` row and every `ci.yml` job whose entry points reach the affected file (or the changed file) through the
   graph. The secret scan job covers every file and is never printed (it is not evidence that behaviour still works).
6. **Output** (text, short; one line per affected file, sorted by owner then path; the JSON has the same rows):
   ```
   platform-build  supabase/functions/test/harness.mjs  imports tools/omnikom-cli/commands/seed.mjs  job functions; gate function tests (Deno)
   platform-build  supabase/tests/tenancy.test.sql  copy TEST_CONTRACT of tools/omnikom-cli/commands/seed.mjs  job gates; gate database walls + mutants
   ```
   Then one line per changed file: `changed  <path>  <owner>  <gates or "no gate reads it">`, and a last line
   `impact: N files outside <owners of the changed files>; gates to run: <list>` or `impact: prose only, no gate reads these files`.
   Exit 0 always (it informs, it does not judge), except Usage errors.
7. **The proof case**: `omnikom impact --commit eeb8431` and `omnikom impact tools/omnikom-cli/commands/seed.mjs` both name
   `supabase/functions/test/harness.mjs` with owner platform-build, the `functions` job and the gate `function tests (Deno)`, and
   `supabase/tests/tenancy.test.sql` as a copy. `omnikom impact docs/departments/README.md` says what reads it (if nothing does,
   "no gate reads it").

## Part 2: the gate stamp: `omnikom gates [--staged | --commit <sha>] [--json]`
A stamp is proof that the full gates passed on one exact tree. A test that runs on a tree other than the one being pushed proves
nothing, so the gates never run on the working tree (other heads' unfinished files sit there).
1. Tree: `--staged` (the default) is `git write-tree` of the index; `--commit <sha>` is `git rev-parse <sha>^{tree}`.
2. Make a throwaway checkout of exactly that tree: `git commit-tree <tree> -m "omnikom gates"` (a dangling commit, never a ref),
   then `git worktree add --detach D:/omk-gates/<tree> <that commit>` (head of operations 17:34: on D:, never on E:, which is 96%
   full, and never under a path containing "claude", which a local guard refuses). The root `D:/omk-gates` is one constant; tests
   pass another root through `ctx`, and a root on E: or containing "claude" is refused (Usage, exit 2). Run `node docs/blueprint/specs/run-all-gates.mjs` with
   that folder as the working directory, timeout from ci.yml's gates job `timeout-minutes`. If the gates need installed packages
   (find out: does any gate import from `node_modules`?), install them in the temp folder the way ci.yml does and say so in the
   report. Always remove the temp worktree (`git worktree remove --force`, then `git worktree prune`), also on failure or timeout.
3. Passed means exit 0 AND the last line is `all gates passed`. Then write `<git common dir>/omnikom-gates/<tree>.json`
   (`git rev-parse --git-common-dir`, so it works from a worktree): `{ tree, passedAt, command: "gates", last: "all gates passed",
   lines: [every PASS line], node: process.version }` (the stamp is evidence, not a flag: `readStamp` treats a file without
   `tree` equal to its name, a `passedAt`, a `command` and `last` equal to the gates' final line as no stamp). A failed run writes nothing and deletes an old stamp for the same tree. Print the PASS/FAIL lines
   and `stamp: <tree>` or `no stamp: <reason>`.
4. `omnikom ci` gets the same `--staged | --commit` and the same throwaway checkout; when every job passed it writes the stamp with
   `command: "ci"`. Without those flags it behaves as today and writes no stamp (it ran on the working tree).
5. `lib/stamp.mjs`: `treeOf`, `stampPath`, `readStamp`, `writeStamp`, `withTreeCheckout` used by both commands.

## Part 3: `omnikom hooks install | uninstall | status` and `omnikom hooks pre-push`
1. `install` writes `<git common dir>/hooks/pre-push` (or `core.hooksPath` if set: then refuse with Blocked, exit 3, naming it):
   ```
   #!/bin/sh
   # omnikom pre-push (DECISIONS 43)
   exec node tools/omnikom-cli/omnikom.mjs hooks pre-push "$@"
   ```
   LF line endings. A pre-push hook that is not ours (no `# omnikom pre-push` line) is never overwritten: Blocked, exit 3.
   Installing twice changes nothing. `uninstall` removes only our file. `status` prints installed / not installed / foreign.
2. `hooks pre-push` reads git's stdin lines `<local ref> <local sha> <remote ref> <remote sha>`. For each pushed ref whose local
   sha is not all zeros (deleting a ref is allowed):
   - the tip's tree has a stamp: allowed, print `pre-push: <ref> tree <tree> stamped by <command> at <passedAt>`;
   - no stamp: take the files changed between the remote sha (or, when the remote sha is all zeros or not known locally, the
     merge base with `refs/remotes/<remote>/master`) and the tip, and run Part 1 on them. When every changed file is "no gate reads
     it", allowed with `pre-push: prose only (<n> files), no gate reads them`. Otherwise refused, exit 1:
     `pre-push: REFUSED <ref>: tree <tree> has no passing stamp; run: node tools/omnikom-cli/omnikom.mjs gates --commit <sha>`,
     followed by the impact lines of the gated files.
   Only the tip's tree is checked (CI tests the tip). `git push --no-verify` skips every hook. It is the owner's alone: no session,
   head or builder ever uses it (the global rule: never skip hooks). Say so in the README row, and end the refusal message with the
   line `pre-push: --no-verify is the owner's alone; no session uses it.`

## Tests (`test/run.mjs`; units in throwaway git repositories under the OS temp folder, removed after)
- impact on a small planted repo: a static import, a transitive import, a `join(REPO, 'a', 'b.mjs')` read, a folder read with two
  segments (counted) and one segment (not counted), a copy entry, an unowned file, a prose file; each row's owner, why and gate.
- impact on the real repo: the proof case of Part 1 item 7 (reads files only, no git writes).
- gates: with a fake gates script (an injectable command through `ctx`), a pass writes the stamp for the index tree (not HEAD's tree:
  stage a change, check the stamp name equals `git write-tree`), a fail writes none and removes an old one, the temp worktree is gone
  afterwards in both cases (`git worktree list` does not list it and the folder does not exist), an unstaged change in the working
  tree is NOT in the tested folder; a root on E: or containing "claude" is refused; a stamp file missing `last` or with another
  tree is read as no stamp.
- hooks: install into a throwaway repo, a foreign hook is refused and left byte for byte, install twice is a no-op, uninstall.
- pre-push: stamped tip allowed; unstamped tip with a gated file refused with the command line; prose-only allowed; a ref delete
  allowed; a real `git push` from the throwaway repo to a bare throwaway remote is refused by the installed hook, then allowed after
  writing the stamp (this proves the shim, not just the function).
Watch each new check fail (break what it measures, see the FAIL line name it, restore) and list them in the report.

## Mutants (`test/mutate.mjs`, the target text occurs exactly once; at least these)
- impact: the import scan off (the proof case must go red: harness.mjs missing); the `join(...)` path scan off; the copy registry
  ignored; transitive imports not followed; the owner's longest-prefix rule replaced by first match; the "except" ignored.
- gates: the stamp written on a failed run; the stamp keyed by HEAD's tree instead of the index; the temp worktree not removed on
  failure; the run done in the working tree instead of the checkout.
- hooks: a foreign hook overwritten; pre-push allows a tip with no stamp; the prose exception allows a gated file; the remote-sha
  range replaced by the tip's own parent only.

## Gates (run in a clean copy of HEAD plus your files, never only in the working tree; paste the real last lines)
```
node tools/omnikom-cli/test/run.mjs --unit
node tools/omnikom-cli/test/run.mjs
OMNIKOM_MUTANT_TIMEOUT_MS=3000000 node tools/omnikom-cli/test/mutate.mjs --only "impact"
OMNIKOM_MUTANT_TIMEOUT_MS=3000000 node tools/omnikom-cli/test/mutate.mjs --only "gates:"
OMNIKOM_MUTANT_TIMEOUT_MS=3000000 node tools/omnikom-cli/test/mutate.mjs --only "hooks"
node tools/omnikom-cli/omnikom.mjs impact --commit eeb8431
node tools/omnikom-cli/omnikom.mjs impact tools/omnikom-cli/commands/seed.mjs
```
Not run by you: `omnikom gates` on this repository's real tree (the head's Haiku runner does it), `hooks install` here.

## Report (short; PROVEN with pasted lines, UNPROVEN, NOT DONE, BLOCKED)
Files changed; the pasted gate lines; the two impact outputs above in full; the watched-fail list; anything the graph cannot see
(dynamic paths built at run time) as a known gap; findings for other departments with file:line. No em dashes in any file.
