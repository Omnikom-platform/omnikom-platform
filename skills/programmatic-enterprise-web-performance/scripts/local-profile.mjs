// Business Profile importer + audit. Two free inputs, no scraping of Google:
//   1. the owner's Business Profile API export (JSON; OAuth + Google's API approval are the owner's): { location, reviews, media, localPosts }
//      in the shapes of Business Information API v1 (title, categories, storefrontAddress, phoneNumbers, websiteUri, regularHours,
//      serviceArea, serviceItems, profile.description), Reviews (reviews[].starRating/createTime/reviewReply, averageRating,
//      totalReviewCount), Media (totalMediaItemCount) and localPosts (localPosts[].createTime). Unknown fields are ignored, absent ones
//      are reported as missing. UNVERIFIED against a live export until the owner supplies one.
//   2. a DATED MANUAL CAPTURE (JSON written by a person reading the public Maps listing once, with the date): see MANUAL_EXAMPLE.
// Usage: node local-profile.mjs <file.json> [--competitors <dir>] [--out profile.json] [--now YYYY-MM-DD]
// Library: importProfile(json) -> profile | { blocked }, auditProfile(profile, competitors, { now }) -> findings[]
import { readJson, writeJson, blocked, ymd, loadCaptures, normAddress, normPhone } from "./local-lib.mjs";
import { isMain } from "./lib-main.mjs";
import { fact } from "./measure-sources.mjs";

export const MANUAL_EXAMPLE = { kind: "manual-capture", capturedAt: "2026-10-20", capturedBy: "owner, Chrome, public Maps listing", name: "", primaryCategory: "Real estate agent", secondaryCategories: [], services: [], address: "", phone: "", website: "", hours: "present|missing", description: "", photosCount: 0, postsLast90d: 0, reviews: { count: 0, rating: 0, lastReviewDate: "2026-10-01", ownerReplyRate: 0.0 } };
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export function importProfile(j, { file = null } = {}) {
  if (!j || typeof j !== "object") return blocked("business-profile", "no profile file or it is not JSON", "Give the owner's Business Profile API export, or a dated manual capture (see MANUAL_EXAMPLE in local-profile.mjs).");
  if (j.kind === "manual-capture" || (!j.location && j.name)) {
    if (!j.capturedAt) return blocked("business-profile", "the manual capture has no capturedAt date", "Add the date the listing was read: a capture without a date is not evidence.");
    const r = j.reviews || {};
    return { ok: true, source: "manual capture", capturedAt: j.capturedAt, capturedBy: j.capturedBy || null, file, name: j.name || null, primaryCategory: j.primaryCategory || null, secondaryCategories: j.secondaryCategories || [], services: j.services || [], address: j.address || null, phone: j.phone || null, website: j.website || null,
      hours: j.hours === "missing" ? false : j.hours ? true : null, serviceAreas: j.serviceAreas || [], description: j.description || null, photosCount: j.photosCount ?? null, postsLast90d: j.postsLast90d ?? null,
      reviews: { count: r.count ?? null, rating: r.rating ?? null, lastReviewDate: r.lastReviewDate || null, ownerReplyRate: r.ownerReplyRate ?? null, last90d: r.last90d ?? null } };
  }
  const L = j.location || {}; const cats = L.categories || {};
  const revs = j.reviews?.reviews || [];
  const when = j.exportedAt || j.capturedAt;
  if (!when) return blocked("business-profile", "the API export has no exportedAt date", "Add exportedAt (ISO date) to the file when it is exported: without it the numbers have no date.");
  const dates = revs.map((r) => r.createTime).filter(Boolean).sort();
  const replied = revs.filter((r) => r.reviewReply?.comment).length;
  const cutoff = Date.parse(when) - 90 * 86400000;
  const addr = L.storefrontAddress ? [(L.storefrontAddress.addressLines || []).join(" "), L.storefrontAddress.locality, L.storefrontAddress.administrativeArea, L.storefrontAddress.postalCode].filter(Boolean).join(", ") : null;
  return { ok: true, source: "Business Profile API export (owner)", capturedAt: String(when).slice(0, 10), file, name: L.title || null, primaryCategory: cats.primaryCategory?.displayName || null,
    secondaryCategories: (cats.additionalCategories || []).map((c) => c.displayName).filter(Boolean), services: (L.serviceItems || []).map((s) => s.structuredServiceItem?.description || s.freeFormServiceItem?.label?.displayName).filter(Boolean),
    address: addr, phone: L.phoneNumbers?.primaryPhone || null, website: L.websiteUri || null, hours: L.regularHours?.periods ? L.regularHours.periods.length > 0 : null,
    serviceAreas: (L.serviceArea?.places?.placeInfos || []).map((p) => p.placeName).filter(Boolean), description: L.profile?.description || null,
    photosCount: j.media?.totalMediaItemCount ?? (j.media?.mediaItems ? j.media.mediaItems.length : null),
    postsLast90d: j.localPosts?.localPosts ? j.localPosts.localPosts.filter((p) => Date.parse(p.createTime) >= cutoff).length : null,
    reviews: { count: j.reviews?.totalReviewCount ?? (revs.length || null), rating: j.reviews?.averageRating ?? (revs.length ? revs.reduce((n, r) => n + (STARS[r.starRating] || 0), 0) / revs.length : null), lastReviewDate: dates.length ? dates.at(-1).slice(0, 10) : null,
      ownerReplyRate: revs.length ? replied / revs.length : null, last90d: revs.length ? revs.filter((r) => Date.parse(r.createTime) >= cutoff).length : null } };
}

const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
export function loadCompetitors(dir) { return loadCaptures(dir).filter((c) => c.name).map((c) => ({ name: c.name, city: c.city || null, primaryCategory: c.primaryCategory || null, secondaryCategories: c.secondaryCategories || [], rating: c.rating ?? null, reviewCount: c.reviewCount ?? c.reviews ?? null, lastReviewDate: c.lastReviewDate || null, photosCount: c.photosCount ?? null, capturedAt: c.capturedAt || null, capturedIn: c.capturedIn || null, file: c._file })); }

// Findings. Absolute checks need only the profile; comparative ones need competitor captures and are reported BLOCKED without them.
export function auditProfile(p, competitors = [], { now = new Date() } = {}) {
  const f = [], blockedChecks = [];
  const add = (id, title, detail, evidence, fix) => f.push({ id, severity: "W", title, detail, evidence, fix });
  const src = (v, extra = {}) => fact(v, `${p.source}, ${p.capturedAt}`, p.capturedAt, p.file, extra);
  if (!p.primaryCategory) add("LOC-P01", "No primary category", "The Business Profile has no primary category, the strongest single signal for which searches it appears in.", { primaryCategory: src(null) }, "Pick the category that matches what customers search (check which one the top local-pack competitors use).");
  if (!p.secondaryCategories?.length) add("LOC-P02", "No secondary categories", "Only one category is set; secondary categories widen the searches the listing can appear in.", { secondaryCategories: src(0) }, "Add the secondary categories competitors in the pack use.");
  if (!p.services?.length) add("LOC-P03", "No services listed", "The profile lists no services.", { services: src(0) }, "List each service with a short description.");
  if (!p.description) add("LOC-P04", "No business description", "The profile has no description.", { description: src(null) }, "Write a 750-character description with the service area and what is offered.");
  if (p.hours === false) add("LOC-P05", "No opening hours", "No hours are set.", { hours: src(false) }, "Set hours (or appointment-only) so the listing is not shown as unverified.");
  if (!p.website) add("LOC-P06", "No website link", "The profile has no website.", { website: src(null) }, "Link the profile to the location landing page, not only the homepage.");
  if (p.postsLast90d === 0) add("LOC-P07", "No post in the last 90 days", "No Business Profile post was made in 90 days.", { posts: src(0, { windowDays: 90 }) }, "Post an update or offer at least monthly.");
  if (p.reviews.ownerReplyRate != null && p.reviews.ownerReplyRate < 0.8) add("LOC-P08", "Reviews left unanswered", `Only ${Math.round(p.reviews.ownerReplyRate * 100)}% of reviews have an owner reply.`, { ownerReplyRate: src(p.reviews.ownerReplyRate) }, "Reply to every review, good and bad.");
  if (p.reviews.lastReviewDate && (now - Date.parse(p.reviews.lastReviewDate)) / 86400000 > 90) add("LOC-P09", "No new review in 90 days", `The last review is from ${p.reviews.lastReviewDate}.`, { lastReviewDate: src(p.reviews.lastReviewDate) }, "Ask recent customers for a review (a link, not an incentive).");
  if (!competitors.length) blockedChecks.push({ id: "LOC-P10..P13", source: "competitor captures", reason: "no competitor profile captures: category, photo, review count/rating/recency comparisons need them", unblock: "Read the top 3 local-pack businesses' public listings once by hand (owner, human pace) and save them as JSON in captures/local/competitors/ with name, primaryCategory, secondaryCategories, rating, reviewCount, lastReviewDate, photosCount, capturedAt." });
  else {
    const cs = (v, extra = {}) => fact(v, `owner browser captures of ${competitors.length} competitor listing(s)`, competitors.map((c) => c.capturedAt).filter(Boolean).sort().at(-1) || null, competitors.map((c) => c.file).join("; "), extra);
    const used = new Set(competitors.flatMap((c) => [c.primaryCategory, ...c.secondaryCategories]).filter(Boolean));
    const mine = new Set([p.primaryCategory, ...p.secondaryCategories].filter(Boolean).map((x) => x.toLowerCase()));
    const missingCats = [...used].filter((c) => !mine.has(c.toLowerCase()));
    if (missingCats.length) add("LOC-P10", "Categories competitors use that we do not", `Competitors use: ${missingCats.join(", ")}.`, { missing: missingCats, competitorsChecked: cs(competitors.length) }, "Add the ones that truly describe the business.");
    const mp = median(competitors.map((c) => c.photosCount)); if (mp != null && p.photosCount != null && p.photosCount < mp) add("LOC-P11", "Fewer photos than competitors", `${p.photosCount} photos against a competitor median of ${mp}.`, { ours: src(p.photosCount), competitorMedian: cs(mp) }, "Add real photos: storefront, team, work, interior.");
    const mr = median(competitors.map((c) => c.reviewCount)); if (mr != null && p.reviews.count != null && p.reviews.count < mr) add("LOC-P12", "Fewer reviews than competitors", `${p.reviews.count} reviews against a competitor median of ${mr}.`, { ours: src(p.reviews.count), competitorMedian: cs(mr) }, "A steady review request routine closes this over months.");
    const mt = median(competitors.map((c) => c.rating)); if (mt != null && p.reviews.rating != null && p.reviews.rating < mt - 0.2) add("LOC-P13", "Lower rating than competitors", `${p.reviews.rating.toFixed(1)} against a competitor median of ${mt.toFixed(1)}.`, { ours: src(p.reviews.rating), competitorMedian: cs(mt) }, "Look at the low-rated reviews for a pattern; reply and fix the cause.");
  }
  return { findings: f, blocked: blockedChecks };
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  if (!a[0] || a[0].startsWith("--")) { console.error("usage: node local-profile.mjs <profile export or manual capture .json> [--competitors <dir>] [--out profile.json] [--now YYYY-MM-DD]"); process.exit(2); }
  const p = importProfile(readJson(a[0]), { file: a[0] });
  if (!p.ok) { console.log(`BLOCKED: ${p.blocked.reason}. To fix: ${p.blocked.unblock}`); process.exit(0); }
  const au = auditProfile(p, opt("--competitors") ? loadCompetitors(opt("--competitors")) : [], { now: opt("--now") ? new Date(opt("--now")) : new Date() });
  const out = { profile: p, ...au }; if (opt("--out")) writeJson(opt("--out"), out); console.log(JSON.stringify({ findings: au.findings.map((x) => x.id + " " + x.title), blocked: au.blocked.map((b) => b.id) }, null, 1));
}
