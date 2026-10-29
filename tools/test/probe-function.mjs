// Prints the definition, ACL and event-trigger use of one function on the staging database, by qualified name.
//   node tools/with-env.mjs "<env file>" -- node tools/test/probe-function.mjs public.rls_auto_enable
import { spawnSync } from 'node:child_process';
const url = process.env.STAGING_DB_URL_DIRECT || process.env.STAGING_DB_URL;
const name = process.argv[2];
if (!url || !name) { console.log('usage: STAGING_DB_URL_DIRECT=... probe-function.mjs schema.name'); process.exit(2); }
const q = sql => { const r = spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-c', sql], { encoding: 'utf8', timeout: 60000 }); return r.status === 0 ? r.stdout.trim() : 'ERR ' + (r.stderr || '').split(url).join('<db url>').slice(0, 200); };
console.log('acl: ' + q(`select coalesce(p.proacl::text, '(default)') from pg_proc p where p.oid = '${name}'::regproc`));
console.log('event triggers using it: ' + (q(`select string_agg(evtname || ' on ' || evtevent || ' enabled=' || evtenabled, ', ') from pg_event_trigger where evtfoid = '${name}'::regproc`) || '(none)'));
console.log('definition:\n' + q(`select pg_get_functiondef('${name}'::regproc)`).slice(0, 1500));
