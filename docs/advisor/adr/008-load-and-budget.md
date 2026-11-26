# ADR 008: Loading on intent, never before; the byte and speed budget

Status: accepted by the head 2026-11-26 20:45 (rulings in R2 section 24). Design: `docs/advisor/R2-design.md`.

## Context
Brief constraint 4: load after the visitor opens the chat, never before the main image (LCP bar 2.5 s). Measured today: the engine is 67,459 B gzip and the card 57,865 B, and the card is preloaded on
page load (R1).

## Decision
- Before the visitor presses the chat button, nothing of the chat loads: 0 B of UI, engine or pack. The button itself is at most 2 KB of markup and CSS inside the page.
  Loading starts on the press (phones have no hover), and the pack is fetched with its integrity hash.
- Targets (gzip): UI at most 15 KB; engine code at most 20 KB; XState 14.5 KB (R1); no matching library (ADR 003); the omnikom.io pack gets what is left. In total, at most 125 KB on open, no more than today's 125,324 B.
  Measured in R3 (ADR 003): engine 11,656 B, pack 68,188 B; with the UI and XState at their targets, 109,344 B. If XState does not fit, the flow table is
  hand-written (zero dependency, the same statechart shape) and both sizes are reported (head 2026-11-26 23:12).
- One stated exception: during shadow, a sample of sessions loads the new engine as well, after the old one has answered. It ends with shadow.
  First reply ready within 1 s on a mid phone. Each reply at most 50 ms of main-thread work. INP at most 200 ms.
- The UI is a framework-free web component, so the same file serves React and static sites.

## Consequences
The budget is a test in CI: the build fails past it (not built yet). Engine and pack are measured (R3, ADR 003); the UI, XState and every timing are UNPROVEN.
