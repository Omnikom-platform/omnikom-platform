# SOP: the Omnikom design engine (client website design, from references to a gated build)

Why it exists (owner, 2026-10-27): "create the engine that will be used for omnikom platform, the SOP and code ... I wanna build a really
good product and I know it will cost us to make something solid but it becomes free mostly going forward." First run: ELEV8 Real Estate
Group (E:\Alex Sevilla\draft-site\design). Code: `tools/design-engine/`. Standard: `tools/design-engine/CRAFT.md`.

## The lessons this SOP encodes (each one cost a rejected round on ELEV8)
1. **Real material first.** Real photos of the real places (licensed, credited, place verified on the source page), the client's logo as a
   precise vector, a REAL map (basemap.mjs) with design on top. Flat generated art and hand-drawn maps were rejected ("zero effort").
2. **Study the best before drawing.** Capture best-in-class sites for the niche and take patterns from them; never invent sections cold.
3. **Do the visitor's jobs before the art.** Compare with the client's current site: everything it does for a visitor (search, listings,
   areas, forms) the new design must do better. A beautiful page that drops a job is "unusable".
4. **Section by section, then the page.** Each section is built alone, rendered, inspected at laptop and phone, and scored before assembly.
5. **Measure the craft.** craft-lint fails off-scale type/spacing, low contrast, small tap targets, orphans, stretched images, too many
   radii/shadows/families, overflow. A clean console says nothing about design.
6. **The owner's bar.** Whatever direction the owner picks starts at 3/10 and is raised only by fixing what the pixel review finds.
7. **Plain copy.** No odd headline grammar; the H1 says what the business does and where. No invented claims, reviews, numbers or dates.

## The sequence (stage, output, gate)
| # | Stage | Output | Gate |
|---|---|---|---|
| S0 | Reference study: 8-10 best-in-class sites in the niche, laptop + phone, read only, captured in the browser | `refs/<site>/` + `refs/PATTERNS.md` (per section: 3 best patterns and why) | every planned section has >= 3 real patterns |
| S1 | Section specs: pick and adapt a pattern per section; layout at 390 / 768 / 1366; states; assets | `specs/<section>.md` | each spec names its source pattern and every state |
| S2 | Foundations: tokens on `:root` (`--fs-*`, `--sp-*`, `--r-*`, `--sh-*`, colour roles), component sheet with every state | `foundations/sheet.html` + render | craft-lint PASS on the sheet; AA pairs listed |
| S3 | Assets: fonts (fetch-fonts.mjs), photos (commons-find.mjs + Unsplash, CREDITS.md), vector logo, real map (basemap.mjs + templates/map-overlay.html), icons, textures; every visual drawn in code and rendered with render-asset.mjs, then LOOKED at | `assets/` | every asset rendered and viewed; credits complete |
| S4 | Section lab: each section alone in `lab/sections/<s>.html`, rendered at 1366 and 390, inspected, iterated | renders + scores | craft-lint PASS per section; each scored >= 8 (focal point, hierarchy, spacing, brand, phone) |
| S5 | Assemble the variants from the section library, each with its own art direction | `variants/v<n>.html` | wf-shots PASS (1366x650, 1536x730, 390x844); craft-lint PASS on the page |
| S6 | Audit: section-shots laptop + phone, layering at 25/50/75%, menus open, forms, tap targets by hand, a fresh-context reviewer | `variants/AUDIT.md` | no section under 8; reviewer findings fixed |
| S7 | Delivery: gallery page, screenshots in chat, decisions recorded | `index.html`, `DECISIONS.md` | the owner reviews |

## Tools (all in `tools/design-engine/`, all proven by `tests/test-design-engine.mjs`: 28 checks, watched-fail done)
| Tool | Does | Example |
|---|---|---|
| `render-asset.mjs` | renders a code-drawn page or element in Chromium and extracts the pixels (PNG, transparent, 2x, or JPEG) | `node render-asset.mjs --root <dir> lab/x.html --out x.png --selector "#art" --transparent` |
| `craft-lint.mjs` | measures a rendered page against CRAFT.md at 1366/1536/390 | `node craft-lint.mjs --root <dir> page.html --json lint.json` |
| `basemap.mjs` | real map tiles around the client's places + exact pixel positions | `node basemap.mjs --places places.json --out map --zoom 11` |
| `templates/map-overlay.html` | duotone the basemap in brand colours, draw routes, pins, labels from a config | `render-asset.mjs ... "templates/map-overlay.html?map=...&cfg=..."` |
| `fetch-fonts.mjs` | self-host OFL fonts (no runtime calls to Google) | `node fetch-fonts.mjs assets/fonts --family "Fraunces:wght@300..800"` |
| `commons-find.mjs` | find freely licensed photos of a place with licence + author | `node commons-find.mjs "Vacaville California"` |
| `ref-capture.mjs` | S0: capture reference sites (laptop + phone full pages, structure, unloaded images); robot page = host stopped | `node ref-capture.mjs --out refs --sites sites.json` |
| `ref-fixed.mjs` | S0: list fixed/sticky UI at mid-page on phone (action bars a full-page shot hides) | `node ref-fixed.mjs --out refs --sites sites.json` |
| screenshot tools | `wf-shots.mjs`, `section-shots.mjs` in the skill (`skills/programmatic-enterprise-web-performance/scripts`) | see design.md |

## Rules that never bend
- Licences: every photo, font, map and icon has a source and a licence in CREDITS.md; map images carry their attribution on the image.
  Map tiles are provider data: cached for the job, never committed (see .gitignore).
- Never mix clients; never name another Omnikom client in a client's site; facts only from the client's own material.
- Listings / IDX are design only; forms send nothing in drafts; drafts are `noindex`.
- Read-only on live sites; search and AI pages at human pace; first robot check stops that host.
- Questions to the owner as pickable options; position file updated at every stage gate.

## Running it
In-session (Lead + Opus builder agents per variant, one file per agent) or as a Workflow when the owner says "use a workflow". Either
way the gates above are run by the Lead, not trusted from a builder's report (Rule 2).
