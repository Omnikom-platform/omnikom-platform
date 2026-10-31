// _shared/auth.ts: the second wall. A token signed by a generated ES256 key against a JWKS served by the harness; a wrong key, an expired
// token, a wrong audience, a non-uuid subject and a made-up algorithm are each refused.
import { verifyUserJwt, resetJwksCache, sqlClaims } from '../_shared/auth.ts';
import { assert, env, eq, mint, SUB, t } from './util.ts';

const jwksUrl = () => env('JWKS_URL');
const req = (token: string | null) => new Request('http://localhost/x', { headers: token ? { authorization: `Bearer ${token}` } : {} });
const verify = (token: string | null, o: { fetchImpl?: typeof fetch; now?: () => number } = {}) => verifyUserJwt(req(token), { jwksUrl: jwksUrl(), ...o });

t('auth: a token signed by the project key is accepted and gives sub, aal, role', async () => {
  resetJwksCache();
  const c = await verify(await mint('owner-a'));
  assert(c, 'a good token is accepted');
  eq(c.sub, SUB['owner-a'], 'sub');
  eq(c.aal, 'aal1', 'aal');
  eq(c.role, 'authenticated', 'role');
});

t('auth: the claims handed to SQL are exactly sub, aal, role, email', async () => {
  resetJwksCache();
  const c = await verify(await mint('staff'));
  assert(c, 'accepted');
  eq(JSON.stringify(Object.keys(sqlClaims(c)).sort()), JSON.stringify(['aal', 'email', 'role', 'sub']), 'the keys');
  eq(sqlClaims(c).aal, 'aal2', 'the aal value reaches SQL (private.is_staff reads it)');
});

t('auth: a token signed by another key (same kid) is refused', async () => {
  resetJwksCache();
  const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  eq(await verify(await mint('owner-a', { key: other.privateKey })), null, 'wrong key');
});

t('auth: an expired token is refused', async () => {
  resetJwksCache();
  eq(await verify(await mint('owner-a', { exp: Math.floor(Date.now() / 1000) - 10 })), null, 'expired');
});

t('auth: a token for another audience is refused', async () => {
  resetJwksCache();
  eq(await verify(await mint('owner-a', { aud: 'anon' })), null, 'aud anon');
  assert(await verify(await mint('owner-a', { aud: ['x', 'authenticated'] })), 'an audience list that includes authenticated is accepted');
});

t('auth: a subject that is not a uuid is refused', async () => {
  resetJwksCache();
  eq(await verify(await mint('owner-a', { sub: 'not-a-uuid' })), null, 'sub');
});

t('auth: no token, a malformed token, and other algorithms are refused', async () => {
  resetJwksCache();
  eq(await verify(null), null, 'no header');
  eq(await verify('abc.def'), null, 'two parts');
  eq(await verify(await mint('owner-a', { alg: 'none' })), null, 'alg none');
  eq(await verify(await mint('owner-a', { alg: 'HS256' })), null, 'alg HS256');
});

t('auth: a token whose kid is unknown is refused, after one refetch of the keys', async () => {
  resetJwksCache();
  let fetched = 0;
  const counting: typeof fetch = (u, i) => { fetched++; return fetch(u, i); };
  eq(await verify(await mint('owner-a', { kid: 'rotated-away' }), { fetchImpl: counting }), null, 'unknown kid');
  eq(fetched, 2, 'one fetch to fill the cache and one more for the unknown kid');
  eq(await verify(await mint('owner-a', { kid: 'another-unknown' }), { fetchImpl: counting }), null, 'a second unknown kid');
  eq(fetched, 2, 'forged kids cannot turn into a stream of fetches (30 s gap)');
});

t('auth: the keys are cached (a second token costs no fetch)', async () => {
  resetJwksCache();
  let fetched = 0;
  const counting: typeof fetch = (u, i) => { fetched++; return fetch(u, i); };
  assert(await verify(await mint('owner-a'), { fetchImpl: counting }), 'first');
  assert(await verify(await mint('owner-b'), { fetchImpl: counting }), 'second');
  eq(fetched, 1, 'one fetch');
});

t('auth: when the JWKS cannot be fetched and nothing is cached, nobody is verified', async () => {
  resetJwksCache();
  const down: typeof fetch = () => Promise.reject(new Error('down'));
  eq(await verify(await mint('owner-a'), { fetchImpl: down }), null, 'fails closed');
});
