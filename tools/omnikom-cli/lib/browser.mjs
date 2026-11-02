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
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Blocked } from './errors.mjs';
import { importRepo } from './repo.mjs';

const WIN = process.platform === 'win32';
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

export async function launchBrowser({ env = process.env, spawnImpl = spawn, importer = importRepo } = {}) {
  const exe = findBrowser(env);
  const guard = await importer('tools/proc-guard/index.mjs');
  const folder = guard.guardedTemp('omnikom-jb-', 'journey-browser');   // cleaned on every exit path of this process
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${folder.dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'];
  const child = spawnImpl(exe, args, { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
  let closed = false;
  // kill the tree and everything naming the profile folder, then remove the folder; under load a late child can outlive the first pass,
  // so it is repeated until the folder is really gone (a folder that cannot be removed is a process that is still running)
  const stop = async () => {
    if (closed) return; closed = true;
    for (let i = 0; i < 8; i++) {
      try { guard.killTree(child.pid, folder.dir); } catch { /* already gone */ }
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
    for (let i = 0; i < 150 && !wsPath; i++) {
      if (existsSync(portFile)) { const [p, w] = readFileSync(portFile, 'utf8').split(/\r?\n/); if (p && w) { port = p; wsPath = w; } }
      if (!wsPath) await sleep(100);
    }
    if (!wsPath) throw new Error('the browser did not report its DevTools address in 15 s');
    const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
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
      async close() { try { ws.close(); } catch { /* closed */ } await stop(); },
    };
  } catch (e) { await stop(); throw e; }
}
