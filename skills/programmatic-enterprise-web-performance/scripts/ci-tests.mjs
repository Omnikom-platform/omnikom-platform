// Usage: node ci-tests.mjs [--mutants [--shard i/n]] [--scripts <dir>]
// Runs the tests of this skill that GitHub runs: the list is <dir>/ci-tests.json, every test is <dir>/<file>. <dir> defaults to
// this file's own folder. GitHub starts it in four jobs: `search_skill` (no argument: the tests) and the three jobs "search skill mutants,
// shard i of 3" (--mutants --shard i/3: each test's seeded faults). Every listed test is started, one after another, each as a
// child (the same node, 256 MB), even when an earlier one was red; only exit code 0 is green.
// --shard i/n (whole numbers, 1 <= i <= n; only with --mutants, once): the entry at index x of the list (0-based) belongs to shard (x mod n) + 1
// and a shard starts only its own entries, in list order; GitHub runs the three jobs "search skill mutants, shard i of 3" so that the longest
// job is a third of the list (CI-SHARD, 2026-11-28). The first line names the shard and its entry count, the last line counts the shard's own
// entries and names it ("ci-tests: 14 of 15 green [shard 2 of 3]"); a shard with no entry (n larger than the list) is a STOP. Without --shard
// every entry is started. The checks of the list below run for every shard. A list that is missing, not JSON,
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
let shard = null;
let dir = here;
const usage = () => { console.log("Usage: node ci-tests.mjs [--mutants [--shard i/n]] [--scripts <dir>]"); process.exit(2); };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--mutants") mutantsMode = true;
  else if (args[i] === "--scripts" && i + 1 < args.length) dir = path.resolve(args[++i]);
  else if (args[i] === "--shard" && i + 1 < args.length && shard === null) {
    const m = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(args[++i]);
    if (!m || Number(m[1]) > Number(m[2])) usage();
    shard = { i: Number(m[1]), n: Number(m[2]) };
  }
  else usage();
}
if (shard && !mutantsMode) usage();
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
const mine = shard ? list.filter((e, x) => x % shard.n === shard.i - 1) : list;
for (const e of list) {
  if (!fs.existsSync(path.join(dir, e.file))) stop(`STOP: ${e.file} is listed but is not in ${dir}`);
}

if (shard && mine.length === 0) stop(`STOP: shard ${shard.i} of ${shard.n} has no entry (the list has ${list.length})`);
if (shard) console.log(`ci-tests: shard ${shard.i} of ${shard.n} runs ${mine.length} of ${list.length} entries`);

const red = [];
for (const e of mine) {
  const words = mutantsMode ? e.mutants : e.plain;
  console.log(["ci-tests:", e.file, ...words].join(" "));
  const r = spawnSync(process.execPath, ["--max-old-space-size=256", path.join(dir, e.file), ...words], { stdio: "inherit" }); // no-timeout: the seeded faults take minutes; the job's own timeout-minutes ends a hang
  const green = r.status === 0;
  if (!green) red.push(e.file);
}
const g = mine.length - red.length;
console.log(`ci-tests: ${g} of ${mine.length} green${red.length ? "; RED: " + red.join(", ") : ""}${shard ? ` [shard ${shard.i} of ${shard.n}]` : ""}`);
process.exit(red.length ? 1 : 0);
