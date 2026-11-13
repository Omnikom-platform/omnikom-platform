# Where things stand

Rewritten in place, never appended, under 60 lines; last 2026-11-13 by the head of operations, with batch 23. Every feature's
state: `docs/product/1-product.md`. How we work: `docs/departments/README.md` (rewritten for the method below at batch
13). Getting back in: `resume\RESUME.md`.

## Now
- Product: 81 of 97 rows WORK, 16 PARTLY, 0 MISSING (computed from the rows, checked by CI). CRM 26, 0, 0 of 26; dashboard
  19, 4, 0 of 23; backend 15, 2, 0 of 17; factory 10, 0, 0 of 10; hardening 11, 10, 0 of 21.
- The order (owner, 2026-11-13): the owed proof runs are done; now one build job at a time: 5 rows to build (B18, B24,
  C11's request, E5's limit at the edge, E13).
- The platform build is open (owner, 2026-11-12); the refactor of how we work is closed at what is built. One head of
  operations orients, rules, takes in and lands; it never builds. Every job: a written hand-over that names its product row
  and its done-test, a fresh cross-check of the hand-over against the tree, the test first and seen red, the least code, one
  builder in the slice's own worktree who only stages, the head's own intake and commit, one landing per batch by
  `omnikom land` on a tree that passed CI. A row is WORKS only on proof seen on staging; until then its cell says UNPROVEN.
- A second lane runs beside the build for the search audits (own session, same lock, same landing); product lands first.

## Landed since the build reopened (owner, 2026-11-12)
- CRM (A15, A16, A21, A22): bulk owner and delete, the business's own types and statuses, export in a saved layout, import.
- Dashboard: the Overview (B20, B21), sign-in from a real inbox (B1), restore (B8), invites (B17), delete an item and take
  it off the site (B12), a photo to the published site (B13, C8), past publishes (B11), the instant frame and the
  preview site (B15, part), the media library with replace and delete (B14), Search health (B24, part), a failed
  check read line by line and a search text under its minimum refused (B10, B9), a failed draft removed (B15),
  a removed item answering 404 at its old address for 7 days (B12), photo sizes a delete left behind removed (B25).
- Backend and hardening: the mail outbox (E4), lead limits and the hold at the site's endpoint (E5), bounces (E21), request
  ids and hourly alerts (E3), plan limits (E16), the pooler (E6), headers (E7), publish smoke and rollback (E8), the
  workflow-only token path (E9), retention, purge and growth budgets (E12, migration 46), rich text (E18), staff windows
  (E11), production brought up by one script (E2), backups and a restore drill (E1), a publish in 3 statements (E13 d),
  an index for every foreign key and its wall T48 (E13, migration 48), the restore drill green, 9 phases (E1, part).
- Tools: the browser flows on GitHub's runner (`flows.yml`, one named staging flow per run, the output sealed); the
  staging walls read only the run's own rows and now pass whole; the search audit's tool (the audit lane's four landings).

## Not landed
- Nothing is committed and waiting. Two runner-dependent checks need hand-overs: the CLI's held port, the audit harness.

## Staging (the test project), 2026-11-13
- Migrations through 49 applied in number order; 32 functions from master 0eeef26, three of them (save, publish,
  media-manage) and the dashboard from a554dfd; the flows of the media library (B14), the preview site (B15), the publish
  sheet (B10, B9), the taken-off page (B12) and the earlier ones passed and went red with their seeded faults; the 22
  Auth settings read back (E11); E4's alert read in the test inbox, its link opens the lead; E5's hold measured (1 of 22
  posts reached the platform); the walls pass whole (T1 to T49), migration 48's 22 indexes present, none invalid.
- Owed, each by the head's run sheet: E16's limits; E3's alerts (an owner item first).

## Migrations
- A migration that has not landed takes the next free number above every file in the tree when it is built, and lands in
  number order (staging applies in file-name order); no number is promised ahead. In the tree: through 49.

## BLOCKED and UNPROVEN
- E21 on staging: BLOCKED. The mail provider's webhook is an account setting; it needs the owner's yes.
- E9's new path: UNPROVEN until the workflow-only token is in the master `.env` (an owner item); the old path runs.
- E13's timing at 50,000 leads: UNPROVEN, the measure stopped at its 600 s limit with no number.
- Production does not exist yet: everything about it is UNPROVEN until the owner's go and his six items.

## Clients
- Each client's profile and go-live sheet are under `clients/<slug>/`. Both domain switches wait only for the owner's green
  light; nothing is changed at a client's own domain, registrar or DNS before it, and no mail goes to a client from us.
- The newest client's search audit is a finished draft (that client's git-ignored `private` folder); it lacks a contact line.

## Machine
- One lock for every heavy local run (`~/.claude/scripts/heavy.mjs`); a run that waited the lock out is UNPROVEN, not a
  result. A test whose result depends on this machine (how a socket closes, a path, a clock) is proven on the runner.
- Google from this machine: the IP is in Giza; captures only by desktop control in the owner's signed-in Edge. Staging has
  migration 20 applied before 16 (KNOWN-6): repair before the first promotion.

## Open owner items
- The workflow-only token `GITHUB_DISPATCH_TOKEN_V2`; importing the master ruleset; the backup buckets and key (E1); the
  address alerts go to (`ALERTS_TO`); the "Ask Omnikom" address (`VITE_ASK_EMAIL`); the mail provider's webhook for staging;
  the contact line on a client report; each client's go.
