// The growth algorithms of shipgate spec 06-growth.md section 9, as pure functions (no network, no files except the rulesets):
//   9.1 clusters      clusterByOverlap()   union-find over top-10 URL overlap
//   9.2 intent        intentOf()           ordered rules, first match wins
//   9.3 page type     pageTypeOf()         from schema types, path and host; pageTypeOfPage() for a built page
//   9.7 page-cluster  matchPages()         head term in title or h1 + intent-compatible page type
//   03 section 22.2   compatibleTypes()    the intent -> page type table
// 9.5 terms live in lib-text.mjs (termsOf, requiredTerms, coversTerm) next to the head-term rule they share words with.
import { uaxWords, headTerm, containsHeadTerm, gazetteer, scanPlaces, stemmerFor, LocaleMissing } from "./lib-text.mjs";
import { loadRule, localeEntry } from "./lib-rules.mjs";

export { LocaleMissing };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // code-point order (UTF-16 order differs only for astral characters; fine for queries)
const hostOf = (u) => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const pathOf = (u) => { try { return new URL(u).pathname || "/"; } catch { return String(u || "/"); } };
// 04 section 10 URL normalisation, as far as it matters for equality of two results: host without www, no fragment or query, no trailing slash.
export const normResultUrl = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase(); } catch { return String(u).toLowerCase(); } };

// ---------------------------------------------------------------- 9.1 clusters
// rows: [{ query, volume: number|null, difficulty: number|null, top10: [url] | null }]  (top10 null/absent = no SERP data for that query)
// opts: { overlap (growth.research.clusterOverlap, default 4), headOf(query) -> string key of the head term }
// Returns [{ primary, members: [{ query, volume, difficulty, serp, via }], serp }] ordered by the primary's rank (descending volume, then code point).
//   via: "primary" | "serp-overlap" | "head-term" (no SERP, joined the captured query with the same head term) | "alone"
export function clusterByOverlap(rows, { overlap = 4, headOf }) {
  const vol = (r) => (typeof r.volume === "number" ? r.volume : -1);
  const dif = (r) => (typeof r.difficulty === "number" ? r.difficulty : Infinity);
  const order = [...rows].sort((a, b) => vol(b) - vol(a) || cmp(a.query, b.query)); // descending volume, ties by code point
  const withSerp = order.filter((r) => Array.isArray(r.top10) && r.top10.length);
  const sets = new Map(withSerp.map((r) => [r.query, new Set(r.top10.slice(0, 10).map(normResultUrl))]));
  const parent = new Map(withSerp.map((r) => [r.query, r.query]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const via = new Map();
  for (let i = 0; i < withSerp.length; i++) for (let j = i + 1; j < withSerp.length; j++) {
    const a = withSerp[i].query, b = withSerp[j].query;
    let n = 0; for (const u of sets.get(b)) if (sets.get(a).has(u)) n++;
    if (n >= overlap) { const ra = find(a), rb = find(b); if (ra !== rb) { parent.set(rb, ra); } via.set(`${a}\u0000${b}`, n); }
  }
  const groups = new Map();
  for (const r of withSerp) { const k = find(r.query); groups.set(k, [...(groups.get(k) || []), r]); }
  const clusters = [...groups.values()].map((g) => ({ rows: g, serp: true }));
  // a query without SERP data joins the cluster of the captured query whose head term equals its own (first in volume order), else is a cluster of one (serp:false)
  const headIndex = new Map();
  for (const c of clusters) for (const r of c.rows) { const k = headOf(r.query); if (!headIndex.has(k)) headIndex.set(k, c); }
  const joined = new Map(); // cluster -> rows joined by head term
  for (const r of order.filter((x) => !(Array.isArray(x.top10) && x.top10.length))) {
    const home = headIndex.get(headOf(r.query));
    if (home) { home.rows.push(r); joined.set(r.query, "head-term"); } else clusters.push({ rows: [r], serp: false });
  }
  const out = clusters.map((c) => {
    const rs = [...c.rows].sort((a, b) => vol(b) - vol(a) || dif(a) - dif(b) || cmp(a.query, b.query)); // primary: highest volume, ties lower difficulty, then code point
    const primary = rs[0];
    return {
      primary: primary.query, serp: c.serp,
      members: rs.map((r) => ({ query: r.query, volume: r.volume ?? null, difficulty: Number.isFinite(dif(r)) ? dif(r) : null, serp: Array.isArray(r.top10) && r.top10.length > 0, via: r === primary ? "primary" : joined.get(r.query) || (c.serp ? "serp-overlap" : "alone") })),
    };
  });
  const rank = new Map(order.map((r, i) => [r.query, i]));
  out.sort((a, b) => rank.get(a.primary) - rank.get(b.primary));
  return out;
}

// ---------------------------------------------------------------- 9.3 page type
const subtypeCache = { doc: null };
const subtypes = () => (subtypeCache.doc ||= loadRule("schema-subtypes.json"));
export const isSchemaType = (type, root) => type === root || (subtypes()[root] || []).includes(type);
const hasType = (types, ...roots) => types.some((t) => roots.some((r) => isSchemaType(t, r)));
export function categoryPath(urlPath) {
  const segs = String(urlPath || "/").split("/").filter(Boolean).map((s) => s.toLowerCase());
  const known = loadRule("route-patterns.json").categorySegments.map((x) => x.segment);
  return segs.some((s, i) => known.includes(s) && (i === segs.length - 1 || i === segs.length - 2));
}
export function directoryEntry(host) {
  const h = String(host || "").replace(/^www\./, "").toLowerCase();
  if (!h) return null;
  return loadRule("directory-domains.json").domains.filter((d) => h === d.host || h.endsWith("." + d.host)).sort((a, b) => b.host.length - a.host.length)[0] || null;
}
// input: { schemaTypes: [type] (every @type on the page), mainEntityType: type|null (default: the first schema type), path, host } -> product | category | local | article | video | forum | directory | comparison | page
export function pageTypeOf({ schemaTypes = [], mainEntityType, path: urlPath = "/", host = "" } = {}) {
  const types = schemaTypes.map(String), main = mainEntityType === undefined ? types[0] : mainEntityType;
  // A BreadcrumbList is an ItemList subtype in schema.org, but it is navigation: it must not make every page with a trail a category.
  const listTypes = types.filter((t) => t !== "BreadcrumbList");
  if (hasType(types, "Product", "Offer")) return "product";
  if (hasType(listTypes, "ItemList") || categoryPath(urlPath)) return "category";
  if (hasType(types, "LocalBusiness")) return "local";
  if (hasType(types, "Article")) return "article"; // BlogPosting and NewsArticle are Article subtypes in the schema.org vocabulary
  if (main && isSchemaType(main, "VideoObject")) return "video";
  const dir = directoryEntry(host);
  if (hasType(types, "QAPage") || dir?.kind === "forum") return "forum";
  if (dir) return "directory";
  const segs = String(urlPath).split("/").filter(Boolean).map((s) => s.toLowerCase());
  if (segs.some((s) => s === "vs" || s.includes("-vs-")) || (main && isSchemaType(main, "Review"))) return "comparison";
  return "page";
}
// A built page record (lib-site.mjs parseHtml) -> its page type. mainEntityType: the node a WebPage names as mainEntity, else the first top-level node.
export function schemaInfoOf(jsonld = []) {
  const nodes = [];
  const walk = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk); if (n["@graph"]) walk(n["@graph"]); if (n["@type"]) nodes.push(n); };
  for (const j of jsonld) walk(j.parsed);
  const typesOf = (n) => [].concat(n["@type"] || []).map(String);
  const all = [...new Set(nodes.flatMap(typesOf))];
  const wp = nodes.find((n) => n.mainEntity && typeof n.mainEntity === "object" && n.mainEntity["@type"]);
  const first = nodes.find((n) => !typesOf(n).some((t) => isSchemaType(t, "WebPage") || t === "WebSite" || t === "BreadcrumbList"));
  const main = wp ? typesOf(wp.mainEntity)[0] : first ? typesOf(first)[0] : null;
  return { schemaTypes: all, mainEntityType: main };
}
export const pageTypeOfPage = (pg, host = "") => pageTypeOf({ ...schemaInfoOf(pg.jsonld), path: pg.path, host });

// ---------------------------------------------------------------- 03 section 22.2 table: intent -> compatible page types
const COMPAT = {
  informational: ["article", "page", "video", "comparison"],
  commercial: ["comparison", "article", "category", "page"],
  transactional: ["product", "category", "local"], // + page when the brief has a cta
  local: ["local", "page", "category"],
  navigational: ["page", "home"],
};
export function compatibleTypes(intent, { cta = false } = {}) {
  const t = COMPAT[intent];
  if (!t) return [];
  return intent === "transactional" && cta ? [...t, "page"] : t;
}
export const isCompatible = (intent, pageType, opts = {}) => compatibleTypes(intent, opts).includes(pageType);

// ---------------------------------------------------------------- 9.2 intent
export function modifiersFor(locale, extra = null) {
  const e = localeEntry(loadRule("intent-modifiers.json"), locale);
  if (!e) throw new LocaleMissing(`ruleset intent-modifiers.json has no entry for locale "${locale}" (shipgate 04 section 15: no silent en fallback); add the locale to rules/intent-modifiers.json`);
  const stem = stemmerFor(locale), out = [];
  for (const [intent, list] of Object.entries({ ...e.value, ...(extra || {}) })) for (const m of list) out.push({ intent, term: m.term ?? m, words: uaxWords(m.term ?? m).map(stem) });
  return out;
}
function hasRun(list, run) { outer: for (let i = 0; i + run.length <= list.length; i++) { for (let j = 0; j < run.length; j++) if (list[i + j] !== run[j]) continue outer; return true; } return false; }
export function queryModifiers(query, locale, extra = null) {
  const stem = stemmerFor(locale), w = uaxWords(query).map(stem), hit = {};
  for (const m of modifiersFor(locale, extra)) if (m.words.length && hasRun(w, m.words)) (hit[m.intent] ||= []).push(m.term);
  return hit;
}
const rankFeature = (features, ...names) => (features || []).some((f) => names.includes(String(f).toLowerCase().replace(/[\s-]+/g, "_")));
// serp: { features: [..], organic: [{ url, schemaTypes?, mainEntityType? }] } | null.  brands: extra brand names from intake.json.
// Returns { intent, rule: 1-5, why }.
export function intentDetail(query, { locale = "en-US", country, serp = null, brands = [], extraModifiers = null } = {}) {
  const mods = queryModifiers(query, locale, extraModifiers), words = uaxWords(query);
  const top = (serp?.organic || []).slice(0, 10);
  const types = top.map((o) => pageTypeOf({ schemaTypes: o.schemaTypes || [], mainEntityType: o.mainEntityType, path: pathOf(o.url), host: hostOf(o.url) }));
  const count = (...k) => types.filter((t) => k.includes(t)).length;
  const region = country ?? (String(locale).split(/[-_]/)[1] || null);
  const place = scanPlaces(words, gazetteer(region, { locale })).places[0];
  if (rankFeature(serp?.features, "local_pack", "localpack")) return { intent: "local", rule: 1, why: "the SERP has a local pack" };
  if (place) return { intent: "local", rule: 1, why: `the query names the place "${place}"` };
  if (mods.local) return { intent: "local", rule: 1, why: `local modifier "${mods.local[0]}"` };
  if (count("product", "category") >= 3) return { intent: "transactional", rule: 2, why: `${count("product", "category")} of the top 10 are product or category pages` };
  if (rankFeature(serp?.features, "shopping")) return { intent: "transactional", rule: 2, why: "the SERP has shopping results" };
  if (mods.transactional) return { intent: "transactional", rule: 2, why: `transactional modifier "${mods.transactional[0]}"` };
  if (mods.commercial) return { intent: "commercial", rule: 3, why: `commercial modifier "${mods.commercial[0]}"` };
  if (count("comparison") >= 3) return { intent: "commercial", rule: 3, why: `${count("comparison")} of the top 10 are comparison or review pages` };
  const perHost = new Map(); for (const o of top) { const h = hostOf(o.url); if (h) perHost.set(h, (perHost.get(h) || 0) + 1); }
  const maxHost = [...perHost].sort((a, b) => b[1] - a[1])[0];
  if (maxHost && maxHost[1] >= 5) return { intent: "navigational", rule: 4, why: `${maxHost[1]} of the top 10 are on ${maxHost[0]}` };
  const q = words.join(" ");
  const brandNames = [...loadRule("directory-domains.json").domains.map((d) => d.brand), ...brands].filter(Boolean).map((b) => uaxWords(b).join(" "));
  if (brandNames.includes(q)) return { intent: "navigational", rule: 4, why: `the query equals the brand "${q}"` };
  return { intent: "informational", rule: 5, why: "no earlier rule matched" };
}
export const intentOf = (query, opts) => intentDetail(query, opts).intent;

// ---------------------------------------------------------------- 9.7 page-cluster match
// cluster: { primaryQuery, intent, queries? }.  pages: indexable page records [{ path, title, h1: [..] | string, pageType }] (pageType from pageTypeOfPage).
// opts: { locale, clicks(page) -> Search Console clicks for the cluster's queries (default 0), cta (the brief has a cta; default true) }
// -> { match: page|null, others: [page] } ; the others are the cannibalisation candidates (TGT-003).
// SKILL CHOICE (not in the spec, recorded in the build report): a head term has its place names removed, so without a guard the home page of "Realtor in Tracy" would match
// the cluster "realtor in manteca ca" too. A page whose title or h1 names a place that the cluster's query does not name is a page for ANOTHER place and is not a match
// (applies only when the query itself names a place). namesOtherPlace() is shared with GT-003.
export function namesOtherPlace(primaryQuery, pageText, { locale = "en-US" } = {}) {
  const qp = new Set(placesIn(primaryQuery, { locale }));
  if (!qp.size) return false;
  const there = placesIn(pageText, { locale });
  return there.length > 0 && !there.some((x) => qp.has(x));
}
export function matchPages(cluster, pages, { locale = "en-US", clicks = () => 0, cta = true } = {}) {
  const head = headTerm(cluster.primaryQuery, { locale });
  const ok = pages.filter((p) => {
    const h1 = Array.isArray(p.h1) ? p.h1[0] || "" : p.h1 || "";
    return (containsHeadTerm(p.title || "", head, { locale }) || containsHeadTerm(h1, head, { locale })) && isCompatible(cluster.intent, p.pageType, { cta }) && !namesOtherPlace(cluster.primaryQuery, `${p.title || ""} ${h1}`, { locale });
  });
  if (!ok.length) return { match: null, others: [] };
  const ranked = [...ok].sort((a, b) => (clicks(b) - clicks(a)) || (String(a.path).length - String(b.path).length) || cmp(String(a.path), String(b.path)));
  return { match: ranked[0], others: ranked.slice(1) };
}

// ---------------------------------------------------------------- TGT-004 / TR-231: "carries the query"
// A text carries a cluster's query when it contains the primary query's head term (stemmed words, web-delivery section 12) or contains one of the
// cluster's queries as a run of whole words (NFKC, case-folded). queries defaults to [primaryQuery].
export function containsPhrase(text, phrase) {
  const w = uaxWords(text), p = uaxWords(phrase);
  return p.length > 0 && hasRun(w, p);
}
export function carriesQuery(text, cluster, { locale = "en-US" } = {}) {
  const head = headTerm(cluster.primaryQuery, { locale });
  if (containsHeadTerm(text, head, { locale })) return true;
  return [cluster.primaryQuery, ...(cluster.queries || [])].some((q) => containsPhrase(text, q));
}
// Places named in a text (gazetteer, longest match) -> [normalised name]
export function placesIn(text, { locale = "en-US", country } = {}) {
  const region = country ?? (String(locale).split(/[-_]/)[1] || null);
  return scanPlaces(uaxWords(text), gazetteer(region, { locale })).places;
}
