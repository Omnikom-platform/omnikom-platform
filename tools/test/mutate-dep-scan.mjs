// Mutants for tools/test/dep-scan.mjs: each removes or inverts one rule in a copy; test-dep-scan.mjs must go red for every one.
// Run: node tools/test/mutate-dep-scan.mjs     (exit 0 = every mutant caught; a target text that is not in the file exactly once fails the run)
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, 'dep-scan.mjs'), 'utf8');
const mutants = [
  ['a MAL- id can be allowed', "const hit = f.mal ? null : entries.find(", "const hit = entries.find("],
  ['a MAL- id among the aliases is not noticed', "ids.some(i => i.startsWith('MAL-'))", "[v.id].some(i => i.startsWith('MAL-'))"],
  ['an expired allow entry still allows', "e.until >= today &&", ""],
  ['an expired allow entry is not printed', "if (e.until < today) lines.push(", "if (false) lines.push("],
  ['unparsable output is not an error', "if (!p.ok) return { ok: false, reason: `osv-scanner ${p.reason}` };", "if (!p.ok) return { ok: true, findings: [] };"],
  ['a crash exit code (127, 128) is not an error', "if (run.exit !== 0 && run.exit !== 1) return", "if (false) return"],
  ['a scanner that did not run is not an error', "if (run.error) return", "if (false) return"],
  ['exit 1 with an empty JSON is not an error', "if (run.exit === 1 && p.findings.length === 0) return", "if (false) return"],
  ['exit 0 means clean without reading the JSON', "const p = parseOsv(run.stdout);", "const p = run.exit === 0 ? { ok: true, findings: [] } : parseOsv(run.stdout);"],
  ['a finding does not fail the run', "errors ? 2 : notAllowed ? 1 : 0", "errors ? 2 : 0"],
  ['an allow entry matches any package', "&& (e.package === f.package || e.package === `${f.package}@${f.version}`));", ");"],
  ['an allow entry matches any id', "e.id === f.id && ", ""],
  ['an allow entry may run longer than 30 days', "if (e.until > latest) return", "if (false) return"],
  ['an allow entry needs no reason', "for (const k of ['id', 'package', 'reason'])", "for (const k of ['id', 'package'])"],
  ['an allow entry needs no valid date', "if (!validDate(e.until)) return", "if (false) return"],
  ['nothing scanned is a pass', "if (scanned === 0) { errors++;", "if (false) { errors++;"],
  ['an unreadable allow file is an empty one', "if (typeof allow === 'string') return { ok: false, reason: allow };", "if (typeof allow === 'string') return { ok: true, entries: [] };"],
  ['the allow file is not read', "try { allow = JSON.parse(readFileSync(allowFile, 'utf8')); }", "try { allow = []; }"],
  ['the summary is not cut at 80 characters', ".replace(/\\s+/g, ' ').slice(0, 80)", ".replace(/\\s+/g, ' ')"],
  ['any osv-scanner version is accepted', "if (v.error || v.exit !== 0 || have !== want)", "if (false)"],
  ['a missing lockfile is not an error', "{ file, fail: 'the lockfile is missing' }", "{ file, notCovered: ['missing'] }"],
  ['deno.lock npm entries are not scanned', "Object.keys(j.npm || {})", "Object.keys({})"],
  ['two versions of one deno npm package collapse into one', "seen.has(name) ?", "false ?"],
  ['deno.lock jsr entries are not named as not covered', "for (const key of Object.keys(j.jsr || {})) notCovered.push(", "for (const key of []) notCovered.push("],
  ['a deno.lock peer suffix stays in the version', "([^_@]+)/.exec(key)", "([^@]+)/.exec(key)"],
  ['a converted deno.lock entry has no resolved url (the scanner then reports nothing)', "{ version, resolved };", "{ version };"],
  ['the main-module check never runs main', "if (direct) process.exitCode = main(process.argv.slice(2));", "if (false) process.exitCode = main(process.argv.slice(2));"],
];
const dir = mkdtempSync(join(tmpdir(), 'dep-scan-mutants-'));
let caught = 0, missing = 0;
for (const [name, a, b] of mutants) {
  const hits = src.split(a).length - 1;
  if (hits !== 1) { console.log(`FAIL mutant target text occurs ${hits} times, not once: ${name}`); missing++; continue; }
  const sub = mkdtempSync(join(dir, 'm-'));
  const file = join(sub, 'dep-scan.mjs');
  writeFileSync(file, src.split(a).join(b), 'utf8');
  const r = spawnSync(process.execPath, [join(HERE, 'test-dep-scan.mjs')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, DEP_SCAN_UNDER_TEST: file } });
  const red = r.status !== 0 && /FAIL/.test(r.stdout);
  console.log(`${red ? 'caught  ' : 'SURVIVED'} ${name}`);
  if (red) caught++;
}
rmSync(dir, { recursive: true, force: true });
const survived = mutants.length - missing - caught;
console.log(`${mutants.length} mutants, ${caught} caught, ${survived} survived, ${missing} target text missing`);
process.exitCode = caught === mutants.length ? 0 : 1;
