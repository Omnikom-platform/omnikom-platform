# Hand-over: the matcher race (R3, ADR 003)

Ordered by the head 2026-11-26 21:53 ("3, then the matcher race (it can change the runtime shape, so it settles before
anything compiles to it), then job 4"). Rulings it rests on: ADR 003 (`docs/advisor/adr/003-matching-race.md`), head 21:48
(Vite 8.3.5 for the bytes, installed in b5aaae4). Builder: ADVISOR-ENGINE, worktree `builders/advisor-engine`.

## What
Orama 3.1.18 and MiniSearch 7.2.0 race behind the matcher's one scoring step. Fewer graded cp11 drops wins; on a tie,
fewer bytes (gzip of a Vite library build of engine + library). The loser leaves package.json and the lockfile. R3's bar
holds for the winner: zero graded drops against cp11.

## Fixed before measuring (so the race is not tuned to cp11)
- Same normaliser: both libraries index the matcher's own tokens (words, stop words, lexicon, stem), one document per
  phrasing. Both tokenizers split on spaces and change nothing: no library stemming, stop words, typo tolerance or prefix.
- One step swapped: the phrasing similarity (`best` in `Matcher.rank`) becomes the library's score for each phrasing
  divided by that phrasing's self-score (its score when queried with its own tokens), capped at 1, best phrasing per
  intent, intents in pack order (today's tie order). Everything after it stays: query coverage, cues, context boost,
  small-talk damping, the band.
- Library defaults: BM25 parameters, OR matching. One run per library; no knob is tuned on cp11.
- Today's scorer runs as the reference row.

## Files
- `engine/matcher.mjs`, `engine/index.mjs`: an optional `scorer` (`createAdvisor(pack, { scorer })`); none = today's.
- `engine/scorers/rank.mjs` (self-score, cap, best per intent, pack order), `engine/scorers/minisearch.mjs`,
  `engine/scorers/orama.mjs`. Each takes its library as an argument, so `engine/` imports no package.
- `race/scorers.mjs` (name to scorer), `race/advisor.mjs` (loadAdvisor for run-cp11, scorer from ADVISOR_SCORER),
  `race/entry-*.mjs` (byte builds), `race/run-race.mjs` (per contestant: cp11, golden turns changed, gzip bytes, build ms).
- `test/golden-turns.mjs`: `--scorer <name>` (check only; information, the golden pins today's scorer).
- `test/no-client-text.mjs`: reads engine/ recursively (a sub-folder crashed it with EISDIR).
- `test/test-scorers.mjs` (first).

## Tests first (seen red)
`test/test-scorers.mjs`, per library: its own words score a phrasing's intent 1; every score in [0,1]; a partial match
between 0 and 1; the same query twice gives the same scores; no match gives no intent; intents in pack order; the engine
answers turns with this scorer. Mutants (repo pattern): self-score division off; pack order off.

## Done means
`race/run-race.mjs` output pasted (through heavy.mjs): per contestant the cp11 tally, rows graded worse, FAIL->PASS rows,
golden turns changed, gzip bytes, index build ms in Node. A phone's build time stays UNPROVEN. If a library holds zero
drops, the loser is removed in this job (npm uninstall --ignore-scripts through heavy.mjs, osv-scanner after). If none
does, the result goes to the head with options before anything is removed.

## Size
About 300 lines, one sitting (estimate).

## Result (2026-11-26 23:04)
Tests first: `node factory/advisor/test/test-scorers.mjs` was red ("FAIL the scorers load ... SCORERS TEST FAIL: 1 of 1"), then
"SCORERS TEST PASS: 14 of 14", "MUTANTS PASS: 2 of 2 caught". `golden-turns.mjs` (today's scorer): "GOLDEN TURNS PASS: 10765 of
10765 turns". `no-client-text.mjs`: "NO CLIENT TEXT: PASS (207 intent ids, 23 families checked)", red on a word planted in scorers/.

`node "$HOME/.claude/scripts/heavy.mjs" --label "advisor matcher race" -- node factory/advisor/race/run-race.mjs <scratch>/race-1`:
```
pack omnikom-io: 323260 B raw, 68188 B gzip
own        cp11 {"PASS":824,"PARTIAL":62,"FAIL":29} worse=0 FAIL->PASS=0 textDiff=0 | GOLDEN TURNS PASS: 10765 of 10765 turns | 11656 B gzip (38182 raw) | build 1215 ms, first reply 47.9 ms
minisearch cp11 {"PASS":778,"PARTIAL":68,"FAIL":69} worse=77 FAIL->PASS=2 textDiff=99 | GOLDEN TURNS FAIL: 2219 of 10765 turns changed | 18037 B gzip (61988 raw) | build 505.2 ms, first reply 1249.1 ms
orama      cp11 {"PASS":804,"PARTIAL":73,"FAIL":38} worse=36 FAIL->PASS=0 textDiff=51 | GOLDEN TURNS FAIL: 1022 of 10765 turns changed | 35110 B gzip (123458 raw) | build 254.7 ms, first reply 1000.9 ms
RACE: no library holds zero drops (orama 36, minisearch 77)
```
FAIL -> PASS: today's scorer 0; MiniSearch 2 (#485 "how you doing", #887 "<script>alert(1)</script>") while dropping 77; Orama 0.
Orama's drops are mostly PASS->PARTIAL "clarify menu holds the right option, no answer" (e.g. #27, #54, #64, #79, #109).

Timing (`race/time-build.mjs`, one fresh process each; the race's own column is warmed by run order):
```
{"name":"own","coldBuildMs":819.3,"coldFirstReplyMs":430.4,"warmBuildMs":613.9}
{"name":"minisearch","coldBuildMs":462.3,"coldFirstReplyMs":1299,"warmBuildMs":568.2}
{"name":"orama","coldBuildMs":248.3,"coldFirstReplyMs":747.1,"warmBuildMs":173.5}
{"name":"own","coldBuildMs":501.2,"coldFirstReplyMs":240.8,"warmBuildMs":354.7}
```
Too noisy on this shared machine to decide anything (today's scorer measured 819 then 501 ms cold). A phone's figure: UNPROVEN.

Budget (R2 section 10, at most 125,324 B gzip on open): the real pack is 68,188 B gzip, above R2's stand-in "upper bound" of
61,278 B. With UI 15,000 (target) and XState 14,500 (R1, not yet built here): today's scorer 15,000 + 11,656 + 14,500 + 68,188 =
109,344 B; MiniSearch 115,725 B; Orama 132,798 B (over).

Verdict: no library holds zero drops. Nothing is removed until the head rules.

## Not in this job
Rounding scores to 3 decimals (ADR 003): it changes ties, so it is its own step after the winner. Spanish. The phone
build-time figure.
