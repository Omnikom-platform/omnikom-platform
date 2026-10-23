# architecture (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- ARC-001 P1 [graph] Imports respect layers[].mayImport; a file outside every layer is a finding
- ARC-002 P0 [graph, build] serverOnly modules (DB clients, admin SDKs) are never reachable from a client entry point (a file matching adapter clientEntries) through the file import graph — transitive; type-only imports excluded; dynamic import()
- ARC-003 P1 [graph] No new import cycles. Cycles = strongly connected components (≥ 2 files) of the file import graph, type-only imports excluded. A finding (cycle) is each component that is not a subset of a component in _main/cycles.json
- ARC-004 P1 [ast] Files counted: as ARC-001, excluding files of role config (04 § 7.1). Environment variables are read only in envModule: an adapter envReadApis call outside envModule is a finding. Part schema: every env read in envModul
- ARC-005 P1 [ast] Data for an entity is read/written only through its dataAccess module
- ARC-006 P1 [ast] Concerns in singletons have one implementation
- ARC-007 P1 [deps] Dependencies, judged on the direct dependencies of the service's manifest(s)
- ARC-008 P1 [diff, graph, deps] No dead code introduced: files, exports and dependencies added in the diff that nothing uses, excluding adapter entry points and architecture.<service>.entryPoints (04 § 13). A file is used when a static import, require
- ARC-009 P1 [ast] No hardcoded environment-specific values
- ARC-010 P0 [cfg] Type strictness per language is on and unchanged (TypeScript strict + noUncheckedIndexedAccess; mypy/pyright strict for typed Python)
- ARC-011 W [ast] Files over maxFileLines or functions over maxFunctionLines in the diff
- ARC-012 W [review] Error handling follows one convention per layer; handlers map domain errors to declared HTTP errors (behaviour owned by API-003; swallowing by AGT-010).
- ARC-013 P1 [ast] Design tokens are used: with design.tokens declared, added or modified lines in style, component, route and layout files outside design.tokens globs and tests contain no raw colour literals (hex #rgb[a]/#rrggbb[aa], rgb
- ARC-014 W [ast] No copy-paste: a run of ≥ 50 tokens in added lines (tree-sitter tokens; identifiers → $id, literals → $lit) that also occurs elsewhere in the repo, outside tests and generated files (adapter codegen[] outputs, files mar
- ARC-015 W [cfg] The README (readme) documents how to work on the service
