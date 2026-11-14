# tools/golive

The go-live pipeline's site tools. The pipeline is the platform's and is the same for every site; everything that differs per site is one `golive.site.json`, and a manifest holds no secret.

## site-manifest

`node tools/golive/site-manifest.mjs <file> [--base <folder>]` checks one manifest against the schema and refuses everything else. Exit 0: valid (stdout `OK: <file>: manifest valid`). Exit 1: refused, one line per fault on stderr, stdout empty. Exit 2: usage (the base is checked before the file is read). Later jobs import `checkManifest(file, base)`, which returns `{ manifest, faults }` (`manifest` is null when `faults` is not empty).

A refusal line is `REFUSED: <file>: <path>: <text>` (root keys have the bare key as path); lines come in schema order, one per fault, and never print a manifest value beyond an unknown key, a placeholder name, or an id, path or number that already passed its form.

The manifest lives beside the site's builder (`sites/<slug>/golive.site.json` for a factory-built site); its path is an argument. Two kinds of path, never mixed: a URL path of the built site (every page, `vendored[].dir`) is checked for form only and never looked up, because the built site does not exist yet; a source file the manifest names (`claims`, `redirects.rules`, `redirects.old`, `lead.function`, `source.dir`, the script of every command) must exist under the base folder (default: the folder of the manifest) and must not resolve outside it.

The placeholders are a closed list: `{out} {dir} {port} {live} {full} {id}`; each command or selector field allows only its own. A token is named by its variable NAME only (`deploy.tokenKey`), never by its value. The invented fixture is `tools/golive/fixtures/demo-site.golive.site.json`.

## search-gate

`node tools/golive/search-gate.mjs --manifest <file> --built <folder> --out <folder> [--data <folder>]` holds a built site to the signed research plan its manifest names, with the SEO skill's gate, strict. Exit 0: PASS. Exit 1: the manifest is refused, or the gate FAILED or could not judge (ERROR). Exit 2: usage (an unknown flag, a missing value, a folder that does not exist, `--out` inside the built folder or the plan folder). Exit 3: BLOCKED.

The last line is `PASS|FAIL|ERROR search-gate <site>: <the gate's counts>`, or, for exit 3, one `BLOCKED: <what> | unblocks: <what>` line. The gate's own lines come before it. A gate that crashes, prints nothing, or whose exit and summary line disagree is a FAIL, never a pass.

`search.host` is a required key of the manifest: the host whose folder `<data>/site-checks/<host>/.pewp` holds the research and the page plan (`--data` defaults to the skill's folder). With no `targets.json`, no `business.json` or no `plan/sitemap.json` there, the run is BLOCKED and says what to run; it is never a pass.

Strict means the research and the plan are signed and unchanged since, every warning is a failure, and there is no waiver: the tool has no flag for either.

A check that passes because its input is absent prints a `NOTHING TO CHECK <id>: <count>` line first: GT-009 (no template pages planned), GT-010 (industry null in business.json) and GT-014 (no prompt map) are a true answer shown with its count. A built site with no `sitemap.xml` is different: GT-013 had no dates to read, so a run that would otherwise pass is BLOCKED (a FAIL or an ERROR stays one).

The tool writes nothing but the gate's `report.json` and `report.md` in `--out`. Its test uses the skill's own fixtures (`fixtures/pewp` and `fixtures/site-clean`), planned and signed in a temp folder.
