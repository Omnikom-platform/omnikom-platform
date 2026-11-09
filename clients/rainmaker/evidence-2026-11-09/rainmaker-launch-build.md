# Rainmaker launch build (local clone, built and checked, NOT deployed)

Run 2026-11-09 by the Omnikom Clients builder. Nothing was deployed, no DNS or Cloudflare change, no form submitted, no mail sent. `E:\Rainmaker` was only read (git clone source). All work is in the clone `C:\Users\DELL\AppData\Local\Temp\claude\E--Omnikom-Platform\5568dd25-ad9c-45e5-bebe-627ccdee7af0\scratchpad\golive\rmk-launch` (HEAD 44a7cc7, same commit as `E:\Rainmaker`; site/ at HEAD is identical to site/ at commit 2795017, the final preview e1f42a39).

## Verdict in 8 lines

1. `RMK_LIVE=1 node site-src/build.mjs` builds: 12 pages, exit 0, "(LIVE: indexable)". Building twice gives the same tree hash (3d391fd0d842, 71 files), so the build is deterministic.
2. The live build refuses when the form endpoint is missing (proved by blanking `RMK_FORM_ENDPOINT` in the clone: "BLOCKED ... exit=1"; file restored with `git checkout`, rebuilt, same hash). The endpoint IS set in the committed `config.js`, so the build is not blocked.
3. The build itself does NOT refuse placeholders. The launch deploy script `tools/deploy-live.mjs` does (it checks for them before uploading). Its check, replicated here without a token and without deploying, says BLOCKED: 3 pages still carry placeholders.
4. Placeholders left in the live build: `[PHONE]` x8, `[MAILING ADDRESS]` x4, `[DATE OF PUBLICATION]` x6 (across privacy, terms, insurance-disclosures), plus the visible text "Draft for Rainmaker review" on those 3 pages. `[APPROVED LEGAL ENTITY]`, `[CONTACT EMAIL]`, `[RETENTION PERIOD]` are gone (0). The consent and request texts are still tagged `marketing-consent-draft-3` and `contact-request-draft-1`.
5. Difference between the live build and the committed preview build: one line per HTML page (the robots meta: `noindex, nofollow` becomes `index, follow, max-image-preview:large`); all other 60 files are byte-identical. The 404 page stays noindex by design.
6. Strict SEO gate (programmatic-enterprise-web-performance `gate.mjs`, `--strict`, with the two-build check) on the live build: 14 checks, 14 PASS, exit 0 (POSITION.md said 13/13; the skill has gained GT-014 since). My first run without `--build` printed the NOTE that the two-build comparison was not checked; a run with `--build` is below and passes.
7. Project tests that need no deploy, run against the live build: apps-script 39/39, mutation harness 65/65 caught, ui.e2e ALL PASS, a11y ALL PASS (0 issues, 12 pages x 2 sizes), forms.e2e 40/40, estimator ALL PASS, media ALL PASS (98 photo boxes). The form tests stub the endpoint (the test replaces `config.js` and routes the Apps Script URL to a local stub that runs `Code.gs` in node's vm), so nothing was sent to Google.
8. Not proven here: a real lead alert to Arjely/Mylene, the render-gate (not asked), the live (deployed) behaviour. The strict gate passing does not mean the legal pages are launchable: it does not look at placeholders.

## 1. Setup

The clone has no `site-src/.deps` (git-ignored). I copied the already-installed one from `E:\Rainmaker\site-src\.deps` (esbuild, gsap, lenis, sharp 0.33.5, wawoff2, axe-core; package.json and package-lock.json included). Nothing was installed or upgraded, so the supply-chain rules were not triggered. Known and not acted on: `site-src/SECURITY-NOTICE.md` (untracked in `E:\Rainmaker`, not in the clone) flags sharp 0.33.5; the build only processes our own photos.

```
git clone E:\Rainmaker ...\golive\rmk-launch      (cloned HEAD 44a7cc7)
cp -r E:\Rainmaker\site-src\.deps  rmk-launch\site-src\.deps
```

## 2. Live build

Command (run in the clone):
```
RMK_LIVE=1 node site-src/build.mjs
```
Output:
```
built 12 page(s) -> site (LIVE: indexable)
exit=0
```

Refusal proof (endpoint blanked in the clone's `site-src/js/config.js`, then restored by `git checkout`):
```
sed -i "s#RMK_FORM_ENDPOINT = '[^']*'#RMK_FORM_ENDPOINT = ''#" site-src/js/config.js
RMK_LIVE=1 node site-src/build.mjs
BLOCKED: RMK_LIVE=1 but site-src/js/config.js has no Apps Script URL (RMK_FORM_ENDPOINT). Set it first (integrations/apps-script/SETUP.md).
exit=1
git checkout site-src/js/config.js   -> Updated 1 path from the index
RMK_LIVE=1 node site-src/build.mjs   -> built 12 page(s) -> site (LIVE: indexable), exit 0, tree md5 3d391fd0d842 again
```

Determinism (two builds, md5 of the sorted per-file md5 list):
```
tree md5 build1=3d391fd0d842 build2=3d391fd0d842 file_count=71
```
Per-file manifest: `C:\Users\DELL\AppData\Local\Temp\claude\E--Omnikom-Platform\5568dd25-ad9c-45e5-bebe-627ccdee7af0\scratchpad\golive\launch-build-manifest.md5`.

Difference to the committed preview build (`diff -rq E:\Rainmaker\site site`): only the 11 index.html files of the content pages differ (robots meta line). robots.txt, sitemap.xml, llms.txt, _headers, _redirects, CSS, JS, fonts and images are byte-identical.

## 3. What the launch scripts would refuse (replicated, not run against Cloudflare)

`tools/deploy-live.mjs` exits first if `CLOUDFLARE_API_TOKEN` is unset and then lists "problems" (noindex, endpoint, placeholders). I did not run it (it would deploy). The same check, copied into `launchcheck.mjs` and pointed at the clone's `site/`:
```
BLOCKED: not launchable yet:
  insurance-disclosures\index.html still has [DATE OF PUBLICATION] Draft for Rainmaker review [PHONE]
  privacy\index.html still has [DATE OF PUBLICATION] Draft for Rainmaker review [PHONE] [MAILING ADDRESS]
  terms\index.html still has [DATE OF PUBLICATION] Draft for Rainmaker review [PHONE] [MAILING ADDRESS]
all bracket tokens in site/*.html: {"[DATE OF PUBLICATION]":6,"[PHONE]":8,"[MAILING ADDRESS]":4}
data-version markers: {"contact-request-draft-1":3,"marketing-consent-draft-3":3}
```
So the placeholders to clear before launch: `[PHONE]` (Monica), `[MAILING ADDRESS]` (Monica), `[DATE OF PUBLICATION]` (set when she approves the legal text), plus the "Draft for Rainmaker review" banner text on privacy, terms and insurance-disclosures, and the consent wording that is still "draft-3" / "draft-1".

LAUNCH.md also says: delete the old `www` CNAME (s.multiscreensite.com) and apex A (100.24.208.97) on the Omnikom Cloudflare zone before `deploy-live`, or the custom domains are refused. Read `dns-rwifinancial.md`: today's public DNS no longer matches the zone that note describes.

## 4. Strict SEO gate

Script: `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance\scripts\gate.mjs` (plan dir `.pewp` in the clone, approved targets + plan lock present).

Command (in the clone):
```
node ~/.claude/skills/programmatic-enterprise-web-performance/scripts/gate.mjs .pewp site --strict
```
Output:
```
PASS GT-001 4 clusters, 5 pages, 18 planned links consistent (approved copy, lock ok)
PASS GT-002 all 5 planned pages exist
PASS GT-003 11 pages, no page other than a cluster's planned page competes for its head term
PASS GT-004 4 page(s) carry their query
PASS GT-005 5 page(s) cover their briefs
PASS GT-006 18 planned link(s) present with descriptive anchors, no broken internal links
PASS GT-007 12 pages, all linked and reachable from /
PASS GT-008 5 page(s) carry their planned schema
PASS GT-009 no programmatic pages planned
PASS GT-010 no industry rules selected in business.json
PASS GT-011 the top 4 priority cluster(s) all have a built page
PASS GT-012 4 page(s) fit their cluster's intent
PASS GT-013 11 sitemap URL(s): lastmod format right, no build-clock signature (one build read)
  NOTE the two-build comparison is NOT CHECKED: no build command known (gate.mjs --build "<cmd>"; build-site.mjs reads it from .pewp/builder/build-command.txt)
PASS GT-014 no prompt map in this project (research/prompt-map.json): no prompt rows to cover
PASS gate 14 checks: 14 PASS, 0 FAIL, 0 ERROR
report: C:\Users\DELL\AppData\Local\Temp\claude\E--Omnikom-Platform\5568dd25-ad9c-45e5-bebe-627ccdee7af0\scratchpad\golive\rmk-launch\.pewp\gate\report.md
exit=0
```
Note: the "report:" path shows the gate wrote `.pewp/gate/report.md` inside the CLONE; the original `.pewp/gate` is untouched.

GT-013 two-build comparison. Attempt 1, `--build "node site-src/build.mjs"` alone, did not run (the build child failed with MODULE_NOT_FOUND; the first line of the error is cut off in the gate output, so the exact module is UNPROVEN; it works once the build runs with `--build-cwd` set to the clone folder). Attempt 2 with `--build-cwd` set:
```
node gate.mjs .pewp site --strict --build "node site-src/build.mjs" --build-cwd <clone folder>
PASS GT-001 4 clusters, 5 pages, 18 planned links consistent (approved copy, lock ok)
PASS GT-002 all 5 planned pages exist
PASS GT-003 11 pages, no page other than a cluster's planned page competes for its head term
PASS GT-004 4 page(s) carry their query
PASS GT-005 5 page(s) cover their briefs
PASS GT-006 18 planned link(s) present with descriptive anchors, no broken internal links
PASS GT-007 12 pages, all linked and reachable from /
PASS GT-008 5 page(s) carry their planned schema
PASS GT-009 no programmatic pages planned
PASS GT-010 no industry rules selected in business.json
PASS GT-011 the top 4 priority cluster(s) all have a built page
PASS GT-012 4 page(s) fit their cluster's intent
PASS GT-013 two builds give the same dates
  NOTE 1 sitemap file(s) with 11 URL(s); 17 date field(s) compared
  NOTE the folder had uncommitted changes: built twice in place and NOT restored (a build only rewrites its own output)
PASS GT-014 no prompt map in this project (research/prompt-map.json): no prompt rows to cover
PASS gate 14 checks: 14 PASS, 0 FAIL, 0 ERROR
report: C:\Users\DELL\AppData\Local\Temp\claude\E--Omnikom-Platform\5568dd25-ad9c-45e5-bebe-627ccdee7af0\scratchpad\golive\rmk-launch\.pewp\gate\report.md
exit=0
```
Attempt 1 output, kept for the record:
```
ERROR GT-013 cannot judge: the build failed (exit 1): veForCJSWithHooks (node:internal/modules/cjs/loader:1169:12)
    at Module._load (node:internal/modules/cjs/loader:1341:5)
    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47 {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js v24.22.1
  the folder had uncommitted changes: built twice in place and NOT restored (a build only rewrites its own output)
ERROR gate 1 checks: 0 PASS, 0 FAIL, 1 ERROR
```
The tree hash after the gate's two in-place builds is still 3d391fd0d842.

## 5. Project tests (no deploy needed)

All run in the clone against the live build in `site/`. They serve `site/` themselves on a local port and use Playwright from the render-gate install in `machine.local.json`.

Order and commands: `node tests/apps-script.test.mjs`, `node tests/apps-script.mutate.mjs`, `node tests/ui.e2e.mjs`, `node tests/a11y.mjs`, `node tests/forms.e2e.mjs`, `node tests/estimator.e2e.mjs`, `node tests/media.e2e.mjs` (media with its default: serve site/ locally). The tail of each log (full logs are in the scratchpad `test-*.log`):

### apps-script.test.mjs
```
ok   - client: timeout aborts the request, shows a friendly message and frees the button
ok   - client: an unreadable reply (HTML error page) is a generic error, not a success
ok   - client: placeholder URL sends nothing; browser validation failure sends nothing
ok   - client: the web-app URL appears once, in one constant; no third-party code
apps-script tests: 39 passed, 0 failed, 39 total
exit=0
```
### apps-script.mutate.mjs (watched-fail harness: each mutation must turn a named test red)
```
caught  client: button not freed after error  -> 4 red: client: a server refusal | client: timeout
caught  client: fields not marked invalid  -> 1 red: client: a server refusal
caught  client: HTML reply counts as success  -> 1 red: client: an unreadable reply
caught  client: sends to placeholder URL  -> 1 red: client: placeholder URL
caught  client: browser validation skipped  -> 1 red: client: placeholder URL
caught  client: third-party URL added  -> 1 red: client: the web-app URL appears once
mutations: 65/65 caught, 0 missed
exit=0
```
### ui.e2e.mjs
```
PASS  no page errors (desktop)
PASS  phone: menu button opens the sheet
PASS  phone: sheet shows its links
PASS  phone: Esc closes the sheet
PASS  phone: menu button closes it again
PASS  no page errors (phone)
ALL PASS
exit=0
```
### a11y.mjs
```
=== node tests/a11y.mjs
a11y: ALL PASS (0 serious/critical, 0 minor) on 12 pages x 2 sizes
exit=0
```
### forms.e2e.mjs
```
PASS careers/agent (h) preview mode (preview host, empty endpoint): validates, shows success, sends nothing, logs payload
PASS careers/agent (h2) real domain + empty endpoint: never a fake success, the visitor is told the form is not available
PASS careers/agent (i) required checkbox group blocks the submit until one box is ticked
PASS careers/agent (j) rules agree with Code.gs: same values rejected or accepted by the page and by the server
PASS contact/page (f) contact switch: Enter and Space toggle, aria-pressed flips, right form shows, both forms stay in the DOM, typed text kept
PASS contact/page (g) phone 390px contact/consumer: no horizontal overflow, every field and button at least 44px tall, also with errors showing
PASS contact/page (g) phone 390px contact/agent: no horizontal overflow, every field and button at least 44px tall, also with errors showing
PASS contact/page (g) phone 390px careers/agent: no horizontal overflow, every field and button at least 44px tall, also with errors showing
forms e2e: 40 passed, 0 failed
exit=0
```
### estimator.e2e.mjs
```
PASS  390px: Enter does not leave the page
PASS  390px: no sideways overflow
PASS  390px: nothing sent over the network
PASS  390px: no page errors
ALL PASS
exit=0
```
### media.e2e.mjs
```
=== node tests/media.e2e.mjs
media: ALL PASS (98 photo boxes on 12 pages x 2 sizes)
exit=0
```

Watched-fail: I wrote no new assertions. The apps-script mutation harness is the project's own watched-fail (65/65 mutations turned a test red, 0 missed). The other suites were not re-mutated by me; their earlier watched-fail is recorded in POSITION.md.

## 6. What is still open before the site can go live (facts)

- Placeholders and draft banners on privacy, terms, insurance-disclosures (section 3).
- Public DNS has moved on since LAUNCH.md was written: www.rwifinancial.com already serves a copy of this site from a different Cloudflare zone (jaxson/alina), not deployed by `deploy-live.mjs`. Read `rainmaker-live-vs-build.md` and `dns-rwifinancial.md` before any step in LAUNCH.md.
- UNPROVEN here: a real lead alert, the render-gate, anything on a deployed host.
