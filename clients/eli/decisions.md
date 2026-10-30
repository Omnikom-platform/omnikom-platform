# Eli Buys Homes (Eli Masudi): owner decisions (append-only, newest last)

Every decision the owner (or Dave, relayed) states about Eli's business or the shared setup that touches it, dated, in the words
the project files quote. Platform-wide decisions stay in `planning/DECISIONS.md` (cited by item number); this file records what
each means for Eli. Decisions only about the other client of the folder are in `clients/vtv` and are not repeated. Sources:
`E:\Francine & Eli\icm\knowledge\decisions\log.md` (the project's log, cited by line), `E:\Francine & Eli\.claude\POSITION.md`
(cited by dated section), `planning/DECISIONS.md`. Where the project's log and a later platform decision disagree, the later
platform decision is the binding one and the row says so.

| Date | Decision (owner's words where we have them) | Source | What it changes for Eli |
|---|---|---|---|
| 2026-10-17 | "Last name is spelled Masudi" | `icm/knowledge/decisions/log.md` line 18 | Spelling used everywhere |
| 2026-10-17 | Never submit any form on the live sites | `icm/knowledge/decisions/log.md` line 22 | His old site was only read; the `/account/` REsimpli login was excluded from the capture |
| 2026-10-17 | "Our DB owns leads from day one; any old CRM (REsimpli) is only a mirror during the switch" | `icm/knowledge/decisions/log.md` line 21 | His leads end in a database we build, not in REsimpli |
| 2026-10-18 | The first samples were rated 1/10 ("cheap", "a landing page for a form"); the next must be full multi-page websites with licensed photos | `icm/knowledge/decisions/log.md` line 56 | `proposals/eli/` was rebuilt as a multi-page site |
| 2026-10-18 | The private samples may use his own content from his current site, tagged "from today's site"; the live site follows the defaults | `icm/knowledge/decisions/log.md` line 57 | His seller promise, process and FAQ come from his current website |
| 2026-10-18 | Overnight the Lead brings Eli's sample "to the same level" as the other client's (own content, the v4 motion engine, a phone app layer, back-cover footer) and runs the same quality loop | `icm/knowledge/decisions/log.md` line 59 | `proposals/BRIEF-v5-eli.md`, `BRIEF-v5.1-eli-space.md`; 26 pages, spacing system on every page |
| 2026-10-18 | Answers to the partner list on the clients' behalf: two separate websites (one dashboard, two tenant accounts); REsimpli not used from day one (his number and leads move out first); the AI may call people who fill in a form, with consent as the form checkbox and the lawyer approving the wording; keep the name Eli Buys Homes, "Eli Buys Homes is Eli's own business"; the blogs are managed by us, AI-drafted, each owner approves his own posts | `icm/knowledge/decisions/log.md` line 67; `deliverables/docs/INTERNAL-partner-sheet.md` section A | Order of the switch-over: number and leads first, REsimpli cancelled last |
| 2026-10-19 | "since we already created the two websites we will be going with making better over time": the built sites are the starting point of the real sites | `icm/knowledge/decisions/log.md` line 70 | `proposals/eli/` carries into the build; no backend before the blueprints are signed |
| 2026-10-20 | Dave (CEO, relayed): a seller who wants the other option (cash sale or listing) is handled by the two clients between themselves; our systems do not route or pass leads between the businesses | `icm/knowledge/decisions/log.md` line 77 | No cross-business hand-off feature |
| 2026-10-20 | Preview links for the meeting, "just let it work": no password, noindex and robots Disallow, front end only, deployed only with `tools/deploy-preview.mjs`. For Eli: the "Design sample" top bar and footer line were removed (owner); the form notes "Design sample: this form does not send" were KEPT (owner) | `icm/knowledge/decisions/log.md` line 79; `.claude/POSITION.md` section "2026-10-20", last bullet | https://eli-omnikom-website.pages.dev; forms send nothing |
| 2026-10-20 | Each business gets its own OmniSuite account and runs its own AI employee team on its own Claude account; the clients own sites, CRM and data and rent the engine | `icm/knowledge/decisions/log.md` lines 74 and 75 | The OmniSuite half was superseded on 2026-10-22 and again by the platform rows below |
| 2026-10-22 late | New direction: one full, separate account per business (own website, dashboard, CRM, database); the multi-business platform is dropped; "We open all accounts and hand them the logins ... and we will hold access just in case they need troubleshooting" | `icm/knowledge/decisions/log.md` lines 88 and 100 | Superseded in part by the platform decisions below (one multi-tenant database, Omnikom holds the accounts) |
| 2026-10-23 | "Lift all legal gates we got the green light": the owner chose the automation holds only; DEF-09, 13, 14, 15 lifted | `icm/knowledge/decisions/log.md` line 123 | Design of the AI follow-up for him; the lawyer's written approval is NOT on file (UNPROVEN) |
| 2026-10-26 | Platform: Omnikom holds the running accounts (Search Console, hosting, deployment); the client keeps domain, content, enquiries; on exit the client gets the website's codebase; one multi-tenant Supabase database; one Omnikom Cloudflare account; the AI voice agent is a rented add-on provided by OmniSuite | `planning/DECISIONS.md` 9, 11, 12 (owner 2026-10-26) | Applies to Eli when an agreement is made; none is on file |
| 2026-10-28 | Platform: what goes into every V2 site; the industry collection for a cash home buyer is "situations, purchases", client-fed through the dashboard; old-site features are cut | `planning/DECISIONS.md` 18; `sops/clients/site-scope.md` section 3 | His situation pages (divorce, downsizing, inherited, relocating) become client-fed collection rows in the platform |
| 2026-10-29 | Platform: nameservers go to the Omnikom Cloudflare account; the look-folders live in the platform repo; "ELEV8 moves first ... Rainmaker and VTV follow as the M4 work orders". Eli's draft is NOT named in that list | `planning/DECISIONS.md` 26, 27 | `sites/eli/design/` does NOT exist; whether and when his draft is an M4 work order is not decided (see `status.md`) |

## Open owner questions that touch him (not decided)
| Question | Where it is recorded |
|---|---|
| Consent wording approval (the review doc) and the Architect's go for the blueprints | `.claude/POSITION.md` section "2026-10-26 END OF SESSION", "Still open for the owner" |
| Prices and terms of the offer (six decisions for Dave and Abdo) | `deliverables/docs/INTERNAL-how-we-charge.md` section 7 |
| A chart in his review says one competitor has 99 city pages while the competitor audit says 5; "settle this before the PDF is sent to anyone outside" | `.claude/POSITION.md` section "2026-10-20", "UNPROVEN / open" |
