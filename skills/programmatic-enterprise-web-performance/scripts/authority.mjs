// Usage: node authority.mjs <out.json> --target <domain> [--competitor <domain>]... [--release <id>] [--cache DIR] [--top 30]
// Who links to a site and how strong it is, from Common Crawl's FREE web graph (domain level; one release is about
// 3 months of crawling). Port of tools/seo-kit/backlinks.mjs (Francine & Eli, 2026-10-17) with a link gap added:
// domains that link to 2 or more competitors but not to the target (the outreach list an agency would build).
// Data: https://data.commoncrawl.org/projects/hyperlinkgraph/<release>/domain/ (vertices 0.9 GB, edges 8 GB, ranks 2.3 GB).
// Cache: --cache, else machine.local.json "seoKitCache"; the release defaults to the one already in the cache, so a run
// reads from disk and downloads nothing. Read-only; writes only <out.json> and its .md.
// Honest scope: Common Crawl sees fewer links than paid indexes; use the numbers to compare sites, not as absolutes.
// Exit 0 written, 1 failed (the message names the file and the step), 2 usage, 3 BLOCKED (no complete release in the cache).
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import {  } from "./measure-sources.mjs";

const BASE = "https://data.commoncrawl.org/projects/hyperlinkgraph";
const UA = "PEWP-Authority/1.0 (Common Crawl web graph, read-only)";
export const rev = (d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").split(".").reverse().join(".");
export const unrev = (r) => r.split(".").reverse().join(".");

export function defaultCache() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "machine.local.json"), "utf8")).seoKitCache || null; } catch { return null; }
}
// The release whose three files are all in the cache (newest first), else null.
export function cachedRelease(cacheDir) {
  if (!cacheDir || !fs.existsSync(cacheDir)) return null;
  const files = fs.readdirSync(cacheDir);
  const rels = [...new Set(files.map((f) => (f.match(/^(.+)-domain-(vertices|edges|ranks)\.txt\.gz$/) || [])[1]).filter(Boolean))].sort().reverse();
  return rels.find((r) => ["vertices", "edges", "ranks"].every((k) => files.includes(`${r}-domain-${k}.txt.gz`) && !files.includes(`${r}-domain-${k}.txt.gz.part`))) || null;
}

// A multi-GB graph file (edges 8 GB) streams for a long time, so a total time limit would cut a slow but healthy download. A STALL
// watchdog bounds it instead: no byte for stallMs (default 120 s, PEWP_CC_STALL_S overrides) aborts the request, including a server
// that never answers. Every stream error reaches the reader: src.pipe() does not forward errors, so a reset connection used to leave
// the line reader waiting forever. The cache copy is closed and trusted (its .part marker removed) before this returns, so the next
// read of the same file (vertices is read twice) never races a write still in flight; a failed download is never trusted.
const STALL_MS = Number(process.env.PEWP_CC_STALL_S || 120) * 1000;
export async function eachLine(url, cacheDir, label, onLine, { stallMs = STALL_MS } = {}) {
  let src, watchdog = null, stalled = false, cacheDone = null, out = null;
  const file = cacheDir ? path.join(cacheDir, path.basename(url)) : null;
  if (file && fs.existsSync(file) && fs.statSync(file).size > 0 && !fs.existsSync(file + ".part")) src = fs.createReadStream(file);
  else {
    const ac = new AbortController();
    let last = Date.now();
    watchdog = setInterval(() => {
      if (src?.isPaused?.()) { last = Date.now(); return; } // paused by back-pressure (we are busy reading lines), not stalled
      if (Date.now() - last > stallMs) { stalled = true; clearInterval(watchdog); ac.abort(new Error(`no data for ${stallMs / 1000} s`)); }
    }, Math.max(50, Math.min(5000, stallMs / 4)));
    const stallMsg = () => `${label}: the download of ${url} stalled (no data for ${stallMs / 1000} s): stopped. A partial cache file stays marked .part and is downloaded again next run.`;
    let res;
    try { res = await fetch(url, { headers: { "user-agent": UA }, signal: ac.signal }); }
    catch (e) { clearInterval(watchdog); throw new Error(stalled ? stallMsg() : `${label}: ${e.message} for ${url}`); }
    if (!res.ok) { clearInterval(watchdog); try { await res.body?.cancel(); } catch {} throw new Error(`${label}: HTTP ${res.status} for ${url}`); }
    src = Readable.fromWeb(res.body);
    src.on("data", () => { last = Date.now(); });
    src.on("end", () => clearInterval(watchdog)); // all bytes are in: reading the rest of the lines is not a stall
    src.stallMsg = stallMsg;
    if (file) {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(file + ".part", "");
      out = fs.createWriteStream(file);
      cacheDone = new Promise((resolve, reject) => { out.on("close", resolve); out.on("error", reject); });
      cacheDone.catch(() => {}); // awaited below; a disk error also stops the download through src.destroy
      out.on("error", (e) => src.destroy(new Error(`${label}: cannot write the cache file ${file} (${e.message})`)));
      src.on("data", (c) => out.write(c));
      src.on("error", () => out.destroy()); // the .part marker stays: the file is not trusted next run
      src.on("end", () => out.end());
    }
  }
  const gunzip = zlib.createGunzip({ chunkSize: 1 << 20 });
  src.on("error", (e) => gunzip.destroy(e));
  src.pipe(gunzip);
  let rest = "", lines = 0;
  const t0 = Date.now();
  let lastLog = t0;
  try {
    for await (const chunk of gunzip) {
      const s = rest + chunk.toString("utf8");
      let start = 0, nl;
      while ((nl = s.indexOf("\n", start)) !== -1) { onLine(s, start, nl); start = nl + 1; lines++; }
      rest = s.slice(start);
      if (Date.now() - lastLog > 30000) { lastLog = Date.now(); console.log(`  ${label}: ${(lines / 1e6).toFixed(0)} M lines, ${Math.round((Date.now() - t0) / 1000)} s`); }
    }
    // the cache copy is trusted (its .part marker removed) only once the whole file was written AND read through without an error:
    // a download that was cut, stalled or arrived truncated / corrupt keeps the marker and is downloaded again next run
    if (cacheDone) { await cacheDone; fs.rmSync(file + ".part", { force: true }); }
  } catch (e) {
    src.destroy();
    if (cacheDone) { out.destroy(); try { await cacheDone; } catch {} }
    throw new Error(stalled ? src.stallMsg() : `${label}: reading ${file && !watchdog ? file : url} failed: ${e.message}`);
  } finally { if (watchdog) clearInterval(watchdog); }
  if (rest) { onLine(rest, 0, rest.length); lines++; }
  console.log(`  ${label}: done, ${(lines / 1e6).toFixed(1)} M lines in ${Math.round((Date.now() - t0) / 1000)} s`);
  return lines;
}
const int = (s, i, j) => { let n = 0; for (; i < j; i++) { const c = s.charCodeAt(i) - 48; if (c < 0 || c > 9) break; n = n * 10 + c; } return n; };

export async function authority({ out, release, cacheDir, top = 30, target, competitors = [] }) {
  const url = (f) => `${BASE}/${release}/domain/${release}-domain-${f}.txt.gz`;
  const domains = [target, ...competitors].filter(Boolean);
  const targets = new Map(domains.map((d) => [rev(d), { domain: d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""), id: null }]));
  const idToTarget = new Map();
  console.log("1/4 finding the sites in the domain list");
  await eachLine(url("vertices"), cacheDir, "vertices", (s, a, b) => {
    const t1 = s.indexOf("\t", a); if (t1 < 0 || t1 > b) return;
    const t2 = s.indexOf("\t", t1 + 1); const name = s.slice(t1 + 1, t2 > 0 && t2 < b ? t2 : b);
    const t = targets.get(name);
    if (t) { t.id = int(s, a, t1); t.hosts = int(s, t2 + 1, b); idToTarget.set(t.id, t); }
  });
  console.log("2/4 reading every link between domains (largest step)");
  const inbound = new Map([...idToTarget.keys()].map((id) => [id, new Set()]));
  await eachLine(url("edges"), cacheDir, "edges", (s, a, b) => {
    const t = s.indexOf("\t", a); if (t < 0 || t > b) return;
    const set = inbound.get(int(s, t + 1, b));
    if (set) set.add(int(s, a, t));
  });
  const allFrom = new Set(); for (const set of inbound.values()) for (const id of set) allFrom.add(id);
  console.log(`3/4 naming ${allFrom.size} linking domains`);
  const names = new Map();
  await eachLine(url("vertices"), cacheDir, "vertices", (s, a, b) => {
    const t1 = s.indexOf("\t", a); if (t1 < 0 || t1 > b) return;
    const id = int(s, a, t1);
    if (allFrom.has(id)) { const t2 = s.indexOf("\t", t1 + 1); names.set(id, s.slice(t1 + 1, t2 > 0 && t2 < b ? t2 : b)); }
  });
  console.log("4/4 reading domain strength (harmonic centrality and PageRank)");
  const want = new Set([...targets.keys(), ...names.values()]);
  const rank = new Map(); let cols = null;
  await eachLine(url("ranks"), cacheDir, "ranks", (s, a, b) => {
    const line = s.slice(a, b);
    if (!cols) { if (line.startsWith("#")) { cols = line.slice(1).split("\t").map((c) => c.trim().replace(/^#/, "")); return; } cols = ["harmonicc_pos", "harmonicc_val", "pr_pos", "pr_val", "host_rev", "n_hosts"]; }
    const f = line.split("\t");
    const host = f[cols.indexOf("host_rev")] ?? f[4];
    if (want.has(host)) rank.set(host, { harmonicPos: Number(f[cols.indexOf("harmonicc_pos")] ?? f[0]), pageRankPos: Number(f[cols.indexOf("pr_pos")] ?? f[2]) });
  });
  const linkersOf = new Map();
  const results = [...targets.entries()].map(([r, t]) => {
    if (t.id == null) return { domain: t.domain, inGraph: false, note: "not in this Common Crawl release (too few links or not crawled)" };
    const linking = [...(inbound.get(t.id) || [])].map((id) => names.get(id)).filter(Boolean).map((n) => ({ domain: unrev(n), ...rank.get(n) })).sort((x, y) => (x.harmonicPos ?? 9e9) - (y.harmonicPos ?? 9e9));
    linkersOf.set(t.domain, new Set(linking.map((l) => l.domain)));
    return { domain: t.domain, role: t.domain === rev(target).split(".").reverse().join(".") ? "target" : "competitor", inGraph: true, hosts: t.hosts, ...rank.get(r), linkingDomains: linking.length, strongestLinkingDomains: linking.slice(0, top) };
  });
  // Link gap: domains that link to at least 2 competitors and not to the target, strongest first.
  const tDomain = results[0]?.domain;
  const mine = linkersOf.get(tDomain) || new Set();
  const counts = new Map();
  for (const c of results.filter((r) => r.role === "competitor" && r.inGraph)) for (const d of linkersOf.get(c.domain)) if (!mine.has(d)) counts.set(d, (counts.get(d) || 0) + 1);
  const rankOf = (d) => rank.get(rev(d))?.harmonicPos ?? 9e9;
  const gap = [...counts.entries()].filter(([, n]) => n >= 2).map(([domain, n]) => ({ domain, linksToCompetitors: n, harmonicPos: rank.get(rev(domain))?.harmonicPos })).sort((a, b) => b.linksToCompetitors - a.linksToCompetitors || rankOf(a.domain) - rankOf(b.domain)).slice(0, 100);
  const doc = { fetchedAt: new Date().toISOString(), source: `Common Crawl web graph ${release} (domain level)`, release, cacheDir, target: tDomain, results, linkGap: gap,
    note: "Distinct linking DOMAINS Common Crawl saw in this release, not every link on the web; compare sites with each other, not as absolute numbers." };
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 1) + "\n");
  const md = [`# Authority: Common Crawl web graph ${release} (domain level), ${doc.fetchedAt.slice(0, 10)}`, "",
    "| Domain | Role | Linking domains | Strength rank (harmonic, 1 = strongest) | PageRank rank | Strongest 5 linking domains |", "|---|---|---|---|---|---|",
    ...results.map((r) => r.inGraph ? `| ${r.domain} | ${r.role} | ${r.linkingDomains} | ${r.harmonicPos?.toLocaleString("en-US") ?? "-"} | ${r.pageRankPos?.toLocaleString("en-US") ?? "-"} | ${r.strongestLinkingDomains.slice(0, 5).map((l) => l.domain).join(", ")} |` : `| ${r.domain} | ${r.domain === tDomain ? "target" : "competitor"} | not in graph | - | - | - |`),
    "", `Link gap (link to 2+ competitors, not to ${tDomain}): ${gap.length ? gap.slice(0, 20).map((g) => `${g.domain} (${g.linksToCompetitors})`).join(", ") : "none found"}`, "", doc.note];
  fs.writeFileSync(out.replace(/\.json$/i, "") + ".md", md.join("\n") + "\n");
  for (const r of results) console.log(`${r.domain}: ${r.inGraph ? `${r.linkingDomains} linking domains, harmonic rank ${r.harmonicPos ?? "-"}` : "not in graph"}`);
  console.log(`link gap: ${gap.length} domains; wrote ${out}`);
  return doc;
}

// isMain, not "argv[1] ends with authority.mjs": that also matched test-authority.mjs (and any other *authority.mjs that imports this
// file through doctor.mjs or measure.mjs) and ran this CLI with the wrong arguments; and an exact compare missed a junction start.
if (isMain(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const all = (k) => a.flatMap((x, i) => (x === k ? [a[i + 1]] : []));
  const out = a[0];
  const target = opt("--target");
  if (!out || out.startsWith("--") || !target) { console.error("usage: node authority.mjs <out.json> --target <domain> [--competitor <domain>]... [--release id] [--cache DIR] [--top 30]"); process.exit(2); }
  const cacheDir = opt("--cache") || defaultCache();
  const release = opt("--release") || cachedRelease(cacheDir);
  if (!release) { console.error(`BLOCKED: no complete Common Crawl release in the cache (${cacheDir || "no cache set"}); pass --release <id> to download one (about 11 GB).`); process.exit(3); }
  const top = Number(opt("--top") || 30);
  if (!Number.isInteger(top) || top < 1) { console.error(`--top must be a whole number of at least 1 (got ${opt("--top")})`); process.exit(2); }
  console.log(`release ${release}; cache ${cacheDir}`);
  // a failure names the file and the step; exitCode, not process.exit(), so an aborted download can close cleanly (Windows libuv assert)
  try { await authority({ out, release, cacheDir, top, target, competitors: all("--competitor") }); }
  catch (e) { console.error(`FAILED: ${e.message}`); process.exitCode = 1; }
}
