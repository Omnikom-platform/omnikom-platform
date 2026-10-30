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
7. **Mechanical runs go to Haiku 5.5 agents** (DECISIONS 34): test suites, mutant runs, the gates, greps and listings, fixture
   rebuilds, deploy and status commands. The head or builder gives the Haiku agent the exact command and reads the verdict
   lines back; the beefy models spend their turns on judgement, code and reading results, never on waiting for a run.

## Where sessions live and who they talk to (owner, 2026-10-30 19:51)
- Sidebar: every session is filed under its department's group, named `Omnikom: <department name>` (head of operations,
  platform build, CLI and testing). A session the head of operations starts for a department is detached from the head's
  family and filed under that department's group, so the sidebar shows the departments, not who clicked start.
- A brief names the current head's session id, and a session that was started by someone else (an earlier head, a hand-over)
  is re-told its head by id when the head changes; the app's own turn-end notes still go to whoever clicked start, so a
  report that lands at an old head is relayed, never acted on there (2026-10-30 20:18: the CLI builder reported to the
  previous head of operations out of habit; relayed, re-pointed).
- Reporting line, always one hop: builder -> its department head -> head of operations -> owner. A builder never messages the
  head of operations; a department head never messages another department's builder; cross-department findings go up to the
  head of operations and down to the owner department. Session ids of the heads are in each charter's position log when they
  change; the current ones are in `.claude/POSITION.md`.

## Every session type has a head it can talk to (owner, 2026-10-30 19:59)
| Session type | Department | Talks to (one hop up) | Started by |
|---|---|---|---|
| Head of operations | head-of-operations | the owner | the owner, or the previous head's hand-over |
| Department head (CLI and testing; every future department) | its charter | head of operations | head of operations |
| Builder of a department (one slice) | its head's charter | its department head | its department head |
| Platform build head (standing from step 4, DECISIONS 34) | platform-build | head of operations | head of operations |
| Platform step session (steps 2 and 3 ran this way; from step 4 only when the platform head asks for one) | platform-build | the platform build head | head of operations, on the platform head's request |
| Builder of a department (one slice) or a step session | its head's charter | its department head (or the step session) | its department head |
| Haiku runner (a mechanical run: tests, mutants, gates, grep, deploy, status) | the department it runs for | the head or builder that gave it the command | that head or builder |
| Setup or one-off assistant beside the owner | the department whose files it touches | head of operations | head of operations |
Session titles carry the role so the owner knows them at a glance (owner, 2026-10-30 20:04): `HEAD OF OPERATIONS: ...`,
`HEAD: <department>`, `BUILDER (<department>): <slice>`, `STEP <n> (platform build): <what>`, `ASSISTANT (<department>): <what>`;
a finished session gets `, DONE` appended. A session type not in this table is not started until a row is added; `tools/departments/check.mjs` requires every charter to
say whom its head reports to and that its builders send findings back. When a department has no standing head (platform build
today), the head of operations is the head and says so in the brief.

## Starting a department
`node tools/departments/new-department.mjs --slug <slug> --name "<Name>" --mission "<one sentence>" --owns <path> [--owns <path>]
[--head-model fable] [--builder-model sonnet]` writes `docs/departments/<slug>.md` from `TEMPLATE.md` and adds the row below.
`--from <file.json>` takes the same fields from a JSON file (slug, name, mission, owns, rules, proof, decisions, open), which is
how a long charter is written without a long command line.
`node tools/departments/check.mjs` validates every charter (required sections present, owned paths unique across charters,
models named, position log present). Tests: `tools/departments/test/run.mjs`, mutants `test/mutate.mjs`.

## The departments
| Slug | Department | Head | Builders | Owns (summary) |
|---|---|---|---|---|
| head-of-operations | Head of operations | fable | none (starts department heads) | planning/, .claude/, docs/departments/, tools/departments/, CLAUDE.md |
| platform-build | Platform build (the build sequence, one session per step) | fable | fable per step (DECISIONS 32), sonnet for mechanical pieces | supabase/, factory/, contracts/, docs/blueprint/ (except 26), sites/ |
| cli-and-testing | CLI and testing tooling (the omnikom CLI, the client stand-in, the gates) | fable | sonnet per slice | tools/omnikom-cli/, docs/blueprint/26-PLATFORM-CLI.md, tools/crm-map/, tools/test/ |
| seo-and-audits | SEO and audits | fable | sonnet per slice | skills/programmatic-enterprise-web-performance/, tools/audit/, docs/blueprint/22-SEARCH-AND-ANALYTICS.md |
| clients | Clients | fable | sonnet per slice | clients/, sops/clients/, docs/listings/, templates/client-questions/, tools/client-questions/, tools/team-kit/ |
