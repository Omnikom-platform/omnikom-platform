# Where things stand

Rewritten in place, never appended, under 60 lines; last 2026-11-09 21:30 by the head of operations. Every feature's state:
`docs/product/1-product.md`; proof of past work: the commit messages, their CI runs, `docs/blueprint/PROGRESS.md`.

## Where things live (work order 04, `work/04-workspace-home/CONTEXT.md`)

- Sessions open at `E:\Omnikom Platform`. This repository is `code\main` there, a clone of GitHub master (remote `backup-gh`,
  a PUBLIC repo: owner 2026-11-09, it stays public, nothing moves, he handles it; do not raise it again). Builders work in
  worktrees `departments\<slug>\builders\<slice>`; `omnikom land` fast-forwards `code\main`. Getting back in: `resume\RESUME.md`.
- Running 2026-11-09 (launchers `resume\start-HEAD_*_2026-11-09.cmd`, Opus 5.5): HEAD_Platform-build, HEAD_CLI-and-testing,
  HEAD_SEO-and-audits, HEAD_Clients (each `_2026-11-09`), reporting to HEAD-OF-OPERATIONS_Omnikom_Platform (7e47f4d5).
- Drive E: filled twice on 2026-11-09 (`E:\web video` cache, ~6 GB an hour): check free space before a land or a big write.
- GitHub Actions major outage from 2026-11-09 20:29: no lands until githubstatus shows Actions operational. Then, in order:
  platform 10 (`check/platform/seo-read`, with the A16 ruling 421a343), CLI J13, SEO 28 `40ca9ff`, SEO 29 `1bbfe00`, this file.

## Landed 2026-11-09 (each CI 9 of 9 on its exact tip)
CLI ci-coverage `671b4ee`, land retries 20 `edc9563`, dep-scan 21 `862f50c` (E17 WORKS), journey J12 CRM screens 22 `91910b6`,
land lock only around the push 23 `4c14d0d`. Head of operations: book check 12 `ad95891` (H0-6). Platform: reaper 13 `526058e`
(H0-1, E4 PARTLY), minimal build environment 14 `890a33d` (H0-3), settings 08 `6742d24` (B3, B16, D8 WORKS), security events
15 `7373524` (H0-2, E5 PARTLY). SEO: report questions 2 to 5 25 `03464ae`, "not found in the link data" 27 `5cef4f1` (skill
SOURCE then c41d767; 28 moves it to 78d8b3d).

## Now

- Product counts (`1-product.md`, computed from the rows, checked by `tools/icm`): CRM 18, 3, 5 of 26; dashboard 10, 6, 5 of
  21; backend 12, 4, 1 of 17; factory 10, 0, 0 of 10; hardening (part E) 2, 13, 6 of 21. Total 52 works of 95 (B19, the webhook
  card of the dropped push, removed by 08). Hardening steps H0: 4 of 6 done (H0-4 media limits building as 16; H0-5 waits on
  the owner's token).
- Platform building: 16 media limits (H0-4, migration 21), 18 CRM block 3b backend (A13, A14, A17, A18; migration 22); then 19
  the 3b screens and 20 the status board (A16).
- A16, owner 2026-11-09: two columns. Lead type, per industry, set from the form and what was asked ("Enquiry" for just
  asking); Status, what happened: not contacted yet, contacted (by whom), answering machine, no answer, voicemail left, wrong
  number, call back, follow-up (both dated), qualified, not qualified, not interested, interested in something specific,
  appointment set, do not contact. Notes carry time and author. Lists are data per industry, never code: SEO 29
  `work/29-lead-types/` (real estate 15 types, insurance and financial 15, statuses 19, each sourced).
- Clients (`clients/<slug>/go-live-2026-11-09.md`, branch `check/clients/go-live-2026-11-09` `e95fcc3`): both sites go live
  standalone, wired to the platform later. ELEV8 not live: listings empty state, 22 old-site redirects, Sheet-plus-alert forms
  built and checked offline; the "Ask about this home" lead type is being fixed. Rainmaker: rwifinancial.com has served an
  edited, indexable copy of our preview from another Cloudflare account since 2026-11-06 19:51 UTC, legal blanks public; who
  moved it is BLOCKED (Dave, or Monica's GoDaddy log); consent tick REQUIRED (`E:\Rainmaker` 48da581, local), needs Monica's OK.
- Open: the CRM screens flows' first run on 2026-11-05 had 2 reds, cause unknown; `tools/team-kit/test-agent-hooks.mjs`
  is broken (ENOENT, `tools/icm/agents/roles.json` does not exist), no owner yet.

## Next, in order

1. Platform build: land 10; 16, 18, 19, 20; H0-5 after the owner's token; H1 steps; then blocks 5, 6, 7.
2. CLI and testing: J13 settings (pushed when built), a journey step per block platform lands, osv-scanner ensure on the laptop.
3. SEO and audits: land 28 and 29; work order 31 (report.mjs:206 "but not to this site", the never-applied test-compare mutant);
   then the omnikom.ai plan (26 part 2) after the owner's four answers.
4. Clients: the ELEV8 lead-type fix; the owner's clicks in each go-live sheet.

## Open owner questions and clicks

- Backups (H1-1): Supabase Pro with point-in-time restore, or the nightly dump to an R2 bucket (money). Production stays
  parked until staging proves the backend, the dashboard and the CRM (H1-2 scripts it).
- GitHub fine-grained token `GITHUB_DISPATCH_TOKEN_V2` (Actions R/W, Metadata R, this repo only) in the master `.env`; then
  the ruleset from 17 dispatch-scope. omnikom.ai DNS and the Resend domain; the omnikom.ai answers (country and language,
  cities, first step, Search Console status). ELEV8 and Rainmaker clicks: the last section of each go-live sheet.
