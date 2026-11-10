# Department: Clients (`clients`)

Created 2026-10-30 by `tools/departments/new-department.mjs`. Rules for every department: `docs/departments/README.md`.

## Mission
Know every client and prospect better than any session's memory: who they are, what was agreed, what will be produced for them (which sites, which pages, which add-ons), what facts are verified and what is pending; run the client lifecycle from first audit to launch and the monthly service; keep every client's record so that when the agreement changes (Example A splitting into real estate, cash offer and mortgage sites) production starts at once from the record, not from a session's recollection.

## Owns
- `clients/`
- `sops/clients/`
- `docs/listings/`
- `templates/client-questions/`
- `tools/client-questions/`
- `tools/team-kit/`
- `tools/panel-mods/elev8-tracker/`
- `tools/client-infra/` (work order 35)
- `tools/pages-project.mjs` (this and the next two: moved from platform build, head of operations ruling 2026-11-10 15:19)
- `tools/dns-upsert.mjs`
- `tools/mint-site-key.mjs`

## Does not touch
Every path not listed above. A bug or a need in another department's files is a finding sent to the head of operations with
options, never a fix made here.

## Head session
- Model: opus (DECISIONS 40). Started by the head of operations with a brief that names this file.
- Reads first, in order: `CLAUDE.md`, this charter (whole file, the position log last), `.claude/POSITION.md` (last blocks),
  `planning/DECISIONS.md` (the items this charter lists under Decisions), then the files the current slice names.
- Does: splits the work into slices with a written brief each, starts one builder per slice, re-runs every builder's proof
  itself before accepting it, appends one dated line per finished slice to the position log below, reports to the head of
  operations in two lines.

## Builders
- Model: sonnet unless a slice is design-heavy (then the head does it, or an opus builder).
- Mechanical runs (tests, mutants, gates, grep, fixture rebuilds, deploy and status commands) go to a haiku agent with the
  exact command; the head or builder reads the verdict lines back (DECISIONS 34).
- One slice, one brief, one set of files; discarded when the slice is done. The brief carries: the files, the spec, what done
  looks like with the gate command, the rules below, and "anything outside this brief is a finding you send back, not a fix".

## Rules that bind this department
- `docs/blueprint/23-GROUND-RULES.md` (a rule is a test with a mutant; done means observed; the not-skippable list).
- Keys by variable name only (CLAUDE.md rule 9); live things need the owner's click (rules 6 and 12); nothing against a client
  project or site; no em dashes in any file.
- Client projects live in their own folders outside this repo (the Example A, Example C, and Example B and D project folders); this department keeps the record in clients/<slug>/ (profile, agreement and decisions, sites to produce, facts ledger with sources, status) and points at the project folder; it never edits a client's live site, Pages project, DNS or CRM without the owner's click (CLAUDE.md rules 6 and 12), and a client's preview is never a test vehicle (DECISIONS 30).
- Facts carry their source (CLAUDE.md rule 3): a client record states where each fact came from (the client's own words, a verified page with URL and date, a document) and nothing client-facing is invented; the client gives facts and access, never our work (DECISIONS 17).
- Onboarding is phase 1 of a client's life and lives here: the prospect audit (the presence report, run with the SEO and audits department's engine, judged here), the Launch Information Request, the agreement record, the plan approval; the audit engine itself is not built here (a need is a finding sent up).
- The design process per client (references, directions, comps, the owner's pick) runs in the client's project folder as today (DECISIONS 27) and is recorded here as a decision with the pick; the owner reviews every design and every fact or legal sign-off on a private preview (DECISIONS 1).
- The owner talks to this department's head directly about clients; every decision the owner states is written into clients/<slug>/decisions.md the same turn, dated, in the owner's words, and the head answers questions as pickable options.

## Proof
- The record of a client is complete when `clients/<slug>/` holds the five files of `clients/TEMPLATE/` (`profile.md` who they
  are and where the project folder is; `decisions.md` every owner decision dated in the owner's words; `sites.md` per site
  purpose, domain, brand, pages, forms and lead flows, what is shared and what must not be, status; `facts.md` a ledger with a
  source cell on every row; `status.md` the one status line, the phase table, the open items with who holds each) and
  `clients/README.md` carries the slug with that status line.
- The check: `node clients/check.mjs` (exit 0 = every record complete; red lines name the slug and the missing file, the
  unlisted slug, the empty status line, the unsourced facts row or the em dash). Its tests and five mutants:
  `node clients/test/run.mjs` ("PASS clients tests: 6 of 6"). `node tools/departments/check.mjs` stays green.
- A change of agreement is proven by the record: sites.md shows the new set of sites with their status, decisions.md the dated owner words, and the platform departments can start from those files alone (the head of operations checks this by reading them cold).
- A slice is accepted when the head has re-run the two commands above itself and read the record cold against the project
  folder (one fact per section checked back to its source file).

## Decisions that shape this department
- DECISIONS 1 to 9 (shape, human gates, one procedure for every industry), 17 (client gives facts and access), 19 (launch is a command with a ledger), 26 (nameservers), 27 (look-folders in the platform repo, design per client in its folder), 30 (Example A touched only in step 7), 31 (powered by Omnikom, exit terms), 33 (departments).
- Owner 2026-10-30 21:32: Example A is split: Example A becomes real-estate focused; the cash-offer and mortgage parts become their own sites (working names: Example A cash site, Example A mortgage site); two or three websites depending on the agreement with them. The department houses what exists today so production starts the moment the agreement is known.

## Open items (the slice plan)
- Slice 1 (head, DONE 2026-10-30, see the position log): the record layout (`clients/TEMPLATE/`, `clients/README.md`,
  `clients/check.mjs` + tests), Example A housed in its folder under `clients/` read-only from its project folder, the split recorded in
  that folder's `sites.md` as three candidate sites "waiting for the agreement", the three questions put to the owner
  (workspace shape; which pages and flows move; what is shared). OPEN inside slice 1: the owner's answers, written into
  that folder's `decisions.md` the turn they are given.
- Slice 2a (Sonnet builder, brief by the head): the three client folders under `clients/` from the Example C and the Example B and D
  project folders and `planning/CONTEXT.md`, read-only on the folders; the README rows lose "NOT WRITTEN"; check and tests green.
- Slice 2b (head, DONE 2026-10-30 22:30, a2610f6): the four SOPs now live at `sops/clients/prospect-audit-team.md`,
  `sops/clients/client-questions.md`, `sops/clients/launch.md`, `sops/clients/site-scope.md` (moved with `git mv`); every
  pointer in files this department owns fixed (incl. `templates/client-questions/`, `tools/client-questions/`, `tools/team-kit/`,
  given to this charter by the head of operations 2026-10-30); pointers in other departments' files (found by
  grep on 2026-10-30: `README.md`, `.claude/POSITION.md`, `planning/DECISIONS.md`, `contracts/README.md`, blueprint 12, 13, 15,
  22, 25 and README, `tools/client-questions/questions-pdf.mjs`, `templates/client-questions/README.md`, `tools/design-engine/WRITING.md`,
  `tools/team-kit/README.md`, `sops/site-endpoints.md`, the skill's `scripts/launch.mjs` and `stages/build.md`) sent up as a
  finding with the exact lines. Then `sops/clients/onboarding.md`: the prospect audit (the SEO and audits department's engine
  when it exists, until then `sops/clients/prospect-audit-team.md`), the Launch Information Request (`sops/clients/client-questions.md`),
  the agreement record (`clients/<slug>/profile.md` "Agreement" plus `decisions.md`), the plan approval (the skill's `approve.mjs`
  lock), each with its "done when" and where the proof lands.
- Slice 3 (after the agreement): Example A's `sites.md` turned into per-site plans (a signed search plan per site, the rows that move,
  the new sites' profiles), handed to the platform departments through the head of operations.
- Later: the monthly service record per client (reports, SEO work, add-ons bought), the offboarding record (DECISIONS 31), a design department if the per-client design process outgrows this one.
- Findings sent up (2026-10-30, slice 1), for the head of operations to route: (1) no compliance pack for a mortgage / lender
  site (skill `rules/industries/` has real-estate-agent, insurance-agency, cash-home-buyer only), needed before the "Example A mortgage site"
  is planned; (2) moving a site between workspaces (if the owner picks "one workspace now, split later") needs a
  platform path (`sites.workspace_id` plus its leads and keys), not in `26-PLATFORM-CLI.md` yet; (3) `brokerOfRecord` on the
  contract's team collection (Example A launch block 10) and the live `captureLead` behind the Example A endpoint (block 3) are platform
  items already known, listed here so the client record points at them.

## Position log (append-only, newest last; one line per finished slice or blocked item: date, slice, PROVEN / BLOCKED, where the proof is)
- 2026-10-30: department created.
- 2026-10-30 22:10 (head `local_02b5fce4-6e08-4801-b312-28226e8817d7`, Fable): slice 1 PROVEN. Layout: `clients/README.md`,
  `clients/TEMPLATE/` (5 files), `clients/check.mjs`, `clients/test/run.mjs`. Example A housed in its folder under `clients/` (profile,
  decisions with 19 dated owner decisions, sites with the current preview and the three split sites "waiting for the
  agreement", facts ledger 19 rows each sourced, status with the 10 launch blocks). Proof: `node clients/check.mjs` ->
  "OK: 1 client record(s) complete: example-a"; `node clients/test/run.mjs` -> "PASS clients tests: 6 of 6" (5 mutants red for
  the right reason; the first run caught a real parser bug: the README separator row read as a slug). `tools/departments/check.mjs`
  -> "OK: 5 charter(s) valid". OPEN: the owner's answers to the three split questions (asked this turn as pickable options).
- 2026-10-30 21:58 (head): OWNER ANSWERED: workspace shape "A workspace per site"; what moves and what is shared "We will
  determine after a meeting". Written into that folder's `decisions.md` and `sites.md` the same turn. Slice 1 CLOSED; the
  split's page and sharing decisions wait on the client meeting (slice 3 trigger). Finding (2) above (moving a site between
  workspaces) falls away. Next: slice 2.
- 2026-10-30 22:30 (head): slice 2b DONE: the four SOPs moved with `git mv` to `sops/clients/` (prospect-audit-team,
  client-questions, launch, site-scope), 3 pointers fixed inside them, `sops/clients/onboarding.md` written (steps 0 to 4
  with done-when and where the proof lands; rules; measured times; not built yet). 21 stale pointers in other departments'
  or unowned files NOT edited: listed with file:line, owner and options in the shared note
  `clients-finding-sop-moves-2026-10-30.md` (side-session notes folder of the head of operations) and sent up. Slice 2a
  (Example C, Example D, Example B records) running in a Sonnet builder; the head re-runs its proof before accepting.
- 2026-10-30 23:55 (head): slice 2a PROVEN. the three client folders under `clients/` (five files each) written
  by a Sonnet builder from the Example C and the Example B and D project folders read-only (`git status` there unchanged); the three README
  rows carry their status lines. Proof re-run by a Haiku agent (DECISIONS 34) and read back: `node clients/check.mjs` ->
  "OK: 4 client record(s) complete: example-a, example-b, example-c, example-d"; `node clients/test/run.mjs` -> "PASS clients tests: 6 of 6";
  `node tools/departments/check.mjs` -> "OK: 5 charter(s) valid". Cold read by the head: the licence number (`licensing.md` 43 to 46),
  plural name (`decisions.md` 13), lock.json approvedBy, the cpe redirect contradiction (`_redirects` 8 vs decisions 24), Example
  Brokerage (`log.md` 76), 15 and 6 questions, 81 sitemap URLs, 26 Example B pages, domain row (the client's website review, line 129), three
  previews HTTP 200 noindex: all match. The records prove structure and sourcing only; every "gates green" inside them is the
  project log's claim, marked so. Findings sent up: CONTEXT.md row 9 says eXp (project: Example Brokerage); DECISIONS 18 (IDX cut)
  vs Example D's MLS plan and her 28 listings on the preview; Agent D's sheet 15 questions vs the DECISIONS 17 cap of 12; Example B absent
  from the DECISIONS 27 M4 list; Example C on a Worker vs DECISIONS 28; six stale Example C project files (record only).
- 2026-11-09, go-live check (HEAD_Clients_2026-11-09, owner 06:29 to 06:34): PROVEN prepared, NOT live. Rainmaker: www.rwifinancial.com already serves an indexable copy of our preview from a Cloudflare zone not ours (NS changed 2026-11-06 19:51 UTC, who UNPROVEN), legal blanks public; launch build strict gate 14 of 14. ELEV8: samples retired with an empty state, 22 old-site redirects, Sheet-plus-alert lead path (two Sonnet builders, gates re-run by the head: 14 of 14, listings check PASS and watched red, render pass, tests 32/13/8/12, mutants 76/76 and 19/19). BLOCKED on domain access and client answers; the owner clicks are numbered in `clients/<slug>/go-live-2026-11-09.md`. Proof: `clients/<slug>/evidence-2026-11-09/`.
- 2026-11-10, team-kit hook test (HEAD_Clients_2026-11-09): PROVEN, master dbb759e (CI 42811068361 15/15): the kit test runs in the kit against `tools/team-kit/test-fixture/`; 51/51 and 10/10 mutants; watched red 33/51 with the kit's shell parsing off.
- 2026-11-10, work order 35 client infrastructure (E15 WORKS): PROVEN, master a6b55ae (CI 42835157209 19/19): `tools/client-infra/provision.mjs`; staging proof with `wo35-test.omnikom.io` (owner ruling 15:27), HTTPS 200 over TLS, zone diff empty; `work/35-client-infra/proof.md`.
- 2026-11-10, work order 37 offboard a client (E14 stays PARTLY, head of operations 2026-11-10 20:57): PROVEN on staging, `tools/client-infra/offboard.mjs`, test client test-wo37, `work/37-offboard/proof.md`; open: the `messages.to_text` scrub, Storage deletion and the state deleted, which are work order 37b (migration 24, the head of operations' ruling: that file and its tests are this department's, platform reviews it).
- 2026-11-10, work order 36 onboard a client (C14 WORKS, head of operations ruling 17:18): PROVEN on staging, `tools/client-infra/onboard.mjs`, test client test-wo36, `work/36-onboard/proof.md`; the invite mail's arrival in the inbox is C13's and UNPROVEN (the inbox is not signed in in the connected browser).
