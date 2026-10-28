# Research dossier: MLS listings feature (read 2026-10-27, read-only desk research)

One file per topic. Each fact carries its source URL, the date read, and a status: CONFIRMED (official page or document read),
CONFIRMED* / (excerpt) (official page seen only through a search excerpt because the site returned 403 to our tools; re-read in a
browser before client use), REPORTED (third party), UNCONFIRMED, ESTIMATE (own arithmetic shown).

| File | Topic | What matters most |
|---|---|---|
| `01-bridgemls.md` | bridgeMLS / Bay East / CCAR IDX feed | Two agreements per site (participant + vendor); bridgeMLS is NOT Bridge Interactive (Paragon); 12 h refresh in current rules; exact disclaimer text; $145 set-up + "$3,000/yr BBO/DAA" clause; Brivity on no vendor list; NorCal Combined IDX is a separate licence per MLS |
| `02-bareis.md` | BAREIS IDX feed (Solano, Napa) | Member's written request first, then vendor application ($50), 3-6 weeks; Rapattoni RESO Web API; 7 of ELEV8's 10 cities are BAREIS territory; Pending/Sold tiers conflict; bareis.com returned 403 (BLOCKED for direct reading) |
| `03-metrolist.md` | MetroList IDX feed (Sacramento) | Subscriber Authorization Form to idxapprovals@; 29 approved vendors, no public new-vendor route; Rapattoni; 3-day refresh + mandatory disclaimer; only Sacramento is MetroList territory; Denver "Metrolist" is a different MLS |
| `04-reso-web-api.md` | RESO Web API, DD 2.0, Bridge / Trestle / MLS Grid | nextLink paging is a MUST; three auth models; page sizes 200 / 1,000 / 5,000; deletes differ (flag / none / status); MLS Grid media URLs single-use 1 h; sync recipe per platform |
| `05-compliance.md` | NAR / C.A.R. / DRE / privacy / fair housing | 36-row checklist; 12 h refresh; "Listed by", never "Courtesy of"; DRE number on every page; CCPA thresholds; TCPA consent; HUD 2024 guidance withdrawn |
| `06-prior-art-and-costs.md` | IDX vendors, developer APIs, self-build cost | Vendors $120-$430/month per client + MLS fees; self-build about $75/month for 3 feeds, about $8/client at 20 clients on shared stores (ESTIMATE); photos must be cached; SEO evidence thin |

Blocked during research (two approaches each): bareis.com and rapattoni.com (403 to fetch and to the browser pane); Trestle docs
(403); the current NAR IDX policy page (member login). What unblocks them: the owner opens the pages in a normal browser and
saves the PDFs, or the MLS sends the documents with the vendor application.
