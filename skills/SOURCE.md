# Where each skill copy came from (owner decision 2026-10-24: skills live in this repo, still usable outside)

| Copy here | Copied from | Version at copy | Date |
|---|---|---|---|
| `programmatic-enterprise-web-performance/` | `the installed copy (own git repo), now retired: ~/.claude/skills/programmatic-enterprise-web-performance becomes a junction to this folder (P3.4 D2, bootstrap/skills-sources.json); its history is in the bundle of P3.9 rows B10 and B22; its private GitHub repository is frozen` | `cc36ba9` "research.mjs --dry now WRITES research/capture-requests.json" | 2026-11-12 |
| `design-tournament/` | `C:\Users\DELL\.claude\skills\design-tournament` | (no git) | 2026-10-24 |
| `icm-librarian.agent.md` | the Example B and D project's `.claude\agents\icm-librarian.md` | Example B and D repo | 2026-10-24 |
| `context-economics/` | written here (no outside copy): BUILDER_head-of-operations_context-economics, brief `docs/departments/briefs/context-economics.md`; prices from platform.claude.com pricing, read 2026-11-01 | (new) | 2026-11-01 |
| `unslop/` | https://github.com/heydamir/unslop folder `skills/unslop/` plus `LICENSE` and `CITATION.cff` (CC BY 4.0, Damir Sokolovsky; `scripts/` not copied; see `unslop/CREDIT.md`) | `4652254` "docs: links point to the heydamir account, hire section renamed" | 2026-10-31 |

Drift rule: the outside copies stay in use for side work. When either side changes, sync on purpose (copy + update this table with
the new version); never let the two silently diverge. The sync: `node skills/sync-skill.mjs <skill> [--dry]` (copies, removes what the source dropped, rewrites this row).
Not for programmatic-enterprise-web-performance: it has no outside copy to sync.
