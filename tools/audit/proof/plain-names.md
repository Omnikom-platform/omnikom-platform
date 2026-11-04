# Proof: work order 06, plain names

Worktree `builders/plain-names` on master d6076e8, 2026-11-04. Nothing committed or pushed. Pasted lines are real output, cut to the last lines.

## Files
`tools/audit/names.json` (11 topics, 30 rules, every rule of `run.mjs --list`), `names.mjs` (`topicOf`, `problemOf`, `TOPICS`), `summary.mjs`
(`byTopic` next to `byFamily`, `v` stays 1), `test/run.mjs` (10 new checks), `test/mutate.mjs` (4 new mutants), `README.md` ("Plain names"),
`work/06-plain-names/CONTEXT.md` (copy of the order).

## Commands

`node tools/audit/test/run.mjs` (run through `heavy.mjs`, the machine lock):
```
ok   temp folders: the run has one root omnikom-audit-run-* and every temp folder it made is inside it
ok   temp folders: a mutant run killed by its time limit prints NOT RUN and leaves no folder in the temp base
OK: 599 of 599 checks passed
exit 0
```
599 = 589 + 10 new checks (the sentence-check self-test, 4a, three of 4b, 4d, three of 4c, the no-`other` check).

`MUTATE_ONLY=<the four new names> node tools/audit/test/mutate.mjs`:
```
caught   names.json: MET-003 points at the titles topic                 (1 red: plain names: every topic is used by at least one rule: unused: heading)
caught   summary.mjs: byTopic skips a status                            (1 red: summarize on the good site (--target preview): every topic of names.mj)
caught   names.json: the MET-003 entry is dropped                       (1 red: plain names: every rule that run.mjs --list prints has a known topic a)
caught   names.mjs: topicOf returns the family prefix, not the topic    (1 red: plain names: every rule that run.mjs --list prints has a known topic a)

4 mutants, 4 caught, 0 survived, 0 not run, 0 target text missing
exit 0
```

"0 target text missing" for the older mutants: my edits to `summary.mjs` only add lines (an import, `byTopic` setup, one line after the PASS count,
one line after the status count, the `byTopic` key in `out`). None of the targets of the older `summary.mjs` mutants was edited. Checked by running every
`summary.mjs` mutant (`MUTATE_ONLY='^summary\.mjs:'`), which prints MISSING for a target not found exactly once:
```
9 mutants, 9 caught, 0 survived, 0 not run, 0 target text missing
exit 0
```
(8 older + my 1.) Mutants on other files patch files I did not touch. The full list of all mutants was not run here (CI).

`node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target preview --summary` (exit 1): one JSON object; read back: `pass false`, `byTopic.headings.FAIL 1`,
`byTopic.titles.FAIL 0`, `byTopic.setting.FAIL 4` (the preview target fails ENV-001 on the four pages of that fixture, as before).

Em dashes: node counter `String.fromCharCode(0x2014)` over names.json, names.mjs, summary.mjs, test/run.mjs, test/mutate.mjs, README.md: 0 lines in each.
(The suite's own check "no file under tools/audit contains an em dash" went red once on my first run, because my test file held the character; fixed to
`String.fromCharCode(0x2014)`, the rerun is the 599 above.)

## Watched-fail of every new assertion
Each breakage applied to a copy of `tools/audit`, `test/run.mjs` run on the copy with `OMNIKOM_AUDIT_FAILFAST=1`, first FAIL line (script kept outside the repo):
```
names.json: a 121-character sentence (MET-004)        -> FAIL plain names: every rule that run.mjs --list prints has a known topic and a sentence ...: no good entry for: MET
names.json: a sentence with no final period           -> same check: no good entry for: DSN
names.json: an unknown topic id on a rule             -> same check: no good entry for: DSN
names.json: jargon "canonical" in a sentence          -> same check: no good entry for: DSN
names.json: a digit in a sentence                     -> same check: no good entry for: DSN
names.json: an em dash in a sentence                  -> FAIL no file under tools/audit contains an em dash (the older wall, first in order)
names.json: a rule the engine lacks (XYZ-001)         -> FAIL plain names: the table names no rule the engine does not have: not in the engine: XYZ-001
names.json: ENV-001 moved to design                   -> FAIL plain names: every topic is used by at least one rule: unused: setting
names.json: two topics swapped / a topic name changed -> FAIL plain names: v is 1, the topics are the spec's eleven with their names in the spec's order ...
names.json: MET-003 dropped / MET-003 -> titles       -> the two mutants above (4a; "unused: heading")
names.mjs: topicOf of an unknown id is "" not other   -> FAIL plain names: topicOf of an unknown id is other and problemOf of it is null ...
names.mjs: problemOf of an unknown id is ""           -> same check
names.mjs: a rule id looked up on the prototype       -> same check
summary.mjs: topics not pre-created                   -> FAIL summarize on the good site (--target preview): every topic of names.mjs is in byTopic, and the sum ...
summary.mjs: PASS lines not counted per topic         -> same check (sum PASS differs)
summary.mjs: byTopic not in the summary               -> same check (after I made the assertion not crash on a missing field)
summary.mjs: a rule outside the table dropped (no other) -> FAIL summarize: a rule id outside the table is counted under byTopic.other, a WARN or an unusual status ...
```
17 breakages, 17 red for the named reason. Two (the last two summary.mjs cases) first exited 1 with no FAIL line, because my assertion threw on `undefined`;
I made the assertions read `byTopic || {}` and `?.`, reran those two, both went red as above. The 4c bad-fixture assertion
(`headings.FAIL >= 1`, `titles.FAIL === 0`) is also covered by the "MET-003 points at the titles topic" mutant (a wrong topic leaves `headings` empty).
Not watched separately: the sentence-check self-test (it is its own assertion of the limits, run green in the 599; the 121-character and period cases above
show the limits reach the 4a check).

## Factory suite: not a touched suite (the head's ruling, 2026-11-04)
`factory/test/run.mjs` was not run. Nothing outside `tools/audit` imports `summary.mjs` or `names.mjs` (the head's grep; mine too: no `factory/` file names
`summarize`, `summary.mjs` or `--summary`), so it is not a touched suite (`docs/departments/README.md` rule 8). My earlier attempts to run it were stopped by the
machine lock (`wo08 settings chain`, PID 15216, "gave up after 30 min", exit 75); that is why it was not run, not a result.

## After the head's wording change (MET-001)
MET-001 now reads "A page has no title or more than one, an empty or too long one, or the same title as another page." (98 characters; rules/MET-001.md:13
says two or more titles fail). Re-run of `node tools/audit/test/run.mjs`: NOT DONE. BLOCKED: the same lock, still held by PID 15216 (since 18:21, over
1 hour 45 minutes by 20:05), two waits of 30 minutes:
```
heavy: gave up after 30 min: wo08 settings chain (PID 15216) still holds C:\Users\DELL\.claude\state\heavy.lock. Nothing was run.
exit 75
```
The last line on record is the run before the edit: `OK: 599 of 599 checks passed`. The edit changes one string of names.json that check 4a reads (length 98, final
period, no digit, no jargon: confirmed by hand with `node`, not by the suite). UNPROVEN by the suite until it runs.
