# 5-G: proc-guard knows the journey's temp prefix; the gates mutant runner names the mutant that escaped

Head: `HEAD_Platform-build_2026-11-01d` (report to this name by SendMessage). Builder: Sonnet, effort high. Written 2026-11-01 22:14.

## Read first
`CLAUDE.md`; `docs/departments/platform-build.md` (Rules that bind this department); `tools/proc-guard/index.mjs` (PREFIXES at
line 23, `leaks`, `sweep`); `tools/proc-guard/test/run.mjs` and `test/mutate.mjs`.

## Scope (two items, nothing else)
1. **Prefix.** The CLI's journey (`omnikom test journey`) leaves temp folders or processes named `omnikom-jb-...` that
   `tools/proc-guard` does not know (finding from the first staging journey, 2026-11-01 21:40, `.claude/POSITION.md` line 865).
   Find where the name is made (search `tools/omnikom-cli/` for `jb-` and for how temp dirs are named; read only, never edit
   it), then add `omnikom-jb-` to `PREFIXES`. A test: a planted `omnikom-jb-` leak is found by `leaks()` and removed by `sweep()`,
   watched red without the prefix; a mutant in `test/mutate.mjs` that drops the prefix is caught.
2. **Escaped mutant's name.** In GitHub runs 41323582926 and 41323687561 (read with `gh run view <id> --log-failed` on repo
   `Omnikom-platform/omnikom-platform`), the gates job's mutant runner reported that a mutant survived without saying which
   one. Find that runner from the log (it is one of the platform's mutant runners: `supabase/tests/run-local.mjs`,
   `factory/**/test/mutate.mjs`, `tools/proc-guard/test/mutate.mjs`, or the gates script under `docs/blueprint/specs/`; if it is
   a file platform does not own, stop and report it as a finding). Make it print the escaped mutant's name on its own line
   (for example `SURVIVED <name>`) and in the final summary. A test or a scratch run: plant a mutant that survives, see its
   name printed, restore.

## Out of scope (do not touch)
Any change to how proc-guard decides a process is a live owner, kills, or sweeps (the pid-1 orphan question). The CLI department
is diagnosing the cluster-loss flakes; a behaviour change comes later as its own brief. If you see evidence on that, write it
down and send it back, do not change code for it.

## Rules
Work in a worktree of master (`git worktree add --detach <temp dir> backup-gh/master`), never the shared tree. Never commit, push,
deploy or touch staging. Scripts go in files, not `node -e`. Heavy runs (full mutant suites) go through
`node "$HOME/.claude/scripts/heavy.mjs" --label "<name>" -- <command>`. No em dashes in any file. Keys by variable name only.
Anything outside this brief is a finding you send back, not a fix.

## Done when
- `node tools/proc-guard/test/run.mjs` and `node tools/proc-guard/test/mutate.mjs` all pass, with the new prefix check watched red.
- The mutant runner from item 2 prints the escaped mutant's name; shown by a planted surviving mutant, then restored.
- Report: files changed (`git diff --stat`), the pasted verdict lines, the watched-red lines, and any findings.
