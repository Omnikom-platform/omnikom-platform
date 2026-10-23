# ux (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- UX-001 P0 [cfg, browser] Every form is proven to reach its destination
- UX-003 P0 [html] Business facts oracle: on public pages (raw HTML visible text plus tel:/mailto: hrefs, outside programmatic family pages and factsIgnore regions), every detected fact of a kind whose key is present in business.json matc
- UX-004 P1 [html] Contact paths work on mobile: every visible occurrence on a public page of a phone number or email from business.json sits inside <a href="tel:<e164>"> (the exact E.164 value) or <a href="mailto:<address>">. A *visible
- UX-005 P1 [html] Error pages use the site: for each service with public or app surfaces, the 404 response to each RTE-004 Unknown-URL probe (/sg-{n} and /{p}/sg-{n}, web-delivery RTE-004), the 404 response to each RTE-006 probe URL (sg-
- UX-006 P1 [browser] No dead controls. Controls = on sampled public pages and app pages reached by flows, every visible (§ 3 *Visible element*), enabled (no disabled, no aria-disabled="true", not inert) element inside <header> or <main> tha
- UX-007 P1 [browser] Cross-browser public pages (profile nightly)
- UX-008 W [build] Built CSS and JS use no web-platform feature beyond baseline (web-features data pinned with the ruleset; "widely" = Baseline widely available, "newly" = newly available, a year = Baseline that year or earlier) unless gu
- UX-009 P1 [browser] No unintended visual change: with screenshots in quality/baselines/_main/visual/, every route group outside the diff's blast radius matches its _main screenshot at each refactor.visual.viewports within refactor.visual.m
- UX-010 P1 [browser] Measurement works: when hosts[] has an entry with purpose analytics, after accepting consent (privacy.consent.banner.acceptLabel; no consent step when the privacy pack is off or consent.required is false) every sampled
- UX-012 W [html, browser] Finishing touches on public pages
- UX-013 P1 (parts `green` and `regulated` P0) [html] No invented qualitative claims
- UX-014 P0 [html] No invented testimonials or people, on public pages outside factsIgnore regions
- UX-015 P1 [browser] Shown price = charged price: in each flow with journey: "checkout", every markPrice { locator, priceId } step's located text parses (ICU4X, 04 § 15 page locale) to the amount and currency of the business.json prices[] e
- UX-016 P1 [html] Consistent site chrome: per service and page locale (04 § 15 page locale), the page-level <header> and <footer> (the banner/contentinfo landmarks: not inside article, aside, main, nav or section, or role="banner"/"conte
- UX-017 W [html] AI-generated imagery in trust contexts is listed for review
- UX-018 W [html] Password reset is reachable: when the page at verifyEnv.auth.loginPath contains an input[type=password], it contains an <a> whose accessible name matches the ruleset per-locale password-reset-labels ("Forgot password?",
- UX-019 P0 [html] No invented trust marks or logo walls (UCPD Annex I item 2; uncertified sustainability labels banned in the EU from 2026-09-27; FTC endorsement rules)
- UX-020 P0 [browser, html, db] No fake urgency or scarcity (UCPD Annex I No
- UX-021 P1 [html] Affiliate and sponsored disclosure for readers (FTC 16 CFR 255.5, UK CAP Code, UCPD Annex I No
- UX-022 P1 [edge] Production conversion check at launch (with project.stage
- UX-023 P0 [html, cfg] No invented commercial terms: return, refund, warranty, guarantee, delivery, trial, cancellation, support-response and service-level promises come from business.json terms (03 § 14: { returns?: { windowDays, free? }, re
- UX-024 P1 [browser] Image rights register (17 U.S.C
- UX-025 P0 [cfg, html, browser] Tracking identifiers are the Operator's (a template-copied, placeholder or other client's measurement or pixel ID sends visitors to the wrong property; GDPR Art
- UX-026 P1 [browser] Search and filter forms work. *Search form* = a <form> whose method is absent or get that contains input[type=search], sits inside role="search" or a <search> element, or whose action resolves to an IDX-012 search route
- UX-027 P1 [cfg, html] Incentivised reviews are disclosed (Google review-snippet guidelines
