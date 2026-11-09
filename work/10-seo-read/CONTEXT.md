# 10 seo-read: every publish stores its audit summary, and a site's owner can read it

Owner: platform-build. Model: Sonnet 5.5, effort high. Branch: check/platform/seo-read (worktree on master after SEO's
audit-results lands). Migration: M16 (`20261104000016_site_audit.sql`). Status: OPEN (written 2026-11-04 by
`HEAD_Platform-build_2026-11-04b`).

## Why
SEO's work order 05 findings F1 and F2 (`work/05-audit-results/CONTEXT.md` "Findings"); `docs/product/6-dashboard.md` "Search
health" cards 1 and 2 need them; `9-blocks.md:86` "audit results stored per site for the dashboard". Today the publish runner
keeps only `{ exit, fails }` of the audit (`factory/runner/publish.mjs:144-149`), so a site's check cannot be shown. Backend only;
the Search health screen is a later block (its plain family words come from `tools/audit/` first, SEO's next slice).

## Inputs (load these, nothing else unless a step needs it)
- `CLAUDE.md`, `work/STATE.md`, this file, `work/05-audit-results/CONTEXT.md`, `tools/audit/README.md` "The summary (stored per
  site)", `tools/audit/summary.mjs` (read only: SEO's file).
- `docs/product/6-dashboard.md` "Search health" and "Roles on screen"; `3-database.md` (publish jobs, the wall); `4-backend.md`
  (How a call is checked, the Edge Functions); `11-rules.md`.
- `factory/runner/publish.mjs` and its tests (`factory/runner/test/`); `supabase/functions/job-callback/index.ts` (gateReport at
  most 64 KiB); `supabase/migrations/` (M1 `publish_jobs.gate_report`, M4/M8 `finish_job`, the newest `lead_list` for the
  function shape); `supabase/functions/{_shared,lead-list}/`, `supabase/functions/test/`, `supabase/tests/run-local.mjs`,
  `tenancy.test.sql`.

## Settled by the head (do not re-open; a reason to change one is a finding)
1. **The runner (F1):** `publish.mjs` runs `tools/audit/run.mjs <dist> --target <t> --summary`, parses the one JSON object, and
   stores it as `gateReport.audit` for a pass AND a fail (`Stop('audit failed', { factory: 'pass', audit: <summary> })`). Exit 2
   (usage) keeps today's `{ exit: 2, lines }`. Output that is not one JSON object is a stop `audit output unreadable` with the last
   10 lines, never a silent pass. Any FAIL lines today's code logs come from `summary.fails`. The whole gate report stays under
   the callback's 64 KiB (the summary is under 60 KiB by SEO's test; the runner adds nothing large).
2. **No new table.** `publish_jobs.gate_report` already holds one report per job. M16 adds `service.site_audit(p_claims jsonb,
   p_site uuid)` (definer, `search_path = ''`, closed to PUBLIC, granted to `omnikom_fn`): owner of the site's workspace or staff
   with MFA, else S-NOT-FOUND (a member gets not found, as site settings are hidden from members). It answers
   `{ latest: { preview: <row>|null, production: <row>|null }, history: [<row>, ...] }` where a row is
   `{ job, finished_at, state, target, pass, counts, summary }`: `latest` = the newest job per target whose `gate_report.audit`
   has `v = 1` (the summary, including its `fails`); `history` = the last 10 finished jobs of the site, newest first, each
   WITHOUT `fails` (date, state, pass, counts; a failed job says it; `summary` null in history). Jobs from before this order (no
   `v`) appear in history with `pass` and `counts` null; they never appear in `latest`.
3. **The function:** Edge Function `site-audit` (signed in, POST `{ site }`) calls `service.site_audit` through the dashboard
   frame like `lead-list`; `config.toml`, `deno.json`, `local-serve`, the CORS test and `docs/blueprint/specs/openapi.json` updated as block 1 did.
4. An index on `publish_jobs (site_id, finished_at desc)` only if M1 does not already have one that serves this read (check, then
   say which in `3-database.md`).

## Steps
1. The runner change (1) with tests in `factory/runner/test/`: a pass stores the summary; a fail stores it and still stops; an
   unreadable output stops with its own reason; watched red each, a mutant each in the runner's mutant file.
2. M16 (2, 4). Walls with a test watched red and a mutant each in `supabase/tests/run-local.mjs`, at least: a member asks
   (not found), an owner of another workspace asks (not found), `latest` skips a newer job with no `v`, history holds at most 10
   and no `fails`.
3. The function (3), tests in `supabase/functions/test/`, mutants in `supabase/functions/test/mutate.mjs`.
4. Staging proof script `supabase/tests/e2e-site-audit.mjs` (staging only): as owner-a, publish the test site to preview once
   (`factory/runner/publish.mjs` the way `e2e-screens.mjs` does), then `site-audit` answers `latest.preview` with `v 1`, the
   job's id and `pass true`; history's first row is that job; member-a1 gets not found. One PASS/FAIL line per check.
5. The book in place, in the land commit: `3-database.md` (the function, the index answer), `4-backend.md` (functions table),
   `6-dashboard.md` "Search health" card 1 and 2 inputs now "backend proven on staging (e2e-site-audit <date>)", `1-product.md`
   (no row moves: B21 stays MISSING until a screen exists; write the backend half in its "where it lives" cell).

## Rules for this order
- `tools/audit/` is SEO's: import or run it, never change it; a change it needs is a finding to the head.
- The builder never commits, pushes, applies to staging, deploys or publishes; it hands the head the staging steps.
- Before reporting done, run locally every suite CI runs on what changed: `factory/runner/test/` and its mutants,
  `supabase/tests/run-local.mjs`, `supabase/functions/test/mutate.mjs`, `tools/omnikom-cli/test/run.mjs`. The full
  `run-all-gates.mjs` is CI's (rule 8). Long runs in the background through `~/.claude/scripts/heavy.mjs`.
- No screens, no design work, nothing against a client site or production; keys by variable name only; scripts in files.

## Done when
- The new tests watched red, each mutant caught (pasted lines); CI 9 of 9 on the check branch; landed by `omnikom land`.
- On staging after the land (the head runs: apply M16, deploy `site-audit`, `e2e-site-audit.mjs`): every line PASS; then
  `e2e-screens.mjs` still 0 problems.

## Proof
The head, staging 2026-11-09 from `check/platform/seo-read` (CI 9 of 9 on 39ae8b3, run 42616788482; the backend is unchanged by
the later rebase onto 08):
- `apply-staging.mjs`: "OK: applied 1 of 18 (17 were already applied)" (M16; it adds two functions only, so its place after
  17 to 20 on staging changes nothing); `deploy-functions.mjs`: "OK: site-audit deployed".
- One publish of the test site from the branch (workflow_dispatch, run 42649862028, job be08e7b8): "STEP gating: audit exit 0
  (target preview), PASS 151, FAIL 0, SKIP 1", "STEP done: deploy c8ff1f24".
- `e2e-site-audit.mjs --job be08e7b8-...`: 8 PASS lines, "PASS: site-audit on staging, 0 problem(s)".
- `e2e-screens.mjs` (from the tree rebased on 08, so without the invite mail path): "PASS: staging end to end for the
  functions of the four screens, 0 problem(s)".
- CI red twice before the land, both in the factory mutants and both already red on the builder's tip 1fa9059 (CI 41906691070):
  a stale mutant target and an equivalent mutant; fixed by the head (39ae8b3).

## Findings
(the builder writes here, one line each, and sends them to the head)
- F1 (accepted by the head, later migration): `set_job_state` (M8) copies the whole `p_report` into `audit_log.detail`, so every publish now writes the audit summary (up to ~60 KiB) into `audit_log`; trim it to `{ pass, counts }` for the audit key.
- F2: the order says `e2e-screens.mjs` publishes the test site; it does not. `e2e-site-audit.mjs` publishes through `sites/test-demo-a/publish.mjs --rows-file <f> --wait` (or takes `--job <uuid>` of a publish the head already ran).
- F3 (for SEO, optional): the stored summary has no `commit` (`run.mjs --summary` passes none); the runner could add it from `GITHUB_SHA` if the Search health card wants "checked at commit".
- F4: `icm/` goes stale with every book edit (`node tools/icm/index.mjs --check`); regenerate once after the last doc edit.
