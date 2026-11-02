# 5-PW: the dashboard's Playwright web server gets its own port block (DECISIONS 50 (e))

Head: `HEAD_Platform-build_2026-11-02` (report by SendMessage). Builder: Sonnet, effort high. Written 2026-11-02 07:15.
Why: the CLI journey's J6 (2026-11-02 07:05) stopped with "Error: http://localhost:4173 is already used, make sure that nothing is
running on the port/url or set reuseExistingServer:true in config.webServer." `apps/dashboard/playwright.config.ts` pins `baseURL` and
`webServer.url` to `http://localhost:4173` (vite preview's default, through `scripts/preview-staging.mjs`) with `reuseExistingServer: false`,
so two dashboard Playwright runs at once (our 5-DS styles run, the CLI's J6) collide. `reuseExistingServer: false` STAYS: reusing would test
someone else's build. Head of operations' ruling (DECISIONS 50 (e)): the block 27000-27899, same rules as DECISIONS 50 (b) to (d).

## Done when
1. The dashboard Playwright web server listens on 127.0.0.1 at a port inside 27000-27899 (DECISIONS 50 (b)), never 4173, never outside the
   block. One shared place decides the port (for example a small module the config and `scripts/preview-staging.mjs` both import, or the
   config passing `--port`/`--host` to the preview and setting `baseURL` from the same value); find every `4173` in `apps/dashboard`
   outside `node_modules` (and in `tools/omnikom-cli` only to REPORT, not change: that is the CLI's) and replace ours.
2. DECISIONS 50 (c): if the chosen port is taken (a bind failure, or Playwright's "is already used"), the next port in the block is tried,
   at most 5 times, one printed line per try, never leaving the block; any other start failure stops at once. A port picked before the
   server starts must be the one the server binds (no race window you can avoid; if the honest design is "probe, then start, then
   walk on a bind failure", say so).
3. DECISIONS 50 (d): a unit test (plain node, no browser, no staging) watched red on master's config (it uses 4173 / outside the block),
   green on yours; a test that holds the first port with a plain socket and shows the next one is used; a mutant with the fallback removed
   (the held port case goes red). Wire the test as a `docs/blueprint/specs/run-all-gates.mjs` line (not a new ci.yml step: the CLI's
   ci.yml map would go red) and the mutant into the mutant list the dashboard tests already use (or the test's own mutant pass, as
   `supabase/tests/cluster-port.test.mjs` does; copy its shape).
4. `npx playwright test --list` still lists every spec, and one real spec run of `tests/styles.spec.ts` or any spec that needs no staging
   write starts the server on a 27xxx port (paste the line), through heavy.mjs.

## Rules
Code changes in a worktree of `backup-gh/master` (c010c65 or newer), never the shared tree; never commit or push. `npm ci` only from the
lockfile, through heavy.mjs; no new dependency. Keys by variable name only (`node tools/with-env.mjs "<abs path>/creds and accounts
login/omnikom.env" -- <command>`), never print a value. Scripts in files, not `node -e`. Heavy runs through
`node "$HOME/.claude/scripts/heavy.mjs" --label "<name>" -- <command>`. No em dashes. Anything outside this brief is a finding you send
back, not a fix.
