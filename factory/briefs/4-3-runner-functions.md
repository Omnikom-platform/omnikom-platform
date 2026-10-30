# Brief 4.3: the Edge Functions the build runner calls (Sonnet builder; one slice, one brief, discarded when done)

Written 2026-10-31 00:50 by the head of the Platform build department (session `local_cade0add-3389-4314-b7b5-83333d26a97a`).
You report to that head only. Anything outside this brief is a finding sent back with options, never a fix. You edit only:
`supabase/functions/export-published/`, `job-callback/`, `media-export/`, `media-process-callback/` (all NEW), `supabase/functions/test/**`
(append tests, mutants and fakes; the harness exists from slice 4.2), `supabase/config.toml` (entries), `deno.json` (check task),
`tools/mint-site-key.mjs` (add `--runner`), `tools/deploy-functions.mjs` (only if a flag is missing), `supabase/tests/e2e-export.mjs`
(NEW), `docs/blueprint/specs/openapi.json` (the `Export` schema and the `media-export` operation), `factory/README.md` (the export
shape: add `media[].url` and say the URLs are signed and expire), and your paragraph under "## Step 4" in `docs/blueprint/PROGRESS.md`.
Never a migration (slice 4.2 wrote `20261031000009_media_and_export.sql` with every service function you need; if one is missing,
that is a finding, not a new file). Never `tools/omnikom-cli/**` (import read-only in tests only). No em dash. Scripts in files.
Secrets by name only; staging commands only through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- <cmd>`.

## Read first, in order
1. `CLAUDE.md` rules 2, 3, 7, 9, 11; `docs/departments/README.md` rules 1 to 7; `docs/blueprint/23-GROUND-RULES.md` 2 (rules 3, 4, 5, 7, 11), 4.
2. `docs/blueprint/02-BACKEND.md` sections 4 (freeze_snapshot, published_rows, set_job_state), 5, 6 (the table rows export-published,
   job-callback, media-process-callback), 7, 8; `docs/blueprint/21-PROTOCOLS.md` sections 2, 3, 5.
3. Slice 4.2's code, the house style you continue: `supabase/functions/_shared/db.ts` (`connect`, `withDb`, `refusal`), `_shared/auth.ts`,
   `_shared/signature.ts` (`verify(header, key, method, pathWithQuery, body)`), `supabase/functions/save/index.ts` and
   `publish/index.ts` (how a function is shaped), `supabase/functions/test/run.mjs` (the harness: cluster, fakes, env) and one
   existing `*.test.ts`, `supabase/functions/test/mutate.mjs`.
4. The service functions, last definition in file order: `service.freeze_snapshot(p_job)` (returns the snapshot, moves queued ->
   building, refuses `S-JOB-BUSY` when another build of the site runs, a rerun returns the same snapshot), `service.export_bundle(p_job)`,
   `service.set_job_state(p_job, p_state, p_report, p_deploy, p_error)`, `service.job_site(p_job)`, `service.media_for_runner(p_media)`,
   `service.media_processed(p_media, p_width, p_height, p_exif_stripped, p_bytes)`, `service.record_security_event`.
5. `factory/README.md` (the export shape the runner reads: yours must match it exactly, plus `media[].url`), `factory/briefs/4-4-runner-and-workflows.md`
   item 1 and 2 (what the runner sends you and expects back; the runner builder reads your code, so your shapes win and you write them
   into `factory/README.md`).
6. `tools/mint-site-key.mjs` (how a key is minted into Vault, the registry and the env file by name, never printed),
   `tools/deploy-capture-lead.mjs` / `tools/deploy-functions.mjs`.
7. Supabase facts (do not re-research; a different behaviour is a finding): Storage signed download URL: `POST <SUPABASE_URL>/storage/v1/object/sign/<bucket>/<path>`
   body `{ "expiresIn": 3600 }` with the secret key (`SUPABASE_SERVICE_ROLE_KEY`, also accept `SUPABASE_SECRET_KEY`) answers
   `{ "signedURL": "/object/sign/..." }` to be prefixed with `<SUPABASE_URL>/storage/v1`; signed upload: `POST .../object/upload/sign/<bucket>/<path>`
   answers `{ url, token }`, the client PUTs to `<SUPABASE_URL>/storage/v1<url>`. GET requests have an empty body in the signature canonical form.

## What you make, in this order (test first, watched red, then code)

### 1. `RUNNER_KEY`: `tools/mint-site-key.mjs --runner`
Mints a 32-byte random key, appends `RUNNER_KEY=<value>` to the env file named by `OMNIKOM_ENV_FILE` (never printed), writes an
`api_keys` row `kind = 'runner'`, `label = 'build runner (staging)'`, `key_hash = sha256(value)` with no workspace and no site (the registry
knows the key exists and when it was used; the VALUE lives in the env file and in the function secrets, not in Vault: the functions verify
an HMAC, so they need the value itself as a secret, as `capture-lead` needs nothing from Vault for the runner). Idempotent: a second run
with `RUNNER_KEY` already in the env file says `already present` and changes nothing. Read the file's existing structure first.

### 2. `export-published` (GET, `verify_jwt = false`)
`?job=<uuid>` (404 for a malformed id); `X-Runner-Signature` verified with `RUNNER_KEY` over `GET`, `/export-published?job=<id>`, `''`
(the `/functions/v1` prefix stripped as `capture-lead` does); a bad or missing signature = 401 `SIGNATURE` + security event `bad-signature`
with `kind = 'runner'` in the detail. Then, as `omnikom_fn`: `service.freeze_snapshot(job)` (first call moves the job to `building`;
`S-JOB-BUSY` = 409, the runner's queue retries later; `S-NOT-FOUND` = 404), then `service.export_bundle(job)`; for every media row in the
bundle add `url` = a signed download URL (1 hour) made through the Storage API with the secret key, in parallel but bounded (at most 8 at a
time, `AbortSignal.timeout(10000)` each; a signing failure for one file sets `url: null` and the row `error: 'sign failed'`, the runner then
fails the build if the file is referenced). Answer 200 with the bundle (the `factory/README.md` shape plus `url`), `cache-control: no-store`,
and `service.touch_key` for the runner key row (look it up by hash through a small `service.runner_key_touch(p_hash)`? NO: no migration;
if no such function exists, skip touching and list it as a finding). A rerun of the same job returns the same `snapshot` and the same rows.

### 3. `job-callback` (POST, `verify_jwt = false`)
Body `{ job, state, gateReport?, deployId?, error? }` (shape 400); signature over `POST`, `/job-callback`, the exact body; 401 on failure
with the event. `state` in `building | gating | deploying | done | failed` (a `queued` or unknown state = 400). `service.set_job_state(job,
state, gateReport, deployId, error)`: `S-JOB-STATE` = 409 `{ code: 'S-JOB-STATE', msg }`, `S-NOT-FOUND` = 404. Answer 204. `gateReport`
is capped at 64 KiB (413 beyond). Nothing else: the callback records, it does not decide.

### 4. `media-export` (GET, `verify_jwt = false`) and `media-process-callback` (POST, `verify_jwt = false`)
`media-export?media=<uuid>`: signature as above over the GET path; `service.media_for_runner(media)` (404); answer 200
`{ id, workspace_id, path, processed, url (signed download, 1 h), uploads: { "2400": <signed upload url>, "1600": ..., "800": ... } }` where
each upload path is `<path without extension>-<w>.webp` inside the same workspace folder (the Storage policy allows the service key; the
path stays under `<workspace_id>/`). `media-process-callback`: body `{ media, width, height, exifStripped, bytes, sizes: [..] }` or
`{ media, kind: 'document' }` for a PDF (then `service.media_processed(media, 0, 0, true, bytes)` is WRONG: a document is marked
processed with width and height null: check what `media_processed` allows; if it refuses width 0, answer 422 `I-MEDIA-SIZE` and list the
document case as a finding for the head: the data model has no document flag). Signature over the exact body; `service.media_processed`;
204. `exifStripped` must be `true` or the call is refused 422 `I-EXIF` (ground rule 11: nothing unprocessed is published).

### 5. Tests (append to the slice 4.2 harness), mutants, specs
`supabase/functions/test/runner.test.ts`: the fakes serve the Storage sign endpoints (record the paths they were asked to sign);
checks, each watched red: export unsigned 401 + a security event; export signed with a wrong key 401; export of a job of workspace A
(seed a row, publish through `service.start_publish` with owner-a's claims in SQL) = 200, `job.snapshot` present, `rows` exactly the
snapshot, `site.deploy_target = 'test-site-demo-a'`, `media[].url` non-null, NO id, slug, name or email of workspace B anywhere in the
JSON text (grep the serialised bundle for every B fixture value); a second export of the same job = the same snapshot and `state` still
`building` (no second event); export of a job whose site has another running build = 409 `S-JOB-BUSY`; callback `building -> gating ->
deploying -> done` = 204 each, then `content_rows.published_version` moved; `done` straight from `queued` = 409; `failed` from `gating`
leaves `published_version` unchanged; callback with a replayed signature (t older than 301 s) = 401; `media-export` for A's media = 200
with the three upload paths under `<A>/`; `media-process-callback` with `exifStripped: false` = 422 and `processed` stays false; with
`true` = 204 and `processed`, width, height set. Mutants in `mutate.mjs`: the signature check of each function, the B-leak filter (if the
leak is prevented by SQL, the mutant goes in `run-local.mjs` as a finding to the 4.2 code owner? NO: slice 4.2 is finished; append the
mutant to `run-local.mjs` yourself, it is `supabase/tests/`, and say so), the `exifStripped` refusal, the state list, the GET-body-empty rule.
`openapi.json`: `Export` schema rewritten to the real shape (drop `deployToken`, `deployTokenWorker`: the runner holds the account token,
02-BACKEND 8), add `/media-export` GET and the `media-process-callback` body; `node docs/blueprint/specs/check-specs.mjs` green.

### 6. Staging
Deploy the four with `tools/deploy-functions.mjs --functions export-published,job-callback,media-export,media-process-callback` and set the
secret `RUNNER_KEY` by name (after `--runner` minted it). `omnikom status --target staging` lists them (paste). `supabase/tests/e2e-export.mjs`
(yours; imports `personToken`/`claimsFor` only if needed; signs with `RUNNER_KEY` from the env the way the runner will): start a publish job
for owner-a's team row through the deployed `publish` function (slice 4.2) or `omnikom publish --as owner-a ...` (SQL path, read-only use of
the CLI), then GET export (200, snapshot, 0 B values), GET again (same snapshot), callback `gating`, `deploying`, `done` (204, 204, 204),
then `omnikom job get --job <id>` shows `done` with 5 events (paste); an unsigned export = 401. Leave the job `done` (it moves
`published_version` of the test row; say so). Then one more job and a `failed` callback with `{ reason: 'test' }` so both terminal states
exist on staging (paste `job get`).

## Gates (paste into PROGRESS.md under "## Step 4", sub-heading "4.3 runner functions (builder)")
```
node supabase/functions/test/run.mjs        -> OK: N of N checks passed (N larger than slice 4.2's count)
node supabase/functions/test/mutate.mjs     -> N mutants, N caught, 0 survived, 0 target text missing
node supabase/tests/run-local.mjs           -> OK: real migration passes; N mutants (only if you appended a mutant there)
deno task check                             -> no error
node docs/blueprint/specs/check-specs.mjs   -> 0 problem(s)
staging: status (the four deployed), e2e-export.mjs every line PASS, job get for the done job and the failed job
```
Watched-fail evidence one line per wall. `git status` shows only your files. Scratch in your scratchpad.

## Report (two parts): PROVEN / UNPROVEN / NOT DONE per item with the gate line; findings with options (vendor differences,
`media_processed` and the document case, the runner key touch, anything slice 4.4's runner must know).
