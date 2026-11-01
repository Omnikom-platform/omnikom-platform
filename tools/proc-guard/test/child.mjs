// The process the proc-guard tests run (never run by hand). It uses the guard the way a wired script does, then ends in one of the
// ways a run can end. It prints lines "KEY value" with writeSync (a pipe write can be lost when the process ends at once).
//   node child.mjs <mode> [arg]
// modes: normal (ends with no release call), release, throw, reject, signal <SIGINT|SIGTERM|SIGHUP>, limit, hardwait, pg, browser
// Environment: PROC_GUARD_SUT (the module under test), TEMP/TMP/TMPDIR (a folder of the test's own), FAKE_PGCTL_LOG, PROC_GUARD_BROWSER.
import { spawn } from 'node:child_process';
import { writeSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const G = await import(pathToFileURL(process.env.PROC_GUARD_SUT).href);
const say = (k, v = '') => writeSync(1, `${k} ${v}\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const [mode, arg] = process.argv.slice(2);

async function startStandin(dir) {
  const p = spawn(process.execPath, [join(HERE, 'standin.mjs'), dir], { detached: true, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  await new Promise((res, rej) => {
    let b = '';
    p.stdout.on('data', d => { b += d; if (/UP/.test(b)) res(); });
    p.on('error', rej);
    setTimeout(() => rej(new Error('the stand-in did not start')), 15000);
  });
  p.stdout.destroy();
  p.unref();
  return p.pid;
}
// leaks() until it is empty or the time is up (a killed process leaves the table a moment later); returns what is left
async function settledLeaks(ms = 3000) {
  let left = G.leaks(G.PREFIXES);
  for (let t = 0; left.length && t < ms; t += 300) { await sleep(300); left = G.leaks(G.PREFIXES); }
  return left;
}

if (mode === 'pg') {
  const g = G.guardedTemp('omnikom-pg-', 'cluster', { pgCtl: [process.execPath, join(HERE, 'fake-pg-ctl.mjs')] });
  const pid = await startStandin(g.dir);
  const dataName = arg || 'data';   // scripts call the data folder data or pgdata
  mkdirSync(join(g.dir, dataName));
  writeFileSync(join(g.dir, dataName, 'postmaster.pid'), `${pid}\n`);
  say('DIR', g.dir); say('STANDIN', pid);
  g.release();
  g.release();   // a second call must change nothing
  say('DONE');
} else if (mode === 'browser') {
  const g = G.guardedTemp('mmd-', 'browser');
  const common = ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${join(g.dir, 'profile')}`];
  say('DIR', g.dir);
  // the check of the brief: --dump-dom of a one-line page with a 1 ms limit
  const a = await G.runLimited(process.env.PROC_GUARD_BROWSER, [...common, '--dump-dom', 'data:text/html,<p>ok</p>'], { timeout: 1, dir: g.dir });
  say('DUMP-TIMED-OUT', a.timedOut);
  say('DUMP-LEAKS', (await settledLeaks()).length);
  // a browser that stays up (no --dump-dom: headless waits for ever): by the limit its renderer, GPU and utility children exist,
  // and a kill of the main process alone would leave them holding the profile
  const b = await G.runLimited(process.env.PROC_GUARD_BROWSER, [...common, 'about:blank'], { timeout: 5000, dir: g.dir });
  say('HOLD-TIMED-OUT', b.timedOut);
  say('HOLD-LEAKS', (await settledLeaks()).length);
} else {
  const g = G.guardedTemp('omnikom-pg-', 'browser');
  say('DIR', g.dir);
  if (mode === 'holder') {
    // the stand-in has a leaf that left the tree (own session, no living parent): only the holder kill can reach it
    const r = await G.runLimited(process.execPath, [join(HERE, 'standin.mjs'), g.dir, 'orphan'], { timeout: 1500, dir: g.dir });
    say('TIMED-OUT', r.timedOut);
    say('LEAKS-AFTER-LIMIT', (await settledLeaks()).length);
  } else if (mode === 'limit') {
    // no `dir` option: only the tree kill may end the stand-in and its child
    const r = await G.runLimited(process.execPath, [join(HERE, 'standin.mjs'), g.dir], { timeout: 1500 });
    say('TIMED-OUT', r.timedOut);
    say('LEAKS-AFTER-LIMIT', (await settledLeaks()).length);
  } else {
    const pid = await startStandin(g.dir);
    say('STANDIN', pid);
    if (mode === 'release') { g.release(); g.release(); }
    else if (mode === 'throw') throw new Error('boom: an uncaught exception');
    else if (mode === 'reject') { Promise.reject(new Error('boom: an unhandled rejection')); await sleep(5000); }
    else if (mode === 'signal') {
      say('READY');
      await sleep(100);
      // Windows cannot deliver a signal to a node process (kill terminates it): emit it, which runs the same handlers a Ctrl+C runs
      if (process.platform === 'win32') process.emit(arg); else process.kill(process.pid, arg);
      await sleep(2000);
      say('SURVIVED-THE-SIGNAL');
    } else if (mode === 'hardwait') {
      say('READY');
      setTimeout(() => process.exit(0), 60000);
      await new Promise(() => {});
    }
  }
}
