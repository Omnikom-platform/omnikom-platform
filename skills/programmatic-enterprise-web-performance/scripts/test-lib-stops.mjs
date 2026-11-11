// Tests for lib-stops.mjs (work order 43). Plain file tests: a temp folder per test, no network, no browser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
// LIB_STOPS_UNDER_TEST points the test at a mutated copy (mutants-vantage.mjs)
const { activeStops, isStopped, writeStop, liftStop, stopsDir, KNOWN_ENGINES } = await import(process.env.LIB_STOPS_UNDER_TEST ? pathToFileURL(process.env.LIB_STOPS_UNDER_TEST).href : new URL("./lib-stops.mjs", import.meta.url).href);

let fails = 0, n = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "stops-test-"));
const NOW = Date.parse("2026-11-11T02:29:12Z"), H = 3600_000;
const put = (dir, extra = {}) => writeStop({ engine: "google", reason: "robot check", setBy: "test", evidence: "e", now: NOW, dir, ...extra });

t("a stop is active until its until, with every field in the agreed format", () => {
  const d = tmp(); const r = put(d);
  eq(r.written, true);
  const s = isStopped("google", NOW + 23 * H, d);
  eq([s.engine, s.hosts, s.until, s.reason, s.setBy, s.setAt, s.evidence], ["google", ["google.com"], "2026-11-12T02:29:12.000Z", "robot check", "test", "2026-11-11T02:29:12.000Z", "e"]);
  eq(Object.keys(JSON.parse(fs.readFileSync(path.join(d, "google.json"), "utf8"))), ["engine", "hosts", "until", "reason", "setBy", "setAt", "evidence"]);
  eq(activeStops(NOW + 23 * H, d).length, 1);
});
t("an expired stop is ignored and its file is left in place", () => {
  const d = tmp(); put(d);
  eq(isStopped("google", NOW + 24 * H + 1000, d), null);
  eq(activeStops(NOW + 25 * H, d), []);
  eq(fs.existsSync(path.join(d, "google.json")), true);
});
t("a writer never shortens a later until, and may extend it", () => {
  const d = tmp(); put(d);
  const shorter = put(d, { until: NOW + 2 * H });
  eq([shorter.written, shorter.stop.until], [false, "2026-11-12T02:29:12.000Z"]);
  eq(JSON.parse(fs.readFileSync(path.join(d, "google.json"), "utf8")).until, "2026-11-12T02:29:12.000Z");
  const longer = put(d, { until: NOW + 48 * H, reason: "second robot check" });
  eq([longer.written, longer.stop.until], [true, "2026-11-13T02:29:12.000Z"]);
});
t("host suffix matching: the domain, its subdomains and URLs match; look-alikes do not", () => {
  const d = tmp(); put(d); const at = NOW + H;
  for (const x of ["google.com", "www.google.com", "maps.google.com", "WWW.Google.COM", "https://www.google.com/search?q=a", "www.google.com:443"]) eq(!!isStopped(x, at, d), true, x);
  for (const x of ["notgoogle.com", "google.com.evil.example", "google.co.uk", "bing.com", "chatgpt.com"]) eq(isStopped(x, at, d), null, x);
});
t("the engine name matches too, and another engine's stop does not block it", () => {
  const d = tmp(); put(d);
  eq(!!isStopped("google", NOW + H, d), true); eq(isStopped("bing", NOW + H, d), null);
  writeStop({ engine: "commoncrawl", reason: "429", setBy: "test", now: NOW, dir: d });
  eq(!!isStopped("index.commoncrawl.org", NOW + H, d), true); eq(!!isStopped("data.commoncrawl.org", NOW + H, d), true); eq(isStopped("commoncrawl.org", NOW + H, d), null);
});
t("the folder can be overridden by argument or by OMNIKOM_STOPS_DIR", () => {
  const a = tmp(), b = tmp();
  put(a); eq(isStopped("google", NOW + H, b), null);
  process.env.OMNIKOM_STOPS_DIR = b;
  try { eq(stopsDir(), b); put(undefined); eq(fs.existsSync(path.join(b, "google.json")), true); eq(!!isStopped("google", NOW + H), true); } finally { delete process.env.OMNIKOM_STOPS_DIR; }
  eq(stopsDir().replace(/\\/g, "/").endsWith(".claude/state/omnikom-stops"), true, "the default folder");
});
t("a stop file that cannot be read counts as a stop, never as none", () => {
  const d = tmp(); fs.writeFileSync(path.join(d, "bing.json"), "{ not json");
  const s = isStopped("bing", Date.now(), d);
  eq([!!s, s && s.unreadable], [true, true]);
});
t("bad input is refused: an engine name that is a path, an unknown engine without hosts, no reason, a bad until", () => {
  const d = tmp();
  for (const bad of [{ engine: "../x" }, { engine: "mystery" }, { reason: "" }, { until: "tomorrow-ish" }]) {
    let threw = false; try { put(d, bad); } catch { threw = true; }
    eq(threw, true, JSON.stringify(bad));
  }
  eq(put(d, { engine: "mystery", hosts: ["mystery.example"] }).written, true, "an unknown engine is fine with hosts");
  eq(!!isStopped("a.mystery.example", NOW + H, d), true);
  eq(Object.keys(KNOWN_ENGINES).includes("commoncrawl"), true);
});

t("lifted for desktop: script mode stays stopped, desktop mode is free", () => {
  const d = tmp(); put(d);
  const lifted = liftStop({ engine: "google", by: "owner (relayed)", note: "lifted by the owner 2026-11-11 04:44, desktop only", at: "2026-11-11T02:44:00Z", dir: d });
  eq(lifted.lift, { mode: "desktop", by: "owner (relayed)", at: "2026-11-11T02:44:00.000Z", note: "lifted by the owner 2026-11-11 04:44, desktop only" });
  const at = NOW + H;
  eq(!!isStopped("google", at, d), true, "script mode (default) still stopped");
  eq(!!isStopped("www.google.com", at, d, "script"), true, "script mode by host");
  eq(isStopped("google", at, d, "desktop"), null, "desktop mode free");
  eq(isStopped("maps.google.com", at, d, "desktop"), null, "desktop mode free by host");
  eq([activeStops(at, d).length, activeStops(at, d, "desktop").length], [1, 0]);
  eq(!!isStopped("google", NOW + 25 * H, d), false, "after until both are free");
});
t("a lift frees nothing else: another engine's stop stays, and a later stop write starts without the lift", () => {
  const d = tmp(); put(d); writeStop({ engine: "bing", reason: "429", setBy: "test", now: NOW, dir: d });
  liftStop({ engine: "google", by: "owner (relayed)", note: "n", dir: d, now: NOW });
  eq(!!isStopped("bing", NOW + H, d, "desktop"), true, "bing is not lifted");
  put(d, { until: NOW + 48 * H, reason: "second robot check" });
  eq(!!isStopped("google", NOW + H, d, "desktop"), true, "a new robot check is a new stop: the old lift is gone");
});
t("a lift needs a stop on file, a person and a note", () => {
  const d = tmp();
  for (const bad of [() => liftStop({ engine: "google", by: "owner", note: "n", dir: d }), () => { put(d); liftStop({ engine: "google", note: "n", dir: d }); }, () => liftStop({ engine: "google", by: "owner", dir: d })]) {
    let threw = false; try { bad(); } catch { threw = true; } eq(threw, true);
  }
});

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
