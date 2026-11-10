// Mutants for tools/client-infra/provision.mjs: each breaks one guard in a temp copy and test/run.mjs must go red on it.
//   node tools/client-infra/test/mutate.mjs     exit 0 = the unbroken copy passes and every mutant is caught.
// A mutant whose target text is not found exactly once is a failure (the patch never applied), never a pass.
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'provision.mjs');
const MUTANTS = [
  ['an existing project is created again', 'if (project) log(`ok     Pages project', 'if (false) log(`ok     Pages project'],
  ['a key is minted on every run', 'if (key) log(`ok     signing key', 'if (false) log(`ok     signing key'],
  ['the dry run creates the project', "else if (o.dryRun) would(`create Pages project", "else if (false) would(`create Pages project"],
  ['a domain held by another site is taken', 'if (holder) throw', 'if (false) throw'],
  ['the allow-list is not checked', 'if (!allowedHost) throw', 'if (false) throw'],
  ['settings are not read back', 'if (lost.length || missing.length) throw', 'if (false) throw'],
  ['a rotated key is not noticed', " || (have.SITE_SIGNING_KEY_REF && have.SITE_SIGNING_KEY_REF.value) !== ref;", ';'],
  ['a different DNS record is overwritten', 'else if (recs.length) {', 'else if (false) {'],
  ['DNS is written without --write-dns', 'else if (!o.writeDns) {', 'else if (false) {'],
  ['an expired ruling still counts', 'today <= h.until', 'true'],
  ['the key is sent as plain text', "vars.SITE_SIGNING_KEY = { type: 'secret_text', value: keyValue }", "vars.SITE_SIGNING_KEY = { type: 'plain_text', value: keyValue }"],
  ['production is accepted', "if (o.target !== 'staging') throw", 'if (false) throw'],
];

const dir = mkdtempSync(join(tmpdir(), 'client-infra-mut-'));
const lib = join(dir, 'provision.mjs');
const runTests = () => spawnSync(process.execPath, [join(HERE, 'run.mjs')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, CLIENT_INFRA_LIB: lib } });
let failed = 0;
try {
  copyFileSync(SRC, lib);
  const base = runTests();
  console.log(`${base.status === 0 ? 'ok  ' : 'FAIL'} baseline: the unbroken copy passes`);
  if (base.status !== 0) { failed++; console.log(base.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join('\n')); }
  const src = readFileSync(SRC, 'utf8');
  for (const [name, from, to] of MUTANTS) {
    if (src.split(from).length !== 2) { failed++; console.log(`FAIL mutant "${name}": target text not found exactly once`); continue; }
    writeFileSync(lib, src.replace(from, () => to));
    const r = runTests();
    const red = r.status === 1 && /^FAIL /m.test(r.stdout);
    if (!red) failed++;
    console.log(`${red ? 'ok  ' : 'FAIL'} mutant "${name}": ${red ? 'caught by ' + (r.stdout.match(/^FAIL (?!client-infra).*$/m) || ['?'])[0].slice(5, 90) : 'NOT caught'}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${failed ? 'FAIL' : 'PASS'} client-infra mutants: ${MUTANTS.length} mutants, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
