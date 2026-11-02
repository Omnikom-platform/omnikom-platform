# Brief 5-A: no platform file names a client (DECISIONS 46 (b), 47 (d))

Head: `HEAD_Platform-build_2026-11-01b` (report by SendMessage to that name). Builder: `BUILDER_platform-build_5-A` (Sonnet).
Anything outside this brief is a finding you send back, not a fix.

## Why
The public check copy (DECISIONS 46) refuses any file that names a client. 66 platform-owned files do (list:
`planning/anonymise-list.md`, section "platform-build"); 14 of them are read by the gates, cli, factory and functions jobs,
which keeps those jobs on laptop runs until the files are clean (DECISIONS 47).

## Inputs
- The list: `planning/anonymise-list.md`, section "platform-build" (names masked there).
- The names: `planning/anonymise-map.md` (PRIVATE: read it, never copy a client name or a contact detail into a report,
  a commit message, a brief, a test name or any file outside `planning/`). Use exactly the neutral names it gives; they are
  the same in every department. Folder renames follow the neutral slug. Contact details (phone, email, street, licence
  numbers) go too, replaced by the map's neutral values. Read the map's rule 1 and its "Extra terms" table: `clients/<slug>/`
  folders are NEVER renamed (the copy gate derives the client list from them), and no platform file may point at a
  `clients/<slug>/` path (drop or neutralise such a reference; if a script needs it, that is a finding);
  `contracts/examples/<slug>/` folders DO rename to the neutral slug; every extra term is neutralised like a name, and
  `--check` looks for the extra terms too.

## How (one deterministic script, so it can be re-applied after each landing)
1. Write `factory/briefs/anonymise-platform.mjs`: it reads the map, rewrites text and renames paths for the platform-owned
   files only (the charter `docs/departments/platform-build.md` "Owns" list; never another department's file), and has
   `--check` (exit 1 and list path:line for every client name or contact detail left in platform files, the names masked as
   in the list) and `--apply`. Replacement by function or split/join, never a replacement string. Fixtures keep their shape:
   same keys, same value types, same lengths where a test counts them.
2. Work in a temporary git worktree of master (`git worktree add <scratch>/anon master`), NOT in the shared tree: the shared
   tree holds unlanded 5.2b and 5.4 changes (openapi.json among them) and other departments' work. The head re-applies the
   script on master after 5-H, 5.2b and 5.4 land.
3. Order: the 14 job-read files first (contracts/examples and every reference to the renamed folders, contracts/test/run.mjs,
   contracts/industry-run/run.mjs and RESULTS.md, docs/blueprint/specs/openapi.json, factory/test/run.mjs,
   factory/worker/pages-function-lead.js, supabase/functions/capture-lead/index.ts, supabase/tests/e2e-lead.mjs,
   supabase/tests/publish-parity.mjs, docs/blueprint/25-BUILD-SEQUENCE.md), then the docs.
4. `supabase/migrations/20261029000002_crm.sql` is an APPLIED migration; DECISIONS 47 (f) (read it) allows one exception:
   its line 7 is a comment only, so edit that comment to the neutral name, and write `supabase/ops/migration-comment-rehash.mjs`
   that, for one named migration file, compares the committed (old) text with the new text, REFUSES (exit 1, names the
   line) unless they differ only in SQL comment lines (`--` lines and `/* */` blocks; a changed statement, a moved line or a
   comment that swallows code is refused), and prints (dry run, the default) or with `--apply --target staging` writes the
   new sha256 to that file's row in `ops.platform_migrations` (read how `supabase/ops/apply-staging.mjs` computes and
   stores it, and use the same function). Test it in `supabase/ops/test/migration-comment-rehash.test.mjs`: a comment-only
   change passes, a statement change, a whitespace change inside a statement and an added statement are refused (each watched
   red), and one mutant (the comment test always true) caught. You never run `--apply`: the head runs it on staging after
   the change is committed. Every other applied migration stays untouched.
5. Renamed folders are referenced from other departments' files (the CLI seed, tools/, tests): run
   `node tools/omnikom-cli/omnikom.mjs impact <changed files>` in the worktree; a one-line path or literal follow-on in
   another department's file is made in the same change and named in the report with its owner (DECISIONS 43 (2)); anything
   bigger is a finding.

## Done when (in the worktree; paste real output lines)
- `node factory/briefs/anonymise-platform.mjs --check` exits 0 after `--apply`, and exits 1 on the untouched master tree
  (watched red), and exits 1 when one name is planted back in one file (restore after).
- The tests the impact list names pass in the worktree: at least `node contracts/test/run.mjs`, `node contracts/industry-run/run.mjs`,
  `node factory/test/run.mjs`, `node docs/blueprint/specs/check-specs.mjs`, `deno task check` for capture-lead, and the
  publish-parity gate if it runs without a cluster (otherwise name it UNPROVEN, the head schedules it). Light runs only; the
  database walls are not part of this slice. Heavy commands through `node ~/.claude/scripts/heavy.mjs -- <cmd>`.
- The rehash script's test passes, its reds and mutant pasted; its dry run on the edited crm migration prints the old and
  new sha256 and "comment-only: yes".
- The copy dry run: `node tools/omnikom-cli/omnikom.mjs copy build <sha|ref> --dry-run` (exit 0 = PASS). Until DECISIONS 46
  lands it lives only in `D:\omk-gates\cli-public-copy`: do not run it yourself; tell the head the worktree's commit-ready
  state and the head has it run. Your `--check` line stands in meanwhile and the report says so.
- No staging, no commit, no push, no edit in the shared tree. No em dashes in any file.

## Report (two lines to the head, details below them)
PROVEN / NOT DONE / BLOCKED; the worktree path; files changed and renamed (counts, paths with neutral names only); follow-ons
in other departments' files with their owner; the masked migration line; the pasted check and test lines.
