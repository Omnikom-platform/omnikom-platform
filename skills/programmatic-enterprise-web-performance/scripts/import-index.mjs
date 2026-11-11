// Index coverage, captured by the MAIN SESSION in the owner's browser: `site:<host>` searched on Google and on Bing (one page at a time, at least 45 s
// apart, stop at the first robot check), plus whether each service of the business has an indexed page. NO script fetches a results page: this only
// reads the saved files and writes ONE normalized JSON of counts.
// Usage: node import-index.mjs <url> [--dir DIR (default <pewp>/captures/index)] [--max-age-days 30] [--cwd DIR]
// One file per engine: { "engine":"google|bing", "query":"site:example.com", "capturedAt":"ISO", "browser":"owner's Edge",
//   "location":{"requested":"Sacramento, CA","footer":"..."}, "resultCountText":"About 1,230 results", "resultCount":1230, "countShown":true,
//   "listedUrls":["https://example.com/", ...], "serviceChecks":[{"service":"hard money loans","listed":true,"url":"https://example.com/hard-money"}] }
//   resultCount may be left out when resultCountText says it ("About 1,230 results", "12 results", "No results"). Google often shows no count: write
//   "countShown": false and leave both out; the count is then null ("not shown"), never guessed. listedUrls is the list of addresses the page showed (may be empty).
// A file with a wrong engine, a query that is not site:<host>, no count and no countShown:false, no listedUrls or a bad serviceChecks list is REJECTED with the reason.
// Output: research/index.json { rows:[{engine, query, resultCount, countText, listedUrls, serviceChecks, file, capturedAt, ageDays, stale}],
//   summary:{ google:{indexedCount, listedUrls}, bing:{...}, servicesChecked, servicesListed, servicesMissing:[...] } }.
import { cli, toNum, isHttp, nonEmpty } from "./lib-captures.mjs";

// "About 1,230 results" -> 1230; "No results found" / "did not match any documents" -> 0; anything else -> null
export function countFromText(t) {
  const s = String(t ?? "");
  if (/no results|did not match any|(^|[^\d,.])0\s+results/i.test(s)) return 0;
  const m = s.match(/([\d][\d.,]*)\s*(results?|pages?)/i);
  return m ? toNum(m[1].replace(/\.(?=\d{3}\b)/g, "")) : null;
}

const def = {
  module: "index", dir: "index", out: "index", script: "import-index.mjs",
  how: "the main session captures index coverage in the owner's browser: site:<host> on Google and on Bing, one page at a time at least 45 s apart, and saves each as <pewp>/captures/index/<engine>.json in the format at the top of scripts/import-index.mjs",
  check(j) {
    const e = [];
    const engine = String(j.engine || "").toLowerCase();
    if (!["google", "bing"].includes(engine)) e.push("engine is not google|bing");
    if (!/^site:\S+/i.test(String(j.query || ""))) e.push('query is not a "site:<host>" search');
    let n = toNum(j.resultCount);
    if (n == null && j.resultCountText != null) n = countFromText(j.resultCountText);
    if (n == null && j.countShown !== false) e.push('no resultCount and no resultCountText that says a count ("About 1,230 results", "No results"); if the engine showed none, write "countShown": false');
    if (n != null && n < 0) e.push("resultCount is negative");
    const listed = Array.isArray(j.listedUrls) ? j.listedUrls : null;
    if (!listed) e.push("no listedUrls list (the addresses the page showed; it may be empty)");
    else if (listed.some((u) => !isHttp(u))) e.push("listedUrls holds something that is not an http(s) address");
    let checks = [];
    if (j.serviceChecks != null) {
      if (!Array.isArray(j.serviceChecks) || j.serviceChecks.some((c) => !nonEmpty(c?.service) || typeof c?.listed !== "boolean")) e.push("serviceChecks must be a list of { service, listed: true|false }");
      else checks = j.serviceChecks.map((c) => ({ service: c.service.trim().toLowerCase(), listed: c.listed, url: c.url || null }));
    }
    if (e.length) return { errors: e };
    return { errors: [], row: { engine, query: j.query, resultCount: n, countText: j.resultCountText ?? null, countShown: n != null, listedUrls: listed.length, serviceChecks: checks } };
  },
  summarize(rows) {
    const eng = (name) => { const r = rows.filter((x) => x.engine === name).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0]; return r ? { indexedCount: r.resultCount, listedUrls: r.listedUrls, file: r.file } : null; };
    const svc = new Map();
    for (const r of rows) for (const c of r.serviceChecks) svc.set(c.service, (svc.get(c.service) || false) || c.listed);
    return { google: eng("google"), bing: eng("bing"), servicesChecked: svc.size, servicesListed: [...svc.values()].filter(Boolean).length, servicesMissing: [...svc].filter(([, v]) => !v).map(([k]) => k).sort() };
  },
};

await cli(import.meta.url, def);
