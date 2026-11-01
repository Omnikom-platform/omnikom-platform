# Skill sync: programmatic-enterprise-web-performance to 77aee20 (2026-11-01 21:14)

- SOURCE: `git status --porcelain` empty, `git log --oneline -1` = 77aee20.
- Em dashes (whole skill folder): before 79, after 74; stages/compare.md 1 -> 0.
- Sync: `22 copied, 0 removed, 259 files in the source; SOURCE.md row -> 77aee20`.
- `git diff -U0 -- skills/SOURCE.md`: one changed line, line 5, the skill's row (83c1fe6 -> 77aee20). Nothing else.
- Tests (through heavy.mjs, all exit 0):
  - test-main.mjs: `MAIN-MODULE TEST PASS: 10 of 10`
  - test-measure-prompts.mjs: `PASS mutants 34/34 went red for the right reason`
  - test-measure.mjs --quiet: `140/140 passed`
  - test-prompt-map.mjs: `PASS mutants 62/62 went red for the right reason`
  - test-prompt-plan.mjs --no-mutants: `PASS test-prompt-plan 66/66 checks (10 s)`
- `git status --porcelain` on the skill folder: 22 paths (14 modified: SKILL.md, scripts/{approve,gate,lib-site,measure,plan-site,test-launch,test-measure,test-plan-gate}.mjs, stages/{compare,gate,measure,plan,research}.md; 8 new: schemas/prompt-map.md, scripts/{gate-prompt-coverage,lib-prompt-map,lib-prompt-plan,research-prompts,test-measure-prompts,test-prompt-map,test-prompt-plan}.mjs).
- Not committed, not pushed.
