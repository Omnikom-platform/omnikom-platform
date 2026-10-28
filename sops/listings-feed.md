# SOP: MLS listings feed for a client website (intake to ongoing ops)

Why it exists (owner, 2026-10-27): a client already pays their MLS; their listings must run on their own domain, in our design, and
the same procedure must work for every future real-estate client. First run: ELEV8 Real Estate Group (`E:\Alex Sevilla`).
Design: `docs/listings/REQUIREMENTS.md`, `docs/listings/ARCHITECTURE.md`. Evidence: `docs/listings/research/01-06`.
Status of this SOP: **v0.1, UNPROVEN** (no run has happened; the time column fills in on the first run).

## The lessons this SOP encodes (from the research, 2026-10-27)
1. **An IDX licence covers one MLS.** A client whose cities span several MLSs needs one licence per MLS (or the NorCal Alliance
   Combined IDX feed, which still needs each MLS's approval and fees). Map cities to MLSs before promising anything.
2. **The broker must be a Participant of each MLS** (MetroList: the agent a Subscriber too). No membership = no listings for those
   cities. Ask on day one.
3. **Omnikom is a new vendor everywhere.** New-vendor approval is weeks (Bay East 1-4, BAREIS 3-6 + fees, MetroList: no public
   route), the MLS decides at its discretion, and it is the critical path. The client's first email starts the clock.
4. **Names mislead.** bridgeMLS is not Bridge Interactive; bridgeMLS runs on Paragon, BAREIS and MetroList on Rapattoni. "Trestle IQ"
   is not Trestle. Denver's "Metrolist" is not Sacramento's. Never quote a page without checking which organisation it is about.
5. **MLS documents disagree with each other** (bridgeMLS: 12 h vs 72 h refresh; BAREIS: three different sold/pending texts). Build
   to the strictest value and get the MLS's written confirmation; version the rule set.
6. **Attribution wording is a trap.** "Listed by <firm>, <agent>" is safe; "Courtesy of" and "Presented by" are banned by some MLSs.
7. **Photos are ours to cache.** Some platforms sign and expire media URLs; one rule for all: download once into R2.
8. **Nothing is testable before credentials.** The first week with a real feed is a measurement week (page size, deletes, media
   behaviour, counts vs the MLS). Do not schedule the public launch before it.

## The sequence (stage, output, gate)
| # | Stage | Who | Output | Gate | Time (fill on first run) |
|---|---|---|---|---|---|
| L0 | **Intake**: cities served; which MLSs the brokerage and the agent belong to; broker of record (name, DRE, email); current IDX vendor + contract end; sold/pending wanted; priority of cities | Lead with the client | `icm/work/p1/LISTINGS-INTAKE.md` in the client folder | every city mapped to an MLS; membership known per MLS; broker of record named | |
| L1 | **Map and plan**: licences needed, delivery platform per MLS, which route (direct vendor licence; Combined IDX; interim vendor), fees known so far, the launch order | Lead | `LISTINGS-PLAN.md` | owner picks the route (pickable options) | |
| L2 | **Client emails** (drafted by us, sent by the client): to us (answers to L0), and one per MLS asking for an IDX feed naming Omnikom as vendor | Lead drafts; **client sends** | `LISTINGS-EMAIL.md` | owner approves the draft; client confirms sent + date | |
| L3 | **Vendor onboarding per MLS**: Omnikom's vendor / consultant application, fee, insurance and company papers, data licence agreement signed by Omnikom (owner signs), participant agreement signed by the broker, website URL(s) registered | Owner (signs, pays); Lead (papers) | agreements filed in `E:\Omnikom Platform\.secrets\agreements\<mls>\` (git-ignored) + a row in `tenant_feed` | both agreements countersigned; credentials received and saved with `save-secret-from-clipboard.ps1`; `check-api-keys.mjs` returns 200 on `$metadata` | |
| L4 | **Rule set**: the MLS's current IDX rules, disclaimer text, logo, attribution, statuses, sold window, field list, result cap, refresh, reporting duty, written into `mls_source.display_rules`, confirmed by the MLS in writing | Lead | `display_rules` v1 + the MLS's confirmation email filed | `rules_confirmed_by` set; compliance gate fixtures updated | |
| L5 | **Measurement week** with real credentials: `$metadata`, page size honoured, full-pull request count, delete behaviour, media URL behaviour, timestamp timezone, count per city vs the MLS's own count | SEO analyst / builder | `MEASUREMENTS-<mls>.md` + `mls_source` row filled | V1 below passes | |
| L6 | **Backfill + incremental loop** on the staging tenant: Node backfill, media backlog cleared, Worker cron running 15 min, sweep nightly, monitor on | Builder | sync runs in `sync_run`; dashboard panel | V2 below passes | |
| L7 | **Pages** on the private preview (noindex): search, city pages with the content contract copy, listing pages, sitemap, 410 path, lead form into the inbox | Builder | preview URL | V3 + V4 below; design gates from `design-engine.md` S4-S6 on the listing sections | |
| L8 | **MLS pre-launch notice**: send each MLS the preview URL + the compliance-gate report; fix what they ask | Lead (client forwards if the MLS wants the participant to) | MLS reply filed | MLS has no open objection (or none within its stated window) | |
| L9 | **Go-live**: domain attached last (platform rule), robots allows HTML, blocks `/api/`, sitemap submitted in Search Console, Brivity search retired or kept on a subdomain per the owner's choice | Owner clicks | live URLs | V5 below | |
| L10 | **Ongoing ops**: monitor, monthly customer list by the 5th, rule-change reviews, annual fees, client exit procedure | Lead / platform | ops log | monthly checklist ticked | monthly |

## Intake questions (L0, asked as pickable options where possible)
1. Which MLS(s) is the **brokerage** a Participant of? (bridgeMLS / Bay East / CCAR; BAREIS; MetroList; other; not sure)
2. Which MLS(s) is the **agent** a Subscriber of?
3. Who is the **broker of record** (name, DRE number, email)? They sign every MLS form.
4. Which cities / ZIPs must have listings at launch; which can wait?
5. Show **Pending** and **Sold**? (extra tier at BAREIS; sold rules differ)
6. Current IDX vendor: contract end date, admin access, can leads be exported?
7. Does the client want the current search kept on a subdomain until ours is live?
8. Any listings the client adds by hand (pocket / coming soon)? (Default no: Clear Cooperation exposure.)

## The email the client sends each MLS (L2)
One short email per MLS from the broker of record (or the agent with the broker copied), from their own mailbox, to the MLS's IDX
desk. Template (adapt the names; the ELEV8 version is `E:\Alex Sevilla\icm\work\p1\LISTINGS-EMAIL.md`):

> Subject: IDX data feed request for <website domain>, vendor Omnikom
>
> Hello <MLS> IDX team,
> I am <name>, <broker of record / agent> at <brokerage> (DRE <number>), a Participant/Subscriber of <MLS>. We are moving our
> website <domain> to a new vendor, **Omnikom** (contact: <owner name>, <work email>), who will display IDX listings on our site.
> Please send us and Omnikom the forms and steps for an IDX data feed to a new vendor (participant agreement, vendor / consultant
> data access agreement, fees, and the current IDX display rules and disclaimer), and tell us which data access method you issue
> (RESO Web API or other). Our website URL for the application is <domain>.
> Thank you, <name>, <phone>

Known IDX desks (research/01-03, 2026-10-27; confirm on the MLS site before sending): bridgeMLS `idx@bridgemls.com` /
`support@bridgemls.com` (925.363.2333); Bay East `idx@bayeast.org`; CCAR routes paperwork through the vendor
(925.295.1270); BAREIS `idx@norcalmls.com` (written request from the member must come first; 707-575-8000); MetroList
`idxapprovals@metrolist.net` ((916) 922-7584 ext 630; the Subscriber Authorization Form names the domain and vendor).

## What Omnikom signs and provides (L3)
- **bridgeMLS family**: Consultant's Data Access Agreement for IDX v6.0 (vendor), mailed or faxed; the broker's IDX Data Access
  Agreement; Bay East's 2-page IDX application (page 2 vendor; max 2 URLs per application); monthly customer list by the 5th;
  stated fees: $145 set-up per new user; "$3,000 per year BBO/DAA fee" (clause 45, payer unclear: ask). Countersign "within 3
  business days" stated.
- **BAREIS**: 3rd-Party Vendor Application ($50 non-refundable) after the member's written request; needs privacy/security policy
  URL, CA Secretary of State registration, E&O or media liability insurance, existing MLS contracts, example product URLs, API or
  RETS choice; then the data licence agreement and the licence fee (quoted during application); 3-6 weeks.
- **MetroList**: the agent's Subscriber Authorization Form (domain + vendor) signed by the Responsible Broker to
  `idxapprovals@metrolist.net`; the new-vendor route is not public: ask in the same email.
- Omnikom's side, prepared once and reused: company registration, insurance certificate, privacy and security policy URL,
  the compliance-gate report format, a named compliance contact.

## Onboarding per delivery platform (L3-L5)
| Platform | Auth we expect | First call | Notes |
|---|---|---|---|
| Rapattoni RESO Web API (BAREIS, MetroList) | OAuth2, grant issued by MLS staff (password / auth-code / client-credentials documented) | `GET <base>/$metadata` then `Property?$top=1` | base URL supplied at approval; store as `MLS_<ID>_BASE_URL` |
| Paragon RESO Web API (bridgeMLS family) | unknown until approval (REPORTED: "Property Information Central", paragonapi.com) | same | vendor agreement text still says RETS: ask which is issued |
| Bridge Interactive | static server token | `.../OData/<dataset>/Property?$top=1` | 200/page, 10,000 skip cap, replication endpoint by MLS permission |
| Trestle (Cotality) | OAuth2 client credentials `scope=api` | `.../odata/$metadata` | 1,000/page; no delete reporting: key sweep |
| MLS Grid | long-lived bearer | `.../v2/Property?$filter=OriginatingSystemName eq '<mls>'&$top=1` | media URLs single-use, 1 h; `MlgCanView` deletes |
| RETS only | n/a | n/a | **BLOCKED** in v1: report; unblock = vetted RETS client or an API vendor in the middle |

## Verification gates (run by the Lead, never trusted from a builder's report)
- **V1 Data matches the MLS** (L5): for 2 cities per source, the count of Active listings on our side equals the MLS's own public
  count (the MLS consumer site or the client's current IDX pages, read in the browser, scroll bottom then top) within the sync
  window; 5 random listings compared field by field (price, beds, baths, sqft, status, agent, office, photo count); timestamps
  parsed as UTC; command output pasted into `MEASUREMENTS-<mls>.md`.
- **V2 Refresh SLA** (L6): `sync_run` shows a successful incremental run every 15 min for 48 h; a listing changed at the MLS
  (watch one the client knows about) appears changed on our side within 30 min; a removed listing returns 410 within 30 min;
  freshness alert watched-fail (stop the cron, see the alert, restart).
- **V3 Compliance renders** (L7): `tools/listings/compliance-gate.mjs` passes for every source and every page type; watched-fail by
  blanking the disclaimer in a fixture; the owner reads one of each page type in the browser and finds the disclaimer,
  "Data last updated", attribution, firm name + DRE, privacy link, consent text.
- **V4 Pages pass the site gates** (L7): the platform's render gate and the skill's SEO gate on a city page and a listing page;
  `noindex` on filtered search URLs; sitemap valid; JSON-LD valid; PageSpeed mobile + desktop recorded with conditions.
- **V5 Go-live** (L9): live URLs return 200 with the compliance strings; robots and sitemap live; Search Console shows the sitemap
  read; the MLS notified with the live URL; `tenant_feed` row marked live with the date.

## Go-live checklist (L9)
- [ ] Every source: agreements countersigned, credentials in `.secrets/`, `rules_confirmed_by` set, V1-V4 green and pasted.
- [ ] MLS pre-launch notice sent with the preview URL and the gate report; replies filed.
- [ ] Firm name + DRE numbers on every page; privacy policy; TCPA consent text; Equal Housing statement.
- [ ] No "MLS" in any URL, email or firm name on the site.
- [ ] Lead form on a listing page lands in the inbox with the listing key (one test lead, then deleted, on the preview only).
- [ ] 410 path tested; sitemap submitted; robots blocks `/api/`.
- [ ] Monitor alerts routed to the owner; monthly customer-list task scheduled.
- [ ] Owner clicks: domain attached, Brivity decision executed.

## Ongoing ops (L10, monthly unless noted)
- Monthly customer list to each MLS that asks (bridgeMLS / Bay East by the 5th).
- Review MLS rule notices (7 days' notice at bridgeMLS): update `display_rules`, bump `rules_version`, re-run the compliance gate.
- Check freshness and count-drift reports; clear media backlogs; rotate credentials when the platform asks.
- Annual: vendor fees, insurance certificate, agreement renewals.
- Client exit: end `tenant_feed`, stop their listing routes, tell the MLS in the next customer list, keep the shared source for
  others; the client gets their site code without MLS data (the licence is not theirs to take).

## Rules that never bend
- The client sends the MLS emails; Omnikom never contacts an MLS on the client's behalf without the client's and the owner's OK.
- Read-only on every MLS and vendor site; no sign-ups, no forms, no logins during research.
- Credentials only in `.secrets/` and platform secrets; never in chat, code, DB rows or logs.
- No listing data on a public page until the source's rule set is confirmed and the compliance gate is green.
- Never modify listing data; never show a field outside the allowlist; never "Courtesy of".
- Facts carry source and date; UNPROVEN stays out of client text.

## Running it
In-session: Lead + one builder per component (connector, media, renderer, gates), one file per agent, the Lead re-runs every gate.
The client-folder files (`LISTINGS-INTAKE.md`, `LISTINGS-PLAN.md`, `LISTINGS-EMAIL.md`, `MEASUREMENTS-<mls>.md`) live in
`icm/work/p1/` of the client project; the platform files (`mls_source` rows, tools, gates) live here.
