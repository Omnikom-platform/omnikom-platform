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

  // KNOWN-6: staging applied 15, 18, 19, 17, 20, 16. The recorded rows are excused only at their recorded times, while the proof runs in CI.
  const K = { 15: '20261104000015_crm_export_import.sql', 16: '20261104000016_site_audit.sql', 17: '20261105000017_team.sql', 18: '20261105000018_lead_list_site.sql',
    19: '20261109000019_reaper_schedule.sql', 20: '20261109000020_security_event_buckets.sql', 21: '20261109000021_media_limits.sql', 22: '20261109000022_crm_views_followup.sql' };
  const STAGING = { 15: '2026-11-04 14:15:18.887743+00', 16: '2026-11-09 15:54:47.547589+00', 17: '2026-11-09 12:17:54.514561+00', 18: '2026-11-04 21:09:21.835723+00',
    19: '2026-11-09 04:11:50.474595+00', 20: '2026-11-09 15:51:03.593903+00', 21: '2026-11-09 21:43:27.423634+00' };
  const kText = name => `-- ${name}\n`;
  const kDir = (label, numbers) => { const d = join(work, label); mkdirSync(d, { recursive: true }); for (const n of numbers) writeFileSync(join(d, K[n]), kText(K[n])); return d; };
  const seven = kDir('k7', [15, 16, 17, 18, 19, 20, 21]), eight = kDir('k8', [15, 16, 17, 18, 19, 20, 21, 22]);
  const setTimed = (c, times) => {
    setOps(c, []);
    c.sql(`insert into ops.platform_migrations (name, sha256, applied_at) values ${Object.entries(times).map(([n, at]) => `('${K[n]}', '${sha(kText(K[n]))}', timestamptz '${at}')`).join(',')};`);
  };
  const both = times => { setTimed(A, times); setTimed(B, times); };
  const PROOF = 'supabase/ops/test/order-proof.test.mjs';
  // a repository of its own: the exceptions file, the proof it names and the gate file are found from where the exceptions file lies
  const repo = (label, { proof = true, gate = true } = {}) => {
    const root = join(work, label);
    for (const d of ['supabase/ops/test', 'docs/blueprint/specs']) mkdirSync(join(root, d), { recursive: true });
    if (proof) writeFileSync(join(root, PROOF), '// the proof\n');
    writeFileSync(join(root, 'docs/blueprint/specs/run-all-gates.mjs'), `const gates = [\n  ${gate ? '' : '// '}['migration order proof', '${PROOF}', '--mutants'],\n];\n`);
    const file = join(root, 'supabase/ops/order-exceptions.json');
    writeFileSync(file, JSON.stringify({ why: 'test', proof: PROOF, rows: Object.fromEntries([16, 17, 18, 19].map(n => [K[n], STAGING[n]])) }));
    return file;
  };
  const good = repo('repo-good');
  const NOT_TAKEN = /R-ORDER-EXCEPTION not taken: /;
  const ordered = out => refusals(out).length > 0 && refusals(out).every(l => l.startsWith('REFUSE R-ORDER: '));

  both(STAGING);
  r = check(['--exceptions', good], { dir: seven });
  t('E1 a ledger shaped like staging with the exception taken: no R-ORDER, exit 0', r.code === 0 && refusals(r.out).length === 0 && !NOT_TAKEN.test(r.out), r.out);
  B.sql("alter database postgres set timezone = 'Africa/Cairo'");
  r = check(['--exceptions', good], { dir: seven });
  B.sql('alter database postgres reset timezone');
  t('E1 the times are compared as instants: a ledger read in another time zone is still excused', r.code === 0 && !NOT_TAKEN.test(r.out), r.out);
  r = check(['--exceptions', join(work, 'no-such-exceptions.json')], { dir: seven });
  t('E1 control: the same ledger with no exceptions file is refused R-ORDER', r.code === 1 && ordered(r.out), r.out);
  if (script === REAL) {
    r = check([], { dir: seven });
    t('E1 the shipped exceptions file, proof and gate line excuse the staging ledger', r.code === 0 && refusals(r.out).length === 0 && !NOT_TAKEN.test(r.out), r.out);
  }

  both({ ...STAGING, 22: '2026-11-09 18:00:00+00' });
  r = check(['--exceptions', good], { dir: eight });
  t('E2 a fifth inverted row is refused R-ORDER by name', r.code === 1 && ordered(r.out) && refusals(r.out).every(l => l.includes(K[22])) && !NOT_TAKEN.test(r.out), r.out);

  for (const [what, at] of [['1 ms', '2026-11-09 12:17:54.515561+00'], ['1 microsecond', '2026-11-09 12:17:54.514562+00']]) {
    setTimed(A, STAGING); setTimed(B, { ...STAGING, 17: at });
    r = check(['--exceptions', good], { dir: seven });
    t(`E3 one recorded time off by ${what} on the target: not taken, R-ORDER refuses the target only`,
      r.code === 1 && ordered(r.out) && refusals(r.out).every(l => l.includes('the target applied'))
      && r.out.split(/\r?\n/).some(l => l.startsWith('R-ORDER-EXCEPTION not taken: target: ') && l.includes(K[17])), r.out);
  }

  both(STAGING);
  r = check(['--exceptions', repo('repo-no-proof', { proof: false })], { dir: seven });
  t('E4 the proof file is missing: not taken, R-ORDER refuses', r.code === 1 && ordered(r.out) && /not taken: .*proof file .* is missing/.test(r.out), r.out);
  r = check(['--exceptions', repo('repo-no-gate', { gate: false })], { dir: seven });
  t('E4 the gate line is missing (commented out): not taken, R-ORDER refuses', r.code === 1 && ordered(r.out) && /not taken: .*no gate line/.test(r.out), r.out);

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

  // the text psql is handed: the query and `commit;` must be separate statements, whether or not the caller ended its query with ";"
  const handed = sql => { let input = ''; const fakePsql = (cmd, args, opts) => { input = String(opts.input); return { status: 0, stdout: '', stderr: '' }; }; mod.psqlReadOnly(B.url, sql, fakePsql); return input; };
  const statements = input => input.split(';').map(x => x.trim()).filter(Boolean);
  const bare = handed("select 'x'"), ended = handed("select 'x';"), spaced = handed("select 'x';  \n\n"), multi = handed('select 1; select 2');
  t('a query without a trailing semicolon is closed: psql gets begin, the query and commit as three separate statements', JSON.stringify(statements(bare)) === JSON.stringify(['begin read only', "select 'x'", 'commit']) && bare === "begin read only;\nselect 'x';\ncommit;\n", JSON.stringify(bare));
  t('a query that already ends with a semicolon (also with trailing spaces or newlines) gets no second one: no ";;", no empty statement', ended === "begin read only;\nselect 'x';\ncommit;\n" && spaced === ended && !/;\s*;/.test(ended + spaced), JSON.stringify([ended, spaced]));
  t('a multi-statement query keeps its own semicolons and is closed once', JSON.stringify(statements(multi)) === JSON.stringify(['begin read only', 'select 1', 'select 2', 'commit']), JSON.stringify(multi));

  // the function list is the real folder's: always asked of the real script (a mutant copy lives in the temp folder)
  const fl = spawnSync(process.execPath, [REAL, 'functions'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  // whole folder names: a function called team-list is a function; only the folders named exactly _shared and test are not
  const flNames = fl.stdout.trim().split(',').filter(Boolean);
  t('functions lists the deployable folders and not _shared or test', fl.status === 0 && flNames.includes('capture-lead') && flNames.includes('team-list') && !flNames.includes('_shared') && !flNames.includes('test'), fl.stdout + fl.stderr);
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
  ['a query without a trailing semicolon is handed to psql unclosed', [['q.endsWith(\';\') ? q : `${q};`', 'q']], /query without a trailing semicolon is closed/],
  ['the read-only transaction is dropped', [['begin read only;', 'begin;']], /refuses a write/],
  ['the same-database guard is dropped', [['provenUrl === targetUrl && !dry', 'false']], /same database on both sides is refused/],
  ['the URL and password scrub is dropped', [["msg = msg.split(url).join('<db url>').replace(/postgres(ql)?:\\/\\/\\S+/g, '<db url>');", ''], ["if (pass.length >= 3) msg = msg.split(pass).join('<password>');", '']], /unreachable database/],
  ['a database with no history table becomes an error', [["return { source: 'none (no history table: nothing applied)', entries: [] };", "throw new DbError('no history');"]], /no history table/],
  ['--expect-pending is ignored', [['if (expect !== null && Number(expect) !== pending.length)', 'if (false)']], /R-COUNT/],
  ['KNOWN-6: the recorded times are not checked', [['micros(by.get(n).at) !== micros(exceptions.rows[n])', 'false']], /^E3 /],
  ['KNOWN-6: any inverted row is excused, not only the listed ones', [['!skip.has(e.name)', '!skip.size']], /^E2 /],
  ['KNOWN-6: the proof file and gate line are not checked', [[': exceptions.blocked;', ': null;']], /^E4 /],
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
