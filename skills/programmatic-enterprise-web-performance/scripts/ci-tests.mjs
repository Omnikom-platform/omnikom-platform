// Usage: node ci-tests.mjs [--mutants] [--scripts <dir>]
// Runs the tests of this skill that GitHub runs: the list is <dir>/ci-tests.json, every test is <dir>/<file>. <dir> defaults to
// this file's own folder. GitHub's `audit` job starts it twice: the step "Search skill tests" (no argument) and the step
// "Search skill mutants" (--mutants: each test's seeded faults). Every listed test is started, one after another, each as a
// child (the same node, 256 MB), even when an earlier one was red; only exit code 0 is green. A list that is missing, not JSON,
// empty, wrongly formed, with a repeated name or naming a file that is not there is a STOP: exit 1, no test started.
// The rule for the list: a test goes in only when it has been seen green, with its seeded faults, on GitHub's runner.
// Exit 0 = every listed test green; 1 = a red test or a STOP; 2 = a wrong argument.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
let mutantsMode = false;
let dir = here;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--mutants") mutantsMode = true;
  else if (args[i] === "--scripts" && i + 1 < args.length) dir = path.resolve(args[++i]);
  else { console.log("Usage: node ci-tests.mjs [--mutants] [--scripts <dir>]"); process.exit(2); }
}
const stop = (msg) => { console.log(msg); process.exit(1); };
const NAME = /^test-[a-z0-9-]+\.mjs$/;
const strings = (a) => Array.isArray(a) && a.every((w) => typeof w === "string");

const listFile = path.join(dir, "ci-tests.json");
if (!fs.existsSync(listFile)) stop(`STOP: the list ${listFile} is missing`);
let list;
try { list = JSON.parse(fs.readFileSync(listFile, "utf8")); } catch (e) { stop(`STOP: the list is not JSON (${e.message})`); }
if (!Array.isArray(list) || list.length === 0) stop("STOP: the list is not a non-empty array");
const seen = new Set();
list.forEach((e, i) => {
  if (!e || typeof e !== "object") stop(`STOP: entry ${i + 1} is not an object`);
  if (typeof e.file !== "string" || !NAME.test(e.file)) stop(`STOP: entry ${i + 1} has no file that is a plain test file name`);
  if (!strings(e.plain) || !strings(e.mutants)) stop(`STOP: ${e.file} needs plain and mutants as arrays of strings`);
  if (seen.has(e.file)) stop(`STOP: ${e.file} is listed twice`);
  seen.add(e.file);
});
for (const e of list) {
  if (!fs.existsSync(path.join(dir, e.file))) stop(`STOP: ${e.file} is listed but is not in ${dir}`);
}

const red = [];
for (const e of list) {
  const words = mutantsMode ? e.mutants : e.plain;
  console.log(["ci-tests:", e.file, ...words].join(" "));
  const r = spawnSync(process.execPath, ["--max-old-space-size=256", path.join(dir, e.file), ...words], { stdio: "inherit" }); // no-timeout: the seeded faults take minutes; the job's own timeout-minutes ends a hang
  const green = r.status === 0;
  if (!green) red.push(e.file);
}
const g = list.length - red.length;
console.log(`ci-tests: ${g} of ${list.length} green${red.length ? "; RED: " + red.join(", ") : ""}`);
process.exit(red.length ? 1 : 0);
