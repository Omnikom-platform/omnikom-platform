// Usage: node test-psi.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of psi.mjs (contract C8): PageSpeed Insights v5 numbers for the trusted-speed column. No network: a local http server on 127.0.0.1
// answers in the documented v5 shape (a minimal fixture written from the documented fields; PSI_API_BASE is the test hook). The live Google
// endpoint is UNPROVEN: nothing here talks to it. Every child runs with an empty home folder and no PSI_API_KEY unless the scenario gives one.
// Covers: no key = BLOCKED exit 3 with the way in (Google Cloud, PageSpeed Insights API) and no request; the key from --dotenv; the request
// shape (path, url, strategy, category=performance, key); the file shape and x100 score; the key absent from stdout, stderr, the result file and
// every cache file; pacing measured on the SERVER's clock; the cache (second run = no request); 429 = stop with exit 1 and the message, the
// pages after it not asked, the ones before it kept; a page that fails does not stop the others; every page failed = exit 1; a hanging server
// is cut off; usage errors (exit 2) before any request, including a gap below the polite minimum to the real Google address.
// Mutants (watched-fail, same pattern as test-google-auth.mjs): break the code each assertion guards in a copy of the scripts folder, expect the
// named assertions red. Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));
const KEY = "PSIKEYSECRET-abc123XYZ";   // gitleaks:allow (a made-up test key, never a real one)
const GAP = 400;

// the documented v5 shape, reduced to the fields the script reads (plus the neighbours a real answer carries)
const audit = (id, numericValue, displayValue) => ({ id, title: id, score: 0.9, scoreDisplayMode: "numeric", numericValue, displayValue });
const answer = (url, strategy) => ({
  captchaResult: "CAPTCHA_NOT_NEEDED", kind: "pagespeedonline#result", id: url,
  loadingExperience: { id: url, metrics: {}, overall_category: "FAST" },
  lighthouseResult: {
    requestedUrl: url, finalUrl: url, lighthouseVersion: "12.0.0", fetchTime: "2026-10-26T10:00:00.000Z", configSettings: { formFactor: strategy, locale: "en" },
    categories: { performance: { id: "performance", title: "Performance", score: strategy === "mobile" ? 0.94 : 0.99 } },
    audits: {
      "largest-contentful-paint": audit("largest-contentful-paint", strategy === "mobile" ? 2750.4 : 900.2, "2.8 s"),
      "cumulative-layout-shift": audit("cumulative-layout-shift", 0.01234, "0.012"),
      "total-blocking-time": audit("total-blocking-time", 120.6, "120 ms"),
      "first-contentful-paint": audit("first-contentful-paint", 1800.2, "1.8 s"),
      "speed-index": audit("speed-index", 2400.9, "2.4 s"),
    },
  },
  analysisUTCTimestamp: "2026-10-26T10:00:00.000Z",
});

async function scenarios(dir) {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 700) });
  const script = path.join(dir, "psi.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-psi-"));
  const home = path.join(tmp, "home"), envDir = path.join(tmp, "env");
  fs.mkdirSync(home); fs.mkdirSync(envDir);
  const envFile = path.join(envDir, "psi.env");
  fs.writeFileSync(envFile, `# test key\nPSI_API_KEY=${KEY}\n`);

  // ---- the fake PSI endpoint ----
  const hits = []; // { t, path, q }
  const varyCalls = new Map();
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), q = Object.fromEntries(u.searchParams);
    hits.push({ t: Date.now(), path: u.pathname, q });
    const target = q.url || "";
    res.setHeader("content-type", "application/json");
    if (/\/hang/.test(target)) return; // never answers
    if (/\/429/.test(target)) { res.statusCode = 429; return res.end(JSON.stringify({ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } })); }
    if (/\/bad/.test(target)) { res.statusCode = 400; return res.end(JSON.stringify({ error: { code: 400, message: `Invalid request ${req.url}`, status: "INVALID_ARGUMENT" } })); }
    if (/\/vary|\/flaky/.test(target)) {
      const k = `${target}|${q.strategy}`; const n = (varyCalls.get(k) || 0) + 1; varyCalls.set(k, n);
      if (/\/flaky/.test(target) && n === 2) { res.statusCode = 500; return res.end(JSON.stringify({ error: { code: 500, message: "Lighthouse failed on run 2" } })); }
      const a = answer(target, q.strategy); const i = (n - 1) % 3;
      a.lighthouseResult.categories.performance.score = [0.70, 0.95, 0.80][i];
      a.lighthouseResult.audits["largest-contentful-paint"].numericValue = [3000, 1000, 2500][i];
      a.lighthouseResult.audits["cumulative-layout-shift"].numericValue = [0.3, 0.05, 0.2][i];
      return res.end(JSON.stringify(a));
    }
    if (/\/noscore/.test(target)) { const a = answer(target, q.strategy); a.lighthouseResult.categories.performance.score = null; return res.end(JSON.stringify(a)); }
    res.end(JSON.stringify(answer(target, q.strategy)));
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/pagespeedonline/v5/runPagespeed`;
  const site = (p = "/") => `https://example-psi-test.test${p}`;

  const runPsi = (argv, { env = {}, timeout = 60000 } = {}) => new Promise((resolve) => {
    const e = { ...process.env, USERPROFILE: home, HOME: home, PSI_API_BASE: base, NODE_OPTIONS: "", ...env };
    if (!("PSI_API_KEY" in env)) delete e.PSI_API_KEY;
    const c = spawn(process.execPath, [script, ...argv], { stdio: ["ignore", "pipe", "pipe"], env: e });
    let so = "", se = "";
    c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
    const timer = setTimeout(() => { se += "TIMED OUT"; c.kill(); }, timeout);
    c.on("close", (code) => { clearTimeout(timer); resolve({ code, so, se }); });
  });
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)])) : []);
  const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  const pewpOf = (cwd) => path.join(cwd, "site-checks", "example-psi-test.test", ".pewp");
  const fresh = (n) => { const d = path.join(tmp, n); fs.mkdirSync(d); return d; };
  const soft = async (f) => { try { return await f(); } catch (e) { return { error: e.message }; } };

  try {
    // ---- 1. no key ----
    const c1 = fresh("nokey"), h1 = hits.length;
    const r1 = await runPsi([site(), "--cwd", c1]);
    check("no key: BLOCKED, exit 3, the way in is named (Google Cloud, PageSpeed Insights API, PSI_API_KEY, --dotenv)", r1.code === 3 && /BLOCKED/.test(r1.so) && /Google Cloud/.test(r1.so) && /PageSpeed Insights API/.test(r1.so) && /PSI_API_KEY/.test(r1.so) && /--dotenv/.test(r1.so), `exit ${r1.code} ${r1.so}${r1.se}`);
    check("no key: no request was made and nothing was written", hits.length === h1 && !fs.existsSync(path.join(c1, "site-checks")), `${hits.length - h1} requests; ${walk(c1).join(", ")}`);

    // ---- 2. the main run: two pages, both strategies, key from --dotenv ----
    const c2 = fresh("main"), h2 = hits.length;
    const r2 = await runPsi([site("/"), site("/about"), "--cwd", c2, "--today", "2026-10-26", "--gap-ms", String(GAP), "--dotenv", envFile]);
    const mine = hits.slice(h2);
    const file2 = path.join(pewpOf(c2), "psi", "2026-10-26.json");
    const doc = fs.existsSync(file2) ? J(file2) : { pages: [] };
    check("main run: exit 0 and <pewp>/psi/<--today>.json is written (pewp = the first url's host)", r2.code === 0 && fs.existsSync(file2), `exit ${r2.code} ${r2.so}${r2.se}`);
    check("main run: 4 requests (2 pages x mobile,desktop), the documented path, url, strategy, category=performance and the key sent", mine.length === 4 && mine.every((h) => h.path === "/pagespeedonline/v5/runPagespeed" && h.q.category === "performance" && h.q.key === KEY && /^https:\/\/example-psi-test\.test\//.test(h.q.url)) && mine.map((h) => h.q.strategy).join() === "mobile,desktop,mobile,desktop", JSON.stringify(mine.map((h) => ({ ...h, q: { ...h.q, key: h.q.key ? "set" : undefined } }))));
    const m0 = doc.pages[0] || {}, d0 = doc.pages[1] || {};
    check("file shape: { generatedAt, pages:[{ url, strategy, performance, lcpMs, cls, tbtMs, fcpMs, speedIndexMs, fetchedAt, cacheFile }] }", !Number.isNaN(Date.parse(doc.generatedAt)) && doc.pages.length === 4 && doc.pages.every((p) => ["url", "strategy", "performance", "lcpMs", "cls", "tbtMs", "fcpMs", "speedIndexMs", "fetchedAt", "cacheFile"].every((k) => k in p)) && Array.isArray(doc.failures), JSON.stringify(doc).slice(0, 400));
    check("score is written 0..100 (0.94 -> 94, 0.99 -> 99), not 0..1", m0.performance === 94 && d0.performance === 99 && m0.strategy === "mobile" && d0.strategy === "desktop", `${m0.performance} ${d0.performance}`);
    check("vitals read from the audits' numericValue: LCP 2750 ms, CLS 0.012, TBT 121 ms, FCP 1800 ms, speed index 2401 ms", m0.lcpMs === 2750 && m0.cls === 0.012 && m0.tbtMs === 121 && m0.fcpMs === 1800 && m0.speedIndexMs === 2401 && d0.lcpMs === 900, JSON.stringify(m0));
    check("each row names its cache file, and the file exists", doc.pages.every((p) => typeof p.cacheFile === "string" && fs.existsSync(path.join(pewpOf(c2), p.cacheFile))), JSON.stringify(doc.pages.map((p) => p.cacheFile)));
    check('one line per page: "psi <strategy> <url>: performance N, LCP N ms"', r2.so.includes(`psi mobile ${site("/")}: performance 94, LCP 2750 ms`) && r2.so.includes(`psi desktop ${site("/about")}: performance 99, LCP 900 ms`), r2.so);
    const gaps = mine.slice(1).map((h, i) => h.t - mine[i].t);
    check(`pacing: every request is at least the gap (${GAP} ms) after the previous one, on the server's clock`, mine.length === 4 && gaps.every((g) => g >= GAP * 0.9), `gaps ${gaps.join(", ")} ms`);
    const cacheFiles = walk(path.join(pewpOf(c2), "cache", "psi"));
    const all = walk(c2).map((f) => [f, fs.readFileSync(f, "utf8")]);
    check("the key is in no cache file (4 cache files, each with a stored address that says key=REDACTED)", cacheFiles.length === 4 && cacheFiles.every((f) => { const t = fs.readFileSync(f, "utf8"); return !t.includes(KEY) && !t.includes(encodeURIComponent(KEY)) && /key=REDACTED/.test(J(f).url); }), `${cacheFiles.length} files; ${cacheFiles.filter((f) => fs.readFileSync(f, "utf8").includes(KEY)).join(", ")}`);
    check("the key is in no file under the working folder, and not in stdout or stderr", !all.some(([, t]) => t.includes(KEY)) && !r2.so.includes(KEY) && !r2.se.includes(KEY), all.filter(([, t]) => t.includes(KEY)).map(([f]) => f).join(", "));

    // ---- 3. cache: the same run again asks nobody ----
    const h3 = hits.length;
    const t3 = Date.now();
    const r3 = await runPsi([site("/"), site("/about"), "--cwd", c2, "--today", "2026-10-26", "--gap-ms", String(GAP), "--dotenv", envFile]);
    check("second run the same day: answered from the cache (no request, no gap wait), same numbers", r3.code === 0 && hits.length === h3 && Date.now() - t3 < GAP * 3 + 4000 && /performance 94/.test(r3.so) && J(file2).pages.length === 4, `exit ${r3.code}; ${hits.length - h3} requests; ${r3.so}${r3.se}`);

    // ---- 4. a 429 stops the run ----
    const c4 = fresh("quota"), h4 = hits.length;
    const r4 = await runPsi([site("/ok"), site("/429"), site("/after"), "--cwd", c4, "--strategy", "mobile", "--gap-ms", "50", "--dotenv", envFile]);
    const mine4 = hits.slice(h4);
    const f4 = walk(path.join(pewpOf(c4), "psi"));
    check("429: exit 1 with the message (Google answered 429, stopped, which page)", r4.code === 1 && /429/.test(r4.se) && /stopped/i.test(r4.se) && /\/429/.test(r4.se), `exit ${r4.code} ${r4.so}${r4.se}`);
    check("429: the page after it is never asked (2 requests, not 3)", mine4.length === 2 && !mine4.some((h) => /\/after/.test(h.q.url)), mine4.map((h) => h.q.url).join(" "));
    check("429: what was measured before it is kept in the result file", f4.length === 1 && J(f4[0]).pages.length === 1 && J(f4[0]).pages[0].performance === 94, f4.join(", "));

    // ---- 5. one page fails, the others go on ----
    const c5 = fresh("partial"), h5 = hits.length;
    const r5 = await runPsi([site("/noscore"), site("/ok2"), site("/bad"), "--cwd", c5, "--strategy", "mobile", "--gap-ms", "0", "--dotenv", envFile]);
    const f5 = walk(path.join(pewpOf(c5), "psi")), d5 = f5.length ? J(f5[0]) : { pages: [], failures: [] };
    check("a page that fails does not stop the others: exit 0, the good page written, the 2 failures listed", r5.code === 0 && d5.pages.length === 1 && d5.pages[0].performance === 94 && d5.failures.length === 2 && hits.length - h5 === 3, `exit ${r5.code}; ${JSON.stringify(d5.failures)}; ${r5.so}${r5.se}`);
    check("a failure message from Google that repeats the request address does not carry the key (stdout, stderr, result file)", !r5.so.includes(KEY) && !r5.se.includes(KEY) && !(f5.length && fs.readFileSync(f5[0], "utf8").includes(KEY)) && /Invalid request/.test(r5.so) && /\[key removed\]/.test(r5.so), r5.so);

    // ---- 6. every page failed ----
    const c6 = fresh("allfail");
    const r6 = await runPsi([site("/bad"), "--cwd", c6, "--strategy", "mobile", "--gap-ms", "0", "--dotenv", envFile]);
    check("every page failed: exit 1, nothing written, the key not shown", r6.code === 1 && !fs.existsSync(path.join(pewpOf(c6), "psi")) && /every page failed/.test(r6.so) && !r6.so.includes(KEY) && !r6.se.includes(KEY), `exit ${r6.code} ${r6.so}${r6.se}`);

    // ---- 7. a server that never answers is cut off ----
    const c7 = fresh("hang"), t7 = Date.now();
    const r7 = await runPsi([site("/hang"), "--cwd", c7, "--strategy", "mobile", "--gap-ms", "0", "--dotenv", envFile], { env: { PSI_TIMEOUT_MS: "600" }, timeout: 20000 });
    check("a request that never gets an answer is cut off (bounded), reported as a failed page, exit 1", r7.code === 1 && /no answer within/.test(r7.so) && Date.now() - t7 < 15000, `exit ${r7.code} after ${Date.now() - t7} ms; ${r7.so}${r7.se}`);

    // ---- 7b. --runs: several runs per page and strategy, every run kept, the median recorded ----
    const c11 = fresh("runs"), h11 = hits.length;
    const r11 = await runPsi([site("/vary"), "--cwd", c11, "--today", "2026-10-26", "--strategy", "mobile", "--runs", "3", "--gap-ms", "0", "--run-gap-ms", "500", "--dotenv", envFile]);
    const mine11 = hits.slice(h11), file11 = path.join(pewpOf(c11), "psi", "2026-10-26.json");
    const doc11 = fs.existsSync(file11) ? J(file11) : { pages: [] }, row11 = doc11.pages[0] || {};
    check("runs: --runs 3 asks Google three times for the same page and strategy (3 requests, exit 0)", r11.code === 0 && mine11.length === 3 && mine11.every((x) => x.q.strategy === "mobile" && /\/vary$/.test(x.q.url)), `exit ${r11.code} ${mine11.length} requests ${r11.so}${r11.se}`);
    check("runs: the row holds the MEDIAN of the three runs (scores 70, 95, 80 -> 80 (the mean would be 81.7); LCP 3000, 1000, 2500 -> 2500 ms (mean 2167); CLS 0.3, 0.05, 0.2 -> 0.2 (mean 0.183)) and says it is a median of 3", doc11.pages.length === 1 && row11.performance === 80 && row11.lcpMs === 2500 && row11.cls === 0.2 && row11.medianOf === 3 && row11.runsAsked === 3, JSON.stringify(row11).slice(0, 500));
    check("runs: every run is listed with its own numbers and its own cache file (3 different files, all exist): the median is never the only record", Array.isArray(row11.runs) && row11.runs.length === 3 && row11.runs.map((x) => x.performance).join() === "70,95,80" && new Set(row11.runs.map((x) => x.cacheFile)).size === 3 && row11.runs.every((x) => x.cacheFile && fs.existsSync(path.join(pewpOf(c11), x.cacheFile))), JSON.stringify(row11.runs));
    check("runs: the row's own cacheFile is the median run's file (score 80, the third run)", row11.cacheFile === (row11.runs || [])[2]?.cacheFile && !!row11.cacheFile, JSON.stringify([row11.cacheFile, row11.runs]));
    const gaps11 = mine11.slice(1).map((x, i) => x.t - mine11[i].t);
    check("runs: two runs of the same page and strategy are at least --run-gap-ms (500) apart on the server's clock (Google may answer a repeat within about 30 s from one analysis)", gaps11.length === 2 && gaps11.every((g) => g >= 450), `gaps ${gaps11.join(", ")}`);
    check('runs: the output says it is a median: "median of 3: performance 80, LCP 2500 ms"', /median of 3: performance 80, LCP 2500 ms/.test(r11.so), r11.so);
    const h12 = hits.length;
    const r12 = await runPsi([site("/vary"), "--cwd", c11, "--today", "2026-10-26", "--strategy", "mobile", "--runs", "3", "--gap-ms", "0", "--run-gap-ms", "500", "--dotenv", envFile]);
    check("runs: the same run again the same day is answered from the three cache files (no request) with the same median", r12.code === 0 && hits.length === h12 && J(file11).pages[0].performance === 80 && J(file11).pages[0].runs.length === 3, `exit ${r12.code}; ${hits.length - h12} requests; ${r12.so}${r12.se}`);
    const c13 = fresh("flaky"), h13 = hits.length;
    const r13 = await runPsi([site("/flaky"), "--cwd", c13, "--today", "2026-10-26", "--strategy", "mobile", "--runs", "3", "--gap-ms", "0", "--run-gap-ms", "0", "--dotenv", envFile]);
    const f13 = path.join(pewpOf(c13), "psi", "2026-10-26.json"), doc13 = fs.existsSync(f13) ? J(f13) : { pages: [], failures: [] }, row13 = doc13.pages[0] || {};
    check("runs: a run that fails is listed (with its run number) and the median is taken over the runs that worked, saying so (2 of 3: scores 70 and 80 -> 75)", r13.code === 0 && hits.length - h13 === 3 && row13.medianOf === 2 && row13.runsAsked === 3 && row13.performance === 75 && doc13.failures.length === 1 && doc13.failures[0].run === 2, `exit ${r13.code} ${JSON.stringify(row13).slice(0, 300)} ${JSON.stringify(doc13.failures)}`);
    const c14 = fresh("one"), h14 = hits.length;
    const r14 = await runPsi([site("/one"), "--cwd", c14, "--today", "2026-10-26", "--strategy", "mobile", "--gap-ms", "0", "--dotenv", envFile]);
    const f14 = path.join(pewpOf(c14), "psi", "2026-10-26.json"), row14 = (fs.existsSync(f14) ? J(f14) : { pages: [] }).pages[0] || {};
    check("runs: without --runs it is one request, medianOf 1, and the line is the old one", r14.code === 0 && hits.length - h14 === 1 && row14.medianOf === 1 && /^psi mobile .*: performance 94, LCP 2750 ms$/m.test(r14.so), `${hits.length - h14} requests ${JSON.stringify(row14).slice(0, 200)} ${r14.so}`);
    const badRuns = [];
    for (const v of ["0", "abc", "9", "2.5"]) { const r = await runPsi([site("/x"), "--runs", v, "--dotenv", envFile]); if (!(r.code === 2 && /--runs/.test(r.se))) badRuns.push(`${v}: exit ${r.code} ${r.se}`); }
    check("runs: --runs must be a whole number from 1 to 5 (exit 2, nothing fetched)", !badRuns.length, badRuns.join(" | "));

    // ---- 8. key from the process environment; usage errors ----
    const c8 = fresh("envkey"), h8 = hits.length;
    const r8 = await runPsi([site("/e"), "--cwd", c8, "--strategy", "desktop", "--gap-ms", "0"], { env: { PSI_API_KEY: KEY } });
    check("the key from the process environment works too (desktop only: 1 request)", r8.code === 0 && hits.length - h8 === 1 && hits[hits.length - 1].q.strategy === "desktop" && hits[hits.length - 1].q.key === KEY, `exit ${r8.code} ${r8.so}${r8.se}`);
    const h9 = hits.length, bad = [];
    for (const [label, argv, re] of [
      ["--help", ["--help"], null],
      ["not an address", ["example.com", "--dotenv", envFile], /not an http/],
      ["bad strategy", [site(), "--strategy", "tablet", "--dotenv", envFile], /--strategy/],
      ["bad --today", [site(), "--today", "yesterday", "--dotenv", envFile], /--today/],
      ["gap not a number", [site(), "--gap-ms", "abc", "--dotenv", envFile], /--gap-ms/],
      ["missing --dotenv file", [site(), "--dotenv", path.join(envDir, "nope.env")], /no such file/],
    ]) {
      const r = await runPsi(argv, { env: label === "--help" ? {} : {} });
      const ok = label === "--help" ? r.code === 0 && /usage/i.test(r.so) : r.code === 2 && re.test(r.se);
      if (!ok) bad.push(`${label}: exit ${r.code} ${r.so}${r.se}`.slice(0, 200));
    }
    check("usage: --help prints the usage (exit 0); a bad address / strategy / date / gap / missing .env file is exit 2", !bad.length && hits.length === h9, `${bad.join(" | ")}; ${hits.length - h9} requests`);
    // the real Google address: a gap below the polite minimum is refused before any request (PSI_API_BASE unset; nothing leaves this machine)
    const r10 = await runPsi([site(), "--gap-ms", "10", "--dotenv", envFile], { env: { PSI_API_BASE: "" } });
    check("to the real Google address a gap below 1000 ms is refused (exit 2, polite minimum), nothing fetched", r10.code === 2 && /polite minimum/.test(r10.se), `exit ${r10.code} ${r10.so}${r10.se}`);
  } finally {
    for (const s of sockets) s.destroy();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
  return results;
}

// ---------------- mutants ----------------
const SCRUB_FROM = "for (const k of new Set([key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)])) if (k) t = t.split(k).join(\"[key removed]\");";
const MUTANTS = [
  { name: "score not multiplied by 100", patches: [{ file: "psi.mjs", from: "performance: Math.round(score * 100),", to: "performance: Math.round(score)," }], expect: [/^score is written 0\.\.100/, /^one line per page/] },
  { name: "pacing removed", patches: [{ file: "psi.mjs", from: "if (wait > 0 && !(await isCached(loc.pewp, reqUrl, run))) await sleep(wait);", to: "" }], expect: [/^pacing: every request/] },
  { name: "the gap is not remembered after a request", patches: [{ file: "psi.mjs", from: "if (!res.fromCache) { nextAt = Date.now() + gapMs; lastAt.set(pk, Date.now()); }", to: "if (false) { nextAt = Date.now() + gapMs; lastAt.set(pk, Date.now()); }" }], expect: [/^pacing: every request/] },
  { name: "key stored in the cache file (redaction gone) and psi.mjs does not look", patches: [
    { file: "cache.mjs", from: "const shownUrl = url.replace(/([?&](key|api_key|apikey|token|access_token)=)[^&]+/gi, \"$1REDACTED\");", to: "const shownUrl = url;" },
    { file: "psi.mjs", from: "if ([key, encodeURIComponent(key)].some((k) => stored.includes(k)))", to: "if (false)" }], expect: [/^the key is in no cache file/, /^the key is in no file under the working folder/] },
  { name: "key stored in the cache file (redaction gone): psi.mjs notices, deletes it and refuses", patches: [
    { file: "cache.mjs", from: "const shownUrl = url.replace(/([?&](key|api_key|apikey|token|access_token)=)[^&]+/gi, \"$1REDACTED\");", to: "const shownUrl = url;" }], expect: [/^main run: exit 0/] },
  { name: "Google's error message is printed unscrubbed", patches: [{ file: "psi.mjs", from: SCRUB_FROM, to: "" }], expect: [/^a failure message from Google/, /^every page failed/] },
  { name: "429 does not stop the run", patches: [{ file: "psi.mjs", from: "if (res.status === 429) throw new Stop429(", to: "if (false) throw new Stop429(" }], expect: [/^429: the page after it is never asked/] },
  { name: "the request is not bounded", patches: [{ file: "psi.mjs", from: "{ maxAgeDays: 1, timeoutMs, variant:", to: "{ maxAgeDays: 1, timeoutMs: 1e9, variant:" }], expect: [/^a request that never gets an answer/] },
  { name: "--runs asks once whatever it is given", patches: [{ file: "psi.mjs", from: "for (let run = 1; run <= runs; run++) {", to: "for (let run = 1; run <= 1; run++) {" }], expect: [/^runs: --runs 3 asks Google three times/, /^runs: the row holds the MEDIAN/] },
  { name: "the three runs share one cache entry (the second and third are answered from the first)", patches: [{ file: "psi.mjs", from: "variant: run > 1 ? `run${run}` : undefined", to: "variant: undefined" }], expect: [/^runs: --runs 3 asks Google three times/, /^runs: the row holds the MEDIAN/] },
  { name: "the median is the first run", patches: [{ file: "psi.mjs", from: "const med = (xs) => {", to: "const med = (xs) => { if (xs.length) return xs[0];" }], expect: [/^runs: the row holds the MEDIAN/, /^runs: a run that fails is listed/] },
  { name: "the mean instead of the median", patches: [{ file: "psi.mjs", from: "return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;", to: "return v.reduce((x, y) => x + y, 0) / v.length;" }], expect: [/^runs: the row holds the MEDIAN/] },
  { name: "the runs of a page are not listed (only the median is kept)", patches: [{ file: "psi.mjs", from: "runs: list.map(({ run, ...x }) => ({ run, ...x })),", to: "runs: []," }], expect: [/^runs: every run is listed/, /^runs: the row's own cacheFile/] },
  { name: "no gap between two runs of the same page", patches: [{ file: "psi.mjs", from: "const sameWait = (lastAt.get(pk) || 0) + runGapMs - Date.now();", to: "const sameWait = 0;" }], expect: [/^runs: two runs of the same page/] },
  { name: "a failed run is not recorded with its run number", patches: [{ file: "psi.mjs", from: "failures.push({ url, strategy, run, error: scrub(why) });", to: "failures.push({ url, strategy, error: scrub(why) });" }], expect: [/^runs: a run that fails is listed/] },
  { name: "--runs is not validated", patches: [{ file: "psi.mjs", from: "if (runs > 5) throw new Usage(", to: "if (false) throw new Usage(" }], expect: [/^runs: --runs must be a whole number/] },
  { name: "no key does not block", patches: [{ file: "psi.mjs", from: "if (!key) throw new Blocked(UNBLOCK);", to: "" }], expect: [/^no key: BLOCKED/, /^no key: no request/] },
  { name: "the polite minimum gap is not enforced", patches: [{ file: "psi.mjs", from: "politeMs(\"--gap-ms\", numArg(", to: "((n, v) => v)(\"--gap-ms\", numArg(" }], expect: [/^to the real Google address/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-psi.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  const t0 = Date.now();
  const main = await scenarios(scriptsDir);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  let failed = main.filter((r) => !r.ok).length; const mainFailed = failed; let caught = 0, ran = 0;
  console.log(failed ? `PSI TEST FAIL: ${failed} of ${main.length}` : `PSI TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-psi-mutant-"));
      const sdir = path.join(mdir, "scripts");
      for (let t = 0; ; t++) { try { fs.mkdirSync(sdir, { recursive: true }); fs.cpSync(scriptsDir, sdir, { recursive: true }); break; } catch (e) { if (t >= 4) throw e; } }
      let applied = true;
      for (const p of mu.patches) {
        const target = path.join(sdir, p.file), src = fs.readFileSync(target, "utf8"), count = src.split(p.from).length - 1;
        if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${p.file} (the patch did not apply)`); failed++; applied = false; break; }
        fs.writeFileSync(target, src.replace(p.from, () => p.to));
      }
      if (!applied) { fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 }); continue; }
      let res;
      try { res = await scenarios(sdir); } catch (e) { res = [{ name: `crashed: ${e.message}`, ok: false }]; }
      const red = res.filter((r) => !r.ok);
      const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  if (A.includes("--json")) console.log(JSON.stringify({ suite: "psi", ok: !failed, assertions: { total: main.length, failed: mainFailed }, mutants: ran ? { ran, caught, failed: ran - caught } : null, wallMs: Date.now() - t0 }));
  process.exit(failed ? 1 : 0);
}
