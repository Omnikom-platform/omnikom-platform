// Usage: node test-launch.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of launch.mjs (stages/launch.md). Local fixtures only: a tiny site served from a temp folder by an http server on 127.0.0.1
// (it honours a Cloudflare-style `_redirects` and a simplified `_headers`), a fixture PSI answer file (--psi-fixture), a fake PSI
// endpoint on 127.0.0.1 for the key path (PSI_API_BASE, tests only), a stand-in Detailed SEO CLI, and the REAL gate.mjs on the
// skill's own plan fixtures (fixtures/pewp + fixtures/site-clean, planned and approved in a temp copy). Every child runs with a
// network guard (--import) that refuses any non-local request and logs it; the log must stay empty. The live PSI endpoint and a
// live site are UNPROVEN here: nothing in this test talks to them.
// Covers: --init writes 22 OPEN items with their check or proof slot; --access (AskUserQuestion shape); --task (stop condition,
// allowed reasons); the strict gate FAIL before approval and PASS after; live-headers PASS, then FAIL with noindex (meta, then
// X-Robots-Tag), then PASS again; robots.txt disallow FAILs; canonical mismatch FAILs; a missing redirect FAILs and comes back;
// the sitemap; PSI from the fixture; the key path (key absent from every output and file, scrubbed from Google's error);
// no key = BLOCKED owner-access psi-key with no request; refused blocks and records; exit 3 while items are open and exit 0 at
// the stop condition; a granted access lifts its block (exit 3 again); a hand-made PASS without its proof line is not accepted;
// a changed owner-proof file reopens its item; C/D items fall due; --psi-fixture is refused for a live host.
// The writing check (L-B9, writing-gate.mjs) runs for real (Chromium from the render-gate install, via a fake HOME that names only that
// path): the clean run must carry 'writing PASS writing-gate 7 rules: 7 PASS'; llms.txt missing (built, live) and COOP missing (built,
// live) each make L-B9 FAIL on the right rule; the PSI answers the psi check saves under launch/psi feed the writing evidence; L-B8 asks
// for COOP on https (unit); a ledger page missing from the build leaves the item open. Most writing runs use the static rules only
// (LAUNCH_WRITING_ONLY, a test knob that can FAIL but never PASSes).
// Mutants (watched-fail): each breaks the code an assertion guards in a copy of the skill, and the named assertions must turn red.
// Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));
const FIX = path.join(here, "..", "fixtures");
const KEY = "PSIKEY-launch-SECRET-7f3Q";   // gitleaks:allow (a made-up test key, never a real one)
const TODAY = "2026-10-29";
const PLAN_FLAGS = ["--today", "2026-10-22", "--prog-min-words", "250", "--prog-min-unique", "150", "--prog-min-facts", "4", "--prog-max-similarity", "0.4", "--data-source", "fixture data sheet (invented)"];

const GUARD = String.raw`import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
const log = (u) => { if (process.env.LAUNCH_NETGUARD_LOG) fs.appendFileSync(process.env.LAUNCH_NETGUARD_LOG, u + "\n"); };
const local = (h) => /^(127\.0\.0\.1|localhost|\[::1\])$/.test(h || "");
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const url = typeof input === "string" ? input : input?.url ?? String(input); let h = ""; try { h = new URL(url).hostname; } catch {} if (!local(h)) { log(url); return Promise.reject(new Error("NETWORK GUARD: refused non-local request " + url)); } return realFetch(input, init); };
for (const mod of [http, https]) for (const fn of ["request", "get"]) { const real = mod[fn]; mod[fn] = function (...a) { const o = a[0]; const h = typeof o === "string" ? (() => { try { return new URL(o).hostname; } catch { return ""; } })() : o instanceof URL ? o.hostname : (o?.hostname || o?.host || ""); if (!local(String(h).replace(/:\d+$/, ""))) { log(fn + " " + h); throw new Error("NETWORK GUARD: refused non-local request " + h); } return real.apply(this, a); }; }
syncBuiltinESMExports();
`;

// stand-in for E:\Alex Sevilla\tools\detailed-seo\run.mjs: same CLI shape (<url> --out <dir>), same data.json fields the check reads
const FAKE_DSEO = String.raw`import fs from "node:fs";
import path from "node:path";
const url = process.argv[2], out = process.argv[process.argv.indexOf("--out") + 1];
const r = await fetch(url); const html = await r.text();
const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/i) || [])[1] || null;
const robotsTag = (html.match(/<meta name="robots" content="([^"]+)"/i) || [])[1] || "";
const h1 = [...html.matchAll(/<h1>([^<]*)<\/h1>/gi)].map((m) => m[1]);
const u = new URL(url), dir = path.join(out, (u.host + "-" + (u.pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home")).replace(/[^a-z0-9.-]+/gi, "-"));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ tool: "fake-detailed-seo", url, http: { status: r.status }, page: { title, h1 }, panel: { title, canonical, robotsTag, h1 } }));
console.log("[detailed-seo] wrote " + dir);
`;

const v5 = (perf, a11y = 1, bp = 1, seo = 1) => ({ kind: "pagespeedonline#result", lighthouseResult: { categories: { performance: { score: perf }, accessibility: { score: a11y }, "best-practices": { score: bp }, seo: { score: seo } } } });

async function scenarios(dir) {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 900) });
  const script = path.join(dir, "launch.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-launch-"));
  const home = path.join(tmp, "home"); fs.mkdirSync(home);
  const guardFile = path.join(tmp, "netguard.mjs"), netLog = path.join(tmp, "net-attempts.log");
  fs.writeFileSync(guardFile, GUARD);
  const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s, null, 1)); };
  const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  // the writing check starts Chromium through the render-gate install that machine.local.json names; the children run with a fake HOME,
  // so they get a machine file that holds that one path and nothing else
  let renderGate = null;
  try { renderGate = JSON.stringify(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "machine.local.json"), "utf8"))).match(/"renderGate"\s*:\s*"([^"]+)"/)?.[1] || null; } catch { /* reported by the setup check */ }
  if (renderGate) w(path.join(home, ".claude", "machine.local.json"), { renderGate });
  const WRITING_NARROW = { env: { LAUNCH_WRITING_ONLY: "WG-1,WG-5,WG-6,WG-7" } }; // static rules only: fast, and never a PASS (a test knob)

  // ---- the fixture site ----
  const siteDir = path.join(tmp, "site");
  const siteHits = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), p = decodeURIComponent(u.pathname);
    siteHits.push(p);
    const rd = new Map();
    const rf = path.join(siteDir, "_redirects");
    if (fs.existsSync(rf)) for (const line of fs.readFileSync(rf, "utf8").split(/\r?\n/)) { const [f, t, c] = line.trim().split(/\s+/); if (f && t) rd.set(f, [t, Number(c || 302)]); }
    if (rd.has(p)) { res.writeHead(rd.get(p)[1], { location: rd.get(p)[0] }); return res.end(); }
    const hdr = {};
    const hf = path.join(siteDir, "_headers");
    if (fs.existsSync(hf)) for (const line of fs.readFileSync(hf, "utf8").split(/\r?\n/)) { const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/); if (m) hdr[m[1]] = m[2]; }
    const file = path.join(siteDir, p.endsWith("/") ? p + "index.html" : p);
    if (!file.startsWith(siteDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
    const type = file.endsWith(".xml") ? "application/xml" : file.endsWith(".txt") ? "text/plain" : "text/html; charset=utf-8";
    res.writeHead(200, { "content-type": type, ...hdr });
    res.end(fs.readFileSync(file));
  });
  // ---- the fake PSI endpoint (key path only) ----
  const psiHits = [];
  let psiMode = "good";
  const psi = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    psiHits.push({ path: u.pathname, url: u.searchParams.get("url"), strategy: u.searchParams.get("strategy"), cats: u.searchParams.getAll("category"), key: u.searchParams.get("key") });
    res.setHeader("content-type", "application/json");
    if (psiMode === "bad" && /about/.test(u.searchParams.get("url") || "")) { res.statusCode = 400; return res.end(JSON.stringify({ error: { code: 400, message: `Invalid request ${req.url}` } })); }
    const ans = v5(u.searchParams.get("strategy") === "mobile" ? 0.93 : 0.99);
    if (psiMode === "rb") ans.lighthouseResult.audits = { "render-blocking-insight": { score: 0, metricSavings: { FCP: 850, LCP: 0 }, details: { type: "table", items: [{ url: "/assets/app.css", totalBytes: 24888, wastedMs: 151 }] } } };
    res.end(JSON.stringify(ans));
  });
  for (const s of [server, psi]) s.on("connection", (c) => { sockets.add(c); c.on("close", () => sockets.delete(c)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  await new Promise((r) => psi.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const psiBase = `http://127.0.0.1:${psi.address().port}/pagespeedonline/v5/runPagespeed`;
  const page = (p, { title, canonical, robots = "index, follow", h1s = 1 } = {}) => `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${canonical ?? base + p}"><meta name="robots" content="${robots}"></head><body>${"<h1>Fixture Realty</h1>".repeat(h1s)}<a href="/about/">About us</a></body></html>`;
  const writeSite = (o = {}) => {
    w(path.join(siteDir, "index.html"), page("/", { title: "Fixture Realty: homes in Testville" }));
    w(path.join(siteDir, "about", "index.html"), page("/about/", { title: "About Fixture Realty", ...(o.about || {}) }));
    w(path.join(siteDir, "robots.txt"), o.robots ?? `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
    w(path.join(siteDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url><url><loc>${base}/about/</loc></url></urlset>\n`);
    w(path.join(siteDir, "_redirects"), o.redirects ?? "/old-about /about/ 301\n/team/old-agent /about/ 301\n");
    w(path.join(siteDir, "_headers"), `/*\n  X-Content-Type-Options: nosniff\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n${o.noCoop ? "" : "  Cross-Origin-Opener-Policy: same-origin\n"}${o.extraHeader ? "  " + o.extraHeader + "\n" : ""}`);
    if (o.noLlms) fs.rmSync(path.join(siteDir, "llms.txt"), { force: true }); else w(path.join(siteDir, "llms.txt"), LLMS);
  };
  const LLMS = "# Fixture Realty\n\n> Facts about Fixture Realty for AI assistants.\n\n- [Home](/): what we do\n- [About](/about/): who we are\n";
  writeSite();
  // the launch build the gate and the writing check read: the skill's clean plan fixture plus an /about/ page (the ledger's second page),
  // an llms.txt and a _headers file (HSTS + COOP), which every V2 build must ship
  const gateSite = path.join(tmp, "gate-site");
  const writeGateSite = (o = {}) => {
    if (!fs.existsSync(gateSite)) { fs.cpSync(path.join(FIX, "site-clean"), gateSite, { recursive: true }); w(path.join(gateSite, "about", "index.html"), `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>About Fixture Realty</title></head>\n<body><header><nav><a href="/">Fixture Realty</a></nav></header>\n<main><h1>About Fixture Realty</h1><p>An invented team for the launch tests.</p></main>\n<footer><p>Jane Sample, Real Estate Salesperson. DRE #01234567. Broker: Sample Valley Brokerage Inc. &copy; 2026 Sample Valley Realty</p></footer></body></html>\n`);
      const home = path.join(gateSite, "index.html"); const h = fs.readFileSync(home, "utf8"); if (!h.includes("</nav>")) throw new Error("fixture home has no </nav> to link /about/ from"); fs.writeFileSync(home, h.replace("</nav>", `<a href="/about/">About</a></nav>`)); }
    w(path.join(gateSite, "_headers"), `/*\n  X-Content-Type-Options: nosniff\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n${o.noCoop ? "" : "  Cross-Origin-Opener-Policy: same-origin\n"}`);
    if (o.noLlms) fs.rmSync(path.join(gateSite, "llms.txt"), { force: true }); else w(path.join(gateSite, "llms.txt"), LLMS);
  };
  writeGateSite();
  const mapFile = path.join(tmp, "map", "_redirects");
  w(mapFile, "# the 301 map\n/old-about /about/ 301\n/team/old-agent /about/ 301\n/listing/* /about/ 301\n");
  const dseo = path.join(tmp, "tools", "detailed-seo", "run.mjs"); w(dseo, FAKE_DSEO);
  const counter = path.join(tmp, "count-open.mjs"); w(counter, `console.log("0 open questions in questions.json");\n`);
  const psiFixture = path.join(tmp, "psi-fixture.json"); w(psiFixture, { mobile: v5(0.94), desktop: v5(0.99) });
  const proofShot = path.join(tmp, "owner", "crm-test-lead.png"); w(proofShot, "png stand-in: the CRM record of the test lead");

  // ---- the plan fixture for the real strict gate ----
  const pewp = path.join(tmp, "pewp");
  fs.cpSync(path.join(FIX, "pewp"), pewp, { recursive: true });
  const node = (s, args) => spawnSync(process.execPath, [path.join(dir, s), ...args], { cwd: tmp, encoding: "utf8", timeout: 300000 });
  const pl = node("plan-site.mjs", [pewp, ...PLAN_FLAGS]);
  check("setup: plan-site.mjs plans the fixture (exit 0)", pl.status === 0, `${pl.status} ${pl.stdout}${pl.stderr}`);

  const run = (args, { env = {}, timeout = 240000 } = {}) => new Promise((resolve) => {
    const e = { ...process.env, USERPROFILE: home, HOME: home, NODE_OPTIONS: `--import ${pathToFileURL(guardFile).href}`, LAUNCH_NETGUARD_LOG: netLog, ...env };
    if (!("PSI_API_KEY" in env)) delete e.PSI_API_KEY;
    if (!("PSI_API_BASE" in env)) delete e.PSI_API_BASE;
    const c = spawn(process.execPath, [script, ...args], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"], env: e });
    let so = "", se = "";
    c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
    const t = setTimeout(() => c.kill(), timeout);
    c.on("close", (code) => { clearTimeout(t); resolve({ code, so, se, out: so + se }); });
  });
  const L = () => J(path.join(pewp, "launch.json"));
  const item = (id, l = L()) => l.items.find((i) => i.id === id);
  const CHK = ["--psi-fixture", psiFixture, "--gap-ms", "0", "--today", TODAY];

  try {
    // ---- usage ----
    const u0 = await run([]), u1 = await run(["--help"]), u2 = await run(["--check"]);
    check("usage: no arguments = exit 2 with the usage; --help = exit 0; a mode without <pewp> = exit 2", u0.code === 2 && /usage/.test(u0.so) && u1.code === 0 && /usage/.test(u1.so) && u2.code === 2, `${u0.code} ${u1.code} ${u2.code} ${u2.se}`);

    // ---- init ----
    const i1 = await run(["--init", pewp, "--site-url", base + "/", "--pages", `${base}/,${base}/about/`, "--site-dir", gateSite, "--waive", "RE-DISC-001", "--redirects", mapFile, "--detailed-seo", dseo, "--omnikom-user", "team@omnikom.test"]);
    await run(["--config", pewp, "writing.viewports=390x844"]); // one phone viewport keeps the browser runs short
    check("setup: the render-gate install is named in machine.local.json (the writing check needs its Chromium)", !!renderGate, "machine.local.json has no renderGate path");
    const l1 = fs.existsSync(path.join(pewp, "launch.json")) ? L() : { items: [] };
    const ids = l1.items.map((i) => i.id).join(" ");
    const expectIds = "L-A1 L-A2 L-A3 L-A4 L-A5 L-A6 L-B7 L-B8 L-B9 L-B10 L-B11 L-B12 L-B13 L-C14 L-C15 L-C16 L-C17 L-C18 L-D19 L-D20 L-D21 L-D22";
    check("--init writes launch.json with the 22 L-items in order, every one OPEN, each with its check and/or OWNER-PROOF slot", i1.code === 0 && ids === expectIds && l1.items.every((i) => i.status === "OPEN" && i.proof && i.doneWhen && (i.checks.length || i.ownerProof) && i.owner === null), `exit ${i1.code} ${i1.out} ids=${ids}`);
    check("--init: the proof slots are the right kind (L-A6 redirects, L-B7 gate, L-B8 live-headers, L-B9 psi + writing, L-B10 canonical + detailed-seo, L-B11 sitemap + OWNER-PROOF, L-B12 OWNER-PROOF)", item("L-A6", l1)?.proof === "check:redirects" && item("L-B7", l1)?.proof === "check:gate" && item("L-B8", l1)?.proof === "check:live-headers" && item("L-B9", l1)?.proof === "check:psi + check:writing" && item("L-B10", l1)?.proof === "check:canonical + check:detailed-seo" && item("L-B11", l1)?.proof === "check:sitemap + OWNER-PROOF" && item("L-B12", l1)?.proof === "OWNER-PROOF", JSON.stringify(l1.items.map((i) => [i.id, i.proof])));
    const i2 = await run(["--init", pewp, "--site-url", base + "/"]);
    check("--init refuses to overwrite an existing ledger without --force (exit 2)", i2.code === 2 && /--force/.test(i2.se), `${i2.code} ${i2.out}`);
    const st0 = await run(["--status", pewp, "--today", TODAY]);
    check("--status on a fresh ledger: exit 3 (items open), LEDGER OPEN", st0.code === 3 && /LEDGER OPEN/.test(st0.so), `${st0.code} ${st0.out.slice(-400)}`);

    // ---- access + task ----
    const a1 = await run(["--access", pewp]), a2 = await run(["--access", pewp, "--json"]);
    let qs = []; try { qs = JSON.parse(a2.so); } catch {}
    const keys = qs.map((q) => q.key).join(" ");
    check("--access prints the owner access checklist (9 items: registrar/DNS, Cloudflare, Search Console, Business Profile, Bing, analytics, listings, partner sites, PSI key) with why, minimum role and 'never send passwords: add omnikom as a user'",
      a1.code === 0 && keys === "registrar-dns cloudflare search-console business-profile bing-webmaster analytics listing-profiles partner-sites psi-key" && /Never send passwords: add omnikom as a user/.test(a1.so) && /minimum role: an API token scoped to Account > Cloudflare Pages: Edit/.test(a1.so) && /team@omnikom\.test/.test(a1.so), `${a1.code} keys=${keys}\n${a1.so.slice(0, 600)}`);
    check("--access --json is the AskUserQuestion shape: header <= 12 characters, a question, 4 options with label + description, single select; also written to launch/access-questions.json",
      qs.length === 9 && qs.every((q) => q.header.length <= 12 && q.question && q.multiSelect === false && q.options.length === 4 && q.options.every((o) => o.label && o.description)) && fs.existsSync(path.join(pewp, "launch", "access-questions.json")), a2.so.slice(0, 500));
    const t1 = await run(["--task", pewp]);
    check("--task prints the one-shot brief: the stop condition, the allowed BLOCKED reasons, never PASS without the check's own output line, the open items",
      t1.code === 0 && /Stop condition/.test(t1.so) && /Every L-item is PASS with its proof line, or BLOCKED with an allowed reason and what unblocks it\. Nothing else ends the task/.test(t1.so) && ["owner-access", "client-answer", "owner-proof", "third-party-outage"].every((r) => t1.so.includes(r)) && /Never mark PASS without the check's own output line/.test(t1.so) && /OPEN L-A6/.test(t1.so), t1.so.slice(0, 800));

    // ---- the strict gate: unapproved plan FAILs, approved PASSes ----
    const g1 = await run(["--check", pewp, "--only", "L-B7", ...CHK]);
    check("strict gate: on an unapproved plan --check marks L-B7 FAIL with the gate's own lines (L-003 / GT-001), exit 3", g1.code === 3 && item("L-B7").status === "FAIL" && /FAIL gate 13 checks/.test(item("L-B7").results.gate.line) && /GT-001/.test(item("L-B7").results.gate.line), `${g1.code} ${JSON.stringify(item("L-B7").results)}`);
    const ap1 = node("approve.mjs", ["x", "targets", "--pewp", pewp, "--by", "Test Owner"]);
    node("plan-site.mjs", [pewp, ...PLAN_FLAGS]);
    const ap2 = node("approve.mjs", ["x", "plan", "--pewp", pewp, "--by", "Test Owner"]);
    check("setup: approve.mjs signs the fixture targets and plan", ap1.status === 0 && ap2.status === 0, `${ap1.stdout}${ap1.stderr}${ap2.stdout}${ap2.stderr}`);

    // ---- full check on the clean site ----
    const c1 = await run(["--check", pewp, ...CHK]);
    const l2 = L();
    check("clean site: L-B7 PASS with the gate's summary line 'PASS gate 13 checks: 13 PASS' (strict, waived RE-DISC-001)", item("L-B7", l2).status === "PASS" && /^gate PASS gate 13 checks: 13 PASS, 0 FAIL, 0 ERROR \(strict, waived RE-DISC-001\)/.test(item("L-B7", l2).proofLine), item("L-B7", l2).proofLine || JSON.stringify(item("L-B7", l2).results));
    check("clean site: L-B9 also carries the writing proof line 'writing PASS writing-gate 7 rules: 7 PASS, 0 FAIL, 0 NOT RUN' (the full gate on the launch build with the live URL and the ledger's 2 pages), and the report is saved under launch/writing/", /writing PASS writing-gate 7 rules: 7 PASS, 0 FAIL, 0 NOT RUN/.test(item("L-B9", l2).proofLine || "") && fs.existsSync(path.join(pewp, "launch", "writing", "report.json")), item("L-B9", l2).proofLine || JSON.stringify(item("L-B9", l2).results.writing));
    check("clean site: L-B8 live-headers PASS (200, indexable, robots allow, nosniff) with its proof line", item("L-B8", l2).status === "PASS" && /^live-headers PASS 2\/2 pages/.test(item("L-B8", l2).proofLine), JSON.stringify(item("L-B8", l2)));
    check("clean site: L-A6 redirects PASS 2/2 old URLs answer 301, the pattern rule listed as NOT CHECKED", item("L-A6", l2).status === "PASS" && /redirects PASS 2\/2 old URLs answer 301/.test(item("L-A6", l2).proofLine) && /1 pattern rule\(s\) NOT CHECKED/.test(item("L-A6", l2).proofLine), JSON.stringify(item("L-A6", l2)));
    check("clean site: L-B9 psi PASS from the fixture (4 runs), the line says it is a fixture, not a live measurement", item("L-B9", l2).status === "PASS" && /psi PASS 4\/4 runs \(fixture psi-fixture\.json, not a live measurement\)/.test(item("L-B9", l2).proofLine), JSON.stringify(item("L-B9", l2)));
    check("clean site: L-B10 PASS: canonical = URL, one H1, title <= 60, and the Detailed SEO CLI agrees", item("L-B10", l2).status === "PASS" && /canonical PASS 2\/2/.test(item("L-B10", l2).proofLine) && /detailed-seo PASS 2\/2/.test(item("L-B10", l2).proofLine), JSON.stringify(item("L-B10", l2)));
    check("clean site: L-B11 sitemap PASS but the item stays OPEN until its OWNER-PROOF is recorded", item("L-B11", l2).results.sitemap?.status === "PASS" && item("L-B11", l2).status === "OPEN" && /OWNER-PROOF/.test(item("L-B11", l2).needs.join(" ")), JSON.stringify(item("L-B11", l2)));
    check("clean site: L-A1 stays OPEN (no command configured), and --check exits 3 with items open", item("L-A1", l2).status === "OPEN" && c1.code === 3 && /LEDGER OPEN/.test(c1.so), `${c1.code} ${JSON.stringify(item("L-A1", l2).needs)}`);
    check("--check writes runs/<date>-launch.md with the command, the exit code and the output", fs.existsSync(path.join(pewp, "runs", `${TODAY}-launch.md`)) && /Exit: 3/.test(fs.readFileSync(path.join(pewp, "runs", `${TODAY}-launch.md`), "utf8")), "");
    check("clean site: the launch date is recorded when L-B8 first passes", l2.launchedAt === TODAY, l2.launchedAt);

    // ---- the watched mutations of the fixture ----
    writeSite({ about: { robots: "noindex, follow" } });
    const n1 = await run(["--check", pewp, "--only", "L-B8", ...CHK]);
    check("noindex (meta) on the fixture makes --check mark L-B8 live-headers FAIL, exit 3", n1.code === 3 && item("L-B8").status === "FAIL" && /noindex \(meta robots="noindex, follow"\)/.test(item("L-B8").results["live-headers"].line), `${n1.code} ${item("L-B8").results["live-headers"]?.line}`);
    writeSite({ extraHeader: "X-Robots-Tag: noindex" });
    const n2 = await run(["--check", pewp, "--only", "L-B8", ...CHK]);
    check("noindex (X-Robots-Tag header) on the fixture makes L-B8 FAIL", n2.code === 3 && item("L-B8").status === "FAIL" && /X-Robots-Tag: noindex/.test(item("L-B8").results["live-headers"].line), `${n2.code} ${item("L-B8").results["live-headers"]?.line}`);
    writeSite();
    await run(["--check", pewp, "--only", "L-B8", ...CHK]);
    check("removing the noindex makes L-B8 PASS again", item("L-B8").status === "PASS" && /^live-headers PASS/.test(item("L-B8").proofLine), JSON.stringify(item("L-B8").results));
    writeSite({ robots: "User-agent: *\nDisallow: /about/\n" });
    await run(["--check", pewp, "--only", "L-B8", ...CHK]);
    check("robots.txt disallowing a page makes L-B8 FAIL (Googlebot and Bingbot named)", item("L-B8").status === "FAIL" && /robots\.txt disallows \/about\/ for Googlebot/.test(item("L-B8").results["live-headers"].line), item("L-B8").results["live-headers"]?.line);
    writeSite({ about: { canonical: base + "/" } });
    await run(["--check", pewp, "--only", "L-B10", ...CHK]);
    check("a canonical that is not the page's own URL makes L-B10 FAIL (built-in check and the Detailed SEO CLI)", item("L-B10").status === "FAIL" && /canonical FAIL/.test(item("L-B10").results.canonical.line) && /detailed-seo FAIL/.test(item("L-B10").results["detailed-seo"].line), JSON.stringify(item("L-B10").results));
    writeSite({ redirects: "/old-about /about/ 301\n" });
    const r1 = await run(["--check", pewp, "--only", "L-A6", ...CHK]);
    check("a missing redirect makes L-A6 FAIL: the old URL answers 404, want 301", r1.code === 3 && item("L-A6").status === "FAIL" && /\/team\/old-agent answered 404 \(want 301 to /.test(item("L-A6").results.redirects.line), `${r1.code} ${item("L-A6").results.redirects?.line}`);
    writeSite({ redirects: "/old-about /about/ 302\n/team/old-agent /about/ 301\n" });
    await run(["--check", pewp, "--only", "L-A6", ...CHK]);
    check("a 302 where a 301 is wanted makes L-A6 FAIL", item("L-A6").status === "FAIL" && /old-about answered 302/.test(item("L-A6").results.redirects.line), item("L-A6").results.redirects?.line);
    writeSite();

    // ---- the writing check (L-B9): each habit it guards, made on the fixture and put back (watched fail). Static rules only (a test knob
    //      that can FAIL but never PASS); the full 7 rules ran in the clean check above ----
    const wline = () => item("L-B9").results.writing?.line || "";
    const woutput = () => { try { return fs.readFileSync(path.join(pewp, "launch", "writing", "output.txt"), "utf8"); } catch { return ""; } };
    writeGateSite({ noLlms: true });
    await run(["--check", pewp, "--only", "L-B9", ...CHK], WRITING_NARROW);
    check("llms.txt missing from the launch build makes L-B9 FAIL on the writing check: FAIL WG-6 'llms.txt is not in the built folder'", item("L-B9").status === "FAIL" && /^writing FAIL exit 1/.test(wline()) && /FAIL WG-6/.test(wline()) && /llms\.txt is not in the built folder/.test(woutput()), `${item("L-B9").status} ${wline()}`);
    writeGateSite();
    writeSite({ noLlms: true });
    await run(["--check", pewp, "--only", "L-B9", ...CHK], WRITING_NARROW);
    check("llms.txt missing on the live site (404) makes L-B9 FAIL: FAIL WG-6 'live .../llms.txt answered 404'", item("L-B9").status === "FAIL" && /FAIL WG-6/.test(wline()) && /llms\.txt answered 404/.test(woutput()), `${item("L-B9").status} ${wline()}`);
    writeSite();
    writeGateSite({ noCoop: true });
    await run(["--check", pewp, "--only", "L-B9", ...CHK], WRITING_NARROW);
    check("COOP missing from the launch build's _headers makes L-B9 FAIL: FAIL WG-7 '_headers /* block has no Cross-Origin-Opener-Policy'", item("L-B9").status === "FAIL" && /FAIL WG-7/.test(wline()) && /_headers \/\* block has no Cross-Origin-Opener-Policy/.test(woutput()), `${item("L-B9").status} ${wline()}`);
    writeGateSite();
    writeSite({ noCoop: true });
    await run(["--check", pewp, "--only", "L-B9", ...CHK], WRITING_NARROW);
    check("COOP missing from the live responses makes L-B9 FAIL: FAIL WG-7 'live ... has no Cross-Origin-Opener-Policy header'", item("L-B9").status === "FAIL" && /FAIL WG-7/.test(wline()) && /has no Cross-Origin-Opener-Policy header/.test(woutput()), `${item("L-B9").status} ${wline()}`);
    writeSite();
    // a narrowed run on a good site never PASSes
    await run(["--check", pewp, "--only", "L-B9", ...CHK], WRITING_NARROW);
    check("a run narrowed by the test knob on a good site is NOT RUN, never PASS: L-B9 stays OPEN and the line says it is not a launch proof", item("L-B9").status === "OPEN" && /writing NOT RUN narrowed to .* not a launch proof/.test(wline()), `${item("L-B9").status} ${wline()}`);

    // ---- L-B8 asks for COOP on https pages (unit: the https case cannot be served here) ----
    const lib = await import(pathToFileURL(script).href);
    const fakeGet = (hdrs) => async (u) => ({ status: /robots\.txt$/.test(u) ? 404 : 200, headers: new Headers(hdrs), body: "<html><head><title>x</title></head><body></body></html>" });
    const fullHdr = { "x-content-type-options": "nosniff", "strict-transport-security": "max-age=1", "cross-origin-opener-policy": "same-origin" };
    const { "cross-origin-opener-policy": _drop, ...noCoopHdr } = fullHdr;
    const hOk = await lib.checkLiveHeaders({ config: { pages: ["https://fixture.test/"] } }, fakeGet(fullHdr));
    const hBad = await lib.checkLiveHeaders({ config: { pages: ["https://fixture.test/"] } }, fakeGet(noCoopHdr));
    const hHttp = await lib.checkLiveHeaders({ config: { pages: ["http://fixture.test/"] } }, fakeGet(noCoopHdr));
    check("live-headers (L-B8) on https requires Cross-Origin-Opener-Policy: PASS with it (the line says HSTS, COOP), FAIL without it naming the header; an http page is not asked for it", hOk.status === "PASS" && /nosniff, HSTS, COOP/.test(hOk.line) && hBad.status === "FAIL" && /has no Cross-Origin-Opener-Policy/.test(hBad.line) && hHttp.status === "PASS", `${hOk.line} | ${hBad.line} | ${hHttp.line}`);

    // ---- a ledger page that is not in the launch build: the writing check cannot PASS ----
    const pewp4 = path.join(tmp, "pewp4");
    await run(["--init", pewp4, "--site-url", base + "/", "--pages", `${base}/,${base}/nope/`, "--site-dir", gateSite]);
    await run(["--config", pewp4, "writing.viewports=390x844"]);
    await run(["--check", pewp4, "--only", "L-B9", ...CHK], WRITING_NARROW);
    const b9n = J(path.join(pewp4, "launch.json")).items.find((i) => i.id === "L-B9");
    check("a ledger page missing from the launch build: the writing check is NOT RUN (exit 2 of the gate), L-B9 stays OPEN, the page is named", b9n.status === "OPEN" && /writing NOT RUN exit 2/.test(b9n.results.writing?.line || "") && /\/nope\//.test(fs.readFileSync(path.join(pewp4, "launch", "writing", "output.txt"), "utf8")), JSON.stringify(b9n.results.writing));

    // ---- refused blocks and records ----
    const before = crypto.createHash("sha256").update(fs.readFileSync(path.join(pewp, "launch.json"))).digest("hex");
    const b1 = await run(["--block", pewp, "L-B8", "--reason", "too-hard", "--what", "x", "--unblocks", "y", "--by", "Agent"]);
    const b2 = await run(["--block", pewp, "L-B9", "--reason", "owner-proof", "--what", "x", "--unblocks", "y", "--by", "Agent"]);
    const b3 = await run(["--record", pewp, "L-B8", "--proof", "https://example.test/shot.png", "--by", "Agent"]);
    const b4 = await run(["--block", pewp, "L-A3", "--reason", "client-answer", "--what", "the lawyer has not answered", "--unblocks", "y", "--by", "Agent"]);
    const after = crypto.createHash("sha256").update(fs.readFileSync(path.join(pewp, "launch.json"))).digest("hex");
    check("a block with a reason outside the allowed list is refused (exit 2) and the ledger is unchanged", b1.code === 2 && /not allowed/.test(b1.se) && before === after, `${b1.code} ${b1.se}`);
    check("owner-proof is refused for an item with no OWNER-PROOF slot; --record is refused for a check-only item; client-answer without a Q-n is refused", b2.code === 2 && b3.code === 2 && /proven by its check only/.test(b3.se) && b4.code === 2 && /Q-n/.test(b4.se), `${b2.code} ${b2.se} | ${b3.code} ${b3.se} | ${b4.code} ${b4.se}`);

    // ---- drive the ledger to its stop condition ----
    await run(["--config", pewp, `commands.L-A1=node "${counter}"`]);
    const steps = [
      ["--record", pewp, "L-A2", "--proof", proofShot, "--by", "Test Owner"],
      ["--block", pewp, "L-A3", "--reason", "client-answer", "--what", "Q-9: who approves the privacy policy", "--unblocks", "the approver's name and written OK", "--by", "Agent"],
      ["--block", pewp, "L-A4", "--reason", "owner-proof", "--what", "written logo permissions", "--unblocks", "the owner files the partners' written OKs", "--by", "Agent"],
      ["--block", pewp, "L-A5", "--reason", "owner-access", "--what", "registrar-dns: delegate access not added yet", "--unblocks", "the client adds omnikom as DNS editor", "--by", "Agent"],
      ["--record", pewp, "L-B11", "--proof", "https://example.test/search-console-verified.png", "--by", "Test Owner"],
      ["--block", pewp, "L-B12", "--reason", "owner-proof", "--what", "Rich Results Test screenshots", "--unblocks", "the owner runs the test and sends the URL", "--by", "Agent"],
      ["--block", pewp, "L-B13", "--reason", "owner-access", "--what", "analytics: GA4 Editor not added", "--unblocks", "omnikom added as Editor", "--by", "Agent"],
    ];
    const bad = [];
    for (const s of steps) { const r = await run(s); if (r.code !== 0) bad.push(`${s.slice(0, 3).join(" ")}: exit ${r.code} ${r.se}`); }
    check("records and allowed blocks are accepted (exit 0 each)", !bad.length, bad.join(" | "));
    const d1 = await run(["--check", pewp, ...CHK]);
    const l3 = L();
    check("stop condition: every item PASS with its proof line or BLOCKED with an allowed reason -> --check exits 0, LEDGER DONE", d1.code === 0 && /LEDGER DONE/.test(d1.so) && l3.items.every((i) => (i.status === "PASS" && i.proofLine) || (i.status === "BLOCKED" && i.activeBlock?.unblocks)), `${d1.code}\n${d1.so.slice(-1500)}`);
    check("stop condition: L-A1 PASS by its command's own output line; L-A2 PASS by its recorded owner proof file", /command PASS .*0 open questions/.test(item("L-A1", l3).proofLine || "") && /^OWNER-PROOF .*crm-test-lead\.png \(by Test Owner/.test(item("L-A2", l3).proofLine || ""), `${item("L-A1", l3).proofLine} | ${item("L-A2", l3).proofLine}`);
    check("stop condition: C and D items are BLOCKED not-yet-due with their due date (launch + window)", l3.items.filter((i) => /^L-[CD]/.test(i.id)).every((i) => i.status === "BLOCKED" && i.activeBlock.reason === "not-yet-due" && /2026-1[12]-\d\d/.test(i.activeBlock.unblocks)), JSON.stringify(l3.items.filter((i) => /^L-[CD]/.test(i.id)).map((i) => [i.id, i.status, i.activeBlock])));

    // ---- what reopens the ledger ----
    await run(["--access-set", pewp, "registrar-dns=granted", "--by", "Test Owner"]);
    const o1 = await run(["--status", pewp, "--today", TODAY]);
    check("a granted access lifts its owner-access block: L-A5 is no longer BLOCKED and --status exits 3", o1.code === 3 && item("L-A5").status === "OPEN" && /registrar-dns is recorded as granted/.test(item("L-A5").needs.join(" ")), `${o1.code} ${JSON.stringify(item("L-A5"))}`);
    await run(["--access-set", pewp, "registrar-dns=pending", "--by", "Test Owner"]);
    const o2 = await run(["--status", pewp, "--today", TODAY]);
    check("access back to pending: the block holds again, exit 0", o2.code === 0, `${o2.code} ${o2.so.slice(-300)}`);
    const lj = L(); item("L-B8", lj).results["live-headers"].line = ""; fs.writeFileSync(path.join(pewp, "launch.json"), JSON.stringify(lj, null, 2));
    const o3 = await run(["--status", pewp, "--today", TODAY]);
    check("a hand-made PASS without the check's own output line is not accepted: L-B8 not PASS, exit 3", o3.code === 3 && item("L-B8").status !== "PASS" && /without its check's own output line/.test(item("L-B8").needs.join(" ")), `${o3.code} ${JSON.stringify(item("L-B8"))}`);
    await run(["--check", pewp, "--only", "L-B8", ...CHK]);
    fs.appendFileSync(proofShot, " edited");
    const o4 = await run(["--status", pewp, "--today", TODAY]);
    check("an owner-proof file changed after it was recorded reopens its item (exit 3)", o4.code === 3 && item("L-A2").status === "OPEN" && /changed after it was recorded/.test(item("L-A2").needs.join(" ")), `${o4.code} ${JSON.stringify(item("L-A2").needs)}`);
    fs.writeFileSync(proofShot, "png stand-in: the CRM record of the test lead");
    const o5 = await run(["--status", pewp, "--today", TODAY]);
    const o6 = await run(["--status", pewp, "--today", "2026-12-15"]);
    check("the proof file restored: exit 0 again; on 2026-12-15 the C and D items are due and the ledger is open again (exit 3)", o5.code === 0 && o6.code === 3 && item("L-C14").status === "OPEN", `${o5.code} ${o6.code} ${item("L-C14").status}`);

    // ---- PSI with a key (fake endpoint), and without one ----
    const pewp2 = path.join(tmp, "pewp2");
    await run(["--init", pewp2, "--site-url", base + "/", "--pages", `${base}/,${base}/about/`, "--site-dir", gateSite]);
    await run(["--config", pewp2, "writing.viewports=390x844"]);
    const h0 = psiHits.length;
    const k1 = await run(["--check", pewp2, "--only", "L-B9", "--gap-ms", "0", "--today", TODAY], { env: { PSI_API_KEY: KEY, PSI_API_BASE: psiBase } });
    const l4 = J(path.join(pewp2, "launch.json"));
    const req = psiHits.slice(h0);
    check("PSI with a key: 4 requests (2 pages x mobile/desktop), each asking for the 4 categories with the key; L-B9 PASS from the live path", req.length === 4 && req.every((h) => h.key === KEY && ["performance", "accessibility", "best-practices", "seo"].every((c) => h.cats.includes(c))) && l4.items.find((i) => i.id === "L-B9").status === "PASS" && /PageSpeed Insights v5 live/.test(l4.items.find((i) => i.id === "L-B9").proofLine), `${k1.code} ${req.length} ${k1.out}`);
    const psiKept = (fs.existsSync(path.join(pewp2, "launch", "psi")) ? fs.readdirSync(path.join(pewp2, "launch", "psi")) : []).filter((f) => f.endsWith(".json"));
    const psiKeptTxt = psiKept.map((f) => fs.readFileSync(path.join(pewp2, "launch", "psi", f), "utf8")).join("\n");
    check("the psi check keeps every raw answer under launch/psi (4 files: 2 pages x mobile/desktop) for the writing check, and the key is in none of them", psiKept.length === 4 && psiKept.every((f) => /^psi-(mobile|desktop)-/.test(f)) && psiKeptTxt.includes("lighthouseResult") && !psiKeptTxt.includes(KEY) && !psiKeptTxt.includes(encodeURIComponent(KEY)), psiKept.join(","));
    check("live path: L-B9 PASS carries both proof lines, 'psi PASS ... PageSpeed Insights v5 live' and the full 'writing PASS writing-gate 7 rules: 7 PASS'", /psi PASS 4\/4 runs/.test(l4.items.find((i) => i.id === "L-B9").proofLine || "") && /writing PASS writing-gate 7 rules: 7 PASS, 0 FAIL, 0 NOT RUN/.test(l4.items.find((i) => i.id === "L-B9").proofLine || ""), l4.items.find((i) => i.id === "L-B9").proofLine || JSON.stringify(l4.items.find((i) => i.id === "L-B9").results.writing));
    psiMode = "rb";
    await run(["--check", pewp2, "--only", "L-B9", "--gap-ms", "0", "--today", TODAY], { env: { PSI_API_KEY: KEY, PSI_API_BASE: psiBase, ...WRITING_NARROW.env } });
    const b9rb = J(path.join(pewp2, "launch.json")).items.find((i) => i.id === "L-B9");
    check("writing reads the answers the psi check saved: a render-blocking audit at 850 ms makes L-B9 FAIL on WG-1 (PageSpeed evidence contradicts) while the psi scores themselves pass", b9rb.status === "FAIL" && b9rb.results.psi.status === "PASS" && /FAIL WG-1/.test(b9rb.results.writing.line), JSON.stringify(b9rb.results.writing));
    psiMode = "bad";
    const k2 = await run(["--check", pewp2, "--only", "L-B9", "--gap-ms", "0", "--today", TODAY], { env: { PSI_API_KEY: KEY, PSI_API_BASE: psiBase, ...WRITING_NARROW.env } });
    psiMode = "good";
    const l5txt = fs.readFileSync(path.join(pewp2, "launch.json"), "utf8");
    const runsTxt = fs.readFileSync(path.join(pewp2, "runs", `${TODAY}-launch.md`), "utf8");
    check("PSI error from Google: L-B9 FAIL, the message scrubbed ([key removed]); the key is in no output, the ledger or the runs file", k2.code === 3 && /\[key removed\]/.test(l5txt) && ![k1.out, k2.out, l5txt, runsTxt].some((t) => t.includes(KEY) || t.includes(encodeURIComponent(KEY)) || t.includes("PSIKEY-launch") || t.includes("SECRET-7f3Q")), `${k2.code} ${k2.out.slice(0, 500)}`);
    const h1 = psiHits.length;
    const k3 = await run(["--check", pewp2, "--only", "L-B9", "--gap-ms", "0", "--today", TODAY], { env: { PSI_API_BASE: psiBase, ...WRITING_NARROW.env } });
    const b9 =J(path.join(pewp2, "launch.json")).items.find((i) => i.id === "L-B9");
    check("no key: L-B9 BLOCKED owner-access psi-key with what unblocks it, and no request is sent", psiHits.length === h1 && b9.status === "BLOCKED" && b9.activeBlock.reason === "owner-access" && b9.activeBlock.access === "psi-key" && /PSI_API_KEY/.test(b9.activeBlock.unblocks), `${k3.code} ${JSON.stringify(b9)}`);

    // ---- a fixture never proves a live site ----
    const pewp3 = path.join(tmp, "pewp3");
    await run(["--init", pewp3, "--site-url", "https://www.example.com/"]);
    const f1 = await run(["--check", pewp3, "--only", "L-B9", ...CHK]);
    check("--psi-fixture is refused for a live host (exit 2): a fixture never proves a live site", f1.code === 2 && /refused for a live host/.test(f1.se), `${f1.code} ${f1.out}`);

    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("no request left this machine (network guard log empty)", !net, net);
  } finally {
    for (const s of sockets) s.destroy();
    server.close(); psi.close();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
  return results;
}

// ---------------- mutants ----------------
const MUTANTS = [
  { name: "meta noindex not detected", patches: [{ file: "launch.mjs", from: `if (/^(robots|googlebot|bingbot)$/.test(n) && /\\b(noindex|none)\\b/i.test(attr(tag, "content") || "")) return`, to: "if (false) return" }], expect: [/^noindex \(meta\) on the fixture/] },
  { name: "redirect status and target not checked", patches: [{ file: "launch.mjs", from: "if (res.status !== 301 || got !== want) bad.push(", to: "if (res.status === 0) bad.push(" }], expect: [/^a missing redirect makes L-A6 FAIL/, /^a 302 where a 301/] },
  { name: "the ledger always exits 0", patches: [{ file: "launch.mjs", from: "return s.done ? 0 : 3;", to: "return 0;" }], expect: [/^--status on a fresh ledger: exit 3/, /^noindex \(meta\)/, /^a granted access lifts/] },
  { name: "any block reason accepted", patches: [{ file: "launch.mjs", from: "if (!ALLOWED_MANUAL.includes(reason)) throw", to: "if (false) throw" }, { file: "launch.mjs", from: "default: return `reason ${b.reason} is not allowed", to: "default: return null; `" }], expect: [/^a block with a reason outside the allowed list is refused/] },
  { name: "a granted access does not lift the block", patches: [{ file: "launch.mjs", from: `if (st === "granted" || st === "na") return`, to: "if (false) return" }], expect: [/^a granted access lifts its owner-access block/] },
  { name: "PASS accepted without the check's output line", patches: [{ file: "launch.mjs", from: "const unproven = res.filter(", to: "const unproven = [].filter(" }], expect: [/^a hand-made PASS without the check's own output line/] },
  { name: "the gate is not run strict", patches: [{ file: "launch.mjs", from: `l.pewp, g.siteDir, "--strict", "--out", out]`, to: `l.pewp, g.siteDir, "--out", out]` }], expect: [/^strict gate: on an unapproved plan/] },
  { name: "the PSI key is not scrubbed", patches: [{ file: "launch.mjs", from: `if (key) for (const k of new Set([key, encodeURIComponent(key)])) t = t.split(k).join("[key removed]");`, to: "" }], expect: [/^PSI error from Google/] },
  { name: "the owner-proof file is not re-hashed", patches: [{ file: "launch.mjs", from: "if (sha256(fs.readFileSync(o.value)) !== o.sha256) return", to: "if (false) return" }], expect: [/^an owner-proof file changed after it was recorded/] },
  { name: "a PSI fixture accepted for a live host", patches: [{ file: "launch.mjs", from: "if (live.length) throw new Usage(", to: "if (false) throw new Usage(" }], expect: [/^--psi-fixture is refused for a live host/] },
  { name: "no key does not block", patches: [{ file: "launch.mjs", from: `if (!key) return { status: "BLOCKED"`, to: `if (false) return { status: "BLOCKED"` }], expect: [/^no key: L-B9 BLOCKED owner-access psi-key/] },
  { name: "COOP not required on https pages (L-B8)", patches: [{ file: "launch.mjs", from: `if (p.startsWith("https:") && !r.headers.get("cross-origin-opener-policy"))`, to: "if (false)" }], expect: [/^live-headers \(L-B8\) on https requires Cross-Origin-Opener-Policy/] },
  { name: "the writing check is not run (SKIP)", patches: [{ file: "launch.mjs", from: `c === "writing" ? checkWriting(l)`, to: `c === "writing" ? { status: "SKIP", line: "writing NOT RUN" }` }], expect: [/^llms\.txt missing from the launch build/, /^COOP missing from the launch build/, /^clean site: L-B9 also carries the writing proof line/] },
  { name: "the writing check ignores the gate's exit code", patches: [{ file: "launch.mjs", from: "if (r.status === 0) return narrow ?", to: "if (true) return narrow ?" }], expect: [/^llms\.txt missing from the launch build/, /^COOP missing from the live responses/] },
  { name: "the writing check is not given the PSI answers", patches: [{ file: "launch.mjs", from: `args.push("--psi-dir", psiDir);`, to: "void 0;" }], expect: [/^writing reads the answers the psi check saved/] },
  { name: "the psi answers are not kept", patches: [{ file: "launch.mjs", from: "=> fs.writeFileSync(path.join(psiDir, ", to: "=> void (path.join(psiDir, " }], expect: [/^the psi check keeps every raw answer/, /^writing reads the answers the psi check saved/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-launch.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  const main = await scenarios(scriptsDir);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  let failed = main.filter((r) => !r.ok).length;
  console.log(failed ? `LAUNCH TEST FAIL: ${failed} of ${main.length}` : `LAUNCH TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    let caught = 0, ran = 0;
    for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-launch-mutant-"));
      for (const d of ["scripts", "rules", "schemas"]) { const src = path.join(scriptsDir, "..", d); if (fs.existsSync(src)) fs.cpSync(src, path.join(mdir, d), { recursive: true }); }
      const sdir = path.join(mdir, "scripts");
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
  process.exit(failed ? 1 : 0);
}
