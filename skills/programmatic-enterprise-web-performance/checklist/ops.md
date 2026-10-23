# ops (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- OPS-001 P0 [http, browser] Service logs captured during G4/G6 contain no secrets (classification of SEC-005), test-account passwords, session tokens, card numbers or full email addresses of test accounts
- OPS-002 P1 [http] Health endpoints (verifyEnv.health with endpoint
- OPS-003 W [ast, cfg, http] An error-reporting integration is configured for each service (a provider sdkPackages entry is a dependency of the service) and reads its DSN (dsnVar) from the env module
- OPS-004 P1 [browser] Emails captured by the SMTP sink during flows
- OPS-005 P1 [browser] Bulk/marketing emails (from bulkSenders) include List-Unsubscribe and List-Unsubscribe-Post
- OPS-006 P1 [edge] With dnsCheck, for each fromDomains entry (read-only DNS lookups in G8)
- OPS-007 P1 [http] Every response of a service process to a request shipgate sends in G4 (crawl, contract, security and preview-pass requests; not host-emulation static files, 04 § 3) carries a request id in x-request-id, request-id or tr
- OPS-008 W [http] Denied probes are visible: each security probe answered 401, 403 or 429 (SEC-* authentication, authorization, CSRF and rate-limit probes) produces a service log line at level warn or higher (structured level/severity fi
- OPS-009 P1 [cfg] Toolchain versions are pinned and agree
- OPS-010 P1 [cfg, http] Environment contract: every variable read by the service (the architecture.<service>.envModule when set, else adapter envReadApis call sites with literal names) appears in env.example (missing-element, the variable); sh
- OPS-011 P1 [http, browser] Error-reporting payloads are clean
- OPS-012 W [http] Graceful shutdown, in its own mutating stage (04 § 4.2 step 8)
- OPS-013 W [db] Scheduled jobs don't overlap: after a data-api.jobs entry's run executes twice concurrently on one fresh instance (mutating stage, 04 § 4.2 step 8), its writes table contents equal those after a single run on another fr
- OPS-014 W [browser] HTML emails captured by the SMTP sink during flows render for everyone
- OPS-015 P1 (parts `soon`, `eol-unknown` W) [cfg, deps] Supported versions (OWASP Top 10 A06; PCI DSS 4.0.1 req
- OPS-016 P1 [edge] Domain registration, with edge.production
