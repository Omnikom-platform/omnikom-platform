// Tests for tools/proc-guard/index.mjs. Light: node child processes stand in for a browser or a postmaster (each carries the guarded
// folder path in its argv); the one real browser check is a headless Edge/Chrome with a time limit.
//   node tools/proc-guard/test/run.mjs
// Environment (for the mutants, test/mutate.mjs): PROC_GUARD_SUT = the module under test (default ../index.mjs),
//   PROC_GUARD_ONLY = comma list of groups to run (exit, signal, limit, hardkill, alive, reuse, foreign, pg, browser).
// Every child works in a private root folder (TEMP/TMP/TMPDIR point at it) and every leaks() / sweep() call here looks only there,
// so another session's browsers or clusters are never seen and never touched.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUT = process.env.PROC_GUARD_SUT || join(HERE, '..', 'index.mjs');
const ONLY = process.env.PROC_GUARD_ONLY ? process.env.PROC_GUARD_ONLY.split(',') : null;
const G = await import(pathToFileURL(SUT).href);
const WIN = process.platform === 'win32';

let passed = 0, failed = 0, skipped = 0;
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log(`ok   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 400) : ''}`); } };
const want = group => !ONLY || ONLY.includes(group);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const root = mkdtempSync(join(os.tmpdir(), 'proc-guard-test-'));
const env = { ...process.env, TEMP: root, TMP: root, TMPDIR: root, PROC_GUARD_SUT: SUT, FAKE_PGCTL_LOG: join(root, 'pgctl.log') };
delete env.FAKE_PGCTL_FAIL;
const inRoot = () => G.leaks(G.PREFIXES, { tmp: root });
// leaks in the root until none is left or the time is up (a killed process leaves the table a moment later)
async function settled(ms = 4000) {
  let left = inRoot();
  for (let t = 0; left.length && t < ms; t += 400) { await sleep(400); left = inRoot(); }
  return left;
}
const show = left => left.map(l => `${l.name}#${l.pid}`).join(',');

// Starts a child; returns { proc, out, wait(regex, ms), done }.
function child(mode, arg = '', extraEnv = {}, capMs = 90000) {
  const proc = spawn(process.execPath, [join(HERE, 'child.mjs'), mode, arg], { env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const c = { proc, out: '', err: '' };
  proc.stdout.on('data', d => { c.out += d; });
  proc.stderr.on('data', d => { c.err += d; });
  c.done = new Promise(res => { let t = setTimeout(() => { if (WIN) spawnSync('taskkill', ['/PID', String(proc.pid), '/F'], { stdio: 'ignore', timeout: 30000 }); else proc.kill('SIGKILL'); }, capMs); proc.on('close', (code, signal) => { clearTimeout(t); res({ code, signal }); }); });
  c.wait = async (re, ms = 30000) => { for (let t = 0; t < ms; t += 100) { if (re.test(c.out)) return true; await sleep(100); } return false; };
  c.get = key => (c.out.match(new RegExp(`^${key} (.*)$`, 'm')) || [])[1];
  return c;
}
const hardKill = pid => { if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', timeout: 30000 }); else { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } };
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

  // ---------- a run killed hard: the stand-in stays, the sweep cleans it ----------
  if (want('hardkill')) {
    const c = child('hardwait');
    check('hard kill: the child is up with its stand-in', await c.wait(/READY/), c.out + c.err);
    const dir = c.get('DIR'), standin = Number(c.get('STANDIN'));
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
    sweepRoot();
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
    const live = spawn(process.execPath, [join(HERE, 'standin.mjs'), liveDir], { stdio: 'ignore', windowsHide: true, env });
    await sleep(800);
    logLines.length = 0;
    sweepRoot();
    check('foreign profile: a browser whose parent is dead is swept (folder gone)', !existsSync(orphanDir), logLines.join(' / '));
    check('foreign profile: a browser whose parent is alive (this test) is left alone (folder and process)', existsSync(liveDir) && G.isAlive(live.pid), `folder ${existsSync(liveDir)} alive ${G.isAlive(live.pid)}`);
    if (WIN) spawnSync('taskkill', ['/PID', String(live.pid), '/T', '/F'], { stdio: 'ignore', timeout: 30000 }); else live.kill('SIGKILL');
    await settled();
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
  if (want('browser')) {
    const found = (WIN ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']).find(existsSync);
    if (!found) { skipped++; console.log('SKIP browser: no Edge or Chrome found on this machine'); }
    else {
      const c = child('browser', '', { PROC_GUARD_BROWSER: found }, 45000);
      await c.done;
      check('real browser: a --dump-dom with a 1 ms limit is cut by the limit and nothing of it is left', c.get('DUMP-TIMED-OUT') === 'true' && c.get('DUMP-LEAKS') === '0', c.out + c.err.slice(0, 300));
      check('real browser: a browser that stays up is cut by a 5 s limit and none of its renderer, GPU or utility processes is left', c.get('HOLD-TIMED-OUT') === 'true' && c.get('HOLD-LEAKS') === '0', c.out + c.err.slice(0, 300));
      const left = await settled(6000);
      check('real browser: at the end leaks() is empty and the profile folder is gone', left.length === 0 && c.get('DIR') && !existsSync(c.get('DIR')), `left: ${show(left)}`);
    }
  }
} catch (e) {
  failed++;
  console.log(`FAIL the test run crashed: ${e && e.stack}`);
} finally {
  try { G.killFolderProcs(root); } catch { /* nothing to kill */ }
  try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* not removable */ }
}
console.log(`proc-guard tests: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
