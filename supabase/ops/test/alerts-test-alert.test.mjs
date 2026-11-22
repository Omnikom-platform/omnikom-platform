// Tests for `alerts.mjs --test-alert` and for the test step of .github/workflows/alerts.yml (brief P-MAIL, part D): the one marked mail that proves the
// alert mail path. No database and no network: the database variable points nowhere, deps.spawn is a recorder that must stay unused by the test alert,
// and Resend is a fake that records each call. No call leaves this machine.
//   node supabase/ops/test/alerts-test-alert.test.mjs            the suite (T1 to T6)
//   node supabase/ops/test/alerts-test-alert.test.mjs --mutants  the suite, then each seeded fault in a temp copy: each must go red for its named check
// OMNIKOM_ALERTS_SUT and OMNIKOM_ALERTS_YML point the suite at other copies (the mutants set them). Exit 0 = every check passed (and every fault caught).
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const REAL_SUT = join(HERE, '..', 'alerts.mjs');
const REAL_YML = join(REPO, '.github', 'workflows', 'alerts.yml');

// Resend as a fake: each call is recorded; the script gives the answers in turn (the last one repeats)
function fakeResend(...script) {
  const calls = [];
  const f = async (u, init = {}) => {
    calls.push({ url: String(u), method: init.method, headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(String(init.body ?? '{}')) });
    const r = script[Math.min(calls.length - 1, script.length - 1)];
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}
const KEY = 'test-resend-key-not-a-secret', FROM = 'alerts@example.test', TO = 'oncall@example.test';
const NOWHERE = 'postgresql://nobody:nopass@127.0.0.1:1/none';   // a database that cannot answer: the test alert must never ask
const ENV = { STAGING_DB_URL: NOWHERE, RESEND_API_KEY: KEY, LEAD_ALERT_FROM: FROM, ALERTS_TO: TO };
const ARGS = ['--db', 'STAGING_DB_URL', '--test-alert', '--send', '--to-env', 'ALERTS_TO'];
const NOON = new Date('2026-11-22T10:15:30Z');
const leaks = text => [KEY, FROM, TO, NOWHERE, 'nopass'].filter(s => text.includes(s));

async function suite(sutPath, ymlPath, n) {
  const results = [];
  const t = async (name, body) => {
    try { const [ok, detail] = await body(); results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 600) }); }
    catch (e) { results.push({ name, ok: false, detail: 'threw: ' + (e && e.message) }); }
  };
  const A = await import(pathToFileURL(sutPath).href + '?m=' + n);
  const recorder = () => { const d = { spawned: 0 }; d.spawn = () => { d.spawned++; return { status: 1, stdout: '', stderr: 'the test alert must not ask the database' }; }; return d; };

  await t('T1 --test-alert --send --to-env ALERTS_TO: exactly one POST (marked subject, from LEAD_ALERT_FROM, to the address, the bearer key, the key of the day), no database query, exit 0, last line "test alert: sent 1 of 1", no key or address printed', async () => {
    const d = recorder();
    const r = A.main(ARGS, ENV, d);
    const fake = fakeResend({ status: 200, body: { id: 're_t1' } });
    const code = r.send ? await A.deliver(r, ENV, fake.f, NOON) : 99;
    const c = fake.calls[0] || { body: {}, headers: {} };
    const text = r.lines.join('\n');
    const ok = r.exit === 0 && code === 0 && fake.calls.length === 1 && d.spawned === 0
      && c.url === 'https://api.resend.com/emails' && c.method === 'POST'
      && c.body.subject === '[staging] TEST ALERT, nothing is wrong (started by hand)' && c.body.from === FROM && c.body.to === TO
      && c.headers.authorization === 'Bearer ' + KEY && c.headers['idempotency-key'] === 'alerts-test-staging-2026-11-22'
      && String(c.body.text).split('\n').length === 3 && r.lines.at(-1) === 'test alert: sent 1 of 1' && leaks(text + c.body.text).filter(s => s !== FROM && s !== TO && s !== KEY).length === 0 && !text.includes(KEY) && !text.includes(TO) && !text.includes(FROM);
    return [ok, 'exit ' + r.exit + '/' + code + '; posts ' + fake.calls.length + '; spawned ' + d.spawned + '; ' + JSON.stringify(c.body.subject) + ' ' + JSON.stringify(c.headers['idempotency-key']) + '; ' + r.lines.join(' / ')];
  });

  await t('T2 the provider answers 409 invalid_idempotent_request (a test the same UTC day): exit 0, last line "test alert: sent before today (0 new)", one POST and no second', async () => {
    const r = A.main(ARGS, ENV, recorder());
    const fake = fakeResend({ status: 409, body: { statusCode: 409, name: 'invalid_idempotent_request', message: 'used before' } });
    const code = r.send ? await A.deliver(r, ENV, fake.f, NOON) : 99;
    return [r.exit === 0 && code === 0 && fake.calls.length === 1 && r.lines.at(-1) === 'test alert: sent before today (0 new)', 'exit ' + r.exit + '/' + code + '; ' + r.lines.join(' / ')];
  });

  await t('T3 --test-alert without --send is usage (exit 2): a test that sends nothing proves nothing', async () => {
    const r = A.main(['--db', 'STAGING_DB_URL', '--test-alert'], ENV, recorder());
    return [r.exit === 2 && !r.send, 'exit ' + r.exit + ': ' + r.lines.join(' / ')];
  });

  await t('T4 RESEND_API_KEY unset: BLOCKED (exit 3), the line names it, nothing is posted and no query is made', async () => {
    const noKey = { ...ENV }; delete noKey.RESEND_API_KEY;
    const d = recorder();
    const r = A.main(ARGS, noKey, d);
    const fake = fakeResend({ status: 200 });
    if (r.send) await A.deliver(r, noKey, fake.f, NOON);
    return [r.exit === 3 && /RESEND_API_KEY/.test(r.lines.join('\n')) && fake.calls.length === 0 && d.spawned === 0, 'exit ' + r.exit + '; posts ' + fake.calls.length + '; ' + r.lines.join(' / ')];
  });

  await t('T5 the hourly path with two firing alerts never posts a subject that holds TEST ALERT (and its keys are not the test key)', async () => {
    const spawn = () => ({ status: 0, stderr: '', stdout: [
      'publish-failed-twice|[{"site":"s1","workspace":"w1","jobs":["a1","b2"],"last_error":"boom"}]',
      'function-errors|[{"fn":"capture-lead","status":500,"answers":5,"request":"e3100000"}]'].join('\n') });
    const r = A.main(['--db', 'STAGING_DB_URL', '--send', '--to-env', 'ALERTS_TO', '--only', 'publish-failed-twice,function-errors'], ENV, { spawn });
    const fake = fakeResend({ status: 200, body: { id: 're_t5' } });
    const code = r.send ? await A.deliver(r, ENV, fake.f, NOON) : 99;
    const subjects = fake.calls.map(c => c.body.subject);
    return [r.exit === 0 && code === 0 && fake.calls.length === 2 && subjects.every(s => !/TEST ALERT/i.test(s)) && fake.calls.every(c => !/alerts-test/.test(c.headers['idempotency-key'])) && !/test alert/i.test(r.lines.join('\n')), 'exit ' + r.exit + '/' + code + '; ' + JSON.stringify(subjects)];
  });

  await t('T6 alerts.yml: the input test_alert exists (boolean, default false, says one marked mail to ALERTS_TO); the test step runs only on workflow_dispatch with the input; the hourly step never passes --test-alert and does not run on a test run', async () => {
    const yml = readFileSync(ymlPath, 'utf8');
    const lines = yml.split(/\r?\n/);
    const bad = [];
    const at = lines.indexOf('  workflow_dispatch:');
    const input = at >= 0 ? lines.slice(at, at + 12).join('\n') : '';
    if (!/^    inputs:\n      test_alert:\n/m.test(input)) bad.push('no input test_alert under workflow_dispatch');
    if (!/^        type: boolean$/m.test(input) || !/^        default: false$/m.test(input)) bad.push('the input is not a boolean with default false');
    if (!/exactly one/.test(input) || !/ALERTS_TO/.test(input)) bad.push('the description does not say exactly one mail to the address in ALERTS_TO');
    const steps = yml.split(/\n(?=      - name: )/).slice(1);
    const test = steps.filter(s => s.includes('--test-alert')), hourly = steps.filter(s => s.includes('--json'));
    if (test.length !== 1) bad.push(test.length + ' steps pass --test-alert (one expected)');
    if (hourly.length !== 1) bad.push(hourly.length + ' steps are the hourly run');
    if (hourly.some(s => s.includes('--test-alert'))) bad.push('the hourly step passes --test-alert');
    const hcond = hourly.length ? (hourly[0].split('\n').find(l => /^        if: /.test(l)) || '') : '';
    if (!/&& !inputs\.test_alert\s*$/.test(hcond)) bad.push('the hourly step also runs on a test run, so more than the one test mail could go out: ' + hcond.trim());
    const cond = test.length ? (test[0].split('\n').find(l => /^        if: /.test(l)) || '') : '';
    if (!cond.includes("github.event_name == 'workflow_dispatch'") || !/&& inputs\.test_alert\s*$/.test(cond) || /schedule/.test(cond)) bad.push('the test step condition is not "workflow_dispatch and the input": ' + cond.trim());
    if (test.length && !/node supabase\/ops\/alerts\.mjs --db STAGING_DB_URL --test-alert --send --to-env ALERTS_TO/.test(test[0])) bad.push('the test step does not run alerts.mjs --db STAGING_DB_URL --test-alert --send --to-env ALERTS_TO');
    if (test.length && !/GITHUB_STEP_SUMMARY/.test(test[0])) bad.push('the test step does not write the job summary');
    if (test.length && !/RESEND_API_KEY LEAD_ALERT_FROM ALERTS_TO/.test(test[0])) bad.push('the test step does not name the three secrets it needs');
    return [!bad.length, bad.join('; ')];
  });
  return results;
}

// the seeded faults: [name, file ("sut" or "yml"), exact text (found once), replacement, the check that must go red]
const MUTANTS = [
  ['the test alert also runs the hourly queries', 'sut', 'if (o.testAlert) {', 'if (o.testAlert && false) {', /^T1 /],
  ['the idempotency key has no date', 'sut', 'const key = `alerts-test-${environment}-${now.toISOString().slice(0, 10)}`;', 'const key = `alerts-test-${environment}`;', /^T1 /],
  ['the test alert is sent without --send', 'sut', "if (o.testAlert && !o.send) throw", 'if (false) throw', /^T3 /],
  ['the test step runs on the schedule', 'yml', "github.event_name == 'workflow_dispatch' && inputs.test_alert", "inputs.test_alert || github.event_name == 'schedule'", /^T6 /],
  ['a test run also runs the hourly step', 'yml', ' && !inputs.test_alert', '', /^T6 /],
  ['the hourly step passes --test-alert', 'yml', 'node supabase/ops/alerts.mjs --db STAGING_DB_URL --json', 'node supabase/ops/alerts.mjs --test-alert --db STAGING_DB_URL --json', /^T6 /],
];

const show = rs => rs.map(r => (r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.detail)).join('\n');
const base = await suite(process.env.OMNIKOM_ALERTS_SUT || REAL_SUT, process.env.OMNIKOM_ALERTS_YML || REAL_YML, 0);
console.log(show(base));
const failed = base.filter(r => !r.ok).length;
console.log(failed ? '\nTEST ALERT TESTS FAILED: ' + failed + ' of ' + base.length : '\nTEST ALERT TESTS OK: ' + base.length + ' checks');
let exit = failed ? 1 : 0;

if (process.argv.includes('--mutants') && !exit) {
  const work = mkdtempSync(join(tmpdir(), 'omnikom-test-alert-mut-'));
  try {
    let n = 0, caught = 0;
    for (const [name, which, from, to, expectRed] of MUTANTS) {
      const src = which === 'sut' ? REAL_SUT : REAL_YML;
      const text = readFileSync(src, 'utf8');
      const found = text.split(from).length - 1;
      if (found !== 1) { console.log('MISSED  ' + name + ': the patch did not apply (target found ' + found + ' times, not once)'); exit = 1; continue; }
      n++;
      const copy = join(work, 'copy-' + n + (which === 'sut' ? '.mjs' : '.yml'));
      writeFileSync(copy, text.split(from).join(to));
      const res = await suite(which === 'sut' ? copy : REAL_SUT, which === 'yml' ? copy : REAL_YML, n);
      const red = res.filter(r => !r.ok);
      if (red.some(r => expectRed.test(r.name))) { caught++; console.log('caught  ' + name + '  [red: ' + red.map(r => r.name.split(' ')[0]).join(',') + ']'); }
      else { exit = 1; console.log('MISSED  ' + name + '  (' + (red.length ? 'red, but not the named check: ' + red[0].name : 'still green') + ')'); }
    }
    console.log(exit ? '\nMUTANTS: not all caught (' + caught + ' of ' + MUTANTS.length + ')' : '\nMUTANTS OK: ' + caught + ' of ' + MUTANTS.length + ' caught, each red for the named check');
  } finally { rmSync(work, { recursive: true, force: true }); }
}
process.exit(exit);
