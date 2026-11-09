# 14 build env

Owner: platform build. Model: Sonnet (high). Branch: check/platform/build-env (built on check/platform/reaper, work order 13,
which also edits `factory/runner/publish.mjs`). Status: BUILT 2026-11-09, head reviewed: run.mjs 96 of 96 re-run by the head, watched red by the head (build given the whole environment: 2 of 5 childenv checks FAIL), 4 new mutants caught (builder, heavy lock); CI and staging publish proof next. DONE at the land.

## Why
Hardening H0-3, `docs/product/1-product.md` part E row E9. The build (`factory/runner/publish.mjs:137`, `factory/build.mjs`, which
runs the client's design code from `sites/<slug>/design`) and the audit (`:147`, `tools/audit/run.mjs`) inherit the runner's
whole environment through `runTool` (`:61-62`): RUNNER_KEY, the account-wide CLOUDFLARE_PAGES_TOKEN, CLOUDFLARE_ACCOUNT_ID,
PLATFORM_FUNCTIONS_BASE and, on GitHub, GITHUB_TOKEN and every other variable. Only wrangler gets a cleaned environment
(`:191-192`). Design code that reads `process.env` could take the keys. Evidence: `work/11-enterprise-audit/CONTEXT.md` H0-3.
`factory/runner/media.mjs` (the media job) is in scope too if it starts a child process: check it and say.

## Inputs (load these, nothing else)
- `work/11-enterprise-audit/CONTEXT.md` H0-3; `docs/product/11-rules.md` 30-36; `docs/departments/README.md` rule 8
- `factory/runner/publish.mjs`, `factory/runner/media.mjs`, `factory/runner/lib/common.mjs`
- `factory/runner/test/run.mjs` (BASE_ENV at :72, the env a test run gets at :88), `test/mutate.mjs`, `test/lib/`
- `.github/workflows/publish.yml`, `.github/workflows/media.yml` (what the job's environment holds)

## Steps
1. One function in `lib/common.mjs`, e.g. `childEnv(extra)`, that builds a child's environment from an ALLOW list, never a
   deny list: PATH (and Path on Windows), HOME, USERPROFILE, TEMP, TMP, TMPDIR, SystemRoot, windir, ComSpec, PATHEXT, LANG,
   TZ, NODE_OPTIONS only if the workflow sets it on purpose (say which), and the variables a step really needs, passed by
   the caller. Read `factory/build.mjs` and `tools/audit/run.mjs` for every `process.env` they read and list them in the
   report; pass only those (OMNIKOM_REPO_ROOT if read, and nothing secret).
2. Build and audit get `childEnv()`. Wrangler gets `childEnv({ CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
   WRANGLER_SEND_METRICS, CI, npm_config_ignore_scripts })` instead of today's copy-then-delete (`:191`), so a new secret
   added to the workflow later never leaks into it either. Every other spawned child in publish.mjs and media.mjs the same.
3. Tests (fake platform), each watched red against today's code: a fake design (or a test hook the build already has) that
   prints which of RUNNER_KEY, CLOUDFLARE_PAGES_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PLATFORM_FUNCTIONS_BASE,
   GITHUB_TOKEN and a planted `OMNIKOM_PLANTED_SECRET` it can see: none for build and audit; the fake wrangler sees exactly its
   two Cloudflare names and not RUNNER_KEY or the planted one. If the build cannot be made to print its env without changing
   factory/build.mjs, use a fake build script through a test hook like RUNNER_WRANGLER_SCRIPT and say so.
   Mutants in `test/mutate.mjs`: the build gets the full env back; wrangler gets the full env back (both caught).
4. Book: E9 stays PARTLY (H2-5 per-project tokens, H2-11 two keys still open); its evidence column replaces "wrangler alone
   gets a clean environment" with "every runner step gets an allow-listed environment (H0-3, work order 14)". If 17 (dispatch
   scope) landed first, keep its words in the same cell.

## Outputs
- `factory/runner/lib/common.mjs`, `factory/runner/publish.mjs`, `factory/runner/media.mjs` (only if it spawns),
  `factory/runner/test/run.mjs`, `test/mutate.mjs`, `test/lib/*` (a fake build if needed), this file's status line,
  `docs/product/1-product.md` row E9. Nothing else; anything more is a finding.

## Proof
- `node factory/runner/test/run.mjs` -> "OK: N of N checks passed"; `MUTANT_ONLY=<name part> node factory/runner/test/mutate.mjs`
  through `~/.claude/scripts/heavy.mjs` -> the new mutants caught. No full mutant run, no run-all-gates locally (rule 8).
- Staging (the head, after CI is 9/9 on the tip): one publish of the test site through the CLI journey still ends `done`
  with the smoke passing (the build still builds with the smaller environment).

## Findings
Send to the head; never fix here.
