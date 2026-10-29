# Stage: launch (mode `launch <target>`)

Load this file when a built, gated preview must become the production site ("launch it", "go live", "make it production").
It runs after `build` (or `overhaul`) and before `measure`. The SOP in plain words, with every item and the access list:
`E:\Omnikom Platform\sops\launch.md`. Architecture: `E:\Omnikom Platform\docs\blueprint\12-LAUNCH.md` (DECISIONS 19).

## What it is
A ledger, `<pewp>/launch.json`, with 22 items (L-A1 to L-D22: A before launch, B launch day, C first 30 days off-site, D ongoing).
Each item has its "done when" and its proof: an automated check, a site-specific command, or OWNER-PROOF (a screenshot or URL the
owner gives, for Search Console, Business Profile and the Rich Results Test, which have no API). One agent works the ledger in
one session until the stop condition holds.

## Run it (the main session)
`<pewp>` is `site-checks/<host>/.pewp`. Every command: `node "<skill>/scripts/launch.mjs" <mode> <pewp> ...`. Run from PowerShell.
1. **Init.** `--init <pewp> --site-url https://www.<domain>/ --pages <one URL per template, comma-separated> --site-dir <launch build>
   --redirects <_redirects or JSON map, or "none: <reason>"> [--waive <ids signed off>] [--build "<launch build cmd>"]
   [--build-cwd DIR] [--old-origin URL] [--sitemap-url URL] [--detailed-seo <CLI path>] [--omnikom-user <email>]`.
   Writes every item OPEN. `--force` starts over (the old ledger is kept). Later edits: `--config <pewp> key=value ...`
   (e.g. `gate.siteDir=...`, `pages=a,b`, `commands.L-A1="<cmd that exits 0 when 0 questions are open>"`).
2. **Access.** `--access <pewp>` prints the owner access checklist and writes `<pewp>/launch/access-questions.json` (AskUserQuestion
   shape: header, question, 4 options with label and description; at most 4 questions per call). Ask them as pickable options;
   record each answer: `--access-set <pewp> <key>=granted|pending|client|na --by "<owner>"`. The script never prompts.
   Never send passwords: omnikom is added as a user.
3. **Task.** `--task <pewp>` prints the one-shot brief. Start ONE agent with it (general-purpose). It loops: `--check`, fix the
   cause, `--record` an owner proof, `--block` with an allowed reason, `--check` again.
4. **End.** `--status <pewp>` exits 0 only at the stop condition. Report the last `--check` output, pasted. Proof file:
   `<pewp>/runs/<date>-launch.md`.

| Exit (`--check`, `--status`) | Last line | Do |
|---|---|---|
| 0 | `LEDGER DONE: n PASS, m BLOCKED (allowed) ...` | report it; the BLOCKED items and what unblocks each are the owner's list |
| 3 | `LEDGER OPEN: ...` | keep working: each OPEN or FAIL line says what it needs |
| 2 | `usage error: ...` | fix the command (a refused block or record also ends here: its reason did not hold) |
| 1 | `launch.mjs crashed` | read the stack; do not paper over it |

## The stop condition
Every item is PASS with its proof line, or BLOCKED with an allowed reason and what unblocks it. Nothing else ends the task.
Allowed reasons: `owner-access` (an access key from `--access`, or `owner-click` for an outward action: DNS change, going live,
sending), `client-answer` (must name Q-n), `owner-proof` (only items with an OWNER-PROOF slot whose checks do not fail),
`third-party-outage` (expires after 24 h), `not-yet-due` (set by the script: C and D items before launch day + 7, 28 or 30 days).
A block is re-tested on every command: it stops holding when the access is recorded as granted (or not used), the outage is
older than 24 h, or the due date passes.

## The checks (`--check` runs all of them every time)
| Check | Item | Passes when |
|---|---|---|
| gate | L-B7 | `gate.mjs <pewp> <launch build> --strict` exits 0 (report in `<pewp>/launch/gate/`). Always strict; waivers only from `--waive` |
| live-headers | L-B8 | every page: 200 with no redirect, no noindex/none in `X-Robots-Tag` or a robots meta, robots.txt allows it for Googlebot and Bingbot, `nosniff`, HSTS and `Cross-Origin-Opener-Policy` (COOP) on https |
| canonical | L-B10 | every page: canonical = the URL, one H1, a title of 1-60 characters |
| detailed-seo | L-B10 | when the CLI is present (`--detailed-seo`, e.g. `E:\Alex Sevilla\tools\detailed-seo\run.mjs`; same `<url> --out <dir>` shape, reads its `data.json`): its panel agrees. Absent: `detailed-seo NOT RUN`, not a failure |
| psi | L-B9 | PageSpeed Insights v5, every page, mobile and desktop: performance 90+, accessibility, best practices and SEO 100. Key: `PSI_API_KEY` (env or `--env-file`), never printed or stored, scrubbed from Google's errors. No key: BLOCKED `owner-access psi-key`. 429/5xx: BLOCKED `third-party-outage`. Every answer is saved (scrubbed) as `<pewp>/launch/psi/psi-<strategy>-<page>.json` for the `writing` check |
| writing | L-B9 | `scripts/writing-gate.mjs` on `gate.siteDir` with `--url <site url>`, the ledger's pages and `--psi-dir <pewp>/launch/psi`: the 7 writing rules WG-1..WG-7 of `stages/build.md` (render-blocking CSS, unused CSS <= 20%, image sizes, forced reflow, ARIA roles, `/llms.txt`, HSTS + COOP) all PASS; the proof line is the gate's summary. FAIL names the rule (`FAIL WG-n` lines); a rule that could not run (no browser, a page not in the build) leaves the item open (`NOT RUN`). `--config writing.viewports=390x844` narrows the browser runs |
| redirects | L-A6 | every static rule of the map answers 301 with a Location equal to the target; pattern rules (`*`, `:name`) NOT CHECKED |
| sitemap | L-B11 | the sitemap file: 200, urlset or sitemapindex, at least one `<loc>`, all on the site's host |
| command | L-A1 | `commands.<id>` exits 0; its last line is the proof line |
`--psi-fixture FILE` answers PSI from a file (`{"mobile": <v5 answer>, "desktop": ..., "<strategy> <url>": ...}`). It is refused
unless the site is on a local host: a fixture never proves a live site. `--only L-B8,L-B9` limits a run. `--gap-ms` paces requests
to the site (default 1000). `--today` fixes the date (tests).

## Rules
- PASS comes only from `--check` (with the check's own output line) or `--record` (the owner's screenshot or URL; a file is hashed
  and reopens its item if it changes). A PASS without its line is not accepted. Never edit `launch.json` by hand.
- Outward actions (DNS, going live, sending, account settings) are the owner's click: prepare, then block `owner-access owner-click`.
- Read only on third-party sites. First rate limit or robot check: stop that host.
- This stage never deploys and never changes DNS.

## Not built
- NOT BUILT: `start.mjs launch <target>` (run `launch.mjs` directly); checks for email DNS records, the test lead (L-A2) and CrUX
  (L-D20), which are OWNER-PROOF; a platform view of the ledger.
- UNPROVEN: the live PSI call and the real Detailed SEO CLI through `launch.mjs` (tested against a fake endpoint and a stand-in); the `writing` check against a live https host (tested on 127.0.0.1: HSTS and COOP on https are proven only by the `live-headers` unit test and the `_headers` file check).
- NOT DONE: a run on a real site.

## Proof
`node scripts/test-launch.mjs` (+ watched-fail mutants built in; `--no-mutants` skips them). Local only: a fixture site on
127.0.0.1, a fixture PSI file, a fake PSI endpoint, a stand-in Detailed SEO CLI, and the real strict gate on the skill's plan
fixtures; a network guard refuses and logs any non-local request. Counts come from its output. The `writing` check runs for real in
it (Chromium from the render-gate install, through a fake HOME that names only that path; the launch build is the clean plan fixture
plus an `/about/` page, `llms.txt` and `_headers`). Most of its writing runs use `LAUNCH_WRITING_ONLY` (static rules; a test knob that can
FAIL but never PASSes). The 7 rules themselves are proven by `node scripts/test-writing-gate.mjs`.
