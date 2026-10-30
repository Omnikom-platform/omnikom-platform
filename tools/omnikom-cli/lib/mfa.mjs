// The Auth MFA API for the staff test login (staff policies need an aal2 session: private.is_staff() reads the aal claim).
//   enrollStaffFactor   makes a TOTP factor for the logged-in user and returns { factorId, secret } (the secret is the caller's to
//                       store; it is registered with the redaction here)
//   aal2Session         challenge + verify with a code computed from the secret -> an access token whose aal claim is aal2
// Every call goes through fetchImpl (a test passes a fake). An answer that is not 2xx is BLOCKED with GoTrue's own code, cut short.
import { Blocked } from './errors.mjs';
import { registerSecret } from './redact.mjs';
import { totp } from './totp.mjs';

async function authCall(target, env, fetchImpl, path, { method = 'POST', token, admin = false, body } = {}) {
  const pub = env[target.vars.publishableKey], secret = env[target.vars.secretKey];
  const key = admin ? secret : pub;
  if (!key) throw new Blocked(`${admin ? target.vars.secretKey : target.vars.publishableKey} is not set (read by name)`, 'set it in the environment');
  const headers = { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${admin ? secret : token}` };
  try {
    const res = await fetchImpl(target.authBase.replace(/\/$/, '') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  } catch (e) { return { status: 0, json: null, text: `network: ${String(e && e.message || e).slice(0, 120)}` }; }
}
const why = r => String((r.json && (r.json.msg || r.json.message || r.json.error_description)) || r.text || '').slice(0, 160);
const need2xx = (r, what) => { if (r.status < 200 || r.status > 299) throw new Blocked(`${what} answered ${r.status}: ${why(r)}`, 'stop after two failed approaches and report the answer'); return r; };

export async function listFactors({ target, env, fetchImpl, token }) {
  const r = need2xx(await authCall(target, env, fetchImpl, '/user', { method: 'GET', token }), 'Auth user lookup');
  return (r.json && Array.isArray(r.json.factors)) ? r.json.factors : [];
}

export async function deleteFactor({ target, env, fetchImpl, userId, factorId }) {
  return need2xx(await authCall(target, env, fetchImpl, `/admin/users/${userId}/factors/${factorId}`, { method: 'DELETE', admin: true }), 'Auth factor delete');
}

export async function enrollStaffFactor({ target, env, fetchImpl, token, name }) {
  const r = need2xx(await authCall(target, env, fetchImpl, '/factors', { token, body: { factor_type: 'totp', friendly_name: name, issuer: 'Omnikom CLI' } }), 'Auth factor enroll');
  const secret = r.json && r.json.totp && r.json.totp.secret;
  if (!r.json || !r.json.id || !secret) throw new Blocked('Auth factor enroll answered without a factor id or secret', 'report the answer shape');
  registerSecret(secret, 'staff totp secret');
  return { factorId: r.json.id, secret };
}

export async function aal2Session({ target, env, fetchImpl, token, factorId, secret, now = Date.now() / 1000 }) {
  const c = need2xx(await authCall(target, env, fetchImpl, `/factors/${factorId}/challenge`, { token, body: {} }), 'Auth MFA challenge');
  if (!c.json || !c.json.id) throw new Blocked('Auth MFA challenge answered without a challenge id', 'report the answer shape');
  const v = need2xx(await authCall(target, env, fetchImpl, `/factors/${factorId}/verify`, { token, body: { challenge_id: c.json.id, code: totp(secret, now) } }), 'Auth MFA verify');
  if (!v.json || !v.json.access_token) throw new Blocked('Auth MFA verify answered without a session', 'report the answer shape');
  registerSecret(v.json.access_token, 'staff aal2 session token');
  return v.json.access_token;
}
