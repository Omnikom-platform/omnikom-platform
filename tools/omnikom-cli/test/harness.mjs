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
// (method, site id, signature against the site's keys read from the database through service.active_key and the Vault view, JSON, consent, then service.capture_lead). With `naive`, the signature
// check is skipped: a broken function that `verify` must catch. With `dropIdem`, the idempotency key is dropped: a retry stores a
// second row (the other broken function the CLI must catch). Like the function, the model records one new-lead alert per lead
// in `messages` (service.record_message, to the site's lead_alert_to); with `doubleAlert` it alerts on every call, so a retry
// alerts twice (the bug found on 2026-10-30; the function dedupes on messages.lead_id + template).
// Migration 7 (what the function does since step 3): every refusal is recorded through service.record_security_event with the
// function's own kind and code (bad signature: 'bad-signature' SIGNATURE; the database's refusals: refusal() below), a paused site
// or suspended workspace answers 409, a quota 429, and the consent ledger row is written by service.capture_lead itself (never by
// the model). With `noSecurityLog` a refusal is not recorded; with `doubleConsent` a second consent row is written for every
// accepted call (private.record_consent again); with `pausedAs500` a paused site answers 500, as before step 3: each is a broken
// function that `verify` must catch.
export async function makeFunctionModel({ makeSql, dbUrl, naive = false, dropIdem = false, doubleAlert = false, noSecurityLog = false, doubleConsent = false, pausedAs500 = false }) {
  const { verify } = await import(pathToFileURL(join(REPO_ROOT, 'supabase', 'functions', '_shared', 'signature.ts')).href);
  const sql = makeSql({ url: dbUrl });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lit = v => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  const calls = [];
  const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  // what the database said no to, as the function's answer (refusal() in supabase/functions/capture-lead/index.ts)
  const refusal = message => {
    if (message.includes('S-SITE-PAUSED')) return { status: 409, code: 'S-SITE-PAUSED', kind: 'suspended' };
    if (message.includes('S-WORKSPACE-SUSPENDED')) return { status: 409, code: 'S-WORKSPACE-SUSPENDED', kind: 'suspended' };
    if (message.includes('S-QUOTA')) return { status: 429, code: 'S-QUOTA', kind: 'quota' };
    if (message.includes('unknown site')) return { status: 404, code: 'SITE', kind: 'refused' };
    if (message.includes('consent text required')) return { status: 400, code: 'REQUIRED', kind: 'bad-request' };
    return null;
  };
  async function model(url, init = {}) {
    const u = new URL(url);
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    if (init.method !== 'POST') return reply(405, { problems: [{ code: 'METHOD' }] });
    const site = u.searchParams.get('site') || '';
    if (!UUID.test(site)) return reply(404, { problems: [{ code: 'SITE' }] });
    const body = init.body || '';
    const path = u.pathname.replace(/^\/functions\/v1/, '') + u.search;
    const event = (kind, code) => { if (!noSecurityLog) sql.exec(`select service.record_security_event(${lit(kind)}, ${lit(code)}, null, ${lit(site)}::uuid, null, null, ${lit(JSON.stringify({ path: u.pathname }))}::jsonb);`); };
    let ok = naive;
    // the keys come from the database exactly as the function reads them (index.ts): service.active_key joined to the Vault view.
    // (until 2026-10-30 the model held the keys in memory and never asked the lookup: a lookup that finds nothing passed every test)
    const found = sql.rows(`select s.decrypted_secret as secret from service.active_key('site-signing', ${lit(site)}::uuid) k join vault.decrypted_secrets s on s.name = k.vault_ref`);
    if (!found.ok) return reply(500, { problems: [{ code: 'SERVER' }] });
    for (const k of found.rows) if (await verify((init.headers || {})['x-site-signature'] || null, k.secret, 'POST', path, body)) ok = true;
    if (!ok) { event('bad-signature', 'SIGNATURE'); return reply(401, { problems: [{ code: 'SIGNATURE' }] }); }
    let d;
    try { d = JSON.parse(body); } catch { return reply(400, { problems: [{ code: 'BODY' }] }); }
    if (!d.form || !d.page || typeof d.consentText !== 'string' || d.consentText === '') return reply(400, { problems: [{ code: 'REQUIRED' }] });
    const r = sql.exec(`select service.capture_lead(${lit(site)}::uuid, ${lit(d.form)}, ${lit(d.page)}, ${lit(d.name)}, ${lit(d.email)}, ${lit(d.phone)}, ${lit(JSON.stringify(d.answers || {}))}::jsonb, ${lit(d.consentText)}, ${lit(d.flow)}, ${lit(d.cta)}, ${d.marketingConsent ? lit(JSON.stringify(d.marketingConsent)) : 'null'}::jsonb, ${dropIdem ? 'null' : lit(d.idempotencyKey)}::uuid, null, null, null);`);
    if (!r.ok) {
      const why = pausedAs500 && r.message.includes('S-SITE-PAUSED') ? null : refusal(r.message);
      if (!why) return reply(500, { problems: [{ code: 'SERVER' }] });
      event(why.kind, why.code);
      return reply(why.status, { problems: [{ code: why.code }] });
    }
    const leadId = r.out.split(/\r?\n/).filter(Boolean).pop();
    if (doubleConsent) sql.exec(`select private.record_consent((select workspace_id from sites where id = ${lit(site)}::uuid), ${lit(site)}::uuid, ${lit(leadId)}::uuid, ${lit(d.form)}, ${lit(d.page)}, ${lit(d.consentText)}, false, null, null, null, null);`);
    sql.exec(`do $a$ declare ws uuid; t text; begin
      if ${doubleAlert ? 'false' : 'true'} and exists (select 1 from messages where lead_id = ${lit(leadId)}::uuid and template = 'new-lead') then return; end if;
      select workspace_id into ws from sites where id = ${lit(site)}::uuid;
      for t in select unnest(lead_alert_to) from sites where id = ${lit(site)}::uuid loop
        perform service.record_message(ws, ${lit(leadId)}::uuid, null, 'email', 'new-lead', t);
      end loop;
    end $a$;`);
    return reply(202, { ok: true });
  }
  model.calls = calls;
  return model;
}

// A MODEL of GoTrue (admin generate_link, verify, the MFA endpoints) and PostgREST (reads and one update as the caller), over a fake
// fetch against the local database. A session token is a JWT-shaped string carrying sub and aal (unsigned: only this model reads
// it); a read runs as the `authenticated` role with those claims, so the database's row-level security decides, as on a project.
//   blindAuth  GoTrue cannot find the seeded users (answers generate_link with the 500 seen on 2026-10-30)
//   leaky      the Data API ignores the caller (reads as the table owner): a broken wall that `verify --only people` must catch
//   noMfa      every session counts as aal2 (the wall that keeps staff out without MFA is gone)
export async function makeSupabaseModel({ makeSql, dbUrl, anonKey, secretKey, totpSecret = null, blindAuth = false, leaky = false, noMfa = false }) {
  const { totp } = await import(pathToFileURL(join(CLI_ROOT, 'lib', 'totp.mjs')).href);
  const sql = makeSql({ url: dbUrl });
  const lit = v => `'${String(v).replace(/'/g, "''")}'`;
  const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const jwt = claims => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ role: 'authenticated', exp: 4102444800, ...claims })}.${Buffer.from(String(Math.random()) + String(Math.random())).toString('hex').slice(0, 43)}`;
  const claimsOf = auth => { try { return JSON.parse(Buffer.from(String(auth).replace(/^Bearer /, '').split('.')[1], 'base64url').toString()); } catch { return null; } };
  const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const FACTOR = '11111111-aaaa-4aaa-8aaa-111111111111';
  let issued = null;   // the secret the model hands out when a factor is enrolled
  const calls = [];
  async function model(url, init = {}) {
    const u = new URL(url);
    const h = init.headers || {};
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ method: init.method || 'GET', path: u.pathname + u.search });
    if (u.pathname.startsWith('/auth/v1')) {
      const p = u.pathname.slice('/auth/v1'.length);
      if (p === '/admin/generate_link') {
        if (h.apikey !== secretKey || h.authorization !== `Bearer ${secretKey}`) return reply(401, { msg: 'invalid admin key' });
        if (blindAuth) return reply(500, { code: '23505', message: 'duplicate key value violates unique constraint "users_email_partial_key"' });
        const r = sql.rows(`select id from auth.users where email = ${lit(body.email)} and aud = 'authenticated'`);
        if (!r.rows.length) return reply(404, { msg: 'User not found' });
        return reply(200, { id: r.rows[0].id, hashed_token: `h${Buffer.from(r.rows[0].id).toString('hex')}` });
      }
      if (p === '/verify') {
        if (h.apikey !== anonKey) return reply(401, { msg: 'no api key' });
        const id = Buffer.from(String(body.token_hash || '').slice(1), 'hex').toString();
        return reply(200, { access_token: jwt({ sub: id, aal: 'aal1' }), token_type: 'bearer', expires_in: 3600 });
      }
      const c = claimsOf(h.authorization);
      if (!c) return reply(401, { msg: 'no session' });
      if (p === '/user') return reply(200, { id: c.sub, factors: (totpSecret || issued) ? [{ id: FACTOR, factor_type: 'totp', status: 'verified' }] : [] });
      if (p === '/factors') { issued = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; return reply(200, { id: FACTOR, totp: { secret: issued } }); }
      if (p.startsWith('/admin/users/') && init.method === 'DELETE') { issued = null; return reply(200, {}); }
      if (p === `/factors/${FACTOR}/challenge`) return reply(200, { id: 'challenge-1' });
      if (p === `/factors/${FACTOR}/verify`) {
        const now = Date.now() / 1000;
        const ok = [now - 30, now, now + 30].some(t => totp(totpSecret || issued, t) === body.code);
        return ok && body.challenge_id === 'challenge-1' ? reply(200, { access_token: jwt({ sub: c.sub, aal: 'aal2' }) }) : reply(400, { msg: 'Invalid TOTP code entered' });
      }
      return reply(404, { msg: 'no such Auth endpoint in the model' });
    }
    // the Data API
    const p = u.pathname.replace(/^\/rest\/v1/, '');
    if (h.apikey !== anonKey) return reply(401, { message: 'No API key found in request' });
    if (p.startsWith('/rpc/')) return reply(406, { code: 'PGRST106' });
    const table = p.slice(1);
    if (!['leads', 'api_keys', 'workspaces', 'sites'].includes(table)) return reply(404, { code: 'PGRST205' });
    const claims = claimsOf(h.authorization);
    if (!claims) return reply(401, { code: '42501' });   // the anon role has no table rights
    const ids = (u.searchParams.get('id') || '').replace(/^(in\.\(|eq\.)/, '').replace(/\)$/, '').split(',').filter(Boolean);
    const where = ids.length ? `where id in (${ids.map(i => `${lit(i)}::uuid`).join(', ')})` : '';
    if (init.method === 'PATCH') {
      const script = `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: claims.sub, aal: claims.aal, role: 'authenticated' }))}, true), set_config('request.jwt.claim.sub', ${lit(claims.sub)}, true);\nupdate leads set status = ${lit(body.status)}::lead_status ${where};\ncommit;`;
      const r = sql.exec(script);
      return r.ok ? reply(200, []) : reply(/permission denied/.test(r.message) ? 403 : 400, { code: '42501' });
    }
    const q = `select id from public.${table} ${where} limit ${Number(u.searchParams.get('limit')) || 1000}`;
    const r = leaky ? sql.rows(q) : sql.rows(q, { claims: { sub: claims.sub, aal: noMfa ? 'aal2' : claims.aal, role: 'authenticated' } });
    return r.ok ? reply(200, r.rows) : reply(403, { code: '42501' });
  }
  model.calls = calls;
  return model;
}

export const readFile = p => readFileSync(p, 'utf8');
