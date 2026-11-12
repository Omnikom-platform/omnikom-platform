// Staging proof of the Settings backend (work order 08; migration 17; functions team-list, member-remove, invite-member with the mail, settings-save
// without the CRM part; crm-test removed). Synthetic data only.
//   SETTINGS_INVITE_EMAIL=<the address the head names> STAGING_SUPABASE_REF=... STAGING_DB_URL=... node supabase/tests/e2e-settings.mjs
// One PASS/FAIL line per check: team-list as owner-a (owners first, the shape) and as member-a1 and owner-b (both 404); member-remove of the last owner
// refused (409 S-LAST-OWNER) and nothing changed; then ONE of two member paths, and the same checks on it:
//   - SETTINGS_INVITE_EMAIL set (the one address the head names; a REAL mail goes out through Auth): invite-member, the person in the list, then removed;
//   - SETTINGS_INVITE_EMAIL not set: NO MAIL AT ALL. The line "SKIP: invite mail (C13) UNPROVEN: SETTINGS_INVITE_EMAIL not set" is printed (not a FAIL), the run makes
//     a synthetic login through the Auth admin API (email_confirm true: it sends nothing), makes it a member with service.set_member over STAGING_DB_URL_DIRECT,
//     lists it, proves its token reads workspace A before the removal and nothing of it after, removes it with member-remove, and deletes the login in the finally
//     (this run made it, so it may delete it).
// Then settings-save refuses a body that has only a crm key (400) and crm-test answers 404 (the function is deleted from the project).
// Cleanup in the `finally`: the invited or synthetic person is removed from workspace A as a member whatever happened; a login this run made through the
// real invite stays in Auth (no tool here deletes a login the invite made: INFO). Runs only against staging (stagingDbUrl refuses anything else); the
// read client is read-only; keys by variable name only.
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { claimsFor, parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { makeSql, jsonLit, lit, uuidLit } from '../../tools/omnikom-cli/lib/sql.mjs';
import { stagingDbUrl } from './e2e-cleanup.mjs';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const SITE_A = 'aaaaaaaa-0000-0000-0000-00000000517e';
const OWNER_A = '00000000-0000-0000-0000-00000000000a';
const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase) { console.error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)'); process.exit(3); }
let dbUrl;
try { dbUrl = stagingDbUrl(process.env); } catch (e) { console.error(e.message); process.exit(String(e.message).startsWith('BLOCKED') ? 3 : 2); }
const sql = makeSql({ url: dbUrl, readOnly: true });
const base = target.functionsBase.replace(/\/$/, ''), pub = process.env[target.vars.publishableKey];
const tokens = {};
const token = async (who) => tokens[who] ??= await personToken(parseIdentity(who), { target, env: process.env });
const INVITE = String(process.env.SETTINGS_INVITE_EMAIL ?? '').trim().toLowerCase();

let failed = 0, blocked = 0;
const line = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : '  ' + String(detail).slice(0, 300)}`); if (!ok) failed++; };
const info = (text) => console.log(`INFO ${text}`);
async function call(name, who, body) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${await token(who)}` };
  if (pub) headers.apikey = pub;
  try {
    const res = await fetch(`${base}/${name}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  } catch (e) { return { status: 0, text: String(e && e.message || e).slice(0, 120), json: null }; }
}
const members = async () => (await call('team-list', 'owner-a', { workspace: WS_A })).json?.members ?? [];
const memberRow = (userId) => { const r = sql.rows(`select role::text as role from public.members where workspace_id = '${WS_A}' and user_id = '${userId}'`); return r.ok ? r.rows[0] ?? null : undefined; };

const secret = process.env[target.vars.secretKey] ?? '';
const adminHeaders = { 'content-type': 'application/json', apikey: secret, authorization: `Bearer ${secret}` };
const authAdmin = async (method, path, body) => {
  try {
    const r = await fetch(`${target.authBase}${path}`, { method, headers: adminHeaders, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* none */ }
    return { status: r.status, json, text };
  } catch (e) { return { status: 0, json: null, text: String(e && e.message || e).slice(0, 120) }; }
};
/** a session access token for a login, made the way the Playwright support does it: Auth admin generate_link (sends nothing), then verify */
async function tokenFor(email) {
  const g = await authAdmin('POST', '/admin/generate_link', { type: 'magiclink', email });
  const hash = g.json?.hashed_token;
  if (g.status !== 200 || !hash) return null;
  try {
    const v = await fetch(`${target.authBase}/verify`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: pub ?? '' }, body: JSON.stringify({ type: 'magiclink', token_hash: hash }), signal: AbortSignal.timeout(30000) });
    return (await v.json())?.access_token ?? null;
  } catch { return null; }
}
/** how many rows of workspace A this token reads through the Data API (row-level security decides) */
async function readsOfA(accessToken) {
  const r = await fetch(`${target.restBase}/workspaces?select=id&id=eq.${WS_A}`, { headers: { apikey: pub ?? '', authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30000) });
  const rows = r.ok ? await r.json() : null;
  return Array.isArray(rows) ? rows.length : -1;
}

let invitedId = null, createdLogin = false, madeLogin = null, writeSql = null;
try {
  // 1. team-list: the owner lists, owners first, the documented shape; an agent and another workspace's owner are refused
  const l = await call('team-list', 'owner-a', { workspace: WS_A });
  const m = l.json?.members ?? [];
  line(l.status === 200 && m.length >= 3 && m[0].role === 'owner' && m[0].user === OWNER_A, 'team-list by owner-a is 200, owners first', `${l.status} ${l.text.slice(0, 200)}`);
  line(m.length > 0 && m.every((x) => Object.keys(x).sort().join() === 'email,joined,name,role,team_row,user' && typeof x.email === 'string' && !Number.isNaN(Date.parse(x.joined))),
    'every row holds exactly user, email, role, team_row, name, joined', JSON.stringify(m[0] ?? {}).slice(0, 200));
  line(m.some((x) => x.name === 'Agent One' && x.role === 'member'), 'a member carries the name of their team profile (Agent One)', JSON.stringify(m.map((x) => x.name)).slice(0, 200));
  const a1 = await call('team-list', 'member-a1', { workspace: WS_A });
  line(a1.status === 404 && a1.json?.code === 'S-NOT-FOUND', 'team-list by member-a1 is 404 S-NOT-FOUND', `${a1.status} ${a1.text.slice(0, 120)}`);
  const ob = await call('team-list', 'owner-b', { workspace: WS_A });
  line(ob.status === 404, 'team-list by owner-b on A is 404', `${ob.status} ${ob.text.slice(0, 120)}`);

  // 2. the last owner cannot be removed; nothing changes
  const before = (await members()).length;
  const last = await call('member-remove', 'owner-a', { workspace: WS_A, user: OWNER_A });
  line(last.status === 409 && last.json?.code === 'S-LAST-OWNER', 'member-remove of the last owner is 409 S-LAST-OWNER', `${last.status} ${last.text.slice(0, 160)}`);
  line((await members()).length === before && (await members())[0]?.user === OWNER_A, 'and nobody was removed', `${before} before`);
  const byAgent = await call('member-remove', 'member-a1', { workspace: WS_A, user: OWNER_A });
  line(byAgent.status === 404, 'member-remove by member-a1 is 404', `${byAgent.status} ${byAgent.text.slice(0, 120)}`);

  // 3. a marked member joins and is removed again. With SETTINGS_INVITE_EMAIL the real invite path runs (a real mail goes to that address only); without it
  //    nothing is sent: a synthetic login is made through the Auth admin API and made a member by service.set_member
  if (INVITE) {
    const had = sql.rows(`select id from auth.users where lower(email) = '${INVITE.replace(/'/g, "''")}'`);
    createdLogin = had.ok && had.rows.length === 0;
    const inv = await call('invite-member', 'owner-a', { workspace: WS_A, email: INVITE, role: 'member' });
    invitedId = inv.json?.user ?? null;
    line(inv.status === 200 && inv.json?.invited === true && typeof inv.json?.email_sent === 'boolean' && typeof invitedId === 'string' && !/action_link|token|http/.test(inv.text),
      'invite-member is 200 { user, invited: true, email_sent: <Auth\'s answer> } and no link', `${inv.status} ${inv.text.slice(0, 200)}`);
    info(`email_sent was ${inv.json?.email_sent} (true: Auth accepted the mail for ${createdLogin ? 'a NEW login: the invite mail' : 'an existing login: the sign-in mail, or the invite again if it never opened its invite'})`);
  } else {
    console.log('SKIP: invite mail (C13) UNPROVEN: SETTINGS_INVITE_EMAIL not set');
    let directUrl = null;
    try { directUrl = stagingDbUrl({ ...process.env, STAGING_DB_URL: process.env.STAGING_DB_URL_DIRECT }); } catch (e) { blocked++; console.log(`BLOCKED the marked member: ${e.message.replace('STAGING_DB_URL is not set', 'STAGING_DB_URL_DIRECT is not set')}`); }
    if (directUrl && !secret) { blocked++; console.log(`BLOCKED the marked member: ${target.vars.secretKey} is not set (read by name)`); }
    else if (directUrl) {
      writeSql = makeSql({ url: directUrl });
      const email = `e2e-settings-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}@omnikom.test`;
      const made = await authAdmin('POST', '/admin/users', { email, email_confirm: true });
      madeLogin = made.json?.id ?? null;
      line(made.status === 200 && typeof madeLogin === 'string', 'Auth admin made a synthetic login (email_confirm true: it sends nothing)', `${made.status} ${made.text.slice(0, 160)}`);
      if (madeLogin) {
        invitedId = madeLogin;
        const sm = writeSql.exec(`select service.set_member(${jsonLit(claimsFor(parseIdentity('owner-a')))}, ${lit(WS_A)}::uuid, ${uuidLit(madeLogin)}, 'member'::public.member_role, null);`);
        line(sm.ok, 'service.set_member makes it a member of workspace A (the owner\'s claims, over STAGING_DB_URL_DIRECT)', `${sm.code ?? ''} ${sm.message ?? ''}`);
        const listed = (await members()).find((x) => x.user === invitedId);
        line(Boolean(listed) && listed.role === 'member' && listed.email.toLowerCase() === email, 'the person is in the team list as a member', JSON.stringify(listed ?? null));
        const tok = await tokenFor(email);
        const before = tok ? await readsOfA(tok) : -1;
        line(before === 1, 'before the removal their token reads workspace A (1 row)', `${before}`);
        const asMember = await fetch(`${base}/team-list`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, ...(pub ? { apikey: pub } : {}) }, body: JSON.stringify({ workspace: WS_A }), signal: AbortSignal.timeout(60000) }).then((r) => r.status, () => 0);
        line(asMember === 404, 'and team-list with that token is 404 (a member is not an owner)', `${asMember}`);
        const rm = await call('member-remove', 'owner-a', { workspace: WS_A, user: invitedId });
        line(rm.status === 200 && rm.json?.removed === true, 'member-remove of the marked member is 200 { removed: true }', `${rm.status} ${rm.text.slice(0, 120)}`);
        line(!(await members()).some((x) => x.user === invitedId), 'and they are gone from the list');
        const after = tok ? await readsOfA(tok) : -2;
        line(after === 0, 'their next read in workspace A with the same token finds nothing (the wall; open sessions are not ended)', `${after}`);
        const again = await call('member-remove', 'owner-a', { workspace: WS_A, user: invitedId });
        line(again.status === 404, 'removing them again is 404', `${again.status} ${again.text.slice(0, 120)}`);
      }
    }
  }
  if (INVITE && invitedId) {
    const listed = (await members()).find((x) => x.user === invitedId);
    line(Boolean(listed) && listed.role === 'member' && listed.email.toLowerCase() === INVITE, 'the person is in the team list as a member', JSON.stringify(listed ?? null));
    const rm = await call('member-remove', 'owner-a', { workspace: WS_A, user: invitedId });
    line(rm.status === 200 && rm.json?.removed === true, 'member-remove of the invited member is 200 { removed: true }', `${rm.status} ${rm.text.slice(0, 120)}`);
    line(!(await members()).some((x) => x.user === invitedId), 'and they are gone from the list');
    const again = await call('member-remove', 'owner-a', { workspace: WS_A, user: invitedId });
    line(again.status === 404, 'removing them again is 404', `${again.status} ${again.text.slice(0, 120)}`);
  }

  // 4. settings-save has no CRM part; crm-test is gone
  const crm = await call('settings-save', 'owner-a', { workspace: WS_A, crm: { url: 'https://hooks.example.com/x' } });
  line(crm.status === 400, 'settings-save with only a crm key is 400', `${crm.status} ${crm.text.slice(0, 160)}`);
  const ct = await call('crm-test', 'owner-a', { workspace: WS_A });
  line(ct.status === 404, 'crm-test answers 404: the function is no longer deployed', `${ct.status} ${ct.text.slice(0, 160)}`);
  const al = await call('settings-save', 'owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['not-an-email'] } });
  line(al.status === 422 && al.json?.code === 'I-EMAIL', 'settings-save with a bad alert address is 422 I-EMAIL', `${al.status} ${al.text.slice(0, 160)}`);
} catch (e) {
  line(false, 'the run', String(e && e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 300));
} finally {
  // the invited or synthetic person is not left a member of workspace A, whatever happened above
  if (invitedId && memberRow(invitedId)) {
    const r = await call('member-remove', 'owner-a', { workspace: WS_A, user: invitedId });
    line(r.status === 200 || r.status === 404, 'cleanup: the marked person is no longer a member of workspace A', `${r.status} ${r.text.slice(0, 120)}`);
  }
  if (madeLogin) {   // this run made it through the Auth admin API, so this run deletes it
    const d = await authAdmin('DELETE', `/admin/users/${madeLogin}`);
    line(d.status === 200, 'cleanup: the synthetic login was deleted through the Auth admin API', `${d.status} ${d.text.slice(0, 120)}`);
  }
  if (createdLogin && invitedId) info(`the login ${invitedId} was made by this run's real invite and stays in Auth (no tool here deletes it); remove it in the Supabase dashboard if it should not stay`);
}
console.log(`\n${failed ? 'FAILED' : blocked ? 'BLOCKED' : 'PASS'}: Settings backend on staging, ${failed} problem(s)${blocked ? `, ${blocked} blocked step(s)` : ''}`);
process.exit(failed ? 1 : blocked ? 3 : 0);
