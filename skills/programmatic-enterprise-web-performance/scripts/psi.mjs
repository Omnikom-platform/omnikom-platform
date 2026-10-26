// PageSpeed Insights (Google's own Lighthouse run, on Google's servers) for the pages that matter: the TRUSTED speed number when the lab
// run of snapshot-site.mjs was UNTRUSTED because this machine was busy (gap G9, contract C8).
// Usage: node psi.mjs <url>... [--cwd DIR] [--today YYYY-MM-DD] [--strategy mobile,desktop] [--dotenv FILE] [--gap-ms 2000]
//   --cwd       where site-checks/<host>/.pewp lives (default: the current folder); <pewp> is the FIRST url's host, as doctor finds it
//   --strategy  mobile, desktop, or both (default both)
//   --dotenv    a .env file that holds PSI_API_KEY (same option as --env-file; see lib-env.mjs); a variable already set wins
//   --gap-ms    pause between two requests to Google (default 2000; for a real Google address never below 1000)
// Key: $PSI_API_KEY, sent as ?key= and never stored or printed (removed from the cache file's stored address, scrubbed from every message).
// Without a key: BLOCKED (exit 3) with the way in: a free key from Google Cloud with the "PageSpeed Insights API" enabled.
// Request: GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=&strategy=&category=performance&key=  (base: $PSI_API_BASE, tests only).
// One request at a time, --gap-ms apart; each request is cut off after 60 s ($PSI_TIMEOUT_MS shortens that, tests only); a successful answer
// is cached 1 day under <pewp>/cache/psi/ (a cached answer costs no request and no wait).
// Reads lighthouseResult.categories.performance.score (0..1, written as 0..100) and the numericValue of the audits largest-contentful-paint,
// cumulative-layout-shift, total-blocking-time, first-contentful-paint, speed-index.
// Writes <pewp>/psi/<date>.json = { generatedAt, pages: [{ url, strategy, performance, lcpMs, cls, tbtMs, fcpMs, speedIndexMs, fetchedAt, cacheFile }], failures: [...] }
// and prints one line per page: "psi <strategy> <url>: performance N, LCP N ms".
// Exit: 0 written (a page that failed is listed under `failures`), 1 every page failed or Google answered 429 (the run stops at the first 429;
// what was measured before it is still written), 2 usage, 3 no key.
// The live Google endpoint is UNPROVEN here: the answer's shape is the documented v5 shape and is tested against a local fake server only.
import fs from "node:fs";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { runCli, Blocked, Usage, today as todayStr, iso, sleep, W } from "./research-lib.mjs";
import { cachedFetch } from "./cache.mjs";
import { locate, isUrl } from "./state.mjs";
import { loadEnv, envFileArg, EnvFileError } from "./lib-env.mjs";
import { numArg, politeMs, UsageError, MIN_GAP_MS } from "./lib-polite.mjs";

const USAGE = "node psi.mjs <url>... [--cwd DIR] [--today YYYY-MM-DD] [--strategy mobile,desktop] [--dotenv FILE] [--gap-ms 2000]";
const BASE = () => (process.env.PSI_API_BASE || "https://www.googleapis.com/pagespeedonline/v5/runPagespeed").replace(/\/$/, "");
const UNBLOCK = "PSI_API_KEY is not set. Get a free key: Google Cloud console > APIs & Services > enable \"PageSpeed Insights API\" > Credentials > Create credentials > API key. Then set PSI_API_KEY in the environment, or put it in a .env file and pass --dotenv FILE.";

// every message that leaves this script goes through here: the key, as given and as sent in an address, becomes [key removed]
const scrubber = (key) => (s) => {
  let t = String(s ?? "");
  for (const k of new Set([key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)])) if (k) t = t.split(k).join("[key removed]");
  return t;
};
class Stop429 extends Error {}
class KeyLeak extends Error {}

const num = (a, id) => { const v = a?.[id]?.numericValue; return typeof v === "number" && Number.isFinite(v) ? v : null; };
const round = (v) => (v == null ? null : Math.round(v));
// The documented v5 answer -> one row, or an Error saying what was missing.
export function readAnswer(j) {
  const lh = j?.lighthouseResult;
  const score = lh?.categories?.performance?.score;
  if (typeof score !== "number") throw new Error("the answer has no performance score (Lighthouse did not run for this page)");
  const a = lh.audits || {};
  const cls = num(a, "cumulative-layout-shift");
  return {
    performance: Math.round(score * 100),
    lcpMs: round(num(a, "largest-contentful-paint")),
    cls: cls == null ? null : Number(cls.toFixed(3)),
    tbtMs: round(num(a, "total-blocking-time")),
    fcpMs: round(num(a, "first-contentful-paint")),
    speedIndexMs: round(num(a, "speed-index")),
  };
}

export async function run(a) {
  const urls = a._;
  if (!urls.length) throw new Usage(USAGE);
  for (const u of urls) if (!isUrl(u)) throw new Usage(`"${u}" is not an http(s) address (usage: ${USAGE})`);
  const strategies = String(a.get("strategy", "mobile,desktop")).split(",").map((s) => s.trim()).filter(Boolean);
  if (!strategies.length || strategies.some((s) => s !== "mobile" && s !== "desktop")) throw new Usage(`--strategy is mobile, desktop or mobile,desktop (got "${a.get("strategy")}")`);
  const date = a.get("today", todayStr());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Usage(`--today must be YYYY-MM-DD (got "${date}")`);
  let gapMs;
  try { gapMs = politeMs("--gap-ms", numArg("--gap-ms", a.get("gap-ms"), { present: a.has("gap-ms"), def: 2000, min: 0 }), [BASE()], MIN_GAP_MS); }
  catch (e) { if (e instanceof UsageError) throw new Usage(e.message); throw e; }
  const timeoutMs = Number(process.env.PSI_TIMEOUT_MS) > 0 ? Number(process.env.PSI_TIMEOUT_MS) : 60000;

  const cwd = a.get("cwd", process.cwd());
  const loc = locate(urls[0], { cwd });
  try { loadEnv({ envFile: envFileArg(process.argv.slice(2)), pewp: loc.pewp, cwd: process.cwd() }); }
  catch (e) { if (e instanceof EnvFileError) throw new Usage(e.message); throw e; }
  const key = (process.env.PSI_API_KEY || "").trim();
  if (!key) throw new Blocked(UNBLOCK);
  const scrub = scrubber(key);

  const pages = [], failures = [];
  let nextAt = 0, stopped = null;
  outer: for (const url of urls) {
    for (const strategy of strategies) {
      const q = new URLSearchParams({ url, strategy, category: "performance" });
      q.set("key", key); // last, so the stored address can drop it by name
      const reqUrl = `${BASE()}?${q}`;
      try {
        const wait = nextAt - Date.now();
        if (wait > 0) await sleep(wait);
        const res = await cachedFetch(loc.pewp, "psi", reqUrl, { maxAgeDays: 1, timeoutMs });
        if (!res.fromCache) nextAt = Date.now() + gapMs; // the next request waits a full gap after this one ended; a cached answer made no request
        if (res.status === 429) throw new Stop429("Google answered 429 (the free quota is used up for now)");
        let body = null; try { body = res.json(); } catch {}
        if (res.status < 200 || res.status >= 300) throw new Error(`Google answered ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
        if (res.cacheFile) {
          const stored = fs.readFileSync(res.cacheFile, "utf8");
          if ([key, encodeURIComponent(key)].some((k) => stored.includes(k))) { fs.rmSync(res.cacheFile, { force: true }); throw new KeyLeak(`the cache file would have held the key, so it was deleted (${path.basename(res.cacheFile)}); nothing else was kept`); }
        }
        const row = readAnswer(body);
        pages.push({ url, strategy, ...row, fetchedAt: res.fetchedAt, cacheFile: res.cacheFile ? path.relative(loc.pewp, res.cacheFile).split(path.sep).join("/") : null });
        console.log(`psi ${strategy} ${url}: performance ${row.performance}, LCP ${row.lcpMs} ms`);
      } catch (e) {
        if (e instanceof Stop429) { stopped = `${e.message}: stopped at ${strategy} ${url}; the pages after it were not asked. Try again later, or check the key's quota in Google Cloud.`; break outer; }
        if (e instanceof KeyLeak) { stopped = e.message; break outer; }
        const why = e.name === "TimeoutError" || e.name === "AbortError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : scrub(e.cause?.code || e.message || e).slice(0, 300);
        failures.push({ url, strategy, error: scrub(why) });
        console.log(`psi ${strategy} ${url}: FAILED (${scrub(why)})`);
      }
    }
  }
  const outFile = path.join(loc.pewp, "psi", `${date}.json`);
  if (pages.length) W(outFile, { generatedAt: iso(), pages, failures });
  const lines = [];
  if (pages.length) lines.push(`wrote ${pages.length} page result(s) to ${outFile}${failures.length ? ` (${failures.length} failed, listed under "failures")` : ""}`);
  if (stopped) { console.error(`STOPPED: ${stopped}`); process.exitCode = 1; }
  else if (!pages.length) { lines.push(`every page failed (${failures.length}): nothing was written`); process.exitCode = 1; }
  return lines.join("\n");
}

if (isMain(import.meta.url)) {
  if (process.argv.slice(2).includes("--help")) console.log(`usage: ${USAGE}`);
  else await runCli(import.meta.url, USAGE, [], run);
}
