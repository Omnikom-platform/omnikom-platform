# MLS listings feature: requirements (v0.1, 2026-10-27)

Status: DRAFT for the owner's review. Nothing here is built. First client: ELEV8 Real Estate Group (Alex Sevilla, Partner, CA DRE
02248556), 10 cities. The feature must serve every future real-estate client with the same code and the same procedure
(`sops/listings-feed.md`). Research behind every claim: `docs/listings/research/01-06`. Architecture: `ARCHITECTURE.md`.

## 1. What it is, in one paragraph
Live property search and listing pages on the client's own domain, in the client's design, fed by the client's own MLS(s) through
an IDX data licence issued to Omnikom as the client's technology vendor. Omnikom pulls the data (RESO Web API where offered), keeps
its own copy and its own photo cache, renders the pages, and keeps every MLS's display rules. Leads from listing pages land in the
client's dashboard CRM (platform decision 1/12). It replaces the client's Brivity IDX pages (today: Brivity templates on
brivityidx.com; disclaimer "Bay East MLS, or CCAR MLS, or bridgeMLS", read from our 2026-10-26 backup).

## 2. Facts that shape the requirements (sources in research/)
| Fact | Consequence | Source |
|---|---|---|
| One IDX licence covers one MLS's listings only. ELEV8's 10 cities span three MLSs: Concord, Walnut Creek = bridgeMLS family (Bay East / CCAR / bridgeMLS, Contra Costa); Fairfield, Suisun City, Vacaville, Vallejo, Benicia, Napa, American Canyon = BAREIS (Solano, Napa); Sacramento = MetroList | Up to **three licences** for ELEV8. The NorCal MLS Alliance "Combined IDX" feed may deliver them as one transport but still needs each MLS's approval and fees; MetroList's inclusion is unconfirmed | 01 (summary), 02 (facts 37-38), 03 (territory) |
| Each MLS requires the **broker to be a Participant** of that MLS (MetroList: the agent must also be a Subscriber) before any IDX display | If ELEV8 is not a member of BAREIS or MetroList, listings for those cities cannot be shown at all until they join. First intake question | 01 (1.5), 02 (7, 10), 03 (5) |
| bridgeMLS is **not** Bridge Interactive; bridgeMLS, Bay East and CCAR run on Paragon (ICE / Black Knight); BAREIS and MetroList run on Rapattoni | The connectors target the RESO Web API as served by Paragon and Rapattoni, not Bridge/Trestle/MLS Grid. The exact endpoints and auth grants are issued only after approval: build a generic OData connector with pluggable auth, and treat base URL + grant type as per-source configuration | 01 (2.1-2.4), 02 (15-17), 03 (platform) |
| Omnikom is on **none** of the approved-vendor lists (bridgeMLS ~130 names, Bay East 29, CCAR, BAREIS, MetroList 29). New-vendor approval: bridgeMLS "3 business days" (stated), Bay East 1-4 weeks, BAREIS 3-6 weeks + $50 + licence fee, MetroList no public path | Vendor approval is the critical path and the biggest risk (section 9). Start it the day the client signs | 01 (1.4, 1.9), 02 (2-6), 03 (process) |
| Refresh: NAR / C.A.R. / Bay East / bridgeMLS / BAREIS rules say **every 12 hours**; MetroList says 3 days; the bridgeMLS vendor agreement still says 72 h | Design to 12 h as the hard limit and 15-60 min as the normal cadence; show "Data last updated" | 01 (4.5-4.6), 02 (20), 03 (rules), 05 |
| Display rules differ per MLS: disclaimer text (bridgeMLS family: exact wording with the year; MetroList: its own mandatory text; BAREIS: wording not found), logo/icon, attribution content, sold window (bridgeMLS: 3 years; BAREIS: 180 days "Enhanced" tier only with a signed licence), no "Days on Market" on combined IDX, max results per query (100 bridgeMLS), no "MLS" in URLs | Compliance is **data, not code**: one rule set per MLS source, applied at render time, gated before go-live | 01 (4.1-4.15), 02 (20-26), 03, 05 (checklist) |
| Photo URLs: MLS Grid forbids hot-linking (signed, single-use, 1 h); Bridge allows CDN links; Paragon / Rapattoni rules unconfirmed | Always download photos to our own storage (R2). One pipeline for every platform | 04 (summary 7), 06 |
| Vendors report a monthly "customer list" duty (bridgeMLS, Bay East: by the 5th of each month) and MLS compliance checks of live sites | Ongoing ops are part of the feature, not an afterthought | 01 (1.7, 1.10) |

## 3. Functional requirements
### 3.1 Search
- F1. Search by **city**, **ZIP**, **address** (prefix / fuzzy), **MLS number**, **neighbourhood / subdivision** where the feed has it.
- F2. Filters: price min/max, beds, baths, property type (per feed's PropertyType / PropertySubType), square feet, lot size, year built, status (Active, Active Under Contract / Contingent; Pending and Sold only where the MLS rules and the licence allow), open house this weekend, keywords in public remarks.
- F3. Sort: newest, price, beds, size. Pagination; result cap per query as set by the MLS rule set (bridgeMLS: 100; default 100).
- F4. **Map search**: results as pins on a map with the list beside it; "search as I move" bounded by the viewport; cluster when dense. Map tiles: self-hosted vector tiles on R2 or a provider inside its free tier (cost note in research/06: a pooled Mapbox account for 20 clients would cost about $1,850/month; decide before client 2).
- F5. Selection only by **objective criteria** (geography, price, type, status). Never by listing broker or any compensation field (05 checklist 20, 29).
- F6. Seller / broker flags honoured at query time: `InternetEntireListingDisplayYN`, `InternetAddressDisplayYN` (address withheld), no-AVM, no-comments, private photos excluded, broker IDX opt-outs excluded (05 checklist 18-21).

### 3.2 Listing detail page
- F7. URL on the client's domain, no "MLS" in the path: `/listing/<city-slug>/<address-slug>-<ListingId>/` (address-withheld listings: `/listing/<city-slug>/<ListingId>/`).
- F8. Content: photos (our cached copies, ordered, primary first), price, status, beds/baths/size/lot/year, public remarks (verbatim, never edited), features, open houses, "Data last updated" stamp, the MLS source name, **attribution block** in the MLS's wording ("Listed by <firm>, <agent>, <phone or email>"; never "Courtesy of", which CRMLS bans) at type not smaller than the listing text, and the MLS disclaimer + copyright line at the bottom.
- F9. Contact / tour buttons name the responding agent (the client), and say so if the listing belongs to another broker (05 checklist 9).
- F10. Other brokers' listings: no client branding inside the listing body; the client's logo and contact larger than any third-party badge (01: 4.8).
- F11. Third-party data (schools, neighbourhood facts) in a visibly separate block with its own source label (05 checklist 17).
- F12. Off-market handling: when a listing leaves the allowed statuses, the page returns **410 Gone** (or a redirect to its city page) within one sync cycle; sold pages exist only where the rule set allows sold display, within the MLS's window, with the sold-page field limits (bridgeMLS: no remarks, no list price, main photo only).

### 3.3 City and area pages (the SEO surface)
- F13. One page per served city, `/homes-for-sale-in-<city>-ca/` (ELEV8 plan: 10 cities, 31-page site plan in `E:\Alex Sevilla\site-checks\elev8ca.com\.pewp\approved\plan\`), with original written content from the site's content contract (DB rows, decision 6) **plus** a live grid of current listings, counts, price range, newest, and links to neighbourhood / ZIP sub-pages where volume justifies them.
- F14. Thin or filtered URLs (search with parameters, page 2+, sorts) are `noindex,follow`; city pages and listing detail pages are indexable with self-canonical and are listed in a listings sitemap regenerated every sync.
- F15. Structured data: `RealEstateListing` + `Offer` + `Place/PostalAddress` JSON-LD on detail pages; `ItemList` on city pages; in the site's existing `@graph` convention (`planning/CONTEXT.md`).

### 3.4 Leads and accounts
- F16. Every listing and city page has the site's standard enquiry form (name, email, phone, message, listing reference). Submission writes to the tenant's lead inbox (platform part 4) with the listing key, URL and MLS source, and pushes to the CRM / OmniSuite when that API exists (decision 8/12). Consent copy per 05 checklist 30-33 (privacy link, unchecked TCPA consent next to the phone field).
- F17. **Later (not v1):** saved homes, saved searches with email alerts, "sign in to see more" (a VOW: separate agreement, login, terms; 05). v1 ships no accounts.

### 3.5 Client dashboard
- F18. The client sees: feed status per MLS (last successful sync, listing count, photo backlog), the display rule set in force, leads by listing, and which cities / neighbourhoods are enabled. The client cannot edit listing data (rule: never modify MLS data).

## 4. Non-functional requirements
| # | Requirement | Target | Why / source |
|---|---|---|---|
| N1 | Freshness | Incremental sync every **15 min** per feed (configurable per source); hard alert at 2 h stale; the rule limit is 12 h (MetroList 3 days) | 01/02/05 |
| N2 | Delete / off-market propagation | Status changes within one cycle; a daily key sweep catches silent removals (Trestle-style feeds do not report deletes; Paragon / Rapattoni behaviour unconfirmed) | 04 (sync recipe) |
| N3 | Photo freshness | New / changed photos cached within 15 min of `PhotosChangeTimestamp`; never serve an MLS URL directly | 04, 06 |
| N4 | Speed | Listing and city pages pass the platform's render gate and PageSpeed mobile targets used on every client site: LCP under 2.5 s on a phone, images sized per card, no layout jump (the design lab fixes panel height) | `sops/design-engine.md`; `E:\Alex Sevilla\draft-site\design\lab\sections\listings.html` |
| N5 | Availability | Pages keep serving from cache when the feed or the database is down (stale-while-revalidate up to the rule limit, then a "temporarily unavailable" notice, never a blank page) | ARCHITECTURE failure modes |
| N6 | SEO | Indexable detail + city pages, `noindex` filtered pages, sitemap per sync, 410 on removed listings, canonical rules in the build gate | 06 (SEO evidence) |
| N7 | Accessibility | WCAG 2.1 AA on all listing UI (tabs, cards, map alternative list, 44 px targets; the design lab already uses roles and focus styles) | 05 (Unruh exposure) |
| N8 | Anti-scraping | No public bulk JSON endpoint; rate limits on the search API; result cap per query; robots allow HTML, disallow the API | 01 (4.15), 05 checklist 23 |
| N9 | Multi-tenant | One system serves every client: per-MLS stores shared across clients licensed on that MLS, per-tenant display rights and rule sets, tenant isolation enforced in the DB (RLS) and in the renderer | ARCHITECTURE section 3 |
| N10 | Secrets | MLS credentials only in `E:\Omnikom Platform\.secrets\` (local tools) and in Worker / Supabase secrets (production). Never in code, DB rows, logs or chat | `sops/credentials.md` |
| N11 | Auditability | Every sync run logged (source, window, counts, errors); every render of a rule-bearing block traceable to the rule set version; monthly customer-list report producible from the DB | 01 (1.7) |
| N12 | Cost | Infrastructure under about $75/month for one client with 3 feeds, about $8/client at 20 clients on shared stores (ESTIMATE, research/06), excluding MLS fees | 06 |

## 5. Compliance requirements (the rule set each MLS source carries)
Each `mls_source` row carries a `display_rules` JSON with at least these keys; the renderer refuses to render listing data if the
rule set is missing or unsigned-off. Values below are what research found; every one is confirmed with the MLS in writing at
onboarding (SOP step 5) before go-live.

| Key | bridgeMLS / Bay East / CCAR | BAREIS | MetroList | Source |
|---|---|---|---|---|
| `disclaimer_text` | Exact combined text with year: "Bay East (c)YYYY, CCAR (c)YYYY, bridgeMLS (c)YYYY. Information Deemed Reliable but not Guaranteed. This information is being provided by the Bay East MLS, or CCAR MLS, or bridgeMLS. The listings presented here may or may not be listed by the Broker/Agent operating this website. This information is intended for the personal use of consumers and may not be used for any purpose other than to identify prospective properties consumers may be interested in purchasing. Data last updated at [DATE & TIME]." (min 7 pt) | Substance known (source, update date, personal non-commercial use); exact wording NOT FOUND, ask | Mandatory text beginning "All data, photos, visualizations..." in the 2026-06-01 rules; copy verbatim from the PDF before use | 01 (4.1-4.2), 02 (22), 03 |
| `logo` | Combined MLS IDX icon next to other brokers' listings (policy v4.1; confirm still current) | not found | none found | 01 (4.3) |
| `attribution_format` | Listing firm + listing agent + agent's phone or email, prominent, not smaller than listing text | Firm name + listing agent on every listing | Listing firm name + state of licensure on every display | 01 (4.4), 02 (21), 03 |
| `attribution_wording` | "Listed by" (never "Courtesy of" / "Presented by") | same | same | 05 |
| `refresh_max_hours` | 12 | 12 | 72 | 01, 02, 03 |
| `statuses_public` | Active, Pending, Sold (3 years) | Active, Contingent; Pending + Closed 180 days only with the "Enhanced" licence | per the IDX Guidelines (not found): start Active only | 01 (4.9), 02 (24-25), 03 |
| `sold_window_days` | 1095 | 180 (Enhanced only) | unknown: 0 until confirmed | same |
| `sold_field_limits` | no public remarks, no list price, main photo only | ask | ask | 01 (4.10) |
| `fields_allowlist` | Appendix C "IDX Data Fields" v2.0 (2024-04-04) | "Confidential Information" excluded; list not public | confidential fields excluded; list not public | 01 (4.11), 02 (23), 03 |
| `show_days_on_market` | false (combined IDX guideline) | ask | ask | 01 (4.12) |
| `max_results_per_query` | 100 | ask (C.A.R. model: 500) | ask | 01 (4.14) |
| `address_withheld_field` / `internet_display_field` | yes | yes | yes | all |
| `no_mls_in_url` | true | true | true | 01 (4.7), 05 |
| `brokerage_and_dre_on_every_page` | firm name + DRE licence numbers (B&P 10140.6, Reg 2773) | same | same | 05 |
| `monthly_customer_list_to` | idx@bridgemls.com / idx@bayeast.org by the 5th | ask | ask | 01 |
| `pre_launch_notice` | MLS notified and given access before go-live | same | same | 05 checklist 24 |
| `coming_soon_in_feed` | no (bridgeMLS, March 2026) | ask | ask | 02 (28) |

Site-wide (not per MLS): privacy policy on every page and form (CalOPPA), CCPA items only if the client crosses the thresholds,
TCPA consent text at the phone field, Equal Housing Opportunity statement, no fair-housing-sensitive filters or wording.

## 6. Out of scope for v1
VOW / login features, AVMs, agent-remark fields, rentals unless the feed includes them, mobile app, client-side editing of listing
data, pocket / "coming soon" listings added by hand (Clear Cooperation exposure, 05 checklist 28).

## 7. Open questions for the client (asked in `E:\Alex Sevilla\icm\work\p1\LISTINGS-EMAIL.md`)
1. Which MLSs the brokerage (broker of record) and Alex belong to today: bridgeMLS / Bay East / CCAR, BAREIS, MetroList.
2. Broker of record: name, DRE number, email (signs every MLS form).
3. Do they want Pending and Sold shown (extra licence tier at BAREIS; sold rules differ per MLS).
4. Brivity: contract end date, admin access, lead export.
5. Which cities matter most if a licence is slow (ranking the three MLSs for the launch order).

## 8. Open questions for the MLSs (asked by the client, SOP step 3)
Per MLS: the exact delivery API and auth (Paragon / Rapattoni RESO Web API endpoint, grant type), new-vendor approval steps and
fees (bridgeMLS "$3,000 per year BBO/DAA fee" clause 45: who pays), the current display rule document and disclaimer, sold/pending
tier, whether the NorCal Combined IDX feed can carry BAREIS and MetroList data for a bridgeMLS participant, and whether one
vendor licence may serve several of Omnikom's clients (shared store) or must be per website.

## 9. Risks, ranked
1. **Vendor approval time and discretion** (all three MLSs; BAREIS "sole discretion", MetroList no public path): mitigations in SOP step 4 (start day one; interim option: keep Brivity search on a subdomain; fallback: a licensed API vendor such as SimplyRETS, which is on BAREIS's list, as a temporary data source behind the same connector interface).
2. **Membership gap**: if ELEV8 is not a BAREIS or MetroList participant, 8 of 10 cities have no listings until they join.
3. **Rule drift and conflicts** between documents of the same MLS (12 h vs 72 h; sold tiers): the written confirmation at onboarding is the only safe source; the rule set is versioned.
4. **Feed mechanics unknown until credentials exist** (Paragon / Rapattoni specifics, delete semantics, media rules): the connector is generic; the first week with real credentials is a measurement week, not a build week.
5. **Multi-tenant licensing**: an MLS may require per-website licences and reject a shared store; the schema supports both (isolated source rows per licence).
6. **SEO**: listing pages alone do not rank (duplicate content across every IDX site); only the city / area pages with original content do. Do not promise listing-page rankings.
