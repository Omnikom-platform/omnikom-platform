# Where things stand

Rewritten in place, never appended. Under 60 lines. Last rewritten 2026-11-04 17:50 by the head of operations.
What the product is and every feature's state: `docs/product/1-product.md`. Proof of past work: the commit messages and
their CI runs, and `docs/blueprint/PROGRESS.md`.

## Where things live (work order 04, `work/04-workspace-home/CONTEXT.md`)

- Sessions open at `E:\Omnikom Platform` (short CLAUDE.md, README.md). This repository is `code\main` there, a clone of
  GitHub master (remote `backup-gh`); builders work in worktrees `departments\<slug>\builders\<slice>` (start-builder.mjs makes
  them); `omnikom land` fast-forwards `code\main` after a land when it is clean. Getting back in: `resume\RESUME.md`, Desktop
  "Start Omnikom" and "Resume Head of Ops". The old top-level checkout and launchers are frozen in `archive\`; a full copy of the
  old workspace is `E:\Omnikom Platform Backup 2026-11-04` (3456 files).
- Running (launchers in `resume\`, Opus 5.5): HEAD_Platform-build_2026-11-04b, HEAD_CLI-and-testing_2026-11-04b,
  HEAD_SEO-and-audits_2026-11-04b, reporting to HEAD-OF-OPERATIONS_Omnikom_Platform (session 7e47f4d5). Clients has no head
  (no HANDOVER). Nothing is held only on this laptop: 14 `check/archive-2026-11-04/*` branches on GitHub hold the old local work.
- Lands: when two green branches race, the head of operations sets the order (a branch refused twice gets a held slot).

## Now

- Block 1, the CRM backend (`41ab89a`), and block 2, export and import in the client's own format (crm-2 `0d4f588`, fix
  `aca2542`; M15, `crm-map-propose`, `crm-template-save`, `lead-export` `template`, `lead-import`): proven on staging
  2026-11-04 ("PASS: CRM export and import on staging, 0 problem(s)", 18 checks; e2e-crm and e2e-screens still PASS).
  CLI journey J7 to J10 cover field edit, search, filter, typed sort, bulk and export columns on staging (`5809e85`, "10 PASS,
  0 NOT BUILT YET, 0 FAIL"); push steps gone. No CRM screen uses any of this yet (block 3).
- SEO work order 05 (`d6076e8`): every publish's audit gives a versioned summary (`tools/audit/summary.mjs`, `run.mjs
  --summary`); the dashboard's "Search health" page is specified in `6-dashboard.md`. CI checks the icm index (`293e7fb`).
- Product counts (`1-product.md`): CRM 9 works, 12 partly, 5 missing of 26; dashboard 8, 7, 7 of 22; backend and database
  12, 4, 1 of 17; factory and forms 9, 1, 0 of 10. Total 38 works of 75 (no row moved to WORKS yet: every new CRM part waits
  for its screen).
- Leads scale: no index per industry key; revisit when one workspace passes about 50,000 leads (`3-database.md`).
- The product book `docs/product/` replaces `docs/blueprint/` and `planning/DECISIONS.md` (old files in `archive/`); five
  old files stay in `docs/blueprint/` because code reads them, superseded by the book where they disagree.

## Next, in order

1. Platform build, in its charter's block order: seo-read (F1, F2: audit summary stored per site and read by the dashboard,
   M16), 3a the CRM screens and 4 settings and account (builders 07 and 08 running), then 3b new CRM features, 5 site content,
   6 overview and numbers, 7 onboarding.
2. CLI and testing: seed workspace keeps the CRM column order, journey J11 for block 2, crm-map F1 and F2, land retries
   (network, lock release, its own stale lock), then a journey step per block platform lands.
3. SEO and audits: work order 06, plain-word names for the audit families; then slice 4, the six-question report.
4. Head of operations: cut old logs and charters to what is true now; remove the temporary GitHub hosts pin (owner's UAC
   click) when the heads are idle.

## Open owner questions

- Status board: fixed five statuses or custom stages? (A16 waits on it.)
- The "Ask Omnikom" email address for the dashboard's Websites card (`VITE_ASK_EMAIL`; the link is hidden until set).
- A real Google Contacts CSV export from a test account, to check `templates/google-contacts.json` (the test is skipped).

## Blocked on the owner's click

- A magic link from a real inbox to the staging app: the DNS record for `app-staging`.
- Backups: the R2 bucket, a second provider and the offline key (`backup.yml` waits).
- Production: parked by ruling until staging proves the backend, the dashboard and the CRM.
