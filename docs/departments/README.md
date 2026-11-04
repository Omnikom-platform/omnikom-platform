# Departments: who owns what, and how sessions are organised (DECISIONS 33)

Written 2026-10-30 from the owner's steer: "a master session that spins up builder sessions ... an orchestrator for that
department that creates the tools that will be used for the long run ... so we never have to figure our way from scratch in
sessions that know nothing or rely on memory that expires". The files are the memory. A session that expires loses nothing
that is written here.

## The shape
- **Head of operations** (one Opus 5.5 session, the lead; Fable 5.1 until 2026-10-31, DECISIONS 40): talks to the owner and to department heads only. Verifies every
  department's proof with its own re-run before a step is called done (Rule 2), routes cross-department findings, records
  decisions in `planning/DECISIONS.md`, keeps `.claude/POSITION.md`.
- **A department** = one charter file in this folder (`docs/departments/<slug>.md`), a head session, builder sessions, and a
  set of files nobody else edits. The charter says what it owns, what it never touches, how its head and builders start, what
  its proof is, and holds its position log at the end.
- **Head of a department** (Opus 5.5): reads its charter first, splits work into slices, starts one builder session per slice
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
8. **Every change follows its chain; only the head pushes** (DECISIONS 43). Before a commit, `omnikom impact` lists who
   imports, reads or copies the changed files. A light follow-on in another department's file (a fixture value, a test
   literal) is made in the same commit and named in the report with its owner, whose head gets a notice; anything bigger is
   a notice to that head, who sequences it. Builders never commit or push: the head reads the impact output, runs locally only the
   suites the change touches, then commits and pushes. The full gates (`run-all-gates.mjs`, every mutant run) run on GitHub on a
   `check/<department>/<slug>` branch, never as a full local run: the laptop runs one heavy job at a time and a full Windows
   run took over an hour while it blocked every other department (2026-11-04). Master moves only to a commit GitHub passed
   (DECISIONS 45); every commit that changes a doc regenerates `icm/` itself (`node tools/icm/index.mjs`), since CI checks it.
   A screen block also passes the dashboard flows on staging before its land, staging taking only a tip CI passed: CI's
   mocked units passed the CRM screens while the staging flows showed 5 of 17 red (2026-11-04). When two green branches race
   for master, the head of operations sets the order; a branch refused twice gets a held slot.

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

## Context load and handover (owner, 2026-11-01 06:30; thresholds from prices 2026-11-01 15:27)
A head runs `node tools/departments/context-load.mjs` at every slice boundary, reads its own line and sends it up as the CTX
report line of `skills/context-economics/SKILL.md`; the head of operations runs it when it starts and at each report it reads.
The thresholds come from Anthropic's prices (`tools/departments/prices.json`) and this project's measured fresh-start cost, with
the math in the skill: SWAP when a fresh session pays back within 100 calls (Opus 5.5 and Sonnet 5.5: context 209,200 tokens or
more; Fable 5.1: 273,200; Haiku 5.5: 177,200) or at 2 compactions; WATCH when it pays back within 200 calls (Opus and Sonnet
170,600; Fable 202,600; Haiku 154,600) or at 1 compaction. SWAP means: at the next slice boundary, never mid-slice, the head
writes a HANDOVER block at the end of its charter's position log (in-flight builders and branches with shas, the next slice, open
findings, anything waiting on the owner; what not to carry is in the skill), stops starting work, and the head of operations
starts a fresh head with the same charter. The old head is archived once its in-flight builders have reported and the new head
has confirmed it read the block. WATCH means: plan the handover at the end of the current slice. COLD (idle past the 1 hour
cache) means the next turn rewrites the whole context; above about 193,000 tokens (Opus, Sonnet) write the handover before a
long idle instead. There is no separate router session; the tool and the head of operations are the router (DECISIONS 40).

## The workspace: one home for all Omnikom Platform work (work order 04, 2026-11-04)
```
E:\Omnikom Platform\                    heads and the head of operations open here (short CLAUDE.md, README.md)
  code\main\                            THE repository: a clone of GitHub master (remote backup-gh); the git-ignored key folders
                                        ("creds and accounts login", .secrets), film\ and .tools\ live here, never committed
  departments\<slug>\builders\<slice>\  one git worktree of code\main per builder, made by start-builder.mjs, removed after it lands
  resume\                               RESUME.md (how to get back in), start-omnikom.cmd, resume-head-of-operations.cmd
  archive\                              the old top-level checkout (2026-11-04-old-checkout) and the old launchers, frozen
```
Everything that must survive a lost laptop is versioned in the repository (charters, the book, `work/STATE.md`, `icm/`); the top
level holds only folders, launchers and a short CLAUDE.md. Heads run the tools from the top level as `node code/main/tools/...`.
After every land, `omnikom land` fast-forwards `code\main` to master when none of the changed paths is dirty there (it is where
master is checked out). A builder's worktree is removed (`git worktree remove`) once its commit is in master.

## Starting and stopping a builder session (owner, 2026-11-01 06:26)
A head starts a builder with `node tools/departments/start-builder.mjs --dept <slug> --slice <name>`: it makes the builder's
worktree `departments\<slug>\builders\<slice>` (detached at backup-gh/master, the builder names its `check/<department>/<slug>`
branch; `--cwd <dir>` starts it elsewhere instead), writes a clean
launcher, opens the session in its own window, waits until the session is registered and prints {name, pid, model, cwd}. The
head then sends the brief with SendMessage to `BUILDER_<dept>_<slice>` (the brief names the files to read, the done-when, and
"anything outside this brief is a finding you send back, not a fix") and carries on with other work; the builder reports back
by SendMessage to the head's name. When the report is in and the head has re-run the gate itself, it stops the builder with
`node tools/departments/stop-builder.mjs --pid <pid>` (a session cannot end itself) and confirms nothing is left. Hands-on work
(diagnosis, settings, proof runs) belongs to builders or Haiku runners, never the head; a head that does it in its own session
is filling the context this route exists to keep clear.

## Switching Claude accounts (DECISIONS 49 (e); docs read 2026-11-01)
1. Each head finishes its slice and writes its HANDOVER block; the head of operations writes its own in `.claude/POSITION.md`.
2. Stop every session of ours: `node tools/departments/start-all.mjs --dry-run` lists them with the stop command for each.
3. In any terminal: `claude auth logout`, then `claude auth login` and pick the other account in the browser. The login is one
   file per config folder (`%USERPROFILE%\.claude\.credentials.json`), so hooks, skills, memory and settings stay as they are; the
   docs do not say what an open session does when the account changes, which is why step 2 comes first
   (code.claude.com/docs/en/authentication, "Credential management"; /errors#not-logged-in).
4. Double-click "Start Omnikom" on the Desktop (`E:\Omnikom Platform\resume\start-omnikom.cmd`): it shows the account, refuses while anything
   of ours is live, starts one head of operations and sends it `docs/departments/briefs/takeover-after-account-switch.md`.

## Starting a department
`node tools/departments/new-department.mjs --slug <slug> --name "<Name>" --mission "<one sentence>" --owns <path> [--owns <path>]
[--head-model opus] [--builder-model sonnet]` writes `docs/departments/<slug>.md` from `TEMPLATE.md` and adds the row below.
`--from <file.json>` takes the same fields from a JSON file (slug, name, mission, owns, rules, proof, decisions, open), which is
how a long charter is written without a long command line.
`node tools/departments/check.mjs` validates every charter (required sections present, owned paths unique across charters,
models named, position log present). Tests: `tools/departments/test/run.mjs`, mutants `test/mutate.mjs`.

## The departments
| Slug | Department | Head | Builders | Owns (summary) |
|---|---|---|---|---|
| head-of-operations | Head of operations | opus | none (starts department heads) | planning/, .claude/, docs/departments/, tools/departments/, CLAUDE.md |
| platform-build | Platform build (the build sequence, one session per step) | opus | opus per step (DECISIONS 32, 40), sonnet for mechanical pieces | supabase/, factory/, contracts/, docs/blueprint/ (except 26), sites/ |
| cli-and-testing | CLI and testing tooling (the omnikom CLI, the client stand-in, the gates) | opus | sonnet per slice | tools/omnikom-cli/, docs/blueprint/26-PLATFORM-CLI.md, tools/crm-map/, tools/test/ |
| seo-and-audits | SEO and audits | opus | sonnet per slice | skills/programmatic-enterprise-web-performance/, tools/audit/, docs/blueprint/22-SEARCH-AND-ANALYTICS.md |
| clients | Clients | opus | sonnet per slice | clients/, sops/clients/, docs/listings/, templates/client-questions/, tools/client-questions/, tools/team-kit/ |
