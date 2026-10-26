// S2 research: runs the free-source research steps in order from state and writes <pewp>/research/*.json, research/report.md and
// <pewp>/targets.json (schemas/targets.md). Each step is also usable alone (research-*.mjs). A step whose source is missing is recorded
// BLOCKED with what unblocks it and the run goes on; nothing is ever filled from memory. Scripts never prompt and never fetch Google.
// Usage: node research.mjs <url | repo path> [--cwd DIR] [--dry] [--yes]
//   seeds:        --service S (repeat) [--pattern P]... [--query Q]...      (or research/seeds.json already there; with none of these and a business.json
//                 `vocabulary`, the vocabulary is the service list). The seeds are a PROPOSAL (G3): the demand steps (Bing, forums, the capture list)
//                 refuse to run (exit 3, "NEEDS-APPROVAL seeds:") unless <pewp>/approved/seeds.json lists the same queries as research/seeds.json
//                 (node approve.mjs <target> seeds --by NAME) or --yes is given because the owner already agreed. --dry is never blocked.
//   demand:       --gsc-property P  --kwp-file F  --bing-max-calls 60  [--no-related] [--keep-brands]  --wiki-title T (repeat)  --forums [--forum-query Q]...
//                 (--no-related: Bing seed volumes only, no related keywords; --keep-brands: keep related keywords that name another site, e.g. zillow)
//   captures:     --capture-dir DIR (default <pewp>/captures/serp)  --device desktop|mobile (for old text captures)  --use-existing-captures
//   competitors:  --competitor domain (repeat)  --from-serp (also audit the sites that win the captured results pages; listed in the plan)
//                 --max-competitors 12  --authority [--authority-cache DIR --authority-release ID]  [--approved-competitors FILE]
//                 When <pewp>/approved/competitors.json exists (the owner-approved list) the audit reads exactly its rows with a domain (plus --competitor);
//                 --from-serp picks are then only SUGGESTED in the report, never audited.
//   AI answers:   --gemini [--runs 3 --ai-questions 8 --ai-max-calls 30]  --question Q  (owner captures: <pewp>/captures/ai/)
//   reuse:        --existing-dir DIR (repeat)  --max-age-days 30
//   cost:         --dry prints the plan and stops; a plan above --confirm-above (default 150) external calls needs --yes.
// Exit codes: 0 targets.json written (blocked steps are listed in report.md and state), 1 a step crashed or the output failed its checks,
//             2 usage, 3 BLOCKED (no intake yet, no query universe, owner confirmation needed, or NEEDS-APPROVAL seeds).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { markStage } from "./state.mjs";
import { RuleMissing } from "./lib-rules.mjs";
import { matchPages, pageTypeOf, pageTypeOfPage, schemaInfoOf } from "./lib-growth.mjs";
import { Blocked, J, W, iso, context, needBusiness, runCli, readStep, factor, fact, knownPlaces, allPlaces, classifyIntent, placeInQuery, queryOverlap, tokens, sameQuery, domainOf, normQuery, pathOf, ageDays, localeOf } from "./research-lib.mjs";
import * as existing from "./research-existing.mjs";
import * as seeds from "./research-seeds.mjs";
import * as gsc from "./research-gsc.mjs";
import * as bing from "./research-bing.mjs";
import * as kwp from "./research-kwp.mjs";
import * as wiki from "./research-wiki.mjs";
import * as forums from "./research-forums.mjs";
import * as serp from "./research-serp-import.mjs";
import * as cluster from "./research-cluster.mjs";
import * as competitors from "./research-competitors.mjs";
import { approvedCompetitorRows } from "./research-competitors.mjs";
import * as ai from "./research-ai.mjs";
import * as autocomplete from "./research-autocomplete.mjs";
import * as winners from "./research-winners.mjs";
import * as assets from "./research-assets.mjs";
import * as citations from "./research-citations.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- G3: the demand steps run only on seeds the owner approved ----------
export class NeedsApproval extends Error { constructor(text) { super(text); this.text = text; } }
const seedKey = (x) => normQuery(typeof x === "string" ? x : x?.query);
// { needed, ok, reason, count }: needed = there are seeds to spend calls on; ok = <pewp>/approved/seeds.json lists exactly the queries of research/seeds.json
export function seedsApproval(ctx) {
  const doc = readStep(ctx, "seeds"), cur = new Set((doc?.status === "ok" ? doc.queries || [] : []).map(seedKey).filter(Boolean));
  if (!cur.size) return { needed: false, ok: true, reason: "no seeds yet", count: 0 };
  const ap = J(path.join(ctx.pewp, "approved", "seeds.json"));
  if (!ap) return { needed: true, ok: false, reason: "have not been approved: approved/seeds.json does not exist", count: cur.size };
  const have = new Set((Array.isArray(ap) ? ap : ap.queries || []).map(seedKey).filter(Boolean));
  const added = [...cur].filter((x) => !have.has(x)), removed = [...have].filter((x) => !cur.has(x));
  if (!added.length && !removed.length) return { needed: true, ok: true, reason: "approved (approved/seeds.json lists the same queries)", count: cur.size };
  return { needed: true, ok: false, reason: `differ from the approved list: ${added.length} not approved yet (${added.slice(0, 3).join("; ")}${added.length > 3 ? "; ..." : ""}), ${removed.length} approved but no longer in research/seeds.json`, count: cur.size };
}
const needsApprovalText = (ctx, g) => `NEEDS-APPROVAL seeds: the ${g.count} seed queries in research/seeds.json ${g.reason}. Bing, forums and the capture list spend calls and the owner's time on exactly these searches, so the owner approves them first. Show the owner ${path.join(ctx.rdir, "seeds.json")} (every query says where it came from), then run: node approve.mjs ${ctx.loc.target} seeds --by NAME   or, when the owner has already agreed to this list, re-run with --yes. Nothing was fetched.`;
const GENERIC = new Set("home homes house houses real estate agent agents realtor realtors company companies service services best top near sell buy cash free quote contact".split(" "));

// ---------- helpers for the targets ----------
export function existingPages(ctx) {
  const snaps = ctx.loc.snapshots; if (!snaps || !fs.existsSync(snaps)) return [];
  const dir = fs.readdirSync(snaps).filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x)).sort().reverse().map((d) => path.join(snaps, d)).find((d) => J(path.join(d, "_site.json"))?.finishedAt);
  if (!dir) return [];
  const site = J(path.join(dir, "_site.json")), out = [];
  for (const p of (site.pages || []).slice(0, 300)) {
    const rd = (f) => { try { return fs.readFileSync(path.join(dir, "pages", p.slug, f), "utf8"); } catch { return ""; } };
    const head = rd("head.html"), body = rd("body.html");
    const title = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
    const h1 = (body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
    const jsonld = [...(head + body).matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => { try { return { parsed: JSON.parse(m[1]) }; } catch { return { parsed: null }; } });
    out.push({ path: pathOf(p.finalUrl || p.url) || "/", title, h1, jsonld, snapshot: path.basename(dir) });
  }
  return out;
}
function formatOf(top3, ownDomain) {
  const kinds = top3.map((o) => {
    const p = (o.url ? pathOf(o.url) : "") || "";
    if (!o.url) return null;
    if (/\/(blog|news|articles?|guides?|learn|resources)\b|\/(how|what|why|when|can|is|are)-/.test(p)) return "guide";
    if (/calculator|estimate|home-value|valuation|tool/.test(p)) return "tool";
    if (/for-sale|homes-for-sale|listings?|\/homes\b|\/properties/.test(p)) return "listing page";
    if (/agents?|professionals|directory|reviews|best-/.test(p)) return "directory or profile page";
    if (p === "/" || p === "") return "home page";
    return "service or city landing page";
  }).filter(Boolean);
  if (!kinds.length) return "unknown (the capture holds no page addresses)";
  const n = new Map(); kinds.forEach((k) => n.set(k, (n.get(k) || 0) + 1));
  return [...n].sort((a, b) => b[1] - a[1])[0][0];
}
// 9.3 page type of the top results, most common wins (TR-216 winningFormat). The winner audit knows schema types; a bare capture only has URL and host.
export function winningPageType(top, win) {
  const audited = new Map((win?.pages || []).filter((p) => p && !p.error).map((p) => [p.url || p.domain, p]));
  const types = top.map((o) => { const a = audited.get(o.url) || [...audited.values()].find((p) => p.domain === o.domain); return pageTypeOf({ schemaTypes: a?.schemaTypes || [], path: (o.url ? pathOf(o.url) : "") || "/", host: o.domain }); });
  if (!types.length) return "page";
  const n = new Map(); types.forEach((t) => n.set(t, (n.get(t) || 0) + 1));
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}
const recurring = (titles, qTokens) => {
  const c = new Map();
  for (const t of titles) for (const w of new Set(tokens(t))) if (w.length > 3 && !GENERIC.has(w) && !qTokens.has(w)) c.set(w, (c.get(w) || 0) + 1);
  return [...c].filter(([, n]) => n >= 2).map(([w]) => w).slice(0, 6);
};
// "we buy houses tracy ca" and "we buy houses livermore ca" share 80% of their words but are different searches: queries about different
// places are never the same query (a page per city).
export const queryMatchesPage = (q, text, places) => sameQuery(q, text) && (placeInQuery(q, places)?.label || null) === (placeInQuery(text, places)?.label || null);
const INTENT_WEIGHT = { transactional: 3, local: 3, commercial: 2, informational: 1, navigational: 0.5 };

export function buildTargets(ctx, { clusters, captures, portals, wikiDoc, forumsDoc, gscDoc, pages, winnersDoc = null }) {
  const b = ctx.business, places = allPlaces(ctx, (n) => readStep(ctx, n)), own = b.domain;
  // navigational = the query names the business (full name or domain stem), not just one word of it ("tracy" is also a city)
  const brand = [normQuery(b.name).replace(/\b(llc|inc|corp|co|ltd)\b\.?/g, "").replace(/\s+/g, " ").trim(), own.split(".")[0].toLowerCase()].filter((x) => x && x.length > 4);
  const entityTitles = (wikiDoc?.entities || []).filter((e) => e.article).map((e) => e.title);
  const capsOf = (q) => captures.filter((c) => normQuery(c.query) === q && c.status !== "BLOCKED");
  const out = [];
  for (const cl of clusters) {
    const head = cl.head, memberCaps = cl.queries.flatMap((m) => capsOf(m.query));
    const headCap = cl.captureOfHead ? captures.find((c) => c.file === cl.captureOfHead.file) : null;
    const place = placeInQuery(head, places);
    const localPackSeen = memberCaps.filter((c) => c.engine === "google").length > 0 && memberCaps.filter((c) => c.engine === "google" && c.features.includes("local_pack")).length * 2 >= memberCaps.filter((c) => c.engine === "google").length;
    // 9.2 intent: the head capture's SERP (features + organic results) feeds rules 1-4; a cluster without a capture is judged on the query alone.
    const locale = localeOf(b.market);
    const intent = classifyIntent(head, { places, brand, localPackSeen, serp: headCap ? { features: headCap.features || [], organic: headCap.organic || [] } : null, locale, extraModifiers: b.intentModifiers || null });
    const location = place ? place.label : intent === "local" ? (b.rankTracking?.locations?.[0] || b.locations?.[0]?.name || null) : null;
    // serp features
    // the queries of one cluster share their results, so the features seen on any of their captures (same engine and device) belong to the cluster
    const sameSerp = headCap ? memberCaps.filter((c) => c.engine === headCap.engine && c.device === headCap.device) : [];
    const serpFeatures = headCap ? fact([...new Set(sameSerp.flatMap((c) => c.features))].sort(), `${headCap.engine} results captured in the browser (${headCap.browser || "browser"}), ${sameSerp.length} capture(s) of this cluster's queries, head ${headCap.status}`, `${headCap.capturedAt.slice(0, 10)}T00:00:00.000Z`, headCap.file, { location: headCap.locationLabel, device: headCap.device })
      : fact([], "NOT CAPTURED: no browser capture of this query yet (research/capture-requests.json); the empty list means UNKNOWN, not 'no features'", iso(), null, {});
    const others = headCap ? headCap.organic.filter((o) => o.domain !== own && !o.domain.endsWith("." + own)) : [];
    const top = others.filter((o) => o.url).slice(0, 3); // the contract wants absolute URLs; a capture that holds only domains yields none
    // difficulty: the share of the captured organic slots held by portals (domains that fill many different SERPs); a SIGNAL, labelled
    let difficulty = null;
    if (headCap && portals.length && headCap.organic.length >= 5) {
      const n = headCap.organic.filter((o) => portals.includes(o.domain)).length;
      difficulty = fact(Math.round((100 * n) / headCap.organic.length), `computed from the ${headCap.engine} capture: percent of the ${headCap.organic.length} organic results held by portals/aggregators (domains in 25%+ of all ${captures.length} captured SERPs: ${portals.slice(0, 6).join(", ")}); a signal, not a difficulty score`, `${headCap.capturedAt.slice(0, 10)}T00:00:00.000Z`, headCap.file, { estimate: true, location: headCap.locationLabel, device: headCap.device });
    }
    // questions and entities
    const qs = new Map();
    for (const c of memberCaps) for (const q of c.paa || []) qs.set(normQuery(q), q);
    for (const f of forumsDoc?.questions || []) { const ft = new Set(tokens(f.question)); const ht = tokens(head); if (ht.length && ht.filter((t) => ft.has(t)).length / ht.length >= 0.6) qs.set(normQuery(f.question), f.question); }
    const qTokens = new Set(tokens(`${head} ${cl.queries.map((m) => m.query).join(" ")}`));
    const entities = [...new Set([...(place ? [place.label] : []), ...entityTitles.filter((t) => tokens(t).some((w) => qTokens.has(w)) || [...qs.values()].some((q) => normQuery(q).includes(normQuery(t.split(",")[0])))), ...recurring(top.map((o) => o.title || ""), qTokens)])];
    const win = (winnersDoc?.clusters || []).find((w) => w.clusterId === cl.id); // the winning pages audited for this cluster (or the cached competitor audits)
    const allEntities = [...new Set([...(win?.entities || []), ...entities])];
    // target page: an existing page that already answers the query (title/H1 match >= 80%), else the page Search Console shows for it, else new
    let targetPage = "new", targetWhy = "no existing page matches";
    // 9.7: an existing indexable page matches when its title or h1 contains the primary query's head term AND its page type (9.3) is compatible with the
    // cluster's intent (the plan gives every planned page a cta, so a plain page counts as compatible with a transactional cluster); several matches -> the
    // one with most Search Console clicks for the cluster's queries, else the shortest path.
    const gr = (gscDoc?.rows || []).filter((r) => cl.queries.some((m) => m.query === normQuery(r.query)));
    const clicksByPath = new Map(); for (const r of gr) clicksByPath.set(pathOf(r.page) || r.page, (clicksByPath.get(pathOf(r.page) || r.page) || 0) + (r.clicks?.value ?? 0));
    const cands = pages.map((p) => ({ ...p, pageType: pageTypeOfPage({ path: p.path, jsonld: p.jsonld || [] }) }));
    const m97 = matchPages({ primaryQuery: head, intent }, cands, { locale, clicks: (p) => clicksByPath.get(p.path) || 0, cta: true });
    const pg = m97.match;
    if (pg) { targetPage = pg.path; targetWhy = `title/H1 of ${pg.path} has the head term and its page type (${pg.pageType}) fits the ${intent} intent (snapshot ${pg.snapshot})${m97.others.length ? `; ${m97.others.length} other page(s) match too: cannibalisation candidates ${m97.others.map((o) => o.path).join(", ")}` : ""}`; }
    let rankPos = null;
    if (gr.length) {
      const byPage = new Map(); gr.forEach((r) => byPage.set(r.page, (byPage.get(r.page) || 0) + r.impressions.value));
      const best = [...byPage].sort((a, c) => c[1] - a[1])[0][0];
      if (targetPage === "new") { targetPage = pathOf(best) || "new"; targetWhy = "the page Search Console shows most for this cluster"; }
      rankPos = gr.filter((r) => r.page === best).sort((a, c) => c.impressions.value - a.impressions.value)[0].position.value;
    }
    // a measured volume scores 1 + log10(1 + n); a tier estimate scores 1 + 0.5 x rank (T1 2.5, T2 2, T0 1.5), which sits below a measured 100
    const volScore = typeof cl.volume?.value === "number" ? 1 + Math.log10(1 + cl.volume.value) : 1 + 0.5 * (cl.volume?.rank || 0), cpc = cl.value?.value ?? 0;
    const impact = volScore * (INTENT_WEIGHT[intent] || 1) * (cpc ? 1 + Math.log10(1 + cpc) : 1);
    const ease = Math.max(0.5, (rankPos != null && rankPos <= 20 ? 3 : targetPage !== "new" ? 2 : 1) - (difficulty && difficulty.value >= 60 ? 0.5 : 0));
    out.push({
      id: cl.id, primaryQuery: head, queries: [...new Set(cl.queries.map((m) => m.query))], intent, location,
      volume: cl.volume, difficulty, value: cl.value || null, serpFeatures,
      winningFormat: win?.format || (headCap ? formatOf(top, own) : "unknown (no capture yet)"),
      winningPageType: win?.pageType || winningPageType(top, win),
      requiredTerms: win?.requiredTerms || [],
      competitorsTop3: top.map((o) => ({ url: o.url || "", domain: o.domain })),
      ...(win?.wordRange ? { wordRange: win.wordRange } : {}),
      ...(cl.sharedWith?.length ? { sharedWith: cl.sharedWith } : {}), // the source section also names another business: the owner decides
      requiredEntities: allEntities, questions: [...qs.values()].slice(0, 15), targetPage,
      priority: Math.round(impact * ease * 100) / 100,
      _why: { targetWhy, basis: cl.queries.map((m) => m.basis), winnersBasis: win?.basis || null, topDomains: others.slice(0, 3).map((o) => o.domain), captureHasUrls: others.some((o) => o.url) },
    });
  }
  out.sort((a, c) => c.priority - a.priority || a.primaryQuery.localeCompare(c.primaryQuery));
  const taken = new Map(); // one cluster = one page: the higher-priority cluster keeps an existing page, the other is a new page
  for (const c of out) {
    if (c.targetPage === "new") continue;
    const key = c.targetPage.replace(/\/+$/, "").toLowerCase() || "/";
    if (taken.has(key)) { c._why.targetWhy = `${c.targetPage} already belongs to cluster ${taken.get(key)}; this one needs its own page (${c._why.targetWhy})`; c.targetPage = "new"; } else taken.set(key, c.id);
  }
  return out;
}

// ---------- checks on targets.json (ours; targets-validate.mjs is also called when it exists) ----------
export function checkTargets(t) {
  const errs = [], ids = new Set(), pq = [];
  if (!t.market?.country || !t.market?.language) errs.push("market missing");
  const isFact = (f) => f && typeof f === "object" && "value" in f && f.source && f.fetchedAt && "cacheFile" in f;
  for (const c of t.clusters || []) {
    if (!/^c-[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) errs.push(`id "${c.id}" does not look like c-<slug>`);
    if (ids.has(c.id)) errs.push(`duplicate id ${c.id}`); ids.add(c.id);
    for (const q of pq) if (q === normQuery(c.primaryQuery)) errs.push(`two clusters share primaryQuery "${c.primaryQuery}"`);
    pq.push(normQuery(c.primaryQuery));
    for (const k of ["volume", "serpFeatures"]) if (!isFact(c[k])) errs.push(`${c.id}.${k} is not a sourced number`);
    if (c.volume?.value == null) errs.push(`${c.id}.volume has no number (an unmeasured search stays out of targets.json)`);
    for (const x of c.competitorsTop3 || []) if (!/^https?:\/\//.test(x.url || "")) errs.push(`${c.id}.competitorsTop3 url "${x.url}" is not absolute`);
    for (const k of ["difficulty", "value"]) if (c[k] != null && !isFact(c[k])) errs.push(`${c.id}.${k} is not a sourced number`);
    for (const [k, v] of [["primaryQuery", c.primaryQuery], ["location", c.location], ...(c.queries || []).map((q) => ["queries", q]), ...(c.questions || []).map((q) => ["questions", q]), ...(c.requiredEntities || []).map((q) => ["requiredEntities", q])]) if (/[{}]/.test(String(v ?? ""))) errs.push(`${c.id}.${k} contains an unfilled placeholder: "${v}"`);
    if (c.intent === "local" && !c.location) errs.push(`${c.id} is local but has no location`);
    if (!(c.targetPage === "new" || String(c.targetPage).startsWith("/"))) errs.push(`${c.id}.targetPage "${c.targetPage}" is not a path or "new"`);
    if (!c.queries?.includes(c.primaryQuery)) errs.push(`${c.id}.queries lacks the primary query`);
  }
  const prim = (t.clusters || []).map((c) => c.primaryQuery);
  const cls = t.clusters || [];
  for (let i = 0; i < prim.length; i++) for (let j = i + 1; j < prim.length; j++) if ((cls[i].location ?? null) === (cls[j].location ?? null) && sameQuery(prim[i], prim[j])) errs.push(`cannibalisation: "${prim[i]}" and "${prim[j]}" are the same query (>= 80% token overlap)`);
  return errs;
}

// ---------- the plain-words report ----------
export function reportMd(ctx, S, targets, steps, req, why = {}, unmeasured = []) {
  const b = ctx.business, cl = targets.clusters, f = (x) => (x?.value == null ? "not measured" : Array.isArray(x.value) ? x.value.join(", ") : x.value);
  const tier = cl.filter((c) => c.volume.rank);
  const vol = (x) => (x?.value == null ? "not measured" : typeof x.value === "string" ? `${x.value}, an estimate` : `${x.estimate ? "about " : ""}${x.value}${x.range ? ` (range ${x.range[0]} to ${x.range[1]})` : ""}`);
  const blocked = steps.filter((s) => s.status === "blocked"), failed = steps.filter((s) => s.status === "failed");
  const caps = S.serp?.captures || [];
  const aiRows = S.ai?.rows || [];
  const L = [];
  L.push(`# Research: ${b.name} (${b.domain}), ${iso().slice(0, 10)}`, "");
  L.push(`**Short answer:** ${cl.length} search topics (clusters) found for ${b.name} in ${b.market?.country || ctx.market.country}; ${cl.filter((c) => !/^NOT CAPTURED/.test(c.serpFeatures.source)).length} have a captured results page, ${cl.filter((c) => typeof c.volume.value === "number").length} have a measured demand number${tier.length ? ` and ${tier.length} rest on a free demand-tier estimate (no count)` : ""}, ${blocked.length} of ${steps.length} research steps are BLOCKED${failed.length ? `, ${failed.length} FAILED` : ""}. ${blocked.length ? "Nothing blocked was filled in from memory." : ""}`, "");
  L.push("Words used: a **cluster** is a group of searches that one page should answer (they get mostly the same results). **SERP** means the search results page. **Volume** is how often a search happens in a month; where it is marked an estimate it is a range or a stand-in (Keyword Planner ranges, Bing impressions, our own Search Console impressions), never an exact count. **Captured in browser** means a person looked at the real results page in a browser, at human pace, and saved it.", "");
  L.push("## What ran, and what is blocked", "", "| Step | Result | What it needs |", "|---|---|---|");
  for (const s of steps) L.push(`| ${s.step} | ${s.status.toUpperCase()}${s.note ? `: ${s.note}` : ""} | ${s.unblock || s.error || ""} |`);
  L.push("", "## 1. Demand: what people search (top clusters first)", "", "| # | Primary search | Intent | Place | Volume (source) | Page to target | Priority |", "|---|---|---|---|---|---|---|");
  cl.slice(0, 40).forEach((c, i) => L.push(`| ${i + 1} | ${c.primaryQuery} (+${c.queries.length - 1} variants) | ${c.intent} | ${c.location || "-"} | ${vol(c.volume)} (${String(c.volume.source).slice(0, 70)}) | ${c.targetPage} | ${c.priority} |`));
  if (cl.length > 40) L.push(`| | ... ${cl.length - 40} more in targets.json | | | | | |`);
  if (tier.length) L.push("", `**Clusters resting on a tier estimate, not a measured volume (${tier.length}):** ${tier.slice(0, 15).map((c) => `${c.primaryQuery} (${c.volume.value.slice(0, 2)})`).join("; ")}${tier.length > 15 ? " ..." : ""}. The tier is the Bing autocomplete signal recorded in ${[...new Set(tier.map((c) => path.basename(String(c.volume.cacheFile))))].join(", ")} (dated ${[...new Set(tier.map((c) => c.volume.fetchedAt.slice(0, 10)))].join(", ")}): T1 = people type this phrase, T2 = only related phrases appear, T0 = not tested, so only the results page shows interest. It orders the work; it is not a search count. A measured volume (Search Console, Bing, Keyword Planner) replaces it as soon as one exists.`);
  const sharedCl = cl.filter((c) => c.sharedWith?.length);
  if (sharedCl.length) L.push("", `**Shared with another business: owner decides (${sharedCl.length}).** These clusters come from a keyword-map section that names ${[...new Set(sharedCl.flatMap((c) => c.sharedWith))].join(", ")} as well as ${b.name} (for example "${sharedCl[0].primaryQuery}"). They are marked \`sharedWith\` in targets.json; keep, give to the other business, or drop each: ${sharedCl.slice(0, 12).map((c) => c.primaryQuery).join("; ")}${sharedCl.length > 12 ? " ..." : ""}.`);
  const refSec = (S.existing?.refused || []).filter((r) => r.section);
  if (refSec.length) L.push("", `Not imported (a section that names only another business): ${refSec.map((r) => `"${r.section}" in ${path.basename(r.file)}`).join("; ")}.`);
  if (S.bing?.status === "ok" && Array.isArray(S.bing.droppedOffTopic)) L.push("", `Bing related keywords dropped as off-topic: ${S.bing.droppedOffTopic.length} (see research/bing.json droppedOffTopic)`);
  L.push("", "Priority is computed (demand x intent weight x ease), not measured: transactional and local searches weigh 3, commercial 2, informational 1; ease is 3 when we already rank in the top 20, 2 when a page exists, 1 when it must be built. Use it to order work, not to forecast traffic.", "");
  L.push("## 2. What the results pages look like", "");
  if (!caps.length) L.push("BLOCKED: no captured results pages yet. The main session captures them in the owner's browser (list: research/capture-requests.json).", "");
  else {
    const g = caps.filter((c) => c.engine === "google");
    L.push(`${caps.length} captures (${g.length} Google, ${caps.length - g.length} Bing); ${caps.filter((c) => !c.location.localized).length} are NOT LOCALIZED (the page footer did not show the searched city, so they show what a searcher at the capture machine sees, not in the city). ${g.filter((c) => c.aiOverview.present).length} of ${g.length} Google captures show an AI Overview; ${g.filter((c) => c.features.includes("local_pack")).length} show a map pack. Portals that fill many results pages: ${S.clusters?.portals?.join(", ") || "none detected (needs 4+ captures)"}.`, "");
    L.push("| Search | Winning format | Top 3 (competitors) | Features |", "|---|---|---|---|");
    cl.filter((c) => !/^NOT CAPTURED/.test(c.serpFeatures.source)).slice(0, 25).forEach((c) => L.push(`| ${c.primaryQuery} | ${c.winningFormat} | ${(c.competitorsTop3.length ? c.competitorsTop3.map((x) => x.domain) : why[c.id]?.topDomains || []).join(", ") || "-"} | ${f(c.serpFeatures) || "none"} |`));
    L.push("");
  }
  const dm = S.serp?.deviceMismatch;
  if (dm) L.push(`Captures taken on ${[].concat(dm.captured || []).join(", ")} while rankTracking.devices is ${[].concat(dm.wanted || []).join(", ")}: baseline only, no device claim${dm.count != null ? ` (${dm.count} captures)` : ""}.`, "");
  L.push("## 3. Competitors and authority", "");
  const sites = S.competitors?.sites || [];
  if (S.competitors?.approvedFile) L.push(`Audited: the owner-approved list (${S.competitors.audited.length} websites from ${S.competitors.approvedRows} rows).${S.competitors.withoutDomain?.length ? ` Kept for the report and the offsite plan, not audited (no website): ${S.competitors.withoutDomain.map((x) => x.handle || x.name).join(", ")}.` : ""}${S.competitors.suggested?.length ? ` Suggested from the captured results pages, NOT audited (not on the approved list): ${S.competitors.suggested.join(", ")}.` : ""}`, "");
  if (!sites.length) L.push("BLOCKED: no competitor audit yet.", "");
  else {
    L.push("| Site | Platform | Schema | FAQ items | City pages | Sitemap URLs | AI search bots blocked |", "|---|---|---|---|---|---|---|");
    for (const s of sites) L.push(s.facts ? `| ${s.domain} | ${s.page?.platform || "-"} | ${f(s.facts.schemaTypes)} | ${f(s.facts.faqQuestions)} | ${f(s.facts.cityPages)} | ${f(s.facts.sitemapPages)} | ${f(s.facts.aiSearchBotsBlocked) || "none"} |` : `| ${s.domain} | NOT READ: ${s.error || "?"} | | | | | |`);
    const au = S.competitors?.authority;
    L.push("", au?.domains ? `Authority (Common Crawl web graph ${au.release}, domain level, compare sites with each other, not as absolutes): ${au.domains.map((d) => `${d.domain} ${d.inGraph === false ? "not in graph" : `${f(d.linkingDomains)} linking domains, strength rank ${f(d.strengthRank)}`}`).join("; ")}. Link gap (sites linking to 2+ competitors but not us): ${au.linkGap?.slice(0, 15).map((g) => g.domain).join(", ") || "none"}.` : `Authority: ${au?.status || "not run"}${au?.why ? ` (${au.why})` : ""}.`, "");
  }
  L.push("## 4. Adjacent demand: questions and entities", "");
  const qn = [...new Set(cl.flatMap((c) => c.questions))];
  L.push(qn.length ? `${qn.length} real questions found (People Also Ask in captures, forum threads): ${qn.slice(0, 12).join(" | ")}${qn.length > 12 ? " ..." : ""}` : "No question data yet (needs captures with People Also Ask, or forum access).", "");
  const ent = S.wiki?.entities || [];
  if (ent.length) L.push(`Entities with Wikipedia pageviews: ${ent.map((e) => `${e.title} ${e.article ? f(e.monthlyViews) + " views/month" : "no article"}`).join("; ")}.`, "");
  L.push("## 5. AI answers", "");
  if (!aiRows.length) L.push("BLOCKED: no AI answer data yet (Gemini key, or owner-captured ChatGPT/Perplexity answers).", "");
  else {
    L.push("| Question | Engine | Runs | We are cited in | Others cited (most often) |", "|---|---|---|---|---|");
    aiRows.slice(0, 30).forEach((r) => L.push(`| ${r.question} | ${r.engine} | ${r.runs}${r.lowRuns ? " (few)" : ""} | ${Math.round(r.citedShare.value * 100)}% of runs | ${r.citedSources.slice(0, 5).join(", ") || "-"} |`));
    L.push("", `Cited instead of us, across all rows: ${(S.ai.citedInstead || []).slice(0, 10).map((x) => `${x.domain} (${x.answers})`).join(", ") || "-"}. Answers change run to run, so read the share of runs, not one answer.`, "");
  }
  L.push("## 6. Linkable asset ideas (each with the evidence behind it)", "");
  const ideas = S.assets?.ideas || [];
  if (!ideas.length) L.push("None yet: an idea needs evidence (2+ winning pages offering a tool, 3+ real questions about prices, 2+ about living there, a competitor publishing situation pages, or a link gap of 3+ sites).", "");
  else for (const i of ideas) L.push(`- **${i.title}** (${i.type}, effort ${i.effort}). ${i.why}. Evidence: ${i.evidence.slice(0, 3).map((e) => `${e.ref}: ${e.detail}`).join(" | ")}${i.evidence.length > 3 ? ` (+${i.evidence.length - 3} more in research/assets.json)` : ""}`, "");
  L.push("## 7. Local citation sources (directories to be listed on)", "");
  const cit = S.citations?.sources || [];
  if (!cit.length) L.push("None found yet: needs captured results pages in several searches, or the link graph (authority.json).", "");
  else { L.push("| Site | Why | Searches it appears in | Competitors it links to | Is the business listed? |", "|---|---|---|---|---|"); cit.slice(0, 25).forEach((c) => L.push(`| ${c.domain} | ${c.why} | ${c.searches} | ${c.linkedCompetitors} | ${c.status === "listed" ? "yes: " + c.statusEvidence : "unknown: look it up by hand"} |`)); L.push(""); }
  const wn = S.winners?.clusters || [];
  if (wn.length) L.push(`Winner pages: ${wn.filter((c) => c.wordRange).length} of ${wn.length} top clusters have a word range from audited winners; ${S.winners.pagesFetched} page(s) were fetched this run; the rest came from competitor audits already cached (see research/winners.json for each cluster's basis).`, "");
  L.push("## 8. Still to do", "");
  if (req?.items?.length) L.push(`- Capture ${req.items.length} results pages in the owner's browser (about ${req.estimatedMinutes} minutes at 45 s apart); list in research/capture-requests.json.`);
  if (req?.autocompleteRequests?.length) L.push(`- Capture autocomplete for ${req.autocompleteRequests.length} seed x engine pairs (type the seed, do not press Enter, save the list); list in research/capture-requests.json.`);
  if (req?.aiRequests?.length) L.push(`- Ask ${req.aiRequests.length} questions in ChatGPT and Perplexity (the owner's browser, 3 fresh runs each); list in research/capture-requests.json.`);
  const nDropped = [S.existing, S.seeds, S.clusters].reduce((n, x) => n + (x?.droppedTemplates?.length || 0), 0);
  if (nDropped) L.push(`- ${nDropped} template rows (like "home value {city} ca") had no service-area city to fill, so they were dropped, not written (research/summary.json, droppedTemplates).`);
  if (unmeasured.length) L.push(`- ${unmeasured.length} searches have no demand number from any free source, so they are NOT in targets.json (list: research/unmeasured.json): ${unmeasured.slice(0, 8).map((u) => u.primaryQuery).join("; ")}${unmeasured.length > 8 ? " ..." : ""}. A Keyword Planner export, a Bing key or Search Console would give them a number.`);
  for (const s of blocked) L.push(`- ${s.step}: ${s.unblock}`);
  L.push("", "Every number in targets.json carries its source, date and file. Numbers marked 'not measured' were not available from a free source; they are blank on purpose.");
  return L.join("\n") + "\n";
}

// ---------- the run ----------
export async function run(ctx, o = {}) {
  const b = needBusiness(ctx);
  const steps = [], S = {};
  const step = async (name, fn, note) => {
    try { const r = await fn(); steps.push({ step: name, status: "ok", note: note ? note(r) : "" }); return r; }
    catch (e) {
      if (e instanceof Blocked) { steps.push({ step: name, status: "blocked", unblock: e.unblock }); return null; }
      if (e instanceof RuleMissing) { steps.push({ step: name, status: "blocked", unblock: e.message }); return null; }
      steps.push({ step: name, status: "failed", error: String(e.message || e).slice(0, 300) }); return null;
    }
  };
  const skip = (name, why) => steps.push({ step: name, status: "skipped", note: why });
  const age = o.maxAgeDays ?? 30;

  // 1 reuse what exists
  S.existing = await step("existing research", () => existing.run(ctx, { dirs: o.existingDirs || [], maxAgeDays: age, aliases: o.existingAliases || [] }), (r) => `${r.files.length} files, ${r.keywords.length} keyword rows, ${Object.keys(r.competitorAudits).length} competitor audits`);
  if (!S.existing) { const i = steps.findIndex((s) => s.step === "existing research"); if (steps[i].status === "blocked") steps[i] = { step: "existing research", status: "skipped", note: "nothing to reuse" }; }
  // 2 seeds
  if (o.services?.length || o.patterns?.length || o.queries?.length) S.seeds = await step("seeds", () => seeds.run(ctx, { services: o.services, patterns: o.patterns, raw: o.queries }), (r) => `${r.queries.length} seed queries`);
  else if (readStep(ctx, "seeds")?.status === "ok") { S.seeds = readStep(ctx, "seeds"); skip("seeds", `${S.seeds.queries.length} seed queries from research/seeds.json`); }
  else if (Array.isArray(b.vocabulary) && b.vocabulary.some(Boolean)) S.seeds = await step("seeds", () => seeds.run(ctx, {}), (r) => `${r.queries.length} seed queries proposed from the definition vocabulary (the owner approves them)`);
  else skip("seeds", "none given (--service/--query); other sources may still supply queries");
  if (!o.yes) { const g = seedsApproval(ctx); if (g.needed && !g.ok) throw new NeedsApproval(needsApprovalText(ctx, g)); } // G3: nothing below spends a call on unapproved seeds
  const seedList = (readStep(ctx, "seeds")?.queries || []).map((s) => s.query);
  // 3 demand sources
  S.gsc = await step("Search Console", () => gsc.run(ctx, { property: o.gscProperty }), (r) => `${r.rowCount} rows`);
  S.bing = await step("Bing Webmaster", () => bing.run(ctx, { seeds: seedList.slice(0, 40), related: o.related !== false, keepBrands: !!o.keepBrands, siteStats: true, maxCalls: o.bingMaxCalls ?? 60 }), (r) => `${r.keywords.length} keywords, ${r.calls} calls`);
  S.kwp = await step("Keyword Planner CSV", () => kwp.run(ctx, { files: o.kwpFiles || [] }), (r) => `${r.keywords.length} keywords`);
  if (o.wikiTitles?.length) S.wiki = await step("Wikipedia pageviews", () => wiki.run(ctx, { titles: o.wikiTitles }), (r) => `${r.entities.length} titles`); else skip("Wikipedia pageviews", "no --wiki-title given");
  if (o.forums || o.forumQueries?.length) S.forums = await step("forum questions", () => forums.run(ctx, { queries: o.forumQueries?.length ? o.forumQueries : seedList.slice(0, 6), subreddits: o.subreddits || [] }), (r) => `${r.questions.length} questions${r.stoppedBy ? ", stopped by " + r.stoppedBy : ""}`); else skip("forum questions", "not requested (--forums)");
  // 4 SERP captures
  const seenDir = new Set(), extraDirs = [...(o.captureDirs || []), ...(o.useExistingCaptures ? S.existing?.serpDirs || [] : [])].map((d) => path.resolve(d)).filter((d) => { const k = d.toLowerCase(); if (seenDir.has(k)) return false; seenDir.add(k); return true; }); // the same folder named twice is read once
  S.serp = await step("SERP captures", () => serp.run(ctx, { dirs: extraDirs.length ? [path.join(ctx.pewp, "captures", "serp"), ...extraDirs] : [], defaultDevice: o.device || null, maxAgeDays: age }), (r) => `${r.counts.captures} captures, ${r.counts.rejected} rejected, ${r.counts.stale} stale`);
  // 4b autocomplete suggestions captured by the main session (never fetched by a script)
  if (fs.existsSync(path.join(ctx.pewp, "captures", "autocomplete"))) S.autocomplete = await step("autocomplete suggestions", () => autocomplete.run(ctx, { maxAgeDays: age }), (r) => `${r.rows.length} suggestions for ${r.seeds.length} seeds, ${r.rejected.length} rejected`);
  else skip("autocomplete suggestions", "no captures yet; the seeds to type are in research/capture-requests.json (autocompleteRequests)");
  // 5 clusters
  S.clusters = await step("clusters", () => cluster.run(ctx, { engine: "google", shared: o.shared ?? 4, maxClusters: o.maxClusters ?? 80 }), (r) => `${r.clusters.length} clusters from ${r.universe} queries`);
  // 6 competitors
  if (S.clusters) {
    const approvedFile = o.approvedCompetitors ?? approvedCompetitorsFile(ctx);
    let named = (b.competitors || []).length || (o.competitors || []).length;
    if (approvedFile) { try { named = approvedCompetitorRows(approvedFile).domains.length + (o.competitors || []).length; } catch { named = 1; } } // an unreadable file: let the step report it
    if (named || (o.competitorsFromSerp && S.serp)) S.competitors = await step("competitor audit", () => competitors.run(ctx, { domains: o.competitors || [], approvedFile, fromSerp: !!(o.competitorsFromSerp && S.serp), max: o.maxCompetitors ?? 12, authority: !!o.authority, authorityCache: o.authorityCache, authorityRelease: o.authorityRelease, maxAgeDays: age }), (r) => `${r.sites.length} sites; authority ${r.authority.status}`);
    else skip("competitor audit", "no named competitors; add --from-serp to audit the sites that win the captured results pages (they are listed in the plan first)");
  }
  // 6b winner pages: the pages that already rank (needs --from-serp to fetch; otherwise the competitor audits already cached)
  if (S.clusters && S.serp) S.winners = await step("winner pages", () => winners.run(ctx, { fromSerp: !!o.competitorsFromSerp, maxPages: o.winnerPages ?? 20, perCluster: o.winnersPerCluster ?? 3, topClusters: o.winnerClusters ?? 10 }), (r) => `${r.pagesFetched} page(s) fetched, ${r.clusters.filter((c) => c.wordRange).length} of ${r.clusters.length} clusters with a word range`);
  else skip("winner pages", "needs SERP captures and clusters");
  // 7 AI citations (questions: the biggest non-navigational clusters)
  if (S.clusters) {
    const qs = [...(o.aiQuestions || []), ...S.clusters.clusters.filter((c) => classifyIntent(c.head, { places: allPlaces(ctx, (n) => readStep(ctx, n)) }) !== "navigational").slice(0, o.aiQuestionCount ?? 8).map((c) => c.head)];
    S.ai = await step("AI citations", () => ai.run(ctx, { questions: qs, gemini: !!o.gemini, runs: o.runs ?? 3, maxCalls: o.aiMaxCalls ?? 30, maxAgeDays: 7 }), (r) => `${r.rows.length} rows (gemini ${r.gemini.status})`);
  }
  // 7b what can be derived from everything above (no source needed): linkable-asset ideas and local citation sources
  if (S.clusters) {
    S.assets = await step("linkable-asset ideas", () => assets.run(ctx), (r) => `${r.ideas.length} ideas`);
    S.citations = await step("local citation sources", () => citations.run(ctx), (r) => `${r.sources.length} candidates`);
  }
  // 8 capture requests (what the main session still has to capture), then targets
  const req = captureRequests(ctx, S, o);
  W(path.join(ctx.rdir, "capture-requests.json"), req);
  S.serp = readStep(ctx, "serp"); S.clusters = readStep(ctx, "clusters"); S.competitors = readStep(ctx, "competitors"); S.ai = readStep(ctx, "ai-citations"); S.wiki = readStep(ctx, "wiki"); S.forums = readStep(ctx, "forums"); S.gsc = readStep(ctx, "gsc"); S.winners = readStep(ctx, "winners"); S.assets = readStep(ctx, "assets"); S.citations = readStep(ctx, "citations"); S.autocomplete = readStep(ctx, "autocomplete");
  if (S.clusters?.status !== "ok") { const m = "no query universe, so no clusters: give seeds (--service), connect Search Console / Bing, supply a Keyword Planner CSV, or import captures"; W(path.join(ctx.rdir, "summary.json"), { generatedAt: iso(), steps }); throw new Blocked(m); }
  const built = buildTargets(ctx, { clusters: S.clusters.clusters, captures: S.serp?.status === "ok" ? S.serp.captures : [], portals: S.clusters.portals || [], wikiDoc: S.wiki, forumsDoc: S.forums, gscDoc: S.gsc?.status === "ok" ? S.gsc : null, pages: existingPages(ctx), winnersDoc: S.winners?.status === "ok" ? S.winners : null });
  // The contract (T-004) wants a real number in volume: a search no source has measured is listed, never given a made-up number.
  const clusters = built.filter((c) => c.volume.value != null), unmeasured = built.filter((c) => c.volume.value == null);
  W(path.join(ctx.rdir, "unmeasured.json"), { generatedAt: iso(), why: "no free source gave a volume for these searches (Keyword Planner export, Bing key or Search Console would); they are not in targets.json", searches: unmeasured.map((c) => ({ primaryQuery: c.primaryQuery, queries: c.queries, intent: c.intent, location: c.location, volume: c.volume })) });
  if (!clusters.length) { const m = `none of the ${built.length} searches has a sourced volume, so targets.json is not written (a volume is never invented): export Keyword Planner ideas as CSV (--kwp-file), set BING_WEBMASTER_KEY, or connect Search Console`; W(path.join(ctx.rdir, "summary.json"), { generatedAt: iso(), steps }); W(path.join(ctx.rdir, "report.md"), reportMd(ctx, S, { clusters: [] }, steps, req, {}, unmeasured)); throw new Blocked(m); }
  const targets = { version: 1, business: b.domain, market: b.market, createdAt: iso(), clusters: clusters.map(({ _why, ...c }) => c) };
  const why = Object.fromEntries(clusters.map((c) => [c.id, c._why]));
  const errs = checkTargets(targets);
  const tfile = path.join(ctx.pewp, "targets.json");
  W(tfile, targets);
  const vFile = path.join(HERE, "targets-validate.mjs");
  let validator = "targets-validate.mjs not present (own checks only)";
  if (fs.existsSync(vFile)) {
    const v = spawnSync(process.execPath, [vFile, tfile], { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    const why = v.error ? (v.error.code === "ETIMEDOUT" ? "did not finish in 60 s (killed)" : `could not run (${v.error.code || v.error.message})`) : null; // a killed validator is a failure, never a pass
    validator = why ? `targets-validate.mjs ${why}` : `targets-validate.mjs exit ${v.status}`;
    if (why || v.status !== 0) errs.push(`targets-validate.mjs: ${why || `${v.stdout || ""}${v.stderr || ""}`.trim().slice(0, 400)}`);
  }
  W(path.join(ctx.rdir, "report.md"), reportMd(ctx, S, targets, steps, req, why, unmeasured));
  W(path.join(ctx.rdir, "summary.json"), { generatedAt: iso(), steps, clusterWhy: why, unmeasured: unmeasured.length, sharedClusters: clusters.filter((c) => c.sharedWith?.length).map((c) => ({ primaryQuery: c.primaryQuery, sharedWith: c.sharedWith })), refusedSections: (S.existing?.refused || []).filter((r) => r.section), droppedTemplates: [...(S.existing?.droppedTemplates || []), ...(S.seeds?.droppedTemplates || []), ...(S.clusters?.droppedTemplates || [])], tierEstimateClusters: clusters.filter((c) => c.volume.rank).map((c) => c.primaryQuery), checks: { own: errs, validator } });
  if (errs.length) { console.error(`targets.json FAILED its checks:\n- ${errs.join("\n- ")}`); return { status: "invalid", errs, steps }; }
  markStage(ctx.loc, "research", { "targets.json": tfile, "report.md": path.join(ctx.rdir, "report.md") }, { partial: steps.some((s) => s.status === "blocked"), blocked: steps.filter((s) => s.status === "blocked").map((s) => s.step) });
  return { status: "ok", targets: tfile, report: path.join(ctx.rdir, "report.md"), clusters: targets.clusters.length, steps, validator, requests: req.items.length };
}

export function captureRequests(ctx, S, o) {
  const b = ctx.business, places = allPlaces(ctx, (n) => readStep(ctx, n)), age = o.maxAgeDays ?? 30;
  const devices = b.rankTracking?.devices?.length ? b.rankTracking.devices : ["mobile"];
  const caps = (readStep(ctx, "serp")?.captures || []);
  const universe = readStep(ctx, "clusters")?.status === "ok" ? readStep(ctx, "clusters").clusters.map((c) => c.head) : (readStep(ctx, "seeds")?.queries || []).map((s) => s.query);
  const items = [];
  for (const q of universe) for (const engine of ["google", "bing"]) for (const device of devices) {
    const have = caps.find((c) => normQuery(c.query) === normQuery(q) && c.engine === engine && c.device === device && ageDays(c.capturedAt) <= age && c.status !== "BLOCKED");
    if (have) continue;
    items.push({ query: q, engine, device, location: placeInQuery(q, places)?.label || b.rankTracking?.locations?.[0] || null, language: b.market.language });
  }
  const cap = o.maxRequests ?? 60;
  const aiQs = (readStep(ctx, "clusters")?.clusters || []).slice(0, o.aiQuestionCount ?? 8).map((c) => c.head);
  const haveAi = new Set((readStep(ctx, "ai-citations")?.rows || []).filter((r) => /chatgpt|perplexity/.test(r.engine)).map((r) => `${r.engine}|${normQuery(r.question)}`));
  const aiRequests = aiQs.flatMap((q) => ["chatgpt", "perplexity"].filter((e) => !haveAi.has(`${e}|${normQuery(q)}`)).map((e) => ({ question: q, engine: e, runs: 3, fresh: "new chat, memory off" })));
  const ac = readStep(ctx, "autocomplete"), covered = new Set((ac?.rows || []).filter((r) => !r.stale).map((r) => `${r.engine}|${r.seed}`));
  const autocompleteRequests = (readStep(ctx, "clusters")?.clusters || []).slice(0, 20).map((c) => c.head).flatMap((q) => ["google", "bing"].filter((e) => !covered.has(`${e}|${normQuery(q)}`)).map((e) => ({ seed: q, engine: e, location: placeInQuery(q, places)?.label || b.rankTracking?.locations?.[0] || null, language: b.market.language, how: "type the seed slowly into the search box, do not press Enter, save the suggestion list", saveAs: `captures/autocomplete/<id>.${e}.json` })));
  return { generatedAt: iso(), autocompleteRequests, rules: "one page at a time, at least 45 s apart, stop at the first robot check, never sign in or accept terms, record date/browser/location/device in each file", saveAs: "<pewp>/captures/serp/<id>.<engine>.json and <pewp>/captures/ai/<id>.json (formats in stages/research.md)", paceSeconds: 45, count: items.length, items: items.slice(0, cap), truncated: Math.max(0, items.length - cap), estimatedMinutes: Math.ceil((Math.min(items.length, cap) * 45) / 60), aiRequests };
}

export const approvedCompetitorsFile = (ctx) => { const f = path.join(ctx.pewp, "approved", "competitors.json"); return fs.existsSync(f) ? f : null; };
export function plannedCompetitors(ctx, o) {
  const approvedFile = o.approvedCompetitors ?? approvedCompetitorsFile(ctx);
  if (approvedFile) { try { return [...new Set([...approvedCompetitorRows(approvedFile).domains, ...(o.competitors || [])])]; } catch { return [...(o.competitors || [])]; } } // the approved list is audited whole (--max-competitors does not cut it)
  const named = [...(o.competitors || []), ...(ctx.business.competitors || [])];
  return [...new Set(o.competitorsFromSerp ? competitors.pickCompetitors(ctx, { max: o.maxCompetitors ?? 12, extra: named }) : named)].slice(0, o.maxCompetitors ?? 12);
}

export function planText(ctx, o) {
  const b = ctx.business;
  const seedN = (o.services?.length || (Array.isArray(b.vocabulary) ? b.vocabulary.filter(Boolean).length : 0)) * Math.max(1, knownPlaces(b).length) * (o.patterns?.length || 2) + (o.queries?.length || 0) + (readStep(ctx, "seeds")?.queries?.length || 0);
  const calls = { "Search Console": 3, "Bing Webmaster": Math.min(o.bingMaxCalls ?? 60, seedN * (o.related === false ? 1 : 2) || 0) + 1, Wikipedia: o.wikiTitles?.length || 0, Reddit: o.forums || o.forumQueries?.length ? 12 : 0, "competitor sites (1 request/s each, ~14 requests)": plannedCompetitors(ctx, o).length * 14, "winner pages (robots + page each)": o.competitorsFromSerp ? (winners.plannedWinnerUrls(ctx, { perCluster: o.winnersPerCluster ?? 3, topClusters: o.winnerClusters ?? 10, maxPages: o.winnerPages ?? 20 })?.length ?? 0) * 2 : 0, "Gemini grounded runs": o.gemini ? (o.aiMaxCalls ?? 30) : 0 };
  const total = Object.values(calls).reduce((s, n) => s + n, 0);
  const text = [`PLAN research ${ctx.loc.target}`, `  stages: existing research, seeds, Search Console, Bing, Keyword Planner CSV, Wikipedia, forums, SERP capture import, autocomplete import, clusters, competitor audit${o.authority ? " + authority (disk, 15-30 min)" : ""}, winner pages, AI citations, asset ideas, citation sources, targets + report`,
    ...(o.competitorsFromSerp ? [`  winner pages to audit (--from-serp, robots first, 1 request/s per site, hard page budget ${o.winnerPages ?? 20}): ${(winners.plannedWinnerUrls(ctx, { perCluster: o.winnersPerCluster ?? 3, topClusters: o.winnerClusters ?? 10, maxPages: o.winnerPages ?? 20 }) || []).join(", ") || "(listed once the captures are imported and clustered)"}`] : []),
    `  seeds: ${(() => { const g = seedsApproval(ctx); return g.needed ? `${g.count} in research/seeds.json, ${g.ok ? "owner-approved" : "NOT approved (the demand steps need approved/seeds.json or --yes)"}` : "none written yet"; })()}`,
    "  workers: 0 (scripts only; the main session captures results pages and AI answers in the owner's browser)", `  external calls, upper bound: ${Object.entries(calls).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "none"} (total ${total}); model tokens: none for the scripts`, "  cost in money: $0 (free sources only)", `  competitor sites to audit (robots.txt first, 1 request/s, stop at the first 403/429): ${plannedCompetitors(ctx, o).join(", ") || "none"}`].join("\n");
  return { text, total };
}

await runCli(import.meta.url, "node research.mjs <url | repo path> [--dry] [--yes] [options: see the top of the file]", ["dry", "yes", "forums", "authority", "gemini", "use-existing-captures", "from-serp", "no-related", "keep-brands"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  needBusiness(ctx);
  const o = {
    yes: a.has("yes"), related: !a.has("no-related"), keepBrands: a.has("keep-brands"), approvedCompetitors: a.get("approved-competitors") || undefined,
    services: a.all("service"), patterns: a.all("pattern"), queries: a.all("query"), gscProperty: a.get("gsc-property"), kwpFiles: a.all("kwp-file"), bingMaxCalls: a.num("bing-max-calls", 60), wikiTitles: a.all("wiki-title"),
    forums: a.has("forums"), forumQueries: a.all("forum-query"), subreddits: a.all("subreddit"), captureDirs: a.all("capture-dir"), device: a.get("device"), useExistingCaptures: a.has("use-existing-captures"),
    competitors: a.all("competitor"), competitorsFromSerp: a.has("from-serp"), winnerPages: a.num("winner-pages", 20), winnersPerCluster: a.num("winner-per-cluster", 3), winnerClusters: a.num("winner-clusters", 10), existingAliases: a.all("existing-alias"), maxCompetitors: a.num("max-competitors", 12), authority: a.has("authority"), authorityCache: a.get("authority-cache"), authorityRelease: a.get("authority-release"),
    gemini: a.has("gemini"), runs: a.num("runs", 3), aiQuestionCount: a.num("ai-questions", 8), aiMaxCalls: a.num("ai-max-calls", 30), aiQuestions: a.all("question"), existingDirs: a.all("existing-dir").map((d) => path.resolve(d)), maxAgeDays: a.num("max-age-days", 30), maxClusters: a.num("max-clusters", 80), shared: a.num("shared", 4), maxRequests: a.num("max-requests", 60),
  };
  const plan = planText(ctx, o);
  console.log(plan.text);
  if (a.has("dry")) return "DRY RUN: nothing fetched.";
  if (plan.total > a.num("confirm-above", 150) && !a.has("yes")) throw new Blocked(`the plan is ${plan.total} external calls, above ${a.num("confirm-above", 150)}: the owner approves it, then re-run with --yes`);
  let r;
  try { r = await run(ctx, o); } catch (e) { if (e instanceof NeedsApproval) { console.log(e.text); process.exitCode = 3; return; } throw e; }
  for (const s of r.steps) console.log(`  ${s.status.toUpperCase().padEnd(8)} ${s.step}${s.note ? ": " + s.note : ""}${s.unblock ? "\n           BLOCKED: " + s.unblock : ""}${s.error ? "\n           ERROR: " + s.error : ""}`);
  if (r.status !== "ok") { process.exitCode = 1; return; } // exitCode, not process.exit(): see research-lib.mjs runCli
  if (r.steps.some((s) => s.status === "failed")) { console.log(`PARTIAL: ${r.steps.filter((s) => s.status === "failed").length} step(s) FAILED (see above); targets written from what ran`); }
  console.log(`DONE ${r.clusters} clusters -> ${r.targets}\n     report ${r.report}\n     ${r.requests} results pages still to capture (research/capture-requests.json); ${r.validator}`);
  if (r.steps.some((s) => s.status === "failed")) process.exitCode = 1;
});
