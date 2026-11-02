// test journey --target staging [--only J4,J5] [--out <dir>] [--alert-to <our own email>]   (DECISIONS 48; briefs/journey.md)
// One command that strings the test site's life together on staging and is looked at: accounts, sign-in, edit and publish, the published
// site in a real browser (phone and desktop PNGs), a lead through the site's own form, that lead in the dashboard inbox, the lead out.
// One line per step: PASS | FAIL | BLOCKED | NOT BUILT YET | SKIPPED (after Jn FAIL), each with its evidence. Exit 0 only when no step
// FAILED or was BLOCKED; NOT BUILT YET is never a pass. The step table below is the one place a slice adds its step (briefs/journey.md 8).
// Laptop only: it needs staging secrets (variables by name), so it is not a ci.yml job. Never looped; production is refused.
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Usage, Blocked } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { lit, uuidLit } from '../lib/sql.mjs';
import { redact, registerSecret } from '../lib/redact.mjs';
import { parseIdentity, personToken } from '../lib/identity.mjs';
import { repoPath, importRepo } from '../lib/repo.mjs';
import { launchBrowser } from '../lib/browser.mjs';
import { WS_A, SITE_A, PREVIEW_HOST_A, seedGroup } from './seed.mjs';
import { leadGroup } from './lead.mjs';

export const PREVIEW = `https://${PREVIEW_HOST_A}`;
export const VIEWPORTS = [{ name: 'phone', width: 390, height: 844, mobile: true }, { name: 'desktop', width: 1536, height: 730, mobile: false }];
export const PAGES = ['/', '/contact/'];
// the two dashboard tests the journey runs by exact title (a unit test checks they exist verbatim: a rename turns our suite red)
export const TESTS = {
  J3: { file: 'site.spec.ts', title: 'the publish sheet: the progress comes in live, the job ends done, the preview shows the new heading' },
  J6: { file: 'flows.spec.ts', title: 'owner-a has Leads open; a lead sent to the test site the way omnikom lead send does appears without a reload within 15 s' },
};
// what a visitor's form may answer when the lead was sent: the Thank-you page the no-script submit lands on (303 to /api/lead?sent=1), or the JSON of the script path
export const SENT_ANSWER = /"sent"\s*:\s*true|your message was sent/i;
export const CSV_HEADER = 'received,name,email,phone,form,page,status,owner,answers';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clip = (s, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const pageSlug = p => (p.replace(/\//g, '') || 'home');

// ---------- the pure parts: what a Playwright JSON report says, and what that means for a step ----------
export function summarizePlaywright(report) {
  if (!report || typeof report !== 'object') return { ran: 0, rows: [], failed: 0, flaky: 0, error: 'no report' };
  const rows = [];
  const walk = s => { for (const sp of s.specs || []) rows.push({ title: sp.title, statuses: (sp.tests || []).map(t => t.status), ms: (sp.tests || []).flatMap(t => t.results || []).reduce((a, r) => a + (r.duration || 0), 0) }); for (const c of s.suites || []) walk(c); };
  for (const s of report.suites || []) walk(s);
  const ran = rows.filter(r => r.statuses.some(s => s !== 'skipped')).length;
  const failed = rows.filter(r => r.statuses.includes('unexpected')).length;
  const flaky = rows.filter(r => r.statuses.includes('flaky')).length;
  const error = (report.errors || []).length ? clip((report.errors[0] && (report.errors[0].message || report.errors[0])) || 'error', 160) : null;
  return { ran, rows, failed, flaky, error };
}

export function playwrightVerdict(sum, title) {
  if (sum.error) return { status: 'FAIL', evidence: `the dashboard test run reported an error: ${sum.error}` };
  if (sum.ran === 0) return { status: 'FAIL', evidence: `0 tests ran for "${clip(title, 60)}" (was the title changed in the spec file?)` };
  const other = sum.rows.filter(r => r.title !== title);
  if (other.length) return { status: 'FAIL', evidence: `a test other than the named one ran: "${clip(other[0].title, 70)}"` };
  if (sum.failed || sum.flaky) return { status: 'FAIL', evidence: `the dashboard test "${clip(title, 60)}" ${sum.failed ? 'failed' : 'was flaky'}` };
  return { status: 'PASS', evidence: `dashboard test passed: "${clip(title, 110)}" (${(sum.rows.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1)} s)` };
}

// ---------- the steps (the one table) ----------
const alertGuard = async c => {
  if (!c.alertTo) return { status: 'BLOCKED', evidence: 'no --alert-to: this step sends a real alert email and it may go only to our own address' };
  if (!(await c.impl.alertsOnlyTo(c.alertTo))) return { status: 'BLOCKED', evidence: `the test site's lead alert list is not exactly [${c.alertTo}]; run J1 with --alert-to ${c.alertTo} first (nothing was sent)` };
  return null;
};

// The lead J6 and J7 look for: the one J5 stored, else ONE lead made by `lead send` (the path the dashboard flows use; one alert, to --alert-to only,
// checked first). A product bug at J5 must not leave J6 and J7 unproven, and the line says whose lead it was.
const feedLead = async c => {
  if (c.state.stored) return { marker: c.state.marker, via: '' };
  if (c.state.fallback) return c.state.fallback;
  if (c.state.fallbackFail) return c.state.fallbackFail;   // one try per run: one alert at most
  const blocked = await alertGuard(c); if (blocked) return { fail: blocked };
  const marker = `Journey ${c.runId} lead send`;
  const sent = await c.impl.sendLead(marker, join(c.out, 'lead-send-fixture.json'));
  const stored = sent.ok ? await c.impl.leadCount(marker) : 0;
  if (stored !== 1) return (c.state.fallbackFail = { fail: { status: 'FAIL', evidence: `lead send did not store one lead for "${marker}" (${sent.ok ? 'ok' : sent.code}, ${stored} row(s))` } });
  return (c.state.fallback = { marker, via: ' (lead from lead send: J5 did not store one)' });
};

export const STEPS = [
  { id: 'J1', name: 'accounts', needs: [], async run(c) {
    const r = await c.impl.seed(c.alertTo);
    if (!r.ok) return { status: 'FAIL', evidence: `seed test answered ${r.code}: ${clip(r.data && r.data.error)}` };
    const rows = Object.values((r.data.testSite && r.data.testSite.rows) || {}).reduce((a, n) => a + n, 0);
    return { status: 'PASS', evidence: `seed test ok, changed=${r.data.changed}, contract v${r.data.testSite && r.data.testSite.contractVersion}, ${rows} rows, ${r.data.logins.length} logins` };
  } },
  { id: 'J2', name: 'sign-in', needs: ['J1'], async run(c) {
    const bits = [];
    for (const who of ['owner-a', 'member-a1']) {
      const r = await c.impl.workspacesAs(who);
      if (r.status !== 200) return { status: 'FAIL', evidence: `${who}: the Data API answered ${r.status} for /workspaces` };
      if (JSON.stringify(r.ids) !== JSON.stringify([WS_A])) return { status: 'FAIL', evidence: `${who} reads ${r.ids.length} workspace(s), not exactly its own` };
      bits.push(`${who} minted a session and reads exactly 1 workspace (its own)`);
    }
    return { status: 'PASS', evidence: bits.join('; ') };
  } },
  { id: 'J3', name: 'edit and publish', needs: ['J1'], async run(c) {
    const { file, title } = TESTS.J3;
    const spec = c.impl.spec(file);
    if (!spec.exists) return { status: 'NOT BUILT YET', evidence: `the editor and publish screens are not on this tree: apps/dashboard/tests/${file} missing` };
    if (!spec.text.includes(title)) return { status: 'FAIL', evidence: `apps/dashboard/tests/${file} has no test titled "${clip(title, 60)}" (renamed? the journey runs it by that title)` };
    const sum = await c.impl.playwright(file, title);
    return playwrightVerdict(sum, title);
  } },
  { id: 'J4', name: 'published site renders', needs: [], async run(c) {
    const problems = [], pngs = [];
    const b = await c.impl.launchBrowser();
    try {
      for (const vp of VIEWPORTS) {
        const page = await b.newPage(vp);
        for (const path of PAGES) {
          const tag = `${vp.name} ${path}`;
          const v = await page.open(c.previewBase.replace(/\/$/, '') + path);
          if (v.status !== 200) problems.push(`${tag}: HTTP ${v.status}`);
          if ((v.headers['x-robots-tag'] || '') !== 'noindex, nofollow') problems.push(`${tag}: x-robots-tag is "${v.headers['x-robots-tag'] || 'missing'}"`);
          if (v.consoleErrors.length) problems.push(`${tag}: ${v.consoleErrors.length} console error(s), first: ${clip(v.consoleErrors[0], 170)}`);
          if (v.exceptions.length) problems.push(`${tag}: ${v.exceptions.length} uncaught exception(s), first: ${clip(v.exceptions[0], 80)}`);
          if (v.overflow.overflowing) problems.push(`${tag}: scrolls sideways (${v.overflow.scrollWidth} wide in ${v.overflow.clientWidth})`);
          const png = join(c.out, `j4-${vp.name}-${pageSlug(path)}.png`);
          await page.screenshot(png);
          if (c.impl.fileSize(png) > 0) pngs.push(png); else problems.push(`${tag}: the screenshot ${png} was not written`);
        }
        await page.close();
      }
    } finally { await b.close(); }
    if (problems.length) return { status: 'FAIL', evidence: problems.slice(0, 4).join('; ') + (problems.length > 4 ? ` (+${problems.length - 4} more)` : ''), pngs };
    return { status: 'PASS', evidence: `${PAGES.length * VIEWPORTS.length} views (phone and desktop of ${PAGES.join(' and ')}): HTTP 200, noindex, nofollow, 0 console errors, 0 exceptions, no sideways scroll, ${pngs.length} PNGs`, pngs };
  } },
  { id: 'J5', name: 'lead through the site form', needs: ['J1'], async run(c) {
    const blocked = await alertGuard(c); if (blocked) return blocked;
    c.state.marker = `Journey ${c.runId}`;
    const b = await c.impl.launchBrowser();
    const pngs = [];
    let sent, count;
    try {
      const page = await b.newPage(VIEWPORTS[1]);
      const open = await page.open(c.previewBase.replace(/\/$/, '') + '/contact/');
      if (open.status !== 200) return { status: 'FAIL', evidence: `/contact/ answered HTTP ${open.status}` };
      const values = { name: c.state.marker, email: `journey.${c.runId}@example.com`, phone: '(555) 010-0153', message: `Sent by omnikom test journey ${c.runId}. Synthetic. Safe to ignore.` };
      for (const [k, v] of Object.entries(values)) { const sel = k === 'message' ? 'form textarea[name=message], form input[name=message]' : `form input[name=${k}]`; if (await page.has(sel)) await page.fill(sel, v); }
      await page.check('form input[name=consent]');
      const filled = join(c.out, 'j5-form-filled.png');
      await page.screenshot(filled); if (c.impl.fileSize(filled) > 0) pngs.push(filled);
      sent = await page.submit('form');
      const answer = join(c.out, 'j5-form-answer.png');
      await page.screenshot(answer); if (c.impl.fileSize(answer) > 0) pngs.push(answer);
      count = await c.impl.leadCount(c.state.marker);
    } finally { await b.close(); }
    const said = `the form answered HTTP ${sent.status} "${clip(sent.text, 90)}"`;
    if (sent.status !== 200 || !SENT_ANSWER.test(sent.text)) return { status: 'FAIL', evidence: `${said}; lead rows with the marker: ${count}`, pngs };
    if (count !== 1) return { status: 'FAIL', evidence: `${said}, but ${count} lead row(s) carry "${c.state.marker}" (wanted 1)`, pngs };
    c.state.stored = true;
    return { status: 'PASS', evidence: `${said}; 1 lead row "${c.state.marker}" stored for the test site`, pngs };
  } },
  { id: 'J6', name: 'lead in the inbox', needs: ['J1'], async run(c) {
    const blocked = await alertGuard(c); if (blocked) return blocked;
    const lead = await feedLead(c); if (lead.fail) return lead.fail;
    const { file, title } = TESTS.J6;
    const v = playwrightVerdict(await c.impl.playwright(file, title), title);
    const shot = await c.impl.inboxShot('owner-a', lead.marker, join(c.out, 'j6-inbox-owner-a.png'));
    const pngs = shot.written ? [shot.file] : [];
    if (v.status !== 'PASS') return { status: 'FAIL', evidence: v.evidence, pngs };
    if (!shot.found) return { status: 'FAIL', evidence: `${v.evidence}; but the inbox of owner-a does not list "${lead.marker}"${lead.via}`, pngs };
    if (!shot.written) return { status: 'FAIL', evidence: `${v.evidence}; the inbox screenshot was not written`, pngs };
    return { status: 'PASS', evidence: `${v.evidence}; the inbox of owner-a lists "${lead.marker}"${lead.via}`, pngs };
  } },
  { id: 'J7', name: 'export', needs: ['J1'], async run(c) {
    const lead = await feedLead(c); if (lead.fail) return lead.fail;
    const r = await c.impl.exportCsv('owner-a', lead.marker);
    if (r.status !== 200) return { status: 'FAIL', evidence: `lead-export answered HTTP ${r.status}` };
    const lines = r.text.split(/\r?\n/).filter(Boolean);
    if (lines[0] !== CSV_HEADER) return { status: 'FAIL', evidence: `the CSV header is "${clip(lines[0], 80)}"` };
    const hits = lines.slice(1).filter(l => l.includes(lead.marker));
    if (hits.length !== 1) return { status: 'FAIL', evidence: `the CSV holds ${hits.length} line(s) with "${lead.marker}" (wanted 1)${lead.via}` };
    return { status: 'PASS', evidence: `lead-export as owner-a: HTTP 200, ${lines.length - 1} data line(s), the marker lead is in it${lead.via}` };
  } },
  { id: 'J8', name: 'CRM "send a test"', needs: [], async run() { return { status: 'NOT BUILT YET', evidence: 'no sink we own (crm-test refuses loopback; supabase/functions/crm-test/index.ts)' }; } },
  { id: 'J9', name: 'lead pushed to the CRM', needs: [], async run() { return { status: 'NOT BUILT YET', evidence: '"Webhook out" is TO BUILD (planning/REQUIREMENTS.md:44,155)' }; } },
];

// ---------- the orchestrator ----------
const BAD = new Set(['FAIL', 'BLOCKED', 'SKIPPED']);
const stamp = sec => new Date(sec * 1000).toISOString().replace(/\D/g, '').slice(0, 14);

export async function runJourney(c, { only = null, steps = STEPS } = {}) {
  const done = new Map(), out = [], notRun = [];
  for (const step of steps) {
    if (only && !only.includes(step.id)) { notRun.push(step.id); continue; }
    const bad = step.needs.map(n => done.get(n)).find(r => r && BAD.has(r.status));
    let r;
    if (bad) r = { status: 'SKIPPED', evidence: '', after: `${bad.root || bad.id} ${bad.rootStatus || bad.status}`, root: bad.root || bad.id, rootStatus: bad.rootStatus || bad.status };
    else {
      try { r = await step.run(c); }
      catch (e) { r = e instanceof Blocked ? { status: 'BLOCKED', evidence: clip(e.message, 200) + (e.unblock ? ` (${clip(e.unblock, 100)})` : '') } : { status: 'FAIL', evidence: `journey error: ${clip(e && e.message || e, 200)}` }; }
    }
    const row = { id: step.id, name: step.name, ...r, pngs: r.pngs || [] };
    done.set(step.id, row); out.push(row);
  }
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, 'NOT BUILT YET': 0, SKIPPED: 0 };
  for (const r of out) counts[r.status]++;
  return { steps: out, counts, notRun };
}

export const label = s => (s.status === 'SKIPPED' ? `SKIPPED (after ${s.after})` : s.status);

export function summaryLine(data) {
  const c = data.counts;
  const parts = [`${c.PASS} PASS`, `${c['NOT BUILT YET']} NOT BUILT YET`, `${c.FAIL} FAIL`, ...(c.BLOCKED ? [`${c.BLOCKED} BLOCKED`] : []), ...(c.SKIPPED ? [`${c.SKIPPED} SKIPPED`] : [])];
  return `journey (${data.target}): ${parts.join(', ')}${data.notRun.length ? `; not run: ${data.notRun.join(', ')}` : ''}; screenshots in ${data.out}`;
}

// the text main prints for `test journey` (a result object with data.steps)
export function journeyText(obj, env = process.env) {
  const d = obj.data;
  const lines = d.steps.map(s => `${s.id} ${label(s)} ${s.name}${s.evidence ? ': ' + s.evidence : ''}${s.pngs.length ? ` | png: ${s.pngs.join('; ')}` : ''}`);
  return redact([...lines, summaryLine(d)].join('\n'), env) + '\n';
}

// ---------- the real capabilities (tests hand runJourney a fake of the same shape) ----------
const DASH = () => repoPath('apps', 'dashboard');
const guard = () => importRepo('tools/proc-guard/index.mjs');

// seams (tests only): spawn, importer, launch, httpUp, ensureBuilt; the defaults are the real ones
export function makeImpl(ctx, seams = {}) {
  const spawnProc = seams.spawn || spawn;
  const importer = seams.importer || importRepo;
  const launch = seams.launch || (() => launchBrowser({ env: ctx.env }));
  const httpUp = seams.httpUp || (async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } });
  const guard = () => importer('tools/proc-guard/index.mjs');
  const target = ctx.target();
  const pub = () => ctx.env[target.vars.publishableKey];
  const dash = DASH();
  let built = false;
  const need = () => {
    if (!existsSync(join(dash, 'node_modules', '@playwright', 'test', 'cli.js'))) throw new Blocked('apps/dashboard/node_modules is missing (the dashboard specs and the build need it)', 'install it in apps/dashboard (npm ci, after the supply-chain check) or link the main checkout\'s node_modules');
  };
  const build = async () => {
    if (built) return; need();
    const g = await guard();
    const r = await g.runLimited(process.execPath, [join(dash, 'scripts', 'build-staging.mjs')], { cwd: dash, env: ctx.env, timeout: 300000, windowsHide: true });
    if (r.status !== 0) throw new Error(`the dashboard build against staging failed (exit ${r.status}): ${clip(String(r.stdout + r.stderr).trim().split(/\r?\n/).pop(), 160)}`);
    built = true;
  };
  const ensureBuilt = seams.ensureBuilt || build;
  const mintHash = async who => {
    const id = parseIdentity(who);
    const r = await ctx.fetch(target.authBase.replace(/\/$/, '') + '/admin/generate_link', { method: 'POST', headers: { 'content-type': 'application/json', apikey: ctx.env[target.vars.secretKey], authorization: `Bearer ${ctx.env[target.vars.secretKey]}` }, body: JSON.stringify({ type: 'magiclink', email: id.email }), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => null);
    if (r.status !== 200 || !j || !j.hashed_token) throw new Blocked(`a sign-in link for ${who}: Auth generate_link answered ${r.status}`, 'run omnikom seed test');
    registerSecret(j.hashed_token, 'magic-link token hash');
    return j.hashed_token;
  };
  return {
    async seed(alertTo) { return seedGroup({ ...ctx, positionals: ['seed', 'test'], flags: alertTo ? { 'alert-to': alertTo } : {} }); },
    async workspacesAs(who) {
      const token = await personToken(parseIdentity(who), { target, env: ctx.env, fetchImpl: ctx.fetch });
      const res = await ctx.fetch(target.restBase.replace(/\/$/, '') + '/workspaces?select=id', { headers: { apikey: pub(), authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
      const j = await res.json().catch(() => null);
      return { status: res.status, ids: Array.isArray(j) ? j.map(x => x.id).sort() : [] };
    },
    spec(file) { const p = join(dash, 'tests', file); return existsSync(p) ? { exists: true, text: readFileSync(p, 'utf8') } : { exists: false, text: '' }; },
    async playwright(file, title) {
      await ensureBuilt();
      const g = await guard();
      const tmp = g.guardedTemp('omnikom-jb-', 'journey-playwright');
      try {
        const report = join(tmp.dir, 'pw.json');
        const grep = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const r = await g.runLimited(process.execPath, [join(dash, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', `tests/${file}`, '-g', grep, '--reporter=json'],
          { cwd: dash, env: { ...ctx.env, PLAYWRIGHT_JSON_OUTPUT_NAME: report, TEMP: tmp.dir, TMP: tmp.dir, TMPDIR: tmp.dir }, timeout: 600000, dir: tmp.dir, windowsHide: true });
        if (!existsSync(report)) return { ran: 0, rows: [], failed: 0, flaky: 0, error: `no report (exit ${r.status}${r.timedOut ? ', timed out' : ''}): ${clip(String(r.stdout + r.stderr).trim().split(/\r?\n/).pop(), 120)}` };
        try { return summarizePlaywright(JSON.parse(readFileSync(report, 'utf8'))); } catch (e) { return { ran: 0, rows: [], failed: 0, flaky: 0, error: 'the report is not JSON' }; }
      } finally { tmp.release(); }
    },
    launchBrowser: launch,
    fileSize: p => { try { return statSync(p).size; } catch { return 0; } },
    async leadCount(marker) {
      const r = ctx.sql().scalar(`select count(*) from leads where site_id = ${uuidLit(SITE_A)} and name = ${lit(marker)}`);
      if (!r.ok) throw new Error(`could not count the lead rows: ${clip(r.message)}`);
      return Number(r.value);
    },
    // a lead the way `omnikom lead send` makes it (signed with the test site's key, over capture-lead), with a marker name
    async sendLead(marker, file) {
      writeFileSync(file, JSON.stringify({ form: 'contact', flow: 'contact', page: '/journey', cta: 'journey', name: marker, email: `journey.${ctx.randomUUID().slice(0, 8)}@example.com`, phone: '(555) 010-0153',
        answers: { message: 'Sent by omnikom test journey (lead send). Synthetic. Safe to ignore.' }, consentText: 'I agree that the business may contact me about this request by email, phone or text.', marketingConsent: { given: false, text: 'marketing wording' }, hp: '' }));
      const r = await leadGroup({ ...ctx, positionals: ['lead', 'send'], warnings: [], flags: { site: SITE_A, as: 'site:test-demo-a', fixture: file, real: true, key: ctx.randomUUID() } });
      return { ok: r.ok, code: r.code, statuses: ((r.data && r.data.attempts) || []).map(a => a.status) };
    },
    async alertsOnlyTo(addr) {
      const r = ctx.sql().scalar(`select count(*) from sites where id = ${uuidLit(SITE_A)} and lead_alert_to = array[${lit(addr)}]::text[]`);
      return r.ok && Number(r.value) === 1;
    },
    async exportCsv(who, marker) {
      const token = await personToken(parseIdentity(who), { target, env: ctx.env, fetchImpl: ctx.fetch });
      const res = await ctx.fetch(target.functionsBase.replace(/\/$/, '') + '/lead-export', { method: 'POST', headers: { 'content-type': 'application/json', apikey: pub(), authorization: `Bearer ${token}` }, body: JSON.stringify({ site: SITE_A, filter: 'all', q: marker }), signal: AbortSignal.timeout(30000) });
      return { status: res.status, text: await res.text() };
    },
    // sign owner in through the app's own /auth/confirm link (like the dashboard's global setup), wait for the marker lead, take the PNG
    async inboxShot(who, marker, file) {
      await ensureBuilt();
      const g = await guard();
      // the port comes from the dashboard's own rule (a block of its own on 127.0.0.1, one run one port): read from apps/dashboard, never copied or edited here
      const pp = await importer('apps/dashboard/scripts/preview-port.mjs');
      const port = await pp.choosePort({ say: () => {} });
      const base = pp.baseUrl(port);
      const server = spawnProc(process.execPath, [join(dash, 'scripts', 'preview-staging.mjs')], { cwd: dash, env: { ...ctx.env, [pp.PORT_ENV]: String(port) }, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
      let b = null;
      try {
        let up = false;
        for (let i = 0; i < 120 && !up; i++) { up = await httpUp(base + '/'); if (!up) await ctx.sleep(500); }
        if (!up) throw new Error(`the dashboard preview did not come up at ${base} in 60 s (it was started on that port and did not answer)`);
        const hash = await mintHash(who);
        b = await launch();
        const page = await b.newPage(VIEWPORTS[1]);
        await page.open(`${base}/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=magiclink`);
        const leads = `location.pathname.startsWith('/w/test-demo-a/leads')`;
        if (!(await page.waitFor(leads, 30000))) throw new Error('the sign-in link did not lead to the Leads page in 30 s');
        const found = await page.waitFor(`document.body && document.body.innerText.includes(${JSON.stringify(marker)})`, 20000);
        await page.screenshot(file);
        return { found, file, written: this.fileSize(file) > 0 };
      } finally {
        if (b) await b.close();
        try { g.killTree(server.pid); } catch { /* gone */ }
      }
    },
  };
}

// ---------- the command ----------
export async function journeyGroup(ctx, overrides = {}) {
  const f = ctx.flags;
  if (ctx.targetName !== 'staging') throw new Blocked(`test journey runs on staging only (target '${ctx.targetName}')`, 'add --target staging');
  const ids = STEPS.map(s => s.id);
  let only = null;
  if (f.only !== undefined) {
    if (f.only === true) throw new Usage('--only needs step ids, e.g. --only J4,J5');
    only = String(f.only).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const unknown = only.filter(x => !ids.includes(x));
    if (!only.length || unknown.length) throw new Usage(`--only takes ${ids.join(', ')}${unknown.length ? ` (not ${unknown.join(', ')})` : ''}`);
  }
  const alertTo = f['alert-to'] === undefined ? null : String(f['alert-to']);
  if (alertTo !== null && !EMAIL.test(alertTo)) throw new Usage('--alert-to must be an email address');
  const selected = ids.filter(i => !only || only.includes(i));
  if ((selected.includes('J5') || selected.includes('J6')) && !alertTo) throw new Usage('J5 and J6 send a real lead alert email: pass --alert-to <our own address> (the alert list of the test site is set to it and checked before anything is sent)');
  const target = ctx.target();
  const missing = [target.vars.ref, target.vars.secretKey, target.vars.publishableKey].filter(n => !ctx.env[n]);
  if (missing.length) throw new Blocked(`${missing.join(', ')} not set (read by name)`, 'run through node tools/with-env.mjs "<env file>" -- ...');

  const runId = ctx.randomUUID().replace(/-/g, '').slice(0, 8);
  const out = join(f.out && f.out !== true ? String(f.out) : tmpdir(), `journey-${stamp(ctx.now())}`);
  mkdirSync(out, { recursive: true });
  const c = { ctx, impl: overrides.impl || makeImpl(ctx), previewBase: overrides.previewBase || PREVIEW, alertTo, out, runId, state: {} };
  const r = await runJourney(c, { only, steps: overrides.steps || STEPS });
  const ok = r.counts.FAIL === 0 && r.counts.BLOCKED === 0;
  return result(ok, ok ? 'ok' : 'JOURNEY-FAILED', { target: 'staging', out, runId, ...r });
}
