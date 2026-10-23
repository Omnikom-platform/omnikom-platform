# Stage: build (mode `build <business brief>`)

Load this file only when the mode is `build`. It takes a business from words to a site that is planned to rank before a line
of page code is written: **intake -> research -> plan -> builder handoff -> (a builder session) -> gate -> measure**. This
file is the orchestration. The stages are scripts written and owned elsewhere (`stages/intake.md`, `research.md`, `plan.md`,
`gate.md`, `measure.md` describe each); this driver only calls them in order and hands over. Free sources only.

## The driver: `scripts/build-site.mjs`
```
node "<skill>/scripts/build-site.mjs" <target dir> [--brief <file>] [--go] [--builder-done] [--site <built site dir>] [--strict]
      [--research-args "<extra research.mjs args>"] [--plan-args "<extra plan-site.mjs args>"] [--live-url <url>]
      [--force <stage>] [--stage-scripts <dir>] [--stage-timeout-min 60]
```
- `<target dir>` is a folder for the new site's work; its state lives in `<target>/.pewp/` (state.json, business.json,
  targets.json, research/, plan/, builder/, gate/). Created if missing. The built site goes to `--site` (default `<target>/site`).
- **Without `--go` it only prints the plan** (every stage: done / stale / pending, the script it will call, the cost) and
  stops. The main session shows that to the owner and asks first ("print the plan, ask before large runs").
- With `--go` it runs every stage that is pending or stale, in order, and stops at the first thing it cannot do alone.
- It is resumable: all state is files, so after a compaction or a crash the same command continues where it stopped, and
  `--force <stage>` re-runs one stage alone. A stage is **stale** when one of its inputs changed after it ran (the owner
  corrected business.json after research): it re-runs, and what depends on it with it.
- `--brief <file>` is kept as `.pewp/brief.txt` for the record. Intake does not read it: the main session reads the brief,
  writes the intake answers it is certain of into `.pewp/intake-answers.json`, and the intake questions that remain are the
  only things the owner is asked.

## How the main session runs it (the loop)
1. **Plan.** `build-site.mjs <target> --brief <file>` (no `--go`). Tell the owner in two sentences what will be produced,
   that it uses free sources only, and that the builder session is the main cost. For the research cost, also run
   `node "<skill>/scripts/research.mjs" <target> --dry` once intake is done (it prints the external calls; above 150 it needs
   `--yes`). Ask: go / change something (pickable options, recommended first).
2. **Run.** `build-site.mjs <target> --go` (PowerShell, in the background). Read its last lines. Exactly one ends every run:

| Last line starts with | Exit | Meaning | The main session does |
|---|---|---|---|
| `NEEDS-INPUT stage=intake` + numbered questions | 3 | intake cannot finish without the owner; the questions (AskUserQuestion shape) are in `.pewp/intake-facts.json` | ask **all** of them in one batch as pickable options (the first option is recommended; a typed "Other" is the value), write the chosen values to `.pewp/intake-answers.json` as `{"<field>": <value>}`, run the same command again. Never answer for the owner |
| `NEEDS-INPUT stage=research` + its message | 3 | research is BLOCKED: no intake, no query universe (seeds), or owner confirmation of a large plan | turn the message into one pickable question, then re-run with `--research-args "--service <s> ..."` or `"--yes"` |
| `BLOCKED stage=<s>: <reason>` | 4 | a script is not built yet | say BLOCKED and what unblocks it, in plain words. Do not improvise the stage. Earlier stages are kept |
| `FAILED stage=<s>` | 1 | the stage crashed or did not write its outputs | show the output tail to the Lead; one re-run once the cause is understood, never a loop |
| `WAITING-FOR-BUILDER` | 0 | plan done; the spec is `.pewp/builder/HANDOFF.md` | start the builder (below) |
| `GATE-FAILED` | 1 | the built site does not match the plan (exit 1 = a check failed, 2 = a check could not judge) | give the builder the gate output; do not run measure |
| `STATUS: BUILT-AWAITING-MEASURE` | 0 | built and gated; the site is not live, so nothing can be measured yet | report what was built and the exact measure commands it printed |

2b. **Design (new or redesigned sites).** Between the plan and the builder the main session runs `stages/design.md` (visual intake, direction round, branded comp, sizing standard, live checks, section audit, `DESIGN.md`, scope check). It is an SOP with owner touchpoints, not a stage of `build-site.mjs`; the main session adds the signed `DESIGN.md` path to the builder prompt (the driver does not know it).
3. **The builder.** Another session or agent, started by the main session with the prompt in `.pewp/builder/builder-prompt.md`.
   Its spec is `.pewp/builder/HANDOFF.md`: the business, the page table (path, primary query, planned title, H1, schema
   types, brief file), the briefs, the rules, and the definition of done. Where a project has its own rules (Francine & Eli:
   front end only, no backend, no deploy before the owner signs the blueprints) they come first; this skill never deploys.
4. **Gate.** When the builder reports its gate passed: `build-site.mjs <target> --go --builder-done --site <dir>`. The driver
   runs `scripts/gate.mjs <pewp> <site dir>` itself (a builder's report is a claim), saves the output to `.pewp/gate/<date>.txt`
   (the gate also writes `gate/report.md`), and stops with `GATE-FAILED` on any non-zero exit. Failures go back to the builder
   with the output pasted; repeat until it passes. Pass `--strict` for the launch gate (warnings such as missing disclosure pages
   become failures). The gate's GT-013 builds the site twice and fails any date that moves (sitemap lastmod, JSON-LD dates: the build
   clock is fake freshness, IDX-003/AEO-012): the driver passes the build command from `--site-build "<cmd>" [--site-build-cwd DIR]`, else from
   `.pewp/builder/build-command.txt` (the handoff tells the builder to write it); with neither, GT-013 reads one build only and says so.
   Also run the existing checker on the built site (`audit-repo`, coordinator.md): the target gate and the
   shipgate checker are two different tests.
5. **Measure.** The driver does not measure a site that is only built. It prints `measure: BLOCKED` with the exact commands for
   after launch (`scripts/measure.mjs <live url> --init --property sc-domain:<domain>`, then without `--init`; Search Console
   access is the owner's free OAuth). With `--live-url <url>` it runs `measure.mjs <url>` and reports its exit code.
6. **Proof file** `runs/<date>-build.md`: the exact commands, exit codes, the first 40 lines of each, the doctor result.

## The stage command lines (as delivered by their owners; the driver adapts to them, not the other way round)
| Stage | Command | Reads | Writes (the driver checks) | Exit |
|---|---|---|---|---|
| intake | `intake.mjs <target>` | the site/web, `.pewp/intake-answers.json` | `business.json` (+ `intake-facts.json`) | 0 complete, 3 questions open |
| research | `research.mjs <target> [args]` | business.json, free sources (cached) | `targets.json`, `research/report.md` | 0 written, 3 BLOCKED, 1 crashed |
| plan | `plan-site.mjs <pewp dir> [args]` | targets.json, business.json | `plan/sitemap.json`, `plan/briefs/<slug>.md` | 0 written, 1 invalid input, 2 file missing |
| gate | `gate.mjs <pewp dir> <site dir> [--strict]` | targets.json, plan/, the built HTML | `gate/report.md` | 0 all PASS, 1 a FAIL, 2 could not judge |
| measure | `measure.mjs <live url>` | targets.json, the live site | `measure/<date>/` | 0 ran (blocked parts are results) |

`<target>` is the folder; the driver passes it as the working directory too. If a stage owner changes a command line or an
output name, that is a change to this table and to `build-site.mjs`: tell the Lead. `sitemap.json` pages are read as
`{ path, slug, primaryQuery, title, h1, schema[], brief }` (older spellings `query`, `schemaType`, `briefFile` also work).

## Intake rules (S1)
Find first, ask second: the brief, the existing site, the web. Ask only what is still missing, **in one batch**, as pickable
options. `business.industry` selects `rules/industries/<slug>.json` (regulated niches: real estate, finance, health, legal) for
the claim rules the builder follows. `launchState` decides indexability: a preview or planned site is "not indexable by
design" and the handoff tells the builder to put noindex on every page.

## What "ranks from day one" means here (so nobody oversells)
The plan is built from real demand (research from free sources) so every page exists for a query people search, there is one
page per cluster, and the gate proves the page carries that query where it counts, answers the brief's questions, links as
planned and has the planned schema. It does not promise a position: rankings come from authority and time, and `measure` after
launch is how that is tracked. Say so in the final report. Numbers in the research carry their source and date; an estimate
is labelled an estimate.

## Cost
No paid API. The stage scripts fetch (polite rates, cached) and write files; the model cost is the builder session plus any
worker the checker uses on the built site (count printed before it runs, ask above 12). Research may run many minutes of
network time; each stage is cut off at `--stage-timeout-min` (default 60).

## Failure handling
| Symptom | Do |
|---|---|
| `BLOCKED stage=research` (a free source not connected) | run `scripts/doctor.mjs`, tell the owner the exact step it prints (a key, a login, an export file); the run resumes with the same command |
| the owner changes an answer later | edit `.pewp/intake-answers.json` and run `intake.mjs <target> --refresh`, or edit business.json; the next `--go` re-runs the stale stages only |
| plan changed after the builder finished | the driver prints `WAITING-FOR-BUILDER` again (the site no longer matches the briefs) |
| the gate passes but the page reads badly | the gate is deterministic, not an editor: the owner reviews the pages; a gate pass alone is not "done" |
| `plan-site.mjs`/`gate.mjs` missing | BLOCKED, named; nothing is faked |

## Proof of the tooling
`node scripts/test-refactor.mjs --only build` runs the driver against stand-in stage scripts that refuse the wrong command-line
shape: it prints the plan without `--go`; stops at the question list (exit 3) and runs nothing after; resumes with answers;
writes a handoff with the page table, brand constraint and gate command; does not re-run done stages; stops on a failing gate
(exit 1) before measure; reports measure BLOCKED with its unblock; re-runs a stale stage; reports a missing stage script as
BLOCKED by name. Each mutant of the driver turns one of these red. The real stage scripts are proven by their owners' tests;
the driver was smoke-run against the real `intake.mjs` (it returned the real question list, exit 3).
