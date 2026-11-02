# Builder brief: `omnikom audit --dir` and `omnikom gate --dir` (CLI department, released 2026-10-30 22:11)

Builder: one sonnet session, this slice only, discarded when done. Head: the CLI and testing department head (this brief's author);
the SEO and audits department owns the engine and wrote the command brief this one wires: read `tools/audit/briefs/slice-3-cli-command.md`
first (the two commands, their output, their exit codes, the tests and mutants it asks for), then `tools/audit/README.md` (the library call).
Those two files are the spec; this file says how it fits the CLI. Where they differ, the SEO brief's table wins on output and exit codes.

## Files you may edit (nothing else; a bug anywhere else is a finding you send back, not a fix)
- `tools/omnikom-cli/commands/audit.mjs` (new: both commands, `audit(ctx)` and `gate(ctx)`)
- `tools/omnikom-cli/omnikom.mjs` (register `audit` and `gate` in `COMMANDS`, one `USAGE` line, the text-mode print path described below)
- `tools/omnikom-cli/test/run.mjs` (units section; no database needed for any of this)
- `tools/omnikom-cli/test/mutate.mjs` (three mutants at least, suite `unit`)
- `tools/omnikom-cli/README.md` (the command table gets the two rows)
You never edit `tools/audit/` (engine, fixtures, tests, briefs). A gap in the engine (a line the CLI cannot pass through, a missing
fixture, a wrong exit) is a finding: write it in your report with the command and its real output.

## How it fits the CLI (decided by the head; do not redesign)
1. Import the engine through `importRepo('tools/audit/index.mjs')` from `lib/repo.mjs`, never a relative `../audit` path: the mutation
   runner copies the CLI into a temp folder and points `OMNIKOM_REPO_ROOT` at the real repo, so a relative import breaks every mutant run.
2. `--dir` is required and is resolved against the current working directory; a missing `--dir` or a folder that does not exist is a
   `Usage` error (exit 2). `--target` on either command is a `Usage` error (they have no target). Add `audit` and `gate` to the commands
   that show no target in the result (`ctxUsesTarget` in `omnikom.mjs`).
3. The engine's `AuditError` (`.exit === 2`: unknown rule id, bad config) becomes a `Usage` error with the engine's message. Any other
   throw from the library becomes exit 2 with code `AUDIT-CRASH` and error `audit crashed: <message>`; in text mode the one printed line
   is `ERROR audit crashed: <message>`. A crash is never exit 0 or exit 1.
4. The command result: `result(r.pass, r.pass ? 'ok' : 'AUDIT-FAILED', data)`. For `audit`, `data` is the engine's object (`dir`, `pages`,
   `rules`, `findings`, `lines`, `pass`, `exit`). For `gate`, `data` is `{ pass, exit, fails }` where `fails` are the FAIL lines unchanged.
   `main` then gives exit 0 on pass and 1 on fail by itself (`exit: matched ? 0 : 1`); add nothing that could turn a FAIL into 0.
5. Text mode (no `--json`): `audit` prints `r.lines` to stdout exactly as the engine made them, one per line, nothing before them, then the
   last line `audit: <pages> pages, <rules> rules, <fails> FAIL, <warns> WARN, <skips> SKIP`. `gate` prints `GATE PASS <pages> pages,
   <rules> rules` or `GATE FAIL <n> finding(s)` followed by the FAIL lines, one per line. Every printed line goes through `redact(line, env)`
   from `lib/redact.mjs` (section 5 rule 1 holds for these commands too). `--json` prints the CLI's usual one JSON object through `render`.
   Put this text path in `finish()` in `omnikom.mjs`, keyed on the command name, the way `verify` already has its own stderr path; the
   JSON envelope is not printed in text mode for these two commands.
6. `--only <ids>` on `audit` is passed as `options.rules` (split on commas, trimmed, empty dropped); `gate` takes no `--only` (every rule,
   always; `--only` on `gate` is a `Usage` error, because a gate with fewer rules is a weaker gate).
7. No network, no psql, no secret, no dependency. Node built-ins only.

## Tests (units section of `test/run.mjs`; the fixtures are `tools/audit/fixtures/good` and `tools/audit/fixtures/bad-MET-003` under `REPO_ROOT`)
- `audit --dir <good>` exits 0, every non-summary stdout line starts with `PASS`, the last line starts with `audit: 4 pages, 14 rules, 0 FAIL`.
- `audit --dir <bad-MET-003>` exits 1 and its stdout lines (minus the summary) are identical, in order, to `audit(dir).lines` from the
  library imported directly (this is the identical-lines test; it catches a dropped or rewritten line).
- `audit --dir <bad-MET-003> --only MET-003` prints the one `FAIL MET-003 /tasting-room/:48 ...` line with `(source: checklist/web-delivery.md MET-003)`.
- `gate --dir <bad-MET-003>` exits 1, first line `GATE FAIL 1 finding(s)`, then that FAIL line; `gate --dir <good>` exits 0, one line
  `GATE PASS 4 pages, 14 rules`.
- `gate` without `--dir` exits 2; `gate --dir <missing folder>` exits 2; `audit --dir <good> --target staging` exits 2; `gate --only X` exits 2.
- `audit --dir <good> --only NOPE-999` exits 2 (the engine's `AuditError` passed through as usage).
- A crash inside the library (inject through `deps`: give `makeCtx` a `deps.auditLib` override, or whatever injection point you add, so a
  test can hand the command a library whose `audit` throws) exits 2 with `ERROR audit crashed:` in text mode and never 0.
- `--json` on `audit` gives `data.lines` and `data.exit`; on `gate` gives `data.pass`, `data.exit`, `data.fails`.
- Output never contains a secret: run one of the above with an env holding `SOME_SECRET_KEY=<random>` and a page path that cannot contain
  it; assert the random value is absent (the existing redaction tests show the pattern).
Watched-fail: every new check goes red once on purpose (break the thing it measures, see the FAIL line name it, restore) before you trust it.

## Mutants (`test/mutate.mjs`, suite `unit`; the text occurs exactly once in the file)
- the exit forced to pass: `result(r.pass, ...)` replaced by `result(true, ...)` (caught by the bad-fixture tests)
- a FAIL line dropped: the lines filter or the print loop skipping lines that start with `FAIL` (caught by the identical-lines test and `gate`)
- `--dir` made optional (caught by the usage test)
- a crash turned into a pass: the catch that produces `AUDIT-CRASH` replaced by a pass result (caught by the crash test)
Then `node tools/omnikom-cli/test/mutate.mjs` until `0 survived, 0 target text missing`.

## Gates (run all, paste the real last lines in your report)
```
node tools/omnikom-cli/test/run.mjs                                    ends "OK: N of N checks passed", exit 0 (N was 168 before you)
node tools/omnikom-cli/test/mutate.mjs                                 ends "N mutants, N caught, 0 survived, 0 target text missing" (N was 83)
node tools/omnikom-cli/omnikom.mjs audit --dir tools/audit/fixtures/good          every line PASS, summary line, exit 0
node tools/omnikom-cli/omnikom.mjs audit --dir tools/audit/fixtures/bad-MET-003   the engine's FAIL MET-003 line unchanged, exit 1
node tools/omnikom-cli/omnikom.mjs gate --dir tools/audit/fixtures/bad-MET-003    GATE FAIL 1 finding(s), exit 1
node tools/omnikom-cli/omnikom.mjs gate --dir tools/audit/fixtures/good           GATE PASS 4 pages, 14 rules, exit 0
node docs/blueprint/specs/run-all-gates.mjs                            passes
```
No staging command in this slice; nothing here touches a target.

## The five rules of the spec's section 5 (binding)
1. Secrets by name only and never in output; a test asserts it.
2. Production refused for everything but `status` and `apply --i-mean-production` (these commands have no target at all).
3. Fixtures synthetic; `--real` for anything else (the audit fixtures are an invented tea room; no client folder is a test vehicle).
4. Every command idempotent where a retry is possible (these read a folder and write nothing).
5. No dependencies; Web Crypto, psql, fetch only; tests and mutants, with the hygiene and production guard watched red first.

## Also binding
- No em dash character in any file. Scripts in files, never inline `node -e`. Long commands in the background.
- Mechanical runs (the test suite, the mutants, the gates, grep and listings) go to a haiku agent with the exact command; you read the
  verdict lines back and spend your turns on judgement and code (DECISIONS 34, owner's rule of 2026-10-30 23:25; added after this
  builder started, so it applies from its next run).
- Do not commit; the head re-runs the proof and commits. Leave `contracts/industry-run/RESULTS.md` and every file outside the list above alone.
- Report in this shape: PROVEN lines (each gate command and its real last line), UNPROVEN or NOT DONE items by name, findings for the engine.
- Anything outside this brief is a finding you send back, not a fix.
