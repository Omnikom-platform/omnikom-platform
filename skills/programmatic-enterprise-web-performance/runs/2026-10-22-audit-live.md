# Proof: audit-live on https://valleytovalleyrealty.com (2026-10-22)

Phase 1 end-to-end run on a real live site (Francine Masudi, Luxury Presence). Snapshot reused (no re-crawl).

## Commands, in order (from `E:\Francine & Eli`, PowerShell)
1. `node <skill>/scripts/doctor.mjs https://valleytovalleyrealty.com/` -> exit 0
   ```
   CONNECTED     Node.js: v24.13.0
   CONNECTED     Claude CLI (headless check workers): 2.1.296 (Claude Code)
   CONNECTED     Chrome or Edge (lab speed, rendered pages): C:/Program Files/Google/Chrome/Application/chrome.exe
   CONNECTED     Common Crawl web graph (free backlinks and authority): release cc-main-2026-jul-aug-sep in D:/seo-kit-cache (latest)
   NEEDS         Google Search Console API ... no token
   NEEDS         Bing Webmaster Tools API ... no key
   NEEDS         Chrome UX Report API ... no key
   NEEDS         Gemini API free tier with Google Search grounding ... no key
   NEEDS         Google Ads Keyword Planner export ... imported as a CSV file
   MAIN SESSION  Owner-supervised browser capture ...
   ```
2. `node <skill>/scripts/live-target.mjs https://valleytovalleyrealty.com/` -> exit 0
   ```
   REUSE E:\Francine & Eli\site-checks\valleytovalleyrealty.com\snapshots\2026-10-22 (finished 2026-10-22T05:53:16.290Z)
   ```
   (Snapshot: 19 pages, median of 3 phone runs each, 0 rate-limit responses. Known defect at the time, fixed since:
   `--exclude` did not cover the 9 `/home-search/sitemap-*` files robots.txt lists; they were requested once and all answered 403.)
3. Checker on the snapshot: coordinator agent, `plan.mjs --budget-kb 300` -> 11 slices, 11 of 11 workers ok, 0 NOT CHECKED.
   Merge (after the two grouping fixes this run exposed: platform as one fix location, URL shape for families):
   ```
   98 root causes (0 critical, 15 high, 44 medium, 39 low) from 352 findings; 348 findings with working check scripts, 4 unchecked; 0 NOT CHECKED item(s); 39 knowledge scripts
   ```
4. `node <skill>/scripts/authority.mjs site-checks\valleytovalleyrealty.com\.pewp\authority.json --target valleytovalleyrealty.com --competitor ramamehra.com --competitor josephsabehgroup.com --competitor joeschembri.com --competitor ginapiper.com` -> exit 0, 21 min
   ```
   valleytovalleyrealty.com: 1 linking domains, harmonic rank 7385993
   ramamehra.com: 8 linking domains, harmonic rank 13513287
   josephsabehgroup.com: 7 linking domains, harmonic rank 15837726
   joeschembri.com: 9 linking domains, harmonic rank 51797372
   ginapiper.com: 8 linking domains, harmonic rank 72598066
   link gap: 3 domains
   ```
   Cross-check: identical to the project's earlier hand run (icm/knowledge/market/backlinks.md).
5. `node <skill>/scripts/report-live.mjs https://valleytovalleyrealty.com/` -> exit 0
   ```
   valleytovalleyrealty.com: search engines can reach it, but 3 things hold it back; the checker found 98 root causes (15 serious); 1 other websites link to it (Common Crawl). Whether it ranks and gets cited by AI is not measured yet (BLOCKED, see 2, 3 and 5).
   ```
   Output: `site-checks/valleytovalleyrealty.com/.pewp/report.md` + `report.json` (six questions in order; Q2, Q3, Q5 BLOCKED with
   their free unblock steps).

## Verdict
P1 E2E DONE. Defects found by this run and fixed: findings split per worker (merge), different page types lumped into one
family (planner), `--exclude` not covering sitemaps (crawler), Windows exit crash after a good snapshot (crawler).
