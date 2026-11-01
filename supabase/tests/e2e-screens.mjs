// One real run of the functions of the four screens (slice 5.2; brief factory/briefs/5-2-screens-functions.md). Two targets, the same checks:
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/tests/e2e-screens.mjs          STAGING (the head runs it, after the commit,
//                                                                                                                   the migration apply and the deploy: DECISIONS 43)
//   node supabase/tests/e2e-screens.mjs --local                                                                    this machine: the harness database, the real handlers
//                                                                                                                   served over HTTP (functions/test/local-serve.ts), the
//                                                                                                                   fake Auth admin API and the fake CRM webhook
// It calls each new function once as owner-a (and member-a1 / owner-b for the refusals), over HTTP, the way the dashboard will. Prints one PASS/FAIL/INFO
// line per check and never a token, a key, a signature or a secret. Exits 1 on any FAIL, 3 when a name is missing.
// What it leaves on STAGING, on purpose: the saved listing (two content versions), the audit rows, and the invited login invite-test-5-2@omnikom.test as a
// member of workspace A (no function removes a member before slice 5.6; remove it with: delete from members where user_id = (select id from auth.users
// where email = 'invite-test-5-2@omnikom.test')). Its leads are deleted again through the CLI, and the alert list is put back as it was.
// What staging does NOT get from it: a signed test request to a CRM (no public echo endpoint is used anywhere in this repository, so crm-test's request
// is proven locally only; on staging the script proves its refusals and that the connection and its Vault secret can be made and removed).
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken, claimsFor } from '../../tools/omnikom-cli/lib/identity.mjs';
import { makeSql } from '../../tools/omnikom-cli/lib/sql.mjs';
import { sign } from '../../tools/omnikom-cli/lib/sign.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL = process.argv.includes('--local');
const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000', WS_B = 'bbbbbbbb-0000-0000-0000-000000000000';
const SITE_A = 'aaaaaaaa-0000-0000-0000-00000000517e';
const ORIGIN = 'http://localhost:5173';
const INVITE = 'invite-test-5-2@omnikom.test';
let failed = 0;
const ctl = (path, init = {}) => fetch(`${fakeBase}${path}`, { ...init, signal: AbortSignal.timeout(15000) });   // the harness's fake services
const line = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); if (!ok) failed++; };
const info = text => console.log(`INFO ${text}`);

// ---------- the target ----------
let base, token, q, localDb = null, fakeBase = null, stop = async () => {}, crmUrl;
if (LOCAL) {
  const { startHarness } = await import(pathToHref(join(REPO, 'supabase', 'functions', 'test', 'harness.mjs')));
  const api = await startHarness();
  const db = api.newDb();
  const env = api.env(db);
  const port = String(56000 + Math.floor(Math.random() * 900));
  const child = spawn('deno', ['run', '-A', join(REPO, 'supabase', 'functions', 'test', 'local-serve.ts')], { cwd: REPO, env: { ...process.env, ...env, LOCAL_SERVE_PORT: port }, windowsHide: true });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const until = Date.now() + 120000;
  while (!/listening on/.test(out) && Date.now() < until && child.exitCode === null) await new Promise(r => setTimeout(r, 300));
  if (!/listening on/.test(out)) { console.error('BLOCKED: the local server did not start:\n' + out.slice(-600)); child.kill(); await api.stop(); process.exit(3); }
  base = `http://127.0.0.1:${port}`;
  fakeBase = api.base;
  const sql = makeSql({ url: env.SUPABASE_DB_URL });
  q = (query, who) => sql.rows(query, who ? { claims: claimsFor(parseIdentity(who)) } : {});
  localDb = env.SUPABASE_DB_URL;
  token = async who => (await (await fetch(`${base}/__token?who=${who}`, { signal: AbortSignal.timeout(15000) })).text()).trim();
  crmUrl = 'https://hooks.example.com/e2e/5-2?x=1';
  stop = async () => { child.kill(); await api.stop(); };
} else {
  const target = resolveTarget('staging', process.env, { needDb: false });
  if (!target.functionsBase) { console.error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)'); process.exit(3); }
  base = target.functionsBase.replace(/\/$/, '');
  const pub = process.env[target.vars.publishableKey];
  const tokens = {};
  token = async who => tokens[who] ??= await personToken(parseIdentity(who), { target, env: process.env });
  const sql = target.dbUrl ? makeSql({ url: target.dbUrl, readOnly: true }) : null;
  q = sql ? (query, who) => sql.rows(query, who ? { claims: claimsFor(parseIdentity(who)) } : {}) : null;
  crmUrl = 'https://example.com/omnikom-e2e-5-2';
  globalThis.__pub = pub;
}

// ---------- calls ----------
async function call(name, who, body, o = {}) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${await token(who)}`;
  if (!LOCAL && globalThis.__pub) headers.apikey = globalThis.__pub;
  if (o.origin) headers.origin = o.origin;
  const method = o.method ?? 'POST';
  try {
    const res = await fetch(`${base}/${name}`, { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined, signal: AbortSignal.timeout(90000) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* 204 or CSV */ }
    return { status: res.status, headers: res.headers, text, json };
  } catch (e) { return { status: 0, headers: new Headers(), text: '', json: null, error: String(e && e.message || e).slice(0, 120) }; }
}
const brief = r => `${r.status}${r.json && r.json.code ? ' ' + r.json.code : ''}${r.error ? ' ' + r.error : ''}`;
const rows = async (query, who) => { if (!q) return null; const r = await q(query, who); return r.ok ? r.rows : null; };
const noDb = what => info(`UNPROVEN: ${what} (no database URL for this target, so the state was not read back)`);
function parseCsv(text) {
  const out = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}

const tag = 'e2e52' + Date.now().toString(36);
const createdLeads = [];
let previousAlerts = null;
try {
  info(`${LOCAL ? 'LOCAL: the real handlers over HTTP on this machine' : 'STAGING'}; tag ${tag}`);

  // ---- A. CORS (item 10)
  const pre = await call('drafts', null, null, { method: 'OPTIONS', origin: ORIGIN });
  line(pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN && pre.headers.get('access-control-allow-methods') === 'POST', 'a browser preflight from the allowed origin is 204 and names that origin, POST only', `${pre.status} allow-origin ${pre.headers.get('access-control-allow-origin')}`);
  const evil = await call('drafts', null, null, { method: 'OPTIONS', origin: 'https://evil.example' });
  line(evil.status === 204 && evil.headers.get('access-control-allow-origin') === null, 'a preflight from an origin that is not listed gets no Allow-Origin', brief(evil));
  const noTok = await call('drafts', null, { site: SITE_A }, { origin: ORIGIN });
  line(noTok.status === 401 && noTok.headers.get('access-control-allow-origin') === ORIGIN, 'a refusal (401, no token) from the allowed origin still carries Allow-Origin', brief(noTok));

  // ---- B. save with the base version
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const s1 = await call('save', 'owner-a', { workspace: WS_A, collection: 'listings', row: null, data: { street: `5.2 e2e ${stamp}` } });
  line(s1.status === 200 && s1.json && s1.json.version >= 1, 'save of a new row without a base is 200', `${brief(s1)} version ${s1.json && s1.json.version}`);
  const row = s1.json && s1.json.row, v1 = s1.json && s1.json.version;
  if (row) {
    const s2 = await call('save', 'owner-a', { workspace: WS_A, collection: 'listings', row, base: v1, data: { street: `5.2 e2e ${stamp} two` } });
    line(s2.status === 200 && s2.json.version === v1 + 1, 'save of the row with base = the newest version is 200 (one version later)', `${brief(s2)} version ${s2.json && s2.json.version}`);
    const stale = await call('save', 'owner-a', { workspace: WS_A, collection: 'listings', row, base: v1, data: { street: `5.2 e2e ${stamp} late` } });
    line(stale.status === 409 && stale.json && stale.json.code === 'S-STALE' && String(stale.json.message).includes(row) && String(stale.json.message).includes(`version ${v1 + 1}`), 'a save with the old base is 409 S-STALE with the row id and the newest version', brief(stale));
    const noBase = await call('save', 'owner-a', { workspace: WS_A, collection: 'listings', row, data: { street: 'x' } });
    line(noBase.status === 400 && noBase.json && (noBase.json.problems || []).some(p => p.path === 'base'), 'a save of an existing row without a base is 400 naming base', brief(noBase));
  }

  // ---- C. leads: add by hand, mark read, the export later
  const mk = async (who, name, email) => {
    const r = await call('add-lead', who, { site: SITE_A, name, email, consentText: 'E2E test: consent given by the test, safe to ignore' });
    if (r.json && r.json.lead) createdLeads.push(r.json.lead);
    return r;
  };
  const ownerLead = await mk('owner-a', '=HYPERLINK("http://e2e.example","x")', `${tag}-owner@example.com`);
  const agentLead = await mk('member-a1', `E2E agent lead ${tag}`, `${tag}-agent@example.com`);
  line(ownerLead.status === 201 && agentLead.status === 201, 'two leads were added (owner-a, member-a1)', `${ownerLead.status} ${agentLead.status}`);
  const oL = ownerLead.json && ownerLead.json.lead, aL = agentLead.json && agentLead.json.lead;
  if (oL && aL) {
    const rd = await call('lead-update', 'member-a1', { lead: aL, read: true });
    line(rd.status === 204, 'lead-update read: true by the agent on their own lead is 204', brief(rd));
    const marks = await rows(`select user_id from public.lead_reads where lead_id = '${aL}'`, 'member-a1');
    if (marks) line(marks.length === 1, 'and the agent reads back exactly one mark of their own (RLS)', `${marks.length}`); else noDb('lead_reads');
    const other = await call('lead-update', 'member-a1', { lead: oL, read: true });
    line(other.status === 404, 'read: true on a lead that is not theirs is 404', brief(other));
  }

  // ---- D. drafts
  const d1 = await call('drafts', 'owner-a', { site: SITE_A });
  const mine = d1.json && (d1.json.drafts || []).find(d => d.row === row);
  line(d1.status === 200 && mine && mine.collection === 'listings' && mine.newest === v1 + 1, 'drafts by owner-a lists the saved row with its newest version', `${brief(d1)} ${mine ? 'newest ' + mine.newest : 'row missing'}`);
  const dA = await call('drafts', 'member-a1', { site: SITE_A });
  line(dA.status === 200 && !(dA.json.drafts || []).some(d => d.row === row), 'drafts by the agent does not list the owner\'s row', brief(dA));
  line((await call('drafts', 'owner-b', { site: SITE_A })).status === 404, 'drafts by owner-b on A\'s site is 404');

  // ---- E. settings: lead alerts
  const before = await rows(`select lead_alert_to, alert_assignee from public.sites where id = '${SITE_A}'`, 'owner-a');
  previousAlerts = before && before[0] ? before[0] : null;
  const al = await call('settings-save', 'owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: [`${tag}@example.com`, `${tag.toUpperCase()}@example.com`], assignee: false } });
  line(al.status === 200 && al.json && al.json.alerts === true, 'settings-save alerts by owner-a is 200', brief(al));
  const after = await rows(`select lead_alert_to, alert_assignee from public.sites where id = '${SITE_A}'`, 'owner-a');
  if (after) line(after[0] && after[0].lead_alert_to.length === 1 && after[0].lead_alert_to[0] === `${tag}@example.com` && after[0].alert_assignee === false, 'and the list is stored lower-cased and de-duplicated', JSON.stringify(after[0] && after[0].lead_alert_to.length)); else noDb('sites.lead_alert_to');
  line((await call('settings-save', 'member-a1', { workspace: WS_A, alerts: { site: SITE_A, to: ['agent@example.com'] } })).status === 404, 'settings-save by the agent is 404');
  const badMail = await call('settings-save', 'owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: ['not-an-email'] } });
  line(badMail.status === 422 && badMail.json && badMail.json.code === 'I-EMAIL', 'a bad address is 422 I-EMAIL', brief(badMail));

  // ---- F. settings: the CRM connection and its Vault secret
  const loop = await call('settings-save', 'owner-a', { workspace: WS_A, crm: { url: 'https://localtest.me/hook' } });
  line(loop.status === 422 && loop.json && loop.json.code === 'I-URL' && /private network/.test(String(loop.json.message)), 'a public name that resolves to 127.0.0.1 is refused as a private address (the host is resolved on this runtime)', `${brief(loop)} ${loop.json && loop.json.message}`);
  const set = await call('settings-save', 'owner-a', { workspace: WS_A, crm: { url: crmUrl } });
  line(set.status === 200 && set.json && set.json.crm === 'set' && !/[0-9a-f]{64}/.test(set.text), 'settings-save crm by owner-a is 200 and the answer holds no secret', brief(set));
  const integ = await rows(`select config ->> 'url' as url, secret_ref from public.integrations where workspace_id = '${WS_A}' and kind = 'crm-webhook'`, 'owner-a');
  if (integ) line(integ.length === 1 && integ[0].url === crmUrl && integ[0].secret_ref === `crm-webhook-${WS_A}`, 'the connection is stored with the Vault NAME crm-webhook-<workspace> (owner reads it through RLS)', JSON.stringify(integ[0] && integ[0].secret_ref)); else noDb('integrations');
  const vault = await rows(`select count(*)::int as n from vault.secrets where name = 'crm-webhook-${WS_A}'`);
  if (vault) line(vault[0].n === 1, 'and exactly one Vault secret of that name exists', `${vault[0].n}`); else noDb('vault.secrets');
  line((await call('crm-test', 'member-a1', { workspace: WS_A })).status === 404, 'crm-test by the agent is 404');
  const noCrm = await call('crm-test', 'owner-b', { workspace: WS_B });
  line(noCrm.status === 409 && noCrm.json && noCrm.json.code === 'NO-CRM', 'crm-test by owner-b (B has no connection) is 409 NO-CRM', brief(noCrm));
  if (LOCAL) {
    await ctl(`/__reset`, { method: 'POST' }); await ctl(`/__hook?status=200`, { method: 'POST' });
    const t = await call('crm-test', 'owner-a', { workspace: WS_A });
    line(t.status === 200 && t.json && t.json.ok === true && t.json.status === 200 && typeof t.json.ms === 'number', 'crm-test by owner-a is 200 { ok, status, ms }', brief(t));
    const rec = await (await ctl(`/__recorded`)).json();
    const hook = rec.hooks[0];
    const secretRow = await rows(`select decrypted_secret as s from vault.decrypted_secrets where name = 'crm-webhook-${WS_A}'`);
    let signatureOk = false;
    if (hook && secretRow && secretRow[0]) { const tt = Number(/^t=(\d+),/.exec(hook.signature || '')[1]); signatureOk = (await sign(secretRow[0].s, 'POST', hook.path, hook.body, tt)) === hook.signature; }
    line(rec.hooks.length === 1 && signatureOk && hook.body === '{"test":true,"lead":{"name":"Test Lead","email":"test@example.com"}}', 'the CRM got ONE request with the fixed body and a signature that verifies with the stored secret', `${rec.hooks.length} request(s)`);
    await ctl(`/__hook?status=302&mode=redirect`, { method: 'POST' });
    const rd = await call('crm-test', 'owner-a', { workspace: WS_A });
    const rec2 = await (await ctl(`/__recorded`)).json();
    line(rd.json && rd.json.ok === false && rd.json.status === 302 && rec2.redirected === 0, 'a redirect is reported (ok false, 302) and not followed', `${brief(rd)} redirected ${rec2.redirected}`);
  } else info('crm-test\'s request to a CRM was NOT sent on staging: no public echo endpoint is used anywhere in this repository (proven locally: run with --local)');
  const gone = await call('settings-save', 'owner-a', { workspace: WS_A, crm: { url: null } });
  line(gone.status === 200 && gone.json && gone.json.crm === 'removed', 'settings-save crm url null is 200 removed', brief(gone));
  const integ2 = await rows(`select 1 from public.integrations where workspace_id = '${WS_A}' and kind = 'crm-webhook'`, 'owner-a');
  if (integ2) line(integ2.length === 0, 'and the connection is gone', `${integ2.length}`); else noDb('integrations after removal');
  const vault2 = await rows(`select count(*)::int as n from vault.secrets where name = 'crm-webhook-${WS_A}'`);
  if (vault2) line(vault2[0].n === 0, 'and its Vault secret is deleted', `${vault2[0].n}`); else noDb('vault.secrets after removal');

  // ---- G. lead-export
  const ex = await call('lead-export', 'owner-a', { site: SITE_A, q: tag });
  const csv = parseCsv(ex.text);
  line(ex.status === 200 && (ex.headers.get('content-type') || '').startsWith('text/csv') && /^attachment; filename="leads-\d{4}-\d{2}-\d{2}\.csv"$/.test(ex.headers.get('content-disposition') || '') && csv[0] && csv[0].join() === 'received,name,email,phone,form,page,status,owner,answers', 'lead-export by owner-a is a text/csv file with the header and a filename', `${ex.status} ${ex.headers.get('content-type')}`);
  const inj = csv.find(r => r[2] === `${tag}-owner@example.com`);
  line(csv.length === 3 && inj && inj[1] === '\'=HYPERLINK("http://e2e.example","x")', 'it holds the two leads of the tag and the formula comes out as text (leading quote)', `${csv.length - 1} rows`);
  const exA = await call('lead-export', 'member-a1', { site: SITE_A, q: tag });
  const csvA = parseCsv(exA.text);
  line(exA.status === 200 && csvA.length === 2 && csvA[1][2] === `${tag}-agent@example.com`, 'lead-export by the agent holds only their own lead (what RLS returns)', `${exA.status} ${csvA.length - 1} rows`);
  line((await call('lead-export', 'owner-b', { site: SITE_A, q: tag })).status === 404, 'lead-export by owner-b on A\'s site is 404 and no file');
  if (oL) {
    const ev = await rows(`select count(*)::int as n from public.lead_events where lead_id = '${oL}' and kind = 'exported'`, 'owner-a');
    if (ev) line(ev[0].n === 1, 'the export left one `exported` event on the owner\'s lead (read through RLS)', `${ev[0].n}`); else noDb('lead_events exported');
  }

  // ---- H. invite-member
  if (LOCAL) {
    const id = '52520002-0000-0000-0000-000000000000';
    await ctl(`/__reset`, { method: 'POST' }); await ctl(`/__auth-user?email=${encodeURIComponent(INVITE)}&id=${id}&db=${encodeURIComponent(localDb)}`, { method: 'POST' });   // the fake Auth creates the login when asked, as GoTrue does
  }
  const inv = await call('invite-member', 'owner-a', { workspace: WS_A, email: INVITE, role: 'member' });
  const keys = inv.json ? Object.keys(inv.json).sort().join() : '';
  line(inv.status === 200 && keys === 'email_sent,invited,user' && inv.json.invited === true && inv.json.email_sent === false && !/action_link|token|http/.test(inv.text), 'invite-member by owner-a is 200 { user, invited: true, email_sent: false } and no link', brief(inv));
  const mem = inv.json && inv.json.user ? await rows(`select role::text as role from public.members where workspace_id = '${WS_A}' and user_id = '${inv.json.user}'`, 'owner-a') : null;
  if (mem) line(mem.length === 1 && mem[0].role === 'member', 'and they are a member of workspace A (read through RLS)', JSON.stringify(mem[0])); else noDb('members');
  const again = await call('invite-member', 'owner-a', { workspace: WS_A, email: INVITE.toUpperCase(), role: 'member' });
  line(again.status === 200 && inv.json && again.json.user === inv.json.user, 'inviting the same address again finds the same login (200, same user)', brief(again));
  if (LOCAL) { const rec = await (await ctl(`/__recorded`)).json(); line(rec.authLinks.length === 1, 'and Auth was asked only once, by the first invite (the login existed the second time)', `${rec.authLinks.length} call(s)`); }
  line((await call('invite-member', 'member-a1', { workspace: WS_A, email: 'agent-invites@omnikom.test', role: 'member' })).status === 404, 'invite-member by the agent is 404 (and creates no login)');
  line((await call('invite-member', 'owner-a', { workspace: WS_A, email: 'not-an-email', role: 'member' })).status === 400, 'a bad email is 400');
} catch (e) {
  line(false, 'the run', String(e && e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 300));
} finally {
  // ---- put things back
  try {
    if (!LOCAL) {
      const { main: cli } = await import('../../tools/omnikom-cli/omnikom.mjs');   // only staging needs the CLI (lead delete), so a local run does not depend on it
      for (const lead of createdLeads) { const d = await cli(['lead', 'delete', '--lead', lead, '--as', 'owner-a', '--target', 'staging', '--json']); line(d.exit === 0, `the e2e lead ${lead.slice(0, 8)} was deleted through the CLI`, `exit ${d.exit}`); }
      if (previousAlerts) await call('settings-save', 'owner-a', { workspace: WS_A, alerts: { site: SITE_A, to: previousAlerts.lead_alert_to, assignee: previousAlerts.alert_assignee } });
    }
  } catch (e) { line(false, 'cleanup', String(e && e.message || e).slice(0, 200)); }
  await stop();
}
console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${LOCAL ? 'local' : 'staging'} end to end for the functions of the four screens, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);

function pathToHref(p) { return new URL(`file:///${p.replace(/\\/g, '/')}`).href; }
