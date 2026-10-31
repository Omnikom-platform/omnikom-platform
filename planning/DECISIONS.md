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
    `sops/clients/client-questions.md` (people and licences, regulated identity, offer terms, fees line, media, account ownership,
    reviews and Google Business Profile, lead-alert recipients, legal sign-off), in the question-sheet format of
    `templates/client-questions/`, plus one short forwardable email. An unsourced claim is our research task: research it, else
    use the safe default, else (only if in the catalogue) one merged question. Wording, pages, features (listings, IDX, search,
    cut; content comes through the contract, leads go to the Omnikom CRM) and any failing checker rule are never
    client questions. `tools/client-questions/questions-pdf.mjs` refuses a sheet over 12 questions, without "Why we ask", or with
    internal Q-ids. Owner: "If they're gonna do that, what is the fucking purpose of us existing as a V2 fucking engine?"
    DECISIONS 16's "client review changes rows" means the client's facts change rows; it does not mean the client reviews the wording.
18. **What goes into every V2 site** (2026-10-28): `sops/clients/site-scope.md`. The same core for every industry (home, team and
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
    every industry: `sops/clients/launch.md` (22 items L-A1 to L-D22 in groups A before launch, B launch day, C first 30 days off-site,
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
    client pays to activate an add-on) and horizontally (more industries, more sites per client, more clients; white label was listed here and is struck by DECISIONS 31).
    The map, the blocks and the build order: `docs/blueprint/17-EXPANSION-MAP.md`.
24. **Push to GitHub to keep everything saved** (2026-10-29 20:21, owner: "you can push to main on github for the omnikom
    platform to keep everything saved"). Standing permission for this repo only: after each commit the session pushes `master`
    to the `backup-gh` remote (the repo's only remote; its default branch is `master`, there is no `main`). Still never pushed:
    `film/`, `.secrets/`, `creds and accounts login/`, anything gitleaks flags.
25. **Stop building expansion blocks; the next goal is proof on a real staging project** (2026-10-29 21:11, owner through the
    lead session after reviewing the files and commits): "finish the current tick (the mapping tool, if it is already running)
    and then stop building expansion blocks. No more add-on tables, connectors, bookings, messaging, CRM templates or their
    tests until a client has bought one; leave 17-EXPANSION-MAP.md as the map. The next goal is proof, not paper: the lead path
    running on a real staging project end to end, from the live ELEV8 preview form into the database and to an alert in the
    owner's inbox, once the owner has put the accounts in `creds and accounts login/`." What already exists (migration 3 and
    `tools/crm-map`, tested) stays as built and is not extended. Prepared for the proof: the D1-D5 options for the owner, D2
    settled as a question (Pages Function, which the ELEV8 preview uses today, or a Worker per site), D1 reconciled with
    DECISIONS 22 (free tiers first), `supabase/apply-staging.mjs`, `supabase/functions/capture-lead`, the site lead endpoint
    `factory/worker/lead-endpoint.mjs`, and `supabase/tests/e2e-lead.mjs`. The dashboard UI starts only after the lead path is
    proven.
26. **Client domains: nameservers to the Omnikom Cloudflare account** (2026-10-29 21:55, owner picked "Nameservers to our
    account"). The client keeps the registrar and ownership; the domain becomes a zone in our account (free); both the bare
    domain and `www` serve the site; we hold the DNS and copy the mail records exactly (checked by the launch ledger); leaving
    is pointing the nameservers back. Fallback for a client who refuses: `www` by CNAME from their DNS plus a bare-domain
    redirect at their registrar (Cloudflare serves an apex only from a zone in the account: custom-domains page, read
    2026-10-29). `20-SHAPE.md` section 3.
29. **Four setup decisions from the gap hunt** (2026-10-29 22:55, owner picked each recommended option): **D1 region: US West**
    for both Supabase projects. **D18 sign-in: magic link only**, no passwords (staff keep the second factor); the ASVS password
    chapter drops out. **D21 production secrets: a separate private production repository, free**, whose only workflow is the
    owner-run `promote`; the working repository never holds a production key. **D17 recovery objectives: at most 24 hours of
    data lost, back within 4 hours**: nightly dumps to R2 plus a second copy at another provider, a monthly restore drill
    (`18-BUDGET-ARCHITECTURE.md` 2.4). Source of the questions: `docs/blueprint/24-GAP-HUNT.md` E2 item 7.
30. **The platform tests itself through its own CLI on its own test workspaces; a client's preview is never a test vehicle**
    (2026-10-29 23:20, owner: "instead of using a draft website that might get refused, why don't we create a CLI tool that
    sessions use, calling the database and the same endpoints the websites use, as the tester for contracts, lead funnels and
    content pushing"; scope picked: test harness and staff tool; design here, Sonnet builds). Spec: `docs/blueprint/26-PLATFORM-CLI.md`.
    Step 2 of the build sequence now runs through the CLI on the seeded workspaces A and B; the ELEV8 preview's endpoint swap
    moves to step 7. Session ownership while both run: the setup assistant owns step 1 and the staging project, the CLI builder
    owns `tools/omnikom-cli/`, neither touches the ELEV8 Pages project.
27. **GitHub: one free account (an Omnikom organisation on the Free plan), one private repository, Cloudflare deploys from
    that repository** (2026-10-29 21:55, owner: "can't it be one main free account that houses all the repos and cloudflare
    deploys from that repo?" plus "do the real search needed"). Verified the same evening from docs.github.com: on Free,
    private repositories have no environments, no required reviewers and no branch restrictions, so the production gate
    cannot be a GitHub feature; it lives in our own code (the `promote` workflow takes the exact commit id as an input and the
    production database URL is used by nothing else; `apply-staging.mjs` needs `--i-mean-production`; one human in the org).
    Trigger to Team ($4 per user per month): a second engineer with write access. Included compute on Free is "$12 USD per
    month" (plans page; the minute equivalent is UNVERIFIED). `21-PROTOCOLS.md`.
    **Clarified 2026-10-29 23:10** (the owner had said "houses all the repos", plural, and asked "what is the design we have for
    the codebases of the websites", "would one platform repo lock us from the custom design process we have?"): a website's
    codebase shrinks to its look-folder (templates, colours, type: `sites/<slug>/design/`); the words and photos live in the
    database; the build is the one shared factory. The design process (references, directions, comps, the owner's pick, the
    section lab, variants, audit) runs per client in that client's project folder as today and is converted into the look-folder
    afterwards (the ELEV8 V4 -> partials step), proven by a screenshot comparison. Owner picked: **the look-folders live inside
    the one platform repo**; a folder can be moved out into its own repo later (a client's developers, a hand-over). The three
    existing drafts: ELEV8 moves first (its content file loads into the database once); Rainmaker and VTV follow as the M4 work
    orders; the old repos become archives.
28. **Hosting: a Cloudflare Pages project per client site** (2026-10-29 21:55; the owner delegated: "I don't know which one is
    what will serve right implementation for such platform", "research on the best actual practice"). Decided by the lead on
    the sourced facts in `20-SHAPE.md` section 3 and `21-PROTOCOLS.md`: it is what the two previews use today and it works;
    preview deployments per branch are free; Pages Functions carry `/api/lead` (built and tested); custom domains come from
    the account's zones (DECISIONS 26); 100 projects per account is the ceiling before a second account; direct uploads are
    not documented as counting toward the 500 builds a month (UNVERIFIED, to measure on the first deploys); the deploy token
    is account-level (per-project scoping UNVERIFIED), held only by the runner. This revises ADR 0002, whose reason (Pages
    project creation failing on 2026-10-23) no longer holds. Reversible: Cloudflare documents a Pages-to-Workers migration.
31. **No white label; branding is "powered by Omnikom"; a client who leaves keeps the code and the CRM** (2026-10-30 02:49,
    owner to the setup session, relayed to the lead: "we are not something hidden we are enterprise"). Lead alert emails and
    client-facing mail carry the client's own brand above and "powered by Omnikom" with our logo in the footer, "like any
    services". Exit terms in the owner's words: "if they wanted to exit we don't hold the website code hostage at all and we
    keep hosting it minus the other services like tracking the numbers SEO monthly reports etc but they will keep their
    access to the platform to check the CRM new leads and things like that". Effects: the white-label row of
    `17-EXPANSION-MAP.md` is withdrawn (no `resellers` table); DECISIONS 23's horizontal line loses "white label"; the email
    layout stays a step 5 design item; an offboarding path (hosting kept, add-ons stopped, CRM access kept, code handed over
    on request) is a step 5 item for `15-CRM.md` and `26-PLATFORM-CLI.md` slice 3 (`offboard`).
32. **One full-power Fable 5.1 session per build step; the lead session orients and manages, never builds** (2026-10-30 17:13,
    owner: "open a new session fable 5.1 and you manage the orientation; that session is able to spin its agents and start
    other sessions and you manage it and you hold the whole ecosystem; a session with full power for each step that is smart,
    efficient and has good judgement"). So: for every step of `25-BUILD-SEQUENCE.md` (step 2 onward) the lead session starts
    one Fable 5.1 session with the step's brief; that session runs its own agents and side sessions as it judges, writes its
    proofs into `docs/blueprint/PROGRESS.md` and `.claude/POSITION.md`, commits and pushes; the lead session verifies the
    step's "done when" with its own re-run (Rule 2) and starts the next step's session. The lead's context stays for
    orientation, review and the owner's questions. The step sessions run on Fable (not the "Sonnet for routine builds" default
    of CLAUDE.md rule 8); they may still hand mechanical work to Sonnet or Haiku agents.
    **Protocol, from the first run (2026-10-30 17:40, owner sent the step 2 session back to the lead instead of letting it
    fix a database bug it found):** a step session stays inside its brief; anything it finds outside it (a bug in another
    part, a decision to take) goes back to the lead as a finding with options, and the lead re-checks it, decides or asks the
    owner, and routes the fix to the session that owns those files. Every brief says so.
33. **Departments: a head of operations, department heads that spin builders, charters as the memory, a tool that creates
    new departments the same way** (2026-10-30 18:57 and 19:30, owner: "a master session that spins up builder sessions for
    anything related that mimics a client for testing ... a fable session that spins those sonnet sessions properly per building
    slice and per cli expansion ... an orchestrator for that department that creates the tools that will be used for the long
    run ... so we never have to figure our way from scratch in sessions that know nothing or rely on memory that expires";
    "make a tool for you that makes you able to create new departments following the same engineeringly right structure ...
    when it's time to have the department that will manage for example the PEWP SEO and audits ... turn the whole skill and
    process we have into a CLI expansion ... so every website we output has actual enforcement for the heading code structure").
    Shape and rules: `docs/departments/README.md`. Three departments today: head of operations (the lead; orients, routes,
    verifies, never builds), platform build (one fable session per step, DECISIONS 32), CLI and testing tooling (fable head,
    sonnet builder per slice; the omnikom CLI is the client stand-in and the home of every learned check). One owner per path
    (`tools/departments/check.mjs` fails on overlap); findings cross departments only through the head of operations; reports
    go up in two lines, proofs go into files; a learned check becomes a CLI command or gate, judgement stays a skill. New
    departments come from `tools/departments/new-department.mjs` (template, README row, check); the next one is SEO and
    audits, which turns the measurable rules of `skills/programmatic-enterprise-web-performance` into `omnikom audit` gates
    that every built site must pass before publish.
34. **Mechanical work goes to Haiku 5.5 agents; a standing Platform build head from step 4** (2026-10-30 23:25, owner:
    "anything mechanical must be handed to a Haiku 5.5 agent instead of wasting compute on test runs and mutation runs from
    the beefy models"; "yes create that standing head"). Mechanical = running a test suite, a mutant run, the gates, a
    grep or a file listing, a fixture rebuild, a deploy command, a status probe: anything whose outcome is the command's
    output. A head or a builder hands such a run to a Haiku agent with the exact command and reads back the verdict lines;
    Fable and Sonnet turns are for judgement, design, writing code and reading results. Every charter's Builders section
    names Haiku as the mechanical runner (`tools/departments/check.mjs` requires it). Platform build gets a standing Fable
    head (it was one session per step, DECISIONS 32): from step 4 the head plans the step as slices, runs Sonnet builders and
    Haiku runners inside itself, keeps the step's proof in PROGRESS.md and reports to the head of operations, who verifies at
    step level; a separate step session is started by the head of operations only when the head asks for one (context).

35. **Every site is planned from a prompt map, and the map reaches the built pages** (2026-10-31 03:40, owner: "SEO backlog,
    after step 4, yes, but it also needs to be counted for in the rest of the downstream chain, it needs to give us something
    in what is actually built"; source: an Instagram reel by davi.d_roberts, DfIsQP_vCoC, caption and transcript read by the
    head of operations; its numbers are the creator's claims and are not relied on). A prompt is a whole situation, not a
    keyword: scenario + comparison + constraint. The research stage of the SEO skill produces a prompt map: each row a prompt,
    its three parts, whether the business is named in ChatGPT, Perplexity and Gemini (owner captures and the Gemini check,
    public and polite as today), the page cited, and ONE fix (new page, improve a page, earn a mention). Sources for the
    buyer's words: the client's own lead inbox messages (that workspace only, never across clients), reviews and public
    forum questions already mined. The chain must consume it: plan stage covers every row with a brief or a written reason;
    briefs become contract pages, including two new page types the factory renders, `situation` and honest `comparison`
    (public sourced facts about the other option only, never invented claims: Non-negotiable 3); the gate fails a build that
    leaves a prompt-map row uncovered without a reason; the measure stage re-runs the map monthly and the dashboard shows
    named/cited per prompt. Ordering: SEO department backlog, first slice after step 4 is proven; page types with the platform
    head in step 5; the gate and the dashboard rows where those steps land. No 100-question volume target: a row without a
    source is not a row.

36. **Parked idea, noted only: Instagram comment-keyword to DM automation as a lead source** (2026-10-31 04:55, owner:
    "Only note the idea"; source: a reel by itstundeanthony, DfFbm6SiHyE, a ManyChat-style tool rebuilt on Replit; the head of
    operations read caption and transcript). Shape if ever built: one Cloudflare Worker (Meta webhook in, Graph API reply and
    DM out) and one D1 table of keyword rules, on Omnikom's own accounts in Meta developer mode first; as a client feature it
    needs Meta App Review and Business Verification for the comment and message permissions, so it would be a lead source into
    the existing inbox (DECISIONS 1), never a separate product. No backlog item, no slice, revisit at step 7 at the earliest.
    Two other reels read the same night added nothing to record: Lean4 proofs generating C (our equivalent is a rule as a test
    with a mutant, and the static factory does all work at build time) and "local SEO, not general SEO" (the research and
    plan stages already carry a location on every target and brief; a capture without a location is rejected).

37. **Design tells become audit rules; every look-folder opens with a five-line direction** (2026-10-31 05:20, owner: "Both
    pieces, SEO dept after slice 2"; source: the open skill unslop by Damir Sokolovsky, github.com/heydamir/unslop, CC BY 4.0,
    read by the head of operations on 2026-10-31 from the skill file itself, not the reel that pointed at it). (1) The skill is
    copied into `skills/unslop/` with its credit kept and a row in `skills/SOURCE.md` (non-negotiable 1). (2) Its machine-
    checkable tells become a rule family in `tools/audit` (a DSN prefix, each with a test watched red and a mutant): looping or
    bouncy motion classes (animate-pulse, animate-ping, transition-all, hover:scale, shimmer), gradient text and hue gradients
    as backgrounds, emoji in labels and headings, uppercase tracked labels, hype words and "AI-powered" copy, exclamation marks
    in headlines, greeting headlines, PRO or Beta badges, unverifiable-claim patterns ("loved by N+ teams", "Nx faster"), font
    weight 700 or more at under 14 px, negative letter spacing on small text. A built site that trips one does not publish.
    (3) The design stage of the SEO skill requires the five-line direction (product, character, world, moments, signature; the
    words clean, modern, sleek, minimal and premium banned) as the header of every look-folder's DESIGN.md, and the nine passes
    (spacing, colour, icons, copy, type, layout, details, visuals, motion) as the builder's order of work for design partials;
    step 5 builds under it. The skill's story video and snapshot scripts are not used (design-bench and the render gate exist).
    Ordering: SEO department, after its slice 2 is proven; the rules land before step 5's first look-folder.

38. **The running platform never needs Claude; anything that uses AI must also run from a paid key** (2026-10-31 05:45, owner:
    "we sure do too much stuff that needs to be less in cost and not rely on my Claude subscription cuz that might go away
    anytime, so at least we should have as much of this platform with all of its parts perfectly in place"; on the shape of the
    rule the owner said "no preference", so the recommended shape stands). (1) Runtime code (supabase/, factory/, tools/audit/,
    the workflows, the dashboard, tools/omnikom-cli/) imports no model SDK and calls no model API; a structural check in
    `supabase/tests/run-local.mjs` or `docs/blueprint/specs/run-all-gates.mjs` fails when one appears (platform head, with a
    test watched red and a mutant). (2) The AI operators of step D and every agent step that builds or improves a site (the SEO
    skill's `claude -p` workers, the department builders) run from an API key by environment variable as well as from the
    subscription, behind one harness, so losing the subscription stops nothing that is built and only changes how the next
    build is paid for. (3) Nvidia Kumo Tabular (open weights, commercial licence, single-table classification and regression
    without training; developer.nvidia.com/topics/ai/agent-knowledge-foundation/kumo, read 2026-10-31) is noted for step D as
    a possible lead-sorting model once clients have labelled lead outcomes; it cannot run on Cloudflare Workers (fixed model
    catalogue, 128 MB) and would run on the owner's GPU laptop or a small GPU host. Nothing starts now.
39. **A Design department is created when step 5 starts, not before** (2026-10-31 05:36, owner: "Create it at step 5").
    Until then the SEO and audits department keeps the design stage, the unslop copy and the DSN rules (DECISIONS 37). At
    step 5 the new department takes over `skills/design-tournament/`, `skills/unslop/`, the design stage file (an "except"
    path inside the SEO skill), `docs/blueprint/16-DESIGN-PARTS.md`, the wireframes and the look-folder reviews; the DSN audit
    rules stay with SEO because the engine is theirs. The head of operations scaffolds it with `tools/departments/new-department.mjs`.
