# 22 Search Console, analytics and speed data: how the enterprise SEO and performance service is wired into the build

Written 2026-10-29 (owner: "what will we do about the google search console and the needed setup for analytics to deliver our
enterprise seo and website performance services, we need to have that into the build too"). DECISIONS 11: one Omnikom
Google Search Console account manages every site. This file says what is set up per site, by whom, when, and where the
numbers land. Facts marked UNVERIFIED are tested at W0.4 / W2.x on the first real site.

## 1. The sources, and why each
| Source | What it gives | Cost | How we read it |
|---|---|---|---|
| Google Search Console (GSC) | clicks, impressions, position per query and page; index coverage; sitemap status; manual actions | free | Search Console API, daily, one call per site |
| PageSpeed Insights API | lab speed (Lighthouse) phone and desktop per URL; the writing gate's numbers | free (key exists: `PSI_API_KEY`) | weekly per site on 5 pages; on every launch |
| CrUX API | real-user speed (Core Web Vitals field data) per origin | free (key exists: `CRUX_API_KEY`) | weekly per origin |
| Bing Webmaster | Bing clicks and index; IndexNow submission | free (key exists: `BING_WEBMASTER_KEY`) | weekly; IndexNow on every publish |
| Cloudflare Web Analytics | visits, page views, referrers, countries, Core Web Vitals from real visitors; no cookies, no consent banner needed | free on the account | one toggle per Pages project (UNVERIFIED by API; the dashboard toggle is documented), read by the Cloudflare GraphQL API weekly |
| Google Analytics 4 | event-level analytics | free | only when a client asks for it (consent banner, cookie notice, and their property); never by default |
| AI answers | whether the business is named in ChatGPT, Gemini, Perplexity answers | our own checks | the skill's research stage, monthly, at human pace |
The site's own numbers (leads per form, per page) come from our `leads` table, no third party.

## 2. Per-site setup, in the launch ledger (sops/launch.md, group B and C)
1. **GSC property**: a Domain property for `<domain>` (covers apex, www, http, https). Verification is a DNS TXT record on the
   zone we hold (DECISIONS 26): the platform adds it by the Cloudflare DNS API and verifies through the Google Site
   Verification API using the platform's service account (Google Cloud project `omnikom-seo`, the one that holds the PSI and
   CrUX keys). A property verified by the service account is owned by it, so the Search Console API works without a manual
   "add user" step (UNVERIFIED: that a service-account verification grants API access to that account; the fallback is the
   owner adding the service account's email as an owner once per property, OWNER-PROOF).
2. **Sitemap submit**: `sitemap-submit` after every live publish (the function exists in the manifest as SPEC) and in the ledger L-B11.
3. **Bing**: the site added to Bing Webmaster (the key exists) by API; IndexNow key file deployed with the site; IndexNow ping per publish.
4. **Cloudflare Web Analytics**: enabled on the Pages project (the beacon is injected by Cloudflare for Pages sites, no code in ours;
   UNVERIFIED by API, documented in the dashboard); the site's `_headers` CSP allows the beacon host.
5. **Baseline**: on launch day, `metrics-pull` stores day 0 for every source so the report has a start line.
6. **Client access**: the client gets read access to their GSC property (their Google account added as a user, OWNER-PROOF) if
   they ask; the dashboard shows the numbers either way.

## 3. Where the numbers land and how they are shown
- `metrics_snapshots (workspace_id, source, day, data)`: one row per source per day; sources `search-console`, `pagespeed`,
  `crux`, `bing`, `cf-analytics`, `ai-answers`, `uptime` (the check constraint on `source` grows by a migration; the
  present constraint lists four: UNCHANGED until that migration).
- Pull: `metrics-pull` (cron, one workspace per call, well under 150 s) with the Google credentials from Vault; retries next day.
- Shown: the Site screen's card (clicks and impressions 28 days, PageSpeed phone and desktop with the date, Web Vitals from CrUX,
  visits from Cloudflare) and a monthly plain-words report (clicks, top queries, pages that moved, speed, leads) generated
  from the rows, never from a vendor dashboard screenshot. Every number carries source and date (ANALYSIS 4).
- Retention: 90 days daily, then weekly (18-BUDGET 2.2).

## 4. Credentials (names only; values in the master .env and Vault)
`GOOGLE_SERVICE_ACCOUNT_JSON` (the `omnikom-seo` project's service account, with the Search Console API and Site Verification
API enabled; stored in Vault as one secret), `PSI_API_KEY`, `CRUX_API_KEY`, `BING_WEBMASTER_KEY` (exist in `.secrets/api-keys.env`),
`CLOUDFLARE_API_TOKEN` with Analytics read (the runner's token or a read-only second token).

## 5. What is built and what is not
BUILT: the three keys and `tools/check-api-keys.mjs`; the skill's research and measure stages read GSC exports, PSI and CrUX
by hand today. NOT BUILT: `metrics-pull`, `sitemap-submit`, the Site Verification step, the IndexNow ping, the Web Analytics
toggle by API, the report. Work orders: `05-BUILD-PLAN.md` M3 W3.8 (manual numbers first) and the later metrics track; the
launch ledger items L-B11, L-C (group C off-site) already name GSC and the sitemap.

## 6. For the owner
D14: Cloudflare Web Analytics by default and GA4 only on request (recommended: no consent banner, one toggle, free), or GA4 on
every site (consent banner on every site, a Google property per client). D15: create the service account in the `omnikom-seo`
Google Cloud project now (the owner's click; its JSON goes to the master .env), so W0.4 can test the verification path.
