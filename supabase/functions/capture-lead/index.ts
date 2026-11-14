// capture-lead: the one platform call a client website makes (docs/blueprint/14-LEAD-PATH.md section 3; sops/site-endpoints.md 2).
// Called by the site's own /api/lead endpoint (factory/worker/lead-endpoint.mjs) with ?site=<site id> and X-Site-Signature.
// No user login: verify_jwt = false (supabase/config.toml); first what needs no key (header form, 300 s window, 16 KiB body cap: signatureLooksValid, readCapped), then the signature, checked against the site's active
// signing keys from the api_keys registry (service.active_key) read out of Vault. Then the body is checked against LeadRequest
// (specs/openapi.json), stored through service.capture_lead (workspace from the site, consent required, idempotent by key),
// and the new-lead alert is queued in mail_outbox, one row per address of sites.lead_alert_to (service.queue_lead_alert; never fails the
// lead; one alert per lead: a retry of the same idempotency key queues nothing again). The mail-outbox function sends it (product row E4).
// First proof target (DECISIONS 25): the ELEV8 preview form -> this -> staging database -> the owner's inbox.
// Environment, read by name only: DB_POOLER_URL (the transaction pooler, through _shared/db.ts connect()); the alert's Resend keys are mail-outbox's.
// The path string this function sees equals what the endpoint signs (proven on staging 2026-10-30, step 2).
// Step 3 (migration 8): every statement steps down to the role omnikom_fn in a transaction of its own, so this code can only call
// service.* functions (no table read or write, 24-GAP-HUNT A 13.2.2); Vault, the alert recipients and "was this lead alerted"
// come through service functions. A refusal is answered with its platform code and recorded in security_events.
// Slice 4.3 (2026-10-31): a jsonb parameter is given the OBJECT, never JSON.stringify(object)::jsonb: postgres.js encodes a string given to a jsonb
// parameter a second time, so answers, marketing consent and the security event's detail were stored as JSON strings (jsonb_typeof 'string').
// Tests: supabase/functions/test/capture.test.ts. This file keeps its own `refusal` (visitor wording and the 'SITE' code differ from _shared/db.ts).
import { verify } from '../_shared/signature.ts';
import { answerProblem, connect, type Sql } from '../_shared/db.ts';
import { readCapped, serve } from '../_shared/http.ts';

const MAX_BODY = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VISITOR = /^[0-9a-f]{64}$/;
const H = { 'content-type': 'application/json', 'cache-control': 'no-store' };

type Problem = { code: string; path: string; msg: string };
type Lead = {
  form: string; page: string; consentText: string;
  name: string | null; email: string | null; phone: string | null; flow: string | null; cta: string | null;
  assignee: string | null; idempotencyKey: string | null; answers: Record<string, unknown>;
  marketing: { given: boolean; text: string } | null;
};
const problem = (status: number, problems: Problem[]) =>
  new Response(JSON.stringify({ status, problems }), { status, headers: H });

// What the database said no to, as the visitor's answer: the platform code becomes a named 4xx instead of a bare 500.
// S-SITE-PAUSED and S-WORKSPACE-SUSPENDED: 409 (the site exists and is not taking requests); S-QUOTA: 429; unknown site: 404.
export function refusal(message: string): { status: number; code: string; kind: string; msg: string; path?: string } | null {
  if (message.includes('S-SITE-PAUSED')) return { status: 409, code: 'S-SITE-PAUSED', kind: 'suspended', msg: 'This site is not taking requests right now. Please call or email us.' };
  if (message.includes('S-WORKSPACE-SUSPENDED')) return { status: 409, code: 'S-WORKSPACE-SUSPENDED', kind: 'suspended', msg: 'This site is not taking requests right now. Please call or email us.' };
  if (message.includes('S-QUOTA')) return { status: 429, code: 'S-QUOTA', kind: 'quota', msg: 'Please try again later.' };
  if (message.includes('unknown site')) return { status: 404, code: 'SITE', kind: 'refused', msg: 'Not found.' };
  if (message.includes('consent text required')) return { status: 400, code: 'REQUIRED', kind: 'bad-request', msg: 'This is needed.' };
  // migration 14: an answer the form's contract refuses, named by its field, in the database's plain words
  if (message.includes('I-ANSWER')) { const a = answerProblem(message); return { status: 400, code: 'I-ANSWER', kind: 'bad-request', msg: a ? a.msg : 'Please check your answers.', path: a ? a.path : '' }; }
  return null;
}

// The signed path is "/capture-lead?site=<id>&visitor=<hash>" (no visitor from an endpoint published before product row E5). Supabase's gateway may present the function URL as /capture-lead or as
// /functions/v1/capture-lead; both reduce to the same signed string.
export function pathForSignature(u: URL): string {
  return u.pathname.replace(/^\/functions\/v1/, '') + u.search;
}

export function checkBody(data: unknown): { ok: true; lead: Lead } | { ok: false; problems: Problem[] } {
  const p: Problem[] = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, problems: [{ code: 'BODY', path: '', msg: 'Send the form as JSON.' }] };
  const d = data as Record<string, unknown>;
  const str = (k: string, max: number, required = false) => {
    const v = d[k];
    if (v == null || v === '') { if (required) p.push({ code: 'REQUIRED', path: k, msg: 'This is needed.' }); return null; }
    if (typeof v !== 'string') { p.push({ code: 'TYPE', path: k, msg: 'Must be text.' }); return null; }
    if (v.length > max) { p.push({ code: 'LENGTH', path: k, msg: `At most ${max} characters.` }); return null; }
    return v;
  };
  if (typeof d.hp === 'string' && d.hp.trim() !== '') return { ok: false, problems: [{ code: 'HP', path: '', msg: 'Something is missing.' }] };
  const form = str('form', 60, true), page = str('page', 300, true), consentText = str('consentText', 2000, true);
  const name = str('name', 120), email = str('email', 320), phone = str('phone', 40), flow = str('flow', 60), cta = str('cta', 120), assignee = str('assignee', 80), idempotencyKey = str('idempotencyKey', 36);
  if (form && !SLUG.test(form)) p.push({ code: 'FORM', path: 'form', msg: 'Unknown form.' });
  if (email && !EMAIL.test(email)) p.push({ code: 'EMAIL', path: 'email', msg: 'Enter an email like name@example.com' });
  if (flow && !SLUG.test(flow)) p.push({ code: 'FLOW', path: 'flow', msg: 'Unknown flow.' });
  if (assignee && !SLUG.test(assignee)) p.push({ code: 'ASSIGNEE', path: 'assignee', msg: 'Unknown team member.' });
  if (idempotencyKey && !UUID.test(idempotencyKey)) p.push({ code: 'KEY', path: 'idempotencyKey', msg: 'Bad submission key.' });
  const answers = d.answers == null ? {} : d.answers;
  if (typeof answers !== 'object' || Array.isArray(answers)) p.push({ code: 'TYPE', path: 'answers', msg: 'Must be an object.' });
  let marketing: Lead['marketing'] = null;
  if (d.marketingConsent != null) {
    const m = d.marketingConsent as Record<string, unknown>;
    if (typeof m !== 'object' || typeof m.given !== 'boolean' || typeof m.text !== 'string' || m.text.length === 0) p.push({ code: 'TYPE', path: 'marketingConsent', msg: 'Needs given (yes or no) and the wording shown.' });
    else marketing = { given: m.given, text: m.text.slice(0, 2000) };
  }
  if (p.length || !form || !page || !consentText) return { ok: false, problems: p };
  return { ok: true, lead: { form, page, consentText, name, email, phone, flow, cta, assignee, idempotencyKey, answers: answers as Record<string, unknown>, marketing } };
}

async function sha256Hex(s: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// Rule 35: what needs no key is judged before anything costs a connection. A signature header that is missing, not t=<digits>,v1=<64 lower-case hex> (the form of _shared/signature.ts verify)
// or more than 300 s from now can never verify. A forged one of the right form still needs the site's key, read through the database: that costs one lookup, as before.
// The pattern and the window are COPIES of verify's (signature.ts:35, :38); capture.test.ts T5 holds the two equal for every header a site signs.
const SIGNATURE_SHAPE = /^t=(\d{1,12}),v1=[0-9a-f]{64}$/;
export function signatureLooksValid(header: string | null, now: number = Math.floor(Date.now() / 1000)): boolean {
  const m = SIGNATURE_SHAPE.exec((header ?? '').trim());
  return m !== null && Math.abs(now - Number(m[1])) <= 300;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return problem(405, [{ code: 'METHOD', path: '', msg: 'POST only.' }]);
  const url = new URL(req.url);
  const site = url.searchParams.get('site') ?? '';
  if (!UUID.test(site)) return problem(404, [{ code: 'SITE', path: '', msg: 'Not found.' }]);
  const header = req.headers.get('x-site-signature');
  if (!signatureLooksValid(header)) return problem(401, [{ code: 'SIGNATURE', path: '', msg: 'Not accepted.' }]);   // no database work, no event: it cost nothing and says nothing
  const body = await readCapped(req.body, MAX_BODY);   // bytes: reading stops at the chunk that crosses MAX_BODY
  if (body === null) return problem(413, [{ code: 'SIZE', path: '', msg: 'Too large.' }]);
  let sql: Sql;   // E6: the transaction pooler (DB_POOLER_URL), each statement stepped down in its own transaction
  try { sql = await connect(); } catch { return problem(500, [{ code: 'CONFIG', path: '', msg: 'Not configured.' }]); }
  // a hash with the site id, never the address itself (Cloudflare's header first; X-Forwarded-For is a fallback for the first test)
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = ip ? await sha256Hex(`${site}:${ip}`) : null;
  // the visitor: sha256 of "<site id>:<address>" from the site's own endpoint, inside the signed path (product row E5). Absent (an endpoint published before
  // that row) or not 64 lower-case hex: no visitor, so no visitor limit and no stored hash. The security events below keep the caller's own hash (ipHash).
  const v = url.searchParams.get('visitor') ?? '', visitor = VISITOR.test(v) ? v : null;
  const event = async (kind: string, code: string, workspace: string | null = null) => {
    try { await sql`select service.record_security_event(${kind}, ${code}, ${workspace}::uuid, ${site}::uuid, null, ${ipHash}, ${{ path: url.pathname }}::jsonb)`; }
    catch (e) { console.error('security event not recorded', String(e).slice(0, 200)); }
  };
  try {
    // the site's live signing keys (never revoked or expired), read from Vault by the registry's name
    const keys = await sql`select id, secret from service.site_signing_secrets(${site}::uuid)`;
    let keyId: string | null = null;
    for (const k of keys) { if (await verify(header, k.secret, 'POST', pathForSignature(url), body)) { keyId = k.id; break; } }
    if (!keyId) { await event('bad-signature', 'SIGNATURE'); return problem(401, [{ code: 'SIGNATURE', path: '', msg: 'Not accepted.' }]); }
    let data: unknown;
    try { data = JSON.parse(body); } catch { return problem(400, [{ code: 'BODY', path: '', msg: 'Send the form as JSON.' }]); }
    const c = checkBody(data);
    if (!c.ok) return problem(400, c.problems);
    const L = c.lead;
    const ua = (req.headers.get('user-agent') ?? '').slice(0, 400) || null;
    let row: { id: string };
    try {
      if (visitor) await sql`select service.count_visitor(${site}::uuid, ${visitor})`;
      [row] = await sql`select service.capture_lead(${site}::uuid, ${L.form}, ${L.page}, ${L.name}, ${L.email}, ${L.phone},
        ${L.answers}::jsonb, ${L.consentText}, ${L.flow}, ${L.cta}, ${L.marketing}::jsonb,
        ${L.idempotencyKey}::uuid, ${L.assignee}, ${visitor}, ${ua}) as id`;
    } catch (e) {
      const r = refusal(String(e));
      if (!r) throw e;
      await event(r.kind, r.code);                                  // the refusal's own transaction rolled back; the record is a call of its own
      return problem(r.status, [{ code: r.code, path: r.path ?? '', msg: r.msg }]);
    }
    await sql`select service.touch_key(${keyId}::uuid)`;
    try { await sql`select service.queue_lead_alert(${site}::uuid, ${row.id}::uuid)`; } catch (e) { console.error('alert not queued', String(e).slice(0, 200)); }
    return new Response(JSON.stringify({ ok: true }), { status: 202, headers: H });
  } catch (e) {
    console.error('capture-lead', String(e).slice(0, 300));
    return problem(500, [{ code: 'SERVER', path: '', msg: 'Something went wrong on our side.' }]);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (import.meta.main) serve('capture-lead', handle);
