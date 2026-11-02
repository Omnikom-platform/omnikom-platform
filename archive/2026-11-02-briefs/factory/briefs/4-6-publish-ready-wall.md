# Brief 4.6: the publish-ready wall (a row that fails publish validation can never be published, on any path)

Builder: Sonnet, in-session agent of the Platform build head (session `local_cade0add-3389-4314-b7b5-83333d26a97a`).
Ordered by the head of operations on 2026-10-31 after step 4; it comes before step 5.

## Why
The publish Edge Function validates every requested row with the JS validator (`contracts/validate.mjs`, publish mode) before it
calls `service.start_publish`. Every other path skips that: `omnikom publish` (the CLI's SQL path), test scripts, anything with a
database connection. On staging, three bare test listings (data `{ "street": ... }` only) were published that way by the 4.3 e2e
runs. Every publish snapshots ALL published rows of the workspace, so from then on every build of the test site failed in the
factory (job e29fb962, `I-REQUIRED status required`, ...). The factory stopped it and nothing deployed, but one bad row blocked
the whole site. The database must refuse it, whatever the path, a superuser connection included (triggers fire for superusers).

## What to build
A new migration `supabase/migrations/20261031000011_publish_ready_wall.sql`. Never edit an applied migration (1 to 10 are applied
on staging).

1. `private.publish_problems(p_resolved jsonb, p_collection text, p_data jsonb) returns text[]`: a FAITHFUL SQL port of the
   publish-mode REQUIRED rules of `contracts/validate.mjs` (read `checkValue`, `checkObject`, `validateItem`, `empty`), and
   only those. Each problem is `'<path> required'`, with the path built the way the JS builds it (`status`, `seo.title`,
   `sections.hero`, `rooms[0].name`). The rules:
   - `empty(v)`: missing, JSON null, the empty string, or the empty array. A whitespace-only string is NOT empty (as in JS).
   - A field with `required: true` whose value is empty: `<path> required`.
   - `group` fields (not `open`): recurse into `of` when the value is an object. `list` fields (not `open`): recurse into each
     row with `of`. A missing group or list is only a problem when the field itself is required (as in JS).
   - `seo` fields with a value: `title` and `description` must be non-empty after trim (`<path>.title required`, ...).
   - `sections` fields: the page type is `data.type`, found in the resolved contract's page types. For each section of kind
     `fields` that has at least one required field and is absent from the value: `<path>.<section id> required`. For each
     present section: recurse into its fields.
   - An unknown collection: one problem `'<collection> unknown collection'`.
   - Everything else in the JS validator (types, max, slug, enum, references, media and EXIF, placeholder text, consent
     wording, sample items) stays in JS, and a comment says so by name. Do not port more: more SQL is more drift.
   Read the shape of `site_contracts.resolved` on the local cluster first (it is the contract with core merged in: collections
   and page types). `set search_path = ''`, `immutable` or `stable` as fits, everything schema-qualified.
2. The contract a row is checked against: the workspace's ACTIVE `site_contracts.resolved`. No active contract = refused.
3. Layer one, a trigger `before insert on public.publish_jobs`: for every `(row id, version)` in `new.requested`, load that
   version's data from `content_versions` and refuse when `publish_problems` is not empty:
   `raise exception 'I-NOT-READY: <row id> <first problem>'`. Layer two, a trigger `before update of published_version on
   public.content_rows` when the new value is not null and changes: the same check on that version (this also stops a job that
   was created before this migration, or a faked `done` callback, from publishing a bare row). Both triggers are SECURITY
   DEFINER functions with `search_path = ''`, like every definer function (T14).
4. `supabase/functions/_shared/db.ts` `refusal()`: map `I-NOT-READY` to 422 with code `I-NOT-READY` and a plain message
   ("Some items are not ready to publish."), next to `S-KIND`. The publish function already returns 422 VALIDATION before
   this can fire; this is the second layer.

## Tests (each new wall watched red first, then a mutant)
- `supabase/tests/tenancy.test.sql`: on the SQL path (`test.publish` as the owner) a bare row is refused with `I-NOT-READY`;
  the same row made complete is accepted; a `published_version` moved by hand (superuser `update`) to a bare version is
  refused. Many existing fixtures publish bare rows (listing1, listing2, team1, teamB2, ...): make their data complete for the
  test contract, so every existing assertion still means what it meant. Do NOT weaken an assertion to make it pass.
- Watched red: write the new tests first, run `node supabase/tests/run-local.mjs --only <none>` (real migration only) BEFORE the
  migration exists and paste the red lines; then add the migration and paste green.
- Mutants in `supabase/tests/run-local.mjs` (the MUTANTS list; read how both-layer mutants are written there): the insert
  trigger removed; the update trigger removed; both layers removed together; `empty` treats '' as present; the seo
  title/description rule removed; the required-section rule removed; the recursion into groups removed. Each must be caught.
  The grants/definer conventions of migration 9 apply (see the migration 9 mutants at the end of the list).
- Parity (the SQL port must not drift from JS): a new script `supabase/tests/publish-parity.mjs` that starts its own throwaway
  cluster (reuse what `run-local.mjs` does; read it), applies the migrations, and for every contract in `contracts/` test
  fixtures (and `sites/test-demo-a/contract.json`) and every collection, builds items: a complete item (from the fixtures
  where they exist) and, for each required path, the item with that one value removed. For each item compare the set of
  `I-REQUIRED` paths from `validateItem(contract, collection, data, { mode: 'publish' })` with the set from
  `private.publish_problems` on the resolved contract. Any difference = FAIL with the item and both sets. Ends with
  `OK: N items, SQL and JS agree on every required path` or FAILED. Watched red: break the port on purpose once (one rule),
  see the parity FAIL naming it, restore. Add it as a gate in `docs/blueprint/specs/run-all-gates.mjs` (one line in the gate
  list, next to the database walls) and as a step in `.github/workflows/ci.yml`'s `gates` job only if run-all-gates does not
  already cover it there (it does: the gates job runs run-all-gates; so ci.yml needs no change).
- `node supabase/functions/test/run.mjs` and `mutate.mjs`: the Deno tests publish rows too; make their fixtures complete if
  they fail, never weaken them. Add one Deno check that a database refusal `I-NOT-READY` becomes 422 `I-NOT-READY`.
- `supabase/tests/e2e-export.mjs` publishes a bare listing on staging: make its listing complete for the test site's contract.

## Staging
Apply the migration to staging with the CLI (`node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node
tools/omnikom-cli/omnikom.mjs apply --target staging`, after `--dry-run`), then run `omnikom status --target staging` (11
applied, 0 pending) and `node tools/with-env.mjs ... -- node supabase/tests/e2e-export.mjs` (0 problems). Do not touch the test
site's rows otherwise; the head re-runs `sites/test-demo-a/publish.mjs` afterwards.

## Rules
- Edit only: the new migration, `supabase/tests/` (tenancy.test.sql, run-local.mjs, the new publish-parity.mjs,
  e2e-export.mjs), `supabase/functions/` (db.ts refusal, the Deno tests and their fixtures), `docs/blueprint/specs/run-all-gates.mjs`
  (one gate line only; the head is editing that file too: add your line and nothing else), and a paragraph in
  `docs/blueprint/PROGRESS.md` under "## Step 4" titled `### 4.6 publish-ready wall (builder)`. `tools/omnikom-cli/` and
  `tools/audit/` belong to other departments: a need there is a finding in your report, never an edit (the CLI's `verify` or
  `seed test` may publish bare rows: find out and report it).
- Keys by variable name only through `tools/with-env.mjs`; never print, copy or list a value, never list the
  `creds and accounts login/` folder. Scripts in files, never `node -e`. No em dashes. Long runs in the background with bounded
  waits; `run-local.mjs` takes about 25 minutes locally for every mutant, so use `--only` while iterating and one full run at
  the end. Do not commit; the head verifies and commits.
- Two failed approaches to the same obstacle = stop and report BLOCKED with what would unblock it.

## Done when (paste every line in your report and in PROGRESS)
- the red run before the migration, then `PASS real migration` and `OK: real migration passes; N mutants` (all caught, N = 215 +
  yours);
- the parity script: its watched-red FAIL line and its final OK line;
- `node supabase/functions/test/run.mjs` OK and `mutate.mjs` 0 survived;
- `deno task check` exit 0; `node docs/blueprint/specs/check-specs.mjs` OK;
- `GATE_ONLY` not set: `node docs/blueprint/specs/run-all-gates.mjs` ends `all gates passed`;
- staging: apply output, status (11 applied), e2e-export 0 problems;
- findings for other departments, each in one line.
