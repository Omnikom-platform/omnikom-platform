# Work order 29: proof (2026-11-09)

Nothing committed or pushed. Files written: `real-estate.json`, `insurance-financial.json`, `statuses.json`, `draft-5-crm-section.md`, this file.

## Counts (from `node count.mjs work/29-lead-types`, a script in the session scratchpad, output pasted)

```
real-estate.json: types=15 withSource=15 withoutSource=0 uniqueIds=true unsourcedListed=5 merged=14 blocked=6
insurance-financial.json: types=15 withSource=15 withoutSource=0 uniqueIds=true unsourcedListed=5 merged=10 blocked=3
statuses.json: statuses=19 withSource=19 withoutSource=0 unsourcedListed=4 merged=16 blocked=4
perIndustry real-estate: 18 ids, unknown=0
perIndustry insurance-financial: 17 ids, unknown=0
needsDate true: call-back, follow-up, appointment-set
needsWho true: contacted, answering-machine, no-answer, appointment-set
stages: new=1 working=11 outcome=7
em dashes in real-estate.json: 0
em dashes in insurance-financial.json: 0
em dashes in statuses.json: 0
em dashes in draft-5-crm-section.md: 0
em dashes in CONTEXT.md: 0
distinct http urls cited: 40
```

Em dashes counted with `String.fromCharCode(0x2014)`. "Sourced" means every source entry has url, readAt and says (the script checks presence, not truth).

**Watched-fail:** the same script with `--mutant` (type 0 of real estate stripped of its sources in memory) printed `real-estate.json: types=15 withSource=14 withoutSource=1 ...` and exited 1; the real run exits 0.

## What the counts do and do not prove
- The 117 source entries hold 91 distinct web (url, says) pairs (a node count). The `says` strings were copied by sub-agent readers using WebFetch, not by me. A second reader re-fetched 32 (url, quote) pairs (16 real estate and status quotes, 16 insurance and status quotes): all 32 EXACT-MATCH, HTTP 200. The other quotes were NOT re-checked: UNPROVEN beyond the first reader's report.
- Two sources are not web pages: the owner's words (CONTEXT.md, 2026-11-09 20:40 for Enquiry and 20:48 for the first ten statuses) and `docs/product/5-crm.md:62` (spam).
- `examples` in the type lists are phrasings written for this list, not quotes.
- Web search results (about 27 queries) were used to find pages; no type rests on a search summary alone.

## BLOCKED (host, status, date; none retried)
| Host | Status | Date | What |
|---|---|---|---|
| help.followupboss.com | 403 | 2026-11-09 | Changing a Lead Stage (360012456793), article 4402121268631. RULE BREACH, mine: 360012456793 was requested by two different sub-agents (the real estate round and the statuses round) because I put it in both briefs; both got 403. Not a retry by one reader, but the host was asked twice. Nothing further sent |
| help.lofty.com | 403 | 2026-11-09 | Lead Organization with Filters |
| www.sierrainteractive.com | 403 | 2026-11-09 | glossary-term/real-estate-lead-forms (help.sierrainteractive.com, a different host, was readable) |
| www.luxurypresence.com | 403 | 2026-11-09 | three blog and product pages |
| www.zillow.com | 403 | 2026-11-09 | premier-agent/contact-tags |
| developer.salesforce.com | 403 | 2026-11-09 | LeadStatus object reference (requested once, by the statuses round; the search tool also returned its summary, no page read) |
| help.wealthbox.com | 403 | 2026-11-09 | two Opportunity Stages articles |

No 429, bot wall or CAPTCHA was met. Not-found pages (404 or 410, not blocks): intercom.help/kvcore (3 articles), orbitforms.ai (via useorbitcrm.ai), rg-lpt.helpscoutdocs.com, callin.io (410), help.sierrainteractive.com build-and-grow, support.agencyzoom.com 4945165, help.wealthbox.com/en/... 1670020, trailhead.salesforce.com (2), newhorizonsmktg.com, ritterim.com (2: one 404, one redirect notice only), advisorpedia.com, help.myhubly.com, intercom.help/total-synergy.

## Every URL read (date 2026-11-09; HTTP 200 unless stated)
Real estate and statuses (first rounds): help.insiderealestate.com 4626537, 3330192, 285957; developer.lofty.com/concepts/leads; help.sierrainteractive.com set-up-open-house-lead-capture-forms, capture-seller-leads-with-instant-home-valuations, seller-lead-sites-setup-and-best-practices, how-can-i-recruit-new-agents-using-sierra; support.realgeeks.com what-is-a-potential-seller-lead, seller-signals, customize-your-crm; leadcapture.io cash-home-offer-form, first-time-home-buyer-form; docs.pandaidx.com lead-forms (119-character stub, no content), www.pandaidx.com docs lead-forms; followupboss.com blog what-are-leads-in-real-estate (301 from careers.followupboss.com); www.nar.realtor how-to-help-out-of-state-buyers (2022, archive notice); www.cincpro.com out-of-state buyers (2023); www.newhomestar.com best-home-builder-websites; wpforms.com real-estate-showing-request-form-template; knowledge.hubspot.com hubspots-default-lead-properties, use-lifecycle-stages; www.fullcircleinsights.com lead-status-values (2016); www.virtualpbx.com call-disposition-codes (2025); help.brightpattern.com Pre-definedDispositions; batchdialer.com what-is-a-call-disposition; support.agencyzoom.com 5668389, 12195723, 3459657, 5669585, 4945274, 3459705; help.medicareproapp.com 2619457; ankotahelp.helpsite.com 44371; support.freshsales.io 229439.

Insurance and financial: agencyheight.com insurance-intake-form; www.insurancewebsitebuilder.com lead-generating-quote-forms; www.agencybloc.com (two pages: 3-ways-to-convert-more-online-insurance-leads, and the how-to-recruit-insurance-agents URL, which is really a social-media article); ezlynxsupport.freshdesk.com 8000044899 (lead source setup, no lead types, not cited); smartasset.com financial-advisor-website-lead-gen; paperform.co financial-advisor-free-consultation-form and insurance-agent-application-form (both 301 to paperform.com, then 200); www.involve.me insurance-form; agenttech.io mortgage-protection-agency-leadgen (540-character stub); blog.agent-crm.com annuity leads (2023); careers.healthmarkets.com/getting-started; www.uplead.com/?p=16167; www.boberdoo.com/final-expense-leads (read, not cited: no quote names final expense); www.policygenius.com mortgage-protection; blog.coforge.com salesforce-fsc-leads-and-referrals (read, not cited); www.sikich.com optimize-leads-using-salesforce-financial-services-cloud (2023, read, not cited).

Local files read (read only): `CLAUDE.md` rules, `docs/product/5-crm.md`, `docs/product/1-product.md` row A16, `clients/elev8/sites.md` rows 1 and 2, `clients/rainmaker/sites.md` rows on forms and lead routing, `contracts/examples/elev8/contract.json` (forms), `E:\Alex Sevilla\draft-site\site` (`lib/wizards.mjs`, `src/pages/wizard.js`, `build.mjs:241`), and for Rainmaker `E:\Rainmaker\site-src\pages\contact.html`, `careers.html` and `integrations\apps-script\Code.gs` (outside the order's "Inputs" list: step 3 says check Rainmaker's written forms, and the form options are only in those files; read, not edited).

## Not done / limits
- ELEV8 line numbers: `wizard.js:130, 172, 181, 191, 195, 196, 202` and `lib/wizards.mjs:23, 30, 35, 37, 41` were read in this session; `contract.json:1203` is the topic field. The line number cited for each is where the cited expression appears in the file as read today.
- `docs/departments/seo-and-audits.md` Rules section was not read in full (rules list in the order's header were applied from CLAUDE.md rule 4 only).
- Follow Up Boss, Salesforce and Wealthbox default status lists could not be read (BLOCKED above); their labels are not used.
- ELEV8's built draft was read only for form and wizard definitions; no form was submitted anywhere.
