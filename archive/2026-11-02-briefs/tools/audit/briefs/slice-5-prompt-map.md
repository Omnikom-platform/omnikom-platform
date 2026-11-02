# Brief: slice 5, the prompt map (DECISIONS 35), in four sub-slices (one Sonnet builder per sub-slice, discarded when done)

Department: SEO and audits (`docs/departments/seo-and-audits.md`). Head: HEAD_SEO-and-audits_2026-11-01; report to it only. Anything
outside your sub-slice is a finding you send back, not a fix. Facts with file:line: `tools/audit/briefs/slice-5-facts.md` (read it;
line numbers in `tools/audit/` shift after slice 4c lands, re-check them). Decision text: `planning/DECISIONS.md` item 35.

## Why
A prompt is a whole situation a buyer types into ChatGPT, Perplexity or Gemini: scenario + comparison + constraint ("first-time buyer
in Austin, renting vs buying, under 400k"). Today the skill plans one page per keyword cluster and nothing traces a built page to a
question someone really asks. Slice 5 makes the map, makes the plan answer every row, makes the publish audit refuse a build that leaves
a row unanswered without a written reason, and re-runs the map monthly.

## Shape decided by the head (do not re-open)
- **Skill parts go in the SOURCE** `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance\` (its own git repo), never in
  the repo copy under `skills/`; the head commits the source and a Haiku runner syncs (`node skills/sync-skill.mjs`, a `skills/SOURCE.md` row).
- **No invented rows** (Non-negotiable 3): a row without at least one source is not a row; it goes to `research/prompt-unsourced.json`.
  No volume target, no "100 questions".
- **The parts are judgement, the shape is code.** Splitting a buyer's words into scenario, comparison and constraint is done by the
  session running the skill (the stage text tells it how, with examples); the scripts draft candidate rows from sources and refuse a row
  whose parts are empty, whose source is missing, or whose fix is not exactly one of the three kinds.
- **The gate traces by path, not by the contract.** The plan writes `plan/prompt-coverage.json`; the audit reads it by a file option and
  checks each covered row against the built pages' paths. No change to `contracts/` or the export is needed for the gate.
- **Personal data never enters the map.** From a lead only the free text of `answers` is read; name, email, phone, ids are dropped on
  read and never written. One workspace only, never across clients. Lead text never reaches a file a repo target commits (head,
  2026-11-01 08:45): a `lead` source in `prompt-map.json` carries no quote (ref and seenAt only); lead quotes live only in
  `<pewp>/private/prompt-candidates.json`, a folder with its own `.gitignore` of `*`. Public sources (review, forum, existing) keep a
  quote of max 300 characters.

## The row (schema file: `schemas/prompt-map.md` in the skill, with a validator `scripts/lib-prompt-map.mjs`)
```
{ id: "pm-<8 hex of sha256(prompt)>", prompt: "<the whole sentence, buyer's words>",
  scenario: "...", comparison: "...", constraint: "...", location: "<city or region>" ,
  sources: [ { kind: "lead"|"review"|"forum"|"existing"|"owner", ref: "<file:row, url, or capture file>", seenAt: "<date>", quote: "<=300 chars" } ],
  engines: { chatgpt|perplexity|gemini: { named: bool|null, cited: bool|null, pageCited: "<url>"|null, at: "<date>", source: "<capture or research file>" } },
  fix: { kind: "new-page"|"improve-page"|"earn-mention", target: "<path>"|"new", pageType?: "situation"|"comparison"|"<existing kind>", note } }
```
`null` means not checked (never guessed). `named` = the business name in the answer text; `cited` = our domain among the cited sources
(today's fields `nameMentioned`, `ourDomainCited` in `scripts/research-ai.mjs`).

## Sub-slice 5a: the map (skill, research stage)
- `scripts/research-prompts.mjs`: inputs `--leads FILE` (the CSV of the dashboard `lead-export` for ONE workspace, saved by the owner or
  the platform export when it exists; `answers` JSON cell, any free-text key), `--reviews FILE` (a JSON list the owner saved of public
  reviews: `{text, url, date, platform}`; a new importer), plus `research/forums.json` and `research/existing.json` when present. Writes
  `research/prompt-candidates.json` (buyer quotes grouped, parts empty) for the session to fill, and `--check` validates
  `research/prompt-map.json`. Engines are filled from `research/ai-citations.json` and owner captures (`captures/ai/*.json`) matched by
  prompt id or exact prompt text; Gemini runs only under the existing gate (`GEMINI_API_KEY` and `PEWP_GEMINI_TERMS_ACK=1`, owner's yes).
- `stages/research.md`: a "Prompt map" step: how to split into the three parts (three worked examples from synthetic sources), one fix per
  row, unsourced rows go to the unsourced file.
- Tests with synthetic fixtures (an invented tea shop or the skill's own fixtures; never a client file): a lead CSV with names and emails
  produces candidates with NO name, email or phone anywhere in the output (test greps the output for the fixture's email: watched red);
  a row with empty parts, no source or two fix kinds is refused by `--check`; a source quote over 300 characters is cut.
- Done when: the skill's own test runner for the new file passes, each refusal watched red, and a mutant per refusal is caught (the skill's
  mutant pattern, e.g. `test-plan-gate`).

## Sub-slice 5b: the plan covers every row (skill, plan stage)
- `scripts/plan-site.mjs` reads `research/prompt-map.json` (or `approved/` when present). For each row: `improve-page` adds the prompt to
  that page's brief under a new `## Prompts this page answers` (id + prompt); `new-page` adds a page with kind `situation` or `comparison`
  (new planner kinds; outline and schema switches extended; `comparison` briefs carry `## Facts about the other option` where every line
  needs a public source URL and date, no claim without one); `earn-mention` goes to `plan/offsite.json` with the prompt id.
- Writes `plan/prompt-coverage.json`: `{ map: "<sha256 of prompt-map.json>", rows: [ { id, coveredBy: "<path>"|null, kind, reason } ] }`,
  where `coveredBy: null` needs a non-empty `reason` (also for `earn-mention`, whose reason names the offsite item). `approve.mjs` copies it.
- Skill gate: a sibling of GT-011 in `scripts/gate*.mjs` (next free GT id) fails a row with neither page nor reason.
- Done when: tests for both kinds, the coverage file, the comparison-fact rule (a fact line without URL and date is refused), each watched
  red with a mutant.

## Sub-slice 5c: the publish rule (tools/audit)
- New rule `PMP-001` (P0): `audit(dir, { promptCoverage: FILE })`, `run.mjs --prompt-coverage FILE`, `live.mjs` passes it through. Loaded
  in `lib/context.mjs` the way `loadPsi` is (file option; bad JSON or wrong shape is exit 2), into `site.promptCoverage` (null when absent).
- No file: one `SKIP PMP-001 / no --prompt-coverage` line (a check that did not run is never silent; "active only once the plan artifact
  exists", charter). With a file: FAIL per row whose `coveredBy` is null and whose `reason` is empty; FAIL per row whose `coveredBy` path is
  not a built page (`site.pageList`), naming the row id and the path; PASS per row otherwise. `rules/PMP-001.md` cites DECISIONS 35.
- Fixtures from `build-fixtures.mjs` (`good` plus a coverage file for good, `bad-PMP-001-uncovered`, `bad-PMP-001-missing-page`), a fixture
  entry may carry the coverage file like it carries `target` (slice 4c). Tests watched red, a mutant per FAIL path and for the SKIP.
- The factory and CLI callers pass no coverage file today, so they get the one SKIP line: the same light follow-on as 4c's ENV-001 SKIP
  (expectation literals in `factory/test/run.mjs` and the CLI tests), named in the proof file with the owners.
- Done when: the tools/audit gates (README "Gates") plus the new fixture lines, `node factory/test/run.mjs` 88 of 88, the CLI unit run;
  MUTATE_ONLY for the new mutants through `node ~/.claude/scripts/heavy.mjs -- ...`.

## Sub-slice 5d: the monthly re-run and the written shape for the dashboard (skill measure stage, blueprint 22)
- `stages/measure.md` and `scripts/measure.mjs`: `ai.prompts` in `measure/config.json` comes from the approved prompt map; each month writes
  `measure/<date>/prompt-map.json` (each row's engines block for that month) and a diff against the last month (named or cited changed,
  page cited changed); the report lists rows per prompt. Monthly cadence is the owner's schedule (`/schedule` or a CI cron he clicks):
  the stage says so, the slice does not create a schedule.
- `docs/blueprint/22-SEARCH-AND-ANALYTICS.md`: a "Prompt map" section: the row, where it lives, the monthly re-run, and the jsonb shape of a
  `metrics_snapshots` row with source `ai-answers` (one row per prompt per engine per month: `{promptId, prompt, engine, named, cited,
  pageCited, at, source}`), marked as the shape the platform's writer and the dashboard section 8 will read (not built here).
- Done when: measure's tests cover the diff (named flips, cited flips, page changes) with fixtures, watched red, a mutant each.

## Not this department's (the head sends these as notices through the head of operations; do NOT build them)
1. Platform: a read-only, one-workspace, text-only lead export for SEO research (no name, email, phone), replacing the owner-saved CSV.
2. Platform (step 5): the `situation` and `comparison` page types: `entities.json` mappings and look-folder section partials.
3. Platform: the publish runner (`factory/runner/publish.mjs:141-148`) passes `--prompt-coverage <file>` once a site has a plan, and the
   plan's coverage file travels with the site's export or folder.
4. Platform: the `ai-answers` writer and the dashboard rows "named / cited per prompt" (04-DASHBOARD section 8; no step 5 screen today).
5. Owner clicks: `PEWP_GEMINI_TERMS_ACK`, the monthly schedule, captures of ChatGPT and Perplexity answers.

## Rules for every sub-slice
- Edit only your sub-slice's files (skill SOURCE files named above; `tools/audit/` for 5c; `docs/blueprint/22-SEARCH-AND-ANALYTICS.md` for
  5d; the named light follow-on literals in 5c). Node built-ins only. Scripts in files, never inline `node -e`. No em dash characters.
- Synthetic fixtures only (DECISIONS 30); no client folder, no live request, no browser, no model API from any script (DECISIONS 38).
- Never `git add`, commit, stash, reset, checkout or switch branches, in either repo; the checkout is shared. Stop only processes you
  started, by PID; delete only folders your runs made. Heavy runs through `node ~/.claude/scripts/heavy.mjs -- <cmd>`.
- Proof file `tools/audit/proof/5<x>.md` with the real last lines, the watched-red lines and UNPROVEN where needed; a block
  "## SEO and audits, slice 5<x>: <name> (<date time>, builder)" at the top of the SEO blocks in `docs/blueprint/PROGRESS.md`. Your
  report to the head: five lines at most.
- Order: 5a, then 5b (needs 5a's schema), then 5c (needs 5b's coverage file shape; starts after 4c is on master), then 5d.
