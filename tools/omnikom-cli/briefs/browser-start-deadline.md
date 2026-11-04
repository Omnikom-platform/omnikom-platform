# Brief: the journey browser waits for its DevTools address against a measured wall-clock bound

Head: HEAD_CLI-and-testing_2026-11-02. Builder: BUILDER_cli-and-testing_journey. Written 2026-11-02 09:45.

## Why
Stack c3927c2 (check/cli-and-testing/journey, on master 34c3ceb) went red on GitHub, run 41404410237 attempt 1, CLI job --unit:
"FAIL journey browser: the browser tests ran to the end: the browser did not report its DevTools address in 15 s",
"FAILED: 485 of 486 checks passed, 1 FAILED". `tools/omnikom-cli/lib/browser.mjs` is new in this stack; the head of operations
ruled it does not land until the start wait is robust under load (a green rerun does not count).

What is wrong at browser.mjs:179-183: the wait is a count (150 tries x sleep 100 ms), not a clock; the bound (15 s) is a guess, not a
measurement; the failure line does not say how long it really waited; a browser that has already exited is waited on for the
whole bound instead of failing at once with its exit code.

## Do
Work in worktree `D:\omk-gates\cli-stack` (holds c3927c2). Make a local branch `browser-deadline` there; one new commit on top of
c3927c2. Do not rebase, do not push (the head pushes).
1. Measure first: time from spawn to a readable DevToolsActivePort on this laptop, at least 10 launches, some while the heavy lock
   holder or a mutant run is busy; report min / median / max. Pick the bound from that (expected around 60 s; a bound well above the
   worst measured, with the reason in a comment next to the constant).
2. browser.mjs: wait against a wall clock (`Date.now()` deadline), poll every 100 ms; stop at once if the child process has exited
   (listen for its `exit`/`error`) and say so with the exit code or signal; the failure line prints the real elapsed time and the
   bound, e.g. "the browser did not report its DevTools address in 61.2 s (bound 60 s)". The bound is a named exported constant;
   `launchBrowser` may take an option to override it, for tests only.
3. Tests in the CLI suite (`tools/omnikom-cli/test/run.mjs`, the journey browser group), using the existing `spawnImpl` / `importer`
   seams, a stub browser (no real Edge):
   a. a stub that writes DevToolsActivePort late (after 16 to 18 s) with the default bound reaches the connect step (not the
      "did not report" error). Watched RED on c3927c2's browser.mjs for the right reason (the 15 s line), then green.
   b. a stub that never writes, with a small override bound, fails with the line naming elapsed and bound, in about that time.
   c. a stub that exits at once fails fast (well under the bound) naming the exit.
   Keep the group's added wall time under 25 s.
4. Mutants in `tools/omnikom-cli/test/mutate.mjs`: deadline back to 15 s; poll loop replaced by a single check; the exit check
   removed. Each caught by a named test. Check every mutant's target text exists (the --unit "mutate targets" check).
5. Gates you run and paste: `node tools/omnikom-cli/test/run.mjs --unit` ("OK: N of N"), the new mutants with
   `node tools/omnikom-cli/test/mutate.mjs --only <your filter>` ("N mutants, N caught"), `gitleaks protect --staged` clean before the
   commit. No em dashes in any file. Edit only `tools/omnikom-cli/`.

## Done when
One commit on `browser-deadline` over c3927c2; the pasted measurement, the watched red line, the green lines, the mutant line, the
gitleaks line, sent to the head. Anything outside this brief is a finding you send back, not a fix.

## Part 2 (head, 2026-11-02 11:40): rebase onto master 39fb39d and follow platform 5-PW
Master moved 34c3ceb -> 39fb39d (platform 5-PW: the dashboard preview leaves fixed localhost:4173; `apps/dashboard/scripts/preview-port.mjs`
picks 27000-27899 on 127.0.0.1, `PORT_ENV = 'OMNIKOM_DASHBOARD_PORT'`, `choosePort()`, `baseUrl(port)`; `preview-staging.mjs` uses the env port
with one try and strictPort, or walks the block by hand; Playwright's config picks and walks itself). After a rebase the journey is wrong in two places:
`commands/journey.mjs:312-315` `inboxShot` waits on `http://localhost:4173` (the server is now elsewhere: J6's PNG always fails), and the J6
precheck `portFree(DASHBOARD_PORT)` at :158 guards a port nothing uses any more.
1. In `D:\omk-gates\cli-stack`: branch `journey-r2` = master 39fb39d + cherry-pick of 34c3ceb..f23e418 (7 commits, same messages). Report any conflict.
2. One new commit: `inboxShot` picks the port through the dashboard's own `preview-port.mjs` (import it through `importRepo`; read only, never edit
   `apps/`), passes it to `preview-staging.mjs` as `OMNIKOM_DASHBOARD_PORT`, and polls `baseUrl(port)`; the failure line names that URL. The J6 4173
   precheck, `DASHBOARD_PORT`, its two tests and mutant 399 go (Playwright walks its own block now); the README row and briefs/journey.md say the new
   way. Test watched red on f23e418's journey.mjs: the preview is started with OMNIKOM_DASHBOARD_PORT in the block and the page opened is that
   port's URL. A mutant (port not passed, or base back to localhost:4173).
3. Gates: `run.mjs --unit` OK, the journey mutants (`mutate.mjs --only journey`, all 30+ this time, under the heavy lock), gitleaks staged clean.
4. One real staging run of the journey, once: `test journey --target staging --only J4,J5,J6,J7 --alert-to <the address the 07:44 run used, see
   docs/blueprint/PROGRESS.md "5-L DONE">`, paste the step lines and PNG paths. One run, never looped.
