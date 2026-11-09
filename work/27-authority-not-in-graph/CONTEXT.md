# 27 authority: "not in the link data" is not zero (skill report-live.mjs Q4, then report.mjs)

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/authority-not-in-graph. Status: BUILT, NOT COMMITTED in this repo (2026-11-09; proof `tools/audit/proof/authority-not-in-graph.md`; SOURCE commit `c41d767`, not pushed).

## Why
Finding of work order 25: the skill's `scripts/report-live.mjs:139-140` writes `referringDomains: me.inGraph ? me.linkingDomains : 0`
and the same for each competitor, so a site the Common Crawl link graph does not hold reads "0 websites link to it" in the report.
That is a number with no measurement behind it (CLAUDE.md non-negotiable 3). The report must say "not found in the link data".

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/seo-and-audits.md` (Rules, Proof; the rule on the skill copy and SOURCE.md)
- `work/25-report-questions-2-5/CONTEXT.md` (its Findings) and `tools/audit/report.mjs` (the Q4 part of `liveLines`)
- the skill SOURCE `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance` (its own git repo): `scripts/report-live.mjs`
  lines 130-143 (Q4), `metricsOf` (the `refdom` metric), the Q4 text that renders those facts, `scripts/test-reports.mjs` (how its
  cases and mutants are written), `scripts/authority.mjs` output shape (`results[].inGraph`, `linkingDomains`, `harmonicPos`)

## Steps
1. In the SOURCE: Q4 writes `referringDomains: null` and `inGraph: false` (target and each competitor) when the site is not in
   the graph, and `inGraph: true` with the count otherwise; `strengthRank` stays null when absent. Every place that reads those
   values (the Q4 text in report.md, `metricsOf`'s "referring domains" change line, the short answer) says "not found in the link
   data" for `inGraph: false` and never computes with the null. A test case in `test-reports.mjs` with a competitor and a target
   not in the graph, watched red on the old code for the right reason, and a mutant that puts the 0 back. Run only that test file
   and its mutants; commit in the SOURCE repo (no push; it has no remote here).
2. Sync: `node skills/sync-skill.mjs programmatic-enterprise-web-performance` from a clean SOURCE working tree; one new
   `skills/SOURCE.md` row with the SOURCE sha; the copy's em dash count must not rise.
3. `tools/audit/report.mjs` Q4: a target or competitor with `inGraph === false` prints "not found in the link data" (no digit,
   no fact); `inGraph` true or absent keeps today's behaviour. Test in `tools/audit/test/run.mjs` watched red, mutant in
   `test/mutate.mjs` ("inGraph false printed as 0"), run with `MUTATE_ONLY`.
4. Proof file `tools/audit/proof/authority-not-in-graph.md`: commands and pasted last lines, watched-red lines, the SOURCE sha,
   the Q4 card of one report pasted. Do NOT commit or push in this repo; report to your head with the proof path.

## Outputs
- SOURCE: `scripts/report-live.mjs`, `scripts/test-reports.mjs` (and its mutant list); the repo copy through sync; `skills/SOURCE.md`
  (one row; a light follow-on in the head of operations' file, named in the report)
- `tools/audit/report.mjs`, `test/run.mjs`, `test/mutate.mjs`, `proof/authority-not-in-graph.md`, this file as
  `work/27-authority-not-in-graph/CONTEXT.md`

## Proof
- SOURCE: `node scripts/test-reports.mjs` and its mutants, last lines pasted.
- `node tools/audit/test/run.mjs` -> `OK: N of N checks passed`, exit 0; `MUTATE_ONLY=<new> node tools/audit/test/mutate.mjs` -> all caught.
- 0 em dashes in touched files (node counter, `String.fromCharCode(0x2014)`).

## Findings (send to your head, who routes them; never fixed here)
1. `scripts/compare.mjs:148` has the same defect as Q4 had: `fact(r.inGraph ? r.linkingDomains : 0, ...)` writes 0 referring domains for a
   site the graph does not hold (its source text does say "the domain is not in the graph", the value does not). Not touched (not in this order).
2. `scripts/authority.mjs` gives a not-in-graph result no `role` (only `domain`, `inGraph:false`, `note`). Any reader that filters
   `role === "competitor"` silently drops those competitors: `report-live.mjs` did (fixed here: competitors are every result but the
   target); `scripts/measure.mjs:387` still filters on `role` and still drops them. Not touched.
3. With the target not in the graph, the link gap and the plan row "Ask the sites that link to two or more competitors but not to you ...
   provedBy: referring domains rise in the next authority run" (`report-live.mjs`, the `links` plan item) still read as if the target's
   links were known; `authority-lib.mjs:457` already notes "already links to you cannot be judged". Left as is.
4. `skills/sync-skill.mjs` rewrites the skill's one row in `skills/SOURCE.md` (now `c41d767`, 2026-11-09); it adds no second row. The
   head of operations' position file should name `c41d767` as the SOURCE sha this repo copy matches.
5. `scripts/test-reports.mjs` has no way to run one group (`runScenarios` takes groups, the command line does not) and its usage line
   names `--keep`, which the code does not read. A watched-red run of group Q therefore runs the whole file.
6. A hook (skill-stage-guard) blocked a Bash command only because it named `report-live.mjs` in a `cmp`, though nothing was run.
