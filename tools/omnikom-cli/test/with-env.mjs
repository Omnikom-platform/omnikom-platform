// Tests for tools/with-env.mjs (its body is lib/with-env.mjs): the time limit, its outcome (124, its own line), the tree stop, the exit codes.
// The limit is WITH_ENV_TIMEOUT_MIN and a fraction of a minute is allowed, so a timeout test takes about a second. The default, 0 and a bad
// value are tested in-process with a recording timer (no waiting at all).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pidAlive } from './harness.mjs';

export async function withEnvTests({ check, CLI_ROOT, REPO_ROOT, lib }) {
  const { main, parseMinutes, limitMs, DEFAULT_MIN } = await lib('with-env.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-withenv-'));
  const sleeper = join(CLI_ROOT, 'test', 'with-env-sleeper.mjs'), runner = join(CLI_ROOT, 'test', 'with-env-main.mjs');
  const secret = randomBytes(12).toString('hex');   // a value in the env file that must never be printed
  const envFile = join(dir, 'x.env');
  writeFileSync(envFile, `WITHENV_TEST_VALUE=${secret}\nWITH_ENV_TIMEOUT_MIN=99\n`);   // the file's own WITH_ENV_TIMEOUT_MIN must be ignored
  const node = process.execPath;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitGone = async (pid, ms = 6000) => { for (let t = 0; t < ms && pidAlive(pid); t += 100) await sleep(100); return !pidAlive(pid); };
  // in-process: main with a recording timer; -> { code, lines, sets, clears }
  const inproc = async (min, childArgs = ['exit', '0'], file = envFile) => {
    const procEnv = { ...process.env }; delete procEnv.WITH_ENV_TIMEOUT_MIN; if (min !== undefined) procEnv.WITH_ENV_TIMEOUT_MIN = min;
    const lines = [], sets = [], clears = [];
    const timers = { set: (fn, ms) => { sets.push(ms); return sets.length; }, clear: h => { clears.push(h); } };
    const code = await main([file, '--', node, sleeper, ...childArgs], { procEnv, err: s => lines.push(s), timers });
    return { code, lines, sets, clears };
  };
  // a real run through this copy's lib, with a limit in minutes
  const run = (min, childArgs, extra = {}) => spawnSync(node, [runner, envFile, '--', ...(extra.cmd ? [extra.cmd] : [node, sleeper]), ...childArgs],
    { encoding: 'utf8', timeout: 60000, env: { ...process.env, WITH_ENV_TIMEOUT_MIN: String(min) } });

  try {
    // ---- the value and the default
    const unset = await inproc(undefined);
    check('with-env: with no WITH_ENV_TIMEOUT_MIN the limit is 10 minutes, and the timer is cleared when the child ends', parseMinutes(undefined).min === 10 && DEFAULT_MIN === 10 && unset.code === 0 && unset.sets.join() === '600000' && unset.clears.length === 1,
      JSON.stringify({ unset, parsed: parseMinutes(undefined) }));
    const empty = await inproc('');
    check('with-env: an empty WITH_ENV_TIMEOUT_MIN is the default, not an error', empty.code === 0 && empty.sets.join() === '600000', JSON.stringify(empty));
    const zero = await inproc('0');
    check('with-env: 0 is no limit (no timer is set at all)', zero.code === 0 && zero.sets.length === 0 && limitMs(0) === 0, JSON.stringify(zero));
    const frac = await inproc('1.5');
    check('with-env: the caller\'s value is the limit (a fraction is fine) and the env file\'s own WITH_ENV_TIMEOUT_MIN (99) is ignored', frac.code === 0 && frac.sets.join() === '90000', JSON.stringify(frac));
    const bad = [];
    for (const v of ['abc', '-1', '5m', '1,5', 'NaN', 'Infinity', '1e3', ' ']) bad.push([v, await inproc(v, ['exit', '0'])]);
    check('with-env: a value that is not a number of minutes is exit 2 with a usage line, and the command is not started',
      bad.every(([, r]) => r.code === 2 && r.sets.length === 0 && r.lines.some(l => l.includes('WITH_ENV_TIMEOUT_MIN')) && r.lines.some(l => l.startsWith('usage:'))), JSON.stringify(bad.filter(([, r]) => r.code !== 2)));
    const noStart = await main([envFile, '--', join(dir, 'no-such-program'), 'x'], { procEnv: { ...process.env, WITH_ENV_TIMEOUT_MIN: 'abc' }, err: () => {} });
    check('with-env: a bad value is exit 2 even for a command that does not exist (the value is checked before the start)', noStart === 2, String(noStart));
    check('with-env: a huge number of minutes is held at the largest timer a process can set (it would fire at once otherwise)', limitMs(99999999) === 2 ** 31 - 1 && limitMs(10) === 600000 && limitMs(0.02) === 1200, [limitMs(99999999), limitMs(10), limitMs(0.02)].join());

    // ---- the outcome of a timeout
    const t0 = Date.now();
    const to = run(0.02, ['sleep', '60000']);
    check('with-env: a timeout is exit 124 with its own line, soon after the limit, and no value of the env file is printed',
      to.status === 124 && to.stderr.includes(`with-env: ${node} timed out after 0.02 min and was stopped (set WITH_ENV_TIMEOUT_MIN, 0 = no limit)`)
        && !to.stderr.includes('could not start') && Date.now() - t0 < 30000 && !(to.stdout + to.stderr).includes(secret),
      `status ${to.status} after ${Date.now() - t0} ms: ${String(to.stderr).slice(0, 200)}`);
    const ok7 = run(5, ['exit', '7']);
    check('with-env: the child\'s own exit status is the exit status, and a child that ends in time is not timed out', ok7.status === 7 && ok7.stderr === '', `status ${ok7.status}: ${ok7.stderr}`);
    const quick = run(5, ['sleep', '300']);
    check('with-env: a child that finishes before the limit exits 0', quick.status === 0 && quick.stderr === '', `status ${quick.status}: ${quick.stderr}`);
    const missing = run(5, [], { cmd: join(dir, 'no-such-program') });
    check('with-env: a command that cannot start is still exit 127, not 124', missing.status === 127 && /could not start/.test(missing.stderr) && !/timed out/.test(missing.stderr), `status ${missing.status}: ${missing.stderr}`);

    // ---- the whole tree is stopped
    const pidFile = join(dir, 'grandchild.pid');
    const tree = run(0.03, ['tree', pidFile, '60000']);
    const gpid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : 0;
    const gone = gpid > 0 ? await waitGone(gpid) : false;
    if (gpid > 0 && !gone) try { process.kill(gpid, 'SIGKILL'); } catch { /* already gone */ }
    check('with-env: after a timeout the grandchild the child started is gone too', tree.status === 124 && gpid > 0 && gone, `status ${tree.status}, grandchild ${gpid} ${gone ? 'gone' : 'STILL ALIVE'}`);

    // ---- the wrapper is wired to the lib
    const real = spawnSync(node, [join(REPO_ROOT, 'tools', 'with-env.mjs'), envFile, '--', node, sleeper, 'exit', '3'], { encoding: 'utf8', timeout: 60000 });
    const realTo = spawnSync(node, [join(REPO_ROOT, 'tools', 'with-env.mjs'), envFile, '--', node, sleeper, 'sleep', '60000'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, WITH_ENV_TIMEOUT_MIN: '0.02' } });
    check('with-env: tools/with-env.mjs passes the child\'s status through and times out with 124', real.status === 3 && realTo.status === 124, `${real.status} / ${realTo.status}: ${realTo.stderr}`);

    // ---- a signal (no process groups on Windows: there the terminal's Ctrl-C reaches the child itself)
    if (process.platform !== 'win32') {
      const sigFile = join(dir, 'sig.pid');
      const c = spawn(node, [runner, envFile, '--', node, sleeper, 'tree', sigFile, '60000'], { stdio: 'ignore', env: { ...process.env, WITH_ENV_TIMEOUT_MIN: '5' } });
      const exited = new Promise(r => c.on('exit', (code) => r(code)));
      for (let t = 0; t < 5000 && !existsSync(sigFile); t += 100) await sleep(100);
      const sp = existsSync(sigFile) ? Number(readFileSync(sigFile, 'utf8')) : 0;
      await sleep(300); c.kill('SIGTERM');
      const code = await Promise.race([exited, sleep(10000).then(() => 'hung')]);
      const sGone = sp > 0 ? await waitGone(sp) : false;
      if (sp > 0 && !sGone) try { process.kill(sp, 'SIGKILL'); } catch { /* gone */ }
      check('with-env: SIGTERM to with-env stops the child\'s whole tree (it runs the child in its own process group) and exits 143', code === 143 && sGone, `exit ${code}, grandchild ${sGone ? 'gone' : 'ALIVE'}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
}
