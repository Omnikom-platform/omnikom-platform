# Brief 4.2: the Edge Functions the dashboard calls (Sonnet builder; one slice, one brief, discarded when done)

Written 2026-10-31 00:20 by the head of the Platform build department (session `local_cade0add-3389-4314-b7b5-83333d26a97a`).
You report to that head only (your final message is your report). Anything outside this brief is a finding you send back with
options, never a fix. You edit only: `supabase/functions/**` (except `capture-lead/` and the two existing `_shared/signature.*`
files, which you import), `supabase/migrations/20261031000009_media_and_export.sql` (a NEW file; never an applied migration),
`supabase/tests/tenancy.test.sql` (append a test block T18 only), `supabase/tests/run-local.mjs` (append mutants only),
`supabase/tests/local-shim.sql` (only if the shim lacks something a new function needs; say so), `supabase/config.toml` (new
function entries), `deno.json` (the check task), `tools/deploy-functions.mjs` (NEW: `tools/deploy-capture-lead.mjs` generalised to
`--functions a,b,c`; leave the old file as it is), `docs/blueprint/specs/openapi.json` (the `lead-update` and `add-lead` operations are
missing; add them; keep `node docs/blueprint/specs/check-specs.mjs` green), and your own paragraph under "## Step 4" in
`docs/blueprint/PROGRESS.md`. Never `tools/omnikom-cli/**` (another department; you may IMPORT its modules read-only in tests).
No em dash anywhere. No npm dependency beyond `npm:postgres@3.4.5` already in use (supply-chain rule: pinned). Scripts in files.
Secrets by variable name only; never print a value; never read the folder `creds and accounts login` yourself: staging commands
go through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- <cmd>`, which loads them by name.

## Read first, in order
1. `CLAUDE.md` (rules 2, 3, 7, 9, 11), `docs/departments/README.md` rules 1 to 7, `docs/blueprint/23-GROUND-RULES.md` sections 2, 4.
2. `docs/blueprint/02-BACKEND.md` sections 2, 3, 4, 5, 6 (the function table: caller, steps, fails how), 8 (secret names).
3. `supabase/functions/capture-lead/index.ts` whole (the house style: `handle(req)` exported, `problem()`, `refusal()` mapping SQL
   codes to statuses, `set role omnikom_fn` right after connect, security events on refusals, `sql.end` in finally) and
   `supabase/functions/_shared/signature.ts`, `_shared/contracts.ts`, `supabase/config.toml`.
4. The service functions you call, by signature (grep `create or replace function service.<name>` and take the LAST definition in
   file order): `service.contract_for(p_claims, p_workspace)`, `service.save_as(p_claims, p_workspace, p_collection, p_row, p_data, p_sign_off)`,
   `service.start_publish(p_claims, p_site, p_rows uuid[], p_versions int[])`, `service.lead_update(p_claims, p_lead, p_status, p_owner, p_note, p_unassign)`,
   `service.add_lead(p_claims, p_site, p_name, p_email, p_phone, p_answers, p_consent, p_form, p_owner)`, `service.use_claims`,
   `service.record_security_event` (migration 7 line 48). Read `supabase/migrations/20261030000008_search_path_and_roles.sql` lines
   1 to 60 (the role `omnikom_fn`, the `search_path = ''` style every new function must follow, schema-qualified names).
5. `docs/blueprint/specs/openapi.json`: `SaveRequest`, `SaveResponse`, `PublishRequest`, `PublishResponse`, `UploadStartRequest`,
   `UploadStartResponse`, `UploadFinishRequest`, `Problem`, `FieldProblem`, and `docs/blueprint/07-SPECS.md` section 5 (error codes).
6. `supabase/tests/run-local.mjs` (the throwaway cluster: how it starts, how mutants are listed), `supabase/tests/tenancy.test.sql`
   T16 and T17 (the shape of a test block), `supabase/tests/local-shim.sql` (what of Supabase is modelled locally).
7. `tools/omnikom-cli/lib/identity.mjs` (`PERSONS`, `claimsFor`, `personToken`: how a real person token is made on staging),
   `tools/omnikom-cli/commands/seed.mjs` (`seedTestSql`: the fixtures your local tests seed), `tools/omnikom-cli/lib/fn.mjs`.
8. `factory/README.md` if it exists already (slice 4.1 writes the export shape there; your `service.export_bundle` returns that shape).
9. Supabase facts you rely on (do not re-research; a vendor behaving differently is a finding): a function with `verify_jwt = true`
   receives only requests whose JWT the gateway accepted; the JWT is in `Authorization: Bearer <jwt>`; the project's JWKS is at
   `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (new projects sign with ES256; `SUPABASE_URL` is set in every function);
   Storage signed upload: `POST <SUPABASE_URL>/storage/v1/object/upload/sign/<bucket>/<path>` with the secret key
   (`SUPABASE_SERVICE_ROLE_KEY` is the default name Supabase sets in functions; also accept `SUPABASE_SECRET_KEY`) answers `{ url, token }`;
   the dashboard uploads to `<SUPABASE_URL>/storage/v1<url>`. GitHub dispatch: `POST https://api.github.com/repos/<owner>/<repo>/dispatches`
   `{ event_type, client_payload }` with `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, answers 204.

## What you make, in this order (test first, watched red, then the code)

### 1. `supabase/functions/_shared/db.ts` and `_shared/auth.ts`
- `db.ts`: `connect()` returns the `postgres` client (`max: 1, prepare: false`) and has already run `set role omnikom_fn`
  (fail closed: a failure throws and the caller answers 500 CONFIG); `withDb(fn)` closes it in finally (`end({ timeout: 2 })`).
  `refusal(message)` moved here from the capture-lead pattern and widened: `S-NOT-FOUND` 404, `S-OWN-ONLY` / `S-ROLE` / `S-LOCKED` /
  `S-SIGNOFF` / `S-SEED-ACTOR` 403, `S-SINGLETON` 409, `S-JOB-STATE` / `S-JOB-BUSY` 409, `S-WORKSPACE-STATE` / `S-WORKSPACE-SUSPENDED`
  / `S-SITE-PAUSED` 409, `S-KIND` 422, `S-QUOTA` 429, `S-AUTH` 401, `consent text required` 400 REQUIRED. capture-lead keeps its own
  copy (not yours to edit); say so in the report as a follow-up (one `refusal` in `_shared` later).
- `auth.ts`: `verifyUserJwt(req, { jwksUrl, now, fetchImpl })` -> the claims `{ sub, aal, exp, aud, role, ... }` or null. Verifies the
  signature against the JWKS (ES256 and RS256 through Web Crypto; cache the JWKS in module scope for 10 minutes, refetch once on an
  unknown `kid`), `exp` not passed, `aud` includes `authenticated`, `sub` a uuid. The gateway (`verify_jwt = true`) is the first wall;
  this is the second: a request that reaches the handler with no valid JWT answers 401 `S-AUTH` and records a security event
  `bad-jwt`. Claims handed to SQL are exactly `{ sub, aal, role, email }` and the `aal` value is what `private.is_staff()` reads.
  Tests: a token signed by a generated ES256 key against a JWKS served by the test; a wrong key, an expired token, a wrong `aud`,
  a non-uuid `sub` each refused.

### 2. Migration `20261031000009_media_and_export.sql` (walls first, test T18 red before the file exists)
- `service.record_media(p_claims, p_workspace, p_filename text, p_bytes int, p_mime text)` returns `(id uuid, path text)`:
  member or staff of the workspace or `S-NOT-FOUND`; mime in the five allowed or `I-MEDIA-TYPE`; bytes 1 to 26214400 or `I-MEDIA-SIZE`;
  path = `<workspace_id>/<gen_random_uuid()>.<ext>` (ext from the mime); row inserted with `uploaded_by = sub`, `processed false`,
  `exif_stripped false`, `rights_confirmed false`; audit `media-start`.
- `service.finish_media(p_claims, p_media, p_rights boolean)` returns void: the uploader, an owner or staff of its workspace, or
  `S-NOT-FOUND`; sets `rights_confirmed`; never touches width, height, processed, exif_stripped (those are the processor's: ground rule 11);
  audit `media-finish`.
- `service.media_processed(p_media, p_width int, p_height int, p_exif_stripped boolean, p_bytes int)` returns void: no claims (the
  runner's call, signature verified by the function); sets the facts and `processed = true`; refuses a width below 1 (`I-MEDIA-SIZE`).
- `service.export_bundle(p_job)` returns jsonb: no claims (runner); `S-NOT-FOUND` for no job; `S-JOB-STATE: snapshot not frozen` unless
  `freeze_snapshot` ran; returns `{ job: { id, site_id, workspace_id, snapshot, created_at }, site: { id, deploy_target, preview_host,
  domain, state }, workspace: { id, slug, name, industry }, contract: <active resolved>, rows: [ { id, collection, version, data, at } ] (exactly
  `service.published_rows`, `at` = the version's created_at), media: [ every media row of the workspace, columns id, path, width, height,
  processed, exif_stripped, rights_confirmed ] }`. Nothing of another workspace can appear (T18 asserts B's ids are absent from A's bundle).
- `service.job_site(p_job)` returns `(site_id uuid, deploy_target text)`: for `job-callback` (slice 4.3) to know the site without a table read.
- All five: `security definer`, `set search_path = ''`, schema-qualified names, `grant execute ... to omnikom_fn`, revoked from PUBLIC,
  anon, authenticated (the default privileges of migration 8 close them; T14 proves it: run `run-local.mjs` and read T14's lines).
- T18 in `tenancy.test.sql`: one block, each wall asserted with a raise, plus `run-local.mjs` mutants: one per `raise exception` line and
  per grant (pattern: the existing mutant entries). `node supabase/tests/run-local.mjs` must end `OK: real migration passes; N mutants`
  with N > 161, every one `caught`.

### 3. The functions (each `index.ts` exports `handle(req)`; `if (import.meta.main) Deno.serve(handle)`)
| Function | verify_jwt | Steps | Answers |
|---|---|---|---|
| `save` | true | `verifyUserJwt` -> body `SaveRequest` (shape errors 400 BODY) -> `service.contract_for` FIRST (404 for a non-member, before any field name) -> `validateItem(contract, collection, data, { mode: 'draft', exists, media })` where `exists` and `media` are lookups through the database (`exists`: a row of that collection in the workspace, through a new tiny `service.row_exists(p_claims, p_workspace, p_collection, p_row)`; `media`: through `service.media_facts(p_claims, p_workspace, p_media_id)`; both in migration 9 too, with T18 lines) -> 422 `{ problems }` -> `service.save_as` -> 200 `{ row, version }` | 200, 400, 401, 403, 404, 409, 422 |
| `publish` | true | JWT -> body `PublishRequest` -> `contract_for` (404) -> load each row's pinned version and `validateItem(..., { mode: 'publish' })` -> 422 on any problem (`problems` carry the row id) -> `service.start_publish` -> dispatch `repository_dispatch` `{ event_type: 'publish', client_payload: { job_id, site_id } }` to `GITHUB_REPO` (env, `owner/repo`) with `GITHUB_DISPATCH_TOKEN` -> 202 `{ job, state: 'queued', dispatched: true|false, reason }` (`dispatched: false` with `reason: 'no dispatch token'` or the GitHub status; the job stays queued, the reaper fails it after 24 h: NOT a silent success) | 202, 400, 401, 403, 404, 409, 422 |
| `lead-update` | true | JWT -> body `{ lead, status?, owner?, note?, unassign? }` -> `service.lead_update` -> 204 | 204, 400, 401, 403, 404 |
| `add-lead` | true | JWT -> body `{ site, name?, email?, phone?, answers?, consentText, form?, owner? }` (email format, lengths as capture-lead) -> `service.add_lead` -> 201 `{ lead }` | 201, 400, 401, 404 |
| `upload-start` | true | JWT -> body `UploadStartRequest` -> `service.record_media` -> Storage signed upload URL for bucket `media`, that path -> 200 `{ media, uploadUrl, path }` (413 over the cap, 415 bad mime, before the database) | 200, 400, 401, 404, 413, 415 |
| `upload-finish` | true | JWT -> body `UploadFinishRequest` -> `service.finish_media` -> dispatch `media` `{ media_id, workspace_id }` the same way as publish (`dispatched` reported) -> 200 `{ media, processed: false, dispatched }` | 200, 400, 401, 404 |
Every refusal (401, 403, 404, 409, 422 from a wall) records a `security_events` row through `service.record_security_event` with the
code, the workspace when known, `actor` = sub; validation 422s are NOT security events. Bodies never echo field values back, only
`path` and `code` and plain words (`Problem` / `FieldProblem`). Body cap 256 KiB (413). `cache-control: no-store`.
`supabase/config.toml` gets the six entries (`lead-update`, `add-lead` are new; the others exist with `verify_jwt = true`).

### 4. `supabase/functions/test/run.mjs` (Node) + `supabase/functions/test/*.test.ts` (Deno)
`run.mjs` starts a throwaway cluster the way `run-local.mjs` does (shim + every migration), seeds the CLI's fixtures by importing
`tools/omnikom-cli/commands/seed.mjs` `seedTestSql()` (read-only import) and running it with psql, generates an ES256 key pair, writes
a JWKS file, starts a tiny local HTTP server that serves it and a fake Storage sign endpoint and a fake GitHub dispatch endpoint
(records what it received), then runs `deno test -A supabase/functions/test/` with `SUPABASE_DB_URL`, `SUPABASE_URL` (the fake
server), `JWKS_URL`, `SUPABASE_SECRET_KEY=test-not-a-secret`, `GITHUB_DISPATCH_TOKEN=test-not-a-secret`, `GITHUB_REPO=test/test`
set, and tears everything down. The Deno tests import each function's `handle` and call it with `Request` objects (no network but
the fakes). Checks, each watched red first (comment the line that made it red): save by owner-a 200 then version 2 on a second save;
save by nobody into A = 404 with no field name in the body; member-a1 saving A2's listing = 403 `S-OWN-ONLY`; an invalid row = 422 with
an `I-` code and the `path`; a locked field by owner = 403 `S-LOCKED`; publish by owner-a of a team row = 202 and a `publish_jobs`
row, the fake GitHub received `{ job_id, site_id }`; publish with a version that does not exist = 404 (`S-NOT-FOUND`) or 422 as the
service says (record which); publish without `GITHUB_DISPATCH_TOKEN` = 202 `dispatched: false`; lead-update by member-a1 on A2's lead
= 404 `S-NOT-FOUND`; add-lead by member-a1 lands on member-a1's team row even when `owner` names another; add-lead without consent =
400; upload-start by owner-a = 200 with a path starting `<A>/`, by nobody 404, a 30 MB request 413, `image/gif` 415; upload-finish by
owner-a sets `rights_confirmed` and `processed` stays false; every refused call left a `security_events` row; no JWT = 401 `S-AUTH`;
an expired JWT = 401. Mutants: `supabase/functions/test/mutate.mjs` removes one check per function (the JWT check, the contract_for-first
order, the media lookup, the dispatch, the cap, the mime list, the step-down) from a COPY of the source and requires the Deno tests
to go red; ends `N mutants, N caught, 0 survived, 0 target text missing`.
`deno.json` `check` task lists every function and shared file; `deno task check` clean.

### 5. `tools/deploy-functions.mjs` and the staging proof
`node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/deploy-functions.mjs --functions save,publish,lead-update,add-lead,upload-start,upload-finish [--secrets GITHUB_REPO]`
(the pattern of `tools/deploy-capture-lead.mjs`: `supabase functions deploy <name> --project-ref $STAGING_SUPABASE_REF`, output scrubbed
of the ref and token; secrets set by name from the environment through a temp env file; `GITHUB_REPO=Omnikom-platform/omnikom-platform`
may be passed as `--set GITHUB_REPO=Omnikom-platform/omnikom-platform`; `GITHUB_DISPATCH_TOKEN` is set only if the variable exists in the
environment, else printed as `NOT SET (missing in the env): GITHUB_DISPATCH_TOKEN` and skipped). Before deploying: apply migration 9 to
staging with `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs apply --target staging`
(`--dry-run` first; paste both summaries). Then `omnikom status --target staging` must list the six functions as deployed (paste the line).
Then one real-call proof per function on staging, through a script `supabase/tests/e2e-functions.mjs` (yours) that imports
`personToken` and `callFunction` from the CLI's lib read-only and runs: save by owner-a (200, version n), save by nobody (404),
publish by owner-a of that row (202; read `dispatched` and print it, true or false, honestly), lead-update by member-a1 on a lead
that is not theirs (404), add-lead by owner-a (201) and `lead delete` of it through the CLI afterwards so 0 leads remain, upload-start
by owner-a (200, a path under A) and upload-finish (200). It prints one PASS/FAIL line per check and exit 1 on any FAIL. Leave the
publish job as it is (queued or dispatched: the runner does not exist yet; say which in the report). If `GITHUB_DISPATCH_TOKEN` is
not in the env file yet, `dispatched: false` is the honest expected result and the line says so.

## Gates (paste the real last lines into PROGRESS.md under "## Step 4", sub-heading "4.2 dashboard functions (builder)")
```
node supabase/tests/run-local.mjs                    -> OK: real migration passes; N mutants (N > 161), 0 SURVIVED
node supabase/functions/test/run.mjs                 -> OK: N of N checks passed (the Deno tests), exit 0
node supabase/functions/test/mutate.mjs              -> N mutants, N caught, 0 survived, 0 target text missing
deno task check                                      -> every file checked, no error
node docs/blueprint/specs/check-specs.mjs            -> OK ... 0 problem(s)
node docs/blueprint/specs/run-all-gates.mjs          -> all gates passed   (run in the background; about 15 minutes)
staging: apply --dry-run, apply, status, e2e-functions.mjs: every line PASS (the dispatched line honest)
```
Watched-fail evidence per new wall (one line each). `git status` at the end shows only your files. Scratch output in your scratchpad.

## Report (your last message, two parts)
1. PROVEN / UNPROVEN / NOT DONE per numbered item with the pasted gate line each; the staging `status` line; what state the publish
   job was left in; whether the dispatch happened.
2. Findings outside this brief with options (vendor behaving differently from the facts in "Read first" item 9 is a finding; the
   CLI's slice 2 expectations you noticed; anything in `capture-lead` you would change). Known already, do not repeat: the dispatch
   token is an owner click; `seed test` seeds no pages.
