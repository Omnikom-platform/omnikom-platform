// One real call per dashboard function on the STAGING project (slice 4.2; brief factory/briefs/4-2-dashboard-functions.md item 5).
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/tests/e2e-functions.mjs
// Calls the deployed functions over HTTPS with real session tokens of the seeded test logins (the CLI's personToken: Auth admin
// generate_link + verify, in memory only, never printed). Keys are read from the environment by name: STAGING_SUPABASE_REF,
// STAGING_SUPABASE_SECRET_KEY, STAGING_SUPABASE_PUBLISHABLE_KEY (the CLI's names). Imports the CLI's modules read-only.
// Prints one PASS/FAIL line per check and exits 1 on any FAIL. What it leaves on staging, on purpose: the content VERSION of the saved
// listing (versions are append-only), one publish job of the test site's business details at their published version (with the dispatch
// token set on staging, publish.yml builds the site from what is already live and deploys it to its preview again), the media row. The
// listing ROW it creates is soft-deleted again in the finally through service.unpublish (STAGING_DB_URL, read by name; e2e-cleanup.mjs);
// the lead goes through the CLI and is counted by its id.
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { callFunction } from '../../tools/omnikom-cli/lib/fn.mjs';
import { main as cli } from '../../tools/omnikom-cli/omnikom.mjs';
import { makeSql } from '../../tools/omnikom-cli/lib/sql.mjs';
import { createCleanup, stagingDbUrl, stagingRemover } from './e2e-cleanup.mjs';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const SITE_A = 'aaaaaaaa-0000-0000-0000-00000000517e';
const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase) { console.error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)'); process.exit(3); }
const pubKey = process.env[target.vars.publishableKey];
let failed = 0;
const line = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); if (!ok) failed++; };
let dbUrl;
try { dbUrl = stagingDbUrl(process.env); } catch (e) { console.error(e.message); process.exit(String(e.message).startsWith('BLOCKED') ? 3 : 2); }
const cleanup = createCleanup({ remove: stagingRemover({ url: dbUrl }), report: line });   // every content row this run creates is removed in the finally (slice 5.2b)
const sql = makeSql({ url: dbUrl, readOnly: true });   // reads the row to publish again (as e2e-crm.mjs reads)

const tokens = {};
async function as(person) { return tokens[person] ??= await personToken(parseIdentity(person), { target, env: process.env }); }
async function fn(name, who, body) {
  const token = await as(who);
  const r = await callFunction({ base: target.functionsBase, name, body: JSON.stringify(body), extraHeaders: { authorization: `Bearer ${token}`, ...(pubKey ? { apikey: pubKey } : {}) } });
  return r;
}
const brief = r => `${r.status} ${r.json && r.json.code ? r.json.code : ''}`.trim();

try {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  // save: owner-a 200 (version n), nobody 404
  const s = await fn('save', 'owner-a', { workspace: WS_A, collection: 'listings', row: null, data: { street: `4.2 e2e ${stamp}` } });
  cleanup.track(s.json && s.json.row);   // created by this save (row: null), so it is removed in the finally
  line(s.status === 200 && s.json && s.json.version >= 1, 'save by owner-a is 200 with a version', `${brief(s)} version ${s.json && s.json.version}`);
  const n = await fn('save', 'nobody', { workspace: WS_A, collection: 'listings', row: null, data: { street: 'x', zzUnknownField: 1 } });
  line(n.status === 404 && !n.snippet.includes('zzUnknownField'), 'save by nobody is 404 and names no field', brief(n));
  // E18: a script in rich text is refused at save (422, I-RICHTEXT); the unknown field zzE18 makes every save version refuse it, so no row is made
  const rt = await fn('save', 'owner-a', { workspace: WS_A, collection: 'faqs', row: null, data: { question: 'E18 e2e', answer: '<script>alert(1)</script>', zzE18: 1 } });
  line(rt.status === 422 && JSON.stringify(rt.json || {}).includes('I-RICHTEXT'), 'save with a script in rich text is 422 and names I-RICHTEXT (E18)', brief(rt));

  // publish of the bare listing: 422 VALIDATION before any job, its missing fields named on its row (E2E-FIX-1)
  if (s.json && s.json.row) {
    const b = await fn('publish', 'owner-a', { site: SITE_A, rows: [s.json.row], versions: [s.json.version] });
    const miss = (b.json && Array.isArray(b.json.problems) ? b.json.problems : []).filter(x => x.code === 'I-REQUIRED' && x.row === s.json.row).map(x => x.path);
    line(b.status === 422 && b.json && b.json.code === 'VALIDATION' && ['slug', 'price', 'description'].every(k => miss.includes(k)), 'publish of a bare listing is 422 VALIDATION naming its missing fields', `${brief(b)} missing ${miss.join(', ')}`);
  }
  // publish: owner-a 202 for the business details at their published version: the build ships exactly what is live (nothing to remove)
  const live = sql.rows(`select id, published_version as n from public.content_rows where workspace_id = '${WS_A}' and collection = 'settings' and deleted_at is null and published_version is not null limit 1`);
  const st = live.ok ? live.rows[0] : null;
  if (st) {
    const p = await fn('publish', 'owner-a', { site: SITE_A, rows: [st.id], versions: [st.n] });
    line(p.status === 202 && p.json && p.json.state === 'queued', 'publish by owner-a is 202 and the job is queued', `${brief(p)} job ${p.json && p.json.job}`);
    console.log(`INFO publish dispatched: ${p.json && p.json.dispatched}${p.json && p.json.reason ? ` (reason: ${p.json.reason})` : ''}   [${p.json && p.json.dispatched ? 'publish.yml builds the test site from what is live and deploys it to its preview again' : 'the job stays queued; the reaper fails it after 24 h'}]`);
  } else line(false, 'publish by owner-a', `no published business details on the test site${live.ok ? '' : ` (${live.code})`}`);

  // lead-update by member-a1 on a lead that is not theirs: 404; add-lead by owner-a 201; the lead is deleted again through the CLI
  const a = await fn('add-lead', 'owner-a', { site: SITE_A, name: 'E2E 4.2 lead', email: 'e2e-test@example.com', consentText: 'E2E test: consent given by the test, safe to ignore', answers: { note: 'slice 4.2 e2e' } });
  line(a.status === 201 && a.json && a.json.lead, 'add-lead by owner-a is 201', brief(a));
  if (a.json && a.json.lead) {
    const u = await fn('lead-update', 'member-a1', { lead: a.json.lead, status: 'contacted' });
    line(u.status === 404, 'lead-update by member-a1 on a lead that is not theirs is 404', brief(u));
    const d = await cli(['lead', 'delete', '--lead', a.json.lead, '--as', 'owner-a', '--target', 'staging', '--json']);
    line(d.exit === 0, 'the e2e lead was deleted through the CLI (lead delete)', `exit ${d.exit}`);
    // counted by its id: the dashboard flows leave their own leads on the test workspace on purpose (E2E-FIX-1)
    const l = await cli(['lead', 'list', '--as', 'owner-a', '--target', 'staging', '--json']);
    let count = null; try { count = JSON.parse(l.stdout).data.leads.filter(x => x.id === a.json.lead).length; } catch { /* reported below */ }
    line(l.exit === 0 && count === 0, 'the e2e lead is gone (lead list as owner-a, counted by its id)', `count ${count}`);
  }

  // upload-start / upload-finish
  const us = await fn('upload-start', 'owner-a', { workspace: WS_A, filename: 'e2e.png', bytes: 1234, mime: 'image/png' });
  line(us.status === 200 && us.json && String(us.json.path).startsWith(`${WS_A}/`) && /\/storage\/v1\/object\/upload\/sign\/media\//.test(String(us.json.uploadUrl)), 'upload-start by owner-a is 200 with a path under workspace A and a signed upload URL', brief(us));
  if (us.json && us.json.media) {
    const uf = await fn('upload-finish', 'owner-a', { media: us.json.media, rightsConfirmed: true });
    line(uf.status === 200 && uf.json && uf.json.processed === false, 'upload-finish by owner-a is 200 and processed stays false', brief(uf));
    console.log(`INFO upload-finish dispatched: ${uf.json && uf.json.dispatched}${uf.json && uf.json.reason ? ` (reason: ${uf.json.reason})` : ''}`);
  }
  const noJwt = await callFunction({ base: target.functionsBase, name: 'save', body: '{}' });
  line(noJwt.status === 401, 'a call with no token is 401', brief(noJwt));
} catch (e) {
  line(false, 'the run', String(e && e.message || e).slice(0, 200));
} finally {
  await cleanup.run();
}
console.log(`\n${failed ? 'FAILED' : 'PASS'}: staging end to end for the dashboard functions, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
