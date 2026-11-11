// Reviews and complaints, captured by the MAIN SESSION in the owner's browser: Google reviews, BBB (rating, accreditation, complaints), Trustpilot, Yelp, for the
// client and the top local competitors. Public pages only, no login, and NEVER a reviewer's name or a review's text. NO script fetches these pages: this reads the
// saved files and writes ONE normalized JSON of ratings and counts.
// Usage: node import-reputation.mjs <url> [--dir DIR (default <pewp>/captures/reputation)] [--max-age-days 30] [--cwd DIR]
// One file per subject and site: { "subject":"client" | "kiavi.com", "site":"google|bbb|trustpilot|yelp|facebook", "capturedAt":"ISO", "browser":"owner's Edge",
//   "url":"https://...", "listed":true, "rating":4.7, "ratingScale":5, "reviewCount":123, "newestReviewDate":"2026-10-01", "complaintCount":2, "accredited":true }
//   listed:false (the business is not on that site) needs nothing else. ratingScale defaults to 5 (BBB letter grades are written as the stars it shows, or left out
//   with rating null). complaintCount and accredited may be null when the site does not show them.
// A file with no subject or site, no listed true|false, a listed one without a rating (0 to the scale) and a review count, a bad date, or ANY field that holds
// reviewer names or review text (reviews, reviewers, reviewer, authors, reviewText) is REJECTED with the reason; nothing of it is stored.
// Output: research/reputation.json { rows:[{subject, site, listed, rating, ratingScale, reviewCount, newestReviewDate, daysSinceNewest, complaintCount, accredited, url,
//   file, capturedAt, ageDays, stale}], summary:{ subjects:[{subject, sitesChecked, sitesListed, totalReviews, weightedRating, complaints, newestReviewDate}] } }.
import { cli, nonEmpty, toNum, toDate, daysSince, round, isHttp } from "./lib-captures.mjs";

const PRIVATE = ["reviews", "reviewers", "reviewer", "reviewerNames", "authors", "author", "reviewText", "comments"];

const def = {
  module: "reputation", dir: "reputation", out: "reputation", script: "import-reputation.mjs",
  how: "the main session reads each review site in the owner's browser (no login, 45 s apart, never a reviewer's name) and saves one file per subject and site as <pewp>/captures/reputation/<subject>-<site>.json in the format at the top of scripts/import-reputation.mjs",
  check(j) {
    const e = [];
    const leaked = PRIVATE.filter((k) => k in j);
    if (leaked.length) e.push(`holds reviewer names or review text (${leaked.join(", ")}): never copied, remove the field and capture again`);
    if (!nonEmpty(j.subject)) e.push("no subject (\"client\" or the competitor's domain)");
    if (!nonEmpty(j.site)) e.push("no site (google, bbb, trustpilot, yelp, ...)");
    if (typeof j.listed !== "boolean") e.push("listed must be true or false");
    const scale = j.ratingScale == null ? 5 : toNum(j.ratingScale);
    if (scale == null || scale <= 0) e.push("ratingScale must be a number above 0");
    let rating = null, reviews = null, newest = null, complaints = null;
    if (j.listed === true) {
      rating = toNum(j.rating); reviews = toNum(j.reviewCount);
      if (rating == null && j.rating !== null) e.push("rating must be a number (or null when the site shows none)");
      if (rating != null && scale != null && (rating < 0 || rating > scale)) e.push(`rating ${rating} is outside 0 to ${scale}`);
      if (reviews == null || reviews < 0 || !Number.isInteger(reviews)) e.push("reviewCount must be a whole number (0 when none)");
      if (j.newestReviewDate != null) { newest = toDate(j.newestReviewDate); if (!newest) e.push("newestReviewDate is not a date"); }
      if (j.complaintCount != null) { complaints = toNum(j.complaintCount); if (complaints == null || complaints < 0) e.push("complaintCount must be a number or null"); }
      if (j.accredited != null && typeof j.accredited !== "boolean") e.push("accredited must be true, false or null");
    }
    if (j.url != null && !isHttp(j.url)) e.push("url is not an http(s) address");
    if (e.length) return { errors: e };
    return { errors: [], row: { subject: j.subject.trim().toLowerCase(), site: j.site.trim().toLowerCase(), listed: j.listed, rating, ratingScale: scale, reviewCount: reviews, newestReviewDate: newest, daysSinceNewest: daysSince(newest), complaintCount: complaints, accredited: j.listed ? (j.accredited ?? null) : null, url: j.url || null } };
  },
  summarize(rows) {
    const subjects = [...new Set(rows.map((r) => r.subject))].sort((a, b) => (a === "client" ? -1 : b === "client" ? 1 : a.localeCompare(b)));
    return { subjects: subjects.map((s) => {
      const mine = rows.filter((r) => r.subject === s), listed = mine.filter((r) => r.listed);
      const rated = listed.filter((r) => r.rating != null && r.reviewCount > 0);
      const w = rated.reduce((a, r) => a + r.reviewCount, 0);
      const dates = listed.map((r) => r.newestReviewDate).filter(Boolean).sort();
      return { subject: s, sitesChecked: mine.length, sitesListed: listed.length, totalReviews: listed.reduce((a, r) => a + (r.reviewCount || 0), 0),
        weightedRating: w ? round(rated.reduce((a, r) => a + (r.rating / r.ratingScale) * 5 * r.reviewCount, 0) / w) : null, complaints: listed.reduce((a, r) => a + (r.complaintCount || 0), 0), newestReviewDate: dates.at(-1) || null };
    }) };
  },
};

await cli(import.meta.url, def);
