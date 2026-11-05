# 09 six-question report (SEO slice 4, first part)

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/six-question-report. Status: OPEN.

## Why
`docs/product/6-dashboard.md` "Search health", card 5: "the six-question report in plain words (SEO slice 4), one per month".
Charter slice 4: the report is generated from the audit result, in the skill's `report-live.mjs` wording, and "a report never
states a number without its source line in the JSON". This part builds the report from the stored audit summary (work order 05)
and the plain names (`tools/audit/names.json`); questions 2 to 5 need the skill's research and measure files and are shown as
"not measured yet" cards here (reading those files is the next part).

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/seo-and-audits.md` (Rules, Proof; not the position log)
- `docs/product/6-dashboard.md` section "Search health" (read only)
- `tools/audit/README.md` (sections "The summary" and "Plain names"), `tools/audit/summary.mjs`, `tools/audit/names.json`,
  `tools/audit/names.mjs`, `tools/audit/index.mjs` (`listRules()`: id and severity), `tools/audit/test/run.mjs`,
  `tools/audit/test/mutate.mjs`
- read only, for the wording: `skills/programmatic-enterprise-web-performance/scripts/report-live.mjs` lines 1-16 and 540-600
  (the six question headings, the short answer first, the BLOCKED card with "What unblocks it") and its `blocked(...)` texts for
  Q2, Q3, Q5 (lines 263-265, 324-326, 376-378) and Q4 (line 142)

## Steps
1. `tools/audit/report.mjs` exports `report(summary, { checkedAt } = {})` returning `{ md, facts }`; Node built-ins only, nothing
   written. `summary` is a work order 05 summary (`v: 1`, with `byTopic`); anything else is an `AuditError` exit 2.
   `facts` is an array of `{ id, value, source }`: `source` is the JSON path in the summary the value was read from (for example
   `summary.byTopic.headings.FAIL`, `summary.fails[3].page`), or `listRules()` for a severity, or `checkedAt` for the date.
2. The markdown, in this order:
   - `# Search check` and `**Short answer:** <one line>`: "Yes" when `summary.pass` and no FAIL, otherwise "Not yet: <n> problems
     on <p> pages stop a publish" (or the WARN-only wording you choose), counts from the summary.
   - "Checked <checkedAt> on the <preview | live> site: <n> of <m> checks pass on <p> pages." (no date part when `checkedAt` is
     not given; `target` production is said "live").
   - `## 1. Can search engines and AI crawlers reach and read the site?` (the heading text exactly as in report-live.mjs): one
     line per topic of `TOPICS`, in order, with its plain name and its PASS / FAIL / WARN counts; under a topic with a problem, one
     line per rule: the rule's `problemOf` sentence and its pages (at most 5, each in backticks, then "and <k> more").
   - `## 2.` to `## 5.` with report-live.mjs's headings, each a card "**Not measured yet.** <why>" and "What unblocks it: <what>"
     in report-live.mjs's words for that question (Q4's from line 142, without its command line).
   - `## 6. What to fix, in order`: the FAIL rules first, ordered by severity from `listRules()` (P0, P1, P2, then W), then by
     the number of pages, then by rule id; each a `-` bullet (never a numbered list): the plain sentence, "on <n> pages", the
     pages as in section 1, and "Omnikom fixes this; the fix ships with the next publish." At most 10 bullets, then "and <k> more
     problems". When `summary.truncated` is above 0: "<k> more problems were found but not stored with this check."
   - No rule ids, file names, or the jargon list of work order 06 in the text; no em dash.
3. `node tools/audit/report.mjs <summary.json> [--checked-at YYYY-MM-DD] [--json]` prints the markdown (or `{ md, facts }` as one
   JSON object with `--json`); exit 0; a missing or wrong file, a bad date or a non-summary input is exit 2 with one line saying why.
4. Tests in `tools/audit/test/run.mjs`, each watched failing first (break the code, see it red for the right reason, restore;
   write what you saw in the proof file). Inputs: the summaries of `fixtures/good` and `fixtures/bad-MET-003` (`--target preview`,
   made by `summarize(audit(...))` in the test, never stored), and a synthetic summary with 30 FAILs over 3 rules, a WARN and
   `truncated` 12.
   a. THE SOURCE RULE: after removing the `## 1.` to `## 6.` heading numbers and every backtick span, every run of digits in `md`
      equals `String(value)` of a fact, or is part of the `checkedAt` fact; and every fact's `source` path, resolved in the input
      summary (or `listRules()`, or the given date), gives exactly its `value`.
   b. the six headings are present, in order, with report-live.mjs's text; the topics of section 1 follow `TOPICS`.
   c. `bad-MET-003`: the short answer says not yet; section 6's first bullet is MET-003's sentence; `good`: the short answer is yes
      and section 6 says there is nothing to fix (your wording).
   d. synthetic: section 6 order is P0 before P1, then more pages first; at most 5 pages per line with "and <k> more"; the
      truncated line says 12.
   e. no rule id pattern (`[A-Z]{2,3}-\d{3}`) and no em dash outside backtick spans; the CLI's exit 2 cases.
5. Mutants in `tools/audit/test/mutate.mjs`: a number printed without a fact (section 1 prints `pages + 1`); a fact whose source
   path is wrong (`counts.PASS` read from `counts.FAIL`); section 6 ignores severity; the truncated line dropped. Each must be
   caught by a FAIL line. Run only these new mutants locally with `MUTATE_ONLY`; check "0 target text missing" for the whole list
   only if you touched lines older mutants patch.
6. `tools/audit/README.md`: a section "The six-question report": the call, the CLI line, the source rule (step 4a), and that
   questions 2 to 5 wait on the skill's research and measure files.
7. Proof file `tools/audit/proof/six-question-report.md`: the commands below with their pasted last lines, the watched-red lines
   of step 4, and the full markdown of the `bad-MET-003` report pasted so the head can read the words.
   Do NOT commit or push (`docs/departments/README.md` rule 8): report to your head with the proof file path.

## Outputs
- `tools/audit/report.mjs`, `test/run.mjs`, `test/mutate.mjs`, `README.md`, `proof/six-question-report.md`
- this file as `work/09-six-question-report/CONTEXT.md` (copy it in; the status line gets the sha when it lands)
- Nothing else: not the skill, the book, `work/STATE.md`, `factory/`, the CLI, `names.json` (a wording problem there is a finding).

## Proof
- `node tools/audit/test/run.mjs` -> `OK: N of N checks passed`, exit 0 (N = 599 plus the new checks).
- `MUTATE_ONLY=<the new mutants' names> node tools/audit/test/mutate.mjs` -> `4 mutants, 4 caught, 0 survived, 0 not run, 0 target
  text missing`, exit 0.
- `node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target preview --summary` saved to a temp file, then
  `node tools/audit/report.mjs <that file> --checked-at 2026-11-04` prints the report; the temp file is removed.
- A node counter (`String.fromCharCode(0x2014)`) shows 0 em dashes in every file you touched.

## Findings (send to your head, who routes them; never fixed here)
- Add anything you find outside this order here and in your report.
