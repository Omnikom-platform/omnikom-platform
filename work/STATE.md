# Where things stand

Rewritten in place, never appended. Under 60 lines. Last rewritten 2026-11-03 after platform block 1 landed.
What the product is and every feature's state: `docs/product/1-product.md`. Proof of past work: the commit messages and
their CI runs, and `docs/blueprint/PROGRESS.md`.

## Now

- master: `41ab89a` (platform block 1, the CRM backend, landed; CI run 41589140733, 9 of 9 jobs). Proven on staging
  2026-11-03: `node supabase/tests/e2e-crm.mjs` 16 of 16 PASS ("PASS: CRM backend on staging, 0 problem(s)") and
  `e2e-screens.mjs` "PASS: staging end to end for the functions of the four screens, 0 problem(s)".
- What block 1 gave: lead form fields typed by the contract (C-FORM-*), drawn with no script; capture types every answer (M14);
  one call edits any field (`lead-update` `fields`, an `edited` event per change); server list with search, filter and sort
  on any column (`lead-list`); bulk status, owner and delete with a confirm flag (`leads-bulk`); CSV export with one column
  per field. The test site's contact form carries real-estate fields. No CRM screen uses these yet (block 3).
- Product counts (`1-product.md`, on master `41ab89a`): CRM 9 works, 12 partly, 5 missing of 26; dashboard 8, 7, 7 of 22;
  backend and database 12, 4, 1 of 17; factory and forms 9, 1, 0 of 10. Total 38 works of 75.
- Leads scale: no index per industry key; revisit when one workspace passes about 50,000 leads (`3-database.md`).
- The product book `docs/product/` replaces `docs/blueprint/` and `planning/DECISIONS.md` (old files in `archive/`); five
  old files stay in `docs/blueprint/` because code reads them, superseded by the book where they disagree.

## Next, in order

1. Platform build: block 2 of its five (the head writes its work order); the CRM screens on the new backend are block 3.
2. CLI and testing adds a journey step per CRM feature (field edit, server list, bulk, export columns) and removes the push
   steps J8 and J9.
3. Head of operations: route the open findings (`service.add_lead` stores manual answers untyped, work order 01 F3); the repo
   cleanup slice (leftover worktrees, stray files; old logs and charters cut to what is true now).

## Open owner questions

- Imported leads: what consent text do they carry?
- Status board: fixed five statuses or custom stages?

## Blocked on the owner's click

- A magic link from a real inbox to the staging app: the DNS record for `app-staging`.
- Backups: the R2 bucket, a second provider and the offline key (`backup.yml` waits).
- Production: parked by ruling until staging proves the backend, the dashboard and the CRM.
