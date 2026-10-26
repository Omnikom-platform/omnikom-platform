# Upgrade phases (source: UPGRADE-PROMPT.md; Fable review item 5; owner 2026-10-22: phase 1 now, free sources only)

Each phase ends with pasted proof in `runs/<date>-<mode>.md`. Status words: DONE (proof file exists), RUNNING, NOT STARTED, BLOCKED.

## P1 (DONE 2026-10-22; test-phase1 22/22, mutants 6/6 red, test-snapshot 22/22, test-plan-merge 16/16): the router, state, doctor, cache, report, audit-live
- [x] `modes.md`: every mode, stage sequence, inputs, outputs, cost stops; modes of later phases marked NOT BUILT
- [x] `scripts/state.mjs`: where state lives (URL target: `<cwd>/site-checks/<host>/.pewp/` + `snapshots/<date>/`; repo: `<repo>/.pewp/`), state.json read/update
- [x] `scripts/doctor.mjs`: every free source as connected / needs (exact step) / not available -> `.pewp/doctor.json`
- [x] `scripts/cache.mjs`: dated cache for every external response under `.pewp/cache/`
- [x] `scripts/live-target.mjs`: reuse a snapshot younger than 7 days, `--fresh` forces a new one
- [x] `scripts/authority.mjs`: Common Crawl domain authority + referring domains + link gap (port of seo-kit backlinks.mjs)
- [x] `scripts/report-live.mjs`: report.md + report.json, the six questions in order; Q1 from the checker, Q4 from authority, Q2/Q3/Q5 BLOCKED cards with what unblocks them; every number {value, source, fetchedAt, cacheFile}; launchState (preview = not indexable by design)
- [x] `scripts/guard-readonly.mjs`: audit modes never edit source (git status after the run)
- [x] merge.mjs warns on unexpected files under `.checks/`; worker scratch goes to `.checks/tmp/`
- [x] SKILL.md router table + description triggers + free-data policy; coordinator.md modes; test counts from output
- [x] `scripts/test-phase1.mjs` (builds its fixtures in a temp folder: fake snapshot, fake Common Crawl graph, git repo, shipgate pack) with watched-fail mutants; existing tests still pass. The shared `fixtures/` site of review item 21 belongs to P2 (targets, cannibalisation, orphans).
- [x] E2E DONE: `runs/2026-10-22-audit-live.md` on https://valleytovalleyrealty.com (reuse today's snapshot; owner sees the worker count first)

## P2 (BUILT 2026-10-22, real run being fixed): research (free sources) + targets.json validator + plan + S5 target gate
- built by 2 builders; Lead re-ran: test-research 100/100 (builder 32/32 mutants), test-plan-gate 182/182 + 26/26 mutants
- real run 1 on valleytovalleyrealty.com: intake COMPLETE (answers from project knowledge); research exit 3: 29 searches, no measured volume, existing captures not found -> fixes sent (tier estimates from Bing autocomplete, capture folder discovery, intake entity decode)
## P3 (DONE 2026-10-22): refactor (worktree, fix generator, rebuild, check FAIL->PASS)
- proof of the tooling: `node scripts/test-refactor.mjs` (fixture repo, stand-in workers, mutants: 63/63 on 2026-10-22)
- real run: `runs/2026-10-22-refactor.md` (proposals/vtv, batch 1: 10 FIXED, 0 REGRESSED, 1 NOT FIXED, 6 NEEDS-PEOPLE; the Lead's
  independent runner saw 25 checks FAIL->PASS and 0 regressions; merged as e7f791b). Run 1 was UNSAFE and its lessons are in that file.
## P4 (BUILT 2026-10-22, real run in progress): measure + migrate + local
- Lead re-ran test-measure 105/105 (builder 16/16 mutants)
- real migrate run: runs/2026-10-22-migrate.md (86 old URLs, 74 same path, 12 no target; matching fix sent)
## P5 (BUILT as a driver, with P3; real run UNPROVEN): build-mode driver (`test-refactor.mjs --only build`); local built in P4
## Hardening pass (Fable 5.1, 2026-10-22): see the git log of this repo (`hardening:` commits), each with its test or mutant
## Final (owner 2026-10-22): SOP.md
One plain-words standard operating procedure for the whole agency workflow, written after all phases run: what the
SEO analyst did by hand on Francine & Eli (P0.2 market, P0.3 keywords, captures, competitor audit, backlinks, AI answers,
tracker design) + the skill's modes and stages + shipgate's playbooks and spec structure. Each SOP step names the
mode/stage/script that does it and its proof. Then the Fable 5.1 hardening pass in the background.

## Overhaul pass (Fable 5.1, 2026-10-25, branch `overhaul-mode`; brief `~/.claude/briefs/pewp-overhaul-2026-10-25.md`)
- `overhaul <live url> <repo>` mode (`stages/overhaul.md`, start.mjs): the 14-step chain for fixing an existing live site with the OWNER stops; proof: test-start scenario G + mutants.
- Gaps G1 to G22 from the Matter of Place run (keys from a .env file; intake provenance and `classify`; seeds, competitors and the business definition approved by the owner;
  Bing parser proven and a relevance filter; capture receiver + extractor; device mismatch flagged; authority refuses an unapproved list; lab speed marked UNTRUSTED on a busy
  machine + PSI alongside; "page plan" vs "sitemap file"; live findings mapped onto repo causes; Search Console through a service account; plan ack before `--go`; run files
  written by start; multi-region places; the editorial-media industry pack; stale doctor result named; the negative timeout; project inputs asked once; the page plan as a picture).
  Status per gap and the sweep: `runs/2026-10-25-overhaul-gaps.md`; baseline and after counts: `runs/2026-10-25-overhaul-baseline.md`, `runs/2026-10-25-overhaul.md`.

## Fix queue from real runs (Lead, 2026-10-22)
- DONE 2026-10-22 (missed rule, found by the Lead on VTV after 5 refactor batches): sitemap `<lastmod>` was the build time on every URL, so every build said all 79 pages changed (search engines then ignore the field). Fixed in VTV by a committed content-fingerprint ledger (`proposals/vtv/_build/lastmod.json`). In the skill: `scripts/lib-freshness.mjs` + `scripts/check-stability.mjs` (build twice from one commit; any sitemap lastmod / JSON-LD dateModified|datePublished / article:modified_time / og:updated_time / `_headers` Last-Modified that moves = FAIL IDX-003/AEO-012; SE-004 date-only, no timezone, future = FAIL; other differing files WARN; clean checkout restored); refactor.mjs runs it at the baseline (pre-existing = reported, not a regression) and after every merge (a merge that brings build-clock dates is rejected with the plain reason; `--no-stability` = NOT CHECKED; summary line `stability: ...`); run-all-diff `newlyFailing` (cannot judge/missing -> FAIL rejects a fix like a regression; CLI exit 1); merge.mjs copies `checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs` into every audit (format + build-clock signature); fix/check worker prompts: a new artefact meets every checklist rule governing it, dates are content dates; gate GT-013 (`gate-freshness.mjs`, `--build`; build-site passes `--site-build` or `.pewp/builder/build-command.txt`); live sites: snapshot-site records `mainTextHash`, `compare.mjs --freshness` flags lastmod moved with unchanged main text (AEO-012 across snapshots). Proof: `test-freshness.mjs` (+ mutants), `test-refactor.mjs` scenario F + units + mutants.
- refactor.mjs: the main-checkout safety fingerprint covers the WHOLE repo (status + all refs), so any commit or edit elsewhere in a monorepo (another team session, a POSITION update) during a 2-hour run would mark it UNSAFE. Scope it to the site root's paths + the base branch ref; report other changes as notes. (During the 2026-10-22 VTV run the Lead made no project edits.)
- DONE (hardening pass): refactor.mjs cost stop (12 workers per run, most severe first, --max-workers, --yes) has scenario E tests + mutants in test-refactor.mjs.
- research: cwd leak (other site imported this folder's research) sent to the research builder with the extras.
- worktree setup for sites with git-ignored build inputs: the project-side script (E:/Francine & Eli/tools/refactor-setup-vtv.mjs, hard links) worked; document the pattern in stages/refactor.md (junctions leave git worktree remove half-done).
- DONE (hardening pass): the cost stop now runs AFTER the baseline and counts only causes whose checks still fail (batch 2 had run 2 workers of 12 because fixed causes filled the batch); test E + mutant "cost stop counts causes that already pass at the baseline".
- DONE (hardening pass): `refactor.mjs --decisions <file>` (and an auto-found DECISIONS.md) is put in every fix worker's prompt with the order to answer NEEDS-PEOPLE for a held area (C16 added RealEstateListing JSON-LD while DEF-07 holds the client's own listings; the Lead held C16 on branch held/C16-listing-structured-data-DEF-07). The main session passes `--decisions "E:/Francine & Eli/icm/gate-0-1/DEFAULTS.md"` for this project. Test A + mutant "decisions file not given to the worker". The worker's compliance is still a judgement, not a check: a held-area edit that slips through is caught only by the owner's review of the branch.
