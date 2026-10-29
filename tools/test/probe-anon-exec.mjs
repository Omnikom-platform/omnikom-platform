// Lists the functions in `public` that `anon` may execute on the database named by STAGING_DB_URL_DIRECT, with their owner and
// origin extension (to see whether a wall leaks or a vendor default grants them). Prints nothing of the URL.
//   node tools/with-env.mjs "<env file>" -- node tools/test/probe-anon-exec.mjs
import { spawnSync } from 'node:child_process';
const url = process.env.STAGING_DB_URL_DIRECT || process.env.STAGING_DB_URL;
if (!url) { console.log('STAGING_DB_URL_DIRECT: MISSING'); process.exit(2); }
const sql = `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')  owner=' || pg_get_userbyid(p.proowner) || coalesce('  ext=' || e.extname, '')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
left join pg_depend d on d.objid = p.oid and d.deptype = 'e' left join pg_extension e on e.oid = d.refobjid
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`;
const r = spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', timeout: 60000 });
if (r.status !== 0) { console.log('FAILED ' + (r.stderr || '').split(url).join('<db url>').slice(0, 300)); process.exit(1); }
const lines = r.stdout.split(/\r?\n/).filter(Boolean);
console.log(lines.length ? lines.join('\n') : '(none)');
const d = spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-c', "select defaclrole::regrole || ' ' || coalesce(defaclnamespace::regnamespace::text, '(all)') || ' ' || defaclobjtype || ' ' || defaclacl::text from pg_default_acl"], { encoding: 'utf8', timeout: 60000 });
console.log('default ACLs:\n' + d.stdout.trim());
