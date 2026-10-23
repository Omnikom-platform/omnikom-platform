// Bing Webmaster Tools API client (free key: Settings > API access). Two jobs:
//   keyword volumes   GetKeyword + GetRelatedKeywords for seed queries (impressions on Bing, per country/language)  -> estimates
//   our own queries   GetQueryStats for the verified site (clicks, impressions, average positions)                  -> measured
// Usage: node research-bing.mjs <target> [--seeds-file FILE.json] [--seed "q"]... [--no-related] [--site-stats] [--max-calls 60] [--days 90] [--cwd DIR]
// Key: $BING_WEBMASTER_KEY (sent as ?apikey=, redacted from the cache). Test hook: BING_API_BASE.
// A hard per-run unit budget (--max-calls) is enforced here, because every call counts against the key's quota.
// UNPROVEN against the live API: the response parsing follows Bing's documented JSON shape and is tested on a local fixture only.
// Output: research/bing.json { keywords:[{query, volume, broad, related}], siteQueries:[...], calls }. No key => BLOCKED (exit 3).
import path from "node:path";
import { Blocked, listFile, context, needBusiness, runCli, writeStep, writeBlocked, cachedFetch, factor, pace, normQuery } from "./research-lib.mjs";

const BASE = () => (process.env.BING_API_BASE || "https://ssl.bing.com/webmaster/api.svc/json").replace(/\/$/, "");
const UNBLOCK = "verify the site in Bing Webmaster Tools, create an API key (Settings > API access), set BING_WEBMASTER_KEY";
const msDate = (s) => { const m = String(s || "").match(/\/Date\((-?\d+)/); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(s || "").slice(0, 10); };
const dayStr = (d) => d.toISOString().slice(0, 10);

export async function run(ctx, { seeds = [], related = true, siteStats = false, maxCalls = 60, days = 90 } = {}) {
  const b = needBusiness(ctx);
  const key = (process.env.BING_WEBMASTER_KEY || "").trim();
  if (!key) { writeBlocked(ctx, "bing", UNBLOCK); throw new Blocked(UNBLOCK); }
  const country = ctx.market.country.toLowerCase(), language = `${ctx.market.language}-${ctx.market.country}`;
  const end = new Date(), start = new Date(Date.now() - days * 86400000);
  let calls = 0;
  const call = async (method, params) => {
    if (calls >= maxCalls) return null; // budget reached: remaining seeds are reported, not fetched
    calls++;
    const url = `${BASE()}/${method}?${new URLSearchParams({ ...params, apikey: key })}`;
    await pace(url, 1000);
    const r = await cachedFetch(ctx.pewp, "bing", url, { maxAgeDays: 7 });
    if (r.status === 401 || r.status === 403) throw new Blocked(`Bing refused the key (HTTP ${r.status}): ${UNBLOCK}`);
    if (r.status === 429) throw new Blocked("Bing quota or rate limit (HTTP 429): re-run later; cached answers are kept");
    if (r.status !== 200) throw new Error(`Bing ${method} HTTP ${r.status}: ${r.text.slice(0, 160)}`);
    return r;
  };
  const keywords = [], siteQueries = [], skipped = [];
  try {
    const dRows = (r) => { const d = r.json().d; return Array.isArray(d) ? d : d ? [d] : []; };
    const volume = (rows, f) => { // sum the dated rows of one query; Bing reports impressions per date
      const imp = rows.reduce((s, x) => s + (Number(x.Impressions) || 0), 0), broad = rows.reduce((s, x) => s + (Number(x.BroadImpressions) || 0), 0);
      const unit = `Bing impressions ${dayStr(start)}..${dayStr(end)} (an estimate of demand, not a search count)`;
      return { volume: f(imp, { estimate: true, unit }), broad: f(broad, { estimate: true, unit: unit + ", broad match" }) };
    };
    const seedList = [...new Set(seeds.map(normQuery).filter(Boolean))];
    for (const q of seedList) {
      const params = { q, country, language, startDate: dayStr(start), endDate: dayStr(end) };
      const r = await call("GetKeyword", params);
      if (!r) { skipped.push(q); continue; }
      const f = factor(`Bing Webmaster API GetKeyword (${country}, ${language})`, r.fetchedAt, r.cacheFile, { location: ctx.market.country });
      keywords.push({ query: q, related: false, ...volume(dRows(r), f) });
      if (related) {
        const rr = await call("GetRelatedKeywords", params);
        if (!rr) continue;
        const f2 = factor(`Bing Webmaster API GetRelatedKeywords for "${q}" (${country}, ${language})`, rr.fetchedAt, rr.cacheFile, { location: ctx.market.country });
        const byQuery = new Map();
        for (const x of dRows(rr)) (byQuery.get(normQuery(x.Query)) || byQuery.set(normQuery(x.Query), []).get(normQuery(x.Query))).push(x);
        for (const [query, rows] of byQuery) if (query && !keywords.some((k) => k.query === query)) keywords.push({ query, related: true, relatedTo: q, ...volume(rows, f2) });
      }
    }
    if (siteStats) {
      const r = await call("GetQueryStats", { siteUrl: `https://${b.domain}/` });
      if (r) {
        const f = factor(`Bing Webmaster API GetQueryStats https://${b.domain}/`, r.fetchedAt, r.cacheFile, { location: ctx.market.country });
        const agg = new Map();
        for (const x of dRows(r)) { const a = agg.get(x.Query) || { q: x.Query, imp: 0, clk: 0, posW: 0 }; a.imp += x.Impressions || 0; a.clk += x.Clicks || 0; a.posW += (x.AvgImpressionPosition || 0) * (x.Impressions || 0); agg.set(x.Query, a); }
        for (const a of agg.values()) siteQueries.push({ query: a.q, engine: "bing", language: ctx.market.language, device: null, impressions: f(a.imp), clicks: f(a.clk), position: f(a.imp ? Math.round((a.posW / a.imp) * 10) / 10 : null, { unit: "impression-weighted average position; device not split by this endpoint" }) });
      }
    }
  } catch (e) { if (e instanceof Blocked) writeBlocked(ctx, "bing", e.unblock); throw e; }
  return writeStep(ctx, "bing", { callBudget: maxCalls, calls, budgetStopped: skipped.length > 0, skippedSeeds: skipped, keywords, siteQueries });
}

await runCli(import.meta.url, "node research-bing.mjs <target> [--seeds-file FILE] [--seed q]... [--no-related] [--site-stats] [--max-calls 60] [--days 90] [--cwd DIR]", ["no-related", "site-stats"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const sf = a.get("seeds-file");
  const fileSeeds = sf ? listFile(sf, "queries").map((x) => (typeof x === "string" ? x : x?.query)) : []; // a named file that is missing is a usage error, not "no seeds"
  const r = await run(ctx, { seeds: [...fileSeeds, ...a.all("seed")], related: !a.has("no-related"), siteStats: a.has("site-stats"), maxCalls: a.num("max-calls", 60), days: a.num("days", 90) });
  return `OK bing: ${r.keywords.length} keywords, ${r.siteQueries.length} own queries, ${r.calls}/${r.callBudget} calls${r.budgetStopped ? ` (budget stop: ${r.skippedSeeds.length} seeds not asked)` : ""} -> ${path.join(ctx.rdir, "bing.json")}`;
});
