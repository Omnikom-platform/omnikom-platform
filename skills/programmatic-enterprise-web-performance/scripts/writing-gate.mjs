// The WRITING GATE: 7 rules every V2 site's build must obey, checked here independently on the BUILT site (stages/build.md, "The
// writing gate"; stages/launch.md, the `writing` check). Each rule is a habit that PageSpeed Insights listed as red on the first
// real V2 site (ELEV8, 2026-10-29): a render-blocking stylesheet, unused CSS, a hero image sized for the wrong slot, a forced
// reflow in site.js, <form role="tabpanel">, no /llms.txt, no Cross-Origin-Opener-Policy.
// Usage: node writing-gate.mjs <built site dir> [--pages /a,/b] [--url <live base>] [--psi-dir <dir of saved PSI v5 json>] [--json <out>]
//                              [--only WG-1,WG-4] [--viewports 390x844,1366x900] [--max-pages 12] [--wg4 trace|static]
// Output: `pages:` line, then one first line per rule `PASS|FAIL|NOT RUN WG-n <number and summary>` with indented detail lines, then
// a summary line `PASS|FAIL|ERROR writing-gate 7 rules: ...`. Exit 0 all PASS, 1 any FAIL, 2 none failed but a rule could not run
// (also a usage error).
//   WG-1 critical CSS inline, rest deferred  static parse of <head>: no render-blocking stylesheet; inline <style> <= 14 KiB gzip; a
//                                            media="print" sheet with no onload must be flipped by a script: proven in Chromium after load
//   WG-2 unused CSS under 8 KiB gzip per page Chromium CSS coverage, loaded, scrolled to the bottom and back; wasted = each sheet's unused
//                                            share of its gzip size (PageSpeed flags wasted transfer bytes; calibrated 2026-10-29: 34-52%
//                                            unused by coverage was green, its one red was 10.2 KiB wasted)
//   WG-3 images sized to the slot            Chromium at each viewport (DPR 1): sizes present, 100vw only on full-width images, the
//                                            chosen srcset candidate <= the first step at or above 1.5 x the rendered width
//   WG-4 no forced reflow from our scripts   Chromium trace (Layout events whose JS stack has a same-origin frame; style recalculations
//                                            are listed, not gated: PageSpeed attributes forced layout only);
//                                            falls back to a static read-after-write lint when tracing is unusable (it says which ran)
//   WG-5 ARIA roles only on compatible elements   static, every built page, lib-aria-roles.mjs
//   WG-6 agent readiness                     /llms.txt (H1, markdown links that resolve) and WG-5 = 0; with --url the live file too
//   WG-7 security headers                    `_headers` (Cloudflare Pages) `/*` block has Strict-Transport-Security and
//                                            Cross-Origin-Opener-Policy; with --url the live responses of each page too
// --psi-dir: saved PageSpeed v5 answers add evidence lines (they never replace a measurement) and FAIL the matching rule when they
// contradict it: render-blocking-insight savings 0 ms (WG-1), unused-css-rules wastedPercent <= 20 (WG-2), image-delivery-insight
// wasted <= 10 KiB (WG-3), forced-reflow-insight total 0 ms (WG-4), aria-allowed-role items 0 (WG-5). The files are read from disk.
// Read-only: the site is served from 127.0.0.1 and every non-local request of the browser is refused; --url only GETs /llms.txt and
// the pages given (one request every second for a non-local host).
import fs from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { serve, launch, Blocked, UsageError, opt } from "./lib-shots.mjs";
import { roleViolations, startTags } from "./lib-aria-roles.mjs";

const USAGE = "usage: node writing-gate.mjs <built site dir> [--pages /a,/b] [--url <live base>] [--psi-dir <dir>] [--json <out>] [--only WG-1,...] [--viewports 390x844,1366x900] [--max-pages 12] [--wg4 trace|static]";
const VALUE_FLAGS = ["--pages", "--url", "--psi-dir", "--json", "--only", "--viewports", "--max-pages", "--wg4"];
const TITLES = {
  "WG-1": "critical CSS inline, rest deferred", "WG-2": "unused CSS under 8 KiB gzip per page", "WG-3": "images sized to the slot",
  "WG-4": "no forced reflow from our own scripts", "WG-5": "ARIA roles only on compatible elements", "WG-6": "agent readiness (llms.txt)",
  "WG-7": "security headers (HSTS, COOP)",
};
const IDS = Object.keys(TITLES);
const INLINE_CSS_MAX = 14 * 1024, WASTED_CSS_MAX = 8 * 1024, IMG_FULLWIDTH = 0.95, IMG_RATIO = 1.5, PSI_IMG_KIB = 10;
const kib = (n) => (n / 1024).toFixed(1) + " KiB";
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(h) || /\.(localhost|test)$/i.test(h);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- the built site ----------------
function walkHtml(root) {
  const out = [];
  (function go(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) go(f);
      else if (/\.html?$/i.test(e.name)) out.push(f);
    }
  })(root);
  return out.sort();
}
// file -> the URL path it answers on (index.html -> its folder)
const urlPathOf = (root, f) => {
  const rel = path.relative(root, f).split(path.sep).join("/");
  return "/" + rel.replace(/(^|\/)index\.html?$/i, "$1");
};
// a URL path -> the built file that answers it, or null
function fileOfUrlPath(root, p) {
  let rel = decodeURIComponent(p.split(/[?#]/)[0]).replace(/^\/+/, "");
  const cands = rel === "" || rel.endsWith("/") ? [rel + "index.html"] : [rel, rel + ".html", rel + "/index.html"];
  for (const c of cands) {
    const f = path.resolve(root, c);
    if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}
// one page per folder pattern: top-level pages (/team/, /home-value/) are each their own template; deeper pages share their parent folder
function samplePages(all, max) {
  const seen = new Set(), out = [];
  for (const p of all) {
    const segs = p.split("/").filter(Boolean);
    const key = segs.length <= 1 ? p : "/" + segs.slice(0, -1).join("/") + "/*";
    if (seen.has(key)) continue;
    seen.add(key); out.push(p);
  }
  return out.slice(0, max);
}

// ---------------- WG-1: head CSS ----------------
function headOf(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const m = clean.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  if (m) return m[1];
  const b = clean.search(/<body\b/i);
  return b >= 0 ? clean.slice(0, b) : clean;
}
function wg1Page(html) {
  const head = headOf(html);
  const noscripts = [...head.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript\s*>/gi)].map((m) => m[1]);
  const headNo = head.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "");
  const bad = [], deferred = [], scripted = [];
  for (const t of startTags(headNo.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ""))) {
    if (t.tag !== "link") continue;
    const rel = String(t.attrs.rel || "").toLowerCase().split(/\s+/);
    if (rel.includes("preload") && String(t.attrs.as || "").toLowerCase() === "style") { deferred.push(t.attrs.href || "?"); continue; }
    if (!rel.includes("stylesheet")) continue;
    const media = String(t.attrs.media || "").trim().toLowerCase();
    if (media === "print") { deferred.push(t.attrs.href || "?"); if (t.attrs.onload === undefined) scripted.push(t.attrs.href || "?"); continue; }
    bad.push(`${t.attrs.href} blocks the first paint (<link rel="stylesheet"${media ? ` media="${media}"` : ""}> in <head>)`);
  }
  let inlineRaw = 0, inlineText = "";
  for (const m of head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    inlineRaw += Buffer.byteLength(m[1]); inlineText += m[1];
    if (/@import\b/i.test(m[1])) bad.push("an inline <style> has @import (a blocking chain)");
  }
  const fallback = noscripts.some((n) => /<link\b[^>]*rel\s*=\s*["']?stylesheet/i.test(n));
  if (deferred.length && !fallback) bad.push(`${deferred.length} deferred stylesheet(s) but no <noscript><link rel="stylesheet"> fallback in <head>`);
  const inline = inlineText ? gzipSync(Buffer.from(inlineText)).length : 0;   // the budget is the compressed size, as it travels
  if (inline > INLINE_CSS_MAX) bad.push(`inline <style> in <head> is ${kib(inline)} gzip (${kib(inlineRaw)} raw; limit ${INLINE_CSS_MAX / 1024} KiB gzip)`);
  return { bad, inline, inlineRaw, deferred: deferred.length, scripted };
}

// ---------------- WG-2/3/4 in Chromium ----------------
const parseViewports = (s) => s.split(",").map((v) => {
  const m = v.trim().match(/^(\d{2,5})x(\d{2,5})$/);
  if (!m) throw new UsageError(`--viewports: ${v} is not WIDTHxHEIGHT`);
  return { width: Number(m[1]), height: Number(m[2]), name: v.trim() };
});
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = Math.max(200, Math.floor(innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await wait(60); }
    scrollTo(0, document.documentElement.scrollHeight); await wait(150);
    scrollTo(0, 0); await wait(100);
  });
}
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
}
async function newContext(browser, vp, origin) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, serviceWorkers: "block" });
  await ctx.route("**/*", (route) => {
    let h = ""; try { h = new URL(route.request().url()).hostname; } catch {}
    return /^(127\.0\.0\.1|localhost|\[::1\])$/.test(h) || route.request().url().startsWith("data:") ? route.continue() : route.abort();
  });
  return ctx;
}

async function coverageOf(browser, vp, url, origin) {
  const ctx = await newContext(browser, vp, origin), page = await ctx.newPage();
  try {
    await page.coverage.startCSSCoverage({ resetOnNavigation: false });
    await page.goto(url, { waitUntil: "load", timeout: 25000 });
    await settle(page);
    await scrollThrough(page);
    await settle(page);
    const cov = await page.coverage.stopCSSCoverage();
    let total = 0, used = 0, sheets = 0, wasted = 0;
    for (const c of cov) {
      if (!c.url.startsWith(origin)) continue;
      sheets++; total += c.text.length;
      let u = 0; for (const r of c.ranges) u += r.end - r.start;
      used += u;
      if (c.text.length) wasted += (1 - u / c.text.length) * gzipSync(Buffer.from(c.text)).length;   // this sheet's unused share, as it travels
    }
    return { total, used, sheets, wasted };
  } finally { await ctx.close(); }
}

function parseSrcset(s) {
  const out = [];
  for (const m of String(s || "").matchAll(/\s*([^\s,][^\s]*)(?:\s+(\d+(?:\.\d+)?)([wx]))?\s*(?:,|$)/g)) out.push({ url: m[1], v: m[2] ? Number(m[2]) : null, unit: m[3] || null });
  return out;
}
async function imagesOf(browser, vp, url) {
  const ctx = await newContext(browser, vp), page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: 25000 });
    await settle(page);
    await scrollThrough(page);
    await settle(page);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 5000 }).catch(() => {});
    return await page.evaluate(() => [...document.images].map((img) => {
      const r = img.getBoundingClientRect(), cs = getComputedStyle(img);
      let srcset = img.getAttribute("srcset"), sizes = img.getAttribute("sizes");
      const pic = img.parentElement && img.parentElement.tagName === "PICTURE" ? img.parentElement : null;
      if (pic) for (const s of pic.querySelectorAll("source[srcset]")) {
        const urls = s.getAttribute("srcset").split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean).map((u) => { try { return new URL(u, document.baseURI).href; } catch { return u; } });
        if (urls.includes(img.currentSrc)) { srcset = s.getAttribute("srcset"); sizes = s.getAttribute("sizes"); }
      }
      const urls = srcset ? srcset.split(",").map((x) => x.trim()) : [];
      return {
        tag: img.outerHTML.slice(0, 160).replace(/\s+/g, " "), currentSrc: img.currentSrc, srcset, sizes,
        resolved: urls.map((x) => { const u = x.split(/\s+/)[0]; try { return new URL(u, document.baseURI).href; } catch { return u; } }),
        width: r.width, height: r.height, visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden",
        vw: document.documentElement.clientWidth,
      };
    }));
  } finally { await ctx.close(); }
}
// one image -> { problems: [], ratio, chosenW } ; null when it is not subject to the rule
function judgeImage(im) {
  if (!im.visible || !im.srcset) return null;
  const cands = parseSrcset(im.srcset).map((c, i) => ({ ...c, abs: im.resolved[i] }));
  const hasW = cands.some((c) => c.unit === "w");
  const problems = [];
  if (hasW && (im.sizes === null || im.sizes.trim() === "")) problems.push("srcset with w descriptors but no sizes (the browser assumes 100vw)");
  if (im.sizes && im.sizes.trim().toLowerCase() === "100vw" && im.width < IMG_FULLWIDTH * im.vw) problems.push(`sizes="100vw" but the image is ${Math.round(im.width)} px wide in a ${im.vw} px viewport (${Math.round((im.width / im.vw) * 100)}%, needs >= 95%)`);
  let chosenW = null, ratio = null;
  if (hasW && im.currentSrc) {
    const w = cands.filter((c) => c.unit === "w").sort((a, b) => a.v - b.v);
    const chosen = w.find((c) => c.abs === im.currentSrc);
    if (chosen) {
      chosenW = chosen.v; ratio = chosen.v / im.width;
      const limit = w.find((c) => c.v >= IMG_RATIO * im.width) || w[w.length - 1];
      if (chosen.v > limit.v) problems.push(`chose the ${chosen.v}w candidate for a ${Math.round(im.width)} px slot (limit: ${limit.v}w, the first step at or above 1.5 x ${Math.round(im.width)} = ${Math.round(IMG_RATIO * im.width)})`);
    }
  }
  return { problems, ratio, chosenW };
}

async function traceOf(browser, vp, url, origin) {
  const ctx = await newContext(browser, vp, origin), page = await ctx.newPage();
  try {
    await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.stack"] });
    let buf;
    try {
      await page.goto(url, { waitUntil: "load", timeout: 25000 });
      await settle(page);
      await scrollThrough(page);
      const btn = page.locator("button[aria-expanded]").first();
      if (await btn.count()) { try { await btn.click({ timeout: 2000 }); await page.waitForTimeout(300); } catch { /* hidden or covered at this viewport: not a failure */ } }
      await page.waitForTimeout(200);
    } finally { buf = await browser.stopTracing(); }
    const j = JSON.parse(buf.toString("utf8"));
    const events = Array.isArray(j) ? j : j.traceEvents || [];
    if (!events.length) throw new Error("the trace has no events");
    const hits = [];
    for (const e of events) {
      if (e.name !== "Layout" && e.name !== "UpdateLayoutTree") continue;
      const st = e.args?.beginData?.stackTrace;
      if (!Array.isArray(st)) continue;
      const own = st.find((f) => typeof f.url === "string" && f.url.startsWith(origin));
      if (own) hits.push({ name: e.name, where: `${own.url.slice(origin.length) || "/"}:${own.lineNumber + 1}`, ms: (e.dur || 0) / 1000 });
    }
    return { events: events.length, hits };
  } finally { await ctx.close(); }
}

// ---------------- WG-4 static fallback ----------------
const WRITE = /\.classList\.(?:add|remove|toggle|replace)\s*\(|\.style\.[A-Za-z]+\s*=(?!=)|\.style\.(?:setProperty|removeProperty|cssText)\b|\.hidden\s*=(?!=)|\.className\s*=(?!=)|setAttribute\(\s*['"](?:class|style|hidden)['"]/g;
const READ = /\.(?:offsetWidth|offsetHeight|offsetTop|offsetLeft|scrollHeight|scrollWidth|scrollTop|clientWidth|clientHeight|clientTop|clientLeft)\b|\.getBoundingClientRect\s*\(|\bgetComputedStyle\s*\(/g;
function functionBodies(src) {
  const bodies = [], re = /(=>\s*\{|\bfunction\b[^{(]*\([^)]*\)\s*\{|\b(?!if\b|for\b|while\b|switch\b|catch\b|with\b)[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{)/g;
  for (const m of src.matchAll(re)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) { const c = src[i]; if (c === "{") depth++; else if (c === "}") depth--; i++; }
    bodies.push({ start: m.index + m[0].length, end: i, text: src.slice(m.index + m[0].length, i), at: m.index });
  }
  return bodies;
}
// -> [{ line, write, read }] one per function body that reads layout after it wrote styles
export function lintReadAfterWrite(src) {
  const hits = [], seen = new Set();
  for (const b of functionBodies(src)) {
    const w = [...b.text.matchAll(WRITE)].map((m) => m.index), r = [...b.text.matchAll(READ)].map((m) => ({ i: m.index, t: m[0] }));
    if (!w.length) continue;
    const firstW = Math.min(...w), rd = r.find((x) => x.i > firstW);
    if (!rd) continue;
    const abs = b.start + rd.i, line = src.slice(0, abs).split("\n").length;
    if (seen.has(line)) continue;
    seen.add(line);
    hits.push({ line, read: rd.t.replace(/[.(\s]/g, ""), write: b.text.slice(firstW, firstW + 40).split("\n")[0] });
  }
  return hits;
}
function ownScripts(root, pageFiles) {
  const out = [];
  (function go(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) go(f);
      else if (/\.m?js$/i.test(e.name)) out.push({ name: path.relative(root, f).split(path.sep).join("/"), src: fs.readFileSync(f, "utf8") });
    }
  })(root);
  for (const f of pageFiles) {
    const html = fs.readFileSync(f, "utf8");
    let n = 0;
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      n++;
      if (/\bsrc\s*=/i.test(m[1]) || /type\s*=\s*["']?(?:application\/(?:ld\+)?json|importmap|speculationrules)/i.test(m[1]) || !m[2].trim()) continue;
      out.push({ name: `${urlPathOf(root, f)} <script #${n}>`, src: m[2] });
    }
  }
  return out;
}

// ---------------- WG-6/7 helpers ----------------
function parseHeadersFile(text) {
  const blocks = new Map();
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      const m = raw.trim().match(/^([A-Za-z0-9-]+)\s*:\s*(.*)$/);
      if (cur && m) blocks.get(cur)[m[1].toLowerCase()] = m[2];
    } else { cur = raw.trim(); if (!blocks.has(cur)) blocks.set(cur, {}); }
  }
  return blocks;
}
async function liveGet(url, gapState) {
  let h = ""; try { h = new URL(url).hostname; } catch {}
  if (!isLocal(h)) { const wait = gapState.last + 1000 - Date.now(); if (wait > 0) await sleep(wait); }
  try {
    const r = await fetch(url, { redirect: "manual", headers: { "user-agent": "omnikom-writing-gate/1 (read-only; GET only)" }, signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    return { status: r.status, headers: r.headers, body };
  } catch (e) { return { status: 0, error: e.name === "TimeoutError" ? "no answer in 20 s" : (e.cause?.code || e.message), headers: new Headers(), body: "" }; }
  finally { gapState.last = Date.now(); }
}

// ---------------- PSI evidence ----------------
function loadPsi(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UsageError(`--psi-dir is not a folder: ${dir}`);
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => /\.json$/i.test(x)).sort()) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    const lh = j.lighthouseResult;
    if (!lh?.audits) continue;
    let p = "/"; try { p = new URL(lh.finalUrl || lh.requestedUrl).pathname; } catch {}
    out.push({ file: f, label: `${lh.configSettings?.formFactor || "?"} ${p}`, audits: lh.audits });
  }
  return out;
}
const sumKey = (o, key) => { // every numeric `key` anywhere inside o
  let t = 0;
  (function go(x) { if (Array.isArray(x)) x.forEach(go); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === key && typeof v === "number") t += v; else go(v); } })(o);
  return t;
};
// -> { "WG-1": [{ ok, line }], ... }
function psiEvidence(files) {
  const ev = Object.fromEntries(IDS.map((id) => [id, []]));
  const add = (id, ok, line) => ev[id].push({ ok, line });
  for (const { label, audits, file } of files) {
    const a = audits["render-blocking-insight"] || audits["render-blocking-resources"];
    if (!a) add("WG-1", null, `psi ${label} (${file}): render-blocking-insight is not in this file`);
    else {
      const ms = Math.max(a.metricSavings?.FCP || 0, a.metricSavings?.LCP || 0, a.details?.overallSavingsMs || 0, sumKey(a.details?.items || [], "wastedMs"));
      add("WG-1", ms === 0, `psi ${label}: render-blocking savings ${Math.round(ms)} ms (want 0)`);
    }
    const u = audits["unused-css-rules"];
    if (!u) add("WG-2", null, `psi ${label} (${file}): unused-css-rules is not in this file`);
    else {
      const bytes = sumKey(u.details?.items || [], "wastedBytes");
      add("WG-2", bytes <= WASTED_CSS_MAX, `psi ${label}: unused-css-rules wasted ${kib(bytes)} (want <= ${WASTED_CSS_MAX / 1024} KiB)`);
    }
    const im = audits["image-delivery-insight"] || audits["uses-optimized-images"];
    if (!im) add("WG-3", null, `psi ${label} (${file}): image-delivery-insight is not in this file`);
    else {
      const bytes = sumKey(im.details?.items || [], "wastedBytes");
      add("WG-3", bytes <= PSI_IMG_KIB * 1024, `psi ${label}: image-delivery wasted ${kib(bytes)} (want <= ${PSI_IMG_KIB} KiB)`);
    }
    const fr = audits["forced-reflow-insight"];
    if (!fr) add("WG-4", null, `psi ${label} (${file}): forced-reflow-insight is not in this file`);
    else {
      // only reflows PageSpeed attributes to a script (a source location); "[unattributed]" rows are the browser's own work
      const rows = []; (function go(x) { if (Array.isArray(x)) x.forEach(go); else if (x && typeof x === "object") { if (x.source && typeof x.reflowTime === "number") rows.push(x); else for (const v of Object.values(x)) go(v); } })(fr.details?.items || []);
      const ours = rows.filter((r) => r.source && r.source.type === "source-location"), ms = ours.reduce((s, r) => s + r.reflowTime, 0), other = rows.length - ours.length;
      add("WG-4", ms <= 0, `psi ${label}: forced-reflow from scripts ${Math.round(ms)} ms (want 0)${other ? `; ${other} unattributed row(s) not counted` : ""}`);
    }
    const ar = audits["aria-allowed-role"];
    if (!ar) add("WG-5", null, `psi ${label} (${file}): aria-allowed-role is not in this file`);
    else {
      const n = (ar.details?.items || []).length;
      add("WG-5", n === 0, `psi ${label}: aria-allowed-role items ${n} (want 0)`);
    }
  }
  return ev;
}

// ---------------- the run ----------------
export async function runGate(opts) {
  const root = path.resolve(opts.dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`not a folder: ${root}`);
  const only = opts.only ? new Set(opts.only) : new Set(IDS);
  for (const id of only) if (!TITLES[id]) throw new UsageError(`--only: ${id} is not a rule (${IDS.join(" ")})`);
  const vps = parseViewports(opts.viewports || "390x844,1366x900");
  const live = opts.url ? new URL(opts.url) : null;
  const rules = Object.fromEntries(IDS.map((id) => [id, { id, title: TITLES[id], status: "NOT RUN", summary: "not run", details: [] }]));
  const set = (id, status, summary, details = []) => { Object.assign(rules[id], { status, summary, details }); };

  // pages
  const allFiles = walkHtml(root);
  if (!allFiles.length) throw new UsageError(`no .html file in ${root}`);
  const byPath = allFiles.map((f) => ({ f, p: urlPathOf(root, f) })).sort((x, y) => (x.p === "/" ? -1 : y.p === "/" ? 1 : x.p < y.p ? -1 : x.p > y.p ? 1 : 0));
  allFiles.splice(0, allFiles.length, ...byPath.map((x) => x.f));
  const allPaths = byPath.map((x) => x.p);
  let pages, missing = [];
  if (opts.pages) {
    pages = []; // [{ path, file }]
    for (const p of opts.pages.split(",").map((s) => s.trim()).filter(Boolean)) {
      const pathOnly = /^https?:\/\//i.test(p) ? new URL(p).pathname : p;
      const f = fileOfUrlPath(root, pathOnly);
      if (f) pages.push({ path: urlPathOf(root, f), file: f }); else missing.push(pathOnly);
    }
  } else {
    const max = Number.isFinite(opts.maxPages) ? opts.maxPages : 12;
    pages = samplePages(allPaths, max).map((p) => ({ path: p, file: allFiles[allPaths.indexOf(p)] }));
  }
  const header = [`pages: ${pages.length} of ${allFiles.length} html file(s) in ${root}${opts.pages ? " (from --pages)" : " (one per folder pattern, max " + (opts.maxPages || 12) + ")"}: ${pages.map((p) => p.path).join(" ")}`];
  if (missing.length) header.push(`pages NOT in the built folder: ${missing.join(" ")}`);
  const staticPages = opts.pages ? pages : allFiles.map((f, i) => ({ path: allPaths[i], file: f }));
  const htmlOf = new Map();
  const html = (f) => { if (!htmlOf.has(f)) htmlOf.set(f, fs.readFileSync(f, "utf8")); return htmlOf.get(f); };

  // PSI evidence
  const psiFiles = opts.psiDir ? loadPsi(path.resolve(opts.psiDir)) : [];
  const ev = psiFiles.length ? psiEvidence(psiFiles) : Object.fromEntries(IDS.map((id) => [id, []]));
  if (opts.psiDir && !psiFiles.length) header.push(`psi-dir ${opts.psiDir}: no PageSpeed v5 json in it (no evidence lines)`);

  // ---- WG-1 ----
  if (only.has("WG-1")) {
    const bad = [], inl = [], scripted = [];
    for (const p of pages) { const r = wg1Page(html(p.file)); inl.push(r.inline); for (const b of r.bad) bad.push(`${p.path}: ${b}`); if (r.scripted.length) scripted.push(p); }
    const mx = Math.max(0, ...inl);
    // a print sheet with no onload is only fine when a script flips it: load the page and look 1.5 s after load
    let swapNote = "";
    if (scripted.length) {
      let browser = null, server = null;
      try {
        browser = await launch(); server = await serve(root);
        const origin = `http://127.0.0.1:${server.port}`, vp = parseViewports(opts.viewports || "390x844,1366x900")[0];
        for (const p of scripted) {
          const ctx = await newContext(browser, vp, origin), page = await ctx.newPage();
          try {
            await page.goto(origin + "/" + path.relative(root, p.file).split(path.sep).join("/"), { waitUntil: "load", timeout: 25000 });
            await settle(page); await page.waitForTimeout(1500);
            const still = await page.evaluate(() => [...document.querySelectorAll("link[rel~=\"stylesheet\"]")].filter((l) => (l.media || "").trim().toLowerCase() === "print").map((l) => l.getAttribute("href")));
            for (const h of still) bad.push(`${p.path}: ${h} is media="print" with no onload and still print 1.5 s after load (never applied)`);
          } catch (e) { bad.push(`${p.path}: the script swap could not be checked: ${e.message.split("\n")[0]}`); }
          finally { await ctx.close(); }
        }
        swapNote = `; ${scripted.length} page(s) with a script-swapped sheet checked in the browser`;
      } catch (e) { bad.push(`${scripted.length} page(s) defer a sheet by script but the browser could not check the swap: ${e instanceof Blocked ? e.message : e.message}`); }
      finally { if (server) await new Promise((r) => server.server.close(r)); if (browser) await browser.close(); }
    }
    const body = `${pages.length} page(s), ${bad.length} problem(s), inline <style> in <head> max ${kib(mx)} gzip (limit ${INLINE_CSS_MAX / 1024} KiB gzip)${swapNote}`;
    set("WG-1", pages.length ? (bad.length ? "FAIL" : "PASS") : "NOT RUN", pages.length ? body : "no page to check", bad.map((b) => b));
  }
  // ---- WG-5 (also feeds WG-6) ----
  const needWg5 = only.has("WG-5") || only.has("WG-6");
  let wg5 = null;
  if (needWg5) {
    const bad = [];
    for (const p of staticPages) for (const v of roleViolations(html(p.file))) bad.push(`${p.path}: role="${v.role}" is not allowed on <${v.tag}> (allowed: ${v.allowed}): ${v.snippet}`);
    wg5 = bad;
    if (only.has("WG-5")) set("WG-5", bad.length ? "FAIL" : "PASS", `${staticPages.length} page(s), ${bad.length} role violation(s)`, bad.slice(0, 20));
  }
  // ---- WG-6 ----
  if (only.has("WG-6")) {
    const d = [], bad = [];
    const f = path.join(root, "llms.txt");
    let txt = null;
    if (!fs.existsSync(f)) bad.push("llms.txt is not in the built folder");
    else txt = fs.readFileSync(f, "utf8").replace(/^﻿/, "");
    let nLinks = 0, nSame = 0;
    if (txt !== null) {
      const first = txt.split(/\r?\n/).find((l) => l.trim());
      if (!first || !/^# \S/.test(first)) bad.push(`llms.txt does not begin with an "# " H1 (first line: ${JSON.stringify((first || "").slice(0, 60))})`);
      const links = [...txt.matchAll(/\[[^\]]+\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]);
      nLinks = links.length;
      if (!links.length) bad.push("llms.txt has no markdown link [text](url)");
      let siteHost = live ? live.host : null;
      if (!siteHost) { const home = fileOfUrlPath(root, "/"); const c = home && html(home).match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']|<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["']/i); try { if (c) siteHost = new URL(c[1] || c[2]).host; } catch {} }
      for (const l of links) {
        let p;
        if (/^(mailto|tel):/i.test(l)) continue;
        if (/^https?:\/\//i.test(l)) { const u = new URL(l); if (!siteHost || u.host !== siteHost) continue; p = u.pathname; } else if (/^\/\//.test(l)) continue; else p = l.startsWith("/") ? l : "/" + l;
        nSame++;
        if (!fileOfUrlPath(root, p)) bad.push(`llms.txt links ${l}, which is not a built page`);
      }
    }
    if (live) {
      const gap = { last: 0 };
      const r = await liveGet(new URL("/llms.txt", live).href, gap);
      if (r.status !== 200) bad.push(`live ${new URL("/llms.txt", live).href} answered ${r.status || r.error} (want 200)`);
      else if (!/^text\/plain/i.test(r.headers.get("content-type") || "")) bad.push(`live /llms.txt content-type is ${r.headers.get("content-type") || "missing"} (want text/plain)`);
      else d.push(`live /llms.txt: 200 ${r.headers.get("content-type")}`);
    }
    if (wg5.length) bad.push(`WG-5 has ${wg5.length} role violation(s)`);
    set("WG-6", bad.length ? "FAIL" : "PASS", `llms.txt ${txt === null ? "missing" : `H1 ok, ${nLinks} link(s), ${nSame} same-host all built`}${live ? ", live 200 text/plain" : ""}; WG-5 ${wg5.length} violation(s)`, [...bad, ...d]);
  }
  // ---- WG-7 ----
  if (only.has("WG-7")) {
    const bad = [], d = [];
    const hf = path.join(root, "_headers");
    if (!fs.existsSync(hf)) bad.push("_headers is not in the built folder (Cloudflare Pages format)");
    else {
      const blk = parseHeadersFile(fs.readFileSync(hf, "utf8")).get("/*");
      if (!blk) bad.push("_headers has no `/*` block");
      else for (const [h, label] of [["strict-transport-security", "Strict-Transport-Security"], ["cross-origin-opener-policy", "Cross-Origin-Opener-Policy"]]) if (!blk[h]) bad.push(`_headers /* block has no ${label}`);
    }
    let nLive = 0;
    if (live) {
      const gap = { last: 0 };
      for (const p of pages) {
        const url = new URL(p.path, live).href, r = await liveGet(url, gap);
        nLive++;
        if (r.status !== 200) { bad.push(`live ${url} answered ${r.status || r.error} (want 200)`); continue; }
        for (const [h, label] of [["strict-transport-security", "Strict-Transport-Security"], ["cross-origin-opener-policy", "Cross-Origin-Opener-Policy"]]) if (!r.headers.get(h)) bad.push(`live ${url} has no ${label} header`);
      }
    }
    set("WG-7", bad.length ? "FAIL" : "PASS", `_headers /*: ${bad.some((b) => /_headers/.test(b)) ? "incomplete" : "Strict-Transport-Security + Cross-Origin-Opener-Policy"}${live ? `; ${nLive} live page(s) checked` : ""}`, [...bad, ...d]);
  }

  // ---- browser rules ----
  const needBrowser = ["WG-2", "WG-3", "WG-4"].some((id) => only.has(id));
  const wg4Mode = opts.wg4 || "trace";
  if (needBrowser && pages.length) {
    let browser = null, server = null, why = null;
    if (only.has("WG-2") || only.has("WG-3") || (only.has("WG-4") && wg4Mode !== "static")) {
      try { browser = await launch(); } catch (e) { why = e instanceof Blocked ? e.message : `the browser could not start: ${e.message}`; }
    }
    for (const id of ["WG-2", "WG-3"]) if (only.has(id) && !browser) set(id, "NOT RUN", `no browser: ${why}`);
    {
      try {
        if (browser) { server = await serve(root); }
        const origin = server ? `http://127.0.0.1:${server.port}` : null;
        const urlOf = (p) => origin + "/" + path.relative(root, p.file).split(path.sep).join("/");
        const w2 = [], b2 = [], w3 = [], b3 = [], err = { "WG-2": [], "WG-3": [], "WG-4": [] };
        let checked3 = 0, noImg = 0;
        if (browser && (only.has("WG-2") || only.has("WG-3"))) {
          for (const p of pages) for (const vp of vps) {
            if (only.has("WG-2")) {
              try {
                const c = await coverageOf(browser, vp, urlOf(p), origin), pct = c.total ? ((c.total - c.used) / c.total) * 100 : 0;
                w2.push(`${p.path} @${vp.name}: ${kib(c.wasted)} gzip wasted, ${pct.toFixed(1)}% unused (${kib(c.total - c.used)} of ${kib(c.total)} raw, ${c.sheets} stylesheet(s))`);
                if (c.wasted > WASTED_CSS_MAX) b2.push(`${p.path} @${vp.name}: ${kib(c.wasted)} gzip of CSS is unused (${pct.toFixed(1)}% of ${kib(c.total)} raw; limit ${WASTED_CSS_MAX / 1024} KiB gzip)`);
              } catch (e) { err["WG-2"].push(`${p.path} @${vp.name}: ${e.message.split("\n")[0]}`); }
            }
            if (only.has("WG-3")) {
              try {
                const ims = await imagesOf(browser, vp, urlOf(p));
                let any = false;
                for (const im of ims) {
                  const j = judgeImage(im);
                  if (!j) continue;
                  any = true; checked3++;
                  w3.push({ ratio: j.ratio ?? 0, line: `${p.path} @${vp.name}: ${j.chosenW ? `${j.chosenW}w for ${Math.round(im.width)} px (${j.ratio.toFixed(2)}x)` : `${Math.round(im.width)} px`} ${im.tag.slice(0, 90)}` });
                  for (const pr of j.problems) b3.push(`${p.path} @${vp.name}: ${pr}: ${im.tag.slice(0, 110)}`);
                }
                if (!any) noImg++;
              } catch (e) { err["WG-3"].push(`${p.path} @${vp.name}: ${e.message.split("\n")[0]}`); }
            }
          }
        }
        if (only.has("WG-2") && browser) {
          const state = b2.length ? "FAIL" : err["WG-2"].length ? "NOT RUN" : "PASS";
          const worst = Math.max(0, ...w2.map((l) => parseFloat(l.match(/: ([\d.]+) KiB gzip wasted/)[1])));
          set("WG-2", state, err["WG-2"].length && !b2.length ? `could not measure: ${err["WG-2"][0]}` : `${w2.length} page view(s), worst ${worst.toFixed(1)} KiB gzip wasted (limit ${WASTED_CSS_MAX / 1024} KiB)`, [...b2, ...err["WG-2"].map((e) => "error " + e), ...w2.map((l) => "measured " + l)]);
        }
        if (only.has("WG-3") && browser) {
          const state = b3.length ? "FAIL" : err["WG-3"].length ? "NOT RUN" : "PASS";
          const worst5 = w3.sort((a, b) => b.ratio - a.ratio).slice(0, 5).map((x) => "worst " + x.line);
          set("WG-3", state, err["WG-3"].length && !b3.length ? `could not measure: ${err["WG-3"][0]}` : `${checked3} srcset image view(s) checked at ${vps.map((v) => v.name).join(", ")} (DPR 1), ${b3.length} problem(s)`, [...b3, ...err["WG-3"].map((e) => "error " + e), ...worst5]);
        }
        // WG-4
        if (only.has("WG-4")) {
          let usedStatic = wg4Mode === "static", reason = wg4Mode === "static" ? "--wg4 static" : "", explicit = usedStatic;
          if (!usedStatic && !browser) { usedStatic = true; reason = `no browser, so no trace: ${why}`; }
          if (!usedStatic) {
            const all = [], errs = []; let ev0 = 0;
            for (const p of pages) for (const vp of vps) {
              let r = null, last = null;
              for (let attempt = 0; attempt < 2 && !r; attempt++) { try { if (process.env.WRITING_GATE_BREAK_TRACE) throw new Error("tracing disabled by WRITING_GATE_BREAK_TRACE (test hook)"); r = await traceOf(browser, vp, urlOf(p), origin); } catch (e) { last = e; } }
              if (r) { ev0 += r.events; for (const h of r.hits) all.push({ ...h, page: p.path, vp: vp.name }); } else errs.push(`${p.path} @${vp.name}: ${last?.message?.split("\n")[0]}`);
            }
            if (errs.length && !ev0) { usedStatic = true; reason = `tracing is not usable here after two attempts (${errs[0]})`; }
            else {
              const by = new Map();
              for (const h of all) by.set(h.where, (by.get(h.where) || 0) + 1);
              const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, n]) => `top frame ${w} x${n}`);
              const ms = all.reduce((s, h) => s + h.ms, 0);
              const lay = all.filter((h) => h.name === "Layout"), recalc = all.length - lay.length;
              const state = lay.length ? "FAIL" : errs.length ? "NOT RUN" : "PASS";
              set("WG-4", state, errs.length && !lay.length ? `trace failed on ${errs.length} page view(s): ${errs[0]}` : `${lay.length} forced Layout event(s) from our own scripts (limit 0; ${recalc} style recalculation(s) listed, not gated; ${ms.toFixed(1)} ms in all) across ${pages.length * vps.length} page view(s), measured by Chromium trace`, [...top, ...errs.map((e) => "error " + e)]);
            }
          }
          if (usedStatic) {
            const files = ownScripts(root, pages.map((p) => p.file));
            const hits = [];
            for (const s of files) for (const h of lintReadAfterWrite(s.src)) hits.push(`${s.name}:${h.line} reads ${h.read} after writing styles (${h.write.trim()})`);
            // a lint that finds nothing is weaker than a trace: it is a PASS only when it was asked for; as a fallback it stays NOT RUN
            set("WG-4", hits.length ? "FAIL" : explicit ? "PASS" : "NOT RUN", `${hits.length} read-after-write site(s) in ${files.length} own script(s), measured by STATIC LINT (${reason}; the Chromium trace did not run${hits.length || explicit ? "" : ", and a clean lint does not prove 0 forced reflows"})`, hits.slice(0, 20));
          }
        }
      } finally {
        if (browser) await browser.close().catch(() => {});
        if (server) server.server.close();
      }
    }
  } else if (needBrowser) {
    for (const id of ["WG-2", "WG-3", "WG-4"]) if (only.has(id)) set(id, "NOT RUN", "no page to measure");
  }

  // pages missing from the built folder: nothing page-based may PASS on the rest
  if (missing.length) for (const id of ["WG-1", "WG-2", "WG-3", "WG-4"]) if (only.has(id) && rules[id].status === "PASS") {
    rules[id].status = "NOT RUN"; rules[id].summary = `${rules[id].summary}; NOT RUN for ${missing.join(" ")} (not in the built folder)`;
  }
  // PSI evidence
  for (const id of IDS) {
    if (!only.has(id) || !ev[id].length) continue;
    for (const e of ev[id]) rules[id].details.push(`${e.ok === false ? "PSI CONTRADICTS " : "evidence "}${e.line}`);
    const bad = ev[id].filter((e) => e.ok === false);
    if (bad.length) { rules[id].status = "FAIL"; rules[id].summary += `; PageSpeed evidence contradicts (${bad.length} file(s))`; }
  }
  return { root, header, rules: IDS.filter((id) => only.has(id)).map((id) => rules[id]), pages: pages.map((p) => p.path), missing };
}

export function formatRules(r) {
  const lines = [...r.header];
  for (const x of r.rules) {
    lines.push(`${x.status} ${x.id} ${x.title}: ${x.summary}`);
    for (const d of x.details) lines.push(`    ${d}`);
  }
  const n = (s) => r.rules.filter((x) => x.status === s).length;
  const word = n("FAIL") ? "FAIL" : n("NOT RUN") ? "ERROR" : "PASS";
  lines.push(`${word} writing-gate ${r.rules.length} rules: ${n("PASS")} PASS, ${n("FAIL")} FAIL, ${n("NOT RUN")} NOT RUN`);
  return { text: lines.join("\n"), code: n("FAIL") ? 1 : n("NOT RUN") ? 2 : 0 };
}

async function main() {
  const a = process.argv.slice(2);
  if (a.includes("--help") || a.includes("-h")) { console.log(USAGE); return 0; }
  const pos = a.filter((x, i) => !x.startsWith("--") && !VALUE_FLAGS.includes(a[i - 1]));
  if (pos.length !== 1) throw new UsageError(`one <built site dir> is required\n${USAGE}`);
  const maxPages = opt(a, "--max-pages");
  const wg4 = opt(a, "--wg4");
  if (wg4 && !["trace", "static"].includes(wg4)) throw new UsageError("--wg4 wants trace or static");
  const res = await runGate({
    dir: pos[0], pages: opt(a, "--pages"), url: opt(a, "--url"), psiDir: opt(a, "--psi-dir"), only: opt(a, "--only")?.split(",").map((s) => s.trim()),
    viewports: opt(a, "--viewports"), maxPages: maxPages ? Number(maxPages) : undefined, wg4,
  });
  const out = formatRules(res);
  console.log(out.text);
  const j = opt(a, "--json");
  if (j) { fs.mkdirSync(path.dirname(path.resolve(j)), { recursive: true }); fs.writeFileSync(j, JSON.stringify({ schema: "omnikom-writing-gate/1", ranAt: new Date().toISOString(), site: res.root, pages: res.pages, missing: res.missing, exit: out.code, rules: res.rules }, null, 1) + "\n"); }
  return out.code;
}
if (isMain(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => {
    if (e instanceof UsageError) { console.error(`usage error: ${e.message}`); process.exit(2); }
    console.error(`writing-gate crashed: ${e.stack || e.message}`); process.exit(1);
  });
}
