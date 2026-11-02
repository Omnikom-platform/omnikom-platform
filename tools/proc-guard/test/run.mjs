// Tests for tools/proc-guard/index.mjs. Light: node child processes stand in for a browser or a postmaster (each carries the guarded
// folder path in its argv); the one real browser check is a headless Edge/Chrome with a time limit.
//   node tools/proc-guard/test/run.mjs
// Environment (for the mutants, test/mutate.mjs): PROC_GUARD_SUT = the module under test (default ../index.mjs),
//   PROC_GUARD_ONLY = comma list of groups to run (exit, signal, limit, holder, hardkill, owner, alive, reuse, foreign, prefix, pg, settle, browser).
// Every child works in a private root folder (TEMP/TMP/TMPDIR point at it) and every leaks() / sweep() call here looks only there,
// so another session's browsers or clusters are never seen and never touched.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUT = process.env.PROC_GUARD_SUT || join(HERE, '..', 'index.mjs');
const ONLY = process.env.PROC_GUARD_ONLY ? process.env.PROC_GUARD_ONLY.split(',') : null;
const G = await import(pathToFileURL(SUT).href);
const { settle } = await import(pathToFileURL(process.env.PROC_GUARD_SETTLE || join(HERE, 'settle.mjs')).href);   // PROC_GUARD_SETTLE: the mutants of settle.mjs
const WIN = process.platform === 'win32';

let passed = 0, failed = 0, skipped = 0;
const failLines = [];   // every FAIL line, repeated in the closing lines: a gate that shows only the last lines still shows all of them
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log(`ok   ${name}`); } else { failed++; const line = `FAIL ${name}${detail ? ': ' + String(detail).slice(0, 900) : ''}`; failLines.push(line); console.log(line); } };
const want = group => !ONLY || ONLY.includes(group);
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log(`test runner: process.pid ${process.pid}, process.ppid ${process.ppid}, platform ${process.platform}, argv ${process.argv.slice(1).join(' ')}`);
const root = mkdtempSync(join(os.tmpdir(), 'proc-guard-test-'));
const env = { ...process.env, TEMP: root, TMP: root, TMPDIR: root, PROC_GUARD_SUT: SUT, FAKE_PGCTL_LOG: join(root, 'pgctl.log') };
delete env.FAKE_PGCTL_FAIL;
const inRoot = () => G.leaks(G.PREFIXES, { tmp: root });
// leaks in the root until none is left or the time is up (a killed process leaves the table a moment later)
async function settled(ms = 4000) {
  return settle(inRoot, ms, 400, sleep);
}
// every leftover with pid, parent, name and command line (cut at 200 characters), so a failing run says which process it is
const show = left => left.map(l => `[pid ${l.pid} ppid ${l.ppid} name ${l.name} cmd ${l.cmd}]`).join(' ');

// Starts a child; returns { proc, out, wait(regex, ms), done }.
function child(mode, arg = '', extraEnv = {}, capMs = 90000) {
  const proc = spawn(process.execPath, [join(HERE, 'child.mjs'), mode, arg], { env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const c = { proc, out: '', err: '', capped: false, started: Date.now() };   // capped: the cap below ended the child, not the child itself
  proc.stdout.on('data', d => { c.out += d; });
  proc.stderr.on('data', d => { c.err += d; });
  c.done = new Promise(res => { let t = setTimeout(() => { c.capped = true; if (WIN) spawnSync('taskkill', ['/PID', String(proc.pid), '/F'], { stdio: 'ignore', timeout: 30000 }); else proc.kill('SIGKILL'); }, capMs); proc.on('close', (code, signal) => { clearTimeout(t); res({ code, signal }); }); });
  c.wait = async (re, ms = 30000) => { for (let t = 0; t < ms; t += 100) { if (re.test(c.out)) return true; await sleep(100); } return false; };
  c.get = key => (c.out.match(new RegExp(`^${key} (.*)$`, 'm')) || [])[1];
  return c;
}
const hardKill = pid => { if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', timeout: 30000 }); else { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } };
// stop a stand-in WITH its child: Windows taskkill /T; elsewhere its group (the stand-in must have been started detached)
const killTreeTest = pid => { if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 30000 }); else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } } };
const logLines = [];
const sweepRoot = (extra = {}) => G.sweep(G.PREFIXES, { tmp: root, log: l => logLines.push(l), ...extra });

try {
  // ---------- every way a run can end leaves nothing ----------
  if (want('exit')) {
    for (const [mode, label, codeOk] of [['normal', 'a run that ends normally (no release call)', c => c === 0], ['release', 'a run that calls release() (twice)', c => c === 0],
      ['throw', 'a run that throws', c => c !== 0], ['reject', 'a run with an unhandled rejection', c => c !== 0]]) {
      const c = child(mode);
      const { code } = await c.done;
      const dir = c.get('DIR'), pid = Number(c.get('STANDIN'));
      const left = await settled();
      check(`${label}: its stand-in and the stand-in's child are gone (leaks() empty)`, c.get('STANDIN') && left.length === 0, `left: ${show(left)} | out: ${c.out} | err: ${c.err.slice(0, 200)}`);
      check(`${label}: the folder is gone`, dir && !existsSync(dir), `still there: ${dir}`);
      check(`${label}: the exit code is the run's own (${code})`, codeOk(code), `code ${code}`);
      check(`${label}: the stand-in process is not alive`, pid > 0 && !G.isAlive(pid), `pid ${pid} alive`);
    }
  }

  // ---------- a signal ends the run and cleans ----------
  if (want('signal')) {
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
      const c = child('signal', sig);
      const { code: got } = await c.done;
      const left = await settled();
      check(`${sig}: the run ends with ${code} (128 + the signal) and does not carry on`, got === code && !/SURVIVED/.test(c.out), `exit ${got} | ${c.out}`);
      check(`${sig}: leaks() empty and the folder gone`, left.length === 0 && c.get('DIR') && !existsSync(c.get('DIR')), `left: ${show(left)} | ${c.get('DIR')}`);
    }
  }

  // ---------- a time limit kills the whole tree ----------
  if (want('limit')) {
    const c = child('limit');
    await c.done;
    check('time limit: runLimited reports timedOut', c.get('TIMED-OUT') === 'true', c.out);
    check('time limit: right after the limit, before any cleanup of the folder, nothing of the tree is left (the stand-in AND its child)', c.get('LEAKS-AFTER-LIMIT') === '0', `leaks after the limit: ${c.get('LEAKS-AFTER-LIMIT')} | ${c.out}`);
    const left = await settled();
    check('time limit: the folder is gone at the end', left.length === 0 && c.get('DIR') && !existsSync(c.get('DIR')), `left: ${show(left)}`);
  }

  // ---------- a time limit also kills what left the tree and still holds the folder ----------
  if (want('holder')) {
    const c = child('holder');
    await c.done;
    check('holder kill: the limit hit', c.get('TIMED-OUT') === 'true', c.out + c.err.slice(0, 300));
    check('holder kill: a process that left the tree (own session, parent dead) and holds the folder is killed with the stand-in', c.get('LEAKS-AFTER-LIMIT') === '0', `leaks after the limit: ${c.get('LEAKS-AFTER-LIMIT')} | ${c.out}`);
    const left = await settled();
    check('holder kill: the folder is gone at the end and nothing is left', left.length === 0 && c.get('DIR') && !existsSync(c.get('DIR')), `left: ${show(left)}`);
  }

  // ---------- a run killed hard: the stand-in stays, the sweep cleans it ----------
  if (want('hardkill')) {
    const c = child('hardwait');
    check('hard kill: the child is up with its stand-in', await c.wait(/READY/), c.out + c.err);
    const dir = c.get('DIR'), standin = Number(c.get('STANDIN'));
    let marker = null;
    try { marker = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')); } catch { /* checked below */ }
    check('owner.json is the marker other tools read: exactly { pid, started, kind, argv } in the guarded folder', marker && Object.keys(marker).sort().join() === 'argv,kind,pid,started' && marker.pid === c.proc.pid && marker.kind === 'browser' && Array.isArray(marker.argv) && !Number.isNaN(Date.parse(marker.started)), JSON.stringify(marker));
    hardKill(c.proc.pid);                        // the run itself, not its tree
    await c.done;
    await sleep(500);
    const left = inRoot();
    check('hard kill: the stand-in stays after its run is killed (nothing could clean up)', G.isAlive(standin) && existsSync(dir), `alive ${G.isAlive(standin)}, folder ${existsSync(dir)}`);
    check('hard kill: leaks() lists the stand-in and its child, by name and folder', left.length >= 2 && left.every(l => String(l.folder).toLowerCase().endsWith(dir.slice(dir.lastIndexOf(WIN ? '\\' : '/') + 1).toLowerCase())), `leaks(): ${JSON.stringify(left)}`);
    logLines.length = 0;
    const done = sweepRoot();
    check('hard kill: sweep() cleans that folder and prints one line for it', done.length === 1 && logLines.length === 1 && logLines[0].includes(dir), `${JSON.stringify(done)} | ${logLines.join(' / ')}`);
    const after = await settled();
    check('hard kill: after the sweep leaks() is empty, the stand-in is dead and the folder is gone', after.length === 0 && !G.isAlive(standin) && !existsSync(dir), `left: ${show(after)} | folder ${existsSync(dir)}`);
  }

  // ---------- the sweep leaves alone what is not dead ----------
  if (want('alive')) {
    const c = child('hardwait');
    await c.wait(/READY/);
    const dir = c.get('DIR'), standin = Number(c.get('STANDIN'));
    logLines.length = 0;
    const done = sweepRoot();
    check('alive owner: sweep() leaves a folder whose owner is alive (folder, stand-in, no line printed)', done.length === 0 && logLines.length === 0 && existsSync(dir) && G.isAlive(standin), `${JSON.stringify(done)} | folder ${existsSync(dir)} | ${logLines.join(' / ')}`);
    hardKill(c.proc.pid); await c.done; await sleep(300);
    sweepRoot();                                   // cleans up the test's own stand-in
    await settled();

    // a folder with no owner.json: left alone while young, cleaned when over 6 hours old; names that are not ours are never touched
    const mk = (name, withOwner) => { const d = join(root, name); mkdirSync(d); if (withOwner) writeFileSync(join(d, 'owner.json'), withOwner); return d; };
    const young = mk('omnikom-pg-aB3dE9', null);
    const wrong = mk('wf-notours-xx', null);
    const odd = mk('mmd-probe-AbCdEf', null);
    // Windows gives a new folder a creation time up to ~1.5 ms ahead of Date.now() and utimes cannot move it, so the sweep's clock is set
    // a few seconds ahead (still far under 6 hours): the folder's age can then never be negative, which a mutant with a 0 limit relies on
    sweepRoot({ now: Date.now() + 5000 });
    check('no owner.json, young folder: left alone', existsSync(young), '');
    logLines.length = 0;
    sweepRoot({ now: Date.now() + 7 * 3600 * 1000 });
    check('no owner.json, over 6 hours old: cleaned', !existsSync(young), 'still there');
    check('a folder whose name is not <prefix> + 6 characters (wf-notours-xx) is never touched, however old', existsSync(wrong), 'it was removed');
    check('"mmd-probe-" folders are ours too (prefix + 6 characters): cleaned at over 6 hours', !existsSync(odd), 'still there');
  }

  // ---------- an alive number that is another program is not an owner ----------
  if (want('reuse')) {
    const mine = join(root, 'omnikom-pg-Re5eAa');
    mkdirSync(mine);
    writeFileSync(join(mine, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), kind: 'temp', argv: [process.execPath, join(HERE, 'run.mjs')] }));
    const reused = join(root, 'omnikom-pg-Re5eBb');
    mkdirSync(reused);
    writeFileSync(join(reused, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), kind: 'temp', argv: [process.execPath, join(HERE, 'some-other-script.mjs')] }));
    sweepRoot();
    check('pid reuse: an alive pid that runs another script is not the owner (the folder is cleaned)', !existsSync(reused), 'kept as if its owner lived');
    check('pid reuse: an alive pid that runs the owner script still owns its folder', existsSync(mine), 'cleaned');
    rmSync(mine, { recursive: true, force: true });
  }

  // ---------- who owns a Playwright browser: decided on a fake process list, so it runs the same on every system ----------
  if (want('owner')) {
    const ME = process.pid, FAKE = 2000000011;   // no real process has that pid
    const nodeWin = pid => ({ pid, ppid: 4000, name: 'node.exe', cmd: '"C:\\Program Files\\nodejs\\node.exe" "E:/x/run.mjs"' });
    const nodeLinux = pid => ({ pid, ppid: 4000, name: 'MainThread', cmd: '/opt/hostedtoolcache/node/24.22.1/x64/bin/node /work/run.mjs' });
    const python = pid => ({ pid, ppid: 4000, name: 'python3', cmd: 'python3 /work/pw.py' });
    const init = { pid: 1, ppid: 0, name: 'init', cmd: '/sbin/init' };
    const holder = (ppid, dir) => ({ pid: FAKE, ppid, name: 'MainThread', cmd: `/usr/bin/node /work/standin.mjs ${dir.split('\\').join('/')} leaf` });
    const alive = () => true;
    check('owner: a holder whose parent is pid 1 has no live owner (pid 1 is in the list and alive)', G.ownerAlive(holder(1, '/t/x'), [init, holder(1, '/t/x')], alive) === false, '');
    const nodeInit = { pid: 1, ppid: 0, name: 'MainThread', cmd: '/usr/local/bin/node /app/server.js' };   // a container whose first process is node
    check('owner: a holder whose parent is pid 1 has no live owner even when pid 1 is a node process (a container)', G.ownerAlive(holder(1, '/t/x'), [nodeInit, holder(1, '/t/x')], alive) === false, '');
    check('owner: a holder whose parent is a live node process (Windows name) has a live owner', G.ownerAlive(holder(ME, '/t/x'), [nodeWin(ME)], alive) === true, '');
    check('owner: a holder whose parent is a live node process (Linux: name MainThread, command line node) has a live owner', G.ownerAlive(holder(ME, '/t/x'), [nodeLinux(ME)], alive) === true, '');
    check('owner: a holder whose parent is a live process that is not node has no live owner', G.ownerAlive(holder(ME, '/t/x'), [python(ME)], alive) === false, '');
    check('owner: a holder whose parent is not in the list has no live owner', G.ownerAlive(holder(ME, '/t/x'), [], alive) === false, '');
    const sweepCase = (name, ppid, extra) => {
      const d = join(root, name);
      mkdirSync(d);
      logLines.length = 0;
      sweepRoot({ procs: [holder(ppid, d), ...extra] });
      const gone = !existsSync(d);
      rmSync(d, { recursive: true, force: true });
      return gone;
    };
    check('owner: sweep() removes a Playwright profile whose holder was handed to pid 1 (the Linux orphan)', sweepCase('playwright_chromiumdev_profile-P1dOne', 1, [init]) === true, logLines.join(' / '));
    check('owner: sweep() spares a Playwright profile whose holder has a live node parent', sweepCase('playwright_chromiumdev_profile-P2aLiv', ME, [nodeLinux(ME)]) === false, logLines.join(' / '));
    check('owner: sweep() removes a Playwright profile whose holder has a live parent that is not node', sweepCase('playwright_chromiumdev_profile-P3oThr', ME, [python(ME)]) === true, logLines.join(' / '));
  }

  // ---------- a browser Playwright started: ours only when its parent is dead ----------
  if (want('foreign')) {
    const mkProfile = (name) => { const d = join(root, name); mkdirSync(d); return d; };
    const orphanDir = mkProfile('playwright_chromiumdev_profile-Or9han');
    // a parent that starts the stand-in and ends at once: the stand-in's parent is dead
    const parentJs = join(root, 'parent.mjs');
    writeFileSync(parentJs, `import { spawn } from 'node:child_process';\nconst p = spawn(process.execPath, [${JSON.stringify(join(HERE, 'standin.mjs'))}, ${JSON.stringify(orphanDir)}], { detached: true, stdio: 'ignore', windowsHide: true });\np.unref();\n`);
    spawnSync(process.execPath, [parentJs], { timeout: 30000, env });
    await sleep(800);
    check('foreign profile: its stand-in runs and leaks() sees it', inRoot().length >= 1, show(inRoot()));
    const liveDir = mkProfile('playwright_chromiumdev_profile-L1veAA');
    let live = null;
    try {
    live = spawn(process.execPath, [join(HERE, 'standin.mjs'), liveDir], { stdio: 'ignore', windowsHide: true, env, detached: !WIN });   // POSIX: its own group, so a group kill reaches its child too
    await sleep(800);
    logLines.length = 0;
    sweepRoot();
    check('foreign profile: a browser whose parent is dead is swept (folder gone)', !existsSync(orphanDir), logLines.join(' / '));
    check('foreign profile: a browser whose parent is alive (this test) is left alone (folder and process)', existsSync(liveDir) && G.isAlive(live.pid), `folder ${existsSync(liveDir)} alive ${G.isAlive(live.pid)}`);
    } finally {
      // whatever the checks decided: stop the stand-ins (the live one WITH its child) and anything still holding the two folders, so that a
      // failed check cannot leave a process behind for every later group to find (Linux run 41269080649: one leaf of this group did)
      if (live) killTreeTest(live.pid);
      for (const d of [liveDir, orphanDir]) { try { G.killFolderProcs(d); } catch { /* none left */ } }
    }
    await settled();
  }

  // ---------- the CLI journey's temp folder (omnikom-jb-, tools/omnikom-cli/lib/browser.mjs) is known ----------
  if (want('prefix')) {
    const dir = join(root, 'omnikom-jb-Jb7xQz');
    mkdirSync(dir);
    // a run that is gone: its owner.json names a pid no process has, while a stand-in (and its child) still carries the folder path
    writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: 2000000011, started: new Date().toISOString(), kind: 'browser', argv: [process.execPath, join(HERE, 'some-journey.mjs')] }));
    const standin = spawn(process.execPath, [join(HERE, 'standin.mjs'), dir], { stdio: 'ignore', windowsHide: true, env, detached: !WIN });
    // the stand-in is THIS test's child: on POSIX a killed child stays a zombie (kill(pid, 0) still succeeds) until node reaps it on its
    // 'exit' event, which needs a turn of the event loop that the synchronous sweep never gives. The other groups' stand-ins are
    // grandchildren, handed to pid 1 and reaped there. So wait for the exit event, and say the process state if it never comes.
    const exited = new Promise(res => { standin.once('exit', res); });
    await sleep(800);
    const found = inRoot().filter(l => String(l.folder).toLowerCase().endsWith('omnikom-jb-jb7xqz'));
    check('omnikom-jb- (the journey): leaks() lists the process that carries the folder', found.length >= 1, `leaks(): ${JSON.stringify(inRoot())}`);
    logLines.length = 0;
    const done = sweepRoot();
    check('omnikom-jb- (the journey): sweep() cleans the folder of a gone owner and prints one line for it', done.length === 1 && logLines.length === 1 && logLines[0].includes(dir), `${JSON.stringify(done)} | ${logLines.join(' / ')}`);
    const stateOf = pid => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '')[0]; } catch { return 'none'; } };   // POSIX: Z = zombie
    const aliveAtSweep = G.isAlive(standin.pid), stateAtSweep = stateOf(standin.pid);   // right after the synchronous kill, before any event-loop turn
    const reaped = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
    const after = await settled();
    const stateNow = stateOf(standin.pid);
    const zombie = stateAtSweep === 'Z' || stateNow === 'Z' ? ` ZOMBIE: killed but not reaped by this test (state Z${stateNow === 'Z' ? ' still after 5 s: no exit event' : ' at the sweep, reaped later'})` : '';
    check('omnikom-jb- (the journey): after the sweep the folder is gone, the stand-in is dead and leaks() is empty', !existsSync(dir) && reaped && !G.isAlive(standin.pid) && after.length === 0, `folder ${existsSync(dir)} exit event ${reaped} | at the sweep: alive ${aliveAtSweep} state ${stateAtSweep} | now: alive ${G.isAlive(standin.pid)} state ${stateNow} | ${show(after)}${zombie}`);
    killTreeTest(standin.pid);
    try { G.killFolderProcs(dir); } catch { /* none left */ }
    rmSync(dir, { recursive: true, force: true });
  }

  // ---------- the CLI mutant runner's copies (omnikom-cli-mut-, tools/omnikom-cli/test/mutate.mjs) are known ----------
  if (want('prefix')) {
    // the real shape of these copies: a folder with the CLI inside, no owner.json, no process. Under the test's own root, never the real temp.
    const mkCopy = name => { const d = join(root, name); mkdirSync(d); writeFileSync(join(d, 'cli.mjs'), '// a copy of the CLI\n'); return d; };
    const copy = mkCopy('omnikom-cli-mut-Qa7Zk2');
    const kept = mkCopy('omnikom-cli-mut-Kp5Ws1');
    writeFileSync(join(kept, '.keep'), 'kept on request\n');
    // the sweep's clock is set, as in the group "alive" (utimes cannot move a Windows creation time): 5 minutes in, a live mutate run
    // is far under the 6 hours limit (the clock is ahead of Date.now(), so the age can never be negative); then 7 hours on, the same copy is old
    logLines.length = 0;
    const early = sweepRoot({ now: Date.now() + 5 * 60 * 1000 });
    check('omnikom-cli-mut- (the CLI mutant copies): a copy under 6 hours old is kept and nothing is printed (a live mutate run keeps its tree)', early.length === 0 && logLines.length === 0 && existsSync(copy), `${JSON.stringify(early)} | copy ${existsSync(copy)} | ${logLines.join(' / ')}`);
    logLines.length = 0;
    // the clock 7 hours on also reaches a folder an earlier group left in the root (a Playwright profile): look only at ours
    const ours = list => list.filter(x => String(typeof x === 'string' ? x : x.dir).includes('omnikom-cli-mut-'));
    const late = ours(sweepRoot({ now: Date.now() + 7 * 3600 * 1000 })), lateLines = ours(logLines);
    check('omnikom-cli-mut- (the CLI mutant copies): sweep() lists and removes a copy over 6 hours old, with one line naming it', late.length === 1 && late[0].dir === copy && lateLines.length === 1 && lateLines[0].includes(copy) && !existsSync(copy), `${JSON.stringify(late)} | copy ${existsSync(copy)} | ${lateLines.join(' / ')}`);
    check('omnikom-cli-mut- (the CLI mutant copies): a .keep copy is kept, even over 6 hours old', existsSync(kept), 'it was removed');
    // the coming shape: the CLI makes its copies with guardedTemp('omnikom-cli-mut-', 'cli-mutant'): the plain prefix, the pid only in owner.json
    const gDead = G.guardedTemp('omnikom-cli-mut-', 'cli-mutant', { tmp: root });
    const gLive = G.guardedTemp('omnikom-cli-mut-', 'cli-mutant', { tmp: root });
    const ownerOf = g => JSON.parse(readFileSync(join(g.dir, 'owner.json'), 'utf8'));
    const shapeOk = ownerOf(gLive).pid === process.pid && ownerOf(gLive).kind === 'cli-mutant' && /^omnikom-cli-mut-[A-Za-z0-9]{6}$/.test(basename(gLive.dir));
    // the dead owner's run is gone: its owner.json names a pid no process has (the sweep reads the file; guardedTemp wrote this one for a live pid)
    writeFileSync(join(gDead.dir, 'owner.json'), JSON.stringify({ ...ownerOf(gDead), pid: 2000000011 }));
    const procs = [{ pid: process.pid, ppid: process.ppid, name: 'node', cmd: process.argv.join(' ') }];   // this test process is alive and runs this script
    logLines.length = 0;
    const owned = ours(sweepRoot({ now: Date.now() + 7 * 3600 * 1000, procs })), ownedLines = ours(logLines);
    check('omnikom-cli-mut- (the CLI mutant copies): a guardedTemp copy has the plain name and this process in owner.json', shapeOk, `${gLive.dir} | ${JSON.stringify(ownerOf(gLive))}`);
    check('omnikom-cli-mut- (the CLI mutant copies): a guardedTemp copy of a dead owner is removed, with one line naming it', owned.length === 1 && owned[0].dir === gDead.dir && ownedLines.length === 1 && ownedLines[0].includes(gDead.dir) && !existsSync(gDead.dir), `${JSON.stringify(owned)} | dead ${existsSync(gDead.dir)} | ${ownedLines.join(' / ')}`);
    check('omnikom-cli-mut- (the CLI mutant copies): a guardedTemp copy of an alive owner is kept, however old', existsSync(gLive.dir), 'it was removed');
    gLive.release();
    for (const d of [copy, kept]) rmSync(d, { recursive: true, force: true });
  }

  // ---------- a cluster is stopped with pg_ctl ----------
  if (want('pg')) {
    writeFileSync(env.FAKE_PGCTL_LOG, '');
    const c = child('pg');
    await c.done;
    const calls = readFileSync(env.FAKE_PGCTL_LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const left = await settled();
    check('cluster: release() stops it with pg_ctl -D <data> -m immediate stop (one call)', calls.length === 1 && calls[0].includes('-m') && calls[0][calls[0].indexOf('-m') + 1] === 'immediate' && calls[0].includes('stop') && calls[0].includes(join(c.get('DIR'), 'data')), JSON.stringify(calls));
    check('cluster: its postmaster stand-in and child are gone and the folder is removed', left.length === 0 && !existsSync(c.get('DIR')), `left: ${show(left)}`);
    // the data folder is called pgdata (restore-drill.mjs): it is found too
    writeFileSync(env.FAKE_PGCTL_LOG, '');
    const pd = child('pg', 'pgdata');
    await pd.done;
    const callsPd = readFileSync(env.FAKE_PGCTL_LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const leftPd = await settled();
    check('cluster: a data folder called pgdata is found and stopped with pg_ctl too', callsPd.length === 1 && callsPd[0].includes(join(pd.get('DIR'), 'pgdata')) && leftPd.length === 0 && !existsSync(pd.get('DIR')), `${JSON.stringify(callsPd)} | left: ${show(leftPd)}`);
    // pg_ctl fails (the server is already dead, or pg_ctl is missing): the processes naming the folder are killed instead
    writeFileSync(env.FAKE_PGCTL_LOG, '');
    const f = child('pg', '', { FAKE_PGCTL_FAIL: '1' });
    await f.done;
    const left2 = await settled();
    const calls2 = readFileSync(env.FAKE_PGCTL_LOG, 'utf8').split('\n').filter(Boolean);
    check('cluster: when pg_ctl fails the folder\'s processes are killed by command line and the folder is removed', calls2.length >= 1 && left2.length === 0 && !existsSync(f.get('DIR')), `calls ${calls2.length} | left: ${show(left2)} | folder ${existsSync(f.get('DIR'))}`);
  }

  // ---------- the one real browser ----------
  // ---------- the wait for a killed process to leave the process table is bounded by time, not by the number of looks (settle.mjs) ----------
  if (want('settle')) {
    const spin = ms => { const end = Date.now() + ms; while (Date.now() < end); };   // a slow listing
    let t = Date.now();
    const stuck = await settle(() => { spin(200); return [1]; }, 1000, 50, sleep);
    const took = Date.now() - t;
    check('settle: a listing that stays full and takes 200 ms per look ends after about the time given (1 s), not after the number of looks', stuck.length === 1 && took >= 1000 && took < 2500, `took ${took} ms, ${stuck.length} left`);
    let calls = 0;
    const cleared = await settle(() => { spin(300); calls++; return calls >= 3 ? [] : [1]; }, 100, 10, sleep);
    check('settle: when one listing takes longer than the time given, it still looks twice more before it gives up', cleared.length === 0 && calls === 3, `calls ${calls}, ${cleared.length} left`);
    t = Date.now(); calls = 0;
    const empty = await settle(() => { calls++; return []; }, 1000, 50, sleep);
    check('settle: an empty first listing returns at once (one look, no pause)', empty.length === 0 && calls === 1 && Date.now() - t < 100, `calls ${calls}, took ${Date.now() - t} ms`);
  }

  if (want('browser')) {
    const found = (WIN ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']).find(existsSync);
    if (!found) { skipped++; console.log('SKIP browser: no Edge or Chrome found on this machine'); }
    else {
      const c = child('browser', '', { PROC_GUARD_BROWSER: found }, Number(process.env.PROC_GUARD_BROWSER_CAP_MS) || 240000);   // a good run takes 8-20 s here, a slow one reached the old 45 s cap (n4: 46407 ms) and under load 88 s (fix b1: 87989 ms)
      const ended = await c.done;
      const how = `child ended after ${Date.now() - c.started} ms, exit ${ended.code}/${ended.signal}, ended by the cap: ${c.capped}`;   // the cap kills the child itself: no HOLD-LEAKS line, no folder cleanup
      console.log(`info real browser: ${how} | leaks() ms per call in the child: ${[...c.out.matchAll(/^LEAKS-MS (\d+)$/gm)].map(m => m[1]).join(' ')} | steps (ms): ${[...c.out.matchAll(/^AT-MS (\S+) (\d+)$/gm)].map(m => `${m[1]} ${m[2]}`).join(', ')}`);   // every run, red or green
      check('real browser: a --dump-dom with a 1 ms limit is cut by the limit and nothing of it is left', c.get('DUMP-TIMED-OUT') === 'true' && c.get('DUMP-LEAKS') === '0', `${c.out + c.err.slice(0, 300)} | ${how}`);
      check('real browser: a browser that stays up is cut by a 5 s limit and none of its renderer, GPU or utility processes is left', c.get('HOLD-TIMED-OUT') === 'true' && c.get('HOLD-LEAKS') === '0', `${c.out + c.err.slice(0, 300)} | ${how}`);
      const left = await settled(6000);
      check('real browser: at the end leaks() is empty and the profile folder is gone', left.length === 0 && c.get('DIR') && !existsSync(c.get('DIR')), `left: ${show(left)} | folder ${c.get('DIR') && existsSync(c.get('DIR'))} | ${how}`);
    }
  }
} catch (e) {
  failed++;
  const line = `FAIL the test run crashed: ${String(e && e.stack).split('\n').slice(0, 3).join(' | ')}`;
  failLines.push(line);
  console.log(line);
} finally {
  try { G.killFolderProcs(root); } catch { /* nothing to kill */ }
  try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* not removable */ }
}
if (failLines.length) { console.log(`\n${failLines.length} FAILED CHECK(S), repeated:`); for (const l of failLines) console.log(l.replace(/\s+/g, ' ').slice(0, 900)); }
console.log(`proc-guard tests: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
