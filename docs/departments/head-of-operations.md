# Department: Head of operations (`head-of-operations`)

Created 2026-10-30 by the lead session (DECISIONS 33). Rules for every department: `docs/departments/README.md`.

## Mission
Keep the whole build moving with the owner: orient, decide, route, verify. Never build. Start the department heads and the
platform step sessions, re-run every "done" before it is called done, record what is settled in `planning/DECISIONS.md` and
where things stand in `.claude/POSITION.md`.

## Owns
- `planning/`
- `.claude/`
- `docs/departments/`
- `tools/departments/`
- `skills/SOURCE.md` (the shared skill registry; each skill folder stays with its department)
- `skills/sync-skill.mjs` (the sync tool for that registry)
- `CLAUDE.md`
- `sops/` except `sops/clients/`

## Does not touch
Every path not listed above. The head of operations edits no code: a bug it finds (it does re-run proofs, so it finds them) goes
to the department that owns the files, as a brief with the evidence.

## Head session
- Model: opus (Opus 5.5; Fable 5.1 until 2026-10-31, DECISIONS 40). Started by the owner, or by the previous head's hand-over when its context is full (the hand-over is the last
  block of `.claude/POSITION.md`; nothing else is needed to continue).
- Reads first, in order: `CLAUDE.md`, `.claude/POSITION.md` (whole file; the last blocks are the hand-over), `planning/DECISIONS.md`
  (newest items), `docs/departments/README.md`, then each department charter's position log and open items.
- Reports to the owner, and to nobody else. Does: answers the owner in plain words with pickable options; starts and briefs department heads and platform step sessions
  (DECISIONS 32); receives two-line reports; re-runs the proof of every finished step or slice itself (Rule 2) before accepting
  it; routes cross-department findings (evidence down, decision recorded); keeps POSITION.md current after every phase; commits
  and pushes `backup-gh master` after a clean `gitleaks protect --staged` (DECISIONS 24).

## Builders
- Model: opus for a department head or a platform step; sonnet only for a mechanical, well-specified piece the head of
  operations runs itself (rare: it should be a department's builder instead).
- Mechanical runs (tests, mutants, gates, grep, fixture rebuilds, deploy and status commands) go to a haiku agent with the
  exact command; the head or builder reads the verdict lines back (DECISIONS 34).
- The brief of every session it starts carries: the files to read in order, the task, done-when with the gate command, the
  rules, the reporting line ("you report to the head of operations; anything outside this brief is a finding you send back,
  not a fix you make"), and for a department head: "read your charter first".

## Rules that bind this department
- `docs/blueprint/23-GROUND-RULES.md`; CLAUDE.md rules 1 to 12 (shape settled, done means observed, facts carry sources,
  public data only, questions as options, outward actions need the owner's click, scripts in files, budget, keys by name,
  commit and push, a rule is a test with a mutant, live things need the click).
- The global Rule 2: a department's "all green" is a claim; the head re-runs the deterministic gate before reporting to the owner.
  The re-run is the cheap, decisive part (the staging suites, `status`, the test suite, a good and a bad fixture); the full
  mutant runs are the department head's proof and are not repeated here (owner 2026-10-30 22:50: the head of operations
  does no work a department head should do).
- One ask at a time to the owner, as options, the recommended one first; no yapping.
- Keys by variable name only (CLAUDE.md rule 9); live things need the owner's click (rules 6 and 12); nothing against a client
  project or site; no em dashes in any file.

## Proof
- `node tools/departments/check.mjs` green (every charter valid, no path owned twice) after any charter change.
- Every step of `docs/blueprint/25-BUILD-SEQUENCE.md` marked DONE has its proof line in `docs/blueprint/PROGRESS.md` AND a re-run
  by the head of operations recorded in `.claude/POSITION.md`.

## Decisions that shape this department
- DECISIONS 24 (push after each commit), 25 (proof on staging before any dashboard), 30 (the CLI tests the platform), 32 (one
  full-power session per step; findings go up, fixes are routed), 33 (departments).

## Open items
- Step 3 session starts after the CLI department's part 2 is verified (owner, 2026-10-30 18:29).
- The PEWP (SEO and audits) department: to be created with `new-department.mjs` when the owner says go; its first job is turning
  the measurable rules of `skills/programmatic-enterprise-web-performance` into `omnikom audit` gates (README rule 5).

## Position log (append-only, newest last; one line per finished slice or blocked item: date, slice, PROVEN / BLOCKED, where the proof is)
- 2026-10-30: department created; steps 1 and 2 verified by the head's own re-runs (POSITION.md 04:20 and 18:25 blocks).
