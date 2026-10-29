// Proves a database URL from the environment works, printing nothing of it: `select version()` and the SSL state.
//   node tools/with-env.mjs "<env file>" -- node tools/test/probe-db.mjs [URL_ENV_NAME=STAGING_DB_URL]
import { spawnSync } from 'node:child_process';
const name = process.argv[2] || 'STAGING_DB_URL';
const url = process.env[name];
if (!url) { console.log(`${name}: MISSING`); process.exit(2); }
const r = spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', "select 'pg ' || split_part(version(), ' ', 2) || ' ssl=' || coalesce((select ssl::text from pg_stat_ssl where pid = pg_backend_pid()), '?') || ' user=' || current_user"], { encoding: 'utf8', timeout: 30000 });
const scrub = s => (s || '').split(url).join('<db url>').trim();
console.log(r.status === 0 ? `${name}: HTTP-like OK: ${scrub(r.stdout)}` : `${name}: FAILED (exit ${r.status}) ${scrub(r.stderr).slice(0, 300)}`);
// SSL enforcement: the same URL with sslmode=disable must be refused by the server
const plain = url.replace(/sslmode=[a-z-]+/, 'sslmode=disable') + (/sslmode=/.test(url) ? '' : (url.includes('?') ? '&' : '?') + 'sslmode=disable');
const p = spawnSync('psql', [plain, '-X', '-q', '-t', '-A', '-c', 'select 1'], { encoding: 'utf8', timeout: 30000 });
console.log(p.status !== 0 ? `${name}: SSL enforced (a non-SSL connection was refused: ${scrub(p.stderr).split('\n')[0].slice(0, 120)})` : `${name}: SSL NOT ENFORCED (a non-SSL connection succeeded)`);
process.exit(r.status === 0 && p.status !== 0 ? 0 : 1);
