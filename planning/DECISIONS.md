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
