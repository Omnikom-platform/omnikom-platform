// Local end-to-end for the plain browser form: a real HTTP post (urlencoded, as a browser sends it) -> the lead handler behind a real
// server -> a stub platform that verifies the signature with the platform's own verify(). Prints what each side saw; exits 1 if a
// case does not come out as expected.   node factory/worker/test/e2e-form.mjs
import http from 'node:http';
import { makeLeadHandler } from '../lead-endpoint.mjs';
import { verify } from '../../../supabase/functions/_shared/signature.ts';

const SITE = '11111111-2222-4333-8444-555555555555', KEY = 'local-e2e-key-not-a-secret'; // gitleaks:allow
const seen = [];
const platform = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const ok = await verify(req.headers['x-site-signature'], KEY, 'POST', req.url, body);
  seen.push({ url: req.url, ctype: req.headers['content-type'], sigOk: ok, body });
  const j = JSON.parse(body);
  if (!j.consentText) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 400, problems: [{ code: 'REQUIRED', path: 'consentText', msg: 'This is needed.' }] })); return; }
  res.writeHead(202, { 'content-type': 'application/json' }); res.end('{"ok":true}');
});
await new Promise((r) => platform.listen(0, r));
const base = `http://127.0.0.1:${platform.address().port}`;

let bad = 0;
const expect = (cond, what) => { if (!cond) { bad++; console.log(`  EXPECTED: ${what}  <- NOT MET`); } };
const line = (s) => s.replace(/\s+/g, ' ').slice(0, 260);

const run = async (label, thanksPath, fields, want) => {
  const handle = makeLeadHandler({ siteId: SITE, signingKey: KEY, platformBase: base, thanksPath });
  const site = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const r = await handle(new Request(`http://site.test${req.url}`, { method: req.method, headers: req.method === 'POST' ? { 'content-type': req.headers['content-type'] } : {}, body: req.method === 'POST' ? body : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text());
  });
  await new Promise((r) => site.listen(0, r));
  const root = `http://127.0.0.1:${site.address().port}`;
  const before = seen.length;
  const res = await fetch(`${root}/api/lead`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  const text = await res.text();
  const f = seen[before];
  console.log(`--- ${label}\nanswer: ${res.status} content-type=${res.headers.get('content-type')} location=${res.headers.get('location')} x-robots-tag=${res.headers.get('x-robots-tag')} cache-control=${res.headers.get('cache-control')}\nanswer body: ${line(text)}\n${f ? `forwarded: ${f.ctype} signature verified by the platform's verify(): ${f.sigOk}  ${f.url}\nforwarded body: ${f.body}` : 'forwarded: nothing (the platform was not called)'}`);
  if (want.noForward) expect(!f, 'nothing forwarded'); else expect(f && f.sigOk && f.ctype === 'application/json', 'the platform got signed JSON');
  expect(res.status === want.status, `status ${want.status}`);
  if (want.location) expect(res.headers.get('location') === want.location, `location ${want.location}`);
  if (want.html) expect(/^text\/html/.test(res.headers.get('content-type') || '') && text.includes(want.html), `an HTML page containing "${want.html}"`);
  if (want.follow) {   // post-redirect-get: the browser now GETs the location
    const g = await fetch(root + res.headers.get('location'), { signal: AbortSignal.timeout(10000) });
    const gt = await g.text();
    console.log(`  follow GET ${res.headers.get('location')}: ${g.status} content-type=${g.headers.get('content-type')} x-robots-tag=${g.headers.get('x-robots-tag')} cache-control=${g.headers.get('cache-control')} body: ${line(gt)}`);
    expect(g.status === 200 && /^text\/html/.test(g.headers.get('content-type') || '') && gt.includes('Your message was sent.') && seen.length === before + 1, 'the thank-you GET is 200 HTML and forwards nothing');
    const other = await fetch(`${root}/api/lead`, { signal: AbortSignal.timeout(10000) });
    console.log(`  GET /api/lead (no sent=1): ${other.status} ${await other.text()}`);
    expect(other.status === 405, 'any other GET is 405');
  }
  site.close();
};

const fields = { form: 'contact', page: '/contact/', name: 'Lead A', email: 'a@example.test', phone: '', message: 'Hello', consent: 'yes', consentText: 'I agree to be contacted.', marketingConsentText: 'Send me news', hp: '' };
await run('good post, default: 303 to the thank-you GET, then that GET', '', fields, { status: 303, location: '/api/lead?sent=1', follow: true });
await run('good post, THANKS_PATH /thanks/', '/thanks/', fields, { status: 303, location: '/thanks/' });
const { consent, ...unticked } = fields;
await run('consent box not ticked (the platform refuses it)', '', unticked, { status: 400, html: 'Consent: This is needed.' });
await run('honeypot filled (refused before the platform)', '', { ...fields, hp: 'http://spam' }, { status: 400, html: 'Something is missing.', noForward: true });
platform.close();
console.log(bad ? `\nE2E FAILED: ${bad} expectation(s) not met` : '\nE2E OK');
process.exit(bad ? 1 : 0);
