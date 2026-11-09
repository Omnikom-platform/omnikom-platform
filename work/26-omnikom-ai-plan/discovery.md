# omnikom.ai discovery: what the research stage needs later, and where it comes from

Read 2026-11-09 (UTC). Public data only, politely; nothing submitted; no search-engine or AI-engine result page fetched.

## 1. omnikom.ai has no live site (one polite request, then the one extra check the 302 asked for)
```
date -u                  2026-11-09T02:14:08Z
curl -m 20 https://omnikom.ai/        -> curl: (28) Connection timed out after 20019 milliseconds
curl -m 20 https://www.omnikom.ai/    -> curl: (35) schannel: failed to receive handshake, SSL/TLS connection failed
nslookup omnikom.ai                   -> Address: 192.64.119.254
date -u                  2026-11-09T02:19:19Z
curl -m 15 -D - http://omnikom.ai/    -> HTTP/1.1 302 Found
                                         Location: http://www.omnikom.ai/
                                         X-Served-By: Namecheap URL Forward
                                         Server: namecheap-nginx
```
Meaning: the domain is registered and points at a registrar forwarder; nothing serves a page. The audit-live questions (snapshot, speed,
what the site says) do not apply: `launchState` is `planned` (answer A7). It matches `work/STATE.md:56`: "omnikom.ai DNS and the Resend
sending domain" wait on the owner's click. Not retried (two failed approaches end the attempt).

## 2. Which sources are connected (`doctor.mjs https://omnikom.ai/`, exit 0; keys by name only)
```
CONNECTED     Node.js: v24.22.1
CONNECTED     Claude CLI (headless check workers): 2.1.312 (Claude Code)
CONNECTED     Chrome or Edge (lab speed, rendered pages): C:/Program Files/Google/Chrome/Application/chrome.exe
CONNECTED     Common Crawl web graph (free backlinks and authority): release cc-main-2026-aug-sep-oct in D:/seo-kit-cache (latest)
CONNECTED     Google Search Console API (real queries, clicks, positions): C:\Users\DELL\.config\pewp\gsc-token.json (last successful call for this target: none)
NEEDS         Bing Webmaster Tools API (free key; keyword volumes): no key            -> BING_WEBMASTER_KEY
NEEDS         Chrome UX Report API (free; real-visitor speed): no key                 -> CRUX_API_KEY
NEEDS         PageSpeed Insights API (free key ...): no key                           -> PSI_API_KEY
NEEDS         Gemini API free tier with Google Search grounding (AI citations): no key -> GEMINI_API_KEY
NEEDS         Google Ads Keyword Planner export (free account; volume ranges): imported as a CSV file
NEEDS         Business Profile data (owner's free API export or a dated manual capture): imported as a file
MAIN SESSION  Google map-pack captures per city and device (owner-supervised): captures/local/
NEEDS         Gemini terms acknowledged for storing derived citation data: not acknowledged   -> PEWP_GEMINI_TERMS_ACK=1
MAIN SESSION  Local grid captures (owner-supervised, mobile): captures/local/grid/*.json
MAIN SESSION  Owner-supervised browser capture (Google results, People Also Ask, local pack, ChatGPT, Perplexity): claude-in-chrome; human pace
NEEDS         Conversions (the owner's analytics export, e.g. GA4; no API): imported as a file
```
Full output: `_doctor.txt`; the file doctor wrote: `pewp-root/site-checks/omnikom.ai/.pewp/doctor.json`.
The Search Console token file exists, but "last successful call for this target: none" and the book does not say whether omnikom.ai is a
verified property (question Q5 in `intake-answers-draft.md`).

## 3. The research stage, step by step, for omnikom.ai (`stages/research.md`)
Gate for all of it: `business.json` does not exist yet. `research.mjs https://omnikom.ai/ --dry` printed `BLOCKED: no ...business.json: run S1
intake first` (exit 3). The seeds also need the owner's approval (`approve.mjs <target> seeds`) before the demand steps run.

| # | Step | Source it needs | Status for omnikom.ai | What unblocks it |
|---|---|---|---|---|
| 1 | reuse earlier research | files that name omnikom.ai | none found by this order; not run | nothing needed, skipped is allowed |
| 2 | seeds | `business.json` services and places, owner approves | BLOCKED | owner answers Q1 to Q5, signs `business.json`, approves seeds |
| 3a | own queries (Search Console) | token, property omnikom.ai | BLOCKED: no site, no data yet | site live and verified in Search Console |
| 3b | volumes (Bing) | `BING_WEBMASTER_KEY` | BLOCKED: no key; needs a verified site in Bing Webmaster Tools | live site, then verify and create the key |
| 3c | volumes, CPC (Keyword Planner) | CSV export | BLOCKED: no file | owner exports "Keyword ideas" from his free Google Ads account |
| 3d | entity demand (Wikipedia) | titles the owner names | skipped: none given | optional |
| 3e | questions (Reddit public JSON) | 1 request per 7 s, stops at the first 429/403 | runnable once seeds are approved | seeds approved |
| 4, 4b | SERP reality, autocomplete | captures in the owner's browser | BLOCKED | owner present, captures below |
| 5 | clusters | step 4 captures | BLOCKED (each query its own cluster without captures) | step 4 |
| 6, 6b | competitors, winner pages | polite crawl (12 sites at most), Common Crawl cached | partly runnable: authority needs the cached release (connected); 9 of the 20 hosts read for this pack answered 403, so their audit would be BLOCKED too | owner picks the competitor list; hosts that answer 403 are captured by hand |
| 7 | AI citations | `GEMINI_API_KEY`, `PEWP_GEMINI_TERMS_ACK=1`, or owner ChatGPT/Perplexity captures | BLOCKED | owner's key and written terms yes, or captures |
| 7b | asset ideas, citation sources | derived from the above | waits on 4 to 6 | steps 4 to 6 |
| 8, 9 | targets, report | at least one sourced volume | BLOCKED (no volume source yet) | 3b, 3c or 3a |
| prompt map | `research-prompts.mjs` | owner-saved leads CSV or public reviews, or forum/existing files | BLOCKED: omnikom.ai has no leads; reviews and forum threads not collected | public reviews JSON or forum threads with URLs, or leads of a real workspace (never a client's) |

## 4. Captures the owner must do in his browser (research.md "Capturing results pages")
- The exact list is written by the research run into `research/capture-requests.json`; capture only those items, no query of our own, at most 60 a run.
- Tools: `node scripts/capture-server.mjs <target> --cwd . &` (127.0.0.1:47321) and `scripts/serp-capture.js` pasted into the results tab; Chrome asks once to allow
  local network access: the owner clicks Allow himself.
- Pace: one page at a time, 45 s apart, stop at the first robot check, mobile window under 768 px wide for mobile items.
- Kinds: Google results (hl and gl from the answers to Q1 and Q2), Bing results, autocomplete lists for the approved seeds, ChatGPT and Perplexity answers (fresh chat, memory off, 3 runs each).
- Not done in this pack, by order: no Google, Bing, DuckDuckGo, ChatGPT or Perplexity page was opened.

## 5. BLOCKED in this pack, and what would unblock it
- BLOCKED - Luxury Presence home page (the book's comparison, `docs/product/1-product.md:3`) answered 403 to a polite script on 2026-11-09 - the owner opens luxurypresence.com in his browser and the main session reads it there, or the owner says it is enough that the book names it.
- BLOCKED - the other 8 hosts that answered 403 (list in `intake-answers-draft.md` section C) - same; not retried, no user-agent change.
- BLOCKED - buyer words from public reviews pages and forum threads: not collected. The vocabulary list holds competitors' own wording only (section V). A reviews page (for example a public review site's listing for a competitor) or forum threads need a name from the owner's competitor pick first; I did not guess which review pages are public without a login.
- BLOCKED - `docs/offer/`, a "sample site" and the 12-month scope email: named in the revised brief, none is in this repository (`git grep -il "sample site"` printed nothing; `git grep -il "12-month\|12 month"` printed only test data, code and one archived standards file, no email). If the owner's wording of the offer lives outside the repo, give the path.
- BLOCKED - market (country, language), locations, goals, Search Console and Business Profile: no written source; five short questions in `intake-answers-draft.md` section Q.
