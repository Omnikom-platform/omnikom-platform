> **DRAFT - not legal advice.** Written by the site-legal skill on 2026-11-21 for TEST Harbor Street Realty, Inc. (made-up) from the facts file
> skills/site-legal/examples/test-harbor-street/facts.json. A licensed lawyer must read and approve it before it is published. Remove this box and the "Review notes"
> section only after that approval.

# TEST Your privacy choices

## Page text

Here you can ask TEST Harbor Street Realty (made-up) to show you, correct or delete the details we have about you, or to stop our marketing. Anyone can ask, wherever you live. We offer these choices to everyone because we choose to. We modelled them on California's privacy law.[^ca-ccpa-rights]

**What you can ask for**
- **See** what we have about you.
- **Delete** your details.
- **Correct** something that is wrong.
- **Stop our marketing.** We will stop our marketing calls, texts and emails to you. We do not sell or share your details, so this is the opt-out that matters.

**Other ways to ask**
- Email: privacy@harbor-street-test.example
- Phone (toll-free): (800) 555-0100
- Mail: [MISSING: privacy_contact.mailing_address - Which postal address receives privacy requests and goes in our marketing emails? (Do not use the office address unless the client says so.)]

We offer a web form and a toll-free number as well as email.[^ca-ccpa-methods] Dana Example (made-up), our office manager, answers privacy requests.

**How we confirm it is you.** For See, Delete and Correct, we send a 6-digit code to the email address or phone number in your request. You do not need to confirm who you are to stop our marketing.[^ca-ccpa-verify]

**Asking through someone else.** You can ask another person to make a request for you. We may ask for your written permission, and we may ask you to confirm your own identity.[^ca-ccpa-agents]

**How long we take**
- We confirm we got your request within 10 business days, and we answer within 45 days of the day we got it.
- If we need more time, we tell you why, once, within those first 45 days. We then take at most 45 more days.[^ca-ccpa-timeline]
- To stop our marketing: we do it within 10 business days, the limit for emails, texts and calls.[^us-canspam][^us-tcpa-revocation]

**No penalty.** We will not treat you worse because you made a request.[^ca-ccpa-nondiscrimination]

## Form labels

| Field | Label | Help text | Required |
|---|---|---|---|
| kind | What would you like us to do? | Pick one. | Yes |
| name | Your name | So we know who is asking. | Yes |
| subject | Your email address or phone number | We send your code and our answer here. For "See my details" we need an email address, because we send your copy by a secure link. | Yes |
| state | The state you live in | Optional. We answer everyone, wherever you live. | No |
| correction | What should we correct? | Tell us what is wrong and what it should say. Shown only for "Correct my details". | Yes, for Correct only |
| agent | I am asking for someone else | Tick this if you are making the request for another person. | No |
| agent_details | Your name and your contact details | Shown only if the agent box is ticked. We may ask for the other person's written permission. | Yes, if the agent box is ticked |
| confirm | The details in this request are true. | Tick to continue. | Yes |

Options for **kind**, with the stored value:
- See my details (`access`)
- Delete my details (`delete`)
- Correct my details (`correct`)
- Stop marketing calls, texts and emails to me (`opt-out`)

Button: **Send my request**

## Messages
Words in double braces are filled by the platform for each request. Each message has an email version (subject and text) and, where it may be texted, a short text version.

**1. On screen, right after sending** (state received)

> Thank you. We got your request. Your request number is {{request_id}}. We will send a 6-digit code to {{subject}} so we can confirm it is you, and we will answer by {{due_date}}.

For a Stop marketing request, use instead: "Thank you. We got your request. We will stop our marketing to you within 10 business days, and we will answer by {{due_date}}."

**2. Received** (state received, sent at once, within the 10 business days)

- Subject: We got your privacy request ({{request_id}})
- Email: "Hello {{name}}, TEST Harbor Street Realty (made-up) got your request to {{request_kind}} on {{received_date}}. We will answer by {{due_date}}. To protect your details, we will first send a 6-digit code to {{subject}} to confirm it is you. Questions: privacy@harbor-street-test.example or (800) 555-0100."
- For a Stop marketing request, drop the sentence about the code.
- Text: "TEST Harbor Street Realty (made-up): we got your privacy request {{request_id}}. We will answer by {{due_date}}."

**3. Verifying** (state verifying; not used for Stop marketing requests)

- Subject: Please confirm it is you
- Email: "Hello {{name}}, your code is {{verification_code}}. Enter it at {{verify_link}} to confirm it is you. If we cannot confirm who you are, we cannot show, change or delete your details, and we will tell you why. We still owe you an answer by {{due_date}}."
- Text: "TEST Harbor Street Realty (made-up): your code is {{verification_code}}. Enter it at {{verify_link}} to confirm it is you."

**4. In progress** (state in-progress)

- Subject: We are working on your privacy request ({{request_id}})
- Email: "Hello {{name}}, we confirmed it is you and we are working on your request. We will answer by {{due_date}}."
- Text: "TEST Harbor Street Realty (made-up): we are working on your privacy request. Answer due {{due_date}}."

**5. Extended** (once, before the first 45 days end)

- Subject: We need more time for your privacy request ({{request_id}})
- Email: "Hello {{name}}, we need more time for your request because {{extension_reason}}. We will answer by {{extended_due_date}}. That is at most 45 days after the first date. We can only do this once."
- Text: "TEST Harbor Street Realty (made-up): we need more time for your privacy request. New date: {{extended_due_date}}. Details by email."

**6. Done** (state done), one for each kind

- **See (access).** Subject: Your copy of your details ({{request_id}}). Email: "Hello {{name}}, your copy is ready. Open this secure link: {{access_link}}. The link works for 7 days after we send it. After that, ask us again." Text: "TEST Harbor Street Realty (made-up): your privacy request is done. We emailed you a secure link. It works for 7 days."
- **Delete.** Subject: Your details were deleted ({{request_id}}). Email: "Hello {{name}}, we deleted {{what_was_deleted}}. We kept records of a purchase, sale or lease we handled for you [CHECK: records_kept_after_delete - the lawyer confirms the legal reason and how long we keep these records; add both here]." Text: "TEST Harbor Street Realty (made-up): your privacy request is done. See your email for what we deleted and what we kept."
- **Correct.** Subject: Your details were corrected ({{request_id}}). Email: "Hello {{name}}, we changed {{what_changed}}." Text: "TEST Harbor Street Realty (made-up): your privacy request is done. See your email for what we changed."
- **Stop marketing (opt-out).** Subject: We stopped our marketing to you ({{request_id}}). Email only, no text, because the request may stop texts: "Hello {{name}}, we stopped our marketing calls, texts and emails to you from {{effective_date}}. This is done no later than 10 business days after we got your request." [CHECK: lawyer. The facts do not say whether the business still contacts a person it is working with on a purchase or sale after a Stop marketing request. Decide and add one sentence.]

**7. Refused** (state refused; in whole or in part)

- Subject: About your privacy request ({{request_id}})
- Email: "Hello {{name}}, we could not do all of your request. We could not {{refused_part}} because {{refusal_reason}}. What you can do next: send the request again with more details on our Your privacy choices page, or write to privacy@harbor-street-test.example or call (800) 555-0100." [CHECK: lawyer. The CCPA is not judged to apply, so no state appeal route is named. Confirm whether to name a complaint route.]
- Text: "TEST Harbor Street Realty (made-up): we could not complete your privacy request. See your email for why and what to do next."

## Review notes (remove before publishing)
- **Facts this page relied on:** privacy_request_handling.offer_to_everyone = true; verification_method (6-digit code); who_handles (Dana Example, the office manager, made-up); access_delivery_method (secure link by email, 7 days); records_kept_after_delete; privacy_contact.email, toll_free_phone, web_form; mailing_address is null; sells_personal_info false and shares_for_cross_context_ads false (used for the Stop marketing wording); after_form.unsubscribe_link_in_every_email and stop_keyword_works are true.
- **Decisions behind this page:** D1 CCPA does not apply and offer_to_everyone is true, so D5 "own promise": "we offer", the same clock and methods, each footnote ends "Modelled on; the business's own promise". D4 does not apply, so no 15-business-day opt-out clock and no "Do Not Sell or Share" link; the opt-out is worded as stopping marketing contact. The 10-business-day stop is real law for email and texts (US-CANSPAM, US-TCPA-REVOCATION).
- **Placeholders the platform fills:** request_id, request_kind, name, subject, received_date, due_date, extended_due_date, extension_reason, verification_code, verify_link, access_link, what_was_deleted, what_changed, refused_part, refusal_reason, effective_date.
- **Open questions for this page:** MISSING privacy_contact.mailing_address (client, topic Legal sign-off). CHECK records kept after delete (lawyer). CHECK what a Stop marketing request does for a client in an active deal (lawyer). CHECK whether to name a complaint route (lawyer). Where the verification code is entered ({{verify_link}}) is not in the facts file; the platform decides. The form asks for an email for See requests because the facts say the copy goes by secure link; the facts file does not say what happens when a requester gives only a phone number.
- **Sources:**

[^ca-ccpa-rights]: CA-CCPA-RIGHTS - https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf sec. 7011(e)(2) (read 2026-11-21) - CONFIRMED. Modelled on; the business's own promise.
[^ca-ccpa-methods]: CA-CCPA-METHODS - https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf sec. 7020(a)-(b) (read 2026-11-21) - CONFIRMED. Modelled on; the business's own promise.
[^ca-ccpa-verify]: CA-CCPA-VERIFY - https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf sec. 7060(a)-(b) (read 2026-11-21) - CONFIRMED for 7060; the detailed methods of 7061-7062 not read (UNCONFIRMED). Modelled on; the business's own promise.
[^ca-ccpa-agents]: CA-CCPA-AGENTS - https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf sec. 7063(a)-(b) (read 2026-11-21) - CONFIRMED. Modelled on; the business's own promise.
[^ca-ccpa-timeline]: CA-CCPA-TIMELINE - https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf sec. 7021(a)-(b) (read 2026-11-21) - CONFIRMED. Modelled on; the business's own promise.
[^ca-ccpa-nondiscrimination]: CA-CCPA-NONDISCRIMINATION - https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf 1798.125(a)(1) (read 2026-11-21) - CONFIRMED. Modelled on; the business's own promise.
[^us-canspam]: US-CANSPAM - https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business (read 2026-11-21) - CONFIRMED.
[^us-tcpa-revocation]: US-TCPA-REVOCATION - https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200 (a)(10); https://docs.fcc.gov/public/attachments/FCC-26-67A1.txt (read 2026-11-21) - CONFIRMED; the effective date of FCC 26-67 (2026-11-25 by calculation) is UNCONFIRMED as a stated date.
