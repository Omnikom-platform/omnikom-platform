// The database door of every dashboard and runner function (slice 4.2). The pattern of capture-lead, moved here and widened:
//  * connect(): one connection (max 1, prepare false), and the very next statement is `set role omnikom_fn` (migration 8): from there
//    on only service.* functions can be called, no table is readable or writable (ASVS 13.2.2). Fail closed: when the step-down
//    fails the connection is closed and ConfigError is thrown, and the caller answers 500 CONFIG. Nothing is ever run as postgres.
//  * withDb(fn): connect, run, and always close (end with a 2 second timeout).
//  * refusal(message): what the database said no to, as a platform code, an HTTP status and plain words. The words are fixed here;
//    the database message is never echoed (it can name a field or a value).
//  * recordEvent: a refusal rolled its own transaction back, so the security event is a call of its own (service.record_security_event).
// capture-lead keeps its own copy of refusal (not edited in slice 4.2); the follow-up is one refusal in _shared.
import postgres from 'npm:postgres@3.4.5';

// deno-lint-ignore no-explicit-any
export type Sql = any;
export class ConfigError extends Error {}

export async function connect(): Promise<Sql> {
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new ConfigError('SUPABASE_DB_URL is not set');
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await sql.unsafe('set role omnikom_fn');
  } catch (e) {
    await sql.end({ timeout: 2 }).catch(() => {});
    throw new ConfigError('could not step down to omnikom_fn: ' + String(e).slice(0, 160));
  }
  return sql;
}

export async function withDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = await connect();
  try { return await fn(sql); } finally { await sql.end({ timeout: 2 }); }
}

export type Refusal = { status: number; code: string; kind: 'refused' | 'quota' | 'suspended' | null; msg: string };

// kind 'refused' = a wall said no (recorded in security_events); null = a plain input problem (not a security event)
export function refusal(message: string): Refusal | null {
  const has = (c: string) => message.includes(c);
  if (has('S-NOT-FOUND')) return { status: 404, code: 'S-NOT-FOUND', kind: 'refused', msg: 'Not found.' };
  if (has('S-AUTH')) return { status: 401, code: 'S-AUTH', kind: 'refused', msg: 'Please sign in again.' };
  if (has('S-OWN-ONLY')) return { status: 403, code: 'S-OWN-ONLY', kind: 'refused', msg: 'You can only change your own items.' };
  if (has('S-ROLE')) return { status: 403, code: 'S-ROLE', kind: 'refused', msg: 'Your role cannot do this.' };
  if (has('S-LOCKED')) return { status: 403, code: 'S-LOCKED', kind: 'refused', msg: 'This text is locked; ask Omnikom to change it.' };
  if (has('S-SIGNOFF')) return { status: 403, code: 'S-SIGNOFF', kind: 'refused', msg: 'Changing this needs a sign-off from Omnikom.' };
  if (has('S-SEED-ACTOR')) return { status: 403, code: 'S-SEED-ACTOR', kind: 'refused', msg: 'Not allowed.' };
  if (has('S-SINGLETON')) return { status: 409, code: 'S-SINGLETON', kind: 'refused', msg: 'There is already one; edit it.' };
  if (has('S-JOB-STATE')) return { status: 409, code: 'S-JOB-STATE', kind: 'refused', msg: 'That is not possible in the build\'s current state.' };
  if (has('S-JOB-BUSY')) return { status: 409, code: 'S-JOB-BUSY', kind: 'refused', msg: 'Another build of this site is running.' };
  if (has('S-WORKSPACE-SUSPENDED')) return { status: 409, code: 'S-WORKSPACE-SUSPENDED', kind: 'suspended', msg: 'This workspace is suspended.' };
  if (has('S-WORKSPACE-STATE')) return { status: 409, code: 'S-WORKSPACE-STATE', kind: 'refused', msg: 'This workspace cannot publish right now.' };
  if (has('S-SITE-PAUSED')) return { status: 409, code: 'S-SITE-PAUSED', kind: 'suspended', msg: 'This site is paused.' };
  if (has('S-KIND')) return { status: 422, code: 'S-KIND', kind: 'refused', msg: 'This kind of item cannot be published.' };
  // migration 11, the second layer: the function validated first (422 VALIDATION), so this fires only when something else got past it
  if (has('I-NOT-READY')) return { status: 422, code: 'I-NOT-READY', kind: 'refused', msg: 'Some items are not ready to publish.' };
  if (has('S-COLLECTION')) return { status: 422, code: 'S-COLLECTION', kind: 'refused', msg: 'This site has no such collection.' };
  if (has('S-QUOTA')) return { status: 429, code: 'S-QUOTA', kind: 'quota', msg: 'Please try again later.' };
  if (has('S-NOTE')) return { status: 400, code: 'LENGTH', kind: null, msg: 'A note is at most 2000 characters.' };
  if (has('I-MEDIA-TYPE')) return { status: 415, code: 'I-MEDIA-TYPE', kind: null, msg: 'Use a jpg, png, webp, heic or pdf file.' };
  if (has('I-MEDIA-SIZE')) return { status: 413, code: 'I-MEDIA-SIZE', kind: null, msg: 'This file is too large or empty.' };
  if (has('consent text required')) return { status: 400, code: 'REQUIRED', kind: null, msg: 'This is needed.' };
  return null;
}

/** Record a refusal (or a bad token) as a security event, in a call of its own. Never fails the request. */
export async function recordEvent(sql: Sql, kind: string, code: string, o: { workspace?: string | null; site?: string | null; actor?: string | null; ipHash?: string | null; fn: string; reason?: string }): Promise<void> {
  try {
    await sql`select service.record_security_event(${kind}, ${code}, ${o.workspace ?? null}::uuid, ${o.site ?? null}::uuid, ${o.actor ?? null}::uuid, ${o.ipHash ?? null}, ${{ fn: o.fn, ...(o.reason ? { reason: o.reason } : {}) }}::jsonb)`;
  } catch (e) { console.error('security event not recorded', String(e).slice(0, 200)); }
}
