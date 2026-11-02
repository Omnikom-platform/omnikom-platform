# 5-PORT: test cluster ports leave the ephemeral range, listen on 127.0.0.1, bind fallback in the block

Head: `HEAD_Platform-build_2026-11-01d` (report to this name by SendMessage). Builder: Sonnet, effort high. Written 2026-11-01 23:20.

## Read first
`CLAUDE.md`; `docs/departments/platform-build.md` (Rules that bind this department); the CLI's evidence brief
`tools/omnikom-cli/briefs/to-platform-port-map.md` (the cause, PROVEN on Linux in run 41350867780, the port map, the rule, the
done-when: this brief adds to it, it does not replace it); `docs/blueprint/23-GROUND-RULES.md` rule 10 (a rule is a test with a mutant).

## The change
For each of the 8 harnesses in the map (`supabase/tests/run-local.mjs:21`, `tests/publish-parity.mjs:27`,
`functions/test/harness.mjs:47`, `tests/test-apply.mjs:16`, `tests/e2e-screens.mjs:44`, `ops/restore-drill.mjs:219`,
`ops/test/6b-cluster.mjs:18`, `ops/test/cluster.mjs:18`):
1. The port comes from its block in the map (below 32768, no overlap). Do not change the CLI's own block (21000-21899).
2. `listen_addresses = '127.0.0.1'` on the test cluster, so a failed IPv4 bind fails `pg_ctl -w start` loudly.
3. Bind fallback inside the block: on a start failure whose server log says `could not bind` or `Address already in use`, try the
   next port, at most 5 tries, one line per try (`cluster: port P in use (could not bind), trying P+1`); any other start failure
   stops at once; never leave the block.
Head's design call: put the block table, the pick and the fallback in ONE shared module (for example `supabase/tests/lib/cluster-port.mjs`)
that all 8 harnesses import, so the map lives in one file and one test covers it. If a harness cannot import it (Deno, or a
different start path), say why and keep its code minimal and the same shape.

## Proof
- A unit test of the shared module: every block below 32768, blocks do not overlap each other or the CLI's 21000-21899, the fallback
  tries the next port only on a bind failure, stops after 5, stops at once on another error (use a fake pg_ctl like
  `tools/proc-guard/test/fake-pg-ctl.mjs`, read only).
- A mutant in `supabase/tests/run-local.mjs` for: the old range back, the listen pin removed, the fallback removed. Each caught.
- Windows (this laptop): each harness you changed still starts its cluster and runs green. Use `--only` filters where a harness
  has them; full mutant suites through `node "$HOME/.claude/scripts/heavy.mjs" --label "<name>" -- <command>`, one at a time.
- Linux watched red/green: the half-up state happens only on Linux. Write a probe script (or reuse the CLI's method in its brief:
  hold a TIME_WAIT socket on P, start the cluster, ping 127.0.0.1) that runs one harness's start with the OLD setting (red: 127.0.0.1
  refused, or with the pin: a loud start failure) and the NEW one (green). You cannot push; give the head the script and the exact
  command, and the head runs it on a check branch on GitHub.

## Rules
Worktree of master (`git worktree add --detach <temp dir> backup-gh/master`), never the shared tree. Never commit, push, deploy or
touch staging. Scripts in files, not `node -e`. No em dashes. Keys by variable name only. Do not touch `tools/omnikom-cli/` or
`tools/proc-guard/` (another builder is in proc-guard now). Anything outside this brief is a finding you send back, not a fix.

## Done when
The unit test passes and was watched red; 3 mutants caught; every changed harness green on Windows with pasted verdict lines; the
Linux probe script and command handed over; `git diff --stat`; findings listed. T14 and `node docs/blueprint/specs/run-all-gates.mjs`
are run by the head on the combined tree.
