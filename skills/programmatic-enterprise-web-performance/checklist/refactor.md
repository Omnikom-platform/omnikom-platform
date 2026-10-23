# refactor (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- REF-001 P0 [cfg] When a signed quality/refactor.json exists or verify --against is given, the run requires an existing, signed baseline whose manifest commit is the diff base (04 § 5), captured before any change (for a rebuild of a live
- REF-002 P0 [baseline] Every routes.jsonl field, db/schema.sql and db/policies.json is equal after normalisation (§ 1), unless covered by an allowedChanges entry (what each kind covers
- REF-003 P0 [baseline, http] url-move changes: old URLs answer one hop with 301 or 308 (web-delivery.redirectStatus when that pack is on) to the new ones; new URLs answer the old URL's recorded status with mainTextHash, title, description, h1, robo
- REF-004 P0 [baseline, contract] API responses are unchanged except as declared
- REF-005 P2 [baseline] No regressions. Parts budget, a11y and security (all P2): budget: no route-group metric in budgets.json exceeds baseline + tolerance (*Ms and cls absolute, *Pct relative; API p95 per endpoint by apiP95Pct); a11y: no (ur
- REF-006 P0 [baseline] Every baseline flow still passes with the same observable outcomes
- REF-007 W [baseline] Changed files the baseline can't see are listed, so the Planner can add flows or examples before relying on equivalence
- REF-008 W [review] Refactors whose diff against the baseline commit changes > 50 files or > 2,000 lines run in steps; each step is verified against the same baseline before the next begins (bounded blast radius, easy rollback).
- REF-009 P1 [baseline, browser] Visual equivalence: screenshots of every route group at each baseline viewport (mobile and desktop by default) match the baseline within visual.maxDiffRatio (share of differing pixels, pixelmatch semantics: YIQ threshol
- REF-010 P0 [baseline, edge] Rebuilds keep every live URL: with a remote baseline, every recorded URL whose recorded status is 200 — a URL recorded with a 3xx status passes when it redirects in one hop (301/308) to its recorded location mapped onto
- REF-011 P0 [baseline] Redirects survive: the baseline's redirect sources (§ 2) include every source declared on the base branch (a missing one is a finding: re-capture the baseline), and on the new build each source answers with the same sta
- REF-012 P1 [baseline] Side channels unchanged: for each baseline flow, the captured emails (count, subject, link paths, text-part hash after flow normalisation, § 1) and the third-party request set (host + event name) equal the baseline, unl
- REF-013 P0 (part `sw-cache` P1) [baseline, http, browser] Old service workers are retired
- REF-014 P1 [baseline, http] Re-platforming keeps image URLs (Google Search Central
