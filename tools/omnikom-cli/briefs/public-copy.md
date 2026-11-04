# Builder brief: the public code-only copy that runs CI, and `land` reading its verdict (CLI department, DECISIONS 46)

Written 2026-11-01 13:05 by HEAD_CLI-and-testing_2026-11-01, released by the head of operations the same hour, ahead of slice 2.
Builder: one sonnet session, this slice only, discarded when done. Head: HEAD_CLI-and-testing_2026-11-01 (report to that name only).

## Why
The private org repo `Omnikom-platform/omnikom-platform` is on the GitHub Free plan; November's 2,000 Actions minutes were used up on
the 1st, so no CI job starts and nothing can land. Public repos run Actions free. The private repo holds client material, so the owner
(12:51, "Public repo under my account") gets a public copy that holds code only. Read `planning/DECISIONS.md` items 45 and 46 whole;
46 amends 45 part (c) only. Then `tools/omnikom-cli/README.md` (the "Impact, the GitHub gate and the pre-push hook" section),
`commands/land.mjs`, `commands/hooks.mjs`, `lib/ghrun.mjs`, `lib/landlock.mjs`, `lib/graph.mjs` (`parseJobs`), `lib/checkout.mjs`,
`commands/ci.mjs` (`parseWorkflow`), `test/run.mjs`, `test/mutate.mjs`, and `~/.claude/reference/windows-scripting.md`.

## Where you work
In the git worktree `D:\omk-gates\cli-public-copy` (detached at master c2811ee). Edit only there, never in `E:\Omnikom Platform` (that
shared checkout holds other sessions' unfinished files). The worktree has no `.tools/`: gitleaks is at
`E:\Omnikom Platform\.tools\bin\gitleaks.exe` (absolute path; never copy binaries).

## Files you may edit (nothing else; anything outside is a finding with file:line, never a fix)
`tools/omnikom-cli/**` only. New: `public-copy.json` (the denylist and the copy rules; one file), `lib/copy.mjs`, `commands/copy.mjs`.
Changed: `commands/land.mjs`, `commands/hooks.mjs`, `lib/ghrun.mjs` as needed, `omnikom.mjs`, `lib/args.mjs`, `README.md`,
`test/run.mjs`, `test/mutate.mjs`. Never `.github/` (the copy's workflow changes are made in the COPY, by the tool, never in the
private file), `.gitignore`, `docs/`, `planning/`, `supabase/`, `clients/`.
**You never commit to or push the private repo, never `git add` in `E:\Omnikom Platform`, never stash, reset, checkout or switch
branches there.** Pushes to the public repo happen only in Part D, only after my "go" message.

## Part A: the copy (`lib/copy.mjs`, deterministic)
`copyTree(commit)` builds, from a private commit, the tree of its copy, with git plumbing only (`git ls-tree -r`, `git mktree`,
`git hash-object -w` for a transformed blob; never the working tree), and returns `{ tree, dropped: [paths], transformed: [paths] }`.
1. **The denylist** is `tools/omnikom-cli/public-copy.json`: `{ "deny": [path prefixes], "why": { prefix: reason }, "workflowsKept":
   ["ci.yml"], "jobsNotOnCopy": { job: reason } }`. Start from: `clients/`, `docs/listings/`, `sops/clients/`, `planning/`,
   `docs/offer/`, `film/`, `.claude/`, `CLAUDE.md`, `RESUME-SESSION.txt`, `templates/client-questions/`, and every workflow file other
   than `ci.yml` (alerts, backup, keepalive, key-rotation, media, publish use secrets and some run on a schedule: on a public copy they
   would fire without secrets). Then survey the rest (Part C) and propose additions. The file itself goes into the copy, so it must
   never contain a client's name.
2. **ci.yml in the copy**: unchanged, except that each job named in `jobsNotOnCopy` is removed from the copy's `ci.yml` (a text
   transform you can test; the copy's `ci.yml` must still parse with `parseJobs` and `parseWorkflow`). Today no `ci.yml` job reads a
   secret (`grep secrets. .github/workflows/ci.yml` is empty), so `jobsNotOnCopy` starts empty unless a job needs a denylisted path
   (Part C finds out). The `pull_request` trigger stays (a fork's PR gets no secrets; there are none).
3. **The copy commit**: a root commit (no parent: the public repo never holds history) of that tree, message
   `copy of <private sha>\n\nPrivate-Commit: <sha>\nPrivate-Tree: <private tree>\nCopy-Rules: <sha256 of public-copy.json>`, author and
   committer from the private commit (dates included, so the same input gives the same commit).

## Part B: the gate (refuses before anything is pushed)
`checkCopy(commit, tree)` fails (code `COPY-REFUSED`, exit 1, every offending path printed, nothing pushed) when:
1. a path of the copy tree starts with a denylisted prefix (a second check, independent of how the tree was built: it reads the built
   tree back with `git ls-tree -r`);
2. a file of the copy tree names a client. The names come, at run time and from the PRIVATE commit only, from `clients/`: every folder
   slug under `clients/` except `TEMPLATE` and `test`, plus the business and person names written in each client folder's profile file
   (read the folder's files to find where the name lives; say which field you used). Match case-insensitively on word boundaries in
   every text blob of the copy (skip binaries by a NUL byte in the first 8 KB). The names never go into output, files or the copy:
   print `<path>:<line> names client <n>` where `<n>` is the client's index in the sorted slug list, never the name;
3. `gitleaks` over the copy's files finds anything (`gitleaks detect --no-git --source <temp dir of the copy's files>`; the temp dir is
   removed on every path);
4. the copy's `ci.yml` does not parse, or names a job in `jobsNotOnCopy` that the private `ci.yml` lacks.

## Part C: the survey you report BEFORE Part D (the copy is a publication: I review the list)
A table, one row per top-level folder and per second-level folder of `docs/`, `tools/`, `skills/`, `brand/`, `contracts/`, `sites/`,
`apps/`: file count; read by a `ci.yml` job (use `omnikom impact` or the graph; yes/no and which job); what kind of text it holds (code,
fixtures, synthetic test data, product docs, business or client text); client-name hits from Part B item 2 (count only); your proposal
(copy / deny, one line why). Business plans, pricing, offers, client notes and owner correspondence are denied even when no client is
named. A path a `ci.yml` job reads that you propose to deny: say which job breaks, and propose either keeping the path (if it is code or
synthetic) or adding the job to `jobsNotOnCopy` (a check that no longer runs anywhere: name it plainly). Then the dry run: `omnikom
copy build <private sha> --dry-run` on master c2811ee, its `dropped` count, the copy's file count, and the gate's result.
Send me the table and the dry run; wait for "go".

## Part D: the public repo and the push (only after "go")
1. Create the repo once: `gh repo create AbdulrahmanAmer/omnikom-checks --public --disable-wiki --disable-issues --description "Code-only
   CI copy of the Omnikom platform (DECISIONS 46)"` (owner-authorised 12:51). Check after: `gh repo view` says PUBLIC, has no secrets
   (`gh secret list --repo ...` empty) and Actions enabled. Name the repo in `public-copy.json` (`"repo"`).
2. `omnikom copy push check/<department>/<slug> [--remote backup-gh]`: reads the private branch's sha from the private remote (as `land`
   does), builds the copy (Part A), gates it (Part B), and pushes the copy commit to the SAME branch name on the public repo through a
   temporary bare repository or a `git push` with the public URL that does not go through this clone's installed pre-push hook (say which
   and why). A re-push of the branch replaces the public branch (a root commit is never a fast-forward: force is allowed on the PUBLIC
   copy's `check/**` only, never `master`, never the private repo). It prints the copy sha, the public run url once GitHub lists it, and
   `copy: <private sha> -> <copy sha> (<n> files, <m> dropped)`. Idempotent: same private sha, same copy commit, nothing pushed twice.
3. The public repo's `master` is the copy of the private master, pushed by `land` after a green land (so a later `pull_request` or a
   human browsing sees a current tree). Never anything else. (Recorded 2026-11-01, head's answer: each copy is a root commit, so the public
   master is replaced with `--force-with-lease` on the tip just read; that is the only forced ref, never on the private repo.)

## Added by DECISIONS 47 (14:15, the head)
`denyNamed` lists every client-named file; `jobsNotOnCopy` is `{ job: { reason, files } }`; `land` runs those jobs on the laptop through heavy.mjs for the
exact sha and refuses unless each passes; the rules file must pass the gate's own name scan.

## Part E: `land` and the pre-push hook take the copy's verdict (DECISIONS 46 (d))
- `land check/<dept>/<slug>`: after resolving the private sha, compute the expected copy (Part A) of that sha; find the public repo's
  branch of the same name; it must exist and its tip's tree must EQUAL the expected copy tree and its message must carry
  `Private-Commit: <that sha>` (else BLOCKED: "run omnikom copy push <branch>"). `ciVerdict` reads the PUBLIC repo's run for the copy
  sha, `jobNames` from the copy's `ci.yml`. Every other DECISIONS 45 rule stays: the land lock (on the private remote), the wait,
  red refused, fast-forward only, a plain push of the private sha to the private master. After a green land, push the copy of the new
  private master to the public `master` (Part D item 3). Output says `verdict from <public repo> run <id> of copy <sha>` and lists
  `jobsNotOnCopy` as `not run on the copy (DECISIONS 46): <job>: <reason>` lines.
- The pre-push hook, for a push to the private `refs/heads/master`: the same mapping (expected copy tree of the pushed sha, the public
  run of a copy commit with that tree and that Private-Commit). No green copy run: refused, as today, with the hint to run
  `omnikom copy push` then `land`. Fail closed when `gh` or the public repo does not answer.
- The mapping is never taken from a branch name or a message alone: the tree equality is the proof that the run tested this tree minus
  the denylist.

## Tests (units in throwaway repos and bare remotes under the OS temp folder, removed after; a fake `gh`; no real network)
- copy: a planted repo with `clients/acme/`, `planning/x.md`, a second workflow file and code; the copy drops exactly the denylisted
  paths, keeps `ci.yml` (minus a `jobsNotOnCopy` job when set), is a root commit, and is byte-identical for the same input twice.
- gate: a denylisted path planted in a hand-built tree is refused; a code file naming a client slug (and one naming the profile's
  business name, mixed case) is refused with `names client <n>` and the name absent from all output; a word that merely contains a slug
  (`delivery` for a slug `eli`) passes; a fake secret is refused by gitleaks (use a fixture gitleaks flags; the binary path through
  `ctx`); a clean copy passes.
- verdict mapping: green copy run of the right tree: land pushes; copy branch missing: BLOCKED; copy tree differs from the expected
  (one file changed): BLOCKED, nothing pushed; message names another private sha: BLOCKED; red copy run: LAND-REFUSED; the hook: master
  allowed with a green copy run of the exact tree, refused without one, refused when the copy tree differs.
- the real `ci.yml` and the real `public-copy.json`: the copy's `ci.yml` parses with both readers and keeps every job not in
  `jobsNotOnCopy` (a unit check reads the real files).
Watch every new check fail (break what it measures, see the FAIL line name it, restore) and list them.

## Mutants (`test/mutate.mjs`; each target text occurs exactly once)
At least: the denylist ignored when building; the gate's own denylist re-check off; the client-name scan off; word boundaries dropped
(caught by the `delivery` case, the other way: assert the scan still refuses the real slug); a client name printed in the refusal; the
gitleaks step skipped; the copy commit given a parent; land taking the verdict without the tree equality; land reading the private
repo's run instead of the public one; the hook's tree equality off.

## What you run
- `node tools/omnikom-cli/test/run.mjs --unit` freely (in the worktree).
- The db part only as `node ~/.claude/scripts/heavy.mjs --label "cli public-copy db" -- node tools/omnikom-cli/test/run.mjs --db`, once,
  at the end. Single mutants through heavy.mjs with `--only <name>`. NOT the full `mutate.mjs`, NOT `run-all-gates.mjs`.
- Real network only in Part D, after "go": `gh repo create`, `gh repo view`, `gh secret list`, `omnikom copy push` of the branch I name,
  and `gh run list` / `gh run view` on the public repo.
- Keys by variable name only; no em dashes in any file; scripts in files, never inline `node -e`; long commands in the background; two
  failed approaches to one obstacle = BLOCKED with what would unblock it.

## Report (short)
After Part C: the table and the dry run, then wait. At the end: files changed; `run.mjs --unit` and heavy db last lines; each new mutant
and that it was caught; the watched-fail list; the public repo URL and `gh repo view` visibility line; the first `copy push` output and the
public run's verdict lines; UNPROVEN / NOT DONE / BLOCKED by name; findings with file:line.
