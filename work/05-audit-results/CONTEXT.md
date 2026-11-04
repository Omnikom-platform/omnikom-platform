# 05 audit results

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/audit-results. Status: OPEN.

## Why
`docs/product/9-blocks.md:86`: "SEO and audits: audit results stored per site for the dashboard". Today the publish runner keeps
only `{ exit, fails }` of the audit (`factory/runner/publish.mjs:147-151`), so a site's audit cannot be shown. This order builds the
part this department owns: one small, versioned audit summary the runner can store per publish job. Storing it and reading it per
site is platform-build's files (findings below). First, a small fix: the skill still names the old workspace paths.

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/seo-and-audits.md` (Rules, Proof; not the position log)
- `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance\SKILL.md` (a hook makes you read it before touching
  `scripts/launch.mjs`), `stages/launch.md`, `stages/build.md`, `scripts/launch.mjs` of that outside copy; `skills/SOURCE.md`;
  `skills/sync-skill.mjs`
- `tools/audit/README.md`, `tools/audit/index.mjs` (the `audit()` object, line 5 and 104), `tools/audit/run.mjs`,
  `tools/audit/test/run.mjs`, `tools/audit/test/mutate.mjs`
- read only: `supabase/functions/job-callback/index.ts:1-25` (gateReport at most 64 KiB), `factory/runner/publish.mjs:140-155`

## Steps
1. Skill paths. The repository moved to `E:\Omnikom Platform\code\main`; `sops\launch.md`, `sops\site-scope.md` and
   `sops\client-questions.md` are now `sops\clients\...`; `docs\blueprint\12-LAUNCH.md` is archived and the book's
   `docs/product/7-sites.md` section "Launch" replaces it. Edit the OUTSIDE copy (it is its own git repo):
   - `stages/launch.md:5`: `E:\Omnikom Platform\code\main\sops\clients\launch.md`; architecture
     `E:\Omnikom Platform\code\main\docs\product\7-sites.md` section "Launch" (DECISIONS 19).
   - `stages/build.md:82,94,96`: `E:\Omnikom Platform\code\main\sops\clients\site-scope.md`,
     `...\code\main\sops\clients\client-questions.md`, `...\code\main\templates\client-questions\`.
   - `scripts/launch.mjs:716`: `E:\\Omnikom Platform\\code\\main\\sops\\clients\\launch.md` and `docs/product/7-sites.md "Launch"`.
   Commit there (one commit, message names this order), then in your worktree `node skills/sync-skill.mjs
   programmatic-enterprise-web-performance` (it copies and rewrites the SOURCE.md row; check the row names the new sha).
2. `tools/audit/summary.mjs`: `summarize(r, { commit } = {})` turns an `audit()` object into
   `{ v: 1, target, mode, pass, exit, pages, rules, counts: { PASS, FAIL, SKIP }, byFamily: { <prefix>: { PASS, FAIL, SKIP } },
   fails: [{ rule, page, line, what, source }], truncated, commit? }`. `pages` and `rules` are counts; the family is the rule id
   prefix (`MET-003` -> `MET`); `fails` keeps every FAIL in rule order up to 200 and `truncated` says how many were left out (0 when
   none); every `what` is cut to 300 characters. Its JSON must stay under 60 KiB for any input (the callback refuses over 64 KiB).
   Read the real status values from `index.mjs` first; a status that is not PASS, FAIL or SKIP is counted under its own key, never
   dropped. Node built-ins only, nothing written.
3. `run.mjs --summary` prints the summary JSON and nothing else (same exits as today; `--summary` with `--json` is exit 2).
4. Tests in `tools/audit/test/run.mjs`: the good fixture (`--target preview` as its entry needs) gives `pass true`, `counts.FAIL 0`;
   `bad-MET-003` gives exactly one `MET` FAIL with its page and line; a synthetic object of 5,000 FAILs with 2,000-character `what`
   gives 200 fails, `truncated 4800`, JSON under 60 KiB; an unknown status is counted. Watch each fail first (break the code, see it
   red for the right reason, restore) and write what you saw in the proof file.
5. Mutants in `tools/audit/test/mutate.mjs`: remove the 200 cap; remove the 300-character cut; drop the unknown-status count. Each
   must be caught by a FAIL line.
6. `tools/audit/README.md`: a section "The summary (stored per site)": the call, the shape, the limits, and the line the runner
   would use (`run.mjs <dist> --target <t> --summary`).
7. Proof file `tools/audit/proof/audit-results.md`: every command below with its pasted last lines. Commit, gitleaks clean, push
   `check/seo/audit-results` to `backup-gh`. Do not land: the head re-runs the proof and lands.

## Outputs
- the outside skill copy (3 files, one commit there); `skills/programmatic-enterprise-web-performance/` (synced); `skills/SOURCE.md`
- `tools/audit/summary.mjs`, `run.mjs`, `test/run.mjs`, `test/mutate.mjs`, `README.md`, `proof/audit-results.md`
- this file as `work/05-audit-results/CONTEXT.md` (copy it in with the first commit; the status line gets the sha when it lands)
- Nothing else. The book (`docs/product/`), `work/STATE.md`, `factory/`, `supabase/` are other owners' files.

## Proof
- `grep -rn "Omnikom Platform\\\\\(sops\|templates\|docs\)" C:/Users/DELL/.claude/skills/programmatic-enterprise-web-performance skills/programmatic-enterprise-web-performance`
  prints nothing; `diff -rq` of the two copies shows only `.git` and `site-checks`.
- `node skills/programmatic-enterprise-web-performance/scripts/test-launch.mjs` ends with its pass line, exit 0.
- `node tools/audit/test/run.mjs` -> `OK: N of N checks passed`, exit 0 (N grows by the new checks).
- `node tools/audit/test/mutate.mjs` -> `N mutants, N caught, 0 survived, 0 target text missing`, exit 0 (run it through a Haiku
  runner or in the background with a bounded wait; it is long).
- `node tools/audit/run.mjs tools/audit/fixtures/bad-MET-003 --target preview --summary` prints one JSON object with `pass false`.
- `node docs/blueprint/specs/run-all-gates.mjs` green; `gitleaks protect --staged` clean.

## Findings (send to your head, who routes them; never fixed here)
- F1 for platform-build: `factory/runner/publish.mjs:147-151` should run the audit with `--summary` and put the object in
  `gateReport.audit`, so `publish_jobs.gate_report` holds it for every publish (pass and fail).
- F2 for platform-build: a per-site read for the dashboard: the latest summary per site and target (a view over `publish_jobs` or a
  small `site_audits` table), and a signed-in function that returns it under the site's read rule.
- Add anything else you find outside this order here and in your report.
