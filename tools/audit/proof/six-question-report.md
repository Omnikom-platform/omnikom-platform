# Proof: six-question report (work order 09, SEO slice 4 first part)

Builder: sonnet, effort high, worktree `departments/seo-and-audits/builders/six-question-report`, based on master c17af7b. Not committed, not pushed
(`docs/departments/README.md` rule 8). Run 2026-11-04 to 2026-11-05.

## Gates
```
$ node tools/audit/test/run.mjs
...
ok   temp folders: a mutant run killed by its time limit prints NOT RUN and leaves no folder in the temp base
OK: 653 of 653 checks passed          exit 0
```
599 before plus 54 new checks (see "What the tests cover"). History: the first full run was "OK: 651 of 651"; two extra breaks survived it
(below), a check was added for them (652); then the head's follow-up ("not checked this time", below) added one more and the run above is the last.

```
$ MUTATE_ONLY='^report\.mjs: ' MUTATE_TIMEOUT_S=600 node ~/.claude/scripts/heavy.mjs -- node tools/audit/test/mutate.mjs
caught   report.mjs: section 1 prints a number that is no fact (pages + 1) (1 red: report: good: every number in the text is the value of a fact, every f)
caught   report.mjs: the pass count fact is read from counts.FAIL       (1 red: report: good: every number in the text is the value of a fact, every f)
caught   report.mjs: section 6 ignores severity                         (1 red: report: 30 FAILs over 3 rules: section 6 has 3 bullets in the order P0)
caught   report.mjs: the truncated line is dropped                      (1 red: report: summary.truncated 12 gives the line 12 more problems were foun)

4 mutants, 4 caught, 0 survived, 0 not run, 0 target text missing        exit 0
```
Only the four new mutants were run (I touched no line an older mutant patches, so the whole list is CI's). The two earlier attempts through the machine
lock ended `heavy: gave up after 30 min ... Nothing was run.` (exit 75, other sessions held it), and a third ran while I had my own ad hoc harness
running beside it and printed `4 mutants, 0 caught, 0 survived, 4 not run` (the 180 s limit hit on a loaded machine). The fourth, with nothing else of
mine running and `MUTATE_TIMEOUT_S=600`, is the result above. In between, the same four texts (read from mutate.mjs) were run one at a time through
a scratch harness (copy of tools/audit, one break, test/run.mjs under FAILFAST) and were also caught: "4 mutants, 4 caught, 0 survived, 0 not run, 0 target text missing".

## Follow-up from the head: a topic with no checks reads "not checked this time"
`report.mjs` section 1: a topic whose PASS, FAIL and WARN are all 0 now reads `- Speed: not checked this time`, and with skips `- AI question coverage: not checked this time, 1 not run`
(it used to read "0 pass, 0 problems"). New check in test/run.mjs: "report: bad-MET-003 (production): Speed, which a built folder never judges, reads exactly Speed: not checked this time; AI question coverage with only a SKIP reads not checked this time, 1 not run; a topic with checks still shows its counts; no report says 0 pass, 0 problems"; the topic-line check (4b) now expects the same wording.
Watched red: the wording switched off in a copy (`const bits = none ? [` -> `const bits = false ? [`), full run, all red lines:
```
FAIL report: good: section 1 has one line per topic in the order of TOPICS, ...
FAIL report: good without a date: section 1 has one line per topic ...
FAIL report: bad-MET-003 preview: section 1 has one line per topic ...
FAIL report: bad-MET-003 live: section 1 has one line per topic ...
FAIL report: 30 FAILs over 3 rules: section 1 has one line per topic ...
FAIL report: 13 rules: section 1 has one line per topic ...
FAIL report: a WARN only: section 1 has one line per topic ...
FAIL report: bad-MET-003 (production): Speed, which a built folder never judges, reads exactly Speed: not checked this time; AI question coverage with only a SKIP reads n...
FAILED: 8 of 653
```
(the new check is the last line.) The first full run after the change also went red on a real gap the source rule found: the line printed a bare "0 warnings" when
the summary has no WARN key, a number with no fact ("the digits 0 in the text are no fact", input "13 rules"). Fixed: no WARN now reads "no warnings".
Then restored: `OK: 653 of 653 checks passed`, exit 0 (the gate above), and the 4 new mutants again after the change: `4 mutants, 4 caught, 0 survived, 0 not run, 0 target text missing`, exit 0.

## Watched-red lines (step 4): breaks beyond the four mutants
A scratch harness (not committed: copy `tools/audit` to a temp folder, apply ONE find/replace to `report.mjs`, run `test/run.mjs` with
`OMNIKOM_AUDIT_FAILFAST=1`, print the first FAIL line) ran 17 breaks against the first version of the tests. 15 were caught for the right reason:
```
caught   more than 5 pages on a line (MAX_PAGES 6)  =>  FAIL report: at most 5 pages on a line, then and <k> more (20 pages: 5 and 15 more; ...
caught   11 bullets in section 6 (MAX_BULLETS 11)  =>  FAIL report: more than 10 problems: 10 bullets, then And 3 more problems (the 13 rules), ...
caught   an em dash in the fix sentence  =>  FAIL no file under tools/audit contains an em dash: ...report.mjs
caught   fewer pages sort first  =>  FAIL report: bad-MET-003 (preview, ...): ... ENV-001 comes first (same severity, more pages)
caught   no Nothing to fix line  =>  FAIL report: good: the short answer is yes and section 6 says there is nothing to fix and has no bullet
caught   the skipped checks are counted in the total  =>  FAIL report: a check that did not run is said, not hidden (good: the one PMP-001 SKIP), and is not counted in the total
caught   a rule id in the sentence  =>  FAIL report: bad-MET-003 preview: every number in the text ...: the digits 003 in the text are no fact | the digits 001 ...
caught   no fallback sentence for a rule outside names.json  =>  FAIL report: a rule id outside names.json is counted in an Other checks line ...
caught   the date is not checked  =>  FAIL report: a bad date (not YYYY-MM-DD, or not a real day) throws an AuditError with exit 2; ...
caught   the CLI exits 1 on a usage error  =>  FAIL report CLI: 11 wrong calls exit 2, print nothing on stdout and say why in one line on stderr: no arguments: 1 ...
caught   topics in reverse order  =>  FAIL report: good: section 1 has one line per topic in the order of TOPICS, ...
caught   heading 4 has a typo  =>  FAIL report: good: starts with "# Search check" and the short answer, then the six headings exactly as report-live.mjs words them, in order
caught   the summary is not validated (byTopic)  =>  FAIL report: 16 things that are not a work order 05 summary with byTopic throw an AuditError with exit 2 ...
caught   the severity fact reads the wrong rule  =>  FAIL report: 30 FAILs over 3 rules: every number ... s6.severity.DSN-005: listRules()["MET-003"].severity gives "P0"
caught   more problems line says the wrong number  =>  FAIL report: 13 rules: ... s6.rules.more: distinct(summary.fails[*].rule) - 11 gives 2, the fact says 3
SURVIVED yes for a summary with a FAIL but pass true  =>  (exit 0)
SURVIVED a backtick in a page is not made safe  =>  (exit 0)
```
The two survivors were real gaps in my tests (no input had `pass: true` with a FAIL, none had a backtick or line break in a page name). I added one
check for both ("a summary that says pass but carries a FAIL is not yes ... and a page with a backtick or a line break in its name stays inside one
backtick span on one line"), and the same two breaks re-run against it:
```
caught   yes for a summary with a FAIL but pass true  =>  FAIL report: a summary that says pass but carries a FAIL is not yes ...
caught   a backtick in a page is not made safe  =>  FAIL report: a summary that says pass but carries a FAIL is not yes ...
```

## What the tests cover (test/run.mjs, block "work order 09")
Inputs, all made by `summarize(audit(...))` in the test and never stored: `fixtures/good` (production), `fixtures/bad-MET-003` (preview and production), a
synthetic summary with 30 FAILs over 3 rules (DSN-005 on 20 pages, MET-003 on 6 pages with 7 findings, SE-004 on 3 pages), a WARN and `truncated` 12; a
13-rule summary; a WARN-only summary; "good" also without a date.
- 4a THE SOURCE RULE, per input: every run of digits in `md` (heading numbers, backtick spans and the whole date removed) is the `String(value)` of a fact;
  every fact's `source`, read by the test's own reader (path, quoted key, `[*]`, `[2,5]`, `distinct(...)`, sums and differences, `listRules()["ID"].severity`,
  `checkedAt`), gives exactly the value; every numeric fact is in the text. The reader is itself tested, including that it refuses a wrong path.
- 4b the six headings exactly, in order; section 1 has one line per topic of `TOPICS` in order with PASS, FAIL, WARN from `byTopic`; sections 2 to 5 are
  "Not measured yet" cards with "What unblocks it".
- 4c `bad-MET-003`, `good`, WARN-only, the skipped check; 4d the synthetic order, the 5-page cap, "and k more", the truncated line, the 10-bullet cap;
  4e no rule id, file name, jargon word or em dash outside backtick spans, bad summaries and bad dates (library, exit 2), and 11 wrong CLI calls (exit 2,
  nothing on stdout, one line on stderr).

## The report of bad-MET-003 (the Proof command)
```
$ node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target preview --summary > <temp file>      (exit 1, as the summary has a FAIL)
$ node tools/audit/report.mjs <temp file> --checked-at 2026-11-04                                          (exit 0)
$ rm <temp file>                                                                                           (gone)
```
~~~~markdown
# Search check

**Short answer:** Not yet: 5 problems stop a publish.

Checked 2026-11-04 on the preview site: 85 of 90 checks pass on 4 pages. 1 check did not run.

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

**Not measured yet.** Needs the research stage: real search demand mapped to pages.

What unblocks it: connect the real searches people already find the site with, how often each search happens, Bing keyword volumes, and Google's results and questions for each search, captured at human pace.

## 3. Is each page better than what ranks now?

**Not measured yet.** Needs the research stage: who ranks now for each search, and their pages, to compare against.

What unblocks it: connect the top results for each search, and the authority of the sites that win them.

## 4. Does the site have the authority to rank?

**Not measured yet.** The authority step has not run for this site.

What unblocks it: run the authority step for this site (free; it reads the Common Crawl link graph already on disk).

## 5. Is it cited by AI engines? If not, who is, and why?

**Not measured yet.** Needs the AI citation check: ask AI engines the target questions several times and record who they cite.

What unblocks it: connect Gemini with Google Search grounding (free tier), and ChatGPT and Perplexity answers, owner-supervised.

## 6. What to fix, in order

- A preview could be found by search engines, or a live page is hidden from them. On 4 pages: `/`, `/about/`, `/journal/how-to-steep-oolong/` and `/tasting-room/`. Omnikom fixes this; the fix ships with the next publish.
- A page has no main heading, more than one, or headings that skip a level. On 1 page: `/tasting-room/`. Omnikom fixes this; the fix ships with the next publish.
~~~~

Em dashes: `String.fromCharCode(0x2014)` counted in `tools/audit/report.mjs`, `test/run.mjs`, `test/mutate.mjs`, `README.md`,
`work/09-six-question-report/CONTEXT.md` and this report text: 0 in each.
The six heading texts each appear in `skills/programmatic-enterprise-web-performance/scripts/report-live.mjs` (grep count 3 each).

## Findings (for the head to route; none fixed here)
1. **Brief step 4c does not hold under `--target preview`.** `bad-MET-003` with `--target preview` also fails ENV-001 on all 4 pages (the fixture has no
   noindex header), so its summary has 5 FAILs and section 6's first bullet is ENV-001's (same severity P0, more pages), MET-003's second. The test asserts
   that for preview and asserts "first bullet is MET-003's sentence" for `--target production` (1 FAIL). Likewise `fixtures/good` is only "yes" under
   production; with preview it fails ENV-001 (use `good-preview` for a preview).
2. **Short answer wording.** The brief's "Not yet: n problems on p pages" has no honest p (the summary stores total pages, not pages with a problem, and
   `fails` can be truncated), so it reads "Not yet: 5 problems stop a publish." The page count is in the next line. WARN-only: "Yes, nothing stops a publish; 1 warning is worth a look."
3. **"m" in "n of m checks pass".** The brief does not define m. m = every counted check except SKIP (PASS + FAIL + WARN + unusual statuses); skipped
   checks are said apart ("1 check did not run."). `good` has the one PMP-001 SKIP, so it reads "Checked the live site: 90 of 90 checks pass on 4 pages. 1 check did not run.", not "90 of 91".
4. **Fact sources are expressions, not only paths.** Counts that are not one stored value (total, distinct pages, "and k more") use a sum, a difference or
   `distinct(...)` of summary paths; the grammar is in the report.mjs header and README, read back by the test.
5. **Topics with no check in the run** (Speed and AI question coverage for a built folder) now read "not checked this time" (head's ruling), see the follow-up section.
6. **WARN detail is not in the summary** (`fails` holds FAILs only), so section 6 lists no WARN rule and section 1 shows WARN counts per topic only. If warnings should be listed, `summarize` needs to keep them (work order 05 area).
7. **`docs/departments/seo-and-audits.md` is modified in this worktree** (6 added position-log lines, 22:10 to 22:19, not mine; I did not touch it and left it as found). `icm/` was regenerated by the write hook; restored with `git checkout -- icm/`.
8. **Machine lock:** `heavy.mjs` gave up twice after 30 minutes with other sessions holding the lock (exit 75). Not a code problem; it cost about 2 hours of wall time.
9. A summary stored before work order 06 has no `byTopic`; `report()` refuses it (exit 2, "stored before work order 06"). Any stored summaries from work order 05 would need a re-audit.
10. The long text of the first "Not measured yet" cards drops report-live's file names, command lines and the numbers "top 10" and "15 to 30 minutes" (the source rule would need a fact for each, and the brief forbids file names). The cards will be replaced by the real answers in the next part.
