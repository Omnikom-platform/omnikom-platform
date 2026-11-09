# 20 CRM A16: lead type and status, per-industry lists held as data (backend)

Owner: platform build. Model: Sonnet (high). Branch: check/platform/crm-a16. Migration: 23
(`supabase/migrations/20261109000023_lead_type_status.sql`, reserved). Status: OPEN 2026-11-09, written by the head; STARTS
AFTER work order 18 lands (both change `leads`, `lead_list` and `lead-update`). Screens are a later order, like 19 for 18.

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
- SEO's researched lists (work order 29, branch `check/seo/lead-types` 1bbfe00 until it lands): `work/29-lead-types/`
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
