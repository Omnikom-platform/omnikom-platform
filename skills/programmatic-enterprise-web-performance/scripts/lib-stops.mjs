// The ONE stop format for the skill and the CLI (work order 43). A stop says "do not load pages from this engine until <time>": a robot
// check, a 429, a sign-in wall. One file per engine: ~/.claude/state/omnikom-stops/<engine>.json (OMNIKOM_STOPS_DIR or a `dir` argument
// overrides the folder, tests do):
//   { engine, hosts: [host suffixes], until (ISO UTC), reason, setBy, setAt (ISO UTC), evidence }
//   optional: lift { mode: "desktop", by, at, note } = a person freed DESKTOP control (a person-paced capture in the owner's own browser)
//   and nothing else: isStopped(x, now, dir, "script") (the default, every script) stays stopped until `until`.
// A writer never shortens a later `until`. An expired file is ignored and left where it is (the evidence stays). A file that cannot be
// read is treated as a stop of 24 h from its modification time, because ignoring it could mean hitting a host that asked us to stop.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STOP_HOURS = 24;
// Engines the skill knows, with the host suffixes each one covers. A host matches a suffix when it equals it or is a subdomain of it.
export const KNOWN_ENGINES = {
  google: ["google.com"],
  bing: ["bing.com"],
  commoncrawl: ["index.commoncrawl.org", "data.commoncrawl.org"],
  chatgpt: ["chatgpt.com"],
  perplexity: ["perplexity.ai"],
  copilot: ["copilot.microsoft.com"],
  linkedin: ["linkedin.com"],
  facebook: ["facebook.com", "fb.com"],
  reddit: ["reddit.com"],
  bbb: ["bbb.org"],
  trustpilot: ["trustpilot.com"],
};
const ENGINE_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export const stopsDir = (dir) => dir || process.env.OMNIKOM_STOPS_DIR || path.join(os.homedir(), ".claude", "state", "omnikom-stops");
const fileOf = (engine, dir) => {
  if (!ENGINE_RE.test(String(engine))) throw new Error(`bad engine name "${engine}" (lowercase letters, digits and dashes)`);
  return path.join(stopsDir(dir), `${engine}.json`);
};
const ms = (t) => (typeof t === "number" ? t : Date.parse(t));

/** Every stop file in the folder, parsed. An unreadable one comes back as a synthetic 24 h stop (see the header). */
function readAll(dir) {
  const d = stopsDir(dir);
  let names = [];
  try { names = fs.readdirSync(d).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const f of names) {
    const file = path.join(d, f), engine = f.slice(0, -5);
    if (!ENGINE_RE.test(engine)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!j || typeof j !== "object" || !Number.isFinite(Date.parse(j.until))) throw new Error("no readable until");
      out.push({ ...j, engine, hosts: Array.isArray(j.hosts) ? j.hosts : (KNOWN_ENGINES[engine] || []), file });
    } catch (e) {
      let m = 0; try { m = fs.statSync(file).mtimeMs; } catch { /* gone */ }
      out.push({ engine, hosts: KNOWN_ENGINES[engine] || [], until: new Date(m + STOP_HOURS * 3600_000).toISOString(), reason: `unreadable stop file (${e.message}); treated as a ${STOP_HOURS} h stop`, setBy: "lib-stops", setAt: new Date(m).toISOString(), evidence: file, file, unreadable: true });
    }
  }
  return out;
}

/**
 * The stops in force at `now`, for a mode: "script" (every script, the default: stopped until `until`, lifts never count) or "desktop"
 * (a person-paced capture in the owner's own browser: free when the stop carries a lift for "desktop").
 */
export const activeStops = (now = Date.now(), dir, mode = "script") =>
  readAll(dir).filter((s) => ms(s.until) > ms(now) && !(mode === "desktop" && s.lift && s.lift.mode === "desktop"));

const hostOf = (x) => { const s = String(x).trim().toLowerCase(); try { return s.includes("://") ? new URL(s).hostname : s.replace(/:\d+$/, ""); } catch { return s; } };
/** The stop in force for an engine name ("google") or a host / URL ("maps.google.com"), or null. Truthy means: do not load it. */
export function isStopped(engineOrHost, now = Date.now(), dir, mode = "script") {
  const key = String(engineOrHost).trim().toLowerCase(), host = hostOf(key);
  return activeStops(now, dir, mode).find((s) => s.engine === key || s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) || null;
}

/**
 * Write (or extend) an engine's stop. `until` is an ISO string or epoch ms, default 24 h from `now`. A later `until` already on file is
 * kept: the call writes nothing and returns { written: false, stop: <existing> }. hosts default to the known suffixes for the engine.
 */
export function writeStop({ engine, hosts, until, reason, setBy, evidence = null, now = Date.now(), dir } = {}) {
  const file = fileOf(engine, dir);
  const h = hosts && hosts.length ? hosts.map((x) => String(x).toLowerCase()) : KNOWN_ENGINES[engine];
  if (!h) throw new Error(`engine "${engine}" is not known: pass hosts`);
  if (!reason || !setBy) throw new Error("a stop needs a reason and a setBy");
  const untilMs = until == null ? ms(now) + STOP_HOURS * 3600_000 : ms(until);
  if (!Number.isFinite(untilMs)) throw new Error(`unreadable until: ${until}`);
  const existing = readAll(dir).find((s) => s.engine === engine);
  if (existing && ms(existing.until) > untilMs) return { written: false, stop: existing };
  const rec = { engine, hosts: h, until: new Date(untilMs).toISOString(), reason, setBy, setAt: new Date(ms(now)).toISOString(), evidence };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n"); // a new or extended stop starts without a lift: it is a new event
  return { written: true, stop: { ...rec, file } };
}

/**
 * Record that a person lifted a stop for DESKTOP control only: { lift: { mode: "desktop", by, at, note } } on the existing stop file.
 * "script" mode stays stopped until `until`; no other lift mode exists. The stop must be on file (a lift is not a stop).
 */
export function liftStop({ engine, by, note, at, now = Date.now(), dir } = {}) {
  const file = fileOf(engine, dir);
  if (!by || !note) throw new Error("a lift needs who lifted it (by) and a note");
  const existing = readAll(dir).find((s) => s.engine === engine);
  if (!existing || existing.unreadable) throw new Error(`no readable stop on file for ${engine}`);
  const { file: _f, ...rec } = existing;
  rec.lift = { mode: "desktop", by, at: new Date(ms(at ?? now)).toISOString(), note };
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
  return { ...rec, file };
}
