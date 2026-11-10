// Search Console: the daily row (collectSearchConsole) and the sitemap submit after a publish (submitSitemap, C16). Deno-loadable, see util.mjs.
// The token is an OAuth access token passed in (the owner must verify a property first, so live is UNPROVEN: fixtures only).
// Calls: POST sites/{property}/searchAnalytics/query (totals, top queries, top pages), GET sites/{property}/sitemaps, PUT sites/{property}/sitemaps/{url}.
// The window defaults to the one day that is two days before `day` (Search Console data lags); a 28-day baseline passes start and end.
import { client, blockedRow, addDays, assertValid, round, isHttpUrl } from "./util.mjs";
import { validateSearchConsoleRow, TOP_CAP } from "./shapes.mjs";

const GSC = "https://www.googleapis.com/webmasters/v3";
const NO_ACCESS = ["no Search Console access: no verified property and token", "the site's owner verifies the site in Google Search Console (a DNS record) and connects their Google account"];

// An answer that stops the source: the row says what the status means and what unblocks it.
function refusal(status, error) {
  if (status === 401) return ["Google refused the token (401)", "Connect the Google account again (a fresh OAuth token)."];
  if (status === 403) return ["Google says this account may not read the property (403)", "The site owner adds our Google account as a user of the property (Settings, Users and permissions)."];
  if (status === 404) return ["Search Console does not know this property name (404)", "Use the exact property name: sc-domain:example.com or https://example.com/."];
  if (status === 429) return ["Google rate limit (429): stopped, not retried", "Run again tomorrow."];
  if (status === 0) return [`no answer from Google: ${error}`, "Check the network and run again."];
  return [`Search Console answered ${status}`, "Run again; if it keeps failing check the property name and the token."];
}

export async function collectSearchConsole({ fetch, token, workspaceId, day, property, start, end, rowCap = TOP_CAP, timeoutMs = 30000 }) {
  const row0 = (reason, unblock) => ({ row: assertValid(blockedRow(workspaceId, "search-console", day, reason, unblock), validateSearchConsoleRow), calls: [], notes: [] });
  if (!token || !property) return row0(...NO_ACCESS);
  const c = client({ fetch, secrets: [token], timeoutMs });
  const stop = (r) => ({ row: assertValid(blockedRow(workspaceId, "search-console", day, ...refusal(r.status, r.error)), validateSearchConsoleRow), calls: c.calls, notes: [] });
  const win = { start: start || addDays(day, -2), end: end || start || addDays(day, -2) };
  const site = `${GSC}/sites/${encodeURIComponent(property)}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const query = (what, dimensions, rowLimit) => c.request(what, `${site}/searchAnalytics/query`, { method: "POST", headers, body: JSON.stringify({ startDate: win.start, endDate: win.end, searchType: "web", dataState: "final", ...(dimensions ? { dimensions, rowLimit } : {}) }) });

  const t = await query("totals", null); if (!t.ok) return stop(t);
  const q = await query("queries", ["query"], rowCap); if (!q.ok) return stop(q);
  const g = await query("pages", ["page"], rowCap); if (!g.ok) return stop(g);
  const s = await c.request("sitemaps", `${site}/sitemaps`, { headers }); if (!s.ok) return stop(s);
  for (const [name, r] of [["totals", t], ["queries", q], ["pages", g], ["sitemaps", s]]) if (r.json === null || typeof r.json !== "object") return row0(`Search Console's ${name} answer is not JSON`, "Run again; if it keeps happening the API has changed.");

  // no rows = nothing was shown in that window: zeros, with no position
  const tr = t.json.rows?.[0];
  const totals = tr ? { clicks: tr.clicks, impressions: tr.impressions, ctr: round(tr.ctr, 4), position: round(tr.position, 2) } : { clicks: 0, impressions: 0, ctr: 0, position: null };
  const items = (r) => (r.json.rows || []).slice(0, rowCap).map((x) => ({ key: String(x.keys?.[0] ?? ""), clicks: x.clicks, impressions: x.impressions, ctr: round(x.ctr, 4), position: round(x.position, 2) }));
  const sitemaps = (s.json.sitemap || []).map((m) => ({ path: m.path, lastSubmitted: m.lastSubmitted ?? null, isPending: !!m.isPending, errors: Number(m.errors || 0), warnings: Number(m.warnings || 0) }));
  const row = { workspace_id: workspaceId, source: "search-console", day, data: { property, window: win, totals, queries: items(q), pages: items(g), sitemaps } };
  return { row: assertValid(row, validateSearchConsoleRow), calls: c.calls, notes: [] };
}

// C16: tell Google the sitemap changed (after every live publish). Not a row: { ok, status, calls } or { ok: false, blocked }. 204 and 200 are success.
export async function submitSitemap({ fetch, token, property, sitemapUrl, timeoutMs = 30000 }) {
  if (!property || !isHttpUrl(sitemapUrl)) throw new TypeError("submitSitemap needs a property and a sitemapUrl that is an http(s) address");
  if (!token) return { ok: false, blocked: { reason: NO_ACCESS[0], unblock: NO_ACCESS[1] }, calls: [] };
  const c = client({ fetch, secrets: [token], timeoutMs });
  const r = await c.request("sitemap-submit", `${GSC}/sites/${encodeURIComponent(property)}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: "PUT", headers: { authorization: `Bearer ${token}` } });
  if (r.ok) return { ok: true, status: r.status, calls: c.calls };
  const [reason, unblock] = refusal(r.status, r.error);
  return { ok: false, status: r.status, blocked: { reason, unblock }, calls: c.calls };
}
