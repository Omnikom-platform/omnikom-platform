// Work order 18 (migration 22): saved views, follow-up and tasks, and the due / duplicates filters. The walls are proven in tenancy.test.sql T29; these tests
// prove the functions pass the verified claims through, check the body before the database does, and answer with the documented status and shape.
import { handle as viewSave } from '../view-save/index.ts';
import { handle as viewDelete } from '../view-delete/index.ts';
import { handle as leadTask } from '../lead-task/index.ts';
import { handle as leadUpdate } from '../lead-update/index.ts';
import { handle as leadList } from '../lead-list/index.ts';
import { isInstant } from '../_shared/http.ts';
import { assert, call, crmForms, eq, securityEvents, SITE_A, SUB, teamRows, t, WS_A, WS_B, withSql } from './util.ts';

type W = Parameters<typeof call>[3];
// the answers are read field by field in the checks below; the shape is asserted there, not by the type
// deno-lint-ignore no-explicit-any
type Res = { status: number; text: string; json: any };
const loose = async (p: ReturnType<typeof call>): Promise<Res> => (await p) as unknown as Res;
const save = (who: W, body: Record<string, unknown>) => loose(call(viewSave, 'view-save', body, who));
const del = (who: W, body: Record<string, unknown>) => loose(call(viewDelete, 'view-delete', body, who));
const task = (who: W, body: Record<string, unknown>) => loose(call(leadTask, 'lead-task', body, who));
const upd = (who: W, body: Record<string, unknown>) => loose(call(leadUpdate, 'lead-update', body, who));
const list = (who: W, body: Record<string, unknown>) => loose(call(leadList, 'lead-list', body, who));

async function mkLead(owner: string | null, name: string, o: { email?: string; followUp?: string } = {}): Promise<string> {
  return await withSql(async sql => {
    const [l] = await sql`insert into public.leads (workspace_id, site_id, form, page_path, name, email, consent_text, owner_team_row, follow_up_at)
      values (${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/contact', ${name}, ${o.email ?? null}, 'I agree to be contacted', ${owner}::uuid, ${o.followUp ?? null}::timestamptz) returning id`;
    return l.id;
  });
}
const events = (lead: string, kind: string) => withSql(async sql => (await sql`select count(*)::int as n from public.lead_events where lead_id = ${lead}::uuid and kind = ${kind}::public.lead_event_kind`)[0].n as number);
const viewRow = (id: string) => withSql(async sql => (await sql`select user_id, name, query, columns from public.crm_views where id = ${id}::uuid`)[0]);
const nonce = () => crypto.randomUUID().slice(0, 8);

// ---------- isInstant (the body check of follow_up and due) ----------
t('isInstant: a date and time with an offset on a real day is one; a date, a missing offset, a day that does not exist and a wrong clock are not', () => {
  for (const ok of ['2026-11-20T10:00:00Z', '2026-11-20T10:00Z', '2026-11-20T10:00:00.123+02:00', '2026-02-28T23:59:59-05:30', '2028-02-29T00:00:00Z']) assert(isInstant(ok), `${ok} is valid`);
  for (const bad of ['2026-11-20', '2026-11-20T10:00:00', '2026-02-30T10:00:00Z', '2027-02-29T10:00:00Z', '2026-13-01T10:00:00Z', '2026-11-20T24:00:00Z', '2026-11-20T10:75:00Z', '2026-11-20T10:00:75Z',
    '2026-11-20T10:00:00+99:00', '2026-11-20T10:00:00+16:00', '2026-11-20T10:00:00+02:60', '2026-11-20 10:00:00Z', 'tomorrow', '', '2026-11-20T10:00:00Zjunk']) assert(!isInstant(bad), `${bad} is not valid`);
});

// ---------- view-save and view-delete ----------
t('view-save: 200 { view }; the view is the caller\'s own, with the query and the columns as sent; the list answers with the same query', async () => {
  await crmForms();
  const n = nonce();
  const query = { search: 'zz3b', filters: [{ field: 'status', op: 'eq', value: 'new' }], sort: { field: 'name', dir: 'asc' } };
  const r = await save('member-a1', { workspace: WS_A, name: `Mine ${n}`, query, columns: ['name', 'email', 'budget', 'follow_up'] });
  eq(r.status, 200, 'status: ' + r.text); assert(typeof r.json?.view === 'string', 'the id');
  const row = await viewRow(r.json.view);
  eq(row.user_id, SUB['member-a1'], 'the caller\'s own'); eq(row.name, `Mine ${n}`, 'name'); eq(row.columns.join(), 'name,email,budget,follow_up', 'columns, in order');
  eq(row.query.search, 'zz3b', 'the search'); eq(row.query.filters[0].field, 'status', 'the filter'); eq(row.query.sort.field + row.query.sort.dir, 'nameasc', 'the sort');
  const ran = await list('member-a1', { workspace: WS_A, ...row.query });
  eq(ran.status, 200, 'lead-list takes the stored query as it is: ' + ran.text);
  const bare = await save('owner-a', { workspace: WS_A, name: `Bare ${n}` });
  eq(bare.status, 200, 'a name alone is a view: ' + bare.text);
  const b = await viewRow(bare.json.view); eq(JSON.stringify(b.query), '{}', 'no query'); eq(b.columns.length, 0, 'no columns');
});

t('view-save: shared is the owner\'s; a member is 403 S-OWN-ONLY (and one security event); the same call by owner B in B works; B cannot reach A (404)', async () => {
  const n = nonce();
  const o = await save('owner-a', { workspace: WS_A, name: `Shared ${n}`, shared: true, columns: ['name'] });
  eq(o.status, 200, 'owner: ' + o.text); eq((await viewRow(o.json.view)).user_id, null, 'shared');
  const before = await securityEvents({ actor: SUB['member-a1'], code: 'S-OWN-ONLY' });
  const m = await save('member-a1', { workspace: WS_A, name: `Try ${n}`, shared: true });
  eq(m.status, 403, 'member: ' + m.text); eq(m.json?.code, 'S-OWN-ONLY', 'code');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-OWN-ONLY' }), before + 1, 'a security event');
  const edit = await save('member-a1', { workspace: WS_A, id: o.json.view, name: `Hijack ${n}` });
  eq(edit.status, 403, 'a member on the shared view: ' + edit.text);
  const ob = await save('owner-b', { workspace: WS_B, name: `B ${n}` });
  eq(ob.status, 200, 'owner B saves in B: ' + ob.text);
  eq((await save('owner-b', { workspace: WS_A, name: `B in A ${n}` })).status, 404, 'owner B in A');
  eq((await save('owner-b', { workspace: WS_B, id: o.json.view, name: `B steals ${n}` })).status, 404, 'owner B names A\'s view');
  eq((await save('nobody', { workspace: WS_A, name: `Nobody ${n}` })).status, 404, 'a login of nothing');
  eq((await save(null, { workspace: WS_A, name: 'x' })).status, 401, 'no token');
});

t('view-save: a change keeps the id (200, the same view), another person\'s private view is 404, a taken name is 400 on the name', async () => {
  const n = nonce();
  const a = await save('owner-a', { workspace: WS_A, name: `Own ${n}`, columns: ['name'] });
  const again = await save('owner-a', { workspace: WS_A, id: a.json.view, name: `Own ${n} v2`, columns: ['email', 'name'] });
  eq(again.status, 200, 'change: ' + again.text); eq(again.json?.view, a.json.view, 'the same view');
  const row = await viewRow(a.json.view); eq(row.name, `Own ${n} v2`, 'name'); eq(row.columns.join(), 'email,name', 'columns');
  eq((await save('member-a1', { workspace: WS_A, id: a.json.view, name: 'x' })).status, 404, 'a member on the owner\'s private view');
  const taken = await save('owner-a', { workspace: WS_A, name: `Own ${n} v2` });
  eq(taken.status, 400, 'taken: ' + taken.text); eq(taken.json?.code, 'I-ANSWER', 'code'); eq(taken.json?.problems?.[0]?.path, 'name', 'the field');
});

t('view-save: a body that is not valid is 400 at the edge (the problem named), a query lead-list would refuse is 422 S-QUERY, a column that is not one is 400 naming it', async () => {
  const n = nonce();
  const bad = async (body: Record<string, unknown>, path: string, code: string, what: string) => {
    const r = await save('owner-a', body);
    eq(r.status, 400, `${what}: ${r.text}`); eq(r.json?.problems?.[0]?.path, path, `${what}: path`); eq(r.json?.problems?.[0]?.code, code, `${what}: code`);
  };
  await bad({ name: `x${n}` }, 'workspace', 'REQUIRED', 'no workspace');
  await bad({ workspace: 'nope', name: 'x' }, 'workspace', 'UUID', 'workspace not an id');
  await bad({ workspace: WS_A, id: 'nope', name: 'x' }, 'id', 'UUID', 'id not an id');
  await bad({ workspace: WS_A }, 'name', 'REQUIRED', 'no name');
  await bad({ workspace: WS_A, name: 'n'.repeat(61) }, 'name', 'LENGTH', 'a name of 61 characters');
  await bad({ workspace: WS_A, name: 'x', shared: 'yes' }, 'shared', 'TYPE', 'shared a word');
  await bad({ workspace: WS_A, name: 'x', query: [] }, 'query', 'TYPE', 'query a list');
  await bad({ workspace: WS_A, name: 'x', query: null }, 'query', 'TYPE', 'query null');
  await bad({ workspace: WS_A, name: 'x', columns: 'name' }, 'columns', 'TYPE', 'columns a word');
  await bad({ workspace: WS_A, name: 'x', columns: [1] }, 'columns', 'TYPE', 'a column not a text');
  await bad({ workspace: WS_A, name: 'x', columns: Array.from({ length: 61 }, (_, i) => `k${i}`) }, 'columns', 'TYPE', '61 columns');
  const q = await save('owner-a', { workspace: WS_A, name: `Q ${n}`, query: { sort: { field: 'nope' } } });
  eq(q.status, 422, 'bad query: ' + q.text); eq(q.json?.code, 'S-QUERY', 'code');
  await crmForms();
  const c = await save('owner-a', { workspace: WS_A, name: `C ${n}`, columns: ['name', 'zzUnknown'] });
  eq(c.status, 400, 'bad column: ' + c.text); eq(c.json?.code, 'I-ANSWER', 'code'); eq(c.json?.problems?.[0]?.path, 'columns', 'path'); eq(c.json?.problems?.[0]?.msg, 'zzUnknown is not a column', 'the key is named');
  const note = await save('owner-a', { workspace: WS_A, name: `N ${n}`, columns: ['note'] });
  eq(note.status, 400, 'a field the contract keeps out of the list: ' + note.text);
  await withSql(async sql => eq((await sql`select count(*)::int as n from public.crm_views where name in (${`Q ${n}`}, ${`C ${n}`}, ${`N ${n}`})`)[0].n, 0, 'a refused view stored nothing'));
});

t('view-delete: 204 for the caller\'s own view and an owner\'s for a shared one; a member on a shared view 403; another person\'s private view, another workspace and an unknown id 404; a bad id 400', async () => {
  const n = nonce();
  const own = await save('member-a1', { workspace: WS_A, name: `Del own ${n}` });
  const shared = await save('owner-a', { workspace: WS_A, name: `Del shared ${n}`, shared: true });
  const priv = await save('owner-a', { workspace: WS_A, name: `Del private ${n}` });
  const m = await del('member-a1', { view: shared.json.view });
  eq(m.status, 403, 'member on shared: ' + m.text); eq(m.json?.code, 'S-OWN-ONLY', 'code');
  eq((await del('member-a1', { view: priv.json.view })).status, 404, 'member on the owner\'s private view');
  eq((await del('owner-b', { view: shared.json.view })).status, 404, 'owner B');
  eq((await del('nobody', { view: shared.json.view })).status, 404, 'a login of nothing');
  eq((await del('owner-a', { view: '99999999-9999-4999-8999-999999999999' })).status, 404, 'an unknown id');
  eq((await del('owner-a', { view: 'nope' })).status, 400, 'a bad id'); eq((await del('owner-a', {})).status, 400, 'no id');
  eq((await del(null, { view: shared.json.view })).status, 401, 'no token');
  await withSql(async sql => eq((await sql`select count(*)::int as n from public.crm_views where id in (${own.json.view}::uuid, ${shared.json.view}::uuid, ${priv.json.view}::uuid)`)[0].n, 3, 'the refused calls deleted nothing'));
  const a = await del('member-a1', { view: own.json.view }); eq(a.status, 204, 'own: ' + a.text);
  const b = await del('owner-a', { view: shared.json.view }); eq(b.status, 204, 'owner on shared: ' + b.text);
  await withSql(async sql => {
    eq((await sql`select count(*)::int as n from public.crm_views where id in (${own.json.view}::uuid, ${shared.json.view}::uuid)`)[0].n, 0, 'both are gone');
    eq((await sql`select count(*)::int as n from public.crm_views where id = ${priv.json.view}::uuid`)[0].n, 1, 'and the owner\'s private view is not');
  });
});

// ---------- lead-update follow_up ----------
t('lead-update follow_up: set, change and clear (204); one follow-up event per change; a time is stored as the instant it names', async () => {
  const team = await teamRows();
  const lead = await mkLead(team.one, `Follow ${nonce()}`);
  const set = await upd('member-a1', { lead, follow_up: '2026-12-01T10:00:00+02:00' });
  eq(set.status, 204, 'set: ' + set.text);
  await withSql(async sql => eq((await sql`select follow_up_at = '2026-12-01T08:00:00Z'::timestamptz as ok from public.leads where id = ${lead}::uuid`)[0].ok, true, 'the instant'));
  eq((await upd('member-a1', { lead, follow_up: '2026-12-01T08:00:00Z' })).status, 204, 'the same instant again');
  eq(await events(lead, 'follow-up'), 1, 'one event, none for the same instant');
  eq((await upd('owner-a', { lead, follow_up: null })).status, 204, 'clear');
  await withSql(async sql => eq((await sql`select follow_up_at from public.leads where id = ${lead}::uuid`)[0].follow_up_at, null, 'cleared'));
  eq(await events(lead, 'follow-up'), 2, 'the clearing is an event');
  const both = await upd('member-a1', { lead, status: 'contacted', follow_up: '2026-12-05T09:00:00Z', note: 'Called' });
  eq(both.status, 204, 'together with other changes: ' + both.text);
  eq(await events(lead, 'follow-up'), 3, 'the follow-up event'); eq(await events(lead, 'status'), 1, 'and the status event');
  const nothing = await upd('member-a1', { lead, status: 'qualified' });
  eq(nothing.status, 204, 'a call without follow_up leaves it alone');
  await withSql(async sql => eq((await sql`select follow_up_at is not null as set from public.leads where id = ${lead}::uuid`)[0].set, true, 'still set'));
});

t('lead-update follow_up: a bad value is 400 on follow_up (a date alone, a day that does not exist, a number); a lead the caller cannot act on is 404 and nothing changes', async () => {
  const team = await teamRows();
  const mine = await mkLead(team.one, `Follow bad ${nonce()}`), theirs = await mkLead(team.two, `Follow theirs ${nonce()}`);
  for (const v of ['2026-12-01', '2026-02-30T10:00:00Z', '2026-12-01T10:00:00', 12345, true, '']) {
    const r = await upd('owner-a', { lead: mine, follow_up: v });
    if (v === '') { eq(r.status, 400, `"": ${r.text}`); continue; }
    eq(r.status, 400, `${JSON.stringify(v)}: ${r.text}`); eq(r.json?.problems?.[0]?.path, 'follow_up', 'the field named');
  }
  const foreign = await upd('member-a1', { lead: theirs, status: 'contacted', follow_up: '2026-12-01T10:00:00Z' });
  eq(foreign.status, 404, 'a lead of another agent: ' + foreign.text);
  eq((await upd('owner-b', { lead: mine, follow_up: '2026-12-01T10:00:00Z' })).status, 404, 'owner B');
  await withSql(async sql => {
    eq((await sql`select follow_up_at from public.leads where id in (${mine}::uuid, ${theirs}::uuid) and follow_up_at is not null`).length, 0, 'nothing was set');
    eq((await sql`select status::text as s from public.leads where id = ${theirs}::uuid`)[0].s, 'new', 'nor the status of the same call');
  });
});

// ---------- lead-task ----------
t('lead-task: add is 201 { task } and writes the task and its event; marking done and reopening is 200 { task, done }, one event each', async () => {
  const team = await teamRows();
  const lead = await mkLead(team.one, `Task ${nonce()}`);
  const due = '2026-12-02T09:00:00+01:00';
  const a = await task('member-a1', { lead, text: '  Send the brochure  ', due });
  eq(a.status, 201, 'add: ' + a.text); assert(typeof a.json?.task === 'string', 'the id');
  await withSql(async sql => {
    const [x] = await sql`select text, due_at = '2026-12-02T08:00:00Z'::timestamptz as due_ok, done_at, created_by, lead_id from public.lead_tasks where id = ${a.json.task}::uuid`;
    eq(x.text, 'Send the brochure', 'trimmed'); eq(x.due_ok, true, 'due'); eq(x.done_at, null, 'open'); eq(x.created_by, SUB['member-a1'], 'author'); eq(x.lead_id, lead, 'lead');
  });
  const bare = await task('owner-a', { lead, text: 'No time' });
  eq(bare.status, 201, 'no due time: ' + bare.text);
  const d = await task('member-a1', { task: a.json.task, done: true });
  eq(d.status, 200, 'done: ' + d.text); eq(d.json?.task, a.json.task, 'the task'); eq(d.json?.done, true, 'done');
  eq((await task('member-a1', { task: a.json.task, done: true })).status, 200, 'done again is still 200');
  await withSql(async sql => eq((await sql`select done_at is not null as d from public.lead_tasks where id = ${a.json.task}::uuid`)[0].d, true, 'finished'));
  const r = await task('owner-a', { task: a.json.task, done: false });
  eq(r.status, 200, 'reopen: ' + r.text); eq(r.json?.done, false, 'reopened');
  await withSql(async sql => {
    eq((await sql`select done_at from public.lead_tasks where id = ${a.json.task}::uuid`)[0].done_at, null, 'open again');
    eq((await sql`select array_agg(detail ->> 'action' order by id) as a from public.lead_events where lead_id = ${lead}::uuid and kind = 'task'`)[0].a.join(), 'added,added,done,reopened', 'the timeline');
  });
});

t('lead-task: both shapes at once or neither, a text of 0 or 501 characters, a bad due or done, a bad id are 400; a lead of another agent, owner B, a login of nothing are 404; no token 401', async () => {
  const team = await teamRows();
  const mine = await mkLead(team.one, `Task bad ${nonce()}`), theirs = await mkLead(team.two, `Task theirs ${nonce()}`);
  const mk = await task('member-a1', { lead: mine, text: 'x' });
  const bad = async (body: Record<string, unknown>, path: string, what: string) => {
    const r = await task('owner-a', body);
    eq(r.status, 400, `${what}: ${r.text}`); eq(r.json?.problems?.[0]?.path, path, `${what}: path`);
  };
  await bad({}, 'task', 'nothing');
  await bad({ lead: mine, text: 'x', task: mk.json.task, done: true }, 'lead', 'both shapes');
  await bad({ lead: mine }, 'text', 'no text');
  await bad({ lead: mine, text: '' }, 'text', 'empty text');
  await bad({ lead: mine, text: 'x'.repeat(501) }, 'text', 'a text of 501');
  await bad({ lead: mine, text: 'x', due: '2026-12-02' }, 'due', 'a date alone');
  await bad({ lead: mine, text: 'x', due: '2026-02-30T10:00:00Z' }, 'due', 'a day that does not exist');
  await bad({ lead: 'nope', text: 'x' }, 'lead', 'a bad lead id');
  await bad({ text: 'x' }, 'lead', 'text without a lead');
  await bad({ task: mk.json.task }, 'done', 'no done');
  await bad({ task: mk.json.task, done: 'yes' }, 'done', 'done a word');
  await bad({ task: 'nope', done: true }, 'task', 'a bad task id');
  await bad({ done: true }, 'task', 'done without a task');
  const before = await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' });
  eq((await task('member-a1', { lead: theirs, text: 'x' })).status, 404, 'a lead of another agent');
  eq(await securityEvents({ actor: SUB['member-a1'], code: 'S-NOT-FOUND' }), before + 1, 'a security event');
  eq((await task('owner-b', { lead: mine, text: 'x' })).status, 404, 'owner B');
  eq((await task('nobody', { lead: mine, text: 'x' })).status, 404, 'a login of nothing');
  eq((await task('owner-b', { task: mk.json.task, done: true })).status, 404, 'owner B on a task');
  eq((await task('member-a2', { task: mk.json.task, done: true })).status, 404, 'a2 on a1\'s lead\'s task');
  eq((await task('owner-a', { task: '99999999-9999-4999-8999-999999999999', done: true })).status, 404, 'an unknown task');
  eq((await task(null, { lead: mine, text: 'x' })).status, 401, 'no token');
  await withSql(async sql => eq((await sql`select count(*)::int as n from public.lead_tasks where lead_id in (${mine}::uuid, ${theirs}::uuid)`)[0].n, 1, 'only the one valid task exists'));
});

// ---------- lead-list: due and duplicates ----------
t('lead-list: due keeps the leads whose follow-up date has come or that have an open task due, duplicates the flagged ones; a flag that is not true or false is 400', async () => {
  const team = await teamRows();
  const n = nonce();
  const past = await mkLead(team.one, `Due past ${n}`, { followUp: '2026-01-02T10:00:00Z' }), future = await mkLead(team.one, `Due future ${n}`, { followUp: '2999-01-02T10:00:00Z' });
  const taskDue = await mkLead(team.one, `Due task ${n}`), plain = await mkLead(team.one, `Due plain ${n}`);
  await withSql(sql => sql`insert into public.lead_tasks (lead_id, workspace_id, text, due_at) values (${taskDue}::uuid, ${WS_A}::uuid, 'overdue', '2026-01-03T10:00:00Z'::timestamptz)`);
  const email = `dup-${n}@zz3b.test`;
  const first = await mkLead(team.one, `Dup first ${n}`, { email }), second = await mkLead(team.two, `Dup second ${n}`, { email: email.toUpperCase() });
  const due = await list('owner-a', { workspace: WS_A, due: true, search: n, size: 200 });
  eq(due.status, 200, 'due: ' + due.text);
  eq(due.json.rows.map((x: { id: string }) => x.id).sort().join(), [past, taskDue].sort().join(), 'the follow-up that has come and the overdue task, not the future date or the plain lead');
  const pastRow = due.json.rows.find((x: { id: string }) => x.id === past);
  assert(typeof pastRow.follow_up === 'string' && new Date(pastRow.follow_up).toISOString() === '2026-01-02T10:00:00.000Z', 'a row carries its follow_up: ' + pastRow.follow_up);
  const all = await list('owner-a', { workspace: WS_A, due: false, search: n, size: 200 });
  eq(all.json.rows.length >= 6, true, 'due: false keeps every lead of the search');
  const mine = await list('member-a1', { workspace: WS_A, due: true, search: n, size: 200 });
  eq(mine.json.rows.length, 2, 'a member: their own due leads');
  const dup = await list('owner-a', { workspace: WS_A, duplicates: true, search: n, size: 200 });
  eq(dup.status, 200, 'duplicates: ' + dup.text);
  eq(dup.json.rows.map((x: { id: string }) => x.id).join(), second, 'only the flagged lead');
  eq(dup.json.rows[0].duplicate, true, 'duplicate'); eq(dup.json.rows[0].duplicate_of, first, 'and the lead it duplicates, for the owner');
  const seen = await list('member-a2', { workspace: WS_A, duplicates: true, search: n, size: 200 });
  eq(seen.json.rows.length, 1, 'a2 sees their flagged lead'); eq(seen.json.rows[0].duplicate, true, 'duplicate'); eq(seen.json.rows[0].duplicate_of, null, 'but not the lead it duplicates (a1\'s)');
  eq(future === plain, false, 'fixtures are distinct');
  for (const body of [{ due: 'yes' }, { duplicates: 1 }]) { const r = await list('owner-a', { workspace: WS_A, ...body }); eq(r.status, 400, `${JSON.stringify(body)}: ${r.text}`); }
  const bad = await list('owner-a', { workspace: WS_A, filters: [{ field: 'nope', op: 'eq', value: 1 }], due: true });
  eq(bad.status, 422, 'a refused query is still 422 with the new flags: ' + bad.text);
});
