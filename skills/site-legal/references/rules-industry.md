# Industry lines: licences, Fair Housing, insurance and lending (checked on 2026-11-21)

Load this file only for D11 in `decide.md`. The on-page checks for these lines (present on every page, size, value equal
to the business record) are in the SEO skill's industry packs,
`skills/programmatic-enterprise-web-performance/rules/industries/real-estate-agent.json` and `insurance-agency.json`;
several of their sources are marked UNVERIFIED there, and the rules below are the sourced versions of the same points.

## Real estate

### CA-DRE-FIRST-CONTACT
- **Says:** a California real-estate broker or salesperson must show their own **eight-digit licence number** and the
  **responsible broker's name** as currently licensed on all first-point-of-contact solicitation materials, which
  expressly include websites the licensee owns, controls or maintains; when more than one licensee's name appears, each
  one's number; the responsible broker's own number is optional. In written material the number may not be in type
  smaller than the smallest type used.
- **Applies if:** `industry` is real-estate and the business is licensed in California. Draft: the footer line with the
  brokerage's name and number and the responsible broker's name, and each agent's number beside their name on the team
  pages.
- **Source:** Cal. Code Regs. tit. 10, sec. 2773 as amended effective 2019-03-28,
  https://www.dre.ca.gov/files/pdf/relaw/WhatsNew/Title%2010%20Calif%20Code%20of%20Regulations%20Section%202773%20(AMENDED%20TEXT)%203-28-2019.pdf ;
  Bus. & Prof. Code 10140.6(b) as reproduced by the DRE, https://dre.ca.gov/files/pdf/forms/re559.pdf ; DRE guide
  (August 2020), https://dre.ca.gov/files/pdf/re27.pdf . **Read on:** 2026-11-21.
- **Status:** CONFIRMED for the 2019 text on dre.ca.gov; UNCONFIRMED that sec. 2773 has not been amended since.

### CA-DRE-DESIGNATION
- **Says:** advertising of licensed acts must show that the advertiser is licensed; the words broker, agent, Realtor or
  the abbreviations bro. or agt. are deemed enough. (10140.6(a) names newspapers, periodicals and mail; websites fall
  under sec. 2773 above.) Team names and fictitious business names have extra rules (Bus. & Prof. Code 10159.5-10159.7).
- **Applies if:** real estate in California. Draft "Broker" or "DRE licensed real estate broker" beside the name.
- **Source:** https://dre.ca.gov/files/pdf/forms/re559.pdf (10 CCR 2770.1 and 10140.6, RE 559 Rev. 5/19).
  **Read on:** 2026-11-21. **Status:** CONFIRMED (on the DRE's form, not the code site). Team-name rules: not read
  (UNCONFIRMED); a site with a team name is a lawyer's question.

### US-FHA-ADVERTISING
- **Says:** it is unlawful to make, print or publish any notice, statement or advertisement about the sale or rental of a
  dwelling that indicates any preference, limitation or discrimination based on race, color, religion, sex, handicap,
  familial status or national origin.
- **Applies if:** real estate (every page, listing text and ad). Draft a short Fair Housing commitment line; the bigger
  job is the wording of listings and area pages (no "perfect for young couples", "exclusive neighbourhood" and the
  like), which the site's copy checks own.
- **Source:** 42 USC 3604(c), https://www.law.cornell.edu/uscode/text/42/3604 ; 24 CFR 100.75,
  https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-24?part=100&section=100.75 . **Read on:** 2026-11-21.
- **Status:** CONFIRMED (subsection (c), with its list of protected classes, re-read word for word by the skill's author
  on 2026-11-21).
  California adds more protected classes under its own law: not researched here (UNCONFIRMED); a lawyer's addition.

### US-FHA-LOGO
- **Says:** brokers and lenders must display the 11 by 14 inch Fair Housing poster with the "Equal Housing Opportunity"
  legend at their places of business (24 CFR part 110). No current federal rule was found that requires the Equal Housing
  Opportunity logo on a website; HUD's 2024 guidance on digital advertising was withdrawn (2025-09-17), and the old
  advertising guidelines of 24 CFR part 109 did not load (404) on eCFR or Cornell.
- **Applies if:** real estate. Draft the logo and the words "Equal Housing Opportunity" in the footer as the business's
  choice, marked `[CHECK: the logo on the website is customary; confirm with the lawyer and the client's MLS rules]`.
- **Source:** https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-24?part=110 (sec. 110.10, 110.25);
  HUD withdrawal notice, https://public-inspection.federalregister.gov/2026-06624.pdf . **Read on:** 2026-11-21.
- **Status:** CONFIRMED for the poster and the withdrawal; UNCONFIRMED for any website-logo requirement (HUD's
  advertising page answered 403).

## Insurance

### CA-INS-1725-5
- **Says:** California insurance licensees must show their licence number on business cards, written price quotations and
  print advertisements distributed in California, in type at least as large as any address or phone number shown; since
  2023-01-01 also on emails that involve licensed activity; for an organisation, next to or on the line under its name.
- **Applies if:** `industry` is insurance and licensed in California. Whether a website counts is not stated on any
  official page read (the 1996 bulletin limits "print advertisements" to paper). Draft the number on the site anyway,
  next to the agency name in the footer, marked `[CHECK: the lawyer confirms the website wording]`.
- **Source:** CDI Bulletin 96-08,
  https://www.insurance.ca.gov/0250-insurers/0300-insurers/0200-bulletins/bulletin-notices-commiss-opinion/bulletin-96-08.cfm ;
  CDI notice of 2022-12-22 on SB 1242,
  https://www.insurance.ca.gov/0200-industry/0110-whats-new/upload/New-Law-Requires-Licensees-to-Include-Their-License-Number-on-Emails.pdf .
  **Read on:** 2026-11-21. **Status:** CONFIRMED for cards, quotes, print and email; UNCONFIRMED for websites; the statute
  text itself could not be loaded (leginfo 403).

### INS-QUOTE-DISCLAIMER
- **Read on:** 2026-11-21 (no source found). **Says:** no rule was researched for the wording "a quote is not a contract of insurance". It is a common protective line.
- **Applies if:** insurance. Draft it marked `[CHECK: lawyer and carrier wording]`. **Status:** UNCONFIRMED (no source).

### INS-OTHER-STATES
- **Read on:** 2026-11-21 (not researched). **Says:** each state sets its own producer-licence display rules. None was researched.
- **Applies if:** an insurance client licensed outside California: research that state's insurance department page
  before drafting its line. **Status:** UNCONFIRMED (not researched).

## Mortgage and lending

### US-NMLS-ID
- **Says:** federal Reg Z requires the loan originator's name and NMLS ID on the credit application, the loan disclosures,
  the note and the security instrument (not websites). The model state law most states adopted (CSBS/AARMR) requires the
  NMLS ID on advertisements, business cards and websites; state law controls.
- **Applies if:** `industry` is mortgage, or a named loan officer appears on the site. Draft "NMLS #<number>" next to the
  company and each named loan officer, numbers from `licences[]` only.
- **Source:** 12 CFR 1026.36(g),
  https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-12?part=1026&section=1026.36 ; NMLS Resource Center,
  https://mortgage.nationwidelicensingsystem.org/knowledge/products/nmls/pubs/aboutNMLS/reference/aboutNMLS/maps/topics/nmls_uniqueID_requiredUse.html ;
  12 CFR 1007.105, https://www.consumerfinance.gov/rules-policy/regulations/1007/105/ . **Read on:** 2026-11-21.
- **Status:** CONFIRMED for Reg Z's document list and the model law's statement; UNCONFIRMED for any one state's law.

### US-EHL
- **Says:** an FDIC-supervised bank's ads for loans secured by a dwelling must show the Equal Housing Lender (or Equal
  Housing Opportunity) logotype; Reg B forbids statements, in advertising or otherwise, that would discourage applicants
  on a prohibited basis.
- **Applies if:** a bank (12 CFR 338.3). For a non-bank lender or a broker: draft "Equal Housing Lender" or "Equal Housing
  Opportunity" as customary, marked `[CHECK: ...]`.
- **Source:** https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-12?part=338&section=338.3 ;
  https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-12?part=1002&section=1002.4 . **Read on:** 2026-11-21.
  **Status:** CONFIRMED for 338.3 (read in summary) and 1002.4(b).
