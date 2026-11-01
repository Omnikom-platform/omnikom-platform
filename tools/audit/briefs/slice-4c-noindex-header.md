# Brief: audit slice 4c, the noindex header and the build target (Sonnet builder; one slice, discarded when done)

Department: SEO and audits (`docs/departments/seo-and-audits.md`). Report to the head that started you. Anything outside this brief is a
finding, not a fix. Read `tools/audit/README.md`, `tools/audit/briefs/slice-2-live-and-speed.md` (snapshot mode) and the slice 4b brief
for the shape of a rule. Today: 28 rules, `test/run.mjs` 486 checks, `test/mutate.mjs` 349 mutants, `build-fixtures.mjs --check` 123.

## Why
The first real live run (2026-11-01, PROGRESS "the first real live run") audited a preview whose every page answers
`x-robots-tag: noindex`, and no rule saw it: `page.noindex` is read from the meta robots tag only (`lib/site.mjs:122`). A production
site hidden by that header would pass all 28 rules: a P0 gap. The factory keeps a preview out of the index with that header on purpose
(`factory/lib/launch.mjs` `headersText`: `/*` then `  X-Robots-Tag: noindex, nofollow` when preview), so the rule must know which
kind of build it judges. Head of operations' decision (2026-11-01): it works both ways, with an explicit target and no default.

## What to build
1. **Snapshot mode reads the header.** Each page's `response.json` headers: `x-robots-tag` (any case; several values or a
   `googlebot:` prefix count, a value for another named bot does not) joins meta robots in `page.robots`, and `page.noindex` follows.
   Do the same in the skill's SOURCE `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance\scripts\lib-site.mjs` (the
   same function, line ~120; slice 2 carried changes this way), not in the repo copy under `skills/`; the head commits and syncs.
2. **Folder mode reads `_headers`** (Cloudflare Pages format: a path pattern at column 0, then indented `Name: value` lines; `*` splat,
   `:name` placeholder, `! Name` detaches a header). Match each built page's URL path; a pattern you cannot match exactly is not judged
   and the rule file says so.
3. **A build target**: `audit(dir, { target: "preview" | "production" })`, `run.mjs --target preview|production`, and
   `live.mjs --target ...` (passed through). Anything else is a usage error (exit 2).
   - `target: "production"`: header noindex feeds `page.noindex` (so IDX-001 and the rest judge what Google will see).
   - `target: "preview"`: the header noindex is expected and does NOT feed `page.noindex` (the other rules judge the site as it will be
     in production); a meta robots noindex still does.
   - no target (until the factory passes one): folder mode ignores the header and the new rule prints one SKIP line `no --target`;
     snapshot mode feeds the header into `page.noindex` (it is what the live site says). The head turns "no target" into a usage
     error in folder mode once the factory passes it; write the code so that is a one-line change, and say where.
4. **New rule ENV-001 (P0): the build's indexing matches its target.** Source line:
   `factory/lib/launch.mjs headersText and factory/README.md (robots.txt always Allow, the preview kept out by X-Robots-Tag; head, 2026-10-31); head of operations, 2026-11-01 (slice 4c)`.
   - preview: every HTML page carries noindex (header or meta); FAIL per page that does not ("a preview would be indexed").
   - production: no HTML page carries a header noindex; FAIL per page that does (the meta noindex of a deliberately unlisted page
     stays IDX-001's business, not this rule's). 404 pages are out of scope (IDX-006).
   - Every finding names the page, the source of the noindex (`_headers` pattern and line, or the response header), and the target.
5. Fixtures from `build-fixtures.mjs`: `bad-ENV-001-preview` (a `_headers` with no noindex, judged with target preview),
   `bad-ENV-001-production` (a `/*` noindex header, judged with target production), and a snapshot one
   `snapshot-bad-IDX-001-header` (pages listed in the sitemap whose response answers `x-robots-tag: noindex`, no target: IDX-001
   FAILs). The harness needs a way to pass a target per fixture: add it next to `also`/`multi`, never by loosening the one-rule check.
   `fixtures/good` and `snapshot-good` stay all-PASS (with no target, ENV-001 SKIPs). `good` also passes with target production; a new
   `good-preview` (good plus a `/*` noindex `_headers`) passes with target preview.
6. Tests, each watched red (empty the code, see the FAIL for the right reason, restore), and a mutant in `mutate.mjs` for each:
   snapshot header feeds noindex; googlebot-prefixed value counts, another bot's does not; `_headers` splat match; `! Name` detach;
   preview missing noindex FAILs; production with noindex FAILs; target preview does not feed IDX-001; bad `--target` exit 2.

## Do not break the factory gate
`factory/test/run.mjs` calls `AUDIT.audit(dir)` with no target on preview and live builds (lines ~231-322) and expects 0 FAIL; the
runner calls `node tools/audit/run.mjs <work>/dist`. With no target nothing there may change. Run `node factory/test/run.mjs` once at
the end (light) and paste its last line. Do not edit `factory/`, `sites/` or anything outside `tools/audit/` and the one skill file.

## Done when (paste real last lines)
```
node tools/audit/test/run.mjs                                   OK: N of N (N > 486), exit 0
node tools/audit/run.mjs --list                                  29 rules
node tools/audit/fixtures/build-fixtures.mjs --check             OK: N fixture(s) equal the generator output
node tools/audit/run.mjs tools/audit/fixtures/good --target production   OK, 0 FAIL (good is a production build)
node tools/audit/run.mjs tools/audit/fixtures/good-preview --target preview   OK, 0 FAIL (new: good plus a /* noindex _headers)
node factory/test/run.mjs                                        OK: 88 of 88
```
plus one watched-red FAIL line per new test. Do NOT run the full `mutate.mjs`, `run-all-gates`, a live site or a browser: the laptop has
a heavy-job lock and the heavy proof runs on GitHub. `MUTATE_ONLY` for your new mutants is allowed through the lock:
`node ~/.claude/scripts/heavy.mjs -- env MUTATE_ONLY='<regex>' MUTATE_JOBS=1 node tools/audit/test/mutate.mjs`.

## Rules
- Edit only `tools/audit/` and the one skill source file. Node built-ins only. Scripts in files, never inline `node -e`. No em dashes.
- Stop only processes you started, by PID. Delete only folders your runs made.
- No commits, pushes, stashes, resets or branch switches. Add a block "## SEO and audits, slice 4c: the noindex header and the build
  target (<date time>, builder)" above the slice 4b.1 block in `docs/blueprint/PROGRESS.md` with real outputs and UNPROVEN where needed.
