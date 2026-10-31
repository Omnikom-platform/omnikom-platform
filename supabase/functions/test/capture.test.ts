// capture-lead (slice 4.3): the JSON values it hands to Postgres. postgres.js turns an object given to a jsonb parameter into JSON itself; a
// string that is already JSON (JSON.stringify(x)) is encoded a second time and stored as a jsonb STRING, so a lead's answers would be a text
// value and not an object (found by the slice 4.2 builder, measured jsonb_typeof = 'string'). These tests capture a lead through the function
// and look at the stored types. The site's signing key is seeded the way staging has it (a Vault secret and an api_keys row); the throwaway
// cluster has no Vault, so the test makes the one table the key lookup reads.
import { handle } from '../capture-lead/index.ts';
import { sign } from '../_shared/signature.ts';
import { assert, eq, SITE_A, t, WS_A, withSql } from './util.ts';

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

async function post(body: unknown, key: string = KEY): Promise<{ status: number; text: string }> {
  const text = JSON.stringify(body);
  const path = `/capture-lead?site=${SITE_A}`;
  const res = await handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-signature': await sign(key, 'POST', path, text) }, body: text }));
  return { status: res.status, text: await res.text() };
}

t('capture-lead: a captured lead stores answers and marketing consent as JSON OBJECTS (not as text), in the lead and in the consent ledger', async () => {
  await seedKey();
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
