// Test helpers: a throwaway local Postgres cluster (the pattern of supabase/tests/run-local.mjs and test-apply.mjs), a model of the
// capture-lead function that runs over a fake fetch against that cluster, and a way to call the CLI in-process.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLI_ROOT = process.env.OMNIKOM_CLI_DIR ? resolve(process.env.OMNIKOM_CLI_DIR) : resolve(HERE, '..');
export const REPO_ROOT = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(HERE, '..', '..', '..');
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 180000, ...opts });

// start a cluster, or use the one a parent process (mutate.mjs) already started: OMNIKOM_TEST_CLUSTER_PORT
export function startCluster() {
  if (process.env.OMNIKOM_TEST_CLUSTER_PORT) return { port: process.env.OMNIKOM_TEST_CLUSTER_PORT, stop() {}, shared: true };
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-cli-pg-'));
  const data = join(dir, 'data');
  const port = String(57000 + Math.floor(Math.random() * 900));
  let r = sh('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.error));
  r = sh('pg_ctl', ['-D', data, '-o', `-p ${port} -k ""`, '-l', join(dir, 'pg.log'), '-w', 'start']);
  if (r.status !== 0) throw new Error('pg_ctl start failed: ' + r.stderr);
  return { port, dir, stop() { sh('pg_ctl', ['-D', data, '-m', 'fast', 'stop']); rmSync(dir, { recursive: true, force: true }); } };
}

let dbCounter = 0;
// a fresh database with the Supabase model (local-shim.sql) and the Vault model; no migrations (the CLI's `apply` does that)
export function freshDb(cluster, { vault = true } = {}) {
  const name = `omk${process.pid}_${++dbCounter}`;
  const psql = (db, args) => sh('psql', ['-h', '127.0.0.1', '-p', cluster.port, '-U', 'postgres', '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args]);
  let r = psql('postgres', ['-c', `create database ${name}`]);
  if (r.status !== 0) throw new Error('create database failed: ' + r.stderr);
  for (const f of [join(REPO_ROOT, 'supabase', 'tests', 'local-shim.sql'), ...(vault ? [join(CLI_ROOT, 'test', 'vault-shim.sql')] : [])]) {
    r = psql(name, ['-f', f]);
    if (r.status !== 0) throw new Error(`setup ${f} failed: ${r.stderr}`);
  }
  return { name, url: `postgres://postgres@127.0.0.1:${cluster.port}/${name}`, query: sql => psql(name, ['-t', '-A', '-c', sql]).stdout.trim() };
}

// the CLI, called in-process; deps.env is the whole environment the command sees
export async function loadCli() { return import(pathToFileURL(join(CLI_ROOT, 'omnikom.mjs')).href); }
export async function cli(argv, env, deps = {}) {
  const { main } = await loadCli();
  const r = await main(argv, { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, ...deps });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* reported by the caller */ }
  return { ...r, json, all: r.stdout + r.stderr };
}

// A MODEL of supabase/functions/capture-lead/index.ts (the TS file needs Deno and Postgres on a project): same order of checks
// (method, site id, signature against the site's keys, JSON, consent, then service.capture_lead). With `naive`, the signature
// check is skipped: a broken function that `verify` must catch. With `dropIdem`, the idempotency key is dropped: a retry stores a
// second row (the other broken function the CLI must catch).
export async function makeFunctionModel({ makeSql, dbUrl, keys, naive = false, dropIdem = false }) {
  const { verify } = await import(pathToFileURL(join(REPO_ROOT, 'supabase', 'functions', '_shared', 'signature.ts')).href);
  const sql = makeSql({ url: dbUrl });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lit = v => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  const calls = [];
  const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  async function model(url, init = {}) {
    const u = new URL(url);
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    if (init.method !== 'POST') return reply(405, { problems: [{ code: 'METHOD' }] });
    const site = u.searchParams.get('site') || '';
    if (!UUID.test(site)) return reply(404, { problems: [{ code: 'SITE' }] });
    const body = init.body || '';
    const path = u.pathname.replace(/^\/functions\/v1/, '') + u.search;
    let ok = naive;
    for (const k of keys[site.toLowerCase()] || []) if (await verify((init.headers || {})['x-site-signature'] || null, k, 'POST', path, body)) ok = true;
    if (!ok) return reply(401, { problems: [{ code: 'SIGNATURE' }] });
    let d;
    try { d = JSON.parse(body); } catch { return reply(400, { problems: [{ code: 'BODY' }] }); }
    if (!d.form || !d.page || typeof d.consentText !== 'string' || d.consentText === '') return reply(400, { problems: [{ code: 'REQUIRED' }] });
    const r = sql.exec(`select service.capture_lead(${lit(site)}::uuid, ${lit(d.form)}, ${lit(d.page)}, ${lit(d.name)}, ${lit(d.email)}, ${lit(d.phone)}, ${lit(JSON.stringify(d.answers || {}))}::jsonb, ${lit(d.consentText)}, ${lit(d.flow)}, ${lit(d.cta)}, ${d.marketingConsent ? lit(JSON.stringify(d.marketingConsent)) : 'null'}::jsonb, ${dropIdem ? 'null' : lit(d.idempotencyKey)}::uuid, null, null, null);`);
    if (!r.ok) return reply(500, { problems: [{ code: 'SERVER' }] });
    return reply(202, { ok: true });
  }
  model.calls = calls;
  return model;
}

export const readFile = p => readFileSync(p, 'utf8');
