// Work order 01 (migration 14): the CRM's functions pass the verified claims through and map the walls to the right status. The walls themselves
// are proven in tenancy.test.sql T22; these tests prove lead-update `fields`, lead-list and leads-bulk reach them and answer as documented.
import { handle as leadUpdate } from '../lead-update/index.ts';
import { handle as leadList } from '../lead-list/index.ts';
import { handle as leadsBulk } from '../leads-bulk/index.ts';
import { assert, call, crmForms, eq, SITE_A, teamRows, t, WS_A, WS_B, withSql } from './util.ts';

type W = Parameters<typeof call>[3];
// the answers are read field by field in the checks below; the shape is asserted there, not by the type
// deno-lint-ignore no-explicit-any
type Res = { status: number; text: string; json: any };
const loose = async (p: ReturnType<typeof call>): Promise<Res> => (await p) as unknown as Res;
const upd = (who: W, body: Record<string, unknown>) => loose(call(leadUpdate, 'lead-update', body, who));
const list = (who: W, body: Record<string, unknown>) => loose(call(leadList, 'lead-list', body, who));
const bulk = (who: W, body: Record<string, unknown>) => loose(call(leadsBulk, 'leads-bulk', body, who));

async function mkLead(owner: string | null, name: string, answers: Record<string, unknown> = {}): Promise<string> {
  return await withSql(async sql => {
    const [l] = await sql`insert into public.leads (workspace_id, site_id, form, page_path, name, consent_text, owner_team_row, answers)
      values (${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/contact', ${name}, 'I agree to be contacted', ${owner}::uuid, ${answers}::jsonb) returning id`;
    return l.id;
  });
}
const events = (lead: string, kind: string) => withSql(async sql => (await sql`select count(*)::int as n from public.lead_events where lead_id = ${lead}::uuid and kind = ${kind}::public.lead_event_kind`)[0].n as number);

t('lead-update fields: the owner edits a core and an industry field: 200 { changed: 2 }, two edited events, typed', async () => {
  await crmForms();
  const lead = await mkLead(null, 'Crm Edit zz01', { rooms: 2 });
  const r = await upd('owner-a', { lead, fields: { name: 'Crm Edited zz01', rooms: '3' } });
  eq(r.status, 200, 'status: ' + r.text); eq(r.json?.changed, 2, 'two fields changed');
  eq(await events(lead, 'edited'), 2, 'two edited events');
  await withSql(async sql => { const [x] = await sql`select name, jsonb_typeof(answers -> 'rooms') as t, answers ->> 'rooms' as v from public.leads where id = ${lead}::uuid`;
    eq(x.name, 'Crm Edited zz01', 'name'); eq(x.t, 'number', 'rooms typed'); eq(x.v, '3', 'rooms value'); });
});

t('lead-update fields: refusals map to plain codes: I-ANSWER names the field (400), S-CONSENT (403), I-UNKNOWN (400), a foreign lead 404', async () => {
  await crmForms();
  const team = await teamRows();
  const mine = await mkLead(team.one, 'Crm Refuse zz01'), theirs = await mkLead(team.two, 'Crm Theirs zz01');
  const bad = await upd('owner-a', { lead: mine, fields: { rooms: 99 } });
  eq(bad.status, 400, 'bad value: ' + bad.text); eq(bad.json?.code, 'I-ANSWER', 'code'); eq(bad.json?.problems?.[0]?.path, 'rooms', 'the field'); eq(bad.json?.problems?.[0]?.msg, 'rooms must be a number from 0 to 20', 'plain words');
  const consent = await upd('owner-a', { lead: mine, fields: { consent_text: 'changed' } });
  eq(consent.status, 403, 'consent: ' + consent.text); eq(consent.json?.code, 'S-CONSENT', 'code');
  const unknown = await upd('owner-a', { lead: mine, fields: { junk: 1 } });
  eq(unknown.status, 400, 'unknown: ' + unknown.text); eq(unknown.json?.code, 'I-UNKNOWN', 'code');
  const foreign = await upd('member-a1', { lead: theirs, fields: { rooms: 1 } });
  eq(foreign.status, 404, 'foreign: ' + foreign.text);
  const owner = await upd('member-a1', { lead: mine, fields: { owner: null } });
  eq(owner.status, 403, 'member owner: ' + owner.text); eq(owner.json?.code, 'S-OWN-ONLY', 'code');
  eq(await events(mine, 'edited'), 0, 'nothing was edited');
});

t('lead-list: the owner gets typed columns in form order and a number sort; a member only its own; another workspace nothing; a bad key 422', async () => {
  await crmForms();
  const team = await teamRows();
  for (const [n, rooms] of [[1, 10], [2, 9], [3, 100]] as const) await mkLead(n === 2 ? team.one : null, `Crm List zz01-${n}`, { rooms: rooms > 20 ? 20 : rooms, budget: 'low' });
  const r = await list('owner-a', { workspace: WS_A, search: 'crm list zz01', sort: { field: 'rooms', dir: 'asc' } });
  eq(r.status, 200, 'status: ' + r.text);
  eq((r.json?.columns ?? []).map((c: { key: string }) => c.key).join(), 'budget,rooms,wants', 'columns in form order (note is not a column)');
  eq((r.json?.rows ?? []).map((x: { rooms: number }) => x.rooms).join(), '9,10,20', 'rooms sorted as numbers, not text');
  assert(typeof r.json?.rows?.[0]?.rooms === 'number' && r.json?.rows?.[0]?.budget === 'low', 'each column under its own key, typed');
  const m = await list('member-a1', { workspace: WS_A, search: 'crm list zz01' });
  eq(m.json?.total, 1, 'a member lists only its own lead: ' + m.text.slice(0, 200));
  const b = await list('owner-b', { workspace: WS_A });
  eq(b.status, 200, 'owner-b status'); eq(b.json?.total, 0, 'another workspace: nothing'); eq((b.json?.columns ?? []).length, 0, 'not even the field names');
  const k = await list('owner-a', { workspace: WS_A, sort: { field: 'note' } });
  eq(k.status, 422, 'a sort on a non-column: ' + k.text); eq(k.json?.code, 'S-QUERY', 'code');
  const big = await list('owner-a', { workspace: WS_A, size: 201 });
  eq(big.status, 422, 'a page of 201: ' + big.text);
  void WS_B;
});

t('leads-bulk: status on two, all or nothing with a foreign id, delete refused without confirm (409) and done with it, a member cannot delete', async () => {
  await crmForms();
  const team = await teamRows();
  const a = await mkLead(null, 'Crm Bulk zz01-a'), b = await mkLead(team.one, 'Crm Bulk zz01-b');
  const ok = await bulk('owner-a', { workspace: WS_A, ids: [a, b], action: 'status', value: 'qualified' });
  eq(ok.status, 200, 'status: ' + ok.text); eq(ok.json?.changed, 2, 'two changed');
  const partial = await bulk('member-a1', { workspace: WS_A, ids: [a, b], action: 'status', value: 'closed' });
  eq(partial.status, 404, 'a lead the member cannot act on refuses the call: ' + partial.text);
  await withSql(async sql => eq((await sql`select count(*)::int as n from public.leads where id in (${a}::uuid, ${b}::uuid) and status = 'qualified'`)[0].n, 2, 'nothing written'));
  const member = await bulk('member-a1', { workspace: WS_A, ids: [b], action: 'delete', confirm: true });
  eq(member.status, 403, 'member delete: ' + member.text); eq(member.json?.code, 'S-OWN-ONLY', 'code');
  const noConfirm = await bulk('owner-a', { workspace: WS_A, ids: [a, b], action: 'delete' });
  eq(noConfirm.status, 409, 'delete without confirm: ' + noConfirm.text); eq(noConfirm.json?.code, 'S-CONFIRM', 'code');
  const del = await bulk('owner-a', { workspace: WS_A, ids: [a], action: 'delete', confirm: true });
  eq(del.status, 200, 'a single delete is a bulk of one: ' + del.text); eq(del.json?.changed, 1, 'one deleted');
  await withSql(async sql => {
    eq((await sql`select count(*)::int as n from public.leads where id = ${a}::uuid`)[0].n, 0, 'hard deleted');
    eq((await sql`select count(*)::int as n from public.audit_log where action = 'lead-delete' and target = ${a}::text`)[0].n, 1, 'one audit row for the deleted lead');
  });
  const badBody = await bulk('owner-a', { workspace: WS_A, ids: [], action: 'status', value: 'new' });
  eq(badBody.status, 400, 'no ids: ' + badBody.text);
});
