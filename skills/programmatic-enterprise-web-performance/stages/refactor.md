# Stage: refactor (mode `refactor <path>`)

Load this file only when the mode is `refactor`. It turns an audit's root causes into proven fixes on a git branch and
hands the owner a summary to approve. **Nothing is merged to main, pushed or deployed by this stage.** The owner
decides, in words, after reading the summary.

## What it needs (inputs, all files)
| Input | From | If missing |
|---|---|---|
| `<repo>/.checks/causes.json`, `run-all.mjs`, `scripts/check-*.mjs`, `findings/*.md` | an `audit-repo` run (coordinator.md) | run the audit first; refactor starts from its root causes |
| A git repository that contains `<repo>` | the project | stop: no git means no safe branch |
| The build command that regenerates the site (`--build "node _build/build.mjs"`) or `--no-build` for a site with no generator | the repo's README/package.json, or ask the owner once | stop and ask. Without a rebuild a check proves nothing |
| `--setup "<cmd>"` (e.g. `npm ci`) only if a fresh checkout cannot build without it | package.json | the baseline build fails and the run reports BLOCKED with the build output |
| Optional `.pewp/needs-people.json` `{ "C04": "why" }`, `--people C04,C07` | the main session, after reading REPORT.md | the heuristic still skips causes whose fix text asks for client content or an owner decision |
| `--decisions <file>` (repeatable): the project's binding defaults or decisions (Francine & Eli: `icm/gate-0-1/DEFAULTS.md`); a `DECISIONS.md` at the site root or repo top is found by itself | the main session, from the project's rules | workers are not told what the client holds; a fix can land in a held area (C16 added listing JSON-LD while DEF-07 holds the client's own listings) |

## Worktree setup: sites whose build needs git-ignored inputs
A worktree is a fresh checkout of the last commit, so anything the build needs that git ignores (installed packages, pinned
libraries, a media folder) is missing and the baseline build fails (BLOCKED: "the untouched code does not build"). `--setup "<cmd>"`
runs in every worktree (cwd = the worktree's site root) before each build. Write it as a small script in the project's `tools/`:
- **Copy** small inputs (a `.deps` folder of pinned libraries, `node_modules` via `npm ci`).
- **Hard-link** big read-only inputs (photos, map tiles, film): no extra disk space, and removing the worktree removes only the
  links, never the main checkout's files. Reference implementation: `E:/Francine & Eli/tools/refactor-setup-vtv.mjs`
  (copies `_build/.deps`, hard-links `assets/site-media`; refuses to run on the main checkout).
- **Do not use junctions or symlinks**: `git worktree remove` followed them and left the worktree half removed (the script now also
  says so in the report's notes if a folder survives).
- The setup must be idempotent (it runs again before the rebuild after each worker) and must never write to the main checkout.
- A site whose build regenerates large assets when inputs are missing (film, terrain) needs the inputs linked, or the baseline is meaningless.

## Safety scope and the start rule (monorepos)
The repo may hold other work. The run refuses to start (exit 2) when the main checkout has **uncommitted changes under the site root**
(the worktrees start from the last commit, so the "before" would not be the code you see): commit or stash them first. Uncommitted
changes elsewhere in the repo are only a note. While workers run, the safety fingerprint watches **only the files under the site root
and the base branch's tip**. A change there, or a commit on the base branch that touches the site root, refuses the worker(s) that
ran at that time and marks the run UNSAFE. Edits elsewhere in the repo, other branches moving, or the base branch moving with commits
that do not touch the site are listed under "Elsewhere in the repository" in the report and do not count against the run. If the base
branch moved, the report says so plainly with the old and new tip and that **nothing was rebased**: the refactor branch stays based on
the commit the run started from, and the owner merges it as it is.

## Work is never lost: patch first, commit second
For every worker whose change is non-empty the coordinator saves `git diff --binary` to `.pewp/refactor/<run>/<cause>.patch`
**before** any check or commit is tried (and again in its final, rebuilt form just before the commit). If `git commit` is refused
(typically the project's pre-commit hook), the verdict is **NOT COMMITTED**: the worktree and its branch are kept with the work
staged, the report carries the hook's full message, the patch path and the worktree path, and the run is not UNSAFE. Hooks are
never skipped; the project fixes the hook, then commits from the worktree (`git -C <worktree> commit -m "..."`) or applies the patch
(`git apply <patch>`). The integration branch only contains committed, combined, re-proven fixes, so a NOT COMMITTED cause is not on
it until someone commits it.

## Who does what
- **The main session** (you): runs the audit if there is none, confirms the build command, shows the owner the
  `--dry` plan (how many fix workers, cost) and gets a yes, runs `refactor.mjs`, reads the summary, and tells the owner
  in plain words. It never reads the code.
- **`scripts/refactor.mjs`** (the coordinator logic, no model): makes the worktrees, launches the fix workers,
  **re-does the proof itself**, merges, writes the report. A worker's "done" is never the evidence.
- **Fix workers** (headless `claude -p`, Sonnet, high effort, one per root cause, prompt = `fix-worker-prompt.md`): edit
  the source of one cause, nothing else.

## Steps
1. **Audit exists and is fresh.** `ls <repo>/.checks/causes.json`. If the code changed since the audit, run `audit-repo`
   again first; stale causes waste workers. `node <repo>/.checks/run-all.mjs` shows what is open.
2. **Pre-flight (read-only).** `node "<skill>/scripts/guard-readonly.mjs" <repo> --before` is not needed here (refactor
   edits only inside its own worktrees), but note the repo's `git status`: uncommitted work in the main checkout is NOT in
   the worktrees (they start from the last commit); tell the owner if there is any.
3. **Show the plan and get a yes.**
   `node "<skill>/scripts/refactor.mjs" <repo> --build "<cmd>" [--setup "<cmd>"] --dry`
   prints the branch name, the worktree folder, how many root causes get a fix worker (those with a working check script and
   not marked as needing people), the cap on simultaneous workers (default 3), the per-worker time limit (default 30 min)
   and the worker's tools. Cost: one Sonnet worker per cause; `--max-workers` (default 12) is enforced **after the baseline**: only
   causes whose checks still fail on the last commit take a slot (a cause already fixed is `SKIPPED-ALREADY-PASSING`, never a
   wasted worker); without `--causes` the most severe of those go first and the rest are deferred and named (report: "Deferred by
   the cost stop"); with `--causes` over the cap the script exits 2 unless `--yes` (after the owner agrees). The dry run can only
   say "up to N" because the baseline has not run yet. External API calls: none. Every worker's prompt names the `--decisions`
   files and is kept at `.pewp/refactor/<run>/prompts/<cause>.md`.
4. **Run it.** From PowerShell, in the background (it takes minutes to an hour):
   `node "<skill>/scripts/refactor.mjs" <repo> --build "<cmd>" [--setup "<cmd>"] [--causes C01,C03] [--parallel 3]`
   Per cause it prints one line: `FIXED`, `NOT FIXED`, `REGRESSED` or `SKIPPED-...`. Exit 0 = report written.
   Exit 1 = **UNSAFE**: the main checkout changed while workers ran, or the combined branch regressed a check. Exit 2 =
   could not start (the output says what to fix; a baseline that does not build is BLOCKED, say so).
5. **Read the summary** `<repo>/.pewp/refactor/<date>.md` (and `.json`, the data). Tell the owner, in this order: the one-line
   answer; what was fixed (each in a plain sentence, the page count it affects); what did not work and why; what needs people
   (and from whom); the review/approve/reject commands the report prints. Ask the owner to approve the merge as a pickable
   question (merge / look at it first / reject).
6. **Only after a yes**: the commands are in the report. The merge is done by the main session on the owner's word, then
   `build` again and `node <repo>/.checks/run-all.mjs` to show the result, then re-run `audit-repo` so `.checks/` matches the new code.
7. **Proof file** `runs/<date>-refactor.md`: the exact command, exit code, the first 40 lines of output, the report path.

## What the script does (so you can explain and trust it)
1. **Worktrees.** A new branch `pewp/refactor-<date>` in a worktree next to the repo (never inside it; main is never
   checked out there). Each root cause gets its own worktree and branch `pewp/refactor-<date>-C01`, so workers cannot
   disturb each other's builds. `.checks/` is copied into each (it is usually not tracked).
2. **Baseline.** Setup + build + `run-all.mjs --json` in the untouched branch = the "before". If the untouched code does not
   build, the run stops BLOCKED: nothing could be proven.
3. **Cause selection.** For each root cause in `causes.json`:
   - all its checks already pass: `SKIPPED-ALREADY-PASSING`;
   - needs people (explicit `--people`/`.pewp/needs-people.json`, or the fix text asks for client content, an owner decision,
     a real licence number, legal review, or is a `platform:` defect that the repo cannot change): `SKIPPED-NEEDS-PEOPLE`, and
     it is listed for the owner, never "fixed";
   - no working check script: `SKIPPED-NO-CHECK` (a fix could not be proven; add a check first);
   - otherwise it gets a fix worker.
4. **Fix workers.** Headless `claude -p --model sonnet --effort high`, working directory = the cause's worktree, tools: Read,
   Grep, Glob, Write, Edit, `Bash(node:*)`, the build command, `git status/diff/ls-files`; denied: git push/commit/checkout/reset/
   merge/rebase/stash, npx, npm install/publish, curl, wrangler, netlify, WebFetch, WebSearch. The environment has every
   token-like variable removed (cloud, GitHub, npm, Supabase...) and git is told every remote's push URL is dead. For a
   **generated site the worker fixes the generator** (the prompt says how to find it), not the pages.
5. **The proof, done by the coordinator after each worker**, in this order:
   1. timed out: `NOT FIXED`;
   2. the main checkout's fingerprint (changed files' contents, branch tips) differs from before the worker: `NOT FIXED`, **REFUSED**.
      With several workers running at once this may be a neighbour (or you editing main): the reason says so; re-run with `--parallel 1`;
   3. any file under `.checks/scripts`, `run-all.mjs` or `causes.json` changed: **REFUSED** (editing a check is not a fix);
   4. the worker wrote `NEEDS-PEOPLE.txt` (client content, an owner decision, or a fix that would touch an area a `--decisions`
      file holds): `SKIPPED-NEEDS-PEOPLE` with its sentence;
   5. **rebuild** (`--build`), then `run-all --json` = the "after". A change to built output alone disappears here;
   6. the diff, `scripts/run-all-diff.mjs`: any check that **passed before and does not pass now** (fails, errors, or whose
      script vanished) = `REGRESSED`, and so is a check that could not judge before (exit 2, or missing) and FAILS now (`newlyFailing`:
      the fix created what it judges, wrongly, e.g. the built-in sitemap lastmod check), even if the cause's own checks pass; else every check of the cause must go from not-pass
      to PASS = `FIXED`; else `NOT FIXED`;
   7. a `FIXED` cause must also have something committable outside `.checks/` and `.pewp/` (a fix that lives only in ignored or
      built files would not survive a fresh checkout): otherwise `NOT FIXED`.
   Every worker's diff is saved as `.pewp/refactor/<run>/<cause>.patch` before any commit is tried.
6. **Integration.** The `FIXED` branches are merged one at a time into `pewp/refactor-<date>`. Committed build output
   (`dist/`) conflicts between fixes, so on a conflict the earlier version is kept, the site is rebuilt, and **the combination
   is proven again** (the new cause's checks pass, nothing regressed vs the baseline, no earlier fix undone). A fix that fails
   that is rolled back and reported `NOT FIXED` with the reason ("conflicts with an earlier fix in ...": re-run it alone on top).
   **Rebuild stability** (IDX-003 / SE-004 / AEO-012, `lib-freshness.mjs`): the untouched code is built a second time at the baseline,
   and every merge that passes is built once more; a date in the output (sitemap lastmod, JSON-LD dateModified/datePublished,
   article:modified_time, `_headers` Last-Modified) that moves between two builds of one commit is the build clock. A merge that brings
   in such a date (or a date-only / timezone-less / future lastmod) is rolled back as `NOT FIXED` "REJECTED (rebuild stability): it stamps
   the build time into <field> on <n> pages (IDX-003/AEO-012)". A baseline that already fails is reported as a PRE-EXISTING finding, not
   a regression. `--no-stability` skips it and the report says NOT CHECKED. The summary line ends `stability: PASS|FAIL|NOT CHECKED`.
   The same test alone: `node scripts/check-stability.mjs <site dir> --build "<cmd>"` (exit 0 PASS, 1 FAIL, 2 build failed).
7. **Report.** `.pewp/refactor/<date>.md` (plain words, terms explained once) and `.json`; the state file records the stage.

## Verdicts (the only words the report uses)
| Verdict | Meaning | Owner action |
|---|---|---|
| FIXED | the cause's checks went FAIL -> PASS after a rebuild, nothing that passed stopped passing, and it survived the merge | review the branch, approve |
| NOT FIXED | the checks still fail after the rebuild / timeout / refused / build broke / conflict on the combined branch | read the reason; the patch is saved; try again alone or fix by hand |
| NOT COMMITTED | proven (checks FAIL -> PASS, nothing regressed) but `git commit` was refused, e.g. by a pre-commit hook | fix the hook; commit from the kept worktree or apply the saved patch |
| REGRESSED | the cause's own checks may pass, but another check broke | none; the fix was thrown away |
| SKIPPED-NEEDS-PEOPLE | needs client content or an owner decision | collect it (the report says what and from whom) |
| SKIPPED-NO-CHECK / SKIPPED-ALREADY-PASSING | nothing to prove / nothing to fix | none |

## Rules that do not bend
- Never `git merge` into main, `git push`, deploy, or open a pull request from this stage. The report prints the commands; the
  owner's yes comes first.
- Never run refactor on `E:\Francine & Eli\proposals\...` as a side effect of testing the skill unless the owner asked; the
  tests use fixtures only (`scripts/test-refactor.mjs`).
- Never lower a check to make a fix pass, never delete one, never mark a cause fixed on the worker's word. If a check is
  wrong, that is a finding for the audit, reported to the main session; it is not edited here.
- A defect that needs content only the client has is not fixed with placeholder text; it is listed.
- Honest limits go in the report: a passing check means the thing it looks at is right, not that the page looks right. Ask the
  owner to open the changed pages (or run the project's render gate) before the merge.

## Failure handling
| Symptom | Do |
|---|---|
| exit 2 "no .checks/causes.json" | run `audit-repo` first |
| exit 2 BLOCKED baseline does not build | fix the build on the last commit (or pass `--setup`); report BLOCKED with the output tail |
| a worker timed out | `NOT FIXED`; re-run only that cause once with `--causes C03 --timeout-min 60`; a second failure is reported, not retried |
| `UNSAFE` | do not use the branch. Read which paths changed in main (`mainTouched` in the json), decide with the owner. Re-run with `--parallel 1` to find the culprit |
| many causes `NOT FIXED` for "checks still fail after rebuild" | the workers edited the output; check the prompt names the generator; run a single cause with `--parallel 1` and read `.pewp/refactor/<date>/logs/<cause>.json` |
| the combined branch regresses | each fix was proven alone but they interact: merge them in smaller groups with `--causes` |

## Cost
One Sonnet worker (high effort) per root cause with a check, at most 3 at once, 30 min each by default; the rest is
`git`, builds and check scripts (no tokens). Typical: a site with 8 fixable causes = 8 workers, 20 to 60 minutes. State the
number before running; ask above 12.

## Proof of the tooling (not of any site)
`node scripts/test-refactor.mjs` builds a fixture repo (a tiny generator, a bare remote, a real `.checks/` made by the real
`merge.mjs`) and runs stand-in workers (no model): a correct fix, a fix that breaks another check, an edit of built output
without the generator, an edit of main, an edit of a check script, a worker-declared needs-people, a hang, a push attempt; then
breaks the code each assertion guards and expects red. The real `claude -p` invocation is not exercised by it (`--dry` prints the
exact command): the first real run is the proof of that part.
