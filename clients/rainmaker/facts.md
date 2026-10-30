# Rainmaker Wealth Innovations: facts ledger

The full facts live in `E:\Rainmaker\icm\knowledge\` (client and licence notes), `E:\Rainmaker\.pewp\` (intake, plan) and
`E:\Rainmaker\.claude\POSITION.md` (the run log). This ledger points at them and copies only what a platform department needs to
start a site. No audit score exists for Rainmaker (no scored presence report was run), so none is copied. Nothing below is
client-facing without the compliance notes in `profile.md`. Paths are inside `E:\Rainmaker` unless they start with `planning/`.

| Fact | Value (or "see file") | Source | Verified on |
|---|---|---|---|
| Client contact and role | Monica Duncan Faulve-Stach, founder and CEO of Rainmaker Wealth Innovations (also operating as RWI Financial) | `icm/knowledge/client/monica-faulve-stach.md` line 16; `icm/knowledge/client/licensing.md` line 46 | owner-provided 2026-10-23 (not re-read by us); her individual licences 2026-10-24 |
| Legal name used on the site | Rainmaker Wealth Innovations, Inc. ("RWI Financial") | `deliverables/email-monica-update-2026-10-24.md` line 10; `site-src/pages/insurance-disclosures.html` line 76 | Monica's answer applied 2026-10-24 |
| State of incorporation, entity number, registered agent | NOT FOUND | `icm/knowledge/OPEN-ITEMS.md` item 1 (the item asked for the exact registered name; the answer given was the name "Inc.") | 2026-10-30 |
| California insurance licence | #0D82822, Insurance Producer; Life; Accident and Health or Sickness; effective 2021-02-03, expires 2027-01-31; an individual producer licence of Monica Duncan Faulve-Stach | `icm/knowledge/client/licensing.md` lines 43 to 46 ("Correction 2026-10-24": read off the California Department of Insurance certificate Monica sent) | 2026-10-24 (certificate; the public CDI lookup stays blocked from the owner's connection) |
| Superseded licence number | #0D82882 was wrong by one digit (taken from the old site and a third-party page); it remains in `icm/knowledge/decisions.md` line 20 and `deliverables/report-dave-launch-status.md` line 26 and `deliverables/email-monica-launch-review.md` item 1. Do not use | `icm/knowledge/client/licensing.md` line 44 | 2026-10-24 |
| Florida insurance licence | #G344552, nonresident Life and Variable Annuity (0814) and Nonresident Health (0840), issued 2026-05-27; individual licence | `icm/knowledge/client/licensing.md` line 45 | 2026-10-24 (certificate) |
| California real estate licence (not offered on this site) | DRE salesperson 02242512, licensed, issued 11/21/24, expires 11/20/28 | `icm/knowledge/client/licensing.md` line 18; https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=02242512 | 2026-10-23 (DRE public lookup, seen then; not re-read) |
| Other states, lines of authority, National Producer Number | NOT FOUND (no NPN printed on any page checked; no other state lookup run) | `icm/knowledge/client/licensing.md` lines 26 to 28 | 2026-10-23 |
| City business licence | City of Modesto, "RAINMAKER WEALTH INNOVATIONS INC", consulting, expires 2026-12-31 | `icm/knowledge/client/licensing.md` line 46 | 2026-10-24 |
| Old-site footer address | 1 Sansome St, Suite 3500, San Francisco, CA 94104 (a business address, not necessarily the home base) | `icm/knowledge/client/licensing.md` line 23 (rwifinancial.com footer, fetched by curl) | 2026-10-23 |
| Business phone and mailing address for the legal pages | NOT FOUND: asked of Monica 2026-10-24, not received. The built legal pages hold placeholders | `deliverables/email-monica-update-2026-10-24.md` line 20; `.claude/POSITION.md` line 68 | 2026-10-26 (last log entry) |
| Privacy and business contact email | monica@rwifinancial.com | `deliverables/email-monica-update-2026-10-24.md` line 12 | 2026-10-24 |
| Lead alert recipients | arjely@ and mylene@rwifinancial.com (set 2026-10-24; Monica has not named her own address) | `.claude/POSITION.md` line 65 | 2026-10-24 |
| Team shown | Arjely Catalan and Mylene Tuble on the built About page; the decision log also lists Carlos Ayala and Rita Faulve-Ledo (not on the page) | `site-src/pages/about.html`; `icm/knowledge/decisions.md` line 23 | page read 2026-10-30 |
| Founder's background claims | "30+ years" in financial services since 1990, JP Morgan Chase, Wells Fargo, BBVA Compass; Associate Broker with Hariri Financial Partners; Rotary member. Client-stated (owner message), not verified; the Hariri team page lists "Associate Broker" with the older, wrong licence number | `icm/knowledge/client/monica-faulve-stach.md` lines 16 to 21; `icm/knowledge/client/licensing.md` line 35 | owner message 2026-10-23 |
| Current website | https://www.rwifinancial.com/ on Duda (apex A record 100.24.208.97 and www CNAME s.multiscreensite.com are the old records to delete before deploy); six pages snapshotted | `LAUNCH.md` line 40; `planning/CONTEXT.md` line 11; `.claude/POSITION.md` line 12 | 2026-10-23 |
| Domain, registrar and DNS | rwifinancial.com, registrar GoDaddy, Rainmaker is the registrant; mailboxes are Google Workspace (MX kept); payment page pay.rwifinancial.com on GoDaddy kept as is; name servers to switch to cruz.ns.cloudflare.com and leland.ns.cloudflare.com; rollback is ns43.domaincontrol.com and ns44.domaincontrol.com | `deliverables/domain-migration-plan.md` lines 8 to 9, 24 and 36 | 2026-10-24 |
| Email signing (DKIM) | not set on the client's mail; a fix in Google Admin was asked of Monica | `deliverables/email-monica-update-2026-10-24.md` line 22; `deliverables/report-dave-launch-status.md` line 49 | 2026-10-24 |
| Search Console and Google Business Profile | whether Rainmaker has either is unknown (an old google-site-verification TXT record is present on the domain); `business.json` says false for both | `.pewp/business.json` existing; `LAUNCH.md` line 45; `deliverables/report-dave-launch-status.md` lines 43 and 44 | 2026-10-23 |
| Search plan | 4 clusters, target pages `/life-insurance/`, `/annuities/`, `/mortgage-protection/`, `/careers/`; signed 2026-10-23 | `.pewp/approved/targets.json`; `.pewp/approved/lock.json` | 2026-10-23 |
| Volume of the target searches | autocomplete tier T1 only (people type the phrase); it is not a search count; browser located in Egypt, suggestions naming other countries dropped | `.pewp/approved/targets.json` volume.source | 2026-10-23 |
| Preview site | https://rainmaker-omnikom-website.pages.dev, noindex, 12 pages, final preview e1f42a39 (commit 2795017) | `.claude/POSITION.md` line 66; curl of the home page headers | 2026-10-30 (HTTP 200, `x-robots-tag: noindex, nofollow, noarchive`) |
| Forms backend | Google Apps Script web app "Rainmaker website forms" (v2) and Sheet "Rainmaker leads" on the Omnikom Google account; Sheet restricted, shared with monica@, arjely@, mylene@ | `.claude/POSITION.md` lines 61 and 65 | 2026-10-24 |
| Reviews | none exist yet; none are shown | `.pewp/runs/2026-10-23-gate-notes.md` line 2; `LAUNCH.md` line 12 | 2026-10-23 |

## Not facts yet (to verify before any client-facing use)
- Whether the California licence also covers other lines, which other states Monica or her team are licensed in, and whether the team members hold their own licences (not on file; the site says products are offered only where licensed and appointed). `icm/knowledge/client/licensing.md` lines 26 to 28.
- The registered entity details (state, number). Item 1 of `icm/knowledge/OPEN-ITEMS.md` was never marked closed in that file.
- Whether "30+ years", the Hariri Financial Partners affiliation and "Realtor" may be shown, and in what wording (compliance). `icm/knowledge/OPEN-ITEMS.md` item 13.
- Whether anyone at Rainmaker has Search Console, Analytics or a Google Business Profile (asked of Dave to ask Monica). `deliverables/report-dave-launch-status.md` lines 43 and 44.
- Whether the legal pages, the copy (especially the variable-annuity wording) and the estimator text are compliant: Omnikom wrote them; Monica's compliance approval is not received. `.claude/POSITION.md` lines 65 and 68.
- Whether a real lead alert reaches Arjely and Mylene (UNPROVEN since the 2026-10-24 switch). `.claude/POSITION.md` line 68.
- Who holds the GoDaddy login and receives its verification code. `deliverables/report-dave-launch-status.md` lines 35 to 40.
- The 2026-07-26 research note describes a different, older partnership and a four-person team (it predates the website work); it was not used here and nothing from it is a client-facing fact. `icm/knowledge/research/01-rainmaker-research.md` sections 1 and 2.
