// Work order 20 (migration 23): lead type and status as per-industry lists held as data. The walls (the guard on every writer, the lists, the flags, the authors,
// the unique domain) are proven in tenancy.test.sql T31; these tests prove the functions check the body before the database does, pass the verified claims through,
// and answer with the documented status, code and field name.
import { handle as leadUpdate } from '../lead-update/index.ts';
import { handle as leadsBulk } from '../leads-bulk/index.ts';
import { handle as leadList } from '../lead-list/index.ts';
import { assert, call, crmForms, eq, SITE_A, SUB, teamRows, t, WS_A, withSql } from './util.ts';

type W = Parameters<typeof call>[3];
// deno-lint-ignore no-explicit-any
type Res = { status: number; text: string; json: any };
const loose = async (p: ReturnType<typeof call>): Promise<Res> => (await p) as unknown as Res;
const upd = (who: W, body: Record<string, unknown>) => loose(call(leadUpdate, 'lead-update', body, who));
const bulk = (who: W, body: Record<string, unknown>) => loose(call(leadsBulk, 'leads-bulk', body, who));
const list = (who: W, body: Record<string, unknown>) => loose(call(leadList, 'lead-list', body, who));
const nonce = () => crypto.randomUUID().slice(0, 8);

async function mkLead(owner: string | null, name: string): Promise<string> {
  return await withSql(async sql => {
    const [l] = await sql`insert into public.leads (workspace_id, site_id, form, page_path, name, consent_text, owner_team_row)
      values (${WS_A}::uuid, ${SITE_A}::uuid, 'zz-crm20', '/contact', ${name}, 'I agree to be contacted', ${owner}::uuid) returning id`;
    return l.id;
  });
}
const row = (lead: string) => withSql(async sql => (await sql`select status, status_date::text as status_date, status_who, status_text, lead_type from public.leads where id = ${lead}::uuid`)[0]);

t('lead-update (work order 20): a status needing a date is 400 on status_date without one, 204 with it; the event carries the date', async () => {
  await crmForms();
  const lead = await mkLead((await teamRows()).one, `Date ${nonce()}`);
  const no = await upd('owner-a', { lead, status: 'call-back' });
  eq(no.status, 400, 'no date: ' + no.text); eq(no.json?.problems?.[0]?.path, 'status_date', 'the field named'); eq((await row(lead)).status, 'not-contacted', 'nothing changed');
  const yes = await upd('owner-a', { lead, status: 'call-back', status_date: '2026-12-24' });
  eq(yes.status, 204, 'with a date: ' + yes.text);
  const r = await row(lead); eq(r.status, 'call-back', 'status'); eq(r.status_date, '2026-12-24', 'date');
  await withSql(async sql => eq((await sql`select detail ->> 'date' as d from public.lead_events where lead_id = ${lead}::uuid and kind = 'status'`)[0].d, '2026-12-24', 'the event says the date'));
});

t('lead-update (work order 20): a status that records who defaults to the caller; a named member is kept; an outsider is 400 on status_who', async () => {
  await crmForms();
  const lead = await mkLead((await teamRows()).one, `Who ${nonce()}`);
  eq((await upd('member-a1', { lead, status: 'contacted' })).status, 204, 'by the member');
  eq((await row(lead)).status_who, SUB['member-a1'], 'the caller');
  eq((await upd('owner-a', { lead, status: 'contacted', status_who: SUB['owner-a'] })).status, 204, 'named by the owner');
  eq((await row(lead)).status_who, SUB['owner-a'], 'the person named');
  const out = await upd('owner-a', { lead, status: 'contacted', status_who: SUB['owner-b'] });
  eq(out.status, 400, 'another business\'s login: ' + out.text); eq(out.json?.problems?.[0]?.path, 'status_who', 'the field named');
});

t('lead-update (work order 20): a status that asks for a line keeps it; 201 characters is 400 on status_text', async () => {
  await crmForms();
  const lead = await mkLead(null, `Text ${nonce()}`);
  eq((await upd('owner-a', { lead, status: 'interested', status_text: 'Pool homes' })).status, 204, 'with a line');
  eq((await row(lead)).status_text, 'Pool homes', 'kept');
  const long = await upd('owner-a', { lead, status_text: 'x'.repeat(201) });
  eq(long.status, 400, 'too long: ' + long.text); eq(long.json?.problems?.[0]?.path, 'status_text', 'the field named');
});

t('lead-update (work order 20): a body that is not valid is 400 and names the field (a status that is not a key, a status the business lacks, a date that is not a day, a bad person)', async () => {
  await crmForms();
  const lead = await mkLead(null, `Bad ${nonce()}`);
  for (const [k, v, path] of [['status', 'Contacted', 'status'], ['status', 'bogus-status', 'status'], ['status', 5, 'status'], ['status_date', 'next week', 'status_date'], ['status_date', '2026-02-30', 'status_date'],
    ['status_date', '2026-12-24T10:00:00Z', 'status_date'], ['status_date', 20261224, 'status_date'], ['status_who', 'not-an-id', 'status_who'], ['status_text', 7, 'status_text']] as [string, unknown, string][]) {
    const r = await upd('owner-a', { lead, status: 'call-back', status_date: '2026-12-24', [k]: v });
    eq(r.status, 400, `${k}=${JSON.stringify(v)}: ${r.text}`); eq(r.json?.problems?.[0]?.path, path, `${k}: the field named`);
  }
  // the shape of a key is checked here, before the database (which would refuse it too, as I-ANSWER): ENUM says the edge refused it
  const shape = await upd('owner-a', { lead, status: 'Contacted' });
  eq(shape.json?.problems?.[0]?.code, 'ENUM', `a status that is not a key is refused at the edge: ${shape.text}`);
  eq((await row(lead)).status, 'not-contacted', 'nothing changed');
});

t('lead-update (work order 20): another business\'s lead is 404 with a status; a member cannot set a status on a lead that is not theirs', async () => {
  await crmForms();
  const team = await teamRows();
  const mine = await mkLead(team.one, `Mine ${nonce()}`), theirs = await mkLead(team.two, `Theirs ${nonce()}`);
  eq((await upd('owner-b', { lead: mine, status: 'qualified' })).status, 404, 'owner B');
  eq((await upd('member-a1', { lead: theirs, status: 'qualified' })).status, 404, 'agent one on agent two\'s lead');
  eq((await row(mine)).status, 'not-contacted', 'nothing changed'); eq((await row(theirs)).status, 'not-contacted', 'nor theirs');
});

t('lead-update (work order 20): a note carries its author: the member\'s name, and "agent" is never taken from the body', async () => {
  await crmForms();
  const lead = await mkLead((await teamRows()).one, `Note ${nonce()}`);
  eq((await upd('member-a1', { lead, note: 'A note', actor: 'agent', author: { kind: 'agent' } })).status, 204, 'the note');
  await withSql(async sql => {
    const [e] = await sql`select detail, by from public.lead_events where lead_id = ${lead}::uuid and kind = 'note'`;
    eq(e.detail.author.kind, 'user', 'a login is a user, whatever the body says'); assert(typeof e.detail.author.name === 'string' && e.detail.author.name.length > 0, 'a name'); eq(e.by, SUB['member-a1'], 'the user id is kept');
  });
});

t('leads-bulk (work order 20): a status of the business\'s own list changes many leads; one needing a date, a stranger and a malformed key are 400', async () => {
  await crmForms();
  const a = await mkLead(null, `Bulk ${nonce()}`), b = await mkLead(null, `Bulk ${nonce()}`);
  const ok = await bulk('owner-a', { workspace: WS_A, ids: [a, b], action: 'status', value: 'contacted' });
  eq(ok.status, 200, 'contacted: ' + ok.text); eq(ok.json?.changed, 2, 'two changed'); eq((await row(a)).status_who, SUB['owner-a'], 'by the caller');
  for (const value of ['call-back', 'bogus', 'Contacted', 'x'.repeat(41), 5]) {
    const r = await bulk('owner-a', { workspace: WS_A, ids: [a, b], action: 'status', value });
    eq(r.status, 400, `${JSON.stringify(value)}: ${r.text}`);
  }
});

t('lead-list (work order 20): a row carries the five columns, the answer carries the business\'s lists, and lead type and status filter and sort', async () => {
  await crmForms();
  const tag = nonce();
  const a = await mkLead(null, `List ${tag} a`), b = await mkLead(null, `List ${tag} b`);
  await withSql(async sql => { await sql`update public.leads set lead_type = 'buy' where id = ${a}::uuid`; });
  eq((await upd('owner-a', { lead: b, status: 'qualified' })).status, 204, 'qualified');
  const r = await list('owner-a', { workspace: WS_A, search: `List ${tag}`, filters: [{ field: 'lead_type', op: 'eq', value: 'buy' }] });
  eq(r.status, 200, 'list: ' + r.text); eq(r.json.rows.length, 1, 'one buy lead'); eq(r.json.rows[0].lead_type, 'buy', 'lead_type');
  for (const k of ['status', 'status_date', 'status_who', 'status_text']) assert(k in r.json.rows[0], `${k} is on the row`);
  assert(Array.isArray(r.json.lead_types) && r.json.lead_types.some((x: { key: string }) => x.key === 'listing-question'), 'the lead types of the business');
  assert(r.json.statuses.some((x: { key: string; needsDate: boolean }) => x.key === 'call-back' && x.needsDate === true), 'the statuses, with their flags');
  const s = await list('owner-a', { workspace: WS_A, search: `List ${tag}`, sort: { field: 'status', dir: 'asc' } });
  eq(s.json.rows.map((x: { status: string }) => x.status).join(), 'not-contacted,qualified', 'by the place in the list');
});
