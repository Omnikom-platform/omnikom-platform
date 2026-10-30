# ELEV8 Real Estate Group: what will be produced

Owner, 2026-10-30 21:32: "ELEV8's client will be split into a few parts now. ELEV8 will become real estate focused and we will
remove the other parts from it; the cash offer and mortgage will become its own stuff, Alex buys homes and Sunny buys homes
something like that; so it will be turned into 2 or 3 websites based on the agreement we will have with them."

So: one site exists today (the paused preview, section 1); the split makes two or three (sections 2 to 4), every one of them
"waiting for the agreement". The working names are the owner's words; the mapping "Alex buys homes = the cash-offer site,
Sunny buys homes = the mortgage site" is the head of operations' reading of them (Sunny Azizi is the team's licensed loan
originator, Alex the cash buyer per `facts.md`), to be confirmed by the owner with the three questions in section 5. Nothing
in sections 2 to 4 is built, planned with the search engine, or promised to the client.

## Workspace (the platform side)
| Item | Value | Source |
|---|---|---|
| Platform workspace(s) | DECIDED by the owner 2026-10-30 21:58: "A workspace per site". Each site below is its own platform workspace with its own dashboard owner, lead inbox and bill: "ELEV8 Real Estate Group" (the real-estate site), the cash-offer site's workspace, the mortgage site's workspace if that site is agreed. A person who works on two lines (Alex, Sunny) is a member of two workspaces (`13-DATA-MODEL.md` section 3: "One person can be in several workspaces"). The data model needs no change for this; the question whether a site can later move between workspaces falls away | `clients/elev8/decisions.md` 2026-10-30 21:58; `docs/blueprint/13-DATA-MODEL.md` sections 0 and 3 |
| Dashboard owner(s) and members | unknown until the agreement (Q9 of the Launch Information Request asks who gets lead alerts; the dashboard login is the next question) | `deliverables\questions-for-alex.md` Q9 |
| Lead inbox routing | per site in the inbox (leads carry `site_id`); who at ELEV8 answers which site's leads is unknown | `docs/blueprint/15-CRM.md` |
| Add-ons | none bought; the OmniSuite follow-up and voice agent are rented add-ons (DECISIONS 1, 12); the listings feed (`docs/listings/`) is researched, not offered | `planning/DECISIONS.md` 1, 12; `docs/listings/REQUIREMENTS.md` |

## 1. The site that exists today: the ELEV8 preview (one site, everything in it)
| Item | Value | Source |
|---|---|---|
| Purpose | ELEV8's whole offer in one site: agent searches per city, buyer searches, "sell my house fast" (cash) searches, financing, team | `site-checks\elev8ca.com\.pewp\approved\plan\page-plan.md`; `draft-site\site\dist` page list |
| Domain | elev8ca.com (the client's; nameservers to the Omnikom account at launch, DECISIONS 26); preview on https://elev8-omnikom-website.pages.dev (noindex) | `planning/DECISIONS.md` 26; `E:\Alex Sevilla\.claude\POSITION.md` 2026-10-29 19:37 |
| Brand shown | ELEV8 Real Estate Group; broker disclosure Xpert Home Realty (Xpert Home Lending Inc., CA DRE 02166758) plus each agent's own broker; partner band ELEV8, Xpert, Better Rate Mortgage, eXp Realty, Park Lane Capital (logos pending Q11) | `draft-site\DONE-REPORT.md` rows 8 and 9 |
| Pages (42 contract pages incl. `/blog`; the built preview has 57 with 9 profiles, 4 sample listings and the 404) | Core: `/`, `/team` + 9 `/agent-profile/<slug>`, `/buying`, `/selling`, `/financing`, `/home_value`, `/reviews`, `/faq`, `/blog`, `/connect`, `/areas-we-serve`, `/privacy_policy`, `/tos`, `/accessibility-statement`. Search plan (31, signed): 10 `/realtor-in-<city>` (American Canyon, Benicia, Concord, Fairfield, Napa, Sacramento, Suisun City, Vacaville, Vallejo, Walnut Creek), 10 `/homes-for-sale-in-<city>-ca`, 9 `/sell-my-house-fast-in-<city>-ca` (no American Canyon), `/areas-we-serve`, `/`. Item pages: `/listings/<slug>` (client-fed; 4 marked samples now) | `page-plan.md` (31 rows); `draft-site\site\dist` listing read 2026-10-30; the 42 count: `E:\Omnikom Platform\.claude\POSITION.md` line 55 |
| Forms and lead flows | Hero tabs Buy / Sell / Value / Cash; wizards: home value (6 steps), home finder (6 steps, financing step hands to Sunny), sell / cash offer, contact, "Ask about this home" on listings; all post the platform's LeadRequest to `/api/lead` (preview stub, nothing sent); contract forms mapped to the 6 OmniSuite real-estate fields | `E:\Alex Sevilla\.claude\POSITION.md` 2026-10-28 ~00:40; `draft-site\DONE-REPORT.md` rows 3, 6, 11; `draft-site\LAUNCH-CHECKLIST.md` block 3 |
| Status | PREVIEW, PAUSED (owner 2026-10-29 20:48) | `clients/elev8/decisions.md` |
| Where the work is | `E:\Alex Sevilla\draft-site\site` (build, rows, tests); look-folder `sites/elev8/design/` in the platform NOT YET MADE (build step 4) | `planning/DECISIONS.md` 27; `docs/blueprint/25-BUILD-SEQUENCE.md` step 4 |

## 2. Site: ELEV8 real estate (keeps the brand)
| Item | Value | Source |
|---|---|---|
| Purpose | The real-estate team site: agent searches and buyer searches per city, the team and its profiles, listings the client posts, neighbourhoods and areas, buyer and seller guides, reviews, blog | owner 2026-10-30 21:32 ("ELEV8 will become real estate focused"); department brief |
| Domain | elev8ca.com (the client's; UNPROVEN that it stays the brand's domain until the agreement says so) | `profile.md` |
| Brand shown | ELEV8 Real Estate Group, the 9 team members with their own brokers of record, the Xpert disclosure | section 1 |
| Industry pack | `real-estate-agent` | `sops/clients/site-scope.md` section 3 |
| Pages that stay here (from the 42) | `/`, `/team` + 9 profiles, `/buying`, `/selling`, `/home_value`, `/reviews`, `/faq`, `/blog`, `/connect`, `/areas-we-serve`, legal (3), 10 `/realtor-in-<city>`, 10 `/homes-for-sale-in-<city>-ca`, `/listings/<slug>` = 31 of the 42 plus the profiles and listings | section 1 page list; the owner confirms with question B |
| Pages that leave | 9 `/sell-my-house-fast-in-<city>-ca` (to the cash-offer site), `/financing` (to the mortgage site) = 10 of the 42 | owner 2026-10-30 21:32 ("remove the other parts from it") |
| Forms and lead flows | home value wizard, home finder wizard (its financing step then points at the mortgage site or at Sunny, question B), contact, "Ask about this home"; the hero loses the Cash tab (or links it to the cash-offer site, question B) | section 1 |
| Shared with the other sites | candidates: the team members who work on each line (Alex, Sunny), licences (DRE, NMLS), the office address and phone, reviews that are about that line of work, the brand's colours and type if the owner wants one family look (question C) | `facts.md` |
| Must NOT be shared or claimed | ELEV8 does not lend and does not say Alex originates loans (NMLS 0 active); a cash purchase is a promise only the buyer entity makes (Q4 unanswered); Francine's VTV material never enters any ELEV8 site; partner logos only with permission | `profile.md` compliance notes |
| Status | waiting for the agreement | owner 2026-10-30 21:32 |
| Where the work is | the current draft minus the pages that leave: a row edit and a rebuild in `E:\Alex Sevilla\draft-site\site` (DECISIONS 16), then the look-folder in the platform; a new signed plan for this site (the search pages that stay) | `planning/DECISIONS.md` 16, 27 |

## 3. Site: cash offer (working name "Alex buys homes")
| Item | Value | Source |
|---|---|---|
| Purpose | "Sell my house fast" and "we buy houses" searches per city: the cash-offer line (wholesale and flipping) with its own brand, so ELEV8's agent brand does not carry the buyer's promise | owner 2026-10-30 21:32; `facts.md` "Alex's three lines of work"; the audit found 23 competitor cash pages ranking (`EVIDENCE.md`) |
| Domain | unknown until the agreement (no domain, no business name and no cash-buyer brand on record: `facts\PROFILE.md` "Cash-buyer brand: none found") | `profile.md` |
| Brand shown | the working name only; the buying entity (ELEV8, Alex personally, a partner company) is Launch Information Request Q4, unanswered; licence line as the cash-home-buyer rules require | `deliverables\questions-for-alex.md` Q4; skill `rules/industries/cash-home-buyer` |
| Industry pack | `cash-home-buyer` (client-fed collections: situations, purchases) | `sops/clients/site-scope.md` section 3 |
| Pages that move here (from the 42) | 9 `/sell-my-house-fast-in-<city>-ca` (Benicia, Concord, Fairfield, Napa, Sacramento, Suisun City, Vacaville, Vallejo, Walnut Creek) plus the site's own core (home, how it works, situations, reviews, FAQ, contact, legal) from `sops/clients/site-scope.md`; its own search plan is a new plan-site run | `page-plan.md`; owner confirms with question B |
| Forms and lead flows | the sell / cash-offer wizard (address, condition, timeline, contact) posting to this site's own `/api/lead`; leads in the same inbox under this site's `site_id` | section 1 forms; `docs/blueprint/15-CRM.md` |
| Shared with the other sites | Alex (name, phone, DRE licence as an agent: the cash-buyer rules say when an agent must disclose); the office address; reviews only if they are about a cash sale; link back to ELEV8 for "list it instead" (question C) | `facts.md` |
| Must NOT be shared or claimed | not "ELEV8 buys your house" unless Q4 says ELEV8 is the buyer; no agent-brokerage claims on the buyer site unless the rules require the disclosure; no invented days-to-close or fee figures (Q4) | `profile.md` compliance notes |
| Status | waiting for the agreement | owner 2026-10-30 21:32 |
| Where the work is | nothing yet: a new client site on the platform (plan, design per `sops/clients/site-scope.md`, build once, preview) | `docs/departments/clients.md` |

## 4. Site: mortgage (working name "Sunny buys homes")
| Item | Value | Source |
|---|---|---|
| Purpose | Mortgage and rate searches: the financing line, under the licensed loan originator | owner 2026-10-30 21:32; `facts.md` "Sunny Azizi" |
| Domain | unknown until the agreement | |
| Brand shown | the working name; the lender of record is Better Rate Mortgage Inc. (NMLS 1852295) with Sunny Azizi NMLS 2676817: a mortgage site must show the NMLS numbers with the name and make clear the loans come from that company, not from ELEV8 (Q3 of the Launch Information Request, unanswered) | `facts\nmls-2026-10-26.md`; `deliverables\questions-for-alex.md` Q3 |
| Industry pack | NOT BUILT: no mortgage / lender compliance pack exists (packs: real estate, insurance, cash home buyer); default rules until one is written. Finding for the head of operations (SEO and audits or platform build owns the rules) | `sops/clients/site-scope.md` section 3; `planning/DECISIONS.md` 18 |
| Pages that move here (from the 42) | `/financing` (1 of the 42) plus a new plan: loan types, rates, first-time buyer and VA / Travis AFB topics the audit found 14 competitor mortgage pages for; its own core pages | `EVIDENCE.md` "14 mortgage pages absent"; `page-plan.md` has no mortgage pages (the 2026-10-27 plan kept financing as one support page) |
| Forms and lead flows | a financing / pre-approval enquiry posting to this site's own `/api/lead`; the ELEV8 home-finder wizard's financing step hands over to this site or to Sunny (question B) | section 1 forms |
| Shared with the other sites | Sunny (name, NMLS, DRE), the phone buyers use to reach Sunny (Q3 asks which), link to ELEV8 for the agent side (question C) | `facts.md` |
| Must NOT be shared or claimed | Alex is never shown as a loan officer; ELEV8 (the agent team) is not the lender; whether Better Rate Mortgage allows its name and logo on a site it does not run is unknown (Q11 asked about logos only) | `profile.md` compliance notes |
| Status | waiting for the agreement (and the owner's answer whether this is the third site or stays a page on ELEV8) | owner 2026-10-30 21:32 ("2 or 3 websites") |
| Where the work is | nothing yet | |

## 5. Questions put to the owner (2026-10-30 21:58; answers recorded in `decisions.md` the same turn)
A. **Workspace shape.** Asked: one platform workspace holding two or three sites, or a workspace per site. ANSWERED: "A
workspace per site" (the Workspace table above is updated).
B. **What moves.** Recommendation as written in sections 2 to 4: the 9 sell-my-house-fast pages and the Cash tab to the
cash-offer site; `/financing` and the home-finder's financing hand-off to the mortgage site; everything else stays on ELEV8.
ANSWERED: "We will determine after a meeting". Sections 2 to 4 stay a recommendation, not a decision, until then.
C. **What is shared.** Recommendation: people and licences (Alex on ELEV8 and the cash site; Sunny on ELEV8 and the mortgage
site), the office address and phones, cross-links between the sites, one design family; NOT shared: the ELEV8 brand name and
logo (each site its own name), reviews unless about that line, and no cross-claims (ELEV8 does not lend or buy unless Q3 / Q4
say so). ANSWERED: "We will determine after meeting". Same standing as B.
Next step for this file: after the meeting with the client, the owner's words on B and C go into `decisions.md` and sections
2 to 4 become decided rows (slice 3 of the charter).
