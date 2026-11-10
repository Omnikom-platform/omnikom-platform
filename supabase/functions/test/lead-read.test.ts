// lead-update, slice 5.2: `read: true` marks a lead read for the caller (service.mark_lead_read, migration 12).
import { handle } from '../lead-update/index.ts';
import { call, crmForms, eq, SITE_A, SUB, teamRows, t, WS_A, withSql } from './util.ts';

const upd = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'lead-update', body, who);
async function mkLead(owner: string | null, name: string): Promise<string> {
  return await withSql(async sql => {
    const [l] = await sql`insert into public.leads (workspace_id, site_id, form, page_path, name, consent_text, owner_team_row)
      values (${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/contact', ${name}, 'I agree to be contacted', ${owner}::uuid) returning id`;
    return l.id;
  });
}
const readMarks = (lead: string) => withSql(async sql => (await sql`select user_id from public.lead_reads where lead_id = ${lead}::uuid`).map((r: { user_id: string }) => r.user_id));

t('lead-update read: true alone marks the lead read for the caller, once, and changes nothing else', async () => {
  const team = await teamRows();
  const lead = await mkLead(team.one, 'Lead to read');
  const r = await upd('member-a1', { lead, read: true });
  eq(r.status, 204, 'status: ' + r.text);
  const again = await upd('member-a1', { lead, read: true });
  eq(again.status, 204, 'a second time');
  eq((await readMarks(lead)).join(), SUB['member-a1'], 'one mark, theirs');
  await withSql(async sql => {
    const [x] = await sql`select status from public.leads where id = ${lead}::uuid`; eq(x.status, 'not-contacted', 'the status did not change');
    const [e] = await sql`select count(*)::int as n from public.lead_events where lead_id = ${lead}::uuid and kind in ('status', 'note', 'assigned')`; eq(e.n, 0, 'no timeline event was written');
  });
  eq((await upd('owner-a', { lead, read: true })).status, 204, 'the owner marks it too');
  eq((await readMarks(lead)).length, 2, 'two logins, two marks');
});

t('lead-update read: true together with a change does both; read: false marks nothing', async () => {
  await crmForms();
  const team = await teamRows();
  const lead = await mkLead(team.one, 'Lead to read and change');
  const r = await upd('member-a1', { lead, status: 'contacted', read: true });
  eq(r.status, 204, 'status: ' + r.text);
  await withSql(async sql => { const [x] = await sql`select status from public.leads where id = ${lead}::uuid`; eq(x.status, 'contacted', 'the change was made'); });
  eq((await readMarks(lead)).join(), SUB['member-a1'], 'and the mark');
  const other = await mkLead(team.one, 'Lead not read');
  eq((await upd('member-a1', { lead: other, read: false, note: 'seen' })).status, 204, 'read false with a note');
  eq((await readMarks(other)).length, 0, 'read: false marks nothing');
});

t('lead-update read: true on a lead the caller cannot read is 404 and marks nothing; a refused change marks nothing either', async () => {
  const team = await teamRows();
  const theirs = await mkLead(team.two, 'Lead of agent two, read attempt');
  const r = await upd('member-a1', { lead: theirs, read: true });
  eq(r.status, 404, 'status: ' + r.text); eq(r.json?.code, 'S-NOT-FOUND', 'code');
  eq((await readMarks(theirs)).length, 0, 'no mark');
  eq((await upd('owner-b', { lead: theirs, read: true })).status, 404, 'another workspace\'s owner');
  const mine = await mkLead(team.one, 'Lead handed on, read attempt');
  const refused = await upd('member-a1', { lead: mine, owner: team.two, read: true });
  eq(refused.status, 403, 'a member cannot hand a lead on: ' + refused.text); eq(refused.json?.code, 'S-OWN-ONLY', 'code');
  eq((await readMarks(mine)).length, 0, 'the refused change left no mark: both ran in one transaction');
  const bad = await upd('owner-a', { lead: mine, read: 'yes' });
  eq(bad.status, 400, 'read must be yes or no: ' + bad.text);
});
