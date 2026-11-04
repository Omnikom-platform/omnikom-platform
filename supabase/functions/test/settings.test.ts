// settings-save (slice 5.2, work order 08): lead alerts. The walls are in the database (migrations 12 and 13); these tests prove the function passes the
// verified claims through and that the CRM part is gone (leads leave as an export, docs/product/5-crm.md).
import { assert, eq, securityEvents, SITE_A, SITE_B, SUB, t, WS_A, WS_B, withSql } from './util.ts';
import { auditRows, settingsSave } from './screens-util.ts';

const alertsOf = (site = SITE_A) => withSql(async sql => (await sql`select lead_alert_to, alert_assignee from public.sites where id = ${site}::uuid`)[0] as { lead_alert_to: string[]; alert_assignee: boolean });

t('settings-save alerts: the owner saves the list (lower-cased, de-duplicated) and the agent tick; 200 { alerts: true }', async () => {
  const r = await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['Boss@Test.com', ' boss@test.com', 'second@test.com'], assignee: false } });
  eq(r.status, 200, 'status: ' + r.text); eq(JSON.stringify(r.json), JSON.stringify({ alerts: true }), 'exactly { alerts: true }');
  const a = await alertsOf();
  eq(a.lead_alert_to.join(), 'boss@test.com,second@test.com', 'the list'); eq(a.alert_assignee, false, 'the tick');
  const keep = await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['boss@test.com'] } });
  eq(keep.status, 200, 'no tick sent: ' + keep.text);
  eq((await alertsOf()).alert_assignee, false, 'a missing tick keeps the tick');
  eq((await auditRows('alerts-set', WS_A)).length >= 2, true, 'both saves are audited');
});

t('settings-save alerts: an agent, another workspace\'s owner and a login of nothing get 404 and change nothing; a site of another workspace is 404', async () => {
  const before = await alertsOf();
  const ev = await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' });
  const agent = await settingsSave('member-a1', { workspace: WS_A, alerts: { site: SITE_A, to: ['agent@test.com'] } });
  eq(agent.status, 404, 'agent: ' + agent.text); eq(agent.json?.code, 'S-NOT-FOUND', 'code');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' }), ev + 1, 'a security event');
  eq((await settingsSave('owner-b', { workspace: WS_A, alerts: { site: SITE_A, to: ['b@test.com'] } })).status, 404, 'owner of B');
  eq((await settingsSave('nobody', { workspace: WS_A, alerts: { site: SITE_A, to: ['n@test.com'] } })).status, 404, 'nobody');
  eq((await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_B, to: ['x@test.com'] } })).status, 404, 'a site the owner cannot see');
  const wrongWs = await settingsSave('owner-a', { workspace: WS_B, alerts: { site: SITE_A, to: ['x@test.com'] } });
  eq(wrongWs.status, 404, 'a site that is not in the workspace named: ' + wrongWs.text);
  eq((await settingsSave(null, { workspace: WS_A, alerts: { site: SITE_A, to: ['x@test.com'] } })).status, 401, 'no token');
  const after = await alertsOf();
  eq(JSON.stringify(after), JSON.stringify(before), 'nothing changed');
});

t('settings-save alerts: a bad address is 422 I-EMAIL that does not echo it; a bad body is 400', async () => {
  const before = await alertsOf();
  const bad = await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['fine@test.com', 'not-an-email'] } });
  eq(bad.status, 422, 'status: ' + bad.text); eq(bad.json?.code, 'I-EMAIL', 'code');
  assert(!bad.text.includes('not-an-email'), 'the address is not echoed');
  const eleven = await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: Array.from({ length: 11 }, (_, i) => `a${i}@test.com`) } });
  eq(eleven.status, 422, 'eleven addresses: ' + eleven.text);
  eq(JSON.stringify(await alertsOf()), JSON.stringify(before), 'a refused list changed nothing');
  eq((await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: 'x@test.com' } })).status, 400, 'to must be a list');
  eq((await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: [5] } })).status, 400, 'each address is text');
  eq((await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['x@test.com'], assignee: 'yes' } })).status, 400, 'the tick is yes or no');
  eq((await settingsSave('owner-a', { workspace: WS_A })).status, 400, 'no alerts');
  eq((await settingsSave('owner-a', { workspace: 'nope', alerts: { site: SITE_A, to: [] } })).status, 400, 'a workspace that is not an id');
});

t('settings-save: there is no CRM part any more; a crm key alone is 400 and stores nothing, beside alerts it is ignored', async () => {
  const integrations = () => withSql(async sql => (await sql`select count(*)::int as n from public.integrations where workspace_id = ${WS_A}::uuid and kind = 'crm-webhook'`)[0].n as number);
  const before = await integrations();
  const only = await settingsSave('owner-a', { workspace: WS_A, crm: { url: 'https://hooks.example.com/crm/x' } });
  eq(only.status, 400, 'a crm key alone: ' + only.text); eq(only.json?.code, 'BODY', 'code');
  const both = await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['both@test.com'], assignee: true }, crm: { url: 'https://hooks.example.com/crm/x' } });
  eq(both.status, 200, 'alerts with a crm key: ' + both.text); eq(JSON.stringify(both.json), JSON.stringify({ alerts: true }), 'crm is not in the answer');
  eq(await integrations(), before, 'no connection was stored');
  assert(!JSON.stringify(await auditRows('crm-set', WS_A)).includes('hooks.example.com'), 'nothing about the address was audited');
});
