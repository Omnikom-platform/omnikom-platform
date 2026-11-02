# Brief 5.1: the database for the four screens (migration 12)

Builder: Sonnet, in-session agent of the Platform build head (session `local_cade0add-3389-4314-b7b5-83333d26a97a`).
Plan: `factory/briefs/5-0-step-5-and-6-plan.md`. Specs: `docs/blueprint/15-CRM.md` (sections 3 to 5 and the feature list in 7),
`docs/blueprint/16-DESIGN-PARTS.md` 3.1 and 3.2. Starts after slice 4.6 is committed (it edits the same test files).

## Why
The dashboard (slices 5.3 to 5.6) is a thin, unstyled client over the database: every rule lives here, behind RLS and `service.*`
functions, each with a test watched red and a mutant. Most of what the four screens need exists (leads, lead_events with
Realtime, `lead_update`, `add_lead`, `save_as`, `start_publish`, `set_member`, `remove_member` with `S-LAST-OWNER`,
`sites.lead_alert_to`, `integrations`). This slice adds what is missing and nothing else.

## What to build
A new migration `supabase/migrations/20261031000012_screens.sql` (check the newest number first; 11 is the 4.6 wall). Never edit an
applied migration. Read `supabase/migrations/20261030000008_search_path_and_roles.sql` first: every definer function there is
`security definer set search_path = ''`, fully schema-qualified, starts with `service.use_claims(p_claims)`, refuses with
`S-NOT-FOUND: not found` when the caller may not see the thing, and writes `audit_log` for owner actions. Follow it exactly
(T14 checks it).

1. **`S-STALE` (16-DESIGN-PARTS 3.2, "two people edit the same page").** `service.save_as` gains `p_base int default null`: the
   version the editor started from. When `p_base` is not null and the row's newest version is past it, refuse with
   `S-STALE: <row id> was saved at version <n> by someone else` (the newest version number in the message, nothing else). A new
   row with a `p_base` other than null or 0 is refused too. Null keeps today's behaviour, because `tools/omnikom-cli/commands/content.mjs`
   and `sites/test-demo-a/stage.mjs` call `save_as` without it; the dashboard's `save` function will always send it (step 3
   below). Adding a parameter means drop and re-create the function (an overload would leave the old one callable): keep every
   grant the old one had, check them in the test. Map `S-STALE` in `supabase/functions/_shared/db.ts` `refusal()` to 409
   `S-STALE` with the database's message.
2. **Unread leads.** `public.lead_reads (lead_id uuid references leads on delete cascade, user_id uuid references auth.users on
   delete cascade, read_at timestamptz not null default now(), primary key (lead_id, user_id))`, RLS on, a select policy for
   `user_id = auth.uid()` only, no insert/update/delete grant to `authenticated` or `anon`. `service.mark_lead_read(p_claims,
   p_lead)`: refuses `S-NOT-FOUND` unless the caller can read that lead under the same rule as the `leads_read` policy (an agent
   only their assigned leads), then upserts. Add `lead_reads` to the Realtime publication the way the earlier migrations do
   (inside the `if exists (select from pg_publication ...)` guard).
3. **CSV export event.** `service.leads_exported(p_claims, p_site uuid, p_lead_ids uuid[])`: for each id the caller can read,
   one `exported` lead event (the enum value exists) with `{ "by": <login> }`; ids the caller cannot read are skipped and
   counted; returns the number recorded. The CSV itself is built by the function in 5.2 from what RLS returns.
4. **Lead alerts.** `sites` gains `alert_assignee boolean not null default true` ("also email the assigned agent").
   `service.set_alerts(p_claims, p_site uuid, p_to text[], p_assignee boolean)`: owner or staff of the site's workspace;
   at most 10 addresses; each must look like an email (`^[^@\s]+@[^@\s]+\.[^@\s]+$`) else `I-EMAIL: <address>`; lower-cased,
   de-duplicated; audit row `alerts-set`. Extend `service.alert_recipients` only if the function in 5.2 needs the new column
   (read it first).
5. **CRM connection.** `service.set_crm_webhook(p_claims, p_workspace uuid, p_url text, p_secret_ref text)`: owner or staff;
   `p_url` null removes the row; otherwise it must be `https://`, at most 2000 characters, and its host must not be an IP literal
   in a private, loopback or link-local range nor `localhost` (`I-URL: <reason>`). Upserts `integrations (kind 'crm-webhook')`
   with `config = {"url": ...}` and `secret_ref` = a NAME (the 5.2 function creates the signing secret in Vault and passes its
   name; a value never reaches a table, 16-DESIGN-PARTS 3.1 item 10). Audit row `crm-set` without the ref.
6. **Drafts waiting ("Publish 3 changes").** First find out whether a plain RLS read can answer it: `content_rows` has
   `published_version`; does it carry the newest version too, or must it come from `content_versions`? If two RLS reads answer
   it, add nothing and write that down. If not, add `service.drafts_waiting(p_claims, p_site)` returning (row id, collection,
   newest version, published version, edited by, edited at) for the workspace's live rows whose newest version is past the
   published one; an agent sees only rows they may see.

## Tests (each new wall watched red first, then a mutant)
- `supabase/tests/tenancy.test.sql`, one block per item: stale save refused and a current save accepted (and null still accepted);
  a member cannot mark read a lead not assigned to them, can mark their own, cannot read another login's `lead_reads` rows;
  `authenticated` cannot insert into `lead_reads` directly; export events only for readable leads; `set_alerts` refused for an
  agent and another workspace's owner, bad email refused, list stored lower-cased and de-duplicated; `set_crm_webhook` refused
  for an agent, `http://`, `https://127.0.0.1/`, `https://10.0.0.5/`, `https://localhost/` refused, a good URL stored with the
  ref name and nothing else; drafts waiting, if built, scoped the same way.
- Watched red: write the tests first, run `node supabase/tests/run-local.mjs --only <none>` before the migration exists, paste the
  red lines; then add the migration and paste green.
- Mutants in `run-local.mjs` (MUTANTS list): the stale check removed; the stale check off by one (`>=` vs `>`); mark_lead_read
  without the readable check; the `lead_reads` select policy widened to `true`; export without the readable check; set_alerts
  without the owner check; set_crm_webhook without the private-host check; set_crm_webhook without the owner check; drafts
  waiting without the agent scope (if built). Each caught.
- `supabase/functions/test/`: one Deno check that a database `S-STALE` becomes 409 `S-STALE`. `run.mjs` OK, `mutate.mjs` 0 survived.

## Staging
After `--dry-run`: `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/omnikom-cli/omnikom.mjs apply
--target staging`, then `omnikom status --target staging` (12 applied, 0 pending) and `node tools/with-env.mjs ... -- node
supabase/tests/e2e-export.mjs` (0 problems).

## Rules
- Edit only: the new migration, `supabase/tests/tenancy.test.sql` and `run-local.mjs` (MUTANTS list and nothing else in it: the
  head's runner changes are in the same file), `supabase/functions/_shared/db.ts` (`refusal()` only), the Deno tests, and a
  paragraph in `docs/blueprint/PROGRESS.md` under a new `## Step 5` heading titled `### 5.1 screens database (builder)`.
  `tools/omnikom-cli/` and `tools/audit/` belong to other departments: a need there is a finding in your report.
- Keys by variable name only through `tools/with-env.mjs`; never print, copy or list a value, never list the
  `creds and accounts login/` folder. Scripts in files, never `node -e`. No em dashes. Keep big temporary files off E: (the
  local clusters already live in the system temp folder on C:). Long runs in the background with bounded waits; the full
  `run-local.mjs` takes about 25 minutes, so use `--only` while iterating and one full run at the end. Do not commit.
- Two failed approaches to the same obstacle = stop and report BLOCKED with what would unblock it.

## Done when (paste every line in your report and in PROGRESS)
- the red run before the migration, then `PASS real migration` and `OK: real migration passes; N mutants` (all caught);
- `node supabase/functions/test/run.mjs` OK and `mutate.mjs` 0 survived; `deno task check` exit 0;
  `node docs/blueprint/specs/check-specs.mjs` OK; `node docs/blueprint/specs/run-all-gates.mjs` ends `all gates passed`;
- staging: apply output, status (12 applied), e2e-export 0 problems;
- the answer to item 6 (two reads, or the function), and findings for other departments, each in one line.
