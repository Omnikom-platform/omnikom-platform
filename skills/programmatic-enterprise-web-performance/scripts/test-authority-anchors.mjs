// Usage: node test-authority-anchors.mjs [--scripts <dir>] [--quiet] [--mutants [--only <id>] [--jobs N]]
// Self-test of authority-anchors.mjs on FIXTURES ONLY: a local server plays data.commoncrawl.org (the crawl list, cluster.idx with HEAD and
// download, gzip CDX blocks by byte range, and WARC records by byte range, each its own gzip member as in a real crawl file), and a network
// guard refuses any non-local request. The stop file (lib-stops.mjs, engine commoncrawl) lives in a temp folder (OMNIKOM_STOPS_DIR), never in ~/.claude/state.
// --mutants: watched-fail. Copies the skill, breaks one rule at a time, runs this test on the copy and requires the named check to go red
//   (a mutant that stays green means the check measures nothing, or the patch never applied). Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const F = "authority-anchors.mjs";
  const MUT = [
    { id: "rel-ignored", from: 'const type = rel.includes("sponsored") ? "sponsored" : rel.includes("ugc") ? "ugc" : rel.includes("nofollow") || pageNofollow ? "nofollow" : "follow";', to: 'const type = "follow";', red: "extract: link types" },
    { id: "page-nofollow-ignored", from: 'rel.includes("nofollow") || pageNofollow ? "nofollow"', to: 'rel.includes("nofollow") ? "nofollow"', red: "extract: a page-level nofollow" },
    { id: "image-alt-dropped", from: 'if (!text && img) { image = true; text = (attrOf(img[0], "alt") || "").trim().slice(0, 160); }', to: 'if (!text && img) { image = false; text = ""; }', red: "extract: image link" },
    { id: "footer-not-seen", from: 'stack.includes("footer") ? "footer"', to: 'false ? "footer"', red: "extract: placement" },
    { id: "lookalike-host-counted", from: "targets.find((t) => hostIs(h, t))", to: "targets.find((t) => h.includes(t))", red: "extract: look-alike hosts" },
    { id: "keyword-exact-off", from: 'if (kws.includes(n)) return "exact";', to: "", red: "classify" },
    { id: "chunked-not-decoded", from: "if (/^transfer-encoding:\\s*chunked/im.test(head)) body = dechunk(body);", to: "", red: "warc: a chunked body" },
    { id: "span-end-ignored", from: "i1 = Math.max(i0, lastBelow(`${s}-`))", to: "i1 = i0", red: "index: block span" },
    { id: "block-cap-off", from: "if (n <= cap) return Array.from", to: "if (true) return Array.from", red: "block cap" },
    { id: "status-filter-off", from: 'if (!j || !j.url || String(j.status) !== "200" || !/html/i.test(j.mime || j["mime-detected"] || "")) continue;', to: "if (!j || !j.url) continue;", red: "blocks: only HTML 200" },
    { id: "budget-off", from: "if (stats.requests >= maxRequests) throw", to: "if (false) throw", red: "budget" },
    { id: "stop-on-503-off", from: "res.status === 429 || res.status === 503 || res.status === 403", to: "false", red: "stop:" },
    { id: "dropped-not-stopping", from: "catch (e) { throw dropped(url, e); }\n    await limited(res, url);\n    if (range", to: 'catch (e) { return { status: 0, error: "x" }; }\n    await limited(res, url);\n    if (range', red: "stop: a dropped connection" },
    { id: "stop-file-not-written", from: 'if (stop && stop.kind !== "budget") writeStop(', to: "if (false) writeStop(", red: "stop file" },
    { id: "stop-file-ignored", from: "if (inForce) {", to: "if (false) {", red: "stop file" },
    { id: "cache-off", from: "if (fs.existsSync(file) && fs.statSync(file).size > 0) {", to: "if (false) {", red: "cache" },
    { id: "coverage-claims-no-link", from: "; the rest: not found in the pages sampled", to: "; the rest: no link", red: "coverage line" },
    { id: "sampled-not-said", from: "(sampled ${blocksSampled} of ${blocksTotal} index blocks)", to: "", red: "coverage line" },
    { id: "brand-tier-skipped", from: "const tiers = [brandRe && {", to: "const tiers = [false && {", red: "tier order" },
    { id: "stop-when-found-off", from: 'if (tier.name !== "brand-in-url" && cands.every((c) => found.has(c))) break;', to: "", red: "tier order" },
    { id: "denylist-off", from: "if (denied(d)) {", to: "if (false) {", red: "denylist" },
    { id: "filename-check-off", from: "okFile(x.filename) &&", to: "true &&", red: "filename guard" },
    { id: "shard-check-off", from: "if (!okShard(b.file) || !(b.len > 0)) continue;", to: "if (!(b.len > 0)) continue;", red: "shard guard" },
    { id: "index-failure-not-stopping", from: "if (++indexFails >= INDEX_FAILS_STOP) throw", to: "if (++indexFails >= 1e9) throw", red: "index failure" },
    { id: "index-error-called-empty", from: '(rec.indexErrors ? "index-error" : "no-pages-sampled")', to: '"no-pages-sampled"', red: "index failure" },
    { id: "range-not-checked", from: "if (range && res.status !== 206) {", to: "if (false) {", red: "range" },
    { id: "disk-check-off", from: "if (free < need) {", to: "if (false) {", red: "disk floor" },
    { id: "gap-polite-off", from: 'gapMs = politeMs("--gap-ms", numArg("--gap-ms", gapMs, { def: MIN_GAP_MS, min: 0 }), [dataBase()], MIN_GAP_MS);', to: 'gapMs = numArg("--gap-ms", gapMs, { def: MIN_GAP_MS, min: 0 });', red: "usage: gap" },
    { id: "hard-cap-off", from: "if (maxRequests > HARD_CAP) throw new UsageError(", to: "if (false) throw new UsageError(", red: "usage: hard cap" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mut-anch-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", F), src = fs.readFileSync(f, "utf8");
    if (!src.includes(m.from)) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text not found in ${F})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, [path.join(copy, "scripts", "test-authority-anchors.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 300000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (check measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected check"} | expected "${m.red}" | failed: ${failed.slice(0, 4).join(" ; ") || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  const jobs = args.includes("--jobs") ? Math.max(1, parseInt(args[args.indexOf("--jobs") + 1], 10) || 1) : 4;
  await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${only ? 1 : MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- the network guard (installed before anything is imported)
const guardLog = [];
const isLocalHost = (h) => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(h);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const url = typeof input === "string" ? input : input?.url ?? String(input); let h = ""; try { h = new URL(url).hostname; } catch {} if (!isLocalHost(h)) { guardLog.push(url); return Promise.reject(new Error("NETWORK GUARD: refused non-local request " + url)); } return realFetch(input, init); };
process.env.PEWP_TEST_GAP_MS = "0";

// ---------------------------------------------------------------- harness
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-anchors-"));
process.env.OMNIKOM_STOPS_DIR = path.join(tmp, "state"); // the 24 h stop file of every in-process run lands here, never in ~/.claude/state
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 500)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 500)}`); };
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s, null, 1)); return p; };
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const spawnP = (cmd, a, opts) => new Promise((res) => { const p = spawn(cmd, a, { ...opts, stdio: ["ignore", "pipe", "pipe"] }); let o = "", e = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (e += d)); const t = setTimeout(() => p.kill(), 60000); p.on("close", (code) => { clearTimeout(t); res({ code, out: o, err: e }); }); });
const stopFile = () => path.join(process.env.OMNIKOM_STOPS_DIR, "commoncrawl.json");
const clearStop = () => fs.rmSync(stopFile(), { force: true });

// ---------------------------------------------------------------- fixture: Common Crawl (data host only)
const CRAWL = "CC-MAIN-2026-40", WARC = `crawl-data/${CRAWL}/segments/1/warc/warc-seg-1.warc.gz`;
const WARC_HEAD = (url) => `WARC/1.0\r\nWARC-Type: response\r\nWARC-Target-URI: ${url}\r\n\r\n`;
const record = (url, html, { chunked = false } = {}) => {
  let body = Buffer.from(html, "utf8");
  if (chunked) { const a = body.subarray(0, 40), b = body.subarray(40); body = Buffer.concat([Buffer.from(`${a.length.toString(16)}\r\n`), a, Buffer.from(`\r\n${b.length.toString(16)}\r\n`), b, Buffer.from("\r\n0\r\n\r\n")]); }
  return zlib.gzipSync(Buffer.concat([Buffer.from(WARC_HEAD(url) + `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n${chunked ? "Transfer-Encoding: chunked\r\n" : ""}\r\n`), body]));
};
const R1_PAGE = `<!doctype html><html><head><title>Kapitus review</title></head><body><header><nav><a href="https://www.kapitus.com/">Kapitus</a></nav></header>
<main><p>We looked at <a href="https://www.kapitus.com/loans" rel="nofollow">Kapitus small business loans</a> and <a href="https://lendio.com/">Lendio</a>, also <a href="https://kapitus.com/x">Small Business Loans</a>.</p>
<a href="https://kapitus.com/"><img src="/k.png" alt="Kapitus logo"></a> <a href="https://other.example/page">Other site</a> <a href="https://xkapitus.com/">fake</a> <a href="https://kapitus.com.evil.example/">fake2</a> <a href="mailto:a@kapitus.com">mail</a></main>
<footer><a href="https://kapitus.com/y" rel="sponsored noopener">click here</a></footer></body></html>`;
const R2_PAGE = `<!doctype html><html><head><meta name="robots" content="index, nofollow"><title>Best lenders</title></head><body><p>See <a href="http://kapitus.com">kapitus.com</a> for terms.</p></body></html>`;
const R4_HOME = `<!doctype html><html><body><p>Home page, <a href="https://other.example/">other</a>.</p></body></html>`;
const GAP_PAGE = `<!doctype html><html><body><p>A long enough chunked page so the body splits, with <a href="https://lendio.com/apply">Lendio review</a> inside it.</p></body></html>`;
const TOP_PAGE = `<!doctype html><html><body><p>Top lenders: <a href="https://kapitus.com/top">Kapitus</a> and <a href="https://lendio.com/top">Lendio</a>.</p></body></html>`;
const BIG_PAGE = `<!doctype html><html><body><p>Review of <a href="https://kapitus.com/big">Kapitus</a>.</p></body></html>`;
const PARTS = []; let blobLen = 0;
const RECS = []; // index records: { url, ...json fields }
const addPage = (url, html, opts = {}, extra = {}) => { const gz = record(url, html, opts); const r = { url, mime: "text/html", "mime-detected": "text/html", status: "200", digest: "D", length: String(gz.length), offset: String(blobLen), filename: WARC, ...extra }; PARTS.push(gz); blobLen += gz.length; RECS.push(r); return r; };
const addMeta = (url, extra) => RECS.push({ url, mime: "text/html", "mime-detected": "text/html", status: "200", digest: "D", length: "100", offset: "0", filename: WARC, ...extra }); // a record whose WARC is never read
addPage("https://www.r1.example/reviews/kapitus", R1_PAGE);                 // offset 0: the first record of the WARC file
addPage("https://r1.example/top-lenders", TOP_PAGE);                         // a topic page that would also match: read only if the brand page had not found both targets
addMeta("https://r1.example/", {});                                          // r1 home
addMeta("https://r1.example/kapitus-gone", { status: "404" });               // brand in the URL but not a 200: never read
addMeta("https://r1.example/kapitus-logo.png", { mime: "image/png", "mime-detected": "image/png" });
addPage("https://r2.example/best-lenders", R2_PAGE);
addMeta("https://r2.example/kapitus-gone", { status: "404" });
addMeta("https://r2.example/kapitus-logo.png", { mime: "image/png", "mime-detected": "image/png" });
addPage("https://r4.example/", R4_HOME);
addPage("https://gap.example/lendio-review", GAP_PAGE, { chunked: true });
addPage("https://r6.example/kapitus-page", R4_HOME);                         // served by a server that ignores Range
addMeta("https://r5.example/kapitus", { filename: "http://127.0.0.1:1/crawl-data/x.warc.gz" });
addMeta("https://r5.example/kapitus2", { filename: "crawl-data/../../etc/x.warc.gz" });
addMeta("https://aaa.example/", {}); addMeta("https://aaa.example/x", {}); addMeta("https://zzz.example/", {}); addMeta("https://zzz.example/y", {}); addMeta("https://example.org/", {}); // other domains around them
addMeta("https://lookalike.example/kapitus", {}); addMeta("https://r1x.example/kapitus", {}); // "example,r1x)" must not be read as r1.example
addPage("https://big.example/", R4_HOME);
for (let i = 0; i < 30; i++) addMeta(`https://big.example/p${String(i).padStart(2, "0")}`, {});
addPage("https://big.example/p15a-kapitus", BIG_PAGE);                       // the brand page, deep in the domain's blocks
const surtKey = (u) => { const x = new URL(u); return x.hostname.replace(/^www\./, "").split(".").reverse().join(",") + ")" + x.pathname + x.search; };
const sorted = RECS.map((r) => ({ key: surtKey(r.url), r })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const BLOCK_LINES = 3, SHARD_PARTS = [], CLUSTER_BLOCKS = []; let shardLen = 0;
for (let i = 0; i < sorted.length; i += BLOCK_LINES) {
  const grp = sorted.slice(i, i + BLOCK_LINES), gz = zlib.gzipSync(Buffer.from(grp.map((g) => `${g.key} 20261010000000 ${JSON.stringify(g.r)}`).join("\n") + "\n"));
  CLUSTER_BLOCKS.push({ key: grp[0].key, file: "cdx-00000.gz", off: shardLen, len: gz.length }); SHARD_PARTS.push(gz); shardLen += gz.length;
}
CLUSTER_BLOCKS.push({ key: "example,zbad)/x", file: "../../etc/passwd", off: 0, len: 100 }); // a cluster entry that names a file outside the crawl's shards
CLUSTER_BLOCKS.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const CLUSTER = Buffer.from(CLUSTER_BLOCKS.map((b, i) => `${b.key} 20261010000000\t${b.file}\t${b.off}\t${b.len}\t${i + 1}`).join("\n") + "\n");
const SHARD = Buffer.concat(SHARD_PARTS), BLOB = Buffer.concat(PARTS);
const bigBlocks = CLUSTER_BLOCKS.filter((b) => b.file === "cdx-00000.gz").filter((b) => { const i = CLUSTER_BLOCKS.indexOf(b); const nxt = CLUSTER_BLOCKS[i + 1]; return b.key.startsWith("example,big)") || (nxt && nxt.key.startsWith("example,big)")) || false; }).length;
const LISTING = `<table><tbody>
<tr><td><a href="/crawl-data/CC-MAIN-2026-40/index.html">CC-MAIN-2026-40</a></td>
<td><a href="https://commoncrawl.org/blog/october-2026-crawl-archive-now-available">October 2026</a></td><td align="right">2.16</td></tr>
<tr><td><a href="/crawl-data/CC-MAIN-2026-34/index.html">CC-MAIN-2026-34</a></td>
<td><a href="https://commoncrawl.org/blog/august-2026-crawl-archive-now-available">August 2026</a></td><td align="right">2.1</td></tr>
<tr><td><a href="/crawl-data/CC-MAIN-2025-50/index.html">CC-MAIN-2025-50</a></td>
<td><a href="https://commoncrawl.org/blog/december-2025-crawl-archive-now-available">December 2025</a></td><td align="right">2.0</td></tr>
</tbody></table>`;

const LOG = []; const state = { failPage: null, failIndex: null, pageCount: 0, indexCount: 0, afterFail: 0, failed: false, dropBlocks: false, blocks500: false, ignoreRange: false };
const resetState = () => { state.failPage = null; state.failIndex = null; state.pageCount = 0; state.indexCount = 0; state.afterFail = 0; state.failed = false; state.dropBlocks = false; state.blocks500 = false; state.ignoreRange = false; };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname; LOG.push({ method: req.method, path: p, range: req.headers.range || null, ua: req.headers["user-agent"] || "" });
  if (state.failed) state.afterFail++;
  const isPage = p.startsWith("/crawl-data/"), isIndex = p.startsWith("/cc-index/");
  const n = isPage ? ++state.pageCount : ++state.indexCount, f = isPage ? state.failPage : state.failIndex;
  if (f && n === f.at) { state.failed = true; res.writeHead(f.status, { "content-type": "text/plain" }); return res.end("slow down"); }
  const range = (buf) => { const m = (req.headers.range || "").match(/bytes=(\d+)-(\d+)/); if (!m) return null; return buf.subarray(Number(m[1]), Number(m[2]) + 1); };
  if (p === "/cc-index/collections/index.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(LISTING); }
  if (p === `/cc-index/collections/${CRAWL}/indexes/cluster.idx`) { if (req.method === "HEAD") { res.writeHead(200, { "content-length": CLUSTER.length }); return res.end(); } res.writeHead(200, { "content-length": CLUSTER.length }); return res.end(CLUSTER); }
  if (isIndex && p.includes("/indexes/cdx-")) {
    if (state.dropBlocks) { req.socket.destroy(); return; }
    if (state.blocks500) { res.writeHead(500); return res.end("boom"); }
    const part = range(SHARD); if (!part) { res.writeHead(416); return res.end(); }
    res.writeHead(206, { "content-type": "application/octet-stream" }); return res.end(part);
  }
  if (isPage && p.endsWith(".warc.gz")) {
    if (state.ignoreRange) { res.writeHead(200); return res.end(BLOB); } // Range ignored: the whole file
    const part = range(BLOB); if (part) { res.writeHead(206, { "content-type": "application/octet-stream" }); return res.end(part); }
  }
  res.writeHead(404); res.end("nope");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.PEWP_CC_DATA = base;
const cliEnv = (state2) => ({ ...process.env, PEWP_CC_DATA: base, PEWP_TEST_GAP_MS: "0", OMNIKOM_STOPS_DIR: state2 || path.join(tmp, "state-cli") });

// ---------------------------------------------------------------- fixture: authority.json (what authority.mjs wrote)
const authority = (extra = {}) => ({ release: "cc-main-2026-aug-sep-oct", target: "paragonaltcap.com",
  results: [
    { domain: "paragonaltcap.com", role: "target", inGraph: false, note: "not in this Common Crawl release" },
    { domain: "lendio.com", role: "competitor", inGraph: true, strongestLinkingDomains: [{ domain: "r1.example", harmonicPos: 10 }, { domain: "r6.example", harmonicPos: 60 }] },
    { domain: "kapitus.com", role: "competitor", inGraph: true, strongestLinkingDomains: [{ domain: "r1.example", harmonicPos: 10 }, { domain: "r2.example", harmonicPos: 20 }, { domain: "r3.example", harmonicPos: 30 }, { domain: "r4.example", harmonicPos: 40 }, { domain: "r5.example", harmonicPos: 50 }, { domain: "help.followupboss.com", harmonicPos: 5 }, { domain: "zbad.example", harmonicPos: 45 }] },
  ], linkGap: [{ domain: "gap.example", linksToCompetitors: 2, harmonicPos: 25 }], ...extra });
const only = (rows) => authority({ results: [{ domain: "kapitus.com", role: "target", inGraph: true, strongestLinkingDomains: rows.map((d, i) => ({ domain: d, harmonicPos: i + 1 })) }], linkGap: [] });
const freshPewp = (name, auth = authority()) => { const p = path.join(tmp, name); w(path.join(p, "authority.json"), auth); return p; };
const opts = (p, more = {}) => ({ pewp: p, cacheDir: path.join(p, "cache", "anchors"), maxRequests: 600, gapMs: 0, minFreeGb: 0, log: () => {}, ...more });
const imp = await import(pathToFileURL(path.join(dir, "authority-anchors.mjs")).href);
const md = (p) => fs.readFileSync(path.join(p, "authority", "anchors.md"), "utf8");
const cli = (p, extra = [], state2) => spawnP(process.execPath, [path.join(dir, "authority-anchors.mjs"), p, "--gap-ms", "0", "--cache", path.join(p, "cache", "anchors"), "--min-free-gb", "0", ...extra], { cwd: tmp, env: cliEnv(state2) });

try {
  // ================================================================ unit: parsing and classifying
  const T = ["kapitus.com", "lendio.com"];
  const links = imp.extractLinks(R1_PAGE, "https://r1.example/reviews/kapitus", T, { keywords: ["small business loans"] });
  const kap = links.filter((l) => l.target === "kapitus.com"), by = (a) => kap.find((l) => l.anchor === a);
  check("extract: anchors, one per link to a target (the other-domain, mailto and look-alike links are not counted)", kap.length === 5 && links.filter((l) => l.target === "lendio.com").length === 1 && links.length === 6, JSON.stringify(links.map((l) => [l.target, l.anchor])));
  check("extract: link types (follow, nofollow, sponsored)", by("Kapitus")?.type === "follow" && by("Kapitus small business loans")?.type === "nofollow" && by("click here")?.type === "sponsored" && by("click here")?.rel.includes("noopener"), JSON.stringify(kap.map((l) => [l.anchor, l.type])));
  check("extract: image link takes its alt text and is kind image", by("Kapitus logo")?.kind === "image", JSON.stringify(by("Kapitus logo")));
  check("extract: placement (nav, footer, body)", by("Kapitus")?.placement === "nav" && by("click here")?.placement === "footer" && by("Kapitus small business loans")?.placement === "body", JSON.stringify(kap.map((l) => [l.anchor, l.placement])));
  check("extract: look-alike hosts (xkapitus.com, kapitus.com.evil.example) are not Kapitus", !links.some((l) => /xkapitus|evil/.test(l.href)), JSON.stringify(links.map((l) => l.href)));
  const pn = imp.extractLinks(R2_PAGE, "https://r2.example/best-lenders", T);
  check("extract: a page-level nofollow (meta robots) makes its links nofollow", pn.length === 1 && pn[0].type === "nofollow" && pn[0].rel.length === 0, JSON.stringify(pn));
  const cls = (t, img = false, kw = []) => imp.classifyAnchor(t, img, { domain: "kapitus.com", keywords: kw });
  check("classify: brand, partial, url, generic, image, empty, other", cls("Kapitus") === "brand" && cls("kapitus.com") === "url" && cls("https://www.kapitus.com/x") === "url" && cls("Click here") === "generic" && cls("Kapitus reviews") === "partial" && cls("", true) === "image" && cls("  ") === "empty" && cls("Alternative funding") === "other", [cls("Kapitus"), cls("kapitus.com"), cls("Click here"), cls("Kapitus reviews")].join());
  check("classify: exact keyword only for a keyword given, and inside longer text it is partial", cls("Small Business Loans", false, ["small business loans"]) === "exact" && cls("Small Business Loans") === "other" && cls("best small business loans of 2026", false, ["small business loans"]) === "partial", [cls("Small Business Loans", false, ["small business loans"]), cls("Small Business Loans")].join());
  const chunkedHtml = "<p>0123456789012345678901234567890123456789 tail <a href='https://kapitus.com'>Kapitus</a></p>";
  const rec = imp.parseWarcRecord(record("https://x.example/", chunkedHtml, { chunked: true }));
  check("warc: a chunked body is decoded before parsing (the page comes back byte for byte)", rec && rec.html === chunkedHtml && rec.status === 200, JSON.stringify(rec?.html?.slice(0, 80)));
  const listed = imp.parseCrawlListing(LISTING), cc = imp.pickCrawls(listed, "cc-main-2026-aug-sep-oct", 1), cc2 = imp.pickCrawls(listed, "cc-main-2026-aug-sep-oct", 2), wrap = imp.releaseWindow("cc-main-2026-nov-dec-jan");
  check("crawls: read from the data host's list; the newest crawl inside the graph release window; a window that wraps the year", listed.length === 3 && cc.crawls.join() === "CC-MAIN-2026-40" && cc2.crawls.join() === "CC-MAIN-2026-40,CC-MAIN-2026-34" && wrap.has("2026-10") && wrap.has("2027-0") && !wrap.has("2026-0"), JSON.stringify([listed, cc, cc2, [...wrap]]));
  const fake = imp.parseCluster("0,a)/ 20261010000000\tcdx-00000.gz\t0\t10\t1\ncom,aaa)/ 20261010000000\tcdx-00000.gz\t10\t10\t2\ncom,lendio)/x 20261010000000\tcdx-00000.gz\t20\t10\t3\ncom,lendio,blog)/y 20261010000000\tcdx-00000.gz\t30\t10\t4\ncom,lendiq)/z 20261010000000\tcdx-00000.gz\t40\t10\t5\n");
  check("index: block span of a domain (its subdomains in, look-alike names out; the first block may start before the domain)", imp.surtOf("www.Lendio.com") === "com,lendio" && fake.length === 5 && fake[1].key === "com,aaa)/" && JSON.stringify(imp.blockSpan(fake, "lendio.com")) === "[1,3]" && JSON.stringify(imp.blockSpan(fake, "aaa.com")) === "[0,1]", JSON.stringify([imp.blockSpan(fake, "lendio.com"), imp.blockSpan(fake, "aaa.com")]));
  check("block cap: the first block and then blocks spread evenly, at most the cap", JSON.stringify(imp.sampleBlocks(0, 9, 3)) === "[0,5,9]" && JSON.stringify(imp.sampleBlocks(2, 3, 3)) === "[2,3]" && JSON.stringify(imp.sampleBlocks(4, 4, 3)) === "[4]" && imp.sampleBlocks(0, 99, 3).length === 3, JSON.stringify([imp.sampleBlocks(0, 9, 3), imp.sampleBlocks(2, 3, 3), imp.sampleBlocks(0, 99, 3)]));
  const blk = imp.blockRows(['com,lendio)/a 20261010000000 {"url":"https://lendio.com/a","mime":"text/html","status":"200","length":"5","offset":"1","filename":"crawl-data/x.warc.gz"}',
    'com,lendio)/b 20261010000000 {"url":"https://lendio.com/b","mime":"text/html","status":"404","length":"5","offset":"1","filename":"f"}', 'com,lendio)/c.png 20261010000000 {"url":"https://lendio.com/c.png","mime":"image/png","status":"200","length":"5","offset":"1","filename":"f"}',
    'com,lendio,blog)/d 20261010000000 {"url":"https://blog.lendio.com/d","mime":"text/html","status":"200","length":"5","offset":"1","filename":"f"}', 'com,lendiox)/e 20261010000000 {"url":"https://lendiox.com/e","mime":"text/html","status":"200","length":"5","offset":"1","filename":"f"}', ""].join("\n"), "lendio.com");
  check("blocks: only HTML 200 pages of the domain and its subdomains are kept (404, an image and a look-alike domain are not)", blk.map((r) => r.url).join() === "https://lendio.com/a,https://blog.lendio.com/d", JSON.stringify(blk.map((r) => r.url)));

  // ================================================================ the main run (fixture CC)
  LOG.length = 0; resetState(); clearStop();
  const pA = freshPewp("a");
  const A = await imp.runAnchors(opts(pA, { keywords: ["small business loans"] }));
  const tk = A.targets["kapitus.com"], tl = A.targets["lendio.com"], tp = A.targets["paragonaltcap.com"];
  const logA = LOG.slice(), recOf = (d) => A.readDomains.find((x) => x.domain === d);
  check("run: kapitus anchors, types and counts are right", tk.linksFound === 6 && tk.follow === 3 && tk.nofollow === 2 && tk.sponsored === 1 && tk.ugc === 0 && tk.anchorMix.brand === 1 && tk.anchorMix.exact === 1 && tk.anchorMix.partial === 1 && tk.anchorMix.url === 1 && tk.anchorMix.generic === 1 && tk.anchorMix.image === 1, JSON.stringify([tk.linksFound, tk.follow, tk.nofollow, tk.sponsored, tk.anchorMix]));
  check("run: lendio gets its links from the same page fetch and from a chunked record", tl.linksFound === 2 && tl.links.some((l) => l.from === "gap.example" && l.anchor === "Lendio review") && tl.links.some((l) => l.from === "r1.example" && l.anchor === "Lendio"), JSON.stringify(tl.links.map((l) => [l.from, l.anchor])));
  check("run: a target outside the graph says so and has no anchors", tp.inGraph === false && /not in the Common Crawl link graph/.test(tp.note) && !("links" in tp), JSON.stringify(tp));
  check("run: the crawl comes from the data host's list, and each link keeps its page URL and crawl", A.crawls.join() === CRAWL && tk.links.every((l) => /^https:\/\//.test(l.page) && l.crawl === CRAWL), JSON.stringify([A.crawls, tk.links[0]]));
  check("tier order: a brand-in-URL page is chosen first, then a topic page, and a domain is left as soon as every target of it was found", (() => {
    const r1 = recOf("r1.example"), r2 = recOf("r2.example");
    return r1.pages === 1 && tk.links.filter((l) => l.from === "r1.example").every((l) => l.tier === "brand-in-url") && r2.pages === 1 && tk.links.filter((l) => l.from === "r2.example").every((l) => l.tier === "topic-in-url");
  })(), JSON.stringify(A.readDomains.map((d) => [d.domain, d.pages, d.status])));
  check("tier order: one page fetch serves every target it links to (r1.example read once for two targets)", logA.filter((l) => l.range && l.path.endsWith(".warc.gz") && l.range.startsWith("bytes=0-")).length === 1, JSON.stringify(logA.filter((l) => l.path.endsWith(".warc.gz")).map((l) => l.range)));
  check("blocks: only HTML 200 pages are read (r1 holds 3 valid pages, plus a 404 and an image record with the brand in the URL; r2 holds 1)", recOf("r1.example").cdxRows === 3 && recOf("r2.example").cdxRows === 1, JSON.stringify([recOf("r1.example")?.cdxRows, recOf("r2.example")?.cdxRows]));
  check("index: the cluster.idx is asked for its size once, downloaded once, kept on disk with its size", logA.filter((l) => l.path.endsWith("cluster.idx") && l.method === "HEAD").length === 1 && logA.filter((l) => l.path.endsWith("cluster.idx") && l.method === "GET").length === 1 && fs.readdirSync(path.join(pA, "cache", "anchors")).some((f) => f === `${CRAWL}-cluster.idx.done`), JSON.stringify(logA.filter((l) => l.path.endsWith("cluster.idx")).map((l) => l.method)));
  check("index: the index host is never used and block reads stay within the cap per domain", logA.every((l) => l.path === "/cc-index/collections/index.html" || l.path.startsWith(`/cc-index/collections/${CRAWL}/indexes/`) || l.path.startsWith("/crawl-data/CC-MAIN-")) && A.readDomains.every((d) => d.blocksSampled <= 3 && d.blocksSampled <= d.blocksTotal), JSON.stringify(A.readDomains.map((d) => [d.domain, d.blocksSampled, d.blocksTotal])));
  check("coverage line: found on N of M read, the rest 'not found in the pages sampled', and how many index blocks were sampled", /^found links on 2 of 4 referring domains read; the rest: not found in the pages sampled \(sampled \d+ of \d+ index blocks\)/.test(tk.coverage) && /^found links on 2 of 2 referring domains read; the rest: not found in the pages sampled \(sampled \d+ of \d+ index blocks\)/.test(tl.coverage), `${tk.coverage} | ${tl.coverage}`);
  const mdA = md(pA);
  check("coverage line: the report never says a site has no link", !/\bno links?\b|does not link|doesn't link|never links/i.test(mdA) && /not found in the pages sampled/.test(mdA) && !/no link/i.test(JSON.stringify(A.targets)), mdA.match(/.*no links?.*/i)?.[0] || "");
  check("run: anchors.json and anchors.md are written under authority/ with the follow counts and the index-host incident", fs.existsSync(path.join(pA, "authority", "anchors.json")) && /Follow 3, nofollow 2, ugc 0, sponsored 1/.test(mdA) && /Not in the link graph/.test(mdA) && /dropped every request from this machine from 03:59 to 04:12/.test(mdA), mdA.slice(0, 400));
  check("denylist: a do-not-request host is never a referring domain read, and is listed as skipped", !A.readDomains.some((d) => /followupboss/.test(d.domain)) && A.skipped.some((s) => s.domain === "help.followupboss.com"), JSON.stringify([A.skipped, A.readDomains.map((d) => d.domain)]));
  check("filename guard: an index record whose file is not a crawl-data warc on the data host is not requested", !logA.some((l) => l.path.startsWith("/crawl-data/") && /http:|\.\./.test(l.path + l.range)) && recOf("r5.example")?.pages === 0 && recOf("r5.example")?.status === "no-pages-sampled", JSON.stringify([logA.filter((l) => l.range).map((l) => l.path), recOf("r5.example")]));
  check("shard guard: a cluster entry that names a file outside the crawl's cdx shards is never requested", !logA.some((l) => /passwd|etc/.test(l.path)) && recOf("zbad.example")?.blocksSampled === recOf("zbad.example")?.blocksTotal - 1, JSON.stringify([logA.filter((l) => /etc|passwd/.test(l.path)), recOf("zbad.example")]));
  check("run: only GET (and the one HEAD), an honest user agent, nothing outside the one Common Crawl data host", logA.every((l) => (l.method === "GET" || (l.method === "HEAD" && l.path.endsWith("cluster.idx"))) && /^PEWP-Anchors\/1\.0/.test(l.ua)) && guardLog.length === 0, guardLog.join() + JSON.stringify(logA.map((l) => l.method + l.path)));
  check("budget: the default is the hard cap of 600 requests and nothing in the stop file after a clean run", A.budget.maxRequests === 600 && A.budget.gapMs === 0 && imp.HARD_CAP === 600 && imp.MIN_GAP_MS === 3000 && !fs.existsSync(stopFile()), JSON.stringify([A.budget, imp.HARD_CAP, imp.MIN_GAP_MS]));

  // ================================================================ cache
  const before = LOG.length;
  const A2 = await imp.runAnchors(opts(pA, { keywords: ["small business loans"] }));
  check("cache: a re-run sends no request (cluster.idx, blocks and pages all from disk) and gives the same result", LOG.length === before && A2.requests.requests === 0 && A2.requests.cached > 0 && A2.targets["kapitus.com"].linksFound === 6 && JSON.stringify(A2.targets["kapitus.com"].links) === JSON.stringify(tk.links), `${LOG.length - before} new requests; ${JSON.stringify(A2.requests)}`);

  // ================================================================ block cap: the brand page is deep in big.example
  LOG.length = 0; resetState();
  const pBig1 = freshPewp("big1", only(["big.example"])), B1 = await imp.runAnchors(opts(pBig1, { blocks: 1 }));
  const pBig9 = freshPewp("big9", only(["big.example"])), B9 = await imp.runAnchors(opts(pBig9, { blocks: 50 }));
  const b1 = B1.readDomains[0], b9 = B9.readDomains[0];
  check("block cap: with 1 block only the first is read and the coverage line says so (the deep brand page is not found); with a large cap it is found", b1.blocksSampled === 1 && b1.blocksTotal >= bigBlocks && b1.blocksTotal > 1 && B1.targets["kapitus.com"].linksFound === 0 && B1.targets["kapitus.com"].coverage.includes(`sampled 1 of ${b1.blocksTotal} index blocks`) && b9.blocksSampled === b9.blocksTotal && B9.targets["kapitus.com"].linksFound === 1 && B9.targets["kapitus.com"].links[0].tier === "brand-in-url", JSON.stringify([b1, b9, bigBlocks, B1.targets["kapitus.com"].coverage]));

  // ================================================================ range
  resetState(); state.ignoreRange = true; LOG.length = 0;
  const pR = freshPewp("range", only(["r6.example"])), R = await imp.runAnchors(opts(pR, { maxRequests: 50 }));
  state.ignoreRange = false;
  const r6rec = R.readDomains.find((d) => d.domain === "r6.example");
  check("range: a server that ignores Range (sends the whole file) is not read", r6rec && r6rec.links === 0 && r6rec.pageErrors === 1 && R.targets["kapitus.com"].linksFound === 0, JSON.stringify(r6rec));

  // ================================================================ budget (a budget stop is not a Common Crawl stop: no stop file)
  LOG.length = 0; resetState(); clearStop();
  const pB = freshPewp("budget"), B = await imp.runAnchors(opts(pB, { maxRequests: 3 }));
  check("budget: the run stops at the cap and says the rest was not reached", LOG.length === 3 && B.requests.requests === 3 && B.stopped?.kind === "budget" && /were not reached because the run stopped/.test(B.targets["kapitus.com"].coverage), `${LOG.length} requests; ${JSON.stringify(B.stopped)}; ${B.targets["kapitus.com"].coverage}`);
  check("budget: a partial result is still written, and a budget stop leaves no stop file", fs.existsSync(path.join(pB, "authority", "anchors.md")) && /Stopped early:\*\* request budget of 3 reached/.test(md(pB)) && !fs.existsSync(stopFile()), md(pB).slice(0, 400));

  // ================================================================ stops (through the CLI: exit code 4) and the 24 h stop file
  const stateS = path.join(tmp, "state-503");
  resetState(); LOG.length = 0; state.failPage = { at: 2, status: 503 };
  const p503 = freshPewp("s503"), c503 = await cli(p503, [], stateS);
  const stop503 = J(path.join(stateS, "commoncrawl.json")), j503 = J(path.join(p503, "authority", "anchors.json"));
  check("stop: a 503 from Common Crawl stops the run at once (exit 4, nothing sent after it, partial result written)", c503.code === 4 && state.failed && state.afterFail === 0 && j503?.stopped?.status === 503 && /STOPPED/.test(c503.err), `exit ${c503.code}; after the 503: ${state.afterFail}; ${c503.err.slice(0, 200)}`);
  check("stop file: after a stop, a 24 h stop file exists and the next run refuses to start (exit 3, no request)", stop503 && Date.parse(stop503.until) - Date.now() > 23.9 * 3600e3 && Date.parse(stop503.until) - Date.now() <= 24 * 3600e3 + 1000 && stop503.engine === "commoncrawl" && stop503.setBy === "authority-anchors.mjs" && /503/.test(stop503.reason), JSON.stringify(stop503));
  const n0 = LOG.length; resetState();
  const cAgain = await cli(freshPewp("s503b"), [], stateS);
  check("stop file: while it is in force no request is sent and the message says until when", cAgain.code === 3 && LOG.length === n0 && /stopped us until/.test(cAgain.err) && /BLOCKED/.test(cAgain.err), `exit ${cAgain.code}; ${LOG.length - n0} requests; ${cAgain.err.slice(0, 200)}`);
  fs.writeFileSync(path.join(stateS, "commoncrawl.json"), JSON.stringify({ engine: "commoncrawl", hosts: ["data.commoncrawl.org"], until: new Date(Date.now() - 1000).toISOString(), reason: "old", setBy: "test", setAt: new Date(Date.now() - 90000000).toISOString(), evidence: null }));
  const cExpired = await cli(freshPewp("s503c"), [], stateS);
  check("stop file: a stop file past its time no longer blocks", cExpired.code === 0, `exit ${cExpired.code}; ${cExpired.err.slice(0, 200)}`);
  const stateT = path.join(tmp, "state-429");
  resetState(); LOG.length = 0; state.failIndex = { at: 3, status: 429 };
  const p429 = freshPewp("s429"), c429 = await cli(p429, [], stateT);
  check("stop: a 429 while downloading cluster.idx stops the run too, and nothing is kept as the cluster file", c429.code === 4 && state.failed && state.afterFail === 0 && J(path.join(p429, "authority", "anchors.json"))?.stopped?.status === 429 && !fs.existsSync(path.join(p429, "cache", "anchors", `${CRAWL}-cluster.idx`)), `exit ${c429.code}; after: ${state.afterFail}`);
  const stateD = path.join(tmp, "state-drop");
  resetState(); LOG.length = 0; state.dropBlocks = true;
  const pD = freshPewp("drop"), cD = await cli(pD, [], stateD), jD = J(path.join(pD, "authority", "anchors.json"));
  check("stop: a dropped connection (the first index block read) stops the run at once, exit 4, and starts the 24 h stop file", cD.code === 4 && jD?.stopped?.kind === "dropped" && LOG.filter((l) => l.path.includes("/indexes/cdx-")).length === 1 && fs.existsSync(path.join(stateD, "commoncrawl.json")) && /dropped/.test(J(path.join(stateD, "commoncrawl.json"))?.reason || ""), `exit ${cD.code}; ${JSON.stringify(jD?.stopped)}; block requests ${LOG.filter((l) => l.path.includes("/indexes/cdx-")).length}`);
  resetState(); LOG.length = 0; state.blocks500 = true; clearStop();
  const pI = freshPewp("indexdown"), I = await imp.runAnchors(opts(pI));
  state.blocks500 = false;
  const nBlk = LOG.filter((l) => l.path.includes("/indexes/cdx-")).length;
  check("index failure: five index block reads failing in a row (a 500) stop the run; those domains are 'index-error', never 'no pages'", I.stopped?.kind === "index-unreachable" && nBlk === 5 && I.readDomains.length > 0 && I.readDomains.every((d) => d.status === "index-error") && /could not be read because the index failed/.test(I.targets["kapitus.com"].coverage), `stopped ${JSON.stringify(I.stopped)}; block reads ${nBlk}; ${JSON.stringify(I.readDomains.map((d) => d.status))}`);
  clearStop();

  // ================================================================ disk floor, usage (in-process, so the network guard is on)
  resetState(); LOG.length = 0;
  const pF = freshPewp("disk"); let fe = null;
  try { await imp.runAnchors(opts(pF, { minFreeGb: 1e9 })); } catch (e) { fe = e; }
  check("disk floor: too little free disk stops before cluster.idx is downloaded (BLOCKED, with what unblocks it)", fe?.blocked === true && /BLOCKED: .* GB free/.test(fe.message) && /unblocks/.test(fe.message) && !LOG.some((l) => l.method === "GET" && l.path.endsWith("cluster.idx")) && LOG.some((l) => l.method === "HEAD"), `${fe?.message}; ${JSON.stringify(LOG.map((l) => l.method + l.path))}`);
  const savedD = process.env.PEWP_CC_DATA; delete process.env.PEWP_CC_DATA;
  const pU = freshPewp("usage"); let ue = null; guardLog.length = 0;
  try { await imp.runAnchors(opts(pU, { gapMs: 2000 })); } catch (e) { ue = e; }
  process.env.PEWP_CC_DATA = savedD;
  check("usage: gap under 3000 ms to the real Common Crawl is refused before any request", ue?.constructor?.name === "UsageError" && /polite minimum of 3000/.test(ue.message) && guardLog.length === 0, `${ue?.constructor?.name}: ${ue?.message} guard: ${guardLog.join()}`);
  let he = null; try { await imp.runAnchors(opts(pU, { maxRequests: 601 })); } catch (e) { he = e; }
  check("usage: hard cap, more than 600 requests per run is refused", he?.constructor?.name === "UsageError" && /hard cap of 600/.test(he.message), `${he?.constructor?.name}: ${he?.message}`);
  let ue2 = null, ue3 = null; try { await imp.runAnchors(opts(pU, { k: "abc" })); } catch (e) { ue2 = e; } try { await imp.runAnchors(opts(pU, { crawls: ["../x"] })); } catch (e) { ue3 = e; }
  const cu = await cli(pU, ["--k", "0"]);
  check("usage: a --k that is not a whole number of at least 1, or a crawl id that is not CC-MAIN-YYYY-WW, is a usage error (exit 2)", ue2?.constructor?.name === "UsageError" && ue3?.constructor?.name === "UsageError" && cu.code === 2, `${ue2?.message}; ${ue3?.message}; exit ${cu.code}`);
  const cb = await cli(path.join(tmp, "no-such-pewp"));
  check("usage: no authority.json is BLOCKED (exit 3) with what unblocks it", cb.code === 3 && /BLOCKED/.test(cb.err) && /authority\.mjs/.test(cb.err), cb.err.slice(0, 200));
  check("guard: nothing left the machine during the whole test", guardLog.length === 0, guardLog.join());
} finally { server.close(); }

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed${failed.length ? "; FAILED: " + failed.map((f) => f.name.split(":")[0] + ":" + f.name.split(":")[1]?.slice(0, 40)).join(" | ") : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
