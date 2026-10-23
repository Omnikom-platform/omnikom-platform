# Context: everything learned building three real client sites (2026-10-16 to 2026-10-24)

The platform automates what was done by hand for three clients. This file is the lessons and the map of where the proven code is,
so nobody re-learns them. Facts carry their source; anything not proven is marked.

## The clients the platform grew out of
| Client | Business | Old stack | Where our work is |
|---|---|---|---|
| Francine Masudi, Valley To Valley Realty | real-estate agent (eXp) | Luxury Presence SaaS (rated 6/10 by the owner; LP refused to hand over code, 2026-10-17) | `E:\Francine & Eli` (`proposals/vtv`, report `deliverables/docs/website-review-francine.md`) |
| Eli Masudi, Eli Buys Homes | cash home buyer | REsimpli WordPress template | `E:\Francine & Eli` (`proposals/eli`) |
| Monica Faulve-Stach, Rainmaker Wealth Innovations | insurance agency (mortgage protection, life, annuities, agent recruiting) | Duda site on GoDaddy DNS | `E:\Rainmaker` (full build to launch-ready; `LAUNCH.md`) |

The business reason (owner): free clients from builders that lock them in (Duda, WordPress, LP). Tell clients plainly what they own
(domain, data, tracking accounts).

## The process that worked (Rainmaker, end to end)
1. **Content + brand intake** into an ICM knowledge folder (`icm/`), owner-supplied copy; facts with sources.
2. **Design first, cheap:** greyscale wireframes of genuinely distinct directions (design-tournament *method*, never its auto
   pipeline); owner picks; then a real design system (`icm/knowledge/DESIGN.md`) with tokens.
3. **SEO plan** with the skill: research -> `targets.json` (4 clusters) -> `plan-site` -> owner approves (`approve.mjs`, signed and
   locked) -> briefs per page.
4. **Build:** static generator `site-src/build.mjs` (partials, front matter, JSON-LD @graph, sitemap, robots naming 16 crawlers,
   llms.txt), then the launch layer: WebP + phone sizes, woff2, versioned assets with year-long cache, `_headers`, `_redirects`.
5. **Section-by-section design pass** at laptop + phone (see design rules below).
6. **Gates:** wf-shots (no errors, no overflow, 3 sizes), ui e2e, forms e2e (40 checks), estimator e2e, axe a11y (0 issues),
   media test (no collapsed photos), worker smoke (headers, redirects, 404), strict SEO gate 13/13 on a live build.
7. **Preview** (Cloudflare, noindex) -> client fact/legal sign-off -> domain switch -> `deploy-live.mjs` (refuses noindex builds,
   missing form backend, placeholders, draft banners).

## Design rules the owner enforces (repeatedly, with frustration when missed)
- Whitespace first; inner padding of cards/bars >= 28px on laptop; nothing flush to an edge.
- Phones: centre hero, section headers, closing panels, footer; body copy, cards, lists, forms left-aligned; buttons full width.
- No "AI slop": no pills, no dash before labels, no icon circles, no boxed card triplets, no gradient CTA panels, no uppercase
  tracked micro-labels, no em-dashes in copy. Stripping to plain text is also wrong ("you are not doing the design at all").
- Image-led, layered components (photo with an overlapping panel) won his approval on Rainmaker. Thick, round, clear headings
  (Poppins 600 chosen from a font lab).
- Never silently replace an approved design element. Animate only transform/opacity. Check at his real laptop viewport (~1536x730)
  and on a real phone.
- Design pass = page by page, section by section; bugs fixed is not a design pass.
- His bar: Luxury Presence 6/10; our best sample 6.5/10; he wants enterprise-grade, cinematic motion (OmniSkipX engine: GSAP,
  Lenis), app-like phone experience. Never show him a sample before looking at real captures yourself.

## Technical lessons (each one cost time once)
- **Cloudflare no longer creates new Pages projects on this account** (API "unknown error" 2026-10-23): production = Worker with
  static assets (`E:\Rainmaker\tools\deploy-live.mjs`). `_headers`, `_redirects`, root `/404.html` all work there (proven by
  `tools/worker-smoke.mjs`). The 404 page must use root-absolute paths.
- **Two `/*` blocks in `_headers` = the second replaces the first on Pages**: merge headers into one block.
- **The saved Cloudflare API token can deploy but cannot add zones, read DNS or change zone settings**; that was done in the
  dashboard by browser. A token with Zone:Edit + DNS:Edit would make onboarding fully scriptable (needed for step E).
- **Moving a domain to Cloudflare:** export DNS first (`E:\Rainmaker\tools\dns-export.mjs`); keep Google Workspace MX/TXT; GoDaddy
  SPF uses a helper record (`_spfm`) that does not survive the move: rewrite SPF to `include:_spf.google.com`; set GoDaddy-only
  records (payment links, `_domainconnect`) to DNS only; SSL Full (strict), Always HTTPS, TLS 1.2; turn OFF "Block AI bots" and
  managed robots.txt for visibility. The registrar login code goes to the account owner: plan for it.
- **Forms:** Google Apps Script web app + Sheet + email alert is a working free lead backend (`E:\Rainmaker\integrations\apps-script`,
  plus `Format.gs` for column widths). Guards: forms never fake success off preview hosts; the live build refuses without the
  endpoint; `method="post"` so no personal data leaks into URLs if JS fails.
- **Versioned asset URLs** (`?v=hash`) break test routes that match exact file names: match `config.js*`.
- **Speed:** the phone hero photo is the LCP; give it its own small file and preload it; `content-visibility:auto` on below-fold
  sections; measured with the skill's `snapshot-site` (home 4.9 s -> 3.5 s; other pages 1.8-3.3 s; target 2.5 s not yet met).
- **Silent failures need their own test:** a photo frame with auto margins and an absolutely-positioned image collapsed to 0x0 on
  phones while every other gate passed. `tests/media.e2e.mjs` now catches it.
- **SEO gate quirks:** organisation JSON-LD only on home/about/contact (else every page reads as "local"); a brief heading like
  "Proof: reviews and results" must be met honestly (no reviews published + how to verify the licence), never with invented proof.
- **Gmail by browser:** typed text can turn into Gmail keyboard shortcuts; fill compose fields by form_input/JS.

## Where the reusable code is (to lift into `engines/`)
- Site generator + launch layer + tests + deploy tools: `E:\Rainmaker\site-src\build.mjs`, `E:\Rainmaker\tests\`, `E:\Rainmaker\tools\`
- Client report renderer: `E:\Francine & Eli\tools\review-pdf.mjs`; report shape: `deliverables/docs/website-review-francine.md`
- ICM + librarian pattern: `E:\Francine & Eli\icm\`, `tools/icm-index.mjs`, agent copy in `skills/icm-librarian.agent.md`
- SEO/build skill (research, local, plan, approve, gate, snapshot, compare, code-check workers): `skills/programmatic-enterprise-web-performance/`
- OmniSuite (follow-up engine to rent by API key): `E:\Omnisuite final stage the CTO Packets\omnisuite-platform` (owner,
  2026-10-24, DECISIONS.md 8). Its engine is not yet upgraded to work as an API. Not to be confused with
  `D:\Omincom\Omnikom Platform build for the Suite system` (the separate "Omnikom Suite / OneOREAN" build).

## People and working style
- Abdo: CTO, makes the technical calls and sign-offs. Dave: CEO, owns Omnikom, business decisions and the client relationship
  (client emails go through him). Clients are not technical.
- Short, plain replies; detail only when asked. Questions as pickable options. Report real output; say NOT DONE / UNPROVEN.
- Cleanup: obvious leftovers can be deleted; if unsure, move to `archive/` with a note.
- Free tools only; build proprietary versions of anything paid.
