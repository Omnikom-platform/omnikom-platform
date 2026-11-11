// Usage: node test-crux.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of crux.mjs: real-visitor speed from the Chrome UX Report API (field data, p75 of LCP, INP, CLS, FCP, TTFB), for the page and for its origin,
// on phones and desktops. "Data not found" (HTTP 404 NOT_FOUND) is a valid result, NO DATA, never a failure. Key: $CRUX_API_KEY by name only.
// No network: a local server answers in the documented v1 shape (a minimal fixture written from the documented fields; CRUX_API_BASE is the test hook).
// The live Google endpoint is UNPROVEN here: nothing in this test talks to it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { serve, runner, walk, J, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const KEY = "CRUXKEY-SECRET-abc123";   // gitleaks:allow (a made-up test key)
const GAP = 300;
const SITE = (p = "/") => `https://example-crux-test.test${p}`;
const pewpOf = (cwd) => path.join(cwd, "site-checks", "example-crux-test.test", ".pewp");

const bins = (g, ni, p) => [{ start: 0, end: 2500, density: g }, { start: 2500, end: 4000, density: ni }, { start: 4000, density: p }];
const record = (key, ff) => ({
  record: {
    key: { ...key, formFactor: ff },
    metrics: {
      largest_contentful_paint: { histogram: bins(0.78, 0.15, 0.07), percentiles: { p75: ff === "PHONE" ? 2750 : 1500 } },
      interaction_to_next_paint: { histogram: bins(0.9, 0.06, 0.04), percentiles: { p75: 180 } },
      cumulative_layout_shift: { histogram: bins(0.85, 0.1, 0.05), percentiles: { p75: "0.05" } },   // CLS p75 comes as a string
      first_contentful_paint: { histogram: bins(0.7, 0.2, 0.1), percentiles: { p75: 1800 } },
      experimental_time_to_first_byte: { histogram: bins(0.6, 0.3, 0.1), percentiles: { p75: 900 } },
    },
    collectionPeriod: { firstDate: { year: 2026, month: 9, day: 28 }, lastDate: { year: 2026, month: 10, day: 25 } },
  },
});
const notFound = { error: { code: 404, message: "chrome ux report data not found", status: "NOT_FOUND" } };

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("crux"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog, ["CRUX_API_KEY", "CRUX_API_BASE", "CRUX_TIMEOUT_MS"]);
  const mode = { origin: "data", url: "data", fail: null };
  const srv = await serve((r) => {
    const u = new URL(r.url, "http://x");
    if (u.pathname !== "/v1/records:queryRecord") return { status: 404, body: "wrong path" };
    if (r.method !== "POST") return { status: 405, body: {} };
    if (u.searchParams.get("key") !== KEY) return { status: 400, body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } } };
    let b = {}; try { b = JSON.parse(r.body); } catch {}
    const which = b.origin ? "origin" : "url";
    if (mode.fail === "disabled") return { status: 403, body: { error: { code: 403, message: "Chrome UX Report API has not been used in project 1 before or it is disabled.", status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } } };
    if (mode.fail === "429") return { status: 429, body: { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } } };
    if (mode.fail === "500") return { status: 500, body: { error: { code: 500, message: "Internal error", status: "INTERNAL" } } };
    if (mode.fail === "hang") return { hang: true };
    if (mode[which] === "none") return { status: 404, body: notFound };
    return { body: record(b.origin ? { origin: b.origin } : { url: b.url }, b.formFactor) };
  });
  const env = { CRUX_API_BASE: srv.url, CRUX_API_KEY: KEY };
  const fresh = (n) => { const d = path.join(tmp, n); fs.mkdirSync(d); return d; };
  const go = (cwd, extra = [], e = env, opts = {}) => run("crux.mjs", [SITE("/page"), "--cwd", cwd, "--today", "2026-10-26", "--gap-ms", String(GAP), ...extra], { env: e, ...opts });
  const file = (cwd) => path.join(pewpOf(cwd), "crux", "2026-10-26.json");
  const rowsOf = (cwd) => (fs.existsSync(file(cwd)) ? J(file(cwd)) : { rows: [], failures: [] }); // a mutated script that wrote nothing must fail an assertion, not crash the scenarios
  try {
    // 1. no key
    const c1 = fresh("nokey"), h1 = srv.reqs.length;
    const r1 = await run("crux.mjs", [SITE("/page"), "--cwd", c1, "--today", "2026-10-26"], { env: {} });
    check("crux: no key: BLOCKED, exit 3, last line 'BLOCKED: <what> | unblocks: <what would>' naming CRUX_API_KEY and the Chrome UX Report API; no request, nothing written", r1.code === 3 && /^BLOCKED: .*CRUX_API_KEY.* \| unblocks: .*Chrome UX Report API/m.test(r1.so) && srv.reqs.length === h1 && !fs.existsSync(path.join(c1, "site-checks")), `exit ${r1.code} ${r1.out} ${walk(c1).join(",")}`);

    // 2. data for the page and the origin, phone and desktop
    const c2 = fresh("data"), h2 = srv.reqs.length;
    const r2 = await go(c2);
    const mine = srv.reqs.slice(h2), doc = fs.existsSync(file(c2)) ? J(file(c2)) : { rows: [] };
    const bodies = mine.map((q) => { try { return JSON.parse(q.body); } catch { return {}; } });
    check("crux: exit 0 and <pewp>/crux/<--today>.json is written", r2.code === 0 && fs.existsSync(file(c2)), `exit ${r2.code} ${r2.out}`);
    check("crux: 4 requests (page and origin, PHONE and DESKTOP): POST /v1/records:queryRecord?key=, JSON body with url or origin and formFactor", mine.length === 4 && mine.every((q) => q.method === "POST" && new URL(q.url, "http://x").searchParams.get("key") === KEY) && bodies.filter((b) => b.url === SITE("/page")).map((b) => b.formFactor).join() === "PHONE,DESKTOP" && bodies.filter((b) => b.origin === "https://example-crux-test.test").map((b) => b.formFactor).join() === "PHONE,DESKTOP", JSON.stringify(bodies));
    const pu = doc.rows.find((x) => x.scope === "url" && x.formFactor === "PHONE") || {};
    check("crux: a row carries scope, target, formFactor, status 'data', fetchedAt and its cache file (which exists)", doc.rows.length === 4 && pu.status === "data" && pu.target === SITE("/page") && !!pu.fetchedAt && !!pu.cacheFile && fs.existsSync(path.join(pewpOf(c2), pu.cacheFile)), JSON.stringify(doc).slice(0, 500));
    check("crux: p75 values are numbers (LCP 2750 ms, INP 180 ms, CLS 0.05 although the API sends it as a string, FCP 1800 ms, TTFB 900 ms)", pu.metrics?.lcp?.p75 === 2750 && pu.metrics.inp?.p75 === 180 && pu.metrics.cls?.p75 === 0.05 && pu.metrics.fcp?.p75 === 1800 && pu.metrics.ttfb?.p75 === 900, JSON.stringify(pu.metrics));
    check("crux: the good / needs improvement / poor shares are kept (LCP 0.78, 0.15, 0.07)", pu.metrics?.lcp?.good === 0.78 && pu.metrics.lcp.needsImprovement === 0.15 && pu.metrics.lcp.poor === 0.07, JSON.stringify(pu.metrics?.lcp));
    check("crux: the collection period is a date range (2026-09-28 to 2026-10-25)", pu.collectionPeriod?.first === "2026-09-28" && pu.collectionPeriod?.last === "2026-10-25", JSON.stringify(pu.collectionPeriod));
    check('crux: one line per row: "crux url PHONE <address>: LCP p75 2750 ms, INP 180 ms, CLS 0.05"', r2.so.includes(`crux url PHONE ${SITE("/page")}: LCP p75 2750 ms, INP 180 ms, CLS 0.05`) && /crux origin DESKTOP https:\/\/example-crux-test\.test: LCP p75 1500 ms/.test(r2.so), r2.so);
    const gaps = mine.slice(1).map((q, i) => q.t - mine[i].t);
    check(`crux: pacing: every request is at least the gap (${GAP} ms) after the previous one, on the server's clock`, gaps.length === 3 && gaps.every((g) => g >= GAP * 0.9), `gaps ${gaps.join(", ")}`);
    const files = walk(c2).map((f) => [f, fs.readFileSync(f, "utf8")]);
    check("crux: the key is in no file under the working folder (cache stores key=REDACTED) and not in stdout or stderr", !files.some(([, t]) => t.includes(KEY)) && walk(path.join(pewpOf(c2), "cache", "crux")).length === 4 && !r2.out.includes(KEY), files.filter(([, t]) => t.includes(KEY)).map(([f]) => f).join(", "));
    const h3 = srv.reqs.length;
    const r3 = await go(c2);
    check("crux: the same run again the same day is answered from the cache (no request)", r3.code === 0 && srv.reqs.length === h3 && rowsOf(c2).rows.length === 4, `exit ${r3.code} ${srv.reqs.length - h3} requests ${r3.out}`);

    // 3. NO DATA is a result
    mode.url = "none"; const c4 = fresh("pagenone");
    const r4 = await go(c4); const d4 = rowsOf(c4);
    const un = d4.rows.filter((x) => x.scope === "url"), og = d4.rows.filter((x) => x.scope === "origin");
    check("crux: the page has no field data but the origin has: the page rows say 'no data' (HTTP 404 NOT_FOUND), the origin rows have numbers, exit 0, nothing failed", r4.code === 0 && un.length === 2 && un.every((x) => x.status === "no data" && x.metrics == null) && og.every((x) => x.status === "data") && (d4.failures || []).length === 0, `exit ${r4.code} ${JSON.stringify(d4).slice(0, 400)}`);
    mode.origin = "none"; const c5 = fresh("allnone");
    const r5 = await go(c5); const d5 = rowsOf(c5); const last5 = r5.so.trim().split("\n").pop();
    check("crux: NO DATA anywhere is still exit 0 with the file written, and the last line says NO DATA for the page and its origin (a result, not a failure)", r5.code === 0 && d5.rows.length === 4 && d5.rows.every((x) => x.status === "no data") && /^NO DATA: .*example-crux-test\.test/.test(last5), `exit ${r5.code} last: ${last5}`);
    mode.url = "data"; mode.origin = "data";

    // 4. refusals and failures
    mode.fail = "disabled"; const c6 = fresh("disabled"), h6 = srv.reqs.length;
    const r6 = await go(c6);
    check("crux: HTTP 403 SERVICE_DISABLED is BLOCKED (exit 3, last line says to enable the Chrome UX Report API), the run stops after the first request", r6.code === 3 && /^BLOCKED: .* \| unblocks: .*enable the Chrome UX Report API/m.test(r6.so) && srv.reqs.length - h6 === 1, `exit ${r6.code} ${srv.reqs.length - h6} requests ${r6.out}`);
    mode.fail = null;
    const c7 = fresh("badkey");
    const r7 = await go(c7, [], { ...env, CRUX_API_KEY: "wrong-key" });
    check("crux: an invalid key (HTTP 400 API_KEY_INVALID) is BLOCKED (exit 3), and the wrong key is not printed", r7.code === 3 && /^BLOCKED: /m.test(r7.so) && /CRUX_API_KEY/.test(r7.so) && !r7.out.includes("wrong-key"), `exit ${r7.code} ${r7.out}`);
    mode.fail = "429"; const c8 = fresh("quota"), h8 = srv.reqs.length;
    const r8 = await go(c8);
    check("crux: HTTP 429 stops the run at once: BLOCKED (exit 3, quota), one request only", r8.code === 3 && /^BLOCKED: .*quota/im.test(r8.so) && srv.reqs.length - h8 === 1, `exit ${r8.code} ${srv.reqs.length - h8} requests ${r8.out}`);
    mode.fail = "500"; const c9 = fresh("fail500"), h9 = srv.reqs.length;
    const r9 = await go(c9);
    check("crux: every request failing (HTTP 500) is exit 1, all four tried, nothing written", r9.code === 1 && srv.reqs.length - h9 === 4 && !fs.existsSync(file(c9)) && /every request failed/.test(r9.out), `exit ${r9.code} ${srv.reqs.length - h9} requests ${r9.out}`);
    mode.fail = "hang"; const c10 = fresh("hang"), t10 = Date.now();
    const r10 = await go(c10, ["--gap-ms", "0"], { ...env, CRUX_TIMEOUT_MS: "500" }, { timeout: 30000 });
    check("crux: a server that never answers is cut off (bounded), the requests are failures, exit 1", r10.code === 1 && Date.now() - t10 < 20000 && /no answer within/.test(r10.out), `exit ${r10.code} after ${Date.now() - t10} ms ${r10.out}`);
    mode.fail = null;

    // 5. key by --dotenv, and usage errors
    const envFile = path.join(tmp, "crux.env"); fs.writeFileSync(envFile, `CRUX_API_KEY=${KEY}\n`);
    const c11 = fresh("dotenv"), h11 = srv.reqs.length;
    const r11 = await go(c11, ["--dotenv", envFile, "--form-factor", "PHONE"], { CRUX_API_BASE: srv.url });
    check("crux: the key can come from --dotenv; --form-factor PHONE asks for phones only (2 requests)", r11.code === 0 && srv.reqs.length - h11 === 2, `exit ${r11.code} ${srv.reqs.length - h11} requests ${r11.out}`);
    const h12 = srv.reqs.length, bad = [];
    for (const [label, argv, re] of [["--help", ["--help"], null], ["not an address", ["example.com"], /not an http/], ["bad --today", [SITE(), "--today", "yesterday"], /--today/], ["bad --form-factor", [SITE(), "--form-factor", "TABLET"], /--form-factor/], ["gap not a number", [SITE(), "--gap-ms", "abc"], /--gap-ms/]]) {
      const r = await run("crux.mjs", argv, { env });
      const ok = label === "--help" ? r.code === 0 && /usage/i.test(r.so) : r.code === 2 && re.test(r.se);
      if (!ok) bad.push(`${label}: exit ${r.code} ${r.out}`.slice(0, 200));
    }
    const r13 = await run("crux.mjs", [SITE(), "--gap-ms", "10"], { env: { CRUX_API_KEY: KEY } });
    check("crux: usage: --help prints the usage (exit 0); a bad address, date, form factor or gap is exit 2; nothing fetched", !bad.length && srv.reqs.length === h12, `${bad.join(" | ")}; ${srv.reqs.length - h12} requests`);
    check("crux: to the real Google address a gap below 1000 ms is refused (exit 2, polite minimum)", r13.code === 2 && /polite minimum/.test(r13.se), `exit ${r13.code} ${r13.out}`);
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("crux: nothing in this suite left the machine (network guard log empty)", !net, net);
  } finally { srv.close(); rmTmp(tmp); }
  return results;
}

const CX = "crux.mjs";
const MUTANTS = [
  { name: "no key does not block", patches: [{ file: CX, from: "if (!key) throw new Blocked(UNBLOCK);", to: "" }], expect: [/^crux: no key: BLOCKED/] },
  { name: "NO DATA (404) counts as a failure", patches: [{ file: CX, from: "if (res.status === 404) {", to: "if (false) {" }], expect: [/^crux: the page has no field data but the origin has/, /^crux: NO DATA anywhere/] },
  { name: "the CLS string is not turned into a number", patches: [{ file: CX, from: "const p75 = Number(x.percentiles?.p75);", to: "const p75 = x.percentiles?.p75;" }], expect: [/^crux: p75 values are numbers/] },
  { name: "the good/poor shares are dropped", patches: [{ file: CX, from: "good: dens[0] ?? null,", to: "good: null," }], expect: [/^crux: the good \/ needs improvement/] },
  { name: "the origin is not asked", patches: [{ file: CX, from: "const scopes = [\"url\", \"origin\"];", to: "const scopes = [\"url\"];" }], expect: [/^crux: 4 requests/] },
  { name: "pacing removed", patches: [{ file: CX, from: "if (wait > 0) await sleep(wait);", to: "" }], expect: [/^crux: pacing/] },
  { name: "a disabled API does not block", patches: [{ file: CX, from: "if (res.status === 403) throw new Blocked(", to: "if (false) throw new Blocked(" }], expect: [/^crux: HTTP 403 SERVICE_DISABLED is BLOCKED/] },
  { name: "429 does not stop the run", patches: [{ file: CX, from: "if (res.status === 429) throw new Blocked(", to: "if (false) throw new Blocked(" }], expect: [/^crux: HTTP 429 stops the run/] },
  { name: "the key is stored in the cache (redaction gone)", patches: [{ file: "cache.mjs", from: "const shownUrl = url.replace(/([?&](key|api_key|apikey|token|access_token)=)[^&]+/gi, \"$1REDACTED\");", to: "const shownUrl = url;" }], expect: [/^crux: the key is in no file/] },
  { name: "the request is not bounded", patches: [{ file: CX, from: "{ maxAgeDays: 1, timeoutMs, init }", to: "{ maxAgeDays: 1, timeoutMs: 1e9, init }" }], expect: [/^crux: a server that never answers/] },
  { name: "the cache is not used", patches: [{ file: CX, from: "{ maxAgeDays: 1, timeoutMs, init }", to: "{ maxAgeDays: 0, timeoutMs, init }" }], expect: [/^crux: the same run again the same day/] },
  { name: "the polite minimum gap is not enforced", patches: [{ file: CX, from: "politeMs(\"--gap-ms\", numArg(", to: "((n, v) => v)(\"--gap-ms\", numArg(" }], expect: [/^crux: to the real Google address/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-crux.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "CRUX", scenarios, MUTANTS, scriptsDir, argv: A }));
}
