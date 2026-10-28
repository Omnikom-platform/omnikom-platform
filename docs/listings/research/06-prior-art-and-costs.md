# 06 - Prior art and costs: IDX vendors, developer APIs, self-build cost model (2026-10-27)

Scope: build a RESO Web API listings feature (feeds into Postgres/Supabase, pages on the client's domain, Cloudflare Workers) versus buy an IDX vendor. Read-only web research, all pages read on 2026-10-27.

Status key. CONFIRMED = official vendor, platform or MLS page that I opened. REPORTED = third-party page, or a search-result summary of a page I did not open. UNCONFIRMED = could not verify. ESTIMATE = my arithmetic, assumptions shown.

Method note. Pages were read through a fetch tool that returns a model-written extraction, not raw HTML. Numbers below are as extracted; re-open the page before putting any figure in client text.

## Summary

- **Delivery model splits two ways.** On-domain pages: Showcase IDX (WordPress plugin, "never subdomains or iframes"), iHomefinder Optima Express (WordPress plugin, pages under the client's domain), Real Geeks (hosted site on a custom domain), IDX Broker (embed codes or the IMPress WordPress plugin; Elite is a hosted site). Brivity's own pages say nothing about listing-page URLs; they mention "agent subdomains". Whether Brivity listing pages are indexable on the client's domain is UNCONFIRMED and should be checked on the live site.
- **Vendor price for one client with 3 MLSs is roughly $120-$430/month** plus MLS pass-through fees. Pass-through is "$0 to $33/month" per Showcase and $5-$30 per another Showcase page. Setup is $0 (Showcase), about $100 (IDX Broker, REPORTED), $500 (Real Geeks, iHomefinder Essentials website). Brivity starts at $299/month with CRM and IDX website bundled.
- **Developer APIs are cheap, MLS fees are the real variable.** SimplyRETS $49/$99/$199 per month plus $99 per connection and $25/$50/$100 per extra feed. Spark API $50 per MLS per month. Bridge charges no platform fee (REPORTED); Trestle is $85 per vendor feed per month where Miami REALTORS and CRMLS publish it. MLS Grid charges nothing itself and collects whatever the MLS sets.
- **No path avoids MLS paperwork.** Repliers states it "does not bypass MLS licensing". SimplyRETS says you obtain credentials from the MLS. Even a vendor model needs the broker's participation approval or a vendor/consultant data agreement. Time to onboard: Showcase 1-5 business days, Optima Express under 1 day to about 1 week, IDX Broker 2-3 weeks after credentials, bridgeMLS membership 1-3 business days (REPORTED); bridgeMLS vendor/data-access approval time is not published.
- **bridgeMLS may not be on Bridge Interactive.** One third-party guide says bridgeMLS runs on Paragon and vendor feeds come from Property Information Central (paragonapi.com), "Bridge Interactive ... is unrelated" (REPORTED). An old IDX Broker page says WEBAPI via Bridge API. Contradiction UNCONFIRMED; resolve with bridgeMLS before choosing an ingestion adapter. See also sibling file 01-bridgemls.md.
- **Self-build infrastructure is cheap.** ESTIMATE, 1 client with 3 feeds at 100k listings each: about $75/month with pre-generated image variants, about $44/month if only active listings' photos are cached, about $160/month if photos are resized on demand with Cloudflare Images. 20 clients sharing 5 feeds: about $151/month, versus about $1,125/month if each client gets an isolated stack. Excludes MLS data fees ($11-$255/month per client), map tiles, and engineering time.
- **Photos are the one design-forcing fact.** MLS Grid forbids using MediaURLs on a website: download a copy; URLs are single-use and expire after one hour (new media host from 2026-09-08). That pushes you to R2 caching. Bridge, Trestle and Paragon photo rules: UNCONFIRMED.
- **Engineering risk is normalization, not storage.** Reported pain: status codes ("Active", "A", "ACT"), 20+ spellings of one subdivision, creation dates in UTC, GMT, local time or date-only, per-MLS rate limits, replication endpoints that need separate MLS approval, 403 returned for rate limits.
- **SEO evidence is thin and mostly vendor-authored.** Google says duplicate content is a consolidation and crawl-efficiency matter, not a penalty, but its spam policy lists "harvesting feeds" into low-value pages as scaled content abuse. I found no controlled study showing IDX listing pages rank. The defensible plan is area/neighborhood pages with original content, listing pages with self-canonical and sitemap, and thin or filtered URLs kept out of the index.
- **MLS compliance is real and local.** bridgeMLS IDX rules require refresh at least every 12 hours, attribution, a disclaimer, no modification. Fine schedules found are from other MLSs or old rule sets (for example $250 on a second IDX violation, loss of IDX on a third, in an EBRD appendix dated 2016); how CA MLSs audit websites and whether they use screenshots: UNCONFIRMED.

## Vendor comparison

Prices are monthly USD unless noted. "Who files" = who submits the MLS paperwork.

| Vendor | Model | On-domain SEO pages? | Price | CA MLS coverage (bridgeMLS / BAREIS / MetroList) | Who files MLS paperwork | Source |
|---|---|---|---|---|---|---|
| iHomefinder (Optima Express) | WordPress plugin; pages generated under client's domain, "doesn't frame listings or use wrappers or subdomains". Data updates every 2 h for most MLSs, as often as 15 min for some (vendor statement). | Yes, vendor-claimed ("full SEO credit", indexable). No benchmarks. | Pricing page shows plan names (Lead Essentials, Lead Maximizer, Growth Pro) with no base prices; "Website setup $500 one-time" for Essentials; extra MLS $25 (1 agent) or $50 (2+ agents) per month on Essentials/Maximizer; Growth Pro unlimited MLSs. Older third-party: $49.95/mo, $99 setup (REPORTED, undated). | Coverage page lists bridgeMLS (Bay East, CCAR, EBRD), Contra Costa, BAREIS, MetroList, MLSListings, CRMLS. Fees per board not shown. | Not stated; agent must be active MLS member and principal broker approves. Approval "under one business day to about a week" (plugin page). Build estimate "2 to 6 weeks". | https://www.ihomefinder.com/pricing/ ; https://wordpress.org/plugins/optima-express/ ; https://www.ihomefinder.com/mls-coverage/ ; https://www.ihomefinder.com/blog/agent-and-broker-resources/build-an-idx-website/ |
| Showcase IDX (owned by Constellation1) | WordPress plugin; pages on client's domain; "never uses subdomains or iframes". | Yes, vendor-claimed "100% indexable pages". Premium adds indexable XML sitemaps and pagination past the first 100 listings. | Essentials $94.95 (2 users), Premium $124.95 (5 users); annual $849.50 / $1,195; $0 setup; MLS pass-through "$0 to $33/month" shown at signup. Support page says $5-$30. | MetroList page exists (client share $5/month). bridgeMLS and BAREIS: coverage search is dynamic, not verified. | Customer signs MLS documents electronically; approval "typically 1-5 business days"; vendor maintains MLS compliance. | https://showcaseidx.com/pricing/ ; https://support.showcaseidx.com/hc/en-us/articles/360003529171-What-is-an-MLS-Pass-Thru-Fee- ; https://showcaseidx.com/mls-coverage/metrolist-ca-metrolist-sacramento/ ; https://www.constellation1.com/ |
| IDX Broker | Embed codes/widgets on any site; free IMPress WordPress plugin; Elite is a fully hosted site. Homepage does not say subdomain, wrapper or iframe. | Claims only ("SEO boosting tools", Elite "SEO-friendly"). No data. | Core $60, Engage $99, Elite $149 (official homepage); setup fee exists, amount not on page; developer-partner page and reviews: $100 setup (waived via developer partner), $30/month per additional MLS plus MLS fees (REPORTED). | Coverage page lists Bridge MLS, Bay East + Contra Costa (BECCAR), BAREIS, MetroList - Sacramento, MLSListings, CRMLS, SF MLS. | Not stated. "A new MLS can typically go live within 2-3 weeks after credentials are received." | https://www.idxbroker.com/ ; https://www.idxbroker.com/idx_mls_coverage ; https://www.idxbroker.com/mls/bridge-mls-bridgemls ; https://developers.idxbroker.com/?p=860 |
| Real Geeks | Hosted all-in-one platform with custom domain, IDX site included. | Claims "Built for SEO, AEO, & GEO", "thousands of AI-generated local area pages". No ranking data. | Platform $399/month + $500 one-time setup, 2 users; IDX feed $10 per MLS board per month; extra users $25 (3-10). Domain transfer fee $50 if they bought your domain. Lead packages $299-$599 extra. | Page does not list boards. UNCONFIRMED. | Not stated. | https://www.realgeeks.com/pricing |
| Brivity IDX (client's current vendor) | Platform with IDX site; "agent subdomains" (name.domain.com) with wildcard DNS. Hosting and listing URL structure not stated. | UNCONFIRMED. Marketing lists AI meta titles, XML + HTML sitemap, Search Console integration; no ranking claims. | "Starts at $299 per month for solo agents", includes CRM, IDX website, transaction tools, marketing automation. Setup fee amount not found (a third party says a one-time non-refundable fee exists). | Not listed on its pages. UNCONFIRMED. | Not stated. | https://www.brivity.com/faq/ ; https://www.brivity.com/website/ ; https://www.luxurypresence.com/blogs/brivity-pricing/ (search summary only, page returned 403) |
| SimplyRETS (developer API) | REST/JSON wrapper over any RETS or RESO Web API feed; you build the site (or use their WordPress plugin). 30-minute refresh. | n/a (you own the pages). | Basic $49, Premium $99 (adds Closed status), Enterprise $199; one-time $99 connection fee per feed; extra feeds $25 / $50 / $100 per month by tier; Geocoding $15, Market Analytics / Agents / Offices APIs $40 each per month. | "Works with any standard RETS or RESO Web API data feed"; no MLS list on the pages I read. | Customer gets credentials from the MLS; SimplyRETS reviews and signs a vendor/data access agreement if the area requires one. | https://simplyrets.com/ ; https://simplyrets.com/faq |
| Spark API (FBS) | Developer API on the Spark/flexmls platform; also RESO Web API replication endpoint. | n/a | Developer sign-up free; "$50/mo for each MLS you can access"; multiple keys per MLS count once; RETS $75/mo per MLS from 2026-03-01, rising every six months. | Only MLSs that run Spark. CA coverage not verified. bridgeMLS is reported to be Paragon, not Spark. | Each MLS must grant permission; IDX apps need MLS member authorization. | https://www.sparkplatform.com/docs/overview/faq ; https://sparkapi.io/pricing ; https://sparkplatform.com/docs/overview/api |
| Repliers | API plus image CDN, AI search; data accessed on demand, not replicated. | n/a | Standard plan 199 USD for a US MLS (CAD 199 for Canadian); "billed by the number of MLS systems they're approved to access". Another Repliers page says usage-based. Conflict UNCONFIRMED. | Directory lists 42 CA MLSs including bridgeMLS, BAREIS, MetroList, Bay East, Contra Costa, MLSListings, CRMLS, SF Association MLS. | "It does not bypass MLS licensing"; production data needs agent/brokerage or vendor approval. Who files: not stated. | https://help.repliers.com/en/article/qa-related-to-pricing-1hbxiq3/ ; https://repliers.com/mls-directory/california/ ; https://help.repliers.com/en/article/understanding-the-value-of-repliers-apis-compared-to-mls-apis-169xuap/ ; https://repliers.com/for-brokers-agents/ |
| Constellation1 | Enterprise/brokerage websites + CRM; owns the Showcase IDX brand. | No SEO claims on its page. | Not listed. KCRAR association member rates (not general): IDX from $39.95 + $79 setup; template sites $89.95 + $199 setup (REPORTED, time-limited). | Claims "300+" MLS and association partners; CA list UNCONFIRMED. | Not stated. | https://www.constellation1.com/ ; https://kcrar.com/kcrar-members/membership/benefits-and-resources/idx-websites/ (search summary only, page returned 503) |
| Realtyna | WordPress plugins (WPL, Organic IDX); RealtyFeed "MLS Router" is a product for MLSs and vendors. | Plugin pitch only. | No official price found. WordPress.org shows the WPL plugin closed as of 2026-07-29 (REPORTED). | UNCONFIRMED. | UNCONFIRMED. | https://realtyfeed.com ; search summary of WordPress.org plugin page |
| RealtyCandy | Not an IDX vendor in my results: WordPress add-ons for IDX Broker (lead connector, "IDX Broker Extended"). The brief's "RealtyCandy/Repliers" pairing looks like two different companies. | n/a | Connector shows $0 plugin price; needs an IDX Broker account. | n/a | n/a | https://discover.commoninja.com/wordpress/plugin/realtycandy-gravity-forms-to-idxbroker-connector (search summary only) |

### Cost of the same job on each path (1 client, 3 MLS feeds, monthly) - ESTIMATE

- Showcase Essentials: $94.95 + up to 3 x $33 pass-through = up to $193.95 (Premium: up to $223.95). Multi-MLS add-on price is not stated on the pricing page.
- IDX Broker Core: $60 + 2 extra MLS x $30 = $120, plus MLS fees. Elite: $149 + $60 = $209, plus MLS fees.
- Real Geeks: $399 + 3 x $10 = $429, plus $500 one-time. MLS fees not stated.
- SimplyRETS Basic: $49 + 2 x $25 = $99 (Premium: $99 + 2 x $50 = $199), plus $99 x 3 = $297 one time, plus MLS fees, plus the cost of building and hosting the site.
- Repliers: if "per MLS system" is right, 3 x $199 = $597. UNCONFIRMED reading.
- Spark: 3 x $50 = $150, only where all three MLSs are on Spark (unlikely for bridgeMLS).

### MLS-side data fees published by MLSs themselves (vendor/platform access)

| MLS / platform | Published figure | Source | Status |
|---|---|---|---|
| Miami REALTORS | Trestle: vendors $85/month per feed; brokers $30 own data or $100 MLS-wide. Bridge: no additional cost for vendors or members. Vendor IDX Plus $1,310/yr for 1-10 clients up to $102,375/yr for 3,001-9,999. | https://www.miamirealtors.com/mls/webapi/pricing/ | CONFIRMED (one MLS; not CA) |
| CRMLS (CA) | Via Trestle: two broker feeds free, then $85/month IDX feed or $25 broker feed; developer/new vendor: $7 per website URL (first 2 free) plus $85/month Trestle fee. Direct RESO feed requires a data licensing agreement with CRMLS. | https://go.crmls.org/idx-resources/ | CONFIRMED |
| MLSListings (CA) | IDX feed: about 95 fields, 10 property classes, sold back 3 years; "IDX+" can include datashare partners Metrolist, CRMLS, Bay East, SFAR, BAREIS, Contra Costa, bridgeMLS, TheMLS after a vetting process. RETS or API. Fees not on page. | https://support.mlslistings.com/s/article/IDX-Data-Feeds | CONFIRMED |
| bridgeMLS (CA) | No vendor fee schedule published. Third party quotes a 2021 subscriber form ($200 one-time, $499/year). IDX Broker page (age unclear) shows $145 one-time setup and $6/month data management. | https://mlsimport.com/bridgemls/ ; https://www.idxbroker.com/mls/bridge-mls-bridgemls | REPORTED |
| MetroList (CA) | No MetroList schedule found. Showcase: client share $5/month. Older IDX Broker page (about 2,300 days old per search snippet): $35 connection + $15/month. A reseller says a direct feed "can cost you up to $2000/month". | https://showcaseidx.com/mls-coverage/metrolist-ca-metrolist-sacramento/ ; https://web4realty.com/?p=12056 | REPORTED |
| BAREIS (CA) | Nothing found. | - | UNCONFIRMED |
| Other MLS examples (via MLS Grid) | Heartland $100 setup + $175/month; Canopy $500 + $100/month; NorthstarMLS $1,000 dev + $500 startup, then $125-$500/month by customer count. | search summary of https://kcrar.com/... , https://go.canopymls.com/data , https://northstarmls.com/?p=661 (I could not open these pages) | REPORTED |

## Developer APIs as a middle layer

- **SimplyRETS.** Cheapest wrapper with published prices (table above). Pro: normalizes RETS/RESO into one REST shape, SimplyRETS signs the vendor agreement if needed. Con: 30-minute refresh on every plan, no photo-hosting or media-rule information found, MLS coverage is "whatever feed you can get credentials for". CA MLS list: not published on pages I read.
- **Repliers.** Hosted search, image CDN ("media repository and CDN"), AI features; lists 42 CA MLSs including the three of interest. Price reading conflicts (per-MLS subscription vs usage-based). Strongest middle-layer candidate if photo hosting and CA coverage matter; get a written quote.
- **Bridge Interactive directly.** A third-party profile says Bridge charges no extra service fee to vendors or brokerages (REPORTED); MLS-set license fees may flow through the platform. Access is initiated through the MLS, then approved per dataset by MLS staff. Miami REALTORS states "no additional cost" for Bridge vendors (CONFIRMED, one MLS).
- **MLS Grid.** No fee of its own; "will collect any license fee required by participating MLSs on their behalf". One standard license covers IDX, VOW and back office. Participation is at the MLS's discretion. Participating CA MLSs: not found.
- **Trestle (Cotality).** Cotality's page says Trestle is "available to multiple listing organizations at no cost" and lists no vendor prices; the "How much does Trestle cost" answer was not in the page text I could read. Vendor numbers exist only on MLS pages ($85 per feed at Miami and CRMLS). A 2017 Inman figure of $75 per feed per month is old (REPORTED via search summary). I did not find "data access pricing tiers" published by Cotality.
- **Warning on search results.** docs.trestleiq.com ("Trestle IQ", phone and identity verification) is a different product from Cotality Trestle. I discarded those results.

## Self-build cost model

### What an own feed needs

| Component | Need | Public price point (read 2026-10-27) |
|---|---|---|
| Ingestion job | Poll every 15-60 min per feed, cursor on ModificationTimestamp, handle deletes, plus a nightly reconciliation | Cloudflare Workers Paid $5/month; 10M requests and 30M CPU-ms included; overage $0.30/M requests, $0.02/M CPU-ms; Cron Trigger invocations billed as normal invocations; max 250 cron triggers per account. Limit that matters: cron CPU time is 30 s for intervals under 1 hour, 15 min for 1 hour or longer; 10,000 subrequests per invocation; 128 MB memory. https://developers.cloudflare.com/workers/platform/pricing/ , https://developers.cloudflare.com/workers/platform/limits/ |
| Alternative scheduler | pg_cron + Edge Functions inside Supabase | Supabase Cron: jobs "from every second to once a year"; keep to 8 or fewer concurrent jobs and 10 minutes or less per job; page states no extra cost. Edge Functions: 2M invocations included on Pro. https://supabase.com/docs/guides/cron , https://supabase.com/pricing |
| Job fan-out for photos | Queue of photo downloads | Cloudflare Queues: 1M operations/month included, then $0.40/M; about 3 operations per delivered message. https://developers.cloudflare.com/queues/platform/pricing/ |
| Postgres | Listings, media rows, history, area content, search | Supabase Pro from $25/month; 8 GB disk per project included, extra $0.125/GB; 250 GB egress included, extra $0.09/GB; compute Micro $10, Small $15, Medium $60; $10 monthly compute credit. https://supabase.com/pricing |
| Photo cache | Original JPEGs, resized variants | R2 Standard $0.015/GB-month; Class A $4.50/M; Class B $0.36/M; egress free; free tier 10 GB, 1M Class A, 10M Class B. Infrequent Access $0.01/GB with $0.01/GB retrieval. https://developers.cloudflare.com/r2/pricing/ |
| Image resizing | Thumbs and card sizes | Cloudflare Images: first 5,000 unique transformations/month free, then $0.50 per 1,000 unique; images in R2 can be transformed and pay only the transformation charge plus R2. Images storage $5 per 100,000 images, delivery $1 per 100,000. https://developers.cloudflare.com/images/pricing/ |
| Map tiles | Map search | Mapbox GL JS: 50,000 loads/month free, then $5/1,000 (50k-100k), $4 (100k-200k), $3 (200k-1M). https://www.mapbox.com/pricing . Self-hosting open tiles (Protomaps/PMTiles over HTTP range requests) is possible; hosting cost and file size not verified. https://docs.protomaps.com/ |
| Search index | Filters, text, geo | Postgres full-text and geo queries in the same database; no extra service priced here. A separate search engine was not researched. |

### Assumptions (all ESTIMATE unless stated)

- Brief's sizing: 100,000 listings per feed, 30 photos per listing, 200 KB per photo.
- Photos per feed: 100,000 x 30 = 3,000,000. Bytes per feed: 3,000,000 x 200 KB = 600,000,000 KB = 600 GB (decimal). Three feeds = 1,800 GB.
- Postgres per 100k listings: about 3.5 GB. Basis: about 95 populated fields per listing in an IDX feed (MLSListings page, CONFIRMED) at roughly 10 KB per listing row with text, plus 30 media rows x about 250 B = 7.5 KB, so (10 + 7.5) KB x 1.5 for indexes = about 26 KB; x 100,000 = 2.6 GB; plus 30 percent for history and bloat = about 3.4 GB, rounded to 3.5 GB. Three feeds = 10.5 GB.
- Churn: 8,000 new listings per feed per month = 240,000 new photos per feed; 720,000 for three feeds.
- Variants: 2 pre-generated sizes per photo totaling 50 KB (25 percent of the original) = 450 GB for 3 feeds.
- Ingestion CPU: 2 s per run; runs every 15 minutes: 3 feeds x 4 per hour x 24 x 30 = 8,640 runs/month. Photo fetch 10 ms CPU each. Page rendering 5 ms CPU, 500,000 requests per client per month.
- Map loads per client per month: 30,000 (below Mapbox free 50,000).

Real active-listing counts per MLS were not found (see Could not confirm). 100,000 includes history and is an upper-bound planning figure.

### One client, 3 feeds (monthly)

Scenario B, full cache with pre-generated variants:

| Line | Arithmetic | $ |
|---|---|---|
| Supabase Pro + Small compute | 25 + 15 - 10 credit | 30.00 |
| Supabase disk overage | (10.5 - 8) GB x 0.125 | 0.31 |
| Workers Paid | CPU = 8,640 x 2,000 ms = 17.28M, + 720k x 10 ms = 7.2M, + 500k x 5 ms = 2.5M; total 26.98M ms, under the 30M included | 5.00 |
| R2 storage | (1,800 + 450 - 10 free) GB x 0.015 | 33.60 |
| R2 writes | originals 720k + variants 1.44M = 2.16M; (2.16 - 1) M x 4.50 | 5.22 |
| R2 reads | cached at the edge; assume within 10M free | 0.00 |
| Queues | 720k messages x 3 ops = 2.16M; (2.16 - 1) M x 0.40 | 0.46 |
| Maps | 30k loads, free tier | 0.00 |
| **Total** | | **about 74.59, call it $75** |

Scenario L, lean (cache photos only for active listings, assume 20,000 active per feed): 20,000 x 30 x 200 KB = 120 GB per feed, 360 GB; variants +25 percent = 90 GB; storage (450 - 10) x 0.015 = 6.60; writes (450k originals + 900k variants = 1.35M; 0.35M x 4.50) = 1.58; Queues 0.14; Supabase 30.31; Workers 5.00; total about **$44**. The 20,000 active figure is an assumption.

Scenario A, resize on demand with Cloudflare Images instead of variants: R2 storage (1,800 - 10) x 0.015 = 26.85; transformations: assume 200,000 unique photo-and-size combinations viewed per month, (200,000 - 5,000) / 1,000 x 0.50 = 97.50; Supabase 30.31; Workers 5.00; Queues 0.46; total about **$160**. The unique-transformation count is the swing factor and depends on traffic.

One-time backfill (ESTIMATE): 9,000,000 photos x $4.50/M Class A = $40.50 for originals, plus roughly the same again for variants.

Not in the totals: MLS data fees. For three feeds, range $11 (the low published or reported figures: about $6 + $5 + unknown) to $255 (3 x $85 Trestle-style), per client per month. Also not in totals: engineering time. Showcase's RESO case study records one developer taking about four days for a first Web API integration in 2019 (CONFIRMED); a vendor blog gives $15,000-$60,000 for a full custom IDX build (REPORTED, vendor-authored, projectcostestimator.com). UNPROVEN for this project.

### 20 clients

Case 1, shared per-MLS store: assume the 20 clients draw on 5 distinct feeds (assumption). Vendor-style multi-client licensing is required; see risks below.

| Line | Arithmetic | $ |
|---|---|---|
| Supabase Pro + Medium compute | 25 + 60 - 10 | 75.00 |
| Supabase disk | 5 x 3.5 = 17.5 GB; (17.5 - 8) x 0.125 | 1.19 |
| Supabase egress | 20 clients x 500k requests x 20 KB = 200 GB, under 250 GB included | 0.00 |
| R2 storage | originals 5 x 600 = 3,000 GB + variants 750 GB - 10 free = 3,740 GB x 0.015 | 56.10 |
| R2 writes | 5 x 240k = 1.2M originals + 2.4M variants = 3.6M; (3.6 - 1) M x 4.50 | 11.70 |
| Workers | $5 base; CPU = 5 x 2,880 x 2,000 ms = 28.8M + 1.2M x 10 ms = 12M + 20 x 500k x 5 ms = 50M; total 90.8M; (90.8 - 30) M x 0.02 = 1.22 | 6.22 |
| Queues | 1.2M x 3 = 3.6M; (3.6 - 1) M x 0.40 | 1.04 |
| **Total (excl. maps)** | | **about 151.25, about $7.56 per client** |

Maps for 20 clients at 30,000 loads each = 600,000 loads. If pooled on one Mapbox account: 50,000 x $5/1000 = 250, plus 100,000 x $4/1000 = 400, plus 400,000 x $3/1000 = 1,200 = **$1,850 per month**, which would dwarf everything else. Options: separate free-tier accounts per client (terms not checked), or self-hosted vector tiles on R2: assume 20 tile range reads per map load, 600,000 x 20 = 12M Class B, (12 - 10) M x 0.36 = about $0.72 (ESTIMATE; tile file size and library work not verified).

Case 2, isolated stack per client (20 copies of Scenario B): Supabase 25 + 20 x 15 - 10 = 315, plus disk 20 x 0.31 = 6.25; R2 20 x 38.82 = 776.40 plus about 2.85 lost free-tier credit; Workers 5 + 20 x 26.98M ms = 539.6M, (539.6 - 30) x 0.02 = 10.19; Queues 20 x 0.46 = 9.20. Total about **$1,125 per month, about $56 per client**.

Reading: shared stores make hosting nearly free per client, but only if the MLSs license a vendor-style multi-tenant feed and the product enforces each broker's permitted listings. Isolated stacks cost about 7x more and are the safer legal reading when each broker holds their own IDX agreement.

## Gotchas

1. **Photo URLs: MLS Grid.** MediaURL is for downloading a local copy only: "DO NOT use these URLs on your website or in your application". From 2026-09-08 URLs come from media.mlsgrid.com, are signed, single-use, expire one hour after generation; repeat download within the hour returns 429. Every download must send the User-Agent header set to your OAuth 2 access token. Media never updates in place; a change issues a new MediaURL and a new download. Do not store Media URLs. CONFIRMED. https://docs.mlsgrid.com/api-documentation/api-version-2.0 ; https://docs.mlsgrid.com/releases/upcoming-changes-to-media-delivery-migration-away-from-amazon-aws
2. **Photo URLs: Bridge, Trestle, Paragon.** Hotlinking and expiry rules: UNCONFIRMED. I could not read their docs (the Bridge and Trestle documentation pages returned only a title or a 403). Read the MLS data license and Bridge Data Output Terms before deciding whether to hotlink anywhere. Caching in R2 is the safe default.
3. **Deleted listings.** MLS Grid: when MlgCanView is false, remove the record; false records leave the feed after 7 days; Media, Rooms and UnitTypes have no delete flag, replace them from the parent record. CONFIRMED. Repliers separates deleted (remove everywhere, including caches and search indexes) from terminated/cancelled (keep, mark inactive), says webhooks fail and a daily poll of GET /listings/deleted is the safety net, and notes some MLS systems delete listings older than two years. CONFIRMED (Repliers help). https://help.repliers.com/en/article/managing-deleted-listings-19q712v/
4. **Timestamps and timezones.** MLS Grid uses ISO 8601 with Z (UTC), but some fields such as ACT_LastChangeTimestamp have no offset and the docs do not say how to read them. Showcase IDX's RESO case study: listing-created dates arrived as date-only values, timestamps without times, GMT, UTC, local server time, or not at all. CONFIRMED. https://www.reso.org/moving-replication-reso-web-api/ . Spark guidance (search-result excerpt): when replicating, back up the last successful sync by 20 minutes because of server-side caching, and poll no more often than every 10 minutes. REPORTED.
5. **Counts do not match the MLS.** A RESO Homes.com case study lists "variances in listing count due to opt-in discrepancies" (REPORTED; I could only read it as a search snippet, the PDF text was unreadable). Other documented causes: IDX-only feeds omit fields and statuses; replication may need separate approval; listings can be excluded by objective criteria or seller opt-out (bridgeMLS IDX page, CONFIRMED). Spark docs suggest `$count=true` to compare totals (search excerpt). I found no developer post that explains count mismatches end to end.
6. **Rate limits and errors.** MLS Grid: no numeric limit, but "excessive inefficient usage may cause service interruption"; max 5,000 records per request (500 default; 1,000 with `$expand`); at most 5 `or` operators per filter; lookups at most once a day. CONFIRMED. A vendor blog reports some feeds return 403 when rate-limited, tokens that expire during paging, naive offset paging causing duplicates or gaps (MEV, 2025-10-06, REPORTED). Showcase: concurrent connection and query limits "differ by MLS ... even on the same software platform". CONFIRMED. Trestle numeric limits: UNCONFIRMED.
7. **Replication needs its own approval.** WAV Group (2020-02-26): an MLS can require special approval and a written use case for the replication endpoint ("Invalid permissions" otherwise); an IDX-only data agreement lacked fields (OccupantType/Name) and needed a second use case; replication endpoints may block `$expand`; agent data needs a separate Member query. REPORTED. https://www.wavgroup.com/?p=38640
8. **Field inconsistency.** Same status as "Active", "A" or "ACT" (MEV, REPORTED); Showcase counted more than 20 variants of one subdivision name and mixed text/integer/string types. CONFIRMED. Miami REALTORS routes some users to Bridge and some to Trestle; a third-party guide says only the Bridge feed includes latitude/longitude, which affects map search (REPORTED, https://mlsimport.com/bridge-interactive-getting-credentials/). Plan per-MLS adapters and a field-coverage test.
9. **Platform identity of bridgeMLS.** See Summary; get the vendor data-access request path from bridgeMLS (support 925.363.2333 per its site) before designing the adapter. bridgeMLS publishes two agreement types: an IDX data access agreement for participants/subscribers and a vendor/consultant agreement (REPORTED via mlsimport; bridgeMLS's own IDX page confirms "separate data access agreements exist" and an Approved IDX Vendors list).
10. **Cloudflare Workers shape the ingestion design.** Cron CPU limit of 30 s for intervals under one hour, 128 MB memory, 10,000 subrequests per invocation: a 15-minute poller must be incremental, and backfills (millions of photos) must be fanned out through a queue. CONFIRMED (Cloudflare docs).
11. **Compliance rules to implement (bridgeMLS, from C.A.R. model rules).** Refresh at least every 12 hours; cite the MLS as source with last-update date; prominent listing broker/agent attribution; "personal, non-commercial use" statement; disclaimer no smaller than 7 pt; no data modification; max results per query no fewer than 100 or 5 percent of listings, C.A.R. model cap 500; seller opt-outs; listings limited to active, pending, or sold in the past three years. CONFIRMED. https://www.bridgemls.com/idx-info
12. **Audits and fines.** What I found: bridgeMLS's pages list no penalties or audit procedure. An East Bay "EBRD" rules appendix (copyright 2016, organization not named on the page) lists IDX-rule violations as warning, then $250, then loss of IDX, with loss of MLS on the fourth, and "MLS in website address" at $300/$500 (REPORTED, https://ebrdrules.readthedocs.io/en/latest/APPENDIX_A.html). A search snippet says CRMLS set a $2,500 fine for displaying offer of compensation in IDX (REPORTED, not opened). Other MLSs: courtesy notice then grace period then fine (BeachesMLS), 1-3 day grace periods (OneKey), $250/$500/$750 tiers (SWMLS) (REPORTED, search excerpts). Cotality's Trestle Defender lets MLSs "assess license requests, identify unauthorized connections, and detect misuse" with vendor scoring and digital fingerprinting (CONFIRMED, https://www.cotality.com/real-estate/multiple-listing-enterprise-solutions/trestle). How CA MLSs audit IDX websites, whether staff use screenshots as evidence, and CA fine amounts: UNCONFIRMED.

## SEO evidence

What Google says (CONFIRMED, official pages):
- Duplicates: Google "will decide which pages (if any) are duplicates"; if you do not set a canonical it picks one; canonicals are optional and "most sites will likely do fine without one". The page does not mention penalties. It does not recommend noindex for choosing a canonical within one site. https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Filtered search URLs: faceted URL space causes overcrawling. To keep filters out of Search: disallow filter parameters in robots.txt while allowing item pages and one unfiltered listing page; canonical to the unfiltered page is "less effective long-term"; return 404 for empty or nonsensical filter combinations. The page does not mention noindex. https://developers.google.com/search/docs/crawling-indexing/crawling-managing-faceted-navigation
- Spam policy: scaled content abuse includes "harvesting feeds, search results, or other sites' content to build pages ... with little benefit to users". Scraping covers reproducing feeds without a unique benefit. https://developers.google.com/search/docs/essentials/spam-policies . This is the policy risk for publishing 100,000 template listing pages with no added value; Google's guidance there is to exclude such content from Search.

What vendors claim (REPORTED or vendor statement, none backed by data on the pages):
- Showcase: "100% indexable pages", never subdomains or iframes, which Google "often ignores or devalues"; Premium adds indexable XML sitemaps. https://showcaseidx.com/pricing/
- iHomefinder, Real Geeks, IDX Broker, Brivity: "built to rank", "SEO-friendly", AI-generated local area pages, AI meta titles, sitemaps. Ranking data: none on the pages.
- AgentFire support article (undated, vendor-published): IDX pages are thin, syndicated across many sites, so Google may index one version; cites no statistics. https://support.agentfire.com/en/idx-limitations-with-seo-indexing

Third-party measurement:
- A 2020 Made in America Movement report (covered by Houston Agent Magazine, 2020-06-22) says iframe and subdomain IDX makes ranking "nearly impossible" and rated Showcase IDX highest, with kVcore and Real Geeks next. Sample is stated as about 25,000 agent sites and 125,000 consumers; methodology is barely described. REPORTED, weak. https://houstonagentmagazine.com/2020/06/22/idx-measure-find-tools-rank-highest/
- I found no controlled test of indexed listing pages versus noindexed ones, no Google statement about IDX specifically, and nothing on how Zillow handles indexing.

What this implies for a page worth indexing (my judgement, not sourced as fact):
- Index: a city/neighborhood hub with original content (market stats, schools, commute, local expertise) and listings as supporting content; listing detail pages that carry added value (area context, agent commentary, nearby sold comps) with a self-referencing canonical, accurate sitemap lastmod, and a defined end-of-life for sold or expired listings (return 404 or 410, or redirect to the area page, as a deliberate rule).
- Keep out of the index: filtered and sorted search URLs, map-state URLs, pagination beyond what you want crawled (robots.txt disallow per Google's faceted guidance), and listing pages that are only the raw MLS fields.
- Avoid doorway-style pages (many city pages differing only by a name, per Google's doorway abuse definition).
- Because MLS IDX rules bar modifying listing data, the added value must sit next to the data, clearly separated and sourced (bridgeMLS page allows other-source data if clearly separated).

## Facts

| Fact | Source URL | Date read | Status |
|---|---|---|---|
| SimplyRETS: Basic $49, Premium $99, Enterprise $199 per month; one-time $99 connection fee per RETS/RESO feed; multi-MLS add-on $25/$50/$100 per feed; 30-minute refresh | https://simplyrets.com/ | 2026-10-27 | CONFIRMED |
| SimplyRETS: works with any standard RETS or RESO Web API feed; you get credentials from the MLS; SimplyRETS signs vendor agreements if required | https://simplyrets.com/faq | 2026-10-27 | CONFIRMED |
| Repliers: Standard plan 199 USD for a US MLS; vendors billed by number of MLS systems | https://help.repliers.com/en/article/qa-related-to-pricing-1hbxiq3/ | 2026-10-27 | CONFIRMED |
| Repliers: "does not bypass MLS licensing"; approval needed | https://help.repliers.com/en/article/understanding-the-value-of-repliers-apis-compared-to-mls-apis-169xuap/ | 2026-10-27 | CONFIRMED |
| Repliers lists 42 CA MLSs including bridgeMLS, BAREIS, MetroList, Bay East, Contra Costa | https://repliers.com/mls-directory/california/ | 2026-10-27 | CONFIRMED |
| Repliers uses usage-based billing (conflicts with per-MLS subscription wording) | https://repliers.com/for-brokers-agents/ | 2026-10-27 | CONFIRMED (conflict unresolved) |
| Spark API: sign-up free; $50/month per MLS; multiple keys one charge; permission needed from each MLS | https://www.sparkplatform.com/docs/overview/faq ; https://sparkapi.io/pricing | 2026-10-27 | CONFIRMED |
| Spark RETS $75/month per MLS from 2026-03-01, rising every six months | https://sparkapi.io/pricing | 2026-10-27 | CONFIRMED |
| Cotality says Trestle is at no cost to MLSs; no vendor prices on page; 1,250+ technology providers; refresh under two minutes | https://www.cotality.com/real-estate/multiple-listing-enterprise-solutions/trestle | 2026-10-27 | CONFIRMED |
| Miami REALTORS: Trestle vendors $85/month per feed; Bridge no additional cost for vendors | https://www.miamirealtors.com/mls/webapi/pricing/ | 2026-10-27 | CONFIRMED |
| CRMLS via Trestle: $85/month IDX feed after two free broker feeds; developers $7 per URL (first 2 free) plus $85 | https://go.crmls.org/idx-resources/ | 2026-10-27 | CONFIRMED |
| MLS Grid collects whatever license fee each MLS requires; no separate fee of its own | https://www.mlsgrid.com/faq | 2026-10-27 | CONFIRMED |
| Bridge Interactive charges vendors no additional fee; access initiated by the MLS and approved per dataset | https://apis.io/plans/bridge-interactive/bridge-interactive-plans-pricing/ (search summary) | 2026-10-27 | REPORTED |
| MLS staff manually review each Bridge data-access request; fees are set by the MLS | https://mlsimport.com/bridge-interactive-getting-credentials/ | 2026-10-27 | REPORTED |
| bridgeMLS runs on Paragon; vendor feeds via paragonapi.com Property Information Central; Bridge Interactive "unrelated" | https://mlsimport.com/bridgemls/ | 2026-10-27 | REPORTED (conflicts with IDX Broker page showing WEBAPI via Bridge API) |
| bridgeMLS: IDX data access agreement vs vendor/consultant agreement; membership approval 1-3 business days; 60 days for mandatory training | https://mlsimport.com/bridgemls/ | 2026-10-27 | REPORTED |
| bridgeMLS: separate data access agreements for participants/subscribers and for vendors/consultants; Approved IDX Vendors list exists | https://www.bridgemls.com/idx-info | 2026-10-27 | CONFIRMED |
| bridgeMLS IDX rules: refresh at least every 12 hours; 7 pt disclaimer; query cap; sold within 3 years optional | https://www.bridgemls.com/idx-info | 2026-10-27 | CONFIRMED |
| IDX Broker (bridgeMLS page): WEBAPI feed, $145 setup, $6/month data management, East Bay Reg Data members $100 setup; page age unclear | https://www.idxbroker.com/mls/bridge-mls-bridgemls | 2026-10-27 | REPORTED |
| MetroList via Showcase: fee exists, client share $5/month | https://showcaseidx.com/mls-coverage/metrolist-ca-metrolist-sacramento/ | 2026-10-27 | CONFIRMED |
| MLSListings IDX+: may include Metrolist, CRMLS, Bay East, SFAR, BAREIS, Contra Costa, bridgeMLS, TheMLS after vetting | https://support.mlslistings.com/s/article/IDX-Data-Feeds | 2026-10-27 | CONFIRMED |
| Showcase IDX: Essentials $94.95, Premium $124.95, $0 setup, pass-through $0-$33, approval 1-5 business days, on-domain, no subdomain/iframe | https://showcaseidx.com/pricing/ | 2026-10-27 | CONFIRMED |
| Showcase pass-through fee $5-$30 per month, labelled "Data Management Fee" | https://support.showcaseidx.com/hc/en-us/articles/360003529171-What-is-an-MLS-Pass-Thru-Fee- | 2026-10-27 | CONFIRMED |
| Constellation1 page: IDX websites and Showcase IDX brand; "300+" MLS partners | https://www.constellation1.com/ | 2026-10-27 | CONFIRMED |
| IDX Broker: Core $60, Engage $99, Elite $149; new MLS typically live 2-3 weeks after credentials | https://www.idxbroker.com/ | 2026-10-27 | CONFIRMED |
| IDX Broker coverage page lists Bridge MLS, BECCAR, BAREIS, MetroList, MLSListings, CRMLS, SF MLS | https://www.idxbroker.com/idx_mls_coverage | 2026-10-27 | CONFIRMED |
| IDX Broker: $100 setup, $30/month per additional MLS | https://developers.idxbroker.com/?p=860 (page text not readable; figure from search summaries) | 2026-10-27 | REPORTED |
| iHomefinder coverage lists bridgeMLS, Contra Costa, BAREIS, MetroList, MLSListings, CRMLS | https://www.ihomefinder.com/mls-coverage/ | 2026-10-27 | CONFIRMED |
| iHomefinder pricing page: no base prices; Essentials website setup $500; extra MLS $25/$50 per month | https://www.ihomefinder.com/pricing/ | 2026-10-27 | CONFIRMED |
| Optima Express: on-domain pages, no frames or subdomains; data updates every two hours (some 15 min); MLS approval under one day to about a week | https://wordpress.org/plugins/optima-express/ | 2026-10-27 | CONFIRMED (vendor statement) |
| Real Geeks: $399/month, $500 setup, $10 per MLS board per month | https://www.realgeeks.com/pricing | 2026-10-27 | CONFIRMED |
| Brivity: starts at $299/month for solo agents; CRM, IDX website included; sitemap, agent subdomains | https://www.brivity.com/faq/ | 2026-10-27 | CONFIRMED |
| Brivity agent subdomains need wildcard DNS; sites created after domain published | https://info.brivity.com/knowledge/publish-godaddy-url-for-a-brivity-website (search summary) | 2026-10-27 | REPORTED |
| MLS Grid: MediaURL download-only, single-use, one-hour expiry, 429 on repeat, User-Agent = access token; 5,000 records per request; MlgCanView false removed after 7 days | https://docs.mlsgrid.com/api-documentation/api-version-2.0 ; https://docs.mlsgrid.com/releases/upcoming-changes-to-media-delivery-migration-away-from-amazon-aws | 2026-10-27 | CONFIRMED |
| Repliers: deleted vs terminated listings; some MLSs delete listings older than two years | https://help.repliers.com/en/article/managing-deleted-listings-19q712v/ | 2026-10-27 | CONFIRMED |
| Showcase RESO case study: date formats vary (UTC, GMT, local, date-only); 20+ variants of a subdivision; per-MLS rate limits; about four days for first integration | https://www.reso.org/moving-replication-reso-web-api/ | 2026-10-27 | CONFIRMED (case released 2019, reviewed 2024) |
| WAV Group: MLS may require approval and use case for replication endpoint; IDX-only feed lacked fields | https://www.wavgroup.com/?p=38640 | 2026-10-27 | REPORTED (2020-02-26) |
| MEV: status code variants; 403 on rate limit; pagination tokens; published 2025-10-06 | https://mev.com/blog/issues-with-reso-apis-provider-and-consumer-perspectives | 2026-10-27 | REPORTED |
| Supabase Pro from $25; 8 GB disk; extra disk $0.125/GB; 250 GB egress, $0.09/GB over; Micro $10, Small $15, Medium $60; $10 compute credit | https://supabase.com/pricing | 2026-10-27 | CONFIRMED |
| Supabase Cron: every second to once a year; 8 concurrent jobs and 10 minutes per job recommended | https://supabase.com/docs/guides/cron | 2026-10-27 | CONFIRMED |
| Cloudflare Workers Paid $5; 10M requests, 30M CPU-ms; overage $0.30/M and $0.02/M CPU-ms; cron billed as invocations | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-10-27 | CONFIRMED |
| Workers limits: cron CPU 30 s (under 1 h) or 15 min (1 h or more); 10,000 subrequests; 128 MB; 250 cron triggers | https://developers.cloudflare.com/workers/platform/limits/ | 2026-10-27 | CONFIRMED |
| R2: $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, egress free, 10 GB / 1M / 10M free | https://developers.cloudflare.com/r2/pricing/ | 2026-10-27 | CONFIRMED |
| Cloudflare Images: 5,000 free unique transformations; $0.50 per 1,000; R2-stored images transformable; storage $5 per 100k, delivery $1 per 100k | https://developers.cloudflare.com/images/pricing/ | 2026-10-27 | CONFIRMED |
| Cloudflare Queues: 1M ops included, $0.40/M; about 3 ops per message | https://developers.cloudflare.com/queues/platform/pricing/ | 2026-10-27 | CONFIRMED |
| Mapbox GL JS: 50,000 free loads; $5/$4/$3 per 1,000 in tiers | https://www.mapbox.com/pricing | 2026-10-27 | CONFIRMED |
| Google: duplicates are consolidation and crawl efficiency; no penalty mentioned; canonical optional | https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls | 2026-10-27 | CONFIRMED |
| Google: faceted navigation guidance (robots.txt disallow, canonical, 404 for empty filters) | https://developers.google.com/search/docs/crawling-indexing/crawling-managing-faceted-navigation | 2026-10-27 | CONFIRMED |
| Google spam policy: scaled content abuse includes harvesting feeds; doorway abuse | https://developers.google.com/search/docs/essentials/spam-policies | 2026-10-27 | CONFIRMED |
| 2020 report: iframe/subdomain IDX nearly impossible to rank; Showcase rated highest | https://houstonagentmagazine.com/2020/06/22/idx-measure-find-tools-rank-highest/ | 2026-10-27 | REPORTED |
| EBRD rules appendix: IDX violation warning then $250 then loss of IDX; copyright 2016 | https://ebrdrules.readthedocs.io/en/latest/APPENDIX_A.html | 2026-10-27 | REPORTED |
| Custom IDX build cost $15,000-$60,000 | https://projectcostestimator.com/idx-website-cost (search summary) | 2026-10-27 | REPORTED (vendor-authored) |
| Self-build monthly totals ($75, $44, $160; $151, $1,125) | Arithmetic in this file | 2026-10-27 | ESTIMATE |

## Could not confirm

- Current official price list and coverage for Brivity beyond "$299 per month"; setup fee amount; whether its listing pages are indexable and whether they sit on the client's domain or a subdomain. The Luxury Presence Brivity pages and the Brivity knowledge base content were not readable (403, redirect).
- bridgeMLS, BAREIS and MetroList: current vendor or data-access fee schedules, lead times for vendor approval, and the platform (Bridge vs Paragon PIC vs other) each uses for RESO Web API. Nothing at all was found for BAREIS (see sibling files 01-bridgemls.md, 02-bareis.md, 03-metrolist.md for their own research).
- Real Geeks, Brivity, Constellation1 and Realtyna California MLS lists.
- Showcase IDX coverage of bridgeMLS and BAREIS (coverage search is dynamic) and Showcase's price for a second or third MLS.
- Repliers: whether $199 is per MLS or per account, and its overage terms.
- Trestle: Cotality-published vendor tiers, rate-limit numbers, media URL rules. Bridge: numeric rate limits, media URL rules, timestamp timezone (the Bridge docs pages returned only a title).
- Photo hotlinking and expiry rules for Bridge, Trestle, Paragon PIC and Spark.
- MLS audit mechanics (random sample, crawler, complaint-driven), whether screenshots are collected, and California IDX fine schedules for bridgeMLS, BAREIS, MetroList.
- Active listing counts per MLS (the 50-100k per MLS in the brief was used as an upper bound).
- Real developer reports from GitHub issues or Reddit (r/realtors, r/webdev): none surfaced in search; the gotchas above come from vendor docs, WAV Group, MEV, and RESO case studies, not forums.
- Whether a shared multi-tenant store across clients is allowed under each MLS's vendor license, and the per-client-count fee tiers outside Miami.
- Any controlled evidence that on-domain IDX listing pages rank, or Google's position on IDX specifically.
- Supabase Edge Function runtime limits, Cloudflare Hyperdrive pricing for Workers to Postgres, PMTiles file sizes, and a pricing check on search engines other than Postgres: not researched.

## Sources

Vendors and APIs
- https://simplyrets.com/ and https://simplyrets.com/faq
- https://help.repliers.com/en/article/qa-related-to-pricing-1hbxiq3/
- https://repliers.com/mls-directory/california/ and https://repliers.com/mls-directory/california/california-regional-multiple-listing-service/
- https://repliers.com/for-brokers-agents/
- https://help.repliers.com/en/article/understanding-the-value-of-repliers-apis-compared-to-mls-apis-169xuap/
- https://help.repliers.com/en/article/managing-deleted-listings-19q712v/
- https://www.sparkplatform.com/docs/overview/faq , https://sparkapi.io/pricing , https://sparkplatform.com/docs/overview/api
- https://www.cotality.com/real-estate/multiple-listing-enterprise-solutions/trestle
- https://www.mlsgrid.com/faq , https://docs.mlsgrid.com/api-documentation/api-version-2.0 , https://docs.mlsgrid.com/releases/upcoming-changes-to-media-delivery-migration-away-from-amazon-aws
- https://showcaseidx.com/pricing/ , https://support.showcaseidx.com/hc/en-us/articles/360003529171-What-is-an-MLS-Pass-Thru-Fee- , https://showcaseidx.com/mls-coverage/metrolist-ca-metrolist-sacramento/
- https://www.constellation1.com/
- https://www.idxbroker.com/ , https://www.idxbroker.com/idx_mls_coverage , https://www.idxbroker.com/mls/bridge-mls-bridgemls , https://developers.idxbroker.com/?p=860
- https://www.ihomefinder.com/pricing/ , https://www.ihomefinder.com/mls-coverage/ , https://www.ihomefinder.com/blog/agent-and-broker-resources/build-an-idx-website/ , https://wordpress.org/plugins/optima-express/
- https://www.realgeeks.com/pricing
- https://www.brivity.com/faq/ , https://www.brivity.com/website/ , https://www.luxurypresence.com/blogs/brivity-pricing/ (search summary only)
- https://realtyfeed.com
- https://apis.io/plans/bridge-interactive/bridge-interactive-plans-pricing/ (third-party aggregator, search summary)

MLS pages and guides
- https://www.bridgemls.com/idx-info and https://www.bridgemls.com/compliance-documents
- https://mlsimport.com/bridgemls/ and https://mlsimport.com/bridge-interactive-getting-credentials/
- https://www.miamirealtors.com/mls/webapi/pricing/
- https://go.crmls.org/idx-resources/
- https://support.mlslistings.com/s/article/IDX-Data-Feeds
- https://web4realty.com/?p=12056
- https://ebrdrules.readthedocs.io/en/latest/APPENDIX_A.html
- https://kcrar.com/kcrar-members/membership/benefits-and-resources/idx-websites/ , https://go.canopymls.com/data , https://northstarmls.com/?p=661 (search summaries only; fetch returned 503)

Developer and industry reports
- https://www.reso.org/moving-replication-reso-web-api/
- https://www.wavgroup.com/?p=38640
- https://mev.com/blog/issues-with-reso-apis-provider-and-consumer-perspectives
- https://projectcostestimator.com/idx-website-cost (search summary)

Infrastructure pricing
- https://supabase.com/pricing , https://supabase.com/docs/guides/cron
- https://developers.cloudflare.com/workers/platform/pricing/ , https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/r2/pricing/ , https://developers.cloudflare.com/images/pricing/ , https://developers.cloudflare.com/queues/platform/pricing/
- https://www.mapbox.com/pricing , https://docs.protomaps.com/

SEO
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- https://developers.google.com/search/docs/crawling-indexing/crawling-managing-faceted-navigation
- https://developers.google.com/search/docs/essentials/spam-policies
- https://support.agentfire.com/en/idx-limitations-with-seo-indexing
- https://houstonagentmagazine.com/2020/06/22/idx-measure-find-tools-rank-highest/
