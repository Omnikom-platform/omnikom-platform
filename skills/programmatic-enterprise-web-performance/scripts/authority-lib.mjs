// Shared code of the authority lane (stages/authority.md): authority-classify.mjs, authority-vet.mjs, authority-outreach.mjs.
//   rules    taxonomy + industry packs from rules/link-sources/ (PEWP_RULES_DIR/link-sources overrides)
//   classify a domain name -> a source type (ordered rules; an unknown stays "unclassified", never guessed)
//   html     small parsers: title, description, robots meta, links with rel, visible text, listing phrases, spam signals
//   client   a polite read-only fetcher: robots.txt first, honest user agent, a gap per host, a stop at 403/429, --exclude on every
//            request, a run deadline, a request budget, every 2xx answer cached through cache.mjs
//   verdict  PURSUE / CHECK BY HAND / AVOID with the reasons, from what was read
// Nothing here posts, logs in or submits: GET only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { domainOf, queryOverlap, tokens, Usage } from "./research-lib.mjs";
import { cachedFetch } from "./cache.mjs";

// decodeURIComponent throws on a stray "%" ("/50%-off"): one odd link on a page must not crash the whole vetting run.
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const readRuleJson = (f) => JSON.parse(((s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s))(fs.readFileSync(f, "utf8"))); // a pack saved by Notepad starts with a BOM
// --exclude path regexes: an invalid one is a usage error (exit 2) before any request, not a crash with a stack (exit 1).
export function compileExcludes(list) {
  return (list || []).map((r) => { try { return new RegExp(r); } catch (e) { throw new Usage(`--exclude "${r}" is not a valid regular expression (${e.message}); nothing was fetched`); } });
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const UA = `PEWP-Authority/1.0 (link-source check for a site owner; read-only, GET only; contact ${process.env.PEWP_CONTACT || "see skill"})`;
export class Stop extends Error { constructor(msg, code = 4) { super(msg); this.code = code; } }
export const iso = () => new Date().toISOString();
export const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
export const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ------------------------------------------------------------------------------------------------ rules
export function linkSourcesDir() { return process.env.PEWP_RULES_DIR ? path.join(process.env.PEWP_RULES_DIR, "link-sources") : path.join(here, "..", "rules", "link-sources"); }
const rulesCache = new Map();
export function loadRules(dir = linkSourcesDir()) {
  if (rulesCache.has(dir)) return rulesCache.get(dir);
  const tax = readRuleJson(path.join(dir, "taxonomy.json"));
  const packs = new Map();
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".json") && f !== "taxonomy.json") { const p = readRuleJson(path.join(dir, f)); packs.set(p.slug, p); }
  const out = { tax, packs, dir };
  rulesCache.set(dir, out);
  return out;
}
// The pack for this business: --industry, else business.json industry/kind (slug or alias), else local-generic and it says so.
export function pickPack(rules, business, override = null) {
  const asked = override || business?.industry || business?.kind || null;
  const n = norm(asked);
  if (n) for (const p of rules.packs.values()) if (p.slug === n || (p.aliases || []).map(norm).includes(n)) return { pack: p, via: override ? "--industry" : "business.json industry", asked };
  return { pack: rules.packs.get("local-generic"), via: "fallback", asked, note: asked ? `the industry "${asked}" has no pack; local-generic is used (add a pack in rules/link-sources/)` : "no industry named in business.json; local-generic is used (pass --industry <slug>)" };
}
// The pack plus the packs it extends (own entries first, so the specific pack wins).
export function mergedPack(rules, pack, seen = new Set()) {
  if (!pack || seen.has(pack.slug)) return { slug: pack?.slug, domainTypes: [], patterns: [], angles: [], avoid: [], reviewSites: [], chain: [] };
  seen.add(pack.slug);
  const base = (pack.extends || []).map((s) => mergedPack(rules, rules.packs.get(s), seen));
  const cat = (k) => [...(pack[k] || []).map((x) => (typeof x === "object" ? { ...x, pack: pack.slug } : x)), ...base.flatMap((b) => b[k] || [])];
  return { slug: pack.slug, title: pack.title, domainTypes: cat("domainTypes"), patterns: cat("patterns"), angles: cat("angles"), avoid: cat("avoid"), reviewSites: [...new Set(cat("reviewSites"))], providerPatterns: cat("providerPatterns"), providerText: cat("providerText"), chain: [pack.slug, ...base.flatMap((b) => b.chain)] };
}

// ------------------------------------------------------------------------------------------------ classify
export const hostOf = (u) => domainOf(u);
export const hostIs = (host, base) => host === base || host.endsWith("." + base);
export function labelOf(host) {
  const p = host.split(".");
  if (p.length < 2) return host;
  let i = p.length - 2;
  if (p.length >= 3 && ["co", "com", "org", "net", "gov", "edu", "ac"].includes(p[i]) && p[p.length - 1].length === 2) i--;
  return p[i];
}
// Same name: equal labels, or the shorter (6+ letters) inside the longer (josephsabeh / josephsabehgroup).
export function sameBrand(a, b) {
  const x = labelOf(a), y = labelOf(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 6 && l.includes(s);
}
const re = (src) => new RegExp(src, "i");
export function classifyDomain(domain, ctx) {
  const d = hostOf(domain), { rules, pack } = ctx;
  const hit = (type, confidence, ruleId, why, source = null, note = null) => ({ type, confidence, ruleId, why, source, note });
  const competitors = (ctx.competitors || []).map(hostOf);
  const comp = competitors.find((c) => hostIs(d, c));
  if (comp) return hit("competitor-own-property", "high", "competitor-site", `${d} is a competitor's own site`);
  if (ctx.target && sameBrand(d, hostOf(ctx.target))) return hit("own-property", "medium", "same-name-as-target", `the name of ${d} matches the business's own domain`);
  const cb = competitors.find((c) => sameBrand(d, c));
  if (cb) return hit("competitor-own-property", "medium", "same-name-as-competitor", `the name of ${d} matches the competitor ${cb}: it is probably that business's own site`);
  const ph = (pack?.domainTypes || []).find((e) => hostIs(d, e.host));
  if (ph) return hit(ph.type, "high", `pack:${ph.pack || pack.slug}:${ph.host}`, `named in the ${ph.pack || pack.slug} pack${ph.note ? ": " + ph.note : ""}`, `pack ${ph.pack || pack.slug}`, ph.note || null);
  const kh = rules.tax.knownHosts.find((e) => hostIs(d, e.host));
  if (kh) return hit(kh.type, "high", `known:${kh.host}`, `a well-known ${rules.tax.types[kh.type].label.toLowerCase()}`, "taxonomy knownHosts");
  const dr = rules.tax.domainRules, spam = dr.filter((r) => r.type === "spam-suspect"), rest = dr.filter((r) => r.type !== "spam-suspect");
  for (const r of spam) if (re(r.re).test(d)) return hit(r.type, r.confidence, r.id, r.why, "taxonomy domainRules");
  for (const p of pack?.patterns || []) if (re(p.re).test(d)) return hit(p.type, "low", `pack-pattern:${p.re.slice(0, 24)}`, p.why, `pack ${pack.slug}`);
  for (const r of rules.tax.tldRules) if (re(r.re).test(d)) return hit(r.type, r.confidence, r.id, r.why, "taxonomy tldRules");
  for (const src of pack?.providerPatterns || []) if (re(src).test(labelOf(d))) return hit("provider-business", "medium", `provider-pattern:${src.slice(0, 24)}`, "the domain name reads like a business that sells the same or a neighbouring service", `pack ${pack.slug}`);
  for (const r of rest) if (re(r.re).test(d)) return hit(r.type, r.confidence, r.id, r.why, "taxonomy domainRules");
  return hit("unclassified", null, null, "no rule matched this domain name");
}
// A provider business (another agent, a cash buyer, a contractor ...) speaks in the first person about what it sells; only wording that does so counts.
export function providerByText(text, pack) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return null;
  for (const src of pack?.providerText || []) { const m = t.match(re(src)); if (m) return { type: "provider-business", confidence: "medium", ruleId: "provider-text", why: `the home page says "${m[0].slice(0, 60)}": it sells the same or a neighbouring service`, source: `pack ${pack.slug} providerText` }; }
  return null;
}
// From a home page's title / description / first heading (only when the page was really read).
export function classifyText(text, rules) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return null;
  for (const r of rules.tax.textRules) if (re(r.re).test(t)) return { type: r.type, confidence: r.confidence, ruleId: r.id, why: r.why, source: "taxonomy textRules" };
  return null;
}

// ------------------------------------------------------------------------------------------------ html
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
export const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => { if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; } return ENT[e.toLowerCase()] ?? m; });
export function visibleText(html) {
  return decode(String(html).replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null; };
function metaContent(html, name) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) { const n = attr(m[0], "name") || attr(m[0], "property"); if (n && n.toLowerCase() === name) return attr(m[0], "content"); }
  return null;
}
export function parseLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], "href");
    if (!href || /^(javascript:|#|tel:|data:)/i.test(href.trim())) continue;
    let abs; try { abs = new URL(href.trim(), base).href; } catch { continue; }
    out.push({ href: abs, text: visibleText(m[2]).slice(0, 120), rel: (attr(m[1], "rel") || "").toLowerCase().split(/[\s,]+/).filter(Boolean) });
  }
  return out;
}
export const QUALIFIED = ["nofollow", "sponsored", "ugc"];
export function analyzeHtml(html, pageUrl, { ignoreHosts = [] } = {}) {
  const host = hostOf(pageUrl);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const robotsMeta = [metaContent(html, "robots"), metaContent(html, "googlebot")].filter(Boolean).join(",").toLowerCase();
  const text = visibleText(html);
  const links = parseLinks(html, pageUrl);
  const pageNofollow = /\bnofollow\b|\bnone\b/.test(robotsMeta);
  const ext = links.filter((l) => /^https?:/i.test(l.href)).filter((l) => { const h = hostOf(l.href); return h && !hostIs(h, host) && !hostIs(host, h) && !ignoreHosts.some((i) => hostIs(h, i)); });
  const qualified = ext.filter((l) => pageNofollow || l.rel.some((r) => QUALIFIED.includes(r)));
  const distinct = new Set(ext.map((l) => hostOf(l.href)));
  const n = ext.length, q = qualified.length;
  const label = n < 3 ? "too-few" : q / n >= 0.9 ? "nofollow" : q / n <= 0.1 ? "followed" : "mixed";
  return {
    url: pageUrl, title: title ? visibleText(title) : null, description: metaContent(html, "description"), h1: h1 ? visibleText(h1) : null,
    canonical: (() => { for (const m of html.matchAll(/<link\b[^>]*>/gi)) if (/canonical/i.test(attr(m[0], "rel") || "")) return attr(m[0], "href"); return null; })(),
    robotsMeta: robotsMeta || null, noindexMeta: /\bnoindex\b|\bnone\b/.test(robotsMeta), words: text ? text.split(/\s+/).length : 0, text,
    links, outbound: { external: n, qualified: q, followed: n - q, distinctDomains: distinct.size, label, pageNofollow, sample: ext.slice(0, 5).map((l) => ({ href: l.href, rel: l.rel })) },
  };
}

// Listing language. Each list is checked against the visible text; the matched phrases are the evidence.
export const FREE_RE = /free listing|list(ing)? your (business|company|practice|firm)|for free|add your (business|company|listing|site|website|agency|practice)|claim (your|this) (free )?(listing|profile|business|page)|get listed|submit your (business|listing|site|website|company|profile)|join (for )?free|free to (join|list)|create (a )?(free )?(profile|listing)|become a (member|partner)/gi;
export const PAID_RE = /\b(pricing (and|&) plans|pricing page|our plans|choose a plan|premium (listing|profile|membership)|featured (listing|profile)|sponsored (listing|post)|advertise (with|on) us|paid (placement|listing)|get featured|upgrade (your|to)|buy (a )?(link|backlink)s?)\b|\$\s?\d[\d,]*(\.\d\d)?\s*(\/|per|a)\s*(mo|month|yr|year)|\$\s?\d{2,4}\s*(listing|membership|one-time)/gi;
export const EDIT_RE = /write for us|guest (post|author|contributor)|contribute (an article|a story|to)|submit (a )?(story|tip|news|press release|article)|our editors?|editorial (team|policy|guidelines|standards)|methodology|how we (rank|choose|pick|select|rate|review)|nominate|call for (nominations|submissions)|pitch us|news tips?/gi;
export const SELLS_LINKS_RE = /buy (backlinks?|links)|sell(ing)? (backlinks?|links)|paid links?|link (building|exchange) services?|guest posts? (service|for sale)|sponsored posts? (available|for sale)|dofollow (links?|backlinks?)/gi;
export const SPAM_TOPIC_RE = /\b(casino|poker|betting|viagra|cialis|payday loans?|essay writing|escort|porn|replica watches|forex signals)\b/gi;
export const PARKED_RE = /this domain (is )?(for sale|may be for sale)|buy this domain|domain (is )?parked|parked (free|domain)|account suspended|default web site page/gi;
export const matches = (text, rx) => [...new Set([...String(text).matchAll(new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : rx.flags + "g"))].map((m) => m[0].toLowerCase().trim()))].slice(0, 5);
export function listingModel(text) {
  const free = matches(text, FREE_RE), paid = matches(text, PAID_RE), editorial = matches(text, EDIT_RE);
  const model = paid.length && !free.length ? "paid" : paid.length && free.length ? "mixed" : free.length ? "free" : editorial.length ? "editorial" : "unknown";
  return { model, free, paid, editorial };
}
const CAND_KINDS = [
  { kind: "editorial", rank: 3, re: /write for us|guest post|contribute|nominate|pitch|submit (a )?(story|tip|news)|news tip/i },
  { kind: "paid", rank: 4, re: /advertis|sponsor(ed)? (listing|post)|get featured|pricing|packages/i },
  { kind: "free-listing", rank: 1, re: /get listed|add (your )?(business|listing|site|company|agency|practice|website)|claim|submit|list (your|a) |create (a )?(free )?(profile|listing)|register your/i },
  { kind: "membership", rank: 2, re: /\bjoin\b|become a (member|partner)|membership|\bapply\b/i },
];
const NO_VISIT = /\b(login|log-in|signin|sign-in|register|signup|sign-up|checkout|cart|account|oauth|wp-admin|wp-login)\b/i;
export function listingCandidates(links, pageUrl) {
  const host = hostOf(pageUrl), seen = new Set(), out = [];
  for (const l of links) {
    const u = l.href;
    if (!/^(https?|mailto):/i.test(u) || seen.has(u)) continue;
    let p = ""; try { p = new URL(u).pathname; } catch { continue; }
    const hay = `${l.text} ${safeDecode(p)}`;
    const k = CAND_KINDS.find((c) => c.re.test(hay));
    if (!k) continue;
    seen.add(u);
    const sameHost = /^https?:/i.test(u) && hostIs(hostOf(u), host);
    out.push({ kind: k.kind, rank: k.rank, text: l.text, url: u, sameHost, visit: sameHost && !NO_VISIT.test(p) });
  }
  return out.sort((a, b) => a.rank - b.rank || (b.sameHost - a.sameHost)).slice(0, 5);
}
export function spamSignals({ text, title, outbound, words, noindex, listing }) {
  const s = [], hay = `${title || ""} ${text}`;
  const sells = matches(hay, SELLS_LINKS_RE), topic = matches(hay, SPAM_TOPIC_RE), parked = matches(hay, PARKED_RE);
  if (sells.length) s.push({ code: "SELLS_LINKS", severity: "avoid", text: `the site talks about selling or buying links ("${sells.slice(0, 3).join('", "')}")` });
  if (topic.length >= 2 || matches(title || "", SPAM_TOPIC_RE).length) s.push({ code: "SPAM_TOPIC", severity: "avoid", text: `spam-topic words on the page ("${topic.slice(0, 3).join('", "')}")` });
  else if (topic.length) s.push({ code: "SPAM_TOPIC_WEAK", severity: "warn", text: `a spam-topic word on the page ("${topic[0]}"); may be harmless, read the page` });
  if (parked.length) s.push({ code: "PARKED", severity: "avoid", text: `the page says the domain is parked or for sale ("${parked[0]}")` });
  if (noindex) s.push({ code: "NOT_INDEXABLE", severity: "avoid", text: "the home page tells Google not to index it (noindex), so a link from it passes little" });
  if (outbound.distinctDomains >= 40) s.push({ code: "LINK_HEAVY", severity: sells.length ? "avoid" : "warn", text: `the page links out to ${outbound.distinctDomains} different sites; a very link-heavy page can be a link farm` });
  if (words < 150) s.push({ code: "THIN", severity: "warn", text: `only ${words} words on the home page (thin)` });
  return s;
}

// ------------------------------------------------------------------------------------------------ robots.txt
export function parseRobots(txt) {
  const groups = []; let g = null, lastWasAgent = false;
  for (const line of String(txt).split(/\r?\n/)) {
    const m = line.replace(/#.*/, "").match(/^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") { if (!g || !lastWasAgent) { g = { agents: [], rules: [] }; groups.push(g); } g.agents.push(m[2].toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if ((key === "allow" || key === "disallow") && g) g.rules.push({ allow: key === "allow", path: m[2] });
  }
  return groups;
}
export function robotsAllows(groups, p, ua = UA) {
  const u = ua.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && u.includes(a)));
  const rules = (specific.length ? specific : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const rx = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (rx.test(p) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// ------------------------------------------------------------------------------------------------ the polite client
export function createClient({ pewp, gapMs = 4000, timeoutMs = 20000, deadline = Infinity, excludes = [], skipDomains = [], originMap = new Map(), maxRequests = 200, ua = UA, maxAgeDays = 7, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (const [k, v] of originMap) { const h = new URL(v).hostname; if (!["127.0.0.1", "localhost", "[::1]"].includes(h)) throw new Error(`--origin may only point at a local address (got ${v} for ${k})`); }
  const stopped = new Map(), lastReal = new Map(), robotsCache = new Map();
  const stats = { requests: 0, cached: 0, stopped: [], skipped: [] };
  const physical = (u) => { const x = new URL(u); const b = originMap.get(x.hostname.replace(/^www\./, "").toLowerCase()); if (!b) return u; const bu = new URL(b); return bu.origin + bu.pathname.replace(/\/$/, "") + x.pathname + x.search; };
  const isLocal = (u) => { try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

  async function request(url) {
    const x = new URL(url), host = x.hostname.replace(/^www\./, "").toLowerCase();
    if (skipDomains.some((s) => hostIs(host, s))) { stats.skipped.push({ url, why: "skip-domain" }); return { url, skipped: "skip-domain" }; }
    if (excludes.some((r) => r.test(x.pathname))) { stats.skipped.push({ url, why: "excluded by --exclude" }); return { url, skipped: "excluded" }; }
    if (stopped.has(host)) return { url, skipped: "host-stopped", reason: stopped.get(host) };
    if (Date.now() > deadline) throw new Stop("run time cap reached", 4);
    if (stats.requests >= maxRequests) throw new Stop(`request budget of ${maxRequests} reached`, 4);
    const phys = physical(url);
    const gap = isLocal(phys) && process.env.PEWP_TEST_GAP_MS != null ? Number(process.env.PEWP_TEST_GAP_MS) : gapMs;
    const wait = (lastReal.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    let r;
    try { r = await cachedFetch(pewp, "authority", phys, { maxAgeDays, timeoutMs, init: { redirect: "manual", headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" } } }); }
    catch (e) { stats.requests++; lastReal.set(host, Date.now()); return { url, error: String(e.name === "TimeoutError" ? "timeout" : e.cause?.code || e.message || e).slice(0, 120) }; }
    if (r.fromCache) stats.cached++; else { stats.requests++; lastReal.set(host, Date.now()); }
    if (r.status === 429 || r.status === 403) { stopped.set(host, r.status); stats.stopped.push({ host, status: r.status, url }); return { url, status: r.status, stopped: true }; }
    return { url, status: r.status, headers: r.headers || {}, text: String(r.text || "").slice(0, 400000), fromCache: r.fromCache };
  }
  async function robotsFor(host, scheme = "https") {
    if (robotsCache.has(host)) return robotsCache.get(host);
    let cur = `${scheme}://${host}/robots.txt`, out = null;
    for (let i = 0; i < 3 && !out; i++) {
      const r = await request(cur);
      if (r.skipped) out = { skipped: r.skipped };
      else if (r.error) out = { error: r.error };
      else if (r.stopped) out = { stopped: r.status };
      else if (r.status >= 300 && r.status < 400 && r.headers?.location) cur = new URL(r.headers.location, cur).href;
      else if (r.status >= 200 && r.status < 300) out = { groups: parseRobots(r.text), status: r.status };
      else if (r.status >= 500) out = { error: `robots.txt answered ${r.status}; not read` };
      else out = { groups: [], status: r.status };
    }
    out ||= { groups: [], status: 0 };
    robotsCache.set(host, out);
    return out;
  }
  // One page, following up to 4 redirects, each hop checked against robots.txt, --exclude and the stop list.
  async function get(url) {
    const chain = []; let cur = url;
    for (let hop = 0; hop <= 4; hop++) {
      const x = new URL(cur), host = x.hostname.replace(/^www\./, "").toLowerCase();
      const rb = await robotsFor(host, x.protocol.replace(":", ""));
      if (rb.skipped) return { url: cur, chain, skipped: rb.skipped };
      if (rb.stopped) return { url: cur, chain, stopped: true, status: rb.stopped };
      if (rb.error) return { url: cur, chain, error: rb.error };
      if (!robotsAllows(rb.groups, x.pathname + x.search, ua)) return { url: cur, chain, skipped: "robots", robotsDisallowed: true };
      const r = await request(cur);
      if (r.skipped || r.error || r.stopped) return { ...r, chain };
      chain.push({ url: cur, status: r.status });
      if (r.status >= 300 && r.status < 400 && r.headers?.location) { try { cur = new URL(r.headers.location, cur).href; } catch { return { url: cur, chain, error: "bad redirect" }; } continue; }
      return { url, finalUrl: cur, status: r.status, text: r.text, headers: r.headers, fromCache: r.fromCache, chain };
    }
    return { url, chain, error: "more than 4 redirects" };
  }
  return { get, robotsFor, stats, stopped, physical, ua };
}

// ------------------------------------------------------------------------------------------------ vetting one domain
const SOCIAL_IGNORE = ["facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "youtube.com", "pinterest.com", "tiktok.com", "google.com", "gstatic.com", "w3.org", "schema.org", "apple.com", "wordpress.org", "wordpress.com"];
export async function vetDomain(domain, { client, typeDef, now = iso(), pack = null, checkProvider = false }) {
  const d = hostOf(domain);
  const rec = { domain: d, visitedAt: now, pages: [], robots: null, site: null, indexable: null, outbound: null, listing: null, spam: [], verdict: null, reasons: [], confidence: null };
  const home = await client.get(`https://${d}/`);
  rec.pages.push({ url: home.finalUrl || home.url, status: home.status ?? null, skipped: home.skipped || null, error: home.error || null, fromCache: !!home.fromCache });
  const finish = (verdict, reasons, confidence = "low") => { rec.verdict = verdict; rec.reasons = [...rec.reasons, ...reasons]; rec.confidence = confidence; return rec; };
  if (home.robotsDisallowed) { rec.robots = { allowed: false }; return finish("CHECK BY HAND", [{ code: "ROBOTS_DISALLOW", text: "the site's robots.txt asks robots not to read it, so we did not; open it in a browser and judge by eye" }]); }
  rec.robots = { allowed: true };
  if (home.stopped) return finish("CHECK BY HAND", [{ code: "HOST_REFUSED", text: `the site answered ${home.status} (refused or rate-limited), so we stopped and did not retry; open it in a browser` }]);
  if (home.skipped) return finish("CHECK BY HAND", [{ code: "NOT_VISITED", text: `not visited (${home.skipped})` }]);
  if (home.error) return finish("CHECK BY HAND", [{ code: "UNREACHABLE", text: `the site did not answer (${home.error}); it may be down or gone` }]);
  if (home.status >= 400) return finish("CHECK BY HAND", [{ code: "SITE_ERROR", text: `the home page answered ${home.status}; the site may be down or gone` }]);
  const finalHost = hostOf(home.finalUrl);
  const a = analyzeHtml(home.text, home.finalUrl, { ignoreHosts: SOCIAL_IGNORE });
  const xrobots = String(home.headers?.["x-robots-tag"] || "").toLowerCase();
  const noindex = a.noindexMeta || /\bnoindex\b|\bnone\b/.test(xrobots);
  rec.site = { title: a.title, description: a.description, h1: a.h1, words: a.words, finalUrl: home.finalUrl, redirectedTo: finalHost !== d && !sameBrand(finalHost, d) ? finalHost : null };
  rec.indexable = { homepage: !noindex, evidence: noindex ? (a.noindexMeta ? `meta robots "${a.robotsMeta}"` : `X-Robots-Tag "${xrobots}"`) : "no noindex in the page or the headers (robots.txt was checked; whether Google has indexed it is not tested)" };
  let text = a.text, links = a.links, outbound = a.outbound, candidates = listingCandidates(a.links, home.finalUrl);
  // One more read: the best listing / submit page on the same site (GET only; never a login, register or checkout path).
  const visitable = candidates.find((c) => c.visit && c.kind !== "paid") || candidates.find((c) => c.visit);
  let listingPage = null;
  if (visitable) {
    const lp = await client.get(visitable.url);
    rec.pages.push({ url: lp.finalUrl || lp.url, status: lp.status ?? null, skipped: lp.skipped || null, error: lp.error || null, fromCache: !!lp.fromCache, role: "listing page" });
    if (lp.status >= 200 && lp.status < 300 && lp.text) {
      listingPage = analyzeHtml(lp.text, lp.finalUrl, { ignoreHosts: SOCIAL_IGNORE });
      text = `${text} ${listingPage.text}`;
      const ext = [...a.links, ...listingPage.links];
      candidates = listingCandidates(ext, home.finalUrl);
      const n = outbound.external + listingPage.outbound.external, q = outbound.qualified + listingPage.outbound.qualified;
      outbound = { ...outbound, external: n, qualified: q, followed: n - q, label: n < 3 ? "too-few" : q / n >= 0.9 ? "nofollow" : q / n <= 0.1 ? "followed" : "mixed", pagesCounted: 2 };
    }
  }
  rec.outbound = outbound;
  const lm = listingModel(text);
  const best = candidates.find((c) => c.kind !== "paid") || candidates[0] || null;
  rec.listing = { model: lm.model, evidence: { free: lm.free, paid: lm.paid, editorial: lm.editorial }, submitUrl: best?.url || null, submitKind: best?.kind || null, candidates: candidates.map(({ kind, text, url }) => ({ kind, text, url })), pageRead: listingPage ? listingPage.url : null };
  rec.spam = spamSignals({ text, title: a.title, outbound, words: a.words, noindex, listing: lm });
  const prov = checkProvider ? providerByText([a.title, a.description, a.h1, a.text.slice(0, 1500)].filter(Boolean).join(" . "), pack) : null;
  if (prov) return finish("NOT AN OPPORTUNITY", [{ code: "PROVIDER_BUSINESS", text: `${prov.why}; a business that sells the same or a neighbouring service does not link to a competitor` }], "medium");
  const avoid = rec.spam.filter((s) => s.severity === "avoid"), warn = rec.spam.filter((s) => s.severity === "warn");
  const gives = typeDef?.gives || {};
  const pagesNote = listingPage ? "home page and listing page" : "home page only";
  const conf = listingPage ? "medium" : "low";
  if (avoid.length) return finish("AVOID", avoid.map(({ code, text }) => ({ code, text })), conf);
  if (rec.site.redirectedTo) return finish("CHECK BY HAND", [{ code: "REDIRECTS_ELSEWHERE", text: `the address redirects to ${rec.site.redirectedTo}, a different site; check who runs it now` }, ...warn.map(({ code, text }) => ({ code, text }))], conf);
  if (lm.model === "paid") return finish("CHECK BY HAND", [{ code: "PAID_LISTING", text: `the site shows prices or paid-placement wording ("${lm.paid.slice(0, 3).join('", "')}") and no free way in; read the page, decide with the client whether it is advertising, and if you pay, ask for rel="sponsored"` }, ...warn.map(({ code, text }) => ({ code, text }))], conf);
  if (warn.some((w) => w.code === "THIN")) return finish("CHECK BY HAND", warn.map(({ code, text }) => ({ code, text })), conf);
  if (lm.model === "unknown" && !best) return finish("CHECK BY HAND", [{ code: "NO_LISTING_PATH", text: `no visible way to get listed or pitch the site (read: ${pagesNote}); look for a contact or editor page` }, ...warn.map(({ code, text }) => ({ code, text }))], conf);
  if (outbound.label === "nofollow" && gives.followedLink !== "rare" && gives.followedLink !== undefined) return finish("CHECK BY HAND", [{ code: "NOFOLLOW_ONLY", text: "every link out of the site is marked nofollow, sponsored or ugc, so it passes no ranking credit; worth it only for the mention and the visitors" }, ...warn.map(({ code, text }) => ({ code, text }))], conf);
  if (outbound.label === "nofollow" && gives.followedLink === undefined) return finish("CHECK BY HAND", [{ code: "NOFOLLOW_ONLY", text: "every link out of the site is marked nofollow, sponsored or ugc; the kind of site is not known, so decide by hand" }, ...warn.map(({ code, text }) => ({ code, text }))], conf);
  // PURSUE needs a known kind of site: a page that merely offers a free listing, of a kind no rule recognised, is for a person to judge.
  if (typeDef?.value == null) return finish("CHECK BY HAND", [{ code: "KIND_UNKNOWN", text: "nothing says what kind of site this is (unclassified); it passed the checks on the pages read, so open it and decide whether it is a place the client's customers or peers use" }, ...warn.map(({ code, text }) => ({ code, text }))], conf);
  const good = [{ code: "REACHABLE_INDEXABLE", text: `reachable, robots.txt allows it, no noindex (read: ${pagesNote})` }, { code: `LISTING_${lm.model.toUpperCase()}`, text: lm.model === "free" ? `looks free to get on ("${lm.free[0]}")` : lm.model === "editorial" ? `looks editorial: you earn it by pitching ("${lm.editorial[0]}")` : lm.model === "mixed" ? "has a free way in and paid upgrades; use the free one" : "a way to get on was found" }];
  if (outbound.label === "nofollow") good.push({ code: "NOFOLLOW_OK", text: "its links are nofollow, which is normal for this kind of site; the value is the mention and the visitors" });
  return finish("PURSUE", [...good, ...warn.map(({ code, text }) => ({ code, text }))], conf);
}

// ------------------------------------------------------------------------------------------------ opportunities
// Rule 1: an AI-cited source counts only when the question belongs to the client's own business: it matches a cluster of targets.json
// (queryOverlap >= 0.6 with a cluster query; clusters marked record-only are not the client's) or shares a non-generic, non-place word with the business (offer, industry, pack aliases).
// Without targets.json and without an offer nothing can be judged: every row is kept and the mode says so.
const GENERIC_WORDS = new Set(["buy", "sell", "help", "people", "best", "new", "near", "good", "top"]);
export function aiCitedFor(ai, { targets = null, business = {}, own = "", vocab = [] } = {}) {
  if (!ai) return { citedInstead: [], filter: { mode: "no ai-citations.json", rows: 0, kept: 0, dropped: 0 } };
  if (!Array.isArray(ai.rows) || !ai.rows.length) return { citedInstead: ai.citedInstead || [], filter: { mode: "unfiltered: ai-citations.json has no per-question rows", rows: 0, kept: 0, dropped: 0 } };
  const clusters = (targets?.clusters || []).filter((c) => !String(c.primaryQuery || "").startsWith("["));
  const texts = clusters.flatMap((c) => [c.primaryQuery, ...(c.queries || [])]).filter(Boolean);
  const places = new Set(tokens([...(business.locations || []).flatMap((l) => [l.name, ...(l.serviceArea || [])]), "ca"].join(" ")));
  const offerT = new Set(tokens([business.offer, business.industry, business.kind, ...vocab].filter(Boolean).join(" ")).filter((t) => !places.has(t) && !GENERIC_WORDS.has(t)));
  const mode = texts.length ? (offerT.size ? "clusters of targets.json or the offer in business.json" : "clusters of targets.json") : offerT.size ? "the offer in business.json (no targets.json)" : null;
  const belongs = (q) => {
    if (!mode) return true;
    if (texts.some((t) => queryOverlap(q, t) >= 0.6)) return true;
    return tokens(q).filter((t) => !places.has(t) && offerT.has(t)).length >= 1;
  };
  const counts = new Map(); let kept = 0; const droppedQ = new Set();
  for (const row of ai.rows) {
    if (!belongs(row.question)) { droppedQ.add(row.question); continue; }
    kept++;
    for (const d of new Set(row.citedSources || [])) if (hostOf(d) !== hostOf(own)) counts.set(d, (counts.get(d) || 0) + 1);
  }
  return { citedInstead: [...counts].sort((a, b) => b[1] - a[1]).map(([domain, answers]) => ({ domain, answers })), filter: { mode: mode ? "filtered by " + mode : "unfiltered: no targets.json and no offer to judge questions by", rows: ai.rows.length, kept, dropped: ai.rows.length - kept, droppedQuestions: [...droppedQ].slice(0, 8) } };
}
const brokerageMatches = (business, pe) => { const b = String(business?.credentials?.brokerage || "").toLowerCase(); return !!b && (pe.brokerageNames || []).some((n) => b.includes(n)); };
const TIER_RANK = { gap: 0, ai: 1, competitor: 2, serp: 3, partner: 4, baseline: 5 };
export const scoreOf = (def) => (def && def.value != null && def.effort != null ? def.value * (6 - def.effort) : 0);
export function buildOpportunities({ authority, citations = null, aiCitations = null, business = {}, rules, pickedPack, fetched = {}, target }) {
  const pack = mergedPack(rules, pickedPack.pack);
  const targetDomain = hostOf(target || authority?.target || business.domain || "");
  const results = authority?.results || [];
  const comps = results.filter((r) => r.role === "competitor");
  const compDomains = [...new Set([...comps.map((r) => hostOf(r.domain)), ...(business.competitors || []).map(hostOf)])];
  const me = results.find((r) => r.role === "target" || hostOf(r.domain) === targetDomain);
  const ours = new Set((me?.strongestLinkingDomains || []).map((l) => hostOf(l.domain)));
  const ctx = { rules, pack, target: targetDomain, competitors: compDomains };
  const by = new Map();
  const rec = (d) => { if (!by.has(d)) by.set(d, { domain: d, competitors: new Set(), harmonicPos: null, evidence: [], sources: new Set(), serp: null, ai: 0, packEntry: null }); return by.get(d); };
  for (const c of comps) {
    if (!c.inGraph) continue;
    for (const l of c.strongestLinkingDomains || []) {
      const d = hostOf(l.domain); if (!d || d === targetDomain) continue;
      const r = rec(d); r.competitors.add(hostOf(c.domain)); r.sources.add("authority.json");
      if (l.harmonicPos != null) r.harmonicPos = r.harmonicPos == null ? l.harmonicPos : Math.min(r.harmonicPos, l.harmonicPos);
    }
  }
  for (const g of authority?.linkGap || []) { // the graph's own gap list also covers domains cut from the top-N lists
    const d = hostOf(g.domain); if (ours.has(d)) continue;
    const r = rec(d); r.sources.add("authority.json linkGap");
    if (r.competitors.size < g.linksToCompetitors) r.gapCount = g.linksToCompetitors;
    if (g.harmonicPos != null && r.harmonicPos == null) r.harmonicPos = g.harmonicPos;
  }
  for (const s of citations?.sources || []) {
    const d = hostOf(s.domain); if (!d || d === targetDomain) continue;
    const r = rec(d); r.serp = s; r.sources.add("research/citations.json");
  }
  for (const x of aiCitations?.citedInstead || []) { // domains the AI engines cited for our questions instead of the business
    const d = hostOf(x.domain); if (!d || d === targetDomain) continue;
    const r = rec(d); r.ai = x.answers || 1; r.sources.add("research/ai-citations.json");
  }
  for (const e of pack.domainTypes) if (e.baseline) { const d = hostOf(e.host); if (d !== targetDomain) { const r = rec(d); r.packEntry = e; r.sources.add(`pack ${e.pack}`); } }
  const open = [], alreadyHave = [], notActionable = [], unclassifiedSide = [];
  for (const [d, r] of by) {
    let cls = classifyDomain(d, ctx), fetchedInfo = fetched[d] || null;
    if (cls.type === "unclassified" && fetchedInfo?.title !== undefined) {
      const txt = [fetchedInfo.title, fetchedInfo.description, fetchedInfo.h1].filter(Boolean).join(" . ");
      const t = providerByText(txt, pack) || classifyText(txt, rules);
      if (t) cls = { ...t, note: null };
    }
    const def = rules.tax.types[cls.type];
    const pe = r.packEntry || pack.domainTypes.find((e) => hostIs(d, e.host)) || null;
    const n = Math.max(r.competitors.size, r.gapCount || 0);
    const tier = n >= 2 ? "gap" : r.ai ? "ai" : n === 1 ? "competitor" : r.serp ? "serp" : "baseline";
    const ev = [];
    if (r.competitors.size) ev.push(`links to ${[...r.competitors].join(", ")} (Common Crawl ${authority?.release || "web graph"}, domain level)`);
    else if (r.gapCount) ev.push(`the link graph lists it as linking to ${r.gapCount} competitors (in the link gap)`);
    if (r.ai) ev.push(`cited by AI engines in ${r.ai} captured answer(s) to our questions where the business was not (research/ai-citations.json)`);
    if (r.serp) ev.push(`research/citations.json: in ${r.serp.searches} captured searches, best position ${r.serp.bestPosition ?? "-"}; ${r.serp.why}`);
    if (r.packEntry && !r.competitors.size) ev.push(`industry pack ${r.packEntry.pack} (recalled, UNVERIFIED): ${r.packEntry.note || "usual place for this kind of business"}`);
    const base = { domain: d, type: cls.type, typeLabel: def.label, confidence: cls.confidence, ruleId: cls.ruleId, why: cls.why, classifiedFrom: fetchedInfo && /textRules|providerText/.test(cls.source || "") ? "home page title/description (read-only visit)" : "domain name", tier, aiAnswers: r.ai, linksToCompetitors: n, competitors: [...r.competitors], harmonicPos: r.harmonicPos, inLinkGap: n >= 2, value: def.value, effort: def.effort, cost: pe?.cost || def.cost, risk: def.risk, gives: def.gives, score: scoreOf(def), evidence: ev, sources: [...r.sources], fetched: fetchedInfo, nextStep: def.howTo?.[0] || null, packNote: cls.note || pe?.note || null };
    if (ours.has(d)) { alreadyHave.push({ ...base, reason: "already links to the business (Common Crawl)" }); continue; }
    if (r.serp?.status === "listed") { alreadyHave.push({ ...base, reason: `already listed: ${r.serp.statusEvidence}` }); continue; }
    if (!def.actionable) { notActionable.push({ ...base, reason: def.what }); continue; }
    if (pe?.onlyIf === "brokerage" && !brokerageMatches(business, pe)) { notActionable.push({ ...base, reason: `another brokerage's roster: it matters only if ${d} is the client's own brokerage (business.json credentials.brokerage is ${business.credentials?.brokerage ? `"${business.credentials.brokerage}"` : "not set"})` }); continue; }
    // Rule 3: only kinds of site that link out are opportunities. An unclassified domain with no link evidence from a competitor is not one until it is classified.
    if (cls.type === "unclassified" && (tier === "ai" || tier === "serp" || tier === "baseline")) { unclassifiedSide.push({ ...base, reason: "no rule says what kind of site this is and no competitor links from it: read its home page (--fetch) or open it before it counts" }); continue; }
    // A partner type the pack names, found only through AI answers or searches, is a weak lead: ranked below the directories.
    if (cls.type === "partner-supplier" && (tier === "ai" || tier === "serp")) base.tier = "partner";
    open.push(base);
  }
  const cmp = (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.score - a.score || b.aiAnswers - a.aiAnswers || b.linksToCompetitors - a.linksToCompetitors || (a.harmonicPos ?? 9e15) - (b.harmonicPos ?? 9e15) || a.domain.localeCompare(b.domain);
  open.sort(cmp).forEach((o, i) => { o.rank = i + 1; });
  const ourTypes = new Set([...ours].map((d) => classifyDomain(d, ctx).type));
  const byType = {}, compByType = {};
  for (const o of open) byType[o.type] = (byType[o.type] || 0) + 1;
  for (const o of [...open, ...alreadyHave, ...notActionable]) if (o.competitors.length) compByType[o.type] = (compByType[o.type] || 0) + 1;
  const lack = Object.keys(compByType).filter((t) => t !== "unclassified" && rules.tax.types[t].actionable && !ourTypes.has(t));
  const notes = [];
  for (const c of comps) if (c.inGraph && (c.strongestLinkingDomains || []).length < c.linkingDomains) notes.push(`${c.domain}: ${c.linkingDomains} linking domains in the graph, only the strongest ${(c.strongestLinkingDomains || []).length} are in authority.json, so some linkers are not classified here (re-run authority.mjs with a larger --top)`);
  for (const c of comps) if (!c.inGraph) notes.push(`${c.domain} is not in the Common Crawl release (${c.note || "too few links"}); its links are not counted`);
  if (!me?.inGraph) notes.push(`${targetDomain} itself is not in this release or not listed: "already links to you" cannot be judged`);
  return { pack, targetDomain, open, alreadyHave, notActionable, unclassified: unclassifiedSide, summary: { open: open.length, gap: open.filter((o) => o.tier === "gap").length, competitor: open.filter((o) => o.tier === "competitor").length, ai: open.filter((o) => o.tier === "ai").length, serp: open.filter((o) => o.tier === "serp").length, baseline: open.filter((o) => o.tier === "baseline").length, alreadyHave: alreadyHave.length, notActionable: notActionable.length, unclassified: open.filter((o) => o.type === "unclassified").length + unclassifiedSide.length, providers: notActionable.filter((o) => o.type === "provider-business").length, partnerLow: open.filter((o) => o.tier === "partner").length, byType, competitorLinksByType: compByType, typesCompetitorsHaveAndWeLack: lack }, notes };
}

export function opportunitiesMd(doc, rules) {
  const T = (t) => rules.tax.types[t]?.label || t;
  const L = [`# Where to earn links, mentions and citations: ${doc.business?.name || doc.target}`, "",
    `Written ${doc.generatedAt.slice(0, 10)} from the link data in \`authority.json\`${doc.inputs.citations ? " and the directory candidates in \`research/citations.json\`" : ""}${doc.inputs.aiCitations ? ", the sources AI engines cited in \`research/ai-citations.json\`" : ""}, the industry pack **${doc.pack.slug}**${doc.pack.via === "fallback" ? " (fallback: " + (doc.pack.note || "") + ")" : ""}, and the kind-of-site rules in \`rules/link-sources/\`.`, "",
    "How to read it: the list is ordered. First come sites that link to **two or more competitors but not to us** (the link gap); then sites the AI engines cited instead of us in the answers we captured; then sites that link to one competitor; then directories that fill the search results we captured; then partner types the industry pack names (lender, stager, inspector ...) that only AI answers or searches pointed at; then the usual places for this kind of business that no competitor data pointed at. Only kinds of site that link out are listed: a business that sells what the client sells (another agent, a cash buyer, a brokerage that is not the client's own) never links to a competitor, so it is set aside under *Not available or not wanted*. Inside each group the order is kind-of-site value times how easy it is to get on. A kind we could not tell is called *unclassified*: never guessed; it counts as an opportunity only if a competitor links from it.", "",
    `**${doc.summary.open}** open opportunities (${doc.summary.gap} in the link gap, ${doc.summary.ai} cited by AI engines instead of us, ${doc.summary.competitor} link to one competitor, ${doc.summary.serp} from search results, ${doc.summary.partnerLow} partner types, ${doc.summary.baseline} usual places); ${doc.summary.alreadyHave} already ours; ${doc.summary.notActionable} not available or not wanted (${doc.summary.providers} competing or unrelated businesses); ${doc.summary.unclassified} unclassified.`, ""];
  if (doc.aiFilter) L.push(`AI answers counted: ${doc.aiFilter.kept} of ${doc.aiFilter.rows} (${doc.aiFilter.mode}); ${doc.aiFilter.dropped} answers to questions that are not about this business were left out.`, "");
  if (doc.summary.typesCompetitorsHaveAndWeLack.length) L.push(`Kinds of site that link to competitors and not to us at all: ${doc.summary.typesCompetitorsHaveAndWeLack.map(T).join(", ")}.`, "");
  L.push("| # | Site | Kind | Why it is here | Effort (1 easy to 5 hard) | Cost | Risk |", "|---|---|---|---|---|---|---|");
  for (const o of doc.opportunities.slice(0, 40)) L.push(`| ${o.rank} | ${o.domain} | ${o.typeLabel}${o.confidence ? ` (${o.confidence} certainty)` : ""} | ${o.evidence[0] || o.why} | ${o.effort ?? "?"} | ${o.cost} | ${o.risk} |`);
  if (doc.opportunities.length > 40) L.push("", `(${doc.opportunities.length - 40} more in \`opportunities.json\`.)`);
  if (doc.alreadyHave.length) L.push("", "## Already ours", "", ...doc.alreadyHave.map((o) => `- ${o.domain}: ${o.reason}`));
  if (doc.notActionable.length) L.push("", "## Not available or not wanted", "", ...doc.notActionable.map((o) => `- ${o.domain} (${o.typeLabel}): ${o.type === "provider-business" || o.type === "spam-suspect" ? o.why : o.reason}`));
  const un = [...doc.opportunities.filter((o) => o.type === "unclassified"), ...(doc.unclassified || [])];
  if (un.length) L.push("", "## Unclassified (open each one, or re-run with --fetch; those without a competitor link are not opportunities until classified)", "", ...un.map((o) => `- ${o.domain}: ${o.evidence[0] || ""}${o.fetched?.title ? `; its home page is titled "${o.fetched.title}"` : ""}`));
  if (doc.notes.length) L.push("", "## Limits of this list", "", ...doc.notes.map((n) => `- ${n}`));
  L.push("", "Common Crawl sees distinct linking domains in one quarterly release, not every link on the web: compare sites with each other, not as absolute numbers. Industry-pack hosts are recalled, not re-fetched (UNVERIFIED): the vetting step (`authority-vet.mjs`) is what checks a site before anyone spends time on it.");
  return L.join("\n") + "\n";
}

// ------------------------------------------------------------------------------------------------ the how-to for the client
export function howtoMd({ business = {}, vetting, opportunities = [], rules }) {
  const byDomain = new Map(opportunities.map((o) => [o.domain, o]));
  const R = vetting.results.filter((r) => r.verdict);
  const group = (v) => R.filter((r) => r.verdict === v);
  const nap = [business.name ? `Name: ${business.legalName || business.name}` : null, business.locations?.[0]?.address ? `Address: ${typeof business.locations[0].address === "string" ? business.locations[0].address : Object.values(business.locations[0].address).filter(Boolean).join(", ")}` : null, business.phone ? `Phone: ${business.phone}` : null, business.domain ? `Website: https://${business.domain}/` : null].filter(Boolean);
  const L = [`# How to get listed: ${business.name || "the business"}`, "",
    `Checked ${vetting.generatedAt.slice(0, 10)}. Each site below was opened once, read-only, the way a visitor would (nothing was submitted, nobody logged in). "Pursue" means it looks worth the time; "check by hand" means a person should look before spending time or money; "avoid" means do not go there.`, "",
    "Use exactly these details on every listing, character for character (search engines and AI tools trust a business more when every place agrees):", "", ...(nap.length ? nap.map((x) => "- " + x) : ["- (fill in the business name, address, phone and website from the Business Profile first)"]), "",
    "Three rules for everything below: never pay for a link unless the page marks it as sponsored (rel=\"sponsored\"); never write reviews for the business or pay for them; tell the owner of the tracker (`authority-outreach.mjs`) each time something is asked, listed or refused, with the page address as proof.", ""];
  const entry = (r) => {
    const o = byDomain.get(r.domain), def = rules.tax.types[o?.type] || rules.tax.types.unclassified;
    const site = r.site?.title ? `"${r.site.title}"` : r.domain;
    const steps = [];
    if (r.listing?.submitUrl) steps.push(`Open ${r.listing.submitUrl}${r.listing.submitKind === "editorial" ? " (the page for writers and pitches)" : ""}.`);
    else steps.push(`Open https://${r.domain}/ and look for a "contact", "add your business" or "advertise" link.`);
    for (const s of (def.howTo || []).slice(r.listing?.submitUrl ? 1 : 0, 4)) steps.push(s);
    steps.push("Write down in the tracker what you did and the date. When it is live, paste the page address as proof.");
    const linkNote = r.outbound?.label === "nofollow" ? "The link on this site is one Google is told not to count for ranking. It still helps: it is a mention search and AI tools can read, and people click it." : r.outbound?.label === "followed" ? "The links on this site are normal links that can pass ranking credit." : r.outbound?.label === "mixed" ? "Some links on this site count for ranking and some do not." : "We could not see enough links on the pages we read to say whether its links count for ranking.";
    const cost = r.listing?.model === "free" ? "looks free" : r.listing?.model === "paid" ? "looks paid" : r.listing?.model === "mixed" ? "free way in plus paid upgrades" : r.listing?.model === "editorial" ? "earned by pitching, not bought" : "not clear";
    return [`### ${r.domain} - ${site}`, "", `- What it is: ${o?.typeLabel || "not classified"}${o?.evidence?.[0] ? `; ${o.evidence[0]}` : ""}.`, `- Cost: ${cost}. ${linkNote}`, `- Why this verdict: ${r.reasons.map((x) => x.text).join("; ")}.`, "", ...steps.map((s, i) => `${i + 1}. ${s}`), ""];
  };
  L.push("## Pursue", "", ...(group("PURSUE").length ? group("PURSUE").flatMap(entry) : ["None of the sites checked passed all the checks.", ""]));
  L.push("## Check by hand first", "", ...(group("CHECK BY HAND").length ? group("CHECK BY HAND").flatMap(entry) : ["None.", ""]));
  const np = group("NOT AN OPPORTUNITY");
  if (np.length) L.push("## Not an opportunity", "", "These are businesses that sell what the client sells, or something next to it. They will not link to a competitor, so there is nothing to ask them for.", "", ...np.map((r) => `- ${r.domain}: ${r.reasons.map((x) => x.text).join("; ")}.`), "");
  L.push("## Avoid", "", ...(group("AVOID").length ? group("AVOID").flatMap((r) => [`- ${r.domain}: ${r.reasons.map((x) => x.text).join("; ")}.`]) : ["None."]), "");
  const nv = vetting.results.filter((r) => !r.verdict);
  if (nv.length) L.push("## Not visited", "", ...nv.map((r) => `- ${r.domain}: ${r.notVisited || "stopped before this site"}`), "");
  L.push("## Limits", "", "Each site was read at one moment: home page, plus the page about getting listed when we found one. Whether a link counts, whether a listing is free and whether Google has indexed the site can change; the tracker is where the real result is recorded.", `Read-only visits used the user agent "${vetting.ua}", obeyed robots.txt, waited ${vetting.options.gapMs / 1000} s between requests to the same site and stopped at any 403 or 429.`);
  return L.join("\n") + "\n";
}
