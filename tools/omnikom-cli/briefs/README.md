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
| `seed-test-site-and-status.md` | `seed test` seeds the test site's contract version 2 and every row of `sites/test-demo-a/rows.json` (references resolved, team rows with slug and role, repair by a new version); `status` shows the `omnikom_fn` role and the migration counts | released 2026-10-31 03:10 (slice 4.1 PROVEN, c1258dc); after the two slices above (shared test files) |
| `slice-2-functions.md` | the function paths: save, publish, export-published, job-callback, lead-update, add-lead; `verify` grows one check per wall | build step 4 (platform department deploys the functions to staging) |
| `stand-in-flows.md` | the client stand-in flows beyond leads: a content edit and publish as a member, a CRM webhook push, a booking when the add-on exists | slice 2 (publish path) and the `push-lead` function for the CRM part |
| `slice-3-onboard.md` | `onboard`, `offboard`, `drift`, the Cloudflare API calls | build steps 6 and 7 |

Every brief carries, verbatim: the five rules of spec section 5, the gate commands, and the line "anything outside this brief
is a finding you send back, not a fix".
