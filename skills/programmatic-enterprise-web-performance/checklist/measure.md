# measure (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- MSR-001 W [measure] Target pages are indexed: each planned page's index status (Search Console URL Inspection) is indexed. Otherwise the finding gives the coverage state the engine reports.
- MSR-002 W [measure] Ranking: each target query whose position worsened significantly (06 § 9.8), or which ranks outside measure.topPositions. The finding gives the position, the change, and the domains now above us.
- MSR-003 W [measure] Unplanned demand: a Search Console query with ≥ measure.minImpressions impressions in the window, matching no cluster's queries (whole words after NFKC and lowercasing). It is proposed for the next research run (TR-211)
- MSR-004 W [measure] Low click-through: a target query at position ≤ 5 whose CTR is below measure.ctrFloorRatio × the expected CTR for that position (ruleset ctr-curve.json), with ≥ measure.minImpressions impressions. The finding points at
- MSR-005 W [measure] AI visibility: a cluster question whose citation rate fell significantly, or is 0 while a competitor is cited. The finding gives the provider, the cited sources and the date.
- MSR-006 W [measure] Field speed: a planned page or origin whose p75 LCP, INP or CLS (crux) is "needs improvement" or "poor", or got worse by status (06 § 9.8).
- MSR-007 W [measure] Authority: a significant loss of referring domains since the last run, and the link-intersect prospects of the off-site plan (TR-233) still not linking.
- MSR-008 W [measure] Cannibalisation in results: two or more of the site's URLs received impressions for one target query in the window, and the planned page is not the one with the most impressions.
- MSR-009 W [measure] Traffic without conversions: among the measure.conversionPages target pages with the most clicks, a page with clicks but no conversion of its cluster's goal (analytics) in the window.
- MSR-010 W [measure] Local consistency: a business directory listing (TR-218) whose name, address or phone differs from business.json, or a market where the business has no listing on a directory of ruleset citation-sources.json.
