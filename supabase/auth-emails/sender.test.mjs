// Tests for the sender rules of supabase/auth-emails/check.mjs (owner 2026-11-20, item 11 of work/map/owner.tsv): the platform's sign-in sender is
// login@notify.omnikom.ai, the alert sender is leads@notify.omnikom.ai (both a value of emails.json, never of an env file), and no file that runs
// (under supabase/, tools/ and .github/) names the old domain except the files that record history. No network. The old domain is written in
// two pieces here and in check.mjs so that the scan finds nothing in these files.
//   node supabase/auth-emails/sender.test.mjs
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXPECT } from '../check-auth-settings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OLD = ['notify.omnikom', 'io'].join('.');
const NEW = 'notify.omnikom.ai';
const cfg = JSON.parse(readFileSync(join(HERE, 'emails.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'auth-emails-sender-'));
const results = [];
const t = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 700) });
const check = (args = []) => spawnSync(process.execPath, [join(HERE, 'check.mjs'), ...args], { encoding: 'utf8', timeout: 120000 });
// a scan root with one file in it: the check must judge it by the path it has under supabase/, tools/ or .github/
const rootWith = (rel, text) => { const root = mkdtempSync(join(tmp, 'root-')); const p = join(root, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return root; };
try {
  t('1 emails.json: the sign-in sender is login@' + NEW + ' and the alert sender is leads@' + NEW,
    cfg.sender.address === 'login@' + NEW && cfg.alerts_sender && cfg.alerts_sender.address === 'leads@' + NEW, JSON.stringify([cfg.sender, cfg.alerts_sender]));
  t('2 check-auth-settings.mjs expects smtp_admin_email login@' + NEW, EXPECT.smtp_admin_email[1] === 'login@' + NEW, EXPECT.smtp_admin_email[1]);
  t('3 both footers name login@' + NEW + ' and keep "Sent by Omnikom, omnikom.io" (the company identity)',
    ['magic-link.html', 'invite.html'].every(f => { const h = readFileSync(join(HERE, f), 'utf8'); return h.includes('Omnikom Dashboard, login@' + NEW + '</p>') && h.includes('Sent by Omnikom, omnikom.io'); }));
  const real = check();
  t('4 the check passes on the real files (both addresses on ' + NEW + ', no old sender in what runs)', real.status === 0 && /^OK: /m.test(real.stdout), real.stdout);

  const bad = check(['--scan-root', rootWith('supabase/ops/x.mjs', "// one\n// two\nconst from = 'login@" + OLD + "';\n")]);
  t('5 the old address put into one running file: the check fails and names that file and line', bad.status === 1 && /^FAIL supabase\/ops\/x\.mjs:3: /m.test(bad.stdout), bad.stdout);
  const wf = check(['--scan-root', rootWith('.github/workflows/y.yml', 'env:\n  LEAD_ALERT_FROM: leads@' + OLD + '\n')]);
  t('6 the same in a workflow file and in tools/', wf.status === 1 && /^FAIL \.github\/workflows\/y\.yml:2: /m.test(wf.stdout)
    && /^FAIL tools\/z\.mjs:1: /m.test(check(['--scan-root', rootWith('tools/z.mjs', 'x = "' + OLD + '"\n')]).stdout), wf.stdout);
  const hist = check(['--scan-root', rootWith('supabase/auth-settings.md', 'the old sender login@' + OLD + ' is retired\n')]);
  const dns5 = check(['--scan-root', rootWith('tools/dns-upsert.mjs', '1\n2\n3\n4\n// Used for the Resend records of ' + OLD + '\n')]);
  const dns3 = check(['--scan-root', rootWith('tools/dns-upsert.mjs', '1\n2\n// Used for the Resend records of ' + OLD + '\n')]);
  t('7 the files that record history are allowed (auth-settings.md; dns-upsert.mjs line 5 only)', hist.status === 0 && dns5.status === 0 && dns3.status === 1, [hist.stdout, dns5.stdout, dns3.stdout].join('|'));
  const fixture = check(['--scan-root', rootWith('supabase/tests/fixture.sql', "select 'a@" + OLD + "';\n")]);
  t('8 supabase/tests fixtures that invent addresses are not scanned', fixture.status === 0, fixture.stdout);

  const dir = join(tmp, 'emails');
  cpSync(HERE, dir, { recursive: true });
  const put = c => writeFileSync(join(dir, 'emails.json'), JSON.stringify(c, null, 2));
  put({ ...cfg, alerts_sender: { address: 'leads@notify.omnikom.com' } });
  const other = check(['--dir', dir]);
  const noKey = { ...cfg }; delete noKey.alerts_sender;
  put(noKey);
  const none = check(['--dir', dir]);
  t('9 the alert sender on another domain, or missing: the check fails and says alerts_sender', other.status === 1 && /alerts_sender/.test(other.stdout) && none.status === 1 && /alerts_sender/.test(none.stdout), other.stdout + '|' + none.stdout);
} finally { rmSync(tmp, { recursive: true, force: true }); }
for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')));
const failed = results.filter(r => !r.ok).length;
console.log(failed ? 'SENDER TESTS FAILED: ' + failed + ' of ' + results.length : 'SENDER TESTS OK: ' + results.length + ' checks');
process.exit(failed ? 1 : 0);
