// team-list and member-remove (work order 08, migration 17). The walls are in the database (tenancy.test.sql T24); these tests prove the functions pass the verified
// claims and the right ids through, answer the documented shapes, and that a removed person's next request in the workspace is refused (Supabase Auth has no
// admin logout by user id, so open sessions are not ended: api.go and GoTrueAdminApi.ts, read 2026-11-04; the wall does it).
import { handle as teamList } from '../team-list/index.ts';
import { handle as memberRemove } from '../member-remove/index.ts';
import { handle as settingsSave } from '../settings-save/index.ts';
import { assert, call, eq, mint, securityEvents, SITE_A, SUB, t, WS_A, WS_B, withSql } from './util.ts';
import { auditRows } from './screens-util.ts';

const list = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(teamList, 'team-list', body, who);
const remove = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(memberRemove, 'member-remove', body, who);
const ID = (n: number) => `7373${String(n).padStart(4, '0')}-0000-0000-0000-000000000000`;
type Member = { user: string; email: string; role: string; team_row: string | null; name: string | null; joined: string };

/** a login that is a member of workspace A with this role (made as the superuser, like the seed) */
async function mkMember(n: number, role: 'owner' | 'member', ws = WS_A): Promise<{ id: string; email: string; token: string }> {
  const id = ID(n), email = `team-${n}@omnikom.test`;
  await withSql(async sql => {
    await sql`insert into auth.users (id, email) values (${id}::uuid, ${email}) on conflict (id) do nothing`;
    await sql`insert into public.members (workspace_id, user_id, role) values (${ws}::uuid, ${id}::uuid, ${role}::public.member_role) on conflict (workspace_id, user_id) do update set role = excluded.role`;
  });
  return { id, email, token: await mint(null, { sub: id, email }) };
}
const isMember = (id: string, ws = WS_A) => withSql(async sql => (await sql`select 1 from public.members where workspace_id = ${ws}::uuid and user_id = ${id}::uuid`).length === 1);

t('team-list: the owner gets every member of the workspace, owners first, with email, role, team profile name and joined date, and nobody of another workspace', async () => {
  const r = await list('owner-a', { workspace: WS_A });
  eq(r.status, 200, 'status: ' + r.text);
  const m = (r.json?.members ?? []) as Member[];
  assert(m.length >= 3, 'at least owner-a, member-a1 and member-a2: ' + m.length);
  eq(m[0].role, 'owner', 'owners come first'); eq(m[0].user, SUB['owner-a'], 'owner-a');
  assert(m.every(x => Object.keys(x).sort().join() === 'email,joined,name,role,team_row,user'), 'every row has exactly user, email, role, team_row, name, joined');
  assert(m.every(x => typeof x.email === 'string' && x.email.length > 0 && !Number.isNaN(Date.parse(x.joined))), 'an email and a date on every row');
  const a1 = m.find(x => x.user === SUB['member-a1']);
  eq(a1?.name, 'Agent One', 'a member carries the name of their team profile'); eq(a1?.role, 'member', 'role member'); assert(typeof a1?.team_row === 'string', 'and the profile id');
  assert(!m.some(x => x.user === SUB['owner-b']), 'nobody of workspace B');
  const b = await list('owner-b', { workspace: WS_B });
  eq(b.status, 200, 'owner of B lists B: ' + b.text);
  assert(((b.json?.members ?? []) as Member[]).every(x => x.user !== SUB['owner-a'] && x.user !== SUB['member-a1']), 'B lists none of A');
});

t('team-list: an agent, another workspace\'s owner, a login of nothing and a workspace that does not exist get 404 (a security event); no token is 401; a bad body is 400', async () => {
  const ev = await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' });
  const agent = await list('member-a1', { workspace: WS_A });
  eq(agent.status, 404, 'agent: ' + agent.text); eq(agent.json?.code, 'S-NOT-FOUND', 'code');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' }), ev + 1, 'a security event');
  eq((await list('owner-b', { workspace: WS_A })).status, 404, 'owner of B');
  eq((await list('nobody', { workspace: WS_A })).status, 404, 'nobody');
  eq((await list('owner-a', { workspace: '99999999-9999-4999-8999-999999999999' })).status, 404, 'a workspace that does not exist');
  eq((await list(null, { workspace: WS_A })).status, 401, 'no token');
  eq((await list('owner-a', {})).status, 400, 'no workspace'); eq((await list('owner-a', { workspace: 'nope' })).status, 400, 'a workspace that is not an id');
  assert(!(await list('member-a1', { workspace: WS_A })).text.includes('@'), 'a refusal names nobody');
});

t('member-remove: the owner removes a member; the list drops them, the removal is audited, their rows stay, and their next request in the workspace is refused', async () => {
  const p = await mkMember(1, 'owner');   // a second owner: the most they could do before is everything
  const who = { token: p.token };
  eq((await list(who, { workspace: WS_A })).status, 200, 'before: the second owner lists the team');
  eq((await call(settingsSave, 'settings-save', { workspace: WS_A, alerts: { site: SITE_A, to: ['before-removal@test.com'] } }, who)).status, 200, 'and saves alerts');
  const r = await remove('owner-a', { workspace: WS_A, user: p.id });
  eq(r.status, 200, 'status: ' + r.text); eq(JSON.stringify(r.json), JSON.stringify({ removed: true }), 'exactly { removed: true }');
  assert(!(await isMember(p.id)), 'no longer a member');
  assert(!(((await list('owner-a', { workspace: WS_A })).json?.members ?? []) as Member[]).some(x => x.user === p.id), 'the list no longer shows them');
  assert((await auditRows('member-remove', WS_A)).length >= 1, 'audited (member-remove)');
  // the token they held still verifies (Auth has no admin logout by user id); the wall refuses everything
  eq((await list(who, { workspace: WS_A })).status, 404, 'after: the same token lists nothing');
  const save = await call(settingsSave, 'settings-save', { workspace: WS_A, alerts: { site: SITE_A, to: ['after-removal@test.com'] } }, who);
  eq(save.status, 404, 'and writes nothing: ' + save.text);
  const kept = await withSql(async sql => (await sql`select lead_alert_to from public.sites where id = ${SITE_A}::uuid`)[0].lead_alert_to as string[]);
  assert(!kept.includes('after-removal@test.com'), 'the refused save changed nothing');
  eq((await remove('owner-a', { workspace: WS_A, user: p.id })).status, 404, 'removing them again is 404');
});

t('member-remove: an agent, another workspace\'s owner and a login of nothing get 404 and remove nobody; no token is 401; bad bodies are 400', async () => {
  const p = await mkMember(2, 'member');
  const ev = await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' });
  const agent = await remove('member-a1', { workspace: WS_A, user: p.id });
  eq(agent.status, 404, 'agent: ' + agent.text); eq(agent.json?.code, 'S-NOT-FOUND', 'code');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' }), ev + 1, 'a security event');
  eq((await remove('owner-b', { workspace: WS_A, user: p.id })).status, 404, 'owner of B');
  eq((await remove('owner-b', { workspace: WS_B, user: p.id })).status, 404, 'owner of B, naming their own workspace: the person is not a member there');
  eq((await remove('nobody', { workspace: WS_A, user: p.id })).status, 404, 'nobody');
  eq((await remove(null, { workspace: WS_A, user: p.id })).status, 401, 'no token');
  eq((await remove('owner-a', { workspace: WS_A })).status, 400, 'no user'); eq((await remove('owner-a', { workspace: WS_A, user: 'nope' })).status, 400, 'a user that is not an id');
  eq((await remove('owner-a', { user: p.id })).status, 400, 'no workspace');
  assert(await isMember(p.id), 'nobody was removed');
  eq((await remove('owner-a', { workspace: WS_A, user: p.id })).status, 200, 'the owner can');
  assert(!(await isMember(p.id)), 'and it is done');
});

t('member-remove: never the last owner (409 S-LAST-OWNER in plain words, not a security event); the owner stays; a second owner can then be removed', async () => {
  const before = await securityEvents({ actor: SUB['owner-a'] });
  const owners = async () => await withSql(async sql => (await sql`select count(*)::int as n from public.members where workspace_id = ${WS_A}::uuid and role = 'owner'`)[0].n as number);
  const start = await owners();
  eq(start, 1, 'workspace A has one owner');
  const r = await remove('owner-a', { workspace: WS_A, user: SUB['owner-a'] });
  eq(r.status, 409, 'status: ' + r.text); eq(r.json?.code, 'S-LAST-OWNER', 'code');
  eq(await securityEvents({ actor: SUB['owner-a'] }), before, 'not a security event');
  eq(await owners(), 1, 'still one owner');
  const second = await mkMember(3, 'owner');
  eq((await remove('owner-a', { workspace: WS_A, user: SUB['owner-a'] })).status, 200, 'with a second owner the first can leave');
  eq((await remove({ token: second.token }, { workspace: WS_A, user: second.id })).status, 409, 'and now the second is the last');
  await withSql(sql => sql`insert into public.members (workspace_id, user_id, role) values (${WS_A}::uuid, ${SUB['owner-a']}::uuid, 'owner') on conflict (workspace_id, user_id) do nothing`);   // put the seed back for the tests after this one
  eq((await remove('owner-a', { workspace: WS_A, user: second.id })).status, 200, 'the second owner is removed by the first');
  eq(await owners(), 1, 'one owner again');
});
