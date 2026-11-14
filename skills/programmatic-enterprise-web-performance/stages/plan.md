# S3 Plan: from targets.json to a spec the builder can follow

Loaded only when stage S3 runs (modes `build`, `research` follow-up, `refactor` when pages are added). Inputs are files, outputs are
files, so the stage resumes after a crash and can be re-run alone. Deterministic: no model, no network. The model's job here is to
read `plan/summary.md` and the briefs, tell the owner in plain words, and fix what the validator names.

## Inputs (read these, nothing else)
| File | Made by | Must be |
|---|---|---|
| `<pewp>/targets.json` | S2 research | valid per `schemas/targets.md` (the validator below) |
| `<pewp>/business.json` | S1 intake | valid; `industry` is a slug of `rules/industries/<slug>.json` or null; optional `credentials {state, licenseNumber, brokerage, licensed}` feeds the industry rules |
| `<pewp>/authority.json` | `authority.mjs` (optional) | the Common Crawl link gap; without it the link plan says BLOCKED and gives the command |
| a citations file (optional) | measure stage | AI citation rows; gives "sources the engines cite" |
| `<pewp>/approved/prompt-map.json`, else `<pewp>/research/prompt-map.json` (optional) | research stage, "Prompt map" (`schemas/prompt-map.md`) | valid per `research-prompts.mjs --check`; the plan refuses an invalid map (exit 1) |
| `<pewp>/plan/comparison-facts.json` (hand-filled) | the session, from public pages | `{ "facts": { "<row id>": [ { "fact", "url", "date" } ] } }`; created empty for the comparison rows and never overwritten |

`<pewp>` is `site-checks/<host>/.pewp/` for a URL target or `<repo>/.pewp/` for a repo (see `state.mjs`).

## Run it
1. Validate first: `node scripts/targets-validate.mjs <pewp>` (add `--business`, `--measure <dir>`; `--record <file>` leaves a record of the files read: the pipeline step passes it). Exit 1 prints the rule id, the path and the fix; do not plan on invalid research.
2. Plan: `node scripts/plan-site.mjs <pewp> [--authority <authority.json>] [--citations <file>] [--data-source "<text>"]`.
   Gate numbers for programmatic pages default to the project's own floor (CODE-NEEDS-SEO §6: about 1,000 words of non-template
   text, at most about 40% shared with a sibling): `--prog-min-words 1000 --prog-min-unique 600 --prog-min-facts 5 --prog-max-similarity 0.4`.
   Other knobs: `--hub-min 4` (city pages needed before an "areas we serve" hub is added), `--home-max-links 40`, `--today`.
   Exit 0 written, 1 invalid input (nothing written), 2 a file is missing.
   `--require-approved-business` (after the folder) refuses with exit 1 unless `approved/business.json` is the current `business.json`:
   the owner signs the business definition first (`node scripts/approve.mjs <target> business --by NAME`), or intake runs again if it changed.
3. Read `plan/summary.md` (ranked list) and tell the owner, in plain words: how many pages, which are new, what is quick, what is blocked.
   Call `plan/sitemap.json` "the page plan" in every word the owner reads; "the sitemap file" is sitemap.xml, which search engines read and the built site makes later.
   Then draw the page plan for the owner: `node scripts/plan-picture.mjs <pewp dir> [--out-dir DIR]` writes `plan/page-plan.svg`, `plan/page-plan.png` (every page as a box under
   its parent with its target search, volume and NEW or EXISTING; the PNG needs Chrome, else it prints `PNG BLOCKED` and the SVG and the table `plan/page-plan.md` are still written)
   and prints `page plan picture: N pages, M new`. Show the owner the PNG before asking for the yes (`approve.mjs <target> plan --by NAME`).
4. Fill what the plan cannot know: `plan/programmatic-data.json` (local facts, each with value, source and date), the data source in
   `plan/programmatic.json`, and the real values behind `{{PLACEHOLDERS}}` in the briefs. A fact without a source and date does not count at the gate.
   With a prompt map, also `plan/comparison-facts.json`: the facts about the OTHER option of each `comparison` page, read off public pages, each with its URL and the date you read it; then run `plan-site.mjs` again. A fact with no URL or no date is refused (exit 1, nothing written); with no facts a comparison page makes no claim about the other option.
5. Hand `plan/briefs/<slug>.md` to the builder as its spec. It is the same file the S5 gate reads.

## What it writes (`<pewp>/plan/`)
- `sitemap.json` (the page plan, not the sitemap file search engines read, which is sitemap.xml and is made later from the built pages): one cluster = one page; `kind` (home, city-landing, guide, money, hub), `role` (home, hub, spoke, support), `parent`,
  slug and path (an existing `targetPage` keeps its URL; a new page gets `/<slug of the query>/`, guides under `/guides/`), planned title (<=60), H1,
  meta description (<=160), schema types, word range, and `links[]` {from, to, anchor, type}.
  Hubs and spokes: a cluster whose words are a strict subset of another's is its spoke; with `--hub-min` or more city pages an
  `/areas-we-serve/` hub page is added. Link rules ported from CODE-NEEDS-SEO §5: home links to every page (up to the cap), parent and child link
  both ways, siblings link each other, a guide links to the money page it supports, cross-links on shared words. Anchors are the
  target's own query variants, rotated so they are not all identical; never generic.
- `briefs/<slug>.md`: primary query, intent, location, title, H1, meta description, schema, word range (from `wordRange` in the cluster, else a labelled default),
  CTA, outline (H2 list), entities with the section each belongs in, questions, proof and statistics to include (placeholders that need a source), links out
  and in with anchors, the industry rules that apply, notes for the builder.
- `programmatic.json`: the numeric quality gate (`minWords`, `minUniqueWords`, `minLocalFacts`, `maxSimilarity`, definitions), the data source
  status (TO DECIDE until chosen), the group of template pages and what makes each unique. `programmatic-data.json` is created empty and never overwritten.
- `offsite.json`: link gap from `authority.json` (domains linking to 2+ competitors and not to us) and linkable-asset ideas from the informational clusters;
  local plan (Business Profile categories marked UNVERIFIED, one NAP source of truth, citations, review policy, service-area pages that are not doorway pages);
  AI-visibility plan (entity consistency, sameAs, Wikidata eligibility check, citable stats, llms.txt, robots for AI crawlers, sources the engines cite).
  Accounts and listings are created by the owner or client, never by the tool.
- With a prompt map (DECISIONS 35): every row is answered. `improve-page` adds `- <id> | <prompt>` under a new `## Prompts this page answers` in that page's brief (the row's note goes into the builder notes); `new-page` adds a page of kind `situation` (`/situations/<slug>/`) or `comparison` (`/vs/<slug>/`) with no cluster, a support page under home, schema Article, a brief with `## Prompts this page answers`, `## What the buyer asked` (the three parts), and, for `comparison`, `## Facts about the other option` (one line per fact: `fact | source: <url> | date: <date>`, or one "no sourced facts yet" line); `earn-mention` goes to `offsite.json` `promptMentions` (`mention-<row id>`, prompt id, target, note) and makes no page. `prompt-coverage.json`: `{ map: <sha256 of the map file>, rows: [ { id, coveredBy: <page path>|null, kind, reason } ] }`, `coveredBy: null` only with a non-empty `reason` (an earn-mention reason names its `offsite.json` item). The page plan's `sitemap.json` pages carry `prompts: [row ids]` where they answer some. `approve.mjs <target> plan` copies the coverage file and the facts file with the rest of `plan/`; `approve.mjs <target> prompt-map` signs the map itself. Gate GT-014 reads the result. The planner never invents a row, a fact or a comparison claim; the publish audit (tools/audit, `PMP-001`) reads `prompt-coverage.json` by a file option.
- `priorities.json` and `summary.md`: impact (tercile of the cluster priority) over effort (new page, first template page costs most), quick wins first.

## Rules of the stage
- One cluster, one page; no two pages on one primary query (the validator and the gate both enforce it).
- Nothing in a brief is invented: proof items are the kinds of evidence needed, each "with source and date". The plan never writes a review, a statistic or a licence number.
- Industry rules come from `rules/industries/<slug>.json` (real-estate-agent, cash-home-buyer, insurance-agency); their ids are listed in each brief so the builder sees them before the gate does. A pack with `pageTypes` (insurance-agency) also names the schema of each page kind (`plannerKind`); a pack without it keeps the built-in choice.
- A plan for a site that is not live yet says so in the briefs (noindex is expected, not a defect).
- One prompt row, one page or one off-site item, or a written reason: nothing is dropped, and a row that names a page the plan does not have stops the plan.
- A plan on `proposals/vtv` or any project folder is a skill test artefact (scratch or `site-checks/`), never a project blueprint (Phase 1 sign-off rule).

## Proof
`node scripts/test-plan-gate.mjs` (fixtures in `fixtures/`, regenerate with `node fixtures/build-fixtures.mjs`). Prompt map: `node scripts/test-prompt-plan.mjs` (plan-site, comparison facts, approve and GT-014 on a synthetic map; its own mutants run with it, `--no-mutants` skips them; run it through `node ~/.claude/scripts/heavy.mjs --`).
