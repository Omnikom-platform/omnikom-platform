# Work order 28 proof: "not in the link data" in compare, measure and the Q4 link gap; test-reports.mjs `--group`

Date 2026-11-09. Builder: sonnet, branch `check/seo/authority-rest` at master `7373524`. Nothing committed or pushed in this repo.
SOURCE (the skill's own repo, `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance`): **`78d8b3d`**, on top of `c41d767`,
not pushed (no remote). The repo copy was made with `node skills/sync-skill.mjs programmatic-enterprise-web-performance`
("SYNC ...: 6 copied, 0 removed, 259 files in the source; SOURCE.md row -> `78d8b3d`"). `tools/audit/report.mjs` is unchanged and
`node tools/audit/test/run.mjs` was not run: no field it reads changed shape (the Q4 facts `referringDomains`, `inGraph`,
`competitors`, `linkGap` are as in work order 27; only the words of the `links` plan row and of the Q4 link gap line changed).

## What changed (SOURCE `scripts/`)
1. `compare.mjs` `authorityOf`: a site with `inGraph: false` gets `referring` and `strength` value `null` (never 0) with `notInGraph: true`;
   the table cell and the short answer say "not found in the link data"; the row has no better side (nothing is computed with the null).
2. `measure.mjs` `collectAuthority`: the target is the `role: "target"` result or the first result; competitors are every other result,
   each with `inGraph` and `linkingDomains` (null when not in the graph); a target not in the graph still lists them and its `linkGap`.
   Readers of that output checked: MSR-007 prospects (fixed, below), the authority diff (skips when either run is not in the graph, computes
   nothing with a null), `migrate.mjs` baseline (copies the field, no 0, no sum; see Findings).
3. `report-live.mjs`: with the target not in the graph the Q4 link gap line and the `links` plan row do not say "but not to you"; the
   `link gap` term is then not used, so the glossary does not print it either. `measure.mjs` MSR-007 does the same
   ("Link prospects (not judged: the site is not found in the link data)").
4. `test-reports.mjs`: `--group <letter>[,<letter>]` runs only those scenario groups and only mutants whose `sc` groups are all chosen;
   an unknown letter exits 2. `--keep` was **removed** from both usage lines (nothing read it; implementing it would mean passing the temp
   root out of `runScenarios` and the mutant loop for no user). New group `G` tests the option itself.

## Watched red on `c41d767` (new test files, old scripts: `--scripts <export of c41d767>/scripts`)
```
test-reports.mjs --scripts <c41d767>/scripts --no-mutants --group Q,G
FAIL Q: target not in the graph: the link gap line lists the sites that link to two or more competitors, says whether they link here cannot be judged ...
     - link gap: 1 sites, strongest first: g1.example
FAIL Q: target not in the graph: the 'links' plan row does not say 'but not to you', says it cannot be judged, and is proved by the site appearing ...
     {"kind":"links","what":"Ask the sites that link to two or more competitors but not to you: g1.example",..."provedBy":"referring domains rise in the next ...
FAIL G: usage lines (the comment on line 1 and --help) name --group and no longer name --keep, which nothing read
     usage: node test-reports.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--keep]
FAIL G: --group A,D runs only the scenarios of groups A and D (no W, P, N, S, Q line) and exits 0      (old file ran W, P, ... too)
FAIL G: --group with an unknown letter is refused with exit 2 and names the groups, not run as an empty pass   (old file ran everything, timed out)
FAIL G: --group selects mutants too: an A mutant runs under --group A and not under --group D
REPORTS TEST FAIL: 6 of 17          exit=1

test-compare.mjs --quiet --scripts <c41d767>/scripts
FAIL compare: the better side ...  [["lcp","b"],["kb","b"],["ldPct","b"],["causes","b"],["referring","a"],["strength",null]]
FAIL compare: referring domains come from the authority run ...  [12,0,"Common Crawl web graph cc-test (domain level) (found in old.test's authority run); the domain is not in the graph"]
FAIL compare: a site the link graph does not hold is 'not found in the link data' (value null, never 0) ...  | referring domains (Common Crawl) | 12 | 0 | A (by design) |
COMPARE TEST FAIL: 3 of 38          exit=1
```
Two of the three compare reds are old checks that asserted the defect (`b.value === 0`, `better === "a"`); they were changed to expect null.
```
test-measure.mjs --quiet --scripts <c41d767>/scripts
FAIL authority: a target the graph does not hold is inGraph false and still lists every competitor ...      competitors: [] inGraph: false
FAIL authority: with the target not in the graph the MSR-007 prospects finding lists the sites that link to 2 or more competitors ...
FAIL authority: a target in the graph keeps its count, lists the competitor not in the graph (null, no role) ...
     competitors: [{"domain":"rival-a.example","inGraph":true,"linkingDomains":120}] finding: {"rule":"MSR-007",...,"title":"Link prospects still not linking",...
140/143 passed          exit=1
```
(the competitor with no role, `rival-b.example`, is dropped; with the target not in the graph the list is empty and no finding is made)

## Green on `78d8b3d`, and the mutants
```
node scripts/test-reports.mjs            REPORTS TEST PASS: 59 of 59 / MUTANTS PASS: 63 of 63 caught   exit=0   (52 checks and 55 mutants at c41d767: 7 new checks, 8 new mutants)
node scripts/test-reports.mjs --group G  (the new option, run once)
   PASS G: usage lines (the comment on line 1 and --help) name --group and no longer name --keep, which nothing read
   PASS G: --group A,D runs only the scenarios of groups A and D (no W, P, N, S, Q line) and exits 0
   PASS G: --group with an unknown letter is refused with exit 2 and names the groups, not run as an empty pass
   PASS G: --group selects mutants too: an A mutant runs under --group A and not under --group D
   REPORTS TEST PASS: 4 of 4
   RED (caught) G: --group is ignored / an unknown group letter is accepted / a mutant outside the chosen groups still runs / --keep is back in the usage line
   MUTANTS PASS: 4 of 4 caught      exit=0
node scripts/test-compare.mjs --quiet    COMPARE TEST PASS: 38 of 38    exit=0
node scripts/test-compare.mjs --mutants  mutants: 24/25 red for the right reason   exit=1
   MUTANT main-check-exact-path: PATCH DID NOT APPLY exactly once (0 matches of the target text in measure-sources.mjs)
node scripts/test-measure.mjs --quiet    143/143 passed    exit=0
node scripts/test-measure.mjs --mutants  mutants: 45/45 red for the right reason   exit=0
```
The one compare mutant that does not apply is not mine: its target text (`const a = real(arg);`) is in neither `measure-sources.mjs` nor
`lib-main.mjs` at `c41d767` either (Findings). The 4 new compare mutants (`not-in-graph-is-zero`, `-cell-says-n/a`, `-short-answer-silent`,
`-not-flagged`) and the 4 new measure mutants (`authority-notingraph-competitors-dropped`, `-competitor-zero`, `-prospects-claim`,
`-linkgap-dropped`) are all "red for the right reason". The 8 new report mutants are 4 in group Q and 4 in group G.
A first full run of test-reports had 4 G mutants "patch did not apply" (found twice: each mutant quotes its own target); fixed by
splitting the quoted text, then 63 of 63.

## Q4 card and plan row of one report, target not in the graph (`q4card.mjs`: the group Q fixture site through `report-live.mjs`)
Before (`c41d767`):
```
- link gap: 2 sites, strongest first: g1.example, g2.example
PLAN ROW links:
  what:     Ask the sites that link to two or more competitors but not to you: g1.example, g2.example
  provedBy: referring domains rise in the next authority run
```
After (`78d8b3d`):
```
## 4. Does the site have the authority to rank?

- referring domains: not found in the link data (the link data holds no record of this site; that is not the same as 0)
- Competitor rival-a.example: 120 referring domains, strength rank 900
- Competitor rival-b.example: not found in the link data
- sites that link to two or more competitors: 2, strongest first: g1.example, g2.example; whether they already link to this site cannot be judged (the site is not found in the link data)
- Strongest sites linking here: not found in the link data

PLAN ROW links:
  what:     Ask the sites that link to two or more competitors (whether they already link to this site cannot be judged: the site is not found in the link data): g1.example, g2.example
  provedBy: this site appears in the next authority run (it is found in the link data)
```
Same site with the target in the graph (unchanged): `- link gap: 2 sites, strongest first: g1.example, g2.example`; row "... but not to you: ..." proved by
"referring domains rise in the next authority run".

## Em dashes
Counter: `String.fromCharCode(0x2014)` over the file text. compare.mjs, measure.mjs, report-live.mjs, test-reports.mjs, test-compare.mjs,
test-measure.mjs: 0 each in SOURCE and (compare, test-reports, test-compare, SOURCE.md) in the repo copy; 0 before and after. The copy of
measure.mjs was not counted in the repo: a `cmp` command naming it was refused by skill-stage-guard (Findings); sync copies the file as is.
