// End-to-end proof of the lead path (DECISIONS 25): a test lead sent to a site's live /api/lead must land in the staging
// database (leads + the received event) and produce a new-lead email (messages row sent). Then it is deleted again so staging
// keeps no fixture.
//   STAGING_DB_URL=... SITE_URL=https://example-a-omnikom-website.pages.dev node supabase/tests/e2e-lead.mjs [--keep] [--no-alert]
// Runs only against STAGING_DB_URL (refuses PROD_DB_URL). The site must be deployed with factory/worker/pages-function-lead.js
// and its SITE_ID / SITE_SIGNING_KEY / PLATFORM_BASE; capture-lead must be deployed on the staging project with
// SUPABASE_DB_URL, RESEND_API_KEY and LEAD_ALERT_FROM; the site's sites.lead_alert_to must hold the owner's address.
// A preview site (noindex) is not a client's live site, and the lead lands in OUR database, so this does not break the rule
// "never submit a form on a client's live site" (CLAUDE.md 2). Status: UNPROVEN until the owner's keys exist.
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const url = process.env.STAGING_DB_URL, site = (process.env.SITE_URL || '').replace(/\/$/, '');
if (!url || !site) { console.error('set STAGING_DB_URL and SITE_URL'); process.exit(2); }
if (process.env.PROD_DB_URL && process.env.PROD_DB_URL === url) { console.error('refusing: STAGING_DB_URL equals PROD_DB_URL'); process.exit(2); }
const keep = process.argv.includes('--keep'), noAlert = process.argv.includes('--no-alert');
const psql = sql => { const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', sql], { encoding: 'utf8', timeout: 60000 }); if (r.status !== 0) { console.error('psql failed:', (r.stderr || '').replace(url, '<db url>').slice(0, 300)); process.exit(1); } return r.stdout.trim(); };
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + detail}`); if (!ok) failed++; };

const key = randomUUID();
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const lead = {
  form: 'contact', flow: 'contact', page: '/e2e-test', cta: 'e2e test',
  name: `E2E test lead ${stamp}`, email: 'e2e-test@example.com', phone: '(555) 010-0199',
  answers: { message: 'Automated end-to-end test of the lead path. Safe to ignore.' },
  consentText: 'I agree that the business may contact me about this request by email, phone or text.',
  marketingConsent: { given: false, text: 'marketing wording' }, hp: '', idempotencyKey: key,
};
const post = async () => {
  const r = await fetch(`${site}/api/lead`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lead), signal: AbortSignal.timeout(30000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

console.log(`posting a test lead to ${site}/api/lead (key ${key.slice(0, 8)}...)`);
const a = await post();
check('the site answers 200 { sent: true }', a.status === 200 && a.body.sent === true, `${a.status} ${JSON.stringify(a.body).slice(0, 200)}`);
const b = await post();                                              // the same submission again: a retry must store nothing new
check('a retry with the same key answers sent again', b.status === 200 && b.body.sent === true, `${b.status}`);

const rows = psql(`select count(*) from public.leads where idempotency_key = '${key}'`);
check('exactly one lead row in staging', rows === '1', `count ${rows}`);
const flow = psql(`select coalesce(flow, '') || '|' || coalesce(cta, '') || '|' || form from public.leads where idempotency_key = '${key}'`);
check('flow, cta and form stored', flow === 'contact|e2e test|contact', flow);
const ev = psql(`select count(*) from public.lead_events e join public.leads l on l.id = e.lead_id where l.idempotency_key = '${key}' and e.kind = 'received'`);
check('the received event is on the timeline', ev === '1', `count ${ev}`);
const ip = psql(`select coalesce(source_ip_hash, '') from public.leads where idempotency_key = '${key}'`);
check('the visitor address is stored only as a hash', ip === '' || /^[0-9a-f]{64}$/.test(ip), ip.slice(0, 20));

if (!noAlert) {
  let state = '';
  for (let i = 0; i < 12 && !/^(sent|delivered)$/.test(state); i++) {
    await new Promise(r => setTimeout(r, 5000));
    state = psql(`select coalesce(string_agg(m.state::text || ':' || coalesce(m.error, ''), ','), '') from public.messages m join public.leads l on l.id = m.lead_id where l.idempotency_key = '${key}' and m.template = 'new-lead'`);
  }
  check('the new-lead alert was sent (messages row sent; check the inbox)', /sent|delivered/.test(state), state || 'no messages row: is RESEND_API_KEY, LEAD_ALERT_FROM and sites.lead_alert_to set?');
}

if (!keep) {
  psql(`delete from public.leads where idempotency_key = '${key}'`);   // events and messages cascade
  check('the test lead was removed from staging', psql(`select count(*) from public.leads where idempotency_key = '${key}'`) === '0');
}
console.log(`\n${failed ? 'FAILED' : 'PASS'}: lead path end to end, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
