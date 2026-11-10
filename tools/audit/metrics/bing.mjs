// Bing: the daily Webmaster stats row (collectBing) and the IndexNow ping on every publish (indexNowPing), kept together in ONE `bing` row per day
// (data.indexnow = the day's pings, a second publish the same day appends). Deno-loadable, see util.mjs.
// Webmaster JSON API: GET https://ssl.bing.com/webmaster/api.svc/json/<Method>?apikey=&siteUrl=  (key: keys.BING_WEBMASTER_KEY), answers { d: ... }.
// IndexNow (indexnow.org): POST https://api.indexnow.org/indexnow { host, key, keyLocation, urlList }; 200 or 202 = taken. The site must host the key file
// (its name is the key, so keyLocation is never stored). The metrics_snapshots table accepts source 'bing' only after platform's block 6 migration.
import { client, blockedRow, blockedData, assertValid, round, isHttpUrl, isDay, addDays, isObj } from "./util.mjs";
import { validateBingRow, TOP_CAP } from "./shapes.mjs";

const BING = "https://ssl.bing.com/webmaster/api.svc/json";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const NO_KEY = ["no BING_WEBMASTER_KEY", "Verify the site in Bing Webmaster Tools, create an API key (Settings, API access), set BING_WEBMASTER_KEY."];
const NO_SITE = ["no site in Bing Webmaster Tools is verified for this key", "Add and verify the site in Bing Webmaster Tools (it can import from Search Console), then run again."];

// "/Date(1730000000000-0700)/" -> "2024-10-27"
const bingDay = (s) => { const m = /\/Date\((-?\d+)/.exec(String(s)); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(s).slice(0, 10); };
// Daily rows -> per-key totals for the window. Position is impression-weighted.
function aggregate(rows, keyOf, start, end) {
  const by = new Map();
  for (const r of rows) {
    const d = bingDay(r.Date); if (!isDay(d) || d < start || d > end) continue;
    const k = keyOf(r); if (!k) continue;
    const o = by.get(k) || { key: String(k), clicks: 0, impressions: 0, posW: 0 };
    o.clicks += r.Clicks || 0; o.impressions += r.Impressions || 0; o.posW += (r.AvgImpressionPosition ?? r.AvgClickPosition ?? 0) * (r.Impressions || 0);
    by.set(k, o);
  }
  const all = [...by.values()].map((o) => ({ key: o.key, clicks: o.clicks, impressions: o.impressions, ctr: o.impressions ? round(o.clicks / o.impressions, 4) : 0, position: o.impressions ? round(o.posW / o.impressions, 2) : null }));
  return all.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || (a.key < b.key ? -1 : 1));
}
const stopReason = (status, error) => (status === 401 || status === 403 ? [`Bing refused the key or the site (${status})`, "Check that the API key belongs to an account that owns this site in Bing Webmaster Tools."]
  : status === 429 ? ["Bing rate limit (429): stopped, not retried", "Run again later."]
  : status === 0 ? [`no answer from Bing: ${error}`, "Check the network and run again."] : [`Bing answered ${status}`, "Run again later; if it keeps failing check the key and that the site is verified."]);

// The sites this key can read, with their verified flag: { sites: [{ url, verified }] } or { blocked }. One small call (GetUserSites).
export async function listBingSites({ fetch, keys = {}, timeoutMs = 30000 }) {
  if (!keys.BING_WEBMASTER_KEY) return { blocked: blockedData(...NO_KEY).blocked, calls: [] };
  const c = client({ fetch, secrets: [keys.BING_WEBMASTER_KEY], timeoutMs });
  const r = await c.request("GetUserSites", `${BING}/GetUserSites?apikey=${encodeURIComponent(keys.BING_WEBMASTER_KEY)}`);
  if (!r.ok) { const [reason, unblock] = stopReason(r.status, r.error); return { blocked: { reason, unblock }, calls: c.calls }; }
  if (!Array.isArray(r.json?.d)) return { blocked: { reason: "Bing's site list is not the documented shape (no d array)", unblock: "Run again; if it keeps happening the API has changed." }, calls: c.calls };
  return { sites: r.json.d.map((s) => ({ url: s.Url, verified: s.IsVerified === true })), calls: c.calls };
}

// Keep the day's pings when the row is rebuilt (the list rides along on a blocked row too).
const blockedBing = (workspaceId, day, indexnow, reason, unblock, calls = []) => ({ row: assertValid(blockedRow(workspaceId, "bing", day, reason, unblock, { indexnow }), validateBingRow), calls, notes: [] });

export async function collectBing({ fetch, keys = {}, workspaceId, day, site, start, end, indexnow = [], rowCap = TOP_CAP, timeoutMs = 30000 }) {
  if (!keys.BING_WEBMASTER_KEY) return blockedBing(workspaceId, day, indexnow, ...NO_KEY);
  if (!site) return blockedBing(workspaceId, day, indexnow, ...NO_SITE);
  const win = { start: start || addDays(day, -2), end: end || start || addDays(day, -2) };
  const c = client({ fetch, secrets: [keys.BING_WEBMASTER_KEY], timeoutMs });
  const get = (method) => c.request(method, `${BING}/${method}?apikey=${encodeURIComponent(keys.BING_WEBMASTER_KEY)}&siteUrl=${encodeURIComponent(site)}`);
  const out = {};
  for (const method of ["GetQueryStats", "GetPageStats", "GetCrawlStats"]) {
    const r = await get(method);
    if (!r.ok) return blockedBing(workspaceId, day, indexnow, ...stopReason(r.status, r.error), c.calls);
    if (!Array.isArray(r.json?.d)) return blockedBing(workspaceId, day, indexnow, `Bing's ${method} answer is not the documented shape (no d array)`, "Run again; if it keeps happening the API has changed.", c.calls);
    out[method] = r.json.d;
  }
  const queries = aggregate(out.GetQueryStats, (r) => r.Query, win.start, win.end);
  const pages = aggregate(out.GetPageStats, (r) => r.Query ?? r.Page ?? r.Url, win.start, win.end);
  const totals = queries.reduce((t, q) => ({ clicks: t.clicks + q.clicks, impressions: t.impressions + q.impressions }), { clicks: 0, impressions: 0 });
  // the newest crawl row on or before the window's end
  const crawlRows = out.GetCrawlStats.map((r) => ({ r, d: bingDay(r.Date) })).filter((x) => isDay(x.d) && x.d <= win.end).sort((a, b) => (a.d < b.d ? 1 : -1));
  const k = crawlRows[0]?.r;
  const crawl = k ? { date: crawlRows[0].d, crawledPages: k.CrawledPages ?? null, crawlErrors: k.CrawlErrors ?? null, code4xx: k.Code4xx ?? null, code5xx: k.Code5xx ?? null, inIndex: k.InIndex ?? null } : null;
  const data = { site, window: win, totals, queries: queries.slice(0, rowCap), pages: pages.slice(0, rowCap), crawl, indexnow };
  return { row: assertValid({ workspace_id: workspaceId, source: "bing", day, data }, validateBingRow), calls: c.calls, notes: [] };
}

// POST the changed addresses to IndexNow. { ping: { at, urls, status, endpoint }, ok, calls }. The ping is a record of what happened, 4xx included;
// ok is true on 200 or 202. The key and the key file's address are never in the ping, the calls or the notes.
export async function indexNowPing({ fetch, host, key, keyLocation, urls, now = () => new Date(), timeoutMs = 30000 }) {
  if (!host || !key || !isHttpUrl(keyLocation)) throw new TypeError("indexNowPing needs host, key and keyLocation (the address of the key file on the site)");
  if (!Array.isArray(urls) || !urls.length || urls.length > 10000 || !urls.every(isHttpUrl)) throw new TypeError("indexNowPing needs 1 to 10000 http(s) urls");
  const off = urls.filter((u) => new URL(u).host !== host);
  if (off.length) throw new TypeError(`indexNowPing: ${off.length} url(s) are not on ${host} (IndexNow refuses them)`);
  const c = client({ fetch, secrets: [key, keyLocation], timeoutMs });
  const r = await c.request("indexnow", INDEXNOW_ENDPOINT, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ host, key, keyLocation, urlList: urls }) });
  return { ping: { at: now().toISOString(), urls: [...urls], status: r.status, endpoint: INDEXNOW_ENDPOINT }, ok: r.status === 200 || r.status === 202, calls: c.calls };
}

// Add a ping to the day's row (a second publish the same day appends). With no row yet for the day the row is one that says the stats are not pulled yet.
export function appendIndexNow(row, ping, { workspaceId, day } = {}) {
  if (row && !(isObj(row) && row.source === "bing")) throw new TypeError("appendIndexNow takes a bing row or null");
  const base = row || blockedRow(workspaceId, "bing", day, "the Bing statistics are not pulled yet today", "The daily Bing pull fills them in once a verified site and BING_WEBMASTER_KEY exist.", { indexnow: [] });
  const list = Array.isArray(base.data.indexnow) ? base.data.indexnow : [];
  return assertValid({ ...base, data: { ...base.data, indexnow: [...list, ping] } }, validateBingRow);
}
