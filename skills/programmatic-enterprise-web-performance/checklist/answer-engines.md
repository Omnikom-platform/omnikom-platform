# answer-engines (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- AEO-001 P1 [html, http] No unintended snippet restrictions on indexable pages
- AEO-002 P1 [html, http, edge] Entity identity: the homepage of each public service origin has an Organization (or subtype) JSON-LD node whose url is that origin, and, on indexable pages, all Organization nodes (exact @type Organization, or the subty
- AEO-003 P1 [html, http] Authors: Article/BlogPosting/NewsArticle authors are Person nodes with name and url pointing to an existing author page (matching authors.pagePattern, 200, indexable) that carries Person markup. Without authors.pagePatt
- AEO-004 W [html] Answer-ready structure for each declared questions entry
- AEO-005 W [html, diff] Citable statistics: on non-programmatic indexable pages, paragraphs stating percentages, currency amounts or "according to …" contain or are followed (same section) by at least one outbound link to a source. Part added
- AEO-006 P1 [html, site] Freshness consistency: where a visible date (04 § 15 visible dates), JSON-LD dateModified/datePublished and sitemap <lastmod> exist for a page, they agree to the day in pairs: the visible "updated" date = dateModified =
- AEO-007 P1 [http] IndexNow (when indexNow.enabled)
- AEO-008 W [edge, review] Crawler reach at the edge: in the edge pass, sampled indexable pages requested with the userAgent of each ai-agents.json token that aiCrawlers allows (web-delivery IDX-008) don't return 403/429 or a challenge page (cf-m
- AEO-009 P1 [html, browser] Primary content is text: an indexable page whose <main> has < 50 UAX #29 words of text (excluding <canvas> fallback content and iframe content) is a finding when <main> contains an <img> with alt > 100 characters (html)
- AEO-010 P1 [html] Data tables: every <table> in <main> without role="presentation"/"none" has ≥ 1 <th> or a scope attribute; every element in <main> with role="table" or "grid" has ≥ 1 descendant with role="columnheader" or "rowheader".
- AEO-012 P1 [baseline] No fake freshness: for each page present in this run and in _main/routes.jsonl (skipped(no-main) without it) whose normalised <main> text hash is unchanged (mainTextHash: NFKC, whitespace-collapsed, with <time> elements
- AEO-013 W [html] Citation anchors: on Article/BlogPosting/NewsArticle pages with > 1,000 <main> words, every <h2> and <h3> in <main> has an id that is unique on the page and doesn't match a ruleset auto-generated id pattern (autoIdPatte
- AEO-014 P0 (part `hidden-text` P1) [browser, html, http] No hidden or AI-targeted text on indexable pages (Google spam policies
- AEO-015 P1 [browser] Fragment deep links work (Google "Read more" deep links to a section need immediately visible content, no script-controlled scroll reset on load and a preserved hash)
