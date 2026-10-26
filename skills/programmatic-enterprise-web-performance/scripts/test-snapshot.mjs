// Usage: node test-snapshot.mjs [--script <path to snapshot-site.mjs>] [--no-browser] [--no-mutants] [--mutant <name part>]
// Runs snapshot-site.mjs against a local fake site and checks what it saved. Exit 0 = all pass.
// Covers: robots.txt obeyed, sitemap read, 429 waits and retries once, a second 429 stops the run (exit 3), the 429 allowance is
// per run (a 429 on another address is the second), --gap-ms holds between every request, bad numbers / impolite gaps are exit 2,
// redirect chain recorded, 404 probe, a 300 KB inline script elided so the page fits, JSON-LD kept,
// and (unless --no-browser) real Chrome lab numbers on the home page.
// G9 (machine load, contract C8; needs Chrome): PEWP_TEST_CPU_PCT is the sampler's test hook (a fixed reading instead of os.cpus()). Busy ->
// every measured page speedTrust "UNTRUSTED: machine busy (cpu avg N%)" and the summary line says UNTRUSTED; idle -> "trusted";
// --busy-threshold moves the line; a real reading is a number 0..100; --no-browser samples nothing (machineLoad null).
// Watched-fail mutants for G9 (a copy of the scripts folder is patched, the G9 runs repeated, the named assertions must turn red):
// threshold ignored (per page / in the summary / in _site.json), untrusted never marked, summary line gone. Not run with --no-browser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(args.includes("--script") ? args[args.indexOf("--script") + 1] : path.join(here, "snapshot-site.mjs"));
const browser = !args.includes("--no-browser");

const big = "var x='" + "a".repeat(300 * 1024) + "';";
let flaky = 0;
let gzMode = false;
const pages = {
  "/": `<!doctype html><html lang="en"><head><title>Home</title><meta name="description" content="d"><script type="application/ld+json">{"@context":"https://schema.org","@type":"RealEstateAgent","name":"T"}</script></head><body><h1>Home</h1><img src="/i.svg" alt="x" width="300" height="200"><a href="/a">A</a><script>navigator.serviceWorker && navigator.serviceWorker.register('/sw.js')</script></body></html>`,
  "/a": `<!doctype html><html><head><title>A</title></head><body><h1>A</h1>    \n\n   <img alt="s" srcset="/i.svg 100w, /i.svg 200w, /i.svg 300w"></body></html>`,
  "/big": `<!doctype html><html><head><title>Big</title></head><body><h1>Big</h1><script>${big}</script></body></html>`,
  "/private": `<!doctype html><html><head><title>P</title></head><body>secret</body></html>`,
};
let hits = 0;
let offLimitsHits = 0;
const hitLog = []; // [ms, path] of every request, for the gap checks
const rl = {}; // /rl-*: a 429 the FIRST time each address is asked (the per-run allowance check)
const rl429At = [];
const server = http.createServer((req, res) => {
  hits++;
  const u = req.url.split("?")[0];
  hitLog.push([Date.now(), u]);
  if (/^\/rl-[a-z]$/.test(u)) { if (!rl[u]) { rl[u] = 1; rl429At.push(Date.now()); res.statusCode = 429; return res.end("slow down"); } res.setHeader("content-type", "text/html"); return res.end(pages["/a"]); }
  if (u.startsWith("/offlimits")) { offLimitsHits++; res.statusCode = 403; return res.end("no"); }
  if (u === "/robots.txt" && gzMode) return res.end(`User-agent: *\nSitemap: http://127.0.0.1:${port}/sitemap-enc.xml.gz\nSitemap: http://127.0.0.1:${port}/sitemap-bad.xml.gz\n`);
  // a .xml.gz sent with Content-Encoding: gzip arrives already unpacked; a broken archive must be that sitemap's error, not a crash
  if (u === "/sitemap-enc.xml.gz") { res.setHeader("content-encoding", "gzip"); res.setHeader("content-type", "application/xml"); return res.end(zlib.gzipSync(`<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:${port}/a</loc><lastmod>2026-10-01T00:00:00Z</lastmod></url></urlset>`)); }
  if (u === "/sitemap-bad.xml.gz") { res.setHeader("content-type", "application/gzip"); return res.end(Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5, 6, 7])); }
  if (u === "/robots.txt") return res.end(`User-agent: *\nDisallow: /private\nSitemap: http://127.0.0.1:${port}/sitemap.xml\nSitemap: http://127.0.0.1:${port}/offlimits/sitemap-listings.xml\n`);
  if (u === "/sitemap.xml") { res.setHeader("content-type", "application/xml"); return res.end(`<?xml version="1.0"?><urlset>${["/", "/a", "/big", "/private"].map((p) => `<url><loc>http://127.0.0.1:${port}${p}</loc><lastmod>2026-10-01</lastmod></url>`).join("")}</urlset>`); }
  if (u === "/sw.js") { res.setHeader("content-type", "application/javascript"); return res.end("self.addEventListener('install', () => self.skipWaiting());"); }
  if (u === "/i.svg") { res.setHeader("content-type", "image/svg+xml"); return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#c33"/></svg>`); }
  if (u === "/flaky") { if (flaky++ === 0) { res.statusCode = 429; return res.end("slow down"); } res.setHeader("content-type", "text/html"); return res.end(pages["/a"]); }
  if (u === "/always429") { res.statusCode = 429; return res.end("slow down"); }
  if (u === "/hang") { res.setHeader("content-type", "text/html"); return res.end(`<!doctype html><html><head><title>Hang</title></head><body><h1>Hang</h1><script>setTimeout(function(){for(;;){}},300)</script></body></html>`); }
  if (u === "/redirect") { res.statusCode = 301; res.setHeader("location", "/a"); return res.end(); }
  if (pages[u]) { res.setHeader("content-type", "text/html"); res.setHeader("x-test", "1"); return res.end(pages[u]); }
  res.statusCode = 404; res.end("nope");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-snap-test-"));
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });
const run = (out, extra) => runRaw([base, out, "--gap-ms", "0", "--retry-wait-ms", "300", "--per-group", "5", ...extra]);
const runRaw = (argv, o = {}) => new Promise((resolve) => {
  // spawnSync would block this process's own server, so run it async.
  import("node:child_process").then(({ spawn }) => {
    const c = spawn(process.execPath, [o.script || script, ...argv], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...(o.env || {}) } });
    let so = "", se = "";
    c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
    // A crawler that never stops (for example one that retries 429s forever) must fail the test, not hang it.
    const timer = setTimeout(() => { se += "TIMED OUT after 120 s"; c.kill(); }, 120000);
    c.on("close", (code) => { clearTimeout(timer); resolve({ code, so, se }); });
  });
});
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
// ---- G9: the machine-load scenarios; run against the real script and again against each mutant ----
async function g9(scriptPath, tag) {
  const out = [];
  const ck = (name, ok, detail = "") => out.push({ name, ok: !!ok, detail });
  const go = async (n, cpu, extra = []) => {
    const o = path.join(tmp, `g9-${tag}-${n}`);
    const r = await runRaw([base, o, "--gap-ms", "0", "--retry-wait-ms", "300", "--runs", "1", "--max-pages", "1", ...extra], { script: scriptPath, env: { PEWP_TEST_CPU_PCT: String(cpu) } });
    const sj = fs.existsSync(path.join(o, "_site.json")) ? J(path.join(o, "_site.json")) : { pages: [] };
    return { r, sj, measured: sj.pages.filter((p) => p.mobile && !p.mobile.failed) };
  };
  const line = (r) => r.so.split("\n").filter((l) => /machine load/.test(l)).join(" | ") || "no summary line";
  const busy = await go("busy", 90);
  ck("G9 busy machine: exit 0, at least one page measured", busy.r.code === 0 && busy.measured.length >= 1, `exit ${busy.r.code} ${busy.r.se.slice(0, 200)}`);
  ck("G9 busy machine: machineLoad = { cpuPctAvg 90, cpuPctMax 90, samples >= 1, thresholdPct 35 }", busy.sj.machineLoad?.cpuPctAvg === 90 && busy.sj.machineLoad?.cpuPctMax === 90 && busy.sj.machineLoad?.samples >= 1 && busy.sj.machineLoad?.thresholdPct === 35, JSON.stringify(busy.sj.machineLoad));
  ck("G9 busy machine: every measured page is speedTrust \"UNTRUSTED: machine busy (cpu avg 90%)\"", busy.measured.length >= 1 && busy.measured.every((p) => p.speedTrust === "UNTRUSTED: machine busy (cpu avg 90%)"), JSON.stringify(busy.measured.map((p) => p.speedTrust)));
  ck("G9 busy machine: summary line says UNTRUSTED", /machine load during speed runs: avg 90% max 90% -> speed UNTRUSTED/.test(busy.r.so), line(busy.r));
  const idle = await go("idle", 10);
  ck("G9 idle machine: every measured page is speedTrust \"trusted\"", idle.r.code === 0 && idle.measured.length >= 1 && idle.measured.every((p) => p.speedTrust === "trusted"), `exit ${idle.r.code} ${JSON.stringify(idle.measured.map((p) => p.speedTrust))}`);
  ck("G9 idle machine: summary line says trusted and machineLoad avg 10", /machine load during speed runs: avg 10% max 10% -> speed trusted/.test(idle.r.so) && idle.sj.machineLoad?.cpuPctAvg === 10, line(idle.r));
  const thr = await go("thr", 50, ["--busy-threshold", "60"]);
  ck("G9 --busy-threshold 60 with load 50: trusted, thresholdPct 60 recorded, summary trusted", thr.measured.length >= 1 && thr.measured.every((p) => p.speedTrust === "trusted") && thr.sj.machineLoad?.thresholdPct === 60 && /-> speed trusted/.test(thr.r.so), `${JSON.stringify(thr.measured.map((p) => p.speedTrust))} ${JSON.stringify(thr.sj.machineLoad)}`);
  return out;
}
try {
  const o1 = path.join(tmp, "one");
  const r1 = await run(o1, ["--include", "/flaky,/redirect", ...(browser ? [] : ["--no-browser"])]);
  check("run 1 exits 0", r1.code === 0, `exit ${r1.code} ${r1.se.slice(0, 300)}`);
  const site = fs.existsSync(path.join(o1, "_site.json")) ? J(path.join(o1, "_site.json")) : { pages: [], skipped: [] };
  check("robots.txt obeyed (/private skipped)", site.skipped.some((s) => /private/.test(s.url) && /robots/.test(s.why)) && !site.pages.some((p) => /private/.test(p.url)));
  check("sitemap read", fs.existsSync(path.join(o1, "site/sitemaps.json")) && J(path.join(o1, "site/sitemaps.json")).urlCount === 4);
  const fl = site.pages.find((p) => /flaky/.test(p.url));
  check("one 429 waits and retries", fl && fl.status === 200 && site.rateLimited === 1, JSON.stringify(fl));
  const rd = site.pages.find((p) => /redirect/.test(p.url));
  check("redirect chain recorded", rd && rd.redirects === 1 && fs.existsSync(path.join(o1, `pages/${rd.slug}/response.json`)) && J(path.join(o1, `pages/${rd.slug}/response.json`)).chain[0].status === 301);
  check("404 probe", J(path.join(o1, "site/probes.json")).notFound.finalStatus === 404);
  const bigBody = path.join(o1, "pages/big/body.html");
  check("300 KB inline script elided, page fits", fs.existsSync(bigBody) && fs.statSync(bigBody).size < 10000 && /PEWP: script #1 \d+ bytes elided/.test(fs.readFileSync(bigBody, "utf8")) && J(path.join(o1, "pages/big/inline.json")).body[0].bytes > 300000);
  check("full HTML kept as .gz", fs.existsSync(path.join(o1, "pages/big/raw.html.gz")) && zlib.gunzipSync(fs.readFileSync(path.join(o1, "pages/big/raw.html.gz"))).length > 300000);
  check("JSON-LD kept whole", /RealEstateAgent/.test(fs.readFileSync(path.join(o1, "pages/home/head.html"), "utf8")));
  check("headers saved", J(path.join(o1, "pages/home/response.json")).headers["x-test"] === "1");
  check("mainTextHash recorded per page (AEO-012 across snapshots) and sitemap lastmod kept per URL", /^[0-9a-f]{64}$/.test(J(path.join(o1, "pages/home/response.json")).mainTextHash || "") && J(path.join(o1, "pages/home/response.json")).mainTextHash !== J(path.join(o1, "pages/big/response.json")).mainTextHash && Array.isArray(J(path.join(o1, "site/sitemaps.json")).urls) && "lastmod" in J(path.join(o1, "site/sitemaps.json")).urls[0], JSON.stringify(J(path.join(o1, "pages/home/response.json")).mainTextHash));
  const aBody = fs.existsSync(path.join(o1, "pages/a/body.html")) ? fs.readFileSync(path.join(o1, "pages/a/body.html"), "utf8") : "";
  check("srcset trimmed to first + count", /PEWP: \+2 more candidates/.test(aBody) && !/200w/.test(aBody));
  check("whitespace collapsed", !/ {2,}/.test(aBody) && !/\n\n/.test(aBody));
  if (browser) {
    const b = fs.existsSync(path.join(o1, "pages/home/browser-mobile.json")) ? J(path.join(o1, "pages/home/browser-mobile.json")) : null;
    check("browser: 3 runs, median kept", b && b.runs?.length === 3 && b.vitals.lcpMs === [...b.runs.map((r) => r.lcpMs)].sort((x, y) => x - y)[1] || (b && Math.abs(b.vitals.lcpMs - [...b.runs.map((r) => r.lcpMs)].sort((x, y) => x - y)[1]) < 1), b && JSON.stringify(b.runs));
    check("browser: LCP measured", b && b.vitals.lcpMs > 0, b && JSON.stringify(b.vitals));
    check("browser: page summary", b && b.page.h1Count === 1 && b.page.structuredData[0]?.types.includes("RealEstateAgent") && b.page.images.count === 1);
    check("browser: requests listed", b && b.totals.requests >= 2 && b.document?.status === 200);
    const swf = fs.existsSync(path.join(o1, "site/serviceworkers.json")) ? J(path.join(o1, "site/serviceworkers.json")) : null;
    check("browser: service workers recorded for REF-013", swf && Array.isArray(swf.registrations) && swf.registrations.some((r) => /sw\.js$/.test(r.scriptURL)), JSON.stringify(swf));
  }
  check("excludes recorded in _site.json", Array.isArray(site.excludes));
  if (browser) {
    const ml = site.machineLoad, pg = site.pages.filter((p) => p.mobile && !p.mobile.failed);
    check("G9 real sampler (no test hook): machineLoad has a 0..100 average and max, samples >= 1, thresholdPct 35", ml && ml.samples >= 1 && ml.cpuPctAvg >= 0 && ml.cpuPctAvg <= 100 && ml.cpuPctMax >= ml.cpuPctAvg && ml.cpuPctMax <= 100 && ml.thresholdPct === 35, JSON.stringify(ml));
    check("G9 real sampler: every measured page carries speedTrust (trusted or UNTRUSTED: machine busy ...)", pg.length >= 1 && pg.every((p) => /^(trusted|UNTRUSTED: machine busy \(cpu avg \d+%\))$/.test(p.speedTrust)), JSON.stringify(pg.map((p) => p.speedTrust)));
    check("G9 real sampler: the run printed its machine-load summary line", /machine load during speed runs: avg \d+% max \d+% -> speed (trusted|UNTRUSTED)/.test(r1.so), r1.so.split("\n").filter((l) => /machine load|SNAPSHOT/.test(l)).join(" | "));
  }
  // An off-limits path listed as a sitemap in robots.txt must not be fetched either.
  const o5 = path.join(tmp, "five");
  const before5 = offLimitsHits;
  const r5 = await run(o5, ["--exclude", "^/offlimits", "--no-browser", "--max-pages", "2"]);
  check("--exclude covers sitemaps from robots.txt (never requested)", r5.code === 0 && offLimitsHits === before5, `exit ${r5.code}; off-limits requests ${offLimitsHits - before5}`);
  check("G9 --no-browser: no speed runs, so nothing is sampled (machineLoad null, no summary line, no speedTrust)", J(path.join(o5, "_site.json")).machineLoad === null && !/machine load/.test(r5.so) && !J(path.join(o5, "_site.json")).pages.some((p) => "speedTrust" in p), JSON.stringify(J(path.join(o5, "_site.json")).machineLoad));
  const o3 = path.join(tmp, "three");
  const before = hits;
  const r3 = await run(o3, ["--exclude", "^C:/Program Files/Git/private", "--no-browser"]);
  check("shell-rewritten exclude refused before any request", r3.code === 2 && /REFUSED/.test(r3.se) && hits === before, `exit ${r3.code}, ${hits - before} requests`);
  if (browser) {
    // A page whose script locks the browser forever must not hold the run: it is recorded and the run finishes.
    const o4 = path.join(tmp, "four");
    const t4 = Date.now();
    const r4 = await run(o4, ["--include", "/hang", "--runs", "1", "--page-cap-s", "25", "--max-pages", "3"]);
    const s4 = fs.existsSync(path.join(o4, "_site.json")) ? J(path.join(o4, "_site.json")) : {};
    check("frozen page: run still finishes (exit 0) and records the failure", r4.code === 0 && (s4.browserFailures || []).some((f) => /hang/.test(f.url)), `exit ${r4.code} after ${Math.round((Date.now() - t4) / 1000)} s; failures ${JSON.stringify(s4.browserFailures)}; ${r4.se.slice(-200)}`);
    check("frozen page: the next page is still measured", s4.pages && s4.pages.filter((p) => p.mobile && !p.mobile.failed).length >= 1, JSON.stringify((s4.pages || []).map((p) => [p.slug, p.mobile])));
  }
  gzMode = true;
  const o7 = path.join(tmp, "gz");
  const r7 = await run(o7, ["--no-browser", "--max-pages", "1"]);
  gzMode = false;
  const sm7 = fs.existsSync(path.join(o7, "site/sitemaps.json")) ? J(path.join(o7, "site/sitemaps.json")) : { fetched: [] };
  const enc7 = sm7.fetched.find((f) => /sitemap-enc/.test(f.url)), bad7 = sm7.fetched.find((f) => /sitemap-bad/.test(f.url));
  check("sitemap .xml.gz already unpacked by Content-Encoding is read; a broken .gz is that sitemap's error, the run goes on (exit 0)", r7.code === 0 && enc7?.entries === 1 && /could not unpack/.test(bad7?.error || "") && sm7.urlCount === 1, `exit ${r7.code} ${JSON.stringify(sm7.fetched)} ${r7.se.slice(-300)}`);
  const o2 = path.join(tmp, "two");
  const r2 = await run(o2, ["--include", "/always429", "--no-browser"]);
  const s2 = fs.existsSync(path.join(o2, "_site.json")) ? J(path.join(o2, "_site.json")) : {};
  check("second 429 stops the run (exit 3)", r2.code === 3 && /second 429/.test(s2.stoppedEarly || ""), `exit ${r2.code} ${s2.stoppedEarly}`);
  // Politeness numbers are checked before anything happens: a value that is not a number (it used to become NaN = a ~1 ms gap) is a
  // usage error, and to a host this machine does not serve a gap / 429 wait below the polite minimum is refused too.
  const hitsN = hits, bad = [];
  for (const extra of [["--gap-ms", "abc"], ["--retry-wait-ms", "abc"], ["--max-pages", "x"], ["--runs", "0"], ["--page-cap-s", ""], ["--max-minutes", "-1"], ["--per-group", "1.5"], ["--gap-ms"]]) {
    const o = path.join(tmp, `bad-${bad.length}`), r = await runRaw([base, o, "--no-browser", ...extra]);
    if (r.code !== 2 || fs.existsSync(o)) bad.push(`${extra.join(" ")} -> exit ${r.code}${fs.existsSync(o) ? " (wrote the out folder)" : ""} ${r.se.slice(0, 120)}`);
  }
  check("a numeric option that is not a valid number is a usage error (exit 2) before any request", !bad.length && hits === hitsN, `${bad.join(" | ")}; ${hits - hitsN} requests`);
  const remote = [];
  for (const extra of [["--gap-ms", "10"], ["--gap-ms", "999"], ["--retry-wait-ms", "2000"]]) {
    const o = path.join(tmp, `remote-${remote.length}`), r = await runRaw(["http://pewp-not-a-real-site.invalid/", o, "--no-browser", ...extra]);
    if (r.code !== 2 || !/polite minimum/.test(r.se) || fs.existsSync(o)) remote.push(`${extra.join(" ")} -> exit ${r.code} ${r.se.slice(0, 160)}`);
  }
  check("to a site this machine does not serve, --gap-ms below 1000 or --retry-wait-ms below 90000 is refused (exit 2, nothing fetched)", !remote.length, remote.join(" | "));
  // The gap holds between EVERY request of a run (robots, sitemap, probes, pages), measured on the server's clock.
  const og = path.join(tmp, "gap"), from = hitLog.length;
  const rg = await runRaw([base, og, "--gap-ms", "400", "--retry-wait-ms", "300", "--no-browser", "--max-pages", "3"]);
  const ts = hitLog.slice(from).map((h) => h[0]), gaps = ts.slice(1).map((t, i) => t - ts[i]);
  // (server clock: the first request also carries the connection set-up, so the gap after it can read ~30 ms short)
  const sortedGaps = [...gaps].sort((x, y) => x - y);
  check("--gap-ms 400: every request of the run is at least ~400 ms after the previous one", rg.code === 0 && gaps.length >= 5 && sortedGaps[0] >= 340 && sortedGaps[Math.floor(gaps.length / 2)] >= 395,`exit ${rg.code}; ${gaps.length} gaps, min ${Math.min(...gaps)} ms: ${JSON.stringify(gaps)}`);
  // ONE 429 allowance per RUN: the first 429 (on /rl-a or /rl-b) pauses everything for the retry wait, the 429 on the OTHER address
  // is the run's second and stops it (per address, both would have been retried and the run would end 0).
  const orl = path.join(tmp, "rl"), fromRl = hitLog.length; rl429At.length = 0;
  const rr = await runRaw([base, orl, "--gap-ms", "0", "--retry-wait-ms", "1500", "--no-browser", "--max-pages", "6", "--include", "/rl-a,/rl-b"]);
  const srl = fs.existsSync(path.join(orl, "_site.json")) ? J(path.join(orl, "_site.json")) : {};
  const after = hitLog.slice(fromRl).find((h) => h[0] > rl429At[0]);
  check("429 allowance is per RUN: a 429 on a second address stops the run (exit 3) after one retry of the first", rr.code === 3 && /second 429 in this run/.test(srl.stoppedEarly || "") && srl.rateLimited === 2 && rl429At.length === 2, `exit ${rr.code}; ${srl.stoppedEarly}; rateLimited ${srl.rateLimited}; 429s ${rl429At.length}`);
  check("the first 429 pauses EVERY request for --retry-wait-ms (next request >= ~1500 ms later)", after && after[0] - rl429At[0] >= 1450, after ? `next request ${after[0] - rl429At[0]} ms after the 429 (${after[1]})` : "no request after the 429");
  // The run time cap holds for the server pass too: with the cap already passed, not even robots.txt is requested.
  const o6 = path.join(tmp, "cap"), hits6 = hits;
  const r6 = await run(o6, ["--max-minutes", "0", "--no-browser"]);
  const s6 = J(path.join(o6, "_site.json"));
  check("--max-minutes caps the server pass too (exit 4, nothing requested past the cap)", r6.code === 4 && /time cap/.test(s6.stoppedEarly || "") && hits === hits6 && s6.pages.length === 0, `exit ${r6.code} ${s6.stoppedEarly}; ${hits - hits6} requests`);
  if (browser) {
    for (const r of await g9(script, "real")) check(r.name, r.ok, r.detail);
    // ---- watched-fail mutants for G9 ----
    const MUTANTS = [
      { name: "threshold ignored per page (35 hard-coded)", from: "avg > busyPct ? `UNTRUSTED: machine busy", to: "avg > 35 ? `UNTRUSTED: machine busy", expect: [/^G9 --busy-threshold 60/] },
      { name: "threshold ignored: nothing is ever UNTRUSTED", from: "avg > busyPct ? `UNTRUSTED: machine busy", to: "avg > 1e9 ? `UNTRUSTED: machine busy", expect: [/^G9 busy machine: every measured page/] },
      { name: "threshold ignored in the summary line", from: 'avg > busyPct ? "UNTRUSTED" : "trusted"', to: 'avg > 35 ? "UNTRUSTED" : "trusted"', expect: [/^G9 --busy-threshold 60/] },
      { name: "the option --busy-threshold is not read", from: 'busyPct = num("--busy-threshold", 35, { min: 0 });', to: "busyPct = 35;", expect: [/^G9 --busy-threshold 60/] },
      { name: "machineLoad thresholdPct not recorded", from: "samples: v.length, thresholdPct: busyPct };", to: "samples: v.length };", expect: [/^G9 busy machine: machineLoad/, /^G9 --busy-threshold 60/] },
      { name: "summary line removed", from: 'if (v.length) log(`machine load during speed runs:', to: 'if (v.length) void (`machine load during speed runs:', expect: [/^G9 busy machine: summary line/, /^G9 idle machine: summary line/] },
      { name: "speedTrust never written on the page", from: "e.speedTrust = trustOf(sampler.avgSince(pageStart));", to: "void trustOf(sampler.avgSince(pageStart));", expect: [/^G9 busy machine: every measured page/, /^G9 idle machine: every measured page/] },
    ];
    const bad = results.filter((r) => !r.ok && /^G9 /.test(r.name)).length; // mutants run when the G9 assertions are green (an unrelated timing check may flake on a loaded machine)
    if (!bad && !args.includes("--no-mutants")) {
      const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
      let n = 0;
      for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
        const mdir = fs.mkdtempSync(path.join(tmp, "mutant-")), sdir = path.join(mdir, "scripts");
        fs.cpSync(path.dirname(script), sdir, { recursive: true, filter: (p) => !/[\\/]test-[^\\/]*$/.test(p) });
        const target = path.join(sdir, path.basename(script)), src = fs.readFileSync(target, "utf8"), count = src.split(mu.from).length - 1;
        if (count !== 1) { check(`mutant "${mu.name}": the patch applied (target found once)`, false, `found ${count} times`); continue; }
        fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
        let res; try { res = await g9(target, `m${n++}`); } catch (e) { res = [{ name: `crashed: ${e.message}`, ok: false }]; }
        const red = res.filter((r) => !r.ok), missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
        check(`mutant "${mu.name}" is caught: ${red.length} G9 assertion(s) red, the expected ones among them`, red.length > 0 && !missing.length, `red: ${red.map((r) => r.name.slice(0, 60)).join(" | ") || "none (survived)"}; expected red but green: ${missing.map(String).join(" ")}`);
      }
    }
  }
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `  ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `SNAPSHOT TEST FAIL: ${failed} of ${results.length}` : `SNAPSHOT TEST PASS: ${results.length} of ${results.length}`);
process.exit(failed ? 1 : 0);
