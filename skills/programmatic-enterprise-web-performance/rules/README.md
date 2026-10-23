# rules/ - the rulesets the growth algorithms read

Everything here is read by `scripts/lib-rules.mjs` (cached; `PEWP_RULES_DIR` points it at another folder, which the tests use).
A per-locale file is an object keyed by BCP 47 tag (`en-US`, then `en`); keys that start with `_` are metadata.
A locale with no entry is an error that says so (shipgate 04 section 15: no silent English fallback).

## Copied from shipgate (byte for byte; `node scripts/rules-sync.mjs --check` compares them)

| File | Source path | Copied | sha256 |
|---|---|---|---|
| `gazetteer/us.json` | `D:/internal building pipeline for making sure that all websites we make real enterprise grade on search engines/shipgate/rules/gazetteer/us.json` (GeoNames cities1000, CC-BY-4.0, https://www.geonames.org/) | 2026-10-22 | `b9184ac104dd169cd3d17732fd873b14904d23f09ba8311419d055beb02e3b26` |
| `stop-words.json` | `.../shipgate/rules/stop-words.json` (Snowball stop lists, https://snowballstem.org/algorithms/*/stop.txt) | 2026-10-22 | `2f3e15be05cc5d96e10a45a1b54e374a1544d5e7156e8a33533a65f0794a941c` |

Only the US gazetteer is copied; another market needs its `gazetteer/<country>.json` copied the same way (`rules-sync.mjs`).
shipgate has no `intent-modifiers.json`, `directory-domains.json`, `citation-sources.json` or `ctr-curve.json` yet (checked 2026-10-22), so those four are built here.

## Derived from shipgate

`schema-subtypes.json`: every subtype (transitive) of Product, Offer, ItemList, Article, VideoObject, QAPage, Review, Service, LocalBusiness, from the
supertypes in shipgate's `schemaorg.json` (schema.org 30.1, CC-BY-SA-3.0). Written by `scripts/rules-sync.mjs`; do not edit by hand.

## Built here (each entry names its source)

| File | Used by | What it is | How the sources were checked |
|---|---|---|---|
| `intent-modifiers.json` | 06 section 9.2 (rules 1-3), TR-202 | en-US local, transactional and commercial modifiers; the five commercial words the spec names (best, vs, review, top, price) come from the spec itself | Semrush, Ahrefs, the Google Quality Rater Guidelines and Think with Google are cited from memory; the pages were NOT re-fetched on 2026-10-22 (each `_sources` entry says `basis`) |
| `directory-domains.json` | 9.2 rule 4, 9.3 (forum, directory), TR-215 | US real-estate portals, review and professional directories, marketplaces, forums, social and reference hosts, each with the brand people type | host identities from general knowledge, not re-fetched; US-centred |
| `citation-sources.json` | TR-218, MSR-010 | US local-citation sites: profiles, aggregators, review sites, vertical directories | named after Moz, BrightLocal and Whitespark citation lists, not re-fetched |
| `ctr-curve.json` | MSR-004 | expected organic CTR by position, labelled an industry-average estimate | Backlinko "Google CTR Stats". On 2026-10-22 only position 1 (27.6%) was confirmed by a search snippet. Positions 2-10 are UNPROVEN: recalled, to be checked against the page before a report quotes them |
| `route-patterns.json` | 9.3 (category) | the path segments (collections, product-category, category, ...) after which a handle names a category | Shopify, WooCommerce, WordPress, BigCommerce URL conventions, not re-fetched |
| `gazetteer-exceptions.json` | the effective gazetteer | single words that GeoNames lists as places but that are ordinary words in a search (home, price, top, and, ...) | found by looking ~300 common words up in `gazetteer/us.json` on 2026-10-22 |

## One deliberate difference from shipgate's data (not from its algorithms)

shipgate uses `gazetteer/us.json` as is. Taken literally, 06 section 9.2 rule 1 ("the query contains a place name of the gazetteer") makes
`home value` and `top plumbers` local queries, and web-delivery section 12 leaves `home price` with no head term, because GeoNames lists towns called Home,
Price, Top, Deal, Worth, Day, ... and about 1,500 airport-style codes (ABE, ACT, ART). `lib-text.mjs gazetteer()` therefore drops, when it loads the file:
entries written in capitals of 2-4 letters; single-word names that are stop words of the locale or words of an intent modifier; the words in
`gazetteer-exceptions.json`. `PEWP_GAZETTEER_LITERAL=1` switches that off (the spec-literal behaviour; `test-rules.mjs` runs both). If shipgate's spec is
changed to filter its gazetteer, delete the exceptions and this paragraph.

## Adding a locale or a market

1. `stop-words.json` already has 20 languages. Add the language's entry to `intent-modifiers.json` (every modifier with a source), and for a language that has a Snowball stemmer
   but none built in `scripts/lib-snowball.mjs` (everything except English), build it first: the code refuses (BLOCKED) rather than compare unstemmed words.
2. Copy `gazetteer/<country>.json` and add the country to `citation-sources.json` and `directory-domains.json`.
3. Run `node scripts/test-rules.mjs`.
