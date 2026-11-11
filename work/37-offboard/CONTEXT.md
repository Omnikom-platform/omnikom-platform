# 37 offboard a client

Owner: clients. Model: opus (the head did it). Branch: check/clients/wo37-offboard. Status: DONE on staging (37 and 37b); E14 WORKS (head of operations 2026-11-11 05:17).

## Why
Product row E14 "Tenant offboarding, full data export, privacy erasure carried out" was PARTLY: the workspace states and the
privacy tickets existed (H2-6, H2-8), nothing carried them out. Head of operations 2026-11-10 20:10: `tools/client-infra/offboard.mjs`
does the full export of one workspace, sets the offboarding state and carries out a privacy erasure request end to end; a dry run,
idempotent, refuses a workspace not marked for offboarding; the existing database functions only (anything missing in `supabase/`
is a finding for platform); proof on a fresh test client test-wo37 made with onboard.mjs. 20:26: teardown of what Clients owns
(Pages project, site key, custom domain) too; skip the invite (`onboard.mjs --no-invite`).

## Inputs
- `supabase/migrations/20261030000008_search_path_and_roles.sql`: `service.set_workspace_state`, `open_privacy_request`,
  `set_privacy_request_state`, `delete_lead` (the latest definitions), `service.active_key`
- `tools/omnikom-cli/commands/lead.mjs` (how a script calls a service function as the staff test identity: `claimsFor`)
- `tools/client-infra/live.mjs` (the Cloudflare Pages calls of work order 35)

## Decisions (head of Clients, 2026-11-10; the reading confirmed by the head of operations 20:26)
- "Marked for offboarding" = listed in `tools/client-infra/offboard-marked.json`, a ruling with an `until` day; the reason becomes the
  state reason. Anything else is refused before a connection, like `dns-allowed.json` and `test-inboxes.json`.
- Order: state, erasure, teardown, export. The export is the final state, never holds an erased person, and a second run equals it
  (same content hash: not rewritten).
- The erasure acts on a named request (`--erase <id>`), opened by the owner or staff, never on its own. It deletes the person's
  leads with `service.delete_lead` and then scans every table of the workspace for the address; the request is marked done only when
  nothing is found. `privacy_requests` keeps the address (needed to answer the person) and is the one place the export may hold it.
- A number is matched by its last 10 digits ("+1 555 555 0137" finds "(555) 555-0137"); `open_privacy_request` compares all digits
  (finding 5 for platform).
- Teardown (`--teardown`, explicit): Pages custom domains detached, `sites.domain` cleared, signing keys revoked, the Pages project
  deleted; each write by id, exactly one row, with an audit row. DNS records are never touched (the owner's click).
- The export goes to a folder outside any git checkout (personal data; the repository is public). `api_keys` without `key_hash`.
- The Pages custom domain could not be seeded on staging: Cloudflare refuses example.com ("reserved", 8000015); an omnikom.io
  exception was declined (head of operations 20:49, option A). Its detach is the call work order 35's clean-up ran live.

## Findings sent to platform (20:40; queued after their work order 20)
1. No workspace export function (`export_bundle` is the publish bundle). 2. `delete_lead` leaves the address in
`messages.to_text` (`lead_id` set null) and possibly `webhook_events.payload`. 3. `consent_ledger.lead_id` has no foreign key.
4. Erasing a login is blocked by the `auth.users` foreign keys (H2-8). 5. `open_privacy_request` matches numbers by all digits.

## Outputs
- `tools/client-infra/offboard.mjs`, `offboard-live.mjs`, `offboard-marked.json`, `proof-offboard.mjs`; `live.mjs` gained
  `detachDomain` and `deleteProject`; `onboard.mjs --no-invite`; README section
- Tests: `test/offboard-run.mjs` (16 cases, fakes), `test/offboard-mutate.mjs` (21 mutants), in `clients/test/run.mjs`. All three
  mutant runners now stop when the unbroken copy fails its baseline (a first local run of the offboard mutants had a failing
  baseline, so its "caught" lines meant nothing; the test's repository root is now its own).
- `work/37-offboard/proof.md`, `work/37-offboard/test-wo37.intake.json`

## Left on staging on purpose
test-wo37: offboarding, its site row (no domain, key revoked), the kept lead, the done request, the Storage file. No Pages project.

## Next
Work order 37b (head of operations 20:57): migration 26 (24 reserved by platform, renamed 26 by the head of operations 2026-11-11), this department's file and tests, reviewed by
platform: `delete_lead` scrubs every plaintext copy (`messages.to_text`, `webhook_events.payload`, `consent_ledger` keeps hashes and
the time), a Storage deletion function for an offboarding workspace, the move to deleted once Storage is empty; must not touch
`lead_set_fields` or `lead_query_check` (migration 20). Then E14 WORKS.

Note (2026-11-11): migration 26's header names its tests "tenancy.test.sql T31"; work order 20 took T31, so the block is T32. The
migration is applied on staging and is never edited (its hash would change), so the header keeps the old name.
