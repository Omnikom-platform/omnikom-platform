// Shared by publish.mjs and media.mjs: reading the environment by name, scrubbing every printed line, and the signed calls to the
// platform's Edge Functions. Every fetch has a timeout, a call is retried a little on a network error or a 502/503/504 (a job's
// calls are idempotent: freeze_snapshot returns the same snapshot, a state callback is refused with 409 if it was already taken).
// Nothing here prints a secret: the caller builds `scrub` from the secret values and every line goes through it.
import { sign } from './sign.mjs';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// A media path comes from the platform's export: relative, no "..", no empty or "." segment, no backslash (the factory refuses the same).
export function safeRelPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.startsWith('/')) return false;
  return !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

// The platform base must be https (plain http only for a loopback address: the tests' fake platform).
export function checkBase(base) {
  let u;
  try { u = new URL(base); } catch { return 'PLATFORM_FUNCTIONS_BASE is not a URL'; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return 'PLATFORM_FUNCTIONS_BASE must be https';
  return null;
}

// Replaces every secret value, the project ref (<ref>.supabase.co), signed-URL tokens and JWT-shaped strings in a printed line.
export function makeScrubber(values, base) {
  const secrets = [...new Set(values.filter((v) => typeof v === 'string' && v.length >= 4))].sort((a, b) => b.length - a.length);
  let ref = null;
  try { const m = /^([a-z0-9]{8,})\.supabase\.co$/i.exec(new URL(base).hostname); ref = m ? m[1] : null; } catch { /* no ref */ }
  return (s) => {
    let t = String(s ?? '');
    for (const v of secrets) t = t.split(v).join('<secret>');
    if (ref) t = t.split(ref).join('<project ref>');
    t = t.replace(/([?&](?:token|sig|signature|apikey|X-Amz-Signature)=)[^&\s"'<>]+/gi, '$1<redacted>');
    t = t.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, '<jwt>');
    return t;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_STATUS = new Set([502, 503, 504]);

// makePlatform({ base, key, timeoutMs, retries, backoffMs }) -> { call(method, pathWithQuery, bodyString) -> { status, text, error? } }
// pathWithQuery is what follows the base ("/export-published?job=<id>"): the base's own /functions/v1 is never part of the signature.
export function makePlatform({ base, key, timeoutMs = 30000, retries = 3, backoffMs = 1000 }) {
  const root = base.replace(/\/+$/, '');
  return {
    async call(method, pathWithQuery, body = '') {
      let last = null;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const headers = { 'x-runner-signature': await sign(key, method, pathWithQuery, method === 'GET' ? '' : body) };
          if (method !== 'GET') headers['content-type'] = 'application/json';
          const res = await fetch(root + pathWithQuery, { method, headers, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(timeoutMs) });
          const text = await res.text();
          if (RETRY_STATUS.has(res.status) && attempt < retries) { last = new Error(`HTTP ${res.status}`); await sleep(backoffMs * attempt); continue; }
          return { status: res.status, text };
        } catch (e) {
          last = e;
          if (attempt < retries) await sleep(backoffMs * attempt);
        }
      }
      return { status: 0, text: '', error: String(last && last.name === 'TimeoutError' ? 'timeout' : (last && last.message) || last).slice(0, 120) };
    },
  };
}

export const numEnv = (name, dflt) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : dflt; };
