# 28 authority, the rest: "not in the link data" everywhere in the skill, and test-reports.mjs runs one group

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/authority-rest. Status: BUILT 2026-11-09 21:10, awaiting the head's review and land
(approved by the head of operations 2026-11-09 19:50, items 1 to 4 of work order 27's findings). SOURCE `78d8b3d` (not pushed, no
remote); nothing committed in this repo; proof `tools/audit/proof/authority-rest.md`. `--keep` was removed, not implemented.

## Why
Work order 27 (`5cef4f1`, SOURCE `c41d767`) made `report-live.mjs` say "not found in the link data" for a site the Common Crawl
link graph does not hold. Three other places in the skill still treat that site as 0 or drop it, and the skill's report test
cannot run one group (work order 27 findings 1 to 4, `work/27-authority-not-in-graph/CONTEXT.md`).

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/seo-and-audits.md` (Rules, Proof; the rule on the skill copy and SOURCE.md)
- `work/27-authority-not-in-graph/CONTEXT.md` (what 27 did, its Findings) and `tools/audit/proof/authority-not-in-graph.md`
- the skill SOURCE `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance` (own git repo, at `c41d767`):
  `scripts/authority.mjs` (result shape: a not-in-graph row has `domain`, `inGraph: false`, `note`, no `role`; how `linkGap` is
  built, line 185), `scripts/compare.mjs` 140-152 (`authorityOf`), `scripts/measure.mjs` 378-390 (the authority part) and every
  reader of its `competitors` and `referringDomains`, `scripts/report-live.mjs` (Q4 at 133-147, the `links` plan row at 395, the
  Q4 card at 578-586), `scripts/authority-lib.mjs:457`, `scripts/test-reports.mjs` (how cases and mutants are written; its
  usage lines 1 and 339)

## Steps (all in the SOURCE, then one sync)
1. `compare.mjs` `authorityOf`: a site with `inGraph: false` gets `referring` value null (never 0) and its compare text says "not
   found in the link data"; no comparison or difference is computed with the null.
2. `measure.mjs`: competitors are every result but the target (not `role === "competitor"`), each with `inGraph`; a target not in
   the graph still lists its competitors. Check each reader of measure's authority output (track, gate, report) for a 0, a dropped
   row or a sum over null, and fix it the same way.
3. Target not in the graph: the Q4 link gap line and the `links` plan row must not claim "but not to you". Say the sites link to
   two or more competitors and that whether they already link to this site cannot be judged (the site is not found in the link
   data), and the row's `provedBy` names the site appearing in the next authority run, not "referring domains rise".
4. `test-reports.mjs`: a `--group <letter>[,<letter>]` option that runs only those scenario groups (and only mutants whose `sc`
   is within them); `--keep` either implemented (keep the temp root and print its path) or removed from both usage lines. Pick one,
   say which.
5. Each change: a test case watched red on `c41d767` for the right reason, and a mutant that puts the old behaviour back. Run
   `node scripts/test-reports.mjs` (and any other test file you touch) with its mutants; commit in the SOURCE repo (no push).
6. Sync: `node skills/sync-skill.mjs programmatic-enterprise-web-performance` from a clean SOURCE tree; the `skills/SOURCE.md` row
   gets the new sha; the copy's em dash count must not rise.
7. `tools/audit/report.mjs` needs no change unless a field it reads changed shape; if one did, say so and run
   `node tools/audit/test/run.mjs`.
8. Proof file `tools/audit/proof/authority-rest.md`: commands with pasted last lines, watched-red lines, the SOURCE sha, the Q4 card
   and the plan row of one report with the target not in the graph. Do NOT commit or push in this repo; report to your head.

## Outputs
- SOURCE: `scripts/compare.mjs`, `scripts/measure.mjs`, `scripts/report-live.mjs`, `scripts/test-reports.mjs`, any reader fixed in
  step 2 and its tests; the repo copy through sync; `skills/SOURCE.md`
- `tools/audit/proof/authority-rest.md`, this file as `work/28-authority-rest/CONTEXT.md`
- Not: the skill-stage-guard hook (the head of operations owns it; do not work around it), `work/STATE.md`, the book.

## Proof
- SOURCE: `node scripts/test-reports.mjs` and its mutants, last lines pasted; the new `--group` run pasted once.
- 0 em dashes in touched files (node counter, `String.fromCharCode(0x2014)`).

## Findings (send to your head, who routes them; never fixed here)
1. `tools/audit/report.mjs:206` prints "Websites that link to at least two competitors but not to this site: N" even when `facts.inGraph`
   is false: the same claim the skill report no longer makes. Not touched (step 7: no field changed shape).
2. `scripts/authority-lib.mjs:388` builds `comps` from `role === "competitor"`, so a competitor the graph does not hold (no role) never
   reaches the note at line 456 ("X is not in the Common Crawl release ... its links are not counted"). It reads authority.json, not
   measure's output; not touched.
3. `measure.mjs` diff (about line 579): when either run has the target not in the graph the authority diff says "authority missing in one
   of the two runs", which is not what happened (the data say "not found"). Nothing is computed with a null; wording only. And
   `migrate.mjs:347` (baseline) copies `referringDomains` from measure's authority part: for a target not in the graph the field is absent,
   with no `inGraph` flag. No reader of the baseline's authority exists today. Neither touched.
4. `test-compare.mjs --mutants`: the mutant `main-check-exact-path` has never applied at `c41d767` (its target `const a = real(arg);` is in
   neither `measure-sources.mjs` nor `lib-main.mjs`), so that suite's mutant run ends 24/25 with exit 1. Not mine, not fixed.
5. `test-measure.mjs --mutants` has no `--only` (test-compare has): the 45 mutants take about 25 minutes. A mutant that quotes its own
   target text (test-reports.mjs G mutants did) fails "patch applied exactly once" until the quote is split in two string pieces.
6. skill-stage-guard blocked one command: `cmp` of the repo copy against the SOURCE copy of `measure.mjs` (it names measure.mjs, so the hook
   wants stages/measure.md read). I did not read the stage file or rephrase around it; the repo copy of measure.mjs was therefore not
   compared byte for byte (sync copied it, and the diff stat of the copy matches the SOURCE commit). Every `node test-measure.mjs` run
   passed the hook. A different hook (P-008) also refused one heredoc containing backslashes; I used files.
7. Process slips, for honesty: one trivial `node -e` edit of test-reports.mjs early on (CLAUDE.md rule 7: scripts go in files); later
   edits used files or the Edit tool. Weekly usage went from 79% to 86% during this order.
8. Glossary entry "link gap" in `report-live.mjs` still defines the term as "... but not to you": correct as a definition, and it is not
   printed when the target is not in the graph (the term is not used then). If the head wants the definition itself reworded, that is a
   follow-on.
9. `test-reports.mjs` group G starts the file again as a child; the child is told `PEWP_REPORTS_NESTED=1` so it does not start G a third time
   (a mutant that ignores `--group` would otherwise recurse).
