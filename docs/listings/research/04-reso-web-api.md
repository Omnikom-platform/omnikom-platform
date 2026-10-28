# RESO Web API + Data Dictionary 2.x, and the three delivery platforms (Bridge, Trestle, MLS Grid) - research dossier, 2026-10-27

Scope: technical facts for the Omnikom self-hosted MLS listings architecture (per-MLS connectors, incremental sync into Postgres/Supabase, listing pages on the client domain).
Method: read-only web research. No API was called, no account created, no form submitted, no credentials exist or were invented.

Status key: CONFIRMED = read in the official doc by me on 2026-10-27. CONFIRMED (excerpt) = official doc text as quoted back by the search tool, because the official page itself was unreadable to me (see "Could not confirm"). REPORTED = third party or vendor marketing. UNCONFIRMED = could not establish.

## Summary

1. Standard shape is the same everywhere: OData 4 over HTTPS, `$filter`/`$select`/`$top`/`$skip`/`$orderby`/`$count`/`$expand`, JSON, resources Property/Member/Office/Media/OpenHouse. RESO Web API Core 2.1.0 (ratified Dec 2023) makes server-driven paging via `@odata.nextLink` a MUST and lets servers return a page size different from the one asked for. Write the connector to follow `@odata.nextLink` and never assume `$top` is honoured.
2. Three different auth models behind one RESO surface: Bridge = static long-lived Server token as Bearer (or `?access_token=`), Trestle = OAuth2 client-credentials token endpoint (`scope=api`), MLS Grid = long-lived Bearer token (no refresh). The connector needs an auth strategy per platform, not one OAuth client.
3. Page sizes and ceilings differ by 25x: Bridge on-demand 200 (replication endpoint 2,000), Trestle 1,000, MLS Grid 5,000 (500 default, 1,000 with `$expand`). Bridge `$skip` paging is capped at 10,000 records; beyond that the `/replication` endpoint is mandatory and is granted at each MLS's discretion.
4. Incremental key is not the same everywhere. Bridge says use `BridgeModificationTimestamp` (not `ModificationTimestamp`). Trestle says track the latest `ModificationTimestamp` received. MLS Grid: `ModificationTimestamp` is MLS Grid's own change time; `OriginatingSystemModificationTimestamp` is the source MLS time. Store a per-source, per-resource high-water mark, and use the greatest value seen even for records you discard (MLS Grid says so explicitly).
5. Deletes are the part that differs most. MLS Grid has an explicit delete flag: `MlgCanView=false`, kept in the feed for only 7 days, so a sync that is down more than 7 days must full-resync. Trestle documents that incremental pulls do NOT report removals; you must periodically pull all keys and delete what is missing. Bridge docs are silent on deletes (UNCONFIRMED): plan for status changes plus a key-reconciliation pass.
6. MLS Grid is replication-only (no on-demand), requires exactly one `OriginatingSystemName` per request, and has hard limits: 2 req/s, 7,200/hour, 40,000/day, 4 GB/hour. No recommended polling interval exists for consumers; MLS Grid itself ingests from member MLSs every minute. The "2-hour cadence" and "required replication flag" in the brief are not in the docs: after the initial import you simply drop the `MlgCanView eq true` filter.
7. Media rules are opposite per platform. MLS Grid: you MUST keep your own copy; MediaURL is for downloading only ("DO NOT use these URLs on your website"); since 2026-09-08 URLs are signed, single-use, expire in 1 hour, and must not be stored; a second download attempt in the hour returns 429. Bridge: Media is inline on Property, stored on Bridge's CDN, and "you may link directly to the CDN". Trestle: separate Media resource, MediaURL publicly fetchable on a separate quota (excerpt); caching/hot-link rules UNCONFIRMED. Architecture consequence: always download to our own storage (Supabase Storage / CDN) so one pipeline fits all three.
8. Licence data fields gate display. MLS Grid `MlgCanUse` is an array (IDX, VOW, BO, PT); a record that lacks IDX must not be shown on a public site. Bridge exposes `FeedTypes` per record and a `FieldRules` resource, and the MLS controls whether you may replicate at all. Store these licence fields and filter on them at render time.
9. Onboarding is per MLS and at the MLS's discretion on all three; the platform fee to the vendor is small, the MLS fee varies. Trestle: roughly $85/month per IDX feed (CRMLS page). MLS Grid: no platform fee, vendor pays only each MLS's own licence fee (shown per MLS in the account's Pricing column; examples $175-$500/month). Bridge: no vendor platform fee found; MLS may charge.
10. Northern California mapping is mostly UNCONFIRMED. Only CRMLS is confirmed (Trestle, official CRMLS page). No California MLS appears anywhere in the MLS Grid documentation corpus I read. bridgeMLS, BAREIS, MetroList, SFAR, MLSListings: platform not established from public pages; ask each MLS directly (research files 01-03 cover those).
11. Beware the name clash: "Trestle IQ" (docs.trestleiq.com) is an unrelated phone/identity API with per-second and monthly limits. Do not mix its rate-limit page with Cotality Trestle.

## Facts

### A. RESO standard

| Fact | Source URL | Date read | Status |
|---|---|---|---|
| Web API Core 2.1.0 (RCP 39) ratified Dec 2023; depends on OData 4.0 or 4.01, TLS 1.2+, OAuth 2 (Bearer Token or Client Credentials) | https://raw.githubusercontent.com/RESOStandards/transport/main/proposals/web-api-core.md | 2026-10-27 | CONFIRMED |
| Core defines functionality "to provide both replication and live query support" (replication vs on-demand are the same API, differing in how you use it) | same | 2026-10-27 | CONFIRMED |
| Server-driven paging via `@odata.nextLink` is a MUST; a `$top=1` request must not return a nextLink | same | 2026-10-27 | CONFIRMED |
| `$top`: servers MAY respond with a page size different from the one requested; if no `$orderby`, service MUST impose a stable ordering | same | 2026-10-27 | CONFIRMED |
| Spec has sections for `$select`, `$top`, `$count`, `$skip`, `$orderby`, `$filter`, and `$expand` (`$expand` incl. `Property?$expand=Media` is a certified test, new in 2.1.0) | same | 2026-10-27 | CONFIRMED |
| `in` operator is tested only if the server advertises `OData-Version: 4.01` | same | 2026-10-27 | CONFIRMED |
| Standard resources: Property, Member, Office, Media, InternetTracking (at least one must be present for certification); DD page also names OpenHouse | same; https://raw.githubusercontent.com/RESOStandards/transport/main/proposals/data-dictionary.md | 2026-10-27 | CONFIRMED |
| Auth: RESO certifies only Bearer tokens and Client Credentials since Web API 1.0.2; OpenID Connect layer no longer supported in certification | web-api-core.md (above) | 2026-10-27 | CONFIRMED |
| Data Dictionary 2.0 (RCP 40) ratified Dec 2023; depends on Web API Core 2.0.0+; server data must match its advertised metadata (undeclared fields/enums fail testing) | https://raw.githubusercontent.com/RESOStandards/transport/main/proposals/data-dictionary.md | 2026-10-27 | CONFIRMED |
| DD 2.0 prefers `Edm.String` lookups (human-readable values, e.g. StandardStatus "Active Under Contract") over `Edm.EnumType`; Lookup resource carries values | data-dictionary.md and web-api-core.md (above) | 2026-10-27 | CONFIRMED |
| `ListingKey`: unique identifier from the immediate source, String, suggested max 255 | https://ddwiki.reso.org/display/DDW20/ListingKey+Field (via search excerpt) | 2026-10-27 | CONFIRMED (excerpt) |
| `PhotosChangeTimestamp`: system-generated timestamp of last change to a listing's photos | https://ddwiki.reso.org/display/DDW20/PhotosChangeTimestamp+Field (via search excerpt) | 2026-10-27 | CONFIRMED (excerpt) |
| Media resource DD 2.0 fields: MediaKey, MediaURL, MediaModificationTimestamp, ResourceRecordKey, ResourceName, Order (0 = primary photo), ImageSizeDescription (largest = "Largest") | https://dd.reso.org/DD2.0/Media/ | 2026-10-27 | CONFIRMED |
| `OriginatingSystemName` = originating record provider, usually the MLS | https://dd.reso.org/DD2.0/Media/ (search excerpt on the field) | 2026-10-27 | CONFIRMED (excerpt) |
| `ListingId`, `StandardStatus`, `ModificationTimestamp` (Property) definitions not read from DD 2.0 wiki; their use is shown in the platform docs below | n/a | 2026-10-27 | UNCONFIRMED against DD 2.0 wiki |
| RESO certification today: Web API Core, Data Dictionary 2.0, RESO Common Format endorsements; status levels Certified Legacy / Passed Current / Certified Current; certification free for RESO members | https://www.reso.org/certification/ | 2026-10-27 | CONFIRMED |
| The old Bronze/Silver/Gold/Platinum tiers are legacy (pre-Core); Bridge docs still say "RESO Platinum Certified to version 1.0.2" | https://www.reso.org/certification/ (search excerpt of DD cert page); https://bridgedataoutput.com/docs/platform/API/reso-web-api | 2026-10-27 | CONFIRMED (Bridge claim) / CONFIRMED (excerpt, tiers legacy) |
| reso.org certification page says "Web API Core 2.0.0" while the ratified spec on GitHub is 2.1.0; version labelling is inconsistent | reso.org/certification vs web-api-core.md | 2026-10-27 | CONFIRMED (inconsistency) |
| Providers diverge on field availability, paging defaults, rate limiting even when certified | https://hicronsoftware.com/blog/reso-web-api-a-technical-overview/ | 2026-10-27 | REPORTED |
| Replication pattern (RESO-level): initial full pull then incremental on `ModificationTimestamp`, store last successful sync time | same hicron article | 2026-10-27 | REPORTED |
| `MlgCanView` / `MlgCanUse` are MLS Grid fields, not RESO standard fields | https://docs.mlsgrid.com/llms-full.txt | 2026-10-27 | CONFIRMED |

### B. Bridge Interactive (Zillow) - bridgedataoutput.com

Source for every Bridge row unless noted: https://bridgedataoutput.com/docs/platform/API/reso-web-api (page is a JS app; text read via browser pane, 2026-10-27). Doc is also reproduced at /docs/platform/FAQ/faq. Endpoint list: https://bridgedataoutput.com/docs/explorer/reso-web-api.

| Fact | Source URL | Date read | Status |
|---|---|---|---|
| Base: `https://api.bridgedataoutput.com/api/v2/OData/{dataset_id}/{resource}`; HTTPS only; dataset code identifies the MLS (or a virtual dataset) | .../docs/platform/API/reso-web-api | 2026-10-27 | CONFIRMED |
| Resources: Property, Member, Office, OpenHouse, Lookup (+ `Property('{ListingKey}')` by key); Rooms/UnitTypes on some MLSs | .../docs/explorer/reso-web-api ; .../docs/platform/API/reso-web-api | 2026-10-27 | CONFIRMED |
| Auth: `Authorization: Bearer {token}` or `?access_token={server_token}` | .../docs/platform/API/reso-web-api | 2026-10-27 | CONFIRMED |
| Server token = bearer token for server-to-server (recommended); Browser token = browser-side calls, needs Referrer Domain set; tokens only work from the domains/IPs allowlisted in the dashboard (no wildcards) | same | 2026-10-27 | CONFIRMED |
| Client ID/Secret are for RETS; regenerating the Client Secret expires all Server and Browser tokens | same | 2026-10-27 | CONFIRMED |
| `$top` default 10, max 200 on-demand; `$skip` paging; paging beyond 10,000 listings requires the replication endpoint | same | 2026-10-27 | CONFIRMED |
| Replication endpoint `.../OData/{dataset}/Property/replication`: max `$top` 2,000; results oldest to newest; response carries a 'next' link (doc says "header of the response"); `$skip` and `$orderby` not available; only at the discretion of the authorising MLS; server-to-server only | same | 2026-10-27 | CONFIRMED |
| "BridgeModificationTimestamp is the best field to use for incremental updates"; `ModificationTimestamp` is ingested from the MLS and is "not a consistent proxy" for modifications in Bridge | same | 2026-10-27 | CONFIRMED |
| Rate limit: default 5,000 requests/hour per application, burst 1/15 of that per minute (334/min); no cap on total or concurrent requests; six `*-RateLimit-*` response headers; 429 on excess; higher limits on request | same | 2026-10-27 | CONFIRMED |
| Media is an object inline on the Property record, "typically the highest resolution media available from the MLS ... stored on our CDN. You may link directly to the CDN." `$unselect=Media` drops it | same | 2026-10-27 | CONFIRMED |
| `$expand` works (e.g. ListOffice, ListAgent); with `$select` you must also select the expanded field; not all query options work on expanded data | same | 2026-10-27 | CONFIRMED |
| Operators eq ne gt lt ge le and or not; functions any/all/geo.distance/geo.intersects/tolower/startswith/contains/date parts/now() | same | 2026-10-27 | CONFIRMED |
| `$metadata` (XML) per dataset shows fields/lookups the MLS granted; non-RESO fields are namespaced with a dataset prefix | same | 2026-10-27 | CONFIRMED |
| Combined feed types: each record has `FeedTypes`; path segment `/idx/` splits a combined feed (`.../OData/{dataset}/idx/Properties`); `FieldRules` resource shows which licence backs which field | same | 2026-10-27 | CONFIRMED |
| Virtual datasets: on-demand across several approved MLSs; Metadata and Replication endpoints NOT available for them | same | 2026-10-27 | CONFIRMED |
| Access: MLS-initiated invite; every dataset needs data-provider approval; MLS decides whether you may replicate; statuses Pending/Approved/Denied/Suspended/Revoked; auto-approved Test dataset | same | 2026-10-27 | CONFIRMED |
| Docs and RESO: "RESO Platinum Certified to version 1.0.2"; RESO Web API recommended over RETS and the native Bridge Web API | same | 2026-10-27 | CONFIRMED |
| Delete / off-market handling | n/a | 2026-10-27 | UNCONFIRMED (not in docs read) |
| Cost: platform free to vendor | Bridge docs mention "pay fees" only as something a data provider may require; no vendor price list found | 2026-10-27 | UNCONFIRMED |
| Webhooks for real-time change events exist | https://providers.apievangelist.com/providers/bridge-mls/ (search excerpt) | 2026-10-27 | REPORTED |
| `$top` max 200 via `maxpagesize` header (Metadata API spec mirror) | https://apis.io/apis/bridge-mls/bridge-mls-metadata-api/ (search excerpt; page itself 404) | 2026-10-27 | REPORTED (agrees with official 200) |

### C. Trestle (Cotality, formerly CoreLogic) - trestle-documentation.corelogic.com

The official docs host answered HTTP 403 / "Access denied, Error 16" to WebFetch, curl and the browser pane (bot protection). I did not try to bypass it. Rows marked "(excerpt)" are Trestle doc text quoted by the search tool.

| Fact | Source URL | Date read | Status |
|---|---|---|---|
| Base `https://api.cotality.com/trestle/odata/` (older docs: `api-prod.corelogic.com/trestle/odata/`); service document anonymous, `$metadata` and entity sets need Bearer | https://apis.io/rules/corelogic/corelogic-trestle-reso-web-api-rules/ ; https://www.reso.org/web-api-examples/mls/corelogic-trestle-generic/ | 2026-10-27 | REPORTED (ruleset) / CONFIRMED (RESO example page, old host) |
| Token: POST `https://api.cotality.com/trestle/oidc/connect/token`, form fields client_id, client_secret, grant_type=client_credentials, `scope=api` (WebAPI) or `scope=rets` (RETS); then `Authorization: Bearer` | https://trestle-documentation.corelogic.com/webapi.html ; https://trestle-documentation.corelogic.com/rets.html ; token URL also in the apis.io ruleset above | 2026-10-27 | CONFIRMED (excerpt) |
| Token lifetime 8 hours (2018 release note, may be stale) | https://trestle-documentation.corelogic.com/release_notes/Trestle%204.24%20EXT%20Release%20Notes.pdf | 2026-10-27 | REPORTED (old) |
| `$top=1000` is the maximum records per query; `$skip` paging shown (`$top=1000&$skip=3000`); `@odata.nextLink` can be used for the rest | https://trestle-documentation.corelogic.com/webapi.html ; https://trestle-documentation.corelogic.com/webapi-at-scale.html ; https://www.reso.org/web-api-examples/mls/corelogic-trestle-generic/ | 2026-10-27 | CONFIRMED (excerpt) + CONFIRMED (RESO example page for nextLink) |
| Quota: baseline 7,200 queries/hour, per-minute figure (excerpt cut after "180"); response headers `Minute-Quota-Limit`, `Hour-Quota-Limit`, `Hour-Quota-ResetTime`; excess returns 429; FAQ: if `Hour-Quota-Available` is non-zero you are hitting the per-minute cap | https://trestle-documentation.corelogic.com/webapi.html ; .../webapi-at-scale.html ; .../faq.html | 2026-10-27 | CONFIRMED (excerpt) for headers and 429; UNCONFIRMED for exact 180/min and 7,200/h (a second search did not reproduce them) |
| Quota guidance: pull 1,000/query, use `$expand`, throttle client side (leaky/token bucket); quota increase via support | https://trestle-documentation.corelogic.com/webapi-at-scale.html ; faq.html | 2026-10-27 | CONFIRMED (excerpt) |
| `Replication=true` query extension for "highly efficient" replication beyond 1,000,000 records | https://trestle-documentation.corelogic.com/webapi-at-scale.html (one search excerpt only); `Replication` listed as accepted Property parameter in apis.io ruleset | 2026-10-27 | UNCONFIRMED (one excerpt, not reproduced) |
| Incremental: track latest `ModificationTimestamp` received per resource (Property, OpenHouse, Rooms, Units, CustomProperty) | https://trestle-documentation.corelogic.com/web-api/at-scale/ (search excerpt) | 2026-10-27 | CONFIRMED (excerpt) |
| Deletes: incremental pulls do not report removed records; pull all keys for the resource and delete local records not in that list | same | 2026-10-27 | CONFIRMED (excerpt) |
| Key list queries are batched, up to 300,000 keys at a time (InKeyIndex) | https://trestle-documentation.corelogic.com/metadata-resource-Property.html (search excerpt) | 2026-10-27 | CONFIRMED (excerpt, loosely phrased) |
| Media: separate `Media` resource; filter by `ResourceRecordKey` = ListingKey; `MediaURL` direct link, publicly fetchable, governed by a separate quota from WebAPI calls | https://trestle-documentation.corelogic.com/webapi.html (search excerpt) | 2026-10-27 | CONFIRMED (excerpt) |
| Photo change detection: `PhotosChangeTimestamp` on Property; re-pull all Media rows for that listing when it changes (covers added/changed/deleted photos) | https://trestle-documentation.corelogic.com/web-api/at-scale/ (search excerpt) | 2026-10-27 | CONFIRMED (excerpt) |
| `$expand=Media` works (RESO example: `Property?$expand=Media`); check metadata NavigationProperty | https://www.reso.org/web-api-examples/mls/corelogic-trestle-generic/ | 2026-10-27 | CONFIRMED |
| Old MediaURL format retired May 2021 (returned 410); fix is re-pull Media row for a fresh URL (implies MediaURLs can change) | https://trestle-documentation.corelogic.com/notices/Trestle%20MediaURL%20Update%20May%202021.pdf (search excerpt) | 2026-10-27 | REPORTED (old notice) |
| Image resizing / size parameters on MediaURL | n/a; 2024 content patch lists `ImageSizeDescription` on Media | https://trestle-documentation.corelogic.com/release_notes/Trestle%20Content%20Patch%20Sept302024.pdf (search excerpt) | 2026-10-27 | UNCONFIRMED |
| Trestle products: Trestle RESO (Web API listing data, "under 2 minutes" refresh claim), MCP, Defender, Direct, Share; 105 MLS organisations; 1,250+ technology providers; RESO/MCP/Defender free to MLSs | https://www.cotality.com/real-estate/multiple-listing-enterprise-solutions/trestle | 2026-10-27 | CONFIRMED (vendor marketing claims) |
| WebAPI vs RETS: same OAuth flow, `scope=api` vs `scope=rets`; RETS is legacy | webapi.html / rets.html (excerpt) | 2026-10-27 | CONFIRMED (excerpt) |
| Onboarding: vendor needs a Trestle account (Technology Provider account), credentials tied to a product/feed type; MLS approval via data licence agreement; billing assessed to the Tech Provider | https://trestle-documentation.corelogic.com/support/faq/ (excerpt); https://members.hicentral.com/index.php/mls/mls-data | 2026-10-27 | CONFIRMED (excerpt) / REPORTED (HiCentral) |
| "Data access marketplace" wording | https://www.cotality.com/products/real-estate-data-marketplace exists; cotality Trestle page "doesn't describe a marketplace" | 2026-10-27 | UNCONFIRMED as a distinct vendor marketplace UI; the practical flow is MLS-approved licence request |

### D. MLS Grid - docs.mlsgrid.com

Source for every MLS Grid row unless noted: https://docs.mlsgrid.com/llms-full.txt (official full corpus) and https://docs.mlsgrid.com/api-documentation/api-version-2.0.md, both read 2026-10-27.

| Fact | Source URL | Date read | Status |
|---|---|---|---|
| Replication only: "We do not support real time data access at this time"; a stripped-down OData server limited to replication needs | llms-full.txt | 2026-10-27 | CONFIRMED |
| Base `https://api.mlsgrid.com/v2/` (demo `api-demo.mlsgrid.com/v2`); `$metadata` at `/v2/$metadata`; gzip responses | api-version-2.0.md | 2026-10-27 | CONFIRMED |
| Auth: `Authorization: Bearer` long-term OAuth-style token, generated after subscription + licensee + MLS approval; shown on the subscription's token tab; regenerate via support | docs.mlsgrid.com (home) ; llms-full.txt | 2026-10-27 | CONFIRMED |
| One endpoint for all MLSs; every request needs exactly one `OriginatingSystemName` in `$filter` (case-sensitive, usually lowercase e.g. `actris`) | api-version-2.0.md | 2026-10-27 | CONFIRMED |
| Resources: Property (expand Media, Rooms, UnitTypes), Member (Media), Office (Media), OpenHouse, Lookup | api-version-2.0.md | 2026-10-27 | CONFIRMED |
| Only a few fields are filterable (OriginatingSystemName, ModificationTimestamp, StandardStatus, PropertyType, ListingId, MlgCanView, ListOfficeMlsId); no `$select`/`$orderby` on expanded resources; max 5 `or` per query (use `in`) | llms-full.txt | 2026-10-27 | CONFIRMED |
| Page size: max 5,000 per request (error above), default 500; with `$expand` max 1,000; follow `@odata.nextLink` | api-version-2.0.md ; llms-full.txt | 2026-10-27 | CONFIRMED |
| Default order is `ModificationTimestamp`; replicate with `ModificationTimestamp gt <greatest value seen>`, even for records you do not store | api-version-2.0.md ; llms-full.txt | 2026-10-27 | CONFIRMED |
| Initial import filter `OriginatingSystemName eq 'x' and MlgCanView eq true`; afterwards drop the MlgCanView filter so removals arrive. (There is no separate "replication flag".) | api-version-2.0.md | 2026-10-27 | CONFIRMED |
| Deletes: `MlgCanView=false` means remove (or never save); causes include deleted listing, office withdrawing feed, status that bars IDX; false records vanish from the feed after 7 days; expanded resources have no flag, replace them from the parent | api-version-2.0.md ; llms-full.txt | 2026-10-27 | CONFIRMED |
| `MlgCanUse` array: IDX (public IDX display, CRM/transaction tools), VOW, BO (back office/analytics), PT (participant listings only); VOW-only or BO-only records cannot be used for IDX | api-version-2.0.md | 2026-10-27 | CONFIRMED |
| `ModificationTimestamp` = when MLS Grid updated it; `OriginatingSystemModificationTimestamp` = source MLS time; `PhotosChangeTimestamp` (Property/Member/Office) never changes without ModificationTimestamp changing; Media `MediaModificationTimestamp` new/changed means re-download the image | https://docs.mlsgrid.com/ ; llms-full.txt | 2026-10-27 | CONFIRMED |
| Local fields are prefixed per MLS; `ListingId` and other keys carry a prefix (e.g. MARIS moved to prefix MIS with a new OriginatingSystemName) | llms-full.txt | 2026-10-27 | CONFIRMED |
| Import: MLS Grid checks member MLSs "every minute" unless the MLS restricts it; import status per MLS visible in the account. No recommended consumer polling interval is stated | llms-full.txt | 2026-10-27 | CONFIRMED |
| Lookup resource: do not pull more than once a day | api-version-2.0.md | 2026-10-27 | CONFIRMED |
| Rate limits: 2 req/s, 7,200/hour, 40,000/24 h, 4 GB/hour; warning email at concerning activity; token suspended if limits exceeded within an hour; suspended token gets HTTP 429 with details; restored automatically; higher limits need advance contact | https://docs.mlsgrid.com/ ; llms-full.txt | 2026-10-27 | CONFIRMED |
| Media: "You must maintain your own copy of all media files"; MediaURL "DO NOT use these URLs on your website or in your application" | https://docs.mlsgrid.com/ | 2026-10-27 | CONFIRMED |
| Since 2026-09-08 Media served from `media.mlsgrid.com`: signed URL, single-use (second download within the hour, or re-requesting a URL, returns 429), expires 1 hour after generation, must not be stored or cached; S3 bucket-to-bucket transfer ended; CloudFront users must move to the MLS Grid CDN; a CDN option without single-use URLs can be requested | llms-full.txt (Media section + notice "Upcoming Changes to Media Delivery") | 2026-10-27 | CONFIRMED (doc text; not verified against live API) |
| Media download must send a `User-Agent` header equal to your access token | api-version-2.0.md | 2026-10-27 | CONFIRMED |
| Deleted media: if a MediaKey no longer appears, mark it deleted | api-version-2.0.md | 2026-10-27 | CONFIRMED |
| Licensing: one Master Data License Agreement for IDX, VOW and Back Office; vendor accepts it in the portal; MLS approves each vendor request at its discretion; any third-party contractor must also accept; an AI Use Addendum applies if you disclose AI use | https://mlsgrid.com/faq ; llms-full.txt (account setup guides) | 2026-10-27 | CONFIRMED |
| Fees: "You will only pay the license fee required by your MLS"; MLS Grid collects it for the MLS; per-MLS fee visible in the "Pricing" column of the data subscription page; no MLS Grid platform fee found | https://mlsgrid.com/faq ; llms-full.txt | 2026-10-27 | CONFIRMED (no platform fee: absence of evidence) |
| Example MLS fees on MLS Grid: NorthstarMLS $1,000 dev + $500 startup, then $125-$500/month by customer count; Heartland $100 setup + $175/month | https://northstarmls.com/?p=661 ; https://kcrar.com/kcrar-members/heartland-mls/data-feeds-and-vendor-inquiries/ (search excerpts) | 2026-10-27 | REPORTED |
| Participating MLS list | not in docs; "Login > MLS Import Status" only; no California MLS (BAREIS, MetroList, MLSListings, CRMLS, bridgeMLS, SFAR) appears anywhere in the docs corpus | llms-full.txt | 2026-10-27 | UNCONFIRMED (absence in docs, not a statement that none exist) |

### E. Costs and Northern California platform mapping

| Fact | Source URL | Date read | Status |
|---|---|---|---|
| CRMLS data feeds go through the Trestle platform; requester signs a data licensing agreement with CRMLS first | https://go.crmls.org/?p=43381 | 2026-10-27 | CONFIRMED |
| CRMLS: brokers get two feeds free; further Trestle fees "$85 per month for an IDX data feed and $25 for a Broker feed"; IDX vendor request fee $7 per website URL beyond the first two, plus Trestle's $85/month | https://go.crmls.org/?p=43381 | 2026-10-27 | CONFIRMED (page undated) |
| Trestle vendor price elsewhere: Miami $85/month per vendor feed; Miami brokers $30 own data / $100 MLS-wide | https://www.miamirealtors.com/mls/webapi/pricing/ | 2026-10-27 | CONFIRMED (that MLS only) |
| Trestle price anecdotes: $75/feed/month (2017 Inman), "plans starting at $100/month" (HiCentral) | https://www.inman.com/2017/03/24/corelogics-trestle-now-open-for-business-will-tech-vendors-bite/ ; https://members.hicentral.com/index.php/mls/mls-data | 2026-10-27 | REPORTED (stale/other MLS) |
| Cotality public Trestle pricing page | none found | 2026-10-27 | UNCONFIRMED |
| MLSListings: claims RESO server + Data Dictionary certification; page names no distribution platform | https://www.mlslistings.com/about-us/reso-certifications/ | 2026-10-27 | CONFIRMED (that it names none) |
| BAREIS site returned 403 to fetch; MetroList own pages not found; MetroList reportedly offers direct IDX feed or approved vendor route | https://web4realty.com/mls/metrolist-sacramento-metrolist-idx/ (search excerpt) | 2026-10-27 | UNCONFIRMED / REPORTED |
| bridgeMLS, SFAR platform | no source found | 2026-10-27 | UNCONFIRMED |
| Unlock MLS (a Texas MLS) offers MLS Grid, Trestle and Bridge as delivery options: shows an MLS can offer more than one platform, so "which platform" must be asked per MLS | https://ABoR.com/unlockmls/data-licensing (search excerpt) | 2026-10-27 | REPORTED |

## Sync recipe per platform

Common to all: one connector per (platform, MLS). Persist per source+resource: `high_water_mark` (timestamp), `last_full_key_sweep_at`, request counters. Upsert on (source, ListingKey). Keep licence columns (`MlgCanUse`, `FeedTypes`, `InternetEntireListingDisplayYN`/`InternetAddressDisplayYN` where present) and filter at render time. Overlap each incremental window by a safety margin (re-request from `high_water - few minutes`) because timestamps can tie across pages; upsert makes that idempotent. All timestamps in ISO 8601 UTC. Treat `$top` as a hint (RESO allows smaller pages) and always follow `@odata.nextLink`.

### Bridge Interactive
- Auth: Server token as `Authorization: Bearer`; keep it server-side only (token is domain/IP allowlisted; Browser token needs Referrer Domain and must not be used for sync). The static token has no refresh flow; Client Secret rotation invalidates it.
- Base: `https://api.bridgedataoutput.com/api/v2/OData/{dataset_id}/Property` (also `Member`, `Office`, `OpenHouse`, `Lookup`, `$metadata`). Dataset ID is MLS-specific and only known after approval (list via `/OData/DataSystem`).
- Page size: on-demand `$top=200`; skip paging limited to 10,000 records; replication endpoint `.../Property/replication` with `$top=2000` and its 'next' link (needs MLS permission to replicate; `$skip`/`$orderby` unavailable there).
- Initial pull: replication endpoint if granted (oldest to newest, follow next link to the end); else partition by filters (e.g. PropertyType, status, price bands) so each partition stays under 10,000 and page with `$skip` plus `$orderby`.
- Incremental: `$filter=BridgeModificationTimestamp gt <last>` (Bridge's recommended field); continue the replication next link at regular intervals. Verify on a real feed that BridgeModificationTimestamp is filterable on the Property endpoint (docs name it for the replication use; UNCONFIRMED for plain `$filter`).
- Cadence: no maximum staleness is published. Budget: 5,000 requests/hour and 334/minute per application shared across all that application's datasets. A 5-minute poll per MLS is about 12 requests/hour for one page each: fine.
- Delete / off-market: UNCONFIRMED in docs. Plan: (a) treat `StandardStatus` changes (Closed/Expired/Withdrawn/Canceled) as the normal off-market path; (b) a nightly or weekly key sweep (`$select=ListingKey` paged) and tombstone anything absent; (c) confirm with the MLS or a live test whether hard-removed records ever appear again.
- Media: read the inline `Media` array (MediaURL, Order, etc.). Docs allow linking to Bridge's CDN directly, but download to our own storage anyway for one pipeline, resizing, and independence from a platform change. Use `$unselect=Media` on non-media syncs to cut payload.
- Licence: respect `FeedTypes` and `FieldRules`; use the `/idx/` path segment if the approval is combined.

### Trestle (Cotality)
- Auth: POST form to `https://api.cotality.com/trestle/oidc/connect/token` with client_id, client_secret, `grant_type=client_credentials`, `scope=api`; cache the token and refresh before expiry (8 h in an old note; read `expires_in` instead of hardcoding). Credentials are per product/feed.
- Base: `https://api.cotality.com/trestle/odata/Property` (also `Member`, `Office`, `OpenHouse`, `Media`, `Lookup`, `DataSystem`, `$metadata`; older host `api-prod.corelogic.com`).
- Page size: `$top=1000` max; use `@odata.nextLink`; `$skip` also documented.
- Initial pull: partition and page at `$top=1000`; the `Replication=true` extension is mentioned in one excerpt and listed as an accepted parameter by a third-party ruleset: test it on the first real credential before relying on it.
- Incremental: `$filter=ModificationTimestamp gt <last>` per resource (Property, OpenHouse, Rooms, Units); store the latest value received.
- Cadence: not published. Budget against the quota headers (`Minute-Quota-Limit`, `Hour-Quota-Limit`, `Hour-Quota-ResetTime`); sample figures 7,200/hour and a per-minute cap, to be read from the live headers, not hardcoded. Throttle client side; 429 means back off.
- Delete detection: incremental will not tell you. Run a key-reconciliation sweep (`$select=ListingKey`, paged at 1,000, or batched key queries) at least daily, delete local keys missing from the remote set. Guard against partial sweeps (abort if the sweep is incomplete or the count collapses suspiciously).
- Media: `Media` resource filtered by `ResourceRecordKey eq '<ListingKey>'` (or `$expand=Media` on Property); re-pull a listing's Media when `PhotosChangeTimestamp` changes; MediaURL is directly fetchable and on a separate quota. Download to our own storage; do not store MediaURL as the long-term source (URLs have changed format before).
- Onboarding: Trestle account (as Technology Provider or via the broker), then a data licence request that the MLS approves (CRMLS: licence agreement first).

### MLS Grid
- Auth: `Authorization: Bearer <long-term token>` from the subscription's token tab; same token as `User-Agent` on Media downloads.
- Base: `https://api.mlsgrid.com/v2/Property` (and `Member`, `Office`, `OpenHouse`, `Lookup`); demo `https://api-demo.mlsgrid.com/v2`.
- Page size: `$top=5000` (500 default; 1,000 max with `$expand`); follow `@odata.nextLink`.
- Initial import: `$filter=OriginatingSystemName eq '<mls>' and MlgCanView eq true` (one MLS per request), `$expand=Media` at `$top<=1000`, or fetch Media separately.
- Incremental: `$filter=OriginatingSystemName eq '<mls>' and ModificationTimestamp gt <greatest seen>` with NO `MlgCanView` filter; replace the local record (and its Media set) on every changed record.
- Cadence: no consumer cadence is documented; the source updates every minute. Choose by budget: 7,200 requests/hour, 2 req/s, 40,000/day, 4 GB/hour, shared by the whole token. Never poll `Lookup` more than daily.
- Deletes: `MlgCanView=false` means delete locally; the false marker disappears from the feed after 7 days, so a gap longer than 7 days requires a full resync (initial-import filter plus a key sweep).
- Media: on a new/changed `MediaModificationTimestamp` (or `PhotosChangeTimestamp`), fetch the URL and download immediately, once, within the hour; keep our own copy; never put MediaURL on the website; never retry a used URL (429). Mark media absent from the parent as deleted.
- Licence: honour `MlgCanUse` (IDX needed for public display); the MLS Grid Master Data License Agreement and AI Use Addendum apply.

## Could not confirm

- Trestle official docs unreadable: `trestle-documentation.corelogic.com` returned 403 / "Access denied, Error 16" via WebFetch, curl and the browser pane. Two approaches failed, so I stopped (BLOCKED - bot protection - what unblocks it: the owner opening the pages in a normal browser and pasting the text, or a Trestle account's own copy). Every Trestle "(excerpt)" row is search-tool quoting of those pages and could be stale.
- Trestle exact default quota numbers (excerpt said 7,200/hour, per-minute cut off at "180"), `Replication=true` behaviour, `$skiptoken` vs `$skip` in nextLink, image resizing, any MediaURL caching or hot-link rule, current vendor price (no Cotality price page found).
- Bridge: delete/off-market behaviour, whether `BridgeModificationTimestamp` is filterable on the plain Property endpoint, any caching limits on the Bridge CDN images, vendor fees, any maximum staleness. Bridge docs are a JS app; text was read through the browser pane, but the "Zillow Group Data" tail of the page was truncated (not relevant).
- MLS Grid: nothing stated on staleness; participating MLS list not in docs (login only); whether any Northern California MLS is on MLS Grid.
- Northern California platform per MLS: only CRMLS confirmed (Trestle). bridgeMLS, BAREIS (site 403), MetroList, SFAR, MLSListings: no public statement found; MLSListings page names no platform.
- RESO: Property-level definitions of ListingId, StandardStatus and ModificationTimestamp in DD 2.0 not read directly; `MediaModificationTimestamp` is in DD 2.0 Media (read); exact RESO text on replication vs on-demand "endorsement" beyond Core wording not read.
- No legal reading of any licence agreement (IDX display rules, photo retention, "do not cache beyond N days" rules). No platform-level N-day cache rule was found in any of the three; the MLS's own IDX rules may still impose one: ask each MLS.

## Sources

Official / primary (read directly 2026-10-27):
- RESO Web API Core 2.1.0 spec: https://raw.githubusercontent.com/RESOStandards/transport/main/proposals/web-api-core.md
- RESO Data Dictionary 2.0 endorsement: https://raw.githubusercontent.com/RESOStandards/transport/main/proposals/data-dictionary.md
- RESO DD 2.0 Media: https://dd.reso.org/DD2.0/Media/
- RESO certification: https://www.reso.org/certification/
- Bridge platform docs: https://bridgedataoutput.com/docs/platform/API/reso-web-api ; https://bridgedataoutput.com/docs/platform/FAQ/faq ; https://bridgedataoutput.com/docs/explorer/reso-web-api
- MLS Grid docs: https://docs.mlsgrid.com/ ; https://docs.mlsgrid.com/api-documentation/api-version-2.0.md ; https://docs.mlsgrid.com/llms-full.txt ; https://mlsgrid.com/faq ; https://mlsgrid.com/resources
- Cotality Trestle product page: https://www.cotality.com/real-estate/multiple-listing-enterprise-solutions/trestle
- CRMLS: https://go.crmls.org/?p=43381 ; https://go.crmls.org/
- MLSListings: https://www.mlslistings.com/about-us/reso-certifications/
- Miami MLS Trestle pricing: https://www.miamirealtors.com/mls/webapi/pricing/
- RESO Trestle example: https://www.reso.org/web-api-examples/mls/corelogic-trestle-generic/

Trestle official docs (unreadable directly; known only via search excerpts): https://trestle-documentation.corelogic.com/webapi.html ; /webapi-at-scale.html ; /web-api/at-scale/ ; /faq.html ; /support/faq/ ; /rets.html ; /metadata-resource-Property.html ; release notes and notices PDFs.

Third party / reported: https://apis.io/rules/corelogic/corelogic-trestle-reso-web-api-rules/ ; https://hicronsoftware.com/blog/reso-web-api-a-technical-overview/ ; https://providers.apievangelist.com/providers/bridge-mls/ ; https://members.hicentral.com/index.php/mls/mls-data ; https://www.inman.com/2017/03/24/corelogics-trestle-now-open-for-business-will-tech-vendors-bite/ ; https://northstarmls.com/?p=661 ; https://kcrar.com/kcrar-members/heartland-mls/data-feeds-and-vendor-inquiries/ ; https://ABoR.com/unlockmls/data-licensing ; https://web4realty.com/mls/metrolist-sacramento-metrolist-idx/ ; https://ddwiki.reso.org/display/DDW20/ListingKey+Field ; https://ddwiki.reso.org/display/DDW20/PhotosChangeTimestamp+Field.

Not used (name clash): https://docs.trestleiq.com/guides/rate-limits (Trestle IQ, unrelated product).
