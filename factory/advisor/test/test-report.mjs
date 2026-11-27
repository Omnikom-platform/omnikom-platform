// The session report's collector and endpoint (ADR 007 steps 1 and 2, omnikom.io only): docs/advisor/r3/HANDOVER-collector.md.
// Redaction before storage (in the browser and again in the endpoint), no report under Global Privacy Control, no report from a client
// site's pack, off by default in code, the 30-day and 24-hour TTLs, the per-IP cap, a KV that throws, the body whatever its Content-Type.
// Mutants in the repo's pattern (lib-test-kit main(): each must turn its named assertions red); they patch a copy of factory/advisor/report/.
// Run: node factory/advisor/test/test-report.mjs  -> "SESSION REPORT TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, checker } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const meta = (p) => ({ meta: JSON.parse(readFileSync(path.join(here, '../packs', p, 'pack.json'), 'utf8')).meta });
const OMNI = meta('omnikom-io'), VTV = meta('vtv');
const SESSION = '0f8e7a52-3c1d-4b7e-9a10-2b3c4d5e6f70', SALT = 'test-salt-0123456789abcdef', IP = '203.0.113.7';
const FALL = { band: 'fallback', intents: [] }, CLAR = { band: 'clarify', intents: [] }, ANS = (id) => ({ band: 'answer', intents: [id] });

// a module that does not exist yet turns each case into a FAIL line, never a crash of the run
const load = async (dir, f) => { try { return await import(pathToFileURL(path.join(dir, f)).href + '?' + Date.now()); } catch (e) { return { __err: String(e.message).split('\n')[0] }; } };
const fn = (m, k) => (typeof m?.[k] === 'function' ? m[k] : () => { throw new Error('no export ' + k + (m?.__err ? ' (' + m.__err + ')' : '')); });
const sync = (f) => { try { return f(); } catch (e) { return 'threw: ' + e.message; } };
const nav = (gpc) => { const calls = []; return { calls, globalPrivacyControl: gpc, sendBeacon: (url, body) => { calls.push({ url, body }); return true; } }; };
const fakeKV = (throwOn) => {
  const store = new Map(), puts = [];
  return { store, puts, async get(k) { return store.has(k) ? store.get(k).v : null; },
    async put(k, v, o) { if (throwOn?.(k)) throw new Error('KV PUT failed: 429 Too Many Requests'); puts.push({ k, v, o }); store.set(k, { v, o }); } };
};
const counts0 = () => ({ open: 1, turns: 2, answered: 1, clarify: 0, noMatch: 1, threeNoMatch: 0, qualified: 0, planShown: 0, handoffOpened: 0, didntAnswer: 0 });
const good = (over = {}) => ({ v: 1, pack: 'omnikom-io', packVersion: '0.1.0', session: SESSION, counts: counts0(),
  misses: [{ kind: 'no-match', text: 'what about x', band: 'fallback', top: [], turn: 1 }], ...over });
const req = (body, { method = 'POST', ip = IP, type = 'text/plain;charset=UTF-8', headers = {} } = {}) =>
  new Request('https://omnikom.io/api/advisor-report', { method, headers: { 'content-type': type, 'cf-connecting-ip': ip, ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
const rKeys = (kv) => [...kv.store.keys()].filter((k) => k.startsWith('r:'));

const scenarios = async (dir) => {
  const results = [], check = checker(results);
  const [policy, red, col, ep] = [await load(dir, 'policy.mjs'), await load(dir, 'redact.mjs'), await load(dir, 'collect.mjs'), await load(dir, 'endpoint.mjs')];
  const validator = await load(path.join(here, '../pack'), 'validate.mjs');
  const redact = fn(red, 'redact'), allowed = fn(policy, 'reportAllowed'), createCollector = fn(col, 'createCollector'), onRequest = fn(ep, 'onRequest');
  const R = (t, name) => sync(() => redact(t, name));

  // 1. redaction: each rule, and what must stay
  let r;
  r = R('mail me at Dana.K@example.com please'); check('redact: an email becomes [email]', r === 'mail me at [email] please', r);
  for (const p of ['(916) 555-0142', '916.555.0142', '+1 916 555 0142', '9165550142']) {
    r = R('call ' + p + ' now'); check('redact: the phone ' + p + ' becomes [phone]', r === 'call [phone] now', r);
  }
  r = R('we are in 95814'); check('redact: a ZIP (5 digits) becomes [digits]', r === 'we are in [digits]', r);
  r = R('account 123456 please'); check('redact: a run of 6 digits becomes [digits]', r === 'account [digits] please', r);
  r = R('since 2024 we made 10 calls, 2024 10 agents'); check('redact: 4 digits, and 6 digits split by a space, stay', r === 'since 2024 we made 10 calls, 2024 10 agents', r);
  r = R('Dana here, call DANA tomorrow', 'Dana'); check('redact: the name slot value becomes [name], any case, whole word', r === '[name] here, call [name] tomorrow', r);
  r = R('mr Danahue called', 'Dana'); check('redact: the name inside a longer word stays', r === 'mr danahue called', r);
  r = R('a b c', 'A'); check('redact: a one-letter name is not used', r === 'a b c', r);
  r = R('  So   MANY\n spaces '); check('redact: lower case, spaces collapsed', r === 'so many spaces', r);
  r = R('x'.repeat(300)); check('redact: cut to 200 characters', typeof r === 'string' && r.length === 200, String(r).length);

  // 2. who may send: off by default, the listed pack only, never under GPC
  const off = { meta: { ...OMNI.meta } }; delete off.meta.report;
  const vtvOn = { meta: { ...VTV.meta, report: true } };
  check('policy: the omnikom-io pack, GPC off, may report (control)', sync(() => allowed(OMNI, nav(false))) === true, sync(() => allowed(OMNI, nav(false))));
  check('policy: GPC on = no report', sync(() => allowed(OMNI, nav(true))) === false, sync(() => allowed(OMNI, nav(true))));
  check('policy: a client-site pack (VTV, report false) = no report', sync(() => allowed(VTV, nav(false))) === false, sync(() => allowed(VTV, nav(false))));
  check('policy: a VTV copy with report: true = no report at run time', sync(() => allowed(vtvOn, nav(false))) === false, sync(() => allowed(vtvOn, nav(false))));
  check('policy: off by default in code (meta.report missing)', sync(() => allowed(off, nav(false))) === false, sync(() => allowed(off, nav(false))));
  check("policy: report 'yes' is not true", sync(() => allowed({ meta: { ...OMNI.meta, report: 'yes' } }, nav(false))) === false, '');
  check('policy: the run-time list equals the validator list', JSON.stringify(policy.REPORT_PACKS) === JSON.stringify(validator.REPORT_PACKS) && Array.isArray(policy.REPORT_PACKS),
    JSON.stringify([policy.REPORT_PACKS, validator.REPORT_PACKS]));

  // 3. the collector
  const session = (pack, gpc) => { const n = nav(gpc); const c = sync(() => createCollector({ pack, nav: n, session: SESSION })); return { c, n }; };
  {
    const { c, n } = session(OMNI, true);
    sync(() => c.observe(FALL, 'what about x'));
    check('collector: GPC on = no report built', sync(() => c.buildReport()) === null, sync(() => JSON.stringify(c.buildReport())));
    sync(() => c.send()); check('collector: GPC on = sendBeacon never called', n.calls.length === 0, n.calls.length);
  }
  {
    const { c, n } = session(OMNI, false);
    sync(() => c.observe(FALL, 'what about x'));
    const sent = sync(() => c.send());
    check('collector: GPC off = one beacon to /api/advisor-report (control)', sent === true && n.calls.length === 1 && n.calls[0].url === '/api/advisor-report', JSON.stringify(n.calls));
    sync(() => c.send());
    check('collector: a second send with no new turn sends nothing (once per change)', n.calls.length === 1, n.calls.length);
    sync(() => c.observe(FALL, 'and y')); sync(() => c.send()); sync(() => c.observe(FALL, 'and z')); sync(() => c.send()); sync(() => c.observe(ANS('a'), 'ok')); sync(() => c.send());
    check('collector: at most 3 sends a session', n.calls.length === 3, n.calls.length);
    const body = sync(() => JSON.parse(n.calls[0].body));
    check('collector: the beacon body is the report as JSON', body?.session === SESSION && body?.pack === 'omnikom-io' && body?.v === 1, JSON.stringify(body));
  }
  for (const [label, pack] of [['a client-site pack (VTV)', VTV], ['a VTV copy with report: true', vtvOn], ['the omnikom-io pack with meta.report missing (off by default)', off]]) {
    const { c, n } = session(pack, false);
    sync(() => c.observe(FALL, 'what about x')); sync(() => c.send());
    check('collector: ' + label + ' = no report and no beacon', sync(() => c.buildReport()) === null && n.calls.length === 0, n.calls.length);
  }
  {
    const { c, n } = session(OMNI, false);
    check('collector: nothing to report (no turn) = no report', sync(() => c.buildReport()) === null, sync(() => JSON.stringify(c.buildReport())));
    sync(() => c.send()); check('collector: nothing to report = no beacon', n.calls.length === 0, n.calls.length);
  }
  {
    const { c } = session(OMNI, false);
    sync(() => c.observe(FALL, 'I am Dana, mail dana@x.io or call (916) 555-0142, zip 95814'));
    const s = String(sync(() => JSON.stringify(c.buildReport('Dana'))));
    check('collector: personal data in a miss is removed before it leaves the browser', s.includes('no-match') && !/dana|555|0142|95814|x\.io/i.test(s), s);
  }
  {
    const { c } = session(OMNI, false);
    for (const t of ['one', 'two', 'three']) sync(() => c.observe(FALL, t));
    sync(() => c.observe(CLAR, 'price for isa')); sync(() => c.observe(ANS('price.isa'), '1'));
    sync(() => c.mark('didntAnswer')); sync(() => c.mark('bogus'));
    const rep = sync(() => c.buildReport()), kinds = (rep?.misses ?? []).map((m) => m.kind).join(',');
    check('collector: three no-matches, a clarify picked, a "didn\'t answer it"', kinds === 'no-match,no-match,no-match,three-no-match,clarify-picked,didnt-answer', kinds);
    const cp = rep?.misses?.find((m) => m.kind === 'clarify-picked');
    check('collector: clarify-picked holds the asked line and the chosen id', cp?.text === 'price for isa' && cp?.top?.[0] === 'price.isa', JSON.stringify(cp));
    check('collector: the counts', JSON.stringify(rep?.counts) === JSON.stringify({ open: 1, turns: 5, answered: 1, clarify: 1, noMatch: 3, threeNoMatch: 1, qualified: 0, planShown: 0, handoffOpened: 0, didntAnswer: 1 }), JSON.stringify(rep?.counts));
  }

  // 4. the endpoint (no fetch, no console line)
  const realFetch = globalThis.fetch, saved = {}, logged = [];
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw new Error('no fetch allowed'); };
  for (const k of ['log', 'info', 'warn', 'error']) { saved[k] = console[k]; console[k] = (...a) => logged.push(a.join(' ')); }
  const call = async (request, env) => { try { return (await onRequest({ request, env })).status; } catch (e) { return 'threw: ' + e.message; } };
  const env = (kv) => ({ ADVISOR_REPORTS: kv, REPORT_SALT: SALT });
  const day = new Date().toISOString().slice(0, 10), hash = createHmac('sha256', SALT).update(day + '|' + IP).digest('hex');
  let kv, st;
  try {
    kv = fakeKV(); st = await call(req(good()), env(kv));
    const rp = kv.puts.find((p) => p.k.startsWith('r:'));
    check('endpoint: a text/plain body (what sendBeacon sends) is stored: 204', st === 204 && rp?.k === 'r:' + day + ':' + SESSION, st + ' ' + rp?.k);
    check('endpoint: the report is written with the 30-day TTL (2592000 s)', kv.puts.filter((p) => p.k.startsWith('r:')).every((p) => p.o?.expirationTtl === 2592000) && !!rp, JSON.stringify(rp?.o));
    const cp = kv.puts.find((p) => p.k.startsWith('c:'));
    check('endpoint: the IP counter is the salted hash, held 24 hours (86400 s)', cp?.k === 'c:' + hash && cp?.o?.expirationTtl === 86400, JSON.stringify(cp));
    const rAll = kv.puts.filter((p) => p.k.startsWith('r:')).map((p) => p.k + ' ' + p.v).join('\n');
    check('endpoint: no IP and no IP hash in any stored report', !!rAll && !rAll.includes(IP) && !rAll.includes(hash), rAll.slice(0, 200));

    kv = fakeKV(); st = await call(req(good(), { type: 'application/json' }), env(kv));
    check('endpoint: an application/json body is stored: 204', st === 204 && rKeys(kv).length === 1, st);

    kv = fakeKV();
    st = await call(req(good({ misses: [{ kind: 'no-match', text: 'I am Dana, mail dana@x.io or call (916) 555-0142, zip 95814', band: 'fallback', top: [], turn: 1 }] })), env(kv));
    const v = kv.store.get('r:' + day + ':' + SESSION)?.v ?? '';
    check('endpoint: a crafted POST with raw personal data is redacted before storage', st === 204 && v.includes('[email]') && !/dana@|555|0142|95814/.test(v), st + ' ' + v.slice(0, 200));

    kv = fakeKV(); for (let i = 0; i < 2; i++) await call(req(good()), env(kv));
    check('endpoint: one session sent twice = one stored report', rKeys(kv).length === 1, rKeys(kv).length);

    kv = fakeKV(); const codes = [];
    for (let i = 0; i < 31; i++) codes.push(await call(req(good({ session: SESSION.slice(0, -2) + String(i).padStart(2, '0') })), env(kv)));
    check('endpoint: 30 reports from one IP in a day pass, the 31st is 429 and not stored', codes.slice(0, 30).every((c) => c === 204) && codes[30] === 429 && rKeys(kv).length === 30, codes.join(','));
    st = await call(req(good({ session: SESSION.slice(0, -2) + '99' }), { ip: '198.51.100.9' }), env(kv));
    check('endpoint: another IP still passes the cap', st === 204, st);

    kv = fakeKV(); st = await call(req(good(), { headers: { 'sec-gpc': '1' } }), env(kv));
    check('endpoint: Sec-GPC: 1 = 204 and nothing stored', st === 204 && kv.puts.length === 0, st + ' ' + kv.puts.length);
    kv = fakeKV(); st = await call(req(null, { method: 'GET' }), env(kv));
    check('endpoint: GET = 405', st === 405 && kv.puts.length === 0, st);
    kv = fakeKV(); st = await call(req(JSON.stringify(good()) + ' '.repeat(9000)), env(kv));
    check('endpoint: a body over 8 KiB = 413, nothing stored', st === 413 && kv.puts.length === 0, st);
    kv = fakeKV(); st = await call(req(good({ ip: '1.2.3.4' })), env(kv));
    check('endpoint: a field outside the allow-list = 400, nothing stored', st === 400 && kv.puts.length === 0, st);
    kv = fakeKV(); st = await call(req(good({ pack: 'vtv' })), env(kv));
    check('endpoint: a report from another pack = 400, nothing stored', st === 400 && kv.puts.length === 0, st);
    kv = fakeKV(); st = await call(req('{not json'), env(kv));
    check('endpoint: bad JSON = 400', st === 400 && kv.puts.length === 0, st);
    st = await call(req(good()), { REPORT_SALT: SALT });
    check('endpoint: no KV binding = 503', st === 503, st);
    kv = fakeKV(); st = await call(req(good()), { ADVISOR_REPORTS: kv });
    check('endpoint: no REPORT_SALT = 503, nothing stored', st === 503 && kv.puts.length === 0, st);
    kv = fakeKV(() => true); st = await call(req(good()), env(kv));
    check('endpoint: a KV put that always throws = 503, no report, no crash', st === 503 && rKeys(kv).length === 0, st);
    kv = fakeKV((k) => k.startsWith('r:')); st = await call(req(good()), env(kv));
    check('endpoint: a KV put that throws on the report key = 503, no report, no crash', st === 503 && rKeys(kv).length === 0, st);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(saved)) console[k] = saved[k];
  }
  check('endpoint: no fetch (no outside call, no model call)', fetched === 0, fetched);
  check('endpoint: no console line', logged.length === 0, logged.slice(0, 2).join(' | '));
  return results;
};
const P = (file, from, to) => ({ file, from, to });
const MUTANTS = [
  { name: 'the email rule removed', patches: [P('redact.mjs', "t = t.replace(EMAIL, '[email]');", '')], expect: [/an email becomes/] },
  { name: 'the phone rule removed', patches: [P('redact.mjs', "t = t.replace(PHONE, (m) => (m.replace(/\\D/g, '').length >= 7 ? '[phone]' : m));", '')], expect: [/\(916\) 555-0142 becomes/] },
  { name: '5 digits changed to 6', patches: [P('redact.mjs', 'const DIGITS = /\\d{5,}/g;', 'const DIGITS = /\\d{6,}/g;')], expect: [/a ZIP/] },
  { name: 'the name rule removed', patches: [P('redact.mjs', 'if (n.length >= 2) t = t.replace(', 'if (false) t = t.replace(')], expect: [/name slot value/] },
  { name: 'the GPC check removed', patches: [P('policy.mjs', 'if (nav?.globalPrivacyControl === true) return false;', '')], expect: [/policy: GPC on/, /collector: GPC on/] },
  { name: '=== true changed to !== false', patches: [P('policy.mjs', 'if (m.report !== true) return false;', 'if (m.report === false) return false;')], expect: [/off by default in code/] },
  { name: 'the run-time pack list check removed', patches: [P('policy.mjs', 'if (!REPORT_PACKS.includes(m.pack)) return false;', '')], expect: [/VTV copy with report: true = no report at run time/] },
  { name: 'the collector sends with no change', patches: [P('collect.mjs', 'if (body === lastSent) return false;', '')], expect: [/once per change/] },
  { name: "the endpoint's second redaction removed", patches: [P('endpoint.mjs', 'text: redact(m.text),', 'text: m.text,')], expect: [/crafted POST/] },
  { name: 'the 30-day TTL dropped', patches: [P('endpoint.mjs', '{ expirationTtl: KEEP_S }', '{}')], expect: [/30-day TTL/] },
  { name: 'the cap check removed', patches: [P('endpoint.mjs', 'if (n >= CAP) return reply(429);', '')], expect: [/the 31st is 429/] },
  { name: 'the cap TTL dropped', patches: [P('endpoint.mjs', '{ expirationTtl: CAP_S }', '{}')], expect: [/held 24 hours/] },
  { name: 'the IP hash written into the report', patches: [P('endpoint.mjs', 'JSON.stringify(rep),', 'JSON.stringify({ ...rep, ipHash: capKey }),')], expect: [/no IP and no IP hash/] },
  { name: 'the Sec-GPC check removed', patches: [P('endpoint.mjs', "if (request.headers.get('sec-gpc') === '1') return reply(204);", '')], expect: [/Sec-GPC/] },
  { name: "the endpoint's pack check removed", patches: [P('endpoint.mjs', 'if (!REPORT_PACKS.includes(r.pack)) return null;', '')], expect: [/another pack = 400/] },
  { name: 'the size limit removed', patches: [P('endpoint.mjs', 'if (new TextEncoder().encode(text).length > BODY_MAX) return reply(413);', '')], expect: [/over 8 KiB/] },
  { name: 'the try around the KV calls removed', patches: [P('endpoint.mjs', '  try {\n    const n = Number(', '  {\n    const n = Number('), P('endpoint.mjs', '  } catch {\n    return reply(503);\n  }\n', '  }\n')],
    expect: [/always throws/, /throws on the report key/] },
  { name: 'the body parsed only as application/json', patches: [P('endpoint.mjs', 'const text = await request.text();', "const text = /application\\/json/.test(request.headers.get('content-type') || '') ? await request.text() : '';")],
    expect: [/text\/plain body/] },
];
process.exit(await main({ label: 'SESSION REPORT', scenarios, MUTANTS, scriptsDir: path.join(here, '../report'), argv: process.argv.slice(2) }));
