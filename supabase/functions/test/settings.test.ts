// settings-save (slice 5.2): lead alerts and the CRM connection. The walls are in the database (migrations 12 and 13); these tests prove the function passes the
// verified claims through, checks the host before anything is stored, keeps the secret out of every answer, and saves alerts and the connection all or nothing.
import { assert, call, crmSecret, eq, securityEvents, SITE_A, SITE_B, SUB, t, WS_A, WS_B, withSql } from './util.ts';
import { answers, auditRows, connectCrm, counting, crmRow, nowhere, publicHost, settingsSave } from './screens-util.ts';

const alertsOf = (site = SITE_A) => withSql(async sql => (await sql`select lead_alert_to, alert_assignee from public.sites where id = ${site}::uuid`)[0] as { lead_alert_to: string[]; alert_assignee: boolean });

t('settings-save alerts: the owner saves the list (lower-cased, de-duplicated) and the agent tick; 200 { alerts: true, crm: null }', async () => {
  const r = await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['Boss@Test.com', ' boss@test.com', 'second@test.com'], assignee: false } });
  eq(r.status, 200, 'status: ' + r.text); eq(r.json?.alerts, true, 'alerts'); eq(r.json?.crm, null, 'crm untouched');
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
  eq((await settingsSave('owner-a', { workspace: WS_A })).status, 400, 'neither alerts nor crm');
  eq((await settingsSave('owner-a', { workspace: 'nope', alerts: { site: SITE_A, to: [] } })).status, 400, 'a workspace that is not an id');
});

t('settings-save crm: an address is saved with a fresh 64-character secret in the vault under the derived name; the answer, the table and the audit row never hold the secret', async () => {
  const url = 'https://hooks.example.com/crm/abc?x=1';
  const r = await settingsSave('owner-a', { workspace: WS_A, crm: { url } });
  eq(r.status, 200, 'status: ' + r.text); eq(r.json?.crm, 'set', 'crm'); eq(r.json?.alerts, false, 'alerts untouched');
  const row = await crmRow(WS_A);
  eq(row?.config.url, url, 'the address is stored'); eq(row?.secret_ref, `crm-webhook-${WS_A}`, 'the secret is stored as a name, the derived one');
  const secret = await crmSecret(WS_A);
  assert(secret && /^[0-9a-f]{64}$/.test(secret), 'the vault holds a 64 character hex secret');
  assert(!r.text.includes(secret), 'the answer does not hold the secret');
  assert(!JSON.stringify(row).includes(secret), 'the table row does not hold the secret');
  assert(!JSON.stringify(await auditRows('crm-set', WS_A)).includes(secret), 'the audit rows do not hold the secret');
  const again = await settingsSave('owner-a', { workspace: WS_A, crm: { url: 'https://hooks.example.com/crm/def' } });
  eq(again.status, 200, 'a second address: ' + again.text);
  const second = await crmSecret(WS_A);
  assert(second && second !== secret, 'every save of an address makes a fresh secret');
  eq((await crmRow(WS_A))?.config.url, 'https://hooks.example.com/crm/def', 'the new address');
});

t('settings-save crm: an address the database refuses (after the secret was made) rolls the secret back; the old connection stays', async () => {
  await connectCrm('https://hooks.example.com/crm/keep');
  const secret = await crmSecret(WS_A);
  const bad = await settingsSave('owner-a', { workspace: WS_A, crm: { url: 'https://hooks_underscore.example.com/x' } });
  eq(bad.status, 422, 'status: ' + bad.text); eq(bad.json?.code, 'I-URL', 'code');
  eq(await crmSecret(WS_A), secret, 'the secret is the old one: the new one was rolled back');
  eq((await crmRow(WS_A))?.config.url, 'https://hooks.example.com/crm/keep', 'the old address');
  const http = await settingsSave('owner-a', { workspace: WS_A, crm: { url: 'http://hooks.example.com/x' } });
  eq(http.status, 422, 'plain http: ' + http.text); eq(http.json?.code, 'I-URL', 'code');
  eq((await settingsSave('owner-a', { workspace: WS_A, crm: { url: 'not an address' } })).status, 422, 'text that is not an address');
  eq(await crmSecret(WS_A), secret, 'still the old secret');
});

t('settings-save crm: the host is resolved first; any private, loopback, link-local or unique-local answer, or no answer, refuses it before anything is stored', async () => {
  await connectCrm('https://hooks.example.com/crm/keep');
  const secret = await crmSecret(WS_A);
  const ev = await securityEvents({ actor: SUB['owner-a'], code: 'I-URL' });
  for (const [why, resolve] of [
    ['10.0.0.5', answers(['10.0.0.5'])], ['127.0.0.1', answers(['127.0.0.1'])], ['169.254.169.254', answers(['169.254.169.254'])], ['192.168.1.1', answers(['192.168.1.1'])],
    ['172.16.0.1', answers(['172.16.0.1'])], ['::1', answers([], ['::1'])], ['fc00::1', answers([], ['fc00::1'])], ['fe80::1', answers([], ['fe80::1'])],
    ['::ffff:127.0.0.1', answers([], ['::ffff:127.0.0.1'])], ['one public and one private answer', answers(['93.184.216.34', '10.1.1.1'])],
    ['a private IPv6 beside a public IPv4', answers(['93.184.216.34'], ['fd00::5'])], ['no answer at all', nowhere],
  ] as const) {
    const r = await settingsSave('owner-a', { workspace: WS_A, crm: { url: 'https://rebinding.example.com/hook' } }, resolve);
    eq(r.status, 422, `${why}: ${r.text}`); eq(r.json?.code, 'I-URL', `${why}: code`);
  }
  eq(await crmSecret(WS_A), secret, 'no refusal touched the secret');
  eq((await crmRow(WS_A))?.config.url, 'https://hooks.example.com/crm/keep', 'no refusal touched the address');
  assert(await securityEvents({ actor: SUB['owner-a'], code: 'I-URL' }) >= ev + 12, 'each refusal left a security event');
  const literal = counting(publicHost);
  const lit = await settingsSave('owner-a', { workspace: WS_A, crm: { url: 'https://169.254.169.254/latest/meta-data' } }, literal);
  eq(lit.status, 422, 'a private address written as numbers: ' + lit.text); eq(literal.calls, 0, 'and no DNS lookup was made for it');
  const ok = await settingsSave('owner-a', { workspace: WS_A, crm: { url: 'https://hooks.example.com/crm/public' } }, answers(['93.184.216.34'], ['2606:2800:220:1:248:1893:25c8:1946']));
  eq(ok.status, 200, 'public IPv4 and IPv6 answers are fine: ' + ok.text);
});

t('settings-save crm: url null removes the connection and its secret; an agent, another workspace\'s owner and a login of nothing get 404 and change nothing', async () => {
  await connectCrm('https://hooks.example.com/crm/keep');
  const secret = await crmSecret(WS_A);
  const ev = await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' });
  for (const who of ['member-a1', 'owner-b', 'nobody'] as const) {
    const r = await settingsSave(who, { workspace: WS_A, crm: { url: null } });
    eq(r.status, 404, `${who} removing: ${r.text}`);
    const s = await settingsSave(who, { workspace: WS_A, crm: { url: 'https://hooks.example.com/theirs' } });
    eq(s.status, 404, `${who} setting: ${s.text}`);
  }
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' }), ev + 2, 'two security events for the agent');
  eq(await crmSecret(WS_A), secret, 'the secret is untouched'); eq((await crmRow(WS_A))?.config.url, 'https://hooks.example.com/crm/keep', 'so is the address');
  const gone = await settingsSave('owner-a', { workspace: WS_A, crm: { url: null } });
  eq(gone.status, 200, 'status: ' + gone.text); eq(gone.json?.crm, 'removed', 'crm');
  eq(await crmRow(WS_A), null, 'the connection is gone'); eq(await crmSecret(WS_A), null, 'and so is its secret');
});

t('settings-save: alerts and the connection are saved together or not at all; a bad crm body is 400', async () => {
  await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['before@test.com'], assignee: true } });
  const before = await alertsOf();
  const r = await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['after@test.com'], assignee: false }, crm: { url: 'https://hooks_underscore.example.com/x' } });
  eq(r.status, 422, 'the connection is refused by the database: ' + r.text);
  eq(JSON.stringify(await alertsOf()), JSON.stringify(before), 'so the alerts were not saved either');
  const both = await settingsSave('owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['after@test.com'], assignee: false }, crm: { url: 'https://hooks.example.com/both' } });
  eq(both.status, 200, 'both fine: ' + both.text); eq(both.json?.alerts, true, 'alerts'); eq(both.json?.crm, 'set', 'crm');
  eq((await alertsOf()).lead_alert_to.join(), 'after@test.com', 'the alerts were saved');
  for (const bad of [5, '', '   ', 'x'.repeat(2001), {}, []]) {
    const x = await settingsSave('owner-a', { workspace: WS_A, crm: { url: bad } });
    eq(x.status, 400, `crm.url ${JSON.stringify(bad).slice(0, 30)}: ${x.text}`);
  }
});
