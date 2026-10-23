// Shared helpers of the REF checks that read an old-site snapshot and probe a new site (REF-013 service workers, REF-014
// image URLs): the snapshot's HTML, one polite GET that does not follow redirects, the Cloudflare/Netlify `_headers` and
// `_redirects` files of a built folder. No network except what the caller's fetch does; fixtures only in tests.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const UA = "PEWP-Ref/1.0 (read-only check, GET only)";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isLoopback = (u) => { try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
export class Stop429 extends Error {}

// The pages of an old-site snapshot (snapshot-site.mjs layout): { site (_site.json), pages: [{ url, path, slug, status, html }] }.
// html is the server's untouched HTML (raw.html.gz) when it is there, else head.html + body.html.
export function readSnapshotPages(snapDir) {
  const site = JSON.parse(fs.readFileSync(path.join(snapDir, "_site.json"), "utf8"));
  const pages = (site.pages || []).map((p) => {
    const dir = path.join(snapDir, "pages", p.slug); let html = "";
    try { html = zlib.gunzipSync(fs.readFileSync(path.join(dir, "raw.html.gz"))).toString("utf8"); }
    catch { try { html = fs.readFileSync(path.join(dir, "head.html"), "utf8") + "\n" + fs.readFileSync(path.join(dir, "body.html"), "utf8"); } catch {} }
    let pth = "/"; try { pth = new URL(p.url).pathname; } catch {}
    return { url: p.url, path: pth, slug: p.slug, status: p.status, html, dir };
  });
  return { site, pages };
}

// One GET, redirects not followed. -> { status, location, contentType, headers (lower-cased), text (only when wantText) }
export async function getOnce(url, { fetchImpl = fetch, timeoutMs = 20000, wantText = false } = {}) {
  let res;
  try { res = await fetchImpl(url, { redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { return { status: null, error: e.message }; }
  let text = null;
  if (wantText) { try { text = await res.text(); } catch { text = ""; } } else { try { await res.body?.cancel(); } catch {} }
  if (res.status === 429) throw new Stop429(`429 from ${url}`);
  const headers = {}; res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: res.status, location: headers.location || null, contentType: headers["content-type"] || "", headers, text };
}

const globRe = (pat) => new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(.*)").replace(/:([A-Za-z_]\w*)/g, "([^/]+)") + "$");
// Cloudflare Pages / Netlify `_headers`: an unindented path line, then indented `Name: value` lines.
export function parseHeadersFile(text) {
  const rules = []; let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^\s/.test(raw)) { const i = raw.indexOf(":"); if (cur && i > 0) cur.headers[raw.slice(0, i).trim().toLowerCase()] = ((cur.headers[raw.slice(0, i).trim().toLowerCase()] ? cur.headers[raw.slice(0, i).trim().toLowerCase()] + ", " : "") + raw.slice(i + 1).trim()); }
    else { cur = { pattern: raw.trim(), re: globRe(raw.trim()), headers: {} }; rules.push(cur); }
  }
  return rules;
}
export const headersFor = (rules, p) => rules.filter((r) => r.re.test(p)).reduce((o, r) => Object.assign(o, r.headers), {});
// `_redirects`: `from to [status]`, `*` splats and `:splat`. -> [{ from, re, to, status }]
export function parseRedirectRules(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const [from, to, status] = t.split(/\s+/); if (!from || !to) continue;
    out.push({ from, re: globRe(from), to, status: Number(status) || 301 });
  }
  return out;
}
export function applyRedirect(rules, p) {
  for (const r of rules) {
    const m = r.re.exec(p); if (!m) continue;
    let to = r.to; const groups = m.slice(1);
    if (groups.length) to = to.replace(/:splat/g, groups[0] ?? "");
    return { to, status: r.status, from: r.from };
  }
  return null;
}
// Clear-Site-Data value that clears the worker's storage or cache: "storage", "cache" or "*" (quotes as the header writes them).
export const clearsSite = (v) => !!v && /"(storage|cache|\*)"/i.test(String(v));
// vercel.json / netlify.toml header rules that apply to every path, as { name: value }.
export function configHeaders(dir, p) {
  const out = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, "vercel.json"), "utf8"));
    for (const h of j.headers || []) { if (globRe(String(h.source || "").replace(/\(\.\*\)/g, "*")).test(p) || /^\/\(\.\*\)$|^\/\*$|^\/\(\.\*\)\?$/.test(h.source || "")) for (const x of h.headers || []) out[String(x.key).toLowerCase()] = x.value; }
  } catch {}
  try {
    const t = fs.readFileSync(path.join(dir, "netlify.toml"), "utf8");
    for (const b of t.split(/\[\[headers\]\]/).slice(1)) {
      const forM = b.match(/for\s*=\s*"([^"]+)"/); if (!forM || !globRe(forM[1]).test(p)) continue;
      for (const m of b.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/gm)) if (m[1].toLowerCase() !== "for") out[m[1].toLowerCase()] = m[2].replace(/\\"/g, '"');
    }
  } catch {}
  return out;
}
export const walkFiles = (root, skip = /^(node_modules|\.git|\.pewp|\.checks)$/) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) { if (!skip.test(e.name)) walk(path.join(d, e.name)); } else out.push(path.relative(root, path.join(d, e.name)).split(path.sep).join("/")); } };
  walk(root);
  return out.sort();
};
export const htmlUrlPath = (f) => { const p = "/" + f.replace(/(^|\/)index\.html?$/i, "$1"); return p; };
export const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1) + "\n"); };
export const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { return d; } }; // BOM tolerated (hand-edited files)
