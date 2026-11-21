---
name: site-legal
description: Drafts the legal pages of ONE client website from that client's facts file - privacy policy, terms of use, cookie notice and banner text, the "Your privacy choices" request page with its form labels and its received, extended and done messages (see, delete, correct, opt out, 45-day clock), the consent line under a lead form for calls, texts and email, and industry lines (real-estate licence and Fair Housing, insurance and lending lines). Decides from the facts which US rules apply (CCPA/CPRA, CalOPPA, other state privacy laws, TCPA, CAN-SPAM, COPPA), cites each rule with its source and read date, and marks a missing fact as a visible MISSING marker and a question, never a guess. Use it whenever someone asks for a site's privacy policy, terms, cookie notice, a privacy request or delete-my-data page, "the legal pages" or footer links for a client site, or the consent wording under a contact or lead form. Drafts for a lawyer's read, not legal advice.
---

# Site legal pages

This skill writes the legal pages of one client website as drafts a lawyer can read quickly: built from the client's own
facts, in plain English, with every statement about the law tied to a source. It fills the one gap the official `legal`
plugin leaves (that plugin is for in-house legal teams: contracts, NDAs, compliance checks; it has nothing that drafts a
website's pages). It does not replace a lawyer. A draft from here is never published until a licensed lawyer has read it
and the client's sign-off person has approved it.

Two things make these pages dangerous when done badly, and the whole skill is built around them:

- **An invented fact is worse than a gap.** A made-up licence number, address or "we never share your data" is a false
  statement the client publishes under its own name. So a fact that is not in the facts file is never filled in: it shows
  as a visible `[MISSING: ...]` marker and becomes a question.
- **A rule from memory goes stale.** Privacy law changes every year (thresholds are adjusted, new states start). So every
  rule this skill uses lives in `references/` with its source URL and the date it was read, and a draft cites the rule by
  its id. A rule not in `references/` is researched on the regulator's own page first, or written down as UNCONFIRMED.

## Run it

1. **Get the facts file.** One client per run. Use the client's `facts.json` if it exists; otherwise copy
   `templates/facts.template.json` and fill it only from things you can point to (the client's answers to the legal
   sign-off questions, the public licence lookup, the build's own tracker scan). Read `references/facts.md` for what
   each field means, which page needs it and how to ask for it, and `references/platform.md` for what the Omnikom
   platform itself keeps on every site (consent records, privacy-request records, message retention), which every
   policy must describe.
2. **Check the facts before writing anything.** Walk every field in `references/facts.md`. For each one record one of:
   *given* (value and source), *given, unsourced* (value but no source where the field needs one: mark it in the draft
   as `[CHECK: ...]`), or *missing* (mark it `[MISSING: <field> - <the question>]`). Never derive a fact from a guess,
   from another client, or from "what businesses like this usually do". A licence number without a public-lookup source
   is a `[CHECK: ...]`, never quietly used.
3. **Decide which rules apply.** Read `references/decide.md` and answer each decision from the facts, in its order.
   Write each answer as *applies*, *does not apply* or *undecided* with the one-line reason and the rule ids. When a
   decision is undecided because a fact is missing, draft the section anyway (giving a visitor a right the law may not
   require harms no one) and mark it `[CHECK: include only if ...]`. Never draft the opposite of an unknown practice:
   if the facts do not say whether data is sold, the page must not say "we do not sell".
4. **Check the rules are fresh.** Each rule file has a "checked on" date. If it is more than 6 months old, or a date in
   it (an effective date, a threshold period) has passed since, re-read the cited page before using the rule and update
   the entry. If the page will not load, keep the rule, mark it UNCONFIRMED and say so in the summary.
5. **Draft the pages** from `templates/`, one Markdown file each, following `references/writing.md` (plain English,
   short sections, the business's real names, no walls of legalese). Every sentence that says what a law gives or
   requires gets a footnote to its rule id. Load only the rule files the decisions need:
   `references/rules-california.md`, `references/rules-us-states.md`, `references/rules-federal.md`,
   `references/rules-industry.md`.
6. **Write `summary.json`** in the shape of `templates/summary.example.json`: the laws judged to apply and why, the
   facts used, the missing facts, the schema gaps (facts a page needed that the template has no field for), the
   questions, the escalations, and every rule id cited with its URL and date. The "last updated" line is
   `{{publish_date}}`, which the site builder fills on publish: it is not a marker. The per-page `missing` and `check`
   counts count markers in the page text only, not in the Review notes.
7. **Self-check, then fix.** Go through the checklist at the end of this file. Fix what fails and check again.
8. **Hand over.** Tell the person: where the files are, the questions (grouped for the client's "Legal sign-off" and
   "Regulated identity" topics in `sops/clients/client-questions.md`), the escalations for the lawyer, and the next
   step with the official plugin (below).

## What comes out

One folder per client (in the client's own folder, or `examples/<name>/` for a test):

| File | What it is | Where it goes on the site |
|---|---|---|
| `privacy-policy.md` | the privacy policy, including the state-law rights sections that apply | `/privacy` |
| `terms-of-use.md` | the terms of use of the website (not of the business's services) | `/terms` |
| `cookie-notice.md` | the cookie and tracking notice, plus the banner text if a banner is needed | `/cookies`, banner |
| `privacy-choices.md` | the "Your privacy choices" page, the request form's labels and help text, and the messages a requester gets (received, need to verify, in progress, extended, done, refused) | `/privacy-choices`, the request form, the emails |
| `form-consent.md` | the exact line(s) under each lead form for calls, texts and email, and the short notice at collection | the form's consent notice (stored word for word with each lead) |
| `industry-lines.md` | the footer and page lines the industry needs (licence, broker, Fair Housing, insurance or lending lines) | footer, about page, listing pages |
| `summary.json` | the decisions, facts, gaps, questions, escalations and sources | read by the site builder and the reviewer |

Every Markdown file begins with this block, exactly, filled in:

```markdown
> **DRAFT - not legal advice.** Written by the site-legal skill on <date> for <legal name> from the facts file
> <path>. A licensed lawyer must read and approve it before it is published. Remove this box and the "Review notes"
> section only after that approval.
```

and ends with a `## Review notes (remove before publishing)` section that lists the facts this page relied on, the
open questions for this page and the sources (footnotes) of each legal statement. The site builder must refuse to
publish a page that still contains `[MISSING`, `[CHECK` or the review box.

## Working with the official legal plugin

The official plugin (`legal` 1.3.0 by Anthropic, from `anthropics/knowledge-work-plugins`) is installed per machine, not
copied here (`README.md` says how). Use it as a second reader, never as a source of page text:

- After drafting, run its **compliance-check** on the plan "publish these legal pages and this lead form for <business>",
  giving it `summary.json` and the drafts. Where its answer differs from ours, add the point to the open questions; do
  not overwrite a sourced rule with its unsourced one.
- For each escalation (below), run its **legal-risk-assessment** and put the result's risk level beside the escalation
  in `summary.json`, so the lawyer reads the big questions first.
- When a real privacy request arrives later, the individual reply is drafted with its **legal-response** (data subject
  request) from lawyer-approved templates. This skill writes only the site's standing page and its automatic messages.

If the plugin is not installed, say so in the hand-over and carry on; the lawyer's read still happens.

## Guardrails

- **Facts:** nothing in a page that the facts file does not state. No invented licence numbers, addresses, phone
  numbers, company types, vendors, retention periods or claims ("award-winning", "fully compliant", "bank-level
  security"). A missing fact is `[MISSING: field - question]` in the page and in the question list.
- **Law:** no statement of what a law requires without a rule id from `references/`. Never write that a page "complies
  with" a law, or that the business "is exempt": the lawyer decides that. Write what the business does and what rights a
  visitor has.
- **Practices:** never promise what the build does not do. "We honor Global Privacy Control" or "you can text STOP" goes
  in only when the facts file says the build or the texting system does it.
- **Escalate, do not draft around:** stop and list for the lawyer (draft the rest) when the facts show any of these:
  data sold or shared for advertising; sensitive data collected (Social Security, driver's licence, financial account,
  health, precise location, immigration status); a site or product aimed at children or teens; a lender, insurer or
  anyone who may be a "financial institution" under federal privacy law; visitors or customers outside the US; an
  autodialer or prerecorded calls with no signed consent flow; the client asks for an exemption to be stated.
- **One client, test data marked:** never mix two clients' facts. A test facts file has `"test": true` and a name that
  says TEST and made-up; no real client's name or data ever goes into an example.

## Self-check before hand-over

- [ ] Every page starts with the draft box and ends with Review notes.
- [ ] Every missing fact appears as `[MISSING: ...]` in the page where it is needed AND in `summary.json` `missing_facts`
      and `questions`; none was filled with a plausible value.
- [ ] Every sentence about what a law gives or requires has a footnote whose rule id exists in `references/` with a URL
      and a read date; UNCONFIRMED rules are flagged as such in the footnote.
- [ ] No page says "we do not sell" or "we do not share" unless the facts file says so with a source.
- [ ] The privacy-choices page states the 10-day, 45-day and one 45-day-extension clock as California law only when the
      CCPA applies; as the business's own promise when it does not and `offer_to_everyone` is true (decide.md D5). It
      always offers see, delete, correct and opt out, and has one message per stored state (received, verifying,
      in-progress, done, refused) plus the extension.
- [ ] A fact a page needed that the facts template has no field for is in `schema_gaps`, not `missing_facts`.
- [ ] The form consent line names the business, says calls and texts may use automated technology only if they do, says
      consent is not a condition of buying, and says how to stop (reply STOP, unsubscribe link). Carrier lines ("Message
      and data rates may apply", HELP, frequency) are footnoted to US-CTIA-MESSAGING as an industry code, never as law.
- [ ] A visitor could read each page: sentences mostly under 25 words, headings that are questions or plain labels, the
      business's own name instead of "the Company".
