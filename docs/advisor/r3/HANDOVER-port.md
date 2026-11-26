# R3 hand-over: port today's omnikom.io advisor to factory/advisor, driven by a pack (step 2 of R3)

Written by ADVISOR-ENGINE (the builder of record) for a helper agent, 2026-11-26. Design: docs/advisor/R2-design.md (sections 2, 4, 5). Worktree: this one; branch advisor/engine.

## Goal (the test is already written and RED)
`node --import ./factory/advisor/r3/ts-hook.mjs factory/advisor/r3/run-cp11.mjs factory/advisor/r3/pack-advisor.mjs C:/Users/DELL/AppData/Local/Temp/claude/a866cf60984337fe/6c9f362a-ddbb-4791-baf2-56b381a0da5d/scratchpad/r3-new`
must print `CP11 RUN PASS: zero graded drops` AND `rows whose reply text differs=0` (byte-identical replies on all 915 rows).
Today it fails: no pack.json. The same runner on the reference (`factory/advisor/r3/reference-advisor.mjs`) already passes with 0 differences; a run takes about 60 s.

## Read only (never edit the lovable repo)
E:/omnikom-wt/lovable/lovable-app/src/lib/: advisor-engine/{engine,matcher,text,slots,cues,library,index,data-chat,data-fit,data-how,data-price,data-services}.ts, claims.ts, advisor-script.ts, helper-routing.ts.
Node 24 imports them directly with `--import ./factory/advisor/r3/ts-hook.mjs` (types are stripped; extensionless imports resolve to .ts).

## Write (only under factory/advisor/)
1. `factory/advisor/pack/convert-omnikom.mjs` (run with the ts-hook): imports the lovable sources read-only and writes `factory/advisor/packs/omnikom-io/pack.json`.
   Deterministic: two runs give identical bytes (no timestamps; stable key order). Format `omnikom-advisor-pack/1`:
   meta { schema: "omnikom-advisor-pack/1", pack: "omnikom-io", client: "omnikom", industry: "cold-calling", version: "0.1.0", source: { repo: "lovable", commit: "<lovable HEAD, read with git rev-parse>" }, report: true, locales: ["en"] },
   flags (today's FLAGS from claims.ts), prices, tuning (TUNING), intents[] (the parsed library: id, label, next, yes, form, svc, ask, variants[{when,text}], phrasings),
   cues[] ({ pattern, flags, intent, delta } from CUES; payLike's patterns too), lexicon (STOP, LEXICON_GROUPS, RAW_LEXICON, fillers, contractions...), slots (every word list, market list, CRM list, number words, biz and service words),
   lists (the engine's word lists and menus: DEFAULT_MENU, vague and deictic words, content-first ids, ...), texts (every reply line that lives in engine code today, keyed by a stable id),
   script (the guided flow: faqChoices, enquiryChoices, every scripted text, choice list and step), routing (helper-routing's word lists and patterns).
   A constant that is not exported may be copied by hand into the converter as data, with a comment naming its source file and line (hand-conversion is allowed here).
2. `factory/advisor/engine/*.mjs`: a faithful port to plain ESM JavaScript of the engine (engine.ts, matcher.ts, text.ts, slots.ts, payLike from cues.ts) and of the guided flow and router
   (advisor-script.ts: getScriptedReply, businessTypeOf, interestOf; helper-routing.ts: isSiteQuestion, flowAccepts, shouldUseEnquiryScript, routeToScript, enquiryChoices).
   Node built-ins only; no dependency; no import from the lovable repo or from r3/. Every user-visible string, word list, regex and number that lives in code today is read from the pack; control logic stays code.
   Export `createAdvisor(pack)` from `factory/advisor/engine/index.mjs`, returning `{ engine, initialState, flow: { faq, enquiry, scripted, site, enquiryScript, route } }` with today's behaviour
   (engine.respond(state, text) -> { state, reply }, engine.observe, engine.intents, engine.stats; initialState(); flow functions with today's signatures). Do not port sessionStorage/window code (saveHandoff, takeHandoff).
3. `factory/advisor/test/no-client-text.mjs`: exits 1 if any file in factory/advisor/engine/ contains "1,299", "omnikom" (any case) or "cold call" (any case), else prints "NO CLIENT TEXT: PASS" and exits 0.
   Watch it fail once by planting such a string in an engine file, see exit 1, restore.

## Acceptance (paste each real output in your return)
a. convert-omnikom.mjs run twice; sha256 of pack.json identical (print it with a small script file, not node -e).
b. The runner line above: `CP11 RUN PASS: zero graded drops` and `rows whose reply text differs=0`.
c. The "sanity (library phrasings, engine only)" line of C:/Users/DELL/AppData/Local/Temp/claude/a866cf60984337fe/6c9f362a-ddbb-4791-baf2-56b381a0da5d/scratchpad/r3-new/harness-output.txt equals the same line in C:/Users/DELL/AppData/Local/Temp/claude/a866cf60984337fe/6c9f362a-ddbb-4791-baf2-56b381a0da5d/scratchpad/r3-ref/harness-output.txt.
d. no-client-text.mjs: exit 0, and the watched fail (exit 1) before restoring.

## Rules
Scripts go in files (never node -e or heredocs). No install, no network, no commit (the builder of record commits). Touch nothing outside factory/advisor/.
Never open or list secret folders (`creds and accounts login`, `.secrets`, `film`, `.tools`, any .env, clients/*/private).
If a call is refused with "the hook did not finish", wait 5 s and retry that call alone. Run the runner one at a time (it is heavy).
If something cannot be ported faithfully, STOP and say so plainly; never fake a pass, never edit run-cp11.mjs, the harness, the baseline or pack-advisor.mjs to make it pass.
Return at most 25 lines: the files written, outputs a to d pasted, anything not faithful or UNPROVEN.
