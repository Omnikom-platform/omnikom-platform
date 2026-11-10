// apply-proof: the change rule C1 needs in supabase/apply-staging.mjs, run against a throwaway cluster (the CLI harness's startCluster).
//   node ~/.claude/scripts/heavy.mjs -- node tools/migration-lint/test/apply-proof.mjs      (a cluster: not part of the fast CI step)
// Two COPIES of the real script run: the original (must FAIL on a CREATE INDEX CONCURRENTLY file: the bug) and the patched one
// (lib/apply-patch.mjs; asserts its target is in the script exactly once). If the real script already handles `-- no-transaction`, it
// is run as it is. supabase/ is never written. Each line: PASS|FAIL <what> (observed ...). Exit 1 on any FAIL.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startCluster } from '../../omnikom-cli/test/harness.mjs';
import { patchApplier } from '../lib/apply-patch.mjs';
import { lintAll } from '../lint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(HERE, '..', '..', '..');
const real = readFileSync(join(REPO, 'supabase', 'apply-staging.mjs'), 'utf8');
const alreadyHandles = /no-transaction/.test(real);
const patchedText = alreadyHandles ? real : patchApplier(real);
let failed = 0;
const fact = (name, ok, observed) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (observed: ${String(observed).replace(/\s+/g, ' ').slice(0, 220)})`); };

const cluster = startCluster({ signals: true });
const tmp = mkdtempSync(join(tmpdir(), 'migration-lint-apply-'));
const base = ['-h', '127.0.0.1', '-p', String(cluster.port), '-U', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
const psql = (db, sql) => spawnSync('psql', [...base, '-d', db, '-t', '-A', '-c', sql], { encoding: 'utf8', timeout: 120000 });
let n = 0;
function scenario(applierText, migrations) {
  const db = `ap${process.pid}_${++n}`;
  if (psql('postgres', `create database ${db}`).status !== 0) throw new Error('create database failed');
  const dir = join(tmp, db);
  mkdirSync(join(dir, 'migrations'), { recursive: true });
  writeFileSync(join(dir, 'apply-staging.mjs'), applierText);
  for (const [name, text] of Object.entries(migrations)) writeFileSync(join(dir, 'migrations', name), text);
  const run = () => spawnSync(process.execPath, [join(dir, 'apply-staging.mjs')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, STAGING_DB_URL: `postgres://postgres@127.0.0.1:${cluster.port}/${db}`, PROD_DB_URL: '' } });
  const q = sql => psql(db, sql).stdout.trim();
  const edit = (name, text) => writeFileSync(join(dir, 'migrations', name), text);
  return { dir, run, q, edit };
}
const M1 = '20260101000001_t.sql', M2 = '20260101000002_idx.sql';
const T1 = 'create table t (id int primary key, a int);\ninsert into t select g, g from generate_series(1,100) g;\n';
const T2 = "-- no-transaction\nset lock_timeout = '5s';\ncreate index concurrently t_a on t (a);\n";

try {
  console.log(`server: ${psql('postgres', 'select version()').stdout.split(',')[0].trim()}; apply-staging.mjs ${alreadyHandles ? 'already handles -- no-transaction (run as it is)' : 'does not handle it yet (the patch is applied to a copy)'}`);

  // A: the bug, on the original script
  let s = scenario(real.replace(/^/, ''), { [M1]: T1, [M2]: T2 });
  let r = s.run();
  if (!alreadyHandles) {
    fact('ORIGINAL script: a CREATE INDEX CONCURRENTLY file fails inside its begin/commit (the bug C1 exists for)', r.status === 1 && /cannot run inside a transaction block/.test(r.stderr), `exit ${r.status} ${r.stderr.split('\n').find(l => /ERROR|FAILED/.test(l)) || ''}`);
    fact('ORIGINAL script: the failed file left no ledger row and no index', s.q('select count(*) from ops.platform_migrations') === '1' && s.q("select count(*) from pg_indexes where indexname = 't_a'") === '0', `ledger ${s.q('select count(*) from ops.platform_migrations')}`);
  }

  // B: the patched script
  s = scenario(patchedText, { [M1]: T1, [M2]: T2 });
  r = s.run();
  fact('PATCHED script: both files apply (exit 0, the no-transaction one included)', r.status === 0 && /apply 20260101000002_idx\.sql/.test(r.stdout) && /OK: applied 2 of 2/.test(r.stdout), `exit ${r.status} ${r.stdout.trim().split('\n').pop()} ${r.stderr.slice(0, 120)}`);
  fact('PATCHED script: the index exists and is VALID', s.q("select indisvalid from pg_index where indexrelid = 't_a'::regclass") === 't', s.q("select indisvalid from pg_index where indexrelid = 't_a'::regclass"));
  fact('PATCHED script: the ledger holds both files', s.q('select count(*) from ops.platform_migrations') === '2', s.q('select string_agg(name, \',\') from ops.platform_migrations'));
  r = s.run();
  fact('PATCHED script: a second run skips both (hash unchanged) and applies 0', r.status === 0 && /skip  20260101000002_idx\.sql/.test(r.stdout) && /OK: applied 0 of 2/.test(r.stdout), r.stdout.trim().split('\n').pop());
  s.edit(M2, T2 + '-- edited after it was applied\n');
  r = s.run();
  fact('PATCHED script: an edited no-transaction file is refused by the hash check, as before', r.status === 1 && /applied with a different content/.test(r.stderr), r.stderr.split('\n')[0]);

  // C: the transactional path is unchanged
  s = scenario(patchedText, { [M1]: T1, '20260101000003_atomic.sql': 'create table u (id int);\nselect 1/0;\n' });
  r = s.run();
  fact('PATCHED script: an ordinary file that fails midway is rolled back whole (no table u) and not recorded', r.status === 1 && /nothing of it was kept/.test(r.stderr) && s.q("select count(*) from pg_class where relname = 'u'") === '0' && s.q('select count(*) from ops.platform_migrations') === '1', `exit ${r.status} u=${s.q("select count(*) from pg_class where relname = 'u'")} ledger=${s.q('select count(*) from ops.platform_migrations')}`);

  // D: a no-transaction file that fails midway
  s = scenario(patchedText, { [M1]: T1, '20260101000004_partial.sql': '-- no-transaction\ncreate table v1 (id int);\nselect 1/0;\n' });
  r = s.run();
  fact('PATCHED script: a no-transaction file that fails midway is NOT recorded, keeps what ran before (table v1), and says so', r.status === 1 && /runs outside a transaction/.test(r.stderr) && s.q("select count(*) from pg_class where relname = 'v1'") === '1' && s.q('select count(*) from ops.platform_migrations') === '1', `exit ${r.status} v1=${s.q("select count(*) from pg_class where relname = 'v1'")} ledger=${s.q('select count(*) from ops.platform_migrations')}`);

  // E: the header is the leading lines only
  s = scenario(patchedText, { [M1]: T1, '20260101000005_late.sql': "select 1;\n-- no-transaction\ncreate index concurrently t_a on t (a);\n" });
  r = s.run();
  fact('PATCHED script: a "-- no-transaction" line after the first statement is not a header (still wrapped, fails loudly)', r.status === 1 && /cannot run inside a transaction block/.test(r.stderr), r.stderr.split('\n').find(l => /ERROR|FAILED/.test(l)) || '');
  s = scenario(patchedText, { [M1]: T1, '20260101000006_crlf.sql': "-- note\r\n-- no-transaction\r\nset lock_timeout = '5s';\r\ncreate index concurrently t_a on t (a);\r\n" });
  r = s.run();
  fact('PATCHED script: the header is found in a file with CRLF line ends too', r.status === 0 && s.q("select indisvalid from pg_index where indexrelid = 't_a'::regclass") === 't', `exit ${r.status} ${r.stderr.slice(0, 120)}`);

  // F: the lint and the applier agree
  const folder = [{ name: M1, text: T1 }, { name: M2, text: T2 }, { name: '20260101000005_late.sql', text: 'select 1;\n-- no-transaction\ncreate index concurrently t_b on t (a);\n' }];
  const lint = lintAll(folder, [], patchedText);
  fact('lint agrees with the applier: the header-after-statement file is C1, the leading-header file is clean', lint.open.some(f => f.file === '20260101000005_late.sql' && f.rule === 'C1') && lint.open.every(f => f.file === '20260101000005_late.sql') && !lint.open.some(f => f.file === M2), lint.open.map(f => `${f.file}:${f.line} ${f.rule}`).join(' '));
  const lintOld = lintAll([{ name: M1, text: T1 }, { name: M2, text: T2 }], [], real.replace(/no-transaction/g, 'x'));
  fact('lint refuses a no-transaction file while the applier cannot run it (applier problem)', lintOld.applierProblems.length === 1, lintOld.applierProblems.join(' '));
} catch (e) {
  failed++; console.log(`FAIL proof crashed: ${String(e.message).slice(0, 400)}`);
} finally { cluster.stop(); rmSync(tmp, { recursive: true, force: true }); }
console.log(`apply-proof: ${failed} FAIL`);
process.exit(failed ? 1 : 0);
