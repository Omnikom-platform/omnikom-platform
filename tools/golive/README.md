# tools/golive

The go-live pipeline's site tools. The pipeline is the platform's and is the same for every site; everything that differs per site is one `golive.site.json`, and a manifest holds no secret.

## site-manifest

`node tools/golive/site-manifest.mjs <file> [--base <folder>]` checks one manifest against the schema and refuses everything else. Exit 0: valid (stdout `OK: <file>: manifest valid`). Exit 1: refused, one line per fault on stderr, stdout empty. Exit 2: usage (the base is checked before the file is read). Later jobs import `checkManifest(file, base)`, which returns `{ manifest, faults }` (`manifest` is null when `faults` is not empty).

A refusal line is `REFUSED: <file>: <path>: <text>` (root keys have the bare key as path); lines come in schema order, one per fault, and never print a manifest value beyond an unknown key, a placeholder name, or an id, path or number that already passed its form.

The manifest lives beside the site's builder (`sites/<slug>/golive.site.json` for a factory-built site); its path is an argument. Two kinds of path, never mixed: a URL path of the built site (every page, `vendored[].dir`) is checked for form only and never looked up, because the built site does not exist yet; a source file the manifest names (`claims`, `redirects.rules`, `redirects.old`, `lead.function`, `source.dir`, the script of every command) must exist under the base folder (default: the folder of the manifest) and must not resolve outside it.

The placeholders are a closed list: `{out} {dir} {port} {live} {full} {id}`; each command or selector field allows only its own. A token is named by its variable NAME only (`deploy.tokenKey`), never by its value. The invented fixture is `tools/golive/fixtures/demo-site.golive.site.json`.
