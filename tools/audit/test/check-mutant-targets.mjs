// Checks that every mutant of test/mutants-sec.mjs has its target text exactly once in its file and that the replacement differs (what mutate.mjs counts as
// "target text missing"), without running any mutant. A mutant whose name repeats is also refused.
//   node tools/audit/test/check-mutant-targets.mjs        exit 0 = every target found exactly once
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT = resolve(HERE, "..");
const { SEC_MUTANTS } = await import(pathToFileURL(join(HERE, "mutants-sec.mjs")).href);
let bad = 0;
const names = new Set();
for (const [name, file, from, to] of SEC_MUTANTS) {
  const text = readFileSync(join(AUDIT, file), "utf8");
  const n = text.split(from).length - 1;
  const problems = [];
  if (n !== 1) problems.push(`target text found ${n} times in ${file}`);
  if (from === to) problems.push("replacement equals the target");
  if (names.has(name)) problems.push("name repeated");
  names.add(name);
  if (problems.length) { bad++; console.log(`FAIL ${name}: ${problems.join("; ")}`); }
}
console.log(bad ? `FAILED: ${bad} of ${SEC_MUTANTS.length} mutants have a bad target` : `OK: ${SEC_MUTANTS.length} mutants, every target text found exactly once`);
process.exit(bad ? 1 : 0);
