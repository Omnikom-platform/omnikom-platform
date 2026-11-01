// crm-test (slice 5.2): ONE signed POST to the stored CRM address. The outside world is faked: the host resolves through an injected resolver, and the
// request goes to a fake webhook server of the harness that records what it received (the function's own fetch options run unchanged).
import { makeHandle, TEST_BODY } from '../crm-test/index.ts';
import { verify } from '../_shared/signature.ts';
import { assert, call, crmSecret, eq, fake, hooks, securityEvents, SUB, t, toFakeHook, WS_A, WS_B } from './util.ts';
import { answers, auditRows, connectCrm, counting, nowhere, publicHost } from './screens-util.ts';

const run = (who: Parameters<typeof call>[3], body: Record<string, unknown>, deps: Parameters<typeof makeHandle>[0] = {}) =>
  call(makeHandle({ resolve: publicHost, fetchImpl: toFakeHook, ...deps }), 'crm-test', body, who);
const URL_A = 'https://hooks.example.com/crm/abc?x=1';

t('crm-test: one signed POST with the fixed body; the signature verifies with the stored secret over the address\' path and query; the answer says so in plain terms', async () => {
  await connectCrm(URL_A);
  await fake.reset();
  await hooks.answer(200);
  const before = (await auditRows('crm-test', WS_A)).length;
  const r = await run('owner-a', { workspace: WS_A });
  eq(r.status, 200, 'status: ' + r.text); eq(r.json?.ok, true, 'ok'); eq(r.json?.status, 200, 'status of the CRM'); assert(typeof r.json?.ms === 'number' && (r.json?.ms as number) >= 0, 'ms');
  const got = await hooks.recorded();
  eq(got.hooks.length, 1, 'exactly one request reached the CRM');
  const h = got.hooks[0];
  eq(h.path, '/crm/abc?x=1', 'the path and query of the stored address'); eq(h.contentType, 'application/json', 'content type');
  eq(h.body, TEST_BODY, 'the fixed body');
  eq(JSON.stringify(JSON.parse(h.body)), '{"test":true,"lead":{"name":"Test Lead","email":"test@example.com"}}', 'which is the synthetic lead and nothing else');
  const secret = await crmSecret(WS_A);
  assert(secret, 'a secret is stored');
  eq(await verify(h.signature, secret, 'POST', '/crm/abc?x=1', h.body), true, 'the X-Omnikom-Signature verifies the way a site\'s signature does (t=...,v1=...)');
  eq(await verify(h.signature, 'a-different-secret', 'POST', '/crm/abc?x=1', h.body), false, 'and only with this secret');
  eq(await verify(h.signature, secret, 'POST', '/crm/other', h.body), false, 'and only for this path');
  assert(/^t=\d+,v1=[0-9a-f]{64}$/.test(h.signature ?? ''), 'the shape: ' + h.signature);
  assert(!r.text.includes(secret) && !r.text.includes('Test Lead'), 'the answer holds neither the secret nor the body');
  const rows = await auditRows('crm-test', WS_A);
  eq(rows.length, before + 1, 'one audit row');
  eq(JSON.stringify(rows[rows.length - 1]), JSON.stringify({ host: 'hooks.example.com', status: 200, outcome: 'sent' }), 'it holds the outcome, the status and the host only');
  assert(!JSON.stringify(rows).includes(secret) && !JSON.stringify(rows).includes('x=1') && !JSON.stringify(rows).includes('/crm/'), 'never the secret, the path or the query');
});

t('crm-test: a redirect is reported and never followed; the CRM\'s answer body is never returned; a refusing CRM is ok: false with its status', async () => {
  await connectCrm(URL_A);
  await fake.reset();
  await hooks.answer(302, { mode: 'redirect' });
  const r = await run('owner-a', { workspace: WS_A });
  eq(r.status, 200, 'status: ' + r.text); eq(r.json?.ok, false, 'a redirect is not ok'); eq(r.json?.status, 302, 'its status is reported');
  assert(/redirect/i.test(String(r.json?.reason)), 'in plain words: ' + r.json?.reason);
  const got = await hooks.recorded();
  eq(got.redirected, 0, 'the redirect target was never contacted'); eq(got.hooks.length, 1, 'one request only');
  await hooks.answer(500);
  const e = await run('owner-a', { workspace: WS_A });
  eq(e.json?.ok, false, 'ok'); eq(e.json?.status, 500, 'status'); assert(/500/.test(String(e.json?.reason)), 'reason names the status: ' + e.json?.reason);
  assert(!e.text.includes('THE-BODY-MUST-NEVER-BE-RETURNED'), 'the CRM\'s body is not returned');
  await hooks.answer(204);
  const ok = await run('owner-a', { workspace: WS_A });
  eq(ok.json?.ok, true, '204 is ok'); eq(ok.json?.status, 204, 'status 204');
});

t('crm-test: nothing answering (a failed connection, a timeout) is ok: false with no status and a plain reason; each is audited as failed', async () => {
  await connectCrm(URL_A);
  const seen: RequestInit[] = [];
  const down = await run('owner-a', { workspace: WS_A }, { fetchImpl: (_u, init) => { seen.push(init ?? {}); return Promise.reject(new TypeError('connection refused')); } });
  eq(down.status, 200, 'status: ' + down.text); eq(down.json?.ok, false, 'ok'); eq(down.json?.status, null, 'no status'); eq(down.json?.reason, 'Could not reach the CRM.', 'reason');
  const slow = await run('owner-a', { workspace: WS_A }, { fetchImpl: (_u, init) => { seen.push(init ?? {}); return Promise.reject(new DOMException('timed out', 'TimeoutError')); } });
  assert(/10 seconds/.test(String(slow.json?.reason)), 'a timeout says 10 seconds: ' + slow.json?.reason);
  assert(seen.length === 2 && seen.every(i => i.signal instanceof AbortSignal && i.redirect === 'manual' && i.method === 'POST'), 'every request has a timeout signal, redirect manual and POST');
  const rows = await auditRows('crm-test', WS_A);
  eq((rows[rows.length - 1] as { outcome: string }).outcome, 'failed', 'audited as failed');
});

t('crm-test: a host that resolves to a private, loopback or link-local address is refused with 422 CRM-HOST before any connection; an unresolvable name too', async () => {
  await connectCrm(URL_A);
  await hooks.answer(200);
  const before = (await hooks.recorded()).hooks.length;
  const rows = (await auditRows('crm-test', WS_A)).length;
  for (const [why, resolve] of [['127.0.0.1', answers(['127.0.0.1'])], ['10.1.2.3', answers(['10.1.2.3'])], ['169.254.169.254', answers(['169.254.169.254'])], ['::1', answers([], ['::1'])],
    ['public and private together', answers(['93.184.216.34', '192.168.0.9'])], ['no answer', nowhere]] as const) {
    const calls: string[] = [];
    const r = await run('owner-a', { workspace: WS_A }, { resolve, fetchImpl: (u, i) => { calls.push(String(u)); return toFakeHook(u, i); } });
    eq(r.status, 422, `${why}: ${r.text}`); eq(r.json?.code, 'CRM-HOST', `${why}: code`);
    eq(calls.length, 0, `${why}: no connection was made`);
  }
  eq((await hooks.recorded()).hooks.length, before, 'the webhook received nothing');
  const after = await auditRows('crm-test', WS_A);
  eq(after.length, rows + 6, 'each refusal is audited');
  eq((after[after.length - 1] as { outcome: string }).outcome, 'refused', 'as refused');
  const lookups = counting(publicHost);
  await run('owner-a', { workspace: WS_A }, { resolve: lookups });
  assert(lookups.calls >= 1, 'a name is resolved before the request');
});

t('crm-test: no connection is 409 NO-CRM; an agent, another workspace\'s owner and a login of nothing are 404 and nothing is sent; no token is 401; a bad body is 400', async () => {
  await connectCrm(URL_A);
  await hooks.answer(200);
  const sent = (await hooks.recorded()).hooks.length;
  const none = await run('owner-b', { workspace: WS_B });
  eq(none.status, 409, 'B has no connection: ' + none.text); eq(none.json?.code, 'NO-CRM', 'code');
  const ev = await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' });
  const agent = await run('member-a1', { workspace: WS_A });
  eq(agent.status, 404, 'agent: ' + agent.text); eq(agent.json?.code, 'S-NOT-FOUND', 'code');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' }), ev + 1, 'a security event');
  eq((await run('owner-b', { workspace: WS_A })).status, 404, 'owner of B on A');
  eq((await run('nobody', { workspace: WS_A })).status, 404, 'nobody');
  eq((await run(null, { workspace: WS_A })).status, 401, 'no token');
  eq((await run('owner-a', {})).status, 400, 'no workspace');
  eq((await run('owner-a', { workspace: 'nope' })).status, 400, 'a workspace that is not an id');
  eq((await hooks.recorded()).hooks.length, sent, 'none of these sent anything');
});
