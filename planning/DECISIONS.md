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
