# Proof: work order 25, questions 2 to 5 of the six-question report

Date 2026-11-09. Builder session of `HEAD_SEO-and-audits_2026-11-09`. Nothing committed, nothing pushed.
Changed files: `tools/audit/report.mjs`, `tools/audit/test/run.mjs`, `tools/audit/test/mutate.mjs`, `tools/audit/README.md`,
this file, and the status and Findings of `work/25-report-questions-2-5/CONTEXT.md`.

## 1. The commands and their last lines

Full suite (through the heavy wrapper, `~/.claude/scripts/heavy.mjs --wait-min 120`):

```
node tools/audit/test/run.mjs
...
ok   temp folders: a mutant run killed by its time limit prints NOT RUN and leaves no folder in the temp base
OK: 673 of 673 checks passed
```

Exit 0, 0 `FAIL` lines. 673 = 653 + 20 new checks (19 plus the "live: null and live: undefined do not throw" check added after the
head's review; the first final run said 672 of 672).

The 4 new mutants (through the heavy wrapper, `--wait-min 120`):

```
MUTATE_ONLY="question 4 prints a live number|flattened competitor source|live number with no value|BLOCKED live question" node tools/audit/test/mutate.mjs
caught   report.mjs: question 4 prints a live number that is no fact (referring domains + 1) (1 red: report --live: the real report.json (report-live.mjs on the skill's fi)
caught   report.mjs: a flattened competitor source points at entry 0 for every competitor (1 red: report --live: the real report.json (report-live.mjs on the skill's fi)
caught   report.mjs: a live number with no value is printed as 0        (1 red: report --live: the synthetic report.json with parts that have no value)
caught   report.mjs: a BLOCKED live question is rendered as answered    (1 red: report --live: a live report whose questions 2 to 5 are all BLOCKED pr)

4 mutants, 4 caught, 0 survived, 0 not run, 0 target text missing
```

The mutant run finished after the last edit of every changed file (files 04:41, run 04:53 local); the suite run above is the final one.

CLI run on the bad fixture (the audit exits 1 because the fixture is bad; the report exits 0, stderr empty):

```
node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target preview --summary > <temp>/summary.json     (exit 1, 2868 bytes)
node tools/audit/report.mjs <temp>/summary.json --live <a report.json> --checked-at 2026-11-09 > <temp>/report.md  (exit 0, 3632 bytes)
node tools/audit/report.mjs <temp>/summary.json --checked-at 2026-11-09 > <temp>/nolive.md
cmp <temp>/nolive.md <baseline made before the change, same summary>        -> identical
```

`<a report.json>` is a real one: `report-live.mjs` of the skill run on the skill's own fixtures, plus a hand-written
`authority.json` and `research/competitors.json` (no skill fixture holds them; the test writes the same two by hand).
Temp files were in the session scratchpad and are removed (section 4).

## 2. Watched red (step 5)

Each break patches ONE exact text in a COPY of `tools/audit` (the patch must apply exactly once or the line says MISSING), runs the
whole suite on the copy, and prints the `FAIL` lines. Breaks B1 to B14 break `report.mjs`; T1 to T3 break the test itself.

```
RED   B1 BLOCKED card text changed (2 FAIL)
      FAIL report: sections 2 to 5 are each a Not measured yet card with a What unblocks it line, and say nothing measured
      FAIL report --live: a BLOCKED question 3 prints exactly the Not measured yet card of the report without live ...
RED   B2 Measured line takes the newest day (1 FAIL)
      FAIL report --live: each answered card ends with Measured <day> from <the plain name of the source>, the day being the oldest ...
RED   B3 caps at 6 instead of 5 (1 FAIL)
      FAIL report --live: the lists are capped: 5 of 12 missing searches then and 10 more (15 need a page); ...
RED   B4 percentage floored (2 FAIL)
      FAIL report --live: the synthetic report.json (Q3 BLOCKED) with good, no date: the source rule holds over the whole report: q5.citedShare ...
      FAIL report --live: a share is printed as a rounded percentage (0.666 is 67%, ...
RED   B5 a string counts as a number (1 FAIL)
      FAIL report --live: a part that is null, missing or not a whole number reads not measured yet with no digit and no fact (never 0), ...
RED   B6 a row label with jargon (1 FAIL)
      FAIL report --live: the real report.json (report-live.mjs on the skill's fixtures) with bad-MET-003 (preview), dated: no rule id, file name, command line, jargon word, em dash, table ...
RED   B7 a file name in a source name (4 FAIL)
      FAIL report --live: each answered card ends with Measured <day> from <the plain name of the source> ...
      FAIL report --live: the real report.json ... dated: no rule id, file name, command line, jargon word ...
      FAIL report --live: the synthetic report.json (Q3 BLOCKED) with good, no date: no rule id, file name, command line, jargon word ...
      FAIL report --live: the synthetic report.json with parts that have no value, with 30 FAILs, dated: no rule id, file name ...
RED   B8 a second --live is accepted (1 FAIL)
      FAIL report CLI --live: 9 wrong calls exit 2, print nothing on stdout and say why in one line on stderr: --live twice: 0 
RED   B9 a question twice is accepted (1 FAIL)
      FAIL report --live: 11 things that are not a live report (not an object, no questions list, question 4 missing, question 2 twice, ...) throw an AuditError
RED   B10 facts lose their origin (4 FAIL)
      FAIL report --live: the real report.json ... dated: the source rule holds over the whole report: q2.total: no fetchedAt or origin | ...
      FAIL report --live: the synthetic report.json (Q3 BLOCKED) with good, no date: the source rule holds over the whole report: q2.total: no fetchedAt or origin | ...
      FAIL report --live: the synthetic report.json with parts that have no value ... the source rule holds over the whole report: q2.total: no fetchedAt or origin | ...
      FAIL report CLI --live: <summary.json> --live <report.json> prints the markdown of report() with that live, exit 0, nothing on stderr; --json carries the live facts with fetchedAt and origin
RED   B11 the usage line forgets --live (1 FAIL)
      FAIL report CLI --live: the usage line names --live
RED   B12 a null live is refused (2 FAIL; second run, after the head's review: the test now catches the throw and fails with a line)
      FAIL report --live: a live report whose questions 2 to 5 are all BLOCKED prints exactly the report without live (text and facts), and so do live: null and live: undefined
      FAIL report --live: live: null and live: undefined do not throw (they are no live)
RED   B13 the winners are not capped (1 FAIL)
      FAIL report --live: the lists are capped: 5 of 12 missing searches then and 10 more (15 need a page); 5 of 7 competitors then and 2 more; 5 of 8 cited domains then and 3 more; 3 winners of 4
RED   B14 an estimate is not marked (1 FAIL)
      FAIL report --live: a share is printed as a rounded percentage (0.666 is 67%, ..., marked an estimate when the skill says so; ...
RED   T1 the test's source comparison is blind (1 FAIL)
      FAIL report --live: a wrong source and a number with no fact are seen by the check (it is not blind): a competitor read from entry 0, a dropped fact and a made-up number all come back as pro...
RED   T2 the test's percentage reader floors (2 FAIL)
      FAIL report --live: the synthetic report.json (Q3 BLOCKED) with good, no date: the source rule holds over the whole report: q5.citedShare ...
      FAIL report --live: the source reader reads live (a nested value, a list length, the percentage rule, the day rule, a difference) and refuses a wrong index or a wrong path
RED   T3 the skill folder is wrong (5 FAIL)
      FAIL report --live: the skill's own fixtures run through report-live.mjs in a temp folder: exit 0 and questions 2, 3, 4 and 5 all answered (the real input of the tests below): exit null: ENO...
      FAIL report --live: the real report.json ... dated: the source rule holds over the whole report: no input
      FAIL report --live: the lists are capped: ...
      FAIL report --live: the real report.json ... dated: no rule id, file name, command line, jargon word, em dash, table ...
      FAIL report CLI --live: <summary.json> --live <report.json> prints the markdown of report() with that live, exit 0, nothing on stderr; --json carries the live facts with fetchedAt and origin
```

Honest notes on the watched-fail run:
- The brief's cases a to e each have a RED line above: a (source rule) B4, B10, T1, T2, mutants 1 and 2; b (BLOCKED and no `--live`
  unchanged) B1, B12, mutant 4; c (null prints no digit) B5, mutant 3; d (no id, file name, jargon, em dash) B6, B7; e (CLI exit 2)
  B8, B9, B11. B3, B13 and B14 (caps, estimate mark) are extra checks beyond the brief.
- B12 first went red by a crash (no try/catch in the check, the run ended with no `FAIL` line). The head asked for a real catch:
  the BLOCKED check now calls `report()` for `live: null` and `live: undefined` inside a try/catch, and a new check "live: null and
  live: undefined do not throw (they are no live)" was added. B12 was re-run with the fixed test: both lines above, restored after.
- Second round, head's review: the BOM strip in `report.mjs` main() is now written `/^﻿/` (the source held a literal U+FEFF).
  Zero literal U+FEFF remain in `report.mjs`, `run.mjs`, `mutate.mjs` and `README.md`. The 4 mutants were not re-run: no line they
  patch changed (the BOM line and the test edit are not mutant targets); the mutant output in section 1 is from before and still stands.
- The first T1 patch matched two places (the 09 check has the same line) and printed MISSING; the patch was made unique and T1 was
  re-run (a first re-run timed out at 400 s while another session held the machine, which proves nothing; it was re-run with a
  longer limit and is the RED above). B12 and T1 ran again for this reason; no other break needed a second run.
- Mutant 4 ("a BLOCKED question rendered as answered") first risked a crash instead of a `FAIL` line (it read `facts` of a BLOCKED
  question that has none); `report.mjs` reads `facts` as `{}` when missing, so the mutant ends as a `FAIL`, which is the only thing
  `mutate.mjs` counts as caught.

## 3. One report with `--live`, in full

`node tools/audit/report.mjs <summary of bad-MET-003, preview> --live <report.json> --checked-at 2026-11-09`:

````markdown
# Search check

**Short answer:** Not yet: 5 problems stop a publish.

Checked 2026-11-09 on the preview site: 85 of 90 checks pass on 4 pages. 1 check did not run.

## 1. Can search engines and AI crawlers reach and read the site?

- Page titles and descriptions: 16 pass, 0 problems, no warnings
- Headings and structure: 3 pass, 1 problem, no warnings
  - A page has no main heading, more than one, or headings that skip a level. Pages: `/tasting-room/`.
- Indexing: 6 pass, 0 problems, no warnings
- Addresses: 4 pass, 0 problems, no warnings
- Links: 4 pass, 0 problems, no warnings
- Accessibility: 4 pass, 0 problems, no warnings
- Speed: not checked this time
- Structured data: 4 pass, 0 problems, no warnings
- AI question coverage: not checked this time, 1 not run
- Design: 44 pass, 0 problems, no warnings
- Preview or live setting: 0 pass, 4 problems, no warnings
  - A preview could be found by search engines, or a live page is hidden from them. Pages: `/`, `/about/`, `/journal/how-to-steep-oolong/` and `/tasting-room/`.

## 2. Is there a page for what people actually search?

- Searches worth a page: 6
- Searches that already have a page: 5
- Searches that need a new page: 1
- Pages that do not match their search: 1
- The first searches with no page yet, most valuable first:
  - `sell my house without a realtor california`

Measured 2026-10-20 from the research and a snapshot of the site.

## 3. Is each page better than what ranks now?

Our home page against the sites that win these searches (home page figures only; the winners' deeper pages are not audited):

- Words of text on the home page: this site 366, `example-competitor-one.test` 900, `example-competitor-two.test` 1000, `example-competitor-three.test` 1100
- Sections on the home page: this site 6, `example-competitor-one.test` 4, `example-competitor-two.test` 5, `example-competitor-three.test` 6
- Kinds of structured data on the home page: this site 2, `example-competitor-one.test` 1, `example-competitor-two.test` 2, `example-competitor-three.test` 1
- Questions and answers marked up for search engines: this site 0, `example-competitor-one.test` 0, `example-competitor-two.test` 1, `example-competitor-three.test` 2
- AI search crawlers blocked from the site (fewer is better): this site 0, `example-competitor-one.test` not measured yet, `example-competitor-two.test` not measured yet, `example-competitor-three.test` not measured yet

Only the first three winning sites are shown.

Measured 2026-10-21 from an audit of the winning sites and a snapshot of this one.

## 4. Does the site have the authority to rank?

- Websites that link to this site: 14
- Websites that link to the competitors:
  - `example-competitor-one.test`: 120
  - `example-competitor-two.test`: 0
- Websites that link to at least two competitors but not to this site: 1

Measured 2026-10-23 from the Common Crawl link graph.

## 5. Is it cited by AI engines? If not, who is, and why?

- Share of AI answers that cite this site: 50% (an estimate)
- AI answers read: 6
- Different questions asked: 2
- AI engines asked: `gemini`
- Cited instead, most often:
  - `example-competitor-one.test`: 2 answers

Measured 2026-10-22 from AI engine answers.

## 6. What to fix, in order

- A preview could be found by search engines, or a live page is hidden from them. On 4 pages: `/`, `/about/`, `/journal/how-to-steep-oolong/` and `/tasting-room/`. Omnikom fixes this; the fix ships with the next publish.
- A page has no main heading, more than one, or headings that skip a level. On 1 page: `/tasting-room/`. Omnikom fixes this; the fix ships with the next publish.
````

The competitor names and numbers in sections 2 to 5 are the hand-written test inputs (`example-*.test`), not a real market. The
second competitor reads 0 because the skill reports a competitor missing from the link graph as 0 (see Findings in the work order).

## 4. Em dash counter and temp files

Counter: `String.fromCharCode(0x2014)` over each touched file (script `emdash.mjs`, which also checks for CR and NUL):

```
0 em dashes, no CR, no NUL  tools/audit/report.mjs
0 em dashes, no CR, no NUL  tools/audit/test/run.mjs
0 em dashes, no CR, no NUL  tools/audit/test/mutate.mjs
0 em dashes, no CR, no NUL  tools/audit/README.md
0 em dashes, no CR, no NUL  tools/audit/proof/report-questions-2-5.md  (checked after this block was written)
0 em dashes, no CR, no NUL  work/25-report-questions-2-5/CONTEXT.md
```

Temp files: the proof run folder, the watched-fail copies (`watchtmp/`) and the test's `pewp-live-*` folders were inside the session
scratchpad or the run's single temp root, which each run removes (the suite's own check "temp folders: the run has one root ..."
passes).
