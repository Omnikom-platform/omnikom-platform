# Hand-over: job 3, the intents the engine steers by move into the pack (pack.steer)

Head's order 2026-11-26 21:48 and 21:53: job 3 first, then the matcher race, then job 4 (VTV in the engine), then XState.
Builder: ADVISOR-ENGINE (this worktree, branch advisor/engine). Files: factory/advisor/engine/{engine,matcher,index}.mjs,
pack/convert-omnikom.mjs, pack/validate.mjs, packs/omnikom-io/pack.json (regenerated), test/{no-client-text,test-validate,golden-turns}.mjs.

## Why
engine.mjs named 70 omnikom intent ids and families ("price.calc", "svc.", "chat.yes"...) and matcher.mjs one ("chat.").
A second pack (VTV) has none of them. The engine must name no intent: a pack names them, by role.

## The red test (seen red 21:47)
test/no-client-text.mjs, extended: besides the banned words, any quoted string in engine/ that is an intent id of a pack
under packs/, or starts with an intent family of one ("price.", "how." ...), fails it. Seen: NO CLIENT TEXT: FAIL (72).

## The guard (equal behaviour, not only cp11)
cp11 is mostly single turns; the follow-up rules read the last intent. test/golden-turns.mjs pins 10,761 turns written by
the engine at cea2d9d: 700 seeded random conversations, 15+ hand paths, and a grid (each of the 104 svc/price/how/crm/
mkt/comp/slot intents opened by its button, then each of 75 follow-ups). NODE_V8_COVERAGE showed every follow-up rule
ran except: lastAsk "team" and "callers" (no intent of this pack asks them: dead for this pack), slotRemap's callers and
crm remaps, the i28 service-total row, and lastAsk "market" inside the place rule.

## The table (data; a role a pack leaves out turns its rule off)
steer.ids: pii, language, unpublished, yes, repeat, basePrice; slotCount, slotTeam, slotPlace, slotTool, slotBiz;
countPrice, teamPrice, placeAnswer, toolAnswer, countService, toolHandoff, placeMulti, consent, dedicated, teamService, otherServices.
steer.prefix: chat, slot, price, service, place, rules.  steer.limits / steer.serviceTotal: [{last: rx.engine name, to: id}].
steer.siblings: {team: $rx, words: [{word: $rx, to: id}], other: id} (the words "isa", "t", "marketing", "production" leave the engine).
steer.stepNext: {prefix, max}.
Validator (pack/validate.mjs): STEER_ID (every target is an intent; prefix+2..max exist), STEER_PREFIX (starts at least one
intent), STEER_RX (names a pattern in rx.engine); tests + mutants in test/test-validate.mjs. A pack without steer is valid.

## Done when (all pasted, run by the builder)
NO CLIENT TEXT: PASS · GOLDEN TURNS PASS: 10761 of 10761 · CP11 RUN PASS, 0 graded changes, 0 text diffs ·
PACK VALID omnikom-io (same sha over 2 runs) · validator, rewrites tests and their mutants PASS · gitleaks clean.

## Result (2026-11-26 22:05, run by the builder; output pasted)
- NO CLIENT TEXT: FAIL (72) before; after: `NO CLIENT TEXT: PASS (207 intent ids, 23 families checked)`
- `PACK VALIDATOR TEST FAIL: 5 of 34` before the rule; after: `PACK VALIDATOR TEST PASS: 34 of 34`, `MUTANTS PASS: 16 of 16 caught`
- converter twice: sha256 c6cb7faa0b84e9aad164650bbc4ab35b58ef65e5b3316bce4d196e657e7ddecb both runs; `PACK VALID: omnikom-io 0.1.0` (203 regexes)
- `GOLDEN TURNS PASS: 10765 of 10765 turns`; watched fail: "isa" steered to transaction -> `GOLDEN TURNS FAIL: 163 of 10765`;
  stepNext.max 4 -> `FAIL: 5 of 10765`; limits rule dropped from the engine -> `FAIL: 24 of 10765`; restored -> PASS
- run-cp11: `graded better=0 worse=0 | rows whose input differs=0 | rows whose reply text differs=0`, `CP11 RUN PASS: zero graded drops`,
  `FAIL -> PASS (0)`
- `PATTERN REWRITES TEST PASS: 43 of 43`, `MUTANTS PASS: 6 of 6 caught`

## Not in this job (said plainly)
The follow-up rules keep omnikom's conversation shape in code (a count after a price, sibling services, steps): only the
names moved. The XState job turns them into pack routes. VTV still does not run: engine/slots.mjs reads omnikom's slots
and the engine reads the runtime shape only the omnikom converter writes. That is job 4.
