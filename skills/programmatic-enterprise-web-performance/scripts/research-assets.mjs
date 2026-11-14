// Linkable-asset ideas: things worth building because other sites link to or cite them. Every idea is derived from EVIDENCE already in the
// research files and lists that evidence; a rule with too little evidence produces no idea. Nothing is invented from general knowledge.
//   tool      the captured winning pages already offer a calculator / estimator / quiz (>= 2 sites)         -> build a better local one
//   data      >= 3 real questions about prices, costs, rates, market numbers (results-page questions, forums, question bank) -> a local numbers page
//   guide     >= 2 real questions about living there / neighbourhoods / schools / safety                     -> a local guide per service-area city
//   situation >= 1 audited competitor publishes situation pages (probate, divorce, relocation ...)            -> a guide set for those situations
//   outreach  >= 3 sites link to 2+ competitors but not to us (authority.json link gap)                       -> a short list of link targets
// Usage: node research-assets.mjs <target> [--cwd DIR]    Output: research/assets.json { ideas:[{id, type, title, why, evidence[], relatedQueries[], effort}] }
import fs from "node:fs";
import path from "node:path";
import { J, iso, context, needBusiness, runCli, readStep, writeStep, normQuery, allPlaces, placeInQuery } from "./research-lib.mjs";

export const MIN = { toolSites: 2, dataQuestions: 3, guideQuestions: 2, linkGap: 3 };
const GAP_CUT = 100; // authority.mjs cuts linkGap at 100 entries; linkGapTotal (written with it) is the count before the cut
const TOOL = /\b(calculator|estimator|net sheet|worksheet|quiz|checker|analy[sz]er)\b/i;
const MONEYQ = /(price|cost|how much|median|average|market|rate|commission|%|worth|value|fee|afford)/i;
const LIFEQ = /(good place to live|safe|neighbou?rhood|cost of living|moving to|wealthy|school|best area|what is .* like|commute|crime|expensive to live)/i;

export function deriveIdeas({ captures = [], questions = [], competitors = [], linkGap = [], places = [], ownDomain }) {
  const ideas = [];
  // tool
  const byWord = new Map();
  for (const c of captures) for (const o of c.organic || []) { const m = `${o.title || ""} ${o.url || ""}`.match(TOOL); if (m && o.domain !== ownDomain) { const w = m[1].toLowerCase(); (byWord.get(w) || byWord.set(w, []).get(w)).push({ kind: "serp-result", ref: `${c.engine}: "${c.query}" #${o.position}`, detail: `${o.domain} ${o.title || o.url || ""}`.trim().slice(0, 140), domain: o.domain }); } }
  for (const [w, ev] of byWord) if (new Set(ev.map((e) => e.domain)).size >= MIN.toolSites) ideas.push({ id: `a-tool-${w.replace(/\W+/g, "-")}`, type: "tool", title: `A free local ${w} on the site`, why: `${ev.length} captured winning results from ${new Set(ev.map((e) => e.domain)).size} sites already offer a ${w}; a tool earns links because people share and cite it`, evidence: ev.slice(0, 8).map(({ domain, ...e }) => e), relatedQueries: [...new Set(ev.map((e) => e.ref.match(/"(.*?)"/)?.[1]))].slice(0, 6), effort: "medium" });
  // data / guide questions
  const qs = new Map(); for (const q of questions) { const k = normQuery(q.question); if (k && !qs.has(k)) qs.set(k, q); }
  const money = [...qs.values()].filter((q) => MONEYQ.test(q.question)), life = [...qs.values()].filter((q) => LIFEQ.test(q.question));
  const ev = (list) => list.slice(0, 8).map((q) => ({ kind: "question", ref: q.seenAt || q.source || "question", detail: q.question.slice(0, 140) }));
  const cities = [...new Set([...qs.values()].map((q) => placeInQuery(q.question, places)?.city).filter(Boolean))];
  if (money.length >= MIN.dataQuestions) ideas.push({ id: "a-data-local-numbers", type: "data", title: "A local market-numbers page per city (prices, costs, rates), updated on a schedule", why: `${money.length} real questions ask for numbers; a page that states them with a date and a source is what gets cited and linked`, evidence: ev(money), relatedQueries: money.slice(0, 6).map((q) => normQuery(q.question)), cities, effort: "medium" });
  if (life.length >= MIN.guideQuestions) ideas.push({ id: "a-guide-living-in", type: "guide", title: "A 'living in <city>' guide for each service-area city", why: `${life.length} real questions are about what a place is like; a first-hand local guide answers them and attracts local links`, evidence: ev(life), relatedQueries: life.slice(0, 6).map((q) => normQuery(q.question)), cities, effort: "medium" });
  // competitors publishing situation pages
  const sit = competitors.filter((s) => (s.sitemap?.byKind?.situation || 0) >= 1).map((s) => ({ kind: "competitor-audit", ref: s.domain, detail: `${s.sitemap.byKind.situation} situation page(s) in its sitemap/home links` }));
  if (sit.length >= 1) ideas.push({ id: "a-guide-situations", type: "guide", title: "A guide set for life situations (probate, divorce, relocation, inherited homes ...)", why: `${sit.length} audited competitor(s) already publish situation pages; the guides are linkable by lawyers, planners and local groups`, evidence: sit, relatedQueries: [], effort: "high" });
  // outreach
  if (linkGap.length >= MIN.linkGap) ideas.push({ id: "a-outreach-link-gap", type: "outreach", title: "Earn links from sites that already link to two or more competitors but not to us", why: `${linkGap.length} sites in the Common Crawl link graph link to 2+ competitors and not to us`, evidence: linkGap.slice(0, 12).map((g) => ({ kind: "link-gap", ref: g.domain, detail: `links to ${g.linksToCompetitors} competitors${g.harmonicPos ? `, strength rank ${g.harmonicPos}` : ""}` })), relatedQueries: [], effort: "high" });
  return ideas;
}

export async function run(ctx) {
  const b = needBusiness(ctx);
  const read = (n) => readStep(ctx, n), serp = read("serp"), places = allPlaces(ctx, read);
  const auth = J(path.join(ctx.pewp, "authority.json"));
  const gapN = Number.isInteger(auth?.linkGapTotal) ? auth.linkGapTotal : auth?.linkGap?.length || 0;
  const questions = [
    ...(serp?.captures || []).flatMap((c) => (c.paa || []).map((q) => ({ question: q, seenAt: `${c.engine} PAA for "${c.query}" (${c.file ? path.basename(c.file) : ""})` }))),
    ...(read("forums")?.questions || []).map((q) => ({ question: q.question, seenAt: q.seenAt })),
    ...(read("existing")?.questions || []).map((q) => ({ question: q.question, seenAt: `${path.basename(q.imported.file)} line ${q.imported.line}` })),
  ];
  const ideas = deriveIdeas({ captures: serp?.status === "ok" ? serp.captures : [], questions, competitors: [...Object.values(read("existing")?.competitorAudits || {}), ...(read("competitors")?.sites || [])].filter((s) => s.sitemap), linkGap: auth?.linkGap || [], places, ownDomain: b.domain });
  return writeStep(ctx, "assets", { thresholds: MIN, inputs: { captures: serp?.captures?.length || 0, questions: questions.length, linkGap: gapN, linkGapText: !Number.isInteger(auth?.linkGapTotal) && gapN === GAP_CUT ? `at least ${GAP_CUT} (list cut at ${GAP_CUT})` : String(gapN) }, ideas });
}

await runCli(import.meta.url, "node research-assets.mjs <target> [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx);
  return `OK assets: ${r.ideas.length} ideas (${r.ideas.map((i) => i.type).join(", ") || "none: not enough evidence"}) from ${r.inputs.captures} captures, ${r.inputs.questions} questions, ${r.inputs.linkGapText} link-gap sites -> ${path.join(ctx.rdir, "assets.json")}`;
});
void fs; void iso;
