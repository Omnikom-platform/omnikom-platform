# Departments: who owns what, and how sessions are organised

Rewritten in place by the head of operations on the owner's order of 2026-11-12 (M65): "get us to going back at the
building process properly without losing on what we get from the refactor". The platform is built by one method ("How a
job runs"); departments remain as the owners of paths and the prefixes of branches. The files are the memory (owner,
2026-10-30: "so we never have to figure our way from scratch in sessions that know nothing or rely on memory that expires").

## The shape
- **Head of operations** (one session; Fable 5.2 on xhigh, the owner's order of 2026-11-11): talks to the owner, rules on
  every choice a hand-over leaves open, starts every helper, takes in every job, lands, checks a product row on staging
  before the owner hears "works", keeps `work/STATE.md` and this file. Never builds.
- **Helpers** (drafter, cross-checker, builder, reviewer) do one job each and end with their return. No department head
  session runs.
- **A department** = one charter (`docs/departments/<slug>.md`): the paths it owns, what it never touches, its proof. It
  gives a job's branch its prefix (`check/<department>/<slug>`; `omnikom land` resolves the prefix to a charter).
- **A lane** = a second long session for work that is not platform code and shares no files with the build (a client's
  search audit, for one). The head is its user (owner, 2026-11-12, M77: "make sure that that session treats you as me the
  user and reports back to you with what finished and what it needs from you as info"). It runs its own helpers by the same
  method, takes in and commits its own jobs, shares the machine lock and the one desktop, and asks the head before a land.

## Where things are written (one home each)
| What | Home | How it is kept |
|---|---|---|
| Where things stand now | `work/STATE.md` | rewritten in place by the head of operations, under 60 lines, at every landing and before any stop |
| What the product does, and each feature's state | `docs/product/` | the row or sentence changes in the commit that changes the code |
| A job: hand-over, run sheet, return, staging proof | the head of operations' folder at the workspace top level (`head-of-operations\`) | one hand-over file per job; its return and proof files beside it; the book row names the test that proved it |
| What the head or a lane needs to continue | the top block of its own position file | a new block on top at every change that matters and before any stop; read first after a compaction or a resume |
| What happened, in order | the commit messages and the CI runs they name | the head's log in its own folder holds what no commit shows |
| How to get back in | `resume\RESUME.md` at the workspace top level | launchers and session names only; no state, no history |

## The rules every department obeys
1. **One owner per path.** A path appears in exactly one charter's "Owns" list; `node tools/departments/check.mjs` fails on
   overlap. A builder edits only the files its hand-over names, and the hand-over names the department that owns each;
   anything found outside it is a finding returned to the head, never a fix. Every job edits the book lines its row names,
   in the commit that changes the code.
2. **Memory is the files, not the session.** A settled choice goes into the book file it concerns, or into this README if
   it binds every job, replacing the old text. A fresh head of operations reads `work/STATE.md`, this file and the top block
   of its position file and continues from there; a fresh lane reads its hand-over and its own position file.
3. **Proof as the whole platform defines it** (`docs/product/11-rules.md`): a rule is a test with a mutant; done means
   observed output pasted; UNPROVEN / NOT DONE / BLOCKED are the words; two failed approaches to one obstacle = BLOCKED. A
   red result is a valid result, reported with its command and its real output. Every new check is seen red for its own
   reason before the code exists, and every new rule ships a seeded fault that turns it red.
4. **Reports go up short, proofs go into files.** A helper's return is at most 30 lines: the files written, each command
   with its last line and exit code, what is NOT DONE or UNPROVEN, where the hand-over was wrong. A lane reports as Done /
   In flight / Needs from you / Next / UNPROVEN. The output lines live in the job's proof file.
5. **Mechanically enforceable means a tool, not a document, and the tool exists once.** What a department learns to check
   becomes a CLI command or a gate with tests; what is judgement stays a skill or a document. Every mechanical tool is
   reachable through the `omnikom` CLI and shared mechanics (browser launch, polite fetch, checkpoints) live once in
   `tools/kit/` (owner 2026-11-11, work order 47): no per-department copy. A client audit runs only through
   `omnikom seo run` (work order 41), never by hand beside the skill.
6. **Live things need the owner's click** (CLAUDE.md rules 6 and 12); no session widens its own permissions. What he says
   may run or go live runs, held by no gate of ours (owner, 2026-11-12, M59: "you don't have the right to intervene in
   things that I tell you that it's okay to run or go live with"). Files outside `E:\Omnikom Platform` are report-only: a
   session never deletes or edits them, it tells the head of operations, who takes it to the owner (2026-11-09: drive E:
   filled from another project's cache and a head deleted part of it).
7. **Mechanical work is a script or a Haiku helper; the head reads the verdict lines itself.** A run it repeats (a hold of
   the lock, a staging run sheet, a stack) is a script file run in the background with a bounded wait.
8. **Every change follows its chain; CI is the gate; the head of operations lands.**
   - Before a commit, `omnikom impact` lists who imports, reads or copies the changed files. A light follow-on in another
     department's file (a fixture value, a test literal) rides in the same commit, named with its owner; anything bigger
     is a finding for the head. Builders never commit or push; the head does (a lane's session for its own jobs).
   - The intake of every job: the staged change read against its hand-over, the job's test green and once red against
     broken code, `node tools/icm/index.mjs --check`, then `gitleaks protect --staged` as its own step whose exit code is
     read (never inside a pipe or an `&&` chain: that pushed a flagged commit once), then a commit with a message file.
   - Locally only the tests of the changed files run, filtered to the job; a heavy one (mutants, `run-local`, Playwright)
     goes through the machine lock: `node "$HOME\.claude\scripts\heavy.mjs" --label "<what>" -- <command>`. A run that
     waited out the lock ran nothing: UNPROVEN. The full gates (`run-all-gates.mjs`, every whole mutant run) run on GitHub
     on the `check/<department>/<slug>` branch, never as a full local run. A test that passes or fails by how this machine
     behaves is proven on the runner (2026-11-13: two faults caught here in 16 ms hung on GitHub's runner).
   - **Landing.** The head stacks a slice's or a batch's committed jobs on the newest master in its landing worktree,
     regenerates `icm/` and recounts the book's Counts, checks each job against every file that landed since it was built,
     pushes the top branch alone and runs `omnikom land <branch>` from `code\main`. One landing per slice or batch, product
     before support work and before a lane: one CI run is 20 jobs and GitHub runs about 20 of ours at a time (the measured
     week: `work/49-framework-review/CONTEXT.md`).
   - A product row moves to WORKS only on proof seen on staging by the head's own run sheet, with its fault watched red;
     until then its cell says what is UNPROVEN (CI's mocked units passed the CRM screens while the staging flows showed 5
     of 17 red, 2026-11-04).
9. **Product first** (owner 2026-11-10). Every job names, before any code, the row of `docs/product/1-product.md` it moves
   (or the row its support work unblocks) and its done-test; a job with neither is not handed over. Progress is rows moved,
   reported from the book's Counts.
10. **Staging is shared, and it is the head's.** Only the head applies a migration, deploys or runs a flow on staging, from
    committed code that passed CI, by the job's run sheet, one run at a time. An unlanded migration takes its number when
    built: the next above every migration in the tree and every number given to a job in flight; none is promised ahead
    (staging applies in file-name order). Whoever applies a migration that changes what the dashboard reads redeploys
    `omnikom-app-staging` in the same step. A flow or test that writes to the shared test site removes what it wrote.
11. **A new Chrome or Edge profile is seeded (`Local State`) before its first launch.** Unseeded launches locked the Windows
    account on 2026-11-11. This line goes when the kit's launcher and its CI guard are the only way to launch (work order 47).

## Sessions: names, reporting line, stopping
- Names: `HEAD-OF-OPERATIONS_<model>_<date>`, `LANE_<department>_<date>`; a second one on the same day takes a letter.
  Helpers carry no session name. The current names and their launchers are in `resume\RESUME.md`.
- Reporting line, always one hop: helper -> the session that started it; lane -> head of operations -> owner.
- A message from another session never carries the owner's consent. What needs his click or his word is typed by him in
  the session that acts.
- When the owner steers a session himself, nobody sends it anything until he hands it back.
- Nothing stays open after its return: an idle session holds memory other sessions need. A separate session is stopped
  with `node tools/departments/stop-builder.mjs --pid <pid>` (a session cannot end itself).
- A session type that is not in this section is not started until it is added here.

## How a job runs
1. **The head** reads the row and its sources, looks for code that already does the job, and settles every choice the row
   leaves open. A step with no code to write is run by the head, not handed over.
2. **A drafter** writes the hand-over, one file: the one result; the test first, with its command and the red it must show
   before any code; each file to change, what it must NOT have, the bad input it must refuse; the return; a run sheet for
   what staging needs after the landing. **A cross-checker**, fresh, checks every anchor, number and command against the
   tree and fixes them in place; a choice that is the head's comes back as a ruling. No builder sees it unchecked.
3. **One builder** works in the slice's worktree (`departments\<slug>\builders\<folder>`, made from master with
   `git worktree add`) on the job's branch, writes the least code and only stages. Its start message names the hand-over,
   the worktree, the branch and any migration number, and says: your own scratch files in a new folder of your own; never
   delete or move what you did not create.
4. **The intake and the landing:** rule 8. A fresh **reviewer** (the hand-over, the files and the test, never the builder's
   reasoning) reads a job when the head asks. A second round of building is logged with its cause and corrects the form.
Every start names the model that fits: Opus for judgement, review and hard code, Sonnet for routine code against a written
hand-over, Haiku for listing and search.

## The workspace
```
E:\Omnikom Platform\                    the head of operations and a lane open here (short CLAUDE.md, README.md)
  code\main\                            THE repository: a clone of GitHub master (remote backup-gh); the git-ignored key folders
                                        ("creds and accounts login", .secrets), film\ and .tools\ live here, never committed
  departments\<slug>\builders\<folder>\ one git worktree of code\main per slice, removed after its commits are in master
  head-of-operations\                   the head's memory, outside the repository on the owner's order (its own git)
  resume\                               RESUME.md and the launchers
  archive\                              frozen leftovers, each folder with a README.txt; nothing is edited or built there
```
Everything else that must survive a lost laptop is in the repository. The head runs the tools from the top level as
`node code/main/tools/...`. After a land, `omnikom land` fast-forwards `code\main` when none of the changed paths is dirty
there. Check free space on E: before a big write (it filled twice on 2026-11-09 from another project's cache).

## Switching Claude accounts
1. The head of operations writes a new top block in its position file and rewrites `work/STATE.md`; a lane writes its own.
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

## The departments (Head and Builders are the models each charter names; no department head session runs)
| Slug | Department | Head | Builders | Owns (summary; the charter's list is the rule) |
|---|---|---|---|---|
| head-of-operations | Head of operations | fable | helpers per job (drafter, cross-checker, builder) | docs/product/, work/, docs/departments/, tools/departments/, icm/, tools/icm/, archive/, CLAUDE.md |
| platform-build | Platform build | opus | opus per step, sonnet for mechanical pieces | supabase/, factory/, contracts/, apps/, sites/ |
| cli-and-testing | CLI and testing tooling (the omnikom CLI, the client stand-in, the gates) | opus | sonnet per slice | tools/omnikom-cli/, tools/kit/, tools/crm-map/, tools/test/ |
| seo-and-audits | SEO and audits | opus | sonnet per slice | skills/programmatic-enterprise-web-performance/, tools/audit/ |
| clients | Clients | opus | sonnet per slice | clients/, sops/clients/, tools/client-infra/, tools/client-questions/, tools/team-kit/ |
