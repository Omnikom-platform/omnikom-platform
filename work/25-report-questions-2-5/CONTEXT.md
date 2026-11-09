# 25 six-question report, questions 2 to 5 (SEO slice 4b of the report)

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/report-questions-2-5. Status: BUILT 2026-11-09, not committed (proof `tools/audit/proof/report-questions-2-5.md`: "OK: 673 of 673 checks passed", "4 mutants, 4 caught, 0 survived, 0 not run, 0 target text missing").

## Why
Work order 09 built `tools/audit/report.mjs` from the stored audit summary; questions 2 to 5 are "Not measured yet" cards.
The skill already computes those four answers: `skills/programmatic-enterprise-web-performance/scripts/report-live.mjs` writes
`<pewp>/report.json`, whose `questions[]` (n 2 to 5) carry either `status: "BLOCKED"` or facts shaped
`{ value, source, fetchedAt, cacheFile }`. This order makes `report.mjs` read that file as a second, optional input and render
questions 2 to 5 from it. One computation stays in the skill; the audit only renders. A number with no fact behind it is never
printed: where a part has no value, the text says "not measured yet".

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/seo-and-audits.md` (Rules, Proof; not the position log)
- `work/09-six-question-report/CONTEXT.md` (the first part, its source rule 4a and its tests)
- `tools/audit/report.mjs`, `tools/audit/README.md` (section "The six-question report"), `tools/audit/test/run.mjs`,
  `tools/audit/test/mutate.mjs`, `tools/audit/names.json` and the work order 06 jargon list it names
- read only: `skills/programmatic-enterprise-web-performance/scripts/report-live.mjs` lines 130-143 (Q4 facts), 163-376 (Q2,
  Q3, Q5 facts and BLOCKED shapes), 430-487 (how each answered question is said), 510-525 (the report.json object);
  `scripts/test-reports.mjs` lines 40-60 (how its tests make a report.json in a temp root from the skill's fixtures)

## Steps
1. `report(summary, { checkedAt, live } = {})`: `live` is an optional parsed report.json. Without it, output is byte-identical
   to today (the existing tests must pass unchanged). With it, `live` must have `questions` with entries n 2, 3, 4, 5; anything
   else is an `AuditError` exit 2.
2. For each of questions 2 to 5, with `live`:
   - `status: "BLOCKED"`: keep today's plain "Not measured yet" card (the BLOCKED texts in report.json carry command lines and file
     names, which the report never shows).
   - any other status: render the answer in plain words, following what report-live.mjs's q2Lines, q3Lines, Q4 and q5Lines say,
     shortened to the headline facts (Q2: searches worth a page, with a page, needing one, pages that miss their search, the first
     5 missing searches; Q3: the site-level comparison rows against the winners, at most 3 winners; Q4: referring domains, the
     competitors' referring domains, the link gap count; Q5: cited share, answers read, questions asked, engines, the first 5
     domains cited instead). A fact whose value is null or missing reads "not measured yet", never 0. Each answered card ends with
     "Measured <day of fetchedAt> from <plain name of the source>" (no file names, no command lines).
   - No markdown tables (the dashboard card renders lists); `-` bullets only, as in section 6.
3. Facts: every number printed comes from a scalar fact `{ id, value, source }`. For a nested value, flatten to scalars: for
   example id `q4.competitors.0.referringDomains`, source `live.questions[3].facts.competitors.value[0].referringDomains`; a
   percentage is printed as `Math.round(v * 100)` and its fact holds that rounded number with source ending `(x100, rounded)`
   (your exact convention, written in the README). Each fact from `live` also carries `fetchedAt` and `origin` (the skill fact's
   own `source` text). The 09 source rule (step 4a) must hold over the whole report: every digit run outside headings numbers and
   backtick spans equals a fact value or is part of a date fact, and every `source` resolves in its input to exactly `value`.
4. CLI: `node tools/audit/report.mjs <summary.json> [--live <report.json>] [--checked-at YYYY-MM-DD] [--json]`; a missing,
   unreadable or wrong-shaped `--live` file is exit 2 with one line saying why.
5. Tests in `tools/audit/test/run.mjs`, each watched failing first (break the code, see it red for the right reason, restore;
   write what you saw in the proof file). Inputs: a report.json made in the test by running report-live.mjs on the skill's own
   fixture snapshot into a temp root (as test-reports.mjs does; removed after, killed runs included, one root per run), if that
   gives answered questions; otherwise, and in addition, a synthetic report.json in report-live.mjs's exact shape with Q2, Q4 and
   Q5 answered and Q3 BLOCKED. Cases:
   a. the source rule over a report with `live` (every number a fact; every source resolves).
   b. BLOCKED questions in `live` print exactly today's card; no `--live` prints exactly today's report.
   c. a null fact prints "not measured yet" and no digit for it.
   d. no rule id, file name (`\.json`, `\.mjs`), command line, jargon-list word or em dash outside backtick spans.
   e. the CLI exit 2 cases for `--live`.
6. Mutants in `tools/audit/test/mutate.mjs`: a live number printed without a fact; a flattened source path pointing at the wrong
   index; a null fact printed as 0; a BLOCKED question rendered as answered. Each caught by a FAIL line. Run only these with
   `MUTATE_ONLY`; check "0 target text missing" over the whole list only if you touched lines older mutants patch.
7. `tools/audit/README.md`, section "The six-question report": the `live` input, the CLI line, the flattening convention.
8. Proof file `tools/audit/proof/report-questions-2-5.md`: the commands below with their pasted last lines, the watched-red
   lines of step 5, and the full markdown of one report with `--live` (synthetic is fine) pasted so the head can read the words.
   Do NOT commit or push (`docs/departments/README.md` rule 8): report to your head with the proof file path.

## Outputs
- `tools/audit/report.mjs`, `test/run.mjs`, `test/mutate.mjs`, `README.md`, `proof/report-questions-2-5.md`, test fixtures under
  `tools/audit/fixtures/` if you add a synthetic report.json there
- this file (already in place as `work/25-report-questions-2-5/CONTEXT.md`; the status line gets the sha when it lands)
- Nothing else: not the skill (a wrong or missing field in report.json is a finding), the book, `work/STATE.md`, `factory/`, the
  CLI, `names.json`.

## Proof
- `node tools/audit/test/run.mjs` -> `OK: N of N checks passed`, exit 0 (N = 653 plus the new checks).
- `MUTATE_ONLY=<the new mutants' names> node tools/audit/test/mutate.mjs` -> `4 mutants, 4 caught, 0 survived, 0 not run, 0 target
  text missing`, exit 0 (through `tools/heavy.mjs` if the charter says so for mutants; `--wait-min 120`).
- `node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target preview --summary` to a temp file, then
  `node tools/audit/report.mjs <that file> --live <a report.json> --checked-at 2026-11-09` prints the report; temp files removed.
- A node counter (`String.fromCharCode(0x2014)`) shows 0 em dashes in every file you touched.

## Findings (send to your head, who routes them; never fixed here)
- Add anything you find outside this order here and in your report.
- The brief and the head's message name `tools/heavy.mjs`; that file does not exist in the repo. The wrapper used is
  `~/.claude/scripts/heavy.mjs` (`--wait-min 120`). Fix the path in the charter or the brief template.
- The worktree is on a detached HEAD, not the named branch `check/seo/report-questions-2-5`.
- `icm/INDEX.md`, `icm/index.json`, `icm/CODE-MAP.md`, `icm/code-map.json` and `docs/departments/seo-and-audits.md` were already
  modified in this worktree before this work began; they are not part of this order and were not touched by it.
- Skill, Q4: a competitor that is not in the link graph is reported as `referringDomains: 0` with `strengthRank: null`, so the
  report cannot tell "not in the graph" from a true zero. The text prints the 0 (it is the fact) and cannot say more.
- Skill, Q3: the `siteLevel[].measure` labels are free text. `report.mjs` maps five known labels to plain words and silently skips
  any other row (`ROWS3`). A renamed or new row in `report-live.mjs` disappears from the report until `ROWS3` is updated; a test
  against the skill's own fixtures (the "real report.json" check) would catch a renamed label that drops all five rows, not one.
- Skill: no fixture holds `authority.json` or `research/competitors.json`, so Q4 and Q5 competitor parts cannot be answered from
  the skill's own fixtures. The test writes both by hand (names `example-competitor-*.test`). A real fixture in the skill would make the
  "real report.json" check independent of that hand-written input.
- `tools/audit/test/mutate.mjs` gained an env var `OMNIKOM_SKILL_DIR` (default: the repo's skill folder) because the mutant copies
  of `tools/audit` live outside the repo and cannot reach the skill by a relative path. `run.mjs` reads the same variable.
- A check that throws (no try/catch) ends the whole run with no `FAIL` line, so `mutate.mjs` would count such a mutant as "not
  caught". Mutant 4 was shaped so it ends as a `FAIL`; older checks may have the same exposure (not looked at).
