# CRAFT.md: what makes an element, a component or a layout look fabulous (hardened; Omnikom design engine)

Owner, 2026-10-27: "the quality of the elements, components and the grid of the artistic direction and what would make you actually create
a good element code or a good layout that looks fabulous: we need that hardened." Every rule below is a number or a yes/no, and the rules
marked **[lint]** are measured on the rendered page by `tools/design-engine/craft-lint.mjs` (laptop 1366 + 1536, phone 390). A page that fails the
lint is not shown to the owner. The rest are checked by eye in the section review (design.md step 7) with this file open.

## 1. Tokens first, values never [lint]
- Every font-size, gap, padding, margin, radius and shadow comes from a token on `:root`: `--fs-*` (type), `--sp-*` (space), `--r-*`
  (radius), `--sh-*` (shadow). A literal value in a component is a defect. The lint resolves each token at the current viewport and flags
  any computed value outside the set (tolerance 0.5 px; 0 and 1 px borders allowed).
- Space scale on a 4 px base: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128 (fluid tokens may clamp between two steps).
- Type scale: a modular ratio (1.2 phone, 1.25-1.333 laptop) from a 16-18 px body; at most 7 sizes on a page.

## 2. Grid
- 12 columns on laptop (container 1240 px max, gutter 24-32 px, outer margin >= 32 px), 6 on tablet, 4 on phone (margin 16-20 px, gutter 16).
- **[lint] Alignment lines**: the left edges of all text blocks, images and cards in a section fall on few vertical lines (<= 4 distinct
  lines per section at laptop, <= 2 on phone). Ragged starts are the first sign of an amateur layout.
- Content never touches the viewport edge on phone (>= 16 px). **[lint] No horizontal overflow** at 320, 390, 1366, 1536.
- One container width for the whole page; full-bleed only on purpose (hero, photo bands).

## 3. Type
- **[lint]** At most 3 font families (display, text, mono) and at most 4 weights in use.
- **[lint]** Body text >= 16 px on phone; captions >= 12 px; uppercase labels >= 11 px with letter-spacing 0.06-0.16em.
- Line-height: 1.05-1.15 for display (>= 40 px), 1.2-1.3 for headings, 1.5-1.65 for body. Negative tracking (-0.01 to -0.03em) only above 32 px.
- **[lint] Measure**: paragraphs 45-80 characters per line on laptop (count from the rendered width).
- **[lint] No orphans**: a heading's last line is never a single word (`text-wrap: balance` on h1-h3, `pretty` on paragraphs).
- Numbers in prices and stats use tabular figures (`font-variant-numeric: tabular-nums`).

## 4. Colour and contrast
- Roles, not hexes: ink, ink-2, muted, line, surface, surface-2, accent, accent-ink, deep. One accent; it marks the primary action and
  at most one highlight per section.
- **[lint] Contrast**: text >= 4.5:1 (>= 3:1 at >= 24 px or >= 18.66 px bold) against its real background; text over a photo must sit on a
  scrim and is reported for an eye check.
- Never pure #000 on pure #fff for long text; never grey text on a coloured surface below 4.5:1.

## 5. Components (anatomy and every state)
- **Buttons**: heights 44 (small), 48 (default), 56 (hero); horizontal padding = 1.25-1.5x the height's half; one radius family;
  states: default, hover, focus-visible (2-3 px ring, offset 2-3 px), active (pressed), disabled, loading. Icon 20 px with 8 px gap.
- **Inputs**: height 48-56, label above (or a visible floating label), placeholder is never the only label, error text below in the
  error colour with an icon, focus ring = button ring.
- **Tabs / segmented**: the selected state differs by at least two cues (weight + underline, or fill + colour), never colour alone.
- **Cards**: one padding token on all sides (or a documented pair), one radius, image ratio fixed per card type (listing 4:3, city 3:4 or
  1:1, article 16:9), title max 2 lines with ellipsis, the whole card clickable with one visible link inside.
- **Chips/pills**: height >= 32 (>= 44 tap area on phone via padding or spacing).
- **[lint] Tap targets**: every link, button and input on phone has a box >= 44 x 44 px, or >= 24 px with >= 8 px clear space (WCAG 2.5.8).
- **[lint] Radius family**: at most 3 distinct radii on a page (plus 999 px for pills and 50% for avatars).
- **[lint] Shadow family**: at most 3 distinct shadows; no shadow on text except over photos.

## 6. Imagery
- **[lint] No distortion**: a rendered image's aspect ratio matches its natural ratio unless `object-fit: cover|contain` (then the focal
  point is set with `object-position`).
- Every photo: real, licensed, credited; a scrim under any text (bottom gradient >= 0.55 opacity at the text line).
- Icons: one set, one stroke (1.75 at 24 px), sizes 16/20/24 only, optically centred with their label.

## 7. Layout and art direction (the "fabulous" part, checked by eye with section shots)
- **One focal point per section**: the eye lands on one thing first (size, contrast or colour), the second thing is clearly second.
- **Contrast of scale**: the hero headline is >= 2.5x body size on laptop; section titles >= 1.75x; never three things the same size.
- **Rhythm**: section padding from two tokens (e.g. 96 and 64 on laptop, 64 and 48 on phone); alternate surfaces to separate sections,
  never stack two sections with the same layout back to back.
- **Whitespace**: generous outside components, tight inside (internal spacing < external spacing, always).
- **Asymmetry with intent**: a 7/5 or 8/4 split reads designed; 6/6 reads default. Use the grid, then break it once per page on purpose.
- **Edges**: images and cards bleed or align to the grid, never float at arbitrary offsets.
- **Details that signal quality**: hanging punctuation in pull quotes, tabular numerals, real quotes and dashes (’ “ ” – —), balanced
  heading wraps, optical alignment of icons, hover states that move <= 2 px, focus rings that match the brand.

## 8. Phone (half of the visitors)
- Designed at 390 first. The primary action is reachable by the thumb (bottom half, or a sticky bar). No hover-only content. Carousels
  scroll with snap and show a peek of the next card. Forms use the right keyboard (`inputmode`, `autocomplete`). Body 16-17 px.
- Section padding on phone 48-64 px; headings scale down to 1.2 ratio; tiles at least 1.5 cards visible in horizontal scrollers.

## 9. Motion
- 150-250 ms for UI state, 400-700 ms for reveals, one easing family; nothing above the fold waits for a reveal; prefers-reduced-motion = static.

## How it is enforced
1. `node tools/design-engine/craft-lint.mjs --root <site or design folder> <page>`: exit 0 = no errors; exit 1 = errors listed with element selectors.
2. Section review with section-shots + this file: every section scored >= 8 on focal point, hierarchy, spacing/balance, brand, phone.
3. Both are gates in the design SOP (sops/design-engine.md: S4 section lab and S6 audit) and in every builder brief.
