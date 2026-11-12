// The frame every dashboard function (user JWT) runs in (slice 4.2): one place for the steps that must not differ between them.
//   OPTIONS (a browser's CORS preflight, slice 5.2) -> 204 before anything else, then
//   POST only (405) -> body cap 256 KiB, or the function's own `maxBody` (work order 02: an import file) (413) -> the user's JWT checked in code (401 S-AUTH + an auth-refused security event (reason bad-jwt); the gateway's
//   verify_jwt is the first wall, this is the second) -> JSON object body (400 BODY) -> the function's own steps with a connection
//   whose every statement steps down to omnikom_fn -> a refusal from the database becomes its platform code and status, and a security event
//   (code, workspace when known, actor = the login) -> anything else is a plain 500 that says nothing about the cause.
import { verifyUserJwt, sqlClaims, type Claims } from './auth.ts';
import { connect, ConfigError, refusal, recordEvent, type Sql } from './db.ts';
import { MAX_BODY, problem, sha256Hex, type FieldProblem } from './http.ts';

export type Ctx = {
  sql: Sql; claims: Claims; sub: string; jwtClaims: { sub: string; aal: string; role: string; email: string | null }; fn: string;
  /** the workspace this call is about, once known: refusals after that are recorded against it */
  workspace: string | null;
  site: string | null;
};
export type Run = (c: Ctx, body: Record<string, unknown>) => Promise<Response>;
export type Frame = { maxBody?: number };

export function jwksUrl(): string {
  return Deno.env.get('JWKS_URL') || `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
}

// ---------- CORS for the dashboard (slice 5.2 item 10) ----------
// A browser asks first (OPTIONS) whether the dashboard's address may call the function. The answer names that one address, never '*', and only when
// it is in DASHBOARD_ORIGINS (a function secret: a comma-separated list; staging holds the vite ports on localhost and the future app address).
// An origin that is not in the list gets no CORS header at all, so the browser blocks the call; a call without an Origin header (a server, the CLI)
// is unaffected. The same Allow-Origin goes on every answer of a call that had an allowed Origin, refusals included, or the browser would hide a
// 401 or a 422 behind a CORS error.
export function allowedOrigins(): string[] {
  return (Deno.env.get('DASHBOARD_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(s => s && s !== '*');
}
export function corsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin');
  if (!origin || !allowedOrigins().includes(origin)) return null;
  return { 'access-control-allow-origin': origin, vary: 'Origin' };
}
const PREFLIGHT = { 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-max-age': '600' };
const EXPOSED = 'content-disposition, x-omnikom-export-capped';

export async function dashboard(req: Request, fn: string, run: Run, o: Frame = {}): Promise<Response> {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...(cors ? { ...cors, ...PREFLIGHT } : {}) } });
  const res = await answer(req, fn, run, o);
  if (!cors) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  headers.set('access-control-expose-headers', EXPOSED);
  return new Response(res.body, { status: res.status, headers });
}

async function answer(req: Request, fn: string, run: Run, o: Frame): Promise<Response> {
  if (req.method !== 'POST') return problem(405, 'METHOD', 'POST only.');
  const text = await req.text();
  if (text.length > (o.maxBody ?? MAX_BODY)) return problem(413, 'SIZE', 'This request is too large.');
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = ip ? await sha256Hex(`${fn}:${ip}`) : null;
  let sql: Sql | null = null;
  try {
    sql = await connect();
    const claims = await verifyUserJwt(req, { jwksUrl: jwksUrl() });
    if (!claims) {
      await recordEvent(sql, 'auth-refused', 'S-AUTH', { fn, ipHash, reason: 'bad-jwt' });
      return problem(401, 'S-AUTH', 'Please sign in again.');
    }
    let body: unknown;
    try { body = JSON.parse(text); } catch { return problem(400, 'BODY', 'Send the request as JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return problem(400, 'BODY', 'Send the request as a JSON object.');
    const c: Ctx = { sql, claims, sub: claims.sub, jwtClaims: sqlClaims(claims), fn, workspace: null, site: null };
    try {
      return await run(c, body as Record<string, unknown>);
    } catch (e) {
      if (e instanceof ConfigError) throw e;
      const r = refusal(String(e));
      if (!r) throw e;
      if (r.kind) await recordEvent(sql, r.kind, r.code, { workspace: c.workspace, site: c.site, actor: c.sub, ipHash, fn });
      return problem(r.status, r.code, r.msg, r.path !== undefined ? [{ code: r.code, path: r.path, msg: r.msg, ...(r.row ? { row: r.row } : {}) }] : undefined);
    }
  } catch (e) {
    console.error(fn, String(e).slice(0, 300));
    if (e instanceof ConfigError) return problem(500, 'CONFIG', 'Not configured.');
    return problem(500, 'SERVER', 'Something went wrong on our side.');
  } finally {
    if (sql) await sql.end({ timeout: 2 });
  }
}

export const badBody = (problems: FieldProblem[]) => problem(400, 'BODY', 'Something is missing or not valid.', problems);
