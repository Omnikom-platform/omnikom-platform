// Tests for lib-step-gate.mjs (router job J1f). A temp folder for each test. No network: the real fetch is closed for this file.
// Run: node scripts/test-step-gate.mjs. The mutants: node scripts/test-step-gate.mjs --mutants (the end of this file).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readSources } from "./lib-gate.mjs";
// LIB_STEP_GATE_UNDER_TEST points the test at another copy of the library (the intake). The copy stands in a folder that holds the other scripts.
const { stepGate, runNames } = await import(process.env.LIB_STEP_GATE_UNDER_TEST ? pathToFileURL(process.env.LIB_STEP_GATE_UNDER_TEST).href : new URL("./lib-step-gate.mjs", import.meta.url).href);

const MUT = process.argv.includes("--mutants");
let fails = 0, n = 0;
const t = async (name, fn) => { if (MUT) return; n++; try { await fn(); console.log("ok   " + name); } catch (e) { fails++; console.log("FAIL " + name + ": " + e.message); } };
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m); };
// the function must throw a TypeError whose message starts with the text
const typeError = (fn, start, m) => { try { fn(); } catch (e) { if (e instanceof TypeError && e.message.startsWith(start)) return; throw new Error(m + ": it threw " + e.name + ": " + e.message); } throw new Error(m + ": it did not throw"); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "step-gate-test-"));
process.env.OMNIKOM_QUOTA_DIR = tmp(); // no gate of a test reads or writes the quota folder of the machine
process.env.OMNIKOM_STOPS_DIR = tmp(); // nor the stop folder of the machine
globalThis.fetch = async () => { throw new Error("a test reached the real fetch"); }; // no request of this file leaves the machine
const NOW = Date.parse("2026-11-27T08:00:00Z");
const START = "2026-11-26T21:15:00.000Z";
// the record of the run, as the runner writes it; more changes a field, and a field that is undefined is left out
const record = (pewp, more = {}) => fs.writeFileSync(path.join(pewp, "seo-run.json"), JSON.stringify({ version: 1, url: "https://client.example.test/", client: "acme", host: "client.example.test", runStartedAt: START, updatedAt: START, steps: [], ...more }));
const TABLE = () => ({ sources: [{ id: "A1", kind: "api", engine: "example", hosts: ["api.example.test"], state: "allowed", robotsAtRun: false }] });
const GOOD = () => ({ sources: TABLE(), now: () => NOW }); // the two options that most gates of a test take
// a fetch of the test: answer(url) gives { status, body }; each call is kept in .calls
const net = (answer) => {
  const f = async (url, opts) => { f.calls.push({ url: String(url), opts }); const a = answer(String(url)) || {}; return new Response(a.body ?? "", { status: a.status || 200 }); };
  f.calls = [];
  return f;
};
const lines = (pewp) => { try { return fs.readFileSync(path.join(pewp, "ledger", "requests.jsonl"), "utf8").split("\n").slice(0, -1).map((l) => JSON.parse(l)); } catch { return []; } };
const ask = (gate, source, url) => gate.request({ driver: "test-driver", source, url });
const API = "https://api.example.test/v1/x";

await t("with a record of the run, a ledger line holds the start time of the run and the client of the record", async () => {
  const pewp = tmp();
  record(pewp);
  eq(runNames(pewp, { client: "other" }), { run: START, client: "acme" });
  const gate = stepGate(pewp, { client: "other", ...GOOD(), fetch: net(() => ({ status: 200 })) });
  await ask(gate, "A1", API);
  const l = lines(pewp);
  eq(l.length, 1, "lines");
  eq([l[0].run, l[0].client, l[0].result], [START, "acme", "read"]);
});

await t("with no record, the run name is hand- and the UTC date, and the client is the one of the caller", async () => {
  const pewp = tmp();
  eq(runNames(pewp, { client: "vtv", now: () => NOW }), { run: "hand-2026-11-27", client: "vtv" });
  eq(runNames(pewp, { client: "vtv", now: () => Date.parse("2026-11-27T23:30:00Z") }).run, "hand-2026-11-27", "late");
  eq(runNames(pewp, { client: "vtv", now: () => Date.parse("2026-11-28T00:30:00Z") }).run, "hand-2026-11-28", "early");
  const today = runNames(pewp, { client: "vtv" }).run;
  ok(/^hand-\d{4}-\d{2}-\d{2}$/.test(today), "with no now: " + today);
  const gate = stepGate(pewp, { client: "vtv", ...GOOD(), fetch: net(() => ({ status: 200 })) });
  await ask(gate, "A1", API);
  const l = lines(pewp);
  eq(l.length, 1, "lines");
  eq([l[0].run, l[0].client], ["hand-2026-11-27", "vtv"]);
  typeError(() => stepGate(pewp, { ...GOOD() }), "gate: bad client", "no client");
});

await t("a record that cannot be read is an error, and so is a record with no start time", async () => {
  const pewp = tmp();
  const file = path.join(pewp, "seo-run.json");
  const f = net(() => ({ status: 200 }));
  fs.writeFileSync(file, "not json");
  typeError(() => stepGate(pewp, { client: "vtv", ...GOOD(), fetch: f }), "gate: the run log ", "not json");
  typeError(() => runNames(pewp, { client: "vtv" }), "gate: the run log ", "runNames");
  fs.writeFileSync(file, '{"version":2,"steps":[]}');
  typeError(() => stepGate(pewp, { client: "vtv", ...GOOD(), fetch: f }), "gate: the run log ", "version 2");
  eq([f.calls.length, lines(pewp)], [0, []]);
  record(pewp, { runStartedAt: undefined });
  typeError(() => stepGate(pewp, { client: "vtv", ...GOOD() }), "gate: bad run", "no start time");
  record(pewp, { runStartedAt: "" });
  typeError(() => stepGate(pewp, { client: "vtv", ...GOOD() }), "gate: bad run", "empty start time");
});

await t("with no table given, the real source table is read: a barred source is not sent", async () => {
  const pewp = tmp();
  const x = readSources().sources.find((r) => r.state === "barred" && (r.hosts ?? []).length > 0);
  ok(x, "the real table has no barred row with a host");
  const gate = stepGate(pewp, { client: "vtv", now: () => NOW });
  const r = await ask(gate, x.id, "https://" + x.hosts[0] + "/");
  eq([r.sent, r.why], [false, "terms"]);
  const l = lines(pewp);
  eq(l.length, 1, "lines");
  eq(l[0].result, "not sent");
});

await t("the table and the other options of the caller reach the gate", async () => {
  const pewp = tmp();
  const f = net(() => ({ status: 200, body: "hello" }));
  const gate = stepGate(pewp, { client: "vtv", ...GOOD(), fetch: f });
  const r = await ask(gate, "A1", API);
  eq([r.sent, r.status, r.result], [true, 200, "read"]);
  eq(f.calls.length, 1, "calls");
  eq(lines(pewp)[0].at, "2026-11-27T08:00:00.000Z", "at");
  eq((await ask(gate, "DR4", API)).why, "unknown-source", "the table of the caller");
  const stops = path.join(pewp, "stops");
  const second = stepGate(pewp, { client: "vtv", ...GOOD(), stopsDir: stops, fetch: net(() => ({ status: 429 })) });
  await ask(second, "A1", API);
  ok(fs.existsSync(stops) && fs.readdirSync(stops).length > 0, "no stop file in the folder of the caller");
  typeError(() => stepGate(pewp, { client: "vtv", ...GOOD(), sleep: 5 }), "gate: sleep is a function", "sleep");
  typeError(() => stepGate(pewp, { client: "vtv", ...GOOD(), quotaDir: "" }), "gate: bad quotaDir", "quotaDir");
});

await t("the caller cannot name the run: the record names it", async () => {
  const pewp = tmp();
  record(pewp);
  const gate = stepGate(pewp, { run: "made-up", client: "other", ...GOOD(), fetch: net(() => ({ status: 200 })) });
  await ask(gate, "A1", API);
  eq(lines(pewp)[0].run, START);
});

await t("a folder name that is empty or is not a text is an error", async () => {
  const pewp = tmp();
  for (const bad of ["", undefined, null, 7]) {
    typeError(() => runNames(bad, { client: "vtv" }), "gate: bad pewp", "runNames " + String(bad));
    typeError(() => stepGate(bad, { client: "vtv", sources: TABLE() }), "gate: bad pewp", "stepGate " + String(bad));
  }
});

await t("two steps of one run share the count of 403 answers", async () => {
  const pewp = tmp();
  record(pewp);
  const f = net(() => ({ status: 403 }));
  const one = stepGate(pewp, { ...GOOD(), fetch: f });
  for (let i = 0; i < 3; i++) await ask(one, "A1", API);
  record(pewp, { updatedAt: "2026-11-26T21:20:00.000Z" });
  const two = stepGate(pewp, { sources: TABLE(), fetch: f, now: () => NOW + 60000 });
  const r = await ask(two, "A1", API);
  eq([r.sent, r.why, f.calls.length], [false, "refused", 3]);
});

// ---- the mutants: one broken copy of the library for each rule (node scripts/test-step-gate.mjs --mutants) ----
// A mutant is one change of the text of lib-step-gate.mjs: "from" is found one time in the file, and "to" takes its place. The scripts
// folder and sources.json are copied to a temp folder one time; each mutant is written there and this test runs on it. The test
// of the rule must turn red. The test of S7 must stay green (for S7: the test of S4), so a copy that does not load does not count.
const RULES = [
  ["S1", "with a record of the run, a ledger line holds the start time of the run and the client of the record"],
  ["S2", "with no record, the run name is hand- and the UTC date, and the client is the one of the caller"],
  ["S3", "a record that cannot be read is an error, and so is a record with no start time"],
  ["S4", "with no table given, the real source table is read: a barred source is not sent"],
  ["S5", "the table and the other options of the caller reach the gate"],
  ["S6", "the caller cannot name the run: the record names it"],
  ["S7", "a folder name that is empty or is not a text is an error"],
  ["S8", "two steps of one run share the count of 403 answers"],
];
// MUTANTS-BEGIN (the builder fills this list: one entry for each rule id, { from, to }. Nothing outside the two marks changes.)
const MUTANTS = {
  S1: { from: "client: found.run.client }", to: "client }" },
  S2: { from: "\"hand-\" + new Date", to: "\"run-\" + new Date" },
  S3: { from: "if (found.error) throw new TypeError(\"gate: \" + found.error);", to: "" },
  S4: { from: "sources = readSources(),", to: "sources = { sources: [] }," },
  S5: { from: "makeGate({ ...rest, pewp,", to: "makeGate({ pewp," },
  S6: { from: "run: names.run,", to: "run: rest.run ?? names.run," },
  S7: { from: "if (typeof pewp !== \"string\" || pewp === \"\") throw new TypeError(\"gate: bad pewp\");", to: "" },
  S8: { from: "run: found.run.runStartedAt,", to: "run: found.run.updatedAt," },
};
// MUTANTS-END
async function mutants() {
  const { spawnSync } = await import("node:child_process");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "step-gate-mutants-")), sdir = path.join(dir, "scripts");
  let caught = 0, wrong = 0;
  const say = (good, line) => { if (good) caught++; else wrong++; console.log((good ? "RED   " : "WRONG ") + line); };
  try {
    fs.cpSync(here, sdir, { recursive: true });
    fs.copyFileSync(path.join(here, "..", "sources.json"), path.join(dir, "sources.json"));
    const text = fs.readFileSync(path.join(here, "lib-step-gate.mjs"), "utf8");
    const run = (src) => {
      fs.writeFileSync(path.join(sdir, "lib-step-gate.mjs"), src);
      const env = { ...process.env };
      delete env.LIB_STEP_GATE_UNDER_TEST;
      const r = spawnSync(process.execPath, [path.join(sdir, "test-step-gate.mjs")], { env, encoding: "utf8", timeout: 120000 });
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
      if (found !== 1) { say(false, id + ": the text to change is found " + found + " times in lib-step-gate.mjs"); continue; }
      const r = run(text.replace(m.from, () => m.to));
      const keep = RULES.find((x) => x[0] === (id === "S7" ? "S4" : "S7"))[1];
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
