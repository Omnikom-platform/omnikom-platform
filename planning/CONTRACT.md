# Content contract: what is proven, what is open (2026-10-28)

Step 1 of DECISIONS 13. Detail, file list and pasted run outputs: `contracts/README.md`. **Not committed: waiting for the owner.**

## Proven (each by a command whose output is in contracts/README.md)
- One generic contract: a shared core (business details, pages, articles, team, reviews, Q&A, legal text, photos, redirects, lead
  inbox) + each site's own collections, generated from its approved SEO plan and a field library keyed by schema.org type. No
  industry schema was written (DECISIONS 3).
- Locked fields (licences, disclosures, consent, legal name): a client edit is refused; Omnikom staff need a recorded sign-off.
- Draft / publish / version history / rollback; a draft never changes the live site; a build reads only its own workspace's
  published rows; another workspace's rows are "not found" (TENANCY 2-3, as an in-memory model).
- Placement rules: ELEV8's listing decision expressed as rules (active -> home "Our listings", its city guide; sold -> "Recently
  sold"; delete -> 301 to the city guide) and proven on a synthetic site.
- Dashboard screens generated from the contract for all three real sites and 15 industries.
- Tests can fail: 114 checks; 73 broken copies of the code (every rule switched off, plus placement / build-leak / derivation
  breaks) all caught by a failing assertion.
- Real sites (read only): ELEV8 contract from its approved plan + `/blog` (42 pages); Rainmaker 11/11 pages mapped, 3/3 product disclosures
  located, its contact page's second form found by the check; VTV's real data fits (28/28 listings, 81/81 URLs) and the contract
  flags its real gaps (unsourced census facts, long titles, reviews without date/permission, photos without alt text).
- 15 industries (OmniSuite's 13 niches + insurance + cash home buyer): 15/15 PASS on paper plans; every niche's website-askable
  OmniSuite field is fed by its lead form.

## Open
1. The SEO plan stage (skill `plan-site`) should write the entity declaration (`entities.json`); today it is written per site.
2. Step 3 (database): Supabase tables + RLS reproducing `contracts/store.mjs`, and the four TENANCY 4 tests against the real DB.
   NOT DONE.
3. Upload pipeline (image width, EXIF strip, rights tick): required at publish, not built.
4. No section kind for interactive tools (calculators, estimators).
5. Locked values inside lists are checked per whole field, not per row.
6. ELEV8 answers applied 2026-10-28 (Recently sold 4 per place, sold price only when ticked, wording list, `/blog`); `/blog`
   still has to be added to the approved plan in the ELEV8 project.
7. The industry run uses paper plans; each industry is proven for real only when a real client's plan runs through it.
