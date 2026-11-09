# 15 security events

Owner: platform build. Model: Sonnet (high). Branch: check/platform/security-events. Status: BUILT 2026-11-09, head reviewed (migration, walls T26a-d, 5 mutants read); builder proof: real migrations "ALL TENANCY TESTS PASSED", 5 of 5 "security buckets" mutants caught, T26a-d watched red against the old function; the head's local re-run did NOT run (heavy lock held by other jobs for 60 min), so CI is the independent check; staging step 5 next. DONE at the land.

## Why
Hardening H0-2, `docs/product/1-product.md` part E row E5. Any POST to `capture-lead` with a well-formed `?site=<uuid>` and a
bad signature adds one `security_events` row (`supabase/functions/capture-lead/index.ts:152`); the table is append-only for
every role (`supabase/migrations/20261030000007_hardening_leftovers.sql:43-45`), so nothing can ever remove them, and on the
Free plan a flood fills the database size cap. The site uuid need not exist and the ip hash is `sha256(site:ip)`, so an
attacker varying the uuid gets a fresh row per request. Evidence: `work/11-enterprise-audit/CONTEXT.md` H0-2 ("count events
per kind, site, ip_hash and minute with an upsert").

## The design (decided by the head; build exactly this)
All of it lives in the database, in `service.record_security_event`, so every caller (capture-lead, `_shared/db.ts`
recordEvent, `_shared/runner.ts`) is bounded without a change to any function.
- New table `public.security_event_counts`, one row per bucket: `kind text`, `code text not null default ''`,
  `workspace_id uuid not null default '00000000-0000-0000-0000-000000000000'`, `site_id uuid not null default <zero uuid>`,
  `actor uuid not null default <zero uuid>`, `ip_hash text not null default ''`, `minute timestamptz` (date_trunc('minute', now())),
  `overflow boolean not null default false`, `n int not null default 1`, `event_id bigint not null` (the security_events row of the
  bucket's first event), `last_at timestamptz not null default now()`; primary key over (kind, code, workspace_id, site_id,
  actor, ip_hash, minute). Nulls are stored as the zero uuid / '' so the key is plain. Index on (minute) for the ceiling count.
  Same walls as security_events: RLS on, staff-only select policy, no grants to anon, authenticated reads only (policy), no
  direct insert/update/delete for service_role or omnikom_fn: only the security definer function writes it. It is NOT
  append-only (its `n` is updated), and nothing deletes from it in this order (retention is H2-1: say so in the report).
- `service.record_security_event` (same signature, same return type, `security definer set search_path = ''`, the grants it
  has today):
  1. The bucket key from the arguments and the current minute. If the bucket exists: `n = n + 1, last_at = now()`, return its
     `event_id`. No new security_events row.
  2. If it does not exist and the caller is anonymous (`p_actor is null`) and this minute already holds 10 or more
     non-overflow anonymous buckets: fold into the minute's overflow bucket for that kind (key: kind, code, zero uuids, '' ip,
     minute, overflow true); create it (with one security_events row whose detail is `{"overflow": true}`) if missing, else
     `n = n + 1`; return its `event_id`.
  3. Otherwise insert the security_events row exactly as today, then the bucket with that `event_id`, return the id.
  Use `insert ... on conflict ... do update` for the bucket so two calls racing on the same key give one bucket (the ceiling
  count may be off by a few under a race; say so in a comment, that is accepted). The ceiling 10 is a constant in the function
  with a one-line comment (a flood from one source is 1 row a minute; from many sources at most 11 a minute per kind).
  Callers with an actor (signed-in refusals) are bucketed but never folded.
- `security_events` keeps its append-only triggers and its grants unchanged.

## Inputs (load these, nothing else)
- `work/11-enterprise-audit/CONTEXT.md` H0-2; `docs/product/11-rules.md` 30-36; `docs/departments/README.md` rule 8
- `supabase/migrations/20261030000007_hardening_leftovers.sql:22-56` (the table, the first function),
  `supabase/migrations/20261030000008_search_path_and_roles.sql:645-655` (the current function) and its grants block for
  `record_security_event` (grep it), `supabase/migrations/20261109000019_reaper_schedule.sql` (the newest migration's shape)
- `supabase/tests/tenancy.test.sql:630-655` and `:1545-1560`, `:1630-1640` (today's security-event walls);
  `supabase/tests/run-local.mjs` MUTANTS (`:82`, the security-event mutants at `:235-237`, how a migration mutant is written);
  `supabase/tests/qualify.mjs:8` (the table list)
- `supabase/functions/capture-lead/index.ts:137-152`, `supabase/functions/_shared/db.ts:103-108` (read only: no change)

## Steps
1. New migration `supabase/migrations/20261109000020_security_event_buckets.sql` (number 20 is reserved for this order; 21 is
   H0-4's). The table, its walls, `create or replace function service.record_security_event`, and its grants restated.
2. Walls in `supabase/tests/tenancy.test.sql` (new T-number after the last one; they must pass on a fresh local database AND
   on staging, which already holds events, so measure deltas, never totals, and use site uuids fresh per run, e.g. from
   `gen_random_uuid()` kept in a set_config):
   a. 50 calls with the same kind, site and ip hash in one transaction (one minute): security_events grows by exactly 1, the
      bucket has n = 50, every call returned the same id.
   b. 30 anonymous calls with 30 different fresh site uuids in one transaction: security_events grows by at most 11 for that
      kind and code (10 buckets plus one overflow) and the overflow bucket's n plus the plain buckets' n is 30. (A minute that
      already had anonymous buckets from another test lowers the plain count; assert the sum and the bound, not exact splits.)
   c. 15 calls with an actor and 15 different sites: 15 new rows, no overflow (signed-in refusals are never folded).
   d. The function role and service_role cannot insert, update or delete security_event_counts directly
      (`test.expect_error ... 'permission denied'`); an owner reads 0 rows of it; staff with MFA read the buckets of (a).
   e. Today's walls (630-655, 1552, 1637-1638) still pass unchanged.
   Add `security_event_counts` to `supabase/tests/qualify.mjs:8` if that list must name every table (read it).
3. Mutants in `supabase/tests/run-local.mjs` MUTANTS, each caught: the bucket lookup skipped (every call inserts a row); the
   ceiling removed (anonymous calls never fold); signed-in calls folded too (the `p_actor is null` test dropped); the counts
   table readable by every signed-in user (policy `using (true)`).
4. Watch every new wall red first against today's function (say how in the report: paste the failing lines).
5. Staging (the head runs it, after CI is 9/9 on the tip): apply-staging applies migration 20; the tenancy walls run against
   staging; then 25 POSTs to staging `capture-lead?site=<one fresh uuid>` with a bad signature from this machine: all 401,
   security_events grows by 1, the bucket's n is 25. Read-back lines go in the report.
6. Book: E5 evidence becomes "security events are bucketed per source and minute, at most 11 new rows a minute per kind from
   anonymous callers (H0-2, work order 15); no edge limits or bot check (KNOWN-1)"; state PARTLY at the land (the head moves
   it and recomputes the counts). `docs/product/3-database.md:36` and `:90` gain the counts table in one line each.

## Outputs
- `supabase/migrations/20261109000020_security_event_buckets.sql`; `supabase/tests/tenancy.test.sql`;
  `supabase/tests/run-local.mjs`; `supabase/tests/qualify.mjs` if needed; `docs/product/1-product.md` row E5 evidence only;
  `docs/product/3-database.md` two lines; this file's status line.
- Nothing else. A change any other file needs is a finding.

## Proof
- `node supabase/tests/run-local.mjs` (through `heavy.mjs`) with the real migrations: "ALL TENANCY TESTS PASSED"; the four new
  mutants run scoped: all caught (paste the lines). No full mutant run and no run-all-gates locally (rule 8): CI runs those.
- The watched-red lines of step 4.
- The staging read-back of step 5 (the head).

Filled by the head, 2026-11-09:
- Builder (addendum 1): run-local "PASS real migration: ALL TENANCY TESTS PASSED", "OK: real migration passes; 6 mutants" (6 of 6
  "security buckets" caught, T26e new); Deno "OK: 157 of 157 checks passed"; CLI unit "OK: 666 of 666", CLI db "OK: 179 of 179".
- CI 9 of 9 on c6c6a1f (run 42638812183); the first tip d94e038 was red (42598329474: the readers counted rows).
- Staging before migration 20 (12:15): 25 bad-signature posts to capture-lead on one fresh site, "security_events rows for the
  site: 25 (new)", then "relation "public.security_event_counts" does not exist". After `apply-staging.mjs` ("apply
  20261109000020_security_event_buckets.sql" / "OK: applied 1 of 18"): "25 POSTs answered {"401":25}", "security_events rows for
  the site: 2 (new)", buckets "bad-signature | SIGNATURE | 14" and "bad-signature | SIGNATURE | 11" (the flood crossed a minute).
- NOT RUN on staging: `run-staging.mjs` (the walls) refuses by design, "staging already holds 9 test fixture row(s): clean them
  first" (the shared test accounts and sites the flows use); the walls are CI's gates job and the builder's run-local.

## Findings
Send to the head; never fix here.
- verify.mjs (CLI's file) changed by work order 15 with the CLI head's OK (2026-11-09 12:26): line 43 `events(kind)` reads sum(n) of security_event_counts, and the comment at :10-12 says what is counted.
  Watched by the head 2026-11-09 16:45 (recorder broken: an existing bucket kept n; CLI db suite, local cluster): red
  "FAIL each refused signature is recorded once in security_events (expected 4 rows (1 each), got 0, deltas=0,0,0,0)",
  "FAILED: 169 of 179 checks passed, 10 FAILED"; restored (identical: true): "PASS each refused signature is recorded once in
  security_events (expected 4 rows (1 each), got 4, deltas=1,1,1,1)", "OK: 179 of 179 checks passed".
- CLI's `tools/omnikom-cli/test/run.mjs:1480` deletes from security_events between wall re-runs but not from
  security_event_counts (builder's finding; green anyway: sum(n) deltas still hold, a bucket only keeps a dangling event_id).
  For the CLI head.

## Addendum 1 (head, 2026-11-09 12:30): CI red on d94e038 (run 42598329474), fix it
CI failed 3 jobs. Cause: every reader that counts security events by ROWS now under-counts, because events of one bucket
write one row (intended). Readers: `supabase/functions/test/util.ts:76-82` `securityEvents()`, `supabase/functions/test/runner-util.ts:58-63`
`runnerEvents(fn)`, `tools/omnikom-cli/commands/verify.mjs:43` `events(kind)` (CLI's file: the CLI head is told; change only that line
and its comment at :10, nothing else there). Deno: "FAILED | 145 passed | 12 failed", e.g. "ASSERT: six security events: got 0,
wanted 6", "each refused token left an auth-refused event: got 1, wanted 4". CLI: "verify: the ledger checks of migration 7 ... FAIL".
1. Migration 20 (still unlanded, edit it in place): add `fn text not null default ''` to security_event_counts and to its primary
   key, filled with `coalesce(left(p_detail ->> 'fn', 60), '')` (callers set `fn` server-side from a fixed set, so it does not
   widen the bound); the overflow bucket keeps the caller's fn too. Update the header comment and the mutants' target texts if
   they moved. Add one wall to T26: two calls, same source and minute, different `fn` -> two buckets, two rows.
2. Each reader counts events, not rows: `coalesce(sum(n), 0)` from `public.security_event_counts` with the same filters (actor /
   code / kind / site map to the stored columns; a null filter value means "any"; remember nulls are stored as the zero uuid
   and ''). `runnerEvents(fn)` filters `kind = 'bad-signature' and code = 'SIGNATURE' and fn = ${fn}` and joins
   `public.security_events e on e.id = c.event_id` for `e.detail ->> 'kind' = 'runner'`.
3. Proof: the Deno function tests (the harness CI's functions job runs: read `.github/workflows/ci.yml` for the exact command)
   all pass; `node tools/omnikom-cli/test/...` the CLI unit tests that cover verify pass (find them; the failing names are
   "verify --only lead" and "verify: the ledger checks of migration 7"); run-local real migration "ALL TENANCY TESTS PASSED" and
   the scoped "security buckets" mutants all caught, plus the new fn wall watched red with fn out of the key. All through heavy.mjs.
4. Outputs added: `supabase/functions/test/util.ts`, `supabase/functions/test/runner-util.ts`, `tools/omnikom-cli/commands/verify.mjs`.
5. CLI head's conditions for `verify.mjs` (OK given 12:26): `sum(n)` is the total of events, the first of each minute included
   (it is: a bucket starts at n = 1; say so in the comment at :10, which must say what is counted); same kind and site_id
   filters; watch "each refused signature is recorded once" red once with migration 20's recorder broken (n not incremented),
   then green restored, and paste both lines. Add to Findings: "verify.mjs (CLI's file) changed by work order 15 with the CLI
   head's OK (2026-11-09 12:26)".
