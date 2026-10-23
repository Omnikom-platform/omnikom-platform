// Google Search Console API client (free; owner OAuth): real queries, pages, clicks, impressions, average position, by country and device.
// Usage: node research-gsc.mjs <target> [--property sc-domain:example.com | https://example.com/] [--days 90] [--country usa] [--max-rows 5000] [--cwd DIR]
// Token file (never printed, never cached): $GSC_TOKEN_FILE or ~/.config/pewp/gsc-token.json, JSON with either
//   { access_token, expiry_date? } or { refresh_token, client_id, client_secret } (a refreshed token is kept in memory only).
// Test hooks: GSC_API_BASE, GSC_TOKEN_URL. Every response is cached with cache.mjs (the Authorization header is not stored).
// Output: research/gsc.json { property, range, rows:[{query, page, country, device, language, engine, position, clicks, impressions, ctr}] }
// where position/clicks/impressions are sourced numbers. No token => BLOCKED (exit 3). Search Console data is for OUR site only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Blocked, J, iso, context, needBusiness, runCli, writeStep, writeBlocked, cachedFetch, factor, pace } from "./research-lib.mjs";

const API = () => (process.env.GSC_API_BASE || "https://searchconsole.googleapis.com").replace(/\/$/, "");
const TOKEN_URL = () => process.env.GSC_TOKEN_URL || "https://oauth2.googleapis.com/token";
export const tokenFile = () => process.env.GSC_TOKEN_FILE || path.join(os.homedir(), ".config", "pewp", "gsc-token.json");
const UNBLOCK = "the site owner adds our Google account as a user of the Search Console property, then we save an OAuth token at ~/.config/pewp/gsc-token.json (or set GSC_TOKEN_FILE); see scripts/doctor.mjs";

async function accessToken() {
  const t = J(tokenFile());
  if (!t) throw new Blocked(UNBLOCK);
  // the same token file serves measure-sources.mjs, which writes `expiry` (ISO); Google's own files carry `expiry_date` (ms)
  const exp = t.expiry_date ?? t.expiry;
  const expMs = typeof exp === "number" ? exp : exp ? Date.parse(exp) : null;
  if (t.access_token && (expMs == null || Number.isNaN(expMs) || expMs > Date.now() + 60000)) return t.access_token;
  if (t.refresh_token && t.client_id && t.client_secret) {
    const res = await fetch(TOKEN_URL(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id, client_secret: t.client_secret }), signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    if (!j.access_token) throw new Blocked(`the Search Console token could not be refreshed (HTTP ${res.status}); the owner re-authorises and we save a new token at ${tokenFile()}`);
    return j.access_token;
  }
  throw new Blocked(`${tokenFile()} has no usable access_token or refresh_token+client_id+client_secret; ${UNBLOCK}`);
}

async function gsc(ctx, token, url, body) {
  await pace(url, 1000);
  const r = await cachedFetch(ctx.pewp, "gsc", url, { maxAgeDays: 1, init: { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) } });
  if (r.status === 401 || r.status === 403) throw new Blocked(`Search Console refused (HTTP ${r.status}): the account behind the token must be a user of the property; ${UNBLOCK}`);
  if (r.status === 429) throw new Blocked("Search Console rate limit (HTTP 429): wait and re-run; cached pages are kept");
  if (r.status !== 200) throw new Error(`Search Console HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  return r;
}

export async function run(ctx, { property = null, days = 90, country = null, maxRows = 5000, endDate = null } = {}) {
  const b = needBusiness(ctx);
  let token;
  try { token = await accessToken(); } catch (e) { if (e instanceof Blocked) { writeBlocked(ctx, "gsc", e.unblock); throw e; } throw e; }
  try {
    if (!property) {
      const list = await gsc(ctx, token, `${API()}/webmasters/v3/sites`, null);
      const sites = (list.json().siteEntry || []).map((s) => s.siteUrl);
      property = sites.find((s) => s === `sc-domain:${b.domain}`) || sites.find((s) => s.includes(b.domain)) || null;
      if (!property) throw new Blocked(`the token's account has no Search Console property for ${b.domain} (it sees: ${sites.join(", ") || "none"}); the owner adds us as a user, or pass --property`);
    }
    const end = endDate || new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10); // GSC data lags about 2 days
    const start = new Date(Date.parse(end) - days * 86400000).toISOString().slice(0, 10);
    const rows = []; let first = null, startRow = 0, skippedDevices = 0;
    while (rows.length < maxRows) {
      const body = { startDate: start, endDate: end, dimensions: ["query", "page", "country", "device"], rowLimit: Math.min(25000, maxRows - rows.length), startRow, ...(country ? { dimensionFilterGroups: [{ filters: [{ dimension: "country", operator: "equals", expression: country }] }] } : {}) };
      const r = await gsc(ctx, token, `${API()}/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, body);
      first ||= r;
      const f = factor(`Google Search Console API ${property} ${start}..${end}`, r.fetchedAt, r.cacheFile);
      const batch = r.json().rows || [];
      for (const x of batch) {
        const [query, page, ctry, device] = x.keys;
        const dev = String(device).toLowerCase();
        if (!['mobile', 'desktop'].includes(dev)) { skippedDevices++; continue; } // the ranking-row contract knows mobile and desktop only
        const base = { location: String(ctry).toUpperCase(), device: dev };
        rows.push({ query, url: page, page, country: String(ctry).toUpperCase(), location: String(ctry).toUpperCase(), device: dev, language: ctx.market.language, engine: "google",
          position: f(Math.max(1, Math.round(x.position)), { ...base, estimate: true, unit: "average position over the range, rounded to a whole place (ranking-row contract)" }), averagePosition: f(Math.round(x.position * 10) / 10, { ...base, unit: "average position over the range, one decimal" }), clicks: f(x.clicks, base), impressions: f(x.impressions, base), ctr: f(Math.round(x.ctr * 10000) / 10000, base) });
      }
      if (batch.length < 25000 || !batch.length) break;
      startRow += batch.length;
    }
    return writeStep(ctx, "gsc", { property, range: { start, end }, country, rowCount: rows.length, skippedTabletRows: skippedDevices, rows });
  } catch (e) { if (e instanceof Blocked) writeBlocked(ctx, "gsc", e.unblock); throw e; }
}

await runCli(import.meta.url, "node research-gsc.mjs <target> [--property P] [--days 90] [--country usa] [--max-rows 5000] [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { property: a.get("property"), days: a.num("days", 90), country: a.get("country"), maxRows: a.num("max-rows", 5000) });
  return `OK gsc: ${r.rowCount} rows for ${r.property} ${r.range.start}..${r.range.end} -> ${path.join(ctx.rdir, "gsc.json")}`;
});
