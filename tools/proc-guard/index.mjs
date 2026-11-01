// proc-guard: nothing a run starts outlives the run (slice 5-H). No dependencies.
//
// Why it exists: on 2026-11-01 02:07 the laptop had to be restarted with 1021 orphaned headless Edge processes and 40 Postgres
// processes left behind by runs that were killed or timed out. A time limit on spawnSync kills only the main process; a killed run
// never reaches its finally; nothing swept the leftovers later.
//
//   guardedTemp(prefix, kind)   a temp folder owned by this process (owner.json), cleaned on every exit path
//   guardedTempEnv(prefix, kind) the same, and TEMP/TMP/TMPDIR point at it, so a library that makes its own temp profile
//                               (Playwright) makes it inside the guarded folder
//   runLimited(cmd, args, opts) spawn with a time limit that kills the whole process tree, never only the main process
//   killTree(pid, dir)          the process and everything under it; with dir, also every process that still holds that folder
//   leaks(prefixes)             processes whose command line names one of our temp folders
//   sweep(prefixes)             cleans the folders whose owner is gone (a hard kill never runs any cleanup)
//
// What a cleanup does for one folder, in this order: stop the cluster if data/postmaster.pid exists (pg_ctl stop -m immediate),
// kill every process whose command line contains the folder path (browsers carry it in --user-data-dir), delete the folder.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { join, basename } from 'node:path';

// Folder prefixes of ours. mkdtemp adds six characters, so a folder counts only when it is exactly <prefix><6 characters>.
export const PREFIXES = ['omnikom-pg-', 'omnikom-fn-', 'mmd-', 'mmd-probe-', 'wf-', 'pw-dash-', 'pw-de-', 'site-backup-', 'playwright_chromiumdev_profile-'];
// Folders another program makes (Playwright's browser profile) have no owner.json: they are ours to clean only when the browser's
// parent process is dead. Every other prefix needs an owner.json naming a dead process, or no owner.json and an age over 6 hours.
export const PARENT_CHECKED = ['playwright_chromiumdev_profile-'];
export const NO_OWNER_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const WIN = process.platform === 'win32';
const norm = s => String(s).replace(/\\/g, '/');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sleepMs = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait available */ } };

// ---------- processes ----------
// Every process as { pid, ppid, name, cmd }. Windows: one PowerShell call (CIM); Linux: /proc; elsewhere: ps.
export function listProcs() {
  if (WIN) {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`could not list processes: ${(r.stderr || r.error || '').toString().slice(0, 200)}`);
    let j = JSON.parse(r.stdout || '[]');
    if (!Array.isArray(j)) j = [j];
    return j.map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name || '', cmd: p.CommandLine || '' }));
  }
  if (existsSync('/proc/self/cmdline')) {
    const out = [];
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').join(' ').trim();
        const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
        const name = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
        out.push({ pid: Number(d), ppid, name, cmd });
      } catch { /* the process ended while it was read */ }
    }
    return out;
  }
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('could not list processes: ps failed');
  return r.stdout.split('\n').map(l => l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(m => ({ pid: Number(m[1]), ppid: Number(m[2]), name: basename(m[3].split(' ')[0]), cmd: m[3] }));
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// The process and everything under it. Windows: taskkill /T /F. Elsewhere: a process-group kill (the child must have been
// started detached, runLimited does that), then the single process as a fallback.
function killTreeOnly(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  if (WIN) {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 30000, stdio: 'ignore' });
    return r.status === 0;
  }
  try { process.kill(-pid, 'SIGKILL'); return true; } catch { /* not a group leader */ }
  try { process.kill(pid, 'SIGKILL'); return true; } catch { return false; }
}

// The tree kill misses processes that left the tree: a browser's zygote and renderers start their own session or group on Linux, and an
// orphan whose parent died is no longer anyone's child. So with `dir` (the guarded folder) every process still holding the folder
// dies too, found by command line (Linux /proc, Windows the CIM query). Anything holding our folder dies.
export function killTree(pid, dir = null) {
  const ok = killTreeOnly(pid);
  if (dir) { try { killFolderProcs(dir); } catch { /* the list failed; release() looks again */ } }
  return ok;
}

// This process and its parents: never killed by a cleanup.
function ancestors(procs) {
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const set = new Set([process.pid]);
  for (let p = byPid.get(process.pid), n = 0; p && p.ppid && !set.has(p.ppid) && n < 64; n++) { set.add(p.ppid); p = byPid.get(p.ppid); }
  return set;
}

// Kill every process whose command line contains `dir`, and the children of those (a child may not carry the folder in its own
// command line). Windows kills the roots of that set with their trees; elsewhere every member is killed on its own, because a member
// can be in another group or session than its parent. Then it looks again (a survivor, or a process that started meanwhile) and
// repeats, at most three rounds. Returns how many processes it killed.
export function killFolderProcs(dir, procs = listProcs()) {
  const needle = norm(dir).toLowerCase();
  let total = 0;
  for (let round = 0; round < 3; round++) {
    if (round > 0) { sleepMs(300); procs = listProcs(); }
    const safe = ancestors(procs);
    const members = new Map(procs.filter(p => !safe.has(p.pid) && norm(p.cmd).toLowerCase().includes(needle)).map(p => [p.pid, p]));
    for (let grew = true; grew;) {
      grew = false;
      for (const p of procs) if (!safe.has(p.pid) && !members.has(p.pid) && members.has(p.ppid)) { members.set(p.pid, p); grew = true; }
    }
    if (!members.size) break;
    for (const p of members.values()) if (!WIN || !members.has(p.ppid)) killTreeOnly(p.pid);
    total += members.size;
  }
  return total;
}

// ---------- folders ----------
const nameRe = prefixes => new RegExp(`^(?:${prefixes.map(escapeRe).join('|')})[A-Za-z0-9]{6}$`);
function listFolders(prefixes, tmp) {
  const re = nameRe(prefixes);
  try { return readdirSync(tmp, { withFileTypes: true }).filter(e => e.isDirectory() && re.test(e.name)).map(e => e.name); } catch { return []; }
}
function tmpRoots(tmp) {
  const roots = new Set([norm(tmp)]);
  try { roots.add(norm(realpathSync.native(tmp))); } catch { /* no real path */ }
  return [...roots];
}

// The processes (any name) whose command line contains one of our temp folders: [{ pid, name, folder }].
export function leaks(prefixes = PREFIXES, o = {}) {
  const tmp = o.tmp || os.tmpdir();
  const procs = o.procs || listProcs();
  const re = new RegExp(`(?:${tmpRoots(tmp).map(escapeRe).join('|')})/(?:${prefixes.map(escapeRe).join('|')})[A-Za-z0-9]{6}(?![A-Za-z0-9])`, 'i');
  const out = [];
  for (const p of procs) {
    if (p.pid === process.pid) continue;
    const m = norm(p.cmd).match(re);
    if (m) out.push({ pid: p.pid, name: p.name, folder: WIN ? m[0].replace(/\//g, '\\') : m[0] });
  }
  return out;
}

// The data folders of clusters in `dir`: a folder directly inside it that holds postmaster.pid (scripts call it data or pgdata).
function clusterDataDirs(dir) {
  try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(dir, e.name, 'postmaster.pid'))).map(e => join(dir, e.name)); } catch { return []; }
}

function stopCluster(dir, pgCtl) {
  const dirs = clusterDataDirs(dir);
  if (!dirs.length) return { had: false, ok: true };
  const [cmd, ...pre] = pgCtl || ['pg_ctl'];
  let ok = true;
  for (const data of dirs) {
    const r = spawnSync(cmd, [...pre, '-D', data, '-m', 'immediate', '-w', 'stop'], { timeout: 90000, windowsHide: true, stdio: 'ignore' });
    if (r.status !== 0 || existsSync(join(data, 'postmaster.pid'))) ok = false;
  }
  return { had: true, ok };
}

function removeFolder(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* still held */ }
  return !existsSync(dir);
}

// Stop what lives in the folder, then delete it. `procs` is a ready process list (a sweep takes one for all folders).
function cleanFolder(dir, { kind, pgCtl, procs, keep } = {}) {
  const c = stopCluster(dir, pgCtl);
  let killed = 0;
  // a cluster that pg_ctl stopped has nothing left to look for: skip the (slow on Windows) process list
  if (kind !== 'cluster' || !c.ok) { try { killed = killFolderProcs(dir, procs); } catch { /* list failed: the folder removal below still runs */ } }
  if (keep) {
    try { rmSync(join(dir, 'owner.json'), { force: true }); writeFileSync(join(dir, '.keep'), 'kept on request; proc-guard does not sweep this folder\n'); } catch { /* best effort */ }
    return { stopped: c.had && c.ok, killed, removed: false };
  }
  let removed = removeFolder(dir);
  if (!removed) {
    // something still holds a file: look for it by the folder path (if not looked for yet), then try again
    if (kind === 'cluster' && c.ok) { try { killed += killFolderProcs(dir, procs); } catch { /* nothing more to do */ } }
    sleepMs(500);
    removed = removeFolder(dir);
  }
  return { stopped: c.had && c.ok, killed, removed };
}

// ---------- the guarded folder ----------
const entries = new Set();
const running = new Set();   // pids started by runLimited that have not ended
let hooked = false;

function runCleanup(entry, o = {}) {
  if (entry.done) return;
  entry.done = true;
  entries.delete(entry);
  cleanFolder(entry.dir, { kind: entry.kind, pgCtl: entry.pgCtl, keep: o.keep });
}

function cleanupAll() {
  for (const pid of [...running]) killTreeOnly(pid);
  for (const entry of [...entries]) runCleanup(entry);
}

function installHooks() {
  if (hooked) return;
  hooked = true;
  // 'exit' also runs after an uncaught exception and after an unhandled rejection (both end the process): one hook covers them.
  process.on('exit', cleanupAll);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    try {
      process.on(sig, () => {
        if (process.listenerCount(sig) > 1) return;   // another handler decides; the 'exit' hook cleans when it ends the process
        cleanupAll();
        process.exit(128 + (os.constants.signals[sig] || 2));
      });
    } catch { /* this platform has no such signal */ }
  }
}

// owner.json is { pid, started, kind, argv } and nothing else: other tools read it. opts: { tmp: parent folder (default: the system temp folder), pgCtl: ['pg_ctl'] or [cmd, ...leading args] (tests) }
export function guardedTemp(prefix, kind = 'temp', opts = {}) {
  const dir = mkdtempSync(join(opts.tmp || os.tmpdir(), prefix));
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), kind, argv: process.argv }));   // the marker the machine-wide reaper reads: exactly these four fields, in this file
  const entry = { dir, kind, pgCtl: opts.pgCtl, done: false };
  entries.add(entry);
  installHooks();
  return { dir, release: (o) => runCleanup(entry, o) };
}

// guardedTemp, and TEMP/TMP/TMPDIR point at the folder until release(): Playwright makes its browser profile in os.tmpdir() at
// launch, so the profile (and the browser's command line) lands inside the guarded folder.
export function guardedTempEnv(prefix, kind = 'temp', opts = {}) {
  const g = guardedTemp(prefix, kind, opts);
  const names = ['TEMP', 'TMP', 'TMPDIR'];
  const saved = Object.fromEntries(names.map(n => [n, process.env[n]]));
  for (const n of names) process.env[n] = g.dir;
  let restored = false;
  return {
    dir: g.dir,
    release(o) {
      if (!restored) { restored = true; for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } }
      g.release(o);
    },
  };
}

// ---------- a time limit that kills the tree ----------
// Like spawnSync with a timeout, but async and the limit kills the whole tree. Resolves { status, signal, stdout, stderr, timedOut,
// error, pid }. opts: timeout (ms), maxBuffer, dir (a guarded folder: at the limit the processes naming it are killed too), plus
// any spawn option except stdio.
export function runLimited(cmd, args = [], opts = {}) {
  const { timeout = 60000, maxBuffer = 64 * 1024 * 1024, dir = null, ...spawnOpts } = opts;
  return new Promise(resolve => {
    let child;
    const out = [], err = [];
    let size = 0, timedOut = false, settled = false, error = null, timer = null, grace = null;
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(grace);
      if (child && child.pid) running.delete(child.pid);
      resolve({ status, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, error, pid: child && child.pid });
    };
    try { child = spawn(cmd, args, { windowsHide: true, detached: !WIN, ...spawnOpts, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { error = e; finish(null, null); return; }
    if (child.pid) running.add(child.pid);
    const stop = () => killTree(child.pid, dir);
    const take = (list) => (d) => { size += d.length; if (size > maxBuffer) { error = new Error('maxBuffer exceeded'); stop(); return; } list.push(d); };
    child.stdout.on('data', take(out));
    child.stderr.on('data', take(err));
    timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    child.on('error', e => { error = e; finish(null, null); });
    // 'close' waits for the pipes; a survivor holding a pipe must not hold the caller: five seconds after 'exit' we resolve anyway
    child.on('exit', (code, signal) => { grace = setTimeout(() => finish(code, signal), 5000); });
    child.on('close', (code, signal) => finish(code, signal));
  });
}

// ---------- the sweep ----------
function readOwner(dir) {
  try { const o = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')); return Number.isInteger(o.pid) ? o : null; } catch { return null; }
}

// Cleans every folder with one of our prefixes whose owner is gone. Prints one line per folder cleaned; returns them.
// opts: tmp (folder to scan), now (ms, tests), log (function), pgCtl (tests).
export function sweep(prefixes = PREFIXES, o = {}) {
  const tmp = o.tmp || os.tmpdir();
  const now = o.now ?? Date.now();
  const log = o.log || console.log;
  const cleaned = [];
  const names = listFolders(prefixes, tmp);
  if (!names.length) return cleaned;
  let procs = null;
  const snap = () => (procs ||= listProcs());
  for (const name of names) {
    const dir = join(tmp, name);
    if (existsSync(join(dir, '.keep'))) continue;
    let why = null;
    const owner = readOwner(dir);
    if (owner) {
      let alive = isAlive(owner.pid);
      if (alive) {
        // an alive pid may be a different program that took the number after the run died: the owner must still be running our script
        try {
          const p = snap().find(x => x.pid === owner.pid);
          const script = Array.isArray(owner.argv) && owner.argv[1] ? basename(String(owner.argv[1])) : '';
          if (!p) alive = false;
          else if (p.cmd && script && !norm(p.cmd).includes(script)) alive = false;
        } catch { /* cannot look: treat the owner as alive */ }
      }
      if (alive) continue;
      why = `owner process ${owner.pid} is gone`;
    } else if (PARENT_CHECKED.some(p => name.startsWith(p))) {
      let list;
      try { list = snap(); } catch { continue; }
      const needle = norm(dir).toLowerCase();
      const mine = list.filter(p => norm(p.cmd).toLowerCase().includes(needle));
      if (mine.length) {
        const ids = new Set(mine.map(p => p.pid)), all = new Set(list.map(p => p.pid));
        const roots = mine.filter(p => !ids.has(p.ppid));
        // Windows keeps the dead parent's number; Linux hands an orphan to process 1
        if (!roots.every(p => (!WIN && p.ppid <= 1) || (!all.has(p.ppid) && !isAlive(p.ppid)))) continue;
        why = 'its browser has no live parent process';
      } else {
        if (now - folderAge(dir) < NO_OWNER_MAX_AGE_MS) continue;
        why = 'no process uses it and it is over 6 hours old';
      }
    } else {
      if (now - folderAge(dir) < NO_OWNER_MAX_AGE_MS) continue;
      why = 'no owner.json and over 6 hours old';
    }
    let kind = 'temp';
    try { kind = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')).kind || 'temp'; } catch { /* no owner.json */ }
    let r;
    try { r = cleanFolder(dir, { kind: kind === 'cluster' ? 'temp' : kind, pgCtl: o.pgCtl, procs: procs || undefined }); } catch (e) { r = { stopped: false, killed: 0, removed: false, error: e && e.message }; }
    log(`proc-guard sweep: ${dir} (${why}): ${r.stopped ? 'cluster stopped, ' : ''}${r.killed} process(es) killed, folder ${r.removed ? 'removed' : 'NOT removed'}`);
    cleaned.push({ dir, why, ...r });
  }
  return cleaned;
}

// The age of a folder: the newer of its creation and its last change, so a folder in use is never old.
function folderAge(dir) {
  try { const s = statSync(dir); return Math.max(s.birthtimeMs, s.mtimeMs); } catch { return Date.now(); }
}
