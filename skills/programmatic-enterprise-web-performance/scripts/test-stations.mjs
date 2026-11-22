// Usage: node test-stations.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of lib-stations.mjs (AB-1): the audit's stations. A station is a block of steps of pipeline.json; the sheet lists ONLY the steps an agent must judge
// (a step the script left BLOCKED, WAITING, PARTIAL, FAILED or SKIPPED), and a station is CLOSED when every step is RUN, skipped by the manifest's own rule,
// or judged and ruled "not gathered" with a ruling that still fits the row. Pure: invented manifests and rows, the real pipeline.json read once (case 11).
// No network, no browser, no model. Mutants: a patch to a copy of the scripts folder must turn the named case red.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const PIPE = path.join(path.resolve(here, ".."), "pipeline.json");

// the nine stations, in order, with the steps of each in file order (the brief of AB-1, spelled out)
const MAP = [
  ["site", "the site itself: reach, snapshot, speed, the checks", "doctor vantage snapshot psi crux checker"],
  ["business", "who the business is, what it sells, the seeds", "intake approve-business city-centres seeds approve-seeds"],
  ["demand", "what people search for", "demand-bing search-console research-plan approve-cost capture-autocomplete autocomplete-import capture-trends trends-import forums"],
  ["search", "where the site stands in Google and Bing", "capture-google capture-bing capture-index index-import research targets-validate"],
  ["assistants", "what the AI assistants answer", "ai-prompt ai-lock ai-ask ai-count ai-import"],
  ["local", "the map, the listing, the directories", "local-grid-plan capture-maps local-grid-import capture-directories local"],
  ["rivals", "competitors and links", "competitors approve-competitors authority authority-anchors authority-classify authority-vet"],
  ["standing", "reviews, social profiles, ads", "capture-reputation reputation-import capture-social social-import capture-ads ads-import"],
  ["report", "the report and the client's copy", "client-profile analysis-judge report-live verify client-copy client-copy-pdf"],
];

async function scenarios(dir) {
  const results = [], check = checker(results);
  let lib;
  try { lib = await import(pathToFileURL(path.join(dir, "lib-stations.mjs")).href + "?" + Math.random()); }
  catch (e) { check("0: lib-stations.mjs loads", false, e.message); return results; }

  // an invented manifest: two stations, four steps, one of them an approval a person signs
  const manifest = { stations: [{ id: "alpha", what: "the first block" }, { id: "beta", what: "the second block" }], steps: [
    { id: "fetch-one", station: "alpha", needsPerson: false }, { id: "fetch-two", station: "alpha", needsPerson: false },
    { id: "count-one", station: "beta", needsPerson: false }, { id: "approve-two", station: "beta", needsPerson: true },
  ] };
  const rowsOf = (over = {}) => manifest.steps.map((s) => ({ id: s.id, state: "RUN", detail: `out/${s.id}.json`, ...(over[s.id] || {}) }));
  const NOW = "2026-11-22T10:00:00.000Z";
  const sheetOf = (rows, rulings = {}, opt = {}) => lib.buildSheet(manifest, rows, rulings, opt);
  const st = (sheet, id) => sheet.stations.find((x) => x.id === id);
  const text = (sheet) => lib.sheetText(sheet);
  const lineOf = (sheet, id) => text(sheet).split("\n").find((l) => l.startsWith(id + " | ")) || "";
  const refused = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const rule = (rows, rulings, step, why = "the source never answered", by = "agent") => lib.ruleStep(manifest, rows, rulings, { step, why, by, now: NOW });
  const BL = "BLOCKED: no key | unblocks: set the key";

  // 1. every step RUN
  { const s = sheetOf(rowsOf());
    check("1: every step RUN: both stations CLOSED, no step line, the whole sheet ok", s.ok === true && st(s, "alpha").verdict === "CLOSED" && st(s, "beta").verdict === "CLOSED" && st(s, "alpha").open.length === 0 && !/ \| /.test(text(s)), text(s)); }

  // 2. one BLOCKED step: OPEN, the script's own line word for word
  { const s = sheetOf(rowsOf({ "fetch-one": { state: "BLOCKED", detail: BL } }));
    check("2: one BLOCKED step: its station is OPEN (1 to judge, 0 not run), the other CLOSED, the line carries the script's line word for word, the sheet is not ok",
      s.ok === false && st(s, "alpha").verdict === "OPEN" && st(s, "beta").verdict === "CLOSED" && text(s).includes("STATION alpha: OPEN (1 to judge, 0 not run)") && text(s).includes("STATION beta: CLOSED") && lineOf(s, "fetch-one") === `fetch-one | BLOCKED | ${BL} | no ruling`, text(s)); }

  // 3. the same with a ruling
  { const rows = rowsOf({ "fetch-one": { state: "BLOCKED", detail: BL } });
    const rulings = rule(rows, {}, "fetch-one", "the key is not ours to get");
    const s = sheetOf(rows, rulings), rec = rulings["fetch-one"] || {};
    check("3: the same step with a ruling: its station is CLOSED, the why is on the line, and the ruling holds who, when and the row's state and detail",
      s.ok === true && st(s, "alpha").verdict === "CLOSED" && lineOf(s, "fetch-one") === `fetch-one | BLOCKED | ${BL} | not gathered: the key is not ours to get` && rec.ruling === "not gathered" && rec.by === "agent" && rec.at === NOW && rec.state === "BLOCKED" && rec.detail === BL && rec.why === "the key is not ours to get", text(s) + JSON.stringify(rec)); }

  // 4. the row changes after the ruling
  { const rows = rowsOf({ "fetch-one": { state: "BLOCKED", detail: BL } }), rulings = rule(rows, {}, "fetch-one");
    const sd = sheetOf(rowsOf({ "fetch-one": { state: "BLOCKED", detail: "BLOCKED: the key is wrong | unblocks: fix it" } }), rulings);
    const ss = sheetOf(rowsOf({ "fetch-one": { state: "FAILED", detail: BL } }), rulings);
    check("4: the row's detail changes after the ruling: OPEN, 'ruling out of date', counted as to judge", st(sd, "alpha").verdict === "OPEN" && lineOf(sd, "fetch-one").endsWith("| ruling out of date") && text(sd).includes("STATION alpha: OPEN (1 to judge, 0 not run)"), text(sd));
    check("4: the row's state changes after the ruling (same detail): OPEN, 'ruling out of date'", st(ss, "alpha").verdict === "OPEN" && lineOf(ss, "fetch-one").endsWith("| ruling out of date"), text(ss)); }

  // 5. SKIPPED with and without a rule
  { const byRule = sheetOf(rowsOf({ "fetch-one": { state: "SKIPPED", detail: "client has no site", rule: "site-none" } }));
    const byScript = sheetOf(rowsOf({ "fetch-one": { state: "SKIPPED", detail: "SKIPPED: no US egress" } }));
    check("5: SKIPPED with a rule (the manifest's own skip): not listed, CLOSED", st(byRule, "alpha").verdict === "CLOSED" && lineOf(byRule, "fetch-one") === "" && st(byRule, "alpha").open.length === 0 && st(byRule, "alpha").counts.SKIPPED === 1, text(byRule));
    check("5: SKIPPED without a rule (the script's own skip): listed, OPEN, to judge", st(byScript, "alpha").verdict === "OPEN" && lineOf(byScript, "fetch-one") === "fetch-one | SKIPPED | SKIPPED: no US egress | no ruling" && text(byScript).includes("(1 to judge, 0 not run)"), text(byScript)); }

  // 6. NOT RUN
  { const rows = rowsOf({ "fetch-two": { state: "NOT RUN", detail: "not run yet" } });
    const s = sheetOf(rows), e = refused(() => rule(rows, {}, "fetch-two"));
    check("6: a NOT RUN step keeps its station OPEN, counted as not run (not as to judge), and is listed", st(s, "alpha").verdict === "OPEN" && text(s).includes("STATION alpha: OPEN (0 to judge, 1 not run)") && st(s, "alpha").counts["NOT RUN"] === 1 && lineOf(s, "fetch-two") === "fetch-two | NOT RUN | not run yet | no ruling", text(s));
    check("6: a ruling on a NOT RUN step is REFUSED", e && /^REFUSED/.test(e.message) && e.exit === 1, e && e.message); }

  // 7. refusals
  { const rows = rowsOf({ "fetch-one": { state: "BLOCKED", detail: BL }, "count-one": { state: "SKIPPED", detail: "no site", rule: "site-none" }, "approve-two": { state: "WAITING", detail: "needs the owner" } });
    const bad = (fn) => { const e = refused(fn); return e && /^REFUSED/.test(e.message) ? e : null; };
    check("7: a ruling on a RUN step is REFUSED", bad(() => rule(rows, {}, "fetch-two")) !== null, "no refusal");
    check("7: a ruling on a rule-SKIPPED step is REFUSED", bad(() => rule(rows, {}, "count-one")) !== null, "no refusal");
    check("7: a ruling on a step with needsPerson true is REFUSED (an approval is signed, never ruled away)", bad(() => rule(rows, {}, "approve-two")) !== null, "no refusal");
    check("7: an empty why is REFUSED", bad(() => rule(rows, {}, "fetch-one", "")) !== null, "no refusal");
    check("7: a blank why (spaces only) is REFUSED", bad(() => rule(rows, {}, "fetch-one", "   ")) !== null, "no refusal");
    check("7: an empty by is REFUSED", bad(() => rule(rows, {}, "fetch-one", "why", "")) !== null, "no refusal");
    const ghost = bad(() => rule(rows, {}, "no-such-step"));
    check("7: a step id the manifest does not have is REFUSED and is a usage fault (exit 2)", ghost !== null && ghost.exit === 2, ghost && ghost.message);
    const was = JSON.stringify({}), after = rule(rows, {}, "fetch-one");
    check("7: a refusal changes nothing and a good ruling returns a new object (the old one is left as it was)", JSON.stringify({}) === was && Object.keys(after).join() === "fetch-one", JSON.stringify(after)); }

  // 8. WAITING, PARTIAL and FAILED are listed and can be ruled
  { for (const [state, detail] of [["WAITING", "needs the owner's browser"], ["PARTIAL", "exit 0: PARTIAL: read 10 of 25"], ["FAILED", "exit 1: boom"]]) {
      const rows = rowsOf({ "fetch-one": { state, detail } }), open = sheetOf(rows), rulings = refused(() => rule(rows, {}, "fetch-one")) ? null : rule(rows, {}, "fetch-one"), closed = rulings ? sheetOf(rows, rulings) : null;
      check(`8: ${state} is listed (OPEN, 1 to judge) and can be ruled (CLOSED)`, st(open, "alpha").verdict === "OPEN" && lineOf(open, "fetch-one") === `fetch-one | ${state} | ${detail} | no ruling` && closed && st(closed, "alpha").verdict === "CLOSED", text(open)); } }

  // 9. --station
  { const rows = rowsOf({ "fetch-one": { state: "BLOCKED", detail: BL } });
    const one = sheetOf(rows, {}, { station: "beta" }), e = refused(() => sheetOf(rows, {}, { station: "gamma" }));
    check("9: a station id picks that one station only (the other is not in the sheet or its text)", one.stations.length === 1 && one.stations[0].id === "beta" && one.ok === true && !text(one).includes("STATION alpha"), text(one));
    check("9: an unknown station id is refused as a usage fault (exit 2) with the ids listed", e && e.exit === 2 && e.message.includes("gamma") && e.message.includes("alpha") && e.message.includes("beta"), e && e.message); }

  // 10. the text
  { const rows = rowsOf({ "fetch-one": { state: "BLOCKED", detail: BL } }), s = sheetOf(rows), t = text(s);
    check("10: the sheet text holds no id of a RUN step and exactly one verdict line per station", !["fetch-two", "count-one", "approve-two"].some((id) => t.includes(id)) && t.split("\n").filter((l) => /^STATION /.test(l)).length === 2 && t.includes("fetch-one"), t); }

  // 11. the real pipeline.json
  { let m = null; try { m = JSON.parse(fs.readFileSync(PIPE, "utf8")); } catch (e) { /* red below */ }
    const got = m && Array.isArray(m.stations) ? m.stations.map((s) => s.id).join() : "none";
    const want = MAP.map((x) => x[0]).join();
    const stepsOf = (id) => (m ? m.steps.filter((s) => s.station === id).map((s) => s.id).join(" ") : "");
    const bad = MAP.filter(([id, what, steps]) => stepsOf(id) !== steps || !(m && m.stations && m.stations.some((s) => s.id === id && s.what === what)));
    check("11: the real pipeline.json declares the 9 stations in the order of the brief", got === want, got);
    check("11: the 54 steps are mapped exactly (each station holds its steps, in file order, and every step names a station)", m && m.steps.length === 54 && bad.length === 0 && m.steps.every((s) => typeof s.station === "string") && MAP.flatMap((x) => x[2].split(" ")).length === 54, "wrong: " + bad.map((x) => x[0]).join(", ")); }

  // 12. AB-11: the one test of "this ruling counts", exported and used by the sheet and by the runner (tools/omnikom-cli/lib/seo-run.mjs)
  { const rc = (ruling, row, def) => (typeof lib.rulingCounts === "function" ? lib.rulingCounts(ruling, row, def) : "rulingCounts is not exported");
    const defOf = (id) => manifest.steps.find((s) => s.id === id);
    const row = { id: "fetch-one", state: "BLOCKED", detail: BL }, rows = rowsOf({ "fetch-one": row });
    const ruling = rule(rows, {}, "fetch-one")["fetch-one"];
    const hand = { ruling: "not gathered", why: "by hand", by: "agent", at: NOW, state: "WAITING", detail: "needs the owner" };   // what ruleStep never writes: a ruling for an approval
    const apRows = rowsOf({ "approve-two": { state: "WAITING", detail: "needs the owner" } });
    check("12: the exported test says yes to a ruling that fits its row, and the sheet closes the station the same way", rc(ruling, row, defOf("fetch-one")) === true && st(sheetOf(rows, { "fetch-one": ruling }), "alpha").verdict === "CLOSED", String(rc(ruling, row, defOf("fetch-one"))));
    check("12: the exported test says no when the row's detail changed since the ruling (the sheet leaves the station OPEN)", rc(ruling, { ...row, detail: "BLOCKED: the key is wrong | unblocks: fix it" }, defOf("fetch-one")) === false && st(sheetOf(rowsOf({ "fetch-one": { state: "BLOCKED", detail: "BLOCKED: the key is wrong | unblocks: fix it" } }), { "fetch-one": ruling }), "alpha").verdict === "OPEN", String(rc(ruling, { ...row, detail: "x" }, defOf("fetch-one"))));
    check("12: the exported test says no when the row's state changed since the ruling", rc(ruling, { ...row, state: "FAILED" }, defOf("fetch-one")) === false, String(rc(ruling, { ...row, state: "FAILED" }, defOf("fetch-one"))));
    check("12: the exported test says no to a ruling that is not 'not gathered', and to no ruling at all", rc({ ...ruling, ruling: "gathered" }, row, defOf("fetch-one")) === false && rc(undefined, row, defOf("fetch-one")) === false, "");
    check("12: the exported test says no to a hand-written ruling for an approval (needsPerson), and the sheet leaves its station OPEN", rc(hand, apRows.find((r) => r.id === "approve-two"), defOf("approve-two")) === false && st(sheetOf(apRows, { "approve-two": hand }), "beta").verdict === "OPEN", String(rc(hand, { id: "approve-two", state: "WAITING", detail: "needs the owner" }, defOf("approve-two"))));
    check("12: the exported test says no for a row that is not to judge (a RUN step, a step skipped by rule)", rc({ ...ruling, state: "RUN", detail: "out/x.json" }, { id: "x", state: "RUN", detail: "out/x.json" }, defOf("fetch-one")) === false && rc({ ...ruling, state: "SKIPPED", detail: "no site" }, { id: "x", state: "SKIPPED", detail: "no site", rule: "site-none" }, defOf("fetch-one")) === false, ""); }
  return results;
}

const LS = "lib-stations.mjs";
const MUTANTS = [
  { name: "a rule-skipped step is treated as to-judge", patches: [{ file: LS, from: 'row.state === "SKIPPED" && Boolean(row.rule)', to: "false" }], expect: [/^5: SKIPPED with a rule/] },
  { name: "a stale ruling still counts", patches: [{ file: LS, from: "ruling.state === row.state && ruling.detail === row.detail", to: "true" }], expect: [/^4: the row's detail changes/, /^4: the row's state changes/] },
  { name: "a NOT RUN step closes its station", patches: [{ file: LS, from: 'kind === "done" ||', to: 'kind === "done" || kind === "not-run" ||' }], expect: [/^6: a NOT RUN step keeps its station OPEN/] },
  { name: "a RUN step is printed", patches: [{ file: LS, from: 'const listed = (row) => kindOf(row) !== "done" && kindOf(row) !== "by-rule";', to: "const listed = () => true;" }], expect: [/^10: the sheet text holds no id of a RUN step/, /^1: every step RUN/] },
  { name: "the needsPerson refusal is removed", patches: [{ file: LS, from: "if (def.needsPerson === true) throw", to: "if (false) throw" }], expect: [/^7: a ruling on a step with needsPerson true/] },
  { name: "a hand-written ruling for an approval counts", patches: [{ file: LS, from: "(!def || def.needsPerson !== true) && ", to: "" }], expect: [/^12: the exported test says no to a hand-written ruling for an approval/] },
  { name: "the exported test ignores the row's detail", patches: [{ file: LS, from: "ruling.state === row.state && ruling.detail === row.detail", to: "ruling.state === row.state" }], expect: [/^12: the exported test says no when the row's detail changed/, /^4: the row's detail changes/] },
  { name: "the blank-why refusal is removed", patches: [{ file: LS, from: 'if (!String(why ?? "").trim()) throw', to: "if (false) throw" }], expect: [/^7: an empty why is REFUSED/, /^7: a blank why/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-stations.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "STATIONS", scenarios, MUTANTS, scriptsDir, argv: A }));
}
