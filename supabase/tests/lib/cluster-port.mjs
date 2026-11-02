// The one place that decides which port a throwaway test cluster listens on, and how it starts (slice 5-PORT).
//
// Why: on Linux a client socket without SO_REUSEADDR (every psql call) that holds 127.0.0.1:P, even only in TIME_WAIT, makes the
// postmaster's IPv4 bind fail. With the default listen_addresses=localhost it still binds ::1, so `pg_ctl -w start` exits 0 and
// 127.0.0.1:P is refused for the cluster's whole life (PROVEN, run 41350867780; tools/omnikom-cli/briefs/to-platform-port-map.md).
// psql only takes ports of the ephemeral range, so a port below 32768 is never held that way. Three rules, all here:
//   1. one block per harness, all below 32768 (outside Linux 32768-60999 and Windows 49152-65535), none overlapping;
//   2. listen_addresses pinned to 127.0.0.1, so a failed IPv4 bind makes `pg_ctl -w start` fail loudly;
//   3. on a start failure whose server log names a bind failure, try the next port of the block (at most 5 tries, one line per try);
//      any other failure stops at once; the pick never leaves its block. This is port picking, not a test retry.
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// name -> [first port, last port]. 21000-21899 is the CLI's own block (tools/omnikom-cli/test/harness.mjs); not ours to change.
export const CLI_BLOCK = [21000, 21899];
export const BLOCKS = {
  'run-local': [22000, 22899],
  'publish-parity': [23000, 23899],
  'functions-harness': [24000, 24899],
  'test-apply': [25000, 25899],
  'e2e-screens': [26000, 26899],
  'restore-drill': [29000, 29899],
  '6b-cluster': [30000, 30899],
  'ops-cluster': [31000, 32699],
};
export const MAX_TRIES = 5;
export const LISTEN = '127.0.0.1';
export const BIND_FAILURE = /could not bind|Address already in use/i;

// `-o` string for pg_ctl: the port, no unix socket, the listen pin.
export const pgOptions = port => `-p ${port} -k "" -c listen_addresses=${LISTEN}`;

// A random port of the block. `rand` is injectable for tests.
export function pickPort(name, rand = Math.random) {
  const b = BLOCKS[name];
  if (!b) throw new Error(`cluster-port: no port block named "${name}"`);
  return b[0] + Math.floor(rand() * (b[1] - b[0] + 1));
}
// The next port of the same block, wrapping at its end, so the walk never leaves it.
export function nextPort(name, port) {
  const [lo, hi] = BLOCKS[name];
  return port >= hi ? lo : port + 1;
}

const sizeOf = f => { try { return statSync(f).size; } catch { return 0; } };
const tailFrom = (f, from) => { try { return readFileSync(f).subarray(from).toString('utf8'); } catch { return ''; } };

// Start `pg_ctl -w start` on a port of `name`'s block, moving to the next port only on a bind failure.
//   data, log      the data folder and the server log file (pg_ctl -l)
//   run            (cmd, args, opts) => spawnSync-like result; the harness passes its own so its timeout and encoding stay
//   opts           passed through to run (timeout, stdio, ...)
//   used           ports other clusters of this process hold (so two clusters never pick the same one); optional Set
//   say            one line per try (default console.error)
//   pgCtl, rand    injectable for tests
// Returns { ok: true, port, tries } or { ok: false, port, tries, status, error, log, why } (the last try's log text, only that try's).
export function startOnBlock(name, { data, log, run, opts = {}, used = null, say = console.error, pgCtl = 'pg_ctl', rand = Math.random }) {
  const runIt = run || ((cmd, args, o) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 600000, ...o }));
  let port = pickPort(name, rand);
  for (let tries = 1; ; tries++) {
    if (used) { for (let i = 0; used.has(port) && i < 5000; i++) port = nextPort(name, port); }
    const from = sizeOf(log);   // the server log is appended to: only what THIS try wrote counts
    const r = runIt(pgCtl, ['-D', data, '-o', pgOptions(port), '-l', log, '-w', 'start'], opts);
    if (r.status === 0) { if (used) used.add(port); return { ok: true, port, tries }; }
    const text = tailFrom(log, from);
    const bind = BIND_FAILURE.test(text) || BIND_FAILURE.test(`${r.stderr ?? ''}${r.stdout ?? ''}`);
    if (!bind) return { ok: false, port, tries, status: r.status, error: r.error, stderr: r.stderr, log: text, why: 'other' };
    if (tries >= MAX_TRIES) return { ok: false, port, tries, status: r.status, error: r.error, stderr: r.stderr, log: text, why: 'bind-exhausted' };
    const next = nextPort(name, port);
    say(`cluster: port ${port} in use (could not bind), trying ${next}`);
    port = next;
  }
}
