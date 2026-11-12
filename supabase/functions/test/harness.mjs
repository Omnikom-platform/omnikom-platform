// The throwaway world the Edge Function tests run in (slice 4.2): a Postgres cluster built the way supabase/tests/run-local.mjs builds
// one (local-shim.sql + every migration in file order), seeded with the CLI's own fixtures (tools/omnikom-cli/commands/seed.mjs
// seedTestSql, imported read-only), plus a tiny HTTP server that plays the three outside services the functions call:
//   GET  /auth/v1/.well-known/jwks.json                       the project's JWKS (an ES256 public key generated for this run)
//   POST /auth/v1/admin/generate_link                         Auth's admin invite (slice 5.2; creates the user in the database named by POST /__auth-user?...&db=<url> and answers
//                                                             the id registered for the email; needs the secret key; records the email, never anything else)
//   POST /auth/v1/invite, POST /auth/v1/otp                   Auth's mail calls (work order 08; records which one, whether the secret key was sent, the email and the user data or
//                                                             create_user; answers the status set with POST /__auth-mail?status=N; sends nothing)
//   GET and PUT /auth/v1/admin/users/<id>                     Auth's own record of a login that exists (S1-E; needs the secret key): GET answers whether it is confirmed (the field
//                                                             email_confirmed_at is left out until it is, as GoTrue does), PUT takes its user_metadata; both are recorded; the fake
//                                                             is told by POST /__auth-login?id=&confirmed=0|1&read=<status>&update=<status> (a login is confirmed unless told not)
//   POST /hook/<path>, POST /hook-redirected                  a customer's CRM webhook (slice 5.2; records the path, the signature header and the body; answers the status you
//                                                             set with POST /__hook?status=N&mode=redirect|slow; a redirect points at /hook-redirected, whose hits are counted)
//   POST /storage/v1/object/upload/sign/media/<path>          Storage's signed-upload endpoint (answers { url, token }; needs the secret key)
//   POST /storage/v1/object/sign/media/<path>                 Storage's signed-download endpoint (slice 4.3; answers { signedURL }; records the path, the
//                                                             expiresIn asked for and how many calls ran at once; can be told to fail for a path or to be slow)
//   POST /repos/test/test/dispatches, POST /repos/test/test/actions/workflows/(publish|media).yml/dispatches   GitHub repository_dispatch and workflow_dispatch
//                                                             (records the path, which token, the body; a workflow path answers 422 unless { ref, inputs } with string inputs; else the status you set)
//   GET  /__recorded, POST /__reset, POST /__github-status?code=N, POST /__sign?fail=<path part>&delay=<ms>     control, for the tests
// The cluster holds a template database (migrations + fixtures); every run gets its own copy, so tests and mutants never see each
// other's rows. Needs initdb / pg_ctl / psql / deno on PATH.
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 5-H: the cluster folder is guarded (stopped and removed on every exit path; swept at start when an earlier run was killed)
import { guardedTemp, sweep } from '../../../tools/proc-guard/index.mjs';
import { startOnBlock } from '../../tests/lib/cluster-port.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 240000, ...opts });
export const SECRET = 'test-not-a-secret';
export const V2_TOKEN = 'test-dispatch-v2-not-a-secret';
// The Supabase Vault does not exist on a plain Postgres. This models the part the migrations use (the same stand-in as tenancy.test.sql T21, which applies it
// only when no vault schema exists): secrets by name, create_secret, update_secret, decrypted_secrets. The function role gets nothing on it.
const VAULT_STANDIN = `create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text not null default '', secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null) returns uuid language sql as
  $f$ insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id $f$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null) returns void language sql as
  $f$ update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description), updated_at = now() where id = secret_id $f$;
`;
export const RUNNER_KEY = 'test-runner-key-not-a-secret';
export const CRON_KEY = 'test-cron-key-not-a-secret';

export async function startHarness() {
  sweep();
  const guard = guardedTemp('omnikom-pg-', 'cluster', { label: 'functions-harness' });
  const dir = guard.dir;
  const data = join(dir, 'data');
  let r = run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  if (r.status !== 0) { guard.release(); throw new Error('initdb failed: ' + (r.stderr || r.error)); }
  const started = startOnBlock('functions-harness', { data, log: join(dir, 'pg.log'), run });   // 5-PORT: port block, listen pin, bind fallback
  if (!started.ok) { const why = 'pg_ctl start failed: ' + started.stderr + started.log; guard.release(); throw new Error(why); }
  const PORT = String(started.port);
  const psql = (db, args) => run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', ...args]);
  const stopDb = () => guard.release();   // pg_ctl stop -m immediate, every process naming the folder, then the folder
  let server = null;
  try {
    // the template database: shim, every migration in order, the CLI's fixtures
    psql('postgres', ['-c', 'create database tpl']);
    const migDir = join(REPO, 'supabase', 'migrations');
    const vaultFile = join(dir, 'vault-standin.sql');
    writeFileSync(vaultFile, VAULT_STANDIN);
    const files = [join(REPO, 'supabase', 'tests', 'local-shim.sql'), vaultFile, ...readdirSync(migDir).filter(f => f.endsWith('.sql')).sort().map(f => join(migDir, f))];
    for (const f of files) { const x = psql('tpl', ['-f', f]); if (x.status !== 0) throw new Error(`applying ${f} failed: ${x.stderr}`); }
    const { seedTestSql } = await import(pathToFileURL(join(REPO, 'tools', 'omnikom-cli', 'commands', 'seed.mjs')).href);
    const seedFile = join(dir, 'seed.sql');
    writeFileSync(seedFile, seedTestSql());
    const sx = psql('tpl', ['-f', seedFile]);
    if (sx.status !== 0) throw new Error('seed failed: ' + sx.stderr);

    // an ES256 key pair for this run; the public half is the JWKS, the private half goes to the tests through the environment
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const kid = 'test-key-1';
    const pub = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
    const priv = { ...privateKey.export({ format: 'jwk' }), kid, alg: 'ES256' };

    const state = { github: [], storage: [], githubStatus: 204, signed: [], signFail: '', signDelayMs: 0, inflight: 0, maxInflight: 0,
      hooks: [], redirected: 0, hookStatus: 200, hookMode: '', hookDelayMs: 0, authLinks: [], authUsers: {}, authStatus: 200, authMails: [], authMailStatus: 200,
      authReads: [], authUpdates: [], authUnconfirmed: {}, authReadStatus: 200, authUpdateStatus: 200 };
    let base = '';
    server = createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
        const u = new URL(req.url, 'http://x');
        if (req.method === 'GET' && u.pathname === '/auth/v1/.well-known/jwks.json') return send(200, { keys: [pub] });
        if (req.method === 'POST' && u.pathname.startsWith('/storage/v1/object/upload/sign/media/')) {
          const path = u.pathname.slice('/storage/v1/object/upload/sign/media/'.length);
          const okKey = req.headers.authorization === `Bearer ${SECRET}`;
          state.storage.push({ path, authorized: okKey, upsert: req.headers['x-upsert'] ?? null });
          if (!okKey) return send(401, { message: 'no' });
          if (state.signFail && path.includes(state.signFail)) return send(400, { message: 'Object not found' });
          return send(200, { url: `/object/upload/sign/media/${path}?token=fake-token`, token: 'fake-token' });
        }
        if (req.method === 'POST' && u.pathname.startsWith('/storage/v1/object/sign/media/')) {
          const path = decodeURIComponent(u.pathname.slice('/storage/v1/object/sign/media/'.length));
          const okKey = req.headers.authorization === `Bearer ${SECRET}`;
          let expiresIn = null; try { expiresIn = JSON.parse(body).expiresIn ?? null; } catch { /* recorded as null */ }
          state.signed.push({ path, authorized: okKey, expiresIn });
          if (!okKey) return send(401, { message: 'no' });
          state.inflight++; state.maxInflight = Math.max(state.maxInflight, state.inflight);
          return setTimeout(() => {
            state.inflight--;
            if (state.signFail && path.includes(state.signFail)) return send(400, { message: 'Object not found' });
            send(200, { signedURL: `/object/sign/media/${path}?token=fake-download-token` });
          }, state.signDelayMs);
        }
        const gh = /^\/repos\/test\/test\/(?:actions\/workflows\/(publish|media)\.yml\/)?dispatches$/.exec(u.pathname);
        if (req.method === 'POST' && gh) {
          let parsed = null; try { parsed = JSON.parse(body); } catch { /* recorded as null */ }
          const auth = req.headers.authorization, token = auth === `Bearer ${V2_TOKEN}` ? 'v2' : auth === `Bearer ${SECRET}` ? 'old' : 'other';
          state.github.push({ path: gh[1] ? gh[1] + '.yml' : 'dispatches', token, authorized: token !== 'other', accept: req.headers.accept, body: parsed });
          // GitHub answers 422 to a workflow_dispatch without a ref or with inputs that are not strings; the fake does the same, so a wrong body is a refusal, not a pass
          const inputs = parsed && parsed.inputs;
          if (gh[1] && (!parsed || typeof parsed.ref !== 'string' || !inputs || typeof inputs !== 'object' || Object.values(inputs).some((v) => typeof v !== 'string'))) return send(422, { message: 'invalid body' });
          return state.githubStatus === 204 ? (res.writeHead(204), res.end()) : send(state.githubStatus, { message: 'refused' });
        }
        if (req.method === 'POST' && u.pathname === '/auth/v1/admin/generate_link') {
          let parsed = null; try { parsed = JSON.parse(body); } catch { /* recorded as null */ }
          const authorized = req.headers.authorization === `Bearer ${SECRET}` && req.headers.apikey === SECRET;
          state.authLinks.push({ authorized, type: parsed && parsed.type, email: parsed && parsed.email, data: parsed && parsed.data !== undefined ? parsed.data : null });
          if (!authorized) return send(401, { message: 'no' });
          if (state.authStatus !== 200) return send(state.authStatus, { message: 'refused' });
          const reg = state.authUsers[parsed && parsed.email];
          if (!reg) return send(500, { message: 'the test registered no id for this email' });
          const id = reg.id;
          if (reg.db) {   // GoTrue creates the user; the fake does the same in the database the test named
            const x = run('psql', [reg.db, '-v', 'ON_ERROR_STOP=1', '-q', '-c', `insert into auth.users (id, email) values ('${id}', '${String(parsed.email).replace(/'/g, "''")}')`]);
            if (x.status !== 0) return send(500, { message: 'the fake could not create the user: ' + String(x.stderr).slice(0, 200) });
          }
          return send(200, { action_link: 'https://fake.invalid/verify?token=THE-LINK-MUST-NEVER-BE-REPEATED', email_otp: '123456', id, email: parsed.email });
        }
        if (req.method === 'POST' && (u.pathname === '/auth/v1/invite' || u.pathname === '/auth/v1/otp')) {
          let parsed = null; try { parsed = JSON.parse(body); } catch { /* recorded as null */ }
          const authorized = req.headers.authorization === `Bearer ${SECRET}` && req.headers.apikey === SECRET;
          state.authMails.push({ kind: u.pathname.slice('/auth/v1/'.length), authorized, email: parsed && parsed.email, data: parsed && parsed.data !== undefined ? parsed.data : null, create_user: parsed && parsed.create_user !== undefined ? parsed.create_user : null });
          if (!authorized) return send(401, { message: 'no' });
          return state.authMailStatus === 200 ? send(200, {}) : send(state.authMailStatus, { message: 'refused' });
        }
        if (u.pathname.startsWith('/auth/v1/admin/users/') && (req.method === 'GET' || req.method === 'PUT')) {   // S1-E: is a login confirmed; its user data
          const id = decodeURIComponent(u.pathname.slice('/auth/v1/admin/users/'.length));
          const authorized = req.headers.authorization === `Bearer ${SECRET}` && req.headers.apikey === SECRET;
          if (req.method === 'GET') {
            state.authReads.push({ id, authorized });
            if (!authorized) return send(401, { message: 'no' });
            if (state.authReadStatus !== 200) return send(state.authReadStatus, { message: 'refused' });
            return send(200, state.authUnconfirmed[id] ? { id } : { id, email_confirmed_at: '2026-11-01T00:00:00Z' });   // GoTrue omits the field until confirmed
          }
          let parsed = null; try { parsed = JSON.parse(body); } catch { /* recorded as null */ }
          state.authUpdates.push({ id, authorized, user_metadata: parsed && parsed.user_metadata !== undefined ? parsed.user_metadata : null });
          if (!authorized) return send(401, { message: 'no' });
          return state.authUpdateStatus === 200 ? send(200, { id }) : send(state.authUpdateStatus, { message: 'refused' });
        }
        if (u.pathname === '/hook-redirected') { state.redirected++; return send(200, {}); }
        if (req.method === 'POST' && u.pathname.startsWith('/hook/')) {
          state.hooks.push({ path: u.pathname.slice('/hook'.length) + u.search, signature: req.headers['x-omnikom-signature'] ?? null, contentType: req.headers['content-type'] ?? null, body });
          if (state.hookMode === 'redirect') { res.writeHead(302, { location: `${base}/hook-redirected` }); return res.end(); }
          return setTimeout(() => (state.hookStatus === 204 ? (res.writeHead(204), res.end()) : send(state.hookStatus, { answer: 'THE-BODY-MUST-NEVER-BE-RETURNED' })), state.hookDelayMs);
        }
        if (u.pathname === '/__recorded') return send(200, state);
        if (u.pathname === '/__reset') { state.github = []; state.storage = []; state.githubStatus = 204; state.signed = []; state.signFail = ''; state.signDelayMs = 0; state.inflight = 0; state.maxInflight = 0;
          state.hooks = []; state.redirected = 0; state.hookStatus = 200; state.hookMode = ''; state.hookDelayMs = 0; state.authLinks = []; state.authUsers = {}; state.authStatus = 200; state.authMails = []; state.authMailStatus = 200;
          state.authReads = []; state.authUpdates = []; state.authUnconfirmed = {}; state.authReadStatus = 200; state.authUpdateStatus = 200; return send(200, {}); }
        if (u.pathname === '/__hook') { state.hookStatus = Number(u.searchParams.get('status') ?? 200); state.hookMode = u.searchParams.get('mode') ?? ''; state.hookDelayMs = Number(u.searchParams.get('delay') ?? 0); return send(200, {}); }
        if (u.pathname === '/__auth-user') { state.authUsers[u.searchParams.get('email')] = { id: u.searchParams.get('id'), db: u.searchParams.get('db') || null }; state.authStatus = Number(u.searchParams.get('status') ?? 200); return send(200, {}); }
        if (u.pathname === '/__auth-mail') { state.authMailStatus = Number(u.searchParams.get('status') ?? 200); return send(200, {}); }
        if (u.pathname === '/__auth-login') { const id = u.searchParams.get('id'); state.authUnconfirmed[id] = u.searchParams.get('confirmed') === '0'; state.authReadStatus = Number(u.searchParams.get('read') ?? 200); state.authUpdateStatus = Number(u.searchParams.get('update') ?? 200); return send(200, {}); }
        if (u.pathname === '/__sign') { state.signFail = u.searchParams.get('fail') ?? ''; state.signDelayMs = Number(u.searchParams.get('delay') ?? 0); return send(200, {}); }
        if (u.pathname === '/__github-status') { state.githubStatus = Number(u.searchParams.get('code')); return send(200, {}); }
        send(404, { message: 'no such fake endpoint' });
      });
    });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${server.address().port}`;

    let n = 0;
    const api = {
      port: PORT, base,
      newDb() {
        const name = `run${++n}`;
        const x = psql('postgres', ['-c', `create database ${name} template tpl`]);
        if (x.status !== 0) throw new Error('create database failed: ' + x.stderr);
        return name;
      },
      /** the environment a function (and its tests) reads, by name; the values are the fakes of this run */
      env(db) {
        return {
          SUPABASE_DB_URL: 'postgres://postgres@127.0.0.1:1/no-direct-connection', DB_POOLER_URL: `postgres://postgres@127.0.0.1:${PORT}/${db}`,
          SUPABASE_URL: base, JWKS_URL: `${base}/auth/v1/.well-known/jwks.json`,
          SUPABASE_SECRET_KEY: SECRET, SUPABASE_SERVICE_ROLE_KEY: SECRET, RUNNER_KEY, CRON_KEY, GITHUB_DISPATCH_TOKEN: SECRET, GITHUB_DISPATCH_TOKEN_V2: V2_TOKEN, GITHUB_REPO: 'test/test', GITHUB_API_BASE: base,
          TEST_JWK_PRIVATE: JSON.stringify(priv), TEST_FAKE_BASE: base, TEST_DB_URL: `postgres://postgres@127.0.0.1:${PORT}/${db}`,
          DASHBOARD_ORIGINS: 'http://localhost:5173,http://localhost:5174,https://app.test-origin.example', NO_COLOR: '1',
        };
      },
      async stop() { await new Promise(ok => server.close(ok)); server.closeAllConnections?.(); stopDb(); },
    };
    return api;
  } catch (e) {
    if (server) server.close();
    stopDb();
    throw e;
  }
}

/** Run `deno test` on a folder with the environment of a fresh database; resolves { status, out, passed, failed }.
 *  Asynchronous on purpose: the fake JWKS / Storage / GitHub server lives in THIS process and must keep answering while deno runs
 *  (a synchronous spawn froze it: every JWKS fetch timed out, found on the first run). */
export function denoTest(api, testDir, { noCheck = false, cwd = REPO } = {}) {
  const db = api.newDb();
  const args = ['test', '-A', ...(noCheck ? ['--no-check'] : []), ...(process.env.FN_TEST_FILTER ? ['--filter', process.env.FN_TEST_FILTER] : []), testDir];
  return new Promise(ok => {
    const child = spawn('deno', args, { cwd, env: { ...process.env, ...api.env(db) }, windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { out += '\n[harness] deno test timed out after 10 minutes, killed'; child.kill(); }, 600000);
    child.on('close', status => {
      clearTimeout(timer);
      const m = /(\d+) passed(?: \((\d+) steps\))? \| (\d+) failed/.exec(out);
      ok({ status, out, passed: m ? Number(m[1]) : null, failed: m ? Number(m[3]) : null });
    });
  });
}
