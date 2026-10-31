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
  check('quiet: on an empty database none of the six alerts fires', A.ALERTS.length === 6 && [...r.values()].every(v => v.length === 0), JSON.stringify([...r]));
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

// ---- 3 the program: output, runbook names, nothing sent, nothing private printed
const env = { TEST_DB_URL: URL_ };
{
  const r = A.main(['--db', 'TEST_DB_URL'], env);
  const text = r.lines.join('\n');
  check('program: prints an ALERT block with the runbook name and "would send ... NOT SENT" for a firing alert', /ALERT\s+publish-failed-twice\s+\(runbook R1/.test(text) && /would send: to the on-call email and the chat channel, with the link to runbook R1/.test(text) && /NOT SENT: sending is off/.test(text), text);
  check('program: prints "quiet" for an alert that does not fire and a summary line that says nothing was sent', r.exit === 0 && /alerts: 6 checked, \d firing, \d quiet\. sending is off/.test(text), text);
  check('program: five alerts fire in the hour window and name their runbooks R1, R2, R4 and R5; the after-hours one is quiet (rows are days old)', /5 firing, 1 quiet/.test(text) && ['R1', 'R2', 'R4', 'R5'].every(rb => text.includes(`runbook ${rb}`)) && /quiet\s+security-staff-after-hours/.test(text), text);
  check('program: prints no email, no lead name, no workspace display name, no connection string', !/jane\.secret|Jane Secret|Name That Must Not Print|postgres(ql)?:\/\//.test(text), text);
  const f = A.main(['--db', 'TEST_DB_URL', '--fail-on-alert', '--only', 'publish-failed-twice'], env);
  check('program: --fail-on-alert exits 1 when an alert fires', f.exit === 1);
  const q = A.main(['--db', 'TEST_DB_URL', '--fail-on-alert', '--only', 'job-over-30-min,no-leads-7-days', '--since-minutes', '70'], { TEST_DB_URL: URL_ });
  check('program: --only limits the checks (two alerts ran)', /alerts: 2 checked/.test(q.lines.join('\n')));
}
{
  let spawned = 0;
  const s = A.main(['--send'], env, { spawn: () => { spawned++; return { status: 0, stdout: '' }; } });
  check('send: --send refuses with a plain line, exit 2, and never touches the database', s.exit === 2 && /sending is off: no sender exists/.test(s.lines.join('\n')) && spawned === 0, s.lines.join('\n'));
  check('usage: --db with a URL is refused', A.main(['--db', 'postgres://u:p@h/db'], env).exit === 2);
  check('usage: an unknown alert name is refused and the known names are listed', (() => { const r = A.main(['--db', 'TEST_DB_URL', '--only', 'nope'], env); return r.exit === 2 && /known: publish-failed-twice/.test(r.lines.join('\n')); })());
  check('blocked: an unset variable is BLOCKED (exit 3)', (() => { const r = A.main(['--db', 'TEST_DB_URL'], {}); return r.exit === 3 && /BLOCKED: TEST_DB_URL is not set/.test(r.lines.join('\n')); })());
  const bad = A.main(['--db', 'TEST_DB_URL'], { TEST_DB_URL: 'postgresql://nobody:Hunter2-Secret@127.0.0.1:1/none' });
  check('failure: an unreachable database exits 1 and the message holds neither the password nor the host', bad.exit === 1 && !/Hunter2-Secret/.test(bad.lines.join('\n')) && !bad.lines.join('\n').includes('127.0.0.1'), bad.lines.join('\n'));
}
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
