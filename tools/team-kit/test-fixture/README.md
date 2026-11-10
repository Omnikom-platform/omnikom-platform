# Test fixture for test-agent-hooks.mjs

A made-up project the kit's hook test runs against when it runs inside the platform (`node tools/team-kit/test-agent-hooks.mjs`).
The roles come from `../roles.example.json`; these files only carry the lines the checks look for. In a client project the test
reads that project's own `icm/` instead and this folder is not used. `CLAUDE.fixture.md` and `POSITION.fixture.md` are copied in as
`CLAUDE.md` and `.claude/POSITION.md`; they are named differently here so no tool takes them for this repository's own files.
