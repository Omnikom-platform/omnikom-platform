// Usage: node test-capture.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of the capture tooling (G5, G6, G20): capture-server.mjs (the 127.0.0.1 receiver), serp-capture.js (the page-side extractor, run
// here in a vm against a tiny DOM stub), and the importer's new device / localization / AI-source flags.
// Fixtures only. The only network is 127.0.0.1 (the receiver under test); no Google, no Bing, no model.
// Not proven here: the extractor's selectors against a live Google or Bing page (UNPROVEN until a real capture is read back).
// Mutants: break the code each assertion guards, expect it red, restore. Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));
const node = process.execPath;
const w = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === "string" ? o : JSON.stringify(o, null, 1)); };
const rj = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const TARGET = "https://example.test/";

const BUSINESS = { name: "Example Co", domain: "example.test", market: { country: "us", language: "en" }, rankTracking: { source: "browser-capture", locations: ["Tracy, CA"], devices: ["mobile"] } };
const org = (n = 6) => Array.from({ length: n }, (_, i) => ({ position: i + 1, url: `https://site${i + 1}.test/page`, title: `Result ${i + 1}` }));
const cap = (o = {}) => ({ query: "realtor in tracy ca", engine: "google", capturedAt: "2026-10-25T12:00:00Z", browser: "owner's Chrome", device: "mobile", language: "en", location: { requested: "Tracy, CA", footer: "Tracy, California - From your device", method: "uule parameter" }, organic: org(), localPack: [], paa: [], aiOverview: { present: false, text: "", sources: [] }, relatedSearches: [], robotCheck: false, notes: "", ...o });
const AI_CAP = { engine: "chatgpt", question: "who buys houses in tracy", prompt: "who buys houses in tracy", model: "as shown", capturedAt: "2026-10-25T12:00:00Z", browser: "owner's Chrome", location: "none stated", answer: "Several companies buy houses in Tracy.", sources: ["https://zillow.com/x"] };

const call = (port, method, p, { body, headers = {}, raw = false } = {}) => new Promise((resolve) => {
  const data = body == null ? null : Buffer.from(raw || typeof body === "string" ? body : JSON.stringify(body));
  const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...(data ? { "content-length": data.length, "content-type": "application/json" } : {}), ...headers } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let json = null; try { json = JSON.parse(t); } catch {} resolve({ status: res.statusCode, text: t, headers: res.headers, json }); });
  });
  r.on("error", (e) => resolve({ status: 0, text: String(e.message), headers: {}, json: null }));
  if (data) r.write(data);
  r.end();
});

function startReceiver(sdir, tmp, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [path.join(sdir, "capture-server.mjs"), TARGET, "--cwd", tmp, "--port", "0", ...extra], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const lines = [];
    child.stdout.on("data", (c) => {
      out += c;
      const m = out.match(/capture server on ([\d.]+):(\d+)/);
      if (m && !done) { done = true; resolve({ child, port: Number(m[2]), addr: m[1], lines, stop: () => new Promise((r) => { child.once("exit", r); child.kill(); setTimeout(r, 3000); }) }); }
      lines.splice(0, lines.length, ...out.split("\n").filter(Boolean));
    });
    child.stderr.on("data", (c) => (err += c));
    child.on("exit", (code) => { if (!done) reject(new Error(`receiver exited ${code} before listening: ${out} ${err}`)); });
    setTimeout(() => { if (!done) { child.kill(); reject(new Error(`receiver did not start in 10 s: ${out} ${err}`)); } }, 10_000);
  });
}

// ---- a small HTML parser + selector engine (stdlib only): enough to run serp-capture.js on the saved pages in fixtures/serp-html/
const VOID = new Set(["br", "hr", "img", "input", "meta", "link"]);
const BLOCK = new Set(["div", "p", "li", "ul", "ol", "h1", "h2", "h3", "h4", "section", "table", "tr", "br", "hr", "header", "footer", "article"]);
const decodeEnt = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[k]);
class El {
  constructor(tag, attrs = {}) { this.tag = tag.toLowerCase(); this.tagName = tag.toUpperCase(); this.attrs = attrs; this.kids = []; this.parentElement = null; this._clicks = 0; }
  get children() { return this.kids.filter((k) => k instanceof El); }
  get textContent() { return this.kids.map((k) => (k instanceof El ? k.textContent : k)).join(""); }
  get innerText() {
    const walk = (e) => e.kids.map((k) => (typeof k === "string" ? k : k.tag === "script" || k.tag === "style" ? "" : BLOCK.has(k.tag) ? `\n${walk(k)}\n` : walk(k))).join("");
    return walk(this).replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{2,}/g, "\n").trim();
  }
  get className() { return this.attrs.class || ""; }
  get id() { return this.attrs.id || ""; }
  get href() { return this.attrs.href || ""; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  click() { this._clicks++; }
  contains(o) { for (let p = o; p; p = p.parentElement) if (p === this) return true; return false; }
  closest(sel) { const S = parseSel(sel); for (let p = this; p && p.tag !== "#root"; p = p.parentElement) if (S.some((parts) => matchFrom(p, parts, parts.length - 1))) return p; return null; }
  querySelectorAll(sel) { const S = parseSel(sel), out = []; const walk = (e) => { for (const c of e.children) { if (S.some((parts) => matchFrom(c, parts, parts.length - 1))) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function parseCompound(t) {
  const c = { tag: (t.match(/^[a-z0-9*-]+/i) || [null])[0], id: null, cls: [], attrs: [] };
  const re = /#([\w-]+)|\.([\w-]+)|\[([\w:-]+)(?:([\^$*]?=)['"]?([^'"\]]*)['"]?)?\]/g; let m;
  while ((m = re.exec(t.replace(/^[a-z0-9*-]+/i, "")))) { if (m[1]) c.id = m[1]; else if (m[2]) c.cls.push(m[2]); else c.attrs.push({ name: m[3], op: m[4] || null, val: m[5] ?? null }); }
  return c;
}
function parseSel(sel) {
  return sel.split(",").map((part) => { const out = []; let comb = " "; for (const t of part.trim().match(/(?:[^\s>\[]|\[[^\]]*\])+|>/g) || []) { if (t === ">") { comb = ">"; continue; } out.push({ comb, c: parseCompound(t) }); comb = " "; } return out; });
}
function matchCompound(el, c) {
  if (c.tag && c.tag !== "*" && el.tag !== c.tag.toLowerCase()) return false;
  if (c.id && el.id !== c.id) return false;
  if (c.cls.length && !c.cls.every((k) => el.className.split(/\s+/).includes(k))) return false;
  return c.attrs.every((a) => { const v = el.getAttribute(a.name); if (v == null) return false; return a.op === "=" ? v === a.val : a.op === "^=" ? v.startsWith(a.val) : a.op === "*=" ? v.includes(a.val) : true; });
}
function matchFrom(el, parts, i) {
  if (!matchCompound(el, parts[i].c)) return false;
  if (i === 0) return true;
  if (parts[i].comb === ">") return !!el.parentElement && el.parentElement.tag !== "#root" && matchFrom(el.parentElement, parts, i - 1);
  for (let p = el.parentElement; p && p.tag !== "#root"; p = p.parentElement) if (matchFrom(p, parts, i - 1)) return true;
  return false;
}
function parseHtml(html) {
  const root = new El("#root"); let cur = root;
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z0-9-]+)\s*>|<([a-z0-9-]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi; let m;
  while ((m = re.exec(html))) {
    if (m[1]) { const t = m[1].toLowerCase(); if (VOID.has(t)) continue; for (let p = cur; p && p !== root; p = p.parentElement) if (p.tag === t) { cur = p.parentElement; break; } }
    else if (m[2]) {
      const attrs = {}; for (const a of (m[3] || "").matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] == null ? "" : decodeEnt(a[2]);
      const e = new El(m[2], attrs); e.parentElement = cur; cur.kids.push(e); if (!VOID.has(e.tag)) cur = e;
    } else if (m[4] != null) cur.kids.push(decodeEnt(m[4]).replace(/\s+/g, " "));
  }
  const html0 = root.querySelector("html"), body = root.querySelector("body");
  return { querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s), body, documentElement: { lang: html0?.getAttribute("lang") || "en" }, root };
}

// the extractor in a vm with a tiny DOM stub (selectors keyed by the exact strings the script uses)
function dom(over = {}) {
  const el = (o = {}) => ({ innerText: "", textContent: "", parentElement: null, _q: {}, closest() { return this._closest || null; }, querySelector(s) { return (this._q[s] || [])[0] || null; }, querySelectorAll(s) { return this._q[s] || []; }, contains(e) { return (this._has || []).includes(e); }, getAttribute(n) { return (this._attr || {})[n] ?? null; }, click() { this._clicks = (this._clicks || 0) + 1; if (this._onclick) this._onclick(); }, ...o });
  const link = (url) => ({ href: url });
  const h3 = (title, url) => el({ innerText: title, textContent: title, _closest: link(url) });
  const page = el();
  const doc = { body: el({ innerText: over.text || "results page" }), documentElement: { lang: "en" }, _q: page._q, querySelector: (s) => (page._q[s] || [])[0] || null, querySelectorAll: (s) => page._q[s] || [] };
  return { el, h3, link, page, doc };
}
function runExtractor(sdir, { search = "?q=realtor+in+tracy+ca&hl=en&gl=us", pathname = "/search", hostname = "www.google.com", width = 390, uaMobile = true, setup = () => {}, call: arg, fetchImpl, text, doc }) {
  const d = dom({ text });
  setup(d);
  const posts = [];
  const sb = {
    document: doc || d.doc, navigator: { userAgent: "Mozilla/5.0 Chrome/130 Safari/537", userAgentData: { mobile: uaMobile } }, location: { hostname, search, pathname },
    innerWidth: width, fetch: fetchImpl || (async (url, init) => { posts.push({ url, body: JSON.parse(init.body), method: init.method }); return { status: 200, ok: true, text: async () => JSON.stringify({ saved: "x.json" }) }; }),
    setTimeout, URL, URLSearchParams, atob: (s) => Buffer.from(s, "base64").toString("binary"), Promise,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(sdir, "serp-capture.js"), "utf8"), sb);
  return sb.__pewpCapture(arg).then((answer) => ({ answer, posts, sb, d }));
}

async function runScenarios(sdir, only = null) {
  const res = [];
  const check = (name, ok, detail = "") => res.push({ name, ok: !!ok, detail: String(detail) });
  const want = (g) => !only || only.includes(g);
  const tmpdirs = [];
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-capture-")); tmpdirs.push(d); return d; };
  const pewpOf = (t) => path.join(t, "site-checks", "example.test", ".pewp");
  const importer = (t, args = []) => spawnSync(node, [path.join(sdir, "research-serp-import.mjs"), TARGET, "--cwd", t, ...args], { encoding: "utf8", timeout: 60_000 });
  const serpOf = (t) => rj(path.join(pewpOf(t), "research", "serp.json"));

  // ------------------------------------------------ S: the receiver
  if (want("S")) {
    const t = tmp(); w(path.join(pewpOf(t), "business.json"), BUSINESS);
    const dir = path.join(pewpOf(t), "captures", "serp"), aiDir = path.join(pewpOf(t), "captures", "ai");
    const srv = await startReceiver(sdir, t);
    try {
      const { port } = srv;
      const ext = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
      let probe = "no external interface to probe";
      if (ext) { const r = await new Promise((resolve) => { const q = http.get({ host: ext.address, port, timeout: 2500 }, (x) => { x.resume(); resolve(`answered ${x.statusCode}`); }); q.on("error", (e) => resolve(`refused: ${e.code}`)); q.on("timeout", () => { q.destroy(); resolve("refused: timeout"); }); }); probe = r; }
      check("S1: the receiver listens on 127.0.0.1 only (startup line says so, and the machine's own network address is refused)", srv.addr === "127.0.0.1" && !/answered/.test(probe), `${srv.addr} | ${probe}`);

      const good = cap();
      const r1 = await call(port, "POST", "/save?file=realtor-in-tracy-ca.google.json", { body: good });
      const f1 = path.join(dir, "realtor-in-tracy-ca.google.json");
      check("S2: a valid capture -> 200 naming the saved path, the file holds exactly that capture", r1.status === 200 && r1.json?.saved && path.resolve(r1.json.saved) === path.resolve(f1) && fs.existsSync(f1) && JSON.stringify(rj(f1)) === JSON.stringify(good), `${r1.status} ${r1.text}`);

      const r2 = await call(port, "POST", "/save?file=realtor-in-tracy-ca.google.json", { body: cap({ organic: org(9) }) });
      check("S3: the same file name again within 45 s -> 429 'pace: at least 45 s between captures', the first file is kept", r2.status === 429 && r2.text === "pace: at least 45 s between captures" && rj(f1).organic.length === 6, `${r2.status} ${r2.text}`);

      const bad = cap(); delete bad.device;
      const r3 = await call(port, "POST", "/save?file=no-device.google.json", { body: bad });
      check("S4: a capture with no device -> 400 naming 'no device', and no file is written", r3.status === 400 && /no device/.test(r3.text) && r3.json?.problems?.some((p) => /no device/.test(p)) && !fs.existsSync(path.join(dir, "no-device.google.json")), `${r3.status} ${r3.text}`);

      const names = ["Bad_Name.google.json", "x.yahoo.json", "..%2Fevil.google.json", "plain.json", "x.google.json.exe"];
      const rn = []; for (const n of names) rn.push(await call(port, "POST", `/save?file=${n}`, { body: cap() }));
      const rnone = await call(port, "POST", "/save", { body: cap() });
      const before = fs.readdirSync(dir).sort().join();
      check("S5: a bad or missing file name -> 400 (letters, digits, hyphens, .google|bing.json only), nothing written", rn.every((x) => x.status === 400) && rnone.status === 400 && before === "realtor-in-tracy-ca.google.json", `${rn.map((x) => x.status)} ${rnone.status} ${before}`);

      const big = await call(port, "POST", "/save?file=big.google.json", { body: cap({ notes: "x".repeat(2_200_000) }) });
      check("S6: a body over 2 MB -> 413 and no file", big.status === 413 && !fs.existsSync(path.join(dir, "big.google.json")), `${big.status} ${big.text.slice(0, 100)}`);

      const st = await call(port, "GET", "/");
      check("S7: GET / answers a one-line status (count saved, uptime)", st.status === 200 && !st.text.trim().includes("\n") && /1 saved/.test(st.text) && /up \d+ s/.test(st.text), st.text);

      const mm = await call(port, "POST", "/save?file=wrong-engine.bing.json", { body: cap({ engine: "google" }) });
      check("S8: file name says bing but the capture says google -> 400, no file", mm.status === 400 && /name says bing/.test(mm.text) && !fs.existsSync(path.join(dir, "wrong-engine.bing.json")), `${mm.status} ${mm.text}`);

      const nj = await call(port, "POST", "/save?file=notjson.google.json", { body: "{nope", raw: true });
      check("S9: a body that is not JSON -> 400", nj.status === 400 && /not valid JSON/.test(nj.text), `${nj.status} ${nj.text}`);

      const evil = await call(port, "POST", "/save?file=evil.google.json", { body: cap(), headers: { origin: "https://evil.test" } });
      const host = await call(port, "POST", "/save?file=rebind.google.json", { body: cap(), headers: { host: "evil.test" } });
      check("S10: a page on another site (Origin) or a foreign Host header is refused 403, nothing written", evil.status === 403 && host.status === 403 && !fs.existsSync(path.join(dir, "evil.google.json")) && !fs.existsSync(path.join(dir, "rebind.google.json")), `${evil.status} ${host.status}`);

      const pre = await call(port, "OPTIONS", "/save?file=x.google.json", { headers: { origin: "https://www.google.com", "access-control-request-method": "POST", "access-control-request-private-network": "true" } });
      check("S11: Chrome's preflight from a Google page is answered (204 + allow-private-network)", pre.status === 204 && pre.headers["access-control-allow-private-network"] === "true" && pre.headers["access-control-allow-origin"] === "https://www.google.com", `${pre.status} ${JSON.stringify(pre.headers)}`);

      const rb = await call(port, "POST", "/save?file=robot.google.json", { body: cap({ organic: [], robotCheck: true, query: "robot query" }) });
      check("S12: a robot-check capture (no results) is saved, and the log line says to stop the run", rb.status === 200 && rb.json?.robotCheck === true && srv.lines.some((l) => /saved robot\.google\.json/.test(l) && /ROBOT CHECK/.test(l)), `${rb.status} ${rb.text} | ${srv.lines.slice(-2).join(" / ")}`);

      const ai = await call(port, "POST", "/save-ai?file=who-buys-houses-chatgpt.json", { body: AI_CAP });
      const aif = path.join(aiDir, "who-buys-houses-chatgpt.json");
      const aiBad = await call(port, "POST", "/save-ai?file=bad-answer.json", { body: { ...AI_CAP, answer: "" } });
      const ai2 = await call(port, "POST", "/save-ai?file=who-buys-houses-chatgpt.json", { body: AI_CAP });
      check("S13: /save-ai writes an AI-answer capture into captures/ai, refuses one without an answer (400), and paces it too (429)", ai.status === 200 && fs.existsSync(aif) && rj(aif).answer === AI_CAP.answer && aiBad.status === 400 && /no answer/.test(aiBad.text) && ai2.status === 429 && !fs.existsSync(path.join(dir, "who-buys-houses-chatgpt.json")), `${ai.status} ${aiBad.status} ${ai2.status}`);

      const savedFiles = fs.readdirSync(dir).length + fs.readdirSync(aiDir).length;
      const savedLines = srv.lines.filter((l) => /^saved /.test(l));
      check("S14: one log line per saved file", savedLines.length === savedFiles && savedFiles === 3, `${savedLines.length} lines, ${savedFiles} files: ${savedLines.join(" / ")}`);

      // ---- importer on what the receiver saved: G6 flags
      const dsk = cap({ query: "desktop no sources", device: "desktop", location: { requested: "Tracy, CA", footer: "Egypt - From your device" }, aiOverview: { present: true, text: "An overview of several agents in Tracy that buy and sell homes.", sources: [] } });
      const mob = cap({ query: "mobile with sources", device: "mobile", location: { requested: "Tracy, CA", footer: "Egypt - From your device" }, aiOverview: { present: true, text: "An overview of several agents in Tracy that buy and sell homes.", sources: ["zillow.com"] } });
      const p1 = await call(port, "POST", "/save?file=desktop-no-sources.google.json", { body: dsk });
      const p2 = await call(port, "POST", "/save?file=mobile-with-sources.google.json", { body: mob });
      const im = importer(t);
      const s = im.status === 0 ? serpOf(t) : null;
      check("I1: captures saved by the receiver are read by the importer (counts match, nothing rejected)", p1.status === 200 && p2.status === 200 && s && s.counts.captures === 4 && s.counts.blocked === 1 && s.rejected.length === 0, `${im.stdout} ${im.stderr}`);
      check("I2: business.json wants mobile, one capture is desktop -> deviceMismatch { captured:[desktop,mobile], wanted:[mobile], count:1 }", s?.deviceMismatch && JSON.stringify(s.deviceMismatch.captured) === '["desktop","mobile"]' && JSON.stringify(s.deviceMismatch.wanted) === '["mobile"]' && s.deviceMismatch.count === 1 && s.notes?.some((n) => /device mismatch/.test(n)), JSON.stringify([s?.deviceMismatch, s?.notes]));
      check("I3: an AI Overview present with no sources -> row aiSourcesMissing:true, counted in counts.aiOverviewWithoutSources (1); the one with sources is not", s?.counts.aiOverviewWithoutSources === 1 && s.captures.filter((c) => c.aiSourcesMissing).length === 1 && s.captures.find((c) => /desktop no sources/.test(c.query)).aiSourcesMissing === true && s.captures.find((c) => /mobile with sources/.test(c.query)).aiSourcesMissing === false, JSON.stringify(s?.counts));
      check("I4: the bad no-device capture the receiver refused is rejected by the importer for the same reason (one rule set)", (() => { const d2 = path.join(t, "parity"); w(path.join(d2, "no-device.google.json"), bad); const r = importer(t, ["--dir", d2]); return r.status === 0 && serpOf(t).rejected.some((x) => /no device/.test(x.reason)); })(), "");
      // clean case: wanted device, localized, sources -> no flags
      const d3 = path.join(t, "clean"); w(path.join(d3, "c1.google.json"), cap({ query: "clean one", aiOverview: { present: true, text: "x".repeat(60), sources: ["zillow.com"] } })); w(path.join(d3, "c2.google.json"), cap({ query: "clean two" }));
      importer(t, ["--dir", d3]); const sc = serpOf(t);
      check("I5: matching device, localized footer, sources present -> no deviceMismatch, no notes, count 0", !sc.deviceMismatch && !sc.notes && sc.counts.aiOverviewWithoutSources === 0 && sc.counts.captures === 2, JSON.stringify([sc.deviceMismatch, sc.notes, sc.counts]));
      // every capture NOT LOCALIZED -> the plain statement
      const d4 = path.join(t, "baseline"); w(path.join(d4, "b1.google.json"), cap({ query: "base one", location: { requested: "Tracy, CA", footer: "Egypt - From your device" } }));
      importer(t, ["--dir", d4]); const sb4 = serpOf(t);
      check("I6: every capture NOT LOCALIZED -> notes say 'baseline captures cannot support city ranking claims'; one localized capture removes the line", sb4.notes?.some((n) => /baseline captures cannot support city ranking claims/.test(n)) && !sc.notes && (() => { const d6 = path.join(t, "mixed"); w(path.join(d6, "m1.google.json"), cap({ query: "mixed one", location: { requested: "Tracy, CA", footer: "Egypt - From your device" } })); w(path.join(d6, "m2.google.json"), cap({ query: "mixed two" })); importer(t, ["--dir", d6]); return !serpOf(t).notes?.some((n) => /baseline/.test(n)); })(), JSON.stringify(sb4.notes));
      // no rankTracking in business.json -> no device check
      const b0 = { ...BUSINESS }; delete b0.rankTracking; w(path.join(pewpOf(t), "business.json"), b0);
      importer(t, ["--dir", dir]); const sn = serpOf(t);
      check("I7: business.json without rankTracking.devices -> no device check (no deviceMismatch)", !sn.deviceMismatch && sn.counts.captures >= 3, JSON.stringify([sn.deviceMismatch, sn.counts]));
      // both devices wanted, only desktop captured -> mismatch with the missing one named
      w(path.join(pewpOf(t), "business.json"), { ...BUSINESS, rankTracking: { ...BUSINESS.rankTracking, devices: ["mobile", "desktop"] } });
      const d5 = path.join(t, "only-desktop"); w(path.join(d5, "d1.google.json"), cap({ query: "only desktop", device: "desktop" }));
      importer(t, ["--dir", d5]); const sd = serpOf(t);
      check("I8: mobile+desktop wanted, only desktop captured -> deviceMismatch names missing:[mobile], count 0", sd.deviceMismatch?.count === 0 && JSON.stringify(sd.deviceMismatch.missing) === '["mobile"]', JSON.stringify(sd.deviceMismatch));
      const mod = await import(pathToFileURL(path.join(sdir, "research-serp-import.mjs")).href);
      check("I9: validateCapture is exported: ok for a good capture, problems[] for a broken one (no query, no location)", mod.validateCapture(cap()).ok === true && (() => { const v = mod.validateCapture({ engine: "google", capturedAt: "2026-10-25T12:00:00Z", device: "mobile", language: "en", organic: [] }); return !v.ok && v.problems.some((x) => /no query/.test(x)) && v.problems.some((x) => /no location/.test(x)); })() && !mod.validateCapture("nope").ok, "");
    } finally { await srv.stop(); }
  }

  // ------------------------------------------------ C: the page-side extractor
  if (want("C")) {
    const js = path.join(sdir, "serp-capture.js");
    const src = fs.readFileSync(js, "utf8");
    const chk = spawnSync(node, ["--check", js], { encoding: "utf8", timeout: 30_000 });
    const urls = [...src.matchAll(/https?:\/\/[^\s"'`)\]]+/gi)].map((m) => m[0]);
    check("C1: serp-capture.js parses, and the only web address in it is the local receiver (127.0.0.1)", chk.status === 0 && urls.length >= 1 && urls.every((u) => u.startsWith("http://127.0.0.1")) && !/\bXMLHttpRequest\b|sendBeacon|WebSocket|importScripts/.test(src), `${chk.stderr} ${urls.join(" ")}`);
    const vmod = await import(pathToFileURL(path.join(sdir, "research-serp-import.mjs")).href);

    const googleSetup = (d) => {
      const { el, h3, link, page } = d;
      const raws = [h3("Maps", "https://www.google.com/maps/x"), h3("One", "https://www.zillow.com/a"), h3("One again", "https://www.zillow.com/a"), ...Array.from({ length: 11 }, (_, i) => h3(`T${i}`, `https://s${i}.test/p`))];
      page._q["a h3"] = raws;
      page._q["[data-q], div.related-question-pair [role='heading']"] = [el({ innerText: "realtor in tracy ca", _attr: { "data-q": "realtor in tracy ca" } }), el({ innerText: "How much does a realtor cost?", _attr: { "data-q": "How much does a realtor cost?" } })];
      page._q["#footcnt, .fbar, [role='contentinfo']"] = [el({ innerText: "Tracy, California - From your device  Update location" })];
    };
    const g1 = await runExtractor(sdir, { setup: googleSetup, call: { query: "realtor in tracy ca", requested: "Tracy, CA", engine: "google" } });
    const body = g1.posts[0]?.body;
    check("C2: a Google page -> POST to the 127.0.0.1 receiver as <slug>.google.json; organic is 10 distinct non-Google addresses in order; the capture passes the importer's rules", g1.posts.length === 1 && g1.posts[0].url === "http://127.0.0.1:47321/save?file=realtor-in-tracy-ca.google.json" && body.organic.length === 10 && body.organic[0].url === "https://www.zillow.com/a" && body.organic.every((o, i) => o.position === i + 1 && !/google\./.test(o.url)) && new Set(body.organic.map((o) => o.url)).size === 10 && vmod.validateCapture(body).ok && /^200 saved/.test(g1.answer), `${g1.answer} ${JSON.stringify(body?.organic?.slice(0, 2))}`);
    check("C3: device mobile from userAgentData / a 390 px window; language hl; footer text and the location method (gl = country only) recorded; People-also-ask drops the query itself", body.device === "mobile" && body.language === "en" && /Tracy, California/.test(body.location.footer) && /gl=us/.test(body.location.method) && body.location.requested === "Tracy, CA" && JSON.stringify(body.paa) === '["How much does a realtor cost?"]', JSON.stringify([body.device, body.location, body.paa]));
    const desk = await runExtractor(sdir, { width: 1440, uaMobile: false, setup: googleSetup, call: { query: "realtor in tracy ca", requested: "Tracy, CA", engine: "google", post: false } });
    check("C4: a 1440 px desktop window -> device desktop", JSON.parse(desk.answer).device === "desktop", desk.answer.slice(0, 80));

    const aiSetup = (d) => {
      googleSetup(d);
      const { el, link, page } = d;
      const box = el({ innerText: "AI Overview You can browse architect designed homes through platforms like Zillow and Redfin. Show more" });
      page._q["[data-scope-id='turn']"] = [box];
      const btn = el({ innerText: "Show more" });
      box._q["div, span, button, [role='button']"] = [btn];
      // clicking reveals the sources (the page must be read again after the click)
      btn._onclick = () => { box._q["div, span, button, [role='button']"] = []; box._q["a[href^='http']"] = [link("https://www.zillow.com/x"), link("https://www.google.com/search?q=y"), link("https://www.redfin.com/y"), link("https://www.zillow.com/z")]; };
      return { box, btn };
    };
    let handles; const g2 = await runExtractor(sdir, { setup: (d) => { handles = aiSetup(d); }, call: { query: "realtor in tracy ca", requested: "Tracy, CA", engine: "google" } });
    const b2 = g2.posts[0]?.body;
    check("C5: the AI Overview 'Show more' button is clicked, the page re-read after 800 ms, text and source domains recorded (Google's own links dropped, each domain once)", handles.btn._clicks === 1 && b2.aiOverview.present === true && JSON.stringify(b2.aiOverview.sources) === '["zillow.com","redfin.com"]' && /architect designed homes/.test(b2.aiOverview.text) && vmod.validateCapture(b2).ok, `${handles.btn._clicks} ${JSON.stringify(b2?.aiOverview)}`);

    const g3 = await runExtractor(sdir, { pathname: "/sorry/index", text: "Our systems have detected unusual traffic from your computer network", setup: (d) => { d.page._q["a h3"] = []; }, call: { query: "realtor in tracy ca", requested: "Tracy, CA", engine: "google" } });
    check("C6: a /sorry page -> robotCheck true saved, and the answer says STOP THE WHOLE RUN", g3.posts[0]?.body.robotCheck === true && /ROBOT CHECK.*STOP THE WHOLE RUN/.test(g3.answer) && vmod.validateCapture(g3.posts[0].body).ok, g3.answer);
    const pure = g1.sb.__pewpPure;
    check("C7: a results page that only MENTIONS captchas is not a robot check; an empty page that says so is", pure.robotOf({ text: "how to solve a captcha", pathname: "/search", hostname: "www.google.com", organicCount: 6 }) === null && !!pure.robotOf({ text: "Please verify you are human", pathname: "/search", hostname: "www.bing.com", organicCount: 0 }), "");
    const g4 = await runExtractor(sdir, { setup: googleSetup, call: { query: "some other search", requested: "Tracy, CA", engine: "google" } });
    const g5 = await runExtractor(sdir, { width: 1440, uaMobile: false, setup: googleSetup, call: { query: "realtor in tracy ca", requested: "Tracy, CA", engine: "google", device: "mobile" } });
    check("C8: the tab shows another search, or the tab is desktop when mobile was asked -> ERROR and nothing is sent", /^ERROR/.test(g4.answer) && g4.posts.length === 0 && /^ERROR: asked for mobile/.test(g5.answer) && g5.posts.length === 0, `${g4.answer} | ${g5.answer}`);
    const g6 = await runExtractor(sdir, { setup: googleSetup, call: { query: "realtor in tracy ca", requested: "Tracy, CA", engine: "google" }, fetchImpl: async () => { throw new Error("Failed to fetch"); } });
    check("C9: receiver not running or local-network access not allowed -> an ERROR that says what to do, no throw", /^ERROR: could not reach the receiver.*capture-server\.mjs.*Allow/.test(g6.answer), g6.answer);
    const real = "https://example.com/a?b=1&c=d";
    const wrapped = "https://www.bing.com/ck/a?!&&p=abc&u=a1" + Buffer.from(real).toString("base64url") + "&ntb=1";
    check("C10: Bing tracking links (/ck/a?u=a1<base64>) are decoded to the real address; Google /url?q= too; slug matches the importer's", pure.unwrap(wrapped) === real && pure.unwrap("https://www.google.com/url?q=https%3A%2F%2Fa.test%2Fx&sa=t") === "https://a.test/x" && pure.slugOf("Realtor & Agent in Tracy, CA!") === "realtor-and-agent-in-tracy-ca", `${pure.unwrap(wrapped)}`);

    // ---- F: the extractor against reduced saved pages of the REAL engines (fixtures/serp-html/, read 2026-10-26)
    const fxDir = path.join(path.dirname(scriptsDir), "fixtures", "serp-html");
    const fx = (name) => parseHtml(fs.readFileSync(path.join(fxDir, name), "utf8"));
    const onPage = (name, engine, query, search) => runExtractor(sdir, { doc: fx(name), hostname: engine === "google" ? "www.google.com" : "www.bing.com", search, width: 1440, uaMobile: false, call: { query, requested: "United States", engine } });
    const F1 = await onPage("google-ai-overview.html", "google", "what is a cash offer on a house", "?q=what+is+a+cash+offer+on+a+house&hl=en&gl=us");
    const a1 = F1.posts[0]?.body.aiOverview;
    check("F1: real Google page WITH an AI Overview -> present true, the text, the cited domains (Google's own pages dropped), 'Show all' clicked, organic results exclude the AI block, passes the importer's rules", a1?.present === true && /^AI Overview/.test(a1.text) && /cash offer/.test(a1.text) && ["opendoor.com", "fairway.com", "nerdwallet.com", "zillow.com", "chase.com", "cuofco.org"].every((d) => a1.sources.includes(d)) && !a1.sources.some((d) => /google\./.test(d)) && a1.expandClicks >= 1 && a1.container === "[data-scope-id=turn]" && F1.posts[0].body.organic.length >= 5 && vmod.validateCapture(F1.posts[0].body).ok, JSON.stringify(a1 && { ...a1, text: a1.text.slice(0, 40) }) + F1.answer);
    const F2 = await onPage("google-no-ai.html", "google", "weather", "?q=weather&hl=en&gl=us");
    const a2 = F2.posts[0]?.body.aiOverview;
    check("F2: real Google page WITHOUT an AI Overview -> present false, no text, no sources; the results are still read", a2?.present === false && a2.text === "" && a2.sources.length === 0 && F2.posts[0].body.organic.length >= 5 && /| no AI Overview |/.test(F2.answer), JSON.stringify(a2) + F2.answer);
    const F3 = await onPage("bing-copilot-answer.html", "bing", "how does a 1031 exchange work", "?q=how+does+a+1031+exchange+work&setlang=en&cc=us");
    const a3 = F3.posts[0]?.body.aiOverview;
    check("F3: real Bing page WITH a Copilot answer -> present true, the answer text, the cited domains from the inline citations and the citation list (Bing's own links dropped), 'Show more' clicked", a3?.present === true && /^A 1031 exchange allows real estate investors/.test(a3.text) && ["anchor1031.com", "1031federal.com", "fidelity.com", "taxpayers.net", "listwithclever.com"].every((d) => a3.sources.includes(d)) && !a3.sources.some((d) => /bing\.com/.test(d)) && a3.expandClicks >= 1 && a3.container === "li.b_ans .cht_container" && F3.posts[0].body.organic.length === 5 && vmod.validateCapture(F3.posts[0].body).ok, JSON.stringify(a3 && { ...a3, text: a3.text.slice(0, 40) }) + F3.answer);
    const F4 = await onPage("bing-no-ai.html", "bing", "what is a cash offer on a house", "?q=what+is+a+cash+offer+on+a+house&setlang=en&cc=us");
    const a4 = F4.posts[0]?.body.aiOverview;
    check("F4: real Bing page WITHOUT an answer (it has the 'Copilot' follow-up box) -> present false, no sources; 6 organic results", a4?.present === false && a4.sources.length === 0 && F4.posts[0].body.organic.length === 6, JSON.stringify(a4));
    const para = "This paragraph is long enough to look like an answer but it sits next to a plain heading and is not an answer card at all.";
    const plainG = parseHtml(`<html lang="en"><body><div><h1>AI Overview</h1><p>${para}</p></div><div id="rso"><div><a href="https://a.test/x"><h3>Result</h3></a></div></div></body></html>`);
    const plainB = parseHtml(`<html lang="en"><body><ol id="b_results"><li class="b_ans"><h2>Copilot Search</h2><p>${para}</p></li><li class="b_algo"><h2><a href="https://a.test/x">Result</a></h2></li></ol></body></html>`);
    const P1 = await runExtractor(sdir, { doc: plainG, width: 1440, uaMobile: false, call: { query: "realtor in tracy ca", engine: "google", requested: "Tracy, CA" } });
    const P2 = await runExtractor(sdir, { doc: plainB, hostname: "www.bing.com", search: "?q=realtor+in+tracy+ca", width: 1440, uaMobile: false, call: { query: "realtor in tracy ca", engine: "bing", requested: "Tracy, CA" } });
    check("F5: the words 'AI Overview' / 'Copilot Search' as a heading with a paragraph beside them, but no answer container -> present false on both engines (no heading-text guessing)", P1.posts[0]?.body.aiOverview.present === false && P2.posts[0]?.body.aiOverview.present === false && P1.posts[0].body.organic.length === 1, JSON.stringify([P1.posts[0]?.body.aiOverview, P2.posts[0]?.body.aiOverview]));
    const names = fs.readdirSync(fxDir), sz = names.map((n) => fs.statSync(path.join(fxDir, n)).size);
    const raw = names.map((n) => fs.readFileSync(path.join(fxDir, n), "utf8")).join("\n");
    check("F6: four fixtures, each under 200 KB, scrubbed: no scripts, no inline styles, no tracking parameters, no query string in any link", names.length === 4 && sz.every((n) => n < 200_000) && !/<script|<style|style=|<svg|<img|[?&](ved|ei|sca_esv|sxsrf|fbclid|gclid|utm_)\w*=|href="[^"]*\?/i.test(raw) && !/document\.cookie|set-cookie/i.test(raw), `${names.join(",")} ${sz.join(",")}`);
  }
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
  return res;
}

// ---------------- mutants ----------------
const MUTANTS = [
  { name: "receiver listens on every interface", file: "capture-server.mjs", from: 'server.listen(port, "127.0.0.1", () => {', to: 'server.listen(port, "0.0.0.0", () => {', sc: "S", expect: [/^S1:/] },
  { name: "pacing removed", file: "capture-server.mjs", from: "if (last && Date.now() - last < PACE_MS)", to: "if (false)", sc: "S", expect: [/^S3:/, /^S13:/] },
  { name: "capture not validated", file: "capture-server.mjs", from: 'const v = kind === "serp" ? validateCapture(j, { defaultLanguage }) : validateAiCapture(j);', to: "const v = { ok: true, problems: [] };", sc: "S", expect: [/^S4:/, /^S13:/] },
  { name: "file name check removed", file: "capture-server.mjs", from: "const SERP_NAME = /^[a-z0-9-]+\\.(google|bing)\\.json$/;", to: "const SERP_NAME = /.*/;", sc: "S", expect: [/^S5:/] },
  { name: "body limit removed", file: "capture-server.mjs", from: "export const MAX_BODY = 2 * 1024 * 1024;", to: "export const MAX_BODY = 2 * 1024 * 1024 * 1024;", sc: "S", expect: [/^S6:/] },
  { name: "status line counts nothing", file: "capture-server.mjs", from: "${saved.serp + saved.ai} saved (", to: "0 saved (", sc: "S", expect: [/^S7:/] },
  { name: "engine/name agreement not checked", file: "capture-server.mjs", from: 'if (kind === "serp" && v.ok && String(j.engine)', to: 'if (false && String(j.engine)', sc: "S", expect: [/^S8:/] },
  { name: "foreign Origin accepted", file: "capture-server.mjs", from: 'if (origin && !cors["access-control-allow-origin"]) return send(', to: 'if (false) return send(', sc: "S", expect: [/^S10:/] },
  { name: "foreign Host accepted", file: "capture-server.mjs", from: "if (!HOST_OK.test(req.headers.host || \"\")) return send(", to: "if (false) return send(", sc: "S", expect: [/^S10:/] },
  { name: "preflight not answered", file: "capture-server.mjs", from: 'if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }', to: "", sc: "S", expect: [/^S11:/] },
  { name: "AI captures written into the results folder", file: "capture-server.mjs", from: "const file = path.join(dirs[kind], name);", to: "const file = path.join(dirs.serp, name);", sc: "S", expect: [/^S13:/] },
  { name: "saved file is not the capture", file: "capture-server.mjs", from: "fs.writeFileSync(file, JSON.stringify(j, null, 1) + \"\\n\");", to: "fs.writeFileSync(file, JSON.stringify({ ...j, organic: [] }, null, 1) + \"\\n\");", sc: "S", expect: [/^S2:/] },
  { name: "importer lets everything through", file: "research-serp-import.mjs", from: 'const problems = r.rejected ? r.rejected.reason.split("; ") : [];', to: "const problems = [];", sc: "S", expect: [/^S4:/, /^I9:/] },
  { name: "device mismatch never counted", file: "research-serp-import.mjs", from: "captures.filter((c) => !wanted.includes(c.device)).length", to: "0", sc: "S", expect: [/^I2:/] },
  { name: "missing AI sources not flagged", file: "research-serp-import.mjs", from: "c.aiOverview?.present === true && !(c.aiOverview.sources || []).length", to: "false", sc: "S", expect: [/^I3:/] },
  { name: "baseline note never written", file: "research-serp-import.mjs", from: "captures.every((c) => !c.location.localized)", to: "false", sc: "S", expect: [/^I6:/] },
  { name: "no rankTracking assumes mobile", file: "research-serp-import.mjs", from: '.includes(d)))] : [];', to: '.includes(d)))] : ["mobile"];', sc: "S", expect: [/^I7:/] },
  { name: "localized capture still gets the baseline note", file: "research-serp-import.mjs", from: "captures.length && captures.every((c) => !c.location.localized)", to: "captures.length && captures.some((c) => !c.location.localized)", sc: "S", expect: [/^I6:/] },
  { name: "extractor keeps duplicates", file: "serp-capture.js", from: "!seen.has(r.url) && seen.add(r.url)", to: "true", sc: "C", expect: [/^C2:/] },
  { name: "extractor keeps Google's own links", file: "serp-capture.js", from: "h && !NOISE_HOST.test(h) && !seen.has(r.url)", to: "h && !seen.has(r.url)", sc: "C", expect: [/^C2:/] },
  { name: "mentioning a captcha counts as a robot check", file: "serp-capture.js", from: 'if (MARKERS.test(text || "") && !organicCount)', to: 'if (MARKERS.test(text || ""))', sc: "C", expect: [/^C7:/] },
  { name: "device never mobile", file: "serp-capture.js", from: "uaMobile === true || (Number.isFinite(width) && width < 768)", to: "false", sc: "C", expect: [/^C3:/] },
  { name: "Show more never clicked", file: "serp-capture.js", from: "try { b.click(); clicks++; }", to: "try { clicks += 0; }", sc: "C", expect: [/^C5:/] },
  { name: "wrong tab not detected", file: "serp-capture.js", from: "norm(pageQ) !== norm(query)", to: "false", sc: "C", expect: [/^C8:/] },
  { name: "device mismatch not refused", file: "serp-capture.js", from: "if (opt.device && opt.device !== detected)", to: "if (false)", sc: "C", expect: [/^C8:/] },
  { name: "Bing links not decoded", file: "serp-capture.js", from: 'if (v.startsWith("a1"))', to: "if (false)", sc: "C", expect: [/^C10:/] },
  { name: "PAA keeps the query itself", file: "serp-capture.js", from: "&& norm(q) !== norm(query))", to: "&& true)", sc: "C", expect: [/^C3:/] },
  { name: "Google heading-text fallback reintroduced", file: "serp-capture.js", from: 'return t ? (t.closest("section") || t) : null; }', to: 'if (t) return t.closest("section") || t; const h = [...document.querySelectorAll("h1, h2, h3, [role=\'heading\'], strong")].find((e) => /^AI Overview$/i.test(clean(e.textContent))); return h ? h.parentElement : null; }', sc: "C", expect: [/^F5:/] },
  { name: "Bing heading-text fallback reintroduced", file: "serp-capture.js", from: 'return document.querySelector("li.b_ans .cht_container");', to: 'return document.querySelector("li.b_ans .cht_container") || (() => { const h = [...document.querySelectorAll("h1, h2, h3, strong")].find((e) => /^(AI Overview|Copilot Search)$/i.test(clean(e.textContent))); return h ? h.parentElement : null; })();', sc: "C", expect: [/^F5:/] },
  { name: "AI answer present by default", file: "serp-capture.js", from: 'let aiOverview = { present: false, text: "", sources: [] };', to: 'let aiOverview = { present: true, text: "", sources: [] };', sc: "C", expect: [/^F2:/, /^F4:/] },
  { name: "Google container selector wrong", file: "serp-capture.js", from: `document.querySelector("[data-scope-id='turn']")`, to: `document.querySelector("[data-scope-id='turnx']")`, sc: "C", expect: [/^F1:/] },
  { name: "Bing container selector wrong", file: "serp-capture.js", from: 'document.querySelector("li.b_ans .cht_container")', to: 'document.querySelector("li.b_ans .cht_containerx")', sc: "C", expect: [/^F3:/] },
  { name: "Bing citations not collected", file: "serp-capture.js", from: ".cht_ans_root a[href^='http'], .cht_cit_list a[href^='http']", to: ".cht_ans_root a[href^='nope']", sc: "C", expect: [/^F3:/] },
  { name: "Google sources not collected", file: "serp-capture.js", from: `google ? "a[href^='http']" :`, to: `google ? "a[href^='nope']" :`, sc: "C", expect: [/^F1:/] },
  { name: "extractor posts to another host", file: "serp-capture.js", from: "`http://127.0.0.1:${port}/save", to: "`http://example.com:${port}/save", sc: "C", expect: [/^C1:/, /^C2:/] },
].filter((m) => m.expect.length);

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-capture.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  const main = await runScenarios(scriptsDir);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail.slice(0, 700)}`}`);
  let failed = main.filter((r) => !r.ok).length;
  console.log(failed ? `CAPTURE TEST FAIL: ${failed} of ${main.length}` : `CAPTURE TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    let caught = 0, ran = 0;
    for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-capmut-"));
      const sdir = path.join(mdir, "scripts");
      for (let t = 0; ; t++) { try { fs.mkdirSync(sdir, { recursive: true }); fs.cpSync(scriptsDir, sdir, { recursive: true }); break; } catch (e) { if (t >= 4) throw e; } }
      const target = path.join(sdir, mu.file), src = fs.readFileSync(target, "utf8"), count = src.split(mu.from).length - 1;
      if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${mu.file} (the patch did not apply)`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
      const chk = spawnSync(node, ["--check", target], { encoding: "utf8", timeout: 60_000 });
      if (chk.status) { console.log(`FAIL mutant "${mu.name}": mutated file does not parse: ${chk.stderr.slice(0, 200)}`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      let res; try { res = await runScenarios(sdir, [mu.sc]); } catch (e) { res = [{ name: `crash: ${e.message}`, ok: false, detail: "" }]; }
      const red = res.filter((r) => !r.ok);
      const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  process.exit(failed ? 1 : 0);
}
