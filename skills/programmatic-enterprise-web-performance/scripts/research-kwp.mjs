// Google Ads Keyword Planner CSV importer (free Google Ads account; the owner exports "Keyword ideas" as CSV and gives us the file).
// Free accounts show volume RANGES ("1K - 10K"): a range becomes a sourced number with estimate:true (value = midpoint, range kept).
// Usage: node research-kwp.mjs <target> --file export.csv [--file more.csv] [--dir DIR (default <pewp>/inputs/keyword-planner)] [--cwd DIR]
// Reads UTF-16 (the Google export default) or UTF-8, tab or comma separated, with Google's preamble lines. Never invents: a row
// without a parseable volume keeps volume:null with source "NOT MEASURED". The file is copied into <pewp>/cache/keyword-planner/.
// Output: research/kwp.json { files:[...], keywords:[{query, volume, value, competition}] }. No file => BLOCKED (exit 3).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Blocked, context, needBusiness, runCli, writeStep, writeBlocked, factor, notMeasured, parseRange, mid, normQuery } from "./research-lib.mjs";

const UNBLOCK = "in Google Ads > Tools > Keyword Planner > Discover new keywords, enter the seeds, set the location to the business market, download 'Keyword ideas' as CSV, and give its path (--file) or drop it in <pewp>/inputs/keyword-planner/";

export function decodeFile(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf.length > 3 && buf[1] === 0 && buf[3] === 0) return buf.toString("utf16le"); // UTF-16LE without a BOM
  return buf.toString("utf8");
}
export function splitRow(line, delim) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
export function parseKeywordPlanner(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const hi = lines.findIndex((l) => /^"?keyword"?[\t,]/i.test(l.trim()));
  if (hi < 0) throw new Error("no header row starting with 'Keyword' (is this a Keyword Planner export?)");
  const delim = lines[hi].includes("\t") ? "\t" : ",";
  const head = splitRow(lines[hi], delim).map((h) => h.toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const c = { kw: 0, vol: col(/^avg\.? monthly searches/), comp: col(/^competition$/), compIdx: col(/competition \(indexed/), lo: col(/top of page bid \(low/), hi: col(/top of page bid \(high/), cur: col(/^currency/) };
  if (c.vol < 0) throw new Error("no 'Avg. monthly searches' column");
  const dateLine = lines.slice(0, hi).join(" ").match(/(\d{4}-\d{2}-\d{2})/);
  const rows = [];
  for (const l of lines.slice(hi + 1)) {
    if (!l.trim()) continue;
    const f = splitRow(l, delim);
    const kw = normQuery(f[c.kw]);
    if (!kw) continue;
    const money = (s) => { const n = Number(String(s ?? "").replace(/[^0-9.]/g, "")); return s && Number.isFinite(n) && n > 0 ? n : null; };
    const lo = c.lo >= 0 ? money(f[c.lo]) : null, hi2 = c.hi >= 0 ? money(f[c.hi]) : null;
    rows.push({ query: kw, range: parseRange(f[c.vol]), rawVolume: f[c.vol] ?? "", competition: c.comp >= 0 ? f[c.comp] || null : null, competitionIndex: c.compIdx >= 0 ? Number(f[c.compIdx]) || null : null,
      bid: lo != null || hi2 != null ? { low: lo, high: hi2, currency: c.cur >= 0 ? f[c.cur] || "USD" : "USD" } : null });
  }
  return { exportDate: dateLine ? dateLine[1] : null, rows };
}

export async function run(ctx, { files = [], dir = null } = {}) {
  needBusiness(ctx);
  const inDir = dir || path.join(ctx.pewp, "inputs", "keyword-planner");
  const all = [...files];
  if (!all.length && fs.existsSync(inDir)) all.push(...fs.readdirSync(inDir).filter((f) => /\.(csv|tsv|txt)$/i.test(f)).map((f) => path.join(inDir, f)));
  if (!all.length) { writeBlocked(ctx, "kwp", UNBLOCK); throw new Blocked(UNBLOCK); }
  const keywords = new Map(), used = [];
  for (const file of all) {
    if (!fs.existsSync(file)) throw new Blocked(`${file} does not exist: ${UNBLOCK}`);
    const buf = fs.readFileSync(file);
    const parsed = parseKeywordPlanner(decodeFile(buf));
    const copy = path.join(ctx.pewp, "cache", "keyword-planner", `${createHash("sha256").update(buf).digest("hex").slice(0, 12)}-${path.basename(file)}`);
    fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.writeFileSync(copy, buf);
    const fetchedAt = parsed.exportDate ? `${parsed.exportDate}T00:00:00.000Z` : fs.statSync(file).mtime.toISOString();
    const f = factor(`Google Ads Keyword Planner export ${path.basename(file)} (owner-supplied; location = business market ${ctx.market.country})`, fetchedAt, copy, { location: ctx.market.country });
    used.push({ file, cacheFile: copy, exportDate: parsed.exportDate, rows: parsed.rows.length });
    for (const r of parsed.rows) {
      const isRange = r.range && r.range.lo !== r.range.hi;
      const row = {
        query: r.query,
        volume: r.range ? f(mid(r.range), { estimate: isRange, range: [r.range.lo, r.range.hi], unit: "average monthly searches (Keyword Planner)" }) : { ...notMeasured(`Keyword Planner gave no volume for this row ("${r.rawVolume}")`), cacheFile: copy },
        value: r.bid && (r.bid.low != null || r.bid.high != null) ? f(Math.round(((r.bid.low ?? r.bid.high) + (r.bid.high ?? r.bid.low)) / 2 * 100) / 100, { estimate: true, unit: `${r.bid.currency} per click, midpoint of the top-of-page bid range`, range: [r.bid.low, r.bid.high] }) : null,
        competition: r.competition, // advertiser competition, NOT SEO difficulty: never used as difficulty
      };
      const prev = keywords.get(r.query);
      if (!prev || (row.volume.value ?? -1) > (prev.volume.value ?? -1)) keywords.set(r.query, row); // later/larger file wins on a duplicate
    }
  }
  return writeStep(ctx, "kwp", { files: used, keywords: [...keywords.values()] });
}

await runCli(import.meta.url, "node research-kwp.mjs <target> --file export.csv [--dir DIR] [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { files: a.all("file"), dir: a.get("dir") });
  return `OK kwp: ${r.keywords.length} keywords from ${r.files.length} file(s), ${r.keywords.filter((k) => k.volume.estimate).length} volumes are ranges (estimate) -> ${path.join(ctx.rdir, "kwp.json")}`;
});
