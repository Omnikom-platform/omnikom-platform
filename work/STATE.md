# Where things stand

Rewritten in place, never appended. Under 60 lines. Last rewritten 2026-11-05 01:25 by the head of operations.
What the product is and every feature's state: `docs/product/1-product.md`. Proof of past work: the commit messages and
their CI runs, and `docs/blueprint/PROGRESS.md`.

## Where things live (work order 04, `work/04-workspace-home/CONTEXT.md`)

- Sessions open at `E:\Omnikom Platform` (short CLAUDE.md, README.md). This repository is `code\main` there, a clone of
  GitHub master (remote `backup-gh`); builders work in worktrees `departments\<slug>\builders\<slice>` (start-builder.mjs makes
  them); `omnikom land` fast-forwards `code\main` after a land when it is clean. Getting back in: `resume\RESUME.md`, Desktop
  "Start Omnikom" and "Resume Head of Ops". The old top-level checkout and launchers are frozen in `archive\`; a full copy of the
  old workspace is `E:\Omnikom Platform Backup 2026-11-04` (3456 files).
- Running (launchers in `resume\`, Opus 5.5): HEAD_Platform-build_2026-11-04b, HEAD_CLI-and-testing_2026-11-04b,
  HEAD_SEO-and-audits_2026-11-04b, reporting to HEAD-OF-OPERATIONS_Omnikom_Platform (7e47f4d5); old local work: 14 GitHub
  branches `check/archive-2026-11-04/*`.
- 2026-11-05 01:20: week at 89%, wind-down ordered: each head finishes only its in-flight slice, pushes every builder's work
  and writes a HANDOVER block in its charter before 94%. The next account starts from "Start Omnikom" (`resume\RESUME.md`).

## Now

- Block 1, the CRM backend (`41ab89a`), and block 2, export and import in the client's own format (crm-2 `0d4f588`, fix
  `aca2542`; M15, `crm-map-propose`, `crm-template-save`, `lead-export` `template`, `lead-import`): proven on staging
  2026-11-04 ("PASS: CRM export and import on staging, 0 problem(s)", 18 checks; e2e-crm and e2e-screens still PASS).
  CLI journey J7 to J10 cover field edit, search, filter, typed sort, bulk and export columns on staging (`5809e85`, "10 PASS,
  0 NOT BUILT YET, 0 FAIL"); J11 covers block 2 (`4bfaac7`); push steps gone. crm-map F1, F2 (`03a56b5`).
- Block 3a, the CRM screens (`59e947e`, CI 9 of 9): UNPROVEN on staging. Its first staging flows showed 5 of 17 red; the
  causes found were fragile tests (an ambiguous label, "Budget (USD)", tests relying on leads deleted that afternoon), fixed on
  `check/platform/crm-screens-2`, whose staging flows were running at 01:15. No CRM row moves until they pass.
- SEO work orders 05 (`d6076e8`, the audit summary per publish) and 06 (`c17af7b`, plain-word names in
  `tools/audit/names.json`); 09, the six-question report, on `check/seo/six-question-report`. CI checks the icm index.
- Known gap: CI runs no job for `tools/crm-map` tests or mutants (its full local run: 118 of 119 caught, 1 target text
  missing, 0 survived); CLI's ci-coverage slice adds it and lists every other suite no CI job runs.
- Product counts (`1-product.md`): CRM 9 works, 12 partly, 5 missing of 26; dashboard 8, 7, 7 of 22; backend and database
  12, 4, 1 of 17; factory and forms 9, 1, 0 of 10. Total 38 works of 75 (no row moved to WORKS yet: every new CRM part waits
  for its screen).

## Next, in order

1. Platform build: land crm-screens-2 when its staging flows pass, then move the CRM rows; 08 settings and account (pushed,
   its backend goes to staging only from a CI-green tip); 10 seo-read (audit summary per site for the dashboard, M16); then
   3b new CRM features, 5 site content, 6 overview and numbers, 7 onboarding.
2. CLI and testing: with-env's 10-minute cap (`WITH_ENV_TIMEOUT_MIN`, exit 124 on timeout); ci-coverage; land retries
   (network, lock release, its own stale lock); a journey step per block platform lands.
3. SEO and audits: land 09; then 4b, questions 2 to 5 of the report from the skill's files.
4. Head of operations: cut old logs and charters to what is true now; remove the temporary GitHub hosts pin (owner's UAC
   click) when the heads are idle.

## Open owner questions

- Status board: fixed five statuses or custom stages? (A16 waits on it.)
- The "Ask Omnikom" email address for the dashboard's Websites card (`VITE_ASK_EMAIL`; the link is hidden until set).
- A real Google Contacts CSV export from a test account, to check `templates/google-contacts.json` (the test is skipped).
- One inbox for the staging invite-mail proof (C13, `SETTINGS_INVITE_EMAIL`; one real mail, the login it makes stays).

## Blocked on the owner's click

- A magic link from a real inbox to the staging app: the DNS record for `app-staging`.
- Backups: the R2 bucket, a second provider and the offline key (`backup.yml` waits).
- Production: parked by ruling until staging proves the backend, the dashboard and the CRM.
