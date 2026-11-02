# Brief 5-E: the runner and the factory tests tell the audit which build it is judging (ENV-001)

Head: `HEAD_Platform-build_2026-11-01c` (report by SendMessage to that name). Builder: `BUILDER_platform-build_5-E` (Sonnet).
Anything outside this brief is a finding you send back, not a fix.

## Why
SEO slice 4c (f75cc64, on master) added rule ENV-001: a preview build must carry noindex (header or meta), a production
build must not. `tools/audit` judges it only when told the target (`--target preview|production` on `run.mjs`,
`{ target }` on `audit()` in `tools/audit/index.mjs:69`); with no target it prints one `SKIP ENV-001 / no --target` line.
Today nothing of ours passes a target, so a preview that lost its noindex, or a production build that kept it, publishes.
Once this lands, SEO flips `REQUIRE_TARGET_FOR_FOLDER` (`tools/audit/index.mjs:16`, theirs, not yours) so a folder with no
target is refused.

## Do
1. `factory/runner/publish.mjs`, step 4 gating (about line 143): pass `--target` to `tools/audit/run.mjs`. The value is the
   same decision the deploy step makes a few lines later (`branch = exp.site.state !== 'live' ? 'preview' : 'main'`):
   `main` is `production`, `preview` is `preview`. Compute it once, before gating, and use it in both places, so the audit
   and the deploy can never disagree.
2. `factory/test/run.mjs`: every `AUDIT.audit(dir)` call (about lines 231, 235, 316, 318, 322) passes `{ target }` matching
   how that build was made (a build of a site in state `live` is `production`, otherwise `preview`; read how each build in
   the file is made, do not guess). Then the good-build check at about line 317 no longer allows a `SKIP ENV-001` line:
   remove that allowance in the same change and require ENV-001 to PASS on the good build.
   Careful: the shared working tree's `factory/test/run.mjs` holds one uncommitted line from SEO (a `SKIP PMP-001 / no
   --prompt-coverage` allowance on line 317) and was saved with CRLF line endings. Build from master's version of the file
   (`git show HEAD:factory/test/run.mjs`), LF endings, and do NOT carry SEO's PMP-001 line: it lands with SEO's slice.
   If master's good build now prints a PMP-001 SKIP line and the check fails on it, that is a finding, not a fix.
3. Tests for the runner, in the runner's own test (`factory/runner/test/`): a preview export audits with `--target preview`,
   a live export with `--target production`. Watched red: break the mapping (swap the two) and see the test fail naming the
   target; restore. Add a mutant to `factory/runner/test/mutate.mjs` for the swap.
4. A preview build with no noindex must now stop at gating: plant it in a scratch copy (remove the X-Robots-Tag line that
   `factory/lib/launch.mjs:25` adds for a preview) and paste the ENV-001 FAIL line. Scratch only, never in the repo.

## Done when (paste real output lines into your report)
- `node factory/test/run.mjs`: OK line with the count; the good-build check names ENV-001 PASS.
- `node factory/runner/test/run.mjs` (or the runner's test command named in `factory/runner/test/`): OK; the swap watched red.
- `node factory/runner/test/mutate.mjs`: the new mutant caught, 0 escaped.
- `git diff --stat` shows only `factory/runner/publish.mjs`, `factory/test/run.mjs`, files under `factory/runner/test/`.
- Heavy commands through `node ~/.claude/scripts/heavy.mjs -- <cmd>` (bounded 30 min, then BLOCKED with the holder).
- No staging command, no commit, no push (the head lands it). No em dashes. Work in a temp worktree of master the head
  names, not in the shared tree.

## Report (two lines to the head, details in the body)
PROVEN / NOT DONE / BLOCKED; files changed; the watched-red lines and the mutant line pasted.
