# targeting (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- TGT-001 P1 (part `stale` W) [targets] The targets and plan are valid and traceable
- TGT-002 P1 [targets] Every planned page exists: each site.json page answers 200 at its planned URL, is indexable, and is in the site graph. A planned page that answers 404 or redirects is missing-page, with its cluster, value and priority.
- TGT-003 P1 [targets] No cannibalisation: no indexable page other than a cluster's planned page has a <title> or <h1> containing that cluster's primary-query head term (web-delivery § 12) with a page type compatible with the cluster's intent
- TGT-004 P1 [targets] The planned page carries its query where engines and people look first
- TGT-005 W [targets] Term coverage: the page's main content covers at least targeting.minTermCoverage of its brief's requiredTerms (06 § 9.5), not counting terms the brief waived. The finding lists the missing terms.
- TGT-006 P1 [targets] Outline: every section of the brief's outline appears as a heading (h2–h4) of the planned page whose text contains the section's head term, in the brief's order. Sections the brief marks optional may be absent.
- TGT-007 P1 [targets] Planned internal links exist: for each site.json link { from, to, anchor }, the raw HTML of from has an a[href] to to (04 § 10 normalisation) whose anchor text (LNK-004 definition) contains the planned anchor's head ter
- TGT-008 P1 [targets] The brief's schema type is on the planned page
- TGT-009 W [targets] Depth: the main-content word count of the planned page is at least the brief's wordRange minimum × (1 − targeting.wordRangeSlack). The finding gives the count, the range and the winning pages it came from.
- TGT-010 P1 [targets] The brief's proof facts are on the page
- TGT-011 W [targets] Coverage of priority demand: the top targeting.priorityPages clusters by priority (06 § 9.4) each have a built planned page. The finding lists the unbuilt ones with their value.
- TGT-012 P1 [targets] Intent fit: the planned page's type (06 § 9.3, applied to the page) is compatible with its cluster's intent (03 § 22.2 table): for example a transactional cluster's page has a product, offer, or a form or CTA from the b
