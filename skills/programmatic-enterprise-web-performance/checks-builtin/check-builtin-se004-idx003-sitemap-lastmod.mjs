// BUILT-IN check (copied by merge.mjs into every audit's .checks/scripts/, so it exists even when the audit found no sitemap).
// SE-004: every sitemap <lastmod> is a W3C datetime with seconds and a timezone (date-only fails) and is not in the future (> now + 1 day).
// IDX-003: the build-clock signature: >= 5 URLs of one sitemap all share one lastmod that lies within 10 minutes of the time the
// sitemap file was written (lastmod = the clock at build time, not each page's content date).
// Finds sitemap*.xml (and .xml.gz) anywhere under the root (not .git, node_modules, .checks, .pewp) and follows sitemap indexes on disk.
// Exit 0 PASS, 1 FAIL, 2 cannot judge (no sitemap built). Built-ins only, read-only.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ID = "builtin-se004-idx003";
// An uncaught error would exit 1, which run-all reads as FAIL (a defect in the site). A crash is "cannot judge" (exit 2) instead.
process.on("uncaughtException", (e) => { console.log(`ERROR ${ID} cannot judge: the check crashed: ${String(e && e.message || e).slice(0, 200)}`); process.exit(2); });
const root = path.resolve(process.argv[2] || ".");
const SKIP = new Set([".git", "node_modules", ".checks", ".pewp", ".cache"]);
const files = [];
const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); } else if (e.isFile()) files.push(p); } };
walk(root);
const relOf = (p) => path.relative(root, p).replace(/\\/g, "/");
const byRel = new Map(files.map((p) => [relOf(p), p]));
const read = (p) => { const b = fs.readFileSync(p); return /\.gz$/i.test(p) ? zlib.gunzipSync(b).toString("utf8") : b.toString("utf8"); };
const queue = [...byRel.keys()].filter((r) => /sitemap[^/]*\.xml(\.gz)?$/i.test(path.basename(r)));
const seen = new Set(), maps = [];
while (queue.length) {
  const r = queue.shift();
  if (seen.has(r) || !byRel.has(r)) continue;
  seen.add(r);
  let xml = "";
  try { xml = read(byRel.get(r)); } catch { continue; }
  const entries = [...xml.matchAll(/<(sitemap|url)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ kind: m[1].toLowerCase(), loc: ((m[2].match(/<loc>\s*([^<]+?)\s*<\/loc>/i) || [])[1] || "").trim(), lastmod: (m[2].match(/<lastmod>\s*([^<]*?)\s*<\/lastmod>/i) || [])[1] ?? null }));
  maps.push({ r, mtimeMs: fs.statSync(byRel.get(r)).mtimeMs, entries });
  for (const e of entries.filter((x) => x.kind === "sitemap" && x.loc)) {
    let pn = e.loc; try { pn = new URL(e.loc, "http://x/").pathname; } catch {}
    try { pn = decodeURIComponent(pn); } catch {} // a malformed %-escape stays as written
    pn = pn.replace(/^\/+/, "");
    const hit = byRel.has(pn) ? pn : [...byRel.keys()].find((k) => k.endsWith("/" + pn)) || [...byRel.keys()].find((k) => path.basename(k) === path.basename(pn));
    if (hit) queue.push(hit);
  }
}
if (!maps.length) { console.log(`ERROR ${ID} cannot judge: no sitemap*.xml under ${root} (build the site first; a site with no sitemap has nothing to date)`); process.exit(2); }

const now = Date.now();
const problem = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return "empty";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date-only";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return "no timezone";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return "not a W3C datetime with seconds";
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "not a valid date";
  if (t > now + 86_400_000) return "in the future";
  return null;
};
const bad = [];
let urls = 0;
for (const m of maps) {
  const us = m.entries.filter((e) => e.kind === "url");
  urls += us.length;
  for (const u of us.filter((x) => x.lastmod != null)) { const why = problem(u.lastmod); if (why) bad.push(`SE-004 ${u.loc} lastmod "${u.lastmod}" ${why} (${m.r})`); }
  if (us.length >= 5 && us.every((u) => u.lastmod)) {
    // "one lastmod": a clock read once, or once per URL (`new Date()` in the loop: milliseconds apart), so all within one minute
    const ts = us.map((u) => Date.parse(u.lastmod));
    const lo = Math.min(...ts), t = Math.max(...ts);
    const oneStamp = ts.every(Number.isFinite) && t - lo <= 60_000;
    if (oneStamp && Math.abs(t - m.mtimeMs) <= 10 * 60_000) bad.push(`IDX-003 ${m.r}: all ${us.length} URLs share one lastmod (${us[0].lastmod}, all within one minute) within 10 min of the time the sitemap was written: the build clock, not content dates`);
  }
}
if (bad.length) { console.log(`FAIL ${ID} ${bad.length} problem(s): ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "; ..." : ""}`); for (const b of bad.slice(3, 40)) console.log("  " + b); process.exit(1); }
console.log(`PASS ${ID} ${urls} URL(s) in ${maps.length} sitemap file(s): lastmod format and source look right`);
