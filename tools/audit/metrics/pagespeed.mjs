// PageSpeed Insights on up to five pages (mobile) plus the origin's CrUX numbers (PHONE, p75), as ONE `pagespeed` row. Deno-loadable, see util.mjs.
// PSI: GET runPagespeed?url=&strategy=mobile&category=performance&key=  (key: keys.PSI_API_KEY). CrUX: POST records:queryRecord?key=  (keys.CRUX_API_KEY).
// CrUX answers HTTP 404 when it has no record for the origin: that is a result (data.crux.none), not an error. Any 429 or 403 stops that source.
// readAnswer is the skill's psi.mjs readAnswer (a test runs both over the same fixtures); the skill file imports node:fs, so it cannot be loaded here.
import { client, blockedRow, blockedData, sleepMs, isHttpUrl, assertValid, round } from "./util.mjs";
import { validatePageSpeedRow, PAGES_CAP } from "./shapes.mjs";

const PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CRUX = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
const NO_PSI = ["no PSI_API_KEY", "Google Cloud console: enable the PageSpeed Insights API, create a free API key, set PSI_API_KEY."];
const NO_CRUX = ["no CRUX_API_KEY", "Google Cloud console: enable the Chrome UX Report API, create a free API key, set CRUX_API_KEY."];

const num = (a, id) => { const v = a?.[id]?.numericValue; return typeof v === "number" && Number.isFinite(v) ? v : null; };
const ms = (v) => (v == null ? null : Math.round(v));
// The documented v5 answer -> the lab numbers, or an Error saying what was missing.
export function readAnswer(j) {
  const lh = j?.lighthouseResult;
  const score = lh?.categories?.performance?.score;
  if (typeof score !== "number") throw new Error("the answer has no performance score (Lighthouse did not run for this page)");
  const a = lh.audits || {};
  const cls = num(a, "cumulative-layout-shift");
  return { performance: Math.round(score * 100), lcpMs: ms(num(a, "largest-contentful-paint")), cls: cls == null ? null : Number(cls.toFixed(3)), tbtMs: ms(num(a, "total-blocking-time")), fcpMs: ms(num(a, "first-contentful-paint")), speedIndexMs: ms(num(a, "speed-index")) };
}
// The page's own field data when PSI returns it (loadingExperience of the URL, not the origin fallback), else null. PSI scales the CLS percentile by 100.
export function readField(j) {
  const le = j?.loadingExperience;
  if (!le?.metrics || le.origin_fallback) return null;
  const m = le.metrics, p = (k) => (typeof m[k]?.percentile === "number" ? m[k].percentile : null);
  const cls = p("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  const f = { lcpMs: p("LARGEST_CONTENTFUL_PAINT_MS"), inpMs: p("INTERACTION_TO_NEXT_PAINT"), cls: cls == null ? null : cls / 100 };
  return [f.lcpMs, f.inpMs, f.cls].some((v) => v !== null) ? f : null;
}

const day10 = (d) => (d && d.year ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null);
// One CrUX call for an origin -> { crux, calls }. crux is one of: numbers + collectionPeriod, { none: true, reason } (404), { blocked } (no key, 400/403/429, malformed).
export async function queryCrux({ fetch, key, origin, formFactor = "PHONE", timeoutMs = 30000 }) {
  if (!key) return { crux: { origin, blocked: blockedData(...NO_CRUX).blocked }, calls: [] };
  const c = client({ fetch, secrets: [key], timeoutMs });
  const r = await c.request("crux", `${CRUX}?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin, formFactor, metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"] }) });
  const block = (reason, unblock) => ({ crux: { origin, blocked: { reason, unblock } }, calls: c.calls });
  if (r.status === 404) return { crux: { origin, none: true, reason: "CrUX has no record for this origin (too few real visitors on phones yet)" }, calls: c.calls };
  if (r.status === 429) return block("CrUX rate limit (429): stopped, not retried", "Run again later.");
  if (r.status === 400 || r.status === 403) return block(`CrUX refused the request (${r.status})`, "Check CRUX_API_KEY and that the Chrome UX Report API is enabled for its project.");
  if (!r.ok) return block(r.status === 0 ? `no answer from CrUX: ${r.error}` : `CrUX answered ${r.status}`, "Run again later.");
  const rec = r.json?.record;
  if (!rec?.metrics) return block("CrUX answer is not the documented shape (no record.metrics)", "Run again; if it keeps happening the API has changed.");
  const p75 = (k) => { const v = rec.metrics[k]?.percentiles?.p75; return v == null || !Number.isFinite(Number(v)) ? null : Number(v); };
  const first = day10(rec.collectionPeriod?.firstDate), last = day10(rec.collectionPeriod?.lastDate);
  const crux = { origin, formFactor, lcpMs: ms(p75("largest_contentful_paint")), inpMs: ms(p75("interaction_to_next_paint")), cls: round(p75("cumulative_layout_shift"), 3), collectionPeriod: { first, last } };
  return { crux, calls: c.calls };
}

export async function collectPageSpeed({ fetch, keys = {}, workspaceId, day, urls, origin, gapMs = 2000, sleep = sleepMs, timeoutMs = 60000 }) {
  if (!Array.isArray(urls) || !urls.length || urls.length > PAGES_CAP || !urls.every(isHttpUrl)) throw new TypeError(`collectPageSpeed needs 1 to ${PAGES_CAP} http(s) urls`);
  const blockedOut = (reason, unblock) => ({ row: assertValid(blockedRow(workspaceId, "pagespeed", day, reason, unblock), validatePageSpeedRow), calls: [], notes: [] });
  if (!keys.PSI_API_KEY) return blockedOut(...NO_PSI);
  const c = client({ fetch, secrets: [keys.PSI_API_KEY, keys.CRUX_API_KEY], timeoutMs });
  const pages = [], failures = [], notes = [];
  let stopped = null;
  for (const [i, url] of urls.entries()) {
    if (i > 0) await sleep(gapMs);
    const q = new URLSearchParams({ url, strategy: "mobile", category: "performance" }); q.set("key", keys.PSI_API_KEY);
    const r = await c.request(`psi ${url}`, `${PSI}?${q}`);
    if (r.status === 429 || r.status === 403) { stopped = `Google answered ${r.status} for PageSpeed: stopped at ${url}; the pages after it were not asked`; break; }
    if (!r.ok) { failures.push({ url, error: r.status === 0 ? r.error : `Google answered ${r.status}` }); continue; }
    try { pages.push({ url, ...readAnswer(r.json), field: readField(r.json) }); } catch (e) { failures.push({ url, error: c.scrub(e.message).slice(0, 200) }); }
  }
  if (!pages.length) return { row: assertValid(blockedRow(workspaceId, "pagespeed", day, stopped || `every page failed (${failures.map((f) => f.error).join("; ").slice(0, 200)})`, "Run again later; a 403 or 429 means the key's quota or the API setting needs a look in Google Cloud."), validatePageSpeedRow), calls: c.calls, notes: failures.map((f) => `${f.url}: ${f.error}`) };
  if (stopped) notes.push(stopped);
  for (const f of failures) notes.push(`${f.url}: ${f.error}`);
  const cr = await queryCrux({ fetch, key: keys.CRUX_API_KEY, origin: origin || new URL(urls[0]).origin, timeoutMs });
  if (cr.crux.blocked) notes.push(`crux: ${cr.crux.blocked.reason}`);
  const data = { strategy: "mobile", pages, crux: cr.crux, ...(failures.length ? { failures } : {}) };
  return { row: assertValid({ workspace_id: workspaceId, source: "pagespeed", day, data }, validatePageSpeedRow), calls: [...c.calls, ...cr.calls], notes };
}
