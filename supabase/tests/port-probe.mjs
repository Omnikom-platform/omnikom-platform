// supabase/tests/port-probe.mjs (slice 5-PORT): the Linux watched-red / watched-green for the test-cluster port rules. A probe, not a suite
// check: GitHub runs it once on a check branch. Needs initdb, pg_ctl, psql on PATH and python3.
//   node supabase/tests/port-probe.mjs [--hold tw|est] [--base 22400]
// Three cases, each on its own port of the run-local block (a TIME_WAIT lasts 60 s), each with a plain client socket (what every psql call
// opens: no SO_REUSEADDR) already holding 127.0.0.1:P before the cluster starts:
//   1 OLD     pg_ctl -o '-p P -k ""'            (listen_addresses stays 'localhost')   RED expected: pg_ctl exits 0, the postmaster lives
//                                                on ::1 only, and a connection to 127.0.0.1:P is refused (the half-up cluster)
//   2 PINNED  pg_ctl with the module's pgOptions (listen_addresses=127.0.0.1), no fallback  expected: pg_ctl exits 1, no postmaster (loud)
//   3 NEW     startOnBlock('run-local') with its first pick forced to P                     GREEN expected: it prints the "trying P+1"
//                                                line, starts on P+1, and 127.0.0.1:P+1 answers
// Prints one JSON line per case and a final line "PORT PROBE: OK ..." (exit 0) when all three behave as expected, or "PORT PROBE: FAILED"
// (exit 1) naming the case. A case whose holder did not take the port (the socket is not in /proc/net/tcp, or netstat on Windows) exits 3:
// nothing was proven. Windows half-binds as well (CLI head, 2026-11-02), but only with an ESTABLISHED holder: there the default is --hold est
// and --hold tw is refused (exit 3). Linux default: tw (TIME_WAIT alone is enough there).
import { mkdtempSync, rmSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { startOnBlock, pgOptions, BLOCKS } from './lib/cluster-port.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
const WIN = process.platform === 'win32';
const hold = arg('--hold', WIN ? 'est' : 'tw');
const base = Number(arg('--base', BLOCKS['run-local'][0] + 400));
const sh = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, windowsHide: true, ...o });
if (hold !== 'tw' && hold !== 'est') { console.log('PORT PROBE: NOT RUN: --hold is tw or est'); process.exit(3); }
// the CLI head's finding (2026-11-02): a plain client socket holding 127.0.0.1:P half-binds the postmaster on Windows too, but only while
// ESTABLISHED; TIME_WAIT alone blocks on Linux, not on Windows
if (WIN && hold === 'tw') { console.log('PORT PROBE: NOT RUN: on Windows only an ESTABLISHED holder blocks the bind (use --hold est)'); process.exit(3); }

const socketsOn = p => {
  if (WIN) {   // netstat: "  TCP    127.0.0.1:22400   127.0.0.1:50321   ESTABLISHED   1234"
    return String(sh('netstat', ['-ano', '-p', 'tcp']).stdout || '').split(/\r?\n/).map(l => l.trim().split(/\s+/)).filter(c => c[0] === 'TCP' && c[1] && c[1].endsWith(`:${p}`)).map(c => `v4:${c[3]}`);
  }
  const out = [];
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n').slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c.length >= 4 && parseInt(c[1].split(':')[1], 16) === p) out.push(`${f.endsWith('6') ? 'v6' : 'v4'}:${{ '01': 'ESTABLISHED', '06': 'TIME_WAIT', '0A': 'LISTEN' }[c[3]] || c[3]}`);
    }
  }
  return out;
};
const ping = (host, p) => { const r = sh('psql', ['-h', host, '-p', String(p), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-c', 'select 1'], { timeout: 20000 }); return r.status === 0 ? 'ok' : String(r.stderr || r.error).split('\n')[0].slice(0, 140); };
const bindLines = log => (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter(l => /could not bind|listening on/.test(l)).map(l => l.slice(0, 200));
const alive = dir => { const f = join(dir, 'data', 'postmaster.pid'); if (!existsSync(f)) return false; try { process.kill(Number(readFileSync(f, 'utf8').split('\n')[0]), 0); return true; } catch { return false; } };

const holders = [];
async function makeHeld(p) {
  const server = net.createServer(s => { s.on('end', () => s.end()); s.on('error', () => {}); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const py = spawn(WIN ? 'python' : 'python3', [join(HERE, 'lib', 'port-hold.py'), String(p), String(server.address().port), hold, '120'], { stdio: ['ignore', 'pipe', 'inherit'] });
  holders.push(py);
  await new Promise((res, rej) => {
    setTimeout(() => rej(new Error('the python holder printed nothing in 15 s')), 15000).unref();
    py.stdout.on('data', d => { if (String(d).includes('held')) res(); });
    py.on('error', rej);
    py.on('exit', code => rej(new Error('the python holder exited ' + code)));
  });
  await new Promise(r => setTimeout(r, 300));
}

// initdb runs once (it took 123 s on a loaded laptop); each case gets a copy of that data folder
const templateDir = mkdtempSync(join(tmpdir(), 'omnikom-pg-portprobe-tpl-'));
{ const r = sh('initdb', ['-D', join(templateDir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], { timeout: 600000 }); if (r.status !== 0) { rmSync(templateDir, { recursive: true, force: true }); console.log('PORT PROBE: NOT RUN: initdb failed: ' + (r.stderr || r.error)); process.exit(3); } }
const clusterDir = () => { const dir = mkdtempSync(join(tmpdir(), 'omnikom-pg-portprobe-')); const data = join(dir, 'data'); cpSync(join(templateDir, 'data'), data, { recursive: true }); return { dir, data, log: join(dir, 'pg.log') }; };
const stopAndRemove = c => { sh('pg_ctl', ['-D', c.data, '-m', 'immediate', 'stop']); rmSync(c.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); };

const verdicts = [];
async function oneCase(name, port, body) {
  await makeHeld(port);
  const before = socketsOn(port);
  if (!before.some(s => (hold === 'tw' ? s.endsWith('TIME_WAIT') : s.endsWith('ESTABLISHED')))) { console.log(JSON.stringify({ case: name, port, error: 'the holder did not take the port', socketsBefore: before })); console.log('PORT PROBE: NOT PROVEN: no socket held the port'); process.exit(3); }
  const c = clusterDir();
  const res = { case: name, port, hold, socketsBefore: before };
  try { await body(c, res); } finally { try { stopAndRemove(c); } catch { /* best effort */ } }
  console.log(JSON.stringify(res));
  return res;
}

try {
  // 1 OLD
  const old = await oneCase('old', base, (c, res) => {
    const r = sh('pg_ctl', ['-D', c.data, '-o', `-p ${base} -k ""`, '-l', c.log, '-w', 'start']);
    res.pgctlStatus = r.status; res.postmasterAlive = alive(c.dir);
    if (res.postmasterAlive) { res.ping4 = ping('127.0.0.1', base); res.ping6 = ping('::1', base); }
    res.bindLines = bindLines(c.log);
  });
  verdicts.push(['old: half-up (pg_ctl 0, postmaster alive, 127.0.0.1 refused, ::1 answers)', old.pgctlStatus === 0 && old.postmasterAlive && old.ping4 !== 'ok' && old.ping6 === 'ok']);

  // 2 PINNED
  const p2 = base + 10;
  const pinned = await oneCase('pinned', p2, (c, res) => {
    const r = sh('pg_ctl', ['-D', c.data, '-o', pgOptions(p2), '-l', c.log, '-w', 'start']);
    res.pgctlStatus = r.status; res.postmasterAlive = alive(c.dir); res.bindLines = bindLines(c.log);
  });
  verdicts.push(['pinned: a loud start failure (pg_ctl not 0, no postmaster)', pinned.pgctlStatus !== 0 && !pinned.postmasterAlive]);

  // 3 NEW
  const p3 = base + 20, [lo, hi] = BLOCKS['run-local'];
  const neu = await oneCase('new', p3, (c, res) => {
    const said = [];
    const s = startOnBlock('run-local', { data: c.data, log: c.log, say: l => said.push(l), rand: () => (p3 - lo + 0.5) / (hi - lo + 1) });   // the first pick is exactly p3 (the half keeps the floor off a rounding edge)
    res.said = said; res.ok = s.ok; res.landedPort = s.port; res.tries = s.tries; res.postmasterAlive = alive(c.dir);
    if (s.ok) res.ping4 = ping('127.0.0.1', s.port);
  });
  verdicts.push(['new: walked to the next port, said so, and 127.0.0.1 answers', neu.ok === true && neu.landedPort === p3 + 1 && neu.said.length === 1 && neu.said[0] === `cluster: port ${p3} in use (could not bind), trying ${p3 + 1}` && neu.ping4 === 'ok']);
} finally { for (const h of holders) { try { h.kill(); } catch { /* gone */ } } rmSync(templateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }

const bad = verdicts.filter(v => !v[1]);
for (const [n, ok] of verdicts) console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`);
console.log(bad.length ? `PORT PROBE: FAILED: ${bad.map(b => b[0].split(':')[0]).join(', ')}` : `PORT PROBE: OK: old setting red (half-up), pinned loud, new green (walks to the next port) with a ${hold === 'tw' ? 'TIME_WAIT' : 'ESTABLISHED'} holder`);
process.exit(bad.length ? 1 : 0);
