// The frame every build-runner function runs in (slice 4.3: export-published, job-callback, media-export, media-process-callback).
// The runner is not a person: no JWT (verify_jwt = false in supabase/config.toml), so THIS code is the only wall, and it comes first:
//   method (405) -> the id in the query, for a GET (404 for one that is not a uuid) -> body cap 256 KiB (413) -> X-Runner-Signature checked with
//   RUNNER_KEY over `METHOD`, the path with its query (the /functions/v1 prefix is never signed) and the body (a GET signs an empty body), within
//   300 s (signature.ts) -> a bad or missing signature = 401 SIGNATURE and a security event (kind bad-signature, detail kind 'runner') ->
//   every statement steps down to omnikom_fn (db.ts) -> the registry row of the key is touched (last_used_at) -> a POST body must be a JSON
//   object (400 BODY) -> the function's own steps -> a refusal from the database becomes its platform code and status -> anything else is a
//   plain 500 that says nothing about the cause. Every answer is JSON (or 204) and `cache-control: no-store`.
// A refusal of an authenticated runner (S-JOB-BUSY, S-JOB-STATE, S-NOT-FOUND) is NOT a security event: it is the state machine speaking to a
// caller that holds the key. Only a call that fails the signature is recorded, because that is somebody else.
// RUNNER_KEY is read by name from the function secrets and never printed; a missing one is a 500 CONFIG (nobody is accepted).
import { verify } from './signature.ts';
import { connect, ConfigError, refusal, type Sql } from './db.ts';
import { MAX_BODY, UUID, problem, sha256Hex } from './http.ts';

export type RunnerCtx = { sql: Sql; fn: string; id: string | null; body: Record<string, unknown> };
// keyEnv and header name another machine caller that signs the same way (the daily cron, work order 44: CRON_KEY, X-Cron-Signature); the default is the build runner.
export type RunnerOpts = { fn: string; method: 'GET' | 'POST'; idParam?: string; keyEnv?: string; header?: string };

/** The signed path: "/export-published?job=<id>". The gateway may present the function URL with or without /functions/v1. */
export function pathForSignature(u: URL): string {
  return u.pathname.replace(/^\/functions\/v1/, '') + u.search;
}

async function touchKey(sql: Sql, key: string): Promise<void> {
  try {
    const hash = await sha256Hex(key);
    const rows = await sql`select id, key_hash from service.active_key('runner'::public.api_key_kind)`;
    const mine = rows.find((r: { key_hash: string }) => r.key_hash === hash);
    if (mine) await sql`select service.touch_key(${mine.id}::uuid)`;
  } catch (e) { console.error('runner key not touched', String(e).slice(0, 160)); }
}

export async function runner(req: Request, o: RunnerOpts, run: (c: RunnerCtx) => Promise<Response>): Promise<Response> {
  if (req.method !== o.method) return problem(405, 'METHOD', `${o.method} only.`);
  const url = new URL(req.url);
  let id: string | null = null;
  if (o.idParam) {
    const v = url.searchParams.get(o.idParam) ?? '';
    if (!UUID.test(v)) return problem(404, 'S-NOT-FOUND', 'Not found.');
    id = v.toLowerCase();
  }
  const text = o.method === 'POST' ? await req.text() : '';
  if (text.length > MAX_BODY) return problem(413, 'SIZE', 'This request is too large.');
  const keyEnv = o.keyEnv ?? 'RUNNER_KEY';
  const key = Deno.env.get(keyEnv);
  if (!key) { console.error(o.fn, `${keyEnv} is not set`); return problem(500, 'CONFIG', 'Not configured.'); }
  const signedBody = o.method === 'GET' ? '' : text;
  const signed = await verify(req.headers.get(o.header ?? 'x-runner-signature'), key, o.method, pathForSignature(url), signedBody);
  let sql: Sql | null = null;
  try {
    sql = await connect();
    if (!signed) {
      const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
      const ipHash = ip ? await sha256Hex(`${o.fn}:${ip}`) : null;
      try { await sql`select service.record_security_event('bad-signature', 'SIGNATURE', null, null, null, ${ipHash}, ${{ fn: o.fn, kind: o.keyEnv ? 'cron' : 'runner' }}::jsonb)`; }
      catch (e) { console.error('security event not recorded', String(e).slice(0, 200)); }
      return problem(401, 'SIGNATURE', 'Not accepted.');
    }
    if (!o.keyEnv) await touchKey(sql, key);   // the registry row is the runner key's; the cron key has none
    let body: Record<string, unknown> = {};
    if (o.method === 'POST') {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return problem(400, 'BODY', 'Send the request as JSON.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return problem(400, 'BODY', 'Send the request as a JSON object.');
      body = parsed as Record<string, unknown>;
    }
    try {
      return await run({ sql, fn: o.fn, id, body });
    } catch (e) {
      if (e instanceof ConfigError) throw e;
      const r = refusal(String(e));
      if (!r) throw e;
      return problem(r.status, r.code, r.msg);
    }
  } catch (e) {
    console.error(o.fn, String(e).slice(0, 300));
    if (e instanceof ConfigError) return problem(500, 'CONFIG', 'Not configured.');
    return problem(500, 'SERVER', 'Something went wrong on our side.');
  } finally {
    if (sql) await sql.end({ timeout: 2 });
  }
}
