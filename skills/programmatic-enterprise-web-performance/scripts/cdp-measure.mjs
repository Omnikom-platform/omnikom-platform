// Browser half of snapshot-site.mjs: drives a real headless Chrome over the DevTools protocol (Node's
// built-in WebSocket, no installs) and measures one page the way a lab test does: phone screen, slow
// network and 4x slower CPU applied, cache off. Returns lab vitals (LCP, CLS, TBT, FCP, TTFB), every
// network request (status, type, bytes, host), console errors, any 429, and a summary of the rendered
// page (title, meta, headings, images, links, structured data, forms, iframes, accessibility basics).
// Read-only: it loads pages, never clicks, types or submits.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean).find((p) => fs.existsSync(p));
export const CHROME_PATH = CHROME;

export const PROFILES = {
  // Lighthouse's mobile preset values (slow 4G, 4x CPU), applied in the browser rather than simulated.
  mobile: { width: 412, height: 823, dpr: 1.75, mobile: true, latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4 },
  desktop: { width: 1350, height: 940, dpr: 1, mobile: false, latency: 40, down: (10 * 1024 * 1024) / 8, up: (10 * 1024 * 1024) / 8, cpu: 1 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchBrowser() {
  if (!CHROME) throw new Error("no Chrome or Edge found (set CHROME_PATH)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--mute-audio", "about:blank"],
    { stdio: "ignore", windowsHide: true });
  // Chrome may hold its profile files for a moment after it exits: retry the removal (EBUSY/EPERM) instead of leaving temp folders.
  const removeDir = () => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} };
  proc.on("error", () => {}); // a start failure shows as "no DevTools port" below, never as an unhandled error event
  const giveUp = async (msg) => { try { proc.kill(); } catch {} await sleep(300); removeDir(); throw new Error(msg); };
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0].trim(); } catch {}
  }
  if (!port) await giveUp("Chrome did not open its DevTools port");
  // The handshake is bounded too (every Chrome command has a time limit; so does opening the connection).
  let ver;
  try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(15000) })).json(); }
  catch (e) { await giveUp(`Chrome did not answer /json/version within 15 s (${e.message})`); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let opened = true;
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("DevTools socket did not open within 15 s")), 15000);
    ws.onopen = () => { clearTimeout(t); res(); };
    ws.onerror = () => { clearTimeout(t); rej(new Error("DevTools socket failed")); };
  }).catch((e) => { opened = e.message; });
  if (opened !== true) { try { ws.close(); } catch {} await giveUp(opened); }
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (m) => {
    let msg;
    try { msg = JSON.parse(typeof m.data === "string" ? m.data : Buffer.from(m.data).toString("utf8")); } catch { return; } // one unreadable frame is dropped, not a crash
    if (!msg) return;
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(`${msg.error.message}`)) : res(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  // Nothing may wait forever: every command has a time limit, and a dropped connection fails everything pending.
  let dead = null;
  const failAll = (why) => { dead = why; for (const [, p] of pending) p.rej(new Error(why)); pending.clear(); };
  ws.onclose = () => failAll("Chrome connection closed");
  ws.onerror = () => failAll("Chrome connection error");
  proc.on("exit", () => failAll("Chrome exited"));
  const send = (method, params = {}, sessionId, timeoutMs = 45000) => new Promise((res, rej) => {
    if (dead) return rej(new Error(dead));
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`Chrome did not answer ${method} within ${timeoutMs / 1000} s`)); }, timeoutMs);
    pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
    try { ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); } catch (e) { clearTimeout(timer); pending.delete(id); rej(e); }
  });
  const close = async () => {
    try { await send("Browser.close", {}, undefined, 5000); } catch {}
    try { ws.close(); } catch {}
    await sleep(500);
    try { proc.kill(); } catch {}
    removeDir();
  };
  return { send, listeners, close, version: ver.Browser, userAgent: ver["User-Agent"] };
}

// Installed before any page script runs; collects the paint and layout entries the page produces.
const OBSERVERS = `(() => {
  const s = window.__pewp = { lcp: null, lcpEl: null, lcpUrl: null, cls: 0, longtasks: [], fcp: null };
  let win = 0, winStart = 0, last = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { s.lcp = e.startTime; s.lcpUrl = e.url || null;
    const el = e.element; s.lcpEl = el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')) : null; } })
    .observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue;
    if (win && e.startTime - last < 1000 && e.startTime - winStart < 5000) win += e.value; else { win = e.value; winStart = e.startTime; }
    last = e.startTime; if (win > s.cls) s.cls = win; } }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.longtasks.push([e.startTime, e.duration]); })
    .observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') s.fcp = e.startTime; })
    .observe({ type: 'paint', buffered: true }); } catch {}
})();`;

// Runs in the page after it settles: what a crawler and an auditor need from the rendered page.
const SUMMARY = `(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const attr = (s, a) => { const e = document.querySelector(s); return e ? e.getAttribute(a) : null; };
  const text = (e) => (e.innerText || e.textContent || '').replace(/\\s+/g, ' ').trim();
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
  const host = location.hostname.replace(/^www\\./, '');
  const links = q('a[href]').map((a) => ({ href: abs(a.getAttribute('href')), text: text(a).slice(0, 80), rel: a.rel || '',
    named: !!(text(a) || a.getAttribute('aria-label') || a.querySelector('img[alt]:not([alt=""])')) }));
  const internal = links.filter((l) => { try { return new URL(l.href).hostname.replace(/^www\\./, '') === host; } catch { return false; } });
  const ld = q('script[type="application/ld+json"]').map((s) => { try { const j = JSON.parse(s.textContent); return { ok: true, types: [].concat(j).flatMap((x) => x['@graph'] ? x['@graph'].map((g) => g['@type']) : [x['@type']]).flat(), bytes: s.textContent.length, json: s.textContent.length < 20000 ? j : '(over 20 KB, not copied)' }; } catch (e) { return { ok: false, error: String(e).slice(0, 120), bytes: s.textContent.length }; } });
  const imgs = q('img');
  const labelled = (el) => !!(el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || !!el.closest('label') || !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby') || !!el.getAttribute('title');
  return {
    url: location.href, lang: document.documentElement.getAttribute('lang'), title: document.title,
    metaDescription: attr('meta[name="description"]', 'content'), canonical: attr('link[rel="canonical"]', 'href'),
    robotsMeta: q('meta[name="robots"],meta[name="googlebot"]').map((m) => m.name + ': ' + m.content),
    viewport: attr('meta[name="viewport"]', 'content'),
    hreflang: q('link[rel="alternate"][hreflang]').map((l) => l.hreflang + ' ' + l.href),
    og: Object.fromEntries(q('meta[property^="og:"],meta[name^="twitter:"]').map((m) => [m.getAttribute('property') || m.name, (m.content || '').slice(0, 200)])),
    headings: q('h1,h2,h3').slice(0, 60).map((h) => h.tagName + ' ' + text(h).slice(0, 120)),
    h1Count: q('h1').length, words: text(document.body || document.documentElement).split(' ').length,
    images: { count: imgs.length, missingAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
      noSize: imgs.filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).length,
      lazy: imgs.filter((i) => i.loading === 'lazy').length,
      sample: imgs.slice(0, 40).map((i) => ({ src: (i.currentSrc || i.src || '').slice(0, 200), alt: i.getAttribute('alt'), w: i.getAttribute('width'), h: i.getAttribute('height'),
        loading: i.getAttribute('loading'), fetchpriority: i.getAttribute('fetchpriority'), natural: i.naturalWidth + 'x' + i.naturalHeight, shown: Math.round(i.getBoundingClientRect().width) + 'x' + Math.round(i.getBoundingClientRect().height) })) },
    links: { total: links.length, internal: internal.length, external: links.length - internal.length, unnamed: links.filter((l) => !l.named).length,
      nofollow: links.filter((l) => /nofollow/.test(l.rel)).length, internalSample: [...new Set(internal.map((l) => l.href))].slice(0, 80) },
    structuredData: ld,
    forms: q('form').map((f) => ({ action: f.getAttribute('action'), method: f.getAttribute('method'),
      fields: [...f.elements].filter((e) => e.name || e.id).slice(0, 25).map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type, name: e.name || e.id, required: e.required, autocomplete: e.getAttribute('autocomplete'), labelled: labelled(e) })) })),
    unlabelledInputs: q('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea').filter((e) => !labelled(e)).length,
    unnamedButtons: q('button,[role=button]').filter((b) => !text(b) && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby') && !b.getAttribute('title')).length,
    landmarks: { header: q('header,[role=banner]').length, nav: q('nav,[role=navigation]').length, main: q('main,[role=main]').length, footer: q('footer,[role=contentinfo]').length },
    iframes: q('iframe').map((f) => ({ src: (f.src || '').slice(0, 160), title: f.title || null, w: f.getAttribute('width'), h: f.getAttribute('height'), loading: f.getAttribute('loading') })),
    videos: q('video').map((v) => ({ src: (v.currentSrc || '').slice(0, 160), autoplay: v.autoplay, muted: v.muted, poster: !!v.poster, w: v.getAttribute('width'), h: v.getAttribute('height') })),
    scripts: { inline: q('script:not([src])').length, external: q('script[src]').map((s) => s.src.slice(0, 200)) },
    fonts: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))],
    domNodes: document.getElementsByTagName('*').length, htmlBytes: document.documentElement.outerHTML.length,
  };
})()`;

export async function measurePage(browser, url, { profile = "mobile", timeoutMs = 60000, quietMs = 3000 } = {}) {
  const P = PROFILES[profile];
  const { send, listeners } = browser;
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const reqs = new Map();
  const errors = [];
  let loaded = false;
  let lastNet = Date.now();
  const on = (msg) => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params;
    switch (msg.method) {
      case "Network.requestWillBeSent":
        lastNet = Date.now();
        reqs.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type, start: p.timestamp, redirectedFrom: p.redirectResponse ? p.redirectResponse.status : undefined, done: false });
        break;
      case "Network.responseReceived": {
        const r = reqs.get(p.requestId); if (!r) break;
        Object.assign(r, { status: p.response.status, mime: p.response.mimeType, protocol: p.response.protocol, fromCache: p.response.fromDiskCache || p.response.fromServiceWorker,
          encoding: (p.response.headers["content-encoding"] || p.response.headers["Content-Encoding"] || "") || undefined,
          cacheControl: p.response.headers["cache-control"] || p.response.headers["Cache-Control"] });
        if (p.type === "Document" && !r.headers) r.headers = p.response.headers;
        lastNet = Date.now(); break;
      }
      case "Network.loadingFinished": { const r = reqs.get(p.requestId); if (r) { r.bytes = p.encodedDataLength; r.done = true; } lastNet = Date.now(); break; }
      case "Network.loadingFailed": { const r = reqs.get(p.requestId); if (r) { r.failed = p.errorText; r.blocked = p.blockedReason; r.done = true; } lastNet = Date.now(); break; }
      case "Page.loadEventFired": loaded = true; break;
      case "Runtime.exceptionThrown": errors.push({ kind: "exception", text: (p.exceptionDetails.exception?.description || p.exceptionDetails.text || "").slice(0, 300) }); break;
      case "Runtime.consoleAPICalled": if (p.type === "error") errors.push({ kind: "console.error", text: p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300) }); break;
      case "Log.entryAdded": if (p.entry.level === "error") errors.push({ kind: `log.${p.entry.source}`, text: `${p.entry.text} ${p.entry.url || ""}`.slice(0, 300) }); break;
    }
  };
  listeners.add(on);
  const t0 = Date.now();
  try {
    for (const d of ["Network.enable", "Page.enable", "Runtime.enable", "Log.enable"]) await send(d, {}, sessionId);
    await send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: P.width, height: P.height, deviceScaleFactor: P.dpr, mobile: P.mobile }, sessionId);
    if (P.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true }, sessionId);
    if (P.mobile) await send("Network.setUserAgentOverride", { userAgent: browser.userAgent.replace(/\(Windows[^)]*\)|\(Macintosh[^)]*\)|\(X11[^)]*\)/, "(Linux; Android 11; moto g power (2022))") + " Mobile" }, sessionId);
    await send("Network.emulateNetworkConditions", { offline: false, latency: P.latency, downloadThroughput: P.down, uploadThroughput: P.up }, sessionId);
    await send("Emulation.setCPUThrottlingRate", { rate: P.cpu }, sessionId);
    await send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVERS }, sessionId);
    await send("Page.navigate", { url }, sessionId);
    while (Date.now() - t0 < timeoutMs) {
      await sleep(250);
      const inflight = [...reqs.values()].filter((r) => !r.done).length;
      if (loaded && inflight <= 2 && Date.now() - lastNet > quietMs) break;
    }
    const timedOut = !loaded;
    await send("Emulation.setCPUThrottlingRate", { rate: 1 }, sessionId);
    const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true }, sessionId, 20000)).result.value;
    const v = await ev(`(() => { const s = window.__pewp || {}; const n = performance.getEntriesByType('navigation')[0] || {};
      const fcp = s.fcp || 0; const tbt = (s.longtasks || []).filter(([st]) => st >= fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
      return { lcpMs: s.lcp, lcpElement: s.lcpEl, lcpUrl: s.lcpUrl, cls: s.cls, tbtMs: Math.round(tbt), fcpMs: s.fcp, longTasks: (s.longtasks || []).length,
        ttfbMs: n.responseStart ? Math.round(n.responseStart - (n.startTime || 0)) : null, domContentLoadedMs: Math.round(n.domContentLoadedEventEnd || 0), loadMs: Math.round(n.loadEventEnd || 0) }; })()`);
    const page = await ev(SUMMARY);
    // Service workers the page registered (REF-013 needs them; a call inside a bundle is invisible to static reading).
    let serviceWorkers = [];
    try {
      serviceWorkers = (await send("Runtime.evaluate", { expression: "navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then((rs) => rs.map((r) => ({ scope: r.scope, scriptURL: (r.active || r.waiting || r.installing || {}).scriptURL || null }))) : []", awaitPromise: true, returnByValue: true }, sessionId, 20000)).result.value || [];
    } catch {}
    const list = [...reqs.values()];
    const docHost = new URL(page.url).hostname.replace(/^www\./, "");
    const isThird = (u) => { try { const h = new URL(u).hostname.replace(/^www\./, ""); return !(h === docHost || h.endsWith("." + docHost)); } catch { return false; } };
    const byType = {};
    for (const r of list) { const k = r.type || "Other"; byType[k] = byType[k] || { count: 0, bytes: 0 }; byType[k].count++; byType[k].bytes += r.bytes || 0; }
    const thirdHosts = {};
    for (const r of list.filter((r) => isThird(r.url))) { const h = new URL(r.url).hostname; thirdHosts[h] = (thirdHosts[h] || 0) + (r.bytes || 0); }
    const doc = list.find((r) => r.type === "Document");
    return {
      url, finalUrl: page.url, profile, conditions: P, measuredAt: new Date().toISOString(), timedOut, wallMs: Date.now() - t0,
      vitals: v,
      document: doc ? { status: doc.status, protocol: doc.protocol, encoding: doc.encoding, bytes: doc.bytes, headers: doc.headers } : null,
      totals: { requests: list.length, bytes: list.reduce((a, r) => a + (r.bytes || 0), 0), thirdPartyRequests: list.filter((r) => isThird(r.url)).length,
        thirdPartyBytes: list.filter((r) => isThird(r.url)).reduce((a, r) => a + (r.bytes || 0), 0), byType, thirdPartyHosts: thirdHosts },
      status429: list.filter((r) => r.status === 429).map((r) => r.url),
      failed: list.filter((r) => r.failed || r.status >= 400).map((r) => ({ url: r.url.slice(0, 200), status: r.status, failed: r.failed, blocked: r.blocked })).slice(0, 60),
      uncompressedText: list.filter((r) => /Script|Stylesheet|Document|XHR|Fetch/.test(r.type || "") && r.status === 200 && !r.encoding && (r.bytes || 0) > 1400 && !r.fromCache).map((r) => r.url.slice(0, 200)).slice(0, 40),
      noCacheStatic: list.filter((r) => /Script|Stylesheet|Image|Font/.test(r.type || "") && r.status === 200 && !/max-age=[1-9]|immutable/.test(r.cacheControl || "")).map((r) => r.url.slice(0, 200)).slice(0, 40),
      // The 150 heaviest requests (the rest are counted in totals).
      requests: [...list].sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 150).map((r) => ({ url: r.url.slice(0, 200), type: r.type, status: r.status, bytes: r.bytes, protocol: r.protocol, encoding: r.encoding, cache: r.cacheControl, third: isThird(r.url) })),
      requestsOmitted: Math.max(0, list.length - 150),
      errors: errors.slice(0, 50),
      page,
      serviceWorkers,
    };
  } finally {
    listeners.delete(on);
    try { await send("Target.closeTarget", { targetId }, undefined, 10000); } catch {}
  }
}
