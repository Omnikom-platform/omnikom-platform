# ADR 003: Matching: Orama and MiniSearch race in R3; concept lists; the band

Status: accepted by the head 2026-11-26 20:45 (rulings in R2 section 24). Design: `docs/advisor/R2-design.md`.

## Context
Matching turns the visitor's words into scored intents. Today it is a word-weight similarity over 3,234 phrasings, plus the CUES regexes and a context boost (facts file).
Its thresholds are in `engine.ts:32-40`: answer at 0.5 or more with a 0.06 margin; clarify at 0.35 or more. The head ruled that Orama 3.1.18 (Apache-2.0, 24.4 KB) and
MiniSearch 7.2.0 (MIT, 5.7 KB, not maintained) race in R3 on the cp11 baseline: fewer graded drops wins, then fewer bytes.

## Decision
- Both run in R3 behind the same `understand()` contract, with the same normaliser, concept expansion and band.
- Concept lists (ChatScript's idea, R1) live in the pack. Today's cue patterns (`cues.ts`, 1,422 lines) are carried into the pack as data, restricted
  (no back-references, no look-behind, no nested repeats); the validator times each one on a 500-character probe. Zero graded drops after that conversion is UNPROVEN until R3.
- The context boost moves into the pack's tuning (`boostNext` 0.04, `boostYes` 0.1, `engine.ts:790`).
- Scores are rounded to 3 decimals, and ties are broken by the pack's intent order. The thresholds move into the pack, starting from today's values.
- The index is built in the browser from the pack's phrasings, not shipped prebuilt (bytes). Its build time on a phone is measured in R3.
- "Then bytes" is read against the budget (ADR 008): on today's stand-in pack (61,278 B gzip, an upper bound) only MiniSearch's path fits 125 KB.

## Consequences
- The pick is made by measurement, not by argument. The loser is not shipped.
- If MiniSearch wins, it has no stemming ("No stemming is performed", R1): the concept lists carry word forms.
- UNPROVEN: equal scores on every browser.

## Alternatives
Fuse.js (kept in reserve for short labels), FlexSearch (returns no scores, R1), Lunr (dead, R1): not taken.
