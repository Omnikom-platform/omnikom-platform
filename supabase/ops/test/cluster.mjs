// Throwaway local Postgres clusters for the ops tests (promote-check, key-ages; 6B may reuse it). Started the way
// supabase/tests/run-local.mjs starts one: initdb in the SYSTEM TEMP folder (C:, never the repository's disk), trust auth,
// a random port, no unix socket. Nothing here needs an account.
//   const c = startCluster('proven');          // { url, port, dir, sql(text), file(path), scalar(text), stop() }
//   loadPlatform(c);                           // local-shim.sql, then every migration through supabase/apply-staging.mjs
//   c.stop();                                  // pg_ctl stop and delete the folder
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// 5-H: the cluster folder is guarded (stopped and removed on every exit path; swept when an earlier run was killed)
import { guardedTemp, sweep } from '../../../tools/proc-guard/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SUPABASE_DIR = resolve(HERE, '..', '..');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 300000, windowsHide: true, ...opts });
const used = new Set();
const pickPort = () => { for (;;) { const p = 57000 + Math.floor(Math.random() * 1900); if (!used.has(p)) { used.add(p); return p; } } };

let swept = false;
export function startCluster(label = 'ops') {
  if (!swept) { swept = true; sweep(); }
  const guard = guardedTemp('omnikom-pg-', 'cluster', { label: `ops-${label}` });
  const dir = guard.dir;
  const data = join(dir, 'data');
  const port = pickPort();
  let r = run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  if (r.status !== 0) { guard.release(); throw new Error(`initdb failed: ${r.stderr || r.error}`); }
  r = run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ""`, '-l', join(dir, 'pg.log'), '-w', 'start']);
  if (r.status !== 0) {
    let log = ''; try { log = readFileSync(join(dir, 'pg.log'), 'utf8'); } catch { /* no log */ }
    guard.release();
    throw new Error(`pg_ctl start failed: ${r.stderr}\n${log}`);
  }
  const url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  const psql = args => run('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args]);
  const c = {
    label, dir, port, url,
    sql(text) { const x = psql(['-c', text]); if (x.status !== 0) throw new Error(`sql failed on ${label}: ${(x.stderr || '').trim()}`); return x.stdout; },
    file(path) { const x = psql(['-f', path]); if (x.status !== 0) throw new Error(`file failed on ${label}: ${(x.stderr || '').trim()}`); return x.stdout; },
    scalar(text) { const x = psql(['-t', '-A', '-c', text]); if (x.status !== 0) throw new Error(`sql failed on ${label}: ${(x.stderr || '').trim()}`); return x.stdout.trim(); },
    stop() {
      guard.release();   // pg_ctl stop -m immediate, any process naming the folder, then the folder
      used.delete(port);
    },
  };
  return c;
}

// The Supabase model, then the repository's migrations through the real apply script (so the ledger is the one staging has).
export function loadPlatform(c) {
  c.file(join(SUPABASE_DIR, 'tests', 'local-shim.sql'));
  const r = run('node', [join(SUPABASE_DIR, 'apply-staging.mjs')], { env: { ...process.env, STAGING_DB_URL: c.url }, timeout: 600000 });
  if (r.status !== 0) throw new Error(`apply-staging failed on ${c.label}: ${(r.stdout + r.stderr).slice(-400)}`);
}
