# Builder brief: the GitHub run is the gate, and `omnikom land` (CLI department, released 2026-10-31 23:50, DECISIONS 45)

Builder: one session, this slice only. Head: the CLI and testing department head. Source: DECISIONS 45 in `planning/DECISIONS.md`
(read items 43 and 45 whole; 45 amends 43 parts 4 and 5). Why: the database walls gate takes about 55 minutes on this laptop and
about 3 minutes on a GitHub runner, and a local pass is a different runtime from CI anyway.

This changes the slice of `briefs/impact-stamp-hooks.md`, which is built and STAGED (not committed). Read that brief and the staged
code first: `commands/impact.mjs`, `commands/gates.mjs`, `commands/hooks.mjs`, `commands/ci.mjs`, `lib/stamp.mjs`, `lib/git.mjs`,
`lib/graph.mjs`, `test/impact-stamp-hooks.mjs`, `test/run.mjs`, `test/mutate.mjs`, `omnikom.mjs`, `lib/args.mjs`, `lib/ctx.mjs`,
`README.md`. Part 1 (impact) stays. Parts 2 and 3 change as below. Also read `~/.claude/reference/windows-scripting.md`.

## Files you may edit
`tools/omnikom-cli/**` only. Never `.github/`, `.gitignore`, `docs/`, `planning/`, `supabase/`, `factory/`, `tools/audit/`.
**You never commit, never push, never `git add`, never `git stash`, `reset`, `checkout`, or switch branches.** The previous slice
is staged in the index; leave the index alone, your edits stay in the working tree. Never run `gh` against the real repository in a
test and never push anywhere except throwaway bare repositories under the OS temp folder.

## The new shape (what the owner decided)
1. A head commits, then pushes that commit to `check/<department>/<slug>` on the `backup-gh` remote. ci.yml runs on every push.
2. Master only fast-forwards to a commit whose ci run on GitHub had every ci.yml job green. The commit sha names the exact tree.
3. The stamp is that green GitHub run, read with `gh`. There are no local stamp files any more.
4. The pre-push hook refuses a push to master unless that commit has a green ci run, and allows `check/**` branches.
5. `omnikom impact` stays and also prints the laptop tests it names.
6. `omnikom land <branch>` waits for the branch's ci run, refuses on any red job, then fast-forwards master and pushes.

## Part A: `lib/ghrun.mjs`, the verdict of one commit
`ciVerdict(ctx, { repo, sha, jobNames })` returns `{ state: 'green' | 'red' | 'pending' | 'none', runs, lines }`.
- `repo` is `owner/name` (parse it from a github.com remote url: https or ssh form, with or without `.git`; anything else is
  Blocked, exit 3, naming the url). `jobNames` is the `name:` of every job in ci.yml AT THAT COMMIT (`git show <sha>:.github/workflows/ci.yml`
  through `parseJobs` of `lib/graph.mjs`); a commit with no ci.yml is Blocked.
- Runs: `gh run list --repo <repo> --commit <sha> --workflow ci.yml --json databaseId,status,conclusion,headSha,event,url,createdAt --limit 50`.
  Keep only runs whose `headSha` equals `sha` exactly (never trust the filter alone). Ignore `cancelled` runs (ci.yml has
  `cancel-in-progress`). For each completed run read its jobs: `gh run view <id> --repo <repo> --json jobs`.
- `none`: no run left. `pending`: any kept run is not `completed`. `red`: any completed run has a job whose conclusion is not
  `success` (skipped, failure, cancelled, timed_out, neutral, action_required all count as not green), or misses a job of
  `jobNames`. A failure on the same sha is a signal even when another run of it passed; a flake is fixed by re-running that job on
  GitHub (which updates the run). `green`: at least one completed run, none red, every job of `jobNames` present with `success`.
- `lines`: one line per job that is not green (`<run url>  <job name>  <conclusion>`), or the green line
  `ci green: <sha> run <id>, <n> of <n> jobs success`.
- `gh` is called through one injectable runner (`ctx.gh(args)` returning `{ ok, out, err }`, default spawning `gh`), so tests use a
  fake that answers from planted JSON. A failed `gh` call (not installed, not logged in, network) is Blocked with the cause:
  the hook and `land` fail closed, never open.

## Part B: the pre-push hook (`commands/hooks.mjs`)
`install | uninstall | status` stay as built (shim text: change `(DECISIONS 43)` to `(DECISIONS 45)`). `hooks pre-push` now:
- the repo comes from the remote url git passes as the second argument (fall back to `git remote get-url <name>`);
- `refs/heads/check/**`: allowed (create, update or delete), one line `pre-push: <ref> is a check branch, allowed`;
- `refs/heads/master`: a delete is refused. Otherwise the remote sha, when it is known locally and not all zeros, must be an
  ancestor of the local sha (`git merge-base --is-ancestor`), else refused as not a fast-forward. Then `ciVerdict` on the local
  sha: `green` allowed with its green line; anything else refused with the verdict lines and
  `pre-push: REFUSED refs/heads/master: <sha> has no green ci run; push it to check/<department>/<slug> and run: node tools/omnikom-cli/omnikom.mjs land check/<department>/<slug>`;
- any other ref (another branch, a tag): refused, naming the rule (master is reached only through `land`, work goes to `check/**`);
- the prose exception of DECISIONS 43 is gone: 45 says master takes only a commit with a green run, and the impact graph has known
  gaps (runtime-built paths, import maps), so it cannot be the judge. Remove `checkRef`'s impact branch.
- the refusal still ends with `pre-push: --no-verify is the owner's alone; no session uses it.`

## Part C: `omnikom land <branch> [--remote <name>] [--wait-minutes <n>] [--json]`
- `<branch>` must match `check/<department>/<slug>`: `<department>` is the basename of a charter in `docs/departments/*.md`
  other than README and TEMPLATE (read the list at run time), `<slug>` is `[a-z0-9][a-z0-9._-]*`. Otherwise Usage, exit 2.
- `--remote` defaults to `backup-gh` (DECISIONS 24). The sha is what the REMOTE holds: `git ls-remote <remote> refs/heads/<branch>`;
  no such branch is Usage. Fetch it when the object is not local (`git fetch <remote> <branch>`; a fetch writes only remote refs).
- Wait: call `ciVerdict` every 30 s (`ctx.sleep`, injectable) until it is not `pending`; `none` for more than 5 minutes is Blocked
  ("no ci run for <sha>; was it pushed?"); still `pending` after `--wait-minutes` (default 60) is Blocked naming the run url.
  Print one progress line per change of state, not one per poll.
- `red`: refused, exit 1, code `LAND-REFUSED`, with the verdict lines. Nothing is pushed.
- `green`: `git fetch <remote> master`. Sha already in master (equal or ancestor): ok, `land: <sha> is already in master`, nothing
  pushed. Remote master not an ancestor of sha: refused, `not a fast-forward: rebase <branch> onto master and push it again` (land
  never rebases, merges or forces). Otherwise `git push <remote> <sha>:refs/heads/master` with no `--force` and no `--no-verify`
  (the installed hook checks again; that is intended). Print the push result and `land: master is <sha>`.
- `land` never touches the working tree, the index or `refs/heads/master` of this checkout (heads share one checkout; master may be
  checked out with other heads' unfinished files). Say in the output whether the local master contains the sha.

## Part D: `omnikom gates` goes, `omnikom ci` stays for reproducing a failure
- Delete `commands/gates.mjs`, its registration, its README row, its tests and mutants, and every local stamp function
  (`stampPath`, `readStamp`, `writeStamp`, `deleteStamp`, `GATES_PASS_LINE`). Rename `lib/stamp.mjs` to `lib/checkout.mjs` keeping
  `checkRoot`, `treeOf`, `commonDirOf`, `removeCheckout`, `withTreeCheckout` (root `D:/omk-gates`, never E:, never "claude").
- `omnikom ci --staged | --commit <sha>` keeps the throwaway checkout of that exact tree and now accepts `--job <id>` with it (to
  reproduce one red GitHub job on the tree GitHub ran). It writes no stamp and prints no stamp line.

## Part E: impact prints the laptop tests
After the existing lines, for every ci.yml job that `impact` names: `laptop: node tools/omnikom-cli/omnikom.mjs ci --job <id> --staged`
(for `--commit <sha>` input use `--commit <sha>`), then that job's own `run:` commands as `  <command>` lines (the same steps
`commands/ci.mjs` runs; reuse its reader, do not write a second one). The JSON carries the same as `laptop: [{ job, command, steps }]`.
The secret scan job stays out, as before. This is fast feedback; the gate is the GitHub run.

## Tests (units, throwaway git repositories and bare remotes under the OS temp folder, removed after; a fake `gh` only)
- ghrun: green; one job skipped = red; one job missing from the run = red; a cancelled run ignored; one green run plus one red run
  on the same sha = red; a run whose headSha differs is ignored (so `none`); in progress = pending; a failed gh call = Blocked;
  remote url parsing (https, ssh, `.git`, a non-GitHub url refused).
- pre-push: a real `git push` from a throwaway repo with the installed shim to a bare remote: master refused with no run, refused
  when red, allowed when green; `check/cli-and-testing/x` allowed; a master delete refused; a non-fast-forward to master refused;
  another branch refused. (The bare remote is not GitHub: give the tests a way to name the repo, through `ctx`/deps or a config
  read only by tests, never an environment variable a session could set to point the hook at another repository's runs.)
- land: bad branch names (unknown department, bad slug) Usage; red refused and nothing pushed (the bare remote's master is
  unchanged); pending then green pushes (fake sleep, no real waiting); `none` past 5 minutes Blocked; already in master pushes
  nothing; not a fast-forward refused; land never passes `--no-verify` or `--force` (assert on the spawned git args); the
  working tree and local master of the checkout are untouched.
- ci: `--commit <sha> --job <id>` runs that job in the checkout; no stamp file is written anywhere.
- impact: the eeb8431 proof case now also prints `laptop: ... ci --job functions --commit eeb8431` and the functions job's steps.
Watch every new check fail (break what it measures, see the FAIL line name it, restore) and list them in the report.

## Mutants (`test/mutate.mjs`, each target text occurs exactly once; at least these; remove the `gates:` mutants)
- ghrun: a skipped job counted as green; the job-name list check off; a red run beside a green one ignored; the headSha equality
  off; a failed gh call read as green.
- hooks: master allowed without a green run; the fast-forward check off; another branch allowed; a master delete allowed.
- land: a red verdict pushed; the fast-forward check off; `none` waited forever (no 5 minute bound); the department check off.
- impact: the laptop lines dropped.

## What you may run (LOAD HOLD from the head of operations: no full suite, no mutant runs, no `omnikom ci` runs on this repository)
`node tools/omnikom-cli/test/run.mjs --unit` (in the working tree is fine for iteration), single unit-level watched fails, and
`node tools/omnikom-cli/omnikom.mjs impact --commit eeb8431`. Not run by you: the full `test/run.mjs`, `test/mutate.mjs`, `hooks
install` in this repository, `land` against GitHub. The head runs those after the all-clear.

## Report (short; PROVEN with pasted lines, UNPROVEN, NOT DONE, BLOCKED)
Files changed and removed; `run.mjs --unit` last line; the eeb8431 impact output in full; the watched-fail list; the new mutant
names; a check that every mutant target occurs exactly once in its file. No em dashes in any file.
