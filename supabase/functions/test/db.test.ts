// _shared/db.ts: the step-down to omnikom_fn, and the mapping of the database's refusals to statuses.
import { connect, refusal, withDb } from '../_shared/db.ts';
import { dispatch } from '../_shared/dispatch.ts';
import { assert, eq, fake, SUB, t, teamRows, WS_A } from './util.ts';

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
    ['S-SITE-PAUSED: x', 409], ['S-KIND: x', 422], ['I-NOT-READY: 0000 status required', 422], ['S-QUOTA: x', 429], ['S-AUTH: x', 401], ['consent text required', 400], ['I-MEDIA-TYPE: x', 415], ['I-MEDIA-SIZE: x', 413],
    ['I-EMAIL: someone@example.com', 422], ['I-URL: the address must start with https://', 422], ['I-SECRET-REF: a name of the secret', 422], ['S-LAST-OWNER: a workspace keeps at least one owner', 409]];
  for (const [msg, status] of want) { const r = refusal(msg); assert(r, msg); eq(r.status, status, msg); assert(!r.msg.includes('licence'), 'no echo'); }
  const nr = refusal('I-NOT-READY: 0000 status required');   // migration 11: the database refused a row that is not ready; the words are fixed, the field is not named
  eq(nr?.code, 'I-NOT-READY', 'I-NOT-READY keeps its code'); eq(nr?.msg, 'Some items are not ready to publish.', 'I-NOT-READY has plain words and names no field');
  eq(refusal('boom: something else'), null, 'an unknown error is not a refusal');
  // slice 5.2: input problems are fixed words (the database message carries the value) and are not security events
  for (const [msg, code] of [['I-EMAIL: someone@example.com', 'I-EMAIL'], ['I-URL: https://token.example/?key=abc', 'I-URL'], ['I-SECRET-REF: crm-webhook-secret', 'I-SECRET-REF']] as const) {
    const r = refusal(msg);
    eq(r?.code, code, msg); eq(r?.kind, null, code + ' is a plain input problem, not a wall'); assert(r && !/someone|token|key=abc|crm-webhook/.test(r.msg), code + ' does not echo the value: ' + r?.msg);
  }
  eq(refusal('S-LAST-OWNER: x')?.kind, null, 'a last-owner conflict is not a security event');
});

t('db: a database S-STALE becomes 409 S-STALE and keeps its words (the row id and the newest version, nothing else)', async () => {
  const team = await teamRows();
  const claims = { sub: SUB['owner-a'], aal: 'aal1', role: 'authenticated' };
  const data = (street: string) => ({ street, status: 'for-sale', agent: team.one });
  const row = await withDb(async sql => {
    const [a] = await sql`select row_id from service.save_as(${claims}::jsonb, ${WS_A}::uuid, 'listings', null::uuid, ${data('9 Stale Street')}::jsonb, null::jsonb, null::int)`;
    await sql`select row_id from service.save_as(${claims}::jsonb, ${WS_A}::uuid, 'listings', ${a.row_id}::uuid, ${data('9 Stale Street, Unit 2')}::jsonb, null::jsonb, 1::int)`;   // current: accepted, version 2
    let msg = '';
    try { await sql`select row_id from service.save_as(${claims}::jsonb, ${WS_A}::uuid, 'listings', ${a.row_id}::uuid, ${data('9 Stale Street, late')}::jsonb, null::jsonb, 1::int)`; } catch (e) { msg = String((e as Error).message); }
    const r = refusal(msg);
    eq(r?.status, 409, 'status'); eq(r?.code, 'S-STALE', 'code'); eq(r?.kind, null, 'a conflict is not a security event');
    eq(r?.msg, `${a.row_id} was saved at version 2 by someone else`, 'the database\'s words: the row id and the newest version');
    return a.row_id as string;
  });
  // a message of any other shape never goes out as it is
  for (const bad of ['S-STALE: a new item has no earlier version (started from 5)', 'S-STALE: leaked <script> text', `S-STALE: ${row} was saved at version two by someone else`]) {
    const r = refusal(bad);
    eq(r?.status, 409, 'status ' + bad); eq(r?.code, 'S-STALE', 'code ' + bad);
    eq(r?.msg, 'Someone else saved a newer version.', 'fixed words for ' + bad);
  }
  eq(refusal(`S-STALE: ${row} was saved at version 2 by someone else; password=hunter2`)?.msg, `${row} was saved at version 2 by someone else`, 'only the sentence is kept, not what follows it');
});

t('dispatch [E9]: no token, no repository, GitHub 204, GitHub 500 and an unreachable GitHub each report honestly', async () => {
  await fake.reset();
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN'), v2 = Deno.env.get('GITHUB_DISPATCH_TOKEN_V2'), repo = Deno.env.get('GITHUB_REPO'), api = Deno.env.get('GITHUB_API_BASE');
  try {
    eq((await dispatch('publish', { a: '1' })).dispatched, true, '204');
    await fake.githubStatus(500);
    const bad = await dispatch('publish', { a: '1' });
    eq(bad.dispatched, false, '500'); eq(bad.reason, 'github 500', 'reason');
    await fake.reset();
    Deno.env.set('GITHUB_REPO', 'not a repo');
    eq((await dispatch('publish', {})).reason, 'no repository configured', 'bad repo name');
    Deno.env.set('GITHUB_REPO', repo!);
    Deno.env.set('GITHUB_API_BASE', 'http://127.0.0.1:1');
    eq((await dispatch('publish', {})).reason, 'github unreachable', 'unreachable');
    Deno.env.set('GITHUB_API_BASE', api!);
    Deno.env.delete('GITHUB_DISPATCH_TOKEN'); Deno.env.delete('GITHUB_DISPATCH_TOKEN_V2');
    eq((await dispatch('publish', {})).reason, 'no dispatch token', 'no token');
  } finally {
    Deno.env.set('GITHUB_DISPATCH_TOKEN', token!); Deno.env.set('GITHUB_DISPATCH_TOKEN_V2', v2!); Deno.env.set('GITHUB_REPO', repo!); Deno.env.set('GITHUB_API_BASE', api!); await fake.reset();
  }
});

t('dispatch [E9]: with the new token set, publish.yml and media.yml are started by workflow_dispatch (ref master, string inputs, the new token); a 403 is reported as github 403', async () => {
  await fake.reset();
  try {
    eq((await dispatch('publish', { job_id: 'j1', site_id: 's1' })).dispatched, true, 'publish: 204');
    eq((await dispatch('media', { media_id: 'm1', workspace_id: 'w1' })).dispatched, true, 'media: 204');
    const got = (await fake.recorded()).github;
    eq(got.map((g) => g.path).join(','), 'publish.yml,media.yml', 'the workflow file of each');
    eq(got.map((g) => g.token).join(','), 'v2,v2', 'the new token for each');
    eq(JSON.stringify(got[0].body), '{"ref":"master","inputs":{"job_id":"j1","site_id":"s1"}}', 'the body is exactly { ref, inputs }');
    await fake.reset(); await fake.githubStatus(403);
    const denied = await dispatch('publish', { job_id: 'j3', site_id: 's3' });
    eq(denied.dispatched, false, '403 is not a dispatch'); eq(denied.reason, 'github 403', '403 reason');
    eq((await fake.recorded()).github.map((g) => g.path).join(','), 'publish.yml', 'the refused call went to publish.yml');
  } finally { await fake.reset(); }
});

t('dispatch [E9]: with only the old token, the old repository_dispatch; with neither, no dispatch token and nothing sent', async () => {
  await fake.reset();
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN'), v2 = Deno.env.get('GITHUB_DISPATCH_TOKEN_V2');
  try {
    Deno.env.delete('GITHUB_DISPATCH_TOKEN_V2');
    eq((await dispatch('publish', { job_id: 'j2', site_id: 's2' })).dispatched, true, 'the old token: 204');
    const got = (await fake.recorded()).github;
    eq(got.length, 1, 'one call'); eq(got[0].path, 'dispatches', 'repository_dispatch'); eq(got[0].token, 'old', 'the old token');
    eq(JSON.stringify(got[0].body), '{"event_type":"publish","client_payload":{"job_id":"j2","site_id":"s2"}}', 'the body is exactly { event_type, client_payload }');
    await fake.reset();
    Deno.env.delete('GITHUB_DISPATCH_TOKEN');
    eq((await dispatch('publish', { job_id: 'j3', site_id: 's3' })).reason, 'no dispatch token', 'neither token');
    eq((await fake.recorded()).github.length, 0, 'nothing was sent');
  } finally {
    Deno.env.set('GITHUB_DISPATCH_TOKEN', token!); Deno.env.set('GITHUB_DISPATCH_TOKEN_V2', v2!); await fake.reset();
  }
});
