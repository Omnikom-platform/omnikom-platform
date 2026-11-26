# base-en: what the English base layer keeps, and why

`base.json` is the plain-English part of a runtime advisor pack. `pack/compile-51.mjs` lays a client's 5.1 pack over it. It was
chosen entry by entry from omnikom.io's runtime pack (2026-11-26, head ruling A of 22:16: "an English base layer chosen word by word;
no client's words in another client's pack, ever"). `test/test-compile-51.mjs` holds it to that:
- no trade or client word;
- no intent id;
- every entry it shares with omnikom.io's pack is the same entry. omnikom.io's pack is not re-split: one English, checked by the test.

An entry turned **off** is `{"$rx":"(?!)"}` (it never matches), `""` or `null`: the engine still finds the key, and the rule
does nothing until a client layer turns it on.

| Section | Kept | Off or left out, and why |
|---|---|---|
| tuning | all | (numbers only) |
| lexicon.stop, .contractions, .fillers | all | (plain English) |
| lexicon.groups | 39 of 57: price, quote, pay, pricey, afford, phone, setup, start, hire, guarantee, include, contract, legal, sms, email, human, hello, thanks, bye, yes, no, okay, zone, worker, report, list, privacy, time, monthly, tool, refund, trial, discount, wrong, scam, weather, much, service, appointment | Left out as the cold-calling trade or omnikom.io's services: caller, call, seller, lead, dnc, isa, followup, inhouse, va, script, record, dialer, wholesal, investor, transaction. Also left out: market (it maps "area" onto "market"), brokerage and agent (they would merge a real-estate pack's broker and brokerage questions). |
| lexicon.raw | 21 of 39: texting shorthand (wat, wut, hw, u, ur, r, y, thx, tnx, plz, pls, yall, ya, gonna, wanna, gotta, info), perform/performs/performed, texting | recording*, call/calls/called, dnc, tcpa, crm, isa, cold, fub, marketing*, advertis*: trade words |
| rx.text | all | (tokenising) |
| rx.matcher | all but two | i03, i04: "call recording" (trade) |
| rx.engine | the sentence, question, clause, ordinal, Spanish, price-word and placeholder patterns; MARKUP (an HTML tag is dropped before reading, R3 job 5) | CONTENT_FIRST, i04, i06, i07, i11-i14, i17, i18, i20, i27-i29 name omnikom.io's intent ids. i15, i16, i21-i26, i30-i33, i39-i45 are its caller, team, CRM and market follow-ups. i47 is its published price. |
| rx.cues | PAY_WORD, CLIENT_COST, APOS | PAY, PAY_PEOPLE (callers, reps) |
| rx.slots | EMAIL_RE, PHONE_RE; new: WORDS, NAME (for the typed slot readers) | the rest is omnikom.io's slot data |
| rx.routing, script, routing | the keys only, all off or empty | omnikom.io's guided team-planning flows; a client's flows come with the XState job |
| texts | engine.clarify, engine.repeat; new: form.label, form.sep (the hand-off's "City: Tracy. Timeline: ...") | every other line names omnikom.io, its price or its services. A client's fallback lines are its own unknown refusal (compile-51). |
| lists | vague, numberWords, stepNum; new: notNames (words after "I'm" that are not a name); empty slotFallback, families, servicePrice, shortChat | menus and families name intents; a client's menus are in its pack (lists.defaultMenu, lists.fallbackMenu) |

These lines are spoken to visitors: engine.clarify ("I want to get this right. Which of these is closest to what you mean?") and
engine.repeat ("To repeat: "). They go to the lawyer's read with the industry's standard lines (her question 11).
