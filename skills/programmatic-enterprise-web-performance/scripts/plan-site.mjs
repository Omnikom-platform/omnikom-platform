// S3 plan: from <pewp>/targets.json (+ business.json) build <pewp>/plan/ : sitemap.json (one cluster = one page, hubs and
// spokes, slugs, internal-link plan with anchors), briefs/<slug>.md (the builder's spec; the S5 gate tests the built page
// against it), programmatic.json (data source + numeric quality gate), offsite.json (links, local, AI visibility),
// priorities.json (impact / effort, quick wins first), summary.md. Deterministic, no network, no model.
// Usage: node plan-site.mjs <pewp dir> [--today YYYY-MM-DD] [--authority <authority.json>] [--citations <citations.json>]
//        [--hub-min 4] [--home-max-links 40] [--prog-min-words 1000] [--prog-min-unique 600] [--prog-min-facts 5]
//        [--prog-max-similarity 0.4] [--data-source "<text>"]
// Exit 0 written, 1 targets.json / business.json invalid (nothing written), 2 cannot judge (file missing).
// Ported from this project's own specs (Francine & Eli): icm/work/seo-analyst/CODE-NEEDS-SEO.md (§1 page types, §2 schema per
// page type, §5 internal-linking rules, §6 content templates and the city-page floor), icm/knowledge/market/must-have.md
// (M-01..M-13), icm/phase-1/protocols/p1.2-site-plan (one target keyword per page, title <=60, description <=160).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, validateBusiness } from "./targets-validate.mjs";
import { tokens, overlap, slugify, titleCase, STOP } from "./lib-text.mjs";
import { normPath } from "./lib-site.mjs";
import { loadIndustry, RULES_DIR } from "./lib-plan.mjs";
import { compatibleTypes } from "./lib-growth.mjs";
import * as state from "./state.mjs";

const args = process.argv.slice(2);
const opt = (k, d = null) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const pos = args.filter((x, i) => !x.startsWith("--") && !String(args[i - 1] || "").startsWith("--"));
const OPTS = {
  today: opt("--today", new Date().toISOString().slice(0, 10)), hubMin: +opt("--hub-min", 4), homeMax: +opt("--home-max-links", 40),
  progMinWords: +opt("--prog-min-words", 1000), progMinUnique: +opt("--prog-min-unique", 600), progMinFacts: +opt("--prog-min-facts", 5),
  progMaxSim: +opt("--prog-max-similarity", 0.4), dataSource: opt("--data-source"),
};
const noBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s); // a UTF-8 BOM (PowerShell 5.1, Notepad) is not a JSON error
const j = (f) => JSON.parse(noBom(fs.readFileSync(f, "utf8")));
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const trunc = (s, n) => (s.length <= n ? s : s.slice(0, n + 1).replace(/\s+\S*$/, "").replace(/[\s,;:|-]+$/, ""));

// ---- the page kinds and their outlines (CODE-NEEDS-SEO §1, §6) ----

function kindOf(c, p) {
  if (p === "/") return "home";
  if (c.location && /city|area|location|neighbou?rhood|local/i.test(c.winningFormat)) return "city-landing";
  if (c.intent === "informational" || /guide|blog|article|how-to|question/i.test(c.winningFormat)) return "guide";
  return "money";
}
function prettyQuery(c) {
  const q = c.primaryQuery.trim().toLowerCase().replace(/\s+/g, " ");
  if (c.location) {
    const city = c.location.split(",")[0].trim().toLowerCase();
    for (const loc of [c.location.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim(), city]) {
      const i = q.indexOf(loc);
      if (i >= 0) { const head = (q.slice(0, i) + " " + q.slice(i + loc.length)).replace(/\s+/g, " ").trim(); if (head) return `${titleCase(head)} in ${loc === city ? c.location.split(",")[0].trim() : c.location}`; }
    }
  }
  return titleCase(q) + (/^(how|what|why|when|where|which|who|is|are|can|do|does|should|will)\b/.test(q) ? "?" : "");
}
function outlineFor(kind, ctx) {
  const { brand, City } = ctx;
  const faq = ctx.questions.length ? ["Frequently asked questions"] : [];
  switch (kind) {
    case "home": return ["Who we are", "How we help", "Areas we serve", ...faq, `Talk to ${brand}`];
    case "city-landing": return [`Why work with ${brand} in ${City}`, `How we help in ${City}`, `${City} market and neighbourhood facts`, "What it costs", ...faq, `Talk to ${brand}`];
    case "guide": return ["The short answer", "What changes the answer", "Step by step", "Common mistakes", ...faq, "Next step"];
    case "hub": return ["Where we work", "How we choose what to cover"];
    default: return ["How it works", "What you get", "Proof: reviews and results", ...faq, "Get started"];
  }
}
function schemaFor(kind, nQuestions, bizKind) {
  const packed = industry?.pageTypes?.find((t) => t.plannerKind === kind)?.schema; // an industry pack names the schema of each page kind it knows
  if (packed) return [...packed.filter((t) => t !== "FAQPage"), ...(nQuestions >= 2 && kind !== "home" && kind !== "hub" ? ["FAQPage"] : [])]; // like the built-in choice: no FAQPage on the home or a hub page
  const biz = bizKind === "real-estate-agent" ? "RealEstateAgent" : "LocalBusiness";
  const faq = nQuestions >= 2 ? ["FAQPage"] : [];
  switch (kind) {
    case "home": return [biz, "WebSite"];
    case "city-landing": return [bizKind === "real-estate-agent" ? "WebPage" : "Service", ...faq];
    case "guide": return ["Article", ...faq];
    case "hub": return ["WebPage"];
    default: return ["Service", ...faq];
  }
}
const DEFAULT_WORDS = { home: [600, 1200], "city-landing": [1000, 1800], guide: [900, 2200], money: [700, 1400], hub: [250, 800] };
const CTA = { leads: "Get a free consultation", calls: "Call us", bookings: "Book a time", sales: "Get a quote" };

// ---- load and validate ----
if (!pos[0]) { console.error("usage: node plan-site.mjs <pewp dir> [options]"); process.exit(2); }
const pewp = path.resolve(pos[0]);
let targets, business;
try { targets = j(path.join(pewp, "targets.json")); business = j(path.join(pewp, "business.json")); } catch (e) { console.log(`ERROR plan cannot judge: ${e.code === "ENOENT" ? "targets.json or business.json not found in " + pewp : e.message}`); process.exit(2); }
const vt = validate(targets), vb = validateBusiness(business);
if (!vt.ok || !vb.ok) {
  console.log(`FAIL plan targets.json / business.json invalid, nothing written (${vt.errors.length + vb.errors.length} error(s); run targets-validate.mjs)`);
  for (const e of [...vt.errors, ...vb.errors].slice(0, 10)) console.log(`  ${e.rule} ${e.path}: ${e.message}`);
  process.exit(1);
}
let industry = null;
if (business.industry) { try { industry = loadIndustry(business.industry); } catch (e) { console.log(`ERROR plan cannot judge: ${e.message}`); process.exit(2); } }

// ---- pages ----
const brand = business.name;
// A "near me" query has no place, and a "location" that is the business's own name is not a place: the page is local by intent only.
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const effLocation = (c) => (!c.location || /\b(near me|nearby|close to me)\b/i.test(c.primaryQuery) || normName(c.location) === normName(business.name) ? null : c.location);
const clusters = targets.clusters.map((c) => ({ ...c, location: effLocation(c) }));
const usedPaths = new Set();
const uniquePath = (p) => { let x = p, n = 2; while (usedPaths.has(x)) x = p.replace(/\/$/, "") + `-${n++}/`; usedPaths.add(x); return x; };
let pages = clusters.map((c) => {
  const kind0 = c.targetPage === "new" ? null : kindOf(c, normPath(c.targetPage));
  const kind = kind0 || kindOf(c, "?");
  const p = c.targetPage === "new" ? uniquePath(`${kind === "guide" ? "/guides" : ""}/${slugify(c.primaryQuery)}/`) : uniquePath(normPath(c.targetPage));
  return { cluster: c, path: p, kind: p === "/" ? "home" : kind, isNew: c.targetPage === "new" };
});
let home = pages.find((x) => x.path === "/");
if (!home) { usedPaths.add("/"); home = { cluster: null, path: "/", kind: "home", isNew: false, role: "home" }; pages.unshift(home); } else home.role = "home";
const cityPages = pages.filter((x) => x.kind === "city-landing");
let hub = null;
if (cityPages.length >= OPTS.hubMin) { hub = { cluster: null, path: uniquePath("/areas-we-serve/"), kind: "hub", isNew: true, role: "hub" }; pages.push(hub); }
const byPath = new Map(pages.map((x) => [x.path, x]));

// hubs and spokes: a cluster whose words are a strict subset of another's is that page's spoke; city pages go under the areas hub
const qset = (x) => new Set(tokens(x.cluster.primaryQuery));
for (const pg of pages) {
  if (pg === home || pg === hub) continue;
  let parent = null, best = 0;
  for (const o of pages) {
    if (o === pg || !o.cluster || o === home) continue;
    const a = qset(pg), b = qset(o);
    if (b.size >= 2 && b.size < a.size && [...b].every((t) => a.has(t)) && b.size > best) { parent = o; best = b.size; }
  }
  pg.parent = parent ? parent.path : pg.kind === "city-landing" && hub ? hub.path : "/";
}
if (hub) hub.parent = "/";
home.parent = null;
for (const pg of pages) pg.role = pg === home ? "home" : pg === hub ? "hub" : pages.some((o) => o.parent === pg.path) ? "hub" : pg.cluster ? "spoke" : "support";
const children = (p) => pages.filter((x) => x.parent === p.path).map((x) => x.path);

// ---- titles, descriptions, outline, schema ----
const bizCta = (kind) => (kind === "guide" ? "Ask us a question" : CTA[business.goals[0]] || "Contact us");
const progGroupOf = (pg) => (pg.kind === "city-landing" && cityPages.length >= 2 ? "g-city" : null);
for (const pg of pages) {
  const c = pg.cluster;
  const City = c?.location ? c.location.split(",")[0].trim() : (business.locations[0]?.serviceArea[0] || business.locations[0]?.name || "your area");
  const pretty = c ? prettyQuery(c) : pg.kind === "hub" ? "Areas We Serve" : brand;
  pg.pretty = pretty;
  const headForTitle = pretty;
  const hasBrand = (x) => normName(x).includes(normName(brand));
  let title = hasBrand(headForTitle) ? headForTitle : `${headForTitle} | ${brand}`; // never append the brand to a title that already carries it
  if (!c && pg.kind === "home" && !business.offer.toLowerCase().includes(brand.toLowerCase()) && `${brand} | ${titleCase(business.offer)}`.length <= 60) title = `${brand} | ${titleCase(business.offer)}`;
  if (title.length > 60 && !hasBrand(headForTitle)) title = headForTitle;
  if (title.length > 60) title = trunc(title, 60);
  pg.title = title;
  pg.h1 = pretty;
  const lead = hasBrand(pretty) ? "" : `${pretty}: `;
  const bodies = (withOffer) => ({
    "city-landing": `${lead}${brand} helps ${business.audience}${withOffer ? " with " + business.offer : ""}. ${bizCta(pg.kind)}.`,
    home: `${lead}${brand} helps ${business.audience}${withOffer ? " with " + business.offer : ""}. ${bizCta(pg.kind)}.`,
    guide: `${pretty}${/[?.!]$/.test(pretty) ? "" : "."} The plain answer, what changes it and the next step, from ${brand}.`,
    money: `${pretty}: how it works, what you get and what to do next with ${brand}. ${bizCta(pg.kind)}.`,
    hub: `Every area ${brand} works in, with a local page for each. ${bizCta(pg.kind)}.`,
  })[pg.kind];
  let body = bodies(true);
  if (body.length > 155) body = bodies(false);
  if (body.length > 155) { const cut = body.slice(0, 156).match(/^(.*[.?!])\s/); body = cut && cut[1].length >= 90 ? cut[1] : trunc(body, 155); }
  pg.metaDescription = body;
  pg.questions = c?.questions || [];
  pg.outline = outlineFor(pg.kind, { brand, City, questions: pg.questions });
  pg.schema = schemaFor(pg.kind, pg.questions.length, business.kind);
  pg.programmatic = progGroupOf(pg);
  const wr = c?.wordRange?.value;
  pg.wordRange = wr ? { min: wr[0], max: wr[1], source: `${c.wordRange.source} (${c.wordRange.fetchedAt.slice(0, 10)})` } : { min: DEFAULT_WORDS[pg.kind][0], max: DEFAULT_WORDS[pg.kind][1], source: "default for this page kind (no SERP depth data in targets.json); " + (pg.kind === "city-landing" ? "CODE-NEEDS-SEO §6 floor about 1,000 words of non-template text" : "adjust when SERP depth is measured") };
  pg.cta = bizCta(pg.kind) + (business.goals.includes("calls") && pg.kind !== "guide" ? " or call {{PHONE}}" : "");
  pg.slug = pg.path === "/" ? "home" : slugify(pg.path);
}

// ---- internal-link plan (CODE-NEEDS-SEO §5) ----
const linkKey = new Set(), links = [];
const stateTok = new Set(["ca", "tx", "fl", "ny", "wa", "or", "az", "nv", "co", "ut"]);
const locTokens = (pg) => new Set(pg.cluster?.location ? tokens(pg.cluster.location) : []);
const contentTokens = (pg) => new Set(tokens(pg.cluster?.primaryQuery || "").filter((t) => !locTokens(pg).has(t) && !stateTok.has(t)));
function anchorFor(from, to) {
  if (!to.cluster) return to.pretty.toLowerCase();
  const prim = to.cluster.primaryQuery;
  const cands = [prim, ...to.cluster.queries.filter((q) => q !== prim)].filter((q) => overlap(prim, q) > 0);
  return cands[hash(from.path) % cands.length].toLowerCase();
}
function addLink(from, to, type) {
  if (from === to) return;
  const k = from.path + ">" + to.path;
  if (linkKey.has(k)) return;
  linkKey.add(k); links.push({ from: from.path, to: to.path, anchor: anchorFor(from, to), type });
}
const byPrio = (a, b) => (b.cluster?.priority ?? 0) - (a.cluster?.priority ?? 0) || a.path.localeCompare(b.path);
const others = pages.filter((x) => x !== home).sort(byPrio);
const homeTargets = others.length <= OPTS.homeMax ? others : [...others.filter((x) => x.role === "hub"), ...others.filter((x) => x.role !== "hub")].slice(0, OPTS.homeMax);
for (const t of homeTargets) addLink(home, t, "home");
for (const pg of pages) if (pg.parent) { addLink(byPath.get(pg.parent), pg, "down"); addLink(pg, byPath.get(pg.parent), "up"); }
for (const pg of pages) { // siblings of one kind under one parent: next and previous by priority
  if (!pg.cluster) continue;
  const sib = pages.filter((x) => x !== pg && x.cluster && x.parent === pg.parent && x.kind === pg.kind).sort(byPrio);
  for (const s of sib.slice(0, 2)) addLink(pg, s, "sibling");
}
for (const pg of pages.filter((x) => x.kind === "guide")) { // a guide links to the one money page it supports
  const mine = contentTokens(pg);
  const best = pages.filter((x) => x.cluster && x !== pg && x.kind !== "guide" && x !== home).map((x) => ({ x, n: [...contentTokens(x)].filter((t) => mine.has(t)).length })).filter((e) => e.n >= 1).sort((a, b) => b.n - a.n || byPrio(a.x, b.x))[0];
  addLink(pg, best ? best.x : home, "supports");
}
for (const pg of pages.filter((x) => x.cluster && x !== home)) { // cross-links on shared words (city <-> situation, guide <-> guide), at most 2
  const mine = contentTokens(pg);
  const cand = pages.filter((x) => x.cluster && x !== pg && x !== home && !linkKey.has(pg.path + ">" + x.path)).map((x) => ({ x, n: [...contentTokens(x)].filter((t) => mine.has(t)).length })).filter((e) => e.n >= 1).sort((a, b) => b.n - a.n || byPrio(a.x, b.x)).slice(0, 2);
  for (const e of cand) addLink(pg, e.x, "cross");
}
const outOf = (p) => links.filter((l) => l.from === p.path), inTo = (p) => links.filter((l) => l.to === p.path);

// ---- briefs ----
const proofFor = (pg) => {
  const out = ["First-party reviews: count, average rating and 2-3 real, attributable quotes, each with source and date (no invented testimonials)"];
  if (pg.kind === "city-landing") out.push(`Local market facts for ${pg.cluster.location.split(",")[0]}: each with source and date (median price, days on market, neighbourhoods); no fact without a source`);
  if (pg.kind === "guide") out.push("Every figure or rule quoted names its authority and date (state law, trade-body survey, official statistics)");
  if (pg.kind === "home" || pg.kind === "money") out.push("Years in business, deals closed or people helped, only with a verifiable source");
  if (industry) out.push(...industry.items.filter((i) => i.proofHint).map((i) => i.proofHint));
  return out;
};
const sections = (pg) => pg.outline.filter((h) => !/^(frequently asked questions|talk to|next step|get started)/i.test(h));
function briefMd(pg) {
  const c = pg.cluster, L = [];
  L.push(`# Brief: ${pg.h1}`, "", `> Written by plan-site.mjs on ${OPTS.today} from targets.json${c ? ` (cluster ${c.id})` : " (support page)"}. The S5 gate tests the built page against this file.`, "");
  L.push(`- Page: ${pg.path}`, `- Cluster: ${c ? c.id : "none"}`, `- Role: ${pg.role}${pg.parent ? ` (parent ${pg.parent})` : ""}`, `- Kind: ${pg.kind}`);
  L.push(`- Primary query: ${c ? c.primaryQuery : "none (support page)"}`, `- Intent: ${c ? c.intent : "navigational"}`, `- Location: ${c?.location || "none"}`);
  L.push(`- Title: ${pg.title}`, `- H1: ${pg.h1}`, `- Meta description: ${pg.metaDescription}`, `- Schema: ${pg.schema.join(", ")}`);
  L.push(`- Word range: ${pg.wordRange.min}-${pg.wordRange.max} (${pg.wordRange.source})`, `- CTA: ${pg.cta}`);
  // 03 section 22.2 / 06 section 9.3: the page types that fit this intent (the S5 gate, GT-012, judges the built page's type against them); every planned page has a CTA.
  L.push(`- Page types that fit: ${compatibleTypes(c ? c.intent : "navigational", { cta: true }).join(", ")}`);
  L.push(`- Programmatic: ${pg.programmatic ? "group " + pg.programmatic : "no"}`, `- New page: ${pg.isNew ? "yes" : "no, keep the URL"}`, "");
  L.push("## Outline", ...pg.outline.map((h) => `- H2: ${h}`), "");
  const sec = sections(pg);
  // 06 section 9.5: the terms that recur in the headings, list items and bold text of the winning pages; the S5 gate (GT-005) warns when the page covers fewer than 60%.
  if (c?.requiredTerms?.length) L.push("## Required terms", ...c.requiredTerms.map((t) => `- ${t}`), "");
  L.push("## Entities to cover", ...(c?.requiredEntities.length ? c.requiredEntities.map((e, i) => `- ${e} (in: ${sec[i % Math.max(sec.length, 1)] || pg.outline[0]})`) : ["- (none required)"]).filter((x) => x !== "- (none required)"), "");
  L.push("## Questions to answer", ...pg.questions.map((q) => `- ${q}`), "");
  L.push("## Proof and statistics to include", ...proofFor(pg).map((x) => `- ${x}`), "");
  L.push("## Links out", ...outOf(pg).map((l) => `- ${l.to} | anchor: "${l.anchor}"`), "");
  L.push("## Links in", ...inTo(pg).map((l) => `- ${l.from} | anchor: "${l.anchor}"`), "");
  L.push("## Industry rules that apply", ...(industry ? industry.items.map((i) => `- ${i.id}: ${i.description}`) : ["- (no industry rules selected in business.json)"]), "");
  L.push("## Notes for the builder", "- Title, H1 and the first paragraph carry the primary query; one H1; one canonical URL (self).",
    "- The first paragraph answers the query in plain words (answer first), then the sections in the outline order.",
    `- Server-rendered HTML: content, links and JSON-LD (${pg.schema.join(", ")}) in the first response.`);
  if (pg.programmatic) L.push(`- Programmatic page: it must pass plan/programmatic.json (unique words, sourced local facts, similarity). Real local content, never a swapped city name.`);
  if (business.launchState !== "live") L.push(`- Site is "${business.launchState}": noindex until launch is expected, not a defect.`);
  return L.join("\n") + "\n";
}

// ---- write ----
const planDir = path.join(pewp, "plan");
fs.rmSync(path.join(planDir, "briefs"), { recursive: true, force: true });
fs.mkdirSync(path.join(planDir, "briefs"), { recursive: true });
const writeJson = (f, o) => fs.writeFileSync(path.join(planDir, f), JSON.stringify(o, null, 1) + "\n");
for (const pg of pages) pg.brief = `plan/briefs/${pg.slug}.md`;
for (const pg of pages) fs.writeFileSync(path.join(pewp, pg.brief), briefMd(pg));

writeJson("sitemap.json", {
  version: 1, business: business.domain, generatedAt: OPTS.today, source: "targets.json",
  summary: { pages: pages.length, clusterPages: pages.filter((x) => x.cluster).length, supportPages: pages.filter((x) => !x.cluster).length, links: links.length, programmaticPages: pages.filter((x) => x.programmatic).length },
  pages: pages.map((pg) => ({ path: pg.path, slug: pg.slug, cluster: pg.cluster ? pg.cluster.id : null, role: pg.role, kind: pg.kind, parent: pg.parent, children: children(pg), primaryQuery: pg.cluster ? pg.cluster.primaryQuery : null, intent: pg.cluster ? pg.cluster.intent : null, location: pg.cluster?.location || null, title: pg.title, h1: pg.h1, metaDescription: pg.metaDescription, schema: pg.schema, programmatic: pg.programmatic, isNew: pg.isNew, wordRange: pg.wordRange, brief: pg.brief })),
  links,
});

// programmatic.json: where the data comes from and the numbers that stop thin pages (CODE-NEEDS-SEO §6, must-have M-05)
const progPages = pages.filter((x) => x.programmatic);
writeJson("programmatic.json", {
  version: 1, generatedAt: OPTS.today,
  gate: { minWords: OPTS.progMinWords, minUniqueWords: OPTS.progMinUnique, minLocalFacts: OPTS.progMinFacts, maxSimilarity: OPTS.progMaxSim, shingleSize: 5,
    basis: "CODE-NEEDS-SEO §6: about 1,000 words of non-template text, publish blocked when a page is more than ~40% identical to another page of the template; MH M-05" },
  definitions: { uniqueWords: "words of the page not inside any 5-word run that also appears on another page of the same group", similarity: "share of the page's 5-word runs that also appear on another page of the group", localFact: "a record value from programmatic-data.json that appears in the page text and carries a source and a date" },
  source: { status: OPTS.dataSource ? "chosen" : "TO DECIDE", description: OPTS.dataSource || "Choose where each page's local facts come from (public records, census tables, the owner's own notes). Every fact needs a source and a date. No MLS feed unless the business's rules allow it.", recordsFile: "plan/programmatic-data.json" },
  groups: progPages.length ? [{ id: "g-city", template: "city-landing", pages: progPages.map((x) => x.path), uniqueBy: ["sourced and dated local market facts", "neighbourhoods and landmarks served", "local questions from the question bank", "a last-reviewed date"], rule: "real local content on every page; a page below the gate stays a draft and is not published" }] : [],
});
const dataFile = path.join(planDir, "programmatic-data.json");
if (progPages.length && !fs.existsSync(dataFile)) writeJson("programmatic-data.json", { note: "Fill from the chosen data source. A fact counts only with value, source and date.", records: Object.fromEntries(progPages.map((x) => [x.path, { facts: [] }])) });

// off-site plan: link gap (authority.json), local, AI visibility
let authority = null; const af = opt("--authority", fs.existsSync(path.join(pewp, "authority.json")) ? path.join(pewp, "authority.json") : null);
if (af && fs.existsSync(af)) { try { authority = j(af); } catch {} }
let cited = null; const cf = opt("--citations");
if (cf && fs.existsSync(cf)) { try { const d = j(cf); const rows = d.citations || d; const m = new Map(); for (const r of rows) for (const s of r.citedSources || []) m.set(s, (m.get(s) || 0) + 1); cited = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([domain, questions]) => ({ domain, questions })); } catch {} }
const GBP = { "real-estate-agent": { primary: "Real estate agent", secondary: ["Real estate consultant", "Real estate agency"] }, "cash-home-buyer": { primary: "Home buying service", secondary: ["Real estate consultant"] }, "insurance-agency": { primary: "Insurance agency", secondary: ["Life insurance agency", "Insurance broker"] } };
const gb = GBP[business.kind];
const infoPages = pages.filter((x) => x.kind === "guide");
const offsite = {
  version: 1, generatedAt: OPTS.today,
  links: authority
    ? { status: "from authority.json", source: authority.source, fetchedAt: authority.fetchedAt, note: "domain-level Common Crawl graph: compare, do not read as absolutes", gap: (authority.linkGap || []).slice(0, 25).map((g) => ({ domain: g.domain, linksToCompetitors: g.linksToCompetitors, harmonicPos: g.harmonicPos ?? null, action: "find the contact and the reason it lists competitors (directory, roundup list, press); ask to be listed or featured; no paid links" })) }
    : { status: "BLOCKED: no authority.json", unblock: `node authority.mjs <pewp>/authority.json --target ${business.domain} ${business.competitors.map((d) => "--competitor " + d).join(" ")}`, gap: [] },
  linkableAssets: infoPages.map((x) => ({ idea: `A citable, dated data or guide page answering "${x.cluster.primaryQuery}" with original figures`, page: x.path, cluster: x.cluster.id })),
  rules: ["No paid link schemes or link networks between the owner's own sites", "Directories, roundup lists and local press first (these are what AI engines and searchers read)", "Accounts and listings are created by the owner or client, not by the tool"],
  local: {
    businessProfile: { status: business.existing.businessProfile ? "exists: audit it" : "none known", categories: gb ? { ...gb, note: "plan default, UNVERIFIED: confirm in the Business Profile category picker" } : null, tasks: ["Primary and secondary categories, services, hours, photos, posts", "Review count, rating and recency against the 3 top local-pack competitors", "Owner replies to every review"], needs: "owner API access (OAuth) or a dated manual capture; not available to scripts otherwise" },
    nap: { rule: "One source of truth for name, address and phone feeding the site footer, schema, llms.txt and every directory; the gate fails if two places differ", name: business.name, locations: business.locations.map((l) => ({ name: l.name, address: l.address })) },
    citations: ["Bing Places", "Apple Business Connect", "Better Business Bureau", "Local chamber of commerce for each service area", "Industry directories for " + business.kind], citationNote: "each: status, URL, name/address/phone matches yes/no; owner creates the accounts",
    reviews: { policy: ["Ask one to one, after the service, every client (not only happy ones)", "No reward tied to a good review; no automated review-request texts or emails unless the business's rules allow them"] },
    serviceAreaPages: { rule: "one real page per confirmed service-area city with local content; never swapped-city doorway pages (see programmatic.json)", cities: cityPages.map((x) => x.cluster.location) },
  },
  aiVisibility: {
    entityConsistency: "the same name, address, phone, description and service area on the site, profile, directories and in schema",
    sameAs: [...(business.existing.socials || []), ...(business.existing.businessProfile ? [business.existing.businessProfile] : [])],
    wikidataWikipedia: "check notability first; a local business rarely qualifies; never create a self-promotional entry",
    citableStats: infoPages.map((x) => x.path),
    llmsTxt: `generated per domain from the content model: name, what the business does, service area, key pages (${business.domain})`,
    robots: "allow Googlebot, Bingbot and AI-search crawlers (OAI-SearchBot, PerplexityBot, Claude-SearchBot); check no CDN setting blocks them",
    sourcesEnginesCite: cited ? { status: "from citations file", domains: cited } : { status: "NOT MEASURED: needs AI citation rows (measure stage)", unblock: "re-run with --citations <citations.json>" },
  },
};
writeJson("offsite.json", offsite);

// priorities: impact x effort, quick wins first
const prios = targets.clusters.map((c) => c.priority).sort((a, b) => a - b);
const tercile = (v) => (v >= prios[Math.floor(prios.length * 2 / 3)] ? 3 : v >= prios[Math.floor(prios.length / 3)] ? 2 : 1);
const items = pages.map((pg) => {
  const impact = pg.cluster ? tercile(pg.cluster.priority) : 1;
  const effort = pg.programmatic ? (pg === progPages[0] ? 3 : 1) : pg.isNew ? 2 : 1;
  return { id: pg.cluster ? pg.cluster.id : "support-" + pg.slug, kind: "page", what: `${pg.isNew ? "Build" : "Improve"} ${pg.path}`, page: pg.path, impact, effort, clusterPriority: pg.cluster?.priority ?? 0 };
});
const off = [
  { id: "offsite-links", kind: "offsite", what: "Link gap outreach: lists, directories, local press", impact: 3, effort: 3, clusterPriority: 0 },
  { id: "local-profile", kind: "local", what: "Business Profile categories, reviews, NAP everywhere", impact: 3, effort: 2, clusterPriority: 0 },
  { id: "ai-visibility", kind: "ai", what: "Entity consistency, sameAs, llms.txt, robots for AI crawlers", impact: 2, effort: 1, clusterPriority: 0 },
];
const order = [...items, ...off].map((x) => ({ ...x, score: Math.round((x.impact / x.effort) * 100) / 100, quickWin: x.effort === 1 && x.impact >= 2 }))
  .sort((a, b) => Number(b.quickWin) - Number(a.quickWin) || b.score - a.score || b.clusterPriority - a.clusterPriority || a.id.localeCompare(b.id)).map((x, i) => ({ rank: i + 1, ...x }));
writeJson("priorities.json", { version: 1, generatedAt: OPTS.today, rule: "quick wins (effort 1, impact >= 2) first, then impact / effort, then the cluster priority from targets.json", items: order });

fs.writeFileSync(path.join(planDir, "summary.md"), [`# Plan summary (${business.name}, ${OPTS.today})`, "",
  `${pages.length} pages (${pages.filter((x) => x.cluster).length} from clusters, ${pages.filter((x) => !x.cluster).length} support), ${links.length} planned internal links, ${progPages.length} programmatic pages.`, "",
  "| Rank | Item | Impact | Effort | Quick win |", "|---|---|---|---|---|", ...order.map((x) => `| ${x.rank} | ${x.what} | ${x.impact} | ${x.effort} | ${x.quickWin ? "yes" : ""} |`), "",
  `Programmatic data source: ${OPTS.dataSource || "TO DECIDE (plan/programmatic.json)"}.`, `Off-site link gap: ${offsite.links.status}.`, ""].join("\n"));

// self-check: the plan itself must satisfy the rules the gate applies to pages
const warn = [];
for (const pg of pages) if (pg.cluster) { if (overlap(pg.cluster.primaryQuery, pg.title) < 0.8 && pg.title.length > 0) warn.push(`${pg.path}: title does not carry the primary query`); if (overlap(pg.cluster.primaryQuery, pg.metaDescription) < 0.8) warn.push(`${pg.path}: meta description does not carry the primary query`); }
try { if (fs.existsSync(path.join(pewp, "state.json"))) state.markStage(state.locate(path.dirname(pewp)), "plan", { sitemap: "plan/sitemap.json", programmatic: "plan/programmatic.json", offsite: "plan/offsite.json", priorities: "plan/priorities.json" }); } catch {}
console.log(`PASS plan ${pages.length} pages (${pages.filter((x) => x.cluster).length} clusters, ${hub ? "1 hub" : "no hub"}), ${links.length} links, ${progPages.length} programmatic, wrote ${planDir}`);
for (const w of warn) console.log(`  WARN ${w}`);
