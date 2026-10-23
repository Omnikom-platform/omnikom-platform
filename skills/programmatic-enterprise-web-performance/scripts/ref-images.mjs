// REF-014 re-platforming keeps image URLs (shipgate packs/refactor.md; Google Search Central, image SEO: keep image URLs
// stable or redirect them). Every image URL the old site used (img src, srcset candidates and picture sources in <main>,
// og:image, image-sitemap <image:loc>) on the old site's own host must, on the new site, answer 200 with an image/* content
// type or redirect in ONE hop (301/308) to a URL that does. A 404/410, a chain, or a redirect to something that is not an image
// is a finding (status-mismatch / redirect-chain / redirect-target) naming the image and the old pages that used it.
// Exempt: images used only on routes the owner dropped (a 410 in the redirect map), and image URLs the owner dropped. Images on
// other hosts are listed and ignored. Above 2,000 image URLs, 2,000 are drawn in a fixed order (sha1 of the URL), so a re-run
// checks the same ones.
//
// Usage: node ref-images.mjs inventory <snapshot dir> [--out file]
//        node ref-images.mjs check <snapshot dir | inventory.json> (--new-site <folder> | --new-origin <url> [--allow-remote])
//             [--removed removed.json] [--must-keep /a,/b] [--scope all|priority] [--gap-ms 1000] [--max 2000]
//             [--exclude "<regex>"]... [--out <dir>]
//   --removed: {"routes": ["/old-page"], "images": ["/wp-content/old.jpg"]}   (migrate passes the map's 410 rows)
//   --scope priority: only images on --must-keep pages (traffic or links) or in an image sitemap (indexed); the rest are listed as
//   NOT CHECKED. The default, all, is the shipgate rule.
//   A folder is read from disk (a file at the path, or a `_redirects` rule to one); an origin is fetched with GET, redirects not
//   followed, one request every --gap-ms, stopping at the first 429.
// Exit: 0 PASS, 1 FAIL, 2 usage, 3 stopped at a 429 (nothing concluded).
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import { numArg, politeMs, MIN_GAP_MS } from "./lib-polite.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readSnapshotPages, getOnce, hostOf, isLoopback, sleep, parseRedirectRules, applyRedirect, walkFiles, readJson, writeJson, Stop429 } from "./ref-lib.mjs";

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)$/i;
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? (m[1] ?? m[2] ?? m[3]) : null; };
const decodeEnt = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
const srcsetUrls = (v) => decodeEnt(v || "").split(/,\s+|,(?=[^,\s]*\s+\d)/).map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
function mainRegion(html) {
  const m = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i); if (m) return m[1];
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];
  return body.replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, "");
}
// -> [{ url (absolute, no fragment), via }]
export function extractImages(html, pageUrl) {
  const out = []; const add = (u, via) => { if (!u || /^(data|blob|javascript):/i.test(u)) return; try { const x = new URL(decodeEnt(u), pageUrl); x.hash = ""; if (/^https?:$/.test(x.protocol)) out.push({ url: x.href, via }); } catch {} };
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [null, html])[1];
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) { const p = attr(m[0], "property") || attr(m[0], "name"); if (/^og:image(:url)?$/i.test(p || "")) add(attr(m[0], "content"), "og:image"); }
  const main = mainRegion(html);
  for (const m of main.matchAll(/<img\b[^>]*>/gi)) { add(attr(m[0], "src"), "img"); for (const u of srcsetUrls(attr(m[0], "srcset"))) add(u, "srcset"); }
  for (const pic of main.matchAll(/<picture\b[\s\S]*?<\/picture>/gi)) for (const s of pic[0].matchAll(/<source\b[^>]*>/gi)) for (const u of srcsetUrls(attr(s[0], "srcset"))) add(u, "picture");
  return out;
}
const sitemapImages = (xmlDir) => {
  const out = [];
  if (!fs.existsSync(xmlDir)) return out;
  for (const f of fs.readdirSync(xmlDir).filter((x) => /\.xml$/i.test(x))) {
    const xml = fs.readFileSync(path.join(xmlDir, f), "utf8");
    for (const u of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = (u[1].match(/<loc>\s*([^<]+?)\s*<\/loc>/) || [])[1];
      for (const i of u[1].matchAll(/<image:loc>\s*([^<]+?)\s*<\/image:loc>/g)) out.push({ page: loc, url: decodeEnt(i[1]) });
    }
  }
  return out;
};
// The old site's image URLs, from a snapshot. -> { origin, host, pages, images: [{ url, path, pages[], via[], inSitemap, otherHost }] }
export function inventoryImages(snapDir) {
  const { site, pages } = readSnapshotPages(snapDir);
  const origin = site.origin || new URL(site.url).origin, host = hostOf(origin); const by = new Map();
  const put = (url, via, page, inSitemap = false) => {
    const e = by.get(url) || { url, path: null, pages: [], via: [], inSitemap: false, otherHost: hostOf(url) !== host };
    if (page && !e.pages.includes(page)) e.pages.push(page); if (!e.via.includes(via)) e.via.push(via); if (inSitemap) e.inSitemap = true; by.set(url, e);
  };
  for (const p of pages) for (const i of extractImages(p.html, p.url)) put(i.url, i.via, p.path);
  for (const i of sitemapImages(path.join(snapDir, "site"))) { try { put(new URL(i.url, origin).href, "sitemap", i.page ? new URL(i.page).pathname : null, true); } catch {} }
  const images = [...by.values()].map((e) => { try { const u = new URL(e.url); e.path = u.pathname + u.search; } catch {} return e; }).sort((a, b) => a.url.localeCompare(b.url));
  return { rule: "REF-014", origin, host, pages: pages.length, generatedAt: new Date().toISOString(), snapshot: path.resolve(snapDir), images };
}

const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");
export const normPathOf = (p) => { try { return decodeURIComponent(String(p).split("?")[0]).replace(/\/+$/, "") || "/"; } catch { return String(p).split("?")[0]; } };

// Judge one image on the new site -> { verdict, finding?, detail, hops }
async function judgeOrigin(imgPath, newOrigin, fetchImpl) {
  const url = new URL(imgPath, newOrigin).href; const r = await getOnce(url, { fetchImpl });
  if (r.status === 200) return /^image\//i.test(r.contentType) ? { verdict: "PASS", hops: 0, detail: `200 ${r.contentType}` } : { verdict: "FAIL", finding: "status-mismatch", hops: 0, detail: `answers 200 as ${r.contentType || "no content type"}, not an image` };
  if (r.status >= 300 && r.status < 400 && r.location) {
    if (![301, 308].includes(r.status)) return { verdict: "FAIL", finding: "redirect-target", hops: 1, detail: `temporary redirect (${r.status}); only 301/308 keeps the image's standing` };
    const next = new URL(r.location, url).href; const n = await getOnce(next, { fetchImpl });
    if (n.status >= 300 && n.status < 400) return { verdict: "FAIL", finding: "redirect-chain", hops: 2, detail: `redirect chain: ${r.status} to ${next}, then ${n.status} to ${n.location}` };
    if (n.status === 200 && /^image\//i.test(n.contentType)) return { verdict: "PASS", hops: 1, detail: `${r.status} to ${next} (${n.contentType})` };
    return { verdict: "FAIL", finding: "redirect-target", hops: 1, detail: `${r.status} to ${next}, which answers ${n.status ?? "no answer"}${n.status === 200 ? ` as ${n.contentType || "no content type"}, not an image` : ""}` };
  }
  return { verdict: "FAIL", finding: "status-mismatch", hops: 0, detail: r.status == null ? `could not fetch: ${r.error}` : `answers ${r.status}` };
}
function judgeFolder(imgPath, dir, redirects, files) {
  let p = imgPath.split("?")[0]; try { p = decodeURIComponent(p); } catch {} // a malformed %-escape is looked up as written, not a crash of the whole check
  const f = p.replace(/^\//, "");
  const has = (x) => files.has(x.replace(/^\//, ""));
  if (has(f)) return IMG_EXT.test(f) ? { verdict: "PASS", hops: 0, detail: "file present" } : { verdict: "FAIL", finding: "status-mismatch", hops: 0, detail: "the file at that path is not an image type" };
  const rd = applyRedirect(redirects, p);
  if (rd) {
    if (![301, 308].includes(rd.status)) return { verdict: "FAIL", finding: "redirect-target", hops: 1, detail: `_redirects rule ${rd.from} uses ${rd.status}; only 301/308 keeps the image's standing` };
    if (/^https?:/i.test(rd.to)) return { verdict: "PASS", hops: 1, detail: `${rd.status} to ${rd.to} (an address outside the build: not read)` };
    const t = rd.to.split("?")[0];
    if (applyRedirect(redirects, t)) return { verdict: "FAIL", finding: "redirect-chain", hops: 2, detail: `_redirects sends ${p} to ${t}, which is redirected again` };
    if (has(t)) return IMG_EXT.test(t) ? { verdict: "PASS", hops: 1, detail: `${rd.status} to ${t}` } : { verdict: "FAIL", finding: "redirect-target", hops: 1, detail: `${rd.status} to ${t}, which is not an image` };
    return { verdict: "FAIL", finding: "redirect-target", hops: 1, detail: `${rd.status} to ${t}, which is not in the build` };
  }
  return { verdict: "FAIL", finding: "status-mismatch", hops: 0, detail: "no file and no redirect rule: the new build answers 404" };
}

export async function checkImages(inv, { newSite = null, newOrigin = null, removed = {}, mustKeep = null, scope = "all", gapMs = 1000, max = 2000, exclude = [], fetchImpl = fetch, log = () => {} } = {}) {
  const exRe = exclude.map((x) => new RegExp(x));
  const removedRoutes = new Set((removed.routes || []).map(normPathOf)), removedImages = new Set((removed.images || []).map((x) => normPathOf(x.replace(/^https?:\/\/[^/]+/i, ""))));
  const mk = mustKeep ? new Set(mustKeep.map(normPathOf)) : null;
  const ours = inv.images.filter((i) => !i.otherHost), other = inv.images.filter((i) => i.otherHost);
  const exempt = [], notChecked = [], todo = [];
  for (const i of ours) {
    const ip = normPathOf(i.path);
    if (removedImages.has(ip)) { exempt.push({ url: i.url, reason: "the owner dropped this image (url-remove)" }); continue; }
    if (i.pages.length && i.pages.every((p) => removedRoutes.has(normPathOf(p)))) { exempt.push({ url: i.url, reason: `only used on dropped page(s): ${i.pages.slice(0, 3).join(", ")}` }); continue; }
    if (exRe.some((re) => re.test(i.path))) { notChecked.push({ url: i.url, reason: "off-limits path (--exclude): never requested" }); continue; }
    if (scope === "priority" && !(i.inSitemap || (mk && i.pages.some((p) => mk.has(normPathOf(p)))))) { notChecked.push({ url: i.url, reason: "scope priority: not on a page with traffic or links and not in an image sitemap" }); continue; }
    todo.push(i);
  }
  const sampled = todo.length > max;
  const chosen = sampled ? [...todo].sort((a, b) => sha(a.url).localeCompare(sha(b.url))).slice(0, max) : todo;
  if (sampled) for (const i of todo) if (!chosen.includes(i)) notChecked.push({ url: i.url, reason: `over ${max} images: ${max} are drawn in a fixed order (sha1 of the URL)` });
  let redirects = [], files = new Set();
  if (newSite) { files = new Set(walkFiles(newSite)); try { redirects = parseRedirectRules(fs.readFileSync(path.join(newSite, "_redirects"), "utf8")); } catch {} }
  const rows = []; let stopped = null;
  for (const i of chosen) {
    let j;
    try { if (!newSite && rows.length) await sleep(gapMs); j = newSite ? judgeFolder(i.path, newSite, redirects, files) : await judgeOrigin(i.path, newOrigin, fetchImpl); }
    catch (e) { if (e instanceof Stop429) { stopped = e.message; break; } throw e; }
    rows.push({ url: i.url, path: i.path, pages: i.pages, via: i.via, inSitemap: i.inSitemap, ...j });
    log(`${j.verdict} ${i.path}${j.verdict === "FAIL" ? " : " + j.detail : ""}`);
  }
  const fails = rows.filter((r) => r.verdict === "FAIL");
  const status = stopped ? "STOPPED" : fails.length ? "FAIL" : rows.length ? "PASS" : "NOT-APPLICABLE";
  return { rule: "REF-014", checkedAt: new Date().toISOString(), newSite: newSite ? path.resolve(newSite) : null, newOrigin, scope, status, stopped429: stopped,
    summary: { images: inv.images.length, checked: rows.length, pass: rows.length - fails.length, fail: fails.length, exempt: exempt.length, otherHost: other.length, notChecked: notChecked.length + (stopped ? chosen.length - rows.length : 0), sampled },
    exempt, otherHost: other.map((i) => i.url), notChecked, rows };
}
export function imagesMarkdown(r) {
  const s = r.summary;
  const L = [`# Image URLs kept (REF-014): ${r.status}`, "", r.status === "STOPPED" ? `Stopped at a 429 (${r.stopped429}); nothing was concluded.` : `${s.pass} of ${s.checked} checked image URLs resolve (200 image, or one 301/308 hop to one); ${s.fail} do not. ${s.exempt} exempt (dropped), ${s.otherHost} on other hosts (ignored), ${s.notChecked} not checked${s.sampled ? " (a fixed draw was taken: over the cap)" : ""}.`, ""];
  for (const x of r.rows.filter((x) => x.verdict === "FAIL")) L.push(`- FAIL ${x.path} [${x.finding}]: ${x.detail}. Used on: ${x.pages.slice(0, 4).join(", ") || "(image sitemap only)"}${x.pages.length > 4 ? ` +${x.pages.length - 4} more` : ""}`);
  for (const x of r.notChecked.slice(0, 10)) L.push(`- not checked ${x.url}: ${x.reason}`);
  if (r.notChecked.length > 10) L.push(`- ... ${r.notChecked.length - 10} more not checked`);
  return L.join("\n") + "\n";
}

if (isMain(import.meta.url)) {
  const A = process.argv.slice(2); const cmd = A[0]; const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d); const all = (k) => A.flatMap((x, i) => (x === k ? [A[i + 1]] : []));
  const usage = () => { console.error("usage: node ref-images.mjs inventory <snapshot dir> [--out file] | check <snapshot dir|inventory.json> (--new-site <dir> | --new-origin <url>) [--removed f.json] [--must-keep /a,/b] [--scope all|priority] [--gap-ms 1000] [--max 2000] [--exclude re]... [--out dir]"); process.exit(2); };
  try {
    if (cmd === "inventory") { if (!A[1]) usage(); const inv = inventoryImages(path.resolve(A[1])); if (opt("--out")) writeJson(path.resolve(opt("--out")), inv); console.log(`${inv.images.length} image URL(s) from ${inv.pages} page(s): ${inv.images.filter((i) => !i.otherHost).length} on ${inv.host}, ${inv.images.filter((i) => i.otherHost).length} elsewhere`); process.exit(0); }
    else if (cmd === "check") {
      if (!A[1] || (!opt("--new-site") && !opt("--new-origin"))) usage();
      if (opt("--new-origin") && !isLoopback(opt("--new-origin")) && !A.includes("--allow-remote")) { console.error("REFUSED: --new-origin is not local; pass --allow-remote (GET only, one request every --gap-ms; stops at the first 429)."); process.exit(2); }
      const src = path.resolve(A[1]); const inv = fs.statSync(src).isDirectory() ? inventoryImages(src) : readJson(src);
      const r = await checkImages(inv, { newSite: opt("--new-site") ? path.resolve(opt("--new-site")) : null, newOrigin: opt("--new-origin"), removed: opt("--removed") ? readJson(path.resolve(opt("--removed")), {}) : {}, mustKeep: opt("--must-keep") ? opt("--must-keep").split(",").filter(Boolean) : null, scope: opt("--scope", "all"), gapMs: politeMs("--gap-ms", numArg("--gap-ms", opt("--gap-ms"), { present: A.includes("--gap-ms"), def: 1000 }), [opt("--new-origin")], MIN_GAP_MS), max: numArg("--max", opt("--max"), { present: A.includes("--max"), def: 2000, min: 1, int: true }), exclude: all("--exclude") });
      if (opt("--out")) { writeJson(path.join(path.resolve(opt("--out")), "images-check.json"), r); fs.writeFileSync(path.join(path.resolve(opt("--out")), "images-check.md"), imagesMarkdown(r)); }
      // exitCode, not process.exit(): exiting while an HTTPS socket closes can crash node on Windows (libuv assertion, 0xC0000409)
      console.log(imagesMarkdown(r)); const code = r.status === "STOPPED" ? 3 : r.status === "FAIL" ? 1 : 0; process.exitCode = code; setTimeout(() => process.exit(code), 8000).unref();
    } else usage();
  } catch (e) { console.error(`ERROR ${e.message}`); process.exit(2); }
}
