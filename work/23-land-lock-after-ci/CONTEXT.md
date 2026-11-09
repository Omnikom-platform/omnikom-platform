# 23 land lock after ci

Owner: cli-and-testing. Model: sonnet, effort high. Branch: check/cli/land-lock-after-ci. Status: OPEN (built; unit 695 of 695 on the laptop; CI's cli job runs the [land-lock] mutants;
its own land runs the new order; head of operations' finding, 2026-11-09 09:48).

## Why
`omnikom land` takes the land lock (`refs/heads/land-lock`) and then waits for the GitHub CI verdict on the branch tip, so one land
blocks every department for its whole CI run. Measured 2026-11-09: SEO held it from 09:07 while its CI ran 40+ minutes; the CLI's
dep-scan land waited 30 minutes for the lock and gave up ("waited 30 minutes for the land lock; it is still held"), with its own CI
running at the same time.

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/cli-and-testing.md` (Rules, Proof; not the position log)
- `tools/omnikom-cli/commands/land.mjs` (whole: takeLock, readLock, the CI wait loop, readMaster, withNetworkRetry), `lib/ghrun.mjs`
  `ciVerdict`, `tools/omnikom-cli/README.md` "The landing queue", the land checks in `test/impact-stamp-hooks.mjs`, the
  `[land-retry]` rows of `test/mutate.mjs`

## Steps
1. New order inside land: read the tip; wait for the CI verdict on that exact sha WITHOUT the lock (the existing ci unknown and
   --wait-minutes rules unchanged); red or unknown ends with no lock taken.
2. Only after green: take the lock, read master again; if master is no longer the tip's base (not an ancestor of the tip, or the
   push would not fast-forward), release the lock at once and print "master moved to <sha>: rebase onto it and push again".
3. Otherwise push the fast-forward, release. The lock is held for seconds, never for a CI run.
4. A rerun's takeover of a lock naming its own branch and sha stays.
5. README "The landing queue" says the new order.

## Proof
- Unit checks (fake git and gh): the lock is not taken while CI is pending; a red CI takes no lock; master moved after green
  releases the lock and says rebase; the green path holds the lock only around the push; the takeover still works.
- Mutants `[land-lock]`, one per check, each watched red. `node tools/omnikom-cli/test/run.mjs --unit` -> "OK: N of N".
  CI's cli job runs the mutants; no full local mutant run. Builders never commit or push.
- Builder, 2026-11-09: built. `--unit` "OK: 695 of 695". 8 `[land-lock]` mutants each watched red on a land-only scratch runner
  (not through mutate.mjs; CI's cli job is their first official run). The early master read before the ci wait is kept (a land that
  cannot fast-forward fails at once). UNPROVEN: the older land mutants were checked by eye only (their target text exists once).
  Known gap: a hand push to master between the re-read under the lock and the push is refused by git as LAND-PUSH-FAILED (no
  re-read); a LAND-LOCKED after green does not cache the verdict (a rerun asks gh again). Head: the usage line in omnikom.mjs says
  the new order. `docs/product/9-blocks.md:58` "under a land lock" stays true (head of operations' file, not changed).
