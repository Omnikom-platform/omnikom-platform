> **DRAFT - not legal advice.** Written by the site-legal skill on 2026-11-21 for TEST Harbor Street Realty, Inc. (made-up) from the facts file
> skills/site-legal/examples/test-harbor-street/facts.json. A licensed lawyer must read and approve it before it is published. Remove this box and the "Review notes"
> section only after that approval.

# TEST Lead form consent wording

These words go under both lead forms: the contact form and the home-value form. The platform stores the visible words of each block below, word for word, with every lead (leads.consent_text and consent_ledger). A change of wording is a new version, never an edit in place. Links and footnote marks are not part of the stored words.

## Notice at collection (always, under every form)
Stored text:

> TEST Harbor Street Realty (made-up) will use your name, email, phone number and message to answer you and to help you buy, sell or rent a home. We keep them for 3 years after we last contact you. We do not sell them. See our privacy policy.[^ca-ccpa-notice-at-collection][^ca-caloppa-content]

"privacy policy" links to /privacy.

## Calls and texts tick box
Unticked by default. Sending the form never depends on it. The platform records it as sms_consent; this one box covers calls and texts.

Stored text:

> I agree that TEST Harbor Street Realty (made-up) and its agents may call and text me at the phone number I entered, using automated dialing or texting technology, about buying, selling or renting a home.[^us-tcpa-pewc][^us-tcpa-texts-are-calls][^us-tcpa-one-to-one] I do not have to agree to this to send this form or to buy, sell or rent anything. Texts come from (555) 010-0199, up to 4 texts a month, and more while we are working together on a purchase or sale. Message and data rates may apply.[^us-ctia-messaging] Reply STOP to stop texts at any time, or tell us any other reasonable way to stop.[^us-tcpa-revocation] Reply HELP for help. [MISSING: after_form.help_keyword_works - Does replying HELP to a text get an automatic reply, and what contact does the reply give? The facts file says only that STOP works.] See our privacy policy and terms.

"privacy policy" links to /privacy and "terms" to /terms. Signing is by this tick box plus the Send button, as the electronic signature [CHECK: lawyer confirms an electronic tick box is enough for a California client].

## Opt-in confirmation text
The first text after the tick box, sent once:

> TEST Harbor Street Realty (made-up): you are signed up for texts about your home search or sale. Up to 4 texts a month, more while we work together on a purchase or sale. Message and data rates may apply. Reply STOP to stop. Reply HELP for help [MISSING: after_form.help_keyword_works - the same question as above]. Questions: (555) 010-0100.[^us-ctia-messaging]

## Marketing email tick box
Separate from the calls and texts box. Unticked by default. The platform records it as marketing_consent.

Stored text:

> I would like TEST Harbor Street Realty (made-up) to email me its monthly market update. Every email has an unsubscribe link and our postal address.[^us-canspam]

## Button text
**Send** on both forms. Never "I agree" on the button: agreement lives in the tick boxes.

## Review notes (remove before publishing)
- **Facts this page relied on:** collects[0] (what, why, kept 3 years); sells_personal_info false; after_form.calls true, texts true, automated_dialing_or_texting_platform true, prerecorded_or_ai_voice false, who_contacts "the business's own agents", stop_keyword_works true (source: made-up for the test), text_frequency, text_sender_number (source: made-up for the test), marketing_email true, marketing_email_service TEST MailCo (made-up), unsubscribe_link_in_every_email true, postal_address_in_every_email true; business.public_name and phone.
- **Decisions behind this page:** D8 calls and texts: the full prior-express-written-consent line, because the texts go through a platform and prerecorded voice is false (so the line does not mention a recorded or artificial voice). D9 marketing email: its own box. The CCPA notice at collection is modelled on, not required, because D1 says the CCPA does not apply; CalOPPA applies.
- **Open questions for this page:** MISSING after_form.help_keyword_works (schema gap: the facts file has no field for the HELP keyword or its contact). CHECK electronic tick box (lawyer). For the lawyer: whether TEST TextCo (made-up) counts as an automatic telephone dialing system, and whether the calls and texts are marketing; the line is written to cover both. The postal address that goes in every marketing email is the missing privacy_contact.mailing_address; the email box does not print it, but every email carries it, so it is needed before launch (client, topic Legal sign-off).
- **Operating notes for the business (not page text):** no calls or texts before 8 a.m. or after 9 p.m. in the person's local time, and check the National Do Not Call Registry unless the form inquiry or the signed consent applies.[^us-tcpa-hours-dnc]
- **Sources:**

[^ca-ccpa-notice-at-collection]: CA-CCPA-NOTICE-AT-COLLECTION - https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf sec. 7012(c)-(f) (read 2026-11-21) - CONFIRMED. Modelled on; not required of a business the CCPA does not reach (decision D1).
[^ca-caloppa-content]: CA-CALOPPA-CONTENT - https://www.leginfo.ca.gov/pub/13-14/bill/asm/ab_0351-0400/ab_370_bill_20130927_chaptered.htm (read 2026-11-21) - CONFIRMED for the 2013 text; UNCONFIRMED that Bus. & Prof. Code 22575 is unchanged since.
[^us-tcpa-pewc]: US-TCPA-PEWC - https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200 (a)(2), (a)(3), (f)(9) (read 2026-11-21) - CONFIRMED. Whether the texting platform is an automatic telephone dialing system is a lawyer's question.
[^us-tcpa-texts-are-calls]: US-TCPA-TEXTS-ARE-CALLS - https://docs.fcc.gov/public/attachments/FCC-23-107A1.txt para. 5 and 8; 47 CFR 64.1200(e) (read 2026-11-21) - CONFIRMED.
[^us-tcpa-one-to-one]: US-TCPA-ONE-TO-ONE - https://docs.fcc.gov/public/attachments/DA-25-621A1.txt (read 2026-11-21) - CONFIRMED. The one-to-one rule was vacated and repealed; the line names only the business itself and its own agents, never unnamed partners.
[^us-tcpa-revocation]: US-TCPA-REVOCATION - https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200 (a)(10); https://docs.fcc.gov/public/attachments/FCC-26-67A1.txt (read 2026-11-21) - CONFIRMED; the effective date of FCC 26-67 (2026-11-25 by calculation) is UNCONFIRMED as a stated date.
[^us-ctia-messaging]: US-CTIA-MESSAGING - https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf sec. 5.1.1, 5.1.2.1 (read 2026-11-21) - CONFIRMED as the code's text. An industry code of the wireless carriers (voluntary best practices), NOT a law: "Message and data rates may apply", the message frequency, STOP and HELP come from it.
[^us-canspam]: US-CANSPAM - https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business (read 2026-11-21) - CONFIRMED.
[^us-tcpa-hours-dnc]: US-TCPA-HOURS-DNC - https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200 (c)(1), (c)(2), (f)(5) (read 2026-11-21) - CONFIRMED (the 18-month purchase rule of (f)(5) seen only in Cornell's summary: UNCONFIRMED in its exact words).
