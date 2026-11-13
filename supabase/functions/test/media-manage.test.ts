// media-manage (book row B14, migration 44): replace after the save's own checks; delete refused while in use, else the record and the four Storage objects go together.
import { handle } from '../media-manage/index.ts';
import { call, eq, fake, mkMedia, photoContract, SUB, t, WS_A, WS_B, withSql } from './util.ts';

const mm = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'media-manage', body, who);
const asOwner = { sub: SUB['owner-a'], aal: 'aal1', role: 'authenticated', email: null };
const item = (data: Record<string, unknown>, row: string | null = null) => withSql(async sql => (await sql`select row_id from service.save_as(${asOwner}::jsonb, ${WS_A}::uuid, 'listings', ${row}::uuid, ${data}::jsonb)`)[0].row_id as string);
const newest = (row: string) => withSql(async sql => (await sql`select data from public.content_versions where row_id = ${row}::uuid order by n desc limit 1`)[0].data);
const gone = (id: string) => withSql(async sql => (await sql`select count(*)::int as n from public.media where id = ${id}::uuid`)[0].n === 0);

t('media-manage: replace puts the new file in every item that used the old one, the alt text kept; a member, B\'s owner and B\'s file are 404; the same file is 400', async () => {
  await photoContract(); const a = await mkMedia(WS_A, { width: 1600, processed: true }), b = await mkMedia(WS_A, { width: 1600, processed: true }), x = await mkMedia(WS_B);
  const one = await item({ street: 'mm one', photo: { asset: a, alt: 'Front' } }), two = await item({ street: 'mm two', photo: { asset: a } });
  eq((await mm('member-a1', { media: a, action: 'replace', with: b })).status, 404, 'a member');
  eq((await mm('owner-b', { media: a, action: 'replace', with: b })).status, 404, 'the owner of B');
  eq((await mm('owner-a', { media: a, action: 'replace', with: x })).status, 404, 'a file of B as the new one');
  eq((await mm('owner-a', { media: a, action: 'replace', with: a })).status, 400, 'the same file');
  const r = await mm('owner-a', { media: a, action: 'replace', with: b }); eq(r.status, 200, 'status: ' + r.text); eq(r.json?.versions, 2, 'two items changed');
  const p = (await newest(one)).photo, q = (await newest(two)).photo;
  eq(p.asset, b, 'the field holds the new file'); eq(p.alt, 'Front', 'its alt text kept'); eq(q.asset, b, 'the other item too'); eq(await gone(a), false, 'the old file stays');
});

t('media-manage: a replace runs the save\'s own checks: a photo under the field\'s minWidth is 422 with the save\'s problem, and nothing changes', async () => {
  await photoContract(); const a = await mkMedia(WS_A, { width: 1600, processed: true }), small = await mkMedia(WS_A, { width: 800, processed: true });
  const row = await item({ street: 'mm small', photo: { asset: a } });
  const r = await mm('owner-a', { media: a, action: 'replace', with: small }); eq(r.status, 422, 'too small: ' + r.text); eq(r.json?.code, 'VALIDATION', 'the save\'s code');
  const p = (r.json?.problems as { code: string; path: string; row: string }[] | undefined)?.[0];
  eq(p?.code, 'I-MEDIA-SIZE', 'the save\'s problem'); eq(p?.path, 'photo', 'its field'); eq(p?.row, row, 'its item');
  eq((await newest(row)).photo.asset, a, 'rolled back: the item still holds the old file');
});

t('media-manage: delete is 409 S-MEDIA-IN-USE while an item uses the file, then the record goes and Storage removes its four objects (secret key)', async () => {
  await fake.reset(); const c = await mkMedia(WS_A, { width: 1600, processed: true });
  const row = await item({ street: 'mm three', photo: { asset: c } }), refused = await mm('owner-a', { media: c, action: 'delete' });
  eq(refused.status, 409, 'in use: ' + refused.text); eq(refused.json?.code, 'S-MEDIA-IN-USE', 'the code'); eq((await fake.recorded()).removed.length, 0, 'Storage untouched');
  await item({ street: 'mm three' }, row);
  const path = await withSql(async sql => (await sql`select path from public.media where id = ${c}::uuid`)[0].path as string);
  const r = await mm('owner-a', { media: c, action: 'delete' }); eq(r.status, 200, 'status: ' + r.text); eq(r.json?.deleted, true, 'deleted');
  const stem = path.replace(/\.[^./]+$/, ''), rec = (await fake.recorded()).removed;
  eq(JSON.stringify(rec[0]?.prefixes), JSON.stringify([path, `${stem}-2400.webp`, `${stem}-1600.webp`, `${stem}-800.webp`]), 'the original and its three sizes');
  eq(rec[0]?.authorized, true, 'with the secret key'); eq(await gone(c), true, 'the record is gone');
});

t('media-manage: a member\'s delete is 404; Storage refusing or silent for 10 s changes nothing (502 STORAGE, the record kept); the repeat goes through', async () => {
  await fake.reset(); const d = await mkMedia(WS_A);
  eq((await mm('member-a1', { media: d, action: 'delete' })).status, 404, 'a member');
  for (const [code, delay, why] of [[500, 0, 'Storage refuses'], [200, 12000, 'Storage does not answer in 10 s']] as const) {
    await fake.removeStatus(code, delay);
    const r = await mm('owner-a', { media: d, action: 'delete' });
    eq(r.status, 502, `${why}: ${r.text}`); eq(r.json?.code, 'STORAGE', why); eq(r.json?.message, 'Nothing was changed. Try again.', why); eq(await gone(d), false, `${why}: the record stays`);
  }
  await fake.reset(); const again = await mm('owner-a', { media: d, action: 'delete' }); eq(again.status, 200, 'the repeat: ' + again.text); eq(await gone(d), true, 'the record is gone');
});

t('media-manage: no action, an unknown action or a replace with no file is 400; no login is 401', async () => {
  const c = await mkMedia(WS_A);
  for (const body of [{ media: c }, { media: c, action: 'move' }, { media: c, action: 'replace' }]) eq((await mm('owner-a', body)).status, 400, JSON.stringify(body));
  eq((await mm(null, { media: c, action: 'delete' })).status, 401, 'no login');
});
