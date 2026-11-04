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
  // the test site's form contract as leadColumns lists it (sites/test-demo-a/contract.json), and a stateful fake of the CRM functions the new steps call
  const FIELDS = [
    { key: 'side', type: 'choice', multi: false, column: true, editable: true, options: ['Buying', 'Selling'] },
    { key: 'budget', type: 'number', multi: false, column: true, editable: true, options: [], min: 10000, max: 50000000 },
    { key: 'timing', type: 'enum', multi: false, column: true, editable: true, options: ['0-3 months', '3-6 months', '6-12 months', 'just looking'] },
    { key: 'beds', type: 'number', multi: false, column: true, editable: true, options: [], min: 0, max: 10 },
    { key: 'area', type: 'reference', multi: false, column: true, editable: true, options: [], to: 'areas' },
    { key: 'message', type: 'text', multi: false, column: false, editable: true, options: [] },
  ];
  const csvOf = (fields, leads, o = {}) => [J.csvHeader(fields), ...leads.map(l => ['2026-11-01T00:00:00Z', l.name, 'a@example.com', l.phone || '', 'contact', '/contact/', l.status || 'new', '', ...fields.map(f => String((l.answers || {})[f.key] ?? ''))])]
    .map(r => r.join(',')).join('\r\n') + '\r\n';
  // o: fields (the contract), exportFields (what the export writes), stored (the lead's answers), extraRows (other leads in the workspace), and one switch per planted fault
  const crmFake = (o = {}) => {
    const fields = o.fields || FIELDS, store = { leads: [], seen: new Set(), log: [] };
    const lead = (marker, ans) => {
      if (!store.seen.has(marker)) { store.seen.add(marker); store.leads.push({ id: `lead-${store.seen.size}`, name: marker, phone: '(555) 010-0153', status: 'new', owner: null, events: 0, answers: { ...(ans || o.stored || J.journeyAnswers(fields)) } }); store.peak = Math.max(store.peak || 0, store.leads.length);
        if (o.dupMarker) store.leads.push({ id: 'lead-dup', name: marker + ' again', phone: '', status: 'new', owner: null, events: 0, answers: {} }); }
    };
    const rowOf = l => ({ id: l.id, name: l.name, phone: l.phone, status: l.status, owner: l.owner, ...(o.stringNumbers ? Object.fromEntries(Object.entries(l.answers).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])) : l.answers) });
    const ok = (json, status = 200) => ({ status, text: JSON.stringify(json), json });
    const down = () => new Blocked('a session for owner-a: Auth verify answered 403: Email link is invalid or has expired', 'run again');
    if (o.preLead) lead('Journey abcdef12');
    if (o.oldLead) { store.seen.add('Journey 8c12816a'); store.leads.push({ id: 'old-1', name: 'Journey 8c12816a', phone: '', status: 'new', owner: null, events: 0, answers: {} }); }
    return {
      store, fields, addLead: lead,
      async crm(who, name, body) {
        store.log.push(`${who}:${name}:${body.action || ''}${body.confirm ? '+confirm' : ''}`);
        if (name !== 'lead-update' && body.workspace !== WS_A) return ok({ code: 'S-BODY' }, 400);
        if (o.bulkDown && store.down) throw down();
        if (name === 'leads-bulk' && (o.bulkDown || (o.bulkBlockedOnce && !store.blockedOnce))) { store.down = true; store.blockedOnce = true; throw down(); }
        if (name === 'lead-list') {
          if (body.search && /^Journey /.test(body.search)) lead(body.search);
          let rows = [...store.leads.map(rowOf), ...(body.search ? [] : (o.extraRows || []))];
          if (body.search && !o.searchLoose) rows = rows.filter(r => r.name.toLowerCase().includes(body.search.toLowerCase()));
          if (!o.filtersIgnored) for (const f of body.filters || []) {
            if (o.eqBroken && f.op === 'eq') { rows = []; continue; }
            if (o.rangeBroken && f.op === 'range') { rows = []; continue; }
            if (o.rangeIgnored && f.op === 'range') continue;
            rows = rows.filter(r => f.op === 'eq' ? String(r[f.field]).toLowerCase() === String(f.value).toLowerCase()
              : (f.from === undefined || r[f.field] >= f.from) && (f.to === undefined || r[f.field] <= f.to));
          }
          if (body.sort) {
            const dir = o.sortAlwaysAsc ? 'asc' : body.sort.dir, k = body.sort.field;
            const key = v => (o.sortAsText ? String(v) : v);
            rows = rows.filter(r => r[k] !== undefined).sort((a, b) => (key(a[k]) < key(b[k]) ? -1 : key(a[k]) > key(b[k]) ? 1 : 0) * (dir === 'desc' ? -1 : 1)).concat(rows.filter(r => r[k] === undefined));
            if (o.sortStrings) rows = rows.map(r => (r[k] === undefined ? r : { ...r, [k]: String(r[k]) }));
          }
          return o.listStatus ? { status: o.listStatus, text: 'boom', json: null } : ok({ total: rows.length, page: 1, size: body.size || 50, columns: [], rows });
        }
        if (name === 'lead-update') {
          const l = store.leads.find(x => x.id === body.lead); if (!l) return ok({ code: 'S-NOT-FOUND' }, 404);
          const keys = Object.keys(body.fields || {});
          if (!o.updateIgnored) for (const k of keys) { if (k === 'phone') l.phone = body.fields[k]; else if (!(o.skipField && k !== 'phone')) l.answers[k] = body.fields[k]; }
          l.events += o.events === undefined ? keys.length : o.events;
          return ok({ changed: o.updateChanged === undefined ? keys.length : o.updateChanged });
        }
        if (name === 'leads-bulk') {
          const ls = store.leads.filter(x => body.ids.includes(x.id)); if (!ls.length) return ok({ code: 'S-NOT-FOUND' }, 404);
          if (body.action === 'status') { if (!o.statusIgnored) ls.forEach(l => { l.status = body.value; }); return ok({ changed: o.bulkChanged === undefined ? ls.length : o.bulkChanged }); }
          if (body.action === 'owner') { if (!o.ownerIgnored) ls.forEach(l => { l.owner = body.value; }); return ok({ changed: o.ownerChanged === undefined ? ls.length : o.ownerChanged }); }
          if (!body.confirm) {
            if (o.deleteNoConfirm) { store.leads = store.leads.filter(x => !body.ids.includes(x.id)); return ok({ changed: ls.length }); }
            if (o.refuseButDelete) store.leads = store.leads.filter(x => !body.ids.includes(x.id));
            return ok({ code: o.wrongCode || 'S-CONFIRM' }, 409);
          }
          if (!o.deleteKeeps) store.leads = store.leads.filter(x => !body.ids.includes(x.id));
          return ok({ changed: o.deleteChanged === undefined ? ls.length : o.deleteChanged });
        }
        return ok({ code: 'S-NOT-FOUND' }, 404);
      },
      async crmFields() { return fields; },
      async editedEvents(id) { const l = store.leads.find(x => x.id === id); return l ? l.events : 0; },
      async teamRow() { return o.teamRow === undefined ? 'team-row-1' : o.teamRow; },
      async exportCsv(who, marker) { lead(marker); return { status: 200, text: o.exportText ? o.exportText(csvOf(o.exportFields || fields, store.leads.filter(l => l.name.includes(marker)))) : csvOf(o.exportFields || fields, store.leads.filter(l => l.name.includes(marker))) }; },
    };
  };
  const fakeImpl = (o = {}) => ({
    calls: [],
    ...crmFake(o),
    async seed() { return { ok: true, code: 'ok', data: { changed: false, logins: ['a', 'b'], testSite: { contractVersion: 2, rows: { pages: 3, team: 2 } } } }; },
    async workspacesAs() { return { status: 200, ids: [WS_A] }; },
    spec(file) { return o.spec ? o.spec(file) : { exists: false, text: '' }; },
    async playwright(file, title) { this.calls.push(`playwright:${file}`); return o.playwright ? o.playwright(file, title) : pwOk(title); },
    launchBrowser: o.launchBrowser || fakeBrowser(),
    fileSize: () => 1000,
    async leadCount() { return o.leadCount === undefined ? 1 : o.leadCount; },
    async sendLead(marker, file, answers) {
      const order = /^Order check/.test(marker); this.calls.push(order ? 'sendOrder' : 'sendLead');
      const r = order && o.orderSend === false ? { ok: false, code: 'S-X', statuses: [500] } : o.sendLead ? o.sendLead(marker) : { ok: true, code: 'ok', statuses: [202] };
      if (r.ok) this.addLead(marker, answers);
      return r;
    },
    async alertsOnlyTo() { return typeof o.alertsOnlyTo === 'function' ? o.alertsOnlyTo() : o.alertsOnlyTo === undefined ? true : o.alertsOnlyTo; },
    ...(o.exportCsv ? { async exportCsv(who, marker) { return o.exportCsv(marker); } } : {}),
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

  // ======================================================== the real seams of the CRM steps (a fake fetch and a fake database, no network)
  {
    const seen = [], sqls = [];
    const reply = (status, body) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
    const sctx = makeCtx({ command: 'test', positionals: ['test', 'journey'], flags: { target: 'staging' }, deps: { env: ENV, fetch: async (url, init) => {
      seen.push({ url, init });
      if (url.endsWith('/admin/generate_link')) return reply(200, { hashed_token: 'h' + rand() });
      if (url.endsWith('/verify')) return reply(200, { access_token: 'tok' + rand() });
      return url.endsWith('/lead-update') ? reply(204, '') : reply(200, { total: 0, rows: [] });
    } } });
    sctx.sql = () => ({ scalar: text => { sqls.push(text); return { ok: true, value: /members/.test(text) ? 'team-1' : '2' }; } });
    const impl = J.makeImpl(sctx);
    const listed = await impl.crm('owner-a', 'lead-list', { workspace: WS_A, search: 'x' });
    const call = seen[seen.length - 1];
    check('journey seam crm: a POST to the function of that name with the person\'s bearer token, the publishable key and the body as JSON; the answer is status, text and parsed JSON',
      call.url === 'https://testref.supabase.co/functions/v1/lead-list' && call.init.method === 'POST' && /^Bearer tok/.test(call.init.headers.authorization) && call.init.headers.apikey === ENV.STAGING_SUPABASE_PUBLISHABLE_KEY
        && call.init.body === JSON.stringify({ workspace: WS_A, search: 'x' }) && listed.status === 200 && listed.json.total === 0, JSON.stringify(call.init));
    const empty = await impl.crm('owner-a', 'lead-update', { lead: 'l' });
    check('journey seam crm: an answer with no body (204) is status 204 and json null, never a throw', empty.status === 204 && empty.json === null);
    const cols = await impl.crmFields();
    const contract = JSON.parse(readFileSync(join(REPO_ROOT, 'sites', 'test-demo-a', 'contract.json'), 'utf8'));
    const { leadColumns } = await import(pathToFileURL(join(REPO_ROOT, 'contracts', 'validate.mjs')).href);
    check('journey seam crmFields: the industry fields of sites/test-demo-a/contract.json in form order, from the validator\'s own leadColumns (none copied into the CLI)',
      cols.length > 0 && JSON.stringify(cols.map(f => f.key)) === JSON.stringify(leadColumns(contract).map(f => f.key)) && cols.every(f => 'type' in f && 'editable' in f && 'column' in f), cols.map(f => f.key).join());
    check('journey seam crmFields: the real test site\'s fields include a number and an enum column (what J8 and J9 need), so the steps can run on it', cols.some(f => f.type === 'number' && f.editable && f.column) && cols.some(f => f.type === 'enum' && f.column), cols.map(f => f.key + ':' + f.type).join());
    const n = await impl.editedEvents('11111111-2222-3333-4444-555555555555');
    check('journey seam editedEvents: counts the lead\'s edited events in lead_events', n === 2 && /from lead_events where lead_id = '11111111-2222-3333-4444-555555555555'::uuid and kind = 'edited'/.test(sqls[0]), sqls[0]);
    const team = await impl.teamRow();
    check('journey seam teamRow: a team row of the test workspace\'s members', team === 'team-1' && new RegExp(`from members where workspace_id = '${WS_A}'::uuid and team_row_id is not null`).test(sqls[1]), sqls[1]);
    const mints = () => seen.filter(x => x.url.endsWith('/admin/generate_link')).length;
    await impl.exportCsv('owner-a', 'x'); await impl.crm('owner-a', 'lead-list', { workspace: WS_A }); await impl.crm('owner-a', 'leads-bulk', { workspace: WS_A, ids: ['a'], action: 'status', value: 'new' });
    check('journey seam session: owner-a is signed in once for all of the CRM calls and the export (one verified session kept, not one link per call)', mints() === 1, String(mints()));
    await impl.workspacesAs('member-a1');
    check('journey seam session: another person gets a session of their own', mints() === 2, String(mints()));
    let t = 1793500000;
    const tctx = makeCtx({ command: 'test', positionals: ['test', 'journey'], flags: { target: 'staging' }, deps: { env: ENV, now: () => t, fetch: async (url) => (url.endsWith('/admin/generate_link') ? (seen.push({ url }), reply(200, { hashed_token: 'h' + rand() })) : url.endsWith('/verify') ? reply(200, { access_token: 'tok' + rand() }) : reply(200, { total: 0, rows: [] })) } });
    const timed = J.makeImpl(tctx), m0 = mints();
    await timed.crm('owner-a', 'lead-list', {}); t += 44 * 60; await timed.crm('owner-a', 'lead-list', {});
    const m1 = mints(); t += 2 * 60; await timed.crm('owner-a', 'lead-list', {});
    check('journey seam session: the session is kept for 45 minutes and minted again after that (an access token lasts an hour)', m1 - m0 === 1 && mints() - m0 === 2, JSON.stringify({ m0, m1, now: mints() }));
    const file = join(work, 'seam-lead.json');
    sctx.randomUUID = () => 'abcdef12-0000-0000-0000-000000000000';
    try { await impl.sendLead('Journey seam', file, { budget: 10000, timing: '0-3 months' }); } catch { /* no network: only the fixture file is looked at */ }
    const fx = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    check('journey seam sendLead: the fixture carries the industry answers with their types beside the message', fx.answers && fx.answers.budget === 10000 && fx.answers.timing === '0-3 months' && /Synthetic/.test(fx.answers.message) && fx.name === 'Journey seam', JSON.stringify(fx.answers));
  }

  // ======================================================== the orchestrator, with fakes
  const pass = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl() });
  const shape = /^J\d+ (PASS|FAIL|BLOCKED|NOT BUILT YET|SKIPPED \(after J\d+ (FAIL|BLOCKED)\)) \S.*/;
  const lines = pass.text.trim().split('\n');
  check('journey: one line per step J1..J10 in order, then the clean-up line, then one summary line', lines.length === 12 && lines.slice(0, 10).every((l, i) => l.startsWith(`J${i + 1} `) && shape.test(l)) && lines[10] === 'cleanup: 0 journey lead(s) removed, 0 left' && lines[11].startsWith('journey (staging): '), pass.text);
  check('journey: with a good tree the result is 9 PASS, 1 NOT BUILT YET (J3), 0 FAIL and the exit is 0', pass.res.ok && pass.obj.exit === 0 && lines[11].startsWith('journey (staging): 9 PASS, 1 NOT BUILT YET, 0 FAIL'), lines[10]);
  check('journey: J3 on a tree with no site.spec.ts prints NOT BUILT YET with the file named', pass.byId.J3.status === 'NOT BUILT YET' && /apps\/dashboard\/tests\/site\.spec\.ts missing/.test(pass.byId.J3.evidence));
  check('journey: the steps are J1..J10 and none of them sends a test or pushes a lead to a CRM (leads are never pushed)', pass.res.data.steps.map(s => s.id).join() === 'J1,J2,J3,J4,J5,J6,J7,J8,J9,J10' && !pass.res.data.steps.some(s => /push|send a test/i.test(s.name)) && !/pushed|send a test|Webhook/i.test(pass.text), pass.text);
  check('journey: J8 field edit, J9 server list and J10 bulk are real PASS lines, never a NOT BUILT YET', ['field edit', 'server list', 'bulk'].every((n, i) => pass.byId[`J${8 + i}`].name === n && pass.byId[`J${8 + i}`].status === 'PASS') && pass.res.data.counts.PASS === 9);
  check('journey: the summary names the screenshot folder', lines[11].includes(pass.res.data.out) && pass.res.data.out.startsWith(work));
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
  check('journey: J1 FAIL skips J2, J3, J5, J6, J7, J8, J9 and J10 with "SKIPPED (after J1 FAIL)", still runs J4, and the exit is 1',
    j1bad.byId.J1.status === 'FAIL' && ['J2', 'J3', 'J5', 'J6', 'J7', 'J8', 'J9', 'J10'].every(i => j1bad.byId[i].status === 'SKIPPED') && /^J2 SKIPPED \(after J1 FAIL\) /m.test(j1bad.text) && j1bad.byId.J4.status === 'PASS' && j1bad.obj.exit === 1, j1bad.text);
  // a product bug at J5 must not leave J6 and J7 unproven: they use ONE lead made by `lead send`, and their lines say so
  const FALLBACK = '(lead from lead send: J5 did not store one)';
  const implB = fakeImpl({ leadCount: 0 });
  implB.leadCount = async m => (/lead send|Order check/.test(m) ? 1 : 0);
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
  implE.leadCount = async m => (/lead send|Order check/.test(m) ? 1 : 0);
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
  check('journey: --only J4,J5 runs just those and the summary names what was not run', only.res.data.steps.map(s => s.id).join() === 'J4,J5' && /; not run: J1, J2, J3, J6, J7, J8, J9, J10; /.test(only.text) && only.res.ok, only.text);
  const implF = fakeImpl({ alertsOnlyTo: false });
  const noAlertList = await run({ 'alert-to': ALERT }, { ...base, impl: implF });
  check('journey: J5, J6 and J7 are BLOCKED, and nothing is opened or sent (no browser, no lead send, no dashboard test), when the test site\'s alert list is not exactly --alert-to',
    noAlertList.byId.J5.status === 'BLOCKED' && noAlertList.byId.J6.status === 'BLOCKED' && noAlertList.byId.J7.status === 'BLOCKED' && noAlertList.byId.J8.status === 'BLOCKED' && ['J9', 'J10'].every(i => noAlertList.byId[i].status === 'SKIPPED') && implF.store.leads.length === 0 && !implF.calls.includes('sendLead') && !implF.calls.some(c => c.startsWith('playwright')) && !noAlertList.res.ok, noAlertList.text);
  const implG = fakeImpl();
  const j6alone = await run({ only: 'J6,J7', 'alert-to': ALERT }, { ...base, impl: implG });
  check('journey: --only J6,J7 (no J5 in the run) uses one lead from lead send and says so', j6alone.byId.J6.status === 'PASS' && j6alone.byId.J7.status === 'PASS' && j6alone.byId.J6.evidence.includes(FALLBACK) && implG.calls.filter(c => c === 'sendLead').length === 1 && j6alone.res.ok, j6alone.text);
  const j7bad = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ exportCsv: () => ({ status: 200, text: `${J.csvHeader(FIELDS).join(',')}\r\n` }) }) });
  check('journey: J7 FAIL when the CSV does not hold the marker lead', j7bad.byId.J7.status === 'FAIL' && /0 line/.test(j7bad.byId.J7.evidence));
  const j6bad = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ inboxShot: (m, f) => ({ found: false, file: f, written: true }) }) });
  check('journey: J6 FAIL when the inbox does not list the marker lead', j6bad.byId.J6.status === 'FAIL' && /does not list/.test(j6bad.byId.J6.evidence));
  const j6shot = await run({ 'alert-to': ALERT }, { ...base, impl: fakeImpl({ inboxShot: (m, f) => ({ found: true, file: f, written: false }) }) });
  check('journey: J6 FAIL when the inbox screenshot was not written', j6shot.byId.J6.status === 'FAIL' && /not written/.test(j6shot.byId.J6.evidence));
  // ======================================================== the CRM steps (J7 columns, J8 field edit, J9 server list, J10 bulk): a good run, then each planted fault goes red for its own reason
  const crmRun = async (o, flags = {}) => { const impl = fakeImpl(o); const r = await run({ 'alert-to': ALERT, ...flags }, { ...base, impl }); return { ...r, impl }; };
  const P = await J.parseCsv('a,"b ""q"" c","d\r\ne"\r\n\r\nx,,z');
  check('journey csv: quotes, doubled quotes, an embedded line break, blank lines and an empty cell are read', JSON.stringify(P) === JSON.stringify([['a', 'b "q" c', 'd\r\ne'], ['x', '', 'z']]), JSON.stringify(P));
  const AN = J.journeyAnswers(FIELDS);
  check('journey answers: a number inside its range, the first option of an enum and of a single choice; a reference, a text and a multi choice stay empty',
    JSON.stringify(AN) === JSON.stringify({ side: 'Buying', budget: 10000, timing: '0-3 months', beds: 10 }) && J.journeyAnswers([{ key: 'm', type: 'choice', multi: true, options: ['a'] }]).m === undefined, JSON.stringify(AN));
  check('journey answers: the edit value is the neighbour inside the range (one up, one down at the top, a fresh number when none is held)',
    J.nextNumber(FIELDS[1], 10000) === 10001 && J.nextNumber(FIELDS[3], 10) === 9 && J.nextNumber(FIELDS[1], undefined) === 10000 && J.nextNumber({ key: 'n', type: 'number' }, 5) === 6);

  const good = await crmRun({});
  check('journey CRM: with a working CRM J7, J8, J9 and J10 PASS, and the lead is gone at the end', ['J7', 'J8', 'J9', 'J10'].every(i => good.byId[i].status === 'PASS') && good.impl.store.leads.length === 0, good.text);
  check('journey J7: the PASS line counts the contract\'s columns and the marker lead\'s industry values', /14 columns \(8 core \+ 6 industry/.test(good.byId.J7.evidence) && /with 4 industry value\(s\)/.test(good.byId.J7.evidence), good.byId.J7.evidence);
  const oldHeader = await crmRun({ exportCsv: m => ({ status: 200, text: `received,name,email,phone,form,page,status,owner,answers\r\n2026,${m},a@example.com,,contact,/contact/,new,,\r\n` }) });
  check('journey J7: the old fixed header (a column "answers") is a FAIL that names both headers', oldHeader.byId.J7.status === 'FAIL' && /the CSV header is "received,name,email,phone,form,page,status,owner,answers"/.test(oldHeader.byId.J7.evidence) && /the contract wants/.test(oldHeader.byId.J7.evidence), oldHeader.byId.J7.evidence);
  const newField = await crmRun({ fields: [...FIELDS, { key: 'garage', type: 'number', multi: false, column: true, editable: true, options: [], min: 0, max: 5 }], exportFields: FIELDS });
  check('journey J7: a field the contract has and the file lacks is a FAIL (the list is the contract\'s, not a copy)', newField.byId.J7.status === 'FAIL' && /garage/.test(newField.byId.J7.evidence), newField.byId.J7.evidence);
  const reordered = await crmRun({ exportFields: [FIELDS[1], FIELDS[0], ...FIELDS.slice(2)] });
  check('journey J7: the columns in another order than the form\'s are a FAIL', reordered.byId.J7.status === 'FAIL' && /the CSV header is/.test(reordered.byId.J7.evidence));
  const shifted = await crmRun({ exportText: t => t.replace(/,Buying,10000,/, ',10000,Buying,') });
  check('journey J7: an industry value in the wrong column is a FAIL that names the column and the value', shifted.byId.J7.status === 'FAIL' && /in the marker lead's line side is "10000" \(the lead said "Buying"\)/.test(shifted.byId.J7.evidence), shifted.byId.J7.evidence);
  const emptied = await crmRun({ exportText: t => t.replace(/,0-3 months,/, ',,') });
  check('journey J7: an industry value missing from the line is a FAIL', emptied.byId.J7.status === 'FAIL' && /timing is ""/.test(emptied.byId.J7.evidence), emptied.byId.J7.evidence);
  const bare = await crmRun({ fields: [{ key: 'note', type: 'text', multi: false, column: true, editable: true, options: [] }] });
  check('journey J7: a lead that carries no industry answer cannot pass (a header alone proves no value)', bare.byId.J7.status === 'FAIL' && /carries no industry answer/.test(bare.byId.J7.evidence), bare.byId.J7.evidence);
  const other = await crmRun({ exportCsv: () => ({ status: 200, text: `${J.csvHeader(FIELDS).join(',')}\r\n2026,Somebody Else,a@example.com,,contact,/contact/,new,,Buying,10000,0-3 months,10,,\r\n` }) });
  check('journey J7: a line of another lead is not the marker lead (the name column must be the marker)', other.byId.J7.status === 'FAIL' && /0 line\(s\) named "Journey abcdef12"/.test(other.byId.J7.evidence), other.byId.J7.evidence);
  const quoted = await crmRun({ exportText: t => t.replace('Journey abcdef12', '"Journey abcdef12"') });
  check('journey J7: a quoted cell is read as its text (the marker name is found in quotes)', quoted.byId.J7.status === 'PASS', quoted.byId.J7.evidence);

  const ed = good;
  check('journey J8: lead-update fields changes the phone and the first editable number field, both read back, exactly 2 edited events', ed.byId.J8.status === 'PASS' && /phone/.test(ed.byId.J8.evidence) && /budget 10000 -> 10001/.test(ed.byId.J8.evidence) && /2 edited events/.test(ed.byId.J8.evidence), ed.byId.J8.evidence);
  const e1 = await crmRun({ updateChanged: 1 });
  check('journey J8: an update that answers changed 1 for two fields is a FAIL', e1.byId.J8.status === 'FAIL' && /changed 2/.test(e1.byId.J8.evidence) && /answered HTTP 200/.test(e1.byId.J8.evidence), e1.byId.J8.evidence);
  const e2 = await crmRun({ updateIgnored: true });
  check('journey J8: an update that says changed 2 and writes nothing is a FAIL at the read back', e2.byId.J8.status === 'FAIL' && /read back through lead-list/.test(e2.byId.J8.evidence), e2.byId.J8.evidence);
  const e3 = await crmRun({ skipField: true });
  check('journey J8: only the core field changed (the industry field not) is a FAIL that names the field', e3.byId.J8.status === 'FAIL' && /budget 10000 \(wanted 10001\)/.test(e3.byId.J8.evidence), e3.byId.J8.evidence);
  const e4 = await crmRun({ events: 1 });
  check('journey J8: one edited event for two changed fields is a FAIL', e4.byId.J8.status === 'FAIL' && /holds 1 edited event\(s\) \(wanted exactly 2/.test(e4.byId.J8.evidence), e4.byId.J8.evidence);
  const e5 = await crmRun({ events: 3 });
  check('journey J8: three edited events for two changed fields is a FAIL too (exactly 2)', e5.byId.J8.status === 'FAIL' && /holds 3 edited event/.test(e5.byId.J8.evidence), e5.byId.J8.evidence);
  const e6 = await crmRun({ stringNumbers: true });
  check('journey J8: a number that reads back as text is a FAIL (typed)', e6.byId.J8.status === 'FAIL' && /read back/.test(e6.byId.J8.evidence), e6.byId.J8.evidence);
  const e7 = await crmRun({ dupMarker: true });
  check('journey J8: two leads found for the marker is a FAIL (the edit must hit the journey\'s own lead)', e7.byId.J8.status === 'FAIL' && /finds 2 lead\(s\)/.test(e7.byId.J8.evidence), e7.byId.J8.evidence);
  const e8 = await crmRun({ fields: FIELDS.filter(f => f.type !== 'number') });
  check('journey J8: a contract with no editable number field is a FAIL that says so', e8.byId.J8.status === 'FAIL' && /no editable number field/.test(e8.byId.J8.evidence), e8.byId.J8.evidence);
  check('journey J8: a FAIL skips J9 and J10 (the later CRM steps), naming J8', e1.byId.J9.status === 'SKIPPED' && e1.byId.J10.status === 'SKIPPED' && /^J10 SKIPPED \(after J8 FAIL\)/m.test(e1.text), e1.text);

  check('journey J9: search finds exactly 1, the filters keep and exclude, the sort is typed; a second lead from lead send holds 9 where the lead holds 10 and 9 sorts before 10',
    good.byId.J9.status === 'PASS' && /search finds exactly 1/.test(good.byId.J9.evidence) && /eq keeps the lead and excludes "3-6 months"/.test(good.byId.J9.evidence) && /asc 9 before 10, desc 10 before 9/.test(good.byId.J9.evidence) && good.impl.store.peak === 2 && good.impl.calls.filter(c => c === 'sendOrder').length === 1, good.byId.J9.evidence);
  const rows9 = await crmRun({ extraRows: [{ id: 'x1', name: 'Other 1', budget: 9 }, { id: 'x2', name: 'Other 2', budget: 10 }, { id: 'x3', name: 'Other 3' }] });
  check('journey J9: with other rows holding 9 and 10 the sort is compared as numbers over them', rows9.byId.J9.status === 'PASS' && /over the 3 row\(s\) holding one/.test(rows9.byId.J9.evidence), rows9.byId.J9.evidence);
  const txt9 = await crmRun({ extraRows: [{ id: 'x1', name: 'Other 1', budget: 9 }, { id: 'x2', name: 'Other 2', budget: 10 }], sortAsText: true });
  check('journey J9: a sort that orders 10 before 9 (as text) is a FAIL that shows the order', txt9.byId.J9.status === 'FAIL' && /not in numeric order: 10, 10001, 9/.test(txt9.byId.J9.evidence), txt9.byId.J9.evidence);
  const str9 = await crmRun({ extraRows: [{ id: 'x1', name: 'Other 1', budget: 9 }], sortStrings: true });
  check('journey J9: numbers that come back as text are a FAIL (a number as a number)', str9.byId.J9.status === 'FAIL' && /comes back as string, not a number/.test(str9.byId.J9.evidence), str9.byId.J9.evidence);
  const desc9 = await crmRun({ extraRows: [{ id: 'x1', name: 'Other 1', budget: 9 }, { id: 'x2', name: 'Other 2', budget: 10 }], sortAlwaysAsc: true });
  check('journey J9: a descending sort that comes back ascending is a FAIL', desc9.byId.J9.status === 'FAIL' && /sort budget desc is not in numeric order/.test(desc9.byId.J9.evidence), desc9.byId.J9.evidence);
  const dup9 = await crmRun({ dupMarker: true }, { only: 'J9' });
  check('journey J9: a search that finds two leads is a FAIL (exactly 1)', dup9.byId.J9.status === 'FAIL' && /total 2 and 2 row/.test(dup9.byId.J9.evidence), dup9.byId.J9.evidence);
  const eq1 = await crmRun({ eqBroken: true });
  check('journey J9: a filter that drops the lead holding the value is a FAIL ("not kept")', eq1.byId.J9.status === 'FAIL' && /the marker lead is not kept/.test(eq1.byId.J9.evidence) && /timing/.test(eq1.byId.J9.evidence), eq1.byId.J9.evidence);
  const eq2 = await crmRun({ filtersIgnored: true });
  check('journey J9: a filter that keeps a non-match is a FAIL ("not excluded")', eq2.byId.J9.status === 'FAIL' && /a non-match is not excluded/.test(eq2.byId.J9.evidence), eq2.byId.J9.evidence);
  const rg3 = await crmRun({ rangeIgnored: true });
  check('journey J9: a range that keeps a lead outside it is a FAIL', rg3.byId.J9.status === 'FAIL' && /a lead holding 10001 is not excluded/.test(rg3.byId.J9.evidence), rg3.byId.J9.evidence);
  const rg1 = await crmRun({ rangeBroken: true });
  check('journey J9: a range that drops the lead inside it is a FAIL', rg1.byId.J9.status === 'FAIL' && /filter budget 10000 to 10002/.test(rg1.byId.J9.evidence), rg1.byId.J9.evidence);
  const ls9 = await crmRun({ listStatus: 500 }, { only: 'J9' });
  check('journey J9: a list that answers 500 is a FAIL with the status', ls9.byId.J9.status === 'FAIL' && /HTTP 500/.test(ls9.byId.J9.evidence), ls9.byId.J9.evidence);
  check('journey J9: a FAIL skips J10, naming J9', (await crmRun({ filtersIgnored: true })).byId.J10.status === 'SKIPPED');

  check('journey J10: both journey leads (the marker lead and the sort lead) are removed: two leads existed, none is left, and the line says both',
    good.impl.store.peak === 2 && good.impl.store.leads.length === 0 && /both journey leads/.test(good.byId.J10.evidence) && /lead-list finds 0 of either/.test(good.byId.J10.evidence), good.byId.J10.evidence);
  check('journey J10: status and owner are set and read back, the delete without confirm is refused (409 S-CONFIRM) with the lead still there, the delete with confirm removes it',
    good.byId.J10.status === 'PASS' && /409 S-CONFIRM/.test(good.byId.J10.evidence) && /lead-list finds 0/.test(good.byId.J10.evidence) && good.impl.store.leads.length === 0, good.byId.J10.evidence);
  const order = good.impl.store.log.filter(l => l.includes('leads-bulk'));
  check('journey J10: the calls are status, owner, delete without confirm, delete with confirm, in that order, all as owner-a', order.join() === 'owner-a:leads-bulk:status,owner-a:leads-bulk:owner,owner-a:leads-bulk:delete,owner-a:leads-bulk:delete+confirm', order.join());
  const b1 = await crmRun({ bulkChanged: 0 });
  check('journey J10: a bulk status that changes 0 leads is a FAIL and the lead is still removed afterwards', b1.byId.J10.status === 'FAIL' && /changed 2/.test(b1.byId.J10.evidence) && /then removed/.test(b1.byId.J10.evidence) && b1.impl.store.leads.length === 0, b1.byId.J10.evidence);
  const b2 = await crmRun({ statusIgnored: true });
  check('journey J10: a bulk status that says changed 1 and writes nothing is a FAIL at the read back', b2.byId.J10.status === 'FAIL' && /lead-list still shows "new"/.test(b2.byId.J10.evidence) && b2.impl.store.leads.length === 0, b2.byId.J10.evidence);
  const b3 = await crmRun({ ownerIgnored: true });
  check('journey J10: a bulk owner that is not applied is a FAIL at the read back', b3.byId.J10.status === 'FAIL' && /lead-list shows owner null/.test(b3.byId.J10.evidence), b3.byId.J10.evidence);
  const b4 = await crmRun({ teamRow: null });
  check('journey J10: a workspace with no team row to be the owner is a FAIL that says so', b4.byId.J10.status === 'FAIL' && /no team row/.test(b4.byId.J10.evidence), b4.byId.J10.evidence);
  const b5 = await crmRun({ deleteNoConfirm: true });
  check('journey J10: a delete without the confirm flag that goes through is a FAIL (200, wanted 409 S-CONFIRM) and the clean-up says it could not remove what is already gone', b5.byId.J10.status === 'FAIL' && /answered HTTP 200/.test(b5.byId.J10.evidence) && /NOT removed \(HTTP 404/.test(b5.byId.J10.evidence), b5.byId.J10.evidence);
  const b9 = await crmRun({ ownerChanged: 0 });
  check('journey J10: a bulk owner that changes 0 leads is a FAIL', b9.byId.J10.status === 'FAIL' && /leads-bulk owner answered HTTP 200/.test(b9.byId.J10.evidence), b9.byId.J10.evidence);
  const b10 = await crmRun({ deleteChanged: 0 });
  check('journey J10: a confirmed delete that changes 0 leads is a FAIL', b10.byId.J10.status === 'FAIL' && /delete with the confirm flag answered HTTP 200/.test(b10.byId.J10.evidence), b10.byId.J10.evidence);
  const b6 = await crmRun({ wrongCode: 'S-OWN-ONLY' });
  check('journey J10: a 409 with another code than S-CONFIRM is a FAIL', b6.byId.J10.status === 'FAIL' && /wanted 409 S-CONFIRM/.test(b6.byId.J10.evidence), b6.byId.J10.evidence);
  const b7 = await crmRun({ refuseButDelete: true });
  check('journey J10: a delete that is refused and still removes the lead is a FAIL ("is gone after")', b7.byId.J10.status === 'FAIL' && /a lead is gone after a delete without the confirm flag was refused/.test(b7.byId.J10.evidence), b7.byId.J10.evidence);
  const b8 = await crmRun({ deleteKeeps: true });
  check('journey J10: a confirmed delete after which lead-list still finds the lead is a FAIL', b8.byId.J10.status === 'FAIL' && /still finds 1\+1 lead/.test(b8.byId.J10.evidence) && b8.impl.store.leads.length === 2, b8.byId.J10.evidence);
  const o1 = await crmRun({ alertsOnlyTo: (() => { let k = 0; return () => ++k <= 2; })() });
  check('journey J9: the second lead is not sent when the alert list no longer holds exactly --alert-to (the guard runs again before this alert): BLOCKED, nothing sent, J10 skipped',
    o1.byId.J9.status === 'BLOCKED' && !o1.impl.calls.includes('sendOrder') && o1.byId.J10.status === 'SKIPPED' && o1.impl.store.peak === 1, o1.byId.J9.evidence);
  const o2 = await crmRun({ orderSend: false });
  check('journey J9: a second lead that lead send cannot store is a FAIL that names it, and J10 is skipped', o2.byId.J9.status === 'FAIL' && /did not store one lead for "Order check abcdef12"/.test(o2.byId.J9.evidence) && o2.byId.J10.status === 'SKIPPED', o2.byId.J9.evidence);
  const o3 = await crmRun({ sortAsText: true });
  check('journey J9: a sort that puts 10 before 9 (text order) over the two leads is a FAIL that shows both orders, and the second lead is removed again', o3.byId.J9.status === 'FAIL' && /sort beds asc over the two leads of this run/.test(o3.byId.J9.evidence) && /wanted Order check abcdef12=9, Journey abcdef12=10/.test(o3.byId.J9.evidence) && /second lead was then removed/.test(o3.byId.J9.evidence) && /^cleanup: 1 journey lead\(s\) removed, 0 left$/m.test(o3.text) && o3.impl.store.leads.length === 0 && o3.byId.J10.status === 'SKIPPED', o3.byId.J9.evidence);
  const o4 = await crmRun({ sortAlwaysAsc: true });
  check('journey J9: a descending sort that comes back ascending over the two leads is a FAIL', o4.byId.J9.status === 'FAIL' && /sort beds desc over the two leads/.test(o4.byId.J9.evidence), o4.byId.J9.evidence);
  const o5 = await crmRun({ fields: FIELDS.map(f => (f.key === 'beds' ? { ...f, min: 5000, max: 6000 } : f)) });
  check('journey J9: a contract with no number column that takes both 9 and 10 is a FAIL that says so', o5.byId.J9.status === 'FAIL' && /no number column that takes both 9 and 10/.test(o5.byId.J9.evidence), o5.byId.J9.evidence);
  const blk = await crmRun({ bulkBlockedOnce: true });
  check('journey clean-up: J10 throwing Blocked mid-step (after the bulk status) still ends with both journey leads removed and one line saying so',
    blk.byId.J10.status === 'BLOCKED' && blk.impl.store.leads.length === 0 && /^cleanup: 2 journey lead\(s\) removed, 0 left$/m.test(blk.text) && !blk.res.ok && blk.res.data.cleanup.left.length === 0, blk.text);
  const gone = await crmRun({ bulkDown: true });
  check('journey clean-up: when the clean-up itself cannot run it prints a BLOCKED line naming the leads that may be left, and the run is not ok',
    gone.byId.J10.status === 'BLOCKED' && /^cleanup BLOCKED: 2 journey lead\(s\) may be left \(Journey abcdef12, Order check abcdef12\): .*403/m.test(gone.text) && !gone.res.ok && gone.impl.store.leads.length === 2, gone.text);
  const g5 = await crmRun({ bulkDown: true, preLead: true }, { only: 'J5' });
  check('journey clean-up: every step green but the clean-up unable to run is still a not-ok run (exit 1), with the lead named',
    g5.byId.J5.status === 'PASS' && /^cleanup BLOCKED: 1 journey lead\(s\) may be left \(Journey abcdef12\)/m.test(g5.text) && !g5.res.ok && g5.obj.exit === 1, g5.text);
  const k5 = await crmRun({ preLead: true }, { only: 'J5' });
  check('journey clean-up: a lead the run left behind (J5 only) is deleted with the confirm flag and counted: 1 removed, 0 left', /^cleanup: 1 journey lead\(s\) removed, 0 left$/m.test(k5.text) && k5.impl.store.leads.length === 0 && k5.res.ok, k5.text);
  const keep = await crmRun({ deleteKeeps: true, preLead: true }, { only: 'J5' });
  check('journey clean-up: a delete that answers 200 while lead-list still shows the lead is not "0 left": the line says the lead may be left and the run is not ok',
    !/0 left/.test(keep.text) && /^cleanup BLOCKED: 1 journey lead\(s\) may be left \(Journey abcdef12\)/m.test(keep.text) && keep.res.data.cleanup.left.join() === 'Journey abcdef12' && keep.res.data.cleanup.removed === 0 && !keep.res.ok && keep.impl.store.leads.length === 1, keep.text);
  const safe = await crmRun({ preLead: true, oldLead: true, searchLoose: true }, { only: 'J5' });
  check('journey clean-up: a list that also returns a lead without the run id (one of the old Journey leads) never gets that lead deleted: only the run\'s own lead goes',
    safe.impl.store.leads.map(x => x.name).join() === 'Journey 8c12816a' && /^cleanup: 1 journey lead\(s\) removed, 0 left$/m.test(safe.text) && safe.res.ok, safe.text + ' | left in the store: ' + safe.impl.store.leads.map(x => x.name).join());
  const none = await crmRun({}, { only: 'J4' });
  check('journey clean-up: a run that made no lead prints no clean-up line and touches no CRM function', !/cleanup/.test(none.text) && none.impl.store.log.length === 0, none.text);
  const alone = await crmRun({}, { only: 'J10' });
  check('journey J10: --only J10 uses one lead from lead send (one alert), removes it, and says so', alone.byId.J10.status === 'PASS' && /lead from lead send/.test(alone.byId.J10.evidence) && alone.impl.calls.filter(c => c === 'sendLead').length === 1 && alone.impl.store.leads.length === 0, alone.byId.J10.evidence);

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
    const leads = [], bodies = {};
    let leadMode = 'ok';
    const doc = (variant, path) => {
      const bad = variant === 'console' && path === '/' ? '<script>console.error("planted console error")</script>' : variant === 'throws' && path === '/' ? '<script>throw new Error("planted uncaught")</script>' : '';
      const wide = variant === 'overflow' ? '<div style="width:3000px;height:20px">wide</div>' : '';
      const form = path === '/contact/' ? `<form method="post" action="/api/lead"><label>name <input name="name" required></label><label>email <input type="email" name="email"></label><label>phone <input name="phone"></label><label>message <textarea name="message"></textarea></label><fieldset><label><input type="radio" name="side" value="Buying"> Buying</label><label><input type="radio" name="side" value="Selling"> Selling</label></fieldset><label>budget <input type="number" name="budget" min="10000"></label><label>bedrooms <input type="number" name="beds" min="0" max="10"></label><label>timing <select name="timing"><option value="">Choose</option><option value="0-3 months">0-3 months</option><option value="3-6 months">3-6 months</option></select></label><label><input type="checkbox" name="consent" value="yes" required> I agree</label><button type="submit">Send</button></form>` : '';
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>fixture ${variant}${path}</title></head><body style="margin:0"><h1>fixture ${variant} ${path}</h1>${wide}${form}${bad}</body></html>`;
    };
    const srv = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/lead?sent=1') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Thank you</title><h1>Thank you</h1><p>Your message was sent.</p><p><a href="/">Back to the site</a></p>'); return; }
      if (req.method === 'POST' && req.url === '/api/lead') {
        let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
          const name = new URLSearchParams(b).get('name');
          bodies[name] = Object.fromEntries(new URLSearchParams(b));
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
      const sent = bodies['Journey abcdef12'] || {};
      check('journey J5: the form\'s industry inputs are filled in the real browser (a radio ticked, a number box and a select set; the answers are the contract\'s, a reference is left empty)',
        sent.side === 'Buying' && sent.budget === '10000' && sent.beds === '10' && sent.timing === '0-3 months' && !('area' in sent), JSON.stringify(sent));
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
