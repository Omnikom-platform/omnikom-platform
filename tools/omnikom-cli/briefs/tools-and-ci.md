# Builder brief: `tools.json`, `omnikom tools ensure` and `omnikom ci` (CLI department, released 2026-10-31 08:00, DECISIONS 42)

Builder: one sonnet session, this slice only, discarded when done. Head: the CLI and testing department head. Source: DECISIONS 42
(`planning/DECISIONS.md`, read it whole): "not installed" is never a reason a check did not run, and a local check that is not the CI
check proves nothing. What went wrong: actionlint ran from a builder's scratch without shellcheck and passed, while ci.yml's actionlint,
which runs shellcheck, found three shell errors. Runs after the key-numbering slice is committed and BEFORE seed test (shared files:
`omnikom.mjs`, `test/run.mjs`, `test/mutate.mjs`). Read `.github/workflows/ci.yml` whole, `~/.claude/reference/supply-chain-2026-10.md`,
`~/.claude/reference/windows-scripting.md`, then the CLI's `omnikom.mjs`, `lib/repo.mjs`, `lib/redact.mjs`, `test/run.mjs`, `test/mutate.mjs`.

## Files you may edit (nothing else; a bug anywhere else is a finding you send back, not a fix)
`tools/omnikom-cli/**` (new: `tools.json`, `commands/tools.mjs`, `commands/ci.mjs`, any `lib/` helper; plus `omnikom.mjs` registration,
`README.md`, `test/run.mjs`, `test/mutate.mjs`). Never `.github/` (the platform department's; a change ci.yml needs is a finding),
never `.gitignore` (the head adds the `.tools/` line), never PATH, the registry, a profile, or anything outside the repo.

## Part 1: `tools/omnikom-cli/tools.json` (decided by the head; do not redesign)
One entry per external tool a check uses: `actionlint` 1.7.12, `gitleaks` 8.30.1, `deno` 2.8.1 (ci.yml's `deno-version`), `shellcheck`
0.11.0 (ci.yml pins it since a303a89, DECISIONS 42: `koalaman/shellcheck` release `v0.11.0`, linux sha256 `b7af85e4...6fe6f6` in ci.yml;
the linux asset ci.yml downloads and the windows zip, digests from the API like the others), and room for more. Each entry: `version`, `published` (the release's `published_at`), `repo`
(`owner/name`), `bin` (the executable's name inside the archive, per platform), and per platform (`windows-amd64`, `linux-amd64`):
`url` (an asset of `https://github.com/<repo>/releases/download/<tag>/...` only), `sha256`, `size`. Fill the hashes from the GitHub API's
asset digest, never from a downloaded file and never by hand:
```
gh api repos/rhysd/actionlint/releases/tags/v1.7.12 --jq '.published_at, (.assets[] | "\(.name) \(.size) \(.digest)")'
```
(measured by the head: `actionlint_1.7.12_linux_amd64.tar.gz 2353908 sha256:8aca8db9...a3d8`, the same hash ci.yml pins;
`actionlint_1.7.12_windows_amd64.zip 2479065 sha256:6e7241b5...f6e9`). A release whose assets carry no digest is a finding, not a
hash you compute. Add a `node` entry with only `version` 24.22.1 (ci.yml's `node-version`; checked, never downloaded).

## Part 2: `omnikom tools ensure [--only <names>] [--json]`
- Downloads each tool for this platform into `<repo>/.tools/<name>-<version>/` and the binary to `<repo>/.tools/bin/<bin>`;
  `OMNIKOM_TOOLS_DIR` overrides the folder (tests only). Node built-ins and `fetch` only.
- Refuses before any byte is written: a URL that is not `https://github.com/<repo>/releases/download/`, a `published` date fewer than 7
  days before now (supply-chain rule 1; `ctx.now()` so a test can move time), a missing sha256. After the download and before
  extraction: the size and the sha256 must match, or the file is deleted and the command exits 1 naming the tool, the expected and the
  actual hash. Extraction with the system tar only (`%SystemRoot%\System32\tar.exe` on Windows, which also reads zip; `tar` on linux),
  into a temp folder inside `.tools/`, then a rename: a crash never leaves a half-written tool. No install script, no PATH change.
- Idempotent: a tool whose folder holds a `.ok` file with the same version and sha256 is skipped, nothing fetched (a test counts calls).
- Result per tool: `present | downloaded | refused` with the reason; exit 0 only when every requested tool is present or downloaded.
- `omnikom tools list` prints the manifest and what is in `.tools/` (read-only).

## Part 3: `omnikom ci [--job <name>] [--root <dir>] [--json]`
- Reads `.github/workflows/ci.yml` itself (a small reader for this file's shape; no YAML dependency) and runs every job in file order,
  each step in order, with a fixed table in `commands/ci.mjs` that maps every step to its local action:
  `run:` steps run the same command line (with `.tools/bin` first on the CHILD's PATH only, and Postgres found the way the CLI's tests
  find it); the `curl ... sha256sum ... tar` download steps map to `tools ensure --only <tool>` and the later `"$RUNNER_TEMP/<tool>/<tool>"`
  call to `.tools/bin/<tool>` with the same arguments; `uses: actions/checkout` maps to "the working tree" (say so in the line);
  `setup-node` and `setup-deno` map to a version check (`node --version` against the manifest, `.tools/bin/deno --version`); the
  Postgres PATH step maps to "initdb found". `npm ci --prefix factory/runner --ignore-scripts ...` runs as written only with `--install`;
  without it the step is SKIP when `factory/runner/node_modules` exists and FAIL ("run with --install") when it does not.
  A ci.yml step the table does not map makes its job FAIL with `step not mapped: <name>`, so ci.yml cannot grow a check `omnikom ci` skips.
- actionlint must find shellcheck: the `workflows` job runs `.tools/bin/actionlint -color .github/workflows/*.yml` with `.tools/bin`
  first on the child's PATH and `-shellcheck .tools/bin/shellcheck(.exe)` given explicitly; the line reports the shellcheck version used.
- Output: one line per job `PASS <job>  <last line>` or `FAIL <job>  <last line>` (the job's real last output line, redacted), then
  `ci: <n> jobs, <p> PASS, <f> FAIL`; exit 1 on any FAIL, 2 on usage (unknown `--job`). `--root` runs the jobs against another checkout
  of the repo (the watched-red uses a copy; nothing in `.github/` is edited).
- Long jobs: the CLI does not time them out below ci.yml's `timeout-minutes`.

## Tests (`test/run.mjs` units; no network, no real download)
- **ci.yml and tools.json agree**: actionlint's, gitleaks' and shellcheck's version, linux URL and sha256 in ci.yml equal the manifest's; ci.yml's
  `node-version` and `deno-version` equal the manifest's. Watched red: change one hash in a copy of ci.yml, see the check name it.
- `tools ensure` with a fake fetch serving fixture archives the test builds itself (a tar.gz and a zip made with the system tar from a
  tiny script file): downloaded, `.ok` written, the binary in `bin/`; a second run fetches nothing; a wrong sha256 deletes the file and
  exits 1 with both hashes; a URL off `github.com/<repo>/releases/download/` and a release 6 days old are refused before any fetch;
  nothing is written outside the tools folder (list the temp root before and after).
- `ci` against a fixture ci.yml in a temp root: every mapped step runs; an unmapped step FAILs its job; `--job` runs one job; a job
  whose command exits 1 prints FAIL with its last line and the run exits 1; the child PATH carries `.tools/bin` and the parent's does not.
- No secret in any output (the redaction pattern of the other commands).

## Mutants (`test/mutate.mjs`, suite `unit`; the text occurs exactly once)
- the sha256 comparison always true; the 7-day check removed; the host check removed; the `.ok` skip ignoring the version;
  an unmapped step passing; a FAIL job counted as PASS; `.tools/bin` dropped from the child PATH; the shellcheck flag dropped.
Then `node tools/omnikom-cli/test/mutate.mjs` until `0 survived, 0 target text missing` (over an hour under load; background).

## Gates (run all, paste the real last lines in your report)
```
node tools/omnikom-cli/test/run.mjs                 ends "OK: N of N checks passed", exit 0
node tools/omnikom-cli/test/mutate.mjs              ends "N mutants, N caught, 0 survived, 0 target text missing", exit 0
node tools/omnikom-cli/omnikom.mjs tools list
```
**HELD for the owner's yes (the head asks; you do not run these):** the real downloads and the live run.
```
node tools/omnikom-cli/omnikom.mjs tools ensure                       on a clean .tools/ (four binaries from their official GitHub releases)
node tools/omnikom-cli/omnikom.mjs ci                                 every job PASS at the current master
node tools/omnikom-cli/omnikom.mjs ci --job workflows --root <copy>   a shell error added to a copy of a workflow: FAIL naming shellcheck's finding
```
In your report, list exactly what `tools ensure` would download: each file name, URL and size from the manifest.

## The five rules of the spec's section 5 (binding)
1. Secrets by name only and never in output; a test asserts it.
2. Production refused for everything but `status` and `apply --i-mean-production` (these commands have no target).
3. Fixtures synthetic; `--real` for anything else.
4. Every command idempotent where a retry is possible (`tools ensure` twice fetches nothing).
5. No dependencies; Web Crypto, psql, fetch only (and the system tar for extraction, decided here); tests and mutants.

## Also binding
- No em dash character in any file. Scripts in files, never inline `node -e`. Long commands in the background.
- Mechanical runs (the suite, the mutants, grep and listings, `gh api` reads) go to a haiku agent with the exact command; you read the
  verdict lines back (DECISIONS 34).
- Do not commit; the head re-runs the proof and commits. Leave every file outside the list above alone.
- Report in this shape: PROVEN lines, UNPROVEN or NOT DONE by name (the held live runs are NOT DONE, say so), findings (for the platform
  head: anything ci.yml should change; the shellcheck pin is already in ci.yml since a303a89).
- Anything outside this brief is a finding you send back, not a fix.
