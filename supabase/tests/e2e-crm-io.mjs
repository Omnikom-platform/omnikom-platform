// Staging proof of the CRM export and import in the client's own layout (work order 02; migration 15; functions crm-map-propose,
// crm-template-save, lead-export with `template`, lead-import; add-lead typed). Synthetic data only.
//   STAGING_SUPABASE_REF=... STAGING_DB_URL=... node supabase/tests/e2e-crm-io.mjs
// Steps, one PASS/FAIL line each: owner-a proposes a map from a synthetic file with HubSpot-style headers that include Budget and Timing, and saves
// it; two marked leads (added by hand, typed) are exported in that layout (header order = the map, Budget and Timing present, the phone in the map's
// US form); that export comes back as a dry run (2 rows, 2 duplicates, nothing written); a fresh file of 3 rows (1 duplicate, 1 bad budget) with
// "skip" is refused whole, then fixed and imported: 2 leads created, typed, form import, the consent sentence stored; member-a1's save and import are
// refused. Every lead carries the run marker in its name and email; the `finally` deletes them through leads-bulk (owner-a, confirm), so staging
// keeps no lead. The map is saved under one fixed name, so a re-run updates the same row instead of adding one.
// Runs only against staging (stagingDbUrl refuses anything else); reads the database read-only; keys by variable name only.
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { makeSql } from '../../tools/omnikom-cli/lib/sql.mjs';
import { parseCsv } from '../../tools/crm-map/map.mjs';
import { stagingDbUrl } from './e2e-cleanup.mjs';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const SITE_A = 'aaaaaaaa-0000-0000-0000-00000000517e';
const MAP_NAME = 'e2e crm-io (synthetic)';
const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase) { console.error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)'); process.exit(3); }
let dbUrl;
try { dbUrl = stagingDbUrl(process.env); } catch (e) { console.error(e.message); process.exit(String(e.message).startsWith('BLOCKED') ? 3 : 2); }
const sql = makeSql({ url: dbUrl, readOnly: true });
const base = target.functionsBase.replace(/\/$/, ''), pub = process.env[target.vars.publishableKey];
const tokens = {};
const token = async (who) => tokens[who] ??= await personToken(parseIdentity(who), { target, env: process.env });

let failed = 0;
const line = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : '  ' + String(detail).slice(0, 300)}`); if (!ok) failed++; };
async function call(name, who, body) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${await token(who)}` };
  if (pub) headers.apikey = pub;
  try {
    const res = await fetch(`${base}/${name}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* a CSV */ }
    return { status: res.status, text, json, headers: res.headers };
  } catch (e) { return { status: 0, text: String(e && e.message || e).slice(0, 120), json: null, headers: new Headers() }; }
}
const csvOf = (rows) => rows.map((r) => r.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';

const run = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const marker = `e2e-io-${run}`;                       // in every name and email, so the list's search finds exactly this run's leads
const email = (n) => `${marker}-${n}@example.com`;
const leadsOf = async () => (await call('lead-list', 'owner-a', { workspace: WS_A, search: marker, size: 200 })).json?.rows ?? [];
const HEAD = ['First Name', 'Last Name', 'Email', 'Phone Number', 'Budget', 'Timing', 'Lead Status', 'Contact owner'];

try {
  // 1. propose a map from a synthetic HubSpot-style file that has the test site's budget and timing, then save it
  const sample = csvOf([HEAD, ['Jordan', `Reyes ${marker}`, email('sample'), '(510) 555-0142', '750000', '0-3 months', 'New', 'Agent One']]);
  const p = await call('crm-map-propose', 'owner-a', { workspace: WS_A, csv: sample });
  const cols = p.json?.template?.columns ?? [];
  const field = (h) => cols.find((c) => c.header === h)?.field;
  line(p.status === 200 && field('Budget') === 'answers.budget' && field('Timing') === 'answers.timing' && field('Email') === 'email' && field('First Name') === 'name',
    'propose: Budget and Timing map to the industry fields, Email and the name parts to ours', `${p.status} ${p.text.slice(0, 300)}`);
  const columns = cols.map((c) => (c.field === 'phone' ? { ...c, transform: 'us' } : c));   // the client wants (xxx) xxx-xxxx
  const s = await call('crm-template-save', 'owner-a', { workspace: WS_A, name: MAP_NAME, crm: 'hubspot', columns, value_maps: { status: { new: 'New', contacted: 'Attempted to Contact' } } });
  const tpl = s.json?.template;
  line(s.status === 200 && typeof tpl === 'string', 'save: the owner confirms the map', `${s.status} ${s.text.slice(0, 200)}`);
  const ms = await call('crm-template-save', 'member-a1', { workspace: WS_A, name: MAP_NAME, crm: 'hubspot', columns });
  line(ms.status === 403, 'member-a1 saving a map is refused (403)', `${ms.status} ${ms.text.slice(0, 120)}`);

  // 2. two marked leads, added by hand with industry answers (add-lead types them), exported in that layout
  for (const [n, budget] of [[1, '600000'], [2, '800000']]) {
    const a = await call('add-lead', 'owner-a', { site: SITE_A, name: `Ima ${marker}${n}`, email: email(n), phone: `+1510555020${n}`, answers: { budget, timing: '3-6 months' },
      consentText: 'Synthetic test lead (e2e-crm-io): agreed to be contacted' });
    line(a.status === 201, `add-lead ${n} (answers typed)`, `${a.status} ${a.text.slice(0, 160)}`);
  }
  const typed = (await leadsOf()).filter((x) => typeof x.budget === 'number');
  line(typed.length === 2, 'both hand-added leads hold budget as a number', JSON.stringify(await leadsOf()).slice(0, 200));
  const e = await call('lead-export', 'owner-a', { workspace: WS_A, template: tpl, search: marker, sort: { field: 'budget', dir: 'asc' } });
  const out = e.status === 200 ? parseCsv(e.text) : { headers: [], rows: [] };
  line(e.status === 200 && out.headers.join('|') === columns.map((c) => c.header).join('|'), 'export: the header is the map\'s, in its order', `${e.status} ${e.text.slice(0, 200)}`);
  line(out.headers.includes('Budget') && out.headers.includes('Timing') && out.rows.map((r) => r.Budget).join() === '600000,800000' && out.rows.every((r) => r.Timing === '3-6 months'),
    'export: the Budget and Timing columns hold the leads\' values, in the sort asked for', JSON.stringify(out.rows).slice(0, 200));
  line(out.rows.length === 2 && out.rows[0]['Phone Number'] === '(510) 555-0201', 'export: the phone in the map\'s US form', JSON.stringify(out.rows[0] ?? {}).slice(0, 200));

  // 3. that export comes back as a dry run: 2 rows, both duplicates of the leads just exported, nothing written
  const dry = await call('lead-import', 'owner-a', { workspace: WS_A, template: tpl, file: e.text, file_name: `${marker}-export.csv` });
  line(dry.status === 200 && dry.json?.dry_run === true && dry.json?.rows === 2 && dry.json?.duplicates_count === 2 && dry.json?.new === 0,
    'import the export back, dry run: 2 rows, 2 duplicates', `${dry.status} ${dry.text.slice(0, 300)}`);
  line((await leadsOf()).length === 2, 'the dry run wrote nothing');

  // 4. a fresh file of 3 rows: one repeats lead 1's email, one has a bad budget; "skip" is refused whole, then the fixed file imports 2 leads
  const fresh = (budget) => csvOf([HEAD,
    ['Ima', `${marker}3`, email(3), '(510) 555-0203', '450000', '0-3 months', 'New', ''],
    ['Ima', `${marker}dup`, email(1).toUpperCase(), '', '', '', '', ''],
    ['Ima', `${marker}4`, email(4), '', budget, '6-12 months', 'Attempted to Contact', '']]);
  const real = { workspace: WS_A, template: tpl, file_name: `${marker}-fresh.csv`, dry_run: false, duplicates: 'skip', consent: true };
  const bad = await call('lead-import', 'owner-a', { ...real, file: fresh('lots') });
  line(bad.status === 422 && bad.json?.code === 'I-IMPORT' && bad.json?.problems?.[0]?.row === '4' && bad.json?.problems?.[0]?.path === 'budget',
    'import with a bad budget on line 4: refused whole, naming the line and the field', `${bad.status} ${bad.text.slice(0, 200)}`);
  line((await leadsOf()).length === 2, 'the refused import wrote nothing');
  const ok = await call('lead-import', 'owner-a', { ...real, file: fresh('900000') });
  line(ok.status === 200 && ok.json?.created === 2 && ok.json?.skipped === 1, 'the fixed file: 2 leads created, the duplicate skipped', `${ok.status} ${ok.text.slice(0, 200)}`);
  const got = sql.rows(`select email, form, status, jsonb_typeof(answers -> 'budget') as t, consent_text, sms_consent from public.leads
    where workspace_id = '${WS_A}' and email in ('${email(3)}', '${email(4)}') order by email`);
  const r = got.ok ? got.rows : [];
  line(r.length === 2 && r.every((x) => x.form === 'import' && x.t === 'number' && x.sms_consent === false) && r[1].status === 'contacted',
    'the imported leads: form import, budget a number, status read through the value map, no SMS consent', JSON.stringify(got).slice(0, 300));
  line(r.length === 2 && r.every((x) => String(x.consent_text).startsWith('These people agreed to be contacted by my business. Ticked by the owner on ') && String(x.consent_text).includes(`${marker}-fresh.csv`)),
    'the consent sentence, the date and the file\'s name are each lead\'s consent text', JSON.stringify(r[0] ?? {}).slice(0, 300));
  const mi = await call('lead-import', 'member-a1', { workspace: WS_A, template: tpl, file: fresh('900000'), file_name: 'member.csv' });
  line(mi.status === 403, 'member-a1 importing is refused (403)', `${mi.status} ${mi.text.slice(0, 120)}`);
} finally {
  const left = (await leadsOf()).map((x) => x.id);
  if (left.length) await call('leads-bulk', 'owner-a', { workspace: WS_A, ids: left, action: 'delete', confirm: true });
  const after = await leadsOf();
  line(after.length === 0, 'staging keeps none of this run\'s leads', `${after.length} left`);
}
console.log(`\n${failed ? 'FAILED' : 'PASS'}: CRM export and import on staging, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
