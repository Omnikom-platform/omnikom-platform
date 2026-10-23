# performance (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- PRF-001 P2 [browser] Per route group (aggregation: 04 § 6.2): parts lcp (LCP ≤ lcpMs), cls (CLS ≤ cls), tbt (TBT ≤ tbtMs) and seo (indexable pages, 04 § 15 *Indexable page*: score ≥ seoScore over the Lighthouse SEO-category audits other tha
- PRF-002 P2 [browser] Interaction responsiveness: for each declared flow's main Chromium run (not A11-019 keyboard replays), INP (web-vitals onINP, reportAllChanges, final value at flow end), measured from flow start to flow end without CPU
- PRF-003 P2 [browser] LCP image handling, at the Lighthouse preset viewport
- PRF-004 P2 [browser] Layout stability: Lighthouse cls-culprits-insight passes; every <video>, <iframe>, <embed> and <object> in the final DOM has numeric width and height attributes, or a computed aspect-ratio other than auto, or a declarat
- PRF-005 P2 [browser] Fonts, on sampled pages: every @font-face src URL in loaded stylesheets is same-origin with a service origin or on a hosts[] entry with purpose assets (part self-hosted); the number of distinct @font-face font-family na
- PRF-006 P2 [browser] Render-blocking time ≤ renderBlockingMs (LCP savings estimated by render-blocking-insight) and third-party main-thread time — the sum of mainThreadTime (ms) over the entity rows of third-parties-insight other than the e
- PRF-007 P2 [html] Every <img> in the HTML of sampled pages has numeric width and height attributes (owner of image dimension attributes; missing-element showing the selector; alt text is owned by A11-007).
- PRF-008 P1 [http, edge] Hashed static assets (adapter build manifest, or filenames matching [.-][a-f0-9]{8,}\.)
- PRF-009 P1 [http] Every same-origin response fetched by the crawl and sampled-page loads with status 200, a Content-Type of text/html, text/css, */javascript, application/json, application/*+json or image/svg+xml, and an uncompressed bod
- PRF-010 P2 [build, browser] Per-route first-load JavaScript ≤ scriptBytes and CSS ≤ cssBytes (the gzip level-9 compressed size of the JS and CSS files the adapter bundle manifest lists for the route's initial load, summed per route; route group va
- PRF-011 P2 [http] API latency under lab load: each operation of the service's data-api contracts with method GET, sent api.requests times with api.concurrency in flight, each request built by contract request generation (04 § 15) for its
- PRF-012 P1 [html, browser] List pages are paginated or bounded
- PRF-013 W [review] Raising a cache lifetime or disabling a feature to meet a budget is recorded in the report with its impact.
- PRF-014 W [review] Field RUM (web-vitals or equivalent) reports LCP, INP and CLS per route group in production (production monitoring itself is a separate product).
- PRF-015 P2 [browser] Images in <main>, at the Lighthouse preset viewport and DPR
- PRF-016 P2 [http] Server response time: per route group of non-programmatic routes, warm TTFB (time from sending the request on an already established keep-alive connection to the first response byte; one discarded request, then the medi
- PRF-017 P2 [browser] Offscreen media deferred: at the Lighthouse preset viewport after load, every rendered <img> and <iframe> whose bounding box starts at or below the first viewport's bottom edge has loading="lazy". A facade that inserts
- PRF-018 P2 [browser] Back/forward cache: for sampled public pages, navigating to the first same-origin <a href> target in document order that is not the page itself and not a fragment-only link, then back, restores from bfcache (CDP Page.ba
- PRF-019 P2 [browser] Page weight per route group (aggregation 04 § 6.2)
- PRF-020 W [data] Field Core Web Vitals: for each production.origins host with quality/data/crux/<host>.json (§ 3), every record's p75 largest_contentful_paint ≤ lcpMs, interaction_to_next_paint ≤ inpMs and cumulative_layout_shift ≤ cls
