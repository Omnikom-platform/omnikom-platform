// Tests for tools/client-infra/provision.mjs against the in-memory fakes (no network, no database): runs in CI.
//   node tools/client-infra/test/run.mjs     exit 0 = every case passed; lines "ok  " / "FAIL".
// CLIENT_INFRA_LIB=<path to a provision.mjs copy> runs the same cases against that copy (test/mutate.mjs uses it).
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newState, addSite, addKey, fakeDeps } from './fakes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = process.env.CLIENT_INFRA_LIB ? resolve(process.env.CLIENT_INFRA_LIB) : join(HERE, '..', 'provision.mjs');
const { provision, parseArgs, loadAllowed, Refused } = await import(pathToFileURL(LIB).href);

const BASE = 'https://staging-ref.supabase.co/functions/v1';
const HOST = 'wo35-test.omnikom.io';
const ALLOWED = [{ host: HOST, zone: 'omnikom.io' }];
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 400)}`); };
const run = async (s, o = {}) => {
  const lines = [];
  let r = null, err = null;
  try { r = await provision({ site: 'test-site-wo35', platformBase: BASE, allowed: ALLOWED, ...o }, fakeDeps(s, lines)); } catch (e) { err = e; }
  return { r, err, lines, text: lines.join('\n') };
};
const vars = (s, env) => s.projects['test-site-wo35'].deployment_configs[env].env_vars;
const snapshot = (s) => JSON.stringify({ ...s, writes: [] });
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('fresh site: project, key, both environments set; value only in Vault and the Pages secret', async () => {
  const s = newState(); const site = addSite(s);
  const a = await run(s);
  const ref = s.keys[0] && s.keys[0].vault_ref;
  const ok = !a.err && s.projects['test-site-wo35'] && s.keys.length === 1 && ref === 'site-test-wo35-key-1'
    && ['preview', 'production'].every((e) => vars(s, e).SITE_ID.value === site.id && vars(s, e).PLATFORM_BASE.value === BASE
      && vars(s, e).SITE_SIGNING_KEY_REF.value === ref && vars(s, e).SITE_SIGNING_KEY.type === 'secret_text'
      && s.secretValues[`test-site-wo35/${e}/SITE_SIGNING_KEY`] === s.vault[ref])
    && !a.text.includes(s.vault[ref]) && /RESULT: changed 4/.test(a.text);
  return [ok, a.err ? a.err.message : a.text];
});

t('second run changes nothing and writes nothing', async () => {
  const s = newState(); addSite(s);
  await run(s); s.writes = [];
  const b = await run(s);
  return [!b.err && s.writes.length === 0 && /RESULT: changed 0$/m.test(b.text) && !/would|done/.test(b.text), b.err ? b.err.message : b.text + '\nwrites: ' + s.writes.join(', ')];
});

t('dry run on a fresh site writes nothing and names each call', async () => {
  const s = newState(); addSite(s);
  const before = snapshot(s);
  const a = await run(s, { dryRun: true });
  const ok = !a.err && s.writes.length === 0 && snapshot(s) === before && /would  create Pages project .*\[POST \/accounts\/\[account\]\/pages\/projects\]/.test(a.text)
    && /would  mint a signing key/.test(a.text) && /would  set preview .*\[PATCH /.test(a.text) && /would  set production /.test(a.text) && /DRY RUN: changed 0/.test(a.text);
  return [ok, a.err ? a.err.message : a.text];
});

t('existing key, Pages lacks it: the Vault value is set, no new key minted', async () => {
  const s = newState(); const site = addSite(s); const ref = addKey(s, site, 1);
  const a = await run(s);
  return [!a.err && s.keys.length === 1 && !s.writes.includes('db.mintKey') && s.secretValues['test-site-wo35/preview/SITE_SIGNING_KEY'] === s.vault[ref]
    && s.secretValues['test-site-wo35/production/SITE_SIGNING_KEY'] === s.vault[ref], a.err ? a.err.message : a.text];
});

t('rotation: a newer active key replaces the Pages secret on the next run', async () => {
  const s = newState(); const site = addSite(s);
  await run(s);
  const ref2 = addKey(s, site, 2); s.writes = [];
  const a = await run(s);
  return [!a.err && vars(s, 'preview').SITE_SIGNING_KEY_REF.value === ref2 && s.secretValues['test-site-wo35/production/SITE_SIGNING_KEY'] === s.vault[ref2]
    && !s.writes.includes('db.mintKey'), a.err ? a.err.message : a.text];
});

t('domain with --write-dns: sites.domain, custom domain, one CNAME, TLS active; second run changes nothing', async () => {
  const s = newState(); addSite(s);
  const a = await run(s, { domain: HOST, writeDns: true, tlsWaitMs: 60000 });
  const cname = s.zones['omnikom.io'].filter((r) => r.name === HOST);
  const ok1 = !a.err && s.sites[0].domain === HOST && s.projects['test-site-wo35'].domains.length === 1
    && cname.length === 1 && cname[0].content === 'test-site-wo35.pages.dev' && cname[0].proxied === true && /ok     TLS wo35-test\.omnikom\.io: domain active/.test(a.text)
    && a.r.waiting.length === 0 && s.zones['omnikom.io'].length === 2;
  s.writes = [];
  const b = await run(s, { domain: HOST, writeDns: true });
  return [ok1 && !b.err && s.writes.length === 0 && /RESULT: changed 0$/m.test(b.text), (a.err ? a.err.message : a.text) + '\n---\n' + b.text];
});

t('domain without --write-dns: waits on the owner with the exact record, writes no DNS', async () => {
  const s = newState(); addSite(s);
  const a = await run(s, { domain: HOST });
  return [!a.err && !s.writes.includes('cf.createCname') && a.r.waiting.includes('dns') && /WAIT   DNS record to add \(the owner's click\): CNAME wo35-test\.omnikom\.io -> test-site-wo35\.pages\.dev \(proxied\)/.test(a.text), a.err ? a.err.message : a.text];
});

t('a different record on the host is never overwritten', async () => {
  const s = newState(); addSite(s);
  s.zones['omnikom.io'].push({ id: 'r-x', type: 'A', name: HOST, content: '192.0.2.9', proxied: false });
  const a = await run(s, { domain: HOST, writeDns: true });
  return [!a.err && !s.writes.includes('cf.createCname') && a.r.failed.includes('dns') && s.zones['omnikom.io'].filter((r) => r.name === HOST).length === 1, a.err ? a.err.message : a.text];
});

const refusal = (name, prep, o, re) => t(`refused, nothing written: ${name}`, async () => {
  const s = newState(); prep(s);
  const before = snapshot(s);
  const a = await run(s, o);
  return [a.err instanceof Refused && re.test(a.err.message) && s.writes.length === 0 && snapshot(s) === before, a.err ? a.err.message : a.text];
});
refusal('a domain not in the allow-list (omnikom.io itself)', (s) => addSite(s), { domain: 'omnikom.io', writeDns: true }, /not in dns-allowed\.json/);
refusal('a real client domain', (s) => addSite(s), { domain: 'www.rwifinancial.com' }, /not in dns-allowed\.json/);
refusal('a domain another site holds', (s) => { addSite(s); addSite(s, { target: 'test-site-other', slug: 'other', domain: 'WO35-test.omnikom.io' }); }, { domain: HOST }, /already belongs to site test-site-other/);
refusal('a site that already has another domain', (s) => addSite(s, { domain: 'old.example.com' }), { domain: HOST }, /already has domain old\.example\.com/);
refusal('no sites row', () => {}, {}, /no sites row/);
refusal('--write-dns without a domain', (s) => addSite(s), { writeDns: true }, /needs --domain/);
refusal('no PLATFORM_FUNCTIONS_BASE', (s) => addSite(s), { platformBase: '' }, /PLATFORM_FUNCTIONS_BASE/);

t('a settings write that drops other variables is caught', async () => {
  const s = newState(); addSite(s);
  await run(s);
  s.projects['test-site-wo35'].deployment_configs.preview.env_vars.OTHER = { type: 'plain_text', value: 'x' };
  s.projects['test-site-wo35'].deployment_configs.preview.env_vars.PLATFORM_BASE.value = 'https://old.example.com';
  s.patchMode = 'replace';
  const a = await run(s);
  return [a.err && /preview settings did not read back: lost .*OTHER/.test(a.err.message), a.err ? a.err.message : a.text];
});

t('arguments: production refused, unknown flag refused, staging default', async () => {
  const bad = (argv, re) => { try { parseArgs(argv); return false; } catch (e) { return e instanceof Refused && re.test(e.message); } };
  const o = parseArgs(['--site', 'x', '--dry-run', '--tls-wait-min', '5']);
  return [bad(['--site', 'x', '--target', 'production'], /only staging/) && bad(['--site', 'x', '--force'], /unknown argument/) && bad(['--tls-wait-min', '99'], /0 to 60/)
    && o.target === 'staging' && o.dryRun && o.tlsWaitMs === 300000, JSON.stringify(o)];
});

t('allow-list: expired entries and hosts outside their zone are ignored', async () => {
  const d = mkdtempSync(join(tmpdir(), 'client-infra-'));
  try {
    const f = join(d, 'a.json');
    writeFileSync(f, JSON.stringify({ hosts: [{ host: 'a.omnikom.io', zone: 'omnikom.io', until: '2026-11-12' }, { host: 'b.omnikom.io', zone: 'omnikom.io', until: '2026-11-09' },
      { host: 'evil.example.com', zone: 'omnikom.io', until: '2099-01-01' }, { host: 'c.omnikom.io', zone: 'omnikom.io' }] }));
    const l = loadAllowed(f, '2026-11-10');
    const later = loadAllowed(f, '2026-11-13');
    return [l.length === 1 && l[0].host === 'a.omnikom.io' && later.length === 0, JSON.stringify({ l, later })];
  } finally { rmSync(d, { recursive: true, force: true }); }
});

for (const [name, fn] of cases) {
  let ok = false, detail = '';
  try { [ok, detail] = await fn(); } catch (e) { detail = e.stack; }
  check(name, ok, detail);
}
console.log(`${failed ? 'FAIL' : 'PASS'} client-infra tests: ${total - failed} of ${total}`);
process.exit(failed ? 1 : 0);
