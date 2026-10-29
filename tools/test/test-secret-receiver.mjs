// Proof for tools/secret-receiver.mjs: starts it on a spare port with a scratch file, posts good and bad values, checks the
// file by NAME and length only, then stops it. Run: node tools/test/test-secret-receiver.mjs
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const file = join(mkdtempSync(join(tmpdir(), 'secret-receiver-')), 'test.env');
const port = 47999, token = 'testtoken';
const child = spawn(process.execPath, [process.env.RECEIVER_UNDER_TEST || join(HERE, '..', 'secret-receiver.mjs'), '--file', file, '--port', String(port), '--token', token], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
const t = ms => AbortSignal.timeout(ms);
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + detail}`); if (!ok) failed++; };
const post = (path, body, origin = 'https://supabase.com') => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body), signal: t(5000) }).then(async r => ({ status: r.status, json: await r.json(), h: r.headers }));

try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { await new Promise(r => setTimeout(r, 100)); up = await fetch(`http://127.0.0.1:${port}/ping`, { signal: t(1000) }).then(r => r.ok).catch(() => false); }
  check('receiver answers /ping', up);
  const pre = await fetch(`http://127.0.0.1:${port}/bank`, { method: 'OPTIONS', headers: { origin: 'https://supabase.com', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' }, signal: t(5000) });
  check('preflight answers 204 with CORS and private-network headers', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://supabase.com' && pre.headers.get('access-control-allow-private-network') === 'true');
  const good = 'sb_secret_' + 'a'.repeat(30);
  let r = await post('/bank', { token, name: 'TEST_KEY', value: good, prefix: 'sb_secret_' });
  check('a good value is saved', r.status === 200 && r.json.ok && r.json.length === good.length, JSON.stringify(r.json));
  check('the reply carries no value', !JSON.stringify(r.json).includes(good));
  let text = readFileSync(file, 'utf8');
  check('the file holds NAME=value once', text.split('\n').filter(l => l.startsWith('TEST_KEY=')).length === 1 && text.includes(`TEST_KEY=${good}`));
  r = await post('/bank', { token, name: 'TEST_KEY', value: good + 'b', prefix: 'sb_secret_' });
  text = readFileSync(file, 'utf8');
  check('a repeated NAME replaces the line', r.status === 200 && text.split('\n').filter(l => l.startsWith('TEST_KEY=')).length === 1 && text.includes(`TEST_KEY=${good}b`));
  r = await post('/bank', { token: 'wrong', name: 'OTHER', value: good });
  check('a wrong token is refused (403)', r.status === 403 && !readFileSync(file, 'utf8').includes('OTHER='));
  r = await post('/bank', { token, name: 'short', value: good });
  check('a lower-case name is refused', r.status === 422);
  r = await post('/bank', { token, name: 'SHORT', value: 'abc' });
  check('a short value is refused', r.status === 422 && !readFileSync(file, 'utf8').includes('SHORT='));
  r = await post('/bank', { token, name: 'SPACED', value: 'abc def ' + 'x'.repeat(20) });
  check('a value with whitespace is refused', r.status === 422);
  r = await post('/bank', { token, name: 'PREFIXED', value: 'x'.repeat(30), prefix: 'sb_' });
  check('a wrong prefix is refused', r.status === 422);
  r = await post('/stop', { token });
  check('stop answers ok', r.status === 200 && r.json.stopping === true);
  await new Promise(r => setTimeout(r, 300));
  check('stdout never shows the value', !out.includes(good));
  check('stdout names the saved key with its length', /saved TEST_KEY \(4[01] chars\)/.test(out));
} catch (e) { check('run', false, e.message); }
try { child.kill(); } catch {}
console.log(failed ? `FAIL ${failed}` : 'PASS secret-receiver');
process.exitCode = failed ? 1 : 0;
