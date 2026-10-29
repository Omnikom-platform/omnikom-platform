// Enables the platform's extensions on the staging project (25-BUILD-SEQUENCE 1.1) and prints what is installed.
//   node tools/with-env.mjs "<env file>" -- node tools/staging-extensions.mjs [--check-only]
// pg_cron and pgmq are installed in their own schemas by Supabase; pg_net in extensions. One that is missing from the
// Free plan is reported, not worked around (a design change, per the sequence file).
import { spawnSync } from 'node:child_process';
const url = process.env.STAGING_DB_URL_DIRECT || process.env.STAGING_DB_URL;
if (!url) { console.error('set STAGING_DB_URL_DIRECT (read by name, never printed)'); process.exit(2); }
const want = ['pg_cron', 'pg_net', 'pgmq', 'pg_stat_statements'];
const checkOnly = process.argv.includes('--check-only');
const psql = sql => spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', timeout: 120000 });
const scrub = s => (s || '').split(url).join('<db url>').trim();
let failed = 0;
if (!checkOnly) for (const e of want) {
  // pg_cron insists on pg_catalog and pgmq on its own schema; the rest go to `extensions` as the dashboard does
  const schema = e === 'pg_cron' || e === 'pgmq' ? '' : ' with schema extensions';
  if (e === 'pg_net') psql("do $$ begin if exists (select 1 from pg_extension x join pg_namespace n on n.oid = x.extnamespace where extname = 'pg_net' and n.nspname = 'public') then drop extension pg_net; end if; end $$");
  const r = psql(`create extension if not exists ${e}${schema} cascade`);
  if (r.status !== 0) { failed++; console.log(`FAIL create extension ${e}: ${scrub(r.stderr).slice(0, 200)}`); }
}
const r = psql(`select extname || ' ' || extversion || ' schema=' || n.nspname from pg_extension x join pg_namespace n on n.oid = x.extnamespace where extname = any(array['${want.join("','")}']) order by 1`);
if (r.status !== 0) { console.log(`FAIL reading pg_extension: ${scrub(r.stderr).slice(0, 200)}`); process.exit(1); }
const have = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
for (const e of want) { const line = have.find(h => h.startsWith(e + ' ')); console.log(`${line ? 'ok  ' : 'MISSING'} ${line || e}`); if (!line) failed++; }
const all = psql("select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension");
console.log(`all installed: ${all.stdout.trim()}`);
console.log(failed ? `FAIL ${failed}` : `PASS extensions on staging: ${want.length} of ${want.length}`);
process.exit(failed ? 1 : 0);
