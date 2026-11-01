# The 107 files that still name a client after the base rules + 9 extra denies (master c2811ee)

Grouped by owning department (docs/departments/*.md "Owns", longest path wins). Names masked: [client n]. "read by" = the ci.yml job(s) and gate(s) whose import/read closure holds the file (graph of `omnikom impact`; "none" = no job reads it as far as the graph sees). [path] = the path itself names a client.

## cli-and-testing: 2 files, 13 lines, 2 read by a job

- docs/blueprint/26-PLATFORM-CLI.md | lines 2 | read by: job cli
- tools/omnikom-cli/test/run.mjs | lines 11 | read by: job cli; job departments
## head-of-operations: 4 files, 34 lines, 3 read by a job

- docs/departments/briefs/platform-build-head-step-4.md | lines 8 | read by: job departments
- docs/departments/clients.md | lines 21 | read by: job cli; job departments
- docs/departments/platform-build.md | lines 4 | read by: job cli; job departments
- skills/SOURCE.md | lines 1 | read by: none
## platform-build: 66 files, 328 lines, 14 read by a job

- contracts/README.md | lines 15 | read by: none
- contracts/examples/[client 0]/MAPPING.md [path] | lines 3 | read by: none
- contracts/examples/[client 0]/contract.json [path] | lines 78 | read by: gate contract tests; gate publish-ready parity (SQL vs JS); job cli; job gates
- contracts/examples/[client 0]/entities.json [path] | lines 26 | read by: none
- contracts/examples/[client 0]/screens.md [path] | lines 1 | read by: none
- contracts/examples/[client 2]/MAPPING.md [path] | lines 2 | read by: none
- contracts/examples/[client 2]/RUN.txt [path] | lines 0 | read by: none
- contracts/examples/[client 2]/check.mjs [path] | lines 4 | read by: none
- contracts/examples/[client 2]/contract.json [path] | lines 3 | read by: gate publish-ready parity (SQL vs JS); job gates
- contracts/examples/[client 2]/entities.json [path] | lines 2 | read by: none
- contracts/examples/[client 2]/screens.md [path] | lines 1 | read by: none
- contracts/examples/[client 3]/MAPPING.md [path] | lines 4 | read by: none
- contracts/examples/[client 3]/RUN.txt [path] | lines 0 | read by: none
- contracts/examples/[client 3]/adapter.mjs [path] | lines 11 | read by: none
- contracts/examples/[client 3]/contract.json [path] | lines 3 | read by: gate publish-ready parity (SQL vs JS); job gates
- contracts/examples/[client 3]/entities.json [path] | lines 2 | read by: none
- contracts/examples/[client 3]/screens.md [path] | lines 1 | read by: none
- contracts/industry-run/RESULTS.md | lines 1 | read by: gate industry run; job gates
- contracts/industry-run/run.mjs | lines 1 | read by: gate industry run; job gates
- contracts/lead-payload.example.json | lines 2 | read by: none
- contracts/test/run.mjs | lines 13 | read by: gate contract tests; job gates
- docs/blueprint/01-ARCHITECTURE.md | lines 2 | read by: none
- docs/blueprint/03-FRONTEND.md | lines 10 | read by: none
- docs/blueprint/04-DASHBOARD.md | lines 2 | read by: none
- docs/blueprint/05-BUILD-PLAN.md | lines 24 | read by: none
- docs/blueprint/06-PRD.md | lines 7 | read by: none
- docs/blueprint/10-DELIVERY.md | lines 1 | read by: none
- docs/blueprint/12-LAUNCH.md | lines 2 | read by: none
- docs/blueprint/13-DATA-MODEL.md | lines 7 | read by: none
- docs/blueprint/14-LEAD-PATH.md | lines 3 | read by: none
- docs/blueprint/15-CRM.md | lines 1 | read by: none
- docs/blueprint/16-DESIGN-PARTS.md | lines 3 | read by: none
- docs/blueprint/17-EXPANSION-MAP.md | lines 1 | read by: none
- docs/blueprint/18-BUDGET-ARCHITECTURE.md | lines 2 | read by: none
- docs/blueprint/19-CODE-MANIFEST.md | lines 4 | read by: none
- docs/blueprint/20-SHAPE.md | lines 5 | read by: none
- docs/blueprint/24-GAP-HUNT.md | lines 1 | read by: none
- docs/blueprint/25-BUILD-SEQUENCE.md | lines 12 | read by: job cli
- docs/blueprint/PROGRESS.md | lines 5 | read by: none
- docs/blueprint/README.md | lines 4 | read by: none
- docs/blueprint/adr/0002-workers-static-assets-per-site.md | lines 2 | read by: none
- docs/blueprint/adr/0008-no-own-idx-at-launch.md | lines 2 | read by: none
- docs/blueprint/adr/README.md | lines 1 | read by: none
- docs/blueprint/diagrams/13-plan.mmd | lines 3 | read by: none
- docs/blueprint/diagrams/13-plan.svg | lines 1 | read by: none
- docs/blueprint/specs/openapi.json | lines 1 | read by: gate specs + traceability; job gates
- factory/README.md | lines 1 | read by: none
- factory/briefs/4-1-factory-core.md | lines 6 | read by: none
- factory/briefs/5-0-step-5-and-6-plan.md | lines 1 | read by: none
- factory/lib/launch.mjs | lines 1 | read by: none
- factory/lib/template.mjs | lines 1 | read by: none
- factory/test/run.mjs | lines 1 | read by: job factory
- factory/worker/README.md | lines 6 | read by: none
- factory/worker/pages-function-lead.js | lines 1 | read by: job factory
- supabase/functions/capture-lead/index.ts | lines 1 | read by: job departments; job functions
- supabase/migrations/20261029000002_crm.sql | lines 1 | read by: gate function tests (Deno); gate publish-ready parity (SQL vs JS); job functions; job gates
- supabase/tests/e2e-lead.mjs | lines 1 | read by: job cli
- supabase/tests/publish-parity.mjs | lines 3 | read by: gate publish-ready parity (SQL vs JS); job cli; job gates
- tools/design-engine/CRAFT.md | lines 2 | read by: none
- tools/design-engine/README.md | lines 1 | read by: none
- tools/design-engine/WRITING.md | lines 10 | read by: none
- tools/design-engine/craft-lint.mjs | lines 5 | read by: none
- tools/design-engine/templates/map-overlay.html | lines 1 | read by: none
- tools/design-engine/tests/fixtures/lint-good.html | lines 1 | read by: none
- tools/design-engine/tests/test-design-engine.mjs | lines 4 | read by: none
- tools/mint-site-key.mjs | lines 1 | read by: none
## seo-and-audits: 32 files, 69 lines, 0 read by a job

- skills/programmatic-enterprise-web-performance/PHASES.md | lines 6 | read by: none
- skills/programmatic-enterprise-web-performance/SOP.md | lines 2 | read by: none
- skills/programmatic-enterprise-web-performance/UPGRADE-PROMPT.md | lines 4 | read by: none
- skills/programmatic-enterprise-web-performance/rules/gazetteer/us.json | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/rules/industries/cash-home-buyer.json | lines 3 | read by: none
- skills/programmatic-enterprise-web-performance/rules/industries/real-estate-agent.json | lines 2 | read by: none
- skills/programmatic-enterprise-web-performance/rules/link-sources/real-estate-agent.json | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/rules/stop-words.json | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/authority.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/launch.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/lib-freshness.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/lib-polite.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/plan-site.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/refactor.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/research-cluster.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/research-competitors.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/research-existing.mjs | lines 2 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/test-authority.mjs | lines 2 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/test-launch.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/test-measure.mjs | lines 14 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/test-research.mjs | lines 3 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/test-writing-gate.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/scripts/writing-gate.mjs | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/stages/authority.md | lines 3 | read by: none
- skills/programmatic-enterprise-web-performance/stages/build.md | lines 4 | read by: none
- skills/programmatic-enterprise-web-performance/stages/gate.md | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/stages/launch.md | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/stages/plan.md | lines 1 | read by: none
- skills/programmatic-enterprise-web-performance/stages/refactor.md | lines 3 | read by: none
- skills/programmatic-enterprise-web-performance/stages/research.md | lines 2 | read by: none
- tools/audit/briefs/slice-1-engine.md | lines 1 | read by: none
- tools/audit/briefs/slice-4b-design-tells.md | lines 1 | read by: none
## unowned: 3 files, 10 lines, 1 read by a job

- README.md | lines 4 | read by: job departments
- skills/design-tournament/SKILL.md | lines 4 | read by: none
- skills/icm-librarian.agent.md | lines 2 | read by: none
