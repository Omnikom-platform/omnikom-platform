// Product row E4 (migration 29): the new-lead alert waits in mail_outbox and the mail-outbox function sends it. These tests call the function the way
// pg_cron does (a POST of {} signed with MAIL_OUTBOX_KEY in X-Cron-Signature) and fake Resend through `deps.fetch`: no call leaves this machine. The
// database side (queue, claim, done, the tick, the walls) is proven in tenancy.test.sql T35; capture-lead's queueing in capture.test.ts. Every name holds
// [E4] (FN_TEST_FILTER='[E4]' runs only these). Each test starts from an empty outbox, one lead of workspace A and that lead's row.
import { handle, type Deps } from '../mail-outbox/index.ts';
import { sign } from '../_shared/signature.ts';
import { assert, eq, securityEvents, SITE_A, t, WS_A, withSql } from './util.ts';

Deno.env.set('MAIL_OUTBOX_KEY', 'test-mail-outbox-key-not-a-secret');
Deno.env.set('RESEND_API_KEY', 'test-resend-key-not-a-secret');
Deno.env.set('LEAD_ALERT_FROM', 'alerts@example.test');
Deno.env.set('DASHBOARD_URL', 'https://app.example.test');

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
type Reply = { status: number; body?: unknown; delayMs?: number };
/** a fake Resend: records each call (address, headers, body) and answers with the next reply of the script (the last one repeats); a reply with
 *  delayMs answers after that many milliseconds unless the request's signal aborts first */
function fakeResend(...script: Reply[]) {
  const calls: Call[] = [];
  const f = (async (u: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(u), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body ?? '{}')) });
    const r = script[Math.min(calls.length - 1, script.length - 1)];
    const answer = () => new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
    if (!r.delayMs) return answer();
    const signal = init?.signal;
    return await new Promise<Response>((ok, no) => {
      const timer = setTimeout(() => ok(answer()), r.delayMs);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); no(signal.reason); });
    });
  }) as typeof fetch;
  return { f, calls };
}

/** the pg_cron call: POST {} to /mail-outbox, signed with the key */
async function run(deps: Deps, key = 'test-mail-outbox-key-not-a-secret'): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const body = '{}';
  const res = await handle(new Request('http://localhost/mail-outbox', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cron-signature': await sign(key, 'POST', '/mail-outbox', body) }, body }), deps);
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text), text };
}

/** a lead of workspace A (as export.test.ts makes one) and its outbox row; the outbox is emptied first (as the superuser) */
async function lead(name: string): Promise<string> {
  return await withSql(async sql => {
    await sql`delete from public.mail_outbox`;
    const [l] = await sql`insert into public.leads (workspace_id, site_id, form, page_path, name, email, status, answers, consent_text, created_at)
      values (${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/contact', ${name}, 'visitor-e4@example.test', 'not-contacted', '{}'::jsonb, 'I agree to be contacted', now()) returning id`;
    await sql`insert into public.mail_outbox (lead_id, template, to_text) values (${l.id}::uuid, 'new-lead', 'owner-e4@example.test')`;
    return l.id as string;
  });
}
const outbox = (id: string) => withSql(async sql => (await sql`select attempts, message_id, next_at > now() as later from public.mail_outbox where lead_id = ${id}::uuid`)[0] ?? null);
const outboxCount = () => withSql(async sql => (await sql`select count(*)::int as n from public.mail_outbox`)[0].n as number);
const messages = (id: string) => withSql(async sql => await sql`select id, state::text as state, provider_id from public.messages where lead_id = ${id}::uuid and template = 'new-lead' order by created_at, id`);

t('mail-outbox [E4] O1: a due alert goes to Resend once (the key, the message id as idempotency key, to, from, subject); the message is sent with Resend\'s id; the outbox is empty; a second run sends nothing', async () => {
  const id = await lead('E4 One');
  const fake = fakeResend({ status: 200, body: { id: 're_e4_1' } });
  const a = await run({ fetch: fake.f });
  eq(a.status, 200, a.text);
  eq(JSON.stringify(a.json), JSON.stringify({ claimed: 1, sent: 1, failed: 0 }), 'the answer');
  eq(fake.calls.length, 1, 'one call');
  const c = fake.calls[0];
  eq(c.url, 'https://api.resend.com/emails', 'to Resend');
  eq(c.headers.authorization, 'Bearer test-resend-key-not-a-secret', 'with the key');
  const [m] = await messages(id);
  eq(c.headers['idempotency-key'], m.id, 'the idempotency key is the row\'s new message id');
  eq(c.body.to, 'owner-e4@example.test', 'to'); eq(c.body.from, 'alerts@example.test', 'from'); eq(c.body.subject, 'New lead: E4 One (contact)', 'the subject');
  eq(m.state, 'sent', 'the message is sent'); eq(m.provider_id, 're_e4_1', 'with Resend\'s id');
  eq(await outboxCount(), 0, 'the outbox is empty');
  const b = await run({ fetch: fake.f });
  eq(b.status, 200, b.text); eq(b.json.claimed, 0, 'a second run claims nothing'); eq(fake.calls.length, 1, 'and calls nobody');
});

t('mail-outbox [E4] O2: a Resend error leaves the message queued and the row for a later try (attempts 1); a run at once claims nothing; the next try sends it with the same idempotency key', async () => {
  const id = await lead('E4 Two');
  const fake = fakeResend({ status: 500, body: { message: 'down' } }, { status: 200, body: { id: 're_e4_2' } });
  const a = await run({ fetch: fake.f });
  eq(JSON.stringify(a.json), JSON.stringify({ claimed: 1, sent: 0, failed: 1 }), 'the answer: ' + a.text);
  eq((await messages(id))[0].state, 'queued', 'the message stays queued');
  const row = await outbox(id);
  assert(row, 'the row stays'); eq(row.attempts, 1, 'attempts 1'); eq(row.later, true, 'its next try is later');
  eq((await run({ fetch: fake.f })).json.claimed, 0, 'a run at once claims nothing');
  await withSql(sql => sql`update public.mail_outbox set next_at = now() where lead_id = ${id}::uuid`);
  const c = await run({ fetch: fake.f });
  eq(c.json.sent, 1, 'the next try sends it: ' + c.text);
  eq(fake.calls.length, 2, 'two calls in all');
  eq(fake.calls[0].headers['idempotency-key'], fake.calls[1].headers['idempotency-key'], 'the same idempotency key both times');
  const ms = await messages(id);
  eq(ms.length, 1, 'one message'); eq(ms[0].state, 'sent', 'sent');
});

t('mail-outbox [E4] O3: Resend that does not answer within the timeout is a failed try: the message stays queued, attempts 1', async () => {
  const id = await lead('E4 Three');
  const fake = fakeResend({ status: 200, body: { id: 're_e4_3' }, delayMs: 300 });
  const a = await run({ fetch: fake.f, timeoutMs: 50 });
  eq(JSON.stringify(a.json), JSON.stringify({ claimed: 1, sent: 0, failed: 1 }), 'the answer: ' + a.text);
  eq((await messages(id))[0].state, 'queued', 'the message stays queued');
  eq((await outbox(id))?.attempts, 1, 'attempts 1');
});

t('mail-outbox [E4] O4: a call signed with another key is 401 SIGNATURE and a security event; nothing is claimed or sent', async () => {
  const id = await lead('E4 Four');
  const before = await securityEvents({ kind: 'bad-signature', code: 'SIGNATURE' });
  const fake = fakeResend({ status: 200, body: { id: 're_e4_4' } });
  const a = await run({ fetch: fake.f }, 'not-the-mail-outbox-key');
  eq(a.status, 401, a.text); eq(a.json.code, 'SIGNATURE', 'the code');
  eq(fake.calls.length, 0, 'no call');
  eq((await outbox(id))?.attempts, 0, 'the row was not claimed');
  eq(await securityEvents({ kind: 'bad-signature', code: 'SIGNATURE' }), before + 1, 'one security event more');
});

t('mail-outbox [E4] O5: without RESEND_API_KEY the function is 500 CONFIG and claims nothing', async () => {
  const id = await lead('E4 Five');
  const key = Deno.env.get('RESEND_API_KEY') as string;
  const fake = fakeResend({ status: 200, body: { id: 're_e4_5' } });
  try {
    Deno.env.delete('RESEND_API_KEY');
    const a = await run({ fetch: fake.f });
    eq(a.status, 500, a.text); eq(a.json.code, 'CONFIG', 'the code');
    eq(fake.calls.length, 0, 'no call');
    eq((await outbox(id))?.attempts, 0, 'the row was not claimed');
  } finally { Deno.env.set('RESEND_API_KEY', key); }
});

t('mail-outbox [E4] O6: the alert links to the lead in the dashboard (/w/<workspace slug>/leads/<id>); without DASHBOARD_URL it ends with the lead id', async () => {
  const id = await lead('E4 Six');
  const fake = fakeResend({ status: 200, body: { id: 're_e4_6' } });
  await run({ fetch: fake.f });
  const text = String(fake.calls[0]?.body.text);
  assert(text.includes(`Open it: https://app.example.test/w/test-demo-a/leads/${id}`), 'the dashboard link: ' + text);
  assert(!text.includes('example.test/leads/'), 'not the old address without the workspace: ' + text);
  const dash = Deno.env.get('DASHBOARD_URL') as string;
  try {
    Deno.env.delete('DASHBOARD_URL');
    const id2 = await lead('E4 Six B');
    await run({ fetch: fake.f });
    const text2 = String(fake.calls[1]?.body.text);
    assert(text2.endsWith(`Lead id: ${id2}`), 'the lead id: ' + text2);
  } finally { Deno.env.set('DASHBOARD_URL', dash); }
});
