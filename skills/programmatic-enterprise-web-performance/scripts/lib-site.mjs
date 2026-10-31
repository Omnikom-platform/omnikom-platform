// Reads a built site into page records the gate can test: a static folder (index.html per directory) or a live snapshot
// (made by snapshot-site.mjs: _site.json + pages/<slug>/raw.html.gz). Node built-ins only, tolerant HTML tokenizer.
// 2026-10-30 (Omnikom audit engine, tools/audit/lib/site.mjs is a copy of this file): every token carries its 1-based line (stripped
// regions keep their newlines), new page fields titles[], descriptions[], mains[], imgs[], canonicals[], ogUrls[], hreflangs[], raw;
// the first description and canonical are what MET-002 and URL-009 judge (the old metaDescription/canonical fields keep the last one).
// 2026-10-31 (audit engine slice 2): the snapshot branch of loadSite keys pages by FINAL url, lists followed redirects in `redirects`, keeps body-less records, returns origin, meta, complete; page fields slug, url, crawledUrl, ttfbMs, chain.
// A page: { path, status, title, metaDescription, canonical, robots, noindex, h1[], headings[{level,text,line}], blocks[{tag,text,region,seq}],
//           firstParagraph, links[{href,text,region,rel,line}], jsonld[{parsed,error,line}], text, mainText, mainWords, wordCount,
//           raw, titles[{text,line,inHead}], descriptions[{text,line,inHead}], mains[{line}], imgs[{tag,line,attrs}],
//           canonicals[{href,line}], ogUrls[{content,line}], hreflangs[{hreflang,href,line}] }
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { lineAt } from "./lib-lines.mjs";

import { words } from "./lib-text.mjs";
export { words };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BLOCK = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "summary", "dt", "dd", "td", "th", "blockquote", "figcaption", "title"]);
const CONTAINERS = new Set(["div", "section", "article", "ul", "ol", "table", "form", "header", "footer", "nav", "main", "aside", "dl", "details", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "p"]);
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: String.fromCharCode(0x2014), ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", copy: "©", hellip: "…" };
export const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const ws = (s) => decode(s).replace(/\s+/g, " ").trim();
const nl = (s) => s.replace(/[^\n]/g, ""); // only the newlines of a stripped region, so later line numbers stay true

// Normal form of a page path so "/a", "/a/", "/a/index.html" and "/a.html" are one page.
export function normPath(p) {
  let x = String(p).split("#")[0].split("?")[0].trim();
  try { x = decodeURI(x); } catch {}
  x = x.replace(/\/index\.html?$/i, "/").replace(/\.html?$/i, "");
  if (!x.startsWith("/")) x = "/" + x;
  if (!/\.[a-z0-9]{2,5}$/i.test(x) && !x.endsWith("/")) x += "/";
  return x.replace(/\/{2,}/g, "/").toLowerCase();
}

export function parseHtml(html) {
  const rawHtml = html;
  const jsonld = [];
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, body, off) => {
    if (/type\s*=\s*["']?application\/ld\+json/i.test(attrs)) { const line = lineAt(rawHtml, off); try { jsonld.push({ parsed: JSON.parse(body), line }); } catch (e) { jsonld.push({ parsed: null, error: String(e.message).slice(0, 100), line }); } }
    return " " + nl(m);
  });
  html = html.replace(/<(style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, (m) => " " + nl(m)).replace(/<!--[\s\S]*?-->/g, (m) => " " + nl(m)).replace(/<[!?][^>]*>/g, (m) => " " + nl(m));
  const page = { title: "", metaDescription: "", canonical: "", robots: "", h1: [], headings: [], blocks: [], links: [], jsonld, lang: "", forms: 0,
    raw: rawHtml, titles: [], descriptions: [], mains: [], imgs: [], canonicals: [], ogUrls: [], hreflangs: [] };
  const stack = []; // chrome tags: nav header footer aside main
  const collectors = []; // open block collectors {tag, text, region, seq, line}
  let anchor = null, seq = 0, inBody = false, ln = 1, ptr = 0;
  const lineTo = (idx) => { while (ptr < idx) { if (html.charCodeAt(ptr++) === 10) ln++; } return ln; };
  const allText = [], mainText = [];
  const regionOf = () => {
    const has = (t) => stack.includes(t);
    if (has("nav")) return "nav";
    if (has("footer")) return "footer";
    if (has("aside")) return "aside";
    if (has("header") && !has("main")) return "header";
    return has("main") ? "main" : "body";
  };
  const closeCollector = (i) => {
    const c = collectors.splice(i, 1)[0];
    const text = ws(c.text);
    if (c.tag === "title") { page.titles.push({ text, line: c.line, inHead: !c.inBody }); if (!page.title) page.title = text; return; }
    page.blocks.push({ tag: c.tag, text, region: c.region, seq: c.seq });
    if (/^h[1-6]$/.test(c.tag)) { page.headings.push({ level: +c.tag[1], text, region: c.region, seq: c.seq, line: c.line }); if (c.tag === "h1") page.h1.push(text); }
  };
  const attrOf = (raw) => { const o = {}; raw.replace(/([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, (m, k, a, b, c) => { o[k.toLowerCase()] = decode(a ?? b ?? c ?? ""); return m; }); return o; };
  const re = /<(\/)?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    const line = lineTo(m.index);
    if (m[4] !== undefined) {
      const t = m[4];
      if (collectors.some((c) => c.tag === "title")) { collectors.forEach((c) => (c.text += t)); continue; }
      collectors.forEach((c) => (c.text += t));
      if (anchor) anchor.text += t;
      const region = regionOf();
      allText.push(t);
      if (region === "main" || region === "body") mainText.push(t);
      continue;
    }
    const close = !!m[1], tag = m[2].toLowerCase(), raw = m[3] || "";
    if (!close) {
      const a = attrOf(raw);
      if (tag === "html") page.lang = a.lang || "";
      if (tag === "body") inBody = true;
      if (tag === "main") page.mains.push({ line });
      if (tag === "form") page.forms++; // GT-010 required-when-present with pageHasForm
      if (tag === "img" || (tag === "input" && /^image$/i.test(a.type || "")) || (tag === "area" && a.href !== undefined)) page.imgs.push({ tag, line, attrs: a });
      if (tag === "meta") {
        const nm = (a.name || a.property || "").toLowerCase();
        if (nm === "description") { page.metaDescription = ws(a.content || ""); page.descriptions.push({ text: ws(a.content || ""), line, inHead: !inBody }); }
        if (nm === "robots") page.robots = (a.content || "").toLowerCase();
        if (nm === "og:url") page.ogUrls.push({ content: a.content ?? "", line });
      }
      if (tag === "link" && /\bcanonical\b/i.test(a.rel || "")) { page.canonical = a.href || ""; page.canonicals.push({ href: a.href || "", line }); }
      if (tag === "link" && /\balternate\b/i.test(a.rel || "") && a.hreflang) page.hreflangs.push({ hreflang: a.hreflang, href: a.href || "", line });
      if (tag === "img" && anchor && a.alt) anchor.alt = (anchor.alt || "") + " " + a.alt;
      if (CONTAINERS.has(tag)) { const pi = collectors.findLastIndex((c) => c.tag === "p"); if (pi >= 0) closeCollector(pi); }
      if (tag === "li") { const li = collectors.findLastIndex((c) => c.tag === "li"); if (li >= 0 && !collectors.slice(li).some((c) => c.tag === "ul" || c.tag === "ol")) closeCollector(li); }
      if (["nav", "header", "footer", "aside", "main"].includes(tag)) stack.push(tag);
      else if (a.role === "navigation") stack.push("nav");
      else if (a.role === "contentinfo") stack.push("footer");
      if (tag === "a" && a.href !== undefined) anchor = { href: a.href, text: "", alt: "", label: a["aria-label"] || a.title || "", region: regionOf(), rel: a.rel || "", line };
      if (BLOCK.has(tag)) collectors.push({ tag, text: "", region: regionOf(), seq: seq++, line, inBody });
      if (VOID.has(tag) || /\/\s*$/.test(raw)) { if (BLOCK.has(tag)) collectors.pop(); }
    } else {
      const ci = collectors.findLastIndex((c) => c.tag === tag);
      if (ci >= 0) closeCollector(ci);
      if (tag === "a" && anchor) { page.links.push({ href: anchor.href, text: ws(anchor.text) || ws(anchor.alt) || ws(anchor.label), region: anchor.region, rel: anchor.rel, line: anchor.line }); anchor = null; }
      if (["nav", "header", "footer", "aside", "main"].includes(tag)) { const si = stack.lastIndexOf(tag); if (si >= 0) stack.length = si; }
    }
  }
  while (collectors.length) closeCollector(collectors.length - 1);
  page.blocks.sort((a, b) => a.seq - b.seq);
  page.headings.sort((a, b) => a.seq - b.seq);
  page.noindex = /\bnoindex\b/.test(page.robots);
  page.text = ws(allText.join(" "));
  page.mainText = ws(mainText.join(" "));
  page.mainWords = words(page.mainText);
  page.wordCount = page.mainWords.length;
  const h1seq = page.headings.find((h) => h.level === 1)?.seq ?? -1;
  page.firstParagraph = page.blocks.find((b) => b.tag === "p" && b.seq > h1seq && (b.region === "main" || b.region === "body") && words(b.text).length >= 5)?.text || "";
  return page;
}

// Resolve an href seen on `fromPath` to a normal-form internal path, or null for external / non-page targets.
export function resolveInternal(href, fromPath, hosts = []) {
  const h = String(href ?? "").trim();
  if (!h || h.startsWith("#") || /^(mailto:|tel:|sms:|javascript:|data:)/i.test(h)) return null;
  let u;
  try { u = new URL(h, "https://site.invalid" + fromPath); } catch { return null; }
  if (u.hostname !== "site.invalid") { const host = u.hostname.replace(/^www\./, ""); if (!hosts.map((x) => x.replace(/^www\./, "")).includes(host)) return null; }
  if (/\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|xml|txt|json|zip|mp4|webm|woff2?)$/i.test(u.pathname)) return null;
  return normPath(u.pathname);
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else if (/\.html?$/i.test(e.name)) out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

// Returns { mode: "static"|"snapshot", dir, complete, origin, hosts[], pages: Map<normPath, page>, redirects: Map<normPath, {...}>, meta }.
// Snapshot mode (slice 2): every folder under pages/ that has a response.json is a record. A page is keyed by the path of its FINAL url
// (response.json.finalUrl); status is the final status. A record whose crawled url path differs from its final path (a redirect the
// crawl followed) is also listed in `redirects` under the crawled path, with the status of the first hop, and becomes a page only when
// no record crawled directly at the final path exists. A record with no raw.html.gz (a 404 with no body) is a page with empty content.
// `complete` is true only when _site.json says `complete: true`: a snapshot is a sample of a site unless it says otherwise.
export function loadSite(dir) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) throw new Error(`site folder not found: ${root}`);
  const pages = new Map();
  const hosts = [];
  if (fs.existsSync(path.join(root, "_site.json")) && fs.existsSync(path.join(root, "pages"))) {
    const meta = JSON.parse(fs.readFileSync(path.join(root, "_site.json"), "utf8"));
    let metaOrigin = "";
    try { const mu = new URL(meta.url); hosts.push(mu.hostname); metaOrigin = mu.origin; } catch {}
    const recs = [];
    for (const slug of fs.readdirSync(path.join(root, "pages")).sort()) {
      const base = path.join(root, "pages", slug);
      let resp; try { resp = JSON.parse(fs.readFileSync(path.join(base, "response.json"), "utf8")); } catch { continue; }
      let fin, crawled;
      try { fin = new URL(resp.finalUrl || resp.url); crawled = new URL(resp.url || resp.finalUrl); } catch { continue; }
      const gz = path.join(base, "raw.html.gz");
      hosts.push(fin.hostname);
      recs.push({ slug, resp, gz, fin, crawled, finalPath: normPath(fin.pathname), crawledPath: normPath(crawled.pathname) });
    }
    const redirects = new Map();
    const add = (r) => {
      const html = fs.existsSync(r.gz) ? zlib.gunzipSync(fs.readFileSync(r.gz)).toString("utf8") : "";
      const pg = parseHtml(html);
      pg.path = r.finalPath; pg.status = typeof r.resp.status === "number" ? r.resp.status : 0; pg.slug = r.slug; pg.url = r.fin.href; pg.crawledUrl = r.crawled.href;
      pg.ttfbMs = typeof r.resp.ttfbMs === "number" ? r.resp.ttfbMs : null; pg.chain = Array.isArray(r.resp.chain) ? r.resp.chain : [];
      pg.file = fs.existsSync(r.gz) ? path.relative(root, r.gz).split(path.sep).join("/") : `pages/${r.slug}/response.json`;
      pages.set(pg.path, pg);
    };
    for (const r of recs) {
      if (r.crawledPath === r.finalPath) { add(r); continue; }
      const first = Array.isArray(r.resp.chain) && r.resp.chain[0] ? r.resp.chain[0].status : undefined;
      if (typeof first === "number" && first >= 300 && first < 400) redirects.set(r.crawledPath, { status: first, to: r.finalPath, finalStatus: r.resp.status, slug: r.slug });
    }
    for (const r of recs) if (r.crawledPath !== r.finalPath && !pages.has(r.finalPath)) add(r);
    const home = pages.get("/");
    return { mode: "snapshot", dir: root, complete: meta.complete === true, origin: home ? new URL(home.url).origin : metaOrigin, hosts: [...new Set(hosts)], pages, redirects, meta };
  }
  for (const rel of walk(root)) {
    const pg = parseHtml(fs.readFileSync(path.join(root, rel), "utf8"));
    pg.path = normPath("/" + rel); pg.status = 200; pg.file = rel;
    pages.set(pg.path, pg);
  }
  return { mode: "static", dir: root, complete: true, hosts, pages };
}
