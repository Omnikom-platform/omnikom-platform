// upload-start and upload-finish (slice 4.2): the cap and the type list come before the database; the path is under the workspace;
// the signed upload URL comes from Storage with the secret key; finish sets only the rights tick and reports the dispatch honestly.
import { handle as start } from '../upload-start/index.ts';
import { handle as finish } from '../upload-finish/index.ts';
import { assert, call, env, eq, fake, securityEvents, SUB, t, WS_A, withSql } from './util.ts';

const up = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(start, 'upload-start', body, who);
const fin = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(finish, 'upload-finish', body, who);
const mediaCount = () => withSql(async sql => (await sql`select count(*)::int as n from public.media`)[0].n as number);

t('upload-start: owner-a gets a media id, a path under workspace A and a signed upload URL (200)', async () => {
  await fake.reset();
  const r = await up('owner-a', { workspace: WS_A, filename: 'front.jpg', bytes: 2000000, mime: 'image/jpeg' });
  eq(r.status, 200, 'status: ' + r.text);
  const path = String(r.json?.path);
  assert(path.startsWith(`${WS_A}/`) && path.endsWith('.jpg'), 'a path under A: ' + path);
  assert(String(r.json?.uploadUrl).startsWith(`${env('SUPABASE_URL')}/storage/v1/object/upload/sign/media/${path}?token=`), 'the upload URL: ' + r.json?.uploadUrl);
  const rec = (await fake.recorded()).storage;
  eq(rec.length, 1, 'one sign call'); eq(rec[0].path, path, 'for that path'); eq(rec[0].authorized, true, 'with the secret key');
  assert(!r.text.includes('test-not-a-secret'), 'the secret key never leaves the function');
  await withSql(async sql => {
    const [m] = await sql`select processed, exif_stripped, rights_confirmed, uploaded_by, path from public.media where id = ${String(r.json?.media)}::uuid`;
    eq(m.processed, false, 'unprocessed'); eq(m.exif_stripped, false, 'unstripped'); eq(m.rights_confirmed, false, 'rights not yet confirmed'); eq(m.uploaded_by, SUB['owner-a'], 'uploaded_by'); eq(m.path, path, 'the recorded path');
  });
});

t('upload-start: a login of nothing is 404 and leaves a security event; B\'s owner into A is 404', async () => {
  const before = await securityEvents({ actor: SUB.nobody, code: 'S-NOT-FOUND' });
  const n = await mediaCount();
  const r = await up('nobody', { workspace: WS_A, filename: 'x.jpg', bytes: 1000, mime: 'image/jpeg' });
  eq(r.status, 404, 'nobody: ' + r.text);
  eq(await securityEvents({ actor: SUB.nobody, code: 'S-NOT-FOUND' }), before + 1, 'a security event');
  eq((await up('owner-b', { workspace: WS_A, filename: 'x.jpg', bytes: 1000, mime: 'image/jpeg' })).status, 404, 'owner of B');
  eq(await mediaCount(), n, 'no media row was made');
});

t('upload-start: a 30 MB request is 413 before the database (no row, no Storage call)', async () => {
  await fake.reset();
  const n = await mediaCount();
  const r = await up('owner-a', { workspace: WS_A, filename: 'huge.jpg', bytes: 30 * 1024 * 1024, mime: 'image/jpeg' });
  eq(r.status, 413, 'status'); eq(r.json?.code, 'SIZE', 'code from the function, not the database');
  eq(await mediaCount(), n, 'no media row'); eq((await fake.recorded()).storage.length, 0, 'no Storage call');
  eq((await up('owner-a', { workspace: WS_A, filename: 'edge.jpg', bytes: 26214400, mime: 'image/jpeg' })).status, 200, 'exactly 25 MB is allowed');
});

t('upload-start: image/gif is 415 before the database', async () => {
  const n = await mediaCount();
  const r = await up('owner-a', { workspace: WS_A, filename: 'x.gif', bytes: 1000, mime: 'image/gif' });
  eq(r.status, 415, 'status'); eq(r.json?.code, 'MIME', 'code from the function, not the database');
  eq(await mediaCount(), n, 'no media row');
  for (const mime of ['image/png', 'image/webp', 'image/heic', 'application/pdf']) eq((await up('owner-a', { workspace: WS_A, filename: 'f', bytes: 1000, mime })).status, 200, mime);
});

t('upload-start: an empty file and a body that is not the UploadStartRequest are 400', async () => {
  eq((await up('owner-a', { workspace: WS_A, filename: 'x.jpg', bytes: 0, mime: 'image/jpeg' })).status, 400, 'empty');
  eq((await up('owner-a', { workspace: 'nope', filename: '', bytes: 'big', mime: 5 })).status, 400, 'shape');
  eq((await up(null, { workspace: WS_A, filename: 'x.jpg', bytes: 1000, mime: 'image/jpeg' })).status, 401, 'no token');
});

t('upload-start: when Storage cannot sign, the answer is 502 STORAGE (no pretend URL)', async () => {
  const key = Deno.env.get('SUPABASE_SECRET_KEY'), key2 = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.set('SUPABASE_SECRET_KEY', 'a-wrong-key'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'a-wrong-key');
  try {
    const r = await up('owner-a', { workspace: WS_A, filename: 'x.jpg', bytes: 1000, mime: 'image/jpeg' });
    eq(r.status, 502, 'status: ' + r.text); eq(r.json?.code, 'STORAGE', 'code');
    assert(!('uploadUrl' in (r.json ?? {})), 'no URL');
  } finally { Deno.env.set('SUPABASE_SECRET_KEY', key!); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', key2!); }
});

async function newMedia(who: 'owner-a' | 'member-a1'): Promise<string> {
  const r = await up(who, { workspace: WS_A, filename: 'p.jpg', bytes: 1000, mime: 'image/jpeg' });
  eq(r.status, 200, 'upload-start: ' + r.text);
  return String(r.json?.media);
}

t('upload-finish: owner-a sets rights_confirmed, processed stays false, and the media job is dispatched', async () => {
  await fake.reset();
  const media = await newMedia('owner-a');
  const r = await fin('owner-a', { media, rightsConfirmed: true, alt: 'The front of the house' });
  eq(r.status, 200, 'status: ' + r.text); eq(r.json?.processed, false, 'processed'); eq(r.json?.dispatched, true, 'dispatched'); eq(r.json?.media, media, 'media');
  await withSql(async sql => {
    const [m] = await sql`select rights_confirmed, processed, exif_stripped, width from public.media where id = ${media}::uuid`;
    eq(m.rights_confirmed, true, 'rights'); eq(m.processed, false, 'processed stays false'); eq(m.exif_stripped, false, 'exif'); eq(m.width, null, 'width stays unknown');
  });
  const got = (await fake.recorded()).github;
  eq(got.length, 1, 'one dispatch'); eq(got[0].body?.event_type, 'media', 'event type'); eq(got[0].body?.client_payload.media_id, media, 'media_id'); eq(got[0].body?.client_payload.workspace_id, WS_A, 'workspace_id');
});

t('upload-finish: rightsConfirmed false is stored as false; the uploader (a member) may finish their own upload', async () => {
  const media = await newMedia('member-a1');
  const r = await fin('member-a1', { media, rightsConfirmed: false });
  eq(r.status, 200, 'status: ' + r.text);
  await withSql(async sql => { const [m] = await sql`select rights_confirmed from public.media where id = ${media}::uuid`; eq(m.rights_confirmed, false, 'false stays false'); });
});

t('upload-finish: another member, B\'s owner and a login of nothing get 404; an unknown file too', async () => {
  const media = await newMedia('member-a1');
  const before = await securityEvents({ actor: SUB['member-a2'], code: 'S-NOT-FOUND' });
  eq((await fin('member-a2', { media, rightsConfirmed: true })).status, 404, 'another member');
  eq(await securityEvents({ actor: SUB['member-a2'], code: 'S-NOT-FOUND' }), before + 1, 'a security event');
  eq((await fin('owner-b', { media, rightsConfirmed: true })).status, 404, 'owner of B');
  eq((await fin('nobody', { media, rightsConfirmed: true })).status, 404, 'nobody');
  eq((await fin('owner-a', { media: '99999999-9999-4999-8999-999999999999', rightsConfirmed: true })).status, 404, 'unknown');
  eq((await fin('owner-a', { media, rightsConfirmed: true })).status, 200, 'the owner of the workspace may finish it');
});

t('upload-finish: the dispatch is reported honestly (no token, GitHub refusing)', async () => {
  const media = await newMedia('owner-a');
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  Deno.env.delete('GITHUB_DISPATCH_TOKEN');
  try {
    const r = await fin('owner-a', { media, rightsConfirmed: true });
    eq(r.status, 200, 'status'); eq(r.json?.dispatched, false, 'no token'); eq(r.json?.reason, 'no dispatch token', 'reason');
  } finally { Deno.env.set('GITHUB_DISPATCH_TOKEN', token!); }
  await fake.githubStatus(502);
  try {
    const r = await fin('owner-a', { media, rightsConfirmed: true });
    eq(r.json?.dispatched, false, 'refused'); eq(r.json?.reason, 'github 502', 'reason');
  } finally { await fake.reset(); }
});

t('upload-finish: the body must be the UploadFinishRequest (400)', async () => {
  const media = await newMedia('owner-a');
  eq((await fin('owner-a', { media })).status, 400, 'rightsConfirmed is needed');
  eq((await fin('owner-a', { media: 'x', rightsConfirmed: true })).status, 400, 'bad id');
  eq((await fin('owner-a', { media, rightsConfirmed: true, alt: 'x'.repeat(151) })).status, 400, 'alt too long');
  eq((await fin(null, { media, rightsConfirmed: true })).status, 401, 'no token');
});
