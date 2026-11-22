// Usage: node test-analysis-check.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of analysis-check.mjs (AB-5, the number guard): the model's analysis JSON is refused unless every number and every name in it is a slot
// {{<file>#<path>}} that points into a .json file of a GATHERED step of the run's profile; nothing else is judged. Run on an INVENTED run folder (a profile of
// three steps, two gathered and one not gathered, and their files), the real script as a child process, no network, no browser, no model.
// Pinned: the passed outputs (checked analysis and the sheet of where each value came from), every refusal with its own words, nothing written (an older
// output removed) after a refusal, exit 3 for a missing profile or analysis, exit 2 for usage. Mutants: a fault patched into a copy of the scripts must turn the
// named case red.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { mkTmp, rmTmp, checker, main, W as writeFile } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const URL_KEY = "https://example.test/";
const PROFILE = { step: "client-profile", generatedAt: "2031-03-01T00:00:00.000Z", key: URL_KEY, host: "example.test", stations: [{ id: "s1", what: "one", verdict: "OPEN", steps: [
  { id: "step-a", what: "a", state: "RUN", bucket: "gathered", partial: false, why: null, ruling: null, outputs: ["research/a.json", "facts/"], files: [], fileCount: 0 },
  { id: "step-b", what: "b", state: "RUN", bucket: "gathered", partial: false, why: null, ruling: null, outputs: ["b.json"], files: [], fileCount: 0 },
  { id: "step-c", what: "c", state: "SKIPPED", bucket: "not gathered", partial: false, why: "skipped", ruling: null, outputs: ["c/"], files: [], fileCount: 0 }] }], notGathered: [], counts: {} };
const FILES = {
  "research/a.json": { rows: [{ count: 12, name: "Hilltop" }], title: "Birchwood Plumbing", nul: null, list: [1, 2], obj: { x: 1 } },
  "facts/f.json": { score: 4.5, long: "y".repeat(201) },
  "b.json": { n: 7 },
  "c/x.json": { v: 1 },
  "other.json": { v: 2 },
};

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("acheck");
  const script = path.join(dir, "analysis-check.mjs");
  const mk = (slug) => {
    const root = path.join(tmp, "site-checks", slug), pewp = path.join(root, ".pewp");
    for (const [f, o] of Object.entries(FILES)) writeFile(path.join(pewp, f), o);
    writeFile(path.join(pewp, "facts", "bad.json"), "{nope");
    writeFile(path.join(root, "x.json"), { a: 1 });
    writeFile(path.join(pewp, "profile.json"), PROFILE);
    return pewp;
  };
  const pewp = mk("example.test");
  const CK = path.join(pewp, "analysis.checked.json"), SH = path.join(pewp, "analysis.sheet.json");
  const run = (args) => { const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 60000 }); const out = (r.stdout || "") + (r.stderr || ""); return { code: r.status, out, last: out.trim().split("\n").pop() }; };
  const go = (analysis, extra = [], key = URL_KEY) => { writeFile(path.join(pewp, "analysis.json"), typeof analysis === "string" ? analysis : analysis); return run([key, "--cwd", tmp, ...extra]); };
  const gone = () => !fs.existsSync(CK) && !fs.existsSync(SH);
  const refused = (analysis, re, label, n = 1) => { const r = go(analysis); const bad = []; if (r.code !== 1) bad.push(label + ": exit " + r.code); if (!re.test(r.out)) bad.push(label + ": no line " + re + " in " + JSON.stringify(r.out.slice(0, 300))); if (!new RegExp("^REFUSED: " + n + " problems; nothing was written$").test(r.last)) bad.push(label + ": last line " + r.last); if (!gone()) bad.push(label + ": an output file exists"); return bad; };
  const S = (f, p) => "{{" + f + "#" + p + "}}";
  try {
    // ---- 1: a good analysis
    const good = { summary: { headline: S("research/a.json", "rows[0].name") + " shows " + S("research/a.json", "rows[0].count") + " spots" }, items: [{ text: "Title is " + S("research/a.json", "title") }, { text: "score " + S("facts/f.json", "score") + " of " + S("b.json", "n") }], note: "No digits here" };
    const g = go(good);
    let ck = null, sh = null; try { ck = JSON.parse(fs.readFileSync(CK, "utf8")); sh = JSON.parse(fs.readFileSync(SH, "utf8")); } catch {}
    const m = (f) => fs.statSync(path.join(pewp, f)).mtime.toISOString();
    const bad1 = [];
    if (g.code !== 0) bad1.push("exit " + g.code + " " + g.out.slice(0, 300));
    if (g.last !== "ANALYSIS OK: 5 values, each from a gathered file") bad1.push("last line " + g.last);
    if (ck?.summary?.headline !== "Hilltop shows 12 spots" || ck?.items?.[0]?.text !== "Title is Birchwood Plumbing" || ck?.items?.[1]?.text !== "score 4.5 of 7" || ck?.note !== "No digits here") bad1.push("checked " + JSON.stringify(ck));
    const rows = sh?.rows || [], want = [["$.summary.headline", "research/a.json", "rows[0].name", "Hilltop", m("research/a.json"), "step-a"], ["$.summary.headline", "research/a.json", "rows[0].count", "12", m("research/a.json"), "step-a"], ["$.items[0].text", "research/a.json", "title", "Birchwood Plumbing", m("research/a.json"), "step-a"], ["$.items[1].text", "facts/f.json", "score", "4.5", m("facts/f.json"), "step-a"], ["$.items[1].text", "b.json", "n", "7", m("b.json"), "step-b"]];
    if (rows.length !== 5) bad1.push("sheet rows " + rows.length);
    want.forEach((w, i) => { const r = rows[i] || {}; const got = [r.at, r.file, r.where, r.value, r.measured, r.step, r.pointer]; if (got.join("|") !== [...w, w[1] + "#" + w[2]].join("|")) bad1.push("row " + i + " " + got.join("|")); });
    check("case 1: a good analysis (texts nested in objects and lists, a number slot, a name slot, two slots in one text) exits 0; the checked file holds the values; the sheet has one row per slot with at, pointer, file, where, value, measured and step", bad1.length === 0, bad1.join(" | "));

    // ---- 2: digits outside a slot
    const bad2 = [];
    bad2.push(...refused({ a: { b: ["fine", "grew 12 percent"] } }, /^\$\.a\.b\[1\]: .*12/m, "12 percent"));
    bad2.push(...refused({ a: "open 24/7" }, /^\$\.a: .*24, 7/m, "24/7"));
    bad2.push(...refused({ a: 5 }, /^\$\.a: .*5/m, "a typed number"));
    const only = go({ x: S("research/a.json", "rows[0].count") });
    if (only.code !== 0) bad2.push("a digit inside a slot's path alone: exit " + only.code + " " + only.out.slice(0, 200));
    check("case 2: a bare digit in a nested text, in 24/7, or a number typed as a number is refused naming the JSON path and the digits; a digit inside a slot's own path alone passes", bad2.length === 0, bad2.join(" | "));

    // ---- 3: not gathered, under no step
    const bad3 = [];
    bad3.push(...refused({ a: S("c/x.json", "v") }, /^\$\.a: .*step-c.*not gathered/m, "not gathered"));
    bad3.push(...refused({ a: S("other.json", "v") }, /^\$\.a: .*no step's outputs/m, "under no step"));
    check("case 3: a slot into a file under the not gathered step's outputs, and into an existing file under no step's outputs, are each refused with their own words", bad3.length === 0, bad3.join(" | "));

    // ---- 4: spellings of the file
    const bad4 = [];
    for (const [f, re] of [["../x.json", /\.\./], ["a/../../x.json", /\.\./], ["facts/../other.json", /\.\./], ["C:/x.json", /drive letter/], ["/x.json", /leading slash/], ["a\\b.json", /backslash/], ["\\\\?\\C:\\x.json", /backslash/], ["research/a.txt", /\.json/]]) bad4.push(...refused({ a: S(f, "a") }, new RegExp("^\\$\\.a: .*: .*" + re.source, "m"), f));
    check("case 4: ../x.json, a/../../x.json, facts/../other.json, C:/x.json, /x.json, a backslash, a \\\\?\\ path and a file not ending .json are each refused with their own words", bad4.length === 0, bad4.join(" | "));

    // ---- 5: what the slot leads to
    const bad5 = [];
    for (const [f, p, re] of [["facts/missing.json", "a", /does not exist/], ["facts/bad.json", "a", /not JSON/], ["research/a.json", "rows[0].zzz", /leads to nothing/], ["research/a.json", "nul", /null/], ["research/a.json", "list", /list/], ["research/a.json", "obj", /object/], ["facts/f.json", "long", /200/]]) bad5.push(...refused({ a: S(f, p) }, new RegExp("^\\$\\.a: .*: .*" + re.source, "m"), f + "#" + p));
    bad5.push(...refused({ a: "x".repeat(201) }, /^\$\.a: .*200/m, "a text of 201"));
    check("case 5: a missing file, a file that is not JSON, a path to nothing, to null, to a list, to an object, a value or a text longer than 200 characters are each refused", bad5.length === 0, bad5.join(" | "));

    // ---- 6: malformed slots
    const bad6 = [];
    bad6.push(...refused({ a: "{{research/a.json}}" }, /^\$\.a: .*no #/m, "no #"));
    bad6.push(...refused({ a: "{{research/a.json#title" }, /^\$\.a: .*never closed/m, "never closed"));
    bad6.push(...refused({ a: "{{research/a.json#}}" }, /^\$\.a: .*path is empty/m, "empty path"));
    bad6.push(...refused({ a: "{{#title}}" }, /^\$\.a: .*file is empty/m, "empty file"));
    check("case 6: a slot with no #, a {{ never closed, an empty path and an empty file are each refused", bad6.length === 0, bad6.join(" | "));

    // ---- 7: three problems
    const r7 = go({ a: S("research/a.json", "zzz"), b: ["grew 12"], c: S("c/x.json", "v") });
    const bad7 = [];
    if (r7.code !== 1 || r7.last !== "REFUSED: 3 problems; nothing was written") bad7.push("last line " + r7.last + " exit " + r7.code);
    for (const k of ["$.a", "$.b[0]", "$.c"]) if (!r7.out.split("\n").some((l) => l.startsWith(k + ": "))) bad7.push("no line for " + k);
    check("case 7: three problems in one analysis are all listed, and the last line is REFUSED: 3 problems; nothing was written", bad7.length === 0, bad7.join(" | ") + " " + r7.out.slice(0, 300));

    // ---- 8: nothing written after a refusal, an older output removed
    const bad8 = [];
    writeFile(CK, "{}"); writeFile(SH, "{}");
    const r8 = go({ a: "grew 12" });
    if (r8.code !== 1 || !gone()) bad8.push("older outputs after a refusal: exit " + r8.code + ", checked " + fs.existsSync(CK) + ", sheet " + fs.existsSync(SH));
    check("case 8: after a refusal neither output file exists, also when both existed before the run", bad8.length === 0, bad8.join(" | "));

    // ---- 9: exit 3
    const bad9 = [], re3 = /^BLOCKED: .+ \| unblocks: .+/m;
    const ex3 = (r, label) => { if (r.code !== 3 || !re3.test(r.out)) bad9.push(label + ": exit " + r.code + " " + JSON.stringify(r.out.slice(0, 200))); };
    ex3(go("[1]"), "a list as the analysis");
    ex3(go("not json"), "an analysis that is not JSON");
    fs.rmSync(path.join(pewp, "analysis.json"));
    ex3(run([URL_KEY, "--cwd", tmp]), "no analysis file");
    ex3(run([URL_KEY, "--cwd", tmp, "--analysis", path.join(tmp, "nowhere.json")]), "no analysis file named");
    fs.renameSync(path.join(pewp, "profile.json"), path.join(pewp, "profile.hold"));
    ex3(go({ a: "x" }), "no profile.json");
    fs.renameSync(path.join(pewp, "profile.hold"), path.join(pewp, "profile.json"));
    check("case 9: no profile.json, no analysis file and an analysis that is a list or not JSON each exit 3 with BLOCKED and unblocks", bad9.length === 0, bad9.join(" | "));

    // ---- 10: usage and the second key form, and --analysis
    const bad10 = [];
    if (run(["--cwd", tmp]).code !== 2) bad10.push("no key is not exit 2");
    if (run(["profile:Bad Slug", "--cwd", tmp]).code !== 2) bad10.push("a bad profile key is not exit 2");
    const pp = mk("acme"); writeFile(path.join(pp, "profile.json"), { ...PROFILE, key: "profile:acme", host: null });
    writeFile(path.join(tmp, "mine.json"), { a: "Score " + S("facts/f.json", "score") });
    const r10 = run(["profile:acme", "--cwd", tmp, "--analysis", path.join(tmp, "mine.json")]);
    if (r10.code !== 0 || !fs.existsSync(path.join(pp, "analysis.checked.json")) || !fs.existsSync(path.join(pp, "analysis.sheet.json"))) bad10.push("profile key with --analysis: exit " + r10.code + " " + r10.out.slice(0, 200));
    check("case 10: no key and a bad profile key exit 2; profile:<slug> with --analysis FILE passes and writes both outputs into that run's folder", bad10.length === 0, bad10.join(" | "));

    // ---- 11: the module and this test
    const dashes = [String.fromCharCode(8212), String.fromCharCode(8211)];
    const bad11 = ["analysis-check.mjs", "test-analysis-check.mjs"].filter((f) => { let s = ""; try { s = fs.readFileSync(path.join(dir, f), "utf8"); } catch { return true; } return dashes.some((d) => s.includes(d)); });
    check("case 11: the module and this test hold no em dash and no en dash", bad11.length === 0, bad11.join());
  } finally { rmTmp(tmp); }
  return results;
}

const AC = "analysis-check.mjs";
const MUTANTS = [
  { name: "the digit rule is off", patches: [{ file: AC, from: "if (/\\d/.test(outside))", to: "if (false)" }], expect: [/^case 2:/, /^case 7:/] },
  { name: "the gathered rule is off (any existing file passes)", patches: [{ file: AC, from: "if (!hit) {", to: "if (false) {" }], expect: [/^case 3:/] },
  { name: ".. is allowed in a file name", patches: [{ file: AC, from: 'p === "." || p === ".."', to: 'p === "."' }], expect: [/^case 4:/] },
  { name: "a path that leads to null is accepted", patches: [{ file: AC, from: "if (v === null) return", to: "if (false) return" }], expect: [/^case 5:/] },
  { name: "the outputs are written on a refusal", patches: [{ file: AC, from: "for (const p of r.problems) console.log(", to: 'fs.writeFileSync(checkedF, "{}"); fs.writeFileSync(sheetF, "{}"); for (const p of r.problems) console.log(' }], expect: [/^case 2:/, /^case 8:/] },
  { name: "only the first problem is listed", patches: [{ file: AC, from: "for (const p of r.problems) console.log(", to: "for (const p of r.problems.slice(0, 1)) console.log(" }], expect: [/^case 7:/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-analysis-check.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "ANALYSIS CHECK", scenarios, MUTANTS, scriptsDir, argv: A }));
}
