// Tests for lib-source-tables.mjs (job J1b): the source table and the route table. No network, no browser.
// Usage: node test-source-tables.mjs [--mutants] [--only <id>]
// --mutants: watched-fail. Writes a copy of the library with one rule switched off, runs this file against the copy and requires the
//   named test to go red (green = the test measures nothing; a `from` not found exactly once is refused).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const PUSH = "problems.push({ rule, at, detail });";
  const off = (id, rule, red) => ({ id, from: PUSH, to: `if (rule !== "${rule}") ${PUSH}`, red });
  const MUT = [
    off("shape-not-checked", "shape", "a table that is not a table"),
    off("id-repeat-accepted", "id", "an id that is missing or repeated"),
    off("state-any", "state", "a state outside the list"),
    off("kind-any", "kind", "a kind outside the list"),
    off("terms-not-needed", "terms", "a source with no terms line"),
    off("reader-not-checked", "reader", "the reader names no host"),
    off("driver-not-checked", "driver", "an allowed source needs a driver file"),
    off("key-in-path-accepted", "key-in-path", "a key in the path"),
    off("host-not-checked", "host", "a URL form, a host or an engine"),
    off("need-not-checked", "need", "a source that waits"),
    off("route-source-any", "route-source", "a route names only sources"),
    off("route-state-any", "route-state", "a route names no barred"),
    off("route-end-any", "route-end", "a route ends at a gap id"),
    off("station-not-checked", "station", "each station has a route"),
  ];
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const rows = MUT.filter((m) => !args.includes("--only") || m.id === only);
  if (rows.length === 0) { console.log(`no mutant has the id ${only}`); process.exit(1); }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-tables-mut-"));
  const lib = fs.readFileSync(new URL("./lib-source-tables.mjs", import.meta.url), "utf8");
  let good = 0;
  try {
    for (const m of rows) {
      const hits = lib.split(m.from).length - 1;
      if (hits !== 1) { console.log(`MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times)`); continue; }
      const dir = path.join(root, m.id);
      fs.mkdirSync(dir);
      const copy = path.join(dir, "lib-source-tables.mjs");
      fs.writeFileSync(copy, lib.replace(m.from, () => m.to));
      const c = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, SOURCE_TABLES_UNDER_TEST: copy }, encoding: "utf8", timeout: 60000 });
      const hit = (c.stdout || "").split(/\r?\n/).some((l) => l.startsWith(`FAIL ${m.red}`));
      if (c.status === 0) console.log(`MUTANT ${m.id}: STAYED GREEN (the test measures nothing)`);
      else if (!hit) console.log(`MUTANT ${m.id}: red, but NOT the expected test`);
      else { good++; console.log(`MUTANT ${m.id}: red for the right reason`); }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`mutants: ${good}/${rows.length} red for the right reason`);
  process.exit(good === rows.length ? 0 : 1);
}

// ---------------------------------------------------------------- tests
// SOURCE_TABLES_UNDER_TEST points the test at a mutated copy
const { validateSourceTables, SOURCE_STATES, SOURCE_KINDS } = await import(process.env.SOURCE_TABLES_UNDER_TEST ? pathToFileURL(process.env.SOURCE_TABLES_UNDER_TEST).href : new URL("./lib-source-tables.mjs", import.meta.url).href);

let fails = 0, n = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };

const LINE = () => ({ url: "https://example.test/terms", line: "You may call the API from a program.", read: "2026-11-27" });
const base = () => ({
  sources: { version: 1, what: "test", needs: { ON1: "a need of the owner" }, sources: [
    { id: "DR1", name: "Our own reader", engine: null, kind: "reader", hosts: [], urlForms: [], terms: null, robots: null, robotsAtRun: true, key: null, ownerNeeds: [], state: "not built", because: "not built yet", driver: null },
    { id: "DR2", name: "An API with a driver", engine: "example", kind: "api", hosts: ["api.example.test"], urlForms: ["https://api.example.test/v1/{method}?key={EXAMPLE_KEY}"], terms: LINE(), robots: null, robotsAtRun: false, key: "EXAMPLE_KEY", ownerNeeds: [], state: "allowed", because: "built", driver: "scripts/drivers/example.mjs" },
    { id: "DR3", name: "An API that waits", engine: "example", kind: "api", hosts: [], urlForms: [], terms: LINE(), robots: null, robotsAtRun: false, key: null, ownerNeeds: ["ON1"], state: "waits", because: "waits on the owner", driver: null },
    { id: "DR4", name: "A parked API", engine: "example", kind: "api", hosts: [], urlForms: [], terms: LINE(), robots: null, robotsAtRun: false, key: null, ownerNeeds: [], state: "parked", because: "parked by a ruling", driver: null },
    { id: "X1", name: "A site that bars a program", engine: "barred-site", kind: "site", hosts: ["www.barred.test"], urlForms: [], terms: null, robots: { url: "https://www.barred.test/robots.txt", line: "Disallow: /", read: "2026-11-27" }, robotsAtRun: false, key: null, ownerNeeds: [], state: "barred", because: "robots.txt bars each program", driver: null },
  ] },
  routes: { version: 1, what: "test", gaps: { N1: "a gap" }, routes: [
    { id: "D1", fact: "A fact with two sources", pull: true, sources: [{ id: "DR2" }, { id: "DR3", label: "labelled" }], end: { gap: ["N1"], text: "the gap" }, stations: ["site"] },
    { id: "D2", fact: "A fact that ends at an owner need", pull: true, sources: [{ local: "the client's word" }, { id: "DR1" }], end: { gap: ["ON1"], text: "a gap line" }, stations: ["site", "search"] },
    { id: "D3", fact: "A fact that is not a pull", pull: false, sources: [], end: { gap: ["D3"], text: "it reads the record" }, stations: [] },
  ] },
});
const STATIONS = ["site", "search"];
const v = (b, opts = {}) => validateSourceTables(b.sources, b.routes, { stations: STATIONS, exists: () => true, ...opts });
const src = (b, id) => b.sources.sources.find((s) => s.id === id);
const rt = (b, id) => b.routes.routes.find((r) => r.id === id);
const clean = (r) => { eq(r.problems, [], "problems"); eq(r.ok, true, "ok"); };
const has = (r, rule, at) => {
  if (r.ok !== false) throw new Error(`ok is not false (wanted ${rule} at ${at})`);
  if (!r.problems.some((p) => p.rule === rule && p.at === at)) throw new Error(`no problem ${rule} at ${at}; got ${JSON.stringify(r.problems.map((p) => p.rule + " " + p.at))}`);
};
const throws = (fn) => { let threw = false; try { fn(); } catch { threw = true; } if (!threw) throw new Error("it did not throw"); };

t("the base tables pass", () => {
  clean(v(base()));
  throws(() => validateSourceTables(base().sources, base().routes, { stations: STATIONS }));
  throws(() => validateSourceTables(base().sources, base().routes, { exists: () => true }));
  throws(() => validateSourceTables({ needs: {}, sources: [] }, { gaps: {}, routes: [] }, { stations: [] }));
  throws(() => validateSourceTables(base().sources, base().routes, { stations: "site", exists: () => true }));
});

// one break of a new base(), then the problem it must give
const one = (rule, at, change) => { const b = base(); change(b); has(v(b), rule, at); };

t("an id that is missing or repeated is refused", () => {
  one("id", "DR2", (b) => { src(b, "DR3").id = "DR2"; });
  one("id", "sources[4]", (b) => { delete src(b, "X1").id; });
  one("id", "D1", (b) => { rt(b, "D3").id = "D1"; });
  one("id", "routes[1]", (b) => { rt(b, "D2").id = ""; });
});

t("a state outside the list is refused", () => {
  eq(SOURCE_STATES, ["allowed", "not built", "waits", "parked", "barred"]);
  one("state", "DR4", (b) => { src(b, "DR4").state = "open"; });
  one("state", "DR4", (b) => { delete src(b, "DR4").state; });
});

t("a kind outside the list is refused", () => {
  eq(SOURCE_KINDS, ["api", "file", "reader", "site"]);
  one("kind", "DR4", (b) => { src(b, "DR4").kind = "page"; });
});

t("a source with no terms line or no read date is refused", () => {
  one("terms", "DR3", (b) => { src(b, "DR3").terms = null; });
  one("terms", "DR3", (b) => { src(b, "DR3").terms = null; src(b, "DR3").robots = LINE(); });
  one("terms", "DR2", (b) => { delete src(b, "DR2").terms.read; });
  one("terms", "DR2", (b) => { src(b, "DR2").terms.read = "27-11-2026"; });
  one("terms", "DR2", (b) => { src(b, "DR2").terms.line = ""; });
  one("terms", "DR2", (b) => { src(b, "DR2").terms.url = "http://example.test/terms"; });
  one("terms", "X1", (b) => { src(b, "X1").robots = null; });
  one("terms", "X1", (b) => { src(b, "X1").robots.read = ""; });
  clean(v(base()));
});

t("the reader names no host and reads robots.txt at run time", () => {
  one("reader", "DR1", (b) => { src(b, "DR1").hosts = ["example.test"]; });
  one("reader", "DR1", (b) => { src(b, "DR1").urlForms = ["https://example.test/"]; });
  one("reader", "DR1", (b) => { src(b, "DR1").robotsAtRun = false; });
  one("reader", "DR2", (b) => { src(b, "DR2").robotsAtRun = true; });
});

t("an allowed source needs a driver file that exists", () => {
  one("driver", "DR2", (b) => { src(b, "DR2").driver = null; });
  has(v(base(), { exists: () => false }), "driver", "DR2");
  one("driver", "DR2", (b) => { src(b, "DR2").driver = "../drivers/example.mjs"; });
  one("driver", "DR3", (b) => { src(b, "DR3").driver = "scripts/drivers/example.mjs"; });
  const seen = []; clean(v(base(), { exists: (p) => { seen.push(p); return true; } })); eq(seen, ["scripts/drivers/example.mjs"]);
});

t("a key in the path of a URL form is refused", () => {
  one("key-in-path", "DR2", (b) => { src(b, "DR2").urlForms = ["https://api.example.test/v1/{EXAMPLE_KEY}/items"]; });
  one("key-in-path", "DR2", (b) => { src(b, "DR2").urlForms = ["https://api.example.test/{OTHER_KEY}?x=1"]; });
  clean(v(base()));
});

t("a URL form, a host or an engine that is not well formed is refused", () => {
  one("host", "DR2", (b) => { src(b, "DR2").urlForms = ["https://other.example.test/v1"]; });
  one("host", "DR2", (b) => { src(b, "DR2").hosts = ["api.example.test/path"]; });
  one("host", "DR2", (b) => { src(b, "DR2").urlForms = ["http://api.example.test/v1"]; });
  one("host", "DR2", (b) => { src(b, "DR2").urlForms = ["not a url"]; });
  one("host", "X1", (b) => { src(b, "X1").hosts = []; });
  one("host", "DR2", (b) => { src(b, "DR2").engine = "Not An Engine"; });
  one("host", "DR2", (b) => { src(b, "DR2").engine = null; });
});

t("a source that waits names an owner need of the list", () => {
  one("need", "DR3", (b) => { src(b, "DR3").ownerNeeds = []; });
  one("need", "DR3", (b) => { src(b, "DR3").ownerNeeds = ["ON99"]; });
  one("need", "DR2", (b) => { src(b, "DR2").ownerNeeds = ["ON99"]; });
});

t("a route names only sources of the table", () => {
  for (const sources of [[{ id: "DR99" }], [{}], [{ id: "DR2", local: "x" }], [{ local: "" }], ["DR2"]]) one("route-source", "D1", (b) => { rt(b, "D1").sources = sources; });
});

t("a route names no barred and no parked source", () => {
  one("route-state", "D1", (b) => { rt(b, "D1").sources = [{ id: "X1" }]; });
  one("route-state", "D1", (b) => { rt(b, "D1").sources = [{ id: "DR4" }]; });
});

t("a route ends at a gap id", () => {
  one("route-end", "D1", (b) => { rt(b, "D1").end.gap = []; });
  one("route-end", "D1", (b) => { rt(b, "D1").end.gap = ["N99"]; });
  one("route-end", "D1", (b) => { rt(b, "D1").end.gap = ["D3"]; });
  one("route-end", "D1", (b) => { delete rt(b, "D1").end.gap; });
  one("route-end", "D1", (b) => { rt(b, "D1").end.text = ""; });
  one("route-end", "D1", (b) => { delete rt(b, "D1").end; });
  clean(v(base()));
});

t("each station has a route and each route names real stations", () => {
  one("station", "D1", (b) => { rt(b, "D1").stations = ["nowhere"]; });
  one("station", "D1", (b) => { rt(b, "D1").stations = []; });
  has(v(base(), { stations: ["site", "search", "local"] }), "station", "local");
  clean(v(base()));
});

t("a table that is not a table is refused, not thrown", () => {
  one("shape", "sources", (b) => { b.sources = null; });
  one("shape", "sources", (b) => { b.sources.sources = {}; });
  one("shape", "sources", (b) => { delete b.sources.needs; });
  one("shape", "routes", (b) => { delete b.routes.routes; });
  one("shape", "routes", (b) => { b.routes.gaps = []; });
  one("shape", "sources[0]", (b) => { b.sources.sources[0] = null; });
  one("shape", "routes[0]", (b) => { b.routes.routes[0] = "D1"; });
});

t("the two tables of the skill pass", () => {
  const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
  const skillRoot = fileURLToPath(new URL("../", import.meta.url));
  const stations = read("pipeline.json").stations.map((s) => s.id);
  clean(validateSourceTables(read("sources.json"), read("routes.json"), { stations, exists: (p) => fs.existsSync(path.join(skillRoot, p)) }));
});

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
