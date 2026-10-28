# Industry run: one contract procedure, 15 industries

Run: `node contracts/industry-run/run.mjs` (2026-10-28). Generated, not hand-written: each row below is the output of the same
generator, validator and screen builder used for ELEV8, Rainmaker and VTV. The plans are **paper plans** (what a typical plan for that
business declares; no real client), so this proves the contract can express each industry, not that a real plan for it was run.

Per industry: contract valid · one synthetic row per collection and per page passes the **publish** checks · the lead form feeds the
OmniSuite niche custom fields a website can ask for (fields the CRM keeps itself, like Last Intent Signal or Conflict Check Status, are excluded).

| Industry | Result | Site collections (type) | Pages / types | Placements (derived) | Locked fields | Lead form -> OmniSuite | Screens |
|---|---|---|---|---|---|---|---|
| real-estate | PASS | areas (Place), listings (RealEstateListing) | 9 / 6 | 14 (12) | 9 | 5/5 askable niche fields fed by the form | [screens/real-estate.md](screens/real-estate.md) |
| insurance (not an OmniSuite niche; compliance rules: skill rules/industries/insurance-agency) | PASS | areas (Place), products (FinancialProduct) | 5 / 4 | 9 (7) | 10 | n/a (no OmniSuite niche) | [screens/insurance.md](screens/insurance.md) |
| cash-home-buyer (not an OmniSuite niche; compliance rules: skill rules/industries/cash-home-buyer) | PASS | areas (Place), situations (Service), purchases (CaseStudy) | 5 / 4 | 13 (10) | 9 | n/a (no OmniSuite niche) | [screens/cash-home-buyer.md](screens/cash-home-buyer.md) |
| agency | PASS | services (Service), work (CaseStudy) | 3 / 3 | 11 (8) | 9 | 1/1 askable niche fields fed by the form | [screens/agency.md](screens/agency.md) |
| b2b | PASS | solutions (Service), sectors (Service), work (CaseStudy) | 3 / 3 | 14 (10) | 9 | 3/3 askable niche fields fed by the form | [screens/b2b.md](screens/b2b.md) |
| chiropractic | PASS | areas (Place), conditions (Service), plans (Offer) | 5 / 4 | 10 (7) | 10 | 3/3 askable niche fields fed by the form | [screens/chiropractic.md](screens/chiropractic.md) |
| cleaning | PASS | areas (Place), services (Service), plans (Offer) | 5 / 4 | 10 (7) | 9 | 4/4 askable niche fields fed by the form | [screens/cleaning.md](screens/cleaning.md) |
| coaching | PASS | programs (Course) | 3 / 3 | 8 (6) | 9 | 2/2 askable niche fields fed by the form | [screens/coaching.md](screens/coaching.md) |
| default | PASS | areas (Place), services (Service) | 5 / 4 | 9 (7) | 9 | 0/0 askable niche fields fed by the form | [screens/default.md](screens/default.md) |
| dental | PASS | areas (Place), treatments (Service), plans (Offer) | 5 / 4 | 10 (7) | 10 | 4/4 askable niche fields fed by the form | [screens/dental.md](screens/dental.md) |
| fitness | PASS | areas (Place), programs (Course), classes (Event), memberships (Offer) | 5 / 4 | 11 (7) | 9 | 2/2 askable niche fields fed by the form | [screens/fitness.md](screens/fitness.md) |
| home-services | PASS | areas (Place), services (Service), projects (CaseStudy) | 5 / 4 | 13 (10) | 9 | 3/3 askable niche fields fed by the form | [screens/home-services.md](screens/home-services.md) |
| legal | PASS | areas (Place), practice (Service), results (CaseStudy) | 5 / 4 | 12 (9) | 10 | 2/2 askable niche fields fed by the form | [screens/legal.md](screens/legal.md) |
| med-spa | PASS | areas (Place), treatments (Service), results (BeforeAfter), offers (Offer) | 5 / 4 | 11 (7) | 10 | 2/2 askable niche fields fed by the form | [screens/med-spa.md](screens/med-spa.md) |
| solar | PASS | areas (Place), systems (Product), incentives (Service), projects (CaseStudy) | 5 / 4 | 16 (12) | 9 | 4/4 askable niche fields fed by the form | [screens/solar.md](screens/solar.md) |

Result: 15/15 industries PASS.

Locked fields present in every industry (core): settings.legalName, settings.licences, settings.footerNotice, pages.path, pages.type, team.licence, notices.text, notices.approvedBy, notices.approvedOn. Industry extras: real-estate: none; insurance: products.availableIn; cash-home-buyer: none; agency: none; b2b: none; chiropractic: team.credentials; cleaning: none; coaching: none; default: none; dental: team.credentials; fitness: none; home-services: none; legal: team.barAdmissions; med-spa: team.credentials; solar: none.
