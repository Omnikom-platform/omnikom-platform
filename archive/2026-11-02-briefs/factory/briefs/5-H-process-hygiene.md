# Slice 5-H: no browser or database outlives the run that started it

Owner: Platform build head. Builder: one in-session Sonnet agent. Written 2026-11-01 02:25 after the laptop had to be restarted at
02:07: 1021 orphaned headless Edge processes, 40 Postgres processes and orphaned node workers (head of operations' count). Every
run that starts a browser or a database cluster in our files must leave nothing behind, on every exit path: a normal end, an
error, Ctrl+C, a time limit, and a hard kill of the run itself.

## Load rule (binding while you work)
The laptop is under a heavy-job ban until the head of operations says the machine-wide lock is in. LIGHT WORK ONLY: edit, `node
--check`, unit tests that start only `node` child processes, and at most ONE real headless browser launch at a time for a watched
fail (a `--dump-dom` of a one-line page, a few seconds). No Playwright suite, no npm ci, no run-local, no mutants, no initdb. Heavy
proof runs on GitHub (the head pushes a check branch, DECISIONS 45). You never commit or push.

## Why it leaked (read the code to confirm, and say what you find)
1. `spawnSync(browser, ..., { timeout })` kills only the browser's main process when the time limit hits; on Windows its renderer,
   GPU and utility children stay alive with the temp profile open, and the profile folder cannot be deleted. Suspects:
   `docs/blueprint/diagrams/render.mjs` (two launches per diagram, 90 s limit, plus a probe), `docs/blueprint/wireframes/render.mjs`.
2. A run that is killed (task stop, a session ending, the machine overloaded) never reaches its `finally`: Playwright's browsers
   (`apps/dashboard`), `tools/site-backup/*.mjs` browsers, and every throwaway Postgres cluster
   (`omnikom-pg-*` in the system temp folder) stay up. Nothing ever sweeps them later.
3. Some launches have no `finally` at all: `tools/site-backup/test-loaders.mjs`, `tools/site-backup/verify.mjs` (check),
   `tools/site-backup/view.mjs` (headed, interactive: closing on exit is enough).

## What to build
1. `tools/proc-guard/index.mjs` (new; the head adds it to the platform-build charter's Owns), no dependencies:
   - `guardedTemp(prefix, kind)`: mkdtemp in the system temp folder plus `owner.json` (`{ pid, started, kind, argv }`); registers
     ONE cleanup for exit, SIGINT, SIGTERM, SIGHUP, SIGBREAK, uncaughtException and unhandledRejection that stops what lives in the
     folder (a cluster: `pg_ctl stop -m immediate`; browser processes: the whole tree) and removes the folder. Returns
     `{ dir, release() }`; `release()` runs the cleanup once (idempotent).
   - `killTree(pid)`: Windows `taskkill /PID <pid> /T /F`; elsewhere a process-group kill. Used on every time limit.
   - `sweep(prefixes)`: for every temp folder with one of our prefixes whose `owner.json` names a process that is no longer alive
     (or that has no `owner.json` and is older than 6 hours): stop its cluster if `data/postmaster.pid` exists, kill every process
     whose command line contains the folder path, then delete the folder. Prints one line per folder it cleaned. Never touches a
     folder whose owner is alive.
   - `leaks(prefixes)`: the processes (any name) whose command line contains one of our temp folders, as `{ pid, name, folder }`.
     Windows: one `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select ProcessId,Name,CommandLine |
     ConvertTo-Json"` call; Linux: `/proc/*/cmdline`.
   - Prefixes in one exported list: `omnikom-pg-`, `mmd-`, `mmd-probe-`, `wf-`, `pw-dash-`, `site-backup-` (add the ones you find).
2. `tools/proc-guard/check-leaks.mjs`: prints `leaks()` and exits 1 when any exist; `--sweep` runs `sweep()` first. CI runs it
   after the gates and after the functions job (the head adds the ci.yml steps).
3. Wire the guard in (each launch: a guarded temp folder for the profile or cluster, `killTree` on a time limit, `release()` in a
   `finally`, `sweep()` once at start):
   - `docs/blueprint/diagrams/render.mjs`, `docs/blueprint/wireframes/render.mjs`: replace `spawnSync(..., { timeout })` with a
     spawn that calls `killTree` at the limit.
   - `tools/site-backup/backup.mjs`, `verify.mjs`, `test-loaders.mjs`, `view.mjs`: `browser.close()` in a `finally` on every path,
     the profile folder guarded.
   - `apps/dashboard`: `tests/global-setup.ts` sweeps at start (Playwright's own `playwright_chromiumdev_profile-*` folders whose
     owning node process is dead count as ours: add that prefix with an owner check by parent process); `playwright.config.ts` keeps
     `workers` as is.
   - Clusters: `supabase/tests/publish-parity.mjs`, `supabase/tests/test-apply.mjs`, `supabase/ops/test/cluster.mjs`,
     `supabase/ops/test/6b-cluster.mjs`, `supabase/ops/restore-drill.mjs`: the cluster folder from `guardedTemp('omnikom-pg-',
     'cluster')`, a sweep at start, `release()` in the existing `finally`.
   - `supabase/tests/run-local.mjs` and `supabase/functions/test/harness.mjs` are being edited by builder 5.2: DO NOT edit them.
     Write `factory/briefs/5-H-wire-run-local.mjs`, a script the head runs at landing that makes the same change in those two files
     (each target text must occur exactly once; split/join, never a replacement string; it prints what it changed).
   - Files of other departments (`tools/omnikom-cli/**`) are not yours: list each launch site you find there for the head's notice.
4. Tests, `tools/proc-guard/test/run.mjs` (light: node child processes stand in for a browser or a postmaster, each carrying the
   guarded folder path in its argv):
   - a child that ends normally, one that throws, one that gets SIGINT and one that hits its time limit: `leaks()` is empty after
     each and the folder is gone;
   - a child killed hard (`taskkill /F` of the run, not its tree): its stand-in process stays; `sweep()` then cleans it and
     `leaks()` is empty;
   - `sweep()` leaves alone a folder whose owner is alive;
   - each watched red: with the cleanup line removed, the matching check fails for the right reason (list the mutants in
     `tools/proc-guard/test/mutate.mjs`, each targeting a line that exists exactly once, the way `supabase/tests/run-local.mjs` does).
   - one real browser check (the one allowed launch): a guarded `--dump-dom` of `data:text/html,<p>ok</p>` with a 1 ms time limit,
     then `leaks()` is empty. Watched red with `killTree` replaced by a plain kill of the main process.
   - CI: the `departments` job is the light home for the unit tests (`node tools/proc-guard/test/run.mjs`); propose the ci.yml
     lines, the head adds them.

## Done when
- Every launch site above uses the guard; the 5-H wire script exists and its targets each occur exactly once in today's run-local.mjs
  and harness.mjs (prove with a dry run that prints the counts and writes nothing).
- `node tools/proc-guard/test/run.mjs`: all pass; `node tools/proc-guard/test/mutate.mjs`: every mutant caught (both light).
- `node tools/proc-guard/check-leaks.mjs` on the laptop now prints what is left (paste it; do not kill other sessions' processes).
- `node docs/blueprint/specs/check-no-model.test.mjs` and `node tools/departments/check.mjs` still pass.
- Report: files changed, the pasted outputs, the CLI launch sites, the ci.yml lines, anything UNPROVEN. No commit, no push.
