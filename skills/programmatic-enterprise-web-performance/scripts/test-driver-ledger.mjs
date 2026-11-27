// Tests for lib-driver-ledger.mjs (job J2). Plain file tests: a temp folder per test, no network, no browser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
// LIB_DRIVER_LEDGER_UNDER_TEST points the test at a broken copy (the intake)
const { record, lineOf, KINDS, RESULTS, WHY } = await import(process.env.LIB_DRIVER_LEDGER_UNDER_TEST ? pathToFileURL(process.env.LIB_DRIVER_LEDGER_UNDER_TEST).href : new URL("./lib-driver-ledger.mjs", import.meta.url).href);

let fails = 0, n = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "driver-ledger-test-"));
const NOW = Date.parse("2026-11-27T08:00:00Z");
const BASE = { run: "run-1", client: "vtv", driver: "bing-webmaster", source: "DR5", kind: "api" };
const URL_X = "https://api.example.test/x";
const good = (extra = {}) => ({ ...BASE, url: URL_X, result: "read", status: 200, ...extra });
const raw = (d) => fs.readFileSync(path.join(d, "ledger", "requests.jsonl"), "utf8");
const lines = (d) => raw(d).split("\n").slice(0, -1).map((l) => JSON.parse(l));
const one = (entry) => { const d = tmp(); record(d, entry, NOW); const l = lines(d); eq(l.length, 1, "lines"); return l[0]; };

t("T1 one sent request gives one line", () => {
  const d = tmp();
  const r = record(d, { ...BASE, url: "https://api.example.test/v1/things?b=2&a=1&b=3", status: 200, result: "read", bytes: 120, ms: 35 }, NOW);
  eq(raw(d), '{"at":"2026-11-27T08:00:00.000Z","run":"run-1","client":"vtv","driver":"bing-webmaster","source":"DR5","host":"api.example.test","kind":"api","path":"/v1/things","params":["a","b"],"signedIn":false,"status":200,"result":"read","why":null,"bytes":120,"ms":35}\n');
  eq(r, lines(d)[0], "return value");
});
t("T2 no secret reaches the file", () => {
  const d = tmp();
  record(d, good({ url: "https://user:PASSWORD-789@api.example.test/v1/q?apikey=SECRET-VALUE-123&siteUrl=https%3A%2F%2Fclient.test%2F&key=OTHER-SECRET-456#frag-SECRET" }), NOW);
  for (const s of ["SECRET-VALUE-123", "OTHER-SECRET-456", "PASSWORD-789", "frag-SECRET", "client.test", "user"]) eq(raw(d).includes(s), false, s);
  const l = lines(d)[0];
  eq([l.host, l.path, l.params], ["api.example.test", "/v1/q", ["apikey", "key", "siteUrl"]]);
});
t("T3 the host is lower case and has no port", () => {
  const l = one(good({ url: "HTTPS://API.Example.TEST:8443/A/b" }));
  eq([l.host, l.path, l.params], ["api.example.test", "/A/b", []]);
});
t("T4 a request that is not sent gives one line", () => {
  const d = tmp();
  for (const why of WHY) record(d, { ...BASE, url: URL_X, result: "not sent", why }, NOW);
  eq(lines(d).map((l) => [l.status, l.bytes, l.ms, l.result, l.why]), WHY.map((why) => [null, null, null, "not sent", why]));
  eq(lines(d).length, 6);
});
t("T5 signed in or not", () => {
  eq(one(good()).signedIn, false);
  eq(one(good({ signedIn: true })).signedIn, true);
});
t("T6 the file is appended", () => {
  const d = tmp(); fs.mkdirSync(path.join(d, "ledger"));
  fs.writeFileSync(path.join(d, "ledger", "requests.jsonl"), '{"old":1}\n');
  for (const p of ["a", "b", "c"]) record(d, good({ url: `https://api.example.test/${p}` }), NOW);
  const text = raw(d);
  eq(text.endsWith("\n"), true, "line feed at the end");
  eq(text.split("\n").length, 5, "4 lines");
  eq(text.split("\n")[0], '{"old":1}');
  eq(lines(d).slice(1).map((l) => l.path), ["/a", "/b", "/c"]);
});
t("T7 the time", () => {
  const d = tmp(); record(d, good());
  const at = lines(d)[0].at;
  eq(Math.abs(Date.parse(at) - Date.now()) <= 5000, true, at);
  eq(at, new Date(Date.parse(at)).toISOString());
  eq(at.endsWith("Z"), true);
});
t("T8 the results error and quota", () => {
  eq(one({ ...BASE, url: URL_X, result: "error" }).status, null);
  eq(one(good({ result: "error", status: 500 })).status, 500);
  eq(one(good({ result: "quota", status: 403 })).status, 403);
});
t("T9 the three lists", () => {
  eq(KINDS, ["api", "file", "reader", "site"]);
  eq(RESULTS, ["read", "check", "403", "429", "quota", "key", "sign-in", "error", "not sent"]);
  eq(WHY, ["unknown-source", "terms", "stop", "limit", "robots", "refused"]);
});
t("T10 each refusal throws and writes nothing", () => {
  const c = tmp(); record(c, good(), NOW);
  eq([fs.existsSync(path.join(c, "ledger")), fs.existsSync(path.join(c, "ledger", "requests.jsonl"))], [true, true], "control");
  const refused = (label, entry, ...pewp) => {
    const d = tmp(); const cwd = process.cwd(); let threw = false;
    process.chdir(d); // a bad pewp must not write relative to the working folder either
    try { try { record(pewp.length ? pewp[0] : d, entry, NOW); } catch { threw = true; } } finally { process.chdir(cwd); }
    eq(threw, true, `${label}: no throw`);
    eq(fs.readdirSync(d), [], `${label}: wrote`);
  };
  refused("pewp empty", good(), "");
  refused("pewp undefined", good(), undefined);
  for (const extra of [{ headers: { authorization: "Bearer X" } }, { note: "free text" }, { body: "x" }]) refused(`unknown key ${Object.keys(extra)}`, good(extra));
  for (const k of ["run", "client", "driver", "source", "kind", "url", "result"]) { const e = good(); delete e[k]; refused(`missing ${k}`, e); }
  const notSent = (extra) => ({ ...BASE, url: URL_X, result: "not sent", why: "stop", ...extra });
  const bad = [
    { run: "" }, { run: "a b" }, { run: "r".repeat(81) }, { run: 123 }, { client: "a/b" }, { driver: "a b" }, { source: "" },
    { kind: "browser" }, { kind: null }, { result: "ok" }, { result: "READ" },
    { url: "not a url" }, { url: "ftp://x.test/a" }, { url: "file:///c:/x" }, { url: new URL(URL_X) },
    { signedIn: "yes" },
    { status: "200" }, { status: 99 }, { status: 600 }, { status: 200.5 }, { bytes: -1 }, { bytes: 1.5 }, { bytes: "10" }, { ms: -1 },
    { why: "stop" }, { status: undefined }, { result: "429", status: undefined }, { result: "quota", status: undefined },
  ].map((extra) => good(extra));
  bad.push(notSent({ status: 200 }), notSent({ why: undefined }), notSent({ why: "because" }), notSent({ bytes: 0 }), notSent({ ms: 0 }), notSent({ kind: null }), notSent({ kind: undefined, why: "unknown-source" }));
  for (const e of bad) refused(JSON.stringify(e), e);
});
t("T11 the limits that are accepted", () => {
  one(good({ run: "r".repeat(80) }));
  one(good({ status: 100 }));
  one(good({ status: 599 }));
  const l = one(good({ status: 200, bytes: 0, ms: 0 }));
  eq([l.bytes, l.ms], [0, 0]);
  one({ ...BASE, url: URL_X, result: "error", status: null, bytes: null, ms: null, why: null });
  eq(one(good({ kind: "site" })).kind, "site");
  eq(one({ ...BASE, kind: null, url: URL_X, result: "not sent", why: "unknown-source" }).kind, null);
});
t("T12 the order of the names", () => {
  eq(one(good({ url: "https://api.example.test/x?b=1&A=2&a=3&B=4&a=5" })).params, ["A", "B", "a", "b"]);
});
t("T13 lineOf gives the line of record and writes nothing", () => {
  const d = tmp(), cwd = process.cwd();
  let line, threw = false;
  process.chdir(d); // lineOf must not write relative to the working folder either
  try { line = lineOf(good(), NOW); try { lineOf(good({ driver: "a b" }), NOW); } catch { threw = true; } } finally { process.chdir(cwd); }
  eq(fs.readdirSync(d), [], "wrote");
  eq(threw, true, "a bad driver name: no throw");
  eq(line, record(d, good(), NOW), "the same line as record");
});

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
