# ELEV8 Real Estate Group: facts ledger

The full facts live in `E:\Alex Sevilla\facts\` and `E:\Alex Sevilla\EVIDENCE.md` (every report number to its source). This
ledger points at them and copies only what a platform department needs to start a site. Numbers from the audit (scores,
search counts, speeds) are NOT copied here: read them in `EVIDENCE.md` with their capture files. Nothing below is client-facing
without the compliance notes in `profile.md`.

| Fact | Value (or "see file") | Source | Verified on |
|---|---|---|---|
| Alex Sevilla, licensed name and licence | Sevilla, Alejandro; CA DRE Salesperson 02248556, licensed, expires 12/26/28, no discipline; licensed since 12/27/2024 | `facts\PROFILE.md` "Licence"; https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=02248556 | 2026-10-26, re-read 2026-10-28 |
| Alex's responsible broker | Xpert Home Lending Inc. 02166758 (DBA Xpert Home Realty), Roseville; was Park Lane Capital 07/06/2026 to 10/08/2026 | same | 2026-10-28 |
| Alex's mortgage standing | NMLS 2666810: 0 active state licences of 1, authorised to represent none; office Better Rate Mortgage Inc. (NMLS 1852295) since 01/28/2025 | `facts\nmls-2026-10-26.md`; https://www.nmlsconsumeraccess.org/EntityDetails.aspx/INDIVIDUAL/2666810 | 2026-10-26 (NMLS not re-read: needs the owner to pass its terms page) |
| Sunny Azizi | CA DRE 02252341 (expires 02/19/29), broker Xpert Home Lending; NMLS 2676817, CA DFPI Mortgage Loan Originator licence active, authorised to represent Better Rate Mortgage Inc. (1852295); phone 5102096930 | `facts\team-licences-2026-10-28.md`; `facts\nmls-2026-10-26.md` | DRE 2026-10-28; NMLS 2026-10-26 |
| The other seven team members (titles, DRE numbers, brokers, expiry dates) | see file | `facts\team-titles-2026-10-29.md` (titles as ELEV8's cards show them) and `facts\team-licences-2026-10-28.md` (DRE lookups) | 2026-10-28 and 2026-10-29 |
| Charmaine Faleanna | no DRE record under that name (two searches) | `facts\team-licences-2026-10-28.md` | 2026-10-26 |
| Zareen Shaghasi's licence expiry | 11/01/26 (renewal to confirm before her number is shown live) | `facts\team-licences-2026-10-28.md` | 2026-10-28 |
| Alex's contact | (707) 863-1622; alex@elev8ca.com | `facts\PROFILE.md` "On elev8ca.com" (profile page structured data) | 2026-10-26 |
| Site phone (wire-fraud notice, footer) | (510) 209-6930 | `draft-site\site\CLIENT-WORDING.md` Q-007; NMLS record of Sunny Azizi | 2026-10-26 |
| Office address on the old site | 4513 Paseo Dr., Fairfield, CA 94534 | `facts\PROFILE.md` "Promoted from P0.2" (backup footer) | 2026-10-26 |
| Old website stack | Brivity IDX (site id 22607); home search at homes.elev8ca.com; Meta Pixel only | `facts\PROFILE.md`; `site\code-findings.md` | 2026-10-26 |
| Portals | Zillow alex79108 (brokerage shown Park Lane Capital, Woodside, 0 reviews, 13 sales total), Homes.com (12 closed sales in 5 years), RateMyAgent (unclaimed, 0 reviews), Realtor.com (profile exists, page 403); Instagram @elev8realestateca (6 posts, 120 followers) | `facts\portals-and-social-2026-10-26.md`; `facts\PROFILE.md` | 2026-10-26 |
| Google Business Profile | none found for ELEV8 or any agent | `facts\search\SUMMARY.md` lines 88 to 97 (brand captures) | 2026-10-26 |
| Reviews on the old site | 4 testimonials, first name + initial, no dates, no agent named | `site\code-findings.md` C08 | 2026-10-26 |
| Cities in the approved plan | American Canyon, Benicia, Concord, Fairfield, Napa, Sacramento, Suisun City, Vacaville, Vallejo, Walnut Creek | `site-checks\elev8ca.com\.pewp\approved\plan\page-plan.md` | approved 2026-10-27 (targets), plan signed 2026-10-29 (US spelling re-approval, `draft-site\DONE-REPORT.md` row 1a) |
| Languages | English and Spanish for Alex (Zillow); none on file for the others | `draft-site\site\CLIENT-WORDING.md` Q-014 | 2026-10-26 |
| What they want | "a website that makes revenue by getting them leads" (told by the owner, via Dave) | `facts\PROFILE.md` "What they want" | 2026-10-26 (told, not seen) |
| Alex's three lines of work | realtor; wholesale and flipping (cash buyer); arranges financing (told, not seen; NMLS says he cannot originate) | `facts\PROFILE.md` "What Alex does" | 2026-10-26 |
| Preview site | https://elev8-omnikom-website.pages.dev, noindex, build final26 (AVIF), 57 pages built, 53 in the launch build; PageSpeed mobile 99/99/97/99/98, desktop 100 x5 | `E:\Alex Sevilla\.claude\POSITION.md` 2026-10-29 19:37 and 19:42 | 2026-10-29 |
| Lead endpoint on the preview | `POST /api/lead` answers `{"preview":true,"sent":false}` with noindex headers (a stub; nothing is sent) | `draft-site\DONE-REPORT.md` row 11 | 2026-10-29 |

## Not facts yet (to verify before any client-facing use)
- Which cities ELEV8 / Alex actually close sales in (portals name Fairfield, Vacaville, Vallejo, Walnut Creek, Los Banos). `facts\PROFILE.md` "To verify".
- Whether Instagram "Alexa Sevilla (@investwitha1exa)" is Alex (not attributed). `facts\PROFILE.md`.
- Whether the Google result "Better Rate Mortgage: Alex Sevilla, SVP of Sales & Marketing" is him (UNPROVEN either way). `facts\nmls-2026-10-26.md` "Reading".
- Whether ELEV8 itself buys homes for cash, through a partner, or not at all; days to close; fees (Launch Information Request Q4, unanswered).
- Reviews: where they are kept and the permission to show them (Q8, unanswered).
- Account ownership (domain, email, profiles, Search Console, Analytics, social, portals, current host, homes.elev8ca.com) (Q7, unanswered).
- The Xpert Home Realty mark on the old header prints "NMLS 2179191": not checked on NMLS (`draft-site\DONE-REPORT.md` row 8).
- Whether the accessibility statement page counts inside the 42 or beside it: the 42 is "42 contract pages + 12 item pages" in the 2026-10-28 build line (`E:\Alex Sevilla\.claude\POSITION.md` line 658); the page list in `sites.md` is read from the built `dist` of 2026-10-29 (36 folder pages + 24 file pages, 4 of them sample listings, 9 profiles, one 404).
