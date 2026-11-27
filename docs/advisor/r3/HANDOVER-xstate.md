# Hand-over: XState runs the guided flows (R3, after the intent misses)

Head's order 2026-11-27 00:55 ("then XState inside 15,980 B"); scope ruled A at 01:01 with conditions (below).
Builder: ADVISOR-ENGINE (worktree advisor-engine, branch advisor/engine).

## Sizes (measured before building; Vite library build, minified, gzip level 9: the R3 race's method)
```
engine         40280 raw 12215 gzip
engine+actor   90248 raw 25775 gzip
engine+pure    87079 raw 24983 gzip
actor-only     49876 raw 13993 gzip
pure-only      46714 raw 13199 gzip
pack omnikom-io 324949 raw 68571 gzip
pack vtv 28046 raw 5436 gzip
```
With the UI at its 15,000 B target: 15,000 + 25,775 + 68,571 = 109,346 B of 125,324 B. XState fits; no hand-written table.

## Ruling A, with the head's conditions (01:01)
- xstate pinned to an exact version at least 7 days old; @xstate/graph only as a devDependency and only if the owner approved it.
- The budget test fails red by a mutant over 125,324 B.
- Byte-equal proof: every guided-script path, cp11 and golden 10,765.
- VTV's qualify flow stays out (its slots have no ask lines; those are client words).

## What is built
- `engine/flows.mjs` (new): one XState machine per pack from `pack.flows`, run with XState's pure `transition()`. Pages are states;
  routes are the page's transitions on the visitor's line, route group first; guards and actions only from the closed list (R2 5.6):
  `said(pattern)`, `remember(slot)`, `say(line)`, `offerHandoff(interest)`. A version-tagged save and load of the flow position.
- `engine/script.mjs`: `getScriptedReply` asks the machine; it no longer walks the flows itself. The card's contract
  (`{text, quickReplies, progress, showContactLink, handoff}`) is unchanged.
- `pack/convert-omnikom.mjs`: the guided script's patterns, lines, flows and rules move from `pack.script` into `pack.flows`
  (one home each); `pack.script` keeps the data the hand-off reads.
- `pack/validate.mjs`: a guard or action name outside the closed list, a route to an unknown page, a start that is no page: refused.
- R2 5.1 (flows) and 5.6 (the closed list) rewritten in place to the shape built.

## The test first (seen red before the code)
- `test/test-flows.mjs`: the machine exists; every page reached by @xstate/graph's shortest paths, then every line of a corpus
  (the script's own chips, golden's 431 messages, one plain line per pattern) answered byte-equal to today's interpreter, frozen in
  `test/script-oracle.mjs` with today's script data (`test/fixtures/script-37fac63.json`); every route taken at least once; the save
  and load round trip, a wrong version or a bad value starting fresh. Mutants: remember dropped, route group last, guards ignored.
- `test/test-budget.mjs`: engine (with XState) + omnikom-io pack + UI target at most 125,324 B. Mutant: the pack bundled into the engine.
- `test/test-validate.mjs`: a guard or action outside the closed list, a route to no page, a start that is no page, a $ amount in a
  flow line not in prices: refused. Mutants: the closed list unchecked, the flow lines not read as spoken text.
- `test/deps-hook.mjs` (new): the mutant runs copy `engine/` to a temporary folder, where `import "xstate"` finds no node_modules; this
  resolve hook looks `xstate` and `@xstate/*` up from `factory/advisor/`. The four engine tests import it first.

Seen red before the code (pasted):
```
FAIL the guided script runs on an XState machine built from pack.flows / machine undefined, pages 0 / FLOWS TEST FAIL: 1 of 1
FAIL the engine bundle carries XState (0 B) / BUDGET TEST FAIL: 1 of 3
FAIL flow guard not on the closed list -> FLOW_NAME ... FAIL $ amount in a flow line not in prices -> MONEY_UNSOURCED / PACK VALIDATOR TEST FAIL: 5 of 40
```
One test fix on the way: under the "guards ignored" mutant the tamper step crashed (`Cannot set properties of undefined`) instead of
going red on byte-equality; the step now replaces the answers object, and the mutant is caught on four assertions.

## Deliberate difference
A progress the script never produces (an unknown flow or a step out of range) now starts fresh; today's interpreter fell through to
the rules with that flow's interest. The card only stores progress the script returned.

## Result (run 2026-11-27 01:15-01:45 in the worktree; pasted)
```
FLOWS TEST PASS: 9 of 9   (every path answers byte-equal to today's interpreter (4191 replies compared))
RED (caught) remember dropped / route group last / guards ignored (4 assertions) / stale save kept   MUTANTS PASS: 4 of 4 caught
BUDGET: engine 12915 + XState 13753 = 26668 B; pack 68842 B; UI 15000 B (target); total 110510 of 125324 B
BUDGET TEST PASS: 3 of 3
BUDGET: engine 82027 + XState 13558 = 95585 B; pack 68842 B; UI 15000 B (target); total 179427 of 125324 B
RED (caught) the pack bundled into the engine   MUTANTS PASS: 1 of 1 caught
PACK VALIDATOR TEST PASS: 40 of 40 | MUTANTS PASS: 18 of 18 caught
GOLDEN TURNS PASS: 10765 of 10765 turns
baseline {"PASS":824,"PARTIAL":62,"FAIL":29} rows 915 | new {"PASS":834,"PARTIAL":62,"FAIL":19} rows 915
graded better=10 worse=0 | rows whose input differs=0 | rows whose reply text differs=9
CP11 RUN PASS: zero graded drops
results.jsonl against the 0ae1baa3 run: rows that differ in any field (timing fields aside): 0
PACK VALID: omnikom-io 0.1.0 | PACK VALID: vtv 0.1.0 | converter twice: sha256 be2e84d2... both runs
VTV ENGINE TEST PASS: 25 of 25 (3 of 3 caught) | NO MEANING 8 of 8 (3 of 3) | INTENT MISSES 8 of 8 (1 of 1)
PATTERN REWRITES 43 of 43 (6 of 6) | COMPILE 51 10 of 10 (4 of 4) | NO CLIENT TEXT: PASS (207 intent ids, 23 families checked)
```
cp11's FAIL -> PASS rows are unchanged from 0ae1baa3: #519 #560 #741 #789 #792 #859 #873 #885 #887 #902.
The pack grew 271 B gzip (68,571 -> 68,842): the flow lines are the same, written as routes.

Supply chain (head's conditions, `~/.claude/reference/supply-chain-2026-10.md`):
```
xstate@5.33.4 published 2026-11-07T19:09:28.892Z 19 days latest 5.33.4 licence MIT install scripts: none deps: none
@xstate/graph@3.0.4 published 2025-05-31T17:37:15.296Z 544 days latest 3.0.4 licence MIT install scripts: none deps: none
```
Lockfile diff in this job: none (both pinned exact in `factory/advisor/package.json` and the lockfile since cea2d9db / b5aaae4a; @xstate/graph
dev). osv-scanner on `factory/advisor/package-lock.json`: "No issues found".

## NOT DONE in this job
VTV's qualify flow (client words); the card storing the saved position in sessionStorage (OMNIKOM-IO-SITE's lane, through the head);
the engine's own conversation (`respond`) inside the machine (ADR 002 in full). CI: the ci.yml job `advisor` came after this
job (head 01:58), with the R3 report.
