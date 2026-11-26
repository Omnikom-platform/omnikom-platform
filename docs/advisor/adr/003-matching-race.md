# ADR 003: Matching: today's scorer, kept by measurement; concept lists; the band

Status: accepted by the head 2026-11-26 20:45; the race decided by the head 2026-11-26 23:12 (ruling A) on the R3 measurement.
Design: `docs/advisor/R2-design.md`. Record of the race: `docs/advisor/r3/HANDOVER-race.md`; its code is in history at 54c7121.

## Context
Matching turns the visitor's words into scored intents: a word-weight similarity over the pack's phrasings (tf-idf cosine
blended with phrasing coverage, `factory/advisor/engine/matcher.mjs`), plus the cue patterns and a context boost. Answer at
0.5 or more with a 0.06 margin; clarify at 0.35 or more (pack tuning). The head ruled that Orama 3.1.18 (Apache-2.0) and
MiniSearch 7.2.0 (MIT) race in R3 on the cp11 baseline: fewer graded drops wins, then fewer bytes; the bar is zero drops.

## Measured (R3, 2026-11-26)
Each library took over only the phrasing similarity step, on the matcher's own tokens (no library stemming, stop words,
typo tolerance or prefix): its score for each phrasing divided by that phrasing's self-score, capped at 1, best phrasing
per intent; everything after it unchanged. Library defaults, one run each, nothing tuned on cp11. Bytes: a Vite 8.3.5
library build of engine + library, minified, gzip level 9. Run: `node "$HOME/.claude/scripts/heavy.mjs" --label "advisor
matcher race" -- node factory/advisor/race/run-race.mjs <out>`:
```
pack omnikom-io: 323260 B raw, 68188 B gzip
own        cp11 {"PASS":824,"PARTIAL":62,"FAIL":29} worse=0 FAIL->PASS=0 textDiff=0 | GOLDEN TURNS PASS: 10765 of 10765 turns | 11656 B gzip (38182 raw) | build 1215 ms, first reply 47.9 ms
minisearch cp11 {"PASS":778,"PARTIAL":68,"FAIL":69} worse=77 FAIL->PASS=2 textDiff=99 | GOLDEN TURNS FAIL: 2219 of 10765 turns changed | 18037 B gzip (61988 raw) | build 505.2 ms, first reply 1249.1 ms
orama      cp11 {"PASS":804,"PARTIAL":73,"FAIL":38} worse=36 FAIL->PASS=0 textDiff=51 | GOLDEN TURNS FAIL: 1022 of 10765 turns changed | 35110 B gzip (123458 raw) | build 254.7 ms, first reply 1000.9 ms
RACE: no library holds zero drops (orama 36, minisearch 77)
```

## Decision
- Today's scorer stays; neither library ships. Both left `factory/advisor/package.json` and the lockfile with the race code.
- Concept lists (ChatScript's idea, R1) live in the pack. The cue patterns are pack data, restricted (no back-references,
  no look-behind, no nested repeats); the validator times each one on a 500-character probe.
- The context boost is pack tuning (`boostNext` 0.04, `boostYes` 0.1); so are the thresholds.
- Scores are to be rounded to 3 decimals, ties broken by the pack's intent order: NOT DONE. It changes ties, so it is its own
  step, with the golden turns rewritten and cp11 re-run.
- The matcher's index is built in the browser from the pack's phrasings, not shipped prebuilt.

## Consequences
- No library stemming: word forms go in the pack's lexicon and concept lists (Spanish too, if a pack needs it).
- Bytes: engine 11,656 B gzip. With the pack (68,188 B), UI 15,000 B (target) and XState 14,500 B (R1, not yet built here),
  the total on open is 109,344 B, under 125,324 B (ADR 008).
- UNPROVEN: equal scores on every browser; the index build time on a phone.

## Alternatives
Orama 3.1.18 (36 graded drops, 35,110 B) and MiniSearch 7.2.0 (77 graded drops, 18,037 B): measured above, not taken.
Fuse.js, FlexSearch (returns no scores), Lunr (dead): not taken (R1).
