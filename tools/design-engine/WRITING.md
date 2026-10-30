# WRITING.md: how the engine writes code that is fast and agent-readable (the writing gate)

Owner, 2026-10-29 (ELEV8 launch): fix the habits, not the report. The lead's decision is DECISIONS 20: the first real V2 site scored
97 on mobile PageSpeed (PSI-FINDINGS.md, 2026-10-29), and every red item came from how the build writes code. So these 7 rules apply
while the engine writes a site. Each is a number or a yes/no. Each has a check that stops the build, a second check that does not
trust the first, and a live check at launch. A site that fails a rule is not shown to the owner.

Where each rule is measured:
- **[build]** the site's build stops with `BUILD STOPPED: WG-n ...`. The measured rules run in the site's `tools/writing-check.mjs`, one line per rule.
- **[gate]** the skill's `scripts/writing-gate.mjs <built site dir> [--url] [--psi-dir]`, independent of the build.
- **[live]** the launch ledger (`sops/clients/launch.md`): `live-headers` on L-B8 and `writing` on L-B9.

Source for every ELEV8 number below: `E:\Alex Sevilla\site-checks\live-audit-2026-10-29\PSI-FINDINGS.md` (PSI-FINDINGS.md, 2026-10-29).

## WG-1. Critical CSS inline, the rest deferred
- **Rule:** the CSS a page needs for its first screen (critical CSS) is inline in `<head>` and is 14 KiB gzip or less per page (compressed, as it travels; raw is often 2-4x). The rest
  loads without blocking paint. No render-blocking stylesheet in `<head>`. PageSpeed render-blocking savings: 0 ms.
- **Why:** ELEV8 had one site-wide `app.css` (24.3 KiB) in `<head>`. PageSpeed measured 870 ms of render blocking on mobile
  (PSI-FINDINGS.md, 2026-10-29).
- **How to write it right:** split by coverage. Load the page in Chromium, record which rules the first screen uses at 390 and 1366,
  inline those. Load the remainder with `<link rel="stylesheet" media="print" onload="this.media='all'">` and a `<noscript>`
  fallback. Fonts and CSS are found early: preload the one font file the first screen uses.
- **Measured:** [build] inline size per page and no blocking `<link rel=stylesheet>` in `<head>`; [gate] the same on the built files,
  plus PSI render-blocking savings 0 ms from the saved PSI JSON; [live] `writing`.

## WG-2. CSS per template or purged per page
- **Rule:** a page does not carry another template's rules. Wasted CSS is under 8 KiB gzip per page, as PageSpeed flags it (the unused share of each sheet by coverage, times its gzip size; calibrated 2026-10-29: 34-52% unused by coverage was green, its one red was 10.2 KiB wasted; the raw % was the wrong proxy
  after load).
- **Why:** the same ELEV8 stylesheet carried every page's rules. About half was unused on the home page: 10 KiB on mobile and
  14 KiB on desktop (PSI-FINDINGS.md, 2026-10-29). The 14 KiB is read as gzip: the ELEV8 home page inlines 32.6 KiB raw at 7.3 KiB gzip (2026-10-29).
- **How to write it right:** build one CSS file per template (home, team, service, article, legal) from shared tokens, or purge each
  page's CSS against its own HTML. Keep a safelist for classes that only our JS toggles (menu open, tab selected, wizard step,
  sticky bar), because a purge sees only the HTML at load. A rule for a toggled class that is missing from the safelist is a bug.
- **Measured:** [build] coverage per page in Chromium after load, with the menu, tabs and wizard opened; [gate] the same on the built
  files, plus PSI unused-css-rules from the saved JSON; [live] `writing`.

## WG-3. Images sized to their slot
- **Rule:** `sizes` comes from the real slot width at each breakpoint. `100vw` only for a full-bleed image (rendered width 95% of
  the viewport or more). Format WebP or AVIF at quality 60-70. The candidate the browser picks is at most 1.5x the rendered width
  plus one step of the width ladder. PageSpeed image-delivery savings: under 10 KiB.
- **Why:** the ELEV8 hero `stock__home-blue-porch` was 139 KiB and could be 81 KiB smaller on mobile (13 KiB on desktop). It was
  larger than displayed, lightly compressed, and `sizes="100vw"` was too broad (PSI-FINDINGS.md, 2026-10-29).
- **How to write it right:** measure the slot in the rendered layout (the container width minus gutters, per breakpoint) and write
  `sizes` as a list: `(min-width: 1240px) 600px, (min-width: 768px) 50vw, 100vw`. Generate the width ladder from the slot, not from
  the source file. Encode at quality 60-70 and look at the result once at full size.
- **Measured:** [build] for each `<img>` the chosen candidate against the rendered width, and `100vw` only where the image is full
  bleed; [gate] the same on the built files, plus PSI image-delivery savings from the saved JSON; [live] `writing`.

## WG-4. No layout read after a style write in our JS
- **Rule:** our scripts read layout first and write styles after (batch reads, then writes). Forced reflows caused by our own scripts:
  0 in a Chromium trace of load, scroll and menu open.
- **Why:** `site.js:64` in ELEV8 read layout (`offsetHeight`, `getBoundingClientRect`) right after writing styles. PageSpeed measured
  53 ms of forced reflow on mobile (PSI-FINDINGS.md, 2026-10-29).
- **How to write it right:** in each handler, collect every measurement into variables first, then apply every style change. Do
  not alternate. For work on scroll or resize, read in the handler and write in `requestAnimationFrame`. Prefer
  `IntersectionObserver` and CSS (`position: sticky`, `scroll-snap`) over measuring.
- **Measured:** [build] the trace of load + scroll + menu open, counting reflows with a script of ours in the stack; [gate] the same
  trace, independent of the build, plus PSI forced-reflow-insight from the saved JSON; [live] `writing`.

## WG-5. ARIA roles only on compatible elements
- **Rule:** a role goes only on an element the ARIA in HTML allowed-roles table permits. Never `role=tabpanel` on a `<form>`.
  axe `aria-allowed-role` violations: 0.
- **Why:** the ELEV8 hero put `role="tabpanel"` on `<form class="hro-form" id="hro-p">`. PageSpeed flagged it under Accessibility
  (informative) and failed the Agentic Browsing accessibility-tree check on mobile and desktop (PSI-FINDINGS.md, 2026-10-29).
- **How to write it right:** put roles on `<div>` or `<section>`. For a tab panel that holds a form, write
  `<div role="tabpanel"><form>...</form></div>`. Do not give `<a>`, `<button>` or `<form>` a role that conflicts with its own.
- **Measured:** [build] axe-core in the render check, `aria-allowed-role` at 0 on every template; [gate] the same on the built files;
  [live] `writing`.

## WG-6. Agent readiness
- **Rule:** the accessibility tree is clean (WG-5 is 0). `/llms.txt` exists and is generated from the contract: an H1, a one-line
  description, the pages with one line each, and the sitemap link. Lighthouse "Agentic Browsing" scores 2/2.
- **Why:** ELEV8 scored 1/2 on Agentic Browsing on mobile and desktop. The accessibility-tree check failed (WG-5) and `llms-txt` had
  no `/llms.txt` (PSI-FINDINGS.md, 2026-10-29).
- **How to write it right:** the build writes `llms.txt` from the same contract rows that make the pages and the sitemap, so it
  cannot drift from them. One line per page: `- [Title](url): what the page is for.` Never hand-edit it.
- **Measured:** [build] `llms.txt` present, with its H1, description, every contract page and the sitemap link; [gate] the same on the
  built files; [live] `writing` for the file on the live URL. The 2/2 score is read in the browser (see Not built).

## WG-7. Security headers
- **Rule:** `_headers` carries `Strict-Transport-Security` and `Cross-Origin-Opener-Policy: same-origin`, and the live response
  carries both.
- **Why:** ELEV8 had no HSTS (`has-hsts`) and no COOP (`origin-isolation`) in PageSpeed Best Practices (informative)
  (PSI-FINDINGS.md, 2026-10-29). Each is one header line.
- **How to write it right:** in `_headers`, under `/*`:
  `Strict-Transport-Security: max-age=31536000; includeSubDomains` and `Cross-Origin-Opener-Policy: same-origin`. HSTS is for a
  domain that is https only. Check that no third-party popup flow depends on `window.opener` before COOP goes on.
- **Measured:** [build] both lines in `_headers`; [gate] the same on the built files, and on the live response when `--url` is given;
  [live] `live-headers` on L-B8 (COOP now required) and `writing` on L-B9.

## Proof
- Every check is watched red before it counts. Break the code it covers (put a blocking stylesheet in `<head>`, give a form
  `role=tabpanel`, delete the COOP line), see the check go red for the right reason, restore, see it green. A check that stays
  green on the mutant measures nothing, or the patch never applied: assert the mutant's target exists before you trust the result.
- The site's `tools/writing-check.mjs` is the build-side test (one line per rule). The skill's `scripts/test-writing-gate.mjs` is the
  gate-side test. Both are being written with the writing gate. UNPROVEN until each has been run and its mutants watched red.

## Not built
- **NOT BUILT:** the Agentic Browsing category by API. The PageSpeed API does not expose it yet, so the 2/2 is read in the browser
  at pagespeed.web.dev (the lead's browser or OWNER-PROOF).
- **NOT BUILT:** a Trusted Types CSP (`trusted-types-xss`). It needs a CSP review first.
- **NOT BUILT:** WebMCP form metadata. Wait until the spec settles.
