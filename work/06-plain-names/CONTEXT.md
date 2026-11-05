# 06 plain names

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/plain-names. Status: DONE c17af7b (CI run 41896948937, 9 of 9).

## Why
`docs/product/6-dashboard.md` "Search health", card 1: one line per family of checks in plain words with its count, and under a
family with a problem one plain line per problem; "The plain family and problem words come from `tools/audit/` (one place, next
slice), never written in the screen." The six-question report (slice 4) reads the same words. Today a rule has only its id and
its checklist text.

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/seo-and-audits.md` (Rules, Proof; not the position log)
- `docs/product/6-dashboard.md` section "Search health" (read only)
- `tools/audit/README.md`, `tools/audit/index.mjs`, `tools/audit/run.mjs` (`--list`), `tools/audit/summary.mjs`,
  `tools/audit/rules/*.md` (the "Rule text" and "Judged here" of each rule, to write its sentence), `tools/audit/checks/*.mjs`
  where a rule file is unclear, `tools/audit/test/run.mjs`, `tools/audit/test/mutate.mjs`

## Steps
1. `tools/audit/names.json`, one object, no other source of these words:
   `{ "v": 1, "topics": [ { "id", "name" } ... ], "rules": { "<rule id>": { "topic": "<topic id>", "problem": "<sentence>" } } }`.
   `topics` in this order, with these names (the spec's words, capital first letter):
   `titles` "Page titles and descriptions"; `headings` "Headings and structure"; `indexing` "Indexing"; `addresses` "Addresses";
   `links` "Links"; `accessibility` "Accessibility"; `speed` "Speed"; `structured-data` "Structured data"; `ai-questions`
   "AI question coverage"; `design` "Design"; `setting` "Preview or live setting".
   Rule to topic: MET-001, MET-002, MET-004, SE-202 -> titles; MET-003 -> headings; IDX-001, IDX-002, IDX-003, IDX-004, SE-001,
   SE-004 -> indexing; URL-009 -> addresses; LNK-002 -> links; A11-007 -> accessibility; PRF-001, PRF-016 -> speed; SCH-001 ->
   structured-data; PMP-001 -> ai-questions; DSN-001 to DSN-011 -> design; ENV-001 -> setting.
   `problem`: one sentence a business owner understands, saying what is wrong when the rule FAILS (or WARNs), true to what the
   check actually judges (its rule file's "Judged here"), at most 120 characters, ends with a period. No rule ids, no file names,
   no jargon (not "canonical", "h1", "ld+json", "LCP", "lastmod", "x-robots-tag"; say what it means), no numbers the check does not
   use, no em dash. Example for MET-003: "A page has no main heading, more than one, or headings that skip a level."
2. `tools/audit/names.mjs`: reads `names.json` once (Node built-ins only) and exports `topicOf(ruleId)` (topic id, or `"other"`
   for an id not in the table), `problemOf(ruleId)` (the sentence, or `null`), `TOPICS` (the ordered list). The dashboard and the
   report read `names.json` itself; `names.mjs` is the Node call.
3. `tools/audit/summary.mjs`: add `byTopic: { <topic id>: { PASS, FAIL, SKIP, ... } }` next to `byFamily`, counted from the same
   lines, every topic of `TOPICS` present (zeros when none), an id outside the table under `other`. Keep `v: 1` (the field is
   added, nothing renamed; no consumer exists yet). The 60 KiB limit test must still pass.
4. Tests in `tools/audit/test/run.mjs`, each watched failing first (break the code or the table, see it red for the right reason,
   restore; write what you saw in the proof file):
   a. every rule id that `run.mjs --list` prints (or the engine's rule registry it reads) has an entry with a known topic and a
      sentence that meets step 1's limits (length, final period, no em dash, none of the listed jargon words);
   b. the table names no rule the engine does not have; every topic is used by at least one rule; topics are in step 1's order;
   c. `summarize()` on the good fixture (`--target preview`): the sum over `byTopic` equals `counts` for each status; on
      `bad-MET-003`: `byTopic.headings.FAIL` is 1 or more and `byTopic.titles.FAIL` is 0;
   d. `topicOf("XYZ-999")` is `"other"`, `problemOf("XYZ-999")` is `null`.
5. Mutants in `tools/audit/test/mutate.mjs` (same shape as the others): drop one rule entry from the table (pick MET-003); point
   one rule at a wrong topic (MET-003 -> titles); `byTopic` skips a status; `topicOf` returns the family prefix instead of the
   topic. Each must be caught by a FAIL line. Run only these new mutants locally with `MUTATE_ONLY` (the whole list runs on CI);
   then run the whole list's target-text check only if your edits touch lines older mutants patch (`summary.mjs`: they do; say
   in the proof file how you checked "0 target text missing").
6. `tools/audit/README.md`: a section "Plain names (for the dashboard and the report)": the file, its shape, the topic list, the
   rule that a new rule ships with its entry (test 4a fails otherwise), and the `byTopic` field of the summary.
7. Proof file `tools/audit/proof/plain-names.md`: every command below with its pasted last lines, the watched-red lines of step 4.
   Do NOT commit or push (builders never do, `docs/departments/README.md` rule 8): report to your head with the proof file path.

## Outputs
- `tools/audit/names.json`, `names.mjs`, `summary.mjs`, `test/run.mjs`, `test/mutate.mjs`, `README.md`, `proof/plain-names.md`
- this file as `work/06-plain-names/CONTEXT.md` (copy it in; the status line gets the sha when it lands)
- The head adds the charter's position log block and regenerates `icm/` in the same commit; you do not touch the charter, the
  book (`docs/product/`), `work/STATE.md`, `factory/`, the CLI or the skill.

## Proof
- `node tools/audit/test/run.mjs` -> `OK: N of N checks passed`, exit 0 (N = 589 plus the new checks).
- `MUTATE_ONLY=<the new mutants' names> node tools/audit/test/mutate.mjs` -> `4 mutants, 4 caught, 0 survived, 0 not run, 0 target
  text missing`, exit 0.
- `node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target preview --summary` prints one JSON object with `pass false`
  and `byTopic.headings.FAIL` of 1 or more.
- `node tools/audit/test/run.mjs` and `node factory/test/run.mjs` (it runs the audit on built sites) both green; a node counter
  (`String.fromCharCode(0x2014)`) shows 0 em dashes in every file you touched.

## Findings (send to your head, who routes them; never fixed here)
- For the book's owner: `docs/product/6-dashboard.md:113` "(one place, next slice)" can name `tools/audit/names.json` and the
  summary's `byTopic` once this lands.
- Add anything else you find outside this order here and in your report.
