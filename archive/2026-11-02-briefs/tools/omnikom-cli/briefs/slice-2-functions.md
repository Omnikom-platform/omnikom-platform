# Builder brief: omnikom CLI slice 2a, the six first dashboard functions over HTTP and their walls in `verify` (CLI department)

Rewritten 2026-11-01 by HEAD_CLI-and-testing_2026-11-01 against the functions as they are at master c2811ee (platform slices 4.2 to 5.2;
no commit touches `supabase/functions` after 9ceef8b). The 2026-10-31 version assumed six functions with the 4.2 bodies; since then
save requires `base` for an existing row, lead-update takes `read`, and slice 5.2 added five more functions. Those five are slice 2b
(section at the end, its own brief and builder later). Scope of this brief is frozen: anything new is a finding, not part of 2a.

Builder: one sonnet session, this slice only, discarded when done. Head: HEAD_CLI-and-testing_2026-11-01 (report to that name only).
Starts after the seed-test slice is committed (both touch `test/run.mjs`, `test/mutate.mjs`, `test/harness.mjs`; one builder per set of files).

## Read first, in order
1. `docs/blueprint/26-PLATFORM-CLI.md` sections 2 (identities), 3 (commands, column "Behind it"), 4 (`verify`), 5 (rules), 7 (as built).
2. The six functions' source: `supabase/functions/{save,publish,lead-update,add-lead,upload-start,upload-finish}/index.ts`, and
   `_shared/dashboard.ts` (the frame: 405 `METHOD`, 413 `SIZE`, 401 `S-AUTH`, 400 `BODY`), `_shared/db.ts:37-74` (the code to status map),
   `_shared/validate.ts`. The source is the contract where it differs from `docs/blueprint/specs/openapi.json` (differences below).
3. `supabase/tests/e2e-functions.mjs` (the platform head's working staging calls: `callFunction` with `extraHeaders` for the bearer token
   and the publishable `apikey`, `personToken` per login). Copy its call shape; do not import it. `supabase/tests/e2e-screens.mjs` for save
   with `base` and the stale save.
4. The CLI: `README.md`, `omnikom.mjs`, `lib/fn.mjs`, `lib/identity.mjs`, `commands/content.mjs`, `commands/publish.mjs`, `commands/lead.mjs`,
   `commands/verify.mjs` (`WALLS_WAITING`, lines ~113-118), `test/harness.mjs`, `test/run.mjs`, `test/mutate.mjs`, and
   `~/.claude/reference/windows-scripting.md`.

## The contract as built (source wins over openapi; file:line from the 2026-11-01 survey, re-check before relying on a line)
| Function | Body | Success | Refusals this slice asserts |
|---|---|---|---|
| save | `workspace, collection, data`, `row` (uuid or null), `signOff?{by,ref}`, `base` REQUIRED when `row` is set (`save/index.ts:16-27`) | 200 `{row, version}` | 404 `S-NOT-FOUND` before validation, naming no field; 422 `VALIDATION` with `I-*` problems; 403 `S-OWN-ONLY`; 409 `S-STALE` (old `base`) |
| publish | `site, rows[], versions[]` | 202 `{job, state:'queued', dispatched, reason}` | 403 `S-OWN-ONLY` (member A1 publishes A2's listing); 422 `I-NOT-READY` or `VALIDATION` for a bare row |
| lead-update | `lead`, `status? owner? note? unassign? read?` | 204 | 404 `S-NOT-FOUND` (member A1 on A2's lead); 400 `BODY` on a bad status |
| add-lead | `site, consentText`, `name? email? phone? answers? form? owner?` | 201 `{lead}` | a member's `owner` of someone else is forced to the member (read back) |
| upload-start | `workspace, filename, bytes, mime` | 200 `{media, uploadUrl, path}` | 404 for `nobody`; 415 `MIME` |
| upload-finish | `media, rightsConfirmed` (required bool), `alt?` (max 150) | 200 `{media, processed:false, dispatched, reason?}` | 404 for `nobody` |
No token: assert status 401 only, never the code (staging's gateway answers `UNAUTHORIZED_NO_AUTH_HEADER` before the function runs).

## Files you may edit (nothing else; a bug anywhere else is a finding you send back, not a fix)
`tools/omnikom-cli/**` (code, tests, fixtures, README). Never `supabase/`, `factory/`, `tools/audit/`, `docs/`, the owner's env file.

## The slice (decided by the head; do not redesign)
1. **`--via function|sql`** on `content save`, `publish`, `lead update`, `lead add`, and a new `media upload`. Default `function` when the
   target has a functions URL (staging), `sql` when it has none (the throwaway cluster; every existing db test keeps its meaning).
   `--via function` without a functions URL is Blocked (exit 3) naming the variable. `--via sql` keeps today's path byte for byte. Result
   data says `via`.
2. **Function calls** through `lib/fn.mjs callFunction` with the caller's `personToken` (memory only, masked everywhere) as
   `authorization: Bearer` and the publishable key as `apikey`, bodies exactly as the table:
   - `content save --row <id>` on the function path needs the base version: `--base <n>`, or, when omitted, the CLI reads the row's latest
     version number first (through the caller's RLS read) and sends it; a 409 `S-STALE` is reported as such (exit 1, code in data).
   - `lead update` gains `--read true|false`.
   - `media upload --as <person> --workspace <ws> --file <png> --rights-confirmed`: upload-start, PUT the bytes to the signed URL,
     upload-finish. The signed URL is a secret: never in output (`lib/redact.mjs` masks it; a test asserts it, watched red first).
   - A function's error answer becomes the CLI's usual failure with the status and code in data; exit 1.
3. **`verify --only functions`**, a new suite (one PASS/FAIL line per check on stderr, exit 1 on any FAIL), every row of the table above,
   plus the three walls that wait in `WALLS_WAITING` moved into it the moment each runs (the list only shrinks; staff aal2 already moved
   to `people`). Every lead the suite adds is deleted again through `lead delete`; the suite ends with "0 leads left". Its header and INFO
   lines say what it leaves on staging on purpose: saved versions, queued publish jobs, unprocessed media rows.
4. **Dispatch and Actions minutes**: publish and upload-finish fire a GitHub `repository_dispatch` when the staging project has
   `GITHUB_DISPATCH_TOKEN` (`_shared/dispatch.ts`); that starts a workflow run on GitHub (minutes, and a preview build for publish). So the
   suite calls each of them at most once per run and prints `dispatched` and `reason` as INFO; no loop, no retry of a 202.
5. **Models in `test/harness.mjs`** for the six functions read the same tables and service functions the real ones read (the slice 1
   lesson: a model that checked keys in memory hid a real bug for a day). Model flags prove `verify` catches a broken function: a save that
   names a field to an outsider, a save that ignores `base`, a publish that lets a member publish another's row, an add-lead that does not
   force the member, a lead-update that lets A1 touch A2's lead.

## Findings already sent up (do not work around them; the head of operations routes them)
- `openapi.json` `SaveRequest` lacks `base` and does not name `S-STALE`; `LeadUpdateRequest` lacks `read`; drafts, settings-save, crm-test,
  lead-export, invite-member have no openapi path.
- `config.toml` names `push-lead`, `metrics-pull`, `sitemap-submit` without folders; openapi has `/unpublish` with no function.

## Tests and mutants (`test/run.mjs`, `test/mutate.mjs`; each mutant's target text occurs exactly once)
Unit: `--via` default and the Blocked case; each request body and headers through a fake fetch (token and key never in output; body
fields equal the table's); `--base` auto-read. Db: the models against the throwaway cluster; `verify --only functions` against the models
all PASS; each model flag makes its check FAIL and the suite exit 1. Mutants at least: `--via` default forced to `function` without a
functions URL; the signed URL not redacted; `base` not sent for an existing row; each moved wall's check removed; the 401 check accepting
any status. Watch every new check fail (break what it measures, see the FAIL line name it, restore); list them.

## What you run (machine-wide heavy lock; GitHub runs the heavy proof)
- `node tools/omnikom-cli/test/run.mjs --unit` freely.
- The db part only as `node ~/.claude/scripts/heavy.mjs --label "cli slice2a db" -- node tools/omnikom-cli/test/run.mjs --db`, one at a time.
- Single mutants only through heavy.mjs with `--only <name>`. NOT the full `mutate.mjs`, NOT `run-all-gates.mjs`.
- Staging, once, after the local runs are green and only when the head says so (one message), through
  `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs ...`: `status`,
  `verify --only functions`, `verify --only walls`, `verify --only people` (all `--target staging`). Never `lead send`,
  `verify --only lead`, or `seed test --clean`; nothing in this slice sends a lead alert (add-lead has no alert: check its source and say so).
- Never commit, push, `git add`, stash, reset, checkout or switch branches; leave other departments' uncommitted files alone.

## The five rules of the spec's section 5 (binding)
1. Secrets by name only and never in output; a test asserts it. 2. Production refused for everything but `status` and
`apply --i-mean-production`. 3. Fixtures synthetic; `--real` for anything else. 4. Every command idempotent where a retry is possible.
5. No dependencies; Web Crypto, psql, fetch only; tests and mutants, hygiene and production guard watched red first.
Also: keys by variable name only, never list that folder; no em dashes in any file; scripts in files, never inline `node -e`; long
commands in the background; two failed approaches to one obstacle = BLOCKED with what would unblock it.

## Report (short)
Files changed; `run.mjs --unit` and heavy db last lines; each new mutant and that it was caught; the watched-fail list; every PASS/FAIL line
of the staging runs (when released); UNPROVEN / NOT DONE / BLOCKED by name; findings with file:line.

---

## Slice 2b (next; its own brief and builder after 2a lands): the five slice-5.2 functions
`drafts` (`site`; 200 list), `settings-save` (`workspace`, `alerts?`, `crm?`; 422 `I-URL` / `I-EMAIL` / `I-SECRET-REF`; owner or staff),
`crm-test` (`workspace`; 409 `NO-CRM`, 422 `CRM-HOST`; makes a signed outbound request: on staging only its refusals run, as
`e2e-screens.mjs` does), `lead-export` (`site`, `filter?`, `q?`; 200 `text/csv`, cap header at 5000), `invite-member` (`workspace`, `email`,
`role`, `team_row?`; 409 `S-LAST-OWNER`; creates a real login on staging and sends no email: one fixed synthetic address, idempotent, never
a new one per run; no function removes a member before platform 5.6). Contract source: the function headers and `e2e-screens.mjs`
(no openapi paths). Brief to be written when 2a lands.
