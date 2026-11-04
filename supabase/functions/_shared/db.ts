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

export type Refusal = { status: number; code: string; kind: 'refused' | 'quota' | 'suspended' | null; msg: string; path?: string; row?: string };
/** migration 14: 'I-ANSWER <key>: <plain words>' -> the field and the words; anything that does not match the pattern gets fixed words */
export function answerProblem(message: string): { path: string; msg: string } | null {
  const m = /I-ANSWER ([A-Za-z][A-Za-z0-9_]{0,39}): ([A-Za-z0-9 ().,'\-]{1,160}?)(?:\n|$| CONTEXT)/.exec(message);
  return m ? { path: m[1], msg: m[2] } : null;
}

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
  // migration 12 (slice 5.1): a save on top of a newer version. A conflict, not an attack, so no security event (kind null). The one refusal that
  // keeps the database's words, because they are the row id and the newest version and nothing else; a message of any other shape gets fixed words.
  if (has('S-STALE')) {
    const m = /S-STALE: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} was saved at version [0-9]+ by someone else)/.exec(message);
    return { status: 409, code: 'S-STALE', kind: null, msg: m ? m[1] : 'Someone else saved a newer version.' };
  }
  // migration 12 (slice 5.1): input the database refused. Plain input problems, not walls, so no security event (kind null); the words are fixed
  // because the database message carries the value (an address, an email, a secret name).
  if (has('I-EMAIL')) return { status: 422, code: 'I-EMAIL', kind: null, msg: 'An email address is not valid, or there are more than ten.' };
  if (has('I-URL')) return { status: 422, code: 'I-URL', kind: null, msg: 'Use a public web address that starts with https://.' };
  if (has('I-SECRET-REF')) return { status: 422, code: 'I-SECRET-REF', kind: null, msg: 'The secret for this connection is not valid.' };
  if (has('S-LAST-OWNER')) return { status: 409, code: 'S-LAST-OWNER', kind: null, msg: 'A business keeps at least one owner.' };
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
  // migration 15 (work order 02): the CRM map and the import. Input problems (kind null). The field a map names is a key the database already
  // limited to [a-z][a-zA-Z0-9_], so it may be named; a row's reason is the contract's words (answerProblem's pattern), never a value from the file.
  // I-IMPORT comes before I-ANSWER: its words are a row's I-ANSWER words.
  if (has('T-FIELD')) {
    const m = /T-FIELD ([a-z][a-zA-Z0-9_]{0,60}):/.exec(message);
    return { status: 422, code: 'T-FIELD', kind: null, msg: m ? `"${m[1]}" is not a field of this business's forms.` : 'The map names a field this business does not have.', path: 'columns' };
  }
  if (has('T-COLUMNS') || has('T-VALUE-MAPS')) return { status: 422, code: 'T-COLUMNS', kind: null, msg: 'Each column needs a header and one of our fields, no two columns share a header, and value maps are an object.' };
  if (has('T-NAME')) return { status: 409, code: 'T-NAME', kind: null, msg: 'Another map of this business has that name.' };
  if (has('I-CONSENT')) return { status: 422, code: 'I-CONSENT', kind: null, msg: 'Tick "These people agreed to be contacted by my business" to import.' };
  if (has('I-DUPLICATES')) return { status: 422, code: 'I-DUPLICATES', kind: null, msg: 'Choose skip or add for the duplicates.' };
  if (has('I-ROWS')) return { status: 422, code: 'I-ROWS', kind: null, msg: 'An import takes 1 to 5000 rows, the file\'s name and its fingerprint.' };
  if (has('I-IMPORT')) {
    const m = /I-IMPORT line ([0-9]{1,7}) ([A-Za-z][A-Za-z0-9_]{0,60}): ([A-Za-z0-9 ().,'\-]{1,160}?)(?:\n|$| CONTEXT)/.exec(message);
    return { status: 422, code: 'I-IMPORT', kind: null, msg: m ? `Line ${m[1]}: ${m[3]}. Nothing was imported.` : 'A row is not valid. Nothing was imported.', path: m ? m[2] : '', row: m ? m[1] : undefined };
  }
  // migration 14 (work order 01): the CRM's edit, list and bulk calls
  if (has('I-ANSWER')) { const a = answerProblem(message); return { status: 400, code: 'I-ANSWER', kind: null, msg: a ? a.msg : 'A value is not valid.', path: a ? a.path : '' }; }
  if (has('I-UNKNOWN')) return { status: 400, code: 'I-UNKNOWN', kind: null, msg: 'This lead has no such field.' };
  if (has('S-CONSENT')) return { status: 403, code: 'S-CONSENT', kind: 'refused', msg: 'The consent record cannot be changed.' };
  if (has('S-CONFIRM')) return { status: 409, code: 'S-CONFIRM', kind: null, msg: 'Deleting leads needs the confirm step.' };
  if (has('S-QUERY')) return { status: 422, code: 'S-QUERY', kind: null, msg: 'Sort and filter on the list\'s columns only; send 1 to 500 leads, at most 200 a page.' };
  return null;
}

/** Record a refusal (or a bad token) as a security event, in a call of its own. Never fails the request. */
export async function recordEvent(sql: Sql, kind: string, code: string, o: { workspace?: string | null; site?: string | null; actor?: string | null; ipHash?: string | null; fn: string; reason?: string }): Promise<void> {
  try {
    await sql`select service.record_security_event(${kind}, ${code}, ${o.workspace ?? null}::uuid, ${o.site ?? null}::uuid, ${o.actor ?? null}::uuid, ${o.ipHash ?? null}, ${{ fn: o.fn, ...(o.reason ? { reason: o.reason } : {}) }}::jsonb)`;
  } catch (e) { console.error('security event not recorded', String(e).slice(0, 200)); }
}

/** Run `fn` on a transaction that acts as the CALLER under Row Level Security (slice 5.2: lead-export reads leads the way the dashboard would).
 *  The connection has stepped down to omnikom_fn (no table is readable); inside this transaction only, it takes the role `authenticated` and the
 *  caller's verified claims, which is exactly the state a signed-in browser's request has, so every policy answers as it does for that person.
 *  `set local` ends with the transaction: afterwards the connection is omnikom_fn again. SET ROLE is checked against the session user (postgres),
 *  which Supabase makes a member of authenticated; fail closed if it is not (the statement throws and nothing is read). */
export async function asCaller<T>(sql: Sql, claims: { sub: string; aal: string; role: string; email: string | null }, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return await sql.begin(async (tx: Sql) => {
    await tx.unsafe('set local role authenticated');
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('request.jwt.claim.sub', ${claims.sub}, true)`;
    return await fn(tx);
  });
}
