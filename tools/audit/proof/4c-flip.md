# Slice 4c flip proof: a folder run must name its target (2026-11-02, builder)

Brief: `tools/audit/briefs/slice-4c-flip.md`, message from HEAD_SEO-and-audits_2026-11-02. Built in E:\omk-wt-seo-5c on check/seo/4c-flip at master 7690b59. Both preconditions are on master (platform 5-E e92684e, CLI small-fixes 41f6866). Two commits (the flip; the skill stage), nothing pushed.

## What changed
- `tools/audit/index.mjs:16`: `REQUIRE_TARGET_FOR_FOLDER = true`. A built folder with no target throws an AuditError (exit 2, "a built folder needs --target preview|production ..."); a snapshot (live) with no target still runs.
- `tools/audit/test/run.mjs`: helpers `cliRaw` (the old call), `cli` and `engine.audit` now add `--target production` / `{ target: "production" }` to a folder run that names none, so tests about another rule keep judging what they judged. The tests about the target itself call `cliRaw` / `engineRaw.audit`. `noTargetSkipOnly` became `snapshotNoTargetSkipOnly` (snapshot only) with a new `envLineOk` (a folder run shows no ENV-001 SKIP and its PASS lines); `skipsOnly` counts 1 finding for a folder, 2 for a snapshot. Changed checks: good site (with `--target production`: all PASS but one SKIP PMP-001, four PASS ENV-001); new "good site with no --target: exit 2, nothing on stdout, stderr names --target"; good-preview and bad-ENV-001-preview with no target now exit 2 (also with `--json`); "audit(): the result says which target was judged" (null only for a snapshot; a folder with none throws exit 2); good-coverage (no SKIP line at all); section 7: the switch is on one line and `true`, folder with no target exits 2 and prints nothing, folder with a target runs, snapshot with no target runs, on a copy and on the engine under test. No check was loosened: 574 became 576.
- `tools/audit/test/mutate.mjs`: one new mutant, "index.mjs: the switch is back to false (slice 4c flip; a folder with no target runs again)".
- `tools/audit/README.md`: the library call passes `target`, a folder needs it (exit 2), `r.target` null only for a snapshot, the runner option, the "build target" paragraph (the switch is now on), the gate examples (`good` with no target exits 2; the other folder examples carry `--target production`).

## CLI lines touched (for CLI-d's consent), all in `tools/omnikom-cli/test/run.mjs`, test file only, no CLI source touched
Line numbers are those of the file after the change; "before" is the master text.
- :346 (new line) `const TP = ['--target', 'production'];` and :347 `engineGood = engine.audit(GOOD, { target: 'production' }), engineBad = engine.audit(BAD, { target: 'production' })`; before `engine.audit(GOOD), ... engine.audit(BAD)`.
- :350 `audit --dir GOOD` becomes `audit --dir GOOD ...TP`. :351 (the check): before it allowed `SKIP ENV-001 / no --target` (once) next to `SKIP PMP-001`; after, only the PMP-001 SKIP. This is the "good-site check passes --target and drops the ENV-001 SKIP allowance".
- :354 `audit --dir BAD`, :358 `audit --dir BAD --only MET-003`, :361 `audit --dir BAD --only ' MET-003 , ,met-003'`, :363 `audit --dir <relative GOOD>`, :365 `gate --dir BAD`, :368 `gate --dir GOOD`: each gets `...TP`. :357 (the count line): `2 SKIP` becomes `1 SKIP` (the ENV-001 SKIP is gone, the PMP-001 SKIP stays).
- :415, :417, :419, :421 `audit/gate --dir GOOD|BAD --json` each gets `...TP`.
- :454 to :457 (the no-target check): before `audit --dir GOOD --json` expected `data.target === null` and one `SKIP ENV-001 / no --target` line. After: `audit --dir GOOD --json` with no target expects exit 2, code USAGE, the message naming `--target`; and a new check on the next lines: `gate --dir GOOD` with no target exits 2 naming `--target`.
- :460 to :464 (the options handed to the library, `{ rules, target } / { target } / {}`): unchanged, still holds (the spy library takes the call).
- The hygiene block (:477 to :484): `engine.audit(leakDir)` gets `{ target: 'production' }`; the four argv lists and the masked-value call get `...TP`.
- Text only, with CLI-d's consent (head, 2026-11-02): `tools/omnikom-cli/commands/audit.mjs:5-6` (the comment) and `tools/omnikom-cli/README.md:26` now say: a built folder (`--dir`) needs `--target preview|production` and exits 2 without it; a snapshot still runs without one (SKIP ENV-001). Before: "with none the engine passes nothing on to ENV-001 (it prints its one SKIP line)" and "With no `--target` the engine prints its one `SKIP ENV-001 / no --target` line." No code line of `commands/audit.mjs` changed (the CLI already maps the engine's AuditError to USAGE, exit 2). CLI `test/mutate.mjs`: no change needed.
- Other wording in `tools/omnikom-cli` (listed for the head, not changed): `omnikom.mjs:42` usage text (`audit --dir <built site folder> ... [--target preview|production]`) shows the option as optional; `briefs/audit-gate-commands.md:21` ("`--target` on either command is a Usage error", an old brief); `briefs/small-cli-fixes.md:56` ("asserting no `SKIP ENV-001` line", a brief); `README.md:27` (gate: "Same exits and the same `--target` as `audit`", still true). The `takes no --target` lines in `ci.mjs:396`, `hooks.mjs:123`, `impact.mjs:142`, `land.mjs:141`, `tools.mjs:12` are other commands.

## Other callers searched (factory/, factory/runner/, CLI audit and gate, tools/audit/test, live.mjs, README, skill scripts, workflows)
- `factory/test/run.mjs` (:233, :237, :318, :320, :324) and `factory/runner/publish.mjs:146`: already pass a target. No change.
- `factory/runner/test/run.mjs`: no folder audit with no target. No change.
- `tools/audit/live.mjs`: a snapshot, keeps working with no target (test unchanged and green). No change.
- `.github/workflows/ci.yml:127,129`: runs the audit tests only. No change.
- `skills/programmatic-enterprise-web-performance/stages/design.md:159` told the design stage to run `node tools/audit/run.mjs <built folder> --only DSN-001,...,DSN-011` with no target (exit 2 after the flip). Fixed in the SOURCE first (`C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance`, clean at 77aee20, one path committed: 9d678f0 "design stage: the DSN audit names --target preview (audit 4c flip)"), then `node skills/sync-skill.mjs programmatic-enterprise-web-performance`: 1 copied (`stages/design.md` only), 0 removed; `skills/SOURCE.md` row for this skill now `9d678f0`, 2026-11-02. Second commit.
- `docs/` (blueprint, charters) mention the SKIP line in places; not touched, they are other owners' files.

## Gates, last lines (run 2026-11-02 after the last edit)
```
node tools/audit/test/run.mjs                            OK: 576 of 576 checks passed
node tools/audit/run.mjs tools/audit/fixtures/good       exit 2; stderr: a built folder needs --target preview|production (the build's indexing is judged against it); stdout empty
node tools/audit/run.mjs tools/audit/fixtures/good --target production   exit 0; last stdout lines PASS ...; stderr: OK: 4 page(s), 30 rule(s), 0 FAIL, 0 WARN, 1 SKIP
node tools/omnikom-cli/test/run.mjs --unit              OK: 428 of 428 checks passed
node factory/runner/test/run.mjs                         OK: 75 of 75 checks passed (media checks SKIPPED: sharp is not installed)
node factory/test/run.mjs                                OK: 88 of 88 checks passed
```
Through `heavy.mjs`, only the new mutant (MUTATE_ONLY="the switch is back to false"; the whole list is left to CI by the head's ruling of 2026-11-02 05:01):
```
caught   index.mjs: the switch is back to false (slice 4c flip; a folder with no target runs again) (1 red: good site with no --target: exit 2, nothing on stdout, stderr names --)
1 mutants, 1 caught, 0 survived, 0 not run, 0 target text missing
```
The whole-list audit run was started first (about 365 of 426 printed, every line "caught", none survived, none missing) and was stopped by the head at 04:58; that partial is not a proof of the whole list.

## Target text, all four lists (each MUTANTS array imported, each find string, every pair of a layered CLI entry, tested exactly once in its file)
```
audit: 426 mutants, 0 target text missing
cli: 312 mutants, 0 target text missing
runner: 72 mutants, 0 target text missing
factory: 85 mutants, 0 target text missing
TOTAL target text missing: 0
```
The checker was watched red: the new mutant's find string broken on purpose gave "audit: 426 mutants, 1 target text missing", restored, back to 0.

## Watched red, CLI side (head's request, 2026-11-02 07:37)
`REQUIRE_TARGET_FOR_FOLDER` set to `false` in `tools/audit/index.mjs`, `node tools/omnikom-cli/test/run.mjs --unit` through `heavy.mjs`, then the switch restored to `true` (a script with a `finally`, verified):
```
FAIL audit with no --target passes nothing to the engine, which refuses a built folder with none: exit 2 USAGE naming --target: {"ok":true,"command":"audit","code":"ok","exit":0,"data":{"dir":"E:\\omk-wt-seo-5c\\tools\\audit\\fixtures\\good","mode":"static","target":null,...
FAIL gate with no --target exits 2 as well, nothing judged (a gate that skipped the indexing check is not a gate): GATE PASS 4 pages, 30 rules
FAILED: 426 of 428 checks passed, 2 FAILED
```
Red for the right reason: the two no-target checks, nothing else. Every other edited CLI check stays green with the switch off: they pass `--target production`, so they never measure the switch (they keep the intent they had; they are not new walls). Nothing measures nothing among the two new ones.

## Hygiene
0 CR in the five changed files and 0 em dashes in the added lines (`crdash` script run: TOTAL CR 0, em dash in changed lines 0).
`docs/departments/seo-and-audits.md` shows as modified in this worktree: not mine (the head's charter lines of 2026-11-02 05:01); left as it is.
