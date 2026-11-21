<!-- Template: the "Your privacy choices" page, its request form, and the messages a requester gets. The platform
stores each request in privacy_requests with kind access | delete | correct | opt-out and state received | verifying |
in-progress | done | refused, and a due date 45 days after receipt that staff may extend once by 45 more
(supabase/migrations/20261030000007_hardening_leftovers.sql, table privacy_requests). Write one message per state, and
the extension message. Keep each message short enough to read on a phone. -->

> **DRAFT - not legal advice.** Written by the site-legal skill on {{today}} for {{business.legal_name}} from the facts
> file {{facts_path}}. A licensed lawyer must read and approve it before it is published. Remove this box and the
> "Review notes" section only after that approval.

# Your privacy choices

## Page text
- One opening paragraph: what the visitor can ask for here, who can ask (California residents by law[^ca-ccpa-rights];
  other states where a law applies; or "anyone" when `privacy_request_handling.offer_to_everyone` is true; when that
  fact is missing it is a MISSING marker like any other).
- The four requests in plain words: **See** what we have about you; **Delete** it; **Correct** something wrong; **Opt out**.
  The opt-out request is always on the page (the platform stores it as `opt-out`), and its words follow the facts:
  "Do not sell or share my details" when the business sells or shares (or it is undecided); otherwise "Stop marketing
  calls, texts and emails to me", plus one line that the business does not sell or share (only when the facts say so).
- Other ways to ask (`privacy_contact`): email, toll-free phone, mail [^ca-ccpa-methods].
- How we confirm it is you, and that an authorised agent may ask for you [^ca-ccpa-verify] [^ca-ccpa-agents].
- The clock: we confirm within 10 business days and answer within 45 days; if we need more time we tell you why, once, and
  take at most 45 more days [^ca-ccpa-timeline]. Opt-out of sale or sharing (D4 applies): we act within 15 business days
  [^ca-ccpa-optout-15]. Stop marketing contact: we act within 10 business days, the limit for emails and for texts and
  calls [^us-canspam] [^us-tcpa-revocation].
- No penalty for asking [^ca-ccpa-nondiscrimination].

## Form labels
| Field | Label | Help text | Required |
|---|---|---|---|
| kind | What would you like us to do? | one choice per request | yes |
| ... | ... | ... | ... |
Options for kind, with the stored value: See my details (access), Delete my details (delete), Correct my details (correct),
and the opt-out option worded as above (opt-out). Fields: name, email or phone we can reach you at (stored as `subject`), state you
live in, what to correct (only for correct), "I am asking for someone else" (agent) with the agent's details, and a
confirmation tick: "The details in this request are true." Button: "Send my request".

## Messages
Each with a subject line (email) and a short text (SMS-length where it may be texted).
1. **On screen, right after sending** (state received).
2. **Received** (within 10 business days; the platform should send it at once): what we got, the due date, how we will
   confirm it is you.
3. **Verifying**: what we need from you to confirm it is you; what happens if we cannot. (An opt-out needs no
   verification under the CCPA [^ca-ccpa-verify]: skip this message for opt-out requests.)
4. **In progress**: we confirmed it is you and are working on it; the due date.
5. **Extended** (once, before the first 45 days end): why we need more time, the new date.
6. **Done**, one per kind: access (how the copy is delivered), delete (what was deleted and what we must keep and why,
   in plain words), correct (what changed), opt-out (from when it applies).
7. **Refused** (in whole or part): the reason in plain words, and what the person can do next (ask again, contact us,
   the state's appeal or complaint route where the law gives one).

## Review notes (remove before publishing)
- **Facts this page relied on:** ...
- **Open questions for this page:** ...
- **Sources:** footnotes.
