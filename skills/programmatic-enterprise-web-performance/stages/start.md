# Stage: start (the one entry over every mode)

Load this file when the user wants a whole mode run end to end ("audit this link", "refactor the site", "migrate", "build a site")
instead of one script. `scripts/start.mjs` holds the stage sequence of every mode, runs the stages that are not done in order,
and stops where a person or the main session has to act. It builds no stage itself: every stage is one of the skill's own
scripts called by its real command line (the table below), so each stage can still be run alone and its stage file still applies.
It follows shipgate `06-growth.md` section 2: `start <mode>` records the sequence in state.json, runs the stages not yet done in
order, stops at the first approval or missing input; `start --stage <name>` runs one stage; later stages whose inputs changed are
marked stale and run again on the next start.

## Use (the main session)
1. `node "<skill>/scripts/start.mjs" <mode> <target> [<target2>] [options]` with no `--go`: prints the plan, each stage's status
   (pending / done / stale), who does it (`[script]`, `[agent]`, `[ack]`, `[approval]`) and the cost. Show it to the owner. Nothing runs.
2. Same command with `--go`: runs. For long runs (a snapshot, research, a refactor) start it with `run_in_background` and read the output;
   Run it from PowerShell (Git Bash rewrites `^/path` excludes; start refuses an exclude that was rewritten).
3. Read how it stopped (the exit code and the first word of the last block) and do what it says, then run the **same command** again:

| Exit | Line | What the main session does |
|---|---|---|
| 0 | `ALL STAGES DONE`, or `STATUS: BUILT-AWAITING-MEASURE` (build mode before launch) | report it; the proof is in the stage outputs |
| 3 | `NEEDS-INPUT stage=...` | ask the listed questions as pickable options (recommended first); intake: write the answers to `.pewp/intake-answers.json`; others: the question names the option to pass on the next start. JSON copy: `.pewp/start/questions.json` |
| 3 | `NEEDS-APPROVAL stage=...` | the owner decides; the main session records it: `--ack <stage> --by "<owner name>"`; for `approve-*` stages run the `approve.mjs ... --by` command the line prints |
| 3 | `WAITING-FOR the checker agent / the builder session` | do the task the line spells out (start ONE Sonnet agent with the coordinator brief; a builder session), then start again |
| 4 | `BLOCKED stage=...: ... Unblocks: ...` | a source or capability is missing; the line says what unblocks it. An optional stage (authority, iterate) that is BLOCKED is skipped and the run goes on |
| 1 | `FAILED stage=...` | a stage failed or a gate failed (redirect gate, REF-013, a check, the combined refactor branch). Read the stage's log in `.pewp/start/<stage>.log`; do not paper over it |
| 2 | usage | fix the command |

`--ack <stage> --by NAME` is only for the stages marked `[ack]` (the owner's decision recorded by the main session): `refactor-ok`
(worker count and cost), `refactor-merge`, `map-review`, `cutover` (+ `--cutover-date YYYY-MM-DD`), `builder` (+ `--site <folder>`).
Start never signs an approval, merges, pushes, deploys or switches a site over.

## State, stale stages, options
- `<pewp>/state.json`: `stages.<name>` = `{ doneAt, outputs, inputsHash, inputsDetail, ack? , stale? }` and `start` = `{ mode, sequence[], status, stage, message, options }`.
  `<pewp>` is `site-checks/<host>/.pewp` for a URL, `<repo or folder>/.pewp` for a path, `site-checks/compare-<a>-vs-<b>/.pewp` for compare.
  Logs and acknowledgements are in `<pewp>/start/` (git-ignored).
- Each stage hashes its inputs (files, folders, a repo's git HEAD) when it finishes. A later start compares: a changed input marks
  the stage `stale` in state.json and it runs again (an agent stage asks for the agent again; an `[ack]` stage asks the owner again).
  A stage that exits 0 without writing its outputs is FAILED, never done. A stage already done outside start (a script run by hand) is adopted.
- `--stage <name> --go` runs only that stage (forced) and then lists the stages it made stale.
- Options that shape a stage (`--exclude`, `--max-pages`, `--build`, `--new-origin`, `--no-images`, the text after `--`, ...) are remembered
  in `start.options` and applied to every later start of the same run, so a second `--go` cannot forget an off-limits path. Decisions of the
  moment (`--go --stage --ack --by --yes --fresh`) are not remembered. `--forget-options` starts the list again.
- Cost: the plan prints every stage's cost; the existing caps still apply inside the scripts (12 fix workers, 20 pages, 150 research calls...).
  Paid APIs: none.

## The sequences (script and command line each stage runs)
| Mode | Stages (script) |
|---|---|
| `audit-live <url>` | doctor -> snapshot (`live-target.mjs <url> -- <snapshot options>`) -> checker [agent: coordinator.md on the snapshot] -> authority (optional, `authority.mjs`) -> report (`report-live.mjs`) |
| `audit-repo <path>` | doctor -> guard-before (`guard-readonly.mjs --before`) -> checker [agent] -> guard-after |
| `compare <a> <b>` | per side: snapshot (URL) -> checker [agent]; authority-a/-b (optional); compare (`compare.mjs <a> <b>`) |
| `research <url\|folder>` | doctor -> intake (`intake.mjs`) -> research-plan (`research.mjs --dry`) -> research (`research.mjs`, `--research-args`) |
| `refactor <repo>` | doctor -> guard-before -> checker [agent] -> guard-after -> refactor-dry (`refactor.mjs --dry`, needs `--build "<cmd>"` or `--no-build`) -> refactor-ok [ack] -> refactor (`refactor.mjs ... --visual`, REF-009 on unless `--no-visual`) -> refactor-merge [ack] |
| `measure <url>` | doctor -> measure-init (once) -> measure-plan (`--plan`) -> measure-run (dated: runs again each day) -> iterate (optional; BLOCKED until two runs and approved files exist) |
| `migrate <old url> <new url\|folder>` | snapshot-old -> inventory -> map -> map-review [ack] -> baseline -> service-workers (`ref-sw.mjs check`, REF-013) -> gate (`migrate.mjs --stage gate --images`, REF-014; a folder needs `--new-origin`) -> cutover [ack] -> monitor |
| `build <folder>` (alias `new`) | doctor -> intake -> research -> plan -> approve-targets [approval] -> approve-plan [approval] -> handoff (`build-site.mjs --go`) -> builder [ack] -> gate (`build-site.mjs --builder-done`) -> measure (waits for launch) |
| `iterate <target>` | iterate -> approve-proposals-targets [approval] -> approve-proposals-plan [approval] |
| `local <url\|repo>` | doctor -> local (`local-run.mjs`) |
`audit <target>` is audit-live for a URL and audit-repo for a path. shipgate's `audit`, `audit --url`, `refactor`, `new`, `compare`, `research`,
`measure` entry modes map to these (its intake/research/gate/diagnosis names are this skill's doctor/snapshot/checker/report stages).

## What REF-009, REF-013, REF-014 add (shipgate packs/refactor.md)
- **REF-009 visual equivalence** (`ref-visual.mjs`, `refactor.mjs --visual`): screenshots of every route group (a template family from
  `families.mjs`: its first page; plus each one-off page) at mobile 390x844 DPR 3 and desktop 1366x768 DPR 1, full page, fonts loaded,
  animations off, requests to other hosts refused, `visual.masks` selectors hidden; pixelmatch semantics (YIQ 0.1, anti-aliased pixels not
  counted); over `maxDiffRatio` (0.001) is `visual-diff` with the changed regions and a diff picture; a size change without an allowance
  fails whatever the pixels. `refactor.mjs` takes the baseline screenshots before any fix and the after screenshots of the merged branch and
  reports PASS / FAIL / BLOCKED (no Chrome) in the report; a FAIL does not make the run UNSAFE because a contrast or spacing fix is meant to
  change pixels: the owner opens `.pewp/refactor/<run>/visual/diff/` and declares it (`--visual-allow "/path/=0.05"`, `--visual-max-diff`,
  or an `allowedChanges` `visual` entry via `--visual-allow-file`). Standalone: `node ref-visual.mjs compare --before-site A --after-site B --out DIR`.
- **REF-013 old service workers retired** (`ref-sw.mjs`): `detect` reads the old snapshot (a recorded `site/serviceworkers.json` from
  `ref-sw.mjs capture <origin>` with real Chrome, else `serviceWorker.register(...)` calls in the HTML, else worker-looking script names as
  warnings); `check` requires, per worker, a 200 JavaScript script containing `registration.unregister(` at the same URL, or
  `Clear-Site-Data` ("storage", "cache" or "*") on every HTML response. A redirect or 404 at the worker URL fails. Part sw-cache needs the
  logout flow: reported BLOCKED when the new build registers a worker.
- **REF-014 image URLs kept** (`ref-images.mjs`, `migrate.mjs --images`): every image URL of the old snapshot (img, srcset, picture in
  `<main>`, og:image, image sitemap) on the old host answers 200 `image/*` on the new site or in one 301/308 hop to one; findings
  status-mismatch / redirect-chain / redirect-target; images only on pages the map drops with a 410, or dropped on purpose, are exempt;
  other hosts listed and ignored; above 2,000 images a fixed draw; `--image-scope priority` limits it to must-keep pages and the image
  sitemap (the default `all` is the shipgate rule). Failing it fails the migrate gate.

## Proof
`node scripts/test-start.mjs` (stand-in stage scripts; stop points, state, stale, acks, command lines) and `node scripts/test-ref.mjs`
(PNG codec, diff, Chrome screenshots, `refactor.mjs --visual` on a fixture repo, REF-013, REF-014, `migrate.mjs --images`); both end with
watched-fail mutants. Counts come from their output.
