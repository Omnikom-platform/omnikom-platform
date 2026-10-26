# Baseline before the overhaul: every self-test at commit 92c540b (master HEAD, 2026-10-25)

Run on a pristine detached worktree of that commit (`C:\Users\DELL\.claude\skills-work\pewp-baseline-92c540b`), with `scripts/run-all-tests.sh`
(each test in order, exit code recorded, one log per test under `runs/_baseline/`). The first attempt ran inside the editing worktree and was
stopped as soon as that was noticed; its stray `sh` kept appending to `summary.txt` until 01:28 (the lines before `test-freshness` in that file,
except the first two, are from it and are not the baseline). The lines below are the clean run. The machine was heavily loaded during the run
(up to 46 node processes from the builders), which explains the times, not the results.

| Test | Exit | Result (pasted from the log) | Seconds |
|---|---|---|---|
| test-authority | 0 | 137/137 checks passed | 10 |
| test-compare | 0 | COMPARE TEST PASS: 37 of 37 | 34 |
| test-freshness | 0 | FRESHNESS TEST PASS: 41 of 41 · MUTANTS PASS: 33 of 33 caught | 9364 |
| test-iterate | 0 | PASS mutants 25/25 went red for the right reason | 208 |
| test-main | 0 | MAIN-MODULE TEST PASS: 10 of 10 | 8 |
| test-measure | 0 | 140/140 passed | 8 |
| test-phase1 | 0 | PHASE 1 TEST PASS: 29 of 29 | 3 |
| test-plan-gate | 0 | PASS test-plan-gate 306/306 checks · PASS mutants 59/59 went red for the right reason | 307 |
| test-plan-merge | 0 | PLAN+MERGE TEST PASS: 17 of 17 | 3 |
| test-ref | 0 | REF TEST PASS: 91 of 91 · MUTANTS PASS: 37 of 37 caught | 1197 |
| test-refactor | 0 | REFACTOR TEST PASS: 75 of 75 · MUTANTS PASS: 37 of 37 caught | 2137 |
| test-research | 0 | 169/169 checks passed | 16 |
| test-rules | 0 | 71/71 rule checks passed · PASS mutants 34/34 went red for the right reason | 28 |
| test-snapshot | 0 | SNAPSHOT TEST PASS: 31 of 31 | 106 |
| test-start | 0 | START TEST PASS: 71 of 71 · MUTANTS PASS: 14 of 14 caught | 99 |
| mutants-research | 1 | `BASELINE NOT GREEN: seeds: --industry insurance-agency adds the pack's queries (...)` | 24 |

## Pre-existing reds at the baseline (named, never silently "fixed")
- `mutants-research.mjs`: BASELINE NOT GREEN on the seeds `--industry insurance-agency` check (the known red of commit c32cc22). Cause found during
  the overhaul: research-seeds.mjs resolved `rules/industries` relative to the copied scripts, so the mutant harness's copy found no packs.
  Fixed at the root (packs resolved through `PEWP_RULES_DIR`, `lib-rules.mjs rulesDir()`), no assertion weakened: after the overhaul the
  harness baseline is green and 110 mutants run.
- `test-measure.mjs --mutants` was not part of the baseline runner (it runs without `--mutants`); run by hand on the branch it reports 40/41 with
  `main-check-exact-path: PATCH DID NOT APPLY`: its target string `const a = real(arg);` is absent from measure-sources.mjs at 92c540b as well
  (checked with `git show`), so that one is pre-existing and listed, not fixed.
- `test-snapshot` "--gap-ms 400" timing assertion: green here (31/31) and green on the branch on a quiet machine (42/42); it goes red under
  heavy CPU load on both old and new code (seen twice during the overhaul). Not changed.
