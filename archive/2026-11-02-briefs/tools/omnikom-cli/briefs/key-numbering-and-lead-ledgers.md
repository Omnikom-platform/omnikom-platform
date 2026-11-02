# Builder brief: `key mint` numbering and env-file rewrite; `verify --only lead` asserts migration 7's ledgers (CLI department, released 2026-10-30 22:40)

Builder: one sonnet session, this slice only, discarded when done. Head: the CLI and testing department head. Source of the two findings:
the step 3 session, `docs/blueprint/PROGRESS.md` heading "Step 3" (read the `key mint` and `security_events` / `consent_ledger` paragraphs
there first, then this file). Spec: `docs/blueprint/26-PLATFORM-CLI.md` sections 3 (key), 4 (verify) and 5 (rules). Starts only after the
`audit-gate-commands.md` slice is committed (both touch `test/run.mjs` and `test/mutate.mjs`; one builder per set of files).

## Files you may edit (nothing else; a bug anywhere else is a finding you send back, not a fix)
- `tools/omnikom-cli/commands/key.mjs`, `tools/omnikom-cli/commands/verify.mjs`
- `tools/omnikom-cli/test/harness.mjs` (the function model only), `tools/omnikom-cli/test/run.mjs`, `tools/omnikom-cli/test/mutate.mjs`
- `tools/omnikom-cli/README.md` (the `key mint` paragraph and the `verify --only lead` check count)
Never `supabase/` (the function `capture-lead/index.ts` and migration 7 are what you mirror, read-only), never `tools/audit/`, never the
owner's env file by hand.

## Part 1: `key mint` numbering and the env file (decided by the head; do not redesign)
What went wrong (PROGRESS.md "Step 3"): after `seed test --clean` the Vault secrets `site-test-demo-*` and the registry rows were gone with
the workspaces, so `key mint` counted `api_keys` rows again, numbered the new keys `-key-1` again with new values, and appended a second
`SITE_SIGNING_KEY_TEST_DEMO_A=` line to the env file under the stale one (`with-env` takes the last line, so it worked by luck).
The rule:
1. The number `n` is one more than the highest existing number for that slug across three places, read before the write:
   the Vault (`select name from vault.secrets where name like 'site-<slug>-key-%'`, inside the same read the command already makes; absent
   Vault counts as nothing), the registry (`api_keys.vault_ref` for that site, revoked rows included), and the env file's own record line
   `# site-<slug>-key-<n>: ...` (the comment `key mint` writes). The env file is the one place that survives `seed test --clean`, which is
   why it is part of the rule. A fresh env file, an empty Vault and an empty registry give `-key-1`. `--n` still overrides, as today.
2. The env file holds exactly one record line and one value line per variable: `# site-<slug>-key-<n>: lead signing key for site <id>
   (minted <date>; set it on the Pages project as SITE_SIGNING_KEY)` then `SITE_SIGNING_KEY_<SLUG>=<value>`. A mint REWRITES the file:
   every earlier `# site-<slug>-key-` line and every earlier `SITE_SIGNING_KEY_<SLUG>=` line for that slug is removed (duplicates
   included), the two new lines go where the first removed line was (or at the end, with one blank line before, when there was none),
   every other line of the file stays byte for byte, the line ending of the file is kept (CRLF stays CRLF). Write with a temp file in the
   same folder and a rename, so a crash never leaves a half-written env file. The registered secret value never appears in output.
3. The Vault write stays as it is (`vault.create_secret` with the new unique name); a name collision in the Vault is reported as the
   SQL error it is (exit 1), never retried with another number silently.

## Part 2: `verify --only lead` asserts the ledgers migration 7 added (read-only counts, the pattern of the alert check)
- A refused signature (the existing checks "B's key on A's site", "a garbled signature", "a request without a signature", "a signature
  older than 301 s") each add one `security_events` row with `kind = 'bad-signature'` and `site_id` = the site: count before and after
  each refused request, assert the delta is exactly 1 (a check per refusal kind is too many; one check "each refused signature is recorded
  once" that sums the four deltas and expects 4 is enough, with the deltas in the detail).
- The paused site now answers 409 (`S-SITE-PAUSED`; was 500): tighten the check to `409 and 0 rows` and add one check that the refusal
  recorded one `security_events` row with `kind = 'suspended'` for that site.
- An accepted lead has exactly one `consent_ledger` row (`lead_id` = the stored lead's id, found through the idempotency key); a retry with
  the same idempotency key adds none (count stays 1). Two checks.
- The function model in `test/harness.mjs` must do what `supabase/functions/capture-lead/index.ts` does for these: record a
  `service.record_security_event(...)` row on every refusal with the function's kinds and codes, answer 409 for a paused site, and store
  leads through `service.capture_lead` (which writes the consent ledger itself in migration 7: check that in the migration, do not write the
  ledger from the model by hand). Add model flags `noSecurityLog` and `doubleConsent` (or the equivalent) so a test proves `verify` catches a
  function that does not record a refusal and one that writes the consent row twice.
- Keep the `waiting` list and every existing check as it is; the suite's new count goes in the README.

## Tests (`test/run.mjs`; the db section has the key mint block at "key mint | list | revoke" and the verify block near the end)
- `key mint` on an env file that already holds two `SITE_SIGNING_KEY_TEST_DEMO_A=` lines and a record line `# site-test-demo-a-key-3: ...`:
  exit 0, the new Vault name is `site-test-demo-a-key-4`, the file holds exactly one `SITE_SIGNING_KEY_TEST_DEMO_A=` line and it is the new
  value, exactly one `# site-test-demo-a-key-` line (`-key-4`), every unrelated line unchanged, the line ending unchanged (test with a CRLF file).
- After `seed test --clean` and `seed test` again, `key mint --site test-demo-a` with the same env file gives `-key-2` (the file remembers
  `-key-1`), not `-key-1`.
- The Vault alone remembering a higher number (insert a `vault.secrets` row named `site-test-demo-a-key-7`, no registry row) gives `-key-8`.
- `verify --only lead` against the model: every check PASS, including the new ledger checks; against the model with `noSecurityLog`,
  the refused-signature check FAILS and the suite exits 1; with `doubleConsent`, the consent check FAILS; a model answering 500 for the
  paused site FAILS the tightened check.
Watched-fail each new check (break what it measures, see the FAIL line name it, restore).

## Mutants (`test/mutate.mjs`; the text occurs exactly once; suite `db` for all of these)
- `key mint` counts registry rows instead of taking the highest number (the old formula back)
- `key mint` ignores the env file's record line when computing `n`
- `key mint` appends instead of rewriting (the removal of earlier lines dropped)
- `verify` does not check the security_events delta; `verify` does not check the consent_ledger count; the paused check accepts any non-202 again
Then `node tools/omnikom-cli/test/mutate.mjs` until `0 survived, 0 target text missing`.

## Gates (run all, paste the real last lines in your report)
```
node tools/omnikom-cli/test/run.mjs                 ends "OK: N of N checks passed", exit 0
node tools/omnikom-cli/test/mutate.mjs              ends "N mutants, N caught, 0 survived, 0 target text missing", exit 0
node docs/blueprint/specs/run-all-gates.mjs         passes
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs status --target staging
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs verify --only lead --target staging
```
The staging `verify --only lead` run is released for this slice: run it ONCE (it sends real alert emails to the seeded address) and paste
every PASS/FAIL line. No `key mint` on staging in this slice: the owner's env file is not a test vehicle; the local tests prove the rule.
Finding to carry in your report: the owner's env file still holds the duplicate `SITE_SIGNING_KEY_TEST_DEMO_A/B` lines from the step 3 run;
the next real `key mint` for those slugs collapses them (the head of operations decides when).

## The five rules of the spec's section 5 (binding)
1. Secrets by name only and never in output; a test asserts it.
2. Production refused for everything but `status` and `apply --i-mean-production`.
3. Fixtures synthetic; `--real` for anything else.
4. Every command idempotent where a retry is possible.
5. No dependencies; Web Crypto, psql, fetch only; tests and mutants, with the hygiene and production guard watched red first.

## Also binding
- Keys by variable name only through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- <cmd>`: never print, copy, store or
  list a value; never list that folder. `lead send` is never looped.
- A model of a platform function reads the same tables and functions the real function reads (the slice 1 lesson).
- No em dash character in any file. Scripts in files, never inline `node -e`. Long commands in the background.
- Mechanical runs (the test suite, the mutants, the gates, grep and listings) go to a haiku agent with the exact command; you read the
  verdict lines back and spend your turns on judgement and code (DECISIONS 34, owner's rule of 2026-10-30 23:25).
- Do not commit; the head re-runs the proof and commits. Leave every file outside the list above alone.
- Report in this shape: PROVEN lines (each gate command and its real last line, the staging verify lines), UNPROVEN or NOT DONE by name, findings.
- Anything outside this brief is a finding you send back, not a fix.
