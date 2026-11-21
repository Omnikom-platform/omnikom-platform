# The facts file

One JSON file per client, in the shape of `templates/facts.template.json`. It is the only place a page's facts come from.
`null` or a missing key means *missing*: the page shows `[MISSING: <field> - <question>]` and the question goes into
`summary.json`. An empty list means *none* for `sensitive_data`, `security_measures`, `terms.content_disclaimers` and
`size.residents_per_year_by_state` (the page then leaves that part out or says "none"), and *missing* for every other list.

Two things are never markers: `{{publish_date}}` (the "last updated" date; the site builder writes it on the day the page
is published) and `{{...}}` fields inside the privacy-request messages (the platform fills them per request).

**A page needs a fact the schema has no field for?** That is a gap in this skill, not in the client's answers. Mark it
`[MISSING: <a new field name> - <question>]` as usual, and list it in `summary.json` under `schema_gaps` (not
`missing_facts`), so the skill gets the field added instead of the client getting a surprise question. A value whose field is marked **needs a source** below must have an entry in `sources`, keyed by
the field's path (for example `"licences[0].number": "DRE public licence lookup, <url>, read <date>"`). A value without
its needed source is used but marked `[CHECK: <field> - <what to confirm>]`.

Where the facts come from, in order of trust: a public register the client cannot edit (licence lookups, the Secretary of
State's business search); the build itself (the tracker scan, the form's fields); the client's written answers to the
legal sign-off questions; the client's own website. Never from another client, a template, or a guess.

## Fields

| Field | Needs a source | Used in | Question when missing |
|---|---|---|---|
| `test` | no | all | - (true marks a made-up test business; every page's first heading then starts with "TEST", for example `# TEST Privacy policy`) |
| `prepared_on` | no | all | - (date the facts were gathered; the draft box shows it) |
| `business.legal_name` | yes (Secretary of State search or licence record) | every page | What is the exact legal name of the business, as registered with the state? |
| `business.public_name` | no | every page | What name does the website use for the business, if different from the legal name? |
| `business.entity_type` | yes | terms, privacy | Is the business a corporation, an LLC, a partnership or a sole owner? |
| `business.formed_in_state` | yes | terms | In which state is the business registered? |
| `business.website` | no | every page | What is the website address the pages will live on? |
| `business.office_address` | yes | privacy, terms, industry lines | What street address should the website show for the office? |
| `business.phone`, `general_email` | no | privacy, terms | Which phone number and email should visitors use for general questions? |
| `business.states_served` | no | decide (state laws), industry lines | In which states does the business serve clients or advertise? |
| `business.customers_outside_us` | no | decide (escalation) | Does the business serve anyone outside the United States? |
| `industry` | no | decide, industry lines | `real-estate`, `insurance`, `mortgage`, `finance` or `other` |
| `licences[]` | yes, a public licence lookup with date | industry lines, footer | For each licence: whose is it (person or company), the exact name on the licence (`name_on_licence`), what kind, which state, and the number? Look it up on the state's public licence lookup first (our research task, `sops/clients/client-questions.md`); ask the client only what the lookup could not settle. |
| `privacy_contact.email` | no | privacy, privacy choices | Which email address receives privacy requests? |
| `privacy_contact.mailing_address` | yes | privacy, privacy choices, CAN-SPAM footer | Which postal address receives privacy requests and goes in marketing emails? |
| `privacy_contact.toll_free_phone` | no | privacy choices | Is there a toll-free number for privacy requests? (needed under CCPA unless the business only works online) |
| `privacy_contact.web_form` | no | privacy choices | The address of the privacy request form (the platform's form, once built) |
| `privacy_contact.sign_off_person` | no | summary | Who approves the legal pages for the client (their broker, lawyer or compliance person)? |
| `size.annual_gross_revenue_usd` | yes, or a band the client signs | decide (CCPA, Tennessee and others) | Was the business's gross revenue last year above or below <the threshold in force>? |
| `size.california_consumers_per_year` | no (the client's estimate) | decide (CCPA) | About how many California people's details does the business handle in a year (all sources, not only the website)? (The CCPA's test counts only those bought, sold or shared; a business that does none of these is at 0 for that test, whatever this number is. Other states count every resident's details the business controls or processes.) |
| `size.residents_per_year_by_state` | no | decide (other states) | For each other state served: about how many residents' details a year? |
| `size.revenue_share_from_selling_or_sharing_data` | no | decide | Does any of the business's income come from selling or sharing people's details? About what share? |
| `size.employees` | no | decide (Shine the Light) | How many employees does the business have? |
| `size.sba_small_business` | no | decide (Texas, Nebraska) | Is the business a small business by the US SBA size standard for its industry? |
| `collects[]` | no (the build gives the website part) | privacy | What details does the business collect from people, from where, why, and for how long does it keep them? |
| `sensitive_data[]` | no | decide (escalation), privacy | Does the business collect any of: Social Security number, driver's licence, financial account, health, precise location, immigration status? |
| `recipients[]` | yes for each vendor (the build's vendor list or the client's) | privacy | Who else receives people's details (CRM, email or texting service, partners, lenders, carriers) and why? `role` is `service-provider`, `contractor` or `third-party`. |
| `sells_personal_info` | yes | privacy, privacy choices | Does the business give people's details to anyone for money or anything of value? |
| `shares_for_cross_context_ads` | yes | privacy, cookie notice, privacy choices | Does the website or business let advertising networks use visitors' data to target ads across other sites (for example a Meta or Google ads pixel)? |
| `trackers_on_build[]` | yes, the build's own scan; each entry's `scanned_on` date | cookie notice, decide | (from the build scan, not a question) |
| `honors_global_privacy_control` | yes (the build) | cookie notice, privacy choices | (from the build: does the site act on the browser's opt-out signal?) |
| `honors_do_not_track` | yes (the build) | privacy policy, cookie notice (CalOPPA asks the policy to say) | (from the build: does the site change anything when the browser sends "Do Not Track"? Usually false) |
| `security_measures[]` | yes (the build or the client) | privacy policy "How we protect it" | (true statements only, for example "the site is served only over HTTPS"; empty: leave the section out) |
| `after_form.calls`, `texts`, `marketing_email` | no | form consent, privacy | After someone sends the form, will the business call, text, or send marketing emails? |
| `after_form.automated_dialing_or_texting_platform` | no | form consent, decide (TCPA) | Do calls or texts go out through a dialer or texting platform, or are they typed and dialled by hand one at a time? |
| `after_form.prerecorded_or_ai_voice` | no | form consent, decide (TCPA, escalation) | Are any calls prerecorded or made with an AI or artificial voice? |
| `after_form.text_frequency` | no | form consent (the opt-in confirmation text) | About how many texts a month will a person get (for example "up to 4 a month, more while we are working together")? |
| `after_form.text_sender_number` | no (the texting platform) | form consent | Which phone number or short code will the texts come from? |
| `after_form.postal_address_in_every_email` | yes (that service's template) | form consent | Does every marketing email show the business's postal address? |
| `after_form.marketing_email_service` | yes (the client or the build) | privacy (recipients), form consent | Which service sends the marketing emails? |
| `after_form.unsubscribe_link_in_every_email` | yes (that service's settings) | form consent, privacy | Does every marketing email carry a working unsubscribe link? |
| `after_form.who_contacts` | no | form consent | Who makes the calls and texts: the business's own team, or a partner? |
| `after_form.stop_keyword_works` | yes (the texting system) | form consent | Does replying STOP to a text stop further texts automatically? |
| `children.directed_to_children_under_13` | no | decide (COPPA), privacy | Is any part of the website or business aimed at children? |
| `children.knowingly_collects_under_16` | no | decide (CCPA minors) | Does the business knowingly collect details from anyone under 16? |
| `terms.governing_state` | no | terms | Which state's law should govern the website terms (usually the state the business is registered in)? |
| `terms.disputes` | no | terms (lawyer decides) | Courts or arbitration for disputes about the website, and if courts, in which county? (a lawyer's choice) |
| `terms.content_disclaimers[]` | no | terms, industry lines | What should the site say about listing data, estimates or quotes (for example "information deemed reliable but not guaranteed")? |
| `privacy_request_handling.offer_to_everyone` | no | privacy choices, decide D5 | Should the see, delete, correct and opt-out requests be open to every visitor, or only to people whose state law gives them the right? (The platform's request form and 45-day clock work the same either way.) |
| `privacy_request_handling.access_delivery_method` | no (the platform) | privacy choices ("done - see" message) | How does a person get the copy of their details (a secure link, an attachment)? |
| `privacy_request_handling.records_kept_after_delete` | no (client; the lawyer confirms the reasons) | privacy choices ("done - delete" message) | After a delete request, what must the business keep and why (for example records of a sale it handled)? |
| `children.action_on_discovery` | no | privacy policy "Children" | What does the business do if it learns it has a child's details (for example "we delete them")? |
| `build.cookie_settings_available` | yes (the build) | cookie notice | Does the build offer a "Cookie settings" link or panel? |
| `build.map_loads_only_after_consent` | yes (the build) | cookie notice | Does an embedded map or video load only after the visitor allows it? |
| `privacy_request_handling.verification_method` | no | privacy choices | How will the business confirm a requester is who they say (for example a code sent to the email or phone in the request)? |
| `privacy_request_handling.who_handles` | no | privacy choices | Who at the business answers privacy requests? |

## Asking the questions

Group the missing facts into the client's fixed question topics in `sops/clients/client-questions.md` ("Legal sign-off",
"Regulated identity", "People and licences"), so the legal pages never add a thirteenth question. Ask in the client's
words, one fact per question, with the reason in a few words ("needed so people know where to send a privacy request").
Facts the build can answer (trackers, Global Privacy Control, the form's fields) are never client questions: they are a
build check.
