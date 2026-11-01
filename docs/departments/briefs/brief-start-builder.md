# Brief: department heads start real builder sessions (measure first, then build)

Owner, 2026-11-01 06:26: "the purpose of having department heads is to actually utilize ... new sessions with properly clean
context to get work done under the heads, and that would perfectly keep the heads' context at the proper limit ... fresh
sessions being more faster, cheaper to run ... not wasting money."

## The gap (why heads use in-session helpers today)
- `E:\Omnikom Platform\docs\departments\README.md` says a head "starts one builder session per slice". In practice heads use
  in-session Agent helpers and do hands-on work themselves, which fills their context.
- The desktop app refuses `start_session` on a turn that another session's message started, and nearly every head turn is
  started by a message from the head of operations. So heads cannot start desktop sessions on their own.
- The desktop app also pauses a session's cross-session messages after about 10 sends since its user last typed there.
- A sanctioned route exists: `~/.claude/hooks/clean-launch-guard.mjs` allows a new Claude session in its own terminal ONLY
  through a launcher file (.cmd/.bat/.ps1) that clears the Claude markers and passes no prompt; the task is then sent with
  SendMessage once the session is listed by ListAgents. Example: `C:\Users\DELL\.claude\skills-work\start-fable-overhaul.cmd`.
  Read the guard's `launcherProblems` to see exactly what a launcher must clear.

## Step 1: MEASURE (no building before these answers are pasted)
Launch ONE throwaway session through a clean launcher (model `claude-haiku-5-5`, cwd `E:\Omnikom Platform`, a title such as
`PROBE: builder launch`), then measure and paste:
1. Does it appear in ListAgents from this session within 60 s? Under what name? Does it appear in the desktop app's session
   list (`mcp__ccd_session_mgmt__list_sessions`, load it with ToolSearch)?
2. Can this session SendMessage it a task, and can it SendMessage a reply back? (Ask it to reply with one line.)
3. Do messages to and from it count toward the desktop app's ~10-send pause? Send it 12 short messages and record whether any
   is refused, and whether messages to desktop sessions are affected afterwards (send nothing to department heads; use
   only the probe).
4. Can the session's name be set at launch so it reads `BUILDER (<department>): <slice>`? (claude CLI flags, `/rename`, or
   the first message.) Can its model and effort be set at launch?
5. How is it stopped cleanly when done: the session exits on its own after its final report (a final `/exit`?), or the head
   stops its process tree by PID? Record the PID at launch. Prove nothing is left after stopping (the reaper is
   `~/.claude/hooks/reap-stray-shells.mjs`; do not change it).
6. Permission mode: the heads run in bypass mode. Record which mode the launched session runs in and whether its file edits
   and commands work without prompts in the repo.
Stop the probe and remove anything it created.

## Step 2: BUILD (only if step 1 says the route works; otherwise report BLOCKED with the exact obstacle and what would unblock it)
- `tools/departments/start-builder.mjs` (this folder is the head of operations' own; you may write here):
  `node tools/departments/start-builder.mjs --dept <slug> --slice <name> [--model sonnet|haiku|opus|fable] [--effort ...]`
  - writes a clean launcher into a temp folder (never with "claude" in the folder path: the guard matches it), starts it in
    its own window, waits until the session is listed (bounded, 90 s), prints one JSON line: {name, pid, model, cwd};
  - the model defaults to the department charter's builder model (`tools/departments/lib.mjs` reads charters);
  - refuses a department that has no charter, and a slice name with characters a window title cannot hold.
- `tools/departments/stop-builder.mjs --pid <n>`: stops that session's whole tree by PID (creation time checked), confirms
  nothing is left.
- Tests in `tools/departments/test/` (keep the existing 14 passing): launcher text passes `launcherProblems`; a bad
  department and a bad slice are refused; a dry-run mode prints the launcher without starting it. One real launch-and-stop
  test with a Haiku model, run once, pasted. Mutants for each refusal and for "the launcher clears every marker".
- One paragraph for the README (draft only, in your report; the head of operations writes it): how a head starts, briefs,
  receives the report from, and stops a builder; that hands-on work (diagnosis, settings, proof runs) belongs to builders
  or Haiku runners, never the head.

## Rules
- Read `~/.claude/reference/windows-scripting.md` first. Scripts in files. No em dashes. One test at a time; anything heavy
  through `node ~/.claude/scripts/heavy.mjs -- <cmd>`.
- Do not message any department head or any session other than your own probe. Do not commit; report the files changed.
- Report with pasted output; mark UNPROVEN plainly.
