# What the Omnikom platform itself does with a site's data (read from the repository on 2026-11-21)

Every client site built on the platform carries these practices whatever the client does, so the privacy policy and the
privacy-choices messages must describe them. They are facts with a source (a file of this repository), not law. Re-read
the cited lines before each run: the platform changes, and the page must say what it does on the day it is published.
A client's own tools (its CRM, texting platform, email service) come from its facts file, never from here.

| Practice | What it means for the pages | Source |
|---|---|---|
| Each lead keeps the exact consent wording the person saw, and the sms and marketing consent ticks | the notice at collection and the privacy policy say the business keeps a record of what the person agreed to | `docs/product/3-database.md` line 15 ("Lead") and the `leads` row (`consent_text`, `marketing_consent`, `sms_consent`) |
| A consent ledger keeps the proof of consent per lead (the wording and its sha256, the sms and marketing consent, a hashed address) and it outlives a deleted lead; its retention period is "never" | the "done - delete" message and the privacy policy say the record of consent is kept after a delete, and why (to prove consent was given); the lawyer confirms the reason and the period | `docs/product/3-database.md`, the `consent_ledger` row and the `retention_rules` row ("`consent_ledger` never") |
| Do-not-contact entries are kept by channel with a hashed address | a stop request is kept as a hashed entry so the person is not contacted again | `docs/product/3-database.md`, the `suppressions` row |
| A privacy request is stored with what was asked (see, delete, correct, opt out), the contact given, its state and a due date 45 days after receipt that staff may extend once by 45 more | the privacy-choices page and the policy say the request itself is kept as a record | `supabase/migrations/20261030000007_hardening_leftovers.sql`, table `privacy_requests`; `docs/product/3-database.md`, the `privacy_requests` row |
| Messages with a lead are kept 1461 days (four years, the TCPA claim limit) | the policy's retention line for calls, texts and emails sent through the platform | `docs/product/3-database.md`, the `retention_rules` row ("`messages` 1461 (TCPA claims have a four-year limit, 28 U.S.C. 1658(a))") |
| A visitor's sends per hour are counted against a hash of the site and the visitor's address, never the address itself | the policy may say the site counts form sends per visitor to stop spam, using a one-way code of the address | `docs/product/3-database.md`, the `visitor_counts` row |
| Visits are counted with Cloudflare Web Analytics, which uses no cookies; the platform runs on Supabase (US West), Cloudflare and Resend | recipients and trackers on every site (still confirm on the build's scan) | `docs/product/7-sites.md` "Search and analytics"; `docs/product/2-architecture.md`, the table "Part / Runs on" |

When the facts file's `collects[]` or `recipients[]` leaves one of these out, add it from here with this file as its source
and say so in the Review notes; when the client's facts contradict this table, the contradiction is a `[CHECK: ...]`.
