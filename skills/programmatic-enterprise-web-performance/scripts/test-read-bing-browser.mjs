// Usage: node test-read-bing-browser.mjs [--scripts <dir>]
// Test of read-bing.mjs through a REAL browser on INVENTED result pages (a server on 127.0.0.1), AB-12. The driver is the real one (connect, evaluate, close); the only things this test
// replaces are io.sleep (a recorder: no real wait) and the two functions that load an address: they turn https://www.bing.com/search?q=<x> into http://127.0.0.1:<port>/search?q=<x> and
// REFUSE any other address, so that no real page is ever loaded. One headless browser on a temp profile for the whole file. No network, no real site.
// It is a browser test: the head runs it through the machine lock (node ~/.claude/scripts/heavy.mjs -- node test-read-bing-browser.mjs); it is NOT on the GitHub list (ci-tests.json).
// B1 three invented result pages become three captures with the right positions; B2 a page with a check title: the tab is closed, a stop, and the page recorded no input event of any kind;
// B3 the tab count never passes 1 and the server saw exactly one request per page (no reload); B4 a page that answers 429 is a stop.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";
import { spawnBrowser } from "./lib-browser-profile.mjs";
import { CHROME_PATH } from "./cdp-measure.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const HOST = "read-bing-browser.test", SITE = "https://" + HOST + "/";
const PACE = { tabsAtOnce: 1, afterLoadSeconds: 3, gapSeconds: 45, maxPagesPerRun: 30 };
const DESC = { result: "li.b_algo", link: "h2 a", title: "h2", related: ".b_rs a", ask: ".rwrl", footerPlace: "#fl" };
const BING = "https://www.bing.com/search?q=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const item = (q, o = {}) => ({ query: q, engine: "bing", device: "desktop", location: "Tracy, CA", language: "en", ...o });
const imp = (dir, f) => import(pathToFileURL(path.join(dir, f)).href);

// ---------------------------------------------------------------- the invented pages. Every page records each input event it gets (a beacon to /__ev), so that "nothing was typed, clicked or scrolled" is read from the server's log.
const EVENTS = ["keydown", "keypress", "keyup", "input", "click", "mousedown", "mouseup", "mousemove", "pointerdown", "wheel", "scroll", "touchstart", "focusin"];
const REC = "<script>for(const k of " + JSON.stringify(EVENTS) + ")addEventListener(k,()=>navigator.sendBeacon('/__ev?k='+k),true);</script>";
function html(q) {
  if (q.startsWith("check")) return "<!doctype html><html><head><title>Verify you are human</title></head><body><h1>One more step</h1><p>Please verify you are human to continue.</p><input id=\"box\">" + REC + "</body></html>";
  const n = q.replace(/\W/g, "");
  return "<!doctype html><html><head><title>" + q + " - Search</title></head><body><ol>"
    + "<li class=\"b_algo\"><h2><a href=\"https://" + n + "-a.test/one\">First " + q + "</a></h2></li>"
    + "<li class=\"b_algo\"><h2>No link here</h2></li>"
    + "<li class=\"b_algo\"><h2><a href=\"javascript:void(0)\">Script link</a></h2></li>"
    + "<li class=\"b_algo\"><h2><a href=\"https://" + n + "-b.test/two\">Second   " + q + "</a></h2></li>"
    + "</ol><div class=\"b_rs\"><a>related " + q + "</a></div><div class=\"rwrl\">Question about " + q + "?</div><div id=\"fl\">Tracy, California</div>" + REC + "</body></html>";
}
async function startServer() {
  const log = [], server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/__ev") { log.push({ kind: "event", x: u.searchParams.get("k") }); res.statusCode = 204; return res.end(); }
    if (u.pathname === "/search") {
      const q = u.searchParams.get("q") || "";
      log.push({ kind: "load", q });
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (q.startsWith("limit")) { res.statusCode = 429; return res.end("<!doctype html><title>Too many requests</title><p>Slow down.</p>"); }
      return res.end(html(q));
    }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: "http://127.0.0.1:" + server.address().port, log, close: () => server.close() };
}

// ---------------------------------------------------------------- one real headless browser for the whole file
let BR = null;
async function browser() {
  if (BR) return BR;
  if (!CHROME_PATH) throw new Error("no Chrome or Edge found (set CHROME_PATH)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-rb-chrome-"));
  const proc = spawnBrowser({ exe: CHROME_PATH, dir, args: ["--headless=new", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "about:blank"], options: { stdio: "ignore", windowsHide: true } });
  proc.on("error", () => {});
  let port = null;
  for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = Number(fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0].trim()) || null; } catch { /* not yet */ } }
  BR = { proc, dir, port };
  if (!port) { closeBrowser(); throw new Error("the test browser did not open its DevTools port"); }
  return BR;
}
function closeBrowser() {
  if (!BR) return;
  const { proc, dir } = BR; BR = null;
  if (proc.exitCode === null && proc.signalCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { stdio: "ignore", timeout: 10000, windowsHide: true });
    else { try { proc.kill("SIGKILL"); } catch { /* gone */ } }
  }
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the reaper takes it */ }
}
process.on("exit", closeBrowser);
const pageTabs = async (port, base) => { try { return (await (await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(10000) })).json()).filter((t) => t.type === "page" && String(t.url).startsWith(base)); } catch { return null; } };

function fresh(tmp, n, items) {
  const cwd = path.join(tmp, n), pewp = path.join(cwd, "site-checks", HOST, ".pewp"), serp = path.join(pewp, "captures", "serp");
  W(path.join(pewp, "business.json"), { name: "Read Bing Browser Realty", domain: HOST, market: { country: "US", language: "en" }, vocabulary: ["homes"], offer: "homes" });
  W(path.join(pewp, "research", "capture-requests.json"), { items });
  return { cwd, serp, rec: () => J(path.join(serp, "bing-read.json")), cap: (id) => J(path.join(serp, id + ".bing.json")), has: (id) => fs.existsSync(path.join(serp, id + ".bing.json")) };
}

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("read-bing-browser"), srv = await startServer(), br = await browser();
  const mod = await imp(dir, "read-bing.mjs"), ace = await imp(dir, "lib-ask-pace.mjs");
  const pf = path.join(tmp, "pages.json"); W(pf, { pace: PACE, bing: { selectors: DESC } });
  let n = 0;
  // one run through the real driver; only the address is turned to the invented server (and nothing else is let through), and only io.sleep is replaced
  async function go(items) {
    const f = fresh(tmp, "run" + ++n, items), stops = path.join(tmp, "stops" + n); fs.mkdirSync(stops, { recursive: true });
    process.env.OMNIKOM_STOPS_DIR = stops;
    srv.log.length = 0;
    const real = { ...mod.drv }, savedSleep = ace.io.sleep, waits = [], tabs = [], lines = [];
    const to = (u) => { if (!String(u).startsWith(BING)) throw new Error("refused: not a bing search address: " + u); return srv.base + "/search?q=" + String(u).slice(BING.length); };
    mod.drv.openPlain = (c, u) => real.openPlain(c, to(u));
    mod.drv.navigate = (c, t, u) => real.navigate(c, t, to(u));
    mod.drv.evalIn = async (c, s, x) => { const t = await pageTabs(br.port, srv.base); tabs.push(t ? t.length : -1); return real.evalIn(c, s, x); };
    ace.io.sleep = async (ms) => { waits.push(ms / 1000); };
    try {
      const r = await mod.run([SITE, "--cwd", f.cwd, "--port", String(br.port), "--pages-file", pf], { out: (l) => lines.push(l) });
      await sleep(300);
      return { ...r, f, waits, tabs, lines, last: lines[lines.length - 1] || "", stopFile: path.join(stops, "bing.json"), tabsAfter: await pageTabs(br.port, srv.base) };
    } finally { Object.assign(mod.drv, real); ace.io.sleep = savedSleep; delete process.env.OMNIKOM_STOPS_DIR; }
  }
  try {
    // B1 and B3: three invented pages, then the same three counted
    // the default request asks for mobile: each query is read once, in the browser's own desktop window; "ok two" is asked for on both devices
    const x = await go([item("ok one", { device: "mobile" }), item("ok two", { device: "mobile" }), item("ok two"), item("ok three", { device: "mobile" })]);
    const bad = [];
    if (x.code !== 0 || x.f.rec().read.join() !== "ok-one,ok-two,ok-three") bad.push("exit " + x.code + " " + x.last);
    for (const id of ["ok-one", "ok-two", "ok-three"]) {
      if (!x.f.has(id)) { bad.push("no " + id); continue; }
      const c = x.f.cap(id), q = id.replace(/-/g, ""), o = c.organic;
      if (o.length !== 2 || o[0].position !== 1 || o[1].position !== 2 || o[0].url !== "https://" + q + "-a.test/one" || o[1].url !== "https://" + q + "-b.test/two" || o[1].title !== "Second " + id.replace(/-/g, " ")) bad.push(id + " organic " + JSON.stringify(o));
      if (c.location.footer !== "Tracy, California" || c.relatedSearches.length !== 1 || c.paa.length !== 1 || c.engine !== "bing" || c.browser !== "work browser" || c.device !== "desktop" || !/1 block with no link/.test(c.notes) || /asked for mobile; read in a desktop window/.test(c.notes) !== (id !== "ok-two")) bad.push(id + " fields " + JSON.stringify({ l: c.location, r: c.relatedSearches, p: c.paa, n: c.notes }));
    }
    check("B1: three invented result pages are read through the real driver into three captures with the right positions, the footer place, the related searches and the questions, device desktop (with the asked-for sentence unless desktop was asked)", bad.length === 0, bad.join(" | "));
    const loads = srv.log.filter((e) => e.kind === "load").map((e) => e.q);
    check("B3: the tab count never passes 1 (looked at after each load), the tab is gone at the end, and the server saw exactly one request per page, in order (no reload)", x.tabs.length === 3 && x.tabs.every((t) => t === 1) && Array.isArray(x.tabsAfter) && x.tabsAfter.length === 0 && loads.join("|") === "ok one|ok two|ok three" && x.waits.join() === "3,45,3,45,3", JSON.stringify({ tabs: x.tabs, after: x.tabsAfter && x.tabsAfter.length, loads, waits: x.waits }));
    // B2: a check page first
    const y = await go([item("check one"), item("ok two")]);
    const touched = srv.log.filter((e) => e.kind === "event");
    check("B2: a page with a check title: exit 3, a stop for bing, the tab is closed, nothing was loaded after it, and the page recorded no key, input, click, mouse or scroll event", y.code === 3 && fs.existsSync(y.stopFile) && y.f.rec().stop && !y.f.has("check-one") && y.tabsAfter && y.tabsAfter.length === 0 && srv.log.filter((e) => e.kind === "load").length === 1 && touched.length === 0, JSON.stringify({ code: y.code, last: y.last, touched, loads: srv.log.length, after: y.tabsAfter && y.tabsAfter.length }));
    // B4: a 429
    const z = await go([item("limit one"), item("ok two")]);
    const st = fs.existsSync(z.stopFile) ? J(z.stopFile) : null;
    check("B4: a page that answers 429 is a stop for bing with its own reason; no capture; the second page is never loaded; the tab is closed", z.code === 3 && !!st && /429/.test(st.reason) && !z.f.has("limit-one") && srv.log.filter((e) => e.kind === "load").length === 1 && z.tabsAfter && z.tabsAfter.length === 0, JSON.stringify({ code: z.code, st, last: z.last }));
  } finally { srv.close(); rmTmp(tmp); }
  return results;
}

const code = await main({ label: "READ BING BROWSER", scenarios, MUTANTS: [], scriptsDir, argv: [...A, "--no-mutants"] });
closeBrowser();
process.exit(code);
