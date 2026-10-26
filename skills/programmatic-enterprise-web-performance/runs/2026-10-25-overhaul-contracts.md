# Overhaul 2026-10-25: shared contracts between the builder packets

Branch `overhaul-mode`, worktree `C:\Users\DELL\.claude\skills-work\pewp-overhaul`. Brief: `C:\Users\DELL\.claude\briefs\pewp-overhaul-2026-10-25.md`.
Every builder: edit ONLY the files its packet owns; never `git commit` (the orchestrator commits); never add a dependency (Node stdlib only, as the
whole skill is); never print or store a key or token value; tests block non-local network and use fixtures; every new assertion has a
watched-fail mutant (break the code, see it red for the right reason, restore) in the test file the packet owns; new CLI scripts follow
`lib-main.mjs` `isMain` + `--help` like their siblings so `node scripts/test-main.mjs` stays green; owner-facing text in plain words.
"Owner" = the business owner who approves; "main session" = the Claude session running the skill; scripts never prompt.

## C1 approve.mjs kinds (owner: packet F)
`node approve.mjs <target> <kind> --by NAME` with kind in `targets | plan | business | competitors | seeds`.
| kind | source | approved copy |
|---|---|---|
| business | `<pewp>/business.json` | `<pewp>/approved/business.json` |
| competitors | `<pewp>/research/competitors-proposed.json` | `<pewp>/approved/competitors.json` |
| seeds | `<pewp>/research/seeds.json` | `<pewp>/approved/seeds.json` |
`approved/lock.json` gains a sha256 entry per kind (`lock.business`, `lock.competitors`, `lock.seeds`), same diff/sign/exit-code behaviour as today
(0 approved or unchanged, 1 invalid, 2 missing, 3 diff shown not signed). Refusals (exit 1, message says how to fix):
- business: any owner-only field (`kind, offer, audience, goals, competitors, brand.constraints, vocabulary`) whose `provenance.<field>` is not `"owner"`.
- competitors: a row without `evidenceUrl`, `kind`, `closeness` (1..5), or without both `domain` and `handle`.
- seeds: a query without `from` (where it came from).
A helper `approvedMatches(pewp, kind) -> { ok, reason }` (exported) says whether the approved copy is current (sha of source == lock entry).

## C2 intake provenance (owner: packet F)
`<pewp>/intake-answers.json` values are either bare (legacy) or `{ "value": <v>, "answeredBy": "owner" | "site" | "default" }`.
intake.mjs writes `business.json.provenance = { <field>: "owner" | "site" | "default" | "unstated" }` for every field it fills
(bare legacy answer = `"unstated"`; a fact read from the site = `"site"`; a default = `"default"`). New owner fields: `vocabulary: string[]`
(the words the business and its readers use; asked as a question; owner-only) and optional `notOffer: string` (what it is not).
New kind option `editorial-media` ("publisher or media platform with paid features") and `KIND_BY_TYPE` NewsMediaOrganization / Periodical / Blog ->
`editorial-media`; industry follows the kind when `rules/industries/editorial-media.json` exists (packet I writes that file).
Multi-region businesses (G16): a location whose `name` has " and ", "&", ";" or two or more commas is a label, not a place: the default
`rankTracking.locations` then comes from `serviceArea` (first three), never from the name.

## C3 competitors proposed file (owners: packet F writes it via competitors-discover.mjs; packets D and F read it)
`<pewp>/research/competitors-proposed.json`:
`{ step:"competitors-discover", generatedAt, business:"<domain>", source:["inputs/competitors-social.md", ...], rows:[ { name, domain|null, handle|null,
platform:"web|instagram|tiktok|youtube|substack|newsletter|facebook|pinterest|x|other", kind:"publisher|social-curator|paid-media|agency|brokerage-program|
design-broker|marketplace|other", evidenceUrl, closeness:1..5, note } ] }` plus `competitors-proposed.md` (a table the owner reads).
`competitors-discover.mjs <target> --cwd DIR [--candidates FILE.json]`: reads `<pewp>/inputs/competitors-*.md` tables and/or `research/competitors-candidates.json`
(written by the discovery agents), validates and normalises rows, writes the two files; with nothing to read it exits 3 with the discovery brief for the
main session (search every kind: websites that rank, Instagram/TikTok/YouTube/Substack accounts, paid media, agencies, brokerage programs; one evidence URL per row).
Downstream: the approved list is `<pewp>/approved/competitors.json`; its rows WITH a domain are the competitor domains for research-competitors.mjs
(`--approved-competitors <file>`), authority.mjs (`--approved-competitors <file>`) and start.mjs; rows without a domain stay in reports and the offsite plan only.

## C4 env file (owner: packet B)
`scripts/lib-env.mjs` exports `loadEnv({ envFile, pewp, cwd }) -> { file: <path|null>, loaded: [names], skipped: [names already set], source:
"--env-file" | "state.json envFile" | "machine.local.json envFile" | "none" }`. Precedence: explicit `envFile` arg > `<pewp>/state.json` `envFile` >
`~/.claude/machine.local.json` `envFile`. Parses `KEY=VALUE`, `export KEY=VALUE`, quotes, `#` comments; never overrides a variable already set;
never logs a value. Every CLI that reads keys accepts `--env-file <path>` through a shared helper `envFileArg(argv)`; start.mjs loads it once at
startup (children inherit process.env) and passes `--env-file` to doctor. `doctor.json` gains `env: { file, loaded:[names], source }`,
`sources[].setBy` ("env file <path>" | "process environment" | "token file <path>") for every key-based source including `gemini-terms` (G15),
and `inputs: { envFileSha1, tokenFileSha1 }` so a reader can tell when the doctor result is stale (G18). New sources: `psi` (PSI_API_KEY),
`search-console` also connected when `GSC_SERVICE_ACCOUNT_FILE` or `GSC_SERVICE_ACCOUNT_JSON_B64` is set (packet C reads them).

## C5 Google service account (owner: packet C)
`scripts/lib-google-auth.mjs` exports `getGscToken({ env = process.env, tokenFile } = {}) -> Promise<{ token, source, expiresAt }>`:
1 `GSC_SERVICE_ACCOUNT_FILE` (path to the JSON) or `GSC_SERVICE_ACCOUNT_JSON_B64` -> RS256 JWT (node:crypto `createSign("RSA-SHA256")`, scope
`https://www.googleapis.com/auth/webmasters.readonly`, aud `https://oauth2.googleapis.com/token`, 1 h) -> access token, cached in memory only;
2 else the existing token file (`GSC_TOKEN_FILE` or `~/.config/pewp/gsc-token.json`, access_token or refresh_token flow). `GSC_TOKEN_URL` stays the test hook.
research-gsc.mjs and measure-sources.mjs call this one function (the duplicated code goes). For the sitemap submit (packet K) the scope parameter
`scope` is accepted (`webmasters` for write). Tests: `test-google-auth.mjs` (a local fake token endpoint, a generated RSA key, verifies the JWT
header/claims/signature, the cache, and that no key material appears in any output or file).

## C6 causes map (owner: packet J)
`causes-map.mjs <repo> --live <snapshot>/.checks/causes.json [--out <repo>/.checks/causes.json]`: a live cause whose `rules` intersect a repo cause's gets
`liveEvidence: { pages, findings, snapshot }` on that repo cause; a live cause with no repo match is appended as `{ id:"L01".., origin:"live", severity,
rules, fixAt:"UNKNOWN: find the source of this live finding", problem, fix, pages, findings, scripts:[], liveChecks:[<paths of the snapshot check scripts>] }`.
refactor.mjs accepts `origin:"live"` causes: the worker prompt carries the live evidence; proof = the live check script run against the worktree's built
output when it takes a root folder, else the cause is `NEEDS-PROOF` (never FIXED without a check). New flags: `--max-parallel N` (alias of `--parallel`),
`--project-merges` (the report says merges go through the project's own gate; the integration branch is still made, nothing else changes),
`--setup`/`--build` as today. Owner-facing words: "fix run".

## C7 page plan words and picture (owner: packet G)
Owner-facing words: `plan/sitemap.json` is "the page plan" everywhere a person reads (summary.md, reports, stage files, start plan lines);
`sitemap.xml` is "the sitemap file search engines read". `plan-picture.mjs <pewp> [--out-dir <pewp>/plan]` writes `plan/page-plan.svg` (built in Node,
boxes = pages under their parent, each with path, target search, volume, NEW/EXISTING), `plan/page-plan.png` (the SVG rendered by headless Chrome through
`cdp-measure.mjs` `launchBrowser`; no Chrome = PNG BLOCKED, SVG still written, exit 0) and `plan/page-plan.md` (short table). plan-site.mjs:
`--require-approved-business` refuses (exit 1, how to fix) when `approved/business.json` is missing or differs from `business.json` (C1 helper).
report-live.mjs: prints the date of the doctor result it used and says STALE when doctor.json `inputs` hashes differ from the current env/token files
(G18); shows lab speed and PSI side by side, PSI as the trusted number when the lab run is UNTRUSTED (reads `_site.json.machineLoad` and `<pewp>/psi/<date>.json`, C8).

## C8 speed trust (owner: packet H)
snapshot-site.mjs samples CPU use (`os.cpus()` deltas every 2 s during the measured runs) and writes `_site.json.machineLoad = { cpuPctAvg, cpuPctMax,
samples, thresholdPct: 35 }` and per page `speedTrust: "trusted" | "UNTRUSTED: machine busy (cpu avg N%)"`. `psi.mjs <url>... --cwd DIR [--strategy mobile,desktop]`
calls PageSpeed Insights v5 with `PSI_API_KEY` (BLOCKED exit 3 without it), 1 request per 2 s, writes `<pewp>/psi/<date>.json` `{ pages:[{ url, strategy,
performance, lcpMs, cls, tbtMs, fetchedAt }] }`; key never stored (redacted from cache like Bing).

## C9 sitemap file check and submit (owner: packet K)
`sitemap-check.mjs <live url> --plan <approved/plan/sitemap.json> [--gap-ms 1000] [--max-urls 500] [--exclude re]`: reads the live sitemap(s), then every
URL politely (GET, honest UA, robots obeyed, first 429 = exit 3): every sitemap URL is in the page plan, answers 200, has no noindex, canonical = itself;
every indexable planned page is in the sitemap; lastmod not the build clock (all equal to the same minute, or in the future = FAIL) -> `<pewp>/sitemap/check-<date>.{json,md}`,
exit 0 PASS / 1 FAIL. `sitemap-submit.mjs <live url> --sitemap <sitemap url> [--engines gsc,bing]`: refuses (exit 1) without a same-day PASS; GSC
`PUT https://www.googleapis.com/webmasters/v3/sites/{site}/sitemaps/{feed}` (token via `getGscToken({scope:"webmasters"})`), Bing
`POST .../SubmitFeed?siteUrl=&feedUrl=&apikey=`; both responses recorded in `<pewp>/sitemap/submit-<date>.json` (status, body head, no key). Live API shapes UNPROVEN: say so in the header.

## C10 start.mjs (owner: the orchestrator, Fable)
New mode `overhaul <url> <repo>`; `--env-file`; plan ack (G13: `--ack plan-ok --by NAME` or `--yes` before a stage with external calls or agent workers);
run files `<pewp>/runs/<date>-<mode>[-<stage>].md` written at every end or stop (G14); `--build`, `--setup`, `--max-parallel`, `--project-merges` passed to refactor.
