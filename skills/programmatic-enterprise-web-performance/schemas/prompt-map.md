# Prompt map (DECISIONS 35)

A **prompt** is a whole situation a buyer types into ChatGPT, Perplexity or Gemini: a scenario, a comparison and a constraint ("first-time buyer in
Austin, renting vs buying, under 400k"). The map lists the prompts real buyers use, says which page (or off-site mention) answers each, and records
what each engine said. It is built in the research stage (`stages/research.md`, "Prompt map"), answered by the plan (`stages/plan.md`), checked at
publish and re-run monthly (`stages/measure.md`). Validator: `scripts/lib-prompt-map.mjs`; CLI: `node scripts/research-prompts.mjs <target> --check`.

## Files (in `<pewp>/research/`)
| File | Written by | What |
|---|---|---|
| `<pewp>/private/prompt-candidates.json` | `research-prompts.mjs` | drafts from the buyers' own words, parts empty, one candidate per distinct wording with all its sources. **Lead text lives only here**: `private/` holds its own `.gitignore` (`*`), written first on every run |
| `prompt-map.json` | the session | the rows, `{ "step": "prompt-map", "generatedAt", "market", "rows": [ ... ] }` (a bare list of rows is read too) |
| `prompt-unsourced.json` | the session | `{ "rows": [ { "prompt", "why" } ] }`: prompts found with no source. Never a row; never also in the map |

## The row
```
{ "id": "pm-<8 hex of sha256(prompt)>", "prompt": "<the whole sentence, the buyer's words>",
  "scenario": "...", "comparison": "...", "constraint": "...", "location": "<city or region, \"\" when the buyer names none>",
  "sources": [ { "kind": "lead|review|forum|existing|owner", "ref": "<file:row, url or capture file>", "seenAt": "YYYY-MM-DD", "quote": "<= 300 characters; absent on a lead source" } ],
  "engines": { "chatgpt|perplexity|gemini": { "named": true|false|null, "cited": true|false|null, "pageCited": "<url>"|null, "at": "YYYY-MM-DD"|null, "source": "<capture or research file>"|null } },
  "fix": { "kind": "new-page|improve-page|earn-mention", "target": "<path>|new", "pageType": "situation|comparison|<existing kind>", "note": "..." } }
```
- `id` is computed from `prompt` exactly as stored: change one character of the prompt and the id changes (`--check` prints the id it expects).
- `scenario`, `comparison`, `constraint` are never empty: they are the session's reading of the buyer's sentence. `location` is a string (empty is allowed).
- `sources` has at least one entry. A row with no source is not a row: it goes to `prompt-unsourced.json` with the reason.
- A **lead source has no `quote`** (ref and seenAt only; `--check` refuses one): lead text never reaches a file a repo target commits. Review, forum, existing and owner sources keep their `quote` (public text).
- `quote` (not a lead source) is the buyer's words, cut to 300 characters. No name, email address or phone number anywhere in the map (the checker refuses an email or a phone in a prompt or a quote).
- `engines`: `null` means not checked, never guessed. `named` = the business name is in the answer text; `cited` = our domain is among the cited sources
  (research-ai.mjs `nameMentioned`, `ourDomainCited`). An observed `true`/`false` carries its date `at` and its `source`. `pageCited` is a URL of our site and needs `cited: true`.
  `engines` may be absent until `research-prompts.mjs --engines` fills it. Only these three engine keys exist.
- `fix` is ONE object with exactly one kind:
  - `new-page`: `target` is `"new"`, `pageType` is `situation` or `comparison`.
  - `improve-page`: `target` is the page's path (starts with `/`); `pageType` optional (the page's existing kind).
  - `earn-mention`: nothing on our site answers it; `target` is `"new"` or the page the mention should point to.

## Rules the checker enforces (`--check`, exit 1 with one FAIL line per problem)
`PM-SHAPE` file is not a list of rows · `PM-PROMPT` prompt empty, holds a `{ }` placeholder · `PM-ID` id is not the hash of the prompt · `PM-PARTS` a part empty or
location not a string · `PM-SRC` no source, unknown kind, no ref, bad or future date, empty quote · `PM-QUOTE` quote over 300 characters · `PM-PII` an email address or
phone number in a prompt or quote · `PM-FIX` fix missing, a list, two kinds, unknown kind, wrong target for its kind, new-page without a situation or comparison pageType, empty note ·
`PM-ENG` unknown engine, an observed value with no date or source, a cited page without a citation · `PM-DUP` the same id or prompt twice · `PM-LEAD` prompt, scenario, comparison or constraint holds 8 or more consecutive words of a lead quote in `private/prompt-candidates.json` (names the row id, the field and the source ref, never the words; with no private file `--check` prints `lead wording not checked: no private candidates`) · `PM-UNS` an unsourced entry that
has no reason, carries a source, or is also in the map.

## Where the words come from (and what is never read)
- **Leads**: the CSV of the dashboard `lead-export` of ONE workspace, saved by the owner (or the platform's text-only export when it exists). Only the free text of the
  `answers` cell is read. Name, email, phone and ids are dropped on read and never written; an answer that names the person, or holds an email or a phone number, is dropped whole.
  Never across clients: a candidate is never copied into another client's map.
- **Reviews**: a JSON list the owner saved of public reviews, `[{ "text", "url", "date", "platform" }]`. Only `text`, `url` and `date` are read (the reviewer's name is not).
- **Forums** (`research/forums.json`) and **existing research** (`research/existing.json`): their question rows.
- **Owner**: a prompt the owner tells the session directly, source kind `owner`, `ref` the note or message file.

## The plan's side (slice 5b; `stages/plan.md`)
`plan-site.mjs` reads `approved/prompt-map.json` when the owner signed it (`approve.mjs <target> prompt-map --by NAME`), else `research/prompt-map.json`, validates it with the rules above (an invalid map stops the plan, exit 1) and answers every row:
- `improve-page`: the row `- <id> | <prompt>` goes under `## Prompts this page answers` in the named page's brief (a target that is not a page of the plan stops the plan).
- `new-page`: a page of kind `situation` (`/situations/<slug>/`) or `comparison` (`/vs/<slug>/`), no cluster, a support page under home, schema Article. Its brief has the same section, `## What the buyer asked` (scenario, comparison, constraint, location) and, for a comparison, `## Facts about the other option`.
- `earn-mention`: an item `mention-<row id>` in `plan/offsite.json` `promptMentions` ({ id, promptId, prompt, target, note, rule }); no page.
- `plan/comparison-facts.json` (hand-filled): `{ "facts": { "<row id>": [ { "fact", "url", "date" } ] } }`. A fact needs text (no `|`), a public http(s) URL and a date (YYYY-MM-DD, not in the future); otherwise the plan is refused. The brief line is `fact | source: <url> | date: <date>`.
- `plan/prompt-coverage.json`: `{ "version": 1, "generatedAt", "map": "<sha256 of the map file used>", "mapFile": "research/prompt-map.json|approved/prompt-map.json", "rows": [ { "id", "coveredBy": "<planned page path>"|null, "kind": "<fix kind>", "reason": "<why>" } ] }`, one row per map row in map order. `coveredBy` is null only for an earn-mention row, whose reason names its item in `plan/offsite.json`, or for a row the session decided not to answer, with its written reason. Gate GT-014 and the publish audit read it by path; neither needs the contract or the export.
