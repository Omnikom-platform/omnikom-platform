# ELEV8 Real Estate Group: status

**One line (copied into `clients/README.md`):** Client in onboarding: audit done, 42-page preview live (noindex) and paused since
2026-10-29 20:48; Launch Information Request waiting on Alex; the split into two or three sites waits on the agreement (owner
2026-10-30 21:32).

## Phase
| Phase | State | Proof (file or output) | Waits on |
|---|---|---|---|
| Prospect audit | DONE 2026-10-26 | `E:\Alex Sevilla\REPORT.md`, `REPORT.pdf`, `EVIDENCE.md` (every number sourced), `MEETING-BRIEF.md` | nothing |
| Launch Information Request (11 questions) | SENT to Dave 2026-10-29 04:17 with the PDF; no answer recorded | `deliverables\Omnikom-Launch-Information-Request-ELEV8.pdf`; `E:\Alex Sevilla\.claude\POSITION.md` "PARKED again 2026-10-29" | Alex (via Dave) |
| Agreement | NOT RECORDED: no agreement document in the project folder; the owner says the site count (2 or 3) follows "the agreement we will have with them" | `profile.md` "Agreement" | Dave and the client; the owner tells this department the terms |
| Plan approval | DONE for the current single site: targets 2026-10-27, plan (31 search pages) and business.json signed 2026-10-29 under the owner's delegation; `/blog` added 2026-10-28 | `site-checks\elev8ca.com\.pewp\approved\lock.json`; `draft-site\DONE-REPORT.md` row 1a | A new plan per site once the split is agreed (see `sites.md`) |
| Design | DONE: V4 direction, mega menu V1 "editorial columns", stage 3 phone layout; "Accept 97" closed the last speed item | `draft-site\design`, `megamenu-lab`, `STAGES-2026-10-29.md`; `.claude\POSITION.md` 2026-10-29 20:47 | The look-folder sign-off in the platform (build step 4) |
| Build and preview | DONE and PAUSED: build final26 live at https://elev8-omnikom-website.pages.dev (noindex); gate 13/13, check 57x5, wizard 16/16, CTA 16/16, nav PASS, lint 16x5; PageSpeed mobile 99/99/97/99/98, desktop 100 x5 | `draft-site\site\gate-out\final26-chain.txt`; `site-checks\live-audit-2026-10-29\PSI-FINDINGS.md` | "a word from the client" (owner 2026-10-29 20:48) |
| Launch | NOT STARTED: 10 blocks, see below | `draft-site\LAUNCH-CHECKLIST.md`; `draft-site\LAUNCH-ENTERPRISE.md` (22 items) | blocks 1 to 5 wait on the client; block 3 on the platform's live `captureLead` (build step 7, DECISIONS 30) |
| Monthly service | not applicable yet | | |

## Launch blocks (from `draft-site\LAUNCH-CHECKLIST.md`, 2026-10-29)
| # | Block | State | Waits on |
|---|---|---|---|
| 1 | Approved wording | our drafts on every page; client facts as row edits | Alex's answers (DECISIONS 17) |
| 2 | Real media | licensed stock with credits, team monograms, 4 marked sample listings | headshots (Q6), their own listings as rows |
| 3 | Live forms | wizards post LeadRequest to `/api/lead`; the preview stub sends nothing | the platform's `captureLead` behind the site's endpoint (step 7) |
| 4 | Search link | old IDX cut; Buy tab opens the home-finder wizard | nothing |
| 5 | Redirects from the old site | old routes known from the backup | a `redirects` row per old URL before the domain switch |
| 6 | noindex off | `node build.mjs --launch` | blocks 1 to 5 |
| 7 | Strict gate | 13/13 on the preview build | re-run on the final launch build |
| 8 | Search Console + domain | not started | the client's domain access (nameservers, DECISIONS 26); Search Console on the Omnikom account |
| 9 | Partner logos | Better Rate Mortgage official logo; others text marks | Q11 permission and logo files |
| 10 | Broker of record per agent | shown from a sourced table in `build.mjs` | a `brokerOfRecord` field on the contract's team collection (platform); DRE re-read before launch |

## Open items (who holds each)
- Alex (via Dave): the Launch Information Request answers (Q1 to Q11), the agreement, which lines of business get their own site.
- Owner: the three split questions in `sites.md` (workspace shape, what moves, what is shared); the look-folder sign-off at build step 4; the production project, domain and endpoint swap at steps 6 and 7 (owner's click, DECISIONS 30).
- Platform build: `brokerOfRecord` on the team collection (launch block 10); live `captureLead` behind the site (block 3). Both are findings for the head of operations, not this department's work.
- Known gaps in the draft: C124 (home_value title suffix, the owner's rows.json); WG-2 wasted CSS 11.7 KiB gzip on the home desktop sheet vs the 8 KiB rule (one PageSpeed flag); Fairfield city page at 97 by the owner's "Accept 97".
- Film "The Signal Finds You": on hold (owner).

## Last updated
- 2026-10-30: record created by the Clients head (slice 1) from `E:\Alex Sevilla` read-only; the split recorded in `sites.md` as waiting for the agreement.
