# The content contract

Status 2026-10-28: **built and proven on paper and on real site data; NOT committed, waiting for the owner's approval.**
Step 1 of DECISIONS 13. The one contract the website factory (build) and the dashboard (edit) share (ANALYSIS 3.3, 7).

## In one paragraph
Every client site gets a **site contract**: a JSON file generated from its approved SEO plan. It says which pages exist and of
what type, what each page type's sections hold, which collections the client edits (listings, products, services...), which
fields are required or locked, which forms collect leads, and **placement rules** (where each published item appears). The
content itself lives in database rows (DECISIONS 6) checked against the contract on every save and publish. The dashboard screens
are generated from the same file. Nothing is written per industry (DECISIONS 3): collections come from the plan, their fields
from a library keyed by schema.org type.

## Files
| File | What it is |
|---|---|
| `core.json` | The shared core every site has: business details (one form), pages, articles, team, reviews, Q&A, legal/compliance text, photos, redirects, lead inbox |
| `types.json` | Field packs by schema.org type (Place, RealEstateListing, Service, Product, FinancialProduct, Offer, Event, Course, CaseStudy, BeforeAfter). A plan names the type, the generator copies the pack |
| `from-plan.mjs` | Plan + entity declaration -> site contract. Validates what it writes |
| `validate.mjs` | `validateContract` (is the contract well formed) and `validateItem` (is one row valid, as draft or for publish). CLI: `node validate.mjs <contract.json>` |
| `store.mjs` | Reference model of how rows behave: versions, draft/publish, rollback, locked fields, member-owns-own, the workspace wall. **The spec the Supabase layer (step 3) must reproduce** |
| `place.mjs` | Publish-time placement: published rows -> page sections, item pages, sitemap, page schema |
| `screens.mjs` | Dashboard screens from the contract: `node screens.mjs <contract.json> --out screens.md` |
| `test/run.mjs` | 114 checks on a synthetic fixture ("Demo Homes"); `test/mutate.mjs` breaks each rule and requires the tests to go red |
| `examples/elev8/` | ELEV8: entity declaration, contract generated from its **approved plan**, screens, mapping |
| `examples/rainmaker/` | Rainmaker: same, plus `check.mjs` run against its real pages (read only) |
| `examples/vtv/` | VTV: same, plus `adapter.mjs` run against its real `data.json` (read only); front end only (its project rule) |
| `industry-run/` | The same procedure on 15 industries: `RESULTS.md`, one contract and one screens file each |

## The site contract
```
contractVersion 1, core 1, site { workspace, industry, generatedFrom { plan, sitemapSha256, ... } }
collections  { id: { label, kind collection|singleton|inbox, type, schemaType, route "/listings/{slug}/", titleField,
                     statusField, access { member own|all|none }, ownerField, onDelete, fields } }   (core ones: "extend": true, add fields only)
pageTypes    { id: { label, bind <collection>, schema [...], sections [ { id, kind fields|feed|form|notice, ... } ] } }
pages        [ { path, type, bind <slug> } ]        from the approved plan; the client cannot add or move pages
forms        { id: { label, fields, consent { notice <slug> }, crm { formField: "OmniSuite field" } } }
placements   [ { id, collection, when { field: [values] }, to { page | pageType (+ match) | sitemap | schema, section }, sort, limit } ]
clientWording [ { where, status "[client to confirm]", note } ]   wording that goes into the client review email
seeds        places / items the plan names (e.g. the 10 ELEV8 cities)
```
- **Field types:** text, richtext, slug, number, money, boolean, date, datetime, enum, email, phone, url, image, gallery, file,
  reference (`to`, `multiple`), address, geo, list (`of`), group (`of`, or `open`), seo, sections.
- **Field rules:** `required` (enforced at publish; drafts may be incomplete), `max`/`min`, `options`, `locked { reason }`,
  `internal` (never on the site), `sourced` (value must be `{ value, source, date }`: client-facing facts carry their source),
  `media { minWidth, rightsConfirm }`, `visibleWhen { field: [values] }` (shown to visitors only then, e.g. a sold price only
  when "show sold price" is ticked; `place.mjs publicData` applies it and drops internal fields).
- **Section kinds:** `fields` (the client edits them), `feed` (fills itself from a collection through placements), `form`,
  `notice` (a locked legal text).
- **Bound pages:** a page type with `bind` shows one row of that collection (ELEV8 city guides bound to a city; Rainmaker product
  guides bound to a product). The plan owns the URL, the row owns the facts.
- **Placement:** "a listing's area puts it on that area's page" is `to { pageType, section, match: "area" }`; status rules are
  `when { status: [...] }`. The generator **derives** the common ones: FAQ feeds, "an item that references the page's place goes
  on that page", and sitemap + schema for every collection with public pages.

## How rows behave (store.mjs, the spec for step 3)
- Every row has a `workspace`, taken from the login; a different value in the form is refused (S-WORKSPACE). Another workspace's
  row is "not found" for read, edit and publish (S-NOT-FOUND).
- Save = new version, append-only; the site does not change until Publish. Publish runs the publish checks and points the row at
  that version. Rollback = a new version copying an old one. History lists who and when.
- Roles: **owner** (all of the workspace), **member** (only where the collection says; `own` = rows whose owner field is them;
  the owner field is filled from the login), **staff** (Omnikom; everything, logged).
- **Locked fields:** owner/member edits that change a locked value are refused (S-LOCKED); staff need a recorded `signOff
  { by, ref }` (S-SIGNOFF). Comparison is by whole field value.
- A build reads only that workspace's **published** versions (`published(workspace)`). Deleting a listing that has a page adds a
  301 to its area's guide (`onDelete`).
- Leads are an inbox: no publish (S-KIND); they keep the exact consent text shown when sent.

Mapping to Supabase (proposal for step 3, not built): `content_rows(id, workspace_id, collection, published_version)`,
`content_versions(row_id, n, data jsonb, by, at, sign_off)`, `site_contracts(workspace_id, version, contract jsonb)`; RLS on
workspace membership + role; `validateItem` runs in the save/publish functions; locked-field and own-only checks run as
database checks so the app cannot skip them.

## Rule codes (each has a test that watches it fail)
Contract: C-SHAPE C-CORE C-KIND C-FIELDS C-FIELD-TYPE C-ENUM C-REF C-LOCK C-RANGE C-MEDIA C-TITLE C-ROUTE C-STATUS C-ACCESS C-OWNER
C-ONDELETE C-BIND C-SECTION C-FEED C-FORM-REF C-NOTICE C-PAGE-TYPE C-PATH C-PAGE-BIND C-CONSENT C-CRM C-PLACE-COLL C-PLACE-WHEN
C-PLACE-TARGET C-PLACE-SECTION C-PLACE-MATCH C-PLACE-ROUTE C-FEED-ORPHAN C-SITEMAP C-VISIBLE C-WORDING.
Rows: I-REQUIRED I-TYPE I-ENUM I-MAX I-MIN I-SLUG I-ALT I-MEDIA-SIZE I-RIGHTS I-EXIF I-SOURCE I-PLACEHOLDER I-UNKNOWN I-REF I-COLLECTION.
Store: S-WORKSPACE S-NOT-FOUND S-COLLECTION S-ROLE S-OWN-ONLY S-SINGLETON S-LOCKED S-SIGNOFF S-INVALID S-PUBLISH-INVALID S-KIND.
The message text of each is in the source next to the code.

## Run it
```
node contracts/test/run.mjs          # 114 checks, exit 1 on any failure
node contracts/test/mutate.mjs       # 73 broken copies (every rule off + 11 behaviour breaks); all must be caught
node contracts/industry-run/run.mjs  # 15 industries
node contracts/from-plan.mjs --plan "E:/Alex Sevilla/site-checks/elev8ca.com/.pewp/approved" --entities contracts/examples/elev8/entities.json --out contracts/examples/elev8/contract.json
node contracts/examples/rainmaker/check.mjs
node contracts/examples/vtv/adapter.mjs
```

## What was proven (2026-10-28, outputs pasted from the runs)
- Tests: `114 passed, 0 failed`. Mutants: `73 mutants, 73 caught, 0 survived; 0 codes untested`; every mutant was caught by a
  failing assertion, none by a crash.
- **ELEV8**, generated from its approved plan: `VALID ... 12 collections (4 site), 14 page types, 42 pages, 3 forms, 24
  placements` (42 = the plan's 31 + 10 of the 18 kept live pages + the `/blog` articles index; the other 8 kept pages are agent
  profiles, now team item pages at their live addresses). Listings rules from LISTINGS-DECISION are placements: active -> home "Our listings", city guide, "Realtor in
  <city>"; sold -> "Recently sold" on home, city guide, "Sell in <city>" (4 each, newest first; sold price only when ticked); delete -> 301
  to the city guide. Four wordings are listed for the client review email (budget ranges, closing-form topics, consent, search address).
- **Rainmaker** (real pages, read only): `source pages 11; mapped 11`; 3/3 product pages carry a product disclosure block (each
  becomes a locked notice the product requires); 11 fixed-text sections on the disclosures page -> notices rows; lead forms 3 on 2
  pages = 3 form sections. Found by the check: the contact page has two forms (first declaration had one; fixed, and the check was
  watched failing on the old one). 2 page descriptions are over 160 characters (contact, insurance-disclosures).
- **VTV** (real `data.json`, read only): contract `VALID`; its 81 sitemap URLs = 22 pages + 28 listing pages + 31 articles, and the
  contract's build would produce all 81 (`would NOT produce: 0`). As drafts: listings 28/28, reviews 6/6 clean; neighborhoods 0/11
  (126 census facts carry no source + date), articles 25/31 (6 SEO titles over 60 characters, 2 excerpts over 200). For publish,
  what is missing is real: reviews need a date and the reviewer's permission; 414 of 442 listing photos have no alt text; photo
  rights ticks and EXIF stripping come from the upload step that does not exist yet.
- **15 industries:** `15/15 PASS` (paper plans; see `industry-run/RESULTS.md`). Every OmniSuite niche's website-askable custom
  fields are fed by that industry's lead form. Watched failing: photos without alt text -> red; a CRM field the niche lacks -> red.

## Open (not proven, not built)
1. **The SEO plan does not yet declare entities.** The plan gives pages, places, schema types; the collections, design sections and
   business placement rules come from `entities.json` written per site. Next: the skill's `plan-site` stage writes `entities.json`.
2. **Database (step 3):** `store.mjs` is an in-memory model. RLS, the tables above, storage-prefix rules and the four tests of
   TENANCY-AND-PUBLISHING 4 run against real Supabase are NOT DONE.
3. **Upload pipeline:** width, EXIF stripping and the rights tick are required at publish but nothing sets them yet.
4. **Interactive tools** (Rainmaker's coverage estimator, VTV's mortgage calculator) are code; only their text is content. No
   "widget" section kind yet.
5. **Locked values inside lists/sections** are compared at whole-field level, not per row.
6. **ELEV8:** answered 2026-10-28 by the lead session (Recently sold placement, wording list, `/blog`). `/blog` is declared in
   `examples/elev8/entities.json`; it still has to be added to the approved plan itself (the ELEV8 project, not this repo).
7. VTV is front end only until its blueprint sign-off; its adapter only reads.
