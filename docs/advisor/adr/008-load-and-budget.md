# ADR 008: Loading on intent, never before; the byte and speed budget

Status: accepted by the head 2026-11-26 20:45 (rulings in R2 section 24). Design: `docs/advisor/R2-design.md`.

## Context
Brief constraint 4: load after the visitor opens the chat, never before the main image (LCP bar 2.5 s). Measured today: the engine is 67,459 B gzip and the card 57,865 B, and the card is preloaded on
page load (R1).

## Decision
- Before the visitor presses the chat button, nothing of the chat loads: 0 B of UI, engine or pack. The button itself is at most 2 KB of markup and CSS inside the page.
  Loading starts on the press (phones have no hover), and the pack is fetched with its integrity hash.
- Targets (gzip): UI at most 15 KB; engine code at most 20 KB; libraries 20.2 KB (MiniSearch) or 38.9 KB (Orama); the omnikom.io pack gets what is left. In total, at most 125 KB on open, no more than today's 125,324 B.
  On the stand-in pack (61,278 B gzip, an upper bound; `node docs/advisor/r2/measure-pack-proxy.mjs`) Orama's path is 135.2 KB (over) and MiniSearch's 116.5 KB (under).
- One stated exception: during shadow, a sample of sessions loads the new engine as well, after the old one has answered. It ends with shadow.
  First reply ready within 1 s on a mid phone. Each reply at most 50 ms of main-thread work. INP at most 200 ms.
- The UI is a framework-free web component, so the same file serves React and static sites.

## Consequences
The budget is a test in CI: the build fails past it. Every target is UNPROVEN until R3 measures it.
