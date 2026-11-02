// test/port-bind-probe.mjs: a probe, not a suite check. Takes the port P, what holds it, and the start command, and prints what a Postgres
// cluster started on P does when something else already holds P. One JSON line, exit 0 (it reports; it does not judge).
//   node test/port-bind-probe.mjs --port 21500 --hold none|tw|est|tw-reuse|est-reuse --start old|pinned|harness
//   (tw, est: a plain socket made by port-hold.py, no SO_REUSEADDR, like psql's; tw-reuse, est-reuse: made by node, SO_REUSEADDR set)
//   --hold  none: nothing; tw: a TIME_WAIT socket whose LOCAL port is P (the client closed first); est: an ESTABLISHED client socket with
//           local port P, held open for the probe (a psql call still open, or any program that owns P)
//   --start old: the command the harness used until 2026-11-01 (pg_ctl -o "-p P -k \"\"": listen_addresses stays 'localhost' = ::1 and 127.0.0.1)
//           pinned: the same with -c listen_addresses=127.0.0.1
//           harness: harness.mjs startCluster() with its first try forced to P (it walks to P+1 on a failed bind and says so)
//   --census N   (Linux) N short psql calls against a cluster, then: how many local ports those sockets hold, and whether a server can still
//           listen on each of them (node's listener sets SO_REUSEADDR like Postgres does)
// WHAT IT PROVES (GitHub run 41350867780, Ubuntu 26.04, PG 18.6, ip_local_port_range 32768-60999): on Linux a plain client socket (what every
// psql call opens) holding 127.0.0.1:P, even only in TIME_WAIT, makes the postmaster's IPv4 bind fail. With the default
// listen_addresses='localhost' the server still comes up on ::1, so `pg_ctl -w start` says ok, the postmaster lives, and 127.0.0.1:P is
// refused for the cluster's whole life. That was the "cluster guard (real kill)" red and the mutate "create database failed" red of
// 2026-11-01: the harness took ports from 57000-57899, inside the ephemeral range the psql sockets come from. The same probe with no holder, or
// with a holder that set SO_REUSEADDR, shows a healthy cluster. `--start pinned` shows the loud failure; `--start harness` the walk to P+1.
// Windows half-binds too with an ESTABLISHED plain-socket holder (pg_ctl ok, 127.0.0.1 refused, ::1 answers); a TIME_WAIT holder does not block
// the bind there, and a holder made by node (SO_REUSEADDR) shows nothing on either system.
// HOW TO RUN: needs initdb, pg_ctl, psql on PATH and python3 (python on Windows) for tw / est; run each case on its own port (a TIME_WAIT
// lasts 60 s). The other harnesses with a fixed port range (supabase/**, see briefs/real-kill-flake.md "Port map") can be tried the same way.
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { startCluster, CLUSTER_PREFIX } from './harness.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
const hold = arg('--hold', 'none');
const start = arg('--start', 'harness');
const port = Number(arg('--port', 21000 + Math.floor(Math.random() * 900)));
const sh = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, ...o });

// the range the OS hands out as local ports of outgoing connections
function ephemeralRange() {
  if (existsSync('/proc/sys/net/ipv4/ip_local_port_range')) return readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().replace(/\s+/, '-');
  const r = sh('netsh', ['int', 'ipv4', 'show', 'dynamicport', 'tcp']);
  return String(r.stdout || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

// state of the sockets whose local port is `p` (Linux /proc/net/tcp and tcp6; hex local port)
function socketsOn(p) {
  const out = [];
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n').slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c.length < 4) continue;
      if (parseInt(c[1].split(':')[1], 16) === p) out.push(`${f.endsWith('6') ? 'v6' : 'v4'}:${{ '01': 'ESTABLISHED', '06': 'TIME_WAIT', '0A': 'LISTEN' }[c[3]] || c[3]}`);
    }
  }
  return out;
}

// a client socket whose LOCAL port is p, to a throwaway listener: closed at once (TIME_WAIT) or kept open (ESTABLISHED).
// reuse true: made by node (libuv sets SO_REUSEADDR on it); false: made by port-hold.py, a plain socket like the one a psql call opens.
let holderProc = null;
async function makeHeld(p, keepOpen, reuse) {
  const server = net.createServer(s => { s.on('end', () => s.end()); s.on('error', () => {}); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  if (!reuse) {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    holderProc = spawn(py, [join(dirname(fileURLToPath(import.meta.url)), 'port-hold.py'), String(p), String(server.address().port), keepOpen ? 'est' : 'tw', '90'], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((res, rej) => {
      setTimeout(() => rej(new Error('the python holder printed nothing in 15 s')), 15000).unref();
      holderProc.stdout.on('data', d => { if (String(d).includes('held')) res(); });
      holderProc.on('error', rej);
      holderProc.on('exit', code => rej(new Error('the python holder exited ' + code)));
    });
    await new Promise(r => setTimeout(r, 300));
    return;
  }
  await new Promise((res, rej) => {
    setTimeout(() => rej(new Error('the held socket was not made in 10 s')), 10000).unref();
    const c = net.connect({ host: '127.0.0.1', port: server.address().port, localPort: p }, () => { if (keepOpen) res(); else c.destroy(); });
    c.on('error', rej);
    c.on('close', () => res());
  });
  await new Promise(r => setTimeout(r, 300));
}

const ping = (host, p) => { const r = sh('psql', ['-h', host, '-p', String(p), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-c', 'select 1'], { timeout: 20000 }); return r.status === 0 ? 'ok' : String(r.stderr || r.error).split('\n')[0].replace(/\r/g, '').slice(0, 140); };
const bindLines = log => (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter(l => /could not bind|listening on|no socket created/.test(l)).map(l => l.replace(/\r/g, '').slice(0, 200));

// --census N: N short psql calls against a cluster (what the suite does all day), then how many local ports of the OLD block (57000-57899)
// and of the NEW block (21000-21899) are held by those sockets (TIME_WAIT lasts 60 s on Linux). Each held port is a port the old harness
// could not have used. Linux only (/proc/net/tcp).
if (process.argv.includes('--census')) {
  const n = Number(arg('--census', 500));
  const markers = mkdtempSync(join(tmpdir(), 'omnikom-cli-markers-'));
  const c = startCluster({ markerDir: markers, signals: false });
  for (let i = 0; i < n; i++) sh('psql', ['-h', '127.0.0.1', '-p', c.port, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-c', 'select 1'], { timeout: 20000 });
  const held = new Map();                                                // local port -> states
  for (const f of ['/proc/net/tcp']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n').slice(1)) {
      const col = line.trim().split(/\s+/);
      if (col.length < 4) continue;
      const lp = parseInt(col[1].split(':')[1], 16);
      held.set(lp, [...(held.get(lp) || []), { '01': 'ESTABLISHED', '06': 'TIME_WAIT', '0A': 'LISTEN' }[col[3]] || col[3]]);
    }
  }
  // can a server (node sets SO_REUSEADDR on a listener, as Postgres does) still listen on 127.0.0.1:p while a psql socket holds p?
  const tryListen = p => new Promise(res => { const s = net.createServer(); s.once('error', e => res(e.code)); s.listen(p, '127.0.0.1', () => s.close(() => res('ok'))); });
  const listenResult = {};
  for (const p of held.keys()) { const r = await tryListen(p); const k = `${[...new Set(held.get(p))].sort().join('+')} -> ${r}`; listenResult[k] = (listenResult[k] || 0) + 1; }
  const ports = [...held.keys()];
  const inBlock = (a, b) => [...held.keys()].filter(p => p >= a && p <= b);
  const states = ps => ps.flatMap(p => held.get(p)).reduce((m, s) => ({ ...m, [s]: (m[s] || 0) + 1 }), {});
  const oldPorts = inBlock(57000, 57899), newPorts = inBlock(21000, 21899).filter(p => String(p) !== String(c.port));
  console.log(JSON.stringify({ census: { psqlCalls: n, ephemeral: ephemeralRange(), socketsHeld: held.size, localPortSpan: [Math.min(...ports), Math.max(...ports)], listenOnAHeldPort: listenResult, oldBlock57000to57899: { ports: oldPorts.length, ofPorts: 900, states: states(oldPorts) }, newBlock21000to21899: { ports: newPorts.length, ofPorts: 900 } } }));
  c.stop(); rmSync(markers, { recursive: true, force: true });
  process.exit(0);
}

const res = { port, hold, start, ephemeral: ephemeralRange() };
let dir = '', stop = () => {};
try {
  if (hold === 'tw' || hold === 'est') await makeHeld(port, hold === 'est', false);             // a plain socket (python), like a psql call's
  if (hold === 'tw-reuse' || hold === 'est-reuse') await makeHeld(port, hold === 'est-reuse', true);   // a node socket (SO_REUSEADDR set)
  res.socketsBefore = socketsOn(port);
  let landed = port;
  if (start === 'harness') {
    const markers = mkdtempSync(join(tmpdir(), 'omnikom-cli-markers-'));
    const said = [];
    const c = startCluster({ markerDir: markers, signals: false, firstPort: port, say: l => said.push(l) });
    dir = c.dir; landed = Number(c.port); res.said = said; res.pgctlStatus = 0;
    stop = () => { c.stop(); rmSync(markers, { recursive: true, force: true }); };
  } else {
    dir = mkdtempSync(join(tmpdir(), CLUSTER_PREFIX));
    const data = join(dir, 'data');
    let r = sh('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
    if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.error));
    r = sh('pg_ctl', ['-D', data, '-o', `-p ${port} -k ""${start === 'pinned' ? ' -c listen_addresses=127.0.0.1' : ''}`, '-l', join(dir, 'pg.log'), '-w', 'start']);
    res.pgctlStatus = r.status;
    stop = () => { sh('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); };
  }
  res.landedPort = landed;
  const pidFile = join(dir, 'data', 'postmaster.pid');
  const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').split('\n')[0]) : 0;
  let alive = false; if (pid) { try { process.kill(pid, 0); alive = true; } catch { /* gone */ } }
  res.postmasterPidAlive = alive;
  if (alive) { res.ping4 = ping('127.0.0.1', landed); res.ping6 = ping('::1', landed); }
  res.bindLines = bindLines(join(dir, 'pg.log'));
} catch (e) { res.error = String(e.message || e).slice(0, 600); if (dir) res.bindLines = bindLines(join(dir, 'pg.log')); }
finally {
  try { stop(); } catch { /* best effort */ }
  if (holderProc) holderProc.kill();
}
console.log(JSON.stringify(res));
process.exit(0);   // the held socket and its listener would keep the loop alive
