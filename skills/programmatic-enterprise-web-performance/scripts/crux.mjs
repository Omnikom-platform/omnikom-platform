// CrUX: real-visitor speed (field data) from the Chrome UX Report API, for the page and for its whole origin, on phones and on desktops.
// This is what visitors' Chrome measured over the last 28 days, next to the lab numbers of snapshot-site.mjs and PageSpeed Insights (psi.mjs).
// Usage: node crux.mjs <url> [--cwd DIR] [--today YYYY-MM-DD] [--form-factor PHONE|DESKTOP|PHONE,DESKTOP] [--dotenv FILE] [--gap-ms 1000]
//   --cwd          where site-checks/<host>/.pewp lives (default: the current folder)
//   --form-factor  PHONE, DESKTOP or both (default both)
//   --dotenv       a .env file that holds CRUX_API_KEY (same option as --env-file; see lib-env.mjs); a variable already set wins
//   --gap-ms       pause between two requests to Google (default 1000; for a real Google address never below 1000)
// Key: $CRUX_API_KEY, sent as ?key= and never stored or printed (removed from the cache file's stored address, scrubbed from every message).
// Without a key: BLOCKED (exit 3): enable the Chrome UX Report API in Google Cloud, create a key, set CRUX_API_KEY.
// Request: POST https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=  body {"url"|"origin": ..., "formFactor": "PHONE"|"DESKTOP"}  (base: $CRUX_API_BASE, tests only).
// One request at a time, --gap-ms apart; each is cut off after 60 s ($CRUX_TIMEOUT_MS shortens that, tests only); a successful answer is cached 1 day.
// "Data not found" (HTTP 404 NOT_FOUND) is a RESULT, NO DATA, never a failure: Google has no field data for a page or site with too little traffic.
// Reads record.metrics: largest_contentful_paint, interaction_to_next_paint, cumulative_layout_shift, first_contentful_paint,
// experimental_time_to_first_byte: percentiles.p75 (a number, or a string for CLS) and the histogram densities (good, needs improvement, poor).
// Writes <pewp>/crux/<date>.json = { generatedAt, rows: [{ scope: "url"|"origin", target, formFactor, status: "data"|"no data",
//   metrics: { lcp, inp, cls, fcp, ttfb: { p75, good, needsImprovement, poor } } | null, collectionPeriod: { first, last } | null, fetchedAt, cacheFile }], failures: [...] }
// and prints one line per row ("crux url PHONE <address>: LCP p75 2750 ms, INP 180 ms, CLS 0.05" or "... NO DATA"). When every row is NO DATA the last line is
// "NO DATA: ..." (exit 0).
// Exit: 0 written, 1 every request failed (nothing written), 2 usage, 3 BLOCKED (no key, key refused, API not enabled, quota used up; the run stops there).
// The live Google endpoint is UNPROVEN here: the answer's shape is the documented v1 shape and is tested against a local fake server only.
import fs from "node:fs";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { runCli, Blocked, Usage, today as todayStr, iso, sleep, W } from "./research-lib.mjs";
import { cachedFetch } from "./cache.mjs";
import { locate, isUrl } from "./state.mjs";
import { loadEnv, envFileArg, EnvFileError } from "./lib-env.mjs";
import { numArg, politeMs, UsageError, MIN_GAP_MS } from "./lib-polite.mjs";

const USAGE = "node crux.mjs <url> [--cwd DIR] [--today YYYY-MM-DD] [--form-factor PHONE|DESKTOP|PHONE,DESKTOP] [--dotenv FILE] [--gap-ms 1000]";
const BASE = () => (process.env.CRUX_API_BASE || "https://chromeuxreport.googleapis.com").replace(/\/$/, "");
const UNBLOCK = "CRUX_API_KEY is not set | unblocks: enable the Chrome UX Report API in Google Cloud (APIs & Services), create an API key restricted to it, then set CRUX_API_KEY in the environment or in a .env file passed with --dotenv";
const scrubber = (key) => (s) => {
  let t = String(s ?? "");
  for (const k of new Set([key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)])) if (k) t = t.split(k).join("[key removed]");
  return t;
};
class KeyLeak extends Error {}

const round = (v, n) => (v == null ? null : Number(v.toFixed(n)));
const ymd = (d) => (d && d.year ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null);
// one metric of the documented answer: the p75 as a number, the three shares of the histogram; null when the metric is absent
function metricOf(x) {
  if (!x) return null;
  const p75 = Number(x.percentiles?.p75);
  const dens = (x.histogram || []).map((b) => Number(b.density) || 0);
  return { p75: Number.isFinite(p75) ? p75 : null, good: dens[0] ?? null, needsImprovement: dens[1] ?? null, poor: dens[2] ?? null };
}
export function readRecord(j) {
  const m = j?.record?.metrics;
  if (!m) throw new Error("the answer has no record.metrics");
  const metrics = { lcp: metricOf(m.largest_contentful_paint), inp: metricOf(m.interaction_to_next_paint), cls: metricOf(m.cumulative_layout_shift), fcp: metricOf(m.first_contentful_paint), ttfb: metricOf(m.experimental_time_to_first_byte) };
  for (const k of Object.keys(metrics)) if (metrics[k]) for (const f of ["good", "needsImprovement", "poor"]) metrics[k][f] = round(metrics[k][f], 3);
  const cp = j.record.collectionPeriod;
  return { metrics, collectionPeriod: cp ? { first: ymd(cp.firstDate), last: ymd(cp.lastDate) } : null };
}
const lineOf = (row) => {
  const m = row.metrics;
  return `crux ${row.scope} ${row.formFactor} ${row.target}: ` + (row.status === "no data" ? "NO DATA" : [m.lcp?.p75 != null && `LCP p75 ${Math.round(m.lcp.p75)} ms`, m.inp?.p75 != null && `INP ${Math.round(m.inp.p75)} ms`, m.cls?.p75 != null && `CLS ${m.cls.p75}`].filter(Boolean).join(", "));
};

export async function run(a) {
  const urls = a._;
  if (urls.length !== 1) throw new Usage(USAGE);
  const url = urls[0];
  if (!isUrl(url)) throw new Usage(`"${url}" is not an http(s) address (usage: ${USAGE})`);
  const ffs = String(a.get("form-factor", "PHONE,DESKTOP")).split(",").map((s) => s.trim()).filter(Boolean);
  if (!ffs.length || ffs.some((s) => s !== "PHONE" && s !== "DESKTOP")) throw new Usage(`--form-factor is PHONE, DESKTOP or PHONE,DESKTOP (got "${a.get("form-factor")}")`);
  const date = a.get("today", todayStr());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Usage(`--today must be YYYY-MM-DD (got "${date}")`);
  let gapMs;
  try { gapMs = politeMs("--gap-ms", numArg("--gap-ms", a.get("gap-ms"), { present: a.has("gap-ms"), def: 1000, min: 0 }), [BASE()], MIN_GAP_MS); }
  catch (e) { if (e instanceof UsageError) throw new Usage(e.message); throw e; }
  const timeoutMs = Number(process.env.CRUX_TIMEOUT_MS) > 0 ? Number(process.env.CRUX_TIMEOUT_MS) : 60000;

  const cwd = a.get("cwd", process.cwd());
  const loc = locate(url, { cwd });
  try { loadEnv({ envFile: envFileArg(process.argv.slice(2)), pewp: loc.pewp, cwd: process.cwd() }); }
  catch (e) { if (e instanceof EnvFileError) throw new Usage(e.message); throw e; }
  const key = (process.env.CRUX_API_KEY || "").trim();
  if (!key) throw new Blocked(UNBLOCK);
  const scrub = scrubber(key);

  const origin = new URL(url).origin;
  const scopes = ["url", "origin"];
  const rows = [], failures = [], lines = [];
  let nextAt = 0;
  for (const scope of scopes) {
    for (const formFactor of ffs) {
      const target = scope === "url" ? url : origin;
      const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [scope]: target, formFactor }) };
      const reqUrl = `${BASE()}/v1/records:queryRecord?${new URLSearchParams({ key })}`;
      try {
        const wait = nextAt - Date.now();
        if (wait > 0) await sleep(wait);
        const res = await cachedFetch(loc.pewp, "crux", reqUrl, { maxAgeDays: 1, timeoutMs, init });
        if (!res.fromCache) nextAt = Date.now() + gapMs; // the next request waits a full gap after this one ended; a cached answer made no request
        let body = null; try { body = res.json(); } catch {}
        if (res.cacheFile) {
          const stored = fs.readFileSync(res.cacheFile, "utf8");
          if ([key, encodeURIComponent(key)].some((k) => stored.includes(k))) { fs.rmSync(res.cacheFile, { force: true }); throw new KeyLeak(`the cache file would have held the key, so it was deleted (${path.basename(res.cacheFile)}); nothing else was kept`); }
        }
        const cacheFile = res.cacheFile ? path.relative(loc.pewp, res.cacheFile).split(path.sep).join("/") : null;
        if (res.status === 404) { rows.push({ scope, target, formFactor, status: "no data", metrics: null, collectionPeriod: null, fetchedAt: res.fetchedAt, cacheFile }); lines.push(lineOf(rows.at(-1))); continue; }
        if (res.status === 429) throw new Blocked("Google answered 429 (the quota of the key is used up for now) | unblocks: wait for the quota to reset, or raise it in Google Cloud");
        if (res.status === 403) throw new Blocked("Google answered 403: the Chrome UX Report API is not enabled for the project of this key | unblocks: enable the Chrome UX Report API in Google Cloud for the project of CRUX_API_KEY");
        if (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(res.text)) throw new Blocked("Google refused CRUX_API_KEY (HTTP 400, key not valid) | unblocks: set a valid CRUX_API_KEY (an API key of a project with the Chrome UX Report API enabled)");
        if (res.status < 200 || res.status >= 300) throw new Error(`Google answered ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
        rows.push({ scope, target, formFactor, status: "data", ...readRecord(body), fetchedAt: res.fetchedAt, cacheFile });
        lines.push(lineOf(rows.at(-1)));
      } catch (e) {
        if (e instanceof Blocked) throw new Blocked(scrub(e.unblock));
        if (e instanceof KeyLeak) throw new Blocked(`${e.message} | unblocks: report this to the skill's owner`);
        const why = e.name === "TimeoutError" || e.name === "AbortError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : scrub(e.cause?.code || e.message || e).slice(0, 300);
        failures.push({ scope, target, formFactor, error: why });
        lines.push(`crux ${scope} ${formFactor} ${target}: FAILED (${why})`);
      }
    }
  }
  const outFile = path.join(loc.pewp, "crux", `${date}.json`);
  if (rows.length) W(outFile, { generatedAt: iso(), rows, failures });
  console.log(lines.join("\n"));
  if (!rows.length) { console.error(`every request failed (${failures.length}): nothing was written`); process.exitCode = 1; return ""; }
  const out = [`wrote ${rows.length} row(s) to ${outFile}${failures.length ? ` (${failures.length} failed, listed under "failures")` : ""}`];
  if (rows.every((r) => r.status === "no data")) out.push(`NO DATA: Google's Chrome UX Report has no field data for ${url} or for ${origin} (${ffs.join(" and ")}); too little traffic. This is a result, not a failure.`);
  return out.join("\n");
}

if (isMain(import.meta.url)) {
  if (process.argv.slice(2).includes("--help")) console.log(`usage: ${USAGE}`);
  else await runCli(import.meta.url, USAGE, [], run);
}
