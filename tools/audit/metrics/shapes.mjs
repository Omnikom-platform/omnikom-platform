// The row validators, one per source. Each takes a metrics_snapshots-shaped row { workspace_id, source, day, data } and returns a list of problems
// (empty = valid). A collector validates its own row before returning it; an invalid row is a thrown error, never a written row.
// A blocked row (data.blocked = { reason, unblock }) is valid by itself; the Bing one may also carry the day's IndexNow list.
import { isDay, isObj, isHttpUrl } from "./util.mjs";

export const TOP_CAP = 25;          // top queries and pages kept per row
export const PAGES_CAP = 5;         // PageSpeed pages per row (five, mobile)
export const ENGINES = ["chatgpt", "perplexity", "gemini"];   // the skill's lib-prompt-map.mjs ENGINES

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => typeof v === "string" && v.trim() !== "";
const numOrNull = (v) => v === null || (finite(v) && v >= 0);

function common(row, source) {
  if (!isObj(row)) return ["the row is not an object"];
  const p = [];
  if (!str(row.workspace_id)) p.push("workspace_id missing");
  if (row.source !== source) p.push(`source must be "${source}"`);
  if (!isDay(row.day)) p.push("day missing or not a real YYYY-MM-DD date");
  if (!isObj(row.data)) p.push("data missing");
  return p;
}
const blockedProblems = (b) => (isObj(b) ? [...(str(b.reason) ? [] : ["blocked.reason missing"]), ...(str(b.unblock) ? [] : ["blocked.unblock missing"])] : ["blocked must be { reason, unblock }"]);
const windowProblems = (w) => (isObj(w) && isDay(w.start) && isDay(w.end) && w.start <= w.end ? [] : ["window must be { start, end } real days with start <= end"]);
const statProblems = (list, name, withPos) => {
  if (!Array.isArray(list)) return [`${name} must be an array`];
  const p = [];
  if (list.length > TOP_CAP) p.push(`${name} holds more than ${TOP_CAP} items`);
  list.forEach((x, i) => {
    if (!isObj(x) || !str(x.key)) { p.push(`${name}[${i}].key missing`); return; }
    if (!finite(x.clicks) || x.clicks < 0) p.push(`${name}[${i}].clicks missing`);
    if (!finite(x.impressions) || x.impressions < 0) p.push(`${name}[${i}].impressions missing`);
    if (withPos) {
      if (!finite(x.ctr) || x.ctr < 0 || x.ctr > 1) p.push(`${name}[${i}].ctr must be 0 to 1`);
      if (x.position !== null && !(finite(x.position) && x.position >= 0)) p.push(`${name}[${i}].position missing`);
    }
  });
  return p;
};

// ---------- search-console ----------
export function validateSearchConsoleRow(row) {
  const p = common(row, "search-console"); if (p.length) return p;
  const d = row.data;
  if (d.blocked !== undefined) return blockedProblems(d.blocked);
  if (!str(d.property)) p.push("property missing");
  p.push(...windowProblems(d.window));
  const t = d.totals;
  if (!isObj(t)) p.push("totals missing");
  else {
    if (!finite(t.clicks) || t.clicks < 0) p.push("totals.clicks missing");
    if (!finite(t.impressions) || t.impressions < 0) p.push("totals.impressions missing");
    if (!finite(t.ctr) || t.ctr < 0 || t.ctr > 1) p.push("totals.ctr must be 0 to 1");
    if (t.position !== null && !(finite(t.position) && t.position >= 0)) p.push("totals.position missing");
  }
  p.push(...statProblems(d.queries, "queries", true), ...statProblems(d.pages, "pages", true));
  if (!Array.isArray(d.sitemaps)) p.push("sitemaps must be an array");
  else d.sitemaps.forEach((s, i) => {
    if (!isObj(s) || !str(s.path)) p.push(`sitemaps[${i}].path missing`);
    else {
      if (s.lastSubmitted !== null && !str(s.lastSubmitted)) p.push(`sitemaps[${i}].lastSubmitted must be a date text or null`);
      if (!finite(s.errors) || !finite(s.warnings)) p.push(`sitemaps[${i}].errors and warnings must be numbers`);
      if (typeof s.isPending !== "boolean") p.push(`sitemaps[${i}].isPending must be true or false`);
    }
  });
  return p;
}

// ---------- pagespeed (and the origin's CrUX numbers inside it) ----------
const fieldProblems = (f, at) => (f === null ? [] : isObj(f) ? ["lcpMs", "inpMs", "cls"].filter((k) => !numOrNull(f[k])).map((k) => `${at}.${k} must be a number or null`) : [`${at} must be null or an object`]);
export function cruxProblems(c) {
  if (!isObj(c)) return ["crux missing"];
  if (!str(c.origin)) return ["crux.origin missing"];
  if (c.none === true) return str(c.reason) ? [] : ["crux.reason missing (why there is no record)"];
  if (c.blocked !== undefined) return blockedProblems(c.blocked).map((x) => `crux.${x}`);
  const p = [];
  if (c.formFactor !== "PHONE") p.push('crux.formFactor must be "PHONE"');
  p.push(...fieldProblems({ lcpMs: c.lcpMs, inpMs: c.inpMs, cls: c.cls }, "crux"));
  if (![c.lcpMs, c.inpMs, c.cls].some(finite)) p.push("crux has no number (use none: true when CrUX has no record)");
  if (!isObj(c.collectionPeriod) || !isDay(c.collectionPeriod.first) || !isDay(c.collectionPeriod.last)) p.push("crux.collectionPeriod must be { first, last } days");
  return p;
}
export function validatePageSpeedRow(row) {
  const p = common(row, "pagespeed"); if (p.length) return p;
  const d = row.data;
  if (d.blocked !== undefined) return blockedProblems(d.blocked);
  if (d.strategy !== "mobile") p.push('strategy must be "mobile"');
  if (!Array.isArray(d.pages) || d.pages.length < 1 || d.pages.length > PAGES_CAP) p.push(`pages must hold 1 to ${PAGES_CAP} pages`);
  else d.pages.forEach((x, i) => {
    if (!isObj(x) || !isHttpUrl(x.url)) { p.push(`pages[${i}].url missing`); return; }
    if (!finite(x.performance) || x.performance < 0 || x.performance > 100) p.push(`pages[${i}].performance must be 0 to 100`);
    for (const k of ["lcpMs", "cls", "tbtMs", "fcpMs", "speedIndexMs"]) if (!numOrNull(x[k])) p.push(`pages[${i}].${k} must be a number or null`);
    p.push(...fieldProblems(x.field === undefined ? 0 : x.field, `pages[${i}].field`));
  });
  p.push(...cruxProblems(d.crux));
  if (d.failures !== undefined && !(Array.isArray(d.failures) && d.failures.every((f) => isObj(f) && isHttpUrl(f.url) && str(f.error)))) p.push("failures must be [{ url, error }]");
  return p;
}

// ---------- bing (+ the IndexNow pings of the day) ----------
export function indexNowProblems(list) {
  if (!Array.isArray(list)) return ["indexnow must be an array"];
  const p = [];
  list.forEach((x, i) => {
    if (!isObj(x)) { p.push(`indexnow[${i}] is not an object`); return; }
    if (!str(x.at) || !Number.isFinite(Date.parse(x.at))) p.push(`indexnow[${i}].at must be a timestamp`);
    if (!Array.isArray(x.urls) || !x.urls.length || !x.urls.every(isHttpUrl)) p.push(`indexnow[${i}].urls must be a non-empty list of addresses`);
    if (!Number.isInteger(x.status)) p.push(`indexnow[${i}].status must be the HTTP status`);
    if (!isHttpUrl(x.endpoint)) p.push(`indexnow[${i}].endpoint must be an address`);
  });
  return p;
}
export function validateBingRow(row) {
  const p = common(row, "bing"); if (p.length) return p;
  const d = row.data;
  if (d.blocked !== undefined) return [...blockedProblems(d.blocked), ...(d.indexnow === undefined ? [] : indexNowProblems(d.indexnow))];
  if (!str(d.site)) p.push("site missing");
  p.push(...windowProblems(d.window));
  if (!isObj(d.totals) || !finite(d.totals.clicks) || !finite(d.totals.impressions)) p.push("totals must be { clicks, impressions }");
  p.push(...statProblems(d.queries, "queries", true), ...statProblems(d.pages, "pages", true));
  const c = d.crawl;
  if (c !== null && !(isObj(c) && isDay(c.date) && ["crawledPages", "crawlErrors", "code4xx", "code5xx", "inIndex"].every((k) => numOrNull(c[k])))) p.push("crawl must be null or { date, crawledPages, crawlErrors, code4xx, code5xx, inIndex }");
  p.push(...indexNowProblems(d.indexnow));
  return p;
}

// ---------- ai-answers (platform ruling 5-P4, the skill's 5d inner row) ----------
// The same meaning as validateAiAnswerRow in the skill's measure.mjs (a test runs both over the same fixtures).
export function validateAiAnswerInner(r) {
  if (!r || typeof r !== "object") return ["the row is not an object"];
  const p = [];
  if (typeof r.promptId !== "string" || !r.promptId) p.push("promptId missing");
  if (!ENGINES.includes(r.engine)) p.push("engine missing or unknown");
  for (const k of ["named", "cited"]) if (!(k in r) || (r[k] !== null && typeof r[k] !== "boolean")) p.push(`${k} missing`);
  if (r.named == null && r.cited == null) p.push("neither named nor cited was observed");
  if (typeof r.asked_at !== "string" || !isDay(r.asked_at)) p.push("asked_at missing");
  if (!isHttpUrl(r.evidence_url) && !(typeof r.evidence_excerpt === "string" && r.evidence_excerpt.trim())) p.push("evidence (a URL or a dated excerpt) missing");
  return p;
}
export function validateAiAnswersRow(row) {
  const p = common(row, "ai-answers"); if (p.length) return p;
  const d = row.data;
  if (d.blocked !== undefined) return blockedProblems(d.blocked);
  if (!isDay(d.date)) p.push("date missing");
  if (!Array.isArray(d.rows) || !d.rows.length) p.push("rows must be a non-empty array");
  else d.rows.forEach((r, i) => p.push(...validateAiAnswerInner(r).map((x) => `rows[${i}]: ${x}`)));
  return p;
}

export const VALIDATORS = { "search-console": validateSearchConsoleRow, pagespeed: validatePageSpeedRow, bing: validateBingRow, "ai-answers": validateAiAnswersRow };
export const validateRow = (row) => (VALIDATORS[row?.source] ? VALIDATORS[row.source](row) : [`source "${row?.source}" has no validator`]);
