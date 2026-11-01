// drafts (slice 5.2): the "Publish N changes" list. Read-only; the scoping is the database's (service.drafts_waiting, migration 12, tests T20 (f)).
import { handle } from '../drafts/index.ts';
import { handle as save } from '../save/index.ts';
import { assert, call, eq, securityEvents, SITE_A, SITE_B, SUB, teamRows, t, WS_A, withSql } from './util.ts';

type Draft = { row: string; collection: string; newest: number; published: number | null; editedBy: string | null; editedAt: string };
const drafts = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'drafts', body, who);
const saveRow = async (who: Parameters<typeof call>[3], collection: string, row: string | null, data: Record<string, unknown>, base?: number) => {
  const r = await call(save, 'save', { workspace: WS_A, collection, row, data, ...(base ? { base } : {}) }, who);
  eq(r.status, 200, `save ${collection}: ${r.text}`);
  return String(r.json?.row);
};
const listOf = (a: { json: Record<string, unknown> | null }) => (a.json?.drafts ?? []) as Draft[];

t('drafts: the owner sees a waiting row with its collection, both version numbers, who edited and when (ISO)', async () => {
  const team = await teamRows();
  const row = await saveRow('owner-a', 'listings', null, { street: '1 Draft Lane', agent: team.one });
  const r = await drafts('owner-a', { site: SITE_A });
  eq(r.status, 200, 'status: ' + r.text);
  const d = listOf(r).find(x => x.row === row);
  assert(d, 'the new listing is waiting: ' + r.text);
  eq(d.collection, 'listings', 'collection'); eq(d.newest, 1, 'newest'); eq(d.published, null, 'never published'); eq(d.editedBy, SUB['owner-a'], 'edited by');
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(d.editedAt) && Date.now() - Date.parse(d.editedAt) < 3600_000, 'editedAt is an ISO time from the last hour: ' + d.editedAt);
  await saveRow('owner-a', 'listings', row, { street: '1 Draft Lane, two', agent: team.one }, 1);
  const again = listOf(await drafts('owner-a', { site: SITE_A })).find(x => x.row === row);
  eq(again?.newest, 2, 'a second save moves newest to 2');
  await withSql(sql => sql.begin(async (tx: typeof sql) => {   // a publish job finished at version 1 (migration 11 would refuse a row that is not ready to publish, so the trigger is off for this one statement)
    await tx`set local session_replication_role = replica`;
    await tx`update public.content_rows set published_version = 1 where id = ${row}::uuid`;
  }));
  const live = listOf(await drafts('owner-a', { site: SITE_A })).find(x => x.row === row);
  eq(live?.published, 1, 'the published version is reported'); eq(live?.newest, 2, 'and the newest, still ahead of it');
});

t('drafts: an agent sees only the rows they could publish themselves, never the owner\'s or another agent\'s', async () => {
  const team = await teamRows();
  const mine = await saveRow('member-a1', 'listings', null, { street: '2 Own Lane', agent: team.one });
  const theirs = await saveRow('owner-a', 'listings', null, { street: '3 Other Lane', agent: team.two });
  const r = await drafts('member-a1', { site: SITE_A });
  eq(r.status, 200, 'status: ' + r.text);
  const ids = listOf(r).map(x => x.row);
  assert(ids.includes(mine), 'their own draft is listed');
  assert(!ids.includes(theirs), 'another agent\'s draft is not listed');
  const owner = listOf(await drafts('owner-a', { site: SITE_A })).map(x => x.row);
  assert(owner.includes(mine) && owner.includes(theirs), 'the owner sees both');
});

t('drafts: another workspace\'s owner and a login of nothing get 404 S-NOT-FOUND (and a security event); no token is 401; a bad body is 400', async () => {
  const before = await securityEvents({ actor: SUB['owner-b'], code: 'S-NOT-FOUND' });
  const other = await drafts('owner-b', { site: SITE_A });
  eq(other.status, 404, 'owner of B: ' + other.text); eq(other.json?.code, 'S-NOT-FOUND', 'code');
  eq(await securityEvents({ actor: SUB['owner-b'], code: 'S-NOT-FOUND' }), before + 1, 'one security event');
  eq((await drafts('nobody', { site: SITE_A })).status, 404, 'nobody');
  eq((await drafts('owner-a', { site: SITE_B })).status, 404, 'owner of A on B\'s site');
  eq((await drafts(null, { site: SITE_A })).status, 401, 'no token');
  eq((await drafts('owner-a', {})).status, 400, 'no site');
  eq((await drafts('owner-a', { site: 'nope' })).status, 400, 'a site that is not an id');
  const own = listOf(await drafts('owner-b', { site: SITE_B }));
  assert(own.every(x => x.collection.length > 0), 'B\'s owner reads B\'s own list');
});
