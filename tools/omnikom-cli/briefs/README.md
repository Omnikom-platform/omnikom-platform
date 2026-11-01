# Builder briefs for the omnikom CLI (department `cli-and-testing`)

One file per slice. The head of the CLI and testing department writes a brief here before starting its Sonnet builder; the
builder reads only its brief, the spec section it names and the files it lists. A brief is started only when the head of
operations has released its slice (the functions it tests exist on staging). When the slice is done the brief stays as the
record of what the builder was asked; the proof lives in `docs/blueprint/PROGRESS.md` under the slice heading, and the
charter `docs/departments/cli-and-testing.md` gets one position-log line.

| Brief | Slice | Waits for |
|---|---|---|
| `audit-gate-commands.md` | `omnikom audit --dir` and `omnikom gate --dir`, thin calls into `tools/audit/index.mjs` (the SEO department's command brief is `tools/audit/briefs/slice-3-cli-command.md`) | released 2026-10-30 22:11 (no staging write, no step 4 function) |
| `key-numbering-and-lead-ledgers.md` | `key mint` numbers from the highest existing name (Vault, registry, env record line) and rewrites the env file; `verify --only lead` asserts `security_events` and `consent_ledger` rows, paused site 409 | released 2026-10-30 22:40, after the audit slice is committed (shared test files) |
| `tools-and-ci.md` | `tools/omnikom-cli/tools.json` (actionlint, gitleaks, deno, shellcheck, node: versions, release URLs, sha256 from the GitHub API), `omnikom tools ensure` into the git-ignored `.tools/`, `omnikom ci` running every ci.yml job locally with those binaries | released 2026-10-31 08:00 (DECISIONS 42), after the key-numbering slice, before seed test; the real downloads wait for the owner's yes |
| `seed-test-site-and-status.md` | `seed test` seeds the test site's contract version 2 and every row of `sites/test-demo-a/rows.json` (references resolved, team rows with slug and role, repair by a new version); `status` shows the `omnikom_fn` role and the migration counts | released 2026-10-31 03:10 (slice 4.1 PROVEN, c1258dc); after the two slices above (shared test files) |
| `small-cli-fixes.md` | `land` moves the local master when safe, the "no job ran a step" line, `audit`/`gate --target preview\|production`, `land --lock-wait-minutes` and an early not-a-fast-forward refusal, `land` retries a lock release that failed on the network | queue item 1 after seed test (HANDOVER 17:55); started 2026-11-01 18:20 |
| `slice-2-functions.md` | the function paths: save, publish, lead-update, add-lead, upload-start, upload-finish (export-published and job-callback with 4.3); `verify` grows one check per wall | released 2026-10-31 06:40 (platform slice 4.2, ab2ed36, on staging); after the key-numbering slice and the model switch |
| `stand-in-flows.md` | the client stand-in flows beyond leads: a content edit and publish as a member, a CRM webhook push, a booking when the add-on exists | slice 2 (publish path) and the `push-lead` function for the CRM part |
| `slice-3-onboard.md` | `onboard`, `offboard`, `drift`, the Cloudflare API calls | build steps 6 and 7 |

Every brief carries, verbatim: the five rules of spec section 5, the gate commands, and the line "anything outside this brief
is a finding you send back, not a fix".
