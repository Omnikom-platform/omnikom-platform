# SOP: back up a client's or prospect's website (step 1 of every audit)

Why first: the backup is our copy of the site's code (every page's HTML, scripts, styles, images, sitemaps and a record of every
request the page made). Nothing else touches the site, and no research starts, until the backup is verified (owner, 2026-10-26).
It is also the base a draft website is built from (Francine, Eli).

Tool: `site-backup` (Node + Playwright). Newest copy: `E:\Alex Sevilla\tools\site-backup` (2026-10-26, includes the ELEV8 fixes
below); first version: `E:\Francine & Eli\tools\site-backup`. Its README lists every trap with its handling: keep it with the tool.

## Steps
1. **Look first (browser, read only).** Open `/robots.txt` and every sitemap it names; count URLs per child sitemap; note
   listing-search feeds that could rate-limit. Write `PLAN.md`: what you saw, `--sitemap`, exclusions and why.
2. **Find the pages the sitemap misses.** Sitemaps are often incomplete (ELEV8: 20 URLs, all 9 agent profile pages missing). From
   the saved home page HTML and the site's own HTML sitemap / directory pages (no extra requests), list important internal pages
   and pass them with `--extra` (explicit list; never scrape every link).
2b. **IDX / listing search (owner rule 2026-10-26): a blocked wall, design only.** Any route backed by an IDX integration (Brivity
   IDX, Luxury Presence `/home-search`, any MLS feed) is treated as a wall: we never pull listings from it, never collect, store,
   count or reuse listing data, and never crawl its search variants or listing pages. It rate-limits, never "settles" on the
   automated phone pass, and its content is licensed MLS data, not the client's. We only need **how it looks**: capture exactly **one search results page** (the main home-search / search page) and
   **one listing detail page**; exclude every other search variant and listing (`--exclude-pages` for the feed's paths, plus the
   two chosen URLs in `--extra`). Check those two in the browser by hand (phone and desktop) and list them in `VERIFY-EXCEPTIONS.md`
   if the automated phone pass fails.
3. **Run** (PowerShell, never Git Bash, which rewrites `/` arguments), in the background:
   `node backup.mjs --site https://<host> --sitemap <url> --extra "<paths>" --out "<backups>/<host>_<YYYY-MM-DD>"`
   WordPress: add `--raw-variant "?nowprocket=1" --wp-api`. A run that dies: move its folder to `backups/_stopped/<name>_runN-<why>`
   (never delete), fix the cause, start again.
4. **Watch page 1 finish** (the folder has `capture.har.zip`, `desktop.webm`, `mobile.png`) before going idle: a stall is only seen
   if someone looks.
5. **Verify:** `node verify.mjs --out <dir>` must exit 0 (gates G1-G7; G4 = offline replay; never `--no-replay`). Then
   `node view.mjs --out <dir> --gallery`, `node page-facts.mjs --out <dir> --json`.
6. **A failed gate is a question: tool or site?** Reproduce the one page in isolation, find the exact request or element, then
   decide. A tool limit is fixed in the tool (with a test that fails on the old code) and a row added to the README traps table;
   a site defect becomes an audit finding. Never call it a site problem from one failed load.
7. **The Lead re-runs verify itself** and only then opens the gate for the next phase.

## What the tool does on every page (desktop and phone)
Opens it and waits for the network to go quiet; makes every lazy image load now; scrolls slowly to the bottom (half a screen a
step, waits for on-screen images up to 4 s, follows a growing page up to 300 steps); waits, scrolls back to the top; starts lazy
background videos; waits until "settled" twice in a row (images done, no spinner or skeleton, text stable, network quiet); only
then saves HTML, screenshots, scroll videos, every file and the request record. It never clicks: content behind a click (tabs,
"load more", pop-ups) is checked by hand in the browser. Politeness: honest user agent `OmnikomSiteBackup/1.0`, 8 s between pages,
robots.txt obeyed, one 429 = 90 s pause, a second 429 stops the run.

## Traps found per site (each one is handled in the tool now)
| Site / platform | Trap | Handling |
|---|---|---|
| Francine (Luxury Presence), Eli (WordPress), 2026-10-16..17 | junk pages from a scraper, shared HTTP cache (status -1 in the HAR), 429 rate limits, lazy slider images, lazy background videos, fixed waits, parallax screenshots, cookie banner, big video downloads, media library not shown on pages | see the tool README table |
| ELEV8 (Brivity), 2026-10-26 | the user agent carried another client's name | renamed `OmnikomSiteBackup/1.0`; never put a client's name in a tool's user agent |
| ELEV8 | a reCAPTCHA Enterprise web worker kept the request record from closing; the run sat 11 min on page 1 | close the page before the context; context close capped at 180 s (recorded). Never block reCAPTCHA |
| ELEV8 | one network error with no HTTP answer ended a run in its first second | one retry per URL after 20 s for a plain network error |
| ELEV8 | the sitemap writes `&` as `&#38;`; only `&amp;` was decoded, so search URLs were cut short | all XML entities decoded (`decodeXmlUrl`), URLs compared normalised (`normUrl`); `test-urls.mjs` proves it |
| ELEV8 | several query pages on one path got one folder name (named from the query's last 12 characters) | readable start + hash of the whole query (`pageSlug`) |
| ELEV8 | the 4 IDX listing-search pages (`/search?multi_search=...`, Brivity IDX, MLS feed) never "settled" on the automated phone pass, though a person's phone view shows the listings and an offline phone replay settles in 2 s | owner rule (2026-10-26), step 2b: capture one search page + one listing page for the design only; exclude the rest of the feed; hand-check those two; list them in `VERIFY-EXCEPTIONS.md` if needed. Same family as Francine's `/home-search` |
| ELEV8 | finished listing cards keep a CSS class "loading" | a loader counts only if visible and still empty (`countLoaders`, `test-loaders.mjs`) |
| ELEV8 | the offline replay read pages without scrolling or waiting (82-88% of live text) | the replay scrolls bottom-then-top and waits for the text to settle, like the capture |
| ELEV8 | two platform stylesheets answer 403; the record keeps them with no answer and the offline replay hung on them | replay aborts requests the record holds with no answer (`harUnanswered`); the 403 itself is an audit lead |

## Measured times
- Francine: 94 pages in 2 h 49 min (2026-10-17). ELEV8 run 4: about 1.5 min per page (35 pages, 2026-10-26). Verify adds an
  offline replay of every page (minutes, no site requests).
- ELEV8 needed four runs before a clean one (hang, network error, sitemap entities). Budget for one or two restarts on any new
  website platform; each fix stays in the tool.

## Measured times (ELEV8, elev8ca.com, 2026-10-26)
From the run logs, not estimates. Use them to plan; a new site can differ.
| Step | Time | Source |
|---|---|---|
| Backup run 4 + resume, 35 pages (8 s between pages, HAR, phone + desktop passes) | 1 h 50 min (14:00:31 to 15:50:14 UTC) | `backups/www.elev8ca.com_2026-10-26/backup.log` |
| Runs lost before the fixes in this SOP (hung HAR, "fetch failed", entity URLs) | 3 runs stopped; run 1 hung 11 min on page 1 | Alex Sevilla `.claude/POSITION.md` |
| Verify (G1 to G7) to backup gate signed | gate signed 16:08 UTC, 18 min after the run ended | `icm/gate/BACKUP-GATE.md` |
