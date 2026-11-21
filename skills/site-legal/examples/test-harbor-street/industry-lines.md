> **DRAFT - not legal advice.** Written by the site-legal skill on 2026-11-21 for TEST Harbor Street Realty, Inc. (made-up) from the facts file
> skills/site-legal/examples/test-harbor-street/facts.json. A licensed lawyer must read and approve it before it is published. Remove this box and the "Review notes"
> section only after that approval.

# TEST Industry lines

Real estate, California. The words below are for the footer and the pages named in the third column.

| Line | Words | Where it goes | Rule |
|---|---|---|---|
| Brokerage licence | TEST Harbor Street Realty, Inc. (made-up), DRE licensed real estate broker, California licence [MISSING: licences[0].number - What is the brokerage's California DRE corporation licence number, from the DRE public licence lookup?] [CHECK: licences[0] has no source in the facts file; confirm the name on the DRE record is exactly "TEST Harbor Street Realty, Inc. (made-up)".] | Footer of every page; about page; contact page | [^ca-dre-first-contact] [^ca-dre-designation] |
| Responsible broker | Responsible broker: Jordan Example (made-up), DRE licensed real estate broker, licence TEST-00000001 | Footer of every page; about page | [^ca-dre-first-contact] |
| Agents named on the site | [MISSING: team[] - Which agents are named on the website, and what is each agent's own DRE licence number? Each named agent's number goes beside the name.] | Team and agent pages; every page that names an agent | [^ca-dre-first-contact] |
| Name of the business | [CHECK: the website calls the business "TEST Harbor Street Realty (made-up)", and the licence name is "TEST Harbor Street Realty, Inc. (made-up)". The lawyer confirms whether the shorter name needs to be a licensed fictitious business name, and whether any team name is used.] | Footer; every page that shows the name | [^ca-dre-designation] |
| Fair housing | Federal law makes it unlawful to advertise the sale or rental of a home in a way that shows a preference, limitation or discrimination based on race, color, religion, sex, handicap, familial status or national origin.[^us-fha-advertising] We write our listings and our area pages with that in mind. [CHECK: the client and the lawyer confirm this commitment wording. California adds more protected classes under its own law; the lawyer adds them.] | Footer; about page; listing pages | [^us-fha-advertising] |
| Equal housing | Equal Housing Opportunity (the words, and the logo beside them) [CHECK: the logo on the website is customary; confirm with the lawyer and the client's MLS rules.][^us-fha-logo] | Footer of every page | [^us-fha-logo] |
| Listing information | Listing information is deemed reliable but not guaranteed and may change. | Every listing page; the terms page | (client's wording, terms.content_disclaimers[0]) |
| Home-value estimate | A home-value estimate is not an appraisal or an offer. | Home-value form page and its result; the terms page | (client's wording, terms.content_disclaimers[1]) |

The licence number is shown in type no smaller than the smallest type used on the page.[^ca-dre-first-contact]

Every industry: the line under the lead form is in form-consent.md, not here.

## Review notes (remove before publishing)
- **Facts this page relied on:** industry = real-estate; business.states_served = California; licences[0] (the brokerage; number is null; no source entry); licences[1] (Jordan Example (made-up), designated broker-officer, number TEST-00000001; source "made-up for the test (a real run: DRE public licence lookup, URL and date)"); terms.content_disclaimers[0-1].
- **Decisions behind this page:** D11 industry lines for real estate in California. No insurance, mortgage or lending line is drafted: the facts say nothing of them.
- **Open questions for this page:** MISSING licences[0].number (client topic Regulated identity; our research task first: the DRE public lookup, then ask the client only what the lookup cannot settle). MISSING team[] (schema gap: the facts file has no field for the agents named on the site and their licence numbers). CHECK the unsourced brokerage record. CHECK the business name against the licence name (lawyer). CHECK the Fair Housing wording and California's extra classes (lawyer). CHECK the Equal Housing logo (lawyer). The test number TEST-00000001 is not an eight-digit DRE number, so a real run replaces it with the looked-up number.
- **Sources:**

[^ca-dre-first-contact]: CA-DRE-FIRST-CONTACT - https://www.dre.ca.gov/files/pdf/relaw/WhatsNew/Title%2010%20Calif%20Code%20of%20Regulations%20Section%202773%20(AMENDED%20TEXT)%203-28-2019.pdf (read 2026-11-21) - CONFIRMED for the 2019 text on dre.ca.gov; UNCONFIRMED that sec. 2773 has not been amended since.
[^ca-dre-designation]: CA-DRE-DESIGNATION - https://dre.ca.gov/files/pdf/forms/re559.pdf (read 2026-11-21) - CONFIRMED (on the DRE's form, not the code site). Team-name and fictitious-name rules (Bus. & Prof. Code 10159.5-10159.7) not read: UNCONFIRMED.
[^us-fha-advertising]: US-FHA-ADVERTISING - https://www.law.cornell.edu/uscode/text/42/3604 (42 USC 3604(c)); https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-24?part=100&section=100.75 (read 2026-11-21) - CONFIRMED. California's own extra protected classes: UNCONFIRMED (not researched).
[^us-fha-logo]: US-FHA-LOGO - https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-24?part=110 (read 2026-11-21) - CONFIRMED for the poster and HUD's withdrawal of its digital-ad guidance (https://public-inspection.federalregister.gov/2026-06624.pdf); UNCONFIRMED for any website-logo requirement. The logo is the business's choice, not a rule found.
