// save (slice 4.2): contract_for first, validateItem with the database's lookups, then service.save_as. Each check was watched red
// (supabase/functions/test/mutate.mjs removes one wall of the source and requires one of these to fail).
import { handle } from '../save/index.ts';
import { assert, call, eq, mint, mkMedia, photoContract, securityEvents, SITE_A, SUB, teamRows, t, WS_A, WS_B, withSql } from './util.ts';

const listing = (street: string, agent: string) => ({ street, agent });
const save = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'save', body, who);

t('save: owner-a saves a new listing (200, version 1), a second save of the row is version 2', async () => {
  const team = await teamRows();
  const a = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: listing('1 Main Street', team.one) });
  eq(a.status, 200, 'first save'); eq(a.json?.version, 1, 'version 1');
  const row = String(a.json?.row);
  const b = await save('owner-a', { workspace: WS_A, collection: 'listings', row, data: listing('1 Main Street, Unit 2', team.one) });
  eq(b.status, 200, 'second save'); eq(b.json?.version, 2, 'version 2'); eq(b.json?.row, row, 'the same row');
  await withSql(async sql => {
    const [r] = await sql`select count(*)::int as n from public.content_versions where row_id = ${row}::uuid`;
    eq(r.n, 2, 'two versions are stored');
    const [au] = await sql`select count(*)::int as n from public.audit_log where action = 'save' and target = ${'listings:' + row}`;
    eq(au.n, 2, 'both saves are audited');
  });
});

t('save: nobody (a valid login that belongs to nothing) gets 404 and no field name comes back', async () => {
  const before = await securityEvents({ actor: SUB.nobody, code: 'S-NOT-FOUND' });
  const r = await save('nobody', { workspace: WS_A, collection: 'listings', row: null, data: { zzUnknownField: 'x', street: 5 } });
  eq(r.status, 404, 'status'); eq(r.json?.code, 'S-NOT-FOUND', 'code');
  assert(!r.text.includes('zzUnknownField') && !r.text.includes('street') && !r.text.includes('listings'), 'the body names no field and no collection: ' + r.text);
  eq(await securityEvents({ actor: SUB.nobody, code: 'S-NOT-FOUND' }), before + 1, 'the refusal left one security event');
});

t('save: the owner of B saving into workspace A gets the same 404', async () => {
  const team = await teamRows();
  const r = await save('owner-b', { workspace: WS_A, collection: 'listings', row: null, data: listing('x', team.one) });
  eq(r.status, 404, 'status');
});

t('save: member-a1 saving a listing of agent two gets 403 S-OWN-ONLY (and one security event)', async () => {
  const team = await teamRows();
  const made = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: listing('2 Other Road', team.two) });
  eq(made.status, 200, 'owner makes agent two\'s listing');
  const before = await securityEvents({ actor: SUB['member-a1'], code: 'S-OWN-ONLY' });
  const r = await save('member-a1', { workspace: WS_A, collection: 'listings', row: made.json?.row, data: listing('2 Other Road, changed', team.two) });
  eq(r.status, 403, 'status'); eq(r.json?.code, 'S-OWN-ONLY', 'code');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-OWN-ONLY' }), before + 1, 'one security event');
  const own = await save('member-a1', { workspace: WS_A, collection: 'listings', row: null, data: listing('3 Own Lane', team.one) });
  eq(own.status, 200, 'member-a1 saves their own listing');
});

t('save: an invalid row is 422 with an I- code and the path, and a validation is not a security event', async () => {
  const team = await teamRows();
  const before = await securityEvents({ actor: SUB['owner-a'] });
  const r = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: { street: 5, agent: team.one, extra: 'x' } });
  eq(r.status, 422, 'status'); eq(r.json?.code, 'VALIDATION', 'code');
  const problems = r.json?.problems as { code: string; path: string }[];
  assert(problems.some(p => p.code === 'I-TYPE' && p.path === 'street'), 'I-TYPE at street: ' + r.text);
  assert(problems.some(p => p.code === 'I-UNKNOWN' && p.path === '.extra'), 'I-UNKNOWN at .extra: ' + r.text);
  eq(await securityEvents({ actor: SUB['owner-a'] }), before, 'no security event for a validation');
});

t('save: an unknown collection is 422 I-COLLECTION', async () => {
  const r = await save('owner-a', { workspace: WS_A, collection: 'nonsense', row: null, data: {} });
  eq(r.status, 422, 'status');
  assert((r.json?.problems as { code: string }[]).some(p => p.code === 'I-COLLECTION'), 'I-COLLECTION');
});

t('save: a reference to a row that does not exist is 422 I-REF and the id is not echoed; a row of B is not a row of A', async () => {
  const ghost = '99999999-9999-4999-8999-999999999999';
  const r = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: listing('4 Ghost Court', ghost) });
  eq(r.status, 422, 'status');
  assert((r.json?.problems as { code: string; path: string }[]).some(p => p.code === 'I-REF' && p.path === 'agent'), 'I-REF at agent');
  assert(!r.text.includes(ghost), 'the id is not echoed back');
  const bTeam = await withSql(async sql => (await sql`select id from public.content_rows where workspace_id = ${WS_B} limit 1`)[0]?.id ?? '99999999-9999-4999-8999-999999999998');
  const r2 = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: listing('4 Ghost Court', bTeam) });
  eq(r2.status, 422, 'a row of another workspace does not exist here');
});

t('save: a locked field changed by the owner is 403 S-LOCKED', async () => {
  const team = await teamRows();
  const r = await save('owner-a', { workspace: WS_A, collection: 'team', row: team.one, data: { name: 'Agent One', licence: { number: 'X-1' } } });
  eq(r.status, 403, 'status: ' + r.text); eq(r.json?.code, 'S-LOCKED', 'code');
});

t('save: a body that is not the SaveRequest is 400 BODY with the path of each problem', async () => {
  const r = await save('owner-a', { workspace: 'nope', collection: '', data: 'x' });
  eq(r.status, 400, 'status'); eq(r.json?.code, 'BODY', 'code');
  const paths = (r.json?.problems as { path: string }[]).map(p => p.path);
  assert(paths.includes('workspace') && paths.includes('collection') && paths.includes('data'), 'paths: ' + paths.join());
  const notJson = await call(handle, 'save', null, 'owner-a', { raw: 'not json' });
  eq(notJson.status, 400, 'not JSON');
});

t('save: no JWT is 401 S-AUTH and leaves an auth-refused security event (a bad token); an expired JWT is 401 too', async () => {
  const before = await securityEvents({ kind: 'auth-refused' });
  const none = await save(null, { workspace: WS_A, collection: 'listings', data: {} });
  eq(none.status, 401, 'no token'); eq(none.json?.code, 'S-AUTH', 'code');
  const expired = await save({ token: await mint('owner-a', { exp: Math.floor(Date.now() / 1000) - 60 }) }, { workspace: WS_A, collection: 'listings', data: {} });
  eq(expired.status, 401, 'expired');
  const forged = await save({ token: (await mint('owner-a')).slice(0, -4) + 'AAAA' }, { workspace: WS_A, collection: 'listings', data: {} });
  eq(forged.status, 401, 'a token with a damaged signature');
  eq(await securityEvents({ kind: 'auth-refused' }), before + 3, 'each refused token left an auth-refused event');
});

t('save: GET is 405 and a body over 256 KiB is 413; every answer is no-store JSON', async () => {
  const get = await call(handle, 'save', null, 'owner-a', { method: 'GET' });
  eq(get.status, 405, 'GET');
  const big = await call(handle, 'save', null, 'owner-a', { raw: JSON.stringify({ workspace: WS_A, collection: 'listings', data: { street: 'x'.repeat(300 * 1024) } }) });
  eq(big.status, 413, 'too large');
  const res = await handle(new Request('http://localhost/save', { method: 'POST', headers: { authorization: `Bearer ${await mint('owner-a')}` }, body: '{}' }));
  eq(res.headers.get('cache-control'), 'no-store', 'cache-control'); await res.text();
});

// ----- photos: width, EXIF and rights come from the media record, never from the row's JSON -----
t('save: a photo that was not uploaded here is 422 I-MEDIA-UNKNOWN (another workspace\'s file is unknown too)', async () => {
  await photoContract();
  const team = await teamRows();
  const unknown = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: { ...listing('5 Photo Row', team.one), photo: { asset: '99999999-9999-4999-8999-999999999997' } } });
  eq(unknown.status, 422, 'unknown file');
  assert((unknown.json?.problems as { code: string; path: string }[]).some(p => p.code === 'I-MEDIA-UNKNOWN' && p.path === 'photo'), 'I-MEDIA-UNKNOWN at photo: ' + unknown.text);
  const bMedia = await mkMedia(WS_B, { width: 3000, processed: true, exif: true, rights: true });
  const other = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: { ...listing('5 Photo Row', team.one), photo: { asset: bMedia } } });
  eq(other.status, 422, 'a file of B is unknown in A');
});

t('save: the photo\'s width comes from the media record, not from the row\'s own JSON', async () => {
  await photoContract();
  const team = await teamRows();
  const small = await mkMedia(WS_A, { width: 800, processed: true, exif: true, rights: true });
  const r = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: { ...listing('6 Photo Row', team.one), photo: { asset: small, width: 5000 } } });
  eq(r.status, 422, 'the record says 800');
  assert((r.json?.problems as { code: string }[]).some(p => p.code === 'I-MEDIA-SIZE'), 'I-MEDIA-SIZE: ' + r.text);
  const big = await mkMedia(WS_A, { width: 2400, processed: true, exif: true, rights: true });
  const ok = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: { ...listing('6 Photo Row', team.one), photo: { asset: big } } });
  eq(ok.status, 200, 'a 2400 px file is fine: ' + ok.text);
});

t('save: a draft may carry a photo that is not processed yet (publish is the strict one)', async () => {
  await photoContract();
  const team = await teamRows();
  const fresh = await mkMedia(WS_A, { width: null, processed: false });
  const r = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: { ...listing('7 Photo Row', team.one), photo: { asset: fresh } } });
  eq(r.status, 200, 'draft: ' + r.text);
  assert(SITE_A.length > 0, 'site fixture');
});
