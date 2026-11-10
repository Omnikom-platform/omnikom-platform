# Team kit: the ICM audit team (Lead, Researcher, SEO analyst, Reviewer)

Copied 2026-10-26 from `E:\Alex Sevilla` (the ELEV8 prospect audit), where it ran end to end. How the team works:
`sops/clients/prospect-audit-team.md`. These files are the newest working copies; they still carry ELEV8 names, so rename when starting a
new client:

| File | Goes to (in a client project) | Rename / edit |
|---|---|---|
| `agent-anchor.mjs` | `tools/` | the "on the ELEV8 / Alex Sevilla audit" line |
| `write-guard.mjs`, `agent-role.mjs` | `tools/` | nothing (read `icm/agents/roles.json`) |
| `boot.mjs` | `tools/team/` | the session names ("ELEV8 Lead", ...) and TEAM_LINE |
| `START-TEAM.cmd` | project root | the window and tab titles |
| `roles.example.json` | `icm/agents/roles.json` | each role's write scopes, the backup-gate file and marker, `closedPaths` |
| `boot-prompts.example.md` | `icm/agents/boot-prompts.md` | project name and folder in each prompt |
| `test-agent-hooks.mjs` | `tools/` | run it inside the project (it reads that project's `icm/`): all checks + mutants must pass |
| `test-fixture/` | nowhere | the made-up project the test uses when run here in the kit |

Test the kit itself, before copying it out: `node tools/team-kit/test-agent-hooks.mjs`. Beside `roles.example.json`, with no `icm/`
above it, the test runs the kit's own hook files against `test-fixture/` and `roles.example.json` (51 checks and 10 mutants, about
8 minutes on the owner's laptop on 2026-11-10; its throwaway folder is `~/.cache/team-kit-hooktest/<pid>`, removed at the end).

Hooks wiring (project `.claude/settings.json`): PreToolUse -> `node tools/write-guard.mjs`; SessionStart and UserPromptSubmit ->
`node tools/agent-anchor.mjs`. A session's role is the line `ICM-ROLE: <role>` in its first prompt.

Lessons from the ELEV8 run (2026-10-26):
- The in-app session tool cannot start a session while the owner is on Remote Control; the Reviewer then runs as a fresh-context
  subagent with the same boot prompt.
- A Lead writing `.claude/` paths from Bash trips the clean-launch guard (the path contains "claude"): edit those files with the
  Edit tool, or keep Lead scripts in `tools/lead/`.
