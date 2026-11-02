# 5-L round 2: the test site's form answers 503 "not configured"; prove it, configure the preview, and make publish refuse an unconfigured lead endpoint

Head: `HEAD_Platform-build_2026-11-01d` (report by SendMessage). Builder: Sonnet, effort high. Written 2026-11-02 04:24.
Slice 5-L (brief `factory/briefs/5-L-form-lead-no-js.md`) landed as a2570e2 and the test site was republished from it (job
fb0be493-c25c-4271-8d61-80a5da1fadb2, deploy ce3eb1fa). The CLI journey then failed:
`J5 FAIL lead through the site form: the form answered HTTP 503 "We could not send this ... Please call or email us."; lead rows with the marker: 0`.
The only 503 is `factory/worker/lead-endpoint.mjs:88`: `if (!siteId || !signingKey || !platformBase) { log('lead endpoint not configured'); return reply(503, ...)`.
`factory/worker/pages-function-lead.js:9` reads `env.SITE_ID`, `env.SITE_SIGNING_KEY`, `env.PLATFORM_BASE` from the Pages project.
`tools/mint-site-key.mjs` mints a site's signing key and appends it to the master env file as `SITE_SIGNING_KEY_<SLUG>` (read its header).

## Done when (head of operations, 04:22; all four)
1. **The cause is proven.** Read the Pages project `test-site-demo-a` settings through the Cloudflare API with the keys loaded by
   `tools/with-env.mjs` (variable NAMES and their type only, never a value), for the environment the preview uses (the preview
   branch deploys to the project's PREVIEW environment). Paste which of SITE_ID, SITE_SIGNING_KEY, PLATFORM_BASE are present. If you
   can read the Function log for "lead endpoint not configured" too, paste that line.
2. **The preview has all three.** SITE_ID = the test site's id on staging (`sites` row of workspace A), PLATFORM_BASE = the staging
   functions base the other tools use (name in `docs/blueprint/13-DATA-MODEL.md` section 8), SITE_SIGNING_KEY = the key whose hash
   the staging `api_keys` registry holds for that site (if no usable key exists, mint one with `tools/mint-site-key.mjs` the way its
   header says; the secret value goes from the env file to Cloudflare in a script, never printed, never written anywhere else).
   Set them on the test project's preview environment only (`test-site-demo-a` is ours: DECISIONS 48 (e)). STOP and report if the
   fix needs any other project (production, a client's), a new Cloudflare resource, or a DNS change.
3. **Publish refuses an unconfigured endpoint.** In `factory/runner/publish.mjs`, before the deploy step: when the build ships the
   lead function (`lead.js`), check through the Cloudflare API that the target project and environment (preview or production, the
   same decision the deploy uses) has all three names set; if any is missing, stop at gating with a worded line naming the missing
   names (no value), and deploy nothing. A runner test watched red (a fake project missing one name: refused, nothing deployed; all
   three: allowed) in `factory/runner/test/run.mjs`, and a mutant in `factory/runner/test/mutate.mjs` (the check removed) caught.
   Fake the Cloudflare call the way the runner tests already fake wrangler (`RUNNER_WRANGLER_SCRIPT` style); no real API in tests.
4. Republish the test site (the head runs it) and the CLI's `omnikom test journey --target staging --only J5,J6,J7` PASSES.
   You prepare and prove 1 to 3; the head runs the republish and asks CLI-d for 4.

## Rules
Keys by variable name only: load with `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- <command>`; never print,
copy, store or list a value or that folder's contents. Code changes in a worktree of `backup-gh/master` (a2570e2 or newer), never the
shared tree; never commit or push. The Cloudflare settings change in item 2 is the one live action allowed, on the test project only.
Scripts in files, not `node -e`. Heavy runs through `node "$HOME/.claude/scripts/heavy.mjs" --label "<name>" -- <command>`. No em dashes.
Anything outside this brief is a finding you send back, not a fix.
