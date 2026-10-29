// Proof for supabase/apply-staging.mjs on a throwaway local cluster (same setup as run-local.mjs: the Supabase model in
// local-shim.sql, then the migrations through the apply script over a real connection string).
//   node supabase/tests/test-apply.mjs
// Checks: run 1 applies every file; run 2 applies none; --dry-run after that reports 0 pending; an applied file edited on disk
// is refused; the script refuses to run without the URL variable; the tenancy tests pass on the database the script built.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPABASE = resolve(HERE, '..');
const PORT = String(56000 + Math.floor(Math.random() * 900));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 300000, ...opts });
const dir = mkdtempSync(join(tmpdir(), 'omnikom-apply-'));
const data = join(dir, 'data');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ': ' + detail}`); if (!ok) failed++; };

let r = run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
if (r.status !== 0) { console.error('initdb failed'); process.exit(2); }
r = run('pg_ctl', ['-D', data, '-o', `-p ${PORT} -k ""`, '-l', join(dir, 'pg.log'), '-w', 'start']);
if (r.status !== 0) { console.error('pg_ctl failed'); process.exit(2); }
const URL = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
const psql = args => run('psql', [URL, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args]);
psql(['-f', join(HERE, 'local-shim.sql')]);

// a private copy of the supabase folder, so the "edited applied file" check never touches the repo
const copy = join(dir, 'supabase');
cpSync(SUPABASE, copy, { recursive: true, filter: p => !/node_modules|\.localdb/.test(p) });
const apply = (args, env = {}) => run('node', [join(copy, 'apply-staging.mjs'), ...args], { env: { ...process.env, STAGING_DB_URL: URL, ...env } });
const files = readdirSync(join(copy, 'migrations')).filter(f => f.endsWith('.sql')).sort();

r = run('node', [join(copy, 'apply-staging.mjs')], { env: { ...process.env, STAGING_DB_URL: '' } });
check('refuses without the URL variable', r.status === 2 && /STAGING_DB_URL/.test(r.stderr));

r = apply([]);
check(`run 1 applies every file (${files.length})`, r.status === 0 && new RegExp(`OK: applied ${files.length} of ${files.length}`).test(r.stdout), r.stdout + r.stderr);
check('run 1 never prints the connection string', !r.stdout.includes(URL) && !r.stderr.includes(URL));
r = apply([]);
check('run 2 applies none', r.status === 0 && /OK: applied 0 of/.test(r.stdout), r.stdout + r.stderr);
r = apply(['--dry-run']);
check('dry run after that reports 0 pending', r.status === 0 && /DRY RUN: 0 pending/.test(r.stdout), r.stdout);
r = psql(['-t', '-A', '-c', 'select count(*) from ops.platform_migrations']);
check('ledger holds one row per file', r.stdout.trim() === String(files.length), r.stdout);

// the database the script built passes the tenancy tests (the same file run-local.mjs and run-staging.mjs use)
r = psql(['-f', join(HERE, 'tenancy.test.sql')]);
check('tenancy tests pass on the applied database', r.status === 0 && /ALL TENANCY TESTS PASSED/.test(r.stdout), (r.stdout + r.stderr).split('\n').filter(l => /ERROR|EXPECTED/.test(l)).join(' | '));

// edit an applied file on disk: refused, nothing applied
const first = join(copy, 'migrations', files[0]);
writeFileSync(first, readFileSync(first, 'utf8') + '\n-- edited after it was applied\n');
r = apply([]);
check('an edited applied migration is refused', r.status === 1 && /never edit an applied migration/.test(r.stderr), r.stdout + r.stderr);

// production guard
r = apply([], { PROD_DB_URL: URL });
check('refuses when STAGING_DB_URL equals PROD_DB_URL', r.status === 2 && /equals PROD_DB_URL/.test(r.stderr));
r = apply(['--url-env', 'PROD_DB_URL'], { PROD_DB_URL: URL });
check('production needs --i-mean-production', r.status === 2 && /i-mean-production/.test(r.stderr));

run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
rmSync(dir, { recursive: true, force: true });
console.log(`\n${failed ? 'FAILED' : 'OK'}: apply-staging ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
