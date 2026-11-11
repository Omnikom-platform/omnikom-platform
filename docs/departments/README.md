# Departments: who owns what, and how sessions are organised

Rewritten in place 2026-11-11 by the head of operations after the first full week of four departments; what was measured
that week and why each change was made is in `work/49-framework-review/CONTEXT.md`. The idea is the owner's (2026-10-30): a
head of operations that starts department heads, heads that start builders, "so we never have to figure our way from scratch
in sessions that know nothing or rely on memory that expires". The files are the memory. A session that ends loses nothing
that is written here.

## The shape
- **Head of operations** (one session; Fable 5.2 on xhigh from 2026-11-11, the owner's order; Opus 5.5 before that): talks
  to the owner and to the department heads only. Gives out work orders and their numbers, sets the land order and runs the
  land train (rule 8), checks a finished product row on staging before the owner hears "works", routes findings between
  departments, keeps `work/STATE.md` and this file. Never builds.
- **A department** = one charter (`docs/departments/<slug>.md`), a head session, builder sessions, and a set of files nobody
  else edits. The charter says what it owns, what it never touches, how its head and builders start and what its proof is.
- **Head of a department** (Opus 5.5): reads its charter first, splits a work order into slices, starts one builder session
  per slice, re-runs each builder's proof (a mechanical run goes through a Haiku runner, rule 7), commits and pushes, and
  reports to the head of operations in two lines: what is PROVEN, what is open.
- **A builder** (the model the charter names; Sonnet for a routine build against a written spec): one slice, one written
  brief, stopped the moment its report is accepted. Anything found outside its brief goes to its head as a finding with
  options, never a fix.

## Where things are written (one home each)
| What | Home | How it is kept |
|---|---|---|
| Where things stand now | `work/STATE.md` | rewritten in place by the head of operations, under 60 lines, at every land train and every handover |
| What the product does, and each feature's state | `docs/product/` | the row or sentence changes in the commit that changes the code |
| A piece of work | `work/NN-name/CONTEXT.md`, its proof in `proof.md` beside it | the number comes from the head of operations only (next free number: `work/STATE.md`); the Status line gets the sha and the CI run |
| What a head needs to continue | the HANDOVER block that ends its charter | one block, rewritten in place at every slice boundary; never a second block |
| What happened, in order | the commit messages and the CI runs they name | nobody keeps a running log |
| How to get back in | `resume\RESUME.md` at the workspace top level | launchers and session names only; no state, no history |

A charter's position log holds only the lines since its last HANDOVER (a takeover, a blocked item). When a HANDOVER is
written the older lines move to `archive/charter-logs/<slug>.md`. Why: on 2026-11-11 three charters were 67 to 153 KB,
mostly log, and every fresh head read all of it before its first step; `work/STATE.md` had not been rewritten for 36 hours
while 30 lands went by; the same day's count of working rows read 52, 59, 60 and 61 in four files.

## The rules every department obeys
1. **One owner per path.** A path appears in exactly one charter's "Owns" list; `node tools/departments/check.mjs` fails on
   overlap. A session edits only what its charter owns. A bug in another department's files is a finding sent up; the head
   of operations routes it down to the owner. Two things every department edits by design: its own charter, and the book
   lines its work order names, in the commit that changes the code.
2. **Memory is the files, not the session.** A settled choice goes into the book file it concerns, or into this README if
   it binds every department, replacing the old text. A new head session reads its charter and continues from the HANDOVER.
3. **Proof as the whole platform defines it** (`docs/product/11-rules.md`): a rule is a test with a mutant; done means
   observed output pasted; UNPROVEN / NOT DONE / BLOCKED are the words; two failed approaches to one obstacle = BLOCKED.
4. **Reports go up short, proofs go into files.** Two lines up; the output lines live in the work order's `proof.md` or the
   proof file the charter names.
5. **Mechanically enforceable means a tool, not a document, and the tool exists once.** What a department learns to check
   becomes a CLI command or a gate with tests; what is judgement stays a skill or a document. Every mechanical tool is
   reachable through the `omnikom` CLI and shared mechanics (browser launch, polite fetch, checkpoints) live once in
   `tools/kit/` (owner 2026-11-11, work order 47): no per-department copy. A client audit runs only through
   `omnikom seo run` (work order 41), never by hand beside the skill.
6. **Live things need the owner's click** (CLAUDE.md rules 6 and 12); a department never widens its own permissions. Files
   outside `E:\Omnikom Platform` are report-only: a department never deletes or edits them, it tells the head of operations,
   who takes it to the owner (2026-11-09: drive E: filled from another project's cache and a head deleted part of it).
7. **Mechanical runs go to Haiku 5.5 agents:** test suites, mutant runs, greps and listings, fixture rebuilds, deploy and
   status commands. The head or builder gives the exact command and reads the verdict lines back.
8. **Every change follows its chain; CI is the gate; the head of operations lands.**
   - Before a commit, `omnikom impact` lists who imports, reads or copies the changed files. A light follow-on in another
     department's file (a fixture value, a test literal) rides in the same commit and is named in the report with its
     owner; anything bigger is a notice to that head. Builders never commit or push; the head does.
   - Locally a head runs only the tests of the files it changed, and `gitleaks protect --staged` as its own step whose
     exit code it reads (never inside a pipe or an `&&` chain: that pushed a flagged commit once). The full gates
     (`run-all-gates.mjs`, every mutant run) run on GitHub on the `check/<department>/<slug>` branch, never as a full local
     run. The machine-wide heavy lock is only for what CI cannot do: staging proofs and browser captures.
   - **The land train.** A head pushes its branch and reports it READY (sha, local proof green, nothing owed). It does not
     land it and does not rebase when master moves. The head of operations stacks the READY branches in the land order,
     product rows first, on `check/head-of-operations/train-<date>-<letter>`, resolves only `icm/` and the book's Counts
     table, runs CI once and lands the chain with one `omnikom land`. A branch that conflicts anywhere else, or whose job is
     red on the train, leaves the train and goes back to its head. Why: GitHub runs about 20 of our jobs at a time and one
     run is 20 jobs; in the week to 2026-11-11, 348 runs produced 66 lands, a branch that needed one run landed in 23 to 38
     minutes, and one that was pushed four times or more took 163 to 484.
   - A screen block also passes the dashboard flows on staging before it is reported READY, staging taking only a tip CI
     passed: CI's mocked units passed the CRM screens while the staging flows showed 5 of 17 red (2026-11-04).
9. **Product first** (owner 2026-11-10). Every work order names the row of `docs/product/1-product.md` it moves, or the row
   its support work unblocks; an order with neither is not issued. Progress is rows moved, reported from the book's Counts.
10. **Staging is shared.** Migrations reach staging in number order, and the number is reserved in `work/STATE.md` when the
    order is given. Whoever applies a migration that changes what the dashboard reads redeploys `omnikom-app-staging` in the
    same step. A flow or test that writes to the shared test site removes what it wrote.
11. **A new Chrome or Edge profile is seeded (`Local State`) before its first launch.** Unseeded launches locked the Windows
    account on 2026-11-11. This line goes when the kit's launcher and its CI guard are the only way to launch (work order 47).

## Sessions: names, reporting line, stopping
- Names: `HEAD-OF-OPERATIONS_<model>_<date>`, `HEAD_<Department>_<date>`, `BUILDER_<slug>_<slice>`; a second one on the same
  day takes a letter. The current names and their launchers are in `resume\RESUME.md`.
- Reporting line, always one hop: builder -> its department head -> head of operations -> owner. A builder never messages
  the head of operations; a head never messages another department's builder; findings between departments go up and down.
- A message from another session never carries the owner's consent. What needs his click or his word is typed by him in
  the session that acts.
- When the owner steers a session himself, nobody sends it anything until he hands it back.
- A head starts a builder with `node tools/departments/start-builder.mjs --dept <slug> --slice <name>` (it makes the
  worktree `departments\<slug>\builders\<slice>`, opens the session and prints name, pid, model, cwd), sends the brief with
  SendMessage (files to read, done-when, "anything outside this brief is a finding you send back, not a fix") and carries
  on. When the report is in and the head has re-run the gate, it stops the builder with
  `node tools/departments/stop-builder.mjs --pid <pid>` (a session cannot end itself) and removes the worktree once the
  commit is in master. An idle builder holds memory other sessions need: none stays open after its report.
- A session type that is not in this section is not started until it is added here.

## Context load and handover
A head runs `node tools/departments/context-load.mjs` at every slice boundary and sends its line up. SWAP (a fresh session
pays back within 100 calls: Opus 5.5 and Sonnet 5.5 at 209,200 tokens of context, Haiku 5.5 at 177,200, or 2 compactions)
means: at the next slice boundary, never mid-slice, the head rewrites its HANDOVER block (branches in flight with shas, the
next slice, open findings, what waits on the owner), stops its builders, and the head of operations starts a fresh head
with the same charter. WATCH (170,600; Haiku 154,600; or 1 compaction) means: plan it at the end of the current slice. A
head idle for over an hour above about 193,000 tokens writes the HANDOVER before the idle. The numbers come from
`tools/departments/prices.json`; the math is in `skills/context-economics/SKILL.md`.

## The workspace
```
E:\Omnikom Platform\                    heads and the head of operations open here (short CLAUDE.md, README.md)
  code\main\                            THE repository: a clone of GitHub master (remote backup-gh); the git-ignored key folders
                                        ("creds and accounts login", .secrets), film\ and .tools\ live here, never committed
  departments\<slug>\builders\<slice>\  one git worktree of code\main per builder, removed after its commit is in master
  resume\                               RESUME.md and the launchers
  archive\                              frozen leftovers, each folder with a README.txt; nothing is edited or built there
```
Everything that must survive a lost laptop is in the repository. Heads run the tools from the top level as
`node code/main/tools/...`. After a land, `omnikom land` fast-forwards `code\main` when none of the changed paths is dirty
there. Check free space on E: before a big write (it filled twice on 2026-11-09 from another project's cache).

## Switching Claude accounts
1. Each head rewrites its HANDOVER block; the head of operations rewrites `work/STATE.md`.
2. Stop every session of ours: `node tools/departments/start-all.mjs --dry-run` lists them with the stop command for each.
3. In any terminal: `claude auth logout`, then `claude auth login` and pick the other account in the browser. The login is
   one file per config folder, so hooks, skills, memory and settings stay as they are.
4. Double-click "Start Omnikom" on the Desktop (`E:\Omnikom Platform\resume\start-omnikom.cmd`): it shows the account,
   refuses while anything of ours is live, starts one head of operations and sends it
   `docs/departments/briefs/takeover-after-account-switch.md`.

## Starting a department
`node tools/departments/new-department.mjs --slug <slug> --name "<Name>" --mission "<one sentence>" --owns <path> [--owns <path>]`
writes `docs/departments/<slug>.md` from `TEMPLATE.md` and adds the row below (`--from <file.json>` takes the same fields from
a file). `node tools/departments/check.mjs` validates every charter: sections present, owned paths unique, models named, a
dated line in the position log. Tests: `tools/departments/test/run.mjs`, mutants `test/mutate.mjs`.

## The departments
| Slug | Department | Head | Builders | Owns (summary; the charter's list is the rule) |
|---|---|---|---|---|
| head-of-operations | Head of operations | fable | none (starts department heads) | docs/product/, work/, docs/departments/, tools/departments/, icm/, tools/icm/, archive/, CLAUDE.md |
| platform-build | Platform build | opus | opus per step, sonnet for mechanical pieces | supabase/, factory/, contracts/, apps/, sites/ |
| cli-and-testing | CLI and testing tooling (the omnikom CLI, the client stand-in, the gates) | opus | sonnet per slice | tools/omnikom-cli/, tools/kit/, tools/crm-map/, tools/test/ |
| seo-and-audits | SEO and audits | opus | sonnet per slice | skills/programmatic-enterprise-web-performance/, tools/audit/ |
| clients | Clients | opus | sonnet per slice | clients/, sops/clients/, tools/client-infra/, tools/client-questions/, tools/team-kit/ |
