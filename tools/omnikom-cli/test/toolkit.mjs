// Tests for the toolkit and the three adapters (P3.3 B4): lib/fetch.mjs (the polite fetcher), the one-browser-at-a-time lock of lib/browser.mjs,
// lib/render.mjs, lib/machine.mjs (the machine file and the reaper adapter), lib/heavy.mjs and lib/desktop.mjs.
//   node tools/omnikom-cli/test/toolkit.mjs [--bail] [--time]      exit 0 = every check passed, 1 = a check failed; lines start with "ok  " or "FAIL "
// No database, no network, no real heavy job, desktop script or reaper: every adapter is handed a fake `run`, every machine file is a file of this test,
// every browser lock is a file in this test's temp folder. The code under test is loaded ONLY through `lib`: test/mutate.mjs runs this file against a
// broken COPY of the CLI. The one real browser is case C14 (a missing browser is a FAIL, never a skip).
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, realpathSync, writeSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tick = () => new Promise(r => setImmediate(r));

export async function toolkitTests({ check, CLI_ROOT, REPO_ROOT, lib }) {
  void CLI_ROOT; void REPO_ROOT;
  // a module that cannot be loaded makes the cases that use it FAIL (each case runs in a try), never a crash of this file
  const M = {}, loadFail = {};
  for (const f of ['errors', 'fetch', 'browser', 'render', 'machine', 'heavy', 'desktop']) {
    try { M[f] = await lib(`${f}.mjs`); } catch (e) { M[f] = {}; loadFail[f] = String(e && e.message).slice(0, 120); }
  }
  const root = mkdtempSync(join(tmpdir(), 'omnikom-toolkit-'));
  const errOf = async fn => { try { await fn(); return null; } catch (e) { return e; } };
  const isErr = (e, name, message) => Boolean(e) && e.name === name && (message === undefined || e.message === message);
  const tc = async (name, fn) => {
    let ok = false, detail = '';
    try {
      const [good, info] = await fn();
      ok = good === true;
      detail = ok ? '' : JSON.stringify(info === undefined ? null : info);
    } catch (e) { detail = `threw ${e && e.name}: ${e && e.message}${Object.keys(loadFail).length ? ` (not loaded: ${JSON.stringify(loadFail)})` : ''}`; }
    check(`toolkit: ${name}`, ok, detail);
  };
  // a clock a test advances by hand: sleep adds to the fake now; with `yields` it also lets the event loop run once (a stub browser's exit comes on setImmediate)
  const fakeClock = (yields = false) => { const c = { t: 0 }; c.now = () => c.t; c.sleep = async ms => { c.t += ms; if (yields) await tick(); }; return c; };
  // a fetchImpl that writes down { host, at, init } for every request and answers answer(host, n-th request to that host)
  const recFetch = (clock, answer = () => ({ status: 200 })) => {
    const asked = [];
    const fetchImpl = async (href, init) => { const host = new URL(href).hostname; asked.push({ host, at: clock.now(), init }); return answer(host, asked.filter(a => a.host === host).length); };
    return { asked, fetchImpl };
  };
  // REC: a `run` that writes down (cmd, args, opts) and returns one fixed object
  const mkRec = () => { const calls = [], ret = { status: 0, stdout: 'rec\n', stderr: '' }; return { calls, ret, run: async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return ret; } }; };
  const tokenOf = file => { try { return JSON.parse(readFileSync(file, 'utf8')).token; } catch { return null; } };

  // MF: a machine file of this test, its three keys and the files they name (all empty)
  const desk = join(root, 'desk');
  mkdirSync(desk);
  for (const s of ['shot', 'click', 'type-into', 'edge']) writeFileSync(join(desk, `${s}.ps1`), '');
  for (const f of ['heavy.mjs', 'reap.mjs']) writeFileSync(join(root, f), '');
  const MF = join(root, 'machine.json');
  writeFileSync(MF, JSON.stringify({ heavyScript: join(root, 'heavy.mjs'), agentDesktopDir: desk, reaperScript: join(root, 'reap.mjs') }));
  const E = { ...process.env, OMNIKOM_MACHINE_FILE: MF };
  const mfEnv = (name, content) => { const file = join(root, name); writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content)); return { file, env: { ...process.env, OMNIKOM_MACHINE_FILE: file } }; };

  try {
    // ---------------------------------------------------------------- lib/fetch.mjs
    await tc('C1 fetch: one request at a time to a host, the gap apart; hosts never wait for each other (F3)', async () => {
      const clock = fakeClock(), r = recFetch(clock);
      const f = M.fetch.makeFetcher({ gapMs: 1000, fetchImpl: r.fetchImpl, clock });
      await Promise.all(['https://a.test/1', 'https://a.test/2', 'https://a.test/3', 'https://b.test/1'].map(u => f.get(u)));
      const at = h => r.asked.filter(x => x.host === h).map(x => x.at);
      return [same(at('a.test'), [0, 1000, 2000]) && same(at('b.test'), [0]), { a: at('a.test'), b: at('b.test') }];
    });

    await tc('C2 fetch: a gap under 1000 ms is only for this machine; a gap that is not a number of ms is Usage (F2, F0)', async () => {
      const clock = fakeClock(), r = recFetch(clock);
      const f = M.fetch.makeFetcher({ gapMs: 500, fetchImpl: r.fetchImpl, clock });
      const e = await errOf(() => f.get('https://a.test/'));
      const askedAfterRefusal = r.asked.length;
      const statuses = [];
      for (const u of ['http://127.0.0.1:9/', 'http://localhost:9/', 'http://[::1]:9/']) statuses.push((await f.get(u)).status);
      const bad = [NaN, -1].map(g => { try { M.fetch.makeFetcher({ gapMs: g }); return null; } catch (x) { return x; } });
      const ok = isErr(e, 'Usage', 'a gap under 1000 ms is allowed only to this machine, not to a.test') && askedAfterRefusal === 0
        && same(statuses, [200, 200, 200]) && r.asked.length === 3
        && bad.every(x => isErr(x, 'Usage', 'the gap must be a number of milliseconds, 0 or more'));
      return [ok, { refused: e && e.message, askedAfterRefusal, statuses, asked: r.asked.length, bad: bad.map(x => x && x.name) }];
    });

    await tc('C3 fetch: only an http or https address is fetched (F1)', async () => {
      const clock = fakeClock(), r = recFetch(clock);
      const f = M.fetch.makeFetcher({ fetchImpl: r.fetchImpl, clock });
      const urls = ['file:///x', 'ftp://a.test/x', 'a.test/x'];
      const errs = [];
      for (const u of urls) errs.push(await errOf(() => f.get(u)));
      const ok = errs.every((e, i) => isErr(e, 'Usage', `fetch takes an http or https address: ${urls[i]}`)) && r.asked.length === 0;
      return [ok, { errs: errs.map(e => e && `${e.name}: ${e.message}`), asked: r.asked.length }];
    });

    await tc('C4 fetch: one 429 stops that host for the run, answers nothing more from it, and cancels the body; any other status is the answer (F4)', async () => {
      const clock = fakeClock();
      let cancels = 0, first = true;
      const r = recFetch(clock, host => {
        if (host === 'a.test' && first) { first = false; return { status: 429, body: { cancel: async () => { cancels++; } } }; }
        return { status: 200 };
      });
      const f = M.fetch.makeFetcher({ gapMs: 1000, fetchImpl: r.fetchImpl, clock });
      const res = await Promise.allSettled([f.get('https://a.test/1'), f.get('https://a.test/2'), f.get('https://b.test/1')]);
      const text = '429 from a.test: this host is stopped for the rest of this run';
      const stoppedOk = [res[0], res[1]].every(x => x.status === 'rejected' && isErr(x.reason, 'Blocked', text));
      const askedA = r.asked.filter(x => x.host === 'a.test').length;
      const bOk = res[2].status === 'fulfilled' && res[2].value.status === 200;
      // the control: a 503 is an answer, and the host is asked again
      const clock2 = fakeClock();
      let firstB = true;
      const r2 = recFetch(clock2, () => { if (firstB) { firstB = false; return { status: 503 }; } return { status: 200 }; });
      const f2 = M.fetch.makeFetcher({ gapMs: 1000, fetchImpl: r2.fetchImpl, clock: clock2 });
      const c1 = await f2.get('https://a.test/1'), c2 = await f2.get('https://a.test/2');
      const ok = stoppedOk && cancels === 1 && askedA === 1 && bOk && c1.status === 503 && c2.status === 200 && r2.asked.length === 2;
      return [ok, { states: res.map(x => x.status), reasons: res.map(x => x.reason && x.reason.message), cancels, askedA, bOk, control: [c1.status, c2.status, r2.asked.length] }];
    });

    await tc('C5 fetch: a redirect is the caller\'s next get, and a request that gets no answer ends at the time limit (F5)', async () => {
      let seen = null;
      const fetchImpl = (href, init) => {
        seen = init;
        return new Promise((resolveFn, reject) => {
          if (!init.signal) { setTimeout(() => resolveFn({ status: 200 }), 3000).unref(); return; }
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      };
      const f = M.fetch.makeFetcher({ gapMs: 0, timeoutMs: 50, fetchImpl });
      const t0 = Date.now();
      let guard;
      // the guard keeps the event loop alive and ends the wait if the request has no time limit
      const e = await Promise.race([errOf(() => f.get('http://127.0.0.1:9/', { redirect: 'follow' })), new Promise(r => { guard = setTimeout(() => r('no time limit'), 2500); })]);
      clearTimeout(guard);
      const ms = Date.now() - t0;
      const ok = Boolean(e) && e.name === 'TimeoutError' && ms < 3000 && Boolean(seen) && seen.redirect === 'manual';
      return [ok, { e: e && (e.name || e), ms, redirect: seen && seen.redirect }];
    });

    // ---------------------------------------------------------------- lib/browser.mjs: one browser of ours at a time
    // S: a stub start (as in test/journey.mjs browserStartTests): the stub child exits 3 on setImmediate unless `behave` says otherwise
    const S = async (tag, { before, behave } = {}) => {
      const lockFile = join(root, `${tag}.lock`);
      if (before) before(lockFile);
      const clock = fakeClock(true);
      let spawns = 0, temps = 0;
      const guard = {
        guardedTemp: prefix => { temps++; const dir = mkdtempSync(join(root, prefix)); return { dir, release: () => rmSync(dir, { recursive: true, force: true }) }; },
        killTree: () => true,
        killFolderProcs: () => 0,
      };
      const spawnImpl = () => {
        spawns++;
        const child = new EventEmitter(); child.pid = 4000000;
        if (behave) behave(child, lockFile); else setImmediate(() => child.emit('exit', 3, null));
        return child;
      };
      const t0 = Date.now();
      let error = null;
      try {
        const b = await M.browser.launchBrowser({ env: { OMNIKOM_BROWSER: process.execPath, OMNIKOM_BROWSER_LOCK: lockFile }, spawnImpl, importer: async () => guard, lockWaitMs: 5000, clock });
        await b.close();
      } catch (e) { error = e; }
      return { error, spawns, temps, ms: Date.now() - t0, now: clock.t, lockFile };
    };

    await tc('C6 browser: a start that fails leaves no lock file behind (L1, L4)', async () => {
      const r = await S('c6');
      const ok = Boolean(r.error) && /exited before it reported/.test(r.error.message) && r.spawns === 1 && !existsSync(r.lockFile);
      return [ok, { msg: r.error && r.error.message, spawns: r.spawns, lockLeft: existsSync(r.lockFile) }];
    });

    await tc('C7 browser: a lock held by a live process is waited for, then BLOCKED with the holder named; nothing starts; the holder\'s file stays (L2)', async () => {
      const r = await S('c7', { before: f => writeFileSync(f, JSON.stringify({ pid: process.pid, token: 'other' })) });
      const want = `another browser of ours holds ${r.lockFile} (PID ${process.pid}); waited 5 s`;
      const ok = isErr(r.error, 'Blocked', want) && r.spawns === 0 && r.temps === 0 && r.now >= 5000 && r.ms < 3000 && tokenOf(r.lockFile) === 'other';
      return [ok, { msg: r.error && r.error.message, name: r.error && r.error.name, spawns: r.spawns, temps: r.temps, now: r.now, ms: r.ms, token: tokenOf(r.lockFile) }];
    });

    await tc('C8 browser: a lock of an ended process, or one that is not JSON, is taken over (L3)', async () => {
      const ended = spawnSync(process.execPath, ['--version'], { timeout: 30000 }).pid;
      const a = await S('c8a', { before: f => writeFileSync(f, JSON.stringify({ pid: ended, token: 'old' })) });
      const b = await S('c8b', { before: f => writeFileSync(f, 'x') });
      const ok = [a, b].every(r => r.spawns === 1 && !existsSync(r.lockFile));
      return [ok, [a, b].map(r => ({ spawns: r.spawns, lockLeft: existsSync(r.lockFile), err: r.error && r.error.message }))];
    });

    await tc('C9 browser: release removes the lock file only while it holds this start\'s token (L4)', async () => {
      const r = await S('c9', { behave: (child, f) => { writeFileSync(f, JSON.stringify({ pid: process.pid, token: 'other' })); setImmediate(() => child.emit('exit', 3, null)); } });
      return [existsSync(r.lockFile) && tokenOf(r.lockFile) === 'other', { exists: existsSync(r.lockFile), token: tokenOf(r.lockFile) }];
    });

    await tc('C10 browser: the lock file is OMNIKOM_BROWSER_LOCK or ~/.claude/state/browser.lock; the wait is 30 minutes (L5)', async () => {
      const B = M.browser;
      const a = B.browserLockPath({ OMNIKOM_BROWSER_LOCK: '/x/l' }), b = B.browserLockPath({});
      const ok = a === '/x/l' && b === join(homedir(), '.claude', 'state', 'browser.lock') && B.BROWSER_LOCK_WAIT_MS === 1800000;
      return [ok, { a, b, wait: B.BROWSER_LOCK_WAIT_MS }];
    });

    // ---------------------------------------------------------------- lib/render.mjs
    const fakeLaunch = (rec, o = {}) => async () => ({
      async newPage(viewport) {
        rec.push(['newPage', viewport]);
        return {
          async open(u) { rec.push(['open', u]); if (o.openThrows) throw new Error(o.openThrows); return { status: 200 }; },
          async screenshot(p) { rec.push(['screenshot', p]); writeFileSync(p, Buffer.from([1, 2, 3])); return 3; },
          async call(m, p) { rec.push(['call', m, p]); return { data: Buffer.from('%PDF-1.4 fake').toString('base64') }; },
        };
      },
      async close() { rec.push(['close']); },
    });

    await tc('C11 render: a PNG is the page\'s screenshot, a PDF is Page.printToPDF written to the folder made for it; the browser is closed (R2)', async () => {
      const viewport = { width: 390, height: 844, mobile: true };
      const rec1 = [], png = join(root, 'a.png');
      const r1 = await M.render.renderPage('https://site.test/a', png, { viewport, launch: fakeLaunch(rec1) });
      const rec2 = [], pdf = join(root, 'out', 'a.pdf');
      const r2 = await M.render.renderPage('https://site.test/a', pdf, { launch: fakeLaunch(rec2) });
      const text = existsSync(pdf) ? readFileSync(pdf, 'utf8') : null;
      const ok1 = same(r1, { bytes: 3, status: 200 }) && same(rec1, [['newPage', viewport], ['open', 'https://site.test/a'], ['screenshot', png], ['close']]);
      const ok2 = same(r2, { bytes: 13, status: 200 }) && same(rec2.map(x => x[0]), ['newPage', 'open', 'call', 'close']) && same(rec2[2], ['call', 'Page.printToPDF', { printBackground: true }]) && text === '%PDF-1.4 fake';
      return [ok1 && ok2, { r1, rec1, r2, rec2, text }];
    });

    await tc('C12 render: a page that breaks is thrown on, after the browser is closed (R3)', async () => {
      const rec = [];
      const e = await errOf(() => M.render.renderPage('https://site.test/a', join(root, 'b.png'), { launch: fakeLaunch(rec, { openThrows: 'page broke' }) }));
      const ok = Boolean(e) && e.message === 'page broke' && rec.filter(x => x[0] === 'close').length === 1;
      return [ok, { msg: e && e.message, rec: rec.map(x => x[0]) }];
    });

    await tc('C13 render: an address that is not http, https or file, or a file that is not .png or .pdf, is Usage before any browser starts (R1)', async () => {
      let launched = 0;
      const launch = async () => { launched++; return fakeLaunch([])(); };
      const e1 = await errOf(() => M.render.renderPage('ftp://a.test/x', join(root, 'x.png'), { launch }));
      const e2 = await errOf(() => M.render.renderPage('https://a.test/', join(root, 'x.jpg'), { launch }));
      const ok = isErr(e1, 'Usage', 'render takes an http, https or file address: ftp://a.test/x')
        && isErr(e2, 'Usage', `render writes a .png or a .pdf file: ${join(root, 'x.jpg')}`) && launched === 0;
      return [ok, { e1: e1 && e1.message, e2: e2 && e2.message, launched }];
    });

    await tc('C14 render: a real browser prints a local page to a PDF, and its lock file is gone afterwards (R2, L4)', async () => {
      const page = join(root, 'real.html'), out = join(root, 'real.pdf'), lockFile = join(root, 'real.lock');
      writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>toolkit</title><h1>hello</h1>');
      const r = await M.render.renderPage(pathToFileURL(page).href, out, { env: { ...process.env, OMNIKOM_BROWSER_LOCK: lockFile } });
      const head = existsSync(out) ? readFileSync(out).subarray(0, 5).toString('latin1') : null;
      const ok = head === '%PDF-' && r.bytes > 0 && !existsSync(lockFile);
      return [ok, { head, bytes: r.bytes, lockLeft: existsSync(lockFile) }];
    });

    // ---------------------------------------------------------------- lib/machine.mjs, lib/heavy.mjs, lib/desktop.mjs
    await tc('C15 machine: a machine file that cannot be used is BLOCKED with the key and the fix named; the adapters ask nothing without it (M1, D2)', async () => {
      const REC = mkRec();
      const mp = M.machine.machinePath;
      const nj = mfEnv('m-notjson.json', 'not json'), nokey = mfEnv('m-empty.json', {}), rel = mfEnv('m-rel.json', { heavyScript: 'rel/heavy.mjs' });
      const missing = mfEnv('m-missing.json', { heavyScript: join(root, 'missing.mjs') }), notdir = mfEnv('m-notdir.json', { agentDesktopDir: join(root, 'heavy.mjs') });
      const five = [
        [await errOf(() => mp('heavyScript', 'file', nj.env)), `${nj.file} is not readable`, `make ${nj.file} a JSON object of this machine's paths`],
        [await errOf(() => mp('heavyScript', 'file', nokey.env)), `${nokey.file} has no "heavyScript"`, `add "heavyScript": "<absolute path>" to ${nokey.file}`],
        [await errOf(() => mp('heavyScript', 'file', rel.env)), `${rel.file}: "heavyScript" must be an absolute path`, null],
        [await errOf(() => mp('heavyScript', 'file', missing.env)), `${missing.file}: "heavyScript" is not a file: ${join(root, 'missing.mjs')}`, `correct "heavyScript" in ${missing.file}`],
        [await errOf(() => mp('agentDesktopDir', 'dir', notdir.env)), `${notdir.file}: "agentDesktopDir" is not a folder: ${join(root, 'heavy.mjs')}`, `correct "agentDesktopDir" in ${notdir.file}`],
      ];
      const fiveOk = five.every(([e, msg, unblock]) => isErr(e, 'Blocked', msg) && (unblock === null || e.unblock === unblock));
      const three = [
        await errOf(() => M.heavy.runHeavy({ label: 'suite x', command: ['node', 'a.mjs'], timeoutMs: 1000, env: nokey.env, run: REC.run })),
        await errOf(() => M.desktop.runDesktop('shot', [], { timeoutMs: 1000, env: nokey.env, run: REC.run })),
        await errOf(() => M.machine.reapDry({ env: nokey.env, run: REC.run })),
      ];
      const threeOk = three.every((e, i) => isErr(e, 'Blocked', `${nokey.file} has no "${['heavyScript', 'agentDesktopDir', 'reaperScript'][i]}"`));
      const desk2 = join(root, 'desk2');
      mkdirSync(desk2);
      for (const s of ['shot', 'click', 'type-into']) writeFileSync(join(desk2, `${s}.ps1`), '');
      const noEdge = mfEnv('m-desk2.json', { agentDesktopDir: desk2 });
      const last = await errOf(() => M.desktop.runDesktop('edge', [], { timeoutMs: 1000, env: noEdge.env, run: REC.run }));
      const lastOk = isErr(last, 'Blocked', 'the desktop script edge.ps1 is not in the agentDesktopDir folder');
      return [fiveOk && threeOk && lastOk && REC.calls.length === 0, { five: five.map(([e]) => e && `${e.name}: ${e.message}`), three: three.map(e => e && e.message), last: last && last.message, calls: REC.calls.length }];
    });

    await tc('C16 heavy: the job goes to heavy.mjs as its words say, with --wait-min only when given; the result is the run\'s own (H1)', async () => {
      const REC = mkRec();
      const base = { label: 'suite x', command: ['node', 'a.mjs'], timeoutMs: 60000, env: E, run: REC.run };
      const r1 = await M.heavy.runHeavy({ ...base, waitMin: 5 });
      const r2 = await M.heavy.runHeavy(base);
      const script = join(root, 'heavy.mjs');
      const [c1, c2] = REC.calls;
      const ok = r1 === REC.ret && r2 === REC.ret && REC.calls.length === 2
        && c1.cmd === process.execPath && same(c1.args, [script, '--wait-min', '5', '--label', 'suite x', '--', 'node', 'a.mjs']) && c1.opts.timeout === 60000 && c1.opts.env === E
        && c2.cmd === process.execPath && same(c2.args, [script, '--label', 'suite x', '--', 'node', 'a.mjs']) && c2.opts.timeout === 60000 && c2.opts.env === E;
      return [ok, { calls: REC.calls.map(c => ({ cmd: c.cmd === process.execPath ? 'execPath' : c.cmd, args: c.args, timeout: c.opts && c.opts.timeout, envIsE: c.opts && c.opts.env === E })) }];
    });

    await tc('C17 heavy: the adapter does not queue: two jobs at once are both handed to the run at once (H2)', async () => {
      const gates = [];
      const run = () => new Promise(resolveFn => {
        const t = setTimeout(() => resolveFn({ status: 1 }), 2000);
        gates.push(() => { clearTimeout(t); resolveFn({ status: 0 }); });
        if (gates.length === 2) for (const g of gates) g();
      });
      const job = { label: 'suite x', command: ['node', 'a.mjs'], timeoutMs: 60000, env: E, run };
      const r = await Promise.all([M.heavy.runHeavy(job), M.heavy.runHeavy(job)]);
      return [r.every(x => x.status === 0), r.map(x => x.status)];
    });

    await tc('C18 heavy: only exit 75 with the lock-wait line on stderr is BLOCKED; any other result is returned as it is (H3)', async () => {
      const job = { label: 'suite x', command: ['node', 'a.mjs'], timeoutMs: 60000, env: E };
      const L1 = 'heavy: gave up after 5 min: suite y (PID 9) still holds the lock. Nothing was run.', L2 = 'heavy: refused: 1.0 GB of RAM free, under 4 GB, after waiting 5 min. Nothing was run.';
      const e1 = await errOf(() => M.heavy.runHeavy({ ...job, run: async () => ({ status: 75, stderr: `${L1}\n` }) }));
      const e2 = await errOf(() => M.heavy.runHeavy({ ...job, run: async () => ({ status: 75, stderr: `${L2}\n` }) }));
      const own = { status: 75, stderr: 'own exit\n' };
      const r3 = await M.heavy.runHeavy({ ...job, run: async () => own });
      const ok = isErr(e1, 'Blocked', `the heavy job 'suite x' did not start: ${L1.slice('heavy: '.length)}`)
        && isErr(e2, 'Blocked', `the heavy job 'suite x' did not start: ${L2.slice('heavy: '.length)}`) && r3 === own;
      return [ok, { e1: e1 && `${e1.name}: ${e1.message}`, e2: e2 && `${e2.name}: ${e2.message}`, third: r3 === own }];
    });

    await tc('C19 heavy: a label, a command, a wait or a time limit that is not as asked is Usage, and nothing is run (H4)', async () => {
      const REC = mkRec();
      const base = { label: 'suite x', command: ['node', 'a.mjs'], waitMin: 5, timeoutMs: 60000, env: E, run: REC.run };
      const LABEL = 'a heavy job needs a label of one line, 1 to 100 characters', COMMAND = 'a heavy job needs a command: a list of words after --';
      const WAIT = '--wait-min must be a number of minutes, 0 or more', LIMIT = 'a heavy job needs a time limit in milliseconds, above 0';
      const tries = [
        [{ label: '' }, LABEL], [{ label: 'a\nb' }, LABEL], [{ label: 'x'.repeat(101) }, LABEL],
        [{ command: [] }, COMMAND], [{ command: 'node a.mjs' }, COMMAND],
        [{ waitMin: -1 }, WAIT], [{ waitMin: '5' }, WAIT],
        [{ timeoutMs: undefined }, LIMIT], [{ timeoutMs: 0 }, LIMIT],
      ];
      const got = [];
      for (const [o, msg] of tries) { const e = await errOf(() => M.heavy.runHeavy({ ...base, ...o })); got.push(isErr(e, 'Usage', msg) ? 'ok' : (e ? `${e.name}: ${e.message}` : 'no error')); }
      return [got.every(g => g === 'ok') && REC.calls.length === 0, { got, calls: REC.calls.length }];
    });

    await tc('C20 desktop: a script is run by powershell, no profile, not interactive, from the agentDesktopDir folder (D1)', async () => {
      const REC = mkRec();
      const r = await M.desktop.runDesktop('shot', ['-Out', 'x.png'], { timeoutMs: 30000, env: E, run: REC.run });
      const [c] = REC.calls;
      const ok = r === REC.ret && REC.calls.length === 1 && c.cmd === 'powershell'
        && same(c.args, ['-NoProfile', '-NonInteractive', '-File', join(root, 'desk', 'shot.ps1'), '-Out', 'x.png']) && c.opts.timeout === 30000 && c.opts.env === E;
      return [ok, { cmd: c && c.cmd, args: c && c.args, timeout: c && c.opts && c.opts.timeout }];
    });

    await tc('C21 desktop: only shot, click, type-into and edge, as written, with a list of words and a time limit (D2)', async () => {
      const REC = mkRec();
      for (const s of ['click', 'type-into', 'edge']) await M.desktop.runDesktop(s, [], { timeoutMs: 1000, env: E, run: REC.run });
      const reached = REC.calls.map(c => c.args[3]);
      const bad = [['wt-close', [], 1000], ['telegram-saved', [], 1000], ['../shot', [], 1000], ['Shot', [], 1000], ['shot.ps1', [], 1000], ['shot', 'x', 1000], ['shot', [], undefined]];
      const errs = [];
      for (const [s, a, t] of bad) errs.push(await errOf(() => M.desktop.runDesktop(s, a, { timeoutMs: t, env: E, run: REC.run })));
      const ok = same(reached, [join(desk, 'click.ps1'), join(desk, 'type-into.ps1'), join(desk, 'edge.ps1')]) && errs.every(e => isErr(e, 'Usage')) && REC.calls.length === 3;
      return [ok, { reached, errs: errs.map(e => e && `${e.name}: ${e.message}`), calls: REC.calls.length }];
    });

    await tc('C22 machine: the reaper is run dry (--dry --no-stdin) with the time limit of the reaper, and only that (M2)', async () => {
      const REC = mkRec();
      const r = await M.machine.reapDry({ env: E, run: REC.run });
      const [c] = REC.calls;
      const ok = r === REC.ret && REC.calls.length === 1 && c.cmd === process.execPath && same(c.args, [join(root, 'reap.mjs'), '--dry', '--no-stdin']) && c.opts.timeout === 120000 && c.opts.env === E;
      return [ok, { args: c && c.args, timeout: c && c.opts && c.opts.timeout }];
    });
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

// run alone: node tools/omnikom-cli/test/toolkit.mjs [--bail] [--time]   (OMNIKOM_CLI_DIR points it at a copy of the CLI, as for run.mjs)
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const cliDir = process.env.OMNIKOM_CLI_DIR ? resolve(process.env.OMNIKOM_CLI_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.env.OMNIKOM_CLI_DIR = cliDir;
  const repoRoot = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(cliDir, '..', '..');
  const at = f => import(pathToFileURL(join(cliDir, f)).href);
  const { makeCheck } = await at('test/mutate-run.mjs');
  // every line is written synchronously: a piped stdout on Windows is async and process.exit would cut the last lines
  const say = text => { try { writeSync(1, text); } catch { process.stdout.write(text); } };
  const { check, counts } = makeCheck({ bail: process.argv.includes('--bail'), timed: process.argv.includes('--time'), out: line => say(`${line}\n`) });
  await toolkitTests({ check, CLI_ROOT: cliDir, REPO_ROOT: repoRoot, lib: f => at(join('lib', f)) });
  const c = counts();
  say(`${c.total - c.failed} of ${c.total} checks passed, ${c.failed} FAILED\n`);
  process.exit(c.failed ? 1 : 0);
}
