# 21 dep scan

Owner: cli-and-testing. Model: sonnet, effort high. Branch: check/cli/dep-scan. Status: OPEN (built; first CI run of the secrets-job steps decides; E17 moves after it).

## Why
Hardening step H2-10, book row E17 (`docs/product/1-product.md`, PARTLY: "actions SHA-pinned; no dependency scan"). CI installs
with `npm ci ... --no-audit` (`.github/workflows/ci.yml:74`, `media.yml:33`) and nothing checks a lockfile for a known
vulnerable or malicious package. Chosen (CLI head, 2026-11-09): an OSV-Scanner gate in CI, failing closed, the same script
runnable on the laptop; no Dependabot (its pull requests need a person, and master moves only by `omnikom land`).

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/cli-and-testing.md` (Rules, Proof; not the position log)
- `~/.claude/reference/supply-chain-2026-10.md` (rules 1, 3, 7)
- `.github/workflows/ci.yml` (the `secrets` and `workflows` jobs: how a pinned tool is downloaded and its sha256 checked),
  `.github/workflows/media.yml` line 33
- `tools/omnikom-cli/tools.json` (the shellcheck entry) and the test in `tools/omnikom-cli/test/run.mjs` that fails when ci.yml
  and tools.json name different versions or hashes
- `tools/omnikom-cli/commands/ci.mjs` (`NODE_STEPS`, `ROWS`: every ci.yml step must map, or the CLI unit check
  "ci on the real ci.yml: every job and step is mapped" goes red)
- The lockfiles: `apps/dashboard/package-lock.json`, `factory/runner/package-lock.json`, `tools/site-backup/package-lock.json`,
  `deno.lock`

## Steps
1. Pin osv-scanner: the newest release at least 7 days old (supply-chain rule 1); the laptop has 2.7.0 from winget, use it unless
   a newer one is 7+ days old. Add it to `tools.json` (linux-amd64 and windows-amd64, url and sha256 from the release's own
   checksums file, read and compared, never typed from memory), so `omnikom tools ensure` fetches it.
2. `tools/test/dep-scan.mjs`: runs the pinned osv-scanner once per lockfile above (`scan source --lockfile <f> --format json`),
   parses the JSON, and prints one line per finding: `dep-scan: <lockfile> <package>@<version> <id> <summary first 80 chars>`,
   then `dep-scan: N lockfile(s), M finding(s), K allowed` and exits 1 when any finding is not allowed. A `MAL-` id is never
   allowed. Allowed findings live in `tools/test/dep-scan-allow.json`: `[{ "id", "package", "reason", "until": "YYYY-MM-DD" }]`;
   an entry past its `until` date no longer allows (prints `dep-scan: allow entry <id> expired <date>`). osv-scanner missing,
   crashing, or returning output that does not parse is exit 2, never a pass (fail closed). A lockfile osv-scanner cannot read
   (check whether 2.x reads `deno.lock`) is printed `dep-scan: <file> NOT COVERED (<reason>)` and named in this order's
   Findings; it does not fail the run, so the book row says exactly what is covered.
   The parsing and verdict are a pure function with unit tests on fixture JSON (no network): clean, one vuln, one MAL, an allowed
   vuln, an expired allow, unparsable output, osv's exit codes (it exits 1 when it finds something: read the JSON, not only the code).
3. First real run on the laptop against the four lockfiles; paste its lines here. Real findings: for each, either it is a real
   risk (a finding sent to the owning department's head through the CLI head, with the upgrade that fixes it) or it is allowed
   with a reason and an `until` within 30 days. Never edit another department's lockfile here.
4. CI: in the `secrets` job, a step that downloads the pinned osv-scanner and checks its sha256 (the shellcheck pattern), then
   `Dependency scan: node tools/test/dep-scan.mjs` with the binary's path passed as an argument or env var. The ci.mjs rows for
   both steps. Drop `--no-audit` from ci.yml:74 and media.yml:33 (keep `--ignore-scripts`).
5. The tools.json and ci.yml pins agree, checked by the existing test pattern (add osv-scanner to it).
6. Book: `docs/product/1-product.md` row E17 says what is now true (which lockfiles are scanned, what is NOT COVERED); it moves to
   WORKS only if every lockfile is covered and CI ran it green. That file belongs to the head of operations: a light follow-on,
   named in your report.

## Outputs
- `tools/test/dep-scan.mjs`, `tools/test/dep-scan-allow.json`, its test file and mutants (a `tools/test/mutate-dep-scan.mjs`
  following `tools/test/mutate-secret-receiver.mjs`'s pattern, and a CI step for it like "Secret receiver mutants")
- `tools/omnikom-cli/lib/tools.mjs` (osv-scanner ships raw binaries, no archive: skip tar when the url's last segment is the
  bin name; CLI head, 2026-11-09), its unit test in `test/run.mjs` and a mutant
- deno.lock: osv-scanner 2.7.0 cannot read it; its npm entries are scanned through a temporary package-lock.json written by
  dep-scan.mjs (a unit test and a mutant for the conversion); jsr: and https: entries are NOT COVERED by name
- `tools/omnikom-cli/tools.json`, `tools/omnikom-cli/commands/ci.mjs`, the pin-agreement test, `.github/workflows/ci.yml`,
  `.github/workflows/media.yml` (one flag)
- `docs/product/1-product.md` row E17 (light follow-on)

## Proof
- `node tools/test/test-dep-scan.mjs` (or your test's name) -> its pass line; `node tools/test/mutate-dep-scan.mjs` -> every
  mutant caught: one per clause (a MAL is never allowed, an expired allow does not allow, unparsable output is exit 2, a finding
  fails the run, the allow file is read). Each watched red by hand first.
- `node tools/omnikom-cli/test/run.mjs --unit` -> "OK: N of N checks passed" (the new ci.yml steps mapped, the pins agree).
- The real laptop run's lines pasted in step 3.
- Builders never commit or push; the head does (README rule 8). No full local mutant run of the CLI.

## Findings
Anything outside these files is a finding sent to the CLI head, never fixed here.
