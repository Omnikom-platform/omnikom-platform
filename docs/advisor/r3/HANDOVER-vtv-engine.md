# Hand-over: job 4, VTV runs in the engine (English base layer, 5.1 compiler, slot readers by type)

Head's order 2026-11-26 21:53: job 3 (done, 7886313) -> matcher race -> **job 4** -> XState flows. M319: both sites on the new chat.
Builder: ADVISOR-ENGINE (worktree advisor-engine, branch advisor/engine). The race settled the runtime shape: today's scorer,
no matching library (head 23:12, ruling A; 7965002, ADR 003). Job 4 option A ruled by the head 22:16.

## Where it stands (observed 22:11)
`createAdvisor(packs/vtv/pack.json)` -> `THROWS: Cannot read properties of undefined (reading 'text')`. VTV's pack is in R2 5.1's
authoring shape (claims, facts, forms, refusals, typed slots); the engine reads the runtime shape (lexicon, rx.{text,matcher,
engine,slots,routing,cues}, texts, lists, tuning, script, routing, steer) that only pack/convert-omnikom.mjs writes.
In the omnikom pack those sections mix three kinds of words: plain English (contractions, fillers, typo fixes like
"wat"->"what", tokenising patterns), the cold-calling trade ("caller", "dnc", "isa" in lexicon.raw and lexicon.groups), and
omnikom's own (lists.defaultMenu, texts.engine.handoff.*, slots.crms, slots.callerUnit). engine/slots.mjs reads omnikom's
slots only (caller count, team size, CRM, US states and cities, business type).

## The job, in three parts
1. **English base layer** `packs/base-en/base.json`: only the plain-English part, chosen entry by entry, with a written list of
   what was kept and why. The omnikom pack becomes base-en + its own layer (the converter writes the layer; build-pack merges).
   Guard: omnikom's merged runtime pack is byte-equal to today's, or GOLDEN TURNS PASS 10765 and cp11 at 0 diffs.
   A new test (in no-client-text's pattern) fails if base-en holds a trade or client word (omnikom, caller, isa, dnc, crm names...).
2. **5.1 compiler** `pack/compile-51.mjs`: base-en + a 5.1 pack -> runtime pack. Intents' variants from their claims (source
   kept); refusals map to steer roles (language, unknown -> the fallback with the form, disclosure); forms -> hand-off with
   prefill fields (`forms[].fields`, slot -> field); MISSING facts can only answer "unknown + the form" (the validator already
   refuses a line that uses one). VTV gets no steer rules but those (none of omnikom's follow-up rules).
3. **Slot readers by type** in engine/slots.mjs: `place` (the pack's values list, whole words, edit distance from text.mjs),
   `enum` (values plus the pack's phrasings for each), `name` ("my name is X", "I'm X"; never reflected when `reflect:false`),
   `number`. Omnikom's readers stay as they are, used only when a pack declares those slots; the engine's hand-off line is
   built from forms[].fields, not texts.engine.handoff.callers/team/crm.

## Tests first (seen red before code)
- `test/test-vtv-engine.mjs`: R2 section 17's V2-V10 at engine level, single turn, on the compiled VTV pack:
  V2 "We want to buy in Tracy" -> buy, city=Tracy, contact form pre-filled, nothing sent; V3 "What's my house in Fremont
  worth?" -> no number, homeValue form pre-filled; V4 "Do you cover Oakland?" -> the service-area claim with its 11 cities and
  the form; V5 the two steering lines -> the steering refusal, no neighbourhood claim; V6 phone while MISSING -> unknown + form;
  V7 "Are you Francine?" -> the disclosure, never "I am Francine"; V8 licence -> the claim only if signed, else unknown;
  V9 a Spanish line -> the language line; V10 no forbidden word in any reply of the run. Red today: the pack does not build.
- Mutants in the repo's pattern: a place reader that accepts a city outside the list; a name reflected when reflect:false;
  a MISSING fact answered; the compiler dropping a claim's source.
- Unchanged gates: GOLDEN TURNS PASS 10765 of 10765, cp11 0 graded / 0 text diffs, PACK VALID both packs, NO CLIENT TEXT.

## Size (an estimate, not measured)
About 700-900 lines new or changed: compile-51 ~250, base-en split (converter + build-pack + the kept-words list) ~200,
typed readers ~150, hand-off from forms ~50, tests and mutants ~250. Two sittings of one builder. The largest risk is the
base split moving an omnikom reply; the golden and cp11 catch that.

## Ruled (head 2026-11-26 22:16): A
An English base layer chosen word by word; no client's words in another client's pack, ever. (B, copying omnikom's runtime
sections whole, was not taken.)

## cp11 FAIL rows this job moves: none (said before it starts, head 23:12)
Job 4 adds VTV's paths (base-en, compile-51, typed slot readers) and keeps omnikom.io's pack and matcher path byte-for-byte;
its gate is 0 cp11 changes, so it moves none of the 29 FAIL rows. The 29 (today's scorer, cp11, 2026-11-26), for a job of
their own:
- 26 intent misses, pack data (phrasings or cues): #17, #25, #26, #33, #84, #88, #89, #98, #100, #103, #154, #194, #244, #307,
  #430, #485, #519, #557, #560, #629, #669, #741, #789, #792, #859, #885.
- 3 inputs with no meaning that still got an answer, engine (ADR 005, the band): #873 "what's the caller's salary"
  (info.unpublished), #887 "<script>alert(1)</script>" (svc.cold_scripts), #902 "123" (price.team_size).

## Not in this job
XState flows (the buyer and seller flows of R2 5.1; V2's "buyer flow" is a single-turn hand-off here, the flow comes with
XState); the Calendly hand-off (waits for her answer to question 6); lawyer wording (her question 11); any deploy.
