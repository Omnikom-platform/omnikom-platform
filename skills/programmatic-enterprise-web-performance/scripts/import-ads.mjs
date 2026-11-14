// Ads the client and its top competitors run, captured by the MAIN SESSION in the owner's browser from the Google Ads Transparency Center and the Meta Ad Library
// (US, read only). NO script fetches these pages: this reads the saved files and writes ONE normalized JSON.
// Usage: node import-ads.mjs <url> [--dir DIR (default <pewp>/captures/ads)] [--max-age-days 30] [--cwd DIR]
// One file per advertiser and library: { "advertiser":"client" | "kiavi.com", "library":"google-transparency|meta-ad-library", "region":"US", "capturedAt":"ISO",
//   "browser":"owner's Edge", "url":"https://adstransparency.google.com/...", "running":true, "adCount":12, "since":"2026-08-01", "formats":["text","image","video"] }
//   running:false (no ads shown in the library) needs nothing else; a running advertiser needs adCount (1 or more); since (the oldest start date shown) and formats may be null / left out.
//   "blocked":"page not tied to the business" (a Page with the business's name that could not be tied to it: same name, no link to the site, no address; or any other reason the state is not known) stands in place of running; it becomes a row with status "blocked", never a count, never "no ads". With blocked, running must be left out.
// A file with no advertiser, an unknown library, no running true|false, a running one without an adCount, a bad since date or formats that are not a list is REJECTED with the reason.
// Output: research/ads.json { rows:[{advertiser, library, region, status (only on a blocked row), blocked (only on a blocked row), running, adCount, since, runningDays, formats, url, file, capturedAt, ageDays, stale}],
//   summary:{ advertisers:[{advertiser, librariesChecked, librariesNotKnown, librariesRead, librariesNotRead, running, adCount}], advertisersChecked, advertisersNotKnown, advertisersRunning, clientRunning, competitorsRunning } }.
//   running and adCount of an advertiser may be null: a library of it was blocked (not known) or has NO accepted capture (librariesNotRead) and none read shows ads.
//   running is true when any library read shows ads; false ONLY when every library (google-transparency AND meta-ad-library) was read and none shows ads.
import { cli, nonEmpty, toNum, toDate, daysSince, isHttp } from "./lib-captures.mjs";

const LIBRARIES = ["google-transparency", "meta-ad-library"];

const def = {
  module: "ads", dir: "ads", out: "ads", script: "import-ads.mjs",
  how: "the main session reads the Google Ads Transparency Center and the Meta Ad Library in the owner's browser (US, read only, 45 s apart) and saves one file per advertiser and library as <pewp>/captures/ads/<advertiser>-<library>.json in the format at the top of scripts/import-ads.mjs",
  check(j) {
    const e = [];
    if (!nonEmpty(j.advertiser)) e.push("no advertiser (\"client\" or the competitor's domain)");
    if (!LIBRARIES.includes(j.library)) e.push(`library is not ${LIBRARIES.join("|")}`);
    if (nonEmpty(j.blocked)) {
      if (j.running != null) e.push("a capture that says blocked must not also say running: the state is not known");
      if (j.url != null && !isHttp(j.url)) e.push("url is not an http(s) address (blocked)");
      if (e.length) return { errors: e }; // a blocked capture is checked like any other
      return { errors: [], row: { advertiser: j.advertiser.trim().toLowerCase(), library: j.library, region: j.region || null, status: "blocked", blocked: j.blocked.trim(), running: null, adCount: null, since: null, runningDays: null, formats: [], url: j.url || null } };
    }
    if (typeof j.running !== "boolean") e.push("running must be true or false (or write \"blocked\": \"page not tied to the business\")");
    let n = null, since = null;
    if (j.running === true) {
      n = toNum(j.adCount);
      if (n == null || n < 1 || !Number.isInteger(n)) e.push("a running advertiser needs adCount, a whole number of 1 or more");
      if (j.since != null) { since = toDate(j.since); if (!since) e.push("since is not a date"); }
      if (j.formats != null && (!Array.isArray(j.formats) || j.formats.some((x) => !nonEmpty(x)))) e.push("formats must be a list of words");
    }
    if (j.url != null && !isHttp(j.url)) e.push("url is not an http(s) address");
    if (e.length) return { errors: e };
    return { errors: [], row: { advertiser: j.advertiser.trim().toLowerCase(), library: j.library, region: j.region || null, running: j.running, adCount: j.running ? n : 0, since, runningDays: since ? Math.floor(daysSince(since)) : null, formats: j.running ? (j.formats || []).map((x) => x.trim().toLowerCase()) : [], url: j.url || null } };
  },
  summarize(rows) {
    const names = [...new Set(rows.map((r) => r.advertiser))].sort((a, b) => (a === "client" ? -1 : b === "client" ? 1 : a.localeCompare(b)));
    const advertisers = names.map((a) => { const mine = rows.filter((r) => r.advertiser === a), ok = mine.filter((r) => r.status !== "blocked"), nk = mine.length - ok.length, on = ok.some((r) => r.running), rd = LIBRARIES.filter((l) => ok.some((r) => r.library === l)), nr = LIBRARIES.filter((l) => !mine.some((r) => r.library === l)); return { advertiser: a, librariesChecked: ok.length, librariesNotKnown: nk, librariesRead: rd, librariesNotRead: nr, running: on ? true : nk || nr.length ? null : false, adCount: on || (!nk && !nr.length) ? ok.reduce((s, r) => s + r.adCount, 0) : null }; });
    return { advertisers, advertisersChecked: advertisers.filter((x) => x.running !== null).length, advertisersNotKnown: advertisers.filter((x) => x.running === null).length, advertisersRunning: advertisers.filter((x) => x.running).length, clientRunning: advertisers.find((x) => x.advertiser === "client")?.running ?? null, competitorsRunning: advertisers.filter((x) => x.advertiser !== "client" && x.running).length };
  },
};

await cli(import.meta.url, def);
