# Work order 27: "not found in the link data" is not zero (2026-11-09)

Brief: `work/27-authority-not-in-graph/CONTEXT.md`. Builder: Sonnet 5.5, branch `check/seo/authority-not-in-graph` at master `03464ae`. Nothing committed or pushed in this
repository. The skill SOURCE is committed (not pushed): `c41d767` (parent `3cbe331`).

SOURCE sha: `c41d7674f56fa256c78ea447e5fda4624d64eae4`

## What changed

SOURCE (`C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance`), `scripts/report-live.mjs`:
- Q4 facts: `referringDomains` is null (was 0) and `facts.inGraph` is false for a target the link graph does not hold; each competitor row has
  `referringDomains` null and `inGraph` false (true with the count otherwise); `strengthRank` stays null.
- Competitors are now every `authority.json` result except the target. Before, `role === "competitor"` dropped a competitor that is not in the graph,
  because `authority.mjs` writes no `role` on such a row (Findings 2).
- Every reader says "not found in the link data" and none computes with the null: the Q4 card, the short answer, question 5's "why" sentence, and the
  since-last-report line (`metricsOf` refdom, both directions).
- `scripts/test-reports.mjs`: group Q (10 assertions) and 11 mutants.

Repo: `skills/` copy by `node skills/sync-skill.mjs programmatic-enterprise-web-performance` (2 files copied, 0 removed; the sync rewrote the skill's
row in `skills/SOURCE.md` to `c41d767`, 2026-11-09), `tools/audit/report.mjs` (question 4), `tools/audit/test/run.mjs` (2 checks + 1 added input to the
two per-input checks), `tools/audit/test/mutate.mjs` (5 mutants).

## SOURCE: watched red on the old code (before the edit to report-live.mjs)

`node scripts/test-reports.mjs --no-mutants`, last lines (9 of the 10 Q assertions red; the tenth, "not found twice", is a guard that is also true on the old code):

```
FAIL Q: target not in the graph: referringDomains is null (never 0), inGraph is false, strengthRank is null
     {"referringDomains":{"value":0,"source":"Common Crawl web graph cc-test (domain level)", ...
FAIL Q: competitors: the one in the graph keeps its count and rank (inGraph true); the one not in the graph, which authority.json gives no role, is still listed with referringDomains null and inGraph false
     [{"domain":"rival-a.example","referringDomains":120,"strengthRank":900}]
FAIL Q: section 4 says 'not found in the link data' for the target and for the competitor, and prints no 0 for either
- referring domains: 0 (strength rank not ranked; 1 = strongest site on the web)
FAIL Q: the short answer says the site is not found in the link data and does not say '0 other websites link to it'
     q1.example: search engines and AI crawlers can reach and read it; 0 other websites link to it (Common Crawl). ...
FAIL Q: question 5's 'why' sentence about too few links says not found in the link data, not '0 referring domains'
     no answer cites this site: it has too few other sites linking to or mentioning it for the engines to treat it as a source (0 referring domains in Common Crawl)
FAIL Q: since the last report, counted -> not found: 'referring domains: 14 to not found in the link data'
     **Since the last report (2026-11-09):** referring domains: 14 to 0.{"metric":"refdom", ...
FAIL Q: since the last report, not found -> counted: 'referring domains: not found in the link data to 20'
     **Since the last report (2026-11-09):** referring domains: 0 to 20.{"metric":"refdom", ...
REPORTS TEST FAIL: 9 of 52
```

(The two others are "section 4: a competitor in the graph still shows its number ... 'not found', not 'none'" and "target and competitor in the graph ... inGraph true";
they were red on the old code because `Strongest sites linking here: none` and the missing `inGraph` fact.)

## SOURCE: green after, and its mutants

`node scripts/test-reports.mjs` (the whole file, all 55 mutants), last lines:

```
REPORTS TEST PASS: 52 of 52
RED (caught) Q: the target not in the graph is 0 again: 1 assertion(s) red e.g. "Q: target not in the graph: referringDomains is null (never 0), inGraph is false"
RED (caught) Q: a competitor not in the graph is 0 again: 1 assertion(s) red e.g. "Q: competitors: the one in the graph keeps its count and rank (inGraph true); th"
RED (caught) Q: a competitor with no role is dropped again: 2 assertion(s) red e.g. "Q: competitors: the one in the graph keeps its count and rank (inGraph true); th"
RED (caught) Q: inGraph false is not recorded: 7 assertion(s) red e.g. "Q: target not in the graph: referringDomains is null (never 0), inGraph is false"
RED (caught) Q: section 4 prints a competitor not in the graph as a count: 1 assertion(s) red e.g. "Q: section 4 says 'not found in the link data' for the target and for the compet"
RED (caught) Q: section 4 prints the target not in the graph as a count: 1 assertion(s) red e.g. "Q: section 4 says 'not found in the link data' for the target and for the compet"
RED (caught) Q: section 4 says none for the strongest linkers of a site not found: 1 assertion(s) red e.g. "Q: section 4: a competitor in the graph still shows its number and rank; stronge"
RED (caught) Q: the short answer counts the null: 1 assertion(s) red e.g. "Q: the short answer says the site is not found in the link data and does not say"
RED (caught) Q: question 5's why sentence counts the null: 1 assertion(s) red e.g. "Q: question 5's 'why' sentence about too few links says not found in the link da"
RED (caught) Q: the change line drops a site not found: 2 assertion(s) red e.g. "Q: since the last report, counted -> not found: 'referring domains: 14 to not fo"
RED (caught) Q: the change line prints the null as a number: 2 assertion(s) red e.g. "Q: since the last report, counted -> not found: 'referring domains: 14 to not fo"
MUTANTS PASS: 55 of 55 caught
```

One mutant ("the target not in the graph is 0 again") first showed `FAIL (survived)` because I had listed a second assertion it was never going to turn red
(the change line keys on `inGraph`, not on the count); the list was corrected to the one assertion that does go red, and the run above is after that fix.
Each patch applies exactly once (the harness prints `FAIL mutant ... patch target found N times` otherwise; none printed).

## Repo: watched red, then green

On the unmodified `tools/audit/report.mjs` (tests added first), `node tools/audit/test/run.mjs`:

```
FAIL report --live: a target and a competitor the link data does not hold read 'not found in the link data' with no digit and no fact (never 0); a competitor in the link data, or with no inGraph key, keeps its number and its fact
FAILED: 1 of 677
```

Reason: the old code reads a null count as "not measured yet" and has no `inGraph` rule. The second new check (inGraph true or absent keeps today's card) is a
guard and is also green on the old code.

After the change and after the sync, `node tools/audit/test/run.mjs`, exit 0, last line:

```
OK: 677 of 677 checks passed
```

Mutants, `MUTATE_ONLY="inGraph false|every site is called not found" node tools/audit/test/mutate.mjs` (through `heavy.mjs`):

```
caught   report.mjs: inGraph false printed as 0 (the target)            (1 red: report --live: a target and a competitor the link data does not hold r)
caught   report.mjs: inGraph false printed as 0 (a competitor)          (1 red: report --live: the real report.json (report-live.mjs on the skill's fi)
caught   report.mjs: inGraph false is ignored (the target)              (1 red: report --live: a target and a competitor the link data does not hold r)
caught   report.mjs: inGraph false is ignored (a competitor)            (1 red: report --live: a target and a competitor the link data does not hold r)
caught   report.mjs: every site is called not found in the link data    (1 red: report --live: a wrong source and a number with no fact are seen by th)

5 mutants, 5 caught, 0 survived, 0 not run, 0 target text missing
```

History, stated plainly: the first run of these 5 printed `NOT RUN ... (killed, exit null)` for 4 of them (the 180 s limit on a loaded laptop; a kill is not a
catch), the second never started (the machine lock was held for 30 minutes), the third, with `MUTATE_TIMEOUT_S=900` and `--wait-min 150`, is the output above.
Two of the five are caught by a different check than the one written for them ("printed as 0 (a competitor)" by the existing real-report words check, "every site is
called not found" by the existing wrong-source check); both are red, which is what the harness counts. The full `mutate.mjs` (all mutants) was NOT run here, only
`MUTATE_ONLY` for the new ones, as the brief says.

## The Q4 card of one report

A fixture site (`ghost.example`): the target and `rival-b.example` are not in the link graph (`authority.json` in the shape `authority.mjs` writes: no `role`,
`inGraph:false`), `rival-a.example` is. The skill's `report-live.mjs` ran on it from the repo copy, then this repo's `report.mjs` rendered its `report.json`.

The skill's `report.md`, section 4:

```
## 4. Does the site have the authority to rank?

- referring domains: not found in the link data (the link data holds no record of this site; that is not the same as 0)
- Competitor rival-a.example: 120 referring domains, strength rank 900
- Competitor rival-b.example: not found in the link data
- link gap: 1 sites, strongest first: g1.example
- Strongest sites linking here: not found in the link data

Source: Common Crawl web graph cc-test (domain level), 2026-10-23. Common Crawl sees fewer links than paid tools: compare sites with each other, not as absolute numbers.
```

The short answer of the same report: `ghost.example: search engines and AI crawlers can reach and read it; the site is not found in the link data (Common Crawl). Whether it ranks and gets cited by AI is not fully measured yet (BLOCKED, see 2, 3 and 5).`

`report.json` question 4: `{"inGraph":false,"referringDomains":null,"strengthRank":null,"competitors":[{"domain":"rival-a.example","referringDomains":120,"inGraph":true,"strengthRank":900},{"domain":"rival-b.example","referringDomains":null,"inGraph":false,"strengthRank":null}]}`

This repo's `tools/audit/report.mjs`, question 4:

```
## 4. Does the site have the authority to rank?

- Websites that link to this site: not found in the link data
- Websites that link to the competitors:
  - `rival-a.example`: 120
  - `rival-b.example`: not found in the link data
- Websites that link to at least two competitors but not to this site: 1

Measured 2026-10-23 from the Common Crawl link graph.
```

The same fixture on the old code (skill copy at `HEAD`), for comparison:

```
- referring domains: 0 (strength rank not ranked; 1 = strongest site on the web)
- Competitor rival-a.example: 120 referring domains, strength rank 900
- Strongest sites linking here: none
ghost.example: search engines and AI crawlers can reach and read it; 0 other websites link to it (Common Crawl). ...
```

(`rival-b.example` is missing from the old card altogether.)

## Em dashes

Counted with `String.fromCharCode(0x2014)` over every touched file (`tools/audit/report.mjs`, `test/run.mjs`, `test/mutate.mjs`, this proof, the work order, the
synced `report-live.mjs` and `test-reports.mjs`, `skills/SOURCE.md`, and the SOURCE `test-reports.mjs`): 0 in each, total 0 (0 at `HEAD` for the six that existed).
The whole skill copy folder holds 74 before and 74 after the sync, so the count did not rise.
