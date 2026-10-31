// Helpers for the Deno tests of the dashboard Edge Functions (slice 4.2). The environment (database, fake JWKS / Storage / GitHub, the
// private half of this run's ES256 key) is set by supabase/functions/test/run.mjs through harness.mjs; nothing here is a real secret.
import postgres from 'npm:postgres@3.4.5';

export const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
export const WS_B = 'bbbbbbbb-0000-0000-0000-000000000000';
export const SITE_A = 'aaaaaaaa-0000-0000-0000-00000000517e';
export const SITE_B = 'bbbbbbbb-0000-0000-0000-00000000517e';
// the seeded logins (tools/omnikom-cli/lib/identity.mjs PERSONS)
export const SUB = {
  'owner-a': '00000000-0000-0000-0000-00000000000a', 'owner-b': '00000000-0000-0000-0000-00000000000b',
  'member-a1': '00000000-0000-0000-0000-0000000000a1', 'member-a2': '00000000-0000-0000-0000-0000000000a2',
  staff: '00000000-0000-0000-0000-00000000005f', nobody: '00000000-0000-0000-0000-0000000000f0',
} as const;
export type Who = keyof typeof SUB;

export const env = (k: string): string => { const v = Deno.env.get(k); if (!v) throw new Error(`${k} is not set: run these tests through supabase/functions/test/run.mjs`); return v; };

/** a test whose timers and sockets are the functions' own (AbortSignal.timeout, the Postgres client) */
export const t = (name: string, fn: () => void | Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });

// ---------- tokens ----------
const b64u = (b: Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  let s = ''; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
let privKey: CryptoKey | null = null;
async function key(): Promise<CryptoKey> {
  if (!privKey) {
    const { kid: _k, alg: _a, ...jwk } = JSON.parse(env('TEST_JWK_PRIVATE'));
    privKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  return privKey;
}
export type MintOpts = { aal?: string; exp?: number; aud?: string | string[]; sub?: string; key?: CryptoKey; kid?: string; alg?: string; email?: string };
export async function mint(who: Who | null, o: MintOpts = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: o.alg ?? 'ES256', typ: 'JWT', kid: o.kid ?? 'test-key-1' };
  const payload = { sub: o.sub ?? (who ? SUB[who] : SUB.nobody), aal: o.aal ?? (who === 'staff' ? 'aal2' : 'aal1'), role: 'authenticated', aud: o.aud ?? 'authenticated', exp: o.exp ?? now + 3600, iat: now, email: o.email ?? `${who ?? 'x'}@test` };
  const signing = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, o.key ?? await key(), new TextEncoder().encode(signing)));
  return `${signing}.${b64u(sig)}`;
}

// ---------- calling a function ----------
export type Handle = (req: Request) => Promise<Response>;
export type Answer = { status: number; json: Record<string, unknown> | null; text: string };
export async function call(handle: Handle, name: string, body: unknown, who: Who | null | { token: string | null } = null, init: { method?: string; raw?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = who !== null && typeof who === 'object' ? who.token : (who ? await mint(who) : null);
  if (token) headers.authorization = `Bearer ${token}`;
  const method = init.method ?? 'POST';
  const res = await handle(new Request(`http://localhost/${name}`, { method, headers, body: method === 'GET' ? undefined : (init.raw ?? JSON.stringify(body)) }));
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* 204 or not JSON */ }
  return { status: res.status, json, text };
}

// ---------- the database, as the superuser (to seed and to look; the functions themselves step down to omnikom_fn) ----------
// deno-lint-ignore no-explicit-any
export type Sql = any;
export async function withSql<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = postgres(env('TEST_DB_URL'), { max: 1, prepare: false });
  try { return await fn(sql); } finally { await sql.end({ timeout: 2 }); }
}
/** the team row ids of workspace A (Agent One is member-a1's, Agent Two is member-a2's) */
export async function teamRows(): Promise<{ one: string; two: string }> {
  return await withSql(async sql => {
    const r = await sql`select c.id, v.data ->> 'name' as name from public.content_rows c join public.content_versions v on v.row_id = c.id and v.n = 1
      where c.workspace_id = ${WS_A} and c.collection = 'team'`;
    return { one: r.find((x: { name: string }) => x.name === 'Agent One').id, two: r.find((x: { name: string }) => x.name === 'Agent Two').id };
  });
}
export async function securityEvents(where: { actor?: string; code?: string; kind?: string } = {}): Promise<number> {
  return await withSql(async sql => {
    const [r] = await sql`select count(*)::int as n from public.security_events
      where (${where.actor ?? null}::uuid is null or actor = ${where.actor ?? null}::uuid) and (${where.code ?? null}::text is null or code = ${where.code ?? null}::text) and (${where.kind ?? null}::text is null or kind = ${where.kind ?? null}::text)`;
    return r.n;
  });
}

// ---------- the fake outside services ----------
export const fake = {
  async recorded(): Promise<{ github: { authorized: boolean; accept: string; body: { event_type: string; client_payload: Record<string, unknown> } | null }[]; storage: { path: string; authorized: boolean }[] }> {
    return await (await fetch(`${env('TEST_FAKE_BASE')}/__recorded`)).json();
  },
  async reset() { await (await fetch(`${env('TEST_FAKE_BASE')}/__reset`, { method: 'POST' })).text(); },
  async githubStatus(code: number) { await (await fetch(`${env('TEST_FAKE_BASE')}/__github-status?code=${code}`, { method: 'POST' })).text(); },
};

export function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error('ASSERT: ' + msg); }
export function eq<T>(got: T, want: T, msg: string) { if (got !== want) throw new Error(`ASSERT: ${msg}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }

// ---------- photos ----------
export async function photoContract() {
  await withSql(sql => sql`update public.site_contracts set resolved = jsonb_set(resolved, '{collections,listings,fields,photo}', '{"type":"image","media":{"minWidth":1200,"rightsConfirm":true}}'::jsonb) where workspace_id = ${WS_A} and active`);
}
export async function mkMedia(ws: string, o: { width?: number | null; processed?: boolean; exif?: boolean; rights?: boolean } = {}): Promise<string> {
  return await withSql(async sql => {
    const [m] = await sql`insert into public.media (workspace_id, path, width, processed, exif_stripped, rights_confirmed, uploaded_by)
      values (${ws}::uuid, ${ws}::text || '/' || gen_random_uuid()::text || '.jpg', ${o.width ?? null}, ${o.processed ?? false}, ${o.exif ?? false}, ${o.rights ?? false}, ${SUB['owner-a']}::uuid) returning id`;
    return m.id;
  });
}

