# SOP: onboarding a client (phase 1 of a client's life; Clients department, `docs/departments/clients.md`)

Written 2026-10-30 from the three runs that exist (ELEV8 `E:\Alex Sevilla`, Rainmaker `E:\Rainmaker`, VTV and Eli
`E:\Francine & Eli`) and the decisions that bind every client (DECISIONS 1 to 3, 9, 16, 17, 18, 19, 26, 27, 30, 31). Onboarding
is the stretch from "a prospect's name" to "a signed plan the platform can build": four steps, each with its done-when and
where the proof lands. The record of the client grows in `clients/<slug>/` as the steps run; a step whose proof is not in the
record is NOT DONE. The client gives facts and access, never our work (DECISIONS 17).

| Step | What | Who runs it | Done when (the proof) | Where the proof lands |
|---|---|---|---|---|
| 0 | **Open the record.** `clients/<slug>/` from `clients/TEMPLATE/` (five files), a row in `clients/README.md` with the status line "Prospect: audit not started" | Clients head | `node clients/check.mjs` green with the new slug | `clients/<slug>/` |
| 1 | **Prospect audit** (the presence report) | an audit team under the Clients head, in the client's own project folder (`E:\<Client>`), by `sops/clients/prospect-audit-team.md` (the order: backup, profile, inventory, skill run, page by page, speed, search grid, AI answers, competitors and the offer map, links, scores, report, fresh review). The SEO and audits department's engine replaces the manual steps as it lands (today `tools/audit/` checks a built site folder, not a live site: the manual SOP stands for the live audit; a live `omnikom audit` is a finding sent up when the first new prospect arrives) | `REPORT.md` + `REPORT.pdf` with every number in `EVIDENCE.md` traced to its source; the fresh-context review found no unsourced number; the owner has seen every PDF page; `facts/` holds the verified profile | project folder; `clients/<slug>/facts.md` points at `facts/` and `EVIDENCE.md`; `profile.md` filled; status line "Prospect: audit done, meeting pending" |
| 2 | **Launch Information Request** (the client question sheet) | Clients head, from the built preview's unsourced items by `sops/clients/client-questions.md` (the catalogue, at most 12 questions, a "Why we ask" line each, the accounts table, never passwords) in `templates/client-questions/` format, rendered by `tools/client-questions/questions-pdf.mjs`; the email is forwardable and goes through Dave | The sheet passed the renderer (12 or fewer, no Q-ids, every "Why we ask"); the owner read the sheet, the email and the preview link and said yes; sent date recorded | `deliverables/questions-for-<client>.md` + PDF in the project folder; `clients/<slug>/status.md` phase row "sent <date> to Dave, waiting on <client>"; each answer, when it comes, is a row edit in the site's content rows (DECISIONS 16) and a line in `facts.md` with "client answer Q-n, <date>" as its source |
| 3 | **Agreement record** | Dave agrees the terms with the client; the owner tells the Clients head; the head writes it | `clients/<slug>/profile.md` "Agreement" names what was agreed (which sites, which add-ons, the domain per site, who owns which accounts: DECISIONS 9), when, and where the document is; `decisions.md` carries the owner's words dated; `sites.md` lists every agreed site with status "approved plan" or "planned"; the platform workspace shape is recorded (ELEV8: a workspace per site, owner 2026-10-30) | `clients/<slug>/profile.md`, `decisions.md`, `sites.md` |
| 4 | **Plan approval** (per site) | the skill's research and plan-site run in the client's project folder (`targets.json`, `plan-site`, `approve.mjs` signed and locked by the owner or by the Lead under the owner's written delegation), the page list by `sops/clients/site-scope.md` (the core pages of every industry plus the search pages of the plan, plus the client-fed collections as placeholders) | `<pewp>/approved/lock.json` holds the signed business definition, competitors, seeds, targets and plan; `sites.md` points at the plan file and lists the page count; status line "Client in onboarding: plan approved, build next" | project folder `.pewp/approved/`; `clients/<slug>/sites.md` |

After step 4 the client leaves onboarding: design per client in its project folder (DECISIONS 27; the owner's pick recorded in
`decisions.md`), build once as a noindex preview (DECISIONS 16), the owner's design review and fact / legal sign-off on the
preview (DECISIONS 2), then `sops/clients/launch.md` (the ledger), with the domain attached last (DECISIONS 26). Every phase
keeps the `status.md` phase table current; the one status line is copied into `clients/README.md`.

## Rules that hold through every step
- Public data only, politely: no logins, no paid data APIs, never bypass a CAPTCHA or bot wall (stop and record it), one 429 from
  a host = stop that host; never submit a form on a client's live site (CLAUDE.md rule 4).
- Every fact carries its source; nothing client-facing is invented; an unsourced claim is our research task, then the safe
  default, then (only if in the catalogue) one merged question (`client-questions.md` section 1).
- Never mix clients: a person who appears in two client projects (Francine Masudi: VTV client and ELEV8 team member) is shown in
  each only as that client's own site and public records show them; no material crosses between the folders.
- Showing one client's preview to another prospect needs the owner's OK first (ELEV8 brief, 2026-10-26).
- Outward actions (sending the sheet, publishing, DNS, payments) are the owner's click; drafts are fine (CLAUDE.md rule 6).
- Questions to the owner as pickable options, recommended first; the owner's answers go into `decisions.md` the same turn.
- The client's preview is never a test vehicle (DECISIONS 30); the platform's own test workspaces are.

## Measured so far (sources: the project folders' position files)
- ELEV8 prospect audit 2026-10-26: backup 1 h 50 min + 18 min verify; search grid 1 h 28 min; report, PDF and evidence about 15
  min once sourced; 4 owner review rounds (`prospect-audit-team.md` "Measured times").
- ELEV8 preview draft: built 2026-10-28, closed 2026-10-29 20:47 after 26 gate chains (`E:\Alex Sevilla\.claude\POSITION.md`).
- Rainmaker: audit to launch-ready preview, 2026-10-16 to 2026-10-24 (`planning/CONTEXT.md`). Times per step NOT measured there.

## Not built yet (findings sent up, not this department's work)
- A live-site audit command in the SEO and audits department (`omnikom audit <url>`), so step 1 stops being an agent-team run.
- A platform screen or CLI command that opens a workspace from `clients/<slug>/sites.md` (step 3 to the platform), `26-PLATFORM-CLI.md`.
- A compliance pack per industry beyond real estate, insurance and cash home buyer (ELEV8's mortgage site needs a lender pack).
