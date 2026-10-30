# Department: Clients (`clients`)

Created 2026-10-30 by `tools/departments/new-department.mjs`. Rules for every department: `docs/departments/README.md`.

## Mission
Know every client and prospect better than any session's memory: who they are, what was agreed, what will be produced for them (which sites, which pages, which add-ons), what facts are verified and what is pending; run the client lifecycle from first audit to launch and the monthly service; keep every client's record so that when the agreement changes (ELEV8 splitting into real estate, cash offer and mortgage sites) production starts at once from the record, not from a session's recollection.

## Owns
- `clients/`
- `sops/clients/`
- `docs/listings/`

## Does not touch
Every path not listed above. A bug or a need in another department's files is a finding sent to the head of operations with
options, never a fix made here.

## Head session
- Model: fable. Started by the head of operations with a brief that names this file.
- Reads first, in order: `CLAUDE.md`, this charter (whole file, the position log last), `.claude/POSITION.md` (last blocks),
  `planning/DECISIONS.md` (the items this charter lists under Decisions), then the files the current slice names.
- Does: splits the work into slices with a written brief each, starts one builder per slice, re-runs every builder's proof
  itself before accepting it, appends one dated line per finished slice to the position log below, reports to the head of
  operations in two lines.

## Builders
- Model: sonnet unless a slice is design-heavy (then the head does it, or a fable builder).
- One slice, one brief, one set of files; discarded when the slice is done. The brief carries: the files, the spec, what done
  looks like with the gate command, the rules below, and "anything outside this brief is a finding you send back, not a fix".

## Rules that bind this department
- `docs/blueprint/23-GROUND-RULES.md` (a rule is a test with a mutant; done means observed; the not-skippable list).
- Keys by variable name only (CLAUDE.md rule 9); live things need the owner's click (rules 6 and 12); nothing against a client
  project or site; no em dashes in any file.
- Client projects live in their own folders outside this repo (E:\Alex Sevilla, E:\Rainmaker, E:\Francine & Eli); this department keeps the record in clients/<slug>/ (profile, agreement and decisions, sites to produce, facts ledger with sources, status) and points at the project folder; it never edits a client's live site, Pages project, DNS or CRM without the owner's click (CLAUDE.md rules 6 and 12), and a client's preview is never a test vehicle (DECISIONS 30).
- Facts carry their source (CLAUDE.md rule 3): a client record states where each fact came from (the client's own words, a verified page with URL and date, a document) and nothing client-facing is invented; the client gives facts and access, never our work (DECISIONS 17).
- Onboarding is phase 1 of a client's life and lives here: the prospect audit (the presence report, run with the SEO and audits department's engine, judged here), the Launch Information Request, the agreement record, the plan approval; the audit engine itself is not built here (a need is a finding sent up).
- The design process per client (references, directions, comps, the owner's pick) runs in the client's project folder as today (DECISIONS 27) and is recorded here as a decision with the pick; the owner reviews every design and every fact or legal sign-off on a private preview (DECISIONS 1).
- The owner talks to this department's head directly about clients; every decision the owner states is written into clients/<slug>/decisions.md the same turn, dated, in the owner's words, and the head answers questions as pickable options.

## Proof
- node tools/departments/check.mjs green; clients/README.md lists every client with its status line; each clients/<slug>/ has profile.md, decisions.md, sites.md (what will be produced, per site: purpose, domain, pages, forms, add-ons, status) and facts.md with a source per fact.
- A change of agreement is proven by the record: sites.md shows the new set of sites with their status, decisions.md the dated owner words, and the platform departments can start from those files alone (the head of operations checks this by reading them cold).

## Decisions that shape this department
- DECISIONS 1 to 9 (shape, human gates, one procedure for every industry), 17 (client gives facts and access), 19 (launch is a command with a ledger), 26 (nameservers), 27 (look-folders in the platform repo, design per client in its folder), 30 (ELEV8 touched only in step 7), 31 (powered by Omnikom, exit terms), 33 (departments).
- Owner 2026-10-30 21:32: ELEV8 is split: ELEV8 becomes real-estate focused; the cash-offer and mortgage parts become their own sites (working names: Alex buys homes, Sunny buys homes); two or three websites depending on the agreement with them. The department houses what exists today so production starts the moment the agreement is known.

## Open items
- First job: house ELEV8 as it is today from E:\Alex Sevilla (BRIEF.md, facts/, the approved plan with 42 pages incl. /blog, the draft site, the leads work, the launch state) into clients/elev8/, read-only on the project folder; then record the split (three candidate sites, what moves where, what is shared: brand, team, licences, reviews) as options for the owner, including whether the split is one workspace with three sites or three workspaces on the platform (the data model allows both).
- Then: Rainmaker and VTV (Francine) records from their folders and planning/CONTEXT.md; the onboarding SOP (prospect audit with the SEO engine, Launch Information Request, agreement, plan approval) as sops/clients/onboarding.md, moving sops/prospect-audit-team.md, sops/client-questions.md, sops/launch.md and sops/site-scope.md under sops/clients/ (one owner per path).
- Later: the monthly service record per client (reports, SEO work, add-ons bought), the offboarding record (DECISIONS 31), a design department if the per-client design process outgrows this one.

## Position log (append-only, newest last; one line per finished slice or blocked item: date, slice, PROVEN / BLOCKED, where the proof is)
- 2026-10-30: department created.
