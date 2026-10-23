// S7 iterate (shipgate 06 stage "Iterate", §9.4 value/impact/effort, §9.8 significance): from the last two measure runs, the research
// run and the APPROVED targets and plan, write PROPOSALS only. Nothing under approved/ is ever changed; the proposals need approve.mjs again.
// Usage: node iterate.mjs <target> [--cwd DIR] [--pewp DIR] [--today YYYY-MM-DD] [--runs d1,d2] [--min-impressions 50] [--from-working]
// Reads : <pewp>/approved/targets.json (+ approved/plan/, lock checked) or, with --from-working, targets.json;
//         <pewp>/measure/<date>/{rankings,citations}.json (the contract pair) and, when present, report.json, diff.json, gsc.json, crux.json;
//         <pewp>/business.json (brand, places).
// Writes: <pewp>/proposals/targets.json            approved targets + re-prioritised clusters + new clusters (validates as targets.json)
//         <pewp>/proposals/plan/deltas.json        page changes and new pages, each with its reason, evidence and significance rule
//         <pewp>/proposals/plan/priorities.json    actions in 06 §9.4 order (impact band, effort S first, cluster value)
//         <pewp>/proposals/plan/briefs-delta/*.md  what to change in each brief (for the builder or an agent drafting prose)
//         <pewp>/iterate/report.md + report.json   plain words, one-line answer first
// Significance (§9.8, the only reason a change is raised): a position moved >= 3 places (both windows >= minImpressions when the rows
// carry impressions); an AI citation count differs by >= 2 of the samples; a Core Web Vitals status got worse. Smaller is noise: counted, not raised.
// Exit 0 proposals written, 1 the approved files fail their lock, 2 cannot judge (nothing approved / no measure run).
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { locate, markStage } from "./state.mjs";
import { resolveInputs, sha256 } from "./approve.mjs";
import { validate } from "./targets-validate.mjs";
import { tokens, slugify } from "./lib-text.mjs";
import { normPath } from "./lib-site.mjs";
import { knownPlaces, classifyIntent, placeInQuery } from "./research-lib.mjs";
import { fact } from "./cache.mjs";
import { isDay, stripBom } from "./measure-sources.mjs";

const jr = (p, d = null) => { try { return JSON.parse(stripBom(fs.readFileSync(p, "utf8"))); } catch { return d; } };
const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const words = (s) => ` ${norm(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
const containsWords = (hay, needle) => words(needle).trim() !== "" && words(hay).includes(words(needle));
const tset = (s) => [...new Set(tokens(s))].sort().join(" ");
const BAND = { H: 3, M: 2, L: 1 }, EFFORT = { S: 3, M: 2, L: 1 };

// ----- §9.4 -----
const volMid = (v) => {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.length === 2) return (v[0] + v[1]) / 2;
  const m = String(v ?? "").match(/([\d.]+)\s*([km]?)\s*[-–to ]+\s*([\d.]+)\s*([km]?)/i);
  const k = (x, s) => Number(x) * ({ k: 1e3, m: 1e6 }[s.toLowerCase()] || 1);
  return m ? (k(m[1], m[2]) + k(m[3], m[4])) / 2 : 0;
};
export function clusterValue(c) { return volMid(c.volume?.value) * Math.max(typeof c.value?.value === "number" ? c.value.value : 0, 0.1); }
export const winnability = (c) => 1 - (typeof c.difficulty?.value === "number" ? c.difficulty.value : 50) / 100;
export function bands(clusters) { // tertiles across the run: H top third, M middle, L bottom
  const sc = clusters.map((c) => clusterValue(c) * winnability(c)), sorted = [...sc].sort((a, b) => a - b), n = sc.length;
  const hi = sorted[Math.floor((n * 2) / 3)], lo = sorted[Math.floor(n / 3)];
  return new Map(clusters.map((c, i) => [c.id, sc[i] >= hi ? "H" : sc[i] >= lo ? "M" : "L"]));
}

export function run(opts) {
  const log = opts.log || console.log;
  const pewp = opts.pewp;
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const inp = resolveInputs(pewp);
  if (inp.lock.exists && !inp.lock.ok) { log(`FAIL iterate: the approved files changed after approval (${inp.lock.problems.length} problem(s)); proposals would build on unsigned content`); for (const p of inp.lock.problems) log(`  ${p}`); return 1; }
  if (!inp.approved.targets && !opts.fromWorking) { log("ERROR iterate cannot judge: no approved targets (BLOCKED). Approve them first: node approve.mjs <target> targets --by \"<owner>\" (or pass --from-working to iterate on the unsigned working file, labelled so in the report)"); return 2; }
  const targets = jr(inp.targetsFile);
  if (!targets) { log(`ERROR iterate cannot judge: ${inp.targetsFile} not found or not JSON`); return 2; }
  const vt = validate(targets);
  if (!vt.ok) { log(`FAIL iterate: ${inp.targetsFile} is not valid targets.json (${vt.errors.length} error(s)); fix it first`); return 1; }
  const approvedTree = treeHash(path.join(pewp, "approved"));
  const business = jr(path.join(pewp, "business.json")) || {};
  const sitemap = jr(path.join(inp.planRoot, "plan", "sitemap.json"));
  const mroot = path.join(pewp, "measure");
  const all = fs.existsSync(mroot) ? fs.readdirSync(mroot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(mroot, d, "rankings.json"))).sort() : [];
  const picked = opts.runs ? opts.runs : all.slice(-2);
  if (!picked.length || picked.some((d) => !all.includes(d))) { log(`ERROR iterate cannot judge: no measure run to read (BLOCKED). Run measure.mjs first${opts.runs ? ` (asked for ${opts.runs.join(", ")}; found ${all.join(", ") || "none"})` : ""}`); return 2; }
  const load = (d) => {
    const dir = path.join(mroot, d);
    return { date: d, rankings: jr(path.join(dir, "rankings.json"))?.rankings || [], citations: jr(path.join(dir, "citations.json"))?.citations || [], report: jr(path.join(dir, "report.json")), diff: jr(path.join(dir, "diff.json")), gsc: jr(path.join(dir, "gsc.json")), crux: jr(path.join(dir, "crux.json")) };
  };
  const cur = load(picked[picked.length - 1]), prev = picked.length > 1 ? load(picked[picked.length - 2]) : null;
  const TH = { positionDelta: 3, aiSampleDelta: 2, ...(jr(path.join(mroot, "config.json"))?.thresholds || {}) };
  const MI = opts.minImpressions ?? TH.minImpressions ?? 50;

  // ----- cluster lookup -----
  const clusters = targets.clusters;
  const pageOf = (c) => sitemap?.pages.find((p) => p.cluster === c.id)?.path || (c.targetPage !== "new" ? normPath(c.targetPage) : null);
  const cq = new Map(clusters.map((c) => [c.id, new Set([c.primaryQuery, ...(c.queries || [])].map(norm))]));
  const cqs = new Map(clusters.map((c) => [c.id, new Set((c.questions || []).map(norm))]));
  const clusterOfQuery = (q) => clusters.filter((c) => cq.get(c.id).has(norm(q)));
  const clusterOfQuestion = (q) => clusters.filter((c) => cqs.get(c.id).has(norm(q)));
  const reasons = new Map(clusters.map((c) => [c.id, []]));
  const noise = { positions: 0, citations: 0, cwv: 0, notComparable: 0 };
  const gained = [];

  // ----- rankings: lost positions, no impressions -----
  const rkey = (r) => [norm(r.query), norm(r.location), r.device, norm(r.language), r.engine, r.position?.source || ""].join("|");
  if (prev) {
    const pm = new Map(prev.rankings.map((r) => [rkey(r), r]));
    const aboveBy = new Map((cur.diff?.rankChanges || []).map((x) => [norm(x.query) + "|" + x.device, x.above]));
    const persist = new Map();
    for (const r of cur.rankings) {
      const cs = clusterOfQuery(r.query);
      if (!cs.length) continue;
      const o = pm.get(rkey(r));
      if (!o) { noise.notComparable++; continue; }
      const from = o.position?.value ?? null, to = r.position?.value ?? null;
      const impOk = !(typeof o.impressions === "number" && typeof r.impressions === "number") || (o.impressions >= MI && r.impressions >= MI);
      for (const c of cs) {
        const ev = { query: r.query, location: r.location, device: r.device, language: r.language, engine: r.engine, from, to, impressions: typeof r.impressions === "number" ? { previous: o.impressions, current: r.impressions } : "not in this row (browser capture or contract row)", measured: { from: prev.date, to: cur.date }, domainsAbove: aboveBy.get(norm(r.query) + "|" + r.device) || null };
        if (from != null && to != null) {
          const delta = to - from;
          if (delta >= TH.positionDelta && impOk) reasons.get(c.id).push({ kind: "lost-positions", rule: "MSR-002", significance: `06 9.8: position moved ${delta} places (>= ${TH.positionDelta})${typeof r.impressions === "number" ? ` with >= ${MI} impressions in both windows` : ""}`, evidence: { ...ev, delta } });
          else if (delta <= -TH.positionDelta && impOk) gained.push({ cluster: c.id, ...ev, delta });
          else if (delta !== 0) noise.positions++;
        } else if (from != null && to == null && impOk) reasons.get(c.id).push({ kind: "lost-positions", rule: "MSR-002", significance: "06 9.8: ranked before, no position now (dropped out of the tracked range)", evidence: { ...ev, dropped: true } });
        else if (from == null && to == null) { const p = persist.get(c.id) || { rows: 0, ev: [] }; p.rows++; p.ev.push(ev); persist.set(c.id, p); }
        else if (from == null && to != null) gained.push({ cluster: c.id, ...ev, entered: true });
        if (to != null) { const p = persist.get(c.id) || { rows: 0, ev: [] }; p.hasValue = true; persist.set(c.id, p); }
      }
    }
    for (const [id, p] of persist) if (p.rows && !p.hasValue) reasons.get(id).push({ kind: "no-impressions", rule: "MSR-002", significance: `no position for any of its queries in both runs (${prev.date} and ${cur.date}): no impressions in the window`, evidence: { rowsChecked: p.rows, queries: [...new Set(p.ev.map((e) => e.query))], measured: { from: prev.date, to: cur.date } } });
  }

  // ----- AI citations: a drop of >= 2 of the samples -----
  const ckey = (r) => [norm(r.question), r.engine, norm(r.location)].join("|");
  const countOf = (r) => Math.round((r.citedShare?.value ?? 0) * (r.runs || 1));
  if (prev) {
    const pm = new Map(prev.citations.map((r) => [ckey(r), r]));
    for (const r of cur.citations) {
      const o = pm.get(ckey(r)); if (!o) continue;
      const cs = clusterOfQuestion(r.question); if (!cs.length) continue;
      const drop = o.runs === r.runs ? countOf(o) - countOf(r) : (o.citedShare.value - r.citedShare.value) * Math.max(o.runs, r.runs);
      if (drop >= TH.aiSampleDelta) {
        const lost = (o.citedSources || []).filter((s) => !(r.citedSources || []).includes(s));
        const instead = (r.citedSources || []).filter((s) => !(o.citedSources || []).includes(s));
        for (const c of cs) reasons.get(c.id).push({ kind: "citation-dropped", rule: "MSR-005", significance: `06 9.8: cited in ${countOf(o)} of ${o.runs} answers, now ${countOf(r)} of ${r.runs} (differs by >= ${TH.aiSampleDelta})`, evidence: { question: r.question, engine: r.engine, model: r.model, from: o.citedShare.value, to: r.citedShare.value, runs: { previous: o.runs, current: r.runs }, lostSources: lost, citedInstead: instead, measured: { from: prev.date, to: cur.date } } });
      } else if (countOf(o) !== countOf(r)) noise.citations++;
    }
  }

  // ----- Core Web Vitals: a status that got worse -----
  const ORDER = { good: 0, "needs improvement": 1, poor: 2 };
  let cwv = [];
  if (prev?.crux?.results && cur.crux?.results) {
    const pm = new Map(prev.crux.results.filter((r) => !r.noFieldData).map((r) => [r.target + "|" + r.formFactor, r]));
    for (const r of cur.crux.results.filter((x) => !x.noFieldData)) { const o = pm.get(r.target + "|" + r.formFactor); if (!o) continue; for (const [m, v] of Object.entries(r.metrics || {})) { const ov = o.metrics?.[m]; if (ov && ov.status !== v.status) cwv.push({ target: r.target, metric: m, from: ov.status, to: v.status, worse: ORDER[v.status] > ORDER[ov.status] }); } }
  } else if (cur.diff?.cruxChanges) cwv = cur.diff.cruxChanges;
  const siteWide = [];
  for (const ch of cwv) {
    if (!ch.worse) { noise.cwv++; continue; }
    let p = null, origin = false;
    try { const u = new URL(ch.target); p = normPath(u.pathname); origin = p === "/"; } catch { origin = true; }
    const hit = clusters.filter((c) => pageOf(c) && pageOf(c) === p);
    for (const c of hit) reasons.get(c.id).push({ kind: "cwv-worse", rule: "MSR-006", significance: "06 9.8: the 75th-percentile status changed", evidence: { ...ch, page: p, measured: { from: prev?.date, to: cur.date } } });
    if (origin || !hit.length) siteWide.push(ch);
  }

  // ----- new clusters from Search Console queries nobody planned (MSR-003) -----
  const brand = tokens(business.name || "");
  const places = knownPlaces(business);
  let queryRows = [], queryNote = null, fetchedAt = null;
  if (cur.gsc?.status === "ok" && cur.gsc.tables?.current?.query) { queryRows = cur.gsc.tables.current.query.map((r) => ({ query: r.keys[0], impressions: r.impressions, clicks: r.clicks, position: r.position })); fetchedAt = cur.gsc.fetchedAt; }
  else if (cur.report?.findings) { queryRows = cur.report.findings.filter((f) => f.rule === "MSR-003").map((f) => ({ query: (f.title.match(/"(.+)"/) || [])[1], impressions: f.evidence?.impressions?.value, clicks: f.evidence?.clicks?.value, position: f.evidence?.position?.value })).filter((r) => r.query); fetchedAt = cur.report.generatedAt; queryNote = "from report.json findings MSR-003 (gsc.json not present)"; }
  else queryNote = "no Search Console query table in the latest run (BLOCKED: connect Search Console, then run measure.mjs)";
  const planned = clusters.flatMap((c) => [c.primaryQuery, ...(c.queries || [])]);
  const skipped = { belowImpressions: 0, branded: 0, alreadyPlanned: 0 };
  const groups = new Map();
  for (const r of queryRows.sort((a, b) => (b.impressions || 0) - (a.impressions || 0) || String(a.query).localeCompare(String(b.query)))) {
    if (!(r.impressions >= MI)) { skipped.belowImpressions++; continue; }
    if (brand.length && brand.every((t) => new Set(tokens(r.query)).has(t))) { skipped.branded++; continue; }
    if (planned.some((q) => containsWords(r.query, q))) { skipped.alreadyPlanned++; continue; }
    const k = tset(r.query);
    if (groups.has(k)) groups.get(k).variants.push(r.query); else groups.set(k, { ...r, variants: [] });
  }
  const used = new Set(clusters.map((c) => c.id)), usedPaths = new Set(clusters.map((c) => pageOf(c)).filter(Boolean));
  const stamp = fetchedAt && !Number.isNaN(Date.parse(fetchedAt)) ? fetchedAt : `${cur.date}T00:00:00Z`;
  const newClusters = [], newPages = [];
  for (const g of groups.values()) {
    let intent = classifyIntent(g.query, { places, brand: [norm(business.name || "")] }), place = placeInQuery(g.query, places);
    if (intent === "local" && !place) intent = "commercial";
    const id = `c-${slugify(g.query)}`;
    if (used.has(id)) continue;
    used.add(id);
    let pth = `${intent === "informational" ? "/guides" : ""}/${slugify(g.query)}/`; while (usedPaths.has(pth)) pth = pth.replace(/\/$/, "") + "-2/"; usedPaths.add(pth);
    const c = {
      id, primaryQuery: g.query, queries: [g.query, ...g.variants], intent, location: intent === "local" ? place.label : null,
      volume: fact(g.impressions, "Google Search Console, last 28 days: impressions of this query (not a search volume)", stamp, null, { estimate: true, method: "impressions in the 28-day window, a floor for demand" }),
      difficulty: null, value: null,
      serpFeatures: fact([], "NOT CAPTURED: no results page captured for this query yet; the empty list means UNKNOWN", stamp, null),
      winningFormat: "unknown (needs a SERP capture)", competitorsTop3: [], requiredEntities: [], questions: [], targetPage: "new", priority: 0,
    };
    newClusters.push(c);
    newPages.push({ cluster: id, path: pth, intent, impressions: g.impressions, clicks: g.clicks ?? null, position: g.position ?? null, variants: g.variants,
      note: "Proposed from Search Console demand alone. Cluster by shared results (06 9.1) and capture the results page before building; approve the targets, then run plan-site.mjs for the full brief." });
  }

  // ----- actions (§9.4) -----
  const all2 = [...clusters, ...newClusters];
  const band = bands(all2);
  const ACT = {
    "lost-positions": { effort: "M", kind: "page-change", title: "Win back lost positions", what: (r) => [`Compare the page with the results now above it${r.evidence.domainsAbove?.length ? ` (${r.evidence.domainsAbove.slice(0, 5).join(", ")})` : " (capture the results page to see who is above)"}: depth, sections, entities, proof`, `Re-run the research capture for "${r.evidence.query}" and refresh winningFormat, requiredEntities and questions in targets`, "Update the page's last-reviewed date with the content change"] },
    "no-impressions": { effort: "S", kind: "page-change", title: "Get the page seen at all", what: () => ["Make title, H1 and first paragraph carry the primary query (gate GT-004)", "Add at least 2 internal links in from related pages with descriptive anchors (gate GT-006)", "Confirm the page is indexable, in the sitemap and indexed (URL Inspection, MSR-001)"] },
    "citation-dropped": { effort: "M", kind: "page-change", title: "Win back AI citations", what: (r) => [`Open the page with an answer-first block that answers "${r.evidence.question}" in its first two sentences`, "Add a citable, dated figure with its source", `Mark the question up (FAQ schema) and show it as a heading${r.evidence.citedInstead?.length ? `; look at what ${r.evidence.citedInstead.slice(0, 3).join(", ")} publish` : ""}`] },
    "cwv-worse": { effort: "S", kind: "finding", title: "Fix field speed", what: (r) => [`Bring ${String(r.evidence.metric).toUpperCase()} on ${r.evidence.page || "the site"} back from "${r.evidence.to}" to "${r.evidence.from}" (find the cause with the lab run), then re-check`] },
  };
  const items = [], pageChanges = [];
  for (const c of clusters) {
    const rs = reasons.get(c.id); if (!rs.length) continue;
    const page = pageOf(c);
    const changes = rs.map((r) => ({ kind: r.kind, rule: r.rule, effort: ACT[r.kind].effort, title: ACT[r.kind].title, what: ACT[r.kind].what(r), significance: r.significance, evidence: r.evidence }));
    pageChanges.push({ path: page, cluster: c.id, primaryQuery: c.primaryQuery, changes });
    for (const ch of changes) items.push({ id: `act-${c.id}-${ch.kind}`, kind: ACT[ch.kind].kind, ref: page || c.id, cluster: c.id, impact: band.get(c.id), effort: ch.effort, value: Math.round(clusterValue(c)), proof: `${ch.rule}: ${ch.significance}` });
  }
  for (const n of newClusters) items.push({ id: `act-${n.id}-new-page`, kind: "new-page", ref: newPages.find((p) => p.cluster === n.id).path, cluster: n.id, impact: band.get(n.id), effort: "M", value: Math.round(clusterValue(n)), proof: `MSR-003: ${n.volume.value} impressions in 28 days, no planned page` });
  for (const ch of siteWide) items.push({ id: `act-site-cwv-${ch.metric}`, kind: "finding", ref: "site", cluster: null, impact: "L", effort: "S", value: 0, proof: `MSR-006: ${ch.metric} ${ch.from} -> ${ch.to}` });
  const order = [...items].sort((a, b) => BAND[b.impact] - BAND[a.impact] || EFFORT[b.effort] - EFFORT[a.effort] || b.value - a.value || a.id.localeCompare(b.id)).map((x, i) => ({ rank: i + 1, ...x }));

  // cluster priority on the §9.4 scale: band*100 + effort*10 + value digit (best effort of its actions, M when it has none)
  const maxVal = Math.max(1, ...all2.map(clusterValue));
  const best = new Map();
  for (const it of items) if (it.cluster) best.set(it.cluster, Math.max(best.get(it.cluster) || 0, EFFORT[it.effort]));
  const newPriority = (c) => BAND[band.get(c.id)] * 100 + (best.get(c.id) || EFFORT.M) * 10 + Math.min(9, Math.floor((9 * clusterValue(c)) / maxVal));
  const outClusters = all2.map((c) => ({ ...c, priority: newPriority(c) })).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const lockT = inp.lock.lock?.targets;
  const proposed = { ...targets, iteration: { parentSha256: sha256(fs.readFileSync(inp.targetsFile)), ranAt: today, measureRuns: picked, researchRun: lockT?.researchRun || targets.researchRun || null, basedOn: inp.approved.targets ? "approved/targets.json" : "targets.json (NOT approved)", rule: "06 9.4 priority = band*100 + effort*10 + value digit; 06 9.8 significance", tool: "iterate.mjs" }, clusters: outClusters };
  const vp = validate(proposed);
  if (!vp.ok) { log(`FAIL iterate: the proposal does not validate (a bug): ${vp.errors.slice(0, 3).map((e) => e.rule + " " + e.path + " " + e.message).join("; ")}`); return 1; }

  // ----- write proposals -----
  const W = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o, null, 1) + "\n"); };
  const PROP = path.join(pewp, "proposals");
  fs.rmSync(path.join(PROP, "plan"), { recursive: true, force: true });
  W(path.join(PROP, "targets.json"), proposed);
  W(path.join(PROP, "plan", "deltas.json"), { version: 1, generatedAt: today, basedOn: { targetsSha256: proposed.iteration.parentSha256, plan: sitemap ? (inp.approved.plan ? "approved/plan" : "plan (NOT approved)") : "none" }, measureRuns: picked, pageChanges, newPages, siteWide: siteWide.map((c) => ({ ...c, action: "fix field speed site-wide" })), ignoredAsNoise: noise, note: "Deltas, not a full plan. Approve the proposed targets, run plan-site.mjs for the full plan, apply these changes to the briefs, then approve the plan." });
  W(path.join(PROP, "plan", "priorities.json"), { version: 1, generatedAt: today, rule: "06 9.4: impact band (tertiles of value x winnability), then effort (S first), then cluster value", items: order });
  const slugOf = (p) => (p === "/" ? "home" : slugify(p));
  for (const pc of pageChanges) if (pc.path) W(path.join(PROP, "plan", "briefs-delta", `${slugOf(pc.path)}.md`), [`# Brief changes: ${pc.path} (cluster ${pc.cluster}, "${pc.primaryQuery}")`, "", `> Proposed by iterate.mjs on ${today} from measure runs ${picked.join(" and ")}. Not applied; approve first.`, "", ...pc.changes.flatMap((c) => [`## ${c.title} (effort ${c.effort}, ${c.rule})`, `Why: ${c.significance}`, ...c.what.map((w) => `- ${w}`), ""])].join("\n"));
  for (const np of newPages) W(path.join(PROP, "plan", "briefs-delta", `${slugOf(np.path)}.md`), [`# NEW PAGE: ${np.path} (cluster ${np.cluster}, "${newClusters.find((c) => c.id === np.cluster).primaryQuery}")`, "", `> ${np.note}`, "", `- ${np.impressions} impressions in the last 28 days${np.position != null ? `, average position ${Number(np.position).toFixed(1)}` : ""}`, `- Suggested intent: ${np.intent} (a guess from the wording; confirm with the results page)`, ""].join("\n"));

  // ----- report -----
  const nU = pageChanges.length, nN = newClusters.length;
  const L = [`# Iterate ${today}: ${nU} cluster${nU === 1 ? "" : "s"} underperform${nU === 1 ? "s" : ""}, ${nN} new cluster${nN === 1 ? "" : "s"} proposed, ${order.length} action${order.length === 1 ? "" : "s"} ranked; nothing in approved/ changed`, ""];
  L.push(`Compared ${prev ? `measure runs ${prev.date} and ${cur.date}` : `only one measure run (${cur.date}): no change can be judged yet, only unplanned demand`}, against ${inp.approved.targets ? `the approved targets (signed by ${lockT?.approvedBy || "unknown"} on ${String(lockT?.approvedAt || "").slice(0, 10)})` : "the UNAPPROVED working targets"}. ${inp.approved.targets ? "" : "Approve them before acting on this. "}These are proposals: they take effect only after the owner approves them (approve.mjs).`, "");
  L.push("A change is only raised when it is big enough not to be chance (06 9.8): a result position moving 3 or more places, an AI answer citing us in 2 or more fewer of the samples, or a Core Web Vitals status getting worse. Smaller moves are counted and ignored.", "");
  L.push("## Clusters that underperform", "");
  if (!pageChanges.length) L.push(prev ? "None. No cluster lost ground by the rules above." : "Not judged: needs two measure runs.", "");
  for (const pc of pageChanges) { L.push(`### ${pc.primaryQuery} (${pc.cluster}, page ${pc.path || "not built"}, impact ${band.get(pc.cluster)})`); for (const c of pc.changes) { L.push(`- **${c.title}** (effort ${c.effort}, ${c.rule}). Why: ${c.significance}.`); L.push(`  Evidence: ${evidenceLine(c)}`); for (const w of c.what) L.push(`  - ${w}`); } L.push(""); }
  if (siteWide.length) L.push("### Site-wide field speed", "", ...siteWide.map((c) => `- ${String(c.metric).toUpperCase()} on ${c.target}: ${c.from} -> ${c.to} (MSR-006).`), "");
  L.push("## New clusters from Search Console demand nobody planned", "");
  if (queryNote) L.push(`Source note: ${queryNote}.`, "");
  if (!newClusters.length) L.push(`None above ${MI} impressions that no cluster already covers. (Skipped: ${skipped.belowImpressions} under ${MI} impressions, ${skipped.branded} brand searches, ${skipped.alreadyPlanned} already planned.)`, "");
  for (const n of newClusters) { const np = newPages.find((p) => p.cluster === n.id); L.push(`- "${n.primaryQuery}": ${np.impressions} impressions in 28 days${np.position != null ? `, average position ${Number(np.position).toFixed(1)}` : ""} -> proposed page ${np.path} (intent ${n.intent}${n.location ? ", " + n.location : ""}). The wording-based intent is a guess; capture the results page before building.`); }
  if (newClusters.length) L.push("");
  if (gained.length) L.push("## Gains (not acted on)", "", ...gained.slice(0, 10).map((g) => `- "${g.query}" ${g.entered ? "entered the results" : `moved up ${-g.delta} places`} (${g.from ?? "none"} -> ${g.to}).`), "");
  L.push("## Actions in order (06 9.4: impact, then effort with small first, then value)", "", "| # | Action | Impact | Effort | Evidence |", "|---|---|---|---|---|", ...order.slice(0, 20).map((x) => `| ${x.rank} | ${x.kind} ${x.ref} | ${x.impact} | ${x.effort} | ${x.proof} |`), "");
  L.push("## Ignored as noise", "", `${noise.positions} position change(s) under 3 places or on too few impressions, ${noise.citations} citation change(s) under 2 samples, ${noise.cwv} speed status change(s) that were not worse, ${noise.notComparable} ranking(s) measured in a different place, device or language than the last run (never compared).`, "");
  L.push("## To act on this", "", "1. Read this report and the proposals in `proposals/`.", "2. If the owner agrees: `node approve.mjs <target> targets --from proposals --by \"<owner>\"`, then `node plan-site.mjs <pewp>`, apply `proposals/plan/briefs-delta/` to the briefs, then `node approve.mjs <target> plan --by \"<owner>\"`.", "3. Rebuild, run the gate (`gate.mjs`), and the next `measure.mjs` run shows whether it worked.", "");
  L.push("## Words used", "", "- cluster: the group of searches one page should win.", "- impressions: how often a page was shown in search results.", "- position: the average place in the results, 1 is the top.", "- Core Web Vitals: Google's measures of how fast and stable a page feels to real visitors.", "");
  W(path.join(pewp, "iterate", "report.md"), L.join("\n"));
  W(path.join(pewp, "iterate", "report.json"), { generatedAt: today, measureRuns: picked, approvedTargets: inp.approved.targets, underperforming: pageChanges.map((p) => ({ cluster: p.cluster, path: p.path, reasons: p.changes.map((c) => ({ kind: c.kind, rule: c.rule, significance: c.significance, evidence: c.evidence })) })), newClusters: newClusters.map((n) => n.id), actions: order.length, ignoredAsNoise: noise, skippedQueries: skipped });

  if (treeHash(path.join(pewp, "approved")) !== approvedTree) { log("FAIL iterate: approved/ changed during the run (a bug; iterate must never touch approved files)"); return 1; }
  // the stage marker is bookkeeping: the proposals stand without it, but a failure to write it is said, not swallowed
  try { if (fs.existsSync(path.join(pewp, "state.json"))) markStage(locate(path.dirname(pewp)), "iterate", { proposals: "proposals/targets.json", report: "iterate/report.md" }); } catch (e) { log(`NOTE iterate: the stage marker in state.json was not updated (${e.message}); the proposals are written`); }
  log(`PASS iterate ${nU} underperforming cluster(s), ${nN} new cluster(s), ${order.length} action(s); proposals in ${PROP}, report ${path.join(pewp, "iterate", "report.md")}; approved/ unchanged`);
  return 0;
}
function evidenceLine(c) {
  const e = c.evidence;
  if (c.kind === "lost-positions" || c.kind === "no-impressions") return e.query ? `"${e.query}" (${e.device}, ${e.location}): ${e.from ?? "none"} -> ${e.to ?? "none"}` : `${e.rowsChecked} tracked row(s) with no position: ${e.queries.join(", ")}`;
  if (c.kind === "citation-dropped") return `"${e.question}" (${e.engine}): ${e.from} -> ${e.to} of answers cite us${e.citedInstead?.length ? `; cited instead: ${e.citedInstead.join(", ")}` : ""}`;
  return `${e.metric} ${e.from} -> ${e.to} on ${e.page || e.target}`;
}
function treeHash(dir) {
  if (!fs.existsSync(dir)) return "none";
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(dir, p) + ":" + sha256(fs.readFileSync(p))); } };
  walk(dir);
  return sha256(out.sort().join("\n"));
}

function main() {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const pos = a.filter((x, i) => !x.startsWith("--") && !["--cwd", "--pewp", "--today", "--runs", "--min-impressions"].includes(a[i - 1]));
  const usage = "usage: node iterate.mjs <target> [--cwd DIR] [--pewp DIR] [--today YYYY-MM-DD] [--runs d1,d2] [--min-impressions 50] [--from-working]";
  if (!opt("--pewp") && !pos.length) { console.error(usage); process.exit(2); }
  // a typo must not run as something else: "--min-impressions abc" was NaN, so every query was skipped and every position change
  // read as noise (a silent "nothing underperforms"); a bad --today was written into every proposal
  const mi = opt("--min-impressions");
  if (a.includes("--min-impressions") && !(mi != null && mi !== "" && Number.isFinite(Number(mi)) && Number(mi) >= 0)) { console.error(`--min-impressions must be a number of at least 0 (got ${mi})\n${usage}`); process.exit(2); }
  if (a.includes("--today") && !isDay(opt("--today"))) { console.error(`--today must be a real day as YYYY-MM-DD (got ${opt("--today")})\n${usage}`); process.exit(2); }
  if (a.includes("--runs") && !(opt("--runs") || "").split(",").every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) { console.error(`--runs must be one or two measure dates, YYYY-MM-DD,YYYY-MM-DD (got ${opt("--runs")})\n${usage}`); process.exit(2); }
  const pewp = opt("--pewp") ? path.resolve(opt("--pewp")) : locate(pos[0], { cwd: opt("--cwd") || process.cwd() }).pewp;
  process.exit(run({ pewp, today: opt("--today"), runs: opt("--runs") ? opt("--runs").split(",") : null, minImpressions: mi != null ? Number(mi) : null, fromWorking: a.includes("--from-working") }));
}
if (isMain(import.meta.url)) main();
