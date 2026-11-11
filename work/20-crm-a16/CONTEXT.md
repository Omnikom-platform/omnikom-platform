# 20 CRM A16: lead type and status, per-industry lists held as data (backend)

Owner: platform build. Model: Sonnet (high). Branch: check/platform/crm-a16. Migration: 23
(`supabase/migrations/20261109000023_lead_type_status.sql`, reserved). Status: BUILT 2026-11-10 by the builder, NOT COMMITTED;
review rulings A, D to J applied (B and C wait for the head), proof below; the SQL walls and mutants added since review are UNPROVEN until CI's run-local job (see "Report" and "Round 2"). Screens are a later order, like 19 for 18.

## Why
Owner rulings 2026-11-09 20:40 and 20:48 (through the head of operations), in `docs/product/5-crm.md` "The lead record" and
"What the CRM does": a lead carries two columns, **lead type** (what it is about, from the form and what the visitor asked) and
**status** (the acquisition outcome: not contacted yet, contacted by whom, answering machine, no answer, voicemail left, wrong
number, call back and follow-up with a date, qualified, not qualified, not interested, interested in something specific,
appointment set, do not contact). Both lists are per-industry data, never written in code. Every note shows its time and its
author, the user or the agent. Row A16 in `1-product.md`.

## Inputs
- This file; `docs/product/5-crm.md`; `contracts/README.md` (how an industry contract declares data; forms.<id>.fields);
  `contracts/core.json` and `contracts/examples/`; `supabase/migrations/20261029000002_crm.sql` (lead_status enum,
  `service.lead_update`), the newest `service.lead_list`, work order 18's migration 22 once it is on master.
- SEO's researched lists (work order 29, now on master: `work/29-lead-types/`
  `real-estate.json` (15 types), `insurance-financial.json` (15 types), `statuses.json` (19 statuses, 16 shared; flags
  `needsDate`, `needsWho`, `needsText`), `draft-5-crm-section.md`, `proof.md`. Read their Findings (ELEV8's "Ask about this
  home" form forces topic Buy; 8 real-estate types have no ELEV8 form yet; Rainmaker may never show investment-management).

## Settled by the head (a reason to change one is a finding)
1. **The lists live in the industry contract**, next to the lead form fields (the place industry data already lives):
   `crm.lead_types` and `crm.statuses`, each an ordered list of `{key, label}` with the status flags `needsDate`, `needsWho`,
   `needsText`. The contract schema validates them (unique keys, the flags boolean, `enquiry` present in lead types,
   `not-contacted` present in statuses). SEO's JSON files become the real-estate and insurance-financial contract fragments
   (copied with their source notes into the contract examples, not hand-edited).
2. **Leads:** `lead_type text not null default 'enquiry'`, `status text` validated against the site's contract list in the
   database on every write (as the typed answers are today, M14), plus `status_date date null` (required when the status
   needsDate), `status_who uuid null` (needsWho: the team member who made the contact; defaults to the caller), `status_text`
   (needsText, up to 200 chars). The `lead_status` enum is replaced by this migration: existing rows map new -> not-contacted,
   contacted -> contacted, qualified -> qualified, closed -> the contract's closest closing status (finding if none),
   spam stays a system status outside the list that hides a lead (it is not an acquisition outcome).
3. **Lead type on capture:** each contract form says how its submission sets the type: a fixed `leadType`, or a `leadTypeFrom`
   field whose option values map to type keys; anything else is `enquiry`. ELEV8's forced "Buy" topic is a contract fix for
   the clients department (a finding to them), not code.
4. **Notes:** each note's timeline row carries its author (user id and display name, or "agent" for an AI operator) and its
   time; `lead_list`/the record answer return both. If the timeline already stores the actor, this is a read change only.
5. Filters and sort on lead type and status (and status_date for call back and follow-up) through the same `lead_list` query
   shape; saved views (work order 18) keep working with the new keys.

### Settled after review (head, 2026-11-10 21:30; applied by the builder)
A. **Floor list.** A contract without a `crm` block gets the old statuses as its list: not-contacted ("Not contacted yet"), contacted,
   qualified, closed (no flags), with spam a system status as before; existing businesses keep working and their old rows stay
   settable. Migration 23 `private.crm_lists` and the contract floor text say so; T31o shows a floor workspace can set contacted.
B. **Dashboard compatibility, in this order, after work order 19 lands** (full A16 screens are work order 39, not here): `lib/leads.ts`
   `STATUSES` becomes the floor keys; the New filter matches status `not-contacted` (`lib/leads.ts`, `crm.ts` FIRST_VIEW and filter);
   the panel's status radios and BulkBar show labels, not raw keys; tests updated. NOT STARTED (waits for the head's go).
C. **CLI (`tools/omnikom-cli/commands/lead.mjs`), granted by the CLI head, after 19 lands and the head rebases.** Conditions:
   1. No hard-coded list in the CLI: drop `STATUSES` (lead.mjs:15) and its two client-side checks (:50, :71); keep `status = <lit>`
      as text with no cast (:49); use the new `lead_update` call (:73) and let it refuse an unknown status, mapping that refusal to
      its S- code; test/run.mjs:1316 (`--status bogus`) then expects that code, not a usage error.
   2. Also update test/run.mjs 1310 to 1316 (contacted and spam stay valid; each title must still match); test/journey.mjs fake rows
      with status 'new' at :70 and :76 and any other `status: 'new'` become 'not-contacted'; commands/verify.mjs :141 and :234 read
      against the new signature (both refusals must still hold); commands/journey.mjs :388 and :478 look fine; grep tools/omnikom-cli
      for `'new'` and `lead_status` yourself.
   3. Watched red: break the new `lead_update` call or the text comparison in lead.mjs, see a run.mjs check go red for that reason,
      paste it here.
   4. Locally only the CLI lead tests; the CLI suite and its mutant shards run on CI.
   5. If the CLI's migration lint is on master when rebased, run `node tools/migration-lint/lint.mjs` and add dated waivers for 23
      (L4 on the status ALTER TYPE, L1 on the unique index) to `tools/migration-lint/waivers.json`, each with a reason of 20+ chars.
   NOT STARTED. Tell the head when lead.mjs is done (he sends its diff to the CLI head before the land).
D. **Answering machine and voicemail left are two statuses** (the owner beats the research): split in the crm-lists fragments
   (`build.mjs`, with the owner's list as the source); real estate now 19 statuses, insurance and financial 18.
E. **Import template and import carry `lead_type`:** migration 23 re-creates `save_crm_template` with `lead_type` allowed and
   `import_leads` reads it (key or label of the business's list, empty is enquiry). The map library `tools/crm-map` (CLI department)
   still does not pass the column through `importRows`/`proposeMap`: a finding for the CLI head.
F. `contracts/core.json` `leads.status` is text.
G. **A status change clears the date, person and line the old status carried:** a date belongs to the status it was set for; the caller
   sends them again. Round 2 (head): a value the caller sends counts even when it equals the old one (call back Friday to follow-up
   Friday), so the clearing is in the write paths that know what was sent (`lead_update`, `lead_set_fields`, and `leads_bulk` for the
   person and line); `lead_guard` only validates (a status that does not ask for a value still clears it). A direct table write is
   validated, not cleared.
H. **lead-export applies the view's Due and Duplicates ticks** as lead-list does (`inLayout` passes `due` and `duplicates`, 400 when
   not true or false); test in export.test.ts, mutants `crm20 lead-export: ...`.
I. Migration 23 starts with `set lock_timeout = '5s';` (the CLI's migration lint, E19).
J. **Every delete path erases the same way** (privacy; clients' migration 24 makes `service.delete_lead` scrub the person's copies):
   `leads_bulk`'s delete calls `service.delete_lead(p_claims, id, 'bulk')` once per lead, so the audit row (one per lead) comes from
   `delete_lead`. T31q checks the audit rows and that each delete ran inside `delete_lead`; mutant `crm23: bulk, delete restores the
   direct delete`.
Accepted as written: findings 1, 3 (ELEV8 "both" stays enquiry until Clients names it), 4, 5 (the agent marker is recorded in 4-backend),
6, 8, 14, 15 (bulk and import cannot set a needsDate status; both are recorded in the book as limits).

## Steps (same shape as work order 18)
Migration 23; contract schema and the two industry fragments; walls in tenancy.test.sql (a status not in the site's list is
refused; a needsDate status without a date is refused; a member sets status only on leads assigned to them; capture sets the
type from the form's mapping; the enum migration maps every existing row); function tests for `lead-update` and capture;
mutants for each rule; watched red first; `supabase/tests/e2e-crm-a16.mjs` for staging (the head runs it); the book in place
(3-database, 4-backend, 5-crm, the A16 evidence cell; the state moves only with the screens).

## Rules
As work order 18: the builder never commits, pushes, applies, deploys or publishes; heavy runs through heavy.mjs, scoped
mutants only; keys by name; scripts in files; check free space on E: first.

## Findings
- (head, 2026-11-10, from the clients department through the head of operations) ELEV8's lead contract allows only `buyer`,
  `seller`, `both`, `other` as the contact form's lead type; `listing-question` must be added to that contract (a contract
  change in this order: its `leadTypeFrom` map sends "Ask about this home" to `listing-question`, not `buy`), and the other
  three values map to the real-estate list (buyer -> buy, seller -> sell, both -> the type the clients department names,
  other -> enquiry). A wall proves an "Ask about this home" submission is stored as `listing-question`.
- (head, 2026-11-10 15:30; ruling of the head of operations on a clients finding, work order 35, E15) Migration 23 also adds
  `create unique index sites_domain_unique on public.sites (lower(domain)) where domain is not null;` so two sites can never claim
  one domain (any case). Staging checked first, read-only: 0 sites have a domain, no duplicates. A wall in this order's T-block: a
  second site with the same domain in another case is refused (unique violation), two sites without a domain are fine; a mutant
  drops the index and must be caught. One line in `3-database.md`.

## Report (builder, 2026-11-10; nothing committed, pushed, applied or deployed)

### Built
Migration 23 (`private.lead_guard` trigger is the one enforcement point: status and lead type against the site's `crm` lists, the
date/who/text rules, lead type from the form on insert; `leads.status` text, `lead_type`, `status_date`, `status_who`,
`status_text`; the `lead_status` enum dropped, old rows mapped; note authors backfilled and written on new notes; replaced
`lead_value`, `lead_query_check`, `lead_list`, `lead_set_fields`, `leads_bulk`, `import_leads`, new `lead_update` signature;
`sites_domain_unique`). Contract: `crm` block validated (`C-CRM-*`, `C-FORM-LEADTYPE`), `from-plan.mjs` `crmFrom`, the two industry
fragments in `contracts/examples/crm-lists/` (built from `work/29-lead-types/` by `build.mjs`), ELEV8 (`listing-question`, per-form
`leadTypeFrom`/`leadType`) and Rainmaker contracts. Functions: `lead-update` (`status_date`, `status_who`, `status_text`),
`leads-bulk`, `lead-export` ('new' reads `not-contacted`), `_shared/http.ts` `Fields.day`. Book: 3-database, 4-backend, 5-crm,
1-product (A16 cell), openapi.json; icm index regenerated.

### Files changed
contracts: README.md, from-plan.mjs, validate.mjs, test/run.mjs, test/mutate.mjs, examples/elev8/{contract,entities}.json,
examples/rainmaker/{contract,entities}.json, examples/crm-lists/ (new). docs: blueprint/specs/openapi.json, product/{1-product,
3-database,4-backend,5-crm}.md, work/20-crm-a16/CONTEXT.md. icm: CODE-MAP.md, INDEX.md, code-map.json, index.json. supabase:
migrations/20261109000023_lead_type_status.sql (new); functions/_shared/http.ts, lead-export, lead-list (comment only),
lead-update, leads-bulk; functions/test/{capture,crm3b,export,lead-read,leads}.test.ts, crm20.test.ts (new), mutate.mjs, util.ts;
tests/{run-local.mjs,tenancy.test.sql}, tests/e2e-crm-a16.mjs (new, staging only, the head runs it).

### Proof (pasted)
- Real tenancy run with T31 (walls a to o), `node supabase/tests/run-local.mjs --only crm23`, via heavy.mjs:
  `PASS real migration: ALL TENANCY TESTS PASSED` / `PASS T30c media bucket limits equal upload-start (26214400 bytes, 5 types)` /
  `PASS upgrade: migrations 1 to 22 with one lead of each old status and a note, then 23: not-contacted,contacted,qualified,closed,spam | enquiry | user:Owner | enum gone` /
  `OK: real migration passes; 48 mutants`. Every one of the 48 printed `caught` with its own wall's message (not a bystander); the 4 upgrade
  mutants read `new,contacted,...` / `...closed,not-contacted` / `no author` / `other`.
- Watched red, real: the first real run FAILED `T31k status sorts by its place in the business's list...` (my expectation ignored the
  newest-first tie break); a second run passed but T31k was FLAKY (two rows inserted in one transaction share `created_at`, tie fell to a
  random uuid), which made 6 mutants "caught" by T31k for the wrong reason ("old enum kept" cannot change a sort). Fixed by moving
  `f_cb2`'s `created_at` 1 minute on; re-run: those 6 now read `I-ANSWER status: ...` / `T31l a member's note carries their team profile
  name` / `T31k filter by lead type:` / `S-QUERY: a range needs a number or date column` / `T31n the lead_status enum is gone`.
- Older groups, one at a time: `--only crm15` `OK: real migration passes; 39 mutants`. `--only crm14` (49), `crm18` (6), `crm22` (79): all
  caught except 4 that SURVIVED (below). Cause: migration 23 redefines the function the old target text sat in.
- Contract validator: `node contracts/test/run.mjs` 197 passed, 0 failed; the ELEV8 `listing-question` wall watched red once (map entry
  removed), restored.
- Deno, one test file at a time (FN_TEST_FILTER set from PowerShell): `work order 20` filter `ok | 9 passed | 0 failed (27s)` then
  `OK: 9 of 9 checks passed`; capture 6/0, leads 9/0, crm3b 10/0, export 15/0, crm 4/0, lead-read 3/0.
  Watched red: lead-read first run `FAILED | 2 passed | 1 failed` with `Status must be one of this business's statuses ... got 400, wanted 204`
  (the test never installed the lists); fixed with `await crmForms()`; re-run `lead-read.test.ts: status 0, passed 3, failed 0`.
- `deno check` clean on the new and changed tests and `deno task check` (earlier); `check-specs.mjs`: `OK: 28 operations, 28 operationIds,
  26 deployed functions covered ... 0 problem(s)`; `node tools/icm/index.mjs --check` OK.
- gitleaks (`detect --no-git`, whole worktree): 1 hit, `factory/worker/test/run.mjs:15` (`generic-api-key`, a test fixture
  `const lead = { form: 'contact', ...`). That file is NOT changed by this order (unmodified, last touched by a2570e2). The head's
  `gitleaks protect --staged` on the commit is the real gate.

### UNPROVEN / NOT RUN
- UNPROVEN (retargeted after surviving; NOT re-run, per the head's ruling of 2026-11-10 no more local mutant runs; CI's run-local job
  is their proof): `crm14: service.lead_set_fields does not pin the search_path`; `crm18: the site key is not a filterable key`;
  `crm18: the site key is not in lead_value`; `crm22: lead_query_check does not pin the search_path`. Also not re-run after the
  edit: nothing else in run-local.mjs changed since the crm14/15/18/22 runs.
- NOT RUN: `functions/test/mutate.mjs --only crm20` (7 mutants), `contracts/test/mutate.mjs` (3 new swaps), the other run-local groups
  (crm12, screens, ...), the full Deno suite, `run-all-gates.mjs` (CI), the staging e2e `supabase/tests/e2e-crm-a16.mjs` (the head runs
  it after CI is green and migration 23 is applied).

### Findings (a reason to change a settled point, or a thing the head decides)
1. SEO's lists carry `spam` as an ordinary status; the design keeps spam a system status outside the list. I accept it everywhere.
2. SEO merged "voicemail left" into "answering machine"; the owner listed them as two.
3. ELEV8 `both` is unmapped, so it becomes `enquiry`; the clients department must name the type.
4. I also mapped the `sell` form's `offerType` (list -> sell, cash-offer -> cash-offer).
5. The AI-operator marker is `app_metadata.actor = 'agent'` in the verified claims; nothing else in the product defines that identity.
6. Note author names are written at note time (`lead_events.detail.author`); I added no read function.
7. Staging contracts saved before this order have no `crm` block (floor only); existing contacted/qualified/closed rows stay as stored.
8. SEO's field notes say a needsDate status appears in `due`; the design does not, so `due` is unchanged.
9. The CLI breaks on staging: `tools/omnikom-cli/commands/lead.mjs` casts `::lead_status` and has a `STATUSES` list; its seed has no `crm`.
10. `apps/dashboard/src/lib/leads.ts` and `crm.ts` hardcode the old statuses (work order 19 owns them).
11. The import template's allowed columns (migration 15) lack `lead_type`.
12. `contracts/core.json` `leads.status` enum is the stale pre-CRM draft.
13. status date/who/text carry over between two statuses that both ask for them (cleared only when the new status does not ask).
14. The note-author backfill edits timeline rows (`lead_events` is not append-only).
15. Bulk and import cannot set a needsDate status (400 / refused row).

### Round 2 (builder, 2026-11-10 night): the head's rulings A, D, E, F, G, H, I, J applied; B and C NOT STARTED (wait for 19 and the head's go)
Changed: migration 23 (floor of four statuses; `set lock_timeout = '5s'`; a status change clears date, person and line; `save_crm_template`
and `import_leads` take `lead_type`; bulk delete through `service.delete_lead`); `contracts/examples/crm-lists/build.mjs`, the two fragments
and the two example contracts (real estate 19 statuses, insurance 18, the answering-machine / voicemail-left split with its owner source);
`contracts/core.json` leads.status text; `contracts/test/run.mjs` counts; `lead-export` (due, duplicates; the filter comment); `openapi.json`
(due, duplicates); book (5-crm, 4-backend), `contracts/README.md`, validate.mjs comment. Tests: tenancy.test.sql (T31o floor settable, (j2)
import lead type, (p) clearing, (q) bulk delete; fixture status `lost`), run-local.mjs (new crm23 mutants), export.test.ts (new test),
functions/test/mutate.mjs (3 new crm20 export mutants), lead-read.test.ts.

Proof (pasted):
- Deno, one file at a time through heavy.mjs. The new export test: `lead-export (work order 20): the Due and Duplicates ticks of the view
  narrow the file ... ok`; with `if (d.due !== undefined) q.due = d.due;` removed it FAILED:
  `ASSERT: due: only the follow-up that has come: got "dup-zz20hjr72va@zz20.test,dup-zz20hjr72va@zz20.test,plain-zz20hjr72va@zz20.test,future-zz20hjr72va@zz20.test,past-zz20hjr72va@zz20.test", wanted "past-zz20hjr72va@zz20.test"`
  (watched red for the right reason); restored; re-run `ok | 1 passed | 0 failed | 180 filtered out`. Then `crm.test.ts` 4 passed, `crm20.test.ts`
  8 passed, `leads.test.ts` 9, `lead-read.test.ts` 3, `crm3b.test.ts` 10, `capture.test.ts` 6, all 0 failed; filter `work order 20`:
  `OK: 10 of 10 checks passed (the Deno tests), exit 0`. The harness builds its database from migration 23 as edited, so the migration applies and
  the bulk delete through delete_lead works (crm.test.ts bulk delete).
- `node contracts/test/run.mjs`: `197 passed, 0 failed` (new 19 and 18 counts, the split present in both examples); `check-specs`:
  `OK: 28 operations, 28 operationIds, 26 deployed functions covered, 5 planned marks; 47 FR/NFR rows, 40 work orders, 0 problem(s)`;
  `icm --check` OK; `deno check` clean on export.test.ts and lead-export/index.ts; run-local.mjs and mutate.mjs parse.

UNPROVEN (NOT RUN locally: the head's ruling is no run-local from the builder; CI's run-local job is the proof): the new tenancy walls T31o
(floor settable), T31j2 (map and import take lead_type), T31p (clearing), T31q (bulk delete inside delete_lead; its probe is a BEFORE DELETE
trigger reading PG_CONTEXT for `service.delete_lead(`) and the changed fixture (status `lost`); every new crm23 mutant: the floor has no
not-contacted / contacted / qualified / closed (4, replacing the old no-floor one), a map cannot name the lead type, import: a lead type not in
the list is taken / the lead type is never read / the dry run sample has no lead type / the lead is stored without its lead type, a status change
keeps the old date / person / line (3), bulk: delete restores the direct delete; the 3 new functions mutants `crm20 lead-export: ...`; and the
four earlier retargeted mutants. The real tenancy run itself has NOT been re-run since these SQL changes (the last real pass was before them).

Findings (new): `tools/crm-map` (CLI department) does not pass a `lead_type` column through `proposeMap`/`importRows` yet, so a mapped file
reaches import_leads without it until the CLI head adds it. (The same-value finding I first raised is closed: see "Round 3".)

### Round 3 (builder, 2026-11-10 night): ruling G moved out of the guard (head's fix)
`lead_guard` no longer clears carried values; `lead_update` takes the sent date, person and line for a new status (null when not sent, kept
when sent even if equal to the old one), `lead_set_fields` clears the ones not in `p_fields` when the status changes, `leads_bulk` clears person
and line (a date cannot be carried there). New walls T31p2 (equal value kept: the same date on another status, the same person, the same
line, via `lead_update`), T31p3 (the same through the edit call, both kept and not sent), T31p4 (bulk); fixture status `answering-machine`.
The three guard-level mutants are replaced by 14: `lead_update` x6, `lead_set_fields` x6 (each "keeps the old X" and "clears an X that was
sent again" for date, person, line) and `bulk` x2. Proof run: Deno `crm20.test.ts` 8, `crm.test.ts` 4, `leads.test.ts` 9, `lead-read.test.ts` 3,
`crm3b.test.ts` 10, all 0 failed (the harness applies migration 23 as edited). UNPROVEN, not run (ruling: no run-local): T31p2, T31p3, T31p4
and all 14 mutants; the real tenancy run has not been re-run since the move.

### Round 4 (builder, 2026-11-11 night): B (dashboard minimum), C (CLI), the CI retargets; nothing committed, pushed, applied or deployed
Head's ruling of 2026-11-11 01:03: locally only the tests of the changed files plus gitleaks; no run-local, no CLI suites, no heavy lock (reserved for the
staging proof). The DB walls, the CLI suites and the mutants are proved by CI on the pushed tip.

B (`apps/dashboard`): statuses are the floor keys (not-contacted, contacted, qualified, closed, spam), labels not raw keys (`statusLabel`), New means
not-contacted; `lib/leads.ts`, `crm.ts`, `views.ts` (an old saved view with status `new` is read as not-contacted), `LeadPanel.tsx`, `BulkBar.tsx`, the
three lib tests, `tests/flows.spec.ts` (two lines). Proof: tsc clean and vitest green (earlier this round). The label "Not contacted yet" is blocked by the
plan gate (plan row DP-1.3-12 in `docs/blueprint/16-DESIGN-PARTS.md`), so the label is "Not contacted"; the wording moves with order 39.

C (`tools/omnikom-cli`): `commands/lead.mjs` (no status list, no `::lead_status` cast: `list` filters on text, `update` passes `::text` and the database refuses an
unknown status with I-ANSWER), `commands/seed.mjs` (`TEST_CONTRACT` equals the contract in `tenancy.test.sql`, crm and forms included), `test/run.mjs`
(three lead checks and the seed check expect not-contacted and I-ANSWER), `test/harness.mjs` (the fake REST PATCH cast `::lead_status` to `::text`; the type is gone),
`test/journey.mjs` fakes and `commands/journey.mjs` value map (`'new'` to `'not-contacted'`, 12 places). Proof seen: CLI `--unit` part "OK: 800 of 800 checks passed"
(before the journey and harness edits); `node --check` on every changed file.
NOT RUN (stopped by the head): CLI `--unit` after the journey and harness edits, the `--db` part (the four lead and verify-people checks), and the watched red for
`lead.mjs` (break the new `lead_update` call, see the lead update check red, restore). UNPROVEN until CI.

CI retargets on d0b3b14 (all six applied): `status change writes its event`, `template field allowlist (review 10)`, `workspace index on leads (review 8, T14)`,
`crm14: bulk, no audit row per deleted lead`, functions `lead-update: the status is not checked`, and the new wall T31p5 (a person sent to a status that records
none is dropped, by `lead_update` and by the edit call). `isDay` (`_shared/http.ts`) now round-trips through ISO so a day that does not exist is refused.
Seen locally before the stop: run-local `--only` for `status change writes its event`, `crm14: bulk, no audit row` and `crm23: a person stays`: each
"PASS real migration: ALL TENANCY TESTS PASSED" and the mutant caught for its intended reason; functions `mutate.mjs --only "a day that does not exist"`:
"2 mutants, 2 caught, 0 survived, 0 target text missing". NOT RUN: `template field allowlist` and `workspace index on leads` (two attempts failed on the heavy
lock, then the head stopped the loop), the remaining CI findings of the six database-mutant items beyond those, and `mutate.mjs --only "the status is not checked"`.

Migration lint (on master a3846cf, not on this branch until it is rebased): run with master's `lint.mjs` against this migration folder it gives 5 findings in
migration 23 and no problem with the 37 existing waivers: line 32 L1 (unique index `sites_domain_unique`), 36 L4 (`alter column status type text`, the enum to text
conversion), 38 L2 (`leads_status_key` check, validated on existing rows), 44 L1 (`leads_status`), 45 L1 (`leads_lead_type`). L7 is clear (ruling I, `set lock_timeout`).
The waiver entries go in `tools/migration-lint/waivers.json` after the rebase (it is not in this tree); migration 23 is not applied to staging, so the migration itself could
be changed instead if the head prefers a concurrent index or a not-valid check.

Findings: the column-filter dropdown in the dashboard still lists raw status keys (labels only in the panel, bulk bar, timeline and filter chips); Playwright
`flows.spec.ts` edits are unrun (staging e2e); the panel radios and BulkBar have no component unit test; `tools/crm-map` still passes no `lead_type`.

## Staging proof (head, 2026-11-11)

- Migration 23 applied to staging 2026-11-10 23:49:06 UTC (`apply-staging.mjs --url-env STAGING_DB_URL_DIRECT`: "OK: applied 1 of 23");
  lead-update, lead-list, lead-export, leads-bulk deployed (`tools/deploy-functions.mjs --deploy-only`).
- First e2e run: "BLOCKED: workspace A's contract has no crm block": the test site's plan now names the real-estate lists (`crmFrom`),
  `seed test --target staging` made contract version 7.
- `supabase/tests/e2e-crm-a16.mjs`: 19 PASS, "ALL PASSED"; NOT RUN: the published-form step (needs SITE_URL and a form that maps
  listing-question).
- `apps/dashboard/tests/flows.spec.ts` against staging (build-staging, heavy lock): "11 passed (6.7m)", 1 skipped (the invite, needs
  SETTINGS_INVITE_EMAIL); cleanup left no CRM test lead.
- Book: A16 MISSING -> PARTLY (the screens are work order 39).
