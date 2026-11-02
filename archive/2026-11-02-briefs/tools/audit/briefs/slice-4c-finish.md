# Brief: finish audit slice 4c (Sonnet builder; one slice, discarded when done)

Department: SEO and audits (`docs/departments/seo-and-audits.md`). Head: HEAD_SEO-and-audits_2026-11-01; report to it only. Anything outside
this brief is a finding you send back, not a fix. Read first: `tools/audit/briefs/slice-4c-noindex-header.md` (the slice; every part of it
still holds except where this brief overrides it), then `tools/audit/README.md` section "The build target (slice 4c)".

## Where it stands
The first 4c builder died mid-fix. Its work is uncommitted in this checkout: `tools/audit/` README.md, index.mjs, lib/context.mjs,
lib/site.mjs, live.mjs, run.mjs, test/run.mjs, test/mutate.mjs, fixtures/build-fixtures.mjs and the new fixtures; new checks/env-001.mjs,
rules/ENV-001.md, lib/headers.mjs; and the skill SOURCE `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance\scripts\lib-site.mjs`.
Its last outputs: test/run.mjs 545 of 545, build-fixtures 127, 45 new mutants 45 caught, 29 rules. Then it was told "no target prints
nothing" and partly applied that (`checks/env-001.mjs:18` `if (!site.target) return [];`, README "ENV-001 prints NOTHING").

## The ruling that overrides that (head of operations, 2026-11-01 07:30, final)
**A run with no target prints exactly ONE ENV-001 line: `SKIP ENV-001 <subject> no --target`**, in folder mode and in snapshot mode. A
check that did not run is never silent. Everything else about no target stays as the first brief says (folder ignores `_headers`;
snapshot feeds the header into `page.noindex`).

## What to do
1. `checks/env-001.mjs`: no target returns one SKIP finding (pick the subject the engine uses for site-wide SKIPs, e.g. the first
   rule's pattern or `/`; say which in the rule file). Fix the header comment. `subjects()` must agree with what `run()` prints.
2. Tests in `tools/audit/test/run.mjs`: every no-target run of `good`, `snapshot-good` and the other fixtures expects exactly one
   ENV-001 SKIP and no other ENV-001 line; a no-target run of `bad-ENV-001-preview` prints that SKIP and no FAIL. Undo any edit the
   first builder made that hid or allowed-away this line in a looser way. Watch each new test fail for the right reason (empty the
   SKIP, see red, restore) and paste the red line.
3. Mutants in `test/mutate.mjs`: (a) the SKIP removed (no-target prints nothing) is caught; (b) no target judged as production is caught.
   Run only yours: `node ~/.claude/scripts/heavy.mjs -- env MUTATE_ONLY='<regex>' MUTATE_JOBS=1 node tools/audit/test/mutate.mjs`.
4. README and `rules/ENV-001.md`: say "a run with no target prints one `SKIP ENV-001 ... no --target` line and judges no indexing"; keep
   the `REQUIRE_TARGET_FOR_FOLDER` paragraph (it is still the one-line switch for later).
5. Light follow-ons in other departments' files (DECISIONS 43(2); the head of operations approved them; change ONLY the expectation
   literal so it allows exactly one ENV-001 SKIP when no target is given, nothing else, no behaviour change):
   - `factory/test/run.mjs` (platform build): the assertion(s) that failed with `SKIP ENV-001 (no target)`.
   - `tools/omnikom-cli/test/run.mjs` (CLI and testing) around lines 268, 273, 285: the "0 SKIP" expectations.
   - Grep for any other test that counts SKIP lines of a tools/audit run (`factory/runner/test/`, `tools/omnikom-cli/test/`,
     `docs/blueprint/specs/`, `sites/`); report each with file:line; change it only if it is the same kind of literal.
   List every follow-on edit (file, line, before, after) in the proof file.
6. Proof file `tools/audit/proof/4c.md` (new): what changed, the watched-red lines, every gate's last line, the follow-on list, UNPROVEN
   items. Add the block "## SEO and audits, slice 4c: the noindex header and the build target (<date time>, builder)" above the slice
   4b.1 block in `docs/blueprint/PROGRESS.md` with the same last lines.

## Done when (paste the real last lines into the proof file; your report to the head is five lines at most)
```
node tools/audit/test/run.mjs                                              OK: N of N, exit 0
node tools/audit/run.mjs --list                                            29 rules
node tools/audit/fixtures/build-fixtures.mjs --check                       OK: N fixture(s) equal the generator output
node tools/audit/run.mjs tools/audit/fixtures/good                         exit 0, exactly one ENV-001 line, a SKIP "no --target"
node tools/audit/run.mjs tools/audit/fixtures/good --target production     exit 0, 0 FAIL
node tools/audit/run.mjs tools/audit/fixtures/good-preview --target preview   exit 0, 0 FAIL
node tools/audit/run.mjs tools/audit/fixtures/snapshot-bad-IDX-001-header  exit 1, FAIL IDX-001
node factory/test/run.mjs                                                  OK: 88 of 88
node tools/omnikom-cli/omnikom.mjs ... --unit (the CLI unit run; find the exact command in tools/omnikom-cli/README.md)   all pass
your MUTATE_ONLY run through heavy.mjs                                     N mutants, N caught, 0 survived, 0 not run
```
Do NOT run the full `mutate.mjs`, `run-all-gates`, a live site or a browser (the full proof runs on GitHub).

## Rules
- Edit only `tools/audit/`, the one skill SOURCE file (only if the SKIP change needs it; it should not), and the follow-on literals in 5.
  Node built-ins only. Scripts in files, never inline `node -e`. No em dash characters in any file.
- Other departments' heads have uncommitted and staged work in this same checkout: never `git add`, commit, stash, reset, checkout or
  switch branches; never touch a file not named here. Stop only processes you started, by PID. Delete only folders your runs made.
