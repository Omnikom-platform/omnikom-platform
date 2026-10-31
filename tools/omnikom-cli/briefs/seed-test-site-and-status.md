# Builder brief: `seed test` seeds the test site's contract (version 2) and its rows from `sites/test-demo-a/`; `status` shows the function role and the migration counts (CLI department, released 2026-10-31 03:10)

Builder: one sonnet session, this slice only, discarded when done. Head: the CLI and testing department head. Released by the head of
operations after build step 4 slice 4.1 (the factory core) was PROVEN and committed (c1258dc): `sites/test-demo-a/contract.json` and
`rows.json` are final (the platform head's word; the head of operations' own Haiku re-run matched). Spec: `docs/blueprint/26-PLATFORM-CLI.md`
sections 3 (seed, status) and 5 (rules); the export shape the rows must end up matching is `factory/README.md` section 1 and the generator
`factory/test/make-export.mjs` (read both first). Starts only after the `key-numbering-and-lead-ledgers.md` slice is committed (both touch
`test/run.mjs` and `test/mutate.mjs`; one builder per set of files).

## Files you may edit (nothing else; a bug anywhere else is a finding you send back, not a fix)
- `tools/omnikom-cli/commands/seed.mjs`, `tools/omnikom-cli/commands/status.mjs`
- `tools/omnikom-cli/test/run.mjs`, `tools/omnikom-cli/test/mutate.mjs`
- `tools/omnikom-cli/README.md` (the `seed test` row and the `status` row of the command table)
Read-only: `sites/test-demo-a/` (the platform department's; a mismatch between the files and what the database accepts is a finding),
`contracts/validate.mjs` (import it through `importRepo`, as `seed workspace` already does), `factory/`, `supabase/` (migration 1's
`service.seed_version`, migration 8's `omnikom_fn` role and the `ops.platform_migrations` ledger are what you read).

## Part 1: `seed test` seeds the test site (decided by the head; do not redesign)
Today `seed test` gives workspaces A and B contract version 1 (`contract '{}'`, `resolved` = `TEST_CONTRACT`, the text of `tenancy.test.sql`)
and two team rows for A, `{"name":"Agent One"}` and `{"name":"Agent Two"}`, linked to members A1 and A2. Finding from the platform head
that this slice closes: those team rows have no `slug` and no `role`, and the contract requires both at publish.
1. **Workspace A gets contract version 2** = `sites/test-demo-a/contract.json` as `contract`, `mergeCore(contract)` as `resolved`
   (`validateContract` must report no problem; a problem is a finding, with the codes, not a fix), `active = true`, `created_by` = the
   staff login; version 1 becomes inactive. Same shape as `seed workspace` writes. Idempotent the way `seed workspace` is: when the
   active contract already equals the file's JSON, nothing is written; when the file changed, the next version number is written and
   the old one goes inactive (`audit_log` action `seed-contract`, target `test-demo-a`). **Workspace B keeps version 1** (`TEST_CONTRACT`):
   the unit test "the contract is the one in tenancy.test.sql" and the staging `people` and `walls` checks stay as they are.
2. **Rows for A come from `rows.json`**, every row of it, in this order (references point backwards): `settings`, `team`, `areas`,
   `notices`, `pages`, `listings`. Created through `service.seed_version(ws, collection, data, staff, SEED_REF)` (the admitted path; it
   writes `content_rows`, version 1 and the audit line), ids database-generated. A row is found again by its key: `data ->> 'path'` for
   `pages`, `data ->> 'slug'` for `team`, `areas`, `notices` and `listings`, the one non-deleted row for the singleton `settings`.
3. **References are resolved at seed time**: a value `ref:<id>` in `rows.json` becomes the id of the row seeded for that symbolic id
   (`ref:team-agent-one` = Agent One's `content_rows.id`, so `listings.agent` carries a real row id and `owner_team_row` is set by
   `seed_version`); `ref:media-logo` becomes the id of the one `media` row for workspace A: `path` = `<workspace id>/logo.png` (the table's
   check constraint), width 400, height 400, bytes of `sites/test-demo-a/media/logo.png`, `processed`, `exif_stripped` and
   `rights_confirmed` true, `uploaded_by` = staff; found again by `(workspace_id, path)`, inserted once. The storage object itself is
   not this department's (the platform department puts the file where the runner fetches it); say so in the README row.
4. **Agent Two** is not in `rows.json` (it is the CLI's fixture for member A2, not site content): seed it as
   `{"name":"Agent Two","slug":"agent-two","role":"Agent"}`. Members A1 and A2 stay linked to their team rows as today.
5. **Repair without re-creating**: when a seeded row exists and its latest version's `data` differs from what the file gives (the old
   Agent One without slug and role is the real case on staging), append version `n + 1` with the file's data (`content_versions`:
   `by` = staff, `sign_off` = `{"by": staff, "ref": SEED_REF}`, plus an `audit_log` line action `seed`), never a new row: the row id,
   the members' `team_row_id` and the listings' references survive. A second run finds every latest version equal and writes nothing.
6. **`seed test --clean`** is unchanged (the workspaces go with everything under them; the `media` row goes with its workspace).
   `seed test --clean` then `seed test` restores the test site: same counts, same data, new ids (a test asserts the data, not the ids).
7. Result data gains `testSite: { contractVersion, rows: { settings, team, areas, notices, pages, listings }, media }` (numbers) and
   `changed` keeps its meaning (true when anything was written). Fail loudly (exit 1, the SQL error) on anything `seed_version` refuses;
   never fall back to a partial seed.

## Part 2: `status` shows the function role and the migration counts
- `functionRole: true | false`: `select 1 from pg_roles where rolname = 'omnikom_fn'` (read-only, works on a cluster that never ran
  migration 8). Text line `function role omnikom_fn: present | MISSING`.
- `migrations.onDisk` (files in `supabase/migrations/`) and `migrations.inLedger` (rows in the ledger table, 0 when there is none) as
  numbers next to the existing `applied`, `pending`, `mismatched`, `unknownInDatabase`. Nothing else in `status` changes; `ok` stays
  "no mismatched migration" (a missing role is shown, not a failure: production before migration 8 is not broken by `status`).

## Tests (`test/run.mjs`; the db section has the `seed test: idempotent` block and the `status` block near "status ...T")
- After `seed test`: A's active `site_contracts` row has `version = 2`, `contract` equal to the file (`JSON.stringify` of both parsed),
  `resolved` equal to `mergeCore(file)`; B's active row is still version 1 with `TEST_CONTRACT`.
- Row counts for A: settings 1, team 2, areas 2, notices 2, pages 4, listings 2 (13 rows; the test derives the numbers from `rows.json`
  plus one for Agent Two, not from literals), one `media` row with the facts above.
- The identical-data test: for every row of `rows.json`, the seeded latest version's `data` equals the file's `data` with every `ref:<id>`
  swapped to the id the test looks up itself (by collection and key); the listings' `owner_team_row` is Agent One's row id.
- Idempotent: the table fingerprint (the existing `f1 === f2` pattern) is unchanged by a second run and `changed` is false.
- Repair: append a version with `{"name":"Agent One"}` (no slug, no role) to Agent One's row by SQL, run `seed test`, assert one more
  version exists whose data is the file's, the row id is the same, member A1's `team_row_id` is unchanged, and a further run adds nothing.
- Contract change: alter the active contract's `resolved` by SQL (a spare field), run `seed test`, assert version 3 is active and equals the
  file again; the next run adds nothing.
- `seed test --clean` then `seed test`: the same counts and the same identical-data result.
- `status`: `functionRole` is `true` on the test cluster after the migrations, `false` after `drop role` on a throwaway copy (or against a
  cluster before migration 8); `migrations.onDisk` equals the file count and `migrations.inLedger` equals the ledger row count.
Watched-fail each new check (break what it measures, see the FAIL line name it, restore).

## Mutants (`test/mutate.mjs`; the text occurs exactly once; suite `db`)
- the rows seeded again every run (the find-by-key dropped; caught by the idempotency test)
- the contract seeded as version 1 again (caught by the version test)
- a `ref:` left unresolved (caught by the identical-data test)
- the repair path dropped (caught by the repair test)
- the role check always true (caught by the status test)
- `onDisk` reported as the ledger count (caught by the status counts test)
Then `node tools/omnikom-cli/test/mutate.mjs` until `0 survived, 0 target text missing`.

## Gates (run all, paste the real last lines in your report)
```
node tools/omnikom-cli/test/run.mjs                 ends "OK: N of N checks passed", exit 0
node tools/omnikom-cli/test/mutate.mjs              ends "N mutants, N caught, 0 survived, 0 target text missing", exit 0
node docs/blueprint/specs/run-all-gates.mjs         passes
node factory/test/make-export.mjs --check           "the fixture equals the generator output" (you changed nothing there; it proves the files you read are the committed ones)
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs status --target staging
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs seed test --target staging
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs seed test --target staging      (second run: changed false)
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs verify --only people --target staging
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs verify --only walls --target staging
```
`seed test` on staging is released for this slice (twice, to show idempotency). Not `verify --only lead` (it sends real alert emails and the
previous slice ran it) and not `seed test --clean` on staging (it would drop the keys the owner's env file names).

## The five rules of the spec's section 5 (binding)
1. Secrets by name only and never in output; a test asserts it.
2. Production refused for everything but `status` and `apply --i-mean-production`.
3. Fixtures synthetic; `--real` for anything else (Demo A is an invented business; no client folder is a test vehicle).
4. Every command idempotent where a retry is possible.
5. No dependencies; Web Crypto, psql, fetch only; tests and mutants, with the hygiene and production guard watched red first.

## Also binding
- Keys by variable name only through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- <cmd>`: never print, copy, store or
  list a value; never list that folder.
- No em dash character in any file. Scripts in files, never inline `node -e`. Long commands in the background.
- Mechanical runs (the test suite, the mutants, the gates, grep and listings, the staging commands) go to a haiku agent with the exact
  command; you read the verdict lines back and spend your turns on judgement and code (DECISIONS 34).
- Do not commit; the head re-runs the proof and commits. Leave every file outside the list above alone.
- Report in this shape: PROVEN lines (each gate command and its real last line, the staging lines), UNPROVEN or NOT DONE by name, findings
  (anything the files or the database refused, with the code).
- Anything outside this brief is a finding you send back, not a fix.
