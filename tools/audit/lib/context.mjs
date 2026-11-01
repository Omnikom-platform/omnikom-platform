// The site every check receives: the reader's pages plus the folder facts a check needs (files, config, canonical helpers).
// Node built-ins only. Nothing here judges anything; the checks do.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { loadSite, normPath } from "./site.mjs";
import { lineAt } from "./lines.mjs";
import { applyHeadersFile } from "./headers.mjs";

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(path.relative(root, p).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

// Unescape the five predefined XML entities and numeric references (enough to compare a <loc> with a page URL).
export const xmlText = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  const l = e.toLowerCase();
  if (l === "amp") return "&"; if (l === "lt") return "<"; if (l === "gt") return ">"; if (l === "quot") return '"'; if (l === "apos") return "'";
  const n = l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
  return Number.isFinite(n) ? String.fromCodePoint(n) : m;
});

// Every sitemap file in the folder (sitemap*.xml at any depth): kind, entries with the line of each <loc>, and the root file.
// In a snapshot (slice 2) the files are site/sitemap-N.xml or .xml.gz (snapshot-site.mjs), and each knows the URL it was fetched from
// (site/sitemaps.json fetched[].file === rel), which is its `urlPath`; in a folder the URL path is "/" + rel.
function readSitemaps(site) {
  const files = [];
  const snap = site.mode === "snapshot";
  const fetched = snap ? ((site.readJson("site/sitemaps.json") || {}).fetched || []) : [];
  const pick = snap ? (r) => /^site\/sitemap-\d+\.xml(\.gz)?$/i.test(r) : (r) => /(^|\/)[^/]*sitemap[^/]*\.xml$/i.test(r);
  for (const rel of site.files.filter(pick)) {
    const text = site.read(rel);
    let urlPath = "/" + rel;
    if (snap) { const f = fetched.find((x) => x && x.file === rel); urlPath = null; try { if (f) urlPath = new URL(f.url).pathname; } catch {} }
    const kind = /<sitemapindex\b/i.test(text) ? "index" : /<urlset\b/i.test(text) ? "urlset" : "unknown";
    const entries = [];
    const re = /<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
    let m;
    while ((m = re.exec(text))) {
      const lm = /<loc>\s*([^<]*?)\s*<\/loc>/i.exec(m[2]);
      const mod = /<lastmod>\s*([^<]*?)\s*<\/lastmod>/i.exec(m[2]);
      const locAt = m.index + m[0].indexOf(m[2]) + (lm ? lm.index : 0);
      const modAt = m.index + m[0].indexOf(m[2]) + (mod ? mod.index : 0);
      entries.push({ kind: m[1].toLowerCase(), loc: lm ? xmlText(lm[1]) : "", lastmod: mod ? mod[1] : null, line: lineAt(text, lm ? locAt : m.index), lastmodLine: mod ? lineAt(text, modAt) : 0 });
    }
    files.push({ rel, text, kind, entries, bytes: Buffer.byteLength(text, "utf8"), urlPath });
  }
  const root = files.find((f) => f.kind === "index") || files.find((f) => f.rel === "sitemap.xml") || files[0] || null;
  return { files, root };
}

// The PageSpeed Insights file (psi.mjs writes { generatedAt, pages: [{ url, strategy, performance, lcpMs, cls, tbtMs, ... }] }):
// the explicit file (options.psi), else the newest psi/<date>.json of the audited folder; null when there is none.
function loadPsi(dir, explicit) {
  let file = null;
  const bad = (m) => Object.assign(new Error(m), { exit: 2 });
  if (explicit) { file = path.resolve(explicit); if (!fs.existsSync(file)) throw bad(`--psi file not found: ${file}`); }
  else {
    const d = path.join(dir, "psi");
    if (fs.existsSync(d) && fs.statSync(d).isDirectory()) { const names = fs.readdirSync(d).filter((n) => /\.json$/i.test(n)).sort(); if (names.length) file = path.join(d, names[names.length - 1]); }
  }
  if (!file) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw bad(`PSI file ${file} is not valid JSON: ${e.message}`); }
  if (!j || !Array.isArray(j.pages)) throw bad(`PSI file ${file} has no pages[] (the shape psi.mjs writes)`);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(String(j.generatedAt || ""))?.[0] || /(\d{4}-\d{2}-\d{2})/.exec(path.basename(file))?.[1] || "undated";
  return { file, date, pages: j.pages };
}

export function buildSite(dir, config, options = {}) {
  const site = loadSite(dir);
  const snap = site.mode === "snapshot";
  const loaded = { origin: site.origin, hosts: site.hosts };
  site.config = config;
  site.files = listFiles(site.dir);
  const fileSet = new Set(site.files);
  site.has = (rel) => fileSet.has(rel);
  site.read = (rel) => { const b = fs.readFileSync(path.join(site.dir, rel)); return (/\.gz$/i.test(rel) ? zlib.gunzipSync(b) : b).toString("utf8"); };
  site.readBytes = (rel) => fs.readFileSync(path.join(site.dir, rel));
  site.readJson = (rel) => { try { return site.has(rel) ? JSON.parse(site.read(rel)) : null; } catch { return null; } };
  site.mtime = (rel) => fs.statSync(path.join(site.dir, rel)).mtimeMs;
  // slice 4c: the build target decides whether an X-Robots-Tag noindex (a snapshot's response header, a folder's _headers file) feeds page.noindex,
  // and so what IDX-001 and every rule that skips non-indexable pages judge. production: it feeds. preview: it does not (a preview carries it on
  // purpose; the other rules judge the site as it will be in production). no target: a snapshot is what the live site says, so it feeds; a folder
  // ignores _headers. A meta robots noindex always feeds. ENV-001 reads headerNoindex itself.
  site.target = options.target || null;
  site.headersFile = snap ? null : applyHeadersFile(site);
  const headerFeeds = site.target === "production" || (!site.target && snap);
  for (const p of site.pages.values()) {
    p.noindex = p.metaNoindex || (headerFeeds && p.headerNoindex);
    p.robots = [p.metaRobots, ...(headerFeeds ? p.headerRobots : [])].filter(Boolean).join(", ");
  }
  // a snapshot judges the pages it saw answer 200; a 404 or redirect record is evidence for LNK-002 and IDX-001, not a page of the site
  site.pageList = [...site.pages.values()].filter((p) => !snap || p.status === 200).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  site.indexable = (p) => p.status === 200 && !p.noindex;
  // The page's own canonical string: the first canonical tag, or "" when there is none (URL-009 reports that).
  site.canonicalOf = (p) => (p.canonicals[0] ? p.canonicals[0].href.trim() : "");
  const origins = site.pageList.map((p) => { try { return new URL(site.canonicalOf(p)).origin; } catch { return ""; } });
  const home = site.pages.get("/");
  const homeOrigin = home ? origins[site.pageList.indexOf(home)] : "";
  // In a folder there is no host: the site origin is the home page's canonical origin, else the first canonical's.
  site.origin = homeOrigin || origins.find(Boolean) || "";
  site.hosts = [...new Set(origins.filter(Boolean).map((o) => new URL(o).hostname))];
  // In a snapshot the HTTP origin is known: the origin of the home page's final url (else _site.json.url); hosts are the hosts it was fetched from.
  if (snap) { site.origin = loaded.origin || site.origin; site.hosts = loaded.hosts; }
  // The canonical string a page should have, used where the page has none or an unusable one.
  site.expectedCanonical = (p) => site.canonicalOf(p) || (site.origin ? site.origin + p.path : p.path);
  let sm = null;
  site.sitemaps = () => (sm ||= readSitemaps(site));
  // robots.txt: { rel, present, text, buf, status, headers (lower-case names), bytes, measured }. measured = the HTTP facts are known (a snapshot).
  let rb = null;
  site.robots = () => (rb ||= (() => {
    if (!snap) { const present = site.has("robots.txt"); const buf = present ? site.readBytes("robots.txt") : null; return { rel: "robots.txt", present, text: present ? buf.toString("utf8") : "", buf, status: null, headers: {}, bytes: buf ? buf.length : null, measured: false }; }
    const j = site.readJson("site/robots.json");
    const present = site.has("site/robots.txt");
    const buf = present ? site.readBytes("site/robots.txt") : null;
    const headers = {};
    if (j && j.headers && typeof j.headers === "object") for (const [k, v] of Object.entries(j.headers)) headers[k.toLowerCase()] = String(v);
    return { rel: "site/robots.txt", present, text: present ? buf.toString("utf8") : "", buf, status: j ? j.status : null, headers, bytes: j && typeof j.bytes === "number" ? j.bytes : buf ? buf.length : null, measured: !!j };
  })());
  site.psi = snap ? loadPsi(site.dir, options.psi) : null;
  return site;
}

// Resolve an href seen on `fromPath`: { kind: "page"|"file", path, pathname } for an internal target, null for external or out-of-scope hrefs.
export function resolveLink(site, href, fromPath) {
  const h = String(href ?? "").trim();
  if (!h || h.startsWith("#") || /^(mailto:|tel:|sms:|javascript:|data:)/i.test(h)) return null;
  let u;
  try { u = new URL(h, "https://site.invalid" + fromPath); } catch { return null; }
  if (u.hostname !== "site.invalid" && !site.hosts.map((x) => x.replace(/^www\./, "")).includes(u.hostname.replace(/^www\./, ""))) return null;
  let pathname = u.pathname;
  try { pathname = decodeURIComponent(pathname); } catch {}
  if (/\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|xml|txt|json|zip|mp4|webm|woff2?)$/i.test(pathname)) return { kind: "file", path: pathname.replace(/^\//, ""), pathname };
  return { kind: "page", path: normPath(pathname), pathname };
}
