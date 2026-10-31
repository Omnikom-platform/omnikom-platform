// The second wall for a dashboard call (slice 4.2). The gateway (verify_jwt = true, supabase/config.toml) is the first: it only lets a
// request through whose JWT it accepted. This file checks the same token again, in code, against the project's JWKS, so a function that
// is ever deployed with verify_jwt off, or reached some other way, still answers 401 to a forged or expired token.
//   verifyUserJwt(req, { jwksUrl, now, fetchImpl }) -> { sub, aal, exp, aud, role, email, ... } or null
// ES256 and RS256 only (Web Crypto; no library). Checks: the signature against the key whose kid the header names, exp not passed,
// nbf not in the future, aud includes "authenticated", sub is a uuid. The JWKS is kept in module scope for 10 minutes and fetched again
// once when a token names a kid the cache does not know (a key rotation), but not more often than every 30 seconds, so a stream of
// forged kids cannot turn into a stream of fetches.
// What SQL gets is exactly { sub, aal, role, email } (sqlClaims): the aal value is what private.is_staff() reads (aal2 = MFA).
export type Claims = { sub: string; aal: string; exp: number; aud: string | string[]; role: string; email?: string; [k: string]: unknown };
export type VerifyOptions = { jwksUrl: string; now?: () => number; fetchImpl?: typeof fetch };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 10 * 60 * 1000;
const REFETCH_GAP_MS = 30 * 1000;
type Jwk = { kid?: string; kty?: string; alg?: string; [k: string]: unknown };
type Cache = { at: number; keys: Jwk[]; imported: Map<string, CryptoKey>; lastForced: number };
const caches = new Map<string, Cache>();

/** Forget the cached keys (tests only). */
export function resetJwksCache(): void { caches.clear(); }

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(t);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const decodeJson = (s: string): unknown => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function fetchKeys(url: string, fetchImpl: typeof fetch): Promise<Jwk[] | null> {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) { await r.body?.cancel(); return null; }
    const j = await r.json();
    return Array.isArray(j?.keys) ? j.keys as Jwk[] : null;
  } catch { return null; }
}

async function keysFor(url: string, kid: string | null, fetchImpl: typeof fetch): Promise<Cache | null> {
  let c = caches.get(url);
  const fresh = (x: Cache | undefined) => !!x && Date.now() - x.at < TTL_MS;
  if (!fresh(c)) {
    const keys = await fetchKeys(url, fetchImpl);
    if (keys) { c = { at: Date.now(), keys, imported: new Map(), lastForced: c?.lastForced ?? 0 }; caches.set(url, c); }
    else if (!c) return null;                                    // no cache and no answer: nobody is verified
  }
  const known = (x: Cache) => kid === null ? x.keys.length > 0 : x.keys.some(k => k.kid === kid);
  if (c && !known(c) && Date.now() - c.lastForced > REFETCH_GAP_MS) {   // an unknown kid: the keys may have rotated, look once
    const keys = await fetchKeys(url, fetchImpl);
    if (keys) c = { at: Date.now(), keys, imported: new Map(), lastForced: Date.now() }; else c = { ...c, lastForced: Date.now() };
    caches.set(url, c);
  }
  return c ?? null;
}

async function importKey(c: Cache, jwk: Jwk, alg: string): Promise<CryptoKey | null> {
  const id = `${jwk.kid ?? ''}|${alg}`;
  const hit = c.imported.get(id);
  if (hit) return hit;
  try {
    const algo = alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    if (alg === 'ES256' && jwk.kty !== 'EC') return null;
    if (alg === 'RS256' && jwk.kty !== 'RSA') return null;
    const { kid: _kid, alg: _alg, use: _use, key_ops: _ops, ...rest } = jwk as Record<string, unknown>;
    const key = await crypto.subtle.importKey('jwk', rest as JsonWebKey, algo, false, ['verify']);
    c.imported.set(id, key);
    return key;
  } catch { return null; }
}

export async function verifyUserJwt(req: Request, opts: VerifyOptions): Promise<Claims | null> {
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec((req.headers.get('authorization') ?? '').trim());
  if (!m) return null;
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try { header = decodeJson(m[1]) as Record<string, unknown>; payload = decodeJson(m[2]) as Record<string, unknown>; } catch { return null; }
  if (!header || !payload || typeof header !== 'object' || typeof payload !== 'object') return null;
  const alg = header.alg;
  if (alg !== 'ES256' && alg !== 'RS256') return null;           // never "none", never HS256 (no shared secret is verified here)
  const kid = typeof header.kid === 'string' ? header.kid : null;
  const cache = await keysFor(opts.jwksUrl, kid, fetchImpl);
  if (!cache) return null;
  const candidates = cache.keys.filter(k => kid === null ? true : k.kid === kid);
  const data = new TextEncoder().encode(`${m[1]}.${m[2]}`);
  const sig = b64urlToBytes(m[3]);
  let ok = false;
  for (const jwk of candidates) {
    const key = await importKey(cache, jwk, alg);
    if (!key) continue;
    try {
      const algo = alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
      if (await crypto.subtle.verify(algo, key, sig, data)) { ok = true; break; }
    } catch { /* a malformed signature is a failed one */ }
  }
  if (!ok) return null;
  const exp = payload.exp;
  if (typeof exp !== 'number' || !(exp > now)) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 5) return null;
  const aud = payload.aud;
  if (!(aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated')))) return null;
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) return null;
  return { ...payload, sub: payload.sub.toLowerCase(), aal: typeof payload.aal === 'string' ? payload.aal : 'aal1', exp, aud: aud as string | string[],
    role: typeof payload.role === 'string' ? payload.role : 'authenticated', email: typeof payload.email === 'string' ? payload.email : undefined };
}

/** The claims handed to SQL: exactly sub, aal, role, email (private.is_staff() reads aal). */
export function sqlClaims(c: Claims): { sub: string; aal: string; role: string; email: string | null } {
  return { sub: c.sub, aal: c.aal, role: c.role, email: c.email ?? null };
}
