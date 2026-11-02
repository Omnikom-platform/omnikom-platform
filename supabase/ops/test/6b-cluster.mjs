// A throwaway local Postgres cluster for the 6B tests and the restore drill: initdb + pg_ctl in the system temp folder (C:, never E:).
// Same recipe as supabase/tests/run-local.mjs (trust auth, no locale, a random port, no unix socket). Nothing here touches a real project.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
// 5-H: the cluster folder is guarded (stopped and removed on every exit path; swept when an earlier run was killed)
import { guardedTemp, sweep } from '../../../tools/proc-guard/index.mjs';
import { startOnBlock } from '../../tests/lib/cluster-port.mjs';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 10 * 60 * 1000, windowsHide: true, ...opts });
const outOf = x => `${x.stdout ?? ''}${x.stderr ?? ''}${x.error ? `\n(${x.error.code || x.error.message})` : ''}`.trim();

let swept = false;
export function startCluster({ label = '6b' } = {}) {
  if (!swept) { swept = true; sweep(); }
  const guard = guardedTemp('omnikom-pg-', 'cluster', { label });
  const dir = guard.dir;
  const data = join(dir, 'data');
  let r = run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  if (r.status !== 0) { guard.release(); throw new Error(`initdb failed: ${outOf(r).slice(0, 400)}`); }
  // 5-PORT: port block, listen pin, bind fallback; stdio ignored: piped output would be held open by the server, spawnSync would wait for its timeout
  const started = startOnBlock('6b-cluster', { data, log: join(dir, 'pg.log'), run, opts: { stdio: 'ignore' } });
  if (!started.ok) {
    guard.release();
    throw new Error(`pg_ctl start failed: ${outOf(started).slice(0, 300)} ${started.log.slice(-400)}`);
  }
  const port = String(started.port);
  const base = ['-h', '127.0.0.1', '-p', port, '-U', 'postgres'];
  const c = {
    dir, port,
    url: db => `postgresql://postgres@127.0.0.1:${port}/${db}`,
    psql: (db, args, opts = {}) => run('psql', [...base, '-d', db, '-X', '-v', 'ON_ERROR_STOP=1', ...args], opts),
    sql: (db, text) => { const x = run('psql', [...base, '-d', db, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: text }); return { ok: x.status === 0, out: (x.stdout || '').trim(), err: outOf(x) }; },
    createDb: name => c.sql('postgres', `create database ${name}`),
    stop: () => guard.release(),   // pg_ctl stop -m immediate, any process naming the folder, then the folder
  };
  return c;
}

// the roles Supabase gives every project (the policies of the migrations name them)
export const ROLES_SQL = `do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;`;
