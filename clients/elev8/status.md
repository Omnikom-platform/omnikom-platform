# ELEV8 Real Estate Group: status

**One line (copied into `clients/README.md`):** Go-live prepared 2026-11-09, not live: the launch build has no sample listings (empty state, checked), 22 old-site redirects and the Sheet-plus-alert lead path built and tested offline (strict gate 14 of 14); go-live waits on Alex's answers and the agreement, GoDaddy access, and the owner's clicks to deploy the Apps Script and redeploy the preview for one test lead.

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
| 2 | Real media | licensed stock with credits, team monograms; listings: samples retired 2026-11-09, empty state until real rows | headshots (Q6), their own listings as rows |
| 3 | Live forms | 2026-11-09: `/api/lead` Function forwards to an Apps Script Sheet plus alert, tested offline; standalone per the owner, the platform later | owner's clicks: Apps Script deploy, preview variables, one test lead |
| 4 | Search link | old IDX cut; Buy tab opens the home-finder wizard | nothing |
| 5 | Redirects from the old site | 2026-11-09: 47 old URLs, 22 rules in `_redirects`, redirects check PASS | proof on real Pages at the preview redeploy |
| 6 | noindex off | `node build.mjs --launch` | blocks 1 to 5 |
| 7 | Strict gate | 13/13 on the preview build | re-run on the final launch build |
| 8 | Search Console + domain | not started | the client's domain access (nameservers, DECISIONS 26); Search Console on the Omnikom account |
| 9 | Partner logos | Better Rate Mortgage official logo; others text marks | Q11 permission and logo files |
| 10 | Broker of record per agent | shown from a sourced table in `build.mjs` | a `brokerOfRecord` field on the contract's team collection (platform); DRE re-read before launch |

## Open items (who holds each)
- Alex (via Dave): the Launch Information Request answers (Q1 to Q11), the agreement, which lines of business get their own site.
- Owner: decided 2026-10-30 21:58 "A workspace per site"; what moves and what is shared "we will determine after a meeting" (the client meeting; the owner brings the words back to this department); the look-folder sign-off at build step 4; the production project, domain and endpoint swap at steps 6 and 7 (owner's click, DECISIONS 30).
- Platform build: `brokerOfRecord` on the team collection (launch block 10); live `captureLead` behind the site (block 3). Both are findings for the head of operations, not this department's work.
- Known gaps in the draft: C124 (home_value title suffix, the owner's rows.json); WG-2 wasted CSS 11.7 KiB gzip on the home desktop sheet vs the 8 KiB rule (one PageSpeed flag); Fairfield city page at 97 by the owner's "Accept 97".
- Film "The Signal Finds You": on hold (owner).

## Go-live 2026-11-09 (owner: "soon today we will be going live with elev8 and rainmaker websites"; 06:33 standalone, platform later; 06:34 domain access not ready, sample listings must not go live)
The sheet: `go-live-2026-11-09.md` (what is proven, what blocks with its holder, the forms, the domain steps, the owner's clicks).
- DONE in `E:\Alex Sevilla` (no git there; source backup `backups\draft-site-src-2026-11-09-0640` taken first), by two Sonnet
  builders, gates re-run by the head: listings empty state and no sample anywhere (launch blocks 2 and 6 for listings); 22
  old-site redirects in `_redirects` (block 5); the lead path wizard to `/api/lead` to a Pages Function to an Apps Script Sheet
  plus alert, and a launch deploy that refuses without it (block 3, standalone form per the owner). `LAUNCH-CHECKLIST.md` blocks
  2, 3 and 5 are now out of date there (not edited; this record and the sheet are current).
- The builder moved 13 ELEV8 tool paths to `E:\Omnikom Platform\code\main` (the platform repo moved); they failed on import before.
- DNS: `evidence-2026-11-09/dns-elev8ca.md` and the draft zone `elev8ca.com.zone-draft.txt` (checked against public DNS, 7 of 7).
- 2026-11-09 21:30 (SEO work order 29 gap): "Ask about this home" is its own lead type `listing-question`, never "buy": the
  wizard sends flow `listing-question` and no preset topic; the Apps Script stores Lead type `listing-question` in "Listing
  questions" (no Topic column). apps-script tests 32/32, watched red 31/32 with the line removed, lead-chain 8/8. The browser
  side has no page to run on until a real listing exists (UNPROVEN in a browser).
- UNPROVEN: the Apps Script and the Function on real Google and Cloudflare; `_redirects` on real Pages; who gets the alert (Q9).
- Open, added 2026-11-09:
  - Owner: deploy the Apps Script; "set and redeploy" the preview (variables, today's build, one test lead); "switch"; "deploy"; "submit".
  - Alex (via Dave): Q1 to Q11 including the alert address; GoDaddy access, the DNS export and a date; the SendGrid sender;
    whether `homes.elev8ca.com` must stay.
  - LATER (owner 2026-11-09 06:33): wire the site to the platform when it is ready: `functions/api/lead.js` swaps the Apps
    Script for the platform's `captureLead` (only that file and `LEAD_SHEET_ENDPOINT` change), the Sheet's leads move into the
    platform inbox; the site moves to its look-folder and content load.
  - LATER (owner 2026-11-09 06:34): listings move to the dashboard's own listings screen when it exists; until then a real
    listing the client sends is one row in `content/rows.json` and a rebuild (`draft-site\ADD-A-LISTING.md`).
  - Omnikom (Clients) after launch: WG-2 home CSS 12.4 KiB vs 8 KiB, WG-4 flaky; C124 stays with the owner's rows.

## Profile passes
RESUME finishes an unfinished profile (only what is missing is added); RE-EVALUATE is a dated new pass on a finished one (stable facts
such as the entity, filings and history are kept and re-checked; time-sensitive ones such as follower counts, reviews and addresses
on listings are re-read, with a "what changed since <date>" note). Newest last; an older pass is never overwritten (owner 2026-11-11).

| Date | Mode | What the pass did | By |
|---|---|---|---|
| before 2026-11-11 | not recorded (profiled before this rule; see Last updated) | the record and the go-live check | earlier Clients sessions |

## Last updated
- 2026-10-30: record created by the Clients head (slice 1) from `E:\Alex Sevilla` read-only; the split recorded in `sites.md` as waiting for the agreement.
- 2026-10-30 21:58: the owner's answers written into `decisions.md` and `sites.md` (workspace per site; pages and sharing after the client meeting).
- 2026-11-09: go-live check by HEAD_Clients_2026-11-09 (status line, launch blocks 2, 3 and 5, the section above, `go-live-2026-11-09.md`, `evidence-2026-11-09/`).
- HANDOVER 2026-11-09 22:00 (HEAD_Clients_2026-11-09 stops, week at 92%): next for ELEV8, in order: (1) re-run `node build.mjs`
  and `node tools/wizard-test.mjs` in `E:\Alex Sevilla\draft-site\site` under `heavy.mjs` (the 21:40 run was stopped for low
  memory; last pass 16/16 is from before the listing-question change); (2) the owner's clicks in `go-live-2026-11-09.md`
  section 5. Files changed outside the repo today (no git there): `draft-site\site\src\pages\wizard.js`,
  `integrations\apps-script\Code.gs`, `tests\apps-script.test.mjs` (copies before the 21:30 change are in this session's scratchpad only).
- HANDOVER update 2026-11-09 22:45: the listing-question change is PROVEN in a browser. `tools/wizard-test.mjs` has a new case
  "listing question (Ask about this home)" (runs only where the button exists) and a flow check. Real build: `WIZARD TEST PASS:
  16 runs ... 4 skipped`; scratch build with one real listing: `WIZARD TEST PASS: 20 runs`; watched red with the old line:
  `FAIL listing question ... leadType is "buyer", expected "listing-question"`, `WIZARD TEST FAIL: 2 of 20`; restored and
  rebuilt. Finding for Platform build (owns `contracts/`): the ELEV8 contract's contact `leadType` enum is buyer, seller,
  both, other; it needs `listing-question` before the platform wiring. Nothing else open without an owner click.
