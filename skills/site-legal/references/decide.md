# Which rules apply: the decisions

Answer these in order from the facts file. Each answer is **applies**, **does not apply** or **undecided** (a fact it needs
is missing or unsourced), with a one-line reason naming the facts used and the rule ids. Write every answer into
`summary.json` `decisions`. An undecided decision is drafted as if it applies and marked `[CHECK: include only if ...]`;
it never turns into a denial of a practice.

| # | Question | Facts used | Applies when | Rules |
|---|---|---|---|---|
| D0 | Escalations? | `sensitive_data`, `sells_personal_info`, `shares_for_cross_context_ads`, `children.*`, `industry`, `business.customers_outside_us`, `after_form.prerecorded_or_ai_voice` | any escalation in SKILL.md "Guardrails" is true: list it for the lawyer, keep drafting the rest | - |
| D1 | Does the CCPA apply? | `size.annual_gross_revenue_usd`, `size.california_consumers_per_year`, `size.revenue_share_from_selling_or_sharing_data`, `shares_for_cross_context_ads` | revenue over the threshold in force, OR 100,000+ California consumers or households bought, sold or shared a year, OR 50%+ of revenue from selling or sharing | CA-CCPA-THRESHOLD |
| D1a | Is part of the data exempt as financial data? | `industry` | insurance, mortgage or finance: always undecided, a lawyer's question | CA-CCPA-GLBA-EXEMPT, CA-CCPA-INSURANCE |
| D2 | Does CalOPPA apply? | `business.states_served`, the form | the site collects personal details from California residents (any lead form) | CA-CALOPPA-CONTENT |
| D3 | Does another state's privacy law apply? | `business.states_served`, `size.residents_per_year_by_state`, `size.annual_gross_revenue_usd`, `size.sba_small_business`, `sensitive_data` | for each state served, its threshold in `rules-us-states.md` is met (several count residents' records; Texas and Nebraska reach any non-small business) | the state's rule id |
| D4 | Do we need opt-out links and the GPC paragraph? | D1, `sells_personal_info`, `shares_for_cross_context_ads`, `sensitive_data` | D1 applies AND (sells OR shares OR uses sensitive data beyond the allowed purposes) | CA-CCPA-OPTOUT-LINK, CA-CCPA-GPC, CA-CCPA-OPTOUT-15, CA-CCPA-COOKIE-BANNER |
| D5 | Which request rules does the privacy-choices page state? | D1, D3, `privacy_request_handling.offer_to_everyone` | D1 applies: state them as the law's ("California law gives you"). D1 does not apply but `offer_to_everyone`: state them as the business's own promise, with the same clock. Neither: a short contact-us page | CA-CCPA-RIGHTS, CA-CCPA-TIMELINE, CA-CCPA-METHODS, CA-CCPA-VERIFY, CA-CCPA-AGENTS |
| D6 | Shine the Light? | `size.employees`, `recipients[].role` | 20+ employees AND a third party gets personal details for its own marketing | CA-SHINE-THE-LIGHT |
| D7 | Children? | `children.directed_to_children_under_13`, `children.knowingly_collects_under_16` | directed to children or knowing collection: escalate. Otherwise the general-audience line | US-COPPA-SCOPE, CA-CCPA-MINORS |
| D8 | Calls and texts consent? | `after_form.calls`, `texts`, `automated_dialing_or_texting_platform`, `prerecorded_or_ai_voice` | calls or texts follow the form. With an automated system or prerecorded/artificial voice: the full prior-express-written-consent line. Unknown system: write the full line (it does no harm) and mark [CHECK] | US-TCPA-PEWC, US-TCPA-TEXTS-ARE-CALLS, US-TCPA-REVOCATION, US-TCPA-HOURS-DNC, US-TCPA-ONE-TO-ONE, US-CTIA-MESSAGING (industry code) |
| D9 | Marketing email? | `after_form.marketing_email` | yes: the email tick box and the CAN-SPAM footer facts (postal address is required: if missing, it is a MISSING fact) | US-CANSPAM |
| D10 | Cookie banner? | `trackers_on_build[]`, D1, D3 | no tracker sets non-essential cookies and none shares for ads: no banner, say why. A tracker shares for ads and D1 or D3 applies: the opt-out link and processing of the browser signal (a banner alone is not enough). Non-essential cookies without ads: a short notice with a "Cookie settings" link; US law read here does not require opt-in consent for them [CHECK: lawyer] | CA-CCPA-COOKIE-BANNER, CA-CALOPPA-CONTENT |
| D11 | Industry lines? | `industry`, `licences[]`, `business.states_served` | real estate: licence and broker lines, Fair Housing. Insurance: licence number, quote disclaimer. Mortgage: NMLS ID, Equal Housing Lender | `rules-industry.md` |
| D12 | Truthfulness of the policy itself | all | always: every statement of practice must be true of the business (a false privacy promise is a deceptive practice) | US-FTC-PRIVACY-PROMISES |

Notes for deciding:
- D5 "own promise": when the CCPA does not apply but `offer_to_everyone` is true, keep the CCPA's clock and methods as the
  business's own standard, write "we offer", never "the law gives you", and end each footnote with "Modelled on; the
  business's own promise". The opt-out request then means "stop marketing contact" unless the business sells or shares.
- "Revenue under 10,000,000" decides D1's revenue test as *not met*; "about 25 million" against a $26,625,000 threshold is
  *undecided* until the client gives a figure.
- The count in D1 is of California consumers or households whose data the business buys, sells or shares, from every
  source, not only the website (statute: "buys, sells, or shares"). A business that does none of these is at 0 for that
  test. A client's estimate is enough to decide; write "client's estimate" as its source.
- A state the business only has a few visitors from is still "served" if it advertises or takes clients there. When
  `states_served` is empty, D3 is undecided.
