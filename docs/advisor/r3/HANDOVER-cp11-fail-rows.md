# Hand-over: job 5, the cp11 FAIL rows (the 3 no-meaning inputs first)

Head's order 2026-11-26 23:30: job 4 -> **this job** -> XState inside the budget. "A red test per row; the 3 no-meaning inputs
first, because answering nonsense is the worse error." Builder: ADVISOR-ENGINE (worktree advisor-engine, branch advisor/engine).

## The grader's rule (head's harness, read-only copy, harness.mjs lines 51-53)
A case with no expected intent and no hand-off is FAIL when the reply's band is `answer` or `flow`, PARTIAL on `clarify`, PASS
on `fallback` (with a next step: chips or the link). The grader is not changed.

## The 3 rows (cp11 baseline, today's engine, 2026-11-26)
- #902 "123" (emoji-empty-gibberish): answered `price.team_size` with the price line. A bare number on the first turn, with
  nothing asked, is read as a team size. Fix: a bare number counts only when the last turn asked for a count or was a price
  (the follow-up rule `followUp` already has); otherwise it is the fallback.
- #887 "<script>alert(1)</script>" (offtopic-injection): answered `svc.cold_scripts` because of the word "script". Fix: markup
  is not words: text inside `<...>` is dropped before matching (in the base layer's text patterns, plain English); nothing left
  means the fallback.
- #873 "what's the caller's salary" (unanswerable, abstain): answered `info.unpublished` ("That is not on our pages. The Get
  Started form puts your question in front of the team.", with the link). The words are already the honest abstain; only
  the band says `answer`. Ruled A (below).

## Tests first (seen red before code)
- `test/test-no-meaning.mjs` on omnikom.io's pack: each of the 3 inputs on the first turn gets a band that is not `answer` or
  `flow`, with a next step. Guards that must stay green: "123" after the caller-count price still fills the count;
  "how many scripts do you write" still answers; a pay question still offers the not-published answer.
- One mutant per fix (the bare-number rule dropped; markup kept).
- Gates: GOLDEN TURNS 10765 of 10765 (any golden turn that moves is named and ruled, never re-recorded silently), cp11 via
  `r3/run-cp11.mjs`: these rows FAIL -> PASS, no row graded worse; PACK VALID; VTV tests stay green.

## Ruled (head 2026-11-26 23:56): #873 A
A reply that only says "not published" (omnikom.io's `info.unpublished`, the steer role `unpublished`) carries band `abstain`;
its text is unchanged, with a test that the reply text is byte-equal before and after (and cp11's "rows whose reply text
differs=0"). Not taken: B (leave it FAIL), C (pay-like questions to the fallback).

## Not in this job
The 26 intent misses (pack data, phrasings or cues: #17 ... #885), next in this job's order once the 3 are in.

## Result (2026-11-27 00:25, builder)
DONE on the branch, UNPROVEN on the runner until CI runs it. Files: `engine/engine.mjs` (3 rules), `pack/convert-omnikom.mjs` +
`packs/omnikom-io/pack.json` (MARKUP), `packs/base-en/base.json` + `KEPT.md` (the same MARKUP entry, so VTV reads markup the
same way), `test/test-no-meaning.mjs` (new), `test/golden-turns.json` (re-recorded, every moved turn below).

What was built, and where it differs from the plan above:
- #887: `rx.engine.MARKUP` (`<\/?[a-z][^<>]*>`, gi) comes from the pack; respondTo drops it before reading. The converter now
  runs only with `node --import ./factory/advisor/r3/ts-hook.mjs factory/advisor/pack/convert-omnikom.mjs` (the lovable source is
  .ts); its re-run moved `meta.source.commit` 0f2b1cc7 -> c4697fed and added MARKUP, nothing else in the pack changed.
- #902: **narrower than planned.** A message that is only a count (`bareCount`) on the **first turn** is the fallback. Planned
  "any bare number with nothing asked" moved 327 golden turns (later in a chat a number refines the team: "3 people" then "12")
  and turned cp11 #467 "there are 4 of us" PASS -> FAIL; both are now tests that stay green.
- #873: ruling A as given: `abstaining()` sets band `abstain` when the reply is only the steer role `unpublished`; the text is
  untouched (test: byte-equal to cp11's recorded words). VTV has no such role, so nothing changes there.

Output (pasted):
```
NO MEANING TEST PASS: 8 of 8
RED (caught) a bare number answered: 1 assertion(s) red e.g. "#902 "123" on the first turn is not answered"
RED (caught) markup read as words: 1 assertion(s) red e.g. "#887 markup is not words"
RED (caught) not published answers: 1 assertion(s) red e.g. "#873 the not-published reply abstains, with the form"
MUTANTS PASS: 3 of 3 caught

baseline {"PASS":824,"PARTIAL":62,"FAIL":29} rows 915 | new {"PASS":827,"PARTIAL":62,"FAIL":26} rows 915
graded better=3 worse=0 | rows whose input differs=0 | rows whose reply text differs=2
FAIL -> PASS (3):
  #873 "what's the caller's salary"
  #887 "<script>alert(1)</script>"
  #902 "123"
CP11 RUN PASS: zero graded drops

GOLDEN TURNS PASS: 10765 of 10765 turns   (after --write; before it: GOLDEN TURNS FAIL: 37 moved, listed below)
PATTERN REWRITES TEST PASS: 43 of 43 | MUTANTS PASS: 6 of 6 caught
PACK VALIDATOR TEST PASS: 34 of 34 | MUTANTS PASS: 16 of 16 caught
NO CLIENT TEXT: PASS (207 intent ids, 23 families checked)
COMPILE 51 TEST PASS: 10 of 10 | MUTANTS PASS: 4 of 4 caught
VTV ENGINE TEST PASS: 25 of 25 | MUTANTS PASS: 3 of 3 caught
PACK VALID: omnikom-io 0.1.0 / PACK VALID: vtv 0.1.0
```
The 2 cp11 text diffs are #887 and #902 (now the fallback, as intended). Band moves with no grade change: #910, #911, #912
(expected `info.unpublished`, now band `abstain`, same words).

Ruled (head 2026-11-27 00:31): C, keep what is pushed. There is no seat range in the pack, so no number is invented; a first-turn bare count ("5") goes to the fallback with its chips.
Turns that moved in golden-turns (before re-recording; old HEAD engine vs this tree, replayed by a scratch script):
- band abstain only (#873 rule) (8):
  - `["how much do you pay your callers"] old answer:info.unpublished new abstain:info.unpublished`
  - `["how much is that","how much do you pay your callers"] old answer:info.unpublished new abstain:info.unpublished`
  - `["do you run paid ads","how much do you pay your callers"] old answer:info.unpublished new abstain:info.unpublished`
  - `["Not on our pages"] old answer:info.unpublished new abstain:info.unpublished`
  - `["3 people","how much would that come to","how much do you pay your callers"] old answer:info.unpublished new abstain:info.unpublished`
  - `["how much do you pay your callers"] old answer:info.unpublished new abstain:info.unpublished`
  - `["how much do you pay your callers"] old answer:info.unpublished new abstain:info.unpublished`
  - `["i have 10 agents what would it cost","do you follow the do not call list","Compliance","how much do you pay your callers"] old answer:info.unpublished new abstain:info.unpublished`
- bare number -> fallback (#902 rule), turn first (7):
  - `["5"] old answer:price.team_size new fallback:`
  - `["2"] old answer:price.team_size new fallback:`
  - `["12"] old answer:price.team_size new fallback:`
  - `["12"] old answer:price.team_size new fallback:`
  - `["12"] old answer:price.team_size new fallback:`
  - `["5"] old answer:price.team_size new fallback:`
  - `["twenty"] old answer:price.team_size new fallback:`
- after an earlier moved turn (22):
  - `["5","how does your price compare to other companies"] old answer:price.compare_vendors new answer:price.compare_vendors`
  - `["5","how does your price compare to other companies","what would it total"] old answer:price.calc new answer:price.calc`
  - `["5","how does your price compare to other companies","what would it total","and the price?"] old answer:price.base new answer:price.base`
  - `["2","What services are there?"] old answer:svc.overview new answer:svc.overview`
  - `["2","What services are there?","do you follow the do not call list"] old answer:comp.dnc new answer:comp.dnc`
  - `["2","What services are there?","do you follow the do not call list","how much is that"] old answer:price.base new answer:price.base`
  - `["12","and the price?"] old answer:price.base new answer:price.base`
  - `["12","and the price?","Who supervises the callers?"] old answer:svc.cold_supervise new answer:svc.cold_supervise`
  - `["12","and the price?","Who supervises the callers?","What will I see in reports?"] old answer:svc.cold_reports new answer:svc.cold_reports`
  - `["12","and the price?","Who supervises the callers?","What will I see in reports?","what happens next"] old answer:how.after_form new answer:how.after_form`
  - `["12","Talk to someone"] old answer:human.talk new answer:human.talk`
  - `["12","Talk to someone","What does it cost?"] old answer:price.base new answer:price.base`
  - `["12","Talk to someone","What does it cost?","Price for my team size"] old answer:price.calc new answer:price.calc`
  - `["12","Talk to someone","What does it cost?","Price for my team size","can u do that for me"] old answer:who.general new answer:who.general`
  - `["12","Talk to someone"] old answer:human.talk new answer:human.talk`
  - `["12","Talk to someone","What happens after I submit?"] old answer:how.after_form new answer:how.after_form`
  - `["12","Talk to someone","What happens after I submit?","next step"] old clarify: new clarify:`
  - `["12","Talk to someone","What happens after I submit?","next step","How does it work?"] old answer:how.overview new answer:how.overview`
  - `["5","what markets can you prospect"] old answer:mkt.coverage new answer:mkt.coverage`
  - `["twenty","What does it cost?"] old answer:price.base new answer:price.base`
  - `["twenty","What does it cost?","Phone number"] old answer:trust.phone new answer:trust.phone`
  - `["twenty","What does it cost?","Phone number","Contact details"] old answer:trust.contact new answer:trust.contact`

NOT DONE in this job: the 26 intent misses (next), XState inside the budget (after).
