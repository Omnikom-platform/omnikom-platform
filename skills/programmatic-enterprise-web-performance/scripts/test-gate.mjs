// Tests for lib-gate.mjs (router job J1c). A temp folder for each test. No network: a fetch of the test answers, and one test asks
// a local fixture server. Run: node scripts/test-gate.mjs. The mutants: node scripts/test-gate.mjs --mutants (the end of this file).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeStop } from "./lib-stops.mjs";
import { serve } from "./lib-test-kit.mjs";
// LIB_GATE_UNDER_TEST points the test at another copy of the library (the intake). The copy stands in a folder that holds the other scripts.
const { makeGate, readSources, parseRobots, robotsAllows, stopEngine, UA, REFUSALS, ROBOTS_HOPS } = await import(process.env.LIB_GATE_UNDER_TEST ? pathToFileURL(process.env.LIB_GATE_UNDER_TEST).href : new URL("./lib-gate.mjs", import.meta.url).href);

const MUT = process.argv.includes("--mutants");
let fails = 0, n = 0;
const t = async (name, fn) => { if (MUT) return; n++; try { await fn(); console.log("ok   " + name); } catch (e) { fails++; console.log("FAIL " + name + ": " + e.message); } };
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m); };
const typeError = (fn, m) => { try { fn(); } catch (e) { if (e instanceof TypeError) return; throw new Error(m + ": it threw " + e.name); } throw new Error(m + ": it did not throw"); };
const rejects = async (p, m) => { try { await p; } catch { return; } throw new Error(m + ": it did not reject"); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gate-test-"));
process.env.OMNIKOM_QUOTA_DIR = tmp(); // no gate of a test reads or writes the quota folder of the machine
const NOW = Date.parse("2026-11-27T08:00:00Z");
const OUR_UA = "OmnikomAudit/1.0 (+https://omnikom.ai)";
const row = (id, kind, state, hosts, robotsAtRun = false) => ({ id, kind, engine: kind === "reader" ? null : "example", hosts, state, robotsAtRun });
const TABLE = () => ({ sources: [
  row("A1", "api", "allowed", ["api.example.test"]),
  row("A2", "api", "allowed", ["b.example.test"]),
  row("R1", "reader", "allowed", [], true),
  row("N1", "api", "not built", ["new.example.test"]),
  row("W1", "api", "waits", []),
  row("P1", "api", "parked", []),
  row("X1", "site", "barred", ["www.barred.test"]),
  row("L1", "api", "allowed", ["127.0.0.1"]),
  row("K1", "browser", "allowed", ["k.example.test"]),
] });
// a fetch of the test: answer(url, options) gives { status, body, headers } or { fail: true }; each call is kept in .calls
const net = (answer) => {
  const f = async (url, opts) => {
    f.calls.push({ url: String(url), opts });
    const a = answer(String(url), opts) || {};
    if (a.fail) throw new Error("the request failed");
    return new Response(a.body ?? "", { status: a.status || 200, headers: a.headers || {} });
  };
  f.calls = [];
  return f;
};
const mk = (answer, more = {}) => {
  const pewp = tmp(), stops = path.join(pewp, "stops"), quota = path.join(pewp, "quota"), f = net(answer);
  return { pewp, stops, quota, f, gate: makeGate({ pewp, run: "run-1", client: "vtv", sources: TABLE(), stopsDir: stops, quotaDir: quota, now: () => NOW, fetch: f, ...more }) };
};
const withRow = (id, more) => { const tb = TABLE(); Object.assign(tb.sources.find((r) => r.id === id), more); return tb; };
const clock = (t = NOW) => { const c = { t, slept: [] }; c.now = () => c.t; c.sleep = async (ms) => { c.slept.push(ms); c.t += ms; }; return c; };
const quotaFiles = (q) => (fs.existsSync(q) ? fs.readdirSync(q).sort() : []);
const lines = (pewp) => { try { return fs.readFileSync(path.join(pewp, "ledger", "requests.jsonl"), "utf8").split("\n").slice(0, -1).map((l) => JSON.parse(l)); } catch { return []; } };
const ask = (gate, source, url, more = {}) => gate.request({ driver: "test-driver", source, url, ...more });
const stopFiles = (stops) => (fs.existsSync(stops) ? fs.readdirSync(stops) : []);
const API = "https://api.example.test/v1/x?key=SECRET&q=1";
const ROBOTS = (body) => (url) => (url.endsWith("/robots.txt") ? { status: 200, body } : { status: 200, body: "page" });

await t("a request to an allowed source is sent, with one ledger line", async () => {
  const { gate, f, pewp } = mk(() => ({ status: 200, body: "hello", headers: { "x-test": "1" } }));
  const r = await ask(gate, "A1", API);
  eq([r.sent, r.status, r.result, r.body.toString(), r.headers["x-test"]], [true, 200, "read", "hello", "1"]);
  eq(f.calls.length, 1, "requests");
  eq([f.calls[0].url, f.calls[0].opts.method], [API, "GET"]);
  const l = lines(pewp);
  eq(l.length, 1, "lines");
  ok(Number.isInteger(l[0].ms) && l[0].ms >= 0, "ms is a count");
  eq({ ...l[0], ms: 0 }, { at: "2026-11-27T08:00:00.000Z", run: "run-1", client: "vtv", driver: "test-driver", source: "A1", host: "api.example.test", kind: "api", path: "/v1/x", params: ["key", "q"], signedIn: false, status: 200, result: "read", why: null, bytes: 5, ms: 0 });
  eq(r.line, l[0], "the line returned");
  ok(!JSON.stringify(l).includes("SECRET"), "a query value is in the ledger");
  const s = await ask(gate, "A1", API, { signedIn: true });
  eq([s.line.signedIn, lines(pewp).length], [true, 2], "signed in");
  const real = Date.now;
  let back = 0;
  Date.now = () => real() - back;
  try {
    const c = mk(() => { back = 60000; return { status: 200 }; });
    const r2 = await ask(c.gate, "A1", API);
    eq([r2.sent, r2.line.ms, lines(c.pewp).length], [true, 0, 1], "the clock of the machine went back during the request");
  } finally { Date.now = real; }
});

await t("each request carries our User-Agent and no other", async () => {
  eq(UA, OUR_UA);
  eq((await import("./research-lib.mjs")).UA, UA, "the one constant of the skill");
  const { gate, f } = mk(() => ({ status: 200 }));
  await ask(gate, "A1", API, { headers: { "User-Agent": "other/1.0", accept: "text/html" }, method: "POST", body: "x=1" });
  eq(f.calls[0].opts.headers, { accept: "text/html", "user-agent": OUR_UA });
  eq([f.calls[0].opts.method, f.calls[0].opts.body, f.calls[0].opts.redirect], ["POST", "x=1", "manual"]);
  ok(f.calls[0].opts.signal instanceof AbortSignal, "the request has no time limit");
});

await t("on the wire: the fixture server gets our User-Agent, and a redirect is not followed", async () => {
  const s = await serve((r) => (r.url === "/go" ? { status: 302, headers: { location: "/target" }, body: "" } : { status: 200, body: "page" }));
  try {
    const pewp = tmp();
    const gate = makeGate({ pewp, run: "run-1", client: "vtv", sources: TABLE(), stopsDir: path.join(pewp, "stops"), now: () => NOW });
    const r = await ask(gate, "L1", s.url + "/go", { headers: { "user-agent": "other/1.0" } });
    eq([r.sent, r.status, r.result, r.headers.location], [true, 302, "read", "/target"]);
    eq(s.reqs.map((q) => q.url), ["/go"], "the requests the server got");
    eq(s.reqs[0].headers["user-agent"], OUR_UA);
    eq(lines(pewp).map((l) => [l.path, l.status]), [["/go", 302]]);
  } finally { s.close(); }
});

await t("a source that is not in the table is not sent", async () => {
  const { gate, f, pewp } = mk(() => ({ status: 200 }));
  const r = await ask(gate, "ZZ9", API);
  eq([r.sent, r.why], [false, "unknown-source"]);
  eq(f.calls.length, 0, "requests");
  const l = lines(pewp);
  eq(l.length, 1, "lines");
  eq([l[0].source, l[0].kind, l[0].host, l[0].path, l[0].result, l[0].why, l[0].status, l[0].bytes, l[0].ms], ["ZZ9", null, "api.example.test", "/v1/x", "not sent", "unknown-source", null, null, null]);
  eq(r.line, l[0], "the line returned");
});

await t("a source that is not allowed is not sent", async () => {
  const { gate, f, pewp } = mk(() => ({ status: 200 }));
  const asked = [["N1", "https://new.example.test/a"], ["W1", "https://w.example.test/a"], ["P1", "https://p.example.test/a"], ["X1", "https://www.barred.test/a"]];
  for (const [id, url] of asked) { const r = await ask(gate, id, url); eq([id, r.sent, r.why], [id, false, "terms"]); }
  eq(f.calls.length, 0, "requests");
  eq(lines(pewp).map((l) => [l.source, l.kind, l.result, l.why]), [["N1", "api", "not sent", "terms"], ["W1", "api", "not sent", "terms"], ["P1", "api", "not sent", "terms"], ["X1", "site", "not sent", "terms"]]);
});

await t("a URL on a host that the source does not name is not sent", async () => {
  const { gate, f, pewp } = mk(() => ({ status: 200 }));
  for (const url of ["https://other.example.test/x", "https://sub.api.example.test/x", "https://b.example.test/x"]) { const r = await ask(gate, "A1", url); eq([url, r.sent, r.why], [url, false, "unknown-source"]); }
  eq(f.calls.length, 0, "requests");
  eq(lines(pewp).map((l) => [l.kind, l.why]), [["api", "unknown-source"], ["api", "unknown-source"], ["api", "unknown-source"]]);
});

await t("the reader does not read a barred site", async () => {
  const { gate, f, pewp } = mk((url) => (url.endsWith("/robots.txt") ? { status: 404 } : { status: 200, body: "page" }));
  for (const url of ["https://www.barred.test/p", "https://barred.test/p", "https://m.barred.test/p", "https://WWW.Barred.Test/p"]) { const r = await ask(gate, "R1", url); eq([url, r.sent, r.why], [url, false, "terms"]); }
  eq(f.calls.length, 0, "requests to a barred site");
  eq(lines(pewp).map((l) => [l.kind, l.why]), [["reader", "terms"], ["reader", "terms"], ["reader", "terms"], ["reader", "terms"]]);
  for (const url of ["https://notbarred.test/p", "https://barred.test.example/p"]) { const r = await ask(gate, "R1", url); eq([url, r.sent, r.status], [url, true, 200]); }
  eq(f.calls.length, 4, "requests to the two free sites");
});

await t("a stop on the host: the request is not sent", async () => {
  const { gate, f, pewp, stops } = mk(() => ({ status: 200 }));
  writeStop({ engine: "example", hosts: ["example.test"], reason: "a test stop", setBy: "test-gate", now: NOW, dir: stops });
  const r = await ask(gate, "A1", API);
  eq([r.sent, r.why], [false, "stop"]);
  eq(f.calls.length, 0, "requests");
  eq(lines(pewp).map((l) => [l.result, l.why]), [["not sent", "stop"]]);
  const b = mk(() => ({ status: 200 }));
  writeStop({ engine: "example", hosts: ["example.test"], until: NOW - 1000, reason: "a stop that ended", setBy: "test-gate", now: NOW - 5000, dir: b.stops });
  eq((await ask(b.gate, "A1", API)).sent, true, "a stop that ended");
});

await t("three 403 answers in a row skip the host, and no stop file is written", async () => {
  eq(REFUSALS, 3);
  const { gate, f, pewp, stops } = mk(() => ({ status: 403 }));
  for (let i = 1; i <= 3; i++) { const r = await ask(gate, "A1", API); eq([i, r.sent, r.status, r.result], [i, true, 403, "403"]); }
  const r4 = await ask(gate, "A1", API);
  eq([r4.sent, r4.why], [false, "refused"]);
  eq(f.calls.length, 3, "requests");
  eq(stopFiles(stops), [], "stop files");
  eq(lines(pewp).map((l) => [l.result, l.why]), [["403", null], ["403", null], ["403", null], ["not sent", "refused"]]);
});

await t("an answer that is not a 403 starts the count again, and each host has its own count", async () => {
  const seq = [403, 403, 200, 403, 403, 403];
  let i = 0;
  const { gate, f } = mk((url) => (url.includes("b.example.test") ? { status: 200 } : { status: seq[i++] }));
  for (let k = 0; k < 6; k++) eq([k, (await ask(gate, "A1", API)).sent], [k, true]);
  eq((await ask(gate, "A1", API)).why, "refused", "request 7");
  eq((await ask(gate, "A2", "https://b.example.test/x")).sent, true, "the other host");
  eq(f.calls.length, 7, "requests");
});

await t("a later gate of the same run starts from the ledger", async () => {
  const a = mk(() => ({ status: 403 }));
  for (let i = 0; i < 3; i++) await ask(a.gate, "A1", API);
  const f2 = net(() => ({ status: 200 }));
  const same = makeGate({ pewp: a.pewp, run: "run-1", client: "vtv", sources: TABLE(), stopsDir: a.stops, now: () => NOW, fetch: f2 });
  eq((await ask(same, "A1", API)).why, "refused", "the same run");
  eq(f2.calls.length, 0, "requests of the later gate");
  const other = makeGate({ pewp: a.pewp, run: "run-2", client: "vtv", sources: TABLE(), stopsDir: a.stops, now: () => NOW, fetch: f2 });
  eq((await ask(other, "A1", API)).sent, true, "another run");
  const b = mk(() => ({ status: 403 }));
  fs.mkdirSync(path.join(b.pewp, "ledger"));
  fs.writeFileSync(path.join(b.pewp, "ledger", "requests.jsonl"), '{"at":"2026-11-27T08:00\n');
  for (let i = 0; i < 3; i++) await ask(b.gate, "A1", API);
  const later = makeGate({ pewp: b.pewp, run: "run-1", client: "vtv", sources: TABLE(), stopsDir: b.stops, now: () => NOW, fetch: f2 });
  eq((await ask(later, "A1", API)).why, "refused", "a ledger with a line that cannot be read: the lines after it count");
});

await t("one 429 writes a stop file with the kind rate", async () => {
  const { gate, f, pewp, stops } = mk((url) => (url.includes("b.example.test") ? { status: 200 } : { status: 429 }));
  const r = await ask(gate, "A1", API);
  eq([r.sent, r.status, r.result], [true, 429, "429"]);
  const files = stopFiles(stops);
  eq(files, [stopEngine("api.example.test") + ".json"], "stop files");
  ok(/^api-example-test-[0-9a-f]{8}\.json$/.test(files[0]), "the name of the stop file: " + files[0]);
  const raw = fs.readFileSync(path.join(stops, files[0]), "utf8"), j = JSON.parse(raw);
  eq([j.kind, j.hosts, j.until, j.reason, j.setBy, j.evidence], ["rate", ["api.example.test"], "2026-11-28T08:00:00.000Z", "HTTP 429 from api.example.test", "lib-gate.mjs", "https://api.example.test/v1/x"]);
  ok(!raw.includes("SECRET"), "a query value is in the stop file");
  const r2 = await ask(gate, "A1", API);
  eq([r2.sent, r2.why], [false, "stop"]);
  eq((await ask(gate, "A2", "https://b.example.test/x")).sent, true, "the other host");
  eq(f.calls.length, 2, "requests");
  eq(lines(pewp).map((l) => [l.result, l.why]), [["429", null], ["not sent", "stop"], ["read", null]]);
});

await t("robots.txt: the reader asks it once for each site and obeys it", async () => {
  const { gate, f, pewp } = mk(ROBOTS("User-agent: *\nDisallow: /private\n"));
  const r1 = await ask(gate, "R1", "https://site.test/private/a");
  eq([r1.sent, r1.why], [false, "robots"]);
  eq((await ask(gate, "R1", "https://site.test/open")).sent, true);
  eq((await ask(gate, "R1", "https://site.test/open2?x=1")).sent, true);
  eq(f.calls.map((c) => c.url), ["https://site.test/robots.txt", "https://site.test/open", "https://site.test/open2?x=1"]);
  eq(f.calls.map((c) => c.opts.headers["user-agent"]), [OUR_UA, OUR_UA, OUR_UA]);
  eq(lines(pewp).map((l) => [l.source, l.driver, l.kind, l.path, l.result, l.why]), [["R1", "test-driver", "reader", "/robots.txt", "read", null], ["R1", "test-driver", "reader", "/private/a", "not sent", "robots"], ["R1", "test-driver", "reader", "/open", "read", null], ["R1", "test-driver", "reader", "/open2", "read", null]]);
  await ask(gate, "R1", "https://other.test/x");
  eq(f.calls.map((c) => c.url).slice(3), ["https://other.test/robots.txt", "https://other.test/x"], "a second site");
  const a = mk(() => ({ status: 200 }));
  await ask(a.gate, "A1", API);
  eq(a.f.calls.map((c) => c.url), [API], "an API source asks no robots.txt");
});

await t("robots.txt: the group with our name wins over the star, and the longer rule wins", async () => {
  const { gate } = mk(ROBOTS("User-agent: OmnikomAudit\nDisallow: /a\nAllow: /a/open\n\nUser-agent: *\nDisallow: /b\n"));
  eq((await ask(gate, "R1", "https://site.test/a/x")).why, "robots");
  eq((await ask(gate, "R1", "https://site.test/a/open/x")).sent, true);
  eq((await ask(gate, "R1", "https://site.test/b/x")).sent, true, "the star group is not ours");
  const al = (txt, p) => robotsAllows(parseRobots(txt), p);
  eq(al("User-agent: *\nDisallow: /b\n", "/b/x"), false);
  eq(al("User-agent: *\nDisallow: /b\n", "/c"), true);
  eq(al("", "/x"), true, "an empty file");
  eq(al("User-agent: *\nDisallow:\n", "/x"), true, "an empty Disallow");
  eq(al("User-agent: other\nDisallow: /\n", "/x"), true, "a group for another reader");
  eq(al("# note\nUSER-AGENT: *   # all\nDISALLOW: /s?q=\n", "/s?q=1"), false, "a rule with a query");
  eq(al("User-agent: *\nDisallow: /s?q=\n", "/s"), true);
  eq(al("User-agent: *\nDisallow: /*.pdf$\n", "/a/b.pdf"), false, "a star and an end mark");
  eq(al("User-agent: *\nDisallow: /*.pdf$\n", "/a/b.pdfx"), true);
  eq(al("User-agent: *\nDisallow: /a\nAllow: /a\n", "/a"), true, "the same length: allow wins");
  eq(al("User-agent: a\nUser-agent: omnikomaudit\nDisallow: /z\n", "/z"), false, "two names for one group");
  eq(al("User-agent: *\r\nDisallow: /w\r\n", "/w"), false, "a file with Windows line ends");
});

await t("robots.txt that cannot be read: a 404 allows; a 403, a 500, a 429 and a failed request do not", async () => {
  const a = mk((url) => (url.endsWith("/robots.txt") ? { status: 404 } : { status: 200 }));
  eq((await ask(a.gate, "R1", "https://site.test/p")).sent, true, "404");
  const b = mk((url) => (url.endsWith("/robots.txt") ? { status: 500 } : { status: 200 }));
  eq((await ask(b.gate, "R1", "https://site.test/p")).why, "robots", "500");
  eq((await ask(b.gate, "R1", "https://site.test/q")).why, "robots", "500, the second page");
  eq(b.f.calls.map((c) => c.url), ["https://site.test/robots.txt"], "500: the requests");
  eq(lines(b.pewp).map((l) => [l.path, l.status, l.result, l.why]), [["/robots.txt", 500, "error", null], ["/p", null, "not sent", "robots"], ["/q", null, "not sent", "robots"]]);
  const c = mk((url) => (url.endsWith("/robots.txt") ? { fail: true } : { status: 200 }));
  eq((await ask(c.gate, "R1", "https://site.test/p")).why, "robots", "a failed request");
  eq(c.f.calls.length, 1, "a failed request: the requests");
  const d = mk((url) => (url.endsWith("/robots.txt") ? { status: 429 } : { status: 200 }));
  eq((await ask(d.gate, "R1", "https://site.test/p")).why, "robots", "429");
  eq(stopFiles(d.stops), [stopEngine("site.test") + ".json"], "429: the stop file");
  eq((await ask(d.gate, "R1", "https://site.test/q")).why, "stop", "429, the second page");
  eq(d.f.calls.length, 1, "429: the requests");
  for (const status of [401, 403]) {
    const e = mk((url) => (url.endsWith("/robots.txt") ? { status } : { status: 200 }));
    eq((await ask(e.gate, "R1", "https://site.test/p")).why, "robots", String(status));
    eq(e.f.calls.length, 1, status + ": the requests");
  }
  const g = mk((url) => (url.endsWith("/robots.txt") ? { status: 410 } : { status: 200 }));
  eq((await ask(g.gate, "R1", "https://site.test/p")).sent, true, "410");
});

await t("robots.txt that moves is followed, five times at most, and never to a barred site", async () => {
  eq(ROBOTS_HOPS, 5);
  const moved = (to) => ({ status: 301, headers: { location: to } });
  const a = mk((url) => (url === "https://site.test/robots.txt" ? moved("https://www.site.test/robots.txt") : url === "https://www.site.test/robots.txt" ? { status: 200, body: "User-agent: *\nDisallow: /private\n" } : { status: 200, body: "page" }));
  eq((await ask(a.gate, "R1", "https://site.test/private/a")).why, "robots", "the rules of the new place hold for the site that was asked");
  eq((await ask(a.gate, "R1", "https://site.test/open")).sent, true);
  eq(a.f.calls.map((c) => c.url), ["https://site.test/robots.txt", "https://www.site.test/robots.txt", "https://site.test/open"]);
  eq(lines(a.pewp).map((l) => [l.host, l.path, l.status, l.result, l.why]), [["site.test", "/robots.txt", 301, "read", null], ["www.site.test", "/robots.txt", 200, "read", null], ["site.test", "/private/a", null, "not sent", "robots"], ["site.test", "/open", 200, "read", null]]);
  const b = mk((url) => (url === "https://site.test/robots.txt" ? moved("/r2.txt") : url === "https://site.test/r2.txt" ? { status: 200, body: "User-agent: *\nDisallow: /private\n" } : { status: 200 }));
  eq((await ask(b.gate, "R1", "https://site.test/private/a")).why, "robots", "a place with no host name");
  eq(b.f.calls.map((c) => c.url), ["https://site.test/robots.txt", "https://site.test/r2.txt"]);
  const c = mk((url) => (url === "https://site.test/robots.txt" ? moved("https://www.barred.test/robots.txt") : { status: 200 }));
  eq((await ask(c.gate, "R1", "https://site.test/p")).why, "robots", "a move to a barred site");
  eq(c.f.calls.map((x) => x.url), ["https://site.test/robots.txt"], "a move to a barred site: the requests");
  eq(lines(c.pewp).map((l) => [l.host, l.result, l.why]), [["site.test", "read", null], ["www.barred.test", "not sent", "terms"], ["site.test", "not sent", "robots"]]);
  let k = 0;
  const d = mk((url) => (url.includes("robots") ? moved("https://site.test/robots-" + ++k + ".txt") : { status: 200 }));
  eq((await ask(d.gate, "R1", "https://site.test/p")).why, "robots", "a move with no end");
  eq(d.f.calls.length, 6, "a move with no end: the requests");
  const e = mk((url) => (url.endsWith("/robots.txt") ? { status: 301 } : { status: 200 }));
  eq((await ask(e.gate, "R1", "https://site.test/p")).why, "robots", "a move that names no place");
  const g = mk((url) => (url.endsWith("/robots.txt") ? moved("ftp://site.test/robots.txt") : { status: 200 }));
  eq((await ask(g.gate, "R1", "https://site.test/p")).why, "robots", "a move to a place that is not http");
  eq(g.f.calls.length, 1, "a move to a place that is not http: the requests");
  const h = mk((url) => (url.endsWith("/robots.txt") ? moved("http://[") : { status: 200 }));
  eq((await ask(h.gate, "R1", "https://site.test/p")).why, "robots", "a move to a place that cannot be read");
  eq(h.f.calls.length, 1, "a move to a place that cannot be read: the requests");
});

await t("a request that fails gives one line with the result error, and the count of 403 stays", async () => {
  const seq = [{ status: 403 }, { status: 403 }, { fail: true }, { status: 403 }];
  let i = 0;
  const { gate, f, pewp } = mk(() => seq[i++]);
  await ask(gate, "A1", API); await ask(gate, "A1", API);
  const r = await ask(gate, "A1", API);
  eq([r.sent, r.status, r.result, r.error], [true, null, "error", "Error"]);
  eq((await ask(gate, "A1", API)).status, 403, "request 4");
  eq((await ask(gate, "A1", API)).why, "refused", "request 5");
  eq(f.calls.length, 4, "requests");
  const l = lines(pewp);
  eq([l[2].result, l[2].status, l[2].bytes, l[2].why], ["error", null, null, null]);
  ok(Number.isInteger(l[2].ms) && l[2].ms >= 0, "ms is a count");
  eq(r.line, l[2], "the line returned");
  const b = mk(() => ({ status: 503, body: "down" }));
  const r5 = await ask(b.gate, "A1", API);
  eq([r5.sent, r5.status, r5.result], [true, 503, "error"]);
  eq(lines(b.pewp).map((x) => [x.status, x.result, x.bytes]), [[503, "error", 4]]);
});

await t("makeGate and request refuse a call that is not well formed", async () => {
  const good = () => ({ pewp: tmp(), run: "run-1", client: "vtv", sources: TABLE() });
  makeGate(good());
  typeError(() => makeGate(), "no argument");
  for (const k of ["pewp", "run", "client", "sources"]) typeError(() => makeGate({ ...good(), [k]: undefined }), "no " + k);
  typeError(() => makeGate({ ...good(), pewp: "" }), "an empty pewp");
  typeError(() => makeGate({ ...good(), sources: { sources: "x" } }), "sources that is not a table");
  typeError(() => makeGate({ ...good(), now: 5 }), "now that is not a function");
  typeError(() => makeGate({ ...good(), fetch: 5 }), "fetch that is not a function");
  const { gate, f, pewp } = mk(() => ({ status: 200 }));
  await rejects(ask(gate, "A1", "not a url"), "a URL that cannot be read");
  await rejects(ask(gate, "A1", "ftp://api.example.test/x"), "a URL that is not http");
  eq([f.calls.length, lines(pewp).length], [0, 0], "requests and lines");
});

await t("no request goes out when the ledger would refuse its line", async () => {
  const { gate, f, pewp } = mk(() => ({ status: 200 }));
  await rejects(ask(gate, "A1", API, { driver: "bad name" }), "a driver name that the ledger refuses");
  await rejects(ask(gate, "A1", API, { signedIn: "yes" }), "signedIn that is not true or false");
  await rejects(ask(gate, "K1", "https://k.example.test/x"), "a row with a kind that the ledger refuses");
  await rejects(ask(gate, "R1", "https://site.test/p", { driver: "bad name" }), "robots.txt for a call that the ledger refuses");
  eq([f.calls.length, lines(pewp).length], [0, 0], "requests and lines");
  const b = mk(() => ({ status: 200 }), { run: "a b" });
  await rejects(ask(b.gate, "A1", API), "a run name that the ledger refuses");
  eq(b.f.calls.length, 0, "a run name that the ledger refuses: the requests");
  eq((await ask(gate, "A1", API)).sent, true, "the gate works on after a refused call");
});

await t("the table of the skill: readSources reads it, and a row that is not allowed is not sent", async () => {
  const table = readSources();
  const closed = table.sources.filter((r) => r.state !== "allowed");
  ok(closed.length >= 20, "rows that are not allowed: " + closed.length);
  const { gate, f, pewp } = mk(() => ({ status: 200 }), { sources: table });
  for (const r of closed) { const a = await ask(gate, r.id, "https://" + (r.hosts[0] || "example.test") + "/x"); eq([r.id, a.sent, a.why], [r.id, false, "terms"]); }
  eq(f.calls.length, 0, "requests");
  eq(lines(pewp).map((l) => l.source), closed.map((r) => r.id), "one line for each row");
});

const DAY = 86400000;
const limited = (limits) => withRow("A1", { limits });
const sentOk = async (gate, why, source = "A1", url = API) => { const r = await ask(gate, source, url); eq(r.sent, true, why); return r; };
const notSentLimit = async (gate, pewp, why) => {
  const r = await ask(gate, "A1", API), l = lines(pewp).at(-1);
  eq([r.sent, r.why, l.result, l.why, l.status], [false, "limit", "not sent", "limit", null], why);
};

await t("a row with a pace or a limit that is not well formed is refused when the gate is made", async () => {
  const bad = [{ paceMs: -1 }, { paceMs: 1.5 }, { paceMs: "100" }, { limits: "2" }, { limits: [{ count: 0, per: "minute" }] }, { limits: [{ count: 2 }] },
    { limits: [{ count: 2, per: "week" }] }, { limits: [{ count: 2, per: "day" }, { count: 3, per: "day" }] }];
  const make = (sources) => mk(() => ({}), { sources });
  for (const x of bad) typeError(() => make(withRow("A1", x)), JSON.stringify(x));
  typeError(() => make(withRow("R1", { limits: [{ count: 2, per: "run" }] })), "a limit on a row with robotsAtRun");
  make(withRow("A1", { paceMs: 0, limits: [] }));
  make(withRow("A1", { paceMs: null, limits: null }));
  make(withRow("R1", { paceMs: 500, limits: [] }));
  make(readSources());
});

await t("a source at the limit of its window is not sent, and the line says limit", async () => {
  const { gate, f, pewp, stops, quota } = mk(() => ({ status: 200 }), { sources: limited([{ count: 2, per: "minute" }]) });
  await sentOk(gate, "ask 1"); await sentOk(gate, "ask 2");
  await notSentLimit(gate, pewp, "ask 3");
  eq([f.calls.length, lines(pewp).length], [2, 3], "requests and lines");
  eq(quotaFiles(quota), ["A1.2026-11-27.hits"]);
  eq(fs.readFileSync(path.join(quota, "A1.2026-11-27.hits"), "utf8").split("\n").slice(0, -1).length, 2, "hits");
  eq(stopFiles(stops), []);
});

await t("the window passes and the source opens again", async () => {
  const c = clock();
  const a = mk(() => ({ status: 200 }), { sources: limited([{ count: 2, per: "minute" }]), now: c.now, sleep: c.sleep });
  await sentOk(a.gate, "ask 1"); await sentOk(a.gate, "ask 2");
  c.t += 59999; await notSentLimit(a.gate, a.pewp, "before the minute ends");
  c.t += 1; await sentOk(a.gate, "after the minute");
  const h = clock();
  const b = mk(() => ({ status: 200 }), { sources: limited([{ count: 1, per: "hour" }]), now: h.now, sleep: h.sleep });
  await sentOk(b.gate, "hour: ask 1");
  h.t += 3599999; await notSentLimit(b.gate, b.pewp, "before the hour ends");
  h.t += 1; await sentOk(b.gate, "after the hour");
});

await t("the count of a window is one for each gate and each run on the machine", async () => {
  const shared = tmp(), sources = limited([{ count: 2, per: "day" }]);
  const a = mk(() => ({ status: 200 }), { sources, quotaDir: shared });
  const b = mk(() => ({ status: 200 }), { sources, quotaDir: shared, run: "run-2" });
  await sentOk(a.gate, "gate 1"); await sentOk(b.gate, "gate 2");
  await notSentLimit(a.gate, a.pewp, "gate 1 again");
  await notSentLimit(b.gate, b.pewp, "gate 2 again");
});

await t("a day window reads the file of the day before", async () => {
  const c = clock(Date.parse("2026-11-26T23:50:00Z"));
  const { gate, pewp, quota } = mk(() => ({ status: 200 }), { sources: limited([{ count: 1, per: "day" }]), now: c.now, sleep: c.sleep });
  await sentOk(gate, "ask 1");
  eq(quotaFiles(quota), ["A1.2026-11-26.hits"]);
  c.t = Date.parse("2026-11-27T00:10:00Z"); await notSentLimit(gate, pewp, "the next date, inside the day");
  c.t = Date.parse("2026-11-27T23:50:00Z"); await sentOk(gate, "after the day");
  eq(quotaFiles(quota), ["A1.2026-11-26.hits", "A1.2026-11-27.hits"]);
});

await t("a request is counted when it goes out, also when it fails; a request that is not sent is not counted", async () => {
  const { gate, f, pewp } = mk(() => ({ fail: true }), { sources: limited([{ count: 1, per: "minute" }]) });
  const o = await ask(gate, "A1", "https://other.example.test/x");
  eq([o.sent, o.why], [false, "unknown-source"]);
  eq((await sentOk(gate, "the first ask")).result, "error");
  await notSentLimit(gate, pewp, "after the failed request");
  eq(f.calls.length, 1, "requests");
});

await t("a limit for the run counts the requests of the run, also those of an earlier gate", async () => {
  const sources = limited([{ count: 2, per: "run" }]);
  const a = mk(() => ({ status: 200 }), { sources });
  await sentOk(a.gate, "ask 1"); await sentOk(a.gate, "ask 2");
  await notSentLimit(a.gate, a.pewp, "ask 3");
  eq(quotaFiles(a.quota), []);
  const again = (run) => mk(() => ({ status: 200 }), { sources, pewp: a.pewp, run }).gate;
  await notSentLimit(again("run-1"), a.pewp, "a later gate of the run");
  await sentOk(again("run-2"), "another run");
  const b = mk(() => ({ status: 200 }), { sources });
  await sentOk(b.gate, "one request of the run");
  const off = await ask(b.gate, "A1", "https://other.example.test/x");
  eq([off.sent, off.why], [false, "unknown-source"], "a line that is not sent");
  await sentOk(mk(() => ({ status: 200 }), { sources, pewp: b.pewp }).gate, "a later gate does not count a line that was not sent");
});

await t("two requests to one host are not closer than the pace of the row", async () => {
  const c = clock();
  const { gate } = mk(() => ({ status: 200 }), { sources: withRow("A1", { paceMs: 1000 }), now: c.now, sleep: c.sleep });
  await sentOk(gate, "ask 1"); eq(c.slept, []);
  c.t += 400; await sentOk(gate, "ask 2"); eq(c.slept, [600]);
  c.t += 1000; await sentOk(gate, "ask 3"); eq(c.slept, [600]);
  const at = [];
  const own = mk(() => { at.push(Date.now()); return { status: 200 }; }, { now: undefined, sleep: undefined, sources: withRow("A1", { paceMs: 40 }) });
  await sentOk(own.gate, "own timer 1"); await sentOk(own.gate, "own timer 2");
  ok(at[1] - at[0] >= 30, "the own timer: " + (at[1] - at[0]) + " ms");
});

await t("the pace is for each host, and a robots.txt read keeps it too", async () => {
  const c = clock();
  const { gate, f } = mk(ROBOTS("User-agent: *\nAllow: /"), { sources: withRow("R1", { paceMs: 1000 }), now: c.now, sleep: c.sleep });
  await sentOk(gate, "host one", "R1", "https://one.example.test/a"); eq(c.slept, [1000]);
  await sentOk(gate, "host two", "R1", "https://two.example.test/a"); eq(c.slept, [1000, 1000]);
  eq(f.calls.length, 4, "requests");
});

await t("a robot check that the driver names writes a stop with the kind check", async () => {
  const { gate, f, pewp, stops, quota } = mk(() => ({ status: 200, body: "challenge" }));
  const more = { sort: () => ({ result: "check" }) };
  const r = await ask(gate, "A1", API, more);
  eq([r.sent, r.status, r.result], [true, 200, "check"]);
  eq([lines(pewp)[0].result, lines(pewp)[0].status], ["check", 200]);
  eq(stopFiles(stops).length, 1, "stop files");
  const s = JSON.parse(fs.readFileSync(path.join(stops, stopFiles(stops)[0]), "utf8"));
  eq([s.kind, s.hosts, s.evidence], ["check", ["api.example.test"], "https://api.example.test/v1/x"]);
  eq(quotaFiles(quota), []);
  const again = await ask(gate, "A1", API, more);
  eq([again.sent, again.why], [false, "stop"]);
  eq(f.calls.length, 1, "requests");
});

await t("a quota answer that the driver names holds the source for each run, and writes no stop", async () => {
  const shared = tmp(), more = { sort: () => ({ result: "quota" }) };
  const a = mk(() => ({ status: 403 }), { quotaDir: shared });
  const b = mk(() => ({ status: 403 }), { quotaDir: shared, run: "run-2" });
  const r = await ask(a.gate, "A1", API, more);
  eq([r.sent, r.status, r.result, r.until], [true, 403, "quota", NOW + DAY]);
  eq(lines(a.pewp)[0].result, "quota");
  eq(stopFiles(a.stops), []);
  eq(quotaFiles(shared), ["A1.hold.json"]);
  const h = JSON.parse(fs.readFileSync(path.join(shared, "A1.hold.json"), "utf8"));
  eq([h.source, h.until, h.setBy, h.evidence], ["A1", NOW + DAY, "lib-gate.mjs", "https://api.example.test/v1/x"]);
  await notSentLimit(a.gate, a.pewp, "gate 1 again");
  await notSentLimit(b.gate, b.pewp, "gate 2");
  eq([a.f.calls.length, b.f.calls.length], [1, 0], "requests");
});

await t("the hold ends at the time the driver gives, else after the longest window of the row", async () => {
  const c = clock();
  let i = 0;
  const a = mk(() => ({ status: i++ ? 200 : 403 }), { now: c.now, sleep: c.sleep });
  const more = { sort: (x) => (x.status === 403 ? { result: "quota", until: NOW + 5000 } : null) };
  const r = await ask(a.gate, "A1", API, more);
  eq([r.result, r.until], ["quota", NOW + 5000]);
  c.t = NOW + 4999; await notSentLimit(a.gate, a.pewp, "before the time of the driver");
  c.t = NOW + 5000;
  const s = await ask(a.gate, "A1", API, more);
  eq([s.sent, s.result], [true, "read"]);
  const b = mk(() => ({ status: 403 }), { sources: limited([{ count: 100, per: "minute" }, { count: 1000, per: "hour" }]) });
  const q = await ask(b.gate, "A1", API, { sort: () => ({ result: "quota" }) });
  eq([q.until, JSON.parse(fs.readFileSync(path.join(b.quota, "A1.hold.json"), "utf8")).until], [NOW + 3600000, NOW + 3600000]);
});

await t("a hold file that cannot be read holds for 24 hours from its writing", async () => {
  for (const text of ["{not json", '{"until":"soon"}']) {
    const c = clock();
    const { gate, pewp, quota } = mk(() => ({ status: 200 }), { now: c.now, sleep: c.sleep });
    fs.mkdirSync(quota, { recursive: true });
    const file = path.join(quota, "A1.hold.json");
    fs.writeFileSync(file, text);
    fs.utimesSync(file, new Date(NOW), new Date(NOW));
    c.t = NOW + DAY - 1; await notSentLimit(gate, pewp, text + ": before the 24 hours end");
    c.t = NOW + DAY; await sentOk(gate, text + ": after 24 hours");
  }
});

await t("a refused key and a sign-in wall write no stop, and neither counts as a 403", async () => {
  const key = { sort: () => ({ result: "key" }) };
  const forbid = () => ({ status: 403 });
  const a = mk(forbid);
  for (let i = 0; i < 4; i++) { const r = await ask(a.gate, "A1", API, key); eq([r.sent, r.result], [true, "key"], "ask " + i); }
  eq(lines(a.pewp).map((l) => l.result), ["key", "key", "key", "key"]);
  eq([stopFiles(a.stops), quotaFiles(a.quota)], [[], []]);
  eq((await ask(mk(() => ({ status: 200 })).gate, "A1", API, { sort: () => ({ result: "sign-in" }) })).result, "sign-in");
  const b = mk(forbid);
  const seq = [];
  for (const more of [{}, {}, key, {}]) seq.push((await ask(b.gate, "A1", API, more)).result);
  eq(seq, ["403", "403", "key", "403"]);
  const last = await ask(b.gate, "A1", API);
  eq([last.sent, last.why], [false, "refused"]);
  const c = mk(forbid);
  for (const more of [{}, {}, key]) await ask(c.gate, "A1", API, more);
  const later = mk(forbid, { pewp: c.pewp }).gate;
  const one = await ask(later, "A1", API);
  eq([one.sent, one.result], [true, "403"], "the later gate");
  const two = await ask(later, "A1", API);
  eq([two.sent, two.why], [false, "refused"], "the later gate, again");
});

await t("a 429 is never sorted: the gate writes its stop, and the sorter is not asked", async () => {
  let asked = 0;
  const more = { sort: () => { asked++; return { result: "key" }; } };
  const { gate, stops } = mk((url) => ({ status: url.includes("b.example.test") ? 200 : 429 }));
  eq((await ask(gate, "A2", "https://b.example.test/x", more)).result, "key");
  eq(asked, 1);
  eq((await ask(gate, "A1", API, more)).result, "429");
  eq([asked, stopFiles(stops).length], [1, 1]);
  eq(JSON.parse(fs.readFileSync(path.join(stops, stopFiles(stops)[0]), "utf8")).kind, "rate");
});

await t("a sorter that throws or gives another value: the line says error, and nothing else is written", async () => {
  const bad = [() => "read", () => ({ result: "read" }), () => ({ result: "429" }), () => 5, () => ({ result: "quota", until: NOW }), () => { throw new Error("x"); }];
  for (const [i, sort] of bad.entries()) {
    const { gate, pewp, stops, quota } = mk(() => ({ status: 403 }));
    const r = await ask(gate, "A1", API, { sort });
    eq([r.sent, r.status, r.result, r.error], [true, 403, "error", "sort"], "sorter " + i);
    eq([lines(pewp)[0].result, lines(pewp)[0].status, stopFiles(stops), quotaFiles(quota)], ["error", 403, [], []], "sorter " + i);
  }
  const { gate } = mk(() => ({ status: 403 }));
  for (let i = 0; i < 3; i++) await ask(gate, "A1", API, { sort: () => 5 });
  const four = await ask(gate, "A1", API);
  eq([four.sent, four.why], [false, "refused"]);
});

await t("the sorter sees the status, the headers and the body, and null keeps the gate's own result", async () => {
  const seen = [], more = { sort: (a) => { seen.push(a); return null; } };
  const { gate } = mk(() => ({ status: 403, body: "no", headers: { "x-reason": "daily" } }));
  eq((await ask(gate, "A1", API, more)).result, "403");
  eq(seen.length, 1);
  eq([seen[0].status, seen[0].headers["x-reason"], Buffer.isBuffer(seen[0].body), String(seen[0].body)], [403, "daily", true, "no"]);
  await ask(gate, "A1", API, more); await ask(gate, "A1", API, more);
  const r = await ask(gate, "A1", API, more);
  eq([r.sent, r.why], [false, "refused"]);
  eq((await ask(mk(() => ({ status: 200 })).gate, "A1", API, { sort: () => undefined })).result, "read");
});

await t("the sorter is not asked for a robots.txt read", async () => {
  let asked = 0;
  const { gate, f } = mk(ROBOTS("User-agent: *\nAllow: /"));
  const r = await ask(gate, "R1", "https://one.example.test/a", { sort: () => { asked++; return null; } });
  eq([r.sent, f.calls.length, asked], [true, 2, 1]);
});

await t("makeGate and request refuse a sleep, a quota folder or a sorter that is not well formed", async () => {
  for (const more of [{ sleep: 5 }, { quotaDir: "" }, { quotaDir: 5 }]) typeError(() => mk(() => ({}), more), JSON.stringify(more));
  const { gate, f, pewp } = mk(() => ({ status: 200 }));
  await rejects(ask(gate, "A1", API, { sort: "x" }), "a sorter that is not a function");
  await rejects(ask(gate, "A1", API, { sort: null }), "a sorter that is null");
  eq([lines(pewp).length, f.calls.length], [0, 0], "lines and requests");
});

await t("the time limit of a request starts after the pace wait", async () => {
  const seen = [];
  const own = mk((url, opts) => { seen.push(opts.signal.aborted); return { status: 200 }; }, { now: undefined, sleep: undefined, sources: withRow("A1", { paceMs: 80 }) });
  const a = await ask(own.gate, "A1", API, { timeoutMs: 20 }), b = await ask(own.gate, "A1", API, { timeoutMs: 20 });
  eq([a.result, b.result, seen], ["read", "read", [false, false]]);
});

await t("a sorter that gives a Promise is another value, and its rejection does not end the run", async () => {
  const loose = [], keep = (e) => loose.push(String(e?.message));
  process.on("unhandledRejection", keep);
  try {
    for (const sort of [async () => ({ result: "key" }), async () => { throw new Error("late"); }]) {
      const { gate, pewp, stops, quota } = mk(() => ({ status: 200 }));
      const r = await ask(gate, "A1", API, { sort });
      eq([r.sent, r.status, r.result, r.error], [true, 200, "error", "sort"]);
      eq([lines(pewp).length, stopFiles(stops), quotaFiles(quota)], [1, [], []]);
    }
    await new Promise((done) => setTimeout(done, 20));
    eq(loose, [], "rejections that nobody handled");
  } finally { process.off("unhandledRejection", keep); }
});

// ---- the mutants: one broken copy of the library for each rule (node scripts/test-gate.mjs --mutants) ----
// A mutant is one change of the text of lib-gate.mjs: "from" is found one time in the file, and "to" takes its place. The scripts
// folder and sources.json are copied to a temp folder one time; each mutant is written there and this test runs on it. The test
// of the rule must turn red. The test of G16 must stay green (for G16: the test of G1), so a copy that does not load does not count.
const RULES = [
  ["G1", "a source that is not in the table is not sent"],
  ["G2", "a source that is not allowed is not sent"],
  ["G3", "a URL on a host that the source does not name is not sent"],
  ["G4", "the reader does not read a barred site"],
  ["G5", "a stop on the host: the request is not sent"],
  ["G6", "three 403 answers in a row skip the host, and no stop file is written"],
  ["G7", "an answer that is not a 403 starts the count again, and each host has its own count"],
  ["G8", "a later gate of the same run starts from the ledger"],
  ["G9", "one 429 writes a stop file with the kind rate"],
  ["G10", "robots.txt: the reader asks it once for each site and obeys it"],
  ["G11", "robots.txt: the group with our name wins over the star, and the longer rule wins"],
  ["G12", "robots.txt that cannot be read: a 404 allows; a 403, a 500, a 429 and a failed request do not"],
  ["G13", "robots.txt that moves is followed, five times at most, and never to a barred site"],
  ["G14", "each request carries our User-Agent and no other"],
  ["G15", "on the wire: the fixture server gets our User-Agent, and a redirect is not followed"],
  ["G16", "a request to an allowed source is sent, with one ledger line"],
  ["G17", "a request that fails gives one line with the result error, and the count of 403 stays"],
  ["G18", "makeGate and request refuse a call that is not well formed"],
  ["G19", "no request goes out when the ledger would refuse its line"],
  ["G20", "a row with a pace or a limit that is not well formed is refused when the gate is made"],
  ["G21", "a source at the limit of its window is not sent, and the line says limit"],
  ["G22", "the window passes and the source opens again"],
  ["G23", "the count of a window is one for each gate and each run on the machine"],
  ["G24", "a day window reads the file of the day before"],
  ["G25", "a request is counted when it goes out, also when it fails; a request that is not sent is not counted"],
  ["G26", "a limit for the run counts the requests of the run, also those of an earlier gate"],
  ["G27", "two requests to one host are not closer than the pace of the row"],
  ["G28", "the pace is for each host, and a robots.txt read keeps it too"],
  ["G29", "a robot check that the driver names writes a stop with the kind check"],
  ["G30", "a quota answer that the driver names holds the source for each run, and writes no stop"],
  ["G31", "the hold ends at the time the driver gives, else after the longest window of the row"],
  ["G32", "a hold file that cannot be read holds for 24 hours from its writing"],
  ["G33", "a refused key and a sign-in wall write no stop, and neither counts as a 403"],
  ["G34", "a 429 is never sorted: the gate writes its stop, and the sorter is not asked"],
  ["G35", "a sorter that throws or gives another value: the line says error, and nothing else is written"],
  ["G36", "the sorter sees the status, the headers and the body, and null keeps the gate's own result"],
  ["G37", "the sorter is not asked for a robots.txt read"],
  ["G38", "makeGate and request refuse a sleep, a quota folder or a sorter that is not well formed"],
  ["G39", "the time limit of a request starts after the pace wait"],
  ["G40", "a sorter that gives a Promise is another value, and its rejection does not end the run"],
];
// MUTANTS-BEGIN (the builder fills this list: one entry for each rule id, { from, to }. Nothing outside the two marks changes.)
const MUTANTS = {
  G1: { from: "if (!row) return notSent(entry, \"unknown-source\");", to: "if (!row) return notSent({ ...entry, kind: \"api\" }, \"terms\");" },
  G2: { from: "if (row.state !== \"allowed\")", to: "if (row.state === \"barred\")" },
  G3: { from: "else if (!(row.hosts || []).includes(host))", to: "else if (!host)" },
  G4: { from: "if (isBarred(host)) return \"terms\";", to: "if (!host) return \"terms\";" },
  G5: { from: "if (isStopped(host, now(), stopsDir)) return \"stop\";", to: "if (!host) return \"stop\";" },
  G6: { from: "(refusals.get(host) || 0) >= REFUSALS", to: "(refusals.get(host) || 0) >= 1e9" },
  G7: { from: "status === 403 ? (refusals.get(host) || 0) + 1 : 0", to: "(refusals.get(host) || 0) + (status === 403 ? 1 : 0)" },
  G8: { from: "line?.run === run &&", to: "line?.run === \"\" &&" },
  G9: { from: "if (res?.status === 429) writeStop", to: "if (res?.status === 999) writeStop" },
  G10: { from: "rules === null || !robotsAllows(rules, u.pathname + u.search)", to: "rules === null" },
  G11: { from: "x.agents.includes(ROBOTS_NAME)", to: "x.agents.includes(\"nobody\")" },
  G12: { from: "[401, 403, 429].includes", to: "[401, 429].includes" },
  G13: { from: "moves >= ROBOTS_HOPS", to: "moves >= ROBOTS_HOPS + 1" },
  G14: { from: "\"user-agent\": UA }", to: "\"user-agent\": \"other/1.0\" }" },
  G15: { from: "redirect: \"manual\"", to: "redirect: \"follow\"" },
  G16: { from: "bytes: data.length, ms", to: "bytes: data.length + 1, ms" },
  G17: { from: "answer = { sent: true, status: null,", to: "refusals.delete(host);\n      answer = { sent: true, status: null," },
  G18: { from: "typeof now !== \"function\" || typeof doFetch", to: "typeof doFetch" },
  G19: { from: "lineOf({ ...entry, result: \"error\" }, now()); // check 7: a line the ledger refuses means no request", to: "" },
  G20: { from: "if (r.robotsAtRun === true && limits.length)", to: "if (!r.id && limits.length)" },
  G21: { from: ".length) >= most", to: ".length) >= most + 1" },
  G22: { from: "at - t < WINDOWS[per]", to: "at - t <= WINDOWS[per]" },
  G23: { from: "encodeURIComponent(id) + \".\" + end", to: "encodeURIComponent(id) + \".\" + run + end" },
  G24: { from: "[at - DAY, at]", to: "[at]" },
  G25: { from: "error = String(e?.name); }", to: "error = String(e?.name); row.limits = []; }" },
  G26: { from: "line.result !== \"not sent\") addRan", to: "line.result === \"not sent\") addRan" },
  G27: { from: "row.paceMs - (now() - ended.get(paced))", to: "row.paceMs" },
  G28: { from: "host = u.hostname, paced = host;", to: "host = u.hostname, paced = \"\";" },
  G29: { from: "kind: \"check\"", to: "kind: \"rate\"" },
  G30: { from: "if (held(row.id, at)) return true;", to: "" },
  G31: { from: "(longest || HOLD_HOURS * WINDOWS.hour)", to: "(HOLD_HOURS * WINDOWS.hour)" },
  G32: { from: "until = fs.statSync(file).mtimeMs + HOLD_HOURS * WINDOWS.hour;", to: "until = 0;" },
  G33: { from: "if (!NAMED.includes(result)) count(host, status);", to: "count(host, status);" },
  G34: { from: "sort && status !== 429", to: "sort && status !== 999" },
  G35: { from: "if (!NAMED.includes(result)) return { result: \"error\", error: \"sort\" };", to: "if (!NAMED.includes(result)) return { result: \"error\", error: \"other\" };" },
  G36: { from: "{ status, headers: got, body: data }) : null", to: "{ status, headers: {}, body: data }) : null" },
  G37: { from: "{ timeoutMs }));", to: "{ timeoutMs, sort }));" },
  G38: { from: "sort !== undefined && typeof sort !== \"function\"", to: "sort === 5" },
  G39: { from: "    if (row.paceMs > 0 && ended.has(paced)) {\n      const wait = row.paceMs - (now() - ended.get(paced));\n      if (wait > 0) await sleep(wait);\n    }\n    const own = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== \"user-agent\"));\n    const options = { method, headers: { ...own, \"user-agent\": UA }, body, redirect: \"manual\", signal: AbortSignal.timeout(timeoutMs) };", to: "const early = AbortSignal.timeout(timeoutMs);\n    if (row.paceMs > 0 && ended.has(paced)) {\n      const wait = row.paceMs - (now() - ended.get(paced));\n      if (wait > 0) await sleep(wait);\n    }\n    const own = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== \"user-agent\"));\n    const options = { method, headers: { ...own, \"user-agent\": UA }, body, redirect: \"manual\", signal: early };" },
  G40: { from: "if (v instanceof Promise) v.catch(() => {});", to: "" },
};
// MUTANTS-END
async function mutants() {
  const { spawnSync } = await import("node:child_process");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-mutants-")), sdir = path.join(dir, "scripts");
  let caught = 0, wrong = 0;
  const say = (good, line) => { if (good) caught++; else wrong++; console.log((good ? "RED   " : "WRONG ") + line); };
  try {
    fs.cpSync(here, sdir, { recursive: true });
    fs.copyFileSync(path.join(here, "..", "sources.json"), path.join(dir, "sources.json"));
    const text = fs.readFileSync(path.join(here, "lib-gate.mjs"), "utf8");
    const run = (src) => {
      fs.writeFileSync(path.join(sdir, "lib-gate.mjs"), src);
      const env = { ...process.env };
      delete env.LIB_GATE_UNDER_TEST;
      const r = spawnSync(process.execPath, [path.join(sdir, "test-gate.mjs")], { env, encoding: "utf8", timeout: 120000 });
      const out = String(r.stdout) + String(r.stderr);
      return { code: r.status, counted: /^\d+\/\d+ passed$/m.test(out), red: out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5)) };
    };
    const clean = run(text);
    if (clean.code !== 0 || clean.red.length || !clean.counted) { console.log("WRONG the copy with no change is not green: exit " + clean.code + ", red: " + clean.red.length); return 1; }
    const ids = RULES.map((r) => r[0]), seen = new Map();
    for (const k of Object.keys(MUTANTS)) if (!ids.includes(k)) say(false, k + ": no rule has this id");
    for (const [id, name] of RULES) {
      const m = MUTANTS[id];
      if (!m || typeof m.from !== "string" || typeof m.to !== "string" || m.from === m.to) { say(false, id + ": no mutant"); continue; }
      const twin = seen.get(m.from + "\n->\n" + m.to);
      if (twin) { say(false, id + ": the same mutant as " + twin + "; each rule has its own"); continue; }
      seen.set(m.from + "\n->\n" + m.to, id);
      const found = text.split(m.from).length - 1;
      if (found !== 1) { say(false, id + ": the text to change is found " + found + " times in lib-gate.mjs"); continue; }
      const r = run(text.replace(m.from, () => m.to));
      const keep = RULES.find((x) => x[0] === (id === "G16" ? "G1" : "G16"))[1];
      const isRed = (nm) => r.red.some((l) => l.startsWith(nm + ":"));
      if (!r.counted) say(false, id + ": the test did not end with its count line");
      else if (!isRed(name)) say(false, id + ": the test of the rule stays green: " + name);
      else if (isRed(keep)) say(false, id + ": the mutant breaks more than its rule; also red: " + keep);
      else say(true, id + " " + name);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
  console.log("mutants: " + caught + "/" + RULES.length + " red for the right reason" + (wrong ? "; " + wrong + " wrong" : ""));
  return wrong || caught !== RULES.length ? 1 : 0;
}
if (MUT) process.exit(await mutants());

console.log(n - fails + "/" + n + " passed");
process.exit(fails ? 1 : 0);
