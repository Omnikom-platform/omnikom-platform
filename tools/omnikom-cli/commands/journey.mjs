// test journey --target staging [--only J4,J5] [--out <dir>] [--alert-to <our own email>]   (DECISIONS 48; briefs/journey.md)
// One command that strings the test site's life together on staging and is looked at: accounts, sign-in, edit and publish, the published
// site in a real browser (phone and desktop PNGs), a lead through the site's own form, that lead in the dashboard inbox, the lead out
// (one column per field of the form contract), then every CRM feature of block 1 on that one lead as owner-a through the real functions:
// field edit, server list (search, filter, sort), bulk status and owner, delete refused without the confirm flag and done with it; then the CRM export
// and import in the client's own layout (propose and save a map, export in it, import it back with a dry run first and the owner's consent tick).
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
// The export writes these columns, then one per industry field of the test site's form contract in form order (supabase/functions/lead-export). The
// list comes from the contract through impl.crmFields, never copied here, so a field added to the form is expected in the file at once.
export const CSV_CORE = ['received', 'name', 'email', 'phone', 'form', 'page', 'status', 'owner'];
export const csvHeader = fields => [...CSV_CORE, ...fields.map(f => f.key)];
// the phone a field edit writes (its neighbour when the lead already holds it)
export const EDIT_PHONE = '(555) 010-0177', EDIT_PHONE_ALT = '(555) 010-0178';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clip = (s, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const pageSlug = p => (p.replace(/\//g, '') || 'home');
const within = (n, f) => Math.min(typeof f.max === 'number' ? f.max : n, Math.max(typeof f.min === 'number' ? f.min : n, n));

// RFC 4180 reader for the export (quotes, doubled quotes, CRLF); blank lines are dropped
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const end = () => { row.push(cell); cell = ''; if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch !== '"') cell += ch; else if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; end(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) end();
  return rows;
}

// What the journey's lead says about each industry field: a number inside the range the contract allows, the first option of a list or of a
// single choice. Other types (a reference, a text, a multi choice) stay empty. The field list is the contract's (impl.crmFields).
export function journeyAnswers(fields) {
  const a = {};
  for (const f of fields) {
    if (f.type === 'number') a[f.key] = within(10, f);
    else if ((f.type === 'enum' || (f.type === 'choice' && !f.multi)) && f.options && f.options.length) a[f.key] = f.options[0];
  }
  return a;
}
// the value a field edit writes: the neighbour of what the lead holds, inside the contract's range
export const nextNumber = (f, cur) => (typeof cur !== 'number' ? within(10, f) : typeof f.max === 'number' && cur >= f.max ? cur - 1 : cur + 1);

// fill the form's industry inputs the way a visitor would (a number box, a select, a radio); the ones this page has are returned, so J7 knows what to find
async function fillAnswers(page, fields, answers) {
  const filled = {};
  for (const f of fields) {
    if (!(f.key in answers)) continue;
    const v = String(answers[f.key]), pick = f.type === 'choice' ? `form input[name=${f.key}][value=${JSON.stringify(v)}]` : `form ${f.type === 'enum' ? 'select' : 'input'}[name=${f.key}]`;
    if (!(await page.has(pick))) continue;
    if (f.type === 'choice') await page.check(pick); else await page.fill(pick, v);
    filled[f.key] = answers[f.key];
  }
  return filled;
}

// owner-a looks for the journey's lead in the CRM list (the server list, search by the marker)
const findLead = async (c, marker, extra = {}) => {
  const r = await c.impl.crm('owner-a', 'lead-list', { workspace: WS_A, search: marker, ...extra });
  const j = r.json || {};
  return { status: r.status, text: r.text, total: j.total, rows: Array.isArray(j.rows) ? j.rows : [] };
};
// the journey's one lead as the list shows it now (exactly one row carries the marker, else the step fails)
const ownLead = async (c, lead) => {
  const first = await findLead(c, lead.marker);
  if (first.rows.length !== 1) return { fail: { status: 'FAIL', evidence: `lead-list finds ${first.rows.length} lead(s) for "${lead.marker}" (HTTP ${first.status}, wanted 1)${lead.via}` } };
  return { row: first.rows[0] };
};

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
  const answers = journeyAnswers(await c.impl.crmFields());
  const sent = await c.impl.sendLead(marker, join(c.out, 'lead-send-fixture.json'), answers);
  const stored = sent.ok ? await c.impl.leadCount(marker) : 0;
  if (stored !== 1) return (c.state.fallbackFail = { fail: { status: 'FAIL', evidence: `lead send did not store one lead for "${marker}" (${sent.ok ? 'ok' : sent.code}, ${stored} row(s))` } });
  c.state.answers = answers;
  return (c.state.fallback = { marker, via: ' (lead from lead send: J5 did not store one)' });
};

// J11: the map is saved under one fixed name (a re-run updates one row), every lead it makes carries the run's marker in its name and email
export const IO_MAP = 'journey crm-io (synthetic)';
const cap = k => k.charAt(0).toUpperCase() + k.slice(1);
const csvText = rows => rows.map(r => r.map(x => (/[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\r\n') + '\r\n';
export const CONSENT_START = 'These people agreed to be contacted by my business. Ticked by the owner on ';

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
    const fields = await c.impl.crmFields();
    const b = await c.impl.launchBrowser();
    const pngs = [];
    let sent, count;
    try {
      const page = await b.newPage(VIEWPORTS[1]);
      const open = await page.open(c.previewBase.replace(/\/$/, '') + '/contact/');
      if (open.status !== 200) return { status: 'FAIL', evidence: `/contact/ answered HTTP ${open.status}` };
      const values = { name: c.state.marker, email: `journey.${c.runId}@example.com`, phone: '(555) 010-0153', message: `Sent by omnikom test journey ${c.runId}. Synthetic. Safe to ignore.` };
      for (const [k, v] of Object.entries(values)) { const sel = k === 'message' ? 'form textarea[name=message], form input[name=message]' : `form input[name=${k}]`; if (await page.has(sel)) await page.fill(sel, v); }
      c.state.answers = await fillAnswers(page, fields, journeyAnswers(fields));
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
    const fields = await c.impl.crmFields();
    const r = await c.impl.exportCsv('owner-a', lead.marker);
    if (r.status !== 200) return { status: 'FAIL', evidence: `lead-export answered HTTP ${r.status}` };
    const rows = parseCsv(r.text), want = csvHeader(fields);
    if (JSON.stringify(rows[0] || []) !== JSON.stringify(want)) return { status: 'FAIL', evidence: `the CSV header is "${clip((rows[0] || []).join(','), 110)}", the contract wants "${clip(want.join(','), 110)}"` };
    const hits = rows.slice(1).filter(x => x[1] === lead.marker);
    if (hits.length !== 1) return { status: 'FAIL', evidence: `the CSV holds ${hits.length} line(s) named "${lead.marker}" (wanted 1)${lead.via}` };
    const answers = Object.entries(c.state.answers || {});
    const wrong = answers.filter(([k, v]) => hits[0][want.indexOf(k)] !== String(v));
    if (wrong.length) return { status: 'FAIL', evidence: `in the marker lead's line ${wrong.slice(0, 3).map(([k, v]) => `${k} is "${clip(hits[0][want.indexOf(k)], 30)}" (the lead said "${v}")`).join('; ')}${lead.via}` };
    if (!answers.length) return { status: 'FAIL', evidence: `the marker lead carries no industry answer to find in the file${lead.via}` };
    return { status: 'PASS', evidence: `lead-export as owner-a: HTTP 200, ${want.length} columns (${CSV_CORE.length} core + ${fields.length} industry, the contract's, in form order), ${rows.length - 1} data line(s), the marker lead is in it with ${answers.length} industry value(s) in their columns${lead.via}` };
  } },
  { id: 'J8', name: 'field edit', needs: ['J1'], async run(c) {
    const lead = await feedLead(c); if (lead.fail) return lead.fail;
    const field = (await c.impl.crmFields()).find(f => f.type === 'number' && f.editable);
    if (!field) return { status: 'FAIL', evidence: 'the form contract has no editable number field to edit' };
    const own = await ownLead(c, lead); if (own.fail) return own.fail;
    const row = own.row, phone = row.phone === EDIT_PHONE ? EDIT_PHONE_ALT : EDIT_PHONE, value = nextNumber(field, row[field.key]);
    const e = await c.impl.crm('owner-a', 'lead-update', { lead: row.id, fields: { phone, [field.key]: value } });
    if (e.status !== 200 || !e.json || e.json.changed !== 2) return { status: 'FAIL', evidence: `lead-update fields (phone and ${field.key}) answered HTTP ${e.status} ${clip(e.text, 90)} (wanted 200 with changed 2)${lead.via}` };
    const back = (await findLead(c, lead.marker)).rows[0] || {};
    if (back.phone !== phone || back[field.key] !== value) return { status: 'FAIL', evidence: `read back through lead-list: phone ${JSON.stringify(back.phone)} (wanted ${JSON.stringify(phone)}), ${field.key} ${JSON.stringify(back[field.key])} (wanted ${value})${lead.via}` };
    const events = await c.impl.editedEvents(row.id);
    if (events !== 2) return { status: 'FAIL', evidence: `the lead's timeline holds ${events} edited event(s) (wanted exactly 2, one per changed field)${lead.via}` };
    return { status: 'PASS', evidence: `lead-update fields: one core field (phone) and one industry field (${field.key} ${row[field.key]} -> ${value}) changed, both read back through lead-list, 2 edited events${lead.via}` };
  } },
  { id: 'J9', name: 'server list', needs: ['J1', 'J8'], async run(c) {
    const lead = await feedLead(c); if (lead.fail) return lead.fail;
    const fields = await c.impl.crmFields();
    const pick = fields.find(f => f.type === 'enum' && f.column), nf = fields.find(f => f.type === 'number' && f.column);
    if (!pick || !nf) return { status: 'FAIL', evidence: 'the form contract has no enum column and number column to filter and sort on' };
    const s = await findLead(c, lead.marker);
    if (s.status !== 200 || s.total !== 1 || s.rows.length !== 1) return { status: 'FAIL', evidence: `search "${lead.marker}" answered HTTP ${s.status} with total ${s.total} and ${s.rows.length} row(s) (wanted exactly 1)${lead.via}` };
    const row = s.rows[0], kind = row[pick.key], n = row[nf.key], other = (pick.options || []).find(o => o !== kind);
    if (typeof kind !== 'string' || typeof n !== 'number' || other === undefined) return { status: 'FAIL', evidence: `the marker lead holds ${pick.key} ${JSON.stringify(kind)} and ${nf.key} ${JSON.stringify(n)}; a filter needs a text option and a number${lead.via}` };
    const ids = r => r.rows.map(x => x.id).join();
    const eqIn = await findLead(c, lead.marker, { filters: [{ field: pick.key, op: 'eq', value: kind }] });
    if (eqIn.total !== 1 || ids(eqIn) !== row.id) return { status: 'FAIL', evidence: `filter ${pick.key} = "${kind}" (the lead's own value) answered HTTP ${eqIn.status}, total ${eqIn.total}: the marker lead is not kept${lead.via}` };
    const eqOut = await findLead(c, lead.marker, { filters: [{ field: pick.key, op: 'eq', value: other }] });
    if (eqOut.status !== 200 || eqOut.total !== 0) return { status: 'FAIL', evidence: `filter ${pick.key} = "${other}" (not the lead's value) answered HTTP ${eqOut.status}, total ${eqOut.total}: a non-match is not excluded${lead.via}` };
    const inRange = await findLead(c, lead.marker, { filters: [{ field: nf.key, op: 'range', from: n - 1, to: n + 1 }] });
    if (inRange.total !== 1 || ids(inRange) !== row.id) return { status: 'FAIL', evidence: `filter ${nf.key} ${n - 1} to ${n + 1} answered HTTP ${inRange.status}, total ${inRange.total}: the marker lead (${n}) is not kept${lead.via}` };
    const outRange = await findLead(c, lead.marker, { filters: [{ field: nf.key, op: 'range', from: n + 1 }] });
    if (outRange.status !== 200 || outRange.total !== 0) return { status: 'FAIL', evidence: `filter ${nf.key} from ${n + 1} answered HTTP ${outRange.status}, total ${outRange.total}: a lead holding ${n} is not excluded${lead.via}` };
    const sorted = {};
    for (const dir of ['asc', 'desc']) {
      const r = await c.impl.crm('owner-a', 'lead-list', { workspace: WS_A, size: 200, sort: { field: nf.key, dir } });
      const nums = ((r.json && r.json.rows) || []).map(x => x[nf.key]).filter(v => v !== undefined && v !== null);
      if (r.status !== 200 || !r.json) return { status: 'FAIL', evidence: `sort ${nf.key} ${dir} answered HTTP ${r.status} ${clip(r.text, 90)}${lead.via}` };
      if (nums.some(v => typeof v !== 'number')) return { status: 'FAIL', evidence: `sort ${nf.key} ${dir}: a value comes back as ${typeof nums.find(v => typeof v !== 'number')}, not a number${lead.via}` };
      if (nums.some((v, i) => i && (dir === 'asc' ? v < nums[i - 1] : v > nums[i - 1]))) return { status: 'FAIL', evidence: `sort ${nf.key} ${dir} is not in numeric order: ${nums.slice(0, 8).join(', ')}${lead.via}` };
      sorted[dir] = nums.length;
    }
    // The order of two numbers: a second lead (made by lead send, one more alert to --alert-to only, the alert list checked first) holds 9 where the
    // marker lead holds 10. A sort that compares text puts "10" before "9"; the typed sort puts 9 first. J10 removes both leads.
    const sf = fields.find(f => f.type === 'number' && f.column && (f.min === undefined || f.min <= 9) && (f.max === undefined || f.max >= 10));
    if (!sf) return { status: 'FAIL', evidence: `the form contract has no number column that takes both 9 and 10 to compare the sort on${lead.via}` };
    if (row[sf.key] !== 10) return { status: 'FAIL', evidence: `the marker lead holds ${sf.key} ${JSON.stringify(row[sf.key])}, not 10, so 9 cannot be compared with it${lead.via}` };
    const blocked = await alertGuard(c); if (blocked) return blocked;
    const second = `Order check ${c.runId}`;
    const sent = await c.impl.sendLead(second, join(c.out, 'lead-send-order.json'), { ...journeyAnswers(fields), [sf.key]: 9 });
    if (sent.ok) c.state.second = { marker: second };
    const stored = sent.ok ? await c.impl.leadCount(second) : 0;
    if (!stored) c.state.second = null;
    if (stored !== 1) return { status: 'FAIL', evidence: `lead send did not store one lead for "${second}" (${sent.ok ? 'ok' : sent.code}, ${stored} row(s))${lead.via}` };
    const cleanSecond = async why => {
      const f = await findLead(c, second);
      if (f.rows.length) await c.impl.crm('owner-a', 'leads-bulk', { workspace: WS_A, ids: f.rows.map(x => x.id), action: 'delete', confirm: true });
      c.state.second = null;
      return { status: 'FAIL', evidence: `${why}${lead.via}; the second lead was then removed` };
    };
    for (const dir of ['asc', 'desc']) {
      const r = await c.impl.crm('owner-a', 'lead-list', { workspace: WS_A, search: c.runId, size: 200, sort: { field: sf.key, dir } });
      const got = ((r.json && r.json.rows) || []).map(x => `${x.name}=${JSON.stringify(x[sf.key])}`);
      const want = dir === 'asc' ? [`${second}=9`, `${lead.marker}=10`] : [`${lead.marker}=10`, `${second}=9`];
      if (r.status !== 200 || JSON.stringify(got) !== JSON.stringify(want)) return cleanSecond(`sort ${sf.key} ${dir} over the two leads of this run answered HTTP ${r.status}: ${got.join(', ') || '(no rows)'} (wanted ${want.join(', ')}: 9 ${dir === 'asc' ? 'before' : 'after'} 10 as numbers)`);
    }
    return { status: 'PASS', evidence: `search finds exactly 1; filter ${pick.key} eq keeps the lead and excludes "${other}"; filter ${nf.key} range keeps ${n} and excludes it above; sort ${nf.key} is typed over the ${sorted.asc} row(s) holding one; sort ${sf.key} over two leads: asc 9 before 10, desc 10 before 9 (a second lead from lead send)${lead.via}` };
  } },
  { id: 'J10', name: 'bulk', needs: ['J1', 'J9'], async run(c) {
    const lead = await feedLead(c); if (lead.fail) return lead.fail;
    const own = await ownLead(c, lead); if (own.fail) return own.fail;
    // the journey's own leads: the marker lead, and the second lead J9 made for the sort when it ran (both are removed at the end)
    let sec = null;
    if (c.state.second) { sec = await findLead(c, c.state.second.marker); if (sec.rows.length !== 1) return { status: 'FAIL', evidence: `lead-list finds ${sec.rows.length} lead(s) for the sort lead "${c.state.second.marker}" (wanted 1)${lead.via}` }; }
    const ids = [own.row.id, ...(sec ? [sec.rows[0].id] : [])], n = ids.length;
    const bulk = (action, extra = {}) => c.impl.crm('owner-a', 'leads-bulk', { workspace: WS_A, ids, action, ...extra });
    // a failed check still takes the journey's own leads away (confirmed delete), so staging keeps nothing of a run that went red
    const fail = async why => { const d = await bulk('delete', { confirm: true }); const left = await Promise.all([lead.marker, ...(sec ? [c.state.second.marker] : [])].map(m => findLead(c, m))); const gone = d.status === 200 && left.every(x => x.rows.length === 0); return { status: 'FAIL', evidence: `${why}${lead.via}; the lead${n > 1 ? 's were' : ' was'} then ${gone ? 'removed' : `NOT removed (HTTP ${d.status}, ${left.map(x => x.rows.length).join('+')} left)`}` }; };
    const now = async () => (await findLead(c, lead.marker)).rows[0] || {};
    const status = own.row.status === 'contacted' ? 'qualified' : 'contacted';
    const st = await bulk('status', { value: status });
    if (st.status !== 200 || !st.json || st.json.changed !== n) return fail(`leads-bulk status ${status} answered HTTP ${st.status} ${clip(st.text, 90)} (wanted 200 with changed ${n})`);
    if ((await now()).status !== status) return fail(`leads-bulk status ${status}: lead-list still shows "${(await now()).status}"`);
    const team = await c.impl.teamRow();
    if (!team) return fail('the test workspace has no team row to make the owner');
    const ow = await bulk('owner', { value: team });
    if (ow.status !== 200 || !ow.json || ow.json.changed !== n) return fail(`leads-bulk owner answered HTTP ${ow.status} ${clip(ow.text, 90)} (wanted 200 with changed ${n})`);
    if ((await now()).owner !== team) return fail(`leads-bulk owner: lead-list shows owner ${JSON.stringify((await now()).owner)}, not the team row`);
    const nc = await bulk('delete');
    if (nc.status !== 409 || !nc.json || nc.json.code !== 'S-CONFIRM') return fail(`delete without the confirm flag answered HTTP ${nc.status} ${clip(nc.text, 90)} (wanted 409 S-CONFIRM)`);
    const still = await Promise.all([lead.marker, ...(sec ? [c.state.second.marker] : [])].map(m => findLead(c, m)));
    if (still.some(x => x.rows.length !== 1)) return { status: 'FAIL', evidence: `a lead is gone after a delete without the confirm flag was refused (${still.map(x => x.rows.length).join('+')} left, wanted 1${sec ? '+1' : ''})${lead.via}` };
    const d = await bulk('delete', { confirm: true });
    if (d.status !== 200 || !d.json || d.json.changed !== n) return { status: 'FAIL', evidence: `delete with the confirm flag answered HTTP ${d.status} ${clip(d.text, 90)} (wanted 200 with changed ${n})${lead.via}` };
    const left = await Promise.all([lead.marker, ...(sec ? [c.state.second.marker] : [])].map(m => findLead(c, m)));
    if (left.some(x => x.status !== 200 || x.rows.length !== 0)) return { status: 'FAIL', evidence: `after the confirmed delete lead-list still finds ${left.map(x => x.rows.length).join('+')} lead(s) for the journey's ${n} lead(s) (wanted 0)${lead.via}` };
    c.state.second = null;
    return { status: 'PASS', evidence: `leads-bulk as owner-a: status ${status} and owner set (each read back), delete without confirm refused (409 S-CONFIRM, the lead still there), delete with confirm removed ${n > 1 ? 'both journey leads' : 'it'} (lead-list finds 0 of ${n > 1 ? 'either' : 'it'})${lead.via}` };
  } },
  { id: 'J11', name: 'CRM export and import', needs: ['J1'], async run(c) {
    const fields = await c.impl.crmFields();
    const nf = fields.find(f => f.type === 'number' && f.editable && f.column), pick = fields.find(f => f.type === 'enum' && f.column && f.options.length);
    if (!nf || !pick) return { status: 'FAIL', evidence: 'the form contract has no editable number column and enum column to carry through the export and the import' };
    const mark = `IO check ${c.runId}`, em = n => `io-${c.runId}-${n}@example.com`;
    const last = String(parseInt(c.runId.slice(0, 4), 16) % 1000).padStart(3, '0');   // the phones of this run: +1510555<3 digits><n>, so two runs never collide
    const ph = n => `+1510555${last}${n}`, us = n => `(510) 555-${last}${n}`;
    const slot = pick.options[Math.min(1, pick.options.length - 1)], H = { b: cap(nf.key), t: cap(pick.key) };
    const HEAD = ['First Name', 'Last Name', 'Email', 'Phone Number', H.b, H.t, 'Lead Status', 'Contact owner'];
    const call = (who, name, body) => c.impl.crm(who, name, { workspace: WS_A, ...body });
    const mine = async () => (await findLead(c, mark)).rows;
    c.state.io = true;
    // a failed check still takes this run's leads away (confirmed delete), so staging keeps nothing of a run that went red
    const fail = async why => {
      let gone = 'no lead to remove';
      const rows = await mine().catch(() => []);
      if (rows.length) { const d = await call('owner-a', 'leads-bulk', { ids: rows.map(x => x.id), action: 'delete', confirm: true }); gone = d.status === 200 ? `${rows.length} lead(s) removed` : `NOT removed (HTTP ${d.status})`; }
      return { status: 'FAIL', evidence: `${why}; ${gone}` };
    };
    const brief = r => `HTTP ${r.status} ${clip(r.text, 110)}`;
    // 1. a map proposed from a synthetic HubSpot-style file, then confirmed and saved by the owner; a member's save is refused
    const sample = csvText([HEAD, ['Jordan', `Reyes ${mark}`, em('sample'), '(510) 555-0142', '750000', slot, 'New', 'Agent One']]);
    const p = await call('owner-a', 'crm-map-propose', { csv: sample });
    const cols = (p.json && p.json.template && p.json.template.columns) || [], fieldOf = h => (cols.find(x => x.header === h) || {}).field;
    if (p.status !== 200 || fieldOf(H.b) !== `answers.${nf.key}` || fieldOf(H.t) !== `answers.${pick.key}` || fieldOf('Email') !== 'email' || fieldOf('First Name') !== 'name')
      return fail(`crm-map-propose: ${H.b} should map to answers.${nf.key}, ${H.t} to answers.${pick.key}, Email to email, First Name to name; got ${H.b} -> ${fieldOf(H.b)}, ${H.t} -> ${fieldOf(H.t)}, Email -> ${fieldOf('Email')}, First Name -> ${fieldOf('First Name')} (${brief(p)})`);
    const columns = cols.map(x => (x.field === 'phone' ? { ...x, transform: 'us' } : x));   // the client wants (xxx) xxx-xxxx
    const sv = await call('owner-a', 'crm-template-save', { name: IO_MAP, crm: 'hubspot', columns, value_maps: { status: { new: 'New', contacted: 'Attempted to Contact' } } });
    const tpl = sv.json && sv.json.template;
    if (sv.status !== 200 || typeof tpl !== 'string') return fail(`crm-template-save as owner-a answered ${brief(sv)} (wanted 200 with the map's id)`);
    const ms = await call('member-a1', 'crm-template-save', { name: IO_MAP, crm: 'hubspot', columns });
    if (ms.status !== 403) return fail(`crm-template-save as member-a1 answered HTTP ${ms.status} (wanted 403: only the owner confirms a map)`);
    // 2. two marked leads added by hand with industry answers (typed by add-lead); a bad answer is refused and nothing is stored
    for (const [n, v] of [[1, '600000'], [2, '800000']]) {
      const a = await c.impl.crm('owner-a', 'add-lead', { site: SITE_A, name: `${mark} ${n}`, email: em(n), phone: ph(n), answers: { [nf.key]: v, [pick.key]: slot }, consentText: 'Synthetic journey lead: agreed to be contacted' });
      if (a.status !== 201) return fail(`add-lead ${n} answered ${brief(a)} (wanted 201)`);
    }
    const typed = (await mine()).filter(x => typeof x[nf.key] === 'number');
    if (typed.length !== 2) return fail(`the two hand-added leads hold ${nf.key} as a number in ${typed.length} of 2 rows`);
    const bad = await c.impl.crm('owner-a', 'add-lead', { site: SITE_A, name: `${mark} bad`, email: em('bad'), answers: { [nf.key]: 'lots' }, consentText: 'Synthetic journey lead: agreed to be contacted' });
    const badPath = bad.json && (bad.json.path || (bad.json.problems && bad.json.problems[0] && bad.json.problems[0].path));
    if (![400, 422].includes(bad.status) || !bad.json || bad.json.code !== 'I-ANSWER' || badPath !== nf.key) return fail(`add-lead with ${nf.key} "lots" answered ${brief(bad)} (wanted a refusal I-ANSWER naming ${nf.key})`);
    if ((await mine()).length !== 2) return fail('the refused add-lead stored a lead anyway');
    // 3. the export in the map's layout: its header and order, the typed numbers, the phone in the map's US form
    const e = await call('owner-a', 'lead-export', { template: tpl, search: mark, sort: { field: nf.key, dir: 'asc' } });
    const out = e.status === 200 ? parseCsv(e.text) : [];
    const want = columns.map(x => x.header), bi = want.indexOf(H.b), ti = want.indexOf(H.t), pi = want.indexOf('Phone Number');
    if (e.status !== 200 || JSON.stringify(out[0] || []) !== JSON.stringify(want)) return fail(`lead-export with the map: the header is "${clip((out[0] || []).join(','), 100)}", the map's is "${clip(want.join(','), 100)}" (${brief(e)})`);
    if (out.length !== 3 || out.slice(1).map(r => r[bi]).join() !== '600000,800000' || !out.slice(1).every(r => r[ti] === slot)) return fail(`lead-export with the map: ${H.b} reads "${out.slice(1).map(r => r[bi]).join()}" (wanted 600000,800000 in the sort asked for) and ${H.t} "${out.slice(1).map(r => r[ti]).join()}" (wanted ${slot})`);
    if ((out[1] || [])[pi] !== us(1)) return fail(`lead-export with the map: the phone reads "${(out[1] || [])[pi]}", wanted the map's US form "${us(1)}"`);
    // 4. that export comes back as a dry run: 2 rows, both duplicates, nothing written
    const dry = await call('owner-a', 'lead-import', { template: tpl, file: e.text, file_name: `${mark}-export.csv` });
    if (dry.status !== 200 || !dry.json || dry.json.dry_run !== true || dry.json.rows !== 2 || dry.json.duplicates_count !== 2 || dry.json.new !== 0) return fail(`lead-import dry run of the export: ${brief(dry)} (wanted dry_run true, 2 rows, 2 duplicates, 0 new)`);
    if ((await mine()).length !== 2) return fail('the dry run wrote a lead');
    // 5. a fresh file of 3 rows (one repeats lead 1's email, one has a bad number): no tick, a bad row and a member are each refused and write nothing
    const fresh = v => csvText([HEAD, ['Ima', `${mark} 3`, em(3), us(3), '450000', slot, 'New', ''], ['Ima', `${mark} dup`, em(1).toUpperCase(), '', '', '', '', ''], ['Ima', `${mark} 4`, em(4), '', v, slot, 'Attempted to Contact', '']]);
    const real = { template: tpl, file_name: `${mark}-fresh.csv`, dry_run: false, duplicates: 'skip' };
    const noTick = await call('owner-a', 'lead-import', { ...real, file: fresh('900000') });
    if (noTick.status !== 422 || !noTick.json || noTick.json.code !== 'I-CONSENT') return fail(`lead-import without the consent tick answered ${brief(noTick)} (wanted 422 I-CONSENT)`);
    const badRow = await call('owner-a', 'lead-import', { ...real, consent: true, file: fresh('lots') });
    const bp = badRow.json && badRow.json.problems && badRow.json.problems[0];
    if (badRow.status !== 422 || !badRow.json || badRow.json.code !== 'I-IMPORT' || !bp || bp.row !== '4' || bp.path !== nf.key) return fail(`lead-import with a bad ${nf.key} on line 4 answered ${brief(badRow)} (wanted 422 I-IMPORT naming line 4 and ${nf.key})`);
    const mi = await call('member-a1', 'lead-import', { ...real, consent: true, file: fresh('900000') });
    if (mi.status !== 403) return fail(`lead-import as member-a1 answered HTTP ${mi.status} (wanted 403)`);
    if ((await mine()).length !== 2) return fail('a refused import wrote a lead');
    // 6. the fixed file with the tick: 2 leads created, the duplicate skipped; typed, form import, the consent sentence stored
    const ok = await call('owner-a', 'lead-import', { ...real, consent: true, file: fresh('900000') });
    if (ok.status !== 200 || !ok.json || ok.json.created !== 2 || ok.json.skipped !== 1) return fail(`lead-import of the fixed file answered ${brief(ok)} (wanted 200, created 2, skipped 1)`);
    const rows = await mine(), made = rows.filter(x => x.email === em(3) || x.email === em(4));
    if (rows.length !== 4 || made.length !== 2 || !made.every(x => x.form === 'import' && typeof x[nf.key] === 'number')) return fail(`after the import ${rows.length} lead(s) carry the marker (wanted 4), ${made.length} imported (wanted 2), form/typing: ${made.map(x => `${x.form}/${typeof x[nf.key]}`).join(', ')}`);
    if (!made.some(x => x.status === 'contacted')) return fail('the status "Attempted to Contact" was not read through the value map as contacted');
    const ct = await c.impl.consentTexts([em(3), em(4)]);
    if (ct.length !== 2 || !ct.every(x => String(x.consent_text).startsWith(CONSENT_START) && String(x.consent_text).includes(`${mark}-fresh.csv`) && x.sms_consent === false)) return fail(`the imported leads' consent text: ${clip(JSON.stringify(ct.map(x => x.consent_text)), 160)} (wanted the owner's sentence, the date and the file's name, and no SMS consent)`);
    // 7. this run's leads are removed
    const gone = await call('owner-a', 'leads-bulk', { ids: rows.map(x => x.id), action: 'delete', confirm: true });
    if (gone.status !== 200 || (await mine()).length !== 0) return fail(`the delete of this run's ${rows.length} leads answered HTTP ${gone.status}; ${(await mine()).length} left`);
    return { status: 'PASS', evidence: `map proposed (${H.b} and ${H.t} to the industry fields) and saved by the owner (member refused 403); add-lead types its answers and refuses "lots" (I-ANSWER); lead-export in the map's ${want.length} columns and order with typed ${H.b}, the phone in US form; import: dry run 2 rows 2 duplicates writes nothing, no tick refused (I-CONSENT), a bad line refused whole (I-IMPORT line 4 ${nf.key}), member refused 403, then 2 created 1 skipped with the consent sentence; the ${rows.length} leads of this run removed` };
  } },
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

// ---------- the clean-up: every lead this run made is gone when the run ends, whatever the steps did ----------
// After the steps (any status, a throw or a Blocked inside J10 included) the orchestrator looks for every lead whose name carries this run's id and
// deletes it with leads-bulk (confirm flag) on the run's cached session, then looks again. Nothing is done when the run made no lead.
export async function cleanupLeads(c) {
  const st = c.state, known = [st.marker, st.fallback && st.fallback.marker, st.second && st.second.marker].filter(Boolean);
  if (!(st.marker || st.fallback || st.fallbackFail || st.second || st.io)) return null;
  const mine = async () => {
    const r = await c.impl.crm('owner-a', 'lead-list', { workspace: WS_A, search: c.runId, size: 200 });
    if (r.status !== 200 || !r.json) throw new Error(`lead-list answered HTTP ${r.status}`);
    return (r.json.rows || []).filter(x => String(x.name).includes(c.runId));
  };
  try {
    const found = await mine();
    if (found.length) {
      const d = await c.impl.crm('owner-a', 'leads-bulk', { workspace: WS_A, ids: found.map(x => x.id), action: 'delete', confirm: true });
      if (d.status !== 200) throw new Error(`leads-bulk delete answered HTTP ${d.status}`);
    }
    const left = (await mine()).map(x => x.name);
    return { removed: found.length - left.length, left, error: null };
  } catch (e) { return { removed: 0, left: known, error: clip(e && e.message || e, 160) }; }
}
export const cleanupLine = k => (k.error || k.left.length
  ? `cleanup BLOCKED: ${k.left.length} journey lead(s) may be left (${k.left.join(', ') || 'none named'})${k.error ? `: ${k.error}` : ''}`
  : `cleanup: ${k.removed} journey lead(s) removed, 0 left`);

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
  return redact([...lines, ...(d.cleanup ? [cleanupLine(d.cleanup)] : []), summaryLine(d)].join('\n'), env) + '\n';
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
  // One verified session (the access token) per person per run, minted when first needed and kept for the CRM calls: every call used to mint
  // its own (about 25 links for owner-a), and a new link races the one the dashboard's Playwright sign-in is minting. The dashboard steps
  // (J3 and J6) mint their own links, so the cache is dropped when they end and the CRM steps mint after them. Refreshed after 45 minutes
  // (an access token lasts an hour); a failed mint is not kept.
  const SESSION_MS = 45 * 60 * 1000, sessions = new Map();
  const session = who => {
    const hit = sessions.get(who);
    if (hit && ctx.now() * 1000 - hit.at < SESSION_MS) return hit.token;
    const token = personToken(parseIdentity(who), { target, env: ctx.env, fetchImpl: ctx.fetch });
    sessions.set(who, { at: ctx.now() * 1000, token });
    token.catch(() => { if (sessions.get(who) && sessions.get(who).token === token) sessions.delete(who); });
    return token;
  };
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
      const token = await session(who);
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
      } finally { tmp.release(); sessions.clear(); }
    },
    launchBrowser: launch,
    fileSize: p => { try { return statSync(p).size; } catch { return 0; } },
    async leadCount(marker) {
      const r = ctx.sql().scalar(`select count(*) from leads where site_id = ${uuidLit(SITE_A)} and name = ${lit(marker)}`);
      if (!r.ok) throw new Error(`could not count the lead rows: ${clip(r.message)}`);
      return Number(r.value);
    },
    // a lead the way `omnikom lead send` makes it (signed with the test site's key, over capture-lead), with a marker name
    async sendLead(marker, file, answers = {}) {
      writeFileSync(file, JSON.stringify({ form: 'contact', flow: 'contact', page: '/journey', cta: 'journey', name: marker, email: `journey.${ctx.randomUUID().slice(0, 8)}@example.com`, phone: '(555) 010-0153',
        answers: { message: 'Sent by omnikom test journey (lead send). Synthetic. Safe to ignore.', ...answers }, consentText: 'I agree that the business may contact me about this request by email, phone or text.', marketingConsent: { given: false, text: 'marketing wording' }, hp: '' }));
      const r = await leadGroup({ ...ctx, positionals: ['lead', 'send'], warnings: [], flags: { site: SITE_A, as: 'site:test-demo-a', fixture: file, real: true, key: ctx.randomUUID() } });
      return { ok: r.ok, code: r.code, statuses: ((r.data && r.data.attempts) || []).map(a => a.status) };
    },
    async alertsOnlyTo(addr) {
      const r = ctx.sql().scalar(`select count(*) from sites where id = ${uuidLit(SITE_A)} and lead_alert_to = array[${lit(addr)}]::text[]`);
      return r.ok && Number(r.value) === 1;
    },
    async exportCsv(who, marker) {
      const token = await session(who);
      const res = await ctx.fetch(target.functionsBase.replace(/\/$/, '') + '/lead-export', { method: 'POST', headers: { 'content-type': 'application/json', apikey: pub(), authorization: `Bearer ${token}` }, body: JSON.stringify({ site: SITE_A, filter: 'all', q: marker }), signal: AbortSignal.timeout(30000) });
      return { status: res.status, text: await res.text() };
    },
    // the industry fields of the test site's form contract in form order, every one a column or not (the export writes them all): from the file the
    // site is staged from (sites/test-demo-a/contract.json) through the validator's own leadColumns, so the list is the contract's and never copied here
    async crmFields() {
      const v = await importer('contracts/validate.mjs');
      return v.leadColumns(JSON.parse(readFileSync(repoPath('sites', 'test-demo-a', 'contract.json'), 'utf8')));
    },
    // one CRM function as a signed-in person (lead-list, lead-update, leads-bulk): the same request shapes supabase/tests/e2e-crm.mjs proves
    async crm(who, name, body) {
      const token = await session(who);
      const res = await ctx.fetch(target.functionsBase.replace(/\/$/, '') + '/' + name, { method: 'POST', headers: { 'content-type': 'application/json', apikey: pub(), authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* an empty or text answer */ }
      return { status: res.status, text, json };
    },
    async editedEvents(leadId) {
      const r = ctx.sql().scalar(`select count(*) from lead_events where lead_id = ${uuidLit(leadId)} and kind = 'edited'`);
      if (!r.ok) throw new Error(`could not count the edited events: ${clip(r.message)}`);
      return Number(r.value);
    },
    // the consent text the import stored for each lead (read only; the owner's sentence, the date and the file's name)
    async consentTexts(emails) {
      const r = ctx.sql().rows(`select email, consent_text, sms_consent from public.leads where workspace_id = ${uuidLit(WS_A)} and email in (${emails.map(lit).join(', ')}) order by email`);
      if (!r.ok) throw new Error(`could not read the consent texts: ${clip(r.message)}`);
      return r.rows;
    },
    // a team member of the test workspace to make the owner of a lead (the id of its team row)
    async teamRow() {
      const r = ctx.sql().scalar(`select team_row_id from members where workspace_id = ${uuidLit(WS_A)} and team_row_id is not null order by team_row_id limit 1`);
      return r.ok && r.value ? String(r.value) : null;
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
        sessions.clear();
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
  const cleanup = await cleanupLeads(c);
  const ok = r.counts.FAIL === 0 && r.counts.BLOCKED === 0 && !(cleanup && (cleanup.error || cleanup.left.length));
  return result(ok, ok ? 'ok' : 'JOURNEY-FAILED', { target: 'staging', out, runId, ...r, cleanup });
}
