# Stage: local (local search as its own channel; used by `research`, `build`, `audit-live` and `measure`)

Load this file when the business serves customers in particular places (an agent, a cash buyer, a clinic, a trade). Local
search is not one more feature of the results page: the map pack, the Business Profile, directory listings, reviews and
"near me" behaviour are a separate channel with their own ranking factors (distance, relevance, prominence). This stage turns
what the owner can lawfully read into four checks: the **Business Profile**, **where we sit in the map pack per city and
device**, **name/address/phone consistency**, and the **review gap against the businesses that win the pack**.

Free sources only. There is no free, lawful, automatic source for other businesses' map results: the project's own research
(TRACKER-PROPOSAL, 2026-10-18) found that scraping Google and faking a city's searcher both fail (robot check, location
ignored). So the grid and the pack come from **owner-supervised captures at human pace**, or the part is BLOCKED.

## Inputs (all under `<pewp>/`; each missing one makes only its part BLOCKED, with the step that unblocks it)
| Input | File | Written by | If missing |
|---|---|---|---|
| Canonical name, address, phone | `business.json`: `name` (or `legalName`), `locations[0].address`, `phone` | intake, confirmed by the owner once | NAP part BLOCKED (`phone` and `legalName` are ratified extensions, `schemas/targets.md`) |
| Our Business Profile | `captures/local/profile.json`: the owner's Business Profile API export `{exportedAt, location, reviews, media, localPosts}`, or a dated manual capture (`kind: "manual-capture"`, fields in `MANUAL_EXAMPLE` of `local-profile.mjs`) | the owner (API access needs Google's approval and the owner's OAuth) or a person reading the public listing once | profile and review-gap BLOCKED |
| Competitor listings | `captures/local/competitors/*.json` (name, primaryCategory, secondaryCategories, rating, reviewCount, lastReviewDate, photosCount, capturedAt, capturedIn) | a person, once, for the businesses in the pack | the comparative profile findings BLOCKED; the absolute ones still run |
| Map-pack captures | `captures/local/pack/*.json` (one result page per file) | a person at human pace | pack and review-gap BLOCKED |
| Directory listings | `captures/local/citations.json` (`[{directory, url, name, address, phone, capturedAt}]`) | a person reading each listing | citation part BLOCKED |
| The site | a snapshot folder (`site-checks/<host>/snapshots/<date>/`) or a built folder | `live-target.mjs` / the build | site part BLOCKED |
| Directory list for the market | `rules/citation-sources.json` if present, else a **built-in default marked UNVERIFIED** | the ruleset | the default is used and said so |

## Run it
`node "<skill>/scripts/local-run.mjs" <url|repo> [--site <dir>] [--today YYYY-MM-DD]` writes `<pewp>/local/<date>/` with
`profile.json`, `pack.json`, `nap.json`, `reviews.json`, `summary.json` and a plain-words `report.md`. No model needed.
The pieces run on their own: `local-profile.mjs`, `local-pack.mjs`, `local-nap.mjs`, `local-reviews.mjs` (usage in each header).
`measure` reads the newest `nap.json` for rule MSR-010.

## How to capture (owner-supervised, the 2026-10-17 precedent)
One result page at a time, **at least 45 seconds apart, stop at the first robot check**, in a normal browser, nothing submitted,
nobody logged in to anything of the client's. For each capture record the query, the city, the device (mobile first: most local
searches are on phones), the language, the date, the browser and whether signed in, and **what the page footer says about the
place**. The searcher must really be in the city (or a location the footer confirms): a location parameter in the address bar is
ignored by Google (proved on 2026-10-17: the footer showed the browser's own place). `locationShown` goes into the file; a
capture whose footer does not contain the requested city is kept as `localized: false` and **never** used for that city, for
the review bar, or to order cities. Pack file:
```
{ "query": "we buy houses Tracy CA", "city": "Tracy, CA", "location": "Tracy, CA", "locationShown": "Tracy, CA", "device": "mobile",
  "language": "en", "capturedAt": "2026-10-20T18:00:00Z", "capturedIn": "owner phone, signed out",
  "pack": [{ "position": 1, "name": "", "rating": 4.8, "reviews": 61, "category": "", "address": "", "phone": "", "website": "" }] }
```
Same query + place + device + language captured twice: the newest wins and the older file is listed under `superseded`.
A capture missing city, device, language or date is rejected and listed. Never compare mobile with desktop or one city with another.

## 1. Business Profile (`local-profile.mjs`)
Imports the owner's API export (Business Information locations, Reviews, Media, Posts shapes; unknown fields ignored, absent ones
reported as absent; **UNVERIFIED against a live export until the owner supplies one**) or a dated manual capture; an undated
file is BLOCKED because a number without a date is not evidence. Findings (skill-internal ids `LOC-P01..P13`, warnings):
no primary category · no secondary categories · no services · no description · no hours · no website link · no post in 90 days ·
under 80% of reviews answered · no review in 90 days · and, with competitor captures: categories competitors use that we do not,
fewer photos / reviews / lower rating than the competitor median. Each comparison number is a sourced number naming the captures.
Fix wording is plain ("add the categories the top pack businesses use") and never promises a rank.
In a manual capture the primary category, the secondary categories, the services, the website or the description that were not read are written null (or left out):
the check of each is listed BLOCKED with what unblocks it; an empty list or an empty text means the listing was read and shows
none, and gives the finding.
In a competitor listing the secondary categories follow the same rule: null (or left out) is not read, that competitor is left out of the categories comparison, the finding says how many were compared and how many were not read, and when nothing is found the check is listed BLOCKED; an empty list means read and none.
In report.md each unjudged check of a read profile is a "- NOT READ, <id>: <reason>. To fix: <unblock>" line; the summary counts both.

## 2. Map pack per city and device (`local-pack.mjs`)
Our position in the pack for each query, city and device (null when we are not in it, with the pack size), sourced as an owner
capture with place and device, plus the pack's businesses (name, rating, reviews, category) for the review gap. The summary says how
many captures were localized and how many were not. The ranking at **several points around a city** is the local grid, section 5
(our own, free, no paid provider). Before any grid capture exists say "grid not measured" plainly; a city-centre capture on mobile
is the cheapest substitute.

## 3. Name, address, phone consistency (`local-nap.mjs`, feeds MSR-010)
`business.json` is the one canonical record. The check compares, after normalisation (letters folded, punctuation dropped,
street words abbreviated: street/st, suite/ste, `#`, ZIP+4 cut, legal suffixes inc/llc dropped from names, phone reduced to the
national number without country code or extension), exactly: (a) every page of the site (JSON-LD LocalBusiness-type name,
telephone and address; `tel:` links; visible phone numbers listed as low-confidence because tracking numbers are legitimate) and
(b) each captured directory listing. Output: per-page issues, mismatching listings with the field and both values, consistent
listings, and the directories of the market's list with no captured listing. The built-in directory list (Yelp, Bing Places, Apple
Business Connect, Facebook, BBB, Yellow Pages, MapQuest, Nextdoor, Foursquare; plus Zillow, Realtor.com, Homes.com, Redfin, Trulia
for real estate) is **UNVERIFIED** until the ruleset `citation-sources.json` replaces it. Fix: correct the listing to the exact
canonical wording, or have the owner change the canonical record if the listing is right; one wording everywhere.

## 4. Review gap (`local-reviews.mjs`)
For each localized pack capture: our review count and rating (from the profile) against the pack's 3rd place (the "review bar" for
the 3-pack on this one factor), the pack median, the gap in reviews and in rating, and who the competitors are. Always printed with
"reviews are one factor; distance and relevance also decide the pack". Unlocalized captures are counted and left out. A plan item
follows: a steady review request routine (a link to the profile, to recent customers, no incentives, no gating), replies to every review.

## 5. Local grid: our own rank grid (`local-grid.mjs`, feeds MSR-010)
A paid grid tool is not allowed, so the grid is ours: the Google Maps results list, read at several points around each
service-area city (Maps ranks by the map's viewport). Nothing about Google is automated; the script plans the work and reads the results.
1. **Centres.** `captures/local/grid/cities.json`: `[{ "city": "Tracy, CA", "lat": 0, "lng": 0, "source": "<where read>", "readAt": "<date>" }]`,
   one entry per `business.json` `locations[].serviceArea` city, read once from a public map by the owner or the main session. Never
   looked up or guessed here; a city without a sourced centre is BLOCKED with that step.
2. **Plan.** `node scripts/local-grid.mjs plan <url> --query "we buy houses {city}" --query "realtor in {cityName}" [--n 3] [--spacing-km 3] [--cities "Tracy, CA"] [--max-captures 200]`.
   An N x N grid (default 3 x 3, 3 km apart; north is up, rows `r1..rN`, columns `c1..cN`) centred on the city centre; an even N gets
   the centre as an extra point. Writes `plan.json`, `config.json` and the **capture requests**: `requests.json` (query x point, each with its Google Maps address mapsUrl at zoom 14,
   `location: "lat,lng (city)"`, a capture template per request, the instruction text) and `requests.md` (a checklist).
   It prints the number of captures and the minutes (45 s each). **Cost stop: 200 captures** (a 3 x 3 grid, 11 cities, 2 queries is
   198 captures, about 2.5 hours of human-pace capturing): over the stop nothing is written and the message says to ask the owner and
   cut `--n`, `--cities` or the queries. Pick the 1 to 3 queries that matter; each one multiplies the work. A plan
   narrowed with `--cities` writes them into `config.json` `cities`; a later plan without the flag (the manifest's step passes none) plans exactly
   those; the flag beats the file; delete the key to plan every city. A name in `--cities` or in `cities` that is not a service-area city is
   BLOCKED naming where it came from, and nothing is written; `cities` must be a non-empty list of names.
3. **Capture** (the main session with the owner, never automated): open each request's `mapsUrl` (mobile or desktop, as captured);
   when the list has loaded, read the viewport back from the page's address (`@<lat>,<lng>,<zoom>z`) and save the list as
   `captures/local/grid/<id>.json` from the request's `template` (`method: "maps-viewport"`, `viewport`, the device: mobile or desktop, as captured, `sponsored` per row). One page at a time, **at least 45 seconds apart; stop at
   the first robot check** (save `{"robotCheck": true}` and say so; do not continue). Not signed in to anything of the client's, nothing submitted. When the page text was saved instead of typed (one text per page, with the helper's header line), `node scripts/grid-text-to-capture.mjs --pewp <pewp> (--raw <list text> | --card <card text>) --convert <dir> --captured-in "<browser, device>"` writes the capture and refuses a text it cannot read whole.
4. **Import.** `node scripts/local-grid.mjs import <url>` (also run by `local-run.mjs`) writes `<pewp>/local/<date>/grid.json`,
   `grid.txt` and `grid.html`. A capture is one of two forms, never mixed in one grid (a folder holding both that pass is BLOCKED with
   the count of each, and nothing is written): the Google Maps viewport form (`method: "maps-viewport"`, `viewport {lat, lng, zoom}` read back
   from the page's address, mobile or desktop, as captured) counts when the viewport's centre is at most 0.5 km from the point at zoom 13 to 15;
   the mobile search form (no `method`) counts only on mobile and only when its footer names the city, another service-area city, or says
   "precise location" (a footer that shows another place is kept under that place, drawn `?` and not counted). A pack row with `sponsored: true`
   is an ad: it is taken out before the positions are numbered and the point keeps `sponsoredRemoved`. A point captured twice keeps the newest.
   Rejected with the reason: robot-check files, a search-form capture not on mobile, another `method`, a Maps capture without a viewport or on a
   device other than mobile or desktop, a `sponsored` that is not true or false, captures without date, point or pack.
   - **Per-point table:** our position (or absent), pack size, the top 3 competitors at that point, rating and reviews.
   - **Share of local voice** per query and city: 3-pack points / localized points (`solv3`), points in the pack at all (`presence`),
     median position where present, coverage against the plan (`partial` when points are missing), and the top 3 competitors by the
     number of points where they hold the 3-pack. Every number is a sourced number naming the captures.
   - **Heat map:** `grid.txt` (north-up matrix: 1 to 9 our position, `-` not in the pack, `?` another place, `.` not captured) and
     `grid.html` (one inline-styled table per query and city with a legend; no script, no external file, names escaped).
   - **Ranking rows** in `grid.json` `rankings`: engine google, the device as captured (mobile for the search form), `location "lat,lng (city)"`, a whole position or null,
     passing the ranking-row validator. A whole position needs a URL: the listing's website if the capture has it, else the business
     domain, said in `urlSource` (the map pack lists a listing, not a page).
5. **Measure.** `measure.mjs` reads the latest grid for **MSR-010**: a weak coverage finding when the share of local voice is below
   `thresholds.gridSov3Floor` (0.34), and a lost-positions finding when the 3-pack points fell by 2 or more against the previous grid
   (compared only on identical query, city, coordinates, device, language); `diff.json` carries `grid` and the report a line.
Plain words for the owner: "the map pack is different on every street; this shows, point by point around each city, whether we
are among the first three Google Maps lists there". Do not promise a position; say what the captures showed and when.
**UNPROVEN against real captures:** the importer follows the pack format of `local-pack.mjs` and is tested on fixtures; the first
real capture session is the first proof, and that the page's address after the list has loaded keeps the requested centre and zoom must be checked then.

## Rules for the work around these scripts
- **Service-area pages are not doorway pages.** One page per city is allowed only if it has content that is true of that city and
  not true of the next (local facts, real examples, local team or office, local regulations, real reviews or sales); a template
  with the city name swapped fails the quality gate in the plan (`plan/programmatic.json`). Mark this in the brief; the S5 gate
  checks it. Not built here.
- **Regulated industries (real estate, finance, health, legal):** fair-housing wording, licence numbers and brokerage name on
  every page, advertising disclosures belong to the industry rules file the business brief selects; the NAP check does not replace it.
- Do not create listings, claim profiles, post, reply to reviews or submit anything on a client's behalf; that is the owner's act.
  Never submit a form on either live site (project rule 2).
- Stored data: owner captures may keep names and ratings (they are the owner's own reading). If a Places API is ever used, keep
  only place IDs and derived positions.
- A missing source is BLOCKED with the unblock step in plain words; it is never filled from memory or from an older capture.

## Still open in files other agents own
- `rules/citation-sources.json` and `rules/ctr-curve.json` exist now (read by local-nap.mjs, local-run.mjs, measure.mjs, rules-sync.mjs); their values are still labelled UNVERIFIED where the scripts print them. (Corrected 2026-10-25: this line used to say the files did not exist.)
- Done since this file was written: `schemas/targets.md` ratified `phone` and `legalName` on `business.json`; `doctor.mjs` lists the
  Business Profile export and the map-pack captures as sources.

## Proof
`node scripts/test-measure.mjs` (profile import from an API-shaped export and from manual captures, undated refusal, absolute and
comparative findings, pack importer with localized / unlocalized / rejected / superseded captures, the grid's two capture forms, sponsored rows and a folder that mixes them, NAP on a fixture site and
citations, review gap with sourced numbers, BLOCKED paths) and `--mutants` (phone normalisation and the unlocalized-capture
guard broken in turn must turn named checks red). `scripts/test-step-contracts.mjs` (remembered
cities; a capture made from a request's template is counted).
