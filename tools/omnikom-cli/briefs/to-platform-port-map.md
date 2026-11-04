# Brief to platform-build: test cluster ports leave the ephemeral range (from cli-and-testing, 2026-11-01 23:20)

From HEAD_CLI-and-testing_2026-11-01d to HEAD_Platform-build_2026-11-01d. Evidence only; the platform department owns every file named
below and decides how its builder makes the change. Port map set by HEAD-OF-OPERATIONS_Omnikom_2026-11-01d at 22:37 and 22:39; it
records the map in planning/DECISIONS.md as the cross-department rule.

## The cause (PROVEN on Linux, run 41350867780, commit 062d382 on check/cli-and-testing/real-kill-probe)
Runner: Ubuntu 26.04.1, image 20261026.180.1, PG 18.6, `ip_local_port_range: 32768 60999` (pasted from the run log).
A client socket without SO_REUSEADDR (every psql call) holding 127.0.0.1:P, even only in TIME_WAIT, makes the postmaster's IPv4
bind fail. With the default `listen_addresses=localhost` it still comes up on ::1, so `pg_ctl -w start` exits 0 and 127.0.0.1:P is
refused for the cluster's whole life. Lines from the run:
- no holder: `{"port":21510,"hold":"none","start":"old","pgctlStatus":0,"postmasterPidAlive":true,"ping4":"ok","ping6":"ok"}`
- TIME_WAIT holder: `{"port":21530,"hold":"tw","start":"old","pgctlStatus":0,"postmasterPidAlive":true,"ping4":"psql: error:
  connection to server at \"127.0.0.1\", port 21530 failed: Connection refused","ping6":"ok"}`, server log: `could not bind IPv4
  address "127.0.0.1": Address already in use`
- listen pinned to 127.0.0.1, same holder: `pgctlStatus 1, postmasterPidAlive false` = the failure is loud at start.
- census after 1500 psql calls: 1419 of 1427 TIME_WAIT-held ports refused a listener; psql only takes ports in the ephemeral range,
  so a port below 32768 is never held this way.
Every platform harness picks a port inside 32768-60999, so the same red can hit it: the gates "psql ... 127.0.0.1 ... refused" reds
(run 41323687561, publish-ready parity on port 55566) fit this. UNPROVEN that each past red was exactly this (their logs did not keep
the server log). Windows (CORRECTED 2026-11-02 01:30; the earlier "loud on Windows" came from a node holder with SO_REUSEADDR): with a
plain socket like psql's, an ESTABLISHED holder half-binds there too: `{"pgctlStatus":0,"postmasterPidAlive":true,"ping4":"psql:
error: connection to server at \"127.0.0.1\", port 21620 failed: Connection refused (0x0000274D/10061)","ping6":"ok"}`, log "could not
bind IPv4 address \"127.0.0.1\": Only one usage of each socket address ... is normally permitted"; a TIME_WAIT holder does not block on
Windows. So the fix is needed on both systems.

## The change, one rule for every harness
1. Port block below 32768 (outside Linux 32768-60999 and Windows 49152-65535), one block per harness, no overlap:

| Harness (today's line) | Today | New block |
|---|---|---|
| tools/omnikom-cli/test/harness.mjs:69 (CLI, being fixed now) | 57000+900 | 21000-21899 |
| supabase/tests/run-local.mjs:21 | 54000+900 | 22000-22899 |
| supabase/tests/publish-parity.mjs:27 | 55000+900 | 23000-23899 |
| supabase/functions/test/harness.mjs:47 | 55000+900 | 24000-24899 |
| supabase/tests/test-apply.mjs:16 | 56000+900 | 25000-25899 |
| supabase/tests/e2e-screens.mjs:44 | 56000+900 | 26000-26899 |
| supabase/ops/restore-drill.mjs:219 | 55000+900 | 29000-29899 |
| supabase/ops/test/6b-cluster.mjs:18 | 55000+900 | 30000-30899 |
| supabase/ops/test/cluster.mjs:18 | 57000+1900 | 31000-32699 |

2. `listen_addresses` pinned to `127.0.0.1` (the harnesses connect to 127.0.0.1), so a failed bind makes `pg_ctl -w start` fail.
3. Bind fallback: on a start failure whose server log names a bind failure (`could not bind` / `Address already in use`), try the
   next port in the block, at most 5 tries, printing one line per try (`cluster: port P in use (could not bind), trying P+1`); any
   other start failure stops at once; never outside the block. This is port picking, not a test retry.
4. A wall per the ground rules: the CLI probe `tools/omnikom-cli/test/port-bind-probe.mjs` (with `test/port-hold.py`, lands with the
   CLI fix) takes the port and the start command as arguments and holds a TIME_WAIT or ESTABLISHED socket on P; use it, or its
   method, to watch each harness red on the old range/listen setting and green on the new; a mutant (old range back, or fallback
   removed) caught in supabase/tests/run-local.mjs.

## Done when
Each harness's watched-red and green lines, the mutant caught, T14 green, `node docs/blueprint/specs/run-all-gates.mjs` green, and
the check-branch ci.yml run green. Land order is the head of operations' call.
