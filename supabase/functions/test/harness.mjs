// The throwaway world the Edge Function tests run in (slice 4.2): a Postgres cluster built the way supabase/tests/run-local.mjs builds
// one (local-shim.sql + every migration in file order), seeded with the CLI's own fixtures (tools/omnikom-cli/commands/seed.mjs
// seedTestSql, imported read-only), plus a tiny HTTP server that plays the three outside services the functions call:
//   GET  /auth/v1/.well-known/jwks.json                       the project's JWKS (an ES256 public key generated for this run)
//   POST /storage/v1/object/upload/sign/media/<path>          Storage's signed-upload endpoint (answers { url, token }; needs the secret key)
//   POST /storage/v1/object/sign/media/<path>                 Storage's signed-download endpoint (slice 4.3; answers { signedURL }; records the path, the
//                                                             expiresIn asked for and how many calls ran at once; can be told to fail for a path or to be slow)
//   POST /repos/test/test/dispatches                          GitHub repository_dispatch (records what it got; answers the status you set)
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

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 240000, ...opts });
export const SECRET = 'test-not-a-secret';
export const RUNNER_KEY = 'test-runner-key-not-a-secret';

export async function startHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-fn-'));
  const data = join(dir, 'data');
  const PORT = String(55000 + Math.floor(Math.random() * 900));
  let r = run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.error));
  r = run('pg_ctl', ['-D', data, '-o', `-p ${PORT} -k ""`, '-l', join(dir, 'pg.log'), '-w', 'start']);
  if (r.status !== 0) throw new Error('pg_ctl start failed: ' + r.stderr + readFileSync(join(dir, 'pg.log'), 'utf8'));
  const psql = (db, args) => run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', ...args]);
  const stopDb = () => { run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']); rmSync(dir, { recursive: true, force: true }); };
  let server = null;
  try {
    // the template database: shim, every migration in order, the CLI's fixtures
    psql('postgres', ['-c', 'create database tpl']);
    const migDir = join(REPO, 'supabase', 'migrations');
    const files = [join(REPO, 'supabase', 'tests', 'local-shim.sql'), ...readdirSync(migDir).filter(f => f.endsWith('.sql')).sort().map(f => join(migDir, f))];
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

    const state = { github: [], storage: [], githubStatus: 204, signed: [], signFail: '', signDelayMs: 0, inflight: 0, maxInflight: 0 };
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
        if (req.method === 'POST' && u.pathname === '/repos/test/test/dispatches') {
          let parsed = null; try { parsed = JSON.parse(body); } catch { /* recorded as null */ }
          state.github.push({ authorized: req.headers.authorization === `Bearer ${SECRET}`, accept: req.headers.accept, body: parsed });
          return state.githubStatus === 204 ? (res.writeHead(204), res.end()) : send(state.githubStatus, { message: 'refused' });
        }
        if (u.pathname === '/__recorded') return send(200, state);
        if (u.pathname === '/__reset') { state.github = []; state.storage = []; state.githubStatus = 204; state.signed = []; state.signFail = ''; state.signDelayMs = 0; state.inflight = 0; state.maxInflight = 0; return send(200, {}); }
        if (u.pathname === '/__sign') { state.signFail = u.searchParams.get('fail') ?? ''; state.signDelayMs = Number(u.searchParams.get('delay') ?? 0); return send(200, {}); }
        if (u.pathname === '/__github-status') { state.githubStatus = Number(u.searchParams.get('code')); return send(200, {}); }
        send(404, { message: 'no such fake endpoint' });
      });
    });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${server.address().port}`;

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
          SUPABASE_DB_URL: `postgres://postgres@127.0.0.1:${PORT}/${db}`,
          SUPABASE_URL: base, JWKS_URL: `${base}/auth/v1/.well-known/jwks.json`,
          SUPABASE_SECRET_KEY: SECRET, SUPABASE_SERVICE_ROLE_KEY: SECRET, RUNNER_KEY, GITHUB_DISPATCH_TOKEN: SECRET, GITHUB_REPO: 'test/test', GITHUB_API_BASE: base,
          TEST_JWK_PRIVATE: JSON.stringify(priv), TEST_FAKE_BASE: base, TEST_DB_URL: `postgres://postgres@127.0.0.1:${PORT}/${db}`,
          NO_COLOR: '1',
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
