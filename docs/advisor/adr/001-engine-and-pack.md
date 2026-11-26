# ADR 001: One engine for all sites; everything client-specific is pack data

Status: accepted by the head 2026-11-26 20:45. Code home: `factory/advisor/` in code/main; omnikom.io takes the built file, sha256 pinned, never a second source. Design: `docs/advisor/R2-design.md`.

## Context
The brief (constraint 3) asks for one engine and a knowledge pack per client, with no per-client code. Today's omnikom.io advisor keeps its
answers and phrasings in TypeScript (`data-*.ts`, 4,278 lines; facts file), so changing what it says means changing code.

## Decision
- The engine (understand, remember, decide, reply) and the chat UI are one versioned set of static files, the same on every site.
- Everything a client's assistant knows or says is in its pack (`omnikom-advisor-pack/1`, R2 section 5): claims with sources, prices, intents,
  phrasings, concept lists, slots, flows, the route group, forms and refusals.
- The factory builds the pack from the site export plus the industry pack. The client signs it off at the existing fact and legal sign-off.
- omnikom.io's pack is converted once from its data files. The cp11 harness must show zero graded drops after that.

## Consequences
- A new client needs no code, only a build. A new industry needs an industry pack (data plus one lawyer read).
- The client owns the pack: plain JSON that they can take with them.
- The engine can only do what its closed list of guards and actions allows (ADR 002), so a pack cannot add behaviour.

## Alternatives
- Per-client engine code (today): rejected; it breaks rule 1 of the brief and the platform's "one standard procedure".
- A hosted bot platform (Dialogflow CX, Rasa server): rejected; cost per request, and a runtime in maintenance mode (R1).

## Tests
The pack validator, with one failing pack per rule. The same engine build runs both sites' golden transcripts.
