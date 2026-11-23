# 41 Skill: one step list for a full client audit (pipeline.json), read by start.mjs and by `omnikom seo run`

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/audit-pipeline. Status: OPEN, 2026-11-11 01:40, from the head
of SEO. Ordered by the owner (01:27) through the head of operations.

## Why
The owner: every mechanical, no-AI step of a client audit should run from one CLI call by an agent. The CLI department builds
`omnikom seo run <url> --client <slug>`. The step list is ours, as a manifest in the skill, and the CLI reads it and adds nothing.
The head of operations ruled that there is ONE step list: the skill's own `start.mjs` audit-live mode reads the same manifest,
its own audit-live sequence is removed, and a test fails if the two ever differ.

## Owner's plan and rulings (2026-11-20 and 2026-11-21)
Source: his words M173, M174 (2026-11-20) and M195, M196 (2026-11-21) in `head-of-operations/01-owner-words.md`; the cluster is
`work/map/clusters.tsv` line 10. Status words were checked in the tree on 2026-11-21; the lines that say BUILT 2026-11-22 are the audit
build's, each proven by its test and seeded faults (the slice that landed them). "not checked" means nobody looked.
- STATIONS. The audit's commands are grouped into stations. At each station an agent judges only what was skipped, blocked
  or glitched, and fixes that. The bulk of the run uses no model. BUILT 2026-11-22: `pipeline.json` declares 9 stations in order
  (site, business, demand, search, assistants, local, rivals, standing, report) and every step names one; the rule engine refuses a
  step with no declared station, a station with no step, and a step that depends on a later station. `omnikom seo station <key>`
  writes `{pewp}/stations/sheet.md` and `sheet.json` (only the steps to judge) and exits 0 when every station is CLOSED, 1 when one is
  OPEN; `omnikom seo rule <key> <step> --why .. --by ..` records "not gathered" (never for an approval, a step that ran, or one not
  run yet). BUILT 2026-11-22: the checker's rule-based adapter to `causes.json` (`scripts/checker-rules.mjs`; parts AU.D-6 and
  SS.B-4). RULINGS LET THE RUN GO ON (BUILT 2026-11-22): the runner reads `rulings.json` at `run` and `resume`; a step ruled not
  gathered settles for the steps behind it, a step whose every source is ruled is skipped by rule, a missing input that only a ruled
  source could have written no longer holds a step back, and `seo status` ends `finished: yes, <n> not gathered by ruling`
  (`tools/omnikom-cli/test/seo-run.mjs`, cases R1 to R13). NOT BUILT: readers for eight `capture-*` steps that still wait for a
  person's browser (Google's pages, Maps, reputation, social, ads): until then an agent rules them not gathered and
  resumes the run. The directories have a reader since 2026-11-23 (`scripts/read-directories.mjs`, work browser); its four
  page descriptions in `read-pages.json` are NOT SET, so it reads nothing until they are measured on real pages.
- WORK BROWSER. A browser on a debugging port with its own seeded profile and its own work account, so the clicks are
  scripted and the agent is an employee who only checks at stations. BUILT 2026-11-22: `scripts/work-browser.mjs open | status |
  close` runs the audit profile as a normal Edge window, the port bound to this machine only, the traffic through our US machine; a
  good `Local State` is never rewritten; only an Edge that names the audit profile is ever closed. `scripts/ask-assistants.mjs` asks
  each assistant the two locked texts in one chat (proven on invented pages; `scripts/work-browser-engines.json` holds Perplexity's
  real page description since 2026-11-23, measured with one incognito question on the real page; ChatGPT and Gemini: not set). `scripts/read-bing.mjs` reads Bing's result pages the same way: each distinct query once, in the desktop window
  (the capture says so, and the importer marks the device), never under 45 seconds between loads, nothing typed or clicked; its page
  description in `scripts/read-pages.json` was measured on real Bing pages 2026-11-22 (three searches read live in the work browser,
  no human check; Bing showed no people-also-ask block and no footer place, so those are not set and the captures say not localized). RULES (head of operations, 2026-11-22): a page that tests whether the visitor is a script is a
  robot check, also when it clears by itself. A script that drives the work browser opens its tab plainly: no location override and
  no permission grant, ever (`scripts/test-open-plain.mjs` fails on either call outside the old vantage tool; found 2026-11-22: the
  asking script had opened its tab through that tool's helper, which sets Sacramento; no client was read with it, and the 08:51
  probe below ran without it). Never change the exit, the profile, the user agent, the timing or the way a tab is opened in order to get
  past a check, and no script of ours answers one. Live runs are the head's, never a builder's (`docs/departments/README.md` rule 12).
  A HUMAN CHECK, ChatGPT and Perplexity (owner M255, 2026-11-22 11:43: "why does it stop when I saw GPT waiting for the human
  verification I checked the button"; he answered it by his own hand): when a check shows in a scripted tab the run stops all typing
  and clicking in that tab, leaves the tab open and in front, rings him and waits a few minutes; it never points at, focuses or keys
  the check. If HE answers it the run carries on at the same fixed pace; if nobody answers, the source is not gathered and the audit
  goes on. Once per run and host: a second showing, or a check that comes straight back, closes the tab with a 24 hour stop and no
  second ring. Every other host, Gemini included (the Google rule): close, no retry, a 24 hour stop, the source not gathered with the
  reason. BUILT 2026-11-22: the ring and the wait (`scripts/ask-assistants.mjs`; its cases run in a real browser on invented pages,
  by the head, not on GitHub's list). FOCUS (head of operations, 2026-11-22 18:36): the asking script may tell its tab it has the
  focus, only so that text goes in while the window sits behind the owner's; it is never raised as an answer to a check; the moment
  a human check shows it is switched off before the tab comes to the front, and on again only after he answered; if one assistant
  shows a check on the FIRST prompt in two separate runs with it on, that host is set to `"focus": "front"` in the engines file and
  takes the front for its two prompts. SEEN 2026-11-22 08:51:
  ChatGPT showed its "Just a moment..." page to a scripted tab (it had loaded normally 20 minutes before); its stop was lifted on his
  word at 11:45 the same day (the stop file says so). Google is tried with ONE page first, as
  its own reported step; until then no Google page, Gemini included. NOT BUILT: the real page descriptions of ChatGPT and Gemini,
  Maps, the site reads, the one Google page; the fallback (the two prompts typed at a person's pace by desktop control) only if the scripted
  tabs are refused. The browser extension of M158 is only a fallback for hand driving, not built now.
- PACE (owner M250, 2026-11-22: "we just properly pace the browser driving in order for it to not tigger these checks"; the head of
  operations' reading binds). Pace is a fixed design, not a reaction: one tab at a time, one assistant at a time, a steady typing
  rate and reading pauses, the two prompts in one chat and nothing more per assistant per audit, minutes between assistants, no
  reloads, no retries; the numbers live in one block and nothing in them is random; the pace is the same before and after any check.
  What pace is NOT: a changed or invented user agent, a stealth patch, faked pointer movement, a changed exit, a fresh profile to look
  new: those disguise a script and are not ours. No script of ours ticks or answers a "verify you are human" test, whatever risk is
  accepted. THE LIMIT: ChatGPT challenged a scripted tab on its first page load (2026-11-22 08:51), before any typing, so pace does
  not change that host's answer; the next try is with him at the laptop, so that he can answer a check himself (M255), one page first.
  BUILT 2026-11-22: the pace block in `scripts/work-browser-engines.json`, checked before any page is loaded
  (`scripts/lib-ask-pace.mjs`).
- AI ANSWERS (M174). The assistants' station is the two engineered prompts in one chat per assistant: the one-shot, then the
  follow-up by name; counts with no model. The assistants are THREE: ChatGPT, Gemini, Perplexity (owner M250, 2026-11-22: "copilot
  is just a wrapper for gpt so I think we get rid of it"). BUILT 2026-11-22: `scripts/ai-oneshot.mjs` (build, lock, box, save,
  count) and its prompts; in `pipeline.json` the station is four program steps (`ai-prompt`, `ai-lock`, `ai-ask`, `ai-count`), and
  the run opens the work browser once for `ai-ask` and closes only what it opened. UNPROVEN: an assistant asked by script (no real
  page description is set).
- POOL AND PROFILE. The gathered data is pooled into one organized PROFILE per client, filled from the stations. BUILT
  2026-11-22: `scripts/client-profile.mjs` (the step `client-profile`, station report) writes `{pewp}/profile.json`: every step under
  its station as gathered, not gathered (the script's own line and the ruling) or not applicable, with its files and each file's own
  status and summary. A step skipped because its source was ruled reads as not gathered, never as not applicable. It refuses to
  pool while a station before its own is OPEN.
- MODEL JUDGE. A model judges the profile and writes the JSON that becomes the analysis and the client PDF. BUILT 2026-11-22:
  the step `analysis-judge` (`scripts/judge.mjs`, `judge-brief.md`: one headless model, two asks at most; its answer passes
  `scripts/analysis-shape.mjs` and `scripts/analysis-check.mjs` or nothing is written) and the copy builder
  `scripts/analysis-copy.mjs`, which prints the checked analysis and has no page for what was not gathered. UNPROVEN: on a real
  client's run (seen with a real model on two invented businesses).
- GUARDS. Nothing is said or implied about a source that was not read. Every number the model writes must point to a
  gathered fact, and a script refuses it otherwise. BUILT 2026-11-22: `scripts/analysis-check.mjs`: in the analysis JSON a number or
  a name may stand only as a slot `{{<file>#<path>}}` into a JSON file of a step the profile lists as gathered; a bare digit, a file
  of a step that was not gathered, a path to nothing are refused and nothing is written. NOT checked by any script: what a sentence
  implies.
- INTERNAL SHEET. It lists what was not gathered and why. It is never shown to the client. BUILT 2026-11-22:
  `{pewp}/internal/not-gathered.json` and `.md`, written by `client-profile.mjs`; the client copy's last gate, `internal`, stops a build
  whose page holds one of its lines.
- MISSING SOURCES (his rule, M195). An audit with every source read is always approved. When some were not gathered (his
  example: 9 sources read), the client gets the analysis of what was gathered and is told nothing about what was not read. Missing
  data never makes an audit impossible. This replaces the idea that an entry report waits for the 11 captures from his Edge.
- FLOOR (his rule, M196; the number is M247's, 2026-11-22: "At least 2 analysis pages"). A report goes to a client only with the
  four fixed pages (cover, summary, plan, how we work) and at least 2 analysis pages filled honestly from gathered facts: 6 pages at
  the least, 8 at the most; with fewer it stays an internal draft. BUILT 2026-11-22: no model is asked when fewer than 2 kinds of
  source were gathered; an analysis that fills fewer than 2 analysis pages at least half full ends SKIPPED, an internal draft
  (`scripts/judge.mjs`, `scripts/analysis-shape.mjs`); the copy's gate holds every copy to 6 to 8 sections
  (`scripts/client-copy-gates.mjs`). How full a printed page is, is measured by no script (a line estimate and the head's eye).
- SIGN-OFFS (his ruling, M195). The head signs the business, the seeds, the competitors and any research plan up to 150 requests,
  by this written rule, recorded as delegated. "Cost" means the number of requests to free sources; money is always 0. Above 150
  the run stops for him. Built: `approve.mjs` accepts a delegation stamp and `research` has no `--yes` in the manifest, so a plan
  above 150 stops for a person's signature. BUILT 2026-11-22 (part AU.D-8): `scripts/sign-by-rule.mjs` writes the stamp from
  `scripts/sign-off-rule.json` by calling `approve.mjs`; the three sign-offs and the new step `approve-cost` are program steps.
  UNPROVEN: a whole run over them; `approve-competitors` stays blocked until a step writes the proposed list. The contact line
  on the client's copy is `hello@omnikom.ai` (owner M251, 2026-11-22: one address beside "Tell us to start your draft." on the last
  page, no phone, no name, nowhere else; a call never prints without it; printed by `scripts/analysis-copy.mjs`). His read of each PDF
  before it is sent stays with him (owner item 20).
- ORDER. After the coming-soon page and the owner list, he and the head finish the audit end to end (skill, tools, scripts, CLI);
  the self-serve path (request form, mailing the audit, sign-up from its link) comes after the audit and before clients go live.

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

## Builder status, 2026-11-11 09:25 (sonnet; written by the builder, replaced in place when it changes)
DONE and COMMITTED in the skill repo (outside copy; newest first): 44e39e9 delegated stamp (intake/approve/lib-provenance; live on Paragon) | 44da6f9 ADOPT by default
(lib-pipeline adoptStep/adoptDefault, start.mjs --adopt/--fresh) | 05dbf43 browser profile seed against the Windows lockouts (lib-browser-profile.mjs; live proof: BadPasswordAttempts
0 -> 0 with the seed, 0 -> 1 without) | c1aca68 authority edge cache | report-live section 7 (crux + six importers) | f58e80c licence detection per industry pack (+ footer fix) | 1318d7c topic
filter per pack | 4bd82ba/5461576 BLOCKED form, intake contact | earlier: psi, bing, crux, importers, live-target pointer, city-centres, pipeline.json + lib-pipeline + start, vantage, authority-anchors.
Plain test lines (no mutants): pipeline 147/147, start 145/145, approve 111/111, reports 73/73, step-contracts 41/41, industry 24/24, authority-cache 13/13, topic-filter 14/14, browser-profile 11/11, importers 69/69.
MUTANT RESULTS so far (through heavy.mjs): pipeline 34 of 34 (after retargeting 12 stale patches), importers 24 of 25 (survivor was a test crash, fixed, rerun owed), psi 18/18, bing-refusal 8/8,
crux 12/12; test-plan-gate 64/64 (ran outside heavy by mistake, disclosed). The killed test-start run printed 2 survivors: "a desktop lift frees a script too" (CHECK FIRST: a lift must never
free script mode) and "the runner does not make {work}". By the head's order the remaining mutant suites go to the skill CI job: city-centres, local-nap, intake-contact, topic-filter, industry,
authority-cache, reports group X, browser-profile, step-contracts, start, importers rerun: UNPROVEN until then.
NOT DONE: gap 2 (pipeline.json paths of local-grid-plan, capture-maps, local-grid-import do not match local-grid.mjs: it writes captures/local/grid/requests.json, reads
captures/local/grid/<id>.json, writes local/<date>/grid.json; plus a test that each script step's evidence paths match what its script writes) | pipeline.json kind (stable | time-sensitive |
derived) and maxAgeDays on every step, validator rules, start.mjs modes resume / re-evaluate / fresh (list from the head; wait for the CLI head's OK) | test-browser-leftovers not run (real
browser) | Playwright launches (lib-shots.mjs) are NOT seeded against the lockouts, and the repo tools that launch a browser (tools/site-backup, proc-guard, omnikom-cli/lib/browser.mjs,
client-questions, docs render, apps/dashboard global-setup) are not covered.
UNPROVEN live: the authority cache at real scale (test graph only), Google serving a repeat PSI request within ~30 s, Bing NotAuthorized status, crux and Wikipedia live answers, vantage.
Landing: the head syncs the skill's committed HEAD into skills/ and lands; I do not edit the skill repo while a sync runs.
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
