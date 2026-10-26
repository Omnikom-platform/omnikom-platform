// Source clients and importers for `measure`, `migrate` and the local scripts. Node built-ins only. Library (no CLI).
// Free sources only (owner decision 2026-10-22): Search Console API, Bing Webmaster API, CrUX API, Gemini API free tier
// with Google Search grounding, owner-supervised browser captures, Common Crawl authority (authority.mjs).
// Rules every client follows:
//   - never throws on a missing key, a refused permission or a bad status: it returns { ok:false, blocked:{ source, reason, unblock } };
//   - every external response goes through cache.mjs (keys are redacted there); an error status is never left in the cache;
//   - a unit budget is enforced here (budget.take); over budget is BLOCKED, not silently truncated;
//   - Gemini grounded answers are NOT cached or stored raw (their terms forbid it: TRACKER-PROPOSAL T1b): only the cited
//     domains, a hash of the answer and the counts are kept.
// If research builders' clients (scripts/research-*.mjs) appear, measure.mjs prefers them; these are the minimal ones.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cachedFetch, fact } from "./cache.mjs";
import { getGscToken, GoogleAuthBlocked, UNBLOCK as GOOGLE_UNBLOCK } from "./lib-google-auth.mjs";

export { fact };
// A file saved by Windows PowerShell 5.1 or Notepad may start with a UTF-8 BOM, which JSON.parse refuses: strip it.
export const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
// decodeURIComponent throws on a stray "%" ("/50%-off"): one bad address must not stop a whole run.
export const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
// A --today / --cutover value: a real calendar day as YYYY-MM-DD (an invalid one crashed later in toISOString with a RangeError).
export const isDay = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false; const t = Date.parse(`${s}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s; };
export const DEFAULT_ENDPOINTS = {
  gsc: "https://www.googleapis.com/webmasters/v3",
  inspect: "https://searchconsole.googleapis.com/v1",
  token: "https://oauth2.googleapis.com/token",
  bing: "https://ssl.bing.com/webmaster/api.svc/json",
  crux: "https://chromeuxreport.googleapis.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

// ---------- small helpers ----------
export const nfkc = (s) => String(s ?? "").normalize("NFKC").toLowerCase();
export const words = (s) => nfkc(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// True when the whole words of `needle` appear in order, contiguously, in `hay` (MSR-003 matching).
export function containsWords(hay, needle) {
  const h = words(hay), n = words(needle);
  if (!n.length || n.length > h.length) return false;
  for (let i = 0; i + n.length <= h.length; i++) if (n.every((w, j) => h[i + j] === w)) return true;
  return false;
}
export const sha = (s, n = 16) => createHash("sha256").update(String(s)).digest("hex").slice(0, n);
export const domainOf = (u) => {
  const s = String(u || "").trim().toLowerCase();
  if (!s) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `http://${s}`).hostname.replace(/^www\./, ""); } catch { return ""; }
};
export const isOurs = (domainOrUrl, ours, aliases = []) => {
  const d = domainOf(domainOrUrl);
  return !!d && [ours, ...aliases].map(domainOf).some((o) => o && (d === o || d.endsWith("." + o)));
};
export const ymd = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);
export const ALPHA3 = { US: "usa", CA: "can", GB: "gbr", UK: "gbr", AU: "aus", NZ: "nzl", IE: "irl", DE: "deu", FR: "fra", ES: "esp", IT: "ita", NL: "nld", MX: "mex", BR: "bra", IN: "ind", EG: "egy", AE: "are", SA: "sau", CH: "che", SE: "swe" };
export const readJson = (p, d = null) => { try { return JSON.parse(stripBom(fs.readFileSync(p, "utf8"))); } catch { return d; } };
export const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1) + "\n"); return p; };
export const blocked = (source, reason, unblock) => ({ ok: false, blocked: { source, reason, unblock } });

// Garwood 95% interval for a Poisson count (Wilson-Hilferty chi-square approximation): the 06 § 9.8 clicks rule.
const Z = { lo: -1.959964, hi: 1.959964 };
const chi2q = (z, v) => v * Math.pow(1 - 2 / (9 * v) + z * Math.sqrt(2 / (9 * v)), 3);
export function poissonInterval(k) {
  const lo = k <= 0 ? 0 : 0.5 * chi2q(Z.lo, 2 * k);
  const hi = 0.5 * chi2q(Z.hi, 2 * k + 2);
  return [lo, hi];
}
// A clicks change counts when the new value falls outside the 95% interval of the old one (06 § 9.8).
export const clicksChanged = (oldV, newV) => { const [lo, hi] = poissonInterval(oldV); return newV < lo || newV > hi; };

export const CWV_LIMITS = { largest_contentful_paint: [2500, 4000], interaction_to_next_paint: [200, 500], cumulative_layout_shift: [0.1, 0.25] };
export const cwvStatus = (metric, p75) => {
  const l = CWV_LIMITS[metric]; const v = Number(p75);
  if (!l || !Number.isFinite(v)) return null;
  return v <= l[0] ? "good" : v <= l[1] ? "needs improvement" : "poor";
};

// ---------- guarded fetch through the cache ----------
export class Budget {
  constructor(max = {}) { this.max = { api: 80, ai: 60, inspect: 20, ...max }; this.used = { api: 0, ai: 0, inspect: 0 }; }
  take(kind, n = 1) { if (this.used[kind] + n > this.max[kind]) return false; this.used[kind] += n; return true; }
}
async function getCached(ctx, source, url, init = {}) {
  if (!ctx.budget.take("api")) return blocked(source, `API call budget used up (${ctx.budget.max.api} calls per run)`, "Raise measure.budgets.api in measure/config.json, or run again tomorrow.");
  let r;
  try { r = await cachedFetch(ctx.pewp, source, url, { maxAgeDays: ctx.maxAgeDays ?? 1, init, timeoutMs: ctx.timeoutMs ?? 30000 }); }
  catch (e) { return blocked(source, `request failed: ${e.message || e}`, "Check the network and run again; if it keeps failing the endpoint is down."); }
  if (r.status < 200 || r.status >= 300) { try { fs.rmSync(r.cacheFile, { force: true }); } catch {} } // errors are never cached
  return { ok: r.status >= 200 && r.status < 300, status: r.status, r };
}
const bodyMsg = (r) => { try { const j = r.json(); return j.error?.message || JSON.stringify(j).slice(0, 160); } catch { return String(r.text || "").slice(0, 160); } };

// ---------- Google Search Console ----------
// The token comes from lib-google-auth.mjs (one copy for this file and research-gsc.mjs): a service account (GSC_SERVICE_ACCOUNT_FILE /
// GSC_SERVICE_ACCOUNT_JSON_B64, kept in memory only), else the token file (access_token, or refresh_token+client_id+client_secret).
// Only the token-file path writes anything: a token refreshed from the file is saved back to that same file, as before.
export async function gscAccessToken(ctx) {
  let g;
  try { g = await getGscToken({ env: ctx.env || process.env, tokenFile: ctx.tokenFile || process.env.GSC_TOKEN_FILE || undefined, tokenUrl: ctx.endpoints.token }); }
  catch (e) { if (e instanceof GoogleAuthBlocked) return blocked("search-console", e.reason, e.unblock); throw e; }
  if (g.refreshed && g.file) {
    const file = g.file, tok = readJson(file) || {};
    try { const next = { ...tok, access_token: g.token, expiry: new Date(g.expiresAt).toISOString() }; fs.writeFileSync(file, JSON.stringify(next, null, 1) + "\n"); }
    catch (e) { return blocked("search-console", `token refresh failed: ${e.message}`, GOOGLE_UNBLOCK); }
    return { ok: true, token: g.token, refreshed: true };
  }
  return { ok: true, token: g.token };
}

function gscFail(source, res) {
  const msg = bodyMsg(res.r);
  if (res.status === 401) return blocked(source, `Google refused the token (401): ${msg}`, "Refresh or recreate the OAuth token (see doctor: search-console).");
  if (res.status === 403) return blocked(source, `Google says this account may not read the property (403): ${msg}`, "The site owner must add our Google account as a user of that Search Console property (Settings > Users and permissions).");
  if (res.status === 404) return blocked(source, `the Search Console property name is wrong or unknown to this account (404)`, "Set measure.gsc.site to the exact property (sc-domain:example.com or https://example.com/).");
  if (res.status === 429) return blocked(source, "Google rate limit (429): stopped, not retried", "Run again later; the daily row limit is 50,000.");
  return blocked(source, `Search Console answered ${res.status}: ${msg}`, "Run again; if it persists check the property name and token.");
}

// One searchAnalytics query, paged. Rows keep Google's own fields: keys[], clicks, impressions, ctr, position.
export async function gscQuery(ctx, { site, start, end, dimensions, country = null, rowLimit = 25000, maxPages = 4, type = "web" }) {
  const t = await gscAccessToken(ctx); if (!t.ok) return t;
  const url = `${ctx.endpoints.gsc}/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const rows = []; const cacheFiles = []; let fetchedAt = null;
  for (let page = 0; page < maxPages; page++) {
    const body = { startDate: start, endDate: end, dimensions, rowLimit, startRow: page * rowLimit, searchType: type, dataState: "final" };
    if (country) body.dimensionFilterGroups = [{ filters: [{ dimension: "country", operator: "equals", expression: country }] }];
    const res = await getCached(ctx, "gsc", url, { method: "POST", headers: { authorization: `Bearer ${t.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok && res.blocked) return res;
    if (!res.ok) return gscFail("search-console", res);
    const j = res.r.json(); const got = j.rows || [];
    rows.push(...got); cacheFiles.push(res.r.cacheFile); fetchedAt = res.r.fetchedAt;
    if (got.length < rowLimit) break;
  }
  return { ok: true, rows, cacheFiles, fetchedAt, source: `Google Search Console API searchAnalytics.query ${start}..${end} dimensions=${dimensions.join("+")}${country ? " country=" + country : ""}` };
}

// URL Inspection (MSR-001). One call per URL, quota-limited by the budget.
export async function gscInspect(ctx, { site, url }) {
  if (!ctx.budget.take("inspect")) return blocked("search-console", `URL Inspection budget used up (${ctx.budget.max.inspect} per run)`, "Raise measure.budgets.inspect (Google's quota is 2,000 per property per day).");
  const t = await gscAccessToken(ctx); if (!t.ok) return t;
  const res = await getCached(ctx, "gsc-inspect", `${ctx.endpoints.inspect}/urlInspection/index:inspect`, { method: "POST", headers: { authorization: `Bearer ${t.token}`, "content-type": "application/json" }, body: JSON.stringify({ inspectionUrl: url, siteUrl: site }) });
  if (!res.ok && res.blocked) return res;
  if (!res.ok) return gscFail("search-console", res);
  const s = res.r.json().inspectionResult?.indexStatusResult || {};
  return { ok: true, url, verdict: s.verdict || null, coverageState: s.coverageState || null, lastCrawlTime: s.lastCrawlTime || null, googleCanonical: s.googleCanonical || null, fetchedAt: res.r.fetchedAt, cacheFile: res.r.cacheFile };
}

// ---------- Bing Webmaster Tools (JSON API; the key travels in the URL, cache.mjs redacts it) ----------
const bingDate = (s) => { const m = /\/Date\((-?\d+)/.exec(String(s)); return m ? ymd(Number(m[1])) : String(s).slice(0, 10); };
export async function bingCall(ctx, method, site, extra = "") {
  const key = ctx.env?.BING_WEBMASTER_KEY || process.env.BING_WEBMASTER_KEY;
  if (!key) return blocked("bing-webmaster", "no BING_WEBMASTER_KEY", "Verify the site in Bing Webmaster Tools, create an API key (Settings > API access), set BING_WEBMASTER_KEY.");
  const res = await getCached(ctx, "bing", `${ctx.endpoints.bing}/${method}?apikey=${encodeURIComponent(key)}&siteUrl=${encodeURIComponent(site)}${extra}`);
  if (!res.ok && res.blocked) return res;
  if (!res.ok) return blocked("bing-webmaster", `Bing answered ${res.status}: ${bodyMsg(res.r)}`, res.status === 401 || res.status === 403 ? "Check that the API key belongs to an account that owns this site in Bing Webmaster Tools." : "Run again later.");
  let j; try { j = res.r.json(); } catch { return blocked("bing-webmaster", "Bing returned something that is not JSON", "Run again; the legacy SOAP/POX endpoints were retired 2026-08-31, only the JSON API works."); }
  return { ok: true, data: j.d, fetchedAt: res.r.fetchedAt, cacheFile: res.r.cacheFile, source: `Bing Webmaster API ${method}` };
}
// Daily rows -> per-key totals for a date window. Position is impression-weighted.
export function bingAggregate(rows, keyField, start, end) {
  const by = new Map();
  for (const r of rows || []) {
    const d = bingDate(r.Date); if (d < start || d > end) continue;
    const k = r[keyField]; const o = by.get(k) || { key: k, clicks: 0, impressions: 0, posW: 0 };
    o.clicks += r.Clicks || 0; o.impressions += r.Impressions || 0; o.posW += (r.AvgImpressionPosition ?? r.AvgClickPosition ?? 0) * (r.Impressions || 0);
    by.set(k, o);
  }
  return [...by.values()].map((o) => ({ keys: [o.key], clicks: o.clicks, impressions: o.impressions, ctr: o.impressions ? o.clicks / o.impressions : 0, position: o.impressions ? o.posW / o.impressions : null }));
}
// Pages with links from other sites (migrate): Bing GetLinkCounts, paged.
export async function bingLinkCounts(ctx, site, maxPages = 5) {
  const out = []; let last = null;
  for (let p = 0; p < maxPages; p++) {
    const r = await bingCall(ctx, "GetLinkCounts", site, `&page=${p}`); if (!r.ok) return p ? { ok: true, rows: out, partial: true, ...last } : r;
    last = { fetchedAt: r.fetchedAt, cacheFile: r.cacheFile, source: r.source };
    out.push(...(r.data?.Details || []).map((d) => ({ url: d.Url, count: d.Count })));
    if (p + 1 >= (r.data?.TotalPages || 1)) break;
  }
  return { ok: true, rows: out, ...last };
}

// ---------- Chrome UX Report (field data) ----------
export async function cruxQuery(ctx, { origin, url, formFactor = "PHONE" }) {
  const key = ctx.env?.CRUX_API_KEY || process.env.CRUX_API_KEY;
  if (!key) return blocked("crux", "no CRUX_API_KEY", "Google Cloud console: enable 'Chrome UX Report API', create a free API key, set CRUX_API_KEY.");
  const body = { formFactor, metrics: Object.keys(CWV_LIMITS) }; if (url) body.url = url; else body.origin = origin;
  const res = await getCached(ctx, "crux", `${ctx.endpoints.crux}/records:queryRecord?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok && res.blocked) return res;
  const target = url || origin;
  if (res.status === 404) return { ok: true, noFieldData: true, target, formFactor, reason: "CrUX has no field data for this address (too little real-visitor traffic). This is a result, not a failure.", fetchedAt: res.r.fetchedAt, cacheFile: null };
  if (!res.ok) return blocked("crux", `CrUX answered ${res.status}: ${bodyMsg(res.r)}`, res.status === 400 || res.status === 403 ? "Check CRUX_API_KEY and that the Chrome UX Report API is enabled for its project." : "Run again later.");
  const rec = res.r.json().record || {}; const metrics = {};
  for (const [m, v] of Object.entries(rec.metrics || {})) { const p75 = v.percentiles?.p75; metrics[m] = { p75: p75 == null ? null : Number(p75), status: cwvStatus(m, p75) }; }
  return { ok: true, noFieldData: false, target, formFactor, metrics, collectionPeriod: rec.collectionPeriod || null, fetchedAt: res.r.fetchedAt, cacheFile: res.r.cacheFile, source: "Chrome UX Report API (p75, field data)" };
}

// ---------- Gemini free tier with Google Search grounding (AI citations) ----------
// 06 § 9.6: the question alone as the user message, grounding on, N samples at least 60 s apart. Not cached, not stored raw.
export async function geminiAsk(ctx, { question, model }) {
  const key = ctx.env?.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return blocked("gemini", "no GEMINI_API_KEY", "aistudio.google.com: create a free API key, set GEMINI_API_KEY.");
  if (!ctx.budget.take("ai")) return blocked("gemini", `AI question budget used up (${ctx.budget.max.ai} answers per run)`, "Raise measure.budgets.ai, or ask fewer questions.");
  let res;
  try {
    res = await fetch(`${ctx.endpoints.gemini}/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ contents: [{ parts: [{ text: question }] }], tools: [{ google_search: {} }] }) });
  } catch (e) { return blocked("gemini", `request failed: ${e.message}`, "Run again."); }
  const fetchedAt = new Date().toISOString();
  let j = {}; try { j = await res.json(); } catch {}
  if (res.status === 429) return { ok: false, rateLimited: true, blocked: { source: "gemini", reason: "free-tier rate limit (429): stopped, not retried", unblock: "Wait for the quota to reset (per minute / per day) and run again; use a longer gap between answers." } };
  if (!res.ok) return blocked("gemini", `Gemini answered ${res.status}: ${j.error?.message || ""}`.trim(), res.status === 400 || res.status === 403 ? "Check GEMINI_API_KEY and that the model name in measure.ai.model exists for the free tier." : "Run again later.");
  const cand = j.candidates?.[0] || {};
  const text = (cand.content?.parts || []).map((p) => p.text || "").join("");
  const gm = cand.groundingMetadata || {};
  const cited = new Set();
  for (const c of gm.groundingChunks || []) {
    const w = c.web || {}; const title = String(w.title || "").toLowerCase();
    const d = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(title) ? title.replace(/^www\./, "") : (domainOf(w.uri) && !/vertexaisearch|googleapis|google\.com$/.test(domainOf(w.uri)) ? domainOf(w.uri) : "");
    if (d) cited.add(d);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) { const d = domainOf(m[0]); if (d) cited.add(d); }
  return { ok: true, fetchedAt, model, answerHash: sha(text), citedDomains: [...cited].sort(), grounded: (gm.groundingChunks || []).length > 0, searchQueries: gm.webSearchQueries || [] };
}

// ---------- imports: owner-supervised browser captures ----------
export function loadCaptures(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith(".json")).sort()) {
    const j = readJson(path.join(dir, f)); if (!j) continue;
    for (const c of Array.isArray(j) ? j : [j]) out.push({ ...c, _file: path.join(dir, f) });
  }
  return out;
}

// A ranking row is rejected when location, device, language, source or fetchedAt is missing (targets.md).
export function validateRankingRow(r) {
  const miss = [];
  if (!r.location) miss.push("location"); if (!r.device) miss.push("device"); if (!r.language) miss.push("language");
  if (!r.position || !r.position.source) miss.push("source"); if (!r.position || !r.position.fetchedAt) miss.push("fetchedAt");
  return miss;
}
export const rankKey = (r) => [nfkc(r.query), r.engine, r.source, nfkc(r.location), r.device, r.language].join("|");

// Browser captures -> ranking rows for our domain. A capture whose page footer shows a different place than the one
// requested (the project's 2026-10-17 finding: Google ignored the uule parameter) is kept under the place it really
// showed and marked localized:false, never counted as the requested city.
// Two capture formats are accepted: this skill's flat one (location + locationShown + capturedIn) and research-serp-import's
// (location:{requested, footer, method}, browser), so one owner capture feeds both research and measure.
export function normCapture(c) {
  const loc = c.location && typeof c.location === "object" ? c.location : null;
  return { ...c, location: loc ? loc.requested || null : c.location || null, locationShown: c.locationShown || (loc ? loc.footer : null) || null, capturedIn: c.capturedIn || c.browser || null,
    localPack: (c.localPack || []).map((p) => ({ ...p, reviews: p.reviews ?? p.reviewCount })) };
}
export function rankingRowsFromCaptures(caps, { domain, aliases = [], targetQueries = null, language = "en" }) {
  const rows = [], rejected = [];
  const tq = targetQueries ? new Set(targetQueries.map(nfkc)) : null;
  for (let c of caps) {
    c = normCapture(c);
    if (!c.query || (c.organic == null && c.localPack == null)) { rejected.push({ file: c._file, reason: "capture has no query or no result list" }); continue; }
    if (tq && !tq.has(nfkc(c.query))) continue;
    const requested = c.location || null; let location = requested, localized = true;
    // research-serp-import labels a capture with no requested city (Bing has no location setting) "NOT LOCALIZED (baseline): ...":
    // an honest place label, comparable only with itself.
    if (!requested && c.locationLabel) { location = c.locationLabel; localized = false; }
    else if (requested && c.locationShown && !words(c.locationShown).some((w) => words(requested.split(",")[0]).includes(w))) { location = c.locationShown; localized = false; }
    const organic = (c.organic || []).map((o) => ({ position: Number(o.position), domain: domainOf(o.url || o.domain) })).filter((o) => o.position && o.domain).sort((a, b) => a.position - b.position);
    const mine = organic.find((o) => isOurs(o.domain, domain, aliases));
    const engine = c.engine || "google";
    const base = { query: c.query, engine, source: "browser-capture", location, requestedLocation: requested, localized, device: c.device, language: c.language || language, url: c.organic?.find((o) => isOurs(o.url || o.domain, domain, aliases))?.url || null };
    const src = `owner browser capture (${c.capturedIn || "browser, details not recorded"})`;
    const row = { ...base, position: fact(mine ? mine.position : null, src, c.capturedAt, c._file, { location, device: c.device, estimate: false }),
      checkedTop: organic.length, above: organic.filter((o) => !mine || o.position < mine.position).slice(0, 10).map((o) => o.domain) };
    const miss = validateRankingRow(row);
    if (miss.length) rejected.push({ file: c._file, query: c.query, reason: `missing ${miss.join(", ")}` }); else rows.push(row);
    if (c.localPack?.length) {
      const lp = c.localPack.map((p, i) => ({ position: Number(p.position ?? i + 1), name: p.name, domain: domainOf(p.website || p.url) }));
      const mineLp = lp.find((p) => (p.domain && isOurs(p.domain, domain, aliases)) || (c.ourBusinessName && nfkc(p.name).includes(nfkc(c.ourBusinessName))));
      const lrow = { ...base, engine: "google-local-pack", url: null, position: fact(mineLp ? mineLp.position : null, src, c.capturedAt, c._file, { location, device: c.device, estimate: false }), checkedTop: lp.length, above: lp.filter((p) => !mineLp || p.position < mineLp.position).map((p) => p.name) };
      const m2 = validateRankingRow(lrow); if (m2.length) rejected.push({ file: c._file, query: c.query, reason: `local pack: missing ${m2.join(", ")}` }); else rows.push(lrow);
    }
  }
  // The same query + engine + source + place + device + language captured twice: the newest wins, older ones are listed.
  const best = new Map(), superseded = [];
  for (const r of rows.slice().sort((x, y) => String(x.position.fetchedAt).localeCompare(String(y.position.fetchedAt)))) { const k = rankKey(r); if (best.has(k)) superseded.push(best.get(k).position.cacheFile); best.set(k, r); }
  return { rows: [...best.values()], rejected, superseded };
}

// Parse one of the project's own capture files (icm/work/p0.2/fresh/<ID>.google.md|bing.md). Line-based, anchored on the
// labels the capture protocol wrote ("Organic top 10:", "Location:", "Named in the AI answer", "Local / Places pack:").
export function parseFreshMarkdown(text, d = {}) {
  const line = (re) => { const m = text.split(/\r?\n/).find((l) => re.test(l)); return m || null; };
  const org = line(/^Organic top 10/i);
  const organic = [];
  if (org) for (const m of org.split(/ · | · /)) { const x = /(?:^|\s)(\d{1,2}) ([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=\s|\(|$)/i.exec(m.replace(/^Organic top 10[^:]*:\s*/i, "")); if (x) organic.push({ position: Number(x[1]), domain: x[2].toLowerCase() }); }
  const loc = line(/^Location:/i) || "";
  const footer = /footer location shown:\s*"([^"]+)"/i.exec(loc);
  const req = /location set to (.+?) with the uule/i.exec(loc);
  const pack = line(/^Local \/ Places pack:/i);
  const localPack = pack ? pack.replace(/^[^:]*:\s*/, "").split(" · ").map((p) => p.replace(/\s*\(.*$/, "").replace(/^"?More.*$/i, "").trim()).filter(Boolean).map((name, i) => ({ position: i + 1, name })) : [];
  const named = line(/^Named in the AI answer/i);
  const srcs = line(/^Sources shown with the AI answer/i);
  return { query: d.query || (/"([^"]+)"/.exec(text.split("\n")[0]) || [])[1] || null, engine: d.engine || "google", location: d.location || (req ? req[1].trim() : null), locationShown: d.locationShown || (footer ? footer[1] : null),
    device: d.device || "desktop", language: d.language || "en", capturedAt: d.capturedAt || null, capturedIn: d.capturedIn || (/EDGE/i.test(text) ? "owner's Edge, signed in" : "built-in browser, signed out"),
    organic, localPack, aiOverview: { present: /AI OVERVIEW:\s*PRESENT/i.test(text), named: named ? named.replace(/^[^:]*:\s*/, "").split(" · ").map((s) => s.replace(/\s*\(.*$/, "").trim()).filter(Boolean) : [], sources: srcs ? [...srcs.matchAll(/\(([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()) : [] } };
}

// AI answers captured by the owner (ChatGPT, Perplexity, Google AI Overview...): grouped per question + engine + model + place.
// Accepts this skill's `citedDomains` and research-ai's `sources` (domains or {url|domain}); .md files of the project's own format
// (AI-<ID>.<engine>.md) are read with research-ai.mjs parseOwnerMarkdown when that script exists.
export async function loadAiCaptures(dir) {
  const caps = loadCaptures(dir).map((c) => ({ ...c, citedDomains: c.citedDomains || (c.sources || []).map((x) => domainOf(typeof x === "string" ? x : x.url || x.domain || "")).filter(Boolean), capturedIn: c.capturedIn || c.browser || null }));
  const skippedMd = [];
  if (dir && fs.existsSync(dir)) {
    const mds = fs.readdirSync(dir).filter((f) => /\.(chatgpt|gemini|perplexity|copilot)\.md$/i.test(f)).sort();
    if (mds.length) {
      // only a MISSING research-ai.mjs falls back; a broken one (syntax error, bad import) is a bug that must surface, not a silent skip
      let parse = null; try { parse = (await import("./research-ai.mjs")).parseOwnerMarkdown; } catch (e) { if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e; }
      for (const f of mds) {
        if (!parse) { skippedMd.push({ file: path.join(dir, f), reason: "research-ai.mjs not found: cannot read the project's markdown capture format" }); continue; }
        const p = parse(fs.readFileSync(path.join(dir, f), "utf8"), path.join(dir, f));
        caps.push({ question: p.question, engine: p.engine, capturedAt: p.capturedAt, capturedIn: p.browser, location: p.location, citedDomains: p.sources || [], _file: p.file });
      }
    }
  }
  return { caps, skippedMd };
}
export function aiRowsFromCaptures(caps, { domain, aliases = [], competitors = [] }) {
  const g = new Map(), rejected = [];
  for (const c of caps) {
    if (!c.question || !c.engine || !Array.isArray(c.citedDomains)) { rejected.push({ file: c._file, reason: "needs question, engine, citedDomains[] (or sources[])" }); continue; }
    if (!c.capturedAt || Number.isNaN(Date.parse(c.capturedAt))) { rejected.push({ file: c._file, question: c.question, reason: "no capture date: an undated answer is not evidence" }); continue; }
    const k = `${nfkc(c.question)}|${c.engine}|${c.model || ""}|${nfkc(c.location || "")}`;
    (g.get(k) || g.set(k, []).get(k)).push(c);
  }
  const rows = [...g.values()].map((list) => {
    const first = list[0]; const cited = list.filter((c) => c.citedDomains.some((d) => isOurs(d, domain, aliases))).length;
    const counts = {}; for (const c of list) for (const d of new Set(c.citedDomains.map(domainOf).filter(Boolean))) counts[d] = (counts[d] || 0) + 1;
    const date = list.map((c) => c.capturedAt).filter(Boolean).sort().pop();
    return { question: first.question, engine: first.engine, model: first.model || "not shown (consumer app)", prompt: first.prompt || first.question, runs: list.length, location: first.location || "not recorded",
      citedShare: fact(cited / list.length, `owner browser capture (${first.capturedIn || "browser"}), ${list.length} answer(s)`, date, list.map((c) => c._file).join("; "), { estimate: list.length < 3 }), citedCount: cited,
      citedSources: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([d]) => d), sourceCounts: counts, ourDomainCited: cited > 0,
      competitorsCited: competitors.filter((c) => counts[domainOf(c)]).map(domainOf), lowSample: list.length < 3, method: "browser-capture" };
  });
  return { rows, rejected };
}

// ---------- html helpers shared with migrate / local ----------
const decode = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
export function htmlInfo(html) {
  html = String(html || "");
  const tag = (re) => { const m = re.exec(html); return m ? decode(m[1].replace(/<[^>]+>/g, "")) : null; };
  const meta = (name) => { const m = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i").exec(html); const c = m && /content=["']([^"']*)["']/i.exec(m[0]); return c ? decode(c[1]) : null; };
  const jsonld = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { const j = JSON.parse(m[1]); jsonld.push(...(Array.isArray(j) ? j : j["@graph"] ? j["@graph"] : [j])); } catch {} }
  const canon = /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(html); const ch = canon && /href=["']([^"']+)["']/i.exec(canon[0]);
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  return { title: tag(/<title[^>]*>([\s\S]*?)<\/title>/i), h1: tag(/<h1[^>]*>([\s\S]*?)<\/h1>/i), description: meta("description"), robots: meta("robots"), canonical: ch ? ch[1] : null, jsonld, text: decode(body.replace(/<[^>]+>/g, " ")),
    tel: [...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => safeDecode(m[1])), links: [...html.matchAll(/<a[^>]+href=["']([^"'#][^"']*)["']/gi)].map((m) => m[1]) };
}
// Path as the redirect map uses it: no origin, no query or fragment, no trailing slash (except the root), percent-decoding left alone.
export function normPath(u) {
  let p = String(u || "").trim();
  try { if (/^https?:\/\//i.test(p)) p = new URL(p).pathname; } catch {}
  p = p.replace(/[?#].*$/, "").replace(/\/{2,}/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/index\.html?$/i, "/");
  return p.length > 1 ? p.replace(/\/$/, "") : p;
}
