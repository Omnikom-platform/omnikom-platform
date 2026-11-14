// Search Console: the daily row (collectSearchConsole) and the sitemap submit after a publish (submitSitemap, C16). Deno-loadable, see util.mjs.
// The credential is the service-account key of the one Omnikom Search Console account (keys.GOOGLE_SERVICE_ACCOUNT_JSON, the base64 of its JSON); a token is minted per call. The account does not exist yet, so live is UNPROVEN: fixtures only.
// Calls: POST sites/{property}/searchAnalytics/query (totals, top queries, top pages), GET sites/{property}/sitemaps, PUT sites/{property}/sitemaps/{url}.
// The window defaults to the one day that is two days before `day` (Search Console data lags); a 28-day baseline passes start and end.
import { client, blockedRow, addDays, assertValid, round, isHttpUrl } from "./util.mjs";
import { validateSearchConsoleRow, TOP_CAP } from "./shapes.mjs";

const GSC = "https://www.googleapis.com/webmasters/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token", KEY_NAME = "GOOGLE_SERVICE_ACCOUNT_JSON";
const SCOPE_READ = "https://www.googleapis.com/auth/webmasters.readonly", SCOPE_WRITE = "https://www.googleapis.com/auth/webmasters";
const NOT_CONNECTED = ["the Omnikom Search Console account is not connected", `Set ${KEY_NAME} (the base64 of the Omnikom Search Console service-account key) in the function's secrets or the environment.`];
const NOT_VERIFIED = ["this domain is not verified in our account", "Verify the domain in the Omnikom Search Console account (a DNS record on the site we host) and add the service-account email as a user of the property."];
const keyRefused = (why) => [`Google did not accept the Omnikom Search Console credential: ${why}`, `Check ${KEY_NAME}: a current key of the service account, and the Search Console API enabled for its project.`];
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const text64 = (s) => b64u(new TextEncoder().encode(s));
// The scrub list of a call: the credential, the private key with its lines, the access token (12 characters or more, so a short value never eats plain words). It grows in place: the client's scrubber reads it at every call, so every text that leaves a collector has them cut.
const keep = (list, ...vals) => { for (const v of vals) if (typeof v === "string" && v.length >= 12) list.push(v); };
// A one-hour signed request (RS256, WebCrypto, no node: import) exchanged for an access token: { token } or { why }; why never holds the key.
async function mintToken(c, secrets, credential, scope) {
  keep(secrets, credential);
  let sa; try { sa = JSON.parse(atob(credential)); } catch { return { why: "it is not the base64 of a JSON key" }; }
  if (typeof sa?.client_email !== "string" || typeof sa.private_key !== "string") return { why: "the key has no client_email and private_key" };
  keep(secrets, sa.private_key, ...sa.private_key.split("\n").map((l) => l.trim()));
  const now = Math.floor(Date.now() / 1000), head = text64(JSON.stringify({ alg: "RS256", typ: "JWT" })), body = text64(JSON.stringify({ iss: sa.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  let sig;
  try {
    const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")), (ch) => ch.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    sig = b64u(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`))));
  } catch { return { why: "its private key cannot sign" }; }
  const r = await c.request("token", TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${sig}` }).toString() });
  if (!(r.ok && typeof r.json?.access_token === "string")) return { why: r.status ? `Google's token endpoint answered ${r.status}` : `no answer from Google's token endpoint: ${r.error}` };
  keep(secrets, r.json.access_token); return { token: r.json.access_token };
}

// An answer that stops the source: the row says what the status means and what unblocks it.
function refusal(status, error) {
  if (status === 401) return keyRefused("the API refused the token (401)");
  if (status === 403 || status === 404) return NOT_VERIFIED;
  if (status === 429) return ["Google rate limit (429): stopped, not retried", "Run again tomorrow."];
  if (status === 0) return [`no answer from Google: ${error}`, "Check the network and run again."];
  return [`Search Console answered ${status}`, "Run again; if it keeps failing check the property name and the token."];
}

export async function collectSearchConsole({ fetch, keys, workspaceId, day, domain, start, end, rowCap = TOP_CAP, timeoutMs = 30000 }) {
  const row0 = (reason, unblock) => ({ row: assertValid(blockedRow(workspaceId, "search-console", day, reason, unblock), validateSearchConsoleRow), calls: [], notes: [] });
  if (!keys?.[KEY_NAME]) return row0(...NOT_CONNECTED);
  if (!domain) return row0(...NOT_VERIFIED);
  const property = `sc-domain:${domain}`, secrets = [];
  const c = client({ fetch, secrets, timeoutMs });
  const m = await mintToken(c, secrets, keys[KEY_NAME], SCOPE_READ); if (!m.token) return { ...row0(...keyRefused(m.why)), calls: c.calls };
  const token = m.token;
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
export async function submitSitemap({ fetch, keys, domain, sitemapUrl, timeoutMs = 30000 }) {
  if (!domain || !isHttpUrl(sitemapUrl)) throw new TypeError("submitSitemap needs a domain and a sitemapUrl that is an http(s) address");
  if (!keys?.[KEY_NAME]) return { ok: false, blocked: { reason: NOT_CONNECTED[0], unblock: NOT_CONNECTED[1] }, calls: [] };
  const secrets = [], c = client({ fetch, secrets, timeoutMs });
  const m = await mintToken(c, secrets, keys[KEY_NAME], SCOPE_WRITE); if (!m.token) { const [reason, unblock] = keyRefused(m.why); return { ok: false, blocked: { reason, unblock }, calls: c.calls }; }
  const r = await c.request("sitemap-submit", `${GSC}/sites/${encodeURIComponent(`sc-domain:${domain}`)}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: "PUT", headers: { authorization: `Bearer ${m.token}` } });
  if (r.ok) return { ok: true, status: r.status, calls: c.calls };
  const [reason, unblock] = refusal(r.status, r.error);
  return { ok: false, status: r.status, blocked: { reason, unblock }, calls: c.calls };
}
