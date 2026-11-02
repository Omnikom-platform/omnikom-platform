// Tests for `omnikom test journey` and the journey browser (briefs/journey.md section 6). Called from run.mjs (units part), one import and one
// line. No network and no staging: the steps run against fakes of the capabilities (runJourney is handed the same shape makeImpl returns),
// and the browser runs against a fixture web server on 127.0.0.1 in the real installed Edge or Chrome (a missing browser is a FAIL here, never a skip).
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Does anything the J6 inbox shot did (spawn args and env, the address polled, the page opened) name the old fixed preview address? The calls also hold
// random text (the magic-link token, the env's keys, temp paths), and a bare includes('4173') over all of it is red whenever that text happens to hold
// the digits (a full --unit run went red on it 2026-11-02 18:19 with the URLs right; the journey tests alone passed). Only the address forms count.
export const onOldPort = calls => /localhost:4173|127\.0\.0\.1:4173|"4173"/.test(JSON.stringify(calls));

export async function journeyTests({ check, cli, CLI_ROOT, REPO_ROOT }) {
  const imp = f => import(pathToFileURL(join(CLI_ROOT, f)).href);
  const J = await imp('commands/journey.mjs');
  const { launchBrowser, findBrowser } = await imp('lib/browser.mjs');
  const { makeCtx } = await imp('lib/ctx.mjs');
  const { PRODUCTION_ALLOWED } = await imp('lib/target.mjs');
  const { Blocked } = await imp('lib/errors.mjs');
  const { USAGE } = await imp('omnikom.mjs');
  const { WS_A } = await imp('commands/seed.mjs');
  const rand = () => randomBytes(12).toString('hex');
  const work = mkdtempSync(join(tmpdir(), 'omnikom-journey-test-'));
  const SECRET = rand();
  const ENV = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, STAGING_DB_URL: `postgres://u:${rand()}@127.0.0.1:5/x`, STAGING_SUPABASE_REF: 'testref', STAGING_SUPABASE_SECRET_KEY: SECRET, STAGING_SUPABASE_PUBLISHABLE_KEY: rand() };
  const ALERT = 'alerts@example.com';
  const mkctx = (flags = {}) => makeCtx({ command: 'test', positionals: ['test', 'journey'], flags: { target: 'staging', out: work, ...flags }, deps: { env: ENV, randomUUID: () => 'abcdef12-0000-0000-0000-000000000000', now: () => 1793500000 } });
  const run = async (flags, overrides) => {
    const res = await J.journeyGroup(mkctx(flags), overrides);
    const obj = { ok: res.ok, command: 'test journey', code: res.code, exit: res.ok ? 0 : 1, data: res.data };
    return { res, obj, text: J.journeyText(obj, ENV), byId: Object.fromEntries(res.data.steps.map(s => [s.id, s])) };
  };

  // ---- a fake of the capabilities, and a fake browser
  const fakePage = (o = {}) => ({
    async open() { return { status: 200, headers: { 'x-robots-tag': 'noindex, nofollow' }, consoleErrors: [], exceptions: [], overflow: { overflowing: false, scrollWidth: 390, clientWidth: 390 }, ...o }; },
    async screenshot() { return 1000; }, async close() {}, async has() { return true; }, async fill() {}, async check() {},
    async submit() { return { status: 200, url: 'x', text: '{"sent":true}', ...(o.submit || {}) }; },
  });
  const fakeBrowser = (o = {}) => async () => ({ async newPage() { return fakePage(o); }, async close() { fakeBrowser.closed = (fakeBrowser.closed || 0) + 1; } });
  const goodTitle = J.TESTS.J3.title;
  const pwOk = (title) => ({ ran: 1, rows: [{ title, statuses: ['expected'], ms: 2000 }], failed: 0, flaky: 0, error: null });
  const fakeImpl = (o = {}) => ({
    calls: [],
    async seed() { return { ok: true, code: 'ok', data: { changed: false, logins: ['a', 'b'], testSite: { contractVersion: 2, rows: { pages: 3, team: 2 } } } }; },
    async workspacesAs() { return { status: 200, ids: [WS_A] }; },
    spec(file) { return o.spec ? o.spec(file) : { exists: false, text: '' }; },
    async playwright(file, title) { this.calls.push(`playwright:${file}`); return o.playwright ? o.playwright(file, title) : pwOk(title); },
    launchBrowser: o.launchBrowser || fakeBrowser(),
    fileSize: () => 1000,
    async leadCount() { return o.leadCount === undefined ? 1 : o.leadCount; },
    async sendLead(marker) { this.calls.push('sendLead'); return o.sendLead ? o.sendLead(marker) : { ok: true, code: 'ok', statuses: [202] }; },
    async alertsOnlyTo() { return o.alertsOnlyTo === undefined ? true : o.alertsOnlyTo; },
    async exportCsv(who, marker) { return o.exportCsv ? o.exportCsv(marker) : { status: 200, text: `${J.CSV_HEADER}\n2026-11-01T00:00:00Z,${marker},a@example.com,,contact,/contact/,new,,\n` }; },
    async inboxShot(who, marker, file) { return o.inboxShot ? o.inboxShot(marker, file) : { found: true, file, written: true }; },
    ...(o.seed ? { seed: o.seed } : {}), ...(o.workspacesAs ? { workspacesAs: o.workspacesAs } : {}),
  });
  const base = { alertTo: ALERT, previewBase: 'http://x.invalid' };

  // ======================================================== the Playwright report: what a step may call a pass
  const rep = (specs) => ({ suites: [{ specs: specs.map(([title, status]) => ({ title, tests: [{ status, results: [{ duration: 1500 }] }] })) }], errors: [] });
  const T = 'some test title';
  check('journey: a report with the named test passed is a PASS', J.playwrightVerdict(J.summarizePlaywright(rep([[T, 'expected']])), T).status === 'PASS');
  check('journey: a report with the named test failed is a FAIL', J.playwrightVerdict(J.summarizePlaywright(rep([[T, 'unexpected']])), T).status === 'FAIL');
  check('journey: a report with 0 tests is a FAIL that says 0 tests ran (never a pass)', (() => { const v = J.playwrightVerdict(J.summarizePlaywright(rep([])), T); return v.status === 'FAIL' && /0 tests ran/.test(v.evidence); })());
  check('journey: a report whose only test was skipped is a FAIL', J.playwrightVerdict(J.summarizePlaywright(rep([[T, 'skipped']])), T).status === 'FAIL');
  check('journey: a report that also ran another test is a FAIL', J.playwrightVerdict(J.summarizePlaywright(rep([[T, 'expected'], ['another', 'expected']])), T).status === 'FAIL');
  check('journey: a flaky test is a FAIL', J.playwrightVerdict(J.summarizePlaywright(rep([[T, 'flaky']])), T).status === 'FAIL');
  check('journey: a report with an error is a FAIL', J.playwrightVerdict(J.summarizePlaywright({ suites: [], errors: [{ message: 'boom' }] }), T).status === 'FAIL');
  check('journey: no report at all is a FAIL', J.playwrightVerdict(J.summarizePlaywright(null), T).status === 'FAIL');

  // ======================================================== the two dashboard titles exist verbatim (a rename turns THIS suite red)
  const tests = f => join(REPO_ROOT, 'apps', 'dashboard', 'tests', f);
  check('journey: the J6 test title exists verbatim in apps/dashboard/tests/flows.spec.ts', existsSync(tests('flows.spec.ts')) && readFileSync(tests('flows.spec.ts'), 'utf8').includes(J.TESTS.J6.title));
  const siteSpec = existsSync(tests('site.spec.ts'));
  check(`journey: the J3 test title exists verbatim in site.spec.ts when that file exists (${siteSpec ? 'it does on this tree' : 'the file is not on this tree: J3 is NOT BUILT YET, checked below'})`, !siteSpec || readFileSync(tests('site.spec.ts'), 'utf8').includes(J.TESTS.J3.title));
  const real = J.makeImpl({ target: () => ({ vars: { publishableKey: 'X' } }), env: {} });
  check('journey: the real spec reader agrees with the disk about site.spec.ts and flows.spec.ts', real.spec('site.spec.ts').exists === siteSpec && real.spec('flows.spec.ts').exists === true && real.spec('flows.spec.ts').text.includes(J.TESTS.J6.title));

  // ======================================================== the orchestrator, with fakes
  const pass = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl() });
  const shape = /^J\d (PASS|FAIL|BLOCKED|NOT BUILT YET|SKIPPED \(after J\d (FAIL|BLOCKED)\)) \S.*/;
  const lines = pass.text.trim().split('\n');
  check('journey: one line per step J1..J9 in order, then one summary line', lines.length === 10 && lines.slice(0, 9).every((l, i) => l.startsWith(`J${i + 1} `) && shape.test(l)) && lines[9].startsWith('journey (staging): '), pass.text);
  check('journey: with a good tree the result is 6 PASS, 3 NOT BUILT YET, 0 FAIL and the exit is 0', pass.res.ok && pass.obj.exit === 0 && lines[9].startsWith('journey (staging): 6 PASS, 3 NOT BUILT YET, 0 FAIL'), lines[9]);
  check('journey: J3 on a tree with no site.spec.ts prints NOT BUILT YET with the file named', pass.byId.J3.status === 'NOT BUILT YET' && /apps\/dashboard\/tests\/site\.spec\.ts missing/.test(pass.byId.J3.evidence));
  check('journey: J8 and J9 print NOT BUILT YET and are never counted as a pass', pass.byId.J8.status === 'NOT BUILT YET' && pass.byId.J9.status === 'NOT BUILT YET' && pass.res.data.counts.PASS === 6);
  check('journey: the summary names the screenshot folder', lines[9].includes(pass.res.data.out) && pass.res.data.out.startsWith(work));
  check('journey: a screenshot path is printed on the step line that took it', /^J4 PASS .*\| png: .*j4-phone-home\.png; .*j4-phone-contact\.png; .*j4-desktop-home\.png; .*j4-desktop-contact\.png/.test(lines[3]) && /j5-form-answer\.png/.test(lines[4]) && /j6-inbox-owner-a\.png/.test(lines[5]), lines.slice(3, 6).join(' // '));

  const withSpec = { spec: () => ({ exists: true, text: `test('${goodTitle}')` }) };
  const okJ3 = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl(withSpec) });
  check('journey: J3 with the spec file present and a passing run is a PASS (the file is the only thing that decides NOT BUILT YET)', okJ3.byId.J3.status === 'PASS');
  const brokenJ3 = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ ...withSpec, playwright: t => ({ ran: 1, rows: [{ title: t, statuses: ['unexpected'], ms: 10 }], failed: 1, flaky: 0, error: null }) }) });
  check('journey: a broken publish (the dashboard test fails) goes red AT J3, not later, and the exit is 1', brokenJ3.byId.J3.status === 'FAIL' && brokenJ3.byId.J4.status === 'PASS' && !brokenJ3.res.ok && brokenJ3.obj.exit === 1 && /^J3 FAIL /m.test(brokenJ3.text));
  const noTitle = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ spec: () => ({ exists: true, text: "test('another title')" }) }) });
  check('journey: J3 with the file present but its title missing is a FAIL, never a silent NOT BUILT YET', noTitle.byId.J3.status === 'FAIL' && /no test titled/.test(noTitle.byId.J3.evidence));
  const zero = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ ...withSpec, playwright: () => ({ ran: 0, rows: [], failed: 0, flaky: 0, error: null }) }) });
  check('journey: J3 whose run executed 0 tests is a FAIL', zero.byId.J3.status === 'FAIL' && /0 tests ran/.test(zero.byId.J3.evidence));

  const j1bad = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ seed: async () => ({ ok: false, code: 'S-X', data: { error: 'nope' } }) }) });
  check('journey: J1 FAIL skips J2, J3, J5, J6 and J7 with "SKIPPED (after J1 FAIL)", still runs J4, and the exit is 1',
    j1bad.byId.J1.status === 'FAIL' && ['J2', 'J3', 'J5', 'J6', 'J7'].every(i => j1bad.byId[i].status === 'SKIPPED') && /^J2 SKIPPED \(after J1 FAIL\) /m.test(j1bad.text) && j1bad.byId.J4.status === 'PASS' && j1bad.obj.exit === 1, j1bad.text);
  // a product bug at J5 must not leave J6 and J7 unproven: they use ONE lead made by `lead send`, and their lines say so
  const FALLBACK = '(lead from lead send: J5 did not store one)';
  const implB = fakeImpl({ leadCount: 0 });
  implB.leadCount = async m => (/lead send/.test(m) ? 1 : 0);
  const j5bad = await run({ 'alert-to': ALERT }, { ...base, impl: implB });
  check('journey: J5 FAIL (no lead row): J6 and J7 still run on ONE lead made by lead send, and both lines say so',
    j5bad.byId.J5.status === 'FAIL' && j5bad.byId.J6.status === 'PASS' && j5bad.byId.J7.status === 'PASS' && j5bad.byId.J6.evidence.includes(FALLBACK) && j5bad.byId.J7.evidence.includes(FALLBACK) && implB.calls.filter(c => c === 'sendLead').length === 1 && !j5bad.res.ok, j5bad.text);
  check('journey: the lead from lead send carries the run\'s marker, never J5\'s name', /Journey abcdef12 lead send/.test(j5bad.byId.J6.evidence) && !/ stored for the test site/.test(j5bad.byId.J6.evidence));
  const implC = fakeImpl();
  const j5good = await run({ 'alert-to': ALERT }, { ...base, impl: implC });
  check('journey: J5 PASS feeds its own lead to J6 and J7: no lead send, no fallback wording', j5good.byId.J6.status === 'PASS' && j5good.byId.J7.status === 'PASS' && !(j5good.byId.J6.evidence + j5good.byId.J7.evidence).includes('lead from lead send') && !implC.calls.includes('sendLead'));
  const implD = fakeImpl({ leadCount: 0 });
  const nolead = await run({ 'alert-to': ALERT }, { ...base, impl: implD });
  check('journey: when J5 stored nothing and lead send stores nothing either, J6 and J7 are FAIL (a pass with no lead at all is impossible)', nolead.byId.J6.status === 'FAIL' && nolead.byId.J7.status === 'FAIL' && /did not store one lead/.test(nolead.byId.J6.evidence) && implD.calls.filter(c => c === 'sendLead').length === 1, nolead.text);
  const implE = fakeImpl({ sendLead: () => ({ ok: false, code: 'S-SIGNATURE', statuses: [401] }) });
  implE.leadCount = async m => (/lead send/.test(m) ? 1 : 0);
  const sendfail = await run({ 'alert-to': ALERT }, { ...base, impl: implE });
  check('journey: a lead send that fails is a FAIL even when a row with the marker is there', sendfail.byId.J6.status === 'FAIL' && /S-SIGNATURE/.test(sendfail.byId.J6.evidence));
  // the skip chain names the ROOT failure: a step needing a skipped step says "after" the first real failure
  const chain = await run({ 'alert-to': ALERT }, { ...base, steps: [
    { id: 'J1', name: 'a', needs: [], run: async () => ({ status: 'FAIL', evidence: 'x' }) },
    { id: 'J2', name: 'b', needs: ['J1'], run: async () => ({ status: 'PASS', evidence: 'y' }) },
    { id: 'J3', name: 'c', needs: ['J2'], run: async () => ({ status: 'PASS', evidence: 'z' }) }] });
  check('journey: the skip chain names the ROOT failure (J3 after J1, not after J2)', /^J2 SKIPPED \(after J1 FAIL\)/m.test(chain.text) && /^J3 SKIPPED \(after J1 FAIL\)/m.test(chain.text), chain.text);
  const j2bad = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ workspacesAs: async () => ({ status: 200, ids: [WS_A, 'bbbbbbbb-0000-0000-0000-000000000000'] }) }) });
  check('journey: J2 FAIL when a login reads another workspace too', j2bad.byId.J2.status === 'FAIL' && /not exactly its own/.test(j2bad.byId.J2.evidence));
  const only = await run({ only: 'J4,j5', 'alert-to': ALERT }, { ...base, impl: fakeImpl() });
  check('journey: --only J4,J5 runs just those and the summary names what was not run', only.res.data.steps.map(s => s.id).join() === 'J4,J5' && /; not run: J1, J2, J3, J6, J7, J8, J9; /.test(only.text) && only.res.ok, only.text);
  const implF = fakeImpl({ alertsOnlyTo: false });
  const noAlertList = await run({ 'alert-to': ALERT }, { ...base, impl: implF });
  check('journey: J5, J6 and J7 are BLOCKED, and nothing is opened or sent (no browser, no lead send, no dashboard test), when the test site\'s alert list is not exactly --alert-to',
    noAlertList.byId.J5.status === 'BLOCKED' && noAlertList.byId.J6.status === 'BLOCKED' && noAlertList.byId.J7.status === 'BLOCKED' && !implF.calls.includes('sendLead') && !implF.calls.some(c => c.startsWith('playwright')) && !noAlertList.res.ok, noAlertList.text);
  const implG = fakeImpl();
  const j6alone = await run({ only: 'J6,J7', 'alert-to': ALERT }, { ...base, impl: implG });
  check('journey: --only J6,J7 (no J5 in the run) uses one lead from lead send and says so', j6alone.byId.J6.status === 'PASS' && j6alone.byId.J7.status === 'PASS' && j6alone.byId.J6.evidence.includes(FALLBACK) && implG.calls.filter(c => c === 'sendLead').length === 1 && j6alone.res.ok, j6alone.text);
  const j7bad = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ exportCsv: () => ({ status: 200, text: `${J.CSV_HEADER}\n` }) }) });
  check('journey: J7 FAIL when the CSV does not hold the marker lead', j7bad.byId.J7.status === 'FAIL' && /0 line/.test(j7bad.byId.J7.evidence));
  const j6bad = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ inboxShot: (m, f) => ({ found: false, file: f, written: true }) }) });
  check('journey: J6 FAIL when the inbox does not list the marker lead', j6bad.byId.J6.status === 'FAIL' && /does not list/.test(j6bad.byId.J6.evidence));
  const j6shot = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ inboxShot: (m, f) => ({ found: true, file: f, written: false }) }) });
  check('journey: J6 FAIL when the inbox screenshot was not written', j6shot.byId.J6.status === 'FAIL' && /not written/.test(j6shot.byId.J6.evidence));
  const crash = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ seed: async () => { throw new Error('socket hang up'); } }) });
  check('journey: a step that throws is a FAIL line saying journey error, the run goes on', crash.byId.J1.status === 'FAIL' && /journey error: socket hang up/.test(crash.byId.J1.evidence) && crash.byId.J4.status === 'PASS');
  const blockedStep = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ seed: async () => { throw new Blocked('STAGING_X is not set', 'set it'); } }) });
  check('journey: a Blocked thrown inside a step is a BLOCKED line (the exit is 1) and its dependents are skipped after it', blockedStep.byId.J1.status === 'BLOCKED' && /^J2 SKIPPED \(after J1 BLOCKED\)/m.test(blockedStep.text) && blockedStep.obj.exit === 1);

  // no secret in the output, even when a step's evidence carries one (the second wall: redact)
  const leaky = await run({ 'alert-to': ALERT }, { ...base, steps: [{ id: 'J1', name: 'leaky', needs: [], run: async () => ({ status: 'PASS', evidence: `token ${SECRET} and ${ENV.STAGING_DB_URL}` }) }] });
  check('journey: no secret value (an environment key, the database URL) reaches the printed text', !leaky.text.includes(SECRET) && !leaky.text.includes(ENV.STAGING_DB_URL) && leaky.text.includes('<redacted:'), leaky.text);

  // ======================================================== the command line (main), refusals first
  const r0 = await cli(['test', 'journey', '--target', 'production', '--json'], { PROD_DB_URL: 'postgres://u:p@h/prod', PROD_SUPABASE_REF: 'x' });
  check('journey: production is refused (exit 3, BLOCKED, nothing else runs)', r0.exit === 3 && r0.json.code === 'BLOCKED' && /production refused for 'test'/.test(r0.json.error), r0.all);
  check('journey: the production guard\'s allowed set holds neither test nor journey', !PRODUCTION_ALLOWED.has('test') && !PRODUCTION_ALLOWED.has('journey'));
  const r1 = await cli(['test', 'journey', '--json'], ENV);
  check('journey: with no --target it is BLOCKED (exit 3), it runs on staging only', r1.exit === 3 && /staging only/.test(r1.json.error), r1.all);
  const r2 = await cli(['test', 'journey', '--target', 'local', '--json'], ENV);
  check('journey: --target local is BLOCKED too', r2.exit === 3 && /staging only/.test(r2.json.error), r2.all);
  const r3 = await cli(['test', 'journey', '--target', 'staging', '--json'], ENV);
  check('journey: J5 and J6 without --alert-to is a usage error (exit 2) that says why', r3.exit === 2 && r3.json.code === 'USAGE' && /--alert-to/.test(r3.json.error), r3.all);
  const r4 = await cli(['test', 'journey', '--target', 'staging', '--only', 'J99', '--json'], ENV);
  check('journey: --only with an unknown step is a usage error (exit 2)', r4.exit === 2 && r4.json.code === 'USAGE', r4.all);
  const r5 = await cli(['test', 'journey', '--target', 'staging', '--only', 'J1', '--alert-to', 'not-an-address', '--json'], ENV);
  check('journey: --alert-to must be an email address (exit 2)', r5.exit === 2 && r5.json.code === 'USAGE', r5.all);
  const r6 = await cli(['test', 'journey', '--target', 'staging', '--only', 'J1'], { PATH: process.env.PATH, STAGING_DB_URL: ENV.STAGING_DB_URL, STAGING_SUPABASE_REF: 'testref' });
  check('journey: a missing key is BLOCKED (exit 3) and names the variable, not a value', r6.exit === 3 && /STAGING_SUPABASE_SECRET_KEY/.test(r6.all) && !r6.all.includes(ENV.STAGING_DB_URL), r6.all);
  const r7 = await cli(['test', 'nope', '--json'], ENV);
  check('journey: test with an unknown verb names both verbs', r7.exit === 2 && /walls\|journey/.test(r7.json.error), r7.all);
  check('journey: the usage list carries the command', USAGE.some(l => l.startsWith('test journey --target staging')));

  // J6's inbox shot starts the dashboard preview on a port the dashboard's own rule picks (apps/dashboard/scripts/preview-port.mjs, block 27000-27899 on 127.0.0.1,
  // passed as OMNIKOM_DASHBOARD_PORT) and opens THAT address; with a stub spawn, browser and http check, no real preview or Edge
  {
    const pathToFileURLish = rel => import(pathToFileURL(join(REPO_ROOT, rel)).href);
    const pp = await pathToFileURLish('apps/dashboard/scripts/preview-port.mjs');
    const mkInbox = (up) => {
      const calls = { spawn: [], opened: [], polled: [] };
      const ictx = makeCtx({ command: 'test', positionals: ['test', 'journey'], flags: { target: 'staging' }, deps: { env: ENV, sleep: async () => {}, fetch: async () => ({ status: 200, json: async () => ({ hashed_token: 'hash-' + rand() }) }) } });
      const impl = J.makeImpl(ictx, {
        ensureBuilt: async () => {},
        importer: async rel => (rel.includes('proc-guard') ? { killTree: () => true } : pathToFileURLish(rel)),
        spawn: (cmd, args, opts) => { calls.spawn.push({ args, env: opts.env }); return { pid: 4000001 }; },
        httpUp: async url => { calls.polled.push(url); return up; },
        launch: async () => ({ newPage: async () => ({ open: async url => { calls.opened.push(url); }, waitFor: async () => true, screenshot: async f => { writeFileSync(f, 'png'); return 3; } }), close: async () => {} }),
      });
      return { calls, impl };
    };
    const ok = mkInbox(true);
    const shot = await ok.impl.inboxShot('owner-a', 'Journey zz', join(work, 'inbox-stub.png'));
    const sp = ok.calls.spawn[0] || { args: [], env: {} };
    const port = Number(sp.env[pp.PORT_ENV]);
    check('journey J6 inbox: the preview is started by preview-staging.mjs with the dashboard\'s own port variable set to a port of its block 27000-27899',
      sp.args.some(a => /preview-staging\.mjs$/.test(a)) && Number.isInteger(port) && pp.inBlock(port), JSON.stringify({ args: sp.args, port: sp.env[pp.PORT_ENV] }));
    check('journey J6 inbox: the address polled and the page opened are that port\'s URL (127.0.0.1:<port>), never localhost:4173',
      ok.calls.polled[0] === pp.baseUrl(port) + '/' && ok.calls.opened.length === 1 && ok.calls.opened[0].startsWith(pp.baseUrl(port) + '/auth/confirm?token_hash=') && !onOldPort(ok.calls), JSON.stringify(ok.calls.opened.concat(ok.calls.polled)));
    // the regression: right URLs, but random text in the env holds the digits 4173 (the old bare includes('4173') was red here). Cause of the 18:19 red: the same
    // kind of text (the calls hold ENV's random keys, the token and temp paths); the failing run's calls were not logged, so which value held it is UNPROVEN.
    const right = { spawn: [{ args: ['x/preview-staging.mjs'], env: { SOME_KEY: 'ab4173cd', OMNIKOM_DASHBOARD_PORT: '27634' } }], polled: ['http://127.0.0.1:27634/'], opened: ['http://127.0.0.1:27634/auth/confirm?token_hash=hash-9f4173a0&type=magiclink'] };
    check('journey J6 inbox: random text that holds the digits 4173 (a key, a token) is not the old address, and the old address in a URL or as the port variable still is',
      !onOldPort(right) && JSON.stringify(right).includes('4173') && onOldPort({ ...right, opened: ['http://localhost:4173/auth/confirm'] }) && onOldPort({ ...right, polled: ['http://127.0.0.1:4173/'] }) && onOldPort({ spawn: [{ env: { OMNIKOM_DASHBOARD_PORT: '4173' } }] }),
      JSON.stringify({ rightOnOldPort: onOldPort(right), bareIncludesWouldSay: JSON.stringify(right).includes('4173') }));
    check('journey J6 inbox: with the stubs the shot is found and written', shot.found === true && shot.written === true && existsSync(shot.file));
    const down = mkInbox(false);
    let why = '';
    try { await down.impl.inboxShot('owner-a', 'Journey zz', join(work, 'inbox-stub2.png')); } catch (e) { why = e.message; }
    const port2 = Number((down.calls.spawn[0] || { env: {} }).env[pp.PORT_ENV]);
    check('journey J6 inbox: a preview that does not come up fails naming the URL it waited on', why.includes(pp.baseUrl(port2)) && /60 s/.test(why), why);
  }

  // the browser is started only through proc-guard (slice 5-H: no browser outlives its run) and killed with its tree and its folder
  const browserSrc = readFileSync(join(CLI_ROOT, 'lib', 'browser.mjs'), 'utf8');
  check('journey browser: it starts through proc-guard\'s guardedTemp and stops with killTree (the 5-H rule)', /guardedTemp\('omnikom-jb-'/.test(browserSrc) && /guard\.killTree\(child\.pid, folder\.dir\)/.test(browserSrc) && /--user-data-dir=\$\{folder\.dir\}/.test(browserSrc));

  // ======================================================== the browser and J4 / J5 in the real browser, against a fixture site
  let browserOk = true;
  try { findBrowser(ENV); } catch (e) { browserOk = false; check('journey browser: Edge or Chrome is found (a missing browser is a FAIL, never a skip)', false, e.message); }
  const stubBlocked = (() => { try { findBrowser({}, () => false); return false; } catch (e) { return e instanceof Blocked && /OMNIKOM_BROWSER/.test(e.unblock); } })();
  check('journey browser: with no browser installed it is BLOCKED and says what to set', stubBlocked);
  check('journey browser: OMNIKOM_BROWSER names the browser to use', findBrowser({ OMNIKOM_BROWSER: '/x/browser' }, p => p === '/x/browser') === '/x/browser');
  if (browserOk) { try { await browserTests(); } catch (e) { check('journey browser: the browser tests ran to the end', false, e && e.message); } }

  async function browserTests() {
    const leads = [];
    let leadMode = 'ok';
    const doc = (variant, path) => {
      const bad = variant === 'console' && path === '/' ? '<script>console.error("planted console error")</script>' : variant === 'throws' && path === '/' ? '<script>throw new Error("planted uncaught")</script>' : '';
      const wide = variant === 'overflow' ? '<div style="width:3000px;height:20px">wide</div>' : '';
      const form = path === '/contact/' ? `<form method="post" action="/api/lead"><label>name <input name="name" required></label><label>email <input type="email" name="email"></label><label>phone <input name="phone"></label><label>message <textarea name="message"></textarea></label><label><input type="checkbox" name="consent" value="yes" required> I agree</label><button type="submit">Send</button></form>` : '';
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>fixture ${variant}${path}</title></head><body style="margin:0"><h1>fixture ${variant} ${path}</h1>${wide}${form}${bad}</body></html>`;
    };
    const srv = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/lead?sent=1') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Thank you</title><h1>Thank you</h1><p>Your message was sent.</p><p><a href="/">Back to the site</a></p>'); return; }
      if (req.method === 'POST' && req.url === '/api/lead') {
        let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
          const name = new URLSearchParams(b).get('name');
          if (leadMode === 'thanks' || leadMode === 'thanks-lost' || leadMode === 'thanks-two') { if (leadMode !== 'thanks-lost') leads.push(name); if (leadMode === 'thanks-two') leads.push(name); res.writeHead(303, { location: '/api/lead?sent=1' }); res.end(); return; }
          if (leadMode === 'other200') { leads.push(name); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Welcome</title><h1>Welcome</h1><p>Nothing to say here.</p>'); return; }
          if (leadMode === '503') { res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>We could not send this</title><h1>We could not send this</h1><p>We could not send this. Please call or email us.</p><p><a href="/">Back to the form</a></p>'); return; }
          if (leadMode === 'plain') { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"sent":false,"problems":[{"code":"BODY","msg":"Send the form as JSON."}]}'); return; }
          if (leadMode === 'ok') leads.push(name);
          res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"sent":true}');
        }); return;
      }
      if (req.url === '/favicon.ico') { res.writeHead(200, { 'content-type': 'image/x-icon' }); res.end(); return; }   // the browser asks for it; a 404 here would be a console error of the fixture
      const m = /^\/([a-z0-9]+)(\/.*)$/.exec(req.url.split('?')[0]);
      if (!m) { res.writeHead(404); res.end('no'); return; }
      const [, variant, path] = m;
      const h = { 'content-type': 'text/html; charset=utf-8', ...(variant === 'nohdr' ? {} : { 'x-robots-tag': 'noindex, nofollow' }) };
      res.writeHead(variant === 'gone' ? 404 : 200, h); res.end(doc(variant, path));
    }).listen(0, '127.0.0.1');
    await new Promise(r => srv.once('listening', r));
    const origin = `http://127.0.0.1:${srv.address().port}`;
    const guard = await import(pathToFileURL(join(REPO_ROOT, 'tools', 'proc-guard', 'index.mjs')).href);
    try {
      // the browser library itself
      const b = await launchBrowser({ env: ENV });
      const folder = b.folder;
      let v, sub, bytes, png;
      try {
        const p = await b.newPage({ width: 390, height: 844, mobile: true });
        v = await p.open(`${origin}/console/`);
        const p2 = await b.newPage({ width: 1536, height: 730, mobile: false });
        const t = await p2.open(`${origin}/throws/`);
        check('journey browser: a planted console.error is counted, with its text', v.consoleErrors.length === 1 && /planted console error/.test(v.consoleErrors[0]), JSON.stringify(v.consoleErrors));
        check('journey browser: a planted uncaught exception is counted as an exception, not a console error', t.exceptions.length === 1 && /planted uncaught/.test(t.exceptions[0]) && t.consoleErrors.length === 0, JSON.stringify(t));
        check('journey browser: status and the x-robots-tag header are read from the document', v.status === 200 && v.headers['x-robots-tag'] === 'noindex, nofollow');
        const o = await (await b.newPage({ width: 390, height: 844, mobile: true })).open(`${origin}/overflow/`);
        check('journey browser: a page wider than the viewport is reported as overflowing', o.overflow.overflowing === true && o.overflow.scrollWidth >= 3000, JSON.stringify(o.overflow));
        const c = await p.open(`${origin}/good/contact/`);
        check('journey browser: a good page has no errors, no overflow and the title', c.consoleErrors.length === 0 && c.exceptions.length === 0 && !c.overflow.overflowing && /fixture good\/contact\//.test(c.title), JSON.stringify(c));
        await p.fill('form input[name=name]', 'Journey T1');
        await p.check('form input[name=consent]');
        sub = await p.submit('form');
        png = join(work, 'lib-shot.png');
        bytes = await p.screenshot(png);
      } finally { await b.close(); }
      check('journey browser: a form is filled and submitted by a real click and the answer page (status, text) is returned', sub.status === 200 && sub.text.includes('"sent":true') && leads.includes('Journey T1'), JSON.stringify(sub));
      check('journey browser: a screenshot is a real PNG file on disk', bytes > 500 && existsSync(png) && readFileSync(png).subarray(0, 8).toString('hex') === '89504e470d0a1a0a', String(bytes));
      let gone = !existsSync(folder);
      for (let i = 0; i < 20 && !gone; i++) { await new Promise(r => setTimeout(r, 250)); gone = !existsSync(folder); }
      const mine = x => x.folder.toLowerCase() === folder.toLowerCase();   // only this run's folder: a stale one from a killed run is not this test's business
      let left = guard.leaks(['omnikom-jb-']).filter(mine);
      for (let i = 0; i < 10 && left.length; i++) { await new Promise(r => setTimeout(r, 500)); left = guard.leaks(['omnikom-jb-']).filter(mine); }
      check('journey browser: after close the browser process and its profile folder are gone (proc-guard leaks() finds none of this run\'s)', gone && left.length === 0, JSON.stringify({ gone, left: left.slice(0, 2) }));

      // J4 against the fixture site: green, then each planted fault goes red for its own reason
      const j4 = variant => run({ only: 'J4' }, { ...base, previewBase: `${origin}/${variant}`, impl: { ...fakeImpl(), launchBrowser: () => launchBrowser({ env: ENV }), fileSize: p => (existsSync(p) ? readFileSync(p).length : 0) } });
      const g = await j4('good');
      const pngs = g.byId.J4.pngs;
      check('journey J4: a clean fixture site is a PASS with 4 real PNG files (phone and desktop of two pages)', g.byId.J4.status === 'PASS' && pngs.length === 4 && pngs.every(f => existsSync(f) && readFileSync(f).subarray(0, 4).toString('hex') === '89504e47'), g.text);
      const cons = await j4('console');
      check('journey J4: a console error on the page is a FAIL that says so', cons.byId.J4.status === 'FAIL' && /console error/.test(cons.byId.J4.evidence), cons.text);
      const thr = await j4('throws');
      check('journey J4: an uncaught exception on the page is a FAIL that says so', thr.byId.J4.status === 'FAIL' && /uncaught exception/.test(thr.byId.J4.evidence), thr.text);
      const ovf = await j4('overflow');
      check('journey J4: a page that scrolls sideways is a FAIL that says so', ovf.byId.J4.status === 'FAIL' && /scrolls sideways/.test(ovf.byId.J4.evidence), ovf.text);
      const nh = await j4('nohdr');
      check('journey J4: a missing noindex, nofollow header is a FAIL that says so', nh.byId.J4.status === 'FAIL' && /x-robots-tag is "missing"/.test(nh.byId.J4.evidence), nh.text);
      const gn = await j4('gone');
      check('journey J4: HTTP 404 is a FAIL that says so', gn.byId.J4.status === 'FAIL' && /HTTP 404/.test(gn.byId.J4.evidence), gn.text);

      // J5 against the fixture: the lead is stored (PASS), the endpoint answers 400 (the shape of the expected first-run finding), the answer is "sent" but nothing is stored
      const j5 = mode => { leadMode = mode; leads.length = 0; return run({ only: 'J5', 'alert-to': ALERT }, { ...base, previewBase: `${origin}/good`, impl: { ...fakeImpl({ leadCount: undefined }), leadCount: async m => leads.filter(x => x === m).length, launchBrowser: () => launchBrowser({ env: ENV }), fileSize: p => (existsSync(p) ? readFileSync(p).length : 0) } }); };
      const f1 = await j5('ok');
      check('journey J5: a lead filled in and sent through the form is stored once with the marker typed, and the step passes with 2 PNGs', f1.byId.J5.status === 'PASS' && /HTTP 200/.test(f1.byId.J5.evidence) && /Journey abcdef12/.test(f1.byId.J5.evidence) && f1.byId.J5.pngs.length === 2 && leads.filter(x => x === 'Journey abcdef12').length === 1, f1.text);
      const f2 = await j5('plain');
      check('journey J5: an endpoint that answers 400 is a FAIL with the status and the words on the page, and the answer PNG is kept', f2.byId.J5.status === 'FAIL' && /HTTP 400/.test(f2.byId.J5.evidence) && /lead rows with the marker: 0/.test(f2.byId.J5.evidence) && /Send the form as JSON/.test(f2.byId.J5.evidence) && f2.byId.J5.pngs.some(p => p.endsWith('j5-form-answer.png')), f2.text);
      const f3 = await j5('lost');
      check('journey J5: "sent" with no stored row is a FAIL (the page alone is not enough)', f3.byId.J5.status === 'FAIL' && /0 lead row/.test(f3.byId.J5.evidence), f3.text);
      // the no-script path of the site (platform 5-L): the browser is sent on with a 303 to a Thank-you page; that page plus exactly one stored row is the pass
      const f4 = await j5('thanks');
      check('journey J5: a 303 to the Thank-you page (HTTP 200, "Your message was sent") with exactly one stored marker row is a PASS', f4.byId.J5.status === 'PASS' && /HTTP 200/.test(f4.byId.J5.evidence) && /Your message was sent/.test(f4.byId.J5.evidence) && /1 lead row "Journey abcdef12"/.test(f4.byId.J5.evidence) && leads.filter(x => x === 'Journey abcdef12').length === 1, f4.text);
      const f6 = await j5('thanks-two');
      check('journey J5: the Thank-you page with TWO stored rows is a FAIL (exactly one is the pass)', f6.byId.J5.status === 'FAIL' && /but 2 lead row/.test(f6.byId.J5.evidence), f6.text);
      const f7 = await j5('other200');
      check('journey J5: any HTTP 200 is not enough: a 200 page that does not say the message was sent is a FAIL even with one stored row', f7.byId.J5.status === 'FAIL' && /HTTP 200 "Welcome/.test(f7.byId.J5.evidence), f7.text);
      const f8 = await j5('503');
      check('journey J5: the old 503 "We could not send this" page is a FAIL that names the status and the page', f8.byId.J5.status === 'FAIL' && /HTTP 503 "We could not send this/.test(f8.byId.J5.evidence) && /lead rows with the marker: 0/.test(f8.byId.J5.evidence), f8.text);
      check('journey J5: the old 400 "Send the form as JSON." answer is still a FAIL that names the status and the words (re-checked beside the new pages)', f2.byId.J5.status === 'FAIL' && /HTTP 400/.test(f2.byId.J5.evidence) && /Send the form as JSON/.test(f2.byId.J5.evidence));
      const f5 = await j5('thanks-lost');
      check('journey J5: the Thank-you page with no stored row is a FAIL (the page alone is not enough)', f5.byId.J5.status === 'FAIL' && /but 0 lead row/.test(f5.byId.J5.evidence), f5.text);
    } finally { srv.close(); }
  }

  await browserStartTests({ check, CLI_ROOT, imp });

  rmSync(work, { recursive: true, force: true });
}

// The wait for the browser's DevTools address is a wall clock with a measured bound (briefs/browser-start-deadline.md; run 41404410237 went red
// on a 15 s count). A stub browser through the spawnImpl and importer seams: no real Edge, no real proc-guard, and the runs are short.
export async function browserStartTests({ check, CLI_ROOT, imp }) {
  const B = await imp('lib/browser.mjs');
  const fakeGuard = {   // guardedTemp makes a real folder (the stub writes into it); killTree touches nothing
    guardedTemp: prefix => { const dir = mkdtempSync(join(tmpdir(), prefix)); return { dir, release: () => rmSync(dir, { recursive: true, force: true }) }; },
    killTree: () => true,
  };
  const stub = behave => (exe, args) => {
    const child = new EventEmitter(); child.pid = 4000000;
    behave(child, args.find(a => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length));
    return child;
  };
  const env = { OMNIKOM_BROWSER: process.execPath };   // any file that exists: findBrowser only checks the path
  const start = async (behave, extra = {}) => {
    const t0 = Date.now();
    let error = null;
    try { const b = await B.launchBrowser({ env, spawnImpl: stub(behave), importer: async () => fakeGuard, ...extra }); await b.close(); } catch (e) { error = e; }
    return { ms: Date.now() - t0, message: error ? error.message : null };
  };

  check('journey browser start: the bound is a named exported constant of at least 120 s (1.5 times the worst measured launch, 74.5 s)', typeof B.DEVTOOLS_WAIT_MS === 'number' && B.DEVTOOLS_WAIT_MS >= 120000, String(B.DEVTOOLS_WAIT_MS));

  // a: a browser that is slow under load (well past the old 15 s count) is waited for with the default bound; the old 15 s count gave up here
  // The 20 s are the launch's own clock (the seam launchBrowser({ clock })): a clock the test advances by hand, so the check proves the same
  // thing in a few ms. It took 20 s of real waiting in every run of the suite, and every mutant runs the suite (CI run 41453440713).
  let fake = 0, due = null;
  const clock = { now: () => fake, sleep: async ms => { fake += ms; if (due && fake >= due.at) { const fire = due.fire; due = null; fire(); } } };
  const late = await start((child, dir) => { due = { at: 20000, fire: () => { try { writeFileSync(join(dir, 'DevToolsActivePort'), '9\n/devtools/browser/stub\n'); } catch { /* the folder is gone: the implementation under test gave up first */ } } }; }, { clock });
  check('journey browser start: a browser that writes its DevTools address after 20 s is waited for (the connect step is reached, not the "did not report" error)',
    late.message === 'could not connect to the browser' && fake >= 20000 && fake < 30000 && late.ms < 5000, JSON.stringify({ ...late, clockMs: fake }));

  // b: a browser that never reports fails with the real elapsed time and the bound in the line, in about the bound
  const never = await start(() => {}, { devtoolsWaitMs: 1500 });
  const m = /did not report its DevTools address in (\d+\.\d) s \(bound 1\.5 s\)/.exec(never.message || '');
  check('journey browser start: a browser that never reports fails with "in <elapsed> s (bound 1.5 s)" after about the bound', Boolean(m) && Number(m[1]) >= 1.5 && Number(m[1]) < 4 && never.ms >= 1500 && never.ms < 4000, JSON.stringify(never));

  // d: the browser still holds the file while it writes it (EBUSY on Windows; here the path is a folder for a moment, so reading it fails the same way): looked at again, not thrown
  const busy = await start((child, dir) => { const f = join(dir, 'DevToolsActivePort'); mkdirSync(f); setTimeout(() => { try { rmSync(f, { recursive: true }); writeFileSync(f, '9\n/devtools/browser/stub\n'); } catch { /* the folder is gone */ } }, 1200); });
  check('journey browser start: a DevTools file that cannot be read for a moment (EBUSY while the browser writes it) is looked at again, not thrown', busy.message === 'could not connect to the browser' && busy.ms >= 1000 && busy.ms < 8000, JSON.stringify(busy));

  // c: a browser that has already exited fails at once naming the exit, not after the bound
  const dead = await start((child) => { setImmediate(() => child.emit('exit', 3, null)); }, { devtoolsWaitMs: 5000 });
  check('journey browser start: a browser that exited at once fails at once, naming the exit code (far under the bound)',
    /exited before it reported its DevTools address \(exit code 3\)/.test(dead.message || '') && dead.ms < 3000, JSON.stringify(dead));
  const killed = await start((child) => { setImmediate(() => child.emit('exit', null, 'SIGKILL')); }, { devtoolsWaitMs: 5000 });
  check('journey browser start: a browser killed by a signal fails at once naming the signal', /exited before it reported its DevTools address \(signal SIGKILL\)/.test(killed.message || '') && killed.ms < 3000, JSON.stringify(killed));
  const nospawn = await start((child) => { setImmediate(() => child.emit('error', Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }))); }, { devtoolsWaitMs: 5000 });
  check('journey browser start: a browser that cannot be started fails at once with the reason', /could not start the browser: spawn x ENOENT/.test(nospawn.message || '') && nospawn.ms < 3000, JSON.stringify(nospawn));
}
