// Shared helpers for the S1 intake and S2 research scripts (research-*.mjs, intake.mjs, research.mjs).
// Rules every step follows: a missing source throws Blocked (the CLI prints "BLOCKED: <what unblocks it>" and exits 3);
// every number leaves a step as a sourced number (cache.mjs fact()); nothing is ever invented.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locate } from "./state.mjs";
import { fact, cachedFetch } from "./cache.mjs";
import { intentDetail } from "./lib-growth.mjs";
import { RuleMissing } from "./lib-rules.mjs";
export { localeOf } from "./lib-rules.mjs";
export { fact, cachedFetch };

export const UA = `PEWP-Research/1.0 (SEO research for the site owner; contact ${process.env.PEWP_CONTACT || "see skill"})`;
export class Blocked extends Error { constructor(unblock) { super(unblock); this.unblock = unblock; } }
export class Usage extends Error {}
export const iso = () => new Date().toISOString();
export const today = () => iso().slice(0, 10);
// A file saved by Windows PowerShell 5.1 or Notepad may start with a UTF-8 BOM, which JSON.parse refuses: strip it.
export const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
export const J = (p, d = null) => { try { return JSON.parse(stripBom(fs.readFileSync(p, "utf8"))); } catch { return d; } };
// A list the caller NAMED on the command line (--seeds-file, --questions-file, ...): a missing or unreadable file is a usage error, never
// "no items" (that would silently run with nothing). Accepts a JSON array, or an object whose `key` is an array.
export function listFile(f, key) {
  let doc;
  try { doc = JSON.parse(stripBom(fs.readFileSync(f, "utf8"))); } catch (e) { throw new Usage(`${f}: ${e.code === "ENOENT" ? "file not found" : `not valid JSON (${e.message})`}`); }
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.[key]) ? doc[key] : null;
  if (!list) throw new Usage(`${f}: expected a JSON list or an object with a "${key}" list`);
  return list;
}
export const W = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === "string" ? o : JSON.stringify(o, null, 1) + "\n"); };
// A wait is never negative or NaN: setTimeout(-1) prints TimeoutNegativeWarning and waits 1 ms (G19: pace() computes "when I may go" minus "now",
// and the clock can tick between the two readings). Anything that is not a finite number of ms is no wait at all.
export const sleep = (ms) => new Promise((r) => setTimeout(r, Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0));
export const slug = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "") || "x"; // cut at 60, then never end on a hyphen (ids must match c-<slug>)
export const ageDays = (isoDate) => (Date.now() - Date.parse(isoDate)) / 86400000;

// ---- arguments: --flag value, --bool (declared), repeatable options via all() ----
export function parseArgs(argv, bool = []) {
  const B = new Set(bool), pos = [], opt = new Map();
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith("--")) {
      const k = x.slice(2);
      if (B.has(k)) opt.set(k, [...(opt.get(k) || []), true]);
      else { opt.set(k, [...(opt.get(k) || []), argv[i + 1]]); i++; }
    } else pos.push(x);
  }
  // num: a value that is not a number is a usage error (exit 2), never NaN: "--gap-ms abc" was NaN, sleep(NaN) waits ~1 ms, and
  // "--max-requests abc" made `requests >= NaN` never true (no cap). Optional { min, int } per option.
  const num = (k, d, { min = -Infinity, int = false } = {}) => {
    if (!opt.has(k)) return d;
    const raw = opt.get(k).at(-1), v = Number(raw);
    if (raw == null || String(raw).trim() === "" || !Number.isFinite(v) || v < min || (int && !Number.isInteger(v)))
      throw new Usage(`--${k} must be ${int ? "a whole number" : "a number"}${min > -Infinity ? ` of at least ${min}` : ""} (got ${raw == null ? "nothing" : JSON.stringify(String(raw))})`);
    return v;
  };
  return { _: pos, has: (k) => opt.has(k), get: (k, d = null) => (opt.has(k) ? opt.get(k).at(-1) : d), num, all: (k) => opt.get(k) || [] };
}

// ---- run a step module from the command line: `export async function run(ctx, opts)` + this ----
// Exit codes are set with process.exitCode, never process.exit(): a step that throws while a sibling fetch is still in flight would crash
// node on Windows (libuv assert, exit 3221226505) instead of exiting with the code below. Every fetch carries a timeout, so the process ends.
export async function runCli(metaUrl, usage, bool, fn) {
  if (!isMain(metaUrl)) return;
  const a = parseArgs(process.argv.slice(2), bool);
  try {
    if (!a._[0]) throw new Usage(usage);
    const r = await fn(a);
    if (r !== undefined) console.log(typeof r === "string" ? r : JSON.stringify(r, null, 1));
  } catch (e) {
    if (e instanceof Blocked) { console.log(`BLOCKED: ${e.unblock}`); process.exitCode = 3; return; }
    if (e instanceof RuleMissing) { console.log(`BLOCKED: ${e.message}`); process.exitCode = 3; return; } // a ruleset or a locale entry is missing: say what to add, do not guess
    if (e instanceof Usage) { console.error(`usage: ${e.message}`); process.exitCode = 2; return; }
    console.error(e.stack || String(e)); process.exitCode = 1;
  }
}

// ---- where a run lives, and what S1 decided ----
export function context(target, { cwd = process.cwd() } = {}) {
  const loc = locate(target, { cwd });
  const business = J(path.join(loc.pewp, "business.json"));
  return { loc, pewp: loc.pewp, rdir: path.join(loc.pewp, "research"), business, market: business?.market || null, domain: business?.domain || loc.host || null };
}
export function needBusiness(ctx) {
  if (!ctx.business) throw new Blocked(`no ${path.join(ctx.pewp, "business.json")} | unblocks: run S1 intake first (node scripts/intake.mjs <target>) and answer its questions`);
  if (!ctx.market?.country || !ctx.market?.language) throw new Blocked("business.json has no market {country, language}: every volume is per country, so intake must set it");
  return ctx.business;
}
export function writeStep(ctx, name, doc) {
  const out = { step: name, status: "ok", generatedAt: iso(), market: ctx.market, ...doc };
  W(path.join(ctx.rdir, `${name}.json`), out);
  return out;
}
export function writeBlocked(ctx, name, unblock) {
  const out = { step: name, status: "blocked", generatedAt: iso(), market: ctx.market, blocked: unblock };
  W(path.join(ctx.rdir, `${name}.json`), out);
  return out;
}
export const readStep = (ctx, name) => J(path.join(ctx.rdir, `${name}.json`));
// A fact factory bound to one response: f(value, extra) -> sourced number.
export const factor = (source, fetchedAt, cacheFile, base = {}) => (value, extra = {}) => fact(value, source, fetchedAt, cacheFile, { ...base, ...extra });
export const notMeasured = (why, extra = {}) => fact(null, `NOT MEASURED: ${why}`, iso(), null, extra);

// ---- polite pacing; the gap is shortened only for a local test server, never for a real site ----
const nextAt = new Map();
export async function pace(url, gapMs) {
  const host = new URL(url).host;
  const local = /^(127\.0\.0\.1|localhost)(:|$)/.test(host);
  // PEWP_TEST_GAP_MS shortens the gap for a local test server only; a value that is not a number of ms >= 0 is ignored (the real gap applies),
  // and a caller gap that is not a number of ms >= 0 is the polite default of 1 s, never NaN.
  const testGap = local && process.env.PEWP_TEST_GAP_MS != null && process.env.PEWP_TEST_GAP_MS !== "" ? Number(process.env.PEWP_TEST_GAP_MS) : NaN;
  const own = Number.isFinite(Number(gapMs)) && Number(gapMs) >= 0 ? Number(gapMs) : 1000;
  const gap = Number.isFinite(testGap) && testGap >= 0 ? testGap : own;
  const at = Math.max(Date.now(), nextAt.get(host) ?? 0);
  nextAt.set(host, at + gap);
  await sleep(at - Date.now());
}

// ---- words: stop words, a light stemmer, the 80% query match used by the gate (review item 11) ----
const STOP = new Set("a an the and or of in on at to for from by with near me my our your is are was be do does can how what why when which who".split(" "));
export const stem = (w) => {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && /(ing|ed)$/.test(w)) return w.replace(/(ing|ed)$/, "");
  if (w.length > 4 && /(ch|sh|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
};
export const tokens = (s) => [...new Set(String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem))];
export function queryOverlap(a, b) {
  const A = tokens(a), B = new Set(tokens(b));
  if (!A.length || !B.size) return 0;
  return A.filter((t) => B.has(t)).length / Math.max(A.length, B.size);
}
export const sameQuery = (a, b) => queryOverlap(a, b) >= 0.8;
export const normQuery = (q) => String(q || "").toLowerCase().replace(/\s+/g, " ").trim();

// ---- urls ----
export const domainOf = (u) => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return String(u || "").toLowerCase(); } };
export const normUrl = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase(); } catch { return String(u).toLowerCase(); } };
export const pathOf = (u) => { try { return new URL(u).pathname || "/"; } catch { return null; } };

// ---- places the business serves ("Tracy, CA"), and the intent of a query ----
const US_STATES = new Set(["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia"]);
// G16: a location whose name lists several places ("California, New York and Florida", "Tracy; Manteca", "A & B", "A, B, C") is a LABEL, not a place:
// it is never expanded into seeds or tracked as a city. Each serviceArea entry is its own place.
export const isPlaceLabel = (name) => / and /i.test(String(name ?? "")) || /[&;]/.test(String(name ?? "")) || (String(name ?? "").match(/,/g) || []).length >= 2;
export function knownPlaces(business) {
  const out = new Map();
  const add = (city, state) => {
    const c = String(city || "").trim(); if (!c) return;
    const m = c.match(/^(.*?),\s*([A-Za-z]{2})$/);
    const name = (m ? m[1] : c).trim();
    // a whole state ("Florida") is its own place and needs no ", FL" (the address of a Miami office must not turn it into "Florida, FL")
    const st = !m && US_STATES.has(name.toLowerCase()) ? null : (m ? m[2] : state || null);
    const key = name.toLowerCase();
    if (!out.has(key) || (!out.get(key).state && st)) out.set(key, { city: name, state: st ? st.toUpperCase() : null, label: st ? `${name}, ${st.toUpperCase()}` : name });
  };
  for (const l of business?.rankTracking?.locations || []) add(l);
  for (const loc of business?.locations || []) {
    const st = String(loc.address || "").match(/,\s*([A-Z]{2})\b\s*\d{0,5}/)?.[1] || null;
    if (!isPlaceLabel(loc.name)) add(loc.name, st);
    for (const c of loc.serviceArea || []) add(c, st);
  }
  return [...out.values()].sort((a, b) => b.city.length - a.city.length);
}
// Places known from the business, the owner's keyword map (City column), the seeds and the captures (the city each capture asked for).
export function allPlaces(ctx, read) {
  const out = new Map(), add = (city, state) => { const c = String(city || "").trim().replace(/\s+/g, " "); if (!c || c.length > 40) return; const k = c.toLowerCase(); if (!out.has(k) || (!out.get(k).state && state)) out.set(k, { city: c, state: state || null, label: state ? `${c}, ${state}` : c }); };
  for (const p of knownPlaces(ctx.business)) add(p.city, p.state);
  const st = (s) => (/^california$/i.test(s) ? "CA" : /^[A-Za-z]{2}$/.test(s || "") ? s.toUpperCase() : null);
  for (const k of read("existing")?.keywords || []) for (const part of String(k.location || "").split(/\s*[\/;]\s*|\s+and\s+/)) { const m = part.match(/^(.*?),\s*([A-Za-z]+)$/); if (m) add(m[1], st(m[2])); else if (/^[A-Z][A-Za-z .'-]+$/.test(part.trim())) add(part, null); }
  for (const s of read("seeds")?.queries || []) { const m = String(s.location || "").match(/^(.*?),\s*([A-Z]{2})$/); if (m) add(m[1], m[2]); }
  for (const c of read("serp")?.captures || []) { const m = String(c.location?.requested || "").match(/^(.*?),\s*([A-Za-z]+)$/); if (m) add(m[1], st(m[2])); }
  return [...out.values()].sort((a, b) => b.city.length - a.city.length);
}
const NOT_PLACE = new Set("offer offers fast cash now today agent agents realtor realtors house houses home homes buyer buyers sale sell value estimate cost price prices calculator loan loans listing listings".split(" "));
const CITY_PREFIX = new Set("san santa el elk la los las palo mountain walnut castro union pleasant foster half daly rancho lake fort port new north south east west mount st".split(" "));
// A city the lists above do not know, taken from the shape "... <city> ca" / "... <city> california" (only for the states the business is in).
export function inferPlace(query, places) {
  const states = [...new Set(places.map((p) => p.state).filter(Boolean))];
  const names = states.flatMap((s) => (s === "CA" ? ["ca", "california"] : [s.toLowerCase()]));
  if (!names.length) return null;
  const w = normQuery(query).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (w.length < 3 || !names.includes(w.at(-1))) return null;
  const last = w.at(-2); if (NOT_PLACE.has(last) || /^(in|near|at|for|the|a)$/.test(last)) return null;
  const two = w.length >= 4 && CITY_PREFIX.has(w.at(-3)) ? [w.at(-3), last] : [last];
  const city = two.map((x) => x[0].toUpperCase() + x.slice(1)).join(" ");
  const st = states.length === 1 ? states[0] : null;
  return { city, state: st, label: st ? `${city}, ${st}` : city, inferred: true };
}
export function placeInQuery(query, places) {
  const q = ` ${normQuery(query).replace(/[^a-z0-9\s]/g, " ")} `;
  return places.find((p) => q.includes(` ${p.city.toLowerCase().replace(/[^a-z0-9\s]/g, " ")} `)) || inferPlace(query, places);
}
// Intent by shipgate 06-growth 9.2 (ordered rules, first match wins; implementation in lib-growth.mjs intentDetail). CHANGED 2026-10-22: the old
// regex ladder (question words first, "contains the brand", a fixed word list) is gone. What this wrapper adds to the spec is only data: the
// business's own places (places[]; the gazetteer lists towns above 1,000 people, a service area may hold smaller ones) count as place names,
// brand[] are intake brands (a query EQUAL to one is navigational, 9.2 rule 4), localPackSeen is a local pack seen on the cluster's SERPs, and serp is
// the head query's capture ({ features, organic:[{url,domain,title}] }) for the SERP-based rules.
export function classifyIntent(query, { places = [], brand = [], localPackSeen = false, serp = null, locale, country, extraModifiers = null } = {}) {
  const loc = locale || "en-US";
  const q = normQuery(query);
  const feats = [...new Set([...(serp?.features || []), ...(localPackSeen ? ["local_pack"] : [])])];
  const organic = (serp?.organic || []).map((o) => ({ ...o, url: o.url || (o.domain ? `https://${o.domain}/` : "") }));
  const d = intentDetail(q, { locale: loc, country, serp: { features: feats, organic }, brands: brand, extraModifiers });
  if (d.rule > 1 && places.some((p) => ` ${q.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `.includes(` ${String(p.city).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `))) return "local";
  return d.intent;
}

// ---- number parsing used by importers ----
// A template row ("home value {city} ca") is a pattern, not a search. Expand it per service-area city, or return [] so the caller drops it and lists it.
export const hasPlaceholder = (s) => /[{}]/.test(String(s ?? ""));
export function expandTemplate(text, cities) {
  const t = String(text ?? "");
  if (!hasPlaceholder(t)) return [t];
  if (!/\{city\}/i.test(t) || !cities.length) return [];
  const out = cities.map((c) => t.replace(/\{city\}/gi, c));
  return out.some(hasPlaceholder) ? [] : out;
}
export function parseCount(s) {
  const t = String(s ?? "").trim().replace(/,/g, "").toUpperCase();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([KM]?)$/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === "K" ? 1e3 : m[2] === "M" ? 1e6 : 1));
}
// "1K – 10K" -> { lo: 1000, hi: 10000 }; "320" -> { lo: 320, hi: 320 }; anything else -> null
export function parseRange(s) {
  const parts = String(s ?? "").trim().split(/\s*[–—]\s*|\s+-\s+|\s+to\s+|(?<=[0-9KkMm])-(?=[0-9])/i).map((x) => parseCount(x));
  if (parts.length === 2 && parts.every((x) => x != null)) return { lo: Math.min(...parts), hi: Math.max(...parts) };
  const one = parseCount(s);
  return one != null ? { lo: one, hi: one } : null;
}
export const mid = (r) => Math.round((r.lo + r.hi) / 2);
