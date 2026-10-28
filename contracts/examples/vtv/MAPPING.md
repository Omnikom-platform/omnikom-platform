# VTV (Valley To Valley Realty) -> the contract

Front end only: VTV's project rule forbids backend or database work before its blueprint sign-off, so this is a read-only
mapping. Sources: `E:/Francine & Eli/proposals/vtv/sitemap.xml` (its own page list, used as a stand-in plan because VTV has no
approved SEO plan) and the field names of `_build/data.json`. Generated: `contract.json`, `screens.md`. Proof: `adapter.mjs` -> `RUN.txt`.

## Pages (22) and item pages (59)
| VTV page | Page type | Bound to |
|---|---|---|
| `/` | home: hero (video), stats (sourced), featured listings, neighborhoods, reviews, award logos, contact | |
| `/neighborhoods/<slug>/` x11 | neighborhood guide: intro, listings in it (derived), contact | neighborhood |
| `/neighborhoods/`, `/properties/`, `/blog/` | index pages (feeds) | |
| `/about/`, `/buy/`, `/sell/`, `/home-valuation/`, `/mortgage-calculator/`, `/contact-us/`, `/privacy/` | about, buyer/seller guide (steps), home-value, calculator (text only), contact, privacy | |
| `/properties/<slug>/` x28 | Properties item pages (route) | |
| `/blog/<slug>/` x31 | Articles item pages (core route `/blog/{slug}/`) | |

## data.json -> collections
listings[] -> Properties (RealEstateListing + area, agent, style, agent note; amenities -> features, lat/lng -> map pin) ·
neighborhoods[] -> Neighborhoods (Place; census -> sourced local facts) · blog[] -> Articles · testimonials[] -> Reviews ·
stats / bio / approach / awards / guides / valuation -> page sections of home, about, buy, sell, home-value.

## What the run found (RUN.txt)
- Fits: listings 28/28 and reviews 6/6 clean as drafts; all 81 sitemap URLs reproduced by the contract build.
- Real gaps the contract would block at publish: census facts have no source + date (126); 6 article SEO titles over 60
  characters and 2 excerpts over 200; reviews have no date or recorded permission; 414 of 442 listing photos have no alt text.
- 12 of 28 listings are in cities with no neighborhood page, so they show on the properties pages only.
