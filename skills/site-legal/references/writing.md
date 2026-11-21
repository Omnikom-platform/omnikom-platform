# Writing the pages so a visitor can read them

A legal page is read by two people: a visitor who wants one answer ("can I get my details deleted?") and a lawyer who
checks it is true and complete. Write for the visitor; the footnotes and review notes are for the lawyer.

## Rules of the house

- **Use the business's name and "we", "you".** "Harbor Street Realty collects..." then "we". Never "the Company",
  "the User", "hereinafter".
- **One idea per sentence, most sentences under 25 words.** Lists for anything with three or more parts.
- **Headings a visitor would search for**: "What we collect", "Who we share it with", "How to ask us to delete your
  details", not "Section 4: Disclosure of Personal Information to Third Parties".
- **Say what actually happens**, from the facts file: "When you send the contact form, we get your name, email, phone and
  your message." Not "we may collect various categories of information".
- **"May" only for real possibility**, never to blur a fact the file states. If the file says the business texts, write
  "we will text you", not "we may contact you".
- **Name each law once, in plain words, with a footnote**: "If you live in California, the California Consumer Privacy
  Act gives you these rights[^ca-rights]." Do not quote statute numbers in the visitor's text; they go in the footnote.
- **Dates and numbers as numbers**: "within 45 days", "10 business days".
- **No promises the business cannot keep** (security "guarantees", "we will never..."), no marketing words.
- **Markers stay visible.** `[MISSING: ...]` and `[CHECK: ...]` are written inline exactly where the fact belongs, so the
  gap is seen on the page, not only in a list.

## Examples

Not like this:

> The Company may collect, use, disclose and otherwise process Personal Information as set forth herein for any lawful
> business purpose, including without limitation...

Like this:

> **What we collect when you contact us.** When you send the form on our website, we get your name, email address, phone
> number and the message you write. We use them to answer you and to help you buy, sell or rent a home.

Not like this (invented fact):

> Harbor Street Realty, DRE #01234567

Like this:

> Harbor Street Realty, CA DRE license [MISSING: licences[0].number - What is the brokerage's California DRE license number?]

Not like this (unknown practice stated as a fact):

> We never sell or share your personal information.

Like this, when the facts file does not say:

> [CHECK: sells_personal_info and shares_for_cross_context_ads are not answered. Do not publish a "we do not sell or share"
> line until the client confirms it in writing.]

## Footnotes

Each statement about a law ends with a footnote id that matches a rule id in `references/` in lower case, for example
`[^ca-ccpa-timeline]`. The footnotes sit inside "Review notes (remove before publishing)", each as:
`[^ca-ccpa-timeline]: CA-CCPA-TIMELINE - <url> (read <date>) - CONFIRMED`. An UNCONFIRMED rule says so in its footnote.
