# SOP: launch a V2 site, from preview to production (DECISIONS 19, 20)

Status 2026-10-29. Written from the first real run: ELEV8 (`E:\Alex Sevilla\draft-site\LAUNCH-ENTERPRISE.md`, 22 items in
groups A-D). This SOP is industry neutral. It follows DECISIONS 16 (build once, launch by edits), 17 (the client gives facts and
access), 18 (`sops/site-scope.md`) and `sops/site-endpoints.md` (the lead path).

**What launch is.** A ledger of 22 items. Each item has a "done when" and a proof. One command walks the owner through the
access to collect. One agent then works the ledger in one session until the stop condition holds. Architecture:
`docs/blueprint/12-LAUNCH.md`. Tool: the skill's `scripts/launch.mjs` (stage file `stages/launch.md`).

## 1. How it runs
`<skill>` is `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance`. `<pewp>` is `site-checks/<host>/.pewp`.

1. **Start the ledger.** `node <skill>/scripts/launch.mjs --init <pewp> --site-url https://www.<domain>/ --pages <one URL per template>
   --site-dir <launch build folder> --redirects <the 301 map> [--waive <signed-off rule ids>] [--build "<launch build command>"]
   [--detailed-seo <path to the Detailed SEO CLI>]`. It writes `<pewp>/launch.json`: every item OPEN, with its check and proof slot.
2. **Collect access.** `launch.mjs --access <pewp>` prints the access list as pickable questions. The main session asks the owner.
   Each answer is recorded with `--access-set <pewp> <key>=granted|pending|client|na --by <owner>`. The script never prompts.
3. **Hand the task to an agent.** `launch.mjs --task <pewp>` prints the one-shot brief. The agent runs `--check`, fixes, records,
   blocks, and runs `--check` again, until `--status` exits 0.
4. **Read the end.** Exit 0: the stop condition holds. Exit 3: items are open. The proof of each run is
   `<pewp>/runs/<date>-launch.md`.

## 2. The stop condition
Every item is PASS with its proof line, or BLOCKED with an allowed reason and what unblocks it. Nothing else ends the task.
`launch.mjs --check` and `--status` exit 0 only then.

**Allowed BLOCKED reasons:**
- `owner-access`: waiting on owner access X. X is a key from section 4, or `owner-click` for an outward action only the owner
  may click (a DNS change, going live, sending). The block stops holding when that access is recorded as granted.
- `client-answer`: waiting on client answer Q-n (the question sheet of `sops/client-questions.md`).
- `owner-proof`: needs OWNER-PROOF. Only for an item with an OWNER-PROOF slot whose checks do not fail.
- `third-party-outage`: a named service is down. The block expires after 24 hours.
- `not-yet-due`: set by the script only. A C or D item before launch day plus its window. (Added to the four reasons of the brief,
  so a launch-day run can end. The item is still worked when it can be.)

**PASS needs proof.** A check item passes only from `--check`, with the check's own output line. An OWNER-PROOF item passes only
when the owner's screenshot or URL is recorded (`--record`). A recorded file is hashed: if it changes, the item reopens.

## 3. The items
Proof kinds:
- **check: name**: an automated check that `launch.mjs --check` runs every time.
- **command**: a site-specific command set in the ledger (`--config commands.L-A1="..."`). Exit 0 passes. Its last line is the proof.
- **OWNER-PROOF**: a screenshot or URL the owner provides, for things with no API (Search Console, Business Profile, Rich Results Test).

### A. Before launch
| Id | Item | Done when | Proven by |
|---|---|---|---|
| L-A1 | Client answers applied | Every answer from the question sheet (max 12) is applied as a content row. The internal view shows 0 open questions. The rebuild passes the strict gate. | command (the site's open-question count) |
| L-A2 | Platform dashboard and CRM live | One real test lead goes form, `/api/lead`, `captureLead`, then a CRM record with every mapped field, plus the alert email. First on staging, then on production. | OWNER-PROOF (the CRM record and the alert email) |
| L-A3 | Legal sign-off | The client's approver (broker, lawyer or compliance) approved Privacy, Terms and Accessibility in writing. The approval is filed. The effective date is set. | OWNER-PROOF (the filed approval) |
| L-A4 | Third-party logo permissions | A written OK is filed for every partner or brand logo. Otherwise the strip shows names only. | OWNER-PROOF (the written OKs, or the names-only page) |
| L-A5 | Domain and DNS access, email-safe | Access is granted at the minimum role. The zone is exported before any change. MX, SPF, DKIM and DMARC stay untouched. Every subdomain in use is decided. | OWNER-PROOF (the zone export and the DNS plan) |
| L-A6 | Redirects from the old site | A 301 map covers every old URL with traffic or links. Every old URL answers 301 to its new page. | check: redirects |

### B. Launch day
| Id | Item | Done when | Proven by |
|---|---|---|---|
| L-B7 | Launch build passes the strict gate | The launch build (noindex off, robots allow, samples dropped) passes `gate.mjs --strict`. | check: gate |
| L-B8 | Custom domain live with HTTPS and headers | Every key page answers 200 on the production URL. No noindex header or meta. robots.txt allows it. Security headers present: `X-Content-Type-Options`, `Strict-Transport-Security` and `Cross-Origin-Opener-Policy` (COOP). The preview host is retired or redirected. | check: live-headers |
| L-B9 | PageSpeed Insights on the live domain | Mobile and desktop, every template: performance 90+, accessibility 100, best practices 100, SEO 100. The writing gate (WG-1 to WG-7, `tools/design-engine/WRITING.md`) passes on the launch build against the live URL and the saved PageSpeed JSON. | check: psi + writing |
| L-B10 | Page tags on every template | The canonical equals the URL. Robots reads index, follow. One H1. No cut-off title. | check: canonical + detailed-seo |
| L-B11 | Search Console and Bing Webmaster | The sitemap file is reachable and lists only production URLs. The Domain property is verified. The sitemap is submitted. URL inspection says indexable on the home page and 3 key pages. Bing has the site. | check: sitemap + OWNER-PROOF |
| L-B12 | Rich results valid | Google's Rich Results Test is valid for the main schema types (the business, a person, FAQ) on sample pages. | OWNER-PROOF |
| L-B13 | Analytics and conversions | Page views and a conversion on every lead form are recorded. The consent text matches. | OWNER-PROOF |

### C. First 30 days (off-site)
Due 30 days after launch day (the day L-B8 first passes).
| Id | Item | Done when | Proven by |
|---|---|---|---|
| L-C14 | Business Profile(s) verified | Verified. Name, address and phone identical to the site. The right primary category. The site linked. The review link shared with past clients. | OWNER-PROOF |
| L-C15 | Listings and citations, one identical NAP | Every listing profile the industry uses links to the new site with the same name, address and phone. | OWNER-PROOF |
| L-C16 | Stale third-party data fixed | Profiles that show an old fact (a past employer or brokerage, an old address or phone) are corrected. The AI-answer re-check of `measure` no longer shows it. | OWNER-PROOF |
| L-C17 | Partner sites link to the new site | Every partner, broker or association page that lists the business links to the new site. | OWNER-PROOF |
| L-C18 | Reviews flow into the site | Reviews from the Business Profile (or another verified source) show in the review sections with their source and date. | OWNER-PROOF |

### D. Ongoing (measured, not assumed)
| Id | Item | Done when | Due | Proven by |
|---|---|---|---|---|
| L-D19 | Weekly measure report | The skill's `measure` mode runs weekly. Changes are proposed through `iterate` for approval. | launch + 7 days | OWNER-PROOF (the report file) |
| L-D20 | Real-user speed (CrUX) | After about 28 days of traffic, at the 75th percentile: LCP 2.5 s or less, CLS 0.1 or less, INP 200 ms or less. | launch + 28 days | OWNER-PROOF |
| L-D21 | Content cadence from the dashboard | Placeholders are replaced by real rows. Publishing never breaks the gate. | launch + 30 days | OWNER-PROOF |
| L-D22 | Monitoring | Uptime alerts on. A test lead end to end every week. The 404 log is checked and redirected. | launch + 7 days | OWNER-PROOF |

### What each check tests
| Check | Passes when |
|---|---|
| gate | `scripts/gate.mjs <pewp> <launch build> --strict` exits 0. Waivers come only from a recorded sign-off. |
| live-headers | Every page: HTTP 200 with no redirect. No `noindex` or `none` in `X-Robots-Tag` or a robots meta tag. robots.txt allows the path for Googlebot and Bingbot. `X-Content-Type-Options: nosniff`. `Strict-Transport-Security` on https. `Cross-Origin-Opener-Policy` present (WG-7; ELEV8 had none, PSI-FINDINGS.md 2026-10-29). |
| canonical | Every page: `rel=canonical` equals the page URL. Exactly one H1. A title of 1 to 60 characters. |
| psi | PageSpeed Insights v5 for every page, mobile and desktop, with the key in `PSI_API_KEY`. No key: BLOCKED `owner-access psi-key`. |
| writing | `writing-gate.mjs` on the launch build with the live URL and the saved PageSpeed files: the 7 WG lines (WG-1 to WG-7) all PASS. |
| redirects | Every static rule of the map (`_redirects` lines or JSON) answers 301 with a Location equal to its target. |
| sitemap | The sitemap file answers 200, is a urlset or sitemapindex, lists at least one URL, all on the site's host. |
| detailed-seo | When the CLI is present: its panel agrees on canonical, robots, one H1 and the title. When absent, the line says NOT RUN. |

## 4. Access to collect
**Never send passwords: add omnikom as a user.** No login, password or one-time code ever goes into chat, email or a file.
Where a platform has no user seat, the client makes the change from our exact steps.

| Key | Access | Why | Minimum role |
|---|---|---|---|
| registrar-dns | Registrar and DNS | Point the domain at the site. Keep MX, SPF, DKIM and DMARC exactly as they are. | DNS editor for this one domain (delegate access limited to DNS, or a DNS-only member). Never account owner. Never transfer rights. |
| cloudflare | Cloudflare (Pages + DNS) | Attach the custom domain to the Pages project. HTTPS, redirects, headers. | An API token with Account > Cloudflare Pages: Edit (one account) and Zone > DNS: Edit plus Zone: Read (one zone). Never the Global API Key. |
| search-console | Google Search Console | Verify the Domain property, submit the sitemap, inspect URLs, read search data. | Full user. Owner only if we verify the Domain property through a DNS TXT record. |
| business-profile | Google Business Profile | Verify, match name/address/phone, link the site, bring reviews in. | Manager. Never Primary owner. |
| bing-webmaster | Bing Webmaster Tools | The site in Bing and in the AI answers that read Bing. | Import from Search Console, or a Read/Write user. |
| analytics | Analytics (platform or GA4) | Page views and a conversion on every lead form. | Editor on the one property, not the account. None if the platform's own analytics is used. |
| listing-profiles | Listing profiles (Zillow and the industry's equivalents) | One identical name, address and phone, each linking to the new site. | A team or user seat where one exists. Otherwise the client edits from our exact text. |
| partner-sites | Broker and partner websites | Links from pages that already list the business. | None. Their web admin makes the change. We send the exact URL and link text. |
| psi-key | PageSpeed Insights API key (Omnikom's own) | The speed check on the live domain. | A key from Omnikom's Google Cloud project, restricted to the PageSpeed Insights API, kept in the env file. Never printed. |

## 5. Rules
- Outward actions need the owner's click: DNS changes, going live, sending email, account settings. The agent prepares them and
  blocks the item with `owner-access owner-click` until the owner clicks.
- Read only on third-party sites: no form, no login, no sign-up. First rate limit or robot check: stop that host.
- Keys come from the env file. They are never printed, pasted or stored in the ledger.
- Two failed approaches to the same obstacle: block it with the honest reason, or leave it FAIL with the command and its output.

## 6. Not built yet
- **NOT BUILT:** an automated check for the email records (MX, SPF, DKIM, DMARC before and after the DNS change). L-A5 is OWNER-PROOF.
- **NOT BUILT:** an automated test lead (L-A2) and a CrUX pull for L-D20. Both are OWNER-PROOF.
- **NOT BUILT:** the Agentic Browsing category by API (WG-6). The PageSpeed API does not expose it yet, so the lead or the owner reads it at pagespeed.web.dev and records it as OWNER-PROOF.
- **NOT BUILT:** `start.mjs launch <target>`. Run `launch.mjs` directly.
- **NOT BUILT:** a dashboard view of the ledger in the platform.
- **UNPROVEN:** the live PageSpeed Insights call and the real Detailed SEO CLI through `launch.mjs`. The test uses a local fake
  endpoint and a stand-in CLI with the same shape.
- **Limits:** the redirect check tests static rules only (pattern rules are listed as NOT CHECKED). The title check is a
  60-character proxy, not pixel width. An owner proof is a record, not a machine check: the owner is trusted for it.
