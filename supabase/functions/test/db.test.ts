// _shared/db.ts: the step-down to omnikom_fn, and the mapping of the database's refusals to statuses.
import { connect, refusal, withDb } from '../_shared/db.ts';
import { dispatch } from '../_shared/dispatch.ts';
import { assert, eq, fake, t } from './util.ts';

t('db: connect() has stepped down: the current role is omnikom_fn and no table can be read', async () => {
  await withDb(async sql => {
    const [r] = await sql`select current_user as u`;
    eq(r.u, 'omnikom_fn', 'current_user');
    let denied = false;
    try { await sql`select count(*) from public.leads`; } catch (e) { denied = String(e).includes('permission denied'); }
    assert(denied, 'a table read is permission denied');
    denied = false;
    try { await sql`select private.is_staff()`; } catch (e) { denied = String(e).includes('permission denied'); }
    assert(denied, 'a private helper is permission denied');
  });
});

t('db: without a database URL connect() throws and nothing is run (fail closed)', async () => {
  const url = Deno.env.get('SUPABASE_DB_URL');
  Deno.env.delete('SUPABASE_DB_URL');
  try {
    let threw = false;
    try { await connect(); } catch { threw = true; }
    assert(threw, 'connect() throws');
  } finally { Deno.env.set('SUPABASE_DB_URL', url!); }
});

t('db: refusal() maps the platform codes to statuses and never echoes the database message', () => {
  const want: [string, number][] = [['S-NOT-FOUND: not found', 404], ['S-OWN-ONLY: own items only', 403], ['S-ROLE: members cannot edit x', 403], ['S-LOCKED: "licence" is locked', 403],
    ['S-SIGNOFF: x', 403], ['S-SEED-ACTOR: x', 403], ['S-SINGLETON: x', 409], ['S-JOB-STATE: x', 409], ['S-JOB-BUSY: x', 409], ['S-WORKSPACE-STATE: x', 409], ['S-WORKSPACE-SUSPENDED: x', 409],
    ['S-SITE-PAUSED: x', 409], ['S-KIND: x', 422], ['S-QUOTA: x', 429], ['S-AUTH: x', 401], ['consent text required', 400], ['I-MEDIA-TYPE: x', 415], ['I-MEDIA-SIZE: x', 413]];
  for (const [msg, status] of want) { const r = refusal(msg); assert(r, msg); eq(r.status, status, msg); assert(!r.msg.includes('licence'), 'no echo'); }
  eq(refusal('boom: something else'), null, 'an unknown error is not a refusal');
});

t('dispatch: no token, no repository, GitHub 204, GitHub 500 and an unreachable GitHub each report honestly', async () => {
  await fake.reset();
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN'), repo = Deno.env.get('GITHUB_REPO'), api = Deno.env.get('GITHUB_API_BASE');
  try {
    eq((await dispatch('publish', { a: 1 })).dispatched, true, '204');
    await fake.githubStatus(500);
    const bad = await dispatch('publish', { a: 1 });
    eq(bad.dispatched, false, '500'); eq(bad.reason, 'github 500', 'reason');
    await fake.reset();
    Deno.env.set('GITHUB_REPO', 'not a repo');
    eq((await dispatch('publish', {})).reason, 'no repository configured', 'bad repo name');
    Deno.env.set('GITHUB_REPO', repo!);
    Deno.env.set('GITHUB_API_BASE', 'http://127.0.0.1:1');
    eq((await dispatch('publish', {})).reason, 'github unreachable', 'unreachable');
    Deno.env.set('GITHUB_API_BASE', api!);
    Deno.env.delete('GITHUB_DISPATCH_TOKEN');
    eq((await dispatch('publish', {})).reason, 'no dispatch token', 'no token');
  } finally {
    Deno.env.set('GITHUB_DISPATCH_TOKEN', token!); Deno.env.set('GITHUB_REPO', repo!); Deno.env.set('GITHUB_API_BASE', api!); await fake.reset();
  }
});
