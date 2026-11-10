# 36 onboard a client

Owner: clients. Model: opus (the head did it). Branch: check/clients/wo36-onboard. Status: DONE on staging (C14 WORKS; the invite's
arrival in the inbox belongs to C13 and is UNPROVEN until the inbox is read).

## Why
Product row C14 "Onboard a client (workspace, site, contract, rows, logins)" was PARTLY: CLI `omnikom seed`, proven for the two
test workspaces only. Head of operations 2026-11-10 16:57: one command under `tools/client-infra/` from an intake file to a
workspace, its site row, the contract fields, the starting rows, the owner's login invite and then provision.mjs; a dry run; a
second run changes nothing; a half-filled intake refused with the missing fields named. `omnikom seed` is CLI's: call it, never
edit it. Proof on staging with a new test client `test-wo36`; the invite to a test inbox only.

## Inputs
- `tools/omnikom-cli/commands/seed.mjs` `seed workspace` (workspace, site, contract, pages, places; reads first; staff actor)
- `supabase/functions/invite-member/index.ts` (owner or staff with MFA; creates the login, makes the member, then one mail)
- `contracts/core.json` (settings and team fields), `contracts/industry-run/contracts/real-estate.json` (the test contract)
- `supabase/tests/e2e-settings.mjs` (how a script signs in as a person: the CLI's `personToken`)

## Decisions (head of Clients, 2026-11-10)
- Starting rows are the business details (settings: name, phone, email, address) and the owner's team profile (name, slug, role).
  They are created once; on a later run a difference from the intake is a note, never an overwrite (the client owns them then).
- The owner's login comes from `invite-member` called as Omnikom staff (the staging staff login with MFA), role owner, linked to
  the team profile. Already a member = no call and no mail, so a second run sends nothing.
- The invite address must be in `tools/client-infra/test-inboxes.json` (owner rulings with an `until` day); the check runs
  before any connection, and again inside the live invite.
- Staging only; production is refused until the owner decides how production clients are onboarded.
- Logo: the core marks it required, but onboarding has no image to give; it is added in the dashboard (Media) before publishing.

## Outputs
- `tools/client-infra/onboard.mjs`, `onboard-live.mjs`, `test-inboxes.json`, `intake.example.json`, README section
- `tools/client-infra/test/onboard-run.mjs`, `onboard-fakes.mjs`, `onboard-mutate.mjs`, run inside `clients/test/run.mjs`
- `work/36-onboard/proof.md`; `docs/product/1-product.md` C14 and the C13 invite line. The test-wo36 intake stays outside the
  repository (it holds the owner's test inbox; `test-inboxes.json` keeps only its sha256: the repository is public)

## Proof
`proof.md` in this folder.
