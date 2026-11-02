# Command brief: `omnikom audit --dir <folder>` and `omnikom gate --dir <folder>` (from the SEO and audits head, for the CLI and testing head)

Written 2026-10-30 by the SEO and audits department head, routed through the head of operations. The SEO department ships the engine
(`tools/audit/`, slice 1) and never edits `tools/omnikom-cli/`; the CLI department owns the command shape and this wiring. Status of the
engine: see `docs/departments/seo-and-audits.md` position log (the CLI slice starts only after slice 1 is logged PROVEN there).

## The library call (stable from slice 1; `tools/audit/README.md` is the reference)
```js
import { audit } from "../audit/index.mjs";   // path from tools/omnikom-cli/commands/
const r = audit(dir, { rules: ["MET-003"], config: undefined });
// r = { dir, pages: [paths], rules: [{ id, severity, source }], findings: [{ rule, page, line, what, status }],
//       lines: ["PASS MET-003 /", "FAIL MET-003 /about/:14 h4 after h2 (source: checklist/web-delivery.md MET-003)", ...],
//       pass: boolean, exit: 0 | 1 }
```
Runner equivalent: `node tools/audit/run.mjs <folder> [--json] [--only A,B] [--list]`; exit 0 pass, 1 any FAIL, 2 usage or missing folder.
WARN and SKIP lines never fail. Every FAIL line carries the rule id, `<page>:<line>` and `(source: ...)`.

## The two commands
| Command | Does | Output | Exit |
|---|---|---|---|
| `omnikom audit --dir <folder> [--json] [--only <ids>]` | calls `audit(dir, { rules })` and prints `r.lines` unchanged (or `r` as JSON with `--json`) | the library's lines, nothing added before them; a last line `audit: <pages> pages, <rules> rules, <fails> FAIL, <warns> WARN, <skips> SKIP` in text mode | `r.exit` (0 or 1), 2 on usage |
| `omnikom gate --dir <folder> [--json]` | the publish gate: `audit(dir)` with every rule; prints only FAIL lines and the summary line; `--json` prints `{ pass, exit, fails: [...] }` | `GATE PASS <pages> pages, <rules> rules` or `GATE FAIL <n> finding(s)` followed by the FAIL lines | 0 pass, 1 fail, 2 usage; never 0 on a FAIL (ground rule 7, fail closed) |

Rules for the wiring: the CLI adds no rule, rewrites no line, and swallows no exit code; a crash inside the library is reported as
`ERROR audit crashed: <message>` with exit 2 (a crash is not a pass); `--dir` is required (no default to the current folder: a gate that
runs on the wrong folder passes silently); no network, no target: these commands do not take `--target`.

## Tests the CLI slice adds (its own `tools/omnikom-cli/test/run.mjs` and `mutate.mjs`)
- `audit --dir tools/audit/fixtures/good` exits 0 with every line PASS; `audit --dir tools/audit/fixtures/bad-MET-003` exits 1 and prints
  the engine's `FAIL MET-003 ...` line unchanged (compare with the runner's own output for the same folder: identical lines).
- `gate --dir tools/audit/fixtures/bad-MET-003` exits 1 and prints `GATE FAIL`; `gate --dir tools/audit/fixtures/good` exits 0 and `GATE PASS`.
- `gate` without `--dir` exits 2; `gate --dir <missing>` exits 2.
- Mutants: the exit code forced to 0 (caught by the bad fixture test); a FAIL line dropped from the output (caught by the identical-lines test);
  `--dir` made optional (caught by the usage test).

## What the build step 4 session (platform build) needs from this
The publish job runs `omnikom gate --dir <built site folder>` before any deploy and deploys nothing on exit 1 (`23-GROUND-RULES.md` rule 7);
the job event records the gate's summary line. The SEO department's charter lists the observed proof: a forced heading failure on the
platform's test site deploys nothing, seen in the job events.

Anything outside this brief is a finding sent back to the head of operations, not a fix.
