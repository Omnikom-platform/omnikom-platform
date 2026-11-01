# Brief: no orphaned processes, and no load collapse, on this laptop again

Owner, 2026-11-01 02:12 (after he had to restart the laptop): "fix what caused that bulk of stray processes ... we already
previously created a hook to prevent leftovers ... make sure that this issue never happens ever again ... hardware is managed
the right way"; then "upgrade that properly and make sure that it will cover all that properly".

## What happened (measured by another session at 2026-11-01 01:00, before the restart)
- CPU 100%, RAM 30.6 of 31.9 GB.
- 1021 msedge processes in 111 browser launches. 94 were automation (headless or CDP) with temp profiles under
  `C:\Users\DELL\AppData\Local\Temp\`, about 34 GB counted. 91 of the 94 were orphans (the launching process was gone).
  Ages: 57 over 6 h, 19 at 20-60 min, 18 under 20 min, so something was still launching and abandoning browsers.
  The owner's normal Edge profile had 17 launches and must never be touched.
- Also 40 postgres (throwaway test clusters under `%TEMP%\omnikom-pg-*`, some 17+ h old), 21 node, 14 bun, 47 bash,
  93 conhost, 14 pwsh, 7 hung taskkill, 32 claude.
- Heavy runs from several sessions overlapped: mutant suites, full gates (a Postgres `initdb` took 123 s instead of seconds),
  Playwright flows.
- The existing reaper `~/.claude/hooks/reap-stray-shells.mjs` (SessionStart + SubagentStop) only stops stuck Claude shells and
  a spinning python REPL. It never looked at browsers, Postgres, node/bun/deno workers or taskkill. That is the gap.

## Known launchers of automation browsers (grep for --headless / remote-debugging-port / msedge / playwright)
Machine-global (yours to fix in this slice):
- `~/.claude/skills/design-bench/bench.mjs`
- `~/.claude/skills/programmatic-enterprise-web-performance/scripts/cdp-measure.mjs`, `lib-shots.mjs`, `doctor.mjs`
  (this is the OUTSIDE copy; the repo copy in `E:\Omnikom Platform\skills\...` is synced by the SEO department with
  `node skills/sync-skill.mjs`; do not edit the repo copy, list what changed so it can be synced)
- `~/.claude/skills/motion-video-director/templates/render/render.js`
- `~/.claude/skills/pptx-official/scripts/html2pptx.js`
Repo launchers (NOT yours; departments fix them; just list any defect you notice): `apps/dashboard` Playwright,
`docs/blueprint/diagrams/render.mjs`, `docs/blueprint/wireframes/render.mjs`, `tools/site-backup/*`, `tools/offer/*`,
`tools/client-questions/*`, `film/engine/src/render.mjs`.

## Deliverables
Read `~/.claude/reference/windows-scripting.md` first and follow it (measured rules: Git Bash path rewriting, MSYS children
that `taskkill /T` misses, no unbounded loops, no bare python, scripts in files). Keep the style of the existing hooks.

### 1. The reaper covers every class (upgrade `reap-stray-shells.mjs`, or a new `reap-orphans.mjs` beside it, your call;
one entry point registered in settings, one log at `~/.claude/logs/`)
Orphan = its parent PID does not exist, OR the PID now belongs to a process created AFTER the child (PID reuse: compare
creation times). Every kill is by PID, tree innermost first. Budget: listing plus stops under 25 s (hook limit 30 s); what
is left waits for the next run. Classes:
- **Automation browser trees**: msedge.exe or chrome.exe whose command line has `--headless` or `--remote-debugging-port`
  AND a `--user-data-dir` under `%TEMP%` (or another clearly temporary folder you can justify). Root of the tree orphaned
  and older than 10 min: stop the whole tree, then remove that temp profile folder (only if it is under %TEMP% and no
  live process holds it). NEVER touch: an Edge without those flags, any profile outside temp (the owner's), msedgewebview2.
- **Throwaway Postgres**: postgres.exe whose `-D` data dir is under `%TEMP%` and whose postmaster's launcher is gone:
  `pg_ctl stop -D <dir> -m fast` (pg_ctl from the same bin folder), fall back to stopping the PIDs; then delete the data
  dir only if it is under %TEMP% and matches a throwaway name (`omnikom-pg-*` or a pattern you verify).
- **Runner workers**: node.exe, bun.exe, deno.exe orphaned, older than 30 min, with a command line that is clearly a test or
  build run (mutate.mjs, test/run.mjs, run-all-gates.mjs, playwright, vitest, deno test, a path under a temp worktree such
  as `%TEMP%\omnikom-wt-*`, `D:\omk-*`). Stop the tree. Never an MCP server, never a process whose parent is alive.
- **Hung taskkill.exe** older than 5 min: stop it.
- **Orphan conhost.exe** with no live client process, older than 30 min: measure first whether this state exists; if it
  does, stop it; if conhost always dies with its client, say so and skip.
- Never: claude.exe, the Claude desktop app, Edge with the owner's profile, anything system, anything with a live parent.
- Flags: `--dry` prints what it would stop and why (class, PID, age, command head); `--only <text>` for tests.
- Triggers: keep SessionStart (startup|resume) and SubagentStop; add Stop (end of every turn); add a Windows Scheduled
  Task for the current user (no admin) every 15 minutes running it with `--no-stdin`, hidden window, so it works when no
  session is active. Register it with schtasks, idempotent; a test checks the task exists and points at the right file.

### 2. One heavy job at a time, machine-wide (`~/.claude/scripts/heavy.mjs`)
- `node ~/.claude/scripts/heavy.mjs [--wait-min 30] [--label <text>] -- <command...>`: takes a machine-wide lock file
  (`~/.claude/state/heavy.lock` with PID, start time, label, cwd), reclaims it when the holder is dead (PID plus creation
  time), waits bounded with one line a minute ("waiting for <label> by PID n since hh:mm"), refuses to start while free RAM
  is under 4 GB, runs the command as a child, forwards stdout/stderr and the exit code, and on its own exit (normal, error,
  Ctrl-C, being stopped) stops the child's whole tree and releases the lock.
- `shell-shaper.mjs` (PreToolUse Bash/PowerShell) gets a rule: a known heavy command not wrapped in heavy.mjs is refused
  with the exact wrapped command to run instead. Heavy = the full mutant runners (`mutate.mjs` without a narrow `--only`),
  `run-all-gates.mjs`, `playwright test`, `omnikom ci` without `--job`, `npm ci`/`npm install` in a repo, `deno test` over
  the functions folder, `supabase/tests/run-local.mjs`, a `tools ensure`. Keep the list in one exported array with tests.
- A short line in `~/.claude/CLAUDE.md`? NO: do not edit CLAUDE.md. The hook is the enforcement.

### 3. Close at the source (the machine-global launchers listed above)
Every browser launch closes in a `finally` on every path (error, timeout, SIGINT, SIGTERM), and a `process.on('exit')`
handler stops the browser's PID tree if it is still alive; the temp profile is removed after. Tests: a launch that throws
leaves no browser with that profile; a run that is killed leaves nothing within one reaper pass.

## Proof (paste real output; NOT DONE / UNPROVEN where true)
- Each reaper class watched red then green with a REAL planted orphan the test creates and only the test touches
  (`--only` its own marker): a node launcher that starts `msedge --headless --user-data-dir=%TEMP%\reaptest-*` and exits;
  a throwaway `initdb`+`pg_ctl start` cluster whose launcher exits (if Postgres is on the machine: find it); an orphaned
  node worker; a hung taskkill substitute. Break each rule on purpose (a mutant) and see the test fail for the right reason.
- The owner's Edge and a live-parent automation browser are NOT stopped (negative tests).
- heavy.mjs: two at once, the second waits; a dead holder is reclaimed; the child tree is stopped when heavy.mjs is killed;
  shell-shaper refuses an unwrapped heavy command and accepts the wrapped one; existing shell-shaper tests stay green.
- A dry run on the real machine now, pasted (it should find little or nothing after the restart).
- Run the tests one at a time (this is the load lesson). Total runtime of all tests reported.

## Rules
- No em dashes in any file. Scripts in files, never inline `node -e`. Settings edits: `~/.claude/settings.json` must stay
  valid JSON (the postwrite hook parses it); add, never remove, existing hooks.
- Do not touch the repo `E:\Omnikom Platform` except to read. Do not stop any process you did not create, except through
  the reaper's own dry run.
- When done, report: files changed, the pasted proof, what is UNPROVEN, and the list of repo launcher defects you noticed.
