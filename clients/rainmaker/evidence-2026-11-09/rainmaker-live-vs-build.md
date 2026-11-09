# Rainmaker: what is live on www.rwifinancial.com vs our build

Checked 2026-11-09 (server date header Mon, 09 Nov 2026 05:02 GMT). GET only, one request at a time with a 350 ms pause, user-agent `OmniKom-golive-check/1.0`, redirects not followed. About 115 requests in total on the two hosts. Nothing was posted, no form touched. Raw bodies and headers: `fetch\live\`, `fetch\preview\`, `fetch\results.json` in this folder.

## Answer in 8 lines

1. www.rwifinancial.com is NOT the old Duda site any more and is NOT a deploy made by our tools. It serves our site: all 11 pages have the same title and canonical as the preview, CSS, JS, fonts and 15 of 17 sampled assets (all WebP/woff2/css/js ones) are byte-identical to `E:\Rainmaker\site` (md5 equal), and the page HTML equals the preview HTML except 2 to 7 lines per page.
2. The preview (`https://rainmaker-omnikom-website.pages.dev`) is byte-identical to `E:\Rainmaker\site` for all 11 pages, and `site/` at HEAD equals `site/` at commit 2795017 (`git diff --stat 2795017 HEAD -- site` is empty). So the preview is our final preview e1f42a39 / commit 2795017.
3. The live HTML is that same build with: `<meta name="robots" content="index, follow">` (the preview has `noindex, nofollow`; our live build would write `index, follow, max-image-preview:large`), `og:image` changed from `hero-today-family-steps.jpg` to `.webp`, and Cloudflare e-mail obfuscation added to the privacy page and contact/careers (script `/cdn-cgi/scripts/.../email-decode.min.js`, `mailto:` links rewritten to `/cdn-cgi/l/email-protection`). Neither the `index, follow` meta nor the `.webp` og:image is produced by any build in our git history (checked: all four earlier commits of site/index.html use `.jpg`). Who made the change is UNPROVEN.
4. Live is missing everything that our `site/` folder carries beside the HTML: no `_headers` effect (no CSP, HSTS, X-Frame-Options or Permissions-Policy), no `_redirects` effect (15 of the 16 old URLs answer 200 with the home page instead of 301), no 404 page (a junk path answers 200 with the home page), `robots.txt` and `sitemap.xml` are different files from ours (73 B and 811 B; no lastmod; ours are 16 named crawlers and dated lastmod), `/llms.txt` returns the home page HTML, and the `.jpg`/`.png` images (including `logo-mark.png`, the logo named in the JSON-LD) return the home page HTML with status 200.
5. Placeholders are public on live: `[PHONE]`, `[MAILING ADDRESS]`, `[DATE OF PUBLICATION]` and the text "Draft for Rainmaker review" are on privacy, terms and insurance-disclosures, exactly as on the preview. The live pages are indexable (`index, follow`, robots.txt `Allow: /`) and the sitemap is submitted in robots.txt.
6. Host: Cloudflare proxy (`server: cloudflare`, `cf-ray ...-MRS`, `cf-cache-status: DYNAMIC`, HTTP/3). The origin looks like Cloudflare Pages / Workers static assets: the CSS ETag is identical to the preview's (`W/"66c5b2ec06d67868821077fa46202f22"`), `/index.html` answers 308 to `/`, and there is no 404.html (single-page-app fallback to index). The zone is the one with NS alina/jaxson, not our cruz/leland zone. No `x-served-by`, `via` or `x-powered-by` header. The account behind it is UNPROVEN from outside.
7. Apex `https://rwifinancial.com/` answers 200 with the same page (no redirect to www): two hosts serve the same site. `http://` redirects to `https://` (301, same host) on apex and www.
8. The live form config is our real one: `config.js` on live is byte-identical to ours (md5 e9be3d54) and contains the Apps Script URL, so forms on the live site post to our Sheet (value not printed here).

## Hosts compared

| item | live (https://www.rwifinancial.com) | preview (https://rainmaker-omnikom-website.pages.dev) |
|---|---|---|
| server | cloudflare | cloudflare |
| cf-cache-status | DYNAMIC | (absent) |
| cf-ray | a57a43e649dbe183-MRS | a57a4458cde6e242-MRS |
| etag (home) | (absent) | W/"b634207e88af05cbc06e4c8a41c33410" |
| cache-control (home) | public, max-age=0, must-revalidate | public, max-age=0, must-revalidate |
| cache-control (rmk.css) | public, max-age=14400, must-revalidate | public, max-age=31536000, immutable |
| etag (rmk.css) | W/"66c5b2ec06d67868821077fa46202f22" | W/"66c5b2ec06d67868821077fa46202f22" |
| content-security-policy | (absent) | default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://script.google.com https://script.googleusercontent.com https://cloudflareinsights.com; form-action 'self' https://script.google.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none' |
| strict-transport-security | (absent) | max-age=31536000; includeSubDomains |
| x-frame-options | (absent) | DENY |
| permissions-policy | (absent) | camera=(), microphone=(), geolocation=(), interest-cohort=() |
| referrer-policy | strict-origin-when-cross-origin | strict-origin-when-cross-origin |
| x-content-type-options | nosniff | nosniff |
| x-robots-tag | (absent) | noindex, nofollow, noarchive |
| x-served-by / via / x-powered-by | (absent) | (absent) |

Security headers on live HTML: 2 of 6 present (x-content-type-options, referrer-policy). Missing: CSP, HSTS, X-Frame-Options, Permissions-Policy. The preview sends all four of our `_headers` entries (plus `x-robots-tag: noindex, nofollow, noarchive`, from the preview deploy script).

## The 11 sitemap pages

Title and canonical are identical on live and preview for every page (checked per page). Robots meta, placeholder counts and md5 of the whole response body:

| page | status live / preview | title (live) | robots live | robots preview | placeholders live | placeholders preview | md5 live | md5 preview | md5 our live build (RMK_LIVE=1) |
|---|---|---|---|---|---|---|---|---|---|
| / | 200 / 200 | Rainmaker Wealth Innovations \| Life Insurance, Mortgage Protection and Annuities | index, follow | noindex, nofollow | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | cf9948ce | 80b20293 (= E:\Rainmaker\site 80b20293) | 1320a37c |
| /about/ | 200 / 200 | About Rainmaker Wealth Innovations \| Monica Faulve-Stach and Team | index, follow | noindex, nofollow | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | 307872b3 | d5a6b8c0 (= E:\Rainmaker\site d5a6b8c0) | a0e1ce54 |
| /annuities/ | 200 / 200 | Annuities: How They Work for Retirement Income \| Rainmaker | index, follow | noindex, nofollow | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | f340592e | 609fa398 (= E:\Rainmaker\site 609fa398) | b4147242 |
| /careers/ | 200 / 200 | Insurance Agent Jobs and Careers \| Rainmaker | index, follow | noindex, nofollow | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | 778a3255 | 084e1f86 (= E:\Rainmaker\site 084e1f86) | 8e718283 |
| /contact/ | 200 / 200 | Contact Rainmaker Wealth Innovations \| Request a Conversation | index, follow | noindex, nofollow | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | f32e32fa | a0ded745 (= E:\Rainmaker\site a0ded745) | e8bff3f7 |
| /faq/ | 200 / 200 | Frequently Asked Questions · Rainmaker Wealth Innovations | index, follow | noindex, nofollow | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | d641801c | f629c051 (= E:\Rainmaker\site f629c051) | f67991ba |
| /insurance-disclosures/ | 200 / 200 | Insurance Disclosures · Rainmaker Wealth Innovations | index, follow | noindex, nofollow | PHONE 2, ADDR 0, DATE 2, ENTITY 0 | PHONE 2, ADDR 0, DATE 2, ENTITY 0 | 5cba879c | 0b80a379 (= E:\Rainmaker\site 0b80a379) | 7bd8aa74 |
| /life-insurance/ | 200 / 200 | Best Life Insurance for Homeowners \| Rainmaker | index, follow | noindex, nofollow | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | 8d732e9d | b8742f5c (= E:\Rainmaker\site b8742f5c) | d49cfd03 |
| /mortgage-protection/ | 200 / 200 | Do I Need Mortgage Protection Insurance? \| Rainmaker | index, follow | noindex, nofollow | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | PHONE 0, ADDR 0, DATE 0, ENTITY 0 | d586707a | a526bf55 (= E:\Rainmaker\site a526bf55) | a3e65571 |
| /privacy/ | 200 / 200 | Privacy Policy · Rainmaker Wealth Innovations | index, follow | noindex, nofollow | PHONE 4, ADDR 2, DATE 2, ENTITY 0 | PHONE 4, ADDR 2, DATE 2, ENTITY 0 | 93f3adab | 78fa6714 (= E:\Rainmaker\site 78fa6714) | 22a9828b |
| /terms/ | 200 / 200 | Terms of Use · Rainmaker Wealth Innovations | index, follow | noindex, nofollow | PHONE 2, ADDR 2, DATE 2, ENTITY 0 | PHONE 2, ADDR 2, DATE 2, ENTITY 0 | 7ce85834 | 5a22788c (= E:\Rainmaker\site 5a22788c) | bff41853 |

Note: the md5 here is of the bytes the server returned (decoded from Brotli). Live equals preview on no page. Differing lines vs the preview file: home 2, about 2, annuities 2, careers 5, contact 7, faq 2, disclosures 4, life 2, mortgage 2, privacy 6, terms 4 (checked on home, contact, careers, privacy: only the robots meta line, the og:image line and Cloudflare e-mail-obfuscation rewrites of `mailto:` links; the other pages' few differing lines were not each read, UNPROVEN that they are the same three kinds).

Placeholder columns count the literal tokens `[PHONE]`, `[MAILING ADDRESS]`, `[DATE OF PUBLICATION]`, `[APPROVED LEGAL ENTITY]`; the legal entity is filled in on both hosts ("Rainmaker Wealth Innovations, Inc."). The text "Draft for Rainmaker review" appears once each on privacy, terms and insurance-disclosures on both hosts.

## Static assets (md5 vs `E:\Rainmaker\site`)

| path | local | live | preview |
|---|---|---|---|
| /assets/fonts/Poppins-SemiBold.woff2 | b2747a0a | 200 equal | 200 equal |
| /assets/fonts/Mulish.woff2 | 214a38bc | 200 equal | 200 equal |
| /assets/css/rmk.css | 870365e8 | 200 equal | 200 equal |
| /assets/img/logo-mark.webp | 85d9d66d | 200 equal | 200 equal |
| /assets/img/hero-today-family-steps.webp | f2e903c0 | 200 equal | 200 equal |
| /assets/img/hero-today-family-steps-m.webp | 689ae169 | 200 equal | 200 equal |
| /assets/js/rmk.js | 8a3e5f17 | 200 equal | 200 equal |
| /assets/js/motion.js | 2fa5f747 | 200 equal | 200 equal |
| /assets/img/hero-today-family-steps.jpg | 92905d34 | 200 DIFFERENT (text/html; charset=utf-8) | 200 equal |
| /assets/img/logo-mark.png | 859e446f | 200 DIFFERENT (text/html; charset=utf-8) | 200 equal |
| /assets/img/arch-mortgage-new-home.webp | 8e030265 | 200 equal | 200 equal |
| /assets/img/arch-mortgage-new-home-m.webp | ba3131c9 | 200 equal | 200 equal |
| /assets/img/arch-life-parents-baby.webp | 7d3331b8 | 200 equal | 200 equal |
| /assets/img/arch-life-parents-baby-m.webp | cb808e58 | 200 equal | 200 equal |
| /assets/img/page-contact-hero.webp | d6ecd335 | 200 equal | 200 equal |
| /assets/img/page-contact-hero-m.webp | f6389d68 | 200 equal | 200 equal |
| /assets/img/arch-annuities-older-couple.webp | 81991b1c | 200 equal | 200 equal |

Also equal on both hosts (md5): `/assets/css/rmk.css` 870365e8, `/assets/js/rmk.js` 8a3e5f17, `/assets/js/motion.js` 2fa5f747, `/assets/js/forms.js` f5c69c27, `/assets/js/config.js` e9be3d54. CSS/JS/font caching on live is `max-age=14400` (Cloudflare's browser TTL), not the one-year immutable of our `_headers`.

## Old URLs from `E:\Rainmaker\site\_redirects`

| old URL | expected | live status / Location | preview status / Location |
|---|---|---|---|
| /our-services | 301 / | 200 (body = home page, md5 cf9948ce) | 301 / |
| /our-services/ | 301 / | 200 (body = home page, md5 cf9948ce) | 301 / |
| /services | 301 / | 200 (body = home page, md5 cf9948ce) | 301 / |
| /client-success-stories | 301 /about/ | 200 (body = home page, md5 cf9948ce) | 301 /about/ |
| /client-success-stories/ | 301 /about/ | 200 (body = home page, md5 cf9948ce) | 301 /about/ |
| /investment-strategies | 301 /annuities/ | 200 (body = home page, md5 cf9948ce) | 301 /annuities/ |
| /investment-strategies/ | 301 /annuities/ | 200 (body = home page, md5 cf9948ce) | 301 /annuities/ |
| /cpe-course-offerings | 301 /careers/ | 200 (body = home page, md5 cf9948ce) | 301 /careers/ |
| /cpe-course-offerings/ | 301 /careers/ | 200 (body = home page, md5 cf9948ce) | 301 /careers/ |
| /about-us | 301 /about/ | 200 (body = home page, md5 cf9948ce) | 301 /about/ |
| /contact-us | 301 /contact/ | 200 (body = home page, md5 cf9948ce) | 301 /contact/ |
| /join-our-team | 301 /careers/ | 200 (body = home page, md5 cf9948ce) | 301 /careers/ |
| /join | 301 /careers/ | 200 (body = home page, md5 cf9948ce) | 301 /careers/ |
| /join-rainmaker | 301 /careers/ | 200 (body = home page, md5 cf9948ce) | 301 /careers/ |
| /home | 301 / | 200 (body = home page, md5 cf9948ce) | 301 / |
| /index.html | 301 / | 308 / (body = home page, md5 d41d8cd9) | 301 / |

Live never redirects through our rules: 15 of 16 old URLs answer 200 with the home page HTML (duplicate content under 15 addresses); `/index.html` gets a 308 to `/` from the host itself, not from our rule. Preview matches `_redirects` 16 of 16.

## Junk path, robots.txt, sitemap.xml, llms.txt, 404

| request | live | preview |
|---|---|---|
| /zz-not-a-real-page-xyz/ | 200 text/html; charset=utf-8 17910 B | 404 text/html; charset=utf-8 7121 B |
| /404.html | 200 text/html; charset=utf-8 17910 B | 308  0 B -> /404 |
| /robots.txt | 200 text/plain; charset=utf-8 73 B | 200 text/plain; charset=utf-8 26 B |
| /sitemap.xml | 200 text/xml; charset=utf-8 811 B | 200 application/xml 1295 B |
| /llms.txt | 200 text/html; charset=utf-8 17910 B | 200 text/plain; charset=utf-8 3196 B |

Live `robots.txt` (73 B, full body):
```
User-agent: *
Allow: /
Sitemap: https://www.rwifinancial.com/sitemap.xml
```
Preview `robots.txt` (26 B): `User-agent: *` / `Disallow: /` (the preview deploy overrides ours on purpose). Ours in `E:\Rainmaker\site\robots.txt` names 16 crawlers, all Allow, and is what the live build ships.

Live `sitemap.xml` (811 B): the same 11 URLs, in a different order (about, annuities, careers, contact, faq, home, ...), no `<lastmod>`, no trailing-slash difference. Ours has `<lastmod>2026-10-23T00:00:00+00:00</lastmod>` on each. The live file is therefore not ours.

## Apex and http

| request | status | Location |
|---|---|---|
| https://rwifinancial.com/ | 200 | (none, served directly) |
| https://rwifinancial.com/about-us | 200 | (none, served directly) |
| http://rwifinancial.com/ | 301 | https://rwifinancial.com/ |
| http://www.rwifinancial.com/ | 301 | https://www.rwifinancial.com/ |
| http://rainmaker-omnikom-website.pages.dev/ | 301 | https://rainmaker-omnikom-website.pages.dev/ |

LAUNCH.md asks for one canonical host (www) and a 301 from the apex. That redirect rule does not exist on the live zone today: the apex serves the full site.

## Which build is live?

- Content: our build at commit 2795017 (preview e1f42a39). Evidence: per-page diff of 2 to 7 lines against `E:\Rainmaker\site`, identical assets, the consent versions `marketing-consent-draft-3` and `contact-request-draft-1`, which first appear in commit 206c1ef (2026-10-24 01:17), so the live copy is not an older 10-23 build.
- Not produced by our tools: it lacks `_headers`, `_redirects`, `404.html`, our robots/sitemap/llms and the `.jpg`/`.png` images; our `tools/deploy-live.mjs` refuses builds with placeholders and noindex, and `tools/deploy-preview.mjs` keeps noindex. A hand-assembled upload of the `site/` folder with files removed and 1 to 2 header lines edited fits the evidence. By whom, in which Cloudflare account: UNPROVEN.
- It is also not the Omnikom zone (cruz/leland, still pending per POSITION.md/LAUNCH.md); DNS evidence in `dns-rwifinancial.md`.

## Risks this creates (facts, ordered by size)

1. Privacy, terms and insurance-disclosures with `[PHONE]`, `[MAILING ADDRESS]`, `[DATE OF PUBLICATION]` and "Draft for Rainmaker review" are public and indexable, with the Monica-approval status of the legal text still open.
2. Marketing consent wording is the draft (draft-3) on a live form that posts to the real Sheet.
3. No security headers and no HSTS on live; no 404 (soft-404: every wrong URL is a 200).
4. Duplicate content under apex and www and under 15 old URLs.
5. JSON-LD logo `logo-mark.png` returns HTML on live.
