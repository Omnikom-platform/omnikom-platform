// Tests for the site lead endpoint (factory/worker/lead-endpoint.mjs). No framework; exit 1 on any failure.
//   node factory/worker/test/run.mjs
// The platform is a fake fetch that records the request; the signature it receives is checked with the platform's own
// verify() (supabase/functions/_shared/signature.ts, loaded by Node's type stripping), so the two implementations are proven
// to agree on the canonical form.
import assert from 'node:assert/strict';
import { makeLeadHandler, sign } from '../lead-endpoint.mjs';
import { verify } from '../../../supabase/functions/_shared/signature.ts';

let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}  ${String(e.message || e).split('\n')[0].slice(0, 160)}`); } };

const SITE = '11111111-2222-4333-8444-555555555555', KEY = 'test-signing-key-not-a-secret', BASE = 'https://example.test/functions/v1'; // gitleaks:allow (a fake key for the tests)
const NOW = 1_800_000_000;
const lead = { form: 'contact', page: '/', name: 'Lead A', email: 'a@example.test', consentText: 'I agree', hp: '', idempotencyKey: '7c3f1d2a-1b2c-4d3e-8f90-1234567890ab' };
const post = (obj, init = {}) => new Request('https://site.test/api/lead', { method: 'POST', body: typeof obj === 'string' ? obj : JSON.stringify(obj), ...init });

// a fake platform: answers with a given status and records what it got
function platform(status, bodyOut = { ok: true }) {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify(bodyOut), { status, headers: { 'content-type': 'application/json' } }); };
  return { seen, fetchImpl };
}
const handler = (p, extra = {}) => makeLeadHandler({ siteId: SITE, signingKey: KEY, platformBase: BASE, fetchImpl: p.fetchImpl, now: () => NOW, ...extra });

await check('a good lead is forwarded, signed, and answered sent', async () => {
  const p = platform(202);
  const r = await handler(p)(post(lead));
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { sent: true });
  assert.equal(p.seen.length, 1);
  assert.equal(p.seen[0].url, `${BASE}/capture-lead?site=${SITE}`);
  const sig = p.seen[0].init.headers['x-site-signature'];
  assert.ok(await verify(sig, KEY, 'POST', `/capture-lead?site=${SITE}`, p.seen[0].init.body, NOW), 'the platform verifies the signature');
  assert.equal(p.seen[0].init.body, JSON.stringify(lead), 'the body is forwarded byte for byte');
});
await check('the signature covers the site: it fails for another site id', async () => {
  const p = platform(202); await handler(p)(post(lead));
  const sig = p.seen[0].init.headers['x-site-signature'];
  assert.equal(await verify(sig, KEY, 'POST', '/capture-lead?site=22222222-2222-4333-8444-555555555555', p.seen[0].init.body, NOW), false);
});
await check('the signature covers the body: a changed body fails', async () => {
  const p = platform(202); await handler(p)(post(lead));
  const sig = p.seen[0].init.headers['x-site-signature'];
  assert.equal(await verify(sig, KEY, 'POST', `/capture-lead?site=${SITE}`, p.seen[0].init.body + ' ', NOW), false);
});
await check('the signature expires after 300 s', async () => {
  const p = platform(202); await handler(p)(post(lead));
  const sig = p.seen[0].init.headers['x-site-signature'];
  assert.equal(await verify(sig, KEY, 'POST', `/capture-lead?site=${SITE}`, p.seen[0].init.body, NOW + 301), false);
  assert.equal(await verify(sig, KEY, 'POST', `/capture-lead?site=${SITE}`, p.seen[0].init.body, NOW + 299), true);
});
await check('sign() canonical form matches the platform (method upper-cased)', async () => {
  const a = await sign(KEY, 'post', '/x?y=1', '{}', NOW), b = await sign(KEY, 'POST', '/x?y=1', '{}', NOW);
  assert.equal(a, b); assert.ok(await verify(a, KEY, 'POST', '/x?y=1', '{}', NOW));
});
await check('GET is refused with 405 and nothing is forwarded', async () => {
  const p = platform(202);
  const r = await handler(p)(new Request('https://site.test/api/lead', { method: 'GET' }));
  assert.equal(r.status, 405); assert.equal(p.seen.length, 0);
});
await check('a filled honeypot is refused with 400 and nothing is forwarded', async () => {
  const p = platform(202);
  const r = await handler(p)(post({ ...lead, hp: 'http://spam' }));
  assert.equal(r.status, 400); const j = await r.json(); assert.equal(j.sent, false); assert.equal(j.problems[0].code, 'HP'); assert.equal(p.seen.length, 0);
});
await check('a body over the cap is refused with 413 and nothing is forwarded', async () => {
  const p = platform(202);
  const r = await handler(p)(post({ ...lead, answers: { message: 'x'.repeat(20000) } }));
  assert.equal(r.status, 413); assert.equal(p.seen.length, 0);
});
await check('not JSON is refused with 400', async () => {
  const p = platform(202);
  const r = await handler(p)(post('name=Lead'));
  assert.equal(r.status, 400); assert.equal(p.seen.length, 0);
});
await check('a 400 from the platform passes its field problems through, never "sent"', async () => {
  const p = platform(400, { status: 400, problems: [{ code: 'REQUIRED', path: 'consentText', msg: 'This is needed.' }] });
  const r = await handler(p)(post({ ...lead, consentText: '' }));
  assert.equal(r.status, 400); const j = await r.json(); assert.equal(j.sent, false); assert.equal(j.problems[0].path, 'consentText');
});
await check('a 429 from the platform says try again in a minute', async () => {
  const r = await handler(platform(429, {}))(post(lead));
  assert.equal(r.status, 429); const j = await r.json(); assert.equal(j.retry, true); assert.match(j.msg, /minute/);
});
await check('a 409 from the platform (site paused or workspace suspended) says call us, no retry, and is logged', async () => {
  const logged = []; const r = await handler(platform(409, { status: 409, problems: [{ code: 'S-SITE-PAUSED', path: '', msg: 'x' }] }), { log: m => logged.push(m) })(post(lead));
  assert.equal(r.status, 409); const j = await r.json(); assert.equal(j.sent, false); assert.equal(j.retry, false); assert.match(j.msg, /call/i); assert.equal(logged.length, 1);
});
await check('a 401 from the platform (key or clock) says call us, no retry, and is logged', async () => {
  const logged = []; const r = await handler(platform(401, {}), { log: m => logged.push(m) })(post(lead));
  assert.equal(r.status, 502); const j = await r.json(); assert.equal(j.sent, false); assert.equal(j.retry, false); assert.match(j.msg, /call/i); assert.equal(logged.length, 1);
});
await check('a 500 from the platform keeps the answers and asks to try again', async () => {
  const r = await handler(platform(500, {}))(post(lead));
  assert.equal(r.status, 502); const j = await r.json(); assert.equal(j.sent, false); assert.equal(j.retry, true);
});
await check('an unreachable platform keeps the answers and asks to try again', async () => {
  const r = await makeLeadHandler({ siteId: SITE, signingKey: KEY, platformBase: BASE, fetchImpl: async () => { throw new Error('ECONNRESET'); } })(post(lead));
  assert.equal(r.status, 502); const j = await r.json(); assert.equal(j.retry, true);
});
await check('a missing key or site id answers 503 and forwards nothing', async () => {
  const p = platform(202);
  const r = await makeLeadHandler({ siteId: SITE, signingKey: '', platformBase: BASE, fetchImpl: p.fetchImpl })(post(lead));
  assert.equal(r.status, 503); assert.equal(p.seen.length, 0);
});
await check('every answer carries noindex and no-store', async () => {
  for (const r of [await handler(platform(202))(post(lead)), await handler(platform(202))(post({ ...lead, hp: 'x' }))]) {
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});
await check('only a 202 becomes sent: a 200 from the platform does not', async () => {
  const r = await handler(platform(200))(post(lead));
  const j = await r.json(); assert.equal(j.sent, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
