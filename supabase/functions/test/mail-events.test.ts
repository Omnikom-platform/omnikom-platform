// Product row E21 (migration 31): Resend's signed bounce and complaint webhook suppresses the address. These tests call the mail-events function the way Resend
// does (a POST with the Svix headers svix-id, svix-timestamp, svix-signature, signed with the webhook secret) and sign it here, in the test, with their own HMAC code:
// no call leaves this machine and nothing reaches Resend. The database side (service.mail_event, its grants) is proven in tenancy.test.sql T37. Every name holds
// [E21] (FN_TEST_FILTER='[E21]' runs only these). Each test starts from no message or suppression of its own addresses; the messages are inserted as the
// superuser, in workspace A, state sent, with the provider id the webhook names.
import { handle as events } from '../mail-events/index.ts';
import { handle as outbox } from '../mail-outbox/index.ts';
import { sign } from '../_shared/signature.ts';
import { assert, eq, securityEvents, SITE_A, t, WS_A, withSql } from './util.ts';

const SECRET = 'whsec_' + btoa('test-webhook-secret-not-a-secret');
const OTHER_SECRET = 'whsec_' + btoa('another-webhook-secret-not-a-secret');
Deno.env.set('RESEND_WEBHOOK_SECRET', SECRET);
Deno.env.set('MAIL_OUTBOX_KEY', 'test-mail-outbox-key-not-a-secret');
Deno.env.set('RESEND_API_KEY', 'test-resend-key-not-a-secret');
Deno.env.set('LEAD_ALERT_FROM', 'alerts@example.test');
Deno.env.set('DASHBOARD_URL', 'https://app.example.test');

const DECOY = 'e21-decoy@example.test';   // the address the payload's data.to names: never the one that is suppressed

/** what Resend does: HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>" keyed with the base64-decoded part of the secret after whsec_, base64 out, as "v1,<signature>" */
async function svixSign(secret: string, id: string, ts: number, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0));
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  let s = '';
  for (const b of mac) s += String.fromCharCode(b);
  return 'v1,' + btoa(s);
}

/** a Resend event: its type, the email id, and for a bounce its kind (Permanent or Temporary); data.to is a decoy the function must never read */
const event = (type: string, emailId: string, bounce?: string) =>
  ({ type, created_at: '2026-11-12T10:00:00.000Z', data: { email_id: emailId, to: [DECOY], ...(bounce ? { bounce: { type: bounce, subType: 'General', message: 'test' } } : {}) } });

type Opt = { secret?: string; age?: number; sentBody?: string; header?: (right: string) => string };
/** the webhook call: the event signed as Resend signs it; `secret` signs with another secret, `age` backdates the timestamp (seconds), `sentBody` sends another body than the signed one,
 *  `header` turns the right signature into the header value */
async function post(ev: unknown, o: Opt = {}): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const body = JSON.stringify(ev);
  const id = 'msg_' + crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000) - (o.age ?? 0);
  const right = await svixSign(o.secret ?? SECRET, id, ts, body);
  const res = await events(new Request('http://localhost/mail-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': o.header ? o.header(right) : right },
    body: o.sentBody ?? body,
  }));
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text), text };
}

type Row = { workspace_id: string | null; reason: string; source: string | null };
const rows = (addr: string) => withSql(async sql => await sql`select s.workspace_id, s.reason, s.source from public.suppressions s
  where s.channel = 'email' and s.address_hash = private.address_hash('email', ${addr}) order by s.id`) as Promise<Row[]>;

/** a clean start: no message of the provider ids and no suppression of the addresses; then one sent message of workspace A per [address, provider id] */
async function messages(...m: [string, string][]): Promise<void> {
  await withSql(async sql => {
    await sql`delete from public.messages where provider_id like 're_e21_%'`;
    for (const a of [DECOY, ...m.map(x => x[0])]) await sql`delete from public.suppressions where channel = 'email' and address_hash = private.address_hash('email', ${a})`;
    for (const [to, pid] of m) {
      await sql`insert into public.messages (workspace_id, lead_id, channel, template, to_text, state, provider_id)
        values (${WS_A}::uuid, null, 'email', 'new-lead', ${to}, 'sent', ${pid})`;
    }
  });
}

t('mail-events [E21] W1: a signed permanent bounce suppresses the sent-to address for the whole platform, once; the outbox then never sends to it', async () => {
  await messages(['e21-bounce@example.test', 're_e21_1']);
  const a = await post(event('email.bounced', 're_e21_1', 'Permanent'));
  eq(a.status, 200, a.text);
  eq(JSON.stringify(a.json), JSON.stringify({ handled: true, suppressed: 1 }), 'the answer');
  const r = await rows('e21-bounce@example.test');
  eq(r.length, 1, 'one suppression');
  eq(r[0].workspace_id, null, 'for the whole platform'); eq(r[0].reason, 'bounce', 'the reason'); eq(r[0].source, 'resend webhook', 'the source');
  eq((await rows(DECOY)).length, 0, 'the payload\'s own address is not suppressed');
  const b = await post(event('email.bounced', 're_e21_1', 'Permanent'));
  eq(b.status, 200, b.text); eq((await rows('e21-bounce@example.test')).length, 1, 'the same delivery again: still one suppression');
  // the outbox: a new lead of workspace A with a row to that address (the outbox is emptied first, as outbox.test.ts does: C1 of capture.test.ts leaves due rows)
  const lead = await withSql(async sql => {
    await sql`delete from public.mail_outbox`;
    const [l] = await sql`insert into public.leads (workspace_id, site_id, form, page_path, name, email, status, answers, consent_text, created_at)
      values (${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/contact', 'E21 One', 'visitor-e21@example.test', 'not-contacted', '{}'::jsonb, 'I agree to be contacted', now()) returning id`;
    await sql`insert into public.mail_outbox (lead_id, template, to_text) values (${l.id}::uuid, 'new-lead', 'e21-bounce@example.test')`;
    return l.id as string;
  });
  const calls: string[] = [];
  const fakeResend = (async (u: string | URL | Request) => { calls.push(String(u)); return new Response('{"id":"re_never"}', { status: 200 }); }) as typeof fetch;
  const run = await outbox(new Request('http://localhost/mail-outbox', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cron-signature': await sign('test-mail-outbox-key-not-a-secret', 'POST', '/mail-outbox', '{}') }, body: '{}' }), { fetch: fakeResend });
  const text = await run.text();
  eq(run.status, 200, text); eq(JSON.parse(text).claimed, 0, 'the outbox claims nothing for a bounced address: ' + text);
  eq(calls.length, 0, 'and calls nobody');
  eq(await withSql(async sql => (await sql`select count(*)::int as n from public.mail_outbox where lead_id = ${lead}::uuid`)[0].n as number), 0, 'the row is gone');
});

t('mail-events [E21] W2: a signed complaint suppresses the address for the message\'s workspace only', async () => {
  await messages(['e21-complaint@example.test', 're_e21_2']);
  const a = await post(event('email.complained', 're_e21_2'));
  eq(a.status, 200, a.text);
  eq(JSON.stringify(a.json), JSON.stringify({ handled: true, suppressed: 1 }), 'the answer');
  const r = await rows('e21-complaint@example.test');
  eq(r.length, 1, 'one suppression');
  eq(r[0].workspace_id, WS_A, 'for the workspace of the message'); eq(r[0].reason, 'complaint', 'the reason'); eq(r[0].source, 'resend webhook', 'the source');
  eq((await rows(DECOY)).length, 0, 'the payload\'s own address is not suppressed');
});

t('mail-events [E21] W3: a wrong secret, a timestamp 301 s old and a body changed after signing are each 401 SIGNATURE and suppress nothing; one right signature among wrong ones is accepted', async () => {
  const addr = 'e21-signature@example.test';
  await messages([addr, 're_e21_3']);
  const ev = event('email.bounced', 're_e21_3', 'Permanent');
  const before = await securityEvents({ kind: 'bad-signature', code: 'SIGNATURE' });
  const a = await post(ev, { secret: OTHER_SECRET });
  eq(a.status, 401, a.text); eq(a.json.code, 'SIGNATURE', 'another secret: the code');
  eq(await securityEvents({ kind: 'bad-signature', code: 'SIGNATURE' }), before + 1, 'one security event more');
  eq((await rows(addr)).length, 0, 'another secret: nothing suppressed');
  const b = await post(ev, { age: 301 });
  eq(b.status, 401, b.text); eq(b.json.code, 'SIGNATURE', 'an old timestamp: the code');
  eq((await rows(addr)).length, 0, 'an old timestamp: nothing suppressed');
  const c = await post(ev, { sentBody: JSON.stringify(ev) + ' ' });
  eq(c.status, 401, c.text); eq(c.json.code, 'SIGNATURE', 'a changed body: the code');
  eq((await rows(addr)).length, 0, 'a changed body: nothing suppressed');
  const d = await post(ev, { header: right => `v1,${'A'.repeat(43)}= ${right}` });
  eq(d.status, 200, d.text); eq(JSON.stringify(d.json), JSON.stringify({ handled: true, suppressed: 1 }), 'a wrong signature then the right one: the answer');
  eq((await rows(addr)).length, 1, 'a wrong signature then the right one: suppressed');
});

t('mail-events [E21] W4: a temporary bounce, an event of another kind and a bounce for an email we did not send are not suppressions', async () => {
  const temp = 'e21-temporary@example.test', delivered = 'e21-delivered@example.test';
  await messages([temp, 're_e21_4'], [delivered, 're_e21_5']);
  const a = await post(event('email.bounced', 're_e21_4', 'Temporary'));
  eq(a.status, 200, a.text); eq(JSON.stringify(a.json), JSON.stringify({ handled: false }), 'a temporary bounce is not handled');
  eq((await rows(temp)).length, 0, 'and suppresses nothing');
  const b = await post(event('email.delivered', 're_e21_5'));
  eq(b.status, 200, b.text); eq(JSON.stringify(b.json), JSON.stringify({ handled: false }), 'a delivery is not handled');
  eq((await rows(delivered)).length, 0, 'and suppresses nothing');
  const c = await post(event('email.bounced', 're_e21_none', 'Permanent'));
  eq(c.status, 200, c.text); eq(JSON.stringify(c.json), JSON.stringify({ handled: true, suppressed: 0 }), 'an unknown email id is handled and suppresses nothing');
  eq((await rows(DECOY)).length, 0, 'and the payload\'s own address is not suppressed');
});

t('mail-events [E21] W5: without RESEND_WEBHOOK_SECRET the function is 500 CONFIG and suppresses nothing', async () => {
  const addr = 'e21-config@example.test';
  await messages([addr, 're_e21_6']);
  try {
    Deno.env.delete('RESEND_WEBHOOK_SECRET');
    const a = await post(event('email.bounced', 're_e21_6', 'Permanent'));
    eq(a.status, 500, a.text); eq(a.json.code, 'CONFIG', 'the code');
    assert((await rows(addr)).length === 0, 'nothing suppressed');
  } finally { Deno.env.set('RESEND_WEBHOOK_SECRET', SECRET); }
});

// The answer must come before any database connection; nothing in the database shows whether a connection was opened (the same as W5's check), so this asserts the
// status, the code and that nothing is suppressed.
t('mail-events [E21] W6: a secret that is not base64 answers 500 CONFIG', async () => {
  const addr = 'e21-base64@example.test';
  await messages([addr, 're_e21_7']);
  try {
    Deno.env.set('RESEND_WEBHOOK_SECRET', 'whsec_***');
    const a = await post(event('email.bounced', 're_e21_7', 'Permanent'));
    eq(a.status, 500, a.text); eq(a.json.code, 'CONFIG', 'the code');
    assert((await rows(addr)).length === 0, 'nothing suppressed');
  } finally { Deno.env.set('RESEND_WEBHOOK_SECRET', SECRET); }
});
