# Departments: who owns what, and how sessions are organised (DECISIONS 33)

Written 2026-10-30 from the owner's steer: "a master session that spins up builder sessions ... an orchestrator for that
department that creates the tools that will be used for the long run ... so we never have to figure our way from scratch in
sessions that know nothing or rely on memory that expires". The files are the memory. A session that expires loses nothing
that is written here.

## The shape
- **Head of operations** (one Fable session, the lead): talks to the owner and to department heads only. Verifies every
  department's proof with its own re-run before a step is called done (Rule 2), routes cross-department findings, records
  decisions in `planning/DECISIONS.md`, keeps `.claude/POSITION.md`.
- **A department** = one charter file in this folder (`docs/departments/<slug>.md`), a head session, builder sessions, and a
  set of files nobody else edits. The charter says what it owns, what it never touches, how its head and builders start, what
  its proof is, and holds its position log at the end.
- **Head of a department** (Fable): reads its charter first, splits work into slices, starts one builder session per slice
  (the model the charter names, Sonnet for routine builds against a written spec), re-runs each builder's proof, appends two
  lines to the charter's position log, reports to the head of operations in two lines (never pastes outputs upward: outputs go
  into `docs/blueprint/PROGRESS.md` or the department's own proof file).
- **A builder** (Sonnet unless the charter says otherwise): one slice, one written brief, discarded when the slice is done.
  Stays inside its brief; anything found outside it goes to its head as a finding with options, never a fix.

## The rules every department obeys
1. **One owner per path.** A path appears in exactly one charter's "Owns" list; `node tools/departments/check.mjs` fails on
   overlap. A session edits only what its charter owns. A bug in another department's files is a finding sent up; the head of
   operations routes it down to the owner (that is how the `active_key` bug was fixed on 2026-10-30: found by the step 2
   session, fixed by the CLI builder, on the owner's routing).
2. **Memory is the charter, not the session.** Every settled choice goes into the charter (or DECISIONS.md if it binds the
   platform); every finished slice adds one dated line to the charter's position log; every open item is listed. A new head
   session reads the charter and continues.
3. **Proof as the whole platform defines it** (`docs/blueprint/23-GROUND-RULES.md`): a rule is a test with a mutant; done means
   observed output pasted; UNPROVEN / NOT DONE / BLOCKED are the words; two failed approaches to one obstacle = BLOCKED.
4. **Reports go up short, proofs go into files.** Two lines up (what is PROVEN, what is open); the output lines live in
   PROGRESS.md or the department's proof file named in the charter.
5. **Mechanically enforceable means a tool, not a document.** What a department learns to check becomes a CLI command or a
   gate with tests (the PEWP audit rules become `omnikom audit` gates, not a prompt a session may skip); what is judgement stays
   a skill or a document.
6. **Live things need the owner's click** (CLAUDE.md rule 6 and 12); a department never widens its own permissions.

## Starting a department
`node tools/departments/new-department.mjs --slug <slug> --name "<Name>" --mission "<one sentence>" --owns <path> [--owns <path>]
[--head-model fable] [--builder-model sonnet]` writes `docs/departments/<slug>.md` from `TEMPLATE.md` and adds the row below.
`node tools/departments/check.mjs` validates every charter (required sections present, owned paths unique across charters,
models named, position log present). Tests: `tools/departments/test/run.mjs`, mutants `test/mutate.mjs`.

## The departments
| Slug | Department | Head | Builders | Owns (summary) |
|---|---|---|---|---|
| head-of-operations | Head of operations | fable | none (starts department heads) | planning/, .claude/, docs/departments/, tools/departments/, CLAUDE.md |
| platform-build | Platform build (the build sequence, one session per step) | fable | fable per step (DECISIONS 32), sonnet for mechanical pieces | supabase/, factory/, contracts/, docs/blueprint/ (except 26), sites/ |
| cli-and-testing | CLI and testing tooling (the omnikom CLI, the client stand-in, the gates) | fable | sonnet per slice | tools/omnikom-cli/, docs/blueprint/26-PLATFORM-CLI.md, tools/crm-map/, tools/test/ |
