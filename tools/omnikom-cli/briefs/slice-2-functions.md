# Builder brief: omnikom CLI slice 2, the dashboard function paths and their walls in `verify` (CLI department, released 2026-10-31 06:40)

Builder: one sonnet session, this slice only, discarded when done. Head: the CLI and testing department head. Released by the head of
operations after platform slice 4.2 (commit ab2ed36): `save`, `publish`, `lead-update`, `add-lead`, `upload-start`, `upload-finish` are
deployed on staging and migrations 9 and 10 are applied. `export-published` and `job-callback` (the runner-facing functions) come with
slice 4.3 and are NOT in this slice. Starts only after the `seed-test-site-and-status.md` slice is committed, unless the head says
otherwise (all three CLI slices touch `test/run.mjs` and `test/mutate.mjs`; one builder per set of files).

## Read first, in order
1. `docs/blueprint/26-PLATFORM-CLI.md` sections 2 (identities), 3 (the commands table, column "Behind it"), 4 (`verify`), 5 (the rules),
   7 (what is built and decided).
2. `docs/blueprint/specs/openapi.json` paths `/save`, `/publish`, `/lead-update`, `/add-lead`, `/upload-start`, `/upload-finish` and their
   schemas: the request bodies and status codes are exact there. `docs/blueprint/07-SPECS.md` section 5 for the error codes.
3. `docs/blueprint/PROGRESS.md` "4.2 dashboard functions: head's verification" (what was observed on staging) and
   `supabase/tests/e2e-functions.mjs` (the platform head's working calls: `callFunction` with `extraHeaders` for the bearer token and the
   publishable `apikey`, one person token per login through `personToken`). Copy its call shape; do not import it.
4. The functions' source under `supabase/functions/<name>/index.ts` and `supabase/functions/_shared/` (read-only: what the models mirror).
5. The CLI: `tools/omnikom-cli/README.md`, `omnikom.mjs`, `lib/fn.mjs`, `lib/identity.mjs`, `commands/content.mjs`, `commands/publish.mjs`,
   `commands/lead.mjs`, `commands/status.mjs`, `commands/verify.mjs` (the `WALLS_WAITING` list), `test/harness.mjs`, `test/run.mjs`, `test/mutate.mjs`.

## Files you may edit (nothing else; a bug anywhere else is a finding you send back, not a fix)
`tools/omnikom-cli/**` (code, tests, fixtures, README). Never `supabase/`, `factory/`, `tools/audit/`, the owner's env file,
`contracts/industry-run/RESULTS.md`. The head writes the spec, the charter, PROGRESS.md and POSITION.md.

## The slice (decided by the head; do not redesign)
1. **`--via function|sql` on `content save`, `publish`, `lead update`, `lead add`, and a new `media upload`.** The default is `function`
   when the target has a functions URL (staging) and `sql` when it has none (the throwaway local cluster serves no functions, so every
   existing db test keeps its meaning). `--via function` on a target without a functions URL is `Blocked` (exit 3) naming the variable;
   `--via sql` keeps the slice 1 path byte for byte. The result data says which path ran (`via: 'function' | 'sql'`).
2. **Function calls** go through `lib/fn.mjs callFunction` with the caller's session token (`personToken`, held in memory, masked in all
   output) as `authorization: Bearer` and the publishable key as `apikey`, the body exactly the openapi schema:
   - `content save` calls `save` with `{ workspace, collection, row, data, signOff? }` (`row: null` for a new row); 200 gives `{ row, version }`.
   - `publish` calls `publish` with `{ site, rows, versions }`; 202 gives the job id and `state: queued`; print `dispatched` as the function
     says it (no workflow listens until 4.4, so a job stays queued; that is expected, not a failure).
   - `lead update` calls `lead-update` with `{ lead, status }` (204); `lead add` calls `add-lead` with the openapi body (201, `lead` id).
   - `media upload --as <person> --workspace <ws> --file <png>` calls `upload-start` (200, `path` under the workspace, signed `uploadUrl`),
     PUTs the bytes to the signed URL, then `upload-finish` (200, `processed` stays false). The signed URL is a secret: it never appears
     in output (`lib/redact.mjs` must mask it; a test asserts it, watched red first).
   - A function's error answer becomes the CLI's usual failure with the function's status and code in the data; exit 1.
3. **`verify --only functions`, a new suite** (one PASS/FAIL line per check on stderr, exit 1 on any FAIL, the pattern of the other suites),
   plus the three walls that wait in `WALLS_WAITING` moved into the suite they belong to, each the moment it runs (the list never grows):
   - save by owner-a: 200 with a version; save by `nobody`: 404 `S-NOT-FOUND` and the answer names no field (send an unknown field and
     assert its name is absent); save by member-a1 into a row it does not own: the function's refusal code; an invalid row: 422 with `I-*`.
   - publish by owner-a: 202 and `queued`; **member A1 publishes A2's listing: `S-OWN-ONLY`** (moves out of waiting).
   - add-lead by owner-a: 201; **a member adds a lead for someone else: the stored lead is forced to the member** (read back with a count
     or the lead's owner; moves out of waiting); every lead the suite adds is deleted again through `lead delete`, and the suite ends
     with a check "0 leads left" as `verify --only people` does.
   - **member A1 updates A2's lead: 404 `S-NOT-FOUND`** (moves out of waiting); lead-update by the owner: 204.
   - upload-start by owner-a: 200, path under workspace A; upload-start by `nobody`: 404; upload-finish: 200 and `processed` false.
   - a call with no token: **assert the status 401 only, not the code** (staging's gateway answers `UNAUTHORIZED_NO_AUTH_HEADER` before the
     function runs; the in-code `S-AUTH` is proven locally by the platform department).
   Write in the suite's header what it leaves on staging on purpose (saved versions, queued jobs, unprocessed media rows) and print it as
   INFO lines; leads are the one thing it must not leave.
4. **`status` and disabled function folders: moved to the seed-test slice** (Part 2 there, 2026-10-31 11:05); nothing here.
5. **Models in `test/harness.mjs`** for the six functions read the same tables and service functions the real ones read (the slice 1
   lesson: a model that checked keys in memory hid a real bug for a day). Each new rule has a test watched red and a mutant.
   Model flags so the suite proves `verify` catches a broken function: a save that leaks a field name to an outsider, a publish that
   lets a member publish another's row, an add-lead that does not force the member, a lead-update that lets A1 touch A2's lead.

## Findings from the platform head, already decided
- The save body carries the claims as an object (the function builds them from the token; the CLI never sends claims on the function
  path). The `{ workspace, collection, row, data, signOff }` bodies match the openapi schemas: use them as they are.
- `test: not deployed` in `status` is item 4 above. The 401 code on staging is item 3's last line.

## Tests and mutants (`test/run.mjs`, `test/mutate.mjs`)
The unit section for `--via` and the request shapes (a fake fetch records the body and headers: the token and key never in output, the
body equal to the schema's fields); the db section for the models against the throwaway cluster; `verify --only functions` against the
models: every check PASS, and each model flag makes its check FAIL and the suite exit 1. Mutants (suite as fits, text occurring once):
`--via` default forced to `function` on a target without functions; the signed upload URL not redacted; each moved wall's check removed;
the 401 check accepting any status. Then `node tools/omnikom-cli/test/mutate.mjs`
until `0 survived, 0 target text missing` (the full run takes over an hour under load; run it in the background).

## Gates (run all, paste the real last lines in your report)
```
node tools/omnikom-cli/test/run.mjs                 ends "OK: N of N checks passed", exit 0
node tools/omnikom-cli/test/mutate.mjs              ends "N mutants, N caught, 0 survived, 0 target text missing", exit 0
node docs/blueprint/specs/run-all-gates.mjs         passes (a TIMEOUT line is the runner's limit, not a test failure: say which)
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs status --target staging
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs verify --only functions --target staging
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs verify --only walls --target staging
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs verify --only people --target staging
```
Each staging command runs ONCE, after the local gates are green. Not `verify --only lead` and not `lead send` (they send real alert
emails; nothing in this slice may send one: `add-lead` does not alert, check that in its source before the run and say so in the report).
Not `seed test --clean` on staging.

## The five rules of the spec's section 5 (binding)
1. Secrets by name only and never in output; a test asserts it.
2. Production refused for everything but `status` and `apply --i-mean-production`.
3. Fixtures synthetic; `--real` for anything else.
4. Every command idempotent where a retry is possible.
5. No dependencies; Web Crypto, psql, fetch only; tests and mutants, with the hygiene and production guard watched red first.

## Also binding
- Keys by variable name only through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- <cmd>`: never print, copy, store or
  list a value; never list that folder.
- No em dash character in any file. Scripts in files, never inline `node -e`. Long commands in the background.
- Mechanical runs (the suite, the mutants, the gates, grep and listings, the staging commands) go to a haiku agent with the exact command;
  you read the verdict lines back and spend your turns on judgement and code (DECISIONS 34).
- Do not commit; the head re-runs the proof and commits. Leave every file outside the list above alone.
- Report in this shape: PROVEN lines (each gate command and its real last line, every PASS/FAIL line of the staging verify runs), UNPROVEN
  or NOT DONE by name, findings (a function that answers differently from openapi, with the command and the real output).
- Anything outside this brief is a finding you send back, not a fix.
