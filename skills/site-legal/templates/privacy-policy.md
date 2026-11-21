<!-- Template: the privacy policy. Copy the structure, write each section from the facts file in the words of
references/writing.md. {{...}} is a fact path; a section marked (if ...) is drafted only when that decision in
references/decide.md applies or is undecided (undecided: draft it and mark it [CHECK: include only if ...]). -->

> **DRAFT - not legal advice.** Written by the site-legal skill on {{today}} for {{business.legal_name}} from the facts
> file {{facts_path}}. A licensed lawyer must read and approve it before it is published. Remove this box and the
> "Review notes" section only after that approval.

# Privacy policy

**{{business.public_name}}** ({{business.legal_name}}, {{business.entity_type}}) - last updated {{publish_date}}

## The short version
Three to five bullets a visitor can read in ten seconds: what we collect, why, who else gets it, whether we sell or share
it (only what the facts say), how to ask us to see, correct or delete it.

## Who we are and how to reach us
Legal name, address, privacy email, phone; the privacy choices page link.

## What we collect and why
A table built from `collects[]` plus the build's form fields: what, where it comes from, why, how long we keep it.
Group by what a visitor recognises (the contact form, emails and calls with us, the website's own logs). (if CCPA)
Add the CCPA category name in brackets after each row's "what" (identifiers, commercial information, internet activity,
geolocation, inferences...), with footnote [^ca-ccpa-policy-content].

## Sensitive details (if sensitive_data is not empty: escalate; otherwise one line)
"We do not ask for ..." only when the facts list what the forms collect and nothing sensitive is there.

## Who we share it with
From `recipients[]`: each kind of recipient, what they get, why. Service providers named by role ("the company that hosts
our website", "our email service"); name them when the facts name them.

## Selling and sharing (if CCPA or a state law applies, or undecided)
State exactly what `sells_personal_info` and `shares_for_cross_context_ads` say. Unknown: a [CHECK: ...] marker, never a
denial. If either is true: the "Do Not Sell or Share My Personal Information" link and how it works [^ca-ccpa-optout-link].

## Cookies and tracking
Two lines and a link to the cookie notice. CalOPPA: how the site responds to browser "Do Not Track" signals and whether
other companies can collect data about visitors across sites [^ca-caloppa-content]. Global Privacy Control: only what the
build does (`honors_global_privacy_control`) [^ca-ccpa-gpc].

## Your choices and rights
Everyone: how to stop marketing emails and texts, how to ask a question.
(if CCPA) "If you live in California": know/see, delete, correct, opt out of sale or sharing, limit use of sensitive
details (only if sensitive data is used beyond what is allowed), no penalty for using a right, authorised agents
[^ca-ccpa-rights] [^ca-ccpa-nondiscrimination] [^ca-ccpa-agents].
(for each other state law that applies) "If you live in <state>": the rights it gives, the appeal right where the law has
one, the answer time [^<state rule id>].
How to send a request (the methods from privacy_contact) and how we confirm it is you
(`privacy_request_handling.verification_method`) [^ca-ccpa-methods] [^ca-ccpa-verify].
How long we take: confirm within 10 business days, answer within 45 days, one extension of 45 more days with a note
telling you why [^ca-ccpa-timeline].

## Children
General-audience line: the site is not for children under 13 and we do not knowingly collect their details; what we do if
we learn we have [^us-coppa-scope]. (if CCPA and knowingly_collects_under_16) escalate.

## How we protect it (only if security_measures is not empty)
Each item of `security_measures[]` in plain words; no guarantees. Empty list: leave the section out (not a marker).

## Do Not Track and other sites (CalOPPA, always for California visitors)
What the site does with a "Do Not Track" signal (`honors_do_not_track`) and whether other companies can collect data about
a visitor across sites through this site (from `trackers_on_build[]` and `recipients[]`) [^ca-caloppa-content].

## Changes to this policy
We review it at least once a year (if CCPA [^ca-ccpa-annual-update]); the date at the top changes when it does.

## Review notes (remove before publishing)
- **Facts this page relied on:** each fact path, its value, its source (or "unsourced").
- **Open questions for this page:** each [MISSING] and [CHECK] with its question.
- **Sources:** the footnotes, one per rule id: `[^id]: RULE-ID - url (read date) - CONFIRMED|UNCONFIRMED`.
