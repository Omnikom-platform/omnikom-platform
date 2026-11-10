# Work order 32: proof (2026-11-10)

Nothing committed or pushed. Files here: `check-quotes.mjs` (the reader), `check-quotes.test.mjs`, `sanity.mjs` (step 7), `quotes.json` (the real
run, one row per source), `run1.out` / `run1.err` (its output and per-URL status lines), `s5-*.json` (the three policy-review pages, step 5),
`bycount.mjs` (per-file counts), `show.mjs` (prints the rows that are not EXACT), this file. Edited: the three JSON files in
`work/29-lead-types/` (sources and the top-level `note` only; step 7 proves it).

## Step 2: the test, and its watched-fails

`node --test work/32-lead-types-second-read/check-quotes.test.mjs` (local server only, no request leaves the machine):

```
✔ verdicts: exact, case or punctuation, not found, redirect, gone, blocked, needs render
✔ a 403 stops the host: the next URL on it is not requested
✔ one request per distinct url, and the per-host gap is kept
✔ the 7 never-request hosts make no request, directly or by redirect
✔ htmlToText: drops script, style and comments, decodes entities, joins inline tags
ℹ tests 5   ℹ pass 5   ℹ fail 0
```

Watched-fail 1, the matcher: `htmlToText` changed from `collapse(decodeEntities(h))` to `decodeEntities(h).trim()` (whitespace no longer collapsed):

```
✖ verdicts: exact, case or punctuation, not found, redirect, gone, blocked, needs render
    actual: 'CASE-OR-PUNCT',   expected: 'EXACT'
✖ htmlToText: drops script, style and comments, decodes entities, joins inline tags
    actual: 'Café & bars! A  next',   expected: 'Café & bars! A next'
ℹ pass 3   ℹ fail 2
```

Watched-fail 2, the never-request list: `if (blockedHosts.includes(host)) return` changed to `if (false) return`. The test's fetch spy throws instead of
touching the network for those hosts, so this was safe to run: `✖ the 7 never-request hosts make no request, directly or by redirect`,
`ℹ pass 4 ℹ fail 1`.

Both mutants were applied by a one-off `node -e` patch that asserted its target text existed (a breach of "scripts go in files" for a throwaway
patch, said here), then `check-quotes.mjs` was restored from a copy: sha256 before and after identical
(`f86b10ac3dea0f8d0bd5118e1ab192160f671448cde2517a19d9ad03ac874d16`), 5 of 5 green again. Afterwards the file was edited twice more, on purpose: two
literal em dash characters in its character tables were replaced by `String.fromCharCode`, and `--url` mode got a `textHead` field; the test was
re-run after that, 5 of 5 green. The real run in step 3 ran on the version before those two edits (same character sets, same matching).

## Step 3: the real run (`node work/32-lead-types-second-read/check-quotes.mjs`, exit 0)

```
104 http source rows, 40 distinct urls, 91 distinct (url, says) pairs
BLOCKED        4
EXACT          97
NOT-FOUND      3
rows 104  urls 40  hosts requested 30
```

Per file (`node bycount.mjs`): real-estate 32 rows (26 distinct quotes) all EXACT; insurance-financial 31 rows (28 pairs): EXACT 25, BLOCKED 4,
NOT-FOUND 2; statuses 41 rows (37 pairs): EXACT 40, NOT-FOUND 1. 26 + 28 + 37 = 91, the 91 distinct pairs 29 counted, so the script and 29
agree on what was cited. 0 CASE-OR-PUNCT, 0 GONE, 0 NEEDS-RENDER, 0 ERROR.

One request per distinct URL: 40 URLs, 41 stderr status lines in `run1.err` (the first is the count line), one status chain each (redirects are
hops of one URL: 11 URLs redirected, longest 301>301>301>200; 1 URL answered 403). At least 2 s between two requests to one host, kept by the reader (tested).

**Step 3, the browser: not used.** 0 rows were NEEDS-RENDER, so no page was opened in a browser. The `--render` mode of the script is written but
UNPROVEN: it was never run.

## BLOCKED hosts met in this run
| Host | Status | Date | What |
|---|---|---|---|
| agencyheight.com | 403 | 2026-11-10 | `/insurance-intake-form/`, requested once; the reader stopped the host, so nothing else was sent. Not on the order's list of 7: a NEW blocked host. Four entries cite it (auto-quote, home-quote, life-insurance, commercial-quote); each has a second source that is EXACT |

None of the 7 listed hosts is cited by a source in the three files (29 recorded them BLOCKED and cited nothing from them), so none was in the run; the
test proves the script would not have requested them. No 429, CAPTCHA or bot wall was met.

## Step 4: every changed source
| Entry | Old says | New says or dropped | Why |
|---|---|---|---|
| insurance `mortgage-protection` | "MPI is term life with mortgage framing" (agenttech.io) | "ordinary term life with a face amount and term length tuned to a mortgage balance and amortization schedule", readAt 2026-11-10 | NOT-FOUND (a paraphrase). The page's own sentence, taken from the 200-character window the run stored, says the same thing |
| insurance `mortgage-protection` | "it has its own predictable lead channels" (agenttech.io) | dropped | NOT-FOUND. The stored window ends "What makes MPI a distinct vertical for an agency is", and the page has "Each channel has its own"; the words that finish the sentence are not in the window and a second request is forbidden, so no exact words could be taken. The entry keeps the fixed agenttech source and policygenius (EXACT) |
| statuses `appointment-set` | "How many of the requested quotes became scheduled appointments?" (agencybloc 3-ways-to-convert) | dropped | NOT-FOUND on a page that rendered fully (200 after a 301); the closest window shares almost no words with the quote. The entry keeps support.realgeeks.com "Appointment Set" (EXACT) |
| insurance `policy-review` | "like scheduling a policy review" (agencybloc how-to-recruit-insurance-agents) | replaced | The URL answers 301>301>301>200 to a recruiting article; the quote is a passing mention (it was EXACT on that page, which is the weakness the order named) |
| insurance `policy-review` | "Schedule a 20-Minute Retirement Income Review" (smartasset) | dropped | It was EXACT, but it is a retirement income review sold by an adviser: it supports `retirement-planning`, not a review of an existing policy. Not kept |
| insurance `policy-review` | | added erdmaninsurance.com: "Request an annual insurance review and one of our agents will review your policy to maximize savings and ensure everything is up to date!" | An agency site naming it a thing a client asks for (menu "Request an Annual Insurance Review", form field "Policy to be reviewed:"). EXACT by the script's `--url` mode |
| insurance `policy-review` | | added chrisbonnerinsurance.com: "Request Policy Review" | An agency site, in its Service menu next to "Report a Claim" and "Make a Payment"; the page's own title is "Review Your Insurance Policies With an Insurance Professional" and the page also holds "request a policy review" in another case (CASE-OR-PUNCT). The quote kept is the menu text, in the first 1,500 characters stored |
| insurance `policy-review` | | added jotform.com: "Insurance Policy Review Appointment Form" | A quote-form builder's template name (EXACT, the page title). It shows a form builder offers it, not that a visitor asks; the two agency pages carry that |

The other 94 EXACT rows were left alone. The top-level `note` of each file was rewritten from these numbers.

## Step 5: policy review search
3 web searches (`"request a policy review" insurance agency website`; `insurance agency "annual insurance review" request form clients coverage review`;
`insurance website lead forms "policy review" request form template agent CRM`), 3 pages fetched with `--url` mode (one request each, a few seconds
apart, three different hosts: erdmaninsurance.com 200, chrisbonnerinsurance.com 200, jotform.com 200), all three EXACT or CASE-OR-PUNCT on the quoted
words. The first search alone listed about 10 independent agency pages with the same offer (Performance Insurance Agency, New York Choice, McGarity, Island Wide,
Insurance One and others; seen only as search results, not fetched). `policy-review` therefore has 3 checked sources and is NOT listed under "Needs the head".

## Step 7: sanity checks on the edited files (`node work/32-lead-types-second-read/sanity.mjs`, run from the repository root)

```
real-estate.json: 15 types, 15 with at least one source (url, readAt, says)
real-estate.json: ids and names unchanged vs 478a129 (order too): true
real-estate.json: nothing but sources and the top-level note changed
insurance-financial.json: 15 types, 15 with at least one source (url, readAt, says)
insurance-financial.json: ids and names unchanged vs 478a129 (order too): true
insurance-financial.json: nothing but sources and the top-level note changed
statuses.json: 19 statuses, 19 with at least one source (url, readAt, says)
statuses.json: ids and names unchanged vs 478a129 (order too): true
statuses.json: nothing but sources and the top-level note changed

changed sources (9): see `sanity.out` for the full lines; 5 removed, 4 added, each added line ends "in the page text held: true"
em dashes in work/29-lead-types/real-estate.json: 0
em dashes in work/29-lead-types/insurance-financial.json: 0
em dashes in work/29-lead-types/statuses.json: 0
em dashes in work/32-lead-types-second-read/proof.md: 0
em dashes in work/32-lead-types-second-read/check-quotes.mjs: 0
em dashes in work/32-lead-types-second-read/check-quotes.test.mjs: 0
em dashes in work/32-lead-types-second-read/sanity.mjs: 0

all checks passed
```

(Only the 9 changed-source lines are abbreviated above; the complete output, exit 0, is saved in `sanity.out`.)

Watched-fail: the same script with `--mutant` (first entry of each list loses its sources and its id) printed 6 `FAIL` lines (entries without a
source, ids or names changed, for all three files) and exited 1. The first run of the real script also went red, once, on 2 literal em dashes in
`check-quotes.mjs`; fixed, then green. The output above is from a re-run after this file was written, so its em dash count (0) covers this file too.

## Needs the head
- Nothing lost all its sources: no type or status is left without one.
- `agencyheight.com` (403, new BLOCKED host): its 4 quotes (auto-quote, home-quote, life-insurance, commercial-quote) are UNCHECKED and left in
  place. Decision for the head: keep them marked unchecked, or drop them (each entry keeps its uplead.com source, EXACT).
- Add `agencyheight.com` to the never-request list in `check-quotes.mjs` and to the BLOCKED table of 29's proof if the head agrees.

## What this does not prove (UNPROVEN)
- EXACT means the words are in the page's text as a plain HTTP fetch returns it. It does not mean the page supports the type: 24 of the 97 EXACT rows
  are quotes under 30 characters (for example "Appointment Set", "Seller Lead Forms", "Under Contract", "Unqualified"); a short phrase can sit in a menu
  or a footer. They prove the label exists on that page, not that the page uses it as a lead type or status.
- The 4 agencyheight rows, and every page behind a script app: no page needed rendering in this run, but the script's NEEDS-RENDER test is a size
  and marker heuristic (text under 1,500 characters, an empty mount div, or an "enable JavaScript" message); a long page whose text is missing the
  quote is reported NOT-FOUND, not NEEDS-RENDER.
- The run kept only a 200-character window of page text for rows that failed, and did not save page text. Two fixes therefore rest on that window (mortgage-protection);
  anything longer would have needed a second request, which the order forbids. A future run should save page text.
- The three new policy-review pages: "Request Policy Review" (Chris Bonner) and the Jotform title are labels, not a sentence about a client asking.
  Erdman's sentence is the strong one.
- `--render` mode was not run (no NEEDS-RENDER rows).
- Pages change; every verdict is for 2026-11-10 only.

## Head's check (HEAD_SEO-and-audits_2026-11-09, 2026-11-10 10:55)
- `node --test work/32-lead-types-second-read/check-quotes.test.mjs`: "tests 5, pass 5, fail 0". `node work/32-lead-types-second-read/sanity.mjs`: "all checks passed".
- The four new quotes re-read with curl and grep (not this script, so the check does not share its code): erdmaninsurance.com,
  chrisbonnerinsurance.com, jotform.com and agenttech.io each printed FOUND.
- Head's ruling on agencyheight.com (403 in this run): its 4 quotes stay in place, unchecked, as each file's note says; every one
  of those 4 types keeps another EXACT source. The host is added to `BLOCKED_HOSTS` (and the test's expected list); tests re-run
  5 of 5.
