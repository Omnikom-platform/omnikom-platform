// Review gap vs competitors, per city and device, from captures. For each LOCALIZED local-pack capture (the page footer confirmed the
// place; see local-pack.mjs) it compares our Business Profile review count and rating with the businesses in the pack:
//   - the "review bar": the review count of the pack's 3rd place (what it takes to enter the 3-pack on this measure alone),
//   - the median of the pack,
//   - the gap in reviews and in rating.
// Reviews are one factor among distance and relevance: the output says so. Captures that were not localized are counted and left out
// (project rule 2026-10-18: not-localized rows must not be used to order cities or set per-city targets).
// Needs: profile.json from local-profile.mjs (our count and rating) and pack.json rows from local-pack.mjs. Missing => BLOCKED.
// Usage: node local-reviews.mjs --profile profile.json --pack pack.json [--out reviews.json]
import { readJson, writeJson, blocked } from "./local-lib.mjs";
import { isMain } from "./lib-main.mjs";
import { fact } from "./measure-sources.mjs";

const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

export function reviewGap(profile, packRows) {
  if (!profile?.reviews || profile.reviews.count == null) return { status: "blocked", blocked: { source: "business-profile", reason: "no review count for our own profile", unblock: "Import the Business Profile export or a dated manual capture (local-profile.mjs)." } };
  if (!packRows?.length) return { status: "blocked", blocked: { source: "local-pack captures", reason: "no local-pack captures to compare against", unblock: "Capture the map pack for each service + city on mobile (owner, human pace) into captures/local/pack/." } };
  const rows = [], excluded = [];
  for (const r of packRows) {
    if (!r.localized) { excluded.push({ query: r.query, shown: r.location, requested: r.requestedLocation, reason: "page footer showed another place: not usable for this city" }); continue; }
    const others = r.pack.filter((p) => !r.ours || p.position !== r.ours.position);
    const counts = r.pack.map((p) => p.reviews).filter((x) => x != null);
    const third = r.pack.find((p) => p.position === 3);
    const src = (v, extra = {}) => fact(v, `owner browser capture of the local pack + ${profile.source} (${profile.capturedAt})`, r.capturedAt, r.file, { location: r.location, device: r.device, ...extra });
    rows.push({ query: r.query, city: r.city, device: r.device, language: r.language, ourPosition: r.inPack ? r.position.value : null, inPack: r.inPack,
      ourReviews: src(profile.reviews.count), ourRating: src(profile.reviews.rating), packThirdPlaceReviews: src(third?.reviews ?? null), packMedianReviews: src(median(counts)),
      reviewGapToThird: third?.reviews != null ? src(Math.max(0, third.reviews - profile.reviews.count)) : src(null, { note: "no 3rd place in the pack or no review count shown" }),
      ratingGapToBest: (() => { const best = Math.max(...others.map((p) => p.rating ?? 0)); return best && profile.reviews.rating != null ? src(Math.round((best - profile.reviews.rating) * 10) / 10) : src(null); })(),
      competitors: others.map((p) => ({ name: p.name, rating: p.rating, reviews: p.reviews })),
      note: "Reviews are one factor; distance to the searcher and category relevance also decide the pack." });
  }
  return { status: rows.length ? "ok" : "blocked", ...(rows.length ? {} : { blocked: { source: "local-pack captures", reason: "every capture was not localized (the page showed another place)", unblock: "Recapture with a place confirmed in the page footer, or from a device physically in the city." } }), rows, excluded };
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  if (!opt("--profile") || !opt("--pack")) { console.error("usage: node local-reviews.mjs --profile profile.json --pack pack.json [--out reviews.json]"); process.exit(2); }
  const pj = readJson(opt("--profile")); const r = reviewGap(pj?.profile || pj, readJson(opt("--pack"))?.rows);
  if (opt("--out")) writeJson(opt("--out"), r);
  console.log(r.status === "blocked" ? `BLOCKED: ${r.blocked.reason}. To fix: ${r.blocked.unblock}` : JSON.stringify(r.rows.map((x) => ({ city: x.city, device: x.device, ours: x.ourReviews.value, third: x.packThirdPlaceReviews.value, gap: x.reviewGapToThird.value })), null, 1));
}
