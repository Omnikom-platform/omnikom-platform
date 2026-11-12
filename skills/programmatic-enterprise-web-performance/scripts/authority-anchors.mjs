// Usage: node authority-anchors.mjs <pewp-dir> [--authority FILE] [--out-dir DIR] [--cache DIR] [--k 20] [--referrers 25] [--blocks 3] [--max-requests 600]
//        [--gap-ms 3000] [--crawls 1 | --crawl CC-MAIN-YYYY-WW]... [--keyword "business loans"]... [--min-free-gb 15]
// Anchor text and link types (follow, nofollow, ugc, sponsored) of the links that point at a target and at its competitors, read from
// Common Crawl's own copies of the referring pages. authority.mjs says WHICH domains link and how strong they are (domain graph);
// this step says HOW. ONE route, every request to data.commoncrawl.org (the index host index.commoncrawl.org dropped every connection
// on 2026-11-11, so it is not used at all):
//   1. the crawl's cluster.idx (about 0.1 GB: the first key, shard, offset and length of every 3,000-line block of the CDX index) is
//      downloaded once and cached per crawl (after a HEAD for its size and a free-disk check);
//   2. for a referring domain R, a binary search on R's SURT key (com,example) finds the blocks that hold R's pages; up to --blocks of them
//      (the first, then evenly spread) are read by byte range and decompressed, and the filter runs here, in code;
//   3. pages are chosen from those records, best first: (a) a URL holding a target's brand name (a review or profile of that business),
//      (b) a URL that suggests a lender / funding / review / list topic, (c) the home page; each is one byte-range read of its WARC record;
//   4. the HTML is parsed for links to the targets. One page read serves every target it links to.
// The WAT files hold the same links but have no per-record offsets (reading one means scanning terabytes): not used.
// Budgets: K pages and --blocks index blocks per referring domain, referring domains per target, requests per run (every request counts,
// cache hits do not; HARD CAP 600, the cluster.idx download counts as one), a gap between requests (>= 3 s). ONE 403, 429 or 503, or ONE dropped
// connection, stops the run and writes a 24 h stop file (~/.claude/state/omnikom-stops/commoncrawl.json, the shared stop format of lib-stops.mjs): no run
// starts while it is in force (exit 3). Five index-block reads failing in a row (a 500, a bad range) stop it too (an unreachable index is never
// "no pages"). The part read is written. Every response is cached on disk. Why so slow: index.commoncrawl.org dropped every request from this
// machine from 03:59 to 04:12 (UTC+2) on 2026-11-11, cause unknown, possibly throttling at our 1 s pace; that drop is our signal to slow down.
// Nothing here ever requests a referring site. Honest scope: a domain's pages are SAMPLED (N of M blocks, said in every coverage line);
// "not found in the pages sampled" is never "does not link".
// Writes <out-dir>/anchors.json and anchors.md (default <pewp>/authority/). Cache: --cache, else machine.local.json "seoKitCache"/anchors,
// else <pewp>/cache/anchors. Exit 0 written (also when the request budget ended it, and when Common Crawl or an unreachable index stopped the run: the partial result is
// written and the last line is `PARTIAL: <why>; what was read is kept, run again to continue`), 1 failed, 2 usage, 3 BLOCKED (no authority.json, free disk below the floor,
// or a 24 h stop in force).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isMain } from "./lib-main.mjs";
import { isStopped, writeStop } from "./lib-stops.mjs"; // the skill's one stop format: ~/.claude/state/omnikom-stops/commoncrawl.json
import { pace, J } from "./research-lib.mjs";
import { numArg, politeMs, UsageError, isLocalUrl } from "./lib-polite.mjs";
import { decode, visibleText, hostIs, hostOf } from "./authority-lib.mjs";

const dataBase = () => (process.env.PEWP_CC_DATA || "https://data.commoncrawl.org").replace(/\/+$/, "");
const UA = `PEWP-Anchors/1.0 (Common Crawl copies only, read-only, GET; contact ${process.env.PEWP_CONTACT || "see skill"})`;
// Hosts the owner has ruled out for every step of the work (work order 42). They are never a referring domain we read about.
export const DENY_HOSTS = ["help.followupboss.com", "help.lofty.com", "www.sierrainteractive.com", "www.luxurypresence.com", "www.zillow.com", "developer.salesforce.com", "help.wealthbox.com", "agencyheight.com"];
const denied = (d) => DENY_HOSTS.some((h) => hostIs(d, h.replace(/^www\./, "")) || hostIs(h.replace(/^www\./, ""), d));
const WARC_NAME = /^crawl-data\/[A-Za-z0-9._\-\/]+\.warc\.gz$/;
const okFile = (f) => WARC_NAME.test(String(f)) && !String(f).includes(".."); // a record is read only from a crawl-data path on the data host
const okShard = (f) => /^cdx-\d{5}\.gz$/.test(String(f)); // an index block is read only from a cdx-NNNNN.gz shard of the crawl
const okCrawl = (c) => /^CC-MAIN-\d{4}-\d{2}$/.test(String(c));
const INDEX_FAILS_STOP = 5; // this many index-block reads failing in a row (not "nothing found") is an unreachable index, not five empty domains
export const HARD_CAP = 600; // requests per run, never more (the head of operations, 2026-11-11)
export const MIN_GAP_MS = 3000; // the gap to data.commoncrawl.org, never shorter for the real host
export const INCIDENT = "index.commoncrawl.org dropped every request from this machine from 03:59 to 04:12 (UTC+2) on 2026-11-11, cause unknown, possibly throttling at our 1 s pace. This step uses only data.commoncrawl.org, at a gap of 3 s or more, and stops for 24 h on one 403, 429, 503 or dropped connection.";
const MAX_RECORD = 3_000_000; // a WARC record longer than this is not read
const TOPIC = "lender|lending|funding|fund|loan|financ|capital|credit|review|best|top-|compar|alternativ|-vs-|list|directory|resource|partner|rank|guide|merchant|advance";

class Stop extends Error { constructor(msg, kind, status = null) { super(msg); this.kind = kind; this.status = status; } }

// ------------------------------------------------------------------------------------------------ html -> links
const attrOf = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null; };
const GENERIC = new Set(["click here", "here", "read more", "learn more", "more", "website", "visit website", "visit site", "visit", "site", "link", "source", "this", "this site", "this website", "this link", "go", "homepage", "home", "check it out", "official site", "official website", "view", "read", "see more", "continue reading", "details", "find out more", "via", "link to website"]);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const SUFFIX_WORDS = /(capital|funding|group|finance|financial|loans?|lending|inc|llc|corp|co|holdings|partners)$/;

// The ways a business is named in an anchor: the domain label, the whole domain, the label without a trailing "capital" / "funding" / ...
export function brandForms(domain, extra = []) {
  const label = String(domain).toLowerCase().replace(/^www\./, "").split(".").slice(0, -1).join("."), forms = new Set([norm(label), norm(domain)]);
  const bare = norm(label).replace(SUFFIX_WORDS, ""); if (bare.length >= 4) forms.add(bare);
  for (const e of extra) if (norm(e).length >= 3) forms.add(norm(e));
  return [...forms].filter(Boolean);
}
// brand | exact (a keyword given with --keyword) | partial (brand or keyword inside longer text) | url | generic | image | empty | other
export function classifyAnchor(text, isImage, { domain, keywords = [], brands = [] }) {
  if (isImage) return "image";
  const t = String(text || "").trim(), n = norm(t);
  if (!n) return "empty";
  if (/^(https?:\/\/|www\.)/i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(t)) return "url";
  if (GENERIC.has(t.toLowerCase().replace(/[.!:>»]+$/g, "").trim())) return "generic";
  const forms = brandForms(domain, brands);
  if (forms.includes(n)) return "brand";
  const kws = keywords.map(norm).filter(Boolean);
  if (kws.includes(n)) return "exact";
  if (forms.some((f) => f.length >= 4 && n.includes(f)) || kws.some((k) => n.includes(k))) return "partial";
  return "other";
}
function placementAt(tokens, idx) {
  const stack = [];
  for (const k of tokens) { if (k.i > idx) break; if (!k.close) stack.push(k.tag); else { const at = stack.lastIndexOf(k.tag); if (at >= 0) stack.splice(at, 1); } }
  return stack.includes("footer") ? "footer" : stack.includes("nav") ? "nav" : stack.includes("header") ? "header" : stack.includes("aside") ? "aside" : "body";
}
// Every link on the page that points at one of the targets (the target's own domain or a subdomain of it, never a look-alike host).
export function extractLinks(html, pageUrl, targets, { keywords = [], brands = {} } = {}) {
  const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => ((attrOf(m[0], "name") || "").toLowerCase() === "robots" || (attrOf(m[0], "name") || "").toLowerCase() === "googlebot") ? (attrOf(m[0], "content") || "") : "").join(",").toLowerCase();
  const pageNofollow = /\bnofollow\b|\bnone\b/.test(robots);
  const tokens = [...html.matchAll(/<(\/?)(nav|footer|header|aside)\b[^>]*>/gi)].map((m) => ({ i: m.index, close: !!m[1], tag: m[2].toLowerCase() }));
  const out = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attrOf(m[1], "href");
    if (!href || /^(javascript:|#|tel:|mailto:|data:)/i.test(href.trim())) continue;
    let abs; try { abs = new URL(href.trim(), pageUrl); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    const h = abs.hostname.toLowerCase().replace(/^www\./, "");
    const target = targets.find((t) => hostIs(h, t));
    if (!target) continue;
    const rel = (attrOf(m[1], "rel") || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
    const type = rel.includes("sponsored") ? "sponsored" : rel.includes("ugc") ? "ugc" : rel.includes("nofollow") || pageNofollow ? "nofollow" : "follow";
    let text = visibleText(m[2]).slice(0, 160), image = false;
    const img = m[2].match(/<img\b[^>]*>/i);
    if (!text && img) { image = true; text = (attrOf(img[0], "alt") || "").trim().slice(0, 160); }
    if (!text && !image) text = (attrOf(m[1], "aria-label") || attrOf(m[1], "title") || "").trim().slice(0, 160);
    out.push({ target, href: abs.href, anchor: text, kind: classifyAnchor(text, image, { domain: target, keywords, brands: brands[target] || [] }), rel, type, placement: placementAt(tokens, m.index), pageNofollow });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ WARC record -> html
const dechunk = (b) => { const parts = []; let p = 0; for (;;) { const e = b.indexOf("\r\n", p); if (e < 0) break; const n = parseInt(b.subarray(p, e).toString("latin1").split(";")[0], 16); if (!Number.isFinite(n) || n <= 0) break; parts.push(b.subarray(e + 2, e + 2 + n)); p = e + 2 + n + 2; } return Buffer.concat(parts); };
export function parseWarcRecord(gz) {
  let raw = zlib.gunzipSync(gz, { maxOutputLength: 12_000_000 });
  const a = raw.indexOf("\r\n\r\n"); if (a < 0) return null;
  if (!/WARC-Type:\s*response/i.test(raw.subarray(0, a).toString("latin1"))) return null;
  const b = raw.indexOf("\r\n\r\n", a + 4); if (b < 0) return null;
  const head = raw.subarray(a + 4, b).toString("latin1"); let body = raw.subarray(b + 4);
  if (/^transfer-encoding:\s*chunked/im.test(head)) body = dechunk(body);
  if (body[0] === 0x1f && body[1] === 0x8b) { try { body = zlib.gunzipSync(body, { maxOutputLength: 12_000_000 }); } catch {} }
  const cs = ((head.match(/^content-type:.*?charset=["']?([\w-]+)/im) || [])[1] || (body.subarray(0, 2048).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8").toLowerCase();
  let html; try { html = new TextDecoder(cs).decode(body); } catch { html = body.toString("utf8"); }
  return { status: Number((head.match(/^HTTP\/[\d.]+\s+(\d+)/) || [])[1] || 0), html };
}

// ------------------------------------------------------------------------------------------------ which crawls
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function releaseWindow(release) { // "cc-main-2026-aug-sep-oct" -> months of 2026 (a window that wraps the year rolls into the next)
  const m = String(release || "").match(/(\d{4})-((?:[a-z]{3}-?)+)/i); if (!m) return null;
  const idx = m[2].toLowerCase().split("-").filter(Boolean).map((x) => MONTHS.indexOf(x)).filter((i) => i >= 0); if (!idx.length) return null;
  let y = Number(m[1]), prev = idx[0]; const set = new Set();
  for (const i of idx) { if (i < prev) y++; prev = i; set.add(`${y}-${i}`); }
  return set;
}
export function pickCrawls(collinfo, release, n) {
  const win = releaseWindow(release), list = (Array.isArray(collinfo) ? collinfo : []).map((c) => {
    const mm = String(c.name || "").match(/([A-Za-z]+)\s+(\d{4})/); const mi = mm ? MONTHS.indexOf(mm[1].slice(0, 3).toLowerCase()) : -1;
    return { id: c.id, key: mm && mi >= 0 ? `${mm[2]}-${mi}` : null, order: mm && mi >= 0 ? Number(mm[2]) * 12 + mi : 0, name: c.name };
  }).filter((c) => /^CC-MAIN-/.test(c.id || "")).sort((x, y) => y.order - x.order);
  const inside = win ? list.filter((c) => c.key && win.has(c.key)) : [];
  if (inside.length) return { crawls: inside.slice(0, n).map((c) => c.id), note: `crawls inside the graph release window (${release})` };
  return { crawls: list.slice(0, n).map((c) => c.id), note: `no crawl of the collection list falls inside the graph release window (${release}): the newest crawl is read instead` };
}

// The data host's own list of crawls (cc-index/collections/index.html): each row has the id and the month, e.g. CC-MAIN-2026-43 / October 2026.
export function parseCrawlListing(html) {
  const out = [];
  for (const m of String(html).matchAll(/crawl-data\/(CC-MAIN-\d{4}-\d{2})\/index\.html[^<]*<\/a>\s*<\/td>\s*<td><a [^>]*>([A-Za-z]+ \d{4})<\/a>/g)) out.push({ id: m[1], name: `${m[2]} Index` });
  return out;
}

// ------------------------------------------------------------------------------------------------ the CDX index, read from cluster.idx
export const surtOf = (domain) => String(domain).toLowerCase().replace(/^www\./, "").split(".").reverse().join(","); // lendio.com -> com,lendio
// cluster.idx: one line per block of the index, "<SURT key> <timestamp>\t<shard>\t<offset>\t<length>\t<n>" (the key of the block's first record)
export function parseCluster(text) {
  const blocks = [];
  for (const l of String(text).split("\n")) {
    if (!l) continue; const t = l.split("\t"); if (t.length < 4) continue;
    const sp = t[0].lastIndexOf(" "); blocks.push({ key: sp > 0 ? t[0].slice(0, sp) : t[0], file: t[1], off: Number(t[2]), len: Number(t[3]) });
  }
  return blocks;
}
// All of a domain's records (the domain and its subdomains) sort between "com,lendio)" and "com,lendio-" (")" < "," < "-"); the blocks that can
// hold them run from the last block starting before the first key to the last block starting before the end key.
export function blockSpan(blocks, domain) {
  const lastBelow = (x) => { let a = 0, b = blocks.length - 1, r = -1; while (a <= b) { const m = (a + b) >> 1; if (blocks[m].key < x) { r = m; a = m + 1; } else b = m - 1; } return r; };
  const s = surtOf(domain), i0 = Math.max(0, lastBelow(`${s})`)), i1 = Math.max(i0, lastBelow(`${s}-`));
  return [i0, i1];
}
// At most `cap` blocks of the span: the first (the home page and early paths sort first), then evenly spread over the rest.
export function sampleBlocks(i0, i1, cap) {
  const n = i1 - i0 + 1;
  if (n <= cap) return Array.from({ length: n }, (_, i) => i0 + i);
  const picks = new Set([i0]); for (let j = 1; j < cap; j++) picks.add(i0 + Math.round((j * (n - 1)) / (cap - 1)));
  return [...picks].sort((a, b) => a - b);
}
// The HTML pages (status 200) of one domain in a decompressed index block, as the rows the page step reads.
export function blockRows(text, domain) {
  const s = surtOf(domain), p1 = `${s})`, p2 = `${s},`, rows = [];
  for (const line of String(text).split("\n")) {
    const sp = line.indexOf(" "); if (sp < 0) continue;
    const key = line.slice(0, sp); if (!key.startsWith(p1) && !key.startsWith(p2)) continue;
    let j; try { j = JSON.parse(line.slice(line.indexOf("{"))); } catch { continue; }
    if (!j || !j.url || String(j.status) !== "200" || !/html/i.test(j.mime || j["mime-detected"] || "")) continue;
    rows.push({ url: j.url, filename: j.filename, offset: j.offset, length: j.length, status: j.status, mime: j.mime });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ the polite Common Crawl client
const dropped = (url, e) => new Stop(`the connection to ${url} was dropped (${String(e.cause?.code || e.name === "TimeoutError" ? "timeout" : e.message || e).slice(0, 80)}): the run stops here and stays stopped for 24 h`, "dropped");
function makeClient({ pewp, cacheDir, gapMs, maxRequests }) {
  const dir = cacheDir, stats = { requests: 0, listing: 0, cluster: 0, blocks: 0, pages: 0, cached: 0, indexErrors: 0 };
  const spend = async (url, kind) => {
    if (stats.requests >= maxRequests) throw new Stop(`request budget of ${maxRequests} reached`, "budget");
    await pace(isLocalUrl(url) ? url : "https://commoncrawl.org/", gapMs); // one gap for every request to Common Crawl
    stats.requests++; stats[kind]++;
  };
  const limited = async (res, url) => { if (res.status === 429 || res.status === 503 || res.status === 403) { try { await res.body?.cancel(); } catch {} throw new Stop(`Common Crawl answered ${res.status} for ${url}: the run stops here`, `http-${res.status}`, res.status); } };
  async function get(url, { range = null, kind }) {
    const file = path.join(dir, crypto.createHash("sha256").update(`${url} ${range || ""}`).digest("hex").slice(0, 28) + ".bin");
    if (fs.existsSync(file) && fs.statSync(file).size > 0) { stats.cached++; return { status: 200, body: fs.readFileSync(file), fromCache: true }; }
    await spend(url, kind);
    let res;
    try { res = await fetch(url, { headers: { "user-agent": UA, ...(range ? { range: `bytes=${range}` } : {}) }, signal: AbortSignal.timeout(60000) }); }
    catch (e) { throw dropped(url, e); }
    await limited(res, url);
    if (range && res.status !== 206) { try { await res.body?.cancel(); } catch {} return { status: res.status, error: "the byte range was not honoured" }; } // never read a whole multi-GB file
    const body = Buffer.from(await res.arrayBuffer());
    if (res.status === 200 || res.status === 206) {
      fs.mkdirSync(dir, { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, body);
      try { fs.renameSync(tmp, file); } catch { try { fs.rmSync(tmp, { force: true }); } catch {} }
    }
    return { status: res.status, body };
  }
  async function head(url, kind) {
    await spend(url, kind);
    let res; try { res = await fetch(url, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) }); } catch (e) { throw dropped(url, e); }
    await limited(res, url);
    return { status: res.status, length: Number(res.headers.get("content-length")) };
  }
  // One streamed download to <file> (a .part file, renamed only when the byte count matches what the HEAD said).
  async function download(url, file, length, kind) {
    await spend(url, kind);
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30 * 60000) }).catch((e) => { throw dropped(url, e); });
    await limited(res, url);
    if (res.status !== 200) { try { await res.body?.cancel(); } catch {} throw new Error(`${url}: HTTP ${res.status}`); }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const part = `${file}.part`;
    try { await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part)); } catch (e) { fs.rmSync(part, { force: true }); throw dropped(url, e); }
    const got = fs.statSync(part).size;
    if (got !== length) { fs.rmSync(part, { force: true }); throw new Error(`${url}: got ${got} bytes, the HEAD said ${length}: not kept`); }
    fs.renameSync(part, file); fs.writeFileSync(`${file}.done`, String(length));
  }
  return { get, head, download, stats };
}
const freeGb = (p) => { try { const s = fs.statfsSync(p); return (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3; } catch { return Infinity; } };
export function defaultCluster(pewp) {
  try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "machine.local.json"), "utf8")).seoKitCache; if (c) return path.join(c, "anchors"); } catch {}
  return path.join(pewp, "cache", "anchors");
}
// The crawl's cluster.idx on disk: already there and complete, or HEAD (size), free-disk check, one download.
async function ensureCluster(client, crawl, cacheDir, minFreeGb) {
  const file = path.join(cacheDir, `${crawl}-cluster.idx`), done = `${file}.done`;
  if (fs.existsSync(file) && fs.existsSync(done) && fs.statSync(file).size === Number(fs.readFileSync(done, "utf8"))) { client.stats.cached++; return file; }
  const url = `${dataBase()}/cc-index/collections/${crawl}/indexes/cluster.idx`;
  const h = await client.head(url, "cluster");
  if (h.status !== 200 || !(h.length > 0)) throw new Error(`${url}: the HEAD answered ${h.error || `HTTP ${h.status}`}${h.length ? "" : " with no size"}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const free = freeGb(cacheDir), need = Math.max(minFreeGb, (3 * h.length) / 1024 ** 3);
  if (free < need) { const e = new Error(`BLOCKED: ${free.toFixed(1)} GB free where the cache is (${cacheDir}), below the ${need.toFixed(1)} GB needed for cluster.idx (${(h.length / 1024 ** 2).toFixed(0)} MB); unblocks: free disk space or --cache on a bigger drive`); e.blocked = true; throw e; }
  await client.download(url, file, h.length, "cluster");
  return file;
}
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ------------------------------------------------------------------------------------------------ the run
export async function runAnchors({ pewp, authorityFile, outDir, cacheDir, k = 20, referrers = 25, blocks: blockCap = 3, maxRequests = HARD_CAP, gapMs = MIN_GAP_MS, crawlsN = 1, crawls = [], keywords = [], minFreeGb = 15, log = console.log }) {
  k = numArg("--k", k, { def: 20, min: 1, int: true }); referrers = numArg("--referrers", referrers, { def: 25, min: 1, int: true }); blockCap = numArg("--blocks", blockCap, { def: 3, min: 1, int: true });
  maxRequests = numArg("--max-requests", maxRequests, { def: HARD_CAP, min: 1, int: true }); if (maxRequests > HARD_CAP) throw new UsageError(`--max-requests ${maxRequests} is above the hard cap of ${HARD_CAP} requests per run`); crawlsN = numArg("--crawls", crawlsN, { def: 1, min: 1, int: true }); minFreeGb = numArg("--min-free-gb", minFreeGb, { def: 15, min: 0 });
  gapMs = politeMs("--gap-ms", numArg("--gap-ms", gapMs, { def: MIN_GAP_MS, min: 0 }), [dataBase()], MIN_GAP_MS);
  for (const c of crawls) if (!okCrawl(c)) throw new UsageError(`--crawl ${JSON.stringify(c)} is not a crawl id like CC-MAIN-2026-43`);
  authorityFile ||= path.join(pewp, "authority.json"); outDir ||= path.join(pewp, "authority"); cacheDir ||= defaultCluster(pewp);
  const auth = J(authorityFile);
  if (!auth || !Array.isArray(auth.results)) { const e = new Error(`BLOCKED: ${authorityFile} is missing or has no results; unblocks: run authority.mjs for this site first`); e.blocked = true; throw e; }
  const inForce = isStopped("commoncrawl"); // before anything is requested
  if (inForce) { const e = new Error(`BLOCKED: Common Crawl stopped us until ${inForce.until}: ${inForce.reason}; unblocks: wait for that time (or the head of operations deletes ${inForce.file})`); e.blocked = true; throw e; }
  const client = makeClient({ pewp, cacheDir, gapMs, maxRequests });
  const targets = auth.results.map((r) => ({ domain: r.domain, role: r.role || (r.domain === auth.target ? "target" : "competitor"), inGraph: !!r.inGraph, referrers: r.strongestLinkingDomains || [] }));
  const inGraph = targets.filter((t) => t.inGraph);
  // per-target queue of referring domains: its own strongest linking domains, plus (competitors only) the link-gap domains, strongest first
  const gap = auth.linkGap || [];
  const queues = new Map();
  for (const t of inGraph) {
    const rows = new Map(t.referrers.map((r) => [r.domain, r.harmonicPos ?? 9e9]));
    if (t.role !== "target") for (const g of gap) if (!rows.has(g.domain)) rows.set(g.domain, g.harmonicPos ?? 9e9);
    queues.set(t.domain, [...rows.entries()].sort((a, b) => a[1] - b[1]).map(([d]) => d).filter((d) => !targets.some((x) => x.domain === d)).slice(0, referrers));
  }
  const skipped = [], plan = new Map(); // R -> targets it is a candidate for
  const order = []; for (let i = 0; i < referrers; i++) for (const t of inGraph) { const d = queues.get(t.domain)[i]; if (!d) continue; if (denied(d)) { if (!skipped.some((s) => s.domain === d)) skipped.push({ domain: d, why: "on the owner's do-not-request list" }); continue; } if (!plan.has(d)) { plan.set(d, []); order.push(d); } plan.get(d).push(t.domain); }
  const out = { fetchedAt: new Date().toISOString(), source: "Common Crawl CDX index blocks (via cluster.idx) + WARC records, all from data.commoncrawl.org (no referring site is requested)", release: auth.release || null, crawls: [], crawlNote: null,
    budget: { k, blocksPerDomain: blockCap, referringDomainsPerTarget: referrers, maxRequests, gapMs }, requests: null, stopped: null, skipped, readDomains: [], targets: {} };
  const rowsByTarget = new Map(targets.map((t) => [t.domain, []]));
  const read = new Map(); // R -> { domain, targets, pages, status, links }
  let stop = null, indexFails = 0, cur = null;
  try {
    if (inGraph.length) {
      if (crawls.length) { out.crawls = crawls; out.crawlNote = "crawls given with --crawl"; }
      else {
        const r = await client.get(`${dataBase()}/cc-index/collections/index.html`, { kind: "listing" });
        const info = r.status === 200 || r.fromCache ? parseCrawlListing(r.body.toString("utf8")) : [];
        if (!info.length) throw new Error(`the crawl list ${dataBase()}/cc-index/collections/index.html could not be read (${r.error || `HTTP ${r.status}`}); pass --crawl CC-MAIN-YYYY-WW`);
        const p = pickCrawls(info, auth.release, crawlsN); out.crawls = p.crawls; out.crawlNote = p.note;
      }
      const clusters = new Map();
      for (const c of out.crawls) clusters.set(c, parseCluster(fs.readFileSync(await ensureCluster(client, c, cacheDir, minFreeGb), "utf8")));
      // The sampled index blocks of R: every HTML page (status 200) of R in them, and how many blocks R's pages span (sampled N of M).
      const rowsOf = async (R, rec) => {
        const rows = [];
        for (const crawl of out.crawls) {
          const [i0, i1] = blockSpan(clusters.get(crawl), R), picks = sampleBlocks(i0, i1, blockCap);
          rec.blocksTotal += i1 - i0 + 1;
          for (const bi of picks) {
            const b = clusters.get(crawl)[bi]; if (!okShard(b.file) || !(b.len > 0)) continue;
            const r = await client.get(`${dataBase()}/cc-index/collections/${crawl}/indexes/${b.file}`, { range: `${b.off}-${b.off + b.len - 1}`, kind: "blocks" });
            let text = null; if (r.body && (r.status === 200 || r.status === 206)) { try { text = zlib.gunzipSync(r.body, { maxOutputLength: 64_000_000 }).toString("utf8"); } catch {} }
            if (text == null) { // a dropped connection, a 5xx, a bad range, a block that does not decompress: NOT "nothing there"
              rec.indexErrors++; client.stats.indexErrors++;
              if (++indexFails >= INDEX_FAILS_STOP) throw new Stop(`${INDEX_FAILS_STOP} index block reads failed in a row (last: ${r.error || `HTTP ${r.status}`}): the run stops here`, "index-unreachable", r.status || null);
              continue;
            }
            indexFails = 0; rec.blocksSampled++;
            rows.push(...blockRows(text, R));
          }
        }
        return rows;
      };
      for (const R of order) {
        const cands = plan.get(R), rec = { domain: R, targets: cands, pages: 0, cdxRows: 0, pageErrors: 0, indexErrors: 0, blocksSampled: 0, blocksTotal: 0, status: null, links: 0 };
        read.set(R, rec); cur = rec;
        const forms = cands.flatMap((d) => brandForms(d).filter((f) => f.length >= 4));
        const brandRe = [...new Set(forms)].map(esc).join("|");
        const seen = new Set(), found = new Set();
        try {
          const pool = (await rowsOf(R, rec)).filter((x) => okFile(x.filename) && Number(x.length) > 0 && Number(x.length) <= MAX_RECORD);
          rec.cdxRows = pool.length;
          const tiers = [brandRe && { name: "brand-in-url", test: new RegExp(`(${brandRe})`, "i") }, { name: "topic-in-url", test: new RegExp(`(${TOPIC})`, "i") }, { name: "home", test: new RegExp(`^https?://(www\\.)?${esc(R)}/?$`, "i") }].filter(Boolean);
          for (const tier of tiers) {
            if (rec.pages >= k) break;
            if (tier.name !== "brand-in-url" && cands.every((c) => found.has(c))) break; // every target of this domain was found: more pages only cost requests
            for (const row of pool.filter((x) => tier.test.test(x.url) && !seen.has(x.url))) {
              if (rec.pages >= k) break;
              seen.add(row.url); rec.pages++;
              const off = Number(row.offset), len = Number(row.length);
              const r = await client.get(`${dataBase()}/${row.filename}`, { range: `${off}-${off + len - 1}`, kind: "pages" });
              let rc = null; try { rc = r.body ? parseWarcRecord(r.body) : null; } catch {}
              if (!rc) { rec.pageErrors++; continue; }
              for (const l of extractLinks(rc.html, row.url, cands, { keywords })) { found.add(l.target); rec.links++; rowsByTarget.get(l.target).push({ from: R, page: row.url, tier: tier.name, crawl: (row.filename.match(/CC-MAIN-[\d-]+/) || [])[0] || null, ...l, target: undefined }); }
            }
          }
        } finally { rec.status = rec.pages === 0 ? (rec.indexErrors ? "index-error" : "no-pages-sampled") : rec.links ? "links-found" : "no-link-in-sample"; rec.found = [...cands].filter((c) => rowsByTarget.get(c).some((x) => x.from === R)); log(`  ${R}: ${rec.blocksSampled} of ${rec.blocksTotal} index blocks, ${rec.pages} pages read, ${rec.links} links found (${rec.status})`); }
      }
    }
  } catch (e) { if (e instanceof Stop) stop = e; else throw e; }
  out.stopped = stop ? { kind: stop.kind, status: stop.status, message: stop.message } : null;
  if (stop && stop.kind !== "budget") writeStop({ engine: "commoncrawl", reason: stop.message, setBy: "authority-anchors.mjs", evidence: `${stop.kind}${stop.status ? ` ${stop.status}` : ""}` });
  out.incident = INCIDENT;
  out.requests = { ...client.stats };
  out.readDomains = [...read.values()].map(({ domain, targets: t, pages, cdxRows, pageErrors, indexErrors, blocksSampled, blocksTotal, status, links }) => ({ domain, targets: t, pages, cdxRows, pageErrors, indexErrors, blocksSampled, blocksTotal, status, links }));
  for (const t of targets) {
    if (!t.inGraph) { out.targets[t.domain] = { domain: t.domain, role: t.role, inGraph: false, note: "not in the Common Crawl link graph for this release (too few links or not crawled): there are no referring domains to read, so no anchors" }; continue; }
    const planned = [...plan.entries()].filter(([, ts]) => ts.includes(t.domain)).map(([d]) => d);
    const readRows = planned.map((d) => read.get(d)).filter((r) => r && r.pages > 0), links = rowsByTarget.get(t.domain).map(({ target, ...x }) => x);
    const attempted = planned.map((d) => read.get(d)).filter(Boolean), blocksSampled = attempted.reduce((n, r) => n + r.blocksSampled, 0), blocksTotal = attempted.reduce((n, r) => n + r.blocksTotal, 0);
    const withLinks = new Set(links.map((l) => l.from));
    const mix = Object.fromEntries(["brand", "exact", "partial", "url", "generic", "image", "empty", "other"].map((c) => [c, 0])); for (const l of links) mix[l.kind]++;
    const count = (ty) => links.filter((l) => l.type === ty).length, byText = new Map();
    for (const l of links) { const key = (l.anchor || (l.kind === "image" ? "(image without alt text)" : "(empty)")).toLowerCase(); byText.set(key, (byText.get(key) || 0) + 1); }
    out.targets[t.domain] = { domain: t.domain, role: t.role, inGraph: true, referringDomainsPlanned: planned.length, referringDomainsRead: readRows.length, referringDomainsWithLinks: withLinks.size, referringDomainsNotRead: planned.length - readRows.length, indexBlocksSampled: blocksSampled, indexBlocksTotal: blocksTotal,
      linksFound: links.length, follow: count("follow"), nofollow: count("nofollow"), ugc: count("ugc"), sponsored: count("sponsored"), anchorMix: mix, topAnchors: [...byText.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([anchor, n]) => ({ anchor, count: n })),
      coverage: `found links on ${withLinks.size} of ${readRows.length} referring domains read; the rest: not found in the pages sampled (sampled ${blocksSampled} of ${blocksTotal} index blocks)${planned.length > readRows.length ? ` (of ${planned.length} planned domains, ${planned.filter((d) => read.get(d)?.status === "no-pages-sampled").length} had no page in the index sample, ${planned.filter((d) => read.get(d)?.status === "index-error").length} could not be read because the index failed, and ${planned.filter((d) => !read.has(d)).length} were not reached${stop ? ` because the run stopped (${stop.kind})` : ""})` : ""}`, links };
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "anchors.json"), JSON.stringify(out, null, 1) + "\n");
  fs.writeFileSync(path.join(outDir, "anchors.md"), anchorsMd(out) + "\n");
  return out;
}

const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
export function anchorsMd(d) {
  const L = [`# Anchors and link types: Common Crawl ${d.crawls.join(", ") || "(none read)"}, ${d.fetchedAt.slice(0, 10)}`, "",
    `Source: ${d.source}. Release of the domain graph: ${d.release || "unknown"}. Crawl choice: ${d.crawlNote || "none"}.`, "",
    `Requests: ${d.requests.requests} to Common Crawl (${d.requests.listing} crawl list, ${d.requests.cluster} cluster.idx, ${d.requests.blocks} index blocks, ${d.requests.pages} pages), ${d.requests.cached} answered from the cache; cap ${d.budget.maxRequests}, ${d.budget.k} pages and ${d.budget.blocksPerDomain} index blocks per referring domain, ${d.budget.referringDomainsPerTarget} referring domains per target.`];
  L.push("", `Known incident: ${d.incident || INCIDENT}`);
  if (d.stopped) L.push("", `**Stopped early:** ${d.stopped.message}. What was read before the stop is below.`);
  L.push("", "A domain's pages are sampled (the index blocks and pages we could afford), so every count below is a lower bound. A domain with nothing found is \"not found in the pages sampled\", never a statement about the site.");
  for (const t of Object.values(d.targets)) {
    L.push("", `## ${t.domain} (${t.role})`, "");
    if (!t.inGraph) { L.push(`Not in the link graph: ${t.note}.`); continue; }
    L.push(`Coverage: ${t.coverage}.`, "",
      `Links found: ${t.linksFound}. Follow ${t.follow}, nofollow ${t.nofollow}, ugc ${t.ugc}, sponsored ${t.sponsored}.`, "",
      "| Anchor type | Links |", "|---|---|", ...Object.entries(t.anchorMix).map(([k2, n]) => `| ${k2} | ${n} |`), "");
    L.push(t.topAnchors.length ? `Top anchors: ${t.topAnchors.map((a) => `"${cell(a.anchor)}" (${a.count})`).join(", ")}` : "Top anchors: none found in the pages sampled.");
    if (t.links.length) L.push("", "| Referring domain | Anchor | Type | Where | Page |", "|---|---|---|---|---|", ...t.links.slice(0, 60).map((l) => `| ${cell(l.from)} | ${cell(l.anchor) || (l.kind === "image" ? "(image, no alt)" : "(empty)")} | ${l.type}${l.rel.length ? ` (rel ${l.rel.join(" ")})` : ""} | ${l.placement} | ${cell(l.page)} |`), ...(t.links.length > 60 ? ["", `${t.links.length - 60} more links are in anchors.json.`] : []));
  }
  return L.join("\n");
}

// ------------------------------------------------------------------------------------------------ CLI
if (isMain(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (key) => (a.includes(key) ? a[a.indexOf(key) + 1] : undefined);
  const all = (key) => a.flatMap((x, i) => (x === key ? [a[i + 1]] : []));
  const pewp = a[0];
  if (!pewp || pewp.startsWith("--")) { console.error("usage: node authority-anchors.mjs <pewp-dir> [--authority FILE] [--out-dir DIR] [--cache DIR] [--k 20] [--referrers 25] [--blocks 3] [--max-requests 600] [--gap-ms 3000] [--crawls 1 | --crawl ID]... [--keyword TEXT]... [--min-free-gb 15]"); process.exit(2); }
  try {
    const d = await runAnchors({ pewp: path.resolve(pewp), authorityFile: opt("--authority"), outDir: opt("--out-dir"), cacheDir: opt("--cache"), k: opt("--k"), referrers: opt("--referrers"), blocks: opt("--blocks"), maxRequests: opt("--max-requests"), gapMs: opt("--gap-ms"), crawlsN: opt("--crawls"), crawls: all("--crawl"), keywords: all("--keyword"), minFreeGb: opt("--min-free-gb") });
    for (const t of Object.values(d.targets)) console.log(t.inGraph ? `${t.domain}: ${t.coverage}; ${t.linksFound} links (follow ${t.follow}, nofollow ${t.nofollow})` : `${t.domain}: not in the link graph`);
    console.log(`requests ${d.requests.requests} (cached ${d.requests.cached}); wrote ${path.join(opt("--out-dir") || path.join(path.resolve(pewp), "authority"), "anchors.md")}`);
    if (d.stopped && d.stopped.kind !== "budget") console.log(`PARTIAL: ${d.stopped.message}; what was read is kept, run again to continue`);
  } catch (e) {
    if (e instanceof UsageError) { console.error(`usage: ${e.message}`); process.exitCode = 2; }
    else if (e.blocked) { console.error(e.message); process.exitCode = 3; }
    else { console.error(`FAILED: ${e.message}`); process.exitCode = 1; }
  }
}
