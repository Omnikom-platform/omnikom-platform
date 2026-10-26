# SOP: run a prospect / client presence audit with an agent team (manual form of build step A)

First full run: ELEV8 Real Estate Group / Alex Sevilla, `E:\Alex Sevilla`, started 2026-10-26. Copy that folder's `icm/`, `tools/`
and `START-TEAM.cmd` layout for the next client. Its `BRIEF.md` is the sequence; `icm/phase-0/CONTEXT.md` the phase map.

## The team
| Role | Model | Lane | Writes only |
|---|---|---|---|
| Lead (the owner's session) | Opus | runs the skill (`start.mjs`, `--go` only on the owner's word), re-runs every proof before accepting, opens the gates, resolves gaps, promotes facts, asks the owner (pickable options) | everything; sole writer of `facts/`, brief, phase map, gates |
| Researcher | Sonnet | backup -> profile (+ per-member team file) -> site inventory -> page by page -> speed | `backups/`, `site/`, its `icm/work/p0.x/` |
| SEO analyst | Opus | search grid (Google, Bing, Maps at 45 s) -> AI scorecard -> competitors + offer map -> links | `facts/search/`, `competitors/`, `authority/`, its work folders |
| Reviewer | Fable | after the report only: every number against its source, fresh context | its review file |

Start: `START-TEAM.cmd` (terminal tabs) or, in the desktop app, the Lead starts the two agents as sessions with the boot prompts in
`icm/agents/boot-prompts.md` (first line `ICM-ROLE: <role>`).

## What keeps it on track (mechanisms, not requests)
- **Write guard + role anchor** (`tools/write-guard.mjs`, `tools/agent-anchor.mjs`, hooked in `.claude/settings.json`): each agent can
  write only its own paths; its charter is re-injected at every start and compaction. Proof: `node tools/test-agent-hooks.mjs`
  (51 checks + 10 watched-fail mutants on ELEV8).
- **The backup gate:** every path after the backup stays closed for the agents until the Lead writes `BACKUP VERIFIED` into
  `icm/gate/BACKUP-GATE.md`, after re-running verify itself.
- **Gap log** (`icm/work/gaps/LOG.md`, append-only for agents): a blocker or a disagreement between files is a row + one line to
  the Lead; the Lead checks the cited file itself and marks RESOLVED / DIRECTED / REJECTED.
- **Progress panel:** the `elev8-tracker` Claude app mod reads `icm/TRACKER.json` (every file that must exist at the end, phase by
  phase) and checks the disk itself every 20 s. Nothing is ticked by hand.
- **Position file** (`.claude/POSITION.md`) updated after every decision; the session-start hook re-injects it.

## Order (each phase starts only when the one before it is verified)
1. Backup (see `website-backup.md`) -> gate. 2. Business profile end to end: who they are, team, brokerage, cities, provider and tech
stack, every online profile, their own websites, what they want. 3. Site inventory (robots, sitemaps vs navigation vs backup vs
`site:`). 4. The skill's run on the live site + its code checker on the backup. 5. Page by page in the browser. 6. Speed
(PageSpeed Insights mobile + desktop with conditions). 7. Search grid, lead-bringing searches first. 8. AI answers (owner pastes).
9. Competitors + every finding mapped to the Omnikom setup step that fixes it, framed as leads won or lost. 10. Links and mentions.
11. Scores. 12. Report, PDF, evidence file, meeting brief. 13. Fresh-context review.

## Where the owner is needed (cannot be skipped)
The skill's sign-offs (business definition, competitor list, search seeds, targets and page plan) carry the owner's name; AI
answers are pasted by the owner; a robot check stops that host; the owner reads every PDF page. The laptop stays awake
(`tools/keep-awake.ps1` + the app's hold; a closed lid still sleeps).

## Lessons from the ELEV8 run (2026-10-26)
- An idle agent watches nothing: a background job is only seen when it ends. Agents watch the first page of a long run themselves.
- Agents' claims get checked against `facts/`: the Researcher wrote "no agent page of his own"; the verified profile said otherwise.
- Ask the owner early what the client wants (ELEV8: a website that brings leads and revenue) and record the draft-site direction
  in the brief; it decides what the audit collects (per-member service areas and own sites).
- Measured time per phase goes into the run's position file, for the engine's estimates.

## Measured times (ELEV8 prospect audit, 2026-10-26)
From logs and file stamps, not estimates.
| Step | Time | Source (in E:\Alex Sevilla) |
|---|---|---|
| Website backup to gate | 1 h 50 min run + 18 min verify | `sops/website-backup.md` measured times |
| Search grid, 122 result pages at >= 45 s apart (owner's browser) | 1 h 28 min (16:31 to 17:59 UTC) | `facts/search/SUMMARY.md` header |
| PageSpeed re-check, API, 12 runs (2 pages x 2 devices x 3) | 4 min 41 s | `icm/work/lead/speed-final-2026-10-26.md` |
| Scores -> REPORT.md -> first PDF -> EVIDENCE + brief (inputs already sourced) | about 15 min of file writes (21:43 to 21:58 local) | file times |
| Fresh-context number review (subagent, 97 claims) | 7 min 39 s | agent run time |
| Owner review rounds after the first PDF (analyst review, speed re-test, IDX fixes, screenshots) | 4 rounds | `.claude/POSITION.md` |
Lesson: the report itself is fast once every input is sourced; the time goes into the backup, the search grid and the owner's
review rounds. Label every speed number with its test (Google's slow-phone lab test vs a real load); the owner caught a lab number
presented as "on a phone".
