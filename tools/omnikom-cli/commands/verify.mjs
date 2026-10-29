// verify --only lead   the walls of the lead function over HTTP (spec section 4), against a target where capture-lead is
// deployed. A fixed script of checks with expectations; one line each, PASS or FAIL with the real status; exit 1 on any FAIL.
// It needs the two seeded test sites (omnikom seed test) and their keys (omnikom key mint) in the environment by name,
// and it cleans up the leads it created. The paused-site check pauses site A for one request and puts its state back.
//   1 a signed lead is accepted (202)                      2 the same idempotency key twice stores one row
//   3 an empty consent is refused (400)                    4 B's key on A's site is refused (401)
//   5 the same signature after 301 s is refused (401)      6 no signature is refused (401)
//   7 a garbled signature is refused (401)                 8 an unknown site id is refused (401), a malformed one is 404
//   9 a lead to a paused site is not stored                10 GET is refused (405)
import { Usage } from '../lib/errors.mjs';
import { uuidLit } from '../lib/sql.mjs';
import { result } from '../lib/ctx.mjs';
import { parseIdentity, machineKey } from '../lib/identity.mjs';
import { callFunction } from '../lib/fn.mjs';
import { loadFixture } from '../lib/fixtures.mjs';

export async function verify(ctx) {
  const f = ctx.flags;
  const only = f.only || 'lead';
  if (only !== 'lead') throw new Usage("verify --only lead (the only suite in slice 1; it grows with the functions)");
  const target = ctx.target();
  const a = ctx.site(f['site-a'] || 'test-demo-a');
  const b = ctx.site(f['site-b'] || 'test-demo-b');
  const idA = parseIdentity(`site:${a.slug}`), idB = parseIdentity(`site:${b.slug}`);
  const keyA = machineKey(idA, ctx.env), keyB = machineKey(idB, ctx.env);
  const { data: fixture } = loadFixture(f.fixture || 'lead-contact.json');
  const sql = ctx.sql();

  const created = [];
  const lead = (extra = {}) => { const k = ctx.randomUUID(); created.push(k); return { body: JSON.stringify({ ...fixture, idempotencyKey: k, ...extra }), idem: k }; };
  const post = ({ siteId = a.id, body, identity = idA, key = keyA, t, headers, method = 'POST' }) =>
    callFunction({ base: target.functionsBase, name: 'capture-lead', query: `?site=${siteId}`, method, body, identity: headers ? null : identity, key, t: t ?? ctx.now(), fetchImpl: ctx.fetch, extraHeaders: headers || {} });
  const rows = k => Number(sql.scalar(`select count(*) from leads where idempotency_key = ${uuidLit(k)}`).value);

  const checks = [];
  const add = (name, expected, status, pass, extra = '') => checks.push({ name, expected, status, pass: Boolean(pass), extra });

  let L = lead();
  let r = await post(L);
  add('a signed lead is accepted', '202', r.status, r.status === 202);
  r = await post(L);
  add('the same idempotency key twice stores one row', '202 and 1 row', r.status, r.status === 202 && rows(L.idem) === 1, `rows=${rows(L.idem)}`);
  L = lead({ consentText: '' });
  r = await post(L);
  add('an empty consent is refused', '400', r.status, r.status === 400 && rows(L.idem) === 0);
  L = lead();
  r = await post({ ...L, identity: idB, key: keyB });
  add("B's key on A's site is refused", '401', r.status, r.status === 401 && rows(L.idem) === 0);
  L = lead();
  r = await post({ ...L, t: ctx.now() - 301 });
  add('a signature older than 301 s is refused (replay)', '401', r.status, r.status === 401 && rows(L.idem) === 0);
  L = lead();
  r = await post({ ...L, headers: {} });
  add('a request without a signature is refused', '401', r.status, r.status === 401 && rows(L.idem) === 0);
  L = lead();
  r = await post({ ...L, headers: { 'x-site-signature': 't=1,v1=00' } });
  add('a garbled signature is refused', '401', r.status, r.status === 401 && rows(L.idem) === 0);
  L = lead();
  const stranger = ctx.randomUUID();
  r = await post({ ...L, siteId: stranger, t: ctx.now() });
  add('an unknown site id is refused', '401', r.status, r.status === 401 && rows(L.idem) === 0);
  r = await post({ ...L, siteId: 'not-a-site-id', headers: {} });
  add('a malformed site id is not found', '404', r.status, r.status === 404);
  r = await post({ body: '', method: 'GET', headers: {} });
  add('GET is refused', '405', r.status, r.status === 405);

  // a paused site stores nothing (the function answers with an error status; the exact code is reported)
  const before = sql.scalar(`select state::text from sites where id = ${uuidLit(a.id)}`).value;
  sql.exec(`update sites set state = 'paused' where id = ${uuidLit(a.id)};`);
  try {
    L = lead();
    r = await post(L);
    add('a lead to a paused site is not stored', 'not 202, 0 rows', r.status, r.status !== 202 && rows(L.idem) === 0);
  } finally {
    sql.exec(`update sites set state = ${before ? `'${before.replace(/'/g, '')}'` : "'preview'"}::site_state where id = ${uuidLit(a.id)};`);
  }

  for (const k of created) sql.exec(`delete from leads where idempotency_key = ${uuidLit(k)};`);   // events and messages cascade
  const lines = checks.map(c => `${c.pass ? 'PASS' : 'FAIL'} ${c.name} (expected ${c.expected}, got ${c.status}${c.extra ? ', ' + c.extra : ''})`);
  const failed = checks.filter(c => !c.pass).length;
  return result(failed === 0, failed === 0 ? 'ok' : 'VERIFY-FAILED', { suite: only, passed: checks.length - failed, failed, lines, checks });
}
