// SERP-winner page audit: what do the pages that already rank for a cluster's query look like? For each priority cluster, take the
// top-ranking URLs from the saved captures and read each page like a crawler (raw HTML): words, headings, schema, FAQ. From them:
//   requiredEntities  the heading terms that recur across the winners (not the query's own words)
//   winningFormat     the page type most winners are (tool, guide, city landing page, listing page, directory or profile page)
//   wordRange         a SOURCED [min, max] of visible words (p25-p75 of 4+ pages, else min-max), an estimate
// Usage: node research-winners.mjs <target> [--from-serp] [--max-pages 20] [--per-cluster 3] [--top-clusters 10] [--cwd DIR]
// Fetching third-party pages needs --from-serp (they are listed in the plan first). Polite: robots.txt first, cached, one attempt per URL, a host
// stops at its first 403/429/503 or bot check, never a Google/Bing host, hard page budget (--max-pages). A capture that holds only domains (the
// old text captures) is served from the competitor audits already cached (research/competitors.json, imported audits): no request at all.
// Output: research/winners.json { clusters:[{clusterId, head, basis, pages, entities, format, wordRange}] }.
import path from "node:path";
import { Blocked, iso, context, needBusiness, runCli, readStep, writeStep, writeBlocked, fact, tokens, pathOf, classifyIntent, allPlaces, localeOf } from "./research-lib.mjs";
import { auditUrl } from "./research-competitors.mjs";
import { requiredTerms } from "./lib-text.mjs";
import { pageTypeOf } from "./lib-growth.mjs";

const SEARCH_HOST = /(^|\.)(google|bing|duckduckgo|yahoo)\.[a-z.]+$/i;
const GENERIC = new Set("home house homes real estate agent realtor service services company best top near sell buy cash free quote contact about page our your what how why guide find".split(" "));
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
const round50 = (n) => (n < 100 ? Math.round(n) : Math.round(n / 50) * 50);

// the page type of one audited page, from its address, headings, schema and length
export function formatOfPage(p) {
  const path_ = (p.url ? pathOf(p.url) : p.path) || "", t = `${p.title || ""} ${p.h1 || ""}`.toLowerCase();
  const types = (p.schemaTypes || []).join(" ");
  if (/calculator|estimator|net-?sheet|\/tools?\b|quiz/.test(path_) || /\b(calculator|estimator)\b/.test(t)) return "tool";
  if (/\/(blog|news|articles?|guides?|learn|resources)\b|\/(how|what|why|when|can|is|are)-/.test(path_) || /^(how|what|why|when|can|is|are)\b/.test(t.trim())) return "guide";
  if (/for-sale|homes-for-sale|listings?|\/properties/.test(path_)) return "listing page";
  if (/\/(agents?|professionals|directory|reviews)\b|\bbest-|\btop-\d/.test(path_) || /\b(top \d+|best .* in|directory|reviews of)\b/.test(t)) return "directory or profile page";
  if (path_ === "/" || path_ === "") return "home page";
  if (/LocalBusiness|RealEstate|ProfessionalService/.test(types) || /-(in|near)-|\/(ca|areas?)\//.test(path_)) return "city landing page";
  return (p.mainWords ?? p.words) > 1500 && (p.h2 || []).length >= 6 ? "guide" : "service or city landing page";
}

// entities, format and word range from a set of audited pages (needs >= 2 pages for "recurring")
// CHANGED 2026-10-22 (shipgate 06 section 9.5): requiredTerms = the 1- to 3-word terms of the headings, list items and <strong> text that appear on >= 2 of the
// winning pages (lib-text.mjs requiredTerms; stop words removed, not stemmed), pageType = the most common 9.3 page type of the winners. "entities" is the older
// shorter list (single stemmed heading words on half the pages, at most 8) that the plan briefs and GT-005 still use; requiredTerms is the spec list.
export function deriveFromPages(pages, query, { locale = "en-US" } = {}) {
  const ok = pages.filter((p) => p && !p.error && ((p.mainWords ?? p.words) > 0 || (p.h2 || []).length));
  if (!ok.length) return { entities: [], requiredTerms: [], pageType: null, format: null, wordRange: null, n: 0 };
  const top3 = ok.slice(0, 3);
  const terms = requiredTerms(top3.map((p) => ({ headings: [p.h1, ...(p.h2 || []), ...(p.h3 || [])].filter(Boolean), listItems: p.li || [], strong: p.strong || [] })), { locale });
  const pt = new Map(); for (const p of top3) { const t = pageTypeOf({ schemaTypes: p.schemaTypes || [], path: p.path || (p.url ? pathOf(p.url) : "/"), host: p.domain || "" }); pt.set(t, (pt.get(t) || 0) + 1); }
  const pageType = [...pt].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const qt = new Set(tokens(query)), count = new Map(), surface = new Map(); // surface: stem -> the word as written most often
  for (const p of ok) {
    const seen = new Set();
    for (const h of [p.title, p.h1, ...(p.h2 || []), ...(p.h3 || [])].filter(Boolean)) for (const w of String(h).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []) { const t = tokens(w)[0]; if (!t || t.length < 3 || qt.has(t) || GENERIC.has(t) || GENERIC.has(w)) continue; seen.add(t); const m = surface.get(t) || new Map(); m.set(w, (m.get(w) || 0) + 1); surface.set(t, m); }
    for (const t of seen) count.set(t, (count.get(t) || 0) + 1);
  }
  const show = (t) => [...surface.get(t)].sort((a, b) => b[1] - a[1])[0][0];
  const need = Math.max(2, Math.ceil(ok.length / 2));
  const entities = ok.length < 2 ? [] : [...count].filter(([, n]) => n >= need).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([t]) => show(t));
  const fm = new Map(); for (const p of ok) { const f = formatOfPage(p); fm.set(f, (fm.get(f) || 0) + 1); }
  const format = [...fm].sort((a, b) => b[1] - a[1])[0][0];
  const w = ok.map((p) => p.mainWords ?? p.words).filter((n) => n > 0).sort((a, b) => a - b);
  const range = !w.length ? null : w.length >= 4 ? [round50(pct(w, 0.25)), round50(pct(w, 0.75))] : [round50(w[0]), round50(w.at(-1))];
  return { entities, requiredTerms: terms, pageType, format, wordRange: range && range[0] <= range[1] ? range : range && [range[1], range[0]], n: ok.length, basisNote: w.length >= 4 ? "p25 to p75" : "min to max" };
}

// A competitor audit (research-competitors.mjs) as pseudo pages: the sample page of the kind that fits the intent, else the home page.
export function fromCachedAudits(audits, intent) {
  const order = /local|transactional/.test(intent) ? ["city", "service", "situation"] : intent === "informational" ? ["blog"] : ["service", "city", "blog"];
  return audits.filter((a) => a && a.page && !a.error).map((a) => {
    const s = order.map((k) => (a.samples || []).find((x) => x.kind === k && x.status === 200 && (x.mainWords ?? x.words) > 0)).find(Boolean);
    return s ? { via: `cached competitor audit, ${s.kind} sample page`, domain: a.domain, path: s.path, title: s.title, h1: s.h1, h2: Array.isArray(s.h2) ? s.h2 : [], words: s.words, mainWords: s.mainWords, schemaTypes: s.schema || [], fetchedAt: a.fetchedAt }
      : { via: "cached competitor audit, home page", domain: a.domain, path: "/", title: a.page.title, h1: a.page.h1?.[0], h2: a.page.h2 || [], words: a.page.words, mainWords: a.page.mainWords, schemaTypes: a.schema?.types || [], fetchedAt: a.fetchedAt };
  });
}

function candidates(ctx, { perCluster, topClusters }) {
  const cl = readStep(ctx, "clusters"), serp = readStep(ctx, "serp"), own = ctx.business.domain;
  if (cl?.status !== "ok" || serp?.status !== "ok") return null;
  return cl.clusters.slice(0, topClusters).map((c) => {
    const cap = serp.captures.find((x) => x.file === c.captureOfHead?.file) || null;
    const others = (cap?.organic || []).filter((o) => o.domain !== own && !o.domain.endsWith("." + own) && !SEARCH_HOST.test(o.domain));
    return { cluster: c, cap, urls: others.filter((o) => /^https?:\/\//.test(o.url || "")).slice(0, perCluster).map((o) => ({ url: o.url, position: o.position })), domains: others.slice(0, 5).map((o) => o.domain) };
  });
}
export function plannedWinnerUrls(ctx, { perCluster = 3, topClusters = 10, maxPages = 20 } = {}) {
  const c = candidates(ctx, { perCluster, topClusters });
  return c ? [...new Set(c.flatMap((x) => x.urls.map((u) => u.url)))].slice(0, maxPages) : null;
}

export async function run(ctx, { fromSerp = false, maxPages = 20, perCluster = 3, topClusters = 10 } = {}) {
  needBusiness(ctx);
  const cands = candidates(ctx, { perCluster, topClusters });
  if (!cands) { const m = "needs research/clusters.json and research/serp.json (import the SERP captures and cluster first)"; writeBlocked(ctx, "winners", m); throw new Blocked(m); }
  const audits = new Map();
  for (const a of Object.values(readStep(ctx, "existing")?.competitorAudits || {})) audits.set(a.domain, a);
  for (const a of readStep(ctx, "competitors")?.sites || []) if (a.page) audits.set(a.domain, a); // this run's audits win over imported ones
  const places = allPlaces(ctx, (n) => readStep(ctx, n)), done = new Map();
  let fetched = 0, budgetStopped = false;
  const out = [];
  for (const { cluster, cap, urls, domains } of cands) {
    if (!cap) { out.push({ clusterId: cluster.id, head: cluster.head, basis: "no capture of this query", pages: [], entities: [], requiredTerms: [], pageType: null, format: null, wordRange: null }); continue; }
    let pages = [], basis;
    if (urls.length && fromSerp) {
      basis = "audit of the top-ranking pages in the capture (raw HTML)";
      for (const u of urls) {
        if (!done.has(u.url)) { if (fetched >= maxPages) { budgetStopped = true; continue; } fetched++; done.set(u.url, await auditUrl(ctx.pewp, u.url)); }
        pages.push({ ...done.get(u.url), position: u.position });
      }
    } else if (urls.length) basis = `not fetched: pass --from-serp to audit ${urls.length} top-ranking page(s)`;
    if (!pages.some((p) => !p.error)) { // nothing fetched (domains only, no flag, or all refused): the audits already cached
      const cached = fromCachedAudits(domains.map((d) => audits.get(d)).filter(Boolean), classifyIntent(cluster.head, { places }));
      if (cached.length) { pages = [...pages, ...cached]; basis = urls.length && fromSerp ? "top pages refused or unreadable; competitor audits already cached" : "competitor audits already cached (the capture holds domains, not page addresses)"; }
      else basis = basis || "no page addresses in the capture and no cached audit of its winners";
    }
    const d = deriveFromPages(pages, cluster.head, { locale: localeOf(ctx.market) });
    const good = pages.filter((p) => !p.error), when = good.map((p) => p.fetchedAt).filter(Boolean).sort().at(-1) || iso();
    const wordRange = d.wordRange ? fact(d.wordRange, `${good.length} winning page(s) for "${cluster.head}": visible words in the raw HTML, ${d.basisNote} (${good.some((p) => p.via) ? "from cached competitor audits" : "audited from the capture"})`, when, good[0]?.cacheFiles?.[0] || (good[0]?.via ? path.join(ctx.rdir, "competitors.json") : null), { estimate: true, location: cap.locationLabel, device: cap.device }) : null;
    out.push({ clusterId: cluster.id, head: cluster.head, basis, pages: pages.map((p) => ({ ...p })), entities: d.entities, requiredTerms: d.requiredTerms, pageType: d.pageType, format: d.format, wordRange });
  }
  return writeStep(ctx, "winners", { fromSerp, maxPages, perCluster, topClusters, pagesFetched: fetched, budgetStopped, blockedHosts: [...new Set(out.flatMap((c) => c.pages).filter((p) => /^BLOCKED/.test(p.error || "")).map((p) => p.domain))], clusters: out });
}

await runCli(import.meta.url, "node research-winners.mjs <target> [--from-serp] [--max-pages 20] [--per-cluster 3] [--top-clusters 10] [--cwd DIR]", ["from-serp"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { fromSerp: a.has("from-serp"), maxPages: a.num("max-pages", 20), perCluster: a.num("per-cluster", 3), topClusters: a.num("top-clusters", 10) });
  return `OK winners: ${r.pagesFetched} pages fetched${r.budgetStopped ? " (page budget reached)" : ""}; ${r.clusters.filter((c) => c.wordRange).length} of ${r.clusters.length} clusters have a word range, ${r.clusters.filter((c) => c.entities.length).length} have entities -> ${path.join(ctx.rdir, "winners.json")}`;
});
