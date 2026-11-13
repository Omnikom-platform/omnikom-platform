// Tests for the site lead endpoint (factory/worker/lead-endpoint.mjs). No framework; exit 1 on any failure. The draft gate (draft-gate.mjs, B15-b3) too.
//   node factory/worker/test/run.mjs
// The platform is a fake fetch that records the request; the signature it receives is checked with the platform's own
// verify() (supabase/functions/_shared/signature.ts, loaded by Node's type stripping), so the two implementations are proven
// to agree on the canonical form.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeLeadHandler, sign } from '../lead-endpoint.mjs';
import { COOKIE, makeDraftGate } from '../draft-gate.mjs';
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
// product row E5: the visitor is sha256 of "<site id>:<address>" in the signed path (capture-lead limits one visitor); the address itself never leaves
await check('the visitor address goes as sha256 of "<site id>:<address>" inside the signed path, never in clear', async () => {
  const p = platform(202); await handler(p)(post(lead, { headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' } }));
  const H = createHash('sha256').update(`${SITE}:203.0.113.9`).digest('hex');
  const path = `/capture-lead?site=${SITE}&visitor=${H}`;
  assert.equal(p.seen[0].url, `${BASE}${path}`);
  const sig = p.seen[0].init.headers['x-site-signature'];
  assert.equal(await verify(sig, KEY, 'POST', path, p.seen[0].init.body, NOW), true, 'the signature covers the visitor');
  assert.equal(await verify(sig, KEY, 'POST', `/capture-lead?site=${SITE}`, p.seen[0].init.body, NOW), false, 'without the visitor the signature fails');
  assert.ok(!p.seen[0].url.includes('203.0.113.9') && !p.seen[0].init.body.includes('203.0.113.9'), 'the address is in neither the URL nor the body');
});

// ---- brief 5-L: the plain browser form (application/x-www-form-urlencoded, no script) ----
// What the factory's form partial posts (sites/test-demo-a/design/sections/form.mjs): the LeadRequest's own names, the contact
// consent as a tick-box plus the wording shown, the marketing consent the same way.
const formFields = { form: 'contact', page: '/', name: 'Lead A', email: 'a@example.test', consent: 'yes', consentText: 'I agree', hp: '', idempotencyKey: lead.idempotencyKey };
const formPost = (fields, init = {}) => new Request('https://site.test/api/lead', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), ...init });
const typeOf = (r) => r.headers.get('content-type') || '';
const textOf = (r) => r.text();

await check('a plain form post forwards the same JSON a script sends, signed over that body, and a sent one is answered 303 (post-redirect-get)', async () => {
  const pj = platform(202), pf = platform(202);
  await handler(pj)(post(lead));
  const r = await handler(pf)(formPost(formFields));
  assert.equal(pf.seen.length, 1);
  assert.deepEqual(JSON.parse(pf.seen[0].init.body), JSON.parse(pj.seen[0].init.body), 'same object as the JSON caller');
  assert.equal(pf.seen[0].init.headers['content-type'], 'application/json');
  assert.ok(await verify(pf.seen[0].init.headers['x-site-signature'], KEY, 'POST', `/capture-lead?site=${SITE}`, pf.seen[0].init.body, NOW), 'the platform verifies the signature over the forwarded JSON');
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/api/lead?sent=1'); assert.doesNotMatch(typeOf(r), /json/);
});
await check('the thank-you page: GET /api/lead?sent=1 is 200 HTML, noindex and no-store, and says the message was sent', async () => {
  const p = platform(202);
  const r = await handler(p)(new Request('https://site.test/api/lead?sent=1'));
  assert.equal(r.status, 200); assert.match(typeOf(r), /^text\/html/);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.equal(r.headers.get('cache-control'), 'no-store');
  const h = await textOf(r); assert.match(h, /Thank you/); assert.match(h, /Your message was sent\./); assert.match(h, /Back to the site/); assert.doesNotMatch(h, /Back to the form/); assert.equal(p.seen.length, 0, 'a GET forwards nothing');
});
await check('every other GET stays 405 JSON, and nothing is forwarded', async () => {
  for (const u of ['https://site.test/api/lead', 'https://site.test/api/lead?sent=0', 'https://site.test/api/lead?x=1']) {
    const p = platform(202); const r = await handler(p)(new Request(u));
    assert.equal(r.status, 405, u); assert.match(typeOf(r), /json/, u); assert.equal(p.seen.length, 0);
  }
  const put = await handler(platform(202))(new Request('https://site.test/api/lead?sent=1', { method: 'PUT' })); assert.equal(put.status, 405, 'only a GET gets the thank-you page');
});
await check('with THANKS_PATH set, a sent plain form post answers 303 there instead; a bad path falls back to the default thank-you GET', async () => {
  const r = await handler(platform(202), { thanksPath: '/thanks/' })(formPost(formFields));
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/thanks/'); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.doesNotMatch(typeOf(r), /json/);
  const bad =await handler(platform(202), { thanksPath: 'https://evil.test/' })(formPost(formFields));
  assert.equal(bad.status, 303); assert.equal(bad.headers.get('location'), '/api/lead?sent=1');
  const refused = await handler(platform(400, { problems: [{ code: 'X', path: '', msg: 'no' }] }), { thanksPath: '/thanks/' })(formPost(formFields));
  assert.equal(refused.status, 400, 'only a sent lead redirects');
  const j = await handler(platform(202), { thanksPath: '/thanks/' })(post(lead)); assert.equal(j.status, 200, 'a JSON caller is never redirected');
});
await check('a plain form post carries the contact consent: ticked sends consentText, not ticked sends none', async () => {
  const p = platform(202); await handler(p)(formPost(formFields));
  assert.equal(JSON.parse(p.seen[0].init.body).consentText, 'I agree');
  const { consent, ...unticked } = formFields;
  const q = platform(400, { status: 400, problems: [{ code: 'REQUIRED', path: 'consentText', msg: 'This is needed.' }] });
  const r = await handler(q)(formPost(unticked));
  assert.equal('consentText' in JSON.parse(q.seen[0].init.body), false, 'no consentText without the tick');
  assert.equal(r.status, 400); assert.match(await textOf(r), /Consent: This is needed\./);
});
await check('a plain form post carries the marketing consent as { given, text }, given false when its box is empty, and the form\'s other fields as answers', async () => {
  const sent = async (extra) => { const p = platform(202); await handler(p)(formPost({ ...formFields, ...extra })); return JSON.parse(p.seen[0].init.body); };
  assert.deepEqual((await sent({ marketingConsent: 'yes', marketingConsentText: 'Send me news' })).marketingConsent, { given: true, text: 'Send me news' });
  assert.deepEqual((await sent({ marketingConsentText: 'Send me news' })).marketingConsent, { given: false, text: 'Send me news' });
  assert.equal('marketingConsent' in await sent({}), false);
  const body = await sent({ marketingConsent: 'yes', marketingConsentText: 'Send me news', message: 'Hello there', phone: '555' });
  assert.deepEqual(body.answers, { message: 'Hello there' }); assert.equal(body.phone, '555'); assert.equal('consent' in body, false); assert.equal('message' in body, false);
});
await check('a bad field gives a page that names each problem in words, escaped, with a link back to the form', async () => {
  const p = platform(400, { status: 400, problems: [{ code: 'EMAIL', path: 'email', msg: 'Enter an email like name@example.com' }, { code: 'X', path: 'phone', msg: '<script>alert(1)</script>' }] });
  const r = await handler(p)(formPost({ ...formFields, page: '/contact/', email: 'nope' }));
  assert.equal(r.status, 400); assert.match(typeOf(r), /^text\/html/);
  const h = await textOf(r);
  assert.match(h, /<li>Email: Enter an email like name@example\.com<\/li>/); assert.match(h, /<li>Phone: &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/li>/);
  assert.doesNotMatch(h, /<script>/); assert.match(h, /<a href="\/contact\/">Back to the form<\/a>/);
});
await check('the link back is only ever a path on this site', async () => {
  for (const page of ['https://evil.test/', '//evil.test/', 'javascript:alert(1)', '/a"b']) {
    const h = await textOf(await handler(platform(400, { problems: [{ code: 'X', path: '', msg: 'no' }] }))(formPost({ ...formFields, page })));
    assert.match(h, /<a href="\/">Back to the form<\/a>/, page);
  }
});
await check('every other outcome of a plain form post is a page with the plain-words message, never JSON', async () => {
  const cases = [[429, /minute/], [409, /call or email/], [401, /call or email/], [500, /Nothing was sent\. Go back and try again/]];
  for (const [status, re] of cases) {
    const r = await handler(platform(status, {}))(formPost(formFields));
    assert.match(typeOf(r), /^text\/html/, String(status)); assert.match(await textOf(r), re, String(status));
  }
  const u = await makeLeadHandler({ siteId: SITE, signingKey: KEY, platformBase: BASE, fetchImpl: async () => { throw new Error('ECONNRESET'); } })(formPost(formFields));
  assert.equal(u.status, 502); assert.match(typeOf(u), /^text\/html/); const uh = await textOf(u); assert.match(uh, /Nothing was sent\. Go back and try again/); assert.doesNotMatch(uh, /answers are still here/i);
  const n = await makeLeadHandler({ siteId: SITE, signingKey: '', platformBase: BASE })(formPost(formFields));
  assert.equal(n.status, 503); assert.match(typeOf(n), /^text\/html/); assert.match(await textOf(n), /call or email/);
});
await check('a plain form post over the cap is refused with a page and nothing is forwarded', async () => {
  const p = platform(202); const r = await handler(p)(formPost({ ...formFields, message: 'x'.repeat(20000) }));
  assert.equal(r.status, 413); assert.match(typeOf(r), /^text\/html/); assert.equal(p.seen.length, 0);
});
await check('a filled honeypot is refused on both paths: nothing is forwarded, a page for the form and JSON for the script', async () => {
  const p = platform(202);
  const f = await handler(p)(formPost({ ...formFields, hp: 'http://spam' }));
  assert.equal(f.status, 400); assert.match(typeOf(f), /^text\/html/); assert.match(await textOf(f), /Something is missing/);
  const j = await handler(p)(post({ ...lead, hp: 'http://spam' }));
  assert.equal(j.status, 400); assert.match(typeOf(j), /json/); assert.equal(p.seen.length, 0);
});
await check('every page answer carries noindex and no-store', async () => {
  for (const r of [await handler(platform(202))(formPost(formFields)), await handler(platform(400, {}))(formPost(formFields)), await handler(platform(202))(formPost({ ...formFields, hp: 'x' }))]) {
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});
await check('a JSON post is unchanged: JSON in the answer, the body forwarded byte for byte', async () => {
  const p = platform(202); const r = await handler(p)(post(lead, { headers: { 'content-type': 'application/json' } }));
  assert.match(typeOf(r), /json/); assert.deepEqual(await r.json(), { sent: true }); assert.equal(p.seen[0].init.body, JSON.stringify(lead));
  const bad = await handler(platform(500, {}))(post(lead)); assert.match(typeOf(bad), /json/);
});

// ---------- book row B15-b3: the draft gate ----------
const GT = 'ab'.repeat(32), T0 = 1_900_000_000_000, gateAt = (now = T0) => makeDraftGate({ sha256: createHash('sha256').update(GT).digest('hex'), until: T0 + 1000, now: () => now });
const page = () => { const seen = { n: 0 }; return { seen, next: async () => { seen.n++; return new Response('<h1>draft</h1>', { status: 200, headers: { 'content-type': 'text/html' } }); } }; };
await check('draft gate: the signed link sets the cookie and redirects (302) to the same address without k, the other query parts kept, never to another site; the page is not read', async () => {
  const p = page(), r = await gateAt()(new Request(`https://draft.site.test/contact/?a=1&k=${GT}&b=2`), p.next);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/contact/?a=1&b=2'); assert.equal(p.seen.n, 0); assert.match(r.headers.get('x-robots-tag') ?? '', /noindex/); assert.equal(r.headers.get('set-cookie'), `${COOKIE}=${GT}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1`); assert.equal((await gateAt()(new Request(`https://draft.site.test//evil.example/?k=${GT}`), p.next)).headers.get('location'), '/evil.example/');   // a path starting // stays on this site
});
await check('draft gate: the cookie alone opens the next page, with no new cookie', async () => {
  const p = page(), r = await gateAt()(new Request('https://draft.site.test/about/', { headers: { cookie: `x=1; ${COOKIE}=${GT}` } }), p.next);
  assert.equal(r.status, 200); assert.equal(p.seen.n, 1); assert.equal(r.headers.get('set-cookie'), null);
});
await check('draft gate: no link, a wrong link or a link past its end time is a plain 404, noindex, and the page is never read, with a good cookie or none', async () => {
  for (const [url, now, cookie = ''] of [['https://draft.site.test/', T0], [`https://draft.site.test/?k=${'cd'.repeat(32)}`, T0], [`https://draft.site.test/?k=${GT}`, T0 + 1000], [`https://draft.site.test/?k=${'cd'.repeat(32)}`, T0, `${COOKIE}=${GT}`], [`https://draft.site.test/?k=${GT}`, T0 + 1000, `${COOKIE}=${GT}`]]) {
    const p = page(), r = await gateAt(now)(new Request(url, { headers: { cookie } }), p.next);
    assert.equal(r.status, 404, `${url} ${cookie}`); assert.equal(await r.text(), 'Not found'); assert.match(r.headers.get('x-robots-tag') ?? '', /noindex/); assert.equal(p.seen.n, 0);
  }
});

// ---- product row E5-b: the hold at the edge (a fake of the Cache API: nothing reaches Cloudflare) ----
function holdCacheFake(clock) {   // keeps what is put until the max-age its cache-control names has passed, by the test's clock
  const kept = new Map(), calls = [];
  return { kept, calls,
    match: async (key) => { calls.push(String(key)); return kept.has(key) && clock() < kept.get(key) ? new Response('held') : undefined; },
    put: async (key, res) => { calls.push(String(key)); const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || ''); kept.set(key, clock() + (m ? Number(m[1]) : 0)); } };
}
const X = '203.0.113.9', Y = '198.51.100.7';
const from = (ip) => ({ headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip } });
const hashOf = (ip) => createHash('sha256').update(`${SITE}:${ip}`).digest('hex');
const SLOW = { sent: false, retry: true, msg: 'Please try again in a minute.' };
const refused = () => platform(429, { status: 429, problems: [{ code: 'S-QUOTA', path: '', msg: 'Please try again later.' }] });
await check('E5-b: a post with no address is never held: the platform\'s 429 is passed on and the cache is not touched', async () => {
  const c = holdCacheFake(() => NOW), p = refused();
  const r = await handler(p, { holdCache: c })(post(lead));
  assert.equal(r.status, 429); assert.deepEqual(await r.json(), SLOW);
  assert.equal(c.calls.length, 0, 'no visitor, no cache call'); assert.equal(p.seen.length, 1);
});
await check('E5-b: after the platform answers 429, that visitor\'s next posts are answered 429 here with the same words and not forwarded; the key is the visitor hash, never the address', async () => {
  const c = holdCacheFake(() => NOW), p = refused(), h = handler(p, { holdCache: c });
  const answers = [];
  for (let i = 0; i < 3; i++) answers.push(await h(post(lead, from(X))));
  assert.equal(p.seen.length, 1, 'only the first post reaches the platform');
  for (const r of answers) { assert.equal(r.status, 429); assert.deepEqual(await r.json(), SLOW); }
  assert.deepEqual([...c.kept.keys()], [`https://site.test/api/lead-hold/${hashOf(X)}`]);
  assert.ok(c.calls.every((k) => !k.includes(X)), 'the address is in no cache key');
});
await check('E5-b: the hold lasts 60 s: a post at 59 s is held, one at 60 s is forwarded again', async () => {
  let t = NOW;
  const c = holdCacheFake(() => t), p = refused(), h = handler(p, { holdCache: c });
  await h(post(lead, from(X)));
  t = NOW + 59; const r = await h(post(lead, from(X)));
  assert.equal(p.seen.length, 1, 'held at 59 s'); assert.equal(r.status, 429);
  t = NOW + 60; await h(post(lead, from(X)));
  assert.equal(p.seen.length, 2, 'forwarded at 60 s');
});
await check('E5-b: the hold is per visitor: another address is forwarded and sent', async () => {
  const c = holdCacheFake(() => NOW), p = refused(), q = platform(202);
  for (let i = 0; i < 2; i++) await handler(p, { holdCache: c })(post(lead, from(X)));
  assert.equal(p.seen.length, 1, 'the first address is held');
  const r = await handler(q, { holdCache: c })(post(lead, from(Y)));
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { sent: true });
  assert.equal(q.seen.length, 1); assert.equal(q.seen[0].url, `${BASE}/capture-lead?site=${SITE}&visitor=${hashOf(Y)}`);
});
await check('E5-b: a held plain form post is answered with a page that says try again in a minute', async () => {
  const c = holdCacheFake(() => NOW), p = refused(), h = handler(p, { holdCache: c });
  await h(post(lead, from(X)));
  const r = await h(formPost(formFields, { headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': X } }));
  assert.equal(r.status, 429); assert.match(typeOf(r), /^text\/html/); assert.match(await textOf(r), /Please try again in a minute\./);
  assert.equal(p.seen.length, 1);
});
await check('E5-b: a cache that fails to read or write is skipped: the post goes on', async () => {
  const down = { match: async () => { throw new Error('cache down'); }, put: async () => { throw new Error('cache down'); } };
  const p = platform(202), q = refused();
  const a = await handler(p, { holdCache: down })(post(lead, from(X)));
  assert.equal(a.status, 200); assert.deepEqual(await a.json(), { sent: true }); assert.equal(p.seen.length, 1);
  const b = await handler(q, { holdCache: down })(post(lead, from(X)));
  assert.equal(b.status, 429); assert.deepEqual(await b.json(), SLOW); assert.equal(q.seen.length, 1);
});
await check('E5-b: without a holdCache option the hold uses the Cache API\'s caches.default', async () => {
  globalThis.caches = { default: holdCacheFake(() => NOW) };
  try {
    const p = refused(), h = handler(p);
    for (let i = 0; i < 3; i++) await h(post(lead, from(X)));
    assert.equal(p.seen.length, 1);
  } finally { delete globalThis.caches; }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
