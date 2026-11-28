// E5-SIG (product row E5): a well-formed post whose signature no key of its site verifies costs no database connection while the function holds that
// site's keys (_shared/site-keys.ts, 10 s). A post that a held key verifies is never accepted from memory: it goes on to the database, which alone says if
// the key is still active. The door is measured as capture.test.ts SEC-LEAD-ORDER does: DB_POOLER_URL unset, so a post that reaches the database answers
// 500 CONFIG and one that does not is seen by its own answer. The Vault shim and the api_keys rows are seeded as capture.test.ts seedKey does.
import { handle } from '../capture-lead/index.ts';
import { sign } from '../_shared/signature.ts';
import { assert, crmForms, eq, freshT, SITE_A, SITE_B, t, WS_A, WS_B, securityEvents, sha256, withSql } from './util.ts';

type Key = { id: string; secret: string };
type Cache = { get(s: string): Key[] | null; put(s: string, k: Key[]): void; clear(): void };
const kit = () => import('../_shared/site-keys.ts') as unknown as Promise<{
  SiteKeyCache: new (ttl: number, max: number, now?: () => number) => Cache; KEY_CACHE_MS: number; siteKeys: Cache;
}>;
const fresh = async () => { const k = await kit(); k.siteKeys.clear(); return k; };

const KEY = 'test-site-signing-key-not-a-secret', REF = 'site-test-demo-a-key-1';
const KEY_B = 'test-site-b-signing-key-not-a-secret', REF_B = 'site-test-demo-b-key-1';
const WRONG = 'a-key-that-was-never-issued';

async function seed(site: string, ws: string, ref: string, key: string) {
  const hash = await sha256(key);
  await withSql(async sql => {
    const [v] = await sql`select to_regclass('vault.decrypted_secrets') as t`;
    if (!v.t) {
      await sql.unsafe('create schema if not exists vault');
      await sql.unsafe('create table vault.decrypted_secrets (name text primary key, decrypted_secret text)');
    }
    await sql`insert into vault.decrypted_secrets (name, decrypted_secret) values (${ref}, ${key}) on conflict (name) do nothing`;
    const have = await sql`select 1 from public.api_keys where vault_ref = ${ref}`;
    if (!have.length) await sql`insert into public.api_keys (site_id, workspace_id, kind, label, key_hash, vault_ref) values (${site}::uuid, ${ws}::uuid, 'site-signing', 'sitekey test key', ${hash}, ${ref})`;
  });
}
async function unseed(ref: string) {
  await withSql(async sql => {
    await sql`delete from public.api_keys where vault_ref = ${ref}`;
    await sql`delete from vault.decrypted_secrets where name = ${ref}`;
  });
}
const revoke = (ref: string) => withSql(async sql => { await sql`update public.api_keys set revoked_at = now() where vault_ref = ${ref}`; });
// the file posts about 30 good leads per workspace; with capture.test.ts that passes the platform's 60 per hour (S-QUOTA, 429), so the test workspaces get a high workspace limit
const liftCap = (ws: string) => withSql(async sql => { await sql`insert into public.workspace_limits (workspace_id, key, value, note) values (${ws}::uuid, 'leads_per_hour_workspace', 100000, 'E5-SIG test') on conflict (workspace_id, key) do update set value = excluded.value`; });
const seedAll = async () => { await crmForms(); await liftCap(WS_A); await liftCap(WS_B); await seed(SITE_A, WS_A, REF, KEY); await seed(SITE_B, WS_B, REF_B, KEY_B); };

const doorShut = async <T>(fn: () => Promise<T>): Promise<T> => {
  const old = Deno.env.get('DB_POOLER_URL'); Deno.env.delete('DB_POOLER_URL');
  try { return await fn(); } finally { if (old !== undefined) Deno.env.set('DB_POOLER_URL', old); }
};

type Send = { site?: string; key?: string; path?: string; signPath?: string; body?: string; signBody?: string; method?: string; hdr?: (h: string) => string; t?: number };
let n = 0;
const goodBody = () => JSON.stringify({ form: 'contact', page: '/contact', consentText: 'I agree to be contacted', name: `Sitekey Lead ${++n}`, email: `sk${n}@example.com` });
async function send(o: Send = {}): Promise<{ status: number; text: string }> {
  const path = o.path ?? `/capture-lead?site=${o.site ?? SITE_A}`;
  const text = o.body ?? goodBody();
  let header = await sign(o.key ?? KEY, o.method ?? 'POST', o.signPath ?? path, o.signBody ?? text, o.t ?? freshT());
  if (o.hdr) header = o.hdr(header);
  const res = await handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-signature': header }, body: text }));
  return { status: res.status, text: await res.text() };
}
const code = (r: { text: string }) => { try { return JSON.parse(r.text).problems?.[0]?.code ?? ''; } catch { return ''; } };
const snap = () => withSql(async sql => ({
  leads: (await sql`select count(*)::int as n from public.leads`)[0].n as number,
  claims: (await sql`select count(*)::int as n from private.signature_seen`)[0].n as number,
  events: await securityEvents({ kind: 'bad-signature', code: 'SIGNATURE' }),
}));
const prime = async (site = SITE_A, key = KEY) => { const r = await send({ site, key }); assert(r.status !== 500, 'priming reached the database: ' + r.text); return r; };

t('sitekey [E5-SIG] U1 an entry lives for its ttl and is then gone', async () => {
  const { SiteKeyCache } = await fresh(); let now = 0;
  const c = new SiteKeyCache(1000, 3, () => now), keys = [{ id: 'k1', secret: 's1' }];
  c.put(SITE_A, keys); now = 999;
  eq(c.get(SITE_A), keys, 'held at 999');
  now = 1000;
  eq(c.get(SITE_A), null, 'gone at 1000'); eq(c.get(SITE_A), null, 'and gone again');
});

t('sitekey [E5-SIG] U2 an empty list removes the entry and stores none', async () => {
  const { SiteKeyCache } = await fresh(); const c = new SiteKeyCache(1000, 3, () => 0);
  c.put(SITE_A, [{ id: 'k1', secret: 's1' }]); c.put(SITE_A, []);
  eq(c.get(SITE_A), null, 'the entry was removed'); eq(c.get(SITE_B), null, 'a site never put is null');
});

t('sitekey [E5-SIG] U3 the cap drops the oldest, a refill is the newest', async () => {
  const { SiteKeyCache } = await fresh(); const c = new SiteKeyCache(1000, 3, () => 0), k = [{ id: 'k', secret: 's' }];
  for (const s of ['a', 'b', 'c', 'd']) c.put(s, k);
  eq(c.get('a'), null, 'a is gone'); eq(c.get('b') !== null && c.get('c') !== null && c.get('d') !== null, true, 'b, c, d held');
  c.put('b', k); c.put('e', k);
  eq(c.get('c'), null, 'c is gone'); eq(c.get('b') !== null, true, 'b held');
});

t('sitekey [E5-SIG] U4 the site id is case-blind and clear empties', async () => {
  const { SiteKeyCache } = await fresh(); const c = new SiteKeyCache(1000, 3, () => 0), k = [{ id: 'k', secret: 's' }];
  c.put(SITE_A, k);
  eq(c.get('AAAAAAAA-0000-0000-0000-00000000517E') !== null, true, 'found under the upper-case id');
  c.clear(); eq(c.get(SITE_A), null, 'cleared');
});

t('sitekey [E5-SIG] C0 control: cold cache, door shut, a wrong-key post reaches the door', async () => {
  await fresh(); await seedAll();
  await doorShut(async () => { const r = await send({ key: WRONG }); eq(r.status, 500, 'reaches the door: ' + r.text); eq(code(r), 'CONFIG', 'CONFIG'); });
});

t('sitekey [E5-SIG] C1 a wrong-key post is refused from memory, with the database path bytes and no event', async () => {
  await fresh(); await seedAll();
  const g = await send(); eq(g.status, 202, 'a good post: ' + g.text);
  const w = await send({ key: WRONG }); eq(w.status, 401, 'door open: ' + w.text); eq(code(w), 'SIGNATURE', 'SIGNATURE');
  await doorShut(async () => {
    const before = await snap();
    const r = await send({ key: WRONG });
    eq(r.status, 401, 'door shut: ' + r.text); eq(code(r), 'SIGNATURE', 'SIGNATURE'); eq(r.text, w.text, 'the same bytes as the database path');
    eq((await snap()).events - before.events, 0, 'no security event');
  });
});

t('sitekey [E5-SIG] C2 thirteen bad posts are refused from memory and leave nothing', async () => {
  await fresh(); await seedAll(); await prime(SITE_A, KEY); await prime(SITE_B, KEY_B);
  const X = 'b'.repeat(64), Y = 'c'.repeat(64), base = `/capture-lead?site=${SITE_A}`, upper = SITE_A.toUpperCase();
  const cases: [string, Send][] = [
    ['1 wrong key', { key: WRONG }],
    ['2 body changed after signing', { signBody: goodBody() }],
    ['3 signed with no visitor, sent with one', { signPath: base, path: base + '&visitor=' + X }],
    ['4 signed with a visitor, sent with none', { signPath: base + '&visitor=' + X, path: base }],
    ['5 signed with visitor X, sent with Y', { signPath: base + '&visitor=' + X, path: base + '&visitor=' + Y }],
    ["6 A's key over B's path, posted to A", { signPath: `/capture-lead?site=${SITE_B}` }],
    ["7 B's key over A's path, posted to A", { key: KEY_B }],
    ['8 header t plus 1', { hdr: h => h.replace(/t=(\d+)/, (_m, d) => 't=' + (Number(d) + 1)) }],
    ['9 v1 of zeros', { hdr: h => h.replace(/v1=.*/, 'v1=' + '0'.repeat(64)) }],
    ['10 signed as GET', { method: 'GET' }],
    ['11 wrong v1, header in spaces', { hdr: h => '  ' + h.replace(/v1=.*/, 'v1=' + 'd'.repeat(64)) + '  ' }],
    ['12 wrong key, upper-case site id', { key: WRONG, path: `/capture-lead?site=${upper}` }],
    ['13 wrong key, two site parameters', { key: WRONG, path: `/capture-lead?site=${SITE_A}&site=${SITE_B}` }],
  ];
  const { siteKeys } = await kit();
  await doorShut(async () => {
    for (const [name, o] of cases) {
      siteKeys.put(SITE_A, [{ id: 'held', secret: KEY }]);   // the 10 s entry must not run out under a loaded machine: keep it fresh for every case
      const before = await snap();
      const r = await send(o);
      eq(r.status, 401, name + ': ' + r.text); eq(code(r), 'SIGNATURE', name + ' code');
      const after = await snap();
      eq(after.leads, before.leads, name + ': no lead'); eq(after.claims, before.claims, name + ': no claim'); eq(after.events, before.events, name + ': no event');
    }
  });
  const ok = await send(); eq(ok.status, 202, 'the good post still answers 202: ' + ok.text);
});

t('sitekey [E5-SIG] C3 a good post is never accepted from memory', async () => {
  await fresh(); await seedAll(); await prime();
  await doorShut(async () => {
    const forms: [string, Send][] = [['plain', {}], ['in spaces', { hdr: h => ' ' + h + ' ' }], ['t padded to 12 digits', { hdr: h => h.replace(/t=(\d+)/, (_m, d) => 't=' + d.padStart(12, '0')) }]];
    for (const [name, o] of forms) { const r = await send(o); eq(r.status, 500, name + ': ' + r.text); eq(code(r), 'CONFIG', name + ' CONFIG'); }
  });
});

t('sitekey [E5-SIG] C4 a revoked key fails at once', async () => {
  const KEY3 = 'test-site-signing-key-three', REF3 = 'site-test-demo-a-key-3';
  await fresh(); await seedAll(); await seed(SITE_A, WS_A, REF3, KEY3);
  try {
    const a = await send(); eq(a.status, 202, 'KEY: ' + a.text);
    const b = await send({ key: KEY3 }); eq(b.status, 202, 'KEY3 is live: ' + b.text);
    await revoke(REF3);
    const before = await snap();
    const r = await send({ key: KEY3 }); eq(r.status, 401, 'revoked, door open: ' + r.text); eq(code(r), 'SIGNATURE', 'SIGNATURE');
    const after = await snap();
    eq(after.leads, before.leads, 'no lead'); eq(after.events - before.events, 1, 'it went to the database: one event');
    await doorShut(async () => {
      const r2 = await send({ key: KEY3 }); eq(r2.status, 401, 'door shut: the refill dropped it: ' + r2.text);
      const r3 = await send(); eq(r3.status, 500, 'the live key is still held: ' + r3.text); eq(code(r3), 'CONFIG', 'CONFIG');
    });
  } finally { await unseed(REF3); }
});

t('sitekey [E5-SIG] C5 a key minted after the fill is heard after the entry life', async () => {
  const KEY4 = 'test-site-signing-key-four', REF4 = 'site-test-demo-a-key-4';
  await fresh(); await seedAll();
  try {
    const a = await send(); eq(a.status, 202, 'KEY: ' + a.text);
    await seed(SITE_A, WS_A, REF4, KEY4);
    const r = await send({ key: KEY4 }); eq(r.status, 401, 'not heard inside the entry life: ' + r.text);
    await new Promise(ok => setTimeout(ok, 10_300));
    const before = await snap();
    const r2 = await send({ key: KEY4 }); eq(r2.status, 202, 'heard after it: ' + r2.text);
    eq((await snap()).leads - before.leads, 1, 'its lead is stored');
    const r3 = await send(); eq(r3.status, 202, 'KEY still answers 202: ' + r3.text);
  } finally { await unseed(REF4); }
});

t('sitekey [E5-SIG] C6 a flood of forged posts costs one event per fill', async () => {
  await fresh(); await seedAll();
  let before = await snap();
  for (let i = 0; i < 25; i++) { const r = await send({ key: WRONG }); eq(r.status, 401, 'flood ' + i + ': ' + r.text); }
  eq((await snap()).events - before.events, 1, 'exactly one event for 25 posts');
  const k = await fresh(); before = await snap();
  for (let i = 0; i < 25; i++) { k.siteKeys.clear(); const r = await send({ key: WRONG }); eq(r.status, 401, 'control ' + i + ': ' + r.text); }
  eq((await snap()).events - before.events, 25, 'control: 25 events when nothing is held');
});

t('sitekey [E5-SIG] C7 what is not held reaches the database', async () => {
  await fresh(); await seedAll(); await prime(SITE_B, KEY_B);
  await doorShut(async () => {
    const a = await send({ key: WRONG }); eq(a.status, 500, 'A is not held: ' + a.text); eq(code(a), 'CONFIG', 'CONFIG');
    const ghost = 'dddddddd-0000-0000-0000-00000000517e';
    for (let i = 0; i < 2; i++) { const r = await send({ site: ghost, key: WRONG }); eq(r.status, 500, 'an unknown site is not held, post ' + i + ': ' + r.text); }
  });
});

t('sitekey [E5-SIG] C8 acceptance is unchanged for an upper-case site id', async () => {
  await fresh(); await seedAll(); await prime();
  const before = await snap();
  const r = await send({ path: `/capture-lead?site=${SITE_A.toUpperCase()}` });
  eq(r.status, 202, r.text); eq((await snap()).leads - before.leads, 1, 'one lead stored');
});

t('sitekey [E5-SIG] C9 a key minted after the fill is refused inside the window and heard after KEY_CACHE_MS', async () => {
  const K5 = 'test-site-signing-key-five', R5 = 'site-test-demo-a-key-5', K6 = 'test-site-signing-key-six', R6 = 'site-test-demo-a-key-6';
  const { KEY_CACHE_MS } = await fresh(); await seedAll(); await seed(SITE_A, WS_A, R5, K5);
  try {
    const a = await send({ key: K5 }); eq(a.status, 202, 'the old key is live, and its post filled the entry: ' + a.text);
    await seed(SITE_A, WS_A, R6, K6);   // the new key is minted after the fill
    const before = await snap();
    for (let i = 0; i < 2; i++) { const r = await send({ key: K6 }); eq(r.status, 401, 'inside the window every post with the new key is refused, post ' + i + ': ' + r.text); }
    eq((await snap()).leads - before.leads, 0, 'no lead stored inside the window');
    await new Promise(ok => setTimeout(ok, Math.min(KEY_CACHE_MS, 10_000) + 300));   // a cache held longer than 10 s must fail the check below, not be waited out (the mutant 'held for an hour' would sit until the harness kills deno)
    const next = await send({ key: K6 }); eq(next.status, 202, 'the first post after KEY_CACHE_MS + 300 ms verifies with the new key: ' + next.text);
    eq((await snap()).leads - before.leads, 1, 'its lead is stored');
  } finally { await unseed(R5); await unseed(R6); }
});
