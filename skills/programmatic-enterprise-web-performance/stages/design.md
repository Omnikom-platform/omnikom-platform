# S3.5 Design: from the plan to a design spec the builder can follow

Loaded when the mode is `build` and the site is new or redesigned, **between the plan and the builder handoff**
(intake -> research -> plan -> **design** -> handoff -> builder -> gate). Without this stage the builder has nothing visual to
follow and the first mock-ups come out generic (measured on a real project: the build lane had no design stage, early comps were
rated 1/10 by the owner). This stage is run by the **main session with agents and the owner**, not by a script: no automated
runner, no `build-site.mjs` stage. Its one deliverable is `DESIGN.md`, the spec the builder is pointed at (the main session adds its path to the builder prompt). The tools are
`scripts/wf-shots.mjs` and `scripts/section-shots.mjs`; the method is borrowed from the `design-tournament` skill (personas grounded
in real references, honest judging), **not** its Workflow pipeline (too much usage for this).

## Inputs (read these, nothing else)
| File | Made by | Must be |
|---|---|---|
| `<pewp>/business.json` | S1 intake | valid; the approved business name, industry, `launchState` |
| `<pewp>/plan/sitemap.json` + `plan/briefs/` | S3 plan | the page list and each page's copy/brief; the client copy is the design's source |
| brand assets | the client | logo files, photos, fonts, colours, if any (step 1 inventories them) |
| Open Design library | `C:\Users\DELL\AppData\Local\Programs\Open Design\resources\open-design\` | `design-systems\<name>\DESIGN.md` (real references) and `craft\anti-ai-slop.md`; the catalogue is `~/.claude/skills/design-tournament/open-design-catalog.md` |

Outputs live in `<project>/design/` (the project's own folder, not the skill): `assets-inventory.md`, `directions/`, `comps/`,
`sizing.md`, `audit.md`, and the spec `DESIGN.md` (next to the other knowledge files of the project). Everything is a file, so
the stage resumes after a compaction. Questions to the owner are asked by the main session as **pickable options**, the
recommended option first, never a prose list; scripts never prompt.

Screenshot tools (both serve `--root` from 127.0.0.1, take Playwright from the render-gate install, exit 0 / 1 / 2 usage / 3 BLOCKED):
```
node "<skill>/scripts/wf-shots.mjs" --root <dir> <page> [--viewports 1366x650,1536x730,390x844] [--motion on]
node "<skill>/scripts/section-shots.mjs" --root <dir> <page> [--w 1536 --h 730]
```

## Steps
Each step: input, output file, the check that proves it, the owner touchpoint. A step is not done until its check ran and its
output was pasted or the file exists.

### 1. Visual intake
- **Input:** what the client has (logo, photos, fonts, colours, an old site) and `business.json`.
- **Output:** `design/assets-inventory.md`: one row per asset: file, what it is, source and licence, problem found.
- **Do:** list every brand asset. **Open every photo and read it** (view it; do not trust the file name) for hidden text or claims
  (a real project's team photos carried a deal-announcement caption from another business line, which would have been published as
  a claim) and for an AI-generated look (waxy skin, wrong hands, garbled signs). Compare the **logo's wording** with the approved
  business name from intake; a logo that says something else is a finding, not a detail.
- **Check:** every photo has a row with "text/claims: none | <what>" and "look: real | suspect"; the logo row states the wording and
  "matches business.json name: yes | no". A photo with an unapproved claim is marked "do not use" or "crop to <region>".
- **Owner:** one pickable question per finding that needs a decision (use cropped / replace / ask the client for another), asked in a
  single batch.

### 2. Lean direction round
- **Input:** the plan's page copy for the home page (the client's own words), the inventory, and a persona list.
- **Output:** `design/directions/<name>.html`, 3 to 6 greyscale wireframes, plus `design/directions/_shots/`.
- **Do:** pick 3 to 6 personas that fit the niche's emotional register (trust, warmth, precision, story). One **Sonnet** agent per
  persona, in parallel, each given: the client copy, **one real Open Design reference** for that persona (read it in full), and
  `craft\anti-ai-slop.md`. Each wireframe must have its **own header, footer, grid, type and motion**: one shared template with the
  hero swapped is not a direction. Ideas must be **concept-led**: derive the concept from the brand name or from the copy's own
  headline (the layout acts out the sentence). Cap: about 350 lines per file, greyscale only, **one screenshot check
  (`wf-shots.mjs`) and at most one fix** per agent. Never the `design-tournament` Workflow pipeline.
- **Lesson:** a round of one template with swapped heroes was rejected outright; the concept-led directions (from the name, from the
  headline) were the ones the owner chose.
- **Check:** `wf-shots.mjs` exit 0 for each direction; the main session views every screenshot and drops any two directions that share
  a header/footer/grid (write the reason in the shot's note).
- **Owner:** pick one direction (or a named blend), pickable options with a one-line idea each; recommended first.

### 3. Motion forced on for review
- **Why:** the owner's OS had animations off, `prefers-reduced-motion` was therefore true, and the first rounds looked dead.
- **Do:** every review page has a **visible toggle** "Motion: on/off" that forces motion on, default on for review (not hidden behind
  a query string the owner cannot find; a `?motion=on` URL may also exist). **Production respects `prefers-reduced-motion`**; the
  forced mode is a review aid and must not ship. Screenshot tools see the **settled** state: Playwright sets `navigator.webdriver`,
  and the comp also honours `#still`, so reveals and pins resolve before the shot (`section-shots.mjs` opens `#still`).
- **Check:** open the comp with motion on and off; the toggle is visible without scrolling; `wf-shots.mjs --motion on` still has
  0 errors. Note in the comp's header comment that the toggle is review-only.
- **Owner:** none (mention the toggle once when sending the link).

### 4. Branded comp of the chosen concept
- **Input:** the chosen direction, the inventory (only photos not marked "do not use"), the approved name.
- **Output:** `design/comps/<page>.html` (home first), `assets/` with licensed files and `assets/stock/CREDITS.md`.
- **Do:** replace grey boxes with the real brand: real photos, the real logo lockup, the client's copy. Licences: photos from
  Unsplash (Unsplash Licence), fonts OFL (self-hosted files), icons ISC (Lucide), every asset one line in the credits file. Where the
  palette is undecided, build it **as a switch** in the comp (2 or 3 named palettes, one click) and let the owner pick; do not decide
  it for him.
- **Check:** `wf-shots.mjs` exit 0 at 1440x900, 768x1024, 390x844; every file in `assets/` appears in the credits file (a short
  `grep` loop prints the missing ones); no image has text in it that step 1 did not approve.
- **Owner:** pick the palette and sign the comp's direction (pickable: approve / change X / next palette).

### 5. Sizing standard from measured data
- **Why:** sizing by `vw`/`vh` made the first comps feel "zoomed in" on a laptop: headings ballooned and short screens filled up.
- **Measure, then write `design/sizing.md`:** who the visitors are (desktop screen shares from StatCounter, cite URL and date seen;
  the shares seen on the real project: 1920x1080 about 22%, 1536x864 about 7%, 1366x768 about 5%) and the **usable viewport**
  (screen minus browser chrome and taskbar: a 1536x864 laptop gives about 1530 x 730). If the client's own analytics exist, they
  outrank the world data.
- **Rules:** fluid **rem tokens** (`clamp(rem, rem + small vw, rem)`) for type and spacing so browser zoom still works; a **capped
  content width** (about 1240px) and a reading width (62ch); **no raw `vw`/`vh` for type or spacing**; `vh` only for pinned stages and
  never to size text.
- **Check:** `grep -nE "[0-9.]+v[wh]" <css>` shows only inside `clamp()` fluid parts or pinned-stage heights, listed in sizing.md;
  **every first screen** passes `wf-shots.mjs --viewports 1366x650,1536x730,390x844` with the headline, the main message and the
  primary button visible without scrolling (look at the three shots).
- **Owner:** none; the owner's own laptop size is the tiebreak if he reports "too big".

### 6. Layering and overlap, checked live
- **Why:** a full-page screenshot lies about fixed bars (they appear once, at the top) and pinned heroes (they appear as a tall
  strip). Overlaps between a fixed header, a sticky bar, a pinned stage and the phone tab bar only show in a real viewport.
- **Do:** drive the page in a real browser (the Chrome tools, or a Playwright script), scroll to the top, 25%, 50%, 75%, bottom of
  each pinned stage and of the page, and take a **viewport** screenshot at each stop. Do the same at 390x844 with the phone's bottom
  bar and the open menu sheet. Look for: text under a bar, a button hidden behind another layer, content clipped by a pin, a bar
  covering the anchor target after a jump.
- **Output:** `design/audit.md` section "layering": one line per stop (scroll position, viewport, ok | problem).
- **Check:** every stop has a viewport screenshot that the main session viewed; every problem is fixed and the stop re-shot.
- **Owner:** none.

### 7. Per-section audit
- **Do:** `section-shots.mjs --root <dir> <comp>` at 1536x730 (also 1366x650) and 390x844. View **every** section picture. Score each
  section 1 to 10 on four lines: message clear in 3 seconds, hierarchy, whitespace/balance, brand feel. **Score honestly.** The owner
  rated the early comps 1/10 although every one passed the 0-errors check: a clean console and no overflow say nothing about design.
  Any section under 7 is redone (not nudged) before the spec is written.
- **Output:** `design/audit.md` section "sections": a table: section, laptop score, phone score, the worst problem, fixed yes/no.
- **Check:** the table has a row for every section the screenshots listed (counts equal), and no row under 7 with "fixed: no".
- **Owner:** show the section strip of the weakest two sections and the strongest two; ask "is this the level you want" (pickable:
  yes / lower / higher bar). His rating becomes the bar for the next page.

### 8. The `DESIGN.md` spec
- **Output:** `DESIGN.md` in the project's knowledge folder. It is what the builder follows, so it must be complete enough to build
  from without opening the comps:
  1. **Tokens:** colours (with contrast pairs checked to WCAG AA), type families and the fluid scale from `sizing.md`, space scale,
     content/reading widths, radii, shadows.
  2. **Layout rules:** the section opener, the grid, the rhythm of backgrounds, whitespace values, the sizes every first screen must pass.
  3. **Components, each with all its states:** header (transparent, solid, current page, menu open, phone sheet), buttons (hover,
     pressed, focus-visible, disabled), cards, steps, accordion, form (error, success), footer. A component without its states is not
     specified.
  4. **A motion script per section:** the trigger, the duration, the easing, and for a pinned hero the **scroll percentages**
     (0-15% nothing moves and the visitor reads; 15-75% the change; 75-100% hold). Rules: **headlines never slide sideways while being
     read**; nothing above the fold waits for a reveal; reduced-motion = static states; the review toggle (step 3) is not shipped.
  5. **Imagery rules:** which photos, crops, scrims under text, formats and width variants, the hero preload, alt text rule.
  6. **Page list** with each page's section order (the plan's page copy order) and the shared header/footer.
  7. **Done means:** the exact checks (section shots by the lead per section, `wf-shots.mjs` at three widths with 0 errors and 0
     overflow, the sizing viewports, the skill's gate, a speed measurement).
- **Rule:** **once the spec exists, stop polishing mock-ups.** The comps are references for the idea, not the design; the builder builds
  real components from `DESIGN.md`. Further design changes are made in the spec and the build, not in the comps.
- **Check:** the sections 1 to 7 above are all present (a heading grep); every component lists its states; every number has a unit.
- **Owner:** sign-off of `DESIGN.md` (pickable: approve / change X). The builder may not start before this (the project's own rule,
  e.g. no code before sign-off, comes first).

### 9. Scope check before building
- **Why:** a research plan can propose dozens of pages (a real project's plan proposed 80, including competitor-brand pages and rate
  pages). Building all of them is not a decision anyone made.
- **Input:** `plan/sitemap.json`. **Output:** `design/scope.md`: the list the first build will make.
- **Do:** list the plan's pages with kind and primary query; propose a first-build set (the pages the client's own copy covers, plus
  the pages with real demand that are safe to publish). **Drop for YMYL** (money, health, legal): pages named after a competitor's
  brand, pages that quote rates or returns, and pages for locations the business is not licensed to serve. Everything dropped gets a
  one-line reason.
- **Check:** every page in the plan is in exactly one of "build now", "later", "dropped (reason)"; no dropped page appears in the
  sitemap the builder will receive (edit `plan/sitemap.json` or re-run `plan-site.mjs` with the reduced scope, so the gate checks
  the chosen set).
- **Owner:** the owner chooses the first-build scope (pickable: the proposed set / smaller / larger); his choice is final.

## Stop rules
- Never invent client facts, logos or photos; a missing asset is a gap in the inventory, asked of the client through the owner.
- No hidden text claims on any photo that ships; no logo wording that differs from the approved name.
- A direction round is one round. A second round needs a new owner decision.
- This stage never deploys, never submits a client's forms, and never reads a competitor's site more politely than the rest of the
  skill does (see `SKILL.md` rules).
- Client content (copy, photos, names) stays in the project's folder; nothing from it goes into this skill.

## Proof of the tooling
`node scripts/wf-shots.mjs` and `scripts/section-shots.mjs` are covered by `node scripts/test-main.mjs` (each prints its usage when
started through a junction). Their behaviour was exercised on a fixture page: clean page exit 0, a page with a console error and a
3000px element exit 1, a missing page or `--root` exit 2, a selector that matches nothing exit 1.
