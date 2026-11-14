// Public social profiles, captured by the MAIN SESSION in the owner's browser: YouTube, TikTok, Instagram, LinkedIn (company and people), Facebook, X: the counts,
// the newest post and where the profile's link goes. Public pages only, nothing clicked beyond reading; a login wall means BLOCKED. NO script fetches these pages:
// this reads the saved files and writes ONE normalized JSON of numbers.
// Usage: node import-social.mjs <url> [--dir DIR (default <pewp>/captures/social)] [--max-age-days 30] [--cwd DIR]
// One file per profile: { "platform":"youtube|tiktok|instagram|linkedin|facebook|x", "kind":"company|person|channel", "handle":"@name", "profileUrl":"https://...",
//   "capturedAt":"ISO", "browser":"owner's Edge", "followers":1234, "posts":58, "postsIncludeShorts":true, "views":98000, "newestPostDate":"2026-10-20",
//   "linkTarget":"https://example.com/", "linkStatus":200, "linkNote":"opened in the browser: the page loads" }
//   followers, posts and views are numbers as shown ("1.2K" is read as 1200); posts, views, newestPostDate and linkTarget may be null when the profile shows none.
//   linkStatus is the HTTP status the visitor saw when the profile's link was opened (200, 301 then 200 is 200, 404 ...) or null when there is no link.
//   A profile that could not be read is { "platform":..., "profileUrl":..., "blocked":"login wall", "capturedAt":..., "browser":... } and becomes a blocked row, never a zero.
// A file with an unknown platform, no profile address, no followers number (and not blocked), a bad newestPostDate or a non-number linkStatus is REJECTED with the reason.
// Output: research/social.json { rows:[{platform, kind, handle, profileUrl, status:"ok"|"blocked", followers, posts, views, newestPostDate, daysSinceNewest, active, judged,
//   linkTarget, linkStatus, linkWorks, file, capturedAt, ageDays, stale}], summary:{ profilesRead, blocked, totalFollowers, platformsActive:[...], platformsNotActive:[...], platformsNotJudged:[...], linksBroken:[profileUrl] } }.
//   active = a post within the last 90 days. judged = the newest post date was read, or the profile shows 0 posts. A profile with posts (or a post count
//   not shown) and no newest post date is NOT JUDGED, never "not active". Per platform (several profiles count together): active when any profile is
//   active; else not judged when any is not judged; else not active. Each platform is in exactly one of platformsActive, platformsNotActive, platformsNotJudged.
import { cli, nonEmpty, toNum, toDate, daysSince, isHttp } from "./lib-captures.mjs";

const PLATFORMS = ["youtube", "tiktok", "instagram", "linkedin", "facebook", "x"];

const def = {
  module: "social", dir: "social", out: "social", script: "import-social.mjs",
  how: "the main session reads each public profile in the owner's browser (no login, 45 s apart per site; a login wall is recorded as blocked) and saves one file per profile as <pewp>/captures/social/<platform>-<handle>.json in the format at the top of scripts/import-social.mjs",
  check(j) {
    const e = [];
    const platform = String(j.platform || "").toLowerCase();
    if (!PLATFORMS.includes(platform)) e.push(`platform is not ${PLATFORMS.join("|")}`);
    if (!isHttp(j.profileUrl)) e.push("no profileUrl (the address that was read)");
    if (e.length) return { errors: e };
    if (nonEmpty(j.blocked)) return { errors: [], row: { platform, kind: j.kind || null, handle: j.handle || null, profileUrl: j.profileUrl, status: "blocked", blocked: j.blocked.trim() } };
    const followers = toNum(j.followers), posts = j.posts == null ? null : toNum(j.posts), views = j.views == null ? null : toNum(j.views);
    if (followers == null || followers < 0) e.push("followers must be a number (or write \"blocked\": \"login wall\")");
    if (j.posts != null && (posts == null || posts < 0)) e.push("posts must be a number or null");
    if (j.views != null && (views == null || views < 0)) e.push("views must be a number or null");
    const newest = j.newestPostDate == null ? null : toDate(j.newestPostDate);
    if (j.newestPostDate != null && !newest) e.push("newestPostDate is not a date");
    if (j.linkStatus != null && !(Number.isInteger(j.linkStatus) && j.linkStatus >= 100 && j.linkStatus <= 599)) e.push("linkStatus must be an HTTP status number (200, 404, ...) or null");
    if (j.linkTarget != null && !isHttp(j.linkTarget)) e.push("linkTarget is not an http(s) address");
    if (e.length) return { errors: e };
    const d = daysSince(newest);
    return { errors: [], row: { platform, kind: j.kind || null, handle: j.handle || null, profileUrl: j.profileUrl, status: "ok", followers, posts, postsIncludeShorts: j.postsIncludeShorts ?? null, views, newestPostDate: newest, daysSinceNewest: d, active: d != null && d <= 90, judged: d != null || posts === 0, linkTarget: j.linkTarget || null, linkStatus: j.linkStatus ?? null, linkWorks: j.linkStatus == null ? null : j.linkStatus >= 200 && j.linkStatus < 300 } };
  },
  summarize(rows) {
    const ok = rows.filter((r) => r.status === "ok");
    const act = new Set(ok.filter((r) => r.active).map((r) => r.platform)), nj = new Set(ok.filter((r) => !r.judged && !act.has(r.platform)).map((r) => r.platform));
    const na = new Set(ok.filter((r) => !act.has(r.platform) && !nj.has(r.platform)).map((r) => r.platform));
    return { profilesRead: ok.length, blocked: rows.filter((r) => r.status === "blocked").length, totalFollowers: ok.reduce((a, r) => a + r.followers, 0), platformsActive: [...act].sort(), platformsNotActive: [...na].sort(), platformsNotJudged: [...nj].sort(), linksBroken: ok.filter((r) => r.linkWorks === false).map((r) => r.profileUrl) };
  },
};

await cli(import.meta.url, def);
