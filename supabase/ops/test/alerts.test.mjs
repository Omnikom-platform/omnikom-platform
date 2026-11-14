// Tests for supabase/ops/alerts.mjs. Run: node supabase/ops/test/alerts.test.mjs
// A throwaway local cluster gets the repository's real schema (supabase/tests/local-shim.sql, then every migration in file order, the way
// run-local.mjs does), then rows are PLANTED: for each alert a case that must fire and near misses that must stay quiet (one step under each
// threshold, the wrong state, the wrong kind, a fix that came after). Each alert is watched firing (exactly the planted sites) and watched
// quiet (an empty database, and every near miss). OMNIKOM_6B_ALERTS points the test at a mutated copy (6b-mutate.mjs).
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startCluster } from './6b-cluster.mjs';
import { applySchema, plant, SCHEMA_FILES } from './6b-alerts-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SUT = process.env.OMNIKOM_6B_ALERTS || join(HERE, '..', 'alerts.mjs');
const A = await import(pathToFileURL(SUT).href);

const T0 = Date.now(); let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log(`PASS ${name}  [${Math.round((Date.now() - T0) / 1000)}s]`); } else { failed++; console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`); } };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ---- the database: a throwaway cluster with the real schema and the planted rows, or (the mutation harness) one that is already prepared
const PREPARED = process.env.OMNIKOM_6B_ALERTS_URL || null;
let cluster = null, URL_;
const root = mkdtempSync(join(tmpdir(), 'omnikom-6b-alerts-test-'));
process.on('exit', () => { try { if (cluster) cluster.stop(); } catch { /* best effort */ } rmSync(root, { recursive: true, force: true }); });
if (PREPARED) { URL_ = PREPARED; }
else {
  cluster = startCluster({ label: '6b-alerts' });
  cluster.createDb('al');
  const s = applySchema(cluster, 'al');
  check(`setup: the shim and ${SCHEMA_FILES.length - 1} migrations applied on the throwaway cluster`, s.ok, s.err);
  if (!s.ok) { console.log(`alerts tests: ${passed} passed, ${failed} failed`); process.exit(1); }
  URL_ = cluster.url('al');
}
const sql = text => {
  const r = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: { ...process.env, ...A.pgEnv(URL_) }, input: text, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(String(r.stderr).split('\n')[0]);
  return String(r.stdout).trim();
};
const run = (names, since = 70) => A.runQueries(URL_, A.ALERTS.filter(a => names.includes(a.name)), { since });
const sitesOf = (items) => items.map(i => i.site);

// ---- 1 an empty database: every alert quiet
if (!PREPARED) {
  const r = run(A.ALERTS.map(a => a.name));
  check('quiet: on an empty database none of the nine alerts fires', A.ALERTS.length === 9 && [...r.values()].every(v => v.length === 0), JSON.stringify([...r]));
  plant(cluster, 'al');
}


// ---- 2 each alert fires for exactly the planted sites and stays quiet on the near misses
const BIG = 20160;      // two weeks of minutes, so the planted Saturday and weekday rows (never today) are inside the window of the after-hours alert
const all = run(A.ALERTS.map(a => a.name), BIG);
const get = n => all.get(n);
{
  const pf = get('publish-failed-twice');
  check('publish-failed-twice: fires for the site with two failures and for the one whose newest job is still in flight', same(sitesOf(pf), ['pf-fire', 'pf-retrying']), JSON.stringify(pf));
  const f = pf.find(i => i.site === 'pf-fire');
  check('publish-failed-twice: names the workspace slug, the two job ids (8 characters) and the last error', f && f.workspace === 'ws-alerts' && f.jobs.length === 2 && f.jobs.every(j => /^[0-9a-f]{8}$/.test(j)) && f.last_error === 'build error: heading missing', JSON.stringify(f));
  check('publish-failed-twice: quiet for one failure, a done between, and a recovery after two failures', !['pf-one', 'pf-mixed', 'pf-recovered'].some(s => sitesOf(pf).includes(s)));
}
{
  const jo = get('job-over-30-min');
  check('job-over-30-min: fires at 45 minutes (building) and at 35 (queued)', same(sitesOf(jo), ['jo-building-45', 'jo-queued-35']), JSON.stringify(jo));
  check('job-over-30-min: quiet at 25 minutes, at 10, and for a finished job that is old', !['jo-deploying-25', 'jo-building-10', 'jo-done-old'].some(s => sitesOf(jo).includes(s)));
  check('job-over-30-min: reports the state and the minutes', jo.some(i => i.site === 'jo-building-45' && i.state === 'building' && i.minutes >= 45 && i.minutes < 120), JSON.stringify(jo));
}
{
  const lp = get('lead-push-failed');
  check('lead-push-failed: fires for the lead that failed 4 times and for the one that failed again after a success', lp.length === 2 && lp.every(i => i.site === 'lp-site' && i.fails === 4), JSON.stringify(lp));
  check('lead-push-failed: carries the last code (401 / 500) for the runbook R5 first step', same(lp.map(i => i.last_code), ['401', '500']), JSON.stringify(lp));
  check('lead-push-failed: quiet for 3 failures, for 4 failures followed by a success, and for four other events', lp.length === 2);
}
{
  const nl = get('no-leads-7-days');
  check('no-leads-7-days: fires for a live site with its last lead 8 days ago and for one that never had a lead', same(sitesOf(nl), ['nl-silent-8', 'nl-never']), JSON.stringify(nl));
  check('no-leads-7-days: quiet for leads at 6 and 2 days, a preview site, a paused site, and a live site younger than 7 days', !['nl-edge-6', 'nl-recent-2', 'nl-preview', 'nl-paused', 'nl-new-3'].some(s => sitesOf(nl).includes(s)));
}
{
  const sb = get('security-not-found-burst');
  check('security-not-found-burst: fires for the login with 10 refusals in the hour', sb.length === 1 && sb[0].actor === 'f1000000' &&sb[0].refusals === 10, JSON.stringify(sb));
  check('security-not-found-burst: quiet for 9, for 10 that are 75 minutes old, for 10 of another code, for 10 with no login, and for 6 + 6 split over two hours', sb.length === 1);
}
{
  const ah = get('security-staff-after-hours');
  const actors = ah.map(i => i.actor);
  check('security-staff-after-hours: fires for Saturday (staff 1), 03:00 (3), 19:00 sharp (4) and 06:59 (7), one action each', same(actors, ['f1000000', 'f3000000', 'f4000000', 'f7000000']) && ah.every(i => i.actions === 1 && i.kinds[0] === 'lead-delete'), JSON.stringify(ah));
  check('security-staff-after-hours: quiet for 10:00, 18:59, 07:00 sharp, a month-old Sunday and a login that is not staff', ah.length === 4);
  const narrow = run(['security-staff-after-hours'], 70).get('security-staff-after-hours');
  check('security-staff-after-hours: the window matters: with 70 minutes the days-old rows are not looked at', narrow.length === 0, JSON.stringify(narrow));
}
{
  const fe = get('function-errors') || [];
  check('F1 (rule A) function-errors: fires for exactly capture-lead 500 with 5 answers in the hour (3 + 2), newest request e3100000', fe.length === 1 && fe[0].fn === 'capture-lead' && fe[0].status === 500 && fe[0].answers === 5 && fe[0].request === 'e3100000', JSON.stringify(fe));
  check('F2 (rule A) function-errors: quiet for lead-list (4), publish 502 (5, 70 minutes ago) and save (3 in the hour, 2 at 65 minutes)', all.has('function-errors') && !fe.some(i => ['lead-list', 'publish', 'save'].includes(i.fn)), JSON.stringify(fe));
}
{
  sql(`update public.retention_rules set budget_mb = 0.001 where table_name = 'audit_log'`);
  const tb = run(['table-over-budget']).get('table-over-budget') || [];
  sql(`update public.retention_rules set budget_mb = 35 where table_name = 'audit_log'`);
  check('table-over-budget: fires for exactly the table over its budget (audit_log at 0.001 MB), with its size and budget', tb.length === 1 && tb[0].table === 'audit_log' && tb[0].budget_mb === 0.001 && typeof tb[0].mb === 'number', JSON.stringify(tb));
  check('table-over-budget: quiet at the budgets the migration sets', A.ALERTS.some(a => a.name === 'table-over-budget') && (get('table-over-budget') || []).length === 0, JSON.stringify(get('table-over-budget')));
}
{
  const pw = get('login-has-password') || [];
  check('login-has-password: fires for exactly the login that holds a hash, by its 8 character id, and prints no email', pw.length === 1 && pw[0].login === 'b1000000' && !JSON.stringify(pw).includes('@'), JSON.stringify(pw));
  check('login-has-password: quiet for an empty-string password and for no password', pw.length >= 1 && !JSON.stringify(pw).includes('b2000000') && !JSON.stringify(pw).includes('b3000000'), JSON.stringify(pw));
}

// ---- 3 the program: output, runbook names, nothing sent, nothing private printed
const env = { TEST_DB_URL: URL_ };
{
  const r = A.main(['--db', 'TEST_DB_URL'], env);
  const text = r.lines.join('\n');
  check('program: prints an ALERT block with the runbook name and its "first step:" line for a firing alert', /ALERT\s+publish-failed-twice\s+\(runbook R1/.test(text) && /\n {9}first step: open the job's gate report/.test(text), text);
  check('program: prints "quiet" for an alert that does not fire and a summary line that says nothing was sent', r.exit === 0 && /alerts: 9 checked, \d firing, \d quiet\. Nothing sent \(no --send\)\./.test(text), text);
  check('program: seven alerts fire in the hour window and name their runbooks R1, R2, R4, R5 and R6; the after-hours one (rows are days old) and the budget one are quiet', /7 firing, 2 quiet/.test(text) && ['R1', 'R2', 'R4', 'R5', 'R6'].every(rb => text.includes(`runbook ${rb}`)) && /quiet\s+security-staff-after-hours/.test(text), text);
  check('program: prints no email, no lead name, no workspace display name, no connection string', !/jane\.secret|Jane Secret|Name That Must Not Print|postgres(ql)?:\/\//.test(text), text);
  const f = A.main(['--db', 'TEST_DB_URL', '--fail-on-alert', '--only', 'publish-failed-twice'], env);
  check('program: --fail-on-alert exits 1 when an alert fires', f.exit === 1);
  const q = A.main(['--db', 'TEST_DB_URL', '--fail-on-alert', '--only', 'job-over-30-min,no-leads-7-days', '--since-minutes', '70'], { TEST_DB_URL: URL_ });
  check('program: --only limits the checks (two alerts ran)', /alerts: 2 checked/.test(q.lines.join('\n')));
}
{
  check('usage: --db with a URL is refused', A.main(['--db', 'postgres://u:p@h/db'], env).exit === 2);
  check('usage: an unknown alert name is refused and the known names are listed', (() => { const r = A.main(['--db', 'TEST_DB_URL', '--only', 'nope'], env); return r.exit === 2 && /known: publish-failed-twice/.test(r.lines.join('\n')); })());
  check('blocked: an unset variable is BLOCKED (exit 3)', (() => { const r = A.main(['--db', 'TEST_DB_URL'], {}); return r.exit === 3 && /BLOCKED: TEST_DB_URL is not set/.test(r.lines.join('\n')); })());
  const bad = A.main(['--db', 'TEST_DB_URL'], { TEST_DB_URL: 'postgresql://nobody:Hunter2-Secret@127.0.0.1:1/none' });
  check('failure: an unreachable database exits 1 and the message holds neither the password nor the host', bad.exit === 1 && !/Hunter2-Secret/.test(bad.lines.join('\n')) && !bad.lines.join('\n').includes('127.0.0.1'), bad.lines.join('\n'));
}

// ---- 3b sending (rule D): Resend is a fake (as E4's outbox.test.ts): it records each call and answers with the next reply of its script (the
// last one repeats); a reply with delayMs answers after that many milliseconds unless the request's signal aborts first (then it rejects with the
// signal's reason). No call leaves this machine.
function fakeResend(...script) {
  const calls = [];
  const f = async (u, init = {}) => {
    calls.push({ url: String(u), method: init.method, headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(String(init.body ?? '{}')) });
    const r = script[Math.min(calls.length - 1, script.length - 1)];
    const answer = () => new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
    if (!r.delayMs) return answer();
    const signal = init.signal;
    return await new Promise((ok, no) => {
      const timer = setTimeout(() => ok(answer()), r.delayMs);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); no(signal.reason); });
    });
  };
  return { f, calls };
}
// a check whose body may throw (before the code there is no deliver export): the throw FAILs that check, never the run
const attempt = async (name, body) => { try { const [ok, detail] = await body(); check(name, ok, detail); } catch (e) { check(name, false, `threw: ${e && e.message}`); } };
const SEND_ENV = { TEST_DB_URL: URL_, RESEND_API_KEY: 'test-resend-key-not-a-secret', LEAD_ALERT_FROM: 'alerts@example.test', ALERTS_TO: 'oncall@example.test' };
const SEND_ARGS = ['--db', 'TEST_DB_URL', '--send', '--to-env', 'ALERTS_TO'];
const TWO = ['--only', 'publish-failed-twice,function-errors'];
const tail = lines => lines.slice(-4).join(' / ');
await attempt('A1 (rule D) send: two firing alerts, two POSTs to Resend (to ALERTS_TO, from LEAD_ALERT_FROM, the bearer key, subject with the runbook), exit 0, "sent: 2 of 2", no key or address printed', async () => {
  const r = A.main([...SEND_ARGS, ...TWO], SEND_ENV);
  const fake = fakeResend({ status: 200, body: { id: 're_a1' } });
  const code = await A.deliver(r, SEND_ENV, fake.f);
  const text = r.lines.join('\n');
  const leaked = ['test-resend-key-not-a-secret', 'alerts@example.test', 'oncall@example.test'].filter(s => text.includes(s));
  const ok = r.exit === 0 && code === 0 && fake.calls.length === 2
    && fake.calls.every(c => c.url === 'https://api.resend.com/emails' && c.method === 'POST' && c.body.to === 'oncall@example.test' && c.body.from === 'alerts@example.test' && c.headers.authorization === 'Bearer test-resend-key-not-a-secret')
    && same(fake.calls.map(c => c.body.subject), ['[test_db_url] publish-failed-twice (runbook R1)', '[test_db_url] function-errors (runbook R6)'])
    && /^sent: 2 of 2$/m.test(text) && leaked.length === 0;
  return [ok, `exit ${r.exit}/${code}; ${JSON.stringify(fake.calls.map(c => [c.url, c.method, c.body.to, c.body.from, c.body.subject]))}; leaked ${leaked.length}; ${tail(r.lines)}`];
});
await attempt('A2 (rule D) send: the idempotency key is one per alert and UTC day (10:00Z and 11:00Z the same, the next day another)', async () => {
  const r = A.main([...SEND_ARGS, '--only', 'publish-failed-twice'], SEND_ENV);
  const keyAt = async iso => { const fake = fakeResend({ status: 200 }); await A.deliver({ ...r, lines: [] }, SEND_ENV, fake.f, new Date(iso)); return fake.calls.map(c => c.headers['idempotency-key']); };
  const k10 = await keyAt('2026-11-12T10:00:00Z'), k11 = await keyAt('2026-11-12T11:00:00Z'), k13 = await keyAt('2026-11-13T10:00:00Z');
  const ok = k10.length === 1 && typeof k10[0] === 'string' && k10[0].length > 0 && k11[0] === k10[0] && typeof k13[0] === 'string' && k13[0] !== k10[0];
  return [ok, JSON.stringify([k10, k11, k13])];
});
await attempt('A3 (rule D) send: Resend answering 500 to the first mail: exit 1, "FAILED  send publish-failed-twice: resend 500", the second still sent', async () => {
  const r = A.main([...SEND_ARGS, ...TWO], SEND_ENV);
  const fake = fakeResend({ status: 500, body: { message: 'down' } }, { status: 200, body: { id: 're_a3' } });
  const code = await A.deliver(r, SEND_ENV, fake.f);
  const text = r.lines.join('\n');
  return [code === 1 && fake.calls.length === 2 && /^FAILED  send publish-failed-twice: resend 500$/m.test(text) && /^sent    function-errors to ALERTS_TO$/m.test(text) && /^sent: 1 of 2$/m.test(text), `exit ${code}; ${tail(r.lines)}`];
});
await attempt('A4 (rule D) send: Resend that does not answer within the time limit: "no answer in 10 s", exit 1', async () => {
  const r = A.main([...SEND_ARGS, '--only', 'publish-failed-twice'], SEND_ENV);
  const fake = fakeResend({ status: 200, body: { id: 're_a4' }, delayMs: 2000 });
  const code = await A.deliver(r, SEND_ENV, fake.f, new Date(), 50);
  return [code === 1 && /^FAILED  send publish-failed-twice: no answer in 10 s$/m.test(r.lines.join('\n')), `exit ${code}; ${tail(r.lines)}`];
});
await attempt('A5 (rule D) send: --send without --to-env is usage (exit 2) and says --to-env <VARIABLE>', async () => {
  const r = A.main(['--db', 'TEST_DB_URL', '--send'], SEND_ENV);
  return [r.exit === 2 && /--send needs --to-env <VARIABLE>/.test(r.lines.join('\n')), `exit ${r.exit}: ${r.lines.join(' / ')}`];
});
await attempt('A6 (rule D) send: RESEND_API_KEY unset is BLOCKED (exit 3), the line names it, and neither the database nor Resend is called', async () => {
  const noKey = { ...SEND_ENV }; delete noKey.RESEND_API_KEY;
  let spawned = 0;
  const r = A.main(SEND_ARGS, noKey, { spawn: () => { spawned++; return { status: 0, stdout: '' }; } });
  const fake = fakeResend({ status: 200 });
  if (r.send) await A.deliver(r, noKey, fake.f);
  return [r.exit === 3 && /RESEND_API_KEY/.test(r.lines.join('\n')) && spawned === 0 && fake.calls.length === 0, `exit ${r.exit}, spawned ${spawned}, posts ${fake.calls.length}: ${r.lines.join(' / ')}`];
});
await attempt('A7 (rule D) send: Resend answering 409 invalid_idempotent_request (today\'s key was used already): "sent before" naming the alert, no second POST, exit 0', async () => {
  const r = A.main([...SEND_ARGS, '--only', 'publish-failed-twice'], SEND_ENV);
  const fake = fakeResend({ status: 409, body: { statusCode: 409, name: 'invalid_idempotent_request', message: 'This idempotency key has already been used on a request that had a different payload.' } });
  const code = await A.deliver(r, SEND_ENV, fake.f);
  const text = r.lines.join('\n');
  return [code === 0 && r.exit === 0 && fake.calls.length === 1 && /^sent before publish-failed-twice: /m.test(text) && !/^FAILED/m.test(text), `exit ${code}; posts ${fake.calls.length}; ${tail(r.lines)}`];
});
await attempt('A8 (rule D) send: Resend answering 409 with another error name (concurrent_idempotent_requests) is still a failed send: exit 1, "FAILED  send publish-failed-twice: resend 409"', async () => {
  const r = A.main([...SEND_ARGS, '--only', 'publish-failed-twice'], SEND_ENV);
  const fake = fakeResend({ status: 409, body: { statusCode: 409, name: 'concurrent_idempotent_requests', message: 'Same idempotency key used while original request is still in progress.' } });
  const code = await A.deliver(r, SEND_ENV, fake.f);
  return [code === 1 && /^FAILED  send publish-failed-twice: resend 409$/m.test(r.lines.join('\n')), `exit ${code}; ${tail(r.lines)}`];
});
{
  let threw = '';
  try { A.runQueries(URL_, [{ name: 'evil', sql: () => 'public.zz_evil()' }]); } catch (e) { threw = e.message; }
  const n = sql(`select count(*) from workspaces where slug = 'evil'`);
  check('read only: a query that writes is refused by the database and nothing was written', /read-only transaction/.test(threw) && n === '0', `${threw} / ${n}`);
}

// ---- 4 the status data for the page
{
  const file = join(root, 'status.json');
  A.main(['--db', 'TEST_DB_URL', '--json', file], env);
  const j = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const by = id => j && j.components.find(c => c.id === id);
  check('status data: schema, a generated time, and the three components of the page', j && j.schema === 'omnikom-status/1' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(j.generated_at) && same(j.components.map(c => c.id), ['dashboard', 'forms', 'publishing']), JSON.stringify(j));
  check('status data: publishing and forms are degraded while their alerts fire, each with a check time', by('publishing').status === 'degraded' && by('forms').status === 'degraded' && by('publishing').checked_at === j.generated_at, JSON.stringify(j));
  check('status data: the dashboard is "unknown" with no check time (nothing measures it), never a made-up "operational"', by('dashboard').status === 'unknown' && by('dashboard').checked_at === null);
  check('status data: the environment is named after the variable (test_db_url here; staging / production for the real ones)', j.environment === 'test_db_url' && A.environmentOf('STAGING_DB_URL') === 'staging' && A.environmentOf('PROD_DB_URL') === 'production', j.environment);
  if (!PREPARED) {
  sql(`delete from lead_events; delete from leads; delete from publish_jobs; delete from sites;`);
  A.main(['--db', 'TEST_DB_URL', '--json', file, '--only', 'publish-failed-twice,job-over-30-min,lead-push-failed,no-leads-7-days'], env);
  const k = JSON.parse(readFileSync(file, 'utf8'));
  check('status data: operational once the conditions are gone (the same file, re-run)', k.components.find(c => c.id === 'publishing').status === 'operational' && k.components.find(c => c.id === 'forms').status === 'operational', JSON.stringify(k));
  }
}

console.log(`alerts tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
