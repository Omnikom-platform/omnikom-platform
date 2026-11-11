// PageSpeed Insights (Google's own Lighthouse run, on Google's servers) for the pages that matter: the TRUSTED speed number when the lab
// run of snapshot-site.mjs was UNTRUSTED because this machine was busy (gap G9, contract C8).
// Usage: node psi.mjs <url>... [--cwd DIR] [--today YYYY-MM-DD] [--strategy mobile,desktop] [--runs 1..5] [--run-gap-ms 31000] [--dotenv FILE] [--gap-ms 2000]
//   --cwd       where site-checks/<host>/.pewp lives (default: the current folder); <pewp> is the FIRST url's host, as doctor finds it
//   --strategy  mobile, desktop, or both (default both)
//   --dotenv    a .env file that holds PSI_API_KEY (same option as --env-file; see lib-env.mjs); a variable already set wins
//   --gap-ms    pause between two requests to Google (default 2000; for a real Google address never below 1000)
//   --runs      runs per page and strategy (default 1, at most 5). With more than one, the row of a page is the MEDIAN of its runs (each metric's
//               own median; an even number of working runs takes the mean of the two middle ones), `medianOf` says how many runs it is a median of
//               (a run that failed is listed under `failures` with its run number, and the median is taken over the rest), `runs` lists every
//               run with its numbers and its own cache file (kept: the raw answers stay under <pewp>/cache/psi/), and the row's cacheFile is the
//               median run's. Runs go round by round (run 1 of every page and strategy, then run 2, ...), so a repeat of the same request is
//               never sooner than --run-gap-ms (default 31000 to Google: Google may answer a repeat within about 30 s from one analysis, so three
//               runs would be one: UNPROVEN live; the gap is the precaution; for a local test address the default is --gap-ms).
// Key: $PSI_API_KEY, sent as ?key= and never stored or printed (removed from the cache file's stored address, scrubbed from every message).
// Without a key: BLOCKED (exit 3) with the way in: a free key from Google Cloud with the "PageSpeed Insights API" enabled.
// Request: GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=&strategy=&category=performance&key=  (base: $PSI_API_BASE, tests only).
// One request at a time, --gap-ms apart; each request is cut off after 60 s ($PSI_TIMEOUT_MS shortens that, tests only); a successful answer
// is cached 1 day under <pewp>/cache/psi/ (a cached answer costs no request and no wait).
// Reads lighthouseResult.categories.performance.score (0..1, written as 0..100) and the numericValue of the audits largest-contentful-paint,
// cumulative-layout-shift, total-blocking-time, first-contentful-paint, speed-index.
// Writes <pewp>/psi/<date>.json = { generatedAt, pages: [{ url, strategy, performance, lcpMs, cls, tbtMs, fcpMs, speedIndexMs, fetchedAt, cacheFile, medianOf, runsAsked, runs: [{ run, performance, ..., fetchedAt, cacheFile }] }], failures: [{ url, strategy, run, error }] }
// and prints one line per page: "psi <strategy> <url>: performance N, LCP N ms" (with --runs: one line per run, then "psi <strategy> <url>: median of N: performance N, LCP N ms").
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

const USAGE = "node psi.mjs <url>... [--cwd DIR] [--today YYYY-MM-DD] [--strategy mobile,desktop] [--runs 1..5] [--run-gap-ms 31000] [--dotenv FILE] [--gap-ms 2000]";
const BASE = () => (process.env.PSI_API_BASE || "https://www.googleapis.com/pagespeedonline/v5/runPagespeed").replace(/\/$/, "");
const UNBLOCK = "PSI_API_KEY is not set | unblocks: get a free key: Google Cloud console > APIs & Services > enable \"PageSpeed Insights API\" > Credentials > Create credentials > API key. Then set PSI_API_KEY in the environment, or put it in a .env file and pass --dotenv FILE.";

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

// median of the numbers that are there: the middle one, or the mean of the two middle ones; null when there are none
const med = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((p, q) => p - q);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const isLocalBase = (b) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(b);

// a cached answer makes no request, so it needs no wait (the cache file of this very request exists and is fresh)
async function isCached(pewp, reqUrl, run) {
  const { createHash } = await import("node:crypto");
  const key = createHash("sha256").update(`GET ${reqUrl} ${run > 1 ? ` #run${run}` : ""}`).digest("hex").slice(0, 24);
  const f = path.join(pewp, "cache", "psi", `${key}.json`);
  try { return Date.now() - Date.parse(JSON.parse(fs.readFileSync(f, "utf8")).fetchedAt) < 86400000; } catch { return false; }
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
  const runs = a.num("runs", 1, { min: 1, int: true });
  if (runs > 5) throw new Usage(`--runs is a whole number from 1 to 5 (got ${runs})`);
  const runGapMs = a.num("run-gap-ms", isLocalBase(BASE()) ? gapMs : 31000, { min: 0 });
  const timeoutMs = Number(process.env.PSI_TIMEOUT_MS) > 0 ? Number(process.env.PSI_TIMEOUT_MS) : 60000;

  const cwd = a.get("cwd", process.cwd());
  const loc = locate(urls[0], { cwd });
  try { loadEnv({ envFile: envFileArg(process.argv.slice(2)), pewp: loc.pewp, cwd: process.cwd() }); }
  catch (e) { if (e instanceof EnvFileError) throw new Usage(e.message); throw e; }
  const key = (process.env.PSI_API_KEY || "").trim();
  if (!key) throw new Blocked(UNBLOCK);
  const scrub = scrubber(key);

  const pages = [], failures = [];
  const pairs = urls.flatMap((url) => strategies.map((strategy) => ({ url, strategy })));
  const got = new Map(), lastAt = new Map(); // pair -> its runs that worked; pair -> when its last request was made
  let nextAt = 0, stopped = null;
  outer: for (let run = 1; run <= runs; run++) {
    for (const { url, strategy } of pairs) {
      const pk = `${strategy} ${url}`;
      const q = new URLSearchParams({ url, strategy, category: "performance" });
      q.set("key", key); // last, so the stored address can drop it by name
      const reqUrl = `${BASE()}?${q}`;
      try {
        const sameWait = (lastAt.get(pk) || 0) + runGapMs - Date.now();
        const wait = Math.max(nextAt - Date.now(), lastAt.has(pk) ? sameWait : 0);
        if (wait > 0 && !(await isCached(loc.pewp, reqUrl, run))) await sleep(wait);
        const res = await cachedFetch(loc.pewp, "psi", reqUrl, { maxAgeDays: 1, timeoutMs, variant: run > 1 ? `run${run}` : undefined });
        if (!res.fromCache) { nextAt = Date.now() + gapMs; lastAt.set(pk, Date.now()); } // the next request waits a full gap after this one ended; a cached answer made no request
        if (res.status === 429) throw new Stop429("Google answered 429 (the free quota is used up for now)");
        let body = null; try { body = res.json(); } catch {}
        if (res.status < 200 || res.status >= 300) throw new Error(`Google answered ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
        if (res.cacheFile) {
          const stored = fs.readFileSync(res.cacheFile, "utf8");
          if ([key, encodeURIComponent(key)].some((k) => stored.includes(k))) { fs.rmSync(res.cacheFile, { force: true }); throw new KeyLeak(`the cache file would have held the key, so it was deleted (${path.basename(res.cacheFile)}); nothing else was kept`); }
        }
        const row = readAnswer(body);
        const one = { run, ...row, fetchedAt: res.fetchedAt, cacheFile: res.cacheFile ? path.relative(loc.pewp, res.cacheFile).split(path.sep).join("/") : null };
        got.set(pk, [...(got.get(pk) || []), one]);
        console.log(runs === 1 ? `psi ${strategy} ${url}: performance ${row.performance}, LCP ${row.lcpMs} ms` : `psi ${strategy} ${url}: run ${run} of ${runs}: performance ${row.performance}, LCP ${row.lcpMs} ms`);
      } catch (e) {
        if (e instanceof Stop429) { stopped = `${e.message}: stopped at ${strategy} ${url}; the pages after it were not asked. Try again later, or check the key's quota in Google Cloud.`; break outer; }
        if (e instanceof KeyLeak) { stopped = e.message; break outer; }
        const why = e.name === "TimeoutError" || e.name === "AbortError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : scrub(e.cause?.code || e.message || e).slice(0, 300);
        failures.push({ url, strategy, run, error: scrub(why) });
        console.log(`psi ${strategy} ${url}: FAILED (${scrub(why)})`);
      }
    }
  }
  for (const { url, strategy } of pairs) {
    const list = got.get(`${strategy} ${url}`);
    if (!list) continue;
    const metric = (k) => med(list.map((x) => x[k]));
    const rnd = (v) => (v == null ? null : Math.round(v));
    const byScore = [...list].sort((x, y) => x.performance - y.performance);
    const middle = byScore[(byScore.length - 1) >> 1];
    const cls = metric("cls");
    const row = { performance: rnd(metric("performance")), lcpMs: rnd(metric("lcpMs")), cls: cls == null ? null : Number(cls.toFixed(3)), tbtMs: rnd(metric("tbtMs")), fcpMs: rnd(metric("fcpMs")), speedIndexMs: rnd(metric("speedIndexMs")) };
    pages.push({ url, strategy, ...row, fetchedAt: middle.fetchedAt, cacheFile: middle.cacheFile, medianOf: list.length, runsAsked: runs,
      runs: list.map(({ run, ...x }) => ({ run, ...x })),
    });
    if (runs > 1) console.log(`psi ${strategy} ${url}: median of ${list.length}: performance ${row.performance}, LCP ${row.lcpMs} ms`);
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
