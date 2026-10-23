// Local grid: our own rank-grid for the Google map pack (a paid grid tool is not allowed). Free, proprietary, no automation of Google.
//   plan    a grid of points around each service-area city (N x N, spacing in km, plus the city centre) and the CAPTURE REQUESTS for
//           the main session: query x point, mobile, with the coordinates to set in the browser's location override. A person or a
//           supervised session captures them at human pace (at least 45 s apart, stop at the first robot check), one result page per
//           file, in the style local-pack.mjs reads (pack[] of the map pack) plus the point.
//   import  reads those captures into a per-point map-pack position table, a "share of local voice" per query and city, the top 3
//           competitors per point, a heat map (text and HTML, no external libs) and ranking rows that pass targets-validate
//           (location = "lat,lng (city)", device mobile).
//   diff    diffGrid(prev, cur): per point, per query and city, who entered or left the 3-pack (used by measure.mjs for rule MSR-010).
// City centres are NOT looked up or guessed: they come from captures/local/grid/cities.json ([{ city, lat, lng, source, readAt }], read
// once from a public map by the owner or the main session, with the source and the date). A city without a sourced centre is BLOCKED.
// Files (all under <pewp>/captures/local/grid/): config.json, cities.json, plan.json, requests.json, requests.md, <id>.json captures.
// Output: <pewp>/local/<date>/grid.json, grid.txt, grid.html.
// Usage: node local-grid.mjs plan   <url|repo> [--n 3] [--spacing-km 3] [--query "we buy houses {city}"]... [--cities "Tracy, CA"]... [--max-captures 200] [--cwd DIR]
//        node local-grid.mjs import <url|repo> [--today YYYY-MM-DD] [--cwd DIR]
// {city} in a query template is the label from business.json ("Tracy, CA"); {cityName} is the part before the comma.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import { createHash } from "node:crypto";
import path from "node:path";
import { locate, markStage } from "./state.mjs";
import { readJson, writeJson, loadCaptures, normName, nfkc, words, ymd } from "./local-lib.mjs";
import { fact, isDay } from "./measure-sources.mjs";
import { findOurs } from "./local-pack.mjs";

const PACE_S = 45;
export const KM_PER_DEG = 111.32;
const R_EARTH = 6371.0088;
const slug = (s) => nfkc(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "x";
export const haversineKm = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180; const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
};
export const fmtLoc = (lat, lng, city) => `${lat.toFixed(5)},${lng.toFixed(5)} (${city})`;

// N x N points centred on `center`, `spacingKm` apart; rows run north to south, columns west to east. An odd N has the centre as its
// middle point; an even N has none, so the centre is added as its own point.
export function gridPoints(center, n, spacingKm) {
  const pts = []; const dLat = spacingKm / KM_PER_DEG, dLng = spacingKm / (KM_PER_DEG * Math.cos((center.lat * Math.PI) / 180));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const rowOff = (n - 1) / 2 - r, colOff = c - (n - 1) / 2; // north positive, east positive
    pts.push({ id: `r${r + 1}c${c + 1}`, row: r + 1, col: c + 1, lat: center.lat + rowOff * dLat, lng: center.lng + colOff * dLng, isCenter: rowOff === 0 && colOff === 0 });
  }
  if (!pts.some((p) => p.isCenter)) pts.push({ id: "center", row: null, col: null, lat: center.lat, lng: center.lng, isCenter: true });
  return pts;
}
const validCenter = (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;

export function cityList(business) {
  const out = []; for (const l of business?.locations || []) for (const c of l.serviceArea || []) if (c && !out.includes(c)) out.push(c);
  return out;
}

// plan: cities with sourced centres get points; the rest are BLOCKED with the step that unblocks them.
export function planGrid({ cities, centers = [], n = 3, spacingKm = 3, queryTemplates = [], language = "en", maxCaptures = 200, only = null, now = new Date() }) {
  const blocked = [], planned = [];
  if (!Number.isInteger(n) || n < 1 || n > 7) return { error: "n must be a whole number from 1 to 7", blocked, planned };
  if (!(spacingKm > 0 && spacingKm <= 25)) return { error: "spacing must be above 0 and at most 25 km", blocked, planned };
  const byCity = new Map(centers.map((c) => [nfkc(c.city), c]));
  for (const city of cities.filter((c) => !only || only.some((o) => nfkc(o) === nfkc(c)))) {
    const c = byCity.get(nfkc(city));
    if (!c) { blocked.push({ city, reason: "no centre coordinates for this city", unblock: `Add { "city": "${city}", "lat": 0, "lng": 0, "source": "<where read>", "readAt": "<date>" } to captures/local/grid/cities.json (read the centre once from a public map; it is never guessed).` }); continue; }
    if (!validCenter(c)) { blocked.push({ city, reason: "the centre coordinates are not valid numbers", unblock: "Fix lat (-90..90) and lng (-180..180) in cities.json." }); continue; }
    if (!c.source || !c.readAt) { blocked.push({ city, reason: "the centre has no source or no date", unblock: "Add source and readAt to the city's entry in cities.json: a coordinate without a source is not evidence." }); continue; }
    planned.push({ city, center: { lat: c.lat, lng: c.lng, source: c.source, readAt: c.readAt }, points: gridPoints(c, n, spacingKm) });
  }
  const requests = [];
  for (const pc of planned) for (const tpl of queryTemplates) {
    const query = tpl.replace(/\{cityName\}/g, pc.city.split(",")[0].trim()).replace(/\{city\}/g, pc.city);
    for (const p of pc.points) requests.push({ id: `${slug(pc.city)}__${slug(query)}__${p.id}`, query, queryTemplate: tpl, city: pc.city, point: { id: p.id, row: p.row, col: p.col, lat: p.lat, lng: p.lng, isCenter: p.isCenter }, device: "mobile", language, location: fmtLoc(p.lat, p.lng, pc.city) });
  }
  const over = requests.length > maxCaptures;
  return { n, spacingKm, language, queryTemplates, createdAt: now.toISOString(), planned, blocked, requests: over ? [] : requests, captureCount: requests.length, maxCaptures, over,
    estimatedMinutes: Math.ceil((requests.length * PACE_S) / 60), paceSeconds: PACE_S,
    overMessage: over ? `${requests.length} captures is over the stop of ${maxCaptures} (about ${Math.ceil((requests.length * PACE_S) / 60)} minutes of human-pace capturing). Ask the owner, then reduce --n, --cities or --query, or raise --max-captures.` : null };
}

const INSTRUCTIONS = "Set the browser's location override to the point (Chrome DevTools > More tools > Sensors > Location: custom, or the extension's equivalent), open Google on a mobile viewport, search the query exactly, check that the page footer names the place, then save the map pack. One page at a time, at least 45 seconds apart; stop at the first robot check and say so (save {\"robotCheck\": true}). Never submit anything, never sign in. Save the JSON as captures/local/grid/<id>.json.";
export const captureTemplate = (r) => ({ id: r.id, query: r.query, city: r.city, location: r.location, locationShown: "<what the page footer says>", device: "mobile", language: r.language, point: r.point, capturedAt: "<ISO time>", capturedIn: "<browser, signed in or out>", pack: [{ position: 1, name: "", rating: null, reviews: null, category: "", address: "", phone: "", website: "" }] });

// ---------- import ----------
// A capture counts for its point only when the footer names the city, a neighbouring service-area city, or says "precise location":
// a footer that shows another place (the project's 2026-10-17 Egypt footer) is kept under that place and never counted.
export function localizedGrid(shown, city, allCities = []) {
  if (!shown) return false;
  const s = nfkc(shown);
  if (/precise location/.test(s)) return true;
  return [city, ...allCities].some((c) => { const w = words(String(c).split(",")[0]); return w.length && w.every((x) => words(shown).includes(x)); });
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

export function importGrid(caps, { plan = null, name = null, domain = null, aliases = [], phone = null, cities = [], captureDir = null } = {}) {
  const points = [], rejected = [], pending = [];
  const allCities = cities.length ? cities : (plan?.planned || []).map((p) => p.city);
  for (const c of caps) {
    if (c.robotCheck) { rejected.push({ file: c._file, reason: "robot check: the capture run stopped here and must not be continued automatically" }); continue; }
    const miss = [];
    if (!c.query) miss.push("query"); if (!c.city) miss.push("city"); if (!c.device) miss.push("device"); if (!c.language) miss.push("language"); if (!c.capturedAt) miss.push("capturedAt");
    if (!c.point || !Number.isFinite(c.point.lat) || !Number.isFinite(c.point.lng) || !c.point.id) miss.push("point{id,lat,lng}");
    if (!Array.isArray(c.pack)) miss.push("pack[]");
    if (miss.length) { rejected.push({ file: c._file, query: c.query || null, reason: `missing ${miss.join(", ")}` }); continue; }
    if (c.device !== "mobile") { rejected.push({ file: c._file, query: c.query, reason: "the grid is measured on mobile only" }); continue; }
    const pack = c.pack.map((p, i) => ({ position: Number(p.position ?? i + 1), name: p.name || null, rating: p.rating ?? null, reviews: p.reviews ?? p.reviewCount ?? null, category: p.category || null, website: p.website || null, phone: p.phone || null }));
    const mine = findOurs(pack, { name, domain, aliases, phone });
    const localized = localizedGrid(c.locationShown, c.city, allCities);
    const location = fmtLoc(c.point.lat, c.point.lng, c.city);
    const src = `owner browser capture of the map pack (${c.capturedIn || "browser, details not recorded"})`;
    const top3 = pack.filter((p) => !mine || p.position !== mine.position).sort((a, b) => a.position - b.position).slice(0, 3).map((p) => ({ position: p.position, name: p.name, rating: p.rating, reviews: p.reviews }));
    points.push({ query: c.query, city: c.city, pointId: c.point.id, row: c.point.row ?? null, col: c.point.col ?? null, lat: c.point.lat, lng: c.point.lng, location, device: "mobile", language: c.language, localized, locationShown: c.locationShown || null,
      packSize: pack.length, inPack: !!mine, position: fact(mine ? mine.position : null, src, c.capturedAt, c._file, { location, device: "mobile", estimate: false }), ours: mine ? { name: mine.name, website: mine.website } : null, top3, pack, capturedAt: c.capturedAt, file: c._file });
  }
  // the newest capture of the same point + query wins
  const key = (p) => [nfkc(p.query), nfkc(p.city), p.pointId, p.device, p.language].join("|");
  const best = new Map(), superseded = [];
  for (const p of points.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)))) { if (best.has(key(p))) superseded.push(best.get(key(p)).file); best.set(key(p), p); }
  const table = [...best.values()];
  // coverage against the plan
  if (plan?.requests?.length) { const have = new Set(table.map((p) => [nfkc(p.query), nfkc(p.city), p.pointId].join("|"))); for (const r of plan.requests) if (!have.has([nfkc(r.query), nfkc(r.city), r.point.id].join("|"))) pending.push({ id: r.id, query: r.query, city: r.city, point: r.point.id }); }
  // share of local voice per query + city, from localized points only
  const groups = new Map(); for (const p of table) (groups.get(`${p.query}||${p.city}`) || groups.set(`${p.query}||${p.city}`, []).get(`${p.query}||${p.city}`)).push(p);
  const solv = [...groups.entries()].map(([k, list]) => {
    const [query, city] = k.split("||"); const ok = list.filter((p) => p.localized);
    const planned = plan?.requests ? plan.requests.filter((r) => nfkc(r.query) === nfkc(query) && nfkc(r.city) === nfkc(city)).length : null;
    const in3 = ok.filter((p) => p.inPack && p.position.value <= 3).length, inPack = ok.filter((p) => p.inPack).length;
    const dates = ok.map((p) => p.capturedAt).sort(); const last = dates.at(-1) || null;
    const src = `owner browser captures of the map pack at ${ok.length} localized grid point(s), mobile`;
    const comp = new Map();
    for (const p of ok) for (const c of p.pack.filter((x) => x.position <= 3 && !(p.inPack && p.ours && normName(x.name) === normName(p.ours.name || "")))) { const o = comp.get(normName(c.name)) || { name: c.name, points3: 0 }; o.points3++; comp.set(normName(c.name), o); }
    const positions = ok.filter((p) => p.inPack).map((p) => p.position.value);
    return { query, city, points: list.length, localizedPoints: ok.length, notLocalizedPoints: list.length - ok.length, plannedPoints: planned, coverage: planned ? fact(Math.round((ok.length / planned) * 1000) / 1000, `localized captures / planned points (${planned})`, last, captureDir) : null, partial: planned ? ok.length < planned : null,
      solv3: ok.length ? fact(Math.round((in3 / ok.length) * 1000) / 1000, `${src}: share of points where we are in the 3-pack`, last, captureDir) : fact(null, "no localized grid point captured yet", last, captureDir),
      presence: ok.length ? fact(Math.round((inPack / ok.length) * 1000) / 1000, `${src}: share of points where we are in the pack at all`, last, captureDir) : fact(null, "no localized grid point captured yet", last, captureDir),
      pointsIn3Pack: in3, pointsInPack: inPack, pointsAbsent: ok.length - inPack, medianPosition: positions.length ? median(positions) : null,
      topCompetitors: [...comp.values()].sort((a, b) => b.points3 - a.points3 || a.name.localeCompare(b.name)).slice(0, 3).map((c) => ({ ...c, share3: ok.length ? Math.round((c.points3 / ok.length) * 1000) / 1000 : null })) };
  });
  return { points: table, solv, rejected, superseded, pending, summary: { captures: caps.length, used: table.length, localized: table.filter((p) => p.localized).length, notLocalized: table.filter((p) => !p.localized).length, pending: pending.length } };
}

// Ranking rows that pass targets-validate (R-001..R-003): engine google, device mobile, location "lat,lng (city)", a whole position or null.
// A whole position needs a URL: the listing's website if the capture has it, else the business domain, said so in `urlSource`.
export function gridRankingRows(points, { domain = null } = {}) {
  return points.filter((p) => p.localized).map((p) => {
    const v = p.position.value;
    const url = v == null ? null : p.ours?.website || (domain ? `https://${domain}/` : null);
    return { query: p.query, location: p.location, device: "mobile", language: p.language, engine: "google", url, urlSource: v == null ? null : p.ours?.website ? "the listing's website in the capture" : "the business domain (the map pack lists the listing, not a page)",
      source: "local-grid", city: p.city, pointId: p.pointId, localized: true, position: p.position, packSize: p.packSize, top3: p.top3 };
  }).filter((r) => r.position.value == null || r.url);
}

// ---------- heat map ----------
const cell = (p, planned) => (!p ? (planned ? "." : " ") : !p.localized ? "?" : p.inPack ? String(Math.min(p.position.value, 9)) : "-");
export function heatText(result, plan = null) {
  const L = ["Local grid heat map (mobile). Cell = our position in the map pack at that point: 1 to 9, - = not in the pack, ? = capture not at that place (not counted), . = not captured yet.", "North is up. Each block is one query in one city.", ""];
  for (const s of result.solv) {
    L.push(`${s.query}  |  ${s.city}  |  in the 3-pack at ${s.pointsIn3Pack} of ${s.localizedPoints} points${s.solv3.value != null ? ` (share of local voice ${Math.round(s.solv3.value * 100)}%)` : ""}${s.partial ? "  [PARTIAL: not all points captured]" : ""}`);
    const pts = result.points.filter((p) => p.query === s.query && p.city === s.city); const planPts = plan?.planned?.find((x) => x.city === s.city)?.points;
    const rows = new Map(); for (const p of pts) if (p.row) (rows.get(p.row) || rows.set(p.row, new Map()).get(p.row)).set(p.col, p);
    const maxR = Math.max(0, ...(planPts || []).map((p) => p.row || 0), ...pts.map((p) => p.row || 0)), maxC = Math.max(0, ...(planPts || []).map((p) => p.col || 0), ...pts.map((p) => p.col || 0));
    for (let r = 1; r <= maxR; r++) L.push("  " + Array.from({ length: maxC }, (_, i) => cell(rows.get(r)?.get(i + 1), !!planPts)).join(" "));
    const c = pts.find((p) => p.pointId === "center"); if (c) L.push(`  centre point: ${cell(c, true)}`);
    L.push(`  top competitors at the localized points: ${s.topCompetitors.map((x) => `${x.name} (${x.points3} points)`).join("; ") || "none seen"}`, "");
  }
  return L.join("\n") + "\n";
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function heatHtml(result, plan = null, { title = "Local grid" } = {}) {
  const color = (p, planned) => (!p ? (planned ? "#e5e7eb" : "#fff") : !p.localized ? "#c7d2fe" : !p.inPack ? "#fca5a5" : p.position.value <= 3 ? "#86efac" : p.position.value <= 6 ? "#fde68a" : "#fdba74");
  const blocks = result.solv.map((s) => {
    const pts = result.points.filter((p) => p.query === s.query && p.city === s.city); const planPts = plan?.planned?.find((x) => x.city === s.city)?.points;
    const g = new Map(); for (const p of pts) if (p.row) g.set(`${p.row}.${p.col}`, p);
    const maxR = Math.max(0, ...(planPts || []).map((p) => p.row || 0), ...pts.map((p) => p.row || 0)), maxC = Math.max(0, ...(planPts || []).map((p) => p.col || 0), ...pts.map((p) => p.col || 0));
    const rows = Array.from({ length: maxR }, (_, r) => `<tr>${Array.from({ length: maxC }, (_, c) => { const p = g.get(`${r + 1}.${c + 1}`); return `<td style="background:${color(p, !!planPts)}" title="${esc(p ? `${p.location}; ${p.inPack ? "position " + p.position.value : "not in the pack"}; top: ${p.top3.map((t) => t.name).join(", ")}` : "not captured")}">${esc(p ? (p.localized ? (p.inPack ? p.position.value : "-") : "?") : "")}</td>`; }).join("")}</tr>`).join("");
    const centre = pts.find((p) => p.pointId === "center");
    return `<section><h2>${esc(s.query)} <small>${esc(s.city)}</small></h2><p>In the 3-pack at <b>${s.pointsIn3Pack}</b> of ${s.localizedPoints} points${s.solv3.value != null ? ` (share of local voice ${Math.round(s.solv3.value * 100)}%)` : ""}${s.partial ? " <b>(partial: not every point is captured)</b>" : ""}.</p><table>${rows}</table>${centre ? `<p>Centre point: ${centre.localized ? (centre.inPack ? "position " + centre.position.value : "not in the pack") : "capture not at that place"}</p>` : ""}<p>Top competitors: ${esc(s.topCompetitors.map((x) => `${x.name} (${x.points3} points)`).join("; ") || "none seen")}</p></section>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px system-ui,sans-serif;margin:16px;max-width:720px;color:#111;background:#fff}td{width:56px;height:56px;text-align:center;font-weight:600;border:1px solid #fff}table{border-collapse:collapse}small{color:#555;font-weight:400}.k span{display:inline-block;padding:2px 8px;margin:2px;border-radius:4px}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}small{color:#aaa}}</style></head><body><h1>${esc(title)}</h1><p>Mobile map pack. Each square is a point on the map (north is up); the number is our position there.</p><p class="k"><span style="background:#86efac">1 to 3</span><span style="background:#fde68a">4 to 6</span><span style="background:#fdba74">7 or lower</span><span style="background:#fca5a5">not in the pack</span><span style="background:#c7d2fe">capture at another place (not counted)</span><span style="background:#e5e7eb">not captured yet</span></p>${blocks}</body></html>\n`;
}

// ---------- diff of two grids (identical query + city + point + device + language only) ----------
export function diffGrid(prev, cur, { positionDelta = 3, packPointsDelta = 2 } = {}) {
  if (!prev) return { baseline: true, note: "First grid: nothing to compare yet." };
  const k = (p) => [nfkc(p.query), nfkc(p.city), p.pointId, p.device, p.language, p.location].join("|");
  const A = new Map(prev.points.filter((p) => p.localized).map((p) => [k(p), p]));
  const changes = [], groups = new Map(); let notComparable = 0;
  for (const p of cur.points.filter((x) => x.localized)) {
    const o = A.get(k(p)); if (!o) { notComparable++; continue; }
    const from = o.position.value, to = p.position.value; const delta = from != null && to != null ? to - from : null;
    const entered = (to != null && to <= 3) && !(from != null && from <= 3), left = (from != null && from <= 3) && !(to != null && to <= 3);
    const significant = entered || left || (delta != null && Math.abs(delta) >= positionDelta);
    changes.push({ query: p.query, city: p.city, pointId: p.pointId, location: p.location, from, to, delta, entered3: entered, left3: left, significant });
    const g = groups.get(`${p.query}||${p.city}`) || groups.set(`${p.query}||${p.city}`, { query: p.query, city: p.city, points: 0, entered3: 0, left3: 0 }).get(`${p.query}||${p.city}`);
    g.points++; if (entered) g.entered3++; if (left) g.left3++;
  }
  const solvOf = (r, s) => r.solv.find((x) => x.query === s.query && x.city === s.city);
  const perCity = [...groups.values()].map((g) => { const a = solvOf(prev, g), b = solvOf(cur, g); return { ...g, solv3From: a?.solv3.value ?? null, solv3To: b?.solv3.value ?? null, net3: g.entered3 - g.left3, significant: Math.abs(g.entered3 - g.left3) >= packPointsDelta || g.left3 >= packPointsDelta }; });
  return { baseline: false, comparablePoints: changes.length, notComparablePoints: notComparable, changes: changes.filter((c) => c.significant), perCity, lostCities: perCity.filter((c) => c.left3 >= packPointsDelta), gainedCities: perCity.filter((c) => c.entered3 >= packPointsDelta),
    note: `A point change counts when it enters or leaves the 3-pack or moves ${positionDelta} places; a query + city changes when the 3-pack points change by ${packPointsDelta} or more. Points are compared only with the same query, city, coordinates, device and language.` };
}

// ---------- run: plan / import ----------
export function gridDir(loc) { return path.join(loc.pewp, "captures", "local", "grid"); }
export function runGridPlan(target, { cwd = process.cwd(), n, spacingKm, queries = [], cities = null, maxCaptures, log = console.log, now = new Date() } = {}) {
  const loc = locate(target, { cwd }); const dir = gridDir(loc);
  const business = readJson(path.join(loc.pewp, "business.json")); const cfg = readJson(path.join(dir, "config.json"), {}) || {};
  const all = cityList(business);
  if (!all.length) return { status: "blocked", blocked: { source: "business.json", reason: "business.json has no locations[].serviceArea cities", unblock: "Add the service-area cities to business.json (intake), e.g. serviceArea: [\"Tracy, CA\", ...]." } };
  const templates = queries.length ? queries : cfg.queryTemplates || [];
  if (!templates.length) return { status: "blocked", blocked: { source: "queries", reason: "no query templates for the grid", unblock: "Pass --query \"we buy houses {city}\" (one or more), or set queryTemplates in captures/local/grid/config.json. The owner picks the 1 to 3 queries that matter most; every query multiplies the captures." } };
  const centers = readJson(path.join(dir, "cities.json"), []) || [];
  const plan = planGrid({ cities: all, centers, n: n ?? cfg.n ?? 3, spacingKm: spacingKm ?? cfg.spacingKm ?? 3, queryTemplates: templates, language: business?.market?.language || "en", maxCaptures: maxCaptures ?? cfg.maxCaptures ?? 200, only: cities, now });
  if (plan.error) return { status: "blocked", blocked: { source: "grid settings", reason: plan.error, unblock: "Fix --n / --spacing-km." } };
  if (!plan.planned.length) { log(`grid plan: no city has a sourced centre; BLOCKED cities: ${plan.blocked.map((b) => b.city).join(", ")}`); return { status: "blocked", plan, blocked: { source: "city centres", reason: "no service-area city has a sourced centre, so there is nothing to plan", unblock: plan.blocked[0]?.unblock || "Add the city centres to captures/local/grid/cities.json." } }; }
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "config.json"), { n: plan.n, spacingKm: plan.spacingKm, queryTemplates: templates, maxCaptures: plan.maxCaptures });
  writeJson(path.join(dir, "plan.json"), { ...plan, requests: plan.over ? [] : plan.requests });
  if (!plan.over) {
    writeJson(path.join(dir, "requests.json"), { createdAt: plan.createdAt, instructions: INSTRUCTIONS, paceSeconds: PACE_S, stopOnRobotCheck: true, count: plan.requests.length, estimatedMinutes: plan.estimatedMinutes, requests: plan.requests.map((r) => ({ ...r, captureFile: `${r.id}.json`, template: captureTemplate(r) })) });
    fs.writeFileSync(path.join(dir, "requests.md"), [`# Local grid capture requests (${plan.requests.length}, about ${plan.estimatedMinutes} minutes at ${PACE_S} s apart)`, "", INSTRUCTIONS, "", ...plan.requests.map((r, i) => `${i + 1}. [ ] ${r.query} | ${r.location} | mobile -> ${r.id}.json`)].join("\n") + "\n");
  }
  markStage(loc, "local-grid-plan", { "grid dir": dir }, { captures: plan.captureCount });
  log(`grid plan: ${plan.planned.length} cities, ${plan.captureCount} captures, about ${plan.estimatedMinutes} min at ${PACE_S} s apart${plan.over ? ` (OVER the stop of ${plan.maxCaptures}: nothing written to requests.json)` : ""}; BLOCKED cities: ${plan.blocked.map((b) => b.city).join(", ") || "none"}`);
  return { status: plan.over ? "blocked" : "ok", plan, dir, ...(plan.over ? { blocked: { source: "cost stop", reason: plan.overMessage, unblock: "Ask the owner; reduce --n, --cities or --query, or raise --max-captures." } } : {}) };
}
export function runGridImport(target, { cwd = process.cwd(), today = null, log = console.log } = {}) {
  const loc = locate(target, { cwd }); const dir = gridDir(loc); const now = today ? new Date(`${today}T12:00:00Z`) : new Date(); const date = ymd(now);
  const business = readJson(path.join(loc.pewp, "business.json")); const plan = readJson(path.join(dir, "plan.json"));
  const caps = loadCaptures(dir).filter((c) => c.query || c.robotCheck || c.point).filter((c) => !c.requests && !c.queryTemplates);
  if (!caps.length) return { status: "blocked", blocked: { source: "local grid captures", reason: `no grid captures in ${dir}`, unblock: "Run `local-grid.mjs plan`, then capture requests.json at human pace (45 s apart, stop at the first robot check) into that folder." } };
  const res = importGrid(caps, { plan, name: business?.name, domain: business?.domain, phone: business?.phone, cities: cityList(business), captureDir: dir });
  // Importing the same captures again must not create a second "grid" that would hide the change in the diff: when no capture is new
  // since the newest grid, that grid stands.
  const signature = createHash("sha256").update(JSON.stringify(res.points.map((p) => [p.file, p.capturedAt]).sort())).digest("hex").slice(0, 16);
  const lroot = path.join(loc.pewp, "local");
  const had = fs.existsSync(lroot) ? fs.readdirSync(lroot).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d) && fs.existsSync(path.join(lroot, d, "grid.json"))).sort() : [];
  const lastG = had.length ? readJson(path.join(lroot, had.at(-1), "grid.json")) : null;
  if (lastG?.signature === signature) { log(`grid: no new capture since ${lastG.date}; that grid stands (${path.join(lroot, had.at(-1))})`); return { dir: path.join(lroot, had.at(-1)), unchanged: true, ...lastG }; }
  const rows = gridRankingRows(res.points, { domain: business?.domain });
  const out = { status: "ok", date, signature, source: "owner-supervised browser captures of the map pack, mobile", plan: plan ? { n: plan.n, spacingKm: plan.spacingKm, captures: plan.captureCount } : null, ...res, rankings: rows };
  const od = path.join(loc.pewp, "local", date); fs.mkdirSync(od, { recursive: true });
  writeJson(path.join(od, "grid.json"), out); fs.writeFileSync(path.join(od, "grid.txt"), heatText(res, plan)); fs.writeFileSync(path.join(od, "grid.html"), heatHtml(res, plan, { title: `Local grid ${date}` }));
  markStage(loc, "local-grid", { "grid dir": od }, { date });
  log(`grid ${date}: ${res.summary.used} points (${res.summary.localized} localized, ${res.summary.notLocalized} not), ${res.summary.pending} still pending, ${res.rejected.length} rejected; ${rows.length} ranking rows; wrote ${od}`);
  return { dir: od, ...out };
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d); const all = (k) => a.flatMap((x, i) => (x === k ? [a[i + 1]] : []));
  const [cmd, target] = a;
  if (!["plan", "import"].includes(cmd) || !target) { console.error('usage: node local-grid.mjs plan|import <url|repo> [--n 3] [--spacing-km 3] [--query "we buy houses {city}"]... [--cities "Tracy, CA"]... [--max-captures 200] [--today YYYY-MM-DD] [--cwd DIR]'); process.exit(2); }
  if (opt("--today") && !isDay(opt("--today"))) { console.error(`--today must be a real day as YYYY-MM-DD (got ${opt("--today")})`); process.exit(2); }
  const cwd = opt("--cwd", process.cwd());
  const r = cmd === "plan" ? runGridPlan(target, { cwd, n: opt("--n") ? Number(opt("--n")) : undefined, spacingKm: opt("--spacing-km") ? Number(opt("--spacing-km")) : undefined, queries: all("--query"), cities: all("--cities").length ? all("--cities") : null, maxCaptures: opt("--max-captures") ? Number(opt("--max-captures")) : undefined }) : runGridImport(target, { cwd, today: opt("--today") });
  if (r.status === "blocked") console.log(`BLOCKED: ${r.blocked.reason}. To fix: ${r.blocked.unblock}`);
  for (const b of r.plan?.blocked || []) console.log(`BLOCKED city ${b.city}: ${b.reason}. To fix: ${b.unblock}`);
}
