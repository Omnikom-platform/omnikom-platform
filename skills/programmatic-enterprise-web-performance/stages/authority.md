# Stage: authority (off-site: earning links, mentions and citations, for any line of business)

Load this file when the question is "who vouches for this business, and how do we get more of the right people to?" It is
the off-site half of the work (shipgate 06 TR-218 authority and TR-233 off-site plan). It works for any business: a realtor, a
cash buyer, a plumber, a lawyer, a dentist, a restaurant, a software company, an online shop. What changes between them is the
**industry pack** (`rules/link-sources/`), not the method.

Free sources only. We build the tools. A part whose source is missing says BLOCKED with the step that unblocks it.

## 1. What authority is, in plain words
Three different things get called "links". Keep them apart in every conversation with a client.

1. **A link**: a page on another site that points to ours. Search engines read it as one site vouching for another. A link from a
   page that is independent, about the same subject or place, and read by real people is worth far more than ten from pages
   that exist to hold links.
2. **A mention or citation**: another site names the business (name, address, phone, website) with or without a link. It is how
   map results, and AI answers, learn that the business is real and where it is. A nofollow link is still a citation.
3. **An entity**: the picture search and AI engines build of "this one real organisation" from sources that agree. The business
   is one entity when its name, address, phone, description and profile links match everywhere (sameAs, section 8).

Each helps a different result:
| Result | What moves it | What we do |
|---|---|---|
| Ordinary rankings | followed links from independent, relevant sites | earn them (sections 3 and 4) |
| Map pack (local) | relevance, distance and prominence; prominence comes from reviews and what the web says about the business (Google's own wording) | NAP and citations (5), reviews (6) |
| AI answers | being on the lists and profiles the engines quote; one consistent entity | section 8 |

Honest limits, said to every client: **no guarantee** of a rank, a citation or a lead; Google's systems ignore most spammy links
on their own, so a bad link usually wastes money rather than helps; the free link data (Common Crawl) is one quarter old and
counts distinct linking **domains**, so use it to compare us with competitors and with last quarter, never as an absolute.

## 2. The run
| Step | Command | Reads | Writes | Notes |
|---|---|---|---|---|
| 1 Who links to us and to competitors | `node scripts/authority.mjs <pewp>/authority.json --target <domain> --competitor <d>... --top 500` | Common Crawl cache | `authority.json` (+ `.md`), including the link gap | 15 to 30 minutes the first time, then cached per release (`<release>-asked.json`, `--rescan`): UNPROVEN at real scale. `--top` = linking domains kept per site (default 30); use 500 |
| 1b How they link (anchors, follow or nofollow) | `node scripts/authority-anchors.mjs <pewp> [--keyword "<money term>"]...` | `authority.json`, Common Crawl data host (at most 600 requests, 3 s apart) | `authority/anchors.json` + `anchors.md` | optional, after step 1; see 2b. Exit 4 = Common Crawl stopped us (24 h stop file) |
| 2 Classify and rank | `node scripts/authority-classify.mjs <target> [--industry slug] [--fetch]` | `authority.json`, `research/citations.json`, `research/ai-citations.json`, `business.json`, the pack | `authority/opportunities.json` + `.md` | no network unless `--fetch`; exit 3 = no `authority.json` yet |
| 3 Vet before spending | `node scripts/authority-vet.mjs <target> [--domain d]... [--limit 25] [--exclude "<regex>"]` | `opportunities.json` | `authority/vetting.json` + `howto.md` | polite read-only visits, about 12 s a site; exit 4 = a time or request cap stopped it |
| 4 Hand the client the how-to | `authority/howto.md` | `vetting.json` | the plain-words list | the client never sees internal notes |
| 5 Track the work | `node scripts/authority-outreach.mjs <target> add\|set\|seed\|list\|report\|explain` | `vetting.json` | `authority/outreach.json` + `outreach.md` | one row per site: planned, asked, listed, refused |
| 6 Measure | `measure.mjs` (stages/measure.md) | `authority.json`, `outreach.json` | referring-domain diff, MSR-007 | the tracker explains which gains were ours |

Who does what: the Lead runs 1 to 5. The client (or the owner on the client's behalf) does what only the business can do: pay a
membership, approve any spending in writing, supply facts and photos, answer a reporter, ask real customers for reviews.
**Nobody buys a link, a "listing package" or an award without the client's written OK**, and a paid placement is always labelled
(`rel="sponsored"`, section 7).

The ordered list in `opportunities.md` is: (1) the **link gap**, sites that link to two or more competitors and not to us;
(2) sites the AI engines **cited instead of us** in the answers we captured *to questions that belong to this business* (below); (3) sites that link to one competitor; (4)
directories that fill the captured search results; (5) the pack's usual places that no data pointed at. Inside a group the
order is the source type's value times how easy it is (`value * (6 - effort)`), then the number of competitors, then the
strength of the domain in the link graph. A domain no rule recognises is **unclassified**; the tools never guess. An unclassified site counts as an opportunity only when a competitor links from it (that proves it links out); one found only through AI answers or searches waits in the `unclassified` list until `--fetch` or a person classifies it. Run
with `--fetch` to read an unclassified site's home page once (title and description go through the text rules); if those do
not decide either, it stays unclassified and a person looks.

Three filters keep the list about places that can link to the client (added after a real run listed cash-buyer companies on a realtor's list):
1. **Scope of the AI answers.** `research/ai-citations.json` can hold answers to questions of a second business. Only rows whose question matches a cluster of `targets.json` (record-only clusters excluded; word overlap 0.6 or more) or shares a word with the business's offer, industry or pack aliases are counted. With neither targets nor offer nothing can be judged: all rows are kept and `aiFilter.mode` says `unfiltered`. If `targets.json` itself holds a second business's clusters, this filter keeps them; filter 2 is what removes the companies.
2. **Provider businesses are not opportunities.** A domain whose name (pack `providerPatterns`, tested on the main label) or home page (pack `providerText`: first-person wording such as "we buy houses", "get a cash offer") shows it sells the same or a neighbouring service is `provider-business`. Names the pack knows (a Zillow, an escrow company named as a partner) win over this rule. Directory wording ("find the best agents") never counts. `authority-vet.mjs` applies the wording test to unclassified sites and returns `NOT AN OPPORTUNITY`.
3. **Only kinds that link out are ranked**, and a partner type the pack names (lender, escrow, stager, inspector) found only through AI answers or searches ranks below the directories (tier `partner`).

### 2b. Anchors and link types (`authority-anchors.mjs`)
Step 1 says who links, not the anchor text or follow/nofollow. This step reads both from Common Crawl's copies of the referring pages,
for each graph competitor, over the domains `authority.json` lists. **No referring site is ever requested**; every request goes to
`data.commoncrawl.org`.
- **Fact, 2026-11-11 (UTC+2): `index.commoncrawl.org` dropped every request 03:59 to 04:12 and all 3 probes at 05:00** (cause unknown, maybe
  our 1 s pace; the data host answered). Slow down; do not route around.
- Limits: hard cap **600** requests a run (cache hits are free), gap **3 s or more**, 3 index blocks and 20
  pages per referring domain. **One 403, 429 or 503, or one dropped connection, stops the run** and writes a 24 h stop file
  (`omnikom-stops/commoncrawl.json`, `lib-stops.mjs`): no run starts while it is in force (exit 3). Five index-block reads failing in a
  row stop it too: an unreachable index is never "no pages". Free disk under 15 GB is BLOCKED before the cluster.idx download. The owner's
  do-not-request hosts are never read.
- Each link: anchor text (alt text for an image), type (follow, nofollow, ugc, sponsored; a page-level `meta robots nofollow` counts), place
  (nav, header, aside, footer, body), page URL. Anchor classes: brand, exact (a `--keyword` you gave), partial, url, generic, image, empty,
  other.
- Coverage line per target: "found links on N of M referring domains read; the rest: not found in the pages sampled (sampled N of M index
  blocks)". **Never** write that a site has no link or does not link: an unsampled page proves nothing; every count is a lower bound.
- Live run 2026-11-11 (Paragon, 7 competitors): 28 domains read, 4 links (all brand, follow): **too thin to describe anchors**. 3 of about
  7,000 index blocks per domain is a random sample; more runs only add domains. To be useful it must find the linking page itself: e.g. read the
  WAT of only the blocks whose URLs mention the competitor's brand, or use a host-level graph (a future order).
  A target outside the graph has no referring domains: its row says so, no anchors.
- Test: `node scripts/test-authority-anchors.mjs` and `--mutants`.

## 3. The source types
The ids are the `type` values in the files. The numbers are the skill's judgement (value 1 to 5, effort 1 = an hour to 5 =
weeks), not measurements. "Link" says how often the link on that kind of page is a normal, followed one.

| Type | Gives | Effort | Cost | Risk |
|---|---|---|---|---|
| `directory` | citation, entity; link sometimes; some referral | 1 | free, paid upgrades | medium |
| `editorial-list` | link sometimes, citation, entity, referral; quoted by AI | 4 | earned; some lists sell places | medium |
| `professional-association` | link likely, citation, entity | 2 | membership | low |
| `parent-roster` | link likely, citation, entity | 1 | free | low |
| `platform-profile` | citation, entity, reviews, referral; link rare | 1 | free (ads separate) | low |
| `chamber-local` | link likely, citation, entity | 2 | membership | low |
| `local-news` | link likely, citation, entity, referral | 4 | earned | low |
| `press-release` | mention; link rare | 2 | free to paid | medium |
| `sponsorship-charity` | link likely, citation | 2 | the sponsorship | low |
| `partner-supplier` | link likely, referral | 2 | free | low |
| `podcast-guest` | link sometimes, citation, entity, referral | 3 | your time | low |
| `own-property` | link, entity (not independent proof) | 1 | free | low |
| `social-link-hub` | entity (sameAs); link rare | 1 | free | low |
| `edu-gov` | link likely when earned | 4 | earned | medium |

Not opportunities, shown separately: `provider-business` (another agent, a cash buyer, a brokerage that is not the client's own, a contractor: a business that sells what the client sells or something next to it never links to a competitor), `competitor-own-property` (a competitor's other domain, which links to them because they
own it), `spam-suspect` (domain names with casino, pharma, essay-mill or link-selling words), `not-a-source` (search-engine, map, login and CDN hosts that show up in link or AI-citation data) and `unclassified`.

**`directory`: listing and review sites** (Yelp, BBB, Yellow Pages, MapQuest, Foursquare, Nextdoor, industry finders). What it is:
a site that lists businesses with a profile you claim or create. Why: citations and entity agreement, a few followed links,
some visitors. How: search the site first; claim the profile if there is one; copy name, address and phone exactly from the
Business Profile; fill every field in your own words; skip the paid upgrade unless the client chose it. Watch: Google names
"low-quality directory or bookmark site links" as link spam. Join a directory only if real customers use it or competitors are on
it (the link gap and the captured searches tell you which).

**`editorial-list`: "best of" and "top" lists** (expertise.com and similar city lists, "Top 100 agents", local "best of"). An
editor or a ranking decides who is on it. AI engines quote these lists constantly, so they matter more than their link
alone suggests. How: find who writes the list and the stated method; send the editor a short note with the one proof that fits
their criteria; record the answer. Watch: many "Top N" sites sell the places. If there is an application fee or a "featured"
fee it is advertising: say so, ask for `rel="sponsored"`, and do not count it as earned. `authority-vet.mjs` reads the site for
exactly this ("pricing", "featured listing", "apply") before anyone pays.

**`professional-association`: industry and professional networks** (a Realtors association, a bar association, a medical or
dental society, a trade association, an agent network). Often the owner already pays for the membership and never filled in the
profile. How: log in, add the website link, matching contact details and a short bio; send the association one news item a
quarter (an award, a talk, a new office). Claim only memberships and credentials the business actually holds.

**`parent-roster`: the parent brokerage, franchise, hospital or employer** page that lists agents, locations, doctors or
members. The easiest followed link there is. How: ask the parent for the page or use its portal; fill the website field; link
back from the business's own site. The pack lists other brokerages' rosters only as "another brokerage's roster": they matter
only if that brokerage is the client's own (`business.json` `credentials.brokerage`). Watch: the page belongs to the parent and
can vanish; keep the address in the tracker.

**`platform-profile`: profiles with a website field** (Zillow and Realtor.com for agents, Avvo and Justia for lawyers,
Healthgrades and Vitals for doctors, G2 and Capterra for software, Houzz for remodelers, Trustpilot, Tripadvisor). The link is
usually nofollow; the value is the citation, the reviews, the visitors and the fact that engines quote these pages. How: claim
with the business email, fill every field, add the website, ask real customers for reviews (section 6). Watch: paid
advertising on the same platform is a separate decision; a nofollow link is normal here and `authority-vet.mjs` says so
instead of rejecting it.

**`chamber-local`: chambers of commerce, downtown and local business associations, tourism boards.** Membership is the price
of a member-directory link. How: join the chamber of the city served most, complete the profile, go to one event, then offer a
speaker slot or a ribbon-cutting. Watch: a "chamber" that only sells a link and has no events is a directory in disguise.
(`chamberofcommerce.com` is a for-profit directory, not a chamber; the rules know that.)

**`local-news`: local news and community sites.** The strongest local proof, and the hardest. How: one real local fact per
note (a market number, a how-to, a community event), a quote and a phone number, sent to the reporter who covers it; answer
journalist requests in the field the same day. Never a press-release blast. Never pay for an article unless it is labelled
sponsored.

**`press-release`: distribution sites.** Worth sending only for real news (an opening, an award, a study). Do not expect
ranking credit. Google lists optimized anchor text in press releases distributed on other sites as link spam, so the link text
is the plain business name. The mention and a pickup by a real outlet are the prize.

**`sponsorship-charity`: sponsors, teams, charities, schools, service clubs.** Support a cause the owner cares about in the area
served and ask in writing to be named on the sponsor page with the website link. A donation made mainly to obtain a link is a
link scheme in spirit; keep the cause and the gift real.

**`partner-supplier`: partner and supplier businesses** (lender, title and escrow, inspector, stager, mover, manufacturer,
distributor, integration partner). Ask each real partner for a resources or partners page entry; give them a reason (a joint
guide, referrals, a quotable testimonial); link to them only where a customer would use it. Google lists "excessive link
exchanges" and pages made only for cross-linking as link spam: genuine partners, a few of them.

**`podcast-guest`: podcasts, newsletters, guest articles.** List ten shows or blogs the customers actually follow; pitch one
topic and two things the audience will learn; ask for the show notes or author box to carry the website with the business name
as link text. Few, relevant, real. Mass guest posting with keyword anchors is a named link scheme.

**`own-property`: the business's own other sites and profiles.** A second domain, a brand site, a blog. They connect the owner's
pages and carry the same name, address and phone; they are not independent proof. A pile of thin sites that exist to link to
each other is a private blog network (section 7). Also covers the name-matching rule in the classifier (a domain whose name
matches the business).

**`social-link-hub`: social profiles and link hubs** (Facebook, LinkedIn, YouTube, Instagram, Nextdoor, Linktree). Mostly
nofollow, but they are the sameAs proof that ties one business to one entity. How: claim with the exact name, put the website in
the website field, list the profile addresses in the site's `sameAs` schema. A link hub (linktr.ee) in place of a real website
link is a weak signal: link the site itself wherever the platform allows.

**`edu-gov`: schools, universities, city and county pages.** Strong when earned (a guest talk, an internship, a community event,
a resource list for residents). "Scholarship" and "discount for students" campaigns to win .edu links are a known scheme.

## 4. Industry packs (`rules/link-sources/`)
`taxonomy.json` holds the types and the rules that work for any business. One pack per line of business adds its own named
hosts (`domainTypes`), name patterns, `providerPatterns` and `providerText` (what a competing business looks like), the angles that work there, what to avoid, and the review sites that matter. The pack
comes from `business.json` `industry` (or `kind`), by slug or alias, or from `--industry`. A business with no matching pack
uses `local-generic` and the output says so. Every local pack extends `local-generic` (yelp, BBB, Apple Business Connect, Bing
Places, the chamber and service-club patterns).

| Pack | Typical sources | Careful about |
|---|---|---|
| `real-estate-agent` | Zillow, Realtor.com, FastExpert, the brokerage page, the Realtors association, expertise.com lists, title and lender partners | rankings sold as "Top agents"; state advertising rules (licence number shown) |
| `insurance-agency` | NAIFA and Big I chapters, carrier agent-locator pages, LinkedIn, Trustpilot, referral partners (lenders, real-estate agents, estate-planning attorneys, CPAs), local career centres for recruiting | paid 'Top Agent' lists and quote-lead networks; staff-written or gated reviews; guest posts carrying guaranteed-return or tax-free claims; state insurance advertising rules (UNVERIFIED, see the industry pack) |
| `cash-home-buyer` | BBB, Trustpilot, local investor associations (REIA), probate, divorce and clean-out professionals | paid "we buy houses" directories; state wholesaling rules; doorway city pages |
| `home-services` | manufacturer find-an-installer pages, Houzz, trade associations, supplier pages, home shows | paid lead marketplaces (Angi, HomeAdvisor, Thumbtack are leads, not links); fake city addresses |
| `legal` | Avvo, Justia, Martindale, bar associations, law-school clinics, legal aid | bought "Top Attorney" awards; state bar advertising rules; client confidentiality in reviews |
| `medical-dental` | Healthgrades, Vitals, hospital and insurer provider directories, medical and dental societies | patient privacy in review replies (HIPAA in the US); health claims |
| `restaurant-hospitality` | Tripadvisor, tourism boards, local food writers, supplier "where to eat" pages, restaurant week | free meals for reviews; undisclosed sponsored posts |
| `saas-b2b` | G2, Capterra, TrustRadius, integration marketplaces, "awesome" lists, podcasts and newsletters | incentivised or fake reviews; comment and forum drops |
| `ecommerce` | stockists and "where to buy" pages, gift guides, Trustpilot, unlinked brand mentions | free product for a link without `rel="sponsored"` (named in Google's list); coupon and affiliate sites |
| `local-generic` | the base: directories, chamber, service clubs, local news, partners | everything in section 7 |

The pack hosts are **recalled general knowledge, not re-fetched (UNVERIFIED)**, the same standard as the other rulesets here;
that is why step 3 (vet) exists. The value and effort numbers are judgements. To add a line of business: copy the closest pack,
set `slug`, `aliases`, `extends`, list only hosts you are confident exist, keep the `basis` line honest, and run
`node scripts/test-authority.mjs` (it validates every pack).

## 5. NAP and local citations (the map pack)
NAP is name, address, phone. Google's map ranking uses relevance, distance and prominence; citations and consistency are
part of how a business looks real and prominent. The rule: **one canonical record** (`business.json`, confirmed by the owner once)
and every place matches it exactly after normalisation (case, punctuation, "St" and "Street" are normalised; a different suite
number, a tracking phone or a keyword in the name is a mismatch). `scripts/local-nap.mjs` (stages/local.md) does the comparison
for the site and for captured listings.

Order of fixing: (1) the Google Business Profile, the record the others are compared to; (2) the website footer, contact page
and the LocalBusiness schema; (3) Apple Business Connect and Bing Places; (4) the big data suppliers that feed other directories
(the `US:aggregators` list in `rules/citation-sources.json`; names change, check the list); (5) the vertical profiles of the
pack; (6) everything else. Claim and correct what exists; do not create a duplicate; mark a moved or closed old listing. Use the
main number on listings and keep a tracking number as a secondary number. Never use a virtual office or mailbox as an address.
A service-area business without a public address hides it and lists the areas served. Never change the business name to add
keywords: it breaks consistency and the platforms' rules.

## 6. Reviews are part of authority
Reviews feed prominence in the map pack and are repeated by AI answers: in the captures we hold for the Francine and Eli project,
answers named businesses with their rating and number of reviews. How to do it right: ask every customer, the same way, soon
after the job, with a direct link; start with Google, then the one or two vertical platforms the pack lists; reply to every
review politely and without private details. Never write, buy or trade reviews, never reward a review, and never ask only the
people you expect to be happy (review gating); each platform bans these and, in the US, the FTC's rule on fake reviews (in force
since late 2024) adds penalties for buying and for fake reviews (recalled, check the current text before quoting it). The review
gap against the businesses that win the pack is measured in stages/local.md.

## 7. What to avoid (Google's spam policies)
Google's "link spam" is links made mainly to manipulate rankings. Its own list (re-read 2026-10-22) includes: buying or selling
links that pass ranking credit, including trading goods or services or sending a product in exchange for a write-up with a link;
excessive link exchanges and partner pages made only for cross-linking; automated link creation; requiring a link in terms or a
contract without letting the other site qualify it; paid advertorials and native ads with ranking links; optimized anchor text
in guest posts or press releases distributed on other sites; low-quality directory and bookmark links; keyword-rich links in
widgets; widely distributed footer or template links; forum comments with optimized links. Buying and selling links is not
itself a violation when the link is qualified with `rel="sponsored"` or `rel="nofollow"`. The values: `sponsored` for paid
placements and ads, `ugc` for user-written content, `nofollow` when neither fits. Related policies: **site reputation abuse**
(third-party content published on a strong site to borrow its ranking), **expired domain abuse** (buying a lapsed domain to
borrow its past), **scaled content abuse** (many pages made for rankings).

For us that means, in plain words:
- Never buy a link, or a package of "listings", unless the page labels it sponsored. A paid listing is advertising; record it as
  advertising, not as an earned link.
- No private blog network (PBN): sites built or bought to link to each other or to a client. No expired-domain redirects.
- No link exchange schemes ("link to me and I link to you") beyond genuine partners.
- No bulk directory submission, no bookmark sites, no "SEO directory" lists.
- No fake, bought, rewarded or gated reviews; no fake addresses.
- No awards that are bought. No keyword-stuffed anchor text: the link text is the business name.
- Not a link scheme, but equally forbidden to us: scraping Google or Bing result pages, logging in to a site to get listed, or
  submitting forms on a client's live site. Vetting visits are GET only.

`authority-vet.mjs` flags "buy links / paid links / dofollow links" wording, casino and pharma terms, parked domains, thin
pages, pages that link out to dozens of sites, and `noindex`; those become AVOID. It cannot see everything: PURSUE means
"nothing wrong found on two pages, and we know what kind of site it is" (an unclassified site is never better than CHECK BY HAND), never "safe".

## 8. How AI engines pick sources, and what that changes
AI answer products (ChatGPT search, Perplexity, Google's AI Overviews and AI Mode, Gemini, Copilot) answer from a web search
step and show the sources. What we see in our own captures for the Francine and Eli research: the sources named were
**lists, portals, directories and profile pages**, not the realtors' own sites, and **0% of 109 captured answers cited
her site** (SOP precedent, `runs/2026-10-22-*.md`). This is an observation from our captures, not a law about every engine, and
engines change; re-capture monthly (stages/measure.md) and trust the capture over this paragraph.

What follows for the work:
1. **Be on the lists they cite.** `research-ai.mjs` writes `research/ai-citations.json`; its `citedInstead` list (domains cited in
   answers where the business was not) is read by `authority-classify.mjs` and ranks those domains right after the link gap.
   `research-citations.mjs` does the same for directories in the captured search results. For every domain on those lists,
   pick the route in section 3 (claim a profile, apply to the list, pitch the editor).
2. **Be one entity.** The same name, address, phone, short description and category everywhere (section 5); an Organization or
   LocalBusiness schema block on the site with `sameAs` pointing at every real profile (Google Business Profile, Facebook,
   LinkedIn, YouTube, the vertical profiles); named authors and the same credentials wherever they appear. A Wikipedia or
   Wikidata entry needs notability: never create one for a small business and never edit one for pay without disclosing it.
3. **Be quotable.** Pages with plain facts, prices or ranges, local numbers and a named expert are what lists and journalists
   quote. That is page work (stages/plan.md); off-site it becomes the "digital PR" angle: one piece of local data a year, sent to the
   reporters and associations that cover the area.
4. **Measure the right thing.** The proof is the next capture: is the business cited, named, or listed on the sources that
   engines used? A listing raises the chance of a mention; it is not a promise. The tracker's `listed` rows and the next
   `research-ai` capture are read together.

## 9. The first months (what a client sees)
Weeks 1 to 2, owned and easy: Business Profile, NAP fixes, the parent or employer page, social profiles and `sameAs`, the
pack's `baseline` profiles, review requests started. Weeks 2 to 6: the chamber, the association profile, partners and
suppliers, one sponsorship. Ongoing: one local fact a month to the news site, one pitch a month to a podcast or an editor, and
the editorial lists on the opportunity list. Monthly: update the tracker, run `measure`, send the client the plain-words
progress (what was listed, what was refused, what is waiting).

Precedent (Francine and Eli, 2026-10-22, `valleytovalleyrealty.com`): her site had 1 linking domain (linktr.ee); four realtor
competitors had 7 to 9 from expertise.com, activerain.com, a chamber of commerce (msjchamber.org), a local news site
(sanjoseinsider.org), a press-release site, a charity (giftofvision.org), partner businesses, ranking lists
(top100realestateagents.com, findinmyzip.com, listingnearme.com), the brokerage's site and the agent's own other domain.
`authority-classify.mjs` (with her AI-citation captures) turned that into 75 open opportunities: 3 in the link gap, 21 cited by AI engines instead of her, 25 linking to one competitor, 18 from the captured searches, 8 usual places. 46 stayed unclassified, 7 were set aside as not actionable (a competitor's second domain, three other brokerages' rosters, Google and map hosts) and Zillow showed as already listed. Of the 29 classified by rule, 6 are marked low certainty (`usnews` reads as news, `sblisting` as a directory): the vet step, or a person, decides.

## 10. Stop rules, files and honesty
- **Vetting is polite**: GET only; robots.txt first and obeyed (the group for our own user agent `PEWP-Authority` counts); honest
  user agent; `--gap-ms` (default 4000) between requests to one site; a 403 or 429 stops that site, no retry, no disguise;
  `--exclude` (path regexes) and `--skip-domain` cover every request, robots.txt and redirect hops included; no login, register,
  checkout or account path is ever opened; each request has a time limit (`--timeout-s`), the run a deadline (`--max-minutes`,
  exit 4) and a request budget (`--max-requests`). Results younger than 30 days are reused; `--refresh` re-reads (200 answers
  come from the cache). Git Bash rewrites a leading `/` in `--exclude`: run from PowerShell or the tool refuses.
- **Never** scrape Google, Bing, ChatGPT or Perplexity result pages, submit a form, register, or log in. Those captures are the
  owner's, at human pace.
- Files (under `<pewp>/authority/`): `anchors.json` and `.md` (2b), `opportunities.json` and `.md`, `vetting.json`, `howto.md`, `outreach.json` and
  `outreach.md`. `outreach.json` rows: domain, type, owner, status (`planned`, `asked`, `listed`, `refused`), date,
  `evidenceUrl`, history. **A row is `listed` only with an evidence address on that site**; an owner is needed before a site is
  asked; a site appears once; dates are real. `explain` (and `explainReferringDomains` for `measure.mjs`) separates the
  referring-domain gains we earned (with proof) from "asked, not confirmed" and from gains nobody here caused. Asked more than 21
  days ago with no answer shows as a follow-up.
- UNPROVEN, to say plainly: the pack hosts (recalled); the value and effort numbers (judgements); classification by domain name
  (rules, with certainty shown); that AI engines behave as our captures showed; any effect on rankings, which no one can promise.
- Proof for the run file (`runs/<date>-authority.md`): the three commands with exit codes, the first 40 lines of
  `opportunities.md`, the verdict counts from `vetting.json`, and `node scripts/test-authority.mjs` output.
