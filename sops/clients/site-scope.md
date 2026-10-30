# SOP: what goes into every V2 website, by industry (DECISIONS 18, owner 2026-10-28)

## 1. The core (every industry)
- **Pages:**
  - Home.
  - Team and a profile per person.
  - Services.
  - City and area pages, from the approved search plan.
  - Reviews.
  - FAQ.
  - Articles.
  - Contact.
  - Legal: privacy, terms, accessibility, plus the industry's own disclosures.
- **Leads:** every form sends to the Omnikom CRM in the client's dashboard. There are no third-party form tools.
- **Quality:** the skill's build lane, the 547-rule checker and the 13 launch gates. A failing rule is our fix.
- **Lifecycle:** built once as a noindex preview (DECISIONS 16). The client gives facts and access only (DECISIONS 17,
  `sops/clients/client-questions.md`). Launch takes about a day: logins, domain, Search Console, noindex off, strict gate.

## 2. Who writes what
| Content | Who | How |
|---|---|---|
| Structure, page wording, city and area pages, FAQ, legal drafts, SEO, schema, design | **Omnikom** | built from the approved plan; sourced facts only |
| Services, articles and blog posts, the industry collection (e.g. listings), reviews | **The client** | through their **user dashboard** (the same place as the CRM), in the content contract's shape |
| Facts only the client knows, plus access | **The client** | the question sheet (max 12 questions) |

**Placeholders.** Every section the client feeds from the dashboard ships as a clearly marked placeholder in the right place,
like the sample cards in the ELEV8 draft. The section fills itself from the dashboard rows through the contract's placements.
There is no recode and no client wording review of our pages.

**Cut for good:** features of the old site that are not ours to run, such as IDX or Brivity home search, old form tools, and
third-party widgets. Reviews are not cut: they come from the client's Google Business Profile or another verified source
(question 8 of the sheet), and we place them.

## 3. Per industry (the collections the client feeds, from `contracts/industry-run/RESULTS.md`)
| Industry | Client-fed collections (besides services, articles, reviews) | Compliance rules |
|---|---|---|
| Real estate | listings (posted by the client, not IDX), areas | skill `rules/industries/real-estate-agent` |
| Insurance | products, areas | `insurance-agency` |
| Cash home buyer | situations, purchases | `cash-home-buyer` |
| Dental / chiropractic / med-spa | treatments or conditions, plans/offers, results (med-spa before/after) | NOT BUILT yet (default rules until written) |
| Home services / cleaning / solar | services, projects, plans, systems and incentives (solar) | NOT BUILT yet (default rules until written) |
| Legal | practice areas, results | NOT BUILT yet (default rules until written) |
| Fitness / coaching | programs, classes, memberships | NOT BUILT yet (default rules until written) |
| Agency / B2B | services, sectors, work | NOT BUILT yet (default rules until written) |
| Default | services, areas | default (no industry pack) |

A new industry adds a row here, plus its contract pack and its compliance rules. The question sheet may add at most 2 topics for it.
