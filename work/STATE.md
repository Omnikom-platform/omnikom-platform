# Where things stand

Rewritten in place, never appended, under 60 lines; last 2026-11-21 by the head of operations, after the sitting. Every feature's
state: `docs/product/1-product.md`. How we work: `docs/departments/README.md`. Getting back in: `resume\RESUME.md`.

## Now
- Product: 74 of 98 rows WORK, 24 PARTLY, 0 MISSING (checked by CI). CRM 24, 2, 0 of 26; dashboard 15, 8, 0 of 23;
  backend 15, 3, 0 of 18; factory 9, 1, 0 of 10; hardening 11, 10, 0 of 21.
- The states were read from the code on 2026-11-20; the readers ran no test, so a staging proof is the book's record.
  Production: `bring-up` ran 2026-11-21 (`BRING-UP OK: 37 changed`); no tables, data or functions yet, the first promote waits on him.
- The order (owner, 2026-11-20): clusters, each done in one go, in this order: 1 the book tells the truth;
  2 small product gaps, code only; 3 backups for real; 4 staging caught up and proven; 5 large tenant; 6 production
  exists; 7 protected publish and go-live; 8 the first client live; 9 search numbers and AI answers; 10 the audit by one
  command; 11 self-serve (three parts reopened 2026-11-21, after 10).
- The method stays: one hand-over per job, the test first and seen red, the least code, one builder per job in its
  worktree who only stages, the head's intake, one landing by `omnikom land` on a tree that passed CI. WORKS = a test or
  journey step shows it; what staging has not shown says UNPROVEN. A second lane runs the audits; product lands first.

## Landed since the build reopened (owner, 2026-11-12)
- CRM (A15, A16, A21, A22): bulk owner and delete, the business's own statuses, export in a saved layout, import.
- Dashboard: Overview (B20, B21), sign-in from a real inbox (B1), restore (B8), invites (B17), delete and take off the site
  (B12), photos (B13, C8, B14, B25), past publishes (B11), instant frame and preview site (B15, part), Search health (B24,
  part), a failed check read line by line (B10, B9).
- Backend and hardening: mail outbox, lead limits, bounces, request ids and alerts, plan limits, pooler, headers, smoke and
  rollback, token path, retention, rich text, staff windows, production script, backups and drill, E13 (part), C11 (part).
- C19's staff call (migration 52); the publish sheet tells the truth once started; an audit for a client with no site.
- The truth keepers: CI checks the book and `work/map/` (rule 36); `omnikom truth` (drift report); `omnikom map` (the map).

## Not landed
- `check/seo/ai-oneshot`. The replay guard (migration 53) is in the tree and NOT on staging: the migration goes first, then its seven functions together (the head runs it).

## Staging, 2026-11-21
- Reachable; 42 of 42 migrations (52 applied 2026-11-21); 32 functions deployed (2026-11-20). Set on 2026-11-20: `GOOGLE_SERVICE_ACCOUNT_JSON`,
  `RESEND_WEBHOOK_SECRET`, `GITHUB_DISPATCH_TOKEN_V2`. The nightly backup is ON (`BACKUP_ENABLED` = true, 2026-11-21); restore run done.

## Migrations
- An unlanded migration takes the next free number above every file in the tree and lands in number order (staging applies
  in file-name order); no number is promised ahead. In the tree: through 53 (no 51).

## BLOCKED and UNPROVEN
- E21 on staging: the webhook exists, a real bounce through it is UNPROVEN. E9's new path: the token is set, a real publish is UNPROVEN.
- E13's timing at 50,000 leads: UNPROVEN, no number (stopped at 600 s). Production is empty: all of it UNPROVEN.

## Clients
- Each client's profile and go-live sheet are under `clients/<slug>/`. Domain switches wait for the owner's green light;
  nothing is changed at a client's domain, registrar or DNS before it, and no mail goes to a client from us. The newest
  client's search audit is final (its git-ignored `private` folder); the owner sends it himself.

## Machine
- One lock for every heavy local run (`~/.claude/scripts/heavy.mjs`); a run that waited it out is UNPROVEN. A test
  that depends on this machine is proven on the runner.
- Google from here: the IP is in Giza; captures only by desktop control in the owner's Edge. Staging has migration 20
  applied before 16 (KNOWN-6): repair before the first promotion.

## Open owner items
- Done: the sitting of 2026-11-20 (accounts, DNS, R2) and the owner list of 2026-11-21: self-serve reopened for three parts
  (after the audit), the head signs the audit's approvals up to 150 requests, the backup key pair, the restore run with his key,
  `bring-up` on production and `app.omnikom.ai` in DNS (his yes).
- Still his: later go's: the first promote, each client's domain switch and sign-offs. Every item: `work/map/owner.tsv`.
