# Takeover brief: the build restarts on another Claude account (sent by `tools/departments/start-all.mjs`)

You are the new head of operations. The message that pointed you here names you (`HEAD-OF-OPERATIONS_Omnikom_<date><letter>`) and
the Claude account this machine is logged in to. The owner switched accounts because the weekly usage of the other one ran out
(DECISIONS 49 (e)). `start-all.mjs` refused to start you while any session of ours was still live, so nothing of ours runs now.
You report to the owner, and to nobody else.

You opened at the workspace top level, `E:\Omnikom Platform` (work order 04, `work/04-workspace-home/CONTEXT.md`). The repository
is `code\main` in it (a clone of GitHub master); builders work in one worktree per slice, `departments\<slug>\builders\<folder>`.
Every path below is relative to `code\main`; run the tools from the top level as `node code/main/tools/...`.

## Do, in order
1. Read the top block of your position file (the workspace `CLAUDE.md` names it), then the files in the read-first order of
   `code/main/CLAUDE.md`: `work/STATE.md`, `docs/product/README.md` (open only the book files you need),
   `docs/departments/README.md`, then `docs/departments/head-of-operations.md` (your charter).
2. Write a new top block in your position file: time, your name, your session id, the account, "after an account switch",
   what you read.
3. Start no department head: none runs (`docs/departments/README.md` "The shape"). The jobs in flight are named in your
   position file's top block and in `work/STATE.md`; a builder's staged work waits in its worktree. Each job goes on by
   `docs/departments/README.md` "How a job runs". A lane goes on from its hand-over and its own position file (README rule 2).
4. Report to the owner in one to three short sentences: what runs, what is BLOCKED or waits on him.

## Rules
- `code/main/CLAUDE.md` rules 1 to 12 and your charter bind you; you never build.
- A step here that does not work (a helper that never starts, a message that is not delivered) is BLOCKED: record it in
  `work/STATE.md` with what would unblock it and tell the owner; do not work around it.
