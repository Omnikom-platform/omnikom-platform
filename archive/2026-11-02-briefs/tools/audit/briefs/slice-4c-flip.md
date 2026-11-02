# Brief: slice 4c flip, a folder run must name its target (REQUIRE_TARGET_FOR_FOLDER = true)

Head: HEAD_SEO-and-audits (report by SendMessage, two lines; detail in `tools/audit/proof/4c-flip.md`). One Sonnet builder.

## Why
Slice 4c (landed f75cc64) added ENV-001: a preview must be noindex, production must not. A folder run with no `--target` prints one
`SKIP ENV-001 / no --target` line, so a caller that forgets the target publishes unjudged. The switch `REQUIRE_TARGET_FOR_FOLDER` in
`tools/audit/index.mjs` (false since 4c) makes such a run exit 2 instead. Snapshot (live) runs keep working with no target.

## Starts only when BOTH are on master (the head gives the shas)
1. Platform 5-E: the runner and `factory/test/run.mjs` pass `--target` / `{ target }` (check/platform/5-e, 18be0f4).
2. CLI "small CLI fixes": `omnikom audit` passes `--target` through (today `tools/omnikom-cli/commands/audit.mjs:26` refuses it, so with
   the switch true every `omnikom audit --dir` run would exit 2).

## Files
- `tools/audit/index.mjs`: the switch to `true`.
- `tools/audit/test/run.mjs`: the check "index.mjs has the switch REQUIRE_TARGET_FOR_FOLDER on one line, false in this slice" becomes
  "true"; keep the switch-true behaviour check (no target on a folder exits 2 naming --target; a folder with a target runs; a snapshot
  with no target runs); every other no-target folder run in the tests either passes a target or expects exit 2.
- `tools/audit/test/mutate.mjs`: a mutant setting the switch back to false must be caught.
- `tools/audit/README.md`: the call needs `target` for a folder.
- Light follow-ons (DECISIONS 43(2)), only if a caller still runs a folder with no target after 1 and 2 land: the literal only, owner
  named in the proof file. Anything bigger is a finding to the head.

## Done when (paste final lines)
`node tools/audit/test/run.mjs` OK N of N; `node tools/audit/run.mjs tools/audit/fixtures/good` exit 2 naming `--target`;
`... good --target production` exit 0; `node factory/test/run.mjs` all ok; `node tools/omnikom-cli/test/run.mjs --unit` all ok;
the new mutant through `node ~/.claude/scripts/heavy.mjs --wait-min 120 -- ...` caught, watched red; 0 em dashes in touched files.

## Rules
Node built-ins only; scripts in files, never inline `node -e`; no commits, no pushes; stop only processes you started, by PID.
Anything outside this brief is a finding you send back, not a fix.
