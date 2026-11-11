// City centres for the local grid: the latitude and longitude of each service-area city, read from the COORDINATES of the city's Wikipedia page (the Wikimedia
// Action API, prop=coordinates, one polite request per city), written as captures/local/grid/cities.json, the file local-grid.mjs plan reads
// ([{ city, lat, lng, source, readAt }]: a coordinate without a source and a date is not evidence). Nothing is guessed: a city whose page has no coordinates, or
// that has no page, is BLOCKED by name and left out.
// Usage: node local-centres.mjs <url> [--cities "Sacramento, CA"]... [--refresh] [--today YYYY-MM-DD] [--cwd DIR]
//   cities     default: every locations[].serviceArea city of the approved business definition (<pewp>/approved/business.json, else business.json)
//   --refresh  read every city again, also the ones already in cities.json (an entry that is already there, typed by hand or read before, is otherwise kept as it is)
// Page titles are NOT guessed from the city alone: "Sacramento, CA" is asked as the titles "Sacramento, California|Sacramento" in ONE request (a two letter US state is
// spelled out; "Calgary, Alberta" is asked as it is). The "City, State" page is preferred, the plain title is used only when that page has no coordinates but the plain
// page has: its title is kept in the entry (title) so a wrong page can be seen.
// Each entry: { city, lat, lng, source: "https://en.wikipedia.org/wiki/Sacramento,_California", readAt: "YYYY-MM-DD", title, by: "wikipedia" }.
// Test hook: WIKI_ACTION_API_BASE (default https://en.wikipedia.org/w/api.php). Wikimedia asks for a descriptive User-Agent: sent. A 429 is BLOCKED (exit 3).
// cities.json is written on every run that has at least one city with a centre (also when nothing needed reading), so the step's evidence is a file written by this run.
// Exit: 0 written (cities without a centre are listed as "BLOCKED city X: ..." lines), 2 usage, 3 BLOCKED and the LAST line is "BLOCKED: <what> | unblocks: <what would>"
// (no service-area cities; no city has a centre; Wikimedia answered 429), 1 any other failure.
import fs from "node:fs";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { Blocked, UA, Usage, J, W, context, runCli, cachedFetch, pace, today as todayStr } from "./research-lib.mjs";
import { cityList } from "./local-grid.mjs";

const BASE = () => process.env.WIKI_ACTION_API_BASE || "https://en.wikipedia.org/w/api.php";
const USAGE = "node local-centres.mjs <url> [--cities \"Sacramento, CA\"]... [--refresh] [--today YYYY-MM-DD] [--cwd DIR]";
const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia" };
const nfkc = (s) => String(s || "").normalize("NFKC").trim().toLowerCase();

// "Sacramento, CA" -> ["Sacramento, California", "Sacramento"]; "Calgary, Alberta" -> ["Calgary, Alberta", "Calgary"]; "Chicago" -> ["Chicago"]
export function titlesFor(city) {
  const raw = String(city).trim(), i = raw.indexOf(",");
  if (i < 0) return [raw];
  const name = raw.slice(0, i).trim(), st = raw.slice(i + 1).trim();
  return [...new Set([`${name}, ${STATES[st.toUpperCase()] || st}`, name])];
}
const wikiUrl = (title) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%2C/g, ",").replace(/%3A/g, ":")}`;
const valid = (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180 && (!c.globe || c.globe === "earth");

// the answer of one request -> { title, lat, lng } of the first candidate whose page has primary coordinates, or { why }
export function pickCentre(answer, candidates) {
  const q = answer?.query || {};
  const follow = (t) => { let x = t; for (const list of [q.normalized, q.redirects]) { const m = (list || []).find((e) => e.from === x); if (m) x = m.to; } return x; };
  const pages = new Map((q.pages || []).map((p) => [p.title, p]));
  let sawBad = false, sawPage = false;
  for (const c of candidates) {
    const p = pages.get(follow(c));
    if (!p || p.missing) continue;
    sawPage = true;
    const co = (p.coordinates || []).find((x) => x.primary) || (p.coordinates || [])[0];
    if (!co) continue;
    if (!valid(co)) { sawBad = true; continue; }
    return { title: p.title, lat: co.lat, lng: co.lon };
  }
  return { why: sawBad ? "the page's coordinates are not valid numbers" : sawPage ? `the page has no coordinates (${candidates.join(" / ")})` : `no Wikipedia page titled ${candidates.map((c) => `"${c}"`).join(" or ")}` };
}

export async function run(ctx, { cities = null, refresh = false, today = todayStr() } = {}) {
  const approved = J(path.join(ctx.pewp, "approved", "business.json"));
  const list = (cities && cities.length ? cities : cityList(approved || ctx.business)).map((c) => String(c).trim()).filter(Boolean);
  if (!list.length) throw new Blocked("business.json has no locations[].serviceArea cities | unblocks: add the service-area cities to the business definition (intake), e.g. serviceArea: [\"Sacramento, CA\"], or pass --cities \"Sacramento, CA\"");
  const file = path.join(ctx.pewp, "captures", "local", "grid", "cities.json");
  const have = J(file, []) || [];
  const keep = new Map(have.map((e) => [nfkc(e.city), e]));
  const out = new Map(keep), lines = [], blocked = [];
  for (const city of list) {
    if (!refresh && keep.has(nfkc(city)) && Number.isFinite(keep.get(nfkc(city)).lat)) { lines.push(`centre ${city}: already in cities.json (${keep.get(nfkc(city)).source || "no source"}), kept`); continue; }
    const candidates = titlesFor(city);
    const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "coordinates", coprimary: "primary", redirects: "1", titles: candidates.join("|") });
    const url = `${BASE()}?${q}`;
    await pace(url, 250); // Wikimedia allows far more; we stay polite
    const r = await cachedFetch(ctx.pewp, "wikipedia-coordinates", url, { maxAgeDays: refresh ? 0 : 30, init: { headers: { "user-agent": UA, accept: "application/json" } } });
    if (r.status === 429) throw new Blocked("Wikimedia rate limit (HTTP 429): re-run later; the answered cities are cached | unblocks: wait, then run again");
    if (r.status !== 200) throw new Error(`Wikipedia coordinates HTTP ${r.status} for ${city}`);
    let body = null; try { body = r.json(); } catch {}
    const pick = pickCentre(body, candidates);
    if (pick.why) { blocked.push(city); lines.push(`BLOCKED city ${city}: ${pick.why}. To fix: add { "city": "${city}", "lat": 0, "lng": 0, "source": "<where read>", "readAt": "<date>" } to captures/local/grid/cities.json by hand, from a public map; it is never guessed.`); continue; }
    out.set(nfkc(city), { city, lat: pick.lat, lng: pick.lng, source: wikiUrl(pick.title), readAt: today, title: pick.title, by: "wikipedia" });
    lines.push(`centre ${city}: ${pick.lat}, ${pick.lng} (Wikipedia "${pick.title}")`);
  }
  const wanted = list.filter((c) => out.has(nfkc(c)));
  if (!wanted.length) throw Object.assign(new Blocked(`no service-area city has a centre (${blocked.join(", ")}) | unblocks: add the centres to captures/local/grid/cities.json by hand from a public map, with the source and the date`), { lines });
  W(file, [...out.values()]);
  return { file, lines, blocked, found: wanted.length, total: list.length };
}

if (isMain(import.meta.url)) {
  await runCli(import.meta.url, USAGE, ["refresh"], async (a) => {
    const t = a.get("today", todayStr());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Usage(`--today must be YYYY-MM-DD (got "${t}")`);
    const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
    let r;
    try { r = await run(ctx, { cities: a.all("cities"), refresh: a.has("refresh"), today: t }); }
    catch (e) { if (e.lines) console.log(e.lines.join("\n")); throw e; }
    return `${r.lines.join("\n")}\nOK centres: ${r.found} of ${r.total} cities with a centre${r.blocked.length ? ` (${r.blocked.length} BLOCKED city line(s) above)` : ""} -> ${r.file}`;
  });
}
