# ELEV8 -> the contract

Sources (read only): approved plan `E:/Alex Sevilla/site-checks/elev8ca.com/.pewp/approved` (sitemap.json 31 pages, existing-pages.json
18 kept live pages, business.json), approved home design `draft-site/design/variants/v4.html`, `LISTINGS-DECISION.md`.
Generated: `contract.json` (`node contracts/from-plan.mjs ...`), `screens.md`. Declared by hand: `entities.json`.

## Pages (43)
| Plan / live page | Page type | Bound to |
|---|---|---|
| `/` | home (V4 sections) | |
| `/realtor-in-<city>...` x10 (cluster c-agent) | agent-in-area | city |
| `/homes-for-sale-in-<city>-ca/` x10 (c-buy) | buyer-guide (city guide per LISTINGS-DECISION) | city |
| `/sell-my-house-fast-in-<city>-ca/` x9 (c-sell) | sell-in-area | city |
| `/areas-we-serve/` | areas-hub | |
| `/buying`, `/selling`, `/financing` | service-page (default sections) | |
| `/home_value`, `/connect`, `/faq`, `/reviews`, `/team`, `/privacy_policy`, `/tos` | home-value, contact, faq, reviews, team, privacy, terms | |
| `/blog` (added 2026-10-28, lead session: articles index, GT-007) | blog-index | |
| `/accessibility-statement/` (added 2026-10-28: launch gate RE-DISC-001) | accessibility (locked notice) | |
| `/agent-profile/<slug>` x8 | not pages: Team item pages at their live addresses (`team` route), so no redirects | |

Page type comes from the plan's cluster family (cluster id minus the city), the city binding from the plan's `location`.

## Home sections (V4, header and footer from Business details)
hero (heading, lead, photo, search tabs) · trust (up to 4 sourced figures; the licence line comes from Business details) ·
three ways (3 cards) · home value (text) + home-value form · how we sell (steps) · areas (feed: cities) · our listings (feed) ·
recently sold (feed) · home finder (form) · about team (text) + team grid (feed) · closing (text) + contact form.
The hero search goes to the home-search address (`settings.homeSearchUrl`, locked, Brivity); no MLS data in the contract.

## Collections
- **Cities** (`areas`, Place): the 10 plan cities are seeds. Facts shown on a city page must carry a source and date.
- **Our listings** (`listings`, RealEstateListing + area + agent): own listings entered by hand. Agents see and edit only their
  own (owner field `agent`, filled from the login). Public page `/listings/<slug>/` with RealEstateListing schema.
- **Team** (core + cities served + route `/agent-profile/<slug>`): licence number locked. The brand rule "never name an Omnikom
  client" stays a content decision (the row is simply not created), not a contract rule.
- Core: Business details (licences, footer notice locked), Articles, Reviews (source + date + permission), Q&A, Legal text
  (consent, privacy, terms; locked), Photos, Redirects, Lead inbox.

## Placements (what LISTINGS-DECISION says, as rules)
active / coming soon / pending -> home "Our listings" (6, newest), its city guide, "Realtor in <city>" (6) · sold -> home
"Recently sold", city guide "sold", "Sell in <city>" (4 each, newest first; sold price shown only when "show sold price" is ticked) · every listing -> sitemap + schema · delete -> 301 to its city guide.
Derived: team on "Realtor in <city>" for agents serving that city; Q&A by topic on every page type with a Q&A feed.

## Forms -> Lead inbox -> OmniSuite
contact (topic -> "Buyer or Seller") · home-value (address) · home-finder (city -> "Target Area", budget -> "Price Range",
timing -> "Move Timeframe"). All need the locked consent notice `form-consent` (wording `[client to confirm]`).

## Client wording to confirm (contract `clientWording`, goes into the review email)
budget ranges · closing-form topics · consent wording · home-search address (Brivity subdomain unverified).

## Still to do outside this repo
Add `/blog` to the approved plan in the ELEV8 project (it is declared here in `entities.json`).

## Gate waivers and samples (2026-10-28, from the preview build)
`/privacy_policy` stands in for RE-DISC-001's `/privacy/` (live URL kept; contract `gateWaivers`). Sample listings (`sample: true`) may use
photos below 1200 px on previews and are refused on a live site (`I-SAMPLE-LIVE`). Form topics and hero tabs include "cash-offer" (V4).
