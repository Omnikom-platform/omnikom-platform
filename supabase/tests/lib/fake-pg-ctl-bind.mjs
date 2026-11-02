// A stand-in for `pg_ctl -D <data> -o "<opts>" -l <log> -w start`, for supabase/tests/cluster-port.test.mjs. Starts nothing.
// Records every call (one JSON line of {port, listen} in FAKE_PGCTL_LOG) and answers by environment:
//   FAKE_BUSY=22000,22003   those ports fail the way a held port does on Linux: the server log gets the postmaster's bind line, exit 1
//   FAKE_OTHER=1            every start fails for another reason (not a bind failure), exit 1
//   neither                 the start succeeds, exit 0
import { appendFileSync } from 'node:fs';

const a = process.argv.slice(2);
const opts = a[a.indexOf('-o') + 1] || '';
const log = a[a.indexOf('-l') + 1];
const port = Number((opts.match(/-p (\d+)/) || [])[1]);
const listen = (opts.match(/listen_addresses=(\S+)/) || [])[1] || null;
appendFileSync(process.env.FAKE_PGCTL_LOG, JSON.stringify({ port, listen }) + '\n');
const busy = (process.env.FAKE_BUSY || '').split(',').filter(Boolean).map(Number);
if (busy.includes(port)) {
  appendFileSync(log, `2026-11-01 23:50:00.000 UTC [1] LOG:  could not bind IPv4 address "127.0.0.1": Address already in use\n2026-11-01 23:50:00.000 UTC [1] FATAL:  could not create any TCP/IP sockets\n`);
  console.error('waiting for server to start.... stopped waiting\npg_ctl: could not start server');
  process.exit(1);
}
if (process.env.FAKE_OTHER) {
  appendFileSync(log, `2026-11-01 23:50:00.000 UTC [1] FATAL:  data directory "x" has invalid permissions\n`);
  console.error('pg_ctl: could not start server');
  process.exit(1);
}
process.exit(0);
