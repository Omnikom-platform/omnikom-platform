# ADR 005: Fallback: two stages with no-match counters, and no timers

Status: accepted by the head 2026-11-26 20:45 (rulings in R2 section 24). Design: `docs/advisor/R2-design.md`.

## Context
Rasa: "The Two-Stage Fallback is made to handle low NLU confidence in multiple stages". CX: "Every flow has event handlers for the no-match and no-input built-in events", with
numbered handlers "invoked instead of sys.no-input-default and in order". Today: a clarify band (2 or 3 options), then a fixed fallback.

## Decision
- No-match 1: a clarify menu of the top 2 or 3 intents. No-match 2: ask for other words, with the default menu. No-match 3: offer the form, the booking or the
  verified phone. The counter resets on any matched turn. The fallback turns do not move a form on.
- No-input (an empty send): one approved nudge. **No timers**: the chat never speaks unasked.
- Each page may have its own no-match lines; otherwise the flow's lines apply, then the pack's defaults.

## Consequences
A lost visitor reaches a person's channel in at most 3 turns. Nothing pops up by itself (WCAG time limits; harmless to the page).

## Tests
A golden case for each stage on both sites (O8). A property: the counter never passes 3 without the offer.
