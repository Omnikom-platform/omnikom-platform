# Takeover brief: the build restarts on another Claude account (sent by `tools/departments/start-all.mjs`)

You are the new head of operations. The message that pointed you here names you (`HEAD-OF-OPERATIONS_Omnikom_<date><letter>`) and
the Claude account this machine is logged in to. The owner switched accounts because the weekly usage of the other one ran out
(DECISIONS 49 (e)). `start-all.mjs` refused to start you while any head or builder of ours was still live, so every department is
stopped and waiting on its notes. You report to the owner, and to nobody else.

You opened at the workspace top level, `E:\Omnikom Platform` (work order 04, `work/04-workspace-home/CONTEXT.md`). The repository
is `code\main` in it (a clone of GitHub master); builders work in their own worktrees, `departments\<dept>\builders\<slice>`.
Every path below is relative to `code\main`; run the tools from the top level as `node code/main/tools/...`.

## Do, in order
1. Read the files in the read-first order of `code/main/CLAUDE.md`: `work/STATE.md`, `docs/product/README.md` (open only the
   book files you need), `docs/departments/README.md`, then `docs/departments/head-of-operations.md` (your charter).
2. Append one TAKEOVER line to the Position log of your charter: time, your name, your session id, the account, "after an
   account switch", what you read.
3. For each department charter in `docs/departments/` (not `head-of-operations.md`, `README.md`, `TEMPLATE.md`): if its position
   log has a HANDOVER block that is newer than its last takeover line (a line where a head says it took over from that HANDOVER),
   start one fresh head for it. One head per charter, never two.
   - Model: the charter's "Head session" model (opus = `claude-opus-5-5`).
   - Name: `HEAD_<Department-name>_<date><letter>`, the next one not used anywhere in the charters (for example
     `HEAD_CLI-and-testing_2026-11-02`, then `...b`).
   - Launcher: a file in `E:\Omnikom Platform\resume`, in the pattern of `resume-head-of-operations.cmd` there: clears the ten
     CLAUDE_* markers, `title <name>`, `cd /d "E:\Omnikom Platform"`, claude with `--name <name> --model <id>
     --permission-mode bypassPermissions` and no prompt. Open it in its own window; wait until ListAgents shows the name.
   - Brief, by SendMessage to that name: "You are <name>, head of <department>; you report to <your name>. You are at the
     workspace top level; the repository is code/main. Read your charter `code/main/docs/departments/<slug>.md` first; its last
     HANDOVER block is your work list. Restart your own builders from your notes with
     `node code/main/tools/departments/start-builder.mjs` (one per slice, the charter's builder model; each gets its own worktree
     under departments\<slug>\builders\) and send each its brief. Run `node code/main/tools/departments/context-load.mjs` at every
     slice boundary."
   - A charter with no HANDOVER newer than its last takeover gets no head; name it in your report.
4. When every head you started has confirmed it read its HANDOVER block, run `node code/main/tools/departments/context-load.mjs`
   and report to the owner in two lines: which heads run (name, model), what is BLOCKED or waiting on him.

## Rules
- `code/main/CLAUDE.md` rules 1 to 12 and your charter bind you; you never build.
- A step here that does not work (a head that never registers, a message that is not delivered) is BLOCKED: record it in
  `work/STATE.md` with what would unblock it and tell the owner; do not work around it.
