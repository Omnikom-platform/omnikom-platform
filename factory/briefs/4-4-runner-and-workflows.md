# Brief 4.4: the build runner and the five workflows (Sonnet builder; one slice, one brief, discarded when done)

Written 2026-10-31 00:40 by the head of the Platform build department (session `local_cade0add-3389-4314-b7b5-83333d26a97a`).
You report to that head only. Anything outside this brief is a finding sent back with options, never a fix. You edit only:
`factory/runner/**` (NEW), `.github/workflows/**` (NEW), `tools/github-secrets.mjs` (NEW), `factory/README.md` (a "Runner" section
appended), and your own paragraph under "## Step 4" in `docs/blueprint/PROGRESS.md`. Never `factory/build.mjs`, `factory/lib/**`,
`supabase/**`, `tools/audit/**`, `tools/omnikom-cli/**` (you call them; a bug there is a finding). No em dash anywhere. Scripts in
files. Secrets by variable name only, never printed; staging commands only through `node tools/with-env.mjs "creds and accounts
login/omnikom.env" -- <cmd>`; never read or list that folder. Nothing against a client site or project: the only Pages project
you may name is `test-site-demo-a` (the platform's own test site; the head creates it in slice 4.5, you do not).

## Read first, in order
1. `CLAUDE.md` rules 2, 3, 6, 7, 9, 10, 11; `docs/departments/README.md` rules 1 to 7; `docs/blueprint/23-GROUND-RULES.md` 2, 3b, 4.
2. `docs/blueprint/02-BACKEND.md` sections 5 (media processing in the runner), 7 (the runner), 8 (which secret lives where), 11 (CI).
3. `docs/blueprint/21-PROTOCOLS.md` sections 1, 2, 3 (dispatch, callbacks, deploy: the facts with their vendor pages), 8.
4. `docs/blueprint/10-DELIVERY.md` sections 3 (the CI stages), 4, 5; `docs/blueprint/05-BUILD-PLAN.md` W0.2, W1.4, W1.6, W3.2.
5. `factory/README.md` (the export shape and the `factory/build.mjs` command line, written by slice 4.1), `factory/build.mjs` header,
   `factory/test/fixtures/export-test-demo-a.json` (your test input), `sites/test-demo-a/` (the look-folder the runner builds with).
6. `supabase/functions/_shared/signature.ts` (`sign`: the header the runner sends; the canonical string is
   `t\nMETHOD\npath?query\nbody`), `supabase/functions/export-published/index.ts`, `job-callback/index.ts`, `media-export/index.ts`,
   `media-process-callback/index.ts` (slice 4.3; their request and answer shapes are what you call), `tools/omnikom-cli/lib/sign.mjs`
   (how the CLI signs the same way; read-only), `tools/audit/README.md` ("The runner": `node tools/audit/run.mjs <folder>`, exit 0 / 1 / 2).
7. `tools/deploy-capture-lead.mjs` (the pattern for a tool that reads names from the env and scrubs output),
   `~/.claude/reference/supply-chain-2026-10.md` (BEFORE adding sharp or any action: pinned version, lockfile, 7-day rule, actions
   pinned by commit SHA).

## What you make, in this order (test first, watched red, then the code)

### 1. `factory/runner/publish.mjs`
Env in (by name): `JOB_ID`, `SITE_ID` (the dispatch payload), `PLATFORM_FUNCTIONS_BASE` (`https://<ref>.supabase.co/functions/v1`),
`RUNNER_KEY`, `CLOUDFLARE_PAGES_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; flags `--force-fail heading` (passed through to the factory),
`--no-deploy <dir>` (tests: the deploy step writes `dist/` to that dir and invents a deploy id `local-<sha>`), `--work <dir>`.
Steps, each printed as one `STEP <name>: <result>` line, the whole run bounded (every fetch `AbortSignal.timeout`, every spawn `timeout`):
1. `export`: GET `<base>/export-published?job=<JOB_ID>` with `X-Runner-Signature` = `sign(RUNNER_KEY, 'GET', '/export-published?job=<id>', '')`
   (the path without the `/functions/v1` prefix, as `capture-lead` and the export function reduce it). 401 or any non-200 = `failed`
   with the status. Refuse (callback `failed`, reason `site mismatch`) when `export.site.id !== SITE_ID` or `export.job.id !== JOB_ID`.
   Refuse when `sites/<export.workspace.slug>/design/` is not in the checkout (`no look-folder`). Write the export to the work dir.
2. `media`: download every `export.media[].url` (signed URLs the export carries, slice 4.3) into `<work>/media/<path>`; a download
   failure of a REFERENCED file fails the job (the factory decides what is referenced; you download all, and the factory copies what it needs).
3. `build`: `node factory/build.mjs --export <work>/export.json --out <work>/dist --media <work>/media --design sites/<slug>/design
   [--force-fail heading]`; a non-zero exit = `failed` with the factory's last 20 lines as the report.
4. `gating`: callback `{ job, state: 'gating' }`; then `node tools/audit/run.mjs <work>/dist` (exit 0 passes; 1 = `failed` with the FAIL
   lines in `gateReport.audit`; 2 = `failed` with `usage error`); the gate report is `{ factory: 'pass', audit: { exit, fails: [...lines] } }`.
5. `deploying`: callback `{ job, state: 'deploying' }`; `npx --yes wrangler@4.156.0 pages deploy <work>/dist --project-name <export.site.deploy_target>
   --branch <preview|main> --commit-dirty=true` with `CLOUDFLARE_API_TOKEN=CLOUDFLARE_PAGES_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in its env;
   `preview` when `export.site.state !== 'live'`, `main` when live. The deployment URL and id are parsed from wrangler's output (the
   `https://<hash>.<project>.pages.dev` line); the fixed preview address is `https://preview.<project>.pages.dev`.
6. `smoke`: GET the fixed address (preview) or `https://<domain>/` (live) up to 6 times 10 s apart until HTTP 200; on a preview the
   response must carry `x-robots-tag` containing `noindex`; the HTML must contain the `<title>` of the export's home page row. Failure =
   `failed` (the deploy happened; the report says `deployed but smoke failed` and carries the deploy id).
7. `done`: callback `{ job, state: 'done', deployId, gateReport }`. Every callback is `POST <base>/job-callback` with the body signed the
   same way (`'POST', '/job-callback', body`); a 409 from the callback is printed and fails the run (the state machine refused us).
Exit 0 only after `done` answered 2xx. Any `failed` path exits 1 after its callback answered. Never print a secret; scrub the
project ref and tokens from every printed line (`tools/deploy-capture-lead.mjs` pattern).

### 2. `factory/runner/media.mjs`
Env: `MEDIA_ID`, `WORKSPACE_ID`, `PLATFORM_FUNCTIONS_BASE`, `RUNNER_KEY`. GET `<base>/media-export?media=<id>` signed -> `{ id, path,
workspace_id, url (signed download), uploads: { "2400": url, "1600": url, "800": url } (signed upload URLs for `<path minus ext>-<w>.webp`) }`.
Refuse a `workspace_id` mismatch. Download; with `sharp` (pinned in `factory/runner/package.json` + `package-lock.json`, installed only
in the workflow with `npm ci --prefix factory/runner`): read dimensions, `rotate()` (apply EXIF orientation), produce WebP at 2400, 1600,
800 wide (never upscale: skip a size wider than the original and say so in the callback), `withMetadata()` NOT called so EXIF and GPS are
gone; a PDF is not processed (callback with `processed: true, width 0`? NO: a PDF answers `media-process-callback` with
`{ media, kind: 'document' }` and the function decides; read `media-process-callback/index.ts` for the exact body). PUT each size to its
upload URL; then POST `<base>/media-process-callback` signed with `{ media, width, height, exifStripped: true, bytes, sizes: [...] }`.
Test (no sharp needed to run the test? sharp IS needed: the test runs only when `factory/runner/node_modules/sharp` exists and prints
`SKIP media test: run npm ci --prefix factory/runner` otherwise, exit 0 with the word SKIP, never a silent PASS): a generated JPEG with a
GPS EXIF block (write the EXIF bytes yourself in the test; no dependency) -> the three outputs have no EXIF (parse the WebP chunks: no
`EXIF` chunk) and the widths are right.

### 3. `factory/runner/test/run.mjs` and `test/mutate.mjs`
`run.mjs`: a fake platform (a local HTTP server) that answers `export-published` with the slice 4.1 fixture export (plus `media[].url`
pointing at itself), records every `job-callback` body in order, verifies the runner's signature with the platform's own `verify`
(`supabase/functions/_shared/signature.ts` run through Deno? no: port nothing; import `tools/omnikom-cli/lib/sign.mjs` read-only, or copy
the 20-line verify into the test), and serves the media file. Checks: a full run with `--no-deploy` leaves `dist/index.html` and the
callbacks `gating`, `deploying`, `done` in that order, each signed and verifying, `done` carrying a deploy id; `--force-fail heading` =
callback `failed` after `gating` with a `MET-003` line in `gateReport.audit.fails`, NO dist written to the deploy dir, exit 1; a site
mismatch (`SITE_ID` of B) = `failed` with `site mismatch` before any build; an export answering 401 = `failed`; a missing look-folder =
`failed` `no look-folder`; a smoke that never answers 200 (fake deploy URL served by the fake platform answering 503) = `failed` with
`deployed but smoke failed`; the callback answering 409 = exit 1 and the run stops. Ends `OK: N of N checks passed`.
`mutate.mjs`: removes one rule at a time from a copy of `publish.mjs` (the site check, the job check, the look-folder check, the audit
exit check, the smoke noindex check, the signature on the callback, the preview branch choice) and requires `run.mjs` red; ends
`N mutants, N caught, 0 survived, 0 target text missing`.

### 4. `.github/workflows/`
Every action pinned by full commit SHA with the version in a comment (supply-chain rule); `permissions: contents: read` at the top of
every workflow; no secret echoed; `timeout-minutes` on every job; Node 20 (`actions/setup-node`), Deno 2 (`denoland/setup-deno`).
- `publish.yml`: `on: repository_dispatch: types: [publish]`; `concurrency` as `21-PROTOCOLS.md` section 1 says (`group: site-${{
  github.event.client_payload.site_id }}`, the queue setting the doc names; if GitHub rejects the key on the first run, record the exact
  error as a finding and fall back to `cancel-in-progress: false`); one job `publish`, `timeout-minutes: 30`: checkout, setup-node,
  `node factory/runner/publish.mjs` with `JOB_ID` and `SITE_ID` from the payload and the five secrets from `secrets.*`. Also
  `workflow_dispatch` with inputs `job_id`, `site_id`, `force_fail` (choice: none, heading) so the head can start a run by hand for
  the done-when test; the step passes `--force-fail heading` when the input says so.
- `ci.yml`: `on: [push, pull_request]`; jobs: `gates` (`node docs/blueprint/specs/run-all-gates.mjs`: needs `initdb`, `pg_ctl`, `psql` on
  PATH: on `ubuntu-latest` add `/usr/lib/postgresql/16/bin` to `GITHUB_PATH` after checking it exists, else install `postgresql` with
  apt and say so in a step name; needs Deno for `deno task check`), `factory` (`node factory/test/run.mjs`, `node factory/test/mutate.mjs`,
  `node factory/runner/test/run.mjs`, `node factory/runner/test/mutate.mjs`), `functions` (`node supabase/functions/test/run.mjs` and
  its mutants, Deno + Postgres), `audit` (`node tools/audit/test/run.mjs`, `mutate.mjs`), `cli` (`node tools/omnikom-cli/test/run.mjs --unit`),
  `departments` (`node tools/departments/check.mjs`, `node tools/departments/test/run.mjs`, `node clients/check.mjs`),
  `secrets` (gitleaks 8.30.1 binary downloaded from the GitHub release by exact version with its sha256 checked, `gitleaks detect
  --source . --redact --no-banner`; never a marketplace action for a secret scanner), `workflows` (`actionlint` binary, exact version,
  checksum, over `.github/workflows`). Every job `timeout-minutes: 40`.
- `media.yml`: `on: repository_dispatch: types: [media]`; `npm ci --prefix factory/runner`; `node factory/runner/media.mjs` with
  `MEDIA_ID`, `WORKSPACE_ID` from the payload. `concurrency: media-${{ github.event.client_payload.media_id }}`.
- `backup.yml`: nightly cron, `pg_dump` of staging to R2: BLOCKED (R2 is deferred by the owner, 25-BUILD-SEQUENCE step 1.3). Write the
  workflow complete but with `if: ${{ vars.BACKUP_ENABLED == 'true' }}` on the job and a comment naming the block and what unblocks it;
  the dump step must never print a row.
- `keepalive.yml`: weekly cron (Monday 06:00 UTC) + `workflow_dispatch`: `node tools/omnikom-cli/omnikom.mjs status --target staging`
  with `STAGING_DB_URL`, `STAGING_SUPABASE_REF`, `STAGING_SUPABASE_SECRET_KEY`, `STAGING_SUPABASE_PUBLISHABLE_KEY` from secrets (the CLI
  redacts; the step fails on exit != 0 so a paused project shows red).
Validate every file locally with `actionlint` (download the pinned binary into your scratchpad; never into the repo).

### 5. `tools/github-secrets.mjs`
`node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/github-secrets.mjs --repo Omnikom-platform/omnikom-platform
--names CLOUDFLARE_PAGES_TOKEN,CLOUDFLARE_ACCOUNT_ID,RUNNER_KEY,PLATFORM_FUNCTIONS_BASE,STAGING_DB_URL,STAGING_SUPABASE_REF,STAGING_SUPABASE_SECRET_KEY,STAGING_SUPABASE_PUBLISHABLE_KEY [--dry-run]`
For each name present in the environment: `gh secret set <NAME> -R <repo>` with the value on stdin (never argv); a missing name is
printed as `NOT SET (missing in the env): <NAME>` and skipped; `--dry-run` prints what it would set (names only). `PLATFORM_FUNCTIONS_BASE`
is DERIVED when absent: `https://${STAGING_SUPABASE_REF}.supabase.co/functions/v1`. Prints `gh secret list` names afterwards. You run it only
with `--dry-run`; the head runs it for real in slice 4.5.

## Gates (paste the real last lines into PROGRESS.md under "## Step 4", sub-heading "4.4 runner and workflows (builder)")
```
node factory/runner/test/run.mjs          -> OK: N of N checks passed
node factory/runner/test/mutate.mjs       -> N mutants, N caught, 0 survived, 0 target text missing
actionlint .github/workflows/*.yml        -> no output, exit 0 (the pinned binary in your scratchpad)
node --check factory/runner/*.mjs tools/github-secrets.mjs
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/github-secrets.mjs --repo Omnikom-platform/omnikom-platform --names ... --dry-run
node docs/blueprint/specs/run-all-gates.mjs   (background; you touched nothing it covers)
```
The first `ci.yml` run on the org repo happens after the head commits and pushes (the head does that; say in the report which jobs you
expect to be red on the first run and why, honestly: for example the functions job if slice 4.3 is not merged yet).

## Report (your last message, two parts)
1. PROVEN / UNPROVEN / NOT DONE per item with the gate line each.
2. Findings with options (a GitHub or Cloudflare fact that differs from `21-PROTOCOLS.md`; anything the factory or the functions should
   change for the runner; the exact shape you assumed for `media-export` and `media-process-callback` if slice 4.3 had not landed when
   you read them).
