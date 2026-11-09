// invite-member (slice 5.2, mail by work order 08): find the login or create it through the Auth admin API (generate_link, invite: creates the user, sends nothing),
// then service.set_member, then the mail: a new login gets Auth's invite mail (POST /auth/v1/invite with the inviter and the business as user data), an existing
// one the sign-in mail (POST /auth/v1/otp, create_user false); email_sent is Auth's own answer. Auth is a fake of the harness that records every call and answers
// the id the test registered (the test inserts the auth.users row itself, as GoTrue does). The link in its answer carries a marker that must never appear in an answer.
// Nothing here sends mail: the fake sends nothing.
import { handle } from '../invite-member/index.ts';
import { assert, call, eq, fake, hooks, securityEvents, SUB, teamRows, t, WS_A, withSql } from './util.ts';

const invite = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'invite-member', body, who);
const NEW_ID = (n: number) => `5252${String(n).padStart(4, '0')}-0000-0000-0000-000000000000`;
const member = (user: string) => withSql(async sql => (await sql`select role::text as role, team_row_id from public.members where workspace_id = ${WS_A}::uuid and user_id = ${user}::uuid`)[0] ?? null);
/** what DP-email-10 must say: the business's name and the inviter's (their team profile's name, else the login's email), read straight from the database */
const expectedFacts = (ws: string, who: string) => withSql(async sql => {
  const [w] = await sql`select name from public.workspaces where id = ${ws}::uuid`;
  const [p] = await sql`select v.data ->> 'name' as name from public.members m join public.content_versions v on v.row_id = m.team_row_id where m.workspace_id = ${ws}::uuid and m.user_id = ${who}::uuid order by v.n desc limit 1`;
  const [u] = await sql`select email from auth.users where id = ${who}::uuid`;
  return { business: w.name as string, inviter: (p?.name || u.email) as string };
});
const mails = async () => (await hooks.recorded()).authMails;
const mkAuthUser = (id: string, email: string) => withSql(sql => sql`insert into auth.users (id, email) values (${id}::uuid, ${email})`);

t('invite-member: a new person gets a login from Auth, becomes a member with the team profile, gets the invite mail with who invited them and to which business, and the answer holds no link', async () => {
  await fake.reset();
  const team = await teamRows();
  const id = NEW_ID(1);
  await hooks.authUser('invite-new@omnikom.test', id);   // Auth will create this login when asked
  const r = await invite('owner-a', { workspace: WS_A, email: 'Invite-New@Omnikom.Test ', role: 'member', team_row: team.two });
  eq(r.status, 200, 'status: ' + r.text);
  eq(JSON.stringify(r.json), JSON.stringify({ user: id, invited: true, email_sent: true }), 'exactly { user, invited: true, email_sent: true }');
  assert(!r.text.includes('THE-LINK-MUST-NEVER') && !r.text.includes('action_link') && !r.text.includes('123456'), 'no link, no code');
  const calls = (await hooks.recorded()).authLinks;
  eq(calls.length, 1, 'one call to Auth'); eq(calls[0].type, 'invite', 'type invite'); eq(calls[0].email, 'invite-new@omnikom.test', 'the email, lower-cased and trimmed'); eq(calls[0].authorized, true, 'with the secret key');
  const facts = await expectedFacts(WS_A, SUB['owner-a']);
  eq(calls[0].data?.inviter, facts.inviter, 'the login is made with the inviter as user data'); eq(calls[0].data?.business, facts.business, 'and the business');
  const sent = await mails();
  eq(sent.length, 1, 'one mail call'); eq(sent[0].kind, 'invite', 'the invite mail'); eq(sent[0].authorized, true, 'with the secret key'); eq(sent[0].email, 'invite-new@omnikom.test', 'to the address, lower-cased');
  eq(sent[0].data?.inviter, facts.inviter, 'DP-email-10: who invited them'); eq(sent[0].data?.business, facts.business, 'and to which business'); eq(Object.keys(sent[0].data ?? {}).sort().join(), 'business,inviter', 'and nothing else');
  assert(facts.business.length > 0 && facts.inviter.length > 0, 'both facts are filled');
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
  eq(r.status, 200, 'status: ' + r.text); eq(r.json?.user, id, 'the existing login'); eq(r.json?.email_sent, true, 'the sign-in mail was sent');
  eq((await hooks.recorded()).authLinks.length, 0, 'Auth was not asked to create anyone');
  const sent = await mails();
  eq(sent.length, 1, 'one mail call'); eq(sent[0].kind, 'otp', 'the sign-in mail, not the invite'); eq(sent[0].create_user, false, 'it creates no login'); eq(sent[0].data, null, 'no user data (Auth applies it only to a new login)'); eq(sent[0].email, 'existing-login@omnikom.test', 'to the address'); eq(sent[0].authorized, true, 'with the secret key');
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
  eq((await hooks.recorded()).authLinks.length, 0, 'no login was created for any of them'); eq((await mails()).length, 0, 'and no mail was sent');
});

t('invite-member: a team profile that is not this workspace\'s is 404 before any login is created', async () => {
  await fake.reset();
  const bRow = await withSql(async sql => (await sql`select id from public.content_rows where workspace_id <> ${WS_A}::uuid and collection = 'team' limit 1`)[0]?.id ?? '99999999-9999-4999-8999-999999999999');
  const r = await invite('owner-a', { workspace: WS_A, email: 'wrong-team@omnikom.test', role: 'member', team_row: bRow });
  eq(r.status, 404, 'status: ' + r.text);
  const nope = await invite('owner-a', { workspace: WS_A, email: 'wrong-team@omnikom.test', role: 'member', team_row: '99999999-9999-4999-8999-999999999999' });
  eq(nope.status, 404, 'a row that does not exist');
  eq((await hooks.recorded()).authLinks.length, 0, 'Auth was never asked'); eq((await mails()).length, 0, 'no mail either');
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
  eq((await hooks.recorded()).authLinks.length, 0, 'no login was created'); eq((await mails()).length, 0, 'a refused invite sends no mail');
});

t('invite-member: when Auth cannot create the login the answer is 502 AUTH and nobody becomes a member', async () => {
  await fake.reset();
  await hooks.authUser('auth-down@omnikom.test', NEW_ID(3), 500);
  const before = await withSql(async sql => (await sql`select count(*)::int as n from public.members where workspace_id = ${WS_A}::uuid`)[0].n as number);
  const r = await invite('owner-a', { workspace: WS_A, email: 'auth-down@omnikom.test', role: 'member' });
  eq(r.status, 502, 'status: ' + r.text); eq(r.json?.code, 'AUTH', 'code');
  eq(await withSql(async sql => (await sql`select count(*)::int as n from public.members where workspace_id = ${WS_A}::uuid`)[0].n as number), before, 'no member was added');
  eq((await mails()).length, 0, 'no mail was sent');
});

t('invite-member: when Auth refuses the mail the person is still a member and the answer says email_sent: false (Auth\'s answer, never assumed); the next invite works again', async () => {
  await fake.reset();
  const id = NEW_ID(4);
  await mkAuthUser(id, 'mail-down@omnikom.test');
  await hooks.mailStatus(429);
  const r = await invite('owner-a', { workspace: WS_A, email: 'mail-down@omnikom.test', role: 'member' });
  eq(r.status, 200, 'status: ' + r.text); eq(r.json?.email_sent, false, 'the mail did not go'); eq(r.json?.invited, true, 'invited');
  eq((await member(id))?.role, 'member', 'a member all the same');
  eq((await mails()).length, 1, 'Auth was asked once');
  const newId = NEW_ID(5);
  await hooks.authUser('mail-down-new@omnikom.test', newId);
  const n = await invite('owner-a', { workspace: WS_A, email: 'mail-down-new@omnikom.test', role: 'member' });
  eq(n.status, 200, 'a new login: ' + n.text); eq(n.json?.email_sent, false, 'the invite mail did not go either'); eq((await member(newId))?.role, 'member', 'a member');
  await hooks.mailStatus(200);
  const again = await invite('owner-a', { workspace: WS_A, email: 'mail-down@omnikom.test', role: 'member' });
  eq(again.json?.email_sent, true, 'when Auth answers again the mail goes');
});
