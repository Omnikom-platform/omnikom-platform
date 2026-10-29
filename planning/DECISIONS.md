# Owner decisions

## 2026-10-24 (on planning/ANALYSIS.md)

1. **CRM: lead inbox + push to any CRM.** The dashboard holds a lead inbox (list, status, owner, notes, export, webhook). The
   follow-up engine is **OmniSuite**, rented by API key: voice agents, sequences, and MARY's Convert / Cultivate / Recover run
   there. OmniSuite will be expanded to serve this as one of its backbones for leads end to end. The platform pushes leads to
   OmniSuite (or the client's own CRM); it does not rebuild those features.

2. **Humans in the loop: the Rainmaker way.** The site is built and deployed to a private preview automatically; humans do
   **design approval** and **fact/legal sign-off** on the preview; the answers fill the placeholders; the domain is attached last.
   Everything else is automatic: research, scoring, SEO plan, build, gates, deploy, monitoring. Goal: once every step is documented
   and proven, remove the human gates and run fully automatic.

3. **Industries: one standard procedure for every industry.** No pre-built per-industry schemas. The same run works for a realtor,
   an insurance agency or a dog-food chain: the intake research and the SEO plan produce the client's own pages, collections and
   entities, and the content contract is generated from that plan. Consequence: the contract must be generic (sections and
   collections declared by the plan), not hand-written per industry.

4. **Skills live in this repo.** They are copied into `skills/` (the platform's source of truth) and stay usable outside the repo
   for side work. Drift rule: `skills/SOURCE.md` records where each copy came from; changes made outside are synced back on purpose,
   never silently.

## 2026-10-24 (on planning/REQUIREMENTS.md)

5. **(SUPERSEDED 2026-10-26 by 11: Supabase chosen, no spike.) Tenant data: spike first.** Short test of Supabase vs Cloudflare D1 before step C; no choice until then.
6. **Content master copy: database rows.** The content contract's values live in the tenant DB; version history and rollback must
   be built in (no git-file source of truth).
7. **Hosting: one Omnikom Cloudflare account** for all client sites (fully scriptable with one upgraded token); the client still
   owns the domain.
8. **OmniSuite is `E:\Omnisuite final stage the CTO Packets\omnisuite-platform`** (not `D:\Omincom\Omnikom Platform build for the
   Suite system`). Its engine is **not yet upgraded to work as an API**, so the lead adapter (O1) waits for that upgrade. Its own
   session can be asked about it: resume steps in `E:\Omnisuite final stage the CTO Packets\RESUME-THIS-CONVERSATION.txt`.

## 2026-10-26 (owner, while the setup-service brief was being written)

9. **Omnikom holds the running accounts, not the client.** Google Search Console, hosting and deployment are on Omnikom's
   accounts (not "in the client's name"). The client keeps their domain, content, enquiries and listings. **On exit** the client
   gets the website's codebase, and Omnikom keeps the site hosted as it is. Omnikom is sold as a platform: the setup is how a
   client gets onto it (`E:\Francine & Eli\deliverables\docs\OMNIKOM-setup-service.md`).
10. **After the setup, the growth loop:** optimise organic (Google + AI answers) until it levels off; paid ads only after that.
11. **Stack decided (supersedes 5, the DB spike):** ONE multi-tenant database on **Supabase**; ONE Omnikom business Cloudflare
    account hosts and deploys every client site (= 7); ONE Omnikom Google Search Console account manages every site. Each client
    gets a **dashboard login** where they can **post new articles / blog posts** and **change wording inside their pages**.
12. **The AI voice agent is a rented add-on, fully provided by OmniSuite** (refines 1). The owner is turning the whole OmniSuite
    engine into an API-key service: per client we create their profile + knowledge base in OmniSuite and connect it to the
    **custom CRM built inside the client's dashboard**. The client pays for the voice agent separately (rent). Until the
    OmniSuite API exists, the CRM side waits on it (see 8).

## 2026-10-28 (owner, ELEV8 session)

13. **Order of work:** (1) finish the content contract end to end (`TENANCY-AND-PUBLISHING.md` + the contract itself); (2) build the
    ELEV8 website on it; (3) build the platform's database, users, connections and backend layer that manage every website in the
    **"V2 program"** (the program this repo is for).
14. **The contract must cover every industry Omnikom sells to** (owner: "13 or 14 industries"): one shared core, each client's own
    collections from its plan (3), expandable over time. Proof is a run of the contract against every industry, not a claim.
    Industry list found (2026-10-28): OmniSuite's 13 niche packs, `E:\Omnisuite final stage the CTO Packets\omnisuite-platform\spec\30-product\niches\`
    (agency, b2b, chiropractic, cleaning, coaching, default, dental, fitness, home-services, legal, med-spa, real-estate, solar).
    Not in it: insurance (Rainmaker) and cash home buyer (Eli). Website compliance rule files exist for only 4 industries
    (skill `rules/industries/`: cash-home-buyer, editorial-media, insurance-agency, real-estate-agent).

## 2026-10-28 (owner, during the blueprint)

15. **No Docker. One Supabase account with two projects: staging (testing) and production.** Local checks keep the plain-Postgres
    stand-in; every cloud acceptance test runs on the staging project; production only receives migrations already proven on
    staging. Owner: "docker of the table but a supabase account with two databases projects one for testing one for production".
16. **Build once, launch by edits.** Every V2 site is built a single time, its content in the contract's shape, to the full SEO
    standard (skill build lane, 547-rule checklist, 13 launch gates) as a noindex preview. Client review changes rows, not code;
    launch is a fixed list of blocks: approved wording, real media, live forms, search link, redirects from the old site, then
    noindex off + strict gate + Search Console + domain. Owner: "make sure that this is a part of the SOP and skill of the platform
    so we don't have to recode the website". To do: `sops/draft-to-launch.md` + the skill's build stage, written from the ELEV8
    run (first real instance), then proven on the next site.
17. **The client gives facts and access, never our work** (2026-10-28, after the rejected ELEV8 115-question PDF). A V2 client
    is asked only facts that only they can know plus access: at most 12 questions from the fixed catalogue in
    `sops/client-questions.md` (people and licences, regulated identity, offer terms, fees line, media, account ownership,
    reviews and Google Business Profile, lead-alert recipients, legal sign-off), in the question-sheet format of
    `templates/client-questions/`, plus one short forwardable email. An unsourced claim is our research task: research it, else
    use the safe default, else (only if in the catalogue) one merged question. Wording, pages, features (listings, IDX, search,
    cut; content comes through the contract, leads go to the Omnikom CRM) and any failing checker rule are never
    client questions. `tools/client-questions/questions-pdf.mjs` refuses a sheet over 12 questions, without "Why we ask", or with
    internal Q-ids. Owner: "If they're gonna do that, what is the fucking purpose of us existing as a V2 fucking engine?"
    DECISIONS 16's "client review changes rows" means the client's facts change rows; it does not mean the client reviews the wording.
18. **What goes into every V2 site** (2026-10-28): `sops/site-scope.md`. The same core for every industry (home, team and
    profiles, services, city/area pages from the plan, reviews, FAQ, articles, contact, legal; leads to the Omnikom CRM; the 547
    rules and 13 gates). Omnikom writes the structure and page wording. The client feeds services, articles, their industry
    collection (e.g. real-estate listings they post themselves, not IDX) and reviews through their user dashboard (with the
    CRM), and each of those sections ships as a marked placeholder that fills from the dashboard. Owner: "we put the placeholders
    as we did with the draft for them and that is sourced from what they feed into it through the dashboard". Old-site features
    (IDX/Brivity search, old form tools, widgets) are cut. Compliance packs exist for real estate, insurance and cash home buyer;
    the others are NOT BUILT yet.

## 2026-10-29 (owner, ELEV8 launch)

19. **Launch is a command with a ledger and a stop condition** (2026-10-29, from the ELEV8 production list
    `E:\Alex Sevilla\draft-site\LAUNCH-ENTERPRISE.md`). A V2 preview becomes a production site through one command, the same for
    every industry: `sops/launch.md` (22 items L-A1 to L-D22 in groups A before launch, B launch day, C first 30 days off-site,
    D ongoing, each with its "done when" and how it is proven: an automated check or OWNER-PROOF), architecture
    `docs/blueprint/12-LAUNCH.md`, tool: the skill's `scripts/launch.mjs`. The command writes a ledger (`<pewp>/launch.json`),
    walks the owner through every access to grant as pickable questions (never a password: omnikom is added as a user), and
    hands one agent a one-shot task. The task ends only when every item is PASS with its check's own output line or recorded
    owner proof, or BLOCKED with an allowed reason (waiting on owner access, waiting on client answer Q-n, needs OWNER-PROOF,
    third-party outage; plus not-yet-due, set by the script for C and D items) and what unblocks it. This is the launch half of
    the to-do in 16. NOT BUILT: a platform job or dashboard screen for the ledger; checks for email DNS records, the test lead
    and CrUX (OWNER-PROOF for now).

20. **The writing gate: speed and agent readiness are written in, not cleaned up** (2026-10-29, from the ELEV8 PageSpeed read
    `E:\Alex Sevilla\site-checks\live-audit-2026-10-29\PSI-FINDINGS.md`). The first real V2 site scored 97 on mobile PageSpeed,
    and every red item came from a habit in how the build writes code. So the engine applies 7 rules while it writes a site
    (`tools/design-engine/WRITING.md`), each a number or a yes/no: WG-1 critical CSS inline (14 KiB gzip or less per page), the rest
    deferred, no render-blocking stylesheet (render-blocking savings 0 ms); WG-2 CSS per template or purged per page, wasted CSS
    under 8 KiB gzip per page (the 20% proxy was recalibrated from live PageSpeed on 2026-10-29); WG-3 images sized to their slot (`sizes` from the real slot width, `100vw` only for full-bleed, WebP/AVIF at
    quality 60-70, image-delivery savings under 10 KiB); WG-4 no layout read after a style write in our JS, forced reflows from
    our scripts 0; WG-5 ARIA roles only on compatible elements, axe `aria-allowed-role` 0; WG-6 agent readiness (clean
    accessibility tree, `/llms.txt` generated from the contract, Lighthouse Agentic Browsing 2/2); WG-7 `Strict-Transport-Security`
    and `Cross-Origin-Opener-Policy: same-origin` in `_headers` and on the live response. Enforced in three places: the site's
    build stops with `BUILD STOPPED: WG-n ...` (measured rules run in the site's `tools/writing-check.mjs`); the skill's
    `scripts/writing-gate.mjs <built site dir> [--url] [--psi-dir]` checks again, independently; and the launch ledger checks the
    live site (`live-headers` on L-B8 now also requires COOP; the new check `writing` on L-B9 runs writing-gate on the launch
    build with the live URL and the saved PageSpeed JSON). Watched-red rule: each check is proven red by a mutant that breaks the
    code it covers, red for the right reason, before it counts. NOT BUILT: the Agentic Browsing category by API (the PageSpeed
    API does not expose it yet, so WG-6's 2/2 is read in the browser at pagespeed.web.dev: lead's browser or OWNER-PROOF);
    Trusted Types CSP (needs a CSP review first); WebMCP form metadata (once the spec settles).

## 2026-10-29 (owner, platform step C: database, login, CRM)

21. **The client dashboard is super simple, the fewest screens, smooth; the owner brings the design references; the effort goes
    to the database and the backend** (2026-10-29 18:13, owner's words: "for the design I will pick some references online just
    make sure that we are actually ready to build and write the CRM features down the layout how it will look enteries manually
    and things like that I wan the user dashboard to be super simple least amount of screens super smooth and things like that
    focus on the backend and DB structure"). So: no design tournament or reference board run by the platform sessions for the
    dashboard (the one made before this steer, `docs/blueprint/design/`, stays on disk as material, not as a pick); the CRM is
    written down as a plain document (`docs/blueprint/15-CRM.md`: every feature, the layout, the screens, how a client enters a
    lead or a change by hand); the data model (`13-DATA-MODEL.md`), the lead path (`14-LEAD-PATH.md`), auth and roles, and the
    content-change path with the build gates are the deliverable. Working defaults taken by the lead on the same day because the
    owner answered "no preference" (reverse by saying so; nothing exists on a real project yet): the lead timeline is ONE table
    `lead_events` (notes and CRM pushes folded in, `lead_notes` and `lead_pushes` dropped before any real lead exists); the
    `api_keys` registry (hashes and Vault names, never values) is built in the same migration. Email provider named by the owner
    for the master .env: Resend (this is D5; its DECISIONS line is this one).

22. **The budget baseline is the free tiers, and the engineering must scale from there** (2026-10-29 20:20, owner, /loop
    brief: "a budget db perfect db and backend top practices that allows use to scale so big with what we will have which will
    be that free supabase and free cloudflare"). Supabase Free (two active projects = staging + production, DECISIONS 15; Pro
    only when a measured limit is hit) and Cloudflare Free (Workers, R2, Queues) are the baseline; Resend Free for mail. The
    limits, their sources with the date read, what the design does to stay inside them and the measured trigger for each
    upgrade: `docs/blueprint/18-BUDGET-ARCHITECTURE.md`. Engineering first, then the UI and UX pass (owner: "then we can
    upgrade the ui and ux and how it looks when the engineered plan is fully in place").
23. **The platform expands in two directions and the building blocks must carry both** (same brief): vertically per client
    (paid add-ons: the AI concierge that calls a lead, agrees a meeting time and books it; SMS and email about that meeting;
    CRM export and import with a mapping wizard that learns the client's own sheet layout; a setup wizard and connector when a
    client pays to activate an add-on) and horizontally (more industries, more sites per client, more clients, white label).
    The map, the blocks and the build order: `docs/blueprint/17-EXPANSION-MAP.md`.
24. **Push to GitHub to keep everything saved** (2026-10-29 20:21, owner: "you can push to main on github for the omnikom
    platform to keep everything saved"). Standing permission for this repo only: after each commit the session pushes `master`
    to the `backup-gh` remote (the repo's only remote; its default branch is `master`, there is no `main`). Still never pushed:
    `film/`, `.secrets/`, `creds and accounts login/`, anything gitleaks flags.
