// Keyword clustering by SHARED TOP-10 RESULTS, exactly as shipgate 06-growth.md section 9.1 (rewritten 2026-10-22):
//   - two queries are linked when their top-10 organic URL sets share at least --shared (= growth.research.clusterOverlap, default 4) URLs;
//   - clusters are the connected components (union-find, lib-growth.mjs clusterByOverlap), queries taken in descending volume order, ties by code point;
//   - a query without SERP data joins the cluster of the captured query whose HEAD TERM equals its own (web-delivery section 12, lib-text.mjs headTerm),
//     else stays a cluster of one, marked serp:false;
//   - the primary query is the highest-volume member (ties: lower difficulty, then code point);
//   - ONE step after the above (added 2026-10-23, validator consistency): a query WITHOUT its own SERP capture that is left as a cluster of one and
//     collides with a member of ANOTHER cluster, by the very test the output checks use (research.mjs checkTargets: research-lib sameQuery, >= 80%
//     token overlap; targets-validate T-003: the same lib-text token set) and in the same place, joins that cluster with basis "token-overlap (no SERP
//     of its own)". Two such singletons merge into one cluster, whose primary is the higher-demand one (the primary rule above). Why: research
//     must never emit clusters its own validator rejects; on the Rainmaker target, autocomplete-only queries ("how much do life insurance agents make"
//     / "... a year") stayed separate clusters and checkTargets + T-003 failed on them. A query WITH its own SERP capture is NEVER merged by tokens
//     (the spec clusters those by shared results only): if two captured primaries collide, the validator still reports it, nothing is hidden.
// What changed from the first version (kept here so nobody restores it by accident): the "join the first cluster whose HEAD shares enough" rule
// (min(shared, 40% of the shorter list), a guard against chaining) is gone because the spec chains by design; the "never merge queries about
// different places / on different devices" rules and the 80%-token-overlap "variant" merge are gone (the spec has neither; a query without a
// capture now joins by head term instead); one capture is used per query (wanted engine first, then newest).
// Input is the parsed SERP captures (research-serp-import.mjs), never live Google. A result is identified by its URL; a legacy capture that holds
// only domains uses domain + title for portals (marked in the output).
// Usage: node research-cluster.mjs <target> [--engine google|bing] [--shared 4] [--max-clusters 80] [--cwd DIR]
// Output: research/clusters.json { clusters:[{id, head, queries:[{query, basis}], serp, ...}], portals:[domain] }. No captures => every cluster is a single query (serp:false):
// there is no captured query to join, so nothing is guessed.
import path from "node:path";
import { tierFromSuggestion } from "./research-autocomplete.mjs";
import { clusterByOverlap } from "./lib-growth.mjs";
import { headTerm, tokens as textTokens } from "./lib-text.mjs";
import { placesIn } from "./lib-growth.mjs";
import { hasPlaceholder, Blocked, context, needBusiness, runCli, readStep, writeStep, knownPlaces, allPlaces, placeInQuery, normQuery, sameQuery, normUrl, slug, factor, notMeasured, localeOf } from "./research-lib.mjs";

// A result is identified by its URL. A legacy capture holds only domains: a niche domain then stands for its one page (it rarely ranks two
// pages for a query), while a portal (a domain that fills many results pages) is told apart by domain + title.
const resultKey = (o, portals = []) => (o.url ? normUrl(o.url) : portals.includes(o.domain) ? `${o.domain}|${String(o.title || "").toLowerCase().slice(0, 40)}` : o.domain);
// Order: a measured number beats a tier estimate beats nothing; inside a kind, bigger first.
export const volKey = (v) => (typeof v?.value === "number" ? [2, v.value] : v?.rank ? [1, v.rank] : [0, 0]);
const byVolume = (a, b) => { const x = volKey(a.volume), y = volKey(b.volume); return y[0] - x[0] || y[1] - x[1] || a.order - b.order; };

// domains that fill the SERPs of many different queries (aggregators/portals): used for the difficulty signal
export function portalDomains(captures, { minShare = 0.25, minQueries = 3 } = {}) {
  const byQuery = new Map();
  for (const c of captures) { const s = byQuery.get(c.query) || new Set(); c.organic.forEach((o) => s.add(o.domain)); byQuery.set(c.query, s); }
  const n = byQuery.size, count = new Map();
  for (const s of byQuery.values()) for (const d of s) count.set(d, (count.get(d) || 0) + 1);
  return n < 4 ? [] : [...count].filter(([, k]) => k >= minQueries && k / n >= minShare).map(([d]) => d).sort();
}

// The universe: one row per query with its best sourced volume/value and where it was seen.
export function buildUniverse(ctx) {
  const U = new Map();
  const dropped = [];
  const up = (query, patch) => {
    const q = normQuery(query); if (!q) return;
    if (hasPlaceholder(q)) { dropped.push({ text: q, source: patch.source }); return; } // a template is never a search
    const row = U.get(q) || { query: q, sources: [], volumes: {}, value: null, order: U.size };
    row.sources.push(patch.source);
    if (patch.volume) row.volumes[patch.source] = patch.volume;
    if (patch.value && !row.value) row.value = patch.value;
    if (patch.location) row.location = patch.location;
    if (patch.sharedWith) row.sharedWith = [...new Set([...(row.sharedWith || []), ...patch.sharedWith])];
    U.set(q, row);
  };
  for (const s of readStep(ctx, "seeds")?.queries || []) up(s.query, { source: "seed", location: s.location || null });
  for (const k of readStep(ctx, "kwp")?.keywords || []) up(k.query, { source: "kwp", volume: k.volume, value: k.value });
  for (const k of readStep(ctx, "bing")?.keywords || []) up(k.query, { source: "bing", volume: k.volume });
  const gscDoc = readStep(ctx, "gsc"), gsc = new Map();
  for (const r of gscDoc?.rows || []) { const g = gsc.get(r.query) || { imp: 0, f: r.impressions }; g.imp += r.impressions.value; gsc.set(r.query, g); }
  for (const [q, g] of gsc) {
    const { device: _d, ...f } = g.f;
    up(q, { source: "gsc", volume: { ...f, value: g.imp, estimate: true, unit: "Search Console impressions of OUR site (a lower bound of demand, not a search count)", location: gscDoc.country ? String(gscDoc.country).toUpperCase() : "all countries in the export" } });
  }
  for (const k of readStep(ctx, "existing")?.keywords || []) up(k.query, { source: "existing", volume: k.volume, sharedWith: k.sharedWith });
  for (const r of readStep(ctx, "autocomplete")?.rows || []) up(r.suggestion, { source: "autocomplete", volume: tierFromSuggestion(r) });
  for (const c of readStep(ctx, "serp")?.captures || []) up(c.query, { source: "serp" });
  for (const row of U.values()) {
    const order = ["kwp", "bing", "gsc", "autocomplete", "existing"];
    const src = order.find((s) => row.volumes[s]?.value != null);
    row.volume = src ? row.volumes[src] : notMeasured("no volume source has this query (Keyword Planner export, Bing key or Search Console would give one)");
    row.volumeSource = src || null;
  }
  const rows = [...U.values()];
  rows.dropped = dropped;
  return rows;
}

const score = (v) => { const [k, n] = volKey(v); return k * 1e12 + n; }; // measured > tier estimate > nothing, then bigger first

// Validator consistency (see the header): "the same query" is decided by the output checks' own functions, never by a number kept here.
// research.mjs checkTargets uses research-lib sameQuery (the 80% threshold lives there); targets-validate T-003 compares the lib-text token set.
const tokKey = (q) => [...new Set(textTokens(q))].sort().join(" ");
export const collides = (a, b) => sameQuery(a, b) || (tokKey(a) !== "" && tokKey(a) === tokKey(b));
const cmpCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// raw: clusterByOverlap output (a serp:false cluster is always a single query without a capture). Only those singletons move; a captured query never does.
export function mergeTokenOverlap(raw, { rows, placeOf }) {
  const idx = new Map(raw.map((c, i) => [c, i]));
  const loose = raw.filter((c) => !c.serp && c.members.length === 1);
  const gone = new Set(), touched = new Set();
  let candidates = raw.filter((c) => !loose.includes(c)); // clusters that may receive a query; a singleton that found no home becomes one for the next
  for (const L of loose) {
    const q = L.primary, place = placeOf(q);
    const home = candidates.find((c) => c.members.some((m) => placeOf(m.query) === place && collides(q, m.query)));
    if (!home) { candidates = [...candidates, L].sort((a, b) => idx.get(a) - idx.get(b)); continue; }
    home.members.push({ ...L.members[0], via: "token-overlap" });
    gone.add(L); touched.add(home);
  }
  if (!gone.size) return raw;
  const vol = (m) => (typeof m.volume === "number" ? m.volume : -1), dif = (m) => (typeof m.difficulty === "number" ? m.difficulty : Infinity);
  for (const c of touched) {
    c.members.sort((a, b) => vol(b) - vol(a) || dif(a) - dif(b) || cmpCode(a.query, b.query)); // the primary rule of 9.1: highest demand, then lower difficulty, then code point
    c.primary = c.members[0].query;
    for (const m of c.members) m.via = m.query === c.primary ? "primary" : m.via === "primary" ? (m.serp ? "serp-overlap" : c.serp ? "head-term" : "token-overlap") : m.via; // a demoted primary keeps an honest basis
  }
  const volOf = new Map(rows.map((r) => [r.query, typeof r.volume === "number" ? r.volume : -1]));
  const out = raw.filter((c) => !gone.has(c));
  return out.sort((a, b) => volOf.get(b.primary) - volOf.get(a.primary) || cmpCode(a.primary, b.primary));
}
export function clusterQueries({ universe, captures, engine = "google", shared = 4, maxClusters = 80, places = [], locale = "en-US" }) {
  const capOf = new Map();
  for (const c of captures.filter((c) => c.status !== "BLOCKED").sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))) {
    const prefer = c.engine === engine;
    const key = `${normQuery(c.query)}|${c.device}`;
    const have = capOf.get(key);
    if (!have || (prefer && !have._prefer)) capOf.set(key, { ...c, _prefer: prefer }); // newest first, wanted engine beats the other
  }
  const capFor = (q) => [...capOf.entries()].filter(([k]) => k.startsWith(q + "|")).map(([, v]) => v).sort((a, b) => Number(b._prefer) - Number(a._prefer))[0] || null;
  const portals = portalDomains(captures.filter((c) => c.engine === engine));
  const byQuery = new Map(universe.map((u) => [u.query, u]));
  const rows = universe.map((u) => { const cap = capFor(u.query); return { query: u.query, volume: score(u.volume), difficulty: typeof u.difficulty?.value === "number" ? u.difficulty.value : null, top10: cap ? cap.organic.slice(0, 10).map((o) => resultKey(o, portals)) : null, cap }; });
  const heads = new Map();
  // The head term (9.1: "joins the captured query whose head term equals its own") has place names removed, so taken alone it would pour "realtor in manteca ca" into the
  // cluster of "realtor in tracy ca" whenever Manteca has no capture, and a local site needs a page per city (06 TR-232 builds families out of clusters that differ only by place).
  // SKILL CHOICE, recorded in the build report: the join key is the head term PLUS the places the query names (gazetteer, the business's places and the "<city> ca" shape).
  const headKey = (q) => { if (!heads.has(q)) heads.set(q, `${headTerm(q, { locale }).words.slice().sort().join(" ")}|${[...new Set([...placesIn(q, { locale }), placeInQuery(q, places)?.label?.toLowerCase()].filter(Boolean))].sort().join(",")}`); return heads.get(q); };
  const placeOf = (q) => placeInQuery(q, places)?.label || null;
  const rowOf = new Map(rows.map((r) => [r.query, r]));
  const raw = mergeTokenOverlap(clusterByOverlap(rows, { overlap: shared, headOf: headKey }), { rows, placeOf }).slice(0, maxClusters); // the cap comes AFTER the merge: a merged-away cluster no longer takes a slot
  const sharedWith = (q, members) => { // the most results q shares with another captured member
    const a = new Set(rowOf.get(q).top10 || []); let best = 0, of = 0;
    for (const m of members) if (m.query !== q && rowOf.get(m.query).top10) { const b = rowOf.get(m.query).top10; const n = b.filter((k) => a.has(k)).length; if (n > best) { best = n; of = Math.min(a.size, b.length); } }
    return `serp-overlap (${best} shared of ${of})`;
  };
  const used = new Set();
  return raw.map((c) => {
    const head = byQuery.get(c.primary), hr = rowOf.get(c.primary);
    const capMember = hr.cap ? c.primary : c.members.find((m) => m.serp)?.query; // the capture that stands for the cluster: the primary's, else the biggest captured member's
    const cap = capMember ? rowOf.get(capMember).cap : null;
    let id = `c-${slug(head.query)}`; for (let n = 2; used.has(id); n++) id = `c-${slug(head.query)}-${n}`; used.add(id);
    const identity = cap ? (cap.organic.some((o) => o.url) ? "url" : "domain (portals: domain+title); the capture holds no URLs") : null;
    const basis = (m) => (m.via === "primary" ? (hr.cap ? "head" : "no capture") : m.via === "serp-overlap" ? sharedWith(m.query, c.members) : m.via === "head-term" ? "head term (no SERP of its own)" : m.via === "token-overlap" ? "token-overlap (no SERP of its own)" : "no capture");
    return { id, sharedWith: [...new Set(c.members.flatMap((m) => byQuery.get(m.query)?.sharedWith || []))], head: head.query, place: placeOf(head.query), serp: c.serp, captureOfHead: cap ? { id: cap.id, engine: cap.engine, capturedAt: cap.capturedAt, device: cap.device, location: cap.locationLabel, file: cap.file, ...(capMember !== c.primary ? { fromMember: capMember } : {}) } : null, identity, queries: c.members.map((m) => ({ query: m.query, basis: basis(m) })), sources: head.sources, volume: head.volume, volumeSource: head.volumeSource, value: head.value };
  });
}

export async function run(ctx, { engine = "google", shared = 4, maxClusters = 80 } = {}) {
  const b = needBusiness(ctx);
  const universe = buildUniverse(ctx);
  if (!universe.length) throw new Blocked("no queries at all: write research/seeds.json (research-seeds.mjs), or connect Search Console / Bing / a Keyword Planner export, or import captures");
  const serp = readStep(ctx, "serp");
  const captures = serp?.status === "ok" ? serp.captures : [];
  const places = allPlaces(ctx, (n) => readStep(ctx, n));
  const clusters = clusterQueries({ universe, captures, engine, shared, maxClusters, places, locale: localeOf(ctx.market) });
  const portals = portalDomains(captures.filter((c) => c.engine === engine));
  const cut = universe.length - clusters.reduce((n, c) => n + c.queries.length, 0);
  return writeStep(ctx, "clusters", { engine, shared, universe: universe.length, droppedTemplates: universe.dropped || [], withCapture: clusters.filter((c) => c.captureOfHead).length, droppedByCap: cut, portals, clusters });
}

await runCli(import.meta.url, "node research-cluster.mjs <target> [--engine google|bing] [--shared 4] [--max-clusters 80] [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { engine: a.get("engine", "google"), shared: a.num("shared", 4), maxClusters: a.num("max-clusters", 80) });
  return `OK clusters: ${r.clusters.length} clusters from ${r.universe} queries (${r.withCapture} with a captured SERP${r.droppedByCap ? `, ${r.droppedByCap} queries over the cap` : ""}); portals: ${r.portals.join(", ") || "none detected"} -> ${path.join(ctx.rdir, "clusters.json")}`;
});
