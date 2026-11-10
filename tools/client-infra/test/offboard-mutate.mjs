// Mutants for tools/client-infra/offboard.mjs: each breaks one guard in a temp copy and test/offboard-run.mjs must go red on it.
//   node tools/client-infra/test/offboard-mutate.mjs     exit 0 = the unbroken copy passes and every mutant is caught.
// A mutant whose target text is not found exactly once is a failure (the patch never applied), never a pass.
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'offboard.mjs');
const MUTANTS = [
  ['a workspace not marked is offboarded', 'if (!m) throw new Refused(`${o.slug} is not marked', 'if (false) throw new Refused(`${o.slug} is not marked'],
  ['the export may go inside a git checkout', 'if (o.insideGit) throw', 'if (false) throw'],
  ['a folder inside this repository counts as outside', 'if (d === r || d.startsWith(r + sep)) return true;', ''],
  ['an expired ruling still counts', 'today <= x.until', 'true'],
  ['the staff identity is not checked', 'if (!(await d.db.staffOk())) throw', 'if (false) throw'],
  ['a trial or deleted workspace goes ahead', 'else throw new Refused(`${o.slug} is ${ws.state}', 'else log(`${o.slug} is ${ws.state}'],
  ['the dry run sets the state', 'if (o.dryRun) would(`set ${o.slug}', 'if (false) would(`set ${o.slug}'],
  ['another workspace\'s request is carried out', 'if (!t || t.workspace_id !== ws.id) throw', 'if (!t) throw'],
  ['a request that is not delete is carried out', "if (t.kind !== 'delete') throw", 'if (false) throw'],
  ['a request is marked done with the person still found', "if (left.length || again.length) fail('erasure'", "if (false) fail('erasure'"],
  ['a done request is not checked again', "if (leads.length || left.length) fail('erasure'", "if (false) fail('erasure'"],
  ['a number is matched by all its digits only', 'digits: digits.slice(-10)', 'digits'],
  ['the export runs after a failed erasure', "} else if (!out.failed.includes('erasure')) {", '} else if (true) {'],
  ['teardown runs without --teardown', 'if (o.teardown) {', 'if (true) {'],
  ['a key still active after the revoke passes', 'if (!o.dryRun && keys.length && (await d.db.activeKeys(s.id)).length) fail', 'if (false) fail'],
  ['an export short of the counts is written', "if (short.length) fail('export'", "if (false) fail('export'"],
  ['a Storage path may climb out of the folder', ".some((p) => p === '' || p === '.' || p === '..')", ".some((p) => p === '')"],
  ['a Storage size mismatch passes', 'if (ob.size != null && body.length !== Number(ob.size))', 'if (false)'],
  ['the export is rewritten on every run', 'if (prev && prev.content_sha256 === h) log(', 'if (false) log('],
  ['an export holding the person passes', 'if (key && hasSubject(JSON.stringify({ ...body, tables: rest }), key)) fail', 'if (false) fail'],
  ['production is accepted', "if (argv[++i] !== 'staging') throw", 'if (++i < 0) throw'],
];

const dir = mkdtempSync(join(tmpdir(), 'offboard-mut-'));
const lib = join(dir, 'offboard.mjs');
const runTests = () => spawnSync(process.execPath, [join(HERE, 'offboard-run.mjs')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, OFFBOARD_LIB: lib } });
let failed = 0;
try {
  copyFileSync(SRC, lib);
  const base = runTests();
  console.log(`${base.status === 0 ? 'ok  ' : 'FAIL'} baseline: the unbroken copy passes`);
  if (base.status !== 0) {
    console.log(base.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
    throw new Error('the unbroken copy fails, so no mutant result would mean anything; fix the tests first');
  }
  const src = readFileSync(SRC, 'utf8');
  for (const [name, from, to] of MUTANTS) {
    if (src.split(from).length !== 2) { failed++; console.log(`FAIL mutant "${name}": target text not found exactly once`); continue; }
    writeFileSync(lib, src.replace(from, () => to));
    const r = runTests();
    const red = r.status === 1 && /^FAIL /m.test(r.stdout);
    if (!red) failed++;
    console.log(`${red ? 'ok  ' : 'FAIL'} mutant "${name}": ${red ? 'caught by ' + (r.stdout.match(/^FAIL (?!offboard tests).*$/m) || ['?'])[0].slice(5, 90) : 'NOT caught'}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${failed ? 'FAIL' : 'PASS'} offboard mutants: ${MUTANTS.length} mutants, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
