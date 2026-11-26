# R1 research: the site assistant engine

Round R1 of `head-of-operations/briefs/ADVISOR-ENGINE.md`: research only, no product code. Branch `advisor/engine`.
Measured 2026-11-26 from this machine. Every number below comes from a script in `docs/advisor/r1/`, and its output is in `docs/advisor/r1/out/`.
Nothing was installed. Every library ran from jsDelivr in a throwaway headless Chrome profile.

## In short

- **Picks.**
  - Dialogue state: **XState 5** (MIT, 14.5 KB gzip).
  - Matching a question to an intent or an approved answer: **Orama 3** (Apache-2.0, 24.4 KB gzip). MiniSearch (5.7 KB) is the challenger.
  - Reply: **approved claim texts with Mustache-syntax slots**, going through one `render()` and the claims gate. mustache.js is 2.6 KB and needs a ruling, because it is not maintained.
  - Entities: our own small parsers plus the pack's word lists.
  - Tests: the existing harness, whole-conversation stories, `@xstate/graph` paths, fast-check and StrykerJS. All are dev only.
  - Learning loop: Wallace's "Targeting" and Rasa's conversation-driven development as the method. DESIGN ONLY.
- **Bytes.**
  - The picked libraries total 41.5 KB gzip (bundlephobia) or 44.7 KB (jsDelivr).
  - The live engine chunk today is 67,459 B gzip. The card chunk is another 57,865 B gzip.
  - Our own code and the pack: UNPROVEN until R3.
- **Not maintained, measured two ways:** MiniSearch, mustache.js, RiveScript, NLP.js, wink-nlp, Lunr, all AIML JS engines, SuperScript, Snips.
- **Outside R1, for the head:**
  - The live omnikom.io home page preloads the assistant card (57,865 B gzip) before the chat is opened.
  - Botium runs an install script.
  - fast-check 4.11.0 is under 7 days old.
  - Rasa Open Source is in maintenance mode.

## (a) The history and its lessons

Each quote below was found word for word on the page named, by `node docs/advisor/r1/verify-quotes.mjs`: 61 of 62 found (the one miss is in part d).

| System | What it did | Source (quote checked) | Lesson for us |
|---|---|---|---|
| ELIZA (Weizenbaum, 1966) | Keywords ranked by a number; the conversation rules sit apart from the program | UMBC copy of the paper: "a script is data", "RANK or precedence number"; Wikipedia ELIZA: "keystack" | **One engine, one data pack per client** is a 60-year-old idea. Matches are ranked, never first-come. |
| The ELIZA effect | People believe a simple program understands them | Wikipedia "ELIZA effect": "read far more understanding than is warranted into strings of symbols" | Say plainly that it is an assistant (B&P 17940-17943). Never let the voice suggest understanding the facts do not back. |
| ALICE and AIML (Wallace, from 1995); Pandorabots | Knowledge as "categories" (a pattern plus a template). The botmaster improved it by reading what it missed | AIML 2.0 spec: "The basic unit of knowledge in AIML is a category"; Wallace's 2002 ILC page: "a cyclical process of supervised learning called Targeting", unmatched inputs "logged by the bot and delivered as Targets"; Wikipedia: "won the Loebner Prize in 2000, 2001, and 2004" | **Our learning loop is Targeting**: missed questions are logged, and a human writes the new rule. Pandorabots is the hosted AIML service, so it is a server dependency and fails constraints 1 and 4. |
| SmarterChild (ActiveBuddy, later Colloquis, 2001) | An instant-messaging bot on AIM, MSN and Yahoo | Wikipedia: "ActiveBuddy", "June 2001", "attracting over 30 million Instant Messenger \"buddies\"" (read in context), "Microsoft acquired Colloquis in October 2006" | A scripted bot reached tens of millions of people as a product before any learned model. |
| ChatScript (Wilcox) | Topics, and "concepts" (named word lists) instead of hand-written patterns | Paper "Winning the Loebners": "ChatScript is an NLP expert system", "organized into bundles called topics", "declare a list of words or phrases to be a concept"; SourceForge wiki: "2010 Loebner Prize with Suzette", "2011 Loebner with Rosette", "2014 Loebner Prize with Rose" | **Concepts replace regex.** Today's `cues.ts` (1,422 lines of regex) becomes word lists in the pack. Topics become sections of the pack. The engine itself is a C++ server, so it is not usable here (part b). |
| Mitsuku / Kuki (Worswick) | Loebner winner five times; learning only under a human | Guinness: "won the Loebner Prize in 2013, 2016, 2017, 2018 and 2019"; AISB: "fourth consecutive year"; kuki.ai/research: "does not learn globally without a human supervisor", "originally created by Steve Worswick" | **Never learn without a human.** UNSOURCED: a first-hand quote that Worswick read the logs every day (the helpers found only second-hand retellings), so it is not used as a fact. |
| GUS (Bobrow et al., 1977) | Frame-based slot filling: the system keeps a form, and each empty slot has its own question | Survey arXiv 2202.03164 (ar5iv): "GUS", "each with an associated question", "mixed initiative". Primary paper: DOI 10.1016/0004-3702(77)90018-2, PDF not read | **Qualification is a frame.** Each slot (team size, market, timing) has its approved question. A visitor may answer out of order (mixed initiative). |
| Rasa: conversation-driven development | Read real conversations, turn them into tests, then improve | Rasa blog: "the process of listening to your users and using those insights", "Take time to read through the conversations people have with your assistant", "Use whole conversations as end-to-end tests", "Give your prototype to users to test as early as possible" | **Whole conversations are the tests.** That is our harness plus stories. |
| Rasa today | | README: "Rasa Open Source is currently in maintenance mode"; Rasa X: "the last free version of Rasa X"; Rasa Pro: "up to 1,000 conversations per month" | It is a Python server, in maintenance, and the paid tier is metered. We take the method, not the software. |
| Dialogflow CX (Google) | Flows and pages as a state machine; ordered route handlers; frozen versions; traffic experiments | CX docs: "The states of a session are represented by pages", "define route groups", "Handlers are evaluated in a specific order", "immutable snapshot", "allocate a portion of live traffic"; pricing page: Flows chat "$0.007 / 1 count" | **Pages map to statechart states.** Each pack version is a frozen snapshot, and a new rule reaches a small share of visitors first. CX charges per request, so it fails constraint 1. |
| Tay (Microsoft, 2016) | Learned live from the public and was taken down | Microsoft blog: "a coordinated attack by a subset of people exploited a vulnerability in Tay"; Wikipedia: "16 hours" | **Nothing learns live.** Every rule goes through offline tests, then shadow, then a small share of visitors, with an approver and a one-step rollback. |

**The lessons, as the rules R2 designs against:**
1. One engine plus a data pack per client (ELIZA, AIML, ChatScript).
2. Word lists (concepts) instead of regex (ChatScript).
3. A frame with one question per slot, answered in any order (GUS).
4. A statechart with ordered handlers (CX).
5. Frozen pack versions and small-share rollout (CX).
6. Misses logged, and a human writes the rule (Targeting, Kuki).
7. Whole conversations as tests (Rasa CDD).
8. Nothing learns live (Tay).
9. Say it is an assistant and do not overclaim (the ELIZA effect).

## (b) Candidate technologies that run today

The table is printed by `node docs/advisor/r1/make-table.mjs candidates` from `out/repos.json` (made by `node docs/advisor/r1/measure-repos.mjs`, GitHub GraphQL + REST, npm and PyPI registries, jsDelivr and bundlephobia, 2026-11-26) and `out/browser-smoke.json` (made by `node docs/advisor/r1/run-browser-smoke.mjs`).

How to read the columns:
- "Commits / humans" counts the default branch over the last 365 days, with bots left out.
- "Browser measured" means that package was loaded and called twice in Chrome (table below).
- The "documented" column is what the project's own docs say. MiniSearch's claim was checked word for word.
- Bytes are gzip: jsDelivr's `+esm` build with its imports, and bundlephobia's minified build.

| Candidate (layer) | Repository | Written in; human languages | Licence: registry / LICENSE file | Newest release | Registry releases, 12 months | Last commit | Commits / humans, 12 months | Open issues / PRs | Registry maintainers | Browser: measured / documented | gzip KB: jsDelivr / bundlephobia | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nlpjs (understanding) (+@nlpjs/basic, @nlpjs/core, @nlpjs/lang-en-min, node-nlp) | [axa-group/nlp.js](https://github.com/axa-group/nlp.js) | JS; "40 languages natively supported" | MIT / MIT | @nlpjs/nlp 5.0.0-alpha.5 (2025-01-23) | 0 | 2024-03-21 | 0 / 0 | 80 / 35 | 3 | RUNS / yes, after a bundling step | 38.9 / 29.4 | DROP: dormant (no commit since 2024-03-21; its latest tag is an alpha); neural classifier |
| rivescript (understanding+reply) | [aichaos/rivescript-js](https://github.com/aichaos/rivescript-js) | JS | MIT / MIT | rivescript 2.2.1 (2022-11-24) | 0 | 2022-11-26 | 0 / 0 | 56 / 8 | 1 | RUNS / yes | 86.2 / 13.1 | DROP as runtime: dormant since 2022; random reply choice (measured) |
| chatscript (understanding+dialogue+reply) | [ChatScript/ChatScript](https://github.com/ChatScript/ChatScript) | C++ | - / MIT | GitHub 14.1 2024-05-06 | - | 2024-05-06 | 0 / 0 | 9 / 0 | - | not run / no (C++ server) | - | DROP as runtime: server only; ideas kept |
| aimlinterpreter (understanding+reply) | [B3nRa/AIML.js](https://github.com/B3nRa/AIML.js) | JS | BSD (version not stated) / no file found | aimlinterpreter 0.1.7 (2015-07-27) | 0 | 2016-08-01 | 0 / 0 | 9 / 1 | 1 | FAILS / Node only | 97.1 / 9.8 | DEAD: fails in the browser |
| aiml-high (understanding+reply) | [gleuch/aiml-high](https://github.com/gleuch/aiml-high) | JS | MIT / no file found | aiml-high 0.0.8 (2016-02-19) | 0 | ARCHIVED, 2016-02-19 | 0 / 0 | 4 / 0 | 1 | FAILS / Node only | - / 10.4 | DEAD: archived; fails in the browser |
| program-y (understanding+reply) | [keiffster/program-y](https://github.com/keiffster/program-y) | Python | MIT / MIT | programy 5.0.1 (2021-05-27) | 0 | 2024-01-07 | 0 / 0 | 18 / 5 | - | not run / no (Python server) | - | DEAD for us: Python server, no release since 2021 |
| superscript (understanding+dialogue+reply) | [superscriptjs/superscript](https://github.com/superscriptjs/superscript) | JS | MIT / MIT | superscript 1.1.4 (2017-10-06) | 0 | 2019-03-06 | 0 / 0 | 49 / 5 | 2 | FAILS / Node only | - / 378.1 | DEAD: fails in the browser |
| rasa (all (server)) | [RasaHQ/rasa](https://github.com/RasaHQ/rasa) | Python | Apache-2.0 / Apache-2.0 | rasa 3.6.21 (2025-01-14) | 0 | 2025-12-18 | 2 / 1 | 12 / 149 | - | not run / no (Python server) | - | DROP as runtime: server; maintenance mode; ideas kept |
| botpress-v12 (all (server)) | [botpress/v12](https://github.com/botpress/v12) | TypeScript | - / AGPL-3.0 | GitHub v12.31.10 2025-04-10 | - | 2025-04-07 | 0 / 0 | 173 / 8 | - | not run / no (server) | - | DROP: AGPL-3.0, server |
| botpress (all (cloud)) | [botpress/botpress](https://github.com/botpress/botpress) | TypeScript | - / MIT | GitHub v12.30.9 2023-06-22 | - | 2026-11-23 | 730 / 23 | 18 / 40 | - | not run / no (cloud platform) | - | DROP: cloud platform, not a browser engine |
| xstate (dialogue state) (+@xstate/graph) | [statelyai/xstate](https://github.com/statelyai/xstate) | TypeScript; no language rules | MIT / MIT | xstate 5.33.4 (2026-11-07) | 95 | 2026-11-24 | 657 / 13 | 40 / 46 | 3 | RUNS / CDN import in docs (not checked word for word) | 15.4 / 14.5 | PICK: dialogue state (and @xstate/graph for tests) |
| wink-nlp (understanding) | [winkjs/wink-nlp](https://github.com/winkjs/wink-nlp) | JS; English model | MIT / MIT | wink-nlp 2.4.0 (2025-06-30) | 0 | 2025-06-30 | 0 / 0 | 1 / 3 | 1 | RUNS / yes | 13.2 / 11.5 | DROP for phones: model is 1 MB gzip |
| wink-model (understanding) | [winkjs/wink-eng-lite-web-model](https://github.com/winkjs/wink-eng-lite-web-model) | English | MIT / MIT | wink-eng-lite-web-model 1.8.1 (2024-11-30) | 0 | 2024-11-30 | 0 / 0 | 1 / 0 | 1 | not run / yes | 1012.1 / 1010.1 | DROP (see wink-nlp) |
| compromise (understanding) | [spencermountain/compromise](https://github.com/spencermountain/compromise) | JS; English (Spanish, French, Italian as separate libraries) | MIT / MIT | compromise 14.20.0 (2026-11-08) | 8 | 2026-11-08 | 468 / 5 | 94 / 0 | 3 | RUNS / yes | 158.2 / 148.9 | DROP for phones: about 150 KB gzip for 2 features |
| natural (understanding) | [NaturalNode/natural](https://github.com/NaturalNode/natural) | JS (Node) | MIT / MIT | natural 8.2.6 (2026-10-26) | 9 | 2026-10-26 | 31 / 8 | 79 / 9 | 3 | FAILS / Node only | 2823.9 / 2058.5 | DROP: Node library, fails in the browser, 2 MB |
| tracery (reply) | [galaxykate/tracery](https://github.com/galaxykate/tracery) | JS; no language rules | ISC / Apache-2.0 | tracery-grammar 2.8.4 (2024-11-18) | 0 | 2024-11-03 | 0 / 0 | 21 / 11 | 1 | RUNS / yes (script tag) | 3.5 / 3.2 | DROP: random; composes unapproved sentences |
| mustache (reply) | [janl/mustache.js](https://github.com/janl/mustache.js) | JS; no language rules | MIT / MIT | mustache 4.2.0 (2021-03-28) | 0 | 2023-01-21 | 0 / 0 | 84 / 42 | 3 | RUNS / yes | 2.9 / 2.6 | PICK, needs a ruling: reply slots; not maintained |
| minisearch (retrieval) | [lucaong/minisearch](https://github.com/lucaong/minisearch) | JS; any; "No stemming is performed" | MIT / MIT | minisearch 7.2.0 (2025-09-16) | 0 | 2025-09-16 | 0 / 0 | 9 / 5 | 1 | RUNS / yes (quote checked) | 6.2 / 5.7 | CHALLENGER in R3: smallest; not maintained |
| fuse (retrieval) | [krisk/Fuse](https://github.com/krisk/Fuse) | TypeScript; matches characters | Apache-2.0 / Apache-2.0 | fuse.js 7.5.0 (2026-07-13) | 21 | 2026-11-24 | 238 / 13 | 1 / 2 | 1 | RUNS / yes | 9.9 / 9.4 | RESERVE: fuzzy match of short labels |
| orama (retrieval) | [oramasearch/orama](https://github.com/oramasearch/orama) | TypeScript; "Stemming and tokenization in 30 languages" | Apache-2.0 / Apache-2.0 | @orama/orama 3.1.18 (2025-12-19) | 2 | 2026-07-03 | 16 / 7 | 19 / 19 | 2 | RUNS / yes | 26.4 / 24.4 | PICK: matching questions and answers |
| flexsearch (retrieval) | [nextapps-de/flexsearch](https://github.com/nextapps-de/flexsearch) | JS; language encoder presets | Apache-2.0 / Apache-2.0 | flexsearch 0.8.212 (2025-09-06) | 0 | 2026-05-29 | 10 / 3 | 30 / 10 | 1 | RUNS / yes | 17.7 / 16.8 | DROP: returns no scores (measured) |
| lunr (retrieval) | [olivernn/lunr.js](https://github.com/olivernn/lunr.js) | JS; "14 languages" | MIT / MIT | lunr 2.3.9 (2020-08-19) | 0 | 2020-08-19 | 0 / 0 | 105 / 25 | 1 | RUNS / yes | 8.6 / 8.3 | DEAD: last release 2020 |
| chrono (understanding (dates)) | [wanasit/chrono](https://github.com/wanasit/chrono) | TypeScript; English, fi, fr, id, it, ja, nl, ru, uk, vi | MIT / MIT | chrono-node 2.10.3 (2026-10-12) | 6 | 2026-11-03 | 117 / 25 | 120 / 34 | 1 | RUNS / not stated | 52.4 / 48.1 | NOT NEEDED: the chat books no times |
| libphonenumber (understanding (phones)) | [catamphetamine/libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) | JS | MIT / MIT | libphonenumber-js 1.13.17 (2026-11-19) | 31 | 2026-11-10 | 16 / 1 | 36 / 2 | 1 | RUNS / yes (script tag) | 44.6 / 45.4 | NOT NEEDED NOW: the chat takes no phone numbers |
| botium (test) | [codeforequity-at/botium-core](https://github.com/codeforequity-at/botium-core) | JS | MIT / MIT | botium-core 1.15.19 (2026-11-09) | 11 | 2026-11-09 | 66 / 7 | 22 / 0 | 1 | not run / no (Node tool) | dev tool, not shipped | DROP: install script; harness exists |
| stryker (test (mutants)) | [stryker-mutator/stryker-js](https://github.com/stryker-mutator/stryker-js) | TypeScript | Apache-2.0 / Apache-2.0 | @stryker-mutator/core 10.1.1 (2026-10-23) | 6 | 2026-10-29 | 504 / 8 | 91 / 66 | 3 | not run / no (Node tool) | dev tool, not shipped | PICK: mutants (dev only) |
| fast-check (test (properties)) | [dubzzz/fast-check](https://github.com/dubzzz/fast-check) | TypeScript | MIT / MIT | fast-check 4.11.0 (2026-11-21) | 14 | 2026-11-26 | 1068 / 2 | 30 / 28 | 1 | not run / no (Node tool) | dev tool, not shipped | PICK: property tests (dev only); 4.11.0 is under 7 days old |
| presidio (learning (PII)) | [microsoft/presidio](https://github.com/microsoft/presidio) | Python | MIT / MIT | presidio-analyzer 2.2.366 (2026-10-27) | 6 | 2026-11-24 | 285 / 52 | 126 / 207 | - | not run / no (Python service) | - | DESIGN ONLY: offline PII step candidate |
| snips-nlu (understanding) | [snipsco/snips-nlu](https://github.com/snipsco/snips-nlu) | Python | Apache-2.0 / Apache-2.0 | snips-nlu 0.20.2 (2020-01-15) | 0 | 2021-05-03 | 0 / 0 | 66 / 2 | - | not run / no (Python) | - | DEAD: last release 2020 |
| duckling (understanding (entities)) | [facebook/duckling](https://github.com/facebook/duckling) | Haskell | - / BSD-3-Clause | GitHub v0.2.0.0 2021-04-16 | - | 2026-03-15 | 2 / 2 | 125 / 15 | - | not run / no (Haskell server) | - | DROP: Haskell server |
**Dropped as dead, and why:**
- aimlinterpreter, aiml-high and SuperScript: no release since 2015–2017, and all three fail in the browser.
- program-y and Snips NLU: Python, no release since 2021 and 2020.
- Lunr: no commit or release since 2020-08-19.
- Botpress v12: AGPL-3.0, and a server.

**Dropped as alive but wrong for us:**
- Rasa and ChatScript: servers.
- Botpress: a cloud platform.
- natural: a Node library; fails in the browser and is 2 MB.
- compromise: 149 KB.
- The wink model: 1 MB.
- Tracery and RiveScript: they choose replies at random, measured below.
- FlexSearch: returns ids with no score, and we need scores for the answer/clarify band.
- Botium: an install script, `postinstall: node ./report.js`.

**The browser run** (`node docs/advisor/r1/run-browser-smoke.mjs`, pasted from `out/browser-smoke.json`). Each call ran twice in one page. The ms figures are not reported, because `--virtual-time-budget` makes the clock virtual.

Browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/158.0.0.0 Safari/537.36
| Call | Result | Same output twice | Output (or error) |
|---|---|---|---|
| minisearch | RUNS | true | `[[4,10.8484]]` |
| fuse.js | RUNS | true | `[[4,0.65]]` |
| @orama/orama | RUNS | true | `[["4",0.7842]]` |
| flexsearch | RUNS | true | `[4]` |
| lunr | RUNS | true | `[["4",1.394]]` |
| xstate | RUNS | true | `["plan",12,"done"]` |
| @xstate/graph | RUNS | true | `["xstate.init","xstate.init>N","xstate.init>S"]` |
| rivescript | RUNS | true | `{"memory":["Nice to meet you, Sam.","Your name is Sam."],"distinctRepliesOf30":3}` |
| nlpjs | RUNS | true | `["price","price:1.0000000000,book:0.0000000000,area:0.0000000000"]` |
| wink-nlp | RUNS | true | `{"entities":[{"value":"12","type":"CARDINAL"},{"value":"sam@example.com","type":"EMAIL"},{"value":"next Tuesday","type":"DATE"}],"stems":["i","run","12","caller` |
| compromise | RUNS | true | `{"values":["twelve"],"places":["Texas"]}` |
| natural | FAILS | - | `RangeError: Maximum call stack size exceeded` |
| chrono-node | RUNS | true | `"Tue Dec 01 2026 15:00:00 GMT+0200 (Eastern European Standard Time)"` |
| libphonenumber-js | RUNS | true | `["+12133734253",true]` |
| mustache | RUNS | true | `"Thanks Sam, 12 callers in Texas."` |
| tracery-grammar | RUNS | true | `{"distinctOf30":3}` |
| aimlinterpreter | FAILS | - | `ReferenceError: DomJS is not defined` |
| aiml-high | FAILS | - | `ReferenceError: fs is not defined` |
| xstate-persist | RUNS | true | `["plan",12,88]` |
| mustache-escape | RUNS | true | `"You said &lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;"` |
| superscript | FAILS | - | `TypeError: Cannot read properties of undefined (reading 'filename')` |
What the run shows:
- RiveScript gave 3 different replies to 30 identical "hello"s. Tracery gave 3 different outputs in 30 draws. Their documents say this is by design (RiveScript working draft: "will be chosen randomly").
- An XState snapshot survives `JSON.stringify` and restores to the same state and data (`["plan",12,88]`, 88 bytes). That fixes today's state being lost on reload.
- mustache escapes HTML by default (`mustache-escape`).
- wink-nlp missed the phone number.

## (c) A pick per layer

| Layer | Pick | Why | gzip bytes (bundlephobia / jsDelivr) | Risk, and what guards it | What we still write |
|---|---|---|---|---|---|
| Understanding and retrieval: a visitor's words to an intent or an approved answer | **Orama 3.1.18** (Apache-2.0, both routes) | BM25 ranking with scores, typo tolerance, "Stemming and tokenization in 30 languages" (README; VTV may need Spanish). Maintained on both routes: 16 commits by 7 people and 2 releases in 12 months. Ran in Chrome, same output twice. | 24.4 KB / 26.4 KB | Scores use floating point, so the last digit may differ across browsers: round the score and break ties by a fixed rule (UNPROVEN; test on Chromium and WebKit in R3). Non-English stemmer bytes are UNPROVEN. | The concept lists (pack data) and query expansion from them; the answer/clarify/fallback band ported from today's `TUNING` (0.5, margin 0.06, 0.35); score rounding and tie-break; the pack loader |
| Challenger for the same layer | **MiniSearch 7.2.0** (MIT, both routes) | 5.7 KB, no dependencies; fuzzy, prefix and field boosts with scores (README); same output twice | 5.7 KB / 6.2 KB | **Not maintained on both routes**: 0 commits and 0 releases since 2025-09-16, and one maintainer. "No stemming is performed" (README). | The same as above, plus a stemmer through its `processTerm` hook |
| Dialogue state: one owner for the whole conversation | **XState 5.33.4** (MIT, both routes) | Maintained: 657 commits by 13 people and 95 releases in 12 months. Statecharts map to CX flows and pages. A persisted snapshot restores (measured). `@xstate/graph` gives every shortest path for tests. It retires today's two dialogue owners (script and engine). | 14.5 KB / 15.4 KB | XState 6 is in beta: pin 5 and plan the move as its own job. `@xstate/graph` 3.0.4 had no release in 12 months, but it is dev only. Tree-shaken size is UNPROVEN. | One standard machine for every client (no per-client code); guards that read pack data; saving the snapshot in sessionStorage |
| Reply writing | **Approved claim texts with Mustache-syntax slots**, through one `render()` and the claims gate; **mustache.js 4.2.0** (MIT, both routes) as the slot filler | Every visible line is an approved text. The slots are filled from the pack or from the visitor's own words, escaped (measured). Mustache is a logic-less spec ("there are no if statements, else clauses, or for loops", README), so a pack stays plain data. | 2.6 KB / 2.9 KB | **Not maintained on both routes** (newest release 2021-03-28, last commit 2023-01-21). **Ruling needed:** (1) take it pinned, guarded by the Mustache spec's own interpolation tests; or (2) write the slot fill ourselves (about 20 lines) against the same tests. I recommend (1). | One `render()` for every line: script lines and engine lines too, which fixes today's scrub skip. The claims gate. Variety without randomness: approved variants picked by a hash of the session and turn, so the same conversation always gets the same words. |
| Entities: numbers, places, contact details | **None picked** | compromise is 149 KB and the wink model 1 MB, too heavy for a phone. chrono (48 KB) and libphonenumber (45 KB) run and are maintained, but are taken only when a flow books a time or takes a phone number (TCPA consent first). | 0 | wink-nlp missed a phone number (measured) | A number-word parser ("twelve" to 12); markets and states from pack lists; an email shape check |
| Test tooling (dev only, never shipped) | The existing harness as the bar; whole-conversation stories; **`@xstate/graph`** paths; **fast-check** (MIT, maintained) for properties; **StrykerJS 10.1.1** (Apache-2.0, maintained) for mutants | The test bar is zero graded drops against the live baseline. Mutants are how a rule proves it is a test (repo rule 11). | not shipped | fast-check 4.11.0 was published 2026-11-21, under the 7-day rule: use 4.10.x, or 4.11.0 from 2026-11-28. Every dev dependency needs the owner's yes. | Story files from real misses; the comparison against the baseline |
| Learning loop | Method: Targeting (ALICE) and CDD (Rasa). DESIGN ONLY in this phase | | 0 in the browser | Personal data in logs: Presidio (MIT, maintained, Python) is a candidate only for an offline step, never on the site | The miss log with personal data removed; offline tests, then shadow, then a small share, then an approver, a log entry and a one-step rollback (R2) |

**Bytes.**
- The libraries total 24.4 + 14.5 + 2.6 = **41.5 KB gzip** (bundlephobia) or 44.7 KB (jsDelivr). With MiniSearch instead of Orama: 22.8 KB.
- Today, measured from the live site on 2026-11-26 (`node docs/advisor/r1/measure-current-advisor.mjs <bundle-dir>`, columns: raw, gzip, brotli, markers):

```
advisor-engine-Dh6uElZ2.js	227839	67459	57977	To repeat:|Omnikom Advisor
assistant-card-DKAAxqFC.js	172937	57865	51582	omnikom-advisor-handoff|Omnikom Advisor
claims-adb7afm0.js	72	88	74	-
ALL JS	956798	307583	268099
```

- The download of 2026-11-25 10:35 measured differently: the engine was 60,220 B gzip and the card 105,819 B gzip.
- Our own code and the pack (today's 3,234 phrasings and the claims) are not measured yet: UNPROVEN until R3.
- **Proposed budget for R2 to fix:** engine plus libraries ≤ 60 KB gzip, the pack measured on its own, all of it loaded only when the visitor opens the chat.

## (d) Real analysis: every claim checked twice, by different routes

- **Maintained.**
  - Route 1 is GitHub's default-branch history: commits and human committers in 365 days.
  - Route 2 is the registry's publish history: releases in 365 days.
- **Licence.**
  - Route 1 is the registry's licence field.
  - Route 2 is the LICENSE file's text, read by our own classifier (`classifyLicence` in `measure-repos.mjs`).
  - GitHub's own SPDX guess is a third look. Where there is no registry package, the file text is compared with GitHub's SPDX guess.
- **Runs in the browser.**
  - Route 1 is measured: loaded and called in headless Chrome 158.
  - Route 2 is the project's own docs.

Printed by `node docs/advisor/r1/make-table.mjs routes`:

| Candidate | Maintained, route 1: commits in 12 months (GitHub history) | Route 2: releases in 12 months (registry) | Maintained? | Licence, route 1: registry field | Route 2: LICENSE file text, our own classifier | GitHub SPDX (third look) | Licence agrees? | Browser, route 1: measured | Route 2: documented | Browser agrees? |
|---|---|---|---|---|---|---|---|---|---|---|
| nlpjs | 0 (last 2024-03-21) | 0 (newest 2025-01-23) | NO (both) | MIT | MIT | MIT | yes | RUNS | yes, after a bundling step | yes |
| rivescript | 0 (last 2022-11-26) | 0 (newest 2022-11-24) | NO (both) | MIT | MIT | MIT | yes | RUNS | yes | yes |
| chatscript | 0 (last 2024-05-06) | - | NO (GitHub only; no registry package) | - | MIT | MIT | yes (file vs GitHub SPDX) | not run | no (C++ server) | documented only |
| aimlinterpreter | 0 (last 2016-08-01) | 0 (newest 2015-07-27) | NO (both) | BSD (version not stated) | no file found | - | NO: BSD (version not stated) vs no file found | FAILS | Node only | yes |
| aiml-high | 0 (last 2016-02-19) | 0 (newest 2016-02-19) | NO (both) | MIT | no file found | - | NO: MIT vs no file found | FAILS | Node only | yes |
| program-y | 0 (last 2024-01-07) | 0 (newest 2021-05-27) | NO (both) | MIT | MIT | NOASSERTION | yes | not run | no (Python server) | documented only |
| superscript | 0 (last 2019-03-06) | 0 (newest 2017-10-06) | NO (both) | MIT | MIT | MIT | yes | FAILS | Node only | yes |
| rasa | 2 (last 2025-12-18) | 0 (newest 2025-01-14) | MIXED | Apache-2.0 | Apache-2.0 | Apache-2.0 | yes | not run | no (Python server) | documented only |
| botpress-v12 | 0 (last 2025-04-07) | - | NO (GitHub only; no registry package) | - | AGPL-3.0 | AGPL-3.0 | yes (file vs GitHub SPDX) | not run | no (server) | documented only |
| botpress | 730 (last 2026-11-23) | - | yes (GitHub only; no registry package) | - | MIT | MIT | yes (file vs GitHub SPDX) | not run | no (cloud platform) | documented only |
| xstate | 657 (last 2026-11-24) | 95 (newest 2026-11-07) | YES (both) | MIT | MIT | MIT | yes | RUNS | CDN import in docs (not checked word for word) | yes |
| wink-nlp | 0 (last 2025-06-30) | 0 (newest 2025-06-30) | NO (both) | MIT | MIT | MIT | yes | RUNS | yes | yes |
| wink-model | 0 (last 2024-11-30) | 0 (newest 2024-11-30) | NO (both) | MIT | MIT | MIT | yes | not run | yes | documented only |
| compromise | 468 (last 2026-11-08) | 8 (newest 2026-11-08) | YES (both) | MIT | MIT | MIT | yes | RUNS | yes | yes |
| natural | 31 (last 2026-10-26) | 9 (newest 2026-10-26) | YES (both) | MIT | MIT | MIT | yes | FAILS | Node only | yes |
| tracery | 0 (last 2024-11-03) | 0 (newest 2024-11-18) | NO (both) | ISC | Apache-2.0 | Apache-2.0 | NO: ISC vs Apache-2.0 | RUNS | yes (script tag) | yes |
| mustache | 0 (last 2023-01-21) | 0 (newest 2021-03-28) | NO (both) | MIT | MIT | MIT | yes | RUNS | yes | yes |
| minisearch | 0 (last 2025-09-16) | 0 (newest 2025-09-16) | NO (both) | MIT | MIT | MIT | yes | RUNS | yes (quote checked) | yes |
| fuse | 238 (last 2026-11-24) | 21 (newest 2026-07-13) | YES (both) | Apache-2.0 | Apache-2.0 | Apache-2.0 | yes | RUNS | yes | yes |
| orama | 16 (last 2026-07-03) | 2 (newest 2025-12-19) | YES (both) | Apache-2.0 | Apache-2.0 | NOASSERTION | yes | RUNS | yes | yes |
| flexsearch | 10 (last 2026-05-29) | 0 (newest 2025-09-06) | MIXED | Apache-2.0 | Apache-2.0 | Apache-2.0 | yes | RUNS | yes | yes |
| lunr | 0 (last 2020-08-19) | 0 (newest 2020-08-19) | NO (both) | MIT | MIT | MIT | yes | RUNS | yes | yes |
| chrono | 117 (last 2026-11-03) | 6 (newest 2026-10-12) | YES (both) | MIT | MIT | MIT | yes | RUNS | not stated | measured only |
| libphonenumber | 16 (last 2026-11-10) | 31 (newest 2026-11-19) | YES (both) | MIT | MIT | MIT | yes | RUNS | yes (script tag) | yes |
| botium | 66 (last 2026-11-09) | 11 (newest 2026-11-09) | YES (both) | MIT | MIT | MIT | yes | not run | no (Node tool) | documented only |
| stryker | 504 (last 2026-10-29) | 6 (newest 2026-10-23) | YES (both) | Apache-2.0 | Apache-2.0 | Apache-2.0 | yes | not run | no (Node tool) | documented only |
| fast-check | 1068 (last 2026-11-26) | 14 (newest 2026-11-21) | YES (both) | MIT | MIT | MIT | yes | not run | no (Node tool) | documented only |
| presidio | 285 (last 2026-11-24) | 6 (newest 2026-10-27) | YES (both) | MIT | MIT | MIT | yes | not run | no (Python service) | documented only |
| snips-nlu | 0 (last 2021-05-03) | 0 (newest 2020-01-15) | NO (both) | Apache-2.0 | Apache-2.0 | Apache-2.0 | yes | not run | no (Python) | documented only |
| duckling | 2 (last 2026-03-15) | - | yes (GitHub only; no registry package) | - | BSD-3-Clause | NOASSERTION | one route only | not run | no (Haskell server) | documented only |
**Where the routes disagree, and what I did:**
- **Licence conflicts.**
  - tracery: the registry says ISC, the file says Apache-2.0. It is dropped anyway.
  - aimlinterpreter and aiml-high: the registry names a licence, but no LICENSE file exists. They are dead anyway.
  - program-y and Orama: GitHub says NOASSERTION, but the file text is MIT and Apache-2.0. Orama is picked on the registry and the file text, which agree.
- **Maintained, mixed.**
  - Rasa: 2 commits and no release in 12 months, and its README says "maintenance mode". Not a runtime anyway.
  - FlexSearch: commits but no release in 12 months. Dropped anyway.
- **XState's browser claim.**
  - The quote "zero dependencies and runs anywhere that JavaScript runs" was NOT FOUND word for word in the README.
  - The docs page hung in headless Chrome past 90 s and was stopped. That is two failed approaches, so the docs route is closed.
  - The second route instead is the npm `exports` field, which ships browser module builds (`"module": "./dist/xstate.esm.js"`), together with the measured run.
- **A helper's claim corrected by a second look.** A research helper wrote "ChatScript is no longer maintained". Reading the README directly shows that sentence is about the old repository, `bwilcox-1234/ChatScript` (last push 2020-05-30). The current `ChatScript/ChatScript` is still dormant: 0 commits in 12 months, last 2024-05-06.
- **Supply-chain checks** (`~/.claude/reference/supply-chain-2026-10.md`):
  - Botium has an install script. fast-check 4.11.0 is under 7 days old.
  - XState, @xstate/graph, Orama, MiniSearch, mustache and Fuse have no install script and no dependencies in the registry data (`installScripts` and `deps` in `out/repos.json`). StrykerJS has 26 dependencies (dev only).
  - `osv-scanner` was NOT run. It runs before any dependency is added, at R3, with the owner's yes.

## What this round does NOT do

- It writes no product code, installs nothing and adds no dependency.
- It does not touch the live omnikom.io files and sends nothing to any form.
- It did not open the held-back probes.
- It does not decide the design. That is R2.

## UNPROVEN, BLOCKED, open

- **UNPROVEN:**
  - Speed and CPU on a real phone (Chrome ran with a virtual clock).
  - Whether scores are equal across browsers.
  - Tree-shaken library sizes; Orama's non-English stemmer bytes; our own code and pack size.
  - Whether the card preload hurts LCP (no trace taken).
  - XState's docs quote, word for word.
  - GUS's primary text; the Mitsuku log-reading quote; ALICE's category count.
- **BLOCKED:** nothing.
- **Open, for the head:**
  1. Which harness result is the live baseline: `cp7-results.jsonl`, which the brief names, or the newer files up to `cp11-results.jsonl` (2026-11-26 00:06)?
  2. The mustache ruling (part c).
  3. Accepting Orama over the smaller but unmaintained MiniSearch, or an R3 race between them.
  4. The card preload (below).

## Found outside R1 (for the head; the omnikom.io site is not this builder's)

The live omnikom.io home page carries `<link rel="modulepreload" href="/assets/assistant-card-DKAAxqFC.js"/>` and `.../claims-adb7afm0.js`. The browser therefore fetches the assistant card (172,937 B raw, 57,865 B gzip) when the page loads, before the chat is opened. That conflicts with brief constraint 4. Its effect on LCP is UNPROVEN. The site belongs to OMNIKOM-IO-SITE; this is reported to the head only.

## How to re-run

```
set NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000
node docs/advisor/r1/measure-repos.mjs          # about 5 min; writes out/repos.json (needs gh signed in)
node docs/advisor/r1/run-browser-smoke.mjs      # writes out/browser-smoke.json (needs Chrome)
node docs/advisor/r1/verify-quotes.mjs          # writes out/quotes.json
node docs/advisor/r1/make-table.mjs candidates|routes|smoke
node docs/advisor/r1/measure-current-advisor.mjs <downloaded-bundle-dir>
```
