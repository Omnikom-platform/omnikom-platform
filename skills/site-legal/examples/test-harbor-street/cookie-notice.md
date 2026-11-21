> **DRAFT - not legal advice.** Written by the site-legal skill on 2026-11-21 for TEST Harbor Street Realty, Inc. (made-up) from the facts file
> skills/site-legal/examples/test-harbor-street/facts.json. A licensed lawyer must read and approve it before it is published. Remove this box and the "Review notes"
> section only after that approval.

# TEST Cookies and tracking

**TEST Harbor Street Realty (made-up)** - last updated {{publish_date}}

## The short version
Our website counts visits without cookies. The map on our contact page uses Google's cookies, and it loads only after you allow it. Our latest scan of the website (2026-11-21) found no advertising tools.

## What runs on this website

| Name | What it does | Sets cookies | Needed for the site to work | Run by |
|---|---|---|---|---|
| Cloudflare Web Analytics (a script) | Counts visits without cookies | No | No | Cloudflare |
| Google Maps (an embedded map, contact page only) | Shows where our office is | Yes (Google's own) | No | Google |

This list comes from our own scan of the website on 2026-11-21.

## Your choices
- **Your browser.** You can block or delete cookies in your browser settings.
- **The map.** It stays off until you allow it. Use the "Cookie settings" link at the bottom of any page to change your choice.
- **Global Privacy Control.** Your browser may send this signal. Our website does not currently act on it. We do not sell or share your details.[^ca-ccpa-gpc]
- **Do Not Track.** Our website does not change anything when your browser sends "Do Not Track".[^ca-caloppa-content]

## Banner text
No site-wide cookie banner is needed for the trackers listed. Nothing is set until the visitor allows the map, and none of the listed tools is used for advertising. [CHECK: lawyer. US law read for this draft does not require opt-in consent for non-essential cookies that are not used for ads; confirm that for a California brokerage.] Add a banner if a tool that sets non-essential cookies is added to the site.

Instead, use these words where the map would appear on the contact page, and in the "Cookie settings" panel:

- **Line in place of the map:** "This map is from Google. If you load it, Google gets your IP address and sets its own cookies. See our cookie notice." (the words "cookie notice" link to /cookies)
- **Two buttons with equal weight:** "Load the map" and "Keep the map off"
- **Cookie settings panel (opened from the footer link):**
  - Title: "Cookie settings"
  - Row: "Google Maps (contact page)" with a switch, off by default, and the words "Shows our office on a map. Google sets cookies when it loads."
  - Row: "Visit counting (Cloudflare Web Analytics)" with the words "No cookies. Always on." [CHECK: the facts do not say whether visit counting can be switched off; confirm "Always on" with the build.]
  - Button: "Save my choice"

## Review notes (remove before publishing)
- **Facts this page relied on:** trackers_on_build[0-1] (the build's scan, scanned_on 2026-11-21, sources: docs/product/7-sites.md "Search and analytics" for Cloudflare; made-up for the test for the map); build.cookie_settings_available = true; build.map_loads_only_after_consent = true; honors_global_privacy_control = false; honors_do_not_track = false; shares_for_cross_context_ads = false.
- **Decisions behind this page:** D10 non-essential cookies (the map) without ads: a short notice with a "Cookie settings" link, no banner. D4 does not apply, so no "Do Not Sell or Share" link and no GPC processing are required.
- **Open questions for this page:** lawyer confirms no banner is required; the build confirms whether visit counting can be switched off. The "Run by" column is read from the tracker names; the facts have no field for the operator.
- **Sources:**

[^ca-ccpa-gpc]: CA-CCPA-GPC - https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf sec. 7025(b)-(e), 7011(e)(3)(F) (read 2026-11-21) - CONFIRMED. Required only of a business that sells or shares; the page states what the site does because the facts file says it. Watch: a CPPA proposed text of 2026-10-08 would name GPC (https://cppa.ca.gov/meetings/materials/20261105_06_09_text.pdf), PROPOSED ONLY, not adopted on 2026-11-21.
[^ca-caloppa-content]: CA-CALOPPA-CONTENT - https://www.leginfo.ca.gov/pub/13-14/bill/asm/ab_0351-0400/ab_370_bill_20130927_chaptered.htm (read 2026-11-21) - CONFIRMED for the 2013 text; UNCONFIRMED that Bus. & Prof. Code 22575 is unchanged since.
