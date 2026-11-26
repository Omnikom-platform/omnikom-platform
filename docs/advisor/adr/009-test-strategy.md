# ADR 009: Tests: the cp11 bar, golden transcripts, properties, mutants, held-back

Status: proposed in R2 (2026-11-26), waiting on the head. Design: `docs/advisor/R2-design.md`.

## Context
Repo rule 11: a rule is a test with a mutant. The head's bar: zero graded drops against the live baseline (`cp11-results.jsonl`, 915 rows: PASS 824, PARTIAL 62, FAIL 29;
`node docs/advisor/r2/tally-baseline.mjs`) and zero made-up claims. CX: golden test cases "compared from golden to latest run". Rasa: test stories with "entire conversations".

## Decision
The suites, all test first and seen failing first:
1. Unit tests per layer contract.
2. Validator tests, one failing pack per rule.
3. The head's single-turn harness against cp11.
4. Golden whole-conversation transcripts: `@xstate/graph` shortest paths, cp11's 34 multi-turn rows, and real misses.
5. fast-check 4.10.x properties: determinism, no unsourced number, escaping, time bound, declared states, snapshot round trip.
6. StrykerJS mutants. The bar is set at R3 and may only rise.
7. The head's held-back run.
8. Browser end to end per site (R2 sections 16 and 17), on Chromium and WebKit (both on this machine; there is no Firefox). A clean CI runner must download browsers, which needs the owner's yes.

## Consequences
A pack or engine version reaches visitors only through every suite. The dev dependencies need the owner's yes.
