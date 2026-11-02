// Tests for supabase/ops/promote-check.mjs against two throwaway local clusters (proven and target), started the way
// supabase/tests/run-local.mjs starts one (see cluster.mjs). Nothing here needs an account.
//   node supabase/ops/test/promote-check.test.mjs              the suite (about a minute: it builds two clusters from the real migrations)
//   node supabase/ops/test/promote-check.test.mjs --mutants    the suite, then every MUTANT (one check broken in a copy of the script):
//                                                              each must make a test fail, for the reason named
//   PROMOTE_CHECK_SCRIPT=<file> node ...                       run the suite against another copy of the script
// Exit 0 = every test passed (and, with --mutants, every mutant was caught).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { startCluster, loadPlatform } from './cluster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = resolve(HERE, '..', 'promote-check.mjs');
const REAL_MIGRATIONS = resolve(HERE, '..', '..', 'migrations');
let script = process.env.PROMOTE_CHECK_SCRIPT ? resolve(process.env.PROMOTE_CHECK_SCRIPT) : REAL;   // the script under test
const sha = t => createHash('sha256').update(t).digest('hex');

const work = mkdtempSync(join(tmpdir(), 'omnikom-promote-test-'));
const files = {
  '20260101000001_a.sql': 'create table a (id int);\n',
  '20260101000002_b.sql': 'create table b (id int);\n',
  '20260101000003_c.sql': 'create table c (id int);\n',
  '20260101000004_d.sql': 'create table d (id int);\n',
};
const NAMES = Object.keys(files);
const four = join(work, 'four'), three = join(work, 'three');
for (const [dir, count] of [[four, 4], [three, 3]]) { mkdirSync(dir, { recursive: true }); for (const n of NAMES.slice(0, count)) writeFileSync(join(dir, n), files[n]); }
const shaOf = n => sha(files[n]);

let A, B;   // A = the proven database, B = the target
const PW = 'zz-secret-pw-71';
const withPw = url => url.replace('postgres@', `postgres:${PW}@`);

// ledger helpers: rows = [{ name, sha?, at? }]; applied_at is a base time + index minutes unless given
function setOps(c, rows) {
  c.sql(`drop schema if exists supabase_migrations cascade; create schema if not exists ops;
    create table if not exists ops.platform_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now());
    truncate ops.platform_migrations;`);
  const values = rows.map((r, i) => `('${r.name}', '${r.sha ?? shaOf(r.name)}', timestamptz '2026-01-01 00:00:00+00' + interval '${r.at ?? i} minutes')`).join(',');
  if (values) c.sql(`insert into ops.platform_migrations (name, sha256, applied_at) values ${values};`);
}
const names = n => NAMES.slice(0, n).map(name => ({ name }));
function setSupabaseHistory(c, rows) {   // rows = [{ version, name, statements }]
  c.sql(`drop schema if exists ops cascade; create schema if not exists supabase_migrations;
    drop table if exists supabase_migrations.schema_migrations;
    create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  for (const r of rows) c.sql(`insert into supabase_migrations.schema_migrations values ('${r.version}', array[${r.statements.map(s => `$q$${s}$q$`).join(',')}], '${r.name}');`);
}
const clearHistory = c => c.sql('drop schema if exists ops cascade; drop schema if exists supabase_migrations cascade; drop table if exists public.platform_migrations;');

const check = (extra = [], { proven = A, target = B, dir = three, env = {} } = {}) => {
  const r = spawnSync(process.execPath, [script, '--proven', 'PC_PROVEN_DB_URL', '--target', 'PC_TARGET_DB_URL', '--migrations', dir, ...extra], {
    encoding: 'utf8', timeout: 120000, windowsHide: true,
    env: { ...process.env, PC_PROVEN_DB_URL: proven.url, PC_TARGET_DB_URL: target.url, ...env },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const refusals = out => out.split(/\r?\n/).filter(l => l.startsWith('REFUSE R-'));

async function suite({ integration }) {
  const results = [];
  const t = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 900) });
  let r;

  if (integration) {
    // the two clusters carry the REAL migrations through the real apply script: the ledger is the one staging has
    r = check([], { dir: REAL_MIGRATIONS });
    t('real migrations on both: equal lists pass, 0 pending', r.code === 0 && /pending on the target: 0/.test(r.out) && /OK: 0 pending/.test(r.out), r.out);
    const last = B.scalar('select name from ops.platform_migrations order by name desc limit 1');
    B.sql(`delete from ops.platform_migrations where name = '${last}'`);
    r = check([], { dir: REAL_MIGRATIONS });
    t('real migrations: the target one behind lists exactly that file and passes', r.code === 0 && /pending on the target: 1/.test(r.out) && r.out.includes(`  ${last}`), r.out);
  }

  setOps(A, names(3)); setOps(B, names(3));
  r = check();
  t('equal lists pass: exit 0, 0 pending, OK line', r.code === 0 && /pending on the target: 0/.test(r.out) && /OK: 0 pending/.test(r.out), r.out);
  r = check([], { dir: four });
  t('a fourth file in the repository that neither database has: refused as not proven, and only that', r.code === 1 && refusals(r.out).length === 1 && /R-PENDING-NOT-PROVEN: 20260101000004_d.sql/.test(r.out), r.out);

  setOps(B, names(2));
  r = check();
  t('target behind by one proven file: the pending list has it, exit 0', r.code === 0 && /pending on the target: 1/.test(r.out) && r.out.includes('  20260101000003_c.sql') && refusals(r.out).length === 0, r.out);

  setOps(A, names(2)); setOps(B, names(2));
  r = check();
  t('R-PENDING-NOT-PROVEN: c is pending and the proven database lacks it', r.code === 1 && /REFUSE R-PENDING-NOT-PROVEN: 20260101000003_c.sql/.test(r.out) && refusals(r.out).length === 1, r.out);

  setOps(A, names(3)); setOps(B, [{ name: NAMES[0] }, { name: NAMES[2] }]);
  r = check();
  t('R-ORDER: b is pending but sorts before c, which the target has', r.code === 1 && /REFUSE R-ORDER: 20260101000002_b.sql is pending but sorts before 20260101000003_c.sql/.test(r.out), r.out);
  setOps(A, [{ name: NAMES[0], at: 0 }, { name: NAMES[2], at: 1 }, { name: NAMES[1], at: 2 }]); setOps(B, [{ name: NAMES[0] }]);
  r = check();
  t('R-ORDER: the proven database applied c before b', r.code === 1 && /REFUSE R-ORDER: the proven database applied 20260101000003_c.sql before 20260101000002_b.sql/.test(r.out), r.out);
  setOps(A, names(3)); setOps(B, [{ name: NAMES[0], at: 0 }, { name: NAMES[2], at: 1 }, { name: NAMES[1], at: 2 }]);
  r = check();
  t('R-ORDER: the target applied c before b', r.code === 1 && /REFUSE R-ORDER: the target applied 20260101000003_c.sql before 20260101000002_b.sql/.test(r.out), r.out);

  setOps(A, names(3)); setOps(B, [...names(3), { name: '20260101000009_ghost.sql', sha: 'f'.repeat(64) }]);
  r = check();
  t('R-TARGET-NOT-IN-REPO: the target applied a file the repository lacks', r.code === 1 && /REFUSE R-TARGET-NOT-IN-REPO: the target applied 20260101000009_ghost.sql/.test(r.out), r.out);
  t('R-TARGET-NOT-PROVEN: the same file is not on the proven database either', /REFUSE R-TARGET-NOT-PROVEN: the target applied 20260101000009_ghost.sql/.test(r.out), r.out);
  setOps(A, [...names(3), { name: '20260101000008_old.sql', sha: 'e'.repeat(64) }]); setOps(B, names(3));
  r = check();
  t('R-PROVEN-NOT-IN-REPO: the proven database applied a file the repository lacks', r.code === 1 && /REFUSE R-PROVEN-NOT-IN-REPO: the proven database applied 20260101000008_old.sql/.test(r.out), r.out);

  setOps(A, [{ name: NAMES[0] }, { name: NAMES[1], sha: sha('create table b (id int, edited int);\n') }, { name: NAMES[2] }]); setOps(B, [{ name: NAMES[0] }]);
  r = check();
  t('R-CONTENT: b differs from the hash the proven database recorded, and the line says hash', r.code === 1 && /REFUSE R-CONTENT: 20260101000002_b.sql differs from what the proven database recorded \(recorded sha256 [0-9a-f]{12}, file sha256 [0-9a-f]{12}\)/.test(r.out), r.out);
  setOps(A, names(3)); setOps(B, [{ name: NAMES[0] }, { name: NAMES[1], sha: 'a'.repeat(64) }]);
  r = check();
  t('R-CONTENT-TARGET: the target recorded another hash for b', r.code === 1 && /REFUSE R-CONTENT-TARGET: 20260101000002_b.sql differs from what the target recorded/.test(r.out), r.out);

  // a Supabase CLI style history keeps statements: compared with whitespace and semicolons ignored
  const cli = (bStatement) => [
    { version: '20260101000001', name: 'a', statements: ['create table a (id int)'] },
    { version: '20260101000002', name: 'b', statements: [bStatement] },
    { version: '20260101000003', name: 'c', statements: ['create table c (id int)'] }];
  setSupabaseHistory(A, cli('create table b (id int)')); setSupabaseHistory(B, cli('create table b (id int)').slice(0, 1));
  r = check();
  t('CLI history (statements): same content passes, 2 pending, source named', r.code === 0 && /pending on the target: 2/.test(r.out) && /supabase_migrations.schema_migrations/.test(r.out), r.out);
  setSupabaseHistory(A, cli('create table b (id int, edited int)'));
  r = check();
  t('R-CONTENT (statements): b differs from the recorded statements, and the line says statements', r.code === 1 && /REFUSE R-CONTENT: 20260101000002_b.sql differs from what the proven database recorded \(the recorded statements differ from the file\)/.test(r.out), r.out);

  // a new production project has no history table at all: everything proven is pending
  setOps(A, names(3)); clearHistory(B);
  r = check();
  t('a target with no history table: 3 pending, passes', r.code === 0 && /pending on the target: 3/.test(r.out) && /none \(no history table/.test(r.out), r.out);

  setOps(A, names(3)); setOps(B, names(3));
  r = check(['--expect-pending', '0']);
  t('--expect-pending 0 passes when nothing is pending', r.code === 0, r.out);
  setOps(B, names(2));
  r = check(['--expect-pending', '0']);
  t('--expect-pending 0 refuses (R-COUNT) when one is pending', r.code === 1 && /REFUSE R-COUNT: expected 0 pending, found 1/.test(r.out), r.out);

  setOps(A, names(3));
  r = check([], { target: A });
  t('the same database on both sides is refused (exit 2) without --dry-run', r.code === 2 && /same database/.test(r.out), r.out);
  r = check(['--dry-run'], { target: A });
  t('--dry-run with one database on both sides: exit 0, 0 pending, says DRY RUN', r.code === 0 && /DRY RUN/.test(r.out) && /pending on the target: 0/.test(r.out), r.out);

  r = check([], { env: { PC_TARGET_DB_URL: '' } });
  t('a missing variable is exit 2 and named', r.code === 2 && /set PC_TARGET_DB_URL/.test(r.out), r.out);
  r = check([], { env: { PC_TARGET_DB_URL: withPw('postgres://postgres@127.0.0.1:1/postgres') } });
  t('an unreachable database is exit 2 and the output holds neither the URL nor the password', r.code === 2 && /cannot read PC_TARGET_DB_URL/.test(r.out) && !r.out.includes(PW) && !r.out.includes('127.0.0.1:1/'), r.out);
  r = check([], { env: { PC_TARGET_DB_URL: withPw(B.url), PC_PROVEN_DB_URL: withPw(A.url) } });
  t('a working run prints variable names, never the URL or the password', r.code === 0 && !r.out.includes(PW) && !r.out.includes(String(B.port)) && r.out.includes('PC_TARGET_DB_URL'), r.out);

  const mod = await import(`${pathToFileURL(script).href}?x=${Date.now()}${Math.random()}`);
  let refused = false;
  try { mod.psqlReadOnly(B.url, 'create table must_not_exist (id int);'); } catch (e) { refused = /read-only/.test(e.message); }
  t('the read helper refuses a write ("read-only transaction")', refused, 'the write was not refused');
  t('and nothing was created', B.scalar("select to_regclass('public.must_not_exist') is null") === 't', 'the table exists');
  B.sql('drop table if exists public.must_not_exist');   // a mutant that allows the write must not leave it behind for the next run
  const echoing = () => ({ status: 2, stdout: '', stderr: `psql: error: connection failed for ${withPw(B.url)} (password ${PW})` });
  let scrubbed = '';
  try { mod.psqlReadOnly(withPw(B.url), 'select 1', echoing); } catch (e) { scrubbed = e.message; }
  t('the error text of an unreachable database is scrubbed of the URL and the password (a fake psql that echoes both)', scrubbed.includes('<db url>') && !scrubbed.includes(PW) && !scrubbed.includes(String(B.port)), scrubbed);

  // the function list is the real folder's: always asked of the real script (a mutant copy lives in the temp folder)
  const fl = spawnSync(process.execPath, [REAL, 'functions'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  // whole folder names: a function called crm-test is a function; only the folders named exactly _shared and test are not
  const flNames = fl.stdout.trim().split(',').filter(Boolean);
  t('functions lists the deployable folders and not _shared or test', fl.status === 0 && flNames.includes('capture-lead') && flNames.includes('crm-test') && !flNames.includes('_shared') && !flNames.includes('test'), fl.stdout + fl.stderr);
  t('smoke judgement: 405 and 401 answer; gateway NOT_FOUND, 502 and silence do not',
    mod.judgeSmoke(405, { code: 'METHOD' }).ok && mod.judgeSmoke(401, null).ok && !mod.judgeSmoke(404, { code: 'NOT_FOUND' }).ok && !mod.judgeSmoke(502, null).ok && !mod.judgeSmoke(0, null).ok, 'judgeSmoke');
  const fake = async url => ({ status: url.endsWith('/save') ? 404 : 405, text: async () => (url.endsWith('/save') ? '{"code":"NOT_FOUND"}' : '{"code":"METHOD"}') });
  const sm = await mod.smoke('https://x.invalid/functions/v1', ['save', 'publish'], fake);
  t('smoke over a fake gateway: publish ok, save (not deployed) fails', sm.find(x => x.name === 'publish').ok && !sm.find(x => x.name === 'save').ok, JSON.stringify(sm));
  return results;
}

// Each mutant breaks ONE check in a copy of the script. `from` must exist in the script (a patch that never applied proves nothing).
// The regex says which test must be among the red ones, so a mutant cannot pass for an unrelated reason.
const MUTANTS = [
  ['a pending file that is not proven is let through', [['if (!pBy.has(name)) refusals.push(`R-PENDING-NOT-PROVEN', 'if (false) refusals.push(`R-PENDING-NOT-PROVEN']], /R-PENDING-NOT-PROVEN/],
  ["a pending file sorting before the target's last is let through", [['name < lastTarget', 'false']], /b is pending but sorts before c/],
  ['out-of-order application is let through', [['applied[i].name !== byFile[i].name', 'false']], /applied c before b/],
  ['a target migration the repository lacks is let through', [['if (!fileBy.has(t.name)) refusals.push', 'if (false) refusals.push']], /R-TARGET-NOT-IN-REPO/],
  ['a target migration the proven database lacks is let through', [['if (!pBy.has(t.name)) refusals.push', 'if (false) refusals.push']], /R-TARGET-NOT-PROVEN/],
  ['a proven migration the repository lacks is let through', [['if (!f) { refusals.push(`R-PROVEN-NOT-IN-REPO', 'if (false) { refusals.push(`R-PROVEN-NOT-IN-REPO']], /R-PROVEN-NOT-IN-REPO/],
  ['a changed file is let through (proven side)', [['if (d === true) refusals.push(`R-CONTENT: ', 'if (false) refusals.push(`R-CONTENT: ']], /R-CONTENT: b differs/],
  ['a changed file is let through (target side)', [['if (d === true) refusals.push(`R-CONTENT-TARGET', 'if (false) refusals.push(`R-CONTENT-TARGET']], /R-CONTENT-TARGET/],
  ['the hash comparison always says equal', [['return entry.sha256 !== file.sha;', 'return false;']], /R-CONTENT: b differs/],
  ['the statements comparison always says equal', [['return norm(entry.statements) !== file.norm;', 'return false;']], /R-CONTENT \(statements\)/],
  ['the read-only transaction is dropped', [['begin read only;', 'begin;']], /refuses a write/],
  ['the same-database guard is dropped', [['provenUrl === targetUrl && !dry', 'false']], /same database on both sides is refused/],
  ['the URL and password scrub is dropped', [["msg = msg.split(url).join('<db url>').replace(/postgres(ql)?:\\/\\/\\S+/g, '<db url>');", ''], ["if (pass.length >= 3) msg = msg.split(pass).join('<password>');", '']], /unreachable database/],
  ['a database with no history table becomes an error', [["return { source: 'none (no history table: nothing applied)', entries: [] };", "throw new DbError('no history');"]], /no history table/],
  ['--expect-pending is ignored', [['if (expect !== null && Number(expect) !== pending.length)', 'if (false)']], /R-COUNT/],
  ['smoke accepts a function the gateway says is not deployed', [["if (status === 404 && json && json.code === 'NOT_FOUND') return { ok: false, why: 'not deployed' };", '']], /smoke judgement|smoke over/],
];

let exit = 0;
try {
  A = startCluster('proven'); B = startCluster('target');
  loadPlatform(A); loadPlatform(B);
  const base = await suite({ integration: true });
  for (const r of base) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')}`);
  const failed = base.filter(r => !r.ok).length;
  console.log(failed ? `\nPROMOTE-CHECK TESTS FAILED: ${failed} of ${base.length}` : `\nPROMOTE-CHECK TESTS OK: ${base.length} checks`);
  if (failed) exit = 1;

  if (process.argv.includes('--mutants') && !exit) {
    const source = readFileSync(script, 'utf8');
    let caught = 0, n = 0;
    for (const [name, pairs, expectRed] of MUTANTS) {
      let text = source, applied = true;
      for (const [from, to] of pairs) {
        if (!text.includes(from)) { console.log(`MISSED  ${name}: the patch did not apply (target text not found: ${from.slice(0, 50)})`); applied = false; break; }
        text = text.split(from).join(to);
      }
      if (!applied) { exit = 1; continue; }
      const copy = join(work, `mutant-${n++}.mjs`);
      writeFileSync(copy, text);
      const real = script; script = copy;
      const res = await suite({ integration: false });
      script = real;
      const red = res.filter(r => !r.ok);
      if (red.some(r => expectRed.test(r.name))) { caught++; console.log(`caught  ${name}  [red: ${red.map(r => r.name.slice(0, 60)).slice(0, 2).join(' | ')}]`); }
      else { exit = 1; console.log(`MISSED  ${name}  (${red.length ? 'red, but not the expected test: ' + red[0].name : 'still green'})`); }
    }
    console.log(exit ? `\nMUTANTS: not all caught (${caught} of ${MUTANTS.length})` : `\nMUTANTS OK: ${caught} of ${MUTANTS.length} caught, each red for the named reason`);
  }
} catch (e) {
  console.error(`test run crashed: ${(e && e.stack) || e}`);
  exit = 2;
} finally {
  try { if (A) A.stop(); } catch { /* already gone */ }
  try { if (B) B.stop(); } catch { /* already gone */ }
  rmSync(work, { recursive: true, force: true });
}
process.exit(exit);
