# Stage: migrate (mode `migrate <old url> <new repo|url|folder>`)

Load this file only when a site is being replaced. Replacing an existing site is where rankings are lost, and almost all of the
loss is avoidable: addresses that used to earn traffic and links stop working, or send people to the homepage, or take three
hops to arrive. This stage keeps a list of every old address, decides where each one goes, freezes a baseline before the
cutover, proves the redirects work, and watches the numbers for 4 weeks after.

Plain words for the owner: a *redirect* tells visitors and Google "this page moved here". It must be a **301** (permanent) and
take **one step**. A chain of steps, a temporary (302) redirect, a jump to the homepage or a dead end loses what the old page
earned. Free sources only; every script here reads files and, only when the main session says so, one live site, politely.

## Inputs
| Input | Where | If missing |
|---|---|---|
| Old site snapshot (pages, titles, sitemap) | `site-checks/<old host>/snapshots/<date>/` from `live-target.mjs` | snapshot part BLOCKED: take one (polite, 4 s apart, robots obeyed, stop at the first 429) |
| Old sitemap, live | `--fetch-sitemap` (one cached GET per sitemap file, honest user agent, gap, stop at 429) | taken from the snapshot only |
| Traffic per old page | a Search Console export `--gsc-file rows.json` (`[{page, clicks, impressions}]` or `{windowDays, rows}`), or `--gsc-days 90` through the API (token needed), or the latest `measure` run | BLOCKED: nothing can be called "traffic" |
| Pages with links | Search Console > Links > Top linked pages export (`--links-csv`), or Bing `GetLinkCounts` (`--bing-links`, needs `BING_WEBMASTER_KEY`) | BLOCKED: Common Crawl is domain level only and cannot say which page is linked |
| The new site | a built folder (`dist/`, with its `_redirects`), or a URL (its sitemap) | refuse: there is nothing to map to |
| Owner overrides | `--overrides file.csv` (`from,to`) | none |
| Measure runs | `<pewp>/measure/<date>/` | the baseline's rankings, AI citations, authority and field speed are BLOCKED ("run measure before the cutover") |

State is in `site-checks/<old host>/.pewp/migrate/` (the old host is the target). Run from PowerShell.

## The stages (each re-runnable on its own; each reads and writes files)
`node "<skill>/scripts/migrate.mjs" <old url> <new folder or url> --stage <inventory|map|baseline|gate|monitor|all> [options]`
Options: `--gsc-file --gsc-days --links-csv --bing-links --fetch-sitemap --overrides --home-ok /p1,/p2 --min-score 0.5
--new-origin <url> --gap-ms 1000 --max-urls 500 --probe-old --cutover YYYY-MM-DD --snapshot-dir --include-suggestions --today
--exclude "<regex>"` (repeatable; the client site's off-limits paths, e.g. `^/home-search`: the gate and `--probe-old` never request
them and list them as not checked; run from PowerShell, Git Bash rewrites `^/x` and the script refuses it).
Exit codes: 0 ok, 1 the gate failed, 2 usage, 3 stopped at a 429. BLOCKED parts are listed in the output and `report.json`.

### 1. inventory -> `migrate/inventory.json`
Every old address from: the snapshot's pages (with status, titles, headings, word counts, and the redirect the old site already
did), the sitemap, Search Console pages (query strings merged into the path), and pages with links. Each row has the sources
that named it, clicks, impressions, links, and `mustKeep`. **mustKeep** = it has clicks, or page-level links, or at least 20
impressions, or it is the homepage. Only mustKeep rows are gated; the rest are still mapped. Addresses are compared as paths
(`normPath`: no origin, no query, no `index.html`, no trailing slash). Tell the owner how many addresses exist and how many matter.

### 2. map -> `redirect-map.csv`, `redirect-map.json`, `_redirects`, `carryover.json`
For every old address, in order, the first rule that applies:
1. **owner override** (`from,to` CSV): approved.
2. **same path** exists on the new site: no rule needed (method `same`). If the old site already redirected it, its destination
   is what is looked up, so the new rule is one hop from the original address (method `exact`).
3. **normalised** match (same path after dropping `.html`/`.php`, case and trailing slash): approved automatically.
4. **similarity** (slug words 60%, title words 40%, same top-level section +5 points; candidates exclude the homepage):
   a **suggestion at or above `--min-score`** (default 0.5), shown with its score and the next best alternatives, **NOT active**
   until the owner approves it. It is a guess by name, never a decision.
5. **no target**: `NO TARGET`. Never the homepage. The owner decides (see below).
Then the guards: a rule that points at the homepage is flagged `HOMEPAGE` and held back unless the old address is listed in
`--home-ok` (a homepage redirect is treated as a soft 404 by search engines); a rule whose target is itself the source of another
rule (in this map or in the new site's own `_redirects`) is **collapsed to the final destination** and flagged `CHAIN collapsed`;
a loop is flagged `LOOP` and held back; an override whose target is not on the new site is flagged and held back.
**The review loop.** `redirect-map.csv` is the source of truth after the first run. Columns: `from,to,status,method,score,
approved,mustKeep,clicks,impressions,links,flags,reason,alternatives`. `approved` is `auto` (certain), `yes`/`no` (the owner), or
blank (waiting). The owner (or you, with the owner's answers) edits `approved` and `to`; re-running `--stage map` keeps those
edits. Present the waiting rows as **pickable options, recommended first, grouped by traffic** (project rule 4), for each
address with no safe target: map it to the nearest page (recommended when one is clearly the same topic), answer 410 Gone
(only when the content is gone for good and has no links), or build a new page for it (when it has traffic or links).
`_redirects` (Cloudflare Pages format) contains only approved rows as `/old /new 301`; every other row is a comment
(`# REVIEW`, `# NO TARGET`, `# SKIPPED`) so the file explains itself. `--include-suggestions` activates unreviewed guesses and
should be used only for a throwaway preview. Cloudflare Pages limits: 2,000 static rules and 100 dynamic ones (with `*` or `:`);
an address containing `*` or `:` is skipped and listed, never written as a pattern by accident. The file must sit in the root of
the build output (`dist/_redirects`), not the repo root. Pages already answers `/page.html` with a 308 to `/page` by itself;
an explicit rule still wins and keeps it one hop.
**carryover.json**: for every mapped mustKeep page, the old title, heading, description and word count next to the new ones,
with flags: title changed, the page's top queries (from Search Console query x page) are missing from the new title / heading /
description, the new page has under 60% of the old word count. Use it to put back what ranked, not to rewrite the design: a
title that earned its position is kept or improved, not replaced by a brand slogan.

### 3. baseline (before the cutover) -> `baseline-<date>.json`
Freeze what the site earns today so the monitor has something to compare with: traffic and links per mustKeep page and the
window it covers, old status codes (`--probe-old` GETs each mustKeep old address once, politely, to record status and hops
before anything changes), and from the latest `measure` run the target-query rankings with city and device, AI citation shares,
referring domains (domain level) and field speed. **Run `measure` first** so the baseline has them; without it those parts are
BLOCKED with that instruction. Re-baselining after the cutover is wrong: the baseline is "before".

### 4. gate (after the new site is deployed, or on its preview) -> `gate-<date>.json/.md`
For every mustKeep old address: GET the new origin + the old path, **never follow redirects automatically**, count the hops.
PASS only when it ends at **200** in **at most one hop** and that hop is a **301 or 308**. FAIL when: more than one hop (a chain);
a 302/307; a loop; it ends at a 404/410/5xx; it ends at the homepage and the old address was not the homepage (nor `--home-ok`).
WARN when it lands somewhere other than the map says (the rule is not live yet or differs). GET only, honest user agent,
`--gap-ms` apart (default 1000 for the new site; the OLD live site, read by `--probe-old` and `--fetch-sitemap`, defaults to 4000 like snapshot-site; below 1000 only when every site the run requests is on this machine, else exit 2), `--max-urls` 500, `--exclude` paths never requested,
**the first 429 stops the run** (exit 3, the rest reported "not checked"). Run it against the preview (`--new-origin https://<project>.pages.dev`) before the
DNS change and again right after. A preview that is noindex by design still has to redirect correctly.
The gate passes (exit 0) only when every mustKeep address passes and none was left unchecked.

### 5. cutover day (the main session, with the owner)
1. Baseline exists and is dated before today. 2. Gate passes on the preview. 3. `_redirects` is in the build output.
4. Keep the old domain, never let it expire; if the domain changes, use Search Console's change of address and keep the 301s for at
least a year. 5. Submit the new sitemap, keep the old one reachable for a few days so Google re-crawls the old addresses and finds
the 301s. 6. Run `--stage gate` again on the live origin, then `measure` the same day. 7. Record the cutover date:
`--stage monitor --cutover YYYY-MM-DD` stores it in `migrate/state.json`.

### 6. monitor (daily for 28 days after the cutover) -> `monitor-<date>.json`
Each day: run `measure` (it writes the Search Console pages for the new addresses), then `--stage monitor`. For every baselined page
(traffic or links) it compares the clicks of the new address in the latest window with the baseline rate scaled to the window
length; **dropped** = below the 95% Poisson interval of that expectation (06 section 9.8), **not seen at all** = zero
impressions for a page that had clicks. It reports the day number, the end of the monitoring period (cutover + 28 days), the
total clicks against expectation. Search Console is about 3 days late and a fresh site needs 1 to 2 weeks to settle, so read
a trend, not a day. Triggers to act on: a mustKeep page dropped for 7 days in a row, a page not seen at all after day 10, total
clicks under 70% of expectation after day 14. Action: re-run the gate, check that page's rule, title carry-over and
canonical, and fix the rule (a redirect to a better page, not to the homepage). After day 28 report the final comparison and stop.

## Output for the owner (`report.md` / `report.json`)
One line first ("every old address that matters reaches a working page in one step" or how many do not), then plain words:
how many old addresses exist and matter, how many rules are certain, how many are guesses waiting for the owner, how many
pages have no match, what was held back and why, the gate result, the baseline's missing parts with their unblock steps.
Explain *redirect*, *301*, *chain* once.

## Pitfalls (each one has cost a real site its ranking)
- Redirecting everything to the homepage "to be safe". Search engines treat it as a soft 404 and the pages' history is lost.
- Letting a similarity guess go live without the owner. Names that look alike are often different offers.
- Redirects that work in the browser but chain through `http` -> `https` -> `www` -> path: check the gate on the final origin.
- Trailing-slash and case variants of the same address both getting traffic: the inventory merges query strings, not slash/case
  variants; decide the canonical form and map the others.
- Leaving the old site's title and content on pages that ranked, then replacing them with new copy. Use `carryover.json`.
- Taking the baseline after the cutover, or from a window that includes a spike.
- A preview or staging site that blocks crawlers (noindex, robots) copied to production. The audit's launch-state rule catches it;
  re-check on the live origin.
- Treating Common Crawl as page-level link data. It is domain level; page-level links come from the Search Console / Bing exports.
- Forgetting that Search Console reports the *new* address after the move: monitor maps old -> new through the map file.

## Not built
Automatic detection of soft 404 content on the new pages; hreflang and canonical rewriting across the move (the checklist covers
them on the new site); log-file analysis of Googlebot hits (needs the host's logs, an owner export); a live crawl of the old site's
internal links to estimate internal link equity (the snapshot is capped at 20 pages by design).

## Proof
`node scripts/test-measure.mjs` covers the inventory, the map (including a redirect chain in the map and a redirect to the
homepage that must be flagged), `_redirects`, carry-over, the gate (chain, 302, 404, loop, homepage, 429, pass), baseline and
monitor on a fixture old/new pair and a local server; `--mutants` breaks each guard in turn and requires the right check to
go red. No live site is touched by the tests.
