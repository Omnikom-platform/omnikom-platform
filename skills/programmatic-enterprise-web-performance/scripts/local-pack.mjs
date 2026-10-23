// Local-pack capture importer: where the business sits in Google's map pack for "<service> <city>", per city and device.
// Source: owner-supervised browser captures, one page at a time at human pace (at least 45 s apart, stop at the first robot check;
// the project's 2026-10-17 precedent). Never an automated fetch of Google. A capture is JSON:
//   { "query": "we buy houses Tracy CA", "city": "Tracy, CA", "location": "Tracy, CA", "locationShown": "Tracy, CA", "device": "mobile",
//     "language": "en", "capturedAt": "2026-10-20T18:00:00Z", "capturedIn": "owner Chrome, signed out",
//     "pack": [{ "position": 1, "name": "", "rating": 4.8, "reviews": 61, "category": "", "address": "", "phone": "", "website": "" }] }
// Rows missing city/location, device, language or capturedAt are rejected (a rank without a place is not comparable). A capture whose
// page footer (locationShown) names another place than the one requested is kept under that place and marked localized:false: Google
// ignored the location parameter in the project's own 2026-10-17 run, so it must never count as the requested city.
// Usage: node local-pack.mjs <captures dir> --name "<business name>" [--domain d] [--phone p] [--out pack.json]
import { loadCaptures, normName, normPhone, words, nfkc, writeJson, domainOf } from "./local-lib.mjs";
import { isMain } from "./lib-main.mjs";
import { fact, isOurs } from "./measure-sources.mjs";

// Which pack entry is us: the business name (normalised), the listing's website, or its phone number.
export function findOurs(pack, { name = null, domain = null, aliases = [], phone = null } = {}) {
  return pack.find((p) => (name && p.name && normName(p.name) === normName(name)) || (domain && p.website && isOurs(p.website, domain, aliases)) || (phone && p.phone && normPhone(p.phone) && normPhone(p.phone) === normPhone(phone))) || null;
}

export function importPackCaptures(dir, { name = null, domain = null, aliases = [], phone = null } = {}) {
  const caps = Array.isArray(dir) ? dir : loadCaptures(dir);
  const rows = [], rejected = [];
  for (const c of caps) {
    const miss = [];
    if (!c.query) miss.push("query"); if (!(c.location || c.city)) miss.push("location"); if (!c.device) miss.push("device"); if (!c.language) miss.push("language"); if (!c.capturedAt) miss.push("capturedAt");
    if (!Array.isArray(c.pack)) miss.push("pack[]");
    if (miss.length) { rejected.push({ file: c._file, query: c.query || null, reason: `missing ${miss.join(", ")}` }); continue; }
    const requested = c.location || c.city; let location = requested, localized = true;
    if (c.locationShown && !words(c.locationShown).some((w) => words(requested.split(",")[0]).includes(w))) { location = c.locationShown; localized = false; }
    const pack = c.pack.map((p, i) => ({ position: Number(p.position ?? i + 1), name: p.name || null, rating: p.rating ?? null, reviews: p.reviews ?? p.reviewCount ?? null, category: p.category || null, address: p.address || null, phone: p.phone || null, website: p.website || null }));
    const mine = findOurs(pack, { name, domain, aliases, phone });
    const src = `owner browser capture (${c.capturedIn || "browser, details not recorded"})`;
    rows.push({ query: c.query, city: c.city || requested, location, requestedLocation: requested, localized, device: c.device, language: c.language, packSize: pack.length, inPack: !!mine,
      position: fact(mine ? mine.position : null, src, c.capturedAt, c._file, { location, device: c.device, estimate: false }), ours: mine || null, pack, capturedAt: c.capturedAt, file: c._file });
  }
  // The same query + place + device + language captured twice: the newest one wins, the older stay in `superseded`.
  const key = (r) => [nfkc(r.query), nfkc(r.location), r.device, r.language].join("|");
  const best = new Map(), superseded = [];
  for (const r of rows.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)))) { if (best.has(key(r))) superseded.push(best.get(key(r)).file); best.set(key(r), r); }
  const out = [...best.values()];
  const summary = { captures: caps.length, used: out.length, localized: out.filter((r) => r.localized).length, notLocalized: out.filter((r) => !r.localized).length, inPack: out.filter((r) => r.localized && r.inPack).length,
    cities: [...new Set(out.filter((r) => r.localized).map((r) => r.city))], devices: [...new Set(out.map((r) => r.device))] };
  return { rows: out, rejected, superseded, summary };
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  if (!a[0] || a[0].startsWith("--")) { console.error('usage: node local-pack.mjs <captures dir> --name "<business>" [--domain d] [--phone p] [--out pack.json]'); process.exit(2); }
  const r = importPackCaptures(a[0], { name: opt("--name"), domain: opt("--domain"), phone: opt("--phone") });
  if (opt("--out")) writeJson(opt("--out"), r);
  console.log(JSON.stringify(r.summary, null, 1)); for (const x of r.rejected) console.log(`REJECTED ${x.file}: ${x.reason}`);
}
