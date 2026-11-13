// Usage: node test-ci-tests.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of ci-tests.mjs (the runner of the skill's tests that GitHub runs, list: ci-tests.json).
// Every case makes a temporary folder with STUB tests it writes itself and a list, and starts the runner on that folder with
// --scripts. The real list is only READ (case 6), never run: running it would start this test again, without end.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time in ci-tests.mjs, runs this test against the copy and
//   requires the named case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs
//   anywhere but once is refused).
// Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "red-child-counted-green", file: "ci-tests.mjs", from: "const green = r.status === 0;", to: "const green = true;", red: "case 2:" },
    { id: "missing-file-skipped", file: "ci-tests.mjs", from: 'if (!fs.existsSync(path.join(dir, e.file))) stop(`STOP: ${e.file} is listed but is not in ${dir}`);', to: "", red: "case 4:" },
    { id: "stops-at-first-red", file: "ci-tests.mjs", from: "if (!green) red.push(e.file);", to: "if (!green) { red.push(e.file); break; }", red: "case 2:" },
    { id: "mutants-words-not-passed", file: "ci-tests.mjs", from: "const words = mutantsMode ? e.mutants : e.plain;", to: "const words = e.plain;", red: "case 3:" },
    { id: "name-pattern-unchecked", file: "ci-tests.mjs", from: "if (typeof e.file !== \"string\" || !NAME.test(e.file)) stop(`STOP: entry ${i + 1} has no file that is a plain test file name`);", to: "", red: "case 5:" },
    { id: "empty-list-counted-green", file: "ci-tests.mjs", from: "if (!Array.isArray(list) || list.length === 0) stop(\"STOP: the list is not a non-empty array\");", to: "", red: "case 5:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "citests-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-ci-tests.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 300000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (case measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected case"} | expected "${m.red}" | failed: ${failed.join(" ; ").slice(0, 160) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "citests-"));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };
const T = (fn) => { try { const r = fn(); return [r[0], r[1]]; } catch (e) { return [false, e.stack || String(e)]; } };
const runner = path.join(dir, "ci-tests.mjs");
let seq = 0;

// a stub test: appends its own arguments (one JSON line per start) to a .log beside it, then ends as the case needs
const stub = (code) => 'import fs from "node:fs";\nimport { fileURLToPath } from "node:url";\n'
  + 'fs.appendFileSync(fileURLToPath(import.meta.url).replace(/\\.mjs$/, ".log"), JSON.stringify(process.argv.slice(2)) + "\\n");\n'
  + (code === "kill" ? 'process.kill(process.pid, "SIGKILL");\n' : `process.exit(${code});\n`);
// a folder with the stubs {name: exit code or "kill"} and a list (an object to write as JSON, or a string written as is, or null for no list)
function mkdir(stubs, list) {
  const d = path.join(tmp, "c" + (++seq)); fs.mkdirSync(d, { recursive: true });
  for (const [n, code] of Object.entries(stubs)) fs.writeFileSync(path.join(d, n), stub(code));
  if (list !== null) fs.writeFileSync(path.join(d, "ci-tests.json"), typeof list === "string" ? list : JSON.stringify(list));
  return d;
}
const go = (d, extra = []) => {
  const r = spawnSync(process.execPath, ["--max-old-space-size=256", runner, "--scripts", d, ...extra], { encoding: "utf8", timeout: 60000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const lines = out.split(/\r?\n/).filter((l) => l.trim() !== "");
  return { code: r.status, out, lines, last: lines[lines.length - 1] || "" };
};
const started = (d, n) => { const f = path.join(d, n.replace(/\.mjs$/, ".log")); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; };
const nothingStarted = (d, names) => names.every((n) => started(d, n).length === 0);
const two = (plainA, plainB, mutA = ["--mutants"], mutB = ["--mutants"]) => [
  { file: "test-a.mjs", plain: plainA, mutants: mutA },
  { file: "test-b.mjs", plain: plainB, mutants: mutB },
];

// ---------------------------------------------------------------- the cases
{ const [ok, detail] = T(() => {
  const d = mkdir({ "test-a.mjs": 0, "test-b.mjs": 0 }, two(["--quiet"], []));
  const r = go(d);
  const sa = started(d, "test-a.mjs"), sb = started(d, "test-b.mjs");
  const ia = r.lines.indexOf("ci-tests: test-a.mjs --quiet"), ib = r.lines.indexOf("ci-tests: test-b.mjs");
  return [r.code === 0 && r.last === "ci-tests: 2 of 2 green" && sa.length === 1 && sb.length === 1
    && JSON.stringify(sa[0]) === JSON.stringify(["--quiet"]) && JSON.stringify(sb[0]) === "[]" && ia >= 0 && ib > ia,
    `code ${r.code}; last "${r.last}"; a ${JSON.stringify(sa)}; b ${JSON.stringify(sb)}; lines at ${ia},${ib}`];
}); check("case 1: two green tests: both started once in list order with their plain words; last line says 2 of 2 green", ok, detail); }

{ const [ok, detail] = T(() => {
  const bad = []; let d, r;
  d = mkdir({ "test-a.mjs": 1, "test-b.mjs": 0 }, two([], []));
  r = go(d);
  if (r.code !== 1) bad.push(`exit ${r.code}`);
  if (r.last !== "ci-tests: 1 of 2 green; RED: test-a.mjs") bad.push(`last "${r.last}"`);
  if (started(d, "test-b.mjs").length !== 1) bad.push("second test was not started after the first was red");
  d = mkdir({ "test-a.mjs": 0, "test-b.mjs": "kill" }, two([], []));
  r = go(d);
  if (r.code !== 1 || r.last !== "ci-tests: 1 of 2 green; RED: test-b.mjs") bad.push(`killed child: exit ${r.code}, last "${r.last}"`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 2: a red test and a killed test are red, every listed test is still started, the last line names them", ok, detail); }

{ const [ok, detail] = T(() => {
  const d = mkdir({ "test-a.mjs": 0, "test-b.mjs": 0 }, two(["--quiet"], ["--x"], ["--mutants", "--only", "m1"], ["--mutants"]));
  const r = go(d, ["--mutants"]);
  const sa = started(d, "test-a.mjs"), sb = started(d, "test-b.mjs");
  return [r.code === 0 && r.last === "ci-tests: 2 of 2 green" && sa.length === 1 && sb.length === 1
    && JSON.stringify(sa[0]) === JSON.stringify(["--mutants", "--only", "m1"]) && JSON.stringify(sb[0]) === JSON.stringify(["--mutants"]),
    `code ${r.code}; last "${r.last}"; a ${JSON.stringify(sa)}; b ${JSON.stringify(sb)}`];
}); check("case 3: with --mutants each test gets exactly its mutants words and not its plain words", ok, detail); }

{ const [ok, detail] = T(() => {
  const d = mkdir({ "test-a.mjs": 0 }, two([], []));
  const r = go(d);
  return [r.code === 1 && r.lines.some((l) => l.startsWith("STOP: ") && l.includes("test-b.mjs")) && nothingStarted(d, ["test-a.mjs"]),
    `code ${r.code}; out "${r.out.slice(0, 200)}"; a started ${started(d, "test-a.mjs").length}`];
}); check("case 4: a listed file that is not there is a STOP naming it, exit 1, no test started", ok, detail); }

{ const [ok, detail] = T(() => {
  const bad = [];
  const e = (o) => Object.assign({ file: "test-a.mjs", plain: [], mutants: [] }, o);
  const noFile = { plain: [], mutants: [] };
  const sets = [
    ["no list file", null],
    ["not JSON", "this is { not json"],
    ["an object, not an array", { file: "test-a.mjs" }],
    ["an empty array", []],
    ["an entry with no file", [noFile]],
    ["a file with a folder in it", [e({ file: "../test-a.mjs" })]],
    ["a file that does not match the pattern", [e({ file: "a.mjs" })]],
    ["the same file twice", [e({}), e({})]],
    ["plain is a string", [e({ plain: "--quiet" })]],
    ["mutants is a string", [e({ mutants: "--mutants" })]],
  ];
  for (const [what, list] of sets) {
    const d = mkdir({ "test-a.mjs": 0 }, list);
    const r = go(d);
    if (r.code !== 1 || !r.lines.some((l) => l.startsWith("STOP: ")) || !nothingStarted(d, ["test-a.mjs"])) bad.push(`${what}: exit ${r.code}, out "${r.out.slice(0, 80)}", started ${started(d, "test-a.mjs").length}`);
  }
  const d = mkdir({ "test-a.mjs": 0 }, [e({})]);
  const r = go(d, ["--colour"]);
  if (r.code !== 2 || !r.lines.some((l) => l.startsWith("Usage: ")) || !nothingStarted(d, ["test-a.mjs"])) bad.push(`unknown argument: exit ${r.code}, out "${r.out.slice(0, 80)}"`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 5: every bad list is a STOP with exit 1 and no test started; an unknown argument is Usage, exit 2", ok, detail); }

{ const [ok, detail] = T(() => {
  const f = path.join(dir, "ci-tests.json");
  if (!fs.existsSync(f)) return [false, "ci-tests.json is not in " + dir];
  const list = JSON.parse(fs.readFileSync(f, "utf8"));
  const bad = [];
  if (!Array.isArray(list) || list.length === 0) return [false, "the list is not a non-empty array"];
  const seen = new Set();
  list.forEach((e, i) => {
    if (!e || typeof e.file !== "string" || !/^test-[a-z0-9-]+\.mjs$/.test(e.file)) return bad.push(`entry ${i + 1}: bad file`);
    if (seen.has(e.file)) bad.push(`${e.file} twice`); seen.add(e.file);
    for (const k of ["plain", "mutants"]) if (!Array.isArray(e[k]) || e[k].some((w) => typeof w !== "string")) bad.push(`${e.file}: ${k} is not an array of strings`);
    if (!fs.existsSync(path.join(dir, e.file))) bad.push(`${e.file} is listed but missing`);
  });
  for (const must of ["test-ci-tests.mjs", "test-client-copy.mjs"]) if (!seen.has(must)) bad.push(`${must} is not listed`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 6: the real list is valid by the runner's rules, every file exists, and it holds this test and the client copy test", ok, detail); }

fs.rmSync(tmp, { recursive: true, force: true });
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).map((r) => r.name.split(":")[0]);
console.log(`${passed}/${results.length} passed${failed.length ? "; FAILED: " + failed.join(", ") : ""}`);
process.exit(passed === results.length ? 0 : 1);
