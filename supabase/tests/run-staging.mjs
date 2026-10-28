// Run tenancy.test.sql against the STAGING Supabase project (DECISIONS 15: staging is where every cloud acceptance runs).
//   STAGING_DB_URL=postgres://... node supabase/tests/run-staging.mjs
// The test file runs inside one transaction that is rolled back, so staging keeps no fixtures. This script checks that too:
// before and after, it counts the rows the fixtures would create (slugs and targets starting with "test-") and fails if any remain.
// Refuses to run against anything that is not marked as staging (STAGING_DB_URL only; never the production URL).
// Status: UNPROVEN until W0.3 (no project exists yet).
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const url = process.env.STAGING_DB_URL;
if (!url) { console.error('set STAGING_DB_URL (the staging project connection string)'); process.exit(2); }
if (process.env.PROD_DB_URL && process.env.PROD_DB_URL === url) { console.error('refusing: STAGING_DB_URL equals PROD_DB_URL'); process.exit(2); }
const psql = args => spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], { encoding: 'utf8', timeout: 300000 });
const leftovers = () => {
  const r = psql(['-t', '-A', '-c', "select (select count(*) from public.workspaces where slug like 'test-%') + (select count(*) from public.sites where deploy_target like 'test-%') + (select count(*) from auth.users where email like '%@test')"]);
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
  return Number(r.stdout.trim());
};
const before = leftovers();
if (before !== 0) { console.error(`staging already holds ${before} test fixture row(s): clean them first`); process.exit(1); }
const run = psql(['-f', join(HERE, 'tenancy.test.sql')]);
const after = leftovers();
const passed = run.status === 0 && /ALL TENANCY TESTS PASSED/.test(run.stdout);
console.log(passed ? 'PASS tenancy tests on staging' : `FAIL tenancy tests on staging:\n${(run.stdout + run.stderr).split('\n').filter(l => /ERROR|EXPECTED|assert/i.test(l)).join('\n')}`);
console.log(after === 0 ? 'OK: no fixtures left on staging (rolled back)' : `FAIL: ${after} fixture row(s) left on staging`);
process.exit(passed && after === 0 ? 0 : 1);
