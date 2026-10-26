// The page plan as a picture the owner can read (contract C7, brief G22).
// Usage: node plan-picture.mjs <pewp dir> [--out-dir DIR] [--today YYYY-MM-DD]
// Reads <pewp>/plan/sitemap.json (the page plan: which pages exist, under which parent, which search each targets) and
// <pewp>/targets.json (the volume of each search, by cluster id). Writes, into --out-dir (default <pewp>/plan):
//   page-plan.svg   every page as a box under its parent (home on top): path, target search, volume, NEW or EXISTING. Built as text in
//                   Node (no library), 1400 px wide, at most 6 boxes per row, long text wrapped, a legend at the bottom.
//   page-plan.md    the same as a short table: page, parent, target search, volume, new/existing.
//   page-plan.png   the SVG opened in headless Chrome (cdp-measure.mjs, a file:// URL, viewport = the SVG size, one screenshot, 60 s limit).
//                   No Chrome: prints "PNG BLOCKED: no Chrome (set CHROME_PATH); SVG and table written" and still exits 0.
// "Page plan" is the owner's word for plan/sitemap.json; it is not the sitemap file search engines read (sitemap.xml).
// Prints one line: "page plan picture: N pages, M new". Exit 0 written (PNG may be BLOCKED), 2 an input is missing or unreadable.
// No network, no model, no dependency.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";

const USAGE = "usage: node plan-picture.mjs <pewp dir> [--out-dir DIR] [--today YYYY-MM-DD]";
export const WIDTH = 1400, PER_ROW = 6, MARGIN = 30, GAP = 16, PNG_LIMIT_MS = 60000;
const BOX_W = Math.floor((WIDTH - 2 * MARGIN - (PER_ROW - 1) * GAP) / PER_ROW); // 210
const CHARS = 27;          // characters that fit one line of a box at 13 px
const FONT = "Segoe UI, Helvetica, Arial, sans-serif";

const noBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const readJson = (f) => JSON.parse(noBom(fs.readFileSync(f, "utf8")));
const esc = (x) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mdCell = (x) => String(x ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

// Wrap at spaces; a word longer than a line is cut. At most maxLines lines; the last one ends in "..." when text was dropped.
export function wrap(text, width = CHARS, maxLines = 3) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (let w of words) {
    while (w.length > width) { if (cur) { lines.push(cur); cur = ""; } lines.push(w.slice(0, width)); w = w.slice(width); }
    if (!cur) cur = w; else if ((cur + " " + w).length <= width) cur += " " + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(0, width - 3)).replace(/\s+$/, "") + "..."; return kept; }
  return lines.length ? lines : [""];
}

const num = (n) => Number(n).toLocaleString("en-US");
export function volumeText(cluster) {
  const v = cluster?.volume;
  const val = v && typeof v === "object" && "value" in v ? v.value : v;
  if (val == null || val === "") return "no number";
  const est = v && typeof v === "object" && v.estimate ? " (estimate)" : "";
  if (Array.isArray(val)) { const nums = val.filter((x) => typeof x === "number"); return nums.length === 2 ? `${num(nums[0])} to ${num(nums[1])}${est}` : nums.length === 1 ? `${num(nums[0])}${est}` : "no number"; }
  return typeof val === "number" ? `${num(val)}${est}` : "no number";
}

// ---- the tree: depth by parent chain, children in plan order ----
function layout(pages) {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const home = pages.find((p) => p.path === "/") || pages.find((p) => !p.parent) || pages[0];
  const depth = new Map();
  const depthOf = (p, seen = new Set()) => {
    if (depth.has(p.path)) return depth.get(p.path);
    if (p === home) return 0;
    if (seen.has(p.path)) return 1;                       // a loop in the plan: never hang
    seen.add(p.path);
    const par = p.parent && byPath.get(p.parent);
    const d = par && par !== p ? depthOf(par, seen) + 1 : 1; // a parent that is not a planned page: under the home
    depth.set(p.path, d);
    return d;
  };
  for (const p of pages) depth.set(p.path, depthOf(p));
  depth.set(home.path, 0);
  // order inside a level: by the parent's position in the plan, then plan order, so a parent's children sit together
  const idx = new Map(pages.map((p, i) => [p.path, i]));
  const levels = [];
  for (const p of pages) { const d = depth.get(p.path); (levels[d] ||= []).push(p); }
  for (const lvl of levels) if (lvl) lvl.sort((a, b) => (idx.get(a.parent) ?? -1) - (idx.get(b.parent) ?? -1) || idx.get(a.path) - idx.get(b.path));
  return { home, levels: levels.filter(Boolean), byPath };
}

export function buildPicture(sitemap, targets, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const pages = sitemap.pages || [];
  const clusters = new Map((targets?.clusters || []).map((c) => [c.id, c]));
  const view = pages.map((p) => {
    const c = p.cluster ? clusters.get(p.cluster) : null;
    return { path: p.path, parent: p.parent || null, search: p.primaryQuery || c?.primaryQuery || null, volume: volumeText(c), isNew: !!p.isNew };
  });
  const newCount = view.filter((p) => p.isNew).length;
  const { levels } = layout(view);

  // rows: each level cut into rows of at most PER_ROW boxes
  const rows = [];
  for (const lvl of levels) for (let i = 0; i < lvl.length; i += PER_ROW) rows.push(lvl.slice(i, i + PER_ROW));
  const TOP = 92, ROW_GAP = 46, LINE = 17;
  const boxes = new Map();
  let y = TOP;
  for (const row of rows) {
    const content = row.map((p) => ({ p, path: wrap(p.path, CHARS, 2), search: wrap(p.search ? `Target search: ${p.search}` : "Target search: none (support page)", CHARS, 4) }));
    const lines = Math.max(...content.map((c) => c.path.length + c.search.length)) + 2; // + volume + badge
    const h = 18 + lines * LINE + 10;
    const total = row.length * BOX_W + (row.length - 1) * GAP;
    let x = Math.round((WIDTH - total) / 2);
    for (const c of content) { boxes.set(c.p.path, { x, y, h, w: BOX_W, ...c }); x += BOX_W + GAP; }
    y += h + ROW_GAP;
  }
  const legendY = y - ROW_GAP + 34;
  const HEIGHT = legendY + 70;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="${FONT}">`);
  out.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`);
  out.push(`<text x="${MARGIN}" y="40" font-size="24" font-weight="700" fill="#14213d">Page plan${sitemap.business ? ": " + esc(sitemap.business) : ""}</text>`);
  out.push(`<text x="${MARGIN}" y="66" font-size="14" fill="#4a5568">${view.length} pages (${newCount} new, ${view.length - newCount} existing). Each box is one page, under the page it belongs to. ${esc(today)}</text>`);
  // connectors first (under the boxes): parent bottom -> child top, with an elbow
  for (const p of view) {
    const b = boxes.get(p.path), pb = p.parent && boxes.get(p.parent);
    if (!b || !pb || pb === b) continue;
    const x1 = pb.x + pb.w / 2, y1 = pb.y + pb.h, x2 = b.x + b.w / 2, y2 = b.y;
    out.push(`<path d="M${x1} ${y1} V${y1 + 12} H${x2} V${y2}" fill="none" stroke="#a0aec0" stroke-width="1.5" data-from="${esc(p.parent)}" data-to="${esc(p.path)}"/>`);
  }
  for (const p of view) {
    const b = boxes.get(p.path);
    const fill = p.isNew ? "#e6f6ec" : "#eef1f6", stroke = p.isNew ? "#2f855a" : "#718096";
    out.push(`<g data-page="${esc(p.path)}">`);
    out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    let ty = b.y + 22;
    for (const l of b.path) { out.push(`<text x="${b.x + 10}" y="${ty}" font-size="14" font-weight="700" fill="#14213d">${esc(l)}</text>`); ty += LINE; }
    for (const l of b.search) { out.push(`<text x="${b.x + 10}" y="${ty}" font-size="13" fill="#2d3748">${esc(l)}</text>`); ty += LINE; }
    out.push(`<text x="${b.x + 10}" y="${ty}" font-size="13" fill="#2d3748">Volume: ${esc(p.volume)}</text>`); ty += LINE;
    out.push(`<text x="${b.x + 10}" y="${ty}" font-size="13" font-weight="700" fill="${stroke}">${p.isNew ? "NEW" : "EXISTING"}</text>`);
    out.push(`</g>`);
  }
  // legend
  out.push(`<g data-legend="1">`);
  out.push(`<rect x="${MARGIN}" y="${legendY - 18}" width="22" height="16" rx="4" fill="#e6f6ec" stroke="#2f855a" stroke-width="1.5"/><text x="${MARGIN + 30}" y="${legendY - 5}" font-size="13" fill="#2d3748">NEW: a page that has to be built</text>`);
  out.push(`<rect x="${MARGIN + 300}" y="${legendY - 18}" width="22" height="16" rx="4" fill="#eef1f6" stroke="#718096" stroke-width="1.5"/><text x="${MARGIN + 330}" y="${legendY - 5}" font-size="13" fill="#2d3748">EXISTING: a page the site already has</text>`);
  out.push(`<text x="${MARGIN}" y="${legendY + 20}" font-size="13" fill="#2d3748">Volume: how many people search for it (an estimate when it says so; "no number" means none was measured). A line joins a page to the page it sits under.</text>`);
  out.push(`<text x="${MARGIN}" y="${legendY + 40}" font-size="13" fill="#2d3748">This is the page plan, not the sitemap file that search engines read.</text>`);
  out.push(`</g></svg>`);

  const md = [`# Page plan${sitemap.business ? ": " + sitemap.business : ""}`, "",
    `${view.length} pages, ${newCount} new. The picture is page-plan.svg (and page-plan.png when a browser was available).`, "",
    "| Page | Under | Target search | Volume | New or existing |", "|---|---|---|---|---|",
    ...view.map((p) => `| ${mdCell(p.path)} | ${mdCell(p.parent || "-")} | ${mdCell(p.search || "none (support page)")} | ${mdCell(p.volume)} | ${p.isNew ? "NEW" : "EXISTING"} |`), ""].join("\n");
  return { svg: out.join("\n") + "\n", md, pages: view.length, newCount, width: WIDTH, height: HEIGHT };
}

// SVG -> PNG through the skill's own headless Chrome driver. Resolves { ok, reason }.
export async function renderPng(svgFile, pngFile, width, height, { limitMs = PNG_LIMIT_MS } = {}) {
  let cdp;
  try { cdp = await import("./cdp-measure.mjs"); } catch (e) { return { ok: false, reason: `cannot load cdp-measure.mjs (${e.message})` }; }
  if (!cdp.CHROME_PATH || process.env.PEWP_NO_CHROME === "1") return { ok: false, reason: "no Chrome" }; // PEWP_NO_CHROME=1: test hook, the no-Chrome branch on a machine that has one
  let browser = null, timer;
  const work = (async () => {
    browser = await cdp.launchBrowser();
    const { send, listeners } = browser;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    let loaded = false;
    const on = (m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") loaded = true; };
    listeners.add(on);
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Page.navigate", { url: pathToFileURL(svgFile).href }, sessionId);
    for (let i = 0; i < 100 && !loaded; i++) await new Promise((r) => setTimeout(r, 100));
    if (!loaded) throw new Error("the picture did not finish loading");
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 }, captureBeyondViewport: true }, sessionId, 30000);
    fs.writeFileSync(pngFile, Buffer.from(shot.data, "base64"));
  })();
  const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`Chrome did not finish in ${limitMs / 1000} s`)), limitMs); });
  try { await Promise.race([work, limit]); return { ok: true }; }
  catch (e) { work.catch(() => {}); return { ok: false, reason: e.message }; }
  finally { clearTimeout(timer); if (browser) { try { await browser.close(); } catch {} } }
}

async function main() {
  const A = process.argv.slice(2);
  if (A.includes("--help") || A.includes("-h")) { console.log(USAGE); return 0; }
  const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
  const pos = A.filter((x, i) => !x.startsWith("--") && !String(A[i - 1] || "").startsWith("--"));
  if (!pos[0]) { console.error(USAGE); return 2; }
  const pewp = path.resolve(pos[0]);
  const smFile = path.join(pewp, "plan", "sitemap.json"), tgFile = path.join(pewp, "targets.json");
  let sitemap, targets;
  try { sitemap = readJson(smFile); } catch (e) { console.error(`cannot read the page plan ${smFile} (${e.code === "ENOENT" ? "missing: run plan-site.mjs first" : e.message})`); return 2; }
  try { targets = readJson(tgFile); } catch (e) { console.error(`cannot read ${tgFile} (${e.code === "ENOENT" ? "missing" : e.message})`); return 2; }
  if (!Array.isArray(sitemap.pages) || !sitemap.pages.length) { console.error(`the page plan ${smFile} lists no pages`); return 2; }
  const outDir = path.resolve(opt("--out-dir", path.join(pewp, "plan")));
  fs.mkdirSync(outDir, { recursive: true });
  const pic = buildPicture(sitemap, targets, { today: opt("--today", new Date().toISOString().slice(0, 10)) });
  const svgFile = path.join(outDir, "page-plan.svg"), pngFile = path.join(outDir, "page-plan.png");
  fs.writeFileSync(svgFile, pic.svg);
  fs.writeFileSync(path.join(outDir, "page-plan.md"), pic.md);
  fs.rmSync(pngFile, { force: true }); // never leave an old picture next to a new table
  const r = await renderPng(svgFile, pngFile, pic.width, pic.height);
  if (!r.ok) console.log(r.reason === "no Chrome" ? "PNG BLOCKED: no Chrome (set CHROME_PATH); SVG and table written" : `PNG BLOCKED: ${r.reason}; SVG and table written`);
  console.log(`page plan picture: ${pic.pages} pages, ${pic.newCount} new`);
  return 0;
}
if (isMain(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(2); });
