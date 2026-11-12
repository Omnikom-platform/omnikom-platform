// unpublish: Delete on an item in the editor (book row B12, slice S10). The wall (owner or staff of the ROW's workspace, else 404 S-NOT-FOUND) is in the database (tenancy.test.sql);
// these tests prove the function passes the verified claims and the right row on, deletes (soft) and nothing less, answers the documented shapes, and refuses what it must.
// Each check was watched red (supabase/functions/test/mutate.mjs "unpublish [B12]" removes one step of the source and requires one of these to fail).
import { handle } from '../unpublish/index.ts';
import { handle as saveHandle } from '../save/index.ts';
import { call, eq, securityEvents, SUB, teamRows, t, WS_A, WS_B, withSql } from './util.ts';

const del = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'unpublish', body, who);
const save = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(saveHandle, 'save', body, who);
const NOBODY_ROW = '99999999-9999-4999-8999-999999999999';

/** a listing of A made by owner-a (version 1), then marked published at version 1 as the superuser (what a publish job does in life; migration 11 refuses a row that is
 *  not ready to publish, and this draft is not, so the trigger is off for this one statement, as drafts.test.ts does) */
async function published(street: string): Promise<string> {
  const made = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: { street, agent: (await teamRows()).one } });
  eq(made.status, 200, 'the listing is saved: ' + made.text);
  const row = String(made.json?.row);
  await withSql(sql => sql.begin(async (tx: typeof sql) => {
    await tx`set local session_replication_role = replica`;
    await tx`update public.content_rows set published_version = 1 where id = ${row}::uuid`;
  }));
  return row;
}
/** what the database holds about a row now: deleted, the published version, how many versions, how many audit rows `delete` */
async function state(row: string): Promise<{ deleted: boolean; published: number | null; versions: number; audits: number }> {
  return await withSql(async sql => {
    const [r] = await sql`select deleted_at is not null as deleted, published_version as published,
      (select count(*)::int from public.content_versions where row_id = c.id) as versions,
      (select count(*)::int from public.audit_log where action = 'delete' and target = c.id::text) as audits
      from public.content_rows c where c.id = ${row}::uuid`;
    return r;
  });
}

t('unpublish [B12]: the owner deletes a published listing: 204, deleted and off the site, its version kept, one audit row', async () => {
  const row = await published('b12 delete me');
  const r = await del('owner-a', { row });
  eq(r.status, 204, 'status: ' + r.text); eq(r.text, '', 'no body');
  const s = await state(row);
  eq(s.deleted, true, 'deleted'); eq(s.published, null, 'off the site'); eq(s.versions, 1, 'its version is kept'); eq(s.audits, 1, 'one audit row');
});

t('unpublish [B12]: an agent of A, the owner of B, a login of nothing, a row that does not exist and a row of B get 404; nothing changes', async () => {
  const row = await published('b12 keep me');
  const made = await save('owner-b', { workspace: WS_B, collection: 'listings', row: null, data: { street: 'b12 of workspace B' } });
  eq(made.status, 200, 'the listing of B is saved: ' + made.text);
  const rowB = String(made.json?.row);
  const ev = await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' });
  const agent = await del('member-a1', { row });
  eq(agent.status, 404, 'agent: ' + agent.text); eq(agent.json?.code, 'S-NOT-FOUND', 'code');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' }), ev + 1, 'a security event');
  eq((await del('owner-b', { row })).status, 404, 'the owner of B on a row of A');
  eq((await del('nobody', { row })).status, 404, 'a login of nothing');
  eq((await del('owner-a', { row: NOBODY_ROW })).status, 404, 'a row that does not exist');
  eq((await del('owner-a', { row: rowB })).status, 404, 'a row of B, as the owner of A');
  const a = await state(row);
  eq(a.deleted, false, 'the row of A is not deleted'); eq(a.published, 1, 'still published'); eq(a.audits, 0, 'no audit row');
  eq((await state(rowB)).deleted, false, 'the row of B is not deleted');
});

t('unpublish [B12]: no token is 401; no row and a row that is not an id are 400; a GET is 405', async () => {
  eq((await del(null, { row: NOBODY_ROW })).status, 401, 'no token');
  eq((await del('owner-a', {})).status, 400, 'no row');
  eq((await del('owner-a', { row: 'nope' })).status, 400, 'a row that is not an id');
  eq((await call(handle, 'unpublish', {}, 'owner-a', { method: 'GET' })).status, 405, 'a GET');
});
