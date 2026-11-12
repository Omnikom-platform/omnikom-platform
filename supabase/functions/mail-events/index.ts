// mail-events: Resend's webhook for a bounced or complained email (product row E21, migration 31). Caller: Resend, which posts each event signed the Svix way: the headers
// svix-id, svix-timestamp and svix-signature (HMAC-SHA256 over "<id>.<timestamp>.<raw body>", keyed with the base64 part of the secret after whsec_, base64 out, the header
// one or more "v1,<signature>" separated by spaces). No user login: verify_jwt = false (supabase/config.toml), so the signature is the wall; the secret is read by the name
// RESEND_WEBHOOK_SECRET, a timestamp more than TOLERANCE_S seconds off is refused (the repo's own window, _shared/signature.ts; Svix names none).
// A permanent bounce (email.bounced, bounce type Permanent) or a spam complaint (email.complained) calls service.mail_event(email id, kind): the address is read from our own
// message that Resend's email id names, never from the payload; a bounce suppresses it for the whole platform, a complaint for that message's workspace. Any other signed
// event is answered 200 { handled: false }, so Resend does not send it again.
// Keys by name only: RESEND_WEBHOOK_SECRET, SUPABASE_DB_URL.
// Answers: 405 METHOD (not POST); 500 CONFIG (the secret missing or not base64, or the database role); 401 SIGNATURE (and a security event); 200 { handled: false } or
// { handled: true, suppressed: n } (n is 1 for an email id of ours, 0 for none); 500 SERVER. Tests: supabase/functions/test/mail-events.test.ts; the database side:
// tenancy.test.sql T37.
import { connect, ConfigError, recordEvent, type Sql } from '../_shared/db.ts';
import { json, problem } from '../_shared/http.ts';

export const TOLERANCE_S = 300;

// constant-time comparison of two strings (as sameHex in _shared/signature.ts)
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** the key bytes: the base64 part of the secret after whsec_, or null when it is not base64 or is empty */
export function secretBytes(secret: string): Uint8Array<ArrayBuffer> | null {
  try {
    const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0));
    return raw.length ? raw : null;
  } catch { return null; }
}

export async function svixValid(key: Uint8Array<ArrayBuffer>, id: string | null, ts: string | null, header: string | null, body: string, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!id || !ts || !header || !/^\d{1,12}$/.test(ts) || Math.abs(now - Number(ts)) > TOLERANCE_S) return false;
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  let bin = '';
  for (const b of mac) bin += String.fromCharCode(b);
  const want = btoa(bin);
  return header.split(' ').some(s => s.startsWith('v1,') && same(s.slice(3), want));
}

type Ev = { type?: unknown; data?: { email_id?: unknown; bounce?: { type?: unknown } } } | null;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return problem(405, 'METHOD', 'POST only.');
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!secret) return problem(500, 'CONFIG', 'Not configured.');
  const key = secretBytes(secret);
  if (!key) return problem(500, 'CONFIG', 'Not configured.');
  const body = await req.text();
  let sql: Sql | null = null;
  try {
    const ok = await svixValid(key, req.headers.get('svix-id'), req.headers.get('svix-timestamp'), req.headers.get('svix-signature'), body);
    sql = await connect();
    if (!ok) {
      await recordEvent(sql, 'bad-signature', 'SIGNATURE', { fn: 'mail-events' });
      return problem(401, 'SIGNATURE', 'Not accepted.');
    }
    let e: Ev = null;
    try { e = JSON.parse(body); } catch { e = null; }
    const kind = e?.type === 'email.complained' ? 'complaint' : e?.type === 'email.bounced' && e?.data?.bounce?.type === 'Permanent' ? 'bounce' : null;
    const emailId = typeof e?.data?.email_id === 'string' ? e.data.email_id : null;
    if (!kind || !emailId) return json(200, { handled: false });
    const [r] = await sql`select service.mail_event(${emailId}, ${kind}) as n`;
    return json(200, { handled: true, suppressed: r.n });
  } catch (e) {
    console.error('mail-events', String(e).slice(0, 300));
    if (e instanceof ConfigError) return problem(500, 'CONFIG', 'Not configured.');
    return problem(500, 'SERVER', 'Something went wrong on our side.');
  } finally {
    if (sql) await sql.end({ timeout: 2 });
  }
}

if (import.meta.main) Deno.serve(handle);
