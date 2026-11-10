// Tests for tools/client-infra/onboard.mjs against in-memory fakes (no network, no database): runs in CI.
//   node tools/client-infra/test/onboard-run.mjs     exit 0 = every case passed; lines "ok  " / "FAIL".
// ONBOARD_LIB=<path to an onboard.mjs copy> runs the same cases against that copy (test/onboard-mutate.mjs uses it).
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newWorld, onboardFakeDeps } from './onboard-fakes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = process.env.ONBOARD_LIB ? resolve(process.env.ONBOARD_LIB) : join(HERE, '..', 'onboard.mjs');
const { onboard, checkIntake, loadInboxes, hashEmail, parseArgs, slugify, Refused } = await import(pathToFileURL(LIB).href);

const INBOX = 'inbox-test@example.com';
// absolute: test/onboard-mutate.mjs runs a copy of onboard.mjs from a temp folder, where a repository-relative path would not resolve
const CONTRACT = join(HERE, '..', '..', '..', 'contracts', 'industry-run', 'contracts', 'real-estate.json');
const intake = () => ({
  intakeVersion: 1,
  workspace: { slug: 'test-wo36', name: 'WO36 Test Realty', industry: 'real-estate' },
  site: { deployTarget: 'test-site-wo36', previewHost: 'preview.test-site-wo36.pages.dev' },
  contract: { file: CONTRACT },
  settings: { businessName: 'WO36 Test Realty', phone: '(555) 555-0136', email: 'office@example.com', address: { street: '36 Test Way', city: 'Testville', region: 'ST', postalCode: '00036' } },
  owner: { name: 'Test Owner', email: INBOX, teamRole: 'Owner' },
});
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 400)}`); };
const run = async (w, o = {}) => {
  const lines = []; let r = null, err = null;
  try { r = await onboard({ intake: intake(), inboxes: [hashEmail(INBOX)], ...o }, onboardFakeDeps(w, lines)); } catch (e) { err = e; }
  return { r, err, text: lines.join('\n') };
};
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('new client: workspace, details, owner profile, one invite linked to the profile, provision', async () => {
  const w = newWorld();
  const a = await run(w);
  const team = w.rows.find((r) => r.coll === 'team');
  const ok = !a.err && w.workspaces.length === 1 && w.rows.filter((r) => r.coll === 'settings').length === 1 && team && team.data.slug === 'test-owner' && team.data.role === 'Owner'
    && w.mails.length === 1 && w.mails[0] === INBOX && w.members[0].role === 'owner' && w.members[0].teamRow === team.id && w.provisioned['test-site-wo36']
    && w.rows.find((r) => r.coll === 'settings').data.address.city === 'Testville' && /RESULT: changed 8$/m.test(a.text) && a.r.waiting.length === 0;
  return [ok, a.err ? a.err.message : a.text];
});

t('second run changes nothing and sends no second mail', async () => {
  const w = newWorld(); await run(w); w.writes = [];
  const b = await run(w);
  return [!b.err && w.writes.length === 0 && w.mails.length === 1 && /RESULT: changed 0$/m.test(b.text) && /ok     .* is an owner of test-wo36 \(no mail sent\)/.test(b.text)
    && /^ok     business details$/m.test(b.text) && !/^note/m.test(b.text), b.err ? b.err.message : b.text];
});

t('dry run writes nothing, sends no mail, names each call', async () => {
  const w = newWorld();
  const a = await run(w, { dryRun: true });
  return [!a.err && w.writes.length === 0 && w.mails.length === 0 && /would  seed workspace test-wo36/.test(a.text) && /would  create the business details row/.test(a.text)
    && /would  create the owner's team profile test-owner/.test(a.text) && /would  invite inbox-test@example\.com as owner .*ONE real mail/.test(a.text) && /would  provision test-site-wo36/.test(a.text) && /DRY RUN: changed 0$/m.test(a.text), a.err ? a.err.message : a.text];
});

t('details the client edited are not overwritten: a note, no write', async () => {
  const w = newWorld(); await run(w);
  w.rows.find((r) => r.coll === 'settings').data.phone = '(555) 555-9999'; w.writes = [];
  const b = await run(w);
  return [!b.err && w.writes.length === 0 && /note   business details exist and differ from the intake in phone: not overwritten/.test(b.text) && w.rows.find((r) => r.coll === 'settings').data.phone === '(555) 555-9999', b.err ? b.err.message : b.text];
});

t('a member who is not an owner is left alone: a note, no mail', async () => {
  const w = newWorld(); await run(w, { dryRun: false });
  w.members[0].role = 'member'; w.writes = []; w.mails = [];
  const b = await run(w);
  return [!b.err && w.mails.length === 0 && w.writes.length === 0 && /note   inbox-test@example\.com is a member of test-wo36, not an owner/.test(b.text), b.err ? b.err.message : b.text];
});

t('Auth did not send the mail: the run says WAIT and exits waiting', async () => {
  const w = newWorld(); w.inviteAnswer.emailSent = false;
  const a = await run(w);
  return [!a.err && a.r.waiting.includes('mail') && /WAIT   Auth did not send the invite mail/.test(a.text), a.err ? a.err.message : a.text];
});

t('invite refused by the function: the run fails', async () => {
  const w = newWorld(); w.inviteAnswer.status = 404;
  const a = await run(w);
  return [a.err && /invite-member answered 404/.test(a.err.message), a.err ? a.err.message : a.text];
});

t('provision failing makes the run fail', async () => {
  const w = newWorld(); w.provisionExit = 1;
  const a = await run(w);
  return [!a.err && a.r.failed.includes('provision'), a.err ? a.err.message : a.text];
});

t('half-filled intake: refused, every missing field named, nothing written', async () => {
  const w = newWorld();
  const j = intake(); delete j.owner.email; delete j.settings.phone; j.workspace.name = ''; j.site.deployTarget = 'Bad Name'; delete j.contract;
  const lines = []; let err = null;
  try { await onboard({ intake: j, inboxes: [hashEmail(INBOX)] }, onboardFakeDeps(w, lines)); } catch (e) { err = e; }
  const m = err ? err.message : '';
  return [err instanceof Refused && w.writes.length === 0 && w.mails.length === 0 && /\(5\)/.test(m) && /owner\.email: missing/.test(m) && /settings\.phone: missing/.test(m)
    && /workspace\.name: missing/.test(m) && /site\.deployTarget: expected a Pages project name/.test(m) && /contract\.file: missing/.test(m), m || lines.join('\n')];
});

t('an owner address that is not a test inbox is refused before anything happens', async () => {
  const w = newWorld();
  const a = await run(w, { inboxes: [hashEmail('someone-else@example.com'), INBOX] });   // a plain address in the list never counts
  return [a.err instanceof Refused && /not in test-inboxes\.json/.test(a.err.message) && w.writes.length === 0 && w.mails.length === 0, a.err ? a.err.message : a.text];
});

t('a workspace whose site differs from the intake is refused', async () => {
  const w = newWorld(); await run(w);
  w.workspaces[0].deploy_target = 'test-site-other'; w.writes = []; w.mails = [];
  const a = await run(w);
  return [a.err instanceof Refused && /has site test-site-other/.test(a.err.message) && w.writes.length === 0, a.err ? a.err.message : a.text];
});

t('intake checks: types, contract file exists, address parts, optional domain', async () => {
  const ok = checkIntake(intake()).length === 0
    && checkIntake({ ...intake(), contract: { file: 'contracts/industry-run/contracts/real-estate.json' } }, { repo: join(HERE, '..', '..', '..') }).length === 0;
  const j = intake(); j.intakeVersion = 2; j.owner.email = 'not-an-email'; j.contract.file = 'contracts/nope.json'; j.settings.address = { street: '1' }; j.site.domain = 'bad host';
  const p = checkIntake(j);
  const want = ['intakeVersion: expected 1', 'owner.email: expected an email address', 'contract.file: expected an existing file', 'settings.address.city: missing', 'site.domain: expected a hostname'];
  return [ok && want.every((x) => p.some((y) => y.startsWith(x))) && checkIntake(null).length === 1 && checkIntake([]).length === 1, p.join(' | ')];
});

t('inboxes: expired or malformed entries ignored; slugify; arguments', async () => {
  const d = mkdtempSync(join(tmpdir(), 'onboard-'));
  try {
    const f = join(d, 'i.json');
    const h = (e) => hashEmail(e);
    writeFileSync(f, JSON.stringify({ inboxes: [{ sha256: h('A@example.com'), until: '2026-11-12' }, { sha256: h('b@example.com'), until: '2026-11-01' }, { sha256: 'nope', until: '2099-01-01' },
      { sha256: h('c@example.com') }, { email: 'plain@example.com', until: '2099-01-01' }] }));
    const l = loadInboxes(f, '2026-11-10');
    let prod = false; try { parseArgs(['--intake', 'x', '--target', 'production']); } catch (e) { prod = e instanceof Refused; }
    let none = false; try { parseArgs([]); } catch (e) { none = e instanceof Refused; }
    return [l.length === 1 && l[0] === hashEmail('a@example.com') && hashEmail(' A@Example.com ') === l[0] && !l.includes('plain@example.com') && slugify('  José O\'Neil ') === 'jose-o-neil' && prod && none && parseArgs(['--intake', 'x', '--dry-run']).dryRun, JSON.stringify(l)];
  } finally { rmSync(d, { recursive: true, force: true }); }
});

t('--no-invite: everything else is made, no login and no mail, and the owner need not be a test inbox', async () => {
  const w = newWorld();
  const intakeOther = { ...intake(), owner: { name: 'Test Owner', email: 'owner@test-wo37.example.com', teamRole: 'Owner' } };
  const lines = []; let err = null;
  try { await onboard({ intake: intakeOther, inboxes: [hashEmail(INBOX)], noInvite: true }, onboardFakeDeps(w, lines)); } catch (e) { err = e; }
  const text = lines.join('\n');
  return [!err && w.mails.length === 0 && w.members.length === 0 && w.workspaces.length === 1 && w.provisioned['test-site-wo36'] && /skip {3}invite .*--no-invite/.test(text)
    && parseArgs(['--intake', 'x', '--no-invite']).noInvite === true, err ? err.message : text];
});

for (const [name, fn] of cases) {
  let ok = false, detail = '';
  try { [ok, detail] = await fn(); } catch (e) { detail = e.stack; }
  check(name, ok, detail);
}
console.log(`${failed ? 'FAIL' : 'PASS'} onboard tests: ${total - failed} of ${total}`);
process.exit(failed ? 1 : 0);
