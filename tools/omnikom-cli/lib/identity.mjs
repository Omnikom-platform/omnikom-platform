// Identities (spec section 2). --as names who is calling.
//   Machine identities: site:<slug> (key in SITE_SIGNING_KEY_<SLUG>), runner (RUNNER_KEY), cron (CRON_SECRET). Keys are read by
//   variable name; a missing one is BLOCKED (exit 3).
//   Person identities: owner-a, member-a1, member-a2, owner-b, staff, nobody: the seeded test logins of workspaces A and B
//   (the fixtures of supabase/tests/tenancy.test.sql, created by `omnikom seed test`). On the SQL path a person is the JWT
//   claims the Edge Functions would pass to the service.* functions, so they work on a local database today. A real session
//   TOKEN for the HTTP path is BLOCKED until a staging project exists (UNVERIFIED which Auth admin call gives one).
import { Blocked, Usage } from './errors.mjs';

export const PERSONS = {
  'owner-a':   { sub: '00000000-0000-0000-0000-00000000000a', email: 'owner-a@test', workspace: 'a', aal: 'aal1' },
  'owner-b':   { sub: '00000000-0000-0000-0000-00000000000b', email: 'owner-b@test', workspace: 'b', aal: 'aal1' },
  'member-a1': { sub: '00000000-0000-0000-0000-0000000000a1', email: 'agent1-a@test', workspace: 'a', aal: 'aal1' },
  'member-a2': { sub: '00000000-0000-0000-0000-0000000000a2', email: 'agent2-a@test', workspace: 'a', aal: 'aal1' },
  staff:       { sub: '00000000-0000-0000-0000-00000000005f', email: 'staff@omnikom', workspace: null, aal: 'aal2' },   // staff act with MFA (aal2)
  nobody:      { sub: '00000000-0000-0000-0000-0000000000f0', email: null, workspace: null, aal: 'aal1' },               // a valid login that belongs to nothing
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

// A session token for a person, for the HTTP path (slice 2). BLOCKED on purpose: see the header of this file.
export function personToken(identity) {
  throw new Blocked(`a session token for ${identity.name} needs the staging Auth admin API (UNVERIFIED which call returns a usable access token without email)`,
    'the staging project must exist (build step 1.1); then verify generateLink + verifyOtp, or a password set on the test users only');
}
