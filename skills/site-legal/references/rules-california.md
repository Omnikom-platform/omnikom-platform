# California rules (checked on 2026-11-21)

Each rule: what it says in plain words, when it applies (as a decision on the facts), the source read, and its status.
CONFIRMED = read on the official page on the date shown. UNCONFIRMED = could not be read there, with what is missing.
Short names for the two sources most rules use:

- **CCPA statute** = the CPPA's copy of the CCPA as in force 2026-01-01, https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf
- **CCPA regulations** = the CPPA's copy of the regulations (Cal. Code Regs. tit. 11, sec. 7000 and following) in force
  2026-01-01, https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf (the file name says "statute", but its
  first page reads "Chapter 1. California Consumer Privacy Act Regulations, Effective 1/1/2026": checked 2026-11-21)

The official statute site leginfo.legislature.ca.gov answered 403 to every request on 2026-11-21, so the statutes were
read from the CPPA's copy and from the official chaptered bills; where that leaves a gap, the rule says so.

## Contents
CCPA: THRESHOLD, FINES, GLBA-EXEMPT, POLICY-CONTENT, RIGHTS, ANNUAL-UPDATE, NOTICE-AT-COLLECTION, METHODS, TIMELINE,
OPTOUT-15, VERIFY, AGENTS, OPTOUT-LINK, GPC, COOKIE-BANNER, SHARING-ADS, NONDISCRIMINATION, MINORS, INSURANCE.
Other: CALOPPA-CONTENT, SHINE-THE-LIGHT, AADC. Licence lines are in `rules-industry.md`.

---

### CA-CCPA-THRESHOLD
- **Says:** a for-profit business that does business in California and collects Californians' personal information is
  covered if it meets ANY one of: annual gross revenue over **$26,625,000** in the preceding calendar year (the
  $25,000,000 of the statute as adjusted for inflation, effective 2025-01-01); buys, sells or shares the personal
  information of **100,000 or more** California consumers or households a year; or gets **50% or more** of its annual
  revenue from selling or sharing personal information.
- **Applies if:** any one of the three tests is met. A small brokerage or agency usually meets none; note that ad pixels
  can count as "sharing" visitors' data and push the second test up.
- **Source:** CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf), Civ. Code 1798.140(d)(1)(A)-(C); the adjusted figure: https://cppa.ca.gov/regulations/cpi_adjustment.html
  ("Effective 1/1/2025; posted 12/17/2024"; adjustments "Every odd-numbered year").
- **Read on:** 2026-11-21 (the CPI page re-read by the skill's author the same day). **Status:** CONFIRMED.
- **Watch:** the next adjustment is due in an odd year (2027). Re-read the CPI page before using the figure after
  2026-12-31.

### CA-CCPA-FINES
- **Says:** up to $2,663 per violation, $7,988 per intentional violation or one involving a consumer known to be under 16
  (adjusted 2025-01-01).
- **Applies if:** the CCPA applies. Used only in the lawyer's notes, never on a page.
- **Source:** https://cppa.ca.gov/regulations/cpi_adjustment.html; CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.155(a). **Read on:** 2026-11-21.
  **Status:** CONFIRMED.

### CA-CCPA-GLBA-EXEMPT
- **Says:** the CCPA does not apply to personal information collected or processed under the federal Gramm-Leach-Bliley
  Act or the California Financial Information Privacy Act (the data-breach damages section still applies).
- **Applies if:** the business is an insurer, insurance agency, lender or other financial business. Which of its data
  falls inside the exemption (quote data yes; website analytics and marketing lists perhaps not) is a lawyer's question:
  always escalate, never state an exemption on a page.
- **Source:** CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.145(e). **Read on:** 2026-11-21. **Status:** CONFIRMED (text only).

### CA-CCPA-POLICY-CONTENT
- **Says:** the privacy policy must describe online and offline practices and include: the categories of personal
  information collected in the last 12 months (using the law's category names), their sources and purposes; the
  categories sold or shared and to which categories of third parties (or that none were); whether the business knows it
  sells or shares data of consumers under 16; categories disclosed to service providers and why; whether sensitive
  personal information is used beyond the allowed purposes; the rights; how to submit requests and how they are
  verified; how opt-out preference signals are processed; how an authorised agent can act; a contact for questions; the
  date last updated. It must be printable and linked from the homepage with a conspicuous link containing the word
  "privacy".
- **Applies if:** the CCPA applies.
- **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7011(c)-(e). **Read on:** 2026-11-21. **Status:** CONFIRMED.
- **Note:** the automated decision-making items in 7011(e)(2)(F)-(G) apply only to a business that uses automated
  decision-making for significant decisions (compliance by 2027-01-01, sec. 7200(b)). Not expected for these sites.

### CA-CCPA-RIGHTS
- **Says:** a California consumer may ask to know (and get a copy of) the personal information a business has about
  them, to delete it, to correct it, to opt out of its sale or sharing, and to limit the use of sensitive personal
  information; the business may not retaliate.
- **Applies if:** the CCPA applies. If it does not, the business may still offer these to everyone by choice
  (`privacy_request_handling.offer_to_everyone`); then the page says "we offer" and not "the law gives you".
- **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7011(e)(2) (the list the policy must state); CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.100-1798.125.
  **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CCPA-ANNUAL-UPDATE
- **Says:** the privacy-policy disclosures must be updated at least once every 12 months.
- **Applies if:** the CCPA applies. **Source:** CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.130(a)(5). **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CCPA-NOTICE-AT-COLLECTION
- **Says:** at or before collecting personal information, give a notice listing the categories collected, the purposes,
  whether each is sold or shared, how long each is kept (or the criteria), the opt-out link if the business sells or
  shares, and a link to the privacy policy. On a web form: a conspicuous link to the notice close to the fields or to
  the submit button. It may link straight to the right section of the privacy policy. Without the notice, the business
  may not collect.
- **Applies if:** the CCPA applies and the site has a form (every Omnikom site does).
- **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7012(c)-(f). **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CCPA-METHODS
- **Says:** offer two or more ways to send requests to know, delete and correct, including a toll-free telephone number,
  and, for a business with a website, a way through the website. A business that operates exclusively online and has a
  direct relationship with the consumer needs only an email address.
- **Applies if:** the CCPA applies. A brokerage or agency with an office is not "exclusively online": plan the toll-free
  number plus the web form.
- **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7020(a)-(b); CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.130(a)(1). **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CCPA-TIMELINE
- **Says:** confirm receipt of a request to know, delete or correct within **10 business days**; answer within **45
  calendar days** counted from the day of receipt (even while verifying); one extension of up to **45 more days** (90 in
  all) is allowed if the consumer is told, with the reason, within the first 45 days.
- **Applies if:** the CCPA applies. The platform's `privacy_requests.due_at` is the same 45 days with one 45-day extension.
- **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7021(a)-(b); CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.130(a)(2)(A). **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CCPA-OPTOUT-15
- **Says:** a request to opt out of sale or sharing must be acted on as soon as feasible and no later than **15 business
  days** after it is received.
- **Applies if:** the CCPA applies and the business sells or shares. **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7026(f)(1).
  **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CCPA-VERIFY
- **Says:** verify the identity of the person asking to know, delete or correct; do not require verification, an account
  or extra information to opt out or to limit.
- **Applies if:** the CCPA applies. **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7060(a)-(b). **Read on:** 2026-11-21.
  **Status:** CONFIRMED for 7060; the detailed methods of 7061-7062 were not read (UNCONFIRMED for those details).

### CA-CCPA-AGENTS
- **Says:** a consumer may use an authorised agent; the business may ask for the consumer's signed permission and may ask
  the consumer to verify their own identity, but may not demand a power of attorney for this.
- **Applies if:** the CCPA applies. **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7063(a)-(b). **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CCPA-OPTOUT-LINK
- **Says:** a business that sells or shares must post a "Do Not Sell or Share My Personal Information" link on its
  homepage; one that uses sensitive personal information beyond the allowed purposes must post "Limit the Use of My
  Sensitive Personal Information"; one "Your Privacy Choices" (or "Your California Privacy Choices") link with the
  opt-out icon may replace both. A business that neither sells nor shares needs no link, but must say so in its policy.
- **Applies if:** the CCPA applies and the business sells or shares, or uses sensitive data beyond the allowed purposes.
- **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7013(c), (g), 7014(c), 7015(b); CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.135(a). **Read on:** 2026-11-21.
  **Status:** CONFIRMED.

### CA-CCPA-GPC
- **Says:** a business that sells or shares must treat an opt-out preference signal (the Attorney General treats Global
  Privacy Control as one) as a valid opt-out for that browser or device, even if it posts the links, and its policy must
  say how it processes the signal.
- **Applies if:** the CCPA applies and the business sells or shares. Not required of one that does neither (it may still
  choose to honor the signal).
- **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7025(b)-(e), 7011(e)(3)(F); Attorney General, Sephora settlement release,
  https://oag.ca.gov/news/press-releases/attorney-general-bonta-announces-settlement-sephora-part-ongoing-enforcement
  **Read on:** 2026-11-21. **Status:** CONFIRMED.
- **Watch:** a CPPA proposed text of 2026-10-08 would name Global Privacy Control and treat setting ad or analytics
  cookies before checking the signal as a violation: https://cppa.ca.gov/meetings/materials/20261105_06_09_text.pdf
  (PROPOSED ONLY, not adopted on 2026-11-21; its header "Proposed Text: Opt-Out Preference Signals (OOPS)", dated
  10.08.2026, and its naming of "Global Privacy Control (GPC)" re-read by the skill's author on 2026-11-21).

### CA-CCPA-COOKIE-BANNER
- **Says:** a cookie banner or cookie controls alone are not an acceptable way to opt out of sale or sharing.
- **Applies if:** the CCPA applies, the business sells or shares, and it relies on a banner. **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf)
  sec. 7026(a)(4). **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CCPA-SHARING-ADS
- **Says:** "sharing" means giving personal information to a third party for cross-context behavioral advertising (ads
  based on activity across other sites), paid or not. The Attorney General treated third-party trackers on a website as a
  sale (Sephora).
- **Applies if:** the build runs an advertising pixel or tag (for example a Meta pixel or Google Ads remarketing).
  Whether a given tool with given settings is "sharing" is a lawyer's question: escalate.
- **Source:** CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.140(k), 1798.140(ah)(1); the Sephora release above. **Read on:** 2026-11-21.
  **Status:** CONFIRMED for the definitions and the Attorney General's position; no official page names a specific product.

### CA-CCPA-NONDISCRIMINATION
- **Says:** no denial of service, different price or worse service because a consumer used a CCPA right (a difference is
  allowed only if reasonably related to the value of the data and disclosed).
- **Applies if:** the CCPA applies. **Source:** CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.125(a)(1); CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7080, 7011(e)(2)(H).
  **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CCPA-MINORS
- **Says:** no sale or sharing of the data of a consumer the business knows (or wilfully ignores) is under 16 without
  opt-in (from the consumer at 13 to 15, from a parent under 13); the policy must say whether the business knows it does so.
- **Applies if:** the CCPA applies. If `children.knowingly_collects_under_16` is true: escalate.
- **Source:** CCPA statute (https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf) 1798.120(c); CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7011(e)(1)(G), 7070-7072. **Read on:** 2026-11-21.
  **Status:** CONFIRMED.

### CA-CCPA-INSURANCE
- **Says:** insurance companies that meet the CCPA's definition of "business" must comply with the CCPA for any personal
  information not subject to the Insurance Code and its regulations (for example, data of website visitors who never
  applied for insurance).
- **Applies if:** `industry` is insurance and D1 applies. Whether an agency or producer (not a carrier) is an "insurance
  company" here, and which of its data the Insurance Code covers, is a lawyer's question: escalate with CA-CCPA-GLBA-EXEMPT.
- **Source:** CCPA regulations (https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) sec. 7271(a) (text re-read by the skill's author in the CPPA's PDF, "Effective 1/1/2026",
  on 2026-11-21). **Read on:** 2026-11-21. **Status:** CONFIRMED.

### CA-CALOPPA-CONTENT
- **Says:** any operator of a commercial website that collects personally identifiable information from California
  residents must conspicuously post a privacy policy that says: the categories of information collected and the
  categories of third parties it may be shared with; the process (if any) to review and ask for changes; how users are
  told of material changes; the effective date; how the site responds to "Do Not Track" or similar browser signals; and
  whether other parties may collect information about a visitor's activity over time and across websites when they use
  the site. No size threshold was found in the text.
- **Applies if:** the site collects personally identifiable information (a lead form is enough) from California
  residents. For every Omnikom site with California visitors: applies.
- **Source:** Bus. & Prof. Code 22575 as amended by AB 370 (2013),
  https://www.leginfo.ca.gov/pub/13-14/bill/asm/ab_0351-0400/ab_370_bill_20130927_chaptered.htm ; operative date
  (2004-07-01) and the advice to link it with the word "privacy" from the homepage and every page that collects:
  Attorney General, "Making Your Privacy Practices Public",
  https://oag.ca.gov/sites/all/files/agweb/pdfs/cybersecurity/making_your_privacy_practices_public.pdf
- **Read on:** 2026-11-21. **Status:** CONFIRMED for the 2013 text; UNCONFIRMED that 22575 is unchanged since (the
  current code text on leginfo.legislature.ca.gov could not be loaded).

### CA-SHINE-THE-LIGHT
- **Says:** a business that, in the prior year, gave a customer's personal information to third parties for those
  parties' own direct marketing must, on request and free, say which categories and to whom; a business with fewer than
  20 full-time or part-time employees is exempt.
- **Applies if:** 20 or more employees AND personal information is given to third parties for their own marketing.
- **Source:** Civ. Code 1798.83 as enacted by SB 27 (2003),
  https://leginfo.ca.gov/pub/03-04/bill/sen/sb_0001-0050/sb_27_bill_20030925_chaptered.pdf **Read on:** 2026-11-21.
  **Status:** CONFIRMED against the 2003 text only; later amendments UNCONFIRMED.

### CA-AADC
- **Says:** the California Age-Appropriate Design Code targets online services likely to be accessed by children and has
  been blocked by federal-court injunctions.
- **Applies if:** a site likely to be used by under-18s. Not expected for these sites; escalate if it is.
- **Source:** Attorney General statement (found in search, not opened):
  https://oag.ca.gov/news/press-releases/attorney-general-bonta-and-governor-newsom-issue-statement-appellate-court
- **Read on:** 2026-11-21. **Status:** UNCONFIRMED (current court status not read).
