<!-- Template: the short lines an industry needs on the site, each with where it goes. Every licence number comes
from licences[] with its public-lookup source; without one it is [CHECK: ...]; without a number it is [MISSING: ...]. The
on-page checks for these lines live in the SEO skill's industry packs
(skills/programmatic-enterprise-web-performance/rules/industries/*.json); this file writes the words. -->

> **DRAFT - not legal advice.** Written by the site-legal skill on {{today}} for {{business.legal_name}} from the facts
> file {{facts_path}}. A licensed lawyer must read and approve it before it is published. Remove this box and the
> "Review notes" section only after that approval.

# Industry lines

| Line | Words | Where it goes | Rule |
|---|---|---|---|
| ... | ... | ... | ... |

Real estate (California): the responsible broker's name and licence number, and each agent's own licence number where the
agent is named, on the website as a first point of contact, in type no smaller than the smallest type on the page
[^ca-dre-first-contact]; the licensed designation ("broker" or "agent", "DRE") [^ca-dre-designation]; the Equal Housing
Opportunity statement or logo and a Fair Housing line [^us-fha-advertising] [^us-fha-logo]; listing data disclaimer from
`terms.content_disclaimers`.

Insurance (California): the producer's or agency's licence number where the rule requires it [^ca-ins-1725-5]; "Quotes are
not a contract of insurance; coverage is subject to the policy's terms and the carrier's approval" [CHECK: lawyer and
carrier wording]; the states where licensed (`business.states_served` and `licences[]`).

Mortgage or lending: NMLS ID of the company and each named loan officer [^us-nmls-id]; "Equal Housing Lender" where it
applies [^us-ehl]; state licence line [CHECK: per state].

Every industry: the line under the lead form is in form-consent.md, not here.

## Review notes (remove before publishing)
- **Facts this page relied on:** ...
- **Open questions for this page:** ...
- **Sources:** footnotes.
