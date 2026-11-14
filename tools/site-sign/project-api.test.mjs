// Tests for project-api.mjs: the usage rules, the token and secret checks, the three Pages project calls, the account lookup, and that no
// token, secret value or account id is ever printed. The network is the seam `fetch`, a fake here: no test touches the network, no real
// token is read, and every case hands its own env object.
// usage: node --max-old-space-size=256 project-api.test.mjs
//        node --max-old-space-size=256 project-api.test.mjs --mutants  (copies the tool, breaks it 13 ways, expects this test to go red each time)
// PROJECT_API_TOOL=<path> tests another copy of the tool; the mutants use it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = process.env.PROJECT_API_TOOL || path.join(HERE, 'project-api.mjs');
let tool = {};
try { tool = await import(pathToFileURL(TOOL).href); } catch (e) { console.log(`  NOTE the tool did not load: ${String(e && e.message).split('\n')[0]}`); }

let passed = 0, failed = 0;
async function kase(n, name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${n} ${name}: ${String((e && e.message) || e).split('\n')[0].slice(0, 300)}`); }
}

const ACCT = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';
const TOKEN = crypto.randomBytes(24).toString('hex');
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/pages/projects`;
const LOOKUP = 'https://api.cloudflare.com/client/v4/accounts';
const USAGE = 'usage: project-api.mjs create|get <project> | secrets <project> --names A,B';
const DELETE = "delete is not wrapped: it is irreversible and the head's own step";
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCT };
const ENV_NOACCT = { CLOUDFLARE_API_TOKEN: TOKEN };
const VALS = { NAME_A: 'value-aaaaaaaa', NAME_B: 'value-bbbbbbbb', NAME_C: 'short' };

// one run: `replies` are consumed in order; a reply is { status, body } (body an object, or a string sent as is) or { throws: <message> }
async function go(argv, env, replies = []) {
  if (typeof tool.projectApi !== 'function') throw new Error('project-api.mjs exports no projectApi()');
  const calls = [], out = [], err = [];
  const fetch = async (url, init = {}) => {
    calls.push({ method: init.method, url, headers: init.headers || {}, body: init.body, signal: init.signal });
    const r = replies[calls.length - 1];
    if (!r) throw new Error('no reply was made for this call');
    if (r.throws) throw new Error(r.throws);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { status: r.status, text: async () => text };
  };
  const code = await tool.projectApi(argv, { env, fetch, out: (s) => out.push(String(s)), err: (s) => err.push(String(s)) });
  return { code, calls, out, err, all: [...out, ...err].join('\n') };
}
const good = (result) => ({ status: 200, body: { success: true, errors: [], result } });
const SITE = { subdomain: 'demo-site.pages.dev', production_branch: 'main' };
const hasBearer = (c) => c.headers.authorization === `Bearer ${TOKEN}`;

// P1
await kase('P1', 'usage: 13 bad lines are exit 2 with one usage line (or the delete sentence), and nothing is sent', async () => {
  const tries = [
    [[], USAGE], [['delete', 'demo-site'], DELETE], [['get'], USAGE],
    [['get', 'Ab'], USAGE], [['get', 'a'], USAGE], [['get', 'x'.repeat(59)], USAGE], [['get', '../x'], USAGE],
    [['secrets', 'demo-site'], USAGE], [['get', 'demo-site', '--names', 'NAME_A'], USAGE],
    [['secrets', 'demo-site', '--names', 'a'], USAGE], [['secrets', 'demo-site', '--names', 'A,,B'], USAGE],
    [['secrets', 'demo-site', '--names', 'NAME_A,NAME_A'], USAGE], [['secrets', 'demo-site', '--names', 'A=x'], USAGE],
  ];
  assert.equal(tries.length, 13);
  for (const [argv, line] of tries) {
    const r = await go(argv, { ...ENV, ...VALS });
    assert.equal(r.code, 2, `${argv.join(' ')}: exit ${r.code}: ${r.all.slice(0, 200)}`);
    assert.deepStrictEqual(r.err, [line], `${argv.join(' ')}: stderr is ${r.err.join('|').slice(0, 200)}`);
    assert.equal(r.out.length, 0, `${argv.join(' ')}: stdout is not empty`);
    assert.equal(r.calls.length, 0, `${argv.join(' ')}: fetch was called`);
  }
});
// P2
await kase('P2', 'without CLOUDFLARE_API_TOKEN: exit 1, one line, nothing sent', async () => {
  const r = await go(['get', 'demo-site'], { CLOUDFLARE_ACCOUNT_ID: ACCT });
  assert.equal(r.code, 1);
  assert.deepStrictEqual(r.err, ['CLOUDFLARE_API_TOKEN is not set']);
  assert.equal(r.calls.length, 0, 'fetch was called');
});
// P3
await kase('P3', 'create: one POST to the account\'s projects with the bearer header, the exact body and a signal', async () => {
  const r = await go(['create', 'demo-site'], ENV, [good(SITE)]);
  assert.equal(r.code, 0, `exit ${r.code}: ${r.all.slice(0, 200)}`);
  assert.equal(r.calls.length, 1);
  const c = r.calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url, BASE);
  assert.ok(hasBearer(c), 'no bearer header with the token');
  assert.equal(c.body, '{"name":"demo-site","production_branch":"main"}');
  assert.ok(c.signal && typeof c.signal.aborted === 'boolean', 'no abort signal');
  assert.deepStrictEqual(r.out, ['create demo-site: HTTP 200, success true, address demo-site.pages.dev, production branch main']);
  assert.equal(r.err.length, 0);
});
// P4
await kase('P4', 'get: one GET; a refusal, a non-JSON answer and a throw are exit 1 and never a stack', async () => {
  const a = await go(['get', 'demo-site'], ENV, [good(SITE)]);
  assert.equal(a.code, 0);
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].method, 'GET');
  assert.equal(a.calls[0].url, `${BASE}/demo-site`);
  assert.equal(a.calls[0].body, undefined);
  assert.ok(hasBearer(a.calls[0]) && a.calls[0].signal, 'no bearer header or no signal');
  const nf = await go(['get', 'demo-site'], ENV, [{ status: 404, body: { success: false, errors: [{ code: 8000007, message: 'Project not found' }], result: null } }]);
  assert.equal(nf.code, 1);
  assert.ok(nf.all.includes('HTTP 404') && nf.all.includes('8000007') && nf.all.includes('Project not found'), `404 line: ${nf.all}`);
  const au = await go(['get', 'demo-site'], ENV, [{ status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null } }]);
  assert.equal(au.code, 1);
  assert.ok(au.all.includes('HTTP 403') && au.all.includes('10000') && au.all.includes('Authentication error'), `403 line: ${au.all}`);
  const nj = await go(['get', 'demo-site'], ENV, [{ status: 500, body: '<html>Internal error</html>' }]);
  assert.equal(nj.code, 1);
  assert.ok(nj.all.includes('HTTP 500') && nj.all.includes('success false'), `500 line: ${nj.all}`);
  const th = await go(['get', 'demo-site'], ENV, [{ throws: 'fetch failed' }]);
  assert.equal(th.code, 1);
  assert.deepStrictEqual(th.err, ['get demo-site: no answer from the provider (fetch failed)']);
  assert.equal(th.out.length, 0);
});
// P5
await kase('P5', 'secrets: one PATCH holding every value for production and preview; all or none; no value, no token printed', async () => {
  const names = ['NAME_A', 'NAME_B'];
  const E = { env_vars: Object.fromEntries(names.map((n) => [n, { type: 'secret_text', value: VALS[n] }])) };
  const answer = good({ ...SITE, deployment_configs: { production: { env_vars: { NAME_A: { type: 'secret_text' }, NAME_B: { type: 'secret_text' } } }, preview: { env_vars: { NAME_A: { type: 'secret_text' }, NAME_B: { type: 'secret_text' } } } } });
  const r = await go(['secrets', 'demo-site', '--names', 'NAME_A,NAME_B'], { ...ENV, ...VALS }, [answer]);
  assert.equal(r.code, 0, `exit ${r.code}: ${r.all.slice(0, 200)}`);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, 'PATCH');
  assert.equal(r.calls[0].url, `${BASE}/demo-site`);
  assert.equal(r.calls[0].body, JSON.stringify({ deployment_configs: { production: E, preview: E } }));
  assert.ok(r.out.length === 1 && r.out[0].includes('NAME_A (secret_text), NAME_B (secret_text)'), `output: ${r.out.join('|')}`);
  assert.ok(/now production: NAME_A \(secret_text\), NAME_B \(secret_text\); preview: NAME_A \(secret_text\), NAME_B \(secret_text\)/.test(r.out[0]), `output: ${r.out[0]}`);
  for (const s of [TOKEN, VALS.NAME_A, VALS.NAME_B]) assert.ok(!r.all.includes(s), 'a token or a value was printed');
  // a secret that is unset or short stops everything before any call, the account lookup included
  const c = await go(['secrets', 'demo-site', '--names', 'NAME_A,NAME_C'], { ...ENV, ...VALS });
  assert.equal(c.code, 1);
  assert.deepStrictEqual(c.err, ['REFUSED: NAME_C is not set in the environment or is shorter than 8 characters; nothing sent']);
  assert.equal(c.calls.length, 0, 'fetch was called for a short value');
  const d = await go(['secrets', 'demo-site', '--names', 'NAME_A,NAME_D'], { ...ENV_NOACCT, ...VALS });
  assert.equal(d.code, 1);
  assert.deepStrictEqual(d.err, ['REFUSED: NAME_D is not set in the environment or is shorter than 8 characters; nothing sent']);
  assert.equal(d.calls.length, 0, 'fetch was called (the lookup included) for an unset value');
  // a reply that echoes the values and the token
  const e = await go(['secrets', 'demo-site', '--names', 'NAME_A,NAME_B'], { ...ENV, ...VALS }, [{ status: 400, body: { success: false, errors: [{ code: 1, message: `bad ${TOKEN} ${VALS.NAME_A} ${VALS.NAME_B}` }], result: null } }]);
  assert.equal(e.code, 1);
  for (const s of [TOKEN, VALS.NAME_A, VALS.NAME_B]) assert.ok(!e.all.includes(s), 'an echoed token or value was printed');
  assert.ok(e.all.includes('[hidden]'), 'the cut is not marked');
});
// P6
await kase('P6', 'the account set by name: no lookup, the calls are exactly the verb\'s', async () => {
  for (const [argv, method, url] of [[['get', 'demo-site'], 'GET', `${BASE}/demo-site`], [['create', 'demo-site'], 'POST', BASE]]) {
    const r = await go(argv, ENV, [good(SITE)]);
    assert.equal(r.code, 0);
    assert.deepStrictEqual(r.calls.map((c) => [c.method, c.url]), [[method, url]]);
  }
});
// P7
await kase('P7', 'the account unset and one account seen: the lookup, then the verb\'s call with that account in its url', async () => {
  const r = await go(['get', 'demo-site'], ENV_NOACCT, [good([{ id: ACCT }]), good(SITE)]);
  assert.equal(r.code, 0, `exit ${r.code}: ${r.all.slice(0, 200)}`);
  assert.deepStrictEqual(r.calls.map((c) => [c.method, c.url]), [['GET', LOOKUP], ['GET', `${BASE}/demo-site`]]);
  assert.ok(r.calls.every(hasBearer), 'a call has no bearer header');
  assert.ok(r.calls.every((c) => c.signal), 'a call has no signal');
});
// P8
await kase('P8', 'the account unset and none or two seen: exit 1, the one line, no verb call, no id printed', async () => {
  for (const [list, n] of [[[], 0], [[{ id: ACCT }, { id: OTHER }], 2]]) {
    const r = await go(['get', 'demo-site'], ENV_NOACCT, [good(list)]);
    assert.equal(r.code, 1);
    assert.deepStrictEqual(r.err, [`CLOUDFLARE_ACCOUNT_ID is not set and the token sees ${n} accounts; set it by name`]);
    assert.equal(r.calls.length, 1, `${n} accounts: a verb call was made`);
    assert.ok(!r.all.includes(ACCT) && !r.all.includes(OTHER), `${n} accounts: an id was printed`);
  }
});
// P9
await kase('P9', 'the lookup refused with 403: exit 1, the line holds HTTP 403 and the provider\'s words, no verb call', async () => {
  const r = await go(['get', 'demo-site'], ENV_NOACCT, [{ status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null } }]);
  assert.equal(r.code, 1);
  assert.equal(r.calls.length, 1, 'a verb call was made after a refused lookup');
  assert.ok(r.err.length === 1 && r.err[0].includes('HTTP 403') && r.err[0].includes('Authentication error'), `line: ${r.err.join('|')}`);
});
// P10
await kase('P10', 'the lookup throws: exit 1, one no-answer line', async () => {
  const r = await go(['get', 'demo-site'], ENV_NOACCT, [{ throws: 'fetch failed' }]);
  assert.equal(r.code, 1);
  assert.deepStrictEqual(r.err, ['get demo-site: no answer from the provider (fetch failed)']);
  assert.equal(r.calls.length, 1);
});
// P11
await kase('P11', 'a reply that echoes the account id: nothing printed holds it, set by name or taken from the lookup', async () => {
  const echo = { status: 400, body: { success: false, errors: [{ code: 1, message: `project of account ${ACCT}` }], result: null } };
  const a = await go(['get', 'demo-site'], ENV, [echo]);
  assert.equal(a.code, 1);
  assert.ok(!a.all.includes(ACCT), 'the account id set by name was printed');
  const b = await go(['get', 'demo-site'], ENV_NOACCT, [good([{ id: ACCT }]), echo]);
  assert.equal(b.code, 1);
  assert.ok(b.all.includes('HTTP 400') && !b.all.includes(ACCT), 'the account id from the lookup was printed');
});

console.log(`project-api tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

if (process.argv.includes('--mutants')) {
  const MUT = [
    ['Fp1 the bearer header is not sent', 'authorization: `Bearer ${token}`, ', "'x-none': '', "],
    ['Fp2 create sets another production branch', "production_branch: 'main'", "production_branch: 'x'"],
    ['Fp3 delete is a verb', "['create', 'get', 'secrets']", "['create', 'get', 'secrets', 'delete']"],
    ['Fp4 preview gets no secrets', 'preview: E', 'preview: {}'],
    ['Fp5 a short secret does not stop the run', 'if (short.length) {', 'if (false) {'],
    ['Fp6 the answer line is not scrubbed', 'out(scrub(line));', 'out(line);'],
    ['Fp7 a refusal exits 0', 'return j?.success === true ? 0 : 1;', 'return 0;'],
    ['Fp8 a throw is not caught', 'catch (e) { err(', 'catch (e) { throw e; err('],
    ['Fp9 any secret name is accepted', '/^[A-Z][A-Z0-9_]{2,60}$/.test(n)', 'true'],
    ['Fp10 any number of accounts is accepted', 'if (accounts.length !== 1) {', 'if (false) {'],
    ['Fp11 the lookup runs although the account is set', 'if (!env.CLOUDFLARE_ACCOUNT_ID) {', 'if (true) {'],
    ['Fp12 the account id is not scrubbed', 'hide.push(account);', 'void 0;'],
    ['Fp13 a refused lookup is not read', 'if (!lk.ok) {', 'if (false) {'],
  ];
  let caught = 0;
  const src = fs.readFileSync(path.join(HERE, 'project-api.mjs'), 'utf8');
  for (const [name, from, to] of MUT) {
    if (src.split(from).length !== 2) { console.log(`MUTANT TARGET NOT FOUND once: ${name}`); process.exitCode = 1; continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-api-mut-'));
    fs.writeFileSync(path.join(dir, 'project-api.mjs'), src.split(from).join(to));
    const res = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 300000, env: { ...process.env, PROJECT_API_TOOL: path.join(dir, 'project-api.mjs') } });
    const red = res.status !== 0;
    if (red) caught++;
    console.log(`mutant "${name}": ${red ? 'caught' : 'MISSED'} (${(res.stdout.trim().split('\n').pop() || '').trim()})`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`mutants: ${caught}/${MUT.length} caught`);
  if (caught !== MUT.length) process.exitCode = 1;
}
