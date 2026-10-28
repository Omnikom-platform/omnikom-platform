# Five Claude design add-ons: evaluation (2026-10-28)

Source: Instagram reel by duncanrogoff (transcript `C:\Users\DELL\Videos\watch\Instagram-DfAtBw1iQj9\transcript.md`). It names
five "free plugins": Awesome Design MD, Taste, Impeccable, Playwright CLI, img2threejs.

Method: shallow clones into a scratch folder (nothing installed, nothing linked into `~/.claude`), source read, supply-chain check
against `~/.claude/reference/supply-chain-2026-10.md`, comparison with our design engine, and a trial of Taste on a scratch copy of the
ELEV8 preview. Scratch root: `C:\Users\DELL\AppData\Local\Temp\claude\E--Omnikom-Platform\0591583f-8372-43ff-a70d-efc54d82382a\scratchpad\`
(`repos\`, `trial\`, `out\`, `check-covered.mjs`). No global config changed.

## Verdict in one table

| Add-on | Repo (checked 2026-10-28 via `gh api`) | Supply chain | Adds over what we have | Recommendation |
|---|---|---|---|---|
| Awesome Design MD | VoltAgent/awesome-design-md · 124k stars · MIT · last push 2026-10-14 | Markdown only, nothing runs. PASS | Little: 84 DESIGN.md files, 66 already in our Open Design library (153). 18 extra brands, none in our niches | **Skip.** We already have it (larger) |
| Taste | Leonxlnx/taste-skill · 104k stars · MIT · v2.1.5 2026-10-25 (v2.1.4 2026-10-20) | Zero deps, no package.json, install = symlink. PASS if pinned to a commit >= 7 days old | A real-browser "AI-look" inspector with probes we lack; a dated registry of AI tells; a strong "idea from the subject" method | **Port the probes and the tells registry into CRAFT.md + craft-lint.** Do not adopt its house style or install it globally |
| Impeccable | pbakaus/impeccable · 92k stars · Apache-2.0 · skill v4.8.0 2026-10-26 | FAILS today: engine binary v0.1.18 published 2026-10-26 (2 days). Adds 3 hooks (SessionStart, PostToolUse Edit/Write, Stop 30 s). Calls impeccable.style and optionally api.openai.com | 62-rule detector (we cover ~15), live click-to-vary mode | **Use only in design sessions, project-scoped, after 2026-11-02**; port detector ideas into craft-lint now. Never global (its hooks would run on every edit in every repo) |
| Playwright CLI | microsoft/playwright-cli · 14.7k stars · Apache-2.0 · v0.1.22 2026-09-28 | Official Microsoft. Depends on `playwright 1.64.0-alpha-…` (a pre-release). `npm i -g` | Token-light CLI browsing for agents. We already have lib-shots (Playwright + Chromium), render-gate, the built-in browser and Chrome | **Skip for now.** Revisit only if the Playwright MCP keeps failing (it timed out at this session's start) |
| img2threejs | img2threejs/img2threejs · 19.7k stars · Apache-2.0 · v2.0.0 2026-09-06, npm cli 0.1.1 2026-10-07 | Python stdlib only, no deps; installer git-clones the skill into agent folders | Photo to code-built Three.js object. Nothing like it in our engine, but no client site needs it | **Skip.** Keep the name for a product client that wants a 3D hero object |

## Supply-chain check (rules 1-7 of supply-chain-2026-10.md)

Worm signs, all five repos: no `.claude/setup.mjs` / `.vscode/setup.mjs`, no `Math_Symbol.js`, no `security-audit.yml` /
`github_actions_security.yml` / `formatter_*` workflows (workflows present are the projects' own CI: ci, release, docs-quality, sheriff,
check-skills), no references to npm-cache.com, pypi-get.com, js-mirror.com, ci-artifacts.dev (grep over each clone: no match).
Never-install list: none of the five depends on a listed release. Detail per add-on:

- **Taste.** No dependencies at all. Scripts: `draw.mjs` (deals directions from local JSON), `lint.mjs` (static scan), `inspect.mjs`
  (drives the installed Chrome/Edge over CDP, serves the page from a throwaway 127.0.0.1 server), `assets.mjs` (network: Openverse,
  Wikimedia Commons, Met Museum, Art Institute of Chicago, NASA, archive.org; no keys), `scenes/stage.js` loads from cdn.jsdelivr.net,
  `app-draw.mjs` writes Google Fonts links. `install.sh` only symlinks `skills/*` into `~/.claude/skills`. 7-day rule: pin a commit dated
  <= 2026-10-21 (v2.1.4 is 2026-10-20), or wait to 2026-11-01 for v2.1.5.
- **Impeccable.** The skill runs a prebuilt Rust binary ("engine", ~20 MB on Windows) downloaded on first use from GitHub releases into
  `~/.impeccable/bin/` (outside any project). Download is checked against `engine-checksums.txt`, but that check only exists since commit
  67d47d4 (2026-10-26); before it, downloads were unverified. So no version today is both >= 7 days old and checksum-verified: engine
  v0.1.18 (pinned) 2026-10-26, v0.1.17 2026-10-23, v0.1.16 2026-10-19 (no verified skill pins it). `npx impeccable install` writes the
  skill plus a provider hook manifest: SessionStart, PostToolUse on Edit|Write, Stop (30 s "design deep pass"). Network in the engine:
  `https://impeccable.style/api/roll` (a random "direction roll", per its own text sends scope, mode, a seed, a counter), card images from
  impeccable.style, and `https://api.openai.com/v1` for optional image generation. Live mode binds a local helper server and injects a
  script into the page. Earliest clean trial date: 2026-11-02 (v0.1.18 + 7 days).
- **Playwright CLI.** `@playwright/cli` 0.1.22 (2026-09-28, passes 7 days) but its dependency is `playwright 1.64.0-alpha-1790635538000`,
  an alpha build. Global npm install. Our rule 2 (install scripts off) holds on npm >= 12.
- **img2threejs.** `forge/requirements.txt`: Python 3.10+ stdlib only. `bin/img2threejs.mjs` git-clones the skill repo into detected
  agent folders (`~/.claude/skills`, `~/.codex/skills`, `~/.hermes/skills`, opencode). No network calls in its scripts besides that clone
  and GitHub issue triage in CI.
- **Awesome Design MD.** Markdown files only.

## What each adds that we lack

Ours: `tools/design-engine/` (CRAFT.md 80 lines, craft-lint.mjs, ref-capture, ref-fixed, basemap, fetch-fonts, commons-find,
render-asset), SOP `sops/design-engine.md` (S0-S7 with gates), design-tournament skill + Open Design library (153 DESIGN.md at
`C:\Users\DELL\AppData\Local\Programs\Open Design\resources\open-design\design-systems\`), frontend-design skill, motion-video-director
`templates/TASTE.md` (a per-project taste memory for video, not a rule set), lib-shots (Playwright) via `tools/design-engine/lib/browser.mjs`.

- **Awesome Design MD vs Open Design.** 66 of its 84 folders exist in our library. Missing here: 1win, aljazeera, dell-1996, dji, hp,
  jobright, linear.app, mercury, mistral.ai, mydealz, nerdwallet, nintendo-2001, opencode.ai, oracle, oura, sap, together.ai, x.ai.
  Its Stripe file is longer (487 lines vs 325) and names brands "-Inspired". No real-estate, legal, medical or home-services brand among
  the 18. Nothing to adopt.
- **Taste vs craft-lint.** Overlap: contrast, overflow, tap/size floors, measure, font-family count, alignment lines. New to us:
  `covered-text` (text under another painted element at sampled scroll stops), `reduced-hidden` (text still invisible with reduced
  motion), `edge-text` (text within 16 px of the screen edge), `off-centre` (unequal page margins), `empty-screens` and `hero-void`
  (screens that are mostly empty ground), `focal-point` (largest type in vw, or one picture >= a third of the first screen),
  `first-action` (a real button on the first screen), `broken-image`, `still-page`, `side-scroll` rows, `mixed-font-headline`, film
  frames of the scroll. Plus `references/tells.md`: a dated registry of generated-look tells (three waves, gallery fashions, structural,
  copy, motion) and a copy linter (genre verbs, "not just X, it's Y", em-dash habit). And a method: inventory 8-12 things only this client
  has, then "On this page, [subject thing] becomes [device]", with a competitor test.
  Conflicts with our approved direction: Taste bans eyebrow labels, monospace labels, hairlines, resting shadows, gradients and 3 font
  families; CRAFT.md allows uppercase labels >= 11 px, 3 families incl. mono, up to 3 shadows. Its house style is one owner's taste, not
  a defect list.
- **Impeccable vs craft-lint.** Its 62 rule ids (`crates/live/assets/antipatterns.json`) include ones we have (low-contrast, tiny-text,
  line-length, straggler, text-overflow, broken-image, wide-tracking) and ones we lack: `text-occlusion`, `content-hidden-at-rest`,
  `body-text-viewport-edge`, `first-viewport-column-overflow`, `skipped-heading`, `heading-rhythm`, `flat-type-hierarchy`,
  `tight-leading`, `cramped-padding`, `justified-text`, `all-caps-body`, `clipped-overflow-container`, `script-error`,
  `design-system-font|color|radius|font-size` (drift from the project's own tokens), and slop tells (gradient-text, ai-color-palette,
  cream-palette, dark-glow, radial-halo, kicker-above-heading, numbered-section-labels, marketing-buzzword, em-dash-overuse,
  theater-slop-phrase). Live mode (click an element, get variants hot-swapped) has no equivalent in our engine; the closest is the
  design-tournament's competing variants per section.
- **Playwright CLI.** We already drive Playwright from scripts (lib-shots) and have two interactive browsers. It would only save tokens
  in agent-driven clicking, which we do through the built-in browser.
- **img2threejs.** Unique, but outside our sites' needs.

## Trial on ELEV8 (scratch copy, read-only on the originals)

Copied `E:\Alex Sevilla\draft-site\design\variants\v4.html` + `design\assets` + `design\foundations`, and `site\dist`, into
`scratchpad\trial\`. Ran Taste from its clone (no install) and our craft-lint on the same files.

| Command (from scratch) | Result |
|---|---|
| `node taste-skill/.../inspect.mjs design/variants/v4.html --out out/taste-v4` | `RESULT: 13 FAIL, 7 WARN — not done.` |
| `node taste-skill/.../inspect.mjs index.html` (cwd `trial/site-dist`) | `RESULT: 13 FAIL, 7 WARN — not done.` (same findings) |
| `node taste-skill/.../lint.mjs design/variants/v4.html` | `RESULT: 18 FAIL, 2 WARN` (hairline 21x, gradient 9x, shadow 13x, eyebrow 16x, mono 7x, 12 em dashes) |
| `node tools/design-engine/craft-lint.mjs --root trial/design variants/v4.html` | `CRAFT-LINT PASS: 0 errors across 3 viewports` (alignment warnings only) |

Harness note: the first site-dist run was invalid (unstyled, "Times New Roman 96%", broken images) because Taste serves from the
current folder and the built site uses root-absolute `/assets/` paths. Re-run from `site-dist` as cwd is the one above.

Taste's v4 findings, sorted after checking each one:

1. **House-style bans, not defects (8):** eyebrow, mono, numbering ("02"), micro-label, shadow, hairline, outlined-box, gradient (the
   phone hero scrim, which its own rules allow as a photo scrim), plus warns glass, card-rows, font-count, no-footage, still-page
   (pages were measured without motion by design). These contradict CRAFT.md and the owner-approved v4 direction.
2. **False positives (verified):**
   - `eyebrow` counted "Equal Housing Opportunity" and a photo credit as kickers above "10" and "02248556" (the DRE licence number).
     Those are legally required / licence text and must stay.
   - `reduced-hidden` "Get my selling plan / Get my home value / Get a cash offer": these are the alternate labels of the hero search
     button (`v4.html:1117`, one `<span data-for>` per tab, only the active one shows). Hidden by design in every motion setting.
3. **Flagged where our audit admits it did not look, then checked: no defect.** `covered-text` at 768 ("Ten cities, one corridor"
   100% hidden at screen 4, "Ready when you are." 50%, "(510) 209-6930" 100% at screen 10; on the built site "What's your home worth?"
   50% at screen 2) and `edge-text` "American Canyon" 0 px from the right at 768. Our v4 audit lists "tablet 768 by eye" and
   "prefers-reduced-motion" as not checked (`design/variants/AUDIT.md:141`, `audit-v4-r1/AUDIT.md:178`).
   Independent check, `scratchpad\check-covered.mjs` (768x1024, one stop per screen, motion on and reduced, `elementFromPoint` at
   each text's centre). Watched-fail: with an injected fixed red box it reported `covered-by=div.probe-cover (fixed)`; the first two
   versions of the script reported nothing even with the box (wrong path separators, then wrong page URL), which is why it was run.
   Real run, `CHECK DONE text-node sightings=418`, hits:
   `scrollY=3072 "Ten cities" top=986 covered-by=a nav.pa-bar.is-shown (fixed)` and
   `scrollY=9216 "(510) 209-6930" top=946 covered-by=a nav.pa-bar.is-shown (fixed)`: text passing under the fixed phone/tablet action
   bar at the bottom of the screen, normal scrolling, not a defect. Taste excludes top bars from this rule but not bottom bars.
   `"(510) 209-6930" top=38..71 covered-by=a.btn.btn-pri header.hd...`: at 768 the header shows only the phone icon (seen in
   `out\taste-v4\tablet-fold.jpg`), so the number's collapsed label sits under the button; not visible, not a defect.
   "American Ca…" at the right edge is the sideways-scrolling city-chip row (also in the tablet shot): a design choice, Taste's
   `side-scroll` warn says visitors may read it as cut off.
4. **Real but known / policy:** `small-text` 12-18 blocks under 13 px (CRAFT.md allows 12 px captions), `ragged-edges` 12 left lines
   page-wide (craft-lint warns the same, per section), `side-scroll` one row at 768 (the areas carousel).

So on ELEV8, Taste found **no confirmed defect** that craft-lint and the five reviews missed: of 20 findings, 8 are house-style bans
that contradict the approved direction, 2 are verified false positives, the covered/edge findings are fixed bars and a carousel, and
the rest are known policy differences. What it does have is probes aimed where our audit admits it did not look (768, reduced motion,
every scroll stop) and a faster "generated look" checklist. Ported with the two false-positive fixes above, those probes would have
turned three UNPROVEN audit lines into measured ones.

Impeccable trial: **BLOCKED** by the 7-day rule (engine v0.1.18 is 2 days old; no checksum-verified older pin exists). Unblocks
2026-11-02. Two ways around it were considered and not taken: building the engine from the Rust source (pulls a crates.io tree, a
larger supply-chain surface than the binary) and running engine v0.1.16 with an older, unverified launcher. Live mode is therefore
**UNPROVEN** here. From its docs: it needs a dev server with HMR or a static file open in a browser, a helper server on localhost,
and an agent running `impeccable live-poll` in the background while a human clicks elements; Claude Code is a supported harness.

## Recommendations

1. **Taste: port, do not install.** Add to craft-lint (each with a watched-fail): covered-text at scroll stops (ignore fixed bars at
   the top AND the bottom, and labels hidden at rest), reduced-motion visibility (only elements that become visible with motion on;
   skip ones hidden in both settings, e.g. tab-swapped labels),
   edge-text (16 px), off-centre margins, empty-screens / hero-void, first-action button, broken-image, and run at 768 as a fourth
   viewport by default. Add a short "Tells" section to CRAFT.md that names the generated-look tells as warnings with a "defend it" rule
   (not bans), and the subject-inventory + competitor-test step to SOP S1. Effort: one session.
2. **Impeccable: design sessions only, after 2026-11-02, project-scoped** (`npx impeccable install --scope=project`) in a client
   design folder, then a real live-mode trial on the ELEV8 variants. Never global: its PostToolUse hook would run on every Edit/Write in
   every repo, and its Stop hook adds up to 30 s per turn. Port now, without the binary: text-occlusion, content-hidden-at-rest,
   skipped-heading, heading-rhythm / flat-type-hierarchy, tight-leading, justified-text, all-caps-body, design-system drift.
3. **Awesome Design MD: skip** (already in Open Design).
4. **Playwright CLI: skip**; reconsider only if the Playwright MCP keeps timing out.
5. **img2threejs: skip**; note for a product client.

Nothing above needs a global install; items 1 and 2 (port) are repo work in `tools/design-engine/`. Item 2 (install) needs the owner's
OK and the date.
