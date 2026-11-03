// Staging proof of the CRM backend (work order 01; migration 14; functions lead-update `fields`, lead-list, leads-bulk). Synthetic data only.
//   STAGING_SUPABASE_REF=... STAGING_DB_URL=... SITE_URL=https://<test site preview> node supabase/tests/e2e-crm.mjs
// Steps, one PASS/FAIL line each: the published contact page carries the industry fields; two leads posted through its form endpoint (the
// urlencoded post a browser sends, no script) land typed; owner-a edits a core and an industry field (two edited events); member-a1's edit of a
// lead not theirs is refused; the list searches, filters and sorts on an industry number field and its columns are the contract's, in form order;
// bulk status on the two; bulk delete refused without confirm, then done with it. Every lead it posts carries the run marker in its name and
// email, and the `finally` deletes whatever is left through leads-bulk (owner-a), so staging keeps nothing.
// Runs only against staging (stagingDbUrl refuses anything else); reads the database read-only; keys by variable name only.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { makeSql } from '../../tools/omnikom-cli/lib/sql.mjs';
import { stagingDbUrl } from './e2e-cleanup.mjs';
import { leadColumns } from '../../contracts/validate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const site = (process.env.SITE_URL || '').replace(/\/$/, '');
if (!site) { console.error('BLOCKED: set SITE_URL (the published test site)'); process.exit(3); }
const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase) { console.error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)'); process.exit(3); }
let dbUrl;
try { dbUrl = stagingDbUrl(process.env); } catch (e) { console.error(e.message); process.exit(String(e.message).startsWith('BLOCKED') ? 3 : 2); }
const sql = makeSql({ url: dbUrl, readOnly: true });
const base = target.functionsBase.replace(/\/$/, ''), pub = process.env[target.vars.publishableKey];
const tokens = {};
const token = async (who) => tokens[who] ??= await personToken(parseIdentity(who), { target, env: process.env });
const contract = JSON.parse(readFileSync(join(REPO, 'sites', 'test-demo-a', 'contract.json'), 'utf8'));

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

const run = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const marker = `e2e crm ${run}`;
const leadsOf = async () => (await call('lead-list', 'owner-a', { workspace: WS_A, search: marker, size: 200 })).json?.rows ?? [];

try {
  // 1. the published form carries the typed fields, drawn with no script
  const page = await fetch(`${site}/contact/`, { signal: AbortSignal.timeout(30000) }).then((r) => r.text()).catch(() => '');
  const form = (page.match(/<form\b[\s\S]*?<\/form>/) || [''])[0];
  line(/<select name="timing"/.test(form) && /type="radio" name="side"/.test(form) && /type="number" name="budget"[^>]*min="10000"/.test(form) && /<select name="area"/.test(form) && !/<script\b/i.test(form),
    'the published contact form has timing (select), side (radio), budget (number with min) and area (select), no script', form.slice(0, 200));
  const consentText = (form.match(/name="consentText" value="([^"]*)"/) || [])[1]?.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  line(!!consentText, 'the form carries its consent wording');

  // 2. two leads through the site's own endpoint, as a browser posts the form
  const post = async (n, budget) => {
    const body = new URLSearchParams({ form: 'contact', page: '/contact/', name: `${marker} ${n}`, email: `e2e-crm-${run}-${n}@example.com`,
      side: 'Buying', budget: String(budget), timing: '0-3 months', beds: '3', area: 'alpha', hp: '', consent: 'yes', consentText: consentText || '' });
    const r = await fetch(`${site}/api/lead`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    return r.status;
  };
  const s1 = await post(1, 750000), s2 = await post(2, 600000);
  line([200, 303].includes(s1) && [200, 303].includes(s2), 'two leads posted through the published form endpoint', `${s1} ${s2}`);
  let rows = await leadsOf();
  const one = rows.find((x) => x.name === `${marker} 1`), two = rows.find((x) => x.name === `${marker} 2`);
  line(rows.length === 2 && one && two, 'both leads are in the CRM list', JSON.stringify(rows).slice(0, 200));
  line(one && one.budget === 750000 && one.beds === 3 && one.side === 'Buying' && one.timing === '0-3 months' && one.area === 'alpha',
    'read back typed: budget and beds are numbers, side, timing and area their values', JSON.stringify(one).slice(0, 300));

  if (one && two) {
    // 3. one edit call: a core and an industry field, two edited events
    const e = await call('lead-update', 'owner-a', { lead: one.id, fields: { name: `${marker} 1 edited`, budget: 800000 } });
    line(e.status === 200 && e.json?.changed === 2, 'owner-a edits a core and an industry field: 200 { changed: 2 }', `${e.status} ${e.text.slice(0, 200)}`);
    const ev = sql.rows(`select count(*)::int as n from public.lead_events where lead_id = '${one.id}' and kind = 'edited'`);
    line(ev.ok && ev.rows[0].n === 2, 'two edited events on the timeline', JSON.stringify(ev).slice(0, 200));
    const m = await call('lead-update', 'member-a1', { lead: two.id, fields: { budget: 1 } });
    line(m.status === 404, 'member-a1 editing a lead not theirs is refused (404)', `${m.status} ${m.text.slice(0, 120)}`);

    // 4. the list: search, filter and sort on an industry number field; the columns are the contract's, in form order
    const f = await call('lead-list', 'owner-a', { workspace: WS_A, search: marker, filters: [{ field: 'budget', op: 'range', from: 700000, to: 900000 }] });
    line(f.status === 200 && f.json?.total === 1 && f.json.rows[0].id === one.id, 'filter: budget 700000 to 900000 finds the edited lead only', f.text.slice(0, 200));
    const so = await call('lead-list', 'owner-a', { workspace: WS_A, search: marker, sort: { field: 'budget', dir: 'asc' } });
    line(so.status === 200 && (so.json?.rows ?? []).map((x) => x.budget).join() === '600000,800000', 'sort: budget ascending as numbers', so.text.slice(0, 200));
    const want = leadColumns(contract).filter((c) => c.column).map((c) => c.key).join();
    line((so.json?.columns ?? []).map((c) => c.key).join() === want, `the columns are the contract's in form order (${want})`, JSON.stringify(so.json?.columns ?? []).slice(0, 200));

    // 5. bulk status on the two, then the delete: refused without confirm, done with it
    const b = await call('leads-bulk', 'owner-a', { workspace: WS_A, ids: [one.id, two.id], action: 'status', value: 'contacted' });
    line(b.status === 200 && b.json?.changed === 2, 'bulk status on two leads', `${b.status} ${b.text.slice(0, 120)}`);
    const nc = await call('leads-bulk', 'owner-a', { workspace: WS_A, ids: [one.id, two.id], action: 'delete' });
    line(nc.status === 409 && nc.json?.code === 'S-CONFIRM', 'bulk delete without the confirm flag is refused (409 S-CONFIRM)', `${nc.status} ${nc.text.slice(0, 120)}`);
    const d = await call('leads-bulk', 'owner-a', { workspace: WS_A, ids: [one.id, two.id], action: 'delete', confirm: true });
    line(d.status === 200 && d.json?.changed === 2, 'bulk delete of the test leads with confirm', `${d.status} ${d.text.slice(0, 120)}`);
    const au = sql.rows(`select count(*)::int as n from public.audit_log where action = 'lead-delete' and target in ('${one.id}', '${two.id}')`);
    line(au.ok && au.rows[0].n === 2, 'one audit row per deleted lead', JSON.stringify(au).slice(0, 200));
  }
} finally {
  const left = (await leadsOf()).map((x) => x.id);
  if (left.length) await call('leads-bulk', 'owner-a', { workspace: WS_A, ids: left, action: 'delete', confirm: true });
  const after = await leadsOf();
  line(after.length === 0, 'staging keeps none of this run\'s leads', `${after.length} left`);
}
console.log(`\n${failed ? 'FAILED' : 'PASS'}: CRM backend on staging, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
