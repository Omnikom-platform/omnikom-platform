# S2 Research: from `business.json` to `targets.json` (free sources only)

Loaded only when stage S2 runs (modes `research`, `build`, and `compare`/`audit-live` when Q2, Q3 or Q5 need real data). Inputs are files,
outputs are files, so the stage resumes after a compaction or crash and any step can be re-run alone. Ported from this project's own
hand-run P0.2 (market) and P0.3 (keywords) protocols; what they did by hand in a browser, this stage does with scripts plus supervised
captures. **Never invent a volume, a ranking or a citation. A source that is missing makes that step BLOCKED, with what unblocks it.**

## What it answers
Which searches matter and how big each is (demand); which searches want one page (clusters); who wins each results page and in what format
(SERP reality); who the competitors are and how strong they are (audit + authority); what else the same audience asks (adjacent demand:
questions, entities); and who the AI engines name for the target questions and whether we are one of them. The output is `targets.json`.

## Inputs (nothing else)
`<pewp>/business.json` (S1; exit 3 BLOCKED without it, and `market {country, language}` is required: every volume is per country).
Optional, all found by the scripts: Search Console token, `BING_WEBMASTER_KEY`, a Keyword Planner CSV, `GEMINI_API_KEY`, the captures folders,
earlier research (this project's `icm/knowledge/seo/*.md`, `icm/knowledge/market/*.md`, a seo-kit `COMPETITOR-AUDIT.json`), the
Common Crawl cache (`seoKitCache` in `~/.claude/machine.local.json`). `node scripts/doctor.mjs <target>` lists which are connected.

## Whose research may be reused (cross-client isolation)
A URL target reads existing research ONLY from the folders it is given (`--existing-dir`) and `<pewp>/inputs/existing`; it never looks at the current folder.
A repo target reads the default research folders inside that repo. Every file must name the business (its domain, its name, or an `--existing-alias`
such as the owner's first name) or sit under the target, or it is REFUSED and listed under `refused` in `research/existing.json`; a capture folder is accepted
when any of its files names the business. The self-test runs from a folder that holds a decoy `icm/knowledge` of another client.

A file that covers TWO businesses (this project's keyword map and question bank) is read section by section. A heading names whose section it is: `(Francine)`,
`(Eli; also Francine's /cash-offer)`, `Eli's own area`, or a legend letter such as `(E, F)` defined by `F = Francine, E = Eli, B = both`. A section that names the
target is imported; one that names the target AND another business is imported with `sharedWith: ["Eli"]` on its rows, the cluster carries `sharedWith` in
`targets.json`, and `report.md` lists it as "Shared with another business: owner decides"; one that names only another business is refused and listed
(`refused` with its `section`, and a "Not imported" line in the report). A table under no labelled heading is imported. The target's own name or alias must match
the heading's name, so pass `--existing-alias` for the owner's first name.

## Who does what
Scripts do everything that is an API, a file or a polite crawl. **The main session** does the three things a script must not: (1) asks the
owner anything open, as pickable options; (2) captures Google/Bing pages and ChatGPT/Perplexity answers in the owner's browser (below);
(3) writes the plain-words summary. Scripts never fetch Google, Bing, DuckDuckGo, ChatGPT or Perplexity pages (a guard in the self-test
fails if one tries) and call no paid API.

## The run, in order
`node "<skill>/scripts/research.mjs" <url|repo> [options]` runs steps 1 to 9 and each step is also its own script (all take `<target> --cwd DIR`).
`--dry` prints the plan (stages, 0 workers, external calls, $0, the competitor sites it would audit), writes `research/capture-requests.json` only when what it asks for changed and
`research/research-plan.json` every time (the research-plan step's evidence), and fetches nothing. It also writes `research/research-cost.json` (the calls per source, the total, the cost in money and the competitor list; no time), only when it changes.
A plan above 150 calls needs the owner's OK, recorded with `node "<skill>/scripts/approve.mjs" <target> research-cost --by "<name>"`: the plan then runs while no source is above the approved numbers and the competitor list is the approved one (`--yes` still passes when the script is run by hand). Show the owner the plan before the first real run.

| # | Step | Script | Source, and what it makes | When the source is missing |
|---|---|---|---|---|
| 1 | reuse | `research-existing.mjs --dir D [--alias NAME]` | earlier keyword maps, question banks, entity tables, seo-kit audits, each with its own date; stale = older than `--max-age-days` (30). Follows the `sources:` front matter of each knowledge file to the SERP and AI-answer capture folders it was built from (this project: `icm/work/p0.2/fresh`, `ai-answers`). The keyword map's Bing-autocomplete tier (T0 to T2) becomes the free volume estimate (see below). Fetch only what is missing or stale | nothing found = skipped, not an error |
| 2 | seeds | `research-seeds.mjs --service S ... [--pattern P] [--query Q] [--industry SLUG]` (`--industry` adds the pack's recalled seed queries, `rules/industries/<slug>.json` `seeds.queries`: product line, intent, local or national) | service x place x pattern (places from `business.json`), as this project did with 11 cities x intents; the owner approves the services | no seeds is fine if other sources give queries |
| 3a | own queries | `research-gsc.mjs` | Search Console API: queries, pages, country, device, position, clicks, impressions; our site only | no token: BLOCKED (owner adds our Google account as a user, saves the OAuth token at `~/.config/pewp/gsc-token.json` or `GSC_TOKEN_FILE`) |
| 3b | volumes | `research-bing.mjs --seed Q ... --max-calls 60` | Bing Webmaster `GetKeyword` / `GetRelatedKeywords` / `GetQueryStats`; estimates; hard call budget | no `BING_WEBMASTER_KEY`: BLOCKED (verify the site in Bing Webmaster Tools, Settings > API access) |
| 3c | volumes, CPC | `research-kwp.mjs --file export.csv` | Google Ads Keyword Planner "Keyword ideas" CSV (UTF-16 or UTF-8): ranges become estimates (midpoint, range kept), CPC = top-of-page bid midpoint | no file: BLOCKED (export steps are printed) |
| 3d | entity demand | `research-wiki.mjs --title "Tracy, California"` | Wikipedia monthly pageviews; "no article" is a result | titles are never guessed; none given = skipped |
| 3e | questions | `research-forums.mjs --query Q [--subreddit S]` | Reddit public JSON, 1 request per 7 s; only titles that are questions, with permalinks. The FIRST 429/403 stops the run | blocked: owner makes a Reddit app token (`REDDIT_TOKEN`) or the main session reads threads by hand |
| 4 | SERP reality | `research-serp-import.mjs [--dir D] [--device mobile]` | parses the captures the main session saved (formats below) into rows with location, device, language, date; rejects any that lack one | no captures: BLOCKED; `research/capture-requests.json` lists exactly what to capture |
| 5 | clusters | `research-cluster.mjs` | shipgate 06 9.1: two queries are linked when their top-10 URLs share >= 4 (`--shared`, clusterOverlap); clusters are the connected components (union-find, biggest volume first, ties by code point); a query with no capture joins the captured query with the same head term AND the same place, else is a cluster of one (`serp:false`); primary = biggest volume (ties: lower difficulty, code point) | no captures: every query its own cluster, no overlap guessed |
| 6 | competitors | `research-competitors.mjs [--domain d] [--from-serp] [--authority]` | port of `tools/seo-kit/audit.mjs` (raw HTML as a crawler sees it: schema, FAQ, city pages, sitemap, llms.txt, AI bots blocked) + `authority.mjs` (Common Crawl: linking domains, strength, link gap) | a site that answers 403/429/503 is stopped for the run and reported BLOCKED; authority without a cached release is BLOCKED |
| 6b | winner pages | `research-winners.mjs [--from-serp] [--max-pages 20]` | the pages that already rank for each priority cluster: words, headings, schema, FAQ -> `requiredEntities`, `requiredTerms` (06 9.5), `winningFormat`, `winningPageType` (9.3), a sourced `wordRange`. Fetching needs `--from-serp` (polite, robots first, cached, host stops at 403/429, hard page budget); a capture with domains only uses the competitor audits already cached, no request | not fetched without the flag; no URLs and no cached audit: nothing derived |
| 4b | autocomplete | `research-autocomplete.mjs` | suggestions the main session saved (format below); each is a T1 demand ESTIMATE for that phrase and a new query. Never fetched by a script | no files: skipped, seeds to type are in `capture-requests.json` |
| 7 | AI citations | `research-ai.mjs [--gemini] [--question Q]` | Gemini free tier with Google Search grounding (N runs per question, at least 60 s apart, 06 section 9.6; needs `GEMINI_API_KEY` and the owner's terms acknowledgement `PEWP_GEMINI_TERMS_ACK=1`, the same gate as measure) + owner-captured ChatGPT/Perplexity answers (`sources` or measure's `citedDomains`) + AI Overviews inside the SERP captures | no key, no acknowledgement, or no captures: BLOCKED with the way out |
| 7b | asset ideas, citation sources | `research-assets.mjs`, `research-citations.mjs` | derived from what is above, no source needed: linkable-asset ideas (tool, data, guide, outreach) and local citation sources (directories), each with its evidence | too little evidence = no idea; a directory is `listed` only when business.json proves it |
| 8 | targets | inside `research.mjs` | clusters -> `<pewp>/targets.json`; checked by our own checks and `targets-validate.mjs` | no search has a sourced volume: BLOCKED, file not written |
| 9 | report | inside `research.mjs` | `research/report.md` (plain words), `summary.json`, `unmeasured.json`, `capture-requests.json` | |

`--from-serp` (audit the sites that win the captured pages) is off by default because it contacts third-party sites: it prints the list in the
plan first. Authority (`--authority`) reads about 11 GB from disk (15 to 30 minutes); it is reused for 30 days when `<pewp>/authority.json`
already covers the domains.

## Capturing results pages (the main session, in the owner's browser)
This is the project's 2026-10-17 precedent, kept as is. Use the claude-in-chrome extension; ask the owner to be present.
0. **The list.** Capture exactly the `items` of `research/capture-requests.json` (query, engine, device, location), in order, no more than the file's cap, and
   nothing else: no query of your own. The main session adds a query only by adding a seed through the approved path (`research-seeds.mjs`, owner approves
   with `approve.mjs <target> seeds`, the next run rewrites the list). **Where the list comes from:** the cluster heads when `research/clusters.json` was made after the seeds now approved were approved (its `generatedAt` against `approved/lock.json` `seeds.approvedAt`), else the approved seeds (results pages and autocomplete for every approved seed on both engines, the first 8 as AI questions); `universe` in the file and the dry run's line `capture list from:` say which, `clustersPassedOver` says why. **The tools** are two files of the skill, no key, no download:
   `node scripts/capture-server.mjs <target> --cwd . &` starts the receiver in the background (127.0.0.1 only, port 47321, stops after 3 hours, prints a line
   per saved file); `scripts/serp-capture.js` is pasted once into the results tab through the `javascript_tool`, and each page is then saved with
   `await window.__pewpCapture({ query, requested, engine, device })` (the top of that file explains every option). The receiver checks each capture with the
   importer's own rules and answers 400 with the reason, so a bad capture is refused on the spot, not found at import time. The first time, Chrome asks the owner
   to allow the page to reach devices on the local network (127.0.0.1): **the owner clicks Allow once**; the helper never clicks it for him. Scripts still never
   fetch Google or Bing; only the owner's browser reads those pages.
1. **Pace.** One page at a time, at least 45 seconds between page loads, no parallel engines. **Stop the whole run at the first robot check**
   (CAPTCHA, "unusual traffic", a sign-in wall): save that capture with `"robotCheck": true`, mark every query not yet run BLOCKED, and do not
   retry or work around it. Read only, one attempt per query, no clicks on ads, never sign in or accept terms. The only clicks allowed are "Show more" / "Show all" inside the AI Overview
   (the extractor does them). The receiver also refuses the same file name twice inside 45 s (429, "pace: at least 45 s between captures"); that is a backstop,
   the pace is yours. When the answer says ROBOT CHECK, the capture is saved with `"robotCheck": true`; stop there.
2. **Google**: `https://www.google.com/search?q=<query>&hl=<language>&gl=<country>` (add the city with Google's location parameter if the owner
   wants it). Navigate, wait until the page has loaded, then call `__pewpCapture`: it clicks "Show more" / "Show all" in the AI Overview (waits 800 ms, reads again),
   so `aiOverview.sources` holds the domains cited; it records the result addresses (what clustering needs), the local pack, People-also-ask and the footer. The page-text
   tool omits the AI Overview, which is why the extractor reads the page itself. A capture whose AI Overview is present but lists no sources is flagged
   `aiSourcesMissing` by the importer: capture it again. The map pack, if the owner wants it: `https://www.google.com/maps/search/<query>?hl=en`, wait about 4 seconds.
   **Device.** Capture on the device the item asks for (`business.json` `rankTracking.devices`, default mobile). For mobile, resize the window below 768 px wide
   before loading the page; the extractor refuses a `device` the tab does not look like. If the captures' devices differ from the wanted ones the importer writes
   `deviceMismatch` and a note into `serp.json`. When both devices are wanted, pass `id: "<slug>-mobile"` so the two files differ.
3. **Bing**: `https://www.bing.com/search?q=<query>`; it cannot be localized, record the machine's location.
4. **Location, honestly.** Record the footer text of the page ("Tracy, California - From your device" or "Egypt"). The importer calls a capture
   localized only when the footer shows the requested city; otherwise it is labelled `NOT LOCALIZED (baseline)` and no city ranking claim may
   be made from it (when every capture is baseline, `serp.json` says so: "baseline captures cannot support city ranking claims"). A baseline still shows who wins, which formats, which features.
5. **One file per query and engine**: `<pewp>/captures/serp/<id>.<engine>.json` (the receiver writes it; by hand only if the tools cannot run):
   `{"query","engine":"google|bing","capturedAt":"ISO","browser":"owner's Edge","device":"mobile|desktop","language":"en","location":{"requested":"Tracy, CA","footer":"...","method":"uule parameter"},"organic":[{"position":1,"url":"https://...","title":"..."}],"localPack":[{"name","rating","reviews"}],"paa":["..."],"aiOverview":{"present":true,"text":"...","sources":["domain.com"]},"relatedSearches":[],"robotCheck":false,"notes":""}`.
   A capture without query, engine, date, device, language or location is rejected with the reason. The old text files
   (`icm/work/p0.2/fresh/<ID>.google.md`, `.bing.md`; query from `captures/<ID>.md` next to them) are read too, from `--capture-dir` or found through the
   knowledge files' `sources:` with `--use-existing-captures`. They never recorded the device, so desktop is ASSUMED for them and labelled so on every row
   (`--device` overrides); their location is `NOT LOCALIZED (baseline)` when the footer did not show the city (this project's run: 221 of 222). They hold domains
   only: clustering then treats a niche domain as its one page and a portal by domain + title, and they give no `competitorsTop3`; the report says so.
   The same capture saved in two folders counts once.
6. **AI engines** (ChatGPT, Perplexity, Copilot, Gemini app): the owner's browser, a fresh chat with memory off, the exact question, 3 runs,
   same pace and stop rule; the answer can go through the same receiver (`POST /save-ai?file=<id>.json`, checked and paced like the results pages). An engine that needs a sign-in or new terms is BLOCKED until the owner does it himself. Save
   `<pewp>/captures/ai/<id>.json`: `{"engine":"chatgpt","question","prompt","model":"as shown","capturedAt","browser","location":"what the assistant said it assumed","answer","sources":["https://..."]}`
   (one file per run). The project's `AI-<ID>.<engine>.md` files are read too.
   A capture in the form of `import-ai.mjs` (`answerText`, `citedSources`, or `blocked` with the reason) is read as it is: its `citedSources` are the sources, its `answerText` is searched for the business name, a `blocked` one is no run and the report names its engine as not read.
7. Run `research.mjs` again. The capture list shrinks to what is still missing or older than 30 days.

### Capture helper agent
The main session may hand the captures to one helper (a Sonnet agent) so its own context is kept for judgment. The rules do not loosen: **one agent, one browser
tab**, never two in parallel; the same list (`capture-requests.json` only), the same 45 s pace, the same stop rule (first robot check or sign-in wall: stop,
report, do not retry). Give it the target, the path of `serp-capture.js`, the receiver's port, the list of items and these limits; it saves **only through the
receiver** (no hand-written files, no other tool that writes captures) and reports counts: saved, refused (with the receiver's reason), blocked by a robot check,
not yet run. It does not decide which queries to add, does not click Allow for the owner and does not sign in. The main session reads the counts, runs
`research.mjs` again and trusts only what the importer shows (`serp.json` counts, rejected, `deviceMismatch`, notes).

## US vantage (work order 43): `scripts/vantage.mjs`, `scripts/lib-stops.mjs`
**Status: Google web numbers stay "measured from outside the US, indicative". The Sacramento vantage is NOT PROVEN and Google is BLOCKED from it until at
least 2026-11-12 04:29 local** (see "What was proven").
- **What it is.** One dedicated Edge profile, `omnikom-us-vantage` (never the owner's own profile; `assertOwnProfile` refuses any other folder), started with remote
  debugging on 127.0.0.1 only, signed out. It tells the browser it is in Sacramento (CDP geolocation override 38.5816, -121.4944, permission for google.com and
  bing.com) and uses `gl=us&hl=en` on Google, `cc=US&setlang=en-US` on Bing. It bypasses nothing and changes no IP.
- **Commands** (exit 0 ok, 2 usage, 3 BLOCKED with a last line `BLOCKED: <what> | unblocks: <what>`): `start` launches the profile and does the footer proof;
  `status` re-verifies (no Google page loaded); `stop` closes it and proves it; `capture <url> --out FILE.json [--settle] [--city "City, ST"]` is ONE page the agent
  asked for (writes the json, the html and a png). The CLI wraps start, status and stop as `omnikom seo vantage`. `seo run` runs only `status`.
- **The footer proof.** `start` (an explicit action, never `status`) loads ONE Google results page, `coffee` with `gl=us&hl=en`, at the normal pace, reads the footer's
  place line and records `{footer, footerLocation, query, url, at}` plus a browser session id. `status` passes only if that proof exists, passed (Sacramento or
  California), is under 12 hours old and belongs to the browser that is running now. Every Google capture also records its own footer location in
  `vantage.footerLocation`, so each capture proves its own vantage.
- **Pace and walls.** At least 45 s between Google pages and between Bing pages; 60 s per host for every other host (ChatGPT, Perplexity, Copilot, LinkedIn,
  Facebook, Reddit, BBB, Trustpilot). `capture` refuses inside the gap. A robot check, CAPTCHA or sign-in wall is BLOCKED and writes that engine's 24 h stop, never
  solved, never bypassed. No loop over a query list; the agent asks for each page.
- **Stops** are one file per engine in the shared format, `~/.claude/state/omnikom-stops/<engine>.json` (`lib-stops.mjs`: engine, hosts, until, reason, setBy, setAt,
  evidence, optional desktop-only `lift`). A Google stop blocks Google only. Scripts honour a stop until `until`; a lift frees only a person-paced desktop capture.
- **Other hosts** need no Sacramento proof, only the running browser and their own stop. `--settle` waits until the page text has not changed for 5 s (90 s cap), then
  saves; AI engines always settle. The AI answer selectors and the generic page reader are UNPROVEN until a live read (an empty answer is BLOCKED, never guessed).
  An AI capture is saved in the `captures/ai/<id>.json` shape (`engine, question, answer, sources`) plus `citations`, `settle`, `vantage`.
- **What was proven (2026-11-11, one real run each, through `heavy.mjs`).** PROVEN: the profile starts, the browser reads back Sacramento (`38.5816, -121.4944`),
  `stop` closes it, `status` is 3 after that, the 45 s gap held. NOT PROVEN: the footer location. Google's home page footer carries no location line, and the first
  results page ("business loans", `gl=us`, signed-out Edge driven over CDP, exit IP 156.208.129.182 Giza, EG) returned Google's robot check ("Our systems have
  detected unusual traffic from your computer network ... not a robot"). Stopped at once, evidence kept in `omnikom-stops/evidence/`, stop until
  2026-11-12T02:29:12Z. The footer reader is tested on synthetic strings only. No retry from this IP.
- **Step 2 (a US egress) is BLOCKED.** A GitHub Codespace as an SSH tunnel is out: GitHub's terms (github/docs, "GitHub Terms for Additional Products and Features",
  Codespaces, fetched 2026-11-11) say "Additionally, Codespaces should not be used for: ... Any other activity unrelated to the development or testing of the
  software project associated with the repository where GitHub Codespaces is initiated." Unblocks: a US egress we are permitted to use (the owner's own server or VPN).

## Capturing autocomplete (the main session, in the owner's browser)
Same pace and stop rule as the results pages, and the same rule for the list: only the seeds in `capture-requests.json` (`autocompleteRequests`), none of your own
(a new seed comes through the approved path). The receiver does not take autocomplete files yet; the main session writes them. For each seed: type the seed slowly into the engine's search
box, do NOT press Enter, save the list shown as `<pewp>/captures/autocomplete/<id>.<engine>.json`:
`{"seed":"realtor in tracy","engine":"google|bing","capturedAt":"ISO","browser":"owner's Edge","language":"en","location":{"requested":"Tracy, CA","footer":"..."},"suggestions":["realtor in tracy ca", "..."]}`.
A file without seed, engine, date, language, location or suggestions is rejected with the reason. Scripts never fetch an autocomplete endpoint.

## Prompt map (DECISIONS 35; the schema is `schemas/prompt-map.md`)
A **prompt** is a whole situation a buyer types into an AI engine: a scenario, a comparison and a constraint. `targets.json` plans a page per search; the prompt map
is the other half: which real questions buyers ask, which page answers each, and what ChatGPT, Perplexity and Gemini say about us for it. Run it after the clusters
exist, when the owner has at least one source of buyer words. **No invented rows**: a prompt with no source is not a row. No volume target, no "100 questions".
1. **Gather the words.** `node scripts/research-prompts.mjs <target> --leads FILE.csv --reviews FILE.json` (either, both, or neither when `research/forums.json` or
   `research/existing.json` exist). `--leads` is the CSV of the dashboard lead-export of ONE workspace, saved by the owner; `--reviews` is a JSON list of public reviews
   the owner saved, `[{ "text", "url", "date", "platform" }]`. Only the free text of a lead's `answers` is read; no name, email, phone or id is read into any file, and an answer
   that names the person or holds an email or a phone is dropped whole (counted in `inputs.leads.personalDataDropped`). Never across clients: one workspace's words never go
   into another client's map. Output `<pewp>/private/prompt-candidates.json`: one candidate per distinct wording, every source with `file:row` or url, date and the quote (cut to 300 characters),
   parts empty. The script drafts; it does not judge. **Lead text never reaches a file a repo target commits:** the candidates live only in `private/` (its own `.gitignore` is `*`, written first on every run),
   and a lead source in `prompt-map.json` has `ref` and `seenAt` and NO `quote` (`--check` refuses one); review, forum, existing and owner sources keep their quote.
2. **Split each candidate into the three parts (the session's judgement).** Read the buyer's words and write, in `research/prompt-map.json`, a row per candidate worth keeping:
   - `scenario`: who the buyer is and what is happening to them. `comparison`: the two (or more) options they are weighing, or what they want compared to what they have.
     `constraint`: the limit that decides it (a budget, a deadline, a size, a place, a rule). `location`: the city or region the buyer names ("" when none).
   - Use the buyer's terms, not yours; a part you cannot find in the sentence is a sign the prompt is not a whole situation: do not make one up, leave the candidate out.
   - **Reword in the buyer's terms, never copy a lead's sentence.** `prompt`, `scenario`, `comparison` and `constraint` are committed; a lead's text is not. `--check` refuses a row that holds 8 or more consecutive words of any lead quote in `private/prompt-candidates.json` (it names the row id and the source ref, never the words); without that file it prints `lead wording not checked: no private candidates`. A forum, review or existing question is public: its wording may be kept.
   - For a candidate with a lead source write `prompt` in your own words (see the rule above); otherwise keep `prompt` as the candidate's text. When you change it, the `id` must be recomputed (`pm-` plus the first 8 hex of sha256 of the prompt); `--check` prints the id it expects.
   Three worked examples (an invented tea shop, `kettleandleaf.test`; not a client):
   - Lead quote "Looking for a gift box for an office of twelve people, is loose leaf better than bags for a gift?" -> scenario "buying a gift for an office team of twelve",
     comparison "loose leaf tea versus tea bags as a gift", constraint "twelve recipients", location "".
   - Review "Bought a sampler as a gift for my mother-in-law who only drinks black tea, she loved the Assam" -> scenario "choosing a gift for someone who drinks only black tea",
     comparison "a sampler versus a single large tin", constraint "recipient drinks only black tea", location "". (A review is a past purchase: restate it as the question the buyer asked before buying; keep the review as the source and its words as the quote.)
   - Forum "Is gyokuro worth the price compared to sencha for a beginner?" -> scenario "a beginner choosing a Japanese green tea", comparison "gyokuro versus sencha",
     constraint "price against a beginner's palate", location "".
3. **One fix per row**, exactly one kind: `new-page` (nothing on the site answers it: `target "new"`, `pageType` `situation` for a scenario page or `comparison` for an honest side by side),
   `improve-page` (an existing page nearly answers it: `target` its path, say what to add in `note`), or `earn-mention` (the question is answered best by someone else's page, so we earn a mention:
   `target` "new" or the page the mention should point to; the plan lists it in `plan/offsite.json`). Two fixes for one prompt means two prompts or the wrong split: pick one.
4. **Unsourced goes to its own file.** Something the owner said with no record, or a guess, is not a row: put `{ "prompt", "why" }` in `research/prompt-unsourced.json`. If the owner states it directly and
   there is a message or note to point at, it is a row with source kind `owner` and that file as `ref`.
5. **Check, then fill the engines.** `node scripts/research-prompts.mjs <target> --check` (exit 1 names every refused row and rule). Then capture the answers: ChatGPT and Perplexity are owner captures in
   the owner's browser (section 6 of "Capturing results pages", one file per run in `captures/ai/`, with the exact `prompt`, or a `promptId` field); Gemini runs only under its own gate
   (`GEMINI_API_KEY` and `PEWP_GEMINI_TERMS_ACK=1`, the owner's yes) through `research-ai.mjs --questions-file` with the prompts. Then `node scripts/research-prompts.mjs <target> --engines` fills each row's
   `engines` from `research/ai-citations.json` and `captures/ai/*.json`, matched by prompt id or the EXACT prompt text; a wording that differs matches nothing, and an engine nobody checked stays `null`.
   The script makes no request. Run `--check` again.
The monthly re-run of the map is the measure stage (`stages/measure.md`); the plan answers every row (`stages/plan.md`).

## Files written (`<pewp>/research/` unless said)
`existing, seeds, gsc, bing, kwp, wiki, forums, serp, autocomplete, clusters, competitors, winners, ai-citations, assets, citations .json` (one per step; each starts with `step`, `status`
`ok|blocked`, `generatedAt`, `market`, and a `blocked` text when blocked) · `ai-gemini-runs.json` (derived fields only) · `private/prompt-candidates.json` (script draft, git-ignored, under `<pewp>/private/`), `prompt-map.json` and `prompt-unsourced.json` (the session's; schema `schemas/prompt-map.md`) · `unmeasured.json` ·
`capture-requests.json` · `summary.json` (step results, why each cluster got its target page) · `report.md` · and `<pewp>/targets.json`,
`<pewp>/authority.json`. Every response is cached under `<pewp>/cache/<source>/`; API keys and tokens are never stored.

## How `targets.json` is built (so a reader can redo it)
- **Cluster head** = the query with the biggest volume (Keyword Planner, else Bing, else our Search Console impressions); that is `primaryQuery`.
  `volume` is the head's sourced number; where it is a range or a stand-in it carries `estimate: true`, `range`, and its `unit`.
- **Free demand tier (when nothing measured exists).** A query that has no Keyword Planner, Bing or Search Console number but sits in an imported keyword map
  with a Bing-autocomplete tier gets `volume = {value: "T1 (Bing autocomplete tier)", rank: 3, estimate: true, source: <file + date>}`; T1 = people type the phrase
  (rank 3), T2 = only related phrases appear (2), T0 = not tested, only the results page shows interest (1); a cell naming several tiers counts at its weakest.
  A measured volume always wins; `report.md` and `summary.json` (`tierEstimateClusters`) name every cluster that rests on a tier. It orders work, it is not a count.
  A search with no signal at all goes to `unmeasured.json`.
- **Intent** (06 9.2, `lib-growth.mjs`, first match wins): 1 a local pack on the SERP, a place of `rules/gazetteer/us.json` (or of the business) in the query, or a `local` modifier -> local;
  2 >= 3 of the top 10 are product/category pages (9.3), a shopping result, or a `transactional` modifier -> transactional; 3 a `commercial` modifier (best, vs, review, top, price)
  or >= 3 comparison/review pages -> commercial; 4 >= 5 of the top 10 on one domain, or the query EQUALS a brand (`rules/directory-domains.json`, or `business.json`) -> navigational; 5 informational.
  Modifiers: `rules/intent-modifiers.json`; extra ones for one business go in `business.json` `intentModifiers` (`{transactional:["sell my house"]}`). **Location** is the place in the query as `City, ST`.
- **difficulty** = percent of the captured organic slots held by portals (domains that fill 25%+ of all captured results pages); an estimate
  and a signal, not a difficulty score; `null` below 4 captures or 5 results. **value** = Keyword Planner CPC midpoint or `null`.
  Keyword Planner "competition" is advertiser competition and is never used as difficulty.
- **Winner pages** (`research/winners.json`): `requiredTerms` (06 9.5) = the 1-3 word terms of the headings, list items and bold text that appear on >= 2 of the top 3 winners, stop words removed; `requiredEntities` = the older shorter list
  (heading words on half the pages, minus the query's own words) that the briefs and GT-005 still use; `winningPageType` = the most common 9.3 page type; `winningFormat` = the page kind most winners are; `wordRange` = a sourced `[min, max]` of visible words (p25 to p75 with 4+ pages, else min to max, rounded to 50), always
  `estimate: true`, with its location and device. `wordRange` is the optional T-011 field. When the capture holds no page addresses it comes from the cached competitor
  audits (`basis` says so); with no pages at all the fields stay as before. Cost stops: 20 pages a run, 3 per cluster, 10 clusters, 1 request per 4 s per site.
- **serpFeatures** = features seen on the cluster's captures (same engine and device): `ai_overview`, `local_pack`, `paa`. No capture =
  `[]` with a source that says NOT CAPTURED and UNKNOWN (the contract has no "unknown" value; an empty list here is not "no features").
- **targetPage** (06 9.7): an existing page whose title or H1 contains the primary query's head term (web-delivery 12: stemmed words minus stop words and place names) and whose page type (9.3, from its JSON-LD and path)
  fits the intent (03 22.2); a page that names another place than the query is skipped (skill choice); several matches -> most Search Console clicks, else shortest path; else the page Search
  Console shows most for it, else `"new"`; one page serves one cluster, the lower-priority one becomes `"new"`. The other matches are named in `summary.json` as cannibalisation candidates.
- **priority** = (1 + log10(1 + volume)) x intent weight (transactional/local 3, commercial 2, informational 1, navigational 0.5) x (1 + log10(1 + CPC)) x ease
  (3 ranking top 20 already, 2 page exists, 1 new page, minus 0.5 when portals hold 60%+). Computed to order work, not a forecast.
- A search with **no sourced volume** is not in `targets.json` (the contract wants a real number in `volume`); it is listed in
  `unmeasured.json` and the report. If none has a volume the stage is BLOCKED and writes no file.

## Templates are never written as searches
A row like `home value {city} ca` or `How is the housing market in {city}?` is a pattern. Importers (existing research, seeds) expand `{city}` per
service-area city (the City cell of the row if it lists cities, else the cities in `business.json`); a pattern with any other placeholder, or with no
city to fill, is dropped and listed under `droppedTemplates` in its step file and in `summary.json`. The universe drops any query that still has `{` or `}`,
and the targets check fails on a brace in a query, question, entity or location. The self-test scans every written file for it.

## Asset ideas and citation sources (report sections 6 and 7)
Ideas come only from evidence, with the thresholds in `research-assets.mjs`: a tool idea needs the same kind of tool (calculator, estimator, quiz) on 2+ winning sites;
a data idea 3+ real price/cost/rate questions; a local guide 2+ questions about living there; situation guides need an audited competitor that publishes them; outreach needs
3+ sites in the link gap. Citation sources are domains in 2+ captured searches that read like directories or are portals, plus link-graph sites with a directory-family
name; competitors are never listed; `listed` needs proof in business.json (socials, Business Profile) or a captured result naming the business, otherwise
"unknown: look it up by hand".

## Stop rules
- A step without its source exits 3 with `BLOCKED: <what unblocks it>`; `research.mjs` records it and goes on. Never fill it from memory.
- Two failed attempts at the same obstacle end it: record `BLOCKED - obstacle - what would unblock it` and move to the next step.
- First 429/403 from Reddit, a competitor site, Search Console or Gemini stops that source for the run. First robot check stops all captures.
- Polite crawling only: robots.txt first and obeyed, 1 request per 4 s per site, honest user agent, one attempt per URL, no forms, no logins.
- Stay inside the cost stops: 12 competitor sites, 60 Bing calls, 12 Reddit calls, 30 Gemini calls (questions x runs), 60 captures a run,
  45 s a capture. Above any of them, ask the owner.
- Gemini: only derived fields are kept (cited domains, our domain cited, name mentioned); raw grounded answers are not stored because the
  terms reading in `icm/work/seo-analyst/TRACKER-PROPOSAL.md` (T1b) is UNVERIFIED, and the script stays BLOCKED until the owner has
  confirmed that in writing (`PEWP_GEMINI_TERMS_ACK=1`; `doctor.mjs` source `gemini-terms`). Samples of one question go out at least 60 s
  apart (8 questions x 3 runs = about 24 minutes). Treat `ai-citations` shares as 1 of 3 runs, not a rate.

## Proof for the run file (`runs/<date>-research.md`)
The command, its exit code, the first 40 lines of output (the step table), `PASS targets-valid`, the count of captures and how many were
`NOT LOCALIZED`, and the doctor result. Self-test: `node scripts/test-research.mjs`; watched-fail: `node scripts/mutants-research.mjs`. Prompt map: `node scripts/test-prompt-map.mjs` (its own mutants run with it; `--no-mutants` skips them).
