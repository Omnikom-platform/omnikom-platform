// save, slice 5.2: the base version. A save names the version the editor started from; a save on top of a newer one is refused (S-STALE, migration 12).
import { handle } from '../save/index.ts';
import { assert, call, eq, newest, securityEvents, SUB, teamRows, t, WS_A } from './util.ts';

const listing = (street: string, agent: string) => ({ street, agent });
const save = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'save', body, who);

t('save base: a save that names the newest version is accepted; a stale base is 409 S-STALE with the database\'s words and is not a security event', async () => {
  const team = await teamRows();
  const a = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: listing('10 Base Road', team.one) });
  const row = String(a.json?.row);
  const v2 = await save('owner-a', { workspace: WS_A, collection: 'listings', row, base: 1, data: listing('10 Base Road, two', team.one) });
  eq(v2.status, 200, 'base 1 on a row at version 1: ' + v2.text); eq(v2.json?.version, 2, 'version 2');
  const before = await securityEvents({ actor: SUB['owner-a'] });
  const stale = await save('owner-a', { workspace: WS_A, collection: 'listings', row, base: 1, data: listing('10 Base Road, late', team.one) });
  eq(stale.status, 409, 'stale: ' + stale.text); eq(stale.json?.code, 'S-STALE', 'code');
  eq(stale.json?.message, `${row} was saved at version 2 by someone else`, 'the database\'s sentence: the row id and the newest version');
  eq(await securityEvents({ actor: SUB['owner-a'] }), before, 'a conflict is not a security event');
  eq(await newest(row), 2, 'the stale save wrote nothing');
  const current = await save('owner-a', { workspace: WS_A, collection: 'listings', row, base: 2, data: listing('10 Base Road, three', team.one) });
  eq(current.status, 200, 'base 2 is current now: ' + current.text); eq(current.json?.version, 3, 'version 3');
});

t('save base: an existing row without a base is 400 BODY naming base; a base that is not a whole number or is negative is 400', async () => {
  const team = await teamRows();
  const made = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: listing('11 Base Road', team.one) });
  const row = String(made.json?.row);
  const none = await save('owner-a', { workspace: WS_A, collection: 'listings', row, data: listing('11 Base Road, x', team.one) });
  eq(none.status, 400, 'no base: ' + none.text); eq(none.json?.code, 'BODY', 'code');
  assert((none.json?.problems as { path: string }[]).some(p => p.path === 'base'), 'the problem names base');
  eq(await newest(row), 1, 'nothing was saved');
  for (const bad of [1.5, '1', -1, true]) {
    const r = await save('owner-a', { workspace: WS_A, collection: 'listings', row, base: bad, data: listing('11 Base Road, y', team.one) });
    eq(r.status, 400, `base ${JSON.stringify(bad)}: ${r.text}`);
  }
  eq(await newest(row), 1, 'still nothing saved');
});

t('save base: a new row needs no base; base 0 is allowed on a new row; any other base on a new row is 409 S-STALE', async () => {
  const team = await teamRows();
  const a = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: listing('12 Base Road', team.one) });
  eq(a.status, 200, 'no base: ' + a.text);
  const b = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, base: 0, data: listing('13 Base Road', team.one) });
  eq(b.status, 200, 'base 0: ' + b.text);
  const c = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, base: 3, data: listing('14 Base Road', team.one) });
  eq(c.status, 409, 'base 3 on a new row: ' + c.text); eq(c.json?.code, 'S-STALE', 'code');
});

t('save base: an agent who may not save the row is 403 S-OWN-ONLY even with a stale base (a person who may not save learns no version)', async () => {
  const team = await teamRows();
  const made = await save('owner-a', { workspace: WS_A, collection: 'listings', row: null, data: listing('15 Base Road', team.two) });
  const row = String(made.json?.row);
  await save('owner-a', { workspace: WS_A, collection: 'listings', row, base: 1, data: listing('15 Base Road, two', team.two) });
  const r = await save('member-a1', { workspace: WS_A, collection: 'listings', row, base: 1, data: listing('15 Base Road, late', team.two) });
  eq(r.status, 403, 'status: ' + r.text); eq(r.json?.code, 'S-OWN-ONLY', 'code');
});
