// Politeness limits shared by every script that requests a site this machine does not serve (a client's live site, a competitor,
// a directory). Project rule (Francine & Eli CLAUDE.md "Be polite to the live sites", 2026-10-17): one request at a time with a gap;
// the FIRST 429 of a run pauses everything for 90 s and allows one retry; a SECOND 429 anywhere in the run stops the run.
// A numeric option that is not a number used to become NaN, and `await sleep(NaN)` waits ~1 ms: "--gap-ms abc" hammered the site
// (3 ms gaps, a 3 ms "wait" after a 429). So every numeric option is checked here, and a gap below the polite minimum to a host
// that is not this machine is a usage error (exit 2). A local fixture server (127.0.0.1 / localhost / ::1) may use any gap >= 0.
export const POLITE_GAP_MS = 4000;      // default gap between two requests to a site we do not serve
export const MIN_GAP_MS = 1000;         // the owner may set a shorter gap than the default, never below this, for a non-local host
export const RETRY_WAIT_MS = 90000;     // the one pause after the first 429 of a run
export const MIN_RETRY_WAIT_MS = 90000; // ... never shorter for a non-local host

export class UsageError extends Error {}
const LOCAL = /^(127(?:\.\d{1,3}){3}|localhost|\[::1\]|::1)$/i;
export const isLocalUrl = (u) => { try { return LOCAL.test(new URL(String(u)).hostname); } catch { return false; } };

// A numeric option: `present` false -> def; else `raw` must be a finite number >= min (a whole number when int). -> number | UsageError
export function numArg(name, raw, { present = raw !== undefined, def, min = 0, int = false } = {}) {
  if (!present) return def;
  const v = Number(raw);
  if (raw == null || String(raw).trim() === "" || !Number.isFinite(v) || v < min || (int && !Number.isInteger(v)))
    throw new UsageError(`${name} must be ${int ? "a whole number" : "a number"} of at least ${min} (got ${raw == null ? "nothing" : JSON.stringify(String(raw))})`);
  return v;
}
// A gap (or a retry wait) in ms to the given addresses: below `min` it is allowed only when every address is local.
export function politeMs(name, v, urls, min) {
  const remote = urls.filter(Boolean).filter((u) => !isLocalUrl(u));
  if (v < min && remote.length) throw new UsageError(`${name} ${v} is below the polite minimum of ${min} ms for a site this machine does not serve (${remote[0]}). Nothing was fetched.`);
  return v;
}
