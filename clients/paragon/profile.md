# Paragon Alternative Capital ("PAC Funding"): profile

Record owner: Clients department (`docs/departments/clients.md`). Project folder (evidence and work, never written from here):
none yet. Every line below names its source: a public page (URL + date read) or the owner's words (date). Public sources only (this
repository is public). All pages were read on 2026-11-10 between 20:27 and 20:45 UTC in the browser (the site needs JavaScript;
the `reach` text reader got no text from it), navigation and page reads only.

## Who they are
| Item | Value | Source |
|---|---|---|
| Legal / trading name | PARAGON ALTERNATIVE CAPITAL LLC, a California LLC (202462616675, filed 2024-06-12, Active, good standing); "Paragon Alternative Capital" on the site and both channels; "PAC Funding" is the TikTok handle (@pacfunding) and the owner's name for them. No Florida entity of that name | https://bizfileonline.sos.ca.gov/search/business and https://search.sunbiz.org/ (read 2026-11-10 22:02 to 22:05 UTC); https://www.paragonaltcap.com/, https://www.youtube.com/watch?v=opH4w0_sYo4, https://www.tiktok.com/@pacfunding, read 2026-11-10; owner via the head of operations 2026-11-10 22:24 |
| Industry (and the compliance pack it falls under, `sops/clients/site-scope.md` section 3) | business funding broker: the site says it matches businesses with "75+ vetted lenders" for merchant cash advances, SBA loans, equipment financing, business lines of credit, revenue-based financing and invoice factoring. No pack exists for business lending, so Default applies until one is written | https://www.paragonaltcap.com/ ("OUR SERVICES"), read 2026-11-10; `sops/clients/site-scope.md` lines 34 to 47 |
| Where they work (cities, areas) | address shown: 344 N 7th St, Sacramento CA 95814; the site says it serves all 50 US states. The site's terms say they are governed by the laws and courts of Palm Beach County, Florida (why Florida is unknown) | https://www.paragonaltcap.com/ (contact block, footer), https://www.paragonaltcap.com/terms section 9, read 2026-11-10 |
| People (name, role, licence number where regulated) | the registered agent on the state filing is an individual, Michael Vorobyev (not necessarily an owner); owners, managers and staff unknown (they are in the Statement of Information, not downloaded); no licence number anywhere (DFPI: none; NMLS: BLOCKED by its human check) | `facts.md`; bizfile, DFPI and NMLS read 2026-11-10 |
| Contact used for the work (person, email, phone) | public business contact only: +1 (279) 264-9446, Contact@ParagonAltCap.com. Who at Paragon we work with is unknown | https://www.paragonaltcap.com/ (contact block), read 2026-11-10 |
| Current website, stack and who runs it | https://www.paragonaltcap.com/: a single-page React app (the page's root element carries React's `__reactContainer` key; one script, `/assets/index-<hash>.js`; the HTML sent before JavaScript is a 1,723-byte shell with an empty `#root`), served by Vercel (`server: Vercel`, `x-vercel-id`). Every path, `/sitemap.xml` included, returns the same shell; `robots.txt` allows all. Who built or runs it is unknown | browser read of https://www.paragonaltcap.com/ and its response headers, 2026-11-10 |

## How we work with them
| Item | Value | Source |
|---|---|---|
| Relationship (prospect / client in onboarding / live / monthly service / offboarded) | new client (work order 40) | owner via the head of operations, 2026-11-10 22:24 |
| Who at Omnikom owns the relationship (Dave) and who signs off (Abdo) | the links came from the owner's partner; owner of the relationship not yet named in this record | owner via the head of operations, 2026-11-10 22:24 |
| Agreement (what was agreed, when, where the document is; or "no agreement yet") | no agreement on file | none |
| What they said they want (in their words, told or seen) | unknown: nothing recorded yet | none |

## Lines of work and compliance notes (internal, never client-facing without a source)
- Lines shown on the site: merchant cash advance ($5K to $6M), SBA loans (up to $25M), equipment financing (up to 100%), business
  line of credit (up to $6M), revenue-based financing, invoice factoring (up to 95% advance). Source: https://www.paragonaltcap.com/
  "OUR SERVICES", read 2026-11-10. These are the site's claims, not verified.
- No licence, licence number or regulator is shown on the site, the terms, the privacy page or either channel (read 2026-11-10).
  The California DFPI licence search finds none for them; NMLS is BLOCKED by its human check (`facts.md`). Which licences and
  disclosure rules apply to a business funding broker in California and Florida is a research item before any client-facing page,
  not a guess here.
- The site's numbers ("$500M+ capital deployed", "10,000+ businesses funded", "75+ vetted lenders", "24hrs average approval") and
  its three named testimonials (one says "Client since 2016") are the site's own claims, unverified. See `facts.md` "Not facts yet".

## Where things are
| What | Path |
|---|---|
| Audit (report, evidence) | `clients/paragon/audit-2026-11/` (SEO and audits department, work order 40; raw data outside git in the skill's `site-checks/`) |
| Facts and research | `clients/paragon/facts.md` |
| Approved plan | none yet |
| Draft site | none yet |
| Preview URL (noindex) | none yet |
| Leads work | none yet |
| Launch ledger / checklist | none yet |
