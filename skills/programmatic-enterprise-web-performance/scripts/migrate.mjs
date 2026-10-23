// migrate: replacing an existing site without losing the rankings. Stages (each re-runnable, each reads/writes files):
//   inventory  every old URL: old snapshot + sitemap + Search Console pages + pages with links -> migrate/inventory.json
//   map        redirect map old -> new (one hop 301, no chains, nothing to the homepage by default) -> redirect-map.csv,
//              redirect-map.json, _redirects (Cloudflare Pages format), carryover.json (titles/content that rank)
//   baseline   pre-cutover baseline: traffic per page, old statuses, rankings, AI citations, authority -> baseline-<date>.json
//   gate       every old URL with traffic or links resolves in ONE hop (301/308) to a 200 on the new site (fixture server in
//              tests; a live site only when the main session runs it: GET only, honest user agent, gap, stop at the first 429)
//   monitor    compare the latest measure run with the baseline for 28 days after the cutover
// Usage: node migrate.mjs <old url> <new url|dir> --stage inventory|map|baseline|gate|monitor|all [--cwd DIR] [--today D]
//        [--gsc-file rows.json] [--gsc-days 90] [--links-csv file.csv] [--fetch-sitemap] [--overrides file.csv] [--home-ok /path,...]
//        [--min-score 0.5] [--new-origin URL] [--gap-ms 1000 (new site; old site 4000)] [--max-urls 500] [--probe-old] [--cutover YYYY-MM-DD]
//        [--exclude "<regex>"]... (off-limits paths: never requested by the gate or --probe-old, listed as not checked)
//        [--images [--image-scope all|priority] [--image-max 2000]]  also run REF-014 in the gate: every image URL of the old snapshot
//          (img/srcset/picture in <main>, og:image, image sitemap) answers 200 image/* or one 301/308 hop to one on the new site
//          (scripts/ref-images.mjs; images used only on pages the map drops with a 410 are exempt)
// Exit: 0 ok, 1 gate failed, 2 usage, 3 stopped at a 429. BLOCKED parts are results (listed in the output), not errors.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import { POLITE_GAP_MS, MIN_GAP_MS, isLocalUrl } from "./lib-polite.mjs";
import path from "node:path";
import { locate, markStage } from "./state.mjs";
import { latestComplete } from "./live-target.mjs";
import { cachedFetch } from "./cache.mjs";
import { stem as libStem } from "./lib-text.mjs";
import { inventoryImages, checkImages, imagesMarkdown } from "./ref-images.mjs";
import { DEFAULT_ENDPOINTS, Budget, fact, nfkc, words, readJson, writeJson, blocked, normPath, htmlInfo, gscQuery, bingLinkCounts, ymd, addDays, domainOf, poissonInterval, isDay, safeDecode } from "./measure-sources.mjs";

const UA = "PEWP-Migrate/1.0 (redirect check, read-only, GET only)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class Stop429 extends Error {}
const STOP = new Set(["html", "htm", "php", "asp", "aspx", "index", "the", "and", "of", "in", "for", "a", "to", "our", "your", "we", "us"]);
const stem = libStem; // the plan stage's stemmer: sellers -> seller, valuations -> valuat, ies -> y
// Page types: an old page about "team", "agents" or "testimonials" belongs to the new "about" page, "sellers-guide", "valuation" and
// "cash-offer" to "sell", "buyers" and "mortgage" to "buy". The table is small on purpose; every use is only a SUGGESTION.
const PAGE_TYPES = { about: "about agent team bio meet testimonial review staff", sell: "sell seller valuation cash offer", buy: "buy buyer mortgage purchase", contact: "contact" };
const TYPE_OF = new Map(Object.entries(PAGE_TYPES).flatMap(([t, ws]) => ws.split(" ").map((w) => [libStem(w), t])));
const typesOf = (tokensList) => new Set(tokensList.map((t) => TYPE_OF.get(t)).filter(Boolean));
// Pages that look like a leftover: a test/draft path, a title saying draft or not found, or the old site already answering 4xx/5xx.
export function goneReason(p, title, status) {
  if (/(^|[/_-])(test|draft|tmp|temp|sample|staging|dummy|lorem|untitled)([/_.-]|$)/i.test(p)) return "the path looks like a test or draft page";
  if (/\b(draft|page not found|not found|404|lorem ipsum|untitled)\b/i.test(title || "")) return "the title says draft or not found";
  if (status >= 400) return `the old site already answers ${status}`;
  return null;
}

// ---------- small file formats ----------
export function csvLine(cells) { return cells.map((c) => { const s = c == null ? "" : String(c); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","); }
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = String(text).replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim()); return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
export const parseSitemapXml = (xml) => [...String(xml).matchAll(/<(sitemap|url)>([\s\S]*?)<\/\1>/g)].map((m) => ({ kind: m[1], loc: (m[2].match(/<loc>\s*([^<]+?)\s*<\/loc>/) || [])[1]?.replace(/&amp;/g, "&"), lastmod: (m[2].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/) || [])[1] })).filter((x) => x.loc);

// ---------- inventory ----------
async function fetchSitemapUrls(origin, pewp, { gapMs = 1000, maxFiles = 25 } = {}) {
  const get = async (u) => { const r = await cachedFetch(pewp, "migrate-sitemap", u, { maxAgeDays: 1, init: { headers: { "user-agent": UA } } }); if (r.status === 429) { try { fs.rmSync(r.cacheFile, { force: true }); } catch {} throw new Stop429(`429 from ${u}`); } if (r.status >= 300) { try { fs.rmSync(r.cacheFile, { force: true }); } catch {} } return r; };
  const rob = await get(`${origin}/robots.txt`);
  const declared = rob.status === 200 ? [...rob.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  const queue = declared.length ? declared : [`${origin}/sitemap.xml`]; const seen = new Set(), urls = [], files = [];
  while (queue.length && seen.size < maxFiles) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    await sleep(gapMs);
    const r = await get(u); files.push({ url: u, status: r.status, cacheFile: r.cacheFile, fetchedAt: r.fetchedAt });
    if (r.status !== 200) continue;
    for (const l of parseSitemapXml(r.text)) (l.kind === "sitemap" ? queue.push(l.loc) : urls.push(l));
  }
  return { urls, files };
}

function readSnapshot(snapDir) {
  const site = readJson(path.join(snapDir, "_site.json")); if (!site) return null;
  const pages = (site.pages || []).map((p) => {
    const pdir = path.join(snapDir, "pages", p.slug); const rd = (f) => { try { return fs.readFileSync(path.join(pdir, f), "utf8"); } catch { return ""; } };
    const info = htmlInfo(rd("head.html") + rd("body.html"));
    let finalPath = null; try { if (p.finalUrl && p.redirects > 0) finalPath = normPath(p.finalUrl); } catch {}
    return { path: normPath(p.url), status: p.status, finalPath, title: info.title, h1: info.h1, description: info.description, words: info.text.split(/\s+/).filter(Boolean).length };
  });
  const sm = readJson(path.join(snapDir, "site", "sitemaps.json"));
  return { dir: snapDir, finishedAt: site.finishedAt, pages, sitemapUrls: (sm?.urls || []).map((u) => u.loc), origin: site.origin };
}

// Pages from a GSC export or the API: [{ page, clicks, impressions }] -> by path (query strings merged).
function gscPages(rows) {
  const by = new Map();
  for (const r of rows) { const p = normPath(r.page ?? r.keys?.[0]); const o = by.get(p) || { clicks: 0, impressions: 0 }; o.clicks += r.clicks || 0; o.impressions += r.impressions || 0; by.set(p, o); }
  return by;
}
function parseLinksCsv(text) {
  const rows = parseCsv(text); if (!rows.length) return [];
  const keys = Object.keys(rows[0]); const urlKey = keys.find((k) => /page|url/i.test(k)) || keys[0]; const nKey = keys.find((k) => /(external|link|count)/i.test(k) && k !== urlKey) || keys[1];
  return rows.map((r) => ({ url: r[urlKey], count: Number(String(r[nKey]).replace(/[^\d]/g, "")) || 0 })).filter((r) => r.url);
}

export async function buildInventory({ oldUrl, loc, opts = {}, env = process.env }) {
  const origin = new URL(oldUrl).origin; const parts = {}; const rows = new Map();
  const row = (p) => { p = normPath(p); if (!rows.has(p)) rows.set(p, { path: p, sources: [], clicks: 0, impressions: 0, links: 0, status: null, finalPath: null, title: null, h1: null, description: null, words: null }); return rows.get(p); };
  const addSrc = (r, s) => { if (!r.sources.includes(s)) r.sources.push(s); };
  // 1. old snapshot
  const snap = opts.snapshotDir ? { dir: opts.snapshotDir, ...(readSnapshot(opts.snapshotDir) || {}) } : (() => { const l = latestComplete(loc.snapshots || ""); return l ? readSnapshot(l.dir) : null; })();
  if (snap?.pages) {
    parts.snapshot = { status: "ok", dir: snap.dir, finishedAt: snap.finishedAt, pages: snap.pages.length };
    for (const p of snap.pages) { const r = row(p.path); addSrc(r, "snapshot"); Object.assign(r, { status: p.status, finalPath: p.finalPath, title: p.title, h1: p.h1, description: p.description, words: p.words }); }
    for (const u of snap.sitemapUrls) addSrc(row(u), "sitemap");
  } else parts.snapshot = { status: "blocked", blocked: { source: "old snapshot", reason: "no complete snapshot of the old site", unblock: `Run live-target.mjs ${oldUrl} (polite crawl), or pass --snapshot-dir.` } };
  // 2. sitemap, live (only when asked: this touches the live old site)
  if (opts.fetchSitemap) {
    try { const sm = await fetchSitemapUrls(origin, loc.pewp, { gapMs: opts.gapMs ?? POLITE_GAP_MS }); for (const u of sm.urls) addSrc(row(u.loc), "sitemap"); parts.sitemap = { status: sm.urls.length ? "ok" : "blocked", urls: sm.urls.length, files: sm.files, ...(sm.urls.length ? {} : { blocked: { source: "sitemap", reason: "no sitemap URLs found", unblock: "Give the sitemap URL, or use the snapshot." } }) }; }
    catch (e) { parts.sitemap = { status: "blocked", blocked: { source: "sitemap", reason: e.message, unblock: e instanceof Stop429 ? "The site rate-limited us (429): stopped, not retried. Wait and run later." : "Check the address and run again." } }; if (e instanceof Stop429) parts.stopped429 = true; }
  } else parts.sitemap = snap?.sitemapUrls?.length ? { status: "ok", urls: snap.sitemapUrls.length, from: "snapshot" } : { status: "blocked", blocked: { source: "sitemap", reason: "no sitemap in the snapshot and --fetch-sitemap not given", unblock: "Add --fetch-sitemap (polite, cached) or crawl a snapshot first." } };
  // 3. Search Console pages (traffic)
  let gscRows = null, gscSource = null, gscDaysUsed = null;
  if (opts.gscFile) { const j = readJson(opts.gscFile); gscRows = Array.isArray(j) ? j : j?.rows; gscSource = `export ${opts.gscFile}`; gscDaysUsed = opts.gscWindowDays || j?.windowDays || null; }
  else if (opts.gscDays) {
    const cfg = readJson(path.join(loc.pewp, "measure", "config.json")) || {};
    const ctx = { pewp: loc.pewp, endpoints: { ...DEFAULT_ENDPOINTS, ...(cfg.endpoints || {}), ...(opts.endpoints || {}) }, budget: new Budget({ api: 10 }), maxAgeDays: 1, env, tokenFile: opts.tokenFile };
    const end = addDays(opts.now || new Date(), -3);
    const r = await gscQuery(ctx, { site: opts.gscSite || cfg.gsc?.site || `sc-domain:${loc.host}`, start: ymd(addDays(end, -(opts.gscDays - 1))), end: ymd(end), dimensions: ["page"] });
    if (r.ok) { gscRows = r.rows.map((x) => ({ page: x.keys[0], clicks: x.clicks, impressions: x.impressions })); gscSource = r.source; gscDaysUsed = opts.gscDays; parts.gscFetch = { cacheFiles: r.cacheFiles, fetchedAt: r.fetchedAt }; } else parts.searchConsole = { status: "blocked", blocked: r.blocked };
  } else {
    const dirs = fs.existsSync(path.join(loc.pewp, "measure")) ? fs.readdirSync(path.join(loc.pewp, "measure")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : [];
    for (const d of dirs) { const g = readJson(path.join(loc.pewp, "measure", d, "gsc.json")); if (g?.status === "ok") { const cur = g.tables.current.page || [], prev = g.tables.previous.page || []; gscRows = [...cur, ...prev].map((x) => ({ page: x.keys[0], clicks: x.clicks, impressions: x.impressions })); gscSource = `measure run ${d} (two 28-day windows summed)`; gscDaysUsed = (Date.parse(g.windows.current.end) - Date.parse(g.windows.current.start)) / 86400000 + 1 + (Date.parse(g.windows.previous.end) - Date.parse(g.windows.previous.start)) / 86400000 + 1; break; } }
  }
  if (gscRows) {
    parts.searchConsole = { status: "ok", source: gscSource, pages: gscRows.length, windowDays: gscDaysUsed };
    for (const [p, v] of gscPages(gscRows)) { const r = row(p); addSrc(r, "search-console"); r.clicks = v.clicks; r.impressions = v.impressions; }
  } else if (!parts.searchConsole) parts.searchConsole = { status: "blocked", blocked: { source: "search-console", reason: "no Search Console page data (no measure run, no export, no --gsc-days)", unblock: "Connect Search Console (doctor), run measure first, or pass --gsc-file with [{page, clicks, impressions}]." } };
  // 4. pages with links (page level): Search Console Links export, or Bing GetLinkCounts. Common Crawl is domain level only.
  let linkRows = null, linkSource = null;
  if (opts.linksCsv) { linkRows = parseLinksCsv(fs.readFileSync(opts.linksCsv, "utf8")); linkSource = `Search Console Links report export ${opts.linksCsv}`; }
  else if ((env.BING_WEBMASTER_KEY || opts.endpoints) && opts.bingLinks) {
    const cfg = readJson(path.join(loc.pewp, "measure", "config.json")) || {};
    const ctx = { pewp: loc.pewp, endpoints: { ...DEFAULT_ENDPOINTS, ...(cfg.endpoints || {}), ...(opts.endpoints || {}) }, budget: new Budget({ api: 10 }), maxAgeDays: 1, env };
    const r = await bingLinkCounts(ctx, origin + "/"); if (r.ok) { linkRows = r.rows; linkSource = r.source; } else parts.links = { status: "blocked", blocked: r.blocked };
  }
  if (linkRows) { parts.links = { status: "ok", source: linkSource, level: "page", rows: linkRows.length }; for (const l of linkRows) { const r = row(l.url); addSrc(r, "links"); r.links = Math.max(r.links, l.count); } }
  else if (!parts.links) parts.links = { status: "blocked", blocked: { source: "page-level links", reason: "Common Crawl is domain level only; no page-level link data", unblock: "Export Search Console > Links > Top linked pages (CSV) and pass --links-csv, or set BING_WEBMASTER_KEY and --bing-links." } };
  const minI = opts.minImpressions ?? 20;
  const out = [...rows.values()].sort((a, b) => a.path.localeCompare(b.path)).map((r) => {
    const why = []; if (r.clicks > 0) why.push("traffic"); if (r.links > 0) why.push("links"); if (r.impressions >= minI) why.push("visibility"); if (r.path === "/") why.push("home");
    return { ...r, mustKeep: why.length > 0, why };
  });
  return { generatedAt: new Date().toISOString(), oldUrl, origin, parts, counts: { total: out.length, mustKeep: out.filter((r) => r.mustKeep).length }, rows: out,
    note: "mustKeep = traffic (clicks), links (page-level), visibility (>= " + minI + " impressions) or the homepage. Only mustKeep rows are gated." };
}

// ---------- the new site ----------
const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (/^(node_modules|\.git|\.pewp|\.checks)$/.test(e.name) ? [] : walk(path.join(d, e.name), base)) : [path.relative(base, path.join(d, e.name)).split(path.sep).join("/")]);
export function parseRedirectsFile(text) {
  const rules = [], skipped = [];
  for (const line of String(text).split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const [from, to, status] = t.split(/\s+/); if (!to) continue; if (/[*:]/.test(from)) { skipped.push(t); continue; } rules.push({ from: normPath(from), to: /^https?:/.test(to) ? to : normPath(to), status: Number(status) || 301 }); }
  return { rules, skipped };
}
export async function readNewSite(spec, { loc, opts = {} } = {}) {
  const pages = new Map(); let redirects = { rules: [], skipped: [] }; let source;
  if (!/^https?:\/\//i.test(spec)) {
    const dir = path.resolve(spec); source = `built folder ${dir}`;
    for (const f of walk(dir)) {
      if (/^_redirects$/.test(f)) { redirects = parseRedirectsFile(fs.readFileSync(path.join(dir, f), "utf8")); continue; }
      if (!/\.html?$/i.test(f)) continue;
      const html = fs.readFileSync(path.join(dir, f), "utf8"); const info = htmlInfo(html);
      if (/<meta[^>]+http-equiv=["']refresh/i.test(html)) continue;
      pages.set(normPath("/" + f.replace(/(^|\/)index\.html?$/i, "$1").replace(/\.html?$/i, "")), { title: info.title, h1: info.h1, description: info.description, words: info.text.split(/\s+/).filter(Boolean).length, noindex: /noindex/i.test(info.robots || ""), file: f });
    }
  } else {
    const origin = new URL(spec).origin; source = `sitemap of ${origin}`;
    const sm = await fetchSitemapUrls(origin, loc.pewp, { gapMs: opts.gapMs ?? 1000 });
    for (const u of sm.urls) { try { if (new URL(u.loc).origin === origin) pages.set(normPath(u.loc), { title: null, h1: null, description: null, words: null }); } catch {} }
    const snap = latestComplete(path.join(path.dirname(loc.pewp), "..", new URL(spec).hostname.replace(/^www\./, ""), "snapshots"));
    if (snap) for (const p of readSnapshot(snap.dir)?.pages || []) { const q = pages.get(p.path) || (pages.set(p.path, {}), pages.get(p.path)); Object.assign(q, { title: p.title, h1: p.h1, description: p.description, words: p.words }); }
  }
  return { source, pages, redirects };
}

// ---------- matching ----------
// safeDecode: an old address with a stray "%" ("/50%-off") made decodeURIComponent throw and stopped the whole map stage
const slugTokens = (p) => [...new Set(nfkc(safeDecode(p)).split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)).map(stem))];
const titleTokens = (t) => [...new Set(words(t || "").filter((w) => !STOP.has(w)).map(stem))];
const dice = (a, b) => { if (!a.length || !b.length) return 0; const B = new Set(b); const n = a.filter((x) => B.has(x)).length; return (2 * n) / (a.length + b.length); };
const keyOf = (p) => nfkc(safeDecode(p)).replace(/\.(html?|php|aspx?)$/, "").replace(/\/index$/, "").replace(/\/$/, "") || "/";

export function buildRedirectMap(inv, newSite, { overrides = [], homeOk = [], minScore = 0.5, existingCsv = null } = {}) {
  const newPaths = [...newSite.pages.keys()];
  const exact = new Set(newPaths), byKey = new Map(newPaths.map((p) => [keyOf(p), p]));
  const ov = new Map(overrides.map((o) => [normPath(o.from), o.to]));
  const homeAllowed = new Set(homeOk.map(normPath));
  const rows = [];
  for (const o of inv.rows) {
    let from = o.path; const src = o.finalPath && o.finalPath !== o.path ? o.finalPath : null; // old site already redirected this URL: map its destination
    const probe = src || from; let to = null, method = "none", score = null, approved = "", alternatives = [], reason = "", gone = null;
    if (ov.has(from)) { to = ov.get(from); method = "override"; approved = "yes"; reason = "owner override"; }
    else if (exact.has(probe)) { to = probe; method = from === probe ? "same" : "exact"; approved = "auto"; reason = src ? `old site redirected ${from} to ${probe}, which exists on the new site` : "same path on the new site"; }
    else if (byKey.has(keyOf(probe))) { to = byKey.get(keyOf(probe)); method = "normalized"; approved = "auto"; reason = "same path after dropping extension, slash or case"; }
    else if (!o.mustKeep && goneReason(probe, o.title, o.status)) { gone = goneReason(probe, o.title, o.status); reason = `410 candidate: ${gone}. No redirect is suggested; the owner confirms removing it`; }
    else {
      const st = slugTokens(probe), tt = titleTokens(o.title), ot = typesOf([...st, ...tt]), oSlugTypes = typesOf(st);
      const cands = newPaths.filter((p) => p !== "/" || probe === "/").map((p) => {
        const np = newSite.pages.get(p); const ps = slugTokens(p);
        const s = dice(st, ps); const t = tt.length && np?.title ? dice(tt, titleTokens(np.title)) : null;
        let sc = t == null ? s : 0.6 * s + 0.4 * t;
        if (probe.split("/")[1] && probe.split("/")[1] === p.split("/")[1]) sc += 0.05;
        // page-type synonyms: the old page's type (from its path, else its title) names the new page's own type
        // only from the old PATH (a title that merely says "about" or "meet" is not a page type), and only to a short top-level
        // page of the new site (a blog post slug that contains "about" is not "the about page")
        const types = oSlugTypes, pt = p.split("/").filter(Boolean).length <= 1 && ps.length <= 3 ? typesOf(ps) : new Set();
        if (types.size && pt.size && [...types].some((x) => pt.has(x))) sc = Math.max(sc, 0.6);
        return { path: p, score: Math.min(1, sc) };
      }).sort((a, b) => b.score - a.score || a.path.length - b.path.length);
      alternatives = cands.slice(0, 3).filter((c) => c.score > 0);
      if (cands[0] && cands[0].score >= minScore) { to = cands[0].path; method = "similarity"; score = Math.round(cands[0].score * 100) / 100; reason = `${cands[0].score === 0.6 && !dice(st, slugTokens(to)) ? "page type" : "slug" + (tt.length ? " and title" : "")} similarity ${score}; a guess, the owner approves it`; approved = ""; }
      else reason = "no confident match: the owner decides (a new page, a 410, or a manual target)";
    }
    rows.push({ from, to: to || "", method, score, approved, mustKeep: o.mustKeep, clicks: o.clicks, impressions: o.impressions, links: o.links, reason, alternatives: alternatives.map((a) => `${a.path} (${Math.round(a.score * 100) / 100})`).join("; "), flags: gone ? ["410 CANDIDATE"] : [], gone: !!gone, title: o.title });
  }
  // owner edits survive a re-run
  if (existingCsv) { const ex = new Map(existingCsv.map((r) => [r.from, r])); for (const r of rows) { const e = ex.get(r.from); if (e && /^(yes|no)$/i.test(e.approved)) { r.approved = e.approved.toLowerCase(); if (e.to && e.to !== r.to) { r.to = e.to; r.method = "owner"; r.reason = "owner edited in redirect-map.csv"; } } } }
  // homepage guard, missing target, chains and loops (including the new site's own _redirects)
  const rule = new Map(); for (const r of newSite.redirects.rules) rule.set(r.from, r.to);
  for (const r of rows) if (r.to && r.from !== r.to && r.approved !== "no") rule.set(r.from, r.to);
  for (const r of rows) {
    if (!r.to) { if (!r.gone) r.flags.push("NO TARGET"); continue; }
    if (r.to === "/" && r.from !== "/" && !homeAllowed.has(r.from)) { r.flags.push("HOMEPAGE"); if (r.approved === "auto" || r.approved === "yes") r.approved = ""; r.reason += "; points at the homepage, which search engines treat as a soft 404: needs an explicit --home-ok or a real target"; }
    const seen = new Set([r.from]); let cur = r.to, hops = 0;
    while (rule.has(cur) && !/^https?:/.test(cur)) { if (seen.has(cur)) { r.flags.push("LOOP"); break; } seen.add(cur); cur = rule.get(cur); hops++; if (hops > 10) break; }
    if (r.flags.includes("LOOP")) { r.approved = ""; continue; }
    if (hops > 0) { r.flags.push(`CHAIN collapsed (${r.to} -> ${cur})`); r.collapsedFrom = r.to; r.to = cur; }
    if (!/^https?:/.test(r.to) && !exact.has(r.to) && r.method === "override") { r.flags.push("TARGET NOT ON NEW SITE"); r.approved = ""; }
  }
  const summary = { total: rows.length, same: rows.filter((r) => r.method === "same").length, redirects: rows.filter((r) => r.to && r.to !== r.from && r.approved !== "no").length, auto: rows.filter((r) => r.approved === "auto" || r.approved === "yes").length,
    needsReview: rows.filter((r) => r.method === "similarity" && r.approved !== "yes" && r.approved !== "no").length, noTarget: rows.filter((r) => !r.to && !r.gone).length, gone410: rows.filter((r) => r.gone).length, homepage: rows.filter((r) => r.flags.includes("HOMEPAGE")).length, chainsCollapsed: rows.filter((r) => r.collapsedFrom).length, loops: rows.filter((r) => r.flags.includes("LOOP")).length,
    mustKeepWithoutTarget: rows.filter((r) => r.mustKeep && (!r.to || r.flags.includes("HOMEPAGE"))).length };
  return { rows, summary };
}
export const CSV_COLS = ["from", "to", "status", "method", "score", "approved", "mustKeep", "clicks", "impressions", "links", "flags", "reason", "alternatives"];
export function mapToCsv(rows) { return [CSV_COLS.join(","), ...rows.map((r) => csvLine([r.from, r.to, r.to && r.from !== r.to ? 301 : "", r.method, r.score ?? "", r.approved, r.mustKeep ? "yes" : "", r.clicks, r.impressions, r.links, r.flags.join("; "), r.reason, r.alternatives]))].join("\n") + "\n"; }
const encodePath = (p) => p.split("/").map((s) => encodeURIComponent(safeDecode(s)).replace(/%2C/g, ",")).join("/");
// Cloudflare Pages `_redirects`: only approved rows are active; suggestions and gaps are comments the owner can see.
export function emitRedirects(rows, { includeSuggestions = false } = {}) {
  const L = ["# Generated by programmatic-enterprise-web-performance/migrate.mjs. One hop, 301, no chains. Edit redirect-map.csv, not this file.", "# Cloudflare Pages limits: 2000 static rules, 100 dynamic (with * or :). This file has only static rules."], active = [], skipped = [];
  for (const r of rows) {
    if (!r.to || r.from === r.to || r.approved === "no" || r.flags.includes("LOOP")) { if (!r.to) L.push(`# ${r.gone ? "410 CANDIDATE (answer 410 Gone if the owner agrees)" : "NO TARGET"} ${r.from} (clicks ${r.clicks}, links ${r.links})`); continue; }
    const on = r.approved === "auto" || r.approved === "yes" || (includeSuggestions && r.method === "similarity" && !r.flags.includes("HOMEPAGE"));
    if (/[*:]/.test(r.from)) { skipped.push(r.from); L.push(`# SKIPPED (contains * or :, would be read as a pattern) ${r.from}`); continue; }
    if (!on) { L.push(`# REVIEW ${r.from} ${r.to} 301${r.score != null ? ` (score ${r.score})` : ""}${r.flags.length ? ` [${r.flags.join("; ")}]` : ""}`); continue; }
    active.push(`${encodePath(r.from)} ${/^https?:/.test(r.to) ? r.to : encodePath(r.to)} 301`);
  }
  if (active.length > 2000) L.push(`# WARNING: ${active.length} rules, over the 2000 static limit`);
  return { text: L.join("\n") + "\n" + active.join("\n") + (active.length ? "\n" : ""), active: active.length, skipped };
}

// ---------- carry over what ranks ----------
export function carryOver(map, inv, newSite, queryPages = []) {
  const invBy = new Map(inv.rows.map((r) => [r.path, r])); const out = [];
  const topQ = new Map(); for (const q of queryPages) { const p = normPath(q.page); (topQ.get(p) || topQ.set(p, []).get(p)).push(q); }
  for (const r of map.rows) {
    if (!r.mustKeep || !r.to || /^https?:/.test(r.to)) continue;
    const o = invBy.get(r.from), n = newSite.pages.get(r.to); if (!n) continue;
    const qs = (topQ.get(r.from) || []).sort((a, b) => b.clicks - a.clicks).slice(0, 3).map((x) => x.query);
    const newText = [n.title, n.h1, n.description].filter(Boolean).join(" ");
    const flags = [];
    if (o.title && n.title && nfkc(o.title) !== nfkc(n.title)) flags.push("title changed");
    if (qs.length && n.title !== undefined) { const lost = qs.filter((q) => !words(q).every((w) => words(newText).includes(w))); if (lost.length) flags.push(`new title/H1/description lack the words of: ${lost.join(" | ")}`); }
    if (o.words && n.words != null && n.words < 0.6 * o.words) flags.push(`new page has ${n.words} words, old had ${o.words}`);
    out.push({ from: r.from, to: r.to, clicks: r.clicks, topQueries: qs, old: { title: o.title, h1: o.h1, description: o.description, words: o.words }, new: { title: n.title, h1: n.h1, description: n.description, words: n.words }, flags, ok: flags.length === 0 });
  }
  return out;
}

// ---------- the gate ----------
export async function trace(url, { fetchImpl = fetch, maxHops = 10, timeoutMs = 20000 } = {}) {
  const hops = [], seen = new Set(); let cur = url;
  for (let i = 0; i <= maxHops; i++) {
    if (seen.has(cur)) return { hops, final: null, loop: true };
    seen.add(cur);
    let res; try { res = await fetchImpl(cur, { redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) }); } catch (e) { return { hops, final: { url: cur, status: null, error: e.message } }; }
    try { await res.body?.cancel(); } catch {}
    if (res.status === 429) throw new Stop429(`429 from ${cur}`);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { hops.push({ url: cur, status: res.status, location: loc }); cur = new URL(loc, cur).href; continue; }
    return { hops, final: { url: cur, status: res.status } };
  }
  return { hops, final: null, tooMany: true };
}
export function judge(row, t, { homeOk = new Set() } = {}) {
  const fails = [], warns = [];
  if (t.loop) fails.push("redirect loop"); else if (t.tooMany) fails.push("more than 10 redirects"); else if (!t.final || t.final.status == null) fails.push(`could not fetch: ${t.final?.error || "error"}`);
  else {
    if (t.hops.length > 1) fails.push(`chain of ${t.hops.length} hops (${t.hops.map((h) => h.status).join("->")}); search engines may stop following`);
    if (t.hops.length === 1 && ![301, 308].includes(t.hops[0].status)) fails.push(`temporary redirect (${t.hops[0].status}); only 301/308 passes ranking`);
    if (t.final.status !== 200) fails.push(`ends at ${t.final.status}, not 200`);
    let fp = ""; try { fp = normPath(t.final.url); } catch {}
    if (fp === "/" && row.path !== "/" && !homeOk.has(row.path)) fails.push("ends at the homepage (treated as a soft 404 by search engines)");
    if (t.final.status === 200 && row.to && !/^https?:/.test(row.to) && fp !== row.to && row.to !== row.path) warns.push(`lands on ${fp}, the map says ${row.to}`);
  }
  return { verdict: fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", fails, warns };
}
// Off-limits paths (--exclude, the same rule as the crawler: a client site's listing feed must never be requested). The rows are
// listed as not checked; they are never requested, on the old or the new origin.
export const excludedBy = (excludes) => { const res = (excludes || []).map((x) => new RegExp(x)); return (p) => res.some((re) => re.test(p)); };
export async function runGate({ inv, map, newOrigin, gapMs = 1000, maxUrls = 500, homeOk = [], exclude = [], fetchImpl = fetch, log = () => {} }) {
  const mapBy = new Map((map?.rows || []).map((r) => [r.from, r]));
  const isEx = excludedBy(exclude);
  const excluded = inv.rows.filter((r) => r.mustKeep && isEx(r.path)).map((r) => r.path);
  const targets = inv.rows.filter((r) => r.mustKeep && !isEx(r.path)).slice(0, maxUrls);
  const ok = new Set(homeOk.map(normPath)); const out = []; let stopped = null;
  for (const r of targets) {
    if (out.length) await sleep(gapMs);
    const m = mapBy.get(r.path); const safe = (s) => { try { return encodeURIComponent(decodeURIComponent(s)); } catch { return s; } }; const url = new URL(r.path.split("/").map(safe).join("/") || "/", newOrigin).href;
    let t; try { t = await trace(url, { fetchImpl }); } catch (e) { if (e instanceof Stop429) { stopped = e.message; break; } throw e; }
    const j = judge({ path: r.path, to: m?.to }, t, { homeOk: ok });
    out.push({ path: r.path, why: r.why, clicks: r.clicks, links: r.links, url, hops: t.hops.map((h) => ({ status: h.status, to: h.location })), finalStatus: t.final?.status ?? null, finalUrl: t.final?.url ?? null, ...j });
    log(`${j.verdict} ${r.path}${j.fails.length ? " : " + j.fails.join("; ") : ""}`);
  }
  const sum = { checked: out.length, of: targets.length, pass: out.filter((x) => x.verdict === "PASS").length, warn: out.filter((x) => x.verdict === "WARN").length, fail: out.filter((x) => x.verdict === "FAIL").length };
  // Nothing to check (no inventory row with traffic, links or visibility, or every one --exclude'd) is NOT a pass: a gate that
  // requested nothing proved nothing, so it says so instead of reporting "every old address works".
  const nothing = targets.length === 0;
  return { checkedAt: new Date().toISOString(), newOrigin, summary: sum, stopped429: stopped, notChecked: stopped ? targets.length - out.length : 0, excluded, nothingToCheck: nothing ? `no old address to check (${excluded.length ? `${excluded.length} excluded by --exclude; ` : ""}the inventory has no row with traffic, links or visibility: see its BLOCKED parts)` : null, passed: !nothing && !stopped && sum.fail === 0 && sum.checked === targets.length, rows: out };
}

// ---------- baseline and monitor ----------
export function latestMeasureDir(pewp) {
  const root = path.join(pewp, "measure"); if (!fs.existsSync(root)) return null;
  const d = fs.readdirSync(root).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && fs.existsSync(path.join(root, x, "gsc.json"))).sort().at(-1);
  return d ? path.join(root, d) : null;
}
export async function buildBaseline({ inv, map, loc, date, opts = {}, fetchImpl = fetch }) {
  const mdir = latestMeasureDir(loc.pewp); const b = { generatedAt: new Date().toISOString(), date, purpose: "pre-cutover baseline: what monitor compares against for 28 days", inventory: inv.counts, parts: {} };
  b.pages = inv.rows.filter((r) => r.mustKeep).map((r) => ({ path: r.path, why: r.why, clicks: r.clicks, impressions: r.impressions, links: r.links, oldStatus: r.status, title: r.title, newPath: map?.rows.find((m) => m.from === r.path)?.to || null }));
  b.trafficSource = inv.parts.searchConsole; b.pageWindowDays = inv.parts.searchConsole?.windowDays || null;
  if (mdir) {
    const g = readJson(path.join(mdir, "gsc.json")), rk = readJson(path.join(mdir, "rank-detail.json")), ai = readJson(path.join(mdir, "ai.json")), au = readJson(path.join(mdir, "authority.json")), cx = readJson(path.join(mdir, "crux.json"));
    b.measureDir = mdir;
    if (g?.status === "ok") { b.gscWindow = g.windows.current; b.gscTotals = g.totals.current; b.queryPages = (g.tables.current.queryPage || []).map((x) => ({ query: x.keys[0], page: x.keys[1], clicks: x.clicks, impressions: x.impressions, position: x.position })); b.parts.searchConsole = { status: "ok", from: path.join(mdir, "gsc.json") }; } else b.parts.searchConsole = { status: "blocked", blocked: g?.blocked };
    b.rankings = rk?.rows || null; b.parts.rankings = rk?.status === "blocked" ? { status: "blocked", blocked: rk.blocked } : { status: "ok", rows: rk?.rows?.length || 0 };
    b.ai = ai?.rows || null; b.parts.ai = ai?.status === "blocked" ? { status: "blocked", blocked: ai.blocked } : { status: ai?.status || "ok", rows: ai?.rows?.length || 0 };
    b.authority = au?.status === "ok" ? { referringDomains: au.referringDomains, release: au.release, level: "domain", linkingDomains: au.linkingDomains } : null; b.parts.authority = au?.status === "ok" ? { status: "ok" } : { status: "blocked", blocked: au?.blocked };
    b.crux = cx?.results || null; b.parts.crux = cx?.status === "blocked" ? { status: "blocked", blocked: cx.blocked } : { status: "ok" };
  } else for (const k of ["searchConsole", "rankings", "ai", "authority", "crux"]) b.parts[k] = { status: "blocked", blocked: { source: "measure", reason: "no measure run yet", unblock: "Run measure (scripts/measure.mjs <url>) before the cutover so the baseline has rankings, AI citations and authority." } };
  if (opts.probeOld) {
    const probes = []; let n = 0;
    const isEx = excludedBy(opts.exclude);
    b.oldProbesExcluded = inv.rows.filter((x) => x.mustKeep && isEx(x.path)).map((x) => x.path);
    for (const r of inv.rows.filter((x) => x.mustKeep && !isEx(x.path)).slice(0, opts.maxUrls || 200)) { if (n++) await sleep(opts.gapMs ?? POLITE_GAP_MS); try { const t = await trace(new URL(r.path, inv.origin).href, { fetchImpl }); probes.push({ path: r.path, status: t.final?.status ?? null, hops: t.hops.length }); } catch (e) { if (e instanceof Stop429) { b.probeStopped429 = e.message; break; } throw e; } }
    b.oldProbes = probes; b.parts.oldProbes = { status: "ok", fetchedAt: new Date().toISOString(), count: probes.length };
  } else b.parts.oldProbes = { status: "skipped", note: "pass --probe-old to GET every mustKeep old URL once (polite) and record its status before cutover" };
  return b;
}
export function runMonitor({ baseline, mdir, cutover, today, map }) {
  const g = readJson(path.join(mdir, "gsc.json")); if (g?.status !== "ok") return { status: "blocked", blocked: g?.blocked || { source: "search-console", reason: "latest measure run has no Search Console data", unblock: "Connect Search Console and run measure." } };
  const cDays = Math.round((Date.parse(g.windows.current.end) - Date.parse(g.windows.current.start)) / 86400000) + 1;
  const cur = new Map(); for (const r of g.tables.current.page || []) { const p = normPath(r.keys[0]); const o = cur.get(p) || { clicks: 0, impressions: 0 }; o.clicks += r.clicks; o.impressions += r.impressions; cur.set(p, o); }
  const day = cutover ? Math.floor((Date.parse(today) - Date.parse(cutover)) / 86400000) + 1 : null;
  const rows = [];
  for (const p of baseline.pages.filter((x) => x.clicks > 0 || x.links > 0)) {
    const np = p.newPath || p.path; const c = cur.get(np) || { clicks: 0, impressions: 0 };
    const exp = baseline.pageWindowDays ? p.clicks * (cDays / baseline.pageWindowDays) : null; // baseline clicks cover pageWindowDays days
    const lo = exp != null ? poissonInterval(Math.round(exp))[0] : null;
    rows.push({ oldPath: p.path, newPath: np, baselineClicks: p.clicks, expectedClicks: exp == null ? null : Math.round(exp * 10) / 10, clicks: c.clicks, impressions: c.impressions, dropped: lo != null && c.clicks < lo, notSeen: c.impressions === 0 });
  }
  const dropped = rows.filter((r) => r.dropped), unseen = rows.filter((r) => r.notSeen && r.baselineClicks > 0);
  const tb = rows.reduce((n, r) => n + (r.expectedClicks || 0), 0), tc = rows.reduce((n, r) => n + r.clicks, 0);
  return { status: "ok", date: today, measureRun: path.basename(mdir), dayOfMonitoring: day, monitoringEndsOn: cutover ? ymd(addDays(cutover, 28)) : null, done: day != null && day > 28,
    totals: { expectedClicks: Math.round(tb), clicks: tc, ratio: tb ? Math.round((tc / tb) * 100) / 100 : null }, droppedPages: dropped, pagesNotSeenAtAll: unseen, rows,
    note: "A page is 'dropped' when its clicks fall below the 95% Poisson interval of the baseline rate scaled to the window length (06 9.8). Search Console data is about 3 days late." };
}

// ---------- plain-words report ----------
function writeMigrateReport(dir, ctx) {
  const { oldUrl, newSpec, inv, map, gate, baseline, date } = ctx; const L = [];
  const head = gate ? (gate.passed ? "Every old address that matters reaches a working page in one step." : gate.nothingToCheck ? `Nothing was checked: ${gate.nothingToCheck}. This is not a pass.` : gate.stopped429 ? "The check was stopped because the site asked us to slow down (429); nothing was concluded." : `${gate.summary.fail} old address(es) that matter do not reach a working page in one step.`) : map ? `${map.summary.redirects} old addresses are mapped to new pages; ${map.summary.needsReview} guesses and ${map.summary.noTarget} gaps need the owner.` : `${inv.counts.total} old addresses found, ${inv.counts.mustKeep} of them matter (traffic or links).`;
  L.push(`# Moving ${oldUrl} to ${newSpec}: ${date}`, "", `**${head}**`, "", "A *redirect* sends a visitor and Google from an old address to the new one. It must be a *301* (permanent) and take *one step*: a chain of steps or a jump to the homepage loses the ranking the old page earned.", "");
  L.push("## What exists", "", `- ${inv.counts.total} old addresses; ${inv.counts.mustKeep} get traffic or links and must keep working.`);
  for (const [k, v] of Object.entries(inv.parts)) if (v?.status === "blocked") L.push(`- NOT MEASURED, ${v.blocked.source}: ${v.blocked.reason}. To fix: ${v.blocked.unblock}`);
  if (map) { const s = map.summary; L.push("", "## The redirect map", "", `- ${s.auto} rules are certain (same or equivalent page); ${s.needsReview} are guesses by name similarity and wait for the owner (column "approved" in redirect-map.csv); ${s.noTarget} old pages have no match; ${s.homepage} pointed at the homepage and were held back; ${s.chainsCollapsed} chains were shortened to one step; ${s.loops} loops.`); if (s.mustKeepWithoutTarget) L.push(`- ${s.mustKeepWithoutTarget} pages that matter still have no safe target: decide these first.`); }
  if (gate) { L.push("", "## The check", "", `- ${gate.summary.pass} pass, ${gate.summary.warn} warn, ${gate.summary.fail} fail, of ${gate.summary.checked} checked.`); for (const r of gate.rows.filter((x) => x.verdict !== "PASS").slice(0, 25)) L.push(`  - ${r.verdict} ${r.path}: ${[...r.fails, ...r.warns].join("; ")}`); }
  if (baseline) L.push("", "## Baseline", "", `- Frozen ${baseline.date}: ${baseline.pages.length} pages with traffic or links. Parts not available: ${Object.entries(baseline.parts).filter(([, v]) => v.status === "blocked").map(([k, v]) => `${k} (${v.blocked?.unblock || ""})`).join("; ") || "none"}.`);
  fs.writeFileSync(path.join(dir, "report.md"), L.join("\n") + "\n");
  writeJson(path.join(dir, "report.json"), { date, oldUrl, newSpec, headline: head, inventory: inv.counts, map: map?.summary || null, gate: gate?.summary || null, gatePassed: gate?.passed ?? null, parts: inv.parts, numbers: [fact(inv.counts.total, "old-site inventory (snapshot, sitemap, Search Console, links)", inv.generatedAt, path.join(dir, "inventory.json")), fact(inv.counts.mustKeep, "inventory rows with traffic, links, visibility or the homepage", inv.generatedAt, path.join(dir, "inventory.json"))] });
}

// ---------- orchestration ----------
export async function runMigrate(oldUrl, newSpec, opts = {}) {
  const cwd = opts.cwd || process.cwd(); const loc = locate(oldUrl, { cwd });
  const dir = path.join(loc.pewp, "migrate"); fs.mkdirSync(dir, { recursive: true });
  const date = opts.today || ymd(new Date()); const stage = opts.stage || "all"; const run = (s) => stage === "all" || stage === s;
  const log = opts.log || console.log; const result = { dir, stages: {} };
  const homeOk = opts.homeOk || [];
  let inv = readJson(path.join(dir, "inventory.json"));
  if (run("inventory") || !inv) { inv = await buildInventory({ oldUrl, loc, opts, env: opts.env || process.env }); writeJson(path.join(dir, "inventory.json"), inv); result.stages.inventory = inv.counts; log(`inventory: ${inv.counts.total} URLs, ${inv.counts.mustKeep} must keep; ${Object.entries(inv.parts).filter(([, v]) => v?.status === "blocked").map(([k, v]) => `${k} BLOCKED (${v.blocked.reason})`).join("; ") || "no part blocked"}`); }
  let map = readJson(path.join(dir, "redirect-map.json")), newSite = null;
  if (run("map") || (run("gate") && !map)) {
    newSite = await readNewSite(newSpec, { loc, opts });
    const csvPath = path.join(dir, "redirect-map.csv");
    const overrides = opts.overrides ? parseCsv(fs.readFileSync(opts.overrides, "utf8")) : [];
    map = buildRedirectMap(inv, newSite, { overrides, homeOk, minScore: opts.minScore ?? 0.5, existingCsv: fs.existsSync(csvPath) ? parseCsv(fs.readFileSync(csvPath, "utf8")) : null });
    fs.writeFileSync(csvPath, mapToCsv(map.rows)); writeJson(path.join(dir, "redirect-map.json"), map);
    const em = emitRedirects(map.rows, { includeSuggestions: !!opts.includeSuggestions }); fs.writeFileSync(path.join(dir, "_redirects"), em.text);
    const qp = readJson(path.join(dir, "baseline-queries.json")) || (latestMeasureDir(loc.pewp) ? (readJson(path.join(latestMeasureDir(loc.pewp), "gsc.json"))?.tables?.current?.queryPage || []).map((x) => ({ query: x.keys[0], page: x.keys[1], clicks: x.clicks })) : []);
    const co = carryOver(map, inv, newSite, qp); writeJson(path.join(dir, "carryover.json"), { source: newSite.source, rows: co, flagged: co.filter((c) => !c.ok).length });
    result.stages.map = { ...map.summary, activeRules: em.active, carryOverFlagged: co.filter((c) => !c.ok).length };
    log(`map: ${JSON.stringify(map.summary)}; _redirects has ${em.active} active rules; carry-over flags ${co.filter((c) => !c.ok).length}`);
  }
  if (run("baseline")) { const b = await buildBaseline({ inv, map, loc, date, opts, fetchImpl: opts.fetchImpl || fetch }); writeJson(path.join(dir, `baseline-${date}.json`), b); result.stages.baseline = { pages: b.pages.length, blocked: Object.entries(b.parts).filter(([, v]) => v.status === "blocked").map(([k]) => k) }; log(`baseline: ${b.pages.length} pages; BLOCKED parts: ${result.stages.baseline.blocked.join(", ") || "none"}`); result.baseline = b; }
  if (run("gate")) {
    const origin = opts.newOrigin || (/^https?:/i.test(newSpec) ? new URL(newSpec).origin : null);
    if (!origin) { result.stages.gate = { status: "blocked", reason: "the new site is a folder: give --new-origin <url of the running preview or the live new site>" }; log("gate: BLOCKED, " + result.stages.gate.reason); }
    else {
      const gate = await runGate({ inv, map, newOrigin: origin, gapMs: opts.gapMs ?? 1000, maxUrls: opts.maxUrls ?? 500, homeOk, exclude: opts.exclude || [], fetchImpl: opts.fetchImpl || fetch, log });
      writeJson(path.join(dir, `gate-${date}.json`), gate); result.stages.gate = gate.summary; result.gate = gate; result.exit = gate.stopped429 ? 3 : gate.passed ? 0 : 1;
      const md = [`# Redirect gate ${date}: ${gate.passed ? "PASS" : "FAIL"}`, "", ...(gate.nothingToCheck ? [`NOTHING CHECKED: ${gate.nothingToCheck}.`, ""] : []), `${gate.summary.pass} pass, ${gate.summary.warn} warn, ${gate.summary.fail} fail of ${gate.summary.checked} checked${gate.stopped429 ? `; STOPPED at a 429 (${gate.stopped429}); ${gate.notChecked} not checked` : ""}${gate.excluded.length ? `; ${gate.excluded.length} off-limits address(es) not requested (--exclude): ${gate.excluded.join(", ")}` : ""}`, "", ...gate.rows.filter((r) => r.verdict !== "PASS").map((r) => `- ${r.verdict} ${r.path}: ${[...r.fails, ...r.warns].join("; ")}`)];
      // REF-014: the old site's image URLs (opt-in with --images: it needs the old snapshot and costs one request per image)
      if (opts.images) {
        const snapDir = inv.parts?.snapshot?.dir;
        if (!snapDir || !fs.existsSync(path.join(snapDir, "_site.json"))) { gate.images = { rule: "REF-014", status: "BLOCKED", reason: "no complete old snapshot to read the image URLs from", unblock: `Run live-target.mjs ${oldUrl} (polite crawl), or pass --snapshot-dir.` }; log("images: BLOCKED, " + gate.images.reason); gate.passed = false; result.exit = result.exit || 1; writeJson(path.join(dir, `gate-${date}.json`), gate); }
        else {
          const imgs = await checkImages(inventoryImages(snapDir), { newOrigin: origin, removed: { routes: (map?.rows || []).filter((r) => r.gone && r.approved !== "no").map((r) => r.from) }, mustKeep: inv.rows.filter((r) => r.mustKeep).map((r) => r.path), scope: opts.imageScope || "all", gapMs: opts.gapMs ?? 1000, max: opts.imageMax ?? 2000, exclude: opts.exclude || [], fetchImpl: opts.fetchImpl || fetch, log });
          gate.images = imgs; writeJson(path.join(dir, `images-${date}.json`), imgs); fs.writeFileSync(path.join(dir, `images-${date}.md`), imagesMarkdown(imgs));
          if (imgs.status === "FAIL") gate.passed = false;
          if (imgs.status === "STOPPED") { gate.stopped429 = gate.stopped429 || imgs.stopped429; gate.passed = false; }
          md.push("", `## Image URLs (REF-014): ${imgs.status}`, "", `${imgs.summary.pass} of ${imgs.summary.checked} pass, ${imgs.summary.fail} fail; ${imgs.summary.exempt} exempt, ${imgs.summary.otherHost} on other hosts, ${imgs.summary.notChecked} not checked`, ...imgs.rows.filter((r) => r.verdict === "FAIL").map((r) => `- FAIL ${r.path} [${r.finding}]: ${r.detail}`));
          log(`images: ${imgs.status} ${JSON.stringify(imgs.summary)}`);
          result.stages.images = imgs.summary; result.exit = gate.stopped429 ? 3 : gate.passed ? 0 : 1;
          writeJson(path.join(dir, `gate-${date}.json`), gate);
        }
      }
      fs.writeFileSync(path.join(dir, `gate-${date}.md`), md.join("\n") + "\n");
      log(`gate: ${gate.passed ? "PASS" : "FAIL"} ${JSON.stringify(gate.summary)}${gate.nothingToCheck ? ` NOTHING CHECKED (${gate.nothingToCheck})` : ""}${gate.stopped429 ? " STOPPED 429" : ""}${gate.excluded.length ? ` (${gate.excluded.length} excluded, not checked)` : ""}`);
    }
  }
  if (run("monitor") && stage !== "all") {
    const bf = fs.readdirSync(dir).filter((f) => /^baseline-.*\.json$/.test(f)).sort().at(-1); const mdir = latestMeasureDir(loc.pewp);
    if (!bf || !mdir) { result.stages.monitor = { status: "blocked", reason: !bf ? "no baseline yet: run --stage baseline before the cutover" : "no measure run yet: run measure daily after the cutover" }; log("monitor: BLOCKED, " + result.stages.monitor.reason); }
    else {
      const sf = path.join(dir, "state.json"); const st = readJson(sf, {}) || {}; if (opts.cutover) { st.cutover = opts.cutover; writeJson(sf, st); }
      const mon = runMonitor({ baseline: readJson(path.join(dir, bf)), mdir, cutover: opts.cutover || st.cutover, today: date, map });
      writeJson(path.join(dir, `monitor-${date}.json`), mon); result.stages.monitor = mon.status === "ok" ? { dayOfMonitoring: mon.dayOfMonitoring, totals: mon.totals, dropped: mon.droppedPages.length, notSeen: mon.pagesNotSeenAtAll.length } : mon; log(`monitor: ${JSON.stringify(result.stages.monitor)}`);
    }
  }
  writeMigrateReport(dir, { oldUrl, newSpec, inv, map, gate: result.gate, baseline: result.baseline, date });
  markStage(loc, "migrate", { "migrate dir": dir }, { stage, date });
  return result;
}

export const STAGES = ["inventory", "map", "baseline", "gate", "monitor", "all"];
// The command line -> runMigrate options, or { error } (exit 2). A typo must never run as something else: an unknown --stage ran no
// stage and exited 0; "--max-urls abc" became NaN, so the gate checked 0 of 0 addresses and PASSED; "--gap-ms abc" made the polite
// gap ~1 ms; a bad --today or --cutover crashed later with a RangeError.
export function parseCli(a, cwd = process.cwd()) {
  const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d); const all = (k) => a.flatMap((x, i) => (x === k ? [a[i + 1]] : []));
  if (a.length < 2 || a[0].startsWith("--") || !/^https?:\/\//i.test(a[0])) return { error: "usage: node migrate.mjs <old url> <new url|dir> --stage inventory|map|baseline|gate|monitor|all [options, see the file header]" };
  // Git Bash rewrites "^/x" into a Windows path, which would turn an exclude into a rule that matches nothing (same refusal as snapshot-site.mjs).
  const mangled = all("--exclude").filter((x) => /^\^?[A-Za-z]:[\\/]/.test(x) || /[\\/]Program Files[\\/]Git[\\/]/i.test(x));
  if (mangled.length) return { error: `REFUSED: --exclude was rewritten by the shell (${mangled.join(" | ")}). Run from PowerShell, or prefix the command with MSYS_NO_PATHCONV=1. Nothing was fetched.` };
  for (const x of all("--exclude")) { try { new RegExp(x); } catch (e) { return { error: `--exclude "${x}" is not a valid regular expression (${e.message}). Nothing was fetched.` }; } }
  const stage = opt("--stage", "all");
  if (!STAGES.includes(stage)) return { error: `--stage must be one of ${STAGES.join(", ")} (got ${stage})` };
  for (const k of ["--today", "--cutover"]) if (opt(k) != null && !isDay(opt(k))) return { error: `${k} must be a real day as YYYY-MM-DD (got ${opt(k)})` };
  const num = (k, { min = 0, int = false } = {}) => {
    if (!a.includes(k)) return { v: undefined };
    const raw = opt(k), v = Number(raw);
    if (raw == null || raw === "" || !Number.isFinite(v) || v < min || (int && !Number.isInteger(v))) return { error: `${k} must be ${int ? "a whole number" : "a number"} of at least ${min} (got ${raw})` };
    return { v };
  };
  const n = { gscDays: num("--gsc-days", { min: 1, int: true }), minScore: num("--min-score"), gapMs: num("--gap-ms"), maxUrls: num("--max-urls", { min: 1, int: true }), imageMax: num("--image-max", { min: 1, int: true }) };
  const bad = Object.values(n).find((x) => x.error);
  if (bad) return { error: bad.error };
  if (n.minScore.v != null && n.minScore.v > 1) return { error: `--min-score is a similarity from 0 to 1 (got ${n.minScore.v})` };
  // Politeness (lib-polite.mjs): a gap below MIN_GAP_MS only when every site this run requests is on this machine. The old site is
  // requested by --probe-old and --fetch-sitemap (default gap there: POLITE_GAP_MS, 4 s, like snapshot-site); the new one by the gate
  // and by the map stage when <new> is a URL.
  if (n.gapMs.v != null && n.gapMs.v < MIN_GAP_MS) {
    const touches = [a.includes("--probe-old") || a.includes("--fetch-sitemap") ? a[0] : null,
      ["gate", "map", "all"].includes(stage) ? opt("--new-origin") || (/^https?:\/\//i.test(a[1]) ? a[1] : null) : null].filter(Boolean);
    const remote = touches.find((u) => !isLocalUrl(u));
    if (remote) return { error: `--gap-ms ${n.gapMs.v} is below the polite minimum of ${MIN_GAP_MS} ms for a site this machine does not serve (${remote}). Nothing was fetched.` };
  }
  return { oldUrl: a[0], newSpec: a[1], opts: { cwd: opt("--cwd", cwd), stage, today: opt("--today"), gscFile: opt("--gsc-file"), gscDays: n.gscDays.v ?? null, linksCsv: opt("--links-csv"), bingLinks: a.includes("--bing-links"), exclude: all("--exclude"),
    fetchSitemap: a.includes("--fetch-sitemap"), overrides: opt("--overrides"), homeOk: (opt("--home-ok", "") || "").split(",").filter(Boolean), minScore: n.minScore.v, newOrigin: opt("--new-origin"), gapMs: n.gapMs.v,
    maxUrls: n.maxUrls.v, probeOld: a.includes("--probe-old"), cutover: opt("--cutover"), snapshotDir: opt("--snapshot-dir"), includeSuggestions: a.includes("--include-suggestions"), images: a.includes("--images"), imageScope: opt("--image-scope"), imageMax: n.imageMax.v } };
}

if (isMain(import.meta.url)) {
  const p = parseCli(process.argv.slice(2));
  if (p.error) { console.error(p.error); process.exitCode = 2; }
  else {
    let r = null;
    try { r = await runMigrate(p.oldUrl, p.newSpec, p.opts); }
    catch (e) { if (!(e instanceof Stop429)) throw e; console.error("STOPPED: " + e.message); }
    process.exitCode = r ? r.exit ?? 0 : 3; // not process.exit(): exiting while fetch sockets are closing can crash Node on Windows
  }
}
