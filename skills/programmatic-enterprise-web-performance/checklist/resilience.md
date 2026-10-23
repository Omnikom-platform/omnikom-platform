# resilience (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- RES-001 P0 [http] Dependency unavailable, API surface (pages
- RES-002 P1 [http] Slow upstream (the egress proxy holds each request to the dependency for pageMs + 5,000 ms before answering)
- RES-003 P1 [http] degradable routes, while the listed dependency is refused or answering 503 (04 § 4.5), still answer 200 with <main> text whose token overlap with the same route's no-fault response is ≥ web-delivery.parity.minOverlap (0
- RES-004 P1 [browser] Third-party script hosts blocked
- RES-005 P1 [http] Recovery: after each fault ends, within 30 s (one request per sampled route per second), every sampled route again answers the status it answered before the fault, with no service restart.
- RES-006 P1 [ast] Each adapter httpClientApis call passes the entry's timeoutArg (03 § 6; e.g
- RES-007 W [http] 503 responses during dependency failure carry Retry-After.
- RES-008 P1 [http, browser, db] No false success when delivery fails
