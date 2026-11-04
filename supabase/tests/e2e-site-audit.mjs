// Staging proof of the stored audit (work order 06; migration 16; function site-audit; the runner stores the summary as gateReport.audit). Synthetic data only.
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/tests/e2e-site-audit.mjs --rows-file <stage.mjs --out file>
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/tests/e2e-site-audit.mjs --job <uuid>
// STAGING ONLY, and the head runs it after the land, the migration apply (M16) and the deploy of `site-audit` (an outward action: the publish
// dispatches the real runner on GitHub and deploys the test site's PREVIEW on Cloudflare Pages).
// --rows-file   publishes the test site to preview once as owner-a (`sites/test-demo-a/publish.mjs --rows-file <f> --wait`, which the head uses for the
//               test site; its stdout names the job), then checks. --job: checks a job that already ended (a publish the head ran with this runner).
// Checks, one PASS/FAIL line each: the publish ended done; its job's gate report on staging holds audit v 1 with pass true (read-only query); `site-audit`
// as owner-a answers latest.preview with v 1, that job's id and pass true; history's first row is that job, without fails; member-a1, owner-b and a
// call without a token are refused (404, 404, 401). Reads the database read-only; keys by variable name only; never prints a token, a key or a URL with one.
// Exit 0 = every check PASS, 1 = a FAIL, 2 = usage, 3 = a name is missing.
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { makeSql } from '../../tools/omnikom-cli/lib/sql.mjs';
import { stagingDbUrl } from './e2e-cleanup.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE_A = 'aaaaaaaa-0000-0000-0000-00000000517e';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const rowsFile = opt('--rows-file'), givenJob = opt('--job');
if ((!rowsFile && !givenJob) || (rowsFile && givenJob) || (givenJob && !UUID.test(givenJob))) { console.error('usage: e2e-site-audit.mjs --rows-file <file> | --job <uuid>'); process.exit(2); }

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
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${await token(who)}`;
  if (pub) headers.apikey = pub;
  try {
    const res = await fetch(`${base}/${name}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  } catch (e) { return { status: 0, text: String(e && e.message || e).slice(0, 120), json: null }; }
}

// ---------- 1 the publish (or the job given) ----------
let job = givenJob;
if (rowsFile) {
  const r = spawnSync(process.execPath, [join(REPO, 'sites', 'test-demo-a', 'publish.mjs'), '--rows-file', resolve(rowsFile), '--wait'], { cwd: REPO, env: process.env, encoding: 'utf8', timeout: 35 * 60 * 1000, windowsHide: true });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const m = /publish 202: job ([0-9a-f-]{36})/.exec(out);
  job = m ? m[1] : null;
  line(r.status === 0 && !!job, 'the test site published to preview as owner-a and the job ended done', `exit ${r.status}; ${out.trim().split(/\r?\n/).slice(-4).join(' | ')}`);
  if (!job) { console.log(`\nFAILED: ${failed} check(s) failed (no job to look at)`); process.exit(1); }
}
console.log(`INFO job ${job}`);

// ---------- 2 what the runner stored (read-only) ----------
const dbRows = sql.rows(`select state::text as state, gate_report -> 'audit' ->> 'v' as v, gate_report -> 'audit' ->> 'target' as target, gate_report -> 'audit' ->> 'pass' as pass, site_id::text as site from public.publish_jobs where id = '${job}'::uuid`);
const stored = dbRows.ok ? dbRows.rows[0] : null;
line(!!stored && stored.state === 'done' && stored.v === '1' && stored.target === 'preview' && stored.pass === 'true' && stored.site === SITE_A,
  'the job\'s gate report on staging holds the audit summary v 1 (target preview, pass true) and the job is done', JSON.stringify(dbRows.ok ? stored : dbRows));

// ---------- 3 site-audit as the owner ----------
const a = await call('site-audit', 'owner-a', { site: SITE_A });
line(a.status === 200, 'site-audit as owner-a answers 200', `${a.status} ${a.text}`);
const p = a.json && a.json.latest && a.json.latest.preview;
line(!!p && p.job === job && p.summary && p.summary.v === 1 && p.pass === true && p.target === 'preview' && p.state === 'done' && p.summary.pass === true,
  'latest.preview is this job: v 1, pass true, target preview, state done', JSON.stringify(p && { job: p.job, v: p.summary && p.summary.v, pass: p.pass, target: p.target, state: p.state }));
line(!!p && p.summary && Array.isArray(p.summary.fails) && p.summary.fails.length === 0 && p.counts && p.counts.FAIL === 0 && p.counts.PASS > 0,
  'latest.preview carries counts (PASS > 0, FAIL 0) and its summary\'s fails list (empty)', JSON.stringify(p && p.counts));
const h = a.json && a.json.history;
line(Array.isArray(h) && h.length >= 1 && h.length <= 10 && h[0].job === job && h[0].summary === null && !/"fails"/.test(JSON.stringify(h)),
  'history\'s first row is this job, and history carries no fails', JSON.stringify(Array.isArray(h) ? h.slice(0, 1) : h));

// ---------- 4 the walls ----------
const m = await call('site-audit', 'member-a1', { site: SITE_A });
line(m.status === 404 && m.json && m.json.code === 'S-NOT-FOUND', 'member-a1 gets not found (site settings are hidden from members)', `${m.status} ${m.text}`);
const b = await call('site-audit', 'owner-b', { site: SITE_A });
line(b.status === 404 && b.json && b.json.code === 'S-NOT-FOUND', 'owner-b (another workspace) gets not found', `${b.status} ${b.text}`);
const n = await call('site-audit', null, { site: SITE_A });
line(n.status === 401, 'a call without a token is refused (401)', `${n.status} ${n.text}`);

console.log(failed ? `\nFAILED: ${failed} check(s) failed` : '\nPASS: site-audit on staging, 0 problem(s)');
process.exit(failed ? 1 : 0);
