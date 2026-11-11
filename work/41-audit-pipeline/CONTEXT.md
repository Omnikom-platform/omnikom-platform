# 41 Skill: one step list for a full client audit (pipeline.json), read by start.mjs and by `omnikom seo run`

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/audit-pipeline. Status: OPEN, 2026-11-11 01:40, from the head
of SEO. Ordered by the owner (01:27) through the head of operations.

## Why
The owner: every mechanical, no-AI step of a client audit should run from one CLI call by an agent. The CLI department builds
`omnikom seo run <url> --client <slug>`. The step list is ours, as a manifest in the skill, and the CLI reads it and adds nothing.
The head of operations ruled that there is ONE step list: the skill's own `start.mjs` audit-live mode reads the same manifest,
its own audit-live sequence is removed, and a test fails if the two ever differ.

## Where
- The skill's outside copy, its own git repo: `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance`. The head of
  SEO wrote the draft `pipeline.json` there: 36 steps, with conventions agreed with HEAD_CLI-and-testing_2026-11-09. Read it
  first, then `scripts/start.mjs`, `scripts/state.mjs` and `SKILL.md`.
- Other writers in that repo right now: the head of SEO (a pace fix in research-competitors.mjs, test-research.mjs and
  mutants-research.mjs), and `BUILDER_seo-and-audits_link-anchors` (a new authority-anchors step). Don't touch their files. Commit
  only your own files there, after the head says the pace fix is committed. Check `git log -1`: it should mention "1 request per 4
  s per site".
- When done, sync into your worktree with `node skills/sync-skill.mjs programmatic-enterprise-web-performance`, which rewrites
  `skills/SOURCE.md`, and leave it uncommitted. The CLI reads the repo copy (code/main/skills/...), so the manifest reaches master
  that way.

## The manifest's rules (agreed with CLI; their validator enforces them)
- Exit 0 = ok, 2 = usage, 3 = BLOCKED, 4 = SKIPPED. A per-step `exit` overrides only where a script differs. authority-classify
  and authority-vet use 4 = partial.
- A step that exits 3 or 4 prints a last line `BLOCKED: <what> | unblocks: <what would>` or `SKIPPED: <reason>`.
- A step is done when exit 0 is in the run log and every evidence path exists, is not empty, and was written after the step
  started. An input newer than its evidence makes the step stale.
- `hits`: two steps on the same host never run at once.
- Steps with `script: null` are WAITING: needsBrowser "owner", needsAi true, or needsPerson true. They carry a `brief`, someone
  writes their outputs, and the next resume picks them up.
- Placeholders: {url} {client} {host} {skill} {runDir} {pewp} {work}. The runner makes {work} = {runDir}/work/.
- Unknown keys, unknown placeholders, an unknown dependsOn id, a cycle or a missing script make the manifest invalid.

## What to build
1. `start.mjs audit-live` builds its stage sequence from `pipeline.json` and nothing else. Its existing audit-live stages (doctor,
   snapshot, checker, authority, report) are replaced by the manifest's steps. A WAITING step maps onto the start.mjs pause states:
   - needsPerson -> NEEDS-APPROVAL, with the brief
   - needsBrowser owner -> WAITING-FOR, with the brief
   - needsAi -> WAITING-FOR, with the brief
   Keep the other modes as they are.
2. A test (in the skill's test style, with mutants) that:
   - fails if start.mjs's audit-live sequence differs from pipeline.json in ids, order or dependsOn
   - validates the manifest by the rules above, with a broken fixture manifest per rule watched failing
   - checks that every script step's args parse: run each script with its manifest args against a local fixture site or a fixture
     pewp, where that is cheap, or at least check that each flag it passes appears in that script's usage line. Say which it is
     per step.
3. Fix these gaps from work order 40, each with a test that fails before the fix, then add each to pipeline.json:
   a. `psi.mjs --runs 3`: three runs per URL and strategy, every run's file kept, and the median recorded. Then the psi step uses it.
   b. `research.mjs`: its Bing step must not fail when own-site stats are refused (NotAuthorized). Keyword estimates go on; site
      stats are BLOCKED with "the client adds us as a user in Bing Webmaster Tools".
   c. A CrUX step (real-visitor speed, `CRUX_API_KEY` by name). "Data not found" is a valid result, NO DATA, not a failure.
   d. Importers that turn the owner-browser captures into one normalized JSON per module, so the report reads numbers and never
      raw captures:
      - index (site: counts)
      - trends (region tables)
      - non-Google AI answers
      - reputation (ratings, counts, complaints)
      - social (followers, posts, newest date, link status)
      - ads (running or not, count, since)
      Define each capture format in the importer's header, the way research-autocomplete.mjs does. Then each importer is a
      mechanical step after its capture step.
4. Update `SKILL.md` and the audit-live section to say that the step list is `pipeline.json`.

## Hard rules
- Run only this skill's tests for the files you change, through
  `node ~/.claude/scripts/heavy.mjs --wait-min 30 --label "SEO 41: <what>" -- ...` when they launch a browser or run mutants.
- No network in tests; the skill's guard proves it.
- Scripts go in files, never inline `node -e`. No em dashes. Don't commit in the Omnikom repo or push; the head does.
- Memory: stop and tell the head below 4 GB free.

## Done means
- start.mjs audit-live reads pipeline.json, and the sameness test is red when the two differ (watched).
- Gaps a to d are built, each with a watched-failing test and caught mutants.
- The manifest validates.
- SOURCE.md is synced.
Then message HEAD_SEO-and-audits_2026-11-09 with the skill commits, the test and mutant lines pasted, and per step whether its args
were run against a fixture or only checked against the usage line.

## Gaps logged later (head of SEO, 2026-11-11 02:15): not in this order unless you finish early, then ask first
- research-competitors.mjs: its licence field matches only real-estate licence numbers. Lending (NMLS, DFPI CFL) and other
  industries need their own patterns per industry pack (WO40 B scanned for lending terms by hand).
- The keyword-mapping check WO40 B wrote (`work/40b-paragon-b/test-match.mjs`, `check-map.mjs` in its worktree) belongs in the skill
  as a step after targets-validate.
- The scorecard (`clients/paragon/audit-2026-11/build-scorecard.mjs`) belongs in the skill or tools/audit. Its engine input file
  must be saved under pewp (the verifier could not re-run it).
- research.mjs keeps off-topic Bing related keywords ("summit racing equipment", "northern tool and equipment", "advance america"
  for a business lender): they pollute clusters and report-live Q2 and Q6. Related keywords need a topic filter against the business
  definition's services before clustering (WO40 B module 7).
- intake run without the owner's answers leaves business.json with no address or phone, so the whole local suite is BLOCKED. Intake
  should take the site's own contact block as a labelled default ("from the site, not confirmed") rather than nothing.
- authority.mjs streams the Common Crawl edges file with no checkpoint: a stop loses the whole read, and every run re-reads the
  full graph (WO40 B: phase 2 alone ran over 54 min on a shared disk). It needs a checkpoint, or a per-release cache of the edges
  filtered to the domains asked about, so a re-run with more competitors reads only what is new.
- report-live.mjs does not read crux.json or the six importers' JSON, though pipeline.json orders them before it: the six-question
  report ignores real-visitor speed, index coverage, trends, non-Google AI answers, reputation, social and ads. Its own work order.

## Builder status, 2026-11-11 04:35 (sonnet; written by the builder, replaced in place when it changes)
DONE and COMMITTED in the skill repo (outside copy, worktree synced, SOURCE.md row c04ac91, uncommitted here):
1907497 psi --runs | ea248bc Bing NotAuthorized (+ lib-test-kit.mjs, netguard-import.mjs) | f76874e crux.mjs | a6a0948 six importers | a89ae9f live-target
pointer, local-grid exit 3, intake last line | 84f1ec5 city-centres | 5777d1b pipeline.json + lib-pipeline.mjs + start.mjs + tests + docs | 41f2bef report-live
exit 3 + step-contract section K | c04ac91 vantage step as ruled.
Plain test lines (no mutants): pipeline 126/126, start 125/125, psi 33/33, bing-refusal 15/15, crux 22/22, importers 69/69, step-contracts 41/41, city-centres 19/19.
UNPROVEN / NOT DONE (say these words in any report):
- MUTANT RUNS of all 8 suites: NOT RUN (heavy lock order: WO43's proof, platform 20, Clients 37b, then SEO; the head says when). One suite at a time, measure each wall time,
  send the numbers to HEAD_CLI-and-testing_2026-11-09 (cc the head). Run: node ~/.claude/scripts/heavy.mjs --wait-min 180 --label "SEO 41: <suite> mutants" -- node scripts/<suite>.mjs --json
- report-live.mjs reading crux and the six importer JSONs: NOT DONE (its own work order). The manifest only orders report-live after them.
- Live paths UNPROVEN: Google serving a repeat PSI request within ~30 s (hence --run-gap-ms 31000), the HTTP status Bing puts on NotAuthorized, crux and Wikipedia live answers, vantage.
- Step-contract breakers by design, not changed: demand-bing and forums (a missing NAMED file is exit 2, test-research asserts it), targets-validate (exit 2 = cannot judge), local (exit 0,
  every part BLOCKED inside its summary). 11 BLOCKED last lines lack ' | unblocks: ' (listed by test-step-contracts section K).
Landing: the head syncs/commits/lands; WO42 and WO43 do not sync. After any further skill commit by me or them: node skills/sync-skill.mjs programmatic-enterprise-web-performance.
- New modules the owner asked for on 2026-11-11 04:27 (WO40 items 15 to 22). Each becomes a pipeline.json step once a skill script
  exists (WO40 B writes one-off scripts in its worktree first):
  - tracking tags and lead measurement (mechanical, from the snapshot)
  - domain history: RDAP, and the Wayback CDX API at 5 s or more apart (mechanical)
  - email trust: SPF, DMARC, MX and the common DKIM selectors from public DNS (mechanical)
  - the lead path walked to the form, never submitted (owner browser)
  - Google review content: dates, replies, topics, no names (owner browser)
  - the competitor trust table with licence numbers (mechanical, once licence detection per industry exists)
  - accessibility basics on the rendered page (mechanical)
  - structured data against NAP (mechanical)
