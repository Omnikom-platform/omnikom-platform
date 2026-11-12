// capture-lead (slice 4.3): the JSON values it hands to Postgres. postgres.js turns an object given to a jsonb parameter into JSON itself; a
// string that is already JSON (JSON.stringify(x)) is encoded a second time and stored as a jsonb STRING, so a lead's answers would be a text
// value and not an object (found by the slice 4.2 builder, measured jsonb_typeof = 'string'). These tests capture a lead through the function
// and look at the stored types. The site's signing key is seeded the way staging has it (a Vault secret and an api_keys row); the throwaway
// cluster has no Vault, so the test makes the one table the key lookup reads.
import { handle } from '../capture-lead/index.ts';
import { sign } from '../_shared/signature.ts';
import { assert, crmForms, eq, SITE_A, t, WS_A, withSql } from './util.ts';

const KEY = 'test-site-signing-key-not-a-secret';
const REF = 'site-test-demo-a-key-1';

async function seedKey() {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(KEY))), b => b.toString(16).padStart(2, '0')).join('');
  await withSql(async sql => {
    const [v] = await sql`select to_regclass('vault.decrypted_secrets') as t`;
    if (!v.t) {
      await sql.unsafe('create schema if not exists vault');
      await sql.unsafe('create table vault.decrypted_secrets (name text primary key, decrypted_secret text)');
    }
    await sql`insert into vault.decrypted_secrets (name, decrypted_secret) values (${REF}, ${KEY}) on conflict (name) do nothing`;
    const have = await sql`select 1 from public.api_keys where vault_ref = ${REF}`;
    if (!have.length) await sql`insert into public.api_keys (site_id, workspace_id, kind, label, key_hash, vault_ref) values (${SITE_A}::uuid, ${WS_A}::uuid, 'site-signing', 'test lead key', ${hash}, ${REF})`;
  });
}

async function post(body: unknown, key: string = KEY, visitor = ''): Promise<{ status: number; text: string }> {
  const text = JSON.stringify(body);
  const path = `/capture-lead?site=${SITE_A}${visitor ? `&visitor=${visitor}` : ''}`;
  const res = await handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-signature': await sign(key, 'POST', path, text) }, body: text }));
  return { status: res.status, text: await res.text() };
}

t('capture-lead: a captured lead stores answers and marketing consent as JSON OBJECTS (not as text), in the lead and in the consent ledger', async () => {
  await seedKey(); await crmForms();
  const r = await post({ form: 'contact', page: '/contact', consentText: 'I agree to be contacted', name: 'Cap Json Lead', email: 'cap@example.com',
    answers: { budget: 'high', rooms: 3 }, marketingConsent: { given: true, text: 'Send me news' } });
  eq(r.status, 202, 'status: ' + r.text);
  await withSql(async sql => {
    const [l] = await sql`select jsonb_typeof(answers) as a, answers ->> 'budget' as budget, jsonb_typeof(marketing_consent) as m, marketing_consent ->> 'given' as given, id from public.leads where name = 'Cap Json Lead'`;
    eq(l.a, 'object', 'answers is an object'); eq(l.budget, 'high', 'an answer can be read by key');
    eq(l.m, 'object', 'marketing_consent is an object'); eq(l.given, 'true', 'the consent flag can be read by key');
    const [c] = await sql`select jsonb_typeof(marketing) as m from public.consent_ledger where lead_id = ${l.id}::uuid`;
    eq(c.m, 'object', 'the ledger copy is an object too');
  });
});

t('capture-lead (work order 01): answers are typed by the form (a number as a number, a tick list as a list), an unknown key is dropped', async () => {
  await seedKey(); await crmForms();
  const r = await post({ form: 'contact', page: '/contact', consentText: 'I agree to be contacted', name: 'Cap Typed', answers: { rooms: '4', wants: 'Pool', junk: 'x' } });
  eq(r.status, 202, 'status: ' + r.text);
  await withSql(async sql => {
    const [l] = await sql`select jsonb_typeof(answers -> 'rooms') as n, answers -> 'wants' as w, answers ? 'junk' as junk from public.leads where name = 'Cap Typed'`;
    eq(l.n, 'number', '"4" is stored as the number 4'); eq(JSON.stringify(l.w), '["Pool"]', 'one tick of a multi choice is a list'); eq(l.junk, false, 'a key the form does not declare is not stored');
  });
});

t('capture-lead (work order 01): a value the form refuses is a 400 naming the field in plain words, and nothing is stored', async () => {
  await seedKey(); await crmForms();
  const r = await post({ form: 'contact', page: '/contact', consentText: 'I agree to be contacted', name: 'Cap Bad Value', answers: { rooms: 99 } });
  eq(r.status, 400, 'status: ' + r.text);
  const b = JSON.parse(r.text);
  const p = (b.problems ?? [])[0] ?? {};
  eq(p.code, 'I-ANSWER', 'the code'); eq(p.path, 'rooms', 'the field'); eq(p.msg, 'rooms must be a number from 0 to 20', 'plain words from the contract');
  await withSql(async sql => { eq((await sql`select count(*)::int as n from public.leads where name = 'Cap Bad Value'`)[0].n, 0, 'no lead stored'); });
});

t('capture-lead: a lead with no marketing consent stores a null (not the text "null")', async () => {
  await seedKey();
  const r = await post({ form: 'contact', page: '/contact', consentText: 'I agree to be contacted', name: 'Cap No Marketing', answers: {} });
  eq(r.status, 202, 'status: ' + r.text);
  await withSql(async sql => {
    const [l] = await sql`select jsonb_typeof(answers) as a, marketing_consent is null as m from public.leads where name = 'Cap No Marketing'`;
    eq(l.a, 'object', 'empty answers are an object'); eq(l.m, true, 'no marketing consent is SQL null');
  });
});

t('capture-lead: the security event of a bad signature carries its detail as a JSON object', async () => {
  await seedKey();
  const r = await post({ form: 'contact', page: '/contact', consentText: 'x' }, 'not-the-site-key');
  eq(r.status, 401, 'status: ' + r.text);
  await withSql(async sql => {
    const [e] = await sql`select jsonb_typeof(detail) as d, detail ->> 'path' as path from public.security_events where kind = 'bad-signature' and site_id = ${SITE_A}::uuid order by id desc limit 1`;
    assert(e, 'an event was recorded');
    eq(e.d, 'object', 'detail is an object'); eq(e.path, '/capture-lead', 'and says which path');
  });
});

t('capture-lead (work order 20): the lead type comes from the form\'s mapping (a mapped answer, another mapped answer, none) and a new lead starts at not-contacted', async () => {
  await seedKey(); await crmForms();
  const send = async (name: string, answers: Record<string, unknown>) => {
    const r = await post({ form: 'contact', page: '/contact', consentText: 'I agree to be contacted', name, answers });
    eq(r.status, 202, `${name}: ${r.text}`);
    return await withSql(async sql => (await sql`select lead_type, status from public.leads where name = ${name}`)[0]);
  };
  const buy = await send('Cap Type Buy', { budget: 'high' });
  eq(buy.lead_type, 'buy', 'a mapped answer'); eq(buy.status, 'not-contacted', 'a new lead starts at not-contacted');
  eq((await send('Cap Type Ask', { budget: 'low' })).lead_type, 'listing-question', 'the "Ask about this home" kind of answer is listing-question');
  eq((await send('Cap Type None', { rooms: 2 })).lead_type, 'enquiry', 'no answer to map is an enquiry');
});

// Product row E4 (migration 29): the post only queues the alert (one mail_outbox row per address); the mail-outbox function sends it later
t('capture-lead [E4]: the new-lead alert is queued in mail_outbox, one row per address, nothing is sent or recorded during the post, and a retry of the same submission queues nothing more', async () => {
  await seedKey();
  const old = await withSql(async sql => (await sql`select lead_alert_to::text as v from public.sites where id = ${SITE_A}::uuid`)[0].v as string);
  const realFetch = globalThis.fetch;
  try {
    await withSql(sql => sql`update public.sites set lead_alert_to = array['e4-a@example.test', 'e4-b@example.test'] where id = ${SITE_A}::uuid`);
    globalThis.fetch = (() => { throw new Error('capture-lead must not call out during the post'); }) as typeof fetch;
    const body = { form: 'contact', page: '/contact', consentText: 'I agree to be contacted', name: 'Cap E4 Alert', idempotencyKey: crypto.randomUUID(), answers: {} };
    const look = () => withSql(async sql => {
      const [l] = await sql`select id from public.leads where name = 'Cap E4 Alert'`;
      const rows = await sql`select to_text from public.mail_outbox where lead_id = ${l.id}::uuid order by to_text`;
      const [m] = await sql`select count(*)::int as n from public.messages where lead_id = ${l.id}::uuid`;
      return { to: rows.map((x: { to_text: string }) => x.to_text).join(), n: rows.length as number, messages: m.n as number };
    });
    const r = await post(body);
    eq(r.status, 202, 'status: ' + r.text);
    const a = await look();
    eq(a.to, 'e4-a@example.test,e4-b@example.test', 'one outbox row per address');
    eq(a.messages, 0, 'no message row during the post');
    const r2 = await post(body);
    eq(r2.status, 202, 'the retry: ' + r2.text);
    eq((await look()).n, 2, 'the retry queued nothing more');
  } finally {
    globalThis.fetch = realFetch;
    await withSql(sql => sql`update public.sites set lead_alert_to = ${old}::text[] where id = ${SITE_A}::uuid`);
  }
});

// Product row E5 (migration 30): the site endpoint signs the visitor's hash into the path; capture-lead counts it per site and hour
t('capture-lead [E5]: past its hourly limit one visitor is refused 429, another visitor and a post with no visitor pass; the stored hash is the visitor\'s', async () => {
  await seedKey();
  const X = '1'.repeat(64), Y = '2'.repeat(64);
  const body = (name: string) => ({ form: 'contact', page: '/contact', consentText: 'I agree to be contacted', name, answers: {} });
  try {
    await withSql(sql => sql`insert into public.workspace_limits (workspace_id, key, value, note) values (${WS_A}::uuid, 'leads_per_hour_visitor', 2, 'E5 test') on conflict (workspace_id, key) do update set value = excluded.value`);
    eq((await post(body('Cap E5 X1'), KEY, X)).status, 202, 'X, the first');
    eq((await post(body('Cap E5 X2'), KEY, X)).status, 202, 'X, the second');
    const third = await post(body('Cap E5 X3'), KEY, X);
    eq(third.status, 429, 'X, the third: ' + third.text);
    eq(JSON.parse(third.text).problems[0].code, 'S-QUOTA', 'the code of the refusal');
    const y = await post(body('Cap E5 Y1'), KEY, Y);
    eq(y.status, 202, 'another visitor: ' + y.text);
    const none = await post(body('Cap E5 None'));
    eq(none.status, 202, 'a post with no visitor: ' + none.text);
    await withSql(async sql => {
      type Row = { name: string; source_ip_hash: string | null };
      const rows: Row[] = await sql`select name, source_ip_hash from public.leads where name like 'Cap E5 %' order by name`;
      eq(rows.map(r => `${r.name}=${r.source_ip_hash === null ? 'null' : r.source_ip_hash.slice(0, 2)}`).join(), 'Cap E5 None=null,Cap E5 X1=11,Cap E5 X2=11,Cap E5 Y1=22', 'the refused post is not stored; X\'s two leads carry X, Y\'s carries Y, the post with no visitor none');
      eq(rows.filter(r => r.source_ip_hash === X).length, 2, 'the whole hash is stored');
    });
  } finally {
    await withSql(sql => sql`delete from public.workspace_limits where workspace_id = ${WS_A}::uuid and key = 'leads_per_hour_visitor'`);
  }
});

t('capture-lead [E5]: a visitor that is not 64 lower-case hex is no visitor: never counted, stored as null', async () => {
  await seedKey();
  const bad = { 'Cap E5b Short': 'ABC', 'Cap E5b Upper': 'A'.repeat(64) };   // "E5b": the other test's lead names start "Cap E5 "
  for (const [name, v] of Object.entries(bad)) {
    const r = await post({ form: 'contact', page: '/contact', consentText: 'I agree to be contacted', name, answers: {} }, KEY, v);
    eq(r.status, 202, `${name}: ${r.text}`);
  }
  await withSql(async sql => {
    for (const name of Object.keys(bad)) {
      const [l] = await sql`select source_ip_hash from public.leads where name = ${name}`;
      eq(l.source_ip_hash, null, `${name}: stored as null`);
    }
    eq((await sql`select count(*)::int as n from public.visitor_counts where ip_hash = 'ABC' or ip_hash = ${'A'.repeat(64)}`)[0].n, 0, 'neither value was counted');
  });
});
