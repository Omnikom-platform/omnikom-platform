# Brief: client stand-in flows beyond leads (Sonnet builder; one slice, one brief, discarded when done)

Status: WAITING. Released by the head of operations after slice 2 (the `publish` and `save` function paths exist on staging). The
CRM part also needs the `push-lead` function deployed; the booking part waits until a booking add-on exists (step 8, parked) and
is NOT part of this brief until then.

## Read first, in order
1. `CLAUDE.md`, `docs/departments/README.md`, `docs/departments/cli-and-testing.md`.
2. `docs/blueprint/26-PLATFORM-CLI.md` whole (section 1: the CLI mimics every real caller; section 7: slices 1 and 2 as built).
3. `docs/blueprint/15-CRM.md` sections 3, 4 and 7 (what a client does on the Leads and Site screens and which function each
   action traces to), `docs/blueprint/02-BACKEND.md` section 4 (content writes, versions, publish) and the `push-lead` row of
   section 6, `tools/crm-map/README.md` (the CRM field mapping library this department owns).
4. The code: `tools/omnikom-cli/commands/content.mjs`, `publish.mjs`, `lead.mjs`, `verify.mjs`, `test/harness.mjs`.

## The slice: three scripted flows, each a `verify` suite that reads like a client's day
1. `verify --only edit-publish`: member A1 saves a change to a listing (the `save` function), the version appears in
   `content history`, member A1 publishes it (`publish` function, 202 and a job id), the runner stand-in exports it
   (`export --as runner`: the frozen snapshot holds the new version), the runner stand-in calls back `done` (`job callback`),
   the row is live at that version (`content get --published`); then member A2 cannot publish A1's listing (`S-OWN-ONLY`) and a
   second callback `done` on the same job is refused (409). Every write is to workspace A's seeded site, never a client.
2. `verify --only crm-push`: the CLI stands in for the client's CRM: it starts a local HTTP receiver (Node `http`, a random port,
   bound to 127.0.0.1) and registers it as workspace A's webhook integration on staging ONLY if the integration can point at a
   reachable address; if staging cannot reach this machine, the suite instead checks `push-lead`'s outcome rows (`lead_events`
   `pushed` / `push-failed` after the retry ladder) against a deliberately unreachable URL and records the receiver half as
   WAITING with the reason. A pushed payload is mapped through `tools/crm-map/map.mjs` with the `hubspot.json` template and the
   mapped CSV row is checked field by field. No real CRM account is used.
3. `lead day`: one command that runs a client's day on the seeded workspace, printing one line per step: a lead arrives
   (`lead send`, once, real alert email), the owner reads it, hands it to member A1 (`lead update`), A1 closes it, the timeline
   (`lead_events`) shows received, alert sent, assigned, closed in order. This is the demo flow for the owner, not a wall test.
Each suite: one PASS/FAIL line per check, exit 1 on any FAIL, a `waiting` list for what the target cannot do yet (never silent).
Each new rule: a test watched red and a mutant. The harness models of `save`, `publish`, `export-published`, `job-callback`,
`push-lead` read the same tables the functions read.

## Files you may edit
`tools/omnikom-cli/**`, `tools/crm-map/**` (only if a mapping bug blocks the suite; its own tests and mutants must stay green),
`docs/blueprint/26-PLATFORM-CLI.md` section 7, your slice heading in `docs/blueprint/PROGRESS.md`. Nothing else; a bug in
`supabase/` or `factory/` or a deployed function is a finding you send to your head with the evidence, never a fix.

## The five rules of spec section 5 (verbatim)
1. Secrets by variable name only; the CLI never prints, logs or echoes a value, and `--json` output redacts anything that looks
   like a key (a test asserts it).
2. Production is read-only except `apply --i-mean-production`; identity, seed and verify commands refuse a production target
   (a test asserts it with a fake `PROD_DB_URL`).
3. Fixtures are synthetic; a command that would store client data needs an explicit `--real` flag and prints a warning.
4. Every command is idempotent where a retry is possible (`seed test` twice changes nothing; `lead send --retry` stores nothing).
5. No dependencies; Web Crypto for signatures (the same `sign` as the endpoint); `psql` for SQL paths; `fetch` for functions.

## Gates
- `node tools/omnikom-cli/test/run.mjs` ends `OK: N of N checks passed`; `node tools/omnikom-cli/test/mutate.mjs` ends
  `N mutants, N caught, 0 survived, 0 target text missing`; `node tools/crm-map/test/run.mjs` and `test/mutate.mjs` stay green.
- On staging through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs <cmd> --target staging`:
  `verify --only edit-publish` and `--only crm-push` every line PASS, `lead day` every step ok; `lead send` once per run, never looped.
- `node docs/blueprint/specs/run-all-gates.mjs` green. Commit after a clean `gitleaks protect --staged`; push `master` to `backup-gh`.

## Report
Two lines to the head of the CLI department: what is PROVEN on staging (suite and count), what is open or BLOCKED. Outputs into
PROGRESS.md, never into the message. Two failed approaches to one obstacle = BLOCKED with what unblocks it.
Anything outside this brief is a finding you send back, not a fix.
