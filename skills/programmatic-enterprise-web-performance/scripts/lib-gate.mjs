// The gate: the one request path of each driver, for each request to another company's host (router jobs J1c, J1d, J1e).
// It asks the source table, the stop files, the refusals of this run and robots.txt; a request that may go carries our User-Agent.
// Each request that goes out, and each refusal, writes one line in the driver ledger. It never retries and never gets around a check.
// Five rules hold for each text of a site: one host form (no dot at its end), a stop name the stop library takes, no RegExp that a text
// can make slow, a size limit (10 MiB of an answer, 512 KiB of a robots.txt), and the address check of the reader (no inner address).
// It also keeps the limits of a source row (one count for each run on the machine, and a hold after a quota answer) and the pace of a
// row (inside one gate), and a driver's sorter may name an answer: a robot check, a quota answer, a refused key, a sign-in wall.
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { isStopped, writeStop } from "./lib-stops.mjs";
import { record, lineOf, ledgerFile, hostForm } from "./lib-driver-ledger.mjs";
import { UA } from "./research-lib.mjs";

export { UA };
export const REFUSALS = 3; // 403 answers in a row from one host: the host is skipped for the run
export const ROBOTS_HOPS = 5; // moves of a robots.txt that are followed
export const HOLD_HOURS = 24; // a hold with no time of its own
export const MAX_BYTES = 10 * 1024 * 1024; // the most of an answer that the gate reads
export const ROBOTS_BYTES = 512 * 1024; // the most of a robots.txt that the gate reads
const ROBOTS_NAME = "omnikomaudit";
const DAY = 86400000;
const WINDOWS = { minute: 60000, hour: 3600000, day: DAY };
const NAMED = ["check", "quota", "key", "sign-in"]; // the results a sorter may name; each leaves the count of 403 answers as it was

export const readSources = () => JSON.parse(fs.readFileSync(new URL("../sources.json", import.meta.url), "utf8"));

// the name of a host's stop file: the stop library takes lower-case letters, digits and dashes only
export const stopEngine = (host) =>
  (host.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "host") + "-" + createHash("sha1").update(host).digest("hex").slice(0, 8);

// one robots.txt line as [line, key, value], or null: no RegExp can try one place of the line two times
const keyValue = (raw) => {
  const hash = raw.indexOf("#"), line = hash < 0 ? raw : raw.slice(0, hash), colon = line.indexOf(":");
  if (colon < 0) return null;
  const key = line.slice(0, colon).trim();
  return /^[A-Za-z-]+$/.test(key) ? [line, key, line.slice(colon + 1).trim()] : null;
};

/** The rules of the groups that name us, else of the groups for each reader (the groups are read as snapshot-site.mjs reads them). */
export function parseRobots(text) {
  const groups = [];
  let g = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = keyValue(raw);
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

// a rule matches from the start of the path: "*" is each run of characters, a last "$" is the end of the path, any other character is itself.
// No RegExp is built from the rule: the first part starts the path, each next part is found with indexOf, the last part ends it.
const ruleMatches = (rule, p) => {
  const end = rule.endsWith("$"), parts = (end ? rule.slice(0, -1) : rule).split("*");
  if (!p.startsWith(parts[0])) return false;
  let at = parts[0].length;
  if (parts.length === 1) return !end || p.length === at;
  for (let i = 1; i < parts.length - 1; i++) {
    const found = p.indexOf(parts[i], at);
    if (found < 0) return false;
    at = found + parts[i].length;
  }
  const last = parts[parts.length - 1];
  return end ? p.length - last.length >= at && p.endsWith(last) : p.indexOf(last, at) >= 0;
};

/** The longest rule that matches wins; with the same length, allow wins; no match is allowed. */
export function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    if (ruleMatches(r.path, path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// a leading www. goes; so does the dot that ends a full host name, which names the same site
const bare = (host) => hostForm(host).replace(/^www\./, "");

// the addresses of this machine and of a private network: the reader never reads one
const INNER = new net.BlockList();
for (const [a, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]]) INNER.addSubnet(a, bits, "ipv4");
for (const a of ["::", "::1"]) INNER.addAddress(a, "ipv6");
for (const [a, bits] of [["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) INNER.addSubnet(a, bits, "ipv6");
// an address that is not an IP address, or that INNER holds (a check that throws counts as inner)
const innerAddress = (address) => { const family = net.isIP(address); if (!family) return true; try { return INNER.check(address, family === 4 ? "ipv4" : "ipv6"); } catch { return true; } };

// read the body of an answer in parts: over the limit the read stops (the loop ends, so the stream is cancelled)
class Over extends Error { name = "size"; }
const readBody = async (res, limit) => {
  if (res.body === null) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const part of res.body) {
    total += part.length;
    if (total > limit) throw new Over("over the size limit");
    chunks.push(part);
  }
  return Buffer.concat(chunks, total);
};

export function makeGate({ pewp, run, client, sources, stopsDir, now = () => Date.now(), fetch: doFetch = globalThis.fetch,
  quotaDir = process.env.OMNIKOM_QUOTA_DIR || path.join(os.homedir(), ".claude", "state", "omnikom-quota"),
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  lookup = (host) => dns.promises.lookup(host, { all: true }) } = {}) {
  for (const [name, v] of Object.entries({ pewp, run, client })) if (typeof v !== "string" || v === "") throw new TypeError("gate: bad " + name);
  if (!sources || typeof sources !== "object" || !Array.isArray(sources.sources)) throw new TypeError("gate: bad sources");
  if (typeof now !== "function" || typeof doFetch !== "function") throw new TypeError("gate: now and fetch are functions");
  if (typeof sleep !== "function") throw new TypeError("gate: sleep is a function");
  if (typeof lookup !== "function") throw new TypeError("gate: lookup is a function");
  if (typeof quotaDir !== "string" || quotaDir === "") throw new TypeError("gate: bad quotaDir");
  const rows = sources.sources;
  for (const r of rows) {
    const pace = r.paceMs ?? 0, limits = r.limits ?? [];
    if (!Number.isInteger(pace) || pace < 0) throw new TypeError("gate: bad paceMs of " + r.id);
    const good = (l) => Number.isInteger(l?.count) && l.count >= 1 && (l.per === "run" || Object.hasOwn(WINDOWS, l.per));
    if (!Array.isArray(limits) || !limits.every(good) || new Set(limits.map((l) => l.per)).size !== limits.length) throw new TypeError("gate: bad limits of " + r.id);
    if (r.robotsAtRun === true && limits.length) throw new TypeError("gate: a reader takes no limit: " + r.id);
  }
  const barred = rows.filter((r) => r.state === "barred").flatMap((r) => r.hosts || []).map(bare);
  const isBarred = (host) => { const h = bare(host); return barred.some((b) => h === b || h.endsWith("." + b)); };
  // is the host of a reader an inner address, or a name that gives one (or none, or cannot be found)?
  const isInner = async (given) => {
    let name = hostForm(given);
    if (name.startsWith("[") && name.endsWith("]")) name = name.slice(1, -1);
    if (name === "") return true;
    if (net.isIP(name)) return innerAddress(name);
    let list;
    try { list = await lookup(name); } catch { return true; }
    if (!Array.isArray(list) || list.length === 0) return true;
    // an empty place of the list is an item that is not an object: some() alone skips it, so the list is copied first
    return [...list].some((x) => !x || typeof x !== "object" || innerAddress(x.address));
  };
  const refusals = new Map(); // host -> 403 answers in a row
  const robots = new Map(); // origin -> the rules, or null: they cannot be read
  const count = (host, status) => refusals.set(host, status === 403 ? (refusals.get(host) || 0) + 1 : 0);
  const ran = new Map(); // source -> requests of this run that went out
  const addRan = (source) => ran.set(source, (ran.get(source) || 0) + 1);
  const ended = new Map(); // host -> when this gate last ended a request to it

  let past = "";
  try { past = fs.readFileSync(ledgerFile(pewp), "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  for (const text of past.split("\n")) {
    let line;
    try { line = JSON.parse(text); } catch { continue; } // a line that was cut
    if (line?.run === run && Number.isInteger(line.status) && !NAMED.includes(line.result)) count(line.host, line.status);
    if (line && line.run === run && line.result !== "not sent") addRan(line.source);
  }

  const write = (entry) => record(pewp, entry, now());
  const notSent = (entry, why) => ({ sent: false, why, line: write({ ...entry, result: "not sent", why }) });

  const quotaFile = (id, end) => path.join(quotaDir, encodeURIComponent(id) + "." + end);
  const hitsFile = (id, at) => quotaFile(id, new Date(at).toISOString().slice(0, 10) + ".hits");
  const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };

  const held = (id, at) => {
    const file = quotaFile(id, "hold.json"), text = readText(file);
    if (text === null) return false;
    let until;
    try { until = JSON.parse(text)?.until; } catch { /* not JSON: the time of the file counts */ }
    if (!Number.isInteger(until)) until = fs.statSync(file).mtimeMs + HOLD_HOURS * WINDOWS.hour;
    return at < until;
  };

  // the new check: a hold, or a limit of the row that is reached
  const overLimit = (row) => {
    const at = now();
    if (held(row.id, at)) return true;
    const limits = row.limits ?? [];
    const times = limits.some((l) => l.per !== "run")
      ? [at - DAY, at].flatMap((day) => (readText(hitsFile(row.id, day)) ?? "").split("\n")).filter((s) => /^\d+$/.test(s)).map(Number)
      : [];
    return limits.some(({ count: most, per }) => (per === "run" ? ran.get(row.id) || 0 : times.filter((t) => at - t < WINDOWS[per]).length) >= most);
  };

  const addHit = (row) => {
    if (!row.limits?.length) return;
    addRan(row.id);
    if (!row.limits.some((l) => l.per !== "run")) return;
    const at = now();
    fs.mkdirSync(quotaDir, { recursive: true });
    fs.appendFileSync(hitsFile(row.id, at), at + "\n");
  };

  const writeHold = (row, until, host, evidence) => {
    fs.mkdirSync(quotaDir, { recursive: true });
    const file = quotaFile(row.id, "hold.json"), part = file + "." + process.pid + ".tmp";
    fs.writeFileSync(part, JSON.stringify({ source: row.id, until, reason: "quota answer from " + host, setBy: "lib-gate.mjs", setAt: now(), evidence }) + "\n");
    fs.renameSync(part, file);
  };

  // what the driver's sorter says of an answer: null (the gate's own result), a named result, or an error
  const sorted = (sort, row, answer) => {
    try {
      const v = sort(answer);
      if (v === null || v === undefined) return null;
      if (v instanceof Promise) v.catch(() => {}); // not awaited; a rejection must not end the run
      const result = v.result;
      if (!NAMED.includes(result)) return { result: "error", error: "sort" };
      if (result !== "quota") return { result };
      let until = v.until;
      if (until === undefined) {
        const longest = Math.max(0, ...(row.limits ?? []).map((l) => WINDOWS[l.per] ?? 0));
        until = now() + (longest || HOLD_HOURS * WINDOWS.hour);
      } else if (!Number.isInteger(until) || until <= now()) return { result: "error", error: "sort" };
      return { result, until };
    } catch { return { result: "error", error: "sort" }; }
  };

  // checks 3 to 5, for the URL of a call and for each place a robots.txt moves to
  const siteCheck = (row, given) => {
    const host = hostForm(given);
    if (row.kind === "reader") { if (isBarred(host)) return "terms"; }
    else if (!(row.hosts || []).includes(host)) return "unknown-source";
    if (isStopped(host, now(), stopsDir)) return "stop";
    if ((refusals.get(host) || 0) >= REFUSALS) return "refused";
    return null;
  };

  // the one place that calls the fetch, for a page and for robots.txt
  async function send(entry, row, { method, headers, body, timeoutMs, sort, limit }) {
    lineOf({ ...entry, result: "error" }, now()); // check 7: a line the ledger refuses means no request
    const u = new URL(entry.url), host = hostForm(u.hostname), paced = host;
    if (row.paceMs > 0 && ended.has(paced)) {
      const wait = row.paceMs - (now() - ended.get(paced));
      if (wait > 0) await sleep(wait);
    }
    const own = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== "user-agent"));
    const options = { method, headers: { ...own, "user-agent": UA }, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) };
    let res, data, error;
    addHit(row);
    const before = Date.now();
    try {
      res = await doFetch(entry.url, options); // no-timeout: AbortSignal.timeout(timeoutMs) ends the request
      data = await readBody(res, limit);
    } catch (e) { error = String(e?.name); }
    ended.set(paced, now());
    const ms = Math.max(0, Date.now() - before);
    let answer;
    if (error !== undefined) {
      answer = { sent: true, status: null, result: "error", error, line: write({ ...entry, result: "error", ms }) };
    } else {
      const status = res.status;
      const got = Object.fromEntries(res.headers);
      const named = sort && status !== 429 ? sorted(sort, row, { status, headers: got, body: data }) : null;
      const result = named ? named.result : status === 403 ? "403" : status === 429 ? "429" : status >= 500 ? "error" : "read";
      if (!NAMED.includes(result)) count(host, status);
      answer = { sent: true, status, ...named, result, headers: got, body: data, line: write({ ...entry, status, result, bytes: data.length, ms }) };
      // the ledger line first, then the stop or the hold
      if (result === "check") writeStop({ engine: stopEngine(host), hosts: [host], kind: "check", reason: "robot check from " + host, setBy: "lib-gate.mjs", evidence: u.origin + u.pathname, now: now(), dir: stopsDir });
      if (result === "quota") writeHold(row, named.until, host, u.origin + u.pathname);
    }
    // also when the body of the 429 could not be read: the host asked us to stop
    if (res?.status === 429) writeStop({ engine: stopEngine(host), hosts: [host], kind: "rate", reason: "HTTP 429 from " + host, setBy: "lib-gate.mjs", evidence: u.origin + u.pathname, now: now(), dir: stopsDir });
    return answer;
  }

  // the rules of one origin, or null when they cannot be read
  async function readRules(origin, row, entry, options) {
    let place = origin + "/robots.txt";
    for (let moves = 0; ; moves++) {
      const r = await send({ ...entry, url: place }, row, { ...options, method: "GET", headers: {}, limit: ROBOTS_BYTES });
      if (r.status === null) return null;
      if (r.status >= 200 && r.status < 300) return parseRobots(r.body.toString("utf8"));
      if (r.status >= 400 && r.status < 500) return [401, 403, 429].includes(r.status) ? null : [];
      if (r.status < 300 || r.status >= 400 || r.headers.location === undefined || moves >= ROBOTS_HOPS) return null;
      let next;
      try { next = new URL(r.headers.location, place); } catch { return null; }
      if (next.protocol !== "http:" && next.protocol !== "https:") return null;
      const why = siteCheck(row, next.hostname);
      if (why) { notSent({ ...entry, url: next.href }, why); return null; }
      if (row.kind === "reader" && (await isInner(next.hostname))) { notSent({ ...entry, url: next.href }, "address"); return null; }
      place = next.href;
    }
  }

  async function request({ driver, source, url, signedIn = false, method = "GET", headers = {}, body, timeoutMs = 30000, sort }) {
    const u = new URL(url); // check 0: a URL that cannot be read is a fault of the driver
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new TypeError("gate: the url is not http or https");
    if (sort !== undefined && typeof sort !== "function") throw new TypeError("gate: sort is a function");
    const row = rows.find((r) => r.id === source);
    const entry = { run, client, driver, source, kind: row ? row.kind : null, url, signedIn };
    if (!row) return notSent(entry, "unknown-source");
    if (row.state !== "allowed") return notSent(entry, "terms");
    const why = siteCheck(row, u.hostname);
    if (why) return notSent(entry, why);
    if (row.kind === "reader" && (await isInner(u.hostname))) return notSent(entry, "address");
    if (overLimit(row)) return notSent(entry, "limit");
    if (row.robotsAtRun === true) {
      if (!robots.has(u.origin)) {
        lineOf({ ...entry, result: "error" }, now()); // check 7 for the page, before its robots.txt is asked
        // the read of robots.txt carries none of the caller's headers, so it is not signed in
        robots.set(u.origin, await readRules(u.origin, row, { ...entry, signedIn: false }, { timeoutMs }));
      }
      const rules = robots.get(u.origin);
      if (rules === null || !robotsAllows(rules, u.pathname + u.search)) return notSent(entry, "robots");
    }
    return send(entry, row, { method, headers, body, timeoutMs, sort, limit: MAX_BYTES });
  }

  return { request };
}
