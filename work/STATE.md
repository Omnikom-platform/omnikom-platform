# Where things stand

Rewritten in place, never appended. Under 60 lines. Last rewritten 2026-11-04 by work order 04 (one home for all work).
What the product is and every feature's state: `docs/product/1-product.md`. Proof of past work: the commit messages and
their CI runs, and `docs/blueprint/PROGRESS.md`.

## Where things live (work order 04, `work/04-workspace-home/CONTEXT.md`)

- Sessions open at `E:\Omnikom Platform` (short CLAUDE.md, README.md). This repository is `code\main` there, a clone of
  GitHub master (remote `backup-gh`); builders work in worktrees `departments\<slug>\builders\<slice>` (start-builder.mjs makes
  them); `omnikom land` fast-forwards `code\main` after a land when it is clean. Getting back in: `resume\RESUME.md`, Desktop
  "Start Omnikom" and "Resume Head of Ops". The old top-level checkout and launchers are frozen in `archive\`; a full copy of the
  old workspace is `E:\Omnikom Platform Backup 2026-11-04` (3456 files).
- Running since 2026-11-04 07:50 (launchers in `resume\`): HEAD_Platform-build_2026-11-04, HEAD_CLI-and-testing_2026-11-04,
  HEAD_SEO-and-audits_2026-11-04 (Opus 5.5), reporting to HEAD-OF-OPERATIONS_Omnikom_2026-11-02e. Clients has no head (no
  HANDOVER). Nothing is held only on this laptop: 14 `check/archive-2026-11-04/*` branches on GitHub hold the old local work.

## Now

- master before work order 04: `51a0a10` (work order 02 written). Block 1 `41ab89a` (the CRM backend; CI run 41589140733, 9 of 9 jobs). Proven on staging
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

1. Platform build: block 2, CRM export and import in the client's own format (`work/02-crm-export-import/CONTEXT.md`; F3,
   `add_lead` typed, is its setting 8): built on `check/platform/crm-2` (M15, four functions, `e2e-crm-io.mjs`); the land and
   the staging proof are the head's. The CRM screens on the new backend are block 3.
   Block 4, Settings and account (work order 08, `work/08-settings/CONTEXT.md`): built on `check/platform/settings` (M17 `list_members` and
   `invite_context`; functions `team-list`, `member-remove`, `invite-member` with the mail, `settings-save` alerts only; `crm-test` removed;
   the Settings screen). Landing, the staging proof and the real invite mail are the head's; findings are in the order.
2. CLI and testing: slice crm-journey, a journey step per CRM feature (field edit, server list, bulk, export columns) and the
   push steps J8 and J9 removed; then the ci.yml `tools/icm/index.mjs --check` step; then review platform's seed.mjs edit.
3. SEO and audits: the skill's old paths, then slice audit-results (each publish's audit result per site, backend first); the
   SEO tools page spec comes to the head of operations before any screen work; slice 4 after.
4. Head of operations: cut old logs and charters to what is true now; remove the temporary GitHub hosts pin (owner's UAC
   click) when the heads are idle.

## Open owner questions

- Status board: fixed five statuses or custom stages?

## Blocked on the owner's click

- A magic link from a real inbox to the staging app: the DNS record for `app-staging`.
- Backups: the R2 bucket, a second provider and the offline key (`backup.yml` waits).
- Production: parked by ruling until staging proves the backend, the dashboard and the CRM.
