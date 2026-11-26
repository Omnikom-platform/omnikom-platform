# ADR 002: XState 5 runs the pack's flows

Status: proposed in R2 (2026-11-26), waiting on the head. Design: `docs/advisor/R2-design.md`.

## Context
Today two parts own the conversation: the guided script and the engine (`assistant-card.tsx:171-182`). Their state lives in a React ref and is lost on reload (`engine.ts:44-59`).
R1 picked XState 5.33.4 (MIT; maintained by both routes; 14.5 KB gzip), and measured a persisted snapshot restoring (`["plan",12,88]`).

## Decision
- One XState 5 machine owns the whole conversation. Version 5 is pinned, because 6 is in beta.
- The machine's states and transitions come from the pack's flows, CX style: flows, pages, routes, one route group, and forms.
  Guards, actions and derived slots are named in the pack and implemented only in the engine, from the closed list in R2 section 5.6
  (for example `slotFilled`, `slotIs`, `numberAtLeast`, `lastIntentIs`, `noMatchAtLeast`, `flagOn`, `remember`, `say`, `offerHandoff`, `seatTotal`). The validator refuses any other name.
  Adding a name is engine work, with its own test and mutant.
- The evaluation order is fixed in the engine and keeps today's order step for step (R2 section 4, mapped to `engine.ts` lines), the same for every pack.
  The context boost ("next" ids +0.04, an offered "yes" +0.1) is read from the pack and passed to `understand()` as context, as today.
- The snapshot is saved to sessionStorage after each turn, tagged with the engine and pack versions. On a version mismatch or a failed load, the chat starts fresh.

## Consequences
- A reload keeps the conversation. Every path can be listed for tests with `@xstate/graph` (dev only).
- UNPROVEN until R3: building the machine from pack JSON with named implementations, and its byte cost after tree-shaking.

## Alternatives
- Keep today's hand-written order: rejected; two owners, state lost on reload.
- A hand-written state machine: rejected (rubric 2: nothing re-invented that exists and works).
