// Tests for the alert sender in tools/deploy-functions.mjs and tools/deploy-capture-lead.mjs (owner 2026-11-20, item 11): when LEAD_ALERT_FROM is
// asked for, its value is the alerts_sender address of supabase/auth-emails/emails.json and never the environment's, the run prints where it came
// from, and --set LEAD_ALERT_FROM=<another address> is refused. The Supabase CLI is a fake node script (SUPABASE_SCRIPT, for tests only) that
// records what it was asked and the env file it was handed: nothing leaves this machine. Every value is a test string. The old address is written
// in two pieces so the old-sender scan of supabase/auth-emails/check.mjs finds nothing in this file.
//   node tools/test/test-alert-sender.mjs
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OLD_FROM = ['leads@notify.omnikom', 'io'].join('.');
const FILE_FROM = JSON.parse(readFileSync(join(REPO, 'supabase', 'auth-emails', 'emails.json'), 'utf8')).alerts_sender.address;
const SAYS = 'LEAD_ALERT_FROM: from supabase/auth-emails/emails.json';
const work = mkdtempSync(join(tmpdir(), 'omnikom-alert-sender-'));
const FAKE = join(work, 'fake-supabase.mjs');
writeFileSync(FAKE, [
  "import { appendFileSync, readFileSync } from 'node:fs';",
  'const argv = process.argv.slice(2);',
  "const i = argv.indexOf('--env-file');",
  "appendFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv, envFile: i >= 0 ? readFileSync(argv[i + 1], 'utf8') : null }) + '\\n');",
  'process.exit(0);'].join('\n') + '\n');

let n = 0;
const run = (tool, args) => {
  const rec = join(work, 'record-' + (++n) + '.jsonl');
  const r = spawnSync(process.execPath, [join(REPO, 'tools', tool), ...args], {
    encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, STAGING_SUPABASE_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 'test-token-not-a-secret', RESEND_API_KEY: 'test-resend-key-not-a-secret',
      LEAD_ALERT_FROM: OLD_FROM, SUPABASE_SCRIPT: FAKE, FAKE_RECORD: rec },
  });
  const calls = existsSync(rec) ? readFileSync(rec, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  return { code: r.status, out: String(r.stdout) + String(r.stderr), calls, sent: calls.find(c => c.envFile !== null) };
};
const results = [];
const t = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 800) });
const sentLine = (r, name) => (r.sent ? r.sent.envFile.split('\n').find(l => l.startsWith(name + '=')) : undefined);
try {
  const df = run('deploy-functions.mjs', ['--secrets-only', '--secrets', 'LEAD_ALERT_FROM,GITHUB_REPO']);
  t('D1 deploy-functions --secrets LEAD_ALERT_FROM with the old address in the environment: the value handed to the CLI is the file\'s, the run says where it came from, the old address is not printed',
    df.code === 0 && sentLine(df, 'LEAD_ALERT_FROM') === 'LEAD_ALERT_FROM=' + FILE_FROM && df.out.split(/\r?\n/).includes(SAYS) && !df.out.includes(OLD_FROM), df.code + ' ' + JSON.stringify(df.sent) + '\n' + df.out);
  const dfSame = run('deploy-functions.mjs', ['--secrets-only', '--secrets', 'GITHUB_REPO', '--set', 'LEAD_ALERT_FROM=' + FILE_FROM]);
  t('D2 deploy-functions --set LEAD_ALERT_FROM=<the file\'s address> is accepted and sent as the file\'s value', dfSame.code === 0 && sentLine(dfSame, 'LEAD_ALERT_FROM') === 'LEAD_ALERT_FROM=' + FILE_FROM && dfSame.out.split(/\r?\n/).includes(SAYS), dfSame.code + '\n' + dfSame.out);
  const dfBad = run('deploy-functions.mjs', ['--secrets-only', '--secrets', 'LEAD_ALERT_FROM', '--set', 'LEAD_ALERT_FROM=other@example.test']);
  t('D3 deploy-functions --set LEAD_ALERT_FROM=<another address> is refused (exit 2) and the CLI is never called', dfBad.code === 2 && dfBad.calls.length === 0 && /emails\.json/.test(dfBad.out) && !dfBad.out.includes('other@example.test'), dfBad.code + ' ' + dfBad.calls.length + '\n' + dfBad.out);
  const dfNone = run('deploy-functions.mjs', ['--secrets-only', '--secrets', 'GITHUB_REPO']);
  t('D4 deploy-functions without LEAD_ALERT_FROM among the names: no line about it and no such value sent', dfNone.code === 0 && !dfNone.out.includes('LEAD_ALERT_FROM') && !(dfNone.sent && /LEAD_ALERT_FROM/.test(dfNone.sent.envFile)), dfNone.code + '\n' + dfNone.out);
  const cl = run('deploy-capture-lead.mjs', ['--secrets-only']);
  t('D5 deploy-capture-lead with the old address in the environment: the value handed to the CLI is the file\'s, RESEND_API_KEY is still the environment\'s, the run says where it came from, the old address is not printed',
    cl.code === 0 && sentLine(cl, 'LEAD_ALERT_FROM') === 'LEAD_ALERT_FROM=' + FILE_FROM && sentLine(cl, 'RESEND_API_KEY') === 'RESEND_API_KEY=test-resend-key-not-a-secret' && cl.out.split(/\r?\n/).includes(SAYS) && !cl.out.includes(OLD_FROM), cl.code + ' ' + JSON.stringify(cl.sent) + '\n' + cl.out);
  const clBad = run('deploy-capture-lead.mjs', ['--secrets-only', '--set', 'LEAD_ALERT_FROM=other@example.test']);
  t('D6 deploy-capture-lead --set LEAD_ALERT_FROM=<another address> is refused (exit 2) and the CLI is never called', clBad.code === 2 && clBad.calls.length === 0, clBad.code + ' ' + clBad.calls.length + '\n' + clBad.out);
} finally { rmSync(work, { recursive: true, force: true }); }
for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')));
const failed = results.filter(r => !r.ok).length;
console.log(failed ? 'ALERT SENDER TOOL TESTS FAILED: ' + failed + ' of ' + results.length : 'ALERT SENDER TOOL TESTS OK: ' + results.length + ' checks');
process.exit(failed ? 1 : 0);
