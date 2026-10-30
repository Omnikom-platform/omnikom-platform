// verify --only lead   the walls of the lead function over HTTP (spec section 4), against a target where capture-lead is
// deployed. A fixed script of checks with expectations; one line each, PASS or FAIL with the real status; exit 1 on any FAIL.
// It needs the two seeded test sites (omnikom seed test) and their keys (omnikom key mint) in the environment by name,
// and it cleans up the leads it created. The paused-site check pauses site A for one request and puts its state back.
//   1 a signed lead is accepted (202)                      2 the same idempotency key twice stores one row, and alerts once
//   3 an empty consent is refused (400)                    4 B's key on A's site is refused (401)
//   5 the same signature after 301 s is refused (401)      6 no signature is refused (401)
//   7 a garbled signature is refused (401)                 8 an unknown site id is refused (401), a malformed one is 404
//   9 a lead to a paused site is not stored                10 GET is refused (405)
import { Usage, Blocked } from '../lib/errors.mjs';
import { uuidLit } from '../lib/sql.mjs';
import { result } from '../lib/ctx.mjs';
import { parseIdentity, machineKey } from '../lib/identity.mjs';
import { callFunction } from '../lib/fn.mjs';
import { loadFixture } from '../lib/fixtures.mjs';

export async function verify(ctx) {
  const f = ctx.flags;
  const only = f.only || 'lead';
  if (only === 'walls') return verifyWalls(ctx);
  if (only !== 'lead') throw new Usage('verify --only lead | walls (the suites grow with the functions)');
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
  // alert rows recorded for that submission: a retry must not alert the client again
  const alerts = k => Number(sql.scalar(`select count(*) from messages m join leads l on l.id = m.lead_id where l.idempotency_key = ${uuidLit(k)} and m.template = 'new-lead'`).value);

  const checks = [];
  const add = (name, expected, status, pass, extra = '') => checks.push({ name, expected, status, pass: Boolean(pass), extra });

  let L = lead();
  let r = await post(L);
  add('a signed lead is accepted', '202', r.status, r.status === 202);
  r = await post(L);
  add('the same idempotency key twice stores one row', '202 and 1 row', r.status, r.status === 202 && rows(L.idem) === 1, `rows=${rows(L.idem)}`);
  add('a retry sends no second alert', 'at most 1 alert row', r.status, alerts(L.idem) <= 1, `alerts=${alerts(L.idem)}`);
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

// verify --only walls   what the Data API does with callers who are nobody (spec section 4: "anon calls a service function").
// Needs only the project's PUBLISHABLE key (an anon caller), read by name; no login, nothing is written.
// WAITING (not faked): every check that needs a person's session token (owner B reads A's leads, member A1 sees only own leads,
// nobody sees nothing) is BLOCKED until the seeded logins can sign in (lib/identity.mjs personToken); the checks that need the
// slice 2 functions (lead-update, publish, add-lead) wait for those functions.
export const WALLS_WAITING = [
  'owner B reads A\'s leads -> 0 rows (needs a person token)',
  'member A1 sees only their own leads (needs a person token)',
  'nobody sees nothing (needs a person token)',
  'member A1 updates A2\'s lead -> S-NOT-FOUND (needs the lead-update function)',
  'member A1 publishes A2\'s listing -> S-OWN-ONLY (needs the publish function)',
];
async function verifyWalls(ctx) {
  const target = ctx.target();
  if (!target.restBase) throw new Blocked('no Data API URL for this target (staging needs STAGING_SUPABASE_REF; local needs LOCAL_REST_BASE)', 'set the variable by name');
  const keyVar = target.vars.publishableKey;
  const anon = ctx.env[keyVar];
  if (!anon) throw new Blocked(`${keyVar} is not set (the anon key of the project, read by name)`, `set ${keyVar} in the environment`);
  const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
    try {
      const res = await ctx.fetch(target.restBase.replace(/\/$/, '') + path, { method, headers: { apikey: anon, ...headers }, body, signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, json, text };
    } catch (e) { return { status: 0, json: null, text: '' }; }
  };
  const checks = [];
  const add = (name, expected, status, pass) => checks.push({ name, expected, status, pass: Boolean(pass), extra: '' });
  const refused = s => s === 401 || s === 403 || s === 404 || s === 406;   // a Data API refusal: no login, no function, schema not exposed
  const empty = r => r.status === 200 && Array.isArray(r.json) && r.json.length === 0;

  let r = await call('/rpc/capture_lead', { method: 'POST', headers: { 'content-type': 'application/json', 'content-profile': 'service' }, body: '{}' });
  add('anon calling a service function is refused', '401/403/404/406', r.status, refused(r.status));
  r = await call('/rpc/lead_update', { method: 'POST', headers: { 'content-type': 'application/json', 'content-profile': 'service' }, body: '{}' });
  add('anon calling service.lead_update is refused', '401/403/404/406', r.status, refused(r.status));
  r = await call('/leads?select=id&limit=1');
  add('anon reading leads gets nothing', '401/403 or 0 rows', r.status, refused(r.status) || empty(r));
  r = await call('/api_keys?select=id&limit=1');
  add('anon reading the key registry gets nothing', '401/403 or 0 rows', r.status, refused(r.status) || empty(r));
  r = await call('/sites?select=id&limit=1');
  add('anon reading sites gets nothing', '401/403 or 0 rows', r.status, refused(r.status) || empty(r));

  const lines = checks.map(c => `${c.pass ? 'PASS' : 'FAIL'} ${c.name} (expected ${c.expected}, got ${c.status})`);
  const failed = checks.filter(c => !c.pass).length;
  return result(failed === 0, failed ? 'VERIFY-FAILED' : 'ok', { suite: 'walls', passed: checks.length - failed, failed, lines, checks, waiting: WALLS_WAITING });
}
