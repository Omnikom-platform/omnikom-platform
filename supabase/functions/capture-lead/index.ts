// capture-lead: the one platform call a client website makes (docs/blueprint/14-LEAD-PATH.md section 3; sops/site-endpoints.md 2).
// Called by the site's own /api/lead endpoint (factory/worker/lead-endpoint.mjs) with ?site=<site id> and X-Site-Signature.
// No user login: verify_jwt = false (supabase/config.toml); the signature is checked here first, against the site's active
// signing keys from the api_keys registry (service.active_key) read out of Vault. Then the body is checked against LeadRequest
// (specs/openapi.json), stored through service.capture_lead (workspace from the site, consent required, idempotent by key),
// and the new-lead email alert goes out through Resend to sites.lead_alert_to (recorded in messages, never fails the lead;
// one alert per lead: a retry of the same idempotency key alerts nobody again, found 2026-10-30 by the lead session).
// First proof target (DECISIONS 25): the ELEV8 preview form -> this -> staging database -> the owner's inbox.
// Environment, read by name only: SUPABASE_DB_URL (set by Supabase for every function), RESEND_API_KEY, LEAD_ALERT_FROM
// (a sender on a verified Resend domain, or onboarding@resend.dev for the first test), DASHBOARD_URL (optional, for the link).
// UNPROVEN until deployed: the path string this function sees (req.url) must equal what the endpoint signs; see pathForSignature.
import postgres from 'npm:postgres@3.4.5';
import { verify } from '../_shared/signature.ts';

const MAX_BODY = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
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

// The signed path is "/capture-lead?site=<id>". Supabase's gateway may present the function URL as /capture-lead or as
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

// deno-lint-ignore no-explicit-any
async function sendAlert(sql: any, site: string, leadId: string, lead: Lead): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('LEAD_ALERT_FROM');
  if (!apiKey || !from) return;                                   // alerts are off until D5 is set up; the lead is already stored
  // one alert per lead: a retried submission (same idempotency key) answers the same lead id and must not alert again
  const [prior] = await sql`select 1 as x from messages where lead_id = ${leadId}::uuid and template = 'new-lead' limit 1`;
  if (prior) return;
  const [s] = await sql`select s.workspace_id, s.lead_alert_to, w.name from sites s join workspaces w on w.id = s.workspace_id where s.id = ${site}::uuid`;
  if (!s || !s.lead_alert_to || s.lead_alert_to.length === 0) return;
  const dash = Deno.env.get('DASHBOARD_URL');
  const answers = lead.answers;
  const lines = [
    `New lead for ${s.name}`, '',
    `Name: ${lead.name ?? '(not given)'}`, `Phone: ${lead.phone ?? '(not given)'}`, `Email: ${lead.email ?? '(not given)'}`,
    `Form: ${lead.form}${lead.flow ? ` (${lead.flow})` : ''}`, `Page: ${lead.page}`,
    ...Object.entries(answers).slice(0, 12).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v).slice(0, 200)}`),
    '', dash ? `Open it: ${dash}/leads/${leadId}` : `Lead id: ${leadId}`,
  ];
  for (const to of s.lead_alert_to as string[]) {
    const [m] = await sql`select * from service.record_message(${s.workspace_id}::uuid, ${leadId}::uuid, null, 'email', 'new-lead', ${to})`;
    if (m.state !== 'queued') continue;                           // blocked by the daily cap: recorded, the queue retries tomorrow
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject: `New lead: ${lead.name ?? 'a visitor'} (${lead.form})`, text: lines.join('\n') }),
      });
      const j = await r.json().catch(() => ({}));
      await sql`select service.set_message_state(${m.id}::uuid, ${r.ok ? 'sent' : 'failed'}, ${r.ok ? (j.id ?? null) : null}, ${r.ok ? null : `resend ${r.status}`})`;
    } catch (e) {
      await sql`select service.set_message_state(${m.id}::uuid, 'failed', null, ${String(e).slice(0, 200)})`;
    }
  }
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return problem(405, [{ code: 'METHOD', path: '', msg: 'POST only.' }]);
  const url = new URL(req.url);
  const site = url.searchParams.get('site') ?? '';
  if (!UUID.test(site)) return problem(404, [{ code: 'SITE', path: '', msg: 'Not found.' }]);
  const body = await req.text();
  if (body.length > MAX_BODY) return problem(413, [{ code: 'SIZE', path: '', msg: 'Too large.' }]);
  const dbUrl = Deno.env.get('SUPABASE_DB_URL');
  if (!dbUrl) return problem(500, [{ code: 'CONFIG', path: '', msg: 'Not configured.' }]);
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    // the site's live signing keys (never revoked or expired), read from Vault by the registry's name
    const keys = await sql`select k.id, s.decrypted_secret as secret from service.active_key('site-signing', ${site}::uuid) k
      join vault.decrypted_secrets s on s.name = k.vault_ref`;
    const header = req.headers.get('x-site-signature');
    let keyId: string | null = null;
    for (const k of keys) { if (await verify(header, k.secret, 'POST', pathForSignature(url), body)) { keyId = k.id; break; } }
    if (!keyId) return problem(401, [{ code: 'SIGNATURE', path: '', msg: 'Not accepted.' }]);
    let data: unknown;
    try { data = JSON.parse(body); } catch { return problem(400, [{ code: 'BODY', path: '', msg: 'Send the form as JSON.' }]); }
    const c = checkBody(data);
    if (!c.ok) return problem(400, c.problems);
    const L = c.lead;
    const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
    const ipHash = ip ? await sha256Hex(`${site}:${ip}`) : null;      // a hash with the site id, never the address itself
    const ua = (req.headers.get('user-agent') ?? '').slice(0, 400) || null;
    const [row] = await sql`select service.capture_lead(${site}::uuid, ${L.form}, ${L.page}, ${L.name}, ${L.email}, ${L.phone},
      ${JSON.stringify(L.answers)}::jsonb, ${L.consentText}, ${L.flow}, ${L.cta}, ${L.marketing ? JSON.stringify(L.marketing) : null}::jsonb,
      ${L.idempotencyKey}::uuid, ${L.assignee}, ${ipHash}, ${ua}) as id`;
    await sql`select service.touch_key(${keyId}::uuid)`;
    try { await sendAlert(sql, site, row.id, L); } catch (e) { console.error('alert failed', String(e).slice(0, 200)); }
    return new Response(JSON.stringify({ ok: true }), { status: 202, headers: H });
  } catch (e) {
    console.error('capture-lead', String(e).slice(0, 300));
    return problem(500, [{ code: 'SERVER', path: '', msg: 'Something went wrong on our side.' }]);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (import.meta.main) Deno.serve(handle);
