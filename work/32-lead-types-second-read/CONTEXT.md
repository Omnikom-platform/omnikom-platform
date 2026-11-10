# 32 lead types and statuses: a second, deterministic read of every quote (research follow-up to 29)

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/lead-types-second-read. Status: OPEN (head of operations
2026-11-10 10:32; follow-up to work order 29, landed as `478a129`).

## Why
Work order 29 wrote three lists (`work/29-lead-types/real-estate.json`, `insurance-financial.json`, `statuses.json`). Platform
(HEAD_Platform-build_2026-11-09, its work order 20) builds the CRM's "Lead type" and "Status" columns from them as
`crm.lead_types` and `crm.statuses`. Every entry's `sources[].says` is meant to be the page's own words, but those quotes were
copied by readers using WebFetch, which hands back a model's rendering of the page, not the page. Only 32 of the 91 distinct
(url, says) pairs were re-checked, and which 32 was not recorded. So all of them are checked again here, by a script that
fetches the page itself and looks for the quote in the page's text. A check that does not share its answer with the first
reader is the point: no WebFetch for the check.

Second: insurance `policy-review` rests on a weak source. Its first source,
`https://www.agencybloc.com/ams/sales-enablement/lead-and-sales-management/how-to-recruit-insurance-agents`, answers 301 to a
different page, and that page is a recruiting/social-media article that mentions "scheduling a policy review" in passing. Find a
better public source.

## Inputs (load these, nothing else)
- `CLAUDE.md` (rules 2, 3, 4, 7), `work/29-lead-types/proof.md` (the BLOCKED table and the URL list), the three JSON files
- `tools/omnikom-cli/lib/browser.mjs` header (lines 1 to 30) only if step 3 needs it
- Public web only, as in 29: no logins, no paid APIs, no forms submitted.

## Hard rules
- Never request these hosts (they answered 403 in 29; recorded BLOCKED, not retried, never read through a browser):
  help.followupboss.com, help.lofty.com, www.sierrainteractive.com, www.luxurypresence.com, www.zillow.com,
  developer.salesforce.com, help.wealthbox.com. The script must refuse them by a list in its code, and its test proves it.
- One request per distinct URL (about 40). At least 2 seconds between two requests to the same host. A plain User-Agent that
  names the tool. Follow redirects; record the final URL and every status.
- Any 403, 429, CAPTCHA or bot-wall page: record BLOCKED (host, status, date), stop that host for the rest of the run, never
  retry, never open it in a browser.
- Machine memory is tight (a video job spikes to about 7 GB): one request at a time, at most one headless browser, closed after.
- Never change an `id` or a `name`, never add or drop a type or status: platform builds on them. Only `sources` change (fix a
  `says` to the page's exact words, replace a source, add one). A type or status that loses all its sources is NOT fixed by you:
  list it under "Needs the head" in the proof.
- No em dashes in anything you write (count them with `String.fromCharCode(0x2014)`, like 29's proof).
- Do not commit or push; the head does. Scripts go in files, never `node -e`.

## Steps
1. Write `work/32-lead-types-second-read/check-quotes.mjs` (Node, no dependency). It reads the three JSON files, collects every
   source with an `http` url, and for each distinct url fetches the page once, turns the HTML into text (drop script, style and
   tags, decode entities, collapse whitespace), and for each quote on that url gives one verdict:
   EXACT (the quote, whitespace-collapsed, is in the text), CASE-OR-PUNCT (equal after lower-casing and normalising quotes,
   dashes and apostrophes), NOT-FOUND, BLOCKED, GONE (404 or 410), or NEEDS-RENDER (the page's text is under about 1,500
   characters, or holds a script-app marker, and the quote is not in it). It writes `quotes.json` (one row per (file, entry id,
   url, says): verdict, HTTP status chain, final URL, and for NOT-FOUND the closest 200-character window of page text, found by
   shared words) and prints a count per verdict. Exit 0 when every quote has a verdict; it is a reader, not a gate.
2. Test it: `check-quotes.test.mjs` against a local server (no network) with a page that holds a quote, one that does not, a
   redirect, a 404, a 403 and a tiny script-app page; and a call naming a blocked host that must make no request. Watched-fail:
   break the matcher (for example compare without collapsing whitespace) and paste the test going red for that reason, then
   restore.
3. Run it for real. For NEEDS-RENDER rows only, open that one URL in the repo's headless browser (`tools/omnikom-cli/lib/browser.mjs`,
   `launchBrowser`, `newPage`, `open`, then the page's text through its DevTools connection) and check again; record the
   verdict with "rendered". Never do this for a BLOCKED host.
4. Fix what the run shows, in the three JSON files:
   - CASE-OR-PUNCT: replace `says` with the page's exact words.
   - NOT-FOUND or GONE: if the page (as fetched) still supports the entry in other words, replace `says` with its exact words and
     set `readAt` to today. If it does not, drop that source; when the entry keeps another source, fine; when it would keep none,
     do not drop it: list it under "Needs the head" with what you found.
   - Each entry's top-level `note` that counts second-read quotes: rewrite it from the real numbers.
5. Policy review: find at least one public page where an insurance agency's site, a quote-form builder, or an insurance CRM or
   agency system names a policy or coverage review request as a thing a visitor or client asks for (for example "request a
   policy review", "annual insurance review", "coverage review"). Fetch it with the same script (a `--url` mode) so its quote
   is checked the same way. Replace the agencybloc source with it; keep smartasset's only if it passes step 3 (it is about a
   retirement review, so say whether it really supports "policy review"). If no page is found after an honest search (say how
   many searches and which), keep the type, mark its sources UNPROVEN in the proof, and list it under "Needs the head".
6. Write `work/32-lead-types-second-read/proof.md`: the commands and their pasted output (the test, the watched-fail, the real
   run's counts), a table of every changed source (entry, old says, new says or dropped, why), the BLOCKED hosts met in this run,
   "Needs the head", and what is still UNPROVEN. Keep `quotes.json` beside it.
7. Re-run 29's sanity checks on the edited files: every type and status still has at least one source with url, readAt and says;
   ids unchanged (compare against `git show 478a129:work/29-lead-types/<file>`); 0 em dashes. Paste the output.

## Done means
The test passes and its watched-fail is pasted; the real run gave every quote a verdict; the JSON files' sources match their
pages (or the gap is listed); policy-review has a checked source or is listed; the proof says what it does not prove. Then tell
the head (HEAD_SEO-and-audits_2026-11-09) in a short message what changed, with the counts.
