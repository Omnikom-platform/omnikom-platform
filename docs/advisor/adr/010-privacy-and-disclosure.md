# ADR 010: Disclosure first; data stays in the browser

Status: accepted by the head 2026-11-26 20:45 (rulings in R2 section 24). Design: `docs/advisor/R2-design.md`.

## Context
California B&P 17940-17943 (bot disclosure); CCPA/CPRA; no personal data stored without a written reason (brief constraints 5 and 6).

## Decision
- The first line of every chat discloses an automated assistant, and "are you a person?" always gets the truthful line. The chat never speaks as the client or as a licensed person.
- Slots live in sessionStorage only: one tab, 30 minutes. Nothing in localStorage or cookies.
- Only two things leave the browser:
  - what the visitor sends with the site's own form or booking pop-up, seen before sending;
  - one session report (ON for omnikom.io only, the owner 2026-11-26; OFF on client sites; none when Global Privacy Control is set; 30-day retention) holding three kinds: funnel counts, redacted misses, and during shadow the redacted turns that differ.
- Redaction happens in the browser, before anything is sent: emails, phones, runs of 5 or more digits, and the name slot's value. It is best effort (an address or a name inside free text can slip through),
  so a person reads a sample before any text is used. The endpoint's per-IP cap uses a salted IP hash held 24 hours, never stored with a report.
- The visitor's name is never said back; it only pre-fills the form.
- The privacy policy gets one paragraph on the assistant.

## Consequences
No visitor text is stored until the owner decides. The chat creates no TCPA surface (ADR 006).

## UNPROVEN
The B&P 17941 quote, word for word: both law sites answered HTTP 403 (a bot wall, not bypassed).
