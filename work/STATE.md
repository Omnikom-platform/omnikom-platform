# Where things stand

Rewritten in place, never appended. Under 60 lines. Last rewritten 2026-11-05 05:30 by the head of operations (work order 11).
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
- Block 3a, the CRM screens (`59e947e`, test fix `33d59c2`, CI 9 of 9): staging flows 2026-11-05 flows 5 of 5, plan-gate
  4 of 4, site 6 of 6, styles 20 of 20, from the branch; the first flows run had 2 reds (a 90 s timeout, a lead send failing
  silently): an open flake, cause unknown. Nine CRM rows moved to WORKS; A15 (bulk owner and delete not on screen), A21, A22
  stay PARTLY.
- SEO work orders 05 (`d6076e8`, the audit summary per publish) and 06 (`c17af7b`, plain-word names in
  `tools/audit/names.json`); 09, the six-question report, on `check/seo/six-question-report`. CI checks the icm index.
- Known gap: CI runs no job for `tools/crm-map` tests or mutants (its full local run: 118 of 119 caught, 1 target text
  missing, 0 survived); CLI's ci-coverage slice adds it and lists every other suite no CI job runs.
- Settings, block 4 (work order 08): staging 2026-11-09 from its branch, e2e-settings 0 problems, flows 9 of 10, plan gate
  6 of 6; B3, B16, D8 WORKS; the invite (C13, B17) waits for the owner's inbox. Staging runs master again from this land.
- Product counts (`1-product.md`, computed from the rows): CRM 18, 3, 5 of 26; dashboard 10, 6, 5 of 21; backend 12, 4, 1
  of 17; factory 10, 0, 0 of 10; hardening (part E) 2, 12, 7 of 21. Total 52 works of 95 (the book checks its own counts, H0-6).

## Next, in order

Every department starts from its lowest open hardening stage (`9-blocks.md` "Hardening steps", work order 11), then its
feature blocks.
1. Platform build: H0-1 to H0-5; land 08 settings (`47c725b`) and 10 seo-read (`1fa9059`); H1 steps; then 3b, 5, 6, 7.
2. CLI and testing: ci-coverage (`190b9e2`), land retries, H2-10; a journey step per block platform lands.
3. SEO and audits: 4b, questions 2 to 5 of the report; then the omnikom.ai site plan (`9-blocks.md`).
4. Head of operations: H0-6 done (work order 12); cut old logs and charters.

## Open owner questions

- Status board: fixed five statuses or custom stages? (A16 waits on it.)
- Backups (H1-1): Supabase Pro with point-in-time restore, or the nightly dump with an R2 bucket (money, his call).
- Answered 2026-11-05: invite-mail proof to abdoamer683@gmail.com; "Ask Omnikom" address after the omnikom.ai setup;
  Google Contacts export low priority; the platform's domain is omnikom.ai (`8-routing.md`), omnikom.io stays the company's.

## Blocked on the owner's click

- omnikom.ai DNS and the Resend sending domain (then a real magic link from an inbox to staging).
- Production: parked by ruling until staging proves the backend, the dashboard and the CRM (H1-2 scripts it).
