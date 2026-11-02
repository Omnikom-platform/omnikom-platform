# Brief 5.2: the Edge Functions for the four screens

Builder: Sonnet, in-session agent of the Platform build head (session `local_cade0add-3389-4314-b7b5-83333d26a97a`).
Plan: `factory/briefs/5-0-step-5-and-6-plan.md`. Starts after slice 5.1 (migration 12, `20261031000012_screens.sql`) is committed:
read that migration and the `### 5.1 screens database (builder)` paragraph of `docs/blueprint/PROGRESS.md` first. Read slice 4.2's
brief (`factory/briefs/4-2-dashboard-functions.md`) and `supabase/functions/_shared/dashboard.ts`: every function here is a
dashboard function in that frame (POST, body cap, the user's JWT checked twice, a connection stepped down to `omnikom_fn`, a
database refusal becomes its platform code and a security event).

## Why
The dashboard never writes a table and never calls `service.*` itself: it reads through RLS and acts through these functions.
5.1 put the rules in the database; this slice exposes them, plus the four things SQL cannot do (send an invite, sign a webhook test,
resolve a host name, build a CSV).

## What to build
1. **`save` passes the base version** (5.1 finding): the body gains `base` (an integer, required when `row` is set, 400 `BODY`
   when missing), passed to `service.save_as` as `p_base`. A stale save is 409 `S-STALE` with the database's sentence (5.1 mapped
   it). Deno tests: current base saves, stale base 409, missing base on an existing row 400, new row without base saves.
2. **`lead-update` marks a lead read**: body `read: true` calls `service.mark_lead_read` (alone or with the other fields).
3. **`drafts`** (new, read-only): body `{ site }`, returns `service.drafts_waiting` rows (the "Publish N changes" list) as JSON.
4. **`settings-save`** (new): body `{ workspace, alerts?: { site, to: string[], assignee: boolean }, crm?: { url: string | null } }`.
   Alerts call `service.set_alerts`. CRM: a URL first passes the host check below; then the function makes the webhook's signing
   secret (32 random bytes) and stores it in Supabase Vault under a name `crm-webhook-<workspace>`, and calls
   `service.set_crm_webhook` with that NAME. Read how the platform already writes Vault secrets (`tools/mint-site-key.mjs`,
   `service.site_signing_secrets`) and whether `omnikom_fn` may; if a new definer function is needed to create or replace the
   Vault secret, add migration 13 with its test watched red and a mutant (the same rules as 5.1), never a grant to the function
   role on `vault` itself. `url: null` removes the connection and deletes the secret. The value never leaves the database except
   in the signed request of item 5.
5. **`crm-test`** (new): body `{ workspace }`, owner or staff (the database decides). Sends ONE POST to the stored URL with a
   fixed synthetic body (`{"test": true, "lead": {"name": "Test Lead", "email": "test@example.com"}}`), an
   `X-Omnikom-Signature` HMAC-SHA256 of the body with the stored secret (the same `t=...,v1=...` shape as the site signature in
   `_shared/signature.ts`, so a client verifies both the same way), `redirect: 'manual'` (a redirect is reported, never
   followed), a 10 s timeout. Before sending, resolve the host (`Deno.resolveDns`, A and AAAA) and refuse when any address is
   private, loopback, link-local or unique-local (SQL cannot see DNS: 5.1 finding). Returns `{ status, ok, ms }` or the plain
   reason. Records a `lead_events`-free audit row (the action, never the URL's query string or the secret).
6. **`lead-export`** (new): body `{ site, filter?: 'new'|'all'|'mine'|'spam', q?: string }`; selects the leads through the
   caller's own RLS (not the service role: what the caller may read is exactly what they get), builds a CSV (received, name,
   email, phone, form, page, status, owner, answers as one JSON column; values starting with `=`, `+`, `-`, `@` prefixed with a
   quote: CSV injection), calls `service.leads_exported` with the ids, and returns `text/csv` with a filename header. A cap of
   5000 rows, said in a header when reached.
7. **`invite-member`** (new): body `{ workspace, email, role: 'owner'|'member', team_row?: uuid }`; owner or staff (the database
   decides through `service.set_member`). Creates the login with the Auth admin API's `generate_link` of type `invite` (this
   creates the user and SENDS NOTHING: no email sender exists yet, an owner-batch item) or finds the existing login by email,
   then `service.set_member`. Returns `{ user, invited: true, email_sent: false }`, never the link. A note in the function's
   header says that sending the invite email waits on the sender (D5), and where it plugs in.
8. `refusal()` in `_shared/db.ts` maps `I-EMAIL`, `I-URL`, `I-SECRET-REF` (5.1 finding) to 422 with plain words.
9. `supabase/config.toml`: an entry per new function, `verify_jwt = true`.

10. **CORS for the dashboard** (5.3 finding: a browser preflight gets 405 `METHOD` from `lead-update` and `add-lead`, so no
   browser can call them; 5.3 runs through a vite forward meanwhile). In the `dashboard()` frame: answer `OPTIONS` with 204 and
   `Access-Control-Allow-Origin` set to the request's `Origin` only when it is in the allowed list (`DASHBOARD_ORIGINS`, a
   function secret holding a comma-separated list; staging allows `http://localhost:<the vite ports>` and the future `app` Pages
   address), `Allow-Methods: POST`, `Allow-Headers: authorization, apikey, content-type, x-client-info`, `Max-Age: 600`, and the
   same `Allow-Origin` on every answer, refusals included. An origin not in the list gets no CORS headers (the browser blocks it).
   Never `*`. Tests: allowed origin, unknown origin, no origin (a server call still works), and a mutant that returns `*`.

## Tests
- Deno tests (`supabase/functions/test/`, the harness of 4.2) for every function: the happy path, each refusal, another
  workspace's id (404 `S-NOT-FOUND`), an agent where the owner is required, and for `crm-test` a fake webhook server that checks
  the signature, a redirect that is not followed, and a host resolving to 127.0.0.1 refused before any connection. For
  `lead-export`: a member gets only their assigned leads; a value `=HYPERLINK(...)` comes out quoted.
- Deno mutants (`mutate.mjs`) for each new guard: the base check, the DNS check, `redirect: 'manual'`, the CSV quote, the RLS
  connection of lead-export (swap it for the service connection and see a test fail), the role sent to `set_member`.
- If migration 13 is needed: its tests in `tenancy.test.sql`, watched red, mutants in `run-local.mjs` (MUTANTS list only).

## Staging (the head does it, not you)
Staging only ever runs committed, gated code (charter rule, DECISIONS 43): you never apply a migration or deploy a function to
staging. Prove everything locally (the Deno harness and the local cluster). Write `supabase/tests/e2e-screens.mjs`, modelled on
`e2e-export.mjs`, that proves each function once on staging as `owner-a` (and `member-a1` for one refusal), and run it ONLY
against your local harness if it supports that; the head runs it on staging after the commit, the migration apply (CLI
`apply --target staging`) and the deploy (`node tools/deploy-functions.mjs --functions
save,lead-update,drafts,settings-save,crm-test,lead-export,invite-member --deploy-only`). In your report, list those steps in
order. For `crm-test` on staging the script uses a public echo endpoint only if one is already used in this repository;
otherwise it skips that one and says so. `invite-member` on staging: the address `invite-test-5-2@test`, never one that could
be a real mailbox.

## Rules
- Edit only `supabase/functions/` (new folders, `save`, `lead-update`, `_shared/db.ts`, the tests), `supabase/config.toml`,
  migration 13 if needed with `supabase/tests/tenancy.test.sql` and `run-local.mjs` (MUTANTS list only), a new
  `supabase/tests/e2e-screens.mjs` if needed. `apps/dashboard/` belongs to builder 5.3 right now: do not touch it.
  `tools/omnikom-cli/` and `tools/audit/` belong to other departments: a need there is a finding.
- Keys only through `tools/with-env.mjs`, by name; never print, copy or list a value. Scripts in files. No em dashes.
- Heavy runs one at a time across the head's builders: do NOT start the full `run-local.mjs`, `run-all-gates.mjs` or the full
  Deno `mutate.mjs`; use `--only` runs. When everything light is done, end with a report whose first line is
  `READY FOR HEAVY RUN: <exact command>`. Never git add, commit, stash, reset or switch branches.
- Two failed approaches to the same obstacle = stop and report BLOCKED with what would unblock it.

## Done when (paste every line in your report; end it with a PROGRESS paragraph titled `### 5.2 screens functions (builder)`,
which the head pastes)
- Deno tests OK, `mutate.mjs --only` on the new files 0 survived, `deno task check` exit 0, `check-specs.mjs` OK (add the new
  operations to the spec if check-specs requires every function to be listed: read it);
- migration 13 (if any): red then green, its mutants caught (`--only`);
- the staging steps for the head, in order, and e2e-screens.mjs run against the local harness (or why it cannot be);
- findings one line each (5.3/5.4/5.6 need to know each function's body and answer shape: list them).
