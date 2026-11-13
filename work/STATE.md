# Where things stand

Rewritten in place, never appended, under 60 lines; last 2026-11-13 by the head of operations, with batch 6. Every feature's
state: `docs/product/1-product.md`. How we work: `docs/departments/README.md` (rewritten for the method below with this
batch). Getting back in: `resume\RESUME.md`.

## Now
- Product: 74 of 97 rows WORK, 22 PARTLY, 1 MISSING (computed from the rows, checked by CI). CRM 26, 0, 0 of 26; dashboard
  15, 7, 1 of 23; backend 15, 2, 0 of 17; factory 10, 0, 0 of 10; hardening 8, 13, 0 of 21.
- The platform build is open (owner, 2026-11-12); the refactor of how we work is closed at what is built. One head of
  operations orients, rules, takes in and lands; it never builds. Every job: a written hand-over that names its product row
  and its done-test, a fresh cross-check of the hand-over against the tree, the test first and seen red, the least code, one
  builder in the slice's own worktree who only stages, the head's own intake and commit, one landing per batch by
  `omnikom land` on a tree that passed CI. A row is WORKS only on proof seen on staging; until then its cell says UNPROVEN.
- A second lane runs beside the build for the search audits (its own session, the same machine lock, the same landing
  command); product lands first.

## Landed since the build reopened (80 commits, master 5d55164 before this batch)
- CRM: bulk owner and delete, the business's own types and statuses, export in a saved layout, import (A15, A16, A21, A22).
- Dashboard: the Overview with the site check and the numbers (B20, B21), a link from a real inbox (B1), restore with Undo
  (B8), invites (B17), delete an item (B12, part), a photo from the editor to the published site (B13, C8), past publishes
  and putting the site back (B11), the instant preview frame (B15, part a), the media library (B14, part a), Search health
  (B24, part).
- Backend and hardening: the mail outbox (E4, migration 29), a per-visitor lead limit (E5, 30), bounces and complaints (E21,
  31), a request id on every function call, counted 5xx answers and the hourly alerts (E3, 32), plan limits (E16, 41), every
  function through the transaction pooler (E6), dashboard headers and the error screen (E7), publish smoke and rollback
  (E8), a workflow-only token path (E9), retention and purge (E12, 28), rich text allow-list (E18), the invite repair (C13).
- This batch: the preview site behind a signed link (B15 part b, migration 42); staff act only inside a window they open
  (E11, 43); replace and delete of a stored file, on the screen too (B14, 44; a new row B25 for sizes left behind); take an
  item off the site and put it back (B12, 45); production brought up from staging by one script (E2); the Vault and the
  media backed up and a monthly restore drill (E1); a refused visitor held at the site's own endpoint for 60 s (E5 part b);
  the sheets' focus and phone buttons; how the departments work, rewritten.

## Not landed
- Nothing is committed and waiting. Being built: E13 part d (publish validates its rows in 3 statements). Hand-overs ready,
  each cross-checked against this tree first: the staging walls, the browser flows on GitHub's runner, E13 part a, E12 last.

## Staging (the test project), 2026-11-13
- Migrations through 41 applied in number order; all 31 functions deployed from master 9b4bfa1; the screens' end-to-end
  script passes; the flows of the instant frame (B15), Search health (B24) and the media library (B14 part a) passed and
  went red with their seeded faults; E6: 20 parallel calls hold no function connection after the change.
- Owed, each by the head's run sheet: migrations 42 to 45 and this batch's functions; the flows of B11, B12, B14 (replace
  and delete), B15 (the preview site) and E6's journeys (a browser, the machine lock); E4's inbox read; E16's limits; E3's
  alerts; E11's settings; E5's hold; E1's drill (its workflow, by hand). RED: the walls stop at T20 on four old rows.

## Migrations
- A migration that has not landed takes the next free number above every file in the tree when it is built, and lands in
  number order (staging applies in file-name order); no number is promised ahead. In the tree: through 45.

## BLOCKED and UNPROVEN
- E21 on staging: BLOCKED. The mail provider's webhook is an account setting; it needs the owner's yes.
- E9's new path: UNPROVEN until the workflow-only token is in the master `.env` (an owner item); the old path runs.
- This batch's database rules ran here only in part (the machine lock was taken): the check run is their first whole run.

## Clients
- Each client's profile and go-live sheet are under `clients/<slug>/`. Both domain switches wait only for the owner's green
  light; nothing is changed at a client's own domain, registrar or DNS before it, and no mail goes to a client from us.
- The newest client's search audit runs in the audit lane (files in that client's git-ignored `private` folder; not final).

## Machine
- One lock for every heavy local run (`~/.claude/scripts/heavy.mjs`); a run that waited the lock out is UNPROVEN, not a
  result. A test whose result depends on this machine (how a socket closes, a path, a clock) is proven on the runner.
- Google from this machine: the IP is in Giza; captures only by desktop control in the owner's signed-in Edge. Staging has
  migration 20 applied before 16 (KNOWN-6): repair before the first promotion.

## Open owner items
- The workflow-only token `GITHUB_DISPATCH_TOKEN_V2`; importing the master ruleset; the backup buckets and key (E1); the
  address alerts go to (`ALERTS_TO`); the "Ask Omnikom" address (`VITE_ASK_EMAIL`); the mail provider's webhook for staging;
  two new Actions secrets for the browser flows on the runner; the contact line on a client report; each client's go.
