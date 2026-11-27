// The gate: the one request path of each driver, for each request to another company's host (router job J1c).
// It asks the source table, the stop files, the refusals of this run and robots.txt; a request that may go carries our User-Agent.
// Each request that goes out, and each refusal, writes one line in the driver ledger. It never retries and never gets around a check.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { isStopped, writeStop } from "./lib-stops.mjs";
import { record, lineOf, ledgerFile } from "./lib-driver-ledger.mjs";
import { UA } from "./research-lib.mjs";

export { UA };
export const REFUSALS = 3; // 403 answers in a row from one host: the host is skipped for the run
export const ROBOTS_HOPS = 5; // moves of a robots.txt that are followed
const ROBOTS_NAME = "omnikomaudit";

export const readSources = () => JSON.parse(fs.readFileSync(new URL("../sources.json", import.meta.url), "utf8"));

// the name of a host's stop file: the stop library takes lower-case letters, digits and dashes only
export const stopEngine = (host) =>
  host.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) + "-" + createHash("sha1").update(host).digest("hex").slice(0, 8);

/** The rules of the groups that name us, else of the groups for each reader (the groups are read as snapshot-site.mjs reads them). */
export function parseRobots(text) {
  const groups = [];
  let g = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.replace(/#.*/, "").match(/^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), v = m[2];
    if (key === "user-agent") {
      if (!g || g.rules.length) { g = { agents: [], rules: [] }; groups.push(g); }
      g.agents.push(v.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && g) g.rules.push({ allow: key === "allow", path: v });
  }
  const own = groups.filter((x) => x.agents.includes(ROBOTS_NAME));
  return (own.length ? own : groups.filter((x) => x.agents.includes("*"))).flatMap((x) => x.rules);
}

/** The longest rule that matches wins; with the same length, allow wins; no match is allowed. */
export function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// a leading www. goes; so does the dot that ends a full host name, which names the same site
const bare = (host) => String(host).toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");

export function makeGate({ pewp, run, client, sources, stopsDir, now = () => Date.now(), fetch: doFetch = globalThis.fetch } = {}) {
  for (const [name, v] of Object.entries({ pewp, run, client })) if (typeof v !== "string" || v === "") throw new TypeError("gate: bad " + name);
  if (!sources || typeof sources !== "object" || !Array.isArray(sources.sources)) throw new TypeError("gate: bad sources");
  if (typeof now !== "function" || typeof doFetch !== "function") throw new TypeError("gate: now and fetch are functions");
  const rows = sources.sources;
  const barred = rows.filter((r) => r.state === "barred").flatMap((r) => r.hosts || []).map(bare);
  const isBarred = (host) => { const h = bare(host); return barred.some((b) => h === b || h.endsWith("." + b)); };
  const refusals = new Map(); // host -> 403 answers in a row
  const robots = new Map(); // origin -> the rules, or null: they cannot be read
  const count = (host, status) => refusals.set(host, status === 403 ? (refusals.get(host) || 0) + 1 : 0);

  let past = "";
  try { past = fs.readFileSync(ledgerFile(pewp), "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  for (const text of past.split("\n")) {
    let line;
    try { line = JSON.parse(text); } catch { continue; } // a line that was cut
    if (line?.run === run && Number.isInteger(line.status)) count(line.host, line.status);
  }

  const write = (entry) => record(pewp, entry, now());
  const notSent = (entry, why) => ({ sent: false, why, line: write({ ...entry, result: "not sent", why }) });

  // checks 3 to 5, for the URL of a call and for each place a robots.txt moves to
  const siteCheck = (row, host) => {
    if (row.kind === "reader") { if (isBarred(host)) return "terms"; }
    else if (!(row.hosts || []).includes(host)) return "unknown-source";
    if (isStopped(host, now(), stopsDir)) return "stop";
    if ((refusals.get(host) || 0) >= REFUSALS) return "refused";
    return null;
  };

  // the one place that calls the fetch, for a page and for robots.txt
  async function send(entry, { method, headers, body, timeoutMs }) {
    lineOf({ ...entry, result: "error" }, now()); // check 7: a line the ledger refuses means no request
    const own = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== "user-agent"));
    const options = { method, headers: { ...own, "user-agent": UA }, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) };
    const u = new URL(entry.url), host = u.hostname;
    let res, data, error;
    const before = Date.now();
    try {
      res = await doFetch(entry.url, options); // no-timeout: AbortSignal.timeout(timeoutMs) ends the request
      data = Buffer.from(await res.arrayBuffer());
    } catch (e) { error = String(e?.name); }
    const ms = Math.max(0, Date.now() - before);
    let answer;
    if (error !== undefined) {
      answer = { sent: true, status: null, result: "error", error, line: write({ ...entry, result: "error", ms }) };
    } else {
      const status = res.status;
      const result = status === 403 ? "403" : status === 429 ? "429" : status >= 500 ? "error" : "read";
      count(host, status);
      answer = { sent: true, status, result, headers: Object.fromEntries(res.headers), body: data, line: write({ ...entry, status, result, bytes: data.length, ms }) };
    }
    // also when the body of the 429 could not be read: the host asked us to stop
    if (res?.status === 429) writeStop({ engine: stopEngine(host), hosts: [host], kind: "rate", reason: "HTTP 429 from " + host, setBy: "lib-gate.mjs", evidence: u.origin + u.pathname, now: now(), dir: stopsDir });
    return answer;
  }

  // the rules of one origin, or null when they cannot be read
  async function readRules(origin, row, entry, timeoutMs) {
    let place = origin + "/robots.txt";
    for (let moves = 0; ; moves++) {
      const r = await send({ ...entry, url: place }, { method: "GET", headers: {}, timeoutMs });
      if (r.status === null) return null;
      if (r.status >= 200 && r.status < 300) return parseRobots(r.body.toString("utf8"));
      if (r.status >= 400 && r.status < 500) return [401, 403, 429].includes(r.status) ? null : [];
      if (r.status < 300 || r.status >= 400 || r.headers.location === undefined || moves >= ROBOTS_HOPS) return null;
      let next;
      try { next = new URL(r.headers.location, place); } catch { return null; }
      if (next.protocol !== "http:" && next.protocol !== "https:") return null;
      const why = siteCheck(row, next.hostname);
      if (why) { notSent({ ...entry, url: next.href }, why); return null; }
      place = next.href;
    }
  }

  async function request({ driver, source, url, signedIn = false, method = "GET", headers = {}, body, timeoutMs = 30000 }) {
    const u = new URL(url); // check 0: a URL that cannot be read is a fault of the driver
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new TypeError("gate: the url is not http or https");
    const row = rows.find((r) => r.id === source);
    const entry = { run, client, driver, source, kind: row ? row.kind : null, url, signedIn };
    if (!row) return notSent(entry, "unknown-source");
    if (row.state !== "allowed") return notSent(entry, "terms");
    const why = siteCheck(row, u.hostname);
    if (why) return notSent(entry, why);
    if (row.robotsAtRun === true) {
      if (!robots.has(u.origin)) {
        lineOf({ ...entry, result: "error" }, now()); // check 7 for the page, before its robots.txt is asked
        // the read of robots.txt carries none of the caller's headers, so it is not signed in
        robots.set(u.origin, await readRules(u.origin, row, { ...entry, signedIn: false }, timeoutMs));
      }
      const rules = robots.get(u.origin);
      if (rules === null || !robotsAllows(rules, u.pathname + u.search)) return notSent(entry, "robots");
    }
    return send(entry, { method, headers, body, timeoutMs });
  }

  return { request };
}
