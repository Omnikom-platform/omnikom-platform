# Where things stand

Rewritten in place, never appended. Under 60 lines. Last rewritten 2026-11-02 by the head of operations' book builder.
What the product is and every feature's state: `docs/product/1-product.md`. Proof of past work: the commit messages and
their CI runs, and `docs/blueprint/PROGRESS.md`.

## Now

- master: `4a5da4d` (5-PX landed, run 41518740286, 9 of 9 jobs). All departments are parked from their HANDOVER blocks
  until the weekly usage resets (Wed 18:00) or the owner switches accounts.
- Product counts (`1-product.md`, checked on master `4a5da4d`): CRM 9 works, 9 partly, 8 missing of 26; dashboard 8, 7, 7 of
  22; backend and database 12, 4, 1 of 17; factory and forms 5, 4, 1 of 10. Total 34 works of 75.
- The product book `docs/product/` replaces `docs/blueprint/` and `planning/DECISIONS.md`; the old files are in
  `archive/2026-11-02-blueprint/`. Five old files stay in `docs/blueprint/` because code reads them: `04-DASHBOARD.md` and
  `16-DESIGN-PARTS.md` (plan gate, auth-email check), `05-BUILD-PLAN.md` and `06-PRD.md` (spec check), `25-BUILD-SEQUENCE.md`
  (`tools/tick-sequence.mjs`). Their content is superseded by the book where they disagree.
- In parallel: `tools/icm/` and `icm/` (the index, the code map, the librarian), built by its own builder.

## Next, in order

1. Platform build starts on the CRM, backend first: lead field edit (`service.lead_set_fields`, an `edited` event), then the
   record screen; the test site gets an industry form with choice and number fields; then views, columns, filter, sort, bulk,
   delete, export with every column, export and import in the client's layout (`1-product.md` "Order of work").
2. CLI and testing adds a journey step per CRM feature and removes the push steps J8 and J9.
3. Head of operations: route the findings of the book slice to their owners; the repo cleanup slice (leftover worktrees, stray
   files; old logs and charters cut to what is true now).

## Open owner questions

- Delete a lead: hard (today: row removed, audit and consent ledger kept) or a hidden soft delete?
- Imported leads: what consent text do they carry?
- Status board: fixed five statuses or custom stages?
- Which core lead fields are editable (the consent record never is).

## Blocked on the owner's click

- A magic link from a real inbox to the staging app: the DNS record for `app-staging`.
- Backups: the R2 bucket, a second provider and the offline key (`backup.yml` waits).
- Production: parked by ruling until staging proves the backend, the dashboard and the CRM.
