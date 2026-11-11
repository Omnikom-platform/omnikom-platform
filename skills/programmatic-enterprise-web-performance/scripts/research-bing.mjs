// Bing Webmaster Tools API client (free key: Settings > API access). Two jobs:
//   keyword volumes   GetKeyword + GetRelatedKeywords for seed queries (impressions on Bing, per country/language)  -> estimates
//   our own queries   GetQueryStats for the verified site (clicks, impressions, average positions)                  -> measured
// Usage: node research-bing.mjs <target> [--seeds-file FILE.json] [--seed "q"]... [--no-related] [--keep-brands] [--site-stats] [--max-calls 60] [--days 90] [--cwd DIR]
// Key: $BING_WEBMASTER_KEY (sent as ?apikey=, redacted from the cache). Test hook: BING_API_BASE.
// A hard per-run unit budget (--max-calls) is enforced here, because every call counts against the key's quota.
// Parser proven on 2026-10-25 live responses (fixtures/bing-junk: real cached GetKeyword / GetRelatedKeywords bodies, key-free).
// UNPROVEN live: the request side (parameters, pacing, quota behaviour) is tested on a local fixture server only.
// (GetKeyword answers with ONE object in `d`, often Query null and Impressions 0; GetRelatedKeywords answers with an array of {__type, BroadImpressions, Impressions, Query}.)
// Relevance filter (G4): a RELATED keyword is kept only when it shares a meaningful term (stemmed, 3+ letters, not a stop or generic word, not a place name)
// with its seed or with the business vocabulary (business.json `vocabulary`, the `offer` words and the terms of the whole seed list), AND it is not the
// navigational name of another site (a word that is a site name in rules/directory-domains.json, a web address, or a `site:` operator) unless --keep-brands.
// Everything dropped is listed with its reason in `droppedOffTopic` (Bing returned "how to clear cache" and "zillow homes for sale" for real-estate seeds).
// Own-site statistics (--site-stats) need the CLIENT's access: until the client adds us as a user in Bing Webmaster Tools, Bing refuses GetQueryStats with
// {"Message":"ERROR!!! NotAuthorized"} (HTTP status UNPROVEN: 400, 401, 403 and a 200 with that body are all read as the refusal). That is a BLOCKED part,
// not a failure: the keyword estimates go on, bing.json says siteStats.status "blocked" with what unblocks it, the last line says so, and the refused
// answer is not cached (the next run asks again). A refused KEY on a keyword call, or any other failure, is still a BLOCKED step or an error.
// Topic filter (research-topic.mjs), ON when business.json says "topicFilter": "vocabulary" (OFF by default: a lexical filter cannot tell "advance america" from "luxury penthouses" for every business, and
// test-research.mjs pins the relevance filter's keeps for the historic-homes business; the head of SEO decides the default): after the relevance filter a RELATED keyword must be about the business's services (business.json vocabulary): kept with a head word (loans,
// financing) or when more than half of its meaningful terms are service terms; the rest go to droppedOffTopic with reason "topic: ..." and bing.json says topicFilter {applied, reason, dropped}.
// Output: research/bing.json { keywords:[{query, volume, broad, related}], droppedOffTopic:[{query, relatedTo, reason}], topicFilter, siteQueries:[...], siteStats:{status:"ok"|"blocked"|"not asked", blocked}, calls }. No key => BLOCKED (exit 3).
import fs from "node:fs";
import path from "node:path";
import { Blocked, listFile, context, needBusiness, runCli, writeStep, writeBlocked, cachedFetch, factor, pace, normQuery, tokens, stem, knownPlaces } from "./research-lib.mjs";
import { loadRule } from "./lib-rules.mjs";
import { topicFilter, topicOff } from "./research-topic.mjs";
import { topicSetting } from "./lib-industry.mjs";

// words that make a search no more about the business even when they are shared ("cars for sale" shares "sale" with "historic homes for sale")
const GENERIC = new Set(["sale", "sell", "buy", "find", "best", "top", "near", "nearby", "cheap", "price", "cost", "online", "free", "new", "used", "get"].map(stem));
const termsOf = (s) => tokens(s).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !GENERIC.has(t));
const TLD = "com|net|org|io|co|us|info|biz|app|dev|ai|tv|me|edu|gov|uk|ca|au";
const stripEdges = (w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
// names of other sites: single-word brands and host labels (zillow, redfin, realtor) and multi-word brands (keller williams)
function brandIndex() {
  const words = new Map(), phrases = new Map();
  for (const d of loadRule("directory-domains.json").domains) {
    const label = String(d.host).split(".")[0].toLowerCase(), brand = String(d.brand || "").toLowerCase().trim();
    if (label.length >= 3) words.set(label, d.host);
    if (brand && !/\s/.test(brand) && brand.length >= 3) words.set(brand, d.host);
    if (/\s/.test(brand)) phrases.set(brand, d.host);
  }
  return { words, phrases };
}
// Why a related keyword is off topic, or null when it stays. `allowed` = stemmed terms the owner/seeds use (a brand word in it is not a brand here).
export function offTopicReason(query, seed, { vocabTerms, seedListTerms, placeTerms, ownDomain, keepBrands = false, brands = brandIndex() }) {
  const q = normQuery(query), own = String(ownDomain || "").toLowerCase();
  if (!keepBrands) {
    const op = q.match(new RegExp(`\\bsite:?\\s*(?:https?://)?((?:[a-z0-9-]+\\.)+[a-z]{2,})`));
    if (op && op[1].replace(/^www\./, "") !== own) return { drop: `navigational: a "site:" search on another website (${op[1]})` };
    const words = q.split(/\s+/).map(stripEdges).filter(Boolean);
    for (const w of words) if (new RegExp(`^(?:www\\.)?(?:[a-z0-9-]+\\.)+(?:${TLD})$`).test(w) && w.replace(/^www\./, "") !== own) return { drop: `navigational: the web address of another site (${w})` };
    const allowed = new Set([...vocabTerms, ...seedListTerms]);
    for (const w of words) if (brands.words.has(w) && !allowed.has(stem(w)) && w !== own.split(".")[0]) return { drop: `navigational: "${w}" is the name of another site (${brands.words.get(w)})` };
    for (const [p, host] of brands.phrases) if ((` ${q} `).includes(` ${p} `) && !p.split(" ").every((x) => allowed.has(stem(x)))) return { drop: `navigational: "${p}" is the name of another site (${host})` };
  }
  const qt = termsOf(q), seedT = new Set(termsOf(seed)), pool = new Set([...vocabTerms, ...seedListTerms]);
  const inSeed = qt.find((t) => seedT.has(t) && !placeTerms.has(t));
  if (inSeed) return { keep: `shares "${inSeed}" with the seed` };
  const inVocab = qt.find((t) => pool.has(t) && !placeTerms.has(t));
  if (inVocab) return { keep: `shares "${inVocab}" with the business vocabulary or the seed list` };
  const placeOnly = tokens(q).filter((t) => t.length >= 3 && placeTerms.has(t) && (seedT.has(t) || pool.has(t)));
  return { drop: placeOnly.length ? `off topic: only a place name in common (${placeOnly.join(", ")}), nothing about the business` : "off topic: no meaningful term in common with the seed, the business vocabulary or the seed list" };
}

const BASE = () => (process.env.BING_API_BASE || "https://ssl.bing.com/webmaster/api.svc/json").replace(/\/$/, "");
const UNBLOCK = "verify the site in Bing Webmaster Tools, create an API key (Settings > API access), set BING_WEBMASTER_KEY";
const SITE_STATS_UNBLOCK = "the client adds us as a user in Bing Webmaster Tools";
const msDate = (s) => { const m = String(s || "").match(/\/Date\((-?\d+)/); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(s || "").slice(0, 10); };
const dayStr = (d) => d.toISOString().slice(0, 10);

export async function run(ctx, { seeds = [], related = true, keepBrands = false, siteStats = false, maxCalls = 60, days = 90 } = {}) {
  const b = needBusiness(ctx);
  // the words that make a search "about the business": the owner's vocabulary, the offer, and every seed (the seeds are owner-approved, G3)
  const vocabTerms = new Set(termsOf([...(Array.isArray(b.vocabulary) ? b.vocabulary : []), b.offer || ""].join(" ")));
  const seedListTerms = new Set(seeds.flatMap(termsOf));
  const placeTerms = new Set(knownPlaces(b).flatMap((p) => tokens(p.city)));
  const brands = brandIndex(), droppedOffTopic = [];
  const key = (process.env.BING_WEBMASTER_KEY || "").trim();
  if (!key) { writeBlocked(ctx, "bing", UNBLOCK); throw new Blocked(UNBLOCK); }
  const country = ctx.market.country.toLowerCase(), language = `${ctx.market.language}-${ctx.market.country}`;
  const end = new Date(), start = new Date(Date.now() - days * 86400000);
  let calls = 0;
  const call = async (method, params, { tolerateRefusal = false } = {}) => {
    if (calls >= maxCalls) return null; // budget reached: remaining seeds are reported, not fetched
    calls++;
    const url = `${BASE()}/${method}?${new URLSearchParams({ ...params, apikey: key })}`;
    await pace(url, 1000);
    const r = await cachedFetch(ctx.pewp, "bing", url, { maxAgeDays: 7 });
    const refusal = r.status === 401 || r.status === 403 || /NotAuthorized/i.test(r.text);
    if (tolerateRefusal && refusal) { if (r.cacheFile) fs.rmSync(r.cacheFile, { force: true }); return { refused: true }; }
    if (r.status === 401 || r.status === 403) throw new Blocked(`Bing refused the key (HTTP ${r.status}): ${UNBLOCK}`);
    if (r.status === 429) throw new Blocked("Bing quota or rate limit (HTTP 429): re-run later; cached answers are kept");
    if (r.status !== 200) throw new Error(`Bing ${method} HTTP ${r.status}: ${r.text.slice(0, 160)}`);
    return r;
  };
  const keywords = [], siteQueries = [], skipped = [];
  let siteStatsBlocked = null, siteStatsAsked = false;
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
        for (const [query, rows] of byQuery) {
          if (!query || keywords.some((k) => k.query === query) || droppedOffTopic.some((d) => d.query === query)) continue;
          const v = offTopicReason(query, q, { vocabTerms, seedListTerms, placeTerms, ownDomain: b.domain, keepBrands, brands });
          if (v.drop) { droppedOffTopic.push({ query, relatedTo: q, reason: v.drop }); continue; }
          keywords.push({ query, related: true, relatedTo: q, relevance: v.keep, ...volume(rows, f2) });
        }
      }
    }
    if (siteStats) {
      const r = await call("GetQueryStats", { siteUrl: `https://${b.domain}/` }, { tolerateRefusal: true });
      siteStatsAsked = !!r;
      if (r?.refused) siteStatsBlocked = SITE_STATS_UNBLOCK;
      else if (r) {
        const f = factor(`Bing Webmaster API GetQueryStats https://${b.domain}/`, r.fetchedAt, r.cacheFile, { location: ctx.market.country });
        const agg = new Map();
        for (const x of dRows(r)) { const a = agg.get(x.Query) || { q: x.Query, imp: 0, clk: 0, posW: 0 }; a.imp += x.Impressions || 0; a.clk += x.Clicks || 0; a.posW += (x.AvgImpressionPosition || 0) * (x.Impressions || 0); agg.set(x.Query, a); }
        for (const a of agg.values()) siteQueries.push({ query: a.q, engine: "bing", language: ctx.market.language, device: null, impressions: f(a.imp), clicks: f(a.clk), position: f(a.imp ? Math.round((a.posW / a.imp) * 10) / 10 : null, { unit: "impression-weighted average position; device not split by this endpoint" }) });
      }
    }
  } catch (e) { if (e instanceof Blocked) writeBlocked(ctx, "bing", e.unblock); throw e; }
  // the topic filter (research-topic.mjs): a related keyword that is not ABOUT the business's services (vocabulary) is dropped and LISTED with its reason, before anything clusters
  const setting = topicSetting(b); // business.json wins either way, then the industry pack, then off
  const tf = { ...(setting.value === "vocabulary" ? topicFilter(keywords, b, { placeTerms }) : topicOff(keywords)), setting: setting.value, settingFrom: setting.from };
  droppedOffTopic.push(...tf.dropped.map(({ query, relatedTo, reason }) => ({ query, relatedTo, reason })));
  return writeStep(ctx, "bing", { callBudget: maxCalls, calls, budgetStopped: skipped.length > 0, skippedSeeds: skipped, relatedAsked: !!related, keepBrands: !!keepBrands, droppedOffTopic, keywords: tf.kept, topicFilter: { applied: tf.applied, setting: tf.setting, settingFrom: tf.settingFrom, reason: tf.reason, topicTerms: tf.topicTerms, headTerms: tf.headTerms, dropped: tf.dropped.length }, siteQueries,
    siteStats: { status: !siteStats || !siteStatsAsked ? "not asked" : siteStatsBlocked ? "blocked" : "ok", blocked: siteStatsBlocked } });
}

await runCli(import.meta.url, "node research-bing.mjs <target> [--seeds-file FILE] [--seed q]... [--no-related] [--keep-brands] [--site-stats] [--max-calls 60] [--days 90] [--cwd DIR]", ["no-related", "keep-brands", "site-stats"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const sf = a.get("seeds-file");
  const fileSeeds = sf ? listFile(sf, "queries").map((x) => (typeof x === "string" ? x : x?.query)) : []; // a named file that is missing is a usage error, not "no seeds"
  const r = await run(ctx, { seeds: [...fileSeeds, ...a.all("seed")], related: !a.has("no-related"), keepBrands: a.has("keep-brands"), siteStats: a.has("site-stats"), maxCalls: a.num("max-calls", 60), days: a.num("days", 90) });
  return `OK bing: ${r.keywords.length} keywords (${r.droppedOffTopic.length} related dropped as off topic), ${r.siteQueries.length} own queries${r.siteStats.blocked ? ` (site stats BLOCKED: ${r.siteStats.blocked})` : ""}, ${r.calls}/${r.callBudget} calls${r.budgetStopped ? ` (budget stop: ${r.skippedSeeds.length} seeds not asked)` : ""} -> ${path.join(ctx.rdir, "bing.json")}`;
});
