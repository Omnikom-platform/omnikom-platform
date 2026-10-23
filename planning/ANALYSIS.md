# Omnikom Platform: what we are actually building (analysis, 2026-10-23)

Sources: `inputs/2026-10-23-chatgpt-omnikom-website-cms-full-chat.md` (ChatGPT), `inputs/2026-10-23-owner-draft-deepseek-brief.md`
(owner draft), and what was really built and proven on Francine (VTV), Eli and Rainmaker (evidence paths below).
Status: analysis; the owner settled sections 3 and 6 on 2026-10-24, see `DECISIONS.md` (lead inbox + OmniSuite by API key for
follow-up; humans only at design approval + fact/legal sign-off on the preview; one standard procedure for every industry with a
plan-generated content contract; skills copied into `skills/`).

## 1. The shape in one picture

Five parts, one shared spine (the client record + its content contract):

```
 [1 INTAKE & SCORE]  ->  [2 CLIENT KNOWLEDGE]  ->  [3 WEBSITE FACTORY]  ->  [4 CONTROL CENTER]  <->  [5 AI OPERATIONS]
  business in,           per-client ICM:          design-first, then        client dashboard:        agents that propose
  presence report out    facts + sources +        agent-built, SEO-gated    content, leads, SEO,     changes with evidence;
  (prospect sales tool)  librarian for agents     site, deployed            publishing, health       client/operator approves
                 \______________________ shared: multi-tenant DB + content contract ______________________/
```

- **1 Intake & Score** (owner draft: "admin program... runs the full research... report and score"): business name/city/phone/site
  in; whole digital presence researched and scored; report out. Owner pick: prospects first, as the sales tool.
- **2 Client Knowledge** (owner draft: "auto organized into md files in an ICM system... managed by a Librarian"): every fact the
  intake found, with source and date, stored per client; the librarian answers agents' "what do I load for X" during the build.
- **3 Website Factory** (ChatGPT "Website Factory"; owner "programmatically right for SEO... coding agents"): design visually first
  (cheap wireframes, owner/client picks), then agents build against the SEO skill, gates must pass, deploy.
- **4 Control Center** (ChatGPT's 11 modules; owner "dashboard... replace the SEO part... content publishing, CRM"): the client
  edits approved content fields, sees leads, SEO results, publishes; never touches code.
- **5 AI Operations** (ChatGPT "AI Marketing Workforce"): content/SEO/AEO/performance agents that propose with evidence; publishing
  stays deterministic and reversible.

## 2. What already exists and is proven (not theory)

| Part | Proven piece | Evidence | Gap to platform |
|---|---|---|---|
| 1 | Client SEO/presence report v2 (scores, speed, who-controls-what, needs-from-you) | `E:\Francine & Eli\deliverables\docs\website-review-francine.md/.pdf`, `tools/review-pdf.mjs` | Made by hand over ~2 sessions; no runner, no no-website path |
| 1 | Crawl + lab speed, research, local modules | skill `snapshot-site`, `research-*`, `local-pack/grid/nap/reviews/profile` | Not chained; local modules untested on a real client |
| 1 | DNS / domain ownership export | `E:\Rainmaker\tools\dns-export.mjs` | Registrar/WHOIS lookup missing |
| 2 | ICM layers + librarian agent + auto index | `E:\Francine & Eli\icm\`, `icm-librarian` agent, `icm-index.mjs` | File-based, one project; not per-tenant, not in a DB |
| 3 | Design-first: wireframe tournament, owner rating loop | skill `design-tournament`; Rainmaker design pass | Human-heavy (many owner feedback rounds) |
| 3 | SEO plan -> approve -> strict gate 13/13 | skill `plan-site/approve/gate`; Rainmaker `.pewp` | Works; per-site setup still manual |
| 3 | Build pipeline: partials, perf layer (WebP, woff2, versioned cache), a11y 0, forms, media test | `E:\Rainmaker\site-src\build.mjs`, `tests/*.e2e.mjs` | Bespoke per site; content lives inside HTML |
| 3 | Deploy: Cloudflare Workers static assets, headers/redirects/404, smoke test, live guards | `tools/deploy-live.mjs`, `tools/worker-smoke.mjs` | Zone setup was browser clicks (token lacks zone perms) |
| 4 | Lead capture: forms -> Google Sheet + email alert, tested end to end | `integrations/apps-script/`, `tools/live-form-check.mjs` | Sheet is a stand-in; no tenant DB, no dashboard |
| 4,5 | nothing yet | | Dashboard, multi-tenant DB, content editing, AI ops all unbuilt |

## 3. The three tensions to settle

1. **CRM inside the dashboard?** Owner: "Dashboard has a built in CRM". ChatGPT: "not a competing full CRM; push leads to the
   client's CRM / MARY". Luxury Presence clients expect a lead inbox. Middle path: a **lead inbox** (list, status, owner, notes,
   export, webhook to any CRM), which is exactly what the Rainmaker Sheet already does, and no pipelines/deals/email campaigns.
   **OPEN.**
2. **"No humans" vs. what we saw.** Safe to automate end to end: research, scoring, the report draft, SEO planning, building,
   gating, deploying, monitoring. Not safe without a human yet: (a) facts in a client-facing report (sources can be wrong), (b)
   legal/compliance pages (Rainmaker: legal entity, licence states, consent wording), (c) design taste (the owner rejected several
   "AI slop" rounds before a design passed), (d) anything behind a CAPTCHA or login (we stop, never bypass). Proposal: humans only
   at **design approval** and **fact/legal sign-off**; everything else automatic. This matches the owner's "humans only at the
   website build step" if "build step" includes those two gates.
3. **Custom sites vs. an editable dashboard.** Our sites are hand-built HTML: content lives inside the markup, so a dashboard
   cannot edit it. ChatGPT's key point is right: **the factory and the dashboard need one shared content contract** (pages =
   approved sections with typed fields; collections = blog, services, areas, team, FAQs, testimonials; brand = tokens), and
   "regeneration never overwrites client-approved content". This is the single biggest technical change from how we built
   Rainmaker, and it must come before the dashboard.

## 4. Smaller corrections from ChatGPT worth keeping

- Keep `llms.txt` as an optional extra, not a selling point (we built it; fine, do not promise outcomes from it).
- AEO/GEO "visibility" must show observed samples, not invented scores. Our report already follows "facts carry sources".
- Programmatic pages need a quality gate (the skill has one: GT-009 + brief coverage). Keep it strict.
- Dashboard universal, content schemas per industry (real estate: agents, areas, listings; insurance: products, licensed states).

## 5. Build order (each step sells something on its own)

| Step | What | Sells as | Depends on |
|---|---|---|---|
| A | **Presence Report engine** (part 1): one command, website or not, scored + sourced PDF | Free prospect report (sales tool) | skill modules; review-pdf |
| B | **Content contract + Factory v1** (part 3): turn the Rainmaker pipeline into a template where pages render from structured content files; one command from approved plan to deployed site | Custom SEO website (done-for-you) | A's knowledge output |
| C | **Tenant DB + Control Center MVP** (parts 2, 4): workspaces, auth, lead inbox, edit contract fields, publish (rebuild + deploy), Search Console numbers | Monthly subscription (the Luxury Presence replacement) | B's contract |
| D | **AI Operations** (part 5): blog/content proposals, SEO operator, AEO observations, all with approval | Upsell tier | C |
| E | **Self-serve onboarding**: signup -> intake -> report -> checkout -> build queue | Scale | A-D |

## 6. Decisions the owner should make (only these shape the work)

1. CRM scope: lead inbox + export/webhook (recommended) vs. full CRM.
2. Where tenant data lives: Supabase (already used for OmniSkipX) vs. Cloudflare D1 (already hosting the sites). Recommendation
   after a short spike, not now.
3. First industries for the content schemas: real estate (Francine, Eli) + insurance (Rainmaker) since we have real data for both.
4. Where the skills live: move them into this repo as source (with `~/.claude/skills` pointing here), or keep them where they are
   and reference them. Moving needs a careful link so Claude Code still finds them.

## 7. Proposed folder layout for this repo

```
E:\Omnikom Platform\
  planning\    inputs (verbatim), ANALYSIS.md, DECISIONS.md, roadmap
  skills\      the platform's skills as source (decision 4): web-performance/SEO, design-tournament, presence-report, ...
  engines\
    intake\    part 1: presence report runner
    factory\   part 3: template site + content contract + build/deploy tools (from Rainmaker)
    control\   part 4: dashboard app
    ops\       part 5: AI operators
  contracts\   content contract schemas (per industry) shared by factory + control
  clients\     per-client knowledge exports (part 2) until the DB exists
```
