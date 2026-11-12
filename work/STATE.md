# Where things stand

Rewritten in place, never appended, under 60 lines; last 2026-11-13 by the head of operations, with batch 5. Every feature's
state: `docs/product/1-product.md`. How we work: `docs/departments/README.md` (its rewrite to the method below is being
drafted; where the two differ, this file holds). Getting back in: `resume\RESUME.md`.

## Now
- Product: 74 of 96 rows WORK, 20 PARTLY, 2 MISSING (computed from the rows, checked by CI). CRM 26, 0, 0 of 26; dashboard
  15, 7, 0 of 22; backend 15, 2, 0 of 17; factory 10, 0, 0 of 10; hardening 8, 11, 2 of 21.
- The platform build is open (owner, 2026-11-12); the refactor of how we work is closed at what is built. One head of
  operations orients, rules, takes in and lands; it never builds. Every job: a written hand-over that names its product row
  and its done-test, a fresh cross-check of the hand-over against the tree, the test first and seen red, the least code, one
  builder in the slice's own worktree who only stages, the head's own intake and commit, one landing per batch by
  `omnikom land` on a tree that passed CI. A row is WORKS only on proof seen on staging; until then its cell says UNPROVEN.
- A second lane runs beside the build for the search audits (its own session, the same machine lock, the same landing
  command); product lands first.

## Landed since the build reopened (72 commits, master ee769e6 before this batch)
- CRM: bulk owner and delete, the business's own types and statuses, export in a saved layout, import (A15, A16, A21, A22).
- Dashboard: the Overview with the site check and the numbers (B20, B21), a link from a real inbox (B1), restore with Undo
  (B8), invites (B17), delete an item (B12, part), a photo from the editor to the published site (B13, C8), past publishes
  and putting the site back (B11), the instant preview frame (B15, part a), Search health's reads (B24, part a).
- Backend and hardening: the mail outbox (E4, migration 29), a per-visitor lead limit (E5, 30), bounces and complaints (E21,
  31), a request id on every function call and counted 5xx answers (E3 part a, 32), plan limits (E16, 41), every function
  through the transaction pooler (E6), dashboard headers and the error screen (E7), publish smoke and rollback (E8), a
  workflow-only token path (E9), retention and purge (E12, 28), rich text allow-list (E18), the invite repair (C13).
- This batch: the hourly alerts mailed and a 5xx alert (E3 part b), the media library's screen (B14, PARTLY), the Search
  health page linked from the Overview (B24, PARTLY), the staging function suite's stale checks, E5's staging proof.

## Not landed (committed in builders' worktrees; they land in migration-number order)
- B15 part b, the preview site: migration 42 and the dashboard side are committed, the runner side is being built. The three
  land together: a preview must not be startable before the runner knows what a preview job is.
- E11, staff act only inside a window they open (migration 43), with the CLI's verify change. B14, replace and delete of a
  stored file (migration 44; its function is being built). B12, take an item off the site (migration 45, being built).
- Hand-overs ready and waiting for a builder: B14's screens and flows, B12's dashboard side, E1, E2 (being built), E12 last.

## Staging (the test project), 2026-11-13
- Migrations through 41 applied in number order; all 31 functions deployed from master ee769e6 with the pooler secret set by
  name; a 404 from a function carries its request id in the header and the body.
- Owed, each by the head's run sheet: the flows of B11, B15, B14, B24 and E6's journeys (a browser, the machine lock); E4's
  inbox read; E16's limits; E3's alerts; E11 and migrations 42 to 45 after their landings.

## Migrations
- A migration that has not landed takes the next free number above every file in the tree when it is built, and lands in
  number order (staging applies in file-name order); no number is promised ahead. In the tree: through 41. Given: 42 to 45.

## BLOCKED and UNPROVEN
- E13 at 50,000 leads: BLOCKED. The scale file passes the local runner's 120 s limit for one statement; needs a ruling (split
  the file, or a longer limit) and a 30 minute hold of the machine lock.
- E21 on staging: BLOCKED. The mail provider's webhook is an account setting; it needs the owner's yes.
- E9's new path: UNPROVEN until the workflow-only token is in the master `.env` (an owner item); the old path runs.

## Clients
- Each client's profile and go-live sheet are under `clients/<slug>/`. Both domain switches wait only for the owner's green
  light; nothing is changed at a client's own domain, registrar or DNS before it, and no mail goes to a client from us.
- The newest client's search audit runs in the audit lane; its working files are in that client's git-ignored `private`
  folder and its report is not final.

## Machine
- One lock for every heavy local run (`~/.claude/scripts/heavy.mjs`); a run that waited the lock out is UNPROVEN, not a
  result. A test whose result depends on this machine (how a socket closes, a path, a clock) is proven on the runner.
- Google from this machine: the IP is in Giza; captures only by desktop control in the owner's signed-in Edge. Staging has
  migration 20 applied before 16 (KNOWN-6): repair before the first promotion.

## Open owner items
- The workflow-only token `GITHUB_DISPATCH_TOKEN_V2`; importing the master ruleset; backups (point-in-time restore, or a
  nightly dump: money); the address alerts go to (`ALERTS_TO`); the "Ask Omnikom" address (`VITE_ASK_EMAIL`); the mail
  provider's webhook for staging; the contact line on a client report; the green light for each client's domain switch.
