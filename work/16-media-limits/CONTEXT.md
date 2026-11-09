# 16 media limits

Owner: platform build. Model: Sonnet (high). Branch: check/platform/media-limits. Status: BUILT 2026-11-09, local proof only (migration 21, T10/T27, 4 mutants, e2e-media-limits.mjs written); step 6 (staging) NOT RUN, the head runs it.

## Why
Hardening H0-4, `docs/product/1-product.md` part E row E10. The media bucket has no size or type limit
(`supabase/migrations/20261028000001_platform.sql:505`). `upload-start` checks the size (25 MB) and the type
(`supabase/functions/upload-start/index.ts:10-20`), but only against what the caller says: the signed upload URL it returns
takes any body, so a caller that declares 1 byte of image/png can then upload 1 GB of anything. Separately, the policy
`media_objects_insert` (`platform.sql:508-509`) lets any signed-in member write straight into their workspace's folder,
skipping `upload-start` and `record_media` entirely. Evidence: `work/11-enterprise-audit/CONTEXT.md:31-32` (H0-4).

## The design (decided by the head; build exactly this)
1. The bucket carries the same limits as `upload-start`: `file_size_limit` 26214400 (`MAX_BYTES`) and `allowed_mime_types`
   the five of `MIMES` (`image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`). The runner's derivatives are
   `image/webp` (`factory/runner/media.mjs:81`), already in the list. Storage enforces both on every upload, signed URL
   included (Supabase Storage docs, "Restricting uploads": bucket `file_size_limit` and `allowed_mime_types`).
2. `media_objects_insert` is dropped. Nobody uses it: the dashboard uploads only through the signed URL (`apps/dashboard/src/
   api.ts:137-142`), which Storage writes as the service role. `media_objects_read` stays (the dashboard's `createSignedUrl`,
   `apps/dashboard/src/data.ts:350`).
3. One new migration, `supabase/migrations/20261109000021_media_limits.sql` (number 21 is reserved for this order):
   `update storage.buckets set file_size_limit = ..., allowed_mime_types = array[...] where id = 'media';` and
   `drop policy media_objects_insert on storage.objects;`. Nothing else.

## Inputs (load these, nothing else)
- `work/11-enterprise-audit/CONTEXT.md:31-32`; `docs/product/11-rules.md` 30-36; `docs/departments/README.md` rule 8
- `supabase/migrations/20261028000001_platform.sql:503-510`; `supabase/migrations/20261109000020_security_event_buckets.sql`
  (the newest migration's shape; it reaches master with work order 15)
- `supabase/tests/local-shim.sql:38-48` (the local Storage model); `supabase/tests/tenancy.test.sql:161-165` (T10);
  `supabase/tests/run-local.mjs` MUTANTS (how a migration mutant is written)
- `supabase/functions/upload-start/index.ts:10-20` (read only: the two constants)

## Steps
1. `local-shim.sql`: give the shim's `storage.buckets` the two real columns, `file_size_limit bigint` and
   `allowed_mime_types text[]` (both nullable, as in Supabase). The shim models no upload, so it cannot enforce them.
2. The migration of the design.
3. Walls in `tenancy.test.sql` (a new T-number after the last one; they must pass on a fresh local database and on staging):
   a. the media bucket's `file_size_limit` is 26214400 and its `allowed_mime_types` is exactly the five types (as a set);
   b. T10 changes: a member or owner inserting into `storage.objects` directly is refused (row-level security) for their own
      workspace's folder too; reading their own folder's objects still works (insert the object as superuser first);
   c. the bucket's two limits equal `upload-start`'s constants: a node check in `run-local.mjs` (or the walls' runner) reads
      `MAX_BYTES` and `MIMES` from `upload-start/index.ts` and compares, so the two cannot drift apart.
4. Mutants in `run-local.mjs`, each caught: the size limit off by one byte up; one type added (`text/html`); one type
   removed (`application/pdf`); the insert policy kept (the drop line removed).
5. Watch every new wall red against today's migrations first; paste the failing lines.
6. Staging (the head runs it after CI is 9 of 9 on the tip): apply migration 21; then, as owner-a with a real session,
   `upload-start` for a 1-byte png, then PUT 26214401 bytes to the signed URL (refused), PUT a text/html body (refused),
   PUT a real small png (accepted); and a direct `POST /storage/v1/object/media/<workspace A>/x.png` with owner-a's token
   (refused). The builder writes this as `supabase/tests/e2e-media-limits.mjs` (staging only, synthetic data, keys by name,
   one PASS/FAIL line per check, deletes what it uploaded through the service role in a finally).
7. Book: E10 evidence becomes "the bucket enforces 25 MB and the five types on every upload, signed URLs included; no
   direct insert by a signed-in user (H0-4, work order 16, migration 21)"; state WORKS at the land if step 6 passes (the head
   moves it and recomputes the counts). `docs/product/3-database.md` one line on the bucket.

## Outputs
- `supabase/migrations/20261109000021_media_limits.sql`; `supabase/tests/local-shim.sql`; `supabase/tests/tenancy.test.sql`;
  `supabase/tests/run-local.mjs`; `supabase/tests/e2e-media-limits.mjs`; `docs/product/1-product.md` row E10 evidence only;
  `docs/product/3-database.md` one line; this file's status line.
- Nothing else. A change any other file needs is a finding.

## Rules for this order
- The builder never commits, pushes, applies to staging, deploys or publishes; it hands the head the staging steps.
- No full mutant run and no run-all-gates locally (rule 8): scoped mutants (`--only "media limits"`) through
  `~/.claude/scripts/heavy.mjs`; CI runs the rest. Keys by variable name only; scripts in files.

## Proof
- `node supabase/tests/run-local.mjs` (through `heavy.mjs`) with the real migrations: "ALL TENANCY TESTS PASSED"; the four
  new mutants run scoped: all caught (paste the lines).
- The watched-red lines of step 5.
- The staging lines of step 6 (the head).

## Findings
Send to the head; never fix here.

## Addendum (head, 2026-11-09 22:00): the state at the handover, and what the next head does before the land
State: BUILT by the builder, NOT reviewed by the head; committed as WIP 5cc2104 on this branch. Watched red (migrations 1-20, 21
moved out): "ERROR:  EXPECTED row-level security BUT IT SUCCEEDED: insert into storage.objects (bucket_id, name) values ('media',
'bbbbbbbb-.../ok.jpg')" and "FAIL T27c media bucket limits differ from upload-start: bucket '' vs upload-start '26214400|...'".
NOT RUN: the green run with migration 21 ("ALL TENANCY TESTS PASSED"), the 4 "media limits" mutants (heavy lock held by other
projects, then the harness stopped the run for low memory), and `e2e-media-limits.mjs` (never run).
Before landing:
1. Renumber this order's walls from T27 to **T30** in `tenancy.test.sql` and every reference in `run-local.mjs` (T27 is 08's team
   list on master, T28 is 10's audit summaries, T29 is work order 18's).
2. Review the diff (the builder also retargeted the old mutant "storage folder must be a visible workspace" to the read policy,
   since migration 21 drops the insert policy it targeted).
3. CI 9 of 9 on the tip (CI is the first green run of the walls and mutants).
4. Staging: apply migration 21, then `e2e-media-limits.mjs` (its first run).
5. E10 to WORKS only if step 4 passes; H0-4 "done, <sha>" in 9-blocks.md; counts from the rows; land.
Builder's findings (not fixed): (1) Storage may count the multipart overhead toward the 25 MB limit: the e2e sends exactly
26214401 bytes in the file part, so if staging accepts it, check that before blaming the bucket. (2) `drop policy
media_objects_insert` has no IF EXISTS (as designed): the migration fails on a database that already lost the policy. (3) The
wall "no INSERT/ALL policy on storage.objects" is stricter than the order: any future policy of that kind (or one Supabase adds)
turns it red; judged the point of the wall. (4) `e2e-functions.mjs` leaves its upload-start media rows behind; the new e2e
deletes its own.

Proof (head, 2026-11-09 22:40, after the renumber to T30; `heavy.mjs ... run-local.mjs --only "media limits"`):
"PASS real migration: ALL TENANCY TESTS PASSED", "PASS T30c media bucket limits equal upload-start (26214400 bytes, 5 types)",
"caught media limits: the size limit is one byte too high ERROR: T30a the media bucket caps a file at 26214400 bytes",
"caught media limits: one more type is allowed (text/html) ERROR: T30a ... exactly the five types", "caught media limits: one
type is missing (application/pdf)", "caught media limits: the insert policy is kept ERROR: EXPECTED row-level security BUT IT
SUCCEEDED", "OK: real migration passes; 4 mutants". The retargeted old mutant (`--only "storage folder"`): "caught storage folder
must be a visible workspace ERROR: B reads only its own folder's object". Still NOT RUN: CI, staging (migration 21 and the first
`e2e-media-limits.mjs`).
