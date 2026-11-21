<!-- Template: the words under each lead form. These words are stored with every lead, word for word, as the proof
of consent (leads.consent_text and consent_ledger, docs/product/3-database.md), so a change of wording is a new version,
never an edit in place. Write the separate tick boxes the platform records: marketing_consent and sms_consent (one box
covers calls and texts: the platform has no separate calls flag). The stored text is the visible words only, without the
footnote marks, which are for the lawyer. Show the number texts come from (`after_form.text_sender_number`) in the line
when the facts give it. -->

> **DRAFT - not legal advice.** Written by the site-legal skill on {{today}} for {{business.legal_name}} from the facts
> file {{facts_path}}. A licensed lawyer must read and approve it before it is published. Remove this box and the
> "Review notes" section only after that approval.

# Lead form consent wording

## Notice at collection (always, under every form)
One or two sentences: what the form collects, why, and a link to the privacy policy [^ca-caloppa-content]; when D1
applies also [^ca-ccpa-notice-at-collection] (when it does not, that footnote ends "Modelled on; the business's own
practice").

## Calls and texts tick box (if after_form.calls or after_form.texts)
Unticked by default; never a condition of sending the form. Must contain, in plain words, each element of "prior express
written consent" when the calls or texts use an automated system or a prerecorded or artificial voice
[^us-tcpa-pewc]: the business's name as the one who will call or text; that it may use automated technology (only if
`after_form.automated_dialing_or_texting_platform` is true or unknown; unknown: [CHECK: ...]); the number given;
that consent is not a condition of buying anything; how to stop: reply STOP, or tell us any reasonable way
[^us-tcpa-revocation]; a link to the privacy policy and terms.
For texts, add the carriers' code lines, footnoted as an industry code and not a law [^us-ctia-messaging]: "Message and
data rates may apply. Reply HELP for help."

## Opt-in confirmation text (if after_form.texts)
The first text after the tick box, sent once [^us-ctia-messaging]: the business's name, that texts will recur and how often
(`after_form.text_frequency`), "Message and data rates may apply", "Reply STOP to stop, HELP for help", and a contact.

## Marketing email tick box (if after_form.marketing_email)
Separate from the calls box; one line; every email will carry an unsubscribe link and our postal address [^us-canspam].
Say "every email will carry an unsubscribe link" only if `after_form.unsubscribe_link_in_every_email` is true; the
service in `after_form.marketing_email_service` goes into the privacy policy's recipients. Write the email footer too
(legal name and the postal address): when the postal address is missing, the footer carries
`[MISSING: privacy_contact.mailing_address - ...]`, because the law requires a valid postal address in every email and
the tick-box line must not promise one that does not exist yet.

## Button text
"Send" or "Send my request". Never "I agree" on the submit button: agreement lives in the tick box.

## Review notes (remove before publishing)
- **Facts this page relied on:** ...
- **Open questions for this page:** ...
- **Sources:** footnotes.
