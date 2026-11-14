// Tests for tools/client-infra/offboard.mjs against in-memory fakes (no network, no database, no disk): runs in CI.
//   node tools/client-infra/test/offboard-run.mjs     exit 0 = every case passed; lines "ok  " / "FAIL".
// OFFBOARD_LIB=<path to an offboard.mjs copy> runs the same cases against that copy (test/offboard-mutate.mjs uses it).
// OFFBOARD_PROOF=<path to a proof-offboard.mjs copy> is read by the one case that checks that file's source (the mutants break a copy of it).
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newWorld, offboardFakeDeps, WS, OTHER_WS, TICKET } from './offboard-fakes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = process.env.OFFBOARD_LIB ? resolve(process.env.OFFBOARD_LIB) : join(HERE, '..', 'offboard.mjs');
const { offboard, precheck, loadMarked, subjectKey, hasSubject, parseArgs, insideGit, contentHash, REPO, Refused } = await import(pathToFileURL(LIB).href);

const OUT = resolve(tmpdir(), 'offboard-test-out');
// a repository root of its own: offboard-mutate.mjs runs a copy of offboard.mjs from a temp folder, whose REPO would hold OUT
const FAKE_REPO = resolve(tmpdir(), 'offboard-test-repo');
const MARKED = [{ slug: 'test-wo37', ruling: 'test ruling' }];
const PROOF = process.env.OFFBOARD_PROOF ? resolve(process.env.OFFBOARD_PROOF) : join(HERE, '..', 'proof-offboard.mjs');
const EXPORT = join(OUT, 'test-wo37', 'export.json');
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 500)}`); };
const run = async (w, o = {}) => {
  const lines = []; let r = null, err = null;
  try { r = await offboard({ slug: 'test-wo37', outDir: OUT, erase: TICKET, teardown: true, marked: MARKED, insideGit: false, ...o }, offboardFakeDeps(w, lines)); } catch (e) { err = e; }
  return { r, err, text: lines.join('\n') };
};
const exported = (w) => JSON.parse(w.files.get(EXPORT).toString('utf8'));
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('full run: offboarding, the person erased and the ticket done, teardown, export without the person', async () => {
  const w = newWorld();
  const a = await run(w);
  const tk = w.tickets[0], ex = w.files.has(EXPORT) ? exported(w) : null;
  const ok = !a.err && a.r.failed.length === 0 && w.ws.state === 'offboarding' && w.ws.state_reason === 'test ruling' && tk.state === 'done'
    && !w.leads.some((l) => l.id === 'lead-1') && w.leads.some((l) => l.id === 'lead-2') && w.leads.some((l) => l.id === 'lead-x')
    && !w.projects['test-site-wo37'] && w.sites[0].domain === null && w.keys[0].revoked && w.audit.some((x) => x.action === 'pages-project-delete')
    && ex && ex.schema === 'omnikom-workspace-export/1' && JSON.stringify(ex).includes('keep-me@example.com') && !JSON.stringify({ ...ex, tables: { ...ex.tables, privacy_requests: [] } }).toLowerCase().includes('erase-me@example.com')
    && ex.tables.privacy_requests.length === 1
    && ex.files.length === 1 && ex.files[0].path === 'logo.png' && w.files.has(join(OUT, 'test-wo37', 'files', 'logo.png'))
    && ex.tables.api_keys.every((k) => k.revoked) && ex.tables.sites[0].domain === null && /RESULT: changed \d+/.test(a.text) && a.r.changed >= 8;
  return [ok, a.err ? a.err.stack : a.text];
});

t('second run changes nothing: no write anywhere, the export is current', async () => {
  const w = newWorld();
  await run(w);
  const before = w.writes.length, file = w.files.get(EXPORT).toString('utf8');
  const b = await run(w);
  return [!b.err && b.r.changed === 0 && b.r.failed.length === 0 && w.writes.length === before && w.files.get(EXPORT).toString('utf8') === file
    && /RESULT: changed 0$/m.test(b.text) && /is current/.test(b.text) && /privacy request .* done; the person is found nowhere/.test(b.text), b.err ? b.err.stack : b.text];
});

t('dry run writes nothing and says what it would do', async () => {
  const w = newWorld();
  const a = await run(w, { dryRun: true });
  return [!a.err && w.writes.length === 0 && w.ws.state === 'active' && w.tickets[0].state === 'received' && w.projects['test-site-wo37']
    && /would {2}set test-wo37 active -> offboarding/.test(a.text) && /would {2}delete 1 lead/.test(a.text) && /would {2}detach custom domain wo37-test.example.com/.test(a.text)
    && /would {2}revoke signing key/.test(a.text) && /would {2}delete Pages project test-site-wo37/.test(a.text) && /would {2}export/.test(a.text) && /DRY RUN: changed 0/.test(a.text), a.err ? a.err.stack : a.text];
});

t('a workspace not marked for offboarding is refused before any call', async () => {
  const w = newWorld();
  const lines = []; let err = null;
  const trap = new Proxy({}, { get: () => { throw new Error('a dependency was called'); } });
  try { await offboard({ slug: 'test-wo36', outDir: OUT, marked: MARKED, insideGit: false }, { db: trap, storage: trap, cf: trap, fs: trap, log: (l) => lines.push(l) }); } catch (e) { err = e; }
  return [err instanceof Refused && /not marked for offboarding/.test(err.message) && w.writes.length === 0, err ? err.message : 'no refusal'];
});

t('an out folder inside a git checkout, a missing out folder, or a bad request id is refused', async () => {
  const r = [];
  for (const o of [{ insideGit: true }, { outDir: '' }, { erase: 'not-a-uuid' }, { slug: 'Bad Slug' }]) {
    try { precheck({ slug: 'test-wo37', outDir: OUT, marked: MARKED, insideGit: false, erase: null, ...o }); r.push('passed'); } catch (e) { r.push(e instanceof Refused ? 'refused' : e.message); }
  }
  return [r.every((x) => x === 'refused') && insideGit(join(FAKE_REPO, 'x', 'y'), () => null, FAKE_REPO) === true && insideGit(OUT, () => null, FAKE_REPO) === false
    && insideGit(OUT, () => 'C:/somewhere', FAKE_REPO) === true && typeof REPO === 'string', r.join(',')];
});

t('a person still found after the deletes: the request stays in-progress, no export', async () => {
  const w = newWorld();
  w.residue.push({ table: 'messages', text: '{"to_text":"ERASE-ME@example.com"}' });
  const a = await run(w);
  return [!a.err && a.r.failed.includes('erasure') && w.tickets[0].state === 'in-progress' && !w.files.has(EXPORT) && /messages 1/.test(a.text) && /skip {3}the export/.test(a.text), a.err ? a.err.stack : a.text];
});

t('a done request whose person is found again is a failure', async () => {
  const w = newWorld();
  await run(w);
  w.leads.push({ id: 'lead-9', ws: WS, name: 'Back', email: 'erase-me@example.com', phone: null });
  const b = await run(w);
  return [!b.err && b.r.failed.includes('erasure') && /done but the person is still found: 1 lead/.test(b.text), b.err ? b.err.stack : b.text];
});

t('requests: another workspace\'s, not a delete, or refused are refused', async () => {
  const r = [];
  for (const patch of [{ workspace_id: OTHER_WS }, { kind: 'access' }, { state: 'refused' }, { subject: 'no address' }]) {
    const w = newWorld(); Object.assign(w.tickets[0], patch);
    const a = await run(w);
    r.push(a.err instanceof Refused && w.writes.filter((x) => !x.startsWith('state')).length === 0 ? 'refused' : (a.err ? a.err.message : 'ran'));
  }
  return [r.every((x) => x === 'refused'), r.join(' | ')];
});

t('a trial or deleted workspace is refused; one already offboarding is fine', async () => {
  const r = [];
  for (const st of ['trial', 'deleted']) { const w = newWorld(); w.ws.state = st; const a = await run(w); r.push(a.err instanceof Refused && w.writes.length === 0); }
  const w = newWorld(); w.ws.state = 'offboarding';
  const a = await run(w);
  return [r.every(Boolean) && !a.err && !w.writes.includes('state offboarding') && /ok {5}test-wo37 is offboarding/.test(a.text), a.err ? a.err.message : a.text];
});

t('the staff identity missing from public.staff fails before any write', async () => {
  const w = newWorld(); w.staff = false;
  const a = await run(w);
  return [a.err && !(a.err instanceof Refused) && w.writes.length === 0, a.err ? a.err.message : 'ran'];
});

t('an export that still holds the person (the scan missed a table) fails', async () => {
  const w = newWorld(); w.scanBlind = true;
  w.residue.push({ table: 'messages', text: '{"to_text":"erase-me@example.com"}' });
  const a = await run(w);
  return [!a.err && a.r.failed.includes('export') && /still holds the erased person outside privacy_requests/.test(a.text), a.err ? a.err.stack : a.text];
});

t('an export short of the table\'s count fails and writes no export file', async () => {
  const w = newWorld(); w.countLie = 'leads';
  const a = await run(w);
  return [!a.err && a.r.failed.includes('export') && !w.files.has(EXPORT) && /leads \(1 of 2\)/.test(a.text), a.err ? a.err.stack : a.text];
});

t('Storage: a size that differs, or a path that climbs out, fails', async () => {
  const w = newWorld(); w.sizeLie = true;
  const a = await run(w);
  const w2 = newWorld(); w2.objects.push({ name: `${WS}/../escape.txt`, body: Buffer.from('x') });
  const b = await run(w2);
  return [a.r && a.r.failed.includes('export') && /Storage says/.test(a.text) && b.r && b.r.failed.includes('export') && /not a plain path/.test(b.text)
    && ![...w2.files.keys()].some((k) => k.includes('escape')), a.text + '\n--\n' + b.text];
});

t('teardown: a key still active after the revoke fails; without --teardown nothing is taken down', async () => {
  const w = newWorld(); w.keyStaysActive = true;
  const a = await run(w);
  const w2 = newWorld();
  const b = await run(w2, { teardown: false });
  return [a.r.failed.includes('teardown') && /still has an active signing key/.test(a.text) && w2.projects['test-site-wo37'] && !w2.keys[0].revoked && w2.sites[0].domain
    && !w2.writes.some((x) => /detach|revoke|delete project|clear domain/.test(x)) && /skip {3}teardown \(runs with --teardown\)/.test(b.text), a.text + '\n--\n' + b.text];
});

t('a number as the subject: matched by its digits, in any layout', async () => {
  const w = newWorld(); w.tickets[0].subject = '+1 555 555 0137'; w.tickets[0].lead_ids = [];
  const a = await run(w);
  const k = subjectKey('+1 (555) 555-0137');
  return [!a.err && a.r.failed.length === 0 && !w.leads.some((l) => l.id === 'lead-1') && w.leads.some((l) => l.id === 'lead-2')
    && hasSubject('call 1-555-555-0137 now', k) && hasSubject('(555) 555-0137', subjectKey('+1 555 555 0137')) && !hasSubject('15555550138', k) && subjectKey('12345') === null && subjectKey(' A@B.co ').email === 'a@b.co', a.err ? a.err.stack : a.text];
});

t('--delete: the files deleted through Storage after the export, then deleted; a second run changes nothing', async () => {
  const w = newWorld();
  const a = await run(w, { del: true });
  const ex = w.files.has(EXPORT) ? exported(w) : null;
  const before = w.writes.length;
  const b = await run(w, { del: true });
  const order = w.writes.indexOf(`file ${EXPORT}`) >= 0 && w.writes.indexOf(`file ${EXPORT}`) < w.writes.indexOf('storage remove 1');
  return [!a.err && a.r.failed.length === 0 && w.ws.state === 'deleted' && w.objects.length === 0 && ex && ex.files.length === 1 && order
    && w.files.has(join(OUT, 'test-wo37', 'files', 'logo.png')) && /done {3}set test-wo37 offboarding -> deleted/.test(a.text)
    && !b.err && b.r.changed === 0 && b.r.failed.length === 0 && w.writes.length === before && /is the export made before the deletion/.test(b.text), (a.err ? a.err.stack : a.text) + '\n--\n' + (b.err ? b.err.stack : b.text)];
});

t('--delete: refused without --teardown; files that stay keep the state offboarding; a failed step deletes nothing; dry run writes nothing', async () => {
  let noTear = false; try { precheck({ slug: 'test-wo37', outDir: OUT, marked: MARKED, insideGit: false, del: true }); } catch (e) { noTear = e instanceof Refused; }
  const w = newWorld(); w.storageStays = true;
  const a = await run(w, { del: true });
  const w2 = newWorld(); w2.countLie = 'leads';
  const b = await run(w2, { del: true });
  const w3 = newWorld();
  const c = await run(w3, { del: true, dryRun: true });
  const w4 = newWorld(); w4.ws.state = 'deleted';
  const e = await run(w4, { del: true });
  return [noTear && a.r.failed.includes('delete') && w.ws.state === 'offboarding' && /still there after the delete/.test(a.text)
    && w2.objects.length === 1 && w2.ws.state === 'offboarding' && /skip {3}the deletion/.test(b.text)
    && w3.writes.length === 0 && /would {2}delete the Storage file\(s\) of test-wo37, then set it offboarding -> deleted/.test(c.text)
    && e.r && e.r.failed.includes('export') && /is deleted but .* is not its export/.test(e.text), [a.text, b.text, c.text, e.text].join('\n--\n')];
});

const WINDOW_REASON = /^tools\/client-infra\/offboard\.mjs (setState|setTicket|deleteLead|offboardingStorage)$/;
t('staff windows (migration 43): each staff call runs inside a window of 1 minute of its own, named for the tool, closed after', async () => {
  const w = newWorld();
  const a = await run(w, { del: true });
  const names = w.windows.map((x) => x.reason.split(' ')[1]).join(',');
  return [!a.err && a.r.failed.length === 0 && w.ws.state === 'deleted'
    && names === 'setState,setTicket,deleteLead,setTicket,offboardingStorage,offboardingStorage,setState'
    && w.windows.every((x) => x.minutes === 1 && !x.open && WINDOW_REASON.test(x.reason)), (a.err ? a.err.stack : a.text) + '\n' + JSON.stringify(w.windows)];
});
t('staff windows: a staff call that fails still closes its window, and the run stops there', async () => {
  const w = newWorld(); w.failCall = 'deleteLead';
  const a = await run(w);
  return [a.err && /S-TEST: deleteLead failed/.test(a.err.message) && w.windows.length === 3 && w.windows.every((x) => !x.open) && w.leads.some((l) => l.id === 'lead-1'), a.err ? a.err.message : 'ran'];
});
t('staff windows: a dry run opens one window, for the Storage list of --delete, and writes nothing else', async () => {
  const w = newWorld(); w.ws.state = 'offboarding';
  const a = await run(w, { del: true, dryRun: true });
  return [!a.err && w.writes.length === 0 && w.windows.length === 1 && /offboardingStorage$/.test(w.windows[0].reason) && !w.windows[0].open && /DRY RUN: changed 0/.test(a.text), a.err ? a.err.stack : a.text];
});
t('proof-offboard.mjs: each staff call goes through staffPsql, which opens a window and closes it (a source check: that tool has no test of its own)', async () => {
  const src = readFileSync(PROOF, 'utf8');
  const calls = src.split('\n').filter((l) => /service\.(add_lead|lead_update|open_privacy_request)\(/.test(l));
  const bare = calls.filter((l) => !l.includes('staffPsql('));
  return [calls.length === 4 && bare.length === 0 && /service\.staff_open\(/.test(src) && /update public\.staff_access set until = now\(\)/.test(src), `${calls.length} calls, ${bare.length} outside staffPsql`];
});
t('rulings, arguments and the content hash', async () => {
  const d = mkdtempSync(join(tmpdir(), 'offboard-'));
  try {
    const f = join(d, 'm.json');
    writeFileSync(f, JSON.stringify({ workspaces: [{ slug: 'a', until: '2026-11-13', ruling: 'r' }, { slug: 'b', until: '2026-11-01', ruling: 'r' }, { slug: 'c', until: '2099-01-01' }, { slug: 'Bad', until: '2099-01-01', ruling: 'r' }] }));
    const l = loadMarked(f, '2026-11-10');
    let prod = false; try { parseArgs(['--workspace', 'a', '--out', 'x', '--target', 'production']); } catch (e) { prod = e instanceof Refused; }
    let none = false; try { parseArgs(['--workspace', 'a']); } catch (e) { none = e instanceof Refused; }
    const p = parseArgs(['--workspace', 'a', '--out', 'rel', '--teardown', '--dry-run', '--erase', TICKET, '--delete']);
    return [l.length === 1 && l[0].slug === 'a' && prod && none && p.teardown && p.dryRun && p.del && p.erase === TICKET && resolve(p.outDir) === p.outDir
      && contentHash({ a: 1, b: { c: 2, d: 3 } }) === contentHash({ b: { d: 3, c: 2 }, a: 1 }), JSON.stringify(l)];
  } finally { rmSync(d, { recursive: true, force: true }); }
});

for (const [name, fn] of cases) {
  let ok = false, detail = '';
  try { [ok, detail] = await fn(); } catch (e) { detail = e.stack; }
  check(name, ok, detail);
}
console.log(`${failed ? 'FAIL' : 'PASS'} offboard tests: ${total - failed} of ${total}`);
process.exit(failed ? 1 : 0);
