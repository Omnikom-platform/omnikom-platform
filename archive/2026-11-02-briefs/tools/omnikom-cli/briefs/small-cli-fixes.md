# Brief: small CLI fixes (land, billing line, audit --target, land waits for the lock)

Department `cli-and-testing`, head HEAD_CLI-and-testing_2026-11-01c. Written 2026-11-01 18:15 against master daa01d1. Queue item 1 of
the charter's HANDOVER 17:55 block. Builder: one Sonnet session, in its own worktree (the head creates it at master), never in
`E:\Omnikom Platform` (that checkout is shared and holds other heads' unfinished files).

Read first: this brief; `tools/omnikom-cli/commands/land.mjs` (whole); `tools/omnikom-cli/lib/ghrun.mjs` (whole);
`tools/omnikom-cli/commands/audit.mjs` (whole); `tools/omnikom-cli/lib/target.mjs` (`guardProduction`); `tools/omnikom-cli/omnikom.mjs`
(the entry: usage lines, `guardProduction` call, `ctxUsesTarget`); the land block of `tools/omnikom-cli/test/impact-stamp-hooks.mjs`
(from "land (DECISIONS 45)", about line 474, its helpers and fake gh in `test/fake-gh.mjs`); the audit lines of `test/run.mjs`
(about line 349, the ENV-001 / PMP-001 literals); `tools/audit/index.mjs` lines 14 to 104 (the engine's `target` option). Nothing else
unless a test failure points there.

## The four parts

### (a) land fast-forwards this checkout's local master when it safely can
Today, after a green land, `localNote()` (land.mjs ~202) prints "the local master of this checkout does not contain <sha>; land does
not touch it". Change: after the remote master moved (and in the "already in master" case), land tries to bring the LOCAL
`refs/heads/master` to `<sha>`, only when ALL hold:
1. local master exists and is an ancestor of `<sha>` (no local commits would be lost);
2. no path that differs between local master and `<sha>` (`git diff --name-only <localMaster> <sha>`) is staged or dirty or untracked
   in this checkout (`git status --porcelain -z`, with rename lines read correctly);
3. when master is the checked-out branch: `git merge --ff-only <sha>` (git itself refuses if it would overwrite anything; that refusal
   is reported, never forced); when master is not checked out: `git update-ref refs/heads/master <sha> <localMaster>` (the old value as
   a lease).
Output: `land: the local master of this checkout moved <old>..<sha>`; or `land: the local master of this checkout was not moved:
<reason>` naming at most 10 blocking paths and "+N more". A failed or skipped local move NEVER turns a landed result into a failure
(exit stays 0, code `ok`) and never touches any path outside the diff. The header comment (lines 17 and 18) is rewritten to say what
land now does to the local checkout.

### (b) the billing line when GitHub never started the jobs
When a ci run is red and EVERY failed job has zero steps (GitHub did not start it: the Actions minutes or spending limit, as on
2026-11-01 ~10:00 "The job was not started because recent account payments have failed or your spending limit needs to be
increased"), `ciVerdict` adds one line after the red lines: `ci: no job ran a step; GitHub says: <first annotation message of one
failed job>` (`gh run view --json jobs` with `databaseId,steps`; the annotation from `gh api repos/<repo>/check-runs/<job id>/annotations`,
first message, one line, 200 chars). One extra gh call at most. If that call fails or has no message, the line is `ci: no job ran a step
(GitHub did not start them; check the Actions minutes and billing)`. The verdict stays red; the line is information only. The
pre-push hook and land both show it (they share `ciVerdict`).

### (c) `audit --target <preview|production>` and `gate --target <preview|production>`
The SEO engine takes `{ target: 'preview' | 'production' }` (tools/audit/index.mjs:83-86): the build's target, judged by ENV-001.
In this CLI `--target` already names the database environment (local|staging|production) and the entry's `guardProduction` refuses
`production` for everything but status and apply. Decision (head, 18:15): for `audit` and `gate` only, `--target` is the BUILD target,
because both commands talk to no environment, and the same word is what `tools/audit/run.mjs` and `factory/test/run.mjs` use.
- `audit` and `gate` accept `--target preview` and `--target production` and pass it as `{ target }` to `lib.audit`; no `--target` passes
  nothing (unchanged behaviour). `--target local` or `--target staging` (or any other value) is Usage (exit 2) with the message
  `audit takes --target preview|production (the build's target); it talks to no environment`.
- `guardProduction` does not refuse `audit` or `gate` (they read a folder only); every other command keeps the guard exactly as today.
  The exemption is a named set of exactly those two commands, not a loosening of `PRODUCTION_ALLOWED`.
- The result object still shows no environment `target` for audit and gate (`ctxUsesTarget` unchanged); the engine's `data.target`
  carries the build target.
- Usage line and README row for audit and gate gain `[--target preview|production]`.
- Tests: the existing literals at `test/run.mjs:349` stay valid for a run WITHOUT `--target` (ENV-001 SKIP and PMP-001 SKIP both stay;
  PMP-001 belongs to `--prompt-coverage`, a later slice). Add runs WITH `--target production` and `--target preview` on the engine's
  fixtures (the SEO README and charter name them: `good` with `--target production` 0 FAIL; `good-preview` with `--target preview` 0 FAIL;
  `bad-ENV-001-preview` FAIL ENV-001) asserting no `SKIP ENV-001` line and the engine's verdict. Take fixture paths and counts from
  the engine at run time, as the existing audit tests do; never hard-code a rule count.

### (d) land waits in line for a held lock, and refuses early when it cannot fast-forward
Today a held lock is `LAND-LOCKED` (exit 1) at once; each refusal cost a rebase and a fresh ci run (seen twice on 2026-11-01 ~17:00).
- New flag `--lock-wait-minutes <n>` (default 30, 0 means "refuse at once" as today, max 180). While another holder has the lock, land
  re-reads it every `POLL_MS` (through `ctx.sleep`, so tests do not wait), prints the holder line once and again only when the holder
  changes, and takes the lock as soon as it is free (the stale-lock rule stays: a lock over 90 minutes is broken as today). After the
  wait limit: `LAND-LOCKED` exactly as today, the line naming how long it waited.
- Right after the lock is taken, BEFORE the ci wait: fetch remote master; if `<sha>` is already in it, take the "already in master" path;
  if master is not an ancestor of `<sha>`, refuse at once (`LAND-REFUSED`, "not a fast-forward: rebase onto master <short> and push it
  again"), release the lock. This saves the up-to-60-minute ci wait when the holder just moved master. The existing post-ci check stays
  (master can still move during the wait).
- Usage line and README row for land gain `[--lock-wait-minutes 30]`.

## Gates (run in the worktree; unit runs are free, db parts and mutants go through heavy.mjs as the existing tooling does)
- `node tools/omnikom-cli/test/run.mjs` : "OK: N of N checks passed" (N grows; today 550 on master).
- `node tools/omnikom-cli/test/mutate.mjs` : every new mutant caught, "0 survived, 0 target text missing".
- `node docs/blueprint/specs/run-all-gates.mjs` on the worktree before you report.
- `gitleaks protect --staged` is the head's; you do not commit.

Each new behaviour has a test watched failing first (break the code, see it red for the right reason, restore) and at least one
mutant in `test/mutate.mjs`. Minimum mutants: (a) the local move skips the dirty-path check; (a) a failed local move turns the land
into a failure; (b) the no-step line is printed when one job did run a step; (c) the audit `--target` value is not passed to the
engine; (c) the production-guard exemption covers a third command; (d) the lock wait never polls (refuses at once with the default);
(d) the early fast-forward check is skipped (the ci wait runs first).

## Rules (spec section 5, verbatim)
1. Secrets by variable name only; the CLI never prints, logs or echoes a value, and `--json` output redacts anything that looks
   like a key (a test asserts it).
2. Production is read-only except `apply --i-mean-production`; identity, seed and verify commands refuse a production target
   (a test asserts it with a fake `PROD_DB_URL`).
3. Fixtures are synthetic; a command that would store client data needs an explicit `--real` flag and prints a warning.
4. Every command is idempotent where a retry is possible (`seed test` twice changes nothing; `lead send --retry` stores nothing).
5. No dependencies; Web Crypto for signatures (the same `sign` as the endpoint); `psql` for SQL paths; `fetch` for functions.
6. Tests: `tools/omnikom-cli/test/run.mjs` (units with a fake fetch and a throwaway local cluster) and `mutate.mjs`; the hygiene
   test (no secret in output) and the production guard are watched red first.

Also: no em dashes in any file; scripts in files, never inline `node -e`; no real `land`, no push, no commit, no staging write, no
call to the real GitHub from a test (the fake gh only). Files you may edit: `tools/omnikom-cli/` and `docs/blueprint/26-PLATFORM-CLI.md`
section 7 (one entry for this slice). Anything outside this brief is a finding you send back, not a fix.

## Done when
The four parts are in the worktree, the three gates pass as pasted output, every new check was watched red, and you have sent the head
(SendMessage to HEAD_CLI-and-testing_2026-11-01c) a report: files changed, the pasted verdict lines of each gate, the watched-red list,
the mutant names and their verdicts, and anything UNPROVEN or BLOCKED by that word. Then stop working and wait; the head stops you.
After landing, the head tells the SEO head that `omnikom audit --target` exists.
