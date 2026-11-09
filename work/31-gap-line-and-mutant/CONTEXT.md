# 31 the link gap line when the site is not in the link data, and the main-check mutant that never applies

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/gap-line-and-mutant (on `check/seo/authority-rest` 40ca9ff,
work order 28, not landed yet). Status: OPEN (head of operations 2026-11-09 22:10; the last SEO order before the pause).

## Why
Work order 28 findings 1 and 4 (`work/28-authority-rest/CONTEXT.md`):
1. `tools/audit/report.mjs:206` prints "Websites that link to at least two competitors but not to this site: N" even when the
   target is not in the Common Crawl link graph (`facts.inGraph.value === false`). Whether those sites link to this one cannot be
   judged then; the skill's `report-live.mjs` already says so since work order 28.
2. The mutant `main-check-exact-path` in `scripts/test-compare.mjs:47` and `scripts/test-authority.mjs:91` patches
   `measure-sources.mjs` text `const a = real(arg);`, which exists nowhere. `compare.mjs` and `authority.mjs` import `isMain` from
   `lib-main.mjs`; `scripts/test-measure.mjs:63` has the working version of the same mutant (file `lib-main.mjs`). So both suites'
   mutant runs end one short with exit 1, and the junction check is not proven by them.

## Inputs (load these, nothing else)
- `CLAUDE.md`, `docs/departments/seo-and-audits.md` (Rules, Proof; the rule on the skill copy and SOURCE.md)
- `work/28-authority-rest/CONTEXT.md` (Findings 1 and 4), `tools/audit/report.mjs` (the Q4 part of `liveLines`, lines 194-207),
  `tools/audit/test/run.mjs` (the work order 27 Q4 checks), `tools/audit/test/mutate.mjs` (the work order 27 mutants)
- the skill SOURCE `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance` (own git repo, at `78d8b3d`):
  `scripts/lib-main.mjs`, `scripts/test-compare.mjs` (mutant list, the junction check near line 257), `scripts/test-authority.mjs`
  (mutant list, its junction check), `scripts/test-measure.mjs:63`, `scripts/report-live.mjs` (how work order 28 words the gap
  line for a target not in the graph: use the same plain meaning)

## Steps
1. `report.mjs`: with `f.inGraph?.value === false`, the gap line says the sites link to at least two competitors and that whether
   they already link to this site cannot be judged (the site is not found in the link data); the count stays a fact. `inGraph` true
   or absent keeps today's line byte for byte. A check in `test/run.mjs` watched red on today's code, and a mutant in
   `test/mutate.mjs` that puts the old line back for `inGraph` false. Run `node tools/audit/test/run.mjs` and the new mutant with
   `MUTATE_ONLY` (`MUTATE_TIMEOUT_S=900` if the machine is loaded).
2. SOURCE: point `main-check-exact-path` in `test-compare.mjs` and `test-authority.mjs` at `lib-main.mjs` with a from/to that
   applies exactly once and breaks the junction case (as `test-measure.mjs:63` does), and its `red` names the check that really
   goes red. Run each suite's mutants for that one id (`--mutants --only main-check-exact-path` where the suite has `--only`) and
   paste the caught line; then each whole test file once. Commit in the SOURCE (no push).
3. Sync: `node skills/sync-skill.mjs programmatic-enterprise-web-performance` from a clean SOURCE tree; the `skills/SOURCE.md` row
   gets the new sha; em dash count of the copy must not rise.
4. Proof file `tools/audit/proof/gap-line-and-mutant.md`: commands with pasted last lines, watched-red lines, the SOURCE sha, the
   Q4 card of one report with the target not in the graph. Do NOT commit or push in this repo; report to your head.

## Outputs
- `tools/audit/report.mjs`, `test/run.mjs`, `test/mutate.mjs`, `proof/gap-line-and-mutant.md`; SOURCE `scripts/test-compare.mjs`,
  `scripts/test-authority.mjs` and the repo copy through sync; `skills/SOURCE.md`; this file as
  `work/31-gap-line-and-mutant/CONTEXT.md`
- Not: anything else in the skill, the skill-stage-guard hook (the head of operations owns it), `work/STATE.md`.

## Proof
- `node tools/audit/test/run.mjs` -> `OK: N of N checks passed`, exit 0; the new mutant caught.
- `test-compare.mjs` and `test-authority.mjs` mutant runs for `main-check-exact-path`: caught, 0 target text missing.
- 0 em dashes in touched files (node counter, `String.fromCharCode(0x2014)`).

## Findings (send to your head, who routes them; never fixed here)
- (head) `scripts/authority.mjs:22` has an empty import `import {  } from "./measure-sources.mjs";`. Look only; not this order.
