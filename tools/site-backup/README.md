# site-backup: browser-rendered website backup that checks itself

> ELEV8 copy (2026-10-26): copied from `E:\Francine & Eli\tools\site-backup`; the user agent is renamed `OmnikomSiteBackup/1.0`
> (lib.mjs) so no other client's name reaches elev8ca.com. The Francine / Eli command lines below are that project's record,
> kept for the options they show; nothing from that project enters this one. The ELEV8 run line is in `icm/phase-0/CONTEXT.md` (P0.1).

```
# Francine's site: no new capture until LAWYER Q-78 is answered (DEFAULTS DEF-06, GOTCHAS); the line below is the 2026-10-17 run, kept for the record
node backup.mjs --site https://valleytovalleyrealty.com --out "<dir>" --exclude-sitemap "home-search/sitemap-listings" --exclude-pages "^/home-search"   # /home-search is a rate-limited feed, done by hand (owner decision); the tool also refuses it by default on this domain
node verify.mjs --out "<dir>"            # independent gates G1-G7, exit 1 on any failure (G4 = offline replay; never pass --no-replay for a real verify)
node view.mjs --out "<dir>" --gallery    # index.html with screenshots + scroll videos per page
node view.mjs --out "<dir>" --page /     # open one page fully offline (served from its HAR)
node test-verify-gates.mjs --out "<dir>" # breaks a copy on purpose; proves the gates go red
node summarize.mjs --out "<dir>"         # per-page load/scroll/429/video summary
node compare-backups.mjs --old <old> --new <new>   # is everything real in an old backup also in the new one? (read-only)
node page-facts.mjs --out "<dir>" [--json]          # one row per page: title, meta, H1s, schema, canonical, robots, forms, trackers (read-only)
```

**WordPress sites** (e.g. Eli's): add `--raw-variant "?nowprocket=1"` (clean HTML before WP Rocket rewrites it)
and `--wp-api` (public REST content: pages, posts, media, categories, tags, root; never `/users`; plus **every
media-library original**, including uploads no page shows). Pages outside the sitemap go in `--extra`; pages that
redirect off-site go in `--exclude-pages`. Runs with the current tool also save the sitemaps they read to `sitemaps/` (Eli's 2026-10-17 capture has them; Francine's capture predates this and has none).

Eli's full capture:
```
# Eli's site: no new capture until LAWYER Q-80 is answered (REsimpli terms s.9; DEFAULTS DEF-06); the line below is the earlier run, kept for the record
node backup.mjs --site https://www.elibuyshomes.com --out "../../backups/elibuyshomes.com_<date>" --extra "/account/site/,/account/site/keyword-ranking-details/" --exclude-pages "^/account/$" --raw-variant "?nowprocket=1" --wp-api
```
Run from **PowerShell**. Git Bash rewrites `/` arguments into `C:/Program Files/Git/` (seen; the tool refuses it).
`npx` breaks on the `&` in "Francine & Eli"; call `node node_modules/playwright/cli.js ...` directly.

## Traps found while building it (each one is handled in code; don't remove the handling)

| Trap | What went wrong | Handling |
|---|---|---|
| Junk "pages" | The first clone tool scraped URLs out of JS/CSS and saved font names and `+imgurl+` as pages (766 junk files) | Page list = sitemap only (+ explicit samples). Gate G1 re-reads the sitemap itself; G2 rejects file-like titles |
| HTTP cache shared between browser contexts | Listing pages reused cached app files, so the HAR stored them as status -1 and offline replay hung | Cache disabled (CDP) for the HAR capture only |
| HTTP 429 rate limit | Repeated runs made the site return 429, and the listing search showed "Something went wrong" | 8s between pages; ONE 429 allowance per run, shared by pages, sitemaps, videos, curl, WordPress and media (and per verify run): the first 429 anywhere = nothing for 90s, that request retried once, the rest of the run slower; a second 429 anywhere stops the run. Plain requests and curl send an honest agent (`FrancineEliSiteBackup/1.0`, contact from `SITE_BACKUP_CONTACT` or package.json `config.contact`) |
| Lazy images in sliders | Slides never shown never load, even after a full scroll (11 of 98 images on the home page) | Every `img[loading=lazy]` is switched to eager before scrolling; saved HTML gets the original back |
| Lazy background videos | `<source data-src>`; the video stays empty until the site's script starts it | Started by the tool if still empty after the scroll; all formats downloaded whole (G5) |
| Fast scroll | Content below the fold not loaded yet when saved | Half a screen per step, waiting until on-screen images finish (up to 4s per step) |
| Fixed waits | A fixed pause either wastes time or saves half-loaded pages | `waitForSettled`: images done, no spinner, text stable, network quiet, cap 60s; leftovers fail G6 |
| Parallax backgrounds | `background-attachment: fixed` vanishes from full-page screenshots (white text on white) | Flattened for the still screenshot only; the video keeps the real effect |
| Cookie banner | Covered the hero in screenshots | Clicks "Reject non-essential" (the privacy-safe choice) |
| Large Cloudinary videos | Node's fetch failed on big webm files | curl fallback for that download |
| `data-src` on a button | A Vimeo `data-src` on a play button looked like an unloaded lazy element | only media elements count as lazy content |
| Media library ≠ what pages show | A browser capture only saves images a page loads; unused uploads would be lost | `--wp-api` downloads every media original; G7 checks each is on disk |
| HAR close hangs (elev8ca.com, 2026-10-26) | A reCAPTCHA Enterprise web worker on the page kept `ctx.close()` waiting forever (HAR recording only; video alone closed in 9 s); the run sat 11 min on page 1 | The page is closed before the context (then 0 s, HAR whole); `ctx.close()` capped at 180 s, a miss recorded as `closeNote`. reCAPTCHA is never blocked |
| A live counter in an index | The running backup's page count made the auto-index "stale" every few seconds | The index shows "running" until verify.json exists |
