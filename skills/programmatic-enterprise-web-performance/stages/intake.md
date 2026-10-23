# S1 Intake: from a site (or nothing) to `business.json`

Loaded only when stage S1 runs (modes `build`, `research`, and any mode that needs `business.json` and finds none). Inputs are files, outputs are
files, so the stage resumes after a crash and can be re-run alone. The script never prompts: the MAIN SESSION asks the owner, in one batch, as
pickable options (CLAUDE.md rule 4: AskUserQuestion, recommended option first), and writes the picks to a file the script reads.

## What this stage decides
Who the business is, what it sells, to whom, where, in which country and language, what it wants from the site, who it competes with, what the
content must not say, what already exists, and whether the site is live, a preview or planned. Everything downstream (research, plan, gate,
measure) reads this one file, so a wrong country or a missing service area here quietly ruins every later number.

## Inputs
| Input | Where | Notes |
|---|---|---|
| the target | a URL (`site-checks/<host>/.pewp/`) or a repo path (`<repo>/.pewp/`) | `scripts/state.mjs` decides the folder |
| a snapshot of the live site | newest complete `site-checks/<host>/snapshots/<date>/` | taken by `live-target.mjs`; intake reads its home page (the untouched `raw.html.gz`), never fetches |
| a built page of a repo | `dist/`, `build/`, `public/`, `_site/`, `out/` or `index.html` | read from disk |
| answers | `<pewp>/intake-answers.json` (read automatically) and `--answers FILE` | flat dotted keys or nested; answers win over what the site says |
| industry rules | `rules/industries/<slug>.json` | `industry` must be one of these slugs or `null`; intake validates it when the folder exists |

## Steps
1. **Find what the site already says** (script, no network): `node "<skill>/scripts/intake.mjs" <url|repo> [--cwd DIR]`. It reads the JSON-LD
   (business name, type, address, `areaServed`, `sameAs`), `<html lang>`, `og:site_name`, the robots meta, social and Business Profile links, and
   accepts what is solid: name, domain, language, country, the main location with its service-area cities, socials, the Business Profile link,
   `existing.site`, and `launchState` (a preview host or a noindex site becomes `preview`, a public indexable one `live`). Each accepted fact is
   printed with its source and also saved in `<pewp>/intake-facts.json`.
2. **Show the owner what was found** in two lines ("I read these from your site: ...; tell me if any is wrong"), then ask only the rest.
3. **Ask the open questions, all at once.** The script prints `QUESTIONS n` followed by JSON: each question has `field`, `header`, `question`,
   `options[{label, description, value}]` (at most 4, recommended first, `recommended: 0`), `multiSelect` for goals, and `invalid` when an earlier
   answer was refused. Turn each into one AskUserQuestion (the tool adds "Other" for free text). Nothing is asked twice and nothing the site
   already answered is asked at all. The site's own meta description is offered as a suggestion for `offer` and its markup type for `kind`; they
   are never assumed.
4. **Save the picks**: append `field -> value` to `<pewp>/intake-answers.json`, e.g.
   `{"kind":"real-estate-agent","offer":"...","audience":"...","goals":["leads","calls"],"competitors":[],"brand.constraints":[],"existing.searchConsole":false,"existing.businessProfile":null}`.
   An option's `value` is what goes in the file; a typed answer goes in as typed (competitors as a list of domains, goals as words from the
   fixed set, a location as `{"name":"Tracy, CA","address":null,"serviceArea":["Tracy","Manteca"]}`). `[]` is a valid answer for
   `competitors` and `brand.constraints` ("none known"); a missing answer is not.
5. **Re-run** the same command. Loop to step 3 while it prints `QUESTIONS`. It ends with `COMPLETE <pewp>/business.json`.
6. **Check it**: `node "<skill>/scripts/targets-validate.mjs" <pewp> --business <pewp>/business.json` (rule B-001) must pass.

## Defaults the script applies and shows (never asked)
`rankTracking.devices = ["mobile"]`, `rankTracking.source = "search-console"` when Search Console access exists else `"browser-capture"`,
`rankTracking.locations` = the first three places of the first location. Change them by answering `rankTracking.locations` /
`rankTracking.devices` / `rankTracking.source`. Browser capture costs 45 seconds a page, so three places on one device is the honest start.

## Outputs
| File | Content |
|---|---|
| `<pewp>/business.json` | exactly the shape in `schemas/targets.md`; written only when nothing is missing and nothing is invalid |
| `<pewp>/intake-facts.json` | every fact found with its source and date, what was accepted, what was defaulted, the open questions |
| `<pewp>/business.draft.json` | what is known so far, written on every run |
| `<pewp>/state.json` | stage `intake` marked done with the paths (only on COMPLETE) |

## Exit codes and stop rules
- `0` COMPLETE. `3` BLOCKED: questions are open (the list is on screen); `2` usage. Never answer a question for the owner, never fill a
  missing field from memory, never guess the country or the language from the domain's ending.
- A site with no snapshot yet is fine: every field is asked. For a URL target, take the snapshot first (`live-target.mjs`, polite, 4 s per
  request) so fewer questions are needed. Never submit a form, register or log in on a client's site (project rule 2).
- An answer outside the allowed set (a goal that is not `leads|calls|bookings|sales`, a country that is not two letters, a `launchState`
  that is not `live|preview|planned`, an industry with no rules file) is refused and the question comes back with the reason.
- Regulated niches (real estate, finance, health, legal): when the owner picks "Regulated industry" under brand limits, set `industry` to the
  matching `rules/industries/<slug>.json` slug (answer `industry`; today `real-estate-agent`, `cash-home-buyer` and `insurance-agency`; the kind answer with the same
  slug selects it automatically), and answer `credentials` as `{"state":"CA","licenseNumber":"...","brokerage":"...","licensed":true}` (insurance-agency: `agencyLegalName` instead of `brokerage`) when the
  industry rules check them (it is copied into `business.json` unchanged; rule B-001 validates its shape).
- A preview that is `noindex` on purpose is `launchState: "preview"`: later reports say "not indexable by design", not a problem.

## Worked example (a live agent site with JSON-LD)
```
node "<skill>/scripts/intake.mjs" https://www.example-realty.com/ --cwd .
  accepted name: "Example Realty"  [snapshot 2026-10-20: JSON-LD RealEstateAgent.name]
  accepted market.language: "en"  [snapshot 2026-10-20: <html lang>]
  accepted locations: {"name":"Tracy, CA","address":"1 Main St, Tracy, CA, 95376","serviceArea":["Tracy","Manteca","Lathrop"]}
  accepted launchState: "live"  [public host, indexable]
  default  rankTracking.locations: ["Tracy, CA","Manteca, CA","Lathrop, CA"]  (first three places of the first location; ...)
QUESTIONS 7        <- kind, offer, audience, goals, competitors, brand.constraints, existing.searchConsole
BLOCKED: 7 answers missing. ...                                   (exit 3)
```
Each question becomes one AskUserQuestion, the recommended option first. A pick of "Use the site's own description" writes that text to
`offer`; "None known: research will find them" writes `[]` to `competitors`. After the picks are in `intake-answers.json` the re-run prints
`COMPLETE .../business.json`. If the owner corrects an accepted fact ("we only serve Tracy and Manteca"), put the corrected value in the
answers file under the same field (`locations`): answers always win, and the next run says so in `intake-facts.json`.

## Proof for the run file (`runs/<date>-<mode>.md`)
The command, its exit code, the first 40 lines of output, the validator line `PASS targets-valid business.json`, and the questions asked with
the answers given. Self-test: `node scripts/test-research.mjs` (the `intake:` checks), with a watched-fail for each in `scripts/mutants-research.mjs`.
