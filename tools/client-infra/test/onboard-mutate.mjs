// Mutants for tools/client-infra/onboard.mjs: each breaks one guard in a temp copy and test/onboard-run.mjs must go red on it.
//   node tools/client-infra/test/onboard-mutate.mjs     exit 0 = the unbroken copy passes and every mutant is caught.
// A mutant whose target text is not found exactly once is a failure (the patch never applied), never a pass.
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'onboard.mjs');
const MUTANTS = [
  ['a half-filled intake goes ahead', 'if (problems.length) throw', 'if (false) throw'],
  ['an address that is not a test inbox is invited', 'if (!(o.inboxes || []).includes(hashEmail(email))) throw', 'if (false) throw'],
  ['the allow-list holds addresses, not hashes', "x.sha256 || '')).map((x) => x.sha256);", "x.sha256 || '')).map((x) => x.sha256).concat((j.inboxes || []).map((x) => x.email));"],
  ['a member is invited again', 'if (m) log(', 'if (false) log('],
  ['the details row is written again', 'if (!s.length) {', 'if (true) {'],
  ['the owner profile is made again', 'let teamRow = t[0] ? t[0].id : null;', 'let teamRow = null;'],
  ['the dry run sends the invite', "else if (o.dryRun) would(`invite", "else if (false) would(`invite"],
  ['a mail Auth did not send is not reported', 'if (r.json.email_sent !== true) {', 'if (false) {'],
  ['a failed provision is ignored', 'if (p.status === 1 || p.status === 2 || Number.isNaN(n)) {', 'if (false) {'],
  ['a workspace with another site is accepted', 'if (ws && ws.deploy_target !== j.site.deployTarget) throw', 'if (false) throw'],
  ['the invite is not linked to the profile', 'team_row: teamRow', 'team_row: null'],
  ['an expired inbox ruling still counts', 'today <= x.until', 'true'],
  ['key order counts as a difference', 'const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));', 'const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);'],
  ['production is accepted', "if (argv[++i] !== 'staging') throw", 'if (++i < 0) throw'],
  ['--no-invite still invites', 'if (o.noInvite && !m) log(', 'if (false) log('],
  ['--no-invite still demands a test inbox', 'if (!o.noInvite && !(o.inboxes', 'if (!(o.inboxes'],
];

const dir = mkdtempSync(join(tmpdir(), 'onboard-mut-'));
const lib = join(dir, 'onboard.mjs');
const runTests = () => spawnSync(process.execPath, [join(HERE, 'onboard-run.mjs')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, ONBOARD_LIB: lib } });
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
    console.log(`${red ? 'ok  ' : 'FAIL'} mutant "${name}": ${red ? 'caught by ' + (r.stdout.match(/^FAIL (?!onboard tests).*$/m) || ['?'])[0].slice(5, 90) : 'NOT caught'}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${failed ? 'FAIL' : 'PASS'} onboard mutants: ${MUTANTS.length} mutants, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
