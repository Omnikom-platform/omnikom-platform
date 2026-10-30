// Identities (spec section 2). --as names who is calling.
//   Machine identities: site:<slug> (key in SITE_SIGNING_KEY_<SLUG>), runner (RUNNER_KEY), cron (CRON_SECRET). Keys are read by
//   variable name; a missing one is BLOCKED (exit 3).
//   Person identities: owner-a, member-a1, member-a2, owner-b, staff, nobody: the seeded test logins of workspaces A and B
//   (the fixtures of supabase/tests/tenancy.test.sql, created by `omnikom seed test`). On the SQL path a person is the JWT
//   claims the Edge Functions would pass to the service.* functions, so they work on a local database today. A real session
//   TOKEN for the HTTP path comes from personToken (Auth admin generate_link + verify), proven on staging 2026-10-30.
import { Blocked, Usage } from './errors.mjs';
import { registerSecret } from './redact.mjs';
import { listFactors, aal2Session } from './mfa.mjs';

export const PERSONS = {
  'owner-a':   { sub: '00000000-0000-0000-0000-00000000000a', email: 'owner-a@test', workspace: 'a', aal: 'aal1' },
  'owner-b':   { sub: '00000000-0000-0000-0000-00000000000b', email: 'owner-b@test', workspace: 'b', aal: 'aal1' },
  'member-a1': { sub: '00000000-0000-0000-0000-0000000000a1', email: 'agent1-a@test', workspace: 'a', aal: 'aal1' },
  'member-a2': { sub: '00000000-0000-0000-0000-0000000000a2', email: 'agent2-a@test', workspace: 'a', aal: 'aal1' },
  staff:       { sub: '00000000-0000-0000-0000-00000000005f', email: 'staff@omnikom', workspace: null, aal: 'aal2' },   // staff act with MFA (aal2)
  nobody:      { sub: '00000000-0000-0000-0000-0000000000f0', email: 'nobody@test', workspace: null, aal: 'aal1' },       // a valid login that belongs to nothing
};

export const siteVar = slug => `SITE_SIGNING_KEY_${slug.toUpperCase().replace(/-/g, '_')}`;

export function parseIdentity(spec) {
  if (!spec || spec === true) throw new Usage('--as is required for this command');
  if (PERSONS[spec]) return { kind: 'person', name: spec, ...PERSONS[spec] };
  if (spec === 'runner') return { kind: 'runner', name: 'runner', keyVar: 'RUNNER_KEY' };
  if (spec === 'cron') return { kind: 'cron', name: 'cron', keyVar: 'CRON_SECRET' };
  const m = /^site:([a-z0-9]+(-[a-z0-9]+)*)$/.exec(spec);
  if (m) return { kind: 'site', name: spec, slug: m[1], keyVar: siteVar(m[1]) };
  throw new Usage(`--as '${spec}' is not an identity (owner-a, owner-b, member-a1, member-a2, staff, nobody, site:<slug>, runner, cron)`);
}

export function claimsFor(identity) {
  if (identity.kind !== 'person') throw new Usage(`${identity.name} is a machine identity: it has no login claims`);
  return { sub: identity.sub, aal: identity.aal, role: 'authenticated' };
}

// The secret a machine identity signs with. The variable's NAME goes in the message, never its value.
export function machineKey(identity, env = process.env) {
  const value = env[identity.keyVar];
  if (!value) throw new Blocked(`${identity.keyVar} is not set (the key of ${identity.name}, read by name)`, identity.kind === 'site' ? `mint one with: omnikom key mint --site ${identity.slug}` : `set ${identity.keyVar} in the environment`);
  return value;
}

// A session token for a person, for the HTTP path: the Auth admin API makes a magic-link token for the seeded login (no email is
// sent), and the token hash is traded for a session at /verify. Needs the seeded logins to be GoTrue-shaped (seed test writes them so;
// found 2026-10-30: rows with only (id, email) cannot be found by GoTrue). The token lives in memory for the run and is registered
// with lib/redact.mjs; an answer from GoTrue that is not a 200 is BLOCKED with its code (cut short), never a workaround.
// The three keys are read by name from the environment: <TARGET>_SUPABASE_SECRET_KEY (admin call), _PUBLISHABLE_KEY (verify).

export async function personToken(identity, { target, env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 30000, aal1 = false, now = () => Date.now() / 1000 } = {}) {
  if (identity.kind !== 'person') throw new Usage(`${identity.name} is a machine identity: it has no login`);
  if (!identity.email) throw new Blocked(`${identity.name} has no login email`, 'it is not one of the seeded test logins');
  if (!target || !target.authBase) throw new Blocked('no Auth URL for this target (staging needs STAGING_SUPABASE_REF; local has no Auth service)', 'use --target staging');
  const secretVar = target.vars.secretKey, pubVar = target.vars.publishableKey;
  const secret = env[secretVar], pub = env[pubVar];
  if (!secret) throw new Blocked(`${secretVar} is not set (the Auth admin key, read by name)`, `set ${secretVar} in the environment`);
  if (!pub) throw new Blocked(`${pubVar} is not set (the anon key, read by name)`, `set ${pubVar} in the environment`);
  const call = async (path, headers, body) => {
    try {
      const res = await fetchImpl(target.authBase.replace(/\/$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, json, text };
    } catch (e) { return { status: 0, json: null, text: `network: ${String(e && e.message || e).slice(0, 120)}` }; }
  };
  const why = r => (r.json && (r.json.msg || r.json.message || r.json.error_description || r.json.error)) ? String(r.json.msg || r.json.message || r.json.error_description || r.json.error).slice(0, 160) : r.text.slice(0, 100);
  const g = await call('/admin/generate_link', { apikey: secret, authorization: `Bearer ${secret}` }, { type: 'magiclink', email: identity.email });
  if (g.status !== 200 || !g.json || !g.json.hashed_token) throw new Blocked(`a session for ${identity.name}: Auth generate_link answered ${g.status}: ${why(g)}`, 'run omnikom seed test (the logins must be written the way GoTrue reads them); stop after two failed approaches');
  registerSecret(g.json.hashed_token, 'magic-link token hash');
  const v = await call('/verify', { apikey: pub }, { type: 'magiclink', token_hash: g.json.hashed_token });
  if (v.status !== 200 || !v.json || !v.json.access_token) throw new Blocked(`a session for ${identity.name}: Auth verify answered ${v.status}: ${why(v)}`, 'stop after two failed approaches and report the answer');
  registerSecret(v.json.access_token, `session token ${identity.name}`);
  const token = v.json.access_token;
  if (identity.aal !== 'aal2' || aal1) return token;
  // staff act with MFA: bring the session to aal2 with the TOTP factor of the staff test login (secret by name: TEST_STAFF_TOTP_SECRET)
  const totpSecret = env.TEST_STAFF_TOTP_SECRET;
  if (!totpSecret) throw new Blocked('TEST_STAFF_TOTP_SECRET is not set (the TOTP secret of the staff test login, read by name)', 'run: omnikom mfa enroll-staff --target staging');
  const factor = (await listFactors({ target, env, fetchImpl, token })).find(x => x.factor_type === 'totp' && x.status === 'verified');
  if (!factor) throw new Blocked('the staff test login has no verified TOTP factor', 'run: omnikom mfa enroll-staff --target staging');
  return aal2Session({ target, env, fetchImpl, token, factorId: factor.id, secret: totpSecret, now: now() });
}
