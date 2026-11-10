// measure: post-launch tracking for a URL target. Re-runnable with no model (a model may rewrite the plain-words summary).
// Usage: node measure.mjs <url> --init [--property sc-domain:example.com] [--cwd DIR]     writes <pewp>/measure/config.json + run.mjs
//        node measure.mjs <url> [--plan] [--fresh] [--today YYYY-MM-DD] [--refresh-authority] [--cwd DIR]
//        node measure.mjs <url> --import-md <dir with fresh/*.google.md> --device desktop   (convert the project's own captures)
// Collects (each source missing => that part BLOCKED with the unblock step, never invented): Search Console (two 28-day
// windows: queries, pages, countries, devices, query x page, query x device), URL Inspection, Bing Webmaster, CrUX field data,
// rankings of every target query (Search Console average position + imported browser captures, each with location and
// device), AI citations (Gemini free tier with grounding, N runs, citedShare + imported owner captures), authority
// (authority.mjs, domain level), conversions (imported). Writes <pewp>/measure/<date>/ + diff.json/diff.md against the
// last earlier run + findings (MSR-001..010, 06 section 9.8 significance) + report.md/report.json.
// Exit 0 = ran (BLOCKED parts are results, listed in summary.json), 2 = usage.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { locate, markStage, load as loadState } from "./state.mjs";
import { diffGrid } from "./local-grid.mjs";
import { resolveInputs } from "./approve.mjs";
import { ENGINES, observationsFrom, fillEngines, isIsoDate } from "./lib-prompt-map.mjs";
import { loadPromptMap, PromptMapError } from "./lib-prompt-plan.mjs";
import {
  DEFAULT_ENDPOINTS, Budget, ALPHA3, fact, nfkc, words, containsWords, domainOf, isOurs, ymd, addDays, readJson, writeJson, blocked, normPath,
  poissonInterval, clicksChanged, cwvStatus, gscQuery, gscInspect, bingCall, bingAggregate, cruxQuery, geminiAsk, loadCaptures,
  rankingRowsFromCaptures, aiRowsFromCaptures, loadAiCaptures, parseFreshMarkdown, validateRankingRow, rankKey, sha, isDay, stripBom,
} from "./measure-sources.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_CONFIG = {
  target: null, cwd: null, skillDir: SKILL_DIR, domain: null, aliases: [], market: { country: "US", language: "en" },
  windowDays: 28, lagDays: 3, // Search Console data is final about 3 days late
  gsc: { site: null, country: null /* gsc alpha-3 lower case, default from market */ },
  bing: { site: null },
  crux: { maxUrls: 8, formFactor: "PHONE" },
  ai: { model: "gemini-3.8-flash", runs: 3, maxQuestions: 10, questionsPerCluster: 2, gapMs: 60000, geminiTermsAcknowledged: false, questions: null,
    prompts: null /* null = every row of the (approved) prompt map; a list of row ids = only those */, promptWindowDays: 31 /* an observation older than this is not this month's */ },
  captures: { rankings: "captures/serp" /* shared with research-serp-import.mjs */, ai: "captures/ai", conversions: "captures/conversions.json" },
  rankDevices: ["mobile"], // devices that get a (null) row when a target query has no Search Console data for them
  authority: { maxAgeDays: 90, top: 100000, competitors: [], release: null, cache: null },
  competitors: [],
  thresholds: { topPositions: 10, minImpressions: 50, ctrFloorRatio: 0.5, conversionPages: 20, positionDelta: 3, aiSampleDelta: 2, gridSov3Floor: 0.34 },
  budgets: { api: 80, ai: 60, inspect: 20 },
  endpoints: DEFAULT_ENDPOINTS,
};
// Placeholder expected-CTR-by-position until the ruleset ctr-curve.json is supplied (UNVERIFIED industry averages).
export const DEFAULT_CTR_CURVE = { source: "built-in placeholder, UNVERIFIED industry averages; replace with the ruleset ctr-curve.json (skill rules/ctr-curve.json or measure.ctrCurvePath)", positions: [0.30, 0.15, 0.10, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018] };

const deviceName = (d) => ({ MOBILE: "mobile", DESKTOP: "desktop", TABLET: "tablet" }[String(d).toUpperCase()] || String(d).toLowerCase());
const fmtPct = (x) => `${(x * 100).toFixed(1)}%`;
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === "object" && !Array.isArray(v) && a?.[k] && typeof a[k] === "object" && !Array.isArray(a[k]) ? merge(a[k], v) : v; return o; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- config ----------
export function configPath(loc) { return path.join(loc.pewp, "measure", "config.json"); }
export function loadConfig(loc, overrides = {}) {
  const c = readJson(configPath(loc));
  return merge(merge(DEFAULT_CONFIG, c || {}), overrides);
}
export function initMeasure(target, { cwd = process.cwd(), property = null, overrides = {} } = {}) {
  const loc = locate(target, { cwd });
  const domain = loc.kind === "url" ? loc.host : null;
  const cfg = merge(merge(DEFAULT_CONFIG, readJson(configPath(loc)) || {}), { target: loc.target, cwd: path.resolve(cwd), domain, skillDir: SKILL_DIR, gsc: { site: property || (domain ? `sc-domain:${domain}` : null) }, ...overrides });
  writeJson(configPath(loc), cfg);
  // The re-runnable entry sits next to the data, so a cron job or the owner can run it with no model.
  const run = path.join(loc.pewp, "measure", "run.mjs");
  fs.copyFileSync(path.join(SKILL_DIR, "measure", "run.mjs"), run);
  fs.mkdirSync(path.join(loc.pewp, cfg.captures.rankings), { recursive: true });
  fs.mkdirSync(path.join(loc.pewp, cfg.captures.ai), { recursive: true });
  return { loc, cfg, config: configPath(loc), run };
}

// ---------- targets ----------
export function targetsInfo(loc) {
  // Approved (signed) targets win; a tampered lock means no targets (approve.mjs, shipgate TR-235).
  const r = resolveInputs(loc.pewp);
  const t = r.lock.exists && !r.lock.ok ? null : readJson(r.targetsFile);
  if (!t || !Array.isArray(t.clusters)) return { present: false, clusters: [], queries: [], questions: [], pages: [] };
  const clusters = t.clusters;
  const queries = [...new Set(clusters.flatMap((c) => [c.primaryQuery, ...(c.queries || [])]).filter(Boolean))];
  const pages = clusters.filter((c) => c.targetPage && c.targetPage !== "new").sort((a, b) => (b.priority || 0) - (a.priority || 0)).map((c) => ({ clusterId: c.id, path: normPath(c.targetPage), primaryQuery: c.primaryQuery }));
  const questions = clusters.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0)).flatMap((c) => (c.questions || []).map((q) => ({ question: q, clusterId: c.id })));
  return { present: true, raw: t, clusters, queries, questions, pages };
}

// ---------- the prompt map, monthly (DECISIONS 35, slice 5d) ----------
// ai.prompts comes from the approved prompt map (research/prompt-map.json when nothing is approved): every row, or the rows whose ids config.json lists.
// A month's engines block is built from what was OBSERVED inside the window (research/ai-citations.json, owner captures, this run's Gemini answers); the engines
// the map itself carries are never copied, so an old observation cannot pass for this month's. null stays null: not checked is not "no".
export const PROMPT_FILE = "prompt-map.json";
export function promptMapInfo(loc, cfg, today) {
  const none = { present: false, ok: true, rows: [], unknownIds: [] };
  let pm;
  try { pm = loadPromptMap(loc.pewp, { today }); }
  catch (e) { if (e instanceof PromptMapError) return { present: true, ok: false, reason: e.message, lines: e.lines, rows: [], unknownIds: [] }; throw e; }
  if (!pm) return none;
  const lock = resolveInputs(loc.pewp).lock;
  if (pm.approved && lock.exists && !lock.ok) return { present: true, ok: false, reason: `approved/prompt-map.json cannot be trusted: ${lock.problems.join("; ")}`, lines: lock.problems, rows: [], unknownIds: [] };
  const want = Array.isArray(cfg.ai.prompts) ? cfg.ai.prompts : null;
  const have = new Set(pm.rows.map((r) => r.id));
  return { present: true, ok: true, rel: pm.rel, approved: pm.approved, sha: pm.sha, total: pm.rows.length, rows: want ? pm.rows.filter((r) => want.includes(r.id)) : pm.rows, unknownIds: want ? want.filter((x) => !have.has(x)) : [] };
}
// the Gemini questions a map adds to the AI part: the buyer's whole sentence, alone, like every other question
export const promptQuestions = (rows) => rows.map((r) => ({ question: r.prompt, clusterId: null, promptId: r.id }));

// every observation of an AI engine about a prompt: research/ai-citations.json, owner captures (captures/ai/*.json), this run's Gemini answers
export function promptObservations({ pewp, capDir, name, domain, aiRows = [], runSource }) {
  const captures = loadCaptures(capDir).map(({ _file, ...doc }) => ({ file: path.basename(_file), doc }));
  const ai = readJson(path.join(pewp, "research", "ai-citations.json"));
  const obs = observationsFrom({ aiRows: ai?.status === "ok" ? ai.rows || [] : [], captures, domain, name });
  for (const r of aiRows) {
    if (r.method !== "api" || !r.promptId) continue;
    const at = (r.dates || []).map((x) => String(x).slice(0, 10)).filter(isIsoDate).sort().at(-1);
    if (at) obs.push({ engine: "gemini", promptId: r.promptId, keys: [r.prompt], named: null /* the API answer text is never kept, so a name is not tested */, cited: r.ourDomainCited, pageCited: null, at, source: runSource, capture: false });
  }
  return obs;
}
// One month of the map: the rows with the engines block of the observations inside (date - windowDays, date].
export function promptMonth(rows, obs, date, windowDays = 31) {
  const from = ymd(addDays(date, -windowDays));
  const inWin = obs.filter((o) => o.at <= date && o.at > from);
  const out = rows.map((r) => ({ id: r.id, prompt: r.prompt, location: r.location, fix: r.fix?.kind || null })); // engines are NOT copied from the map
  const f = fillEngines(out, inWin);
  return { rows: out, from, to: date, tally: f.tally, observations: inWin.length, outsideWindow: obs.length - inWin.length };
}
export const promptObserved = (r) => ENGINES.some((e) => r.engines?.[e] && (r.engines[e].named !== null || r.engines[e].cited !== null));
// The diff of two months. A flip needs a real observation on BOTH sides: first looks (null -> value) and lost looks (value -> null) are listed, never called changes.
export function diffPromptMonths(prev, cur) {
  if (!prev) return { baseline: true, note: "First prompt-map run: nothing to compare yet. This month is the baseline for the next." };
  const d = { baseline: false, previousDate: prev.date, currentDate: cur.date, changes: [], firstLooks: [], lostLooks: [], rowsAdded: [], rowsRemoved: [] };
  const was = new Map((prev.rows || []).map((r) => [r.id, r])), now = new Map((cur.rows || []).map((r) => [r.id, r]));
  for (const r of cur.rows || []) {
    const o = was.get(r.id);
    if (!o) { d.rowsAdded.push({ id: r.id, prompt: r.prompt }); continue; }
    for (const e of ENGINES) {
      const a = o.engines?.[e] || {}, b = r.engines?.[e] || {};
      const sawA = a.named != null || a.cited != null, sawB = b.named != null || b.cited != null;
      if (!sawA && sawB) { d.firstLooks.push({ id: r.id, prompt: r.prompt, engine: e, named: b.named ?? null, cited: b.cited ?? null }); continue; }
      if (sawA && !sawB) { d.lostLooks.push({ id: r.id, prompt: r.prompt, engine: e, named: a.named ?? null, cited: a.cited ?? null, lastSeen: a.at ?? null }); continue; }
      for (const f of ["named", "cited"]) if (a[f] != null && b[f] != null && a[f] !== b[f]) d.changes.push({ id: r.id, prompt: r.prompt, engine: e, field: f, from: a[f], to: b[f], kind: b[f] ? "gained" : "lost" });
      if (a.cited === true && b.cited === true && a.pageCited && b.pageCited && a.pageCited !== b.pageCited) d.changes.push({ id: r.id, prompt: r.prompt, engine: e, field: "pageCited", from: a.pageCited, to: b.pageCited, kind: "page" });
    }
  }
  for (const r of prev.rows || []) if (!now.has(r.id)) d.rowsRemoved.push({ id: r.id, prompt: r.prompt });
  const n = (f, k) => d.changes.filter((c) => c.field === f && c.kind === k).length;
  d.counts = { namedGained: n("named", "gained"), namedLost: n("named", "lost"), citedGained: n("cited", "gained"), citedLost: n("cited", "lost"), pageChanged: d.changes.filter((c) => c.field === "pageCited").length, firstLooks: d.firstLooks.length, lostLooks: d.lostLooks.length };
  return d;
}
// the newest earlier month that wrote a usable prompt-map.json
export function previousPromptMonth(measureRoot, date) {
  if (!fs.existsSync(measureRoot)) return null;
  for (const d of fs.readdirSync(measureRoot).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x < date).sort().reverse()) {
    const j = readJson(path.join(measureRoot, d, PROMPT_FILE));
    if (j?.step === "prompt-map" && Array.isArray(j.rows) && j.rows.length) return { ...j, date: d }; // an all-null month is still a month: its rows are what the next one is compared with
  }
  return null;
}
// The platform's ai-answers snapshot (blueprint 22 section 7, platform ruling 2026-11-01): ONE metrics_snapshots row per workspace per run day, source
// "ai-answers", the per-prompt per-engine rows inside data.rows[]. Each inner row carries promptId, engine, named, cited, asked_at and an evidence URL or a dated
// excerpt; the platform's CHECK refuses a row without them, and so does this writer. A pair nobody looked at has no row (null stays "not checked", never a row).
export const AI_ANSWERS_SOURCE = "ai-answers";
export const AI_ANSWERS_FILE = "ai-answers.json";
const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\/\S+$/.test(s);
export function validateAiAnswerRow(r) {
  if (!r || typeof r !== "object") return ["the row is not an object"];
  const p = [];
  if (typeof r.promptId !== "string" || !r.promptId) p.push("promptId missing");
  if (!ENGINES.includes(r.engine)) p.push("engine missing or unknown");
  for (const k of ["named", "cited"]) if (!(k in r) || (r[k] !== null && typeof r[k] !== "boolean")) p.push(`${k} missing`);
  if (r.named == null && r.cited == null) p.push("neither named nor cited was observed");
  if (typeof r.asked_at !== "string" || !isIsoDate(r.asked_at)) p.push("asked_at missing");
  if (!isHttpUrl(r.evidence_url) && !(typeof r.evidence_excerpt === "string" && r.evidence_excerpt.trim())) p.push("evidence (a URL or a dated excerpt) missing");
  return p;
}
export function aiAnswersSnapshot(doc, date) {
  const rows = [], refused = [];
  for (const r of doc?.rows || []) for (const engine of ENGINES) {
    const x = r.engines?.[engine];
    if (!x || (x.named == null && x.cited == null)) continue;
    const url = isHttpUrl(x.pageCited) ? x.pageCited : null;
    const row = { promptId: r.id, prompt: r.prompt, engine, named: x.named ?? null, cited: x.cited ?? null, pageCited: x.pageCited ?? null, asked_at: x.at ?? null,
      evidence_url: url, evidence_excerpt: url || !x.source || !x.at ? null : `${x.source}, seen ${x.at}` };
    const problems = validateAiAnswerRow(row);
    if (problems.length) refused.push({ promptId: r.id, engine, problems }); else rows.push(row);
  }
  return { source: AI_ANSWERS_SOURCE, day: date, data: { date, mapSha256: doc?.map?.sha256 || null, rows }, refused };
}
const tri = (v) => (v === true ? "yes" : v === false ? "no" : "not checked");
const engineText = (name, e) => (e && (e.named != null || e.cited != null) ? `${name} named ${tri(e.named)}, cited ${tri(e.cited)}${e.pageCited ? ` (${e.pageCited})` : ""}, seen ${e.at}` : `${name} not checked this month`);

// ---------- windows ----------
export function windowsFor(now, cfg) {
  const end = addDays(now, -cfg.lagDays);
  const cur = { start: ymd(addDays(end, -(cfg.windowDays - 1))), end: ymd(end) };
  const pend = addDays(end, -cfg.windowDays);
  return { current: cur, previous: { start: ymd(addDays(pend, -(cfg.windowDays - 1))), end: ymd(pend) } };
}

// ---------- the plan (printed before every run; the stop is the budget) ----------
export function buildPlan(cfg, tInfo, loc, opts = {}) {
  const w = windowsFor(opts.now || new Date(), cfg);
  const pq = opts.promptQuestions || []; // the prompt map's rows: asked after the cluster questions, under the same cost stop
  const qs = [...(cfg.ai.questions || tInfo.questions.slice(0, cfg.ai.maxQuestions)), ...pq];
  const aiAnswers = qs.length * cfg.ai.runs;
  const env = opts.env || process.env;
  const lines = [
    `PLAN measure ${cfg.target}  (state: ${loc.pewp})`,
    `  windows: current ${w.current.start}..${w.current.end}, previous ${w.previous.start}..${w.previous.end}`,
    `  Search Console: 12 queries (6 tables x 2 windows, paged) for ${cfg.gsc.site || "(no property set)"}; URL Inspection up to ${Math.min(cfg.budgets.inspect, tInfo.pages.length)} pages`,
    `  Bing Webmaster: 2 calls (${env.BING_WEBMASTER_KEY ? "key set" : "no key: BLOCKED"}); CrUX: ${1 + Math.min(cfg.crux.maxUrls, tInfo.pages.length)} calls (${env.CRUX_API_KEY ? "key set" : "no key: BLOCKED"})`,
    `  AI citations: ${qs.length} questions${pq.length ? ` (${pq.length} of them prompts from the prompt map)` : ""} x ${cfg.ai.runs} runs = ${aiAnswers} Gemini answers (cap ${cfg.budgets.ai}), ${Math.round(Math.max(0, aiAnswers - 1) * cfg.ai.gapMs / 60000)} min at ${cfg.ai.gapMs / 1000}s apart (${env.GEMINI_API_KEY ? "key set" : "no key"}; terms acknowledged: ${cfg.ai.geminiTermsAcknowledged})`,
    `  Total API calls capped at ${cfg.budgets.api}; no paid source is used.`,
  ];
  const over = [];
  if (aiAnswers > cfg.budgets.ai) over.push(`AI answers ${aiAnswers} > cap ${cfg.budgets.ai}`);
  if (12 > cfg.budgets.api) over.push("API cap below the 12 Search Console queries");
  return { lines, over, windows: w, aiAnswers, questions: qs };
}

// ---------- collection ----------
const sumRows = (rows) => {
  let clicks = 0, impressions = 0, posW = 0;
  for (const r of rows || []) { clicks += r.clicks || 0; impressions += r.impressions || 0; posW += (r.position || 0) * (r.impressions || 0); }
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? posW / impressions : null };
};

async function collectGsc(ctx, cfg, w) {
  if (!cfg.gsc.site) return { status: "blocked", blocked: { source: "search-console", reason: "no Search Console property in measure/config.json (gsc.site)", unblock: "Run measure.mjs <url> --init --property sc-domain:example.com (or the https:// property)." } };
  const country = cfg.gsc.country || ALPHA3[String(cfg.market.country).toUpperCase()] || null;
  const dims = { query: ["query"], page: ["page"], country: ["country"], device: ["device"], queryPage: ["query", "page"], queryDevice: ["query", "device"] };
  const out = { status: "ok", site: cfg.gsc.site, country, windows: w, tables: { current: {}, previous: {} }, provenance: [], calls: 0 };
  for (const win of ["current", "previous"]) {
    for (const [name, d] of Object.entries(dims)) {
      const r = await gscQuery(ctx, { site: cfg.gsc.site, start: w[win].start, end: w[win].end, dimensions: d, country: name === "queryDevice" ? country : null });
      if (!r.ok) return { status: "blocked", blocked: r.blocked, partialTables: out.tables };
      out.tables[win][name] = r.rows; out.provenance.push({ table: `${win}.${name}`, source: r.source, fetchedAt: r.fetchedAt, cacheFiles: r.cacheFiles }); out.calls++;
    }
  }
  if (!country) out.note = "no country filter on the ranking table: set gsc.country (alpha-3, lower case) for a country-level position";
  out.fetchedAt = out.provenance.at(-1)?.fetchedAt || null;
  out.totals = { current: sumRows(out.tables.current.device), previous: sumRows(out.tables.previous.device) };
  return out;
}

async function collectInspect(ctx, cfg, tInfo, gscStatus) {
  if (gscStatus === "blocked") return { status: "blocked", blocked: { source: "search-console", reason: "Search Console is not connected (see the Search Console part)", unblock: "Connect Search Console first." } };
  if (!tInfo.pages.length) return { status: "blocked", blocked: { source: "targets.json", reason: "no planned pages (targets.json missing, or every cluster's targetPage is \"new\")", unblock: "Run research (targets.json) or build the planned pages first." } };
  const origin = new URL(cfg.target).origin; const results = [];
  for (const p of tInfo.pages) {
    const r = await gscInspect(ctx, { site: cfg.gsc.site, url: origin + p.path });
    if (!r.ok) { if (results.length) return { status: "partial", blocked: r.blocked, results }; return { status: "blocked", blocked: r.blocked }; }
    results.push({ ...p, url: origin + p.path, verdict: r.verdict, coverageState: r.coverageState, lastCrawlTime: r.lastCrawlTime, fetchedAt: r.fetchedAt, cacheFile: r.cacheFile });
  }
  return { status: "ok", results, fetchedAt: results.at(-1)?.fetchedAt };
}

async function collectBing(ctx, cfg, w) {
  const site = cfg.bing.site || cfg.target;
  const q = await bingCall(ctx, "GetQueryStats", site); if (!q.ok) return { status: "blocked", blocked: q.blocked };
  const p = await bingCall(ctx, "GetPageStats", site); if (!p.ok) return { status: "blocked", blocked: p.blocked };
  const agg = (rows, f, win) => bingAggregate(rows, f, win.start, win.end);
  return { status: "ok", site, windows: w, source: "Bing Webmaster API GetQueryStats / GetPageStats (daily rows aggregated; position impression-weighted)", fetchedAt: q.fetchedAt, cacheFiles: [q.cacheFile, p.cacheFile],
    tables: { current: { query: agg(q.data, "Query", w.current), page: agg(p.data, "Query", w.current) }, previous: { query: agg(q.data, "Query", w.previous), page: agg(p.data, "Query", w.previous) } } };
}

async function collectCrux(ctx, cfg, tInfo) {
  const origin = new URL(cfg.target).origin;
  const list = [{ origin }, ...tInfo.pages.slice(0, cfg.crux.maxUrls).map((p) => ({ url: origin + p.path }))];
  const results = [];
  for (const t of list) {
    const r = await cruxQuery(ctx, { ...t, formFactor: cfg.crux.formFactor });
    if (!r.ok) return results.length ? { status: "partial", blocked: r.blocked, results } : { status: "blocked", blocked: r.blocked };
    results.push(r);
  }
  return { status: "ok", results, fetchedAt: results.at(-1)?.fetchedAt, note: results.every((r) => r.noFieldData) ? "CrUX has no field data for any address (too little real-visitor traffic): a result, not a failure" : null };
}

function rankingsFromGsc(gsc, tInfo, cfg) {
  const country = gsc.country; const loc = country ? `country ${country} (country level, not a city)` : "all countries";
  const rows = [], idx = new Map();
  for (const win of ["current", "previous"]) for (const r of gsc.tables[win].queryDevice || []) idx.set(`${win}|${nfkc(r.keys[0])}|${deviceName(r.keys[1])}`, r);
  // the page that gets the most impressions for a query is the URL that "ranks" for it
  const topPage = new Map();
  for (const r of gsc.tables.current.queryPage || []) { const k = nfkc(r.keys[0]); if (!topPage.has(k) || topPage.get(k).impressions < r.impressions) topPage.set(k, { page: r.keys[1], impressions: r.impressions }); }
  const prov = gsc.provenance.find((p) => p.table === "current.queryDevice") || {};
  const src = `Google Search Console average position (${loc})`;
  for (const q of tInfo.queries) {
    const have = ["mobile", "desktop", "tablet"].filter((d) => idx.has(`current|${nfkc(q)}|${d}`) || idx.has(`previous|${nfkc(q)}|${d}`));
    const devs = [...new Set([...have, ...(cfg.rankDevices || ["mobile"]).filter((d) => !have.includes(d))])];
    for (const d of devs) {
      const c = idx.get(`current|${nfkc(q)}|${d}`), p = idx.get(`previous|${nfkc(q)}|${d}`);
      rows.push({ query: q, engine: "google", source: "search-console", location: loc, device: d, language: cfg.market.language, url: c ? topPage.get(nfkc(q))?.page || null : null, impressions: c?.impressions ?? 0, clicks: c?.clicks ?? 0, ctr: c?.ctr ?? null,
        position: fact(c ? c.position : null, src, prov.fetchedAt || gsc.fetchedAt, (prov.cacheFiles || []).join("; ") || null, { estimate: true, location: loc, device: d, note: c ? "average over impressions; the URL is the page with the most impressions for the query" : "no impressions on this device in the window: not ranked or too rare to measure" }),
        previous: p ? { position: p.position, impressions: p.impressions } : null });
    }
  }
  return rows;
}

// The folder contract (targets-validate.mjs validateMeasureDir): rankings.json { date, rankings:[row] }, citations.json { date, citations:[row] }.
// Rows the contract cannot hold (tablet, local pack, a position without the ranking URL) stay in rank-detail.json.
export function contractRankings(rank, date) {
  const rows = [], excluded = [];
  for (const r of rank.rows || []) {
    if (!["google", "bing"].includes(r.engine) || !["mobile", "desktop"].includes(r.device)) { excluded.push({ query: r.query, engine: r.engine, device: r.device, why: "engine/device outside the folder contract (kept in rank-detail.json)" }); continue; }
    const v = r.position.value;
    if (v != null && !r.url) { excluded.push({ query: r.query, device: r.device, why: "a position needs the URL that ranks; the capture gave only a domain" }); continue; }
    rows.push({ ...r, position: v == null ? r.position : { ...r.position, value: Math.max(1, Math.round(v)), average: r.source === "search-console" ? Math.round(v * 100) / 100 : undefined } });
  }
  return { date, status: rank.status, blocked: rank.blocked || null, rankings: rows, excluded, rejected: rank.rejected || [], superseded: rank.superseded || [], notes: rank.notes || [] };
}
export function contractCitations(ai, date) {
  return { date, status: ai.status, blocked: ai.blocked || null, citations: (ai.rows || []).map(({ citedCount, lowSample, competitorsCited, answerHashes, dates, clusterId, incomplete, method, sourceCounts, ...row }) => ({ ...row, sourceCounts, competitorsCited, lowSample, method, clusterId, incomplete })), rejected: ai.rejected || [] };
}

async function collectRankings(cfg, loc, tInfo, gsc, capDir) {
  if (!tInfo.present) return { status: "blocked", blocked: { source: "targets.json", reason: "no targets.json: there is no list of target queries to rank", unblock: "Run the research stage (it writes targets.json)." }, rows: [] };
  const rows = [], notes = [], rejected = [];
  if (gsc.status === "ok") rows.push(...rankingsFromGsc(gsc, tInfo, cfg)); else notes.push(`Search Console part BLOCKED: ${gsc.blocked?.reason}`);
  const caps = loadCaptures(capDir);
  const cr = rankingRowsFromCaptures(caps, { domain: cfg.domain, aliases: cfg.aliases, targetQueries: tInfo.queries, language: cfg.market.language });
  rows.push(...cr.rows); rejected.push(...cr.rejected);
  if (!caps.length) notes.push(`no browser captures in ${capDir}: city/device ranks are not measured (owner-supervised capture at human pace, see stages/measure.md)`);
  if (!rows.length) return { status: "blocked", blocked: { source: "rankings", reason: "neither Search Console nor browser captures gave a rank", unblock: "Connect Search Console, or drop capture files in " + capDir }, rows, rejected, notes };
  return { status: gsc.status === "ok" ? "ok" : "partial", rows, rejected, notes, fetchedAt: new Date().toISOString() };
}

async function collectAi(ctx, cfg, tInfo, capDir, competitors, plan) {
  const out = { status: "ok", rows: [], notes: [], rejected: [], competitors };
  const { caps, skippedMd } = await loadAiCaptures(capDir);
  const ar = aiRowsFromCaptures(caps, { domain: cfg.domain, aliases: cfg.aliases, competitors }); out.rows.push(...ar.rows); out.rejected.push(...ar.rejected, ...skippedMd);
  const qs = plan.questions; // cluster questions, then the prompt map's rows (buildPlan)
  const env = ctx.env || process.env;
  let gemBlock = null;
  if (!cfg.ai.geminiTermsAcknowledged) gemBlock = { source: "gemini", reason: "Gemini terms not acknowledged. The Gemini API terms forbid storing or monitoring grounded results (project research, TRACKER-PROPOSAL T1b, 2026-10-18); the owner decision of 2026-10-22 says to use the free tier. Only cited domains and an answer hash are kept, never the answer text.", unblock: "The owner confirms in writing, then set ai.geminiTermsAcknowledged=true in measure/config.json." };
  else if (!env.GEMINI_API_KEY) gemBlock = { source: "gemini", reason: "no GEMINI_API_KEY", unblock: "aistudio.google.com: create a free API key, set GEMINI_API_KEY." };
  else if (!qs.length) gemBlock = { source: "targets.json", reason: "no questions: targets.json has no cluster questions", unblock: "Run research (clusters carry questions[]), or set ai.questions in config." };
  else if (plan.over.length) gemBlock = { source: "gemini", reason: "over the cost stop: " + plan.over.join("; "), unblock: "Raise measure.budgets.ai or ask fewer questions / runs." };
  if (gemBlock) { out.gemini = { status: "blocked", blocked: gemBlock }; }
  else {
    const rows = []; let first = true; let stopped = null;
    outer: for (const q of qs) {
      const runs = [];
      for (let i = 0; i < cfg.ai.runs; i++) {
        if (!first && cfg.ai.gapMs) await sleep(cfg.ai.gapMs); first = false;
        const r = await geminiAsk(ctx, { question: q.question, model: cfg.ai.model });
        if (!r.ok) { stopped = r.blocked; if (runs.length) rows.push(aiRowFromRuns(q, runs, cfg, competitors, true)); break outer; }
        runs.push(r);
      }
      rows.push(aiRowFromRuns(q, runs, cfg, competitors, false));
    }
    out.rows.push(...rows);
    out.gemini = stopped ? { status: rows.length ? "partial" : "blocked", blocked: stopped } : { status: "ok", answers: rows.reduce((n, r) => n + r.runs, 0) };
  }
  if (out.gemini.status === "blocked" && !out.rows.length) return { status: "blocked", blocked: out.gemini.blocked, rows: [], gemini: out.gemini, rejected: out.rejected, notes: ["no owner AI captures in " + capDir] };
  out.status = out.gemini.status === "ok" ? "ok" : "partial";
  if (out.gemini.blocked) out.blocked = out.gemini.blocked;
  return out;
}
function aiRowFromRuns(q, runs, cfg, competitors, cut) {
  const ours = runs.filter((r) => r.citedDomains.some((d) => isOurs(d, cfg.domain, cfg.aliases))).length;
  const counts = {}; for (const r of runs) for (const d of r.citedDomains) counts[d] = (counts[d] || 0) + 1;
  return { question: q.question, clusterId: q.clusterId || null, ...(q.promptId ? { promptId: q.promptId } : {}), engine: "gemini", model: runs[0].model, prompt: q.question, runs: runs.length, location: "not settable in the API (provider default)", method: "api", incomplete: cut,
    citedShare: fact(ours / runs.length, `Gemini API (${runs[0].model}) with Google Search grounding, ${runs.length} answer(s)`, runs.at(-1).fetchedAt, null, { estimate: runs.length < 3 }), citedCount: ours,
    citedSources: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([d]) => d), sourceCounts: counts, ourDomainCited: ours > 0,
    competitorsCited: competitors.filter((c) => counts[domainOf(c)]).map(domainOf), answerHashes: runs.map((r) => r.answerHash), dates: runs.map((r) => r.fetchedAt) };
}

async function collectAuthority(cfg, loc, opts, now, extraCompetitors = []) {
  const file = path.join(loc.pewp, "authority.json");
  const A = await import("./authority.mjs");
  const cacheDir = cfg.authority.cache || A.defaultCache();
  if (opts.refreshAuthority) {
    const release = cfg.authority.release || A.cachedRelease(cacheDir);
    if (!release) return { status: "blocked", blocked: { source: "commoncrawl-graph", reason: `no complete Common Crawl release in ${cacheDir || "(no seoKitCache in machine.local.json)"}`, unblock: "Set seoKitCache in ~/.claude/machine.local.json and run authority.mjs once with --release <id> (about 11 GB)." } };
    const competitors = [...new Set([...(cfg.authority.competitors || []), ...(cfg.competitors || []), ...extraCompetitors])];
    try { await A.authority({ out: file, release, cacheDir, top: cfg.authority.top, target: cfg.domain, competitors }); }
    catch (e) { return { status: "blocked", blocked: { source: "commoncrawl-graph", reason: `authority run failed: ${e.message}`, unblock: "Check the cache folder and the release id, then run again." } }; }
  }
  const doc = readJson(file);
  if (!doc) return { status: "blocked", blocked: { source: "commoncrawl-graph", reason: "no authority.json yet (the Common Crawl read takes 15 to 30 minutes and is not run on every measure)", unblock: `Run: node scripts/measure.mjs ${cfg.target} --refresh-authority   (or scripts/authority.mjs ${file} --target ${cfg.domain} --competitor <domain>...)` } };
  // authority.mjs lists the target first; a site the graph does not hold has no role and no count, so the target is found by role or by position and the competitors are every other result
  const results = doc.results || [];
  const me = results.find((r) => r.role === "target") || results[0];
  const competitors = results.filter((r) => r !== me).map((r) => ({ domain: r.domain, inGraph: !!r.inGraph, linkingDomains: r.inGraph ? r.linkingDomains ?? null : null }));
  const ageDays = Math.round((now - Date.parse(doc.fetchedAt)) / 86400000);
  if (!me?.inGraph) return { status: "ok", inGraph: false, release: doc.release, fetchedAt: doc.fetchedAt, ageDays, source: doc.source, cacheFile: file, note: me?.note || "target not in this Common Crawl release", competitors, linkGap: (doc.linkGap || []).slice(0, 50) };
  const list = me.strongestLinkingDomains || [];
  return { status: "ok", inGraph: true, release: doc.release, fetchedAt: doc.fetchedAt, ageDays, stale: ageDays > cfg.authority.maxAgeDays, source: doc.source, cacheFile: file, level: "domain",
    referringDomains: fact(me.linkingDomains, doc.source, doc.fetchedAt, file), harmonicPos: me.harmonicPos ?? null, linkingDomains: list.map((l) => l.domain), truncated: me.linkingDomains > list.length,
    competitors, linkGap: (doc.linkGap || []).slice(0, 50) };
}

function collectConversions(cfg, loc) {
  const f = path.join(loc.pewp, cfg.captures.conversions);
  const j = readJson(f);
  if (!j) return { status: "blocked", blocked: { source: "analytics", reason: "no conversion data (analytics access not given)", unblock: `Export conversions per landing page from GA4 as JSON [{ "page": "/path", "goal": "leads", "conversions": 3, "start": "...", "end": "..." }] to ${f}.` } };
  return { status: "ok", rows: (Array.isArray(j) ? j : j.rows || []).map((r) => ({ page: normPath(r.page), goal: r.goal || null, conversions: Number(r.conversions) || 0 })), source: "analytics export (owner), " + f, cacheFile: f, fetchedAt: fs.statSync(f).mtime.toISOString() };
}

// The newest two local grids (local/<date>/grid.json), newest first = cur.
function gridRuns(loc) {
  const dir = path.join(loc.pewp, "local"); if (!fs.existsSync(dir)) return { cur: null, prev: null };
  const ds = fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d) && fs.existsSync(path.join(dir, d, "grid.json"))).sort();
  const rd = (d) => { const j = readJson(path.join(dir, d, "grid.json")); return j?.status === "ok" ? j : null; };
  return { cur: ds.length ? rd(ds.at(-1)) : null, prev: ds.length > 1 ? rd(ds.at(-2)) : null };
}
function latestLocal(loc, kind) {
  const dir = path.join(loc.pewp, "local");
  if (!fs.existsSync(dir)) return null;
  for (const d of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x)).sort().reverse()) { const j = readJson(path.join(dir, d, `${kind}.json`)); if (j) return { ...j, _file: path.join(dir, d, `${kind}.json`) }; }
  return null;
}

// ---------- rules MSR-001..010 ----------
export function evaluateRules(cur, prev, diff, cfg, tInfo, loc, ctr) {
  const th = cfg.thresholds; const findings = [], blockedRules = [];
  const block = (rule, source, reason, unblock) => blockedRules.push({ rule, status: "BLOCKED", source, reason, unblock });
  const add = (rule, title, detail, evidence, significance, fix) => findings.push({ rule, severity: "W", title, detail, evidence, significance, fix });
  const gsc = cur.gsc, tq = new Set(tInfo.queries.map(nfkc));
  const rowsOf = (win, t) => (gsc.status === "ok" ? gsc.tables[win][t] || [] : []);
  const prov = (t, win = "current") => gsc.provenance?.find((p) => p.table === `${win}.${t}`) || {};
  const sf = (v, t, extra = {}, win = "current") => fact(v, `Google Search Console ${win} window (${t})`, prov(t, win).fetchedAt || gsc.fetchedAt, (prov(t, win).cacheFiles || []).join("; ") || null, extra);

  // MSR-001
  if (cur.index.status === "blocked") block("MSR-001", cur.index.blocked.source, cur.index.blocked.reason, cur.index.blocked.unblock);
  else for (const r of cur.index.results || []) if (r.verdict !== "PASS") add("MSR-001", `Planned page not indexed: ${r.path}`, `Google reports "${r.coverageState || r.verdict}" for ${r.url}.`, { url: r.url, coverageState: r.coverageState, verdict: r.verdict, lastCrawl: r.lastCrawlTime, fetchedAt: r.fetchedAt, cacheFile: r.cacheFile }, "index status is not PASS", "Open the page in Search Console URL Inspection and fix the reported reason.");

  // MSR-002
  if (cur.rankings.status === "blocked") block("MSR-002", cur.rankings.blocked.source, cur.rankings.blocked.reason, cur.rankings.blocked.unblock);
  else {
    const seen = new Set();
    for (const r of cur.rankings.rows) {
      const pos = r.position.value; if (pos == null) continue;
      const above = r.above?.length ? r.above.slice(0, 5).join(", ") : "not known (needs a browser capture of the result page)";
      if (pos > th.topPositions && !seen.has(rankKey(r))) { seen.add(rankKey(r)); add("MSR-002", `Outside the top ${th.topPositions}: "${r.query}" (${r.device}, ${r.location})`, `Average position ${pos.toFixed(1)}.`, { position: r.position, domainsAbove: above }, `position > measure.topPositions (${th.topPositions})`, "See the cluster brief; compare with the pages above."); }
      if (r.previous && r.impressions >= th.minImpressions && r.previous.impressions >= th.minImpressions && pos - r.previous.position >= th.positionDelta)
        add("MSR-002", `Ranking got worse: "${r.query}" (${r.device})`, `Average position ${r.previous.position.toFixed(1)} -> ${pos.toFixed(1)} (${(pos - r.previous.position).toFixed(1)} places worse).`, { position: r.position, previous: r.previous, domainsAbove: above }, `06 9.8: change >= ${th.positionDelta} positions with >= ${th.minImpressions} impressions in both windows`, "Check what changed on the page and who now ranks above.");
    }
    for (const c of diff.rankChanges || []) if (c.significant && c.delta >= th.positionDelta) add("MSR-002", `Ranking got worse since the last run: "${c.query}" (${c.device}, ${c.location})`, `Position ${c.from} -> ${c.to}.`, { from: c.from, to: c.to, source: c.source, domainsAbove: c.above }, `06 9.8: change >= ${th.positionDelta} positions, same query, source, place, device and language`, "Check the page and the results above it.");
  }
  // MSR-003
  if (!tInfo.present) block("MSR-003", "targets.json", "no targets.json: unplanned demand cannot be told from planned demand", "Run the research stage.");
  else if (gsc.status !== "ok") block("MSR-003", gsc.blocked.source, gsc.blocked.reason, gsc.blocked.unblock);
  else {
    const un = rowsOf("current", "query").filter((r) => r.impressions >= th.minImpressions && !tInfo.queries.some((q) => containsWords(r.keys[0], q))).sort((a, b) => b.impressions - a.impressions).slice(0, 50);
    for (const r of un) add("MSR-003", `Unplanned demand: "${r.keys[0]}"`, `${r.impressions} impressions and ${r.clicks} clicks, and no planned page is about it.`, { impressions: sf(r.impressions, "query"), clicks: sf(r.clicks, "query"), position: sf(r.position, "query", { estimate: true }) }, `>= ${th.minImpressions} impressions in the window, matches no cluster query (whole words)`, "Proposed for the next research run.");
  }
  // MSR-004
  if (gsc.status !== "ok") block("MSR-004", gsc.blocked.source, gsc.blocked.reason, gsc.blocked.unblock);
  else if (!tInfo.present) block("MSR-004", "targets.json", "no target queries", "Run the research stage.");
  else {
    const topPage = new Map();
    for (const r of rowsOf("current", "queryPage")) { const k = nfkc(r.keys[0]); if (!topPage.has(k) || topPage.get(k).impressions < r.impressions) topPage.set(k, { page: r.keys[1], impressions: r.impressions }); }
    for (const r of rowsOf("current", "query")) {
      if (!tq.has(nfkc(r.keys[0])) || r.position > 5 || r.impressions < th.minImpressions) continue;
      const exp = ctr.positions[Math.min(10, Math.max(1, Math.round(r.position))) - 1];
      if (r.ctr < th.ctrFloorRatio * exp) add("MSR-004", `Low click-through: "${r.keys[0]}"`, `Position ${r.position.toFixed(1)} but only ${fmtPct(r.ctr)} click (expected about ${fmtPct(exp)} at that position). Look at the title and description of ${topPage.get(nfkc(r.keys[0]))?.page || "the ranking page"}.`, { ctr: sf(r.ctr, "query"), position: sf(r.position, "query", { estimate: true }), impressions: sf(r.impressions, "query"), expectedCtr: fact(exp, ctr.source, null, null, { estimate: true }), page: topPage.get(nfkc(r.keys[0]))?.page || null }, `CTR < ${th.ctrFloorRatio} x expected CTR at position <= 5 with >= ${th.minImpressions} impressions`, "Rewrite the title and meta description to match the search intent.");
    }
  }
  // MSR-005
  if (cur.ai.status === "blocked") block("MSR-005", cur.ai.blocked.source, cur.ai.blocked.reason, cur.ai.blocked.unblock);
  else {
    for (const r of cur.ai.rows) {
      if (r.citedShare.value === 0 && r.competitorsCited.length) add("MSR-005", `Not cited by ${r.engine}: "${r.question}"`, `We were cited in 0 of ${r.runs} answers; cited instead: ${r.competitorsCited.join(", ")}.`, { citedShare: r.citedShare, citedSources: r.citedSources.slice(0, 8), engine: r.engine, model: r.model, date: r.citedShare.fetchedAt }, "citation rate 0 while a competitor is cited", "See the AI-visibility plan: entity consistency, citable facts, the sources the engine cites.");
    }
    for (const c of diff.aiChanges || []) if (c.significant && c.countDelta < 0) add("MSR-005", `Citation rate fell: "${c.question}" (${c.engine})`, `Cited in ${c.from.cited} of ${c.from.runs} answers before, ${c.to.cited} of ${c.to.runs} now.`, { from: c.from, to: c.to, engine: c.engine, dates: [c.fromDate, c.toDate] }, `06 9.8: cited count differs by >= ${th.aiSampleDelta} of the samples`, "Check what the cited sources have that our page lacks.");
  }
  // MSR-006
  if (cur.crux.status === "blocked") block("MSR-006", cur.crux.blocked.source, cur.crux.blocked.reason, cur.crux.blocked.unblock);
  else {
    for (const r of cur.crux.results || []) {
      if (r.noFieldData) continue;
      for (const [m, v] of Object.entries(r.metrics || {})) if (v.status && v.status !== "good") add("MSR-006", `Field speed ${v.status}: ${m.replace(/_/g, " ")} at ${r.target}`, `Real-visitor 75th percentile is ${v.p75} (${v.status}).`, { p75: fact(v.p75, "Chrome UX Report API, field data", r.fetchedAt, r.cacheFile, { device: r.formFactor.toLowerCase() }), status: v.status }, "p75 status is not good", "Use the lab run (audit-live speed) to find the cause.");
    }
    for (const c of diff.cruxChanges || []) if (c.worse) add("MSR-006", `Field speed got worse: ${c.metric.replace(/_/g, " ")} at ${c.target}`, `${c.from} -> ${c.to}.`, { from: c.from, to: c.to }, "06 9.8: p75 status changed", "Check what shipped since the last run.");
  }
  // MSR-007
  if (cur.authority.status === "blocked") block("MSR-007", cur.authority.blocked.source, cur.authority.blocked.reason, cur.authority.blocked.unblock);
  else if (diff.authority?.comparable && diff.authority.lostCount > 0) {
    const [lo] = poissonInterval(diff.authority.fromCount);
    if (diff.authority.toCount < lo) add("MSR-007", "Lost referring domains", `Common Crawl release ${diff.authority.fromRelease} -> ${diff.authority.toRelease}: ${diff.authority.fromCount} -> ${diff.authority.toCount} linking domains (${diff.authority.lostCount} lost${diff.authority.truncated ? ", list truncated" : ""}).`, { from: diff.authority.fromCount, to: diff.authority.toCount, lost: diff.authority.lost.slice(0, 20) }, "count below the 95% Poisson interval of the previous count", "Reclaim the strongest lost links; see the off-site plan.");
  }
  if (cur.authority.status === "ok" && cur.authority.linkGap?.length) {
    const prospects = cfg.prospects?.length ? cur.authority.linkGap.filter((g) => cfg.prospects.includes(g.domain)) : cur.authority.linkGap.slice(0, 10);
    // with the target not in the graph "not linking to us" cannot be judged: the list is the sites that link to competitors
    const judged = cur.authority.inGraph !== false;
    if (prospects.length) add("MSR-007", judged ? "Link prospects still not linking" : "Link prospects (not judged: the site is not found in the link data)", judged ? `${prospects.length} sites link to 2 or more competitors and not to us: ${prospects.slice(0, 8).map((p) => p.domain).join(", ")}.` : `${prospects.length} sites link to 2 or more competitors; whether they already link to this site cannot be judged (the site is not found in the link data): ${prospects.slice(0, 8).map((p) => p.domain).join(", ")}.`, { prospects: prospects.slice(0, 20), source: cur.authority.source, level: "domain" }, "link-intersect list from the domain-level web graph (not a significance test)", "Outreach list for the off-site plan.");
  }
  // MSR-008
  if (gsc.status !== "ok") block("MSR-008", gsc.blocked.source, gsc.blocked.reason, gsc.blocked.unblock);
  else if (!tInfo.present) block("MSR-008", "targets.json", "no target queries", "Run the research stage.");
  else {
    const by = new Map();
    for (const r of rowsOf("current", "queryPage")) { const k = nfkc(r.keys[0]); if (tq.has(k) && r.impressions > 0) (by.get(k) || by.set(k, []).get(k)).push({ page: r.keys[1], impressions: r.impressions }); }
    for (const [k, list] of by) {
      if (list.length < 2) continue;
      list.sort((a, b) => b.impressions - a.impressions);
      const cl = tInfo.clusters.find((c) => [c.primaryQuery, ...(c.queries || [])].some((q) => nfkc(q) === k));
      const planned = cl?.targetPage && cl.targetPage !== "new" ? normPath(cl.targetPage) : null;
      if (!planned || normPath(list[0].page) !== planned) add("MSR-008", `Two pages compete for "${k}"`, `${list.length} of our pages got impressions; the most is ${list[0].page}${planned ? `, not the planned ${planned}` : " (no page is planned for it yet)"}.`, { pages: list.slice(0, 5).map((p) => ({ page: p.page, impressions: sf(p.impressions, "queryPage") })), planned }, "2+ URLs with impressions and the planned page is not first", "Merge or differentiate the pages; point internal links at the planned one.");
    }
  }
  // MSR-009
  if (cur.conversions.status === "blocked") block("MSR-009", cur.conversions.blocked.source, cur.conversions.blocked.reason, cur.conversions.blocked.unblock);
  else if (gsc.status !== "ok") block("MSR-009", gsc.blocked.source, gsc.blocked.reason, gsc.blocked.unblock);
  else {
    const planned = new Set(tInfo.pages.map((p) => p.path));
    const top = rowsOf("current", "page").map((r) => ({ path: normPath(r.keys[0]), clicks: r.clicks })).filter((r) => planned.has(r.path)).sort((a, b) => b.clicks - a.clicks).slice(0, th.conversionPages);
    for (const p of top) if (p.clicks > 0 && !cur.conversions.rows.some((c) => c.page === p.path && c.conversions > 0)) add("MSR-009", `Traffic without conversions: ${p.path}`, `${p.clicks} clicks and no conversion recorded.`, { clicks: sf(p.clicks, "page"), conversions: fact(0, cur.conversions.source, cur.conversions.fetchedAt, cur.conversions.cacheFile) }, `among the top ${th.conversionPages} target pages by clicks`, "Check the call to action and the page's promise against the query intent.");
  }
  // MSR-010
  const nap = latestLocal(loc, "nap");
  const grid = latestLocal(loc, "grid");
  if (!nap && !grid) block("MSR-010", "local", "no local NAP check and no local grid yet", "Run scripts/local-run.mjs (needs business.json and citation captures) and/or scripts/local-grid.mjs plan + import (map-pack captures per grid point).");
  else if (nap && nap.status === "blocked" && !grid) block("MSR-010", nap.blocked?.source || "local", nap.blocked?.reason, nap.blocked?.unblock);
  else if (nap && nap.status !== "blocked") for (const m of nap.mismatches || []) add("MSR-010", `Name/address/phone differs on ${m.directory}`, m.detail, { mismatch: m, file: nap._file }, "listing differs from business.json after normalisation", "Correct the listing.");
  if (nap?.status === "ok") for (const d of nap.missingDirectories || []) add("MSR-010", `No listing on ${d}`, `The business has no captured listing on ${d}.`, { directory: d, file: nap._file }, "directory of citation-sources has no listing", "Create or claim the listing with the exact same name, address and phone.");
  // MSR-010, local grid: weak map-pack coverage around a service-area city, and 3-pack positions lost since the previous grid
  if (grid?.status === "ok") {
    for (const s of grid.solv || []) {
      if (s.solv3.value != null && s.solv3.value < th.gridSov3Floor) add("MSR-010", `Weak map-pack coverage: "${s.query}" around ${s.city}`, `We are in the 3-pack at ${s.pointsIn3Pack} of ${s.localizedPoints} grid points (${Math.round(s.solv3.value * 100)}%), in the pack at all at ${s.pointsInPack}; the 3-pack is held by ${s.topCompetitors.map((c) => c.name).join(", ") || "other businesses"}${s.partial ? "; only part of the grid is captured" : ""}.`, { solv3: s.solv3, presence: s.presence, coverage: s.coverage, topCompetitors: s.topCompetitors, file: grid._file }, `share of local voice below ${th.gridSov3Floor} (owner captures, mobile; a coverage figure, not a significance test)`, "Profile categories, reviews and a real page for this city: see the local plan.");
    }
    for (const c of diff.grid?.perCity || []) if (c.left3 >= 2 || c.net3 <= -2) add("MSR-010", `Lost map-pack positions: "${c.query}" around ${c.city}`, `${c.left3} grid points left the 3-pack and ${c.entered3} entered it since the previous grid (share of local voice ${c.solv3From == null ? "?" : Math.round(c.solv3From * 100) + "%"} -> ${c.solv3To == null ? "?" : Math.round(c.solv3To * 100) + "%"}).`, { perCity: c, file: grid._file }, "06 9.8 style: the 3-pack points changed by 2 or more between identical points (same query, city, coordinates, device, language)", "Check the listing, recent reviews and what the competitors in the pack changed.");
  }
  return { findings, blocked: blockedRules };
}

// ---------- diff against the last earlier run ----------
export function loadRun(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const r = {}; for (const k of ["gsc", "bing", "crux", "index", "ai", "authority", "conversions"]) r[k] = readJson(path.join(dir, `${k}.json`));
  r.rankings = readJson(path.join(dir, "rank-detail.json"));
  r.dir = dir; r.date = path.basename(dir); return r.gsc ? r : null;
}
export function previousRunDir(measureRoot, date) {
  if (!fs.existsSync(measureRoot)) return null;
  const ds = fs.readdirSync(measureRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < date && fs.existsSync(path.join(measureRoot, d, "gsc.json"))).sort();
  return ds.length ? path.join(measureRoot, ds.at(-1)) : null;
}
const topN = (a, n = 15) => a.slice(0, n);
export function diffRuns(prev, cur, cfg) {
  const th = cfg.thresholds;
  if (!prev) return { baseline: true, note: "First run: nothing to compare yet. This run is the baseline for the next one." };
  const d = { baseline: false, previousDate: prev.date, currentDate: cur.date };
  const mapQ = (rows) => new Map((rows || []).map((r) => [nfkc(r.keys.join(" | ")), r]));
  const tableDiff = (a, b, label) => {
    const A = mapQ(a), B = mapQ(b), ch = [], gained = [], lost = [];
    for (const [k, r] of B) { const o = A.get(k); if (!o) { gained.push({ key: r.keys.join(" | "), clicks: r.clicks, impressions: r.impressions }); continue; }
      const dc = r.clicks - o.clicks; const sig = clicksChanged(o.clicks, r.clicks);
      const posDelta = (o.position != null && r.position != null && o.impressions >= th.minImpressions && r.impressions >= th.minImpressions) ? r.position - o.position : null;
      if (dc !== 0 || posDelta) ch.push({ key: r.keys.join(" | "), clicksFrom: o.clicks, clicksTo: r.clicks, clicksDelta: dc, significant: sig, positionFrom: o.position, positionTo: r.position, positionDelta: posDelta, positionSignificant: posDelta != null && Math.abs(posDelta) >= th.positionDelta }); }
    for (const [k, o] of A) if (!B.has(k)) lost.push({ key: o.keys.join(" | "), clicks: o.clicks, impressions: o.impressions });
    return { label, gains: topN(ch.filter((x) => x.clicksDelta > 0).sort((x, y) => y.clicksDelta - x.clicksDelta)), losses: topN(ch.filter((x) => x.clicksDelta < 0).sort((x, y) => x.clicksDelta - y.clicksDelta)), positionGains: topN(ch.filter((x) => x.positionSignificant && x.positionDelta < 0)), positionLosses: topN(ch.filter((x) => x.positionSignificant && x.positionDelta > 0)),
      newKeys: topN(gained.sort((x, y) => y.clicks - x.clicks)), lostKeys: topN(lost.sort((x, y) => y.clicks - x.clicks)) };
  };
  const sameWindow = prev.gsc?.windows?.current && JSON.stringify(prev.gsc.windows.current) === JSON.stringify(cur.gsc?.windows?.current);
  if (prev.gsc?.status === "ok" && cur.gsc?.status === "ok") {
    d.gsc = { sameWindow, note: sameWindow ? "same window as the last run (no new data yet)" : `windows ${prev.gsc.windows.current.start}..${prev.gsc.windows.current.end} vs ${cur.gsc.windows.current.start}..${cur.gsc.windows.current.end}`,
      totals: { from: prev.gsc.totals.current, to: cur.gsc.totals.current }, queries: tableDiff(prev.gsc.tables.current.query, cur.gsc.tables.current.query, "queries"), pages: tableDiff(prev.gsc.tables.current.page, cur.gsc.tables.current.page, "pages") };
  } else d.gsc = { skipped: "Search Console missing in one of the two runs" };
  // rankings: only identical (query, engine, source, place, device, language) are compared; never across places
  const pr = new Map((prev.rankings?.rows || []).map((r) => [rankKey(r), r])); d.rankChanges = []; d.rankingsNotComparable = 0;
  for (const r of cur.rankings?.rows || []) {
    const o = pr.get(rankKey(r)); if (!o) { d.rankingsNotComparable++; continue; }
    const from = o.position.value, to = r.position.value; if (from == null && to == null) continue;
    const delta = from == null ? null : to == null ? null : to - from;
    const significant = delta != null && Math.abs(delta) >= th.positionDelta && (r.source !== "search-console" || (r.impressions >= th.minImpressions && (o.impressions || 0) >= th.minImpressions));
    d.rankChanges.push({ query: r.query, source: r.source, location: r.location, device: r.device, language: r.language, from, to, delta, significant, entered: from == null && to != null, dropped: from != null && to == null, above: r.above || null });
  }
  d.rankGains = d.rankChanges.filter((c) => c.significant && c.delta < 0 || c.entered); d.rankLosses = d.rankChanges.filter((c) => c.significant && c.delta > 0 || c.dropped);
  // AI citations: shares, not single answers; new / lost citations
  const pa = new Map((prev.ai?.rows || []).map((r) => [nfkc(r.question) + "|" + r.engine, r])); d.aiChanges = []; d.newCitations = []; d.lostCitations = [];
  for (const r of cur.ai?.rows || []) {
    const o = pa.get(nfkc(r.question) + "|" + r.engine); if (!o) continue;
    const countDelta = r.citedCount - o.citedCount;
    const sig = o.runs === r.runs ? Math.abs(countDelta) >= th.aiSampleDelta : Math.abs(r.citedShare.value - o.citedShare.value) * Math.max(o.runs, r.runs) >= th.aiSampleDelta;
    d.aiChanges.push({ question: r.question, engine: r.engine, from: { cited: o.citedCount, runs: o.runs, share: o.citedShare.value }, to: { cited: r.citedCount, runs: r.runs, share: r.citedShare.value }, countDelta, significant: sig, fromDate: o.citedShare.fetchedAt, toDate: r.citedShare.fetchedAt });
    const A = new Set(o.citedSources || []), B = new Set(r.citedSources || []);
    for (const x of B) if (!A.has(x)) d.newCitations.push({ question: r.question, engine: r.engine, domain: x, ours: isOurs(x, cfg.domain, cfg.aliases) });
    for (const x of A) if (!B.has(x)) d.lostCitations.push({ question: r.question, engine: r.engine, domain: x, ours: isOurs(x, cfg.domain, cfg.aliases) });
  }
  // authority: referring domains gained / lost (only meaningful when the Common Crawl release differs)
  const pa2 = prev.authority, ca = cur.authority;
  if (pa2?.status === "ok" && ca?.status === "ok" && pa2.inGraph && ca.inGraph) {
    const A = new Set(pa2.linkingDomains), B = new Set(ca.linkingDomains);
    d.authority = { comparable: pa2.release !== ca.release, fromRelease: pa2.release, toRelease: ca.release, fromCount: pa2.referringDomains.value, toCount: ca.referringDomains.value, gained: [...B].filter((x) => !A.has(x)), lost: [...A].filter((x) => !B.has(x)), truncated: pa2.truncated || ca.truncated, level: "domain" };
    d.authority.gainedCount = d.authority.gained.length; d.authority.lostCount = d.authority.lost.length;
    if (!d.authority.comparable) d.authority.note = `same Common Crawl release (${ca.release}): no new link data since the last run`;
  } else d.authority = { skipped: "authority missing in one of the two runs" };
  // CrUX by status
  d.cruxChanges = []; const order = { good: 0, "needs improvement": 1, poor: 2 };
  const pc = new Map((prev.crux?.results || []).filter((r) => !r.noFieldData).map((r) => [r.target + "|" + r.formFactor, r]));
  for (const r of (cur.crux?.results || []).filter((x) => !x.noFieldData)) { const o = pc.get(r.target + "|" + r.formFactor); if (!o) continue;
    for (const [m, v] of Object.entries(r.metrics)) { const ov = o.metrics?.[m]; if (ov && ov.status !== v.status) d.cruxChanges.push({ target: r.target, metric: m, from: ov.status, to: v.status, worse: order[v.status] > order[ov.status] }); } }
  return d;
}

// ---------- plain-words report ----------
export function writeReport(dir, ctx) {
  const { cfg, cur, diff, rules, plan, date, prompts } = ctx; // prompts: { info, doc, part } when a prompt map exists (slice 5d)
  const used = new Set();
  const term = (t, def) => (used.has(t) ? t : (used.add(t), `${t} (${def})`));
  const L = [];
  const g = cur.gsc;
  const blockedAll = [["Search Console", cur.gsc], ["URL Inspection", cur.index], ["Bing", cur.bing], ["Field speed", cur.crux], ["Rankings", cur.rankings], ["AI answers", cur.ai], ["Authority", cur.authority], ["Conversions", cur.conversions], ...(prompts?.part ? [["Prompt map", prompts.part]] : [])].filter(([, s]) => s.status === "blocked");
  const nums = [];
  const num = (label, f) => nums.push({ label, ...f });
  let headline;
  if (g.status === "ok") {
    const a = g.totals.current, b = g.totals.previous;
    const pct = b.clicks ? Math.round(((a.clicks - b.clicks) / b.clicks) * 100) : null;
    const pf = g.provenance.find((p) => p.table === "current.device") || {};
    num("clicks, last 28 days", fact(a.clicks, "Google Search Console (device table, summed)", pf.fetchedAt, (pf.cacheFiles || []).join("; "))); num("clicks, the 28 days before", fact(b.clicks, "Google Search Console (device table, summed)", g.provenance.find((p) => p.table === "previous.device")?.fetchedAt, (g.provenance.find((p) => p.table === "previous.device")?.cacheFiles || []).join("; ")));
    num("impressions, last 28 days", fact(a.impressions, "Google Search Console (device table, summed)", pf.fetchedAt, (pf.cacheFiles || []).join("; ")));
    const sig = clicksChanged(b.clicks, a.clicks);
    headline = `In the last 28 days Google sent ${a.clicks} visits (${pct == null ? "no earlier figure" : `${pct >= 0 ? "+" : ""}${pct}% against the 28 days before`}${b.clicks ? (sig ? ", a real change" : ", within normal noise") : ""})`;
  } else headline = "Google visits could not be measured: Search Console is not connected";
  const top = cur.rankings.rows?.filter((r) => r.source === "search-console" && r.position.value != null) || [];
  if (cur.rankings.status !== "blocked") headline += `; ${top.filter((r) => r.position.value <= cfg.thresholds.topPositions).length} of ${new Set(top.map((r) => nfkc(r.query))).size} ranked target queries are on page 1`;
  if (cur.ai.status !== "blocked" && cur.ai.rows.length) headline += `; AI engines cited us in ${cur.ai.rows.reduce((n, r) => n + r.citedCount, 0)} of ${cur.ai.rows.reduce((n, r) => n + r.runs, 0)} answers`;
  headline += `. ${rules.findings.length} things to look at, ${blockedAll.length} parts not measured yet.`;
  L.push(`# How ${cfg.domain} is doing in search, ${date}`, "", `**${headline}**`, "");
  L.push(`This is the measurement run of ${date}${diff.baseline ? " (the first one: it is the starting point for the next)" : `, compared with ${diff.previousDate}`}. Every number below comes from a named source and a date in \`report.json\`.`, "");
  if (g.status === "ok") {
    L.push("## What Google shows", "", `${term("A click", "someone visited our page from Google")}, ${term("an impression", "our page was shown in the results")}, ${term("position", "where we sit in the results, 1 is the top")}.`, "",
      `| | last 28 days | the 28 days before |`, "|---|---|---|", `| clicks | ${g.totals.current.clicks} | ${g.totals.previous.clicks} |`, `| impressions | ${g.totals.current.impressions} | ${g.totals.previous.impressions} |`,
      `| ${term("click-through rate", "clicks divided by impressions")} | ${fmtPct(g.totals.current.ctr)} | ${fmtPct(g.totals.previous.ctr)} |`, `| average position | ${g.totals.current.position?.toFixed(1) ?? "-"} | ${g.totals.previous.position?.toFixed(1) ?? "-"} |`, "");
  } else L.push("## What Google shows", "", `NOT MEASURED. ${g.blocked.reason}. To fix: ${g.blocked.unblock}`, "");
  if (!diff.baseline && diff.gsc?.queries) {
    const q = diff.gsc.queries, p = diff.gsc.pages;
    L.push("## What changed since the last run", "", diff.gsc.note + ".", "");
    const fm = (a) => a.map((x) => `${x.key} (${x.clicksFrom} -> ${x.clicksTo} clicks${x.significant ? ", real change" : ""})`).join("; ") || "none";
    L.push(`- Searches that brought more visits: ${fm(q.gains.slice(0, 5))}`, `- Searches that brought fewer: ${fm(q.losses.slice(0, 5))}`, `- New searches: ${q.newKeys.slice(0, 5).map((x) => x.key).join("; ") || "none"}; lost searches: ${q.lostKeys.slice(0, 5).map((x) => x.key).join("; ") || "none"}`,
      `- Pages gaining: ${fm(p.gains.slice(0, 5))}; pages losing: ${fm(p.losses.slice(0, 5))}`);
    if (diff.rankChanges?.length) L.push(`- Rank moves (same place and device only): ${diff.rankChanges.filter((c) => c.significant || c.entered || c.dropped).slice(0, 6).map((c) => `"${c.query}" ${c.from ?? "-"} -> ${c.to ?? "-"} (${c.device}, ${c.location})`).join("; ") || "no real moves"}`);
    if (diff.grid && !diff.grid.baseline) L.push(`- Map-pack grid (same points only): ${diff.grid.perCity.map((c) => `"${c.query}" around ${c.city}: ${c.entered3} points entered the 3-pack, ${c.left3} left it`).join("; ") || "no comparable points"}`);
    if (diff.newCitations?.length || diff.lostCitations?.length) L.push(`- AI answers: new sources cited ${diff.newCitations.slice(0, 5).map((c) => c.domain).join(", ") || "none"}; no longer cited ${diff.lostCitations.slice(0, 5).map((c) => c.domain).join(", ") || "none"}`);
    if (diff.authority?.comparable !== undefined) L.push(`- ${term("Referring domains", "other websites that link to us")}: ${diff.authority.comparable ? `${diff.authority.gainedCount} gained, ${diff.authority.lostCount} lost` : diff.authority.note}`);
    L.push("");
  }
  L.push("## What to look at", "");
  if (!rules.findings.length) L.push("No finding this run.", "");
  for (const f of rules.findings.slice(0, 40)) L.push(`- **${f.title}** (${f.rule}). ${f.detail} Fix: ${f.fix}`);
  if (rules.findings.length > 40) L.push(`- ... and ${rules.findings.length - 40} more in findings.json`);
  L.push("", "## AI answers", "");
  if (cur.ai.rows?.length) for (const r of cur.ai.rows.slice(0, 15)) L.push(`- "${r.question}" on ${r.engine}: cited in ${r.citedCount} of ${r.runs} answers${r.lowSample ? " (too few answers to trust)" : ""}${r.competitorsCited.length ? `; cited instead: ${r.competitorsCited.join(", ")}` : ""}.`);
  else L.push(`NOT MEASURED. ${cur.ai.blocked?.reason || "no answers"}. To fix: ${cur.ai.blocked?.unblock || ""}`);
  L.push("", "## Prompts (what each AI engine says to a buyer's whole question)", "");
  if (!prompts?.info?.present) L.push("No prompt map yet (the research stage writes research/prompt-map.json): nothing to re-run this month.");
  else if (!prompts.info.ok) L.push(`NOT MEASURED. ${prompts.info.reason}. To fix: run research-prompts.mjs --check, fix the rows it names, then approve the map again.`);
  else {
    const rs = prompts.doc.rows;
    L.push(`${rs.length} prompt(s) from ${prompts.info.rel}${prompts.info.approved ? " (signed by the owner)" : " (not yet signed)"}; observations from ${prompts.doc.window.from} (not included) to ${prompts.doc.window.to}. "Not checked" means nobody looked this month; it is never a "no".`, "");
    for (const r of rs.slice(0, 40)) L.push(`- ${r.id} "${r.prompt}"${r.location ? ` (${r.location})` : ""}: ${ENGINES.map((e) => engineText(e, r.engines[e])).join("; ")}.`);
    if (rs.length > 40) L.push(`- ... and ${rs.length - 40} more in prompt-map.json`);
    const pd = diff.promptMap;
    if (pd && !pd.baseline) {
      L.push("", `Since ${pd.previousDate}: named gained ${pd.counts.namedGained}, named lost ${pd.counts.namedLost}, cited gained ${pd.counts.citedGained}, cited lost ${pd.counts.citedLost}, cited page changed ${pd.counts.pageChanged}; ${pd.counts.firstLooks} first look(s), ${pd.counts.lostLooks} prompt/engine pair(s) not checked this month.`);
      for (const c of pd.changes.slice(0, 20)) L.push(`- ${c.id} on ${c.engine}: ${c.field === "pageCited" ? `cited page ${c.from} -> ${c.to}` : `${c.field} ${tri(c.from)} -> ${tri(c.to)}`}`);
    } else if (pd) L.push("", pd.note);
  }
  L.push("", "## Not measured yet (BLOCKED)", "");
  if (!blockedAll.length && !rules.blocked.length) L.push("Nothing is blocked.");
  for (const [n, s] of blockedAll) L.push(`- **${n}**: ${s.blocked.reason}. To fix: ${s.blocked.unblock}`);
  for (const [n, s] of [["Search Console", cur.gsc], ["Bing", cur.bing], ["Field speed", cur.crux], ["Rankings", cur.rankings], ["AI answers", cur.ai], ["URL Inspection", cur.index], ...(prompts?.part ? [["Prompt map", prompts.part]] : [])].filter(([, s]) => s.status === "partial" && s.blocked)) L.push(`- **${n}** (only partly measured): ${s.blocked.reason}. To fix: ${s.blocked.unblock}`);
  L.push("", `Cost of this run: ${plan.lines.slice(2, 5).map((x) => x.trim()).join(" | ")}. Re-run: \`node ${path.join(cfg.cwd || ".", "site-checks", cfg.domain || "", ".pewp", "measure", "run.mjs")}\` (no model needed).`);
  fs.writeFileSync(path.join(dir, "report.md"), L.join("\n") + "\n");
  const rj = { generatedAt: new Date().toISOString(), date, target: cfg.target, headline, numbers: nums, sources: Object.fromEntries(blockedAll.map(([n, s]) => [n, { status: "BLOCKED", ...s.blocked }])), findings: rules.findings, rulesBlocked: rules.blocked, diffFile: "diff.json",
    ...(prompts?.info?.present ? { promptMap: { status: prompts.part?.status || "ok", file: PROMPT_FILE, rows: prompts.doc?.rows?.length ?? 0, observedRows: prompts.doc?.observedRows ?? 0, changes: diff.promptMap?.counts || null } } : {}) };
  writeJson(path.join(dir, "report.json"), rj);
  return rj;
}

// diff.md is plain, for people who open the folder
function promptDiffMarkdown(pd) {
  if (!pd) return [];
  if (pd.baseline) return ["", "## Prompt map", "", pd.note, ""];
  const L = ["", `## Prompt map ${pd.previousDate} -> ${pd.currentDate}`, ""];
  for (const c of pd.changes) L.push(`- ${c.id} [${c.engine}] ${c.field}: ${c.field === "pageCited" ? `${c.from} -> ${c.to}` : `${tri(c.from)} -> ${tri(c.to)}`}`);
  for (const x of pd.firstLooks) L.push(`- first look: ${x.id} [${x.engine}] named ${tri(x.named)}, cited ${tri(x.cited)}`);
  for (const x of pd.lostLooks) L.push(`- not checked this month: ${x.id} [${x.engine}] (last seen ${x.lastSeen})`);
  for (const x of pd.rowsAdded) L.push(`- new prompt: ${x.id} "${x.prompt}"`);
  for (const x of pd.rowsRemoved) L.push(`- prompt gone from the map: ${x.id} "${x.prompt}"`);
  if (!pd.changes.length) L.push("- no named, cited or cited-page flip");
  return [...L, ""];
}
function diffMarkdown(diff) {
  if (diff.baseline) return [`# Diff`, "", diff.note, ...promptDiffMarkdown(diff.promptMap)].join("\n") + "\n";
  const L = [`# Diff ${diff.previousDate} -> ${diff.currentDate}`, ""];
  if (diff.gsc?.queries) { for (const [n, t] of [["Queries", diff.gsc.queries], ["Pages", diff.gsc.pages]]) { L.push(`## ${n}: gains and losses (clicks)`, ""); for (const x of t.gains) L.push(`- + ${x.key}: ${x.clicksFrom} -> ${x.clicksTo}${x.significant ? " (significant)" : ""}`); for (const x of t.losses) L.push(`- - ${x.key}: ${x.clicksFrom} -> ${x.clicksTo}${x.significant ? " (significant)" : ""}`); for (const x of t.newKeys) L.push(`- new: ${x.key} (${x.clicks} clicks)`); for (const x of t.lostKeys) L.push(`- lost: ${x.key} (was ${x.clicks} clicks)`); L.push(""); } }
  L.push("## Rankings (same query, source, place, device, language)", ""); for (const c of diff.rankChanges) L.push(`- ${c.query} [${c.source}, ${c.location}, ${c.device}]: ${c.from ?? "-"} -> ${c.to ?? "-"}${c.significant ? " (significant)" : ""}`);
  L.push("", "## AI citations", ""); for (const c of diff.aiChanges) L.push(`- ${c.question} [${c.engine}]: ${c.from.cited}/${c.from.runs} -> ${c.to.cited}/${c.to.runs}${c.significant ? " (significant)" : ""}`); for (const c of diff.newCitations) L.push(`- new citation: ${c.domain}${c.ours ? " (OURS)" : ""} for "${c.question}"`); for (const c of diff.lostCitations) L.push(`- lost citation: ${c.domain}${c.ours ? " (OURS)" : ""} for "${c.question}"`);
  L.push("", "## Referring domains (domain level)", ""); if (diff.authority?.skipped) L.push(diff.authority.skipped); else { L.push(diff.authority.note || `${diff.authority.fromCount} -> ${diff.authority.toCount}`); for (const x of diff.authority.gained) L.push(`- new: ${x}`); for (const x of diff.authority.lost) L.push(`- lost: ${x}`); }
  L.push(...promptDiffMarkdown(diff.promptMap));
  return L.join("\n") + "\n";
}

// ---------- the run ----------
export async function runMeasure(target, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const loc = locate(target, { cwd });
  const cfg = loadConfig(loc, opts.config || {});
  if (opts.today && !isDay(opts.today)) throw new Error(`--today must be a real day as YYYY-MM-DD (got ${opts.today})`);
  if (!cfg.target) { cfg.target = loc.target; cfg.domain = cfg.domain || loc.host; cfg.cwd = cwd; if (!cfg.gsc.site && cfg.domain) cfg.gsc.site = `sc-domain:${cfg.domain}`; }
  const now = opts.now || (opts.today ? new Date(`${opts.today}T12:00:00Z`) : new Date());
  const date = ymd(now);
  const tInfo = targetsInfo(loc);
  const business = readJson(path.join(loc.pewp, "business.json")) || {};
  const competitors = [...new Set([...(cfg.competitors || []), ...(business.competitors || []), ...tInfo.clusters.flatMap((c) => (c.competitorsTop3 || []).map((x) => x.domain))].map(domainOf).filter(Boolean))];
  const pinfo = promptMapInfo(loc, cfg, date); // ai.prompts: the approved prompt map's rows, asked after the cluster questions
  const plan = buildPlan(cfg, tInfo, loc, { now, env: opts.env, promptQuestions: promptQuestions(pinfo.rows) });
  if (pinfo.present && pinfo.ok) plan.lines.splice(-1, 0, `  Prompt map: ${pinfo.rows.length} of ${pinfo.total} rows from ${pinfo.rel}${pinfo.unknownIds.length ? `; ai.prompts names ${pinfo.unknownIds.length} id(s) that are not in the map: ${pinfo.unknownIds.join(", ")}` : ""}`);
  for (const l of plan.lines) (opts.log || console.log)(l);
  if (opts.plan) return { plan };
  const ctx = { pewp: loc.pewp, endpoints: { ...DEFAULT_ENDPOINTS, ...(cfg.endpoints || {}) }, budget: new Budget(cfg.budgets), maxAgeDays: opts.fresh ? 0 : 1, env: opts.env || process.env, tokenFile: opts.tokenFile };
  const w = plan.windows;
  const guard = async (name, fn) => { try { return await fn(); } catch (e) { return { status: "blocked", blocked: { source: name, reason: `unexpected error: ${e.message}`, unblock: "Run again; if it repeats, the script needs a fix." } }; } };
  const cur = {};
  cur.gsc = await guard("search-console", () => collectGsc(ctx, cfg, w));
  cur.index = await guard("search-console", () => collectInspect(ctx, cfg, tInfo, cur.gsc.status));
  cur.bing = await guard("bing-webmaster", () => collectBing(ctx, cfg, w));
  cur.crux = await guard("crux", () => collectCrux(ctx, cfg, tInfo));
  cur.rankings = await guard("rankings", () => collectRankings(cfg, loc, tInfo, cur.gsc, path.join(loc.pewp, cfg.captures.rankings)));
  cur.ai = await guard("ai", () => collectAi(ctx, cfg, tInfo, path.join(loc.pewp, cfg.captures.ai), competitors, plan));
  cur.authority = await guard("commoncrawl-graph", () => collectAuthority(cfg, loc, opts, now, competitors));
  cur.conversions = collectConversions(cfg, loc);
  const dir = path.join(loc.pewp, "measure", date);
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, v] of Object.entries(cur)) writeJson(path.join(dir, k === "rankings" ? "rank-detail.json" : `${k}.json`), { fetchedAt: v.fetchedAt || new Date().toISOString(), ...v });
  writeJson(path.join(dir, "rankings.json"), contractRankings(cur.rankings, date));
  writeJson(path.join(dir, "citations.json"), contractCitations(cur.ai, date));
  // the prompt map, this month (measure/<date>/prompt-map.json); no map means no file, and summary.json says so
  const promptFile = path.join(dir, PROMPT_FILE);
  let prompts = { info: pinfo, doc: null, part: null };
  const aiFile = path.join(dir, AI_ANSWERS_FILE);
  fs.rmSync(aiFile, { force: true }); // a stale snapshot of an earlier run of the same day never stays
  if (!pinfo.present) fs.rmSync(promptFile, { force: true });
  else if (!pinfo.ok) {
    prompts.part = { status: "blocked", blocked: { source: "prompt-map", reason: pinfo.reason, unblock: "Run research-prompts.mjs <target> --check, fix the rows it names, and approve the map again (approve.mjs <target> prompt-map --by NAME)." } };
    writeJson(promptFile, { step: "prompt-map", status: "blocked", date, blocked: prompts.part.blocked, rows: [] });
  } else {
    const obs = promptObservations({ pewp: loc.pewp, capDir: path.join(loc.pewp, cfg.captures.ai), name: business.name, domain: cfg.domain, aiRows: cur.ai.rows || [], runSource: `measure/${date}/ai.json (Gemini API)` });
    const m = promptMonth(pinfo.rows, obs, date, cfg.ai.promptWindowDays);
    const seen = m.rows.filter(promptObserved).length;
    const status = !m.rows.length ? "blocked" : seen === 0 ? "blocked" : seen < m.rows.length ? "partial" : "ok";
    const why = !m.rows.length ? "the prompt map has no row to measure" : `${m.rows.length - seen} of ${m.rows.length} prompts have no observation from ${m.from} (not included) to ${m.to}`;
    if (status !== "ok") prompts.part = { status, blocked: { source: "ai-captures", reason: why, unblock: "Owner captures of ChatGPT and Perplexity answers go in captures/ai/ (one file per answer, with prompt or promptId, engine, capturedAt and sources; an `answer` text tests the business name); Gemini needs ai.geminiTermsAcknowledged and GEMINI_API_KEY." } };
    prompts.doc = { step: "prompt-map", status, date, generatedAt: new Date().toISOString(), map: { file: pinfo.rel, approved: pinfo.approved, sha256: pinfo.sha }, window: { from: m.from, to: m.to, days: cfg.ai.promptWindowDays }, observations: m.observations, observationsOutsideWindow: m.outsideWindow, observedRows: seen, filled: m.tally, unknownIds: pinfo.unknownIds, rows: m.rows };
    writeJson(promptFile, prompts.doc);
    const snap = aiAnswersSnapshot(prompts.doc, date);
    if (snap.data.rows.length || snap.refused.length) writeJson(aiFile, snap);
  }
  const prevDir = previousRunDir(path.join(loc.pewp, "measure"), date);
  const prev = loadRun(prevDir);
  const curLoaded = { ...cur, date, dir };
  const diff = diffRuns(prev, curLoaded, cfg);
  const grids = gridRuns(loc); // the latest local grid against the one before it (local-grid.mjs import writes local/<date>/grid.json)
  diff.grid = grids.cur ? diffGrid(grids.prev, grids.cur, { positionDelta: cfg.thresholds.positionDelta }) : null;
  if (prompts.doc) diff.promptMap = diffPromptMonths(previousPromptMonth(path.join(loc.pewp, "measure"), date), prompts.doc);
  writeJson(path.join(dir, "diff.json"), diff); fs.writeFileSync(path.join(dir, "diff.md"), diffMarkdown(diff));
  const ctrFile = cfg.ctrCurvePath || path.join(SKILL_DIR, "rules", "ctr-curve.json");
  const ctr = readJson(ctrFile) ? { source: `ruleset ${ctrFile}`, positions: readJson(ctrFile).positions } : DEFAULT_CTR_CURVE;
  const rules = evaluateRules(curLoaded, prev, diff, cfg, tInfo, loc, ctr);
  writeJson(path.join(dir, "findings.json"), rules);
  const summary = { date, target: cfg.target, domain: cfg.domain, windows: w, previousRun: prev?.date || null, ctrCurve: ctr.source,
    parts: Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, { status: v.status === "ok" ? "ok" : v.status === "partial" ? "partial" : "BLOCKED", reason: v.blocked?.reason || null, unblock: v.blocked?.unblock || null }])),
    findings: rules.findings.length, rulesBlocked: rules.blocked.map((b) => b.rule), apiCalls: ctx.budget.used };
  if (pinfo.present) summary.parts.promptMap = { status: prompts.part ? (prompts.part.status === "partial" ? "partial" : "BLOCKED") : "ok", reason: prompts.part?.blocked.reason || null, unblock: prompts.part?.blocked.unblock || null };
  else summary.promptMap = { status: "none", note: "no research/prompt-map.json or approved/prompt-map.json: no prompt is re-run" };
  writeJson(path.join(dir, "summary.json"), summary);
  writeReport(dir, { cfg, cur: curLoaded, diff, rules, plan, date, prompts });
  markStage(loc, "measure", { "measure dir": dir }, { date });
  (opts.log || console.log)(`measure ${date}: ${Object.entries(summary.parts).map(([k, v]) => `${k}=${v.status}`).join(" ")}; ${summary.findings} findings; diff against ${summary.previousRun || "nothing (baseline)"}; wrote ${dir}`);
  return { dir, summary, diff, rules, cur: curLoaded };
}

// ---------- convert the project's own capture files (fresh/<ID>.google.md|bing.md) into capture JSON ----------
// Uses research-serp-import.mjs (parseMarkdownCapture + finish: the same parser and the same rejection rules as research) when that
// script exists; otherwise this file's own line parser. The output goes where research reads captures (captures/serp).
export async function importFreshMarkdown(srcDir, outDir, defaults = {}) {
  fs.mkdirSync(outDir, { recursive: true }); let n = 0; const skipped = [];
  // only a MISSING research-serp-import.mjs falls back to the line parser; a broken one is a bug that must surface
  let R = null; try { R = await import("./research-serp-import.mjs"); } catch (e) { if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e; }
  for (const f of fs.readdirSync(srcDir).filter((x) => /\.(google|bing)\.md$/i.test(x)).sort()) {
    const file = path.join(srcDir, f); const text = stripBom(fs.readFileSync(file, "utf8"));
    const engine = /\.bing\.md$/i.test(f) ? "bing" : "google"; const id = f.split(".")[0];
    let cap;
    if (R) {
      const parsed = R.parseMarkdownCapture(text, file); if (defaults.queries?.[id]) parsed.query = defaults.queries[id];
      const fin = R.finish(parsed, { defaultDevice: defaults.device || null, defaultLanguage: defaults.language || "en", file });
      if (fin.rejected) { skipped.push({ file: f, reason: fin.rejected.reason }); continue; }
      cap = fin.capture;
    } else {
      cap = parseFreshMarkdown(text, { ...defaults, engine, query: defaults.queries?.[id] || defaults.query });
      if (!cap.query || !cap.organic.length) { skipped.push({ file: f, reason: !cap.query ? "no query (pass --queries <json id->query>)" : "no organic list found" }); continue; }
      cap.capturedAt = cap.capturedAt || defaults.capturedAt || fs.statSync(file).mtime.toISOString();
    }
    cap.sourceFile = file; writeJson(path.join(outDir, `${id}.${engine}.json`), cap); n++;
  }
  return { imported: n, skipped, parser: R ? "research-serp-import.mjs" : "measure-sources.mjs parseFreshMarkdown" };
}

// ---------- CLI ----------
if (isMain(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const target = a[0];
  if (!target || target.startsWith("--")) { console.error("usage: node measure.mjs <url> [--init [--property P]] [--plan] [--fresh] [--today YYYY-MM-DD] [--refresh-authority] [--cwd DIR] [--import-md DIR --device desktop [--queries file.json]]"); process.exit(2); }
  if (opt("--today") && !isDay(opt("--today"))) { console.error(`--today must be a real day as YYYY-MM-DD (got ${opt("--today")})`); process.exit(2); }
  const cwd = opt("--cwd", process.cwd());
  if (a.includes("--init")) { const r = initMeasure(target, { cwd, property: opt("--property") }); console.log(`wrote ${r.config}\nwrote ${r.run}\nput owner captures in ${path.join(r.loc.pewp, r.cfg.captures.rankings)} and ${path.join(r.loc.pewp, r.cfg.captures.ai)}`); process.exit(0); }
  const loc = locate(target, { cwd });
  if (opt("--import-md")) {
    const r = await importFreshMarkdown(opt("--import-md"), path.join(loc.pewp, loadConfig(loc).captures.rankings), { device: opt("--device", "desktop"), language: opt("--language", "en"), capturedAt: opt("--captured-at"), queries: opt("--queries") ? readJson(opt("--queries")) : undefined });
    console.log(JSON.stringify(r, null, 1)); process.exit(0);
  }
  await runMeasure(target, { cwd, plan: a.includes("--plan"), fresh: a.includes("--fresh"), today: opt("--today"), refreshAuthority: a.includes("--refresh-authority") });
}
