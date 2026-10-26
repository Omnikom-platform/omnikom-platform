# `targets.json` and `business.json`: the contract between research, plan, gate, refactor, measure and build

Owner of the validator: `scripts/targets-validate.mjs` (phase 2). Every stage that reads or writes these files follows
this page exactly; a change here is a change to every stage.

## A sourced number (used everywhere a number appears)
`{ "value": <number|string|array|null>, "source": "<where it came from>", "fetchedAt": "<ISO date>", "cacheFile": "<path or null>", "estimate": <bool, optional>, "location": "<city/ZIP or country, when it varies by place>", "device": "mobile|desktop (when it varies)" }`
Never a bare number. `estimate: true` for ranges and inferred values (Keyword Planner ranges, Bing estimates).

## business.json (`<pewp>/business.json`, written by S1 intake)
```
{
  "name": "", "domain": "", "kind": "e.g. real-estate-agent", "industry": "slug of rules/industries/<slug>.json or null",
  "offer": "what it sells", "audience": "to whom",
  "market": { "country": "US", "language": "en" },
  "locations": [{ "name": "", "address": null, "serviceArea": ["city", ...] }],
  "goals": ["leads" | "calls" | "bookings" | "sales"],
  "competitors": ["domain", ...],
  "brand": { "constraints": [] },
  "existing": { "site": "url|null", "searchConsole": bool, "businessProfile": "url|null", "socials": [] },
  "launchState": "live" | "preview" | "planned",
  "rankTracking": { "source": "search-console|browser-capture", "locations": ["city, ST"], "devices": ["mobile"] }
}
```

Overhaul additions (2026-10-25, contract C2; written by intake, all optional for older files):
`"vocabulary": ["historic homes", ...]` (the words the business and its readers use; owner-only; never `[]`), `"notOffer": "what it is not"` (one line),
`"provenance": { "<field>": "owner" | "site" | "default" | "unstated" }` with one entry per filled field, keyed by the dotted field name
(`kind`, `offer`, `audience`, `goals`, `competitors`, `brand.constraints`, `vocabulary`, `market.country`, `locations`, `existing.searchConsole`,
`rankTracking.locations`, ...). `kind` may be `editorial-media` (publisher or media platform with paid features; `industry` follows it when
`rules/industries/editorial-media.json` exists). `approve.mjs business` signs the file to `approved/business.json` only when the owner-only fields
(`kind, offer, audience, goals, competitors, brand.constraints, vocabulary`) all have provenance `owner`. A location whose `name` lists several places
(" and ", "&", ";" or two or more commas) is a label: the default `rankTracking.locations` comes from its `serviceArea`.

Ratified extensions (Lead, 2026-10-22, from the phase 2 and 4 builders): `phone` (string, as shown on the site) and
`legalName` (optional) for the NAP check; `credentials: { state, licenseNumber, brokerage, licensed }` (optional; the
industry rules need it for licence-number and brokerage checks).

## targets.json (`<pewp>/targets.json`, written by S2 research, read by S3 plan, S5 gate, measure, build)
```
{
  "version": 1, "business": "<domain>", "market": { "country": "US", "language": "en" }, "createdAt": "<ISO>",
  "clusters": [{
    "id": "c-<slug>",
    "primaryQuery": "",
    "queries": [""],
    "intent": "informational|commercial|transactional|local|navigational",
    "location": "city, ST | null (null = not local)",
    "volume": <sourced number>, "difficulty": <sourced number|null>, "value": <sourced number|null>,
    "serpFeatures": <sourced number whose value is ["ai_overview","local_pack","paa","video","snippet",...]>,
    "winningFormat": "e.g. city landing page | guide | listing page | tool",
    "competitorsTop3": [{ "url": "", "domain": "" }],
    "requiredEntities": [""], "questions": [""],
    "targetPage": "<url path> | \"new\"",
    "priority": <number, impact x effort, higher first>
  }]
}
```
Rules the validator enforces: unique `id`; every `primaryQuery` unique across clusters (two clusters on one query =
cannibalisation); every number is a sourced number with `fetchedAt`; `market` present and every cluster's numbers are
for that market; `location` present on local intent; `targetPage` is a path or "new".

A cluster may also carry `wordRange`: a sourced number whose value is `[min, max]` taken from the SERP winners (without
it a brief uses a labelled default). Searches with no sourced volume do not enter `targets.json`; research writes them
to `research/unmeasured.json` instead. A query whose results page was not captured gets `serpFeatures.value: []` with a
source that says NOT CAPTURED.

## Rankings and AI citations (measure, research)
Files: `<pewp>/measure/<date>/rankings.json` = `{ date, rankings: [row...] }` and `citations.json` = `{ date, citations: [row...] }`
(what `targets-validate.mjs --measure` and `compareMeasure` read). Search Console's average position is rounded in
`position.value` and kept unrounded as `averagePosition`.
A ranking row: `{ query, location, device, language, position: <sourced number>, url, engine: "google|bing" }` - rejected
if location, device, language, source or fetchedAt is missing. An AI citation row: `{ question, engine, model, prompt,
runs: N, citedShare: <sourced number 0..1>, citedSources: [domain], ourDomainCited: bool, location }`.
