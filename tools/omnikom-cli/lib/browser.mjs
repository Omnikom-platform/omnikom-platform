// The journey browser (briefs/journey.md section 4): the installed Edge or Chrome, headless, driven over the DevTools protocol with
// Node's built-in WebSocket. No dependency. One browser per run in a profile folder of its own; the browser and everything that names
// that folder is killed on every path (tools/proc-guard, the rule of slice 5-H: no browser outlives its run).
//   const b = await launchBrowser();
//   const page = await b.newPage({ width: 390, height: 844, mobile: true });
//   const v = await page.open(url);            -> { status, headers, consoleErrors, exceptions, overflow, title }
//   await page.fill('input[name=email]', 'a@example.com'); await page.check('input[name=consent]');
//   const r = await page.submit('form');       -> { status, url, text }  (a real click on the submit button, then the new page)
//   await page.screenshot(file);               -> bytes written (a full-page PNG)
//   await b.close();
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Blocked } from './errors.mjs';
import { importRepo } from './repo.mjs';

const WIN = process.platform === 'win32';

// How long launchBrowser waits for the browser to write its DevTools address (the file DevToolsActivePort in its profile folder), as a wall clock.
// Measured 2026-11-02 on this laptop, 22 real headless Edge launches, spawn to a readable DevToolsActivePort: idle 6 launches 0.7 to 1.5 s (median 1.1 s); 4 at once 8 launches 1.6 to 49.2 s (median 43.4 s); 4 at once with 8 CPU-busy processes 8 launches 2.8 to 74.5 s (median 45.2 s).
// The bound is 180 s, 2.4 times the worst measured. A browser that cannot start, or exits with a code other than 0 or by a signal, is reported at once (see launchBrowser), so the bound only costs time when a browser really hangs or a hand-over brings no browser. Run 41404410237 went red on the old 15 s count.
export const DEVTOOLS_WAIT_MS = 180000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One headless browser of ours at a time on this machine (RULINGS-1 row 9): a start takes a lock file, close (or a failed start) gives it back.
// How long a start waits for another browser of ours to end, as a wall clock. PROVISIONAL: heavy.mjs's own default --wait-min 30, until P3.10-B10 logs real waits.
export const BROWSER_LOCK_WAIT_MS = 30 * 60000;
// beside the machine's heavy.lock; OMNIKOM_BROWSER_LOCK moves it (the tests give every start a lock of its own)
export function browserLockPath(env = process.env) {
  return env.OMNIKOM_BROWSER_LOCK || join(homedir(), '.claude', 'state', 'browser.lock');
}
// is this process alive? (EPERM means it exists but is not ours to signal: alive)
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
// The lock file holds { pid, token } and is made with the flag wx (it fails when the file exists). A file that is not JSON, or names a process that
// has ended, is a lock nobody holds and is taken over. A live holder is waited for in steps of one second (the loop never spins) up to waitMs; then BLOCKED.
// -> { release() }: removes the file only while it still holds this start's token (never another start's lock).
async function takeBrowserLock(file, { waitMs, clock }) {
  mkdirSync(dirname(file), { recursive: true });
  const token = randomUUID();
  const start = clock.now();
  for (;;) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
      return { release() { try { if (JSON.parse(readFileSync(file, 'utf8')).token === token) rmSync(file, { force: true }); } catch { /* gone, or not ours */ } } };
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let holder = null;
    try { holder = JSON.parse(readFileSync(file, 'utf8')); } catch { holder = null; }
    if (!holder || !alive(holder.pid)) {
      try { rmSync(file, { force: true }); } catch { /* it cannot be removed now: wait below, then look again */ }
      if (!existsSync(file)) continue;
    }
    const waited = clock.now() - start;
    const pid = holder ? holder.pid : null;
    if (waited >= waitMs) throw new Blocked(`another browser of ours holds ${file} (PID ${pid}); waited ${Math.round(waited / 1000)} s`, `wait for that run to end, or remove ${file} if PID ${pid} is not a browser run of ours`);
    await clock.sleep(1000);
  }
}

// OMNIKOM_BROWSER names a browser by path; otherwise the first of the usual places. Not found is BLOCKED with what to set (the tool is
// named, not skipped: DECISIONS 42).
export function findBrowser(env = process.env, exists = existsSync) {
  const candidates = [
    env.OMNIKOM_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find(p => exists(p));
  if (!found) throw new Blocked('no Edge or Chrome found for the journey browser', 'install Microsoft Edge, or set OMNIKOM_BROWSER to the path of msedge / chrome');
  return found;
}

// one DevTools connection: send(method, params, sessionId) -> result; on(method, handler); off(handler)
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Set();
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
      if (m.id !== undefined && this.pending.has(m.id)) {
        const { resolve, reject, method } = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result || {});
      } else if (m.method) for (const h of [...this.handlers]) h(m);
    });
    ws.addEventListener('close', () => { for (const { reject, method } of this.pending.values()) reject(new Error(`${method}: the browser closed the connection`)); this.pending.clear(); });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no answer in 30 s`)); }, 30000);
      this.pending.set(id, { method, resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(handler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
}

const lower = h => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
const jsString = s => JSON.stringify(String(s));

class Page {
  constructor(cdp, sessionId, targetId, viewport) {
    this.cdp = cdp; this.sid = sessionId; this.targetId = targetId; this.viewport = viewport;
    this.consoleErrors = []; this.exceptions = []; this.docs = [];   // docs: every top-level document response, in order
    this.loadWaiters = new Set();
    cdp.on(m => {
      if (m.sessionId !== sessionId) return;
      const p = m.params || {};
      if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') this.consoleErrors.push(`console.error: ${(p.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
      else if (m.method === 'Log.entryAdded' && p.entry && p.entry.level === 'error') this.consoleErrors.push(`${p.entry.source || 'log'}${p.entry.url ? ' ' + p.entry.url.slice(0, 110) : ''}: ${String(p.entry.text || '').slice(0, 110)}`);
      else if (m.method === 'Runtime.exceptionThrown') this.exceptions.push(String((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || 'exception').slice(0, 240));
      else if (m.method === 'Network.responseReceived' && p.type === 'Document') this.docs.push({ url: p.response.url, status: p.response.status, headers: lower(p.response.headers) });
      else if (m.method === 'Page.loadEventFired') for (const w of [...this.loadWaiters]) w();
    });
  }
  call(method, params) { return this.cdp.send(method, params, this.sid); }
  async init() {
    for (const d of ['Page', 'Runtime', 'Network', 'Log']) await this.call(`${d}.enable`);
    const { width, height, mobile } = this.viewport;
    await this.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: Boolean(mobile) });
  }
  // resolves when the next load event fires (or rejects after the limit)
  nextLoad(ms = 30000) {
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(t); this.loadWaiters.delete(done); resolve(); };
      const t = setTimeout(() => { this.loadWaiters.delete(done); reject(new Error(`the page did not finish loading in ${ms / 1000} s`)); }, ms);
      this.loadWaiters.add(done);
    });
  }
  async eval(expression) {
    const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`in the page: ${String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 200)}`);
    return r.result.value;
  }
  async measure() {
    return this.eval(`(() => { const d = document.documentElement; return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, title: document.title, text: (document.body ? document.body.innerText : '').slice(0, 4000) }; })()`);
  }
  // open a URL: the answer of the document itself, the errors the page raised while loading, and whether it scrolls sideways
  async open(url) {
    this.consoleErrors.length = 0; this.exceptions.length = 0; this.docs.length = 0;
    await this.call('Page.bringToFront');   // a tab behind another one is throttled and may never finish loading
    const loaded = this.nextLoad();
    const nav = await this.call('Page.navigate', { url });
    if (nav.errorText) throw new Error(`could not open ${url}: ${nav.errorText}`);
    await loaded;
    await sleep(600);   // late errors (a script that fails after load)
    const doc = [...this.docs].reverse().find(d => d.url.split('#')[0] === url.split('#')[0]) || this.docs[this.docs.length - 1] || { status: 0, headers: {} };
    const m = await this.measure();
    return { status: doc.status, headers: doc.headers, consoleErrors: [...this.consoleErrors], exceptions: [...this.exceptions], overflow: { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, overflowing: m.scrollWidth > m.clientWidth + 1 }, title: m.title, text: m.text };
  }
  // poll a page expression until it is truthy (false after the limit, never an exception: the caller says what was missing)
  async waitFor(expression, ms = 20000) {
    const end = Date.now() + ms;
    for (;;) {
      try { if (await this.eval(`Boolean(${expression})`)) return true; } catch { /* the page is between documents */ }
      if (Date.now() >= end) return false;
      await sleep(250);
    }
  }
  async has(selector) { return this.eval(`Boolean(document.querySelector(${jsString(selector)}))`); }
  async fill(selector, value) {
    const ok = await this.eval(`(() => { const e = document.querySelector(${jsString(selector)}); if (!e) return false; e.focus(); e.value = ${jsString(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`no element for ${selector}`);
  }
  async check(selector) {
    const ok = await this.eval(`(() => { const e = document.querySelector(${jsString(selector)}); if (!e) return false; if (!e.checked) e.click(); return e.checked; })()`);
    if (!ok) throw new Error(`could not tick ${selector}`);
  }
  // click the submit button of the form like a visitor, wait for the page that comes back; the answer is what that page says
  async submit(formSelector) {
    this.docs.length = 0;
    await this.call('Page.bringToFront');
    const loaded = this.nextLoad();
    const clicked = await this.eval(`(() => { const f = document.querySelector(${jsString(formSelector)}); const b = f && f.querySelector('button[type=submit], input[type=submit], button:not([type])'); if (!b) return false; b.click(); return true; })()`);
    if (!clicked) { this.loadWaiters.clear(); throw new Error(`no submit button in ${formSelector}`); }
    await loaded;
    await sleep(300);
    const doc = this.docs[this.docs.length - 1] || { status: 0, url: '' };
    const m = await this.measure();
    return { status: doc.status, url: doc.url, text: m.text };
  }
  async screenshot(file) {
    await this.call('Page.bringToFront');
    const { contentSize } = await this.call('Page.getLayoutMetrics');
    const width = Math.max(1, Math.ceil(contentSize.width)), height = Math.min(Math.max(1, Math.ceil(contentSize.height)), 12000);
    const shot = await this.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return statSync(file).size;
  }
  async close() { try { await this.cdp.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* the browser is going away */ } }
}

// A brand-new Chrome or Edge profile asks Windows whether the account's password is blank (LogonUser with an empty password), which logs a
// failed logon (event 4625); ten in a short time lock the account for 10 minutes (2026-11-11: 5 lockouts, 59 bad logons 04:08 to 08:00, SSH
// refused while locked; found by the OmniSkipX session). A "Local State" that already answers the question stops the probe. `now` is for tests.
// os_password_last_changed is a Windows FILETIME in microseconds: (Unix ms + 11644473600000) * 1000.
export function seedProfile(dir, now = Date.now()) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'Local State');
  if (existsSync(file)) return file;   // a profile that was seeded (or used) before keeps its own
  writeFileSync(file, JSON.stringify({ password_manager: { os_password_blank: false, os_password_last_changed: String((BigInt(now) + 11644473600000n) * 1000n) } }));
  return file;
}

// devtoolsWaitMs, lockWaitMs and clock are for tests only (a stub browser, short bounds, and a clock a test advances by hand so that a wait of
// 20 s of "browser time" costs no real seconds; clock covers the DevTools wait and the browser lock wait)
// The start waits for the lock of one browser at a time (above), then starts the browser; a start that fails gives the lock back at once,
// a started browser gives it back on close.
export async function launchBrowser(opts = {}) {
  const { env = process.env, lockWaitMs = BROWSER_LOCK_WAIT_MS, clock = { now: () => Date.now(), sleep } } = opts;
  const lock = await takeBrowserLock(browserLockPath(env), { waitMs: lockWaitMs, clock });
  try { return await startBrowser({ ...opts, lock }); } catch (e) { lock.release(); throw e; }
}

async function startBrowser({ lock, env = process.env, spawnImpl = spawn, importer = importRepo, devtoolsWaitMs = DEVTOOLS_WAIT_MS, clock = { now: () => Date.now(), sleep } } = {}) {
  const exe = findBrowser(env);
  const guard = await importer('tools/proc-guard/index.mjs');
  const folder = guard.guardedTemp('omnikom-jb-', 'journey-browser');   // cleaned on every exit path of this process
  seedProfile(folder.dir);   // before the spawn: an unseeded profile makes the browser test the Windows account's password (a failed logon each start)
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${folder.dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'];
  const child = spawnImpl(exe, args, { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
  let closed = false;
  // a browser that cannot start, or has exited with a code other than 0 or by a signal, is not waited for: both are said at once, with the reason
  let exited = null, spawnError = null;
  child.once('exit', (code, signal) => { exited = { code, signal }; });
  child.once('error', e => { spawnError = e; });
  // A started process that ends with exit code 0 and no signal has handed the browser over to another process (Edge 157.0.4341.46 on this laptop,
  // measured 2026-11-12 03:46: the started process ended after 0.1 s, the address file appeared after 0.4 s). The address is then waited for up to
  // the same bound (a handed-over browser comes up no faster than any other), and the ended process's number is never killed: Windows gives a free
  // number to the next process that starts. Everything that names the profile folder is killed instead.
  const handedOver = () => Boolean(exited && exited.code === 0 && !exited.signal);
  // kill the tree and everything naming the profile folder, then remove the folder; under load a late child can outlive the first pass,
  // so it is repeated until the folder is really gone (a folder that cannot be removed is a process that is still running)
  const stop = async () => {
    if (closed) return; closed = true;
    for (let i = 0; i < 8; i++) {
      try { if (handedOver()) guard.killFolderProcs(folder.dir); else guard.killTree(child.pid, folder.dir); } catch { /* already gone */ }
      try { folder.release(); } catch { /* the guard cleans at exit */ }
      try { rmSync(folder.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* a process still holds it: kill again */ }
      if (!existsSync(folder.dir)) return;
      await sleep(500);
    }
  };
  try {
    // the browser writes its address into the profile folder when it is ready
    const portFile = join(folder.dir, 'DevToolsActivePort');
    let wsPath = null, port = null;
    const waitStart = clock.now();
    for (;;) {
      if (existsSync(portFile)) { try { const [p, w] = readFileSync(portFile, 'utf8').split(/\r?\n/); if (p && w) { port = p; wsPath = w; break; } } catch { /* the browser still holds the file (EBUSY on Windows): look again */ } }
      const elapsed = clock.now() - waitStart;
      if (spawnError) throw new Error(`could not start the browser: ${spawnError.message}`);
      if (exited && !handedOver()) throw new Error(`the browser exited before it reported its DevTools address (${exited.signal ? `signal ${exited.signal}` : `exit code ${exited.code}`}) after ${(elapsed / 1000).toFixed(1)} s`);
      if (elapsed >= devtoolsWaitMs) throw new Error(`the browser did not report its DevTools address in ${(elapsed / 1000).toFixed(1)} s (bound ${devtoolsWaitMs / 1000} s)${handedOver() ? '; the started process had ended with exit code 0 (a hand-over)' : ''}`);
      await clock.sleep(100);
    }
    const ws =new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', () => reject(new Error('could not connect to the browser')), { once: true }); });
    const cdp = new Cdp(ws);
    const pages = [];
    return {
      exe, folder: folder.dir, pid: child.pid,
      async newPage(viewport = { width: 1536, height: 730, mobile: false }) {
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        const page = new Page(cdp, sessionId, targetId, viewport);
        await page.init();
        pages.push(page);
        return page;
      },
      async close() { try { ws.close(); } catch { /* closed */ } try { await stop(); } finally { lock.release(); } },
    };
  } catch (e) { await stop(); throw e; }
}
