# Requirements: everything needed to build the platform (2026-10-24)

Inputs: `ANALYSIS.md` (parts, build order), `DECISIONS.md` (settled), `CONTEXT.md` (lessons, code map). Evidence paths were checked
to exist on 2026-10-24 (an existing file is not a proof that it works for the platform; "PROVEN" below means proven on a real
client, as cited). No code yet. Open decisions are marked **DECIDE**; unknowns **UNKNOWN**.

---

## 0. Shared spine (everything depends on this)

### 0.1 Multi-tenant database
- **Capabilities:** one workspace per client (tenant); every row tagged by tenant and isolated (row-level security or equivalent);
  operator (Omnikom) role sees all tenants, client role sees only its own; audit log of who changed what.
- **Stores:** tenants, users + roles, client facts (part 2), report runs + scores (part 1), content contract + versions (part 3/4),
  leads + status/notes (part 4), proposals + approvals (part 5), deploy history, integration credentials (encrypted).
- **Infra:** **DECIDE** Supabase (Postgres + RLS + Auth + Storage; used for OmniSkipX and the Suite) vs Cloudflare D1 (next to the
  sites; no built-in auth). ANALYSIS.md 6.2 says spike first.
- **PROVEN:** nothing for this platform. **TO BUILD:** all.

### 0.2 Content contract (the biggest change from how we built Rainmaker)
- **Capabilities:** one generic schema (DECISIONS.md 3): pages = ordered sections with typed fields; collections declared by the
  client's SEO plan (blog, services, areas, team, FAQs, testimonials, anything the plan names); brand = design tokens. Generated
  from the approved plan, not hand-written. Each field carries: value, source, status (draft / client-approved / locked).
  **Regeneration never overwrites client-approved content** (ANALYSIS.md 3.3).
- **Stores:** contract schema per site, content values + versions, media references, approval state.
- **Integrations:** reads the skill's plan output (`targets.json`, briefs); the factory renders from it; the dashboard edits it.
- **PROVEN:** the plan side (`plan-site` -> `approve.mjs` signed/locked -> briefs; `E:\Rainmaker\.pewp`). **TO BUILD:** the
  contract schema, generator (plan -> contract), and the renderer change (today text lives inside HTML: `E:\Rainmaker\site-src\`).
- **DECIDE:** where the contract lives as source of truth: DB rows (dashboard-native) vs JSON files in a per-client git repo
  (diffable, rebuildable) with the DB as an index.

### 0.3 Auth
- **Capabilities:** email login (magic link or password), roles (operator, client owner, client staff), invite a client user,
  tenant-scoped API keys for our own engines.
- **Infra:** comes with the 0.1 choice (Supabase Auth if Supabase; otherwise build or add a provider).
- **PROVEN:** nothing here. **TO BUILD:** all.

### 0.4 OmniSuite link (follow-up engine, rented by API key; DECISIONS.md 1)
- **Capabilities:** push each lead (with source page, form fields, consent text) to OmniSuite or the client's own CRM (webhook);
  read back status if the API allows.
- **Credentials:** an OmniSuite API key per tenant (or one platform key + tenant id). **UNKNOWN:** the API exists only in the
  Suite's spec (`D:\Omincom\Omnikom Platform build for the Suite system\spec\20-architecture\05-infrastructure-auth-api.md:311`,
  tenant API keys under `/api/v1/integrations`); not known to be built or live. **UNKNOWN:** that this repo is the "OmniSuite" meant.
- **PROVEN:** generic push only: forms -> Google Apps Script -> Sheet + email alert (`E:\Rainmaker\integrations\apps-script`,
  `E:\Rainmaker\tools\live-form-check.mjs`). **TO BUILD:** the lead API in our DB, webhook out, OmniSuite adapter.

---

## 1. Intake & Score (step A: Presence Report engine)
- **Capabilities:** one command: business name, city/area, phone, optional website + socials in; research the whole public
  presence (site crawl + phone speed, local listings, NAP consistency, reviews, socials, domain/DNS ownership, AI-answer samples);
  score with sources; render a PDF; human fact review before it goes out. Must work with **no website** too. Measure real time and
  usage per report (current estimates UNPROVEN, `POSITION.md`).
- **Stores:** each run: inputs, raw findings with URL + date, scores, report version, reviewer sign-off.
- **Integrations / credentials:** public web only (CLAUDE.md rule 4: no logins, no paid data APIs, stop on CAPTCHA, one 429 = stop
  that host). Headless Chrome for script-rendered pages and phone speed (already in the skill). Optional free keys: Google
  PageSpeed Insights API (free key) for field data; Common Crawl link graph (free, in the skill). Registrar/WHOIS via public RDAP
  (free, no key) is **TO BUILD**.
- **Infra:** runs locally first (laptop), later as a queued job (needs a worker host: **DECIDE** later, step E).
- **PROVEN:** report v2 by hand: `E:\Francine & Eli\deliverables\docs\website-review-francine.md` + `tools/review-pdf.mjs`; crawl,
  speed, research and local modules in `skills/programmatic-enterprise-web-performance/`; DNS export `E:\Rainmaker\tools\dns-export.mjs`.
  Plan: `E:\Francine & Eli\icm\work\presence-report-plan.md`.
- **TO BUILD:** the runner that chains the modules; no-website path; scoring rubric as data; RDAP lookup; review step; first proof =
  reproduce Francine's report, then calibrate on Eli and Rainmaker.
- **UNKNOWN:** local modules (`local-pack/grid/nap/reviews/profile`) are untested on a real client (ANALYSIS.md section 2).

## 2. Client Knowledge (ICM per client + librarian)
- **Capabilities:** every fact from intake + client answers, with source and date, stored per client; the librarian answers an
  agent's "what do I load for X" with a small, ranked set; facts marked verified / needs-sign-off.
- **Stores:** facts (text, source, date, status), documents/media the client supplies, the index.
- **Infra:** files first (`clients/<name>/` per ANALYSIS.md 7), then the tenant DB + object storage.
- **PROVEN:** one project, file-based: `E:\Francine & Eli\icm\`, `tools/icm-index.mjs`, `skills/icm-librarian.agent.md`.
- **TO BUILD:** per-tenant layout, intake -> facts writer, DB-backed version, librarian over the DB.

## 3. Website Factory (step B)
- **Capabilities:** design first (cheap distinct wireframes, owner/client picks: design-tournament *method*), design tokens; SEO
  plan -> approve; render the site from the content contract; launch layer (WebP + phone sizes, woff2, versioned assets, headers,
  redirects, 404); all gates; deploy a **private noindex preview** automatically; after design approval + fact/legal sign-off,
  attach the domain and deploy live (DECISIONS.md 2).
- **Stores:** design system per client, build artifacts, gate results, deploy history.
- **Integrations / credentials:**
  - **Cloudflare API token with Workers Scripts:Edit + Zone:Edit + DNS:Edit + Zone Settings:Edit** (today's token can deploy but
    cannot add zones, read DNS or change settings; CONTEXT.md "Technical lessons").
  - Cloudflare account id; production = **Worker with static assets** (Pages no longer creates new projects on this account).
  - Client domain: registrar access stays with the client; the nameserver switch needs the account owner's login code (plan for
    it; Rainmaker is waiting on exactly this, `POSITION.md`).
  - Google Search Console: add + verify each site (DNS TXT via the Cloudflare token); needs an Omnikom Google account as owner.
  - Lead backend per site (0.4).
- **PROVEN:** `E:\Rainmaker\site-src\build.mjs`, `E:\Rainmaker\tests\` (ui, forms 40 checks, a11y 0, media), `tools/deploy-live.mjs`
  (refuses noindex/placeholder/draft builds), `tools/worker-smoke.mjs`, strict SEO gate 13/13 (`E:\Rainmaker\.pewp`),
  `skills/design-tournament/`.
- **TO BUILD:** template generator rendering from the contract (no per-site bespoke code); one command plan -> preview; scripted
  zone + DNS + SSL settings (the CONTEXT.md checklist: keep Workspace MX/TXT, rewrite GoDaddy SPF, SSL Full strict, AI bots allowed);
  preview access for the client (link or login).
- **UNKNOWN:** whether the design pass can be cut from many owner rounds to one approval (design quality bar: `CONTEXT.md` design
  rules; owner rates LP 6/10, our best 6.5).

## 4. Control Center (step C: the subscription product)
- **Capabilities:** client logs in to their workspace; edits approved contract fields only (never code); uploads photos; publishes
  (rebuild + gate + deploy, reversible); lead inbox (list, status, owner, notes, export, webhook to any CRM / OmniSuite;
  DECISIONS.md 1); SEO numbers (Search Console clicks/impressions/queries); site health (uptime, speed, gate status); operator view
  across all tenants.
- **Stores:** uses the spine (0.1-0.3); Search Console snapshots; publish history with rollback points.
- **Integrations / credentials:** Search Console API (OAuth, Omnikom-owned Google Cloud project, free); Cloudflare token (rebuild +
  deploy); OmniSuite key; email sending for lead alerts and invites (**DECIDE** later: a free tier provider or Google Workspace).
- **Infra:** a web app (**DECIDE** with 0.1: e.g. a Cloudflare Worker app or a Supabase-backed app on Cloudflare), a build runner
  that can run `build.mjs` + gates off the laptop (**UNKNOWN**: Workers cannot run headless Chrome gates; needs a container or CI
  host).
- **PROVEN:** lead capture end to end into a Sheet (`E:\Rainmaker\integrations\apps-script`). **TO BUILD:** everything else.

## 5. AI Operations (step D: upsell tier)
- **Capabilities:** agents propose changes with evidence (new blog post from the plan, SEO fix from the gate, AEO observation from
  sampled AI answers, speed fix); client/operator approves; publishing stays deterministic and reversible; observed samples only,
  never invented scores (ANALYSIS.md 4).
- **Stores:** proposals, evidence, approval, outcome measured after publish.
- **Integrations / credentials:** a model API key (Anthropic) with a per-tenant spend cap; public AI-answer sampling without logins
  (**UNKNOWN**: which engines can be sampled politely and free).
- **PROVEN:** the skill's tracking + compare workers exist (`skills/programmatic-enterprise-web-performance/`), not run as a
  recurring operator. **TO BUILD:** all of it.

## 6. Self-serve onboarding (step E)
- signup -> intake -> report -> checkout -> build queue. Needs: payments (**DECIDE** later, e.g. Stripe; owner click required,
  CLAUDE.md rule 6), a job queue + worker host, the scripted Cloudflare onboarding from part 3, and the human gates still in place
  until each step is documented and proven (DECISIONS.md 2).

---

## Accounts and credentials checklist (owner action; nothing here is created without his click)
| Need | For | Status |
|---|---|---|
| Cloudflare API token: Workers Scripts Edit + Zone Edit + DNS Edit + Zone Settings Edit | part 3 onboarding, part 4 publish | current token deploy-only |
| Cloudflare account id (Workers static assets) | part 3 | exists (Rainmaker deploys) |
| Supabase project (if chosen) | spine | **DECIDE** |
| Google Cloud project + Search Console API OAuth, Omnikom Google account as property owner | parts 3-4 | TO CREATE |
| Google PageSpeed Insights API key (free) | part 1 field data | optional |
| OmniSuite API key + endpoint docs | 0.4 | **UNKNOWN** (spec only) |
| Anthropic API key with spend cap | parts 1 (later headless), 5 | TO CREATE for the platform |
| Email sending (alerts, invites) | part 4 | **DECIDE** later |
| Payments (Stripe) | step E | later |
| Per client: registrar login holder, Google Workspace status, existing tracking accounts | part 3 domain move | per client |

## Open decisions (owner)
1. Tenant data: Supabase vs Cloudflare D1 (or spike first).
2. Content contract source of truth: DB rows vs per-client git files.
3. Whose Cloudflare account hosts client sites: one Omnikom account vs each client's own.
4. OmniSuite: confirm the D: repo is it, and whether its lead API exists yet.
Later: worker/CI host for gates, email provider, payments, dashboard app stack (follows 1).

## Dependency-ordered build list
1. **A1** Presence Report runner over the existing skill modules (no new accounts needed) -> reproduce Francine's report.
2. **A2** No-website path + RDAP + scoring rubric as data -> calibrate on Eli, Rainmaker; measure time + usage per report.
3. **K1** Per-client knowledge folder written by the runner (part 2, files).
4. **B1** Generic content contract schema + generator (plan -> contract). Needs: decision 2.
5. **B2** Factory template: render Rainmaker's site from a contract with no bespoke code; all existing gates pass.
6. **B3** One command: approved plan -> gated preview on a Worker. Needs: Cloudflare token upgrade, decision 3.
7. **B4** Scripted zone/DNS/SSL onboarding + Search Console verify. Needs: token, Google Cloud project.
8. **S1** Spike + choose tenant DB; schema + RLS + auth. Needs: decision 1.
9. **C1** Lead API + inbox + webhook; move the Apps Script forms onto it.
10. **C2** Dashboard: edit contract fields, publish (rebuild + gate + deploy + rollback). Needs: build runner host.
11. **C3** Search Console + health panels; operator view.
12. **O1** OmniSuite adapter. Needs: decision 4 + a working API.
13. **D1** AI operators (proposal -> approval -> publish -> measure). Needs: C2, model key with cap.
14. **E1** Self-serve signup, checkout, job queue. Needs: A-D, payments.
