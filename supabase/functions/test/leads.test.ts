// lead-update and add-lead (slice 4.2): the dashboard's two lead calls. The walls are service.lead_update / service.add_lead; these
// tests prove the functions pass the verified claims through and map the walls to the right status.
import { handle as leadUpdate } from '../lead-update/index.ts';
import { handle as addLead } from '../add-lead/index.ts';
import { assert, call, eq, securityEvents, SITE_A, SUB, teamRows, t, WS_A, withSql } from './util.ts';

const upd = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(leadUpdate, 'lead-update', body, who);
const add = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(addLead, 'add-lead', body, who);

async function mkLead(owner: string | null, name: string): Promise<string> {
  return await withSql(async sql => {
    const [l] = await sql`insert into public.leads (workspace_id, site_id, form, page_path, name, consent_text, owner_team_row)
      values (${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/contact', ${name}, 'I agree to be contacted', ${owner}::uuid) returning id`;
    return l.id;
  });
}

t('lead-update: member-a1 on a lead that is not theirs is 404 S-NOT-FOUND (and one security event)', async () => {
  const team = await teamRows();
  const lead = await mkLead(team.two, 'Lead of agent two');
  const before = await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' });
  const r = await upd('member-a1', { lead, status: 'contacted' });
  eq(r.status, 404, 'status: ' + r.text); eq(r.json?.code, 'S-NOT-FOUND', 'code');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' }), before + 1, 'a security event');
  await withSql(async sql => { const [x] = await sql`select status from public.leads where id = ${lead}::uuid`; eq(x.status, 'new', 'the lead did not change'); });
});

t('lead-update: member-a1 on their own lead is 204, the status changes and the timeline says so', async () => {
  const team = await teamRows();
  const lead = await mkLead(team.one, 'Lead of agent one');
  const r = await upd('member-a1', { lead, status: 'contacted', note: 'Called, no answer' });
  eq(r.status, 204, 'status: ' + r.text);
  await withSql(async sql => {
    const [x] = await sql`select status from public.leads where id = ${lead}::uuid`; eq(x.status, 'contacted', 'status');
    const ev = await sql`select kind::text as kind from public.lead_events where lead_id = ${lead}::uuid and kind in ('status', 'note') order by kind::text`;
    eq(ev.map((e: { kind: string }) => e.kind).join(), 'note,status', 'the timeline');
  });
});

t('lead-update: a member cannot hand a lead to someone else (403 S-OWN-ONLY); the owner can (204)', async () => {
  const team = await teamRows();
  const lead = await mkLead(team.one, 'Lead to hand on');
  const r = await upd('member-a1', { lead, owner: team.two });
  eq(r.status, 403, 'member: ' + r.text); eq(r.json?.code, 'S-OWN-ONLY', 'code');
  const ok = await upd('owner-a', { lead, owner: team.two });
  eq(ok.status, 204, 'owner');
  const un = await upd('owner-a', { lead, unassign: true });
  eq(un.status, 204, 'unassign');
  await withSql(async sql => { const [x] = await sql`select owner_team_row from public.leads where id = ${lead}::uuid`; eq(x.owner_team_row, null, 'unassigned'); });
});

t('lead-update: a body that is not valid is 400 (a status that does not exist, a bad id, a long note)', async () => {
  const team = await teamRows();
  const lead = await mkLead(team.one, 'Lead for bad bodies');
  const a = await upd('owner-a', { lead, status: 'won' });
  eq(a.status, 400, 'bad status: ' + a.text);
  const b = await upd('owner-a', { lead: 'nope' });
  eq(b.status, 400, 'bad id');
  const c = await upd('owner-a', { lead, note: 'x'.repeat(2001) });
  eq(c.status, 400, 'long note');
});

t('lead-update: another workspace\'s owner and a login of nothing get 404', async () => {
  const team = await teamRows();
  const lead = await mkLead(team.one, 'Lead of A');
  eq((await upd('owner-b', { lead, status: 'spam' })).status, 404, 'owner of B');
  eq((await upd('nobody', { lead, status: 'spam' })).status, 404, 'nobody');
  eq((await upd(null, { lead, status: 'spam' })).status, 401, 'no token');
});

t('add-lead: owner-a adds a lead by hand (201) and the consent is on the record', async () => {
  const r = await add('owner-a', { site: SITE_A, name: 'Walk In', email: 'walk@example.com', phone: '555 0100', consentText: 'Said yes on the phone', answers: { budget: 'high' } });
  eq(r.status, 201, 'status: ' + r.text);
  const lead = String(r.json?.lead);
  await withSql(async sql => {
    const [l] = await sql`select name, form, page_path, consent_text from public.leads where id = ${lead}::uuid`;
    eq(l.name, 'Walk In', 'name'); eq(l.form, 'manual', 'form'); eq(l.page_path, 'dashboard', 'page');
    const [c] = await sql`select count(*)::int as n from public.consent_ledger where lead_id = ${lead}::uuid`; eq(c.n, 1, 'a consent ledger row');
  });
});

t('add-lead: a lead added by member-a1 lands on member-a1\'s own team row even when owner names someone else', async () => {
  const team = await teamRows();
  const r = await add('member-a1', { site: SITE_A, name: 'Member Lead', consentText: 'Said yes', owner: team.two });
  eq(r.status, 201, 'status: ' + r.text);
  await withSql(async sql => { const [l] = await sql`select owner_team_row from public.leads where id = ${String(r.json?.lead)}::uuid`; eq(l.owner_team_row, team.one, 'the member\'s own row'); });
});

t('add-lead: without the consent wording it is 400; a bad email is 400', async () => {
  const a = await add('owner-a', { site: SITE_A, name: 'No Consent' });
  eq(a.status, 400, 'no consent: ' + a.text);
  assert((a.json?.problems as { path: string }[]).some(p => p.path === 'consentText'), 'names consentText');
  const b = await add('owner-a', { site: SITE_A, name: 'Bad Mail', email: 'not-an-email', consentText: 'yes' });
  eq(b.status, 400, 'bad email: ' + b.text);
  assert(!b.text.includes('not-an-email'), 'the value is not echoed back');
});

t('add-lead: a login of nothing is 404, no token is 401', async () => {
  eq((await add('nobody', { site: SITE_A, consentText: 'yes' })).status, 404, 'nobody');
  eq((await add(null, { site: SITE_A, consentText: 'yes' })).status, 401, 'no token');
});
