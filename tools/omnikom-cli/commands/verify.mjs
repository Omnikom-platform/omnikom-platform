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
import { parseIdentity, machineKey, personToken, PERSONS } from '../lib/identity.mjs';
import { WS_A, WS_B } from './seed.mjs';
import { callFunction } from '../lib/fn.mjs';
import { loadFixture } from '../lib/fixtures.mjs';

export async function verify(ctx) {
  const f = ctx.flags;
  const only = f.only || 'lead';
  if (only === 'walls') return verifyWalls(ctx);
  if (only === 'people') return verifyPeople(ctx);
  if (only !== 'lead') throw new Usage('verify --only lead | walls | people (the suites grow with the functions)');
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
// nobody sees nothing) are in the `people` suite (verify --only people); the checks that need the slice 2 functions (lead-update,
// publish, add-lead) wait for those functions.
export const WALLS_WAITING = [
  'staff at aal2 reads the key registry (needs a TOTP factor on the staff test login)',
  'member A1 updates A2\'s lead -> S-NOT-FOUND (needs the lead-update function)',
  'member A1 publishes A2\'s listing -> S-OWN-ONLY (needs the publish function)',
  'a member adds a lead for someone else -> forced to themselves (needs the add-lead function)',
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

// verify --only people   what the Data API shows each seeded login (spec section 4, the person checks). A session token per login
// (lib/identity.mjs personToken: Auth admin generate_link + verify; in memory only), then reads and one write through PostgREST,
// where row-level security decides. Two leads are made for the run (one handed to member A1) and removed at the end.
// Needs: omnikom seed test (GoTrue-shaped logins), the publishable and secret keys by name, the database URL (fixtures only).
async function verifyPeople(ctx) {
  const target = ctx.target();
  if (!target.restBase) throw new Blocked('no Data API URL for this target (staging needs STAGING_SUPABASE_REF; local needs LOCAL_REST_BASE)', 'set the variable by name');
  const pubVar = target.vars.publishableKey;
  const pub = ctx.env[pubVar];
  if (!pub) throw new Blocked(`${pubVar} is not set (the anon key of the project, read by name)`, `set ${pubVar} in the environment`);
  const sql = ctx.sql();
  const a = ctx.site(ctx.flags['site-a'] || 'test-demo-a');
  const names = ['owner-a', 'owner-b', 'member-a1', 'member-a2', 'nobody'];
  const token = {};
  for (const n of names) token[n] = await personToken(parseIdentity(n), { target, env: ctx.env, fetchImpl: ctx.fetch });
  // staff act with MFA: the aal2 checks run when the staff TOTP secret is in the environment (omnikom mfa enroll-staff), else they wait
  const withStaff = Boolean(ctx.env.TEST_STAFF_TOTP_SECRET);
  if (withStaff) {
    token['staff-aal1'] = await personToken(parseIdentity('staff'), { target, env: ctx.env, fetchImpl: ctx.fetch, aal1: true, now: ctx.now });
    token.staff = await personToken(parseIdentity('staff'), { target, env: ctx.env, fetchImpl: ctx.fetch, now: ctx.now });
  }
  const waiting = withStaff ? WALLS_WAITING.filter(w => !w.startsWith('staff at aal2')) : WALLS_WAITING;

  const call = async (path, as, { method = 'GET', headers = {}, body } = {}) => {
    try {
      const res = await ctx.fetch(target.restBase.replace(/\/$/, '') + path, { method, headers: { apikey: pub, authorization: `Bearer ${token[as]}`, ...headers }, body, signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, json };
    } catch (e) { return { status: 0, json: null }; }
  };
  const idsOf = r => (r.status === 200 && Array.isArray(r.json)) ? r.json.map(x => x.id).sort() : null;
  const same = (got, want) => got !== null && JSON.stringify(got) === JSON.stringify([...want].sort());

  const made = [];
  const checks = [];
  const add = (name, expected, status, pass) => checks.push({ name, expected, status, pass: Boolean(pass), extra: '' });
  try {
    for (let i = 0; i < 2; i++) {
      const key = ctx.randomUUID();
      const r = sql.scalar(`select service.capture_lead(${uuidLit(a.id)}, 'contact', '/omnikom-cli-test', 'People Check ${i + 1}', 'people-check-${i + 1}@example.com', '+1 555 0100', '{}'::jsonb, 'The person agreed on the phone to be contacted', 'people', 'cli test', null, ${uuidLit(key)}, null, null, null)`);
      if (!r.ok || !r.value) throw new Blocked(`could not make the test leads (${r.code}: ${r.message})`, 'run omnikom seed test first');
      made.push(r.value);
    }
    const [L1, L2] = made;
    const up = sql.exec(`update leads set owner_team_row = (select team_row_id from members where workspace_id = ${uuidLit(WS_A)} and user_id = ${uuidLit(PERSONS['member-a1'].sub)}) where id = ${uuidLit(L1)};`);
    if (!up.ok) throw new Blocked(`could not hand the first test lead to member A1 (${up.code}: ${up.message})`, 'run omnikom seed test first');
    const q = `/leads?select=id&id=in.(${made.join(',')})`;

    let r = await call(q, 'owner-a');
    add("owner A reads A's leads (control: the token works)", 'both test leads', r.status, same(idsOf(r), made));
    r = await call(q, 'owner-b');
    add("owner B reads A's leads -> 0 rows", '200, 0 rows', r.status, same(idsOf(r), []));
    r = await call(q, 'member-a1');
    add('member A1 sees only their own lead', "200, the lead handed to them", r.status, same(idsOf(r), [L1]));
    r = await call(q, 'member-a2');
    add('member A2 sees neither lead', '200, 0 rows', r.status, same(idsOf(r), []));
    r = await call(q, 'nobody');
    add('a login that belongs to nothing sees no lead', '200, 0 rows', r.status, same(idsOf(r), []));
    r = await call('/workspaces?select=id', 'nobody');
    add('a login that belongs to nothing sees no workspace', '200, 0 rows', r.status, same(idsOf(r), []));
    r = await call('/workspaces?select=id', 'owner-b');
    add("owner B sees B's workspace and not A's", `200, [${WS_B}]`, r.status, same(idsOf(r), [WS_B]));
    r = await call('/api_keys?select=id&limit=5', 'owner-a');
    add('an owner reading the key registry gets nothing', '200, 0 rows', r.status, same(idsOf(r), []));
    r = await call('/api_keys?select=id&limit=5', 'member-a1');
    add('a member reading the key registry gets nothing', '200, 0 rows', r.status, same(idsOf(r), []));
    if (withStaff) {
      r = await call(q, 'staff');
      add('staff at aal2 read every lead (control: MFA session works)', 'both test leads', r.status, same(idsOf(r), made));
      r = await call('/api_keys?select=id&limit=5', 'staff');
      add('staff at aal2 read the key registry', '200, at least 1 row', r.status, r.status === 200 && Array.isArray(r.json) && r.json.length >= 1);
      r = await call(q, 'staff-aal1');
      add('staff without MFA (aal1) sees no lead', '200, 0 rows', r.status, same(idsOf(r), []));
      r = await call('/api_keys?select=id&limit=5', 'staff-aal1');
      add('staff without MFA (aal1) sees no key', '200, 0 rows', r.status, same(idsOf(r), []));
    }
    r = await call(`/leads?id=eq.${L1}`, 'owner-a', { method: 'PATCH', headers: { 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify({ status: 'closed' }) });
    const status = sql.scalar(`select status::text from leads where id = ${uuidLit(L1)}`).value;
    add('an owner cannot change a lead status directly (only through lead_update)', '401/403 and the status unchanged', r.status, (r.status === 401 || r.status === 403) && status !== 'closed');
    r = await call('/rpc/capture_lead', 'owner-a', { method: 'POST', headers: { 'content-type': 'application/json', 'content-profile': 'service' }, body: '{}' });
    add('a logged-in owner calling a service function is refused', '401/403/404/406', r.status, [401, 403, 404, 406].includes(r.status));
  } finally {
    for (const id of made) sql.exec(`delete from leads where id = ${uuidLit(id)};`);   // events cascade
  }
  const lines = checks.map(c => `${c.pass ? 'PASS' : 'FAIL'} ${c.name} (expected ${c.expected}, got ${c.status})`);
  const failed = checks.filter(c => !c.pass).length;
  return result(failed === 0, failed ? 'VERIFY-FAILED' : 'ok', { suite: 'people', passed: checks.length - failed, failed, lines, checks, waiting });
}
