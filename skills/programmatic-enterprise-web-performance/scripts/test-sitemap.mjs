// Usage: node test-sitemap.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of sitemap-check.mjs and sitemap-submit.mjs (contract C9): the sitemap FILE against the approved page plan, then the submission.
// No network beyond this machine: a fixture site on 127.0.0.1 (robots.txt, sitemaps, good and bad pages, a 404, 301s, a 429) and fake Google /
// Bing / token endpoints on 127.0.0.1; the scripts run as child processes with a scrubbed environment and a throw-away home folder, so no real key,
// token or machine.local.json can leak in. The live Search Console and Bing APIs are NOT exercised here (UNPROVEN: first real submission is the proof).
// Mutants (same pattern as test-start.mjs): break the code each assertion guards in a copy of the scripts, expect the named assertions red.
// Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));
const NEEDED = ["sitemap-check.mjs", "sitemap-submit.mjs", "lib-main.mjs", "state.mjs", "lib-env.mjs", "lib-polite.mjs", "lib-freshness.mjs", "lib-google-auth.mjs"];
const TODAY = "2026-10-26";
const KEY = "BINGKEY-s3cr3t-9f8e7d";   // gitleaks:allow (a made-up test key, never a real one)
const TOKEN = "TESTTOKEN-ABC123";
const node = process.execPath;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const homeTmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-sm-home-"));
function childEnv(extra = {}) {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(GSC_|BING_|PEWP_|NODE_OPTIONS|GOOGLE_)/i.test(k)) delete e[k];
  return { ...e, HOME: homeTmp, USERPROFILE: homeTmp, ...extra };
}
function runNode(script, argv, { env = childEnv(), cwd } = {}) {
  return new Promise((resolve) => {
    const c = spawn(node, [script, ...argv], { stdio: ["ignore", "pipe", "pipe"], env, cwd });
    let so = "", se = "";
    c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
    const timer = setTimeout(() => { se += "TIMED OUT after 90 s"; c.kill(); }, 90000);
    c.on("close", (code) => { clearTimeout(timer); resolve({ code, so, se }); });
  });
}
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const F = (j, id) => ((j && j.findings) || []).find((f) => f.id === id) || {};
const has = (arr, x) => Array.isArray(arr) && arr.includes(x);

// ---------------- the fixture site ----------------
function startSite() {
  const st = { robots: null, sitemaps: {}, routes: {}, hits: [], rate: new Set() };
  const server = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    st.hits.push({ t: Date.now(), path: p, ua: req.headers["user-agent"] || "" });
    if (st.rate.has(p)) { res.statusCode = 429; return res.end("slow down"); }
    if (p === "/robots.txt") { if (st.robots == null) { res.statusCode = 404; return res.end("none"); } res.setHeader("content-type", "text/plain"); return res.end(st.robots); }
    const sm = st.sitemaps[p];
    if (sm) { res.setHeader("content-type", sm.type || "application/xml"); for (const [k, v] of Object.entries(sm.headers || {})) res.setHeader(k, v); return res.end(sm.body); }
    const r = st.routes[p];
    if (!r) { res.statusCode = 404; return res.end("not found"); }
    res.statusCode = r.status || 200;
    for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
    if (!r.headers || !r.headers["content-type"]) res.setHeader("content-type", "text/html");
    res.end(r.body ?? "");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    st.base = base; st.server = server;
    st.reset = () => { st.robots = null; st.sitemaps = {}; st.routes = {}; st.hits.length = 0; st.rate.clear(); };
    resolve(st);
  }));
}
const html = ({ canonical, robots } = {}) => `<!doctype html><html><head><title>t</title>${canonical ? `<link rel="canonical" href="${canonical}">` : ""}${robots ? `<meta name="robots" content="${robots}">` : ""}</head><body><h1>x</h1></body></html>`;
const PATHS = ["/", "/about", "/services", "/contact", "/pricing", "/blog"];
const cleanRoutes = (st) => { for (const p of PATHS) st.routes[p] = { body: html({ canonical: st.base + p }) }; };
const DAY = 86_400_000;
const spread = () => PATHS.map((_, i) => new Date(Date.now() - (i + 1) * 3 * DAY).toISOString().replace(/\.\d+Z$/, "Z"));
const nowStamp = (k) => new Date(Date.now() - 5000 + k * 7).toISOString(); // a clock read once per URL, milliseconds apart
const sitemapXml = (urls, mods) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u, i) => `<url><loc>${u}</loc>${mods && mods[i] != null ? `<lastmod>${mods[i]}</lastmod>` : ""}</url>`).join("")}</urlset>`;
const putSitemap = (st, urlPaths, mods, at = "/sitemap.xml") => { st.sitemaps[at] = { body: sitemapXml(urlPaths.map((p) => st.base + p), mods) }; };

// ---------------- scenarios ----------------
async function scenarios(dir, only = null) {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 700) });
  const want = (g) => !only || only.includes(g);
  const CHECK = path.join(dir, "sitemap-check.mjs"), SUBMIT = path.join(dir, "sitemap-submit.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-sm-test-"));
  let n = 0;
  const fresh = (what) => { const d = path.join(tmp, `${what}-${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
  const checkJson = (cwd, today = TODAY) => readJson(path.join(cwd, "site-checks", "127.0.0.1", ".pewp", "sitemap", `check-${today}.json`));
  const checkPath = (cwd, ext, today = TODAY) => path.join(cwd, "site-checks", "127.0.0.1", ".pewp", "sitemap", `check-${today}.${ext}`);
  const writePlan = (cwd, pages, name = "plan.json") => { const f = path.join(cwd, name); fs.writeFileSync(f, JSON.stringify({ version: 1, pages })); return f; };
  const planOf = (paths) => paths.map((p) => ({ path: p }));

  const st = await startSite();
  const runCheck = (cwd, planFile, extra = [], { target = st.base + "/", gap = "0", env } = {}) =>
    runNode(CHECK, [target, "--plan", planFile, "--cwd", cwd, "--today", TODAY, "--gap-ms", gap, ...extra], { env });
  const pageHits = () => st.hits.filter((h) => !/^\/(robots\.txt|sitemap[^/]*\.xml(\.gz)?|sm\d\.xml(\.gz)?|custom-sm\.xml)$/.test(h.path));

  try {
    // ---- usage ----
    if (want("usage")) {
      const cwd = fresh("usage"); const plan = writePlan(cwd, planOf(PATHS));
      st.reset();
      let r = await runNode(CHECK, ["--help"]);
      check("U1 --help prints usage and exits 0", r.code === 0 && /usage/i.test(r.so), `${r.code} ${r.so}${r.se}`);
      r = await runNode(CHECK, [st.base + "/", "--cwd", cwd]);
      check("U2 no --plan is a usage error (exit 2), nothing fetched", r.code === 2 && /--plan/.test(r.se) && st.hits.length === 0, `${r.code} ${r.se} hits=${st.hits.length}`);
      r = await runNode(CHECK, [st.base + "/", "--plan", path.join(cwd, "missing.json"), "--cwd", cwd]);
      check("U3 a missing plan file is exit 2, nothing fetched", r.code === 2 && st.hits.length === 0, `${r.code} ${r.se}`);
      const empty = writePlan(cwd, [], "empty.json");
      r = await runNode(CHECK, [st.base + "/", "--plan", empty, "--cwd", cwd]);
      check("U4 a plan with no pages is exit 2", r.code === 2 && st.hits.length === 0, `${r.code} ${r.se}`);
      r = await runNode(CHECK, [st.base + "/", "--plan", plan, "--cwd", cwd, "--gap-ms", "abc"]);
      check("U5 --gap-ms abc is exit 2, nothing fetched", r.code === 2 && st.hits.length === 0, `${r.code} ${r.se}`);
      r = await runNode(CHECK, ["http://example.com/", "--plan", plan, "--cwd", cwd, "--gap-ms", "100"]);
      check("U6 a gap below the polite minimum to a site that is not this machine is exit 2", r.code === 2 && /polite minimum/.test(r.se), `${r.code} ${r.se}`);
      r = await runNode(CHECK, [st.base + "/", "--plan", plan, "--cwd", cwd, "--max-urls", "0"]);
      check("U7 --max-urls 0 is exit 2", r.code === 2, `${r.code} ${r.se}`);
      r = await runNode(CHECK, [st.base + "/", "--plan", plan, "--cwd", cwd, "--bogus", "1"]);
      check("U8 an unknown option is exit 2", r.code === 2 && /unknown option/.test(r.se), `${r.code} ${r.se}`);
      r = await runNode(CHECK, [st.base + "/", "--plan", plan, "--cwd", cwd, "--dotenv", path.join(cwd, "no.env")]);
      check("U9 a --dotenv file that does not exist is exit 2", r.code === 2 && st.hits.length === 0, `${r.code} ${r.se}`);
      r = await runNode(SUBMIT, ["--help"]);
      check("U10 sitemap-submit --help prints usage and exits 0", r.code === 0 && /usage/i.test(r.so), `${r.code} ${r.so}${r.se}`);
    }

    // ---- a clean site passes ----
    if (want("clean")) {
      st.reset(); cleanRoutes(st); putSitemap(st, PATHS, spread()); // no robots.txt Sitemap line: the default <origin>/sitemap.xml
      st.robots = "User-agent: *\nDisallow: /private\n";
      const cwd = fresh("clean"); const plan = writePlan(cwd, planOf(PATHS));
      const r = await runCheck(cwd, plan); const j = checkJson(cwd);
      check("A1 clean site: exit 0 and the first line is the PASS line", r.code === 0 && r.so.split("\n")[0] === "PASS sitemap: 6 urls, all in the page plan", `${r.code} ${r.so}${r.se}`);
      check("A1 clean site: json status PASS, six urls, every finding PASS or WARN-free", j && j.status === "PASS" && j.urlCount === 6 && j.urls.length === 6 && j.findings.every((f) => f.status === "PASS"), JSON.stringify(j && j.findings.map((f) => [f.id, f.status])));
      check("A1 clean site: json carries generatedAt, sitemapUrl (default /sitemap.xml) and findings with id/status/what/urls", j && j.generatedAt && j.sitemapUrl === st.base + "/sitemap.xml" && j.findings.every((f) => f.id && f.status && f.what && Array.isArray(f.urls)), JSON.stringify(j && { g: j.generatedAt, s: j.sitemapUrl }));
      const md = fs.existsSync(checkPath(cwd, "md")) ? fs.readFileSync(checkPath(cwd, "md"), "utf8") : "";
      check("A1 clean site: the owner file check-<date>.md exists and speaks plainly", /sitemap file/i.test(md) && /page plan/i.test(md) && /PASSED/.test(md), md.slice(0, 200));
      check("A1 every request carries the honest user agent and robots.txt was asked first", st.hits.length >= 8 && st.hits.every((h) => /^pewp-sitemap-check \(\+/.test(h.ua)) && st.hits[0].path === "/robots.txt", JSON.stringify(st.hits.slice(0, 3)));
      check("A1 each sitemap URL was fetched once (6 pages + robots + sitemap = 8 requests)", st.hits.length === 8, JSON.stringify(st.hits.map((h) => h.path)));
    }

    // ---- a bad site: every plan/answer/index/canonical rule ----
    if (want("bad")) {
      st.reset(); cleanRoutes(st);
      st.robots = "User-agent: *\nDisallow:\n";
      const inMap = ["/", "/services", "/contact", "/old", "/moved", "/thanks"];
      putSitemap(st, inMap, spread());
      st.routes["/services"] = { body: html({ canonical: st.base + "/services", robots: "noindex, follow" }) };
      st.routes["/contact"] = { body: html({ canonical: st.base + "/contact-us" }) };
      delete st.routes["/old"]; // 404
      st.routes["/moved"] = { status: 301, headers: { location: "/moved2" } };
      st.routes["/moved2"] = { status: 301, headers: { location: "/about" } };
      st.routes["/thanks"] = { body: html({ canonical: st.base + "/thanks" }) };
      // 7 pages in the plan: / /services /contact /old /thanks(noindex) /about(indexable, NOT in the sitemap) /hidden(indexable:false, not in the sitemap)
      const planPages = [{ path: "/" }, { path: "/services" }, { path: "/contact" }, { path: "/old" }, { path: "/thanks", noindex: true }, { path: "/about" }, { path: "/hidden", indexable: false }];
      const cwd = fresh("bad"); const plan = writePlan(cwd, planPages);
      const r = await runCheck(cwd, plan); const j = checkJson(cwd);
      check("B0 bad site: exit 1", r.code === 1, `${r.code} ${r.so}${r.se}`);
      check("B1 SM-IN-PLAN FAIL names the URL that is not in the page plan (/moved)", F(j, "SM-IN-PLAN").status === "FAIL" && F(j, "SM-IN-PLAN").urls.length === 1 && has(F(j, "SM-IN-PLAN").urls, st.base + "/moved"), JSON.stringify(F(j, "SM-IN-PLAN")));
      check("B2 SM-PLAN-NOINDEX FAIL: the planned noindex page /thanks is in the sitemap", F(j, "SM-PLAN-NOINDEX").status === "FAIL" && has(F(j, "SM-PLAN-NOINDEX").urls, st.base + "/thanks") && F(j, "SM-PLAN-NOINDEX").urls.length === 1, JSON.stringify(F(j, "SM-PLAN-NOINDEX")));
      check("B3 SM-200 FAIL: a 404 and a 301 are both named", F(j, "SM-200").status === "FAIL" && has(F(j, "SM-200").urls, st.base + "/old") && has(F(j, "SM-200").urls, st.base + "/moved") && F(j, "SM-200").urls.length === 2, JSON.stringify(F(j, "SM-200")));
      const mv = (j && j.pages || []).find((p) => p.url === st.base + "/moved") || {};
      check("B3 the redirect is reported (where it goes) and followed at most one hop", mv.status === 301 && mv.redirectedTo === st.base + "/moved2" && st.hits.filter((h) => h.path === "/moved2").length === 1 && st.hits.filter((h) => h.path === "/about").length === 0, JSON.stringify({ mv, hits: st.hits.map((h) => h.path) }));
      check("B4 SM-NOINDEX FAIL: the meta noindex page /services", F(j, "SM-NOINDEX").status === "FAIL" && F(j, "SM-NOINDEX").urls.length === 1 && has(F(j, "SM-NOINDEX").urls, st.base + "/services"), JSON.stringify(F(j, "SM-NOINDEX")));
      check("B5 SM-CANONICAL FAIL: /contact names /contact-us", F(j, "SM-CANONICAL").status === "FAIL" && F(j, "SM-CANONICAL").urls.length === 1 && has(F(j, "SM-CANONICAL").urls, st.base + "/contact"), JSON.stringify(F(j, "SM-CANONICAL")));
      check("B6 SM-COVERAGE FAIL: the indexable planned page /about is missing, the indexable:false /hidden is not asked for", F(j, "SM-COVERAGE").status === "FAIL" && F(j, "SM-COVERAGE").urls.length === 1 && has(F(j, "SM-COVERAGE").urls, st.base + "/about"), JSON.stringify(F(j, "SM-COVERAGE")));
      check("B7 stdout starts with FAIL lines naming the ids, no PASS line", /^FAIL SM-IN-PLAN /m.test(r.so) && /^FAIL SM-NOINDEX /m.test(r.so) && /^FAIL SM-COVERAGE /m.test(r.so) && !/^PASS /m.test(r.so) && r.so.split("\n")[0].startsWith("FAIL "), r.so);
      check("B8 the lastmod rules stay PASS when only the page rules are broken (spread dates)", F(j, "SE-004").status === "PASS" && F(j, "IDX-003").status === "PASS" && j.status === "FAIL", JSON.stringify(j.findings.map((f) => [f.id, f.status])));
    }

    // ---- lastmod rules ----
    if (want("lastmod")) {
      const run = async (label, mods, { routes, extra = [], paths = PATHS, sitemapHeaders } = {}) => {
        st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow:\n";
        for (const p of paths) if (!st.routes[p]) st.routes[p] = { body: html({ canonical: st.base + p }) };
        if (routes) routes(st);
        putSitemap(st, paths, mods);
        if (sitemapHeaders) st.sitemaps["/sitemap.xml"].headers = sitemapHeaders;
        const cwd = fresh(label); const plan = writePlan(cwd, planOf(paths));
        const r = await runCheck(cwd, plan, extra); return { r, j: checkJson(cwd) };
      };
      let x = await run("clock6", PATHS.map((_, k) => nowStamp(k)));
      check("L1 build clock: six URLs stamped by one clock read -> IDX-003 FAIL, exit 1", x.r.code === 1 && F(x.j, "IDX-003").status === "FAIL" && F(x.j, "IDX-003").urls.length === 6 && /^FAIL IDX-003 /m.test(x.r.so), `${x.r.code} ${x.r.so}`);
      x = await run("clock5", PATHS.map((_, k) => (k < 5 ? nowStamp(k) : new Date(Date.now() - 20 * DAY).toISOString())));
      check("L2 build clock: five of six inside one minute is still IDX-003 FAIL (the threshold is 5)", x.r.code === 1 && F(x.j, "IDX-003").status === "FAIL" && F(x.j, "IDX-003").urls.length === 5, `${x.r.code} ${JSON.stringify(F(x.j, "IDX-003"))}`);
      x = await run("clock4", PATHS.map((_, k) => (k < 4 ? nowStamp(k) : new Date(Date.now() - (k + 2) * 5 * DAY).toISOString())));
      check("L3 four URLs sharing a minute is below the threshold: IDX-003 PASS, exit 0", x.r.code === 0 && F(x.j, "IDX-003").status === "PASS", `${x.r.code} ${x.r.so} ${JSON.stringify(F(x.j, "IDX-003"))}`);
      x = await run("spread", spread());
      check("L4 lastmods spread over days: IDX-003 and SE-004 PASS, exit 0", x.r.code === 0 && F(x.j, "IDX-003").status === "PASS" && F(x.j, "SE-004").status === "PASS", `${x.r.code} ${x.r.so}`);
      const mods = spread(); mods[2] = "2099-01-01T00:00:00Z";
      x = await run("future", mods);
      check("L5 a lastmod in the future -> SE-004 FAIL naming the URL, exit 1", x.r.code === 1 && F(x.j, "SE-004").status === "FAIL" && has(F(x.j, "SE-004").urls, st.base + PATHS[2]) && /in the future/.test(F(x.j, "SE-004").what), `${x.r.code} ${JSON.stringify(F(x.j, "SE-004"))}`);
      const mods2 = spread(); mods2[1] = "2026-10-01";
      x = await run("dateonly", mods2);
      check("L6 a date-only lastmod -> SE-004 FAIL, exit 1", x.r.code === 1 && F(x.j, "SE-004").status === "FAIL" && has(F(x.j, "SE-004").urls, st.base + PATHS[1]) && /date-only/.test(F(x.j, "SE-004").what), `${x.r.code} ${JSON.stringify(F(x.j, "SE-004"))}`);
      const mods3 = spread(); mods3[4] = null;
      x = await run("missing", mods3, { routes: (s) => { s.routes["/pricing"] = { body: html({}) }; } });
      check("L7 a missing lastmod and a missing canonical are WARN only: exit 0, WARN lines printed", x.r.code === 0 && F(x.j, "SM-LASTMOD-MISSING").status === "WARN" && has(F(x.j, "SM-LASTMOD-MISSING").urls, st.base + PATHS[4]) && F(x.j, "SM-CANONICAL-MISSING").status === "WARN" && /^WARN SM-LASTMOD-MISSING /m.test(x.r.so) && x.j.status === "PASS", `${x.r.code} ${x.r.so}`);
      // the large-site case: 6 of 8 pages edited within one minute, three days ago (far from the fetch time)
      const batch = (k) => new Date(Date.now() - 3 * DAY + k * 7).toISOString();
      const P8 = [...PATHS, "/faq", "/team"];
      const tail2 = [new Date(Date.now() - 10 * DAY).toISOString(), new Date(Date.now() - 20 * DAY).toISOString()];
      x = await run("batch", [...PATHS.map((_, k) => batch(k)), ...tail2], { paths: P8 });
      check("L9 six of eight pages share one minute three days ago: IDX-003 PASS, SM-SHARED-LASTMOD WARN naming the 6, exit 0, WARN line printed", x.r.code === 0 && F(x.j, "IDX-003").status === "PASS" && F(x.j, "SM-SHARED-LASTMOD").status === "WARN" && F(x.j, "SM-SHARED-LASTMOD").urls.length === 6 && /^WARN SM-SHARED-LASTMOD 6 pages share one lastmod minute; real edits or a batch stamp\? check by hand/m.test(x.r.so), `${x.r.code} ${x.r.so}`);
      x = await run("allold", PATHS.map((_, k) => batch(k)));
      check("L10 EVERY url of the sitemap sharing one minute is IDX-003 FAIL even when that minute is three days old", x.r.code === 1 && F(x.j, "IDX-003").status === "FAIL" && F(x.j, "IDX-003").urls.length === 6, `${x.r.code} ${x.r.so}`);
      x = await run("lmheader", [...PATHS.map((_, k) => batch(k)), ...tail2], { paths: P8, sitemapHeaders: { "last-modified": new Date(Date.now() - 3 * DAY + 60_000).toUTCString() } });
      check("L11 six of eight share a minute within 10 min of the sitemap's own Last-Modified header: IDX-003 FAIL", x.r.code === 1 && F(x.j, "IDX-003").status === "FAIL" && F(x.j, "IDX-003").urls.length === 6, `${x.r.code} ${x.r.so}`);
      x = await run("xrobots", spread(), { routes: (s) => { s.routes["/pricing"] = { headers: { "x-robots-tag": "noindex" }, body: html({ canonical: s.base + "/pricing" }) }; } });
      check("L8 noindex sent as an X-Robots-Tag header -> SM-NOINDEX FAIL", x.r.code === 1 && F(x.j, "SM-NOINDEX").status === "FAIL" && has(F(x.j, "SM-NOINDEX").urls, st.base + "/pricing"), `${x.r.code} ${JSON.stringify(F(x.j, "SM-NOINDEX"))}`);
    }

    // ---- robots.txt obeyed ----
    if (want("robots")) {
      st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow: /private\n";
      st.routes["/private/x"] = { body: html({ canonical: st.base + "/private/x" }) };
      const urls = [...PATHS, "/private/x"];
      putSitemap(st, urls, [...spread(), spread()[0]]);
      const cwd = fresh("robots"); const plan = writePlan(cwd, planOf(urls));
      const r = await runCheck(cwd, plan); const j = checkJson(cwd);
      check("R1 a sitemap URL that robots.txt forbids is SM-ROBOTS FAIL and is never requested", r.code === 1 && F(j, "SM-ROBOTS").status === "FAIL" && has(F(j, "SM-ROBOTS").urls, st.base + "/private/x") && !st.hits.some((h) => h.path === "/private/x"), `${r.code} ${JSON.stringify(F(j, "SM-ROBOTS"))} ${JSON.stringify(st.hits.map((h) => h.path))}`);
    }

    // ---- sitemap index + gzip + robots Sitemap: line + explicit --sitemap ----
    if (want("index")) {
      st.reset(); cleanRoutes(st);
      st.robots = `User-agent: *\nDisallow:\nSitemap: ${st.base}/sitemap_index.xml\n`;
      const mods = spread();
      st.sitemaps["/sitemap_index.xml"] = { body: `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${st.base}/sm1.xml.gz</loc></sitemap><sitemap><loc>${st.base}/sm2.xml</loc></sitemap></sitemapindex>` };
      st.sitemaps["/sm1.xml.gz"] = { type: "application/gzip", body: zlib.gzipSync(sitemapXml(PATHS.slice(0, 3).map((p) => st.base + p), mods.slice(0, 3))) };
      st.sitemaps["/sm2.xml"] = { body: sitemapXml(PATHS.slice(3).map((p) => st.base + p), mods.slice(3)) };
      const cwd = fresh("index"); const plan = writePlan(cwd, planOf(PATHS));
      const r = await runCheck(cwd, plan); const j = checkJson(cwd);
      check("S1 the robots.txt Sitemap: line is followed through an index and a .gz child: 6 urls, exit 0", r.code === 0 && j && j.urlCount === 6 && j.sitemapUrl === st.base + "/sitemap_index.xml" && j.sitemapUrls.includes(st.base + "/sm1.xml.gz") && j.sitemapUrls.includes(st.base + "/sm2.xml"), `${r.code} ${r.so}${r.se} ${JSON.stringify(j && j.sitemapUrls)}`);
      // explicit --sitemap, robots without a Sitemap line
      st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow:\n";
      putSitemap(st, PATHS, spread(), "/custom-sm.xml");
      const cwd2 = fresh("explicit"); const plan2 = writePlan(cwd2, planOf(PATHS));
      const r2 = await runCheck(cwd2, plan2, ["--sitemap", st.base + "/custom-sm.xml"]); const j2 = checkJson(cwd2);
      check("S2 --sitemap names the file explicitly (robots.txt has no Sitemap line, /sitemap.xml does not exist)", r2.code === 0 && j2 && j2.sitemapUrl === st.base + "/custom-sm.xml" && j2.urlCount === 6, `${r2.code} ${r2.so}${r2.se}`);
      // sitemap 404
      st.reset(); cleanRoutes(st); st.robots = null;
      const cwd3 = fresh("nosm"); const plan3 = writePlan(cwd3, planOf(PATHS));
      const r3 = await runCheck(cwd3, plan3); const j3 = checkJson(cwd3);
      check("S3 no sitemap file at all -> SM-SITEMAP FAIL, exit 1, no page fetched", r3.code === 1 && F(j3, "SM-SITEMAP").status === "FAIL" && /^FAIL SM-SITEMAP /m.test(r3.so) && pageHits().length === 0, `${r3.code} ${r3.so}`);
    }

    // ---- a 429 stops everything ----
    if (want("rate")) {
      st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow:\n"; putSitemap(st, PATHS, spread());
      const cwd = fresh("rate"); const plan = writePlan(cwd, planOf(PATHS));
      const ok = await runCheck(cwd, plan);
      check("T0 (set-up) the same site first passes today, leaving a PASS file behind", ok.code === 0 && checkJson(cwd).status === "PASS", `${ok.code} ${ok.so}`);
      st.hits.length = 0; st.rate.add("/services");
      const r = await runCheck(cwd, plan); const j = checkJson(cwd);
      const asked = st.hits.filter((h) => PATHS.includes(h.path)).map((h) => h.path);
      check("T1 the first 429 stops the run: exit 3, STOP line, nothing concluded", r.code === 3 && /^STOP 429 /m.test(r.so) && j.status === "STOPPED" && j.findings.length === 0, `${r.code} ${r.so}${r.se}`);
      check("T2 after the 429 no further page is requested and the 429 page is asked exactly once (no retry)", st.hits.filter((h) => h.path === "/services").length === 1 && !asked.includes("/contact") && !asked.includes("/pricing") && !asked.includes("/blog"), JSON.stringify(st.hits.map((h) => h.path)));
      check("T3 the earlier same-day PASS file is overwritten by the STOPPED one (cannot be reused by a submit)", j && j.status === "STOPPED" && !/PASS/.test(JSON.stringify(j.status)), JSON.stringify(j && j.status));
      st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow:\n"; putSitemap(st, PATHS, spread()); st.rate.add("/sitemap.xml");
      const cwd2 = fresh("rate2"); const plan2 = writePlan(cwd2, planOf(PATHS));
      const r2 = await runCheck(cwd2, plan2);
      check("T4 a 429 on the sitemap file itself is exit 3 too, no page requested", r2.code === 3 && pageHits().length === 0, `${r2.code} ${r2.so}`);
    }

    // ---- --max-urls ----
    if (want("limit")) {
      st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow:\n"; putSitemap(st, PATHS, spread());
      let cwd = fresh("limit"); let plan = writePlan(cwd, planOf(PATHS));
      let r = await runCheck(cwd, plan, ["--max-urls", "3"]); let j = checkJson(cwd);
      check("M1 --max-urls 3 fetches only 3 pages (no more requests to the site)", pageHits().length === 3, JSON.stringify(pageHits().map((h) => h.path)));
      check("M1 --max-urls 3: SM-LIMIT WARN names the 3 not fetched, exit 0, the PASS line still prints", r.code === 0 && F(j, "SM-LIMIT").status === "WARN" && F(j, "SM-LIMIT").urls.length === 3 && /^WARN SM-LIMIT /m.test(r.so) && /^PASS sitemap: 6 urls/m.test(r.so), `${r.code} ${r.so}`);
      st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow:\n"; putSitemap(st, PATHS, PATHS.map((_, k) => nowStamp(k)));
      cwd = fresh("limit2"); plan = writePlan(cwd, planOf(PATHS));
      r = await runCheck(cwd, plan, ["--max-urls", "3"]); j = checkJson(cwd);
      check("M2 the sitemap-only rules (build clock) still judge all 6 URLs when only 3 are fetched", r.code === 1 && F(j, "IDX-003").status === "FAIL" && F(j, "IDX-003").urls.length === 6, `${r.code} ${JSON.stringify(F(j, "IDX-003"))}`);
      // --exclude
      st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow:\n"; putSitemap(st, PATHS, spread());
      st.routes["/contact"] = { body: html({ canonical: st.base + "/contact-us" }) };
      cwd = fresh("excl"); plan = writePlan(cwd, planOf(PATHS));
      r = await runCheck(cwd, plan, ["--exclude", "^/contact$"]); j = checkJson(cwd);
      check("M3 --exclude keeps a page from being requested (its canonical problem is not looked for)", !st.hits.some((h) => h.path === "/contact") && F(j, "SM-CANONICAL").status === "PASS" && r.code === 0, `${r.code} ${JSON.stringify(st.hits.map((h) => h.path))}`);
    }

    // ---- existing pages: in the sitemap file, not in the page plan, approved in plan/existing-pages.json ----
    if (want("existing")) {
      const EXTRA = ["/privacy", "/terms"];
      const ALL = [...PATHS, ...EXTRA];
      const mods8 = ALL.map((_, i) => new Date(Date.now() - (i + 1) * 3 * DAY).toISOString().replace(/\.\d+Z$/, "Z"));
      const setup = (label) => {
        st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow:\n";
        for (const p of EXTRA) st.routes[p] = { body: html({ canonical: st.base + p }) };
        putSitemap(st, ALL, mods8);
        const cwd = fresh(label); return { cwd, plan: writePlan(cwd, planOf(PATHS)), pewp: path.join(cwd, "site-checks", "127.0.0.1", ".pewp") };
      };
      const list = (dir, pages, name = "existing-pages.json") => { const f = path.join(dir, name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ note: "pages that exist and may be offered", pages })); return f; };
      const E = (p) => ({ path: p, why: "a page that already exists and is fine to offer to search engines" });
      const mdOf = (cwd) => (fs.existsSync(checkPath(cwd, "md")) ? fs.readFileSync(checkPath(cwd, "md"), "utf8") : "");

      let x = setup("ex-ok"); let ef = list(x.cwd, [E("/privacy/"), E("/terms")]); // a trailing slash in the list is the same page
      let r = await runCheck(x.cwd, x.plan, ["--existing", ef]); let j = checkJson(x.cwd);
      check("E1 --existing: two pages in the sitemap file and not in the plan pass SM-IN-PLAN: exit 0, PASS line says how many the list matched", r.code === 0 && F(j, "SM-IN-PLAN").status === "PASS" && /^PASS sitemap: 8 urls, all in the page plan \(2 by the existing-pages list /m.test(r.so), `${r.code} ${r.so}${r.se}`);
      check("E1 the json and the .md say 2 URLs were matched by the existing list and name the file", j && j.existing && j.existing.matched === 2 && j.existing.file === ef && j.existingPages === ef && has(j.existing.urls, st.base + "/privacy") && has(j.existing.urls, st.base + "/terms") && mdOf(x.cwd).includes(ef) && /2 address\(es\) of this sitemap file were matched/.test(mdOf(x.cwd)), JSON.stringify(j && j.existing) + mdOf(x.cwd).slice(0, 400));
      check("E2 a trailing slash in the list ('/privacy/') matches the sitemap URL '/privacy' (same normalisation as the plan paths)", has(j && j.existing && j.existing.urls, st.base + "/privacy"), JSON.stringify(j && j.existing));

      x = setup("ex-partial"); ef = list(x.cwd, [E("/privacy")]);
      r = await runCheck(x.cwd, x.plan, ["--existing", ef]); j = checkJson(x.cwd);
      check("E3 an unlisted extra page still fails SM-IN-PLAN: exit 1, only /terms named, /privacy is not", r.code === 1 && F(j, "SM-IN-PLAN").status === "FAIL" && F(j, "SM-IN-PLAN").urls.length === 1 && has(F(j, "SM-IN-PLAN").urls, st.base + "/terms") && /^FAIL SM-IN-PLAN /m.test(r.so), `${r.code} ${r.so} ${JSON.stringify(F(j, "SM-IN-PLAN"))}`);

      x = setup("ex-rules"); ef = list(x.cwd, [E("/privacy"), E("/terms")]);
      st.routes["/privacy"] = { body: html({ canonical: st.base + "/privacy", robots: "noindex" }) };
      st.routes["/terms"] = { body: html({ canonical: st.base + "/terms-of-use" }) };
      r = await runCheck(x.cwd, x.plan, ["--existing", ef]); j = checkJson(x.cwd);
      check("E4 the other rules still apply to a listed page: noindex -> SM-NOINDEX FAIL, a different canonical -> SM-CANONICAL FAIL, SM-IN-PLAN PASS", r.code === 1 && F(j, "SM-IN-PLAN").status === "PASS" && has(F(j, "SM-NOINDEX").urls, st.base + "/privacy") && has(F(j, "SM-CANONICAL").urls, st.base + "/terms"), `${r.code} ${r.so}`);
      x = setup("ex-lastmod"); ef = list(x.cwd, [E("/privacy"), E("/terms")]);
      const bad8 = [...mods8]; bad8[6] = "2026-10-01"; putSitemap(st, ALL, bad8);
      r = await runCheck(x.cwd, x.plan, ["--existing", ef]); j = checkJson(x.cwd);
      check("E4 a listed page with a date-only lastmod still fails SE-004", r.code === 1 && F(j, "SE-004").status === "FAIL" && has(F(j, "SE-004").urls, st.base + "/privacy"), `${r.code} ${r.so}`);

      x = setup("ex-why"); st.hits.length = 0;
      for (const [label, pages] of [["no why", [{ path: "/privacy" }, E("/terms")]], ["blank why", [{ path: "/privacy", why: "   " }, E("/terms")]], ["no path", [{ why: "x" }]]]) {
        ef = list(x.cwd, pages, `bad-${label.replace(/ /g, "-")}.json`);
        r = await runCheck(x.cwd, x.plan, ["--existing", ef]);
        check(`E5 an entry with ${label} is a usage error: exit 2, the entry is named, nothing fetched`, r.code === 2 && /usage error/.test(r.se) && (label === "no path" ? /no path/ : /\/privacy has no "why"/).test(r.se) && st.hits.length === 0, `${r.code} ${r.se} hits=${st.hits.length}`);
      }
      r = await runCheck(x.cwd, x.plan, ["--existing", path.join(x.cwd, "nope.json")]);
      check("E5 an --existing file that cannot be read is exit 2, nothing fetched", r.code === 2 && st.hits.length === 0, `${r.code} ${r.se}`);

      x = setup("ex-unapproved"); const wl = list(path.join(x.pewp, "plan"), [E("/privacy"), E("/terms")]);
      r = await runCheck(x.cwd, x.plan); j = checkJson(x.cwd);
      check("E6 an unapproved plan/existing-pages.json alone is ignored: SM-IN-PLAN FAIL on both pages, exit 1", r.code === 1 && F(j, "SM-IN-PLAN").status === "FAIL" && F(j, "SM-IN-PLAN").urls.length === 2 && !j.existing && j.existingPages === null, `${r.code} ${r.so}`);
      check("E6 ... and a NOTE says the unapproved list exists and was ignored (stdout, json, .md)", /^NOTE .*existing-pages\.json exists but is NOT approved.*ignored/m.test(r.so) && j.notes.length === 1 && /ignored/.test(mdOf(x.cwd)), `${r.so} ${JSON.stringify(j && j.notes)}`);

      x = setup("ex-approved"); list(path.join(x.pewp, "approved", "plan"), [E("/privacy"), E("/terms")]);
      r = await runCheck(x.cwd, x.plan); j = checkJson(x.cwd);
      check("E7 without --existing the approved/plan/existing-pages.json is used by default: exit 0, 2 matched, no NOTE", r.code === 0 && j.existing && j.existing.matched === 2 && j.existing.file === path.join(x.pewp, "approved", "plan", "existing-pages.json") && !/^NOTE /m.test(r.so), `${r.code} ${r.so}${r.se}`);

      x = setup("ex-notrequired"); ef = list(x.cwd, [E("/privacy"), E("/terms"), E("/faq")]);
      r = await runCheck(x.cwd, x.plan, ["--existing", ef]); j = checkJson(x.cwd);
      check("E8 a listed page that is not in the sitemap file is not forced in (no SM-COVERAGE failure)", r.code === 0 && F(j, "SM-COVERAGE").status === "PASS" && j.existing.listed === 3 && j.existing.matched === 2, `${r.code} ${r.so}`);
    }

    // ---- pacing ----
    if (want("pace")) {
      st.reset(); cleanRoutes(st); st.robots = "User-agent: *\nDisallow:\n"; putSitemap(st, PATHS, spread());
      const cwd = fresh("pace"); const plan = writePlan(cwd, planOf(PATHS));
      const GAP = 250;
      const r = await runCheck(cwd, plan, [], { gap: String(GAP) });
      const ts = st.hits.map((h) => h.t); const gaps = ts.slice(1).map((t, i) => t - ts[i]);
      check("P1 --gap-ms 250: every two requests to the site are at least 230 ms apart (server clock), 8 requests", r.code === 0 && ts.length === 8 && gaps.every((g) => g >= GAP - 20), `${r.code} gaps=${JSON.stringify(gaps)}`);
    }

    // ---------------- submit ----------------
    if (["submitRefuse", "submitOk", "submitBlocked", "submitHttp", "submitDotenv"].some(want)) {
      const api = { reqs: [], gscStatus: 204, bingStatus: 200 };
      const server = http.createServer((req, res) => {
        let b = ""; req.on("data", (c) => (b += c));
        req.on("end", () => {
          api.reqs.push({ method: req.method, url: req.url, headers: req.headers, body: b });
          res.setHeader("content-type", "application/json");
          if (req.url.startsWith("/token")) return res.end(JSON.stringify({ access_token: TOKEN, expires_in: 3600, token_type: "Bearer" }));
          if (req.url.startsWith("/gsc/")) { res.statusCode = api.gscStatus; return res.end(api.gscStatus === 204 ? "" : JSON.stringify({ error: { message: `denied ${TOKEN}` } })); }
          if (req.url.startsWith("/bing/")) { res.statusCode = api.bingStatus; return res.end(JSON.stringify({ d: null, echo: req.url })); }
          res.statusCode = 404; res.end("{}");
        });
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const API = `http://127.0.0.1:${server.address().port}`;
      const SITE = "http://127.0.0.1:9/";
      const SM = "http://127.0.0.1:9/sitemap.xml";
      const tokFile = path.join(tmp, "gsc-token.json");
      fs.writeFileSync(tokFile, JSON.stringify({ refresh_token: "R-REFRESH-999", client_id: "cid", client_secret: "csecret-777" }));
      const subEnv = (extra = {}) => childEnv({ GSC_TOKEN_FILE: tokFile, GSC_TOKEN_URL: `${API}/token`, GSC_API_BASE: `${API}/gsc`, BING_API_BASE: `${API}/bing`, BING_WEBMASTER_KEY: KEY, ...extra });
      const setupCwd = (what, checkObj) => {
        const cwd = fresh(what);
        if (checkObj) { const d = path.join(cwd, "site-checks", "127.0.0.1", ".pewp", "sitemap"); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `check-${TODAY}.json`), JSON.stringify(checkObj)); }
        return cwd;
      };
      const PASS_CHECK = { status: "PASS", sitemapUrl: SM, sitemapUrls: [SM], urls: [] };
      const submit = (cwd, extra = [], env = subEnv(), sitemap = SM) => runNode(SUBMIT, [SITE, "--sitemap", sitemap, "--cwd", cwd, "--today", TODAY, ...extra], { env });
      const rec = (cwd) => readJson(path.join(cwd, "site-checks", "127.0.0.1", ".pewp", "sitemap", `submit-${TODAY}.json`));
      const recText = (cwd) => { try { return fs.readFileSync(path.join(cwd, "site-checks", "127.0.0.1", ".pewp", "sitemap", `submit-${TODAY}.json`), "utf8"); } catch { return ""; } };
      const secrets = (...texts) => texts.some((t) => String(t).includes(KEY) || String(t).includes(encodeURIComponent(KEY)) || String(t).includes(TOKEN) || String(t).includes("R-REFRESH-999") || String(t).includes("csecret-777"));

      try {
        if (want("submitRefuse")) {
          api.reqs.length = 0;
          let cwd = setupCwd("sub-none", null);
          let r = await submit(cwd);
          check("X1 submit with no check file refuses: exit 1, the exact refusal line, nothing sent", r.code === 1 && /^nothing submitted: no PASS of sitemap-check for 2026-10-26/m.test(r.so) && api.reqs.length === 0 && !rec(cwd), `${r.code} ${r.so}${r.se} reqs=${api.reqs.length}`);
          for (const bad of ["FAIL", "STOPPED"]) {
            cwd = setupCwd(`sub-${bad}`, { ...PASS_CHECK, status: bad });
            r = await submit(cwd);
            check(`X2 submit refuses when the check of the day says ${bad} (exit 1, nothing sent)`, r.code === 1 && /nothing submitted: no PASS/.test(r.so) && api.reqs.length === 0, `${r.code} ${r.so} reqs=${api.reqs.length}`);
          }
          cwd = setupCwd("sub-other", PASS_CHECK);
          r = await submit(cwd, [], subEnv(), "http://127.0.0.1:9/other-sitemap.xml");
          check("X3 submit refuses a sitemap file the check did not read (exit 1, nothing sent)", r.code === 1 && /nothing submitted/.test(r.so) && api.reqs.length === 0, `${r.code} ${r.so}`);
          r = await runNode(SUBMIT, [SITE, "--cwd", cwd], { env: subEnv() });
          check("X4 submit without --sitemap is a usage error (exit 2)", r.code === 2, `${r.code} ${r.se}`);
          r = await submit(cwd, ["--engines", "yahoo"]);
          check("X5 submit with an unknown engine is a usage error (exit 2)", r.code === 2 && api.reqs.length === 0, `${r.code} ${r.se}`);
        }

        if (want("submitOk")) {
          api.reqs.length = 0; api.gscStatus = 204; api.bingStatus = 200;
          const cwd = setupCwd("sub-ok", PASS_CHECK);
          const r = await submit(cwd); const j = rec(cwd);
          const put = api.reqs.find((q) => q.url.startsWith("/gsc/")); const post = api.reqs.find((q) => q.url.startsWith("/bing/"));
          check("Y1 both engines accepted: exit 0, one line per engine", r.code === 0 && /^gsc: submitted \(HTTP 204\)/m.test(r.so) && /^bing: submitted \(HTTP 200\)/m.test(r.so), `${r.code} ${r.so}${r.se}`);
          check("Y2 Search Console: PUT to /sites/{site}/sitemaps/{feed}, both URL-encoded (URL-prefix property <origin>/)", put && put.method === "PUT" && put.url === `/gsc/sites/${encodeURIComponent(SITE)}/sitemaps/${encodeURIComponent(SM)}`, JSON.stringify(put && { m: put.method, u: put.url }));
          check("Y3 Search Console: the bearer token from the token endpoint is sent", put && put.headers.authorization === `Bearer ${TOKEN}`, JSON.stringify(put && put.headers.authorization));
          const q = post ? new URL(post.url, API).searchParams : new URLSearchParams();
          check("Y4 Bing: POST /SubmitFeed with siteUrl, feedUrl and apikey in the query", post && post.method === "POST" && new URL(post.url, API).pathname === "/bing/SubmitFeed" && q.get("siteUrl") === SITE && q.get("feedUrl") === SM && q.get("apikey") === KEY, JSON.stringify(post && post.url));
          check("Y5 the responses are recorded: engine, status, bodyHead (<= 200 chars), at", j && j.responses.length === 2 && j.responses.every((x) => x.engine && x.status != null && typeof x.bodyHead === "string" && x.bodyHead.length <= 200 && x.at) && j.responses.find((x) => x.engine === "gsc").status === 204 && j.responses.find((x) => x.engine === "bing").status === 200, recText(cwd));
          check("Y6 the Bing key and the Google token appear in neither stdout, stderr nor the record", !secrets(r.so, r.se, recText(cwd)), `${r.so}${r.se}`);
          check("Y6 the Bing body (which echoed the request address, key included) is recorded with the key cut out", /\[hidden\]/.test((j.responses.find((x) => x.engine === "bing") || {}).bodyHead || "") && !recText(cwd).includes("apikey=" + KEY), recText(cwd));
          // domain property
          api.reqs.length = 0;
          const cwd2 = setupCwd("sub-domain", PASS_CHECK);
          await submit(cwd2, ["--engines", "gsc", "--property", "domain"]);
          const put2 = api.reqs.find((x) => x.url.startsWith("/gsc/"));
          check("Y7 --property domain uses the sc-domain:<host> property", put2 && put2.url === `/gsc/sites/${encodeURIComponent("sc-domain:127.0.0.1")}/sitemaps/${encodeURIComponent(SM)}` && !api.reqs.some((x) => x.url.startsWith("/bing/")), JSON.stringify(api.reqs.map((x) => x.url)));
        }

        if (want("submitBlocked")) {
          api.reqs.length = 0; api.gscStatus = 204; api.bingStatus = 200;
          let cwd = setupCwd("sub-nokey", PASS_CHECK);
          let r = await submit(cwd, [], subEnv({ BING_WEBMASTER_KEY: "" })); let j = rec(cwd);
          check("Z1 no Bing key: bing is BLOCKED (recorded, no request sent), gsc submitted, exit 0", r.code === 0 && /^bing: BLOCKED /m.test(r.so) && j.responses.find((x) => x.engine === "bing").status === "BLOCKED" && !api.reqs.some((x) => x.url.startsWith("/bing/")) && /^gsc: submitted/m.test(r.so), `${r.code} ${r.so}${r.se}`);
          api.reqs.length = 0;
          cwd = setupCwd("sub-none-run", PASS_CHECK);
          r = await submit(cwd, [], subEnv({ BING_WEBMASTER_KEY: "", GSC_TOKEN_FILE: path.join(tmp, "no-such-token.json") })); j = rec(cwd);
          check("Z2 neither engine can run: both BLOCKED, recorded, exit 3, nothing sent", r.code === 3 && /^gsc: BLOCKED /m.test(r.so) && /^bing: BLOCKED /m.test(r.so) && j.responses.length === 2 && j.responses.every((x) => x.status === "BLOCKED") && api.reqs.length === 0, `${r.code} ${r.so}${r.se} ${recText(cwd)}`);
        }

        if (want("submitHttp")) {
          let cwd = setupCwd("sub-403", PASS_CHECK);
          api.reqs.length = 0; api.gscStatus = 204; api.bingStatus = 403;
          let r = await submit(cwd, ["--engines", "bing"]); let j = rec(cwd);
          check("W1 Bing answers 403: refused, recorded with the status, exit 1, asked exactly once (never retried)", r.code === 1 && /^bing: REFUSED \(HTTP 403\)/m.test(r.so) && j.responses[0].status === 403 && api.reqs.filter((x) => x.url.startsWith("/bing/")).length === 1 && !secrets(r.so, recText(cwd)), `${r.code} ${r.so} reqs=${api.reqs.length}`);
          cwd = setupCwd("sub-401", PASS_CHECK);
          api.reqs.length = 0; api.gscStatus = 401; api.bingStatus = 200;
          r = await submit(cwd, ["--engines", "gsc"]); j = rec(cwd);
          check("W2 Search Console answers 401: refused, exit 1, asked exactly once, the token is not in the record", r.code === 1 && /^gsc: REFUSED \(HTTP 401\)/m.test(r.so) && api.reqs.filter((x) => x.url.startsWith("/gsc/")).length === 1 && !secrets(r.so, recText(cwd)), `${r.code} ${r.so} reqs=${api.reqs.length} ${recText(cwd)}`);
          cwd = setupCwd("sub-mixed", PASS_CHECK);
          api.reqs.length = 0; api.gscStatus = 401; api.bingStatus = 200;
          r = await submit(cwd);
          check("W3 one engine accepted and one refused: exit 0 (at least one succeeded), both recorded", r.code === 0 && rec(cwd).responses.length === 2, `${r.code} ${r.so}`);
          api.gscStatus = 204; api.bingStatus = 200;
        }

        if (want("submitDotenv")) {
          api.reqs.length = 0; api.gscStatus = 204; api.bingStatus = 200;
          const cwd = setupCwd("sub-dotenv", PASS_CHECK);
          const envFile = path.join(cwd, "project.env"); fs.writeFileSync(envFile, `# project keys\nBING_WEBMASTER_KEY=${KEY}\n`);
          const r = await submit(cwd, ["--dotenv", envFile], subEnv({ BING_WEBMASTER_KEY: "" }));
          const post = api.reqs.find((x) => x.url.startsWith("/bing/"));
          check("D1 --dotenv supplies the Bing key; it reaches Bing but not the output or the record", r.code === 0 && post && new URL(post.url, API).searchParams.get("apikey") === KEY && !secrets(r.so, r.se, recText(cwd)), `${r.code} ${r.so}${r.se}`);
        }
      } finally { server.close(); server.closeAllConnections?.(); }
    }
  } finally {
    st.server.close(); st.server.closeAllConnections?.();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
  return results;
}

// ---------------- mutants ----------------
const MUTANTS = [
  { name: "build-clock rule off", file: "sitemap-check.mjs", from: "const clock = allOne || (cluster.length >= BUILD_CLOCK_MIN_URLS && nearClock);", to: "const clock = false;", sc: ["lastmod", "limit"], expect: [/^L1 /, /^L2 /, /^L10 /, /^L11 /, /^M2 /] },
  { name: "build-clock threshold raised (5 -> 7)", file: "sitemap-check.mjs", from: "export const BUILD_CLOCK_MIN_URLS = 5;", to: "export const BUILD_CLOCK_MIN_URLS = 7;", sc: ["lastmod"], expect: [/^L2 /, /^L10 /, /^L11 /] },
  { name: "a shared minute far from the fetch time is a FAIL (nearness dropped)", file: "sitemap-check.mjs", from: "(cluster.length >= BUILD_CLOCK_MIN_URLS && nearClock)", to: "(cluster.length >= BUILD_CLOCK_MIN_URLS)", sc: ["lastmod"], expect: [/^L9 /] },
  { name: "every-URL-shares-one-minute rule dropped", file: "sitemap-check.mjs", from: "const clock = allOne || (", to: "const clock = (", sc: ["lastmod"], expect: [/^L10 /] },
  { name: "the sitemap's Last-Modified header is ignored", file: "sitemap-check.mjs", from: "[now, ...lastModified].some", to: "[now].some", sc: ["lastmod"], expect: [/^L11 /] },
  { name: "the shared-minute WARN is dropped", file: "sitemap-check.mjs", from: "const shared = !clock && cluster.length >= BUILD_CLOCK_MIN_URLS;", to: "const shared = false;", sc: ["lastmod"], expect: [/^L9 /] },
  { name: "noindex rule off", file: "sitemap-check.mjs", from: "const noindexed = rows.filter((r) => r.status === 200 && r.noindex);", to: "const noindexed = [];", sc: ["bad", "lastmod"], expect: [/^B4 /, /^L8 /] },
  { name: "X-Robots-Tag header ignored", file: "sitemap-check.mjs", from: "if (xrt && NOINDEX.test(String(xrt)))", to: "if (false)", sc: ["lastmod"], expect: [/^L8 /] },
  { name: "missing planned page rule off", file: "sitemap-check.mjs", from: "const missing = [...planKeys.values()].filter((p) => !p.noindex && !smKeys.has(p.key)).map((p) => p.url);", to: "const missing = [];", sc: ["bad"], expect: [/^B6 /] },
  { name: "planned noindex page allowed in the sitemap", file: "sitemap-check.mjs", from: "const p = planKeys.get(pageKey(e.loc)); return p && p.noindex; })", to: "const p = planKeys.get(pageKey(e.loc)); return false; })", sc: ["bad"], expect: [/^B2 /] },
  { name: "URL outside the page plan allowed", file: "sitemap-check.mjs", from: "const notInPlan = [...new Set(sitemapUrls.filter((e) => { const k = pageKey(e.loc); return !planKeys.has(k) && !existingKeys.has(k); }).map((e) => e.loc))];", to: "const notInPlan = [];", sc: ["bad"], expect: [/^B1 /] },
  { name: "redirects and 404s accepted as 200", file: "sitemap-check.mjs", from: "const notOk = rows.filter((r) => !r.skipped && (r.status !== 200 || r.error));", to: "const notOk = [];", sc: ["bad"], expect: [/^B3 /] },
  { name: "canonical mismatch accepted", file: "sitemap-check.mjs", from: "r.canonical && strict(r.canonical) !== strict(r.url)", to: "false", sc: ["bad"], expect: [/^B5 /] },
  { name: "date-only and future lastmod accepted", file: "sitemap-check.mjs", from: "const badMod = sitemapUrls.filter((e) => e.lastmod && String(e.lastmod).trim()).map((e) => ({ e, why: lastmodProblem(e.lastmod, now) })).filter((x) => x.why);", to: "const badMod = [];", sc: ["lastmod"], expect: [/^L5 /, /^L6 /] },
  { name: "robots.txt not obeyed", file: "sitemap-check.mjs", from: "if (!robotsAllows(robots.starRules, u.pathname + u.search)) {", to: "if (false) {", sc: ["robots"], expect: [/^R1 /] },
  { name: "a failing check still exits 0", file: "sitemap-check.mjs", from: "return fails.length ? 1 : 0;", to: "return 0;", sc: ["bad", "lastmod"], expect: [/^B0 /, /^L1 /] },
  { name: "the first 429 does not stop the run", file: "sitemap-check.mjs", from: "if (res.status === 429) { await res.arrayBuffer().catch(() => {}); throw new Stop429(url); }", to: "", sc: ["rate"], expect: [/^T1 /, /^T2 /] },
  { name: "a 429 does not overwrite the earlier PASS file", file: "sitemap-check.mjs", from: "      write(rep);\n      out(`STOP 429", to: "      out(`STOP 429", sc: ["rate"], expect: [/^T3 /] },
  { name: "the polite gap is not kept", file: "sitemap-check.mjs", from: "if (wait > 0) await sleep(wait);", to: "", sc: ["pace"], expect: [/^P1 /] },
  { name: "--max-urls ignored", file: "sitemap-check.mjs", from: "if (fetched >= maxUrls) {", to: "if (false) {", sc: ["limit"], expect: [/^M1 /] },
  { name: "--exclude ignored", file: "sitemap-check.mjs", from: "if (exclRes.some((re) => re.test(u.pathname))) {", to: "if (false) {", sc: ["limit"], expect: [/^M3 /] },
  { name: "existing list ignored (no page is matched by it)", file: "sitemap-check.mjs", from: "const existingKeys = new Set(existingPages.map((p) => p.key));", to: "const existingKeys = new Set();", sc: ["existing"], expect: [/^E1 /, /^E2 /, /^E7 /] },
  { name: "every URL passes SM-IN-PLAN once a list is given", file: "sitemap-check.mjs", from: "return !planKeys.has(k) && !existingKeys.has(k); })", to: "return false; })", sc: ["existing"], expect: [/^E3 /, /^E6 /] },
  { name: "an entry without why accepted", file: "sitemap-check.mjs", from: "if (typeof p.why !== \"string\" || !p.why.trim()) {", to: "if (false) {", sc: ["existing"], expect: [/^E5 an entry with no why/, /^E5 an entry with blank why/] },
  { name: "an unapproved plan/existing-pages.json is used", file: "sitemap-check.mjs", from: "else if (fs.existsSync(workingList)) notes.push(", to: "else if (fs.existsSync(workingList)) existingFile = workingList; else if (false) notes.push(", sc: ["existing"], expect: [/^E6 an unapproved/] },
  { name: "the NOTE about an ignored unapproved list is not printed", file: "sitemap-check.mjs", from: "for (const n of notes) out(", to: "for (const n of []) out(", sc: ["existing"], expect: [/^E6 \.\.\. and a NOTE/] },
  { name: "the approved existing-pages.json is not read by default", file: "sitemap-check.mjs", from: "if (fs.existsSync(approvedList)) existingFile = approvedList;", to: "if (false) existingFile = approvedList;", sc: ["existing"], expect: [/^E7 /] },
  { name: "a trailing slash in the list makes a different page", file: "sitemap-check.mjs", from: "url, key: pageKey(url) });", to: "url, key: url });", sc: ["existing"], expect: [/^E1 /, /^E2 /] },
  { name: "the matched count is not reported", file: "sitemap-check.mjs", from: "matched: viaExisting.length, urls: viaExisting", to: "matched: 0, urls: viaExisting", sc: ["existing"], expect: [/^E1 the json/, /^E7 /, /^E8 /] },
  { name: "listed pages are exempt from the noindex rule", file: "sitemap-check.mjs", from: "const noindexed = rows.filter((r) => r.status === 200 && r.noindex);", to: "const noindexed = rows.filter((r) => r.status === 200 && r.noindex && !existingKeys.has(pageKey(r.url)));", sc: ["existing"], expect: [/^E4 the other rules/] },
  { name: "listed pages are forced into the sitemap file (coverage)", file: "sitemap-check.mjs", from: "const missing = [...planKeys.values()].filter(", to: "const missing = [...planKeys.values(), ...existingPages].filter(", sc: ["existing"], expect: [/^E8 /] },
  { name: "submit without a PASS of the check", file: "sitemap-submit.mjs", from: "if (!check || check.status !== \"PASS\") {", to: "if (!check) {", sc: ["submitRefuse"], expect: [/^X2 /] },
  { name: "submit of a sitemap the check never read", file: "sitemap-submit.mjs", from: "if (!checkedMaps.has(strict(opts.sitemap))) {", to: "if (false) {", sc: ["submitRefuse"], expect: [/^X3 /] },
  { name: "the Bing key is written to the record (request line)", file: "sitemap-submit.mjs", from: "const shown = clean(url);", to: "const shown = url;", sc: ["submitOk"], expect: [/^Y6 /] },
  { name: "the Bing key is written to the record (body head)", file: "sitemap-submit.mjs", from: "bodyHead: clean(r.text).slice(0, 200), at, request: `POST", to: "bodyHead: r.text.slice(0, 200), at, request: `POST", sc: ["submitOk"], expect: [/^Y6 /] },
  { name: "the bearer token is not sent", file: "sitemap-submit.mjs", from: "headers: { authorization: `Bearer ${tok}`, \"user-agent\": \"pewp-sitemap-submit\" }", to: "headers: { \"user-agent\": \"pewp-sitemap-submit\" }", sc: ["submitOk"], expect: [/^Y3 /] },
  { name: "the sitemap address is not URL-encoded in the Search Console path", file: "sitemap-submit.mjs", from: "/sitemaps/${encodeURIComponent(opts.sitemap)}`;", to: "/sitemaps/${opts.sitemap}`;", sc: ["submitOk"], expect: [/^Y2 /] },
  { name: "a missing Bing key is not BLOCKED (a request goes out anyway)", file: "sitemap-submit.mjs", from: "      if (!key) {\n        responses.push({ engine, status: \"BLOCKED\"", to: "      if (false) {\n        responses.push({ engine, status: \"BLOCKED\"", sc: ["submitBlocked"], expect: [/^Z1 /] },
  { name: "a 4xx is retried", file: "sitemap-submit.mjs", from: "const r = await send(url, { method: \"POST\"", to: "await send(url, { method: \"POST\", headers: { \"content-type\": \"application/json\" }, body: \"{}\" }); const r = await send(url, { method: \"POST\"", sc: ["submitHttp"], expect: [/^W1 /] },
  { name: "all engines blocked exits 0", file: "sitemap-submit.mjs", from: "return responses.some((r) => r.outcome !== \"blocked\") ? 1 : 3;", to: "return 0;", sc: ["submitBlocked"], expect: [/^Z2 /] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-sitemap.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  const main = await scenarios(scriptsDir);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  let failed = main.filter((r) => !r.ok).length;
  console.log(failed ? `SITEMAP TEST FAIL: ${failed} of ${main.length}` : `SITEMAP TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    let caught = 0, ran = 0;
    for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-sm-mutant-"));
      for (const f of NEEDED) fs.copyFileSync(path.join(scriptsDir, f), path.join(mdir, f));
      const target = path.join(mdir, mu.file); const src = fs.readFileSync(target, "utf8"); const count = src.split(mu.from).length - 1;
      if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${mu.file} (the patch did not apply)`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
      const chk = spawnSync(node, ["--check", target], { encoding: "utf8", timeout: 60_000 });
      if (chk.status) { console.log(`FAIL mutant "${mu.name}": mutated file does not parse: ${chk.stderr.slice(0, 200)}`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      const res = await scenarios(mdir, mu.sc);
      const red = res.filter((r) => !r.ok);
      const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  fs.rmSync(homeTmp, { recursive: true, force: true, maxRetries: 5 });
  process.exit(failed ? 1 : 0);
}
