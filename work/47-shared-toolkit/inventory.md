# What is duplicated on master, 2026-11-11 (master 613bae0)

Counted read-only by a reader agent for the head of operations, without CLI's own list. Paths are `file:line`.
"kit" = belongs in `tools/kit/` under work order 47; "later" = real duplication, not this order.

## Browser launch (kit)
Seven independent launchers, none shared:
- `tools/omnikom-cli/lib/browser.mjs:27-39, 163-216` (own CDP class at :42); caller `commands/journey.mjs:25`.
- skill `scripts/cdp-measure.mjs:12-19, 29-109` (own inline CDP); callers snapshot-site:36, ref-visual:27, ref-sw:128,
  plan-picture:148, doctor:19.
- skill `scripts/lib-shots.mjs:51-65` (Playwright through `renderGate` of `~/.claude/machine.local.json`); callers
  writing-gate:33, wf-shots:19, section-shots:22.
- `tools/design-engine/lib/browser.mjs` (wraps lib-shots and proc-guard); callers ref-capture:21, ref-fixed:29,
  render-asset:21, craft-lint:215.
- `tools/site-backup/lib.mjs:120` `loadPlaywright`; launches at backup:589, verify:171, view:38, test-loaders:25.
- `tools/client-questions/questions-pdf.mjs:47-49`.
- `clients/paragon/private/audit-2026-11/build-pdf.mjs:14-23` (git-ignored, spawns chrome).
Profile seeding (`Local State`): on no tracked file of master 613bae0; it arrives with CLI's browser seed and the skill
sync in land train a. After the kit, one seeded launcher is the only one.
Not in CLI's list: the git-ignored `build-pdf.mjs` and the `design-engine/lib/browser.mjs` wrapper.

## Polite fetch (kit)
- skill `scripts/snapshot-site.mjs:98-135` with `lib-polite.mjs:8-11` (10 skill scripts import lib-polite).
- `tools/site-backup/backup.mjs:65-123` (own 429 counter) and `verify.mjs:30-50`.
- skill, each with its own loop: `authority-lib.mjs:253`, `research-competitors.mjs:40,219`, `research-forums.mjs:28`,
  `research-ai.mjs:51`, `research-bing.mjs:80`, `research-gsc.mjs:29`, `research-wiki.mjs:25`.
- A `Stop429` error is declared four times with different shapes: `migrate.mjs:30`, `psi.mjs:39`, `ref-lib.mjs:12`,
  `sitemap-check.mjs:46`.
- `tools/audit/metrics/{pagespeed:42, bing:30, search-console:16}` with `util.mjs:23`, against skill `psi.mjs`,
  `measure-sources.mjs`, `research-bing`, `research-gsc` on the same endpoints.
- `tools/design-engine/{basemap:34, commons-find:6, fetch-fonts:21}`: no 429 handling at all.
- At least 14 separate user-agent constants.
HTTP callers on master that CLI's fetch list does not name: skill `authority-lib`, `migrate`, `psi`, `research-bing`,
`research-forums`, `research-gsc`, `research-wiki`; `sites/test-demo-a/{publish,upload-logo}.mjs`;
`supabase/{check,set}-auth-settings.mjs`, `supabase/ops/prove-link-life.mjs`; the `tools/audit/metrics/*` collectors.

## Robots, sitemap and HTML parsing (kit)
- robots: `snapshot-site.mjs:153/168`, `sitemap-check.mjs:65/77`, `authority-lib.mjs:205/217`, `compare.mjs:35`,
  `launch.mjs:384`, `research-competitors.mjs:84` (near-identical loop, different return shapes).
- `<loc>` regex in 8 files; an HTML `decode` defined 10 or more times; `attr` / `attrOf` 8 or more times.
- `tools/audit/lib/site.mjs` and skill `lib-site.mjs`: near-identical ("Copied from ... 2026-10-30").
  `tools/audit/lib/lines.mjs` and skill `lib-lines.mjs`: byte-identical, the only identical pair.
  `tools/audit/lib/sitemap-lastmod.mjs` and the skill's built-in lastmod check: derived, 68 lines apart.

## Checkpoint and resume (kit)
`tools/site-backup/backup.mjs:16,61,524` (`report.json`, `--resume`); skill `start.mjs:20` with `state.mjs` (`state.json`);
skill `cache.mjs`. Three shapes for one job. The SEO head also logged that `authority.mjs` needs a checkpoint.

## Process kill and locks (kit: use proc-guard everywhere)
`tools/proc-guard/index.mjs:73-90` is the one good implementation (9 callers); no skill script imports it. Own kill code:
`refactor.mjs:192` and `launch-workers.mjs:28` (byte-identical bodies), `start.mjs:548`, `cdp-measure.mjs:43`,
`tools/audit/live.mjs:56`, `tools/departments/builder-lib.mjs:160`, `lib-freshness.mjs:276`.

## Env and keys (later)
`tools/omnikom-cli/lib/with-env.mjs:42-44`; skill `lib-env.mjs:49` (different precedence: process env wins);
`tools/check-api-keys.mjs:8` (its pattern rejects names with digits) and `check-platform-keys.mjs:8`; four writers
(`commands/key.mjs:93`, `mint-site-key.mjs:35,59`, `lib/mfa.mjs:32`, `tools/lib/bank.mjs:10`). `machine.local.json` is
read in 8 places.

## Staging and database helpers (later; platform's and CLI's)
- `pgEnv` byte-identical in `omnikom-cli/lib/sql.mjs:12-24`, `supabase/ops/alerts.mjs:35-46`, `backup.mjs:82-94`,
  `restore-drill.mjs:49-60`.
- psql spawned with the URL on argv in 12 files; the Supabase host composed in 8 or more.
- A throwaway Postgres cluster is started in 8 places; the e2e `call()` is byte-identical in three files.
- `tools/mint-site-key.mjs` and `commands/key.mjs` do the same job; `deploy-functions.mjs` generalises
  `deploy-capture-lead.mjs`, which stays.

## Test harness (later)
At least 12 `mutate*.mjs` runners print the same verdict line; `check()` is defined in 58 test files; only `planShard`
is shared by import.

## Not reachable through the `omnikom` CLI
85 non-test scripts under `tools/` have no verb (17 at the root of `tools/`, 13 in `audit`, 8 each in `client-infra` and
`design-engine`, 9 each in `departments` and `site-backup`, the rest in smaller folders), and the skill's 139 scripts had
none on master 613bae0 (`omnikom seo run` in train a is their first). `skills/sync-skill.mjs` copies one way from the
outside repository; no test compares `tools/audit/lib/*` with the skill.

## Could not determine
Which of the parsers are forks of one another and which only look alike; callers outside the repository.
