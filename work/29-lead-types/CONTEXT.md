# 29 lead types per industry, for the CRM's "Lead type" column (research)

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/lead-types. Status: OPEN (head of operations 2026-11-09
20:44, from the owner 20:40; ahead of work order 28; platform work order 20 builds A16 from it).

## Why
The CRM needs a "Lead type" column: what the visitor asked or enquired about. The owner expects about 13 to 15 types for real
estate, plus "Enquiry" for a visitor who is only asking. Insurance and financial services (client Rainmaker) come next. Platform
(HEAD_Platform-build_2026-11-09, its work order 20, A16) builds the column from this list, so every type must be real: each one
needs a name, the form or question that produces it, and a public source.

## Inputs (load these, nothing else)
- `CLAUDE.md` (rule 4, polite public reading), `docs/departments/seo-and-audits.md` (Rules only)
- `docs/product/5-crm.md` (how columns, industry fields and statuses are described; match its voice), `docs/product/1-product.md`
  row A16
- ELEV8: `clients/elev8/sites.md` (rows "Forms and lead flows", lines 28 and 41), `clients/elev8/facts.md`; read only, the
  built draft's forms in `E:\Alex Sevilla\draft-site\site` (find the form and wizard definitions; never edit there)
- Rainmaker: `clients/rainmaker/*.md` (what it sells, its forms if written)
- Public web only: published lead types and lead sources from CRMs for these trades (Follow Up Boss, kvCORE / BoldTrail, Luxury
  Presence, Lofty, Sierra Interactive, Real Geeks for real estate; AgencyZoom, EZLynx, Salesforce Financial Services Cloud,
  Redtail, Wealthbox for insurance and financial), their help-centre pages, industry articles. WebSearch and WebFetch are fine.
  No logins, no paid APIs, no forms submitted. A host that answers 403 or a bot wall or CAPTCHA: record it BLOCKED (host, status,
  date), do not retry, do not read it through a browser; use what search results and other public pages say instead. One 429 =
  stop that host.

## Steps
1. Real estate: list the lead types, aiming at what the visitor asks (buy, sell, home value, cash offer, showing request, a
   question about a listing, rent, financing or pre-approval, relocation, open house, new construction, investor, agent
   recruiting, and so on), plus "Enquiry" (a visitor only asking; source: the owner, 2026-11-09 20:40, through the head of
   operations). Merge what are the same thing under different names (say which names merged). Each type has: `id` (kebab),
   `name` (plain words, as on screen), `producedBy` (which form, tab, wizard or question produces it), `examples` (one or two
   phrasings a visitor uses), `sources` (at least one: `{ url, readAt, says }`, where `says` is the page's own words, short).
   A type with no source is not listed; put it under `unsourced` with why it was considered. The owner's 13 to 15 is a
   guide, not a target: do not pad and do not cut to fit.
2. Check ELEV8: map each of its forms and tabs (Buyers, Sellers, Cash offer, Contact, Listing questions, and any other the draft
   has, with file and line) to a type. A form with no type is a gap; say so.
3. Insurance and financial services: the same for Rainmaker's trade (quote requests per line of cover, claims or policy
   questions, review, retirement or investment advice, mortgage, consultation booking, and so on), checked against Rainmaker's
   written forms if any.
4. Files in `work/29-lead-types/`:
   - `real-estate.json` and `insurance-financial.json`, shape `{ industry, readAt, types: [...], unsourced: [...], merged: [...],
     blocked: [{ host, status, date, what }], checkedAgainst: { <client>: [{ form, file, type }] } }`
   - `draft-5-crm-section.md`: a short section for `docs/product/5-crm.md`, in its voice: what the "Lead type" column is, how a
     form sets it, "Enquiry" as the default, and the two lists by name (the data files hold the sources). No em dashes.
   - `proof.md`: every URL read with date and status, the BLOCKED list, a node count of types with and without a source (without
     must be 0), and 0 em dashes in your files (`String.fromCharCode(0x2014)` counter).
5. Do NOT commit or push. Report to your head with the file paths and the type counts.

## Outputs
- `work/29-lead-types/`: this file, the two data files, the draft section, `proof.md`. Nothing else: not `docs/product/`,
  not `clients/`, not the ELEV8 draft, not the skill.

## Findings (send to your head, who routes them; never fixed here)
1. ELEV8 "Ask about this home" opens the contact wizard with topic forced to Buy (`wizard.js:202`), so the form says Buy for what is a
   listing question. The type cannot come from `topic` alone; platform needs the cta/flow or a new topic value. Platform/D owns it.
2. A valuation tool that gets only an address (Real Geeks "Address Only Lead", Sierra "partial lead") has no name, email or consent
   text, so `capture_lead` would refuse it (5-crm.md step 4). Not a lead type here; a platform decision whether to keep such a row.
3. ELEV8 has no form for 8 of the 15 real estate types (showing request, rent, rent out, relocation, open house, new construction,
   investing, join the team). Not padding the list; a site shows only the types it offers. Do not build forms just to fill the list.
4. Rainmaker: the Sheet files annuities and retirement in one tab ("Annuities & retirement", `Code.gs:29`); this list keeps them
   apart. Investment management must never show on Rainmaker (it may not claim investment-adviser status, `clients/rainmaker/sites.md:26`).
   `Code.gs:9` header comment says the agent tab is "Agent interest"; `CONFIG.AGENT_SHEET` (`Code.gs:25`) is "Recruitment"; the comment is stale.
5. statuses.json has one extra key, `needsText` (true only for "Interested in something specific": in what). Not in the order's shape.
6. The five-value status (5-crm.md:62) becomes 19 values: a schema change (enum or lookup) for platform, and the open owner question
   on custom stages (A16, "Status board") now has a concrete list to decide on.
7. "Do not contact" should also stop automated messages; recorded as proposed in the draft section, platform settles it.
8. I put help.followupboss.com 360012456793 into two sub-agent briefs; the host answered 403 twice. See proof.md.
9. I read three Rainmaker files outside the Inputs list (`contact.html`, `careers.html`, `Code.gs`, read only) because the form options
   live only there.
10. Quotes were copied by sub-agent readers and 32 pairs re-checked (all exact); the rest are UNPROVEN beyond that (proof.md).

## Added 2026-11-09 20:50 (owner 20:48, through the head of operations): the Status column
6. Research the Status column too: the full set of outcomes a lead goes through, per industry. The owner named these (source:
   the owner, 2026-11-09 20:48, through the head of operations): not contacted yet, contacted (by whom), answering machine, no
   answer, call back, follow-up, qualified, not qualified, not interested, interested in something specific. Cover the rest from
   public sources (call-centre disposition lists; the published lead statuses or stages of Follow Up Boss, kvCORE / BoldTrail,
   HubSpot, Salesforce and the like): for example voicemail left, wrong number, do not contact, appointment set, and so on.
   Each status has: `id`, `name`, `means` (one plain line), `needsDate` (true for call back and follow-up, and any other that
   schedules a next touch), `needsWho` (true where the status records who did it, such as contacted), `stage` (where in the
   lead's path it sits: new, working, outcome), and `sources` (as in step 1). Merge the same status under different names and
   say which. Where real estate and insurance and financial services differ, say so; otherwise one shared list.
   Files: `work/29-lead-types/statuses.json` (shape `{ readAt, statuses: [...], perIndustry: { <industry>: [ids] }, unsourced,
   merged, blocked }`), and a Status part in `draft-5-crm-section.md`. Count statuses with and without a source in `proof.md`.
- H1 (head, 2026-11-09 21:07): re-fetched two quotes. leadcapture.io cash-offer: 200, quote present. agencybloc.com policy-review URL
  answers 301 to a different page (insurance-agents-guide-to-social-media), where the quote is; store the final URL. The policy-review
  source is a recruiting article, a weak source for a lead type: platform should treat it as such.
