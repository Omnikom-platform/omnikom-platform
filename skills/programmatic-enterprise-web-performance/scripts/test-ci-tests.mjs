// Usage: node test-ci-tests.mjs [--scripts <dir>] [--ci-yml <file>] [--ruleset <file>] [--quiet] [--mutants] [--only <id>]
// Test of ci-tests.mjs (the runner of the skill's tests that GitHub runs, list: ci-tests.json).
// Every case makes a temporary folder with STUB tests it writes itself and a list, and starts the runner on that folder with
// --scripts. The real list is only READ (case 6), never run: running it would start this test again, without end.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time in ci-tests.mjs, runs this test against the copy and
//   requires the named case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs
//   anywhere but once is refused).
// Case 7 reads .github/workflows/ci.yml (default: the one two folders above the skill; --ci-yml names another) as text: one job runs the plain
// ci-tests.mjs ("search skill (tests)", no mutants), three jobs written out run ci-tests.mjs --mutants --shard i/3 (i = 1, 2, 3), equal but for
// the shard number, each with timeout-minutes 40 or more (2026-11-28, CI-SHARD). Case 11 reads .github/master-ruleset.json (--ruleset names another):
// the four job names are required checks and the old name "search skill (tests and mutants)" is gone. Cases 8 to 10 run the runner's --shard on
// stub tests (case 10: the real ci-tests.json too): every entry is started by exactly one of the shards 1/3, 2/3, 3/3.
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
const ciYml = path.resolve(args.includes("--ci-yml") ? args[args.indexOf("--ci-yml") + 1] : path.join(skill, "..", "..", ".github", "workflows", "ci.yml"));
const rulesetFile = path.resolve(args.includes("--ruleset") ? args[args.indexOf("--ruleset") + 1] : path.join(skill, "..", "..", ".github", "master-ruleset.json"));

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "red-child-counted-green", file: "ci-tests.mjs", from: "const green = r.status === 0;", to: "const green = true;", red: "case 2:" },
    { id: "missing-file-skipped", file: "ci-tests.mjs", from: 'if (!fs.existsSync(path.join(dir, e.file))) stop(`STOP: ${e.file} is listed but is not in ${dir}`);', to: "", red: "case 4:" },
    { id: "stops-at-first-red", file: "ci-tests.mjs", from: "if (!green) red.push(e.file);", to: "if (!green) { red.push(e.file); break; }", red: "case 2:" },
    { id: "mutants-words-not-passed", file: "ci-tests.mjs", from: "const words = mutantsMode ? e.mutants : e.plain;", to: "const words = e.plain;", red: "case 3:" },
    { id: "name-pattern-unchecked", file: "ci-tests.mjs", from: "if (typeof e.file !== \"string\" || !NAME.test(e.file)) stop(`STOP: entry ${i + 1} has no file that is a plain test file name`);", to: "", red: "case 5:" },
    { id: "shard-i-over-n-accepted",file: "ci-tests.mjs",from: " || Number(m[1]) > Number(m[2])",to: "",red: "case 9:" },
    { id: "shard-twice-accepted",file: "ci-tests.mjs",from: " && shard === null",to: "",red: "case 9:" },
    { id: "shard-without-mutants-accepted",file: "ci-tests.mjs",from: "if (shard && !mutantsMode) usage();",to: "",red: "case 9:" },
    { id: "shard-zero-accepted",file: "ci-tests.mjs",from: "/^([1-9][0-9]*)\\/([1-9][0-9]*)$/",to: "/^([0-9]+)\\/([0-9]+)$/",red: "case 9:" },
    { id: "empty-shard-green",file: "ci-tests.mjs",from: "if (shard && mine.length === 0) stop(",to: "if (false) stop(",red: "case 8:" },
    { id: "shard-first-line-missing",file: "ci-tests.mjs",from: "if (shard) console.log(",to: "if (false) console.log(",red: "case 8:" },
    { id: "last-line-counts-whole-list",file: "ci-tests.mjs",from: "${g} of ${mine.length} green",to: "${g} of ${list.length} green",red: "case 8:" },
    { id: "last-line-names-no-shard",file: "ci-tests.mjs",from: "${shard ? ` [shard ${shard.i} of ${shard.n}]` : \"\"}",to: "",red: "case 8:" },
    { id: "no-shard-runs-first-only",file: "ci-tests.mjs",from: "shard.i - 1) : list;",to: "shard.i - 1) : list.slice(0, 1);",red: "case 8:" },
    { id: "stop-only-for-own-entries",file: "ci-tests.mjs",from: "for (const e of list) {\n  if (!fs.existsSync(",to: "for (const e of mine) {\n  if (!fs.existsSync(",red: "case 8:" },
    { id: "shard-entry-in-two",file: "ci-tests.mjs",from: "x % shard.n === shard.i - 1)",to: "x % shard.n === shard.i - 1 || x === 0)",red: "case 10:" },
    { id: "shard-entry-in-none",file: "ci-tests.mjs",from: "x % shard.n === shard.i - 1)",to: "x % shard.n === shard.i - 1 && x !== 0)",red: "case 10:" },
    { id: "shard-runs-whole-list",file: "ci-tests.mjs",from: "x % shard.n === shard.i - 1)",to: "(shard.i === 1 || x % shard.n === shard.i - 1))",red: "case 10:" },
    { id: "shard-off-by-one",file: "ci-tests.mjs",from: "x % shard.n === shard.i - 1)",to: "x % shard.n === shard.i)",red: "case 10:" },
    { id: "ci-yml-shard-job-missing",file: "ci.yml",yml: true,from: "name: search skill mutants, shard 3 of 3\n",to: "name: search skill mutants, shard 3 of 4\n",red: "case 7:" },
    { id: "ci-yml-shard-names-other-shard",file: "ci.yml",yml: true,from: "ci-tests.mjs --mutants --shard 3/3\n",to: "ci-tests.mjs --mutants --shard 2/3\n",red: "case 7:" },
    { id: "ci-yml-shard-names-other-n",file: "ci.yml",yml: true,from: "ci-tests.mjs --mutants --shard 1/3\n",to: "ci-tests.mjs --mutants --shard 1/4\n",red: "case 7:" },
    { id: "ci-yml-shards-differ-timeout",file: "ci.yml",yml: true,from: "shard 2 of 3\n    runs-on: ubuntu-latest\n    timeout-minutes: 40\n",to: "shard 2 of 3\n    runs-on: ubuntu-latest\n    timeout-minutes: 45\n",red: "case 7:" },
    { id: "ci-yml-shards-differ-runner",file: "ci.yml",yml: true,from: "shard 3 of 3\n    runs-on: ubuntu-latest\n",to: "shard 3 of 3\n    runs-on: ubuntu-22.04\n",red: "case 7:" },
    { id: "ci-yml-tests-job-runs-mutants",file: "ci.yml",yml: true,from: "      - name: Search skill tests\n        run: node skills/programmatic-enterprise-web-performance/scripts/ci-tests.mjs\n",to: "      - name: Search skill tests\n        run: node skills/programmatic-enterprise-web-performance/scripts/ci-tests.mjs\n      - name: Search skill mutants\n        run: node skills/programmatic-enterprise-web-performance/scripts/ci-tests.mjs --mutants\n",red: "case 7:" },
    { id: "ruleset-lacks-a-shard",file: "master-ruleset.json",rs: true,from: "          { \"context\": \"search skill mutants, shard 2 of 3\", \"integration_id\": 15368 },\n",to: "",red: "case 11:" },
    { id: "ruleset-keeps-old-name",file: "master-ruleset.json",rs: true,from: "          { \"context\": \"search skill (tests)\", \"integration_id\": 15368 },\n",to: "          { \"context\": \"search skill (tests)\", \"integration_id\": 15368 },\n          { \"context\": \"search skill (tests and mutants)\", \"integration_id\": 15368 },\n",red: "case 11:" },
    { id: "empty-list-counted-green", file: "ci-tests.mjs", from: "if (!Array.isArray(list) || list.length === 0) stop(\"STOP: the list is not a non-empty array\");", to: "", red: "case 5:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "citests-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = m.yml ? path.join(copy, "ci.yml") : m.rs ? path.join(copy, "master-ruleset.json") : path.join(copy, "scripts", m.file);
    if (m.yml) fs.copyFileSync(ciYml, f);
    if (m.rs) fs.copyFileSync(rulesetFile, f);
    const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-ci-tests.mjs"), "--scripts", path.join(copy, "scripts"), "--ci-yml", m.yml ? f : ciYml, "--ruleset", m.rs ? f : rulesetFile, "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
  for (const must of ["test-ci-tests.mjs", "test-client-copy.mjs", "test-step-gate.mjs"]) if (!seen.has(must)) bad.push(`${must} is not listed`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 6: the real list is valid by the runner's rules, every file exists, and it holds this test, the client copy test and the step gate test", ok, detail); }

// ci.yml: the jobs are the keys of two spaces under the top-level jobs:; a run line is a line "run: ..." of a step; a job's body is its lines
// without the blank lines and the two-space comments between jobs (those belong to the next job's header)
function parseJobs(file) {
  if (!fs.existsSync(file)) throw new Error(file + " is not there");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (at < 0) throw new Error("ci.yml has no jobs: key");
  const jobs = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const h = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(l);
    if (h) jobs.push({ id: h[1], name: null, runs: [], timeout: null, body: [] });
    const j = jobs[jobs.length - 1]; if (!j) continue;
    if (/^\s*$/.test(l) || /^ {2}#/.test(l)) continue;
    j.body.push(l);
    const n = /^ {4}name:\s*(.*?)\s*$/.exec(l); if (n) j.name = n[1];
    const r = /^\s+(?:- )?run:\s*(.*)$/.exec(l); if (r) j.runs.push(r[1].trim());
    const t = /^ {4}timeout-minutes:\s*(\d+)\s*(#.*)?$/.exec(l); if (t) j.timeout = Number(t[1]);
  }
  return jobs;
}
const CI_CMD = "node skills/programmatic-enterprise-web-performance/scripts/ci-tests.mjs";
const TESTS_JOB = "search skill (tests)";
const SHARD_JOB = (i) => "search skill mutants, shard " + i + " of 3";
const OLD_JOB = "search skill (tests and mutants)";
const runsCiTests = (j) => j.runs.some((x) => x.includes("ci-tests.mjs"));

{ const [ok, detail] = T(() => {
  const jobs = parseJobs(ciYml);
  const bad = [];
  const withCi = jobs.filter(runsCiTests);
  const tests = jobs.filter((j) => j.name === TESTS_JOB);
  if (tests.length !== 1) bad.push(tests.length + " jobs are named \"" + TESTS_JOB + "\" (one needed)");
  else {
    const t = tests[0];
    if (t.runs.filter((x) => x === CI_CMD).length !== 1) bad.push("job " + t.id + " must run \"" + CI_CMD + "\" once");
    if (t.runs.some((x) => x.includes("--mutants"))) bad.push("job " + t.id + " (the tests job) runs --mutants");
    if (t.runs.some((x) => x.includes("tools/audit/test/mutate.mjs"))) bad.push("job " + t.id + " also runs tools/audit/test/mutate.mjs");
  }
  const shardJobs = [];
  for (let i = 1; i <= 3; i++) {
    const s = jobs.filter((j) => j.name === SHARD_JOB(i));
    if (s.length !== 1) { bad.push(s.length + " jobs are named \"" + SHARD_JOB(i) + "\" (one needed)"); continue; }
    shardJobs.push(s[0]);
    const cmds = s[0].runs.filter((x) => x.includes("ci-tests.mjs"));
    if (cmds.length !== 1 || cmds[0] !== CI_CMD + " --mutants --shard " + i + "/3") bad.push("job \"" + SHARD_JOB(i) + "\" runs " + JSON.stringify(cmds) + ", it must run only \"" + CI_CMD + " --mutants --shard " + i + "/3\"");
  }
  for (const j of withCi) if (j.name !== TESTS_JOB && !shardJobs.includes(j)) bad.push("job " + j.id + " (" + j.name + ") runs ci-tests.mjs and is not the tests job or one of the three shards");
  if (shardJobs.length === 3) {
    const norm = (j) => j.body.join("\n").replace(/(search-skill-mutants-)\d+/g, "$1N").replace(/shard [1-3] of 3/g, "shard N of 3").replace(/--shard [1-3]\/3/g, "--shard N/3");
    const bodies = shardJobs.map(norm);
    shardJobs.forEach((j, k) => {
      if (k === 0 || bodies[k] === bodies[0]) return;
      const x = bodies[0].split("\n"), y = bodies[k].split("\n");
      const at = x.findIndex((l, i) => l !== y[i]);
      bad.push("the shard jobs differ in more than the shard number: job " + j.id + " against job " + shardJobs[0].id + " at body line " + (at < 0 ? "after the end" : at + 1) + (at < 0 ? "" : " (\"" + (y[at] || "").trim() + "\")"));
    });
  }
  for (const j of withCi) if (!(j.timeout >= 40)) bad.push("job " + j.id + " has timeout-minutes " + j.timeout + ", 40 or more needed");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 7: ci.yml has the tests job (plain, no mutants) and three written-out shard jobs ci-tests.mjs --mutants --shard i/3, equal but for the shard number, each with timeout-minutes 40 or more", ok, detail); }

// ---------------------------------------------------------------- --shard (CI-SHARD)
// seven stub tests a..g: the entry at index x belongs to shard (x mod 3) + 1: shard 1 = a, d, g; shard 2 = b, e; shard 3 = c, f
const NAMES7 = ["a", "b", "c", "d", "e", "f", "g"].map((x) => "test-" + x + ".mjs");
const list7 = () => NAMES7.map((n) => ({ file: n, plain: ["--p" + n[5]], mutants: ["--mutants", "--only", "m" + n[5]] }));
const stubs7 = (over = {}) => Object.assign(Object.fromEntries(NAMES7.map((n) => [n, 0])), over);
const MUT_ARGS = (n) => ["--mutants", "--only", "m" + n[5]];

{ const [ok, detail] = T(() => {
  const bad = [];
  const want = { 1: ["test-a.mjs", "test-d.mjs", "test-g.mjs"], 2: ["test-b.mjs", "test-e.mjs"], 3: ["test-c.mjs", "test-f.mjs"] };
  for (const i of [1, 2, 3]) {
    const d = mkdir(stubs7(), list7());
    const r = go(d, ["--mutants", "--shard", i + "/3"]);
    const w = want[i];
    const first = "ci-tests: shard " + i + " of 3 runs " + w.length + " of 7 entries";
    if (r.code !== 0) bad.push("shard " + i + ": exit " + r.code);
    if (r.lines[0] !== first) bad.push("shard " + i + ": first line \"" + r.lines[0] + "\", wanted \"" + first + "\"");
    const last = "ci-tests: " + w.length + " of " + w.length + " green [shard " + i + " of 3]";
    if (r.last !== last) bad.push("shard " + i + ": last line \"" + r.last + "\", wanted \"" + last + "\"");
    for (const n of NAMES7) {
      const s = started(d, n);
      if (w.includes(n) ? (s.length !== 1 || JSON.stringify(s[0]) !== JSON.stringify(MUT_ARGS(n))) : s.length !== 0) bad.push("shard " + i + ": " + n + " started " + JSON.stringify(s));
    }
    const at = w.map((n) => r.lines.indexOf("ci-tests: " + n + " " + MUT_ARGS(n).join(" ")));
    if (at.some((x, k) => x < 0 || (k > 0 && x < at[k - 1]))) bad.push("shard " + i + ": own entries not started in list order (" + at.join(",") + ")");
  }
  // the order of the words does not matter
  { const d = mkdir(stubs7(), list7()); const r = go(d, ["--shard", "3/3", "--mutants"]); if (r.code !== 0 || r.last !== "ci-tests: 2 of 2 green [shard 3 of 3]") bad.push("--shard before --mutants: exit " + r.code + ", last \"" + r.last + "\""); }
  // a red test in a shard: the other entries of the shard are still started, the last line names the red one and the shard
  { const d = mkdir(stubs7({ "test-d.mjs": 1 }), list7()); const r = go(d, ["--mutants", "--shard", "1/3"]);
    if (r.code !== 1 || r.last !== "ci-tests: 2 of 3 green; RED: test-d.mjs [shard 1 of 3]") bad.push("red in shard: exit " + r.code + ", last \"" + r.last + "\"");
    if (started(d, "test-g.mjs").length !== 1) bad.push("red in shard: test-g.mjs (after the red one) was not started"); }
  // without --shard every entry is started, as before, with no shard line
  { const d = mkdir(stubs7(), list7()); const r = go(d, ["--mutants"]);
    if (r.code !== 0 || r.last !== "ci-tests: 7 of 7 green" || r.lines[0] !== "ci-tests: test-a.mjs --mutants --only ma" || NAMES7.some((n) => started(d, n).length !== 1)) bad.push("no shard: exit " + r.code + ", first \"" + r.lines[0] + "\", last \"" + r.last + "\""); }
  // n larger than the list: a shard with no entry is a STOP, never a silent green
  { const d = mkdir(stubs7(), list7()); const r = go(d, ["--mutants", "--shard", "8/8"]);
    if (r.code !== 1 || !r.lines.some((l) => l.startsWith("STOP: ")) || !nothingStarted(d, NAMES7)) bad.push("empty shard: exit " + r.code + ", out \"" + r.out.slice(0, 120) + "\", started " + NAMES7.map((n) => started(d, n).length).join("")); }
  // a bad list stops every shard: a listed file that is missing (it belongs to shard 3) stops shard 1, nothing started; so does a list that is not JSON
  { const s = stubs7(); delete s["test-c.mjs"]; const d = mkdir(s, list7()); const r = go(d, ["--mutants", "--shard", "1/3"]);
    if (r.code !== 1 || !r.lines.some((l) => l.startsWith("STOP: ") && l.includes("test-c.mjs")) || !nothingStarted(d, NAMES7)) bad.push("missing file of another shard: exit " + r.code + ", out \"" + r.out.slice(0, 120) + "\"");
    const d2 = mkdir(stubs7(), "this is { not json"); const r2 = go(d2, ["--mutants", "--shard", "2/3"]);
    if (r2.code !== 1 || !r2.lines.some((l) => l.startsWith("STOP: ")) || !nothingStarted(d2, NAMES7)) bad.push("bad JSON with a shard: exit " + r2.code + ", out \"" + r2.out.slice(0, 120) + "\""); }
  return [bad.length === 0, bad.join(" | ")];
}); check("case 8: --mutants --shard i/3 starts only the entries at index mod 3 = i-1, in list order, with their mutants words; first line says the shard and how many entries, last line counts the shard's own and names it; no shard = all; an empty shard and every bad list are a STOP", ok, detail); }

{ const [ok, detail] = T(() => {
  const bad = [];
  const forms = [
    ["0/3", ["--mutants", "--shard", "0/3"]], ["4/3", ["--mutants", "--shard", "4/3"]], ["a/3", ["--mutants", "--shard", "a/3"]],
    ["2", ["--mutants", "--shard", "2"]], ["1/0", ["--mutants", "--shard", "1/0"]], ["-1/3", ["--mutants", "--shard", "-1/3"]],
    ["1.5/3", ["--mutants", "--shard", "1.5/3"]], ["1/3/3", ["--mutants", "--shard", "1/3/3"]], ["empty", ["--mutants", "--shard", ""]],
    ["twice", ["--mutants", "--shard", "1/3", "--shard", "1/3"]], ["no --mutants", ["--shard", "1/3"]], ["no value", ["--mutants", "--shard"]],
    ["value is a flag", ["--shard", "--mutants"]],
  ];
  for (const [what, extra] of forms) {
    const d = mkdir(stubs7(), list7());
    const r = go(d, extra);
    if (r.code !== 2 || !r.lines.some((l) => l.startsWith("Usage: ")) || !nothingStarted(d, NAMES7)) bad.push(what + ": exit " + r.code + ", out \"" + r.out.slice(0, 80) + "\", started " + NAMES7.map((n) => started(d, n).length).join(""));
  }
  return [bad.length === 0, bad.join(" | ")];
}); check("case 9: a wrong --shard (0/3, 4/3, a/3, 2, 1/0, twice, without --mutants, ...) is the usage line and exit 2, nothing started", ok, detail); }

// every entry of a list is started by exactly one of the shards 1/n .. n/n, and by the shard (index mod n) + 1: read from the .log files the stubs write
function partition(list, n) {
  const names = list.map((e) => e.file);
  const d = mkdir(Object.fromEntries(names.map((x) => [x, 0])), list);
  const bad = [];
  const prev = Object.fromEntries(names.map((x) => [x, 0]));
  const seenBy = Object.fromEntries(names.map((x) => [x, []]));
  for (let i = 1; i <= n; i++) {
    const r = go(d, ["--mutants", "--shard", i + "/" + n]);
    if (r.code !== 0) bad.push("shard " + i + "/" + n + ": exit " + r.code + " \"" + r.last + "\"");
    for (const x of names) { const c = started(d, x).length; for (let k = prev[x]; k < c; k++) seenBy[x].push(i); prev[x] = c; }
  }
  names.forEach((x, idx) => { const s = seenBy[x]; const want = [(idx % n) + 1]; if (JSON.stringify(s) !== JSON.stringify(want)) bad.push(x + " (index " + idx + ") was started by shards [" + s + "], wanted [" + want + "]"); });
  return bad;
}
{ const [ok, detail] = T(() => {
  const bad = [];
  const made = ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => ({ file: "test-" + x + ".mjs", plain: [], mutants: ["--mutants"] }));
  for (const m of partition(made, 3)) bad.push("made-up list: " + m);
  const f = path.join(dir, "ci-tests.json");
  if (!fs.existsSync(f)) return [false, "ci-tests.json is not in " + dir];
  const real = JSON.parse(fs.readFileSync(f, "utf8"));
  if (!Array.isArray(real) || real.length < 3) return [false, "the real list is not an array of 3 or more entries"];
  for (const m of partition(real, 3)) bad.push("real list: " + m);
  return [bad.length === 0, bad.slice(0, 6).join(" | ")];
}); check("case 10: for n = 3 every entry of a made-up list and of the REAL ci-tests.json is started by exactly one of the shards 1/3, 2/3, 3/3 (the union is the whole list, none twice, none missing), the shard (index mod 3) + 1", ok, detail); }

{ const [ok, detail] = T(() => {
  if (!fs.existsSync(rulesetFile)) return [false, rulesetFile + " is not there"];
  const rs = JSON.parse(fs.readFileSync(rulesetFile, "utf8")).rules.find((r) => r.type === "required_status_checks");
  if (!rs) return [false, "the ruleset has no required_status_checks rule"];
  const ctx = rs.parameters.required_status_checks.map((c) => c.context);
  const jobs = parseJobs(ciYml);
  const bad = [];
  for (const j of jobs.filter(runsCiTests)) {
    const k = ctx.filter((c) => c === j.name).length;
    if (k !== 1) bad.push("the job name \"" + j.name + "\" (job " + j.id + ") is in the ruleset " + k + " times (once needed)");
  }
  for (const n of [TESTS_JOB, SHARD_JOB(1), SHARD_JOB(2), SHARD_JOB(3)]) if (!ctx.includes(n)) bad.push("the ruleset has no context \"" + n + "\"");
  if (ctx.includes(OLD_JOB)) bad.push("the ruleset still has the old context \"" + OLD_JOB + "\"");
  if (jobs.some((j) => j.name === OLD_JOB)) bad.push("ci.yml still has a job named \"" + OLD_JOB + "\"");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 11: every job name of ci.yml that runs ci-tests.mjs is a required check of master-ruleset.json (once), the four names are all there and the old name is gone from both", ok, detail); }

fs.rmSync(tmp, { recursive: true, force: true });
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).map((r) => r.name.split(":")[0]);
console.log(`${passed}/${results.length} passed${failed.length ? "; FAILED: " + failed.join(", ") : ""}`);
process.exit(passed === results.length ? 0 : 1);
