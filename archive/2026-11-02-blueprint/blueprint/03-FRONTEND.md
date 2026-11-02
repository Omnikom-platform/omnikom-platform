# 03 Front end

Two front ends: **A** the website factory (turns published rows into a client's static site) and **B** the dashboard app.
Both read the same site contract (`contracts/`).

## A. Website factory

### A1. Inputs
| Input | Comes from | Example (ELEV8) |
|---|---|---|
| Site contract (resolved) | `contracts/from-plan.mjs` from the approved plan + `entities.json` | `contracts/examples/elev8/contract.json` (42 pages, 14 page types) |
| Published rows | `export-published` (one workspace) | pages, listings, cities, team, notices... |
| Design package | approved design, turned into partials | `E:\Alex Sevilla\draft-site\design\variants\v4.html` + the lab sections |
| Site settings | `sites` row | deploy target, preview host, domain, live or preview |

### A2. Design package (per site, in the platform repo: `sites/<slug>/design/`)
```
tokens.css            colours, type scale, spacing, radii (from the approved design; no values invented)
base.css              layout, header, footer, utilities
sections/<section-id>.mjs   one partial per section id used by the site's page types
item/<collection>.mjs       the item page of a routed collection (e.g. listing detail, article)
shell.mjs             <head> (title, meta, canonical, JSON-LD @graph, preload LCP image), header, footer
motion.js             transform/opacity only (owner rule), respects prefers-reduced-motion
```
A partial is a plain function, no template engine and no dependency:
`export default function render({ section, data, feed, form, ctx }) { return html`...` }` where `html` escapes every
interpolated value unless it is marked rich text that already passed the sanitiser. `data` = the section's fields from the page
row, `feed` = rows placed into the section by `place()` (already passed through `publicData()`, so internal fields and a hidden
sold price never reach the template), `form` = the form definition, `ctx` = site settings, page, bound row.
**The design is never changed silently** (owner rule): partials are produced from the approved design file and checked against it
by a visual-equivalence screenshot diff (A6).

### A3. Build steps (`factory/build.mjs`, Node 20+, no network except Cloudflare deploy)
1. Load export: contract + rows + media list. Re-validate every row in publish mode (defence in depth); any error stops the build.
2. `place(contract, rows)` (`contracts/place.mjs`) -> sections per page, item pages, sitemap, schema.
3. Render every contract page (`pages` + its page type's sections) and every item page.
4. Launch layer (proven on Rainmaker, `E:\Rainmaker\site-src\build.mjs`): WebP + phone sizes for every referenced image, the phone
   hero as its own small preloaded file, woff2 subsets, hashed asset names with year-long cache, `_headers` (one `/*` block for clarity; on Workers static assets matching rules merge, so the Pages-era "second block replaces the
   first" lesson does not apply; responses from the Worker script, i.e. `/api/lead`, set their own headers in code),
   `_redirects` (from the `redirects` collection), root `/404.html` with root-absolute paths, `robots.txt` (noindex + Disallow on
   previews; named AI crawlers allowed on live), `sitemap.xml` (honest lastmod from version dates), `llms.txt` (optional extra).
5. Form endpoint: the site Worker serves `/api/lead`, forwards to `capture-lead` with the site id; forms post with
   `method="post"`; on a preview host forms never fake success.
6. Gates (A5). 7. Deploy (Worker with static assets) only if every gate passed. 8. Smoke test on the deployed URL.

### A4. Item pages and placement (ELEV8)
Listing detail `/listings/<slug>/`: gallery, price, beds, baths, sqft, lot, year, description, map pin, open houses, listing agent,
"Ask about this home" form, RealEstateListing JSON-LD; sold listings stay, move to "Recently sold" feeds (4 newest per place) and
show the sold price only when ticked. City guides list the city's own listings, the home finder preset to the city, and a button
to the IDX search (`settings.homeSearchUrl`). No MLS data is copied (LISTINGS-DECISION).

### A5. Gates (every build; a failure deploys nothing)
| Gate | Tool (exists) | Pass rule |
|---|---|---|
| SEO launch gate GT-001..013 | `skills/programmatic-enterprise-web-performance/scripts/gate.mjs` (strict) | 13/13 on the built site; previews run it with the noindex exception |
| Render gate | `render-gate.mjs` / wf-shots pattern | 0 console errors, 0 uncaught exceptions, no horizontal overflow, no never-settling animation, at 1536x730, 390x844, 360x740 |
| Accessibility | axe-core in headless Chrome | 0 violations |
| Media | `E:\Rainmaker\tests\media.e2e.mjs` pattern | no collapsed (0x0) images, every image has alt |
| Forms | `forms.e2e` pattern | every form posts to `/api/lead`, consent text present, preview never fakes success |
| Live guard | `deploy-live.mjs` pattern | live deploy refused if: noindex present, any placeholder text, draft banner, missing form backend |
| Programmatic quality | plan's `programmatic.json` gate | >= 1,000 words non-template text, <= 40% similar to sibling pages, >= 5 sourced local facts |
| Visual equivalence (migrations only) | screenshot diff vs. the approved design / old site | per-section difference under the set threshold (VTV, Rainmaker moves) |

### A6. Visual equivalence for moving VTV and Rainmaker
Before: screenshots of the current preview at the 3 sizes per page. After: same pages built from rows. Pass = no section differs
beyond the threshold (set in W4.1 after a calibration run; pixel diff with anti-aliasing tolerance). VTV stays front end only
until its blueprint sign-off (its CLAUDE.md rule 1): its move means "renders from content files", not "connected to the database".

## B. Dashboard app

### B1. Stack (decision with reasons)
| Choice | Why | Rejected |
|---|---|---|
| React 18 + TypeScript + Vite, static SPA | Security lives in Postgres (RLS + functions), so no server framework is needed; one static bundle on a Worker; fast builds | Next.js / Remix SSR: a server to own and patch (2026 framework RCEs), no benefit when data access is RLS-checked |
| TanStack Router (typed routes) + TanStack Query (cache, retries) | type-safe params like `/w/$workspace/c/$collection/$id`; cache per workspace key | Redux: unneeded global state |
| supabase-js v2 | auth, RLS reads, storage signed uploads, function calls | hand-written REST |
| `contracts/validate.mjs` imported as is | the exact rules the server runs, instant feedback | duplicate rules in Zod (drift) |
| Forms: React Hook Form, widgets generated from field types | one widget per type, no per-collection code | hand-built forms per collection |
| UI kit: Radix primitives + own tokens (CSS variables) | accessible primitives, our look; no component library lock-in | MUI / Ant: heavy, generic look |
| Tests: Vitest (units), Playwright (flows, run in CI) | flows like "agent cannot see another agent's listing" run against staging | |
Every dependency: lockfile, pinned versions, 7-day rule and the never-install list in `~/.claude/reference/supply-chain-2026-10.md`.

### B2. Routes
```
/login  /invite/:token  /reset
/w                                   workspace picker (more than one)
/w/:ws                               overview
/w/:ws/pages                         page list (grouped by page type)
/w/:ws/pages/:pageId                 page editor (sections)
/w/:ws/c/:collection                 collection list (generated)
/w/:ws/c/:collection/new | /:id      item editor (generated)
/w/:ws/c/:collection/:id/history     versions, compare, restore
/w/:ws/media                         media library
/w/:ws/leads  /w/:ws/leads/:id       lead inbox, lead detail
/w/:ws/visibility                    search + AI visibility (metrics_snapshots)
/w/:ws/publish                       publish centre (drafts waiting, jobs, gate reports)
/w/:ws/settings/{business,team,logins,integrations,site}
/admin  /admin/workspaces/:ws  /admin/signoffs  /admin/jobs  /admin/audit      staff only
```
The collection menu and every list/editor screen come from the workspace's active resolved contract: no route or screen is written
per industry. `contracts/screens.mjs` is the reference for what each generated screen contains (see `04-DASHBOARD.md`).

### B3. State and data
- Server state only (TanStack Query), keyed by `[workspace, resource, id]`; invalidated by the save/publish responses.
- Drafts autosave to the server every 10 s of idle typing (each save is a version; the version list collapses consecutive
  autosaves by the same person within 10 minutes in the UI, not in the data).
- Optimistic UI only for lead status and notes; content edits wait for the server result (validation messages come back with
  field paths and codes, shown next to the field in plain words).
- Realtime (Supabase Realtime) for publish job state and new leads.

### B4. Field widgets (one per contract field type)
text/richtext (max shown as a counter; richtext = headings, bold, italic, links, lists; pasted HTML cleaned), slug (auto from the
title, editable until first publish, then locked with a redirect offer), number, money, boolean, date, datetime, enum (select or
segmented if <= 4 options), email, phone, url, image (upload, crop to the field's aspect if set, alt text required with a
suggestion, rights tick), gallery (drag order, cover = first, bulk upload), file, reference (search picker over the referenced
collection), address (autocomplete -> city + map pin; provider decided in W3.3), geo, list (repeatable rows), group, seo (live
search-result preview with length bars), sections (page editor). Locked fields render read-only with the reason and "Ask Omnikom
to change this". Sourced fields add source URL + date inputs.

### B5. Design system (dashboard)
Plain, calm, app-like on the phone (owner bar): left rail on laptop, bottom bar on phone, one primary action per screen, cards with
>= 28 px inner padding, Poppins 600 headings with a neutral body face, no uppercase micro-labels, no pills/dash labels/icon circles
(owner's "AI slop" list, `planning/CONTEXT.md`). Tokens in `apps/dashboard/src/styles/tokens.css`; dark mode later.

### B6. Per-industry screens
Generated, not designed per industry. Proof that the generator covers every industry: `contracts/industry-run/screens/*.md`
(15 industries) and `contracts/examples/{elev8,rainmaker,vtv}/screens.md` (3 real sites).
