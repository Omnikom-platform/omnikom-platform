# ADR 006: Hand-off: the site's own form or booking pop-up, pre-filled; the chat takes no contact details

Status: accepted by the head 2026-11-26 20:45 (rulings in R2 section 24). Design: `docs/advisor/R2-design.md`.

## Context
The flow that earns ends in a lead or a booked call. omnikom.io already has a Get Started form (interest, business type, markets, notes, sent to `/api/lead`; facts file) and a booking
pop-up whose step 1 takes the lead and step 3 is Cal.com tied to that lead (`lovable-app/src/lib/booking-wizard.ts:2`, branch head 0f2b1cc). The platform's shape: leads reach a client's CRM as an export plus
import, never an automatic push (repo CLAUDE.md, non-negotiable 1). TCPA applies when a phone number is collected for calls.

## Decision
- The chat hands off to the host page with a DOM event, `omnikom-advisor:handoff` ({ form, prefill }), kept 30 minutes in sessionStorage across a page change as today. Never a URL parameter.
  The host's adapter opens its own form or booking pop-up, pre-filled. omnikom.io's adapter is in OMNIKOM-IO-SITE's lane, through the head; factory sites get it from the factory's form script.
- The notes get a short summary of slot values and, after a fallback, "Question: <the unanswered line, up to 120 characters>", as today (`engine.ts` handoffFor). Never the transcript. The visitor sees and can edit every field and presses send.
- The chat never asks for or keeps an email or phone number. If one is typed, the privacy claim answers and it is not stored.
- The lead carries an advisor mark and the pack version, so the CRM can count leads and wins from the assistant. **This is a change request:** today the lead source is only
  `omnikom-lovable` or `booking-wizard` (`lovable-app/deploy/lib/lead.js:18-19`). It goes to OMNIKOM-IO-SITE through the head.
- The consent notice is the form's own (the site contract requires one). On VTV, its wording waits on the lawyer.

## Consequences
No new lead path, and no TCPA surface in the chat. Tests never press send: every browser run fails on a request to `/api/lead`, or, on VTV, to any POST.
