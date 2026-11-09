# 20 land retry

Owner: cli-and-testing. Model: sonnet, effort high. Branch: check/cli/land-retry. Status: OPEN (built; CI decides the 21 [land-retry] mutants).

## Why
`omnikom land` is how every department moves master (DECISIONS 45). One network blip ends a land that may have waited an hour:
2026-11-04 a land was BLOCKED on "dial tcp ... api.github.com" during the ci wait, and a land that dies after taking the lock
leaves a lock naming its own branch, which its own rerun then waits behind for up to 90 minutes. The lock release already retries
a network failure (`RELEASE_WAITS_MS`, fe23f56); nothing else does.

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/cli-and-testing.md` (Rules, Proof; not the position log)
- `docs/blueprint/26-PLATFORM-CLI.md` section 5 (the five rules)
- `tools/omnikom-cli/commands/land.mjs` (whole), `tools/omnikom-cli/lib/ghrun.mjs`, `tools/omnikom-cli/lib/landlock.mjs`
- `tools/omnikom-cli/test/impact-stamp-hooks.mjs` (the land tests and their fake git and gh), `tools/omnikom-cli/test/mutate.mjs`
  (the `land:` rows)

## Steps
1. Network words. `NETWORK_FAILED` in land.mjs also matches gh's and Go's words: `dial tcp`, `i/o timeout`, `no such host`,
   `connection refused` (already), `EOF` at the end of a line, `502`, `503`, `504`, `bad gateway`, `service unavailable`. Keep
   `looksLikeNetworkFailure` the one test for "the network failed"; a lease refusal and an auth failure ("authentication",
   "401", "403", "not logged in") are never network failures. Unit checks for each new word and for each never-retried case.
2. Reads retried. One helper, `withNetworkRetry(ctx, fn, waits = READ_WAITS_MS)`, `READ_WAITS_MS = [10000, 30000, 60000]`,
   sleeping through `ctx.sleep`: it calls `fn` again only when the failure text `looksLikeNetworkFailure`, and prints one line
   per retry: `land: network error (<first line>); trying again in <n> s`. Use it for the git reads before the lock
   (`ls-remote`, the branch fetch), `readLock`, the lock push in `takeLock` (only when the push failed and `readLock` also failed
   on the network), and `readMaster`. A failure that is not the network is Blocked at once, as today.
3. The ci wait survives a blip. In `landLocked`'s wait loop, a Blocked from `ciVerdict` whose text `looksLikeNetworkFailure` is
   not the end: print `land: ci unknown: <first line>` once per run of failures, keep polling every `POLL_MS`, and only after
   `CI_UNKNOWN_LIMIT_MS = 5 * 60000` of consecutive network failures throw the Blocked (naming the last error and how long it
   lasted). A non-network Blocked (gh missing, not logged in, no ci.yml) still ends the land at once. The time spent unknown
   counts toward `--wait-minutes`. Fail closed stays: unknown is never green.
4. A rerun takes over its own lock. In `takeLock`, when the held lock's message names the same branch AND the same full sha as
   this land, it is ours from an earlier run of this same land: print
   `land: the land lock is held for this same branch and commit (<holder> since <since>); taking it over` and return
   `{ sha: held.sha }`, so the rest of the land (and its release with the lease) runs on that lock. Same branch with a different
   sha is somebody's older push: waited for as today. Stale-lock breaking is unchanged.
5. The usage line at the top of land.mjs and its comment block say what steps 2 to 4 do, in the file's own style; so does the
   README's "The landing queue" bullet.

## Outputs
- `tools/omnikom-cli/commands/land.mjs`, `tools/omnikom-cli/test/impact-stamp-hooks.mjs` (or a new test file the suite already
  runs), `tools/omnikom-cli/test/mutate.mjs` (one mutant per clause: the new words, the retry helper retrying, the helper NOT
  retrying a non-network failure, the ci-wait tolerance, its 5 minute bound, the own-lock takeover, the different-sha wait).
- `tools/omnikom-cli/README.md`, the "The landing queue" bullet: the retries, the ci-wait tolerance, the own-lock takeover
  (`26-PLATFORM-CLI.md` is archived).

## Proof
- `node tools/omnikom-cli/test/run.mjs --unit` -> "OK: N of N checks passed".
- Every new check watched red first: for each new mutant, apply it by hand, see its check fail for the right reason, restore.
  One planted fault per clause (a fault fails only the clause its mutant removes).
- The `[land-retry]` mutants run by name: `node tools/omnikom-cli/test/mutate.mjs --only land-retry` (or the file's own filter)
  -> "N mutants, N caught, 0 survived, 0 target text missing". The full mutant run is GitHub's (the cli job), never local.
- Builders never commit or push; the head reads `omnikom impact`, commits and pushes (README rule 8).

## Findings
Anything outside these files is a finding sent to the CLI head, never fixed here.
