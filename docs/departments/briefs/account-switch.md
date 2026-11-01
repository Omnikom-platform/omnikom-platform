# Builder brief: one command restarts the whole build on another Claude account (head of operations, 2026-11-01 16:35)

You are `BUILDER_head-of-operations_account-switch`. You report to the head of operations (the name in the last TAKEOVER line of
`.claude/POSITION.md`) by SendMessage. Anything outside this brief is a finding you send back, not a fix you make. You never
commit or push (DECISIONS 43 (4)); you hand back a working-tree change and a report.

## Read first, in order
1. `CLAUDE.md`, `docs/departments/head-of-operations.md`, `docs/departments/README.md` ("Context load and handover",
   "Starting and stopping a builder session").
2. `planning/DECISIONS.md` 40 (no standing router session) and 49 (this brief's reason).
3. `tools/departments/start-builder.mjs` and `tools/departments/context-load.mjs` (reuse, do not copy).
4. `E:\omk-launch\start-hoo-c.cmd` (the launcher pattern: clears the CLAUDE_CODE_* variables, names the session, opens it).

## Why
The owner has a second Claude account. When the weekly usage on one account runs out, the work carries on on the other one. The
owner logs in, runs one command, and the build restarts from the files. The owner said (16:27): "make sure that there is a cmd that
will actually open an orchestrator to start everything else on the other account after logging in".

## Shape (decided by the head of operations; do not redesign)
- The "orchestrator" is the head of operations session. No new standing session (DECISIONS 40).
- `E:\omk-launch\start-omnikom.cmd` plus a Desktop shortcut to it, "Start Omnikom". It runs `node tools/departments/start-all.mjs`.
- `tools/departments/start-all.mjs`:
  1. Shows which Claude account is logged in (email or org as Claude Code reports it, never a token). If that cannot be read,
     it says so and asks the owner to confirm in the window (y/n), never guesses.
  2. Lists every live session of ours (the same source context-load uses, deduplicated). If a head of operations or a department
     head is still live, it refuses to start a second one for the same charter (one session per set of files). It prints which
     ones to stop and the command that stops them. `--force` is not offered.
  3. Starts ONE fresh head of operations (Opus 5.5, bypassPermissions, the next free name `HEAD-OF-OPERATIONS_Omnikom_<date><letter>`)
     with a launcher in the start-hoo-c.cmd pattern. It waits until the session is registered, then sends it the takeover brief
     (below) by the same mechanism start-builder.mjs uses.
  4. Prints one line: name, pid, account, and "it starts the department heads from their HANDOVER blocks".
- Takeover brief sent to the new head of operations (a file, `docs/departments/briefs/takeover-after-account-switch.md`, so it
  is read, not pasted): read the files in the Layer 0 order of CLAUDE.md; take the last HANDOVER block of POSITION.md as the work
  list; start each department head whose charter has a HANDOVER block newer than its last TAKEOVER (one per charter, same model as
  the charter says, the start-*-b.cmd pattern); each head restarts its own builders from its notes. Then run context-load and report
  to the owner in two lines.
- Find out from the Claude Code docs (code.claude.com/docs) how the logged-in account is chosen and whether a session started
  before a re-login keeps the old account. Write the answer with its source and date in the brief's report, and in
  `docs/departments/README.md` as a short "Switching Claude accounts" section (three to six lines: the owner's steps in order).
  If a second config directory (CLAUDE_CODE_CONFIG_DIR or similar) is the way, the hooks, skills, memory and settings in
  `~/.claude` must still apply; prove it with a session that reports a hook line.

## Done when
- `node tools/departments/start-all.mjs --dry-run` prints the account line, the live-session list, the refusal when a head is live,
  and the launcher it would write, without starting anything. Paste the output.
- Tests in `tools/departments/test/run.mjs`: refuses when a head of operations is live (watched red with the check removed); picks
  the next free name; never prints a token (a planted fake token in the account read must not appear in the output). One mutant
  per check in `tools/departments/test/mutate.mjs`.
- `node tools/departments/check.mjs` and `node tools/departments/test/run.mjs` green, pasted.
- No real start during the build: the owner runs the real one after logging in to the other account.
- No em dashes; no secret values; scripts in files.
