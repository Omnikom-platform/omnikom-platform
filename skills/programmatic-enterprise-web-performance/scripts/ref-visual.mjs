// REF-009 visual equivalence (shipgate packs/refactor.md): screenshots of every route group before and after a change, at the
// baseline viewports, compared with pixelmatch semantics (YIQ threshold 0.1, anti-aliased pixels not counted), the share of
// differing pixels against visual.maxDiffRatio, dynamic regions masked. No npm packages: real Chrome over the DevTools protocol
// (cdp-measure.mjs's launchBrowser) takes the screenshots, Node's zlib decodes and encodes the PNGs, the diff is plain JS.
//
// Usage: node ref-visual.mjs capture (--site <built folder> | --origin <url> --allow-remote) --out <dir>
//             [--viewports mobile,desktop] [--mask "<css selector>"]... [--max-groups 40] [--paths /a/,/b/] [--like <manifest.json>]
//             [--allow-external] [--gap-ms 4000]
//        node ref-visual.mjs diff <before dir> <after dir> [--max-diff-ratio 0.001] [--allow "<route group>=<ratio>"]... [--allow-file f.json]
//             [--out <dir>] [--threshold 0.1] [--include-aa]
//        node ref-visual.mjs compare --before-site <dir> --after-site <dir> --out <dir> [capture and diff options]
//   A route group is a template family (families.mjs: 3+ pages of one skeleton and URL shape; its first page by path is the
//   screenshot) or a one-off page. A folder is served from 127.0.0.1 by this script; requests to other hosts are refused
//   (a screenshot must not depend on, or load, the open web) unless --allow-external.
//   Viewports follow 03 section 10: mobile 390x844 at DPR 3, desktop 1366x768 at DPR 1; full page, fonts loaded, animations off.
//   --allow takes a route group (its path) and the maxDiffRatio a `visual` entry of refactor.json would give it.
// Exit: 0 PASS, 1 FAIL (a route group differs more than allowed, or changed size without an allowance), 2 usage, 3 BLOCKED
//   (no Chrome, or Chrome failed).
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import { numArg, politeMs, MIN_GAP_MS, POLITE_GAP_MS } from "./lib-polite.mjs";
import path from "node:path";
import zlib from "node:zlib";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchBrowser, CHROME_PATH } from "./cdp-measure.mjs";
import { groupFamilies, unitsFor } from "./families.mjs";

export const VIEWPORTS = {
  mobile: { width: 390, height: 844, dpr: 3, mobile: true },
  desktop: { width: 1366, height: 768, dpr: 1, mobile: false },
};
export const DEFAULT_MAX_DIFF_RATIO = 0.001;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, "latin1"); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

// 8-bit PNGs of colour type 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha), 6 (RGBA), not interlaced: everything Chrome writes.
export function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, plte = null, trns = null; const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("latin1", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === "PLTE") plte = data; else if (type === "tRNS") trns = data; else if (type === "IDAT") idat.push(data); else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || ![0, 2, 3, 4, 6].includes(ctype)) throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${ctype}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]; const stride = w * ch;
  const inf = zlib.inflateSync(Buffer.concat(idat));
  if (inf.length < (stride + 1) * h) throw new Error("PNG data is truncated");
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride); const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ft = inf[y * (stride + 1)], line = inf.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0; let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (ft !== 0) throw new Error(`bad PNG filter ${ft}`);
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ctype === 6) { out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3]; }
      else if (ctype === 2) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255; }
      else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = cur[x]; out[o + 3] = 255; }
      else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = cur[x * 2]; out[o + 3] = cur[x * 2 + 1]; }
      else { const k = cur[x]; out[o] = plte[k * 3]; out[o + 1] = plte[k * 3 + 1]; out[o + 2] = plte[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    }
    cur.copy(prev);
  }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------- pixel diff (port of pixelmatch's algorithm)
const blend = (c, a) => 255 + (c - 255) * a;
const rgb2y = (r, g, b) => r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
const rgb2i = (r, g, b) => r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
const rgb2q = (r, g, b) => r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
function colorDelta(a, b, k, m, yOnly) {
  let r1 = a[k], g1 = a[k + 1], b1 = a[k + 2], a1 = a[k + 3], r2 = b[m], g2 = b[m + 1], b2 = b[m + 2], a2 = b[m + 3];
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;
  if (a1 < 255) { a1 /= 255; r1 = blend(r1, a1); g1 = blend(g1, a1); b1 = blend(b1, a1); }
  if (a2 < 255) { a2 /= 255; r2 = blend(r2, a2); g2 = blend(g2, a2); b2 = blend(b2, a2); }
  const y1 = rgb2y(r1, g1, b1), y2 = rgb2y(r2, g2, b2), y = y1 - y2;
  if (yOnly) return y;
  const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2), q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
  return y1 > y2 ? -delta : delta;
}
function hasManySiblings(img, x1, y1, w, h) {
  const x0 = Math.max(x1 - 1, 0), y0 = Math.max(y1 - 1, 0), x2 = Math.min(x1 + 1, w - 1), y2 = Math.min(y1 + 1, h - 1), pos = (y1 * w + x1) * 4;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
  for (let x = x0; x <= x2; x++) for (let y = y0; y <= y2; y++) {
    if (x === x1 && y === y1) continue;
    const p2 = (y * w + x) * 4;
    if (img[pos] === img[p2] && img[pos + 1] === img[p2 + 1] && img[pos + 2] === img[p2 + 2] && img[pos + 3] === img[p2 + 3]) zeroes++;
    if (zeroes > 2) return true;
  }
  return false;
}
function antialiased(img, x1, y1, w, h, img2) {
  const x0 = Math.max(x1 - 1, 0), y0 = Math.max(y1 - 1, 0), x2 = Math.min(x1 + 1, w - 1), y2 = Math.min(y1 + 1, h - 1), pos = (y1 * w + x1) * 4;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0, min = 0, max = 0, minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (let x = x0; x <= x2; x++) for (let y = y0; y <= y2; y++) {
    if (x === x1 && y === y1) continue;
    const d = colorDelta(img, img, pos, (y * w + x) * 4, true);
    if (d === 0) { zeroes++; if (zeroes > 2) return false; }
    else if (d < min) { min = d; minX = x; minY = y; }
    else if (d > max) { max = d; maxX = x; maxY = y; }
  }
  if (min === 0 || max === 0) return false;
  return (hasManySiblings(img, minX, minY, w, h) && hasManySiblings(img2, minX, minY, w, h)) || (hasManySiblings(img, maxX, maxY, w, h) && hasManySiblings(img2, maxX, maxY, w, h));
}
function pad(img, W, H) {
  if (img.width === W && img.height === H) return img.data;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < img.height; y++) out.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), y * W * 4);
  return out;
}
// -> { width, height, diffPixels, aaPixels, ratio, mask (0 same, 1 differs, 2 anti-aliased and not counted), sizeChanged }
// When the sizes differ both images are padded at the right and bottom with transparent pixels to the larger size and
// every padded pixel counts as differing (REF-009).
export function pixelDiff(a, b, { threshold = 0.1, includeAA = false } = {}) {
  const W = Math.max(a.width, b.width), H = Math.max(a.height, b.height), sizeChanged = a.width !== b.width || a.height !== b.height;
  const da = pad(a, W, H), db = pad(b, W, H); const mask = new Uint8Array(W * H); const maxDelta = 35215 * threshold * threshold;
  let diff = 0, aa = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, pos = i * 4;
    if (x >= a.width || y >= a.height || x >= b.width || y >= b.height) { mask[i] = 1; diff++; continue; }
    if (da[pos] === db[pos] && da[pos + 1] === db[pos + 1] && da[pos + 2] === db[pos + 2] && da[pos + 3] === db[pos + 3]) continue;
    const delta = colorDelta(da, db, pos, pos, false);
    if (Math.abs(delta) > maxDelta) {
      if (!includeAA && (antialiased(da, x, y, W, H, db) || antialiased(db, x, y, W, H, da))) { mask[i] = 2; aa++; }
      else { mask[i] = 1; diff++; }
    }
  }
  return { width: W, height: H, diffPixels: diff, aaPixels: aa, ratio: W * H ? diff / (W * H) : 0, mask, sizeChanged };
}
// Connected blocks of differing pixels -> boxes, biggest first (pixels of the diff image; divide by DPR for CSS pixels).
export function regionsOf(d, { block = 16, top = 10 } = {}) {
  const bw = Math.ceil(d.width / block), bh = Math.ceil(d.height / block), cnt = new Uint32Array(bw * bh);
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if (d.mask[y * d.width + x] === 1) cnt[Math.floor(y / block) * bw + Math.floor(x / block)]++;
  const seen = new Uint8Array(bw * bh), out = [];
  for (let s = 0; s < cnt.length; s++) {
    if (!cnt[s] || seen[s]) continue;
    let x0 = bw, y0 = bh, x1 = 0, y1 = 0, px = 0; const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const c = stack.pop(), cx = c % bw, cy = (c - cx) / bw; px += cnt[c];
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const n = ny * bw + nx; if (cnt[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    out.push({ x: x0 * block, y: y0 * block, w: Math.min(d.width, (x1 + 1) * block) - x0 * block, h: Math.min(d.height, (y1 + 1) * block) - y0 * block, pixels: px });
  }
  return out.sort((p, q) => q.pixels - p.pixels).slice(0, top);
}
export function diffImage(d, a) {
  const out = new Uint8Array(d.width * d.height * 4); const base = pad(a, d.width, d.height);
  for (let i = 0; i < d.width * d.height; i++) {
    const o = i * 4, m = d.mask[i];
    if (m === 1) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255; }
    else if (m === 2) { out[o] = 255; out[o + 1] = 200; out[o + 2] = 0; out[o + 3] = 255; }
    else { const g = Math.round(0.3 * base[o] + 0.59 * base[o + 1] + 0.11 * base[o + 2]); const v = 255 - Math.round((255 - g) * 0.25); out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255; }
  }
  return encodePng(out, d.width, d.height);
}

// ---------------------------------------------------------------- route groups of a built folder
const SKIP_DIRS = new Set(["node_modules", ".git", ".checks", ".pewp", ".wrangler"]);
function htmlFiles(root) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name)); } else if (/\.html?$/i.test(e.name)) out.push(path.relative(root, path.join(d, e.name)).replace(/\\/g, "/")); } };
  walk(root);
  return out.sort();
}
export const urlPathOf = (file) => { const p = "/" + file.replace(/(^|\/)index\.html?$/i, "$1"); return p === "" ? "/" : p; };
// -> [{ routeGroup (the path that is screenshotted), kind: "family"|"page", label, members }]
export function discoverGroups(siteDir, { maxGroups = 40 } = {}) {
  const files = htmlFiles(siteDir);
  const units = unitsFor(siteDir, files);
  const { families } = groupFamilies(units);
  const inFamily = new Set(families.flatMap((f) => f.members));
  const groups = families.map((f) => ({ routeGroup: urlPathOf(f.members[0]), kind: "family", label: f.label, members: f.size }));
  for (const u of units) if (!inFamily.has(u.id)) groups.push({ routeGroup: urlPathOf(u.id), kind: "page", label: u.id, members: 1 });
  const seen = new Set();
  return groups.filter((g) => !seen.has(g.routeGroup) && seen.add(g.routeGroup)).sort((a, b) => (a.kind === b.kind ? a.routeGroup.localeCompare(b.routeGroup) : a.kind === "family" ? -1 : 1)).slice(0, maxGroups);
}

// ---------------------------------------------------------------- a small static server for a built folder
const MIME = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain", ".xml": "application/xml", ".mp4": "video/mp4" };
export function serveDir(dir) {
  const root = path.resolve(dir); const hits = [];
  const server = http.createServer((req, res) => {
    let p; try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400).end(); return; }
    hits.push(p);
    const base = path.join(root, p);
    const cands = [base, path.join(base, "index.html"), base + ".html"];
    const f = cands.find((c) => c.startsWith(root) && fs.existsSync(c) && fs.statSync(c).isFile());
    if (!f) { res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(f).on("error", () => res.destroy()).pipe(res); // a file that vanishes or is locked mid-read ends that response, not the server
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) })));
}

// ---------------------------------------------------------------- the screenshot
const NO_MOTION = `*,*::before,*::after{animation:none!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}`;
const INJECT = `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(NO_MOTION)}; const add = () => { if (document.documentElement) { document.documentElement.appendChild(s); return true; } return false; }; if (!add()) { const mo = new MutationObserver(() => { if (add()) mo.disconnect(); }); mo.observe(document, { childList: true }); } })();`;
const isLocal = (u) => { try { const x = new URL(u); return x.protocol === "data:" || x.protocol === "blob:" || x.protocol === "about:" || ["127.0.0.1", "localhost", "[::1]"].includes(x.hostname); } catch { return true; } };

// One full-page screenshot of `url` at a viewport. -> { png, cssWidth, cssHeight, truncated, status, blocked: [urls refused] }
export async function screenshotPage(browser, url, vp, { masks = [], allowExternal = false, timeoutMs = 30000 } = {}) {
  const { send, listeners } = browser;
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const blocked = []; let loaded = false, status = null;
  const on = (msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Page.loadEventFired") loaded = true;
    if (msg.method === "Network.responseReceived" && msg.params.type === "Document" && status === null) status = msg.params.response.status;
    if (msg.method === "Fetch.requestPaused") {
      const u = msg.params.request.url;
      if (allowExternal || isLocal(u)) send("Fetch.continueRequest", { requestId: msg.params.requestId }, sessionId).catch(() => {});
      else { blocked.push(u); send("Fetch.failRequest", { requestId: msg.params.requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => {}); }
    }
  };
  listeners.add(on);
  try {
    for (const d of ["Page.enable", "Network.enable", "Runtime.enable"]) await send(d, {}, sessionId);
    if (!allowExternal) await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
    await send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile }, sessionId);
    await send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
    await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 255, g: 255, b: 255, a: 1 } }, sessionId);
    await send("Page.addScriptToEvaluateOnNewDocument", { source: INJECT }, sessionId);
    await send("Page.navigate", { url }, sessionId);
    const t0 = Date.now();
    while (!loaded && Date.now() - t0 < timeoutMs) await sleep(100);
    if (!loaded) throw new Error(`the page did not finish loading within ${timeoutMs / 1000} s`);
    // fonts loaded; walk down the page once so images and reveal-on-scroll content are in (read-only: scrolling only), then back to the top
    await send("Runtime.evaluate", { expression: `(async () => { try { await document.fonts.ready; } catch {} const h = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0); for (let y = 0, n = 0; y < h() && n < 80; y += innerHeight, n++) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); await new Promise((r) => setTimeout(r, 250)); })()`, awaitPromise: true, returnByValue: true }, sessionId, 60000);
    if (masks.length) await send("Runtime.evaluate", { expression: `${JSON.stringify(masks)}.forEach((s) => { try { document.querySelectorAll(s).forEach((e) => e.style.setProperty('visibility', 'hidden', 'important')); } catch {} })`, returnByValue: true }, sessionId);
    const lm = await send("Page.getLayoutMetrics", {}, sessionId);
    const cs = lm.cssContentSize || lm.contentSize;
    const maxH = Math.floor(16384 / vp.dpr); // Chrome's texture limit, in device pixels
    const cssWidth = Math.max(1, Math.ceil(cs.width)), fullH = Math.max(1, Math.ceil(cs.height)), cssHeight = Math.min(fullH, maxH);
    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssWidth, height: cssHeight, scale: 1 } }, sessionId, 90000);
    return { png: Buffer.from(shot.data, "base64"), cssWidth, cssHeight, truncated: fullH > maxH ? { fullCssHeight: fullH, maxCssHeight: maxH } : null, status, blocked };
  } finally {
    listeners.delete(on);
    try { await send("Target.closeTarget", { targetId }, undefined, 10000); } catch {}
  }
}

const slug = (s) => (s.replace(/^\/|\/$/g, "").replace(/[^A-Za-z0-9._-]+/g, "__") || "home").slice(0, 100);
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
// Captures every route group at every viewport into outDir (PNG files + visual-manifest.json).
// groups: [{ routeGroup: "/path/", ... }] (default: discovered from siteDir). Give siteDir (served here) or origin (already running).
export async function captureSite({ siteDir = null, origin = null, outDir, groups = null, viewports = ["mobile", "desktop"], masks = [], maxGroups = 40, allowExternal = false, gapMs = 0, log = () => {} }) {
  if (!CHROME_PATH) return { status: "BLOCKED", reason: "no Chrome or Edge found", unblock: "Install Chrome or set CHROME_PATH." };
  if (!siteDir && !origin) throw new Error("captureSite needs siteDir or origin");
  fs.mkdirSync(outDir, { recursive: true });
  const srv = siteDir ? await serveDir(siteDir) : null; const base = srv ? srv.origin : origin.replace(/\/+$/, "");
  const gs = groups || (siteDir ? discoverGroups(siteDir, { maxGroups }) : [{ routeGroup: "/", kind: "page", label: "/", members: 1 }]);
  let browser; const shots = [];
  try {
    try { browser = await launchBrowser(); } catch (e) { return { status: "BLOCKED", reason: `Chrome did not start: ${e.message}`, unblock: "Close other Chrome automation, then run again." }; }
    for (const g of gs) for (const vn of viewports) {
      const vp = VIEWPORTS[vn]; if (!vp) throw new Error(`unknown viewport ${vn}`);
      if (gapMs && shots.length) await sleep(gapMs);
      const entry = { routeGroup: g.routeGroup, kind: g.kind, label: g.label, members: g.members, viewport: vn, url: base + g.routeGroup };
      try {
        const s = await screenshotPage(browser, entry.url, vp, { masks, allowExternal });
        const file = `${slug(g.routeGroup)}-${vn}.png`; fs.writeFileSync(path.join(outDir, file), s.png);
        const dec = decodePng(s.png);
        Object.assign(entry, { file, width: dec.width, height: dec.height, cssWidth: s.cssWidth, cssHeight: s.cssHeight, dpr: vp.dpr, httpStatus: s.status, truncated: s.truncated, externalBlocked: s.blocked.length, sha1: sha1(s.png) });
        log(`shot ${g.routeGroup} ${vn} ${dec.width}x${dec.height}${s.status && s.status !== 200 ? ` (HTTP ${s.status})` : ""}`);
      } catch (e) { entry.error = e.message; log(`shot ${g.routeGroup} ${vn} FAILED: ${e.message}`); }
      shots.push(entry);
    }
  } finally { try { await browser?.close(); } catch {} try { await srv?.close(); } catch {} }
  const manifest = { rule: "REF-009", capturedAt: new Date().toISOString(), source: siteDir ? path.resolve(siteDir) : origin, viewports, masks, allowExternal, groups: gs, shots };
  fs.writeFileSync(path.join(outDir, "visual-manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  return { status: "ok", manifest, outDir };
}

// ---------------------------------------------------------------- compare two captures
export function compareCaptures(beforeDir, afterDir, { maxDiffRatio = DEFAULT_MAX_DIFF_RATIO, allow = {}, outDir = null, threshold = 0.1, includeAA = false } = {}) {
  const rd = (d) => JSON.parse(fs.readFileSync(path.join(d, "visual-manifest.json"), "utf8"));
  const B = rd(beforeDir), Af = rd(afterDir); const results = [];
  const afterBy = new Map(Af.shots.map((s) => [`${s.routeGroup}|${s.viewport}`, s]));
  if (outDir) fs.mkdirSync(path.join(outDir, "diff"), { recursive: true });
  for (const b of B.shots) {
    const a = afterBy.get(`${b.routeGroup}|${b.viewport}`); const allowed = allow[b.routeGroup];
    const limit = allowed != null ? allowed : maxDiffRatio;
    const r = { routeGroup: b.routeGroup, viewport: b.viewport, kind: b.kind, members: b.members, allowed: allowed != null ? allowed : null, limit };
    if (b.error) { r.verdict = "BLOCKED"; r.finding = "baseline-shot-failed"; r.detail = `the before screenshot failed: ${b.error}`; results.push(r); continue; }
    if (!a || a.error) { r.verdict = "FAIL"; r.finding = "status-mismatch"; r.detail = a ? `the after page could not be captured: ${a.error}` : "the route group is missing from the after capture"; results.push(r); continue; }
    if (a.httpStatus !== b.httpStatus) { r.verdict = "FAIL"; r.finding = "status-mismatch"; r.detail = `HTTP ${b.httpStatus} before, ${a.httpStatus} after`; results.push(r); continue; }
    const ia = decodePng(fs.readFileSync(path.join(beforeDir, b.file))), ib = decodePng(fs.readFileSync(path.join(afterDir, a.file)));
    r.sizeBefore = `${ia.width}x${ia.height}`; r.sizeAfter = `${ib.width}x${ib.height}`;
    if ((ia.width !== ib.width || ia.height !== ib.height) && allowed == null) { r.verdict = "FAIL"; r.finding = "visual-diff"; r.detail = `the page changed size: ${r.sizeBefore} before, ${r.sizeAfter} after (device pixels); a size change needs a visual entry whatever the pixels`; results.push(r); continue; }
    const d = pixelDiff(ia, ib, { threshold, includeAA });
    r.diffPixels = d.diffPixels; r.aaPixels = d.aaPixels; r.ratio = d.ratio; r.sizeChanged = d.sizeChanged;
    r.regions = regionsOf(d).map((g) => ({ ...g, cssX: Math.round(g.x / b.dpr), cssY: Math.round(g.y / b.dpr), cssW: Math.round(g.w / b.dpr), cssH: Math.round(g.h / b.dpr) }));
    if (d.ratio > limit) {
      r.verdict = "FAIL"; r.finding = "visual-diff"; r.detail = `${(d.ratio * 100).toFixed(3)}% of pixels differ (${d.diffPixels}), over the ${(limit * 100).toFixed(3)}% allowed`;
      if (outDir) { const f = `${slug(b.routeGroup)}-${b.viewport}-diff.png`; fs.writeFileSync(path.join(outDir, "diff", f), diffImage(d, ia)); r.diffImage = `diff/${f}`; }
    } else { r.verdict = "PASS"; r.detail = `${(d.ratio * 100).toFixed(3)}% differ (${d.diffPixels} px), within ${(limit * 100).toFixed(3)}%`; }
    results.push(r);
  }
  const fails = results.filter((r) => r.verdict === "FAIL"), blockedN = results.filter((r) => r.verdict === "BLOCKED");
  const status = fails.length ? "FAIL" : blockedN.length ? "BLOCKED" : results.length ? "PASS" : "BLOCKED";
  const out = { rule: "REF-009", comparedAt: new Date().toISOString(), before: path.resolve(beforeDir), after: path.resolve(afterDir), maxDiffRatio, threshold, includeAA, status, counts: { checked: results.length, pass: results.filter((r) => r.verdict === "PASS").length, fail: fails.length, blocked: blockedN.length }, results };
  if (!results.length) out.reason = "the baseline capture has no screenshots";
  if (outDir) { fs.writeFileSync(path.join(outDir, "visual-diff.json"), JSON.stringify(out, null, 1) + "\n"); fs.writeFileSync(path.join(outDir, "visual-diff.md"), visualMarkdown(out)); }
  return out;
}
export function visualMarkdown(v) {
  const L = [`# Visual equivalence (REF-009): ${v.status}`, "", `${v.counts.pass} of ${v.counts.checked} route-group screenshots match (${v.counts.fail} differ, ${v.counts.blocked} could not be judged). Allowed difference: ${(v.maxDiffRatio * 100).toFixed(3)}% of pixels unless a route group has its own entry. Pixel rule: pixelmatch (YIQ threshold ${v.threshold}, anti-aliased pixels not counted).`, ""];
  for (const r of v.results.filter((x) => x.verdict !== "PASS")) {
    L.push(`- ${r.verdict} ${r.routeGroup} (${r.viewport}) [${r.finding}]: ${r.detail}${r.diffImage ? `; picture ${r.diffImage}` : ""}`);
    for (const g of (r.regions || []).slice(0, 5)) L.push(`  - changed region at x ${g.cssX}, y ${g.cssY}, ${g.cssW} x ${g.cssH} (CSS px): ${g.pixels} px`);
  }
  if (!v.results.some((x) => x.verdict !== "PASS")) L.push("Nothing differs beyond the allowance.");
  return L.join("\n") + "\n";
}
// "path=0.02" pairs -> { path: 0.02 }
export function parseAllow(list = [], file = null) {
  const out = {};
  for (const x of list) { const i = x.lastIndexOf("="); if (i < 1 || !(Number(x.slice(i + 1)) >= 0)) throw new Error(`--allow wants "<route group>=<ratio>", got "${x}"`); out[x.slice(0, i)] = Number(x.slice(i + 1)); }
  if (file) { const j = JSON.parse(fs.readFileSync(file, "utf8")); for (const e of Array.isArray(j) ? j : j.allowedChanges || []) if (e.kind === "visual" && e.routeGroup) out[e.routeGroup] = e.maxDiffRatio ?? DEFAULT_MAX_DIFF_RATIO; }
  return out;
}
// The whole proof for two folders: capture the before folder's groups, capture the same URLs on the after folder, compare.
export async function compareSites({ beforeSite, afterSite, outDir, viewports, masks, maxGroups, maxDiffRatio, allow, threshold, includeAA, log = () => {} }) {
  const b = await captureSite({ siteDir: beforeSite, outDir: path.join(outDir, "before"), viewports, masks, maxGroups, log });
  if (b.status !== "ok") return b;
  const a = await captureSite({ siteDir: afterSite, outDir: path.join(outDir, "after"), groups: b.manifest.groups, viewports, masks, log });
  if (a.status !== "ok") return a;
  return { status: "ok", visual: compareCaptures(path.join(outDir, "before"), path.join(outDir, "after"), { maxDiffRatio, allow, outDir, threshold, includeAA }) };
}

// ---------------------------------------------------------------- CLI
if (isMain(import.meta.url)) {
  const A = process.argv.slice(2); const cmd = A[0];
  const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d); const all = (k) => A.flatMap((x, i) => (x === k ? [A[i + 1]] : []));
  const usage = () => { console.error("usage: node ref-visual.mjs capture --site <dir> | --origin <url> --allow-remote --out <dir> [...] | diff <before> <after> [...] | compare --before-site <dir> --after-site <dir> --out <dir> [...]"); process.exit(2); };
  const log = (m) => console.log(m);
  const vps = (opt("--viewports", "mobile,desktop") || "").split(",").filter(Boolean);
  try {
    if (cmd === "capture") {
      const out = opt("--out"); if (!out || (!opt("--site") && !opt("--origin"))) usage();
      if (opt("--origin") && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(opt("--origin")) && !A.includes("--allow-remote")) { console.error("REFUSED: --origin is not a local address. A remote site is only captured with --allow-remote (one page at a time, --gap-ms apart; never a client's live site without the owner's say)."); process.exit(2); }
      let groups = null;
      if (opt("--like")) groups = JSON.parse(fs.readFileSync(opt("--like"), "utf8")).groups;
      else if (opt("--paths")) groups = opt("--paths").split(",").filter(Boolean).map((p) => ({ routeGroup: p, kind: "page", label: p, members: 1 }));
      const r = await captureSite({ siteDir: opt("--site"), origin: opt("--origin"), outDir: path.resolve(out), groups, viewports: vps, masks: all("--mask"), maxGroups: numArg("--max-groups", opt("--max-groups"), { present: A.includes("--max-groups"), def: 40, min: 1, int: true }), allowExternal: A.includes("--allow-external"), gapMs: politeMs("--gap-ms", numArg("--gap-ms", opt("--gap-ms"), { present: A.includes("--gap-ms"), def: opt("--origin") ? POLITE_GAP_MS : 0 }), [opt("--origin")], MIN_GAP_MS), log });
      if (r.status !== "ok") { console.log(`BLOCKED: ${r.reason}. Unblocks: ${r.unblock}`); process.exit(3); }
      const failed = r.manifest.shots.filter((s) => s.error).length;
      console.log(`captured ${r.manifest.shots.length - failed} of ${r.manifest.shots.length} screenshots into ${path.resolve(out)}`);
      process.exit(failed ? 1 : 0);
    } else if (cmd === "diff") {
      if (!A[1] || !A[2]) usage();
      const out = opt("--out") ? path.resolve(opt("--out")) : null;
      const v = compareCaptures(path.resolve(A[1]), path.resolve(A[2]), { maxDiffRatio: Number(opt("--max-diff-ratio", DEFAULT_MAX_DIFF_RATIO)), allow: parseAllow(all("--allow"), opt("--allow-file")), outDir: out, threshold: Number(opt("--threshold", 0.1)), includeAA: A.includes("--include-aa") });
      console.log(visualMarkdown(v)); process.exit(v.status === "PASS" ? 0 : v.status === "FAIL" ? 1 : 3);
    } else if (cmd === "compare") {
      if (!opt("--before-site") || !opt("--after-site") || !opt("--out")) usage();
      const r = await compareSites({ beforeSite: opt("--before-site"), afterSite: opt("--after-site"), outDir: path.resolve(opt("--out")), viewports: vps, masks: all("--mask"), maxGroups: numArg("--max-groups", opt("--max-groups"), { present: A.includes("--max-groups"), def: 40, min: 1, int: true }), maxDiffRatio: Number(opt("--max-diff-ratio", DEFAULT_MAX_DIFF_RATIO)), allow: parseAllow(all("--allow"), opt("--allow-file")), threshold: Number(opt("--threshold", 0.1)), includeAA: A.includes("--include-aa"), log });
      if (r.status !== "ok") { console.log(`BLOCKED: ${r.reason}. Unblocks: ${r.unblock}`); process.exit(3); }
      console.log(visualMarkdown(r.visual)); process.exit(r.visual.status === "PASS" ? 0 : r.visual.status === "FAIL" ? 1 : 3);
    } else usage();
  } catch (e) { console.error(`ERROR ${e.message}`); process.exit(2); }
}
