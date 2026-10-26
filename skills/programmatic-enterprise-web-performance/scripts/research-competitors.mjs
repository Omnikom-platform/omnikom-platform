// Competitor audit + authority. Port of tools/seo-kit/audit.mjs (Francine & Eli, 2026-10-17/18): read each competitor site the way a
// crawler does (raw HTML, no JavaScript) and record what matters for search and AI answers: platform, schema, FAQ markup, city/service
// pages, sitemap size and freshness, llms.txt, which AI crawlers its robots.txt blocks, trust signals. Then authority (referring
// domains, strength, link gap) from the free Common Crawl graph through authority.mjs.
// Usage: node research-competitors.mjs <target> [--domain d]... [--from-serp] [--max 12] [--pages 4] [--authority] [--authority-cache DIR]
//        [--authority-release ID] [--max-age-days 30] [--cwd DIR]
// Polite, always: robots.txt first and obeyed for every page, one request per second per site, one attempt per URL, an honest user
// agent, and a site is STOPPED for the rest of the run at its first 403/429/503 or bot-protection page (never retried, never bypassed).
// Every response is cached under <pewp>/cache/competitors/ (same layout as cache.mjs, plus headers); a cached refusal is honoured for
// 24 h so an immediate re-run does not knock again. Domains with a fresh audit in research/existing.json are not fetched again.
// --approved-competitors FILE (G7, contract C3: <pewp>/approved/competitors.json): the audited domains are exactly the rows of that file that have a
// domain (plus --domain); rows with only a handle (Instagram, TikTok, newsletters) are listed in the output, not audited; --from-serp picks are
// reported as `suggested` and NOT audited (the owner approves a list, then the audit reads it). business.json competitors are not used in that mode.
// Test hooks: PEWP_TEST_GAP_MS (local servers only). Output: research/competitors.json { sites:[...], authority:{...} }.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Blocked, J, W, listFile, iso, ageDays, context, needBusiness, runCli, readStep, writeStep, writeBlocked, factor, fact, domainOf, pace } from "./research-lib.mjs";
import { cachedRelease, defaultCache } from "./authority.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CRAWL_UA = "PEWP-SiteResearch/1.0 (competitor research audit; 1 request per second per site; contact the site owner who runs it)";
export const BOTS = {
  Googlebot: "Google Search + AI Overviews", Bingbot: "Bing + Copilot + ChatGPT search (Bing index)", "OAI-SearchBot": "ChatGPT search", "ChatGPT-User": "ChatGPT browsing for a user", GPTBot: "OpenAI training",
  "Claude-SearchBot": "Claude search", "Claude-User": "Claude browsing for a user", ClaudeBot: "Anthropic training", PerplexityBot: "Perplexity search", "Perplexity-User": "Perplexity browsing for a user",
  "Google-Extended": "Gemini training opt-out (NOT AI Overviews)", "Applebot-Extended": "Apple training opt-out", Bytespider: "ByteDance", CCBot: "Common Crawl (feeds many AI models)",
};
const LIMIT = { html: 5e6, text: 1e6, sitemap: 2e7 };

// ---------- cached, polite fetching ----------
const halted = new Map();
async function get(pewp, url, kind = "html", deadline = Infinity) {
  let host; try { host = new URL(url).host; } catch { return { status: 0, url, error: "bad url" }; }
  if (halted.has(host)) return { status: 0, url, error: `skipped: host refused earlier (HTTP ${halted.get(host)})` };
  if (Date.now() > deadline) return { status: 0, url, error: "skipped: site time budget used" };
  const cacheFile = path.join(pewp, "cache", "competitors", `${createHash("sha256").update(`GET ${url} `).digest("hex").slice(0, 24)}.json`);
  const refusal = (s, h, body) => [429, 503].includes(s) || !!h?.["cf-mitigated"] || ([403].includes(s) && /cloudflare|captcha|challenge|access denied|attention required|are you a robot/i.test(String(body).slice(0, 5000)));
  const c = fs.existsSync(cacheFile) ? J(cacheFile) : null; // a half-written cache file (a killed run) reads as null: fetched again, never a crash
  if (c && typeof c.fetchedAt === "string") {
    const age = ageDays(c.fetchedAt);
    if (c.refusal ? age < 1 : age < 7) { if (c.refusal) halted.set(host, c.status); return { ...c, body: c.text, url: c.finalUrl || c.url, cacheFile, fromCache: true }; }
  }
  await pace(url, 1000);
  try {
    const res = await fetch(url, { headers: { "user-agent": CRAWL_UA, accept: kind === "html" ? "text/html,*/*;q=0.8" : "*/*" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const headers = Object.fromEntries(res.headers);
    const reader = res.body?.getReader(); const chunks = []; let size = 0, truncated = false;
    while (reader) { const { done, value } = await reader.read(); if (done) break; size += value.length; chunks.push(value); if (size > LIMIT[kind]) { truncated = true; await reader.cancel(); break; } }
    let buf = Buffer.concat(chunks);
    if (buf[0] === 0x1f && buf[1] === 0x8b) { try { buf = zlib.gunzipSync(buf, { maxOutputLength: 10 * LIMIT[kind] }); } catch {} } // a gzip bomb stays compressed (unreadable), it does not fill memory
    const charset = (headers["content-type"] || "").match(/charset=([\w-]+)/i)?.[1] || "utf-8";
    let body; try { body = new TextDecoder(charset).decode(buf); } catch { body = buf.toString("utf8"); }
    const ref = refusal(res.status, headers, body);
    const challenge = ref || (kind === "html" && [403].includes(res.status));
    if (ref || (challenge && kind === "html")) halted.set(host, res.status);
    const entry = { source: "competitors", url, method: "GET", status: res.status, fetchedAt: iso(), contentType: headers["content-type"] || null, text: body, headers, finalUrl: res.url, truncated, challenge: !!challenge, refusal: !!ref };
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(entry) + "\n");
    return { ...entry, body, url: res.url, cacheFile };
  } catch (e) {
    const cause = e.cause?.code || e.cause?.message || "";
    return { status: 0, url, error: `${e.name === "TimeoutError" ? "timeout 20 s" : e.message || e}${cause ? ` (${cause})` : ""}` };
  }
}
const looksHtml = (r) => /text\/html/i.test(r.headers?.["content-type"] || "") || /<!doctype|<html|<head|<body|<title/i.test((r.body || "").slice(0, 1000));

// ---------- parsing (port) ----------
export function decode(s) {
  if (s == null) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e) => { const l = e.toLowerCase(); if (l[0] === "#") { const n = l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; } return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" }[l] ?? m; }).replace(/\s+/g, " ").trim();
}
export function attrs(tag) { const o = {}; for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) o[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ""; return o; }
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => attrs(m[0]));
export function meta(html, key) { const k = key.toLowerCase(); const t = tags(html, "meta").find((a) => (a.name || a.property || a["http-equiv"] || "").toLowerCase() === k); return t && t.content != null ? decode(t.content) : null; }
const inner = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => decode(m[1].replace(/<[^>]+>/g, " ")));
export function visibleText(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const strip = (s) => decode(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, " ").replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "));
  return { all: strip(html), main: main ? strip(main) : null };
}
const words = (s) => (s ? s.split(" ").filter(Boolean).length : 0);
export function parseRobots(txt) {
  const groups = [], sitemaps = []; let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, "").trim().match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "sitemap") { sitemaps.push(v); continue; }
    if (k === "user-agent") { if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if ((k === "allow" || k === "disallow") && cur) cur.rules.push([k, v]);
  }
  return { groups, sitemaps };
}
export function rootAccess(groups, bot) {
  const b = bot.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && b.includes(a)));
  const used = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  if (!used.length) return "allowed (no rule)";
  const rules = used.flatMap((g) => g.rules).filter(([, v]) => v !== "");
  const root = (v) => { const p = v.replace(/\$$/, ""); return p === "/" || p === "/*" || p === "*"; };
  const dis = rules.filter(([k, v]) => k === "disallow" && root(v)), allow = rules.filter(([k, v]) => k === "allow" && (root(v) || v === "/$"));
  const who = own.length ? "own rule" : "* rule";
  return dis.length && !allow.length ? `BLOCKED (${who})` : `allowed (${who})`;
}
export function pathAllowed(groups, ua, p) {
  const b = ua.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && b.includes(a)));
  const used = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  let best = null;
  for (const [k, v] of used.flatMap((g) => g.rules)) {
    if (v === "") continue;
    const anchored = v.endsWith("$"), body = (anchored ? v.slice(0, -1) : v).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, (ch) => "\\" + ch)).join(".*");
    if (!new RegExp("^" + body + (anchored ? "$" : "")).test(p)) continue;
    if (!best || v.length > best[1].length || (v.length === best[1].length && k === "allow")) best = [k, v];
  }
  return !best || best[0] === "allow";
}
export function schema(html) {
  const blocks = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const items = []; let bad = 0;
  const walk = (o, d = 0) => {
    if (d > 8 || !o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, d + 1));
    if (o["@type"]) { const a = o.address; items.push({ type: [].concat(o["@type"]).join("/"), name: o.name ?? null, telephone: o.telephone ?? null, address: a ? (typeof a === "string" ? a : [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(", ")) : null, areaServed: o.areaServed ? [].concat(o.areaServed).map((x) => (typeof x === "string" ? x : x.name)).filter(Boolean).slice(0, 30) : null, rating: o.aggregateRating ? `${o.aggregateRating.ratingValue} (${o.aggregateRating.reviewCount ?? o.aggregateRating.ratingCount ?? "?"})` : null, sameAs: o.sameAs ? [].concat(o.sameAs) : [] }); }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === "object" && k !== "@context") walk(v, d + 1);
  };
  for (const b of blocks) { try { walk(JSON.parse(b.replace(/^\s*(\/\/)?\s*(<!--|<!\[CDATA\[)/, "").replace(/(\/\/)?\s*(-->|\]\]>)\s*$/, "").trim())); } catch { bad++; } }
  return { jsonLdBlocks: blocks.length, unparsable: bad, types: [...new Set(items.map((i) => i.type))], questions: items.filter((i) => /\bQuestion\b/.test(i.type)).length, reviews: items.filter((i) => /\bReview\b/.test(i.type)).length, business: items.filter((i) => /LocalBusiness|RealEstate|Organization|HomeAndConstructionBusiness|ProfessionalService|Corporation/.test(i.type)).slice(0, 3) };
}
export function page(html, finalUrl) {
  const origin = (() => { try { return new URL(finalUrl).origin; } catch { return ""; } })();
  const t = visibleText(html);
  const links = tags(html, "a").map((a) => a.href).filter(Boolean);
  const abs = links.map((h) => { try { return new URL(h, finalUrl); } catch { return null; } }).filter(Boolean);
  const internal = abs.filter((u) => u.origin === origin);
  const linkTag = tags(html, "link").find((a) => (a.rel || "").toLowerCase().split(/\s+/).includes("canonical"));
  const canonical = linkTag?.href ? (() => { try { return new URL(linkTag.href, finalUrl).href; } catch { return linkTag.href; } })() : null;
  const norm = (u) => { try { const x = new URL(u); return (x.host.replace(/^www\./, "") + x.pathname.replace(/\/$/, "")).toLowerCase(); } catch { return u; } };
  const robotsMeta = meta(html, "robots");
  return {
    title: inner(html, "title")[0] ?? null, description: meta(html, "description"), canonical, canonicalPointsElsewhere: canonical ? norm(canonical) !== norm(finalUrl) : null, robotsMeta, noindex: /noindex|none/i.test(robotsMeta || ""),
    h1: inner(html, "h1").slice(0, 3), h2: inner(html, "h2").slice(0, 12), words: words(t.all), mainWords: t.main ? words(t.main) : null, internalLinks: internal.length, externalLinks: abs.length - internal.length, internalPaths: [...new Set(internal.map((u) => u.pathname))],
    equalHousing: /equal housing/i.test(t.all), licence: (t.all.match(/\b(?:DRE|BRE|CalDRE|licen[sc]e)\s*(?:Lic(?:ense)?\.?\s*)?#?\s*:?\s*\d{6,8}\b/gi) || []).slice(0, 3),
    googleVerified: !!meta(html, "google-site-verification"), bingVerified: !!meta(html, "msvalidate.01"),
    trust: { googleBusinessLink: /(g\.page\/|maps\.app\.goo\.gl|google\.com\/maps\/place|[?&]cid=\d{6,})/i.test(html), reviewWidget: [...new Set((html.match(/trustpilot|birdeye|podium|elfsight|grade\.us|nicejob|bbb\.org/gi) || []).map((s) => s.toLowerCase()))] },
    platform: /\/wp-content\/|\/wp-json\//i.test(html) ? "WordPress" : /static\.wixstatic\.com/i.test(html) ? "Wix" : /static1\.squarespace\.com/i.test(html) ? "Squarespace" : /webflow\.js/i.test(html) ? "Webflow" : /cdn\.shopify\.com/i.test(html) ? "Shopify" : /\/_next\/static\//.test(html) ? "Next.js" : /lpcdn|luxurypresence/i.test(html) ? "Luxury Presence" : "unknown",
  };
}
export function classify(pathname) {
  let p = pathname.toLowerCase(); try { p = decodeURIComponent(p); } catch {}
  if (/\/(blog|news|articles|resources|posts?|learn)(\/|$)/.test(p)) return "blog";
  const slug = p.replace(/\/+$/, "").split("/").pop() || "", parts = slug.split("-").length;
  const article = parts >= 7 || /-vs-|-or-|-versus-/.test(slug) || /^(what|why|how|when|can|do|does|is|are|should|top|best|\d+)-/.test(slug);
  const place = /-ca$|-[a-z]{2}$/.test(slug) && /-in-|-near-/.test(slug) || /\/ca\/[a-z]/.test(p) || /^(we-buy-houses|sell-(my-)?house(-fast)?|cash-home-buyers?|realtors?|real-estate-agents?)-in-[a-z]/.test(slug);
  if (/\/ca\/[a-z]/.test(p) && !article) return "city";
  if (place && !article) return "city";
  if (article) return "blog";
  if (/probate|inherit|divorce|foreclos|relocat|downsiz|tenant|fire-damage|as-is|behind-on-payments/.test(slug)) return "situation";
  if (/^(contact(-us)?|get-?(an?-)?(cash-)?offer|request-(an-)?offer)$/.test(slug)) return "contact";
  if (/^(sell|we-buy|how-it-works|our-process|about(-us)?|faq|services?|reviews|testimonials)/.test(slug)) return "service";
  return "other";
}
async function sitemaps(pewp, urls, deadline, files) {
  const queue = [...new Set(urls)], seen = new Set(), out = { pages: 0, urls: [], lastmods: [], read: 0, errors: [] };
  while (queue.length && out.read < 15) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    const r = await get(pewp, u, "sitemap", deadline); out.read++; if (r.cacheFile) files.add(r.cacheFile);
    if (r.status !== 200 || looksHtml(r)) { out.errors.push(`${u}: ${r.status || r.error}`); continue; }
    const locs = [...r.body.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)/gi)].map((m) => decode(m[1]));
    if (/<sitemapindex/i.test(r.body)) queue.push(...locs); else { out.pages += locs.length; out.urls.push(...locs.slice(0, 5000)); out.lastmods.push(...[...r.body.matchAll(/<lastmod>\s*([^<\s]+)/gi)].map((m) => m[1])); }
  }
  const ages = out.lastmods.map((d) => (Date.now() - Date.parse(d)) / 864e5).filter(Number.isFinite).sort((a, b) => a - b);
  return { pages: out.pages, sitemapsRead: out.read, errors: out.errors.slice(0, 5), medianLastmodDays: ages.length ? Math.round(ages[Math.floor(ages.length / 2)]) : null, _urls: out.urls };
}

export async function auditSite(pewp, input, { pages = 4 } = {}) {
  const files = new Set(), startedAt = Date.now(), deadline = startedAt + 120000;
  const base = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  const keep = (r) => { if (r?.cacheFile) files.add(r.cacheFile); return r; };
  const robots0 = keep(await get(pewp, `${base.origin}/robots.txt`, "text", deadline));
  const rb0 = robots0.status === 200 && !looksHtml(robots0) ? parseRobots(robots0.body) : { groups: [], sitemaps: [] };
  const res = { input, fetchedAt: iso() };
  const done = (o) => ({ ...res, ...o, cacheFiles: [...files] });
  if (!pathAllowed(rb0.groups, CRAWL_UA, base.pathname || "/")) return done({ status: null, error: "robots.txt disallows this page for our crawler: not fetched" });
  let home = keep(await get(pewp, base.href, "html", deadline));
  if (home.status === 0 && !/^www\./.test(base.hostname) && !/skipped|bad url/.test(home.error || "") && !/^(127\.|localhost)/.test(base.hostname)) { const alt = keep(await get(pewp, `${base.protocol}//www.${base.host}${base.pathname}`, "html", deadline)); if (alt.status) home = { ...alt, note: `bare domain failed (${home.error}); used www.` }; }
  Object.assign(res, { finalUrl: home.finalUrl || home.url, status: home.status, error: home.error || null, note: home.note || null });
  if (/host refused earlier/.test(home.error || "")) return done({ error: `BLOCKED: rate limit or bot protection (${home.error.match(/HTTP \d+/)?.[0] || "refused"}); the site is stopped for this run and not retried` });
  if (home.refusal || home.challenge) return done({ error: `BLOCKED: bot protection or rate limit (HTTP ${home.status}); not bypassed, site stopped for this run` });
  if (home.status !== 200) return done({ error: res.error || `NOT READ: HTTP ${home.status}` });
  const refresh = meta(home.body, "refresh"), target = refresh && (refresh.match(/url\s*=\s*['"]?([^'";\s]+)/i) || [])[1];
  if (target) return done({ error: "NOT READ: redirect interstitial (meta refresh), not the site" });
  const finalHost = new URL(res.finalUrl).hostname.replace(/^www\./, ""), inHost = base.hostname.replace(/^www\./, "");
  if (finalHost !== inHost) return done({ error: `NOT READ: redirected to another host (${finalHost}), not the site` });
  const origin = new URL(res.finalUrl).origin;
  const p = page(home.body, res.finalUrl), sc = schema(home.body);
  const robotsOk = robots0.status === 200 && !looksHtml(robots0);
  const crawlers = robotsOk ? Object.fromEntries(Object.entries(BOTS).map(([bot, what]) => [bot, `${rootAccess(rb0.groups, bot)} - ${what}`])) : null;
  const sm = await sitemaps(pewp, rb0.sitemaps.length ? rb0.sitemaps : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`], deadline, files);
  const bare = (h) => h.replace(/^www\./, "");
  const pool = [...new Set([...sm._urls.map((u) => { try { const x = new URL(u); return bare(x.hostname) === finalHost ? x.pathname : null; } catch { return null; } }).filter(Boolean), ...p.internalPaths])];
  const byKind = {}; for (const pa of pool) (byKind[classify(pa)] ||= []).push(pa);
  const llms = {};
  for (const name of ["llms.txt"]) { const r = keep(await get(pewp, `${origin}/${name}`, "text", deadline)); llms[name] = r.status === 200 && !looksHtml(r) && r.body.trim().length > 0 ? `present (${r.body.length} chars)` : `none (HTTP ${r.status || r.error})`; }
  const samples = [];
  for (const kind of ["city", "situation", "service", "contact", "blog"].slice(0, pages)) {
    const pa = byKind[kind]?.[0]; if (!pa) continue;
    if (!pathAllowed(rb0.groups, CRAWL_UA, pa)) { samples.push({ kind, path: pa, status: "skipped: robots.txt disallows it for our crawler" }); continue; }
    const r = keep(await get(pewp, origin + pa, "html", deadline));
    if (r.status !== 200 || !looksHtml(r)) { samples.push({ kind, path: pa, status: r.status || r.error }); continue; }
    const sp = page(r.body, r.finalUrl || r.url), ss = schema(r.body);
    samples.push({ kind, path: pa, status: 200, title: sp.title, h1: sp.h1[0] ?? null, words: sp.words, mainWords: sp.mainWords, h2: sp.h2, schema: ss.types, faqQuestions: ss.questions, noindex: sp.noindex, internalLinks: sp.internalLinks });
  }
  return done({ xRobotsTag: home.headers?.["x-robots-tag"] || null, page: p, schema: sc, robotsTxt: robotsOk ? "present" : "none or unreadable", crawlers, sitemap: { pages: sm.pages, sitemapsRead: sm.sitemapsRead, medianLastmodDays: sm.medianLastmodDays, errors: sm.errors, byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.length])) }, llms, samples, jsOnlyRisk: (p.mainWords ?? p.words) < 150 ? "HIGH: little text in the raw HTML; content probably needs JavaScript, which many AI crawlers do not run" : "low", seconds: Math.round((Date.now() - startedAt) / 1000) });
}

// One PAGE of a SERP winner (not a whole site): robots.txt first, cached, one attempt, the host stops at its first 403/429/503 or bot check.
// Returns what the page is made of: visible words, headings, schema types, FAQ items, internal links.
export async function auditUrl(pewp, url) {
  let u; try { u = new URL(url); } catch { return { url, domain: null, fetchedAt: iso(), error: "NOT READ: not a valid URL", cacheFiles: [] }; }
  const files = new Set(), keep = (r) => { if (r?.cacheFile) files.add(r.cacheFile); return r; };
  const base = { url, domain: u.hostname.replace(/^www\./, ""), fetchedAt: iso() };
  const robots = keep(await get(pewp, `${u.origin}/robots.txt`, "text"));
  const rb = robots.status === 200 && !looksHtml(robots) ? parseRobots(robots.body) : { groups: [] };
  const done = (o) => ({ ...base, ...o, cacheFiles: [...files] });
  if (!pathAllowed(rb.groups, CRAWL_UA, u.pathname + u.search)) return done({ error: "robots.txt disallows this page for our crawler: not fetched" });
  const r = keep(await get(pewp, url, "html"));
  if (r.refusal || r.challenge || /host refused earlier/.test(r.error || "")) return done({ error: `BLOCKED: rate limit or bot protection (HTTP ${r.status || "refused"}); the site is stopped for this run and not retried` });
  if (r.status !== 200 || !looksHtml(r)) return done({ error: `NOT READ: HTTP ${r.status || r.error}` });
  const p = page(r.body, r.finalUrl || r.url), sc = schema(r.body);
  return done({ status: 200, fetchedAt: r.fetchedAt || base.fetchedAt, title: p.title, h1: p.h1[0] ?? null, h2: p.h2, h3: inner(r.body, "h3").slice(0, 24), li: inner(r.body, "li").slice(0, 80), strong: inner(r.body, "strong").slice(0, 60), words: p.words, mainWords: p.mainWords, schemaTypes: sc.types, faqQuestions: sc.questions, internalLinks: p.internalLinks, noindex: p.noindex });
}

// Who to audit: named competitors first, then the domains that win the captured SERPs most often (top 3 positions count double).
export function pickCompetitors(ctx, { max = 12, extra = [], fromBusiness = true } = {}) {
  const own = ctx.domain, score = new Map();
  const add = (d, n) => { d = domainOf(d); if (d && d !== own && !d.endsWith("." + own)) score.set(d, (score.get(d) || 0) + n); };
  if (fromBusiness) (ctx.business?.competitors || []).forEach((d) => add(d, 1e6));
  extra.forEach((d) => add(d, 1e6));
  for (const c of readStep(ctx, "serp")?.captures || []) for (const o of c.organic.slice(0, 5)) add(o.domain, o.position <= 3 ? 2 : 1);
  return [...score].sort((a, b) => b[1] - a[1]).slice(0, max).map(([d]) => d);
}

// The owner-approved competitor list (contract C3): { rows:[{ name, domain|null, handle|null, platform, kind, ... }] } or a bare list of rows.
// Domains are what gets audited; a row without a domain is kept for the report and the offsite plan.
export function approvedCompetitorRows(file) {
  const rows = listFile(file, "rows").filter((x) => x && typeof x === "object");
  const withDomain = rows.filter((x) => String(x.domain ?? "").trim());
  return { file, rows: rows.length, domains: [...new Set(withDomain.map((x) => String(x.domain).trim()))], withoutDomain: rows.filter((x) => !String(x.domain ?? "").trim()).map((x) => ({ name: x.name ?? null, handle: x.handle ?? null, platform: x.platform ?? null })) };
}

export function summarise(r, f) {
  if (r.error || !r.page) return null;
  return {
    homeWords: f(r.page.words, { unit: "words of visible text in the raw HTML of the home page" }),
    sitemapPages: f(r.sitemap.pages, { unit: "URLs in the sitemap(s)" }),
    sitemapMedianAgeDays: f(r.sitemap.medianLastmodDays, { unit: "days since lastmod, median" }),
    cityPages: f(r.sitemap.byKind.city ?? 0, { unit: "sitemap/home URLs classified as city pages" }),
    faqQuestions: f(r.schema.questions, { unit: "Question items in the home page JSON-LD" }),
    schemaTypes: f(r.schema.types, { unit: "JSON-LD types on the home page" }),
    aiSearchBotsBlocked: f(r.crawlers ? ["OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "Bingbot"].filter((b) => /BLOCKED/.test(r.crawlers[b])) : null, { unit: "AI search crawlers blocked at the site root by robots.txt" }),
  };
}

export async function runAuthority(ctx, { target, competitors, cache = null, release = null, maxAgeDays = 30, run: doRun = false }) {
  const out = path.join(ctx.pewp, "authority.json");
  const prev = J(out);
  const wanted = [target, ...competitors].map(domainOf);
  if (prev && ageDays(prev.fetchedAt) < maxAgeDays && wanted.every((d) => prev.results?.some((r) => r.domain === d))) return { status: "reused", file: out, doc: prev };
  const cacheDir = cache || defaultCache(), rel = release || cachedRelease(cacheDir);
  if (!rel) return { status: "blocked", why: `no complete Common Crawl release in the cache (${cacheDir || "no seoKitCache in machine.local.json"}): run authority.mjs --release <id> once (about 11 GB), see doctor.mjs` };
  if (!doRun) return { status: "not-run", why: `authority reads about 11 GB from disk (15 to 30 min); add --authority to run it (release ${rel} is cached)`, release: rel };
  const args = [path.join(HERE, "authority.mjs"), out, "--target", target, ...competitors.flatMap((c) => ["--competitor", c]), "--cache", cacheDir, "--release", rel];
  // 90 min bound; a long run prints progress, so the 1 MiB default buffer would kill it (ENOBUFS) before it finished
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 90 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { status: "failed", why: `authority.mjs ${r.error.code === "ETIMEDOUT" ? "did not finish in 90 min and was killed" : `could not run (${r.error.code || r.error.message})`}: ${(r.stderr || r.stdout || "").slice(-300)}` };
  if (r.status !== 0) return { status: "failed", why: `authority.mjs exit ${r.status}: ${(r.stderr || r.stdout || "").slice(-300)}` };
  return { status: "ran", file: out, doc: J(out), release: rel };
}

export async function run(ctx, { domains = [], approvedFile = null, fromSerp = false, max = 12, pages = 4, authority = false, authorityCache = null, authorityRelease = null, maxAgeDays = 30 } = {}) {
  const b = needBusiness(ctx);
  const keepPort = (d) => (/^(https?:\/\/)?(127\.0\.0\.1|localhost):\d+/.test(d) ? d.replace(/\/$/, "") : domainOf(d)); // local test servers keep their port
  const approved = approvedFile ? approvedCompetitorRows(approvedFile) : null;
  let list, suggested = [];
  if (approved) { // exactly the approved rows with a domain (plus --domain); the owner approved this list, so --max does not cut it
    list = [...new Set([...approved.domains, ...domains].map(keepPort))];
    if (fromSerp) { const have = new Set(list.map(domainOf)); suggested = pickCompetitors(ctx, { max, extra: list, fromBusiness: false }).filter((d) => !have.has(d)); }
    if (!list.length) { const m = `the approved competitor list ${approvedFile} has no row with a domain (${approved.rows} rows, ${approved.withoutDomain.length} with only a handle): approve a list that has websites, or pass --domain`; writeBlocked(ctx, "competitors", m); throw new Blocked(m); }
  } else {
    const named = [...domains, ...(b.competitors || [])].map(keepPort);
    list = [...new Set(fromSerp ? pickCompetitors(ctx, { max, extra: named }) : named)].slice(0, max);
    if (!list.length) { const m = "no competitor domains: name them in business.json, pass --domain, or import SERP captures and use --from-serp"; writeBlocked(ctx, "competitors", m); throw new Blocked(m); }
  }
  const existing = readStep(ctx, "existing")?.competitorAudits || {};
  const sites = [];
  for (const d of list) {
    const old = existing[d];
    if (old && ageDays(old.fetchedAt) < maxAgeDays) { sites.push({ ...old, reusedFrom: old.importedFrom || "existing research", reused: true }); continue; }
    let r; // one malformed name ("foo bar") is that site's error, not the end of every other site's audit
    try { r = await auditSite(ctx.pewp, d, { pages }); } catch (e) { if (e.code !== "ERR_INVALID_URL") throw e; r = { input: d, fetchedAt: iso(), error: "NOT READ: not a valid domain or URL", cacheFiles: [] }; } // any other error is a real crash: not hidden
    const f = factor(`competitor raw-HTML audit of ${d} (research-competitors.mjs, robots.txt obeyed)`, r.fetchedAt, r.cacheFiles?.[0] || null);
    sites.push({ domain: d, ...r, facts: summarise(r, f) });
  }
  const auth = await runAuthority(ctx, { target: b.domain, competitors: list, cache: authorityCache, release: authorityRelease, maxAgeDays, run: authority });
  const authority_ = { status: auth.status, ...(auth.why ? { why: auth.why } : {}), ...(auth.status === "reused" || auth.status === "ran" ? { file: auth.file, release: auth.doc.release, fetchedAt: auth.doc.fetchedAt, domains: auth.doc.results.map((r) => { const f = factor(auth.doc.source, auth.doc.fetchedAt, auth.file); return r.inGraph ? { domain: r.domain, role: r.role, linkingDomains: f(r.linkingDomains, { unit: "distinct linking domains in this release (domain level)" }), strengthRank: f(r.harmonicPos ?? null, { unit: "harmonic-centrality rank, 1 = strongest" }) } : { domain: r.domain, inGraph: false }; }), linkGap: (auth.doc.linkGap || []).slice(0, 30) } : {}) };
  return writeStep(ctx, "competitors", { ...(approved ? { approvedFile, approvedRows: approved.rows, withoutDomain: approved.withoutDomain, suggested } : {}), audited: list, blockedSites: sites.filter((s) => /BLOCKED/.test(s.error || "")).map((s) => s.domain), sites, authority: authority_ });
}

await runCli(import.meta.url, "node research-competitors.mjs <target> [--domain d]... [--approved-competitors FILE] [--from-serp] [--max 12] [--pages 4] [--authority] [--authority-cache DIR] [--authority-release ID] [--max-age-days 30] [--cwd DIR]", ["from-serp", "authority"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { domains: a.all("domain"), approvedFile: a.get("approved-competitors"), fromSerp: a.has("from-serp"), max: a.num("max", 12), pages: a.num("pages", 4), authority: a.has("authority"), authorityCache: a.get("authority-cache"), authorityRelease: a.get("authority-release"), maxAgeDays: a.num("max-age-days", 30) });
  return `OK competitors: ${r.sites.length} sites (${r.sites.filter((s) => s.facts).length} read, ${r.sites.filter((s) => s.reused).length} reused, ${r.blockedSites.length} stopped by bot protection); authority: ${r.authority.status}${r.authority.why ? " (" + r.authority.why + ")" : ""} -> ${path.join(ctx.rdir, "competitors.json")}`;
});
