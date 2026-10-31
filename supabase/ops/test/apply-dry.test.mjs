// apply-staging.mjs --dry-run writes nothing (finding of builder 6A, 2026-10-31: it created schema ops and the ledger first).
//   node supabase/ops/test/apply-dry.test.mjs [--script <copy of apply-staging.mjs>]   exit 0 = every check passed
// --script runs the checks against another copy (used to watch this test fail on the old script).
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { startCluster, loadPlatform, SUPABASE_DIR } from './cluster.mjs';

const at = process.argv.indexOf('--script');
const SCRIPT = at >= 0 ? resolve(process.argv[at + 1]) : resolve(SUPABASE_DIR, 'apply-staging.mjs');
const N = readdirSync(resolve(SUPABASE_DIR, 'migrations')).filter(f => f.endsWith('.sql')).length;
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `   ${detail}`}`); };
const dry = url => spawnSync(process.execPath, [SCRIPT, '--dry-run', '--url-env', 'DRY_TEST_DB_URL'], { encoding: 'utf8', timeout: 120000, env: { ...process.env, DRY_TEST_DB_URL: url, PROD_DB_URL: '' } });

const c = startCluster('apply-dry');
try {
  let r = dry(c.url);
  const last = (r.stdout || '').trim().split(/\r?\n/).pop();
  check('empty database: the dry run lists every migration as pending', r.status === 0 && last === `DRY RUN: ${N} pending of ${N}`, `${r.status} ${last} ${(r.stderr || '').slice(0, 200)}`);
  check('empty database: the dry run created no schema ops', c.scalar("select count(*) from pg_namespace where nspname = 'ops'") === '0', c.scalar("select count(*) from pg_namespace where nspname = 'ops'"));
  check('empty database: the dry run created no ledger anywhere', c.scalar("select count(*) from pg_class where relname = 'platform_migrations'") === '0');
  loadPlatform(c);
  r = dry(c.url);
  const last2 = (r.stdout || '').trim().split(/\r?\n/).pop();
  check('migrated database: the dry run reads the ledger (0 pending)', r.status === 0 && last2 === `DRY RUN: 0 pending of ${N}`, `${r.status} ${last2}`);
  c.sql("alter table ops.platform_migrations set schema public; drop schema ops;");
  r = dry(c.url);
  const last3 = (r.stdout || '').trim().split(/\r?\n/).pop();
  check('legacy ledger in public: read, not moved', r.status === 0 && last3 === `DRY RUN: 0 pending of ${N}` && c.scalar("select count(*) from pg_namespace where nspname = 'ops'") === '0', `${r.status} ${last3}`);
} finally { c.stop(); }
console.log(bad ? `FAILED: ${bad} check(s)` : 'APPLY-DRY TESTS OK: 5 checks');
process.exit(bad ? 1 : 0);
