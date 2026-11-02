# 26 The platform CLI (`omnikom`): the harness sessions test with, the tool staff operate with, the kit sites embed

Written 2026-10-29 with the owner ("a CLI tool that sessions use, calling the database and the same endpoints the websites use,
as the tester for contracts, lead funnels and content pushing"). Scope picked: test harness AND staff tool, never
client-facing. Design here, build by a Sonnet builder session in two slices (section 6).

## 1. What it is in one paragraph
One Node program, `node tools/omnikom-cli/omnikom.mjs <command>`, with no dependencies beyond Node 20+ and `psql` on the path.
It speaks to the platform exactly as the three real callers do: as a website (signed with a site key), as a build runner (signed
with the runner key), and as a signed-in person (a Supabase session token). Every command prints one JSON object, takes an
`--expect` so a mismatch is a non-zero exit, and never prints a secret. A file of commands is therefore a test, and a session
reads results as data, not prose.

## 2. Targets and identities
- `--target staging | local | production`. Reads the connection and keys by variable name from the environment
  (`STAGING_DB_URL`, `STAGING_SUPABASE_REF`, `STAGING_SUPABASE_SECRET_KEY`, `STAGING_SUPABASE_PUBLISHABLE_KEY`, the `PROD_` set,
  or a local URL). Production is refused for every identity, seed and verify command; only `apply --i-mean-production` and
  read-only `status` are allowed there.
- **Person identities (staging and local only):** `--as owner-a | member-a1 | member-a2 | owner-b | staff | nobody`. These are the
  seeded test logins of workspaces A and B (the same fixtures as `tenancy.test.sql`, created once by `omnikom seed test`). The
  CLI mints a session token for them through the Auth admin API with the secret key (UNVERIFIED which admin call gives a usable
  access token without email; candidates: `generateLink` + `verifyOtp`, or a password set on the test users only). The token is
  held in memory for the run, never written.
- **Machine identities:** `--as site:<slug>` signs with `SITE_SIGNING_KEY_<SLUG>` (the same canonical form as
  `factory/worker/lead-endpoint.mjs`); `--as runner` signs with `RUNNER_KEY`; `--as cron` sends `X-Internal-Secret`.

## 3. Commands (what exists behind each, and when it works)
| Command | Does | Behind it | Works |
|---|---|---|---|
| `status` | project reachable, migrations applied (ledger), functions deployed, keys present by name | `platform_migrations`, `check-api-keys` | slice 1 |
| `apply` | applies pending migrations (`apply-staging.mjs` as a library) | exists | slice 1 |
| `test walls` | runs `tenancy.test.sql` on the target (rolled back) | `run-staging.mjs` | slice 1 |
| `seed test` | creates workspaces A and B, their sites, contracts, test logins (staging/local only) | `tenancy.test.sql` fixtures as a script | slice 1 |
| `seed workspace --plan <dir>` | a real client from an approved plan: workspace, site, contract, pages, places (W1.1) | `contracts/from-plan.mjs`, `service.seed_version` | slice 1 (SQL path) |
| `key mint --site <slug>` | site signing key into Vault + registry + the .env by name | `mint-site-key.mjs` | slice 1 |
| `key list / revoke` | the `api_keys` registry, never values | table | slice 1 |
| `lead send --site <slug> --form contact --fixture <file>` | a lead exactly as a website sends it: signed, with idempotency key; `--retry` resends the same key | `capture-lead` function | slice 1 (needs the function deployed) |
| `lead list --as owner-a`, `lead get`, `lead update --status`, `lead add` | what the dashboard will do | `lead-update`, `add-lead` functions (SPEC); until then the SQL service functions over the direct connection with claims (`service.lead_update(claims, ...)`) | slice 1 via SQL, slice 2 via functions |
| `content save --as member-a1 --collection listings --file row.json`, `content get`, `content history` | the content path | `save` function (SPEC); slice 1 via `service.save_as` over SQL | slice 1 via SQL, slice 2 via functions |
| `publish --site <slug> --rows ...`, `job get`, `job wait` | a publish job and its states | `publish`, `job-callback` (SPEC); slice 1 via `service.start_publish` and `set_job_state` | slice 1 via SQL, slice 2 via functions |
| `export --job <id> --as runner` | what the build reads | `export-published` (SPEC) | slice 2 |
| `contract validate --file`, `contract place --rows` | the contract library | `contracts/validate.mjs`, `place.mjs` | slice 1 |
| `verify` | the wall suite over HTTP (section 4) | the functions | slice 1 for the lead function; grows with slice 2 |
| `onboard --slug --domain --pages-project` | the tenant onboarding job (staff): zone, Pages project, variables, key, seed, drift check | Cloudflare API, Supabase | slice 3 (after step 4 of the build sequence) |
Every command: `--expect <http status or S-/B-/M- code>`, `--json` output always, exit 0 on match, 1 on mismatch, 2 on usage,
3 on BLOCKED (missing key by name, target refused). A `--fixture` is a JSON file under `tools/omnikom-cli/fixtures/` (fake
people, example.com addresses, 555 numbers; never client data).

## 4. `verify`: the walls over HTTP (the proof the SQL tests cannot give)
A fixed script of commands with expectations, run against a target where the functions are deployed:
owner B reads A's leads (expect 0 rows), member A1 updates A2's lead (expect S-NOT-FOUND), member A1 publishes A2's listing
(expect S-OWN-ONLY), a lead with an empty consent (expect 400), a lead signed with B's key to A's site id (expect 401), the same
signature replayed after 301 s (expect 401), the same idempotency key twice (expect one row), a lead to a paused site (expect
S-SITE-PAUSED), nobody calls every function (expect 401 or S-NOT-FOUND each), anon calls a service function (expect refused).
Output: one line per check with PASS or FAIL and the real status; exit 1 on any FAIL. This is the acceptance of step 2 and of
every function that lands later; `e2e-lead.mjs` becomes `omnikom verify --only lead` plus `omnikom lead send --site elev8`.

## 5. Rules that bind the tool
1. Secrets by variable name only; the CLI never prints, logs or echoes a value, and `--json` output redacts anything that looks
   like a key (a test asserts it).
2. Production is read-only except `apply --i-mean-production`; identity, seed and verify commands refuse a production target
   (a test asserts it with a fake `PROD_DB_URL`).
3. Fixtures are synthetic; a command that would store client data needs an explicit `--real` flag and prints a warning.
4. Every command is idempotent where a retry is possible (`seed test` twice changes nothing; `lead send --retry` stores nothing).
5. No dependencies; Web Crypto for signatures (the same `sign` as the endpoint); `psql` for SQL paths; `fetch` for functions.
6. Tests: `tools/omnikom-cli/test/run.mjs` (units with a fake fetch and a throwaway local cluster) and `mutate.mjs`; the hygiene
   test (no secret in output) and the production guard are watched red first.

## 6. Build slices
- **Slice 1 (now, Sonnet builder):** the program skeleton, targets, machine identities, `status`, `apply`, `test walls`,
  `seed test`, `key`, `contract`, `lead send` (against the deployed `capture-lead` when staging exists; the fake-fetch tests
  before), the SQL-path `lead`, `content`, `publish`, `job` commands, `verify --only lead`, tests and mutants.
  Done when: tests and mutants green locally; `omnikom status --target local` and `omnikom seed test --target local` work on a
  throwaway cluster; `omnikom lead send --site elev8 --target staging` prints PASS once step 1.1 and step 2 exist.
- **Slice 2 (as the functions land, step 4 of the build sequence):** the function paths for save, publish, export, job
  callback, lead update, add lead; `verify` grows one check per wall.
- **Slice 3 (step 6 and 7):** `onboard`, `offboard`, `drift`, the Cloudflare API calls.
Person identities (section 2) need the staging Auth admin API: UNVERIFIED until step 1.1 exists; slice 1 ships them with a
clear BLOCKED message until then.

## 7. Slice 1 as built (2026-10-30, `tools/omnikom-cli/`, README there)
**Built and proven locally** (`test/run.mjs`: units plus a throwaway-cluster run with a fake fetch; `test/mutate.mjs`: one rule
removed per mutant, all caught): the entry and exit codes, targets and the production guard, machine identities and person
claims, `status`, `apply`, `test walls`, `seed test` (twice changes nothing, `--clean`), `seed workspace` (SQL path, from a
`contracts/from-plan.mjs` contract), `key mint|list|revoke`, `contract validate|place`, `lead send|list|get|update|add|delete`,
`content save|get|history`, `publish`, `job get|wait|set`, `verify --only lead`. The five rules of section 5 each have a test
watched red and a mutant.
**BLOCKED / UNPROVEN until the staging project exists:** (1) person TOKENS for the HTTP path (`lib/identity.mjs personToken`;
which Auth admin call returns one is UNVERIFIED); (2) everything that talks to the DEPLOYED `capture-lead` (`lead send`,
`verify`, the functions column of `status`): proven only against a MODEL of the function over a fake fetch, not the function;
(3) `seed test` inserts `auth.users` by `(id, email)`: UNVERIFIED on Supabase; (4) `key mint` against the real
`vault.create_secret` (a model is used locally); (5) slices 2 and 3.
**Decided where the spec was silent:** default target is `local`; production runs only `status` (connection opened read-only) and
`apply --i-mean-production`, everything else is refused with exit 3 before anything is spawned (stricter than "identity, seed
and verify"); `--expect` compares the result `code` (HTTP status, platform code such as `S-NOT-FOUND`, or `ok`); output is always
JSON (`--json` only makes it one line); on the SQL path a person is the JWT claims given to `service.*` (reads run as
`authenticated`, so RLS decides); `cron` signs nothing and sends `CRON_SECRET` as `X-Internal-Secret`; `--site` is a uuid, a
`SITE_ID_<SLUG>` variable, or a workspace slug / deploy target looked up in the database, and the key variable is
`SITE_SIGNING_KEY_<WORKSPACE SLUG>`; `lead send --retry` sends the same key twice and counts rows (must be 1); added
`seed test --clean` (the walls test and the seeded fixtures cannot share a database), `lead delete`, `job set` (the runner's
stand-in on the SQL path), and `key mint` numbers its keys itself (rotation); `status` "keys present" lists the TARGET's
variable names as booleans (not the research-key check); a fixture outside `fixtures/` or with a real-looking email or phone
needs `--real`. `apply` and `test walls` run the existing scripts as child processes (they are scripts, not libraries).
**Finding for the function (not changed here):** `capture-lead` answers a paused site with a generic 500 (the catch-all), so the
S-SITE-PAUSED code of section 4 is not visible over HTTP; `verify` checks "not 202 and nothing stored" and prints the real status.
**Verified by the lead session 2026-10-30** (`test/run.mjs` 138 of 138, `test/mutate.mjs` 61 of 61 caught, `status --target
staging` against the real project: 5 migrations applied, `capture-lead` deployed, keys present by name). Second finding, FIXED
the same day: a retried submission made the function alert the client twice (`sendAlert` ran after `service.capture_lead`
returned the existing lead id; `service.record_message` has no per-lead dedupe). The function now skips the alert when a
`messages` row (that lead, template `new-lead`) exists; `verify` gained check "a retry sends no second alert" (11 checks), the
test model records alerts like the function (`doubleAlert` = the bug, caught by the suite), and a mutant removes the check.
**Part 2 (2026-10-30, after migration 6):** `verify --only walls` exists (anon callers of the Data API; 5 checks, proven on staging).
Person tokens over HTTP are BLOCKED: the seeded `auth.users` rows have `aud`, `role`, `instance_id` and the token columns null, so
GoTrue cannot find them (`generate_link` 500 `users_email_partial_key`; admin `PUT /users/<id>` 404 `user_not_found`). The two
candidate calls named in section 2 are therefore both refused as things stand; unblock = `seed test` writes GoTrue-shaped rows.
**Part 2, resolved (2026-10-30 19:30, lead decision):** `seed test` now writes the six test logins (the five plus `nobody`, same ids and
emails) the way GoTrue reads them, and repairs the rows an earlier seed left; with them, the first candidate of section 2 works:
Auth admin `generate_link` (magiclink) then `/verify` with the `hashed_token` returns a session (proven on staging; held in memory,
masked in all output). `staff` reaches aal2 through the Auth MFA API (`omnikom mfa enroll-staff` enrolls a TOTP factor once; the secret
is `TEST_STAFF_TOTP_SECRET` in the env file, the code is computed in the CLI). `verify --only people`: 15 checks over the Data API with
those sessions (owner B reads A's leads: 0 rows, member A1 sees only their own, nobody sees none, keys hidden from owners and members,
staff see leads and keys only at aal2, an owner cannot update a lead status directly, a login calling a service function is refused).
Still waiting for the slice 2 functions: member A1 updates A2's lead, member A1 publishes A2's listing, add-lead by a member.
**Slice 1 closed (2026-10-30 20:30, CLI department head, own re-run of commit 82bc2f8):** on staging `status` green (6 applied,
`capture-lead` deployed), `verify --only lead` 12 of 12, `--only walls` 5 of 5, `--only people` 15 of 15, 0 leads left; locally
`test/run.mjs` 168 of 168 and `test/mutate.mjs` 83 of 83 caught. Everything in sections 2, 3 and 4 that does not need a slice 2 or 3
function is now PROVEN over HTTP against the real project. Known and accepted: a paused site answers 500 (S-SITE-PAUSED not visible;
`verify` checks "not 202 and nothing stored"); `mfa enroll-staff` removing a stale factor ran only against the model. Builder briefs
for the next slices live in `tools/omnikom-cli/briefs/` (slice 2 waits for build step 4; the stand-in flows wait for slice 2 and
`push-lead`; slice 3 waits for steps 6 and 7).

**Audit and gate commands (2026-10-31 04:40, CLI department head; builder brief `tools/omnikom-cli/briefs/audit-gate-commands.md`, the
SEO department's command brief `tools/audit/briefs/slice-3-cli-command.md`):** `omnikom audit --dir <built folder> [--only <ids>]` and
`omnikom gate --dir <built folder>` are thin calls into `tools/audit/index.mjs` (`commands/audit.mjs`, imported through `importRepo`, so the
mutation runner's temp copy still finds the engine). Neither has a target (`--target` is usage; `ctxUsesTarget` leaves them out); `--dir`
is required and must be a folder (exit 2); `--expect` is refused on both (a verdict that can be told to match a failure is not a gate);
`--only` on `gate` is usage (fewer rules is a weaker gate); an empty `--only` is refused by the CLI itself (and, since 2026-10-31, by the
engine too). Exits: 0 pass, 1 any FAIL, 2 usage or a crash (`AUDIT-CRASH`: the engine's `AuditError` passes through as usage with its
message; any other throw, a malformed result, or a result that says pass while a line says FAIL, is a crash; a crash is never 0 or 1).
Text mode (default) prints the engine's lines unchanged, then `audit: <pages> pages, <rules> rules, <fails> FAIL, <warns> WARN, <skips>
SKIP`, or `GATE PASS <pages> pages, <rules> rules` / `GATE FAIL <n> finding(s)` plus the FAIL lines; every line goes through `redact`;
`--json` gives the usual envelope (`gate` data: `pass`, `exit`, `fails`, `pages`, `rules`). A library can be injected through `deps.auditLib`
for the crash tests. PROVEN by the head's own Haiku re-run (verbatim lines in PROGRESS.md "CLI: audit and gate commands"): `test/run.mjs`
213 of 213, `test/mutate.mjs` 110 of 110 caught, the six command runs on `tools/audit/fixtures/good` and `bad-MET-003` at the engine's
17 rules (the tests take the page and rule counts from the engine, not from literals: the SEO department adds rules without touching
this file). Known: one run of the suite under load showed the flaky privacy-requests wall of `supabase/tests/tenancy.test.sql` (the head
of operations' finding of 01:40), not a CLI check; the same suite passed as the mutants' baseline minutes later.

**Key numbering and the lead ledgers (2026-10-31 12:40, CLI department head; builder brief
`tools/omnikom-cli/briefs/key-numbering-and-lead-ledgers.md`):** `key mint` numbers a new key as one more than the highest number found
across the Vault names, the registry (`api_keys.vault_ref`, revoked rows included) and the env file's record line for the variable; a
database without the Vault counts the Vault as nothing; `--n` still overrides, and a Vault name that already exists is the SQL error (exit 1,
nothing written). A mint rewrites the env file: one record line and one value line per variable, the two new lines where the first removed
line stood (or at the end after one blank line), every other line byte for byte, the file's own line ending kept, written through a temp
file and a rename. `verify --only lead` has 16 checks: the four refused signatures each add exactly one `security_events` row, a paused site
answers 409 with no lead and one `suspended` event, an accepted lead has exactly one `consent_ledger` row and a retry adds none. The
function model in `test/harness.mjs` records security events with the function's kinds and codes and answers 409 for a paused site
(broken-model flags `noSecurityLog`, `doubleConsent`, `pausedAs500`). The local suite empties both append-only ledgers on its throwaway
cluster before the walls re-run (`session_replication_role = replica`, `test/run.mjs`), because the walls file counted events for the
test site's id. PROVEN by the head's own Haiku re-run (lines in PROGRESS.md "CLI: key numbering and lead ledgers"). Not watched failing:
"the minted values are printed nowhere" (the redaction layer masks a leak before the check can see it).

**Tools and local CI (2026-10-31 18:30, CLI department head; builder brief `tools/omnikom-cli/briefs/tools-and-ci.md`, DECISIONS 42):**
`tools/omnikom-cli/tools.json` pins actionlint 1.7.12, gitleaks 8.30.1, deno 2.8.1 and shellcheck 0.11.0 (version, release date, repo,
per platform url, size and sha256 from the GitHub API digest) and node 24.22.1 (checked, never downloaded). `omnikom tools ensure
[--only]` downloads into `.tools/` only an asset of the pinned release URL that is at least 7 days old, refuses a size or sha256 that
differs (the file is deleted), unpacks with the system tar and writes a `.ok` record with the executable's hash; `tools list` shows
what is pinned and installed. `omnikom ci [--job] [--root] [--install]` runs the jobs of `.github/workflows/ci.yml` on this machine
with the pinned tools from `.tools/bin` (actionlint gets the pinned shellcheck), each `run: node ...` line as written, and refuses a
ci.yml step or key it does not model (so a change to ci.yml turns the cli job red until `commands/ci.mjs` maps it). A unit test
holds ci.yml's actionlint, gitleaks and shellcheck version, URL and sha256 equal to the manifest's. `omnikom publish` of a row that
fails the publish-ready wall (migration 11) answers `I-NOT-READY` with the row id and the first missing path; a test pins it.
PROVEN offline (PROGRESS.md "CLI: tools and local CI"). NOT DONE here: the real downloads and the real `omnikom ci` (the head of
operations runs them in its session, where the owner said yes).

**Small CLI fixes (2026-11-01 evening, CLI department head; builder brief `tools/omnikom-cli/briefs/small-cli-fixes.md`):** (a) after master holds
the commit, `land` brings THIS checkout's local `master` to it when that loses nothing and touches nothing else: the local master is an
ancestor of the commit, no path of `git diff --name-only --no-renames <local master> <commit>` is staged, modified or untracked here
(`git status --porcelain -z -uall`, a rename or copy entry read with both paths), and master is not checked out in another worktree
(an addition: `update-ref` there would leave that worktree's index behind). Checked out here: `git merge --ff-only` (git's refusal is
reported, never forced); otherwise `git update-ref refs/heads/master <sha> <old>` (the old value as a lease). Output
`land: the local master of this checkout moved <old>..<sha>` or `... was not moved: <reason>` (ten paths at most, then `+N more`); a
skipped or failed move never changes the exit code (`data.localMaster`: moved, contains, none, not-moved). (b) A red run in which EVERY
failed job has zero steps (GitHub did not start them: the Actions minutes or the spending limit) gets one more line after the red lines,
`ci: no job ran a step; GitHub says: <first annotation message>` (one `gh api repos/<repo>/check-runs/<job id>/annotations` call; a fallback
line when it fails or has no message); land and the pre-push hook both show it; the verdict stays red. (c) `audit` and `gate` take
`--target preview|production`: for these two commands only, `--target` is the BUILD target the engine's ENV-001 judges (it replaces
"takes no --target"; any other value is usage, exit 2), passed as `{ target }`; `lib/target.mjs` exempts exactly these two commands from the
production guard (`BUILD_TARGET_COMMANDS`; `PRODUCTION_ALLOWED` is unchanged); the result still shows no environment target. (d) `land` waits in
line for a held lock (`--lock-wait-minutes`, default 30, `0` refuses at once, max 180; the holder is printed once and again when it
changes; the 90 minute stale rule is unchanged), and right after taking the lock it fetches master: a commit already in master finishes
there (no ci wait), a master that is not an ancestor of the commit is refused at once (`not a fast-forward: rebase onto master <short> and
push it again`); the post-ci check stays. (e) The release of the lock retries a delete that failed on the network (up to three tries, 10 s then 30 s through `ctx.sleep`; seen 2026-11-01 19:14, `Failed to connect to github.com:443 after 21179 ms` left a lock held after a green land); a lease refusal is never retried; the warning says how many tries were made. Tests: `test/run.mjs` and `test/impact-stamp-hooks.mjs` (fake gh learned `steps`, `databaseId`
and the annotations call), 27 new mutants tagged `[small-fixes]` in `test/mutate.mjs`.

**`omnikom test journey --target staging` (2026-11-01 20:30, CLI department, builder BUILDER_cli-and-testing_journey; plan `tools/omnikom-cli/briefs/journey.md`, DECISIONS 48):**
`commands/journey.mjs` (the `STEPS` table is the one place a slice adds its step, plan section 8) and `lib/browser.mjs` (Edge or Chrome headless over the DevTools protocol, Node's WebSocket, no dependency; started through `tools/proc-guard` `guardedTemp('omnikom-jb-')`, killed with its tree and folder on every path, retried until the folder is gone). One line per step: `PASS`, `FAIL`, `BLOCKED`, `NOT BUILT YET`, `SKIPPED (after Jn FAIL)`; exit 0 only when no step FAILED or was BLOCKED; NOT BUILT YET is never counted as a pass. J1 `seed test`; J2 owner-a and member-a1 each read exactly their own workspace; J3 the dashboard's publish test by exact title (`NOT BUILT YET` only when `apps/dashboard/tests/site.spec.ts` is absent from the tree; a present file without the title is a FAIL); J4 phone 390x844 and desktop 1536x730 of `/` and `/contact/` on the preview (HTTP 200, `x-robots-tag: noindex, nofollow`, 0 console errors, 0 uncaught exceptions, no sideways scroll, 4 PNGs); J5 a visitor's submit of the `/contact/` form and the lead row read back; J6 the dashboard live-lead test by exact title plus a PNG of owner-a's Leads listing the lead; J7 `lead-export` holds it (both use J5's lead, or, when J5 stored none, ONE lead made by `lead send` and say so in their lines: head's ruling 21:35, a product bug at J5 must not leave them unproven); J8 and J9 NOT BUILT YET (no sink we own, webhook out to build). Safety: staging only (any other target is BLOCKED, production refused by the guard), J5 and J6 need `--alert-to` and read the test site's `lead_alert_to` back, which must be exactly that address, before anything is sent; the dashboard specs need `apps/dashboard/node_modules` (the journey builds `dist/` against staging first). The two dashboard titles are checked verbatim by the CLI suite (a rename turns it red); a Playwright report with 0 tests, a skipped test, another test or a flaky one is a FAIL.
Proof: CLI suite 614 of 614 (unit 63 checks of them in `test/journey.mjs`, browser tests against a fixture site in the real Edge: planted console error, uncaught exception, sideways scroll, missing header, 404, form submit, 400 answer, "sent" with no row, PNG files, no browser or profile folder left); 23 mutants of the journey all caught (`mutate.mjs --only journey`, J3 "runner ignores the dashboard result" named by DECISIONS 48 among them). Staging, one full run on master 9800616 (`--alert-to <our own address, the one staging already held>`):
```
J1 PASS accounts: seed test ok, changed=false, contract v2, 14 rows, 6 logins
J2 PASS sign-in: owner-a minted a session and reads exactly 1 workspace (its own); member-a1 minted a session and reads exactly 1 workspace (its own)
J3 PASS edit and publish: dashboard test passed: "the publish sheet: the progress comes in live, the job ends done, the preview shows the new heading" (48.7 s)
J4 FAIL published site renders: phone /: 1 console error(s), first: network https://preview.test-site-demo-a.pages.dev/favicon.ico: Failed to load resource: the server responded with a status of 404 ()
J5 FAIL lead through the site form: the form answered HTTP 400 "{"sent":false,"problems":[{"code":"BODY","path":"","msg":"Send the form as JSON."}]}"; lead rows with the marker: 0
J6 SKIPPED (after J5 FAIL) lead in the inbox
J7 SKIPPED (after J5 FAIL) export
J8 NOT BUILT YET CRM "send a test": no sink we own (crm-test refuses loopback; supabase/functions/crm-test/index.ts)
J9 NOT BUILT YET lead pushed to the CRM: "Webhook out" is TO BUILD (planning/REQUIREMENTS.md:44,155)
journey (staging): 3 PASS, 2 NOT BUILT YET, 2 FAIL, 2 SKIPPED
```
Both FAILs are product findings sent to their owners, not fixed here: J4 the published site has no `/favicon.ico` (a console error on the first view of each browser); J5 the site's own form posts urlencoded to `/api/lead` and `factory/worker/lead-endpoint.mjs` answers 400 "Send the form as JSON" (the published page carries no form script), so no lead ever arrives from a real visitor. Repair run `--only J6,J7` (21:42, one alert to our own address from `lead send`, one from the dashboard test):
```
J6 PASS lead in the inbox: dashboard test passed: "owner-a has Leads open; a lead sent to the test site the way omnikom lead send does appears without a reload w" (8.8 s); the inbox of owner-a lists "Journey 8c12816a lead send" (lead from lead send: J5 did not store one) | png: <shots>/j6-inbox-owner-a.png
J7 PASS export: lead-export as owner-a: HTTP 200, 1 data line(s), the marker lead is in it (lead from lead send: J5 did not store one)
journey (staging): 2 PASS, 0 NOT BUILT YET, 0 FAIL; not run: J1, J2, J3, J4, J5, J8, J9
```
Still UNPROVEN on real staging: J6 and J7 on a lead that J5 itself stored (J5 fails on a product bug), and the J3 pass shows the previous edit's heading still live on the preview (`5.4 flows ... live`).
