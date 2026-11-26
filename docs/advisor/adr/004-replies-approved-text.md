# ADR 004: Replies: approved text only, one render(), our own slot fill, variants by hash

Status: accepted by the head 2026-11-26 20:45 (rulings in R2 section 24). Design: `docs/advisor/R2-design.md`.

## Context
Today, script lines and the engine's own lines skip `render()` and so skip the claims scrub (facts file), and the same state always gives the same words.
The head ruled: no mustache.js (not maintained); write the small slot fill ourselves, with tests taken from the Mustache spec cases we use.

## Decision
- Every visible line is a claim from the pack, filled through one `render()`, and then passes the claims gate. The gate fails when a number or $ amount does not come from a
  sourced pack field. This generalises today's `scrubTotals`, which keeps only $1,299.
- The slot fill is Mustache's `{{name}}` interpolation, with HTML escaping always on. There are no sections, partials or logic. Tests come from the spec's `interpolation.yml` cases that use only these features.
- Variants: 1 to 4 approved texts per claim. The pick is an FNV-1a hash of (session, turn, claim id), never `Math.random`.
- Only slot values checked against a pack list or a number range are said back; free text never is. The visitor's name is never said back (no list can check it); it only pre-fills the form.
- A claim or derived value can depend on a claims flag (today's `claims.ts`). A seat total (`seatTotal`, C-26 PROPOSED) is shown only when its flag is on; today it is off, so the price line is the base line only.

## Consequences
Every word on screen traces to an approved claim with a source. A test can replay the exact words. "Repeat after me" has nothing to grab.

## Alternatives
mustache.js (head's ruling: no); Tracery (random, composes unapproved sentences, R1); a template language with logic (puts code in packs).
