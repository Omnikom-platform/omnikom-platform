// Dated cache for every external response, under <pewp>/cache/<source>/, so a re-run never pays (or waits) twice and
// every number in a report can point at the exact response it came from (cacheFile).
// Library: cachedFetch(pewp, source, url, { maxAgeDays, init, timeoutMs }) -> { status, text, json(), fetchedAt, cacheFile, fromCache }
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export async function cachedFetch(pewp, source, url, { maxAgeDays = 7, init = {}, timeoutMs = 30000 } = {}) {
  const key = createHash("sha256").update(`${init.method || "GET"} ${url} ${init.body || ""}`).digest("hex").slice(0, 24);
  const dir = path.join(pewp, "cache", source);
  const cacheFile = path.join(dir, `${key}.json`);
  if (fs.existsSync(cacheFile)) {
    // a cache file cut short (a crash mid-write) is a miss, fetched again, never a crash of the caller
    let c = null;
    try { c = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch {}
    if (c && Date.now() - Date.parse(c.fetchedAt) < maxAgeDays * 86400000) return wrap(c, cacheFile, true);
  }
  // The key never goes into the cache file: strip query parameters named like secrets from the stored URL.
  const shownUrl = url.replace(/([?&](key|api_key|apikey|token|access_token)=)[^&]+/gi, "$1REDACTED");
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const c = { source, url: shownUrl, method: init.method || "GET", status: res.status, fetchedAt: new Date().toISOString(), contentType: res.headers.get("content-type"), headers: keepHeaders(res.headers), text: await res.text() };
  // Only successful answers are kept: an error (4xx/5xx) must be retried next run, never served from the cache.
  if (res.status < 200 || res.status >= 300) return wrap(c, null, false);
  fs.mkdirSync(dir, { recursive: true });
  // written to a temp name and renamed, so a reader never sees half a file
  const tmp = `${cacheFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(c) + "\n");
  try { fs.renameSync(tmp, cacheFile); } catch { try { fs.rmSync(tmp, { force: true }); } catch {} return wrap(c, null, false); } // not cached (file locked): the answer still counts
  return wrap(c, cacheFile, false);
}
// The few response headers a caller may need (indexing and redirect decisions); older cache files have none.
const keepHeaders = (h) => Object.fromEntries(["x-robots-tag", "location", "retry-after", "link"].map((k) => [k, h.get(k)]).filter(([, v]) => v != null));
const wrap = (c, cacheFile, fromCache) => ({ status: c.status, headers: c.headers || {}, text: c.text, json: () => JSON.parse(c.text), fetchedAt: c.fetchedAt, cacheFile, fromCache, url: c.url });

// A number as reports carry it: never a bare value.
export const fact = (value, source, fetchedAt, cacheFile = null, extra = {}) => ({ value, source, fetchedAt, cacheFile, ...extra });
