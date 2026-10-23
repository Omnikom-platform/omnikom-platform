# testing (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- TST-001 P0 [browser, cfg] Every declared flow passes in the verify environment with assertions on observable outcomes (URL, visible text, API/DB/email state), not just absence of errors
- TST-002 P0 [browser] Flows with persist: true re-check their final assertions after a reload: after the last step, the page is reloaded (Playwright reload, waiting for load) and the maximal run of consecutive expect* steps at the end of ste
- TST-003 P1 [diff, graph] Each changed file whose role is in requireTestsFor is imported, directly or transitively (test import graph, ≤ 5 hops), by a test file (role test, 04 § 7.1) added or modified in the diff; for a route file, a test file a
- TST-004 P1 [cmd, ast] Honest tests (pass/fail of the project's own tests is BLD-003)
- TST-005 W [review] Tests assert behaviour through public interfaces rather than private implementation details.
- TST-006 P1 [cmd] With mutation.enabled (profile nightly)
- TST-007 P0 [cfg] Flows, fixtures and contracts used as oracles are Operator-owned and signed; agents propose new ones in quality/proposals/
- TST-008 P1 [browser] Cross-browser: with crossBrowser.enabled, each flow matched by crossBrowser.flows (flow-id globs) runs in each browser of its own browsers (03 § 10) ∪ crossBrowser.browsers and passes in each. A listed browser with no m
- TST-009 P1 [browser] Every flow step on app surfaces has zero uncaught errors from origin scripts and zero failed same-origin requests
- TST-010 P1 [cfg, browser] Critical journeys have flows: each security.authEndpoints entry is requested during ≥ 1 flow (browser network log); with security.payments, ≥ 1 flow has journey: "checkout" and a markAmount step (which also feeds SEC-04
- TST-011 P2 [cmd] Changed-line coverage: when services[].commands.coverage is set, it runs in G1. Before it runs, shipgate deletes coverage.report (else every auto-detect candidate: coverage/lcov.info, lcov.info, coverage/cobertura-cover
