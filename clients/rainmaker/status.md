# Rainmaker Wealth Innovations: status

**One line (copied into `clients/README.md`):** LIVE OUTSIDE OUR PROCESS (found 2026-11-09): a copy of our preview build is indexable on www.rwifinancial.com through a Cloudflare zone that is not ours (name servers changed at GoDaddy 2026-11-06, by whom UNPROVEN), without our headers or redirects and with the legal blanks public; our launch build is made and gated (strict 14 of 14); go-live waits on who holds that zone, Monica's phone, address and compliance OK, and domain access; forms post to the Rainmaker Sheet.

## Phase (the client lifecycle: onboarding = prospect audit, Launch Information Request, agreement, plan approval; then design, build, preview, launch, monthly service, offboarding)
| Phase | State | Proof (file or output) | Waits on |
|---|---|---|---|
| Prospect audit | NOT RUN as a scored presence report. Rainmaker was built by hand before the audit pipeline existed. Evidence that does exist: old-site capture, DNS export, research captures, code check (35 root causes, 0 critical) | `E:\Rainmaker\.pewp\captures\`, `E:\Rainmaker\.pewp\runs\2026-10-23-code-check.md`; the logged snapshot `site-checks/www.rwifinancial.com/snapshots/2026-10-23` is NOT FOUND | nothing for launch; a "before" snapshot for the monthly report is the owner's call |
| Launch Information Request (client question sheet) | PARTLY ANSWERED. The question email (7 groups) went to Dave to forward; Monica answered with licence certificates and details on 2026-10-23 and 2026-10-24; the update email of 2026-10-24 02:30 (sent by the owner, Dave in copy) asks 5 things that are still open | `E:\Rainmaker\deliverables\email-monica-launch-review.md`, `email-monica-update-2026-10-24.md`; `E:\Rainmaker\.claude\POSITION.md` lines 64, 65, 67 | Monica (via Dave) |
| Agreement | NOT RECORDED: no agreement document in the project folder; the offer document is general | `profile.md` "Agreement" | Dave and the client; the owner tells this department the terms |
| Plan approval | DONE 2026-10-23: 4 clusters, 5-page plan, 10 hash-locked plan files, signed by Abdo (entered by Claude on his instruction in chat) | `E:\Rainmaker\.pewp\approved\lock.json`, `plan\summary.md` | nothing |
| Design | DONE: concept D "Today / Tomorrow", teal and navy with gold, Poppins and Mulish, image-led layered components, design pass on all 12 pages | `E:\Rainmaker\icm\knowledge\DESIGN.md`; `E:\Rainmaker\.claude\POSITION.md` lines 50 to 58 | the look-folder `sites/rainmaker/design/` in the platform (M4 work order, DECISIONS 27) |
| Build and preview | DONE: final preview e1f42a39 (commit 2795017), gates reported green in the log (see `sites.md`; not re-run by this record); strict SEO gate 13 of 13 on a live build, no output file kept | `E:\Rainmaker\.claude\POSITION.md` line 66; https://rainmaker-omnikom-website.pages.dev read 2026-10-30 (HTTP 200, noindex) | nothing on our side |
| Launch | NOT STARTED: needs the legal pages' blanks filled (phone, mailing address), Monica's written OK and a date for the domain switch, GoDaddy access, then the `RMK_LIVE=1` build, deploy, checks, Search Console and Bing | `E:\Rainmaker\LAUNCH.md`; `E:\Rainmaker\deliverables\domain-migration-plan.md` | Monica (compliance, address and phone, GoDaddy, date) |
| Monthly service | not applicable yet; the growth loop and the lead hand-over to the platform inbox start after launch | `E:\Francine & Eli\deliverables\docs\OMNIKOM-setup-service.md` (general offer) | launch |

## Open items (who holds each)
- Monica (via Dave): compliance approval of the privacy policy, terms, insurance disclosures, the consent wording and the written copy; business phone and mailing address; edited portrait; the email-signing (DKIM) record; GoDaddy access, her written OK and a date for the name-server switch; her lead-alert address; whether Search Console, Analytics or a Google Business Profile already exist. Source: `E:\Rainmaker\deliverables\email-monica-update-2026-10-24.md` lines 18 to 23; `E:\Rainmaker\deliverables\report-dave-launch-status.md` lines 22 to 44.
- Dave: the relationship, forwarding and chasing the above, and the agreement terms (none on file).
- Owner (Abdo): whether the consent tick stays "Optional" (the built page) or returns to "REQUIRED" (his 2026-10-23 decision); the `sharp` dependency notice (left for him to decide); hosting at launch (Worker today, DECISIONS 28 says a Pages project per site); a Cloudflare token with Zone and DNS edit to make onboarding scriptable. Sources: `profile.md` consent note; `E:\Rainmaker\.claude\POSITION.md` line 69; `E:\Rainmaker\LAUNCH.md` lines 31 to 34; `planning/CONTEXT.md` "Technical lessons".
- Omnikom (Rainmaker work, unblocked since the 2026-10-26 budget reset): own compliance read of the copy (the variable-annuity wording); home LCP 3.5 s vs the 2.5 s target; remove inline scripts from the content-security policy (C11); Apps Script duplicate and rate limiting (C19); the apex to www redirect rule at launch (C10); delete the TEST row in the leads Sheet; confirm the 4 stock photo licences. Source: `E:\Rainmaker\.claude\POSITION.md` line 68; `E:\Rainmaker\LAUNCH.md` lines 11, 52 to 55.
- Platform build / Clients: Rainmaker's look-folder and content load are an M4 work order (DECISIONS 27); the lead flow moves from the Sheet to the platform inbox and a CRM push; OmniSuite's `external_lead_id` column waits on its lead API.
- Contradictions between project files (record only, nothing fixed here): (1) `E:\Rainmaker\LAUNCH.md` "Before launch" checkboxes are all open although the plan was approved and the forms deployed; (2) `E:\Rainmaker\icm\knowledge\OPEN-ITEMS.md` is dated 2026-10-23 and still lists items the log has since closed (legal entity name, licensing, forms backend, brand assets); (3) the wrong licence number #0D82882 is still in `icm\knowledge\decisions.md`, `deliverables\report-dave-launch-status.md` and `deliverables\email-monica-launch-review.md`; (4) `icm\knowledge\decisions.md` row of 2026-10-23 sends `/cpe-course-offerings` to `/about` but `site\_redirects` sends it to `/careers/`; (5) the decision log names four team members for About but the built page shows two; (6) `integrations\apps-script\SETUP.md` still says "Nothing here has been deployed" and names tabs from v1.

## Go-live 2026-11-09 (owner: "soon today we will be going live with elev8 and rainmaker websites"; 06:33 standalone, platform later; 06:34 domain access not ready)
The sheet: `go-live-2026-11-09.md` (what is proven, what blocks with its holder, the forms, the domain steps, the owner's clicks).
- FOUND: www.rwifinancial.com already serves a copy of our preview, indexable, through a Cloudflare zone not ours (NS
  alina/jaxson since 2026-11-06 19:51 UTC per RDAP; our zone cruz/leland still `pending`); no headers, no redirects, the legal
  blanks public; `pay.rwifinancial.com` NXDOMAIN; DKIM `google._domainkey` exists live but not in our zone. Evidence:
  `evidence-2026-11-09/`. Who did it: UNPROVEN, asked of the owner 2026-11-09.
- PROVEN today: preview render gate 11 of 11; launch build (clone at 44a7cc7) strict gate 14 of 14, head's re-run; the live
  deploy tool still refuses the placeholders (that refusal is correct).
- Open, added 2026-11-09:
  - Owner: the switch, deploy and submit clicks. Consent tick DECIDED 2026-11-09: REQUIRED, built in `E:\Rainmaker` 48da581
    (forms e2e 40/40, watched red 38/40 without it; kept local until the switch; needs Monica's OK on the wording).
  - Who changed the name servers on 2026-11-06: BLOCKED (investigated 2026-11-09, read-only). The live site is another
    account's Cloudflare Pages direct upload of our preview, edited (robots index,follow; og:image .webp; no `_headers`,
    `_redirects`, 404 page or .jpg). Not our Cloudflare account, no session log on this machine, no mail in the owner's Gmail.
    The preview link went to Monica and Dave; the switch needed the GoDaddy login. Settles it: Dave's answer (the owner asks
    him) or Monica's GoDaddy activity log.
  - Monica (via Dave): phone, mailing address, publication date, written compliance OK; GoDaddy or zone access and a date;
    whether `pay.rwifinancial.com` is still used.
  - Omnikom (Clients) at the switch: our zone gets `google._domainkey`, the live MX set, `pay` and `google-site-verification`
    before the NS move; stale apex A and www CNAME deleted; then `deploy-live.mjs`, checks, the live form check and the TEST row.
  - LATER (owner 2026-11-09 06:33): wire the site to the platform when it is ready: the Sheet's leads into the platform inbox
    (with the client's CRM export, `docs/product/`), the look-folder and content load (M4 work order); the Sheet stays the
    lead path until the platform has production.
- Draft for Monica (owner's click 2, sent by Dave; a draft only, nothing sent; drop point 3 if click 1 shows it was our side):
  > Hi Monica, your new site is ready to go live. Three things are left before we switch it on:
  > 1. The business phone number and mailing address to print on the privacy, terms and disclosures pages.
  > 2. Your written OK on those pages, the site copy, and the consent wording on the forms: the marketing consent box is now
  >    required to send a form (it still says consent is not a condition of any purchase).
  > 3. Who changed the rwifinancial.com name servers on November 6? The domain now points to a Cloudflare account that is not
  >    ours, and a draft copy of the site is showing there. If it was your side, please tell us who holds that account; if not,
  >    please let us know and we will help you secure it. Also: is pay.rwifinancial.com (your GoDaddy payment page) still in use?
  > Once we have these and GoDaddy access with a date, we switch the domain without touching your email.

## Last updated
- 2026-10-30: record created by the slice 2a builder (Sonnet) from `E:\Rainmaker` read-only; preview headers read the same day.
- 2026-11-09: go-live check by HEAD_Clients_2026-11-09 (status line, the section above, `go-live-2026-11-09.md`, `evidence-2026-11-09/`).
- HANDOVER 2026-11-09 22:00 (HEAD_Clients_2026-11-09 stops): waiting on Dave (who moved the name servers) and Monica (phone,
  address, compliance OK incl. the required consent wording). `E:\Rainmaker` 48da581 (consent REQUIRED) stays local until the
  switch. No investment-management lead type exists (forms and the Apps Script allowlist: 6 interests).
