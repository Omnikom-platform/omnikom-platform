// Shared helpers of the metrics collectors. Deno-loadable: no node: import, no process, no file read. Everything outside comes in as an argument.
// A collector takes { fetch, keys, workspaceId, day, ... } and returns { row, calls, notes }: row = { workspace_id, source, day, data } (the
// metrics_snapshots shape), calls = [{ what, status }] (one per request, keys scrubbed), notes = plain sentences about what was skipped or refused.
export const SOURCES = ["search-console", "pagespeed", "bing", "ai-answers"];

export const isDay = (s) => { if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(`${s}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s; };
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
export const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\/\S+$/.test(s);

// A source that cannot be read today: the row says why and what unblocks it. Never a number from a guess or an older run.
export const blockedData = (reason, unblock) => ({ blocked: { reason, unblock } });
export const blockedRow = (workspaceId, source, day, reason, unblock, extra = {}) => ({ workspace_id: workspaceId, source, day, data: { ...blockedData(reason, unblock), ...extra } });

// Every message that leaves a collector goes through here: a secret, as given and URL-encoded, becomes [key removed].
export const scrubber = (secrets) => (s) => {
  let t = String(s ?? "");
  for (const k of new Set((secrets || []).filter(Boolean).flatMap((x) => [String(x), encodeURIComponent(String(x))]))) t = t.split(k).join("[key removed]");
  return t;
};

// One request with a time limit. Never throws: a network failure or a timeout is { status: 0, error }. json is null when the body is not JSON.
export function client({ fetch: fetchFn, secrets = [], timeoutMs = 30000 }) {
  const scrub = scrubber(secrets), calls = [];
  async function request(what, url, init = {}) {
    let res, text = "", json = null, error = null;
    try {
      res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      text = await res.text();
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    } catch (e) {
      error = e?.name === "TimeoutError" || e?.name === "AbortError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : scrub(e?.message || e).slice(0, 200);
    }
    const status = res ? res.status : 0;
    calls.push({ what, status });
    return { status, json, text: scrub(text).slice(0, 300), error, ok: status >= 200 && status < 300 };
  }
  return { request, calls, scrub };
}
export const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// The words of a name and the site's domain: copies of the skill's matching (measure-sources.mjs), kept here so this folder loads without it.
export const nfkc = (s) => String(s ?? "").normalize("NFKC").toLowerCase();
export const words = (s) => nfkc(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export function containsWords(hay, needle) {
  const h = words(hay), n = words(needle);
  if (!n.length || n.length > h.length) return false;
  for (let i = 0; i + n.length <= h.length; i++) if (n.every((w, j) => h[i + j] === w)) return true;
  return false;
}
export const domainOf = (u) => {
  const s = String(u || "").trim().toLowerCase();
  if (!s) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `http://${s}`).hostname.replace(/^www\./, ""); } catch { return ""; }
};
export const isOurs = (domainOrUrl, ours, aliases = []) => {
  const d = domainOf(domainOrUrl);
  return !!d && [ours, ...aliases].map(domainOf).some((o) => o && (d === o || d.endsWith("." + o)));
};

export const round = (v, n) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(n)) : null);
// An invalid row is a thrown error, never a written row.
export function assertValid(row, validate) {
  const problems = validate(row);
  if (problems.length) throw new Error(`invalid ${row?.source ?? "?"} row: ${problems.join("; ")}`);
  return row;
}
