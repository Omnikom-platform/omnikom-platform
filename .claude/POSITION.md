## Block 2026-11-26 20:30 (this is the current block)

Session ADVISOR-ENGINE_code-mode (Code Mode, Opus 5.5). Head: HEAD-OF-OPERATIONS_Fable_2026-11-11 (SendMessage, 8-line reports, paths only).
R2 ACCEPTED by the head 20:45 (commit 080f4ff1). Rulings (write into R2/ADRs in place):
1 Code home factory/advisor/ in code/main. omnikom.io (lovable repo) takes the BUILT engine+UI as ONE versioned file, sha256 pinned, plus a check that the copy equals the release; never a second source.
2 VTV is NOT parked behind M4: hand-convert VTV's pack from clients/vtv/facts.md + the live site's signed text. MISSING = "unknown + the form". Live on VTV = preview, then owner's go + Francine's OK.
  Lawyer wording rides on her question 11, does not hold the build. The email to Francine (via Dave) is NOT sent yet; it waits for the owner's send.
3 VTV hand-off: form now; handoff(booking) to her Calendly when her answer to question 6 arrives; leave a slot for it in the pack schema now.
4 First version: no calendar gates. Bar to live = R3 zero graded drops on cp11 + head's held-back run + O1-O15 green on a preview + owner's look; old engine = one-step rollback; then the whole live test.
  Shadow and small share only for later pack versions, and only if the session report is on.
5 OWNER 20:50: session report ON for omnikom.io only (redacted in browser: emails, phones, runs of 5+ digits, the name slot; 30 days; GPC honoured) + one line on omnikom.io's privacy page
  (I write its exact words to the head; OMNIKOM-IO-SITE applies it). Client sites incl. VTV: report OFF until that client's privacy page covers it. Engine works fully with it OFF (default OFF).
6 OWNER 20:50 deps YES: XState 5.33.x, MiniSearch, Orama (race only; loser removed), @xstate/graph + fast-check 4.10.x (dev only). Read ~/.claude/reference/supply-chain-2026-10.md first:
  each version >= 7 days old, none on never-install list, lockfile committed, install scripts off. StrykerJS NO: use the repo's mutant pattern ("MUTANTS PASS n of n", skills/.../lib-test-kit.mjs main()).
  Playwright: reuse what .github/workflows/flows.yml does; no new browser download.
7 R3 report adds: which of cp11's 29 FAIL rows turn to PASS (a list).
8 OMNIKOM-IO-SITE lane changes (lead.js advisor mark, handoff adapter): the head hands them over when build jobs start; never edit the lovable repo.
GO for R3 (20:50). Harness: E:/Omnikom Platform/head-of-operations/domains/omnikom-io-advisor/test-2026-11-25/harness-current/harness.mjs; baseline checkpoints/cp11-results.jsonl.
DONE since: rulings in R2 (section 24) + ADRs; privacy-page words sent to the head 20:35; R3 step 1 committed e6db786: factory/advisor/r3/run-cp11.mjs reproduces cp11 exactly on today's engine
(915 rows, 0 graded changes, 0 text diffs); watched-fail mutant-advisor.mjs -> 15 rows PASS->FAIL, exit 1.
STATUS 21:30 (R3 step 2; all UNCOMMITTED in this worktree):
- deps installed through heavy.mjs (--ignore-scripts, exact): xstate 5.33.4, minisearch 7.2.0, @orama/orama 3.1.18; dev @xstate/graph 3.0.4, fast-check 4.10.3 (+pure-rand 8.4.2). osv-scanner: 6 packages, no issues; no worm files.
- port verified by my own re-run: converter twice same sha; NO CLIENT TEXT PASS; run-cp11 on r3/pack-advisor.mjs: CP11 RUN PASS, 0 graded changes, 0 text diffs; planted $999 -> 13 worse, exit 1.
- validator pack/validate.mjs + test/test-validate.mjs: 28 of 28, MUTANTS 12 of 12 (RX_*: every $rx in a pack gets the cue rules of R2 5.2).
- VTV pack packs/vtv/{source.mjs,pack.json}: PACK VALID, sha 2b5134a6...; 3 planted faults each exit 1.
- omnikom-io pack: seat totals scrubbed at conversion (C-26), MONEY 0; was PACK INVALID 34 = 26 cue rows (5 patterns) + 8 engine rx (look-behind, nested repeat, back-reference).
  FIXED 21:40: pack/rewrites.mjs (13 rule-clean equivalents) proven by test/test-rewrites.mjs: 43 of 43, MUTANTS 6 of 6; engine/split.mjs splitKeep, text.mjs doubledEnd.
  omnikom-io pack now PACK VALID (sha 4951b5dd..., same over 2 runs); run-cp11: CP11 RUN PASS, 0 graded changes, 0 text diffs.
- HEAD 21:48 ruling A: Vite 8.3.5 exactly as apps/dashboard pins it, in factory/advisor devDependencies, --ignore-scripts, lockfile committed, osv-scanner again, through heavy.mjs.
  Order: job 3 (intent ids into a pack table, cp11 at 0 diffs) first, then the race and XState. R3 report must list which of the 29 FAIL rows turn PASS, or say plainly that R3 moves none (0 of 29 so far).
- HEAD 21:53 order: job 3 -> matcher race -> job 4 (VTV in the engine: English base layer, 5.1 compiler, slot readers by type) -> XState flows.
  Job 4's written hand-over goes with job 3's report, with its size. (21:52 I told the head job 3 alone does not run VTV.)
- JOB 3 (21:55): red test = test/no-client-text.mjs extended to intent ids + families: FAIL 72 (engine.mjs 71, matcher.mjs 1).
  Guard: test/golden-turns.mjs + golden-turns.json (multi-turn hashes from the engine at cea2d9d), coverage-checked with NODE_V8_COVERAGE.
- JOB 3 DONE 22:05 (commit below): pack.steer + validator STEER_* (34 of 34, 16 of 16); NO CLIENT TEXT PASS; GOLDEN 10765 of 10765
  (3 mutants red); cp11 0 graded / 0 text diffs, FAIL->PASS 0; pack sha c6cb7faa... NEXT: job 4 hand-over (written, sized) + report, then the race.
- (was) OPEN for the head: bundler not approved -> byte sizes UNPROVEN; VTV through the engine needs a generic path (intent ids hard-coded in engine.mjs).
NOW (R3 step 2): pack-driven port, hand-over docs/advisor/r3/HANDOVER-port.md, given to a helper agent (Sonnet) 20:45; red test = run-cp11 on factory/advisor/r3/pack-advisor.mjs (fails: no pack.json).
Then: verify its outputs myself; validator + tests + mutants (lib-test-kit pattern); VTV pack (clients/vtv/facts.md + live site's signed text; booking slot for Calendly);
then deps install (supply-chain rules read: >=7 days, never-install list, lockfile, --ignore-scripts, osv-scanner) and the MiniSearch vs Orama race + XState; R3 report lists cp11 FAIL->PASS rows.
Open question for the head later: a bundler for the "one built file" (esbuild is not on the approved list).

## Block 2026-11-26 20:00 (superseded)

Session ADVISOR-ENGINE_code-mode (Code Mode, Opus 5.5). Head: HEAD-OF-OPERATIONS_Fable_2026-11-11 (SendMessage, 8-line reports, paths only).
R1 ACCEPTED by the head 18:46; rulings written into docs/advisor/R1-research.md in place (cp11 baseline, own slot fill, Orama vs MiniSearch race in R3,
fast-check 4.10.x, osv-scanner at R3 via the head, preload to OMNIKOM-IO-SITE via the head). Charter: docs/advisor/ added to docs/departments/platform-build.md Owns.
Owner M319 via head: Rasa + Dialogflow CX patterns (not runtimes), both sites, an end-to-end plan per site.
Round now: R2 Design DONE, waiting on the head's critique: docs/advisor/R2-design.md + docs/advisor/adr/001..011; scripts docs/advisor/r2/.
Second pass (M298) done: fresh unit-reviewer agent, 20 findings; main ones checked against source by me (claims.ts C-26, engine.ts order and boost,
lovable-app/deploy/lib/lead.js:18-19, facts "Question:" line, browsers); all fixed in R2 + ADRs 002 003 004 006 008 009 010 011 (R2 section 23).
Quotes: verify-quotes on quotes-r2.mjs exit 0, 33 FOUND, 2 NOT FOUND (both B&P 17941, HTTP 403 bot wall, not bypassed).
Pack stand-in incl. cues.ts + slots.ts: 61,278 B gzip (upper bound): only MiniSearch's path fits the 125 KB budget unless the real pack is ~10 KB smaller.
UNPROVEN: every R2 budget target; XState machine from pack JSON; cross-browser score equality; real pack size; cues.ts conversion with zero drops; B&P 17941 word for word.
BLOCKED: nothing for R2. Open for the head: session report (owner decision), code home factory/advisor/, change requests in OMNIKOM-IO-SITE's lane
(advisor mark on leads in lead.js, hand-off event adapter), C-26 hidden, rollout numbers, VTV single-turn set, dependencies needing the owner's yes.
Machine note: the PreToolUse hook pre-tool-use.sh sometimes times out ("the hook did not finish"); retrying after a pause works.
Next: wait for the head's critique and revise; R3 only after the head's GO; any dependency needs the owner's yes. Commit is local on advisor/engine, not pushed.

## Block 2026-11-26 19:40 (superseded)

Session ADVISOR-ENGINE_code-mode (Code Mode, Opus 5.5). Head: HEAD-OF-OPERATIONS_Fable_2026-11-11 (SendMessage, 8-line reports, paths only).
R1 ACCEPTED by the head 18:46 with rulings, now written into docs/advisor/R1-research.md in place:
cp11-results.jsonl (915 rows) is the baseline (cp7 superseded); no mustache.js (own slot fill, tests from the Mustache spec cases used);
Orama vs MiniSearch race in R3 (graded drops first, then bytes); fast-check pinned 4.10.x; osv-scanner at R3 (the head asks the owner);
the omnikom.io card preload goes to OMNIKOM-IO-SITE from the head. Charter: docs/advisor/ added to docs/departments/platform-build.md Owns (head's order).
Owner M319 via head: take Rasa + Dialogflow CX patterns (not runtimes), cover omnikom.io AND VTV, an end-to-end test plan per site.
Round now: R2 Design WRITTEN: docs/advisor/R2-design.md + docs/advisor/adr/001..011. Scripts: docs/advisor/r2/ (tally-baseline, measure-pack-proxy,
snippets, quotes-r2). Quote check: node docs/advisor/r1/verify-quotes.mjs docs/advisor/r2/quotes-r2.mjs r2-quotes.json.
Second independent pass (M298): a fresh reviewer agent checks R2 before the report; its findings get fixed, then commit, then the 8-line report.
UNPROVEN: every R2 budget target; XState machine built from pack JSON; cross-browser score equality; real pack size (stand-in 37,453 B gzip);
B&P 17941 quote word for word (leginfo and Justia both HTTP 403 = bot wall, not bypassed; two routes, stopped).
BLOCKED: nothing for R2. Machine note: the PreToolUse hook pre-tool-use.sh sometimes times out ("the hook did not finish"); retrying after a pause works.
Next: fix review findings, gitleaks, commit, report R2 to the head; R3 only after the head's GO; any dependency needs the owner's yes.

## Block 2026-11-26 16:35 (superseded)

Session ADVISOR-ENGINE_code-mode (Code Mode, Opus 5.5). Head: HEAD-OF-OPERATIONS_Fable_2026-11-11 (SendMessage, 8-line reports).
Round now: R1 Research WRITTEN, waiting on the head's critique. File: docs/advisor/R1-research.md; scripts and outputs: docs/advisor/r1/.
Branch advisor/engine (from cbf0b4bf), committed locally, not pushed. Nothing built, nothing installed, nothing deployed.
Picks (proposed): XState 5 (dialogue state), Orama 3 (matching; MiniSearch challenger), Mustache-syntax approved texts through one render() + claims gate, own small entity parsers; dev: @xstate/graph, fast-check, StrykerJS. Libraries 41.5 KB gzip vs live engine chunk 67,459 B gzip.
Open for the head: live baseline (cp7 named in the brief vs newer up to cp11); mustache.js ruling (not maintained); Orama vs MiniSearch; live omnikom.io home page modulepreloads assistant-card (57,865 B gzip) before the chat opens (site is OMNIKOM-IO-SITE's).
UNPROVEN: phone speed, cross-browser score equality, tree-shaken sizes, own code + pack bytes, LCP effect of the preload, XState docs quote word for word, GUS primary text. BLOCKED: nothing.
Next: revise R1 per the head; R2 (design + ADRs) only after the head accepts R1, reading the facts file in full first.

## Block 2026-11-25 19:20 (superseded)

Session ADVISOR-ENGINE_code-mode (Code Mode, Opus 5.5 xhigh), made by the head of operations on the owner's M310.
Brief: E:\Omnikom Platform\head-of-operations\briefs\ADVISOR-ENGINE.md (read once at the start).
Head: HEAD-OF-OPERATIONS_Fable_2026-11-11 (SendMessage; 8-line reports at round ends and blockers).
Round now: R1 Research (docs/advisor/R1-research.md), not started.
Branch: advisor/engine (to make). Nothing built, nothing installed, nothing deployed.
