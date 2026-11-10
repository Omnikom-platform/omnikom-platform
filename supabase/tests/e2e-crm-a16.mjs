// Staging proof of CRM A16 (work order 20; migration 23; lead-update status_date / status_who / status_text, lead-list lead_type and status columns and lists, leads-bulk,
// capture's lead type). Synthetic data in workspace A only. Run by the head after migration 23 is applied to staging, the functions are deployed AND workspace A's
// contract carries the crm block (the lists are data: a contract saved before work order 20 has none, and then only not-contacted, spam and enquiry exist).
//   STAGING_SUPABASE_REF=... STAGING_DB_URL=... [SITE_URL=https://<test site preview>] node supabase/tests/e2e-crm-a16.mjs
// Steps, one PASS/FAIL line each: the list answer carries the business's lead types and statuses (BLOCKED when it has none); a hand-entered lead is an enquiry at
// not-contacted; a status that needs a date is 400 on status_date without one and 204 with it, and the row and the event say the date; a status that records who
// defaults to the caller and names a member when asked, and an outsider is 400 on status_who; a status the business lacks, a bad date and a 201-character line are 400
// naming the field; lead_type and status filter, status_date ranges, and status sorts by its place in the list; a bulk status that needs a date is 400; a note carries
// its author (user, with a name) in the timeline the person reads through row level security; with SITE_URL, a submission whose leadType answer is listing-question
// is stored as that type (only when the business's contract maps it, else the line says NOT RUN).
// Every lead it makes carries the run marker in its name; the `finally` deletes them through leads-bulk, so staging keeps nothing. Runs only against staging
// (stagingDbUrl refuses anything else); reads the database read-only; keys by variable name only.
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { makeSql } from '../../tools/omnikom-cli/lib/sql.mjs';
import { stagingDbUrl } from './e2e-cleanup.mjs';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const site = (process.env.SITE_URL || '').replace(/\/$/, '');
const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase || !target.restBase) { console.error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)'); process.exit(3); }
let dbUrl;
try { dbUrl = stagingDbUrl(process.env); } catch (e) { console.error(e.message); process.exit(String(e.message).startsWith('BLOCKED') ? 3 : 2); }
const sql = makeSql({ url: dbUrl, readOnly: true });
const base = target.functionsBase.replace(/\/$/, ''), rest = target.restBase.replace(/\/$/, ''), pub = process.env[target.vars.publishableKey];
const tokens = {};
const token = async (who) => tokens[who] ??= await personToken(parseIdentity(who), { target, env: process.env });
const subOf = async (who) => JSON.parse(Buffer.from((await token(who)).split('.')[1], 'base64url').toString()).sub;

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
const marker = `e2e a16 ${run}`;
const made = [];
const list = (extra = {}) => call('lead-list', 'owner-a', { workspace: WS_A, search: marker, size: 200, ...extra });
const names = (rows) => (rows ?? []).map((r) => r.name).join(' | ');
const add = async (n) => {
  const r = await call('add-lead', 'owner-a', { site: SITE_A_ID, name: `${marker} ${n}`, email: `e2e-a16-${run}-${n}@example.com`, consentText: 'e2e proof: entered by hand' });
  if (r.json?.lead) made.push(r.json.lead);
  return r;
};
let SITE_A_ID = null;

try {
  const s = sql.rows(`select id from public.sites where workspace_id = '${WS_A}' order by created_at, id limit 1`);
  SITE_A_ID = s.ok ? s.rows[0]?.id : null;
  if (!SITE_A_ID) { console.error('BLOCKED: workspace A has no site'); process.exit(3); }

  const first = await list();
  const types = first.json?.lead_types, statuses = first.json?.statuses;
  const has = (k) => (statuses ?? []).some((x) => x.key === k);
  if (!Array.isArray(types) || !Array.isArray(statuses) || !has('call-back') || !has('contacted')) {
    console.error(`BLOCKED: workspace A's contract has no crm block with call-back and contacted (lead_types ${JSON.stringify(types)?.slice(0, 80)}): save the contract with the lists first`);
    process.exit(3);
  }
  line(types.some((x) => x.key === 'enquiry') && statuses.some((x) => x.key === 'not-contacted') && statuses.find((x) => x.key === 'call-back').needsDate === true,
    'lead-list answers the business\'s own lead types and statuses, with the flags', JSON.stringify(statuses).slice(0, 200));

  // 1. a hand-entered lead
  const a = await add(1), b = await add(2), c = await add(3);
  line([a, b, c].every((r) => r.status === 201 || r.status === 200) && made.length === 3, 'three leads entered by hand', `${a.status} ${a.text}`.slice(0, 200));
  const rows0 = (await list()).json?.rows ?? [];
  const r1 = rows0.find((x) => x.name === `${marker} 1`), r2 = rows0.find((x) => x.name === `${marker} 2`), r3 = rows0.find((x) => x.name === `${marker} 3`);
  line(rows0.length === 3 && r1 && r1.lead_type === 'enquiry' && r1.status === 'not-contacted' && r1.status_date === null, 'a hand-entered lead is an enquiry at not-contacted', JSON.stringify(r1).slice(0, 200));
  if (!(r1 && r2 && r3)) throw new Error('the three leads are not in the list');

  // 2. a status that needs a date
  const nodate = await call('lead-update', 'owner-a', { lead: r1.id, status: 'call-back' });
  line(nodate.status === 400 && nodate.json?.problems?.[0]?.path === 'status_date', 'call-back without a date is 400 on status_date', nodate.text);
  const dated = await call('lead-update', 'owner-a', { lead: r1.id, status: 'call-back', status_date: '2027-01-15' });
  line(dated.status === 204, 'call-back with a date is 204', dated.text);
  const after = ((await list()).json?.rows ?? []).find((x) => x.id === r1.id);
  line(after?.status === 'call-back' && after?.status_date === '2027-01-15', 'the row says call-back on 2027-01-15', JSON.stringify(after).slice(0, 200));
  const ev = await select('lead_events', 'owner-a', `select=detail&lead_id=eq.${r1.id}&kind=eq.status`);
  line(ev.status === 200 && ev.json?.some((e) => e.detail?.to === 'call-back' && e.detail?.date === '2027-01-15'), 'the timeline event carries the date', ev.text);

  // 3. a status that records who
  const me = await subOf('owner-a');
  const contacted = await call('lead-update', 'owner-a', { lead: r2.id, status: 'contacted' });
  const who1 = ((await list()).json?.rows ?? []).find((x) => x.id === r2.id)?.status_who;
  line(contacted.status === 204 && who1 === me, 'contacted by owner-a records owner-a', `${contacted.status} ${who1}`);
  const outsider = await call('lead-update', 'owner-a', { lead: r2.id, status: 'contacted', status_who: '00000000-0000-0000-0000-00000000dead' });
  line(outsider.status === 400 && outsider.json?.problems?.[0]?.path === 'status_who', 'a person who is not a member is 400 on status_who', outsider.text);

  // 4. bad bodies name their field
  const bads = [['status', 'not-a-status-of-ours', 'status'], ['status_date', '2027-02-30', 'status_date'], ['status_text', 'x'.repeat(201), 'status_text']];
  for (const [k, v, path] of bads) {
    const r = await call('lead-update', 'owner-a', { lead: r3.id, status: 'qualified', [k]: v });
    line(r.status === 400 && r.json?.problems?.[0]?.path === path, `${k}=${String(v).slice(0, 20)} is 400 naming ${path}`, r.text);
  }

  // 5. filters and sort
  await call('lead-update', 'owner-a', { lead: r3.id, status: 'qualified' });
  await call('lead-update', 'owner-a', { lead: r3.id, fields: { lead_type: types.find((x) => x.key !== 'enquiry')?.key ?? 'enquiry' } });
  const byStatus = await list({ filters: [{ field: 'status', op: 'in', values: ['qualified', 'call-back'] }], sort: { field: 'name', dir: 'asc' } });
  line(names(byStatus.json?.rows) === `${marker} 1 | ${marker} 3`, 'filter by status', names(byStatus.json?.rows));
  const byDate = await list({ filters: [{ field: 'status_date', op: 'range', from: '2027-01-01', to: '2027-01-31' }] });
  line(names(byDate.json?.rows) === `${marker} 1`, 'filter by status date (a range)', names(byDate.json?.rows));
  const other = types.find((x) => x.key !== 'enquiry')?.key;
  const byType = await list({ filters: [{ field: 'lead_type', op: 'eq', value: other }] });
  line(names(byType.json?.rows) === `${marker} 3`, `filter by lead type (${other})`, names(byType.json?.rows));
  const order = statuses.map((x) => x.key), idx = (k) => order.indexOf(k);
  const sorted = (await list({ sort: { field: 'status', dir: 'asc' } })).json?.rows ?? [];
  const ranks = sorted.map((x) => idx(x.status));
  line(sorted.length === 3 && ranks.every((v, i) => i === 0 || ranks[i - 1] <= v), 'status sorts by its place in the business\'s list', sorted.map((x) => x.status).join());

  // 6. bulk
  const bulkDate = await call('leads-bulk', 'owner-a', { workspace: WS_A, ids: [r1.id, r2.id], action: 'status', value: 'call-back' });
  line(bulkDate.status === 400, 'a bulk status that needs a date is 400', bulkDate.text);

  // 7. a note carries its author
  await call('lead-update', 'owner-a', { lead: r2.id, note: `${marker} note` });
  const notes = await select('lead_events', 'owner-a', `select=detail,by&lead_id=eq.${r2.id}&kind=eq.note`);
  const nd = notes.json?.[0];
  line(nd && nd.by === me && nd.detail?.author?.kind === 'user' && typeof nd.detail?.author?.name === 'string' && nd.detail.author.name.length > 0, 'the note carries its author: the user id and a name', notes.text);

  // 8. a submission through the published form
  if (site && types.some((x) => x.key === 'listing-question')) {
    const page = await fetch(`${site}/contact/`, { signal: AbortSignal.timeout(30000) }).then((r) => r.text()).catch(() => '');
    const form = (page.match(/<form\b[\s\S]*?<\/form>/) || [''])[0];
    const consentText = (form.match(/name="consentText" value="([^"]*)"/) || [])[1]?.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const body = new URLSearchParams({ form: 'contact', page: '/contact/', name: `${marker} ask`, email: `e2e-a16-${run}-ask@example.com`, hp: '', consent: 'yes', consentText: consentText || '', leadType: 'listing-question' });
    const st = (await fetch(`${site}/api/lead`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual', signal: AbortSignal.timeout(30000) })).status;
    const got = ((await list()).json?.rows ?? []).find((x) => x.name === `${marker} ask`);
    if (got) made.push(got.id);
    line([200, 303].includes(st) && got?.lead_type === 'listing-question', 'a submission whose leadType answer is listing-question is stored as listing-question', `${st} ${got?.lead_type}`);
  } else console.log('NOT RUN the published-form step: set SITE_URL and give the contract the listing-question type');
} finally {
  if (made.length) {
    const del = await call('leads-bulk', 'owner-a', { workspace: WS_A, ids: made, action: 'delete', confirm: true });
    const left = sql.rows(`select count(*)::int as n from public.leads where workspace_id = '${WS_A}' and name like '${marker}%'`);
    line(del.status === 200 && left.ok && left.rows[0].n === 0, 'cleanup: every lead this run made is deleted', `${del.status} ${del.text}`.slice(0, 200));
  }
}
console.log(failed ? `FAILED: ${failed} check(s)` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
