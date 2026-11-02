// Unit test of supabase/tests/lib/cluster-port.mjs (slice 5-PORT): the port blocks, the listen pin, the bind fallback, and that every
// harness takes its port from the module. No Postgres needed: a stand-in pg_ctl (lib/fake-pg-ctl-bind.mjs) answers. About 1 s.
//   node supabase/tests/cluster-port.test.mjs        exit 0 = every check passes
// The mutants of run-local.mjs run this file against a broken copy of the module (CLUSTER_PORT_MODULE) or of the harnesses
// (CLUSTER_PORT_SUPABASE), and require it to fail.
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = process.env.CLUSTER_PORT_MODULE ? resolve(process.env.CLUSTER_PORT_MODULE) : join(HERE, 'lib', 'cluster-port.mjs');
const SUPABASE = process.env.CLUSTER_PORT_SUPABASE ? resolve(process.env.CLUSTER_PORT_SUPABASE) : resolve(HERE, '..');
const FAKE = join(HERE, 'lib', 'fake-pg-ctl-bind.mjs');
const M = await import(pathToFileURL(MODULE).href);

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ': ' + detail}`); if (!ok) failed++; };

// ---- the table
const LINUX = [32768, 60999], WINDOWS = [49152, 65535];
const inside = (p, [lo, hi]) => p >= lo && p <= hi;
const overlap = ([a, b], [c, d]) => a <= d && c <= b;
const names = Object.keys(M.BLOCKS);
check('the table names the 8 harness blocks', names.length === 8, names.join());
check('every block lies below 32768', names.every(n => M.BLOCKS[n][1] < 32768), JSON.stringify(M.BLOCKS));
check('no block touches the Linux (32768-60999) or Windows (49152-65535) ephemeral range', names.every(n => !overlap(M.BLOCKS[n], LINUX) && !overlap(M.BLOCKS[n], WINDOWS)));
check('every block holds at least 900 ports (room for 5 tries)', names.every(n => M.BLOCKS[n][1] - M.BLOCKS[n][0] + 1 >= 900));
let clash = '';
for (const a of names) for (const b of [...names, 'cli']) if (a < b || b === 'cli') { if (overlap(M.BLOCKS[a], b === 'cli' ? M.CLI_BLOCK : M.BLOCKS[b])) clash += `${a}/${b} `; }
check('blocks do not overlap each other or the CLI block 21000-21899', clash === '' && M.CLI_BLOCK[0] === 21000 && M.CLI_BLOCK[1] === 21899, clash);
check('pickPort stays inside the block at both ends of the random range', names.every(n => M.pickPort(n, () => 0) === M.BLOCKS[n][0] && M.pickPort(n, () => 0.9999999999) === M.BLOCKS[n][1]));
check('nextPort wraps at the end of the block and never leaves it', names.every(n => M.nextPort(n, M.BLOCKS[n][1]) === M.BLOCKS[n][0] && M.nextPort(n, M.BLOCKS[n][0]) === M.BLOCKS[n][0] + 1));

// ---- the listen pin
const o = M.pgOptions(22005);
check('pg_ctl options: the port, no unix socket, listen pinned to 127.0.0.1', /-p 22005\b/.test(o) && /-k ""/.test(o) && /-c listen_addresses=127\.0\.0\.1\b/.test(o), o);

// ---- the start with the stand-in pg_ctl
const tmp = mkdtempSync(join(tmpdir(), 'omk-cport-'));
const trial = (env, { rand = () => 0, used = null, log = join(tmp, 'pg.log'), seed = '' } = {}) => {
  const calls = join(tmp, 'calls.jsonl');
  writeFileSync(calls, ''); writeFileSync(log, seed);
  const said = [];
  const run = (cmd, args) => spawnSync(process.execPath, [FAKE, ...args], { encoding: 'utf8', timeout: 30000, env: { ...process.env, FAKE_PGCTL_LOG: calls, FAKE_BUSY: '', FAKE_OTHER: '', ...env } });
  const res = M.startOnBlock('run-local', { data: join(tmp, 'data'), log, run, say: l => said.push(l), rand, used });
  const seen = readFileSync(calls, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { res, said, seen };
};
try {
  let t = trial({});
  check('a free port starts on the first try, at the block start, with the listen pin', t.res.ok && t.res.port === 22000 && t.res.tries === 1 && t.seen.length === 1 && t.seen[0].listen === '127.0.0.1' && t.said.length === 0, JSON.stringify(t));

  t = trial({ FAKE_BUSY: '22000' });
  check('a bind failure moves to the next port, prints one line, and starts there', t.res.ok && t.res.port === 22001 && t.res.tries === 2 && t.said.join('|') === 'cluster: port 22000 in use (could not bind), trying 22001', JSON.stringify(t));

  t = trial({ FAKE_BUSY: '22000,22001,22002' });
  check('three bind failures in a row: the fourth port starts, three lines', t.res.ok && t.res.port === 22003 && t.res.tries === 4 && t.said.length === 3, JSON.stringify(t));

  t = trial({ FAKE_BUSY: '22000,22001,22002,22003,22004,22005,22006' });
  check('it stops after 5 tries, in the block, and says why', !t.res.ok && t.res.tries === 5 && t.seen.length === 5 && t.res.why === 'bind-exhausted' && t.seen.every(c => c.port >= 22000 && c.port <= 22004) && t.said.length === 4, JSON.stringify(t));

  t = trial({ FAKE_OTHER: '1' });
  check('another start failure stops at once: one call, no "trying" line', !t.res.ok && t.seen.length === 1 && t.res.why === 'other' && t.said.length === 0, JSON.stringify(t));

  t = trial({ FAKE_OTHER: '1' }, { seed: '2026-11-01 LOG:  could not bind IPv4 address "127.0.0.1": Address already in use\n' });
  check('a bind line left in the log by an earlier try does not count for this try', !t.res.ok && t.seen.length === 1 && t.res.why === 'other', JSON.stringify(t));

  const top = M.BLOCKS['run-local'][1];
  t = trial({ FAKE_BUSY: String(top) }, { rand: () => 0.9999999999 });
  check('at the end of the block the walk wraps to the block start, never past it', t.res.ok && t.seen[0].port === top && t.seen[1].port === 22000, JSON.stringify(t.seen));

  t = trial({}, { used: new Set([22000, 22001]) });
  check('ports held by this process\'s other clusters are skipped, and the chosen one is recorded', t.res.ok && t.res.port === 22002, JSON.stringify(t.res));
} finally { rmSync(tmp, { recursive: true, force: true }); }

// ---- every harness takes its port from the module (no private random pick, no private pg_ctl port option)
const HARNESSES = [
  ['run-local', 'tests/run-local.mjs'], ['publish-parity', 'tests/publish-parity.mjs'], ['functions-harness', 'functions/test/harness.mjs'],
  ['test-apply', 'tests/test-apply.mjs'], ['e2e-screens', 'tests/e2e-screens.mjs'], ['restore-drill', 'ops/restore-drill.mjs'],
  ['6b-cluster', 'ops/test/6b-cluster.mjs'], ['ops-cluster', 'ops/test/cluster.mjs'],
];
for (const [name, rel] of HARNESSES) {
  const f = join(SUPABASE, rel);
  const text = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const uses = text.includes(`startOnBlock('${name}'`) || text.includes(`pickPort('${name}'`);
  const oldPick = /Math\.random\(\) \* (900|1900)/.test(text) || /5[4-7]000\s*\+/.test(text);
  const ownOpts = /-o', `-p \$\{/.test(text);
  check(`${rel}: takes block "${name}" from the module, no private port pick`, uses && !oldPick && !ownOpts, `uses ${uses}, old pick ${oldPick}, own -o ${ownOpts}`);
}

console.log(failed ? `\nFAILED: ${failed} check(s)` : '\nOK: every check passes');
process.exit(failed ? 1 : 0);
