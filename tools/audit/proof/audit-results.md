# Proof: work order 05, audit results (2026-11-04, builder BUILDER_seo-and-audits_audit-results)

Branch `check/seo/audit-results`, built on master `bb60318`. Order: `work/05-audit-results/CONTEXT.md`. Every block below is pasted output.

## Gate status (read this first)
| Gate | State |
|---|---|
| skill paths: grep prints nothing; `diff -rq` shows only `.git` and `site-checks` | DONE, pasted in step 1 |
| `test-launch.mjs` | DONE: `LAUNCH TEST PASS: 55 of 55`, `MUTANTS PASS: 16 of 16 caught`, exit 0 |
| `node tools/audit/test/run.mjs` | DONE: `OK: 589 of 589 checks passed`, exit 0 (13 new checks) |
| the 11 new mutants (`MUTATE_ONLY`) | DONE: `11 mutants, 11 caught, 0 survived, 0 not run, 0 target text missing` |
| `node tools/audit/test/mutate.mjs` (all 426 mutants) | NOT DONE locally (stopped at the head's ruling); CI run 41803555037 per the head; see the end |
| `node docs/blueprint/specs/run-all-gates.mjs` | NOT DONE locally (stopped at the head's ruling; partial output with two non-green lines at the end); CI per the head |

## Two places where the order's numbers cannot both hold (decided, measured, reported)
1. **200 fails x 300-character `what` cannot fit in 60 KiB.** The order asks for up to 200 fails, each `what` cut to 300 characters, and JSON under
   60 KiB "for any input" (the callback refuses over 64 KiB). 200 x (300 + about 130 bytes of keys, page and source) is about 86 KB. Decision: the
   60 KiB bound is the invariant that protects the callback, so `summarize` keeps fails in rule order up to 200 AND while the JSON stays under
   `MAX_BYTES` (60 KiB); `truncated` counts every FAIL left out, so `fails.length + truncated` is always the FAIL count. Measured
   (`sizes.mjs`, 5,000 FAILs, one rule, short page and source):
   ```
   what 20: 200 fails kept, truncated 4800, 24188 bytes
   what 100: 200 fails kept, truncated 4800, 40188 bytes
   what 150: 200 fails kept, truncated 4800, 50188 bytes
   what 200: 200 fails kept, truncated 4800, 60188 bytes
   what 300: 153 fails kept, truncated 4847, 61341 bytes
   what 2000: 153 fails kept, truncated 4847, 61341 bytes
   ```
   So the order's test "5,000 FAILs with 2,000-character `what` gives 200 fails, truncated 4800" is written as two checks: short text gives exactly
   200 and 4800; 2,000-character text gives at most 200, `fails + truncated = 5000`, every `what` 300 characters, JSON under 60 KiB (153 kept).
   Measured on the real rules (`whatlen.mjs` over the 98 `bad-*` folders, `--target production`): `98 bad folders, 110 FAIL texts, median 78, p90 147, p99 179, max 179, most FAILs in one folder 11`.
   So a real audit's texts are under 200 characters and all its FAILs (up to 200) are kept; the byte budget only bites on pathological input.
2. **The good fixture fails `--target preview`.** `fixtures/good` is a production build (no noindex), so `ENV-001` correctly FAILs it as a preview. The
   test helper `cli()` adds `--target production` to a folder run; the preview twin is `fixtures/good-preview`. Both shown below.

## Step 1: skill paths
Outside copy (its own git repo), one commit:
```
$ git -C C:/Users/DELL/.claude/skills/programmatic-enterprise-web-performance log --oneline -1
9759d24 Platform work order 05 (audit results), step 1: skill paths follow the move to E:\Omnikom Platform\code\main (sops\clients\..., templates\client-questions\, docs/product/7-sites.md section Launch replaces docs/blueprint/12-LAUNCH.md): stages/launch.md:5, stages/build.md:82,94,96, scripts/launch.mjs:716
 scripts/launch.mjs | 2 +-
 stages/build.md    | 6 +++---
 stages/launch.md   | 2 +-
 3 files changed, 5 insertions(+), 5 deletions(-)
```
Sync into the repo:
```
$ node skills/sync-skill.mjs programmatic-enterprise-web-performance
copy   scripts\launch.mjs
copy   stages\build.md
copy   stages\launch.md
SYNC programmatic-enterprise-web-performance: 3 copied, 0 removed, 259 files in the source; SOURCE.md row -> `9759d24` "Platform work order 05 (audit results), step 1: skill paths follow the move to E:\\Omnikom " 2026-11-04
```
`skills/SOURCE.md` row 5 now names `9759d24`.

The proof grep in the order is written with a markdown-escaped backslash (`\\\\\(`) that grep rejects ("Unmatched ) or \)"); the same intent, a literal
backslash after `Omnikom Platform` (single in the .md files, doubled in the JS string), as `grep -E`:
```
$ grep -rnE 'Omnikom Platform\\+(sops|templates|docs)' <outside copy> --exclude-dir=.git --exclude-dir=site-checks
(nothing)  exit 1
$ grep -rnE 'Omnikom Platform\\+(sops|templates|docs)' skills/programmatic-enterprise-web-performance
(nothing)  exit 1
$ diff -rq C:/Users/DELL/.claude/skills/programmatic-enterprise-web-performance skills/programmatic-enterprise-web-performance
Only in C:/Users/DELL/.claude/skills/programmatic-enterprise-web-performance: .git
Only in C:/Users/DELL/.claude/skills/programmatic-enterprise-web-performance: site-checks
```
Launch test on the synced repo copy (`node skills/programmatic-enterprise-web-performance/scripts/test-launch.mjs`), last lines:
```
LAUNCH TEST PASS: 55 of 55
...
MUTANTS PASS: 16 of 16 caught
exit=0
```
(A first run through `timeout 500` was killed in its mutant phase, exit 124, after `LAUNCH TEST PASS: 55 of 55`; that was my wrapper, not the test. The run above has no time limit.)

## Steps 2 and 3: summary.mjs and run.mjs --summary
```
$ node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target preview --summary      (the order's proof command; exit 1)
{"v":1,"target":"preview","mode":"static","pass":false,"exit":1,"pages":4,"rules":30,"counts":{"PASS":85,"FAIL":5,"SKIP":1},"byFamily":{...},"fails":[ENV-001 x4 (preview not noindex), {"rule":"MET-003","page":"/tasting-room/","line":48,"what":"value-mismatch: <h4> \"Small print\" follows <h2> \"Before you come\" (line 46) and skips a level","source":"checklist/web-delivery.md MET-003"}],"truncated":0}     2408 bytes
$ node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target production --summary   (what the tests run: exactly one FAIL)   exit 1
$ node tools/audit/run.mjs tools/audit/fixtures/good --target production --summary
{"v":1,"target":"production","mode":"static","pass":true,"exit":0,"pages":4,"rules":30,"counts":{"PASS":90,"FAIL":0,"SKIP":1},"byFamily":{"A11":{"PASS":4,"FAIL":0,"SKIP":0},"DSN":{"PASS":44,...},"ENV":{"PASS":4,...},...,"PMP":{"PASS":0,"FAIL":0,"SKIP":1},...},"fails":[],"truncated":0}     exit 0
$ node tools/audit/run.mjs tools/audit/fixtures/good-preview --target preview --summary     pass true, exit 0
$ node tools/audit/run.mjs tools/audit/fixtures/good --json --summary
--summary and --json cannot be combined (--json prints the whole result, --summary the small one)
usage: node tools/audit/run.mjs <folder> [--json | --summary] [--only MET-003,MET-001] [--psi FILE] [--target preview|production] [--prompt-coverage FILE] [--list]
exit 2
```
`WARN` is not one of the order's three keys; the engine has a WARN status (rule severity W), so it lands under `counts.WARN` as the order says (an
unknown status gets its own key). No real fixture run produces a WARN at the moment; the test uses a synthetic one.

## Steps 4 and 5: tests, watched-fail, mutants
`node tools/audit/test/run.mjs`, last lines (13 new checks; before: 576):
```
ok   temp folders: a mutant run killed by its time limit prints NOT RUN and leaves no folder in the temp base
OK: 589 of 589 checks passed
exit=0
```
The 13 new checks are the block "work order 05" in `test/run.mjs` (good site; counts and families agree with `--json`; byFamily adds up; bad-MET-003 one MET
FAIL with page and line; `--summary` with `--json` either order; usage names `--summary`; runner equals `summarize()`; 5,000 short FAILs = 200 and 4800;
5,000 x 2,000-character FAILs bounded; 300/301 cut; unknown status counted; 500 statuses and families bounded; commit and null fields).

**Watched-fail (each new check seen red for the right reason before it was kept).** First by hand, then by mutant:
- By hand, `OMNIKOM_AUDIT_FAILFAST=1`, 200 cap removed from `summary.mjs` (the byte budget left in): 523 s for one suite run on the loaded laptop, so I stopped doing it serially:
  ```
  BREAK no 200 cap -> exit 1, 523 s
    FAIL summarize: 5,000 FAILs with short text keep 200 fails in rule order and say truncated 4800: 507 fails, truncated 4493
    FAILED: 1 of 582 (stopped at the first failure, OMNIKOM_AUDIT_FAILFAST=1)
  ```
  (the red is about the cap: 507 short fails fit in 60 KiB, so only the cap holds it to 200). The file was restored and checked by grep.
- Then the same breaks as 11 mutants in `test/mutate.mjs` (the harness applies each to a COPY and counts only a `FAIL` line as a catch). First attempt: all 11
  `NOT RUN (killed, exit null)` at the 180 s limit on the loaded machine, which counts as nothing; second attempt with `MUTATE_TIMEOUT_S=1500`:
```
caught   summary.mjs: a status that is not PASS, FAIL or SKIP is dropped, not counted (1 red: summarize: a status that is not PASS, FAIL or SKIP is counted under it)
caught   summary.mjs: the 300-character cut of a what is removed        (1 red: summarize: 5,000 FAILs with 2,000-character text: at most 200 fails, f)
caught   summary.mjs: the 200-fail cap is removed                       (1 red: summarize: 5,000 FAILs with short text keep 200 fails in rule order an)
caught   summary.mjs: the 60 KiB byte budget is removed                 (1 red: summarize: 5,000 FAILs with 2,000-character text: at most 200 fails, f)
caught   summary.mjs: truncated always says 0                           (1 red: summarize: 5,000 FAILs with short text keep 200 fails in rule order an)
caught   summary.mjs: the PASS lines are not counted                    (1 red: --summary on the good site: target, mode, pages and rules agree with -)
caught   run.mjs: --summary together with --json is accepted            (1 red: --summary with --json (either order) exits 2, prints nothing on stdout)
caught   summary.mjs: the commit is dropped                             (1 red: summarize: commit is kept when given (cut to 64 characters), a snapsho)
caught   summary.mjs: the family is the whole rule id                   (1 red: --summary on the good site: byFamily has every rule family (MET, SE, D)
caught   run.mjs: --summary prints the whole audit object               (1 red: --summary on the good site: exit 0, one JSON object and nothing else ()
caught   run.mjs: the usage line does not name --summary                (1 red: the usage line of run.mjs names --summary: usage: node tools/audit/run)

11 mutants, 11 caught, 0 survived, 0 not run, 0 target text missing
exit=0
```
The order's three (cap, 300 cut, unknown-status count) are the first three above; the other eight are mine (byte budget, truncated, PASS count, commit,
family, runner shape, `--json` clash, usage line).

## Steps 6 and 7
README section "The summary (stored per site)" in `tools/audit/README.md` (the call, the shape, the limits with the measured numbers, the runner line).
No file written by this order contains an em dash (`grep -c` for the U+2014 character on summary.mjs, run.mjs, README.md, test/run.mjs, test/mutate.mjs and CONTEXT.md prints 0 for each).

## Full mutant run and run-all-gates
Both were stopped by the head's rulings, not finished locally:
- Full `mutate.mjs` (426 mutants): NOT DONE locally. Stopped at the head's ruling (11:00); it had printed only `caught` lines (26 of 426, none survived) and no summary line. CI is the gate: the head
  reports CI run 41803555037 ran the full audit mutants and `run-all-gates` on ff21e70, green. Locally the 11 new mutants above are the evidence.
- `run-all-gates.mjs`: NOT DONE locally, stopped at the head's ruling (12:23) because it held the machine lock that platform's walls waited on. What it had printed (`gates.out`), no gate here touches `tools/audit/`:
  ```
  PASS contract tests             168 passed, 0 failed
  PASS contract mutants           101 mutants, 101 caught, 0 survived; 0 codes untested
  PASS industry run               15/15 PASS
  FAIL database walls + mutants   TIMEOUT after 3600 s (limit 3600 s; not a test failure, the gate was killed; last line: caught   fn52: ...)
  PASS publish-ready parity (SQL vs JS) OK: 14469 items, SQL and JS agree on every required path
  PASS test cluster ports         OK: every check passes
  PASS test cluster port probe    PORT PROBE: OK ...
  PASS head land-script gate (gate-lib) GATE-LIB TESTS OK
  FAIL promote-check tests           (exit 1, 985 s)
  ```
  The two FAIL lines are a 3600 s time-out of the walls gate on a loaded laptop (the runner says "not a test failure") and `promote-check tests` at 985 s (a local-cluster test on the same
  loaded machine; not investigated, and not a file of this order). They are NOT green and are not claimed green; CI's run of the same gates is the evidence.
  The run also rewrote `contracts/industry-run/RESULTS.md` in the worktree; restored with `git checkout`, not committed.

## Finding 4, head's ruling: fixed inside this order
The head ruled finding 4 in scope. Outside copy `scripts/launch.mjs:68` now says `sops/clients/client-questions.md`:
```
$ git -C C:/Users/DELL/.claude/skills/programmatic-enterprise-web-performance log --oneline -1
3cbe331 Platform work order 05 (audit results), head's ruling on finding 4: scripts/launch.mjs:68 names sops/clients/client-questions.md
$ node skills/sync-skill.mjs programmatic-enterprise-web-performance
copy   scripts\launch.mjs
SYNC programmatic-enterprise-web-performance: 1 copied, 0 removed, 259 files in the source; SOURCE.md row -> `3cbe331` ...
$ grep -rn "sops/client-questions" skills/programmatic-enterprise-web-performance        (nothing)
$ diff -rq <outside copy> skills/programmatic-enterprise-web-performance                   only .git and site-checks
$ node skills/programmatic-enterprise-web-performance/scripts/test-launch.mjs   (re-run after the fix, last lines)
LAUNCH TEST PASS: 55 of 55
MUTANTS PASS: 16 of 16 caught
exit=0
```
