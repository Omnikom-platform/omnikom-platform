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
const PROOF = join(HERE, '..', 'proof-offboard.mjs');
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
  ['--delete runs without --teardown', "if (o.del && !o.teardown) throw", 'if (false) throw'],
  ['the files are deleted although an earlier step failed', "} else if (out.failed.length || !exportOk) log('skip   the deletion", "} else if (false) log('skip   the deletion"],
  ['the state goes to deleted with files left', "if (left.length) fail('delete'", "if (false) fail('delete'"],
  ['a deleted workspace is exported again', "const gone = ws.state === 'deleted' && o.del;", 'const gone = false;'],
  ['production is accepted', "if (argv[++i] !== 'staging') throw", 'if (++i < 0) throw'],
  ['a staff call: the state move has no window', "const STAFF_CALLS = ['setState', 'setTicket', 'deleteLead', 'offboardingStorage'];", "const STAFF_CALLS = ['setTicket', 'deleteLead', 'offboardingStorage'];"],
  ['a staff call: the request move has no window', "const STAFF_CALLS = ['setState', 'setTicket', 'deleteLead', 'offboardingStorage'];", "const STAFF_CALLS = ['setState', 'deleteLead', 'offboardingStorage'];"],
  ['a staff call: the lead delete has no window', "const STAFF_CALLS = ['setState', 'setTicket', 'deleteLead', 'offboardingStorage'];", "const STAFF_CALLS = ['setState', 'setTicket', 'offboardingStorage'];"],
  ['a staff call: the Storage list has no window', "const STAFF_CALLS = ['setState', 'setTicket', 'deleteLead', 'offboardingStorage'];", "const STAFF_CALLS = ['setState', 'setTicket', 'deleteLead'];"],
  ['a window is left open when its call fails', 'try { return await db[name](...args); } finally { await db.staffClose(until); }', 'const r = await db[name](...args); await db.staffClose(until); return r;'],
  ['a window is never closed', 'finally { await db.staffClose(until); }', 'finally { }'],
  ['a window is 240 minutes long', 'offboard.mjs ${name}`, 1)', 'offboard.mjs ${name}`, 240)'],
  ['the reason does not name the tool', 'tools/client-infra/offboard.mjs ${name}', 'a staff window for the offboarding call ${name}'],
  ['proof-offboard: the lead add has no window', 'const id = staffPsql(`select service.add_lead(', 'const id = psql(`select service.add_lead(', 'proof'],
  ['proof-offboard: the lead note has no window', 'if (email === ERASE) staffPsql(`select service.lead_update(', 'if (email === ERASE) psql(`select service.lead_update(', 'proof'],
  ['proof-offboard: the first request has no window', "staffPsql(`select service.open_privacy_request(:'c'::jsonb, :'ws'::uuid, 'delete', :'e', 'work order 37 test", "psql(`select service.open_privacy_request(:'c'::jsonb, :'ws'::uuid, 'delete', :'e', 'work order 37 test", 'proof'],
  ['proof-offboard: the second request has no window', "staffPsql(`select service.open_privacy_request(:'c'::jsonb, :'ws'::uuid, 'delete', :'e', 'work order 37b test", "psql(`select service.open_privacy_request(:'c'::jsonb, :'ws'::uuid, 'delete', :'e', 'work order 37b test", 'proof'],
  ['proof-offboard: a window is never closed', 'set until = now()', 'set until = until', 'proof'],
];

const dir = mkdtempSync(join(tmpdir(), 'offboard-mut-'));
const lib = join(dir, 'offboard.mjs');
  const proofCopy = join(dir, 'proof-offboard.mjs');
const runTests = () => spawnSync(process.execPath, [join(HERE, 'offboard-run.mjs')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, OFFBOARD_LIB: lib, OFFBOARD_PROOF: proofCopy } });
let failed = 0;
try {
  copyFileSync(SRC, lib); copyFileSync(PROOF, proofCopy);
  const base = runTests();
  console.log(`${base.status === 0 ? 'ok  ' : 'FAIL'} baseline: the unbroken copy passes`);
  if (base.status !== 0) {
    console.log(base.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
    throw new Error('the unbroken copy fails, so no mutant result would mean anything; fix the tests first');
  }
  const srcs = { lib: readFileSync(SRC, 'utf8'), proof: readFileSync(PROOF, 'utf8') };
  for (const [name, from, to, which = 'lib'] of MUTANTS) {
    const src = srcs[which];
    if (src.split(from).length !== 2) { failed++; console.log(`FAIL mutant "${name}": target text not found exactly once`); continue; }
    writeFileSync(which === 'proof' ? proofCopy : lib, src.replace(from, () => to));
    const r = runTests();
    copyFileSync(SRC, lib); copyFileSync(PROOF, proofCopy);   // the next mutant starts from two unbroken copies
    const red = r.status === 1 && /^FAIL /m.test(r.stdout);
    if (!red) failed++;
    console.log(`${red ? 'ok  ' : 'FAIL'} mutant "${name}": ${red ? 'caught by ' + (r.stdout.match(/^FAIL (?!offboard tests).*$/m) || ['?'])[0].slice(5, 90) : 'NOT caught'}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${failed ? 'FAIL' : 'PASS'} offboard mutants: ${MUTANTS.length} mutants, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
