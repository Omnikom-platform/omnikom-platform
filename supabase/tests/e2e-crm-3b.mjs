// Staging proof of the CRM block 3b backend (work order 18; migration 22; functions view-save, view-delete, lead-task, lead-update `follow_up`, lead-list `due`
// and `duplicates`). Synthetic data in workspace A only. Run by the head after migration 22 is applied to staging and the functions are deployed.
//   STAGING_SUPABASE_REF=... STAGING_DB_URL=... SITE_URL=https://<test site preview> node supabase/tests/e2e-crm-3b.mjs
// Steps, one PASS/FAIL line each: a lead posted through the published form endpoint twice with the same email (the second in capitals) is flagged as a duplicate
// of the first, and only the owner is told which lead; the `duplicates` filter lists exactly the flagged lead; owner-a and member-a1 save views (a private one
// each and a shared one for the owner), list them with a plain select and see the right ones; a member cannot share a view or delete a shared one; a query
// lead-list refuses is refused by view-save; a task is added, shows in the `due` filter while it is open, is finished and leaves the filter; the follow-up date
// is set, listed as due, and cleared; a member cannot add a task to a lead that is not theirs; the timeline holds the follow-up and task events.
// Every lead and view it makes carries the run marker in its name, and the `finally` deletes them all (leads through leads-bulk, which takes their tasks; views
// through view-delete), so staging keeps nothing. Runs only against staging (stagingDbUrl refuses anything else); reads the database read-only; keys by variable name only.
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { makeSql } from '../../tools/omnikom-cli/lib/sql.mjs';
import { stagingDbUrl } from './e2e-cleanup.mjs';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const site = (process.env.SITE_URL || '').replace(/\/$/, '');
if (!site) { console.error('BLOCKED: set SITE_URL (the published test site)'); process.exit(3); }
const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase || !target.restBase) { console.error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)'); process.exit(3); }
let dbUrl;
try { dbUrl = stagingDbUrl(process.env); } catch (e) { console.error(e.message); process.exit(String(e.message).startsWith('BLOCKED') ? 3 : 2); }
const sql = makeSql({ url: dbUrl, readOnly: true });
const base = target.functionsBase.replace(/\/$/, ''), rest = target.restBase.replace(/\/$/, ''), pub = process.env[target.vars.publishableKey];
const tokens = {};
const token = async (who) => tokens[who] ??= await personToken(parseIdentity(who), { target, env: process.env });

let failed = 0;
const line = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : '  ' + String(detail).slice(0, 300)}`); if (!ok) failed++; };
async function call(name, who, body) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${await token(who)}` };
  if (pub) headers.apikey = pub;
  try {
    const res = await fetch(`${base}/${name}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* 204 */ }
    return { status: res.status, text, json };
  } catch (e) { return { status: 0, text: String(e && e.message || e).slice(0, 120), json: null }; }
}
// the Data API as the person: row level security decides what comes back (the dashboard lists views this way)
async function select(table, who, query) {
  const headers = { authorization: `Bearer ${await token(who)}` };
  if (pub) headers.apikey = pub;
  try {
    const res = await fetch(`${rest}/${table}?${query}`, { headers, signal: AbortSignal.timeout(60000) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, text, json: Array.isArray(json) ? json : null };
  } catch (e) { return { status: 0, text: String(e && e.message || e).slice(0, 120), json: null }; }
}

const run = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const marker = `e2e crm3b ${run}`;
const leadsOf = async (extra = {}) => (await call('lead-list', 'owner-a', { workspace: WS_A, search: marker, size: 200, ...extra })).json?.rows ?? [];
const names = (rows) => rows.map((r) => r.name).sort().join(' | ');
const viewIds = [];
const events = (lead, kind) => { const r = sql.rows(`select detail->>'action' as a, kind::text from public.lead_events where lead_id = '${lead}' and kind = '${kind}' order by id`); return r.ok ? r.rows : null; };

try {
  // 1. a duplicate through the published form, whatever the case of the email
  const page = await fetch(`${site}/contact/`, { signal: AbortSignal.timeout(30000) }).then((r) => r.text()).catch(() => '');
  const form = (page.match(/<form\b[\s\S]*?<\/form>/) || [''])[0];
  const consentText = (form.match(/name="consentText" value="([^"]*)"/) || [])[1]?.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  line(!!consentText, 'the published contact form carries its consent wording');
  const email = `e2e-crm3b-${run}@example.com`;
  const post = async (n, mail) => {
    const body = new URLSearchParams({ form: 'contact', page: '/contact/', name: `${marker} ${n}`, email: mail, hp: '', consent: 'yes', consentText: consentText || '' });
    return (await fetch(`${site}/api/lead`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual', signal: AbortSignal.timeout(30000) })).status;
  };
  const s1 = await post(1, email), s2 = await post(2, email.toUpperCase()), s3 = await post(3, `e2e-crm3b-other-${run}@example.com`);
  line([s1, s2, s3].every((s) => [200, 303].includes(s)), 'three leads posted through the published form endpoint (the second with the email in capitals)', `${s1} ${s2} ${s3}`);
  const rows = await leadsOf();
  const one = rows.find((x) => x.name === `${marker} 1`), two = rows.find((x) => x.name === `${marker} 2`), three = rows.find((x) => x.name === `${marker} 3`);
  line(rows.length === 3 && one && two && three, 'all three are in the CRM list', JSON.stringify(rows).slice(0, 200));
  if (one && two && three) {
    line(one.duplicate === false && one.duplicate_of === null && two.duplicate === true && two.duplicate_of === one.id && three.duplicate === false,
      'the second lead is flagged as a duplicate of the first (owner-a is told which); the first and the third are not', JSON.stringify([one, two, three].map((x) => [x.name, x.duplicate, x.duplicate_of])).slice(0, 300));
    const dup = await leadsOf({ duplicates: true });
    line(dup.length === 1 && dup[0].id === two.id, 'the duplicates filter lists exactly the flagged lead', names(dup));
    const dbRow = sql.rows(`select (select duplicate_of from public.leads where id = '${two.id}') as d, (select count(*)::int from public.leads where id in ('${one.id}', '${three.id}') and duplicate_of is not null) as n`);
    line(dbRow.ok && dbRow.rows[0].d === one.id && dbRow.rows[0].n === 0, 'the database holds the same flags', JSON.stringify(dbRow).slice(0, 200));

    // 2. views: private and shared, listed with a plain select
    const q = { search: marker, sort: { field: 'name', dir: 'asc' } };
    const mine = await call('view-save', 'member-a1', { workspace: WS_A, name: `${marker} mine`, query: q, columns: ['name', 'email', 'follow_up', 'duplicate'] });
    const shared = await call('view-save', 'owner-a', { workspace: WS_A, name: `${marker} shared`, shared: true, query: q, columns: ['name', 'status'] });
    const ownerPrivate = await call('view-save', 'owner-a', { workspace: WS_A, name: `${marker} owner private` });
    for (const r of [mine, shared, ownerPrivate]) if (r.json?.view) viewIds.push(r.json.view);
    line(mine.status === 200 && shared.status === 200 && ownerPrivate.status === 200 && viewIds.length === 3, 'member-a1 saves a private view; owner-a a shared one and a private one: 200 { view } each', `${mine.status} ${shared.status} ${ownerPrivate.status}`);
    const asMember = await select('crm_views', 'member-a1', `select=id,name,user_id,columns&workspace_id=eq.${WS_A}&name=like.${encodeURIComponent(marker + '*')}`);
    const asOwner = await select('crm_views', 'owner-a', `select=id,name,user_id,columns&workspace_id=eq.${WS_A}&name=like.${encodeURIComponent(marker + '*')}`);
    line(asMember.status === 200 && asMember.json && names(asMember.json) === `${marker} mine | ${marker} shared`, 'member-a1 lists their own view and the shared one, not the owner\'s private view', asMember.text);
    line(asOwner.status === 200 && asOwner.json && names(asOwner.json) === `${marker} owner private | ${marker} shared`, 'owner-a lists the shared view and their own, not the member\'s', asOwner.text);
    line(asMember.json?.find((v) => v.name === `${marker} mine`)?.columns?.join() === 'name,email,follow_up,duplicate', 'the columns come back in the order saved');
    const ran = await call('lead-list', 'owner-a', { workspace: WS_A, ...q });
    line(ran.status === 200 && ran.json?.rows?.some((r) => r.id === one.id), 'the saved query runs in lead-list as it was stored');
    const tryShare = await call('view-save', 'member-a1', { workspace: WS_A, name: `${marker} member shares`, shared: true });
    line(tryShare.status === 403 && tryShare.json?.code === 'S-OWN-ONLY', 'a member cannot share a view (403 S-OWN-ONLY)', `${tryShare.status} ${tryShare.text.slice(0, 120)}`);
    const tryDelete = await call('view-delete', 'member-a1', { view: shared.json?.view });
    line(tryDelete.status === 403, 'a member cannot delete a shared view (403)', `${tryDelete.status} ${tryDelete.text.slice(0, 120)}`);
    const peek = await call('view-delete', 'member-a1', { view: ownerPrivate.json?.view });
    line(peek.status === 404, 'a member cannot reach the owner\'s private view (404)', `${peek.status} ${peek.text.slice(0, 120)}`);
    const badQ = await call('view-save', 'owner-a', { workspace: WS_A, name: `${marker} bad query`, query: { sort: { field: 'no_such_column' } } });
    line(badQ.status === 422 && badQ.json?.code === 'S-QUERY', 'a query lead-list refuses is refused by view-save (422 S-QUERY)', `${badQ.status} ${badQ.text.slice(0, 120)}`);
    const badC = await call('view-save', 'owner-a', { workspace: WS_A, name: `${marker} bad column`, columns: ['name', 'no_such_column'] });
    line(badC.status === 400 && badC.json?.problems?.[0]?.path === 'columns' && /no_such_column/.test(badC.json?.problems?.[0]?.msg ?? ''), 'a column that is not one is refused naming it (400)', `${badC.status} ${badC.text.slice(0, 160)}`);
    const afterBad = await select('crm_views', 'owner-a', `select=id&name=like.${encodeURIComponent(marker + ' bad*')}`);
    line(afterBad.status === 200 && afterBad.json?.length === 0, 'a refused view stored nothing');

    // 3. tasks and the due filter
    const addPast = await call('lead-task', 'owner-a', { lead: one.id, text: `${marker} call back`, due: new Date(Date.now() - 3600_000).toISOString() });
    line(addPast.status === 201 && typeof addPast.json?.task === 'string', 'owner-a adds a task due an hour ago: 201 { task }', `${addPast.status} ${addPast.text.slice(0, 120)}`);
    const addLater = await call('lead-task', 'owner-a', { lead: three.id, text: `${marker} later`, due: new Date(Date.now() + 86400_000).toISOString() });
    line(addLater.status === 201, 'and one due tomorrow on another lead', `${addLater.status} ${addLater.text.slice(0, 120)}`);
    line(names(await leadsOf({ due: true })) === `${marker} 1`, 'the due filter lists the lead with the overdue task and not the one due tomorrow', names(await leadsOf({ due: true })));
    const memberTask = await call('lead-task', 'member-a1', { lead: one.id, text: `${marker} not mine` });
    line(memberTask.status === 404, 'member-a1 cannot add a task to a lead that is not theirs (404)', `${memberTask.status} ${memberTask.text.slice(0, 120)}`);
    const taskRead = await select('lead_tasks', 'owner-a', `select=id,text,done_at&lead_id=eq.${one.id}`);
    const taskReadMember = await select('lead_tasks', 'member-a1', `select=id&lead_id=eq.${one.id}`);
    line(taskRead.status === 200 && taskRead.json?.length === 1 && taskReadMember.status === 200 && taskReadMember.json?.length === 0, 'owner-a reads the task; member-a1 (the lead is not theirs) reads none');
    const done = await call('lead-task', 'owner-a', { task: addPast.json?.task, done: true });
    line(done.status === 200 && done.json?.done === true, 'owner-a finishes the task: 200', `${done.status} ${done.text.slice(0, 120)}`);
    line((await leadsOf({ due: true })).length === 0, 'the finished task leaves the due filter');
    const again = await call('lead-task', 'owner-a', { task: addPast.json?.task, done: true });
    const re = await call('lead-task', 'owner-a', { task: addPast.json?.task, done: false });
    line(again.status === 200 && re.status === 200 && names(await leadsOf({ due: true })) === `${marker} 1`, 'finishing twice is harmless, and reopening puts the lead back in the due filter');
    const taskEv = events(one.id, 'task');
    line(taskEv && taskEv.map((e) => e.a).join() === 'added,done,reopened', 'the timeline holds added, done, reopened (the second "done" wrote nothing)', JSON.stringify(taskEv));

    // 4. the follow-up date
    const past = new Date(Date.now() - 7200_000).toISOString();
    const fu = await call('lead-update', 'owner-a', { lead: three.id, follow_up: past });
    line(fu.status === 204, 'owner-a sets a follow-up two hours ago on the third lead: 204', `${fu.status} ${fu.text.slice(0, 120)}`);
    line(names(await leadsOf({ due: true })) === `${marker} 1 | ${marker} 3`, 'the due filter now lists the first lead (open task) and the third (follow-up)', names(await leadsOf({ due: true })));
    const row3 = (await leadsOf()).find((x) => x.id === three.id);
    line(row3 && new Date(row3.follow_up).getTime() === new Date(past).getTime(), 'the list row carries the follow-up', row3 && row3.follow_up);
    const badFu = await call('lead-update', 'owner-a', { lead: three.id, follow_up: '2026-12-01' });
    line(badFu.status === 400 && badFu.json?.problems?.[0]?.path === 'follow_up', 'a date without a time is refused (400 on follow_up)', `${badFu.status} ${badFu.text.slice(0, 120)}`);
    const clr = await call('lead-update', 'owner-a', { lead: three.id, follow_up: null });
    line(clr.status === 204 && names(await leadsOf({ due: true })) === `${marker} 1`, 'clearing the follow-up takes the lead out of the due filter');
    const fuEv = events(three.id, 'follow-up');
    line(fuEv && fuEv.length === 2, 'two follow-up events: set and cleared', JSON.stringify(fuEv));
  }
} finally {
  const left = (await leadsOf()).map((x) => x.id);
  if (left.length) await call('leads-bulk', 'owner-a', { workspace: WS_A, ids: left, action: 'delete', confirm: true });
  for (const v of viewIds) await call('view-delete', 'owner-a', { view: v });   // an owner deletes a shared view and, for the member's private view, the member does:
  const mineLeft = await select('crm_views', 'member-a1', `select=id&name=like.${encodeURIComponent(marker + '*')}`);
  for (const v of mineLeft.json ?? []) await call('view-delete', 'member-a1', { view: v.id });
  const afterLeads = await leadsOf();
  const afterViews = sql.rows(`select count(*)::int as n from public.crm_views where name like '${marker}%'`);
  const afterTasks = sql.rows(`select count(*)::int as n from public.lead_tasks where text like '${marker}%'`);
  line(afterLeads.length === 0 && afterViews.ok && afterViews.rows[0].n === 0 && afterTasks.ok && afterTasks.rows[0].n === 0, 'staging keeps none of this run\'s leads, tasks or views', `${afterLeads.length} leads, ${JSON.stringify(afterViews.rows)} views, ${JSON.stringify(afterTasks.rows)} tasks`);
}
console.log(`\n${failed ? 'FAILED' : 'PASS'}: CRM block 3b backend on staging, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
