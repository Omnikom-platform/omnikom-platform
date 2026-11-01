// invite-member (slice 5.2): find the login or create it through the Auth admin API (generate_link, invite: creates the user, sends nothing), then
// service.set_member. The Auth admin API is a fake of the harness that records the call and answers the id the test registered (the test inserts the
// auth.users row itself, as GoTrue does). The link in its answer carries a marker that must never appear in an answer.
import { handle } from '../invite-member/index.ts';
import { assert, call, eq, fake, hooks, securityEvents, SUB, teamRows, t, WS_A, withSql } from './util.ts';

const invite = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'invite-member', body, who);
const NEW_ID = (n: number) => `5252${String(n).padStart(4, '0')}-0000-0000-0000-000000000000`;
const member = (user: string) => withSql(async sql => (await sql`select role::text as role, team_row_id from public.members where workspace_id = ${WS_A}::uuid and user_id = ${user}::uuid`)[0] ?? null);
const mkAuthUser = (id: string, email: string) => withSql(sql => sql`insert into auth.users (id, email) values (${id}::uuid, ${email})`);

t('invite-member: a new person gets a login from Auth (invite, nothing sent), becomes a member with the team profile, and the answer holds no link', async () => {
  await fake.reset();
  const team = await teamRows();
  const id = NEW_ID(1);
  await hooks.authUser('invite-new@omnikom.test', id);   // Auth will create this login when asked
  const r = await invite('owner-a', { workspace: WS_A, email: 'Invite-New@Omnikom.Test ', role: 'member', team_row: team.two });
  eq(r.status, 200, 'status: ' + r.text);
  eq(JSON.stringify(r.json), JSON.stringify({ user: id, invited: true, email_sent: false }), 'exactly { user, invited: true, email_sent: false }');
  assert(!r.text.includes('THE-LINK-MUST-NEVER') && !r.text.includes('action_link') && !r.text.includes('123456'), 'no link, no code');
  const calls = (await hooks.recorded()).authLinks;
  eq(calls.length, 1, 'one call to Auth'); eq(calls[0].type, 'invite', 'type invite'); eq(calls[0].email, 'invite-new@omnikom.test', 'the email, lower-cased and trimmed'); eq(calls[0].authorized, true, 'with the secret key');
  const m = await member(id);
  eq(m?.role, 'member', 'a member'); eq(m?.team_row_id, team.two, 'on the team profile');
  const audit = await withSql(async sql => (await sql`select detail from public.audit_log where action = 'member-set' and target = ${id}`)[0]?.detail);
  eq(audit?.role, 'member', 'audited');
});

t('invite-member: a person who already has a login is not created again; the role is the one sent (owner)', async () => {
  await fake.reset();
  const id = NEW_ID(2);
  await mkAuthUser(id, 'existing-login@omnikom.test');
  const r = await invite('owner-a', { workspace: WS_A, email: 'existing-login@omnikom.test', role: 'owner' });
  eq(r.status, 200, 'status: ' + r.text); eq(r.json?.user, id, 'the existing login'); eq(r.json?.email_sent, false, 'no email sent');
  eq((await hooks.recorded()).authLinks.length, 0, 'Auth was not asked to create anyone');
  eq((await member(id))?.role, 'owner', 'an owner, as sent');
  const again = await invite('owner-a', { workspace: WS_A, email: 'existing-login@omnikom.test', role: 'member' });
  eq(again.status, 200, 'inviting again changes the role: ' + again.text); eq((await member(id))?.role, 'member', 'now a member');
});

t('invite-member: an agent, another workspace\'s owner and a login of nothing get 404 and Auth is never asked to create a login; no token is 401', async () => {
  await fake.reset();
  const ev = await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' });
  const agent = await invite('member-a1', { workspace: WS_A, email: 'agent-invites@omnikom.test', role: 'member' });
  eq(agent.status, 404, 'agent: ' + agent.text); eq(agent.json?.code, 'S-NOT-FOUND', 'code');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' }), ev + 1, 'a security event');
  eq((await invite('owner-b', { workspace: WS_A, email: 'b-invites@omnikom.test', role: 'member' })).status, 404, 'owner of B');
  eq((await invite('nobody', { workspace: WS_A, email: 'nobody-invites@omnikom.test', role: 'member' })).status, 404, 'nobody');
  eq((await invite(null, { workspace: WS_A, email: 'x@omnikom.test', role: 'member' })).status, 401, 'no token');
  eq((await hooks.recorded()).authLinks.length, 0, 'no login was created for any of them');
});

t('invite-member: a team profile that is not this workspace\'s is 404 before any login is created', async () => {
  await fake.reset();
  const bRow = await withSql(async sql => (await sql`select id from public.content_rows where workspace_id <> ${WS_A}::uuid and collection = 'team' limit 1`)[0]?.id ?? '99999999-9999-4999-8999-999999999999');
  const r = await invite('owner-a', { workspace: WS_A, email: 'wrong-team@omnikom.test', role: 'member', team_row: bRow });
  eq(r.status, 404, 'status: ' + r.text);
  const nope = await invite('owner-a', { workspace: WS_A, email: 'wrong-team@omnikom.test', role: 'member', team_row: '99999999-9999-4999-8999-999999999999' });
  eq(nope.status, 404, 'a row that does not exist');
  eq((await hooks.recorded()).authLinks.length, 0, 'Auth was never asked');
});

t('invite-member: the last owner cannot make themselves a member (409 S-LAST-OWNER, not a security event); a bad body is 400', async () => {
  await fake.reset();
  const own = 'owner-a@omnikom.test';
  await withSql(sql => sql`update auth.users set email = ${own} where id = ${SUB['owner-a']}::uuid`);   // the seeded address has no dot; the invite only accepts real-looking ones
  const before = await securityEvents({ actor: SUB['owner-a'] });
  const r = await invite('owner-a', { workspace: WS_A, email: own, role: 'member' });
  eq(r.status, 409, 'status: ' + r.text); eq(r.json?.code, 'S-LAST-OWNER', 'code');
  eq(await securityEvents({ actor: SUB['owner-a'] }), before, 'not a security event');
  eq((await member(SUB['owner-a']))?.role, 'owner', 'still an owner');
  eq((await invite('owner-a', { workspace: WS_A, email: 'not-an-email', role: 'member' })).status, 400, 'a bad email');
  eq((await invite('owner-a', { workspace: WS_A, email: 'ok@omnikom.test', role: 'admin' })).status, 400, 'a role that does not exist');
  eq((await invite('owner-a', { workspace: WS_A, email: 'ok@omnikom.test' })).status, 400, 'no role');
  eq((await invite('owner-a', { workspace: 'nope', email: 'ok@omnikom.test', role: 'member' })).status, 400, 'a bad workspace');
  eq((await invite('owner-a', { workspace: WS_A, email: 'ok@omnikom.test', role: 'member', team_row: 'nope' })).status, 400, 'a bad team row');
  eq((await hooks.recorded()).authLinks.length, 0, 'no login was created');
});

t('invite-member: when Auth cannot create the login the answer is 502 AUTH and nobody becomes a member', async () => {
  await fake.reset();
  await hooks.authUser('auth-down@omnikom.test', NEW_ID(3), 500);
  const before = await withSql(async sql => (await sql`select count(*)::int as n from public.members where workspace_id = ${WS_A}::uuid`)[0].n as number);
  const r = await invite('owner-a', { workspace: WS_A, email: 'auth-down@omnikom.test', role: 'member' });
  eq(r.status, 502, 'status: ' + r.text); eq(r.json?.code, 'AUTH', 'code');
  eq(await withSql(async sql => (await sql`select count(*)::int as n from public.members where workspace_id = ${WS_A}::uuid`)[0].n as number), before, 'no member was added');
});
