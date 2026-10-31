// The Node side of the flows: everything that needs the staging secret key lives here and never reaches a page, a trace, a
// screenshot or a log. Variables are read by NAME from the environment (run through tools/with-env.mjs); a missing one is BLOCKED.
// The seeded logins and workspaces are the fixtures of supabase/tests/tenancy.test.sql, written by `omnikom seed test`
// (tools/omnikom-cli/commands/seed.mjs, lib/identity.mjs): same ids and emails.

export const BASE_URL = 'http://localhost:4173';

export const WS = {
  a: { id: 'aaaaaaaa-0000-0000-0000-000000000000', slug: 'test-demo-a', name: 'Demo A', site: 'aaaaaaaa-0000-0000-0000-00000000517e' },
  b: { id: 'bbbbbbbb-0000-0000-0000-000000000000', slug: 'test-demo-b', name: 'Demo B', site: 'bbbbbbbb-0000-0000-0000-00000000517e' },
} as const;

export const PEOPLE = {
  'owner-a': { email: 'owner-a@test', id: '00000000-0000-0000-0000-00000000000a', ws: WS.a },
  'owner-b': { email: 'owner-b@test', id: '00000000-0000-0000-0000-00000000000b', ws: WS.b },
  'member-a1': { email: 'agent1-a@test', id: '00000000-0000-0000-0000-0000000000a1', ws: WS.a },
  'member-a2': { email: 'agent2-a@test', id: '00000000-0000-0000-0000-0000000000a2', ws: WS.a },
} as const;
export type Person = keyof typeof PEOPLE;

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`BLOCKED: ${name} is not set (read by name; run through node tools/with-env.mjs "<env file>" -- ...)`);
  return v;
}

export const supabaseUrl = () => `https://${need('STAGING_SUPABASE_REF')}.supabase.co`;
export const supabaseHost = () => new URL(supabaseUrl()).host;

type Answer = { status: number; json: unknown; text: string };

async function send(url: string, init: RequestInit): Promise<Answer> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

const secretHeaders = () => ({ apikey: need('STAGING_SUPABASE_SECRET_KEY'), authorization: `Bearer ${need('STAGING_SUPABASE_SECRET_KEY')}` });

const why = (a: Answer) => {
  const j = a.json as Record<string, unknown> | null;
  return String((j && (j.msg ?? j.message ?? j.error_description ?? j.error)) ?? a.text).slice(0, 140);
};

/** Auth admin generate_link: a one-time sign-in token hash for a seeded login (no email is sent). The same way personToken does it. */
export async function mintTokenHash(person: Person): Promise<string> {
  const a = await send(`${supabaseUrl()}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...secretHeaders() },
    body: JSON.stringify({ type: 'magiclink', email: PEOPLE[person].email }),
  });
  const hash = (a.json as { hashed_token?: string } | null)?.hashed_token;
  if (a.status !== 200 || !hash) throw new Error(`BLOCKED: Auth generate_link for ${person} answered ${a.status}: ${why(a)} (run omnikom seed test; stop after two failed approaches)`);
  return hash;
}

/** A session access token for a seeded login, in memory only, to set up data AS that person through the functions (server to server). */
export async function personAccessToken(person: Person): Promise<string> {
  const hash = await mintTokenHash(person);
  const v = await send(`${supabaseUrl()}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: need('STAGING_SUPABASE_PUBLISHABLE_KEY') },
    body: JSON.stringify({ type: 'magiclink', token_hash: hash }),
  });
  const token = (v.json as { access_token?: string } | null)?.access_token;
  if (v.status !== 200 || !token) throw new Error(`BLOCKED: Auth verify for ${person} answered ${v.status}: ${why(v)}`);
  return token;
}

/** A read as the service role (the secret key, which bypasses Row-Level Security): the truth the screen is compared with. */
export async function serviceGet<T = unknown>(path: string): Promise<T> {
  const a = await send(`${supabaseUrl()}/rest/v1${path}`, { headers: secretHeaders() });
  if (a.status !== 200) throw new Error(`service read ${path.split('?')[0]} answered ${a.status}: ${why(a)}`);
  return a.json as T;
}

/** The same request a page made, repeated with the service role. Used only by the watched-red mutants (tests/mutants.ts). */
export async function serviceRepeat(url: string, accept: string | undefined): Promise<{ status: number; body: string; contentType: string }> {
  const res = await fetch(url, { headers: { ...secretHeaders(), ...(accept ? { accept } : {}) }, signal: AbortSignal.timeout(30_000) });
  return { status: res.status, body: await res.text(), contentType: res.headers.get('content-type') ?? 'application/json' };
}

/** A platform function called as a person (server to server, so no browser preflight). */
export async function callAs(token: string, fn: string, body: Record<string, unknown>): Promise<Answer> {
  return send(`${supabaseUrl()}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: need('STAGING_SUPABASE_PUBLISHABLE_KEY') },
    body: JSON.stringify(body),
  });
}

export const leadLabel = (l: { name: string | null; email: string | null; phone: string | null }) => l.name || l.email || l.phone || 'No name';

/** Marks every lead the flows create (brief 5.3: test data is marked in its answers). */
export const TEST_MARK = { test: '5.3 flows' } as const;
export const RUN = Date.now().toString(36);
